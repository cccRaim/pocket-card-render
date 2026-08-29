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
const DEFAULT_OUTPUT_ROOT = path.resolve(
  process.env.PCR_CANDIDATE_OUTPUT_ROOT
    || path.join(
      ROOT,
      "..",
      "ptcgp-tools-master",
      "masterdata_decoder",
      ".output-full",
    ),
);

function parseArgs(argv) {
  const args = {
    check: false,
    candidateManifest:
      process.env.PCR_OFFICIAL_CANDIDATE_MANIFEST
      || DEFAULT_CANDIDATE_POINTER,
    outputRoot: DEFAULT_OUTPUT_ROOT,
    inventory: null,
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
      "--output-root": "outputRoot",
      "--inventory": "inventory",
      "--out": "out",
    }[token];
    if (!key) throw new Error(`unknown argument: ${token}`);
    const value = argv[++index];
    if (!value || value.startsWith("--")) {
      throw new Error(`${token} requires a value`);
    }
    args[key] = value;
  }
  args.outputRoot = path.resolve(args.outputRoot);
  args.inventory = path.resolve(
    args.inventory || path.join(args.outputRoot, "material-program-inventory-full.json"),
  );
  return args;
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort(compareText)
        .map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

function canonicalDigest(value) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex");
}

function fileDigest(filename) {
  return crypto
    .createHash("sha256")
    .update(fs.readFileSync(filename))
    .digest("hex");
}

function readJson(filename) {
  return JSON.parse(fs.readFileSync(filename, "utf8").replace(/^\uFEFF/, ""));
}

function repoPath(filename) {
  const relative = path.relative(ROOT, filename).replaceAll("\\", "/");
  assert(relative !== ".." && !relative.startsWith("../"), `${filename} is outside the repository`);
  return relative;
}

function runExtractor(decryptedRoot, unityVersion) {
  const stdout = execFileSync(
    process.env.PYTHON || "python",
    [
      "-B",
      "build/extract_official_mesh_payload.py",
      "--decrypted-root",
      decryptedRoot,
      "--unity-version",
      unityVersion,
    ],
    {
      cwd: ROOT,
      encoding: "utf8",
      shell: process.platform === "win32",
      windowsHide: true,
      env: {
        ...process.env,
        PCR_UNITY_VERSION: unityVersion,
        PYTHONDONTWRITEBYTECODE: "1",
      },
      maxBuffer: 128 * 1024 * 1024,
    },
  );
  return JSON.parse(stdout.replace(/^\uFEFF/, ""));
}

