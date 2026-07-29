import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadOfficialSample,
  officialSampleDigest,
} from "./official-sample.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
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
const IDENTITY_FIELDS = [
  "vertexSpirvSha256",
  "fragmentSpirvSha256",
  "parameterEntrySha256",
  "commonBindingsSha256",
];

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    if (token === "--check") {
      result.check = true;
      continue;
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${token} requires a value`);
    result[token.slice(2)] = value;
    index += 1;
  }
  result["baseline-manifest"] ||= "build/official-samples/current.json";
  result["candidate-manifest"] ||= (
    process.env.PCR_OFFICIAL_CANDIDATE_MANIFEST
    || "build/official-samples/candidate.json"
  );
  const baseline = loadOfficialSample(result["baseline-manifest"]).sample;
  const candidate = loadOfficialSample(result["candidate-manifest"]).sample;
  const samplesRoot = path.resolve(
    process.env.PCR_OFFICIAL_SAMPLES_ROOT
      || path.join(DEFAULT_OUTPUT_ROOT, "samples"),
  );
  result.baseline ||= path.join(
    samplesRoot,
    baseline.sampleId,
    "material-program-inventory-full.json",
  );
  result.candidate ||= path.join(
    DEFAULT_OUTPUT_ROOT,
    "material-program-inventory-full.json",
  );
  result.out ||= path.join(
    ROOT,
    "build",
    "official-samples",
    `${candidate.sampleId.replace(/-candidate$/, "")}-shader-migration.json`,
  );
  return result;
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
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex");
}

function fileDigest(absolute) {
  return crypto.createHash("sha256").update(fs.readFileSync(absolute)).digest("hex");
}

function readInventory(absolute) {
  const inventory = JSON.parse(fs.readFileSync(absolute, "utf8"));
  if (inventory.schema !== "pocket-card-render/official-material-program-inventory@4"
      || inventory.schemaVersion !== 4
      || !inventory.proofGraph) {
    throw new Error(`${absolute} is not a full material/program inventory v4`);
  }
  return inventory;
}

function routeKey(route) {
  return JSON.stringify([
    route.shaderName,
    [...route.keywords].sort(),
    route.subshader,
    route.pass,
  ]);
}

function inventoryRoutes(inventory) {
  const graph = inventory.proofGraph;
  const shaderNames = new Map(
    graph.shaders.map((shader) => [shader.identity, shader.name]),
  );
  const result = new Map();
  for (const selector of graph.selectors) {
    for (const item of selector.staticExecutables || []) {
      const executable = item.executable;
      const route = {
        shaderName: shaderNames.get(selector.shaderIdentity),
        keywords: [...(selector.keywords || [])].sort(),
        subshader: item.subshader,
        pass: item.pass,
        selectionMode: selector.selectionMode,
        selectorId: selector.selectorId,
        candidateWitnessId: item.candidateWitnessId,
        identityFields: executable.identityFields,
        passContract: executable.pass.contract,
      };
      if (!route.shaderName) throw new Error("selector references an unknown Shader");
      const key = routeKey(route);
      if (result.has(key)) throw new Error(`duplicate semantic route ${key}`);
      result.set(key, route);
    }
  }
  return result;
}

function normalizedRenderState(contract) {
  const normalized = structuredClone(contract);
  // These fields select/identify compiled programs. They are covered by the
  // stage-program obligation and are not blend/depth/stencil/cull state.
  delete normalized.platforms;
  if (normalized.state) delete normalized.state.gpuProgramID;
  return normalized;
}

function routeIdentity(route) {
  return {
    shaderName: route.shaderName,
    keywords: route.keywords,
    subshader: route.subshader,
    pass: route.pass,
  };
}

function compareRoutes(baseline, candidate) {
  const baselineRoutes = inventoryRoutes(baseline);
  const candidateRoutes = inventoryRoutes(candidate);
  const unchanged = [];
  const changed = [];
  const removed = [];
  const added = [];
  const fieldMatches = Object.fromEntries(
    [...IDENTITY_FIELDS, "renderState"].map((field) => [field, 0]),
  );

  for (const [key, before] of baselineRoutes) {
    const after = candidateRoutes.get(key);
    if (!after) {
      removed.push({
        ...routeIdentity(before),
        baselineSelectionMode: before.selectionMode,
      });
      continue;
    }
    const changedFields = IDENTITY_FIELDS.filter(
      (field) => before.identityFields[field] !== after.identityFields[field],
    );
    for (const field of IDENTITY_FIELDS) {
      if (!changedFields.includes(field)) fieldMatches[field] += 1;
    }
    const beforeState = canonicalDigest(normalizedRenderState(before.passContract));
    const afterState = canonicalDigest(normalizedRenderState(after.passContract));
    if (beforeState === afterState) fieldMatches.renderState += 1;
    else changedFields.push("renderState");

    const row = {
      ...routeIdentity(before),
      baselineSelectorId: before.selectorId,
      candidateSelectorId: after.selectorId,
      baselineCandidateWitnessId: before.candidateWitnessId,
      candidateCandidateWitnessId: after.candidateWitnessId,
    };
    if (changedFields.length === 0) {
      unchanged.push(row);
    } else {
      changed.push({
        ...row,
        changedFields,
        before: Object.fromEntries(changedFields.map((field) => [
          field,
          field === "renderState"
            ? beforeState
            : before.identityFields[field],
        ])),
        after: Object.fromEntries(changedFields.map((field) => [
          field,
          field === "renderState"
            ? afterState
            : after.identityFields[field],
        ])),
      });
    }
  }
  for (const [key, route] of candidateRoutes) {
    if (!baselineRoutes.has(key)) added.push(routeIdentity(route));
  }
  const sortRows = (left, right) => routeKey(left).localeCompare(routeKey(right));
  unchanged.sort(sortRows);
  changed.sort(sortRows);
  removed.sort(sortRows);
  added.sort(sortRows);
  return {
    baselineRoutes: baselineRoutes.size,
    candidateRoutes: candidateRoutes.size,
    commonRoutes: unchanged.length + changed.length,
    staticPortReuseCandidates: unchanged.length,
    changedRoutes: changed.length,
    removedRoutes: removed.length,
    addedRoutes: added.length,
    fieldMatches,
    unchanged,
    changed,
    removed,
    added,
  };
}

function verifyInventoryBinding(inventory, sample, label) {
  const expected = sample.proofSets.materialPrograms;
  if (inventory.unityVersion !== sample.unity.serializedVersion
      || inventory.digests.proofGraphSha256 !== expected.proofGraphSha256
      || inventory.digests.portIndexSha256 !== expected.portIndexSha256) {
    throw new Error(`${label} inventory is not bound to its sample manifest`);
  }
}

const args = parseArgs(process.argv.slice(2));
const baselinePath = path.resolve(ROOT, args.baseline);
const candidatePath = path.resolve(ROOT, args.candidate);
const baselineLoaded = loadOfficialSample(args["baseline-manifest"]);
const candidateLoaded = loadOfficialSample(args["candidate-manifest"]);
const baseline = readInventory(baselinePath);
const candidate = readInventory(candidatePath);
verifyInventoryBinding(baseline, baselineLoaded.sample, "baseline");
verifyInventoryBinding(candidate, candidateLoaded.sample, "candidate");
const comparison = compareRoutes(baseline, candidate);
const report = {
  schema: "pocket-card-render/official-program-migration-diff@1",
  schemaVersion: 1,
  definition: {
    routeKey: "Shader name + sorted keywords + subshader + pass",
    staticPortReuseCandidate: (
      "matching vertex SPIR-V, fragment SPIR-V, parameter entry, common "
      + "bindings, and normalized render state"
    ),
    normalizedRenderStateExcludes: [
      "pass.platforms (compiled-program platform route)",
      "pass.state.gpuProgramID (compiled-program identifier)",
    ],
    limitation: (
      "static reuse does not transfer native variant selection, engine defaults, "
      + "guest dispatch/bindings, backend semantics, or runtime capture"
    ),
  },
  baseline: {
    sampleId: baselineLoaded.sample.sampleId,
    sampleManifestSha256: officialSampleDigest(baselineLoaded.sample),
    inventorySha256: fileDigest(baselinePath),
    proofGraphSha256: baseline.digests.proofGraphSha256,
    portIndexSha256: baseline.digests.portIndexSha256,
  },
  candidate: {
    sampleId: candidateLoaded.sample.sampleId,
    sampleManifestSha256: officialSampleDigest(candidateLoaded.sample),
    inventorySha256: fileDigest(candidatePath),
    proofGraphSha256: candidate.digests.proofGraphSha256,
    portIndexSha256: candidate.digests.portIndexSha256,
  },
  summary: Object.fromEntries(
    Object.entries(comparison).filter(([, value]) => typeof value === "number"
      || (value && !Array.isArray(value) && typeof value === "object")),
  ),
  routes: {
    staticPortReuseCandidates: comparison.unchanged,
    changed: comparison.changed,
    removed: comparison.removed,
    added: comparison.added,
  },
};
const out = path.resolve(ROOT, args.out);
const serialized = `${JSON.stringify(report, null, 2)}\n`;
if (args.check) {
  if (!fs.existsSync(out) || fs.readFileSync(out, "utf8") !== serialized) {
    throw new Error(`official program migration report is stale: ${out}`);
  }
} else {
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, serialized);
}
console.log(`Official program migration diff: ${report.baseline.sampleId}`);
console.log(`  -> ${report.candidate.sampleId}`);
console.log(
  `  static reuse candidates: ${comparison.staticPortReuseCandidates}`
  + `/${comparison.commonRoutes}`,
);
console.log(`  changed routes:          ${comparison.changedRoutes}`);
console.log(`  removed / added:         ${comparison.removedRoutes} / ${comparison.addedRoutes}`);
console.log(
  `  ${args.check ? "verified" : "wrote"}:`
  + `                ${path.relative(ROOT, out).replaceAll("\\", "/")}`,
);
