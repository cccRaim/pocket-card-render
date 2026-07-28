#!/usr/bin/env node
// Generate CardNew/Logo/Opaque from its selector-bound official executable.
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
const OUT = path.join(ROOT, "public", "shaders");
const CHECK = process.argv.includes("--check") || process.env.PCR_EXACT_CHECK === "1";

const SHADER = "Lettuce/Common/CardNew/Logo/Opaque";
const GENERATED_BY = "build/build-exact-logo-opaque.mjs";
const STEM = "logo_opaque";
const SELECTOR_ID = "23fba2d0f26091a424cc0b5b83a45dcf03068d57a8abf2d01ac9cd2858406637";
const CANDIDATE_WITNESS_ID =
  "e65443ac76083cec5397404a522f5a9f5f0a975b0a22ecd3306aa05d7b368ceb";
const EXECUTABLE_ID =
  "09968798de08638e7644b958b97bd9066046897bca94e68c3c781707f67551a7";
const SEMANTIC_EXECUTABLE_ID =
  "6cc0bae2603c5d1496aaf93d76a7e11f4ddd9aad8c835a8763d6f12fecc5729e";
const PROOF_GRAPH_SHA256 =
  "307ed3660e5d3b1bfd8cf9e6b3d64e44937af215da3b6ed84ead198800eeadc4";
const PORT_INDEX_SHA256 =
  "15095f34b9e75515bbcc3924f6f8b2abb826ba96b48e819ec911486bcfa6f5a9";
const VERTEX_SPIRV_SHA256 =
  "85986bdd09a67550228123f4c1aa8cb84d687814f986d20a97809bd1df2f6833";
const FRAGMENT_SPIRV_SHA256 =
  "a488fc79d47fdf809be17e7515d38819b59c5a6548503a25885c30314a81a113";
const PARAMETER_ENTRY_SHA256 =
  "7eb5d6e26dd96657742f3d1a81fd8a4035003374e590797bc33635bdd0c34915";
const PASS_STATE_SHA256 =
  "91e0b417062602e9e639ecc679cf6d181712c9531d152026a3d1beec19230d21";
const COMMON_BINDINGS_SHA256 =
  "1ea5db62bfc1fee382e0e55bf588565407763ae0e2a3cb8f1205f1eb6f5de9bd";

const PASS_POLICY = {
  rtSeparateBlend: false,
  fixed: {
    zClip: { val: 1, name: null },
    conservative: { val: 0, name: null },
    offsetFactor: { val: 0, name: null },
    offsetUnits: { val: 0, name: null },
    alphaToMask: { val: 0, name: null },
    fogMode: -1,
    lighting: false,
  },
};

function interfaceRows(items = []) {
  return items.map(({ name, type, location }) => ({ name, type, location }))
    .sort((left, right) => left.location - right.location || left.name.localeCompare(right.name));
}

function textureRows(items = []) {
  return items.map(({ name, type, set, binding }) => ({ name, type, set, binding }))
    .sort((left, right) => left.set - right.set || left.binding - right.binding);
}

function replaceExactlyOnce(source, pattern, replacement, label) {
  const flags = typeof pattern === "string" ? "" : pattern.flags.replaceAll("g", "");
  const matcher = typeof pattern === "string"
    ? new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    : new RegExp(pattern.source, flags);
  const first = matcher.exec(source);
  if (!first) throw new Error(`${label}: source shape changed`);
  if (new RegExp(matcher.source, flags).test(source.slice(first.index + first[0].length))) {
    throw new Error(`${label}: source shape is ambiguous`);
  }
  return `${source.slice(0, first.index)}${replacement}${source.slice(first.index + first[0].length)}`;
}

