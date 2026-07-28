#!/usr/bin/env node
// Generate Simple-PreMultiply-Hologram from its exact official selector.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  adaptThreeViewForwardToUnityDataAxes,
  adaptThreeWorldVectorsToUnityDataAxes,
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
const FRAGMENT_BASIS_CONVERSIONS = {
  worldVectors: [
    { source: "vs_TEXCOORD2", alias: "pcrUnityWorldNormal", expectedOccurrences: 4 },
  ],
  viewForwards: [{ matrixName: "viewMatrix", targetName: "_78" }],
};

function interfaceRows(items = []) {
  return items.map(({ name, type, location }) => ({ name, type, location }))
    .sort((left, right) => left.location - right.location);
}

function textureRows(items = []) {
  return items.map(({ name, type, set, binding }) => ({ name, type, set, binding }))
    .sort((left, right) => left.set - right.set || left.binding - right.binding);
}

function assertReflection(reflection) {
  assert.deepEqual(
    reflection.vertex.ubos?.map(({ name, block_size, set, binding }) => ({ name, block_size, set, binding })),
    [{ name: "_19_21", block_size: 192, set: 1, binding: 1 }],
  );
  assert.deepEqual(
    reflection.fragment.ubos?.map(({ name, block_size, set, binding }) => ({ name, block_size, set, binding })),
    [{ name: "_35_37", block_size: 124, set: 1, binding: 0 }],
  );
  assert.deepEqual(interfaceRows(reflection.vertex.inputs), [
    { name: "_11", type: "vec4", location: 0 },
    { name: "_95", type: "vec3", location: 1 },
    { name: "_88", type: "vec2", location: 2 },
    { name: "_91", type: "vec2", location: 3 },
    { name: "_134", type: "vec4", location: 4 },
  ]);
  assert.deepEqual(interfaceRows(reflection.vertex.outputs), [
    { name: "vs_TEXCOORD0", type: "vec2", location: 0 },
    { name: "vs_TEXCOORD1", type: "vec2", location: 1 },
    { name: "vs_TEXCOORD2", type: "vec3", location: 2 },
    { name: "vs_TEXCOORD3", type: "float", location: 3 },
  ]);
  assert.deepEqual(interfaceRows(reflection.fragment.inputs), [
    { name: "vs_TEXCOORD0", type: "vec2", location: 0 },
    { name: "vs_TEXCOORD1", type: "vec2", location: 1 },
    { name: "vs_TEXCOORD2", type: "vec3", location: 2 },
    { name: "vs_TEXCOORD3", type: "float", location: 3 },
  ]);
  assert.deepEqual(interfaceRows(reflection.fragment.outputs), [
    { name: "_504", type: "vec4", location: 0 },
    { name: "_516", type: "vec4", location: 1 },
  ]);
  assert.deepEqual(textureRows(reflection.fragment.textures), [
    { name: "_491", type: "sampler2D", set: 0, binding: 0 },
    { name: "_473", type: "sampler2D", set: 0, binding: 1 },
    { name: "_334", type: "sampler2D", set: 0, binding: 2 },
    { name: "_400", type: "sampler2D", set: 0, binding: 3 },
    { name: "_458", type: "sampler2D", set: 0, binding: 4 },
  ]);
}

