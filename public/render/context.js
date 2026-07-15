// RenderContext + shared render-state helpers.
//
// The RenderContext bundles the runtime dependencies a material strategy needs (resolved textures,
// the env cubemap, the per-frame animation lists) so strategies are pure modules — they never reach
// into app.js's closure. app.js builds ONE ctx after the textures/cubemap load and passes it to every
// strategy's requires()/build().

import * as THREE from "three";
import { SHADER_TEXTURE_DEFAULTS } from "./shader-defaults.js";

// Unity blend-factor enum → three.js factor (card_shader_state.json uses these indices).
export const BF = {
  0: THREE.ZeroFactor, 1: THREE.OneFactor, 2: THREE.DstColorFactor, 3: THREE.SrcColorFactor,
  4: THREE.OneMinusDstColorFactor, 5: THREE.SrcAlphaFactor, 6: THREE.OneMinusSrcColorFactor,
  7: THREE.DstAlphaFactor, 8: THREE.OneMinusDstAlphaFactor, 9: THREE.SrcAlphaSaturateFactor,
  10: THREE.OneMinusSrcAlphaFactor,
};
export const ZF = {
  1: THREE.NeverDepth, 2: THREE.LessDepth, 3: THREE.EqualDepth, 4: THREE.LessEqualDepth,
  5: THREE.GreaterDepth, 6: THREE.NotEqualDepth, 7: THREE.GreaterEqualDepth, 8: THREE.AlwaysDepth,
};
// The card root is mirrored on X to undo Unity LH -> glTF conversion, so the runtime winding is
// flipped relative to Unity's Cull enum. Cull Back therefore maps to THREE.BackSide here.
export const SIDE = { 0: THREE.DoubleSide, 1: THREE.FrontSide, 2: THREE.BackSide };

// Stencil bits: outer card = bit 1, inner window = card|window bits (3). Official shaders use
// read masks 1 or 2, so window pixels must keep the card bit while also carrying the window bit.
export const REGION = { card: 1, window: 3 };

/**
 * Build the RenderContext.
 * @param {Map<string,{tex:THREE.Texture, straight:boolean}>} texInfo  name → loaded texture + alpha mode
 * @param {THREE.CubeTexture|null} envCubeTex   the env cubemap (L_001_ENV) for holo/metal reflections
 * @param {{vert:string,frag:string}|null} exactGlit   the SPIRV-Cross glitter shader (or null → hand port)
 * @param {THREE.Material[]} animMats        materials wanting a per-frame uTime
 * @param {THREE.Material[]} exactGlitMats   exact-glitter materials wanting per-frame Unity _Time
 * @param {THREE.Texture|null} dynUITex       composited DynamicUI canvas for _UseDynamicUI materials
 * @param {THREE.Texture|null} dynHoloTex     DynamicUI encoded like the game's holo RT (alpha = 1 - coverage)
 * @param {THREE.Texture|null} foilTex        alpha mask for UI foil-only regions
 * @param {THREE.Material[]} exHoloMats       EX/UI holo materials whose DynamicUI textures can be swapped
 */
