// Generate the selector-owned Frame-2Layer-UR WebGL2 port from official Unity shader bytes.
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
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
  writeOrCheckOutputs,
} from "./exact-selector-port-core.mjs";
import { buildWebglAdaptationV2 } from "./webgl-adaptation-contract.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHADER_ROOT = process.env.PCR_SHADERS
  || "D:/DevProjectes/ptcgp-tools-master/masterdata_decoder/.output/decrypted/Common/Shader";
const SPIRV_CROSS = process.env.SPIRV_CROSS || "spirv-cross";
const OUT = path.join(ROOT, "public", "shaders");
const CHECK = process.argv.includes("--check") || process.env.PCR_EXACT_CHECK === "1";
const SELECTOR_ID = "8d7280508a05ee3104722b0a82d72ec265aed22d540b17feacbadedaf1d6030e";
const CANDIDATE_WITNESS_ID = "35d3ee7215e6c73746d6a66c6670b2b5563b435ddf7c0f6a6c3a51c6c1c4de90";
const PROOF_GRAPH_SHA256 = "307ed3660e5d3b1bfd8cf9e6b3d64e44937af215da3b6ed84ead198800eeadc4";
const PORT_INDEX_SHA256 = "15095f34b9e75515bbcc3924f6f8b2abb826ba96b48e819ec911486bcfa6f5a9";
const PARAMETER_REFLECTION_SHA256 = "bac97fd98a6d3f7d23b647123428cc19d3637dee832c09ca0a25110952eb2507";
const OFFICIAL_CROSS_SHA256 = {
  vertex: "12e63c161f48d7307ff0a770ce6c4a949157e43d19e5b8cb8b9862a112dc8867",
  fragment: "5e5d75fc5f04d676b5efcb619136b0902c549ebf4d959b724df2db9890e14552",
};
const PASS_POLICY = {
  rtSeparateBlend: false,
  fixed: {
    zClip: { val: 1, name: null }, conservative: { val: 0, name: null },
    offsetFactor: { val: 0, name: null }, offsetUnits: { val: 0, name: null },
    alphaToMask: { val: 0, name: null }, fogMode: -1, lighting: false,
  },
};

function equal(actual, expected, message) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function member(name, type, offset, array = undefined) {
  return { name, type, offset, ...(array ? { array } : {}) };
}

