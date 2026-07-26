import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  canonicalJsonSha256,
  compileWebglAdaptationContract,
  LEGACY_CLAIM_SET_SHA256,
  legacyClaimSetSha256,
  validateBasisConversionSourceText,
  validateTextureCoordinateSourceText,
  WEBGL_ADAPTATION_SCHEMA_V1,
  WEBGL_ADAPTATION_SCHEMA_V2,
} from "./webgl-adaptation-contract.mjs";
import { compileRendererPropertyBlockContract } from "./renderer-property-block-contract.mjs";
import { compileWebglRuntimePortContract } from "./webgl-runtime-port-contract.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHADER_ROOT = path.join(ROOT, "public", "shaders");
const PORT_CONTRACT = path.join(SHADER_ROOT, "official_program_port_contract.json");
const jsonMode = process.argv.includes("--json");

function fail(message) {
  throw new Error(`webgl adaptation audit: ${message}`);
}

function sha256File(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function collectFiles(directory, predicate, output = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) collectFiles(absolute, predicate, output);
    else if (entry.isFile() && predicate(absolute)) output.push(absolute);
  }
  return output;
}

function resolveRepositoryPath(relativePath, label) {
  if (typeof relativePath !== "string" || relativePath.length === 0) fail(`${label} is missing`);
  const absolute = path.resolve(ROOT, relativePath);
  const relative = path.relative(ROOT, absolute);
  if (relative.startsWith("..") || path.isAbsolute(relative)) fail(`${label} escapes the repository`);
  return absolute;
}

function portIdentity(port) {
  return `${port.selectorId}:${port.candidateWitnessId}:${port.subshader}:${port.pass}`;
}

function validateBasisConversionSource(manifest, manifestPath, stage) {
  const contract = manifest.runtime_contract?.backend_basis_conversions?.[stage];
  if (!contract || typeof contract !== "object" || Array.isArray(contract)) {
    fail(`${manifestPath} ${stage} object-basis-conversion has no backend basis contract`);
  }
  const sourcePath = resolveRepositoryPath(
    manifest.webgl_sources?.[stage],
    `${manifestPath}.webgl_sources.${stage}`,
  );
  try {
    const normalized = validateBasisConversionSourceText(fs.readFileSync(sourcePath, "utf8"), contract);
    return canonicalJsonSha256(normalized);
  } catch (error) {
    fail(`${manifestPath} ${stage} ${error instanceof Error ? error.message : String(error)}`);
  }
}

