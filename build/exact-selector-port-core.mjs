import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  buildWebglAdaptationV2,
} from "./webgl-adaptation-contract.mjs";

const MODULE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HASH_PATTERN = /^[0-9a-f]{64}$/;
const STENCIL_KEYS = ["comp", "fail", "pass", "zFail"];
const SPIRV_MAGIC = 0x07230203;
const SPIRV_OP = Object.freeze({
  ExecutionMode: 16,
  Capability: 17,
  TypeFloat: 22,
  Decorate: 71,
  MemberDecorate: 72,
  DecorationGroup: 73,
  GroupDecorate: 74,
  GroupMemberDecorate: 75,
  QuantizeToF16: 116,
  ExecutionModeId: 331,
  DecorateId: 332,
});
const SPIRV_PRECISION_DECORATIONS = Object.freeze({
  0: "RelaxedPrecision",
  39: "FPRoundingMode",
  40: "FPFastMathMode",
  42: "NoContraction",
});
const SPIRV_FLOAT_CAPABILITIES = Object.freeze({
  8: "Float16Buffer",
  9: "Float16",
  10: "Float64",
  4464: "DenormPreserve",
  4465: "DenormFlushToZero",
  4466: "SignedZeroInfNanPreserve",
  4467: "RoundingModeRTE",
  4468: "RoundingModeRTZ",
  5008: "Float16ImageAMD",
  6029: "FloatControls2",
});
const SPIRV_FLOAT_CONTROL_MODES = Object.freeze({
  4459: "DenormPreserve",
  4460: "DenormFlushToZero",
  4461: "SignedZeroInfNanPreserve",
  4462: "RoundingModeRTE",
  4463: "RoundingModeRTZ",
});

export const OFFICIAL_SPIRV_PRECISION_SCHEMA =
  "pocket-card-render/official-spirv-precision@1";
export const SPIRV_PRECISION_STAGE_SCHEMA =
  "pocket-card-render/spirv-stage-precision@1";

export const DEFAULT_TEXTURE_DIMENSION_TYPES = Object.freeze({
  2: "sampler2D",
  3: "sampler3D",
  4: "samplerCube",
  5: "sampler2DArray",
  6: "samplerCubeArray",
});

