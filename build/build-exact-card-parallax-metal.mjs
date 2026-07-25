#!/usr/bin/env node
// Generate Card_Parallax_Metal from its exact official material selector.
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
const SELECTOR_ID = "544f051f64a5292f13cef7ef205e59652f7884369fe33ea752e2bd6999ea56d0";
const CANDIDATE_WITNESS_ID = "723f76de6fb22268408a97849213a3bb510424a8a21084ab651cf45baeab7811";
const PROOF_GRAPH_SHA256 = "9862f63e11f359ed3b92b0191d21a2b6520de5a37159fd14612bdaf1908396b0";
const PORT_INDEX_SHA256 = "30bc4d0eab1c1ad82147e880c642cbd8fba6d55cbd2227c2aa78f082f14e7e3f";
const OFFICIAL_CROSS_SHA256 = {
  vertex: "ed820f58941cced165171a1bfc35e0f5b0769f355dca240eaf58f96d67fcc36d",
  fragment: "6b5fde6ef34c843a4421029cfbd023a5949ad14b83dac3327b67194d51a8983e",
};
const PASS_POLICY = {
  rtSeparateBlend: false,
  fixed: {
    zClip: { val: 1, name: null }, conservative: { val: 0, name: null },
    offsetFactor: { val: 0, name: null }, offsetUnits: { val: 0, name: null },
    alphaToMask: { val: 0, name: null }, fogMode: -1, lighting: false,
  },
};

function rows(items = []) {
  return items.map(({ name, type, location }) => ({ name, type, location }))
    .sort((left, right) => left.location - right.location);
}

function assertReflection(reflection) {
  const vertexUbo = reflection.vertex.ubos?.find((item) => item.name === "_21_23");
  assert.deepEqual({ name: vertexUbo?.name, size: vertexUbo?.block_size }, { name: "_21_23", size: 228 });
  assert.deepEqual(rows(reflection.vertex.inputs), [
    { name: "_11", type: "vec4", location: 0 },
    { name: "_97", type: "vec3", location: 1 },
    { name: "_313", type: "vec2", location: 2 },
    { name: "_316", type: "vec2", location: 3 },
    { name: "_117", type: "vec4", location: 4 },
  ]);
  assert.deepEqual(rows(reflection.vertex.outputs), [
    { name: "vs_TEXCOORD0", type: "vec2", location: 0 },
    { name: "vs_TEXCOORD1", type: "vec3", location: 1 },
    { name: "vs_TEXCOORD2", type: "vec3", location: 2 },
  ]);
  assert.deepEqual(rows(reflection.fragment.inputs), [
    { name: "vs_TEXCOORD0", type: "vec2", location: 0 },
    { name: "vs_TEXCOORD1", type: "vec3", location: 1 },
    { name: "vs_TEXCOORD2", type: "vec3", location: 2 },
  ]);
  assert.deepEqual(rows(reflection.fragment.outputs), [
    { name: "_299", type: "vec4", location: 0 },
    { name: "_305", type: "vec4", location: 1 },
  ]);
  assert.deepEqual((reflection.fragment.textures || [])
    .map(({ name, type, set, binding }) => ({ name, type, set, binding })), [
    { name: "_238", type: "samplerCube", set: 0, binding: 0 },
    { name: "_277", type: "sampler2D", set: 0, binding: 1 },
  ]);
}

