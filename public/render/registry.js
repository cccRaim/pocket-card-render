// Material strategy registry (Strategy + Registry pattern).
//
// Each card shader maps to a `kind`; each kind is implemented by ONE material strategy registered here.
// The renderer dispatches purely by table lookup — adding a new kind (e.g. for a new rarity) means
// registering a strategy in its own module, with NO edit to the dispatcher. (Open/Closed.)
//
// A strategy:
//   defineMaterial("plate", {
//     requires: (r, ctx) => !!ctx.layerTex(r, "_MainTex"),   // optional gate — false → layer skipped
//     build:    (r, ctx) => new THREE.ShaderMaterial({ ... }), // returns the three.js material
//   })
//
// `r`   = the material recipe from scene.json.materials[name] (shader/queue/floats/colors/textures).
// `ctx` = the RenderContext (see context.js): layerTex/texStraight/envCubeTex/animMats/… runtime deps.

const REGISTRY = new Map();

/** Register a material strategy for a `kind`. */
export function defineMaterial(kind, spec) {
  if (REGISTRY.has(kind)) console.warn(`material kind "${kind}" registered twice — overwriting`);
  REGISTRY.set(kind, { requires: () => true, ...spec });
}

/** Look up a strategy by kind (undefined if none). */
export function getMaterial(kind) {
  return REGISTRY.get(kind);
}

/** All registered kinds (for diagnostics / docs). */
export function listKinds() {
  return [...REGISTRY.keys()];
}