function fail(message) {
  throw new Error(`exact selector port: ${message}`);
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

function nonEmptyString(value, label) {
  if (typeof value !== "string" || value.length === 0) fail(`${label} must be a non-empty string`);
  return value;
}

function integer(value, label, { min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    fail(`${label} must be an integer in [${min}, ${max}]`);
  }
  return value;
}

function hashString(value, label) {
  if (typeof value !== "string" || !HASH_PATTERN.test(value)) {
    fail(`${label} must be a lowercase SHA-256 hex string`);
  }
  return value;
}

function ownDataValue(owner, key, label) {
  const descriptor = Object.getOwnPropertyDescriptor(owner, key);
  if (!descriptor) fail(`${label}.${key} is absent`);
  if (descriptor.get || descriptor.set) fail(`${label}.${key} must not be an accessor`);
  return descriptor.value;
}

export function sha256(value) {
  if (!(typeof value === "string" || Buffer.isBuffer(value) || ArrayBuffer.isView(value))) {
    fail("sha256 input must be a string, Buffer, or typed array");
  }
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function sha256File(file) {
  nonEmptyString(file, "file");
  if (!fs.statSync(file, { throwIfNoEntry: false })?.isFile()) fail(`file is absent: ${file}`);
  return sha256(fs.readFileSync(file));
}

export function canonicalJson(value) {
  const active = new Set();

  function encode(item, label) {
    if (item === null) return "null";
    if (typeof item === "string" || typeof item === "boolean") return JSON.stringify(item);
    if (typeof item === "number") {
      if (!Number.isFinite(item)) fail(`${label} contains a non-finite number`);
      return JSON.stringify(item);
    }
    if (typeof item !== "object") fail(`${label} contains a non-JSON value`);
    if (active.has(item)) fail(`${label} contains a cycle`);
    active.add(item);
    try {
      if (Array.isArray(item)) {
        for (let index = 0; index < item.length; index += 1) {
          if (!Object.hasOwn(item, index)) fail(`${label}[${index}] is a sparse array entry`);
        }
        const unexpectedKeys = Reflect.ownKeys(item).filter((key) => (
          key !== "length" && (typeof key !== "string" || !/^(0|[1-9][0-9]*)$/.test(key))
        ));
        if (unexpectedKeys.length !== 0) {
          fail(`${label} contains a non-JSON array property`);
        }
        return `[${item.map((entry, index) => encode(entry, `${label}[${index}]`)).join(",")}]`;
      }
      record(item, label);
      const keys = Reflect.ownKeys(item);
      if (keys.some((key) => typeof key === "symbol")) fail(`${label} contains a symbol key`);
      return `{${keys.sort().map((key) => {
        const entry = ownDataValue(item, key, label);
        return `${JSON.stringify(key)}:${encode(entry, `${label}.${key}`)}`;
      }).join(",")}}`;
    } finally {
      active.delete(item);
    }
  }

  return encode(value, "canonical JSON input");
}

export function canonicalJsonSha256(value) {
  return sha256(canonicalJson(value));
}

function asSpirvBuffer(value) {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  if (ArrayBuffer.isView(value)) {
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  }
  fail("SPIR-V precision input must be a Buffer, ArrayBuffer, or typed array");
}

function increment(map, key, amount = 1) {
  map.set(key, (map.get(key) ?? 0) + amount);
}

function sortedCountRows(map, keyName, numeric = false) {
  return [...map.entries()]
    .sort(([left], [right]) => (
      numeric ? Number(left) - Number(right) : String(left).localeCompare(String(right))
    ))
    .map(([key, declarationCount]) => ({
      [keyName]: numeric ? Number(key) : key,
      declaration_count: declarationCount,
    }));
}

/**
 * Parse only precision and floating-point-control facts from an already
 * validated official SPIR-V module. The instruction-structure digest binds
 * exact target/member rows without inflating every generated manifest.
 */
export function parseSpirvPrecisionFacts(value) {
  const bytes = asSpirvBuffer(value);
  if (bytes.length < 20) fail("SPIR-V precision input is shorter than its five-word header");
  if (bytes.length % 4 !== 0) fail("SPIR-V precision input is not word aligned");
  const wordAt = (index) => bytes.readUInt32LE(index * 4);
  if (wordAt(0) !== SPIRV_MAGIC) fail("SPIR-V precision input has invalid magic");

  const versionWord = wordAt(1);
  const major = (versionWord >>> 16) & 0xff;
  const minor = (versionWord >>> 8) & 0xff;
  const revision = versionWord & 0xff;
  if (major !== 1 || minor > 6) {
    fail(`SPIR-V precision input has unsupported version ${major}.${minor}.${revision}`);
  }
  const generatorMagic = wordAt(2);
  const idBound = wordAt(3);
  const schemaWord = wordAt(4);
  if (idBound === 0) fail("SPIR-V precision input has zero id bound");
  if (schemaWord !== 0) fail(`SPIR-V precision input has unsupported schema word ${schemaWord}`);

  const capabilityCounts = new Map(
    Object.values(SPIRV_FLOAT_CAPABILITIES).map((name) => [name, 0]),
  );
  const floatTypeCounts = new Map();
  const decorationRows = [];
  const decorationGroups = new Set();
  const groupApplications = new Map();
  const quantizeRows = [];
  const floatControlRows = [];
  let instructionCount = 0;

  for (let offset = 5; offset < bytes.length / 4;) {
    const instruction = wordAt(offset);
    const wordCount = instruction >>> 16;
    const opcode = instruction & 0xffff;
    if (wordCount === 0 || offset + wordCount > bytes.length / 4) {
      fail(`SPIR-V precision input has malformed instruction at word ${offset}`);
    }
    const operands = Array.from(
      { length: wordCount - 1 },
      (_, index) => wordAt(offset + index + 1),
    );
    instructionCount += 1;

    if (opcode === SPIRV_OP.Capability) {
      if (wordCount !== 2) fail(`OpCapability at word ${offset} has invalid word count`);
      const name = SPIRV_FLOAT_CAPABILITIES[operands[0]];
      if (name) increment(capabilityCounts, name);
    } else if (opcode === SPIRV_OP.TypeFloat) {
      if (wordCount !== 3) fail(`OpTypeFloat at word ${offset} has invalid word count`);
      if (operands[1] === 0) fail(`OpTypeFloat at word ${offset} has zero width`);
      increment(floatTypeCounts, operands[1]);
    } else if (opcode === SPIRV_OP.DecorationGroup) {
      if (wordCount !== 2) fail(`OpDecorationGroup at word ${offset} has invalid word count`);
      if (decorationGroups.has(operands[0])) {
        fail(`OpDecorationGroup at word ${offset} repeats result id ${operands[0]}`);
      }
      decorationGroups.add(operands[0]);
    } else if (opcode === SPIRV_OP.GroupDecorate) {
      if (wordCount < 3) fail(`OpGroupDecorate at word ${offset} has invalid word count`);
      const [groupId, ...targets] = operands;
      const applications = groupApplications.get(groupId) ?? [];
      applications.push(...targets.map((targetId) => ({ target_id: targetId })));
      groupApplications.set(groupId, applications);
    } else if (opcode === SPIRV_OP.GroupMemberDecorate) {
      if (wordCount < 4 || (wordCount - 2) % 2 !== 0) {
        fail(`OpGroupMemberDecorate at word ${offset} has invalid word count`);
      }
      const [groupId, ...targetMembers] = operands;
      const applications = groupApplications.get(groupId) ?? [];
      for (let index = 0; index < targetMembers.length; index += 2) {
        applications.push({
          target_id: targetMembers[index],
          member_index: targetMembers[index + 1],
        });
      }
      groupApplications.set(groupId, applications);
    } else if (
      opcode === SPIRV_OP.Decorate
      || opcode === SPIRV_OP.MemberDecorate
      || opcode === SPIRV_OP.DecorateId
    ) {
      const member = opcode === SPIRV_OP.MemberDecorate;
      const minimum = member ? 3 : 2;
      if (operands.length < minimum) {
        fail(`precision decoration instruction at word ${offset} is truncated`);
      }
      const decorationIndex = member ? 2 : 1;
      const decorationValue = operands[decorationIndex];
      const decorationName = SPIRV_PRECISION_DECORATIONS[decorationValue];
      if (decorationName) {
        const parameters = operands.slice(decorationIndex + 1);
        const expectedParameterCount = (
          decorationName === "FPRoundingMode" || decorationName === "FPFastMathMode"
        ) ? 1 : 0;
        if (parameters.length !== expectedParameterCount) {
          fail(`${decorationName} at word ${offset} has invalid operand count`);
        }
        decorationRows.push({
          word_offset: offset,
          opcode: opcode === SPIRV_OP.Decorate
            ? "OpDecorate"
            : opcode === SPIRV_OP.MemberDecorate
              ? "OpMemberDecorate"
              : "OpDecorateId",
          target_id: operands[0],
          ...(member ? { member_index: operands[1] } : {}),
          decoration: decorationName,
          decoration_value: decorationValue,
          operands: parameters,
        });
      }
    } else if (opcode === SPIRV_OP.QuantizeToF16) {
      if (wordCount !== 4) fail(`OpQuantizeToF16 at word ${offset} has invalid word count`);
      quantizeRows.push({
        word_offset: offset,
        result_type_id: operands[0],
        result_id: operands[1],
        value_id: operands[2],
      });
    } else if (opcode === SPIRV_OP.ExecutionMode || opcode === SPIRV_OP.ExecutionModeId) {
      if (wordCount < 3) fail(`execution mode at word ${offset} is truncated`);
      const modeName = SPIRV_FLOAT_CONTROL_MODES[operands[1]];
      if (modeName) {
        const modeOperands = operands.slice(2);
        if (modeOperands.length !== 1) {
          fail(`${modeName} execution mode at word ${offset} has invalid operand count`);
        }
        floatControlRows.push({
          word_offset: offset,
          opcode: opcode === SPIRV_OP.ExecutionMode ? "OpExecutionMode" : "OpExecutionModeId",
          entry_point_id: operands[0],
          mode: modeName,
          mode_value: operands[1],
          operands: modeOperands,
        });
      }
    }
    offset += wordCount;
  }

  for (const groupId of groupApplications.keys()) {
    if (!decorationGroups.has(groupId)) {
      fail(`SPIR-V precision input references undeclared decoration group ${groupId}`);
    }
  }

  const decorations = {};
  for (const [decorationValue, decorationName] of Object.entries(SPIRV_PRECISION_DECORATIONS)) {
    const rows = decorationRows.filter((row) => row.decoration === decorationName);
    const instructionCounts = {
      decorate: rows.filter((row) => row.opcode === "OpDecorate").length,
      member_decorate: rows.filter((row) => row.opcode === "OpMemberDecorate").length,
      decorate_id: rows.filter((row) => row.opcode === "OpDecorateId").length,
    };
    let directApplications = 0;
    let groupApplicationsCount = 0;
    const operandSets = new Map();
    for (const row of rows) {
      increment(operandSets, canonicalJson(row.operands));
      if (decorationGroups.has(row.target_id)) {
        groupApplicationsCount += (groupApplications.get(row.target_id) ?? []).length;
      } else {
        directApplications += 1;
      }
    }
    decorations[decorationName] = {
      decoration_value: Number(decorationValue),
      instruction_counts: instructionCounts,
      source_instruction_count: rows.length,
      direct_application_count: directApplications,
      group_application_count: groupApplicationsCount,
      effective_application_count: directApplications + groupApplicationsCount,
      operand_sets: sortedCountRows(operandSets, "operands").map((row) => ({
        operands: JSON.parse(row.operands),
        declaration_count: row.declaration_count,
      })),
    };
  }

  const floatControlCounts = new Map();
  for (const row of floatControlRows) {
    const key = canonicalJson({
      opcode: row.opcode,
      mode: row.mode,
      mode_value: row.mode_value,
      operands: row.operands,
    });
    increment(floatControlCounts, key);
  }
  const floatControlExecutionModes = sortedCountRows(floatControlCounts, "fact").map((row) => ({
    ...JSON.parse(row.fact),
    declaration_count: row.declaration_count,
  }));
  const relevantGroupRows = [...new Set(
    decorationRows
      .filter((row) => decorationGroups.has(row.target_id))
      .map((row) => row.target_id),
  )].sort((left, right) => left - right).map((groupId) => ({
    group_id: groupId,
    applications: groupApplications.get(groupId) ?? [],
  }));
  const instructionStructure = {
    capabilities: Object.entries(SPIRV_FLOAT_CAPABILITIES)
      .flatMap(([value, name]) => Array.from(
        { length: capabilityCounts.get(name) },
        () => ({ capability: name, capability_value: Number(value) }),
      )),
    float_types: sortedCountRows(floatTypeCounts, "width", true),
    decorations: decorationRows,
    decoration_groups: relevantGroupRows,
    quantize_to_f16: quantizeRows,
    float_control_execution_modes: floatControlRows,
  };
  const facts = {
    schema: SPIRV_PRECISION_STAGE_SCHEMA,
    source_sha256: sha256(bytes),
    byte_size: bytes.length,
    word_count: bytes.length / 4,
    header: {
      version_word: versionWord,
      version: `${major}.${minor}.${revision}`,
      major,
      minor,
      revision,
      generator_magic: generatorMagic,
      id_bound: idBound,
      schema_word: schemaWord,
    },
    instruction_count: instructionCount,
    capabilities: Object.fromEntries(capabilityCounts),
    float_types: sortedCountRows(floatTypeCounts, "width", true),
    decorations,
    quantize_to_f16_count: quantizeRows.length,
    float_control_execution_modes: floatControlExecutionModes,
    instruction_structure_sha256: canonicalJsonSha256(instructionStructure),
  };
  return {
    ...facts,
    facts_sha256: canonicalJsonSha256(facts),
  };
}

export function buildOfficialSpirvPrecisionEvidence(value) {
  const stages = record(value, "official SPIR-V precision stages");
  return {
    schema: OFFICIAL_SPIRV_PRECISION_SCHEMA,
    evidence_scope: "official-vulkan-spirv-structure",
    vulkan_to_webgl_equivalence: "not-claimed",
    stages: {
      vertex: parseSpirvPrecisionFacts(
        ownDataValue(stages, "vertex", "official SPIR-V precision stages"),
      ),
      fragment: parseSpirvPrecisionFacts(
        ownDataValue(stages, "fragment", "official SPIR-V precision stages"),
      ),
    },
  };
}

const UNITY_OBJECT_AXIS_HELPERS = Object.freeze({
  0: {
    name: "pcrUnityObjectToWorldAxisX",
    body: "return vec3(-threeModelMatrix[0].x, -threeModelMatrix[0].y, threeModelMatrix[0].z);",
  },
  1: {
    name: "pcrUnityObjectToWorldAxisY",
    body: "return vec3(threeModelMatrix[1].x, threeModelMatrix[1].y, -threeModelMatrix[1].z);",
  },
  2: {
    name: "pcrUnityObjectToWorldAxisZ",
    body: "return vec3(threeModelMatrix[2].x, threeModelMatrix[2].y, -threeModelMatrix[2].z);",
  },
});

// Geometry remains in AssetRipper's A=diag(-1,1,1) basis and can be projected with Three's
// modelMatrix directly. A shader that reads unity_ObjectToWorld columns as numeric data needs the
// inverse boundary instead: M_unity = C * M_three * A, C=diag(1,1,-1). Replace only explicitly
// audited column reads and require exact occurrence counts so regenerated SPIR-V cannot drift open.
export function adaptUnityObjectToWorldDataAxes(source, options) {
  nonEmptyString(source, "GLSL source");
  const config = record(options, "Unity object-to-world data-axis options");
  const matrixName = nonEmptyString(
    ownDataValue(config, "matrixName", "Unity object-to-world data-axis options"),
    "matrixName",
  );
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(matrixName)) fail("matrixName must be a GLSL identifier");
  const expectedCounts = record(
    ownDataValue(config, "expectedCounts", "Unity object-to-world data-axis options"),
    "expectedCounts",
  );
  const columns = Object.keys(expectedCounts).map((key) => integer(Number(key), `column ${key}`, { min: 0, max: 2 }));
  if (columns.length === 0 || new Set(columns).size !== columns.length) fail("expectedCounts must name unique columns");

  let output = source;
  const helpers = [];
  for (const column of columns.sort()) {
    const expected = integer(expectedCounts[column], `expectedCounts.${column}`, { min: 1 });
    const token = `${matrixName}[${column}].xyz`;
    const count = output.split(token).length - 1;
    if (count !== expected) fail(`${token} occurrence count changed: expected ${expected}, got ${count}`);
    const helper = UNITY_OBJECT_AXIS_HELPERS[column];
    output = output.replaceAll(token, `${helper.name}(${matrixName})`);
    helpers.push(`highp vec3 ${helper.name}(highp mat4 threeModelMatrix)\n{\n    ${helper.body}\n}`);
  }
  const main = output.indexOf("void main() ") >= 0 ? output.indexOf("void main() ") : output.indexOf("void main()");
  if (main < 0) fail("GLSL source has no main function");
  return `${output.slice(0, main)}${helpers.join("\n\n")}\n\n${output.slice(main)}`;
}

// Three world vectors are related to Unity world vectors by C=diag(1,1,-1). When official shader
// arithmetic consumes world-space positions, normals, directions or camera values as numeric data,
// convert those inputs back to Unity's basis before replaying the official SSA.
export function adaptThreeWorldVectorsToUnityDataAxes(source, options) {
  nonEmptyString(source, "GLSL source");
  const config = record(options, "Three-to-Unity world-vector options");
  const bindings = array(
    ownDataValue(config, "bindings", "Three-to-Unity world-vector options"),
    "bindings",
  );
  if (bindings.length === 0) fail("world-vector bindings must not be empty");
  const main = source.indexOf("void main()");
  if (main < 0) fail("GLSL source has no main function");
  const brace = source.indexOf("{", main);
  if (brace < 0) fail("GLSL main function has no body");
  const header = source.slice(0, brace + 1);
  let body = source.slice(brace + 1);
  const declarations = [];
  const names = new Set();
  for (const [index, raw] of bindings.entries()) {
    const binding = record(raw, `bindings[${index}]`);
    const sourceName = nonEmptyString(ownDataValue(binding, "source", `bindings[${index}]`), `bindings[${index}].source`);
    const alias = nonEmptyString(ownDataValue(binding, "alias", `bindings[${index}]`), `bindings[${index}].alias`);
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(sourceName) || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(alias)) {
      fail(`bindings[${index}] names must be GLSL identifiers`);
    }
    if (sourceName === alias || names.has(sourceName) || names.has(alias) || source.includes(` ${alias}`)) {
      fail(`bindings[${index}] aliases must be unique and absent from the source`);
    }
    names.add(sourceName);
    names.add(alias);
    const expected = integer(
      ownDataValue(binding, "expectedOccurrences", `bindings[${index}]`),
      `bindings[${index}].expectedOccurrences`,
      { min: 1 },
    );
    const pattern = new RegExp(`\\b${sourceName}\\b`, "g");
    const count = (body.match(pattern) || []).length;
    if (count !== expected) {
      fail(`${sourceName} body occurrence count changed: expected ${expected}, got ${count}`);
    }
    body = body.replace(pattern, alias);
    declarations.push(`    highp vec3 ${alias} = vec3(${sourceName}.xy, -${sourceName}.z);`);
  }
  return `${header}\n${declarations.join("\n")}${body}`;
}