function adaptVertex(source) {
  let output = source.replace(/^#version 300 es\s*/m, "precision highp float;\nprecision highp int;\n\n");
  output = output.replace(/layout\(std140\) uniform _21_23[\s\S]*?}\s*_23;\s*/, [
    "uniform highp mat4 modelMatrix;",
    "uniform highp mat4 viewMatrix;",
    "uniform highp mat4 projectionMatrix;",
    "uniform highp vec3 cameraPosition;",
    "uniform highp float _FakeCameraHeight;",
    "uniform highp float _Height;",
    "uniform highp float _HeightPower;",
    "uniform highp float _Scale;",
    "uniform int _UseUv;",
    "",
  ].join("\n"));
  output = output
    .replace("layout(location = 0) in vec4 _11;", "in vec3 position;")
    .replace("layout(location = 1) in vec3 _97;", "in vec3 normal;")
    .replace("layout(location = 4) in mediump vec4 _117;", "in vec4 tangent;")
    .replace("layout(location = 2) in vec2 _313;", "in vec2 uv;")
    .replace("layout(location = 3) in vec2 _316;", "in vec2 uv1;")
    .replace(/void main\(\)\s*\{/, `void main()
{
    vec4 _11 = vec4(position, 1.0);
    vec3 _97 = normal;
    vec4 _117 = tangent;
    vec2 _313 = uv;
    vec2 _316 = uv1;
    mat4 _ObjectToWorld = modelMatrix;
    mat4 _WorldToObject = inverse(modelMatrix);
    mat4 _ViewProjection = projectionMatrix * viewMatrix;`)
    .replaceAll("_23._m0", "cameraPosition")
    .replaceAll("_23._m1", "_ObjectToWorld")
    .replaceAll("_23._m2", "_WorldToObject")
    .replaceAll("_23._m3", "_ViewProjection")
    .replaceAll("_23._m4", "_FakeCameraHeight")
    .replaceAll("_23._m5", "_Height")
    .replaceAll("_23._m6", "_HeightPower")
    .replaceAll("_23._m7", "_Scale")
    .replaceAll("_23._m8", "_UseUv")
    .replace(/^\s*gl_Position\.y\s*=\s*-gl_Position\.y;\s*$/m, "");
  if (/_23\._m|uniform _21_23|gl_Position\.y\s*=\s*-gl_Position\.y/.test(output)) {
    throw new Error("Card_Parallax_Metal vertex adaptation is incomplete");
  }
  return `${output.trimEnd()}\n`;
}

function adaptFragment(source) {
  let output = source.replace(/^#version 300 es\s*/m, "");
  output = output.replace(/layout\(std140\) uniform _15_17[\s\S]*?}\s*_17;\s*/, [
    "uniform highp vec3 cameraPosition;",
    "uniform highp float _BaseColorIntensity;",
    "uniform highp float _Shininess;",
    "uniform highp float _SpecularIntensity;",
    "uniform highp float _MetalMaskIntensity;",
    "uniform highp vec3 _Rotation;",
    "",
  ].join("\n"));
  output = output
    .replaceAll("_17._m0", "cameraPosition")
    .replaceAll("_17._m1", "_BaseColorIntensity")
    .replaceAll("_17._m2", "_Shininess")
    .replaceAll("_17._m3", "_SpecularIntensity")
    .replaceAll("_17._m4", "_MetalMaskIntensity")
    .replaceAll("_17._m5", "_Rotation");
  if (/_17\._m|uniform _15_17/.test(output)) {
    throw new Error("Card_Parallax_Metal fragment adaptation is incomplete");
  }
  return `${output.trimEnd()}\n`;
}

await withExtractedSelectorProgram({
  selectorId: SELECTOR_ID,
  candidateWitnessId: CANDIDATE_WITNESS_ID,
  expectedProofGraphSha256: PROOF_GRAPH_SHA256,
  expectedPortIndexSha256: PORT_INDEX_SHA256,
  decryptedRoot: path.resolve(SHADER_ROOT, "..", ".."),
  prefix: "card-parallax-metal",
  rootDir: ROOT,
  spirvCross: SPIRV_CROSS,
}, ({ metadata, files, reflection }) => {
  assert.deepEqual(metadata.selector.keywords, []);
  assert.equal(metadata.selector.selectionMode, "unique-exact-keywords");
  assert.equal(metadata.selector.semanticExecutableId, "bbcbbdd141fcd8ee61ad5507fa3b0aa1b752117514c7878c0befe3fb207bddb6");
  assert.equal(metadata.parameterReflectionSha256, "b6168f2b8339cee8f541dd369ca31e7ea3085ca71aaed374f27d75afccb7b504");
  assert.equal(metadata.artifacts.parameterEntry.byteSize, 100);
  assertReflection(reflection);

  const officialVertex = runCommand(SPIRV_CROSS, [files.vertexSpirv, "--version", "300", "--es"], { cwd: ROOT });
  const officialFragment = runCommand(SPIRV_CROSS, [files.fragmentSpirv, "--version", "300", "--es"], { cwd: ROOT });
  assert.equal(sha256(officialVertex), OFFICIAL_CROSS_SHA256.vertex);
  assert.equal(sha256(officialFragment), OFFICIAL_CROSS_SHA256.fragment);
  const vertex = adaptVertex(officialVertex);
  const fragment = adaptFragment(officialFragment);
  const commonBindings = compileCommonBindings(metadata.commonBindings);
  const programBindings = compileProgramBindings(commonBindings, metadata.parameterReflection, metadata.shaderPropertyDefaults);
  const samplerBindings = joinProgramSamplerBindings(programBindings, reflection).map(({ set, ...row }) => {
    assert.equal(set, 0, "Card_Parallax_Metal sampler must use descriptor set 0");
    return row;
  });
  assert.deepEqual(samplerBindings.map(({ slot, spirvName, binding }) => ({ slot, spirvName, binding })), [
    { slot: "_CubeMap", spirvName: "_238", binding: 0 },
    { slot: "_MetalMaskTex", spirvName: "_277", binding: 1 },
  ]);

  const adaptation = {
    schema: "pocket-card-render/webgl-stage-adaptation@1",
    backend: "Unity Vulkan SPIR-V to Three.js WebGL2",
    vertex: {
      officialSpirvSha256: sha256File(files.vertexSpirv),
      spirvCrossGlslSha256: sha256(officialVertex),
      outputSha256: sha256(vertex),
      substitutions: [
        "map official position/normal/UV0/UV1/tangent locations to Three.js attributes",
        "map Unity object/world/view-projection matrices and camera position to Three.js engine uniforms",
        "remove Unity Vulkan clip-space Y inversion for WebGL clip space",
      ],
    },
    fragment: {
      officialSpirvSha256: sha256File(files.fragmentSpirv),
      spirvCrossGlslSha256: sha256(officialFragment),
      outputSha256: sha256(fragment),
      substitutions: [
        "map the official PGlobals constant buffer to typed Three.js uniforms",
        "remove the embedded GLSL version directive for Three.js RawShaderMaterial injection",
      ],
    },
    interfaceSha256: canonicalJsonSha256({ vertex: reflection.vertex, fragment: reflection.fragment }),
  };
  const manifest = {
    shader: "Lettuce/Common/CardNew/Face/Card_Parallax_Metal",
    generated_by: "build/build-exact-card-parallax-metal.mjs",
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
      vertex: "public/shaders/card_parallax_metal.vert.glsl",
      fragment: "public/shaders/card_parallax_metal.frag.glsl",
    },
    runtime_contract: {
      schema: "pocket-card-render/webgl-runtime-port@1",
      shader_key: "Card_Parallax_Metal",
      attributes: { position: "vec3", normal: "vec3", tangent: "vec4", uv: "vec2", uv1: "vec2" },
      engine_uniforms: {
        modelMatrix: "mat4", viewMatrix: "mat4", projectionMatrix: "mat4", cameraPosition: "vec3",
      },
      material_uniforms: {
        floats: [
          "_FakeCameraHeight", "_Height", "_HeightPower", "_Scale", "_BaseColorIntensity",
          "_Shininess", "_SpecularIntensity", "_MetalMaskIntensity",
        ],
        ints: ["_UseUv"],
        vectors: { _Rotation: "vec3" },
      },
      require_complete_active_bindings: true,
      camera_from_view: true,
      mrt_attachments: 2,
      stencil_face_mode: "generic",
      backend_texture_defaults: { _CubeMap: "neutral-gray-cube" },
    },
    sampler_bindings: samplerBindings,
    samplers: samplerBindings.map((row) => row.spirvName),
    sampler_slots: samplerBindings.map((row) => row.slot),
    compiled_texture_bindings: Object.fromEntries(samplerBindings.map((row) => [row.slot, row.binding])),
    implicit_defaults: metadata.shaderPropertyDefaults.textures,
    floats: {
      _FakeCameraHeight: "_FakeCameraHeight", _Height: "_Height", _HeightPower: "_HeightPower",
      _Scale: "_Scale", _UseUv: "_UseUv", _BaseColorIntensity: "_BaseColorIntensity",
      _Shininess: "_Shininess", _SpecularIntensity: "_SpecularIntensity",
      _MetalMaskIntensity: "_MetalMaskIntensity",
    },
    colors: { _Rotation: "_Rotation" },
    mrt: { primary: "_299", emissive: "_305" },
  };
  writeOrCheckOutputs({
    "card_parallax_metal.vert.glsl": vertex,
    "card_parallax_metal.frag.glsl": fragment,
    "card_parallax_metal_uniforms.json": `${JSON.stringify(manifest, null, 2)}\n`,
  }, { outDir: OUT, check: CHECK });
  console.log(`${CHECK ? "verified" : "generated"} Card_Parallax_Metal from selector-bound official SPIR-V`);
});
