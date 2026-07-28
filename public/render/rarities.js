// Rarity → shader table (the data that drives the renderer). Each entry maps a card SHADER NAME to:
//   blend     : "premult" | "over" | "add_a" | "multiply" | "opaque"   (see context.js setBlend)
//   kind      : the material strategy that builds it (see render/materials/*, registry.js)
//   materialBlend : true → blend factors come from material floats (_SrcFactor/_DstFactor)
//   alphaTest : (opaque cutout layers) the alpha threshold
//   defer     : true  → intentionally unsupported draw (for example a low-LOD fallback)
//
// To support a NEW rarity: add its shaders here under a new group, pointing each at an existing kind or a
// new one you register in render/materials/. The dispatcher derives everything from this
// table — no other file changes. (Roles are read from the DATA — which mesh + texture slots — not the
// shader name, so a renamed shader that reuses a family just maps to the same kind.)

// ── Base / Pokémon-shared shaders (RR and below) ──
const BASE = {
  "OuterStencil": { blend: "opaque", kind: "outerStencil" },
  "InnerStencil": { blend: "opaque", kind: "innerStencil" },
  "IllustStencil": { blend: "opaque", kind: "illustStencil" },
  "Text": { blend: "premult", kind: "dynamicText" },
  "Text_Alpha": { blend: "premult", kind: "dynamicTextAlpha" },
  "Card_Parallax": { blend: "premult", kind: "depthParallax", materialBlend: true,
    capabilities: { stencil: "read-stencil-ref", diagnostic: "card-parallax" } }, // window 2.5D parallax
  "Card_Parallax_EmitMask": { blend: "premult", kind: "emitMaskParallax", materialBlend: true,
    capabilities: { stencil: "read-stencil-ref" } },
  "Effect_Emit": { blend: "premult", kind: "megaEffectEmit",
    capabilities: { stencil: "read-stencil" } },
  "Flash": { blend: "premult", kind: "megaShadowFlash", materialBlend: true,
    capabilities: { stencil: "shadowbox", fixedShadowboxDepth: true } },
  "Card_Parallax_MRR": { blend: "premult", kind: "megaParallaxMrr", materialBlend: true,
    capabilities: { stencil: "read-stencil-ref" } },
  "Card_Parallax_Flash": { blend: "premult", kind: "megaParallaxFlash",
    capabilities: { stencil: "read-stencil-ref" } },
  "Card_ShadowBox_Effect_Flow": { blend: "premult", kind: "megaShadowboxEffectFlow",
    capabilities: { stencil: "read-stencil" } },
  "Card_Aura": { blend: "premult", kind: "megaAura",
    capabilities: { stencil: "read-stencil" } },
  "Card_Parallax_Transparent_Translate": { blend: "premult", kind: "megaParallaxTranslate",
    capabilities: { stencil: "read-stencil-ref" } },
  "Card_Parallax_Marble": { blend: "premult", kind: "exactRuntime", materialBlend: true,
    capabilities: { stencil: "read-stencil-ref" } },
  "Card_Parallax_Future": { blend: "premult", kind: "exactRuntime", materialBlend: true,
    capabilities: { stencil: "read-stencil-ref" } },
  "Card_Parallax_Strata": { blend: "premult", kind: "exactRuntime", materialBlend: true,
    capabilities: { stencil: "read-stencil-ref" } },
  "Card_Illust": { blend: "over", kind: "illustTextured",
    capabilities: { stencil: "read-stencil-ref" } },            // energy/background art (SrcAlpha blend)
  "Card_Scaling_Kira": { blend: "over", kind: "scalingKira" },        // S rarity renderer-driven scaling stars
  "Card_Circular_Moving_Kira": { blend: "over", kind: "circularMovingKira" },
  "Card_Circular_Trail_Kira": { blend: "over", kind: "circularTrailKira" },
  "Card_Prism": { blend: "over", kind: "prism" },                     // S rarity expanding prism shards
  "Card_Parallax_MatCap_Lighting": { blend: "over", kind: "matCapLighting" }, // S rarity mirror-ball light
  "Simple-Transparent": { blend: "premult", kind: "simpleTransparent", materialBlend: true,
    capabilities: { stencil: "shadowbox", fixedShadowboxDepth: true } }, // soft ShadowBox layer
  "Simple-PreMultiply-Hologram": { blend: "premult", kind: "simplePremultiplyHologram",
    capabilities: { stencil: "shadowbox", fixedShadowboxDepth: true } },
  "Transparent-Hologram": { blend: "premult", kind: "shadowboxTransparentHologram",
    capabilities: { stencil: "shadowbox", fixedShadowboxDepth: true } },
  "Frame": { blend: "premult", kind: "textured" },                     // plain frame
  "Opaque": { blend: "opaque", kind: "exactRuntime" },                 // shared cPK_90 event logo
  "Effect": { blend: "add_a", kind: "effect", materialBlend: true, cull: 0, materialCull: true,
    capabilities: { stencil: "read-stencil" } },   // sparkle dust (channel-packed)
  "Simple-Opaque-Hologram_Tuning": { blend: "opaque", alphaTest: 0.5, kind: "sbHoloSimple",
    capabilities: { stencil: "shadowbox", fixedShadowboxDepth: true } },   // ShadowBox body (Pokémon)
  "Opaque_Hologram_Tuning": { blend: "opaque", kind: "rarity" },       // holographic rarity mark (discard cutout)
  "Simple-Opaque": { blend: "opaque", kind: "frameOutline" },                              // rare-mark flame ring (opaque texture)
  "Frame-Holo-Tuning": { blend: "over", kind: "frameHoloClassic" },           // RR/SR border rainbow foil (SrcAlpha blend)
  "Frame-Holo": { blend: "over", kind: "exactRuntime" },
  "Frame-Holo-2Layer": { blend: "over", kind: "exactRuntime" },
  "Card_Parallax_Metal": { blend: "multiply", kind: "metal",
    capabilities: { stencil: "read-stencil-ref" } },         // metallic window sheen
  "Card_Parallax_Hologram_Tuning": { blend: "add_a", kind: "holo",
    capabilities: { stencil: "read-stencil-ref" } },   // window hologram
  "Card_Parallax_Hologram_Shadow": { blend: "premult", kind: "shadowParallaxHologram",
    capabilities: { stencil: "read-stencil-ref" } },
  "Transparent_Hologram_Tuning": { blend: "over", kind: "exHolo" },    // EX badge / rule-banner foil
  "Side&Back": { blend: "opaque", kind: "sideBack", materialCull: true }, // physical back + side wall
  "Simple": { defer: true },                                           // low-LOD flat backing
};

