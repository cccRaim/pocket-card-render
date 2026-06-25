# pocket-card-render

> **English** · [简体中文](README.zh-CN.md)

A data-driven, **byte-faithful** in-browser renderer for **Pokémon TCG Pocket** card faces, built on
[three.js](https://threejs.org/). Every layer — parallax foil, holo diffraction, metal specular,
glitter, the stencil window, the rare-mark, the holographic frame — is reconstructed from the game's
own material data and decompiled shader bytecode. **No eyeballed magic numbers.**

> **Educational / research project.** It ships **no game assets**. The meshes, textures, fonts, card
> text, names and imagery are the property of The Pokémon Company / Nintendo / Creatures / GAME FREAK /
> DeNA. You supply your own extracted data — see [ASSETS.md](ASSETS.md).

<!-- A screenshot or GIF of the three sample cards goes well here. -->

## Features

- **Faithful, not approximate.** Per-material shader constants come from the card's recipe or a
  byte-trace of the real shader — never hand-tuned.
- **Material-name keyed.** Each glb mesh is matched to its recipe by `material.name`, then dispatched to
  a material **strategy** by a single table lookup — no fragile node-name guessing, no per-shader `if`s.
- **View-dependent effects** — holographic diffraction, metallic env reflection, glitter twinkle, the
  parallax window — driven by the real camera-relative math, clamped to the game's 30° tilt.
- **Dynamic card text** (name / HP / attacks / rule / illustrator) composited from the masterdata, with
  free OFL font substitutes and a language switcher (9 locales).
- **Extensible by design** (Strategy + Registry). Adding a new rarity is ~3 small additions and **zero**
  edits to the renderer core — see [CONTRIBUTING.md](CONTRIBUTING.md).
- **Zero runtime dependencies.** three.js loads from a CDN via an import map; the server is plain Node.

## Quick start

```bash
git clone https://github.com/cccRaim/pocket-card-render
cd pocket-card-render
npm install                          # dev-only deps (playwright/pngjs for headless shots); the renderer itself has none
npm run gather -- <export-root>      # copy the sample cards' meshes + textures from YOUR game export into public/game
npm run serve                        # → http://127.0.0.1:8011
```

`<export-root>` is an **AssetRipper** export of the game (the folder containing `Assets/`). `gather`
reads the prebuilt `public/scene.*.json` and copies **only** the `/game/...` files they reference, so
you stage just what the samples need. (Game art is git-ignored and never committed — see
[ASSETS.md](ASSETS.md).)

> 📖 **Full end-to-end guide** — dependency versions, the exact AssetRipper export config, the expected
> directory layout, and how to generate data for a brand-new card: **[SETUP.md](SETUP.md)**.

## Sample cards

Three scenes ship prebuilt (the render recipe + text only — art is gathered locally):

| URL | Card | Rarity |
|-----|------|--------|
| `/` or `?scene=scene.pk.json` | Venusaur ex | RR |
| `?scene=scene.sr.json` | Leaf | SR |
| `?scene=scene.ur.json` | Eevee's Bag | UR |

Useful query params: `?scene=<file>` picks a card · `?only=<materialName>` solos one layer ·
`?nohud` hides the debug overlay · the language dropdown (top-right) switches locale.

## How it works

```
  ┌──────────────── public/scene.*.json   render recipe: per-material { shader, queue, blend, floats, colors, textures }
  │  ┌───────────── public/game/…          meshes (.glb) + textures (.png)  — gathered locally, never committed
  │  │  ┌────────── public/text|locales/…  composited card text (name/HP/attacks) per locale
  ▼  ▼  ▼
public/app.js ──► for each glb mesh:  recipe = scene.materials[mesh.material.name]
 (three.js)        cfg  = SHADER[recipe.shader]            // render/rarities.js (data)
                   strat = getMaterial(cfg.kind)           // render/registry.js
                   mesh.material = strat.build(recipe, ctx)// render/materials/*.js (strategies)
```

### Project layout

```
public/
├── app.js                 the renderer: load scene + glb, dispatch each mesh, two-pass RT, tilt, text overlay
├── index.html             import map (three.js CDN) + Google-Fonts substitutes
├── render/                the material system (see CONTRIBUTING.md)
│   ├── registry.js        Strategy registry — defineMaterial(kind, {requires, build}) / getMaterial(kind)
│   ├── context.js         RenderContext (textures/env/anim) + blend & stencil helpers
│   ├── glsl.js            shared GLSL chunks (the view-basis vertex shaders)
│   ├── rarities.js        DATA: shader → { blend, kind, alphaTest, bg, defer }, grouped by rarity
│   └── materials/         per-family strategies: base.js · holo.js · ur.js
├── shaders/               the exact glitter vertex+fragment GLSL (SPIRV-Cross from the game shader)
├── scene.*.json           prebuilt sample scenes
└── game/                  (git-ignored) your gathered meshes + textures

build/                     offline tools (need your own game data): build.mjs (recipe→scene),
                           gather.mjs (collect art), compose.mjs/carddata.mjs (text), shot.mjs (screenshots)
server.mjs                 zero-dependency static server for public/ and public/game/
```

`app.js` does the orchestration (scene/glb load, the gold-foil background render-target pass, the
mouse-tilt, the DynamicUI text canvas); all per-material shading lives in `render/`.

## Rendering other cards / adding a rarity

- **A card that isn't one of the samples** — build its scene from your own data, then `gather` its art.
  See [ASSETS.md](ASSETS.md) (the scene/asset contract + the recipe step).
- **A new rarity's render logic** — add a strategy module + a rarity entry; the renderer core is
  untouched. Step-by-step in [CONTRIBUTING.md](CONTRIBUTING.md).
- **Decompiling a new shader** (to get the GLSL a new effect needs) — extract → SPIRV-Cross → port,
  with the tools shipped under `build/shaderdec/`. Full workflow in [SHADERS.md](SHADERS.md).

## License

Source code: **MIT** (see [LICENSE](LICENSE)). Game-derived assets (meshes, textures, fonts, card text)
are **not** covered by this license and are **not** distributed here — bring your own.
