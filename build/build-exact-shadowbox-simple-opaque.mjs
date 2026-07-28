#!/usr/bin/env node
// Generate ShadowBox/Simple-Opaque from its selector-bound official executable.
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

const SHADER = "Lettuce/Common/CardNew/ShadowBox/Simple-Opaque";
const GENERATED_BY = "build/build-exact-shadowbox-simple-opaque.mjs";
const STEM = "shadowbox_simple_opaque";
const SELECTOR_ID = "47c914ef7efdabdb9ee66f2512db54ba7ce752cb00d43456e15a8c4a6a5558df";
const CANDIDATE_WITNESS_ID =
  "a58a79e446a89bcf89092017069da308a3909d03c6aeaa90ef3f58100ca9dd48";
const EXECUTABLE_ID = "fe3181e55924f40b4746a4227e8202857c4a6fcd4cf74afd47025d4587537eec";
const SEMANTIC_EXECUTABLE_ID =
  "970f836d5616136ee2a74b2a9ba1d3003fffd4a070690b6922a0505acac4d1d1";
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
const PARAMETER_REFLECTION_SHA256 =
  "da85b30ae379847f35fd324147d41a45256bb04d3b9f9424969e619d57b55d68";
const PASS_STATE_SHA256 =
  "735db559230713084370a3d8d55643a588fbcc6a6b68cdd51fd92e6ccce7c44d";
const COMMON_BINDINGS_SHA256 =
  "1ea5db62bfc1fee382e0e55bf588565407763ae0e2a3cb8f1205f1eb6f5de9bd";
const EXPECTED_CROSS_SHA256 = {
  vertex: "b58c6793bd83439bc7dacfceef7c95e76d417e0359885f1a4dabb93338ebc38c",
  fragment: "d616fe83827d21720d5ef02bf3c09c7749fa2cd495fc6a4a4df552a0da1f94f5",
};

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
  if (typeof pattern === "string") {
    const index = source.indexOf(pattern);
    if (index < 0) throw new Error(`${label}: source shape changed`);
    if (source.indexOf(pattern, index + pattern.length) >= 0) {
      throw new Error(`${label}: source shape is ambiguous`);
    }
    return `${source.slice(0, index)}${replacement}${source.slice(index + pattern.length)}`;
  }

  const flags = pattern.flags.replaceAll("g", "");
  const matcher = new RegExp(pattern.source, flags);
  const match = matcher.exec(source);
  if (!match) throw new Error(`${label}: source shape changed`);
  if (new RegExp(pattern.source, flags).test(source.slice(match.index + match[0].length))) {
    throw new Error(`${label}: source shape is ambiguous`);
  }
  return `${source.slice(0, match.index)}${replacement}${source.slice(match.index + match[0].length)}`;
}

