#!/usr/bin/env node
// Generate the Future and Strata paradox backgrounds from selector-bound official SPIR-V.
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
const GENERATED_BY = "build/build-exact-paradox-backgrounds.mjs";
const PROOF_GRAPH_SHA256 =
  "307ed3660e5d3b1bfd8cf9e6b3d64e44937af215da3b6ed84ead198800eeadc4";
const PORT_INDEX_SHA256 =
  "15095f34b9e75515bbcc3924f6f8b2abb826ba96b48e819ec911486bcfa6f5a9";
const FUTURE_PRODUCER =
  "pocket-card-render/card-future-object-arm64-port@1";
const STRATA_PRODUCER =
  "pocket-card-render/card-ancient-object-arm64-state-port@1";

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

const PORTS = [
  {
    id: "future",
    stem: "card_parallax_future",
    shader: "Lettuce/Common/CardNew/Face/Card_Parallax_Future",
    shaderKey: "Card_Parallax_Future",
    selectorId: "cad05315c5090f5875de36d0ecb30eb5e7976e4ef960ad4d388fe3b8c8267d7d",
    candidateWitnessId:
      "42946e126fc5a6a2f47c21ec375f4d8fdc1e27b6473e94815c096a102c0d86b6",
    semanticExecutableId:
      "f5972ffd304a74c418b8751a98a5e2f8e960c38e830c1811bae734170342ff50",
    identityFields: {
      vertexSpirvSha256:
        "ae9304b7d3bbcdd2fac3ab90f99802a2cae016a27eb90a1c57e89eadb28fdb8d",
      fragmentSpirvSha256:
        "68906794c78676370f95028f96aacfd898cf24950415159d1afb0274abe01c71",
      parameterEntrySha256:
        "6505605960fb42a7864a9df1e0692d0a152332b56410084e80f506e0ad61bbcf",
      passStateSha256:
        "fa01f05f5a5aea83254e4fd7f5c8e3a973f70f66b9722d268959b218f7521d40",
      commonBindingsSha256:
        "b81e2c5093849b4b70c0d4bbe6042b6444eac35298e0afd5f6095c42c96b9d72",
    },
    parameterReflectionSha256:
      "a51bfd34fa25f47667ed2326965301b6ead446cb4db04908a6cacfd725cb0af1",
    crossSha256: {
      vertex: "aa7363a93683589c9b49f1462b1998c7eeafdbc7926dfbe1725630dbc13f1f79",
      fragment: "ffee97c17cdfde39d59ba203687e943dc7557a5678d0f7828b95104010dba982",
    },
    attributes: { position: "vec3", uv: "vec2" },
    materialUniforms: {
      floats: [
        "_Color1Threshold",
        "_Color2Threshold",
        "_Color3Threshold",
        "_CrossFilterEmissiveIntensity",
        "_CrossFilterIntensity",
        "_CrossFilterPrimScale",
        "_CrossFilterUVScale",
        "_EmissiveIntensity",
        "_SwitchFade",
        "_ZOffset",
      ],
      ints: ["_CellAnimFrameCount", "_CellCount"],
      vectors: {
        _BaseColor: "vec4",
        _EmitColor1: "vec4",
        _EmitColor2: "vec4",
        _EmitColor3: "vec4",
        _OffColor: "vec4",
        _OnColor1: "vec4",
        _OnColor2: "vec4",
        _OnColor3: "vec4",
      },
    },
    dynamicUniforms: {
      _AnimFrame: { type: "float", source: FUTURE_PRODUCER },
    },
    producer: FUTURE_PRODUCER,
    producerPayload: ["_AnimFrame"],
    samplerBindings: [
      { slot: "_CellAnimTex", spirvName: "_76", binding: 0 },
      { slot: "_MainTex", spirvName: "_145", binding: 1 },
      { slot: "_CrossFilterTex", spirvName: "_449", binding: 2 },
    ],
  },
  {
    id: "strata",
    stem: "card_parallax_strata",
    shader: "Lettuce/Common/CardNew/Face/Card_Parallax_Strata",
    shaderKey: "Card_Parallax_Strata",
    selectorId: "f972087746bf2b351267b5816d259f913b2fb9fa050ad41e11979f4cdcbea51e",
    candidateWitnessId:
      "b2f8255598bd7048899929089cc4915fafe3ebf5b3cc9be498a57be7df44f7e8",
    semanticExecutableId:
      "adb07da1684bb71699ec7eb8a0f477f1508ad2812078c246cbcf71546463b0be",
    identityFields: {
      vertexSpirvSha256:
        "6724e914aab718d260794a7048413003b7b7a8762f872abb3813f01d360c01a7",
      fragmentSpirvSha256:
        "7dfb9a00ff89cb00e1d2d736586883a99e66c56bc530ed27e81f6a4ede126569",
      parameterEntrySha256:
        "b85bfd905accd3d4a80832321ddf8c202e8c09de2ae00f3cfa157876b781285f",
      passStateSha256:
        "1de71cc57b66e94959129289c8c12b34cf42b23838f99ae658cfc73969f588fc",
      commonBindingsSha256:
        "c54165d0088ee85e1be4e38f19170af7d9c23a8a95b25293057e9a7b9eacdc51",
    },
    parameterReflectionSha256:
      "4b24f9d0e35b347205a8837693e0342c0b3b6b7136db40957f10ee8f894e0759",
    crossSha256: {
      vertex: "661e3d959ace2749e3425ff2b1a63b90b81afcc9de859166d76490080fca9345",
      fragment: "ed2392daad851cd6728b7f5e0746c8ddf58240e5c30edef05611e037d5545d8d",
    },
    attributes: { position: "vec3", uv: "vec2", uv1: "vec2" },
    materialUniforms: {
      floats: [
        "_ClackNoiseScale",
        "_ClackPow",
        "_ClackY1",
        "_ClackY2",
        "_ClackY3",
        "_ClackY4",
        "_ClackY5",
        "_ZOffset",
      ],
      ints: ["_LayerNum"],
      vectors: { _CrackColor: "vec3" },
    },
    dynamicUniforms: {
      _Shake: { type: "vec2", source: STRATA_PRODUCER },
      _StrataFaults: { type: "float[6]", source: STRATA_PRODUCER },
    },
    producer: STRATA_PRODUCER,
    producerPayload: ["_Shake", "_StrataFaults"],
    samplerBindings: [
      { slot: "_MainTex", spirvName: "_679", binding: 0 },
    ],
  },
];

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

