// Verify that scenes using transpiled official shader programs cannot silently
// fall back to hand ports. Presence and wiring are structural evidence only;
// they do not prove official-runtime or final-pixel parity.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC = path.join(ROOT, "public");

const EXACT_PORTS = {
  Card_Illust: {
    name: "card_illust",
    vert: "shaders/card_illust.vert.glsl",
    frag: "shaders/card_illust.frag.glsl",
    uniforms: "shaders/card_illust_uniforms.json",
    requiredVert: [
      /in\s+vec3\s+position\b/,
      /in\s+vec2\s+uv\b/,
      /in\s+vec2\s+uv2\b/,
      /uniform\s+float\s+_UseUv\b/,
      /vs_TEXCOORD0\s*=\s*\(_UseUv\s*\*\s*\(\(-uv\)\s*\+\s*uv2\)\)\s*\+\s*uv/,
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
  Frame: {
    name: "frame",
    vert: "shaders/textured.vert.glsl",
    frag: "shaders/frame.frag.glsl",
    uniforms: "shaders/simple_uniforms.json",
    requiredVert: [
      /in\s+vec3\s+position\b/,
      /in\s+vec2\s+uv\b/,
      /out\s+vec2\s+vs_TEXCOORD0\b/,
    ],
    requiredFrag: [
      /uniform\s+mediump\s+sampler2D\s+_13\b/,
      /_21\s*=\s*_9/,
      /_45\s*=\s*_9/,
    ],
    samplers: ["_13"],
    samplerSlots: ["_MainTex"],
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
    uniforms: "shaders/simple_uniforms.json",
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
    vert: "shaders/effect.vert.glsl",
    frag: "shaders/effect.frag.glsl",
    uniforms: "shaders/effect_uniforms.json",
    requiredVert: [
      /in\s+vec4\s+tangent\b/,
      /out\s+vec3\s+vs_TEXCOORD1\b/,
      /dot\(t,\s*viewObj\)/,
    ],
    requiredFrag: [
      /uniform\s+mediump\s+sampler2D\s+_MainTex\b/,
      /uniform\s+mediump\s+sampler2D\s+_GradationMap\b/,
      /texture\(_GradationMap,\s*vec2\(gradU,\s*0\.5\)\)/,
      /t\s*\*\s*t\s*\*\s*\(3\.0\s*-\s*2\.0\s*\*\s*t\)/,
      /_194\s*=\s*vec4\(0\.0\)/,
    ],
    samplers: ["_MainTex", "_GradationMap"],
    samplerSlots: ["_MainTex", "_GradationMap"],
  },
  Card_Parallax: {
    name: "card_parallax",
    vert: "shaders/card_parallax.vert.glsl",
    frag: "shaders/card_parallax.frag.glsl",
    uniforms: "shaders/card_parallax_uniforms.json",
    requiredKeyword: "_UVASPECTRATIO_SQUARE",
    requiredVert: [
      /in\s+vec4\s+tangent\b/,
      /in\s+vec2\s+uv2\b/,
      /uniform\s+int\s+_UseUv\b/,
      /tv\.z\s*\+\s*0\.41999998688697815/,
      /float\(_UseUv\)\s*\*\s*\(\(-uv\)\s*\+\s*uv2\)/,
      /vs_TEXCOORD0\s*=\s*\(\(\(sourceUv\s*\*\s*2\.0\)\s*-\s*1\.0\)\s*\/\s*_Scale\)/,
      /^((?!1\.608700037).)*$/s,
    ],
    requiredFrag: [
      /uniform\s+mediump\s+sampler2D\s+_13\b/,
      /sampled\.rgb\s*\*\s*sampled\.a/,
      /_40\s*=\s*vec4\(0\.0\)/,
    ],
    samplers: ["_13"],
    samplerSlots: ["_MainTex"],
    runtimeFiles: ["app.js", "render/materials/base.js"],
    runtimePatterns: [
      /Card_Parallax:\s*\{\s*vert:\s*"shaders\/card_parallax\.vert\.glsl",\s*frag:\s*"shaders\/card_parallax\.frag\.glsl"\s*\}/,
      /exactShaders\?\.Card_Parallax/,
      /userData\.exactShader\s*=\s*"Card_Parallax"/,
      /userData\.exactVariant\s*=\s*"_UVASPECTRATIO_SQUARE"/,
    ],
  },
  Card_Parallax_Metal: {
    name: "card_parallax_metal",
    vert: "shaders/card_parallax_metal.vert.glsl",
    frag: "shaders/card_parallax_metal.frag.glsl",
    uniforms: "shaders/card_parallax_metal_uniforms.json",
    requiredVert: [
      /in\s+vec4\s+tangent\b/,
      /in\s+vec2\s+uv2\b/,
      /uniform\s+int\s+_UseUv\b/,
      /tv\.z\s*\+\s*0\.41999998688697815/,
      /float\(_UseUv\)\s*\*\s*\(\(-uv\)\s*\+\s*uv2\)/,
      /transpose\(inverse\(mat3\(modelMatrix\)\)\)\s*\*\s*normal/,
    ],
    requiredFrag: [
      /uniform\s+mediump\s+samplerCube\s+_CubeMap\b/,
      /uniform\s+mediump\s+sampler2D\s+_MetalMaskTex\b/,
      /pow\(clamp\(-reflected\.z,\s*0\.0,\s*1\.0\),\s*_Shininess\)/,
      /environment\s*\*\s*grazing\s*\*\s*_SpecularIntensity\s*\+\s*vec3\(_BaseColorIntensity\)/,
      /texture\(_MetalMaskTex,\s*vs_TEXCOORD0\)\.r\s*\*\s*_MetalMaskIntensity/,
      /_305\s*=\s*vec4\(0\.0\)/,
    ],
    samplers: ["_CubeMap", "_MetalMaskTex"],
    samplerSlots: ["_CubeMap", "_MetalMaskTex"],
    samplerTypes: { _CubeMap: "samplerCube" },
    runtimeFiles: ["app.js", "render/materials/ur.js"],
    runtimePatterns: [
      /Card_Parallax_Metal:\s*\{\s*vert:\s*"shaders\/card_parallax_metal\.vert\.glsl",\s*frag:\s*"shaders\/card_parallax_metal\.frag\.glsl"\s*\}/,
      /exactShaders\?\.Card_Parallax_Metal/,
      /userData\.exactShader\s*=\s*"Card_Parallax_Metal"/,
    ],
  },
  Opaque_Hologram_Tuning: {
    name: "opaque_hologram_tuning",
    vert: "shaders/opaque_hologram_tuning.vert.glsl",
    frag: "shaders/opaque_hologram_tuning.frag.glsl",
    uniforms: "shaders/opaque_hologram_tuning_uniforms.json",
    requiredVert: [
      /out\s+vec3\s+vs_TEXCOORD1\b/,
      /out\s+vec3\s+vs_TEXCOORD2\b/,
      /transpose\(inverse\(mat3\(modelMatrix\)\)\)\s*\*\s*normal/,
    ],
    requiredFrag: [
      /uniform\s+highp\s+mat4\s+viewMatrix\b/,
      /phase\.x\s*\*\s*0\.25\s*\+\s*0\.25/,
      /dot\(rotatedNormal\s*\*\s*_RampSpeed,\s*rotatedView\)/,
      /texture\(_CubeMap,\s*reflected\)/,
      /pow\(clamp\(-reflected\.z,\s*0\.0,\s*1\.0\),\s*_Shininess\)/,
      /mix\(base\.rgb,\s*shaded,\s*hologramMask\)/,
      /_611\s*=\s*vec4\(0\.0\)/,
      /^((?!discard).)*$/s,
    ],
    samplers: ["_PhaseTex", "_RampMaskTex", "_RampTex", "_CubeMap", "_MainTex", "_HologramMaskTex"],
    samplerSlots: ["_PhaseTex", "_RampMaskTex", "_RampTex", "_CubeMap", "_MainTex", "_HologramMaskTex"],
    samplerTypes: { _CubeMap: "samplerCube" },
    implicitDefaults: { _CubeMap: "gray" },
    runtimeFiles: ["app.js", "render/context.js", "render/materials/holo.js"],
    runtimePatterns: [
      /Opaque_Hologram_Tuning:\s*\{\s*vert:\s*"shaders\/opaque_hologram_tuning\.vert\.glsl",\s*frag:\s*"shaders\/opaque_hologram_tuning\.frag\.glsl"\s*\}/,
      /exactShaders\?\.Opaque_Hologram_Tuning/,
      /layerCubeDefault\(r\)/,
      /userData\.exactShader\s*=\s*"Opaque_Hologram_Tuning"/,
    ],
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
      /if\s*\(uBloomOnly != 0\)[\s\S]*?_1059\s*=\s*_1053/,
    ],
    samplers: ["_13", "_302", "_333", "_388", "_396", "_410", "_570", "_721"],
    samplerSlots: ["_BaseTex", "_HologramMaskTex", "_CubeMap", "_PhaseTex", "_PhaseMaskTex", "_RampMaskTex", "_RampTex", "_FakeSpecularMask"],
    samplerTypes: { _333: "samplerCube" },
    implicitDefaults: { _CubeMap: "gray" },
    mrt: { primary: "_1059", emissive: "_1053", webgl_bloom_route: "uBloomOnly" },
    runtimeFiles: ["app.js", "render/context.js", "render/materials/holo.js"],
    runtimePatterns: [
      /Frame_Holo_UR_New:\s*\{\s*vert:\s*"shaders\/frame_holo_ur\.vert\.glsl",\s*frag:\s*"shaders\/frame_holo_ur\.frag\.glsl"\s*\}/,
      /exactShaders\?\.Frame_Holo_UR_New/,
      /_333:\s*\{\s*value:\s*ctx\.layerCubeDefault\(r\)\s*\}/,
      /userData\.bloomSource\s*=\s*true/,
      /userData\.exactShader\s*=\s*"Frame-Holo-UR-New"/,
    ],
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
    implicitDefaults: { _CubeMap: "gray" },
    mrt: { primary: "_611", mask: "_623", mask_channel: "alpha", mask_switch: "_EmitMasking" },
    runtimeFiles: ["app.js", "render/context.js", "render/materials/holo.js"],
    runtimePatterns: [
      /Transparent_Hologram_Tuning:\s*\{\s*vert:\s*"shaders\/transparent_hologram_tuning\.vert\.glsl",\s*frag:\s*"shaders\/transparent_hologram_tuning\.frag\.glsl"\s*\}/,
      /exactShaders\?\.Transparent_Hologram_Tuning/,
      /_510:\s*\{\s*value:\s*ctx\.layerCubeDefault\(r\)\s*\}/,
      /_563:\s*\{\s*value:\s*ctx\.dynHoloTex\s*\|\|\s*ctx\.dynUITex\s*\}/,
      /uniforms\._563\)\s*m\.uniforms\._563\.value\s*=\s*t\.holo/,
      /userData\.exactShader\s*=\s*"Transparent_Hologram_Tuning"/,
    ],
  },
  Card_Parallax_Hologram_Tuning: {
    name: "card_parallax_hologram_tuning",
    vert: "shaders/card_parallax_hologram_tuning.vert.glsl",
    frag: "shaders/card_parallax_hologram_tuning.frag.glsl",
    uniforms: "shaders/card_parallax_hologram_tuning_uniforms.json",
    generatedBy: "build/build-exact-basic-holograms.mjs",
    requiredVert: [
      /in\s+vec4\s+tangent\b/,
      /in\s+vec2\s+uv2\b/,
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
    runtimeFiles: ["app.js", "render/materials/holo.js"],
    runtimePatterns: [
      /Card_Parallax_Hologram_Tuning:\s*\{\s*vert:\s*"shaders\/card_parallax_hologram_tuning\.vert\.glsl",\s*frag:\s*"shaders\/card_parallax_hologram_tuning\.frag\.glsl"\s*\}/,
      /exactShaders\?\.Card_Parallax_Hologram_Tuning/,
      /userData\.exactShader\s*=\s*"Card_Parallax_Hologram_Tuning"/,
    ],
  },
  Card_Hologram_Tuning: {
    name: "card_hologram_tuning",
    vert: "shaders/card_hologram_tuning.vert.glsl",
    frag: "shaders/card_hologram_tuning.frag.glsl",
    uniforms: "shaders/card_hologram_tuning_uniforms.json",
    generatedBy: "build/build-exact-basic-holograms.mjs",
    requiredVert: [
      /in\s+vec2\s+uv2\b/,
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
    mrt: { primary: "_678", secondary: "_680", secondary_value: "zero" },
    runtimeFiles: ["app.js", "render/materials/holo.js"],
    runtimePatterns: [
      /Card_Hologram_Tuning:\s*\{\s*vert:\s*"shaders\/card_hologram_tuning\.vert\.glsl",\s*frag:\s*"shaders\/card_hologram_tuning\.frag\.glsl"\s*\}/,
      /r\.shader\s*===\s*"Card_Hologram_Tuning"\s*&&\s*ctx\.exactShaders\?\.Card_Hologram_Tuning/,
      /userData\.exactShader\s*=\s*"Card_Hologram_Tuning"/,
    ],
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
    runtimeFiles: ["app.js", "render/context.js", "render/materials/holo.js"],
    runtimePatterns: [
      /"Frame-Holo-Tuning":\s*\{\s*vert:\s*"shaders\/frame_holo_tuning\.vert\.glsl",\s*frag:\s*"shaders\/frame_holo_tuning\.frag\.glsl"\s*\}/,
      /ctx\.exactShaders\?\.\["Frame-Holo-Tuning"\]/,
      /_693:\s*\{\s*value:\s*ctx\.layerCubeDefault\(r\)\s*\}/,
      /userData\.straight\s*=\s*true/,
      /userData\.exactShader\s*=\s*"Frame-Holo-Tuning"/,
    ],
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
    runtimeFiles: ["app.js", "render/context.js", "render/materials/holo.js"],
    runtimePatterns: [
      /"Opaque-Hologram_Tuning":\s*\{\s*vert:\s*"shaders\/opaque_shadowbox_hologram_tuning\.vert\.glsl",\s*frag:\s*"shaders\/opaque_shadowbox_hologram_tuning\.frag\.glsl"\s*\}/,
      /ctx\.exactShaders\?\.\["Opaque-Hologram_Tuning"\]/,
      /_352:\s*\{\s*value:\s*ctx\.layerCubeDefault\(r\)\s*\}/,
      /userData\.exactShader\s*=\s*"Opaque-Hologram_Tuning"/,
    ],
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
      /if\s*\(uBloomOnly != 0\)[\s\S]*?_1985\s*=\s*_2004/,
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
    mrt: { primary: "_1985", emissive: "_2004", webgl_bloom_route: "uBloomOnly" },
    runtimeFiles: ["app.js", "render/context.js", "render/materials/holo.js"],
    runtimePatterns: [
      /"Opaque-UR-Oklab":\s*\{\s*vert:\s*"shaders\/opaque_ur_oklab\.vert\.glsl",\s*frag:\s*"shaders\/opaque_ur_oklab\.frag\.glsl"\s*\}/,
      /exactUrProgram\s*=\s*ctx\.exactShaders\?\.\["Opaque-UR-Oklab"\]/,
      /r\.shader\s*===\s*"Opaque-UR-Oklab"[\s\S]*?&&\s*exactUrProgram/,
      /sceneKeywords\.every\(\(value, index\)\s*=>\s*value\s*===\s*opaqueUrKeywords\[index\]\)/,
      /_13:\s*\{\s*value:\s*ctx\.layerTexNoColorSpace\(r,\s*"_MainTex"\)\s*\}/,
      /_354:\s*\{\s*value:\s*ctx\.layerCubeDefault\(r\)\s*\}/,
      /vertexShader:\s*exactUrProgram\.vert/,
      /fragmentShader:\s*exactUrProgram\.frag/,
      /userData\.bloomSource\s*=\s*true/,
      /userData\.exactShader\s*=\s*"Opaque-UR-Oklab"/,
    ],
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
      /in\s+vec2\s+uv2\b/,
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
    runtimeFiles: ["app.js", "render/materials/ur.js"],
    runtimePatterns: [
      /Card_Parallax_Hologram_UR_New:\s*\{\s*vert:\s*"shaders\/ur_bg_hologram\.vert\.glsl",\s*frag:\s*"shaders\/ur_bg_hologram\.frag\.glsl"\s*\}/,
      /exactShaders\?\.Card_Parallax_Hologram_UR_New/,
      /_257:\s*\{\s*value:\s*ctx\.layerTexDefault\(r,\s*"_PhaseTex"\)\s*\}/,
      /vertexShader:\s*exact\.vert/,
      /fragmentShader:\s*exact\.frag/,
      /userData\.exactShader\s*=\s*"Card_Parallax_Hologram_UR_New"/,
    ],
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
      /in\s+vec2\s+uv2\b/,
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
    runtimeFiles: ["app.js", "render/context.js", "render/materials/ur.js"],
    runtimePatterns: [
      /Card_UR_Plate:\s*\{\s*vert:\s*"shaders\/ur_plate\.vert\.glsl",\s*frag:\s*"shaders\/ur_plate\.frag\.glsl"\s*\}/,
      /exactShaders\?\.Card_UR_Plate/,
      /_555:\s*\{\s*value:\s*ctx\.layerCubeDefault\(r\)\s*\}/,
      /_594:\s*\{\s*value:\s*tex\s*\}/,
      /userData\.exactShader\s*=\s*"Card_UR_Plate"/,
    ],
  },
  Card_Parallax_UR: {
    name: "parallax_ur",
    vert: "shaders/parallax_ur.vert.glsl",
    frag: "shaders/parallax_ur.frag.glsl",
    uniforms: "shaders/parallax_ur_uniforms.json",
    requiredVert: [
      /in\s+vec4\s+tangent\b/,
      /tv\.z\s*\+\s*0\.41999998688697815/,
      /out\s+vec2\s+vs_TEXCOORD0\b/,
    ],
    requiredFrag: [
      /uniform\s+mediump\s+sampler2D\s+_242\b/,
      /sin\(darkAngle\s*\*\s*3\.0\)/,
      /_276\s*=\s*vec4\(0\.0\)/,
    ],
    samplers: ["_242"],
    samplerSlots: ["_MainTex"],
  },
  Card_UR_Glitter_FlowMaps: {
    name: "glitter",
    vert: "shaders/glitter.vert.glsl",
    frag: "shaders/glitter.frag.glsl",
    uniforms: "shaders/glitter_uniforms.json",
    requiredVert: [
      /uniform\s+vec4\s+_78\s*\[\s*18\s*\]/,
      /out\s+vec4\s+vs_TEXCOORD0/,
      /out\s+vec4\s+vs_TEXCOORD1/,
    ],
    requiredFrag: [
      /uniform\s+highp\s+vec4\s+_37\s*\[\s*5\s*\]/,
      /layout\s*\(\s*location\s*=\s*0\s*\)\s*out\s+highp\s+vec4/,
      /in\s+highp\s+vec4\s+vs_TEXCOORD0/,
      /in\s+highp\s+vec4\s+vs_TEXCOORD1/,
    ],
    samplers: ["_13", "_205", "_404", "_644", "_690", "_843"],
    samplerSlots: ["_FlowAMap", "_ALightTex", "_ABaseTex", "_FlowBMap", "_BLightTex", "_BBaseTex"],
  },
};

function sceneId(name) {
  return name.replace(/^scene\.|\.json$/g, "");
}

function readText(rel) {
  const abs = path.join(PUBLIC, rel);
  return fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : null;
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

const rows = [];
const users = findSceneUsers();
for (const [shader, cfg] of Object.entries(EXACT_PORTS)) {
  const sceneUsers = users.get(shader) || [];
  const refs = sceneUsers.map((user) => user.ref);
  if (!sceneUsers.length) {
    rows.push({ ok: true, shader, asset: cfg.name, reason: "unused by current scenes", refs });
    continue;
  }

  const vert = readText(cfg.vert);
  const frag = readText(cfg.frag);
  const uniformsRaw = readText(cfg.uniforms);
  rows.push({ ok: !!vert, shader, asset: cfg.vert, reason: vert ? "present" : "missing", refs });
  rows.push({ ok: !!frag, shader, asset: cfg.frag, reason: frag ? "present" : "missing", refs });
  rows.push({ ok: !!uniformsRaw, shader, asset: cfg.uniforms, reason: uniformsRaw ? "present" : "missing", refs });
  if (cfg.requiredKeyword) {
    rows.push({
      ok: sceneUsers.every((user) => user.keywords.includes(cfg.requiredKeyword)),
      shader,
      asset: "scene.*.json",
      reason: `all scene users select variant ${cfg.requiredKeyword}`,
      refs,
    });
  }
  if (cfg.requiredKeywords) {
    const required = [...cfg.requiredKeywords].sort();
    rows.push({
      ok: sceneUsers.every((user) => JSON.stringify([...user.keywords].sort()) === JSON.stringify(required)),
      shader,
      asset: "scene.*.json",
      reason: `all scene users select exact keyword set ${required.join(",")}`,
      refs,
    });
  }
  if (cfg.runtimeFiles && cfg.runtimePatterns) {
    const runtimeSource = cfg.runtimeFiles.map((file) => readText(file) || "").join("\n");
    for (const re of cfg.runtimePatterns) {
      rows.push({ ok: re.test(runtimeSource), shader, asset: cfg.runtimeFiles.join(","), reason: `runtime wiring ${re}`, refs });
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
  if (uniformsRaw) {
    try {
      const uniforms = JSON.parse(uniformsRaw);
      rows.push({
        ok: JSON.stringify(uniforms.samplers || []) === JSON.stringify(cfg.samplers),
        shader,
        asset: cfg.uniforms,
        reason: "sampler binding order",
        refs,
      });
      rows.push({
        ok: JSON.stringify(uniforms.sampler_slots || []) === JSON.stringify(cfg.samplerSlots),
        shader,
        asset: cfg.uniforms,
        reason: "sampler slot order",
        refs,
      });
      if (cfg.requiredKeyword) {
        rows.push({
          ok: uniforms.variant === cfg.requiredKeyword,
          shader,
          asset: cfg.uniforms,
          reason: `uniform manifest variant ${cfg.requiredKeyword}`,
          refs,
        });
      }
      if (cfg.requiredKeywords) {
        rows.push({
          ok: JSON.stringify([...(uniforms.selected_keywords || [])].sort()) === JSON.stringify([...cfg.requiredKeywords].sort()),
          shader,
          asset: cfg.uniforms,
          reason: "uniform manifest selected keyword set",
          refs,
        });
      }
      if (cfg.implicitDefaults) {
        rows.push({
          ok: JSON.stringify(uniforms.implicit_defaults || {}) === JSON.stringify(cfg.implicitDefaults),
          shader,
          asset: cfg.uniforms,
          reason: "implicit texture defaults",
          refs,
        });
      }
      if (cfg.generatedBy) {
        rows.push({
          ok: uniforms.generated_by === cfg.generatedBy,
          shader,
          asset: cfg.uniforms,
          reason: "official generation provenance",
          refs,
        });
      }
      if (cfg.mrt) {
        rows.push({
          ok: JSON.stringify(uniforms.mrt || {}) === JSON.stringify(cfg.mrt),
          shader,
          asset: cfg.uniforms,
          reason: "MRT output/adaptation manifest",
          refs,
        });
      }
      if (shader === "Card_UR_Glitter_FlowMaps") {
        rows.push({
          ok: uniforms._78?.["15"]?.[0] === "__rotA" && uniforms._78?.["15"]?.[1] === "__rotB",
          shader,
          asset: cfg.uniforms,
          reason: "undeclared rotation slots documented",
          refs,
        });
        rows.push({
          ok: uniforms._37?.["4"]?.[0] === "_LightTime" && uniforms._37?.["4"]?.[1] === "_EmitThreshold",
          shader,
          asset: cfg.uniforms,
          reason: "twinkle pulse fields mapped",
          refs,
        });
      }
    } catch (err) {
      rows.push({ ok: false, shader, asset: cfg.uniforms, reason: `invalid json: ${err.message}`, refs });
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
