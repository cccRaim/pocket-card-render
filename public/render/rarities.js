// Rarity → shader table (the data that drives the renderer). Each entry maps a card SHADER NAME to:
//   blend     : "premult" | "over" | "add_a" | "multiply" | "opaque"   (see context.js setBlend)
//   kind      : the material strategy that builds it (see render/materials/*, registry.js)
//   alphaTest : (opaque cutout layers) the alpha threshold
//   bg        : true  → composited UNDER the card in the gold-foil background RT pass
//   defer     : true  → not drawn in the front view (card back/edges, low-LOD backing)
//
// To support a NEW rarity: add its shaders here under a new group, pointing each at an existing kind or a
// new one you register in render/materials/. The dispatcher and the BG pass derive everything from this
// table — no other file changes. (Roles are read from the DATA — which mesh + texture slots — not the
// shader name, so a renamed shader that reuses a family just maps to the same kind.)

// ── Base / Pokémon-shared shaders (RR and below) ──
const BASE = {
  "Card_Parallax": { blend: "premult", kind: "depthParallax" },        // window 2.5D parallax
  "Card_Illust": { blend: "over", kind: "textured" },                  // energy background art
  "Simple-Transparent": { blend: "premult", kind: "textured" },        // soft ShadowBox layer
  "Frame": { blend: "premult", kind: "textured" },                     // plain frame
  "Effect": { blend: "add_a", kind: "effect" },                        // sparkle dust (channel-packed)
  "Simple-Opaque-Hologram_Tuning": { blend: "opaque", alphaTest: 0.5, kind: "sbHolo" },   // ShadowBox body (Pokémon)
  "Opaque_Hologram_Tuning": { blend: "over", kind: "rarity" },         // holographic rarity diamond
  "Simple-Opaque": { blend: "opaque", alphaTest: 0.5, kind: "frameOutline" },              // rare-mark flame ring (black)
  "Frame-Holo-Tuning": { blend: "premult", kind: "frameHolo" },        // RR border rainbow foil
  "Card_Parallax_Metal": { blend: "multiply", kind: "metal" },         // metallic window sheen
  "Card_Parallax_Hologram_Tuning": { blend: "add_a", kind: "holo" },   // window hologram
  "Transparent_Hologram_Tuning": { blend: "over", kind: "exHolo" },    // EX badge / rule-banner foil
  "Side&Back": { defer: true },                                        // card back + edges (not shown front)
  "Simple": { defer: true },                                           // low-LOD flat backing
};

// ── SR (trainer) — reuses the families with two renamed shaders; roles read from the data ──
const SR = {
  "Opaque-Hologram_Tuning": { blend: "opaque", alphaTest: 0.5, kind: "sbHolo" },   // SR ShadowBox body
  "Card_Hologram_Tuning": { blend: "add_a", kind: "frameHolo" },                   // SR 2nd border holo (additive)
};

// ── UR (Ultra Rare) — a new shader family; the gold-foil background stack is composited in the RT pass ──
const UR = {
  "Opaque-UR-Oklab": { blend: "opaque", alphaTest: 0.5, kind: "sbHolo" },          // UR ShadowBox body (Oklab)
  "Frame-Holo-UR-New": { blend: "premult", kind: "frameHolo" },                    // UR border + goods panel
  "Frame-2Layer-UR": { blend: "premult", kind: "frameHolo" },                      // UR rule panel (2-layer)
  "Card_Parallax_UR": { blend: "premult", kind: "parallax", bg: true },            // diagonal gold base
  "Card_Parallax_Hologram_UR_New": { blend: "add_a", kind: "holo", bg: true },     // gold hologram on the base
  "Card_UR_Plate": { blend: "over", kind: "plate", bg: true },                     // Uzumaki spiral plate (top)
  "Card_UR_Glitter_FlowMaps": { blend: "add_a", kind: "glitter", bg: true },       // glitter flow-map sparkle
  "Card_UR_LensFlare": { blend: "add_a", kind: "flare" },                          // additive gold star-ray flare
};

// merge all rarity groups into the lookup the renderer uses
export const SHADER = { ...BASE, ...SR, ...UR };

// shaders whose layers pre-composite to the gold-foil background RT (derived from bg:true — no hardcoding)
export const BG_SHADERS = new Set(
  Object.entries(SHADER).filter(([, c]) => c.bg).map(([name]) => name)
);
