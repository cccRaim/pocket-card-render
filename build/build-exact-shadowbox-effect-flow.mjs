#!/usr/bin/env node
// Generate every serialized Card_ShadowBox_Effect_Flow selector from official bytes.
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
const SHADER = "Lettuce/Common/CardNew/Card_ShadowBox_Effect_Flow";
const GENERATED_BY = "build/build-exact-shadowbox-effect-flow.mjs";
const PROOF_GRAPH_SHA256 = "307ed3660e5d3b1bfd8cf9e6b3d64e44937af215da3b6ed84ead198800eeadc4";
const PORT_INDEX_SHA256 = "15095f34b9e75515bbcc3924f6f8b2abb826ba96b48e819ec911486bcfa6f5a9";
const PASS_STATE_SHA256 = "acf0bc4d48dc729ec5fbaab1b37820c5714cbd564a6ee1e333de5ca1b5d9fd8c";
const COMMON_BINDINGS_SHA256 = "bfaeaa65eafee13cef798fd966ce40d3fdf0b2c375a8be7dc9b2b05159bcf4d1";
const MSR_PRODUCER =
  "pocket-card-render/card-msr-object-arm64-state-port@1";
const FLOW_COMPONENT_SOURCE =
  "Card_ShadowBox_Effect_Flow component runtime (unresolved)";
const CAMERA_SOURCE =
  "pocket-card-render/three-perspective-zbuffer-adaptation@1";
const COMPONENT_UNIFORMS = ["_TimeParam", "_NoiseMaskNoiseSpeed", "_Transparency"];

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

const SHARED_FRAGMENT_FIELDS = [
  ["_TimeParam", "float", 0],
  ["_ParticleDetail", "float", 4],
  ["_ParticleMove", "float", 8],
  ["_ParticleUVOffset", "vec2", 16],
  ["_ParticleShapeDetail", "float", 24],
  ["_ParticleDistancePower", "float", 28],
  ["_ParticleFlowIntensity", "float", 32],
  ["_ParticleSpeed", "float", 36],
  ["_BlendAuraFlowMapByShape", "float", 40],
  ["_ParticleColor", "vec3", 48],
  ["_ParticleColorIntensity", "float", 60],
  ["_AuraAreaMasking", "float", 64],
  ["_AuraDistancePower", "float", 68],
  ["_AuraFlowIntensity", "float", 72],
  ["_AuraSpeed", "float", 76],
  ["_AuraDetail", "float", 80],
  ["_AuraMowamowaPower", "float", 84],
  ["_BureNoiseIntensity", "float", 88],
  ["_BureNoiseSpeed", "float", 92],
  ["_BureNoiseDetail", "float", 96],
  ["_NoiseMoveUpSpeed", "float", 100],
  ["_BlendFlowMapUpVector", "float", 104],
  ["_UpVectorNoiseStrength", "float", 108],
  ["_UpVectorNoiseDetail", "float", 112],
  ["_UpVectorNoiseSpeed", "float", 116],
  ["_NoiseMaskIntensity", "float", 120],
  ["_NoiseMaskOffset", "float", 124],
  ["_NoiseMaskDetail", "float", 128],
  ["_NoiseMaskNoiseSpeed", "float", 132],
  ["_NoiseMaskPower", "float", 136],
  ["_Col1", "vec4", 144],
  ["_Col2", "vec4", 160],
  ["_Col3", "vec4", 176],
  ["_AuraColorIntensity", "float", 192],
  ["_AuraAlphaIntensity", "float", 196],
];

const STANDARD_FRAGMENT_TAIL = [
  ["_AuraEmissiveIntensity", "float", 200],
  ["_ParticleEmissiveIntensity", "float", 204],
  ["_ParticleAlphaBlend", "float", 208],
  ["_Transparency", "float", 212],
  ["_AuraBaseTransparency", "float", 216],
  ["_ParticleBaseTransparency", "float", 220],
  ["_AlphaBlend", "float", 224],
];

const COL4_FRAGMENT_TAIL = [
  ["_AuraCol4ThresholdWidth", "float", 200],
  ["_AuraCol4Threshold", "float", 204],
  ["_AuraEmissiveIntensity", "float", 208],
  ["_ParticleEmissiveIntensity", "float", 212],
  ["_ParticleAlphaBlend", "float", 216],
  ["_Transparency", "float", 220],
  ["_AuraBaseTransparency", "float", 224],
  ["_ParticleBaseTransparency", "float", 228],
  ["_AlphaBlend", "float", 232],
];

