import { compileRendererPropertyBlockContract } from "./renderer-property-block-contract.mjs";
import {
  compileBasisConversionContract,
  compileTextureCoordinateContract,
} from "./webgl-adaptation-contract.mjs";

export const WEBGL_RUNTIME_PORT_SCHEMA = "pocket-card-render/webgl-runtime-port@1";

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
const VALUE_TYPES = new Set(["float", "int", "vec2", "vec3", "vec4", "mat4", "sampler2D", "samplerCube"]);
const CONTRACT_FIELDS = new Set([
  "schema",
  "shader_key",
  "attributes",
  "engine_uniforms",
  "material_uniforms",
  "require_complete_active_bindings",
  "camera_from_view",
  "mrt_attachments",
  "stencil_normalization",
  "stencil_face_mode",
  "backend_basis_conversions",
  "backend_texture_defaults",
  "backend_uniforms",
  "dynamic_uniforms",
  "ordered_pass",
  "renderer_uniforms",
  "texture_coordinates",
]);
const MATERIAL_FIELDS = new Set(["floats", "ints", "vectors"]);
const SPEC_FIELDS = new Set(["type", "source", "value"]);
const ORDERED_PASS_FIELDS = new Set(["subshader", "pass", "name"]);
const BACKEND_TEXTURE_DEFAULTS = new Set([
  "neutral-gray-cube",
  "shaderlab-white",
  "shaderlab-black",
  "shaderlab-gray",
  "shaderlab-clear",
  "shaderlab-bump",
]);

