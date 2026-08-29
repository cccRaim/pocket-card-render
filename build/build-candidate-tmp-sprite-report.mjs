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
    decryptedRoot:
      process.env.PCR_DECRYPTED_ROOT
      || path.join(DEFAULT_OUTPUT_FULL, "decrypted"),
    il2cpp:
      process.env.PCR_IL2CPP
      || path.join(DEFAULT_UPSTREAM, "apks", "output", "libil2cpp.so"),
    il2cppDumperOut:
      process.env.PCR_IL2CPP_DUMPER_OUT
      || path.join(
        DEFAULT_UPSTREAM,
        "apks",
        "output",
        "Il2CppDumper",
      ),
    unityVersion: process.env.PCR_UNITY_VERSION || null,
    artifactRoot: null,
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
      "--decrypted-root": "decryptedRoot",
      "--il2cpp": "il2cpp",
      "--il2cpp-dumper-out": "il2cppDumperOut",
      "--unity-version": "unityVersion",
      "--artifact-root": "artifactRoot",
      "--out": "out",
    }[token];
    if (!key) throw new Error(`unknown argument: ${token}`);
    const value = argv[++index];
    assert(value && !value.startsWith("--"), `${token} requires a value`);
    args[key] = value;
  }
  for (const key of ["decryptedRoot", "il2cpp", "il2cppDumperOut"]) {
    args[key] = path.resolve(args[key]);
  }
  return args;
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
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
  const stdout = execFileSync(
    process.env.PYTHON || "python",
    [
      "-B",
      path.join(ROOT, "build", "extract_candidate_tmp_sprite.py"),
      "--candidate-manifest",
      loaded.selectionPath,
      "--decrypted-root",
      args.decryptedRoot,
      "--il2cpp",
      args.il2cpp,
      "--il2cpp-dumper-out",
      args.il2cppDumperOut,
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
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  assert(!stdout.includes("\uFFFD"), "extractor output contains U+FFFD");
  return JSON.parse(stdout.replace(/^\uFEFF/, ""));
}

function validateExtract(extract, loaded, png) {
  const { sample } = loaded;
  assert.equal(
    extract.schema,
    "pocket-card-render/candidate-tmp-sprite-extract@1",
  );
  assert.equal(extract.schemaVersion, 1);
  assert.equal(extract.candidate.sampleId, sample.sampleId);
  assert.equal(
    extract.candidate.sampleManifestSha256,
    officialSampleDigest(sample),
  );
  assert.equal(extract.candidate.unityVersion, sample.unity.serializedVersion);
  assert.equal(extract.scope.serializedSpriteAsset, "exact");
  assert.equal(
    extract.scope.nativePreprocessor,
    "exact-native-instruction-pattern",
  );
  assert.equal(extract.scope.unity6TextGeneratorLayout, "runtime-required");
  assert.equal(extract.scope.baselineUnity2022LayoutReused, false);
  assert.equal(extract.scope.officialShaderRestorationPercent, null);
  assert.equal(extract.scope.gameFidelity, false);
  assert.equal(
    extract.source.il2cpp.sha256,
    sample.artifacts.libil2cpp.sha256,
  );
  assert.equal(
    extract.source.il2cpp.byteLength,
    sample.artifacts.libil2cpp.byteLength,
  );
  assert.deepEqual(extract.preprocessor.spriteIndexTable.values, [0, 2, 1, 3]);
  assert.equal(
    extract.preprocessor.formatLiteral.value,
    "<space=-0.01em><size={0}><sprite={1}><space=-0.1em></size>",
  );
  assert.deepEqual(extract.preprocessor.fontTypeToSpriteIndex, {
    Black: 0,
    White: 2,
    BlackWithWhiteOutline: 1,
    ExBlack: 3,
  });
  assert.deepEqual(extract.preprocessor.pokemonRuleSelection, {
    normalEx: "ExBlack",
    megaEx: "White",
  });
  assert.equal(
    extract.preprocessor.nativeSemantics.getRuleImgTagFontType
      .cardDataFieldOffset,
    "0xac",
  );
  assert.equal(
    extract.preprocessor.nativeSemantics.getRuleImgTagFontType.zeroResult,
    4,
  );
  assert.equal(
    extract.preprocessor.nativeSemantics.getRuleImgTagFontType.nonZeroResult,
    2,
  );
  assert.equal(extract.spriteAsset.pathId, "840073264968542736");
  assert.equal(extract.material.pathId, "-1050951510632854060");
  assert.equal(extract.texture.pathId, "3209478181533236899");
  assert.equal(extract.spriteAsset.glyphs.length, 4);
  assert.equal(extract.spriteAsset.characters.length, 4);
  assert.deepEqual(
    extract.spriteAsset.characters.map(({ name, glyphIndex }) => [
      name,
      glyphIndex,
    ]),
    [
      ["ex_bl_01", 3],
      ["ex_wh_ol", 0],
      ["ex_wh", 2],
      ["ex_bl_02", 1],
    ],
  );
  assert.equal(extract.texture.width, 512);
  assert.equal(extract.texture.height, 256);
  assert.equal(extract.texture.textureFormat, 47);
  assert.equal(png.length, extract.texture.pngByteSize);
  assert.equal(sha256(png), extract.texture.pngSha256);
  assert.equal(extract.layoutBoundary.status, "runtime-required");
  assert.equal(extract.layoutBoundary.baselineUnity2022LayoutReused, false);
}

function writeOrCheck(filename, content, check, label) {
  if (check) {
    assert(fs.existsSync(filename), `${label} does not exist`);
    if (Buffer.isBuffer(content)) {
      assert.deepEqual(fs.readFileSync(filename), content, `${label} is stale`);
    } else {
      assert.equal(fs.readFileSync(filename, "utf8"), content, `${label} is stale`);
    }
    return;
  }
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  atomicWriteFileSync(filename, content);
}

function build(args) {
  const loaded = loadOfficialSample(args.candidateManifest);
  const { sample } = loaded;
  assert.equal(sample.status, "candidate");
  args.unityVersion ||= sample.unity.serializedVersion;
  assert.equal(sample.unity.serializedVersion, args.unityVersion);
  const candidateStem = sample.sampleId.replace(/-candidate$/, "");
  assert.notEqual(candidateStem, sample.sampleId);
  const artifactRoot = path.resolve(
    args.artifactRoot
      || path.join(
        path.dirname(args.decryptedRoot),
        "canonical-corpus",
        candidateStem,
        "serialized-tmp",
      ),
  );
  const contractPath = path.join(artifactRoot, "tmp-sprite-contract.json");
  const pngPath = path.join(artifactRoot, "TextExSprite.png");
  const reportPath = path.resolve(
    ROOT,
    args.out
      || path.join(
        "build",
        "official-samples",
        `${candidateStem}-tmp-sprite.json`,
      ),
  );
  const extract = runExtractor(args, loaded);
  const png = Buffer.from(extract._pngBase64, "base64");
  delete extract._pngBase64;
  validateExtract(extract, loaded, png);
  const contractSerialized = serialize(extract);
  const report = {
    schema: "pocket-card-render/candidate-tmp-sprite-report@1",
    schemaVersion: 1,
    candidate: {
      selection: repoPath(loaded.selectionPath),
      manifest: repoPath(loaded.manifestPath),
      sampleId: sample.sampleId,
      sampleManifestSha256: officialSampleDigest(sample),
      gameVersion: sample.game.versionName,
      unityVersion: sample.unity.serializedVersion,
    },
    scope: {
      status: "partial-exact-with-explicit-runtime-boundary",
      serializedSpriteAsset: "exact",
      nativePreprocessor: "exact-native-instruction-pattern",
      unity6TextGeneratorLayout: "runtime-required",
      runtimeCaptureUsed: false,
      baselineUnity2022LayoutReused: false,
      officialShaderRestorationPercent: null,
      gameFidelity: false,
    },
    inputs: {
      fontBundle: extract.source.fontBundle,
      il2cpp: extract.source.il2cpp,
      il2cppDumper: extract.source.il2cppDumper,
      extractor: {
        logicalPath: "build/extract_candidate_tmp_sprite.py",
        sha256: sha256(fs.readFileSync(
          path.join(ROOT, "build", "extract_candidate_tmp_sprite.py"),
        )),
      },
      builder: {
        logicalPath: "build/build-candidate-tmp-sprite-report.mjs",
        sha256: sha256(fs.readFileSync(fileURLToPath(import.meta.url))),
      },
    },
    artifact: {
      contract: {
        logicalPath: "serialized-tmp/tmp-sprite-contract.json",
        byteLength: Buffer.byteLength(contractSerialized),
        sha256: sha256(contractSerialized),
      },
      texturePng: {
        logicalPath: "serialized-tmp/TextExSprite.png",
        byteLength: png.length,
        sha256: sha256(png),
      },
    },
    summary: {
      spriteAssetCount: 1,
      glyphCount: extract.spriteAsset.glyphs.length,
      characterCount: extract.spriteAsset.characters.length,
      nativeMethodCount: Object.keys(extract.preprocessor.methods).length,
      spriteIndexTableValueCount:
        extract.preprocessor.spriteIndexTable.values.length,
      textureWidth: extract.texture.width,
      textureHeight: extract.texture.height,
    },
    identities: {
      spriteAsset: {
        pathId: extract.spriteAsset.pathId,
        objectSha256: extract.spriteAsset.objectSha256,
      },
      material: {
        pathId: extract.material.pathId,
        objectSha256: extract.material.objectSha256,
      },
      texture: {
        pathId: extract.texture.pathId,
        objectSha256: extract.texture.objectSha256,
        compressedPayloadSha256:
          extract.texture.compressedPayloadSha256,
        decodedRgbaSha256: extract.texture.decodedRgbaSha256,
      },
    },
    preprocessor: {
      methods: extract.preprocessor.methods,
      spriteIndexTable: extract.preprocessor.spriteIndexTable,
      fontTypeToSpriteIndex:
        extract.preprocessor.fontTypeToSpriteIndex,
      pokemonRuleSelection:
        extract.preprocessor.pokemonRuleSelection,
    },
    runtimeBoundary: extract.layoutBoundary,
  };
  const reportSerialized = serialize(report);
  writeOrCheck(
    contractPath,
    contractSerialized,
    args.check,
    "candidate TMP sprite contract",
  );
  writeOrCheck(
    pngPath,
    png,
    args.check,
    "candidate TextExSprite PNG",
  );
  writeOrCheck(
    reportPath,
    reportSerialized,
    args.check,
    repoPath(reportPath),
  );
  return { reportPath, report };
}

const args = parseArgs(process.argv.slice(2));
const result = build(args);
const action = args.check ? "verified" : "wrote";
console.log(
  `${action} ${result.reportPath}: `
  + `${result.report.summary.glyphCount} glyphs, `
  + `${result.report.summary.nativeMethodCount} native methods; `
  + `Unity 6 layout ${result.report.scope.unity6TextGeneratorLayout}`,
);
