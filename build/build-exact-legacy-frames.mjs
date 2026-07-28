#!/usr/bin/env node
// Generate the two legacy frame shaders from selector-bound official Unity bytes.
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
import { CARD_MRR_PRODUCER_SCHEMA } from "../public/render/card-mrr.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHADER_ROOT = process.env.PCR_SHADERS
  || "D:/DevProjectes/ptcgp-tools-master/masterdata_decoder/.output/decrypted/Common/Shader";
const SPIRV_CROSS = process.env.SPIRV_CROSS || "spirv-cross";
const GLSLANG = process.env.GLSLANG_VALIDATOR || "glslangValidator";
const OUT = path.join(ROOT, "public", "shaders");
const CHECK = process.argv.includes("--check") || process.env.PCR_EXACT_CHECK === "1";
const GENERATED_BY = "build/build-exact-legacy-frames.mjs";
const PROOF_GRAPH_SHA256 =
  "307ed3660e5d3b1bfd8cf9e6b3d64e44937af215da3b6ed84ead198800eeadc4";
const PORT_INDEX_SHA256 =
  "15095f34b9e75515bbcc3924f6f8b2abb826ba96b48e819ec911486bcfa6f5a9";
const CUT_OFF_PRODUCER =
  "pocket-card-render/official-guest-common-value-unresolved@1";
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
const VERTEX_MEMBERS = ["_ObjectToWorld", "_WorldToObject", "_ViewProjection"];
const VERTEX_REFLECTION = {
  ubo: {
    name: "_19_21",
    blockSize: 192,
    set: 1,
    binding: 1,
    members: [
      { name: "_m0", type: "vec4", offset: 0, array: [4] },
      { name: "_m1", type: "vec4", offset: 64, array: [4] },
      { name: "_m2", type: "vec4", offset: 128, array: [4] },
    ],
  },
  inputs: [
    { name: "_11", type: "vec4", location: 0 },
    { name: "_103", type: "vec3", location: 1 },
    { name: "_100", type: "vec2", location: 2 },
  ],
  outputs: [
    { name: "vs_TEXCOORD0", type: "vec2", location: 0 },
    { name: "vs_TEXCOORD2", type: "vec3", location: 1 },
    { name: "vs_TEXCOORD3", type: "vec3", location: 2 },
  ],
  textures: [],
};