// Unity shader code commonly reconstructs the world-space camera forward vector from row Z of
// the view matrix. Three's world basis is C=diag(1,1,-1), so only the reconstructed vector's Z
// component must be flipped before official Unity-basis rotation or directional arithmetic.
export function adaptThreeViewForwardToUnityDataAxes(source, options) {
  nonEmptyString(source, "GLSL source");
  const config = record(options, "Three-to-Unity view-forward options");
  const matrixName = nonEmptyString(
    ownDataValue(config, "matrixName", "Three-to-Unity view-forward options"),
    "matrixName",
  );
  const targetName = nonEmptyString(
    ownDataValue(config, "targetName", "Three-to-Unity view-forward options"),
    "targetName",
  );
  for (const [label, name] of [["matrixName", matrixName], ["targetName", targetName]]) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) fail(`${label} must be a GLSL identifier`);
  }
  let output = source;
  for (const [component, column, sign] of [["x", 0, "-"], ["y", 1, "-"], ["z", 2, ""]]) {
    const pattern = new RegExp(
      `(^\\s*${targetName}\\.${component}\\s*=\\s*)-${matrixName}\\[${column}\\]\\.z(\\s*;\\s*$)`,
      "gm",
    );
    const matches = output.match(pattern) || [];
    if (matches.length !== 1) {
      fail(`${targetName}.${component} view-forward assignment changed: expected 1, got ${matches.length}`);
    }
    output = output.replace(pattern, `$1${sign}${matrixName}[${column}].z$2`);
  }
  return output;
}

export function officialPassParameter(value, label = "official pass parameter") {
  const input = record(value, label);
  const rawValue = ownDataValue(input, "val", label);
  const rawName = ownDataValue(input, "name", label);
  if (typeof rawValue !== "number" || !Number.isFinite(rawValue)) fail(`${label}.val must be finite`);
  if (typeof rawName !== "string") fail(`${label}.name must be a string`);
  return { val: rawValue, name: rawName === "<noninit>" ? null : rawName };
}

function compileBlend(value, label) {
  const blend = record(value, label);
  return {
    src_rgb: officialPassParameter(ownDataValue(blend, "srcBlend", label), `${label}.srcBlend`),
    dst_rgb: officialPassParameter(ownDataValue(blend, "destBlend", label), `${label}.destBlend`),
    src_alpha: officialPassParameter(ownDataValue(blend, "srcBlendAlpha", label), `${label}.srcBlendAlpha`),
    dst_alpha: officialPassParameter(ownDataValue(blend, "destBlendAlpha", label), `${label}.destBlendAlpha`),
    op_rgb: officialPassParameter(ownDataValue(blend, "blendOp", label), `${label}.blendOp`),
    op_alpha: officialPassParameter(ownDataValue(blend, "blendOpAlpha", label), `${label}.blendOpAlpha`),
    color_mask: officialPassParameter(ownDataValue(blend, "colMask", label), `${label}.colMask`),
  };
}

function compileStencil(value, label) {
  const stencil = record(value, label);
  const keys = Object.keys(stencil).sort();
  if (canonicalJson(keys) !== canonicalJson(STENCIL_KEYS)) {
    fail(`${label} fields changed: ${keys.join(",")}`);
  }
  return Object.fromEntries(STENCIL_KEYS.map((key) => [
    key,
    officialPassParameter(ownDataValue(stencil, key, label), `${label}.${key}`),
  ]));
}

function equalCanonical(actual, expected, label) {
  if (canonicalJson(actual) !== canonicalJson(expected)) fail(`${label} changed`);
}

export function compileOfficialPassContract(passContract, options = {}) {
  const contract = record(passContract, "pass contract");
  const config = record(options, "pass options");
  const sourceSha256 = hashString(ownDataValue(config, "sourceSha256", "pass options"), "sourceSha256");
  const policy = record(ownDataValue(config, "policy", "pass options"), "pass policy");
  const expectedSeparate = ownDataValue(policy, "rtSeparateBlend", "pass policy");
  if (typeof expectedSeparate !== "boolean") fail("pass policy.rtSeparateBlend must be boolean");
  const expectedFixed = record(ownDataValue(policy, "fixed", "pass policy"), "pass policy.fixed");

  const state = record(ownDataValue(contract, "state", "pass contract"), "pass contract.state");
  const rtSeparateBlend = ownDataValue(state, "rtSeparateBlend", "pass contract.state");
  if (typeof rtSeparateBlend !== "boolean") fail("pass contract.state.rtSeparateBlend must be boolean");
  if (rtSeparateBlend !== expectedSeparate) fail("official rtSeparateBlend is unsupported by this port policy");

  const fogMode = ownDataValue(state, "fogMode", "pass contract.state");
  const lighting = ownDataValue(state, "lighting", "pass contract.state");
  integer(fogMode, "pass contract.state.fogMode");
  if (typeof lighting !== "boolean") fail("pass contract.state.lighting must be boolean");
  const fixed = {
    zClip: officialPassParameter(ownDataValue(state, "zClip", "pass contract.state"), "state.zClip"),
    conservative: officialPassParameter(ownDataValue(state, "conservative", "pass contract.state"), "state.conservative"),
    offsetFactor: officialPassParameter(ownDataValue(state, "offsetFactor", "pass contract.state"), "state.offsetFactor"),
    offsetUnits: officialPassParameter(ownDataValue(state, "offsetUnits", "pass contract.state"), "state.offsetUnits"),
    alphaToMask: officialPassParameter(ownDataValue(state, "alphaToMask", "pass contract.state"), "state.alphaToMask"),
    fogMode,
    lighting,
  };
  equalCanonical(fixed, expectedFixed, "official fixed pass state");

  const result = {
    source_sha256: sourceSha256,
    shared_mrt_blend: !rtSeparateBlend,
    depth: {
      test: officialPassParameter(ownDataValue(state, "zTest", "pass contract.state"), "state.zTest"),
      write: officialPassParameter(ownDataValue(state, "zWrite", "pass contract.state"), "state.zWrite"),
    },
    culling: officialPassParameter(ownDataValue(state, "culling", "pass contract.state"), "state.culling"),
    stencil: {
      ref: officialPassParameter(ownDataValue(state, "stencilRef", "pass contract.state"), "state.stencilRef"),
      read_mask: officialPassParameter(ownDataValue(state, "stencilReadMask", "pass contract.state"), "state.stencilReadMask"),
      write_mask: officialPassParameter(ownDataValue(state, "stencilWriteMask", "pass contract.state"), "state.stencilWriteMask"),
      generic: compileStencil(ownDataValue(state, "stencilOp", "pass contract.state"), "state.stencilOp"),
      front: compileStencil(ownDataValue(state, "stencilOpFront", "pass contract.state"), "state.stencilOpFront"),
      back: compileStencil(ownDataValue(state, "stencilOpBack", "pass contract.state"), "state.stencilOpBack"),
    },
    fixed,
  };
  if (rtSeparateBlend) {
    result.blend_targets = Array.from({ length: 8 }, (_, index) => (
      compileBlend(ownDataValue(state, `rtBlend${index}`, "pass contract.state"), `state.rtBlend${index}`)
    ));
  } else {
    result.blend = compileBlend(ownDataValue(state, "rtBlend0", "pass contract.state"), "state.rtBlend0");
  }
  return result;
}

function compileNameTable(commonBindings) {
  const namesByIndex = new Map();
  const indicesByName = new Map();
  for (const [position, pair] of array(commonBindings.nameIndices, "commonBindings.nameIndices").entries()) {
    if (!Array.isArray(pair) || pair.length !== 2) fail(`nameIndices[${position}] must be [name, index]`);
    const name = nonEmptyString(pair[0], `nameIndices[${position}][0]`);
    const index = integer(pair[1], `nameIndices[${position}][1]`, { min: 0 });
    if (namesByIndex.has(index)) fail(`duplicate name index ${index}`);
    if (indicesByName.has(name)) fail(`duplicate common binding name ${name}`);
    namesByIndex.set(index, name);
    indicesByName.set(name, index);
  }
  return namesByIndex;
}

function resolveName(names, indexValue, label) {
  const index = integer(indexValue, `${label}.m_NameIndex`, { min: 0 });
  const name = names.get(index);
  if (!name) fail(`${label} references unknown name index ${index}`);
  return name;
}

function descriptorLocation(encodedIndex, label) {
  const encoded = integer(encodedIndex, `${label}.m_Index`, { min: -0x80000000, max: 0xffffffff });
  const unsigned = encoded >>> 0;
  return { encodedIndex: encoded, set: (unsigned >>> 16) & 0xff, binding: unsigned & 0xffff };
}

function compileMember(names, value, label, kind) {
  const item = record(value, label);
  const result = {
    name: resolveName(names, ownDataValue(item, "m_NameIndex", label), label),
    offset: integer(ownDataValue(item, "m_Index", label), `${label}.m_Index`, { min: 0 }),
    arraySize: integer(ownDataValue(item, "m_ArraySize", label), `${label}.m_ArraySize`, { min: 0 }),
    type: integer(ownDataValue(item, "m_Type", label), `${label}.m_Type`, { min: 0 }),
  };
  if (kind === "matrix") {
    result.rowCount = integer(ownDataValue(item, "m_RowCount", label), `${label}.m_RowCount`, { min: 1 });
  } else {
    result.dim = integer(ownDataValue(item, "m_Dim", label), `${label}.m_Dim`, { min: 1 });
  }
  return result;
}

