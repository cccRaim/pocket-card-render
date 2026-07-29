#!/usr/bin/env node
// Generate the four Mega RR programs from selector-bound official Unity shader bytes.
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  adaptThreeViewForwardToUnityDataAxes,
  adaptThreeWorldVectorsToUnityDataAxes,
  generateExactSelectorPort,
} from "./exact-selector-port-core.mjs";
import {
  CARD_MRR_MATERIAL_OVERRIDE_PRODUCER_SCHEMA,
  CARD_MRR_PRODUCER_SCHEMA,
} from "../public/render/card-mrr.js";

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
      out: path.join(LOCAL_DECODER_ROOT, ".output-full", "webgl-ports", "mega-rr"),
      webglSourceRoot: "candidate/ptcgp-1.7.0-unity-6000.0.69f1/shaders",
      proofGraphSha256: "65acde2d29ba8c255f02f9a1eaf4e4d8cdeff9eeedf3d42b89a527cf8d99fa1a",
      portIndexSha256: "2c8231200339ab77a1dc191d26aa2ce83aaaceba7c97d7726d08b3f3f9f8dc2b",
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
    };
const DECRYPTED_ROOT = path.resolve(process.env.PCR_DECRYPTED_ROOT || SAMPLE.decryptedRoot);
const SHADER_ROOT = process.env.PCR_SHADERS
  || path.join(DECRYPTED_ROOT, "Common", "Shader");
const INVENTORY = process.env.PCR_PROGRAM_INVENTORY
  ? path.resolve(process.env.PCR_PROGRAM_INVENTORY)
  : SAMPLE.inventory;
const OUT = path.resolve(process.env.PCR_SHADER_OUT || SAMPLE.out);
const CHECK = process.argv.includes("--check") || process.env.PCR_EXACT_CHECK === "1";
const PROOF_GRAPH_SHA256 = SAMPLE.proofGraphSha256;
const PORT_INDEX_SHA256 = SAMPLE.portIndexSha256;
const GENERATED_BY = "build/build-exact-mega-rr.mjs";
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

function rows(items = []) {
  return items.map(({ name, type, location }) => ({ name, type, location }))
    .sort((left, right) => left.location - right.location);
}