const BASE_VERTEX_OUTPUTS = [
  ["vs_TEXCOORD0", "vec2", 0],
  ["vs_TEXCOORD1", "vec3", 2],
  ["vs_TEXCOORD2", "vec3", 1],
  ["_300", "vec3", 3],
];

const COL4_VERTEX_OUTPUTS = [
  ["vs_TEXCOORD0", "vec2", 0],
  ["vs_TEXCOORD1", "vec3", 3],
  ["vs_TEXCOORD2", "vec3", 1],
  ["_300", "vec3", 2],
];

const PORTS = [
  {
    id: "default",
    stem: "shadowbox_effect_flow_default",
    keywords: [],
    selectorId: "42a33355c120a274480dfdf35d6de73f344434d6ac60e5730b72bb377113b060",
    candidateWitnessId: "6d2b2cffeafb89ba2e9309d5e8b0728d73bb3c7713aa0e29cad662b8cb516acc",
    executableId: "34f6edb9ab0dfd847cea8cb2366b0007f9751b9a302ae9449c11183fcbdf7fe2",
    semanticExecutableId: "8f585d7269382929cfff3eee2d8e5e791ec4dbc48aeddf8e416c003d9256bf9d",
    vertexSpirvSha256: "a5fd469702cc00751c100f87f183515faa21bc1de913aeb6cc7df34ec0f78da9",
    fragmentSpirvSha256: "ff5c909b61b673663ae0efdea7637d4e469d9fc016cf6d6e3cea19ac30f72810",
    parameterEntrySha256: "679395332512e5b7c71730de4edaf858ed706dc08b478719c991425b78770711",
    parameterReflectionSha256: "a6912522739cf4a4f154485eb4a42baa323a875a07b9874d98b8c1512017dc7a",
    parameterBytes: 2312,
    parameterSuffix: "1890560319",
    cross: {
      vertex: "33f6fcf4e8c842a47e37c029b613dcbe622680e137546a8f1b5ace110fd05de6",
      fragment: "eaf419be646f3a8b1a763d78856f1f8c95544f0ea3905bb321817569f36dc07c",
    },
    fields: [...SHARED_FRAGMENT_FIELDS, ...STANDARD_FRAGMENT_TAIL],
    vertexOutputs: BASE_VERTEX_OUTPUTS,
    fragmentInputs: [
      ["vs_TEXCOORD2", "vec3", 1],
      ["vs_TEXCOORD0", "vec2", 0],
    ],
    fragmentOutputs: [["_3517", "vec4", 1], ["_3524", "vec4", 0]],
    textureNames: ["_136", "_187", "_210", "_1490", "_3079"],
    mrt: { primary: "_3524", emissive: "_3517" },
  },
  {
    id: "use_col4",
    stem: "shadowbox_effect_flow_use_col4",
    keywords: ["_USE_COL4"],
    selectorId: "89a632ae626217ecdd90d278467a40b0f4b1a9bde1238e8231efa9ce9c29f1c2",
    candidateWitnessId: "851dfa1e7b27676ecbff466bda9355741b4d5bb7d52178c825e578dce6f44b0f",
    executableId: "151dec7089696c55288f39285ea7b56d18598680ee64d15b6dc21d4e61b3f54a",
    semanticExecutableId: "dc6c330047ef4ab88aaae0d1c78beeb326cff55691e708f304ecf028efad3ef8",
    vertexSpirvSha256: "07f1fba958c355b35861ebb1dd537d1a21b0bf1a84b7e9a0302a2518fc9525a1",
    fragmentSpirvSha256: "cfeeb47e5db44c68fad7a5598d8a0c93adeaaf2c8d6196aed02637323db6c436",
    parameterEntrySha256: "6fea5e5da38334b0182f322a7f01dfb8a570a466a1cbdcd5bf9f6419bb2c8420",
    parameterReflectionSha256: "cc4465d01e5c20942174ce4ba5e2b632ad72b6c08f07ad2705dbffca5c9b72a0",
    parameterBytes: 2412,
    parameterSuffix: "1116536061",
    cross: {
      vertex: "33f6fcf4e8c842a47e37c029b613dcbe622680e137546a8f1b5ace110fd05de6",
      fragment: "5b1fad3b4d0b708cbf1a23571baf8fffa6a4acf3daa3de3cb0295e92e5c96795",
    },
    fields: [...SHARED_FRAGMENT_FIELDS, ...COL4_FRAGMENT_TAIL],
    vertexOutputs: COL4_VERTEX_OUTPUTS,
    fragmentInputs: [
      ["vs_TEXCOORD2", "vec3", 1],
      ["vs_TEXCOORD0", "vec2", 0],
      ["_3732", "vec3", 2],
    ],
    fragmentOutputs: [["_3871", "vec4", 0], ["_3912", "vec4", 1]],
    textureNames: ["_136", "_187", "_210", "_1490", "_3079"],
    col4Varying: "_3732",
    mrt: { primary: "_3871", emissive: "_3912" },
  },
  {
    id: "use_old_noise",
    stem: "shadowbox_effect_flow_use_old_noise",
    keywords: ["_USE_OLD_NOISE"],
    selectorId: "9ae669c08046817c74b735b69c311d42ceb754cf25b9df26581f090f069697d8",
    candidateWitnessId: "bc50eab7ea6ecacec9548d2a7177d89d75ed3bf4a7385d48a4db97c8a9b1165e",
    executableId: "c81475469564e017f8d2662b19b41e6e3cf53fb9262b0bf38b255afb2e18b68c",
    semanticExecutableId: "85464df2fc0a24b2b9a688b1c622d668562985bb0c8d53c14cd457d74243fef5",
    vertexSpirvSha256: "a5fd469702cc00751c100f87f183515faa21bc1de913aeb6cc7df34ec0f78da9",
    fragmentSpirvSha256: "07b66d9a879704d5cf1d672d319f5a55f0d4b2ef7b755b7e1b3acc6b7c47217c",
    parameterEntrySha256: "838a9ef26ef3f9c053e3e5c4bc5487277c89ef870254fdeda6a31ac9983dfc8c",
    parameterReflectionSha256: "bd689c5c18ba3345dde44dbd0221d7690050dc6bbe788dabe9e66601c40a62fa",
    parameterBytes: 2312,
    parameterSuffix: "3218269609",
    cross: {
      vertex: "33f6fcf4e8c842a47e37c029b613dcbe622680e137546a8f1b5ace110fd05de6",
      fragment: "fb167001ba2b2883674959f4a1501865861c85d913b0df5315daea738c409abf",
    },
    fields: [...SHARED_FRAGMENT_FIELDS, ...STANDARD_FRAGMENT_TAIL],
    vertexOutputs: BASE_VERTEX_OUTPUTS,
    fragmentInputs: [
      ["vs_TEXCOORD2", "vec3", 1],
      ["vs_TEXCOORD0", "vec2", 0],
    ],
    fragmentOutputs: [["_2083", "vec4", 1], ["_2090", "vec4", 0]],
    textureNames: ["_136", "_187", "_210", "_747", "_1645"],
    mrt: { primary: "_2090", emissive: "_2083" },
  },
];