function assertReflection(reflection, metadata) {
  assert.deepEqual(metadata.selector, {
    selectorId: SELECTOR_ID,
    candidateWitnessId: CANDIDATE_WITNESS_ID,
    shaderIdentity: "CAB-9bafea9576b11bf9460f39298990d24f:-1926954714643589246",
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
    bundle: "Common/Shader/Common/CardNew/ShadowBox/Card_ShadowBox_SimpleOpaque.shader_bundles",
    bundleSha256: "d703c940200f91b066a3c700ee87558aec4d2b85fe4b60ee41324122d0d90beb",
    shaderObjectSha256: "b8e2dd975edb8f9317bece6489e2db83b373ec079e32fe651888813f6a7b76e8",
    programEntrySha256: "c53cbab6639b5baefbbba234f2d8b33658787246aaeaea4b73261c2156fae6be",
  });

  assert.equal(metadata.artifacts.parameterEntry.byteSize, 64);
  assert.equal(metadata.parameterReflectionSha256, PARAMETER_REFLECTION_SHA256);
  assert.deepEqual(metadata.parameterReflection, {
    version: 202012090,
    constantBlockCount: 2,
    constantBuffers: [
      { name: "", size: 0, fields: [] },
      { name: "VGlobals967447316", size: 128, fields: [] },
    ],
    resourceCount: 0,
    resourceDecoding: "empty-exact",
    textures: [],
    constantBufferBindings: [],
    serializedCommonBuffers: [
      { name: "VGlobals967447316", size: 128 },
    ],
    serializedCommonTextures: [
      { name: "_MainTex", binding: 0, encodedIndex: 134217728, dim: 2 },
    ],
    bindingClosure: {
      constantBuffersMatch: true,
      constantBufferDeclarationMode: "serialized-common",
      commonConstantBufferCount: 1,
      variantConstantBufferCount: 0,
      variantTextureCount: 0,
      commonTextureCount: 1,
      constantBufferBindingCount: 0,
    },
  });
  assert.deepEqual(metadata.shaderPropertyDefaults, {
    textures: {},
    textureDescriptors: {
      _MainTex: { defaultName: "", dimension: 2 },
    },
    floats: { _Stencil: 0 },
    colors: {},
    vectors: {},
  });
  assert.equal(
    metadata.programBindChannels.sha256,
    "ccc10591251e9d01b83158b325111b555db2cc4000115e0b6cd1d39985620be2",
  );
  assert.deepEqual(
    metadata.programBindChannels.bindChannels.map(
      ({ source, sourceName, target, targetName }) => ({
        source, sourceName, target, targetName,
      }),
    ),
    [
      { source: 0, sourceName: "Vertex", target: 13, targetName: "Attrib1" },
      { source: 4, sourceName: "UV0", target: 14, targetName: "Attrib2" },
    ],
  );

  assert.deepEqual(
    reflection.vertex.ubos?.map(({ name, block_size, set, binding }) => ({
      name, block_size, set, binding,
    })),
    [{ name: "_18_20", block_size: 128, set: 1, binding: 0 }],
  );
  const vertexUbo = reflection.vertex.ubos[0];
  assert.deepEqual(
    reflection.vertex.types[vertexUbo.type].members.map(
      ({ name, type, array, offset, array_stride }) => ({
        name, type, array, offset, array_stride,
      }),
    ),
    [
      { name: "_m0", type: "vec4", array: [4], offset: 0, array_stride: 16 },
      { name: "_m1", type: "vec4", array: [4], offset: 64, array_stride: 16 },
    ],
  );
  assert.deepEqual(interfaceRows(reflection.vertex.inputs), [
    { name: "_11", type: "vec4", location: 0 },
    { name: "_87", type: "vec2", location: 1 },
  ]);
  assert.deepEqual(interfaceRows(reflection.vertex.outputs), [
    { name: "vs_TEXCOORD0", type: "vec2", location: 0 },
  ]);
  assert.deepEqual(reflection.fragment.ubos ?? [], []);
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
  output = replaceExactlyOnce(
    output,
    "layout(location = 0) in vec4 _11;",
    "in vec3 position;",
    "vertex position input",
  );
  output = replaceExactlyOnce(
    output,
    "layout(location = 1) in vec2 _87;",
    "in vec2 uv;",
    "vertex UV0 input",
  );
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
  if (
    /layout\(std140\)|_20\._m|layout\(location\s*=\s*\d+\)\s+in\b|gl_Position\.y\s*=\s*-gl_Position\.y/
      .test(output)
  ) {
    throw new Error("ShadowBox/Simple-Opaque vertex adaptation is incomplete");
  }
  return `${output.trimEnd()}\n`;
}

function adaptFragment(source) {
  const output = replaceExactlyOnce(
    source,
    /^#version 300 es\s*/,
    "",
    "fragment GLSL version",
  );
  assert.match(output, /_9\s*=\s*texture\(_13,\s*vs_TEXCOORD0\);/);
  assert.match(output, /_20\s*=\s*vec4\(0\.0\);/);
  return `${output.trimEnd()}\n`;
}

