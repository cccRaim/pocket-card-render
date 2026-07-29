#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  loadOfficialSample,
  officialSampleDigest,
} from "./official-sample.mjs";
import { SHADER } from "../public/render/rarities.js";
import {
  compileRuntimeMaterialDispatch,
  RUNTIME_MATERIAL_DISPATCH_SCHEMA,
} from "../public/render/runtime-dispatch-contract.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT_ROOT = path.resolve(
  process.env.PCR_CANDIDATE_OUTPUT_ROOT
    || path.join(
      ROOT,
      "..",
      "ptcgp-tools-master",
      "masterdata_decoder",
      ".output-full",
    ),
);
const PORT_ROOT = path.resolve(
  process.env.PCR_CANDIDATE_PORT_ROOT
    || path.join(OUTPUT_ROOT, "webgl-ports"),
);
const INVENTORY = path.resolve(
  process.env.PCR_CANDIDATE_MATERIAL_INVENTORY
    || path.join(OUTPUT_ROOT, "material-program-inventory-full.json"),
);
const SAMPLE_POINTER = path.resolve(
  process.env.PCR_OFFICIAL_CANDIDATE_MANIFEST
    || path.join(ROOT, "build", "official-samples", "candidate.json"),
);
const CHECK = process.argv.includes("--check");
const loaded = loadOfficialSample(SAMPLE_POINTER);
const sample = loaded.sample;
if (sample.status !== "candidate") {
  throw new Error("candidate port contract requires a status:candidate sample");
}
const sampleManifestSha256 = officialSampleDigest(sample);
const candidateStem = sample.sampleId.replace(/-candidate$/, "");
const OUTPUT = path.join(
  ROOT,
  "build",
  "official-samples",
  `${candidateStem}-program-port-contract.json`,
);

const OBLIGATIONS = Object.freeze({
  stageProgram: {
    scope: "semantic-executable",
    verifier: "build/verify-official-port-stage-program.mjs",
  },
  parameterEntry: {
    scope: "semantic-executable",
    verifier: "build/verify-official-port-parameter-entry.mjs",
  },
  passState: {
    scope: "selector-local-port",
    verifier: "build/verify-official-port-pass-state.mjs",
  },
  commonBindings: {
    scope: "semantic-executable",
    verifier: "build/verify-official-port-common-bindings.mjs",
  },
  runtimeDispatch: {
    scope: "local-port-dispatch",
    verifier: "build/verify-official-port-runtime-dispatch.mjs",
  },
});

function readJson(filename) {
  return JSON.parse(fs.readFileSync(filename, "utf8"));
}

function sha256File(filename) {
  return crypto
    .createHash("sha256")
    .update(fs.readFileSync(filename))
    .digest("hex");
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

function equal(left, right) {
  return JSON.stringify(canonicalize(left))
    === JSON.stringify(canonicalize(right));
}

function routeKey(row) {
  return [
    row.selectorId,
    row.candidateWitnessId,
    row.subshader,
    row.pass,
  ].join(":");
}

function walk(directory) {
  if (!fs.statSync(directory, { throwIfNoEntry: false })?.isDirectory()) {
    return [];
  }
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walk(target));
    else if (entry.isFile() && entry.name.endsWith("_uniforms.json")) {
      files.push(target);
    }
  }
  return files;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertNoAbsolutePaths(value, label) {
  const encoded = JSON.stringify(value);
  assert(
    !/(?:[A-Za-z]:\\|[A-Za-z]:\/|\/Users\/)/.test(encoded),
    `${label} leaks a local absolute path`,
  );
}

function shaderKey(shaderName) {
  return String(shaderName || "").split("/").at(-1);
}

function shaderNameMatches(officialName, manifestName) {
  return officialName === manifestName
    || officialName.endsWith(`/${manifestName}`);
}

function runtimeDispatchFor(row) {
  const key = shaderKey(row.shaderName);
  const route = SHADER[key];
  const implemented = route && route.defer !== true;
  return compileRuntimeMaterialDispatch({
    support: implemented ? "implemented" : route ? "deferred" : "unsupported",
    shaderKey: key,
    strategy: implemented ? route.kind : null,
    blend: implemented ? route.blend : null,
    defer: !implemented,
    materialBlend: route?.materialBlend === true,
    materialCull: route?.materialCull === true,
    ...(route?.alphaTest === undefined ? {} : { alphaTest: route.alphaTest }),
    ...(route?.cull === undefined ? {} : { cull: route.cull }),
    capabilities: route?.capabilities || {},
  }, `candidate inventory selector ${row.selectorId}`);
}

