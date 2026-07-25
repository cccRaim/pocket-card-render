// Generate Card_Scaling_Kira from its exact official material selector.
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  canonicalJsonSha256,
  compileCommonBindings,
  compileOfficialPassContract,
  compileProgramBindings,
  joinProgramSamplerBindings,
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
const SELECTOR_ID = "e0627f293de1e7b45c711517b097677c54d856bd973eb457902193f502db2e9c";
const CANDIDATE_WITNESS_ID = "38f12962b40e8427d0f7f6138a2084afb4b8ecd1a80e20e7d49d6d72717f48ee";
const PROOF_GRAPH_SHA256 = "9862f63e11f359ed3b92b0191d21a2b6520de5a37159fd14612bdaf1908396b0";
const PORT_INDEX_SHA256 = "30bc4d0eab1c1ad82147e880c642cbd8fba6d55cbd2227c2aa78f082f14e7e3f";
const OFFICIAL_CROSS_SHA256 = {
  vertex: "ab106caea82476c49a6e9ab32edad3d788c75f40639d91654977251d7fd637f4",
  fragment: "11e8885c22a4706595ea8d6fbf16e10ee69dbac1722f74c2026078c7ad6f9bb3",
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
  assert.deepEqual(actual, expected, message);
}

function interfaceRows(rows = []) {
  return rows.map(({ name, type, location }) => ({ name, type, location }))
    .sort((left, right) => left.location - right.location);
}

function assertReflection(reflection) {
  const vertexUbo = reflection.vertex.ubos?.find((item) => item.name === "_19_21");
  const fragmentUbo = reflection.fragment.ubos?.find((item) => item.name === "_10_12");
  equal({ name: vertexUbo?.name, size: vertexUbo?.block_size }, { name: "_19_21", size: 144 }, "vertex UBO");
  equal({ name: fragmentUbo?.name, size: fragmentUbo?.block_size }, { name: "_10_12", size: 8 }, "fragment UBO");
  equal(interfaceRows(reflection.vertex.inputs), [
    { name: "_11", type: "vec4", location: 0 },
    { name: "_95", type: "vec2", location: 1 },
  ], "vertex inputs");
  equal(interfaceRows(reflection.vertex.outputs), [
    { name: "vs_TEXCOORD0", type: "vec2", location: 0 },
    { name: "vs_TEXCOORD1", type: "float", location: 1 },
  ], "vertex outputs");
  equal(interfaceRows(reflection.fragment.inputs), [
    { name: "vs_TEXCOORD0", type: "vec2", location: 0 },
    { name: "vs_TEXCOORD1", type: "float", location: 1 },
  ], "fragment inputs");
  equal(interfaceRows(reflection.fragment.outputs), [
    { name: "_98", type: "vec4", location: 0 },
    { name: "_101", type: "vec4", location: 1 },
  ], "fragment outputs");
  equal((reflection.fragment.textures || [])
    .map(({ name, type, set, binding }) => ({ name, type, set, binding }))
    .sort((left, right) => left.binding - right.binding), [
    { name: "_48", type: "sampler2D", set: 0, binding: 0 },
    { name: "_85", type: "sampler2D", set: 0, binding: 1 },
    { name: "_39", type: "sampler2D", set: 0, binding: 2 },
  ], "fragment samplers");
}

