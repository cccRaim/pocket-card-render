// Generate the selector-owned Opaque-UR-Oklab WebGL2 port from official Unity shader bytes.
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  adaptUnityObjectToWorldDataAxes,
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
const SELECTOR_ID = "ce8eb1eedf6bf5f01f87e7913fcef909edee8a0439dc037515df134f5269b26a";
const CANDIDATE_WITNESS_ID = "25b29591d0c4004e6451aff10e7b8e86c669038a7069955227c43c87f5e32866";
const PROOF_GRAPH_SHA256 = "9862f63e11f359ed3b92b0191d21a2b6520de5a37159fd14612bdaf1908396b0";
const PORT_INDEX_SHA256 = "30bc4d0eab1c1ad82147e880c642cbd8fba6d55cbd2227c2aa78f082f14e7e3f";
const PARAMETER_REFLECTION_SHA256 = "b0e55a26b2dbb6dd4ee1a2765dc083963f09cfbed2e106a80c4df7a5968aa602";
const OFFICIAL_CROSS_SHA256 = {
  vertex: "f5624d0749a7469b51debaa972bdad7cf83947ca884dcb0258d6b4112a9e9daa",
  fragment: "475d836c752c207646124214de89e764eeadcfaaa75621143c4a88747ab706ea",
};
const SELECTED_KEYWORDS = [
  "_DARKNESSENABLED_ON",
  "_FAKESPECULARENABLED_ON",
  "_HOLOGRAM2ENABLED_ON",
  "_REFLECTIONENABLED_ON",
];
const PASS_POLICY = {
  rtSeparateBlend: false,
  fixed: {
    zClip: { val: 1, name: null }, conservative: { val: 0, name: null },
    offsetFactor: { val: 0, name: null }, offsetUnits: { val: 0, name: null },
    alphaToMask: { val: 0, name: null }, fogMode: -1, lighting: false,
  },
};
const FRAGMENT_BASIS_CONVERSIONS = Object.freeze({
  objectMatrices: [{
    matrixName: "modelMatrix",
    columns: [
      { column: 1, expectedOccurrences: 1 },
      { column: 2, expectedOccurrences: 1 },
    ],
  }],
  worldVectors: [],
  viewForwards: [],
});

function assertEqual(actual, expected, message) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function member(name, type, offset, array = undefined) {
  return { name, type, offset, ...(array ? { array } : {}) };
}

function reflectedMember(item) {
  return {
    name: item.name,
    type: item.type,
    offset: item.offset,
    ...(item.array ? { array: item.array } : {}),
  };
}

function assertReflection(reflection, expected) {
  const ubo = (reflection.ubos || []).find((item) => item.name === expected.ubo.name);
  if (!ubo || ubo.block_size !== expected.ubo.size) throw new Error(`${expected.ubo.name} UBO layout changed`);
  assertEqual(
    (reflection.types?.[ubo.type]?.members || []).map(reflectedMember),
    expected.ubo.members,
    `${expected.ubo.name} members changed`,
  );
  for (const key of ["inputs", "outputs"]) {
    assertEqual(
      (reflection[key] || []).map(({ name, type, location }) => ({ name, type, location })).sort((a, b) => a.location - b.location),
      expected[key],
      `${expected.ubo.name} ${key} changed`,
    );
  }
  assertEqual(
    (reflection.textures || []).map(({ name, type, binding }) => ({ name, type, binding })).sort((a, b) => a.binding - b.binding),
    expected.textures || [],
    `${expected.ubo.name} textures changed`,
  );
  return { ubo, members: reflection.types[ubo.type].members };
}

function replaceMembers(source, owner, mapping) {
  return source.replace(new RegExp(`${owner}\\._m(\\d+)`, "g"), (match, rawIndex) => {
    const value = mapping[Number(rawIndex)];
    if (value == null) throw new Error(`unmapped ${match}`);
    return value;
  });
}