function replaceUbo(source, block, owner, uniforms) {
  const pattern = new RegExp(`layout\\(std140\\) uniform ${block}[\\s\\S]*?}\\s*${owner};\\s*`);
  const output = source.replace(pattern, `${uniforms.join("\n")}\n\n`);
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

function finishVertex(source, owner) {
  const output = source
    .replace(/^\s*gl_Position\.y\s*=\s*-gl_Position\.y;\s*$/m, "")
    .replace(/[ \t]+$/gm, "");
  if (new RegExp(`${owner}\\._m|gl_Position\\.y\\s*=\\s*-gl_Position\\.y`).test(output)) {
    throw new Error(`${owner}: vertex adaptation is incomplete`);
  }
  return `${output.trimEnd()}\n`;
}

function adaptParallaxVertex(source, flash) {
  const owner = "_23";
  const normal = flash ? "_87" : "_86";
  const tangent = flash ? "_107" : "_106";
  const tangentLocation = flash ? 3 : 4;
  const uv = flash ? "_317" : "_302";
  let output = source.replace(
    /^#version 300 es\s*/m,
    "precision highp float;\nprecision highp int;\n\n",
  );
  output = replaceUbo(output, "_21_23", owner, [
    "uniform highp mat4 modelMatrix;",
    "uniform highp mat4 viewMatrix;",
    "uniform highp mat4 projectionMatrix;",
    "uniform highp vec3 cameraPosition;",
    "uniform highp float _FakeCameraHeight;",
    "uniform highp float _Height;",
    "uniform highp float _HeightPower;",
    "uniform highp float _Scale;",
    ...(flash
      ? ["uniform highp vec2 _ScaleCenter;", "uniform highp float _RadialScaling;"]
      : ["uniform int _UseUv;"]),
  ]);
  output = output
    .replace("layout(location = 0) in vec4 _11;", "in vec3 position;")
    .replace(`layout(location = 1) in vec3 ${normal};`, "in vec3 normal;")
    .replace(
      `layout(location = ${tangentLocation}) in mediump vec4 ${tangent};`,
      "in vec4 tangent;",
    )
    .replace(
      `layout(location = 2) in vec2 ${uv};`,
      flash ? "in vec2 uv1;" : "in vec2 uv;",
    );
  if (!flash) {
    output = output.replace("layout(location = 3) in vec2 _305;", "in vec2 uv1;");
  }
  output = output.replace(/void main\(\)\s*\{/, `void main()
{
    vec4 _11 = vec4(position, 1.0);
    vec3 ${normal} = normal;
    vec4 ${tangent} = tangent;
    vec2 ${uv} = ${flash ? "uv1" : "uv"};
    ${flash ? "" : "vec2 _305 = uv1;"}
    mat4 _WorldToObject = inverse(modelMatrix);
    mat4 _ViewProjection = projectionMatrix * viewMatrix;`);
  output = replaceMembers(output, owner, [
    "cameraPosition",
    "modelMatrix",
    "_WorldToObject",
    "_ViewProjection",
    "_FakeCameraHeight",
    "_Height",
    "_HeightPower",
    "_Scale",
    flash ? "_ScaleCenter" : "_UseUv",
    ...(flash ? ["_RadialScaling"] : []),
  ]);
  if (/layout\(location\s*=\s*\d+\)\s+in\b/.test(output)) {
    throw new Error(`${flash ? "Card_Parallax_Flash" : "Card_Parallax_MRR"}: unmapped vertex input`);
  }
  return finishVertex(output, owner);
}

function adaptEffectVertex(source) {
  const owner = "_20";
  let output = source.replace(
    /^#version 300 es\s*/m,
    "precision highp float;\nprecision highp int;\n\n",
  );
  output = replaceUbo(output, "_18_20", owner, [
    "uniform highp mat4 modelMatrix;",
    "uniform highp mat4 viewMatrix;",
    "uniform highp mat4 projectionMatrix;",
    "uniform highp float _UVScale;",
  ]);
  output = output
    .replace("layout(location = 0) in vec4 _11;", "in vec3 position;")
    .replace("layout(location = 1) in mediump vec2 _84;", "in vec2 uv;")
    .replace(/void main\(\)\s*\{/, `void main()
{
    vec4 _11 = vec4(position, 1.0);
    vec2 _84 = uv;
    mat4 _ViewProjection = projectionMatrix * viewMatrix;`);
  output = replaceMembers(output, owner, ["modelMatrix", "_ViewProjection", "_UVScale"]);
  return finishVertex(output, owner);
}

function adaptShadowFlashVertex(source) {
  const owner = "_21";
  let output = source.replace(
    /^#version 300 es\s*/m,
    "precision highp float;\nprecision highp int;\n\n",
  );
  output = replaceUbo(output, "_19_21", owner, [
    "uniform highp mat4 modelMatrix;",
    "uniform highp mat4 viewMatrix;",
    "uniform highp mat4 projectionMatrix;",
  ]);
  output = output
    .replace("layout(location = 0) in vec4 _11;", "in vec3 position;")
    .replace("layout(location = 1) in vec3 _97;", "in vec3 normal;")
    .replace("layout(location = 2) in vec2 _87;", "in vec2 uv;")
    .replace("layout(location = 3) in vec2 _91;", "in vec2 uv1;")
    .replace("layout(location = 4) in vec4 _136;", "in vec4 color;")
    .replace(/void main\(\)\s*\{/, `void main()
{
    vec4 _11 = vec4(position, 1.0);
    vec3 _97 = normal;
    vec2 _87 = uv;
    vec2 _91 = uv1;
    vec4 _136 = color;
    mat4 _WorldToObject = inverse(modelMatrix);
    mat4 _ViewProjection = projectionMatrix * viewMatrix;`);
  output = replaceMembers(output, owner, ["modelMatrix", "_WorldToObject", "_ViewProjection"]);
  return finishVertex(output, owner);
}

function adaptFragment(source, spec) {
  let output = source.replace(/^#version 300 es\s*/m, "");
  output = replaceUbo(output, spec.block, spec.owner, spec.uniforms);
  output = replaceMembers(output, spec.owner, spec.members);
  if (spec.worldNormal) {
    output = adaptThreeWorldVectorsToUnityDataAxes(output, {
      bindings: [{
        source: "vs_TEXCOORD1",
        alias: "pcrUnityWorldNormal",
        expectedOccurrences: 4,
      }],
    });
    output = adaptThreeViewForwardToUnityDataAxes(output, {
      matrixName: "viewMatrix",
      targetName: "_77",
    });
  }
  if (new RegExp(`${spec.owner}\\._m`).test(output)) {
    throw new Error(`${spec.owner}: fragment adaptation is incomplete`);
  }
  return `${output.trimEnd()}\n`;
}

const BASELINE_PORTS = [
  {
    shaderKey: "Flash",
    shaderName: "Lettuce/Common/CardNew/ShadowBox/Flash",
    stem: "shadowbox_flash",
    selectorId: "82528f3915b2b361479e0df196542fbf1ee40311c5b45fd2651300216150dd9c",
    candidateWitnessId: "a259f140ec37538c50c25a2ec3cc706b45df7c99babf81183ac34a910244e3f0",
    semanticExecutableId: "da63c896af4e50c7744377fdbb7c3670aa85157ec56d3b154dcb330921b1be6e",
    parameterReflectionSha256: "dcb8c19c5eaa3b124f539444cc9ecaee196f8e1b25dbc3133320637a3fb8f95b",
    cross: {
      vertex: "c2be9abd9feaf2729953126d1e2dc346cf45014d07ce35ad0c3e83a10cc63f30",
      fragment: "055720addebafc5e6346f07e018389b4a632cb82b3bb9a604b0df5c89968d4b1",
    },
    vertex: {
      block: "_19_21", size: 192, adapt: adaptShadowFlashVertex,
      inputs: [[0, "vec4", "_11"], [1, "vec3", "_97"], [2, "vec2", "_87"], [3, "vec2", "_91"], [4, "vec4", "_136"]],
      outputs: [[0, "vec4", "vs_TEXCOORD0"], [1, "vec3", "vs_TEXCOORD1"], [2, "float", "vs_TEXCOORD2"]],
    },
    fragment: {
      block: "_35_37", owner: "_37", size: 188, worldNormal: true,
      uniforms: [
        "uniform highp mat4 viewMatrix;",
        "uniform float _ChangeColor;", "uniform highp float _LightColorIntensity;",
        "uniform highp float _LightEmitIntensity;", "uniform highp float _LightPower;",
        "uniform highp vec3 _FlashBrightColor;", "uniform highp vec3 _FlashDarkColor;",
        "uniform highp float _GradationPower;", "uniform highp float _FlashIntensity;",
        "uniform float _DiffractionIntensity;", "uniform float _DiffractionPower;",
        "uniform float _RampRepeat;", "uniform float _RampSpeed;", "uniform float _RampOffset;",
        "uniform float _RampInterval;", "uniform int _TiltEnabled;", "uniform float _TiltPower;",
        "uniform float _TiltOffset;", "uniform float _TiltIntensity;",
        "uniform int _Transparent;", "uniform highp float _LightAreaAlphaBlend;",
        "uniform vec3 _Rotation;",
      ],
      members: [
        "viewMatrix", "_ChangeColor", "_LightColorIntensity", "_LightEmitIntensity",
        "_LightPower", "_FlashBrightColor", "_FlashDarkColor", "_GradationPower",
        "_FlashIntensity", "_DiffractionIntensity", "_DiffractionPower", "_RampRepeat",
        "_RampSpeed", "_RampOffset", "_RampInterval", "_TiltEnabled", "_TiltPower",
        "_TiltOffset", "_TiltIntensity", "_LightAreaAlphaBlend", "_Transparent", "_Rotation",
      ],
      inputs: [[0, "vec4", "vs_TEXCOORD0"], [1, "vec3", "vs_TEXCOORD1"], [2, "float", "vs_TEXCOORD2"]],
      outputs: [[0, "vec4", "_1123"], [1, "vec4", "_1142"]],
    },
    samplerSlots: ["_MainTex", "_ChangeColorTex", "_PhaseTex", "_RampMaskTex", "_RampTex", "_HologramMaskTex", "_FlashMaskTex"],
    attributes: { position: "vec3", normal: "vec3", uv: "vec2", uv1: "vec2", color: "vec4" },
    materialUniforms: {
      floats: [
        "_GradationPower",
        "_FlashIntensity", "_DiffractionIntensity", "_DiffractionPower", "_RampRepeat",
        "_RampSpeed", "_RampOffset", "_RampInterval", "_TiltPower", "_TiltOffset",
        "_TiltIntensity", "_LightAreaAlphaBlend",
      ],
      ints: ["_TiltEnabled", "_Transparent"],
      vectors: { _FlashBrightColor: "vec3", _FlashDarkColor: "vec3", _Rotation: "vec3" },
    },
    dynamic: Object.fromEntries(
      ["_ChangeColor", "_LightColorIntensity", "_LightEmitIntensity", "_LightPower"]
        .map((name) => [name, { type: "float", source: CARD_MRR_PRODUCER_SCHEMA }]),
    ),
    mrt: { primary: "_1123", emissive: "_1142" },
  },
  {
    shaderKey: "Effect_Emit",
    shaderName: "Lettuce/Common/CardNew/Effect_Emit",
    stem: "effect_emit",
    selectorId: "544caf61fc34579c64a93d58a9aa3419cb919a178d12771de701042e3de2bd02",
    candidateWitnessId: "84babac1bb73867d8d7ad8bd3e1568087b6d426dc3a813afc65038838c1e18ed",
    semanticExecutableId: "458ce7cb5789a213b88b416dfc4c4c4fd77ca7923f74f966cd3f45148cb39cbe",
    parameterReflectionSha256: "7666ade9134aa8a4609119906d5b4d92b3eb3ef6c2f5137c4a3efc636ece6622",
    cross: {
      vertex: "0cc677ebc94012cff0e0594453778e4ee604d995dcabd430678d2c6822041afc",
      fragment: "55f4d03be990fbd559df8fab96bc8b6dd5dd853352fbc9edb3fb15c609a7369d",
    },
    vertex: {
      block: "_18_20", size: 132, adapt: adaptEffectVertex,
      inputs: [[0, "vec4", "_11"], [1, "vec2", "_84"]],
      outputs: [[0, "vec2", "vs_TEXCOORD0"]],
    },
    fragment: {
      block: "_12_14", owner: "_14", size: 72,
      uniforms: [
        "uniform highp float _Switch;", "uniform int _UseColor3Mask;",
        "uniform vec4 _Color3;", "uniform highp float _AdditiveIntensity;",
        "uniform int _OnColor1Area;", "uniform int _UseColor3Blend;",
        "uniform highp float _Color3Blend;", "uniform highp float _Color3BlendMax;",
        "uniform int _UseEmissive;", "uniform highp float _EmissiveIntensity;",
        "uniform int _UseEmissiveMask;", "uniform float _Color1AlphaBlend;",
        "uniform float _NotColor1AreaAlphaBlend;",
      ],
      members: [
        "_Switch", "_UseColor3Mask", "_Color3", "_AdditiveIntensity", "_OnColor1Area",
        "_UseColor3Blend", "_Color3Blend", "_Color3BlendMax", "_UseEmissive",
        "_EmissiveIntensity", "_UseEmissiveMask", "_Color1AlphaBlend",
        "_NotColor1AreaAlphaBlend",
      ],
      inputs: [[0, "vec2", "vs_TEXCOORD0"]],
      outputs: [[0, "vec4", "_200"], [1, "vec4", "_272"]],
    },
    samplerSlots: ["_Color1Tex", "_Color2Tex", "_Color3Mask", "_EmissiveMask"],
    attributes: { position: "vec3", uv: "vec2" },
    materialUniforms: {
      floats: [
        "_UVScale", "_Color3BlendMax", "_Color1AlphaBlend",
        "_NotColor1AreaAlphaBlend",
      ],
      ints: ["_UseColor3Mask", "_OnColor1Area", "_UseColor3Blend", "_UseEmissive", "_UseEmissiveMask"],
      vectors: { _Color3: "vec4" },
    },
    dynamic: Object.fromEntries(
      ["_Switch", "_AdditiveIntensity", "_Color3Blend", "_EmissiveIntensity"]
        .map((name) => [name, {
          type: "float",
          source: CARD_MRR_MATERIAL_OVERRIDE_PRODUCER_SCHEMA,
        }]),
    ),
    mrt: { primary: "_200", emissive: "_272" },
  },
  {
    shaderKey: "Card_Parallax_MRR",
    shaderName: "Lettuce/Common/CardNew/Face/Card_Parallax_MRR",
    stem: "card_parallax_mrr",
    selectorId: "b29c4ba1a2496615aacd7565709c049b2deb3ec072529c40484baa5958ae655b",
    candidateWitnessId: "d22e51506c21931d0653e5d0d144d685ed52ac70befc01573acc40ddb190cc40",
    semanticExecutableId: "e900653278f9a8f83a5e7d22edb388dbecc726775bfaedaf9c574986ced897eb",
    parameterReflectionSha256: "4ba1d5c2ccdfe798790d83fb0a241fd414e7f39f518262fc834a19235a5ab632",
    cross: {
      vertex: "551ab90c5d9366750ea80f4dbbf0660e09792ebf7f18973d5af4fb5293c04819",
      fragment: "c7c4858bd3da10c7ba7d84483009600eccc7cdecb38f9c1ee7f1b3b57d913730",
    },
    vertex: {
      block: "_21_23", size: 228, adapt: (source) => adaptParallaxVertex(source, false),
      inputs: [[0, "vec4", "_11"], [1, "vec3", "_86"], [2, "vec2", "_302"], [3, "vec2", "_305"], [4, "vec4", "_106"]],
      outputs: [[0, "vec2", "vs_TEXCOORD0"]],
    },
    fragment: {
      block: "_10_12", owner: "_12", size: 56,
      uniforms: [
        "uniform float _ChangeColor;", "uniform highp float _LightColorIntensity;",
        "uniform highp float _LightEmitIntensity;", "uniform highp float _LightPower;",
        "uniform highp vec3 _FlashBrightColor;", "uniform highp vec3 _FlashDarkColor;",
        "uniform highp float _GradationPower;", "uniform highp float _FlashIntensity;",
        "uniform float _LightAreaAlphaBlend;",
      ],
      members: [
        "_ChangeColor", "_LightColorIntensity", "_LightEmitIntensity", "_LightPower",
        "_FlashBrightColor", "_FlashDarkColor", "_GradationPower", "_FlashIntensity",
        "_LightAreaAlphaBlend",
      ],
      inputs: [[0, "vec2", "vs_TEXCOORD0"]],
      outputs: [[0, "vec4", "_608"], [1, "vec4", "_617"]],
    },
    samplerSlots: ["_MainTex", "_ChangeColorTex", "_FlashMaskTex"],
    attributes: { position: "vec3", normal: "vec3", tangent: "vec4", uv: "vec2", uv1: "vec2" },
    materialUniforms: {
      floats: [
        "_GradationPower",
        "_FlashIntensity", "_FakeCameraHeight", "_Height", "_HeightPower",
        "_Scale", "_LightAreaAlphaBlend",
      ],
      ints: ["_UseUv"],
      vectors: { _FlashBrightColor: "vec3", _FlashDarkColor: "vec3" },
    },
    dynamic: Object.fromEntries(
      ["_ChangeColor", "_LightColorIntensity", "_LightEmitIntensity", "_LightPower"]
        .map((name) => [name, { type: "float", source: CARD_MRR_PRODUCER_SCHEMA }]),
    ),
    mrt: { primary: "_608", emissive: "_617" },
  },
  {
    shaderKey: "Card_Parallax_Flash",
    shaderName: "Lettuce/Common/CardNew/Face/Card_Parallax_Flash",
    stem: "card_parallax_flash",
    selectorId: "e1578d63c26c429b7e823788110d258348305c88a706bd2b78c70b21d9b89cdd",
    candidateWitnessId: "75db875cc77d6dee514cb0b1c18828b469af2a0fbb047123b80da1fa6bcc4036",
    semanticExecutableId: "a2a84982d26012183610f99ec0834cd30d3b53c81af432adc0c8f65991c0c1d5",
    parameterReflectionSha256: "82213e4cb28e757f62dd644b3cb702ce837c0ab017117d9fc97f429c87fe6d3b",
    cross: {
      vertex: "3637a47cdfc0f906bf1a9e4a2d6d1567e5bcf3564dd354b3423265366a67022e",
      fragment: "5d48709fee22f22403f6e78d461915375e9950a686f637fbc45c1d2c78ebd806",
    },
    vertex: {
      block: "_21_23", size: 236, adapt: (source) => adaptParallaxVertex(source, true),
      inputs: [[0, "vec4", "_11"], [1, "vec3", "_87"], [2, "vec2", "_317"], [3, "vec4", "_107"]],
      outputs: [[0, "vec2", "vs_TEXCOORD0"]],
    },
    fragment: {
      block: "_12_14", owner: "_14", size: 68,
      uniforms: [
        "uniform highp float _RadialAnim;", "uniform highp vec2 _ScaleCenter;",
        "uniform highp float _RadialFlashPow;", "uniform highp float _RadialFlashRange;",
        "uniform highp float _FlashIntensity;", "uniform highp float _FlashIntensityByMat;",
        "uniform highp vec3 _BrightColor;", "uniform highp vec3 _DarkColor;",
        "uniform highp float _AlphaBlend;", "uniform highp float _EmissiveIntensity;",
      ],
      members: [
        "_RadialAnim", "_ScaleCenter", "_RadialFlashPow", "_RadialFlashRange",
        "_FlashIntensity", "_FlashIntensityByMat", "_BrightColor", "_DarkColor",
        "_AlphaBlend", "_EmissiveIntensity",
      ],
      inputs: [[0, "vec2", "vs_TEXCOORD0"]],
      outputs: [[0, "vec4", "_169"], [1, "vec4", "_182"]],
    },
    samplerSlots: ["_RadialTex"],
    attributes: { position: "vec3", normal: "vec3", tangent: "vec4", uv1: "vec2" },
    materialUniforms: {
      floats: [
        "_RadialFlashPow", "_RadialFlashRange",
        "_FlashIntensityByMat", "_AlphaBlend", "_EmissiveIntensity",
        "_FakeCameraHeight", "_Height", "_HeightPower", "_Scale",
      ],
      ints: [],
      vectors: { _ScaleCenter: "vec2", _BrightColor: "vec3", _DarkColor: "vec3" },
    },
    dynamic: Object.fromEntries(
      ["_FlashIntensity", "_RadialScaling", "_RadialAnim"]
        .map((name) => [name, { type: "float", source: CARD_MRR_PRODUCER_SCHEMA }]),
    ),
    mrt: { primary: "_169", emissive: "_182" },
  },
];

const PORTS = CANDIDATE
  ? BASELINE_PORTS
    .filter(({ shaderKey }) => shaderKey === "Flash")
    .map((port) => ({
      ...port,
      candidateWitnessId: "7e163d22f08dc70773f66920293b530c37d7f5af1136edf3d24887e75fcae3c1",
      semanticExecutableId: "dfc77dc0e742fdfbdfda5e84e1b4b5de5ac03b0f09fe7f3565a8ee0d63f2bf94",
    }))
  : BASELINE_PORTS;

const standardVertexOps = [
  { kind: "vertex-input-binding", contract: "official-bind-channels-to-three-r165" },
  { kind: "engine-uniform-binding", contract: "unity-builtins-to-three-r165" },
  { kind: "uniform-buffer-flattening", source: "serialized-common", preservation: "names-types-precision" },
  { kind: "clip-space-y-conversion", from: "unity-vulkan", to: "webgl", operation: "remove-y-inversion" },
  { kind: "glsl-version-ownership", owner: "three-raw-shader-material" },
];

for (const port of PORTS) {
  const runtimeContract = {
    schema: "pocket-card-render/webgl-runtime-port@1",
    shader_key: port.shaderKey,
    attributes: port.attributes,
    engine_uniforms: {
      modelMatrix: "mat4",
      viewMatrix: "mat4",
      projectionMatrix: "mat4",
      ...(port.shaderKey === "Effect_Emit" ? {} : { cameraPosition: "vec3" }),
    },
    material_uniforms: port.materialUniforms,
    dynamic_uniforms: port.dynamic,
    require_complete_active_bindings: true,
    camera_from_view: true,
    mrt_attachments: 2,
    stencil_normalization: "none",
    stencil_face_mode: "generic",
    ...(port.fragment.worldNormal
      ? {
          backend_basis_conversions: {
            fragment: {
              worldVectors: [{
                source: "vs_TEXCOORD1",
                alias: "pcrUnityWorldNormal",
                expectedOccurrences: 4,
              }],
              viewForwards: [{ matrixName: "viewMatrix", targetName: "_77" }],
            },
          },
        }
      : {}),
  };
  const result = await generateExactSelectorPort({
    shader: port.shaderName,
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
    },
    output: {
      outDir: OUT,
      vertex: `${port.stem}.vert.glsl`,
      fragment: `${port.stem}.frag.glsl`,
      manifest: `${port.stem}_uniforms.json`,
      check: CHECK,
    },
    expectedSpirvCrossSha256: port.cross,
    validateReflection(reflection, metadata) {
      assert.deepEqual(metadata.selector.keywords, []);
      assert.equal(metadata.selector.semanticExecutableId, port.semanticExecutableId);
      assert.equal(metadata.parameterReflectionSha256, port.parameterReflectionSha256);
      assert.equal(metadata.artifacts.parameterEntry.byteSize, 100);
      assert.deepEqual(
        reflection.vertex.ubos?.map(({ name, block_size }) => ({ name, size: block_size })),
        [{ name: port.vertex.block, size: port.vertex.size }],
      );
      assert.deepEqual(rows(reflection.vertex.inputs), port.vertex.inputs
        .map(([location, type, name]) => ({ location, type, name }))
        .sort((left, right) => left.location - right.location));
      assert.deepEqual(rows(reflection.vertex.outputs), port.vertex.outputs
        .map(([location, type, name]) => ({ location, type, name })));
      assert.deepEqual(
        reflection.fragment.ubos?.map(({ name, block_size }) => ({ name, size: block_size })),
        [{ name: port.fragment.block, size: port.fragment.size }],
      );
      assert.deepEqual(rows(reflection.fragment.inputs), port.fragment.inputs
        .map(([location, type, name]) => ({ location, type, name })));
      assert.deepEqual(rows(reflection.fragment.outputs), port.fragment.outputs
        .map(([location, type, name]) => ({ location, type, name })));
    },
    adaptVertex: port.vertex.adapt,
    adaptFragment: (source) => adaptFragment(source, port.fragment),
    joinConstantBufferStages: true,
    passPolicy: PASS_POLICY,
    runtimeContract,
    substitutions: {
      vertex: [
        "map official vertex channels to Three.js r165 attributes",
        "map Unity matrices and camera position to Three.js engine uniforms",
        "remove Unity Vulkan clip-space Y inversion for WebGL clip space",
      ],
      fragment: [
        "flatten official common-buffer members to typed Three.js uniforms",
        "preserve the official dual render-target output",
        port.shaderKey === "Effect_Emit"
          ? "bind exact Material values with draw-level CardMRRObject MaterialPropertyBlock overrides when the renderer is component-owned"
          : "bind official CardMRRObject MaterialPropertyBlock outputs through the shared component runtime producer",
      ],
    },
    adaptationOperations: {
      vertex: standardVertexOps,
      fragment: [
        { kind: "uniform-buffer-flattening", source: "serialized-common", preservation: "names-types-precision" },
        ...(port.fragment.worldNormal
          ? [{ kind: "object-basis-conversion", contract: "unity-to-three-basis" }]
          : []),
        { kind: "dynamic-uniform-producer-binding", contract: "runtime-producer-to-three-uniforms" },
        { kind: "glsl-version-ownership", owner: "three-raw-shader-material" },
      ],
    },
    webglSources: {
      vertex: `${SAMPLE.webglSourceRoot}/${port.stem}.vert.glsl`,
      fragment: `${SAMPLE.webglSourceRoot}/${port.stem}.frag.glsl`,
    },
    manifestExtras: {
      mrt: port.mrt,
      runtime_boundaries: [{
        status: "known-implementation",
        scope: port.shaderKey === "Effect_Emit"
          ? "Material-value-with-optional-CardMRRObject-override"
          : "CardMRRObject-LateUpdate-MaterialPropertyBlock",
        producer: port.shaderKey === "Effect_Emit"
          ? CARD_MRR_MATERIAL_OVERRIDE_PRODUCER_SCHEMA
          : CARD_MRR_PRODUCER_SCHEMA,
        payload: Object.keys(port.dynamic),
        note: port.shaderKey === "Effect_Emit"
          ? "The selector is shared by static SSR draws and CardMRR-owned RR draws. Exact same-name Material/Shader defaults are the base; renderer-scoped CardMRR SearchTag evidence enables the MPB override."
          : "IL2CPP method bodies, serialized component/settings curves, SearchTag renderer groups, and local state-machine implementation are bound. Official guest frame scheduling and MPB submission remain runtime evidence boundaries.",
      }],
    },
  });
  assert.deepEqual(
    result.samplerBindings.map(({ slot }) => slot),
    port.samplerSlots,
    `${port.shaderKey}: active sampler slots changed`,
  );
}

console.log(
  `${CHECK ? "verified" : "generated"} ${SAMPLE.id} ${PORTS.length} `
  + "Mega RR selector ports",
);