function mergeStageRecord(byName, byLocation, base, stage, label, locationKey = null) {
  const priorName = byName.get(base.name);
  if (priorName && canonicalJson(priorName.base) !== canonicalJson(base)) {
    fail(`${label} ${base.name} differs by stage`);
  }
  if (locationKey !== null) {
    const priorLocation = byLocation.get(locationKey);
    if (priorLocation && priorLocation.name !== base.name) {
      fail(`${label} location ${locationKey} is shared by ${priorLocation.name} and ${base.name}`);
    }
    byLocation.set(locationKey, base);
  }
  if (priorName) {
    priorName.stages.add(stage);
  } else {
    byName.set(base.name, { base, stages: new Set([stage]) });
  }
}

function sortedStageRecords(map, compare) {
  return [...map.values()].map(({ base, stages }) => ({
    ...base,
    stages: [...stages].sort(),
  })).sort(compare);
}

export function compileCommonBindings(value) {
  const commonBindings = record(value, "commonBindings");
  const names = compileNameTable(commonBindings);
  const commonParameters = record(commonBindings.commonParameters, "commonBindings.commonParameters");
  const textures = new Map();
  const texturesByLocation = new Map();
  const constantBuffers = new Map();
  const constantBufferBindings = new Map();
  const constantBufferBindingsByLocation = new Map();

  for (const stage of Object.keys(commonParameters).sort()) {
    nonEmptyString(stage, "common binding stage");
    const common = record(commonParameters[stage], `commonParameters.${stage}`);
    for (const unsupported of ["m_BufferParams", "m_UAVParams", "m_Samplers"]) {
      if (array(common[unsupported] ?? [], `${stage}.${unsupported}`).length !== 0) {
        fail(`${stage}.${unsupported} is not supported by the exact port core`);
      }
    }
    for (const [index, raw] of array(common.m_TextureParams ?? [], `${stage}.m_TextureParams`).entries()) {
      const label = `${stage}.m_TextureParams[${index}]`;
      const item = record(raw, label);
      const location = descriptorLocation(ownDataValue(item, "m_Index", label), label);
      const base = {
        name: resolveName(names, ownDataValue(item, "m_NameIndex", label), label),
        ...location,
        samplerIndex: integer(ownDataValue(item, "m_SamplerIndex", label), `${label}.m_SamplerIndex`),
        multisampled: ownDataValue(item, "m_MultiSampled", label),
        dim: integer(ownDataValue(item, "m_Dim", label), `${label}.m_Dim`, { min: 1 }),
      };
      if (typeof base.multisampled !== "boolean") fail(`${label}.m_MultiSampled must be boolean`);
      mergeStageRecord(textures, texturesByLocation, base, stage, "texture binding", `${base.set}:${base.binding}`);
    }
    for (const [index, raw] of array(common.m_ConstantBuffers ?? [], `${stage}.m_ConstantBuffers`).entries()) {
      const label = `${stage}.m_ConstantBuffers[${index}]`;
      const item = record(raw, label);
      if (array(item.m_StructParams ?? [], `${label}.m_StructParams`).length !== 0) {
        fail(`${label}.m_StructParams is not supported by the exact port core`);
      }
      const partial = ownDataValue(item, "m_IsPartialCB", label);
      if (typeof partial !== "boolean") fail(`${label}.m_IsPartialCB must be boolean`);
      const base = {
        name: resolveName(names, ownDataValue(item, "m_NameIndex", label), label),
        size: integer(ownDataValue(item, "m_Size", label), `${label}.m_Size`, { min: 0 }),
        partial,
        matrices: array(item.m_MatrixParams ?? [], `${label}.m_MatrixParams`)
          .map((entry, memberIndex) => compileMember(names, entry, `${label}.m_MatrixParams[${memberIndex}]`, "matrix"))
          .sort((a, b) => a.offset - b.offset || a.name.localeCompare(b.name)),
        vectors: array(item.m_VectorParams ?? [], `${label}.m_VectorParams`)
          .map((entry, memberIndex) => compileMember(names, entry, `${label}.m_VectorParams[${memberIndex}]`, "vector"))
          .sort((a, b) => a.offset - b.offset || a.name.localeCompare(b.name)),
      };
      mergeStageRecord(constantBuffers, new Map(), base, stage, "constant buffer");
    }
    for (const [index, raw] of array(common.m_ConstantBufferBindings ?? [], `${stage}.m_ConstantBufferBindings`).entries()) {
      const label = `${stage}.m_ConstantBufferBindings[${index}]`;
      const item = record(raw, label);
      const location = descriptorLocation(ownDataValue(item, "m_Index", label), label);
      const base = {
        name: resolveName(names, ownDataValue(item, "m_NameIndex", label), label),
        ...location,
        arraySize: integer(ownDataValue(item, "m_ArraySize", label), `${label}.m_ArraySize`, { min: 0 }),
      };
      mergeStageRecord(
        constantBufferBindings,
        constantBufferBindingsByLocation,
        base,
        stage,
        "constant buffer binding",
        `${base.set}:${base.binding}`,
      );
    }
  }

  for (const binding of constantBufferBindings.values()) {
    if (!constantBuffers.has(binding.base.name)) {
      fail(`constant buffer binding ${binding.base.name} has no serialized constant buffer`);
    }
  }
  return {
    schema: "pocket-card-render/compiled-common-bindings@1",
    textures: sortedStageRecords(textures, (a, b) => a.set - b.set || a.binding - b.binding || a.name.localeCompare(b.name)),
    constant_buffers: sortedStageRecords(constantBuffers, (a, b) => a.name.localeCompare(b.name)),
    constant_buffer_bindings: sortedStageRecords(
      constantBufferBindings,
      (a, b) => a.set - b.set || a.binding - b.binding || a.name.localeCompare(b.name),
    ),
  };
}

function descriptorFromEncodedIndex(encodedIndex, label) {
  const encoded = integer(encodedIndex, label, { min: -0x80000000, max: 0xffffffff });
  const unsigned = encoded >>> 0;
  return { encodedIndex: encoded, set: (unsigned >>> 16) & 0xff, binding: unsigned & 0xffff };
}

function validateParameterField(value, label, bufferSize) {
  const field = record(value, label);
  const name = nonEmptyString(ownDataValue(field, "name", label), `${label}.name`);
  const offset = integer(ownDataValue(field, "offset", label), `${label}.offset`, { min: 0 });
  const descriptor = array(ownDataValue(field, "descriptor", label), `${label}.descriptor`)
    .map((entry, index) => integer(entry, `${label}.descriptor[${index}]`, { min: 0, max: 0xffffffff }));
  if (descriptor.length !== 6) fail(`${label}.descriptor must contain six words`);
  if (descriptor[5] !== offset) fail(`${label}.descriptor offset disagrees with ${label}.offset`);
  if (offset >= bufferSize) fail(`${label}.offset exceeds its constant buffer`);
  return { name, offset, descriptor };
}

