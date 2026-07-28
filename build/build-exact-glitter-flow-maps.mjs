// Generate Card_UR_Glitter_FlowMaps from its exact official material selector.
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

const FLOATS = [
  "_FadeDuration", "_FlowAPower", "_FlowBPower", "_LightTime", "_EmitThreshold",
  "_FakeCameraHeight", "_Height", "_HeightPower", "_Scale", "_FlowScale",
  "_FakeCameraHeightB", "_HeightB", "_HeightPowerB", "_ScaleB", "_FlowScaleB",
];

const PASS_POLICY = {
  rtSeparateBlend: false,
  fixed: {
    zClip: { val: 1, name: null }, conservative: { val: 0, name: null },
    offsetFactor: { val: 0, name: null }, offsetUnits: { val: 0, name: null },
    alphaToMask: { val: 0, name: null }, fogMode: -1, lighting: false,
  },
};

function interfaceRows(rows = []) {
  return rows.map(({ name, type, location }) => ({ name, type, location }))
    .sort((left, right) => left.location - right.location);
}

function assertReflection(reflection) {
  assert.deepEqual(
    reflection.vertex.ubos?.map(({ name, block_size, set, binding }) => ({ name, block_size, set, binding })),
    [{ name: "_78_80", block_size: 280, set: 1, binding: 1 }],
  );
  assert.deepEqual(
    reflection.fragment.ubos?.map(({ name, block_size, set, binding }) => ({ name, block_size, set, binding })),
    [{ name: "_37_39", block_size: 72, set: 1, binding: 0 }],
  );
  assert.deepEqual(interfaceRows(reflection.vertex.inputs), [
    { name: "_133", type: "vec4", location: 0 },
    { name: "_12", type: "vec3", location: 1 },
    { name: "_214", type: "vec2", location: 2 },
    { name: "_34", type: "vec4", location: 3 },
  ]);
  assert.deepEqual(interfaceRows(reflection.fragment.outputs), [
    { name: "_1090", type: "vec4", location: 0 },
    { name: "_1092", type: "vec4", location: 1 },
  ]);
  assert.deepEqual(
    reflection.fragment.textures?.map(({ name, type, set, binding }) => ({ name, type, set, binding })),
    [
      { name: "_13", type: "sampler2D", set: 0, binding: 0 },
      { name: "_205", type: "sampler2D", set: 0, binding: 1 },
      { name: "_404", type: "sampler2D", set: 0, binding: 2 },
      { name: "_644", type: "sampler2D", set: 0, binding: 3 },
      { name: "_690", type: "sampler2D", set: 0, binding: 4 },
      { name: "_843", type: "sampler2D", set: 0, binding: 5 },
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
    "uniform highp vec4 _FlowParams[2];",
    ...FLOATS.slice(5).map((name) => `uniform mediump float ${name};`),
    "",
  ].join("\n"));
  output = output.replace(/layout\(std140\) uniform _78_80[\s\S]*?}\s*_80;\s*/, "");
  output = output
    .replace("layout(location = 1) in vec3 _12;", "in vec3 normal;")
    .replace("layout(location = 3) in mediump vec4 _34;", "in mediump vec4 tangent;")
    .replace("layout(location = 0) in vec4 _133;", "in vec3 position;")
    .replace("layout(location = 2) in vec2 _214;", "in vec2 uv;")
    .replace(/void main\(\)\s*\{/, `void main()
{
    vec3 _12 = normal;
    mediump vec4 _34 = tangent;
    vec4 _133 = vec4(position, 1.0);
    vec2 _214 = uv;
    vec3 uCameraObject = (inverse(modelMatrix) * vec4(cameraPosition, 1.0)).xyz;`)
    .replace(/    _50 = _80\._m0\.yyy \* _80\._m2\[1\]\.xyz;[\s\S]*?    _112 = vec4\(_118\.x, _118\.y, _118\.z, _112\.w\);/, "    _112 = vec4(uCameraObject, _112.w);")
    .replaceAll("_80._m4", "_FakeCameraHeight")
    .replaceAll("_80._m5", "_Height")
    .replaceAll("_80._m6", "_HeightPower")
    .replaceAll("_80._m7", "_Scale")
    .replaceAll("_80._m8[1]", "_FlowParams[1]")
    .replaceAll("_80._m9", "_FakeCameraHeightB")
    .replaceAll("_80._m10", "_HeightB")
    .replaceAll("_80._m11", "_HeightPowerB")
    .replaceAll("_80._m12", "_ScaleB")
    .replaceAll("_80._m13", "_FlowScale")
    .replaceAll("_80._m14", "_FlowScaleB")
    .replace(/    _9 = _133\.yyyy \* _80\._m1\[1\];[\s\S]*?    gl_Position\.y = -gl_Position\.y;/,
      "    gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);");
  if (/_80\.|gl_Position\.y\s*=\s*-gl_Position\.y/.test(output)) {
    throw new Error("Card_UR_Glitter_FlowMaps vertex adaptation is incomplete");
  }
  return `${output.trimEnd()}\n`;
}

