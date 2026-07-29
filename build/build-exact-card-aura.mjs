#!/usr/bin/env node
// Generate every serialized Card_Aura selector from selector-bound official SPIR-V.
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
const CANDIDATE = process.argv.includes("--candidate");
const LOCAL_DECODER_ROOT = path.resolve(ROOT, "..", "ptcgp-tools-master", "masterdata_decoder");
const SAMPLE = CANDIDATE
  ? {
      id: "ptcgp-1.7.0-unity-6000.0.69f1-candidate",
      unityVersion: "6000.0.69f1",
      decryptedRoot: path.join(LOCAL_DECODER_ROOT, ".output-full", "decrypted"),
      inventory: path.join(LOCAL_DECODER_ROOT, ".output-full", "material-program-inventory-full.json"),
      manifest: path.join(ROOT, "build", "official-samples", "ptcgp-1.7.0-unity-6000.0.69f1-candidate.json"),
      out: path.join(LOCAL_DECODER_ROOT, ".output-full", "webgl-ports", "card-aura"),
      webglSourceRoot: "candidate/ptcgp-1.7.0-unity-6000.0.69f1/shaders",
      proofGraphSha256: "65acde2d29ba8c255f02f9a1eaf4e4d8cdeff9eeedf3d42b89a527cf8d99fa1a",
      portIndexSha256: "2c8231200339ab77a1dc191d26aa2ce83aaaceba7c97d7726d08b3f3f9f8dc2b",
      unityPerDrawSize: 720,
    }
  : {
      id: "ptcgp-1.6.0-unity-2022.3.62f2",
      unityVersion: "2022.3.62f2",
      decryptedRoot: path.join(LOCAL_DECODER_ROOT, ".output", "decrypted"),
      inventory: null,
      manifest: null,
      out: path.join(ROOT, "public", "shaders"),
      webglSourceRoot: "public/shaders",
      proofGraphSha256: "307ed3660e5d3b1bfd8cf9e6b3d64e44937af215da3b6ed84ead198800eeadc4",
      portIndexSha256: "15095f34b9e75515bbcc3924f6f8b2abb826ba96b48e819ec911486bcfa6f5a9",
      unityPerDrawSize: 688,
    };
const DECRYPTED_ROOT = path.resolve(process.env.PCR_DECRYPTED_ROOT || SAMPLE.decryptedRoot);
const SHADER_ROOT = process.env.PCR_SHADERS || path.join(DECRYPTED_ROOT, "Common", "Shader");
const INVENTORY = process.env.PCR_PROGRAM_INVENTORY
  ? path.resolve(process.env.PCR_PROGRAM_INVENTORY)
  : SAMPLE.inventory;
const SPIRV_CROSS = process.env.SPIRV_CROSS || "spirv-cross";
const GLSLANG = process.env.GLSLANG_VALIDATOR || "glslangValidator";
const OUT = path.resolve(process.env.PCR_SHADER_OUT || SAMPLE.out);
const CHECK = process.argv.includes("--check") || process.env.PCR_EXACT_CHECK === "1";
const SHADER = "Lettuce/Common/CardNew/Card_Aura";
const GENERATED_BY = "build/build-exact-card-aura.mjs";
const PROOF_GRAPH_SHA256 = SAMPLE.proofGraphSha256;
const PORT_INDEX_SHA256 = SAMPLE.portIndexSha256;
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

const BASE_FIELDS = [
  ["_TimeParam", "float"],
  ["_AuraMaskPower", "float"],
  ["_AuraScale", "vec2"],
  ["_AuraPosOffset", "vec2"],
  ["_FlowIntensity", "float"],
  ["_AuraSpeed", "float"],
  ["_AuraDetail", "float"],
  ["_AuraMowamowaPower", "float"],
  ["_BureNoiseIntensity", "float"],
  ["_BureNoiseSpeed", "float"],
  ["_BureNoiseDetail", "float"],
  ["_NoiseMoveUpSpeed", "float"],
  ["_BlendFlowMapUpVector", "float"],
  ["_UpVectorNoiseStrength", "float"],
  ["_UpVectorNoiseDetail", "float"],
  ["_UpVectorNoiseSpeed", "float"],
  ["_AuraMaskOffset", "float"],
  ["_AuraMaskNoiseDetail", "float"],
  ["_AuraMaskNoiseSpeed", "float"],
  ["_AuraMask2Power", "float"],
  ["_Col1", "vec4"],
  ["_Col2", "vec4"],
  ["_Col3", "vec4"],
  ["_AuraColorIntensity", "float"],
  ["_AuraAlphaIntensity", "float"],
  ["_AuraEdgeBorder", "float"],
  ["_AuraEdgeBorderSmooth", "float"],
  ["_AuraEdgePow", "float"],
  ["_EmissiveIntensity", "float"],
  ["_AlphaBlend", "float"],
  ["_BaseTransparency", "float"],
  ["_Transparency", "float"],
];