function adaptVertex(source) {
  let output = source.replace(/^#version 300 es\s*/m, [
    "precision highp float;",
    "precision highp int;",
    "uniform mat4 modelMatrix;",
    "uniform mat4 viewMatrix;",
    "uniform mat4 projectionMatrix;",
    "",
  ].join("\n"));
  output = output.replace(/layout\(std140\) uniform _19_21[\s\S]*?}\s*_21;\s*/, "");
  output = output
    .replace("layout(location = 0) in vec4 _11;", "in vec3 position;")
    .replace("layout(location = 1) in vec3 _95;", "in vec3 normal;")
    .replace("layout(location = 2) in vec2 _88;", "in vec2 uv;")
    .replace("layout(location = 3) in vec2 _91;", "in vec2 uv1;")
    .replace("layout(location = 4) in vec4 _134;", "in vec4 color;")
    .replace(/void main\(\)\s*\{/, `void main()
{
    vec4 _11 = vec4(position, 1.0);
    vec3 _95 = normal;
    vec2 _88 = uv;
    vec2 _91 = uv1;
    vec4 _134 = color;
    mat4 _ObjectToWorld = modelMatrix;
    mat4 _WorldToObject = inverse(modelMatrix);
    mat4 _ViewProjection = projectionMatrix * viewMatrix;`)
    .replaceAll("_21._m0", "_ObjectToWorld")
    .replaceAll("_21._m1", "_WorldToObject")
    .replaceAll("_21._m2", "_ViewProjection")
    .replace(/^\s*gl_Position\.y\s*=\s*-gl_Position\.y;\s*$/m, "");
  if (/_21\._m|uniform _19_21|gl_Position\.y\s*=\s*-gl_Position\.y/.test(output)) {
    throw new Error("Simple-PreMultiply-Hologram vertex adaptation is incomplete");
  }
  return `${output.trimEnd()}\n`;
}

function adaptFragment(source) {
  let output = source.replace(/^#version 300 es\s*/m, "");
  output = output.replace(/layout\(std140\) uniform _35_37[\s\S]*?}\s*_37;\s*/, [
    "uniform highp mat4 viewMatrix;",
    "uniform mediump float _DiffractionIntensity;",
    "uniform mediump float _DiffractionPower;",
    "uniform mediump float _RampRepeat;",
    "uniform mediump float _RampSpeed;",
    "uniform mediump float _RampOffset;",
    "uniform mediump float _RampInterval;",
    "uniform int _TiltEnabled;",
    "uniform mediump float _TiltPower;",
    "uniform mediump float _TiltOffset;",
    "uniform mediump float _TiltIntensity;",
    "uniform mediump vec3 _Rotation;",
    "",
  ].join("\n"));
  const fields = [
    ["_37._m0", "viewMatrix"],
    ["_37._m1", "_DiffractionIntensity"],
    ["_37._m2", "_DiffractionPower"],
    ["_37._m3", "_RampRepeat"],
    ["_37._m4", "_RampSpeed"],
    ["_37._m5", "_RampOffset"],
    ["_37._m6", "_RampInterval"],
    ["_37._m7", "_TiltEnabled"],
    ["_37._m8", "_TiltPower"],
    ["_37._m9", "_TiltOffset"],
    ["_37._m10", "_TiltIntensity"],
    ["_37._m11", "_Rotation"],
  ];
  for (const [from, to] of fields.sort(([left], [right]) => right.length - left.length)) {
    output = output.replaceAll(from, to);
  }
  output = adaptThreeWorldVectorsToUnityDataAxes(output, {
    bindings: FRAGMENT_BASIS_CONVERSIONS.worldVectors,
  });
  output = adaptThreeViewForwardToUnityDataAxes(output, FRAGMENT_BASIS_CONVERSIONS.viewForwards[0]);
  if (/_37\._m|uniform _35_37/.test(output)) {
    throw new Error("Simple-PreMultiply-Hologram fragment adaptation is incomplete");
  }
  return `${output.trimEnd()}\n`;
}

