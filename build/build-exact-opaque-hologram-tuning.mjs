// Generate Opaque_Hologram_Tuning from its exact official material selector.
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  adaptThreeViewForwardToUnityDataAxes,
  adaptThreeWorldVectorsToUnityDataAxes,
  canonicalJsonSha256,
  compileCommonBindings,
  compileOfficialPassContract,
  compileOfficialVertexInputContract,
  compileProgramBindings,
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
const SELECTOR_ID = "871457e8f364eeed14f609dc84a84b493b61ea71128a66b8849c721e7ae5e6d4";
const CANDIDATE_WITNESS_ID = "4fff43f2df1325b078c2fe1c92f7e1753a22e1a4b6d0b3e0d9b809c2533f6e22";
const PROOF_GRAPH_SHA256 = "307ed3660e5d3b1bfd8cf9e6b3d64e44937af215da3b6ed84ead198800eeadc4";
const PORT_INDEX_SHA256 = "15095f34b9e75515bbcc3924f6f8b2abb826ba96b48e819ec911486bcfa6f5a9";
const OFFICIAL_CROSS_SHA256 = {
  vertex: "941de2db0d2a134f3cd8b8ecd96d460e1a30cee60740b588d0cbe15910b75160",
  fragment: "f8c3e27e7714410664cca8be462d521187cda9936f17838053f26db8a78e0ffb",
};
const vertexMembers = ["_ObjectToWorld", "_WorldToObject", "_ViewProjection"];
const fragmentMembers = [
  "cameraPosition", "viewMatrix", "_Shininess", "_BaseColorIntensity", "_SpecularIntensity",
  "_DiffractionIntensity", "_DiffractionPower", "_RampRepeat", "_RampSpeed", "_RampOffset",
  "_RampInterval", "_Rotation",
];
const FRAGMENT_BASIS_CONVERSIONS = {
  worldVectors: [
    { source: "cameraPosition", alias: "pcrUnityCameraPosition", expectedOccurrences: 1 },
    { source: "vs_TEXCOORD1", alias: "pcrUnityWorldPosition", expectedOccurrences: 1 },
    { source: "vs_TEXCOORD2", alias: "pcrUnityWorldNormal", expectedOccurrences: 3 },
  ],
  viewForwards: [{ matrixName: "viewMatrix", targetName: "_48" }],
};
const materialFloats = [
  "_Shininess", "_BaseColorIntensity", "_SpecularIntensity", "_DiffractionIntensity",
  "_DiffractionPower", "_RampRepeat", "_RampSpeed", "_RampOffset", "_RampInterval",
];
const PASS_POLICY = {
  rtSeparateBlend: false,
  fixed: {
    zClip: { val: 1, name: null }, conservative: { val: 0, name: null },
    offsetFactor: { val: 0, name: null }, offsetUnits: { val: 0, name: null },
    alphaToMask: { val: 0, name: null }, fogMode: -1, lighting: false,
  },
};

function replaceMembers(source, owner, members) {
  return source.replace(new RegExp(`${owner}\\._m(\\d+)`, "g"), (match, rawIndex) => {
    const value = members[Number(rawIndex)];
    if (value == null) throw new Error(`unmapped ${match}`);
    return value;
  });
}

function equal(actual, expected, message) {
  assert.deepEqual(actual, expected, message);
}

function interfaceRows(rows = []) {
  return rows.map(({ name, type, location }) => ({ name, type, location })).sort((a, b) => a.location - b.location);
}

function assertReflection(reflection) {
  const vertexUbo = reflection.vertex.ubos?.find((item) => item.name === "_19_21");
  equal({ name: vertexUbo?.name, size: vertexUbo?.block_size }, { name: "_19_21", size: 192 }, "vertex UBO");
  equal(interfaceRows(reflection.vertex.inputs), [
    { name: "_11", type: "vec4", location: 0 }, { name: "_100", type: "vec2", location: 1 },
    { name: "_103", type: "vec3", location: 2 },
  ], "vertex inputs");
  equal(interfaceRows(reflection.vertex.outputs), [
    { name: "vs_TEXCOORD0", type: "vec2", location: 0 }, { name: "vs_TEXCOORD1", type: "vec3", location: 1 },
    { name: "vs_TEXCOORD2", type: "vec3", location: 2 },
  ], "vertex outputs");
  const fragmentUbo = reflection.fragment.ubos?.find((item) => item.name === "_51_53");
  equal({ name: fragmentUbo?.name, size: fragmentUbo?.block_size }, { name: "_51_53", size: 140 }, "fragment UBO");
  equal(interfaceRows(reflection.fragment.inputs), [
    { name: "vs_TEXCOORD0", type: "vec2", location: 0 }, { name: "vs_TEXCOORD1", type: "vec3", location: 1 },
    { name: "vs_TEXCOORD2", type: "vec3", location: 2 },
  ], "fragment inputs");
  equal(interfaceRows(reflection.fragment.outputs), [
    { name: "_603", type: "vec4", location: 0 }, { name: "_611", type: "vec4", location: 1 },
  ], "fragment outputs");
  equal((reflection.fragment.textures || []).map(({ name, type, set, binding }) => ({ name, type, set, binding })), [
    { name: "_13", type: "sampler2D", set: 0, binding: 3 },
    { name: "_352", type: "sampler2D", set: 0, binding: 4 },
    { name: "_409", type: "sampler2D", set: 0, binding: 5 },
    { name: "_522", type: "samplerCube", set: 0, binding: 2 },
    { name: "_574", type: "sampler2D", set: 0, binding: 0 },
    { name: "_590", type: "sampler2D", set: 0, binding: 1 },
  ], "fragment samplers");
}