export function makeRenderContext({ texInfo, envCubeTex, exactGlit, exactShaders = {}, animMats, exactGlitMats, dynUITex, dynHoloTex, foilTex, exHoloMats }) {
  const makeDefaultTex = (rgba) => {
    const t = new THREE.DataTexture(new Uint8Array(rgba), 1, 1, THREE.RGBAFormat);
    t.colorSpace = THREE.NoColorSpace;
    t.needsUpdate = true;
    return t;
  };
  const defaultTex = {
    white: makeDefaultTex([255, 255, 255, 255]),
    // ShaderLab's "black" default is the no-op texture for premultiplied card layers.
    black: makeDefaultTex([0, 0, 0, 0]),
    clear: makeDefaultTex([0, 0, 0, 0]),
    bump: makeDefaultTex([128, 128, 255, 255]),
  };
  const grayCubeTex = new THREE.CubeTexture(
    Array.from({ length: 6 }, () => makeDefaultTex([128, 128, 128, 255]))
  );
  grayCubeTex.colorSpace = THREE.NoColorSpace;
  grayCubeTex.needsUpdate = true;
  const layerTex = (L, slot) => {
    const n = L.textures?.[slot]?.name;
    return n && texInfo.has(n) ? texInfo.get(n).tex : null;
  };
  const rawTexCache = new Map();
  const layerTexNoColorSpace = (L, slot) => {
    const n = L.textures?.[slot]?.name;
    if (!n || !texInfo.has(n)) return null;
    const src = texInfo.get(n).tex;
    if (src.colorSpace === THREE.NoColorSpace) return src;
    const key = `${n}:${slot}:raw`;
    if (!rawTexCache.has(key)) {
      const c = src.clone();
      c.colorSpace = THREE.NoColorSpace;
      c.needsUpdate = true;
      rawTexCache.set(key, c);
    }
    return rawTexCache.get(key);
  };
  const layerTexDefault = (L, slot) => {
    const t = layerTex(L, slot);
    if (t) return t;
    const def = SHADER_TEXTURE_DEFAULTS[L.shader]?.[slot];
    return def ? defaultTex[def] : null;
  };
  // a repeat-wrapped clone (for shaders that TILE a shared ClampToEdge base texture)
  const layerTexRepeat = (L, slot) => {
    const t = layerTex(L, slot); if (!t) return null;
    const c = t.clone(); c.wrapS = c.wrapT = THREE.RepeatWrapping; c.needsUpdate = true; return c;
  };
  const layerTexDefaultRepeat = (L, slot) => layerTexRepeat(L, slot) || layerTexDefault(L, slot);
  // Unity's empty Cubemap property default is a built-in gray cube. A material without an explicit
  // _CubeMap must not inherit another material's environment map merely because the scene loaded one.
  const layerCubeDefault = (L, slot = "_CubeMap") => (L.textures?.[slot] && envCubeTex) || grayCubeTex;
  const texStraight = (name) => !!(name && texInfo.has(name) && texInfo.get(name).straight);
  return { THREE, layerTex, layerTexNoColorSpace, layerTexDefault, layerTexRepeat, layerTexDefaultRepeat, layerCubeDefault, texStraight, envCubeTex, exactGlit, exactShaders, animMats, exactGlitMats, dynUITex, dynHoloTex, foilTex, exHoloMats };
}

// ── render state applied to a built material by the dispatcher ──

// Pure painter's order: every card layer is transparent + no depth occlusion, drawn in renderQueue
// (renderOrder) order; "opaque" layers stay crisp via alphaTest. (three.js's opaque-before-transparent
// pass split would otherwise violate the queue order.) Blend factors come from the material data when
// present (the Effect shader carries _SrcFactor/_DstFactor), else from the mode.
export function setBlend(mat, mode, straight, floats) {
  mat.transparent = true; mat.depthTest = false; mat.depthWrite = false;
  if (floats && floats._SrcFactor != null && floats._DstFactor != null) {
    mat.blending = THREE.CustomBlending; mat.blendEquation = THREE.AddEquation;
    // these factors assume the SHADER premultiplied colour by alpha; our textured materials output RAW
    // texels, so a One source factor on a STRAIGHT texture must become SrcAlpha (premultiply) or the
    // fully-transparent RGB adds at full and whites out the card. Premult textures keep One.
    let sf = floats._SrcFactor;
    if (straight && sf === 1) sf = 5;
    mat.blendSrc = BF[sf]; mat.blendDst = BF[floats._DstFactor];
    mat.blendSrcAlpha = BF[floats._SrcFactorA ?? sf]; mat.blendDstAlpha = BF[floats._DstFactorA ?? floats._DstFactor];
    return;
  }
  if (mode === "opaque") {
    // Unity alpha-test shaders are still queued with the transparent card stack here, but after clip/discard
    // they write their source colour opaquely. NormalBlending would let feathered AM alpha mix with the UR
    // foil background and wash out the ShadowBox on tilt.
    mat.blending = THREE.CustomBlending; mat.blendEquation = THREE.AddEquation;
    mat.blendSrc = THREE.OneFactor; mat.blendDst = THREE.ZeroFactor;
    mat.blendSrcAlpha = THREE.ZeroFactor; mat.blendDstAlpha = THREE.ZeroFactor;
    return;
  }
  mat.blending = THREE.CustomBlending; mat.blendEquation = THREE.AddEquation;
  let src, dst;
  if (mode === "multiply") [src, dst] = [2, 0];
  else if (mode === "add_a") [src, dst] = [5, 1];
  else [src, dst] = [straight ? 5 : 1, 10];   // premult/over → SrcAlpha|One / OneMinusSrcAlpha
  mat.blendSrc = BF[src]; mat.blendDst = BF[dst];
  mat.blendSrcAlpha = BF[0];
  mat.blendDstAlpha = BF[mode === "add_a" || mode === "multiply" ? 1 : 10];
}