const COL4_FIELDS = [
  ...BASE_FIELDS.slice(0, 23),
  ["_AuraCol4ThresholdWidth", "float"],
  ["_AuraCol4Threshold", "float"],
  ...BASE_FIELDS.slice(23),
];

const COMMON_IDENTITY = CANDIDATE
  ? {
      passStateSha256: "ecb5f2d8ae4062033db6a47a3bdbbd71c6a13ef62e8cf38bffcd7aff4c05a20f",
      commonBindingsSha256: "7ed3df2c439386142864b4b4b9d01aa5784b34170583beb34b69b884c27e0114",
    }
  : {
      passStateSha256: "5ef465917d7f5e76b83a199d250735ba9af6ed614fd3bd676d277f8206d498c6",
      commonBindingsSha256: "6a0877da5f472e52f5d90883d4e012aff20fb5991eddd70f51da331274c82480",
    };

const BASELINE_PORTS = [
  {
    id: "base",
    stem: "card_aura_base",
    keywords: [],
    selectorId: "69a242db5757a6f9cda2155c9dc10c314c7524efc4af645b63b018713d341f24",
    candidateWitnessId: "26e94f48a624a1e25e5a36ec1949268ead263798da068ff5f991b743ddafd037",
    semanticExecutableId: "6ea4d1e733fa3033090013428e4bc84484f1f08042235f14f9d6c33424d7100c",
    identityFields: {
      vertexSpirvSha256: "2f06f309872e02af9f2ad6ce9bba3e2a6878a1de2e6e07cde10ba1d787085974",
      fragmentSpirvSha256: "472946fce99565cbae0775f8327552a9c2c880099526da52147bdaeb765051ef",
      parameterEntrySha256: "c9b67e0e57411910c0812b65985d3eb493bae228ed930abfce7be940e7d59b63",
      ...COMMON_IDENTITY,
    },
    crossSha256: {
      vertex: "c9067cd568ef1a4a55b46d580826dd037bde747a773df0f0552f4f895c55a9cb",
      fragment: "7582b07e2bc8efece0fc6c369ff4ddc84fe94f0865e053e9d157dde036d5282c",
    },
    parameterBytes: 1708,
    parameterReflectionSha256: "cc45bf8e0980660440b14fe4609bbc4ebb4321a45e7a3d1bca2ada9963ef7f53",
    fragmentUboSize: 180,
    fields: BASE_FIELDS,
    vertexOutputs: [
      ["vs_TEXCOORD0", "vec2", 0],
      ["vs_TEXCOORD1", "vec3", 1],
      ["_245", "vec3", 2],
    ],
    fragmentInputs: [["vs_TEXCOORD0", "vec2", 0]],
    fragmentOutputs: [["_3180", "vec4", 0], ["_3182", "vec4", 1]],
    fragmentSamplers: [["_60", 0], ["_87", 1], ["_2524", 2]],
  },
  {
    id: "col4",
    stem: "card_aura_col4",
    keywords: ["_USE_COL4"],
    selectorId: "57792f8e8a215efb2b8f69ed1a4e9cd7033ac24a78940658160c58459aecced2",
    candidateWitnessId: "1b654aa5e1c4d5e80ce9a1254e206a7b8936512172676330c2b9e12aaec4b6b1",
    semanticExecutableId: "e692bbc3023ea58dcec6962a2def67e50f1d74bf79ecc476fe05a10ae08842f5",
    identityFields: {
      vertexSpirvSha256: "eb9da9a38724dbabf0419277dd1c9ea5a57e79ce9ca8dc226b45b3b25ce010e6",
      fragmentSpirvSha256: "add7aafb7ab3e2c1d88d4de170e767d24f735cb4e052033eed00ca5586cbd04d",
      parameterEntrySha256: "419276619389d242e0a619498aaa05aed5688f30ac2ab4fabea725146cd08fdf",
      ...COMMON_IDENTITY,
    },
    crossSha256: {
      vertex: "c9067cd568ef1a4a55b46d580826dd037bde747a773df0f0552f4f895c55a9cb",
      fragment: "326089e14d318c2ca101fb61f22597080e1ae67e034a1d66ef72a8af567d6887",
    },
    parameterBytes: 1808,
    parameterReflectionSha256: "a0fbcc2e14bf64187e90ba87afdd2ddbfc18501ce6fcb46237cd739c501ac770",
    fragmentUboSize: 188,
    fields: COL4_FIELDS,
    vertexOutputs: [
      ["vs_TEXCOORD0", "vec2", 0],
      ["_245", "vec3", 1],
      ["vs_TEXCOORD1", "vec3", 2],
    ],
    fragmentInputs: [
      ["vs_TEXCOORD0", "vec2", 0],
      ["_3379", "vec3", 1],
    ],
    fragmentOutputs: [["_3578", "vec4", 0], ["_3580", "vec4", 1]],
    fragmentSamplers: [["_60", 0], ["_87", 1], ["_2527", 2]],
  },
  {
    id: "old_noise",
    stem: "card_aura_old_noise",
    keywords: ["_USE_OLD_NOISE"],
    selectorId: "f3024a9274300e44a416f8e90a4557253d4861837dc8925093dc43dad5c9ef33",
    candidateWitnessId: "1aa9fd0b00eb90d8f83b3213f88162e6c4037adf4a84b2057dff3324da36c04d",
    semanticExecutableId: "cc711efd97c657fabf16d439a48f57d1c0ab177d73b3c32753874173e9096221",
    identityFields: {
      vertexSpirvSha256: "2f06f309872e02af9f2ad6ce9bba3e2a6878a1de2e6e07cde10ba1d787085974",
      fragmentSpirvSha256: "90aba2d077d5eb25a7404b700975c793a78f77a143838929396efd9b7a87900f",
      parameterEntrySha256: "f5fecaf4257e926f2222a9d3575873fbccee53a31f197998305a86780db6e06d",
      ...COMMON_IDENTITY,
    },
    crossSha256: {
      vertex: "c9067cd568ef1a4a55b46d580826dd037bde747a773df0f0552f4f895c55a9cb",
      fragment: "d5982d2abe3ece37ae46f168e892b019e269bb78815217eaa3e9327008e69a2a",
    },
    parameterBytes: 1708,
    parameterReflectionSha256: "6ddb5a00ba24fc819b118ae69304309d61a58577918c1079575a8b7a1be47ba8",
    fragmentUboSize: 180,
    fields: BASE_FIELDS,
    vertexOutputs: [
      ["vs_TEXCOORD0", "vec2", 0],
      ["vs_TEXCOORD1", "vec3", 1],
      ["_245", "vec3", 2],
    ],
    fragmentInputs: [["vs_TEXCOORD0", "vec2", 0]],
    fragmentOutputs: [["_1695", "vec4", 0], ["_1697", "vec4", 1]],
    fragmentSamplers: [["_60", 0], ["_87", 1], ["_1039", 2]],
  },
];

