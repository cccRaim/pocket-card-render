// Verify that scenes using transpiled official shader programs cannot silently
// fall back to hand ports. Presence and wiring are structural evidence only;
// they do not prove official-runtime or final-pixel parity.
import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SHADER } from "../public/render/rarities.js";
import { getMaterial } from "../public/render/registry.js";
import { SHADER_TEXTURE_DEFAULTS } from "../public/render/shader-defaults.js";
import "../public/render/materials/index.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC = path.join(ROOT, "public");

const EXACT_PORTS = {
  Card_Illust: {
    name: "card_illust",
    vert: "shaders/card_illust.vert.glsl",
    frag: "shaders/card_illust.frag.glsl",
    uniforms: "shaders/card_illust_uniforms.json",
    generatedBy: "build/build-exact-card-illust.mjs",
    requiredVert: [
      /in\s+vec3\s+position\b/,
      /in\s+vec2\s+uv\b/,
      /in\s+vec2\s+uv1\b/,
      /uniform\s+int\s+_UseUv\b/,
      /_9\.x\s*=\s*float\(_UseUv\)/,
      /_92\s*=\s*\(-_94\)\s*\+\s*_97/,
      /vs_TEXCOORD0\s*=\s*\(_9\.xx\s*\*\s*_92\)\s*\+\s*_94/,
    ],
    requiredFrag: [
      /uniform\s+mediump\s+sampler2D\s+_13\b/,
      /layout\s*\(\s*location\s*=\s*0\s*\)\s*out\s+highp\s+vec4\s+_9\b/,
      /layout\s*\(\s*location\s*=\s*1\s*\)\s*out\s+highp\s+vec4\s+_20\b/,
      /_9\s*=\s*texture\(_13,\s*vs_TEXCOORD0\)/,
      /_20\s*=\s*vec4\(0\.0\)/,
    ],
    samplers: ["_13"],
    samplerSlots: ["_MainTex"],
  },
  Card_Prism: {
    name: "card_prism",
    vert: "shaders/card_prism.vert.glsl",
    frag: "shaders/card_prism.frag.glsl",
    uniforms: "shaders/card_prism_uniforms.json",
    generatedBy: "build/build-exact-card-prism.mjs",
    requiredKeywords: [],
    requiredVert: [
      /in\s+vec3\s+position\b/,
      /in\s+vec2\s+uv\b/,
      /in\s+vec2\s+uv1\b/,
      /uniform\s+float\s+uTime\b/,
      /\(uTime\s*\*\s*0\.05\)/,
      /mat4\s+_ObjectToWorld\s*=\s*modelMatrix/,
      /mat4\s+_ViewProjection\s*=\s*projectionMatrix\s*\*\s*viewMatrix/,
      /^((?!gl_Position\.y\s*=\s*-gl_Position\.y).)*$/s,
    ],
    requiredFrag: [
      /uniform\s+mediump\s+sampler2D\s+_29\b/,
      /uniform\s+int\s+_ColoringMethod\b/,
      /uniform\s+int\s+_OkLabBlend\b/,
      /texture\(_29,\s*vs_TEXCOORD0\)/,
      /layout\(location = 0\) out highp vec4 _349/,
      /layout\(location = 1\) out highp vec4 _361/,
    ],
    samplers: ["_29"],
    samplerSlots: ["_BaseTex"],
    mrt: { primary: "_349", emissive: "_361", secondary_rgb: "active" },
  },
  Card_Circular_Moving_Kira: {
    name: "circular_moving",
    generatedBy: "build/build-exact-circular-kira.mjs",
    selectorManifests: [
      ["shaders/circular_moving_p0_uniforms.json", []],
      ["shaders/circular_moving_p1_uniforms.json", []],
    ],
    acceptedMaterialKeywordSets: [[]],
  },
  Card_Circular_Trail_Kira: {
    name: "circular_trail",
    generatedBy: "build/build-exact-circular-kira.mjs",
    selectorManifests: [
      ["shaders/circular_trail_p0_uniforms.json", []],
      ["shaders/circular_trail_p1_uniforms.json", []],
    ],
    acceptedMaterialKeywordSets: [[]],
  },
  Frame: {
    name: "frame",
    vert: "shaders/textured.vert.glsl",
    frag: "shaders/frame.frag.glsl",
    uniforms: "shaders/frame_uniforms.json",
    generatedBy: "build/build-exact-flat-mrt.mjs",
    requiredVert: [
      /in\s+vec3\s+position\b/,
      /in\s+vec2\s+uv\b/,
      /out\s+vec2\s+vs_TEXCOORD0\b/,
    ],
    requiredFrag: [
      /uniform\s+mediump\s+sampler2D\s+_13\b/,
      /uniform\s+mediump\s+float\s+_EmitMasking\b/,
      /_21\s*=\s*_9/,
      /_9\.w\s*\*=\s*_EmitMasking/,
      /_45\s*=\s*_9/,
    ],
    samplers: ["_13"],
    samplerSlots: ["_BaseTex"],
  },
  "Simple-Opaque": {
    name: "simple_opaque",
    vert: "shaders/textured.vert.glsl",
    frag: "shaders/simple_opaque.frag.glsl",
    uniforms: "shaders/simple_uniforms.json",
    requiredVert: [
      /in\s+vec3\s+position\b/,
      /in\s+vec2\s+uv\b/,
      /out\s+vec2\s+vs_TEXCOORD0\b/,
    ],
    requiredFrag: [
      /uniform\s+mediump\s+sampler2D\s+_13\b/,
      /_9\s*=\s*texture\(_13,\s*vs_TEXCOORD0\)/,
      /_20\s*=\s*vec4\(0\.0\)/,
    ],
    samplers: ["_13"],
    samplerSlots: ["_MainTex"],
  },
  "Simple-Transparent": {
    name: "simple_transparent",
    vert: "shaders/textured.vert.glsl",
    frag: "shaders/simple_transparent.frag.glsl",
    uniforms: "shaders/simple_transparent_uniforms.json",
    generatedBy: "build/build-exact-flat-mrt.mjs",
    requiredVert: [
      /in\s+vec3\s+position\b/,
      /in\s+vec2\s+uv\b/,
      /out\s+vec2\s+vs_TEXCOORD0\b/,
    ],
    requiredFrag: [
      /uniform\s+mediump\s+sampler2D\s+_13\b/,
      /_22\s*=\s*_9\.www\s*\*\s*_9\.xyz/,
      /_40\s*=\s*vec4\(0\.0\)/,
    ],
    samplers: ["_13"],
    samplerSlots: ["_MainTex"],
  },
  Effect: {
    name: "effect",
    generatedBy: "build/build-exact-effect.mjs",
    selectorManifests: [
      ["shaders/effect_eff1_uniforms.json", ["_LAYER_EFF1"]],
      ["shaders/effect_eff2_uniforms.json", ["_LAYER_EFF2"]],
      ["shaders/effect_eff3_uniforms.json", ["_LAYER_EFF3"]],
      ["shaders/effect_eff3_grad_uniforms.json", ["_LAYER_EFF3", "_UseGradationMap"]],
      ["shaders/effect_eff1_grad_view_uniforms.json", ["_LAYER_EFF1", "_UseGradationMap", "_UseViewMask"]],
      ["shaders/effect_eff2_grad_view_uniforms.json", ["_LAYER_EFF2", "_UseGradationMap", "_UseViewMask"]],
    ],
    acceptedMaterialKeywordSets: [
      ["_LAYER_EFF1"],
      ["_LAYER_EFF2"],
      ["_LAYER_EFF3"],
      ["_LAYER_EFF3", "_UseGradationMap"],
      ["_LAYER_EFF1", "_UseGradationMap", "_UseViewMask"],
      ["_LAYER_EFF2", "_UseGradationMap", "_UseViewMask"],
    ],
  },
  Card_Parallax: {
    name: "card_parallax",
    vert: "shaders/card_parallax.vert.glsl",
    frag: "shaders/card_parallax.frag.glsl",
    uniforms: [
      "shaders/card_parallax_uniforms.json",
      "shaders/card_parallax_native_best_match_uniforms.json",
    ],
    generatedBy: "build/build-exact-card-parallax.mjs",
    acceptedMaterialKeywordSets: [["_UVASPECTRATIO_SQUARE"], []],
    requiredManifestKeywordSets: [["_UVASPECTRATIO_SQUARE"], []],
    requiredVert: [
      /in\s+vec4\s+tangent\b/,
      /in\s+vec2\s+uv1\b/,
      /uniform\s+int\s+_UseUv\b/,
      /0\.4199999868869781494140625/,
      /float\(_UseUv\)/,
      /vs_TEXCOORD0\s*=/,
      /^((?!1\.608700037).)*$/s,
    ],
    requiredFrag: [
      /uniform\s+mediump\s+sampler2D\s+_13\b/,
      /_22\s*=\s*_9\.www\s*\*\s*_9\.xyz/,
      /_40\s*=\s*vec4\(0\.0\)/,
    ],
    samplers: ["_13"],
    samplerSlots: ["_MainTex"],
  },
  Card_Parallax_Metal: {
    name: "card_parallax_metal",
    vert: "shaders/card_parallax_metal.vert.glsl",
    frag: "shaders/card_parallax_metal.frag.glsl",
    uniforms: "shaders/card_parallax_metal_uniforms.json",
    generatedBy: "build/build-exact-card-parallax-metal.mjs",
    requiredKeywords: [],
    requiredVert: [
      /in\s+vec4\s+tangent\b/,
      /in\s+vec2\s+uv1\b/,
      /uniform\s+int\s+_UseUv\b/,
      /0\.4199999868869781494140625/,
      /_305\.x\s*=\s*float\(_UseUv\)/,
      /mat4\s+_WorldToObject\s*=\s*inverse\(modelMatrix\)/,
    ],
    requiredFrag: [
      /uniform\s+mediump\s+samplerCube\s+_238\b/,
      /uniform\s+mediump\s+sampler2D\s+_277\b/,
      /_27\s*=\s*log2\(_27\)/,
      /_27\s*\*=\s*_Shininess/,
      /texture\(_277,\s*vs_TEXCOORD0\)\.x/,
      /_305\s*=\s*vec4\(0\.0\)/,
    ],
    samplers: ["_238", "_277"],
    samplerSlots: ["_CubeMap", "_MetalMaskTex"],
    samplerTypes: { _238: "samplerCube" },
    implicitDefaults: { _MetalMaskTex: "white" },
    officialTextureDescriptors: {
      _CubeMap: { defaultName: "", dimension: 4 },
      _MetalMaskTex: { defaultName: "white", dimension: 2 },
    },
    mrt: { primary: "_299", emissive: "_305" },
  },
  Opaque_Hologram_Tuning: {
    name: "opaque_hologram_tuning",
    vert: "shaders/opaque_hologram_tuning.vert.glsl",
    frag: "shaders/opaque_hologram_tuning.frag.glsl",
    uniforms: "shaders/opaque_hologram_tuning_uniforms.json",
    generatedBy: "build/build-exact-opaque-hologram-tuning.mjs",
    requiredVert: [
      /out\s+vec3\s+vs_TEXCOORD1\b/,
      /out\s+vec3\s+vs_TEXCOORD2\b/,
      /mat4\s+_WorldToObject\s*=\s*inverse\(modelMatrix\)/,
      /dot\(_103,\s*_WorldToObject\[0\]\.xyz\)/,
    ],
    requiredFrag: [
      /uniform\s+highp\s+mat4\s+viewMatrix\b/,
      /_22\.y\s*=\s*_22\.x\s*\*\s*0\.25/,
      /_310\s*=\s*dot\(_90\.xyz,\s*_225\)/,
      /texture\(_522,\s*_72\.yzx\)/,
      /_72\.x\s*\*=\s*_Shininess/,
      /texture\(_590,\s*vs_TEXCOORD0\)\.x/,
      /_603\.w\s*=\s*_9\.w/,
      /_611\s*=\s*vec4\(0\.0\)/,
      /^((?!discard).)*$/s,
    ],
    samplers: ["_574", "_590", "_522", "_13", "_352", "_409"],
    samplerSlots: ["_MainTex", "_HologramMaskTex", "_CubeMap", "_PhaseTex", "_RampMaskTex", "_RampTex"],
    samplerTypes: { _522: "samplerCube" },
    implicitDefaults: {
      _HologramMaskTex: "black", _PhaseTex: "white", _RampMaskTex: "black", _RampTex: "black",
    },
  },
  "Frame-Holo-UR-New": {
    name: "frame_holo_ur",
    vert: "shaders/frame_holo_ur.vert.glsl",
    frag: "shaders/frame_holo_ur.frag.glsl",
    uniforms: "shaders/frame_holo_ur_uniforms.json",
    generatedBy: "build/build-exact-frame-holo-ur.mjs",
    requiredVert: [
      /mat4\s+_WorldToObject\s*=\s*inverse\(modelMatrix\)/,
      /mat4\s+_ViewProjection\s*=\s*projectionMatrix\s*\*\s*viewMatrix/,
      /out\s+vec4\s+vs_TEXCOORD4\b/,
      /0\.582111895084381103515625/,
      /2\.3929851055145263671875/,
      /^((?!gl_Position\.y\s*=\s*-gl_Position\.y).)*$/s,
    ],
    requiredFrag: [
      /layout\(location = 1\) out highp vec4 _1053/,
      /layout\(location = 0\) out highp vec4 _1059/,
      /texture\(_333,\s*_41\.yzx\)\.xyz/,
      /texture\(_396,\s*vs_TEXCOORD0\)\.xy/,
      /_428\s*\*=\s*_RemoveMetalic/,
      /_1053\s*=\s*vec4\(_1057\.x\s*\?/,
      /^((?!uBloomOnly).)*$/s,
    ],
    samplers: ["_13", "_302", "_333", "_388", "_396", "_410", "_570", "_721"],
    samplerSlots: ["_BaseTex", "_HologramMaskTex", "_CubeMap", "_PhaseTex", "_PhaseMaskTex", "_RampMaskTex", "_RampTex", "_FakeSpecularMask"],
    samplerTypes: { _333: "samplerCube" },
    implicitDefaults: { _CubeMap: "gray" },
    mrt: { primary: "_1059", emissive: "_1053", secondary_rgb: "active" },
  },
  Transparent_Hologram_Tuning: {
    name: "transparent_hologram_tuning",
    vert: "shaders/transparent_hologram_tuning.vert.glsl",
    frag: "shaders/transparent_hologram_tuning.frag.glsl",
    uniforms: "shaders/transparent_hologram_tuning_uniforms.json",
    generatedBy: "build/build-exact-transparent-hologram-tuning.mjs",
    requiredVert: [
      /mat4\s+_WorldToObject\s*=\s*inverse\(modelMatrix\)/,
      /mat4\s+_ViewProjection\s*=\s*projectionMatrix\s*\*\s*viewMatrix/,
      /out\s+vec3\s+vs_TEXCOORD1\b/,
      /^((?!gl_Position\.y\s*=\s*-gl_Position\.y).)*$/s,
    ],
    requiredFrag: [
      /layout\(location = 0\) out highp vec4 _611/,
      /layout\(location = 1\) out highp vec4 _623/,
      /_274\.w\s*=\s*\(-_562\.w\)\s*\+\s*1\.0/,
      /_577\s*=\s*_562\.xyz\s*\/\s*vec3\(_572\)/,
      /texture\(_510,\s*_9\.yzx\)\.xyz/,
      /_562\.w\s*=\s*_274\.w\s*\*\s*_EmitMasking/,
      /_623\s*=\s*_562/,
    ],
    samplers: ["_563", "_596", "_510", "_355", "_278", "_332"],
    samplerSlots: ["_DynamicUITex", "_HologramMaskTex", "_CubeMap", "_PhaseTex", "_RampMaskTex", "_RampTex"],
    samplerTypes: { _510: "samplerCube" },
    officialTextureDescriptors: {
      _DynamicUITex: { defaultName: "white", dimension: 2 },
      _CubeMap: { defaultName: "", dimension: 4 },
      _PhaseTex: { defaultName: "white", dimension: 2 },
      _RampMaskTex: { defaultName: "black", dimension: 2 },
      _RampTex: { defaultName: "black", dimension: 2 },
      _HologramMaskTex: { defaultName: "black", dimension: 2 },
    },
    mrt: { primary: "_611", mask: "_623", mask_channel: "alpha", mask_switch: "_EmitMasking" },
  },
  Card_Parallax_Hologram_Tuning: {
    name: "card_parallax_hologram_tuning",
    vert: "shaders/card_parallax_hologram_tuning.vert.glsl",
    frag: "shaders/card_parallax_hologram_tuning.frag.glsl",
    uniforms: "shaders/card_parallax_hologram_tuning_uniforms.json",
    generatedBy: "build/build-exact-basic-holograms.mjs",
    requiredVert: [
      /in\s+vec4\s+tangent\b/,
      /in\s+vec2\s+uv1\b/,
      /uniform\s+int\s+_UseUv\b/,
      /uniform\s+int\s+_UseMaskUv\b/,
      /0\.4199999868869781494140625/,
      /^((?!gl_Position\.y\s*=\s*-gl_Position\.y).)*$/s,
    ],
    requiredFrag: [
      /uniform\s+mediump\s+sampler2D\s+_256\b/,
      /uniform\s+mediump\s+sampler2D\s+_397\b/,
      /_283\s*=\s*_252\.zw\s*\*\s*_283/,
      /_409\.w\s*=\s*1\.0/,
      /_415\s*=\s*vec4\(0\.0\)/,
    ],
    samplers: ["_256", "_323", "_382", "_397"],
    samplerSlots: ["_PhaseTex", "_RampMaskTex", "_RampTex", "_HologramMaskTex"],
    mrt: { primary: "_409", secondary: "_415", secondary_value: "zero" },
  },
  Card_Hologram_Tuning: {
    name: "card_hologram_tuning",
    vert: "shaders/card_hologram_tuning.vert.glsl",
    frag: "shaders/card_hologram_tuning.frag.glsl",
    uniforms: "shaders/card_hologram_tuning_uniforms.json",
    generatedBy: "build/build-exact-card-hologram-tuning.mjs",
    requiredVert: [
      /in\s+vec2\s+uv1\b/,
      /uniform\s+int\s+_UseUv\b/,
      /uniform\s+int\s+_UseMaskUv\b/,
      /_WorldToObject\[0\]\.xyz/,
      /^((?!gl_Position\.y\s*=\s*-gl_Position\.y).)*$/s,
    ],
    requiredFrag: [
      /uniform\s+mediump\s+sampler2D\s+_13\b/,
      /uniform\s+mediump\s+sampler2D\s+_595\b/,
      /if\s*\(\(int\(_44\)\s*\*\s*\(-1\)\)\s*!=\s*0\)[\s\S]*?discard/,
      /_422\s*=\s*vec2\(ivec2\(_UseAlphaAsAlphaBlendMask,\s*_UseReflectionAlpha\)\)/,
      /_678\s*=\s*_22/,
      /_680\s*=\s*vec4\(0\.0\)/,
    ],
    samplers: ["_13", "_488", "_386", "_458", "_595"],
    samplerSlots: ["_HologramMaskTex", "_PhaseTex", "_RampMaskTex", "_RampTex", "_HologramFrontMaskTex"],
    officialTextureDescriptors: {
      _PhaseTex: { defaultName: "white", dimension: 2 },
      _RampMaskTex: { defaultName: "black", dimension: 2 },
      _RampTex: { defaultName: "black", dimension: 2 },
      _HologramMaskTex: { defaultName: "white", dimension: 2 },
      _HologramFrontMaskTex: { defaultName: "white", dimension: 2 },
    },
    mrt: { primary: "_678", secondary: "_680", secondary_value: "zero" },
    runtimeShaderDefaults: {
      _PhaseTex: "white",
      _RampMaskTex: "black",
      _RampTex: "black",
      _HologramMaskTex: "white",
      _HologramFrontMaskTex: "white",
    },
  },
  "Frame-Holo-Tuning": {
    name: "frame_holo_tuning",
    vert: "shaders/frame_holo_tuning.vert.glsl",
    frag: "shaders/frame_holo_tuning.frag.glsl",
    uniforms: "shaders/frame_holo_tuning_uniforms.json",
    generatedBy: "build/build-exact-classic-holograms.mjs",
    requiredVert: [
      /mat4\s+_WorldToObject\s*=\s*inverse\(modelMatrix\)/,
      /mat4\s+_ViewProjection\s*=\s*projectionMatrix\s*\*\s*viewMatrix/,
      /out\s+vec3\s+vs_TEXCOORD3\b/,
      /^((?!gl_Position\.y\s*=\s*-gl_Position\.y).)*$/s,
    ],
    requiredFrag: [
      /layout\(location = 0\) out highp vec4 _806/,
      /layout\(location = 1\) out highp vec4 _817/,
      /texture\(_693,\s*_60\.yzx\)\.xyz/,
      /_785\s*=\s*_60\.x\s*\*\s*_9\.x/,
      /_9\.w\s*=\s*_9\.x\s*\*\s*_MaskEmissive/,
      /_817\s*=\s*_9/,
    ],
    samplers: ["_13", "_748", "_693", "_523", "_125", "_467", "_767"],
    samplerSlots: ["_HologramMaskTex", "_BaseTex", "_CubeMap", "_PhaseTex", "_RampMaskTex", "_RampTex", "_HologramFrontMaskTex"],
    samplerTypes: { _693: "samplerCube" },
    implicitDefaults: { _CubeMap: "gray" },
    mrt: { primary: "_806", secondary: "_817", secondary_value: "alpha-only", secondary_switch: "_MaskEmissive" },
  },
  "Simple-Opaque-Hologram_Tuning": {
    name: "simple_opaque_hologram_tuning",
    vert: "shaders/simple_opaque_hologram_tuning.vert.glsl",
    frag: "shaders/simple_opaque_hologram_tuning.frag.glsl",
    uniforms: "shaders/simple_opaque_hologram_tuning_uniforms.json",
    generatedBy: "build/build-exact-simple-opaque-hologram.mjs",
    requiredKeywords: [],
    requiredVert: [
      /in\s+vec2\s+uv1\b/,
      /mat4\s+_WorldToObject\s*=\s*inverse\(modelMatrix\)/,
      /mat4\s+_ViewProjection\s*=\s*projectionMatrix\s*\*\s*viewMatrix/,
      /out\s+vec3\s+vs_TEXCOORD2\b/,
      /^((?!gl_Position\.y\s*=\s*-gl_Position\.y).)*$/s,
    ],
    requiredFrag: [
      /layout\(location = 0\) out highp vec4 _503/,
      /layout\(location = 1\) out highp vec4 _511/,
      /texture\(_343,\s*vs_TEXCOORD1\)/,
      /texture\(_409,\s*vs_TEXCOORD1\)\.x/,
      /texture\(_484,\s*vs_TEXCOORD0\)\.x/,
      /texture\(_491,\s*vs_TEXCOORD0\)/,
      /_511\s*=\s*vec4\(0\.0\)/,
      /^((?!discard).)*$/s,
    ],
    samplers: ["_491", "_484", "_343", "_409", "_465"],
    samplerSlots: ["_MainTex", "_HologramMaskTex", "_PhaseTex", "_RampMaskTex", "_RampTex"],
    implicitDefaults: {
      _HologramMaskTex: "white", _PhaseTex: "white", _RampMaskTex: "black", _RampTex: "black",
    },
    mrt: { primary: "_503", secondary: "_511", secondary_value: "zero" },
  },
  "Opaque-Hologram_Tuning": {
    name: "opaque_shadowbox_hologram_tuning",
    vert: "shaders/opaque_shadowbox_hologram_tuning.vert.glsl",
    frag: "shaders/opaque_shadowbox_hologram_tuning.frag.glsl",
    uniforms: "shaders/opaque_shadowbox_hologram_tuning_uniforms.json",
    generatedBy: "build/build-exact-classic-holograms.mjs",
    requiredVert: [
      /in\s+vec4\s+tangent\b/,
      /out\s+vec3\s+vs_TEXCOORD5\b/,
      /1\.26984119415283203125/,
      /0\.90909087657928466796875/,
      /^((?!gl_Position\.y\s*=\s*-gl_Position\.y).)*$/s,
    ],
    requiredFrag: [
      /layout\(location = 0\) out highp vec4 _643/,
      /layout\(location = 1\) out highp vec4 _848/,
      /texture\(_352,\s*_45\.xzw\)\.xyz/,
      /texture\(_624,\s*vs_TEXCOORD0\)/,
      /_643\s*=\s*vec4\(_335\.x,\s*_335\.y,\s*_335\.z,\s*_643\.w\)/,
      /_848\s*=\s*vec4\(0\.0\)/,
      /^((?!discard).)*$/s,
    ],
    samplers: ["_624", "_62", "_13", "_352", "_532", "_609", "_742", "_685", "_731"],
    samplerSlots: ["_MainTex", "_MaskTex", "_NormalMap", "_CubeMap", "_PhaseTex", "_RampTex", "_PhaseTex2", "_RampMaskTex2", "_RampTex2"],
    samplerTypes: { _352: "samplerCube" },
    implicitDefaults: { _CubeMap: "gray" },
    mrt: { primary: "_643", secondary: "_848", secondary_value: "zero" },
  },
  "Opaque-UR-Oklab": {
    name: "opaque_ur_oklab",
    vert: "shaders/opaque_ur_oklab.vert.glsl",
    frag: "shaders/opaque_ur_oklab.frag.glsl",
    uniforms: "shaders/opaque_ur_oklab_uniforms.json",
    generatedBy: "build/build-exact-opaque-ur-oklab.mjs",
    requiredKeywords: [
      "_DARKNESSENABLED_ON",
      "_FAKESPECULARENABLED_ON",
      "_HOLOGRAM2ENABLED_ON",
      "_REFLECTIONENABLED_ON",
    ],
    requiredVert: [
      /mat4\s+_ObjectToWorld\s*=\s*modelMatrix/,
      /mat4\s+_WorldToObject\s*=\s*inverse\(modelMatrix\)/,
      /mat4\s+_ViewProjection\s*=\s*projectionMatrix\s*\*\s*viewMatrix/,
      /out\s+vec4\s+vs_TEXCOORD6\b/,
      /out\s+vec4\s+vs_TEXCOORD7\b/,
      /1\.26984119415283203125/,
      /0\.90909087657928466796875/,
      /^((?!gl_Position\.y\s*=\s*-gl_Position\.y).)*$/s,
    ],
    requiredFrag: [
      /layout\(location = 0\) out highp vec4 _1985/,
      /layout\(location = 1\) out highp vec4 _2004/,
      /texture\(_354,\s*_20\.yzx\)\.xyz/,
      /texture\(_926,\s*vs_TEXCOORD6\.xy\)\.x/,
      /texture\(_1609,\s*vs_TEXCOORD0\)\.xy/,
      /texture\(_1775,\s*vs_TEXCOORD0\)\.x/,
      /0\.3963377773761749267578125/,
      /4\.076741695404052734375/,
      /_2004\s*=\s*\(vec4\(_42\)\s*\*\s*_350\)\s*\+\s*_1992/,
      /^((?!uBloomOnly).)*$/s,
      /^((?!discard).)*$/s,
    ],
    samplers: ["_13", "_291", "_354", "_419", "_428", "_435", "_607", "_705", "_719", "_862", "_926", "_1609", "_1775"],
    samplerSlots: ["_MainTex", "_HologramMaskTex", "_CubeMap", "_PhaseTex", "_PhaseMaskTex", "_RampMaskTex", "_RampTex", "_PhaseTex2", "_RampMaskTex2", "_RampTex2", "_FakeSpecularMask", "_NormalMap2", "_ReflectionMask"],
    samplerTypes: { _354: "samplerCube" },
    implicitDefaults: {
      _HologramMaskTex: "black", _CubeMap: "gray", _PhaseTex: "white", _PhaseMaskTex: "white",
      _RampMaskTex: "black", _RampTex: "black", _PhaseTex2: "white", _RampMaskTex2: "black",
      _RampTex2: "black", _FakeSpecularMask: "white", _NormalMap2: "bump", _ReflectionMask: "white",
    },
    mrt: { primary: "_1985", emissive: "_2004", secondary_rgb: "active" },
  },
  Card_Parallax_Hologram_UR_New: {
    name: "ur_bg_hologram",
    vert: "shaders/ur_bg_hologram.vert.glsl",
    frag: "shaders/ur_bg_hologram.frag.glsl",
    uniforms: "shaders/ur_bg_hologram_uniforms.json",
    generatedBy: "build/build-exact-ur-bg-hologram.mjs",
    requiredVert: [
      /mat4\s+_ObjectToWorld\s*=\s*modelMatrix/,
      /mat4\s+_WorldToObject\s*=\s*inverse\(modelMatrix\)/,
      /mat4\s+_ViewProjection\s*=\s*projectionMatrix\s*\*\s*viewMatrix/,
      /in\s+vec2\s+uv1\b/,
      /in\s+vec4\s+tangent\b/,
      /0\.582111895084381103515625/,
      /2\.3929851055145263671875/,
      /^((?!gl_Position\.y\s*=\s*-gl_Position\.y).)*$/s,
    ],
    requiredFrag: [
      /layout\(location = 0\) out highp vec4 _695/,
      /layout\(location = 1\) out highp vec4 _701/,
      /texture\(_257,\s*vs_TEXCOORD0\)\.xy/,
      /texture\(_614,\s*vs_TEXCOORD4\.xy\)\.x/,
      /0\.298911988735198974609375/,
      /_695\s*=\s*vec4\(_163\.x,\s*_163\.y,\s*_163\.z,\s*_695\.w\)/,
      /_701\s*=\s*vec4\(0\.0\)/,
      /^((?!discard).)*$/s,
    ],
    samplers: ["_257", "_321", "_335", "_396", "_411", "_614"],
    samplerSlots: ["_PhaseTex", "_PhaseMaskTex", "_RampMaskTex", "_RampTex", "_HologramMaskTex", "_FakeSpecularMask"],
    implicitDefaults: {
      _FakeSpecularMask: "white", _HologramMaskTex: "black", _PhaseMaskTex: "white",
      _PhaseTex: "white", _RampMaskTex: "black", _RampTex: "black",
    },
    mrt: { primary: "_695", secondary: "_701", secondary_value: "zero" },
  },
  Card_UR_Plate: {
    name: "ur_plate",
    vert: "shaders/ur_plate.vert.glsl",
    frag: "shaders/ur_plate.frag.glsl",
    uniforms: "shaders/ur_plate_uniforms.json",
    generatedBy: "build/build-exact-ur-plate.mjs",
    requiredVert: [
      /mat4\s+_WorldToObject\s*=\s*inverse\(modelMatrix\)/,
      /mat4\s+_ViewProjection\s*=\s*projectionMatrix\s*\*\s*viewMatrix/,
      /in\s+vec2\s+uv1\b/,
      /in\s+vec4\s+tangent\b/,
      /0\.582111895084381103515625/,
      /2\.3929851055145263671875/,
      /^((?!gl_Position\.y\s*=\s*-gl_Position\.y).)*$/s,
    ],
    requiredFrag: [
      /layout\(location = 0\) out highp vec4 _603/,
      /layout\(location = 1\) out highp vec4 _658/,
      /texture\(_219,\s*vs_TEXCOORD5\.xy\)\.x/,
      /texture\(_555,\s*_9\)\.xyz/,
      /texture\(_594,\s*vs_TEXCOORD0\)/,
      /0\.298911988735198974609375/,
      /_603\s*=\s*vec4\(_46\.xyz\.x,\s*_46\.xyz\.y,\s*_46\.xyz\.z,\s*_603\.w\)/,
      /_658\s*=\s*vec4\(0\.0\)/,
      /^((?!discard).)*$/s,
    ],
    samplers: ["_594", "_555", "_413", "_483", "_341", "_393", "_615", "_219"],
    samplerSlots: ["_MainTex", "_CubeMap", "_PhaseTex", "_PhaseMaskTex", "_RampMaskTex", "_RampTex", "_HologramMaskTex", "_FakeSpecularMask"],
    samplerTypes: { _555: "samplerCube" },
    implicitDefaults: {
      _FakeSpecularMask: "white", _HologramMaskTex: "black", _MainTex: "black",
      _PhaseMaskTex: "white", _PhaseTex: "white", _RampMaskTex: "black", _RampTex: "black", _CubeMap: "gray",
    },
    mrt: { primary: "_603", secondary: "_658", secondary_value: "zero" },
  },
  "Frame-2Layer-UR": {
    name: "frame_2layer_ur",
    vert: "shaders/frame_2layer_ur.vert.glsl",
    frag: "shaders/frame_2layer_ur.frag.glsl",
    uniforms: "shaders/frame_2layer_ur_uniforms.json",
    generatedBy: "build/build-exact-frame-2layer-ur.mjs",
    requiredVert: [
      /mat4\s+_WorldToObject\s*=\s*inverse\(modelMatrix\)/,
      /mat4\s+_ViewProjection\s*=\s*projectionMatrix\s*\*\s*viewMatrix/,
      /out\s+vec4\s+vs_TEXCOORD4\b/,
      /out\s+vec4\s+vs_TEXCOORD5\b/,
      /0\.582111895084381103515625/,
      /2\.3929851055145263671875/,
      /^((?!gl_Position\.y\s*=\s*-gl_Position\.y).)*$/s,
    ],
    requiredFrag: [
      /layout\(location = 0\) out highp vec4 _34/,
      /layout\(location = 1\) out highp vec4 _42/,
      /texture\(_367,\s*_127\.yzx\)\.xyz/,
      /texture\(_1277,\s*vs_TEXCOORD4\.xy\)\.x/,
      /0\.2104542553424835205078125/,
      /_42\s*=\s*vec4\(_1958\.x\s*\?\s*_984\.x/,
      /^((?!uBloomOnly).)*$/s,
    ],
    samplers: ["_13", "_260", "_367", "_420", "_428", "_444", "_601", "_760", "_916", "_1277"],
    samplerSlots: ["_BaseTex", "_LayerMaskTex", "_CubeMap", "_PhaseTex", "_PhaseMaskTex", "_RampMaskTex", "_RampTex", "_RampMaskTex2", "_RampTex2", "_FakeSpecularMask"],
    samplerTypes: { _367: "samplerCube" },
    implicitDefaults: {
      _BaseTex: "white", _FakeSpecularMask: "white", _LayerMaskTex: "black",
      _PhaseMaskTex: "white", _PhaseTex: "white", _RampMaskTex: "black",
      _RampMaskTex2: "black", _RampTex: "black", _RampTex2: "black", _CubeMap: "gray",
    },
    mrt: { primary: "_34", emissive: "_42", secondary_rgb: "active" },
  },
  "Transparent-UR-New": {
    name: "transparent_ur_new",
    vert: "shaders/transparent_ur_new.vert.glsl",
    frag: "shaders/transparent_ur_new.frag.glsl",
    uniforms: "shaders/transparent_ur_new_uniforms.json",
    generatedBy: "build/build-exact-transparent-ur-new.mjs",
    requiredVert: [
      /mat4\s+_WorldToObject\s*=\s*inverse\(modelMatrix\)/,
      /mat4\s+_ViewProjection\s*=\s*projectionMatrix\s*\*\s*viewMatrix/,
      /out\s+vec4\s+vs_TEXCOORD3\b/,
      /0\.582111895084381103515625/,
      /2\.3929851055145263671875/,
      /^((?!gl_Position\.y\s*=\s*-gl_Position\.y).)*$/s,
    ],
    requiredFrag: [
      /layout\(location = 0\) out highp vec4 _873/,
      /layout\(location = 1\) out highp vec4 _875/,
      /texture\(_528,\s*_58\.yzx\)\.xyz/,
      /_9\s*=\s*texture\(_581,\s*vs_TEXCOORD0\)/,
      /_36\.w\s*=\s*\(-_9\.w\)\s*\+\s*1\.0/,
      /0\.298911988735198974609375/,
      /_873\s*=\s*_36/,
      /_875\s*=\s*vec4\(0\.0\)/,
    ],
    samplers: ["_581", "_609", "_528", "_13", "_361", "_379", "_428", "_800"],
    samplerSlots: ["_DynamicUITex", "_HologramMaskTex", "_CubeMap", "_PhaseTex", "_PhaseMaskTex", "_RampMaskTex", "_RampTex", "_FakeSpecularMask"],
    samplerTypes: { _528: "samplerCube" },
    implicitDefaults: {
      _DynamicUITex: "white", _FakeSpecularMask: "white", _HologramMaskTex: "black",
      _PhaseMaskTex: "white", _PhaseTex: "white", _RampMaskTex: "black", _RampTex: "black", _CubeMap: "gray",
    },
    mrt: { primary: "_873", secondary: "_875", secondary_value: "zero" },
  },
  Card_Parallax_UR: {
    name: "parallax_ur",
    vert: "shaders/parallax_ur.vert.glsl",
    frag: "shaders/parallax_ur.frag.glsl",
    uniforms: "shaders/parallax_ur_uniforms.json",
    generatedBy: "build/build-exact-card-parallax-ur.mjs",
    requiredKeywords: [],
    requiredVert: [
      /in\s+vec4\s+tangent\b/,
      /0\.4199999868869781494140625/,
      /mat4\s+_WorldToObject\s*=\s*inverse\(modelMatrix\)/,
      /out\s+vec2\s+vs_TEXCOORD0\b/,
    ],
    requiredFrag: [
      /uniform\s+highp\s+mat4\s+modelMatrix\b/,
      /^((?!uniform\s+highp\s+mat4\s+viewMatrix\b).)*$/s,
      /uniform\s+mediump\s+sampler2D\s+_242\b/,
      /_44\.x\s*=\s*sin\(_9\.x\)/,
      /_56\.x\s*=\s*-_DarknessOffset/,
      /_276\s*=\s*vec4\(0\.0\)/,
    ],
    samplers: ["_242"],
    samplerSlots: ["_MainTex"],
    implicitDefaults: { _MainTex: "black" },
    officialTextureDescriptors: { _MainTex: { defaultName: "black", dimension: 2 } },
    mrt: { primary: "_267", emissive: "_276" },
  },
};

function sceneId(name) {
  return name.replace(/^scene\.|\.json$/g, "");
}

function readText(rel) {
  const abs = path.join(PUBLIC, rel);
  return fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : null;
}

function isIdentifierStart(char) {
  return char === "_" || char === "$"
    || (char >= "A" && char <= "Z")
    || (char >= "a" && char <= "z");
}

function isIdentifierPart(char) {
  return isIdentifierStart(char) || (char >= "0" && char <= "9");
}

function regexCanStartAfter(token) {
  if (!token) return true;
  if (token.type === "identifier") {
    return new Set([
      "await", "case", "delete", "do", "else", "in", "instanceof", "new",
      "of", "return", "throw", "typeof", "void", "yield",
    ]).has(token.value);
  }
  return token.type === "punctuator"
    && new Set(["(", "[", "{", ",", ";", ":", "=", "!", "?", "&", "|", "+", "-", "*", "%", "~", "<", ">"])
      .has(token.value);
}

// A narrow JavaScript lexer is sufficient here: the audit only needs import declarations and
// identifier call sites. Strings, comments, templates, and regex literals are never treated as code.
function tokenizeJavaScript(source) {
  const tokens = [];
  let index = 0;
  while (index < source.length) {
    const char = source[index];
    if (char === " " || char === "\t" || char === "\r" || char === "\n") {
      index += 1;
      continue;
    }
    if (char === "/" && source[index + 1] === "/") {
      index += 2;
      while (index < source.length && source[index] !== "\n") index += 1;
      continue;
    }
    if (char === "/" && source[index + 1] === "*") {
      index += 2;
      while (index < source.length && !(source[index] === "*" && source[index + 1] === "/")) index += 1;
      index = Math.min(source.length, index + 2);
      continue;
    }
    if (char === "'" || char === "\"") {
      const quote = char;
      let value = "";
      index += 1;
      while (index < source.length) {
        if (source[index] === "\\") {
          index += 1;
          if (index < source.length) value += source[index++];
          continue;
        }
        if (source[index] === quote) {
          index += 1;
          break;
        }
        value += source[index++];
      }
      tokens.push({ type: "string", value });
      continue;
    }
    if (char === "`") {
      index += 1;
      while (index < source.length) {
        if (source[index] === "\\") {
          index += 2;
          continue;
        }
        if (source[index++] === "`") break;
      }
      continue;
    }
    if (char === "/" && regexCanStartAfter(tokens.at(-1))) {
      let inClass = false;
      index += 1;
      while (index < source.length) {
        if (source[index] === "\\") {
          index += 2;
          continue;
        }
        if (source[index] === "[") inClass = true;
        else if (source[index] === "]") inClass = false;
        else if (source[index] === "/" && !inClass) {
          index += 1;
          while (isIdentifierPart(source[index])) index += 1;
          break;
        }
        index += 1;
      }
      continue;
    }
    if (isIdentifierStart(char)) {
      const start = index++;
      while (isIdentifierPart(source[index])) index += 1;
      tokens.push({ type: "identifier", value: source.slice(start, index) });
      continue;
    }
    if (char >= "0" && char <= "9") {
      const start = index;
      index += 1;
      while (index < source.length && (
        isIdentifierPart(source[index]) || source[index] === "."
      )) index += 1;
      tokens.push({ type: "number", value: source.slice(start, index) });
      continue;
    }
    tokens.push({ type: "punctuator", value: char });
    index += 1;
  }
  return tokens;
}

function analyzeExactPortLoaderUsage(appSource) {
  const importedName = "loadExactShaderPortsFromContract";
  const moduleName = "./render/exact-port-loader.js";
  const tokens = tokenizeJavaScript(appSource);
  const localNames = new Set();
  const importTokenIndexes = new Set();

  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index].type !== "identifier" || tokens[index].value !== "import"
        || tokens[index + 1]?.value !== "{") continue;
    let close = index + 2;
    while (close < tokens.length && tokens[close].value !== "}") close += 1;
    if (tokens[close + 1]?.value !== "from"
        || tokens[close + 2]?.type !== "string"
        || tokens[close + 2].value !== moduleName) continue;

    for (let cursor = index; cursor <= close + 2; cursor += 1) importTokenIndexes.add(cursor);
    for (let cursor = index + 2; cursor < close;) {
      if (tokens[cursor].type !== "identifier") {
        cursor += 1;
        continue;
      }
      const exported = tokens[cursor].value;
      let local = exported;
      if (tokens[cursor + 1]?.value === "as" && tokens[cursor + 2]?.type === "identifier") {
        local = tokens[cursor + 2].value;
        cursor += 3;
      } else {
        cursor += 1;
      }
      if (exported === importedName) localNames.add(local);
      while (cursor < close && tokens[cursor].value !== ",") cursor += 1;
      if (tokens[cursor]?.value === ",") cursor += 1;
    }
  }

  const callCount = tokens.reduce((count, token, index) => (
    !importTokenIndexes.has(index)
      && token.type === "identifier"
      && localNames.has(token.value)
      && tokens[index + 1]?.value === "("
      ? count + 1
      : count
  ), 0);
  return { localNames: [...localNames].sort(), callCount };
}

