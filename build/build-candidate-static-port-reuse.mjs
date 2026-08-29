#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { fileURLToPath } from "node:url";
import {
  buildOfficialSpirvPrecisionEvidence,
  canonicalJsonSha256,
  compileCommonBindings,
  compileOfficialPassContract,
  compileOfficialVertexInputContract,
  compileProgramBindings,
  joinProgramConstantBufferStages,
  joinProgramSamplerBindings,
  runCommand,
  sha256,
  sha256File,
  withExtractedSelectorProgram,
} from "./exact-selector-port-core.mjs";
import { buildWebglAdaptationV2 } from "./webgl-adaptation-contract.mjs";
import {
  loadOfficialSample,
  officialSampleDigest,
} from "./official-sample.mjs";
import {
  createStagingDirectorySync,
  publishDirectorySync,
} from "./atomic-publish.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BUILD = path.join(ROOT, "build");
const OFFICIAL_SAMPLES = path.join(BUILD, "official-samples");
const OUTPUT_FULL = path.resolve(
  process.env.PCR_OUTPUT_FULL
    || path.join(ROOT, "..", "ptcgp-tools-master", "masterdata_decoder", ".output-full"),
);
const CANDIDATE_POINTER = path.resolve(
  process.env.PCR_OFFICIAL_CANDIDATE_MANIFEST
    || path.join(OFFICIAL_SAMPLES, "candidate.json"),
);
const BASELINE_POINTER = path.resolve(
  process.env.PCR_OFFICIAL_SAMPLE_MANIFEST
    || path.join(OFFICIAL_SAMPLES, "current.json"),
);
const BASELINE_CONTRACT = path.resolve(
  process.env.PCR_BASELINE_PORT_CONTRACT
    || path.join(ROOT, "public", "shaders", "official_program_port_contract.json"),
);
const CANDIDATE_INVENTORY = path.resolve(
  process.env.PCR_CANDIDATE_FULL_INVENTORY
    || path.join(OUTPUT_FULL, "material-program-inventory-full.json"),
);
const OUTPUT_DIR = path.resolve(
  process.env.PCR_CANDIDATE_STATIC_REUSE_ROOT
    || path.join(OUTPUT_FULL, "webgl-ports", "static-reuse"),
);
const CHECK = process.argv.includes("--check");
const HASH = /^[0-9a-f]{64}$/;
const FORMAL_OFFICIAL_FIELDS = new Set([
  "selected_keywords",
  "official_selector",
  "official_sample",
  "official_inventory",
  "official_spirv_sha256",
  "official_spirv_precision",
  "official_executable_identity",
  "official_parameter_entry",
  "official_pass_runtime",
  "official_common_bindings",
  "official_program_bindings",
  "official_vertex_inputs",
  "official_shader_property_defaults",
  "sampler_bindings",
  "samplers",
  "sampler_slots",
  "compiled_texture_bindings",
  "implicit_defaults",
]);
const LOCAL_REUSE_FIELDS = Object.freeze([
  "webgl_sources",
  "runtime_contract",
  "mrt",
  "runtime_boundaries",
  "vertex_fields",
  "fragment_fields",
  "floats",
  "colors",
  "compiled_property_aliases",
  "backend_uniform_evidence",
  "backend_numeric_transport",
]);
const REQUIRED_STATIC_MATCHES = Object.freeze([
  "parameterReflectionSame",
  "commonBindingsSame",
  "programBindChannelsSame",
  "programBindChannelListSame",
  "shaderPropertyDefaultsSame",
]);

function fail(message) {
  throw new Error(`candidate static-port reuse: ${message}`);
}

function readJson(file, label) {
  if (!fs.statSync(file, { throwIfNoEntry: false })?.isFile()) {
    fail(`${label} is absent: ${file}`);
  }
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    fail(`${label} is invalid JSON: ${error.message}`);
  }
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function assertHash(value, label) {
  assert(typeof value === "string" && HASH.test(value), `${label} is not a SHA-256`);
  return value;
}

