import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  canonicalJson,
  canonicalJsonSha256,
  OFFICIAL_SPIRV_PRECISION_SCHEMA,
  SPIRV_PRECISION_STAGE_SCHEMA,
} from "./exact-selector-port-core.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HASH_PATTERN = /^[0-9a-f]{64}$/;
const CONTRACT_SCHEMA = "pocket-card-render/official-program-port-contract@2";
const PRECISION_CAPABILITIES = Object.freeze([
  "Float16Buffer",
  "Float16",
  "Float64",
  "DenormPreserve",
  "DenormFlushToZero",
  "SignedZeroInfNanPreserve",
  "RoundingModeRTE",
  "RoundingModeRTZ",
  "Float16ImageAMD",
  "FloatControls2",
]);
const PRECISION_DECORATIONS = Object.freeze({
  RelaxedPrecision: { value: 0, operandCount: 0 },
  FPRoundingMode: { value: 39, operandCount: 1 },
  FPFastMathMode: { value: 40, operandCount: 1 },
  NoContraction: { value: 42, operandCount: 0 },
});
const FLOAT_CONTROL_MODES = Object.freeze({
  DenormPreserve: 4459,
  DenormFlushToZero: 4460,
  SignedZeroInfNanPreserve: 4461,
  RoundingModeRTE: 4462,
  RoundingModeRTZ: 4463,
});
const GLITTER_SHADER = "Lettuce/Common/CardNew/Face/Card_UR_Glitter_FlowMaps";

export const GLITTER_ALIAS_CONTRACT = Object.freeze({
  schema: "pocket-card-render/glitter-mixed-precision-alias-contract@1",
  scope: "local-glsl-declaration-preservation",
  vulkan_to_webgl_equivalence: "not-claimed",
  selectorId: "4a38649c034968a639962150c1ef03d19f9fd4571ef5b496c5facec8076ed6b4",
  candidateWitnessId: "741330e6c5c79eb6e2a8fc9c2f214f421165df8160ee63a33b693d28906ca676",
  stages: {
    vertex: {
      officialSpirvSha256: "1af6dfd11c7da5008e4fb1819e056d86ceca72cc1fc08ef40442dc63ead61597",
      defaultFloat: "highp",
      aliases: [
        { official: "_80._m8[2]", local: "_FlowParams[2]", declaration: ["uniform", "highp", "vec4", "_FlowParams", "[2]"] },
        { official: "_80._m4", local: "_FakeCameraHeight", declaration: ["uniform", "mediump", "float", "_FakeCameraHeight", ""] },
        { official: "_80._m5", local: "_Height", declaration: ["uniform", "mediump", "float", "_Height", ""] },
        { official: "_80._m6", local: "_HeightPower", declaration: ["uniform", "mediump", "float", "_HeightPower", ""] },
        { official: "_80._m7", local: "_Scale", declaration: ["uniform", "mediump", "float", "_Scale", ""] },
        { official: "_80._m13", local: "_FlowScale", declaration: ["uniform", "mediump", "float", "_FlowScale", ""] },
        { official: "_80._m9", local: "_FakeCameraHeightB", declaration: ["uniform", "mediump", "float", "_FakeCameraHeightB", ""] },
        { official: "_80._m10", local: "_HeightB", declaration: ["uniform", "mediump", "float", "_HeightB", ""] },
        { official: "_80._m11", local: "_HeightPowerB", declaration: ["uniform", "mediump", "float", "_HeightPowerB", ""] },
        { official: "_80._m12", local: "_ScaleB", declaration: ["uniform", "mediump", "float", "_ScaleB", ""] },
        { official: "_80._m14", local: "_FlowScaleB", declaration: ["uniform", "mediump", "float", "_FlowScaleB", ""] },
        { official: "_34@location3", local: "tangent", declaration: ["in", "mediump", "vec4", "tangent", ""] },
      ],
      forbidden: [],
    },
    fragment: {
      officialSpirvSha256: "f5aee5f528410fcade473ebe4adb39d36033c05a01020e959b530ea24d60785b",
      defaultFloat: "mediump",
      aliases: [
        { official: "_39._m0[2]", local: "_FlowParams[2]", declaration: ["uniform", "highp", "vec4", "_FlowParams", "[2]"] },
        { official: "_39._m1", local: "_FadeDuration", declaration: ["uniform", "highp", "float", "_FadeDuration", ""] },
        { official: "_39._m2", local: "_FlowAPower", declaration: ["uniform", "highp", "float", "_FlowAPower", ""] },
        { official: "_39._m3", local: "_FlowBPower", declaration: ["uniform", "highp", "float", "_FlowBPower", ""] },
        { official: "_39._m4", local: "_LightColor", declaration: ["uniform", "", "vec4", "_LightColor", ""] },
        { official: "_39._m5", local: "_LightTime", declaration: ["uniform", "highp", "float", "_LightTime", ""] },
        { official: "_39._m6", local: "_EmitThreshold", declaration: ["uniform", "highp", "float", "_EmitThreshold", ""] },
      ],
      forbidden: [
        ["uniform", "highp", "vec4", "_LightColor", ""],
      ],
    },
  },
});

