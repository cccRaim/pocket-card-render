// Summarize current reference-scene renderer evidence coverage.
//
// This is not a pixel/visual fidelity score. It only says how many visible
// reference layers are dispatched and backed by an exact shader port or a
// bytecode-anchored audit. Visual parity still needs screenshots or stronger
// renderer-pipeline equivalence checks.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";
import { SHADER } from "../public/render/rarities.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const sceneNames = fs.readdirSync(path.join(ROOT, "public"))
  .filter((n) => /^scene\..*\.json$/.test(n))
  .sort();

const IGNORED_SHADERS = new Set(["OuterStencil", "InnerStencil"]);
const RUNTIME_SPECIAL_MATERIALS = new Set(["L_FullFace_Text", "DefaultMaterial"]);
const EXACT_SHADER = new Set([
  "Card_Illust",
  "Frame",
  "Simple-Opaque",
  "Simple-Transparent",
  "Effect",
  "Card_Parallax_UR",
  "Card_UR_Glitter_FlowMaps",
]);
const UR_CORE_GUARDED = new Set([
  "Card_UR_Plate",
  "Card_Parallax_Hologram_UR_New",
  "Frame-Holo-UR-New",
  "Frame-2Layer-UR",
  "Opaque-UR-Oklab",
  "Card_UR_LensFlare",
]);
const UR_REMAINDER_GUARDED = new Set([
  "Card_Parallax_UR",
  "Transparent-UR-New",
]);
const MRT_RGB_GUARDED = new Set([
  "Card_UR_LensFlare",
  "Frame-2Layer-UR",
  "Frame-Holo-UR-New",
  "Opaque-UR-Oklab",
]);
const EFFECT_GUARDED = new Set(["Effect"]);
const PARALLAX_GUARDED = new Set(["Card_Parallax", "Card_Parallax_Metal"]);
const FLAT_GUARDED = new Set(["Card_Illust", "Frame", "Simple-Opaque", "Simple-Transparent"]);
const HOLO_GUARDED = new Set([
  "Transparent_Hologram_Tuning",
  "Frame-Holo-Tuning",
  "Card_Hologram_Tuning",
  "Opaque_Hologram_Tuning",
  "Opaque-Hologram_Tuning",
  "Simple-Opaque-Hologram_Tuning",
  "Card_Parallax_Hologram_Tuning",
]);

export function sceneId(sceneName) {
  return sceneName.replace(/^scene\.|\.json$/g, "");
}