function same(actual, expected, label) {
  if (!isDeepStrictEqual(actual, expected)) fail(`${label} changed`);
}

function routeKey(route, side) {
  return JSON.stringify([
    route[`${side}SelectorId`],
    route[`${side}CandidateWitnessId`],
    route.subshader,
    route.pass,
  ]);
}

function portKey(port) {
  return JSON.stringify([
    port.selectorId,
    port.candidateWitnessId,
    port.subshader,
    port.pass,
  ]);
}

function routeSummary(route) {
  return {
    shaderName: route.shaderName,
    keywords: route.keywords,
    subshader: route.subshader,
    pass: route.pass,
    selectorId: route.candidateSelectorId,
    candidateWitnessId: route.candidateCandidateWitnessId,
  };
}

function withoutKeys(value, keys) {
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => !keys.includes(key)),
  );
}

function parameterReflectionFromManifest(manifest) {
  return withoutKeys(manifest.official_parameter_entry, [
    "source_sha256",
    "byte_size",
    "reflection_sha256",
  ]);
}

function commonBindingsFromManifest(manifest) {
  return withoutKeys(manifest.official_common_bindings, ["source_sha256"]);
}

function programBindingsFromManifest(manifest) {
  return withoutKeys(manifest.official_program_bindings, [
    "common_source_sha256",
    "parameter_reflection_sha256",
  ]);
}

function normalizedVertexInputs(value) {
  return withoutKeys(value, ["unityVersion"]);
}

function derivePassPolicy(manifest) {
  const pass = manifest.official_pass_runtime;
  assert(pass && typeof pass === "object", "baseline official_pass_runtime is absent");
  assert(typeof pass.shared_mrt_blend === "boolean", "baseline shared_mrt_blend is invalid");
  assert(pass.fixed && typeof pass.fixed === "object", "baseline fixed pass state is absent");
  return {
    rtSeparateBlend: !pass.shared_mrt_blend,
    fixed: pass.fixed,
  };
}

function buildProgramBindings(metadata, reflection, baselineManifest) {
  const common = compileCommonBindings(metadata.commonBindings);
  const direct = compileProgramBindings(
    common,
    metadata.parameterReflection,
    metadata.shaderPropertyDefaults,
  );
  const joined = joinProgramConstantBufferStages(direct, reflection);
  const expected = programBindingsFromManifest(baselineManifest);
  const candidates = [
    ["direct", direct],
    ["joined-stages", joined],
  ].filter(([, value]) => isDeepStrictEqual(value, expected));
  assert(
    candidates.length > 0,
    `${metadata.selector.shaderName}: candidate program bindings no longer reproduce baseline adaptation`,
  );
  return {
    mode: candidates[0][0],
    common,
    program: candidates[0][1],
  };
}

function localReuseFields(manifest) {
  const reused = {};
  for (const key of LOCAL_REUSE_FIELDS) {
    if (Object.hasOwn(manifest, key)) reused[key] = manifest[key];
  }
  return reused;
}

function validateLocalSource(manifest) {
  const adaptation = manifest.webgl_adaptation;
  assert(adaptation?.schema === "pocket-card-render/webgl-stage-adaptation@2",
    `${manifest.shader}: baseline webgl_adaptation is not typed v2`);
  for (const [stage, sourceKey] of [["vertex", "vertex"], ["fragment", "fragment"]]) {
    const logical = manifest.webgl_sources?.[sourceKey];
    assert(typeof logical === "string" && logical.length > 0,
      `${manifest.shader}: baseline ${sourceKey} WebGL source is absent`);
    const absolute = path.resolve(ROOT, logical);
    assert(absolute.startsWith(`${ROOT}${path.sep}`),
      `${manifest.shader}: WebGL source escapes the repository`);
    assert(fs.statSync(absolute, { throwIfNoEntry: false })?.isFile(),
      `${manifest.shader}: WebGL source is absent: ${logical}`);
    assert(
      sha256File(absolute) === adaptation[stage].outputSha256,
      `${manifest.shader}: ${stage} WebGL source drifted from baseline adaptation`,
    );
  }
}