function fail(message) {
  throw new Error(`official shader precision audit: ${message}`);
}

function isRecord(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function record(value, label) {
  if (!isRecord(value)) fail(`${label} must be a plain object`);
  return value;
}

function array(value, label) {
  if (!Array.isArray(value)) fail(`${label} must be an array`);
  return value;
}

function own(owner, key, label) {
  const descriptor = Object.getOwnPropertyDescriptor(owner, key);
  if (!descriptor) fail(`${label}.${key} is absent`);
  if (descriptor.get || descriptor.set) fail(`${label}.${key} must not be an accessor`);
  return descriptor.value;
}

function string(value, label) {
  if (typeof value !== "string" || value.length === 0) fail(`${label} must be a non-empty string`);
  return value;
}

function integer(value, label, min = 0) {
  if (!Number.isSafeInteger(value) || value < min) fail(`${label} must be an integer >= ${min}`);
  return value;
}

function hash(value, label) {
  if (typeof value !== "string" || !HASH_PATTERN.test(value)) {
    fail(`${label} must be a lowercase SHA-256 hex string`);
  }
  return value;
}

function exactKeys(value, expected, label) {
  const actual = Object.keys(record(value, label)).sort();
  const wanted = [...expected].sort();
  if (canonicalJson(actual) !== canonicalJson(wanted)) {
    fail(`${label} fields changed: expected ${wanted.join(", ")}, got ${actual.join(", ")}`);
  }
}

function safeRepoFile(root, relativePath, label) {
  string(relativePath, label);
  if (path.isAbsolute(relativePath)) fail(`${label} must be repository-relative`);
  const resolved = path.resolve(root, relativePath);
  const relative = path.relative(root, resolved);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    fail(`${label} escapes the repository`);
  }
  if (!fs.statSync(resolved, { throwIfNoEntry: false })?.isFile()) {
    fail(`${label} is absent: ${relativePath}`);
  }
  return resolved;
}

function readJson(file, label) {
  try {
    return record(JSON.parse(fs.readFileSync(file, "utf8")), label);
  } catch (error) {
    fail(`${label} is unreadable JSON: ${error.message}`);
  }
}

function validateCountObject(value, label) {
  exactKeys(value, ["decorate", "member_decorate", "decorate_id"], label);
  return {
    decorate: integer(value.decorate, `${label}.decorate`),
    member_decorate: integer(value.member_decorate, `${label}.member_decorate`),
    decorate_id: integer(value.decorate_id, `${label}.decorate_id`),
  };
}

