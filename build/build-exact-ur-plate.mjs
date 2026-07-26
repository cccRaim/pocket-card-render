// Generate Card_UR_Plate from its exact official material selector.
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  adaptUnityObjectToWorldDataAxes,
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
const SELECTOR_ID = "3e1cd33844c0b10485117226df1e7033f4bf70e71481389930adfd310807520f";
const CANDIDATE_WITNESS_ID = "dbaf20c45c9886086ace387db281ef59447ed2d468104fd45219704768dc36f4";
const PROOF_GRAPH_SHA256 = "9862f63e11f359ed3b92b0191d21a2b6520de5a37159fd14612bdaf1908396b0";
const PORT_INDEX_SHA256 = "30bc4d0eab1c1ad82147e880c642cbd8fba6d55cbd2227c2aa78f082f14e7e3f";
const OFFICIAL_CROSS_SHA256 = {
  vertex: "8b157fe649d4372b58e5db24b92f16f41b9a0871b2e032e85b0be81614230697",
  fragment: "52b4a8d3eecb9abe463f763da69e43d40c05fe40833affce748f470086df64a5",
};
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
    columns: [{ column: 2, expectedOccurrences: 3 }],
  }],
  worldVectors: [],
  viewForwards: [],
});

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
  equal((data.types[ubo.type].members || []).map(({ name, type, offset, array }) => ({ name, type, offset, ...(array ? { array } : {}) })), expected.ubo.members, `${expected.ubo.name} members changed`);
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
  out = replaceUbo(out, "_21_23", "_23", [
    "uniform highp vec3 cameraPosition;", "uniform highp mat4 modelMatrix;", "uniform highp mat4 viewMatrix;",
    "uniform highp mat4 projectionMatrix;", "uniform mediump float _FakeCameraHeight;",
    "uniform mediump float _Height;", "uniform mediump float _HeightPower;", "uniform mediump float _Scale;",
    "uniform int _UseUv2;", "uniform mediump float _FakeSpecularMaskScale;",
    "uniform mediump float _FakeSpecularIntensity;", "uniform mediump float _FakeSpecularPower;",
    "uniform mediump float _FakeSpecularCornerPower;", "uniform mediump float _FakeSpecularNotCornerOffset;",
  ]);
  out = out
    .replace("layout(location = 0) in vec4 _11;", "in vec3 position;")
    .replace("layout(location = 1) in vec3 _79;", "in vec3 normal;")
    .replace("layout(location = 4) in mediump vec4 _131;", "in vec4 tangent;")
    .replace("layout(location = 2) in vec2 _295;", "in vec2 uv;")
    .replace("layout(location = 3) in vec2 _329;", "in vec2 uv1;")
    .replace(/void main\(\)\s*\{/, `void main()\n{\n    vec4 _11 = vec4(position, 1.0);\n    vec3 _79 = normal;\n    vec4 _131 = tangent;\n    vec2 _295 = uv;\n    vec2 _329 = uv1;\n    mat4 _ObjectToWorld = modelMatrix;\n    mat4 _WorldToObject = inverse(modelMatrix);\n    mat4 _ViewProjection = projectionMatrix * viewMatrix;`);
  out = replaceMembers(out, "_23", [
    "cameraPosition", "_ObjectToWorld", "_WorldToObject", "_ViewProjection", "_FakeCameraHeight", "_Height",
    "_HeightPower", "_Scale", "_UseUv2", "_FakeSpecularMaskScale", "_FakeSpecularIntensity",
    "_FakeSpecularPower", "_FakeSpecularCornerPower", "_FakeSpecularNotCornerOffset",
  ]);
  out = out.replace(/^\s*gl_Position\.y\s*=\s*-gl_Position\.y;\s*$/m, "");
  if (/_23\._m|gl_Position\.y\s*=\s*-gl_Position\.y/.test(out)) throw new Error("vertex adaptation incomplete");
  return `${out.trimEnd()}\n`;
}

