# pocket-card-render

> **English** · [简体中文](README.zh-CN.md)

An official-data-driven research renderer for **Pokémon TCG Pocket** card faces, built on
[three.js](https://threejs.org/). It reconstructs card layers from extracted material data and
decompiled shader bytecode. Shader-source coverage, renderer-pipeline parity, and final visual parity
are tracked separately; see [Rendering Fidelity](FIDELITY.md). **No eyeballed magic numbers.**

> **Educational / research project.** It ships **no game assets**. The meshes, textures, fonts, card
> text, names and imagery are the property of The Pokémon Company / Nintendo / Creatures / GAME FREAK /
> DeNA. You supply your own extracted data — see [ASSETS.md](ASSETS.md).

<!-- A screenshot or GIF of the three sample cards goes well here. -->

## Features

- **Traceable inputs.** Per-material constants come from the card's recipe or an official-shader
  byte trace, and the evidence level is reported without turning coverage into a visual-fidelity score.
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
>
> Updating the game or Unity baseline: **[UPGRADING.md](UPGRADING.md)**.

## Sample cards

The globally minimum 112-card coverage set ships as prebuilt scenes, plus three
non-minimum regression scenes. Scenes contain render data and text only; art is
still gathered locally. Five frequently used regression anchors are:

| URL | Card | Rarity |
|-----|------|--------|
| `/` or `?scene=scene.cPK_10_000040_00_FUSHIGIBANAex_RR.json` | Venusaur ex | RR |
| `?scene=scene.cPK_20_000010_01_FUSHIGIDANE_S.json` | Bulbasaur | S |
| `?scene=scene.cPK_20_008900_02_HOUOUex_UR.json` | Ho-Oh ex | UR |
| `?scene=scene.cTR_20_000230_00_LEAF_SR.json` | Leaf | SR |
| `?scene=scene.cTR_20_000670_00_IIBUINOBAKKU_UR.json` | Eevee's Bag | UR |

The card dropdown is backed by `public/card-examples.json`: an official-data-derived, globally
minimum set of 112 witnesses covering 444 known design, shader/state, and card-face semantic
features. All 112 exact scenes are bundled; after `gather`, they are directly selectable alongside
the three supplemental regression scenes. Missing assets disable an entry rather than activating a
generic fallback recipe.

To regenerate the built-in set against your own official inputs, inspect and then materialize it:

```bash
npm run materialize:official-card-examples -- --dry-run
npm run materialize:official-card-examples -- --gather
```

Missing recipes are regenerated from each card's own `Face/<illId>/L` plus the shared
`Common/Shader` bytes. Copyrighted art stays under ignored `public/game/`.

Useful query params: `?scene=<file>` picks a card · `?only=<materialName>` solos one layer ·
`?quality=auto|middle|high|low` selects the card RT quality (`auto`, the default, derives a native-sized source
RT from the physical drawing buffer and rebuilds the source/Dynamic UI targets after a viewport resize, so the
desktop display pass never enlarges the mobile RT; `middle`
reproduces the captured BlueStacks `1122×1122` source RT and remains the runtime-evidence profile) · `?nohud`
hides the debug overlay · the top-right dropdowns switch locale and render quality.

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