function assertReflection(reflection, metadata) {
  assert.deepEqual(metadata.selector, {
    selectorId: SELECTOR_ID,
    candidateWitnessId: CANDIDATE_WITNESS_ID,
    shaderIdentity: "CAB-596cc0831b33693ae475c2f8be0b7768:-7670412818071714871",
    shaderName: SHADER,
    keywords: [],
    selectionMode: "unique-exact-keywords",
    subshader: 0,
    pass: 0,
    programBlobIndex: 1,
    parameterBlobIndex: 0,
    executableId: EXECUTABLE_ID,
    semanticExecutableId: SEMANTIC_EXECUTABLE_ID,
  });
  assert.deepEqual(metadata.identityFields, {
    vertexSpirvSha256: VERTEX_SPIRV_SHA256,
    fragmentSpirvSha256: FRAGMENT_SPIRV_SHA256,
    parameterEntrySha256: PARAMETER_ENTRY_SHA256,
    passStateSha256: PASS_STATE_SHA256,
    commonBindingsSha256: COMMON_BINDINGS_SHA256,
  });
  assert.deepEqual(metadata.source, {
    bundle: "Common/Shader/Common/CardNew/Logo/Card_Logo_Opaque.shader_bundles",
    bundleSha256: "a0302d4e46fb4b99061599865bb77b1cc47399c39723611df66e32200c71f69c",
    shaderObjectSha256: "d778a4961abbfce7af2c2960df34f8086eea2c9abad56748a528a18393a3121c",
    programEntrySha256: "c53cbab6639b5baefbbba234f2d8b33658787246aaeaea4b73261c2156fae6be",
  });
  assert.equal(metadata.artifacts.parameterEntry.byteSize, 64);
  assert.equal(metadata.parameterReflection.version, 202012090);
  assert.equal(metadata.parameterReflection.resourceCount, 0);
  assert.equal(metadata.parameterReflection.bindingClosure.constantBuffersMatch, true);
  assert.deepEqual(metadata.shaderPropertyDefaults, {
    textures: {},
    textureDescriptors: {
      _MainTex: { defaultName: "", dimension: 2 },
    },
    floats: { _ZTest: 4, _ZWrite: 1 },
    colors: {},
    vectors: {},
  });
  assert.deepEqual(
    metadata.programBindChannels.bindChannels.map(
      ({ sourceName, targetName }) => ({ sourceName, targetName }),
    ),
    [
      { sourceName: "Vertex", targetName: "Attrib1" },
      { sourceName: "UV0", targetName: "Attrib2" },
    ],
  );
  assert.deepEqual(interfaceRows(reflection.vertex.inputs), [
    { name: "_11", type: "vec4", location: 0 },
    { name: "_87", type: "vec2", location: 1 },
  ]);
  assert.deepEqual(interfaceRows(reflection.vertex.outputs), [
    { name: "vs_TEXCOORD0", type: "vec2", location: 0 },
  ]);
  assert.deepEqual(interfaceRows(reflection.fragment.inputs), [
    { name: "vs_TEXCOORD0", type: "vec2", location: 0 },
  ]);
  assert.deepEqual(interfaceRows(reflection.fragment.outputs), [
    { name: "_9", type: "vec4", location: 0 },
    { name: "_20", type: "vec4", location: 1 },
  ]);
  assert.deepEqual(textureRows(reflection.fragment.textures), [
    { name: "_13", type: "sampler2D", set: 0, binding: 0 },
  ]);
}

function adaptVertex(source) {
  let output = replaceExactlyOnce(
    source,
    /^#version 300 es\s*/,
    [
      "precision highp float;",
      "precision highp int;",
      "",
      "uniform highp mat4 modelViewMatrix;",
      "uniform highp mat4 projectionMatrix;",
      "",
    ].join("\n"),
    "vertex version and engine uniforms",
  );
  output = replaceExactlyOnce(
    output,
    /layout\(std140\) uniform _18_20[\s\S]*?}\s*_20;\s*/,
    "",
    "vertex serialized common UBO",
  );
  output = replaceExactlyOnce(output, "layout(location = 0) in vec4 _11;", "in vec3 position;", "vertex position");
  output = replaceExactlyOnce(output, "layout(location = 1) in vec2 _87;", "in vec2 uv;", "vertex UV0");
  output = replaceExactlyOnce(
    output,
    /void main\(\)\s*\{/,
    [
      "void main()",
      "{",
      "    vec4 _11 = vec4(position, 1.0);",
      "    vec2 _87 = uv;",
      "    mat4 pcrObjectToWorld = mat4(1.0);",
      "    mat4 pcrViewProjection = projectionMatrix * modelViewMatrix;",
    ].join("\n"),
    "vertex entry",
  );
  output = output
    .replaceAll("_20._m0", "pcrObjectToWorld")
    .replaceAll("_20._m1", "pcrViewProjection");
  output = replaceExactlyOnce(
    output,
    /^\s*gl_Position\.y\s*=\s*-gl_Position\.y;\s*$/m,
    "",
    "Unity Vulkan clip-space Y inversion",
  );
  return `${output.trimEnd()}\n`;
}

