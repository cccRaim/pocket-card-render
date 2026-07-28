#!/usr/bin/env node
// Generate Card_Parallax_MatCap_Lighting from its exact official selector.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  generateExactSelectorPort,
  runCommand,
} from "./exact-selector-port-core.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHADER_ROOT = process.env.PCR_SHADERS
  || "D:/DevProjectes/ptcgp-tools-master/masterdata_decoder/.output/decrypted/Common/Shader";
const SPIRV_CROSS = process.env.SPIRV_CROSS || "spirv-cross";
const GLSLANG = process.env.GLSLANG_VALIDATOR || "glslangValidator";
const CHECK = process.argv.includes("--check") || process.env.PCR_EXACT_CHECK === "1";

const PASS_POLICY = {
  rtSeparateBlend: false,
  fixed: {
    zClip: { val: 1, name: null }, conservative: { val: 0, name: null },
    offsetFactor: { val: 0, name: null }, offsetUnits: { val: 0, name: null },
    alphaToMask: { val: 0, name: null }, fogMode: -1, lighting: false,
  },
};

function interfaceRows(items = []) {
  return items.map(({ name, type, location }) => ({ name, type, location }))
    .sort((left, right) => left.location - right.location);
}

function assertReflection(reflection) {
  assert.deepEqual(
    reflection.vertex.ubos?.map(({ name, block_size, set, binding }) => ({ name, block_size, set, binding })),
    [{ name: "_21_23", block_size: 228, set: 1, binding: 1 }],
  );
  assert.deepEqual(
    reflection.fragment.ubos?.map(({ name, block_size, set, binding }) => ({ name, block_size, set, binding })),
    [{ name: "_15_17", block_size: 128, set: 1, binding: 0 }],
  );
  assert.deepEqual(interfaceRows(reflection.vertex.inputs), [
    { name: "_11", type: "vec4", location: 0 },
    { name: "_97", type: "vec3", location: 1 },
    { name: "_313", type: "vec2", location: 2 },
    { name: "_316", type: "vec2", location: 3 },
    { name: "_117", type: "vec4", location: 4 },
  ]);
  assert.deepEqual(interfaceRows(reflection.vertex.outputs), [
    { name: "vs_TEXCOORD0", type: "vec2", location: 0 },
    { name: "vs_TEXCOORD1", type: "vec3", location: 1 },
    { name: "vs_TEXCOORD2", type: "vec3", location: 2 },
  ]);
  assert.deepEqual(interfaceRows(reflection.fragment.inputs), [
    { name: "vs_TEXCOORD0", type: "vec2", location: 0 },
  ]);
  assert.deepEqual(interfaceRows(reflection.fragment.outputs), [
    { name: "_228", type: "vec4", location: 0 },
    { name: "_230", type: "vec4", location: 1 },
  ]);
  assert.deepEqual(
    reflection.fragment.textures?.map(({ name, type, set, binding }) => ({ name, type, set, binding })),
    [
      { name: "_56", type: "sampler2D", set: 0, binding: 0 },
      { name: "_63", type: "sampler2D", set: 0, binding: 1 },
    ],
  );
}

function adaptVertex(source) {
  let output = source.replace(/^#version 300 es\s*/m, [
    "precision highp float;",
    "precision highp int;",
    "uniform mat4 modelMatrix;",
    "uniform mat4 viewMatrix;",
    "uniform mat4 projectionMatrix;",
    "uniform vec3 cameraPosition;",
    "uniform float _FakeCameraHeight;",
    "uniform float _Height;",
    "uniform float _HeightPower;",
    "uniform float _Scale;",
    "uniform int _UseUv2;",
    "",
  ].join("\n"));
  output = output.replace(/layout\(std140\) uniform _21_23[\s\S]*?}\s*_23;\s*/, "");
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
    .replaceAll("_23._m8", "_UseUv2")
    .replace(/^\s*gl_Position\.y\s*=\s*-gl_Position\.y;\s*$/m, "");
  if (/_23\._m|uniform _21_23|gl_Position\.y\s*=\s*-gl_Position\.y/.test(output)) {
    throw new Error("Card_Parallax_MatCap_Lighting vertex adaptation is incomplete");
  }
  return `${output.trimEnd()}\n`;
}

function adaptFragment(source) {
  let output = source.replace(/^#version 300 es\s*/m, "");
  output = output.replace(/layout\(std140\) uniform _15_17[\s\S]*?}\s*_17;\s*/, [
    "uniform highp mat4 modelMatrix;",
    "uniform highp float _LightSensitive;",
    "uniform highp float _LightCurvePower;",
    "uniform highp vec4 _LightingColor;",
    "uniform int _Debug;",
    "uniform int _EmissiveEnabled;",
    "uniform highp float _EmissiveIntensity;",
    "uniform highp vec4 _EmissiveColor;",
    "",
  ].join("\n"));
  const fields = [
    ["_17._m0", "modelMatrix"],
    ["_17._m1", "_LightSensitive"],
    ["_17._m2", "_LightCurvePower"],
    ["_17._m3", "_LightingColor"],
    ["_17._m4", "_Debug"],
    ["_17._m5", "_EmissiveEnabled"],
    ["_17._m6", "_EmissiveIntensity"],
    ["_17._m7", "_EmissiveColor"],
  ];
  for (const [from, to] of fields) output = output.replaceAll(from, to);
  if (/_17\._m|uniform _15_17/.test(output)) {
    throw new Error("Card_Parallax_MatCap_Lighting fragment adaptation is incomplete");
  }
  return `${output.trimEnd()}\n`;
}

