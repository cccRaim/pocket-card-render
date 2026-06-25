# Setup & data pipeline

> **English** · [简体中文](SETUP.zh-CN.md)

This guide covers everything end-to-end: install dependencies → export assets (exact config) → the
expected directory layout → generate the render data → run.

Two paths:

- **Path A — run the sample cards** (just an asset export of your game + Node). Start here.
- **Path B — render a new card** (the full data pipeline: AssetRipper + UnityPy).

## Recommended versions

| Tool | Recommended | Notes |
|------|-------------|-------|
| **Node.js** | **18 LTS or newer** (tested on 20.19) | runs the renderer's static server + the build scripts |
| npm | bundled with Node | — |
| **Python** | **3.10 – 3.12** (tested on 3.11) | only for the recipe step (Path B) |
| **UnityPy** | latest (`pip install UnityPy`) | reads the decrypted Unity bundles |
| **AssetRipper** | latest stable GUI build | exports the composed geometry + textures (Path B) |
| .NET | only if your AssetRipper build is framework-dependent → **.NET 8 runtime** | most AssetRipper releases are self-contained |
| three.js | 0.165.0 — **pinned via CDN import map**, nothing to install | see `public/index.html` |
| Browser | any recent Chrome / Edge / Firefox / Safari | needs WebGL2 + import maps |

The **runtime has zero npm dependencies**; `npm install` only pulls dev tools (playwright/pngjs) used
for headless screenshots.

> **AssetStudio is _not_ used anywhere here.** Geometry = AssetRipper; materials *and* shaders = UnityPy.
> (Decompiling a shader for a new rarity is also UnityPy + SPIRV-Cross — see [SHADERS.md](SHADERS.md).)

---

## Path A — run the sample cards

```bash
git clone https://github.com/cccRaim/pocket-card-render
cd pocket-card-render
npm install
```

The three sample scenes are prebuilt, but their **art is not committed** (it's the game's). Provide it
from an AssetRipper export of **your own** copy of the game (see *Path B → step 2* for the export
config), then gather just what the samples reference:

```bash
npm run gather -- /path/to/AssetRipper-export   # copies the meshes+textures into public/game/
npm run serve                                    # → http://127.0.0.1:8011
```

Open <http://127.0.0.1:8011>, then `?scene=scene.pk.json` / `scene.sr.json` / `scene.ur.json`.

---

## Path B — render a new card (full pipeline)

```
 decrypt (upstream, game-specific)         ── you provide the decrypted *_bundles
        │
        ├─► AssetRipper  ──► composed .glb geometry + .png textures        (export root)
        └─► UnityPy      ──► <illId>_render_full.json  material recipe      (dump_recipe.py)
                 │
                 ▼
          build/build.mjs  ──►  public/scene.<tag>.json
          build/gather.mjs ──►  public/game/…  (the art the scene references)
                 │
                 ▼
            npm run serve  ──►  ?scene=scene.<tag>.json
```

### 1. Decrypt the bundles (you provide this)

The game ships its Unity bundles encrypted. Decryption is **game-specific and upstream — not included
in this repo**. You must produce a folder of **decrypted** `*_bundles` files (call it `<DECRYPTED>`),
laid out like the game:

```
<DECRYPTED>/Common/CardNew/Face/<illId>/L/Prefabs/<illId>_L.prefab_bundles   # the card's prefab
<DECRYPTED>/Common/CardNew/Common/…                                          # shared meshes/textures
<DECRYPTED>/Common/Shader/…                                                  # shaders
```

### 2. Export geometry + textures with AssetRipper

Install [AssetRipper](https://github.com/AssetRipper/AssetRipper) (free). Load your `<DECRYPTED>`
bundles, then set **Configuration** as follows (only the marked options matter; leave the rest default):

| Option | Value |
|--------|-------|
| Default Version | **`2022.3.62f2`** (the game strips its Unity version; this must be set) |
| Bundled Assets Export Mode | Direct Export |
| **Experimental → Enable Prefab Outline** | **ON** ← this is what produces the composed glb |
| Image Export Format | **Png** |
| Shader Export Format | Dummy Shader |
| Audio / Script / etc. | default |

Export to a folder — that folder (the one containing `Assets/`) is your **`<export-root>`**.

### 3. Expected directory after export

```
<export-root>/
└── Assets/
    ├── PrefabHierarchyObject/<illId>_L.glb        ← the composed card mesh (geometry + transforms)
    ├── Texture2D/…*.png                           ← textures
    └── Lettuce/_Data/…/Textures/…*.png            ← more textures at their container paths
```

> If `PrefabHierarchyObject/` is missing, **Enable Prefab Outline** was off. If you get `.mat`-less
> JSON and no glb, re-check the Default Version + that experimental flag.

### 4. Generate the material recipe (UnityPy)

```bash
pip install UnityPy
mkdir -p recipes
python build/dump_recipe.py \
    "<DECRYPTED>/Common/CardNew/Face/<illId>/L" \
    --shared "<DECRYPTED>/Common/CardNew/Common" \
    --shared "<DECRYPTED>/Common/Shader" \
    --out "recipes/<illId>_render_full.json"
```

This writes the per-material recipe (`m_Floats`/`m_Colors`/`m_TexEnvs`, shader name, queue, world
transform). The `--shared` dirs let cross-bundle texture/shader pointers resolve. (Schema: see
[ASSETS.md](ASSETS.md).)

### 5. Build the scene

`build.mjs` joins the recipe + the AssetRipper glb + textures into a `scene.json`. Point it at your
two roots via env vars:

```bash
PCR_GAME_SRC="<export-root>" PCR_RECIPES="recipes" \
  node build/build.mjs <illId> "" scene.<tag>.json
```

(`PCR_GAME_SRC` = the AssetRipper export root, `PCR_RECIPES` = the dir holding
`<illId>_render_full.json`. They default to a sibling `../ptcg-apk-parser/apks/...` checkout.)

### 6. Gather the scene's art into `public/game`

```bash
node build/gather.mjs "<export-root>"      # copies only the /game/… files the scenes reference
```

### 7. (optional) Card text

The three samples ship their composited text (`public/text/`, `public/locales/`). Regenerating text for
a new card needs the game **masterdata** + `build/compose.mjs` / `build/carddata.mjs` and is a separate
step; without it the card renders **without** the name/HP/attacks overlay (the art is unaffected).

### 8. Run

```bash
npm run serve            # → http://127.0.0.1:8011/?scene=scene.<tag>.json
```

---

## Troubleshooting

- **Card renders but no art / 404 on `/game/…`** — run `npm run gather -- <export-root>` (Path A step).
- **`dump_recipe.py` prints 0 materials** — the `--shared` dirs are wrong, or the bundles aren't
  decrypted. UnityPy must see `Material` objects.
- **Wrong layer order** — provide a `card_shader_state.json` via `--shader-state` (optional; most
  recipes already carry a real `renderQueue`).
- **Text missing on a non-sample card** — expected (see step 7); the geometry/foils still render.