function adaptFragment(source) {
  const output = replaceExactlyOnce(source, /^#version 300 es\s*/, "", "fragment GLSL version");
  assert.match(output, /_9\s*=\s*texture\(_13,\s*vs_TEXCOORD0\);/);
  assert.match(output, /_20\s*=\s*vec4\(0\.0\);/);
  return `${output.trimEnd()}\n`;
}

function validateWebGlStage(source, stage) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "pcr-logo-opaque-stage-"));
  const file = path.join(temp, `${STEM}.${stage}`);
  try {
    fs.writeFileSync(file, `#version 300 es\n${source}`);
    runCommand(GLSLANG, ["-S", stage, file], { cwd: ROOT });
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

const result = await generateExactSelectorPort({
  shader: SHADER,
  generatedBy: GENERATED_BY,
  extraction: {
    selectorId: SELECTOR_ID,
    candidateWitnessId: CANDIDATE_WITNESS_ID,
    expectedProofGraphSha256: PROOF_GRAPH_SHA256,
    expectedPortIndexSha256: PORT_INDEX_SHA256,
    decryptedRoot: path.resolve(SHADER_ROOT, "..", ".."),
    prefix: STEM,
    rootDir: ROOT,
  },
  output: {
    outDir: OUT,
    vertex: `${STEM}.vert.glsl`,
    fragment: `${STEM}.frag.glsl`,
    manifest: `${STEM}_uniforms.json`,
    check: CHECK,
  },
  expectedSpirvCrossSha256: {
    vertex: "b58c6793bd83439bc7dacfceef7c95e76d417e0359885f1a4dabb93338ebc38c",
    fragment: "d616fe83827d21720d5ef02bf3c09c7749fa2cd495fc6a4a4df552a0da1f94f5",
  },
  spirvCross: SPIRV_CROSS,
  passPolicy: PASS_POLICY,
  validateReflection: assertReflection,
  adaptVertex,
  adaptFragment,
  validateWebGlStage,
  substitutions: {
    vertex: [
      "map official Vertex and UV0 bind channels to Three.js r165 position and uv attributes",
      "compose unity_MatrixVP * unity_ObjectToWorld as projectionMatrix * modelViewMatrix",
      "remove Unity Vulkan clip-space Y inversion for WebGL clip space",
    ],
    fragment: ["remove the #version directive supplied by Three.js RawShaderMaterial"],
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
    fragment: [{ kind: "glsl-version-ownership", owner: "three-raw-shader-material" }],
  },
  webglSources: {
    vertex: `public/shaders/${STEM}.vert.glsl`,
    fragment: `public/shaders/${STEM}.frag.glsl`,
  },
  runtimeContract: {
    schema: "pocket-card-render/webgl-runtime-port@1",
    shader_key: "Opaque",
    attributes: { position: "vec3", uv: "vec2" },
    engine_uniforms: { modelViewMatrix: "mat4", projectionMatrix: "mat4" },
    material_uniforms: { floats: [], ints: [], vectors: {} },
    require_complete_active_bindings: true,
    camera_from_view: false,
    mrt_attachments: 2,
    stencil_normalization: "disable-when-always-keep",
    stencil_face_mode: "generic",
  },
  manifestExtras: {
    mrt: { primary: "_9", secondary: "_20", secondary_value: "zero" },
    runtime_boundaries: [
      {
        status: "runtime-required",
        scope: "guest-pass-material-state",
        payload: ["_ZTest", "_ZWrite"],
        note: "The official pass reads depth state from Material values; guest submission remains runtime evidence.",
      },
      {
        status: "runtime-required",
        scope: "backend-semantic-equivalence",
        note: "The selector-bound SPIR-V and typed WebGL adaptation are hash-bound; Vulkan-to-WebGL instruction semantics are not promoted to exact.",
      },
    ],
  },
});

assert.equal(result.manifest.official_selector.semanticExecutableId, SEMANTIC_EXECUTABLE_ID);
assert.deepEqual(
  result.samplerBindings.map(({ slot, spirvName, binding }) => ({ slot, spirvName, binding })),
  [{ slot: "_MainTex", spirvName: "_13", binding: 0 }],
);
assert.deepEqual(result.manifest.official_pass_runtime.depth, {
  test: { val: 0, name: "_ZTest" },
  write: { val: 0, name: "_ZWrite" },
});
assert.deepEqual(result.manifest.official_pass_runtime.blend, {
  src_rgb: { val: 1, name: null },
  dst_rgb: { val: 0, name: null },
  src_alpha: { val: 0, name: null },
  dst_alpha: { val: 0, name: null },
  op_rgb: { val: 0, name: null },
  op_alpha: { val: 0, name: null },
  color_mask: { val: 15, name: null },
});

console.log(`${CHECK ? "verified" : "generated"} Logo/Opaque from selector-bound official SPIR-V`);
