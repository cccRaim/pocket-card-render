#!/usr/bin/env node
// Selector-keyed local-port coverage over the compact official executable
// index. SPIR-V ownership and complete executable closure remain separate.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertOfficialPortVerifierSessionStable,
  createOfficialPortVerifierSession,
  preloadOfficialProgramExtractions,
  verify as verifyOfficialPortField,
} from "./official-port-verifier-lib.mjs";
import { auditFullRuntimeEvidence } from "./audit-full-runtime-evidence.mjs";
import { FULL_RUNTIME_DEFINITION } from "./full-runtime-sources.mjs";
import { runtimePortContractRelative } from "./runtime-port-assets.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT_FULL = path.resolve(process.env.PCR_CANDIDATE_OUTPUT_ROOT
  || path.join(ROOT, "..", "ptcgp-tools-master", "masterdata_decoder", ".output-full"));
const CANDIDATE = FULL_RUNTIME_DEFINITION.sample.status === "candidate";
const BASELINE_SAMPLE_ROOT = path.join(
  OUTPUT_FULL,
  "samples",
  FULL_RUNTIME_DEFINITION.sampleId,
);
const BASELINE_INVENTORY = fs.existsSync(
  path.join(BASELINE_SAMPLE_ROOT, "material-program-inventory-full.json"),
)
  ? path.join(BASELINE_SAMPLE_ROOT, "material-program-inventory-full.json")
  : path.join(ROOT, "$cache", "official-material-program-inventory-v4-full.json");
const BASELINE_DECRYPTED_ROOT = fs.statSync(
  path.join(BASELINE_SAMPLE_ROOT, "decrypted-full"),
  { throwIfNoEntry: false },
)?.isDirectory()
  ? path.join(BASELINE_SAMPLE_ROOT, "decrypted-full")
  : path.join(BASELINE_SAMPLE_ROOT, "decrypted");
const INVENTORY = path.resolve(process.env.PCR_MATERIAL_PROGRAM_INVENTORY
  || (CANDIDATE
    ? path.join(OUTPUT_FULL, "material-program-inventory-full.json")
    : BASELINE_INVENTORY));
const CONTRACT = path.resolve(ROOT, runtimePortContractRelative(FULL_RUNTIME_DEFINITION));
const CANDIDATE_PORT_ROOT = path.resolve(process.env.PCR_CANDIDATE_PORT_ROOT
  || path.join(OUTPUT_FULL, "webgl-ports"));
const DECRYPTED_ROOT = path.resolve(process.env.PCR_DECRYPTED_ROOT
  || (CANDIDATE
    ? path.join(OUTPUT_FULL, "decrypted")
    : BASELINE_DECRYPTED_ROOT));
const FULL_RUNTIME = path.join(ROOT, "$cache", "full-runtime-evidence.local.json");
const CONTRACT_DECLARATION = JSON.parse(fs.readFileSync(CONTRACT, "utf8"));
const EXPECTED_PROOF = CANDIDATE
  ? CONTRACT_DECLARATION.inventory.proofGraphSha256
  : "307ed3660e5d3b1bfd8cf9e6b3d64e44937af215da3b6ed84ead198800eeadc4";
const EXPECTED_PORT_INDEX = CANDIDATE
  ? CONTRACT_DECLARATION.inventory.portIndexSha256
  : "15095f34b9e75515bbcc3924f6f8b2abb826ba96b48e819ec911486bcfa6f5a9";
const JSON_MODE = process.argv.includes("--json");
const GENERATORS_EXTERNALLY_VERIFIED = process.env.PCR_PROGRAM_PORT_GENERATORS_EXTERNALLY_VERIFIED === "1";
const FIELDS = ["stageProgram", "parameterEntry", "passState", "commonBindings", "runtimeDispatch"];
const VERDICTS = new Set(["exact", "source-hash-bound", "runtime-required", "unproved"]);
const VERIFICATION_RUNTIME_SHA256 = fs.existsSync(FULL_RUNTIME)
  ? crypto.createHash("sha256").update(fs.readFileSync(FULL_RUNTIME)).digest("hex")
  : null;

