#!/usr/bin/env node
// Generate the four selector-bound programs used by the current SAR families.
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
const PROOF_GRAPH = "307ed3660e5d3b1bfd8cf9e6b3d64e44937af215da3b6ed84ead198800eeadc4";
const PORT_INDEX = "15095f34b9e75515bbcc3924f6f8b2abb826ba96b48e819ec911486bcfa6f5a9";

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

function rows(items = [], fields) {
  return items.map((item) => Object.fromEntries(fields.map((field) => [field, item[field]])))
    .sort((left, right) => (left.location ?? left.binding) - (right.location ?? right.binding));
}

function replaceOnce(source, pattern, replacement, label) {
  const matches = source.match(pattern);
  if (!matches || matches.length !== 1) throw new Error(`${label}: expected one match`);
  return source.replace(pattern, replacement);
}

function replaceFields(source, owner, fields, label) {
  let output = source;
  for (const [index, name] of [...fields.entries()].sort(([left], [right]) => right - left)) {
    output = output.replaceAll(`${owner}._m${index}`, name);
  }
  if (new RegExp(`${owner.replace(".", "\\.")}\\._m`).test(output)) {
    throw new Error(`${label}: UBO member adaptation is incomplete`);
  }
  return output;
}

function standardVertex(source, {
  block,
  owner,
  uvName,
  normalName,
  worldPosition,
  worldNormal,
  extraUniforms = [],
  extraFields = [],
  transforms = [],
}) {
  let output = source.replace(/^#version 300 es\s*/m, [
    "precision highp float;",
    "precision highp int;",
    "uniform mat4 modelMatrix;",
    "uniform mat4 viewMatrix;",
    "uniform mat4 projectionMatrix;",
    ...extraUniforms,
    ...transforms.map(({ uniform }) => `uniform vec4 ${uniform};`),
    ...transforms.map(({ output: name }) => `vec2 ${name};`),
    "",
  ].join("\n"));
  output = replaceOnce(
    output,
    new RegExp(`layout\\(std140\\) uniform ${block}[\\s\\S]*?}\\s*${owner};\\s*`),
    "",
    `${block} declaration`,
  );
  output = output
    .replace("layout(location = 0) in vec4 _11;", "in vec3 position;")
    .replace(`layout(location = 1) in vec2 ${uvName};`, "in vec2 uv;")
    .replace(`layout(location = 2) in vec2 ${uvName};`, "in vec2 uv;")
    .replace(`layout(location = 1) in vec3 ${normalName};`, "in vec3 normal;")
    .replace(`layout(location = 2) in vec3 ${normalName};`, "in vec3 normal;")
    .replace(/void main\(\)\s*\{/, `void main()
{
    vec4 _11 = vec4(position, 1.0);
    vec2 ${uvName} = uv;
    vec3 ${normalName} = normal;
    mat4 _ObjectToWorld = modelMatrix;
    mat4 _WorldToObject = inverse(modelMatrix);
    mat4 _ViewProjection = projectionMatrix * viewMatrix;`)
    .replaceAll(`${owner}._m0`, "_ObjectToWorld")
    .replaceAll(`${owner}._m1`, "_WorldToObject")
    .replaceAll(`${owner}._m2`, "_ViewProjection");
  for (const [index, name] of extraFields.entries()) {
    output = output.replaceAll(`${owner}._m${index + 3}`, name);
  }
  for (const transform of transforms) {
    output = replaceOnce(
      output,
      new RegExp(`vec2 ${transform.temporary} = \\(${uvName} \\* ${transform.uniform}\\.xy\\) \\+ ${transform.uniform}\\.zw;`),
      `${transform.output} = (uv * ${transform.uniform}.xy) + ${transform.uniform}.zw;\n    vec2 ${transform.temporary} = ${transform.output};`,
      `${transform.uniform} transform`,
    );
  }
  output = output.replace(/^\s*gl_Position\.y\s*=\s*-gl_Position\.y;\s*$/m, "");
  if (new RegExp(`${owner.replace(".", "\\.")}\\._m|uniform ${block}|gl_Position\\.y\\s*=\\s*-gl_Position\\.y`).test(output)) {
    throw new Error(`${block}: vertex adaptation is incomplete`);
  }
  assert.ok(output.includes(`${worldPosition} =`));
  assert.ok(output.includes(`${worldNormal} =`));
  return `${output.trimEnd()}\n`;
}

