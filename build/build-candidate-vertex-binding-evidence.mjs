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
    contract: null,
    portRoot: null,
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
      "--contract": "contract",
      "--port-root": "portRoot",
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
  args.portRoot = path.resolve(
    args.portRoot || path.join(args.outputRoot, "webgl-ports"),
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

function repoPath(filename) {
  const relative = path.relative(ROOT, filename).replaceAll("\\", "/");
  assert(relative !== ".." && !relative.startsWith("../"), `${filename} is outside the repository`);
  return relative;
}

function runAudit(args, unityVersion) {
  const stdout = execFileSync(
    process.env.PYTHON || "python",
    [
      "-B",
      "build/audit_official_mesh_vertex_bindings.py",
      "--json",
      "--inventory",
      args.inventory,
      "--decrypted-root",
      path.join(args.outputRoot, "decrypted"),
      "--contract",
      args.contract,
      "--port-root",
      args.portRoot,
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
  const candidateStem = sample.sampleId.replace(/-candidate$/, "");
  assert.notEqual(candidateStem, sample.sampleId);
  args.contract = path.resolve(
    args.contract
      || path.join(
        ROOT,
        "build",
        "official-samples",
        `${candidateStem}-program-port-contract.json`,
      ),
  );
  const outputAbsolute = path.resolve(
    ROOT,
    args.out
      || path.join(
        "build",
        "official-samples",
        `${candidateStem}-vertex-bindings.json`,
      ),
  );

  assert.equal(
    fileDigest(args.inventory),
    sample.proofSets.materialPrograms.inventorySha256,
  );
  const audit = runAudit(args, sample.unity.serializedVersion);
  assert.equal(audit.schema, "pocket-card-render/official-mesh-vertex-bindings@1");
  assert.equal(audit.unityVersion, sample.unity.serializedVersion);
  assert.equal(
    audit.inventory.proofGraphSha256,
    sample.proofSets.materialPrograms.proofGraphSha256,
  );
  assert.equal(
    audit.inventory.portIndexSha256,
    sample.proofSets.materialPrograms.portIndexSha256,
  );
  assert.equal(audit.contract.sha256, fileDigest(args.contract));
  assert.equal(audit.summary.runtimeRequiredMaterialSlots, 0);
  assert.equal(
    audit.summary.presentChannelBindings + audit.summary.missingChannelBindings,
    audit.summary.requiredChannelBindings,
  );
  assert.equal(
    audit.summary.officialGuestVertexBindingExactRows,
    0,
  );
  assert.equal(
    audit.summary.officialGuestVertexBindingRuntimeRequiredRows,
    audit.summary.exactPortDrawPassRows,
  );
  assert.equal(
    audit.upstreamVertexInputSummary.portCount,
    audit.upstreamVertexInputSummary.officialSemanticExactPorts,
  );
  assert.equal(
    audit.upstreamVertexInputSummary.portCount,
    audit.upstreamVertexInputSummary.localAdapterExactPorts,
  );

  const report = {
    schema: "pocket-card-render/candidate-vertex-binding-evidence@1",
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
        proofGraphSha256: audit.inventory.proofGraphSha256,
        portIndexSha256: audit.inventory.portIndexSha256,
      },
      candidateProgramPortContract: {
        logicalPath: repoPath(args.contract),
        sha256: fileDigest(args.contract),
      },
      meshPayloadEvidence: {
        logicalPath:
          `build/official-samples/${candidateStem}-mesh-payload.json`,
        sha256: fileDigest(path.join(
          ROOT,
          "build",
          "official-samples",
          `${candidateStem}-mesh-payload.json`,
        )),
      },
      vertexAuditor: {
        logicalPath: "build/audit_official_vertex_inputs.py",
        sha256: fileDigest(path.join(ROOT, "build", "audit_official_vertex_inputs.py")),
      },
      meshVertexAuditor: {
        logicalPath: "build/audit_official_mesh_vertex_bindings.py",
        sha256: fileDigest(path.join(ROOT, "build", "audit_official_mesh_vertex_bindings.py")),
      },
    },
    proof: {
      status: "exact-static-with-runtime-boundary",
      extractedEvidenceSha256: canonicalDigest(audit),
      selectorSemantics: "exact",
      localWebglAdapter: "exact",
      meshChannelPresence: "exact-static",
      officialGuestVertexBinding: "runtime-required",
      officialGuestDefaultBinding: "runtime-required",
      gameFidelity: false,
      officialShaderRestorationPercent: null,
    },
    summary: {
      ...audit.summary,
      selectorPortCount: audit.upstreamVertexInputSummary.portCount,
      officialSemanticExactPorts:
        audit.upstreamVertexInputSummary.officialSemanticExactPorts,
      localAdapterExactPorts:
        audit.upstreamVertexInputSummary.localAdapterExactPorts,
    },
    guestDefaultBindingObligations: audit.guestDefaultBindingObligations,
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
    console.log("Candidate vertex-binding evidence check OK");
  } else {
    atomicWriteFileSync(outputAbsolute, serialized);
    console.log(`wrote ${repoPath(outputAbsolute)}`);
  }
  console.log(
    `  selector semantics ${report.summary.officialSemanticExactPorts}/`
    + `${report.summary.selectorPortCount}, local adapters `
    + `${report.summary.localAdapterExactPorts}/${report.summary.selectorPortCount}`,
  );
  console.log(
    `  Mesh channels ${report.summary.presentChannelBindings}/`
    + `${report.summary.requiredChannelBindings}; guest bindings `
    + `${report.summary.officialGuestVertexBindingExactRows}/`
    + `${report.summary.exactPortDrawPassRows}`,
  );
}

if (
  process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main();
}