const CANDIDATE_PORT_OVERRIDES = {
  base: {
    candidateWitnessId: "a026ec8f3a7d7e9681167b2f928da372cd9a2daa6760f22d1b2a5526e0e6c8c5",
    semanticExecutableId: "80068ad1c3c2a64be356122958e0127aa0207aa2fdb9fbff4cc63d4cea6d0eff",
    vertexSpirvSha256: "808d8b0a97d7b5ec1607eb48babda58ac573f95c96493917e796d2d3e06bb27e",
    parameterEntrySha256: "9e0d5b79a355f129b7e24eb143b708336f4f2a18b008ca13dcfc803a23a3d572",
    parameterReflectionSha256: "ec66b0e072d43c359d06d0257e2d5ad1bbc86bd7425c3a8d1db2537112ab15d6",
  },
  col4: {
    candidateWitnessId: "d5f636d6f59ef28fb457d5897ede6815f1bb87b5f4c9c2f3398509a60157e249",
    semanticExecutableId: "bc1ebd48e6c776b95f1fc3878f39a31982ab80c7e6c59a4594a2586eaaa8da0b",
    vertexSpirvSha256: "972aaad150b30373099b4bfc7a028c20317a473b7db535ea4895291cc18a56af",
    parameterEntrySha256: "086e7f973d5d9aa434abaea9c53701b81c611e29b847ec6d4c24af0f8e703392",
    parameterReflectionSha256: "35ec753414857f4e779bc943247465004328f911f9daf6bc411e55bfe2b48b7a",
  },
  old_noise: {
    candidateWitnessId: "e4105d5f8bea3e72dd9572d119ac9cb86d5cdcc3d824b63269039b175953954b",
    semanticExecutableId: "fba54420bfc96aae88786583d3d6d4ed1bc449701efb0e75a1fa7b6de1f52bd5",
    vertexSpirvSha256: "808d8b0a97d7b5ec1607eb48babda58ac573f95c96493917e796d2d3e06bb27e",
    parameterEntrySha256: "26569e173d2a749745354feda9d9aaedd46747ea1b7aebbda0a0b90a2adb6f3a",
    parameterReflectionSha256: "030a0bd794970cc2c72921947dc814610e12f55622fe12285b9abdb564cc599b",
  },
};