function adaptationOperationsForRebind(operations) {
  const derivedEvidenceFields = new Set([
    "mappingSha256",
    "runtimeContractSha256",
    "bindingContractSha256",
    "producerContractSha256",
    "clockContractSha256",
    "basisContractSha256",
    "textureCoordinateContractSha256",
  ]);
  return operations.map((operation) => Object.fromEntries(
    Object.entries(operation).filter(([key]) => !derivedEvidenceFields.has(key)),
  ));
}

function rebuiltAdaptation(baselineManifest, metadata, reflection, files, officialProgramBindings) {
  validateLocalSource(baselineManifest);
  const baseline = baselineManifest.webgl_adaptation;
  const spirvCross = process.env.SPIRV_CROSS || "spirv-cross";
  const officialCross = {
    vertex: runCommand(spirvCross, [files.vertexSpirv, "--version", "300", "--es"], { cwd: ROOT }),
    fragment: runCommand(spirvCross, [files.fragmentSpirv, "--version", "300", "--es"], { cwd: ROOT }),
  };
  for (const stage of ["vertex", "fragment"]) {
    assert(
      sha256(officialCross[stage]) === baseline[stage].spirvCrossGlslSha256,
      `${metadata.selector.shaderName}: candidate ${stage} SPIRV-Cross source changed`,
    );
  }
  const vertexInputs = compileOfficialVertexInputContract(
    metadata.programBindChannels,
    reflection.vertex,
    metadata.unityVersion,
  );
  return buildWebglAdaptationV2({
    vertex: {
      officialSpirvSha256: sha256File(files.vertexSpirv),
      spirvCrossGlslSha256: sha256(officialCross.vertex),
      outputSha256: baseline.vertex.outputSha256,
      operations: adaptationOperationsForRebind(baseline.vertex.operations),
      substitutions: baseline.vertex.substitutions,
    },
    fragment: {
      officialSpirvSha256: sha256File(files.fragmentSpirv),
      spirvCrossGlslSha256: sha256(officialCross.fragment),
      outputSha256: baseline.fragment.outputSha256,
      operations: adaptationOperationsForRebind(baseline.fragment.operations),
      substitutions: baseline.fragment.substitutions,
    },
    interfaceSha256: canonicalJsonSha256({
      vertex: reflection.vertex,
      fragment: reflection.fragment,
    }),
    officialVertexInputs: vertexInputs,
    runtimeContract: baselineManifest.runtime_contract,
    officialProgramBindings,
  });
}

function validateAnalysisRoute(route) {
  assert(route.reuseEligible === true, `${route.shaderName}: route is not reuseEligible`);
  for (const key of REQUIRED_STATIC_MATCHES) {
    assert(
      route.structuredContracts?.[key] === true,
      `${route.shaderName}: analysis does not prove ${key}`,
    );
  }
}

function validateCandidateMetadata(route, portIndexRow, metadata) {
  const selector = metadata.selector;
  same(selector.selectorId, route.candidateSelectorId, `${route.shaderName}: selectorId`);
  same(
    selector.candidateWitnessId,
    route.candidateCandidateWitnessId,
    `${route.shaderName}: candidateWitnessId`,
  );
  same(selector.shaderName, route.shaderName, `${route.shaderName}: shader name`);
  same(selector.keywords, route.keywords, `${route.shaderName}: keywords`);
  same(selector.subshader, route.subshader, `${route.shaderName}: subshader`);
  same(selector.pass, route.pass, `${route.shaderName}: pass`);
  for (const key of [
    "selectorId",
    "candidateWitnessId",
    "shaderIdentity",
    "shaderName",
    "keywords",
    "selectionMode",
    "subshader",
    "pass",
    "executableId",
    "semanticExecutableId",
  ]) {
    same(selector[key], portIndexRow[key], `${route.shaderName}: candidate portIndex ${key}`);
  }
  same(
    metadata.identityFields,
    portIndexRow.identityFields,
    `${route.shaderName}: candidate executable identity`,
  );
}