function assertCommonMetadata(metadata, port) {
  assert.equal(metadata.selector.shaderName, port.shader, `${port.id}: shader`);
  assert.deepEqual(metadata.selector.keywords, [], `${port.id}: keywords`);
  assert.equal(metadata.selector.selectionMode, "unique-exact-keywords",
    `${port.id}: selection mode`);
  assert.equal(metadata.selector.semanticExecutableId, port.semanticExecutableId,
    `${port.id}: semantic executable`);
  assert.deepEqual(metadata.identityFields, port.identityFields, `${port.id}: identity`);
  assert.equal(metadata.artifacts.parameterEntry.byteSize, 100,
    `${port.id}: parameter entry size`);
  assert.equal(metadata.parameterReflectionSha256, port.parameterReflectionSha256,
    `${port.id}: parameter reflection`);
  assert.equal(metadata.parameterReflection.version, 202012090,
    `${port.id}: parameter format`);
  assert.equal(metadata.parameterReflection.constantBlockCount, 3,
    `${port.id}: parameter block count`);
  assert.equal(metadata.parameterReflection.resourceCount, 0,
    `${port.id}: parameter resource count`);
}

function assertFutureReflection(reflection, metadata, port) {
  assertCommonMetadata(metadata, port);
  assert.deepEqual(
    metadata.parameterReflection.constantBuffers.map(({ name, size }) => ({ name, size })),
    [
      { name: "", size: 0 },
      { name: "PGlobals2759072706", size: 180 },
      { name: "VGlobals2759072706", size: 140 },
    ],
    "future: serialized common buffers",
  );
  assert.equal(Object.hasOwn(metadata.shaderPropertyDefaults.floats, "_AnimFrame"), false,
    "future: _AnimFrame must remain outside Material defaults");

  const vertex = memberRows(reflection.vertex, "_18_20");
  assert.deepEqual(
    { block_size: vertex.ubo.block_size, set: vertex.ubo.set, binding: vertex.ubo.binding },
    { block_size: 140, set: 1, binding: 1 },
  );
  assert.deepEqual(vertex.members, [
    { name: "_m0", type: "vec4", offset: 0, array: [4] },
    { name: "_m1", type: "vec4", offset: 64, array: [4] },
    { name: "_m2", type: "float", offset: 128 },
    { name: "_m3", type: "float", offset: 132 },
    { name: "_m4", type: "float", offset: 136 },
  ]);
  assert.deepEqual(interfaceRows(reflection.vertex.inputs), [
    { name: "_11", type: "vec4", location: 0 },
    { name: "_97", type: "vec2", location: 1 },
  ]);
  assert.deepEqual(interfaceRows(reflection.vertex.outputs), [
    { name: "vs_TEXCOORD0", type: "vec4", location: 0 },
    { name: "vs_TEXCOORD1", type: "uint", location: 1 },
  ]);

  const fragment = memberRows(reflection.fragment, "_31_33");
  assert.deepEqual(
    { block_size: fragment.ubo.block_size, set: fragment.ubo.set, binding: fragment.ubo.binding },
    { block_size: 180, set: 1, binding: 0 },
  );
  assert.deepEqual(fragment.members, [
    { name: "_m0", type: "float", offset: 0 },
    { name: "_m1", type: "int", offset: 4 },
    { name: "_m2", type: "int", offset: 8 },
    { name: "_m3", type: "float", offset: 12 },
    { name: "_m4", type: "float", offset: 16 },
    { name: "_m5", type: "vec4", offset: 32 },
    { name: "_m6", type: "vec4", offset: 48 },
    { name: "_m7", type: "vec4", offset: 64 },
    { name: "_m8", type: "vec4", offset: 80 },
    { name: "_m9", type: "vec4", offset: 96 },
    { name: "_m10", type: "vec4", offset: 112 },
    { name: "_m11", type: "vec4", offset: 128 },
    { name: "_m12", type: "vec4", offset: 144 },
    { name: "_m13", type: "float", offset: 160 },
    { name: "_m14", type: "float", offset: 164 },
    { name: "_m15", type: "float", offset: 168 },
    { name: "_m16", type: "float", offset: 172 },
    { name: "_m17", type: "float", offset: 176 },
  ]);
  assert.deepEqual(interfaceRows(reflection.fragment.inputs), [
    { name: "vs_TEXCOORD0", type: "vec4", location: 0 },
    { name: "vs_TEXCOORD1", type: "uint", location: 1 },
  ]);
  assert.deepEqual(interfaceRows(reflection.fragment.outputs), [
    { name: "_510", type: "vec4", location: 0 },
    { name: "_529", type: "vec4", location: 1 },
  ]);
  assert.deepEqual(resourceRows(reflection.fragment.textures), [
    { name: "_76", type: "sampler2D", set: 0, binding: 0 },
    { name: "_145", type: "sampler2D", set: 0, binding: 1 },
    { name: "_449", type: "sampler2D", set: 0, binding: 2 },
  ]);
}