function resolveSourceFile(manifestFile, logicalPath) {
  const basename = path.basename(logicalPath);
  const sibling = path.join(path.dirname(manifestFile), basename);
  if (fs.statSync(sibling, { throwIfNoEntry: false })?.isFile()) return sibling;
  const repository = path.resolve(ROOT, logicalPath);
  if (fs.statSync(repository, { throwIfNoEntry: false })?.isFile()) {
    return repository;
  }
  throw new Error(
    `${path.basename(manifestFile)} cannot resolve WebGL source ${logicalPath}`,
  );
}

const inventory = readJson(INVENTORY);
assert(
  inventory.schema === sample.proofSets.materialPrograms.inventorySchema
    && inventory.schemaVersion === 4,
  "candidate material/program inventory schema changed",
);
assert(
  sha256File(INVENTORY)
    === sample.proofSets.materialPrograms.inventorySha256,
  "candidate material/program inventory file identity changed",
);
assert(
  inventory.digests.proofGraphSha256
    === sample.proofSets.materialPrograms.proofGraphSha256
    && inventory.digests.portIndexSha256
      === sample.proofSets.materialPrograms.portIndexSha256,
  "candidate material/program proof roots changed",
);
const formalRows = inventory.portIndex
  .filter((row) => row.runtimeEngineVariantBoundary !== true);
const runtimeRows = inventory.portIndex
  .filter((row) => row.runtimeEngineVariantBoundary === true);
assert(formalRows.length === 78, `expected 78 formal ports, got ${formalRows.length}`);
assert(runtimeRows.length === 1, `expected 1 runtime boundary, got ${runtimeRows.length}`);
const expected = new Map(formalRows.map((row) => [routeKey(row), row]));
assert(expected.size === formalRows.length, "candidate formal port identities collide");

const matched = new Map();
for (const filename of walk(PORT_ROOT)) {
  const manifest = readJson(filename);
  if (manifest.official_sample?.sampleId !== sample.sampleId) continue;
  assertNoAbsolutePaths(manifest, path.relative(PORT_ROOT, filename));
  const selector = manifest.official_selector;
  assert(selector, `${filename} has no official_selector`);
  const key = routeKey(selector);
  const row = expected.get(key);
  assert(row, `${filename} does not match a candidate formal port`);
  assert(!matched.has(key), `${filename} duplicates candidate port ${key}`);
  assert(
    manifest.official_sample.sampleManifestSha256 === sampleManifestSha256
      && manifest.official_sample.unityVersion
        === sample.unity.serializedVersion
      && manifest.official_sample.status === "candidate",
    `${filename} has stale candidate sample provenance`,
  );
  assert(
    manifest.official_inventory?.schema === inventory.schema
      && manifest.official_inventory?.proofGraphSha256
        === inventory.digests.proofGraphSha256
      && manifest.official_inventory?.portIndexSha256
        === inventory.digests.portIndexSha256,
    `${filename} has stale candidate inventory provenance`,
  );
  assert(
    shaderNameMatches(row.shaderName, manifest.shader)
      && equal(manifest.selected_keywords || [], row.keywords),
    `${filename} Shader/keyword route changed`,
  );
  assert(
    selector.executableId === row.executableId
      && selector.semanticExecutableId === row.semanticExecutableId,
    `${filename} executable identity changed`,
  );
  assert(
    equal(manifest.official_executable_identity, row.identityFields),
    `${filename} official identity fields changed`,
  );
  assert(
    manifest.official_spirv_sha256?.vertex
      === row.identityFields.vertexSpirvSha256
      && manifest.official_spirv_sha256?.fragment
        === row.identityFields.fragmentSpirvSha256,
    `${filename} SPIR-V identity changed`,
  );
  assert(
    manifest.official_parameter_entry?.source_sha256
      === row.identityFields.parameterEntrySha256
      && manifest.official_pass_runtime?.source_sha256
        === row.identityFields.passStateSha256
      && manifest.official_common_bindings?.source_sha256
        === row.identityFields.commonBindingsSha256,
    `${filename} parameter/pass/common source identity changed`,
  );
  assert(
    manifest.official_vertex_inputs?.unityVersion
      === sample.unity.serializedVersion,
    `${filename} vertex-input contract is not candidate-bound`,
  );
  for (const stage of ["vertex", "fragment"]) {
    const sourceFile = resolveSourceFile(
      filename,
      manifest.webgl_sources?.[stage],
    );
    assert(
      sha256File(sourceFile)
        === manifest.webgl_adaptation?.[stage]?.outputSha256,
      `${filename} ${stage} WebGL source drifted`,
    );
  }
  matched.set(key, {
    selectorId: row.selectorId,
    candidateWitnessId: row.candidateWitnessId,
    subshader: row.subshader,
    pass: row.pass,
    semanticExecutableId: row.semanticExecutableId,
    manifest: (
      `candidate-port:${path.relative(PORT_ROOT, filename).replaceAll("\\", "/")}`
    ),
    manifestSha256: sha256File(filename),
    generator: manifest.generated_by,
    officialIdentityFields: row.identityFields,
    obligations: OBLIGATIONS,
  });
}