const SAMPLER_SLOTS = [
  "_ParticleShapeMask",
  "_FlowMap",
  "_FlowTex",
  "_FBMTex",
  "_ParticleTex",
];

function rows(items = []) {
  return items.map(({ name, type, location }) => ({ name, type, location }))
    .sort((left, right) => left.location - right.location || left.name.localeCompare(right.name));
}

function expectedRows(items) {
  return items.map(([name, type, location]) => ({ name, type, location }))
    .sort((left, right) => left.location - right.location || left.name.localeCompare(right.name));
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

function adaptVertex(source, port) {
  let output = replaceExactlyOnce(
    source,
    /^#version 300 es\s*/,
    [
      "precision highp float;",
      "precision highp int;",
      "",
    ].join("\n"),
    `${port.id} vertex version`,
  );
  output = replaceExactlyOnce(
    output,
    /layout\(std140\) uniform _22_24[\s\S]*?}\s*_24;\s*/,
    "uniform highp mat4 modelMatrix;\n\n",
    `${port.id} UnityPerDraw UBO`,
  );
  output = replaceExactlyOnce(
    output,
    /layout\(std140\) uniform _56_58[\s\S]*?}\s*_58;\s*/,
    [
      "uniform highp mat4 viewMatrix;",
      "uniform highp mat4 projectionMatrix;",
      "uniform highp vec4 _ZBufferParams;",
      "uniform mediump vec4 _Col4;",
      "uniform highp float _ZOffset;",
      "",
    ].join("\n"),
    `${port.id} VGlobals UBO`,
  );
  output = replaceExactlyOnce(
    output,
    "layout(location = 0) in vec4 _11;",
    "in vec3 position;",
    `${port.id} position input`,
  );
  output = replaceExactlyOnce(
    output,
    "layout(location = 1) in vec2 _159;",
    "in vec2 uv;",
    `${port.id} UV input`,
  );
  output = replaceExactlyOnce(
    output,
    "layout(location = 2) in vec3 _164;",
    "in vec4 color;",
    `${port.id} color input`,
  );
  output = replaceExactlyOnce(
    output,
    /void main\(\)\s*\{/,
    [
      "void main()",
      "{",
      "    vec4 _11 = vec4(position, 1.0);",
      "    vec2 _159 = uv;",
      "    vec3 _164 = color.xyz;",
      "    mat4 _ViewProjection = projectionMatrix * viewMatrix;",
    ].join("\n"),
    `${port.id} vertex entry`,
  );
  output = output
    .replaceAll("_24._m0", "modelMatrix")
    .replaceAll("_58._m0", "_ZBufferParams")
    .replaceAll("_58._m1", "_ViewProjection")
    .replaceAll("_58._m2", "_Col4")
    .replaceAll("_58._m3", "_ZOffset");
  output = replaceExactlyOnce(
    output,
    /^\s*gl_Position\.y\s*=\s*-gl_Position\.y;\s*$/m,
    "",
    `${port.id} Vulkan clip-Y`,
  );
  if (port.col4Varying) output = output.replaceAll("_300", port.col4Varying);
  if (/layout\(std140\)|_24\._m|_58\._m|layout\(location\s*=\s*\d+\)\s+in\b/.test(output)) {
    throw new Error(`${port.id}: vertex adaptation is incomplete`);
  }
  return `${output.trimEnd()}\n`;
}