function adaptVertex(source) {
  let out = source.replace(/^#version 300 es\s*/m, "precision highp float;\nprecision highp int;\n\n");
  out = out.replace(/layout\(std140\) uniform _19_21[\s\S]*?}\s*_21;\s*/, [
    "uniform highp mat4 modelMatrix;", "uniform highp mat4 viewMatrix;", "uniform highp mat4 projectionMatrix;", "",
  ].join("\n"));
  out = out
    .replace("layout(location = 0) in vec4 _11;", "in vec3 position;")
    .replace("layout(location = 1) in vec2 _100;", "in vec2 uv;")
    .replace("layout(location = 2) in vec3 _103;", "in vec3 normal;")
    .replace(/void main\(\)\s*\{/, `void main()
{
    vec4 _11 = vec4(position, 1.0);
    vec2 _100 = uv;
    vec3 _103 = normal;
    mat4 _ObjectToWorld = modelMatrix;
    mat4 _WorldToObject = inverse(modelMatrix);
    mat4 _ViewProjection = projectionMatrix * viewMatrix;`);
  out = replaceMembers(out, "_21", vertexMembers);
  out = out.replace(/^\s*gl_Position\.y\s*=\s*-gl_Position\.y;\s*$/m, "");
  if (/_21\._m|gl_Position\.y\s*=\s*-gl_Position\.y/.test(out)) throw new Error("vertex adaptation incomplete");
  return `${out.trimEnd()}\n`;
}

function adaptFragment(source) {
  let out = source.replace(/^#version 300 es\s*/m, "");
  out = out.replace(/layout\(std140\) uniform _51_53[\s\S]*?}\s*_53;\s*/, [
    "uniform highp vec3 cameraPosition;", "uniform highp mat4 viewMatrix;",
    ...materialFloats.map((name) => `uniform float ${name};`),
    "uniform vec3 _Rotation;", "",
  ].join("\n"));
  out = replaceMembers(out, "_53", fragmentMembers);
  out = adaptThreeWorldVectorsToUnityDataAxes(out, {
    bindings: FRAGMENT_BASIS_CONVERSIONS.worldVectors,
  });
  out = adaptThreeViewForwardToUnityDataAxes(out, FRAGMENT_BASIS_CONVERSIONS.viewForwards[0]);
  if (/_53\._m/.test(out)) throw new Error("fragment adaptation incomplete");
  if (!/_611\s*=\s*vec4\(0\.0\)/.test(out) || /\bdiscard\b/.test(out)) throw new Error("official MRT/clip behavior changed");
  return `${out.trimEnd()}\n`;
}

await withExtractedSelectorProgram({
  selectorId: SELECTOR_ID,
  candidateWitnessId: CANDIDATE_WITNESS_ID,
  expectedProofGraphSha256: PROOF_GRAPH_SHA256,
  expectedPortIndexSha256: PORT_INDEX_SHA256,
  decryptedRoot: path.resolve(SHADER_ROOT, "..", ".."),
  prefix: "opaque_hologram_tuning",
  rootDir: ROOT,
  spirvCross: SPIRV_CROSS,
}, ({ metadata, files, reflection }) => {
  equal(metadata.selector.keywords, [], "selector keywords");
  assert.equal(metadata.parameterReflectionSha256, "2da19ead076c0612d8f6ef52f7c071c99cf11bc95766eded85c0fbf5a6ac1225");
  assert.equal(metadata.artifacts.parameterEntry.byteSize, 100);
  assertReflection(reflection);

  const officialVertex = runCommand(SPIRV_CROSS, [files.vertexSpirv, "--version", "300", "--es"], { cwd: ROOT });
  const officialFragment = runCommand(SPIRV_CROSS, [files.fragmentSpirv, "--version", "300", "--es"], { cwd: ROOT });
  assert.equal(sha256(officialVertex), OFFICIAL_CROSS_SHA256.vertex, "official vertex SPIRV-Cross changed");
  assert.equal(sha256(officialFragment), OFFICIAL_CROSS_SHA256.fragment, "official fragment SPIRV-Cross changed");
  const vertex = adaptVertex(officialVertex);
  const fragment = adaptFragment(officialFragment);
  const commonBindings = compileCommonBindings(metadata.commonBindings);
  const programBindings = compileProgramBindings(commonBindings, metadata.parameterReflection, metadata.shaderPropertyDefaults);
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
  equal(samplerBindings.map(({ slot, spirvName, binding }) => ({ slot, spirvName, binding })), [
    { slot: "_MainTex", spirvName: "_574", binding: 0 },
    { slot: "_HologramMaskTex", spirvName: "_590", binding: 1 },
    { slot: "_CubeMap", spirvName: "_522", binding: 2 },
    { slot: "_PhaseTex", spirvName: "_13", binding: 3 },
    { slot: "_RampMaskTex", spirvName: "_352", binding: 4 },
    { slot: "_RampTex", spirvName: "_409", binding: 5 },
  ], "sampler bindings");

  const runtimeContract = {
    schema: "pocket-card-render/webgl-runtime-port@1",
    shader_key: "Opaque_Hologram_Tuning",
    attributes: { position: "vec3", uv: "vec2", normal: "vec3" },
    engine_uniforms: {
      modelMatrix: "mat4",
      viewMatrix: "mat4",
      projectionMatrix: "mat4",
      cameraPosition: "vec3",
    },
    material_uniforms: { floats: materialFloats, ints: [], vectors: { _Rotation: "vec3" } },
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
      spirvCrossGlslSha256: sha256(officialVertex),
      outputSha256: sha256(vertex),
      operations: [
        { kind: "vertex-input-binding", contract: "official-bind-channels-to-three-r165" },
        { kind: "engine-uniform-binding", contract: "unity-builtins-to-three-r165" },
        {
          kind: "clip-space-y-conversion",
          from: "unity-vulkan",
          to: "webgl",
          operation: "remove-y-inversion",
        },
        { kind: "glsl-version-ownership", owner: "three-raw-shader-material" },
      ],
      substitutions: [
        "map official position/UV/normal locations to Three.js attributes",
        "unity_ObjectToWorld := three.modelMatrix and unity_WorldToObject := inverse(three.modelMatrix)",
        "unity_MatrixVP := three.projectionMatrix * three.viewMatrix",
        "remove Unity Vulkan clip-space Y inversion for WebGL clip space",
      ],
    },
    fragment: {
      officialSpirvSha256: sha256File(files.fragmentSpirv),
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
      substitutions: [
        "replace serialized PGlobals UBO members with same-name Three.js uniforms",
        "convert Three world camera, position, normal and reconstructed view-forward vectors to Unity data axes",
      ],
    },
    interfaceSha256: canonicalJsonSha256({ vertex: reflection.vertex, fragment: reflection.fragment }),
    officialVertexInputs: vertexInputContract,
    runtimeContract,
    officialProgramBindings: manifestProgramBindings,
  });
  const manifest = {
    shader: "Lettuce/Common/CardNew/ShadowBox/UI/Opaque_Hologram_Tuning",
    generated_by: "build/build-exact-opaque-hologram-tuning.mjs",
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
    official_pass_runtime: compileOfficialPassContract(metadata.passContract, {
      sourceSha256: metadata.identityFields.passStateSha256, policy: PASS_POLICY,
    }),
    official_common_bindings: { source_sha256: metadata.identityFields.commonBindingsSha256, ...commonBindings },
    official_program_bindings: manifestProgramBindings,
    official_vertex_inputs: vertexInputContract,
    official_shader_property_defaults: metadata.shaderPropertyDefaults,
    webgl_adaptation: adaptation,
    webgl_sources: {
      vertex: "public/shaders/opaque_hologram_tuning.vert.glsl",
      fragment: "public/shaders/opaque_hologram_tuning.frag.glsl",
    },
    runtime_contract: runtimeContract,
    sampler_bindings: samplerBindings,
    samplers: samplerBindings.map((row) => row.spirvName),
    sampler_slots: samplerBindings.map((row) => row.slot),
    compiled_texture_bindings: Object.fromEntries(samplerBindings.map((row) => [row.slot, row.binding])),
    implicit_defaults: metadata.shaderPropertyDefaults.textures,
    floats: Object.fromEntries(materialFloats.map((name) => [name, name])),
    colors: { _Rotation: "_Rotation" },
    mrt: { primary: "_603", emissive: "_611" },
  };
  writeOrCheckOutputs({
    "opaque_hologram_tuning.vert.glsl": vertex,
    "opaque_hologram_tuning.frag.glsl": fragment,
    "opaque_hologram_tuning_uniforms.json": `${JSON.stringify(manifest, null, 2)}\n`,
  }, { outDir: OUT, check: CHECK });
  console.log(`${CHECK ? "verified" : "generated"} Opaque_Hologram_Tuning from selector-bound official SPIR-V`);
});