function validateFormalReuse(route, baselineManifest, metadata, reflection) {
  same(metadata.identityFields.vertexSpirvSha256,
    baselineManifest.official_spirv_sha256.vertex,
    `${route.shaderName}: vertex SPIR-V`);
  same(metadata.identityFields.fragmentSpirvSha256,
    baselineManifest.official_spirv_sha256.fragment,
    `${route.shaderName}: fragment SPIR-V`);
  same(metadata.parameterReflection,
    parameterReflectionFromManifest(baselineManifest),
    `${route.shaderName}: parameter reflection`);
  const compiledCommon = compileCommonBindings(metadata.commonBindings);
  same(compiledCommon,
    commonBindingsFromManifest(baselineManifest),
    `${route.shaderName}: common bindings`);
  same(metadata.shaderPropertyDefaults,
    baselineManifest.official_shader_property_defaults,
    `${route.shaderName}: Shader property defaults`);
  const vertexInputs = compileOfficialVertexInputContract(
    metadata.programBindChannels,
    reflection.vertex,
    metadata.unityVersion,
  );
  same(
    normalizedVertexInputs(vertexInputs),
    normalizedVertexInputs(baselineManifest.official_vertex_inputs),
    `${route.shaderName}: program bind channels`,
  );
}

function buildFormalManifest({
  route,
  baselinePort,
  baselineManifest,
  metadata,
  files,
  reflection,
  officialSpirvPrecision,
  candidateSample,
  candidateSampleSha256,
  analysisSha256,
}) {
  validateFormalReuse(route, baselineManifest, metadata, reflection);
  const { mode, common, program } = buildProgramBindings(
    metadata,
    reflection,
    baselineManifest,
  );
  const officialProgramBindings = {
    common_source_sha256: metadata.identityFields.commonBindingsSha256,
    parameter_reflection_sha256: metadata.parameterReflectionSha256,
    ...program,
  };
  const samplerBindings = joinProgramSamplerBindings(program, reflection).map(({ set, ...binding }) => {
    assert(set === 0, `${route.shaderName}: candidate sampler ${binding.slot} uses set ${set}`);
    return binding;
  });
  same(samplerBindings, baselineManifest.sampler_bindings,
    `${route.shaderName}: sampler bindings`);
  const vertexInputs = compileOfficialVertexInputContract(
    metadata.programBindChannels,
    reflection.vertex,
    metadata.unityVersion,
  );
  const passRuntime = compileOfficialPassContract(metadata.passContract, {
    sourceSha256: metadata.identityFields.passStateSha256,
    policy: derivePassPolicy(baselineManifest),
  });
  const adaptation = rebuiltAdaptation(
    baselineManifest,
    metadata,
    reflection,
    files,
    officialProgramBindings,
  );
  const manifest = {
    shader: baselineManifest.shader,
    generated_by: "build/build-candidate-static-port-reuse.mjs",
    selected_keywords: metadata.selector.keywords,
    official_selector: metadata.selector,
    official_sample: {
      sampleId: candidateSample.sampleId,
      sampleManifestSha256: candidateSampleSha256,
      unityVersion: candidateSample.unity.serializedVersion,
      status: candidateSample.status,
    },
    official_inventory: metadata.inventory,
    official_spirv_sha256: {
      vertex: officialSpirvPrecision.stages.vertex.source_sha256,
      fragment: officialSpirvPrecision.stages.fragment.source_sha256,
    },
    official_spirv_precision: officialSpirvPrecision,
    official_executable_identity: metadata.identityFields,
    official_parameter_entry: {
      source_sha256: metadata.identityFields.parameterEntrySha256,
      byte_size: metadata.artifacts.parameterEntry.byteSize,
      reflection_sha256: metadata.parameterReflectionSha256,
      ...metadata.parameterReflection,
    },
    official_pass_runtime: passRuntime,
    official_common_bindings: {
      source_sha256: metadata.identityFields.commonBindingsSha256,
      ...common,
    },
    official_program_bindings: officialProgramBindings,
    official_vertex_inputs: vertexInputs,
    official_shader_property_defaults: metadata.shaderPropertyDefaults,
    webgl_adaptation: adaptation,
    ...localReuseFields(baselineManifest),
    sampler_bindings: samplerBindings,
    samplers: samplerBindings.map((binding) => binding.spirvName),
    sampler_slots: samplerBindings.map((binding) => binding.slot),
    compiled_texture_bindings: Object.fromEntries(
      samplerBindings.map((binding) => [binding.slot, binding.binding]),
    ),
    implicit_defaults: metadata.shaderPropertyDefaults.textures,
    candidate_static_reuse: {
      schema: "pocket-card-render/candidate-static-port-reuse@1",
      analysisSha256,
      baselineManifest: baselinePort.manifest,
      baselineGenerator: baselinePort.generator,
      programBindingAdaptation: mode,
      staticContractsRevalidated: [...REQUIRED_STATIC_MATCHES],
      runtimeFidelity: false,
      backendSemanticEquivalence: false,
    },
  };
  for (const key of FORMAL_OFFICIAL_FIELDS) {
    assert(Object.hasOwn(manifest, key), `${route.shaderName}: rebuilt field ${key} is absent`);
  }
  const serialized = `${JSON.stringify(manifest, null, 2)}\n`;
  assert(
    !/(?:[A-Za-z]:\\|[A-Za-z]:\/|\/Users\/)/.test(serialized),
    `${route.shaderName}: generated manifest leaked an absolute path`,
  );
  return serialized;
}