export function compileProgramBindings(compiledCommonBindings, parameterReflection, shaderPropertyDefaults) {
  const common = record(compiledCommonBindings, "compiled common bindings");
  if (common.schema !== "pocket-card-render/compiled-common-bindings@1") {
    fail(`compiled common binding schema changed: ${common.schema}`);
  }
  const parameter = record(parameterReflection, "parameter reflection");
  const defaults = record(shaderPropertyDefaults, "shader property defaults");
  const textureDescriptors = record(defaults.textureDescriptors, "shader property texture descriptors");
  const commonTextures = array(common.textures, "compiled common bindings.textures");
  const commonByName = new Map();
  const textureByLocation = new Map();
  const textures = [];

  for (const [index, raw] of commonTextures.entries()) {
    const row = record(raw, `compiled common bindings.textures[${index}]`);
    const name = nonEmptyString(row.name, `compiled common bindings.textures[${index}].name`);
    const set = integer(row.set, `${name}.set`, { min: 0 });
    const binding = integer(row.binding, `${name}.binding`, { min: 0 });
    const dim = integer(row.dim, `${name}.dim`, { min: 1 });
    const encodedIndex = integer(row.encodedIndex, `${name}.encodedIndex`, { min: -0x80000000, max: 0xffffffff });
    const location = descriptorFromEncodedIndex(encodedIndex, `${name}.encodedIndex`);
    if (location.set !== set || location.binding !== binding) fail(`${name} encoded descriptor location changed`);
    const key = `${set}:${binding}`;
    if (commonByName.has(name)) fail(`duplicate common texture name ${name}`);
    if (textureByLocation.has(key)) fail(`duplicate program texture binding ${key}`);
    const compiled = { ...row, source: "serialized-common" };
    commonByName.set(name, compiled);
    textureByLocation.set(key, compiled);
    textures.push(compiled);
  }

  const serializedCommon = array(parameter.serializedCommonTextures, "parameter reflection.serializedCommonTextures");
  if (serializedCommon.length !== commonByName.size) fail("parameter/common texture declaration count changed");
  for (const [index, raw] of serializedCommon.entries()) {
    const row = record(raw, `parameter reflection.serializedCommonTextures[${index}]`);
    const name = nonEmptyString(row.name, `parameter reflection.serializedCommonTextures[${index}].name`);
    const compiled = commonByName.get(name);
    if (!compiled) fail(`parameter common texture ${name} is absent from serialized common bindings`);
    const encodedIndex = integer(row.encodedIndex, `${name}.encodedIndex`, { min: -0x80000000, max: 0xffffffff });
    const location = descriptorFromEncodedIndex(encodedIndex, `${name}.encodedIndex`);
    if (integer(row.binding, `${name}.binding`, { min: 0 }) !== (encodedIndex & 0xffffff)
        || location.set !== compiled.set || location.binding !== compiled.binding
        || integer(row.dim, `${name}.dim`, { min: 1 }) !== compiled.dim) {
      fail(`parameter common texture ${name} disagrees with serialized common bindings`);
    }
  }

  for (const [index, raw] of array(parameter.textures, "parameter reflection.textures").entries()) {
    const label = `parameter reflection.textures[${index}]`;
    const row = record(raw, label);
    const name = nonEmptyString(ownDataValue(row, "name", label), `${label}.name`);
    if (commonByName.has(name) || textures.some((entry) => entry.name === name)) {
      fail(`duplicate program texture name ${name}`);
    }
    const descriptor = array(ownDataValue(row, "descriptor", label), `${label}.descriptor`)
      .map((entry, word) => integer(entry, `${label}.descriptor[${word}]`, { min: 0, max: 0xffffffff }));
    if (descriptor.length !== 4) fail(`${label}.descriptor must contain four words`);
    const encodedIndex = integer(ownDataValue(row, "encodedIndex", label), `${label}.encodedIndex`, { min: 0, max: 0xffffffff });
    if (descriptor[1] !== encodedIndex) fail(`${label}.descriptor encoded index changed`);
    if (integer(ownDataValue(row, "binding", label), `${label}.binding`, { min: 0 }) !== (encodedIndex & 0xffffff)) {
      fail(`${label}.binding disagrees with encoded index`);
    }
    const location = descriptorFromEncodedIndex(encodedIndex, `${label}.encodedIndex`);
    const key = `${location.set}:${location.binding}`;
    if (textureByLocation.has(key)) fail(`duplicate program texture binding ${key}`);
    const property = record(ownDataValue(textureDescriptors, name, "shader property texture descriptors"), `texture descriptor ${name}`);
    const dim = integer(ownDataValue(property, "dimension", `texture descriptor ${name}`), `${name}.dimension`, { min: 1 });
    const defaultName = ownDataValue(property, "defaultName", `texture descriptor ${name}`);
    if (typeof defaultName !== "string") fail(`${name}.defaultName must be a string`);
    const compiled = {
      name,
      ...location,
      dim,
      defaultName,
      parameterDescriptor: descriptor,
      source: "variant-local",
    };
    textureByLocation.set(key, compiled);
    textures.push(compiled);
  }

  const compiledCommonBuffers = array(common.constant_buffers, "compiled common bindings.constant_buffers");
  const serializedCommonBuffers = array(parameter.serializedCommonBuffers, "parameter reflection.serializedCommonBuffers")
    .map((raw, index) => {
      const row = record(raw, `parameter reflection.serializedCommonBuffers[${index}]`);
      return {
        name: nonEmptyString(row.name, `parameter reflection.serializedCommonBuffers[${index}].name`),
        size: integer(row.size, `parameter reflection.serializedCommonBuffers[${index}].size`, { min: 0 }),
      };
    }).sort((a, b) => a.name.localeCompare(b.name));
  const compiledCommonBufferSummary = compiledCommonBuffers.map((row, index) => ({
    name: nonEmptyString(row.name, `compiled common bindings.constant_buffers[${index}].name`),
    size: integer(row.size, `compiled common bindings.constant_buffers[${index}].size`, { min: 0 }),
  })).sort((a, b) => a.name.localeCompare(b.name));
  equalCanonical(serializedCommonBuffers, compiledCommonBufferSummary, "parameter/common constant buffer declarations");

  const variantBindings = new Map();
  const variantBindingLocations = new Set();
  for (const [index, raw] of array(parameter.constantBufferBindings, "parameter reflection.constantBufferBindings").entries()) {
    const label = `parameter reflection.constantBufferBindings[${index}]`;
    const row = record(raw, label);
    const name = nonEmptyString(ownDataValue(row, "name", label), `${label}.name`);
    if (variantBindings.has(name)) fail(`duplicate variant constant buffer binding ${name}`);
    const descriptor = array(ownDataValue(row, "descriptor", label), `${label}.descriptor`)
      .map((entry, word) => integer(entry, `${label}.descriptor[${word}]`, { min: 0, max: 0xffffffff }));
    if (descriptor.length !== 3) fail(`${label}.descriptor must contain three words`);
    const location = descriptorFromEncodedIndex(descriptor[1], `${label}.descriptor[1]`);
    const key = `${location.set}:${location.binding}`;
    if (variantBindingLocations.has(key)) fail(`duplicate variant constant buffer location ${key}`);
    variantBindingLocations.add(key);
    variantBindings.set(name, { name, ...location, stageCode: descriptor[0], trailingWord: descriptor[2], descriptor });
  }

  const variantConstantBuffers = [];
  const declaredVariantNames = new Set();
  for (const [index, raw] of array(parameter.constantBuffers, "parameter reflection.constantBuffers").entries()) {
    const label = `parameter reflection.constantBuffers[${index}]`;
    const row = record(raw, label);
    const name = ownDataValue(row, "name", label);
    if (typeof name !== "string") fail(`${label}.name must be a string`);
    const size = integer(ownDataValue(row, "size", label), `${label}.size`, { min: 0 });
    const rawFields = array(ownDataValue(row, "fields", label), `${label}.fields`);
    if (name === "") {
      if (size !== 0 || rawFields.length !== 0) fail("anonymous parameter constant buffer is not empty");
      continue;
    }
    const commonDeclaration = compiledCommonBufferSummary.find((entry) => entry.name === name);
    if (commonDeclaration) {
      if (size !== commonDeclaration.size) fail(`parameter common constant buffer ${name} size changed`);
      continue;
    }
    if (declaredVariantNames.has(name)) fail(`duplicate variant constant buffer ${name}`);
    declaredVariantNames.add(name);
    const binding = variantBindings.get(name);
    if (!binding) fail(`variant constant buffer ${name} has no descriptor binding`);
    const fieldNames = new Set();
    const fieldOffsets = new Set();
    const fields = rawFields.map((field, fieldIndex) => {
      const compiled = validateParameterField(field, `${label}.fields[${fieldIndex}]`, size);
      if (fieldNames.has(compiled.name)) fail(`duplicate field ${compiled.name} in ${name}`);
      if (fieldOffsets.has(compiled.offset)) fail(`duplicate field offset ${compiled.offset} in ${name}`);
      fieldNames.add(compiled.name);
      fieldOffsets.add(compiled.offset);
      return compiled;
    }).sort((a, b) => a.offset - b.offset || a.name.localeCompare(b.name));
    variantConstantBuffers.push({ name, size, fields, binding, source: "variant-local" });
  }
  if (variantBindings.size !== variantConstantBuffers.length) {
    fail("variant constant buffer declarations and bindings are not one-to-one");
  }

  const closure = record(parameter.bindingClosure, "parameter reflection.bindingClosure");
  const commonBufferCount = compiledCommonBufferSummary.length;
  const variantBufferCount = variantConstantBuffers.length;
  const expectedMode = commonBufferCount && variantBufferCount
    ? "mixed-common-and-variant"
    : commonBufferCount ? "serialized-common" : variantBufferCount ? "variant-local" : "none";
  const expectedClosure = {
    constantBuffersMatch: true,
    constantBufferDeclarationMode: expectedMode,
    commonConstantBufferCount: commonBufferCount,
    variantConstantBufferCount: variantBufferCount,
    variantTextureCount: textures.filter((row) => row.source === "variant-local").length,
    commonTextureCount: commonByName.size,
    constantBufferBindingCount: variantBindings.size,
  };
  equalCanonical(closure, expectedClosure, "parameter binding closure");

  return {
    schema: "pocket-card-render/compiled-program-bindings@1",
    textures: textures.sort((a, b) => a.set - b.set || a.binding - b.binding || a.name.localeCompare(b.name)),
    common_constant_buffers: compiledCommonBuffers,
    common_constant_buffer_bindings: array(common.constant_buffer_bindings, "compiled common bindings.constant_buffer_bindings"),
    variant_constant_buffers: variantConstantBuffers.sort((a, b) => a.name.localeCompare(b.name)),
  };
}

export function joinProgramConstantBufferStages(compiledBindings, reflections) {
  const bindings = record(compiledBindings, "compiled program bindings");
  const stages = record(reflections, "program SPIRV-Cross reflections");
  const lists = [
    ["common_constant_buffers", array(bindings.common_constant_buffers, "common_constant_buffers")],
    ["variant_constant_buffers", array(bindings.variant_constant_buffers, "variant_constant_buffers")],
  ];
  const compiledRows = lists.flatMap(([, rows]) => rows);
  const compiledSizeCounts = new Map();
  for (const [index, raw] of compiledRows.entries()) {
    const row = record(raw, `compiled constant buffer ${index}`);
    const size = integer(row.size, `compiled constant buffer ${index}.size`, { min: 1 });
    compiledSizeCounts.set(size, (compiledSizeCounts.get(size) ?? 0) + 1);
  }
  const reflectedByStage = {};
  for (const stage of ["vertex", "fragment"]) {
    const reflection = record(ownDataValue(stages, stage, "program SPIRV-Cross reflections"), `${stage} reflection`);
    reflectedByStage[stage] = array(reflection.ubos ?? [], `${stage} reflection.ubos`).map((raw, index) => {
      const row = record(raw, `${stage} reflection.ubos[${index}]`);
      return {
        name: nonEmptyString(ownDataValue(row, "name", `${stage} reflection.ubos[${index}]`), `${stage} reflection.ubos[${index}].name`),
        size: integer(ownDataValue(row, "block_size", `${stage} reflection.ubos[${index}]`), `${stage} reflection.ubos[${index}].block_size`, { min: 1 }),
      };
    });
  }
  const consumed = new Set();
  const joinRows = (rows, label) => rows.map((raw, index) => {
    const row = record(raw, `${label}[${index}]`);
    const size = integer(row.size, `${label}[${index}].size`, { min: 1 });
    if (compiledSizeCounts.get(size) !== 1) {
      fail(`${label}[${index}] size ${size} is not unique across official program buffers`);
    }
    const matchedStages = [];
    for (const stage of ["vertex", "fragment"]) {
      const matches = reflectedByStage[stage].filter((entry) => entry.size === size);
      if (matches.length > 1) fail(`${stage} reflection has ambiguous ${size}-byte UBOs`);
      if (matches.length === 1) {
        matchedStages.push(stage === "vertex" ? "progVertex" : "progFragment");
        consumed.add(`${stage}:${matches[0].name}:${size}`);
      }
    }
    if (matchedStages.length === 0) {
      fail(`${label}[${index}] ${row.name} has no reflected stage owner`);
    }
    return { ...row, stages: matchedStages };
  });
  const joined = {
    ...bindings,
    common_constant_buffers: joinRows(lists[0][1], lists[0][0]),
    variant_constant_buffers: joinRows(lists[1][1], lists[1][0]),
  };
  const reflectedCount = reflectedByStage.vertex.length + reflectedByStage.fragment.length;
  if (consumed.size !== reflectedCount) {
    fail(`reflected UBO closure is incomplete: consumed ${consumed.size}/${reflectedCount}`);
  }
  return joined;
}

