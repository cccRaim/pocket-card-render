// Generate Simple-Opaque-Hologram_Tuning from one selector-bound official executable.
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  canonicalJsonSha256,
  compileCommonBindings,
  compileOfficialPassContract,
  joinSamplerBindings,
  runCommand,
  sha256,
  sha256File,
  withExtractedSelectorProgram,
  writeOrCheckOutputs,
} from "./exact-selector-port-core.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHADER_ROOT = process.env.PCR_SHADERS
  || "D:/DevProjectes/ptcgp-tools-master/masterdata_decoder/.output/decrypted/Common/Shader";
const SPIRV_CROSS = process.env.SPIRV_CROSS || "spirv-cross";
const OUT = path.join(ROOT, "public", "shaders");
const CHECK = process.argv.includes("--check") || process.env.PCR_EXACT_CHECK === "1";

function equal(actual, expected, message) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function member(name, type, offset, array = undefined) {
  return { name, type, offset, ...(array ? { array } : {}) };
}

function assertReflection(data, expected) {
  const ubo = (data.ubos || []).find((item) => item.name === expected.ubo.name);
  if (!ubo || ubo.block_size !== expected.ubo.size) throw new Error(`${expected.ubo.name} UBO changed`);
  equal((data.types[ubo.type].members || []).map(({ name, type, offset, array }) => ({
    name, type, offset, ...(array ? { array } : {}),
  })), expected.ubo.members, `${expected.ubo.name} members changed`);
  for (const key of ["inputs", "outputs", "textures"]) {
    equal((data[key] || []).map(({ name, type, location, binding }) => ({
      name, type, ...(location != null ? { location } : {}), ...(binding != null ? { binding } : {}),
    })).sort((a, b) => (a.location ?? a.binding) - (b.location ?? b.binding)), expected[key] || [], `${key} changed`);
  }
}

function replaceUbo(source, block, owner, declarations) {
  const re = new RegExp(`layout\\(std140\\) uniform ${block}[\\s\\S]*?}\\s*${owner};\\s*`);
  const result = source.replace(re, `${declarations.join("\n")}\n\n`);
  if (result === source) throw new Error(`${block} replacement failed`);
  return result;
}

function replaceMembers(source, owner, mapping) {
  return source.replace(new RegExp(`${owner}\\._m(\\d+)`, "g"), (match, raw) => {
    const value = mapping[Number(raw)];
    if (value == null) throw new Error(`unmapped ${match}`);
    return value;
  });
}

