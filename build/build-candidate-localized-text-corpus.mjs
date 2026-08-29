#!/usr/bin/env node
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  loadOfficialSample,
  officialSampleDigest,
} from "./official-sample.mjs";
import {
  atomicWriteFileSync,
  createStagingDirectorySync,
  publishDirectorySync,
} from "./atomic-publish.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_CANDIDATE_POINTER = "build/official-samples/candidate.json";
const DEFAULT_OUTPUT_FULL = path.resolve(
  ROOT,
  "..",
  "ptcgp-tools-master",
  "masterdata_decoder",
  ".output-full",
);
const MASTERDATA_TABLES = [
  "Character",
  "PokemonAttackName",
  "PokemonAbilityName",
  "TrainerCard",
  "Trainer",
  "PokemonCard",
  "Pokemon",
  "PokemonAttack",
  "PokemonAbility",
];

function parseArgs(argv) {
  const args = {
    check: false,
    candidateManifest:
      process.env.PCR_OFFICIAL_CANDIDATE_MANIFEST
      || DEFAULT_CANDIDATE_POINTER,
    outputFull:
      process.env.PCR_CANDIDATE_OUTPUT_ROOT || DEFAULT_OUTPUT_FULL,
    corpusRoot: null,
    masterdataRoot: null,
    decryptedRoot: null,
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
      "--output-full": "outputFull",
      "--corpus-root": "corpusRoot",
      "--masterdata-root": "masterdataRoot",
      "--decrypted-root": "decryptedRoot",
      "--fontengine-report": "fontEngineReport",
      "--out": "out",
    }[token];
    if (!key) throw new Error(`unknown argument: ${token}`);
    const value = argv[++index];
    assert(value && !value.startsWith("--"), `${token} requires a value`);
    args[key] = value;
  }
  args.outputFull = path.resolve(args.outputFull);
  args.decryptedRoot = path.resolve(
    args.decryptedRoot || path.join(args.outputFull, "decrypted"),
  );
  args.masterdataRoot = path.resolve(
    args.masterdataRoot || path.join(args.decryptedRoot, "masterdata"),
  );
  return args;
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function fileFact(filename, logicalPath) {
  const bytes = fs.readFileSync(filename);
  return {
    logicalPath,
    byteLength: bytes.length,
    sha256: sha256(bytes),
  };
}

function serialize(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function compactSerialize(value) {
  return `${JSON.stringify(value)}\n`;
}

function repoPath(filename) {
  const relative = path.relative(ROOT, filename).replaceAll("\\", "/");
  assert(
    relative !== ".." && !relative.startsWith("../"),
    `${filename} is outside the repository`,
  );
  return relative;
}

function writeOrCheck(filename, content, check, label) {
  if (check) {
    assert(fs.existsSync(filename), `${label} is missing`);
    assert.equal(fs.readFileSync(filename, "utf8"), content, `${label} is stale`);
    return;
  }
  atomicWriteFileSync(filename, content);
}

function collectStrings(value, output = []) {
  if (typeof value === "string") {
    output.push(value);
  } else if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, output);
  } else if (value && typeof value === "object") {
    for (const item of Object.values(value)) collectStrings(item, output);
  }
  return output;
}

function codePointInventory(strings) {
  const counts = new Map();
  for (const value of strings) {
    for (const character of value) {
      const codePoint = character.codePointAt(0);
      counts.set(codePoint, (counts.get(codePoint) || 0) + 1);
    }
  }
  return [...counts]
    .sort(([left], [right]) => left - right)
    .map(([codePoint, count]) => ({
      codePoint,
      hex: `U+${codePoint.toString(16).toUpperCase().padStart(4, "0")}`,
      character: String.fromCodePoint(codePoint),
      count,
    }));
}