function validateTextureCoordinateSource(manifest, manifestPath, stage) {
  const contract = manifest.runtime_contract?.texture_coordinates?.[stage];
  if (!contract || typeof contract !== "object" || Array.isArray(contract)) {
    fail(`${manifestPath} ${stage} texture-coordinate operation has no runtime contract`);
  }
  const sourcePath = resolveRepositoryPath(
    manifest.webgl_sources?.[stage],
    `${manifestPath}.webgl_sources.${stage}`,
  );
  try {
    return canonicalJsonSha256(
      validateTextureCoordinateSourceText(fs.readFileSync(sourcePath, "utf8"), contract),
    );
  } catch (error) {
    fail(`${manifestPath} ${stage} ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function auditWebglAdaptationContract() {
  const contract = JSON.parse(fs.readFileSync(PORT_CONTRACT, "utf8"));
  if (!Array.isArray(contract.ports) || contract.ports.length === 0) fail("official port contract is empty");

  const sourceHashIndex = new Map();
  for (const file of collectFiles(SHADER_ROOT, (value) => value.endsWith(".glsl"))) {
    const digest = sha256File(file);
    if (!sourceHashIndex.has(digest)) sourceHashIndex.set(digest, []);
    sourceHashIndex.get(digest).push(path.relative(ROOT, file).replaceAll("\\", "/"));
  }

  const manifests = [];
  const manifestPaths = new Set();
  const identities = new Set();
  const schemaCounts = { [WEBGL_ADAPTATION_SCHEMA_V1]: 0, [WEBGL_ADAPTATION_SCHEMA_V2]: 0 };
  const operationCounts = {};
  const dynamicSourceCounts = {};
  let legacyClaimCount = 0;
  let runtimeContractCount = 0;
  let dynamicUniformPortCount = 0;
  let dynamicUniformBindingCount = 0;
  let dynamicProducerBoundPortCount = 0;

  for (const port of contract.ports) {
    const identity = portIdentity(port);
    if (identities.has(identity)) fail(`duplicate official port identity ${identity}`);
    identities.add(identity);
    if (manifestPaths.has(port.manifest)) fail(`manifest is reused by multiple ports: ${port.manifest}`);
    manifestPaths.add(port.manifest);

    const manifestPath = resolveRepositoryPath(port.manifest, `${identity}.manifest`);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    manifests.push(manifest);
    const selector = manifest.official_selector ?? {};
    if (selector.selectorId !== port.selectorId
        || selector.candidateWitnessId !== port.candidateWitnessId
        || selector.subshader !== port.subshader
        || selector.pass !== port.pass) {
      fail(`${port.manifest} official selector identity does not match the port contract`);
    }

    const adaptation = manifest.webgl_adaptation;
    if (!adaptation) fail(`${port.manifest} has no webgl_adaptation`);
    const runtimeContract = compileWebglRuntimePortContract(manifest.runtime_contract, {
      samplerBindings: manifest.sampler_bindings,
    });
    runtimeContractCount += 1;
    const dynamicUniforms = Object.values(runtimeContract.dynamic_uniforms || {});
    if (dynamicUniforms.length > 0) {
      dynamicUniformPortCount += 1;
      dynamicUniformBindingCount += dynamicUniforms.length;
      for (const spec of dynamicUniforms) {
        dynamicSourceCounts[spec.source] = (dynamicSourceCounts[spec.source] ?? 0) + 1;
      }
    }
    const sourceHashes = {};
    for (const stage of ["vertex", "fragment"]) {
      const expected = adaptation[stage]?.outputSha256;
      const indexed = sourceHashIndex.get(expected) ?? [];
      if (indexed.length === 0) fail(`${port.manifest} ${stage} output hash has no emitted GLSL source`);
      const declared = manifest.webgl_sources?.[stage];
      if (declared !== undefined) {
        const sourcePath = resolveRepositoryPath(declared, `${port.manifest}.webgl_sources.${stage}`);
        if (!fs.existsSync(sourcePath)) fail(`${declared} does not exist`);
        if (sha256File(sourcePath) !== expected) fail(`${declared} does not match ${stage}.outputSha256`);
      }
      sourceHashes[stage] = expected;
    }

    const compiled = compileWebglAdaptationContract(adaptation, { sourceHashes });
    if (dynamicUniforms.length > 0) {
      const operationKind = dynamicUniforms.every((spec) => spec.source === "official-clock")
        ? "official-clock-binding"
        : "dynamic-uniform-producer-binding";
      if (["vertex", "fragment"].some((stage) => compiled.graph[stage]
        .some((operation) => operation.kind === operationKind))) {
        dynamicProducerBoundPortCount += 1;
      }
    }
    if (compiled.sourceSchema === WEBGL_ADAPTATION_SCHEMA_V2) {
      if (!manifest.official_vertex_inputs || !manifest.official_program_bindings
          || !manifest.runtime_contract?.engine_uniforms) {
        fail(`${port.manifest} v2 operations require vertex, program-binding and runtime contracts`);
      }
      const expectedEvidence = {
        "vertex-input-binding": canonicalJsonSha256(manifest.official_vertex_inputs),
        "engine-uniform-binding": canonicalJsonSha256(manifest.runtime_contract.engine_uniforms),
        "uniform-buffer-flattening": canonicalJsonSha256(manifest.official_program_bindings),
        ...(manifest.runtime_contract.dynamic_uniforms
          ? {
            "official-clock-binding": canonicalJsonSha256(manifest.runtime_contract.dynamic_uniforms),
            "dynamic-uniform-producer-binding": canonicalJsonSha256(
              manifest.runtime_contract.dynamic_uniforms,
            ),
          }
          : {}),
        ...(manifest.runtime_contract.renderer_uniforms
          ? {
            "renderer-property-block-binding": canonicalJsonSha256(
              compileRendererPropertyBlockContract(manifest.runtime_contract.renderer_uniforms),
            ),
          }
          : {}),
        ...(manifest.runtime_contract.texture_coordinates?.vertex
          ? {
            "texture-coordinate-basis-conversion": validateTextureCoordinateSource(
              manifest,
              port.manifest,
              "vertex",
            ),
          }
          : {}),
      };
      const evidenceField = {
        "vertex-input-binding": "mappingSha256",
        "engine-uniform-binding": "runtimeContractSha256",
        "uniform-buffer-flattening": "bindingContractSha256",
        "official-clock-binding": "clockContractSha256",
        "dynamic-uniform-producer-binding": "producerContractSha256",
        "renderer-property-block-binding": "producerContractSha256",
        "object-basis-conversion": "basisContractSha256",
        "texture-coordinate-basis-conversion": "textureCoordinateContractSha256",
      };
      for (const stage of ["vertex", "fragment"]) {
        for (const operation of compiled.graph[stage]) {
          const field = evidenceField[operation.kind];
          const expected = operation.kind === "object-basis-conversion"
            ? validateBasisConversionSource(manifest, port.manifest, stage)
            : expectedEvidence[operation.kind];
          if (field && operation[field] !== expected) {
            fail(`${port.manifest} ${stage} ${operation.kind} is not bound to its generated contract`);
          }
        }
      }
    }
    schemaCounts[compiled.sourceSchema] = (schemaCounts[compiled.sourceSchema] ?? 0) + 1;
    legacyClaimCount += compiled.legacyClaimCount;
    for (const stage of ["vertex", "fragment"]) {
      for (const operation of compiled.graph[stage]) {
        operationCounts[operation.kind] = (operationCounts[operation.kind] ?? 0) + 1;
      }
    }
  }

  const claimSetSha256 = legacyClaimSetSha256(manifests);
  if (claimSetSha256 !== LEGACY_CLAIM_SET_SHA256) {
    fail(`legacy claim corpus changed: expected ${LEGACY_CLAIM_SET_SHA256}, got ${claimSetSha256}`);
  }
  if (schemaCounts[WEBGL_ADAPTATION_SCHEMA_V1] !== 0
      || schemaCounts[WEBGL_ADAPTATION_SCHEMA_V2] !== contract.ports.length) {
    fail(
      `native typed adaptation is incomplete: ${schemaCounts[WEBGL_ADAPTATION_SCHEMA_V2]}/${contract.ports.length}`,
    );
  }
  const report = {
    schema: "pocket-card-render/webgl-adaptation-audit@1",
    definition: {
      source: "typed backend adaptation operations; the formal port corpus rejects v1 manifests",
      scope: "Vulkan SPIR-V to Three.js WebGL2 source adaptation declarations",
      versionIndependentLogic: true,
      versionIndependentOfficialEvidence: false,
    },
    portCount: contract.ports.length,
    contractValidatedPortCount: contract.ports.length,
    nativeV2PortCount: schemaCounts[WEBGL_ADAPTATION_SCHEMA_V2],
    nativeTypedPercent: 100 * schemaCounts[WEBGL_ADAPTATION_SCHEMA_V2] / contract.ports.length,
    genericRuntimeContractPortCount: runtimeContractCount,
    genericRuntimeContractPercent: 100 * runtimeContractCount / contract.ports.length,
    dynamicUniformPortCount,
    dynamicUniformBindingCount,
    dynamicProducerBoundPortCount,
    dynamicProducerBoundPercent: dynamicUniformPortCount === 0
      ? 100
      : 100 * dynamicProducerBoundPortCount / dynamicUniformPortCount,
    dynamicSourceCounts: Object.fromEntries(
      Object.entries(dynamicSourceCounts).sort(([a], [b]) => a.localeCompare(b)),
    ),
    legacyBridgePortCount: schemaCounts[WEBGL_ADAPTATION_SCHEMA_V1],
    schemaCounts,
    legacyClaimCount,
    legacyClaimSetSha256: claimSetSha256,
    operationCounts: Object.fromEntries(Object.entries(operationCounts).sort(([a], [b]) => a.localeCompare(b))),
    stageProgramVerdictCeiling: "source-hash-bound",
    backendSemanticExactPercent: 0,
    officialShaderRestorationPercent: null,
    runtimeRequired: [
      "official guest dispatch/descriptor/uniform/attachment/vertex bindings",
      "independent Vulkan-to-WebGL instruction-semantic equivalence",
      "source-current runtime value evidence for non-OfficialClock dynamic producers",
      "target GPU and driver behavior",
    ],
  };
  return report;
}

try {
  const report = auditWebglAdaptationContract();
  if (jsonMode) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    console.log(`OK webgl adaptation contract ${report.contractValidatedPortCount}/${report.portCount} ports validated`);
    console.log(`   native typed v2=${report.nativeV2PortCount}; legacy bridge=${report.legacyBridgePortCount}; native=${report.nativeTypedPercent}%`);
    console.log(`   dynamic producer-bound=${report.dynamicProducerBoundPortCount}/${report.dynamicUniformPortCount} ports (${report.dynamicProducerBoundPercent}%)`);
    console.log(`   verdict ceiling: ${report.stageProgramVerdictCeiling}; backend semantic exact: 0%`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