function walkJson(directory) {
  const rows = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) rows.push(...walkJson(target));
    else if (entry.isFile() && entry.name.endsWith(".json")) rows.push(target);
  }
  return rows;
}

function inside(directory, target) {
  const relative = path.relative(directory, target);
  return relative !== ""
    && relative !== ".."
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative);
}

function manifestPath(logical) {
  if (!CANDIDATE) {
    const target = path.resolve(ROOT, logical);
    return inside(path.join(ROOT, "public", "shaders"), target) ? target : null;
  }
  if (typeof logical !== "string" || !logical.startsWith("candidate-port:")) return null;
  const target = path.resolve(CANDIDATE_PORT_ROOT, logical.slice("candidate-port:".length));
  return inside(CANDIDATE_PORT_ROOT, target) ? target : null;
}

function readManifest(logical) {
  const target = manifestPath(logical);
  if (!target || !fs.existsSync(target)) return null;
  return JSON.parse(fs.readFileSync(target, "utf8"));
}

function indexKey(row) {
  return `${row.selectorId}:${row.subshader}:${row.pass}`;
}

function contractKey(row) {
  return `${row.selectorId}:${row.candidateWitnessId}:${row.subshader}:${row.pass}`;
}

function isStageBound(contractRow, indexRow, manifest, verification) {
  return !!indexRow && !!manifest
    && contractRow.selectorId === indexRow.selectorId
    && contractRow.subshader === indexRow.subshader
    && contractRow.pass === indexRow.pass
    && contractRow.candidateWitnessId === indexRow.candidateWitnessId
    && contractRow.semanticExecutableId === indexRow.semanticExecutableId
    && contractRow.generator === manifest.generated_by
    && ["exact", "source-hash-bound"].includes(verification?.stageProgram?.verdict)
    && manifest.official_spirv_sha256?.vertex === indexRow.identityFields.vertexSpirvSha256
    && manifest.official_spirv_sha256?.fragment === indexRow.identityFields.fragmentSpirvSha256;
}

function hasCompleteClosure(verification) {
  return FIELDS.every((field) => verification?.[field]?.verdict === "exact");
}

function runVerifier(contractRow, field) {
  const obligation = contractRow.obligations?.[field];
  assert.ok(obligation?.scope && obligation?.verifier, `${contractRow.selectorId}:${field} obligation is absent`);
  const target = path.resolve(ROOT, obligation.verifier);
  assert.ok(target.startsWith(path.join(ROOT, "build") + path.sep) && fs.existsSync(target));
  const result = verifyOfficialPortField(field, contractRow, verifierSession);
  assert.equal(result.schema, "pocket-card-render/official-port-verifier-result@1");
  assert.equal(result.field, field);
  assert.equal(result.scope, obligation.scope);
  assert.deepEqual(result.selectorKey, {
    selectorId: contractRow.selectorId,
    candidateWitnessId: contractRow.candidateWitnessId,
    subshader: contractRow.subshader,
    pass: contractRow.pass,
  });
  assert.equal(result.semanticExecutableId, contractRow.semanticExecutableId);
  assert.ok(VERDICTS.has(result.verdict));
  assert.ok(Array.isArray(result.exactSubclaims) && Array.isArray(result.unresolved));
  assert.equal(result.localEvidence?.runtimeEvidenceSha256, VERIFICATION_RUNTIME_SHA256);
  if (result.verdict === "exact") assert.equal(result.unresolved.length, 0);
  return result;
}

if (!fs.existsSync(INVENTORY)) {
  fs.mkdirSync(path.dirname(INVENTORY), { recursive: true });
  const generated = spawnSync(process.env.PYTHON || "python", [
    "build/extract_official_material_program_inventory.py", "--out", INVENTORY,
  ], {
    cwd: ROOT,
    encoding: "utf8",
    windowsHide: true,
    shell: process.platform === "win32",
    maxBuffer: 16 * 1024 * 1024,
  });
  if (generated.status !== 0) {
    console.error(`BAD official program port coverage: inventory generation failed\n${generated.stderr || generated.stdout || generated.error || ""}`);
    process.exit(1);
  }
}