function assertStrataReflection(reflection, metadata, port) {
  assertCommonMetadata(metadata, port);
  assert.deepEqual(
    metadata.parameterReflection.constantBuffers.map(({ name, size }) => ({ name, size })),
    [
      { name: "", size: 0 },
      { name: "PGlobals506163068", size: 40 },
      { name: "VGlobals506163068", size: 240 },
    ],
    "strata: serialized common buffers",
  );
  assert.equal(Object.hasOwn(metadata.shaderPropertyDefaults.vectors, "_Shake"), false,
    "strata: _Shake must remain outside Material defaults");
  assert.equal(Object.hasOwn(metadata.shaderPropertyDefaults.floats, "_StrataFaults"), false,
    "strata: _StrataFaults must remain outside Material defaults");
  assert.equal(metadata.shaderPropertyDefaults.floats._LayerNum, 6,
    "strata: _LayerNum Material default");

  const vertex = memberRows(reflection.vertex, "_22_24");
  assert.deepEqual(
    { block_size: vertex.ubo.block_size, set: vertex.ubo.set, binding: vertex.ubo.binding },
    { block_size: 240, set: 1, binding: 1 },
  );
  assert.deepEqual(vertex.members, [
    { name: "_m0", type: "vec4", offset: 0, array: [4] },
    { name: "_m1", type: "vec4", offset: 64, array: [4] },
    { name: "_m2", type: "float", offset: 128, array: [6] },
    { name: "_m3", type: "vec2", offset: 224 },
    { name: "_m4", type: "int", offset: 232 },
    { name: "_m5", type: "float", offset: 236 },
  ]);
  assert.deepEqual(interfaceRows(reflection.vertex.inputs), [
    { name: "_11", type: "vec4", location: 0 },
    { name: "_133", type: "vec2", location: 1 },
    { name: "_117", type: "vec2", location: 2 },
  ]);
  assert.deepEqual(interfaceRows(reflection.vertex.outputs), [
    { name: "vs_TEXCOORD0", type: "vec2", location: 0 },
  ]);

  const fragment = memberRows(reflection.fragment, "_14_16");
  assert.deepEqual(
    { block_size: fragment.ubo.block_size, set: fragment.ubo.set, binding: fragment.ubo.binding },
    { block_size: 40, set: 1, binding: 0 },
  );
  assert.deepEqual(fragment.members, [
    { name: "_m0", type: "vec3", offset: 0 },
    { name: "_m1", type: "float", offset: 12 },
    { name: "_m2", type: "float", offset: 16 },
    { name: "_m3", type: "float", offset: 20 },
    { name: "_m4", type: "float", offset: 24 },
    { name: "_m5", type: "float", offset: 28 },
    { name: "_m6", type: "float", offset: 32 },
    { name: "_m7", type: "float", offset: 36 },
  ]);
  assert.deepEqual(interfaceRows(reflection.fragment.inputs), [
    { name: "vs_TEXCOORD0", type: "vec2", location: 0 },
  ]);
  assert.deepEqual(interfaceRows(reflection.fragment.outputs), [
    { name: "_684", type: "vec4", location: 0 },
    { name: "_695", type: "vec4", location: 1 },
  ]);
  assert.deepEqual(resourceRows(reflection.fragment.textures), [
    { name: "_679", type: "sampler2D", set: 0, binding: 0 },
  ]);
}

