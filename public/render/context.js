// RenderContext + shared render-state helpers.
//
// The RenderContext bundles the runtime dependencies a material strategy needs (resolved textures,
// the env cubemap, the per-frame animation lists) so strategies are pure modules — they never reach
// into app.js's closure. app.js builds ONE ctx after the textures/cubemap load and passes it to every
// strategy's requires()/build().

import * as THREE from "three";

// Unity blend-factor enum → three.js factor (card_shader_state.json uses these indices).
export const BF = {
  0: THREE.ZeroFactor, 1: THREE.OneFactor, 2: THREE.DstColorFactor, 3: THREE.SrcColorFactor,
  4: THREE.OneMinusDstColorFactor, 5: THREE.SrcAlphaFactor, 6: THREE.OneMinusSrcColorFactor,
  7: THREE.DstAlphaFactor, 8: THREE.OneMinusDstAlphaFactor, 9: THREE.SrcAlphaSaturateFactor,
  10: THREE.OneMinusSrcAlphaFactor,
};

// stencil regions (card_shader_state.json): Outer stamps 1 (card), Inner stamps 2 (window).
export const REGION = { card: 1, window: 2 };

/**
 * Build the RenderContext.
 * @param {Map<string,{tex:THREE.Texture, straight:boolean}>} texInfo  name → loaded texture + alpha mode
 * @param {THREE.CubeTexture|null} envCubeTex   the env cubemap (L_001_ENV) for holo/metal reflections
 * @param {{vert:string,frag:string}|null} exactGlit   the SPIRV-Cross glitter shader (or null → hand port)
 * @param {THREE.Material[]} animMats        materials wanting a per-frame uTime
 * @param {THREE.Material[]} exactGlitMats   exact-glitter materials wanting per-frame Unity _Time
 * @param {THREE.Texture|null} dynUITex       composited DynamicUI canvas for _UseDynamicUI materials
 * @param {THREE.Texture|null} foilTex        alpha mask for UI foil-only regions
 * @param {THREE.Material[]} exHoloMats       EX/UI holo materials whose DynamicUI textures can be swapped
 */
export function makeRenderContext({ texInfo, envCubeTex, exactGlit, animMats, exactGlitMats, dynUITex, foilTex, exHoloMats }) {
  const layerTex = (L, slot) => {
    const n = L.textures?.[slot]?.name;
    return n && texInfo.has(n) ? texInfo.get(n).tex : null;
  };
  // a repeat-wrapped clone (for shaders that TILE a shared ClampToEdge base texture)
  const layerTexRepeat = (L, slot) => {
    const t = layerTex(L, slot); if (!t) return null;
    const c = t.clone(); c.wrapS = c.wrapT = THREE.RepeatWrapping; c.needsUpdate = true; return c;
  };
  const texStraight = (name) => !!(name && texInfo.has(name) && texInfo.get(name).straight);
  return { THREE, layerTex, layerTexRepeat, texStraight, envCubeTex, exactGlit, animMats, exactGlitMats, dynUITex, foilTex, exHoloMats };
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
  if (mode === "opaque") { mat.blending = THREE.NormalBlending; return; }   // cutout via alphaTest
  mat.blending = THREE.CustomBlending; mat.blendEquation = THREE.AddEquation;
  let src, dst;
  if (mode === "multiply") [src, dst] = [2, 0];
  else if (mode === "add_a") [src, dst] = [5, 1];
  else [src, dst] = [straight ? 5 : 1, 10];   // premult/over → SrcAlpha|One / OneMinusSrcAlpha
  mat.blendSrc = BF[src]; mat.blendDst = BF[dst];
  mat.blendSrcAlpha = BF[1]; mat.blendDstAlpha = BF[10];
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
