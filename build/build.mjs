// pocket-card-render — build a card's scene file (the per-draw-call render recipe the browser consumes).
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
// Output: public/scene.<cardId>.json  { card, prefabGlb, materials{}, textures{name:/game/url}, alphaMode }

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { makeAlphaCache } from "./alpha.mjs";
import { OFFICIAL_RENDERER_TYPE } from "../public/render/official-draw-order.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const SIB = join(ROOT, "..", "ptcg-apk-parser", "apks");   // sibling checkout default
const ASSETS = process.env.PCR_GAME_SRC || join(SIB, "assets");   // AssetRipper export root (contains Assets/…)
const OUTPUT = process.env.PCR_RECIPES || join(SIB, "output");    // material recipes + shader-state + alpha cache
const PUB = join(ROOT, "public");

// Text is emitted as a normal selector-bound draw. Text_Alpha is a distinct official executable and
// remains excluded until it has its own exact port. EX foils consume the same encoded DynamicUI RT.
const SKIP_GO = new Set();
const SKIP_SHADER = new Set(["Text_Alpha"]);
const short = (s) => (s || "").split("/").pop();
const toUrl = (abs) =>
  encodeURI("/game/" + relative(ASSETS, abs).replace(/\\/g, "/"));
export const sceneFileName = (cardId) => `scene.${cardId}.json`;

const rotl32 = (value, bits) => ((value << bits) | (value >>> (32 - bits))) >>> 0;
function xxhash32(bytes, seed = 0x8f37154b) {
  const p1 = 0x9e3779b1, p2 = 0x85ebca77, p3 = 0xc2b2ae3d;
  const p4 = 0x27d4eb2f, p5 = 0x165667b1;
  let offset = 0;
  let hash;
  if (bytes.length >= 16) {
    let v1 = (seed + p1 + p2) | 0, v2 = (seed + p2) | 0;
    let v3 = seed | 0, v4 = (seed - p1) | 0;
    const round = (acc, input) => Math.imul(rotl32((acc + Math.imul(input, p2)) | 0, 13), p1);
    while (offset <= bytes.length - 16) {
      v1 = round(v1, bytes.readInt32LE(offset)); offset += 4;
      v2 = round(v2, bytes.readInt32LE(offset)); offset += 4;
      v3 = round(v3, bytes.readInt32LE(offset)); offset += 4;
      v4 = round(v4, bytes.readInt32LE(offset)); offset += 4;
    }
    hash = (rotl32(v1, 1) + rotl32(v2, 7) + rotl32(v3, 12) + rotl32(v4, 18)) | 0;
  } else {
    hash = (seed + p5) | 0;
  }
  hash = (hash + bytes.length) | 0;
  while (offset <= bytes.length - 4) {
    hash = Math.imul(rotl32((hash + Math.imul(bytes.readInt32LE(offset), p3)) | 0, 17), p4);
    offset += 4;
  }
  while (offset < bytes.length) {
    hash = Math.imul(rotl32((hash + Math.imul(bytes[offset], p5)) | 0, 11), p1);
    offset += 1;
  }
  hash ^= hash >>> 15; hash = Math.imul(hash, p2);
  hash ^= hash >>> 13; hash = Math.imul(hash, p3);
  return (hash ^ (hash >>> 16)) >>> 0;
}

