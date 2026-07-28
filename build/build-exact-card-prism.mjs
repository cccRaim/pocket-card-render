// Generate Card_Prism from its exact official material selector.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  canonicalJsonSha256,
  compileCommonBindings,
  compileOfficialVertexInputContract,
  compileOfficialPassContract,
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
const GLSLANG = process.env.GLSLANG_VALIDATOR || "glslangValidator";
const OUT = path.join(ROOT, "public", "shaders");
const CHECK = process.argv.includes("--check") || process.env.PCR_EXACT_CHECK === "1";
const SELECTOR_ID = "a01892fdbd252e9cdc56213dda6655a9b10269c11fc68e2fefd5ae179be5f018";
const CANDIDATE_WITNESS_ID = "3101394a11fce8f689324ae82849ef917392a8734af7f80226de74dd309dcf45";
const PROOF_GRAPH_SHA256 = "307ed3660e5d3b1bfd8cf9e6b3d64e44937af215da3b6ed84ead198800eeadc4";
const PORT_INDEX_SHA256 = "15095f34b9e75515bbcc3924f6f8b2abb826ba96b48e819ec911486bcfa6f5a9";
const OFFICIAL_CROSS_SHA256 = {
  vertex: "30db9c072c19012c73736e8c0a9c1b98a6dc3a993e0ceffdb0e509f5b97f221b",
  fragment: "a01f3ac6df367ac3f51b562b1dbe3c1f3a2addd42a3e9a80f827c9d68f22bfe9",
};
const PASS_POLICY = {
  rtSeparateBlend: false,
  fixed: {
    zClip: { val: 1, name: null }, conservative: { val: 0, name: null },
    offsetFactor: { val: 0, name: null }, offsetUnits: { val: 0, name: null },
    alphaToMask: { val: 0, name: null }, fogMode: -1, lighting: false,
  },
};

const MATERIAL_FLOATS = [
  "_ExpandScale", "_ExpandTiming", "_ExpandAlphaPower", "_CenterMoveIntensity",
  "_RotateSpeed", "_ShiftTiming", "_ColorIntensity", "_AdjustAlphaIntensity",
  "_ShiftU", "_ShiftV", "_ShiftUOffsetIntensity", "_ShiftVOffsetIntensity",
  "_EmissiveIntensity",
];
const MATERIAL_INTS = [
  "_UseRotate", "_ColoringMethod", "_ShiftUOffsetByTilt", "_ShiftVOffsetByTilt",
  "_OkLabBlend",
];

function equal(actual, expected, message) {
  assert.deepEqual(actual, expected, message);
}

function interfaceRows(rows = []) {
  return rows.map(({ name, type, location }) => ({ name, type, location }))
    .sort((left, right) => left.location - right.location);
}

function assertReflection(reflection) {
  const vertexUbo = reflection.vertex.ubos?.find((item) => item.name === "_15_17");
  const fragmentUbo = reflection.fragment.ubos?.find((item) => item.name === "_11_13");
  equal({ name: vertexUbo?.name, size: vertexUbo?.block_size }, { name: "_15_17", size: 172 }, "vertex UBO");
  equal({ name: fragmentUbo?.name, size: fragmentUbo?.block_size }, { name: "_11_13", size: 44 }, "fragment UBO");
  equal(interfaceRows(reflection.vertex.inputs), [
    { name: "_302", type: "vec4", location: 0 },
    { name: "_422", type: "vec2", location: 1 },
    { name: "_248", type: "vec2", location: 2 },
  ], "vertex inputs");
  equal(interfaceRows(reflection.vertex.outputs), [
    { name: "vs_TEXCOORD0", type: "vec2", location: 0 },
    { name: "vs_TEXCOORD1", type: "vec4", location: 1 },
  ], "vertex outputs");
  equal(interfaceRows(reflection.fragment.inputs), [
    { name: "vs_TEXCOORD0", type: "vec2", location: 0 },
    { name: "vs_TEXCOORD1", type: "vec4", location: 1 },
  ], "fragment inputs");
  equal(interfaceRows(reflection.fragment.outputs), [
    { name: "_349", type: "vec4", location: 0 },
    { name: "_361", type: "vec4", location: 1 },
  ], "fragment outputs");
  equal((reflection.fragment.textures || []).map(({ name, type, set, binding }) => ({ name, type, set, binding })), [
    { name: "_29", type: "sampler2D", set: 0, binding: 0 },
  ], "fragment samplers");
}