export function applyDepthState(mat, floats) {
  if (!floats) return false;
  const zTest = floats._ZTest ?? floats._ZTestParam;
  const zWrite = floats._ZWrite ?? floats._ZWriteParam;
  let applied = false;
  if (zTest != null) {
    mat.depthTest = zTest !== 0;
    if (zTest !== 0 && ZF[zTest]) mat.depthFunc = ZF[zTest];
    applied = true;
  }
  if (zWrite != null) {
    mat.depthWrite = zWrite !== 0;
    applied = true;
  }
  return applied;
}

export function applyCullState(mat, floats, fallbackCull = 2, materialCull = false) {
  const cull = materialCull ? (floats?._CullMode ?? fallbackCull) : fallbackCull;
  if (cull == null || !Object.prototype.hasOwnProperty.call(SIDE, cull)) return false;
  mat.side = SIDE[cull];
  return true;
}

const SB_STENCIL_SHADERS = new Set([
  "Simple-Opaque-Hologram_Tuning",
  "Simple-Transparent",
  "Opaque-Hologram_Tuning",
  "Opaque-UR-Oklab",
]);
const STENCIL_REF_SHADERS = new Set([
  "Card_Hologram_Tuning",
  "Card_Illust",
  "Card_Parallax",
  "Card_Parallax_Hologram_Tuning",
  "Card_Parallax_Hologram_UR_New",
  "Card_Parallax_Metal",
  "Card_Parallax_UR",
  "Card_UR_Plate",
]);

export function applyStencilState(mat, recipe) {
  const f = recipe?.floats || {};
  const shader = recipe?.shader || "";
  const read = SB_STENCIL_SHADERS.has(shader) || shader === "Effect"
    ? f._Stencil
    : STENCIL_REF_SHADERS.has(shader)
      ? f._StencilRef
      : null;
  if (read == null) return false;

  mat.stencilWrite = true;
  mat.stencilFunc = THREE.EqualStencilFunc;
  mat.stencilFuncMask = read;
  mat.stencilFail = mat.stencilZFail = THREE.KeepStencilOp;

  if (SB_STENCIL_SHADERS.has(shader)) {
    mat.stencilRef = 7;
    mat.stencilMask = 4;
    mat.stencilZPass = THREE.ReplaceStencilOp;
  } else {
    mat.stencilRef = read;
    mat.stencilMask = 0xff;
    mat.stencilZPass = THREE.KeepStencilOp;
  }
  return true;
}

// stencil writer (stamps a region id) + clip (tests a region) — the card-shape / window clipping.
export function stencilWriter(regionId) {
  const m = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, depthTest: false, side: THREE.DoubleSide });
  m.stencilWrite = true; m.stencilRef = regionId; m.stencilFunc = THREE.AlwaysStencilFunc;
  m.stencilZPass = m.stencilFail = m.stencilZFail = THREE.ReplaceStencilOp; m.stencilMask = 0xff;
  return m;
}
export function applyClip(mat, clip) {
  if (!clip) return;
  mat.stencilWrite = true;
  mat.stencilFail = mat.stencilZFail = mat.stencilZPass = THREE.KeepStencilOp;
  mat.stencilFuncMask = 0xff;
  if (clip === "window") { mat.stencilFunc = THREE.EqualStencilFunc; mat.stencilRef = REGION.window; }
  else { mat.stencilFunc = THREE.NotEqualStencilFunc; mat.stencilRef = 0; }   // card region
}