function flattenFragmentUbo(source, port) {
  const pattern = /layout\(std140\) uniform _26_28\s*\{\s*([\s\S]*?)\}\s*_28;\s*/;
  const match = source.match(pattern);
  if (!match) throw new Error(`${port.id}: fragment UBO source shape changed`);
  const declarations = match[1].split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  assert.equal(declarations.length, port.fields.length, `${port.id}: fragment UBO member count`);
  const uniforms = declarations.map((declaration, index) => {
    const parsed = /^(?:(highp|mediump|lowp)\s+)?(float|vec2|vec3|vec4)\s+_m(\d+);$/.exec(declaration);
    assert.ok(parsed, `${port.id}: unsupported fragment UBO declaration ${declaration}`);
    const [name, type] = port.fields[index];
    assert.equal(Number(parsed[3]), index, `${port.id}: fragment UBO member index`);
    assert.equal(parsed[2], type, `${port.id}: fragment UBO member ${name} type`);
    return `uniform ${parsed[1] ? `${parsed[1]} ` : ""}${type} ${name};`;
  });
  let output = source.replace(pattern, `${uniforms.join("\n")}\n\n`);
  const usedMembers = new Set();
  output = output.replace(/_28\._m(\d+)/g, (whole, rawIndex) => {
    const index = Number(rawIndex);
    const field = port.fields[index];
    if (!field) throw new Error(`${port.id}: unmapped fragment member ${whole}`);
    usedMembers.add(index);
    return field[0];
  });
  assert.deepEqual(
    [...usedMembers].sort((left, right) => left - right),
    port.fields.map((_, index) => index),
    `${port.id}: active fragment members`,
  );
  if (/_28\._m|layout\(std140\) uniform _26_28/.test(output)) {
    throw new Error(`${port.id}: fragment UBO adaptation is incomplete`);
  }
  return output;
}

