#!/usr/bin/env node
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  loadOfficialSample,
  officialSampleDigest,
} from "./official-sample.mjs";
import { atomicWriteFileSync } from "./atomic-publish.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_CANDIDATE_POINTER = "build/official-samples/candidate.json";
const DEFAULT_UPSTREAM = path.resolve(ROOT, "..", "ptcg-apk-parser");
const DEFAULT_OUTPUT_FULL = path.resolve(
  ROOT,
  "..",
  "ptcgp-tools-master",
  "masterdata_decoder",
  ".output-full",
);

function parseArgs(argv) {
  const args = {
    check: false,
    candidateManifest:
      process.env.PCR_OFFICIAL_CANDIDATE_MANIFEST
      || DEFAULT_CANDIDATE_POINTER,
    baseApk:
      process.env.PCR_CANDIDATE_BASE_APK
      || path.join(
        DEFAULT_UPSTREAM,
        "apks",
        "apkeep-downloads",
        "jp.pokemon.pokemontcgp",
        "jp.pokemon.pokemontcgp",
        "jp.pokemon.pokemontcgp.apk",
      ),
    decryptedRoot:
      process.env.PCR_DECRYPTED_ROOT
      || path.join(DEFAULT_OUTPUT_FULL, "decrypted"),
    unityVersion: process.env.PCR_UNITY_VERSION || null,
    artifactRoot: null,
    fontEngineReport: null,
    out: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--check") {
      args.check = true;
      continue;
    }
    const key = {
      "--candidate-manifest": "candidateManifest",
      "--base-apk": "baseApk",
      "--decrypted-root": "decryptedRoot",
      "--unity-version": "unityVersion",
      "--artifact-root": "artifactRoot",
      "--fontengine-report": "fontEngineReport",
      "--out": "out",
    }[token];
    if (!key) throw new Error(`unknown argument: ${token}`);
    const value = argv[++index];
    if (!value || value.startsWith("--")) {
      throw new Error(`${token} requires a value`);
    }
    args[key] = value;
  }
  args.baseApk = path.resolve(args.baseApk);
  args.decryptedRoot = path.resolve(args.decryptedRoot);
  if (args.fontEngineReport) {
    args.fontEngineReport = path.resolve(args.fontEngineReport);
  }
  return args;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort()
        .map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