function adaptVertex(source) {
  let out = source.replace(/^#version 300 es\s*/m, "precision highp float;\nprecision highp int;\n\n");
  out = replaceUbo(out, "_19_21", "_21", [
    "uniform highp mat4 modelMatrix;",
    "uniform highp mat4 viewMatrix;",
    "uniform highp mat4 projectionMatrix;",
  ]);
  out = out
    .replace("layout(location = 0) in vec4 _11;", "in vec3 position;")
    .replace("layout(location = 1) in vec3 _95;", "in vec3 normal;")
    .replace("layout(location = 2) in vec2 _88;", "in vec2 uv;")
    .replace("layout(location = 3) in vec2 _91;", "in vec2 uv1;")
    .replace(/void main\(\)\s*\{/, `void main()
{
    vec4 _11 = vec4(position, 1.0);
    vec3 _95 = normal;
    vec2 _88 = uv;
    vec2 _91 = uv1;
    mat4 _ObjectToWorld = modelMatrix;
    mat4 _WorldToObject = inverse(modelMatrix);
    mat4 _ViewProjection = projectionMatrix * viewMatrix;`);
  out = replaceMembers(out, "_21", ["_ObjectToWorld", "_WorldToObject", "_ViewProjection"]);
  out = out.replace(/^\s*gl_Position\.y\s*=\s*-gl_Position\.y;\s*$/m, "");
  if (/_21\._m|gl_Position\.y\s*=\s*-gl_Position\.y/.test(out)) throw new Error("vertex adaptation incomplete");
  return `${out.trimEnd()}\n`;
}

function adaptFragment(source) {
  let out = source.replace(/^#version 300 es\s*/m, "");
  out = replaceUbo(out, "_35_37", "_37", [
    "uniform highp mat4 viewMatrix;",
    "uniform mediump float _DiffractionIntensity;",
    "uniform mediump float _DiffractionPower;",
    "uniform mediump float _RampRepeat;",
    "uniform mediump float _RampSpeed;",
    "uniform mediump float _RampOffset;",
    "uniform mediump float _RampInterval;",
    "uniform int _TiltEnabled;",
    "uniform mediump float _TiltPower;",
    "uniform mediump float _TiltOffset;",
    "uniform mediump float _TiltIntensity;",
    "uniform mediump vec3 _Rotation;",
  ]);
  out = replaceMembers(out, "_37", [
    "viewMatrix", "_DiffractionIntensity", "_DiffractionPower", "_RampRepeat", "_RampSpeed",
    "_RampOffset", "_RampInterval", "_TiltEnabled", "_TiltPower", "_TiltOffset",
    "_TiltIntensity", "_Rotation",
  ]);
  if (/_37\._m/.test(out)) throw new Error("fragment adaptation incomplete");
  return `${out.trimEnd()}\n`;
}


const vertexExpected = {
  ubo: { name: "_19_21", size: 192, members: [
    member("_m0", "vec4", 0, [4]), member("_m1", "vec4", 64, [4]), member("_m2", "vec4", 128, [4]),
  ] },
  inputs: [
    { name: "_11", type: "vec4", location: 0 }, { name: "_95", type: "vec3", location: 1 },
    { name: "_88", type: "vec2", location: 2 }, { name: "_91", type: "vec2", location: 3 },
  ],
  outputs: [
    { name: "vs_TEXCOORD0", type: "vec2", location: 0 },
    { name: "vs_TEXCOORD1", type: "vec2", location: 1 },
    { name: "vs_TEXCOORD2", type: "vec3", location: 2 },
  ], textures: [],
};

const fragmentExpected = {
  ubo: { name: "_35_37", size: 124, members: [
    member("_m0", "vec4", 0, [4]),
    ...Array.from({ length: 6 }, (_, i) => member(`_m${i + 1}`, "float", 64 + i * 4)),
    member("_m7", "int", 88),
    ...Array.from({ length: 3 }, (_, i) => member(`_m${i + 8}`, "float", 92 + i * 4)),
    member("_m11", "vec3", 112),
  ] },
  inputs: [
    { name: "vs_TEXCOORD0", type: "vec2", location: 0 },
    { name: "vs_TEXCOORD1", type: "vec2", location: 1 },
    { name: "vs_TEXCOORD2", type: "vec3", location: 2 },
  ],
  outputs: [{ name: "_503", type: "vec4", location: 0 }, { name: "_511", type: "vec4", location: 1 }],
  textures: ["_491", "_484", "_343", "_409", "_465"].map((name, binding) => ({ name, type: "sampler2D", binding })),
};


const selector = {
  selectorId: "8d4b8f484cb64d66e456e463875ca1fd2e1c9680f81e9cd1be4a2d5b5ddf49b6",
  candidateWitnessId: "0fb8f02f1c119712efa4625a857777833259dbb56138dcbc66aed26b580e9024",
  proofGraphSha256: "9862f63e11f359ed3b92b0191d21a2b6520de5a37159fd14612bdaf1908396b0",
  portIndexSha256: "30bc4d0eab1c1ad82147e880c642cbd8fba6d55cbd2227c2aa78f082f14e7e3f",
  spirvCrossSha256: {
    vertex: "4dc79d5b09aa26d6d392086a3c0697e0ad9d3334692e477db91e7853dc4f8926",
    fragment: "db5d88d8881b208c72899d289f040c0a1ba8ea0a7887cc2b4b7b616bcc180284",
  },
};
const samplerSlots = ["_MainTex", "_HologramMaskTex", "_PhaseTex", "_RampMaskTex", "_RampTex"];
const floats = [
  "_DiffractionIntensity", "_DiffractionPower", "_RampRepeat", "_RampSpeed", "_RampOffset", "_RampInterval",
  "_TiltEnabled", "_TiltPower", "_TiltOffset", "_TiltIntensity",
];
const ints = ["_TiltEnabled"];
const outputs = {};

await withExtractedSelectorProgram({
  selectorId: selector.selectorId,
  candidateWitnessId: selector.candidateWitnessId,
  expectedProofGraphSha256: selector.proofGraphSha256,
  expectedPortIndexSha256: selector.portIndexSha256,
  decryptedRoot: path.resolve(SHADER_ROOT, "..", ".."),
  prefix: "simple_opaque_hologram_tuning",
  rootDir: ROOT,
  spirvCross: SPIRV_CROSS,
}, ({ metadata, files, reflection }) => {
  assertReflection(reflection.vertex, vertexExpected);
  assertReflection(reflection.fragment, fragmentExpected);
  assert.equal(metadata.artifacts.parameterEntry.byteSize, 824);
  assert.equal(metadata.parameterReflection.bindingClosure.constantBuffersMatch, true);
  assert.equal(metadata.parameterReflection.bindingClosure.constantBufferDeclarationMode, "variant-local");

  const officialVertex = runCommand(SPIRV_CROSS, [files.vertexSpirv, "--version", "300", "--es"], { cwd: ROOT });
  const officialFragment = runCommand(SPIRV_CROSS, [files.fragmentSpirv, "--version", "300", "--es"], { cwd: ROOT });
  assert.equal(sha256(officialVertex), selector.spirvCrossSha256.vertex, "vertex SPIRV-Cross shape changed");
  assert.equal(sha256(officialFragment), selector.spirvCrossSha256.fragment, "fragment SPIRV-Cross shape changed");

  const vertex = adaptVertex(officialVertex);
  const fragment = adaptFragment(officialFragment);
  const bindings = compileCommonBindings(metadata.commonBindings);
  const samplerBindings = joinSamplerBindings(bindings, reflection.fragment).map(({ set, ...row }) => {
    assert.equal(set, 0, "WebGL sampler port requires descriptor set 0");
    return row;
  });
  assert.deepEqual(samplerBindings.map(({ slot }) => slot), samplerSlots);
  const adaptation = {
    schema: "pocket-card-render/webgl-stage-adaptation@1",
    backend: "Unity Vulkan SPIR-V to Three.js WebGL2",
    vertex: {
      officialSpirvSha256: sha256File(files.vertexSpirv), spirvCrossGlslSha256: sha256(officialVertex), outputSha256: sha256(vertex),
      substitutions: [
        "position location 0 := vec4(three.position, 1.0)", "normal location 1 := three.normal",
        "UV0 location 2 := three.uv", "UV1 location 3 := three.uv1",
        "unity_ObjectToWorld := three.modelMatrix", "unity_WorldToObject := inverse(three.modelMatrix)",
        "unity_MatrixVP := three.projectionMatrix * three.viewMatrix",
        "remove Unity Vulkan clip-space Y inversion for WebGL clip space",
      ],
    },
    fragment: {
      officialSpirvSha256: sha256File(files.fragmentSpirv), spirvCrossGlslSha256: sha256(officialFragment), outputSha256: sha256(fragment),
      substitutions: ["replace variant-local PGlobals UBO members with same-name Three.js uniforms"],
    },
    interfaceSha256: canonicalJsonSha256(reflection),
  };
  outputs["simple_opaque_hologram_tuning.vert.glsl"] = vertex;
  outputs["simple_opaque_hologram_tuning.frag.glsl"] = fragment;
  outputs["simple_opaque_hologram_tuning_uniforms.json"] = `${JSON.stringify({
    shader: metadata.selector.shaderName,
    generated_by: "build/build-exact-simple-opaque-hologram.mjs",
    official_selector: metadata.selector,
    official_spirv_sha256: { vertex: sha256File(files.vertexSpirv), fragment: sha256File(files.fragmentSpirv) },
    official_executable_identity: metadata.identityFields,
    official_parameter_entry: {
      source_sha256: metadata.identityFields.parameterEntrySha256,
      byte_size: metadata.artifacts.parameterEntry.byteSize,
      reflection_sha256: metadata.parameterReflectionSha256,
      ...metadata.parameterReflection,
    },
    official_pass_runtime: compileOfficialPassContract(metadata.passContract, {
      sourceSha256: metadata.identityFields.passStateSha256,
      policy: {
        rtSeparateBlend: false,
        fixed: {
          zClip: { val: 1, name: null }, conservative: { val: 0, name: null },
          offsetFactor: { val: 0, name: null }, offsetUnits: { val: 0, name: null },
          alphaToMask: { val: 0, name: null }, fogMode: -1, lighting: false,
        },
      },
    }),
    official_common_bindings: { source_sha256: metadata.identityFields.commonBindingsSha256, ...bindings },
    official_shader_property_defaults: metadata.shaderPropertyDefaults,
    webgl_adaptation: adaptation,
    webgl_sources: {
      vertex: "public/shaders/simple_opaque_hologram_tuning.vert.glsl",
      fragment: "public/shaders/simple_opaque_hologram_tuning.frag.glsl",
    },
    runtime_contract: {
      schema: "pocket-card-render/webgl-runtime-port@1",
      shader_key: "Simple-Opaque-Hologram_Tuning",
      attributes: { position: "vec3", normal: "vec3", uv: "vec2", uv1: "vec2" },
      engine_uniforms: { modelMatrix: "mat4", viewMatrix: "mat4", projectionMatrix: "mat4" },
      material_uniforms: {
        floats: floats.filter((name) => !ints.includes(name)), ints, vectors: { _Rotation: "vec3" },
      },
      camera_from_view: false,
      mrt_attachments: 2,
      stencil_normalization: "disable-when-always-keep",
      stencil_face_mode: "generic",
    },
    sampler_bindings: samplerBindings,
    samplers: samplerBindings.map((row) => row.spirvName),
    sampler_slots: samplerBindings.map((row) => row.slot),
    compiled_texture_bindings: Object.fromEntries(samplerBindings.map((row) => [row.slot, row.binding])),
    floats: Object.fromEntries(floats.map((name) => [name, name])),
    colors: { _Rotation: "_Rotation" },
    implicit_defaults: metadata.shaderPropertyDefaults.textures,
    mrt: { primary: "_503", secondary: "_511", secondary_value: "zero" },
  }, null, 2)}\n`;
});

writeOrCheckOutputs(outputs, { outDir: OUT, check: CHECK });
console.log(`${CHECK ? "verified" : "generated"} Simple-Opaque-Hologram_Tuning from selector-bound official SPIR-V`);