function adaptFragment(source, port) {
  let output = replaceExactlyOnce(
    source,
    /^#version 300 es\s*/,
    "",
    `${port.id} fragment version`,
  );
  output = flattenFragmentUbo(output, port);
  return `${output.trimEnd()}\n`;
}

function assertParameterReflection(metadata, port) {
  assert.equal(metadata.artifacts.parameterEntry.byteSize, port.parameterBytes);
  assert.equal(metadata.parameterReflectionSha256, port.parameterReflectionSha256);
  assert.equal(metadata.parameterReflection.version, 202012090);
  assert.equal(metadata.parameterReflection.constantBlockCount, 4);
  assert.equal(metadata.parameterReflection.resourceCount, 2);
  assert.equal(metadata.parameterReflection.resourceDecoding, "material-property-disambiguated");
  assert.deepEqual(metadata.parameterReflection.bindingClosure, {
    constantBuffersMatch: true,
    constantBufferDeclarationMode: "mixed-common-and-variant",
    commonConstantBufferCount: 1,
    variantConstantBufferCount: 2,
    variantTextureCount: 0,
    commonTextureCount: 5,
    constantBufferBindingCount: 2,
  });
  const buffers = metadata.parameterReflection.constantBuffers;
  assert.deepEqual(
    buffers.map(({ name, size }) => ({ name, size })),
    [
      { name: "", size: 0 },
      { name: `PGlobals${port.parameterSuffix}`, size: port.fields.at(-1)[2] + 4 },
      { name: "UnityPerDraw", size: 688 },
      { name: `VGlobals${port.parameterSuffix}`, size: 100 },
    ],
  );
  const fields = buffers[1].fields
    .map(({ name, offset }) => ({ name, offset }))
    .sort((left, right) => left.offset - right.offset);
  assert.deepEqual(
    fields,
    port.fields.map(([name, , offset]) => ({ name, offset })),
    `${port.id}: official parameter fields changed`,
  );

  const propertyDefaults = metadata.shaderPropertyDefaults;
  const serializedPropertyNames = new Set([
    ...Object.keys(propertyDefaults.floats),
    ...Object.keys(propertyDefaults.colors),
    ...Object.keys(propertyDefaults.vectors),
  ]);
  assert.deepEqual(
    port.fields
      .map(([name]) => name)
      .filter((name) => !serializedPropertyNames.has(name)),
    COMPONENT_UNIFORMS,
    `${port.id}: unresolved component uniform set changed`,
  );
  assert.equal(propertyDefaults.floats._NoiseMaskSpeed, 1);
  assert.ok(!serializedPropertyNames.has("_NoiseMaskNoiseSpeed"));
}

function assertReflection(reflection, metadata, port) {
  assert.deepEqual(metadata.selector.keywords, port.keywords);
  assert.equal(metadata.selector.executableId, port.executableId);
  assert.equal(metadata.selector.semanticExecutableId, port.semanticExecutableId);
  assert.deepEqual(metadata.identityFields, {
    vertexSpirvSha256: port.vertexSpirvSha256,
    fragmentSpirvSha256: port.fragmentSpirvSha256,
    parameterEntrySha256: port.parameterEntrySha256,
    passStateSha256: PASS_STATE_SHA256,
    commonBindingsSha256: COMMON_BINDINGS_SHA256,
  });
  assertParameterReflection(metadata, port);

  assert.deepEqual(
    reflection.vertex.ubos?.map(({ name, block_size, set, binding }) => ({
      name, block_size, set, binding,
    })),
    [
      { name: "_22_24", block_size: 688, set: 1, binding: 2 },
      { name: "_56_58", block_size: 100, set: 1, binding: 1 },
    ],
  );
  assert.deepEqual(rows(reflection.vertex.inputs), expectedRows([
    ["_11", "vec4", 0],
    ["_159", "vec2", 1],
    ["_164", "vec3", 2],
  ]));
  assert.deepEqual(rows(reflection.vertex.outputs), expectedRows(port.vertexOutputs));

  assert.deepEqual(
    reflection.fragment.ubos?.map(({ name, block_size, set, binding }) => ({
      name, block_size, set, binding,
    })),
    [{
      name: "_26_28",
      block_size: port.fields.at(-1)[2] + 4,
      set: 1,
      binding: 0,
    }],
  );
  const fragmentUbo = reflection.fragment.ubos[0];
  assert.deepEqual(
    reflection.fragment.types[fragmentUbo.type].members
      .map(({ name, type, offset }) => ({ name, type, offset })),
    port.fields.map(([, type, offset], index) => ({ name: `_m${index}`, type, offset })),
  );
  assert.deepEqual(rows(reflection.fragment.inputs), expectedRows(port.fragmentInputs));
  assert.deepEqual(rows(reflection.fragment.outputs), expectedRows(port.fragmentOutputs));
  assert.deepEqual(
    reflection.fragment.textures?.map(({ name, type, set, binding }) => ({
      name, type, set, binding,
    })),
    port.textureNames.map((name, binding) => ({
      name, type: "sampler2D", set: 0, binding,
    })),
  );
}

