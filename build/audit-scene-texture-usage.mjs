// Check that scene-bound texture slots are official ShaderLab properties and are consumed by
// the renderer strategy for that shader kind. This catches recipe/strategy drift before visual QA.
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { SHADER } from "../public/render/rarities.js";
import { loadExactPortUsageContracts } from "./exact-port-usage-contracts.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const shaderRoot = process.env.PCR_SHADERS
  || "D:/DevProjectes/ptcgp-tools-master/masterdata_decoder/.output/decrypted/Common/Shader";
const sceneNames = fs.readdirSync(path.join(ROOT, "public"))
  .filter((n) => /^scene\..*\.json$/.test(n))
  .sort();
const exactPortUsage = loadExactPortUsageContracts(ROOT);

const USED_BY_KIND = {
  outerStencil: [],
  innerStencil: ["_BaseTex"],
  illustStencil: ["_BaseTex"],
  dynamicText: ["_DynamicUITex"],
  textured: ["_MainTex", "_BaseTex"],
  illustTextured: ["_MainTex", "_BaseTex"],
  simpleTransparent: ["_MainTex", "_BaseTex"],
  depthParallax: ["_MainTex", "_BaseTex"],
  effect: ["_MainTex", "_GradationMap"],
  frameOutline: ["_MainTex"],
  holo: ["_PhaseTex", "_RampMaskTex", "_RampTex", "_HologramMaskTex"],
  frameHolo: [
    "_BaseTex", "_CubeMap", "_FakeSpecularMask", "_HologramMaskTex", "_LayerMaskTex",
    "_HologramFrontMaskTex", "_PhaseTex", "_PhaseMaskTex", "_RampMaskTex", "_RampTex",
    "_RampMaskTex2", "_RampTex2",
  ],
  frameHoloUR: [
    "_BaseTex", "_CubeMap", "_FakeSpecularMask", "_HologramMaskTex", "_PhaseTex",
    "_PhaseMaskTex", "_RampMaskTex", "_RampTex",
  ],
  frame2LayerUR: [
    "_BaseTex", "_CubeMap", "_FakeSpecularMask", "_LayerMaskTex", "_PhaseTex",
    "_PhaseMaskTex", "_RampMaskTex", "_RampTex", "_RampMaskTex2", "_RampTex2",
  ],
  exHolo: ["_CubeMap", "_HologramMaskTex", "_PhaseTex", "_RampMaskTex", "_RampTex"],
  exHoloUR: ["_CubeMap", "_FakeSpecularMask", "_HologramMaskTex", "_PhaseMaskTex", "_PhaseTex", "_RampMaskTex", "_RampTex"],
  rarity: ["_CubeMap", "_HologramMaskTex", "_MainTex", "_PhaseTex", "_RampMaskTex", "_RampTex"],
  sbHolo: [
    "_CubeMap", "_FakeSpecularMask", "_HologramMaskTex", "_MainTex", "_MaskTex",
    "_NormalMap", "_NormalMap2", "_PhaseTex", "_PhaseTex2", "_RampMaskTex",
    "_RampMaskTex2", "_RampTex", "_RampTex2", "_ReflectionMask",
  ],
  plate: ["_CubeMap", "_FakeSpecularMask", "_HologramMaskTex", "_MainTex", "_BaseTex", "_PhaseMaskTex", "_PhaseTex", "_RampMaskTex", "_RampTex"],
  parallaxUR: ["_MainTex", "_BaseTex"],
  urBgHolo: ["_FakeSpecularMask", "_HologramMaskTex", "_PhaseMaskTex", "_PhaseTex", "_RampMaskTex", "_RampTex"],
  flare: ["_BaseMap", "_MainTex", "_FlareVAT"],
  metal: ["_CubeMap", "_MetalMaskTex"],
  glitter: ["_ABaseTex", "_ALightTex", "_BBaseTex", "_BLightTex", "_FlowAMap", "_FlowBMap"],
  sideBack: ["_BaseTex"],
  scalingKira: ["_BaseTex", "_ScrollLayerMask", "_RampTex"],
  circularMovingKira: [
    "_PrimATex", "_PrimAMorphTex", "_PrimBTex", "_PrimBMorphTex",
    "_PrimCTex", "_PrimCMorphTex",
  ],
  circularTrailKira: ["_BaseTex"],
  matCapLighting: ["_MatCapLightTex", "_LightingMask"],
  prism: ["_BaseTex"],
};