const PORTS = BASELINE_PORTS.map((port) => {
  if (!CANDIDATE) return port;
  const override = CANDIDATE_PORT_OVERRIDES[port.id];
  assert.ok(override, `${port.id}: candidate profile is absent`);
  return {
    ...port,
    ...override,
    identityFields: {
      ...port.identityFields,
      vertexSpirvSha256: override.vertexSpirvSha256,
      parameterEntrySha256: override.parameterEntrySha256,
      ...COMMON_IDENTITY,
    },
    crossSha256: {
      ...port.crossSha256,
      vertex: "1f57876e9aad8f61db6e37a288a9312f386b3e4538f2733a1b568bc2a78c4454",
    },
  };
});

function normalizedSource(source) {
  return source.replace(/\r\n/g, "\n");
}

function replaceOnce(source, pattern, replacement, label) {
  if (typeof pattern === "string") {
    const first = source.indexOf(pattern);
    if (first < 0) throw new Error(`${label}: source pattern was not found`);
    if (source.indexOf(pattern, first + pattern.length) >= 0) {
      throw new Error(`${label}: source pattern was not unique`);
    }
    return source.slice(0, first) + replacement + source.slice(first + pattern.length);
  }
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  const matches = [...source.matchAll(new RegExp(pattern.source, flags))];
  if (matches.length !== 1) throw new Error(`${label}: expected one match, got ${matches.length}`);
  return source.replace(pattern, replacement);
}

function replaceAllExact(source, before, after, expected, label) {
  const count = source.split(before).length - 1;
  if (count !== expected) throw new Error(`${label}: expected ${expected} uses, got ${count}`);
  return source.replaceAll(before, after);
}

function interfaceRows(rows = []) {
  return rows.map(({ name, type, location }) => [name, type, location])
    .sort((left, right) => left[2] - right[2]);
}

function uboRows(rows = []) {
  return rows.map(({ name, block_size, set, binding }) => [name, block_size, set, binding])
    .sort((left, right) => left[3] - right[3]);
}

function textureRows(rows = []) {
  return rows.map(({ name, type, set, binding }) => [name, type, set, binding])
    .sort((left, right) => left[3] - right[3]);
}