export function validateSpirvPrecisionStage(value, expectedSourceSha256, label = "precision stage") {
  const stage = record(value, label);
  exactKeys(stage, [
    "schema",
    "source_sha256",
    "byte_size",
    "word_count",
    "header",
    "instruction_count",
    "capabilities",
    "float_types",
    "decorations",
    "quantize_to_f16_count",
    "float_control_execution_modes",
    "instruction_structure_sha256",
    "facts_sha256",
  ], label);
  if (stage.schema !== SPIRV_PRECISION_STAGE_SCHEMA) fail(`${label}.schema changed`);
  const sourceSha256 = hash(stage.source_sha256, `${label}.source_sha256`);
  if (sourceSha256 !== hash(expectedSourceSha256, `${label} expected source SHA-256`)) {
    fail(`${label}.source_sha256 does not match the formal port`);
  }
  const byteSize = integer(stage.byte_size, `${label}.byte_size`, 20);
  if (byteSize % 4 !== 0) fail(`${label}.byte_size is not word aligned`);
  const wordCount = integer(stage.word_count, `${label}.word_count`, 5);
  if (wordCount !== byteSize / 4) fail(`${label}.word_count does not match byte_size`);

  const header = record(stage.header, `${label}.header`);
  exactKeys(header, [
    "version_word",
    "version",
    "major",
    "minor",
    "revision",
    "generator_magic",
    "id_bound",
    "schema_word",
  ], `${label}.header`);
  const versionWord = integer(header.version_word, `${label}.header.version_word`);
  string(header.version, `${label}.header.version`);
  const major = integer(header.major, `${label}.header.major`);
  const minor = integer(header.minor, `${label}.header.minor`);
  const revision = integer(header.revision, `${label}.header.revision`);
  if (header.version !== `${major}.${minor}.${revision}`) fail(`${label}.header.version is inconsistent`);
  if (major !== 1 || minor > 6) fail(`${label}.header version is unsupported`);
  if (versionWord !== ((major << 16) | (minor << 8) | revision)) {
    fail(`${label}.header.version_word is inconsistent`);
  }
  integer(header.generator_magic, `${label}.header.generator_magic`);
  integer(header.id_bound, `${label}.header.id_bound`, 1);
  if (integer(header.schema_word, `${label}.header.schema_word`) !== 0) {
    fail(`${label}.header.schema_word is unsupported`);
  }
  integer(stage.instruction_count, `${label}.instruction_count`, 1);

  const capabilities = record(stage.capabilities, `${label}.capabilities`);
  exactKeys(capabilities, PRECISION_CAPABILITIES, `${label}.capabilities`);
  for (const name of PRECISION_CAPABILITIES) {
    integer(capabilities[name], `${label}.capabilities.${name}`);
  }

  const floatTypes = array(stage.float_types, `${label}.float_types`);
  let previousWidth = -1;
  let hasFloat32 = false;
  for (const [index, raw] of floatTypes.entries()) {
    const row = record(raw, `${label}.float_types[${index}]`);
    exactKeys(row, ["width", "declaration_count"], `${label}.float_types[${index}]`);
    const width = integer(row.width, `${label}.float_types[${index}].width`, 1);
    if (width <= previousWidth) fail(`${label}.float_types must be unique and sorted`);
    previousWidth = width;
    const declarationCount = integer(
      row.declaration_count,
      `${label}.float_types[${index}].declaration_count`,
      1,
    );
    if (width === 32 && declarationCount > 0) hasFloat32 = true;
  }
  if (!hasFloat32) fail(`${label} has no declared 32-bit float type`);

  const decorations = record(stage.decorations, `${label}.decorations`);
  exactKeys(decorations, Object.keys(PRECISION_DECORATIONS), `${label}.decorations`);
  for (const [name, expectation] of Object.entries(PRECISION_DECORATIONS)) {
    const decoration = record(decorations[name], `${label}.decorations.${name}`);
    exactKeys(decoration, [
      "decoration_value",
      "instruction_counts",
      "source_instruction_count",
      "direct_application_count",
      "group_application_count",
      "effective_application_count",
      "operand_sets",
    ], `${label}.decorations.${name}`);
    if (integer(
      decoration.decoration_value,
      `${label}.decorations.${name}.decoration_value`,
    ) !== expectation.value) {
      fail(`${label}.decorations.${name}.decoration_value changed`);
    }
    const instructionCounts = validateCountObject(
      decoration.instruction_counts,
      `${label}.decorations.${name}.instruction_counts`,
    );
    const sourceInstructionCount = integer(
      decoration.source_instruction_count,
      `${label}.decorations.${name}.source_instruction_count`,
    );
    if (
      sourceInstructionCount
      !== instructionCounts.decorate + instructionCounts.member_decorate + instructionCounts.decorate_id
    ) {
      fail(`${label}.decorations.${name} instruction counts do not close`);
    }
    const directApplications = integer(
      decoration.direct_application_count,
      `${label}.decorations.${name}.direct_application_count`,
    );
    const groupApplications = integer(
      decoration.group_application_count,
      `${label}.decorations.${name}.group_application_count`,
    );
    if (
      integer(
        decoration.effective_application_count,
        `${label}.decorations.${name}.effective_application_count`,
      ) !== directApplications + groupApplications
    ) {
      fail(`${label}.decorations.${name} application counts do not close`);
    }
    const operandSets = array(
      decoration.operand_sets,
      `${label}.decorations.${name}.operand_sets`,
    );
    let operandDeclarationCount = 0;
    let previousOperandSet = null;
    for (const [index, raw] of operandSets.entries()) {
      const row = record(raw, `${label}.decorations.${name}.operand_sets[${index}]`);
      exactKeys(row, ["operands", "declaration_count"], `${label}.decorations.${name}.operand_sets[${index}]`);
      const operands = array(
        row.operands,
        `${label}.decorations.${name}.operand_sets[${index}].operands`,
      );
      if (operands.length !== expectation.operandCount) {
        fail(`${label}.decorations.${name}.operand_sets[${index}] has invalid width`);
      }
      for (const [operandIndex, operand] of operands.entries()) {
        integer(operand, `${label}.decorations.${name}.operand_sets[${index}].operands[${operandIndex}]`);
      }
      const key = canonicalJson(operands);
      if (previousOperandSet !== null && key <= previousOperandSet) {
        fail(`${label}.decorations.${name}.operand_sets must be unique and sorted`);
      }
      previousOperandSet = key;
      operandDeclarationCount += integer(
        row.declaration_count,
        `${label}.decorations.${name}.operand_sets[${index}].declaration_count`,
        1,
      );
    }
    if (operandDeclarationCount !== sourceInstructionCount) {
      fail(`${label}.decorations.${name} operand counts do not close`);
    }
  }

  integer(stage.quantize_to_f16_count, `${label}.quantize_to_f16_count`);
  const modes = array(
    stage.float_control_execution_modes,
    `${label}.float_control_execution_modes`,
  );
  let previousMode = null;
  for (const [index, raw] of modes.entries()) {
    const row = record(raw, `${label}.float_control_execution_modes[${index}]`);
    exactKeys(row, [
      "opcode",
      "mode",
      "mode_value",
      "operands",
      "declaration_count",
    ], `${label}.float_control_execution_modes[${index}]`);
    if (row.opcode !== "OpExecutionMode" && row.opcode !== "OpExecutionModeId") {
      fail(`${label}.float_control_execution_modes[${index}].opcode is unsupported`);
    }
    const mode = string(row.mode, `${label}.float_control_execution_modes[${index}].mode`);
    if (!Object.hasOwn(FLOAT_CONTROL_MODES, mode)) {
      fail(`${label}.float_control_execution_modes[${index}].mode is unsupported`);
    }
    if (
      integer(row.mode_value, `${label}.float_control_execution_modes[${index}].mode_value`)
      !== FLOAT_CONTROL_MODES[mode]
    ) {
      fail(`${label}.float_control_execution_modes[${index}].mode_value changed`);
    }
    const operands = array(row.operands, `${label}.float_control_execution_modes[${index}].operands`);
    if (operands.length !== 1) fail(`${label}.float_control_execution_modes[${index}] has invalid width`);
    integer(operands[0], `${label}.float_control_execution_modes[${index}].operands[0]`);
    integer(
      row.declaration_count,
      `${label}.float_control_execution_modes[${index}].declaration_count`,
      1,
    );
    const key = canonicalJson({
      opcode: row.opcode,
      mode: row.mode,
      mode_value: row.mode_value,
      operands,
    });
    if (previousMode !== null && key <= previousMode) {
      fail(`${label}.float_control_execution_modes must be unique and sorted`);
    }
    previousMode = key;
  }
  hash(stage.instruction_structure_sha256, `${label}.instruction_structure_sha256`);
  const factsSha256 = hash(stage.facts_sha256, `${label}.facts_sha256`);
  const { facts_sha256: _discarded, ...facts } = stage;
  if (canonicalJsonSha256(facts) !== factsSha256) fail(`${label}.facts_sha256 changed`);
  return stage;
}