function outputNameForPort(port) {
  const name = path.basename(port.manifest);
  assert(name.endsWith(".json"), `${port.manifest}: baseline manifest is not JSON`);
  return name;
}

function writeOrCheck(outputs) {
  const expectedNames = [...outputs.keys()].sort();
  if (CHECK) {
    assert(fs.statSync(OUTPUT_DIR, { throwIfNoEntry: false })?.isDirectory(),
      `check output directory is absent: ${OUTPUT_DIR}`);
    const actualNames = fs.readdirSync(OUTPUT_DIR)
      .filter((name) => name.endsWith(".json"))
      .sort();
    same(actualNames, expectedNames, "static-reuse output file set");
    for (const [name, bytes] of outputs) {
      const target = path.join(OUTPUT_DIR, name);
      assert(fs.readFileSync(target).equals(bytes), `${name} drifted`);
    }
    return;
  }
  const staging = createStagingDirectorySync(OUTPUT_DIR);
  for (const [name, bytes] of outputs) {
    fs.writeFileSync(path.join(staging, name), bytes);
  }
  publishDirectorySync(staging, OUTPUT_DIR);
}

const candidateLoaded = loadOfficialSample(CANDIDATE_POINTER);
const baselineLoaded = loadOfficialSample(BASELINE_POINTER);
const candidateSample = candidateLoaded.sample;
const baselineSample = baselineLoaded.sample;
assert(candidateSample.status === "candidate", "candidate pointer did not resolve a candidate sample");
assert(baselineSample.status !== "candidate", "baseline pointer resolved a candidate sample");
const candidateSampleSha256 = officialSampleDigest(candidateSample);
const baselineSampleSha256 = officialSampleDigest(baselineSample);
const candidateStem = candidateSample.sampleId.replace(/-candidate$/, "");
const analysisFile = path.join(OFFICIAL_SAMPLES, `${candidateStem}-shader-analysis.json`);
const analysis = readJson(analysisFile, "candidate shader analysis");
const analysisSha256 = sha256File(analysisFile);
const inventory = readJson(CANDIDATE_INVENTORY, "candidate full inventory");
const inventorySha256 = sha256File(CANDIDATE_INVENTORY);
const contract = readJson(BASELINE_CONTRACT, "baseline port contract");

