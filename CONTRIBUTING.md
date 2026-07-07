# Contributing — the render architecture & how to add a rarity

> **English** · [简体中文](CONTRIBUTING.zh-CN.md)

The renderer is **data-driven** and **byte-faithful**: every layer's look is reconstructed from the
game's own material data + shader bytecode. No eyeballed magic numbers. Two rules:

1. **Verify against data, not vibes.** A new material's constants come from the scene JSON recipe
   or a byte-trace of the shader — never hand-tuned. Cite the source in a comment.
2. **No regressions.** After any render change, diff the three sample cards (see *Verifying* below).

## Architecture (`public/render/`)

```
render/
├── registry.js        Strategy registry — defineMaterial(kind, {requires, build}) / getMaterial(kind)
├── context.js         RenderContext (resolved textures, env cubemap, anim lists) + blend/stencil helpers
├── glsl.js            shared GLSL chunks (the view-basis vertex shaders, etc.)
├── rarities.js        the SHADER table: shader name → { blend, kind, alphaTest, bg, defer }, grouped by rarity
└── materials/
    ├── index.js       imports every material module (registers all strategies)
    ├── base.js        textured / depthParallax / effect / frameOutline   (shared by all rarities)
    ├── holo.js        holo / frameHolo / exHolo / rarity / sbHolo          (the iridescence family)
    └── ur.js          plate / parallax / flare / metal / glitter           (the UR foil family)
```

The renderer (`app.js`) does **no per-shader branching**. For each glb mesh it looks up the recipe,
finds `cfg = SHADER[shader]`, and dispatches by table:

```js
const strat = getMaterial(cfg.kind);
if (!strat || !strat.requires(r, ctx)) return;   // gate: missing textures, etc.
const mat = strat.build(r, ctx);                  // returns the three.js material
```

A **strategy** is pure — it takes `(r, ctx)` and returns a `THREE.Material`:

- `r`   — the material recipe (`scene_data.materials[name]`): `shader`, `queue`, `floats`, `colors`,
  `textures`, `keywords`, `clip`.
- `ctx` — the [RenderContext](public/render/context.js): `layerTex(r, slot)`, `layerTexRepeat`,
  `texStraight(name)`, `envCubeTex`, `exactGlit`, `animMats`, `exactGlitMats`, `dynUITex`, `foilTex`,
  `exHoloMats`.
- Set `mat.userData.straight = true` if the layer's main texture is straight-alpha (the dispatcher
  reads it to pick blend factors). Add a material to `ctx.animMats` for a per-frame `uTime`.

## Adding a new rarity

Say a new rarity **SAR** introduces one novel shader `Card_SAR_Prism` plus some it shares with UR.

1. **Implement any new material(s)** in their own module — `public/render/materials/sar.js`:

   ```js
   import * as THREE from "three";
   import { defineMaterial } from "../registry.js";
   import { VIEW_BASIS_VS } from "../glsl.js";

   defineMaterial("prism", {
     requires: (r, ctx) => !!ctx.layerTex(r, "_MainTex"),
     build(r, ctx) {
       const f = r.floats;
       return new THREE.ShaderMaterial({
         uniforms: { mainTex: { value: ctx.layerTex(r, "_MainTex") }, uPower: { value: f._PrismPower ?? 1 } },
         vertexShader: VIEW_BASIS_VS,
         fragmentShader: `/* byte-traced from prism_frag.spv ... */`,
         side: THREE.DoubleSide, toneMapped: false,
       });
     },
   });
   ```

   Reuse an existing `kind` instead if the shader is just a renamed family member (roles are read from
   the data — which mesh + texture slots — not the shader name).

   > **Where the fragment GLSL comes from** — byte-traced from the real shader. Extract its SPIR-V with
   > `build/shaderdec/dump_shader.py` (UnityPy), transpile with SPIRV-Cross, recover the stripped uniform
   > names, then port. Full step-by-step: **[SHADERS.md](SHADERS.md)**. The shaders already in this repo
   > were produced that way.

2. **Register the module** — add one line to [`materials/index.js`](public/render/materials/index.js):

   ```js
   import "./sar.js";
   ```

3. **Map the shaders** in [`rarities.js`](public/render/rarities.js) under a new `SAR` group:

   ```js
   const SAR = {
     "Card_SAR_Prism":     { blend: "add_a", kind: "prism" },
     "Card_Parallax_UR":   { blend: "premult", kind: "parallax", bg: true },  // shared with UR
   };
   export const SHADER = { ...BASE, ...SR, ...UR, ...SAR };
   ```

   Set `bg: true` on any layer that composites into the gold-foil background RT pass — the pass picks
   it up automatically (no hardcoded list). `defer: true` hides a layer (card back/edges).

**That's it.** No edit to `app.js`, the dispatcher, or the background pass. (Open/Closed.)

## Verifying (no regressions)

The three sample cards exercise the RR / SR / UR paths. Render each before and after your change and
pixel-diff:

```bash
npm run gather -- <your-export-root>          # ensure public/game is populated
node server.mjs 8011 &
node build/shot.mjs "http://127.0.0.1:8011/?scene=scene.cPK_10_000040_00_FUSHIGIBANAex_RR.json&nohud" before.png
# … make your change …
node build/shot.mjs "http://127.0.0.1:8011/?scene=scene.cPK_10_000040_00_FUSHIGIBANAex_RR.json&nohud" after.png
```

A faithful change leaves the cards you didn't touch **pixel-identical** (the SR card has no animated
layers → expect 0% diff; UR glitter + CJK text antialiasing produce a sub-percent diff that is timing,
not logic). Use `?only=<materialName>` to isolate a single layer and `?nohud` for clean shots.