function replaceUbo(source, blockName, instanceName, uniforms) {
  const re = new RegExp(`layout\\(std140\\) uniform ${blockName}[\\s\\S]*?}\\s*${instanceName};\\s*`);
  const out = source.replace(re, `${uniforms.join("\n")}\n\n`);
  if (out === source) throw new Error(`${blockName} UBO replacement failed`);
  return out;
}

function bufferByPrefix(bindings, prefix) {
  const result = bindings.constantBuffers.find((item) => item.name.startsWith(prefix));
  if (!result) throw new Error(`${prefix} parameter blob missing`);
  return result;
}

const ENGINE_NAMES = {
  _WorldSpaceCameraPos: "cameraPosition",
  unity_MatrixV: "viewMatrix",
  unity_MatrixVP: "_ViewProjection",
  unity_ObjectToWorld: "_ObjectToWorld",
  unity_WorldToObject: "_WorldToObject",
};

function bindingMap(buffer, reflectedMembers, overrides = {}) {
  const byOffset = new Map(buffer.fields.map((item) => [item.offset, item.name]));
  if (byOffset.size !== reflectedMembers.length) throw new Error(`${buffer.name} field count changed`);
  return reflectedMembers.map((item) => {
    const official = byOffset.get(item.offset);
    if (!official) throw new Error(`${buffer.name}: no official field at offset ${item.offset}`);
    return overrides[official] || ENGINE_NAMES[official] || official;
  });
}

function assertBufferOffsets(buffer, reflectedMembers) {
  assertEqual(
    buffer.fields.map(({ name, offset }) => ({ name, offset })).sort((a, b) => a.offset - b.offset),
    reflectedMembers.map((item) => ({ name: buffer.fields.find((field) => field.offset === item.offset)?.name, offset: item.offset })),
    `${buffer.name} offsets disagree with SPIR-V`,
  );
}