same(analysis.candidateSampleId, candidateSample.sampleId, "analysis candidate sample");
same(analysis.baselineSampleId, baselineSample.sampleId, "analysis baseline sample");
same(analysis.candidateInventorySha256, inventorySha256, "analysis candidate inventory hash");
same(
  candidateSample.proofSets.materialPrograms.inventorySha256,
  inventorySha256,
  "candidate manifest inventory hash",
);
same(inventory.unityVersion, candidateSample.unity.serializedVersion, "candidate inventory Unity version");
same(
  inventory.digests.proofGraphSha256,
  candidateSample.proofSets.materialPrograms.proofGraphSha256,
  "candidate proof graph",
);
same(
  inventory.digests.portIndexSha256,
  candidateSample.proofSets.materialPrograms.portIndexSha256,
  "candidate port index",
);
same(contract.provenance, {
  sampleId: baselineSample.sampleId,
  sampleManifestSha256: baselineSampleSha256,
}, "baseline contract provenance");

const reuseRoutes = analysis.staticReuseValidation.filter((route) => route.reuseEligible === true);
same(reuseRoutes.length, 69, "reuseEligible route denominator");
same(analysis.summary.staticReuseValidated, reuseRoutes.length, "analysis reuse denominator");
same(analysis.summary.staticReuseRejected, 1, "default-sensitive rejected denominator");
same(analysis.summary.changedRoutes, 9, "changed route denominator");
for (const route of reuseRoutes) validateAnalysisRoute(route);

const candidatePortByKey = new Map(inventory.portIndex.map((port) => [portKey(port), port]));
assert(candidatePortByKey.size === inventory.portIndex.length, "candidate portIndex has duplicate identities");
const classified = reuseRoutes.map((route) => {
  const candidatePort = candidatePortByKey.get(routeKey(route, "candidate"));
  assert(candidatePort, `${route.shaderName}: candidate portIndex row is absent`);
  assert(
    typeof candidatePort.runtimeEngineVariantBoundary === "boolean",
    `${route.shaderName}: runtimeEngineVariantBoundary is not boolean`,
  );
  return { route, candidatePort };
});
const formalRoutes = classified.filter(({ candidatePort }) => !candidatePort.runtimeEngineVariantBoundary);
const runtimeBoundaries = classified.filter(({ candidatePort }) => candidatePort.runtimeEngineVariantBoundary);
same(formalRoutes.length, 68, "formal static-reuse denominator");
same(runtimeBoundaries.length, 1, "engine-owned runtime boundary denominator");

const baselinePortByKey = new Map(contract.ports.map((port) => [portKey(port), port]));
assert(baselinePortByKey.size === contract.ports.length, "baseline contract has duplicate formal ports");
const outputNames = new Set();
for (const item of formalRoutes) {
  const baselinePort = baselinePortByKey.get(routeKey(item.route, "baseline"));
  assert(baselinePort, `${item.route.shaderName}: baseline formal port is absent`);
  item.baselinePort = baselinePort;
  item.baselineManifest = readJson(
    path.resolve(ROOT, baselinePort.manifest),
    `${item.route.shaderName} baseline manifest`,
  );
  same(item.baselineManifest.official_selector?.shaderName, item.route.shaderName,
    `${item.route.shaderName}: baseline official selector shader`);
  const outputName = outputNameForPort(baselinePort);
  assert(!outputNames.has(outputName), `${outputName}: duplicate static-reuse output name`);
  outputNames.add(outputName);
  item.outputName = outputName;
}

const baselineSampleRoot = path.resolve(
  process.env.PCR_BASELINE_SAMPLE_ROOT
    || path.join(
      process.env.PCR_OFFICIAL_SAMPLES_ROOT || path.join(OUTPUT_FULL, "samples"),
      baselineSample.sampleId,
    ),
);
const baselineInventoryFile = path.join(baselineSampleRoot, "material-program-inventory-full.json");
const baselineDecryptedRoot = fs.statSync(
  path.join(baselineSampleRoot, "decrypted-full"),
  { throwIfNoEntry: false },
)?.isDirectory()
  ? path.join(baselineSampleRoot, "decrypted-full")
  : path.join(baselineSampleRoot, "decrypted");