export function joinSamplerBindings(compiledBindings, reflection, options = {}) {
  const bindings = record(compiledBindings, "compiled bindings");
  const reflected = record(reflection, "SPIRV-Cross reflection");
  const config = record(options, "sampler join options");
  const dimensionTypes = record(config.dimensionTypes ?? DEFAULT_TEXTURE_DIMENSION_TYPES, "dimensionTypes");
  const official = array(bindings.textures, "compiled bindings.textures");
  const reflectedTextures = array(reflected.textures ?? [], "reflection.textures");
  const officialByLocation = new Map();
  for (const [index, raw] of official.entries()) {
    const row = record(raw, `compiled bindings.textures[${index}]`);
    const set = integer(row.set, `compiled bindings.textures[${index}].set`, { min: 0 });
    const binding = integer(row.binding, `compiled bindings.textures[${index}].binding`, { min: 0 });
    const key = `${set}:${binding}`;
    if (officialByLocation.has(key)) fail(`duplicate official sampler binding ${key}`);
    officialByLocation.set(key, row);
  }

  const reflectedLocations = new Set();
  const result = reflectedTextures.map((raw, index) => {
    const row = record(raw, `reflection.textures[${index}]`);
    const set = integer(ownDataValue(row, "set", `reflection.textures[${index}]`), `reflection.textures[${index}].set`, { min: 0 });
    const binding = integer(ownDataValue(row, "binding", `reflection.textures[${index}]`), `reflection.textures[${index}].binding`, { min: 0 });
    const key = `${set}:${binding}`;
    if (reflectedLocations.has(key)) fail(`duplicate reflected sampler binding ${key}`);
    reflectedLocations.add(key);
    const source = officialByLocation.get(key);
    if (!source) fail(`reflected sampler binding ${key} is absent from official common bindings`);
    const expectedType = dimensionTypes[source.dim];
    if (typeof expectedType !== "string" || expectedType.length === 0) {
      fail(`official texture dimension ${source.dim} has no supported GLSL sampler type`);
    }
    const type = nonEmptyString(ownDataValue(row, "type", `reflection.textures[${index}]`), `reflection.textures[${index}].type`);
    if (type !== expectedType) fail(`${source.name} dimension ${source.dim} requires ${expectedType}, got ${type}`);
    return {
      slot: nonEmptyString(source.name, `official sampler ${key}.name`),
      spirvName: nonEmptyString(ownDataValue(row, "name", `reflection.textures[${index}]`), `reflection.textures[${index}].name`),
      set,
      binding,
      dimension: source.dim,
      glslType: type,
    };
  }).sort((a, b) => a.set - b.set || a.binding - b.binding || a.slot.localeCompare(b.slot));

  for (const key of officialByLocation.keys()) {
    if (!reflectedLocations.has(key)) fail(`official sampler binding ${key} is absent from SPIRV-Cross reflection`);
  }
  return result;
}

export function joinProgramSamplerBindings(compiledBindings, reflections, options = {}) {
  const stages = record(reflections, "program SPIRV-Cross reflections");
  const reflectedByLocation = new Map();
  for (const stage of ["vertex", "fragment"]) {
    const reflection = record(ownDataValue(stages, stage, "program SPIRV-Cross reflections"), `${stage} reflection`);
    for (const [index, raw] of array(reflection.textures ?? [], `${stage} reflection.textures`).entries()) {
      const row = record(raw, `${stage} reflection.textures[${index}]`);
      const set = integer(ownDataValue(row, "set", `${stage} reflection.textures[${index}]`), `${stage} reflection.textures[${index}].set`, { min: 0 });
      const binding = integer(ownDataValue(row, "binding", `${stage} reflection.textures[${index}]`), `${stage} reflection.textures[${index}].binding`, { min: 0 });
      const key = `${set}:${binding}`;
      const current = {
        name: nonEmptyString(ownDataValue(row, "name", `${stage} reflection.textures[${index}]`), `${stage} reflection.textures[${index}].name`),
        type: nonEmptyString(ownDataValue(row, "type", `${stage} reflection.textures[${index}]`), `${stage} reflection.textures[${index}].type`),
      };
      const previous = reflectedByLocation.get(key);
      if (previous && (previous.name !== current.name || previous.type !== current.type)) {
        fail(`reflected sampler binding ${key} differs between ${previous.stages.join("/")} and ${stage}`);
      }
      if (previous) previous.stages.push(stage);
      else reflectedByLocation.set(key, { ...current, set, binding, stages: [stage] });
    }
  }
  const joined = joinSamplerBindings(compiledBindings, {
    textures: [...reflectedByLocation.values()].map(({ name, type, set, binding }) => ({ name, type, set, binding })),
  }, options);
  return joined.map((row) => ({ ...row, stages: reflectedByLocation.get(`${row.set}:${row.binding}`).stages }));
}

export function runCommand(command, args, options = {}) {
  nonEmptyString(command, "command");
  array(args, "command arguments");
  try {
    return execFileSync(command, args, {
      cwd: options.cwd ?? MODULE_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      shell: options.shell ?? process.platform === "win32",
    });
  } catch (error) {
    const stderr = Buffer.isBuffer(error?.stderr) ? error.stderr.toString("utf8") : String(error?.stderr ?? "");
    const stdout = Buffer.isBuffer(error?.stdout) ? error.stdout.toString("utf8") : String(error?.stdout ?? "");
    const detail = stderr.trim() || stdout.trim() || String(error?.message ?? "").trim();
    fail(`${command} failed${detail ? `: ${detail}` : ""}`);
  }
}

export function reflectSpirv(file, options = {}) {
  nonEmptyString(file, "SPIR-V file");
  if (!fs.statSync(file, { throwIfNoEntry: false })?.isFile()) fail(`SPIR-V file is absent: ${file}`);
  const config = record(options, "reflection options");
  const runner = config.commandRunner ?? runCommand;
  if (typeof runner !== "function") fail("reflection commandRunner must be a function");
  const executable = nonEmptyString(config.spirvCross ?? process.env.SPIRV_CROSS ?? "spirv-cross", "spirvCross");
  let parsed;
  try {
    const output = runner(executable, [file, "--reflect"], { cwd: config.cwd ?? MODULE_ROOT });
    if (output && typeof output.then === "function") fail("reflection commandRunner must be synchronous");
    parsed = JSON.parse(Buffer.isBuffer(output) ? output.toString("utf8") : String(output));
  } catch (error) {
    if (String(error?.message).startsWith("exact selector port:")) throw error;
    fail(`SPIRV-Cross reflection is invalid: ${error.message}`);
  }
  record(parsed, "SPIRV-Cross reflection result");
  for (const key of ["inputs", "outputs", "textures", "ubos"]) {
    if (parsed[key] !== undefined && !Array.isArray(parsed[key])) fail(`reflection.${key} must be an array`);
  }
  return parsed;
}

const THREE_ATTRIBUTE_BY_SHADER_CHANNEL = Object.freeze({
  Vertex: "position",
  Normal: "normal",
  Tangent: "tangent",
  Color: "color",
  UV0: "uv",
  UV1: "uv1",
  UV2: "uv2",
  UV3: "uv3",
  UV4: "uv4",
  UV5: "uv5",
  UV6: "uv6",
  UV7: "uv7",
  SkinWeight: "skinWeight",
  SkinBoneIndex: "skinIndex",
});

export function compileOfficialVertexInputContract(programBindChannels, vertexReflection) {
  const serialized = record(programBindChannels, "program bind channels");
  const storedHash = hashString(ownDataValue(serialized, "sha256", "program bind channels"), "program bind channels.sha256");
  const canonicalSource = Object.fromEntries(
    Object.entries(serialized).filter(([key]) => key !== "sha256"),
  );
  if (canonicalJsonSha256(canonicalSource) !== storedHash) fail("program bind-channel hash changed");
  const reflection = record(vertexReflection, "vertex SPIRV-Cross reflection");
  const reflectedByLocation = new Map();
  for (const [index, raw] of array(reflection.inputs ?? [], "vertex reflection.inputs").entries()) {
    const row = record(raw, `vertex reflection.inputs[${index}]`);
    const location = integer(ownDataValue(row, "location", `vertex reflection.inputs[${index}]`), `vertex reflection.inputs[${index}].location`, { min: 0 });
    if (reflectedByLocation.has(location)) fail(`vertex input location ${location} is duplicated`);
    reflectedByLocation.set(location, {
      location,
      spirvName: nonEmptyString(ownDataValue(row, "name", `vertex reflection.inputs[${index}]`), `vertex reflection.inputs[${index}].name`),
      spirvType: nonEmptyString(ownDataValue(row, "type", `vertex reflection.inputs[${index}]`), `vertex reflection.inputs[${index}].type`),
    });
  }
  const channels = array(ownDataValue(serialized, "bindChannels", "program bind channels"), "program bind channels.bindChannels");
  const usedLocations = new Set();
  const inputs = channels.map((raw, index) => {
    const row = record(raw, `program bind channels.bindChannels[${index}]`);
    const target = integer(ownDataValue(row, "target", `bind channel ${index}`), `bind channel ${index}.target`, { min: 13, max: 28 });
    const expectedTargetName = `Attrib${target - 12}`;
    if (row.targetName !== expectedTargetName) fail(`bind channel ${index} target name changed`);
    // Unity's Vulkan generic Attrib1 starts at SPIR-V location 0. This
    // version-locked relation is checked against reflection for every port.
    const location = target - 13;
    const reflected = reflectedByLocation.get(location);
    if (!reflected) fail(`bind channel ${index} has no SPIR-V input at location ${location}`);
    if (usedLocations.has(location)) fail(`bind channel location ${location} is duplicated`);
    usedLocations.add(location);
    const sourceName = nonEmptyString(ownDataValue(row, "sourceName", `bind channel ${index}`), `bind channel ${index}.sourceName`);
    const threeAttribute = THREE_ATTRIBUTE_BY_SHADER_CHANNEL[sourceName];
    if (!threeAttribute) fail(`bind channel ${index} has unsupported source semantic ${sourceName}`);
    return {
      source: integer(ownDataValue(row, "source", `bind channel ${index}`), `bind channel ${index}.source`, { min: 0 }),
      sourceName,
      target,
      targetName: row.targetName,
      location,
      threeAttribute,
      ...reflected,
    };
  });
  if (usedLocations.size !== reflectedByLocation.size) {
    const unbound = [...reflectedByLocation.keys()].filter((location) => !usedLocations.has(location)).sort((a, b) => a - b);
    fail(`SPIR-V vertex inputs are absent from official bind channels: ${unbound.join(",")}`);
  }
  return {
    schema: "pocket-card-render/official-vertex-input-contract@1",
    unityVersion: "2022.3.62f2",
    sourceSha256: storedHash,
    serializedSourceMap: integer(ownDataValue(serialized, "serializedSourceMap", "program bind channels"), "program bind channels.serializedSourceMap", { min: 0 }),
    inputs,
  };
}

