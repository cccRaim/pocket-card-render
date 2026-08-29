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

import { readFileSync, mkdirSync, readdirSync, existsSync } from "node:fs";
import { join, dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { makeAlphaCache } from "./alpha.mjs";
import { atomicWriteFileSync } from "./atomic-publish.mjs";
import { OFFICIAL_RENDERER_TYPE } from "../public/render/official-draw-order.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const SIB = join(ROOT, "..", "ptcg-apk-parser", "apks");   // sibling checkout default
const ASSETS = process.env.PCR_GAME_SRC || join(SIB, "assets");   // AssetRipper export root (contains Assets/…)
const OUTPUT = process.env.PCR_RECIPES || join(SIB, "output");    // material recipes + shader-state + alpha cache
const PUB = join(ROOT, "public");

// Every official shader is emitted. Unsupported executables remain visible to the runtime dispatch
// and audit contracts instead of disappearing silently during scene generation.
const SKIP_GO = new Set();
const SKIP_SHADER = new Set();
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

// ---- index every PNG under apks/assets by basename (lower, no ext) -> absolute paths.
// Texture2D names are not globally unique: official Ramp and RampMask assets can share a basename.
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
        if (!pngByName.has(k)) pngByName.set(k, []);
        pngByName.get(k).push(p);
      }
    }
  }
  for (const paths of pngByName.values()) paths.sort();
}

