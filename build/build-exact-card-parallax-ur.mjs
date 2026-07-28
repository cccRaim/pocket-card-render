#!/usr/bin/env node
// Generate Card_Parallax_UR from its exact official material selector.
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
const SELECTOR_ID = "7dd368f662278328017cedf6f7dd2845e729a52df5f71468d42646a045bb6d4a";
const CANDIDATE_WITNESS_ID = "fa18a0f97c8bc9e4a3dd08cd7de9e493d66e896c27ec1901544ab2aa318e1d82";
const PROOF_GRAPH_SHA256 = "307ed3660e5d3b1bfd8cf9e6b3d64e44937af215da3b6ed84ead198800eeadc4";
const PORT_INDEX_SHA256 = "15095f34b9e75515bbcc3924f6f8b2abb826ba96b48e819ec911486bcfa6f5a9";
const OFFICIAL_CROSS_SHA256 = {
  vertex: "21ae9a615c123dfb6f3406406bb6858c1a6c7a7a3243586f809635e53c98db54",
  fragment: "f704ce327e923e2a0d51b33492d029b4c910b4a9e8b30765298d622a18232c4b",
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

function rows(items = []) {
  return items.map(({ name, type, location }) => ({ name, type, location }))
    .sort((left, right) => left.location - right.location);
}

function assertReflection(reflection) {
  const vertexUbo = reflection.vertex.ubos?.find((item) => item.name === "_20_22");
  assert.deepEqual({ name: vertexUbo?.name, size: vertexUbo?.block_size }, { name: "_20_22", size: 224 });
  assert.deepEqual(rows(reflection.vertex.inputs), [
    { name: "_11", type: "vec4", location: 0 },
    { name: "_86", type: "vec3", location: 1 },
    { name: "_296", type: "vec2", location: 2 },
    { name: "_106", type: "vec4", location: 3 },
  ]);
  assert.deepEqual(rows(reflection.vertex.outputs), [{ name: "vs_TEXCOORD0", type: "vec2", location: 0 }]);
  assert.deepEqual(rows(reflection.fragment.inputs), [{ name: "vs_TEXCOORD0", type: "vec2", location: 0 }]);
  assert.deepEqual(rows(reflection.fragment.outputs), [
    { name: "_267", type: "vec4", location: 0 },
    { name: "_276", type: "vec4", location: 1 },
  ]);
  assert.deepEqual((reflection.fragment.textures || [])
    .map(({ name, type, set, binding }) => ({ name, type, set, binding })), [
    { name: "_242", type: "sampler2D", set: 0, binding: 0 },
  ]);
}

function adaptVertex(source) {
  let output = source.replace(/^#version 300 es\s*/m, "precision highp float;\nprecision highp int;\n\n");
  output = output.replace(/layout\(std140\) uniform _20_22[\s\S]*?}\s*_22;\s*/, [
    "uniform highp mat4 modelMatrix;",
    "uniform highp mat4 viewMatrix;",
    "uniform highp mat4 projectionMatrix;",
    "uniform highp vec3 cameraPosition;",
    "uniform highp float _FakeCameraHeight;",
    "uniform highp float _Height;",
    "uniform highp float _HeightPower;",
    "uniform highp float _Scale;",
    "",
  ].join("\n"));
  output = output
    .replace("layout(location = 0) in vec4 _11;", "in vec3 position;")
    .replace("layout(location = 1) in vec3 _86;", "in vec3 normal;")
    .replace("layout(location = 3) in mediump vec4 _106;", "in vec4 tangent;")
    .replace("layout(location = 2) in vec2 _296;", "in vec2 uv;")
    .replace(/void main\(\)\s*\{/, `void main()
{
    vec4 _11 = vec4(position, 1.0);
    vec3 _86 = normal;
    vec4 _106 = tangent;
    vec2 _296 = uv;
    mat4 _ObjectToWorld = modelMatrix;
    mat4 _WorldToObject = inverse(modelMatrix);
    mat4 _ViewProjection = projectionMatrix * viewMatrix;`)
    .replaceAll("_22._m0", "cameraPosition")
    .replaceAll("_22._m1", "_ObjectToWorld")
    .replaceAll("_22._m2", "_WorldToObject")
    .replaceAll("_22._m3", "_ViewProjection")
    .replaceAll("_22._m4", "_FakeCameraHeight")
    .replaceAll("_22._m5", "_Height")
    .replaceAll("_22._m6", "_HeightPower")
    .replaceAll("_22._m7", "_Scale")
    .replace(/^\s*gl_Position\.y\s*=\s*-gl_Position\.y;\s*$/m, "");
  if (/_22\._m|uniform _20_22|gl_Position\.y\s*=\s*-gl_Position\.y/.test(output)) {
    throw new Error("Card_Parallax_UR vertex adaptation is incomplete");
  }
  return `${output.trimEnd()}\n`;
}

function adaptFragment(source) {
  let output = source.replace(/^#version 300 es\s*/m, "");
  output = output.replace(/layout\(std140\) uniform _14_16[\s\S]*?}\s*_16;\s*/, [
    "uniform highp mat4 modelMatrix;",
    "uniform highp vec3 _DarknessColor;",
    "uniform highp float _DarknessOffset;",
    "",
  ].join("\n"));
  output = output
    .replaceAll("_16._m0", "modelMatrix")
    .replaceAll("_16._m1", "_DarknessColor")
    .replaceAll("_16._m2", "_DarknessOffset");
  output = adaptUnityObjectToWorldDataAxes(output, {
    matrixName: "modelMatrix", expectedCounts: { 2: 3 },
  });
  if (/_16\._m|uniform _14_16/.test(output)) {
    throw new Error("Card_Parallax_UR fragment adaptation is incomplete");
  }
  return `${output.trimEnd()}\n`;
}

await withExtractedSelectorProgram({
  selectorId: SELECTOR_ID,
  candidateWitnessId: CANDIDATE_WITNESS_ID,
  expectedProofGraphSha256: PROOF_GRAPH_SHA256,
  expectedPortIndexSha256: PORT_INDEX_SHA256,
  decryptedRoot: path.resolve(SHADER_ROOT, "..", ".."),
  prefix: "card-parallax-ur",
  rootDir: ROOT,
  spirvCross: SPIRV_CROSS,
}, ({ metadata, files, reflection }) => {
  assert.deepEqual(metadata.selector.keywords, []);
  assert.equal(metadata.selector.selectionMode, "unique-exact-keywords");
  assert.equal(metadata.selector.semanticExecutableId, "615c80b3c3c1ff79b8f94eae84fa47f4b23ad4bcba1670bba7ddcf00f663033e");
  assert.equal(metadata.parameterReflectionSha256, "a56e207f3de91b05cefac49501a7fb5ee2e1ffa3aced3fc78cc42b685d1020e5");
  assert.equal(metadata.artifacts.parameterEntry.byteSize, 100);
  assertReflection(reflection);

  const officialVertex = runCommand(SPIRV_CROSS, [files.vertexSpirv, "--version", "300", "--es"], { cwd: ROOT });
  const officialFragment = runCommand(SPIRV_CROSS, [files.fragmentSpirv, "--version", "300", "--es"], { cwd: ROOT });
  assert.equal(sha256(officialVertex), OFFICIAL_CROSS_SHA256.vertex);
  assert.equal(sha256(officialFragment), OFFICIAL_CROSS_SHA256.fragment);
  const vertex = adaptVertex(officialVertex);
  const fragment = adaptFragment(officialFragment);
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
    assert.equal(set, 0, "Card_Parallax_UR sampler must use descriptor set 0");
    return row;
  });
  assert.deepEqual(samplerBindings.map(({ slot, spirvName, binding }) => ({ slot, spirvName, binding })), [
    { slot: "_MainTex", spirvName: "_242", binding: 0 },
  ]);

  const runtimeContract = {
    schema: "pocket-card-render/webgl-runtime-port@1",
    shader_key: "Card_Parallax_UR",
    attributes: { position: "vec3", normal: "vec3", tangent: "vec4", uv: "vec2" },
    engine_uniforms: {
      modelMatrix: "mat4", viewMatrix: "mat4", projectionMatrix: "mat4", cameraPosition: "vec3",
    },
    material_uniforms: {
      floats: ["_FakeCameraHeight", "_Height", "_HeightPower", "_Scale", "_DarknessOffset"],
      ints: [],
      vectors: { _DarknessColor: "vec3" },
    },
    require_complete_active_bindings: true,
    camera_from_view: true,
    mrt_attachments: 2,
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
    },
    interfaceSha256: canonicalJsonSha256({ vertex: reflection.vertex, fragment: reflection.fragment }),
    officialVertexInputs: vertexInputContract,
    runtimeContract,
    officialProgramBindings: manifestProgramBindings,
  });
  const manifest = {
    shader: "Lettuce/Common/CardNew/Face/Card_Parallax_UR",
    generated_by: "build/build-exact-card-parallax-ur.mjs",
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
      sourceSha256: metadata.identityFields.passStateSha256,
      policy: PASS_POLICY,
    }),
    official_common_bindings: { source_sha256: metadata.identityFields.commonBindingsSha256, ...commonBindings },
    official_program_bindings: manifestProgramBindings,
    official_vertex_inputs: vertexInputContract,
    official_shader_property_defaults: metadata.shaderPropertyDefaults,
    webgl_adaptation: adaptation,
    webgl_sources: {
      vertex: "public/shaders/parallax_ur.vert.glsl",
      fragment: "public/shaders/parallax_ur.frag.glsl",
    },
    runtime_contract: runtimeContract,
    sampler_bindings: samplerBindings,
    samplers: samplerBindings.map((row) => row.spirvName),
    sampler_slots: samplerBindings.map((row) => row.slot),
    compiled_texture_bindings: Object.fromEntries(samplerBindings.map((row) => [row.slot, row.binding])),
    implicit_defaults: metadata.shaderPropertyDefaults.textures,
    floats: {
      _FakeCameraHeight: "_FakeCameraHeight", _Height: "_Height", _HeightPower: "_HeightPower",
      _Scale: "_Scale", _DarknessOffset: "_DarknessOffset",
    },
    colors: { _DarknessColor: "_DarknessColor" },
    mrt: { primary: "_267", emissive: "_276" },
  };
  writeOrCheckOutputs({
    "parallax_ur.vert.glsl": vertex,
    "parallax_ur.frag.glsl": fragment,
    "parallax_ur_uniforms.json": `${JSON.stringify(manifest, null, 2)}\n`,
  }, { outDir: OUT, check: CHECK });
  console.log(`${CHECK ? "verified" : "generated"} Card_Parallax_UR from selector-bound official SPIR-V`);
});