const candidateDecryptedRoot = path.resolve(
  process.env.PCR_CANDIDATE_DECRYPTED_ROOT || inventory.source.decryptedRoot,
);
assert(
  fs.statSync(candidateDecryptedRoot, { throwIfNoEntry: false })?.isDirectory(),
  "candidate decrypted root is absent",
);

const expectedInventory = {
  schema: inventory.schema,
  proofGraphSha256: inventory.digests.proofGraphSha256,
  portIndexSha256: inventory.digests.portIndexSha256,
};
const outputs = new Map();
const formalSummary = [];
const boundarySummary = [];

for (const [index, item] of classified.entries()) {
  const { route, candidatePort } = item;
  process.stdout.write(
    `[${String(index + 1).padStart(2, "0")}/${classified.length}] `
    + `${candidatePort.runtimeEngineVariantBoundary ? "runtime-boundary" : "formal"} `
    + `${route.shaderName} [${route.keywords.join(",")}]\n`,
  );
  await withExtractedSelectorProgram({
    selectorId: route.candidateSelectorId,
    candidateWitnessId: route.candidateCandidateWitnessId,
    expectedProofGraphSha256: inventory.digests.proofGraphSha256,
    expectedPortIndexSha256: inventory.digests.portIndexSha256,
    prefix: `candidate-static-reuse-${String(index).padStart(2, "0")}`,
    decryptedRoot: candidateDecryptedRoot,
    inventory: CANDIDATE_INVENTORY,
    unityVersion: candidateSample.unity.serializedVersion,
  }, async ({ metadata, files, reflection, officialSpirvPrecision }) => {
    same(metadata.inventory, expectedInventory, `${route.shaderName}: extracted inventory`);
    validateCandidateMetadata(route, candidatePort, metadata);
    if (candidatePort.runtimeEngineVariantBoundary) {
      assert(
        fs.statSync(baselineInventoryFile, { throwIfNoEntry: false })?.isFile(),
        "baseline full inventory is required to validate the runtime boundary",
      );
      await withExtractedSelectorProgram({
        selectorId: route.baselineSelectorId,
        candidateWitnessId: route.baselineCandidateWitnessId,
        expectedProofGraphSha256: contract.inventory.proofGraphSha256,
        expectedPortIndexSha256: contract.inventory.portIndexSha256,
        prefix: "baseline-runtime-boundary",
        decryptedRoot: baselineDecryptedRoot,
        inventory: baselineInventoryFile,
        unityVersion: baselineSample.unity.serializedVersion,
      }, async ({ metadata: baselineMetadata }) => {
        same(metadata.identityFields.vertexSpirvSha256,
          baselineMetadata.identityFields.vertexSpirvSha256,
          `${route.shaderName}: runtime-boundary vertex SPIR-V`);
        same(metadata.identityFields.fragmentSpirvSha256,
          baselineMetadata.identityFields.fragmentSpirvSha256,
          `${route.shaderName}: runtime-boundary fragment SPIR-V`);
        same(metadata.parameterReflection,
          baselineMetadata.parameterReflection,
          `${route.shaderName}: runtime-boundary parameter reflection`);
        same(metadata.commonBindings,
          baselineMetadata.commonBindings,
          `${route.shaderName}: runtime-boundary common bindings`);
        same(metadata.shaderPropertyDefaults,
          baselineMetadata.shaderPropertyDefaults,
          `${route.shaderName}: runtime-boundary Shader defaults`);
        same(metadata.programBindChannels,
          baselineMetadata.programBindChannels,
          `${route.shaderName}: runtime-boundary program bind channels`);
      });
      boundarySummary.push({
        ...routeSummary(route),
        runtimeEngineVariantBoundary: true,
        disposition: "engine-owned-runtime-boundary-not-formal-manifest",
        officialExecutableIdentity: metadata.identityFields,
        parameterReflectionSha256: metadata.parameterReflectionSha256,
        programBindChannelsSha256: metadata.programBindChannels.sha256,
        shaderPropertyDefaultsSha256: canonicalJsonSha256(metadata.shaderPropertyDefaults),
      });
      return;
    }

    const serialized = buildFormalManifest({
      route,
      baselinePort: item.baselinePort,
      baselineManifest: item.baselineManifest,
      metadata,
      files,
      reflection,
      officialSpirvPrecision: officialSpirvPrecision
        || buildOfficialSpirvPrecisionEvidence({
          vertex: fs.readFileSync(files.vertexSpirv),
          fragment: fs.readFileSync(files.fragmentSpirv),
        }),
      candidateSample,
      candidateSampleSha256,
      analysisSha256,
    });
    outputs.set(item.outputName, Buffer.from(serialized));
    formalSummary.push({
      ...routeSummary(route),
      runtimeEngineVariantBoundary: false,
      manifest: item.outputName,
      manifestSha256: sha256(serialized),
      officialExecutableIdentity: metadata.identityFields,
      parameterReflectionSha256: metadata.parameterReflectionSha256,
      programBindChannelsSha256: metadata.programBindChannels.sha256,
      shaderPropertyDefaultsSha256: canonicalJsonSha256(metadata.shaderPropertyDefaults),
    });
  });
}