function adaptFragment(source) {
  let out = source.replace(/^#version 300 es\s*/m, "");
  out = replaceUbo(out, "_15_17", "_17", [
    "uniform highp vec3 cameraPosition;", "uniform highp mat4 modelMatrix;", "uniform highp mat4 viewMatrix;",
    "uniform mediump float _Shininess;", "uniform mediump float _BaseColorIntensity;",
    "uniform mediump float _SpecularIntensity;", "uniform mediump float _DiffractionIntensity;",
    "uniform mediump float _DiffractionPower;", "uniform mediump float _RampRepeat;",
    "uniform mediump float _RampSpeed;", "uniform mediump float _RampOffset;",
    "uniform mediump float _RampInterval;", "uniform mediump float _RemoveMetalic;",
    "uniform mediump vec3 _FakeSpecularColor;", "uniform mediump vec3 _DarknessColor;",
    "uniform mediump float _DarknessOffset;",
  ]);
  out = replaceMembers(out, "_17", [
    "cameraPosition", "modelMatrix", "viewMatrix", "_Shininess", "_BaseColorIntensity", "_SpecularIntensity",
    "_DiffractionIntensity", "_DiffractionPower", "_RampRepeat", "_RampSpeed", "_RampOffset",
    "_RampInterval", "_RemoveMetalic", "_FakeSpecularColor", "_DarknessColor", "_DarknessOffset",
  ]);
  out = adaptUnityObjectToWorldDataAxes(out, {
    matrixName: "modelMatrix", expectedCounts: { 2: 3 },
  });
  if (/_17\._m/.test(out)) throw new Error("fragment adaptation incomplete");
  return `${out.trimEnd()}\n`;
}


const vertexExpected = {
  ubo: { name: "_21_23", size: 248, members: [
    member("_m0", "vec3", 0), member("_m1", "vec4", 16, [4]), member("_m2", "vec4", 80, [4]),
    member("_m3", "vec4", 144, [4]), ...Array.from({ length: 4 }, (_, i) => member(`_m${i + 4}`, "float", 208 + i * 4)),
    member("_m8", "int", 224), ...Array.from({ length: 5 }, (_, i) => member(`_m${i + 9}`, "float", 228 + i * 4)),
  ] },
  inputs: [
    { name: "_11", type: "vec4", location: 0 }, { name: "_79", type: "vec3", location: 1 },
    { name: "_295", type: "vec2", location: 2 }, { name: "_329", type: "vec2", location: 3 },
    { name: "_131", type: "vec4", location: 4 },
  ],
  outputs: [
    { name: "vs_TEXCOORD0", type: "vec2", location: 0 }, { name: "vs_TEXCOORD1", type: "vec2", location: 1 },
    { name: "vs_TEXCOORD3", type: "vec3", location: 2 }, { name: "vs_TEXCOORD4", type: "vec3", location: 3 },
    { name: "vs_TEXCOORD5", type: "vec4", location: 4 },
  ], textures: [],
};

const fragmentExpected = {
  ubo: { name: "_15_17", size: 224, members: [
    member("_m0", "vec3", 0), member("_m1", "vec4", 16, [4]), member("_m2", "vec4", 80, [4]),
    ...Array.from({ length: 10 }, (_, i) => member(`_m${i + 3}`, "float", 144 + i * 4)),
    member("_m13", "vec3", 192), member("_m14", "vec3", 208), member("_m15", "float", 220),
  ] },
  inputs: [
    { name: "vs_TEXCOORD0", type: "vec2", location: 0 }, { name: "vs_TEXCOORD1", type: "vec2", location: 1 },
    { name: "vs_TEXCOORD3", type: "vec3", location: 2 }, { name: "vs_TEXCOORD4", type: "vec3", location: 3 },
    { name: "vs_TEXCOORD5", type: "vec4", location: 4 },
  ],
  outputs: [{ name: "_603", type: "vec4", location: 0 }, { name: "_658", type: "vec4", location: 1 }],
  textures: [
    { name: "_594", type: "sampler2D", binding: 0 }, { name: "_555", type: "samplerCube", binding: 1 },
    { name: "_413", type: "sampler2D", binding: 2 }, { name: "_483", type: "sampler2D", binding: 3 },
    { name: "_341", type: "sampler2D", binding: 4 }, { name: "_393", type: "sampler2D", binding: 5 },
    { name: "_615", type: "sampler2D", binding: 6 }, { name: "_219", type: "sampler2D", binding: 7 },
  ],
};

await withExtractedSelectorProgram({
  selectorId: SELECTOR_ID,
  candidateWitnessId: CANDIDATE_WITNESS_ID,
  expectedProofGraphSha256: PROOF_GRAPH_SHA256,
  expectedPortIndexSha256: PORT_INDEX_SHA256,
  decryptedRoot: path.resolve(SHADER_ROOT, "..", ".."),
  prefix: "ur_plate",
  rootDir: ROOT,
  spirvCross: SPIRV_CROSS,
}, ({ metadata, files, reflection }) => {
  const vertSpv = files.vertexSpirv;
  const fragSpv = files.fragmentSpirv;
  assertReflection(reflection.vertex, vertexExpected);
  assertReflection(reflection.fragment, fragmentExpected);
  equal(metadata.parameterReflection, {
    version: 202012090,
    constantBlockCount: 3,
    constantBuffers: [
      { name: "", size: 0, fields: [] },
      { name: "PGlobals33246651", size: 224, fields: [] },
      { name: "VGlobals33246651", size: 248, fields: [] },
    ],
    resourceCount: 0,
    resourceDecoding: "empty-exact",
    textures: [],
    constantBufferBindings: [],
    serializedCommonBuffers: [
      { name: "PGlobals33246651", size: 224 },
      { name: "VGlobals33246651", size: 248 },
    ],
    serializedCommonTextures: [
      { name: "_MainTex", binding: 0, encodedIndex: 134217728, dim: 2 },
      { name: "_CubeMap", binding: 1, encodedIndex: 134217729, dim: 4 },
      { name: "_PhaseTex", binding: 2, encodedIndex: 134217730, dim: 2 },
      { name: "_PhaseMaskTex", binding: 3, encodedIndex: 134217731, dim: 2 },
      { name: "_RampMaskTex", binding: 4, encodedIndex: 134217732, dim: 2 },
      { name: "_RampTex", binding: 5, encodedIndex: 134217733, dim: 2 },
      { name: "_HologramMaskTex", binding: 6, encodedIndex: 134217734, dim: 2 },
      { name: "_FakeSpecularMask", binding: 7, encodedIndex: 134217735, dim: 2 },
    ],
    bindingClosure: {
      constantBuffersMatch: true,
      constantBufferDeclarationMode: "serialized-common",
      commonConstantBufferCount: 2,
      variantConstantBufferCount: 0,
      variantTextureCount: 0,
      commonTextureCount: 8,
      constantBufferBindingCount: 0,
    },
  }, "official parameter reflection changed");
  const officialVertex = runCommand(SPIRV_CROSS, [vertSpv, "--version", "300", "--es"], { cwd: ROOT });
  const officialFragment = runCommand(SPIRV_CROSS, [fragSpv, "--version", "300", "--es"], { cwd: ROOT });
  assert.equal(sha256(officialVertex), OFFICIAL_CROSS_SHA256.vertex, "official vertex SPIRV-Cross shape changed");
  assert.equal(sha256(officialFragment), OFFICIAL_CROSS_SHA256.fragment, "official fragment SPIRV-Cross shape changed");
  const binding = compileCommonBindings(metadata.commonBindings);
  const programBindings = joinProgramConstantBufferStages(
    compileProgramBindings(
      binding,
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
    assert.equal(set, 0, "WebGL sampler port requires descriptor set 0");
    return row;
  });
  const samplerSlots = ["_MainTex", "_CubeMap", "_PhaseTex", "_PhaseMaskTex", "_RampMaskTex", "_RampTex", "_HologramMaskTex", "_FakeSpecularMask"];
  equal(samplerBindings.map(({ slot, binding }) => ({ slot, binding })), samplerSlots.map((slot, binding) => ({ slot, binding })), "compiled sampler bindings changed");
  const vertex = adaptVertex(officialVertex);
  const fragment = adaptFragment(officialFragment);
  const runtimeContract = {
    schema: "pocket-card-render/webgl-runtime-port@1",
    shader_key: "Card_UR_Plate",
    attributes: { position: "vec3", normal: "vec3", uv: "vec2", uv1: "vec2", tangent: "vec4" },
    engine_uniforms: {
      modelMatrix: "mat4", viewMatrix: "mat4", projectionMatrix: "mat4", cameraPosition: "vec3",
    },
    material_uniforms: {
      floats: [
        "_FakeCameraHeight", "_Height", "_HeightPower", "_Scale", "_FakeSpecularMaskScale",
        "_FakeSpecularIntensity", "_FakeSpecularPower", "_FakeSpecularCornerPower",
        "_FakeSpecularNotCornerOffset", "_Shininess", "_BaseColorIntensity", "_SpecularIntensity",
        "_DiffractionIntensity", "_DiffractionPower", "_RampRepeat", "_RampSpeed", "_RampOffset",
        "_RampInterval", "_RemoveMetalic", "_DarknessOffset",
      ],
      ints: ["_UseUv2"],
      vectors: { _FakeSpecularColor: "vec3", _DarknessColor: "vec3" },
    },
    camera_from_view: true,
    require_complete_active_bindings: true,
    mrt_attachments: 2,
    stencil_normalization: "disable-when-always-keep",
    stencil_face_mode: "generic",
    backend_basis_conversions: { fragment: FRAGMENT_BASIS_CONVERSIONS },
  };
  const adaptation = buildWebglAdaptationV2({
    vertex: {
      officialSpirvSha256: sha256File(vertSpv),
      spirvCrossGlslSha256: sha256(officialVertex),
      outputSha256: sha256(vertex),
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
    },
    fragment: {
      officialSpirvSha256: sha256File(fragSpv),
      spirvCrossGlslSha256: sha256(officialFragment),
      outputSha256: sha256(fragment),
      operations: [
        { kind: "engine-uniform-binding", contract: "unity-builtins-to-three-r165" },
        {
          kind: "uniform-buffer-flattening",
          source: "serialized-common",
          preservation: "names-types-precision",
        },
        { kind: "object-basis-conversion", contract: "unity-to-three-basis" },
        { kind: "glsl-version-ownership", owner: "three-raw-shader-material" },
      ],
    },
    interfaceSha256: canonicalJsonSha256({ vertex: reflection.vertex, fragment: reflection.fragment }),
    officialVertexInputs: vertexInputContract,
    runtimeContract,
    officialProgramBindings: manifestProgramBindings,
  });
  const outputs = {
    "ur_plate.vert.glsl": vertex,
    "ur_plate.frag.glsl": fragment,
    "ur_plate_uniforms.json": `${JSON.stringify({
      shader: "Card_UR_Plate", generated_by: "build/build-exact-ur-plate.mjs",
      official_selector: metadata.selector,
      official_spirv_sha256: { vertex: sha256File(vertSpv), fragment: sha256File(fragSpv) },
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
        policy: PASS_POLICY,
      }),
      official_common_bindings: { source_sha256: metadata.identityFields.commonBindingsSha256, ...binding },
      official_program_bindings: manifestProgramBindings,
      official_vertex_inputs: vertexInputContract,
      official_shader_property_defaults: metadata.shaderPropertyDefaults,
      webgl_adaptation: adaptation,
      webgl_sources: {
        vertex: "public/shaders/ur_plate.vert.glsl",
        fragment: "public/shaders/ur_plate.frag.glsl",
      },
      runtime_contract: runtimeContract,
      sampler_bindings: samplerBindings,
      samplers: samplerBindings.map((row) => row.spirvName),
      sampler_slots: samplerBindings.map((row) => row.slot),
      compiled_texture_bindings: Object.fromEntries(samplerBindings.map((row) => [row.slot, row.binding])),
      implicit_defaults: { ...metadata.shaderPropertyDefaults.textures, _CubeMap: "gray" },
      mrt: { primary: "_603", secondary: "_658", secondary_value: "zero" },
    }, null, 2)}\n`,
  };
  writeOrCheckOutputs(outputs, { outDir: OUT, check: CHECK });
  console.log(`${CHECK ? "verified" : "generated"} Card_UR_Plate from selector-bound official SPIR-V (${sha256File(vertSpv).slice(0, 12)} / ${sha256File(fragSpv).slice(0, 12)})`);
});