const PORTS = [
  {
    shader: "Lettuce/Common/CardNew/Face/Frame-Holo",
    shaderKey: "Frame-Holo",
    stem: "frame_holo_legacy",
    selectorId: "bcb60b22bef8badefd443c779615ba8418fbf9be6d959747838cb91b1f825ec5",
    candidateWitnessId:
      "a21d03fd70814fd48331b13450dfb9a6b9e9c779c75a9864cd4ef9e4756b989c",
    semanticExecutableId:
      "2f338e90fce4d7ccc74a2e5e1e714f2c54fa863bd8687ecd27d853946f7d527c",
    parameterReflectionSha256:
      "4a7626f8d5a79b8c0efbd1043332c2e95484f399c8be0a3fe6fed9e681d22f78",
    identity: {
      vertexSpirvSha256:
        "4515eaaf9618a9cd541debc5e611b41fc8e16d74992f9e7791865f6e26fd5e8e",
      fragmentSpirvSha256:
        "da261f7dcc2d0cd15537d7cbb2fbd7db9e442ca8740173b05a28c185d6c9c515",
      parameterEntrySha256:
        "a36efdacc42b931c4df05bd420ce18b1f8b4f80692cfeadfd6537e215a2f9fb5",
      passStateSha256:
        "8209040065479b2f0b4665dcd0772e83cdc3e5d2046fec0bd468a5c551c0e815",
      commonBindingsSha256:
        "48b0df0da0a2978fb826a5ee8bf9faf5d3e37459a06dfb3c13fd6d05aee8e22b",
    },
    spirvCrossSha256: {
      vertex: "88fc3caeeb669e813b29695973eabb9c8c2d26ef3e5366f84cf3e5f4c47bb319",
      fragment: "ec02997fc1af197b6e71e0321be7ee3b13e31eb348f1b6b8fc2d4d11ee9f5b50",
    },
    fragment: {
      block: "_45_47",
      owner: "_47",
      blockSize: 188,
      members: [
        { name: "_m0", type: "vec3", offset: 0 },
        { name: "_m1", type: "vec4", offset: 16, array: [4] },
        { name: "_m2", type: "int", offset: 80 },
        { name: "_m3", type: "int", offset: 84 },
        ...Array.from({ length: 20 }, (_, index) => ({
          name: `_m${index + 4}`,
          type: "float",
          offset: 88 + index * 4,
        })),
        { name: "_m24", type: "vec3", offset: 176 },
      ],
      declarations: [
        "uniform highp vec3 cameraPosition;",
        "uniform highp mat4 viewMatrix;",
        "uniform int _IsPreMultiply;",
        "uniform int _MetallicUseR;",
        "uniform float _Shininess;",
        "uniform float _BaseColorIntensity;",
        "uniform float _SpecularIntensity;",
        "uniform float _DiffractionIntensity;",
        "uniform float _DiffractionPower;",
        "uniform float _RampRepeat;",
        "uniform float _RampSpeed;",
        "uniform float _RampOffset;",
        "uniform float _RampInterval;",
        "uniform float _RampUVOffset;",
        "uniform float _RampUVTiltOffset;",
        "uniform float _PhaseScale;",
        "uniform float _RampScale;",
        "uniform float _PhaseRotate;",
        "uniform float _RampRotate;",
        "uniform float _HoloAlphaBlend;",
        "uniform float _FrontMaskPower;",
        "uniform float _MaskEmissive;",
        "uniform float _AlphaBlend;",
        "uniform float _CutOff;",
        "uniform vec3 _Rotation;",
      ],
      mapping: [
        "cameraPosition", "viewMatrix", "_IsPreMultiply", "_MetallicUseR",
        "_Shininess", "_BaseColorIntensity", "_SpecularIntensity",
        "_DiffractionIntensity", "_DiffractionPower", "_RampRepeat", "_RampSpeed",
        "_RampOffset", "_RampInterval", "_RampUVOffset", "_RampUVTiltOffset",
        "_PhaseScale", "_RampScale", "_PhaseRotate", "_RampRotate",
        "_HoloAlphaBlend", "_FrontMaskPower", "_MaskEmissive", "_AlphaBlend",
        "_CutOff", "_Rotation",
      ],
      viewForwardTarget: "_81",
      inputs: [
        { name: "vs_TEXCOORD0", type: "vec2", location: 0 },
        { name: "vs_TEXCOORD2", type: "vec3", location: 1 },
        { name: "vs_TEXCOORD3", type: "vec3", location: 2 },
      ],
      outputs: [
        { name: "_834", type: "vec4", location: 0 },
        { name: "_846", type: "vec4", location: 1 },
      ],
      textures: [
        { name: "_24", type: "sampler2D", set: 0, binding: 0 },
        { name: "_13", type: "sampler2D", set: 0, binding: 1 },
        { name: "_707", type: "samplerCube", set: 0, binding: 2 },
        { name: "_531", type: "sampler2D", set: 0, binding: 3 },
        { name: "_134", type: "sampler2D", set: 0, binding: 4 },
        { name: "_477", type: "sampler2D", set: 0, binding: 5 },
        { name: "_587", type: "sampler2D", set: 0, binding: 6 },
      ],
    },
    samplerBindings: [
      { slot: "_BaseTex", spirvName: "_24", binding: 0 },
      { slot: "_MaskTex", spirvName: "_13", binding: 1 },
      { slot: "_CubeMap", spirvName: "_707", binding: 2 },
      { slot: "_PhaseTex", spirvName: "_531", binding: 3 },
      { slot: "_RampMaskTex", spirvName: "_134", binding: 4 },
      { slot: "_RampTex", spirvName: "_477", binding: 5 },
      { slot: "_HologramFrontMaskTex", spirvName: "_587", binding: 6 },
    ],
    material: {
      floats: [
        "_Shininess", "_BaseColorIntensity", "_SpecularIntensity",
        "_DiffractionIntensity", "_DiffractionPower", "_RampRepeat", "_RampSpeed",
        "_RampOffset", "_RampInterval", "_RampUVOffset", "_RampUVTiltOffset",
        "_PhaseScale", "_RampScale", "_PhaseRotate", "_RampRotate",
        "_HoloAlphaBlend", "_FrontMaskPower", "_MaskEmissive", "_AlphaBlend",
      ],
      ints: ["_IsPreMultiply", "_MetallicUseR"],
      vectors: { _Rotation: "vec3" },
    },
    mrt: {
      primary: "_834",
      emissive: "_846",
      secondary_rgb: "zero",
      secondary_alpha: "base-alpha-times-mask-emissive",
    },
  },
  {
    shader: "Lettuce/Common/CardNew/Face/Frame-Holo-2Layer",
    shaderKey: "Frame-Holo-2Layer",
    stem: "frame_holo_2layer_legacy",
    selectorId: "a9ecd9600fcbad72d48f2a364c224375e92811abd07d0d0b7e11c8e702dee08f",
    candidateWitnessId:
      "fc8db10bf97b53bf25837c24994dbee26b2837bb791924748b0a1173b8d7406e",
    semanticExecutableId:
      "d196292de8129740491c0793a9542a49aa9eb6b3af79112d36a80455b654d95c",
    parameterReflectionSha256:
      "83267265310d41db97820c5fe09327b2fcb93472c353a66b9560b23135a631f3",
    identity: {
      vertexSpirvSha256:
        "4515eaaf9618a9cd541debc5e611b41fc8e16d74992f9e7791865f6e26fd5e8e",
      fragmentSpirvSha256:
        "58538306d8600225388a55361e155242e2d4e18f3b82f5eb96c1e3e9026df35d",
      parameterEntrySha256:
        "7d9a95f08912b3303c1db6fc2360d7e1091a23d548fe9dec4a9c684982f1776a",
      passStateSha256:
        "3ecaf8702406b9e91199740b38fd36f99131fb6e92104ef24cae1055fc5ac009",
      commonBindingsSha256:
        "273776b2a082459e4c2f5a389260ffeda398d36844b8d4ca8cd5606ba38269d5",
    },
    spirvCrossSha256: {
      vertex: "88fc3caeeb669e813b29695973eabb9c8c2d26ef3e5366f84cf3e5f4c47bb319",
      fragment: "490988447464d011e69a4496594ca87ad72bb20928b7d4abb436bc517e8c095f",
    },
    fragment: {
      block: "_32_34",
      owner: "_34",
      blockSize: 204,
      members: [
        { name: "_m0", type: "vec3", offset: 0 },
        { name: "_m1", type: "vec4", offset: 16, array: [4] },
        { name: "_m2", type: "int", offset: 80 },
        ...Array.from({ length: 19 }, (_, index) => ({
          name: `_m${index + 3}`,
          type: "float",
          offset: 84 + index * 4,
        })),
        { name: "_m22", type: "vec2", offset: 160 },
        ...Array.from({ length: 4 }, (_, index) => ({
          name: `_m${index + 23}`,
          type: "float",
          offset: 168 + index * 4,
        })),
        { name: "_m27", type: "vec3", offset: 192 },
      ],
      declarations: [
        "uniform highp vec3 cameraPosition;",
        "uniform highp mat4 viewMatrix;",
        "uniform int _IsPreMultiply;",
        "uniform float _Shininess;",
        "uniform float _BaseColorIntensity;",
        "uniform float _SpecularIntensity;",
        "uniform float _DiffractionIntensity;",
        "uniform float _DiffractionPower;",
        "uniform float _RampRepeat;",
        "uniform float _RampSpeed;",
        "uniform float _RampOffset;",
        "uniform float _RampInterval;",
        "uniform float _RampUVOffset;",
        "uniform float _RampUVTiltOffset;",
        "uniform float _PhaseScale;",
        "uniform float _RampScale;",
        "uniform float _PhaseRotate;",
        "uniform float _RampRotate;",
        "uniform float _HoloAlphaBlend;",
        "uniform float _FrontMaskPower;",
        "uniform highp float _Layer2UVRotate;",
        "uniform highp float _Layer2UVScale;",
        "uniform highp vec2 _Layer2UVTranslate;",
        "uniform float _Layer2ColorPower;",
        "uniform float _Layer2EmissiveIntensity;",
        "uniform float _AlphaBlend;",
        "uniform float _CutOff;",
        "uniform vec3 _Rotation;",
      ],
      mapping: [
        "cameraPosition", "viewMatrix", "_IsPreMultiply", "_Shininess",
        "_BaseColorIntensity", "_SpecularIntensity", "_DiffractionIntensity",
        "_DiffractionPower", "_RampRepeat", "_RampSpeed", "_RampOffset",
        "_RampInterval", "_RampUVOffset", "_RampUVTiltOffset", "_PhaseScale",
        "_RampScale", "_PhaseRotate", "_RampRotate", "_HoloAlphaBlend",
        "_FrontMaskPower", "_Layer2UVRotate", "_Layer2UVScale",
        "_Layer2UVTranslate", "_Layer2ColorPower", "_Layer2EmissiveIntensity",
        "_AlphaBlend", "_CutOff", "_Rotation",
      ],
      viewForwardTarget: "_69",
      inputs: [
        { name: "vs_TEXCOORD0", type: "vec2", location: 0 },
        { name: "vs_TEXCOORD2", type: "vec3", location: 1 },
        { name: "vs_TEXCOORD3", type: "vec3", location: 2 },
      ],
      outputs: [
        { name: "_956", type: "vec4", location: 0 },
        { name: "_941", type: "vec4", location: 1 },
      ],
      textures: [
        { name: "_13", type: "sampler2D", set: 0, binding: 0 },
        { name: "_770", type: "sampler2D", set: 0, binding: 1 },
        { name: "_709", type: "samplerCube", set: 0, binding: 2 },
        { name: "_538", type: "sampler2D", set: 0, binding: 3 },
        { name: "_125", type: "sampler2D", set: 0, binding: 4 },
        { name: "_482", type: "sampler2D", set: 0, binding: 5 },
        { name: "_808", type: "sampler2D", set: 0, binding: 6 },
        { name: "_892", type: "sampler2D", set: 0, binding: 7 },
        { name: "_901", type: "sampler2D", set: 0, binding: 8 },
      ],
    },
    samplerBindings: [
      { slot: "_HologramMaskTex", spirvName: "_13", binding: 0 },
      { slot: "_Layer1Tex", spirvName: "_770", binding: 1 },
      { slot: "_CubeMap", spirvName: "_709", binding: 2 },
      { slot: "_PhaseTex", spirvName: "_538", binding: 3 },
      { slot: "_RampMaskTex", spirvName: "_125", binding: 4 },
      { slot: "_RampTex", spirvName: "_482", binding: 5 },
      { slot: "_HologramFrontMaskTex", spirvName: "_808", binding: 6 },
      { slot: "_Layer2Tex", spirvName: "_892", binding: 7 },
      { slot: "_Layer2Mask", spirvName: "_901", binding: 8 },
    ],
    material: {
      floats: [
        "_Shininess", "_BaseColorIntensity", "_SpecularIntensity",
        "_DiffractionIntensity", "_DiffractionPower", "_RampRepeat", "_RampSpeed",
        "_RampOffset", "_RampInterval", "_RampUVOffset", "_RampUVTiltOffset",
        "_PhaseScale", "_RampScale", "_PhaseRotate", "_RampRotate",
        "_HoloAlphaBlend", "_FrontMaskPower", "_Layer2UVRotate", "_Layer2UVScale",
        "_AlphaBlend",
      ],
      ints: ["_IsPreMultiply"],
      vectors: { _Rotation: "vec3" },
    },
    mrt: {
      primary: "_956",
      emissive: "_941",
      secondary_rgb: "layer2-color-times-emissive-intensity",
      secondary_alpha: "layer1-alpha",
    },
  },
];