function buildReport(args) {
  const loaded = loadOfficialSample(args.candidateManifest);
  const sample = loaded.sample;
  assert.equal(sample.status, "candidate");
  assert.notEqual(sample.proofSets.materialPrograms?.status, "unresolved");

  const candidateStem = sample.sampleId.replace(/-candidate$/, "");
  assert.notEqual(candidateStem, sample.sampleId, "candidate sample ID needs a -candidate suffix");
  const outputAbsolute = path.resolve(
    ROOT,
    args.out
      || path.join(
        "build",
        "official-samples",
        `${candidateStem}-mesh-payload.json`,
      ),
  );
  const decryptedRoot = path.join(args.outputRoot, "decrypted");
  const inventory = readJson(args.inventory);
  assert.equal(
    fileDigest(args.inventory),
    sample.proofSets.materialPrograms.inventorySha256,
    "candidate inventory does not match the selected manifest",
  );
  assert.equal(inventory.unityVersion, sample.unity.serializedVersion);
  assert.equal(
    inventory.digests.proofGraphSha256,
    sample.proofSets.materialPrograms.proofGraphSha256,
  );
  assert.equal(
    inventory.digests.portIndexSha256,
    sample.proofSets.materialPrograms.portIndexSha256,
  );

  const canonical = readJson(path.join(ROOT, "build", "canonical-corpus.json"));
  assert.equal(canonical.schemaVersion, 1);
  const expectedCards = canonical.scenes.map(({ cardId }) => cardId);
  const extracted = runExtractor(decryptedRoot, sample.unity.serializedVersion);
  assert.equal(extracted.schemaVersion, 2);
  assert.equal(extracted.unityVersion, sample.unity.serializedVersion);
  assert.deepEqual(
    extracted.cards.map(({ card }) => card).sort(compareText),
    [...expectedCards].sort(compareText),
  );
  assert.equal(extracted.summary.cardCount, expectedCards.length);
  assert.equal(extracted.summary.runtimeRequiredMaterialSlotCount, 0);
  assert.equal(
    extracted.summary.materialSlotResolutionCount,
    extracted.summary.exactDirectMaterialSlotCount
      + extracted.summary.exactUniqueMaterialSlotCount,
  );

  const sourceBundles = new Map(inventory.proofGraph.sourceBundles);
  const extractedByCard = new Map(
    extracted.cards.map((card) => [card.card, card]),
  );
  const cards = expectedCards.map((cardId) => {
    const card = extractedByCard.get(cardId);
    assert(card, `${cardId}: candidate Mesh evidence is absent`);
    assert.equal(
      sourceBundles.get(card.prefab),
      card.prefabSha256,
      `${card.card}: candidate Face bundle differs from inventory proof`,
    );
    const glbAbsolute = path.join(ROOT, card.glb);
    assert.equal(
      fileDigest(glbAbsolute),
      card.glbSha256,
      `${card.card}: canonical GLB changed after candidate comparison`,
    );
    return {
      cardId: card.card,
      candidateFaceBundle: {
        logicalPath: card.prefab,
        sha256: card.prefabSha256,
      },
      canonicalGlb: {
        logicalPath: card.glb,
        byteLength: card.glbByteSize,
        sha256: card.glbSha256,
      },
      meshFilterCount: card.meshFilterCount,
      builtInMeshFilterCount: card.builtInMeshFilterCount,
      matchedMeshNodeCount: card.matchedMeshNodeCount,
    };
  });

  const report = {
    schema: "pocket-card-render/candidate-mesh-payload-evidence@1",
    schemaVersion: 1,
    candidate: {
      selection: loaded.selectionRelative,
      manifest: loaded.manifestRelative,
      sampleId: sample.sampleId,
      sampleManifestSha256: officialSampleDigest(sample),
      gameVersion: sample.game.versionName,
      unityVersion: sample.unity.serializedVersion,
    },
    inputs: {
      materialProgramInventory: {
        logicalSourceId: "candidate-material-program-inventory-full",
        sha256: fileDigest(args.inventory),
        proofGraphSha256: inventory.digests.proofGraphSha256,
        portIndexSha256: inventory.digests.portIndexSha256,
      },
      canonicalCorpusDefinition: {
        logicalPath: "build/canonical-corpus.json",
        sha256: fileDigest(path.join(ROOT, "build", "canonical-corpus.json")),
      },
      extractor: {
        logicalPath: "build/extract_official_mesh_payload.py",
        sha256: fileDigest(path.join(ROOT, "build", "extract_official_mesh_payload.py")),
      },
      bundleResolver: {
        logicalPath: "build/extract_official_mrt_outputs.py",
        sha256: fileDigest(path.join(ROOT, "build", "extract_official_mrt_outputs.py")),
      },
    },
    proof: {
      status: "exact-static",
      definition:
        "Unity 6 serialized Mesh payloads and local transforms expanded and compared against the canonical GLB triangle streams",
      extractedEvidenceSha256: canonicalDigest(extracted),
      geometryReuse: "exact",
      runtimeGuestVertexBinding: "runtime-required",
      gameFidelity: false,
      officialShaderRestorationPercent: null,
    },
    summary: extracted.summary,
    cards,
  };
  return { report, outputAbsolute };
}

function serialize(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const { report, outputAbsolute } = buildReport(args);
  const serialized = serialize(report);
  if (args.check) {
    assert(fs.existsSync(outputAbsolute), `${repoPath(outputAbsolute)} does not exist`);
    assert.equal(
      fs.readFileSync(outputAbsolute, "utf8"),
      serialized,
      `${repoPath(outputAbsolute)} is stale`,
    );
    console.log("Candidate Mesh payload evidence check OK");
  } else {
    atomicWriteFileSync(outputAbsolute, serialized);
    console.log(`wrote ${repoPath(outputAbsolute)}`);
  }
  console.log(
    `  ${report.summary.matchedMeshNodeCount} Mesh nodes, `
    + `${report.summary.primitiveCount} primitives, `
    + `${report.summary.materialSlotResolutionCount} material-slot resolutions`,
  );
  console.log(
    `  geometry ${report.proof.geometryReuse}; guest vertex binding `
    + report.proof.runtimeGuestVertexBinding,
  );
}

if (
  process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main();
}
