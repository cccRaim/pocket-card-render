// Audit that every visible material layer in the reference scenes has a registered strategy
// and passes that strategy's resource gate. This catches silent skips before visual QA.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SHADER } from "../public/render/rarities.js";
import { SHADER_TEXTURE_DEFAULTS } from "../public/render/shader-defaults.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sceneNames = fs.readdirSync(path.join(ROOT, "public"))
  .filter((n) => /^scene\..*\.json$/.test(n))
  .sort();

const sentinel = {};
const ignoredShaders = new Set(["OuterStencil", "InnerStencil"]);
const runtimeSpecialMaterials = new Set([
  // DynamicUI full-face text quad is intercepted in app.js and composited from /compose.
  "L_FullFace_Text",
  // AssetRipper/glTF placeholder material; app.js intentionally skips unknown DefaultMaterial meshes.
  "DefaultMaterial",
]);
const registeredKinds = scanRegisteredKinds();

function scanRegisteredKinds() {
  const dir = path.join(ROOT, "public/render/materials");
  const kinds = new Set();
  for (const file of fs.readdirSync(dir).filter((n) => n.endsWith(".js"))) {
    const src = fs.readFileSync(path.join(dir, file), "utf8");
    for (const m of src.matchAll(/defineMaterial\("([^"]+)"/g)) kinds.add(m[1]);
  }
  return kinds;
}

function sceneId(sceneName) {
  return sceneName.replace(/^scene\.|\.json$/g, "");
}

function hasBoundTexture(mat, slot) {
  return !!mat.textures?.[slot]?.name;
}

function makeAuditContext(scene) {
  return {
    envCubeTex: sentinel,
    exactGlit: sentinel,
    dynUITex: sentinel,
    dynHoloTex: sentinel,
    foilTex: sentinel,
    animMats: [],
    exactGlitMats: [],
    exHoloMats: [],
    layerTex: (mat, slot) => hasBoundTexture(mat, slot) ? sentinel : null,
    layerTexNoColorSpace: (mat, slot) => hasBoundTexture(mat, slot) ? sentinel : null,
    layerTexRepeat: (mat, slot) => hasBoundTexture(mat, slot) ? sentinel : null,
    layerTexDefault: (mat, slot) => (
      hasBoundTexture(mat, slot) || SHADER_TEXTURE_DEFAULTS[mat.shader]?.[slot]
    ) ? sentinel : null,
    layerTexDefaultRepeat: (mat, slot) => (
      hasBoundTexture(mat, slot) || SHADER_TEXTURE_DEFAULTS[mat.shader]?.[slot]
    ) ? sentinel : null,
    texStraight: (name) => !!(name && scene.alphaMode?.[name] === "straight"),
  };
}

function usedGlbMaterials(scene) {
  if (!scene.prefabGlb) return null;
  const file = path.join(ROOT, "public", scene.prefabGlb.replace(/^\//, ""));
  if (!fs.existsSync(file)) return null;
  const buf = fs.readFileSync(file);
  let off = 12;
  let gltf = null;
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32LE(off);
    const type = buf.readUInt32LE(off + 4);
    off += 8;
    if (type === 0x4e4f534a) gltf = JSON.parse(buf.subarray(off, off + len).toString("utf8"));
    off += len;
  }
  if (!gltf) return null;
  const names = (gltf.materials || []).map((m) => m.name);
  const used = new Set();
  for (const mesh of gltf.meshes || []) {
    for (const prim of mesh.primitives || []) {
      const name = names[prim.material];
      if (name) used.add(name);
    }
  }
  return used;
}

const hasMainTex = (mat, ctx) => !!(ctx.layerTex(mat, "_MainTex") || ctx.layerTex(mat, "_BaseTex"));
const hasMainTexDefault = (mat, ctx) => !!(ctx.layerTexDefault(mat, "_MainTex") || ctx.layerTexDefault(mat, "_BaseTex"));
const hasDefault = (slot) => (mat, ctx) => !!ctx.layerTexDefault(mat, slot);
const hasDefaultRepeat = (slot) => (mat, ctx) => !!ctx.layerTexDefaultRepeat(mat, slot);
const hasLayer = (slot) => (mat, ctx) => !!ctx.layerTex(mat, slot);

const REQUIREMENTS = {
  textured: hasMainTex,
  illustTextured: hasMainTex,
  simpleTransparent: hasMainTex,
  depthParallax: hasMainTexDefault,
  effect: hasDefault("_MainTex"),
  frameOutline: () => true,
  frame2LayerUR: (_mat, ctx) => !!ctx.envCubeTex,
  holo: (mat, ctx) => hasDefault("_PhaseTex")(mat, ctx) && hasDefault("_RampMaskTex")(mat, ctx) && hasDefault("_RampTex")(mat, ctx),
  frameHolo: (mat, ctx) => hasDefault("_RampTex")(mat, ctx) && (hasDefault("_HologramMaskTex")(mat, ctx) || hasLayer("_LayerMaskTex")(mat, ctx)),
  frameHoloUR: (mat, ctx) => [
    "_BaseTex", "_HologramMaskTex", "_PhaseTex", "_PhaseMaskTex", "_RampMaskTex", "_RampTex", "_FakeSpecularMask",
  ].every((slot) => hasDefault(slot)(mat, ctx)),
  exHolo: (mat, ctx) => !!(ctx.dynUITex && ctx.dynHoloTex && ctx.foilTex)
    && ["_PhaseTex", "_RampMaskTex", "_RampTex"].every((slot) => hasDefault(slot)(mat, ctx)),
  exHoloUR: (_mat, ctx) => !!(ctx.dynUITex && ctx.dynHoloTex),
  rarity: (mat, ctx) => hasLayer("_MainTex")(mat, ctx)
    && ["_PhaseTex", "_RampMaskTex", "_RampTex"].every((slot) => hasDefault(slot)(mat, ctx)),
  sbHolo: hasLayer("_MainTex"),
  plate: (mat, ctx) => !!(ctx.layerTex(mat, "_MainTex") || ctx.layerTex(mat, "_BaseTex") || ctx.layerTexDefault(mat, "_MainTex")),
  parallaxUR: (mat, ctx) => !!(ctx.layerTex(mat, "_MainTex") || ctx.layerTex(mat, "_BaseTex") || ctx.layerTexDefault(mat, "_MainTex")),
  urBgHolo: (mat, ctx) => ["_PhaseTex", "_RampMaskTex", "_RampTex", "_FakeSpecularMask"].every((slot) => hasDefault(slot)(mat, ctx)),
  flare: (mat, ctx) => !!(
    ctx.layerTex(mat, "_BaseMap") || ctx.layerTex(mat, "_MainTex") || ctx.layerTexDefault(mat, "_BaseMap")
  ) && hasDefaultRepeat("_FlareVAT")(mat, ctx),
  metal: () => true,
  glitter: (mat, ctx) => hasDefault("_ABaseTex")(mat, ctx) && hasDefault("_FlowAMap")(mat, ctx),
};

const rows = [];
for (const sceneName of sceneNames) {
  const scene = JSON.parse(fs.readFileSync(path.join(ROOT, "public", sceneName), "utf8"));
  const ctx = makeAuditContext(scene);
  const used = usedGlbMaterials(scene);
  if (used) {
    for (const matName of used) {
      if (scene.materials?.[matName] || runtimeSpecialMaterials.has(matName)) continue;
      rows.push({
        ok: false,
        scene: sceneId(sceneName),
        mat: matName,
        shader: "(glb)",
        kind: "",
        reason: "glb material missing scene recipe",
      });
    }
  }
  for (const [matName, mat] of Object.entries(scene.materials || {})) {
    if (used && !used.has(matName)) continue;
    const shader = mat.shader;
    if (!shader || ignoredShaders.has(shader) || shader.startsWith("InnerStencil")) continue;
    const cfg = SHADER[shader];
    if (!cfg) {
      rows.push({ ok: false, scene: sceneId(sceneName), mat: matName, shader, reason: "unmapped shader" });
      continue;
    }
    if (cfg.defer) {
      rows.push({ ok: true, scene: sceneId(sceneName), mat: matName, shader, kind: "(defer)", reason: "deferred" });
      continue;
    }
    if (!registeredKinds.has(cfg.kind)) {
      rows.push({ ok: false, scene: sceneId(sceneName), mat: matName, shader, kind: cfg.kind, reason: "missing strategy" });
      continue;
    }
    const requires = REQUIREMENTS[cfg.kind];
    if (!requires) {
      rows.push({ ok: false, scene: sceneId(sceneName), mat: matName, shader, kind: cfg.kind, reason: "missing audit gate" });
      continue;
    }
    let passes = false;
    try {
      passes = !!requires(mat, ctx);
    } catch (err) {
      rows.push({ ok: false, scene: sceneId(sceneName), mat: matName, shader, kind: cfg.kind, reason: `requires threw: ${err.message}` });
      continue;
    }
    rows.push({
      ok: passes,
      scene: sceneId(sceneName),
      mat: matName,
      shader,
      kind: cfg.kind,
      reason: passes ? "renders" : "requires=false",
    });
  }
}

const byKey = new Map();
for (const row of rows) {
  const key = [row.ok, row.reason, row.shader, row.kind || ""].join("|");
  if (!byKey.has(key)) byKey.set(key, { ...row, count: 0, scenes: new Set(), examples: [] });
  const agg = byKey.get(key);
  agg.count += 1;
  agg.scenes.add(row.scene);
  if (agg.examples.length < 4) agg.examples.push(row.mat);
}

console.log(`registered kinds: ${[...registeredKinds].sort().join(", ")}`);
for (const row of [...byKey.values()].sort((a, b) => a.shader.localeCompare(b.shader) || a.reason.localeCompare(b.reason))) {
  const mark = row.ok ? "OK " : "BAD";
  console.log(`${mark} ${row.shader.padEnd(35)} kind=${String(row.kind || "").padEnd(18)} ${row.reason.padEnd(16)} count=${String(row.count).padStart(2)} scenes=${[...row.scenes].join(",")}`);
  console.log(`     e.g. ${row.examples.join(", ")}`);
}

const bad = rows.filter((r) => !r.ok);
if (bad.length) {
  console.error(`\n${bad.length} visible layer coverage issue(s) found.`);
  process.exitCode = 1;
}