function configuredContracts(corpusRoot) {
  return {
    PCR_CARD_UI_LAYOUT_CONTRACT:
      path.join(corpusRoot, "serialized-ui", "card-ui-layout-contract.json"),
    PCR_CARD_UI_RESOURCE_CONTRACT:
      path.join(corpusRoot, "serialized-ui", "card-ui-resource-contract.json"),
    PCR_TMP_SPRITE_CONTRACT:
      path.join(corpusRoot, "serialized-tmp", "tmp-sprite-contract.json"),
    PCR_CARD_TEXT_DESIGN_CONTRACT:
      path.join(corpusRoot, "serialized-ui", "card-text-design-contract.json"),
    PCR_OFFICIAL_LAYOUT_FITTERS:
      path.join(corpusRoot, "serialized-ui", "official-layout-fitters.json"),
    PCR_TMP_SETTINGS_CONTRACT:
      path.join(corpusRoot, "serialized-tmp", "tmp-settings-contract.json"),
    PCR_TMP_FONT_MANIFEST:
      path.join(corpusRoot, "serialized-tmp", "tmp-font-manifest.json"),
    PCR_CARD_FONT_CONTRACT:
      path.join(corpusRoot, "serialized-ui", "card-font-contract.json"),
  };
}

function setComposeEnvironment(args, corpusRoot) {
  const values = {
    PTCG_MASTERDATA: args.masterdataRoot,
    PTCG_LOCALE_ROOT: path.join(corpusRoot, "locales"),
    PCR_GAME_SRC: args.decryptedRoot,
    ...configuredContracts(corpusRoot),
  };
  for (const [name, filename] of Object.entries(values)) {
    assert(fs.existsSync(filename), `${name} input does not exist: ${filename}`);
    process.env[name] = filename;
  }
  return values;
}

function parseMissingGlyph(error) {
  const match = /^FontAsset (-?\d+) lacks "([\s\S])"$/.exec(
    String(error?.message || ""),
  );
  if (!match) return null;
  const character = match[2];
  const codePoint = character.codePointAt(0);
  return {
    status: "runtime-required",
    reason: "candidate serialized FontAsset has no static glyph",
    fontAssetId: match[1],
    character,
    codePoint,
    codePointHex:
      `U+${codePoint.toString(16).toUpperCase().padStart(4, "0")}`,
    requiredProducer: "Unity 6 dynamic FontEngine",
  };
}

