// pocket-card-render — build a card's scene.json (the per-draw-call render recipe the browser consumes).
//
// ADVANCED / BYO-data tool. The DEFAULT demo uses the prebuilt public/scene.*.json, so most users never
// run this. To build a scene for a NEW card you need TWO inputs from your OWN game data (see ASSETS.md):
//   • the material recipe  <illId>_render_full.json  (per-material shader/queue/floats/textures) — from
//     the decrypted Unity material bundles; pre-generated, NOT produced here.
//   • the AssetRipper export (composed glb + textures).
// Both roots are configurable via env (defaults point at a sibling ptcg-apk-parser checkout):
//   PCR_GAME_SRC  = AssetRipper export root (contains Assets/…)   [default ../ptcg-apk-parser/apks/assets]
//   PCR_RECIPES   = dir holding <illId>_render_full.json + card_shader_state.json + tex_alpha_modes.json
//                                                                  [default ../ptcg-apk-parser/apks/output]
// Output: public/scene.json  { card, prefabGlb, materials{}, textures{name:/game/url}, alphaMode }

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { makeAlphaCache } from "./alpha.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const SIB = join(ROOT, "..", "ptcg-apk-parser", "apks");   // sibling checkout default
const ASSETS = process.env.PCR_GAME_SRC || join(SIB, "assets");   // AssetRipper export root (contains Assets/…)
const OUTPUT = process.env.PCR_RECIPES || join(SIB, "output");    // material recipes + shader-state + alpha cache
const PUB = join(ROOT, "public");

// L_UI_Dynamic_Text (the DynamicUI canvas quad) + Text are handled specially in app.js. The EX foils
// (L_UI_Hologram_EXIcon/EXRule, shader Transparent_Hologram_Tuning) ARE emitted now → app.js renders the
// holographic reflection on the ex-icon/ex-rule, masked by the DynamicUI alpha (_UseDynamicUI=1).
const SKIP_GO = new Set(["L_UI_Dynamic_Text"]);
const SKIP_SHADER = new Set(["Text", "Text_Alpha"]);
const short = (s) => (s || "").split("/").pop();
const toUrl = (abs) => "/game/" + relative(ASSETS, abs).replace(/\\/g, "/");

// the per-card material recipe (<illId>_render_full.json under PCR_RECIPES). Must be pre-generated from
// the decrypted material bundles (see ASSETS.md) — there is no Node Unity-bundle parser, so it is NOT
// produced here. Missing → fall back to the card-type default manifest (warns).
function recipeFor(cardId) {
  const per = `${cardId}_render_full.json`;
  if (existsSync(join(OUTPUT, per))) return per;
  const fallback = /^cTR/.test(cardId) ? "tr_render_full.json" : "card_render_full.json";
  console.warn(`no recipe ${per} in ${OUTPUT} → falling back to ${fallback} (text/materials may be wrong)`);
  return fallback;
}

