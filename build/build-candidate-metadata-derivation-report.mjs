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
const DEFAULT_CANDIDATE = "build/official-samples/candidate.json";
const EXPECTED_SAMPLE_ID =
  "ptcgp-1.7.0-unity-6000.0.69f1-candidate";
const EXPECTED_UNITY_VERSION = "6000.0.69f1";
const DEFAULT_SPLITS = path.resolve(
  ROOT,
  "../ptcg-apk-parser/apks/apkeep-downloads/"
    + "jp.pokemon.pokemontcgp/jp.pokemon.pokemontcgp",
);

function parseArgs(argv) {
  const args = {
    check: false,
    candidateManifest:
      process.env.PCR_OFFICIAL_CANDIDATE_MANIFEST || DEFAULT_CANDIDATE,
    splitRoot: process.env.PCR_CANDIDATE_SPLITS || DEFAULT_SPLITS,
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
      "--out": "out",
    }[token];
    if (!key) throw new Error(`unknown argument: ${token}`);
    const value = argv[++index];
    if (!value || value.startsWith("--")) {
      throw new Error(`${token} requires a value`);
    }
    args[key] = value;
  }
  args.splitRoot = path.resolve(args.splitRoot);
  return args;
}

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

function canonicalDigest(value) {
  return sha256(JSON.stringify(canonicalize(value)));
}

function fileEvidence(filename) {
  const bytes = fs.readFileSync(filename);
  const relative = path.relative(ROOT, filename).replaceAll("\\", "/");
  return {
    logicalPath:
      relative !== ".." && !relative.startsWith("../") ? relative : path.basename(filename),
    byteLength: bytes.length,
    sha256: sha256(bytes),
  };
}

function serialize(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function runExtractor(args, loaded) {
  const extractor = path.join(
    ROOT,
    "build",
    "extract_candidate_metadata_derivation.py",
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
  assert(!stdout.includes("\uFFFD"), "extractor output contains U+FFFD");
  return {
    extractor,
    extraction: JSON.parse(stdout.replace(/^\uFEFF/, "")),
  };
}

function validateExtraction(extraction, sample, sampleManifestSha256) {
  assert.equal(
    extraction.schema,
    "pocket-card-render/candidate-metadata-derivation-extraction@1",
  );
  assert.equal(extraction.candidate.sampleId, EXPECTED_SAMPLE_ID);
  assert.equal(extraction.candidate.sampleId, sample.sampleId);
  assert.equal(extraction.candidate.unityVersion, EXPECTED_UNITY_VERSION);
  assert.equal(
    extraction.candidate.sampleManifestSha256,
    sampleManifestSha256,
  );
  for (const [source, artifact] of [
    ["baseApk", "baseApk"],
    ["arm64Split", "arm64Split"],
    ["libil2cpp", "libil2cpp"],
    ["globalMetadataEncrypted", "globalMetadataEncrypted"],
    ["globalMetadataPlaintextExpected", "globalMetadataPlaintext"],
  ]) {
    assert.deepEqual(extraction.sources[source], {
      byteLength: sample.artifacts[artifact].byteLength,
      sha256: sample.artifacts[artifact].sha256,
    });
  }
  assert.equal(
    extraction.nativeContract.status,
    "exact-candidate-native-transformation-contract",
  );
  assert.equal(
    extraction.nativeContract.aesEvidence.standardKnownAnswerTest.passed,
    true,
  );
  assert.equal(
    extraction.transformation.status,
    "exact-byte-derivation",
  );
  assert.deepEqual(
    extraction.transformation.decrypt.derivedPlaintext,
    extraction.sources.globalMetadataPlaintextExpected,
  );
  assert.equal(
    extraction.transformation.reencrypt.byteEqualToReconstructedCiphertext,
    true,
  );
  assert.equal(
    extraction.metadata.status,
    "strict-il2cpp-metadata-v31",
  );
  assert.equal(extraction.metadata.version, 31);
  assert.equal(extraction.metadata.tableCount, 31);
  assert(
    Object.values(extraction.metadata.strictChecks).every(Boolean),
    "metadata v31 strict structure is incomplete",
  );
  assert.equal(extraction.claims.officialShaderRestorationPercent, null);
  assert.equal(extraction.claims.gameFidelity, false);
}

function buildReport(args) {
  const loaded = loadOfficialSample(args.candidateManifest);
  const { sample } = loaded;
  assert.equal(sample.status, "candidate");
  assert.equal(sample.sampleId, EXPECTED_SAMPLE_ID);
  assert.equal(sample.unity.serializedVersion, EXPECTED_UNITY_VERSION);
  const sampleManifestSha256 = officialSampleDigest(sample);
  const { extractor, extraction } = runExtractor(args, loaded);
  validateExtraction(extraction, sample, sampleManifestSha256);

  const reportWithoutProof = {
    schema: "pocket-card-render/candidate-metadata-derivation-proof@1",
    schemaVersion: 1,
    candidate: {
      selection: loaded.selectionRelative,
      manifest: loaded.manifestRelative,
      sampleId: sample.sampleId,
      sampleManifestSha256,
      gameVersion: sample.game.versionName,
      unityVersion: sample.unity.serializedVersion,
    },
    scope: {
      status: "exact-candidate-static-transformation",
      authority:
        "hash-verified official split APK entries and candidate ARM64 libil2cpp bytes",
      algorithmProof:
        "ARM64 operand/data extraction plus canonical AES tables and standard KAT",
      outputIdentityRole:
        "required endpoint check; not treated as algorithm provenance",
      il2CppDumperRole:
        "downstream consumer only; not used to establish the transformation",
      officialShaderRestorationPercent: null,
      gameFidelity: false,
      runtimeFidelity: false,
    },
    tools: {
      extractor: fileEvidence(extractor),
      builder: fileEvidence(fileURLToPath(import.meta.url)),
    },
    sources: extraction.sources,
    nativeContract: extraction.nativeContract,
    transformation: extraction.transformation,
    metadata: extraction.metadata,
    extractionProofSha256: extraction.proofSha256,
  };
  const report = {
    ...reportWithoutProof,
    proofSha256: canonicalDigest(reportWithoutProof),
  };
  const stem = sample.sampleId.replace(/-candidate$/, "");
  const out = path.resolve(
    args.out
      || path.join(
        ROOT,
        "build",
        "official-samples",
        `${stem}-metadata-derivation.json`,
      ),
  );
  return { out, report };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const { out, report } = buildReport(args);
  const encoded = serialize(report);
  if (args.check) {
    assert(fs.existsSync(out), `candidate metadata proof is missing: ${out}`);
    assert.equal(
      fs.readFileSync(out, "utf8").replace(/\r\n/g, "\n"),
      encoded,
      "candidate metadata derivation proof is stale",
    );
    console.log("Candidate metadata derivation proof check OK");
  } else {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    atomicWriteFileSync(out, encoded);
    console.log(`wrote ${path.relative(ROOT, out).replaceAll("\\", "/")}`);
  }
  console.log(
    `  plaintext ${report.transformation.decrypt.derivedPlaintext.byteLength} bytes `
      + `${report.transformation.decrypt.derivedPlaintext.sha256}`,
  );
  console.log(
    `  native functions ${Object.keys(report.nativeContract.functions).length}; `
      + `instruction checks ${report.nativeContract.selectedInstructionChecks.length}; `
      + `metadata tables ${report.metadata.tableCount}/31 strict`,
  );
}

if (
  process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main();
}