function validatePortIdentity(manifest, port, label) {
  if (string(manifest.generated_by, `${label}.generated_by`) !== string(port.generator, "port.generator")) {
    fail(`${label}.generated_by does not match the formal port generator`);
  }
  const selector = record(manifest.official_selector, `${label}.official_selector`);
  for (const key of ["selectorId", "candidateWitnessId", "semanticExecutableId"]) {
    if (string(selector[key], `${label}.official_selector.${key}`) !== string(port[key], `port.${key}`)) {
      fail(`${label}.official_selector.${key} does not match the formal port`);
    }
  }
  for (const key of ["subshader", "pass"]) {
    if (integer(selector[key], `${label}.official_selector.${key}`) !== integer(port[key], `port.${key}`)) {
      fail(`${label}.official_selector.${key} does not match the formal port`);
    }
  }
  const identities = record(port.officialIdentityFields, "port.officialIdentityFields");
  const manifestIdentities = record(
    manifest.official_executable_identity,
    `${label}.official_executable_identity`,
  );
  for (const key of [
    "vertexSpirvSha256",
    "fragmentSpirvSha256",
    "parameterEntrySha256",
    "passStateSha256",
    "commonBindingsSha256",
  ]) {
    if (
      hash(manifestIdentities[key], `${label}.official_executable_identity.${key}`)
      !== hash(identities[key], `port.officialIdentityFields.${key}`)
    ) {
      fail(`${label}.official_executable_identity.${key} does not match the formal port`);
    }
  }
  const manifestSpirv = record(manifest.official_spirv_sha256, `${label}.official_spirv_sha256`);
  if (
    hash(manifestSpirv.vertex, `${label}.official_spirv_sha256.vertex`)
    !== identities.vertexSpirvSha256
    || hash(manifestSpirv.fragment, `${label}.official_spirv_sha256.fragment`)
    !== identities.fragmentSpirvSha256
  ) {
    fail(`${label}.official_spirv_sha256 does not match the formal port`);
  }
}