function replaceUbo(source, block, owner, declarations) {
  const pattern = new RegExp(`layout\\(std140\\) uniform ${block}[\\s\\S]*?}\\s*${owner};\\s*`);
  const output = source.replace(pattern, `${declarations.join("\n")}\n\n`);
  if (output === source) throw new Error(`${block}: UBO replacement failed`);
  return output;
}

function replaceAllExact(source, before, after, expected, label) {
  const escaped = before.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`${escaped}(?![0-9])`, "g");
  const actual = (source.match(pattern) || []).length;
  assert.equal(actual, expected, `${label}: occurrence count changed`);
  return source.replace(pattern, after);
}

function vertexPreamble(source) {
  const output = source.replace(
    /^#version 300 es\s*/m,
    "precision highp float;\nprecision highp int;\n\n",
  );
  if (output === source) throw new Error("vertex GLSL version was not removed");
  return output;
}

function adaptFutureVertex(source) {
  let output = vertexPreamble(source);
  output = replaceUbo(output, "_18_20", "_20", [
    "uniform highp mat4 modelMatrix;",
    "uniform highp mat4 viewMatrix;",
    "uniform highp mat4 projectionMatrix;",
    "uniform highp float _CrossFilterUVScale;",
    "uniform highp float _CrossFilterPrimScale;",
    "uniform highp float _ZOffset;",
  ]);
  output = output
    .replace("layout(location = 0) in vec4 _11;", "in vec3 position;")
    .replace("layout(location = 1) in vec2 _97;", "in vec2 uv;")
    .replace(/void main\(\)\s*\{/, `void main()
{
    vec4 _11 = vec4(position, 1.0);
    vec2 _97 = uv;
    mat4 pcrObjectToWorld = modelMatrix;
    mat4 pcrViewProjection = projectionMatrix * viewMatrix;`);
  for (const replacement of [
    ["_20._m0", "pcrObjectToWorld", 4, "future object-to-world"],
    ["_20._m1", "pcrViewProjection", 4, "future view-projection"],
    ["_20._m2", "_CrossFilterUVScale", 2, "future _CrossFilterUVScale"],
    ["_20._m3", "_CrossFilterPrimScale", 1, "future _CrossFilterPrimScale"],
    ["_20._m4", "_ZOffset", 1, "future _ZOffset"],
  ]) output = replaceAllExact(output, ...replacement);
  output = output.replace(/^\s*gl_Position\.y\s*=\s*-gl_Position\.y;\s*$/m, "");
  if (/_20\._m|layout\(std140\)|layout\(location\s*=\s*\d+\)\s+in|gl_Position\.y\s*=/.test(output)) {
    throw new Error("Card_Parallax_Future vertex adaptation is incomplete");
  }
  return `${output.trimEnd()}\n`;
}

function adaptFutureFragment(source) {
  let output = source.replace(/^#version 300 es\s*/m, "");
  output = replaceUbo(output, "_31_33", "_33", [
    "uniform highp float _CrossFilterIntensity;",
    "uniform int _CellCount;",
    "uniform int _CellAnimFrameCount;",
    "uniform highp float _SwitchFade;",
    "uniform highp float _AnimFrame;",
    "uniform highp vec4 _BaseColor;",
    "uniform highp vec4 _OffColor;",
    "uniform highp vec4 _OnColor1;",
    "uniform highp vec4 _OnColor2;",
    "uniform highp vec4 _OnColor3;",
    "uniform highp vec4 _EmitColor1;",
    "uniform highp vec4 _EmitColor2;",
    "uniform highp vec4 _EmitColor3;",
    "uniform highp float _Color1Threshold;",
    "uniform highp float _Color2Threshold;",
    "uniform highp float _Color3Threshold;",
    "uniform highp float _EmissiveIntensity;",
    "uniform highp float _CrossFilterEmissiveIntensity;",
  ]);
  const fields = [
    ["_CrossFilterIntensity", 1],
    ["_CellCount", 1],
    ["_CellAnimFrameCount", 1],
    ["_SwitchFade", 2],
    ["_AnimFrame", 3],
    ["_BaseColor", 4],
    ["_OffColor", 3],
    ["_OnColor1", 1],
    ["_OnColor2", 2],
    ["_OnColor3", 2],
    ["_EmitColor1", 1],
    ["_EmitColor2", 2],
    ["_EmitColor3", 2],
    ["_Color1Threshold", 4],
    ["_Color2Threshold", 4],
    ["_Color3Threshold", 4],
    ["_EmissiveIntensity", 4],
    ["_CrossFilterEmissiveIntensity", 1],
  ];
  fields.forEach(([name, count], index) => {
    output = replaceAllExact(output, `_33._m${index}`, name, count, `future ${name}`);
  });
  if (/_33\._m|layout\(std140\)/.test(output)) {
    throw new Error("Card_Parallax_Future fragment adaptation is incomplete");
  }
  return `${output.trimEnd()}\n`;
}

function adaptStrataVertex(source) {
  let output = vertexPreamble(source);
  output = replaceUbo(output, "_22_24", "_24", [
    "uniform highp mat4 modelMatrix;",
    "uniform highp mat4 viewMatrix;",
    "uniform highp mat4 projectionMatrix;",
    "uniform highp float _StrataFaults[6];",
    "uniform highp vec2 _Shake;",
    "uniform int _LayerNum;",
    "uniform highp float _ZOffset;",
  ]);
  output = output
    .replace("layout(location = 0) in vec4 _11;", "in vec3 position;")
    .replace("layout(location = 2) in vec2 _117;", "in vec2 uv1;")
    .replace("layout(location = 1) in vec2 _133;", "in vec2 uv;")
    .replace(/void main\(\)\s*\{/, `void main()
{
    vec4 _11 = vec4(position, 1.0);
    vec2 _117 = uv1;
    vec2 _133 = uv;
    mat4 pcrObjectToWorld = modelMatrix;
    mat4 pcrViewProjection = projectionMatrix * viewMatrix;`);
  for (const replacement of [
    ["_24._m0", "pcrObjectToWorld", 4, "strata object-to-world"],
    ["_24._m1", "pcrViewProjection", 4, "strata view-projection"],
    ["_24._m2", "_StrataFaults", 1, "strata _StrataFaults"],
    ["_24._m3", "_Shake", 2, "strata _Shake"],
    ["_24._m4", "_LayerNum", 1, "strata _LayerNum"],
    ["_24._m5", "_ZOffset", 1, "strata _ZOffset"],
  ]) output = replaceAllExact(output, ...replacement);
  output = output.replace(/^\s*gl_Position\.y\s*=\s*-gl_Position\.y;\s*$/m, "");
  if (/_24\._m|layout\(std140\)|layout\(location\s*=\s*\d+\)\s+in|gl_Position\.y\s*=/.test(output)) {
    throw new Error("Card_Parallax_Strata vertex adaptation is incomplete");
  }
  return `${output.trimEnd()}\n`;
}

function adaptStrataFragment(source) {
  let output = source.replace(/^#version 300 es\s*/m, "");
  output = replaceUbo(output, "_14_16", "_16", [
    "uniform highp vec3 _CrackColor;",
    "uniform highp float _ClackPow;",
    "uniform highp float _ClackNoiseScale;",
    "uniform highp float _ClackY1;",
    "uniform highp float _ClackY2;",
    "uniform highp float _ClackY3;",
    "uniform highp float _ClackY4;",
    "uniform highp float _ClackY5;",
  ]);
  const fields = [
    "_CrackColor",
    "_ClackPow",
    "_ClackNoiseScale",
    "_ClackY1",
    "_ClackY2",
    "_ClackY3",
    "_ClackY4",
    "_ClackY5",
  ];
  fields.forEach((name, index) => {
    output = replaceAllExact(output, `_16._m${index}`, name, 1, `strata ${name}`);
  });
  if (/_16\._m|layout\(std140\)/.test(output)) {
    throw new Error("Card_Parallax_Strata fragment adaptation is incomplete");
  }
  return `${output.trimEnd()}\n`;
}

function validateStage(source, stage, label) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "pcr-paradox-background-stage-"));
  const file = path.join(temp, `${label}.${stage}`);
  try {
    fs.writeFileSync(file, `#version 300 es\n${source}`);
    runCommand(GLSLANG, ["-S", stage, file], { cwd: ROOT });
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

function validateLinkedProgram(vertex, fragment, label) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "pcr-paradox-background-link-"));
  const vertexFile = path.join(temp, `${label}.vert`);
  const fragmentFile = path.join(temp, `${label}.frag`);
  try {
    fs.writeFileSync(vertexFile, `#version 300 es\n${vertex}`);
    fs.writeFileSync(fragmentFile, `#version 300 es\n${fragment}`);
    runCommand(GLSLANG, ["-l", vertexFile, fragmentFile], { cwd: ROOT });
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

for (const port of PORTS) {
  let linkedVertex = null;
  const future = port.id === "future";
  const result = await generateExactSelectorPort({
    shader: port.shader,
    generatedBy: GENERATED_BY,
    extraction: {
      selectorId: port.selectorId,
      candidateWitnessId: port.candidateWitnessId,
      expectedProofGraphSha256: PROOF_GRAPH_SHA256,
      expectedPortIndexSha256: PORT_INDEX_SHA256,
      decryptedRoot: path.resolve(SHADER_ROOT, "..", ".."),
      prefix: port.stem,
      rootDir: ROOT,
      spirvCross: SPIRV_CROSS,
    },
    expectedSpirvCrossSha256: port.crossSha256,
    validateReflection(reflection, metadata) {
      if (future) assertFutureReflection(reflection, metadata, port);
      else assertStrataReflection(reflection, metadata, port);
    },
    adaptVertex(source) {
      linkedVertex = future ? adaptFutureVertex(source) : adaptStrataVertex(source);
      return linkedVertex;
    },
    adaptFragment(source) {
      const fragment = future ? adaptFutureFragment(source) : adaptStrataFragment(source);
      assert.ok(linkedVertex, `${port.id}: adapted vertex source is unavailable`);
      validateLinkedProgram(linkedVertex, fragment, port.stem);
      return fragment;
    },
    validateWebGlStage(source, stage) {
      validateStage(source, stage, port.stem);
    },
    joinConstantBufferStages: true,
    passPolicy: PASS_POLICY,
    runtimeContract: {
      schema: "pocket-card-render/webgl-runtime-port@1",
      shader_key: port.shaderKey,
      attributes: port.attributes,
      engine_uniforms: {
        modelMatrix: "mat4",
        viewMatrix: "mat4",
        projectionMatrix: "mat4",
      },
      material_uniforms: port.materialUniforms,
      dynamic_uniforms: port.dynamicUniforms,
      require_complete_active_bindings: true,
      camera_from_view: false,
      mrt_attachments: 2,
      stencil_normalization: "none",
      stencil_face_mode: "generic",
    },
    substitutions: {
      vertex: [
        "map official vertex channels to their Three.js r165 attribute names",
        "map unity_ObjectToWorld and unity_MatrixVP to Three.js engine matrices",
        "flatten serialized-common VGlobals to same-name typed WebGL uniforms",
        "bind component-driven vertex uniforms through an explicit producer contract",
        "remove Unity Vulkan clip-space Y inversion for WebGL clip space",
      ],
      fragment: [
        "flatten serialized-common PGlobals to same-name typed WebGL uniforms",
        ...(future
          ? ["bind component-driven _AnimFrame through the CardFutureObject producer contract"]
          : []),
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
        ...(!future ? [{
          kind: "dynamic-uniform-producer-binding",
          contract: "runtime-producer-to-three-uniforms",
        }] : []),
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
        ...(future ? [{
          kind: "dynamic-uniform-producer-binding",
          contract: "runtime-producer-to-three-uniforms",
        }] : []),
        { kind: "glsl-version-ownership", owner: "three-raw-shader-material" },
      ],
    },
    webglSources: {
      vertex: `public/shaders/${port.stem}.vert.glsl`,
      fragment: `public/shaders/${port.stem}.frag.glsl`,
    },
    manifestExtras: {
      mrt: future
        ? { primary: "_510", emissive: "_529", secondary_rgb: "active" }
        : { primary: "_684", emissive: "_695", secondary_value: [0, 0, 0, 1] },
      runtime_boundaries: [{
        status: "runtime-required",
        scope: future
          ? "official-guest-component-submission"
          : "official-guest-native-random-noise-and-component-submission",
        producer: port.producer,
        payload: port.producerPayload,
        note: future
          ? "CardFutureObject serialized parameters and ARM64 producer logic are locally ported and sample-verified. The official guest frame's submitted MaterialPropertyBlock value remains runtime-required."
          : "CardAncientObject serialized parameters, AnimationCurves, renderer binding and ARM64 state control are locally ported. UnityEngine.Random.Range, native Mathf.PerlinNoise1D and the official guest frame's submitted MaterialPropertyBlock values remain runtime-required.",
      }],
    },
    output: {
      outDir: OUT,
      vertex: `${port.stem}.vert.glsl`,
      fragment: `${port.stem}.frag.glsl`,
      manifest: `${port.stem}_uniforms.json`,
      check: CHECK,
    },
  });
  assert.deepEqual(
    result.samplerBindings.map(({ slot, spirvName, binding }) => ({
      slot,
      spirvName,
      binding,
    })),
    port.samplerBindings,
    `${port.id}: sampler bindings`,
  );
}

console.log(`${CHECK ? "verified" : "generated"} ${PORTS.length} paradox background selector ports`);