const USED_BY_SHADER = {
  "Frame-Holo-Tuning": [
    "_BaseTex", "_CubeMap", "_PhaseTex", "_RampMaskTex", "_RampTex",
    "_HologramMaskTex", "_HologramFrontMaskTex",
  ],
  "Card_Hologram_Tuning": [
    "_PhaseTex", "_RampMaskTex", "_RampTex", "_HologramMaskTex",
    "_HologramFrontMaskTex",
  ],
  "Simple-Opaque-Hologram_Tuning": [
    "_MainTex", "_PhaseTex", "_RampMaskTex", "_RampTex", "_HologramMaskTex",
  ],
  "Opaque-Hologram_Tuning": [
    "_MainTex", "_NormalMap", "_CubeMap", "_PhaseTex", "_RampTex", "_MaskTex",
    "_PhaseTex2", "_RampMaskTex2", "_RampTex2",
  ],
  "Opaque-UR-Oklab": [
    "_MainTex", "_CubeMap", "_PhaseTex", "_PhaseMaskTex", "_RampMaskTex",
    "_RampTex", "_HologramMaskTex", "_PhaseTex2", "_RampMaskTex2",
    "_RampTex2", "_NormalMap2", "_ReflectionMask", "_FakeSpecularMask",
  ],
  "Frame-Holo-UR-New": [
    "_BaseTex", "_CubeMap", "_PhaseTex", "_PhaseMaskTex", "_RampMaskTex",
    "_RampTex", "_HologramMaskTex", "_FakeSpecularMask",
  ],
  "Frame-2Layer-UR": [
    "_BaseTex", "_LayerMaskTex", "_CubeMap", "_PhaseTex", "_PhaseMaskTex",
    "_RampMaskTex", "_RampTex", "_RampMaskTex2", "_RampTex2",
    "_FakeSpecularMask",
  ],
  "Transparent-UR-New": [
    "_CubeMap", "_DynamicUITex", "_FakeSpecularMask", "_HologramMaskTex",
    "_PhaseMaskTex", "_PhaseTex", "_RampMaskTex", "_RampTex",
  ],
};

function usedSlotsFor(shader, kind) {
  if (exactPortUsage.has(shader)) return new Set(exactPortUsage.get(shader).textures);
  return new Set(USED_BY_SHADER[shader] || USED_BY_KIND[kind] || []);
}

function declaredStrategySlots() {
  const slots = new Set();
  for (const list of Object.values(USED_BY_KIND)) for (const slot of list) slots.add(slot);
  for (const list of Object.values(USED_BY_SHADER)) for (const slot of list) slots.add(slot);
  for (const usage of exactPortUsage.values()) for (const slot of usage.textures) slots.add(slot);
  return slots;
}