// ---- index every PNG under apks/assets by basename (lower, no ext) -> absolute path
const pngByName = new Map();
function indexPng(root) {
  const stack = [root];
  while (stack.length) {
    const d = stack.pop();
    let ents; try { ents = readdirSync(d, { withFileTypes: true }); } catch { continue; }
    for (const e of ents) {
      const p = join(d, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (e.name.toLowerCase().endsWith(".png")) {
        const k = e.name.slice(0, -4).toLowerCase();
        if (!pngByName.has(k)) pngByName.set(k, p);
      }
    }
  }
}

// Build a card's scene object (materials + textures + glb), DYNAMICALLY for any card. cardId = the full
// illustration id (cTR_20_000230_00_LEAF_SR). recipeName defaults to the per-card / per-type runtime manifest.
let _indexed = false;
export function buildScene(cardId, recipeName = recipeFor(cardId)) {
  const CARD_ID = cardId, RARITY_TOKEN = CARD_ID.split("_").pop();
  if (!_indexed) { indexPng(ASSETS); _indexed = true; }   // index apks/assets PNGs once, cached across calls

  // card meta from the ScriptableObject JSON (AssetRipper exports it under the Face path)
  const csPath = findFile(join(ASSETS, "Assets/Lettuce/_Data/Common/CardNew/Face", CARD_ID), "CardSettings");
  const cs = csPath ? JSON.parse(readFileSync(csPath, "utf8")) : {};
  // AssetRipper stores CardSettings in ScriptableObjectGroup (not the Face path); fall back to the
  // name embedded in the card id (cPK_<set>_<num>_<sub>_<NAME>_<RARITY>) for the display label.
  const idParts = CARD_ID.split("_");
  const card = {
    id: cs._id ?? cs.m_Name ?? CARD_ID, name: cs._name ?? idParts[idParts.length - 2], rarity: cs._rarity, rarityToken: RARITY_TOKEN,
    cardType: cs._cardType, stageType: cs._stageType, energyType: cs._energyType,
  };

  const full = JSON.parse(readFileSync(join(OUTPUT, recipeName), "utf8"));

  // Some layers have renderQueue=-1 in the manifest (not captured). Resolve those from the shader's
  // real queue (card_shader_state.json) so the frame (Frame-Holo-Tuning = Transparent-800 = 2200)
  // sits UNDER the illustration/SB instead of being forced to the top.
  // optional: most recipes already carry a real renderQueue; without this file those resolve via the
  // shader-name queue tag or fall to the end. (It is a shared, one-off upstream artifact — see SETUP.md.)
  let shaderState = {};
  try { shaderState = JSON.parse(readFileSync(join(OUTPUT, "card_shader_state.json"), "utf8")); }
  catch { console.warn("card_shader_state.json not found — resolving queues from the recipe only"); }
  const BASEQ = { Background: 1000, Geometry: 2000, AlphaTest: 2450, Transparent: 3000, Overlay: 4000 };
  const parseQ = (str) => {
    const m = (str || "").match(/^([A-Za-z]+)([+-]\d+)?$/);
    if (!m || BASEQ[m[1]] == null) return null;
    return BASEQ[m[1]] + (m[2] ? parseInt(m[2], 10) : 0);
  };
  const shaderQ = {};
  for (const [name, info] of Object.entries(shaderState)) { const q = parseQ(info.queue); if (q != null) shaderQ[short(name)] = q; }
  const resolveQueue = (l) => (l.renderQueue && l.renderQueue > 0) ? l.renderQueue : (shaderQ[short(l.shader)] ?? 100000);

  const texUrls = {};
  const missing = new Set();
  function useTexture(name) {
    if (!name || name.startsWith("pptr:")) { if (name) missing.add(name); return null; }
    if (texUrls[name]) return texUrls[name];
    const abs = pngByName.get(name.toLowerCase());
    if (!abs) { missing.add(name); return null; }
    texUrls[name] = toUrl(abs);
    return texUrls[name];
  }

  // MATERIAL → RECIPE map. The renderer iterates the glb's own meshes and looks each up by its
  // material.name (authoritative, unambiguous) — no fragile node-name/counter matching. Each unique
  // material instance => one recipe (shader, resolved queue, clip region, textures, floats). Multiple
  // glb meshes sharing a material (the 4 RareMark diamonds) all use the same recipe at their own
  // world transforms; multi-material nodes (SBM2/SBM4, diamond/outline) split into distinct materials.
  const materials = {};
  for (const l of full.layers) {
    const go = l.go || "", shader = short(l.shader), mat = l.material || "";
    if (!mat || materials[mat]) continue;
    if (SKIP_GO.has(go) || SKIP_SHADER.has(shader) || l.renderer_enabled === false) continue;
    const textures = {};
    for (const [slot, t] of Object.entries(l.textures || {})) {
      const nm = (t && t.tex) || (typeof t === "string" ? t : null);
      if (!nm || nm.startsWith("pptr:")) continue;
      const url = useTexture(nm);
      textures[slot] = { name: nm, url };   // url=null if missing (renderer/validator can flag)
    }
    // stencil region: the material's _Stencil float is the authority (==2 → the inner/window region, e.g. the
    // trainer's EFM3/SBM1). Fall back to the prefab GO name ("…Window…" → window) which is how the Pokémon
    // window layers (no _Stencil float) are clipped. The Venusaur has no _Stencil==2 layer → unchanged.
    const stencil = l.floats && l.floats._Stencil;
    const clip = (stencil === 2) ? "window" : (/Window/.test(go) ? "window" : "card");
    materials[mat] = { shader, queue: resolveQueue(l), clip, stencil: stencil ?? null,
                       go, floats: l.floats || {}, colors: l.colors || {}, keywords: l.keywords || [], textures };
  }

  const glbAbs = join(ASSETS, "Assets/PrefabHierarchyObject", `${CARD_ID}_L.glb`);
  if (!existsSync(glbAbs)) console.warn(`WARNING: prefab glb not found: ${glbAbs}`);

  // per-texture alpha mode (straight/premult/opaque) — the renderer needs it to pick blend factors; without it
  // straight-alpha textures (the illustration / card_bg_gra) blow out. Memoised by texture name in apks/output.
  const alphaCache = makeAlphaCache(join(OUTPUT, "tex_alpha_modes.json"));
  const alphaMode = {};
  for (const name of Object.keys(texUrls)) alphaMode[name] = alphaCache.modeFor(name, pngByName.get(name.toLowerCase()));
  alphaCache.flush();

  return { card, prefabGlb: toUrl(glbAbs), materials, textures: texUrls, alphaMode, _missing: [...missing] };
}

function findFile(dir, baseName) {
  let ents; try { ents = readdirSync(dir, { withFileTypes: true }); } catch { return null; }
  for (const e of ents) {
    if (e.isFile() && e.name.toLowerCase().startsWith(baseName.toLowerCase())) return join(dir, e.name);
  }
  return null;
}

// CLI: node build.mjs <CARD_ID> [recipe.json] [outName.json]  → writes public/<outName> (back-compat)
if (process.argv[1] && process.argv[1].endsWith("build.mjs")) {
  const cardId = process.argv[2] || "cPK_10_000040_00_FUSHIGIBANAex_RR";
  const recipe = process.argv[3] || recipeFor(cardId);
  const outName = process.argv[4] || "scene.json";
  mkdirSync(PUB, { recursive: true });
  const scene = buildScene(cardId, recipe);
  writeFileSync(join(PUB, outName), JSON.stringify(scene, null, 1));
  console.log(`card ${cardId}: ${Object.keys(scene.materials).length} materials, ${Object.keys(scene.textures).length} textures -> public/${outName}`);
  if (scene._missing.length) console.log(`MISSING textures: ${scene._missing.join(", ")}`);
}