function assertReflection(reflection, metadata, port) {
  assert.deepEqual(metadata.selector.keywords, port.keywords, `${port.id}: selector keywords`);
  assert.equal(
    metadata.selector.semanticExecutableId,
    port.semanticExecutableId,
    `${port.id}: semantic executable`,
  );
  assert.deepEqual(metadata.identityFields, port.identityFields, `${port.id}: executable identity`);
  assert.equal(
    metadata.artifacts.parameterEntry.byteSize,
    port.parameterBytes,
    `${port.id}: parameter byte size`,
  );
  assert.equal(
    metadata.parameterReflectionSha256,
    port.parameterReflectionSha256,
    `${port.id}: parameter reflection`,
  );
  assert.equal(metadata.parameterReflection.constantBlockCount, 4, `${port.id}: block count`);
  assert.equal(metadata.parameterReflection.resourceCount, 2, `${port.id}: resource count`);
  assert.equal(
    Object.hasOwn(metadata.shaderPropertyDefaults.floats, "_TimeParam"),
    false,
    `${port.id}: _TimeParam must remain outside serialized Material defaults`,
  );
  assert.deepEqual(
    metadata.shaderPropertyDefaults.colors._Col4,
    [1, 1, 1, 1],
    `${port.id}: _Col4 Shader default`,
  );

  const pglobals = metadata.parameterReflection.constantBuffers
    .filter((buffer) => buffer.name.startsWith("PGlobals"));
  assert.equal(pglobals.length, 1, `${port.id}: fragment PGlobals count`);
  assert.equal(pglobals[0].size, port.fragmentUboSize, `${port.id}: fragment PGlobals size`);
  assert.deepEqual(
    [...pglobals[0].fields]
      .sort((left, right) => left.offset - right.offset)
      .map(({ name, descriptor }) => [name, descriptor[2]]),
    port.fields.map(([name, type]) => [name, { float: 1, vec2: 2, vec4: 4 }[type]]),
    `${port.id}: fragment field order and width`,
  );

  assert.deepEqual(uboRows(reflection.vertex.ubos), [
    ["_56_58", 80, 1, 1],
    ["_22_24", SAMPLE.unityPerDrawSize, 1, 2],
  ], `${port.id}: vertex UBOs`);
  assert.deepEqual(uboRows(reflection.fragment.ubos), [
    ["_21_23", port.fragmentUboSize, 1, 0],
  ], `${port.id}: fragment UBO`);
  assert.deepEqual(interfaceRows(reflection.vertex.inputs), [
    ["_11", "vec4", 0],
  ], `${port.id}: vertex inputs`);
  assert.deepEqual(interfaceRows(reflection.vertex.outputs), port.vertexOutputs,
    `${port.id}: vertex outputs`);
  assert.deepEqual(interfaceRows(reflection.fragment.inputs), port.fragmentInputs,
    `${port.id}: fragment inputs`);
  assert.deepEqual(interfaceRows(reflection.fragment.outputs), port.fragmentOutputs,
    `${port.id}: fragment outputs`);
  assert.deepEqual(textureRows(reflection.vertex.textures), [], `${port.id}: vertex samplers`);
  assert.deepEqual(
    textureRows(reflection.fragment.textures),
    port.fragmentSamplers.map(([name, binding]) => [name, "sampler2D", 0, binding]),
    `${port.id}: fragment samplers`,
  );
}

function adaptVertex(source) {
  let output = normalizedSource(source);
  output = replaceOnce(output, "#version 300 es\n\n", [
    "precision highp float;",
    "precision highp int;",
    "",
  ].join("\n"), "vertex GLSL version");
  output = replaceOnce(
    output,
    /layout\(std140\) uniform _22_24[\s\S]*?}\s*_24;\s*/,
    "uniform highp mat4 modelMatrix;\n\n",
    "UnityPerDraw block",
  );
  output = replaceOnce(
    output,
    /layout\(std140\) uniform _56_58[\s\S]*?}\s*_58;\s*/,
    [
      "uniform highp mat4 viewMatrix;",
      "uniform highp mat4 projectionMatrix;",
      "uniform mediump vec4 _Col4;",
      "",
    ].join("\n"),
    "vertex variant block",
  );
  output = replaceOnce(output, "layout(location = 0) in vec4 _11;", "in vec3 position;",
    "position input");
  output = replaceOnce(output, "void main()\n{", [
    "void main()",
    "{",
    "    vec4 _11 = vec4(position, 1.0);",
    "    mat4 pcrViewProjection = projectionMatrix * viewMatrix;",
  ].join("\n"), "vertex main");
  output = replaceAllExact(output, "_24._m0", "modelMatrix", 4, "unity_ObjectToWorld");
  output = replaceAllExact(output, "_58._m0", "pcrViewProjection", 4, "unity_MatrixVP");
  output = replaceAllExact(output, "_58._m1", "_Col4", 4, "_Col4");
  output = replaceAllExact(output, "_245", "vAuraCol4", 4, "Col4 varying");
  output = replaceOnce(output, "    gl_Position.y = -gl_Position.y;\n", "",
    "Vulkan clip-space Y inversion");
  if (/layout\(std140\)|_24\.|_58\.|layout\(location\s*=\s*0\)\s+in|gl_Position\.y\s*=/.test(output)) {
    throw new Error("Card_Aura vertex adaptation is incomplete");
  }
  return `${output.trimEnd()}\n`;
}