export function usedGlbMaterials(scene) {
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

export function pct(n, d) {
  return d ? `${(n / d * 100).toFixed(1)}%` : "n/a";
}

export function collectFidelityRows() {
  const rows = [];
  for (const sceneName of sceneNames) {
    const scene = JSON.parse(fs.readFileSync(path.join(ROOT, "public", sceneName), "utf8"));
    const used = usedGlbMaterials(scene);
    for (const [matName, mat] of Object.entries(scene.materials || {})) {
      if (used && !used.has(matName)) continue;
      const shader = mat.shader || "";
      if (!shader || IGNORED_SHADERS.has(shader) || shader.startsWith("InnerStencil")) continue;
      const cfg = SHADER[shader];
      if (cfg?.defer) continue;
      if (RUNTIME_SPECIAL_MATERIALS.has(matName)) continue;
      rows.push({
        scene: sceneId(sceneName),
        mat: matName,
        shader,
        kind: cfg?.kind || "",
        dispatched: !!(cfg && cfg.kind),
        exact: EXACT_SHADER.has(shader),
        urGuarded: UR_CORE_GUARDED.has(shader),
        urRemainderGuarded: UR_REMAINDER_GUARDED.has(shader),
        effectGuarded: EFFECT_GUARDED.has(shader),
        parallaxGuarded: PARALLAX_GUARDED.has(shader),
        flatGuarded: FLAT_GUARDED.has(shader),
        holoGuarded: HOLO_GUARDED.has(shader),
        mrtGuarded: MRT_RGB_GUARDED.has(shader),
      });
    }
  }
  return rows;
}

export function summarizeRows(rows) {
  const total = rows.length;
  return {
    total,
    dispatched: rows.filter((r) => r.dispatched).length,
    exact: rows.filter((r) => r.exact).length,
    urGuarded: rows.filter((r) => r.urGuarded).length,
    urRemainderGuarded: rows.filter((r) => r.urRemainderGuarded).length,
    effectGuarded: rows.filter((r) => r.effectGuarded).length,
    parallaxGuarded: rows.filter((r) => r.parallaxGuarded).length,
    flatGuarded: rows.filter((r) => r.flatGuarded).length,
    holoGuarded: rows.filter((r) => r.holoGuarded).length,
    mrtGuarded: rows.filter((r) => r.mrtGuarded).length,
    anyByteGuarded: rows.filter((r) => r.exact || r.urGuarded || r.urRemainderGuarded || r.effectGuarded || r.parallaxGuarded || r.flatGuarded || r.holoGuarded).length,
  };
}

export function printReport(rows = collectFidelityRows()) {
  const {
    total,
    dispatched,
    exact,
    urGuarded,
    urRemainderGuarded,
    effectGuarded,
    parallaxGuarded,
    flatGuarded,
    holoGuarded,
    mrtGuarded,
    anyByteGuarded,
  } = summarizeRows(rows);

  console.log("Renderer evidence report for reference scene visible layers");
  console.log(`visible layers:       ${total}`);
  console.log(`strategy dispatched:  ${dispatched}/${total} (${pct(dispatched, total)})`);
  console.log(`exact shader layers:  ${exact}/${total} (${pct(exact, total)})`);
  console.log(`UR byte-guarded:      ${urGuarded}/${total} (${pct(urGuarded, total)})`);
  console.log(`UR remainder guarded: ${urRemainderGuarded}/${total} (${pct(urRemainderGuarded, total)})`);
  console.log(`Effect byte-guarded:  ${effectGuarded}/${total} (${pct(effectGuarded, total)})`);
  console.log(`Parallax guarded:     ${parallaxGuarded}/${total} (${pct(parallaxGuarded, total)})`);
  console.log(`Flat/simple guarded:  ${flatGuarded}/${total} (${pct(flatGuarded, total)})`);
  console.log(`Holo byte-guarded:    ${holoGuarded}/${total} (${pct(holoGuarded, total)})`);
  console.log(`RGB MRT guarded:      ${mrtGuarded}/${total} (${pct(mrtGuarded, total)})`);
  console.log(`any byte/exact guard: ${anyByteGuarded}/${total} (${pct(anyByteGuarded, total)})`);
  console.log("note: this is evidence coverage, not visual/pixel fidelity");
  console.log("");

  const grouped = new Map();
  for (const row of rows) {
    const key = `${row.shader}|${row.kind}|${row.dispatched}|${row.exact}|${row.urGuarded}|${row.urRemainderGuarded}|${row.effectGuarded}|${row.parallaxGuarded}|${row.flatGuarded}|${row.holoGuarded}|${row.mrtGuarded}`;
    if (!grouped.has(key)) grouped.set(key, { ...row, count: 0, scenes: new Set(), examples: [] });
    const g = grouped.get(key);
    g.count += 1;
    g.scenes.add(row.scene);
    if (g.examples.length < 3) g.examples.push(row.mat);
  }

  for (const g of [...grouped.values()].sort((a, b) => b.count - a.count || a.shader.localeCompare(b.shader))) {
    const flags = [
      g.dispatched ? "strategy" : "missing",
      g.exact ? "exact" : null,
      g.urGuarded ? "ur-byte-guard" : null,
      g.urRemainderGuarded ? "ur-remainder-byte-guard" : null,
      g.effectGuarded ? "effect-byte-guard" : null,
      g.parallaxGuarded ? "parallax-byte-guard" : null,
      g.flatGuarded ? "flat-byte-guard" : null,
      g.holoGuarded ? "holo-byte-guard" : null,
      g.mrtGuarded ? "mrt-rgb-guard" : null,
    ].filter(Boolean).join(",");
    console.log(`${String(g.count).padStart(2)}  ${g.shader.padEnd(35)} kind=${g.kind.padEnd(16)} ${flags}`);
    console.log(`    scenes=${[...g.scenes].join(",")} e.g. ${g.examples.join(", ")}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  printReport();
}