formalSummary.sort((left, right) => left.manifest.localeCompare(right.manifest));
boundarySummary.sort((left, right) => left.selectorId.localeCompare(right.selectorId));
const index = {
  schema: "pocket-card-render/candidate-static-port-reuse-index@1",
  generatedBy: "build/build-candidate-static-port-reuse.mjs",
  candidate: {
    sampleId: candidateSample.sampleId,
    sampleManifestSha256: candidateSampleSha256,
    unityVersion: candidateSample.unity.serializedVersion,
  },
  baseline: {
    sampleId: baselineSample.sampleId,
    sampleManifestSha256: baselineSampleSha256,
    portContractSha256: sha256File(BASELINE_CONTRACT),
  },
  evidence: {
    analysis: {
      logicalPath: path.relative(ROOT, analysisFile).replaceAll("\\", "/"),
      sha256: analysisSha256,
    },
    candidateInventory: {
      sha256: inventorySha256,
      proofGraphSha256: inventory.digests.proofGraphSha256,
      portIndexSha256: inventory.digests.portIndexSha256,
    },
  },
  denominator: {
    reuseEligibleRoutes: classified.length,
    formalStaticReusePorts: formalSummary.length,
    engineOwnedRuntimeBoundaries: boundarySummary.length,
    changedOrDefaultSensitiveFormalPorts:
      analysis.summary.changedRoutes + analysis.summary.staticReuseRejected,
    totalFormalCandidatePorts:
      formalSummary.length
      + analysis.summary.changedRoutes
      + analysis.summary.staticReuseRejected,
  },
  scope: {
    candidateOfficialBytesReextracted: true,
    baselineLocalWebglAdaptationReused: true,
    publicModified: false,
    runtimeFidelity: false,
    backendSemanticEquivalence: false,
  },
  formalPorts: formalSummary,
  runtimeEngineVariantBoundaries: boundarySummary,
};
same(index.denominator, {
  reuseEligibleRoutes: 69,
  formalStaticReusePorts: 68,
  engineOwnedRuntimeBoundaries: 1,
  changedOrDefaultSensitiveFormalPorts: 10,
  totalFormalCandidatePorts: 78,
}, "candidate formal-port denominator");
const indexText = `${JSON.stringify(index, null, 2)}\n`;
assert(
  !/(?:[A-Za-z]:\\|[A-Za-z]:\/|\/Users\/)/.test(indexText),
  "generated index leaked an absolute path",
);
outputs.set("index.json", Buffer.from(indexText));
same(outputs.size, 69, "output JSON count");
writeOrCheck(outputs);

console.log(
  `${CHECK ? "Verified" : "Generated"} candidate static-port reuse: `
  + `${formalSummary.length}/68 formal manifests, `
  + `${boundarySummary.length}/1 engine-owned runtime boundary`,
);
console.log(`  formal candidate denominator: ${index.denominator.totalFormalCandidatePorts}/78`);
console.log(`  output: ${OUTPUT_DIR}`);