function interfaceRows(items = []) {
  return items.map(({ name, type, location }) => ({ name, type, location }))
    .sort((left, right) => left.location - right.location);
}

function resourceRows(items = []) {
  return items.map(({ name, type, set, binding }) => ({ name, type, set, binding }))
    .sort((left, right) => left.binding - right.binding);
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

function assertStageReflection(reflection, expected) {
  const block = memberRows(reflection, expected.ubo.name);
  assert.deepEqual(
    {
      blockSize: block.ubo.block_size,
      set: block.ubo.set,
      binding: block.ubo.binding,
      members: block.members,
    },
    {
      blockSize: expected.ubo.blockSize,
      set: expected.ubo.set,
      binding: expected.ubo.binding,
      members: expected.ubo.members,
    },
  );
  assert.deepEqual(interfaceRows(reflection.inputs), expected.inputs);
  assert.deepEqual(interfaceRows(reflection.outputs), expected.outputs);
  assert.deepEqual(resourceRows(reflection.textures), expected.textures);
}

function validateReflection(reflection, metadata, port) {
  assert.deepEqual(metadata.selector.keywords, []);
  assert.equal(metadata.selector.selectionMode, "unique-exact-keywords");
  assert.equal(metadata.selector.semanticExecutableId, port.semanticExecutableId);
  assert.deepEqual(metadata.identityFields, port.identity);
  assert.equal(metadata.parameterReflectionSha256, port.parameterReflectionSha256);
  assert.equal(metadata.artifacts.parameterEntry.byteSize, 100);
  assert.equal(metadata.parameterReflection.bindingClosure.constantBuffersMatch, true);
  assertStageReflection(reflection.vertex, VERTEX_REFLECTION);
  assertStageReflection(reflection.fragment, {
    ubo: {
      name: port.fragment.block,
      blockSize: port.fragment.blockSize,
      set: 1,
      binding: 0,
      members: port.fragment.members,
    },
    inputs: port.fragment.inputs,
    outputs: port.fragment.outputs,
    textures: port.fragment.textures,
  });
}

function replaceUbo(source, block, owner, declarations) {
  const pattern = new RegExp(`layout\\(std140\\) uniform ${block}[\\s\\S]*?}\\s*${owner};\\s*`);
  const output = source.replace(pattern, `${declarations.join("\n")}\n\n`);
  if (output === source) throw new Error(`${block}: UBO replacement failed`);
  return output;
}

function replaceMembers(source, owner, members) {
  return source.replace(new RegExp(`${owner}\\._m(\\d+)`, "g"), (match, rawIndex) => {
    const value = members[Number(rawIndex)];
    if (value == null) throw new Error(`unmapped ${match}`);
    return value;
  });
}

function adaptVertex(source) {
  let output = source.replace(
    /^#version 300 es\s*/m,
    "precision highp float;\nprecision highp int;\n\n",
  );
  output = replaceUbo(output, "_19_21", "_21", [
    "uniform highp mat4 modelMatrix;",
    "uniform highp mat4 viewMatrix;",
    "uniform highp mat4 projectionMatrix;",
  ]);
  output = output
    .replace("layout(location = 0) in vec4 _11;", "in vec3 position;")
    .replace("layout(location = 1) in vec3 _103;", "in vec3 normal;")
    .replace("layout(location = 2) in vec2 _100;", "in vec2 uv;")
    .replace(/void main\(\)\s*\{/, `void main()
{
    vec4 _11 = vec4(position, 1.0);
    vec3 _103 = normal;
    vec2 _100 = uv;
    mat4 _ObjectToWorld = modelMatrix;
    mat4 _WorldToObject = inverse(modelMatrix);
    mat4 _ViewProjection = projectionMatrix * viewMatrix;`);
  output = replaceMembers(output, "_21", VERTEX_MEMBERS);
  output = output.replace(/^\s*gl_Position\.y\s*=\s*-gl_Position\.y;\s*$/m, "");
  if (/_21\._m|layout\(std140\)|gl_Position\.y\s*=\s*-gl_Position\.y/.test(output)) {
    throw new Error("legacy frame vertex adaptation is incomplete");
  }
  return `${output.trimEnd()}\n`;
}

function fragmentBasisConversions(port) {
  return {
    objectMatrices: [],
    worldVectors: [
      {
        source: "cameraPosition",
        alias: "pcrUnityCameraPosition",
        expectedOccurrences: 1,
      },
      {
        source: "vs_TEXCOORD2",
        alias: "pcrUnityWorldPosition",
        expectedOccurrences: 1,
      },
      {
        source: "vs_TEXCOORD3",
        alias: "pcrUnityWorldNormal",
        expectedOccurrences: 3,
      },
    ],
    viewForwards: [{ matrixName: "viewMatrix", targetName: port.fragment.viewForwardTarget }],
  };
}

function adaptFragment(source, port) {
  let output = source.replace(/^#version 300 es\s*/m, "");
  output = replaceUbo(
    output,
    port.fragment.block,
    port.fragment.owner,
    port.fragment.declarations,
  );
  output = replaceMembers(output, port.fragment.owner, port.fragment.mapping);
  const basis = fragmentBasisConversions(port);
  output = adaptThreeWorldVectorsToUnityDataAxes(output, {
    bindings: basis.worldVectors,
  });
  output = adaptThreeViewForwardToUnityDataAxes(output, basis.viewForwards[0]);
  if (new RegExp(`${port.fragment.owner}\\._m|layout\\(std140\\)`).test(output)) {
    throw new Error(`${port.shaderKey}: fragment adaptation is incomplete`);
  }
  return `${output.trimEnd()}\n`;
}

function validateStage(source, stage, stem) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), `pcr-${stem}-stage-`));
  const file = path.join(temp, `${stem}.${stage}`);
  try {
    fs.writeFileSync(file, `#version 300 es\n${source}`);
    runCommand(GLSLANG, ["-S", stage, file], { cwd: ROOT });
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

function validateLinkedProgram(vertex, fragment, stem) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), `pcr-${stem}-link-`));
  try {
    const vertexFile = path.join(temp, `${stem}.vert`);
    const fragmentFile = path.join(temp, `${stem}.frag`);
    fs.writeFileSync(vertexFile, `#version 300 es\n${vertex}`);
    fs.writeFileSync(fragmentFile, `#version 300 es\n${fragment}`);
    runCommand(GLSLANG, ["-l", vertexFile, fragmentFile], { cwd: ROOT });
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

for (const port of PORTS) {
  let linkedVertex = null;
  const basis = fragmentBasisConversions(port);
  const cardMRRDynamic = port.shaderKey === "Frame-Holo-2Layer"
    ? {
        _Layer2UVTranslate: {
          type: "vec2",
          source: CARD_MRR_PRODUCER_SCHEMA,
        },
        _Layer2ColorPower: {
          type: "float",
          source: CARD_MRR_PRODUCER_SCHEMA,
        },
        _Layer2EmissiveIntensity: {
          type: "float",
          source: CARD_MRR_PRODUCER_SCHEMA,
        },
      }
    : {};
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
    expectedSpirvCrossSha256: port.spirvCrossSha256,
    validateReflection(reflection, metadata) {
      validateReflection(reflection, metadata, port);
    },
    adaptVertex(source) {
      linkedVertex = adaptVertex(source);
      return linkedVertex;
    },
    adaptFragment(source) {
      const fragment = adaptFragment(source, port);
      assert.ok(linkedVertex, `${port.shaderKey}: adapted vertex source is unavailable`);
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
      attributes: { position: "vec3", normal: "vec3", uv: "vec2" },
      engine_uniforms: {
        modelMatrix: "mat4",
        viewMatrix: "mat4",
        projectionMatrix: "mat4",
        cameraPosition: "vec3",
      },
      material_uniforms: port.material,
      dynamic_uniforms: {
        _CutOff: { type: "float", source: CUT_OFF_PRODUCER },
        ...cardMRRDynamic,
      },
      require_complete_active_bindings: true,
      camera_from_view: true,
      mrt_attachments: 2,
      stencil_normalization: "disable-when-always-keep",
      stencil_face_mode: "generic",
      backend_texture_defaults: { _CubeMap: "neutral-gray-cube" },
      backend_basis_conversions: { fragment: basis },
    },
    substitutions: {
      vertex: [
        "map official Vertex/Normal/UV0 channels to Three.js r165 position/normal/uv",
        "map Unity object/world/view-projection matrices to Three.js engine uniforms",
        "flatten serialized-common VGlobals to same-type WebGL uniforms",
        "remove Unity Vulkan clip-space Y inversion for WebGL clip space",
      ],
      fragment: [
        "flatten serialized-common PGlobals to same-name typed WebGL uniforms",
        "convert Three camera, world-position, world-normal, and view-forward values to Unity data axes before official frame arithmetic",
        "keep active serialized-common _CutOff distinct from inactive Shader property _CutOut and require its official guest value at runtime",
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
        { kind: "object-basis-conversion", contract: "unity-to-three-basis" },
        {
          kind: "dynamic-uniform-producer-binding",
          contract: "runtime-producer-to-three-uniforms",
        },
        { kind: "glsl-version-ownership", owner: "three-raw-shader-material" },
      ],
    },
    webglSources: {
      vertex: `public/shaders/${port.stem}.vert.glsl`,
      fragment: `public/shaders/${port.stem}.frag.glsl`,
    },
    manifestExtras: {
      mrt: port.mrt,
      runtime_boundaries: [
        {
          status: "runtime-required",
          scope: "official-common-uniform-value",
          producer: CUT_OFF_PRODUCER,
          payload: ["_CutOff"],
          note: "Official common bindings expose active _CutOff, while serialized Shader properties expose only inactive _CutOut. The port preserves the official active name and does not infer an alias or submitted guest value.",
        },
        {
          status: "runtime-required",
          scope: "official-guest-cubemap-descriptor",
          payload: ["_CubeMap"],
          note: "The Shader property has an empty cube default. neutral-gray-cube is an explicit WebGL backend fallback, not a claim about the official guest descriptor.",
        },
        ...(port.shaderKey === "Frame-Holo-2Layer" ? [{
          status: "known-implementation",
          scope: "CardMRRObject-LateUpdate-MaterialPropertyBlock",
          producer: CARD_MRR_PRODUCER_SCHEMA,
          payload: Object.keys(cardMRRDynamic),
          note: "IL2CPP method bodies, serialized MRRAnimationSettings curves, SearchTag renderer grouping, and local state-machine implementation are bound. Official guest frame scheduling and MPB submission remain runtime evidence boundaries.",
        }] : []),
      ],
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
  );
}

console.log(
  `${CHECK ? "verified" : "generated"} Frame-Holo and Frame-Holo-2Layer from selector-bound official SPIR-V`,
);