async function build(args) {
  const loaded = loadOfficialSample(args.candidateManifest);
  const { sample } = loaded;
  assert.equal(sample.status, "candidate");
  const sampleManifestSha256 = officialSampleDigest(sample);
  const stem = sample.sampleId.replace(/-candidate$/, "");
  assert.notEqual(stem, sample.sampleId);
  const fontEngineReportPath = path.resolve(
    args.fontEngineReport
      || path.join(
        ROOT,
        "build",
        "official-samples",
        `${stem}-tmp-fontengine.json`,
      ),
  );
  const fontEngineReport = JSON.parse(
    fs.readFileSync(fontEngineReportPath, "utf8"),
  );
  assert.equal(
    fontEngineReport.schema,
    "pocket-card-render/candidate-tmp-fontengine-report@1",
  );
  assert.equal(fontEngineReport.candidate.sampleId, sample.sampleId);
  assert.equal(
    fontEngineReport.candidate.sampleManifestSha256,
    sampleManifestSha256,
  );
  assert.equal(fontEngineReport.summary.nativeFunctionCount, 9);
  assert.equal(fontEngineReport.summary.exactNativeFunctionCount, 9);
  const corpusRoot = path.resolve(
    args.corpusRoot
      || path.join(args.outputFull, "canonical-corpus", stem),
  );
  const publishedLocalizedRoot = path.join(corpusRoot, "localized-text");
  const localizedRoot = args.check
    ? publishedLocalizedRoot
    : createStagingDirectorySync(publishedLocalizedRoot);
  const canonicalScenesPath = path.join(
    ROOT,
    "build",
    "official-samples",
    `${stem}-canonical-scenes.json`,
  );
  const localeProvenancePath = path.join(
    corpusRoot,
    "locales",
    "locale-provenance.json",
  );
  const reportPath = path.resolve(
    ROOT,
    args.out
      || path.join(
        "build",
        "official-samples",
        `${stem}-localized-text-corpus.json`,
      ),
  );
  const environment = setComposeEnvironment(args, corpusRoot);
  const canonicalScenes = JSON.parse(
    fs.readFileSync(canonicalScenesPath, "utf8"),
  );
  const localeProvenance = JSON.parse(
    fs.readFileSync(localeProvenancePath, "utf8"),
  );
  assert.equal(canonicalScenes.candidate.sampleId, sample.sampleId);
  assert.equal(
    canonicalScenes.candidate.sampleManifestSha256,
    sampleManifestSha256,
  );
  assert.equal(localeProvenance.unityVersion, sample.unity.serializedVersion);
  const locales = Object.keys(localeProvenance.locales || {}).sort();
  assert(locales.length > 0, "candidate locale denominator is empty");
  const localeFacts = Object.fromEntries(locales.map((locale) => {
    const source = localeProvenance.locales[locale];
    const filename = path.join(corpusRoot, "locales", `locale_${locale}.json`);
    const fact = fileFact(filename, `locales/locale_${locale}.json`);
    assert.equal(fact.sha256, source.outputSha256, `${locale} output hash drift`);
    assert.match(source.bundleSha256, /^[0-9a-f]{64}$/);
    assert(source.bundleByteLength > 0);
    return [locale, {
      ...fact,
      sourceBundleByteLength: source.bundleByteLength,
      sourceBundleSha256: source.bundleSha256,
      sections: source.sections.map((section) => ({
        name: section.name,
        pathId: section.pathId,
        rawSha256: section.rawSha256,
        entryCount: section.entryCount,
      })),
    }];
  }));
  const masterdataFacts = Object.fromEntries(MASTERDATA_TABLES.map((name) => {
    const filename = path.join(args.masterdataRoot, `${name}.json`);
    return [name, fileFact(filename, `masterdata/${name}.json`)];
  }));
  const contractFacts = Object.fromEntries(
    Object.entries(configuredContracts(corpusRoot)).map(([name, filename]) => [
      name,
      fileFact(
        filename,
        path.relative(corpusRoot, filename).replaceAll("\\", "/"),
      ),
    ]),
  );

  const [{ buildCardData }, { composeFace }] = await Promise.all([
    import("./carddata.mjs"),
    import("./compose.mjs"),
  ]);
  const records = [];
  const expectedFiles = new Set(["index.json"]);
  const aggregateCodePoints = new Map();
  for (const scene of canonicalScenes.scenes) {
    assert(scene.cardId && scene.textStem);
    for (const locale of locales) {
      const semantic = buildCardData(scene.textStem, locale);
      assert.equal(semantic.cardId, scene.textStem);
      const semanticName = `${scene.cardId}.${locale}.data.json`;
      const semanticSerialized = compactSerialize(semantic);
      const semanticPath = path.join(localizedRoot, semanticName);
      writeOrCheck(
        semanticPath,
        semanticSerialized,
        args.check,
        `localized semantic ${scene.cardId}/${locale}`,
      );
      expectedFiles.add(semanticName);
      const strings = collectStrings(semantic);
      const codePoints = codePointInventory(strings);
      for (const entry of codePoints) {
        aggregateCodePoints.set(
          entry.codePoint,
          (aggregateCodePoints.get(entry.codePoint) || 0) + entry.count,
        );
      }

      let compose = null;
      let dynamicGlyphBoundary = null;
      try {
        const composed = composeFace(scene.textStem, locale, scene.cardId);
        const composeName = `${scene.cardId}.${locale}.compose.json`;
        const composeSerialized = compactSerialize(composed);
        const composePath = path.join(localizedRoot, composeName);
        writeOrCheck(
          composePath,
          composeSerialized,
          args.check,
          `localized compose ${scene.cardId}/${locale}`,
        );
        expectedFiles.add(composeName);
        compose = {
          status: "local-static-input-complete",
          artifact: {
            logicalPath: `localized-text/${composeName}`,
            byteLength: Buffer.byteLength(composeSerialized),
            sha256: sha256(composeSerialized),
          },
          elementCount: composed.elements.length,
          textElementCount:
            composed.elements.filter((element) => element.kind === "text").length,
          iconElementCount:
            composed.elements.filter((element) => element.kind === "icon").length,
          inlineExCount:
            composed.elements.filter((element) => element.inlineEx).length,
        };
      } catch (error) {
        dynamicGlyphBoundary = parseMissingGlyph(error);
        if (!dynamicGlyphBoundary) throw error;
      }
      records.push({
        cardId: scene.cardId,
        cardDataId: scene.textStem,
        locale,
        kind: semantic.kind,
        semantic: {
          status: "candidate-official-data-resolved-by-local-port",
          artifact: {
            logicalPath: `localized-text/${semanticName}`,
            byteLength: Buffer.byteLength(semanticSerialized),
            sha256: sha256(semanticSerialized),
          },
          stringCount: strings.length,
          codePointCount: codePoints.length,
          codePoints,
        },
        compose,
        dynamicGlyphBoundary,
        unity6RuntimeLayoutStatus: "runtime-required",
      });
    }
  }
  assert.equal(
    records.length,
    canonicalScenes.scenes.length * locales.length,
  );
  const index = {
    schema: "pocket-card-render/candidate-localized-text-index@1",
    schemaVersion: 1,
    candidate: {
      sampleId: sample.sampleId,
      sampleManifestSha256,
      gameVersion: sample.game.versionName,
      unityVersion: sample.unity.serializedVersion,
    },
    denominator: {
      source: "candidate canonical scenes x candidate locale provenance",
      sceneCount: canonicalScenes.scenes.length,
      localeCount: locales.length,
      entryCount: records.length,
      cards: canonicalScenes.scenes.map(({ cardId, textStem }) => ({
        cardId,
        cardDataId: textStem,
      })),
      locales,
    },
    records,
    aggregateCodePoints: [...aggregateCodePoints]
      .sort(([left], [right]) => left - right)
      .map(([codePoint, count]) => ({
        codePoint,
        hex: `U+${codePoint.toString(16).toUpperCase().padStart(4, "0")}`,
        character: String.fromCodePoint(codePoint),
        count,
      })),
    scope: {
      localeSerializedSource: "exact-file-hash-bound",
      semanticResolution: "known-local-port",
      localCompose: "known-local-port",
      unity6RuntimeLayout: "runtime-required",
      runtimeCaptureUsed: false,
      officialShaderRestorationPercent: null,
      gameFidelity: false,
    },
  };
  const indexSerialized = serialize(index);
  writeOrCheck(
    path.join(localizedRoot, "index.json"),
    indexSerialized,
    args.check,
    "candidate localized text index",
  );
  if (args.check) {
    const actual = fs.readdirSync(localizedRoot)
      .filter((name) => name.endsWith(".json"))
      .sort();
    assert.deepEqual(
      actual,
      [...expectedFiles].sort(),
      "candidate localized text artifact set is stale",
    );
  } else {
    publishDirectorySync(localizedRoot, publishedLocalizedRoot);
  }

  const completeCompose = records.filter(({ compose }) => compose).length;
  const dynamicGlyphEntries = records.filter(
    ({ dynamicGlyphBoundary }) => dynamicGlyphBoundary,
  );
  const report = {
    schema: "pocket-card-render/candidate-localized-text-corpus@2",
    schemaVersion: 2,
    candidate: {
      selection: repoPath(loaded.selectionPath),
      manifest: repoPath(loaded.manifestPath),
      sampleId: sample.sampleId,
      sampleManifestSha256,
      gameVersion: sample.game.versionName,
      unityVersion: sample.unity.serializedVersion,
    },
    scope: index.scope,
    inputs: {
      canonicalScenes: fileFact(
        canonicalScenesPath,
        repoPath(canonicalScenesPath),
      ),
      localeProvenance: fileFact(
        localeProvenancePath,
        "locales/locale-provenance.json",
      ),
      locales: localeFacts,
      masterdata: masterdataFacts,
      contracts: contractFacts,
      candidateTmpFontEngine: fileFact(
        fontEngineReportPath,
        repoPath(fontEngineReportPath),
      ),
      compose: fileFact(
        path.join(ROOT, "build", "compose.mjs"),
        "build/compose.mjs",
      ),
      carddata: fileFact(
        path.join(ROOT, "build", "carddata.mjs"),
        "build/carddata.mjs",
      ),
      builder: fileFact(
        fileURLToPath(import.meta.url),
        "build/build-candidate-localized-text-corpus.mjs",
      ),
    },
    artifact: {
      index: {
        logicalPath: "localized-text/index.json",
        byteLength: Buffer.byteLength(indexSerialized),
        sha256: sha256(indexSerialized),
      },
      semanticFiles: records.map(({ semantic }) => semantic.artifact),
      composeFiles: records
        .filter(({ compose }) => compose)
        .map(({ compose }) => compose.artifact),
    },
    summary: {
      sceneCount: canonicalScenes.scenes.length,
      localeCount: locales.length,
      entryCount: records.length,
      semanticDataCount: records.length,
      localStaticComposeCount: completeCompose,
      dynamicGlyphRequiredEntryCount: dynamicGlyphEntries.length,
      nativeFontEngineFunctionCount:
        fontEngineReport.summary.nativeFunctionCount,
      exactNativeFontEngineFunctionCount:
        fontEngineReport.summary.exactNativeFunctionCount,
      unity6RuntimeLayoutExactCount: 0,
      unity6RuntimeLayoutRequiredCount: records.length,
      aggregateCodePointCount: aggregateCodePoints.size,
    },
    dynamicGlyphObligations: dynamicGlyphEntries.map((record) => ({
      cardId: record.cardId,
      locale: record.locale,
      ...record.dynamicGlyphBoundary,
    })),
    runtimeBoundaries: [
      {
        id: "unity6-dynamic-fontengine",
        status: "runtime-required",
        entryCount: dynamicGlyphEntries.length,
        baselineRuntimeGlyphsReused: false,
        nativeProducerStatus: "exact-candidate-native-function-bodies",
        nativeFunctionCount: fontEngineReport.summary.nativeFunctionCount,
        exactNativeFunctionCount:
          fontEngineReport.summary.exactNativeFunctionCount,
        requiredEvidence: [
          "candidate dynamic atlas pixels and glyph metrics",
          "candidate generated TMP mesh and descriptor state",
          "candidate guest glyph draw bindings",
        ],
      },
      {
        id: "unity6-tmp-layout",
        status: "runtime-required",
        entryCount: records.length,
        localStaticComposeCount: completeCompose,
        reason:
          "local compose completion does not prove Unity 6 TextGenerator layout semantics",
      },
      {
        id: "candidate-localized-text-native-resolution",
        status: "runtime-required",
        entryCount: records.length,
        reason:
          "candidate locale/masterdata bytes are exact, while local resolver behavior is not candidate guest execution",
      },
    ],
  };
  writeOrCheck(
    reportPath,
    serialize(report),
    args.check,
    repoPath(reportPath),
  );
  return { reportPath, report };
}

const args = parseArgs(process.argv.slice(2));
const result = await build(args);
const action = args.check ? "verified" : "wrote";
console.log(
  `${action} ${result.reportPath}: `
  + `${result.report.summary.semanticDataCount}/`
  + `${result.report.summary.entryCount} semantic data, `
  + `${result.report.summary.localStaticComposeCount} local compose, `
  + `${result.report.summary.dynamicGlyphRequiredEntryCount} dynamic-glyph obligations; `
  + "Unity 6 runtime layout 0 exact",
);
