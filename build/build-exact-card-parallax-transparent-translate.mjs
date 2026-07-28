#!/usr/bin/env node
// Generate Card_Parallax_Transparent_Translate from selector-bound official Unity bytes.
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
const OUT = path.join(ROOT, "public", "shaders");
const CHECK = process.argv.includes("--check") || process.env.PCR_EXACT_CHECK === "1";

const SELECTOR_ID = "b64f842cf9933438d2646de74af54cf71a7f49c6c180f66ed733c006f8b523b5";
const CANDIDATE_WITNESS_ID =
  "08eabc1672f42c34f85bae29323d59d65b172dc8186063193ccd821b2c938395";
const SEMANTIC_EXECUTABLE_ID =
  "a6b75385a6749f05bf83ba714f5ceebaa19846d42212b5153a70cb17d9a47207";
const PROOF_GRAPH_SHA256 =
  "307ed3660e5d3b1bfd8cf9e6b3d64e44937af215da3b6ed84ead198800eeadc4";
const PORT_INDEX_SHA256 =
  "15095f34b9e75515bbcc3924f6f8b2abb826ba96b48e819ec911486bcfa6f5a9";
const PARAMETER_REFLECTION_SHA256 =
  "b56f4a5f2a1d8dc9c1205fd7f418e7943d83e6aebcd4ef4391d345650bcb2c4e";
const OFFICIAL_CROSS_SHA256 = {
  vertex: "5f3a5a7d804c6795a9fe2e9abdeef964a30c597ddff448077d1f7735231eef1d",
  fragment: "915ad697bfb97de7b9e91dafb7f36e91b1e25f38a433dbd3b3bf3e24f3739db1",
};
const OFFICIAL_IDENTITY = {
  vertexSpirvSha256: "e463cb3303188c28f0b06c93903aeae5b6606e6f27ea661de8620a832afdfb4e",
  fragmentSpirvSha256: "3d0d58201d50731411d17f33db71105eafacc647e6367d2d649b98bdeaf50c51",
  parameterEntrySha256: "1df774d94d59f148504add37e9525adaca7a6ebf1ee29183e6a91a12a51ba925",
  passStateSha256: "3838ed1b8693ef104adc9873e5ed87730a8cfee57b31d8b323d47c6ea34e0d24",
  commonBindingsSha256: "c841876943717b6c8cb2845283a9b8fdd0e0d67ece9e75837511f9cd64a4eb19",
};
const MSR_PRODUCER =
  "pocket-card-render/card-msr-object-arm64-state-port@1";
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
const FRAGMENT_BASIS_CONVERSIONS = Object.freeze({
  objectMatrices: [],
  worldVectors: [{
    source: "vs_TEXCOORD1",
    alias: "pcrUnityWorldNormal",
    expectedOccurrences: 1,
  }],
  viewForwards: [{
    matrixName: "viewMatrix",
    targetName: "_9",
  }],
});

function interfaceRows(items = []) {
  return items.map(({ name, type, location }) => ({ name, type, location }))
    .sort((left, right) => left.location - right.location);
}

function resourceRows(items = []) {
  return items.map(({ name, type, set, binding, block_size }) => ({
    name,
    ...(type ? { type } : {}),
    ...(block_size !== undefined ? { block_size } : {}),
    set,
    binding,
  })).sort((left, right) => left.binding - right.binding);
}

function memberRows(reflection, uboName) {
  const ubo = reflection.ubos?.find((item) => item.name === uboName);
  assert.ok(ubo, `${uboName}: UBO is absent`);
  return {
    ubo,
    members: (reflection.types?.[ubo.type]?.members || []).map(
      ({ name, type, offset, array }) => ({
        name,
        type,
        offset,
        ...(array ? { array } : {}),
      }),
    ),
  };
}