export function validateFormalPortPrecisionManifest(manifestValue, portValue, label = "manifest") {
  const manifest = record(manifestValue, label);
  const port = record(portValue, "formal port");
  validatePortIdentity(manifest, port, label);
  const precision = record(
    own(manifest, "official_spirv_precision", label),
    `${label}.official_spirv_precision`,
  );
  exactKeys(precision, [
    "schema",
    "evidence_scope",
    "vulkan_to_webgl_equivalence",
    "stages",
  ], `${label}.official_spirv_precision`);
  if (precision.schema !== OFFICIAL_SPIRV_PRECISION_SCHEMA) {
    fail(`${label}.official_spirv_precision.schema changed`);
  }
  if (precision.evidence_scope !== "official-vulkan-spirv-structure") {
    fail(`${label}.official_spirv_precision.evidence_scope changed`);
  }
  if (precision.vulkan_to_webgl_equivalence !== "not-claimed") {
    fail(`${label}.official_spirv_precision must not claim Vulkan-to-WebGL equivalence`);
  }
  const stages = record(precision.stages, `${label}.official_spirv_precision.stages`);
  exactKeys(stages, ["vertex", "fragment"], `${label}.official_spirv_precision.stages`);
  const identities = port.officialIdentityFields;
  return {
    vertex: validateSpirvPrecisionStage(
      stages.vertex,
      identities.vertexSpirvSha256,
      `${label}.official_spirv_precision.stages.vertex`,
    ),
    fragment: validateSpirvPrecisionStage(
      stages.fragment,
      identities.fragmentSpirvSha256,
      `${label}.official_spirv_precision.stages.fragment`,
    ),
  };
}

