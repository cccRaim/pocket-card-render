// Generate the WebGL2 port of Frame-Holo-UR-New directly from the official Unity shader bundle.
// The shader body stays SPIRV-Cross output; only engine bindings and the MRT1 bloom route are adapted.
import assert from "node:assert/strict";
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
const SELECTOR_ID = "e462cdf6c44efae612e966adf8b062a6a158d60133a8910714d5529c9e4920b6";
const CANDIDATE_WITNESS_ID = "ae75586ab5eb5009c12e838f37ba77cea0ce76343ffa23c4629c7aefdcc1307c";
const PROOF_GRAPH_SHA256 = "9862f63e11f359ed3b92b0191d21a2b6520de5a37159fd14612bdaf1908396b0";
const PORT_INDEX_SHA256 = "30bc4d0eab1c1ad82147e880c642cbd8fba6d55cbd2227c2aa78f082f14e7e3f";
const OFFICIAL_CROSS_SHA256 = {
  vertex: "841b3ea06b94f656e0b33fa6b4a5340c2e7fb63b8c3249352abb6ac354c4cc91",
  fragment: "a93bcb003e65ca56174e53310fdc2edcdce03ea6e8159b85ed0658e6d7294b57",
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

const vertexUniforms = [
  "uniform highp mat4 modelMatrix;",
  "uniform highp mat4 viewMatrix;",
  "uniform highp mat4 projectionMatrix;",
  "uniform mediump float _RampMaskRotation;",
  "uniform mediump float _RampMaskScale;",
  "uniform int _UseSimpleRampMaskAndRotation;",
  "uniform mediump float _FakeSpecularMaskScale;",
  "uniform mediump float _FakeSpecularIntensity;",
  "uniform mediump float _FakeSpecularPower;",
  "uniform mediump float _FakeSpecularCornerPower;",
  "uniform mediump float _FakeSpecularNotCornerOffset;",
].join("\n");

const fragmentUniforms = [
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
  "uniform int _UseSimpleRampMaskAndRotation;",
  "uniform float _RemoveMetalic;",
  "uniform int _FakeSpecularEnabled;",
  "uniform vec3 _FakeSpecularColor;",
  "uniform int _DarknessEnabled;",
  "uniform vec3 _DarknessColor;",
  "uniform float _DarknessOffset;",
  "uniform int _EmissivePattern;",
  "uniform vec4 _EmissiveColor;",
  "uniform vec3 _Rotation;",
].join("\n");

const vertexMembers = [
  "_ObjectToWorld",
  "_WorldToObject",
  "_ViewProjection",
  "_RampMaskRotation",
  "_RampMaskScale",
  "_UseSimpleRampMaskAndRotation",
  "_FakeSpecularMaskScale",
  "_FakeSpecularIntensity",
  "_FakeSpecularPower",
  "_FakeSpecularCornerPower",
  "_FakeSpecularNotCornerOffset",
];

const fragmentMembers = [
  "cameraPosition",
  "modelMatrix",
  "viewMatrix",
  "_Shininess",
  "_BaseColorIntensity",
  "_SpecularIntensity",
  "_DiffractionIntensity",
  "_DiffractionPower",
  "_RampRepeat",
  "_RampSpeed",
  "_RampOffset",
  "_RampInterval",
  "_UseSimpleRampMaskAndRotation",
  "_RemoveMetalic",
  "_FakeSpecularEnabled",
  "_FakeSpecularColor",
  "_DarknessEnabled",
  "_DarknessColor",
  "_DarknessOffset",
  "_EmissivePattern",
  "_EmissiveColor",
  "_Rotation",
];

function replaceMembers(source, owner, members) {
  return source.replace(new RegExp(`${owner}\\._m(\\d+)`, "g"), (match, rawIndex) => {
    const index = Number(rawIndex);
    if (members[index] == null) throw new Error(`unmapped ${match}`);
    return members[index];
  });
}

function assertMatch(source, pattern, message) {
  if (!pattern.test(source)) throw new Error(message);
}

function assertJsonEqual(actual, expected, message) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertReflection(reflection, expected) {
  const ubo = (reflection.ubos || []).find((item) => item.name === expected.ubo.name);
  if (!ubo) throw new Error(`reflection UBO ${expected.ubo.name} missing`);
  if (ubo.block_size !== expected.ubo.blockSize) {
    throw new Error(`reflection UBO ${expected.ubo.name} size ${ubo.block_size} != ${expected.ubo.blockSize}`);
  }
  const members = reflection.types?.[ubo.type]?.members || [];
  assertJsonEqual(members.map(({ name, type, offset }) => ({ name, type, offset })), expected.ubo.members, `${expected.ubo.name} members changed`);
  assertJsonEqual(
    (reflection.inputs || []).map(({ name, type, location }) => ({ name, type, location })).sort((a, b) => a.location - b.location),
    expected.inputs,
    "shader inputs changed",
  );
  assertJsonEqual(
    (reflection.outputs || []).map(({ name, type, location }) => ({ name, type, location })).sort((a, b) => a.location - b.location),
    expected.outputs,
    "shader outputs changed",
  );
  if (expected.textures) {
    assertJsonEqual(
      (reflection.textures || []).map(({ name, type, binding }) => ({ name, type, binding })).sort((a, b) => a.binding - b.binding),
      expected.textures,
      "shader texture bindings changed",
    );
  }
}

function adaptVertex(source) {
  let out = source.replace(/^#version 300 es\s*/m, "precision highp float;\nprecision highp int;\n\n");
  out = out.replace(/layout\(std140\) uniform _20_22[\s\S]*?}\s*_22;\s*/, `${vertexUniforms}\n\n`);
  out = out
    .replace("layout(location = 0) in vec4 _11;", "in vec3 position;")
    .replace("layout(location = 2) in vec2 _809;", "in vec2 uv;")
    .replace("layout(location = 1) in vec3 _853;", "in vec3 normal;")
    .replace(/void main\(\)\s*\{/, "void main()\n{\n    vec4 _11 = vec4(position, 1.0);\n    vec2 _809 = uv;\n    vec3 _853 = normal;\n    mat4 _ObjectToWorld = modelMatrix;\n    mat4 _WorldToObject = inverse(modelMatrix);\n    mat4 _ViewProjection = projectionMatrix * viewMatrix;");
  out = replaceMembers(out, "_22", vertexMembers);
  out = out.replace(/^\s*gl_Position\.y\s*=\s*-gl_Position\.y;\s*$/m, "");
  assertMatch(out, /_ObjectToWorld\[0\]\s*\*\s*_11\.xxxx/, "object-to-world binding missing");
  assertMatch(out, /_WorldToObject\[0\]\.xyz/, "world-to-object normal binding missing");
  assertMatch(out, /mat4 _ViewProjection = projectionMatrix \* viewMatrix;/, "view-projection binding missing");
  if (/_22\._m|gl_Position\.y\s*=\s*-gl_Position\.y/.test(out)) throw new Error("vertex adaptation incomplete");
  return `${out.trimEnd()}\n`;
}

function adaptFragment(source) {
  let out = source.replace(/^#version 300 es\s*/m, "");
  out = out.replace(/layout\(std140\) uniform _49_51[\s\S]*?}\s*_51;\s*/, `${fragmentUniforms}\n\n`);
  out = replaceMembers(out, "_51", fragmentMembers);
  out = adaptUnityObjectToWorldDataAxes(out, {
    matrixName: "modelMatrix", expectedCounts: { 2: 3 },
  });
  assertMatch(out, /layout\(location = 1\) out highp vec4 _1053;/, "official emissive MRT output missing");
  assertMatch(out, /layout\(location = 0\) out highp vec4 _1059;/, "official primary MRT output missing");
  if (/_51\._m/.test(out)) throw new Error("fragment adaptation incomplete");
  return `${out.trimEnd()}\n`;
}

await withExtractedSelectorProgram({
  selectorId: SELECTOR_ID,
  candidateWitnessId: CANDIDATE_WITNESS_ID,
  expectedProofGraphSha256: PROOF_GRAPH_SHA256,
  expectedPortIndexSha256: PORT_INDEX_SHA256,
  decryptedRoot: path.resolve(SHADER_ROOT, "..", ".."),
  prefix: "frame_holo_ur",
  rootDir: ROOT,
  spirvCross: SPIRV_CROSS,
}, ({ metadata, files, reflection }) => {
  assertReflection(reflection.vertex, {
    ubo: {
      name: "_20_22",
      blockSize: 224,
      members: [
        { name: "_m0", type: "vec4", offset: 0 }, { name: "_m1", type: "vec4", offset: 64 },
        { name: "_m2", type: "vec4", offset: 128 }, { name: "_m3", type: "float", offset: 192 },
        { name: "_m4", type: "float", offset: 196 }, { name: "_m5", type: "int", offset: 200 },
        { name: "_m6", type: "float", offset: 204 }, { name: "_m7", type: "float", offset: 208 },
        { name: "_m8", type: "float", offset: 212 }, { name: "_m9", type: "float", offset: 216 },
        { name: "_m10", type: "float", offset: 220 },
      ],
    },
    inputs: [
      { name: "_11", type: "vec4", location: 0 },
      { name: "_853", type: "vec3", location: 1 },
      { name: "_809", type: "vec2", location: 2 },
    ],
    outputs: [
      { name: "vs_TEXCOORD0", type: "vec2", location: 0 },
      { name: "vs_TEXCOORD5", type: "float", location: 1 },
      { name: "vs_TEXCOORD2", type: "vec3", location: 2 },
      { name: "vs_TEXCOORD3", type: "vec3", location: 3 },
      { name: "vs_TEXCOORD4", type: "vec4", location: 4 },
    ],
  });
  assertReflection(reflection.fragment, {
    ubo: {
      name: "_49_51",
      blockSize: 268,
      members: [
        { name: "_m0", type: "vec3", offset: 0 }, { name: "_m1", type: "vec4", offset: 16 },
        { name: "_m2", type: "vec4", offset: 80 }, { name: "_m3", type: "float", offset: 144 },
        { name: "_m4", type: "float", offset: 148 }, { name: "_m5", type: "float", offset: 152 },
        { name: "_m6", type: "float", offset: 156 }, { name: "_m7", type: "float", offset: 160 },
        { name: "_m8", type: "float", offset: 164 }, { name: "_m9", type: "float", offset: 168 },
        { name: "_m10", type: "float", offset: 172 }, { name: "_m11", type: "float", offset: 176 },
        { name: "_m12", type: "int", offset: 180 }, { name: "_m13", type: "float", offset: 184 },
        { name: "_m14", type: "int", offset: 188 }, { name: "_m15", type: "vec3", offset: 192 },
        { name: "_m16", type: "int", offset: 204 }, { name: "_m17", type: "vec3", offset: 208 },
        { name: "_m18", type: "float", offset: 220 }, { name: "_m19", type: "int", offset: 224 },
        { name: "_m20", type: "vec4", offset: 240 }, { name: "_m21", type: "vec3", offset: 256 },
      ],
    },
    inputs: [
      { name: "vs_TEXCOORD0", type: "vec2", location: 0 },
      { name: "vs_TEXCOORD5", type: "float", location: 1 },
      { name: "vs_TEXCOORD2", type: "vec3", location: 2 },
      { name: "vs_TEXCOORD3", type: "vec3", location: 3 },
      { name: "vs_TEXCOORD4", type: "vec4", location: 4 },
    ],
    outputs: [
      { name: "_1059", type: "vec4", location: 0 },
      { name: "_1053", type: "vec4", location: 1 },
    ],
    textures: [
      { name: "_13", type: "sampler2D", binding: 0 }, { name: "_302", type: "sampler2D", binding: 1 },
      { name: "_333", type: "samplerCube", binding: 2 }, { name: "_388", type: "sampler2D", binding: 3 },
      { name: "_396", type: "sampler2D", binding: 4 }, { name: "_410", type: "sampler2D", binding: 5 },
      { name: "_570", type: "sampler2D", binding: 6 }, { name: "_721", type: "sampler2D", binding: 7 },
    ],
  });
  assertJsonEqual(metadata.parameterReflection, {
    version: 202012090,
    constantBlockCount: 3,
    constantBuffers: [
      { name: "", size: 0, fields: [] },
      { name: "PGlobals2067551902", size: 268, fields: [] },
      { name: "VGlobals2067551902", size: 224, fields: [] },
    ],
    resourceCount: 0,
    resourceDecoding: "empty-exact",
    textures: [],
    constantBufferBindings: [],
    serializedCommonBuffers: [
      { name: "PGlobals2067551902", size: 268 }, { name: "VGlobals2067551902", size: 224 },
    ],
    serializedCommonTextures: [
      { name: "_BaseTex", binding: 0, encodedIndex: 134217728, dim: 2 },
      { name: "_HologramMaskTex", binding: 1, encodedIndex: 134217729, dim: 2 },
      { name: "_CubeMap", binding: 2, encodedIndex: 134217730, dim: 4 },
      { name: "_PhaseTex", binding: 3, encodedIndex: 134217731, dim: 2 },
      { name: "_PhaseMaskTex", binding: 4, encodedIndex: 134217732, dim: 2 },
      { name: "_RampMaskTex", binding: 5, encodedIndex: 134217733, dim: 2 },
      { name: "_RampTex", binding: 6, encodedIndex: 134217734, dim: 2 },
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

  const officialVert = runCommand(SPIRV_CROSS, [files.vertexSpirv, "--version", "300", "--es"], { cwd: ROOT });
  const officialFrag = runCommand(SPIRV_CROSS, [files.fragmentSpirv, "--version", "300", "--es"], { cwd: ROOT });
  assert.equal(sha256(officialVert), OFFICIAL_CROSS_SHA256.vertex, "official vertex SPIRV-Cross shape changed");
  assert.equal(sha256(officialFrag), OFFICIAL_CROSS_SHA256.fragment, "official fragment SPIRV-Cross shape changed");
  assertMatch(officialVert, /layout\(std140\) uniform _20_22/, "official vertex UBO layout changed");
  assertMatch(officialFrag, /layout\(std140\) uniform _49_51/, "official fragment UBO layout changed");
  assertMatch(officialFrag, /_1053\s*=/, "official emissive output expression missing");

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
  assertJsonEqual(samplerBindings.map(({ slot, spirvName, binding }) => ({ slot, spirvName, binding })), [
    { slot: "_BaseTex", spirvName: "_13", binding: 0 },
    { slot: "_HologramMaskTex", spirvName: "_302", binding: 1 },
    { slot: "_CubeMap", spirvName: "_333", binding: 2 },
    { slot: "_PhaseTex", spirvName: "_388", binding: 3 },
    { slot: "_PhaseMaskTex", spirvName: "_396", binding: 4 },
    { slot: "_RampMaskTex", spirvName: "_410", binding: 5 },
    { slot: "_RampTex", spirvName: "_570", binding: 6 },
    { slot: "_FakeSpecularMask", spirvName: "_721", binding: 7 },
  ], "compiled sampler bindings changed");

  const vertex = adaptVertex(officialVert);
  const fragment = adaptFragment(officialFrag);
  const runtimeContract = {
    schema: "pocket-card-render/webgl-runtime-port@1",
    shader_key: "Frame-Holo-UR-New",
    attributes: { position: "vec3", normal: "vec3", uv: "vec2" },
    engine_uniforms: {
      modelMatrix: "mat4", viewMatrix: "mat4", projectionMatrix: "mat4", cameraPosition: "vec3",
    },
    material_uniforms: {
      floats: [
        "_RampMaskRotation", "_RampMaskScale", "_FakeSpecularMaskScale", "_FakeSpecularIntensity",
        "_FakeSpecularPower", "_FakeSpecularCornerPower", "_FakeSpecularNotCornerOffset", "_Shininess",
        "_BaseColorIntensity", "_SpecularIntensity", "_DiffractionIntensity", "_DiffractionPower",
        "_RampRepeat", "_RampSpeed", "_RampOffset", "_RampInterval", "_RemoveMetalic", "_DarknessOffset",
      ],
      ints: ["_UseSimpleRampMaskAndRotation", "_FakeSpecularEnabled", "_DarknessEnabled", "_EmissivePattern"],
      vectors: {
        _FakeSpecularColor: "vec3", _DarknessColor: "vec3", _EmissiveColor: "vec4", _Rotation: "vec3",
      },
    },
    require_complete_active_bindings: true,
    camera_from_view: true,
    mrt_attachments: 2,
    stencil_normalization: "disable-when-always-keep",
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
          source: "serialized-common",
          preservation: "names-types-precision",
        },
        { kind: "object-basis-conversion", contract: "unity-to-three-basis" },
        { kind: "glsl-version-ownership", owner: "three-raw-shader-material" },
      ],
      substitutions: [
        "replace serialized PGlobals UBO members with same-name Three.js uniforms",
        "recover Unity ObjectToWorld Z-axis data through M_unity = C * M_three * A before tilt-angle arithmetic",
      ],
    },
    interfaceSha256: canonicalJsonSha256({ vertex: reflection.vertex, fragment: reflection.fragment }),
    officialVertexInputs: vertexInputContract,
    runtimeContract,
    officialProgramBindings: manifestProgramBindings,
  });

  const outputs = {
    "frame_holo_ur.vert.glsl": vertex,
    "frame_holo_ur.frag.glsl": fragment,
    "frame_holo_ur_uniforms.json": `${JSON.stringify({
      shader: "Frame-Holo-UR-New",
      generated_by: "build/build-exact-frame-holo-ur.mjs",
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
      official_pass_runtime: {
        ...compileOfficialPassContract(metadata.passContract, {
          sourceSha256: metadata.identityFields.passStateSha256,
          policy: PASS_POLICY,
        }),
        shader_property_defaults: metadata.shaderPropertyDefaults.floats,
      },
      official_common_bindings: { source_sha256: metadata.identityFields.commonBindingsSha256, ...bindings },
      official_program_bindings: manifestProgramBindings,
      official_vertex_inputs: vertexInputContract,
      official_shader_property_defaults: metadata.shaderPropertyDefaults,
      webgl_adaptation: adaptation,
      webgl_sources: {
        vertex: "public/shaders/frame_holo_ur.vert.glsl",
        fragment: "public/shaders/frame_holo_ur.frag.glsl",
      },
      runtime_contract: runtimeContract,
      sampler_bindings: samplerBindings,
      samplers: samplerBindings.map((row) => row.spirvName),
      sampler_slots: samplerBindings.map((row) => row.slot),
      compiled_texture_bindings: Object.fromEntries(samplerBindings.map((row) => [row.slot, row.binding])),
      implicit_defaults: { _CubeMap: "gray" },
      mrt: { primary: "_1059", emissive: "_1053", secondary_rgb: "active" },
    }, null, 2)}\n`,
  };
  writeOrCheckOutputs(outputs, { outDir: OUT, check: CHECK });
  console.log(`${CHECK ? "verified" : "generated"} Frame-Holo-UR-New from selector-bound official SPIR-V (${sha256File(files.vertexSpirv).slice(0, 12)} / ${sha256File(files.fragmentSpirv).slice(0, 12)})`);
});