function adaptVertex(source) {
  let output = source.replace(/^#version 300 es\s*/m, "precision highp float;\nprecision highp int;\n\n");
  output = output.replace(/layout\(std140\) uniform _15_17[\s\S]*?}\s*_17;\s*/, [
    "uniform highp mat4 modelMatrix;",
    "uniform highp mat4 viewMatrix;",
    "uniform highp mat4 projectionMatrix;",
    "uniform float uTime;",
    ...MATERIAL_FLOATS.slice(0, 6).map((name) => `uniform float ${name};`),
    "uniform int _UseRotate;",
    "",
  ].join("\n"));
  output = output
    .replace("layout(location = 0) in vec4 _302;", "in vec3 position;")
    .replace("layout(location = 1) in vec2 _422;", "in vec2 uv;")
    .replace("layout(location = 2) in vec2 _248;", "in vec2 uv1;")
    .replace(/void main\(\)\s*\{/, `void main()
{
    vec4 _302 = vec4(position, 1.0);
    vec2 _422 = uv;
    vec2 _248 = uv1;
    mat4 _ObjectToWorld = modelMatrix;
    mat4 _ViewProjection = projectionMatrix * viewMatrix;`)
    .replaceAll("_17._m0.x", "(uTime * 0.05)")
    .replaceAll("_17._m1", "_ObjectToWorld")
    .replaceAll("_17._m2", "_ViewProjection")
    .replaceAll("_17._m3", "_ExpandScale")
    .replaceAll("_17._m4", "_ExpandTiming")
    .replaceAll("_17._m5", "_ExpandAlphaPower")
    .replaceAll("_17._m6", "_CenterMoveIntensity")
    .replaceAll("_17._m7", "_UseRotate")
    .replaceAll("_17._m8", "_RotateSpeed")
    .replaceAll("_17._m9", "_ShiftTiming")
    .replace(/^\s*gl_Position\.y\s*=\s*-gl_Position\.y;\s*$/m, "");
  if (/_17\._m|gl_Position\.y\s*=\s*-gl_Position\.y/.test(output)) {
    throw new Error("Card_Prism vertex adaptation is incomplete");
  }
  return `${output.trimEnd()}\n`;
}

function adaptFragment(source) {
  let output = source.replace(/^#version 300 es\s*/m, "");
  const fields = [
    "_ColorIntensity", "_AdjustAlphaIntensity", "_ColoringMethod", "_ShiftU", "_ShiftV",
    "_ShiftUOffsetByTilt", "_ShiftUOffsetIntensity", "_ShiftVOffsetByTilt",
    "_ShiftVOffsetIntensity", "_OkLabBlend", "_EmissiveIntensity",
  ];
  output = output.replace(/layout\(std140\) uniform _11_13[\s\S]*?}\s*_13;\s*/, `${fields.map((name) =>
    `uniform ${MATERIAL_INTS.includes(name) ? "int" : "float"} ${name};`).join("\n")}\n\n`);
  for (const [index, name] of [...fields.entries()].reverse()) {
    output = output.replaceAll(`_13._m${index}`, name);
  }
  if (/_13\._m/.test(output)) throw new Error("Card_Prism fragment adaptation is incomplete");
  return `${output.trimEnd()}\n`;
}

function validateWebGlStage(source, stage) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "pcr-prism-glsl-"));
  const file = path.join(temp, `card_prism.${stage}`);
  try {
    fs.writeFileSync(file, `#version 300 es\n${source}`);
    runCommand(GLSLANG, ["-S", stage, file], { cwd: ROOT });
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

await withExtractedSelectorProgram({
  selectorId: SELECTOR_ID,
  candidateWitnessId: CANDIDATE_WITNESS_ID,
  expectedProofGraphSha256: PROOF_GRAPH_SHA256,
  expectedPortIndexSha256: PORT_INDEX_SHA256,
  decryptedRoot: path.resolve(SHADER_ROOT, "..", ".."),
  prefix: "card_prism",
  rootDir: ROOT,
  spirvCross: SPIRV_CROSS,
}, ({ metadata, files, reflection }) => {
  equal(metadata.selector.keywords, [], "selector keywords");
  assert.equal(metadata.selector.semanticExecutableId, "4744aedcc82468546da50873b996c5c7e1cb8596a1e07624b6d2d9abcdf4f473");
  assert.equal(metadata.parameterReflectionSha256, "795f9c5cbccb96df3029f9007dadc7bc88e52e5fe0a175653be1a2cd701a2eb5");
  assert.equal(metadata.artifacts.parameterEntry.byteSize, 100);
  assertReflection(reflection);

  const officialVertex = runCommand(SPIRV_CROSS, [files.vertexSpirv, "--version", "300", "--es"], { cwd: ROOT });
  const officialFragment = runCommand(SPIRV_CROSS, [files.fragmentSpirv, "--version", "300", "--es"], { cwd: ROOT });
  assert.equal(sha256(officialVertex), OFFICIAL_CROSS_SHA256.vertex, "official vertex SPIRV-Cross changed");
  assert.equal(sha256(officialFragment), OFFICIAL_CROSS_SHA256.fragment, "official fragment SPIRV-Cross changed");
  const vertex = adaptVertex(officialVertex);
  const fragment = adaptFragment(officialFragment);
  validateWebGlStage(vertex, "vert");
  validateWebGlStage(fragment, "frag");

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
    { slot: "_BaseTex", spirvName: "_29", binding: 0 },
  ], "sampler bindings");

  const runtimeContract = {
    schema: "pocket-card-render/webgl-runtime-port@1",
    shader_key: "Card_Prism",
    attributes: { position: "vec3", uv: "vec2", uv1: "vec2" },
    engine_uniforms: { modelMatrix: "mat4", viewMatrix: "mat4", projectionMatrix: "mat4" },
    material_uniforms: { floats: MATERIAL_FLOATS, ints: MATERIAL_INTS, vectors: {} },
    dynamic_uniforms: { uTime: { type: "float", source: "official-clock" } },
    require_complete_active_bindings: true,
    camera_from_view: false,
    mrt_attachments: 2,
    stencil_normalization: "none",
    stencil_face_mode: "generic",
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
        { kind: "official-clock-binding", contract: "official-clock-to-unity-time" },
        {
          kind: "clip-space-y-conversion",
          from: "unity-vulkan",
          to: "webgl",
          operation: "remove-y-inversion",
        },
        { kind: "glsl-version-ownership", owner: "three-raw-shader-material" },
      ],
      substitutions: [
        "map official position/UV0/UV1 locations to Three.js position/uv/uv1 attributes",
        "unity_ObjectToWorld := three.modelMatrix and unity_MatrixVP := three.projectionMatrix * three.viewMatrix",
        "Unity _Time.x := OfficialClock global time * the pinned 0.05 engine factor",
        "expand serialized common-buffer values into same-name material uniforms without changing arithmetic",
        "remove Unity Vulkan clip-space Y inversion for WebGL clip space",
      ],
    },
    fragment: {
      officialSpirvSha256: sha256File(files.fragmentSpirv),
      spirvCrossGlslSha256: sha256(officialFragment),
      outputSha256: sha256(fragment),
      operations: [
        {
          kind: "uniform-buffer-flattening",
          source: "serialized-common",
          preservation: "names-types-precision",
        },
        { kind: "glsl-version-ownership", owner: "three-raw-shader-material" },
      ],
      substitutions: ["expand serialized common-buffer values into same-name material uniforms without changing arithmetic"],
    },
    interfaceSha256: canonicalJsonSha256({ vertex: reflection.vertex, fragment: reflection.fragment }),
    officialVertexInputs: vertexInputContract,
    runtimeContract,
    officialProgramBindings: manifestProgramBindings,
  });
  const manifest = {
    shader: "Lettuce/Common/CardNew/Face/Card_Prism",
    generated_by: "build/build-exact-card-prism.mjs",
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
      vertex: "public/shaders/card_prism.vert.glsl",
      fragment: "public/shaders/card_prism.frag.glsl",
    },
    runtime_contract: runtimeContract,
    sampler_bindings: samplerBindings,
    samplers: samplerBindings.map((row) => row.spirvName),
    sampler_slots: samplerBindings.map((row) => row.slot),
    compiled_texture_bindings: Object.fromEntries(samplerBindings.map((row) => [row.slot, row.binding])),
    implicit_defaults: metadata.shaderPropertyDefaults.textures,
    floats: Object.fromEntries([...MATERIAL_FLOATS, ...MATERIAL_INTS].map((name) => [name, name])),
    mrt: { primary: "_349", emissive: "_361", secondary_rgb: "active" },
  };
  writeOrCheckOutputs({
    "card_prism.vert.glsl": vertex,
    "card_prism.frag.glsl": fragment,
    "card_prism_uniforms.json": `${JSON.stringify(manifest, null, 2)}\n`,
  }, { outDir: OUT, check: CHECK });
  console.log(`${CHECK ? "verified" : "generated"} Card_Prism from selector-bound official SPIR-V`);
});