export function officialPortKey(value) {
  return [
    value?.selectorId,
    value?.candidateWitnessId,
    value?.subshader,
    value?.pass,
  ].join("|");
}

export function auditRuntimeContractDispatch({
  contract,
  manifestEntries,
  appSource,
  shaderTable = SHADER,
  materialForKind = getMaterial,
}) {
  const rows = [];
  const manifestByPath = new Map(manifestEntries.map((entry) => [entry.manifestPath, entry.manifest]));
  const contractRows = [
    ...(contract.ports || []).map((row) => ({ ...row, scope: "formal-port" })),
    ...(contract.runtimeBound || []).map((row) => ({ ...row, scope: "runtime-bound" })),
  ];
  const refsByShaderKey = new Map();

  for (const row of contractRows) {
    let manifest = manifestByPath.get(row.manifest);
    if (!manifest) {
      const normalized = String(row.manifest || "").replaceAll("\\", "/");
      const absolute = normalized.startsWith("public/")
        ? path.join(ROOT, ...normalized.split("/"))
        : null;
      manifest = absolute && fs.existsSync(absolute)
        ? JSON.parse(fs.readFileSync(absolute, "utf8"))
        : null;
    }
    const shaderKey = manifest?.runtime_contract?.shader_key;
    const validKey = typeof shaderKey === "string" && shaderKey.length > 0;
    rows.push({
      ok: validKey,
      shader: validKey ? shaderKey : "runtime-contract",
      asset: row.manifest,
      reason: validKey
        ? `${row.scope} declares runtime shader_key ${shaderKey}`
        : `${row.scope} manifest has no runtime_contract.shader_key`,
      refs: [],
    });
    if (!validKey) continue;
    if (!refsByShaderKey.has(shaderKey)) refsByShaderKey.set(shaderKey, []);
    refsByShaderKey.get(shaderKey).push(row.manifest);
  }

  for (const [shaderKey, refs] of [...refsByShaderKey].sort(([left], [right]) => left.localeCompare(right))) {
    const route = shaderTable[shaderKey];
    const hasDispatchKind = !!route
      && route.defer !== true
      && typeof route.kind === "string"
      && route.kind.length > 0;
    rows.push({
      ok: hasDispatchKind,
      shader: shaderKey,
      asset: "render/rarities.js",
      reason: hasDispatchKind
        ? `runtime shader maps to non-defer kind ${route.kind}`
        : "runtime shader has no non-defer rarity kind",
      refs,
    });

    const strategy = hasDispatchKind ? materialForKind(route.kind) : null;
    rows.push({
      ok: !!strategy && typeof strategy.build === "function",
      shader: shaderKey,
      asset: "render/registry.js",
      reason: strategy && typeof strategy.build === "function"
        ? `material kind ${route.kind} is registered`
        : `material kind ${route?.kind || "<missing>"} is not registered`,
      refs,
    });
  }

  const loaderUsage = analyzeExactPortLoaderUsage(appSource || "");
  rows.push({
    ok: loaderUsage.localNames.length > 0,
    shader: "selector-bound-contract",
    asset: "app.js",
    reason: loaderUsage.localNames.length > 0
      ? `imports loadExactShaderPortsFromContract as ${loaderUsage.localNames.join(",")}`
      : "does not import loadExactShaderPortsFromContract from exact-port-loader.js",
    refs: [],
  });
  rows.push({
    ok: loaderUsage.callCount > 0,
    shader: "selector-bound-contract",
    asset: "app.js",
    reason: loaderUsage.callCount > 0
      ? `calls imported contract loader ${loaderUsage.callCount} time(s)`
      : "does not call the imported contract loader",
    refs: [],
  });

  return { rows, shaderKeys: [...refsByShaderKey.keys()].sort() };
}