export function validateSpirv(file, options = {}) {
  nonEmptyString(file, "SPIR-V file");
  if (!fs.statSync(file, { throwIfNoEntry: false })?.isFile()) fail(`SPIR-V file is absent: ${file}`);
  const config = record(options, "SPIR-V validation options");
  const runner = config.commandRunner ?? runCommand;
  if (typeof runner !== "function") fail("SPIR-V validation commandRunner must be a function");
  const executable = nonEmptyString(config.spirvVal ?? process.env.SPIRV_VAL ?? "spirv-val", "spirvVal");
  const output = runner(executable, [file], { cwd: config.cwd ?? MODULE_ROOT });
  if (output && typeof output.then === "function") fail("SPIR-V validation commandRunner must be synchronous");
}

function inside(parent, candidate, label) {
  const relative = path.relative(parent, candidate);
  if (relative === "" || relative.startsWith(`..${path.sep}`) || relative === ".." || path.isAbsolute(relative)) {
    fail(`${label} escapes its root`);
  }
  return candidate;
}

function readJsonFile(file, label) {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    fail(`${label} is unreadable JSON: ${error.message}`);
  }
  return record(parsed, label);
}

function verifyArtifact(tempDir, metadata, key) {
  const artifacts = record(metadata.artifacts, "selector metadata.artifacts");
  const artifact = record(ownDataValue(artifacts, key, "selector metadata.artifacts"), `artifact ${key}`);
  const relativePath = nonEmptyString(ownDataValue(artifact, "path", `artifact ${key}`), `artifact ${key}.path`);
  const file = inside(tempDir, path.resolve(tempDir, relativePath), `artifact ${key}`);
  if (!fs.statSync(file, { throwIfNoEntry: false })?.isFile()) fail(`artifact ${key} is absent`);
  const bytes = fs.readFileSync(file);
  const byteSize = integer(ownDataValue(artifact, "byteSize", `artifact ${key}`), `artifact ${key}.byteSize`, { min: 0 });
  if (bytes.length !== byteSize) fail(`artifact ${key} byte size changed`);
  const expectedHash = hashString(ownDataValue(artifact, "sha256", `artifact ${key}`), `artifact ${key}.sha256`);
  if (sha256(bytes) !== expectedHash) fail(`artifact ${key} SHA-256 changed`);
  return file;
}

function validateSelectorMetadata(metadata, expected, tempDir) {
  if (metadata.schema !== expected.schema) fail(`selector metadata schema changed: ${metadata.schema}`);
  const inventory = record(metadata.inventory, "selector metadata.inventory");
  if (inventory.proofGraphSha256 !== expected.proofGraphSha256) fail("selector proof graph hash changed");
  if (inventory.portIndexSha256 !== expected.portIndexSha256) fail("selector port index hash changed");
  const selector = record(metadata.selector, "selector metadata.selector");
  if (selector.selectorId !== expected.selectorId) fail("extracted selectorId changed");
  if (selector.candidateWitnessId !== expected.candidateWitnessId) fail("extracted candidateWitnessId changed");

  const files = {
    vertexSpirv: verifyArtifact(tempDir, metadata, "vertex"),
    fragmentSpirv: verifyArtifact(tempDir, metadata, "fragment"),
    parameterEntry: verifyArtifact(tempDir, metadata, "parameterEntry"),
  };
  const identity = record(metadata.identityFields, "selector metadata.identityFields");
  const identityChecks = [
    ["vertexSpirvSha256", files.vertexSpirv],
    ["fragmentSpirvSha256", files.fragmentSpirv],
    ["parameterEntrySha256", files.parameterEntry],
  ];
  for (const [key, file] of identityChecks) {
    const expectedHash = hashString(ownDataValue(identity, key, "identityFields"), `identityFields.${key}`);
    if (sha256File(file) !== expectedHash) fail(`${key} does not match extracted artifact`);
  }
  hashString(ownDataValue(identity, "passStateSha256", "identityFields"), "identityFields.passStateSha256");
  const commonHash = hashString(
    ownDataValue(identity, "commonBindingsSha256", "identityFields"),
    "identityFields.commonBindingsSha256",
  );
  if (canonicalJsonSha256(metadata.commonBindings) !== commonHash) fail("common bindings canonical hash changed");
  const reflectionHash = hashString(metadata.parameterReflectionSha256, "parameterReflectionSha256");
  if (canonicalJsonSha256(metadata.parameterReflection) !== reflectionHash) fail("parameter reflection canonical hash changed");
  record(metadata.passContract, "selector metadata.passContract");
  return files;
}

export async function withExtractedSelectorProgram(options, callback) {
  const config = record(options, "selector extraction options");
  if (typeof callback !== "function") fail("selector extraction callback must be a function");
  const selectorId = hashString(ownDataValue(config, "selectorId", "selector extraction options"), "selectorId");
  const candidateWitnessId = hashString(
    ownDataValue(config, "candidateWitnessId", "selector extraction options"),
    "candidateWitnessId",
  );
  const proofGraphSha256 = hashString(
    ownDataValue(config, "expectedProofGraphSha256", "selector extraction options"),
    "expectedProofGraphSha256",
  );
  const portIndexSha256 = hashString(
    ownDataValue(config, "expectedPortIndexSha256", "selector extraction options"),
    "expectedPortIndexSha256",
  );
  const prefix = nonEmptyString(ownDataValue(config, "prefix", "selector extraction options"), "prefix");
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(prefix)) fail("prefix contains unsafe path characters");
  const decryptedRoot = path.resolve(nonEmptyString(
    ownDataValue(config, "decryptedRoot", "selector extraction options"),
    "decryptedRoot",
  ));
  if (!fs.statSync(decryptedRoot, { throwIfNoEntry: false })?.isDirectory()) fail("decryptedRoot is absent");
  const rootDir = path.resolve(config.rootDir ?? MODULE_ROOT);
  const extractor = path.resolve(config.extractor ?? path.join(rootDir, "build", "extract_official_selector_program.py"));
  if (!fs.statSync(extractor, { throwIfNoEntry: false })?.isFile()) fail(`selector extractor is absent: ${extractor}`);
  const python = nonEmptyString(config.python ?? process.env.PYTHON ?? "python", "python");
  const runner = config.commandRunner ?? runCommand;
  if (typeof runner !== "function") fail("selector extraction commandRunner must be a function");
  const tempParent = path.resolve(config.tempParent ?? os.tmpdir());
  fs.mkdirSync(tempParent, { recursive: true });
  const tempDir = fs.mkdtempSync(path.join(tempParent, "pcr-exact-selector-port-"));
  try {
    const metadataFile = path.join(tempDir, "selector.json");
    const args = [
      extractor,
      "--selector-id", selectorId,
      "--candidate-witness-id", candidateWitnessId,
      "--expected-proof-graph-sha256", proofGraphSha256,
      "--expected-port-index-sha256", portIndexSha256,
      "--decrypted-root", decryptedRoot,
      "--out", tempDir,
      "--prefix", prefix,
      "--metadata", metadataFile,
    ];
    const processOutput = runner(python, args, { cwd: rootDir });
    if (processOutput && typeof processOutput.then === "function") {
      fail("selector extraction commandRunner must be synchronous");
    }
    if (!fs.statSync(metadataFile, { throwIfNoEntry: false })?.isFile()) fail("selector extractor wrote no metadata");
    const metadata = readJsonFile(metadataFile, "selector metadata");
    const files = validateSelectorMetadata(metadata, {
      schema: config.metadataSchema ?? "pocket-card-render/official-selector-program-extract@1",
      selectorId,
      candidateWitnessId,
      proofGraphSha256,
      portIndexSha256,
    }, tempDir);
    const officialSpirvPrecision = buildOfficialSpirvPrecisionEvidence({
      vertex: fs.readFileSync(files.vertexSpirv),
      fragment: fs.readFileSync(files.fragmentSpirv),
    });
    for (const [stage, identityKey] of [
      ["vertex", "vertexSpirvSha256"],
      ["fragment", "fragmentSpirvSha256"],
    ]) {
      const expectedHash = hashString(
        ownDataValue(metadata.identityFields, identityKey, "identityFields"),
        `identityFields.${identityKey}`,
      );
      if (officialSpirvPrecision.stages[stage].source_sha256 !== expectedHash) {
        fail(`${stage} SPIR-V precision evidence does not match official executable identity`);
      }
    }
    Object.defineProperty(metadata, "officialSpirvPrecision", {
      value: officialSpirvPrecision,
      enumerable: false,
      writable: false,
      configurable: false,
    });
    if (config.validateSpirv !== false) {
      validateSpirv(files.vertexSpirv, {
        spirvVal: config.spirvVal,
        commandRunner: runner,
        cwd: rootDir,
      });
      validateSpirv(files.fragmentSpirv, {
        spirvVal: config.spirvVal,
        commandRunner: runner,
        cwd: rootDir,
      });
    }
    const reflection = config.reflect === false ? null : {
      vertex: reflectSpirv(files.vertexSpirv, {
        spirvCross: config.spirvCross,
        commandRunner: runner,
        cwd: rootDir,
      }),
      fragment: reflectSpirv(files.fragmentSpirv, {
        spirvCross: config.spirvCross,
        commandRunner: runner,
        cwd: rootDir,
      }),
    };
    return await callback({
      tempDir,
      metadataFile,
      metadata,
      files,
      reflection,
      officialSpirvPrecision,
    });
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function outputEntries(outputs) {
  const entries = outputs instanceof Map ? [...outputs.entries()] : Object.entries(record(outputs, "outputs"));
  if (entries.length === 0) fail("outputs must not be empty");
  return entries.map(([name, content], index) => {
    nonEmptyString(name, `outputs[${index}] name`);
    if (!(typeof content === "string" || Buffer.isBuffer(content) || ArrayBuffer.isView(content))) {
      fail(`output ${name} must be a string, Buffer, or typed array`);
    }
    const bytes = Buffer.isBuffer(content)
      ? content
      : ArrayBuffer.isView(content)
        ? Buffer.from(content.buffer, content.byteOffset, content.byteLength)
        : Buffer.from(content);
    return [name, bytes];
  });
}

export function writeOrCheckOutputs(outputs, options = {}) {
  const config = record(options, "write/check options");
  const outDir = path.resolve(nonEmptyString(ownDataValue(config, "outDir", "write/check options"), "outDir"));
  const check = config.check ?? false;
  if (typeof check !== "boolean") fail("write/check options.check must be boolean");
  const entries = outputEntries(outputs).map(([name, content]) => {
    const target = inside(outDir, path.resolve(outDir, name), `output ${name}`);
    return { name, content, target };
  });
  if (check) {
    for (const { name, content, target } of entries) {
      if (!fs.statSync(target, { throwIfNoEntry: false })?.isFile()) fail(`${name} is absent in check mode`);
      if (!fs.readFileSync(target).equals(content)) fail(`${name} drifted from exact regeneration`);
    }
  } else {
    for (const { content, target } of entries) {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, content);
    }
  }
  return entries.map(({ target }) => target);
}