const missing = [...expected.keys()].filter((key) => !matched.has(key));
assert(
  missing.length === 0,
  `candidate formal port manifests are incomplete: ${missing.length} missing`,
);
const ports = [...matched.values()]
  .sort((left, right) => routeKey(left).localeCompare(routeKey(right)));
const runtimeBound = runtimeRows.map((row) => ({
  selectorId: row.selectorId,
  candidateWitnessId: row.candidateWitnessId,
  subshader: row.subshader,
  pass: row.pass,
  shaderIdentity: row.shaderIdentity,
  shaderName: row.shaderName,
  keywords: row.keywords,
  boundary: "engine-owned runtime variant",
}));
const contract = {
  schema: "pocket-card-render/candidate-program-port-contract@1",
  schemaVersion: 1,
  generatedBy: "build/build-candidate-program-port-contract.mjs",
  scope: {
    migrationOnly: true,
    runtimeEvidence: false,
    backendSemanticEquivalence: false,
    officialShaderRestorationPercent: null,
  },
  provenance: {
    sampleId: sample.sampleId,
    sampleManifestSha256,
  },
  inventory: {
    schema: inventory.schema,
    inventorySha256: sha256File(INVENTORY),
    proofGraphSha256: inventory.digests.proofGraphSha256,
    portIndexSha256: inventory.digests.portIndexSha256,
  },
  summary: {
    inventoryRoutes: inventory.portIndex.length,
    formalPorts: ports.length,
    runtimeBound: runtimeBound.length,
  },
  ports,
  runtimeBound,
  runtimeDispatch: {
    schema: RUNTIME_MATERIAL_DISPATCH_SCHEMA,
    routes: inventory.portIndex.map((row) => ({
      selectorId: row.selectorId,
      candidateWitnessId: row.candidateWitnessId,
      semanticExecutableId: row.semanticExecutableId,
      shaderIdentity: row.shaderIdentity,
      keywords: row.keywords,
      selectionMode: row.selectionMode,
      runtimeEngineVariantBoundary: row.runtimeEngineVariantBoundary,
      subshader: row.subshader,
      pass: row.pass,
      dispatch: runtimeDispatchFor(row),
    })),
  },
};
const encoded = `${JSON.stringify(contract, null, 2)}\n`;
if (CHECK) {
  assert(
    fs.statSync(OUTPUT, { throwIfNoEntry: false })?.isFile()
      && fs.readFileSync(OUTPUT, "utf8") === encoded,
    "candidate program port contract is absent or stale",
  );
  console.log(
    `Candidate program port contract OK: ${ports.length} formal`
    + ` + ${runtimeBound.length} runtime-bound`,
  );
} else {
  fs.writeFileSync(OUTPUT, encoded);
  console.log(
    `Wrote ${path.relative(ROOT, OUTPUT).replaceAll("\\", "/")}:`
    + ` ${ports.length} formal + ${runtimeBound.length} runtime-bound`,
  );
}