const verifierSession = createOfficialPortVerifierSession({
  inventoryPath: INVENTORY,
  contractPath: CONTRACT,
  runtimePath: FULL_RUNTIME,
  expectedRuntimeSha256: VERIFICATION_RUNTIME_SHA256,
  candidatePortRoot: CANDIDATE ? CANDIDATE_PORT_ROOT : null,
  decryptedRoot: DECRYPTED_ROOT,
  generatorsExternallyVerified: GENERATORS_EXTERNALLY_VERIFIED,
  requirePreloadedExtractions: true,
});
const { inventory, contract } = verifierSession;
assert.equal(inventory.schema, "pocket-card-render/official-material-program-inventory@4");
assert.equal(inventory.digests.proofGraphSha256, EXPECTED_PROOF);
assert.equal(inventory.digests.portIndexSha256, EXPECTED_PORT_INDEX);
assert.equal(inventory.portIndex.length, CANDIDATE ? 79 : 80);
assert.equal(
  contract.schema,
  CANDIDATE
    ? "pocket-card-render/candidate-program-port-contract@1"
    : "pocket-card-render/official-program-port-contract@2",
);
assert.equal(contract.inventory.schema, inventory.schema);
assert.equal(contract.inventory.proofGraphSha256, EXPECTED_PROOF);
assert.equal(contract.inventory.portIndexSha256, EXPECTED_PORT_INDEX);
if (CANDIDATE) {
  assert.equal(
    contract.inventory.inventorySha256,
    crypto.createHash("sha256").update(fs.readFileSync(INVENTORY)).digest("hex"),
  );
  assert.equal(contract.provenance.sampleId, FULL_RUNTIME_DEFINITION.sampleId);
  assert.equal(
    contract.provenance.sampleManifestSha256,
    FULL_RUNTIME_DEFINITION.sampleManifestSha256,
  );
}
const selectorExtractionBatch = preloadOfficialProgramExtractions({
  ports: contract.ports,
  inventoryPath: INVENTORY,
  decryptedRoot: DECRYPTED_ROOT,
  expectedProofGraphSha256: EXPECTED_PROOF,
  expectedPortIndexSha256: EXPECTED_PORT_INDEX,
});
for (const [key, extraction] of selectorExtractionBatch.extractions) {
  verifierSession.officialExtractions.set(key, extraction);
}
assert.equal(verifierSession.officialExtractions.size, contract.ports.length);

const index = new Map(inventory.portIndex.map((row) => [indexKey(row), row]));
assert.equal(index.size, CANDIDATE ? 79 : 80);
const verificationResults = new Map(contract.ports.map((row) => [
  contractKey(row),
  Object.fromEntries(FIELDS.map((field) => [field, runVerifier(row, field)])),
]));
assertOfficialPortVerifierSessionStable(verifierSession);
const stageBound = [];
const unmatched = [];
for (const row of contract.ports) {
  const indexRow = index.get(indexKey(row));
  const manifest = readManifest(row.manifest);
  const verification = verificationResults.get(contractKey(row));
  if (!isStageBound(row, indexRow, manifest, verification)) {
    unmatched.push({ selectorId: row.selectorId, manifest: row.manifest });
    continue;
  }
  const generator = path.resolve(ROOT, row.generator || "");
  assert.ok(generator.startsWith(path.join(ROOT, "build") + path.sep) && fs.existsSync(generator));
  stageBound.push({
    ...row,
    shaderIdentity: indexRow.shaderIdentity,
    shaderName: indexRow.shaderName,
    keywords: indexRow.keywords,
    materialCount: indexRow.materialCount,
    materialSlotUsages: indexRow.materialSlotUsages,
    completeClosure: hasCompleteClosure(verification),
    fieldVerdicts: Object.fromEntries(FIELDS.map((field) => [field, verification[field].verdict])),
  });
}

const generatorChecks = [...verifierSession.checkedGenerators]
  .map((generator) => path.relative(ROOT, generator).replaceAll("\\", "/"))
  .sort();