/**
 * Run the mechanical half of a selector-bound WebGL port. Shader-specific
 * reflection assertions and source substitutions remain callbacks so this
 * helper cannot guess Unity UBO semantics.
 */
export async function generateExactSelectorPort(options) {
  const config = record(options, "exact selector port options");
  const extraction = record(ownDataValue(config, "extraction", "exact selector port options"), "extraction");
  const output = record(ownDataValue(config, "output", "exact selector port options"), "output");
  const expectedCross = record(
    ownDataValue(config, "expectedSpirvCrossSha256", "exact selector port options"),
    "expectedSpirvCrossSha256",
  );
  const shader = nonEmptyString(ownDataValue(config, "shader", "exact selector port options"), "shader");
  const generatedBy = nonEmptyString(
    ownDataValue(config, "generatedBy", "exact selector port options"),
    "generatedBy",
  );
  const adaptVertex = ownDataValue(config, "adaptVertex", "exact selector port options");
  const adaptFragment = ownDataValue(config, "adaptFragment", "exact selector port options");
  if (typeof adaptVertex !== "function" || typeof adaptFragment !== "function") {
    fail("exact selector port adaptations must be functions");
  }
  const validateReflection = config.validateReflection ?? (() => {});
  const validateWebGlStage = config.validateWebGlStage ?? (() => {});
  if (typeof validateReflection !== "function" || typeof validateWebGlStage !== "function") {
    fail("exact selector port validators must be functions");
  }
  const spirvCross = nonEmptyString(
    config.spirvCross ?? extraction.spirvCross ?? process.env.SPIRV_CROSS ?? "spirv-cross",
    "spirvCross",
  );
  const runner = config.commandRunner ?? extraction.commandRunner ?? runCommand;
  if (typeof runner !== "function") fail("exact selector port commandRunner must be a function");
  const extractor = config.extractProgram ?? withExtractedSelectorProgram;
  if (typeof extractor !== "function") fail("exact selector port extractProgram must be a function");
  const rootDir = path.resolve(extraction.rootDir ?? MODULE_ROOT);
  const substitutions = record(config.substitutions ?? {}, "substitutions");
  const adaptationOperations = record(
    ownDataValue(config, "adaptationOperations", "exact selector port options"),
    "adaptationOperations",
  );
  const webglSources = record(
    ownDataValue(config, "webglSources", "exact selector port options"),
    "webglSources",
  );
  const runtimeContract = record(
    ownDataValue(config, "runtimeContract", "exact selector port options"),
    "runtimeContract",
  );
  const manifestExtras = record(config.manifestExtras ?? {}, "manifestExtras");

  return extractor({ ...extraction, spirvCross, commandRunner: runner }, async (bundle) => {
    const { metadata, files, reflection } = bundle;
    if (!reflection?.vertex || !reflection?.fragment) fail("selector port requires vertex and fragment reflection");
    validateReflection(reflection, metadata);
    const officialSpirvPrecision = bundle.officialSpirvPrecision
      ?? buildOfficialSpirvPrecisionEvidence({
        vertex: fs.readFileSync(files.vertexSpirv),
        fragment: fs.readFileSync(files.fragmentSpirv),
      });
    const officialVertex = runner(
      spirvCross,
      [files.vertexSpirv, "--version", "300", "--es"],
      { cwd: rootDir },
    );
    const officialFragment = runner(
      spirvCross,
      [files.fragmentSpirv, "--version", "300", "--es"],
      { cwd: rootDir },
    );
    if (officialVertex && typeof officialVertex.then === "function") fail("SPIRV-Cross runner must be synchronous");
    if (officialFragment && typeof officialFragment.then === "function") fail("SPIRV-Cross runner must be synchronous");
    const expectedVertex = hashString(
      ownDataValue(expectedCross, "vertex", "expectedSpirvCrossSha256"),
      "expectedSpirvCrossSha256.vertex",
    );
    const expectedFragment = hashString(
      ownDataValue(expectedCross, "fragment", "expectedSpirvCrossSha256"),
      "expectedSpirvCrossSha256.fragment",
    );
    if (sha256(officialVertex) !== expectedVertex) fail("official vertex SPIRV-Cross output changed");
    if (sha256(officialFragment) !== expectedFragment) fail("official fragment SPIRV-Cross output changed");

    const callbackContext = { ...bundle, officialVertex, officialFragment };
    const vertex = nonEmptyString(await adaptVertex(officialVertex, callbackContext), "adapted vertex source");
    const fragment = nonEmptyString(await adaptFragment(officialFragment, callbackContext), "adapted fragment source");
    await validateWebGlStage(vertex, "vert", callbackContext);
    await validateWebGlStage(fragment, "frag", callbackContext);

    const commonBindings = compileCommonBindings(metadata.commonBindings);
    const programBindings = compileProgramBindings(
      commonBindings,
      metadata.parameterReflection,
      metadata.shaderPropertyDefaults,
    );
    const samplerBindings = joinProgramSamplerBindings(programBindings, reflection).map(({ set, ...binding }) => {
      if (set !== 0) fail(`${shader}: WebGL sampler ${binding.slot} uses unsupported descriptor set ${set}`);
      return binding;
    });
    const vertexInputContract = compileOfficialVertexInputContract(
      metadata.programBindChannels,
      reflection.vertex,
    );
    const manifestProgramBindings = {
      common_source_sha256: metadata.identityFields.commonBindingsSha256,
      parameter_reflection_sha256: metadata.parameterReflectionSha256,
      ...programBindings,
    };
    const adaptation = buildWebglAdaptationV2({
      vertex: {
        officialSpirvSha256: sha256File(files.vertexSpirv),
        spirvCrossGlslSha256: sha256(officialVertex),
        outputSha256: sha256(vertex),
        operations: array(
          ownDataValue(adaptationOperations, "vertex", "adaptationOperations"),
          "adaptationOperations.vertex",
        ),
        substitutions: Array.isArray(substitutions.vertex) ? substitutions.vertex : [],
      },
      fragment: {
        officialSpirvSha256: sha256File(files.fragmentSpirv),
        spirvCrossGlslSha256: sha256(officialFragment),
        outputSha256: sha256(fragment),
        operations: array(
          ownDataValue(adaptationOperations, "fragment", "adaptationOperations"),
          "adaptationOperations.fragment",
        ),
        substitutions: Array.isArray(substitutions.fragment) ? substitutions.fragment : [],
      },
      interfaceSha256: canonicalJsonSha256({ vertex: reflection.vertex, fragment: reflection.fragment }),
      officialVertexInputs: vertexInputContract,
      runtimeContract,
      officialProgramBindings: manifestProgramBindings,
    });
    const manifest = {
      shader,
      generated_by: generatedBy,
      selected_keywords: metadata.selector.keywords,
      official_selector: metadata.selector,
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
      official_pass_runtime: compileOfficialPassContract(metadata.passContract, {
        sourceSha256: metadata.identityFields.passStateSha256,
        policy: config.passPolicy ?? {},
      }),
      official_common_bindings: {
        source_sha256: metadata.identityFields.commonBindingsSha256,
        ...commonBindings,
      },
      official_program_bindings: manifestProgramBindings,
      official_vertex_inputs: vertexInputContract,
      official_shader_property_defaults: metadata.shaderPropertyDefaults,
      webgl_adaptation: adaptation,
      webgl_sources: webglSources,
      runtime_contract: runtimeContract,
      sampler_bindings: samplerBindings,
      samplers: samplerBindings.map((binding) => binding.spirvName),
      sampler_slots: samplerBindings.map((binding) => binding.slot),
      compiled_texture_bindings: Object.fromEntries(
        samplerBindings.map((binding) => [binding.slot, binding.binding]),
      ),
      implicit_defaults: metadata.shaderPropertyDefaults.textures,
    };
    for (const [key, value] of Object.entries(manifestExtras)) {
      if (Object.hasOwn(manifest, key)) fail(`manifestExtras cannot replace standard field ${key}`);
      manifest[key] = value;
    }
    const outputDir = path.resolve(nonEmptyString(ownDataValue(output, "outDir", "output"), "output.outDir"));
    const vertexName = nonEmptyString(ownDataValue(output, "vertex", "output"), "output.vertex");
    const fragmentName = nonEmptyString(ownDataValue(output, "fragment", "output"), "output.fragment");
    const manifestName = nonEmptyString(ownDataValue(output, "manifest", "output"), "output.manifest");
    writeOrCheckOutputs({
      [vertexName]: vertex,
      [fragmentName]: fragment,
      [manifestName]: `${JSON.stringify(manifest, null, 2)}\n`,
    }, { outDir: outputDir, check: output.check ?? false });
    return { ...bundle, officialVertex, officialFragment, vertex, fragment, manifest, samplerBindings };
  });
}