function reflect(data, expected) {
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

const vertexMapping = [
  "_ObjectToWorld", "_WorldToObject", "_ViewProjection", "_RampMaskRotation", "_RampMaskScale",
  "_UseSimpleRampMaskAndRotation", "_RampMaskRotation2", "_RampMaskScale2",
  "_UseSimpleRampMaskAndRotation2", "_FakeSpecularMaskScale", "_FakeSpecularIntensity",
  "_FakeSpecularPower", "_FakeSpecularCornerPower", "_FakeSpecularNotCornerOffset",
  "_FakeSpecularMaskScale2", "_FakeSpecularIntensity2", "_FakeSpecularPower2",
  "_FakeSpecularCornerPower2", "_FakeSpecularNotCornerOffset2",
];

const fragmentMapping = [
  "cameraPosition", "viewMatrix", "_Shininess", "_BaseColorIntensity", "_SpecularIntensity",
  "_DiffractionIntensity", "_DiffractionPower", "_RampRepeat", "_RampSpeed", "_RampOffset",
  "_RampInterval", "_UseSimpleRampMaskAndRotation", "_RemoveMetallic", "_DiffractionIntensity2",
  "_DiffractionPower2", "_RampRepeat2", "_RampSpeed2", "_RampOffset2", "_RampInterval2",
  "_UseSimpleRampMaskAndRotation2", "_FakeSpecularColor", "_FakeSpecularColor2", "_DarknessColor1",
  "_DarknessOffset1", "_DarknessColor2", "_DarknessOffset2", "_EmissivePattern", "_EmissiveColor",
  "_Rotation", "_Tilt",
];

function adaptVertex(source) {
  let out = source.replace(/^#version 300 es\s*/m, "precision highp float;\nprecision highp int;\n\n");
  out = replaceUbo(out, "_20_22", "_22", [
    "uniform highp mat4 modelMatrix;", "uniform highp mat4 viewMatrix;", "uniform highp mat4 projectionMatrix;",
    "uniform mediump float _RampMaskRotation;", "uniform mediump float _RampMaskScale;",
    "uniform int _UseSimpleRampMaskAndRotation;", "uniform mediump float _RampMaskRotation2;",
    "uniform mediump float _RampMaskScale2;", "uniform int _UseSimpleRampMaskAndRotation2;",
    "uniform mediump float _FakeSpecularMaskScale;", "uniform mediump float _FakeSpecularIntensity;",
    "uniform mediump float _FakeSpecularPower;", "uniform mediump float _FakeSpecularCornerPower;",
    "uniform mediump float _FakeSpecularNotCornerOffset;", "uniform mediump float _FakeSpecularMaskScale2;",
    "uniform mediump float _FakeSpecularIntensity2;", "uniform mediump float _FakeSpecularPower2;",
    "uniform mediump float _FakeSpecularCornerPower2;", "uniform mediump float _FakeSpecularNotCornerOffset2;",
  ]);
  out = out
    .replace("layout(location = 0) in vec4 _11;", "in vec3 position;")
    .replace("layout(location = 1) in vec3 _1124;", "in vec3 normal;")
    .replace("layout(location = 2) in vec2 _858;", "in vec2 uv;")
    .replace(/void main\(\)\s*\{/, `void main()
{
    vec4 _11 = vec4(position, 1.0);
    vec3 _1124 = normal;
    vec2 _858 = uv;
    mat4 _ObjectToWorld = modelMatrix;
    mat4 _WorldToObject = inverse(modelMatrix);
    mat4 _ViewProjection = projectionMatrix * viewMatrix;`);
  out = replaceMembers(out, "_22", vertexMapping);
  out = out.replace(/^\s*gl_Position\.y\s*=\s*-gl_Position\.y;\s*$/m, "");
  if (/_22\._m|gl_Position\.y\s*=\s*-gl_Position\.y/.test(out)) throw new Error("vertex adaptation incomplete");
  return `${out.trimEnd()}\n`;
}

function adaptFragment(source) {
  let out = source.replace(/^#version 300 es\s*/m, "");
  out = replaceUbo(out, "_67_69", "_69", [
    "uniform highp vec3 cameraPosition;", "uniform highp mat4 viewMatrix;",
    "uniform mediump float _Shininess;", "uniform mediump float _BaseColorIntensity;",
    "uniform mediump float _SpecularIntensity;", "uniform mediump float _DiffractionIntensity;",
    "uniform mediump float _DiffractionPower;", "uniform mediump float _RampRepeat;",
    "uniform mediump float _RampSpeed;", "uniform mediump float _RampOffset;",
    "uniform mediump float _RampInterval;", "uniform int _UseSimpleRampMaskAndRotation;",
    "uniform mediump float _RemoveMetallic;", "uniform mediump float _DiffractionIntensity2;",
    "uniform mediump float _DiffractionPower2;", "uniform mediump float _RampRepeat2;",
    "uniform mediump float _RampSpeed2;", "uniform mediump float _RampOffset2;",
    "uniform mediump float _RampInterval2;", "uniform int _UseSimpleRampMaskAndRotation2;",
    "uniform mediump vec3 _FakeSpecularColor;", "uniform mediump vec3 _FakeSpecularColor2;",
    "uniform mediump vec3 _DarknessColor1;", "uniform mediump float _DarknessOffset1;",
    "uniform mediump vec3 _DarknessColor2;", "uniform mediump float _DarknessOffset2;",
    "uniform int _EmissivePattern;", "uniform mediump vec4 _EmissiveColor;",
    "uniform mediump vec3 _Rotation;", "uniform mediump float _Tilt;",
  ]);
  out = replaceMembers(out, "_69", fragmentMapping);
  if (/_69\._m/.test(out)) throw new Error("fragment adaptation incomplete");
  return `${out.trimEnd()}\n`;
}

function compiledFields(buffer) {
  return [...(buffer?.matrices || []), ...(buffer?.vectors || [])]
    .sort((a, b) => a.offset - b.offset)
    .map(({ name, offset }) => ({ name, offset }));
}

const vertexExpected = {
  ubo: { name: "_20_22", size: 256, members: [
    member("_m0", "vec4", 0, [4]), member("_m1", "vec4", 64, [4]), member("_m2", "vec4", 128, [4]),
    member("_m3", "float", 192), member("_m4", "float", 196), member("_m5", "int", 200),
    member("_m6", "float", 204), member("_m7", "float", 208), member("_m8", "int", 212),
    ...Array.from({ length: 10 }, (_, i) => member(`_m${i + 9}`, "float", 216 + i * 4)),
  ] },
  inputs: [
    { name: "_11", type: "vec4", location: 0 }, { name: "_1124", type: "vec3", location: 1 },
    { name: "_858", type: "vec2", location: 2 },
  ],
  outputs: [
    { name: "vs_TEXCOORD0", type: "vec2", location: 0 }, { name: "vs_TEXCOORD6", type: "float", location: 1 },
    { name: "vs_TEXCOORD7", type: "float", location: 2 }, { name: "vs_TEXCOORD2", type: "vec3", location: 3 },
    { name: "vs_TEXCOORD3", type: "vec3", location: 4 }, { name: "vs_TEXCOORD4", type: "vec4", location: 5 },
    { name: "vs_TEXCOORD5", type: "vec4", location: 6 },
  ], textures: [],
};

const fragmentExpected = {
  ubo: { name: "_67_69", size: 272, members: [
    member("_m0", "vec3", 0), member("_m1", "vec4", 16, [4]),
    ...Array.from({ length: 9 }, (_, i) => member(`_m${i + 2}`, "float", 80 + i * 4)),
    member("_m11", "int", 116), ...Array.from({ length: 7 }, (_, i) => member(`_m${i + 12}`, "float", 120 + i * 4)),
    member("_m19", "int", 148), member("_m20", "vec3", 160), member("_m21", "vec3", 176),
    member("_m22", "vec3", 192), member("_m23", "float", 204), member("_m24", "vec3", 208),
    member("_m25", "float", 220), member("_m26", "int", 224), member("_m27", "vec4", 240),
    member("_m28", "vec3", 256), member("_m29", "float", 268),
  ] },
  inputs: [
    { name: "vs_TEXCOORD0", type: "vec2", location: 0 }, { name: "vs_TEXCOORD6", type: "float", location: 1 },
    { name: "vs_TEXCOORD7", type: "float", location: 2 }, { name: "vs_TEXCOORD2", type: "vec3", location: 3 },
    { name: "vs_TEXCOORD3", type: "vec3", location: 4 }, { name: "vs_TEXCOORD4", type: "vec4", location: 5 },
    { name: "vs_TEXCOORD5", type: "vec4", location: 6 },
  ],
  outputs: [{ name: "_34", type: "vec4", location: 0 }, { name: "_42", type: "vec4", location: 1 }],
  textures: [
    { name: "_13", type: "sampler2D", binding: 0 }, { name: "_260", type: "sampler2D", binding: 1 },
    { name: "_367", type: "samplerCube", binding: 2 }, { name: "_420", type: "sampler2D", binding: 3 },
    { name: "_428", type: "sampler2D", binding: 4 }, { name: "_444", type: "sampler2D", binding: 5 },
    { name: "_601", type: "sampler2D", binding: 6 }, { name: "_760", type: "sampler2D", binding: 7 },
    { name: "_916", type: "sampler2D", binding: 8 }, { name: "_1277", type: "sampler2D", binding: 9 },
  ],
};

await withExtractedSelectorProgram({
  selectorId: SELECTOR_ID,
  candidateWitnessId: CANDIDATE_WITNESS_ID,
  expectedProofGraphSha256: PROOF_GRAPH_SHA256,
  expectedPortIndexSha256: PORT_INDEX_SHA256,
  decryptedRoot: path.resolve(SHADER_ROOT, "..", ".."),
  prefix: "frame_2layer_ur",
  rootDir: ROOT,
  spirvCross: SPIRV_CROSS,
}, ({ metadata, files, reflection }) => {
  equal(metadata.selector.keywords, [], "selector keyword set changed");
  if (metadata.parameterReflectionSha256 !== PARAMETER_REFLECTION_SHA256) throw new Error("official parameter reflection changed");
  if (metadata.artifacts.parameterEntry.byteSize !== 100) throw new Error("official parameter entry byte size changed");
  reflect(reflection.vertex, vertexExpected);
  reflect(reflection.fragment, fragmentExpected);

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
  const pglobals = bindings.constant_buffers.find((item) => item.name.startsWith("PGlobals"));
  const vglobals = bindings.constant_buffers.find((item) => item.name.startsWith("VGlobals"));
  equal({ p: pglobals?.size, v: vglobals?.size }, { p: 272, v: 256 }, "compiled UBO sizes changed");
  const engineNames = {
    unity_ObjectToWorld: "_ObjectToWorld", unity_WorldToObject: "_WorldToObject",
    unity_MatrixVP: "_ViewProjection", unity_MatrixV: "viewMatrix", _WorldSpaceCameraPos: "cameraPosition",
  };
  equal(compiledFields(vglobals).map(({ name, offset }) => ({ name: engineNames[name] || name, offset })),
    vertexMapping.map((name, index) => ({ name, offset: vertexExpected.ubo.members[index].offset })), "compiled vertex fields changed");
  equal(compiledFields(pglobals).map(({ name, offset }) => ({ name: engineNames[name] || name, offset })),
    fragmentMapping.map((name, index) => ({ name, offset: fragmentExpected.ubo.members[index].offset })), "compiled fragment fields changed");

  const samplerBindings = joinProgramSamplerBindings(programBindings, reflection).map(({ set, ...row }) => {
    if (set !== 0) throw new Error("WebGL sampler port requires descriptor set 0");
    return row;
  });
  equal(samplerBindings.map(({ slot, spirvName, binding }) => ({ slot, spirvName, binding })), [
    { slot: "_BaseTex", spirvName: "_13", binding: 0 },
    { slot: "_LayerMaskTex", spirvName: "_260", binding: 1 },
    { slot: "_CubeMap", spirvName: "_367", binding: 2 },
    { slot: "_PhaseTex", spirvName: "_420", binding: 3 },
    { slot: "_PhaseMaskTex", spirvName: "_428", binding: 4 },
    { slot: "_RampMaskTex", spirvName: "_444", binding: 5 },
    { slot: "_RampTex", spirvName: "_601", binding: 6 },
    { slot: "_RampMaskTex2", spirvName: "_760", binding: 7 },
    { slot: "_RampTex2", spirvName: "_916", binding: 8 },
    { slot: "_FakeSpecularMask", spirvName: "_1277", binding: 9 },
  ], "compiled sampler bindings changed");

  const officialVert = runCommand(SPIRV_CROSS, [files.vertexSpirv, "--version", "300", "--es"], { cwd: ROOT });
  const officialFrag = runCommand(SPIRV_CROSS, [files.fragmentSpirv, "--version", "300", "--es"], { cwd: ROOT });
  if (sha256(officialVert) !== OFFICIAL_CROSS_SHA256.vertex || sha256(officialFrag) !== OFFICIAL_CROSS_SHA256.fragment) {
    throw new Error("complete official SPIRV-Cross output changed");
  }
  const vertex = adaptVertex(officialVert);
  const fragment = adaptFragment(officialFrag);
  const materialFloats = [
    "_RampMaskRotation", "_RampMaskScale", "_RampMaskRotation2", "_RampMaskScale2",
    "_FakeSpecularMaskScale", "_FakeSpecularIntensity", "_FakeSpecularPower", "_FakeSpecularCornerPower",
    "_FakeSpecularNotCornerOffset", "_FakeSpecularMaskScale2", "_FakeSpecularIntensity2",
    "_FakeSpecularPower2", "_FakeSpecularCornerPower2", "_FakeSpecularNotCornerOffset2",
    "_Shininess", "_BaseColorIntensity", "_SpecularIntensity", "_DiffractionIntensity", "_DiffractionPower",
    "_RampRepeat", "_RampSpeed", "_RampOffset", "_RampInterval", "_RemoveMetallic",
    "_DiffractionIntensity2", "_DiffractionPower2", "_RampRepeat2", "_RampSpeed2", "_RampOffset2",
    "_RampInterval2", "_DarknessOffset1", "_DarknessOffset2", "_Tilt",
  ];
  const runtimeContract = {
    schema: "pocket-card-render/webgl-runtime-port@1",
    shader_key: "Frame-2Layer-UR",
    attributes: { position: "vec3", normal: "vec3", uv: "vec2" },
    engine_uniforms: {
      modelMatrix: "mat4", viewMatrix: "mat4", projectionMatrix: "mat4", cameraPosition: "vec3",
    },
    material_uniforms: {
      floats: materialFloats,
      ints: ["_UseSimpleRampMaskAndRotation", "_UseSimpleRampMaskAndRotation2", "_EmissivePattern"],
      vectors: {
        _FakeSpecularColor: "vec3", _FakeSpecularColor2: "vec3", _DarknessColor1: "vec3",
        _DarknessColor2: "vec3", _EmissiveColor: "vec4", _Rotation: "vec3",
      },
    },
    require_complete_active_bindings: true,
    camera_from_view: true,
    mrt_attachments: 2,
    stencil_normalization: "disable-when-always-keep",
    stencil_face_mode: "generic",
  };
  const adaptation = buildWebglAdaptationV2({
    vertex: {
      officialSpirvSha256: sha256File(files.vertexSpirv), spirvCrossGlslSha256: sha256(officialVert), outputSha256: sha256(vertex),
      operations: [
        { kind: "vertex-input-binding", contract: "official-bind-channels-to-three-r165" },
        { kind: "engine-uniform-binding", contract: "unity-builtins-to-three-r165" },
        {
          kind: "uniform-buffer-flattening",
          source: "serialized-common",
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
        "replace serialized-common VGlobals UBO members with same-name Three.js uniforms",
        "map official position/normal/uv locations to Three.js attributes",
        "unity_ObjectToWorld := three.modelMatrix and unity_WorldToObject := inverse(three.modelMatrix)",
        "unity_MatrixVP := three.projectionMatrix * three.viewMatrix",
        "remove Unity Vulkan clip-space Y inversion for WebGL clip space",
      ],
    },
    fragment: {
      officialSpirvSha256: sha256File(files.fragmentSpirv), spirvCrossGlslSha256: sha256(officialFrag), outputSha256: sha256(fragment),
      operations: [
        { kind: "engine-uniform-binding", contract: "unity-builtins-to-three-r165" },
        {
          kind: "uniform-buffer-flattening",
          source: "serialized-common",
          preservation: "names-types-precision",
        },
        { kind: "glsl-version-ownership", owner: "three-raw-shader-material" },
      ],
      substitutions: [
        "replace serialized-common PGlobals UBO members with same-name Three.js uniforms",
      ],
    },
    interfaceSha256: canonicalJsonSha256({ vertex: reflection.vertex, fragment: reflection.fragment }),
    officialVertexInputs: vertexInputContract,
    runtimeContract,
    officialProgramBindings: manifestProgramBindings,
  });
  const passRuntime = {
    ...compileOfficialPassContract(metadata.passContract, {
      sourceSha256: metadata.identityFields.passStateSha256,
      policy: PASS_POLICY,
    }),
    shader_property_defaults: metadata.shaderPropertyDefaults.floats,
  };
  const outputs = {
    "frame_2layer_ur.vert.glsl": vertex,
    "frame_2layer_ur.frag.glsl": fragment,
    "frame_2layer_ur_uniforms.json": `${JSON.stringify({
      shader: "Frame-2Layer-UR",
      generated_by: "build/build-exact-frame-2layer-ur.mjs",
      selected_keywords: [],
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
      official_pass_runtime: passRuntime,
      official_common_bindings: { source_sha256: metadata.identityFields.commonBindingsSha256, ...bindings },
      official_program_bindings: manifestProgramBindings,
      official_vertex_inputs: vertexInputContract,
      official_shader_property_defaults: metadata.shaderPropertyDefaults,
      webgl_adaptation: adaptation,
      webgl_sources: {
        vertex: "public/shaders/frame_2layer_ur.vert.glsl",
        fragment: "public/shaders/frame_2layer_ur.frag.glsl",
      },
      runtime_contract: runtimeContract,
      sampler_bindings: samplerBindings,
      samplers: samplerBindings.map((row) => row.spirvName),
      sampler_slots: samplerBindings.map((row) => row.slot),
      compiled_texture_bindings: Object.fromEntries(samplerBindings.map((row) => [row.slot, row.binding])),
      vertex_fields: Object.fromEntries(compiledFields(vglobals).map(({ name, offset }) => [name, offset])),
      fragment_fields: Object.fromEntries(compiledFields(pglobals).map(({ name, offset }) => [name, offset])),
      implicit_defaults: { ...metadata.shaderPropertyDefaults.textures, _CubeMap: "gray" },
      mrt: { primary: "_34", emissive: "_42", secondary_rgb: "active" },
    }, null, 2)}\n`,
  };
  writeOrCheckOutputs(outputs, { outDir: OUT, check: CHECK });
  console.log(`${CHECK ? "verified" : "generated"} selector-owned Frame-2Layer-UR WebGL2 port`);
});