function fragmentMemberDeclarations(source, port) {
  const block = source.match(
    /layout\(std140\) uniform _21_23\s*\{([\s\S]*?)}\s*_23;\s*/,
  );
  if (!block) throw new Error(`${port.id}: fragment UBO was not found`);
  const declarations = block[1].split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = /^(?:(highp|mediump|lowp)\s+)?(float|vec2|vec4)\s+_m(\d+);$/.exec(line);
      if (!match) throw new Error(`${port.id}: unsupported fragment member ${line}`);
      return { precision: match[1] ?? "", type: match[2], index: Number(match[3]) };
    });
  assert.deepEqual(
    declarations.map(({ index }) => index),
    declarations.map((_, index) => index),
    `${port.id}: contiguous fragment members`,
  );
  assert.deepEqual(
    declarations.map(({ type }) => type),
    port.fields.map(([, type]) => type),
    `${port.id}: fragment member types`,
  );
  return declarations;
}

function adaptFragment(source, port) {
  let output = normalizedSource(source);
  output = replaceOnce(output, "#version 300 es\n", "", `${port.id}: fragment GLSL version`);
  const declarations = fragmentMemberDeclarations(output, port);
  const uniforms = declarations.map(({ precision, type }, index) => (
    `uniform ${precision ? `${precision} ` : ""}${type} ${port.fields[index][0]};`
  )).join("\n");
  output = replaceOnce(
    output,
    /layout\(std140\) uniform _21_23[\s\S]*?}\s*_23;\s*/,
    `${uniforms}\n\n`,
    `${port.id}: fragment PGlobals`,
  );
  const usedMembers = new Set();
  output = output.replace(/_23\._m(\d+)/g, (match, rawIndex) => {
    const index = Number(rawIndex);
    const field = port.fields[index];
    if (!field) throw new Error(`${port.id}: unmapped fragment member ${match}`);
    usedMembers.add(index);
    return field[0];
  });
  assert.deepEqual(
    [...usedMembers].sort((left, right) => left - right),
    port.fields.map((_, index) => index),
    `${port.id}: active fragment members`,
  );
  if (port.id === "col4") {
    output = replaceAllExact(output, "_3379", "vAuraCol4", 2, "Col4 fragment varying");
  }
  if (/layout\(std140\)|_23\._m/.test(output)) {
    throw new Error(`${port.id}: fragment adaptation is incomplete`);
  }
  return `${output.trimEnd()}\n`;
}

function validateStage(source, stage, label) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "pcr-card-aura-stage-"));
  const file = path.join(temp, `${label}.${stage}`);
  try {
    fs.writeFileSync(file, `#version 300 es\n${source}`);
    runCommand(GLSLANG, ["-S", stage, file], { cwd: ROOT });
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

function validateLinkedProgram(vertex, fragment, label) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "pcr-card-aura-link-"));
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

function materialUniforms(port) {
  const dynamicNames = new Set(["_TimeParam", "_Transparency"]);
  const fields = port.fields.filter(([name]) => !dynamicNames.has(name));
  return {
    floats: fields.filter(([, type]) => type === "float").map(([name]) => name),
    ints: [],
    vectors: Object.fromEntries([
      ...fields.filter(([, type]) => type !== "float"),
      ["_Col4", "vec4"],
    ]),
  };
}