function validateWebGlStage(source, stage, port) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "pcr-shadowbox-flow-glsl-"));
  const file = path.join(temp, `${port.id}.${stage}`);
  try {
    fs.writeFileSync(file, `#version 300 es\n${source}`);
    runCommand(GLSLANG, ["-S", stage, file], { cwd: ROOT });
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

function validateLinkedProgram(vertex, fragment, port) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "pcr-shadowbox-flow-link-"));
  const vertexFile = path.join(temp, `${port.id}.vert`);
  const fragmentFile = path.join(temp, `${port.id}.frag`);
  try {
    fs.writeFileSync(vertexFile, `#version 300 es\n${vertex}`);
    fs.writeFileSync(fragmentFile, `#version 300 es\n${fragment}`);
    runCommand(GLSLANG, ["-l", vertexFile, fragmentFile], { cwd: ROOT });
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

function runtimeContract(port) {
  const dynamicNames = new Set(COMPONENT_UNIFORMS);
  const vectors = Object.fromEntries(
    port.fields
      .filter(([, type]) => type !== "float")
      .map(([name, type]) => [name, type]),
  );
  vectors._Col4 = "vec4";
  return {
    schema: "pocket-card-render/webgl-runtime-port@1",
    shader_key: "Card_ShadowBox_Effect_Flow",
    attributes: { position: "vec3", uv: "vec2", color: "vec4" },
    engine_uniforms: {
      modelMatrix: "mat4",
      viewMatrix: "mat4",
      projectionMatrix: "mat4",
    },
    material_uniforms: {
      floats: [
        ...port.fields
          .filter(([name, type]) => type === "float" && !dynamicNames.has(name))
          .map(([name]) => name),
        "_ZOffset",
      ],
      ints: [],
      vectors,
    },
    dynamic_uniforms: {
      _TimeParam: { type: "float", source: MSR_PRODUCER },
      _NoiseMaskNoiseSpeed: { type: "float", source: FLOW_COMPONENT_SOURCE },
      _Transparency: { type: "float", source: MSR_PRODUCER },
      _ZBufferParams: { type: "vec4", source: CAMERA_SOURCE },
    },
    require_complete_active_bindings: true,
    camera_from_view: false,
    mrt_attachments: 2,
    stencil_normalization: "none",
    stencil_face_mode: "generic",
  };
}

const vertexOperations = [
  { kind: "vertex-input-binding", contract: "official-bind-channels-to-three-r165" },
  { kind: "engine-uniform-binding", contract: "unity-builtins-to-three-r165" },
  {
    kind: "uniform-buffer-flattening",
    source: "mixed",
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
];

const fragmentOperations = [
  {
    kind: "uniform-buffer-flattening",
    source: "variant-local",
    preservation: "names-types-precision",
  },
  {
    kind: "dynamic-uniform-producer-binding",
    contract: "runtime-producer-to-three-uniforms",
  },
  { kind: "glsl-version-ownership", owner: "three-raw-shader-material" },
];

for (const port of PORTS) {
  const contract = runtimeContract(port);
  let linkedVertex = null;
  const result = await generateExactSelectorPort({
    shader: SHADER,
    generatedBy: GENERATED_BY,
    extraction: {
      selectorId: port.selectorId,
      candidateWitnessId: port.candidateWitnessId,
      expectedProofGraphSha256: PROOF_GRAPH_SHA256,
      expectedPortIndexSha256: PORT_INDEX_SHA256,
      decryptedRoot: path.resolve(SHADER_ROOT, "..", ".."),
      prefix: port.stem,
      rootDir: ROOT,
    },
    output: {
      outDir: OUT,
      vertex: `${port.stem}.vert.glsl`,
      fragment: `${port.stem}.frag.glsl`,
      manifest: `${port.stem}_uniforms.json`,
      check: CHECK,
    },
    expectedSpirvCrossSha256: port.cross,
    spirvCross: SPIRV_CROSS,
    passPolicy: PASS_POLICY,
    validateReflection(reflection, metadata) {
      assertReflection(reflection, metadata, port);
    },
    adaptVertex(source) {
      linkedVertex = adaptVertex(source, port);
      return linkedVertex;
    },
    adaptFragment(source) {
      const fragment = adaptFragment(source, port);
      if (linkedVertex === null) {
        throw new Error(`${port.id}: adapted vertex source is unavailable`);
      }
      validateLinkedProgram(linkedVertex, fragment, port);
      return fragment;
    },
    validateWebGlStage(source, stage) {
      validateWebGlStage(source, stage, port);
    },
    joinConstantBufferStages: true,
    substitutions: {
      vertex: [
        "map official Vertex/UV0/Color channels to Three.js r165 position/uv/color attributes",
        "map unity_ObjectToWorld and unity_MatrixVP to modelMatrix and projectionMatrix * viewMatrix",
        "flatten official VGlobals and adapt its linearize/offset/delinearize sequence to Three.js OpenGL NDC depth",
        ...(port.col4Varying
          ? ["rename the location-2 vertex output to the fragment location-2 varying for WebGL name linking"]
          : []),
        "remove Unity Vulkan clip-space Y inversion for WebGL clip space",
      ],
      fragment: [
        "flatten the selector-specific PGlobals UBO to same-name uniforms with preserved types and precision",
        "bind CardMSRObject-owned uniforms through its serialized shadowbox renderer role and leave only the Effect Flow component value unresolved",
      ],
    },
    adaptationOperations: {
      vertex: vertexOperations,
      fragment: fragmentOperations,
    },
    webglSources: {
      vertex: `public/shaders/${port.stem}.vert.glsl`,
      fragment: `public/shaders/${port.stem}.frag.glsl`,
    },
    runtimeContract: contract,
    manifestExtras: {
      mrt: port.mrt,
      runtime_boundaries: [
        {
          status: "runtime-required",
          scope: "component-uniform-producer",
          producer: MSR_PRODUCER,
          uniforms: ["_TimeParam", "_Transparency"],
          note: "The ARM64 CardMSRObject algorithm, serialized fields, animation curves, and SearchTag renderer binding are locally ported. Unity LateUpdate scheduling and official guest MaterialPropertyBlock submission remain runtime-required.",
        },
        {
          status: "runtime-required",
          scope: "component-uniform-producer",
          producer: FLOW_COMPONENT_SOURCE,
          uniforms: ["_NoiseMaskNoiseSpeed"],
          note: "_NoiseMaskSpeed exists in serialized material data, but no static evidence yet proves it aliases the active _NoiseMaskNoiseSpeed component value.",
        },
        {
          status: "known-implementation",
          scope: "backend-camera-uniform-adaptation",
          producer: CAMERA_SOURCE,
          uniforms: ["_ZBufferParams"],
          note: "The adapter derives z/w from the active Three perspective near/far planes and preserves the shader's eye-depth offset algebra. Official guest camera/projection equivalence remains runtime-required.",
        },
      ],
    },
  });

  assert.equal(result.manifest.official_selector.shaderName, SHADER);
  assert.deepEqual(result.manifest.selected_keywords, port.keywords);
  assert.equal(result.manifest.official_selector.semanticExecutableId, port.semanticExecutableId);
  assert.deepEqual(
    result.samplerBindings.map(({ slot, spirvName, binding }) => ({
      slot, spirvName, binding,
    })),
    SAMPLER_SLOTS.map((slot, binding) => ({
      slot,
      spirvName: port.textureNames[binding],
      binding,
    })),
  );
}

console.log(`${CHECK ? "verified" : "generated"} ${PORTS.length} Card_ShadowBox_Effect_Flow selector ports`);