function portKey(port) {
  return [
    string(port.selectorId, "port.selectorId"),
    string(port.candidateWitnessId, "port.candidateWitnessId"),
    integer(port.subshader, "port.subshader"),
    integer(port.pass, "port.pass"),
  ].join(":");
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function declarationRegex([storage, precision, type, name, suffix]) {
  const precisionPart = precision ? `${escapeRegex(precision)}\\s+` : "";
  return new RegExp(
    `^\\s*${escapeRegex(storage)}\\s+${precisionPart}${escapeRegex(type)}\\s+`
      + `${escapeRegex(name)}${escapeRegex(suffix)}\\s*;\\s*$`,
    "m",
  );
}

function validateGlitterAliases(root, manifestRows, aliasContractValue = GLITTER_ALIAS_CONTRACT) {
  const aliasContract = record(aliasContractValue, "Glitter alias contract");
  const aliasStages = record(aliasContract.stages, "Glitter alias contract.stages");
  const matches = manifestRows.filter(({ manifest }) => manifest.shader === GLITTER_SHADER);
  if (matches.length !== 1) {
    fail(`Glitter alias contract matched ${matches.length} formal ports instead of 1`);
  }
  const [{ port, manifest, precisionStages }] = matches;
  if (
    port.selectorId !== aliasContract.selectorId
    || port.candidateWitnessId !== aliasContract.candidateWitnessId
  ) {
    fail("Glitter alias contract selector identity changed");
  }
  for (const stageName of ["vertex", "fragment"]) {
    const contract = record(aliasStages[stageName], `Glitter alias contract.stages.${stageName}`);
    if (precisionStages[stageName].source_sha256 !== contract.officialSpirvSha256) {
      fail(`Glitter ${stageName} alias contract SPIR-V identity changed`);
    }
    if (
      precisionStages[stageName].decorations.RelaxedPrecision.effective_application_count === 0
    ) {
      fail(`Glitter ${stageName} has no official RelaxedPrecision evidence`);
    }
    const sources = record(manifest.webgl_sources, "Glitter manifest.webgl_sources");
    const sourcePath = safeRepoFile(
      root,
      string(sources[stageName], `Glitter manifest.webgl_sources.${stageName}`),
      `Glitter manifest.webgl_sources.${stageName}`,
    );
    const source = fs.readFileSync(sourcePath, "utf8");
    const defaultPattern = new RegExp(
      `^\\s*precision\\s+${contract.defaultFloat}\\s+float\\s*;\\s*$`,
      "m",
    );
    if (!defaultPattern.test(source)) fail(`Glitter ${stageName} default float precision changed`);
    for (const alias of contract.aliases) {
      if (!declarationRegex(alias.declaration).test(source)) {
        fail(
          `Glitter ${stageName} alias declaration changed: `
            + `${alias.official} -> ${alias.local}`,
        );
      }
    }
    for (const declaration of contract.forbidden) {
      if (declarationRegex(declaration).test(source)) {
        fail(`Glitter ${stageName} forbidden alias declaration appeared: ${declaration.join(" ")}`);
      }
    }
  }
  const fragmentSource = fs.readFileSync(
    safeRepoFile(root, manifest.webgl_sources.fragment, "Glitter fragment source"),
    "utf8",
  );
  if (!/^layout\(location = 1\) out highp vec4 _1092;\s*$/m.test(fragmentSource)) {
    fail("Glitter fragment MRT1 precision declaration changed");
  }
  if (!/^\s*_1092 = vec4\(0\.0\);\s*$/m.test(fragmentSource)) {
    fail("Glitter fragment MRT1 zero write changed");
  }
  return aliasContract;
}

export function auditOfficialShaderPrecision(options = {}) {
  const config = record(options, "precision audit options");
  const root = path.resolve(config.rootDir ?? ROOT);
  const contractRelative = config.contract
    ?? "public/shaders/official_program_port_contract.json";
  const contract = readJson(
    safeRepoFile(root, contractRelative, "official program port contract"),
    "official program port contract",
  );
  if (contract.schema !== CONTRACT_SCHEMA) fail(`contract schema changed: ${contract.schema}`);
  const ports = array(contract.ports, "official program port contract.ports");
  if (ports.length === 0) fail("official program port contract has no formal ports");

  const keys = new Set();
  const manifestPaths = new Set();
  const manifestRows = [];
  const uniqueStages = new Map();
  let stageReferences = 0;
  for (const [index, rawPort] of ports.entries()) {
    const port = record(rawPort, `formal port ${index}`);
    const key = portKey(port);
    if (keys.has(key)) fail(`formal port identity is duplicated: ${key}`);
    keys.add(key);
    const manifestRelative = string(port.manifest, `formal port ${index}.manifest`);
    if (manifestPaths.has(manifestRelative)) {
      fail(`formal port manifest is reused: ${manifestRelative}`);
    }
    manifestPaths.add(manifestRelative);
    const manifest = readJson(
      safeRepoFile(root, manifestRelative, `formal port ${index}.manifest`),
      `formal port ${index} manifest`,
    );
    const precisionStages = validateFormalPortPrecisionManifest(
      manifest,
      port,
      `formal port ${index} manifest`,
    );
    manifestRows.push({ port, manifest, precisionStages });
    for (const stageName of ["vertex", "fragment"]) {
      stageReferences += 1;
      const facts = precisionStages[stageName];
      const existing = uniqueStages.get(facts.source_sha256);
      if (existing) {
        if (canonicalJson(existing.facts) !== canonicalJson(facts)) {
          fail(`stage hash ${facts.source_sha256} has inconsistent precision facts`);
        }
        existing.usages.push({ key, stage: stageName, manifest: manifestRelative });
      } else {
        uniqueStages.set(facts.source_sha256, {
          facts,
          usages: [{ key, stage: stageName, manifest: manifestRelative }],
        });
      }
    }
  }
  if (manifestRows.length !== ports.length || manifestPaths.size !== ports.length) {
    fail("formal port manifest denominator did not close");
  }
  if (stageReferences !== ports.length * 2) fail("formal port stage denominator did not close");

  const floatTypeDeclarations = new Map();
  const aggregate = {
    capabilities: Object.fromEntries(PRECISION_CAPABILITIES.map((name) => [name, 0])),
    decorations: Object.fromEntries(Object.keys(PRECISION_DECORATIONS).map((name) => [
      name,
      {
        source_instruction_count: 0,
        effective_application_count: 0,
      },
    ])),
    quantize_to_f16_instruction_count: 0,
    float_control_execution_modes: Object.fromEntries(
      Object.keys(FLOAT_CONTROL_MODES).map((name) => [name, 0]),
    ),
  };
  for (const { facts } of uniqueStages.values()) {
    for (const name of PRECISION_CAPABILITIES) {
      aggregate.capabilities[name] += facts.capabilities[name];
    }
    for (const row of facts.float_types) {
      floatTypeDeclarations.set(
        row.width,
        (floatTypeDeclarations.get(row.width) ?? 0) + row.declaration_count,
      );
    }
    for (const name of Object.keys(PRECISION_DECORATIONS)) {
      aggregate.decorations[name].source_instruction_count +=
        facts.decorations[name].source_instruction_count;
      aggregate.decorations[name].effective_application_count +=
        facts.decorations[name].effective_application_count;
    }
    aggregate.quantize_to_f16_instruction_count += facts.quantize_to_f16_count;
    for (const row of facts.float_control_execution_modes) {
      aggregate.float_control_execution_modes[row.mode] += row.declaration_count;
    }
  }
  aggregate.float_type_declarations = [...floatTypeDeclarations.entries()]
    .sort(([left], [right]) => left - right)
    .map(([width, declarationCount]) => ({
      width,
      declaration_count: declarationCount,
    }));
  const glitterAliasContract = validateGlitterAliases(
    root,
    manifestRows,
    config.glitterAliasContract ?? GLITTER_ALIAS_CONTRACT,
  );
  return {
    schema: "pocket-card-render/official-shader-precision-audit@2",
    denominator: {
      formal_ports: ports.length,
      manifests: manifestPaths.size,
      stage_references: stageReferences,
      unique_stage_hashes: uniqueStages.size,
    },
    official_spirv_structure: {
      exact_formal_ports: manifestRows.length,
      exact_unique_stage_hashes: uniqueStages.size,
      aggregate,
    },
    webgl_precision_equivalence: {
      exact_unique_stage_hashes: 0,
      denominator_unique_stage_hashes: uniqueStages.size,
      status: "not-claimed",
    },
    glitter_mixed_precision_aliases: glitterAliasContract,
  };
}

function printResult(result) {
  const denominator = result.denominator;
  const aggregate = result.official_spirv_structure.aggregate;
  const relaxed = aggregate.decorations.RelaxedPrecision;
  const float16Types = aggregate.float_type_declarations
    .find((row) => row.width === 16)?.declaration_count ?? 0;
  const floatControlModes = Object.values(aggregate.float_control_execution_modes)
    .reduce((total, count) => total + count, 0);
  console.log("official shader precision audit: OK");
  console.log(
    `  formal ports ${result.official_spirv_structure.exact_formal_ports}/${denominator.formal_ports}; `
      + `manifests ${denominator.manifests}; stage references ${denominator.stage_references}`,
  );
  console.log(
    `  unique official stage structures ${result.official_spirv_structure.exact_unique_stage_hashes}`
      + `/${denominator.unique_stage_hashes}; RelaxedPrecision instructions `
      + `${relaxed.source_instruction_count}`,
  );
  console.log(
    `  Float16 capability/type ${aggregate.capabilities.Float16}`
      + `/${float16Types}; QuantizeToF16 `
      + `${aggregate.quantize_to_f16_instruction_count}; float-control modes `
      + `${floatControlModes}`,
  );
  console.log(
    `  Vulkan-to-WebGL precision equivalence `
      + `${result.webgl_precision_equivalence.exact_unique_stage_hashes}`
      + `/${result.webgl_precision_equivalence.denominator_unique_stage_hashes} exact `
      + `(${result.webgl_precision_equivalence.status})`,
  );
  console.log("  Glitter mixed-precision local aliases: exact declaration preservation only");
}

const invokedAsScript = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedAsScript) {
  try {
    printResult(auditOfficialShaderPrecision());
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