function validateWebGlStage(source, stage) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "pcr-shadowbox-simple-opaque-stage-"));
  const file = path.join(temp, `${STEM}.${stage}`);
  try {
    fs.writeFileSync(file, `#version 300 es\n${source}`);
    runCommand(GLSLANG, ["-S", stage, file], { cwd: ROOT });
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

function validateLinkedProgram(vertex, fragment) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "pcr-shadowbox-simple-opaque-link-"));
  const vertexFile = path.join(temp, `${STEM}.vert`);
  const fragmentFile = path.join(temp, `${STEM}.frag`);
  try {
    fs.writeFileSync(vertexFile, `#version 300 es\n${vertex}`);
    fs.writeFileSync(fragmentFile, `#version 300 es\n${fragment}`);
    runCommand(GLSLANG, ["-l", vertexFile, fragmentFile], { cwd: ROOT });
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

let linkedVertex = null;
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
  expectedSpirvCrossSha256: EXPECTED_CROSS_SHA256,
  spirvCross: SPIRV_CROSS,
  passPolicy: PASS_POLICY,
  validateReflection: assertReflection,
  adaptVertex(source) {
    linkedVertex = adaptVertex(source);
    return linkedVertex;
  },
  adaptFragment(source) {
    const fragment = adaptFragment(source);
    if (linkedVertex === null) {
      throw new Error("ShadowBox/Simple-Opaque adapted vertex source is unavailable");
    }
    validateLinkedProgram(linkedVertex, fragment);
    return fragment;
  },
  validateWebGlStage,
  substitutions: {
    vertex: [
      "map official Vertex and UV0 bind channels to Three.js r165 position and uv attributes",
      "algebraically compose unity_MatrixVP * unity_ObjectToWorld as projectionMatrix * modelViewMatrix",
      "remove Unity Vulkan clip-space Y inversion for WebGL clip space",
    ],
    fragment: [
      "remove the #version directive supplied by Three.js RawShaderMaterial",
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
      { kind: "glsl-version-ownership", owner: "three-raw-shader-material" },
    ],
  },
  webglSources: {
    vertex: `public/shaders/${STEM}.vert.glsl`,
    fragment: `public/shaders/${STEM}.frag.glsl`,
  },
  runtimeContract: {
    schema: "pocket-card-render/webgl-runtime-port@1",
    shader_key: "Simple-Opaque",
    attributes: { position: "vec3", uv: "vec2" },
    engine_uniforms: {
      modelViewMatrix: "mat4",
      projectionMatrix: "mat4",
    },
    material_uniforms: { floats: [], ints: [], vectors: {} },
    require_complete_active_bindings: true,
    camera_from_view: false,
    mrt_attachments: 2,
    stencil_normalization: "none",
    stencil_face_mode: "generic",
  },
  manifestExtras: {
    mrt: { primary: "_9", secondary: "_20", secondary_value: "zero" },
    runtime_boundaries: [
      {
        status: "runtime-required",
        scope: "guest-pass-material-state",
        payload: ["_Stencil"],
        note: "The official pass binds its stencil read mask to _Stencil. This source generator records the serialized default but does not claim the value submitted by any guest draw.",
      },
      {
        status: "runtime-required",
        scope: "guest-runtime-dispatch",
        note: "Guest descriptor objects, attachments, submitted vertex bindings, and draw dispatch remain runtime evidence.",
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
assert.deepEqual(result.manifest.selected_keywords, []);
assert.deepEqual(
  result.samplerBindings.map(({ slot, spirvName, binding }) => ({
    slot, spirvName, binding,
  })),
  [{ slot: "_MainTex", spirvName: "_13", binding: 0 }],
);
assert.equal(result.manifest.official_pass_runtime.source_sha256, PASS_STATE_SHA256);
assert.deepEqual(result.manifest.official_pass_runtime.depth, {
  test: { val: 4, name: null },
  write: { val: 1, name: null },
});
assert.deepEqual(result.manifest.official_pass_runtime.stencil, {
  ref: { val: 7, name: null },
  read_mask: { val: 0, name: "_Stencil" },
  write_mask: { val: 4, name: null },
  generic: {
    pass: { val: 2, name: null },
    fail: { val: 0, name: null },
    zFail: { val: 0, name: null },
    comp: { val: 3, name: null },
  },
  front: {
    pass: { val: 0, name: null },
    fail: { val: 0, name: null },
    zFail: { val: 0, name: null },
    comp: { val: 8, name: null },
  },
  back: {
    pass: { val: 0, name: null },
    fail: { val: 0, name: null },
    zFail: { val: 0, name: null },
    comp: { val: 8, name: null },
  },
});

console.log(
  `${CHECK ? "verified" : "generated"} ShadowBox/Simple-Opaque from selector-bound official SPIR-V`,
);