function sourceTextureSlots() {
  const dir = path.join(ROOT, "public/render/materials");
  const rows = [];
  const textureLike = /^_[A-Za-z0-9]*(?:Tex|Map|VAT)$/;
  for (const file of fs.readdirSync(dir).filter((n) => n.endsWith(".js"))) {
    const src = fs.readFileSync(path.join(dir, file), "utf8");
    for (const m of src.matchAll(/["'](_[A-Za-z0-9_]+)["']/g)) {
      const slot = m[1];
      if (textureLike.test(slot)) rows.push({ file, slot });
    }
  }
  return rows;
}

const TEXTURE_SLOT_ALIASES = {
  _MainTex: ["_BaseTex", "_BaseMap"],
  _BaseTex: ["_MainTex", "_BaseMap"],
  _BaseMap: ["_MainTex", "_BaseTex"],
};

function officialOrAlias(slot, officialSlots) {
  if (officialSlots.has(slot)) return { ok: true, reason: "official slot" };
  const aliases = TEXTURE_SLOT_ALIASES[slot] || [];
  const matched = aliases.find((name) => officialSlots.has(name));
  return matched
    ? { ok: true, reason: `main-texture alias for ${matched}` }
    : { ok: false, reason: "not a shader property" };
}

function exactPortTextureStatus(shader, slot, officialSlots) {
  const usage = exactPortUsage.get(shader);
  if (usage?.producerTextures.has(slot)) {
    return { ok: true, reason: "runtime producer sampler" };
  }
  return officialOrAlias(slot, officialSlots);
}

function sceneId(sceneName) {
  return sceneName.replace(/^scene\.|\.json$/g, "");
}

let official;
try {
  const stdout = execSync("python build/extract-shader-defaults.py", {
    input: JSON.stringify({ root: shaderRoot, shaders: Object.keys(SHADER).sort() }),
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
    stdio: ["pipe", "pipe", "inherit"],
  });
  official = JSON.parse(stdout);
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

const rows = [];
for (const shader of official.missing || []) {
  rows.push({ ok: false, shader, slot: "", kind: "", reason: "shader not found in official bundles" });
}

const declaredSlots = declaredStrategySlots();
for (const ref of sourceTextureSlots()) {
  rows.push({
    ok: declaredSlots.has(ref.slot),
    scene: "(source)",
    shader: "(source)",
    kind: ref.file,
    mat: ref.file,
    slot: ref.slot,
    reason: declaredSlots.has(ref.slot) ? "source slot declared" : "source slot missing declaration",
  });
}

for (const sceneName of sceneNames) {
  const scene = JSON.parse(fs.readFileSync(path.join(ROOT, "public", sceneName), "utf8"));
  for (const [matName, mat] of Object.entries(scene.materials || {})) {
    const shader = mat.shader;
    if (!shader) continue;
    const cfg = SHADER[shader];
    if (!cfg || cfg.defer) continue;
    const officialSlots = new Set(official.found[shader]?.textureProps || []);
    const usedSlots = usedSlotsFor(shader, cfg.kind);
    if (!exactPortUsage.has(shader) && !USED_BY_SHADER[shader] && !USED_BY_KIND[cfg.kind]) {
      rows.push({ ok: false, scene: sceneId(sceneName), shader, kind: cfg.kind, mat: matName, slot: "", reason: "missing usage declaration" });
      continue;
    }
    for (const slot of usedSlots) {
      const official = exactPortTextureStatus(shader, slot, officialSlots);
      rows.push({
        ok: official.ok,
        scene: sceneId(sceneName),
        shader,
        kind: cfg.kind,
        mat: matName,
        slot,
        reason: `strategy slot ${official.reason}`,
      });
    }
    for (const slot of Object.keys(mat.textures || {})) {
      const official = exactPortTextureStatus(shader, slot, officialSlots);
      const inactiveExactBinding = exactPortUsage.has(shader)
        && !exactPortUsage.get(shader).textures.has(slot);
      rows.push({
        ok: official.ok,
        scene: sceneId(sceneName),
        shader,
        kind: cfg.kind,
        mat: matName,
        slot,
        reason: official.reason,
      });
      rows.push({
        ok: usedSlots.has(slot) || inactiveExactBinding,
        scene: sceneId(sceneName),
        shader,
        kind: cfg.kind,
        mat: matName,
        slot,
        reason: usedSlots.has(slot)
          ? "strategy uses slot"
          : (inactiveExactBinding
            ? "selector executable has no active sampler binding"
            : "strategy ignores bound slot"),
      });
    }
  }
}

const grouped = new Map();
for (const row of rows) {
  const key = [row.ok, row.reason, row.shader, row.kind || "", row.slot].join("|");
  if (!grouped.has(key)) grouped.set(key, { ...row, count: 0, scenes: new Set(), examples: [] });
  const item = grouped.get(key);
  item.count += 1;
  if (row.scene) item.scenes.add(row.scene);
  if (item.examples.length < 4 && row.mat) item.examples.push(row.mat);
}

for (const row of [...grouped.values()].sort((a, b) => a.shader.localeCompare(b.shader) || a.slot.localeCompare(b.slot) || a.reason.localeCompare(b.reason))) {
  const mark = row.ok ? "OK " : "BAD";
  console.log(`${mark} ${row.shader.padEnd(35)} kind=${String(row.kind || "").padEnd(18)} slot=${row.slot.padEnd(24)} ${row.reason.padEnd(26)} count=${String(row.count).padStart(2)} scenes=${[...row.scenes].join(",")}`);
  if (row.examples.length) console.log(`     e.g. ${row.examples.join(", ")}`);
}

const bad = rows.filter((row) => !row.ok);
if (bad.length) {
  console.error(`\n${bad.length} scene texture usage issue(s) found.`);
  process.exitCode = 1;
}