function adaptVertex(source) {
  let output = source.replace(/^#version 300 es\s*/m, "precision highp float;\nprecision highp int;\n\n");
  output = output.replace(/layout\(std140\) uniform _19_21[\s\S]*?}\s*_21;\s*/, [
    "uniform highp mat4 modelMatrix;",
    "uniform highp mat4 viewMatrix;",
    "uniform highp mat4 projectionMatrix;",
    "uniform float _RampRotation;",
    "uniform float _RampRepeat;",
    "uniform float _ScrollOffset;",
    "uniform float _KiraScale;",
    "",
  ].join("\n"));
  output = output
    .replace("layout(location = 0) in vec4 _11;", "in vec3 position;")
    .replace("layout(location = 1) in vec2 _95;", "in vec2 uv;")
    .replace(/void main\(\)\s*\{/, `void main()
{
    vec4 _11 = vec4(position, 1.0);
    vec2 _95 = uv;
    mat4 _ObjectToWorld = modelMatrix;
    mat4 _ViewProjection = projectionMatrix * viewMatrix;`)
    .replaceAll("_21._m0", "_ObjectToWorld")
    .replaceAll("_21._m1", "_ViewProjection")
    .replaceAll("_21._m2", "_RampRotation")
    .replaceAll("_21._m3", "_RampRepeat")
    .replaceAll("_21._m4", "_ScrollOffset")
    .replaceAll("_21._m5", "_KiraScale")
    .replace(/^\s*gl_Position\.y\s*=\s*-gl_Position\.y;\s*$/m, "");
  if (/_21\._m|gl_Position\.y\s*=\s*-gl_Position\.y/.test(output)) {
    throw new Error("Card_Scaling_Kira vertex adaptation is incomplete");
  }
  return `${output.trimEnd()}\n`;
}

function adaptFragment(source) {
  let output = source.replace(/^#version 300 es\s*/m, "");
  output = output.replace(/layout\(std140\) uniform _10_12[\s\S]*?}\s*_12;\s*/, [
    "uniform float _ScrollScale;",
    "uniform float _Anim;",
    "",
  ].join("\n"));
  output = output
    .replaceAll("_12._m0", "_ScrollScale")
    .replaceAll("_12._m1", "_Anim");
  if (/_12\._m/.test(output)) throw new Error("Card_Scaling_Kira fragment adaptation is incomplete");
  return `${output.trimEnd()}\n`;
}

await withExtractedSelectorProgram({
  selectorId: SELECTOR_ID,
  candidateWitnessId: CANDIDATE_WITNESS_ID,
  expectedProofGraphSha256: PROOF_GRAPH_SHA256,
  expectedPortIndexSha256: PORT_INDEX_SHA256,
  decryptedRoot: path.resolve(SHADER_ROOT, "..", ".."),
  prefix: "card_scaling_kira",
  rootDir: ROOT,
  spirvCross: SPIRV_CROSS,
}, ({ metadata, files, reflection }) => {
  equal(metadata.selector.keywords, [], "selector keywords");
  assert.equal(metadata.parameterReflectionSha256, "f7b7a44245bfb8b35227d95de38061082b4b5357cb2fc67c20bd55711adc5dfa");
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
  const samplerBindings = joinProgramSamplerBindings(programBindings, reflection).map(({ set, ...row }) => {
    assert.equal(set, 0, "WebGL sampler port requires descriptor set 0");
    return row;
  });
  equal(samplerBindings.map(({ slot, spirvName, binding }) => ({ slot, spirvName, binding })), [
    { slot: "_BaseTex", spirvName: "_48", binding: 0 },
    { slot: "_ScrollLayerMask", spirvName: "_85", binding: 1 },
    { slot: "_RampTex", spirvName: "_39", binding: 2 },
  ], "sampler bindings");

  const adaptation = {
    schema: "pocket-card-render/webgl-stage-adaptation@1",
    backend: "Unity Vulkan SPIR-V to Three.js WebGL2",
    vertex: {
      officialSpirvSha256: sha256File(files.vertexSpirv),
      spirvCrossGlslSha256: sha256(officialVertex),
      outputSha256: sha256(vertex),
      substitutions: [
        "map official position/UV0 locations to Three.js attributes",
        "unity_ObjectToWorld := three.modelMatrix and unity_MatrixVP := three.projectionMatrix * three.viewMatrix",
        "expand renderer MPB values into named uniforms without changing shader arithmetic",
        "remove Unity Vulkan clip-space Y inversion for WebGL clip space",
      ],
    },
    fragment: {
      officialSpirvSha256: sha256File(files.fragmentSpirv),
      spirvCrossGlslSha256: sha256(officialFragment),
      outputSha256: sha256(fragment),
      substitutions: [
        "expand renderer MPB values into named uniforms without changing shader arithmetic",
        "remove the embedded GLSL version directive for Three.js RawShaderMaterial injection",
      ],
    },
    interfaceSha256: canonicalJsonSha256({ vertex: reflection.vertex, fragment: reflection.fragment }),
  };
  const manifest = {
    shader: "Lettuce/Common/CardNew/Face/Card_Scaling_Kira",
    generated_by: "build/build-exact-card-scaling-kira.mjs",
    selected_keywords: [],
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
      policy: PASS_POLICY,
    }),
    official_common_bindings: { source_sha256: metadata.identityFields.commonBindingsSha256, ...commonBindings },
    official_program_bindings: {
      common_source_sha256: metadata.identityFields.commonBindingsSha256,
      parameter_reflection_sha256: metadata.parameterReflectionSha256,
      ...programBindings,
    },
    official_shader_property_defaults: metadata.shaderPropertyDefaults,
    webgl_adaptation: adaptation,
    webgl_sources: {
      vertex: "public/shaders/card_scaling_kira.vert.glsl",
      fragment: "public/shaders/card_scaling_kira.frag.glsl",
    },
    runtime_contract: {
      schema: "pocket-card-render/webgl-runtime-port@1",
      shader_key: "Card_Scaling_Kira",
      attributes: { position: "vec3", uv: "vec2" },
      engine_uniforms: { modelMatrix: "mat4", viewMatrix: "mat4", projectionMatrix: "mat4" },
      material_uniforms: { floats: ["_RampRotation"], ints: [], vectors: {} },
      renderer_uniforms: {
        floats: ["_RampRepeat", "_ScrollScale", "_ScrollOffset", "_KiraScale", "_Anim"],
        source: "KiraPuyoObject MaterialPropertyBlock",
      },
      require_complete_active_bindings: true,
      camera_from_view: false,
      mrt_attachments: 2,
      stencil_face_mode: "generic",
    },
    sampler_bindings: samplerBindings,
    samplers: samplerBindings.map((row) => row.spirvName),
    sampler_slots: samplerBindings.map((row) => row.slot),
    compiled_texture_bindings: Object.fromEntries(samplerBindings.map((row) => [row.slot, row.binding])),
    implicit_defaults: metadata.shaderPropertyDefaults.textures,
    floats: {
      _RampRotation: "_RampRotation", _RampRepeat: "_RampRepeat", _ScrollScale: "_ScrollScale",
      _ScrollOffset: "_ScrollOffset", _KiraScale: "_KiraScale", _Anim: "_Anim",
    },
    mrt: { primary: "_98", emissive: "_101" },
  };
  writeOrCheckOutputs({
    "card_scaling_kira.vert.glsl": vertex,
    "card_scaling_kira.frag.glsl": fragment,
    "card_scaling_kira_uniforms.json": `${JSON.stringify(manifest, null, 2)}\n`,
  }, { outDir: OUT, check: CHECK });
  console.log(`${CHECK ? "verified" : "generated"} Card_Scaling_Kira from selector-bound official SPIR-V`);
});