function assertReflection(reflection, metadata) {
  assert.deepEqual(metadata.selector.keywords, []);
  assert.equal(metadata.selector.selectionMode, "unique-exact-keywords");
  assert.equal(metadata.selector.semanticExecutableId, SEMANTIC_EXECUTABLE_ID);
  assert.deepEqual(metadata.identityFields, OFFICIAL_IDENTITY);
  assert.equal(metadata.parameterReflectionSha256, PARAMETER_REFLECTION_SHA256);
  assert.equal(metadata.artifacts.parameterEntry.byteSize, 100);

  const vertex = memberRows(reflection.vertex, "_22_24");
  assert.deepEqual(
    { block_size: vertex.ubo.block_size, set: vertex.ubo.set, binding: vertex.ubo.binding },
    { block_size: 252, set: 1, binding: 1 },
  );
  assert.deepEqual(vertex.members, [
    { name: "_m0", type: "vec3", offset: 0 },
    { name: "_m1", type: "vec4", offset: 16, array: [4] },
    { name: "_m2", type: "vec4", offset: 80, array: [4] },
    { name: "_m3", type: "vec4", offset: 144, array: [4] },
    { name: "_m4", type: "float", offset: 208 },
    { name: "_m5", type: "float", offset: 212 },
    { name: "_m6", type: "float", offset: 216 },
    { name: "_m7", type: "float", offset: 220 },
    { name: "_m8", type: "ivec2", offset: 224 },
    { name: "_m9", type: "ivec2", offset: 232 },
    { name: "_m10", type: "float", offset: 240 },
    { name: "_m11", type: "float", offset: 244 },
    { name: "_m12", type: "float", offset: 248 },
  ]);
  assert.deepEqual(interfaceRows(reflection.vertex.inputs), [
    { name: "_11", type: "vec4", location: 0 },
    { name: "_87", type: "vec3", location: 1 },
    { name: "_107", type: "vec4", location: 2 },
  ]);
  assert.deepEqual(interfaceRows(reflection.vertex.outputs), [
    { name: "vs_TEXCOORD0", type: "vec2", location: 0 },
    { name: "vs_TEXCOORD1", type: "vec3", location: 1 },
  ]);

  const fragment = memberRows(reflection.fragment, "_14_16");
  assert.deepEqual(
    { block_size: fragment.ubo.block_size, set: fragment.ubo.set, binding: fragment.ubo.binding },
    { block_size: 92, set: 1, binding: 0 },
  );
  assert.deepEqual(fragment.members, [
    { name: "_m0", type: "vec4", offset: 0, array: [4] },
    { name: "_m1", type: "float", offset: 64 },
    { name: "_m2", type: "float", offset: 68 },
    { name: "_m3", type: "float", offset: 72 },
    { name: "_m4", type: "float", offset: 76 },
    { name: "_m5", type: "float", offset: 80 },
    { name: "_m6", type: "float", offset: 84 },
    { name: "_m7", type: "float", offset: 88 },
  ]);
  assert.deepEqual(interfaceRows(reflection.fragment.inputs), [
    { name: "vs_TEXCOORD0", type: "vec2", location: 0 },
    { name: "vs_TEXCOORD1", type: "vec3", location: 1 },
  ]);
  assert.deepEqual(interfaceRows(reflection.fragment.outputs), [
    { name: "_258", type: "vec4", location: 0 },
    { name: "_273", type: "vec4", location: 1 },
  ]);
  assert.deepEqual(resourceRows(reflection.fragment.textures), [
    { name: "_233", type: "sampler2D", set: 0, binding: 0 },
    { name: "_90", type: "sampler2D", set: 0, binding: 1 },
    { name: "_160", type: "sampler2D", set: 0, binding: 2 },
    { name: "_219", type: "sampler2D", set: 0, binding: 3 },
  ]);
}

function replaceUbo(source, block, owner, declarations) {
  const pattern = new RegExp(`layout\\(std140\\) uniform ${block}[\\s\\S]*?}\\s*${owner};\\s*`);
  const output = source.replace(pattern, `${declarations.join("\n")}\n\n`);
  if (output === source) throw new Error(`${block}: UBO replacement failed`);
  return output;
}

function replaceAllExact(source, before, after, count, label) {
  const escaped = before.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`${escaped}(?![0-9])`, "g");
  const actual = (source.match(pattern) || []).length;
  assert.equal(actual, count, `${label}: occurrence count changed`);
  return source.replace(pattern, after);
}

