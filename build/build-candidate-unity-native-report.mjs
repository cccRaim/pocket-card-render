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
const DEFAULT_CANDIDATE = "build/official-samples/candidate.json";
const EXPECTED_SAMPLE_ID =
  "ptcgp-1.7.0-unity-6000.0.69f1-candidate";

function parseArgs(argv) {
  const args = {
    check: false,
    candidateManifest:
      process.env.PCR_OFFICIAL_CANDIDATE_MANIFEST || DEFAULT_CANDIDATE,
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
    installer:
      process.env.PCR_UNITY_ANDROID_SUPPORT
      || path.join(
        CACHE,
        "unity-6000.0.69f1/"
          + "UnitySetup-Android-Support-for-Editor-6000.0.69f1.exe",
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
      "--installer": "installer",
      "--out": "out",
    }[token];
    if (!key) throw new Error(`unknown argument: ${token}`);
    const value = argv[++index];
    if (!value || value.startsWith("--")) {
      throw new Error(`${token} requires a value`);
    }
    args[key] = value;
  }
  for (const key of [
    "splitRoot",
    "releasePlayer",
    "releaseSymbols",
    "installer",
  ]) {
    args[key] = path.resolve(args[key]);
  }
  return args;
}

function digest(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function fileEvidence(filename) {
  const bytes = fs.readFileSync(filename);
  return {
    logicalPath: path.relative(ROOT, filename).replaceAll("\\", "/"),
    byteLength: bytes.length,
    sha256: digest(bytes),
  };
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
  assert.equal(
    sample.unity.releaseSupportVersion,
    sample.unity.playerBuildVersion,
  );
  const extractor = path.join(
    ROOT,
    "build",
    "extract_candidate_unity_native.py",
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
      "--installer",
      args.installer,
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
  const extraction = JSON.parse(stdout.replace(/^\uFEFF/, ""));
  const sampleManifestSha256 = officialSampleDigest(sample);
  assert.equal(
    extraction.schema,
    "pocket-card-render/candidate-unity-native-extraction@1",
  );
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
    extraction.lifecycle.status,
    "exact-candidate-native-contract",
  );
  assert.equal(
    extraction.summary.exactLifecycleFunctionCount,
    extraction.summary.lifecycleFunctionCount,
  );
  assert.equal(extraction.summary.lifecycleFunctionCount, 8);
  assert.equal(extraction.summary.partialExactStaticFunctionCount, 3);
  assert.equal(extraction.summary.exactStaticLocationFunctionCount, 3);
  assert.equal(extraction.summary.partialStaticDirectBranchCount, 52);
  assert.equal(extraction.summary.exactStaticControlFlowEdgeCount, 40);
  assert.equal(extraction.summary.partialStaticControlFlowEdgeCount, 12);
  assert.equal(extraction.summary.unresolvedStrippedGlobalCount, 2);
  assert.equal(extraction.summary.unmappedFunctionCount, 0);
  assert.equal(extraction.summary.sortSemanticExactCount, 5);
  assert.equal(
    extraction.lifecycle.baselineUnity2022ResumeChainReused,
    false,
  );
  assert.equal(
    extraction.claims.officialShaderRestorationPercent,
    null,
  );
  assert.equal(extraction.claims.gameFidelity, false);
  assert.equal(
    extraction.mapping.partialStaticProofModel.status,
    "partial-exact-static",
  );
  const partialStaticIds = new Set([
    "prepareCommand",
    "rendererListPrepare",
    "flattenLightProbeData",
  ]);
  const partialStaticRecords = extraction.mapping.records.filter(
    (record) => partialStaticIds.has(record.id),
  );
  assert.equal(partialStaticRecords.length, partialStaticIds.size);
  for (const record of partialStaticRecords) {
    assert.equal(record.status, "partial-exact-static");
    assert.equal(record.locationProof.status, "exact-static-location");
    assert.equal(record.controlFlowProof.status, "partial-exact-static");
    assert.equal(
      record.controlFlowProof.globalBranchImmediateMasking,
      false,
    );
    assert.equal(
      record.controlFlowProof.allDirectBranchesClassified,
      true,
    );
    assert(record.controlFlowProof.proofSha256);
    assert(record.remainingRuntimeSemantics.length > 0);
  }
  const semanticStaticIds = new Set([
    "distanceKey",
    "getSortingGroupId",
    "getSortingGroupOrder",
    "getGlobalLayeringData",
    "getLightProbesCoefficientType",
  ]);
  const semanticStaticRecords = extraction.mapping.records.filter(
    (record) => semanticStaticIds.has(record.id),
  );
  assert.equal(semanticStaticRecords.length, semanticStaticIds.size);
  for (const record of semanticStaticRecords) {
    assert.equal(
      record.semanticStaticProof?.status,
      "exact-static-semantic-shape",
    );
    assert.equal(
      record.semanticStaticProof.releaseShapeSha256,
      record.semanticStaticProof.gameShapeSha256,
    );
    assert.equal(record.semanticStaticProof.preservesLoadStoreOffsets, true);
    assert.equal(record.semanticStaticProof.preservesAddSubImmediates, true);
    assert.equal(record.semanticStaticProof.preservesDirectCalls, true);
  }
  const prepareCommand = partialStaticRecords.find(
    (record) => record.id === "prepareCommand",
  );
  assert.deepEqual(
    prepareCommand.linkageProof.map((proof) => proof.id),
    ["object-id-map", "renderer-update-manager"],
  );
  for (const proof of prepareCommand.linkageProof) {
    assert.equal(proof.game.candidateSemanticStatus, "unresolved");
    assert.equal(proof.game.candidateSemanticSymbol, null);
  }
  const runtimeBoundaryIds = new Set(
    extraction.runtimeBoundaries
      .filter((boundary) => boundary.status === "runtime-required")
      .map((boundary) => boundary.id),
  );
  for (const id of [
    "sort-structure-and-field-semantics",
    "sort-runtime-identities",
    "sort-job-scheduling-and-output",
    "prepare-command-stripped-globals",
    "light-probe-runtime-context",
  ]) {
    assert(runtimeBoundaryIds.has(id), `runtime boundary missing: ${id}`);
  }

  const report = {
    schema: "pocket-card-render/candidate-unity-native-report@1",
    schemaVersion: 1,
    candidate: {
      selection: loaded.selectionRelative,
      manifest: loaded.manifestRelative,
      sampleId: sample.sampleId,
      sampleManifestSha256,
      gameVersion: sample.game.versionName,
      unityVersion: sample.unity.serializedVersion,
      playerBuildVersion: sample.unity.playerBuildVersion,
      releaseSupportVersion: sample.unity.releaseSupportVersion,
    },
    scope: {
      status: "partial-exact-native-migration",
      releasePlayerAndSymbols: "exact-official-hash-bound",
      lifecycle: "exact-candidate-native-contract",
      sortFunctionRelocation: "partial-exact-static",
      sortControlFlow: "partial-exact-static",
      sortFieldSemantics: "partial-exact-static",
      sortRuntimeSemantics: "runtime-required",
      oldUnity2022EvidenceInherited: false,
      officialShaderRestorationPercent: null,
      gameFidelity: false,
      runtimeFidelity: false,
    },
    tools: {
      extractor: fileEvidence(extractor),
      builder: fileEvidence(fileURLToPath(import.meta.url)),
    },
    sources: extraction.sources,
    mapping: extraction.mapping,
    lifecycle: extraction.lifecycle,
    summary: extraction.summary,
    runtimeBoundaries: extraction.runtimeBoundaries,
    proofSha256: extraction.proofSha256,
  };
  const stem = sample.sampleId.replace(/-candidate$/, "");
  const out = path.resolve(
    args.out
      || path.join(
        ROOT,
        "build",
        "official-samples",
        `${stem}-unity-native.json`,
      ),
  );
  return { report, out };
}

const args = parseArgs(process.argv.slice(2));
const { report, out } = buildReport(args);
const encoded = serialize(report);
if (args.check) {
  assert(fs.existsSync(out), `candidate Unity native report missing: ${out}`);
  assert.equal(
    fs.readFileSync(out, "utf8").replace(/\r\n/g, "\n"),
    encoded,
    "candidate Unity native report is stale",
  );
} else {
  fs.mkdirSync(path.dirname(out), { recursive: true });
  atomicWriteFileSync(out, encoded);
}
console.log(
  `Candidate Unity native: lifecycle `
    + `${report.summary.exactLifecycleFunctionCount}/`
    + `${report.summary.lifecycleFunctionCount} exact; mapped `
    + `${report.summary.mappedFunctionCount}/`
    + `${report.summary.targetFunctionCount}; sort semantics `
    + `${report.summary.sortSemanticExactCount} exact`,
);
