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
const CACHE = path.resolve(ROOT, "../.cache");
const EXPECTED_SAMPLE_ID =
  "ptcgp-1.7.0-unity-6000.0.69f1-candidate";

function parseArgs(argv) {
  const args = {
    check: false,
    candidateManifest:
      process.env.PCR_OFFICIAL_CANDIDATE_MANIFEST
      || "build/official-samples/candidate.json",
    splitRoot:
      process.env.PCR_CANDIDATE_SPLITS
      || path.resolve(
        ROOT,
        "../ptcg-apk-parser/apks/apkeep-downloads/"
          + "jp.pokemon.pokemontcgp/jp.pokemon.pokemontcgp",
      ),
    releasePlayer:
      process.env.PCR_UNITY_RELEASE_LIBUNITY
      || path.join(
        CACHE,
        "unity-6000.0.69f1/symbols/libunity.release.arm64.so",
      ),
    releaseSymbols:
      process.env.PCR_UNITY_RELEASE_SYMBOLS
      || path.join(
        CACHE,
        "unity-6000.0.69f1/symbols/libunity.release.arm64.sym.so",
      ),
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
      "--split-root": "splitRoot",
      "--release-player": "releasePlayer",
      "--release-symbols": "releaseSymbols",
      "--out": "out",
    }[token];
    if (!key) throw new Error(`unknown argument: ${token}`);
    const value = argv[++index];
    if (!value || value.startsWith("--")) {
      throw new Error(`${token} requires a value`);
    }
    args[key] = value;
  }
  for (const key of ["splitRoot", "releasePlayer", "releaseSymbols"]) {
    args[key] = path.resolve(args[key]);
  }
  return args;
}