function fragmentWithUbo(source, { block, owner, declarations, fields, basis, viewForward }) {
  let output = source.replace(/^#version 300 es\s*/m, "");
  output = replaceOnce(
    output,
    new RegExp(`layout\\(std140\\) uniform ${block}[\\s\\S]*?}\\s*${owner};\\s*`),
    `${declarations.join("\n")}\n`,
    `${block} declaration`,
  );
  output = replaceFields(output, owner, fields, block);
  if (basis?.length) output = adaptThreeWorldVectorsToUnityDataAxes(output, { bindings: basis });
  if (viewForward) {
    output = adaptThreeViewForwardToUnityDataAxes(output, {
      matrixName: "viewMatrix",
      targetName: viewForward,
    });
  }
  if (new RegExp(`uniform ${block}`).test(output)) throw new Error(`${block}: fragment adaptation is incomplete`);
  return `${output.trimEnd()}\n`;
}

function validateWebGlStage(source, stage) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "pcr-sar-glsl-"));
  const file = path.join(temp, `sar.${stage}`);
  try {
    fs.writeFileSync(file, `#version 300 es\n${source}`);
    runCommand(GLSLANG, ["-S", stage, file], { cwd: ROOT });
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

const doubleBasis = (position, normal) => [
  { source: "cameraPosition", alias: "pcrUnityCameraPosition", expectedOccurrences: 1 },
  { source: position, alias: "pcrUnityWorldPosition", expectedOccurrences: 1 },
  { source: normal, alias: "pcrUnityWorldNormal", expectedOccurrences: 3 },
];
const doubleFloats = [
  "_GradationStartPos", "_GradationEndPos", "_GradationPower", "_HoloMaskPower",
  "_MetallicMaskPower", "_Shininess", "_BaseColorIntensity", "_SpecularIntensity",
  "_DiffractionIntensity", "_DiffractionPower", "_RampRepeat", "_RampSpeed",
  "_RampOffset", "_RampInterval", "_RampUVOffset", "_RampUVTiltOffset",
  "_PhaseScale", "_RampScale", "_PhaseRotate", "_RampRotate", "_HoloAlphaBlend",
  "_FrontMaskPower", "_AlphaBlend",
];

const PORTS = [
  {
    id: "card_illust_double_texture",
    selectorId: "7dae42622712e1b4ed3d0fed49274e9e0bbd37ad63d058db1e151f9c2736d7c0",
    candidateWitnessId: "7281055a2695341a7d8b9c743344955b9aef75b0858ba6f462f6577b615f7191",
    shader: "Lettuce/Common/CardNew/Face/Card_Illust_DoubleTexture",
    shaderKey: "Card_Illust_DoubleTexture",
    semanticExecutableId: "a744b0e61272b96b7b95d93e570ad109f3e94bc3ec3d002154ee0f91b69c59b9",
    cross: {
      vertex: "88fc3caeeb669e813b29695973eabb9c8c2d26ef3e5366f84cf3e5f4c47bb319",
      fragment: "2daa2dea2e37ca9c2938fec95cbaf85c4962a025829c6c345644cb52834a349c",
    },
    fragmentBlock: "_15_17",
    fragmentOwner: "_17",
    fragmentFields: [
      "cameraPosition", "viewMatrix", "_GradationStartPos", "_GradationEndPos",
      "_GradationPower", "_MetallicUseR", "_HoloMaskPower", "_MetallicMaskPower",
      "_Shininess", "_BaseColorIntensity", "_SpecularIntensity", "_DiffractionIntensity",
      "_DiffractionPower", "_RampRepeat", "_RampSpeed", "_RampOffset", "_RampInterval",
      "_RampUVOffset", "_RampUVTiltOffset", "_PhaseScale", "_RampScale", "_PhaseRotate",
      "_RampRotate", "_HoloAlphaBlend", "_FrontMaskPower", "_AlphaBlend", "_Rotation",
    ],
    fragmentDeclarations: [
      "uniform highp vec3 cameraPosition;", "uniform highp mat4 viewMatrix;",
      "uniform highp float _GradationStartPos;", "uniform highp float _GradationEndPos;",
      "uniform highp float _GradationPower;", "uniform int _MetallicUseR;",
      "uniform highp float _HoloMaskPower;", "uniform highp float _MetallicMaskPower;",
      ...doubleFloats.slice(5).map((name) => `uniform mediump float ${name};`),
      "uniform mediump vec3 _Rotation;",
    ],
    fragmentBasis: doubleBasis("vs_TEXCOORD2", "vs_TEXCOORD3"),
    viewForward: "_239",
    outputs: [["_960", "vec4", 0], ["_962", "vec4", 1]],
    samplers: [
      ["_105", "sampler2D", 0], ["_128", "sampler2D", 1], ["_413", "samplerCube", 2],
      ["_680", "sampler2D", 3], ["_801", "sampler2D", 4], ["_889", "sampler2D", 5],
      ["_549", "sampler2D", 6], ["_921", "sampler2D", 7],
    ],
    materialFloats: doubleFloats,
    materialInts: ["_MetallicUseR"],
    mrt: ["_960", "_962"],
  },
  {
    id: "card_illust_double_texture_gradation",
    selectorId: "e8237752a8ea484b2617cc40e805471be76d1ef2b96170809d9b2ebfbc8dcc77",
    candidateWitnessId: "4f9e990e7bb17f97ce3fa0b361317bf1d8ae390922b134e568bd7d0d7035de55",
    shader: "Lettuce/Common/CardNew/Face/Card_Illust_DoubleTexture",
    shaderKey: "Card_Illust_DoubleTexture",
    semanticExecutableId: "668d04b08ac8e6eaa395d2ded60fa1365528382c5c11d7beae73229966fcc634",
    cross: {
      vertex: "88fc3caeeb669e813b29695973eabb9c8c2d26ef3e5366f84cf3e5f4c47bb319",
      fragment: "c046c7e8c0e31dd1bf4f73f0b460dab0cc08a1c640fa52bad59d1494387ae508",
    },
    fragmentBlock: "_19_21",
    fragmentOwner: "_21",
    fragmentFields: [
      "cameraPosition", "viewMatrix", "_GradationPower", "_MetallicUseR",
      "_HoloMaskPower", "_MetallicMaskPower", "_Shininess", "_BaseColorIntensity",
      "_SpecularIntensity", "_DiffractionIntensity", "_DiffractionPower", "_RampRepeat",
      "_RampSpeed", "_RampOffset", "_RampInterval", "_RampUVOffset", "_RampUVTiltOffset",
      "_PhaseScale", "_RampScale", "_PhaseRotate", "_RampRotate", "_HoloAlphaBlend",
      "_FrontMaskPower", "_AlphaBlend", "_Rotation",
    ],
    fragmentDeclarations: [
      "uniform highp vec3 cameraPosition;", "uniform highp mat4 viewMatrix;",
      "uniform highp float _GradationPower;", "uniform int _MetallicUseR;",
      "uniform highp float _HoloMaskPower;", "uniform highp float _MetallicMaskPower;",
      ...doubleFloats.slice(5).map((name) => `uniform mediump float ${name};`),
      "uniform mediump vec3 _Rotation;",
    ],
    fragmentBasis: doubleBasis("vs_TEXCOORD2", "vs_TEXCOORD3"),
    viewForward: "_82",
    outputs: [["_893", "vec4", 0], ["_895", "vec4", 1]],
    samplers: [
      ["_668", "sampler2D", 0], ["_450", "sampler2D", 1], ["_569", "samplerCube", 2],
      ["_99", "sampler2D", 3], ["_731", "sampler2D", 4], ["_830", "sampler2D", 5],
      ["_428", "sampler2D", 6], ["_856", "sampler2D", 7],
    ],
    materialFloats: doubleFloats.filter((name) => !["_GradationStartPos", "_GradationEndPos"].includes(name)),
    materialInts: ["_MetallicUseR"],
    mrt: ["_893", "_895"],
  },
  {
    id: "transparent_hologram_layer",
    selectorId: "e4dd72dbfb23c06de8ea03b949f04c83899f83e5ca8026a64a2e5e61613cd53c",
    candidateWitnessId: "99e646ebcd42d4c407758b90977df456a708594ea1fbaf09929744be5b39cd5b",
    shader: "Lettuce/Common/CardNew/ShadowBox/UI/Transparent_HologramLayer",
    shaderKey: "Transparent_HologramLayer",
    semanticExecutableId: "d827d70f0685165747116301ffb5e72d9c700edd850f019cb0d9eb3dbce37fb4",
    cross: {
      vertex: "941de2db0d2a134f3cd8b8ecd96d460e1a30cee60740b588d0cbe15910b75160",
      fragment: "f05ec85a501c7e12de6d083ebde5be1759f0cd8fb2c73c906a70941595113606",
    },
    vertexUv: "_100",
    vertexNormal: "_103",
    vertexInputs: [["_11", "vec4", 0], ["_100", "vec2", 1], ["_103", "vec3", 2]],
    vertexOutputs: [["vs_TEXCOORD0", "vec2", 0], ["vs_TEXCOORD1", "vec3", 1], ["vs_TEXCOORD2", "vec3", 2]],
    fragmentInputs: [["vs_TEXCOORD0", "vec2", 0], ["vs_TEXCOORD1", "vec3", 1], ["vs_TEXCOORD2", "vec3", 2]],
    fragmentBlock: "_18_20",
    fragmentOwner: "_20",
    fragmentFields: [
      "cameraPosition", "viewMatrix", "_MetallicMaskPower", "_Shininess",
      "_BaseColorIntensity", "_SpecularIntensity", "_DiffractionIntensity",
      "_DiffractionPower", "_RampRepeat", "_RampSpeed", "_RampOffset",
      "_RampInterval", "_AlphaBlend", "_Rotation",
    ],
    fragmentDeclarations: [
      "uniform highp vec3 cameraPosition;", "uniform highp mat4 viewMatrix;",
      "uniform highp float _MetallicMaskPower;",
      ...["_Shininess", "_BaseColorIntensity", "_SpecularIntensity", "_DiffractionIntensity",
        "_DiffractionPower", "_RampRepeat", "_RampSpeed", "_RampOffset", "_RampInterval",
        "_AlphaBlend"].map((name) => `uniform mediump float ${name};`),
      "uniform mediump vec3 _Rotation;",
    ],
    fragmentBasis: doubleBasis("vs_TEXCOORD1", "vs_TEXCOORD2"),
    viewForward: "_109",
    outputs: [["_650", "vec4", 0], ["_652", "vec4", 1]],
    samplers: [
      ["_316", "sampler2D", 0], ["_268", "samplerCube", 1], ["_462", "sampler2D", 2],
      ["_564", "sampler2D", 3], ["_620", "sampler2D", 4],
    ],
    materialFloats: [
      "_MetallicMaskPower", "_Shininess", "_BaseColorIntensity", "_SpecularIntensity",
      "_DiffractionIntensity", "_DiffractionPower", "_RampRepeat", "_RampSpeed",
      "_RampOffset", "_RampInterval", "_AlphaBlend",
    ],
    materialInts: [],
    cubeDefault: "shaderlab-white",
    stencilNormalization: "disable-when-always-keep",
    mrt: ["_650", "_652"],
  },
  {
    id: "card_shadowbox_ui_transparent_rainbow",
    selectorId: "fa259d9df52a3143db1333fa064f07819aeff7f7b4c034bfeb31341a96e1bc4a",
    candidateWitnessId: "d8f87a6565c65cca98b4fbbb418a2c37282ba4923b420a912412af19a1b1da91",
    shader: "Lettuce/Common/CardNew/ShadowBox/UI/Card_ShadowBoxUI_Transparent_Rainbow",
    shaderKey: "Card_ShadowBoxUI_Transparent_Rainbow",
    semanticExecutableId: "caa7c09e0638d1adb4561d86dc78c6b7c236d3d6bf67ca3c0923c77d7397b94d",
    cross: {
      vertex: "bdb7a88a3058348f21a587cdf1cf95181544e6d27e18d8ff8491c098fa08e320",
      fragment: "fe24409d5e2b054c95aace261c25917aceb52757cbcee6c96c15440314c3f148",
    },
    vertexBlock: "_19_21",
    vertexOwner: "_21",
    vertexUv: "_99",
    vertexNormal: "_116",
    vertexInputs: [["_11", "vec4", 0], ["_99", "vec2", 1], ["_116", "vec3", 2]],
    vertexOutputs: [
      ["vs_TEXCOORD0", "vec4", 0], ["vs_TEXCOORD2", "vec3", 1],
      ["vs_TEXCOORD3", "vec4", 2], ["vs_TEXCOORD4", "vec4", 3],
      ["vs_TEXCOORD1", "vec3", 4],
    ],
    fragmentInputs: [
      ["vs_TEXCOORD0", "vec4", 0], ["vs_TEXCOORD2", "vec3", 1],
      ["vs_TEXCOORD3", "vec4", 2], ["vs_TEXCOORD4", "vec4", 3],
    ],
    vertexExtraFields: [
      "_RainbowTex_ST", "_RainbowOutlineTex_ST", "_RainbowBGTex_ST", "_RainbowTintMask_ST",
    ],
    transforms: [
      { uniform: "_RainbowTintMask_ST", slot: "_RainbowTintMask", input: "uv", output: "pcrRainbowTintUv", temporary: "_109", member: 6 },
      { uniform: "_RainbowTex_ST", slot: "_RainbowTex", input: "uv", output: "pcrRainbowUv", temporary: "_161", member: 3 },
      { uniform: "_RainbowOutlineTex_ST", slot: "_RainbowOutlineTex", input: "uv", output: "pcrRainbowOutlineUv", temporary: "_173", member: 4 },
      { uniform: "_RainbowBGTex_ST", slot: "_RainbowBGTex", input: "uv", output: "pcrRainbowBgUv", temporary: "_186", member: 5 },
    ],
    fragmentBlock: "_33_35",
    fragmentOwner: "_35",
    fragmentFields: [
      "_RainbowTintColor", "_RainbowAnimationScale", "_RainbowOutlineAnimationScale",
      "_RainbowBGAnimationScale", "_EmitMasking", "_Rotation",
    ],
    fragmentDeclarations: [
      "uniform mediump vec4 _RainbowTintColor;",
      "uniform highp vec2 _RainbowAnimationScale;",
      "uniform highp vec2 _RainbowOutlineAnimationScale;",
      "uniform highp vec2 _RainbowBGAnimationScale;",
      "uniform mediump float _EmitMasking;",
      "uniform mediump vec3 _Rotation;",
    ],
    fragmentBasis: [
      { source: "vs_TEXCOORD2", alias: "pcrUnityWorldNormal", expectedOccurrences: 3 },
    ],
    outputs: [["_287", "vec4", 0], ["_309", "vec4", 1]],
    samplers: [
      ["_226", "sampler2D", 0], ["_188", "sampler2D", 1], ["_143", "sampler2D", 2],
      ["_208", "sampler2D", 3], ["_280", "sampler2D", 4], ["_172", "sampler2D", 5],
    ],
    materialFloats: ["_EmitMasking"],
    materialInts: [],
    materialVectors: {
      _RainbowTintColor: "vec4",
      _RainbowAnimationScale: "vec2",
      _RainbowOutlineAnimationScale: "vec2",
      _RainbowBGAnimationScale: "vec2",
      _Rotation: "vec3",
    },
    mrt: ["_287", "_309"],
  },
];

for (const port of PORTS) {
  const vertexInputs = port.vertexInputs
    || [["_11", "vec4", 0], ["_103", "vec3", 1], ["_100", "vec2", 2]];
  const vertexOutputs = port.vertexOutputs
    || [["vs_TEXCOORD0", "vec2", 0], ["vs_TEXCOORD2", "vec3", 1], ["vs_TEXCOORD3", "vec3", 2]];
  const fragmentInputs = port.fragmentInputs || vertexOutputs;
  const vertexBlock = port.vertexBlock || "_19_21";
  const vertexOwner = port.vertexOwner || "_21";
  const basis = port.fragmentBasis || [];
  const result = await generateExactSelectorPort({
    extraction: {
      selectorId: port.selectorId,
      candidateWitnessId: port.candidateWitnessId,
      expectedProofGraphSha256: PROOF_GRAPH,
      expectedPortIndexSha256: PORT_INDEX,
      decryptedRoot: path.resolve(SHADER_ROOT, "..", ".."),
      prefix: port.id,
      rootDir: ROOT,
    },
    shader: port.shader,
    generatedBy: "build/build-exact-sar.mjs",
    expectedSpirvCrossSha256: port.cross,
    spirvCross: SPIRV_CROSS,
    passPolicy: PASS_POLICY,
    joinConstantBufferStages: true,
    validateReflection(reflection) {
      assert.deepEqual(
        rows(reflection.vertex.inputs, ["name", "type", "location"]),
        vertexInputs.map(([name, type, location]) => ({ name, type, location })),
      );
      assert.deepEqual(
        rows(reflection.vertex.outputs, ["name", "type", "location"]),
        vertexOutputs.map(([name, type, location]) => ({ name, type, location })),
      );
      assert.deepEqual(
        rows(reflection.fragment.inputs, ["name", "type", "location"]),
        fragmentInputs.map(([name, type, location]) => ({ name, type, location })),
      );
      assert.deepEqual(
        rows(reflection.fragment.outputs, ["name", "type", "location"]),
        port.outputs.map(([name, type, location]) => ({ name, type, location })),
      );
      assert.deepEqual(
        rows(reflection.fragment.textures, ["name", "type", "binding"]),
        port.samplers.map(([name, type, binding]) => ({ name, type, binding })),
      );
    },
    adaptVertex(source) {
      return standardVertex(source, {
        block: vertexBlock,
        owner: vertexOwner,
        uvName: port.vertexUv || "_100",
        normalName: port.vertexNormal || "_103",
        worldPosition: port.vertexOutputs ? "vs_TEXCOORD1" : "vs_TEXCOORD2",
        worldNormal: port.vertexOutputs ? "vs_TEXCOORD2" : "vs_TEXCOORD3",
        extraFields: port.vertexExtraFields || [],
        transforms: port.transforms || [],
      });
    },
    adaptFragment(source) {
      return fragmentWithUbo(source, {
        block: port.fragmentBlock,
        owner: port.fragmentOwner,
        declarations: port.fragmentDeclarations,
        fields: port.fragmentFields,
        basis,
        viewForward: port.viewForward,
      });
    },
    validateWebGlStage,
    substitutions: {
      vertex: [
        "map official position/normal/UV0 locations to Three.js r165 attributes",
        "map Unity object/world/view-projection matrices to Three.js engine uniforms",
        ...(port.transforms?.length
          ? ["map serialized Unity TexEnv transforms to Three.js GLTF V-axis convention"]
          : []),
        "remove Unity Vulkan clip-space Y inversion for WebGL clip space",
      ],
      fragment: [
        "expand official constant-buffer members into same-name engine/material uniforms",
        "convert Three world-space vectors to Unity data axes before official arithmetic",
        ...(port.viewForward ? ["convert Three reconstructed camera-forward vector to Unity data axes"] : []),
      ],
    },
    adaptationOperations: {
      vertex: [
        { kind: "vertex-input-binding", contract: "official-bind-channels-to-three-r165" },
        { kind: "engine-uniform-binding", contract: "unity-builtins-to-three-r165" },
        { kind: "uniform-buffer-flattening", source: port.id.includes("rainbow") ? "serialized-common" : "variant-local", preservation: "names-types-precision" },
        ...(port.transforms?.length
          ? [{ kind: "texture-coordinate-basis-conversion", contract: "unity-texenv-to-three-gltf-uv" }]
          : []),
        { kind: "clip-space-y-conversion", from: "unity-vulkan", to: "webgl", operation: "remove-y-inversion" },
        { kind: "glsl-version-ownership", owner: "three-raw-shader-material" },
      ],
      fragment: [
        { kind: "engine-uniform-binding", contract: "unity-builtins-to-three-r165" },
        { kind: "uniform-buffer-flattening", source: port.id.includes("rainbow") ? "serialized-common" : "variant-local", preservation: "names-types-precision" },
        { kind: "object-basis-conversion", contract: "unity-to-three-basis" },
        { kind: "glsl-version-ownership", owner: "three-raw-shader-material" },
      ],
    },
    webglSources: {
      vertex: `public/shaders/${port.id}.vert.glsl`,
      fragment: `public/shaders/${port.id}.frag.glsl`,
    },
    runtimeContract: {
      schema: "pocket-card-render/webgl-runtime-port@1",
      shader_key: port.shaderKey,
      attributes: { position: "vec3", normal: "vec3", uv: "vec2" },
      engine_uniforms: {
        modelMatrix: "mat4",
        viewMatrix: "mat4",
        projectionMatrix: "mat4",
        ...(basis.some(({ source }) => source === "cameraPosition") ? { cameraPosition: "vec3" } : {}),
      },
      material_uniforms: {
        floats: port.materialFloats,
        ints: port.materialInts,
        vectors: port.materialVectors || { _Rotation: "vec3" },
      },
      ...(port.transforms?.length ? { texture_coordinates: { vertex: { transforms: port.transforms.map(
        ({ uniform, slot, input, output }) => ({
          uniform, slot, input, output, conversion: "unity-texenv-to-three-gltf-v",
        }),
      ) } } } : {}),
      require_complete_active_bindings: true,
      camera_from_view: basis.some(({ source }) => source === "cameraPosition"),
      mrt_attachments: 2,
      stencil_normalization: port.stencilNormalization || "none",
      stencil_face_mode: "generic",
      ...(port.cubeDefault ? { backend_texture_defaults: { _CubeMap: port.cubeDefault } }
        : port.shaderKey === "Card_Illust_DoubleTexture"
          ? { backend_texture_defaults: { _CubeMap: "shaderlab-black" } }
          : {}),
      backend_basis_conversions: { fragment: { worldVectors: basis, ...(port.viewForward
        ? { viewForwards: [{ matrixName: "viewMatrix", targetName: port.viewForward }] }
        : {}) } },
    },
    manifestExtras: {
      mrt: { primary: port.mrt[0], secondary: port.mrt[1] },
    },
    output: {
      outDir: path.join(ROOT, "public", "shaders"),
      vertex: `${port.id}.vert.glsl`,
      fragment: `${port.id}.frag.glsl`,
      manifest: `${port.id}_uniforms.json`,
      check: CHECK,
    },
  });
  assert.equal(result.manifest.official_selector.semanticExecutableId, port.semanticExecutableId);
}

console.log(`${CHECK ? "verified" : "generated"} ${PORTS.length} SAR selector-bound official programs`);