function validateWebGlStage(source, stage) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "pcr-matcap-glsl-"));
  const file = path.join(temp, `matcap.${stage}`);
  try {
    fs.writeFileSync(file, `#version 300 es\n${source}`);
    runCommand(GLSLANG, ["-S", stage, file], { cwd: ROOT });
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

const result = await generateExactSelectorPort({
  extraction: {
    selectorId: "82d74793623781f7ff66286bbd165df6b62567ccb9dd5bdd3594133d19e29931",
    candidateWitnessId: "60d74858874bf4a236896b464909975dff080498545e876ee63d7f9251f262a6",
    expectedProofGraphSha256: "307ed3660e5d3b1bfd8cf9e6b3d64e44937af215da3b6ed84ead198800eeadc4",
    expectedPortIndexSha256: "15095f34b9e75515bbcc3924f6f8b2abb826ba96b48e819ec911486bcfa6f5a9",
    decryptedRoot: path.resolve(SHADER_ROOT, "..", ".."),
    prefix: "card_parallax_matcap_lighting",
    rootDir: ROOT,
  },
  shader: "Lettuce/Common/CardNew/Face/Card_Parallax_MatCap_Lighting",
  generatedBy: "build/build-exact-card-parallax-matcap-lighting.mjs",
  expectedSpirvCrossSha256: {
    vertex: "c37d2e7f9ac2e6631022d86b0d2511adfb1056af090c63fdb6d4e7b2e8f3e22c",
    fragment: "768c9fd42b5b6beb7b0eab07532d8831bb6c350d4b2bbc59029ab8aaa6c3583b",
  },
  spirvCross: SPIRV_CROSS,
  passPolicy: PASS_POLICY,
  validateReflection: assertReflection,
  adaptVertex,
  adaptFragment,
  validateWebGlStage,
  substitutions: {
    vertex: [
      "map official position/normal/UV0/UV1/tangent locations to Three.js attributes",
      "map Unity object/world/view-projection matrices and camera position to Three.js engine uniforms",
      "expand serialized common-buffer values into same-name material uniforms",
      "remove Unity Vulkan clip-space Y inversion for WebGL clip space",
    ],
    fragment: [
      "map unity_ObjectToWorld to modelMatrix",
      "expand serialized PGlobals fields into same-name material uniforms",
    ],
  },
  adaptationOperations: {
    vertex: [
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
    fragment: [
      { kind: "engine-uniform-binding", contract: "unity-builtins-to-three-r165" },
      {
        kind: "uniform-buffer-flattening",
        source: "serialized-common",
        preservation: "names-types-precision",
      },
      { kind: "glsl-version-ownership", owner: "three-raw-shader-material" },
    ],
  },
  webglSources: {
    vertex: "public/shaders/card_parallax_matcap_lighting.vert.glsl",
    fragment: "public/shaders/card_parallax_matcap_lighting.frag.glsl",
  },
  runtimeContract: {
    schema: "pocket-card-render/webgl-runtime-port@1",
    shader_key: "Card_Parallax_MatCap_Lighting",
    attributes: { position: "vec3", normal: "vec3", tangent: "vec4", uv: "vec2", uv1: "vec2" },
    engine_uniforms: {
      modelMatrix: "mat4", viewMatrix: "mat4", projectionMatrix: "mat4", cameraPosition: "vec3",
    },
    material_uniforms: {
      floats: [
        "_FakeCameraHeight", "_Height", "_HeightPower", "_Scale",
        "_LightSensitive", "_LightCurvePower", "_EmissiveIntensity",
      ],
      ints: ["_UseUv2", "_Debug", "_EmissiveEnabled"],
      vectors: { _LightingColor: "vec4", _EmissiveColor: "vec4" },
    },
    require_complete_active_bindings: true,
    camera_from_view: true,
    mrt_attachments: 2,
    stencil_normalization: "none",
    stencil_face_mode: "generic",
  },
  manifestExtras: {
    mrt: { primary: "_228", emissive: "_230", secondary_rgb: "active" },
  },
  output: {
    outDir: path.join(ROOT, "public", "shaders"),
    vertex: "card_parallax_matcap_lighting.vert.glsl",
    fragment: "card_parallax_matcap_lighting.frag.glsl",
    manifest: "card_parallax_matcap_lighting_uniforms.json",
    check: CHECK,
  },
});

assert.equal(result.manifest.official_selector.semanticExecutableId,
  "b6133ce2aa6a3a725c68f058d4ccd995dd6b4244d50d845b032e248278fd9cc4");
assert.equal(result.manifest.official_parameter_entry.reflection_sha256,
  "b4c9bc8ce228de1463c87dd87f0525814e276bf117dba0e1f6bd807a23c53e85");
assert.deepEqual(result.samplerBindings.map(({ slot, spirvName, binding }) => ({ slot, spirvName, binding })), [
  { slot: "_MatCapLightTex", spirvName: "_56", binding: 0 },
  { slot: "_LightingMask", spirvName: "_63", binding: 1 },
]);
console.log(`${CHECK ? "verified" : "generated"} Card_Parallax_MatCap_Lighting from selector-bound official SPIR-V`);