function adaptVertex(source) {
  let output = source.replace(
    /^#version 300 es\s*/m,
    "precision highp float;\nprecision highp int;\n\n",
  );
  output = replaceUbo(output, "_22_24", "_24", [
    "uniform highp vec3 cameraPosition;",
    "uniform highp mat4 modelMatrix;",
    "uniform highp mat4 viewMatrix;",
    "uniform highp mat4 projectionMatrix;",
    "uniform mediump float _FakeCameraHeight;",
    "uniform mediump float _Height;",
    "uniform mediump float _HeightPower;",
    "uniform mediump float _Scale;",
    "uniform highp vec2 _PixelOffset;",
    "uniform highp vec2 _CanvasPixel;",
    "uniform highp float _TranslateDir;",
    "uniform highp float _TranslateDist;",
    "uniform highp float _Translate;",
  ]);
  output = output
    .replace("layout(location = 0) in vec4 _11;", "in vec3 position;")
    .replace("layout(location = 1) in vec3 _87;", "in vec3 normal;")
    .replace("layout(location = 2) in mediump vec4 _107;", "in vec4 tangent;")
    .replace(/void main\(\)\s*\{/, `void main()
{
    vec4 _11 = vec4(position, 1.0);
    vec3 _87 = normal;
    vec4 _107 = tangent;
    mat4 _ObjectToWorld = modelMatrix;
    mat4 _WorldToObject = inverse(modelMatrix);
    mat4 _ViewProjection = projectionMatrix * viewMatrix;`);
  const replacements = [
    ["_24._m0", "cameraPosition", 3, "camera position"],
    ["_24._m1", "_ObjectToWorld", 4, "object-to-world"],
    ["_24._m2", "_WorldToObject", 7, "world-to-object"],
    ["_24._m3", "_ViewProjection", 4, "view-projection"],
    ["_24._m4", "_FakeCameraHeight", 1, "_FakeCameraHeight"],
    ["_24._m5", "_Height", 1, "_Height"],
    ["_24._m6", "_HeightPower", 2, "_HeightPower"],
    ["_24._m7", "_Scale", 2, "_Scale"],
    ["_24._m8", "_PixelOffset", 2, "_PixelOffset"],
    ["_24._m9", "_CanvasPixel", 2, "_CanvasPixel"],
    ["_24._m10", "_TranslateDir", 1, "_TranslateDir"],
    ["_24._m11", "_TranslateDist", 2, "_TranslateDist"],
    ["_24._m12", "_Translate", 2, "_Translate"],
  ];
  for (const replacement of replacements) output = replaceAllExact(output, ...replacement);
  output = output.replace(/^\s*gl_Position\.y\s*=\s*-gl_Position\.y;\s*$/m, "");
  if (/_24\._m|layout\(std140\)|layout\(location\s*=\s*\d+\)\s+in|gl_Position\.y\s*=/.test(output)) {
    throw new Error("Card_Parallax_Transparent_Translate vertex adaptation is incomplete");
  }
  return `${output.trimEnd()}\n`;
}

function adaptFragment(source) {
  let output = source.replace(/^#version 300 es\s*/m, "");
  output = replaceUbo(output, "_14_16", "_16", [
    "uniform highp mat4 viewMatrix;",
    "uniform highp float _Transparency;",
    "uniform float _DiffractionIntensity;",
    "uniform float _DiffractionPower;",
    "uniform float _RampRepeat;",
    "uniform float _RampSpeed;",
    "uniform float _RampOffset;",
    "uniform float _RampInterval;",
  ]);
  const replacements = [
    ["_16._m0", "viewMatrix", 3, "view matrix"],
    ["_16._m1", "_Transparency", 1, "_Transparency"],
    ["_16._m2", "_DiffractionIntensity", 1, "_DiffractionIntensity"],
    ["_16._m3", "_DiffractionPower", 2, "_DiffractionPower"],
    ["_16._m4", "_RampRepeat", 1, "_RampRepeat"],
    ["_16._m5", "_RampSpeed", 3, "_RampSpeed"],
    ["_16._m6", "_RampOffset", 1, "_RampOffset"],
    ["_16._m7", "_RampInterval", 2, "_RampInterval"],
  ];
  for (const replacement of replacements) output = replaceAllExact(output, ...replacement);
  output = adaptThreeViewForwardToUnityDataAxes(output, {
    matrixName: "viewMatrix",
    targetName: "_9",
  });
  output = adaptThreeWorldVectorsToUnityDataAxes(output, {
    bindings: FRAGMENT_BASIS_CONVERSIONS.worldVectors,
  });
  if (/_16\._m|layout\(std140\)/.test(output)) {
    throw new Error("Card_Parallax_Transparent_Translate fragment adaptation is incomplete");
  }
  return `${output.trimEnd()}\n`;
}

function validateStage(source, stage) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "pcr-parallax-translate-stage-"));
  const file = path.join(temp, `card_parallax_transparent_translate.${stage}`);
  try {
    fs.writeFileSync(file, `#version 300 es\n${source}`);
    runCommand(GLSLANG, ["-S", stage, file], { cwd: ROOT });
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

let linkedVertex = null;
const result = await generateExactSelectorPort({
  shader: "Lettuce/Common/CardNew/Face/Card_Parallax_Transparent_Translate",
  generatedBy: "build/build-exact-card-parallax-transparent-translate.mjs",
  extraction: {
    selectorId: SELECTOR_ID,
    candidateWitnessId: CANDIDATE_WITNESS_ID,
    expectedProofGraphSha256: PROOF_GRAPH_SHA256,
    expectedPortIndexSha256: PORT_INDEX_SHA256,
    decryptedRoot: path.resolve(SHADER_ROOT, "..", ".."),
    prefix: "card_parallax_transparent_translate",
    rootDir: ROOT,
    spirvCross: SPIRV_CROSS,
  },
  expectedSpirvCrossSha256: OFFICIAL_CROSS_SHA256,
  validateReflection: assertReflection,
  adaptVertex(source) {
    linkedVertex = adaptVertex(source);
    return linkedVertex;
  },
  adaptFragment(source) {
    const fragment = adaptFragment(source);
    assert.ok(linkedVertex, "adapted vertex source is unavailable");
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), "pcr-parallax-translate-link-"));
    try {
      const vertexFile = path.join(temp, "port.vert");
      const fragmentFile = path.join(temp, "port.frag");
      fs.writeFileSync(vertexFile, `#version 300 es\n${linkedVertex}`);
      fs.writeFileSync(fragmentFile, `#version 300 es\n${fragment}`);
      runCommand(GLSLANG, ["-l", vertexFile, fragmentFile], { cwd: ROOT });
    } finally {
      fs.rmSync(temp, { recursive: true, force: true });
    }
    return fragment;
  },
  validateWebGlStage: validateStage,
  joinConstantBufferStages: true,
  passPolicy: PASS_POLICY,
  runtimeContract: {
    schema: "pocket-card-render/webgl-runtime-port@1",
    shader_key: "Card_Parallax_Transparent_Translate",
    attributes: { position: "vec3", normal: "vec3", tangent: "vec4" },
    engine_uniforms: {
      modelMatrix: "mat4",
      viewMatrix: "mat4",
      projectionMatrix: "mat4",
      cameraPosition: "vec3",
    },
    material_uniforms: {
      floats: [
        "_FakeCameraHeight",
        "_Height",
        "_HeightPower",
        "_Scale",
        "_TranslateDir",
        "_TranslateDist",
        "_DiffractionIntensity",
        "_DiffractionPower",
        "_RampRepeat",
        "_RampSpeed",
        "_RampOffset",
        "_RampInterval",
      ],
      ints: [],
      vectors: {
        _PixelOffset: "vec2",
        _CanvasPixel: "vec2",
      },
    },
    dynamic_uniforms: {
      _Translate: { type: "float", source: MSR_PRODUCER },
      _Transparency: { type: "float", source: MSR_PRODUCER },
    },
    require_complete_active_bindings: true,
    camera_from_view: true,
    mrt_attachments: 2,
    stencil_normalization: "none",
    stencil_face_mode: "generic",
    backend_basis_conversions: {
      fragment: FRAGMENT_BASIS_CONVERSIONS,
    },
  },
  substitutions: {
    vertex: [
      "map official Vertex/Normal/Tangent channels to Three.js r165 position/normal/tangent",
      "map Unity object/world/view-projection matrices and camera position to Three.js engine uniforms",
      "flatten serialized-common VGlobals while preserving official SSA arithmetic and record the two integer-vector transport substitutions separately",
      "transport integer-valued _PixelOffset/_CanvasPixel Shader vectors as WebGL vec2 uniforms and retain the official ivec4 conversion at the use site",
      "bind component-driven _Translate through the serialized CardMSRObject parallax renderer role",
      "remove Unity Vulkan clip-space Y inversion for WebGL clip space",
    ],
    fragment: [
      "flatten serialized-common PGlobals to same-name typed WebGL uniforms",
      "convert Three world-normal and view-forward values back to Unity data axes before official diffraction arithmetic",
      "bind component-driven _Transparency through the serialized CardMSRObject parallax renderer role",
    ],
  },
  adaptationOperations: {
    vertex: [
      { kind: "vertex-input-binding", contract: "official-bind-channels-to-three-r165" },
      { kind: "engine-uniform-binding", contract: "unity-builtins-to-three-r165" },
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
      { kind: "engine-uniform-binding", contract: "unity-builtins-to-three-r165" },
      {
        kind: "uniform-buffer-flattening",
        source: "serialized-common",
        preservation: "names-types-precision",
      },
      { kind: "object-basis-conversion", contract: "unity-to-three-basis" },
      {
        kind: "dynamic-uniform-producer-binding",
        contract: "runtime-producer-to-three-uniforms",
      },
      { kind: "glsl-version-ownership", owner: "three-raw-shader-material" },
    ],
  },
  webglSources: {
    vertex: "public/shaders/card_parallax_transparent_translate.vert.glsl",
    fragment: "public/shaders/card_parallax_transparent_translate.frag.glsl",
  },
  manifestExtras: {
    mrt: {
      primary: "_258",
      emissive: "_273",
      secondary_value: "zero",
    },
    backend_numeric_transport: {
      status: "source-hash-bound",
      note: "The official SPIR-V/common-binding types are asserted exactly. Typed v2 does not claim a names-types-precision-preserving vertex UBO flatten because the WebGL material transport exposes Shader Vector values as vec2.",
      _PixelOffset: {
        official_spirv_type: "ivec2",
        webgl_uniform_type: "vec2",
        conversion: "official ivec4 constructor at the sole use site",
      },
      _CanvasPixel: {
        official_spirv_type: "ivec2",
        webgl_uniform_type: "vec2",
        conversion: "official ivec4 constructor at the sole use site",
      },
    },
    runtime_boundaries: [{
      status: "runtime-required",
      scope: "component-uniform-producer",
      producer: MSR_PRODUCER,
      il2cpp_evidence: {
        type: "Lettuce.Infrastructure.Card.Core.CardMSRObject",
        methods: ["UpdateTranslateLayer", "UpdateAnimation", "ApplyParams"],
        fields: ["_parallaxTransparency", "_parallaxTranslate"],
        settings: [
          "MSRAnimationSettings.ParallaxTransparency",
          "MSRAnimationSettings.ParallaxTranslate",
          "MSRAnimationSettings.ParallaxAppearTransparency",
          "MSRAnimationSettings.ParallaxAppearTranslate",
          "MSRAnimationSettings.ParallaxDisappearTransparency",
          "MSRAnimationSettings.ParallaxDisappearTranslate",
        ],
      },
      payload: ["_Translate", "_Transparency"],
      note: "The ARM64 producer algorithm, serialized component fields, animation curves, and SearchTag renderer binding are locally ported. Unity LateUpdate scheduling and official guest MaterialPropertyBlock submission remain runtime-required.",
    }],
  },
  output: {
    outDir: OUT,
    vertex: "card_parallax_transparent_translate.vert.glsl",
    fragment: "card_parallax_transparent_translate.frag.glsl",
    manifest: "card_parallax_transparent_translate_uniforms.json",
    check: CHECK,
  },
});

assert.deepEqual(
  result.samplerBindings.map(({ slot, spirvName, binding }) => ({ slot, spirvName, binding })),
  [
    { slot: "_MainTex", spirvName: "_233", binding: 0 },
    { slot: "_PhaseTex", spirvName: "_90", binding: 1 },
    { slot: "_RampMaskTex", spirvName: "_160", binding: 2 },
    { slot: "_RampTex", spirvName: "_219", binding: 3 },
  ],
);
console.log(
  `${CHECK ? "verified" : "generated"} Card_Parallax_Transparent_Translate from selector-bound official SPIR-V`,
);