function adaptVertex(source, mapping) {
  let out = source.replace(/^#version 300 es\s*/m, "precision highp float;\nprecision highp int;\n\n");
  out = replaceUbo(out, "_19_21", "_21", [
    "uniform highp mat4 modelMatrix;",
    "uniform highp mat4 viewMatrix;",
    "uniform highp mat4 projectionMatrix;",
    "uniform mediump float _FakeSpecularMaskScale;",
    "uniform mediump float _FakeSpecularIntensity;",
    "uniform mediump float _FakeSpecularPower;",
    "uniform mediump float _FakeSpecularCornerPower;",
    "uniform mediump float _FakeSpecularNotCornerOffset;",
    "uniform mediump float _FakeSpecularMaskScale_Outline;",
    "uniform mediump float _FakeSpecularIntensity_Outline;",
    "uniform mediump float _FakeSpecularPower_Outline;",
  ]);
  out = out
    .replace("layout(location = 0) in vec4 _11;", "in vec3 position;")
    .replace("layout(location = 2) in vec3 _99;", "in vec3 normal;")
    .replace("layout(location = 1) in vec2 _1098;", "in vec2 uv;")
    .replace(/void main\(\)\s*\{/, `void main()\n{\n    vec4 _11 = vec4(position, 1.0);\n    vec3 _99 = normal;\n    vec2 _1098 = uv;\n    mat4 _ObjectToWorld = modelMatrix;\n    mat4 _WorldToObject = inverse(modelMatrix);\n    mat4 _ViewProjection = projectionMatrix * viewMatrix;`);
  out = replaceMembers(out, "_21", mapping);
  out = out.replace(/^\s*gl_Position\.y\s*=\s*-gl_Position\.y;\s*$/m, "");
  if (/_21\._m|gl_Position\.y\s*=\s*-gl_Position\.y/.test(out)) throw new Error("vertex adaptation incomplete");
  return `${out.trimEnd()}\n`;
}

function adaptFragment(source, mapping) {
  let out = source.replace(/^#version 300 es\s*/m, "");
  out = replaceUbo(out, "_31_33", "_33", [
    "uniform highp vec3 cameraPosition;",
    "uniform highp mat4 modelMatrix;",
    "uniform highp mat4 viewMatrix;",
    "uniform float _Shininess;",
    "uniform float _BaseColorIntensity;",
    "uniform float _SpecularIntensity;",
    "uniform float _DiffractionIntensity;",
    "uniform float _DiffractionPower;",
    "uniform float _RampRepeat;",
    "uniform float _RampSpeed;",
    "uniform float _RampOffset;",
    "uniform float _RampInterval;",
    "uniform int _UsePositionAsUV;",
    "uniform float _DiffractionIntensity2;",
    "uniform float _DiffractionPower2;",
    "uniform float _RampRepeat2;",
    "uniform float _RampSpeed2;",
    "uniform float _RampOffset2;",
    "uniform float _RampInterval2;",
    "uniform float _RemoveBase;",
    "uniform float _TiltPower2;",
    "uniform float _TiltOffset2;",
    "uniform float _TiltIntensity2;",
    "uniform vec3 _ReflectionColor;",
    "uniform float _ReflectionIntensity;",
    "uniform float _ReflectionPower;",
    "uniform float _ReflectionCenterAdjust;",
    "uniform int _RefTiltEnabled;",
    "uniform float _RefTiltPower;",
    "uniform float _RefTiltOffset;",
    "uniform float _RefTiltIntensity;",
    "uniform vec3 _FakeSpecularColor;",
    "uniform vec3 _FakeSpecularColor_Outline;",
    "uniform vec3 _DarknessColor;",
    "uniform float _DarknessOffset;",
    "uniform vec3 _OutlineColor;",
    "uniform vec4 _EmissiveColor;",
    "uniform vec3 _Rotation;",
    "uniform highp float _Tilt;",
  ]);
  out = replaceMembers(out, "_33", mapping);
  out = adaptUnityObjectToWorldDataAxes(out, {
    matrixName: "modelMatrix", expectedCounts: { 1: 1, 2: 1 },
  });
  if (/_33\._m/.test(out)) throw new Error("fragment adaptation incomplete");
  if (!/layout\(location = 1\) out highp vec4 _2004/.test(out)) throw new Error("official emissive output missing");
  return `${out.trimEnd()}\n`;
}

const vertexExpected = {
  ubo: { name: "_19_21", size: 224, members: [
    member("_m0", "vec4", 0, [4]), member("_m1", "vec4", 64, [4]), member("_m2", "vec4", 128, [4]),
    ...Array.from({ length: 8 }, (_, index) => member(`_m${index + 3}`, "float", 192 + index * 4)),
  ] },
  inputs: [
    { name: "_11", type: "vec4", location: 0 }, { name: "_1098", type: "vec2", location: 1 },
    { name: "_99", type: "vec3", location: 2 },
  ],
  outputs: [
    { name: "vs_TEXCOORD0", type: "vec2", location: 0 }, { name: "vs_TEXCOORD5", type: "vec2", location: 1 },
    { name: "vs_TEXCOORD1", type: "vec3", location: 2 }, { name: "vs_TEXCOORD2", type: "vec3", location: 3 },
    { name: "vs_TEXCOORD6", type: "vec4", location: 4 }, { name: "vs_TEXCOORD7", type: "vec4", location: 5 },
  ],
  textures: [],
};

const fragmentExpected = {
  ubo: { name: "_31_33", size: 368, members: [
    member("_m0", "vec3", 0), member("_m1", "vec4", 16, [4]), member("_m2", "vec4", 80, [4]),
    ...Array.from({ length: 10 }, (_, index) => member(`_m${index + 3}`, index === 9 ? "int" : "float", 144 + index * 4)),
    ...Array.from({ length: 10 }, (_, index) => member(`_m${index + 13}`, "float", 184 + index * 4)),
    member("_m23", "vec3", 224), member("_m24", "float", 236), member("_m25", "float", 240),
    member("_m26", "float", 244), member("_m27", "int", 248), member("_m28", "float", 252),
    member("_m29", "float", 256), member("_m30", "float", 260), member("_m31", "vec3", 272),
    member("_m32", "vec3", 288), member("_m33", "vec3", 304), member("_m34", "float", 316),
    member("_m35", "vec3", 320), member("_m36", "vec4", 336), member("_m37", "vec3", 352),
    member("_m38", "float", 364),
  ] },
  inputs: [
    { name: "vs_TEXCOORD0", type: "vec2", location: 0 }, { name: "vs_TEXCOORD5", type: "vec2", location: 1 },
    { name: "vs_TEXCOORD1", type: "vec3", location: 2 }, { name: "vs_TEXCOORD2", type: "vec3", location: 3 },
    { name: "vs_TEXCOORD6", type: "vec4", location: 4 }, { name: "vs_TEXCOORD7", type: "vec4", location: 5 },
  ],
  outputs: [{ name: "_1985", type: "vec4", location: 0 }, { name: "_2004", type: "vec4", location: 1 }],
  textures: [
    { name: "_13", type: "sampler2D", binding: 0 }, { name: "_291", type: "sampler2D", binding: 1 },
    { name: "_354", type: "samplerCube", binding: 2 }, { name: "_419", type: "sampler2D", binding: 3 },
    { name: "_428", type: "sampler2D", binding: 4 }, { name: "_435", type: "sampler2D", binding: 5 },
    { name: "_607", type: "sampler2D", binding: 6 }, { name: "_705", type: "sampler2D", binding: 7 },
    { name: "_719", type: "sampler2D", binding: 8 }, { name: "_862", type: "sampler2D", binding: 9 },
    { name: "_926", type: "sampler2D", binding: 10 }, { name: "_1609", type: "sampler2D", binding: 11 },
    { name: "_1775", type: "sampler2D", binding: 12 },
  ],
};

await withExtractedSelectorProgram({
  selectorId: SELECTOR_ID,
  candidateWitnessId: CANDIDATE_WITNESS_ID,
  expectedProofGraphSha256: PROOF_GRAPH_SHA256,
  expectedPortIndexSha256: PORT_INDEX_SHA256,
  decryptedRoot: path.resolve(SHADER_ROOT, "..", ".."),
  prefix: "opaque_ur_oklab",
  rootDir: ROOT,
  spirvCross: SPIRV_CROSS,
}, ({ metadata, files, reflection }) => {
  assertEqual(metadata.selector.keywords, SELECTED_KEYWORDS, "selector keyword set changed");
  if (metadata.parameterReflectionSha256 !== PARAMETER_REFLECTION_SHA256) {
    throw new Error("official parameter reflection changed");
  }
  if (metadata.artifacts.parameterEntry.byteSize !== 2692) throw new Error("official parameter entry byte size changed");

  const vertInfo = assertReflection(reflection.vertex, vertexExpected);
  const fragInfo = assertReflection(reflection.fragment, fragmentExpected);
  const parameterBindings = { constantBuffers: metadata.parameterReflection.constantBuffers };
  const vglobals = bufferByPrefix(parameterBindings, "VGlobals");
  const pglobals = bufferByPrefix(parameterBindings, "PGlobals");
  if (vglobals.size !== vertInfo.ubo.block_size || pglobals.size !== fragInfo.ubo.block_size) {
    throw new Error("parameter entry and SPIR-V UBO sizes disagree");
  }
  assertBufferOffsets(vglobals, vertInfo.members);
  assertBufferOffsets(pglobals, fragInfo.members);
  const vertexMapping = bindingMap(vglobals, vertInfo.members);
  const fragmentMapping = bindingMap(pglobals, fragInfo.members, { unity_ObjectToWorld: "modelMatrix" });

  const commonBindings = compileCommonBindings(metadata.commonBindings);
  const programBindings = joinProgramConstantBufferStages(
    compileProgramBindings(
      commonBindings,
      metadata.parameterReflection,
      metadata.shaderPropertyDefaults,
    ),
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
    if (set !== 0) throw new Error("WebGL sampler port requires descriptor set 0");
    return row;
  });
  assertEqual(samplerBindings.map(({ slot, spirvName, binding }) => ({ slot, spirvName, binding })), [
    { slot: "_MainTex", spirvName: "_13", binding: 0 },
    { slot: "_HologramMaskTex", spirvName: "_291", binding: 1 },
    { slot: "_CubeMap", spirvName: "_354", binding: 2 },
    { slot: "_PhaseTex", spirvName: "_419", binding: 3 },
    { slot: "_PhaseMaskTex", spirvName: "_428", binding: 4 },
    { slot: "_RampMaskTex", spirvName: "_435", binding: 5 },
    { slot: "_RampTex", spirvName: "_607", binding: 6 },
    { slot: "_PhaseTex2", spirvName: "_705", binding: 7 },
    { slot: "_RampMaskTex2", spirvName: "_719", binding: 8 },
    { slot: "_RampTex2", spirvName: "_862", binding: 9 },
    { slot: "_FakeSpecularMask", spirvName: "_926", binding: 10 },
    { slot: "_NormalMap2", spirvName: "_1609", binding: 11 },
    { slot: "_ReflectionMask", spirvName: "_1775", binding: 12 },
  ], "compiled sampler binding map changed");

  const officialVert = runCommand(SPIRV_CROSS, [files.vertexSpirv, "--version", "300", "--es"], { cwd: ROOT });
  const officialFrag = runCommand(SPIRV_CROSS, [files.fragmentSpirv, "--version", "300", "--es"], { cwd: ROOT });
  if (sha256(officialVert) !== OFFICIAL_CROSS_SHA256.vertex || sha256(officialFrag) !== OFFICIAL_CROSS_SHA256.fragment) {
    throw new Error("complete official SPIRV-Cross output changed");
  }
  const vertex = adaptVertex(officialVert, vertexMapping);
  const fragment = adaptFragment(officialFrag, fragmentMapping);
  const materialFloats = [
    "_FakeSpecularMaskScale", "_FakeSpecularIntensity", "_FakeSpecularPower", "_FakeSpecularCornerPower",
    "_FakeSpecularNotCornerOffset", "_FakeSpecularMaskScale_Outline", "_FakeSpecularIntensity_Outline",
    "_FakeSpecularPower_Outline", "_Shininess", "_BaseColorIntensity", "_SpecularIntensity",
    "_DiffractionIntensity", "_DiffractionPower", "_RampRepeat", "_RampSpeed", "_RampOffset", "_RampInterval",
    "_DiffractionIntensity2", "_DiffractionPower2", "_RampRepeat2", "_RampSpeed2", "_RampOffset2",
    "_RampInterval2", "_RemoveBase", "_TiltPower2", "_TiltOffset2", "_TiltIntensity2", "_ReflectionIntensity",
    "_ReflectionPower", "_ReflectionCenterAdjust", "_RefTiltPower", "_RefTiltOffset", "_RefTiltIntensity",
    "_DarknessOffset", "_Tilt",
  ];
  const runtimeContract = {
    schema: "pocket-card-render/webgl-runtime-port@1",
    shader_key: "Opaque-UR-Oklab",
    attributes: { position: "vec3", uv: "vec2", normal: "vec3" },
    engine_uniforms: {
      modelMatrix: "mat4", viewMatrix: "mat4", projectionMatrix: "mat4", cameraPosition: "vec3",
    },
    material_uniforms: {
      floats: materialFloats,
      ints: ["_UsePositionAsUV", "_RefTiltEnabled"],
      vectors: {
        _ReflectionColor: "vec3", _FakeSpecularColor: "vec3", _FakeSpecularColor_Outline: "vec3",
        _DarknessColor: "vec3", _OutlineColor: "vec3", _EmissiveColor: "vec4", _Rotation: "vec3",
      },
    },
    require_complete_active_bindings: true,
    camera_from_view: true,
    mrt_attachments: 2,
    stencil_normalization: "none",
    stencil_face_mode: "generic",
    backend_basis_conversions: { fragment: FRAGMENT_BASIS_CONVERSIONS },
  };
  const adaptation = buildWebglAdaptationV2({
    vertex: {
      officialSpirvSha256: sha256File(files.vertexSpirv),
      spirvCrossGlslSha256: sha256(officialVert),
      outputSha256: sha256(vertex),
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
        "replace variant-local VGlobals UBO members with same-name Three.js uniforms",
        "position vec4 := vec4(three.position, 1.0), normal := three.normal and uv := three.uv",
        "unity_ObjectToWorld := three.modelMatrix and unity_WorldToObject := inverse(three.modelMatrix)",
        "unity_MatrixVP := three.projectionMatrix * three.viewMatrix",
        "remove Unity Vulkan clip-space Y inversion for WebGL clip space",
      ],
    },
    fragment: {
      officialSpirvSha256: sha256File(files.fragmentSpirv),
      spirvCrossGlslSha256: sha256(officialFrag),
      outputSha256: sha256(fragment),
      operations: [
        { kind: "engine-uniform-binding", contract: "unity-builtins-to-three-r165" },
        {
          kind: "uniform-buffer-flattening",
          source: "variant-local",
          preservation: "names-types-precision",
        },
        { kind: "object-basis-conversion", contract: "unity-to-three-basis" },
        { kind: "glsl-version-ownership", owner: "three-raw-shader-material" },
      ],
      substitutions: [
        "replace variant-local PGlobals UBO members with same-name Three.js uniforms",
        "recover Unity ObjectToWorld Y/Z-axis data through M_unity = C * M_three * A before reflection arithmetic",
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
    "opaque_ur_oklab.vert.glsl": vertex,
    "opaque_ur_oklab.frag.glsl": fragment,
    "opaque_ur_oklab_uniforms.json": `${JSON.stringify({
      shader: "Opaque-UR-Oklab",
      generated_by: "build/build-exact-opaque-ur-oklab.mjs",
      selected_keywords: SELECTED_KEYWORDS,
      official_selector: metadata.selector,
      official_spirv_sha256: {
        vertex: sha256File(files.vertexSpirv), fragment: sha256File(files.fragmentSpirv),
      },
      official_spirv_precision: metadata.officialSpirvPrecision,
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
        ...commonBindings,
      },
      official_program_bindings: manifestProgramBindings,
      official_vertex_inputs: vertexInputContract,
      official_shader_property_defaults: metadata.shaderPropertyDefaults,
      webgl_adaptation: adaptation,
      webgl_sources: {
        vertex: "public/shaders/opaque_ur_oklab.vert.glsl",
        fragment: "public/shaders/opaque_ur_oklab.frag.glsl",
      },
      runtime_contract: runtimeContract,
      sampler_bindings: samplerBindings,
      samplers: samplerBindings.map((row) => row.spirvName),
      sampler_slots: samplerBindings.map((row) => row.slot),
      compiled_texture_bindings: Object.fromEntries(samplerBindings.map((row) => [row.slot, row.binding])),
      vertex_fields: Object.fromEntries(vglobals.fields.map(({ name, offset }) => [name, offset])),
      fragment_fields: Object.fromEntries(pglobals.fields.map(({ name, offset }) => [name, offset])),
      implicit_defaults: { ...metadata.shaderPropertyDefaults.textures, _CubeMap: "gray" },
      mrt: { primary: "_1985", emissive: "_2004", secondary_rgb: "active" },
    }, null, 2)}\n`,
  };
  writeOrCheckOutputs(outputs, { outDir: OUT, check: CHECK });
  console.log(`${CHECK ? "verified" : "generated"} selector-owned Opaque-UR-Oklab WebGL2 port`);
});