function serializedLocalKeywordState(layer, label) {
  const names = layer.shaderKeywordNames;
  const enabled = layer.keywords;
  if (!Array.isArray(names) || !Array.isArray(enabled)) {
    throw new Error(`${label}: missing serialized Shader/Material keyword state`);
  }
  const indices = new Map();
  names.forEach((name, index) => {
    if (indices.has(name)) throw new Error(`${label}: duplicate Shader keyword ${name}`);
    indices.set(name, index);
  });
  const bytes = Buffer.alloc(Math.ceil(names.length / 64) * 8);
  for (const keyword of enabled) {
    const index = indices.get(keyword);
    if (!Number.isInteger(index)) throw new Error(`${label}: enabled keyword ${keyword} is outside Shader LocalSpace`);
    bytes[index >>> 3] |= 1 << (index & 7);
  }
  const hash = xxhash32(bytes);
  return {
    localKeywordCount: names.length,
    serializedLocalKeywordStateHex: bytes.toString("hex"),
    serializedLocalKeywordHash: hash,
    serializedLocalKeywordHashLow8: hash & 0xff,
    serializedLocalKeywordHashSource: "m_KeywordNames-order+m_ValidKeywords+XXH32-seed-0x8f37154b",
  };
}

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
    // ShaderLab uses Geometry when the SubShader has no Queue tag. The official shader-state extractor
    // records that absence as "?"; it is not an unresolved custom queue.
    if (str === "?") return BASEQ.Geometry;
    const m = (str || "").match(/^([A-Za-z]+)([+-]\d+)?$/);
    if (!m || BASEQ[m[1]] == null) return null;
    return BASEQ[m[1]] + (m[2] ? parseInt(m[2], 10) : 0);
  };
  const shaderQ = {};
  for (const [name, info] of Object.entries(shaderState)) { const q = parseQ(info.queue); if (q != null) shaderQ[short(name)] = q; }
  const resolveQueue = (l) => (l.renderQueue && l.renderQueue > 0) ? l.renderQueue : (shaderQ[short(l.shader)] ?? 100000);

  const texUrls = {};
  const texSlots = new Map();
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
  const officialDraws = [];
  const runtimeSettings = full.runtimeSettings || { kiraPuyo: {}, circularKira: {} };
  const kiraPuyoSettings = runtimeSettings.kiraPuyo || {};
  const circularKiraSettings = runtimeSettings.circularKira || {};
  const circularScalarFields = [
    "defaultCircularAnglePattern", "defaultCircularAngleManual", "tiltPower", "tiltThreshold",
    "tiltStateChangeDelay", "rotateAccel", "brakeDuration", "primTypeASymmetryCount",
    "primTypeBSymmetryCount", "primTypeCSymmetryCount", "meshDivideCount", "moveAngleScale",
    "centerIntensity", "fadeOut", "fadeOutEnd", "expandLength", "expandPower", "useLengthLimit",
    "limitLengthRatio", "limitAdjustCurvePower", "limitAdjustSpeed", "useDistanceFadeOut",
    "distanceFadeOutSpeed", "distanceFadeOutCurvePower",
    "isAnimationStopped",
  ];
  const circularPrimitiveFields = [
    "primType", "baseScale", "baseIntensity", "minIntensity", "maxIntensity", "flickerSpeed",
    "flickerScaling", "startAngle", "useMorphing", "useMorphingNoise", "morphingSpeed",
    "morphingClearly", "maxRotateSpeed", "reverseRotation",
  ];
  for (const [componentIdentity, config] of Object.entries(circularKiraSettings)) {
    const rendererBindings = config?.rendererBindings;
    const meshFilterBindings = config?.meshFilterBindings;
    if (config?.componentIdentity !== componentIdentity
        || typeof config?.componentGoIdentity !== "string"
        || typeof config?.componentGoPath !== "string" || !config.componentGoPath
        || typeof config?.scriptIdentity !== "string"
        || !["movingA", "movingB", "trailA", "trailB"].every((role) => typeof rendererBindings?.[role] === "string")
        || !["trailA", "trailB"].every((role) => typeof meshFilterBindings?.[role] === "string")
        || circularScalarFields.some((field) => !Number.isFinite(config?.[field]))
        || !Array.isArray(config?.primitives) || config.primitives.length === 0
        || config.primitives.some((primitive) => circularPrimitiveFields.some((field) => !Number.isFinite(primitive?.[field])))) {
      throw new Error(`${CARD_ID}: incomplete CircularKiraObject contract ${componentIdentity}`);
    }
  }
  const requireIdentity = (value, field, mat) => {
    const identity = value?.identity;
    if (typeof identity !== "string" || !identity.includes(":")) {
      throw new Error(`${CARD_ID}: missing official ${field} identity for ${mat}; regenerate the recipe with build/dump_recipe.py`);
    }
    return identity;
  };
  for (const l of full.layers) {
    const go = l.go || "", shader = short(l.shader), mat = l.material || "";
    if (!mat) continue;
    if (SKIP_GO.has(go) || SKIP_SHADER.has(shader) || l.renderer_enabled === false) continue;
    if (l.rendererType !== "MeshRenderer") {
      throw new Error(`${CARD_ID}: unsupported rendererType ${l.rendererType || "<missing>"} for ${mat}`);
    }
    const rendererTypeValue = OFFICIAL_RENDERER_TYPE[l.rendererType];
    if (!Number.isInteger(rendererTypeValue)) {
      throw new Error(`${CARD_ID}: missing native RendererType value for ${l.rendererType}`);
    }
    if (l.lodGroupMember !== false) {
      throw new Error(`${CARD_ID}: runtime LODFadeValue is not statically supported for ${mat}`);
    }
    if (l.sortingGroupCount !== 0) {
      throw new Error(`${CARD_ID}: runtime SortingGroup membership is not statically supported for ${mat}`);
    }
    const staticBatchInfo = l.staticBatchInfo || {};
    const staticBatchFirstSubMesh = staticBatchInfo.firstSubMesh;
    const staticBatchSubMeshCount = staticBatchInfo.subMeshCount;
    const lightmapIndex = l.lightmapIndex;
    const lightmapIndexDynamic = l.lightmapIndexDynamic;
    const keywordState = serializedLocalKeywordState(l, `${CARD_ID}:${mat}`);
    for (const [field, value] of Object.entries({
      materialSlot: l.materialSlot,
      staticBatchFirstSubMesh,
      staticBatchSubMeshCount,
      lightmapIndex,
      lightmapIndexDynamic,
    })) {
      if (!Number.isInteger(value)) throw new Error(`${CARD_ID}: missing integer ${field} for ${mat}`);
    }
    const sort = {
      rendererType: l.rendererType,
      rendererTypeValue,
      rendererPriority: l.rendererPriority,
      materialSlot: l.materialSlot,
      staticBatchFirstSubMesh,
      staticBatchSubMeshCount,
      lightmapIndex,
      lightmapIndexDynamic,
      packedLightmapIndices: ((lightmapIndexDynamic << 16) | lightmapIndex) >>> 0,
      lodFadeHighByte: 0,
      lodFadeSource: "non-LODGroup-native-default",
      sortingGroupId: 0xfffff,
      sortingGroupOrder: 0,
      sortingGroupKey: 0xfffff000,
      sortingGroupSource: "no-SortingGroup-native-default",
      // FlattenBasicData initializes Canvas order to zero for the regular MeshRenderer path.
      canvasOrder: 0,
      sortingLayerId: l.sortingLayer,
      sortingLayerValue: l.sortingLayerValue,
      sortingOrder: l.sortingOrder,
      // MeshRenderer has no serialized m_SortingFudge. The official native visible-node path
      // initializes its distance offset to zero; ParticleSystemRenderer must carry real data instead.
      distanceOffset: l.sortingFudge == null ? 0 : l.sortingFudge,
      distanceOffsetSource: l.sortingFudge == null ? "MeshRenderer-native-zero" : "m_SortingFudge",
      // A decisive non-UnityPerDraw per-renderer reflection witness proves incompatibility.
      // Null is preserved when static Shader data cannot prove either result.
      srpBatcherCompatible: l.srpBatcherCompatible === 0 ? 0 : null,
      srpBatcherSource: l.srpBatcherCompatible === 0
        ? l.srpBatcherEvidence
        : "not-statically-proved",
      materialBatchStateBranch: "hashed",
      materialBatchStateBranchSource: "DrawOpaque/DrawTransparent-command-selector-zero",
      ...keywordState,
    };
    const official = {
      renderer: requireIdentity(l.rendererIdentity, "renderer", mat),
      material: requireIdentity(l.materialIdentity, "material", mat),
      shader: requireIdentity(l.shaderIdentity, "shader", mat),
      mesh: requireIdentity(l.meshIdentity, "mesh", mat),
    };
    if (typeof l.goPath !== "string" || !l.goPath || !l.goPath.endsWith(`/${go}`) && l.goPath !== go) {
      throw new Error(`${CARD_ID}: missing or inconsistent official GameObject path for ${mat}:${go}`);
    }
    const rendererProperties = l.rendererProperties || {};
    if ((shader === "Card_Circular_Moving_Kira" || shader === "Card_Circular_Trail_Kira")
        && !rendererProperties.circularKira) {
      throw new Error(`${CARD_ID}: CircularKiraObject renderer contract is missing for ${mat}:${go}; regenerate the recipe`);
    }
    if (rendererProperties.kiraPuyo) {
      const kira = rendererProperties.kiraPuyo;
      const finiteFields = ["rampRepeat", "scrollScale", "scrollOffset", "vertScaleSpeed", "scaleAnimationOffset"];
      if (typeof kira.componentIdentity !== "string" || typeof kira.scriptIdentity !== "string"
          || typeof kira.settingsIdentity !== "string"
          || finiteFields.some((field) => !Number.isFinite(kira[field]))
          || !kiraPuyoSettings[kira.settingsIdentity]) {
        throw new Error(`${CARD_ID}: incomplete KiraPuyoObject contract for ${mat}:${go}`);
      }
    }
    if (rendererProperties.circularKira) {
      const binding = rendererProperties.circularKira;
      const config = circularKiraSettings[binding.componentIdentity];
      const expectedShader = binding.role?.startsWith("moving")
        ? "Card_Circular_Moving_Kira"
        : "Card_Circular_Trail_Kira";
      if (!config || !["movingA", "movingB", "trailA", "trailB"].includes(binding.role)
          || config.rendererBindings[binding.role] !== official.renderer
          || shader !== expectedShader) {
        throw new Error(`${CARD_ID}: inconsistent CircularKiraObject binding for ${mat}:${go}`);
      }
    }
    if (!Number.isInteger(l.renderQueue) || typeof l.enableInstancingVariants !== "boolean"
        || !Array.isArray(l.keywords) || !Array.isArray(l.invalidKeywords)
        || !Array.isArray(l.shaderKeywordNames) || !Array.isArray(l.shaderKeywordFlags)
        || l.shaderKeywordNames.length !== l.shaderKeywordFlags.length) {
      throw new Error(`${CARD_ID}: incomplete official serialized Material state for ${mat}`);
    }
    officialDraws.push({
      drawId: `${official.renderer}#${l.materialSlot}`,
      go,
      goPath: l.goPath,
      meshName: l.mesh,
      materialName: mat,
      materialSlot: l.materialSlot,
      rendererIdentity: official.renderer,
      materialIdentity: official.material,
      shaderIdentity: official.shader,
      meshIdentity: official.mesh,
      rendererProperties,
    });
    if (materials[mat]) {
      if (JSON.stringify(materials[mat].sort) !== JSON.stringify(sort)) {
        throw new Error(`${CARD_ID}: material ${mat} is shared by renderers with different sort inputs`);
      }
      if (materials[mat].official.material !== official.material
          || materials[mat].official.shader !== official.shader) {
        throw new Error(`${CARD_ID}: material name ${mat} resolves to multiple official Material/Shader identities`);
      }
      if (materials[mat].official.customRenderQueue !== l.renderQueue
          || materials[mat].official.enableInstancingVariants !== l.enableInstancingVariants
          || JSON.stringify(materials[mat].official.validKeywords) !== JSON.stringify(l.keywords)
          || JSON.stringify(materials[mat].official.invalidKeywords) !== JSON.stringify(l.invalidKeywords)
          || JSON.stringify(materials[mat].official.shaderKeywordNames) !== JSON.stringify(l.shaderKeywordNames)
          || JSON.stringify(materials[mat].official.shaderKeywordFlags) !== JSON.stringify(l.shaderKeywordFlags)) {
        throw new Error(`${CARD_ID}: material ${mat} has inconsistent official serialized Material state`);
      }
      continue;
    }
    const textures = {};
    for (const [slot, t] of Object.entries(l.textures || {})) {
      const nm = (t && t.tex) || (typeof t === "string" ? t : null);
      if (!nm || nm.startsWith("pptr:")) continue;
      const scale = typeof t === "object" ? t.scale : null;
      const offset = typeof t === "object" ? t.offset : null;
      if (![scale?.x, scale?.y, offset?.x, offset?.y].every(Number.isFinite)) {
        throw new Error(`${CARD_ID}: texture ${mat}.${slot} is missing official TexEnv scale/offset`);
      }
      const url = useTexture(nm);
      textures[slot] = {
        name: nm,
        url,
        scale: { x: scale.x, y: scale.y },
        offset: { x: offset.x, y: offset.y },
      }; // url=null if missing (renderer/validator can flag)
      if (!texSlots.has(nm)) texSlots.set(nm, new Set());
      texSlots.get(nm).add(slot);
    }
    // Renderer-level stencil region. _Stencil=2 is serialized evidence for the inner/window bit; otherwise
    // the official prefab GameObject name carries the region assignment used by Pokémon window renderers.
    // This is distinct from the static Shader pass: several _StencilRef materials serialize zero and receive
    // their region bit only when the renderer is bound at runtime.
    const stencil = l.floats && l.floats._Stencil;
    const clip = (stencil === 2) ? "window" : (/Window/.test(go) ? "window" : "card");
    materials[mat] = { shader, queue: resolveQueue(l), sort, official: {
                         material: official.material,
                         shader: official.shader,
                         customRenderQueue: l.renderQueue,
                         enableInstancingVariants: l.enableInstancingVariants,
                         validKeywords: l.keywords,
                         invalidKeywords: l.invalidKeywords,
                         shaderKeywordNames: l.shaderKeywordNames,
                         shaderKeywordFlags: l.shaderKeywordFlags,
                       }, clip, stencil: stencil ?? null,
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
  const textureColorSpace = {};
  for (const name of Object.keys(texUrls)) textureColorSpace[name] = textureColorSpaceFor(pngByName.get(name.toLowerCase()), texSlots.get(name));

  return { officialDrawSchemaVersion: 2, card, prefabGlb: toUrl(glbAbs), materials, officialDraws, runtimeSettings,
           textures: texUrls, alphaMode, textureColorSpace, _missing: [...missing] };
}

function findFile(dir, baseName) {
  let ents; try { ents = readdirSync(dir, { withFileTypes: true }); } catch { return null; }
  for (const e of ents) {
    if (e.isFile() && e.name.toLowerCase().startsWith(baseName.toLowerCase())) return join(dir, e.name);
  }
  return null;
}

const LINEAR_TEXTURE_SLOTS = new Set([
  "_MaskTex", "_HologramMaskTex", "_HologramFrontMaskTex", "_LayerMaskTex", "_PhaseTex", "_PhaseTex2", "_PhaseMaskTex",
  "_RampMaskTex", "_RampMaskTex2", "_NormalMap", "_NormalMap2", "_FakeSpecularMask", "_ReflectionMask",
  "_MetalMaskTex", "_ViewMask", "_ALightTex", "_BLightTex", "_FlowAMap", "_FlowBMap", "_FlareVAT",
]);

function textureColorSpaceFor(pngPath, slots = []) {
  if (!pngPath) return 1;
  const meta = pngPath.replace(/\.(png|jpe?g|tiff?)$/i, ".json");
  if (existsSync(meta)) {
    try {
      const v = JSON.parse(readFileSync(meta, "utf8")).m_ColorSpace;
      return v === 0 ? 0 : 1;
    } catch {}
  }
  return [...slots].some((slot) => LINEAR_TEXTURE_SLOTS.has(slot)) ? 0 : 1;
}

// CLI: node build.mjs <CARD_ID> [recipe.json] [outName.json]  → writes public/<outName>.
// If outName is omitted, the canonical name is scene.<CARD_ID>.json.
if (process.argv[1] && process.argv[1].endsWith("build.mjs")) {
  const cardId = process.argv[2] || "cPK_10_000040_00_FUSHIGIBANAex_RR";
  const recipe = process.argv[3] || recipeFor(cardId);
  const outName = process.argv[4] || sceneFileName(cardId);
  mkdirSync(PUB, { recursive: true });
  const scene = buildScene(cardId, recipe);
  writeFileSync(join(PUB, outName), JSON.stringify(scene, null, 1));
  console.log(`card ${cardId}: ${Object.keys(scene.materials).length} materials, ${Object.keys(scene.textures).length} textures -> public/${outName}`);
  if (scene._missing.length) console.log(`MISSING textures: ${scene._missing.join(", ")}`);
}
