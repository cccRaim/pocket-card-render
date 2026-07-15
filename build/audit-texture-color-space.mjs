// Verify exported texture color-space metadata without applying it as a runtime conversion.
// The official Android player is Gamma, so both color and data textures are sampled as stored.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const DATA_SLOTS = new Set([
  "_MaskTex", "_HologramMaskTex", "_HologramFrontMaskTex", "_LayerMaskTex",
  "_PhaseTex", "_PhaseTex2", "_PhaseMaskTex",
  "_RampMaskTex", "_RampMaskTex2",
  "_NormalMap", "_NormalMap2",
  "_FakeSpecularMask", "_ReflectionMask", "_MetalMaskTex", "_ViewMask",
  "_ALightTex", "_BLightTex", "_FlowAMap", "_FlowBMap", "_FlareVAT",
]);

const COLOR_SLOTS = new Set([
  "_MainTex", "_BaseTex", "_BaseMap", "_RampTex", "_RampTex2",
  "_GradationMap", "_ABaseTex", "_BBaseTex",
]);

function sceneId(sceneName) {
  return sceneName.replace(/^scene\.|\.json$/g, "");
}

const rows = [];
const buildSource = fs.readFileSync(path.join(ROOT, "build", "build.mjs"), "utf8");
const appSource = fs.readFileSync(path.join(ROOT, "public", "app.js"), "utf8");
rows.push({
  ok: /tex\.colorSpace\s*=\s*THREE\.NoColorSpace/.test(appSource)
    && !/tex\.colorSpace\s*=\s*scene_data\.textureColorSpace/.test(appSource),
  scene: "(runtime)",
  shader: "",
  mat: "preloadTextures",
  slot: "(all)",
  texture: "",
  colorSpace: "raw",
  reason: "official Gamma workflow samples all runtime textures without sRGB decode",
});
for (const slot of DATA_SLOTS) {
  rows.push({
    ok: buildSource.includes(`"${slot}"`),
    scene: "(build)",
    shader: "",
    mat: "LINEAR_TEXTURE_SLOTS",
    slot,
    texture: "",
    colorSpace: "",
    reason: "build fallback marks data slot linear",
  });
}

const sceneNames = fs.readdirSync(path.join(ROOT, "public"))
  .filter((n) => /^scene\..*\.json$/.test(n))
  .sort();

for (const sceneName of sceneNames) {
  const scene = JSON.parse(fs.readFileSync(path.join(ROOT, "public", sceneName), "utf8"));
  for (const [matName, mat] of Object.entries(scene.materials || {})) {
    for (const [slot, tex] of Object.entries(mat.textures || {})) {
      if (!DATA_SLOTS.has(slot)) continue;
      const colorSpace = scene.textureColorSpace?.[tex.name];
      rows.push({
        ok: colorSpace === 0,
        scene: sceneId(sceneName),
        shader: mat.shader,
        mat: matName,
        slot,
        texture: tex.name,
        colorSpace,
        reason: "scene data slot textureColorSpace is NoColorSpace",
      });
    }
    for (const [slot, tex] of Object.entries(mat.textures || {})) {
      if (!COLOR_SLOTS.has(slot)) continue;
      const colorSpace = scene.textureColorSpace?.[tex.name];
      rows.push({
        ok: colorSpace === 1,
        scene: sceneId(sceneName),
        shader: mat.shader,
        mat: matName,
        slot,
        texture: tex.name,
        colorSpace,
        reason: "scene color slot textureColorSpace is sRGB",
      });
    }
  }
}

const grouped = new Map();
for (const row of rows) {
  const key = [row.ok, row.scene, row.shader, row.slot, row.texture, row.colorSpace, row.reason].join("|");
  if (!grouped.has(key)) grouped.set(key, { ...row, count: 0, examples: [] });
  const item = grouped.get(key);
  item.count += 1;
  if (item.examples.length < 4) item.examples.push(row.mat);
}

for (const row of [...grouped.values()].sort((a, b) =>
  String(a.scene).localeCompare(String(b.scene))
  || String(a.shader).localeCompare(String(b.shader))
  || String(a.slot).localeCompare(String(b.slot))
  || String(a.texture).localeCompare(String(b.texture)))) {
  const mark = row.ok ? "OK " : "BAD";
  console.log(`${mark} ${String(row.scene).padEnd(28)} ${String(row.shader).padEnd(35)} slot=${row.slot.padEnd(24)} tex=${String(row.texture).padEnd(34)} cs=${String(row.colorSpace).padEnd(4)} ${row.reason} count=${row.count}`);
  if (row.examples.length) console.log(`     e.g. ${row.examples.join(", ")}`);
}

const bad = rows.filter((row) => !row.ok);
if (bad.length) {
  console.error(`\n${bad.length} texture color-space issue(s) found.`);
  process.exitCode = 1;
}