export function resolveTextureAssetPath({
  name,
  assetPath,
  assetsRoot = ASSETS,
  pngIndex = pngByName,
  cardId = "scene",
}) {
  const candidates = pngIndex.get(name.toLowerCase()) || [];
  if (assetPath) {
    const normalized = assetPath.replaceAll("\\", "/").replace(/^\/+/, "");
    const exportedPath = normalized.replace(/\.(tif|tiff|tga|psd|exr|jpe?g)$/i, ".png");
    const abs = resolve(assetsRoot, ...exportedPath.split("/"));
    const rel = relative(resolve(assetsRoot), abs);
    if (rel.startsWith("..") || rel === "") {
      throw new Error(`${cardId}: invalid official texture assetPath ${assetPath}`);
    }
    if (!existsSync(abs)) {
      if (candidates.length === 1) return { abs: candidates[0], resourceKey: name };
      throw new Error(`${cardId}: official texture assetPath is missing from PCR_GAME_SRC: ${assetPath}`);
    }
    if (!candidates.includes(abs)) {
      throw new Error(`${cardId}: ${assetPath} does not resolve to official Texture2D ${name}`);
    }
    return { abs, resourceKey: candidates.length > 1 ? normalized : name };
  }
  if (candidates.length > 1) {
    throw new Error(
      `${cardId}: texture ${name} is ambiguous across ${candidates.length} official asset paths; `
      + "regenerate the recipe with build/dump_recipe.py so TexEnv.assetPath is preserved",
    );
  }
  return { abs: candidates[0] || null, resourceKey: name };
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
  // Recipe v2 carries the effective queue derived from the same official Shader
  // bytes as the Material. The aggregate is only a legacy fallback for old recipes.
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
  const resolveQueue = (l) => {
    if (!Number.isInteger(l.renderQueue) || l.renderQueue < -1) {
      throw new Error(`${CARD_ID}: invalid m_CustomRenderQueue for ${l.material}`);
    }
    if (l.renderQueue >= 0) {
      if (l.effectiveRenderQueue != null && l.effectiveRenderQueue !== l.renderQueue) {
        throw new Error(`${CARD_ID}: custom/effective render queue mismatch for ${l.material}`);
      }
      return l.renderQueue;
    }
    if (Number.isInteger(l.effectiveRenderQueue)) {
      if (l.effectiveRenderQueue < 0 || l.effectiveRenderQueue > 5000
          || !l.effectiveRenderQueueSource) {
        throw new Error(`${CARD_ID}: invalid effective Shader render queue for ${l.material}`);
      }
      return l.effectiveRenderQueue;
    }
    const legacyQueue = shaderQ[short(l.shader)];
    if (Number.isInteger(legacyQueue)) return legacyQueue;
    throw new Error(
      `${CARD_ID}: unresolved effective render queue for ${l.material}; `
      + "regenerate the recipe with the current build/dump_recipe.py",
    );
  };

  const texUrls = {};
  const texSlots = new Map();
  const texPaths = new Map();
  const missing = new Set();
  function useTexture(name, assetPath) {
    if (!name || name.startsWith("pptr:")) { if (name) missing.add(name); return null; }
    const { abs, resourceKey } = resolveTextureAssetPath({
      name,
      assetPath,
      assetsRoot: ASSETS,
      pngIndex: pngByName,
      cardId: CARD_ID,
    });
    if (!abs) { missing.add(name); return null; }
    const url = toUrl(abs);
    if (texUrls[resourceKey] && texUrls[resourceKey] !== url) {
      throw new Error(`${CARD_ID}: texture resource key ${resourceKey} resolves to multiple official paths`);
    }
    texUrls[resourceKey] = url;
    texPaths.set(resourceKey, abs);
    return { resourceKey, url };
  }

  // MATERIAL → RECIPE map. The renderer iterates the glb's own meshes and looks each up by its
  // material.name (authoritative, unambiguous) — no fragile node-name/counter matching. Each unique
  // material instance => one recipe (shader, resolved queue, clip region, textures, floats). Multiple
  // glb meshes sharing a material (the 4 RareMark diamonds) all use the same recipe at their own
  // world transforms; multi-material nodes (SBM2/SBM4, diamond/outline) split into distinct materials.
  const materials = {};
  const officialDraws = [];
  const runtimeSettings = full.runtimeSettings
    || {
      kiraPuyo: {},
      circularKira: {},
      cardFuture: {},
      cardAncient: {},
      ancientBGAnimation: {},
      cardMarble: {},
      cardMSR: {},
      msrAnimation: {},
      cardMRR: {},
      mrrAnimation: {},
    };
  const kiraPuyoSettings = runtimeSettings.kiraPuyo || {};
  const circularKiraSettings = runtimeSettings.circularKira || {};
  const cardFutureSettings = runtimeSettings.cardFuture || {};
  const cardAncientSettings = runtimeSettings.cardAncient || {};
  const ancientBGAnimationSettings = runtimeSettings.ancientBGAnimation || {};
  const cardMarbleSettings = runtimeSettings.cardMarble || {};
  const cardMSRSettings = runtimeSettings.cardMSR || {};
  const msrAnimationSettings = runtimeSettings.msrAnimation || {};
  const cardMRRSettings = runtimeSettings.cardMRR || {};
  const mrrAnimationSettings = runtimeSettings.mrrAnimation || {};
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
  const cardFutureScalarFields = [
    "animationTexFrameCount", "animationFrameCount", "animSwitchSpeed",
    "animFrameOffset", "skipAnimThreshold", "accellRatio", "isAnimationStopped",
  ];
  for (const [componentIdentity, config] of Object.entries(cardFutureSettings)) {
    if (config?.componentIdentity !== componentIdentity
        || typeof config?.componentGoIdentity !== "string"
        || typeof config?.componentGoPath !== "string" || !config.componentGoPath
        || typeof config?.scriptIdentity !== "string"
        || !Array.isArray(config?.rendererBindings) || config.rendererBindings.length === 0
        || config.rendererBindings.some((identity) => typeof identity !== "string")
        || cardFutureScalarFields.some((field) => !Number.isFinite(config?.[field]))
        || ![0, 1].includes(config?.isAnimationStopped)) {
      throw new Error(`${CARD_ID}: incomplete CardFutureObject contract ${componentIdentity}`);
    }
  }
  const cardAncientScalarFields = [
    "animCurveScale", "animStartDelayRangeA", "animStartDelayRangeB",
    "changeRangeStart", "changeRangeEnd", "zuzuGoalAnimThreshold",
    "goalThreshold", "scrollLength", "shapeChangeSpeed", "dot2Multiply",
    "accellRatio", "diffOffset", "shakeSpeed", "noiseScale",
    "frictionScale", "maxFriction", "startSandBaseEmissionRate",
    "middleSandBaseEmissionRate", "endSandBaseEmissionRate",
    "isAnimationStopped",
  ];
  const cardAncientVectorFields = [
    "shakeAIntensity", "shakeAFrequency", "shakeBIntensity", "shakeBFrequency",
  ];
  const ancientCurveNames = [
    "ZuzuA", "ZuzuB", "ZuzuC", "Zzzzz", "ZuzuGoal", "ShakeIntensity",
  ];
  const usedAncientCurves = new Set(["ZuzuA", "Zzzzz", "ZuzuGoal", "ShakeIntensity"]);
  for (const [settingsIdentity, settings] of Object.entries(ancientBGAnimationSettings)) {
    if (settings?.identity !== settingsIdentity
        || typeof settings?.scriptIdentity !== "string"
        || !settings.scriptIdentity.includes(":")
        || ancientCurveNames.some((name) => {
          const keys = settings?.curves?.[name]?.keys;
          return !Array.isArray(keys) || (usedAncientCurves.has(name) && keys.length < 2)
            || keys.some((key) => [
              "time", "value", "inSlope", "outSlope",
              "weightedMode", "inWeight", "outWeight",
            ].some((field) => !Number.isFinite(key?.[field])));
        })) {
      throw new Error(`${CARD_ID}: incomplete AncientBGAnimationSettings contract ${settingsIdentity}`);
    }
  }
  for (const [componentIdentity, config] of Object.entries(cardAncientSettings)) {
    if (config?.componentIdentity !== componentIdentity
        || typeof config?.componentGoIdentity !== "string"
        || typeof config?.componentGoPath !== "string" || !config.componentGoPath
        || typeof config?.scriptIdentity !== "string"
        || typeof config?.curveSettingsIdentity !== "string"
        || !ancientBGAnimationSettings[config.curveSettingsIdentity]
        || !Array.isArray(config?.rendererBindings) || config.rendererBindings.length === 0
        || config.rendererBindings.some((identity) => typeof identity !== "string")
        || !Array.isArray(config?.scrolls) || config.scrolls.length < 6
        || config.scrolls.some((value) => !Number.isFinite(value))
        || cardAncientScalarFields.some((field) => !Number.isFinite(config?.[field]))
        || cardAncientVectorFields.some((field) =>
          !Number.isFinite(config?.[field]?.x) || !Number.isFinite(config?.[field]?.y))
        || ![0, 1].includes(config?.isAnimationStopped)) {
      throw new Error(`${CARD_ID}: incomplete CardAncientObject contract ${componentIdentity}`);
    }
  }
  const cardMarbleScalarFields = [
    "tiltPower", "delayTime2", "pointAccel", "shearAccel",
    "dorodoroDistance", "resistancePower", "minDorodoroCoef",
    "maxPointSpeed", "minPointSpeed", "goalThreshold",
    "pointMoveByTilt", "pointForceChangeByTilt",
  ];
  const cardMarblePointFields = [
    "rotationWithTilt", "defaultForce", "tiltForce",
  ];
  const cardMarbleCurveFields = [
    "defaultRemapCurve", "tiltRemapCurve", "remapRemapCurve",
  ];
  for (const [componentIdentity, config] of Object.entries(cardMarbleSettings)) {
    const remap = config?.defaultNoiseRemapSettings;
    if (config?.componentIdentity !== componentIdentity
        || typeof config?.componentGoIdentity !== "string"
        || typeof config?.componentGoPath !== "string" || !config.componentGoPath
        || typeof config?.scriptIdentity !== "string"
        || !Array.isArray(config?.rendererBindings) || config.rendererBindings.length === 0
        || config.rendererBindings.some((identity) => typeof identity !== "string")
        || ![0, 1].includes(config?.useMarbleDelay)
        || cardMarbleScalarFields.some((field) => !Number.isFinite(config?.[field]))
        || !Array.isArray(config?.points) || config.points.length < 1
        || config.points.length > 4
        || config.points.some((point) =>
          cardMarblePointFields.some((field) => !Number.isFinite(point?.[field]))
          || ["defaultPosition", "tiltMovePosition"].some((field) =>
            !Number.isFinite(point?.[field]?.x) || !Number.isFinite(point?.[field]?.y)))
        || remap?.curveLabel !== "_DefaultNoiseRemapCurveTexture"
        || !Number.isInteger(remap?.resolution)
        || remap.resolution < 1 || remap.resolution > 12
        || cardMarbleCurveFields.some((field) => {
          const keys = remap?.[field]?.keys;
          return !Array.isArray(keys) || keys.length < 2
            || keys.some((key) => [
              "time", "value", "inSlope", "outSlope",
              "weightedMode", "inWeight", "outWeight",
            ].some((name) => !Number.isFinite(key?.[name])));
        })) {
      throw new Error(`${CARD_ID}: incomplete CardMarbleLayer contract ${componentIdentity}`);
    }
  }
  const cardMSRScalarFields = [
    "animStartDegree", "animTimeScale", "animDuration", "endAnimDuration",
    "stopAnimTiming", "timeOffset", "intensityNoiseSpeed",
    "reflectFlipBookMaxSpeed", "reflectStartBane", "reflectStartNensei",
    "reflectEndBane", "reflectEndNensei", "checkRotatingTime",
    "rotatingEndThreshold", "rotatingStartThreshold", "disappearBane",
    "disappearNensei", "appearBane", "appearNensei",
  ];
  const msrCurveNames = [
    "OutlineReflectCenterX", "OutlineReflectColorIntensity",
    "ColorIntensityNoiseStrength", "OutlineReflectFlipBookAnim",
    "OutlineReflectStartSpeed", "OutlineReflectEndSpeed",
    "AuraTransparency", "ParallaxTransparency", "ParallaxTranslate",
    "ParallaxAppearTransparency", "ParallaxAppearTranslate",
    "ParallaxDisappearTransparency", "ParallaxDisappearTranslate",
  ];
  const requiredMSRCurves = new Set(msrCurveNames.slice(0, 9));
  for (const [settingsIdentity, settings] of Object.entries(msrAnimationSettings)) {
    if (settings?.identity !== settingsIdentity
        || typeof settings?.scriptIdentity !== "string"
        || !settings.scriptIdentity.includes(":")
        || msrCurveNames.some((name) => {
          const keys = settings?.curves?.[name]?.keys;
          return !Array.isArray(keys)
            || (requiredMSRCurves.has(name) && keys.length < 2)
            || keys.some((key) => [
              "time", "value", "inSlope", "outSlope",
              "weightedMode", "inWeight", "outWeight",
            ].some((field) => !Number.isFinite(key?.[field])));
        })) {
      throw new Error(`${CARD_ID}: incomplete MSRAnimationSettings contract ${settingsIdentity}`);
    }
  }
  for (const [componentIdentity, config] of Object.entries(cardMSRSettings)) {
    const rendererBindings = config?.rendererBindings;
    if (config?.componentIdentity !== componentIdentity
        || typeof config?.componentGoIdentity !== "string"
        || typeof config?.componentGoPath !== "string" || !config.componentGoPath
        || typeof config?.scriptIdentity !== "string"
        || typeof config?.animationSettingsIdentity !== "string"
        || !msrAnimationSettings[config.animationSettingsIdentity]
        || !["aura", "parallax", "shadowbox"].every((role) =>
          Array.isArray(rendererBindings?.[role])
          && rendererBindings[role].length > 0
          && rendererBindings[role].every((identity) =>
            typeof identity === "string" && identity.includes(":")))
        || cardMSRScalarFields.some((field) => !Number.isFinite(config?.[field]))
        || ![0, 1].includes(config?.isAnimationStopped)) {
      throw new Error(`${CARD_ID}: incomplete CardMSRObject contract ${componentIdentity}`);
    }
  }
  const cardMRRScalarFields = [
    "animStartDegree", "animTimeScale", "animDuration",
    "flashRadialStartOffset", "recordingTime", "minTiltSpeed",
    "maxTiltSpeed", "minAnimSpeed", "maxAnimSpeed",
  ];
  const mrrCurveNames = [
    "ChangeColorCurve", "LightColorIntensityCurve",
    "LightEmitIntensityCurve", "LightPower",
    "Layer2UVXTranslateByTiltingLeft",
    "Layer2UVXTranslateByTiltingRight",
    "Layer2ColorPower", "Layer2EmissiveIntensity", "EffSwitchColor",
    "EffAdditiveIntensity", "EffColor3Blend", "EffEmissiveIntensity",
    "FlashIntensity", "FlashRadialScaling", "FlashRadialAnim",
  ];
  for (const [settingsIdentity, settings] of Object.entries(mrrAnimationSettings)) {
    if (settings?.identity !== settingsIdentity
        || typeof settings?.scriptIdentity !== "string"
        || !settings.scriptIdentity.includes(":")
        || mrrCurveNames.some((name) => {
          const keys = settings?.curves?.[name]?.keys;
          return !Array.isArray(keys) || keys.length < 2
            || keys.some((key) => [
              "time", "value", "inSlope", "outSlope",
              "weightedMode", "inWeight", "outWeight",
            ].some((field) => !Number.isFinite(key?.[field])));
        })) {
      throw new Error(`${CARD_ID}: incomplete MRRAnimationSettings contract ${settingsIdentity}`);
    }
  }
  for (const [componentIdentity, config] of Object.entries(cardMRRSettings)) {
    const rendererBindings = config?.rendererBindings;
    if (config?.componentIdentity !== componentIdentity
        || typeof config?.componentGoIdentity !== "string"
        || typeof config?.componentGoPath !== "string" || !config.componentGoPath
        || typeof config?.scriptIdentity !== "string"
        || typeof config?.animationSettingsIdentity !== "string"
        || !mrrAnimationSettings[config.animationSettingsIdentity]
        || !["main", "effect", "flash"].every((role) =>
          Array.isArray(rendererBindings?.[role])
          && rendererBindings[role].length > 0
          && rendererBindings[role].every((identity) =>
            typeof identity === "string" && identity.includes(":")))
        || cardMRRScalarFields.some((field) => !Number.isFinite(config?.[field]))
        || ![0, 1].includes(config?.useSpeedAdjust)
        || config.animTimeScale <= 0
        || config.recordingTime < 0
        || config.maxTiltSpeed <= config.minTiltSpeed) {
      throw new Error(`${CARD_ID}: incomplete CardMRRObject contract ${componentIdentity}`);
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
    if (!mat) {
      const unresolvedMaterial = l.materialIdentity?.pathId
        && l.materialIdentity.pathId !== "0";
      if (unresolvedMaterial && l.renderer_enabled !== false) {
        throw new Error(
          `${CARD_ID}: ${go} material slot ${l.materialSlot} has unresolved official Material `
          + `${l.materialIdentity.identity}; regenerate the recipe with CAB dependency closure`,
        );
      }
      continue;
    }
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
    if (shader === "Card_Parallax_Future") {
      const binding = rendererProperties.cardFuture;
      const config = binding && cardFutureSettings[binding.componentIdentity];
      if (!config || binding.rendererIdentity !== official.renderer
          || !config.rendererBindings.includes(official.renderer)) {
        throw new Error(`${CARD_ID}: inconsistent CardFutureObject binding for ${mat}:${go}`);
      }
    } else if (rendererProperties.cardFuture) {
      throw new Error(`${CARD_ID}: unexpected CardFutureObject binding for ${mat}:${go}`);
    }
    if (shader === "Card_Parallax_Strata") {
      const binding = rendererProperties.cardAncient;
      const config = binding && cardAncientSettings[binding.componentIdentity];
      if (!config || binding.rendererIdentity !== official.renderer
          || !config.rendererBindings.includes(official.renderer)
          || !ancientBGAnimationSettings[config.curveSettingsIdentity]) {
        throw new Error(`${CARD_ID}: inconsistent CardAncientObject binding for ${mat}:${go}`);
      }
    } else if (rendererProperties.cardAncient) {
      throw new Error(`${CARD_ID}: unexpected CardAncientObject binding for ${mat}:${go}`);
    }
    if (shader === "Card_Parallax_Marble") {
      const binding = rendererProperties.cardMarble;
      const config = binding && cardMarbleSettings[binding.componentIdentity];
      if (!config || binding.rendererIdentity !== official.renderer
          || !config.rendererBindings.includes(official.renderer)) {
        throw new Error(`${CARD_ID}: inconsistent CardMarbleLayer binding for ${mat}:${go}`);
      }
    } else if (rendererProperties.cardMarble) {
      throw new Error(`${CARD_ID}: unexpected CardMarbleLayer binding for ${mat}:${go}`);
    }
    const msrTagRoles = {
      "Card-Aura": "aura",
      Card_Parallax_Transparent_Translate: "parallax",
      ShadowBox_MSR: "shadowbox",
    };
    const msrSearchTags = (l.shaderSearchTags || [])
      .filter((tag) => Object.hasOwn(msrTagRoles, tag));
    if (msrSearchTags.length > 1) {
      throw new Error(`${CARD_ID}: multiple CardMSRObject SearchTags for ${mat}:${go}`);
    }
    if (msrSearchTags.length === 1) {
      const binding = rendererProperties.cardMSR;
      const config = binding && cardMSRSettings[binding.componentIdentity];
      const role = msrTagRoles[msrSearchTags[0]];
      if (!config || binding.rendererIdentity !== official.renderer
          || binding.role !== role || binding.searchTag !== msrSearchTags[0]
          || !config.rendererBindings[role].includes(official.renderer)
          || !msrAnimationSettings[config.animationSettingsIdentity]) {
        throw new Error(`${CARD_ID}: inconsistent CardMSRObject binding for ${mat}:${go}`);
      }
    } else if (rendererProperties.cardMSR) {
      throw new Error(`${CARD_ID}: unexpected CardMSRObject binding for ${mat}:${go}`);
    }
    const mrrTagRoles = {
      "MRR-ChangeColor-Lighting": "main",
      "Frame-Holo-2Layer": "main",
      "Card-Effect-Emit": "effect",
      "MRR-Parallax-Flash": "flash",
    };
    const mrrSearchTags = (l.shaderSearchTags || [])
      .filter((tag) => Object.hasOwn(mrrTagRoles, tag));
    if (mrrSearchTags.length > 1) {
      throw new Error(`${CARD_ID}: multiple CardMRRObject SearchTags for ${mat}:${go}`);
    }
    if (mrrSearchTags.length === 1) {
      const binding = rendererProperties.cardMRR;
      const config = binding && cardMRRSettings[binding.componentIdentity];
      const role = mrrTagRoles[mrrSearchTags[0]];
      if (!config || binding.rendererIdentity !== official.renderer
          || binding.role !== role || binding.searchTag !== mrrSearchTags[0]
          || !config.rendererBindings[role].includes(official.renderer)
          || !mrrAnimationSettings[config.animationSettingsIdentity]) {
        throw new Error(`${CARD_ID}: inconsistent CardMRRObject binding for ${mat}:${go}`);
      }
    } else if (rendererProperties.cardMRR) {
      throw new Error(`${CARD_ID}: unexpected CardMRRObject binding for ${mat}:${go}`);
    }
    if (!Number.isInteger(l.renderQueue) || typeof l.enableInstancingVariants !== "boolean"
        || !Array.isArray(l.keywords) || !Array.isArray(l.invalidKeywords)
        || !Array.isArray(l.shaderKeywordNames) || !Array.isArray(l.shaderKeywordFlags)
        || l.shaderKeywordNames.length !== l.shaderKeywordFlags.length) {
      throw new Error(`${CARD_ID}: incomplete official serialized Material state for ${mat}`);
    }
    const materialSerialized = l.materialSerialized || null;
    if (materialSerialized
        && (!Number.isInteger(materialSerialized.rawByteSize)
          || !/^[0-9a-f]{64}$/.test(materialSerialized.rawSha256 || "")
          || !/^[0-9a-f]{64}$/.test(
            materialSerialized.savedProperties?.digest || "",
          ))) {
      throw new Error(`${CARD_ID}: invalid Material byte provenance for ${mat}`);
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
          || materials[mat].official.effectiveRenderQueue !== resolveQueue(l)
          || materials[mat].official.enableInstancingVariants !== l.enableInstancingVariants
          || JSON.stringify(materials[mat].official.validKeywords) !== JSON.stringify(l.keywords)
          || JSON.stringify(materials[mat].official.invalidKeywords) !== JSON.stringify(l.invalidKeywords)
          || JSON.stringify(materials[mat].official.shaderKeywordNames) !== JSON.stringify(l.shaderKeywordNames)
          || JSON.stringify(materials[mat].official.shaderKeywordFlags) !== JSON.stringify(l.shaderKeywordFlags)
          || materials[mat].official.rawByteSize !== materialSerialized?.rawByteSize
          || materials[mat].official.rawSha256 !== materialSerialized?.rawSha256
          || JSON.stringify(materials[mat].official.savedProperties)
            !== JSON.stringify(materialSerialized?.savedProperties)) {
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
      const resolvedTexture = useTexture(nm, typeof t === "object" ? t.assetPath : null);
      textures[slot] = {
        name: resolvedTexture?.resourceKey || nm,
        url: resolvedTexture?.url || null,
        officialName: nm,
        assetPath: typeof t === "object" ? t.assetPath || null : null,
        textureIdentity: typeof t === "object" ? t.textureIdentity || null : null,
        scale: { x: scale.x, y: scale.y },
        offset: { x: offset.x, y: offset.y },
      }; // url=null if missing (renderer/validator can flag)
      const resourceKey = resolvedTexture?.resourceKey || nm;
      if (!texSlots.has(resourceKey)) texSlots.set(resourceKey, new Set());
      texSlots.get(resourceKey).add(slot);
    }
    // Renderer-level stencil region. _Stencil=2 is serialized evidence for the inner/window bit; otherwise
    // the official prefab GameObject name carries the region assignment used by Pokémon window renderers.
    // This is distinct from the static Shader pass: several _StencilRef materials serialize zero and receive
    // their region bit only when the renderer is bound at runtime.
    const stencil = l.floats && l.floats._Stencil;
    const clip = (stencil === 2) ? "window" : (/Window/.test(go) ? "window" : "card");
    const effectiveRenderQueue = resolveQueue(l);
    materials[mat] = { shader, queue: effectiveRenderQueue, sort, official: {
                         material: official.material,
                         shader: official.shader,
                         customRenderQueue: l.renderQueue,
                         effectiveRenderQueue,
                         effectiveRenderQueueSource:
                           l.effectiveRenderQueueSource || "legacy-card-shader-state",
                         shaderRenderQueue: l.shaderRenderQueue || null,
                         enableInstancingVariants: l.enableInstancingVariants,
                         validKeywords: l.keywords,
                         invalidKeywords: l.invalidKeywords,
                         shaderKeywordNames: l.shaderKeywordNames,
                         shaderKeywordFlags: l.shaderKeywordFlags,
                         rawByteSize: materialSerialized?.rawByteSize,
                         rawSha256: materialSerialized?.rawSha256,
                         savedProperties: materialSerialized?.savedProperties,
                       }, clip, stencil: stencil ?? null,
                       go, floats: l.floats || {}, ints: l.ints || {},
                       colors: l.colors || {}, keywords: l.keywords || [], textures };
  }

  const glbAbs = join(ASSETS, "Assets/PrefabHierarchyObject", `${CARD_ID}_L.glb`);
  if (!existsSync(glbAbs)) console.warn(`WARNING: prefab glb not found: ${glbAbs}`);

  // per-texture alpha mode (straight/premult/opaque) — the renderer needs it to pick blend factors; without it
  // straight-alpha textures (the illustration / card_bg_gra) blow out. Memoised by texture name in apks/output.
  const alphaCache = makeAlphaCache(join(OUTPUT, "tex_alpha_modes.json"));
  const alphaMode = {};
  for (const name of Object.keys(texUrls)) alphaMode[name] = alphaCache.modeFor(name, texPaths.get(name));
  alphaCache.flush();
  const textureColorSpace = {};
  for (const name of Object.keys(texUrls)) textureColorSpace[name] = textureColorSpaceFor(texPaths.get(name), texSlots.get(name));

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
  atomicWriteFileSync(join(PUB, outName), JSON.stringify(scene, null, 1));
  console.log(`card ${cardId}: ${Object.keys(scene.materials).length} materials, ${Object.keys(scene.textures).length} textures -> public/${outName}`);
  if (scene._missing.length) console.log(`MISSING textures: ${scene._missing.join(", ")}`);
}