function fail(message) {
  throw new Error(`webgl runtime port contract: ${message}`);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function rejectUnknownFields(value, allowed, label) {
  for (const field of Object.keys(value)) {
    if (!allowed.has(field)) fail(`${label} has unknown field ${field}`);
  }
}

function identifier(value, label) {
  if (typeof value !== "string" || !IDENTIFIER.test(value)) fail(`${label} must be a GLSL identifier`);
  return value;
}

export function parseWebglRuntimeUniformType(value, label = "uniform type", { arrays = true } = {}) {
  if (VALUE_TYPES.has(value)) return { type: value, baseType: value, size: 1 };
  const match = arrays && /^(float|int|vec2|vec3|vec4)\[([1-9][0-9]*)\]$/.exec(value ?? "");
  if (!match) fail(`${label} has unsupported type ${JSON.stringify(value)}`);
  return { type: value, baseType: match[1], size: Number(match[2]) };
}

function typeMap(raw, label, { allowedTypes = VALUE_TYPES } = {}) {
  if (!isRecord(raw)) fail(`${label} must be an object`);
  const output = {};
  for (const name of Object.keys(raw).sort()) {
    identifier(name, `${label} key`);
    const type = parseWebglRuntimeUniformType(raw[name], `${label}.${name}`, { arrays: false }).type;
    if (!allowedTypes.has(type)) fail(`${label}.${name} cannot use ${type}`);
    output[name] = type;
  }
  return output;
}

function identifierList(raw, label) {
  if (!Array.isArray(raw)) fail(`${label} must be an array`);
  const output = raw.map((name, index) => identifier(name, `${label}[${index}]`));
  if (new Set(output).size !== output.length) fail(`${label} contains duplicates`);
  return [...output].sort();
}

function uniformSpecs(raw, label, { requireSource, requireValue }) {
  if (!isRecord(raw)) fail(`${label} must be an object`);
  const output = {};
  for (const name of Object.keys(raw).sort()) {
    identifier(name, `${label} key`);
    const spec = raw[name];
    if (!isRecord(spec)) fail(`${label}.${name} must be an object`);
    rejectUnknownFields(spec, SPEC_FIELDS, `${label}.${name}`);
    const parsed = parseWebglRuntimeUniformType(spec.type, `${label}.${name}.type`);
    if (requireSource && (typeof spec.source !== "string" || spec.source.length === 0)) {
      fail(`${label}.${name}.source must be non-empty`);
    }
    if (requireValue && !Object.hasOwn(spec, "value")) fail(`${label}.${name}.value is missing`);
    if (requireValue) {
      const values = parsed.baseType.startsWith("vec") ? Number(parsed.baseType.slice(3)) : 1;
      if (values === 1 && !Number.isFinite(Number(spec.value))) {
        fail(`${label}.${name}.value must be finite`);
      }
      if (values > 1 && (!Array.isArray(spec.value) || spec.value.length !== values
          || !spec.value.every((entry) => Number.isFinite(Number(entry))))) {
        fail(`${label}.${name}.value must contain ${values} finite components`);
      }
    }
    output[name] = {
      type: parsed.type,
      ...(requireSource ? { source: spec.source } : {}),
      ...(requireValue ? { value: spec.value } : {}),
    };
  }
  return output;
}

function normalizeSamplerBindings(raw) {
  if (!Array.isArray(raw)) fail("samplerBindings must be an array");
  const slots = new Set();
  const names = new Set();
  const descriptors = new Set();
  return raw.map((row, index) => {
    if (!isRecord(row)) fail(`samplerBindings[${index}] must be an object`);
    const slot = identifier(row.slot, `samplerBindings[${index}].slot`);
    const spirvName = identifier(row.spirvName, `samplerBindings[${index}].spirvName`);
    if (!Number.isInteger(row.binding) || row.binding < 0) {
      fail(`samplerBindings[${index}].binding must be a non-negative integer`);
    }
    if (slots.has(slot) || names.has(spirvName) || descriptors.has(row.binding)) {
      fail("samplerBindings must be one-to-one by slot, SPIR-V name and binding");
    }
    slots.add(slot);
    names.add(spirvName);
    descriptors.add(row.binding);
    return { slot, spirvName, binding: row.binding };
  });
}

export function compileWebglRuntimePortContract(raw, { samplerBindings } = {}) {
  if (!isRecord(raw)) fail("contract must be an object");
  rejectUnknownFields(raw, CONTRACT_FIELDS, "contract");
  if (raw.schema !== WEBGL_RUNTIME_PORT_SCHEMA) fail(`unsupported schema ${String(raw.schema)}`);
  if (typeof raw.shader_key !== "string" || raw.shader_key.length === 0) fail("shader_key must be non-empty");
  const attributes = typeMap(raw.attributes, "attributes", {
    allowedTypes: new Set(["float", "int", "vec2", "vec3", "vec4"]),
  });
  const engineUniforms = typeMap(raw.engine_uniforms, "engine_uniforms", {
    allowedTypes: new Set(["float", "int", "vec2", "vec3", "vec4", "mat4"]),
  });
  if (!isRecord(raw.material_uniforms)) fail("material_uniforms must be an object");
  rejectUnknownFields(raw.material_uniforms, MATERIAL_FIELDS, "material_uniforms");
  const materialUniforms = {
    floats: identifierList(raw.material_uniforms.floats, "material_uniforms.floats"),
    ints: identifierList(raw.material_uniforms.ints, "material_uniforms.ints"),
    vectors: typeMap(raw.material_uniforms.vectors, "material_uniforms.vectors", {
      allowedTypes: new Set(["vec2", "vec3", "vec4"]),
    }),
  };
  const materialNames = [
    ...materialUniforms.floats,
    ...materialUniforms.ints,
    ...Object.keys(materialUniforms.vectors),
  ];
  if (new Set(materialNames).size !== materialNames.length) {
    fail("material uniform names overlap across float/int/vector groups");
  }
  if (raw.require_complete_active_bindings !== undefined
      && typeof raw.require_complete_active_bindings !== "boolean") {
    fail("require_complete_active_bindings must be boolean");
  }
  if (typeof raw.camera_from_view !== "boolean") fail("camera_from_view must be boolean");
  if (!Number.isInteger(raw.mrt_attachments) || raw.mrt_attachments < 1) {
    fail("mrt_attachments must be a positive integer");
  }
  if (raw.stencil_face_mode !== "generic") fail("stencil_face_mode must be generic");
  if (raw.stencil_normalization !== undefined
      && !["none", "disable-when-always-keep"].includes(raw.stencil_normalization)) {
    fail("stencil_normalization is unsupported");
  }

  const samplers = samplerBindings === undefined ? [] : normalizeSamplerBindings(samplerBindings);
  const samplerSlots = new Set(samplers.map((row) => row.slot));
  const backendTextureDefaults = {};
  if (raw.backend_texture_defaults !== undefined) {
    if (!isRecord(raw.backend_texture_defaults)) fail("backend_texture_defaults must be an object");
    for (const slot of Object.keys(raw.backend_texture_defaults).sort()) {
      identifier(slot, "backend_texture_defaults key");
      if (samplers.length > 0 && !samplerSlots.has(slot)) {
        fail(`backend_texture_defaults.${slot} is not an active sampler slot`);
      }
      const value = raw.backend_texture_defaults[slot];
      if (!BACKEND_TEXTURE_DEFAULTS.has(value)) {
        fail(`backend_texture_defaults.${slot} has unsupported value ${String(value)}`);
      }
      backendTextureDefaults[slot] = value;
    }
  }

  const backendBasisConversions = {};
  if (raw.backend_basis_conversions !== undefined) {
    if (!isRecord(raw.backend_basis_conversions)) fail("backend_basis_conversions must be an object");
    rejectUnknownFields(raw.backend_basis_conversions, new Set(["vertex", "fragment"]), "backend_basis_conversions");
    for (const stage of ["vertex", "fragment"]) {
      if (raw.backend_basis_conversions[stage] !== undefined) {
        backendBasisConversions[stage] = compileBasisConversionContract(
          raw.backend_basis_conversions[stage],
        );
      }
    }
  }

  const textureCoordinates = {};
  if (raw.texture_coordinates !== undefined) {
    if (!isRecord(raw.texture_coordinates)) fail("texture_coordinates must be an object");
    rejectUnknownFields(raw.texture_coordinates, new Set(["vertex"]), "texture_coordinates");
    if (raw.texture_coordinates.vertex !== undefined) {
      textureCoordinates.vertex = compileTextureCoordinateContract(raw.texture_coordinates.vertex);
      for (const transform of textureCoordinates.vertex.transforms ?? []) {
        if (samplers.length > 0 && !samplerSlots.has(transform.slot)) {
          fail(`texture coordinate slot ${transform.slot} is not an active sampler`);
        }
      }
    }
  }

  let orderedPass;
  if (raw.ordered_pass !== undefined) {
    if (!isRecord(raw.ordered_pass)) fail("ordered_pass must be an object");
    rejectUnknownFields(raw.ordered_pass, ORDERED_PASS_FIELDS, "ordered_pass");
    for (const field of ["subshader", "pass"]) {
      if (!Number.isInteger(raw.ordered_pass[field]) || raw.ordered_pass[field] < 0) {
        fail(`ordered_pass.${field} must be a non-negative integer`);
      }
    }
    if (typeof raw.ordered_pass.name !== "string" || raw.ordered_pass.name.length === 0) {
      fail("ordered_pass.name must be non-empty");
    }
    orderedPass = { ...raw.ordered_pass };
  }

  const normalized = {
    schema: raw.schema,
    shader_key: raw.shader_key,
    attributes,
    engine_uniforms: engineUniforms,
    material_uniforms: materialUniforms,
    require_complete_active_bindings: raw.require_complete_active_bindings === true,
    camera_from_view: raw.camera_from_view,
    mrt_attachments: raw.mrt_attachments,
    stencil_normalization: raw.stencil_normalization ?? "none",
    stencil_face_mode: raw.stencil_face_mode,
    ...(Object.keys(backendBasisConversions).length > 0
      ? { backend_basis_conversions: backendBasisConversions }
      : {}),
    ...(Object.keys(backendTextureDefaults).length > 0
      ? { backend_texture_defaults: backendTextureDefaults }
      : {}),
    ...(raw.backend_uniforms !== undefined
      ? { backend_uniforms: uniformSpecs(raw.backend_uniforms, "backend_uniforms", { requireValue: true }) }
      : {}),
    ...(raw.dynamic_uniforms !== undefined
      ? { dynamic_uniforms: uniformSpecs(raw.dynamic_uniforms, "dynamic_uniforms", { requireSource: true }) }
      : {}),
    ...(orderedPass ? { ordered_pass: orderedPass } : {}),
    ...(raw.renderer_uniforms
      ? { renderer_uniforms: compileRendererPropertyBlockContract(raw.renderer_uniforms) }
      : {}),
    ...(Object.keys(textureCoordinates).length > 0 ? { texture_coordinates: textureCoordinates } : {}),
  };
  return normalized;
}