for (const port of PORTS) {
  let linkedVertex = null;
  const result = await generateExactSelectorPort({
    shader: SHADER,
    generatedBy: GENERATED_BY,
    ...(SAMPLE.manifest ? { officialSampleManifest: SAMPLE.manifest } : {}),
    extraction: {
      selectorId: port.selectorId,
      candidateWitnessId: port.candidateWitnessId,
      expectedProofGraphSha256: PROOF_GRAPH_SHA256,
      expectedPortIndexSha256: PORT_INDEX_SHA256,
      decryptedRoot: path.resolve(SHADER_ROOT, "..", ".."),
      ...(INVENTORY ? { inventory: INVENTORY } : {}),
      unityVersion: SAMPLE.unityVersion,
      prefix: port.stem,
      rootDir: ROOT,
      spirvCross: SPIRV_CROSS,
    },
    expectedSpirvCrossSha256: port.crossSha256,
    validateReflection(reflection, metadata) {
      assertReflection(reflection, metadata, port);
    },
    adaptVertex(source) {
      linkedVertex = adaptVertex(source);
      return linkedVertex;
    },
    adaptFragment(source) {
      const fragment = adaptFragment(source, port);
      if (linkedVertex === null) throw new Error(`${port.id}: adapted vertex source is unavailable`);
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
      shader_key: "Card_Aura",
      attributes: { position: "vec3" },
      engine_uniforms: {
        modelMatrix: "mat4",
        viewMatrix: "mat4",
        projectionMatrix: "mat4",
      },
      material_uniforms: materialUniforms(port),
      dynamic_uniforms: {
        _TimeParam: { type: "float", source: MSR_PRODUCER },
        _Transparency: { type: "float", source: MSR_PRODUCER },
      },
      require_complete_active_bindings: true,
      camera_from_view: false,
      mrt_attachments: 2,
      stencil_normalization: "none",
      stencil_face_mode: "generic",
    },
    substitutions: {
      vertex: [
        "map the official position channel to the Three.js r165 position attribute",
        "map unity_ObjectToWorld and unity_MatrixVP to Three.js engine matrices",
        "flatten the official _Col4 variant field to a typed material uniform",
        "rename the location-bound Col4 stage interface for WebGL name-based linking",
        "remove Unity Vulkan clip-space Y inversion for WebGL clip space",
      ],
      fragment: [
        "flatten the official variant-local PGlobals members without changing names, types, precision, or arithmetic",
        "rename the _USE_COL4 location-bound input for WebGL name-based linking",
        "bind _TimeParam and _Transparency through the serialized CardMSRObject renderer role",
      ],
    },
    adaptationOperations: {
      vertex: [
        { kind: "vertex-input-binding", contract: "official-bind-channels-to-three-r165" },
        { kind: "engine-uniform-binding", contract: "unity-builtins-to-three-r165" },
        { kind: "uniform-buffer-flattening", source: "mixed", preservation: "names-types-precision" },
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
          source: "variant-local",
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
      vertex: `${SAMPLE.webglSourceRoot}/${port.stem}.vert.glsl`,
      fragment: `${SAMPLE.webglSourceRoot}/${port.stem}.frag.glsl`,
    },
    manifestExtras: {
      mrt: {
        primary: port.fragmentOutputs[0][0],
        emissive: port.fragmentOutputs[1][0],
        secondary_rgb: "active",
      },
      runtime_boundaries: [{
        status: "runtime-required",
        scope: "component-uniform-producer",
        producer: MSR_PRODUCER,
        payload: ["_TimeParam", "_Transparency"],
        note: "The ARM64 producer algorithm, serialized CardMSRObject fields, MSRAnimationSettings curves, and SearchTag renderer binding are locally ported. Unity PerlinNoise, LateUpdate scheduling, and official guest MaterialPropertyBlock submission remain runtime-required.",
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
    result.samplerBindings.map(({ slot, binding }) => [slot, binding]),
    [["_AuraMask", 0], ["_FlowTex", 1], ["_FBMTex", 2]],
    `${port.id}: active sampler bindings`,
  );
}

console.log(`${CHECK ? "verified" : "generated"} ${SAMPLE.id} ${PORTS.length} Card_Aura selector ports`);