const runtimeVariantOnly = contract.runtimeBound.map((row) => {
  if (CANDIDATE) {
    assert.equal(row.shaderName, "Lettuce/Common/CardNew/Face/Side&Back");
    assert.deepEqual(row.keywords, []);
    assert.equal(row.boundary, "engine-owned runtime variant");
    assert.ok(index.has(indexKey(row)));
    return row;
  }
  const manifest = readManifest(row.manifest);
  assert.equal(manifest?.shader, "Lettuce/Common/CardNew/Face/Side&Back");
  assert.deepEqual(manifest?.official_variant?.keywords, ["INSTANCING_ON"]);
  return row;
});
const stageSelectorIds = new Set(stageBound.map((row) => row.selectorId));
const stageExecutableIds = new Set(stageBound.map((row) => row.semanticExecutableId));
const completeExecutableIds = new Set(stageBound.filter((row) => row.completeClosure).map((row) => row.semanticExecutableId));
const selectorTotals = [...stageSelectorIds].map((selectorId) => {
  const rows = inventory.portIndex.filter((row) => row.selectorId === selectorId);
  assert.ok(rows.length >= 1);
  return rows[0];
});
const manifestsWithOfficialSpirv = CANDIDATE
  ? contract.ports.filter((row) => {
      const value = readManifest(row.manifest);
      return value?.official_spirv_sha256?.vertex && value?.official_spirv_sha256?.fragment;
    }).length
  : walkJson(path.join(ROOT, "public", "shaders")).filter((file) => {
      const value = JSON.parse(fs.readFileSync(file, "utf8"));
      return value.official_spirv_sha256?.vertex && value.official_spirv_sha256?.fragment;
    }).length;
const fieldVerdicts = Object.fromEntries(FIELDS.map((field) => [field, Object.fromEntries(
  [...VERDICTS].map((verdict) => [verdict, [...verificationResults.values()]
    .filter((result) => result[field].verdict === verdict).length]),
)]));
const runtimeEvidence = auditFullRuntimeEvidence(FULL_RUNTIME);
const freshRuntimeEvidence = runtimeEvidence.status === "pass";