function adaptFragment(source) {
  let output = source.replace(/^#version 300 es\s*/m, "");
  output = output.replace(/layout\(std140\) uniform _37_39[\s\S]*?}\s*_39;\s*/, [
    "uniform highp vec4 _FlowParams[2];",
    "uniform highp float _FadeDuration;",
    "uniform highp float _FlowAPower;",
    "uniform highp float _FlowBPower;",
    "uniform vec4 _LightColor;",
    "uniform highp float _LightTime;",
    "uniform highp float _EmitThreshold;",
    "",
  ].join("\n"));
  const fields = [
    ["_39._m0", "_FlowParams"], ["_39._m1", "_FadeDuration"],
    ["_39._m2", "_FlowAPower"], ["_39._m3", "_FlowBPower"],
    ["_39._m4", "_LightColor"], ["_39._m5", "_LightTime"],
    ["_39._m6", "_EmitThreshold"],
  ];
  for (const [from, to] of fields) output = output.replaceAll(from, to);
  if (/_39\._m/.test(output)) throw new Error("Card_UR_Glitter_FlowMaps fragment adaptation is incomplete");
  return `${output.trimEnd()}\n`;
}

function validateWebGlStage(source, stage) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "pcr-glitter-glsl-"));
  const file = path.join(temp, `glitter.${stage}`);
  try {
    fs.writeFileSync(file, `#version 300 es\n${source}`);
    runCommand(GLSLANG, ["-S", stage, file], { cwd: ROOT });
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

const result = await generateExactSelectorPort({
  extraction: {
    selectorId: "4a38649c034968a639962150c1ef03d19f9fd4571ef5b496c5facec8076ed6b4",
    candidateWitnessId: "741330e6c5c79eb6e2a8fc9c2f214f421165df8160ee63a33b693d28906ca676",
    expectedProofGraphSha256: "307ed3660e5d3b1bfd8cf9e6b3d64e44937af215da3b6ed84ead198800eeadc4",
    expectedPortIndexSha256: "15095f34b9e75515bbcc3924f6f8b2abb826ba96b48e819ec911486bcfa6f5a9",
    decryptedRoot: path.resolve(SHADER_ROOT, "..", ".."),
    prefix: "glitter_flow_maps",
    rootDir: ROOT,
  },
  shader: "Lettuce/Common/CardNew/Face/Card_UR_Glitter_FlowMaps",
  generatedBy: "build/build-exact-glitter-flow-maps.mjs",
  expectedSpirvCrossSha256: {
    vertex: "bcf1eedb55992d90123f6c73c0f2e7c5fec82f0b1f51c933cf9e9998e8c42809",
    fragment: "c81c8364f09da9c9858ac07095c016a13d0736b5ea3c6c6b68f9a485278cb7a9",
  },
  spirvCross: SPIRV_CROSS,
  passPolicy: PASS_POLICY,
  validateReflection: assertReflection,
  adaptVertex,
  adaptFragment,
  validateWebGlStage,
  substitutions: {
    vertex: [
      "map official position/normal/UV/tangent locations to Three.js attributes",
      "unity_ObjectToWorld/unity_MatrixVP := modelMatrix and projectionMatrix * viewMatrix",
      "unity_WorldToObject * _WorldSpaceCameraPos := inverse(modelMatrix) * cameraPosition",
      "expand serialized common-buffer values into same-name material and FlowParams uniforms",
      "remove Unity Vulkan clip-space Y inversion for WebGL clip space",
    ],
    fragment: ["expand serialized common-buffer values into same-name material and FlowParams uniforms"],
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
        kind: "dynamic-uniform-producer-binding",
        contract: "runtime-producer-to-three-uniforms",
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
      {
        kind: "uniform-buffer-flattening",
        source: "serialized-common",
        preservation: "names-types-precision",
      },
      {
        kind: "dynamic-uniform-producer-binding",
        contract: "runtime-producer-to-three-uniforms",
      },
      { kind: "glsl-version-ownership", owner: "three-raw-shader-material" },
    ],
  },
  webglSources: {
    vertex: "public/shaders/glitter.vert.glsl",
    fragment: "public/shaders/glitter.frag.glsl",
  },
  runtimeContract: {
    schema: "pocket-card-render/webgl-runtime-port@1",
    shader_key: "Card_UR_Glitter_FlowMaps",
    attributes: { position: "vec3", normal: "vec3", uv: "vec2", tangent: "vec4" },
    engine_uniforms: {
      modelMatrix: "mat4", viewMatrix: "mat4", projectionMatrix: "mat4", cameraPosition: "vec3",
    },
    material_uniforms: { floats: FLOATS, ints: [], vectors: { _LightColor: "vec4" } },
    dynamic_uniforms: {
      _FlowParams: { type: "vec4[2]", source: "GlitterFlowMaps.Update/Material.SetVectorArray" },
    },
    require_complete_active_bindings: true,
    camera_from_view: true,
    mrt_attachments: 2,
    stencil_normalization: "none",
    stencil_face_mode: "generic",
  },
  manifestExtras: {
    mrt: { primary: "_1090", emissive: "_1092" },
    runtime_boundaries: [{
      status: "runtime-required",
      producer: "GlitterFlowMaps.Update/Material.SetVectorArray",
      payload: "two-element _FlowParams vector array",
    }],
  },
  output: {
    outDir: path.join(ROOT, "public", "shaders"),
    vertex: "glitter.vert.glsl",
    fragment: "glitter.frag.glsl",
    manifest: "glitter_uniforms.json",
    check: CHECK,
  },
});

assert.equal(result.manifest.official_selector.semanticExecutableId,
  "e3e7daa284bbd55ec1ad643fdcfadd61fef895ca2cc92c609d43f48f6f6e89e5");
assert.equal(result.manifest.official_parameter_entry.reflection_sha256,
  "d1cda331b9f55064f54f9c11a0fc3d59e680358f0852e9c1295b03109e15b7c9");
assert.deepEqual(result.samplerBindings.map(({ slot, spirvName, binding }) => ({ slot, spirvName, binding })), [
  { slot: "_FlowAMap", spirvName: "_13", binding: 0 },
  { slot: "_ALightTex", spirvName: "_205", binding: 1 },
  { slot: "_ABaseTex", spirvName: "_404", binding: 2 },
  { slot: "_FlowBMap", spirvName: "_644", binding: 3 },
  { slot: "_BLightTex", spirvName: "_690", binding: 4 },
  { slot: "_BBaseTex", spirvName: "_843", binding: 5 },
]);
console.log(`${CHECK ? "verified" : "generated"} Card_UR_Glitter_FlowMaps from selector-bound official SPIR-V`);
