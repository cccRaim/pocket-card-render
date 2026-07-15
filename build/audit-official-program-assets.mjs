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
      if (cfg.implicitDefaults) {
        rows.push({
          ok: JSON.stringify(uniforms.implicit_defaults || {}) === JSON.stringify(cfg.implicitDefaults),
          shader,
          asset: cfg.uniforms,
          reason: "implicit texture defaults",
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