function validateWebGlStage(source, stage) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "pcr-simple-premultiply-glsl-"));
  const file = path.join(temp, `simple-premultiply.${stage}`);
  try {
    fs.writeFileSync(file, `#version 300 es\n${source}`);
    runCommand(GLSLANG, ["-S", stage, file], { cwd: ROOT });
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

const result = await generateExactSelectorPort({
  extraction: {
    selectorId: "019ab096cef0a08f6e6736d6d6894ab88493fe8cbbe349dee3fd850f1f8b479d",
    candidateWitnessId: "f12371cc222c53d980a281d8870889277b7efb3223e9d857453f19f17717a901",
    expectedProofGraphSha256: "307ed3660e5d3b1bfd8cf9e6b3d64e44937af215da3b6ed84ead198800eeadc4",
    expectedPortIndexSha256: "15095f34b9e75515bbcc3924f6f8b2abb826ba96b48e819ec911486bcfa6f5a9",
    decryptedRoot: path.resolve(SHADER_ROOT, "..", ".."),
    prefix: "simple_premultiply_hologram",
    rootDir: ROOT,
  },
  shader: "Lettuce/Common/CardNew/ShadowBox/Simple-PreMultiply-Hologram",
  generatedBy: "build/build-exact-simple-premultiply-hologram.mjs",
  expectedSpirvCrossSha256: {
    vertex: "7b68c49229c32a8fd9b35634232941dd84056795d4d0cab4314e65689a6ab954",
    fragment: "a90f1feec3dd68cf931d998535c7510a4710803f8e3cb0d28b5f833641525664",
  },
  spirvCross: SPIRV_CROSS,
  passPolicy: PASS_POLICY,
  validateReflection: assertReflection,
  adaptVertex,
  adaptFragment,
  validateWebGlStage,
  substitutions: {
    vertex: [
      "map official position/normal/UV0/UV1/color locations to Three.js r165 attributes",
      "map Unity object/world/view-projection matrices to Three.js engine uniforms",
      "remove Unity Vulkan clip-space Y inversion for WebGL clip space",
    ],
    fragment: [
      "map unity_MatrixV to viewMatrix",
      "expand serialized PGlobals fields into same-name material uniforms",
      "convert Three world normal and reconstructed view-forward vectors to Unity data axes",
    ],
  },
  adaptationOperations: {
    vertex: [
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
    fragment: [
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
  webglSources: {
    vertex: "public/shaders/simple_premultiply_hologram.vert.glsl",
    fragment: "public/shaders/simple_premultiply_hologram.frag.glsl",
  },
  runtimeContract: {
    schema: "pocket-card-render/webgl-runtime-port@1",
    shader_key: "Simple-PreMultiply-Hologram",
    attributes: { position: "vec3", normal: "vec3", color: "vec4", uv: "vec2", uv1: "vec2" },
    engine_uniforms: { modelMatrix: "mat4", viewMatrix: "mat4", projectionMatrix: "mat4" },
    material_uniforms: {
      floats: [
        "_DiffractionIntensity", "_DiffractionPower", "_RampRepeat", "_RampSpeed",
        "_RampOffset", "_RampInterval", "_TiltPower", "_TiltOffset", "_TiltIntensity",
      ],
      ints: ["_TiltEnabled"],
      vectors: { _Rotation: "vec3" },
    },
    require_complete_active_bindings: true,
    camera_from_view: false,
    mrt_attachments: 2,
    stencil_normalization: "none",
    stencil_face_mode: "generic",
    backend_basis_conversions: { fragment: FRAGMENT_BASIS_CONVERSIONS },
  },
  manifestExtras: {
    mrt: { primary: "_504", secondary: "_516", secondary_value: "zero" },
    runtime_boundaries: {
      missing_uv1_guest_binding: "target official meshes do not serialize TEXCOORD_1; native guest default binding remains runtime-required",
    },
  },
  output: {
    outDir: path.join(ROOT, "public", "shaders"),
    vertex: "simple_premultiply_hologram.vert.glsl",
    fragment: "simple_premultiply_hologram.frag.glsl",
    manifest: "simple_premultiply_hologram_uniforms.json",
    check: CHECK,
  },
});

assert.equal(result.manifest.official_selector.semanticExecutableId,
  "14841ab2ded68d6d00c5e41575ceb8f265e1a1896532dc8f03f796af81abb5b3");
assert.equal(result.manifest.official_parameter_entry.reflection_sha256,
  "3e37c518edc0728f6bd6f2e22ffc9784709d3a8925edb9d263ba9e8cd75b4dac");
assert.deepEqual(result.samplerBindings.map(({ slot, spirvName, binding }) => ({ slot, spirvName, binding })), [
  { slot: "_MainTex", spirvName: "_491", binding: 0 },
  { slot: "_HologramMaskTex", spirvName: "_473", binding: 1 },
  { slot: "_PhaseTex", spirvName: "_334", binding: 2 },
  { slot: "_RampMaskTex", spirvName: "_400", binding: 3 },
  { slot: "_RampTex", spirvName: "_458", binding: 4 },
]);
console.log(`${CHECK ? "verified" : "generated"} Simple-PreMultiply-Hologram from selector-bound official SPIR-V`);