const summary = {
  officialSemanticExecutables: inventory.summary.semanticExecutableArchetypes,
  officialSelectors: inventory.summary.selectorArchetypes,
  officialResolvedMaterials: inventory.summary.resolvedMaterials,
  officialMaterialSlotUsages: inventory.summary.materialSlotUsages,
  manifestsWithOfficialSpirv,
  stageBoundSelectors: stageSelectorIds.size,
  stageBoundSemanticExecutables: stageExecutableIds.size,
  stageBoundResolvedMaterials: selectorTotals.reduce((sum, row) => sum + row.materialCount, 0),
  stageBoundMaterialSlotUsages: selectorTotals.reduce((sum, row) => sum + row.materialSlotUsages, 0),
  completeExecutableClosures: completeExecutableIds.size,
  verifierChecks: contract.ports.length * FIELDS.length,
  exactFieldObligations: [...verificationResults.values()].reduce((sum, result) =>
    sum + FIELDS.filter((field) => result[field].verdict === "exact").length, 0),
  selectorExtractionBatches: 1,
  selectorExtractionInventoryLoads: selectorExtractionBatch.statistics.inventoryLoadCount,
  selectorExtractions: selectorExtractionBatch.statistics.extractionCount,
  generatorChecks: generatorChecks.length,
  runtimeVariantOnlyManifests: runtimeVariantOnly.length,
  unmatchedContractRows: unmatched.length,
};
const expectedSummary = {
  officialSemanticExecutables: 77,
  officialSelectors: 78,
  officialResolvedMaterials: 8460,
  officialMaterialSlotUsages: 58057,
  manifestsWithOfficialSpirv: 80,
  stageBoundSelectors: 77,
  stageBoundSemanticExecutables: 76,
  stageBoundResolvedMaterials: 8458,
  stageBoundMaterialSlotUsages: 51675,
  completeExecutableClosures: 0,
  verifierChecks: 395,
  exactFieldObligations: freshRuntimeEvidence ? 164 : 79,
  selectorExtractionBatches: 1,
  selectorExtractionInventoryLoads: 1,
  selectorExtractions: 79,
  generatorChecks: GENERATORS_EXTERNALLY_VERIFIED ? 0 : 39,
  runtimeVariantOnlyManifests: 1,
  unmatchedContractRows: 0,
};
const expectedFieldVerdicts = freshRuntimeEvidence ? {
  stageProgram: { exact: 0, "source-hash-bound": 79, "runtime-required": 0, unproved: 0 },
  parameterEntry: { exact: 79, "source-hash-bound": 0, "runtime-required": 0, unproved: 0 },
  passState: { exact: 28, "source-hash-bound": 0, "runtime-required": 51, unproved: 0 },
  commonBindings: { exact: 28, "source-hash-bound": 0, "runtime-required": 51, unproved: 0 },
  runtimeDispatch: { exact: 29, "source-hash-bound": 0, "runtime-required": 50, unproved: 0 },
} : {
  stageProgram: { exact: 0, "source-hash-bound": 79, "runtime-required": 0, unproved: 0 },
  parameterEntry: { exact: 79, "source-hash-bound": 0, "runtime-required": 0, unproved: 0 },
  passState: { exact: 0, "source-hash-bound": 0, "runtime-required": 79, unproved: 0 },
  commonBindings: { exact: 0, "source-hash-bound": 0, "runtime-required": 79, unproved: 0 },
  runtimeDispatch: { exact: 0, "source-hash-bound": 0, "runtime-required": 79, unproved: 0 },
};
const reportCurrent = process.argv.includes("--report-current");
if (CANDIDATE) {
  assert.deepEqual(
    {
      officialSemanticExecutables: summary.officialSemanticExecutables,
      officialSelectors: summary.officialSelectors,
      officialResolvedMaterials: summary.officialResolvedMaterials,
      officialMaterialSlotUsages: summary.officialMaterialSlotUsages,
      manifestsWithOfficialSpirv: summary.manifestsWithOfficialSpirv,
      stageBoundSelectors: summary.stageBoundSelectors,
      stageBoundSemanticExecutables: summary.stageBoundSemanticExecutables,
      completeExecutableClosures: summary.completeExecutableClosures,
      verifierChecks: summary.verifierChecks,
      selectorExtractionBatches: summary.selectorExtractionBatches,
      selectorExtractionInventoryLoads: summary.selectorExtractionInventoryLoads,
      selectorExtractions: summary.selectorExtractions,
      runtimeVariantOnlyManifests: summary.runtimeVariantOnlyManifests,
      unmatchedContractRows: summary.unmatchedContractRows,
    },
    {
      officialSemanticExecutables: 77,
      officialSelectors: 77,
      officialResolvedMaterials: 9395,
      officialMaterialSlotUsages: 64738,
      manifestsWithOfficialSpirv: 78,
      stageBoundSelectors: 76,
      stageBoundSemanticExecutables: 76,
      completeExecutableClosures: 0,
      verifierChecks: 390,
      selectorExtractionBatches: 1,
      selectorExtractionInventoryLoads: 1,
      selectorExtractions: 78,
      runtimeVariantOnlyManifests: 1,
      unmatchedContractRows: 0,
    },
  );
  assert.equal(contract.ports.length, 78);
  assert.equal(contract.runtimeBound.length, 1);
  assert.equal(freshRuntimeEvidence, true, "candidate coverage requires fresh full-runtime evidence");
  assert.deepEqual(fieldVerdicts.stageProgram, {
    exact: 0,
    "source-hash-bound": 78,
    "runtime-required": 0,
    unproved: 0,
  });
  assert.deepEqual(fieldVerdicts.parameterEntry, {
    exact: 78,
    "source-hash-bound": 0,
    "runtime-required": 0,
    unproved: 0,
  });
} else if (reportCurrent) {
  const runtimeDerived = new Set(["completeExecutableClosures", "exactFieldObligations"]);
  assert.deepEqual(
    Object.fromEntries(Object.entries(summary).filter(([key]) => !runtimeDerived.has(key))),
    Object.fromEntries(Object.entries(expectedSummary).filter(([key]) => !runtimeDerived.has(key))),
  );
} else {
  assert.deepEqual(summary, expectedSummary);
  assert.deepEqual(fieldVerdicts, expectedFieldVerdicts);
}

