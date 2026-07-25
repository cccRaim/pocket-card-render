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
  "Card_Parallax": { blend: "premult", kind: "depthParallax", materialBlend: true }, // window 2.5D parallax
  "Card_Illust": { blend: "over", kind: "illustTextured" },            // energy/background art (SrcAlpha blend)
  "Card_Scaling_Kira": { blend: "over", kind: "scalingKira" },        // S rarity renderer-driven scaling stars
  "Card_Circular_Moving_Kira": { blend: "over", kind: "circularMovingKira" },
  "Card_Circular_Trail_Kira": { blend: "over", kind: "circularTrailKira" },
  "Card_Prism": { blend: "over", kind: "prism" },                     // S rarity expanding prism shards
  "Card_Parallax_MatCap_Lighting": { blend: "over", kind: "matCapLighting" }, // S rarity mirror-ball light
  "Simple-Transparent": { blend: "premult", kind: "simpleTransparent", materialBlend: true }, // soft ShadowBox layer
  "Simple-PreMultiply-Hologram": { blend: "premult", kind: "simplePremultiplyHologram" },
  "Frame": { blend: "premult", kind: "textured" },                     // plain frame
  "Effect": { blend: "add_a", kind: "effect", materialBlend: true, cull: 0, materialCull: true },   // sparkle dust (channel-packed)
  "Simple-Opaque-Hologram_Tuning": { blend: "opaque", alphaTest: 0.5, kind: "sbHolo" },   // ShadowBox body (Pokémon)
  "Opaque_Hologram_Tuning": { blend: "opaque", kind: "rarity" },       // holographic rarity mark (discard cutout)
  "Simple-Opaque": { blend: "opaque", kind: "frameOutline" },                              // rare-mark flame ring (opaque texture)
  "Frame-Holo-Tuning": { blend: "over", kind: "frameHolo" },           // RR/SR border rainbow foil (SrcAlpha blend)
  "Card_Parallax_Metal": { blend: "multiply", kind: "metal" },         // metallic window sheen
  "Card_Parallax_Hologram_Tuning": { blend: "add_a", kind: "holo" },   // window hologram
  "Transparent_Hologram_Tuning": { blend: "over", kind: "exHolo" },    // EX badge / rule-banner foil
  "Side&Back": { blend: "opaque", kind: "sideBack", materialCull: true }, // physical back + side wall
  "Simple": { defer: true },                                           // low-LOD flat backing
};

// ── SR (trainer) — reuses the families with two renamed shaders; roles read from the data ──
const SR = {
  "Opaque-Hologram_Tuning": { blend: "opaque", alphaTest: 0.5, kind: "sbHolo" },   // SR ShadowBox body
  "Card_Hologram_Tuning": { blend: "premult", kind: "frameHolo" },                 // SR 2nd border holo (One/OneMinusSrcAlpha)
};

// ── UR (Ultra Rare) ──
const UR = {
  "Opaque-UR-Oklab": { blend: "opaque", alphaTest: 0.5, kind: "sbHolo" },          // UR ShadowBox body (Oklab)
  "Frame-Holo-UR-New": { blend: "over", kind: "frameHoloUR" },                     // UR border + goods panel
  "Frame-2Layer-UR": { blend: "premult", kind: "frame2LayerUR" },                  // UR rule panel (2-layer)
  "Transparent-UR-New": { blend: "over", kind: "exHoloUR" },                        // UR EX/rule UI foil
  "Card_Parallax_UR": { blend: "over", kind: "parallaxUR" },             // diagonal gold base
  "Card_Parallax_Hologram_UR_New": { blend: "add_a", kind: "urBgHolo" }, // gold hologram on the base
  "Card_UR_Plate": { blend: "over", kind: "plate" },                     // Uzumaki spiral plate (top)
  "Card_UR_Glitter_FlowMaps": { blend: "add_a", kind: "glitter" },       // glitter flow-map sparkle
  "Card_UR_LensFlare": { blend: "add_a", kind: "flare" },                          // additive gold star-ray flare
};

// merge all rarity groups into the lookup the renderer uses
export const SHADER = { ...BASE, ...SR, ...UR };
