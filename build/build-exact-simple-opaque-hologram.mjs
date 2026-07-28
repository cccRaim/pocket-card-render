// Generate Simple-Opaque-Hologram_Tuning from one selector-bound official executable.
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  canonicalJsonSha256,
  compileCommonBindings,
  compileOfficialVertexInputContract,
  compileOfficialPassContract,
  compileProgramBindings,
  joinProgramConstantBufferStages,
  joinProgramSamplerBindings,
  runCommand,
  sha256,
  sha256File,
  withExtractedSelectorProgram,
  writeOrCheckOutputs,
} from "./exact-selector-port-core.mjs";
import { buildWebglAdaptationV2 } from "./webgl-adaptation-contract.mjs";

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

function adaptFragment(source, useHoloAlphaBlend) {
  let out = source.replace(/^#version 300 es\s*/m, "");
  out = replaceUbo(out, "_35_37", "_37", [
    "uniform highp mat4 viewMatrix;",
    "uniform mediump float _DiffractionIntensity;",
    "uniform mediump float _DiffractionPower;",
    "uniform mediump float _RampRepeat;",
    "uniform mediump float _RampSpeed;",
    "uniform mediump float _RampOffset;",
    "uniform mediump float _RampInterval;",
    ...(useHoloAlphaBlend ? ["uniform mediump float _HoloAlphaBlend;"] : []),
    "uniform int _TiltEnabled;",
    "uniform mediump float _TiltPower;",
    "uniform mediump float _TiltOffset;",
    "uniform mediump float _TiltIntensity;",
    "uniform mediump vec3 _Rotation;",
  ]);
  out = replaceMembers(out, "_37", useHoloAlphaBlend
    ? [
      "viewMatrix", "_DiffractionIntensity", "_DiffractionPower", "_RampRepeat", "_RampSpeed",
      "_RampOffset", "_RampInterval", "_HoloAlphaBlend", "_TiltEnabled", "_TiltPower",
      "_TiltOffset", "_TiltIntensity", "_Rotation",
    ]
    : [
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

const fragmentHoloAlphaExpected = {
  ubo: { name: "_35_37", size: 124, members: [
    member("_m0", "vec4", 0, [4]),
    ...Array.from({ length: 7 }, (_, i) => member(`_m${i + 1}`, "float", 64 + i * 4)),
    member("_m8", "int", 92),
    ...Array.from({ length: 3 }, (_, i) => member(`_m${i + 9}`, "float", 96 + i * 4)),
    member("_m12", "vec3", 112),
  ] },
  inputs: fragmentExpected.inputs,
  outputs: [{ name: "_520", type: "vec4", location: 0 }, { name: "_528", type: "vec4", location: 1 }],
  textures: ["_508", "_309", "_354", "_424", "_481"].map((name, binding) => ({
    name, type: "sampler2D", binding,
  })),
};

const PROOF_GRAPH_SHA256 = "307ed3660e5d3b1bfd8cf9e6b3d64e44937af215da3b6ed84ead198800eeadc4";
const PORT_INDEX_SHA256 = "15095f34b9e75515bbcc3924f6f8b2abb826ba96b48e819ec911486bcfa6f5a9";
const SELECTORS = [
  {
    label: "base",
    selectorId: "8d4b8f484cb64d66e456e463875ca1fd2e1c9680f81e9cd1be4a2d5b5ddf49b6",
    candidateWitnessId: "0fb8f02f1c119712efa4625a857777833259dbb56138dcbc66aed26b580e9024",
    keywords: [],
    semanticExecutableId: "f322beaff1347d5eff35d509f959dcf260f37df1090692fd95d840f0b0d3d4de",
    parameterBytes: 824,
    parameterReflectionSha256: null,
    fragmentExpected,
    useHoloAlphaBlend: false,
    outputPrefix: "simple_opaque_hologram_tuning",
    spirvCrossSha256: {
      vertex: "4dc79d5b09aa26d6d392086a3c0697e0ad9d3334692e477db91e7853dc4f8926",
      fragment: "db5d88d8881b208c72899d289f040c0a1ba8ea0a7887cc2b4b7b616bcc180284",
    },
  },
  {
    label: "holo-alpha",
    selectorId: "55ec8b288993628c3cf7f6756f92c49b053532bad778d3f40a8e4c62f054131d",
    candidateWitnessId: "3ee9c050c886c27c13233483d13ce1597c256dfb5a40064726030f07ccfd571b",
    keywords: ["_USEHOLOALPHABLEND_ON"],
    semanticExecutableId: "2a475d22fd00abe9ea1c6f60dec76e45905b0b71a9b08f8e2f0ddfbfa079b09b",
    parameterBytes: 868,
    parameterReflectionSha256: "da9a793b74c9af9f25f92aec4bb2079388b607f0c0de5e8d813357281a82c4b0",
    fragmentExpected: fragmentHoloAlphaExpected,
    useHoloAlphaBlend: true,
    outputPrefix: "simple_opaque_hologram_tuning_holo_alpha",
    spirvCrossSha256: {
      vertex: "4dc79d5b09aa26d6d392086a3c0697e0ad9d3334692e477db91e7853dc4f8926",
      fragment: "240b47b203267822861348d76a561a32883f0f0529100425059327671f65fb0a",
    },
  },
];
const samplerSlots = ["_MainTex", "_HologramMaskTex", "_PhaseTex", "_RampMaskTex", "_RampTex"];
const baseFloats = [
  "_DiffractionIntensity", "_DiffractionPower", "_RampRepeat", "_RampSpeed", "_RampOffset", "_RampInterval",
  "_TiltEnabled", "_TiltPower", "_TiltOffset", "_TiltIntensity",
];
const ints = ["_TiltEnabled"];
const outputs = {};

for (const selector of SELECTORS) await withExtractedSelectorProgram({
  selectorId: selector.selectorId,
  candidateWitnessId: selector.candidateWitnessId,
  expectedProofGraphSha256: PROOF_GRAPH_SHA256,
  expectedPortIndexSha256: PORT_INDEX_SHA256,
  decryptedRoot: path.resolve(SHADER_ROOT, "..", ".."),
  prefix: selector.outputPrefix,
  rootDir: ROOT,
  spirvCross: SPIRV_CROSS,
}, ({ metadata, files, reflection }) => {
  assertReflection(reflection.vertex, vertexExpected);
  assertReflection(reflection.fragment, selector.fragmentExpected);
  assert.deepEqual(metadata.selector.keywords, selector.keywords);
  assert.equal(metadata.selector.semanticExecutableId, selector.semanticExecutableId);
  assert.equal(metadata.artifacts.parameterEntry.byteSize, selector.parameterBytes);
  if (selector.parameterReflectionSha256) {
    assert.equal(metadata.parameterReflectionSha256, selector.parameterReflectionSha256);
  }
  assert.equal(metadata.parameterReflection.bindingClosure.constantBuffersMatch, true);
  assert.equal(metadata.parameterReflection.bindingClosure.constantBufferDeclarationMode, "variant-local");

  const officialVertex = runCommand(SPIRV_CROSS, [files.vertexSpirv, "--version", "300", "--es"], { cwd: ROOT });
  const officialFragment = runCommand(SPIRV_CROSS, [files.fragmentSpirv, "--version", "300", "--es"], { cwd: ROOT });
  assert.equal(sha256(officialVertex), selector.spirvCrossSha256.vertex, "vertex SPIRV-Cross shape changed");
  assert.equal(sha256(officialFragment), selector.spirvCrossSha256.fragment, "fragment SPIRV-Cross shape changed");

  const vertex = adaptVertex(officialVertex);
  const fragment = adaptFragment(officialFragment, selector.useHoloAlphaBlend);
  const bindings = compileCommonBindings(metadata.commonBindings);
  const programBindings = joinProgramConstantBufferStages(
    compileProgramBindings(bindings, metadata.parameterReflection, metadata.shaderPropertyDefaults),
    reflection,
  );
  const manifestProgramBindings = {
    common_source_sha256: metadata.identityFields.commonBindingsSha256,
    parameter_reflection_sha256: metadata.parameterReflectionSha256,
    ...programBindings,
  };
  const vertexInputContract = compileOfficialVertexInputContract(
    metadata.programBindChannels,
    reflection.vertex,
  );
  const samplerBindings = joinProgramSamplerBindings(programBindings, reflection).map(({ set, ...row }) => {
    assert.equal(set, 0, "WebGL sampler port requires descriptor set 0");
    return row;
  });
  assert.deepEqual(samplerBindings.map(({ slot }) => slot), samplerSlots);
  const floats = selector.useHoloAlphaBlend
    ? [...baseFloats, "_HoloAlphaBlend"]
    : baseFloats;
  const runtimeContract = {
    schema: "pocket-card-render/webgl-runtime-port@1",
    shader_key: "Simple-Opaque-Hologram_Tuning",
    attributes: { position: "vec3", normal: "vec3", uv: "vec2", uv1: "vec2" },
    engine_uniforms: { modelMatrix: "mat4", viewMatrix: "mat4", projectionMatrix: "mat4" },
    material_uniforms: {
      floats: floats.filter((name) => !ints.includes(name)), ints, vectors: { _Rotation: "vec3" },
    },
    require_complete_active_bindings: true,
    camera_from_view: false,
    mrt_attachments: 2,
    stencil_normalization: "disable-when-always-keep",
    stencil_face_mode: "generic",
  };
  const adaptation = buildWebglAdaptationV2({
    vertex: {
      officialSpirvSha256: sha256File(files.vertexSpirv), spirvCrossGlslSha256: sha256(officialVertex), outputSha256: sha256(vertex),
      operations: [
        { kind: "vertex-input-binding", contract: "official-bind-channels-to-three-r165" },
        { kind: "engine-uniform-binding", contract: "unity-builtins-to-three-r165" },
        {
          kind: "uniform-buffer-flattening",
          source: "variant-local",
          preservation: "names-types-precision",
        },
        {
          kind: "clip-space-y-conversion",
          from: "unity-vulkan",
          to: "webgl",
          operation: "remove-y-inversion",
        },
        { kind: "glsl-version-ownership", owner: "three-raw-shader-material" },
      ],
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
      operations: [
        { kind: "engine-uniform-binding", contract: "unity-builtins-to-three-r165" },
        {
          kind: "uniform-buffer-flattening",
          source: "variant-local",
          preservation: "names-types-precision",
        },
        { kind: "glsl-version-ownership", owner: "three-raw-shader-material" },
      ],
      substitutions: [
        "replace variant-local PGlobals UBO members with same-name Three.js uniforms",
        "remove the embedded GLSL version directive for Three.js RawShaderMaterial injection",
      ],
    },
    interfaceSha256: canonicalJsonSha256(reflection),
    officialVertexInputs: vertexInputContract,
    runtimeContract,
    officialProgramBindings: manifestProgramBindings,
  });
  outputs[`${selector.outputPrefix}.vert.glsl`] = vertex;
  outputs[`${selector.outputPrefix}.frag.glsl`] = fragment;
  outputs[`${selector.outputPrefix}_uniforms.json`] = `${JSON.stringify({
    shader: metadata.selector.shaderName,
    generated_by: "build/build-exact-simple-opaque-hologram.mjs",
    selected_keywords: metadata.selector.keywords,
    official_selector: metadata.selector,
    official_spirv_sha256: { vertex: sha256File(files.vertexSpirv), fragment: sha256File(files.fragmentSpirv) },
    official_spirv_precision: metadata.officialSpirvPrecision,
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
    official_program_bindings: manifestProgramBindings,
    official_vertex_inputs: vertexInputContract,
    official_shader_property_defaults: metadata.shaderPropertyDefaults,
    webgl_adaptation: adaptation,
    webgl_sources: {
      vertex: `public/shaders/${selector.outputPrefix}.vert.glsl`,
      fragment: `public/shaders/${selector.outputPrefix}.frag.glsl`,
    },
    runtime_contract: runtimeContract,
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
console.log(`${CHECK ? "verified" : "generated"} ${SELECTORS.length} Simple-Opaque-Hologram_Tuning selector ports`);