function digest(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function identity(filename) {
  const bytes = fs.readFileSync(filename);
  return { byteLength: bytes.length, sha256: digest(bytes) };
}

function repoPath(filename) {
  const relative = path.relative(ROOT, filename).replaceAll("\\", "/");
  assert(
    relative !== ".." && !relative.startsWith("../"),
    `${filename} is outside the repository`,
  );
  return relative;
}

function serialize(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function buildReport(args) {
  const loaded = loadOfficialSample(args.candidateManifest);
  const { sample } = loaded;
  assert.equal(sample.status, "candidate");
  assert.equal(sample.sampleId, EXPECTED_SAMPLE_ID);
  assert.equal(sample.unity.serializedVersion, "6000.0.69f1");
  const sampleManifestSha256 = officialSampleDigest(sample);
  const extractor = path.join(
    ROOT,
    "build",
    "extract_candidate_tmp_fontengine.py",
  );
  const stdout = execFileSync(
    process.env.PYTHON || "python",
    [
      "-B",
      extractor,
      "--candidate-manifest",
      loaded.selectionPath,
      "--split-root",
      args.splitRoot,
      "--release-player",
      args.releasePlayer,
      "--release-symbols",
      args.releaseSymbols,
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
      maxBuffer: 32 * 1024 * 1024,
    },
  );
  const extraction = JSON.parse(stdout.replace(/^\uFEFF/, ""));
  assert.equal(
    extraction.schema,
    "pocket-card-render/candidate-tmp-fontengine-extraction@1",
  );
  assert.equal(extraction.schemaVersion, 1);
  assert.equal(extraction.candidate.sampleId, sample.sampleId);
  assert.equal(
    extraction.candidate.sampleManifestSha256,
    sampleManifestSha256,
  );
  assert.deepEqual(
    extraction.sources.gameLibunity,
    {
      byteLength: sample.artifacts.libunity.byteLength,
      sha256: sample.artifacts.libunity.sha256,
    },
  );
  assert.deepEqual(
    extraction.sources.releasePlayer,
    {
      byteLength: sample.artifacts.unityReleasePlayer.byteLength,
      sha256: sample.artifacts.unityReleasePlayer.sha256,
    },
  );
  assert.deepEqual(
    extraction.sources.releaseSymbols,
    {
      byteLength: sample.artifacts.unityReleaseSymbols.byteLength,
      sha256: sample.artifacts.unityReleaseSymbols.sha256,
    },
  );
  assert.equal(
    extraction.mapping.status,
    "exact-candidate-native-producer-chain",
  );
  assert.equal(extraction.summary.nativeFunctionCount, 9);
  assert.equal(extraction.summary.exactNativeFunctionCount, 9);
  assert.equal(extraction.summary.wholeFunctionExactCount, 3);
  assert.equal(extraction.summary.literalLoadThunkFunctionCount, 1);
  assert.deepEqual(
    extraction.mapping.functions.map(({ id, status }) => [id, status]),
    [
      ["setPixelSizeAndUpsampling", "exact-normalized-instruction-shape"],
      ["loadGlyphSlot", "exact-normalized-instruction-shape"],
      ["copyGlyphSlotToTexture", "exact-normalized-instruction-shape"],
      ["generateSdf", "exact-normalized-instruction-shape"],
      ["generate3x3AaEdt", "exact-normalized-instruction-shape"],
      [
        "renderGlyphToTextureJob",
        "exact-normalized-shape-with-literal-load-thunk",
      ],
      ["computeEdgeGradient", "exact-normalized-instruction-shape"],
      ["approximateEdgeDelta", "exact-normalized-instruction-shape"],
      ["calculate3x3AaEdt", "exact-normalized-instruction-shape"],
    ],
  );
  assert.equal(extraction.facts.dynamicAtlasRenderMode.decimal, 4165);
  assert.equal(extraction.facts.glyphLoadFlags, 6);
  assert.equal(
    extraction.facts.glyphSlotCopy.dynamicAtlasTarget,
    "generate3x3AaEdt",
  );
  assert.equal(
    extraction.facts.renderJobCallsGlyphSlotCopy.value,
    true,
  );
  assert.equal(
    extraction.facts.distanceTransform.edgeDeltaCallCount,
    9,
  );
  assert.equal(
    extraction.facts.distanceTransform.edgeGradientCallCount,
    1,
  );
  assert.equal(extraction.runtimeBoundary.status, "runtime-required");

  const stem = sample.sampleId.replace(/-candidate$/, "");
  const outputAbsolute = path.resolve(
    args.out
      || path.join(
        ROOT,
        "build",
        "official-samples",
        `${stem}-tmp-fontengine.json`,
      ),
  );
  const builder = fileURLToPath(import.meta.url);
  const report = {
    schema: "pocket-card-render/candidate-tmp-fontengine-report@1",
    schemaVersion: 1,
    candidate: {
      selection: loaded.selectionRelative,
      manifest: loaded.manifestRelative,
      ...extraction.candidate,
    },
    scope: {
      status:
        "exact-candidate-native-producer-with-guest-output-boundary",
      nativeProducer: "exact-candidate-native-control-flow",
      guestDynamicAtlas: "runtime-required",
      guestGlyphMeshAndBindings: "runtime-required",
      baselineUnity2022EvidenceReused: false,
      officialShaderRestorationPercent: null,
      gameFidelity: false,
      runtimeFidelity: false,
    },
    tools: {
      extractor: {
        logicalPath: repoPath(extractor),
        ...identity(extractor),
      },
      builder: {
        logicalPath: repoPath(builder),
        ...identity(builder),
      },
    },
    sources: extraction.sources,
    nativeProducer: extraction.mapping,
    facts: extraction.facts,
    runtimeBoundary: extraction.runtimeBoundary,
    summary: extraction.summary,
  };
  return { outputAbsolute, report };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const { outputAbsolute, report } = buildReport(args);
  const serialized = serialize(report);
  if (args.check) {
    assert(
      fs.existsSync(outputAbsolute),
      `${repoPath(outputAbsolute)} is missing`,
    );
    assert.equal(
      fs.readFileSync(outputAbsolute, "utf8"),
      serialized,
      `${repoPath(outputAbsolute)} is stale`,
    );
    console.log("Candidate Unity 6 TMP FontEngine report check OK");
  } else {
    atomicWriteFileSync(outputAbsolute, serialized);
    console.log(`wrote ${repoPath(outputAbsolute)}`);
  }
  console.log(
    `  native functions ${report.summary.exactNativeFunctionCount}/`
      + `${report.summary.nativeFunctionCount} exact; guest atlas runtime-required`,
  );
}

main();