// Mutation proofs: selector swaps, stage hash changes, and unverified closure
// claims cannot retain coverage.
const sample = contract.ports[0];
const sampleIndex = index.get(indexKey(sample));
const sampleManifest = readManifest(sample.manifest);
const sampleVerification = verificationResults.get(contractKey(sample));
assert.equal(isStageBound({ ...sample, selectorId: "0".repeat(64) }, sampleIndex, sampleManifest, sampleVerification), false);
const mutatedManifest = structuredClone(sampleManifest);
mutatedManifest.official_spirv_sha256.fragment = "0".repeat(64);
assert.equal(isStageBound(sample, sampleIndex, mutatedManifest, sampleVerification), false);
const copiedResults = structuredClone(sampleVerification);
for (const field of FIELDS) copiedResults[field].verdict = "exact";
assert.equal(hasCompleteClosure(copiedResults), true);
copiedResults.parameterEntry.verdict = "unproved";
assert.equal(hasCompleteClosure(copiedResults), false);

const report = {
  schema: "pocket-card-render/official-program-port-coverage@2",
  officialSample: {
    sampleId: FULL_RUNTIME_DEFINITION.sampleId,
    sampleManifestSha256: FULL_RUNTIME_DEFINITION.sampleManifestSha256,
    status: FULL_RUNTIME_DEFINITION.sample.status,
  },
  inventory: { path: INVENTORY, proofGraphSha256: EXPECTED_PROOF, portIndexSha256: EXPECTED_PORT_INDEX },
  contract: path.relative(ROOT, CONTRACT).replaceAll("\\", "/"),
  runtimeEvidence: {
    status: runtimeEvidence.status,
    validCaptureCount: runtimeEvidence.validCaptureCount,
  },
  summary,
  stageBound,
  fieldVerdicts,
  runtimeVariantOnly,
  unmatched,
  boundaries: [
    "selector-keyed SPIR-V equality plus generator --check proves stage-program ownership, not parameter/pass/binding/dispatch equivalence",
    "complete closure requires five independently executed verifier verdicts of exact; route declarations and file existence never count",
    ...(CANDIDATE
      ? ["candidate manifests and source files are resolved only through the hash-bound candidate-port root"]
      : []),
    ...(reportCurrent ? ["report-current preserves every static baseline assertion but permits source-stale runtime evidence to lower closure and exact-field counts"] : []),
    "engine-owned INSTANCING_ON remains runtime evidence and cannot be attached to the static empty-keyword selector",
  ],
};
if (JSON_MODE) console.log(JSON.stringify(report));
else {
  console.log("Official selector-keyed program port coverage audit OK");
  console.log(`  stage-bound selectors:      ${summary.stageBoundSelectors}/${summary.officialSelectors}`);
  console.log(`  stage-bound executables:    ${summary.stageBoundSemanticExecutables}/${summary.officialSemanticExecutables}`);
  console.log(`  stage-bound Materials:      ${summary.stageBoundResolvedMaterials}/${summary.officialResolvedMaterials}`);
  console.log(`  stage-bound material slots: ${summary.stageBoundMaterialSlotUsages}/${summary.officialMaterialSlotUsages}`);
  console.log(`  complete executable closure:${String(summary.completeExecutableClosures).padStart(3)}/${summary.officialSemanticExecutables}`);
  console.log(`  exact field obligations:    ${summary.exactFieldObligations}/${summary.verifierChecks}`);
  console.log(`  selector extraction batch:  ${summary.selectorExtractionBatches} (${summary.selectorExtractions} selectors)`);
  console.log(`  checked generators:         ${summary.generatorChecks}`);
}