function manifestShaderKey(manifest) {
  return manifest.runtime_contract?.shader_key
    || String(manifest.shader || manifest.official_selector?.shaderName || "").split("/").at(-1);
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sha256(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

function vectorFields(manifest) {
  return (manifest.official_program_bindings?.common_constant_buffers || [])
    .flatMap((buffer) => (buffer.vectors || []).map((field) => ({ ...field, buffer: buffer.name })));
}

function fieldMatches(fields, name, expected) {
  return fields.some((field) => field.name === name
    && Object.entries(expected).every(([key, value]) => field[key] === value));
}

function structuredSemanticRows(entry) {
  const { manifest, manifestPath } = entry;
  const shader = manifestShaderKey(manifest);
  const rows = [];
  const push = (ok, reason) => rows.push({ ok, shader, asset: manifestPath, reason, refs: [] });
  const fields = vectorFields(manifest);
  const bindings = [...(manifest.sampler_bindings || [])].sort((a, b) => a.binding - b.binding);

  if (shader === "Card_UR_Glitter_FlowMaps") {
    push(
      fieldMatches(fields, "_FlowParams", { buffer: "PGlobals703640426", offset: 0, arraySize: 2, dim: 4 })
        && fieldMatches(fields, "_FlowParams", { buffer: "VGlobals703640426", offset: 224, arraySize: 2, dim: 4 }),
      "Glitter FlowParams vec4[2] reflection in PGlobals/VGlobals",
    );
    push(
      fieldMatches(fields, "_LightTime", { offset: 64, arraySize: 0, dim: 1 })
        && fieldMatches(fields, "_EmitThreshold", { offset: 68, arraySize: 0, dim: 1 }),
      "Glitter twinkle pulse reflection fields",
    );
    push(
      sameJson(manifest.runtime_contract?.dynamic_uniforms?._FlowParams, {
        type: "vec4[2]",
        source: "GlitterFlowMaps.Update/Material.SetVectorArray",
      })
        && ["_LightTime", "_EmitThreshold"].every((name) =>
          manifest.runtime_contract?.material_uniforms?.floats?.includes(name)),
      "Glitter runtime dynamic/pulse contract",
    );
    push(
      sameJson(bindings.map(({ slot, binding, dimension }) => ({ slot, binding, dimension })), [
        { slot: "_FlowAMap", binding: 0, dimension: 2 },
        { slot: "_ALightTex", binding: 1, dimension: 2 },
        { slot: "_ABaseTex", binding: 2, dimension: 2 },
        { slot: "_FlowBMap", binding: 3, dimension: 2 },
        { slot: "_BLightTex", binding: 4, dimension: 2 },
        { slot: "_BBaseTex", binding: 5, dimension: 2 },
      ]),
      "Glitter six-texture official binding topology",
    );
  }

  if (shader === "Card_Parallax_MatCap_Lighting") {
    push(
      fieldMatches(fields, "_UseUv2", { offset: 224, type: 1, dim: 1 })
        && fieldMatches(fields, "_LightSensitive", { offset: 64, type: 0, dim: 1 })
        && fieldMatches(fields, "_LightCurvePower", { offset: 68, type: 0, dim: 1 }),
      "MatCap UV selector and light-curve reflection",
    );
    push(
      fieldMatches(fields, "_LightingColor", { offset: 80, type: 0, dim: 4 })
        && fieldMatches(fields, "_EmissiveEnabled", { offset: 100, type: 1, dim: 1 })
        && fieldMatches(fields, "_EmissiveColor", { offset: 112, type: 0, dim: 4 }),
      "MatCap lighting/emissive reflection",
    );
    push(
      sameJson(bindings.map(({ slot, binding, dimension }) => ({ slot, binding, dimension })), [
        { slot: "_MatCapLightTex", binding: 0, dimension: 2 },
        { slot: "_LightingMask", binding: 1, dimension: 2 },
      ]),
      "MatCap two-texture official binding topology",
    );
    push(
      manifest.runtime_contract?.attributes?.normal === "vec3"
        && manifest.runtime_contract?.attributes?.tangent === "vec4"
        && manifest.runtime_contract?.attributes?.uv1 === "vec2"
        && manifest.runtime_contract?.material_uniforms?.ints?.includes("_UseUv2")
        && manifest.runtime_contract?.material_uniforms?.ints?.includes("_EmissiveEnabled")
        && manifest.runtime_contract?.mrt_attachments === 2,
      "MatCap runtime attributes, integer controls, and MRT contract",
    );
  }

  return rows;
}

export function auditSelectorBoundProgramAssets({ contract, manifestEntries, readSourceText }) {
  const rows = [];
  const expectedKeys = contract.ports.map(officialPortKey);
  const discoveredKeys = manifestEntries.map((entry) => officialPortKey(entry.manifest.official_selector));
  const expectedSet = new Set(expectedKeys);
  const discoveredSet = new Set(discoveredKeys);
  const duplicateExpected = expectedKeys.filter((key, index) => expectedKeys.indexOf(key) !== index);
  const duplicateDiscovered = discoveredKeys.filter((key, index) => discoveredKeys.indexOf(key) !== index);
  const missing = [...expectedSet].filter((key) => !discoveredSet.has(key)).sort();
  const extra = [...discoveredSet].filter((key) => !expectedSet.has(key)).sort();

  rows.push({
    ok: contract.schema === "pocket-card-render/official-program-port-contract@2",
    shader: "selector-bound-contract",
    asset: "shaders/official_program_port_contract.json",
    reason: "contract schema v2",
    refs: [],
  });
  rows.push({
    ok: duplicateExpected.length === 0,
    shader: "selector-bound-contract",
    asset: "shaders/official_program_port_contract.json",
    reason: duplicateExpected.length ? `duplicate contract keys: ${duplicateExpected.join(",")}` : "unique full contract identities",
    refs: [],
  });
  rows.push({
    ok: duplicateDiscovered.length === 0,
    shader: "selector-bound-contract",
    asset: "shaders/*_uniforms.json",
    reason: duplicateDiscovered.length ? `duplicate manifest keys: ${duplicateDiscovered.join(",")}` : "unique full manifest identities",
    refs: [],
  });
  rows.push({
    ok: missing.length === 0 && extra.length === 0 && expectedSet.size === discoveredSet.size,
    shader: "selector-bound-contract",
    asset: "shaders/*_uniforms.json",
    reason: missing.length || extra.length
      ? `full-key set mismatch missing=[${missing.join(",")}] extra=[${extra.join(",")}]`
      : `full-key set closed ${expectedSet.size}/${expectedSet.size}`,
    refs: [],
  });

  const entryByKey = new Map(manifestEntries.map((entry) => [
    officialPortKey(entry.manifest.official_selector),
    entry,
  ]));
  for (const port of contract.ports) {
    const key = officialPortKey(port);
    const entry = entryByKey.get(key);
    const shader = entry ? manifestShaderKey(entry.manifest) : "selector-bound-contract";
    if (!entry) {
      rows.push({ ok: false, shader, asset: port.manifest, reason: `contract port not consumed: ${key}`, refs: [] });
      continue;
    }

    const { manifest, manifestPath, fallbackSources } = entry;
    const selector = manifest.official_selector || {};
    const identity = manifest.official_executable_identity || {};
    const issues = [];
    if (manifestPath !== port.manifest) issues.push(`manifest path ${manifestPath} != ${port.manifest}`);
    if (manifest.generated_by !== port.generator) issues.push("generator provenance mismatch");
    if (selector.semanticExecutableId !== port.semanticExecutableId) issues.push("semantic executable mismatch");
    if (!sameJson([...(manifest.selected_keywords || [])].sort(), [...(selector.keywords || [])].sort())) {
      issues.push("selected keyword reflection mismatch");
    }
    for (const [field, expected] of Object.entries(port.officialIdentityFields || {})) {
      if (identity[field] !== expected) issues.push(`${field} mismatch`);
    }
    if (manifest.official_parameter_entry?.source_sha256 !== identity.parameterEntrySha256) {
      issues.push("parameter entry source mismatch");
    }
    if (manifest.official_pass_runtime?.source_sha256 !== identity.passStateSha256) {
      issues.push("pass state source mismatch");
    }
    if (manifest.official_common_bindings?.source_sha256 !== identity.commonBindingsSha256) {
      issues.push("common binding source mismatch");
    }
    if (manifest.official_program_bindings) {
      if (manifest.official_program_bindings.parameter_reflection_sha256
        !== manifest.official_parameter_entry?.reflection_sha256) {
        issues.push("parameter reflection join mismatch");
      }
      if (manifest.official_program_bindings.common_source_sha256 !== identity.commonBindingsSha256) {
        issues.push("compiled common binding join mismatch");
      }
    }

    const declaredSources = manifest.webgl_sources || fallbackSources || {};
    if (manifest.webgl_sources && !manifest.runtime_contract) issues.push("declared WebGL source lacks runtime contract");
    if (manifest.runtime_contract) {
      if (manifest.runtime_contract.schema !== "pocket-card-render/webgl-runtime-port@1") {
        issues.push("runtime contract schema mismatch");
      }
      if (manifest.runtime_contract.shader_key !== shader) issues.push("runtime shader key mismatch");
      if ("require_complete_active_bindings" in manifest.runtime_contract
        && typeof manifest.runtime_contract.require_complete_active_bindings !== "boolean") {
        issues.push("runtime active-binding policy is not explicit");
      }
    }
    for (const stage of ["vertex", "fragment"]) {
      const sourcePath = declaredSources[stage];
      const source = sourcePath ? readSourceText(sourcePath) : null;
      const adaptation = manifest.webgl_adaptation?.[stage];
      if (!sourcePath || !source) {
        issues.push(`${stage} source missing`);
        continue;
      }
      if (sha256(source) !== adaptation?.outputSha256) issues.push(`${stage} output hash mismatch`);
      if (adaptation?.officialSpirvSha256 !== manifest.official_spirv_sha256?.[stage]) {
        issues.push(`${stage} official SPIR-V join mismatch`);
      }
      const identityField = stage === "vertex" ? "vertexSpirvSha256" : "fragmentSpirvSha256";
      if (adaptation?.officialSpirvSha256 !== identity[identityField]) {
        issues.push(`${stage} contract SPIR-V mismatch`);
      }
    }

    if (manifest.sampler_bindings) {
      const bindings = [...manifest.sampler_bindings].sort((a, b) => a.binding - b.binding);
      const bindingNumbers = bindings.map((binding) => binding.binding);
      if (new Set(bindingNumbers).size !== bindingNumbers.length) issues.push("duplicate sampler binding number");
      if (!sameJson(bindings.map((binding) => binding.spirvName), manifest.samplers || [])) {
        issues.push("sampler SPIR-V order mismatch");
      }
      if (!sameJson(bindings.map((binding) => binding.slot), manifest.sampler_slots || [])) {
        issues.push("sampler slot order mismatch");
      }
      const officialTextures = manifest.official_program_bindings?.textures
        || manifest.official_common_bindings?.textures
        || [];
      for (const binding of bindings) {
        const official = officialTextures.find((texture) => texture.binding === binding.binding);
        if (!official || official.name !== binding.slot || official.dim !== binding.dimension) {
          issues.push(`sampler binding ${binding.binding} does not join official reflection`);
        }
      }
    }

    rows.push({
      ok: issues.length === 0,
      shader,
      asset: manifestPath,
      reason: issues.length ? `${key}: ${issues.join("; ")}` : `consumed full identity ${key}`,
      refs: [],
    });
    rows.push(...structuredSemanticRows(entry));
  }

  return { rows, expectedKeys: [...expectedSet].sort(), discoveredKeys: [...discoveredSet].sort() };
}

function discoverSelectorBoundManifestEntries() {
  const shaderDir = path.join(PUBLIC, "shaders");
  const sourcePathByHash = new Map();
  for (const file of fs.readdirSync(shaderDir).filter((name) => /\.(?:vert|frag)\.glsl$/.test(name)).sort()) {
    const source = fs.readFileSync(path.join(shaderDir, file), "utf8");
    const hash = sha256(source);
    if (!sourcePathByHash.has(hash)) sourcePathByHash.set(hash, `public/shaders/${file}`);
  }
  const entries = [];
  for (const file of fs.readdirSync(shaderDir).filter((name) => name.endsWith("_uniforms.json")).sort()) {
    const manifest = JSON.parse(fs.readFileSync(path.join(shaderDir, file), "utf8"));
    if (!manifest.official_selector
      || !manifest.webgl_adaptation?.vertex?.outputSha256
      || !manifest.webgl_adaptation?.fragment?.outputSha256) continue;
    entries.push({
      manifest,
      manifestPath: `public/shaders/${file}`,
      fallbackSources: {
        vertex: sourcePathByHash.get(manifest.webgl_adaptation.vertex.outputSha256),
        fragment: sourcePathByHash.get(manifest.webgl_adaptation.fragment.outputSha256),
      },
    });
  }
  return entries;
}

function findSceneUsers() {
  const users = new Map();
  for (const sceneName of fs.readdirSync(PUBLIC).filter((n) => /^scene\..*\.json$/.test(n)).sort()) {
    const scene = JSON.parse(fs.readFileSync(path.join(PUBLIC, sceneName), "utf8"));
    for (const [matName, mat] of Object.entries(scene.materials || {})) {
      if (!EXACT_PORTS[mat.shader]) continue;
      if (!users.has(mat.shader)) users.set(mat.shader, []);
      users.get(mat.shader).push({
        ref: `${sceneId(sceneName)}:${matName}`,
        keywords: mat.keywords || [],
      });
    }
  }
  return users;
}

export function partitionExactPortSceneUsers(sceneUsers, acceptedKeywordSets) {
  const accepted = new Set(
    acceptedKeywordSets.map((keywords) => JSON.stringify([...keywords].sort())),
  );
  const exact = [];
  const unported = [];
  for (const user of sceneUsers) {
    const target = accepted.has(JSON.stringify([...(user.keywords || [])].sort()))
      ? exact
      : unported;
    target.push(user);
  }
  return { exact, unported };
}

export function runProgramAssetAudit() {
const contract = JSON.parse(fs.readFileSync(
  path.join(PUBLIC, "shaders", "official_program_port_contract.json"),
  "utf8",
));
const manifestEntries = discoverSelectorBoundManifestEntries();
const structuredAudit = auditSelectorBoundProgramAssets({
  contract,
  manifestEntries,
  readSourceText: (sourcePath) => {
    const normalized = String(sourcePath).replaceAll("\\", "/");
    const absolute = normalized.startsWith("public/")
      ? path.join(ROOT, ...normalized.split("/"))
      : path.join(PUBLIC, ...normalized.split("/"));
    return fs.existsSync(absolute) ? fs.readFileSync(absolute, "utf8") : null;
  },
});
const runtimeDispatchAudit = auditRuntimeContractDispatch({
  contract,
  manifestEntries,
  appSource: fs.readFileSync(path.join(PUBLIC, "app.js"), "utf8"),
});
const rows = [...structuredAudit.rows, ...runtimeDispatchAudit.rows];
const users = findSceneUsers();
for (const [shader, cfg] of Object.entries(EXACT_PORTS)) {
  const allSceneUsers = users.get(shader) || [];
  const acceptedKeywordSets = cfg.acceptedMaterialKeywordSets
    || (cfg.requiredKeywords ? [cfg.requiredKeywords] : null)
    || (cfg.requiredKeyword ? [[cfg.requiredKeyword]] : null);
  const partition = acceptedKeywordSets
    ? partitionExactPortSceneUsers(allSceneUsers, acceptedKeywordSets)
    : { exact: allSceneUsers, unported: [] };
  const sceneUsers = partition.exact;
  const refs = sceneUsers.map((user) => user.ref);
  if (partition.unported.length) {
    rows.push({
      ok: true,
      shader,
      asset: "scene.*.json",
      reason: `${partition.unported.length} scene user(s) retain a distinct unported selector and fail closed from exact dispatch`,
      refs: partition.unported.map((user) => user.ref),
    });
  }
  if (!allSceneUsers.length) {
    rows.push({ ok: true, shader, asset: cfg.name, reason: "unused by current scenes", refs });
    continue;
  }

  if (cfg.selectorManifests) {
    const accepted = cfg.acceptedMaterialKeywordSets
      .map((keywordSet) => JSON.stringify([...keywordSet].sort()));
    rows.push({
      ok: sceneUsers.every((user) => accepted.includes(JSON.stringify([...user.keywords].sort()))),
      shader,
      asset: "scene.*.json",
      reason: "all exact-eligible scene users resolve through an official selector manifest",
      refs,
    });
    if (cfg.runtimeShaderDefaults) {
      const actualDefaults = SHADER_TEXTURE_DEFAULTS[shader] || {};
      for (const [slot, expected] of Object.entries(cfg.runtimeShaderDefaults)) {
        rows.push({
          ok: actualDefaults[slot] === expected,
          shader,
          asset: "render/shader-defaults.js",
          reason: `generated official texture default ${slot}=${expected}`,
          refs,
        });
      }
    }
    for (const [manifestFile, expectedKeywords] of cfg.selectorManifests) {
      const raw = readText(manifestFile);
      rows.push({ ok: !!raw, shader, asset: manifestFile, reason: raw ? "present" : "missing", refs });
      if (!raw) continue;
      try {
        const manifest = JSON.parse(raw);
        const selected = [...(manifest.selected_keywords || [])].sort();
        rows.push({
          ok: JSON.stringify(selected) === JSON.stringify([...expectedKeywords].sort()),
          shader,
          asset: manifestFile,
          reason: "official selector keyword set",
          refs,
        });
        rows.push({
          ok: manifest.generated_by === cfg.generatedBy,
          shader,
          asset: manifestFile,
          reason: "official generation provenance",
          refs,
        });
        rows.push({
          ok: manifest.runtime_contract?.shader_key === shader
            && manifest.official_selector?.selectorId
            && manifest.official_selector?.shaderIdentity,
          shader,
          asset: manifestFile,
          reason: "selector-keyed runtime contract",
          refs,
        });
        rows.push({
          ok: JSON.stringify((manifest.sampler_bindings || []).map((binding) => binding.spirvName))
            === JSON.stringify(manifest.samplers || [])
            && JSON.stringify((manifest.sampler_bindings || []).map((binding) => binding.slot))
              === JSON.stringify(manifest.sampler_slots || []),
          shader,
          asset: manifestFile,
          reason: "official binding-number sampler join",
          refs,
        });
        for (const stage of ["vertex", "fragment"]) {
          const declared = manifest.webgl_sources?.[stage];
          const relative = typeof declared === "string" ? declared.replace(/^public\//, "") : null;
          const source = relative ? readText(relative) : null;
          const expectedHash = manifest.webgl_adaptation?.[stage]?.outputSha256;
          const actualHash = source ? crypto.createHash("sha256").update(source).digest("hex") : null;
          rows.push({
            ok: !!source && actualHash === expectedHash,
            shader,
            asset: relative || `${manifestFile}:${stage}`,
            reason: `${stage} selector source hash`,
            refs,
          });
        }
      } catch (err) {
        rows.push({ ok: false, shader, asset: manifestFile, reason: `invalid selector manifest: ${err.message}`, refs });
      }
    }
    continue;
  }

  const vert = readText(cfg.vert);
  const frag = readText(cfg.frag);
  const uniformFiles = Array.isArray(cfg.uniforms) ? cfg.uniforms : [cfg.uniforms];
  const uniformEntries = uniformFiles.map((file) => ({ file, raw: readText(file) }));
  rows.push({ ok: !!vert, shader, asset: cfg.vert, reason: vert ? "present" : "missing", refs });
  rows.push({ ok: !!frag, shader, asset: cfg.frag, reason: frag ? "present" : "missing", refs });
  for (const entry of uniformEntries) {
    rows.push({ ok: !!entry.raw, shader, asset: entry.file, reason: entry.raw ? "present" : "missing", refs });
  }
  if (cfg.requiredKeyword || cfg.acceptedMaterialKeywordSets) {
    const accepted = (cfg.acceptedMaterialKeywordSets || [[cfg.requiredKeyword]])
      .map((keywords) => JSON.stringify([...keywords].sort()));
    rows.push({
      ok: sceneUsers.every((user) => accepted.includes(JSON.stringify([...user.keywords].sort()))),
      shader,
      asset: "scene.*.json",
      reason: "all exact-eligible scene users resolve through an explicitly supported selector keyword set",
      refs,
    });
  }
  if (cfg.requiredKeywords) {
    const required = [...cfg.requiredKeywords].sort();
    rows.push({
      ok: sceneUsers.every((user) => JSON.stringify([...user.keywords].sort()) === JSON.stringify(required)),
      shader,
      asset: "scene.*.json",
      reason: `all exact-eligible scene users select exact keyword set ${required.join(",")}`,
      refs,
    });
  }
  if (cfg.runtimeShaderDefaults) {
    const actualDefaults = SHADER_TEXTURE_DEFAULTS[shader] || {};
    for (const [slot, expected] of Object.entries(cfg.runtimeShaderDefaults)) {
      rows.push({
        ok: actualDefaults[slot] === expected,
        shader,
        asset: "render/shader-defaults.js",
        reason: `generated official texture default ${slot}=${expected}`,
        refs,
      });
    }
  }

  if (vert) {
    for (const re of cfg.requiredVert) {
      rows.push({ ok: re.test(vert), shader, asset: cfg.vert, reason: `vertex pattern ${re}`, refs });
    }
  }
  if (frag) {
    for (const re of cfg.requiredFrag) {
      rows.push({ ok: re.test(frag), shader, asset: cfg.frag, reason: `fragment pattern ${re}`, refs });
    }
    for (const sampler of cfg.samplers) {
      const samplerType = cfg.samplerTypes?.[sampler] || "sampler2D";
      const re = new RegExp(`uniform\\s+mediump\\s+${samplerType}\\s+${sampler}\\b`);
      rows.push({ ok: re.test(frag), shader, asset: cfg.frag, reason: `fragment sampler ${sampler}`, refs });
    }
  }
  for (const [uniformIndex, uniformEntry] of uniformEntries.entries()) {
    const uniformsRaw = uniformEntry.raw;
    if (!uniformsRaw) continue;
    try {
      const uniforms = JSON.parse(uniformsRaw);
      rows.push({
        ok: JSON.stringify(uniforms.samplers || []) === JSON.stringify(cfg.samplers),
        shader,
        asset: uniformEntry.file,
        reason: "sampler binding order",
        refs,
      });
      rows.push({
        ok: JSON.stringify(uniforms.sampler_slots || []) === JSON.stringify(cfg.samplerSlots),
        shader,
        asset: uniformEntry.file,
        reason: "sampler slot order",
        refs,
      });
      if (cfg.requiredKeyword) {
        rows.push({
          ok: uniforms.variant === cfg.requiredKeyword,
          shader,
          asset: uniformEntry.file,
          reason: `uniform manifest variant ${cfg.requiredKeyword}`,
          refs,
        });
      }
      if (cfg.requiredManifestKeywordSets) {
        const expected = [...cfg.requiredManifestKeywordSets[uniformIndex]].sort();
        rows.push({
          ok: JSON.stringify([...(uniforms.selected_keywords || [])].sort()) === JSON.stringify(expected),
          shader,
          asset: uniformEntry.file,
          reason: `manifest selector keyword set ${expected.join(",") || "<empty>"}`,
          refs,
        });
      }
      if (cfg.requiredKeywords) {
        rows.push({
          ok: JSON.stringify([...(uniforms.selected_keywords || [])].sort()) === JSON.stringify([...cfg.requiredKeywords].sort()),
          shader,
          asset: uniformEntry.file,
          reason: "uniform manifest selected keyword set",
          refs,
        });
      }
      if (cfg.implicitDefaults) {
        rows.push({
          ok: JSON.stringify(Object.entries(uniforms.implicit_defaults || {}).sort(([a], [b]) => a.localeCompare(b)))
            === JSON.stringify(Object.entries(cfg.implicitDefaults).sort(([a], [b]) => a.localeCompare(b))),
          shader,
          asset: uniformEntry.file,
          reason: "implicit texture defaults",
          refs,
        });
      }
      if (cfg.officialTextureDescriptors) {
        rows.push({
          ok: JSON.stringify(uniforms.official_shader_property_defaults?.textureDescriptors || {})
            === JSON.stringify(cfg.officialTextureDescriptors),
          shader,
          asset: uniformEntry.file,
          reason: "official serialized texture property descriptors",
          refs,
        });
      }
      if (cfg.generatedBy) {
        rows.push({
          ok: uniforms.generated_by === cfg.generatedBy,
          shader,
          asset: uniformEntry.file,
          reason: "official generation provenance",
          refs,
        });
      }
      if (cfg.mrt) {
        rows.push({
          ok: JSON.stringify(uniforms.mrt || {}) === JSON.stringify(cfg.mrt),
          shader,
          asset: uniformEntry.file,
          reason: "MRT output/adaptation manifest",
          refs,
        });
      }
    } catch (err) {
      rows.push({ ok: false, shader, asset: uniformEntry.file, reason: `invalid json: ${err.message}`, refs });
    }
  }
}

for (const row of rows) {
  const mark = row.ok ? "OK " : "BAD";
  console.log(`${mark} ${row.shader.padEnd(35)} asset=${row.asset.padEnd(34)} ${row.reason} refs=${row.refs.slice(0, 4).join(",")}`);
}

const bad = rows.filter((r) => !r.ok);
if (bad.length) {
  console.error(`\n${bad.length} official program asset issue(s) found.`);
  process.exitCode = 1;
}
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runProgramAssetAudit();
}