// ── SR (trainer) — reuses the families with two renamed shaders; roles read from the data ──
const SR = {
  "Opaque-Hologram_Tuning": { blend: "opaque", alphaTest: 0.5, kind: "sbHoloTrainer",
    capabilities: { stencil: "shadowbox", fixedShadowboxDepth: true } },   // SR ShadowBox body
  "Opaque-Hologram_Shadow": { blend: "opaque", kind: "shadowOpaqueHologram",
    capabilities: { stencil: "shadowbox", fixedShadowboxDepth: true } },
  "Hologram-FlipOutline": { blend: "premult", kind: "megaFlipOutline", materialBlend: true,
    capabilities: { stencil: "shadowbox", fixedShadowboxDepth: true } },
  "Card_Hologram_Tuning": { blend: "premult", kind: "cardHologram",
    capabilities: { stencil: "read-stencil-ref" } },                 // SR 2nd border holo
};

// ── UR (Ultra Rare) ──
const UR = {
  "Opaque-UR-Oklab": { blend: "opaque", alphaTest: 0.5, kind: "sbHoloUr",
    capabilities: { stencil: "shadowbox", fixedShadowboxDepth: true, fakeSpecEnabledDefault: 0 } },
  "Transparent-UR-Oklab": { blend: "premult", kind: "sbHoloUr",
    capabilities: { stencil: "shadowbox", fixedShadowboxDepth: true, fakeSpecEnabledDefault: 0 } },
  "Frame-Holo-UR-New": { blend: "over", kind: "frameHoloUR",
    capabilities: { fakeSpecEnabledDefault: 0 } },                     // UR border + goods panel
  "Frame-2Layer-UR": { blend: "premult", kind: "frame2LayerUR",
    capabilities: { fakeSpecIntensityDefault: 1 } },                  // UR rule panel
  "Transparent-UR-New": { blend: "over", kind: "exHoloUR",
    capabilities: { fakeSpecIntensityDefault: 1 } },                  // UR EX/rule UI foil
  "Card_Parallax_UR": { blend: "over", kind: "parallaxUR",
    capabilities: { stencil: "read-stencil-ref" } },                  // diagonal gold base
  "Card_Parallax_Hologram_UR_New": { blend: "add_a", kind: "urBgHolo",
    capabilities: { stencil: "read-stencil-ref", fakeSpecEnabledDefault: 0 } },
  "Card_UR_Plate": { blend: "over", kind: "plate",
    capabilities: { stencil: "read-stencil-ref", fakeSpecIntensityDefault: 1 } },
  "Card_UR_Glitter_FlowMaps": { blend: "add_a", kind: "glitter" },       // glitter flow-map sparkle
  "Card_UR_LensFlare": { blend: "add_a", kind: "flare",
    capabilities: { builtinGeometry: "unity-quad" } },             // additive gold star-ray flare
};

// ── SAR (Special Art Rare) ──
const SAR = {
  "Card_Illust_DoubleTexture": { blend: "premult", kind: "sarDoubleTexture" },
  "Transparent_HologramLayer": { blend: "premult", kind: "sarHologramLayer" },
  "Card_ShadowBoxUI_Transparent_Rainbow": { blend: "over", kind: "sarMegaRainbow" },
};

// ── IM (Immersive) ──
const IM = {
  "Frame-Holo-ImmersiveUI": { blend: "over", kind: "immersiveFrame" },
  "Frame-Holo-Immersive": { blend: "over", kind: "immersiveFrame", materialBlend: true },
  "Card_Parallax_Immersive": {
    blend: "over",
    kind: "immersiveParallax",
    capabilities: { stencil: "read-stencil-ref" },
  },
  "Card_Parallax_MetalByTilt": {
    blend: "multiply",
    kind: "metalByTilt",
    capabilities: { stencil: "read-stencil-ref" },
  },
};

// merge all rarity groups into the lookup the renderer uses
export const SHADER = { ...BASE, ...SR, ...UR, ...SAR, ...IM };