function digestBytes(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function digestFile(filename) {
  return digestBytes(fs.readFileSync(filename));
}

function fileIdentity(filename) {
  const bytes = fs.readFileSync(filename);
  return {
    byteLength: bytes.length,
    sha256: digestBytes(bytes),
  };
}

function canonicalDigest(value) {
  return digestBytes(JSON.stringify(canonicalize(value)));
}

function serialize(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function repoPath(filename) {
  const relative = path.relative(ROOT, filename).replaceAll("\\", "/");
  assert(
    relative !== ".." && !relative.startsWith("../"),
    `${filename} is outside the repository`,
  );
  return relative;
}

function runExtractor(args, loaded) {
  const script = path.join(ROOT, "build", "extract_candidate_tmp_serialized.py");
  const stdout = execFileSync(
    process.env.PYTHON || "python",
    [
      "-B",
      script,
      "--candidate-manifest",
      loaded.selectionPath,
      "--base-apk",
      args.baseApk,
      "--decrypted-root",
      args.decryptedRoot,
      "--unity-version",
      args.unityVersion,
    ],
    {
      cwd: ROOT,
      encoding: "utf8",
      shell: process.platform === "win32",
      windowsHide: true,
      env: {
        ...process.env,
        PYTHONDONTWRITEBYTECODE: "1",
        PYTHONIOENCODING: "utf-8",
        PYTHONUTF8: "1",
      },
      maxBuffer: 128 * 1024 * 1024,
    },
  );
  assert(!stdout.includes("\uFFFD"), "extractor output contains U+FFFD");
  return JSON.parse(stdout.replace(/^\uFEFF/, ""));
}

function validateExtract(extract, loaded, args) {
  const { sample } = loaded;
  assert.equal(
    extract.schema,
    "pocket-card-render/candidate-tmp-serialized-extract@1",
  );
  assert.equal(extract.schemaVersion, 1);
  assert.equal(extract.candidate.sampleId, sample.sampleId);
  assert.equal(
    extract.candidate.sampleManifestSha256,
    officialSampleDigest(sample),
  );
  assert.equal(extract.candidate.gameVersion, sample.game.versionName);
  assert.equal(extract.candidate.unityVersion, sample.unity.serializedVersion);
  assert.equal(args.unityVersion, sample.unity.serializedVersion);
  assert.equal(extract.scope.status, "exact-serialized-only");
  assert.equal(extract.scope.nativeCodeUsed, false);
  assert.equal(extract.scope.runtimeCaptureUsed, false);
  assert.equal(extract.scope.generatedAtlasUsed, false);

  const base = extract.apkSerializedSettings.baseApk;
  assert.equal(base.byteLength, sample.artifacts.baseApk.byteLength);
  assert.equal(base.sha256, sample.artifacts.baseApk.sha256);
  assert.equal(fs.statSync(args.baseApk).size, base.byteLength);
  assert.equal(digestFile(args.baseApk), base.sha256);

  const settings = extract.apkSerializedSettings.tmpSettings;
  assert.equal(settings.object.name, "TMP Settings");
  assert.equal(settings.envelope.name, "TMP Settings");
  assert.equal(settings.monoScript.className, "TMP_Settings");
  assert.equal(settings.monoScript.namespace, "TMPro");
  assert.equal(settings.monoScript.assemblyName, "Unity.TextMeshPro");
  assert.equal(settings.fieldLayout.status, "partial-exact-metadata-derived");
  assert.equal(settings.fieldLayout.decodedPayloadFields, 36);
  assert.equal(settings.fieldLayout.strictEof, true);
  assert(settings.envelope.serializedPayload.byteLength > 0);
  assert.match(settings.envelope.serializedPayload.sha256, /^[0-9a-f]{64}$/);
  assert.equal(settings.settings.assetVersion, "2");
  assert.equal(settings.settings.activeFontFeatures[0]?.tag, "kern");
  assert.deepEqual(
    settings.settings.leadingCharactersPPtr,
    settings.resolvedPayloadReferences[0].pointer,
  );
  assert.deepEqual(
    settings.settings.followingCharactersPPtr,
    settings.resolvedPayloadReferences[1].pointer,
  );

  const lineBreaking = extract.apkSerializedSettings.lineBreaking;
  assert(lineBreaking.leadingCharacters.characterCount > 0);
  assert(lineBreaking.followingCharacters.characterCount > 0);
  const fonts = extract.fontBundle;
  assert.equal(fonts.source.logicalPath, "Common/Font_bundles");
  assert.equal(
    digestFile(path.join(args.decryptedRoot, "Common", "Font_bundles")),
    fonts.source.sha256,
  );
  assert(fonts.summary.fontAssetCount > 0);
  assert.equal(fonts.fontAssets.length, fonts.summary.fontAssetCount);
  assert(fonts.summary.atlasTextureCount >= fonts.summary.fontAssetCount);
  assert(fonts.summary.glyphCount > 0);
  assert(fonts.summary.characterCount > 0);
  assert.equal(fonts.summary.fontAssetTypetreeFailureCount, 0);
  const atlasCount = fonts.fontAssets.reduce(
    (count, font) => count + font.atlasTextures.length,
    0,
  );
  assert.equal(atlasCount, fonts.summary.atlasTextureCount);
  assert.equal(
    fonts.fontAssets.reduce(
      (count, font) => count + font.tables.glyphs.count,
      0,
    ),
    fonts.summary.glyphCount,
  );
  assert.equal(
    fonts.fontAssets.reduce(
      (count, font) => count + font.tables.characters.count,
      0,
    ),
    fonts.summary.characterCount,
  );
  for (const font of fonts.fontAssets) {
    assert.match(font.rawSha256, /^[0-9a-f]{64}$/);
    assert(font.atlasTextures.length > 0);
    assert.equal(
      font.serializedTables.glyphs.length,
      font.tables.glyphs.count,
    );
    assert.equal(
      font.serializedTables.characters.length,
      font.tables.characters.count,
    );
    for (const atlas of font.atlasTextures) {
      assert(atlas.width > 0 && atlas.height > 0);
      assert(atlas.imagePayloadByteLength > 0);
      assert.match(atlas.imagePayloadSha256, /^[0-9a-f]{64}$/);
      assert.match(atlas.rawSha256, /^[0-9a-f]{64}$/);
    }
  }

  const dynamic = extract.runtimeBoundaries.find(
    (boundary) => boundary.id === "unity6-dynamic-fontengine",
  );
  assert(dynamic);
  assert.equal(dynamic.status, "runtime-required");
  assert.equal(dynamic.baselineNativeSdfAaReused, false);
  assert.equal(dynamic.nativeSdfAaInvoked, false);
  const settingsLayout = extract.runtimeBoundaries.find(
    (boundary) => boundary.id === "candidate-tmp-settings-field-layout",
  );
  assert(settingsLayout);
  assert.equal(settingsLayout.status, "runtime-required");
}

function writeOrCheck(filename, content, check, label) {
  if (check) {
    assert(fs.existsSync(filename), `${label} does not exist`);
    assert.equal(fs.readFileSync(filename, "utf8"), content, `${label} is stale`);
    return;
  }
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  atomicWriteFileSync(filename, content);
}

function normalizedFace(face) {
  return {
    familyName: face.m_FamilyName,
    styleName: face.m_StyleName,
    pointSize: Number(face.m_PointSize),
    scale: Number(face.m_Scale),
    lineHeight: Number(face.m_LineHeight),
    ascentLine: Number(face.m_AscentLine),
    capLine: Number(face.m_CapLine),
    meanLine: Number(face.m_MeanLine),
    baseline: Number(face.m_Baseline),
    descentLine: Number(face.m_DescentLine),
    superscriptOffset: Number(face.m_SuperscriptOffset),
    superscriptSize: Number(face.m_SuperscriptSize),
    subscriptOffset: Number(face.m_SubscriptOffset),
    subscriptSize: Number(face.m_SubscriptSize),
    underlineOffset: Number(face.m_UnderlineOffset),
    underlineThickness: Number(face.m_UnderlineThickness),
    strikethroughOffset: Number(face.m_StrikethroughOffset),
    strikethroughThickness: Number(face.m_StrikethroughThickness),
    tabWidth: Number(face.m_TabWidth),
  };
}

function normalizedGlyph(glyph) {
  return {
    index: Number(glyph.m_Index),
    metrics: {
      width: Number(glyph.m_Metrics.m_Width),
      height: Number(glyph.m_Metrics.m_Height),
      horizontalBearingX: Number(glyph.m_Metrics.m_HorizontalBearingX),
      horizontalBearingY: Number(glyph.m_Metrics.m_HorizontalBearingY),
      horizontalAdvance: Number(glyph.m_Metrics.m_HorizontalAdvance),
    },
    rect: {
      x: Number(glyph.m_GlyphRect.m_X),
      y: Number(glyph.m_GlyphRect.m_Y),
      width: Number(glyph.m_GlyphRect.m_Width),
      height: Number(glyph.m_GlyphRect.m_Height),
    },
    scale: Number(glyph.m_Scale),
    atlasIndex: Number(glyph.m_AtlasIndex),
    classDefinitionType: Number(glyph.m_ClassDefinitionType),
  };
}

function normalizedCharacter(character) {
  return {
    unicode: Number(character.m_Unicode),
    glyphIndex: Number(character.m_GlyphIndex),
    scale: Number(character.m_Scale),
  };
}

function buildStaticFontManifest(extract, fontEngineBinding) {
  return {
    schemaVersion: 1,
    generatedBy: "build/build-candidate-tmp-serialized-report.mjs",
    source: {
      sampleId: extract.candidate.sampleId,
      sampleManifestSha256: extract.candidate.sampleManifestSha256,
      unityVersion: extract.candidate.unityVersion,
      bundle: extract.fontBundle.source.logicalPath,
      bundleByteSize: extract.fontBundle.source.byteLength,
      bundleSha256: extract.fontBundle.source.sha256,
      scope: "serialized-static-only",
    },
    fonts: Object.fromEntries(extract.fontBundle.fontAssets.map((font) => [
      font.pathId,
      {
        pathId: font.pathId,
        name: font.name,
        source: font.sourceFont ? {
          pathId: font.sourceFont.pathId,
          name: font.sourceFont.name,
          byteSize: font.sourceFont.fontDataByteLength,
          sha256: font.sourceFont.fontDataSha256,
        } : null,
        face: normalizedFace(font.faceInfo),
        atlasWidth: Number(font.atlasConfiguration.width),
        atlasHeight: Number(font.atlasConfiguration.height),
        atlasPadding: Number(font.atlasConfiguration.padding),
        atlasRenderMode: Number(font.atlasConfiguration.renderMode),
        atlasPopulationMode: Number(font.atlasConfiguration.populationMode),
        normalStyle: Number(font.typography.normalStyle),
        normalSpacingOffset: Number(font.typography.normalSpacingOffset),
        boldStyle: Number(font.typography.boldStyle),
        boldSpacing: Number(font.typography.boldSpacing),
        italicStyle: Number(font.typography.italicStyle),
        tabSize: Number(font.typography.tabSize),
        fallbackFontAssetIds: font.fallbackFontAssetPointers
          .map((pointer) => String(pointer.m_PathID || 0))
          .filter((pathId) => pathId !== "0"),
        fontFeatureTable: font.serializedTables.fontFeatureTable,
        atlases: font.atlasTextures.map((atlas, index) => ({
          index,
          pathId: atlas.pathId,
          name: atlas.name,
          width: Number(atlas.width),
          height: Number(atlas.height),
          textureFormat: Number(atlas.textureFormat),
          sampler: atlas.textureSettings,
          colorSpace: Number(atlas.colorSpace),
          alphaPayloadByteSize: atlas.imagePayloadByteLength,
          alphaPayloadSha256: atlas.imagePayloadSha256,
          objectSha256: atlas.rawSha256,
          url: null,
          alphaUrl: null,
          materializationStatus: "not-materialized-static-payload-only",
        })),
        glyphs: font.serializedTables.glyphs.map(normalizedGlyph),
        characters: font.serializedTables.characters.map(normalizedCharacter),
        runtimeAtlases: [],
        runtimeGlyphs: [],
        runtimeCharacters: [],
        syntheticGlyphs: [],
        syntheticCharacters: [],
      },
    ])),
    runtimeBoundary: {
      status: "runtime-required",
      baselineNativeSdfAaReused: false,
      reason:
        "exact Unity 6 native SDFAA bodies and serialized glyph/atlas "
        + "payloads do not prove guest request order, dynamic atlas "
        + "placement, generated glyph mesh or GPU bindings",
      nativeProducer: {
        status: "exact-candidate-native-control-flow",
        evidence: fontEngineBinding,
      },
    },
  };
}

function buildStaticSettingsContract(extract, fontEngineBinding) {
  const settings = extract.apkSerializedSettings.tmpSettings;
  const lineBreaking = extract.apkSerializedSettings.lineBreaking;
  return {
    schemaVersion: 2,
    officialSample: `PTCGP ${extract.candidate.gameVersion} candidate`,
    sampleId: extract.candidate.sampleId,
    sampleManifestSha256: extract.candidate.sampleManifestSha256,
    unityVersion: extract.candidate.unityVersion,
    textMeshProVersion: "Unity 6 integrated",
    source: {
      baseApkByteSize: extract.apkSerializedSettings.baseApk.byteLength,
      baseApkSha256: extract.apkSerializedSettings.baseApk.sha256,
      tmpSettingsObjectSha256: settings.object.rawSha256,
      tmpSettingsPayloadSha256: settings.envelope.serializedPayload.sha256,
      monoScriptPropertiesHashSha256: settings.monoScript.propertiesHashSha256,
      fieldLayoutStatus: settings.fieldLayout.status,
    },
    settings: settings.settings,
    native: {
      status: "exact-candidate-native-control-flow",
      baselineMethodsReused: false,
      evidence: fontEngineBinding,
      guestDynamicOutput: "runtime-required",
    },
    lineBreaking: {
      leadingCharacters: lineBreaking.leadingCharacters,
      followingCharacters: lineBreaking.followingCharacters,
    },
    evidence: {
      status: "partial-exact-metadata-derived-field-semantics",
      strictSerializedPayloadEof: true,
      runtimeFidelity: false,
    },
  };
}

function buildReport(args) {
  const loaded = loadOfficialSample(args.candidateManifest);
  const { sample } = loaded;
  assert.equal(sample.status, "candidate");
  args.unityVersion ||= sample.unity.serializedVersion;
  assert.equal(sample.unity.serializedVersion, args.unityVersion);
  const candidateStem = sample.sampleId.replace(/-candidate$/, "");
  assert.notEqual(candidateStem, sample.sampleId);
  const fontEngineReportPath = path.resolve(
    args.fontEngineReport
      || path.join(
        ROOT,
        "build",
        "official-samples",
        `${candidateStem}-tmp-fontengine.json`,
      ),
  );
  const fontEngineReportBytes = fs.readFileSync(fontEngineReportPath);
  const fontEngineReport = JSON.parse(
    fontEngineReportBytes.toString("utf8"),
  );
  assert.equal(
    fontEngineReport.schema,
    "pocket-card-render/candidate-tmp-fontengine-report@1",
  );
  assert.equal(fontEngineReport.candidate?.sampleId, sample.sampleId);
  assert.equal(
    fontEngineReport.candidate?.sampleManifestSha256,
    officialSampleDigest(sample),
  );
  assert.equal(
    fontEngineReport.scope?.nativeProducer,
    "exact-candidate-native-control-flow",
  );
  assert.equal(fontEngineReport.summary?.nativeFunctionCount, 9);
  assert.equal(fontEngineReport.summary?.exactNativeFunctionCount, 9);
  assert.equal(
    fontEngineReport.sources?.gameLibunity?.sha256,
    sample.artifacts.libunity.sha256,
  );
  assert.equal(
    fontEngineReport.sources?.releasePlayer?.sha256,
    sample.artifacts.unityReleasePlayer.sha256,
  );
  assert.equal(
    fontEngineReport.sources?.releaseSymbols?.sha256,
    sample.artifacts.unityReleaseSymbols.sha256,
  );
  const fontEngineBinding = {
    logicalPath: repoPath(fontEngineReportPath),
    ...fileIdentity(fontEngineReportPath),
    nativeFunctionCount: fontEngineReport.summary.nativeFunctionCount,
    exactNativeFunctionCount:
      fontEngineReport.summary.exactNativeFunctionCount,
  };
  const outputRoot = path.dirname(args.decryptedRoot);
  const artifactRoot = path.resolve(
    args.artifactRoot
      || path.join(
        outputRoot,
        "canonical-corpus",
        candidateStem,
        "serialized-tmp",
      ),
  );
  const artifactPath = path.join(
    artifactRoot,
    "tmp-settings-and-font-atlases.json",
  );
  const settingsContractPath = path.join(
    artifactRoot,
    "tmp-settings-contract.json",
  );
  const fontManifestPath = path.join(
    artifactRoot,
    "tmp-font-manifest.json",
  );
  const reportPath = path.resolve(
    ROOT,
    args.out
      || path.join(
        "build",
        "official-samples",
        `${candidateStem}-tmp-serialized.json`,
      ),
  );
  const extract = runExtractor(args, loaded);
  validateExtract(extract, loaded, args);
  const artifactSerialized = serialize(extract);
  const settingsContractSerialized = serialize(
    buildStaticSettingsContract(extract, fontEngineBinding),
  );
  const fontManifestSerialized = serialize(
    buildStaticFontManifest(extract, fontEngineBinding),
  );
  const artifact = {
    logicalPath: "serialized-tmp/tmp-settings-and-font-atlases.json",
    byteLength: Buffer.byteLength(artifactSerialized),
    sha256: digestBytes(artifactSerialized),
  };
  const runtimeInputs = {
    tmpSettingsContract: {
      logicalPath: "serialized-tmp/tmp-settings-contract.json",
      byteLength: Buffer.byteLength(settingsContractSerialized),
      sha256: digestBytes(settingsContractSerialized),
    },
    tmpFontManifest: {
      logicalPath: "serialized-tmp/tmp-font-manifest.json",
      byteLength: Buffer.byteLength(fontManifestSerialized),
      sha256: digestBytes(fontManifestSerialized),
    },
  };
  const fontNames = extract.fontBundle.fontAssets.map((font) => ({
    pathId: font.pathId,
    name: font.name,
    family: font.faceInfo.m_FamilyName,
    style: font.faceInfo.m_StyleName,
    atlasTextureCount: font.atlasTextures.length,
    glyphCount: font.tables.glyphs.count,
    characterCount: font.tables.characters.count,
    atlasPayloadByteLength: font.atlasTextures.reduce(
      (sum, atlas) => sum + atlas.imagePayloadByteLength,
      0,
    ),
  }));
  const report = {
    schema: "pocket-card-render/candidate-tmp-serialized-report@2",
    schemaVersion: 2,
    candidate: {
      selection: repoPath(loaded.selectionPath),
      manifest: repoPath(loaded.manifestPath),
      sampleId: sample.sampleId,
      sampleManifestSha256: officialSampleDigest(sample),
      gameVersion: sample.game.versionName,
      unityVersion: sample.unity.serializedVersion,
    },
    scope: {
      status:
        "exact-serialized-and-native-producer-with-runtime-output-boundaries",
      evidenceSource:
        "serialized-assets-plus-candidate-native-fontengine",
      nativeCodeUsed: true,
      runtimeCaptureUsed: false,
      generatedAtlasUsed: false,
      officialShaderRestorationPercent: null,
      gameFidelity: false,
      runtimeFidelity: false,
    },
    inputs: {
      baseApk: extract.apkSerializedSettings.baseApk,
      unityData: extract.apkSerializedSettings.unityData,
      fontBundle: extract.fontBundle.source,
      extractor: {
        logicalPath: "build/extract_candidate_tmp_serialized.py",
        sha256: digestFile(
          path.join(ROOT, "build", "extract_candidate_tmp_serialized.py"),
        ),
      },
      builder: {
        logicalPath: "build/build-candidate-tmp-serialized-report.mjs",
        sha256: digestFile(fileURLToPath(import.meta.url)),
      },
      candidateTmpFontEngine: fontEngineBinding,
    },
    artifact,
    runtimeInputs,
    aggregateSha256: canonicalDigest({
      sampleManifestSha256: officialSampleDigest(sample),
      baseApkSha256: extract.apkSerializedSettings.baseApk.sha256,
      fontBundleSha256: extract.fontBundle.source.sha256,
      artifactSha256: artifact.sha256,
      runtimeInputs,
      candidateTmpFontEngineSha256: fontEngineBinding.sha256,
    }),
    summary: {
      ...extract.summary,
      nativeFontEngineFunctionCount:
        fontEngineBinding.nativeFunctionCount,
      exactNativeFontEngineFunctionCount:
        fontEngineBinding.exactNativeFunctionCount,
    },
    tmpSettings: {
      object: extract.apkSerializedSettings.tmpSettings.object,
      monoScript: extract.apkSerializedSettings.tmpSettings.monoScript,
      resolvedPayloadReferences:
        extract.apkSerializedSettings.tmpSettings.resolvedPayloadReferences,
      serializedPayload:
        extract.apkSerializedSettings.tmpSettings.envelope.serializedPayload,
      fieldLayout: extract.apkSerializedSettings.tmpSettings.fieldLayout,
      settings: extract.apkSerializedSettings.tmpSettings.settings,
      leadingCharacters: {
        characterCount:
          extract.apkSerializedSettings.lineBreaking.leadingCharacters.characterCount,
        textSha256:
          extract.apkSerializedSettings.lineBreaking.leadingCharacters.textSha256,
      },
      followingCharacters: {
        characterCount:
          extract.apkSerializedSettings.lineBreaking.followingCharacters.characterCount,
        textSha256:
          extract.apkSerializedSettings.lineBreaking.followingCharacters.textSha256,
      },
    },
    serializedFontAtlases: {
      fontAssetSerializedFieldNamesSha256:
        extract.fontBundle.fontAssetSerializedFieldNamesSha256,
      objectTypeCounts: extract.fontBundle.objectTypeCounts,
      fonts: fontNames,
    },
    nativeFontEngine: {
      status: "exact-candidate-native-control-flow",
      evidence: fontEngineBinding,
      facts: fontEngineReport.facts,
    },
    runtimeBoundaries: extract.runtimeBoundaries.map((boundary) => (
      boundary.id === "unity6-dynamic-fontengine"
        ? {
            ...boundary,
            nativeProducerStatus:
              "exact-candidate-native-control-flow",
            nativeProducerEvidence: fontEngineBinding,
            requiredEvidence: [
              "official guest dynamic glyph request order",
              "official guest dynamic atlas allocation and mutation",
              "official guest generated glyph metrics and mesh bindings",
              "official guest TMP descriptor and uniform bindings",
            ],
            reason:
              "candidate native SDFAA producer bodies are exact, but "
              + "guest request order, atlas placement, generated mesh and "
              + "submitted resources remain runtime-required",
          }
        : boundary
    )),
  };
  const reportSerialized = serialize(report);
  writeOrCheck(
    artifactPath,
    artifactSerialized,
    args.check,
    artifact.logicalPath,
  );
  writeOrCheck(
    settingsContractPath,
    settingsContractSerialized,
    args.check,
    runtimeInputs.tmpSettingsContract.logicalPath,
  );
  writeOrCheck(
    fontManifestPath,
    fontManifestSerialized,
    args.check,
    runtimeInputs.tmpFontManifest.logicalPath,
  );
  writeOrCheck(
    reportPath,
    reportSerialized,
    args.check,
    repoPath(reportPath),
  );
  return {
    artifactPath,
    settingsContractPath,
    fontManifestPath,
    reportPath,
    report,
  };
}

const args = parseArgs(process.argv.slice(2));
const result = buildReport(args);
const action = args.check ? "verified" : "wrote";
console.log(
  `${action} ${result.reportPath}: `
  + `${result.report.summary.fontAssetCount} FontAssets, `
  + `${result.report.summary.atlasTextureCount} atlases, `
  + `${result.report.summary.glyphCount} glyphs, `
  + `${result.report.summary.characterCount} characters`,
);
