# Setup & data pipeline

For a newer game or Unity baseline, read [UPGRADING.md](UPGRADING.md) before
replacing any version-bound official evidence.

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
| **UnityPy** | latest (`pip install UnityPy`) | reads Unity bundles and official PlayerSettings |
| **capstone** | latest (`pip install capstone`) | decodes official ARM64 renderer methods for pipeline audits |
| **lz4** | latest (`pip install lz4`) | decompresses the official serialized Bloom shader blob |
| **freetype-py** | FreeType 2.13.x (`pip install freetype-py`) | independently audits all official TMP glyph metrics |
| **Pillow** | latest (`pip install Pillow`) | reads and verifies official TMP atlas pixels |
| **unicorn** | latest (`pip install unicorn`) | executes the pinned ARM64 Unity SDFAA glyph path for byte-exact atlas checks |
| **SciPy** | latest (`pip install scipy`) | independently proves the built-in card-example set has minimum cardinality |
| **AssetRipper** | latest stable GUI build | exports the composed geometry + textures (Path B) |
| .NET | only if your AssetRipper build is framework-dependent → **.NET 8 runtime** | most AssetRipper releases are self-contained |
| three.js | 0.165.0 — **pinned via CDN import map**, nothing to install | see `public/index.html` |
| Browser | any recent Chrome / Edge / Firefox / Safari | needs WebGL2 + import maps |

The **runtime has zero npm dependencies**; `npm install` only pulls dev tools (playwright/pngjs) used
for headless screenshots and the screenshot-free runtime smoke test.

The optional official-runtime audit also needs an APKM from your own game installation. Set
`PCR_APKM=/path/to/package.apkm`, then run `npm run audit:official-player-pipeline`. The command reads
the package directly and does not trust generated recipes as renderer evidence.

If you already have a raw Vulkan capture from your own target-device session, import and audit it without
screenshots:

```bash
npm run test:official-vulkan-runtime-import
npm run audit:official-vulkan-runtime-capture -- /path/to/capture public/scene.<card>.json
PCR_OFFICIAL_VULKAN_CAPTURE=/path/to/capture npm run report:evidence
```

The capture directory is local evidence and is intentionally not committed. A passing capture proves only the
captured card/device/runtime scope; it does not stand in for uncaptured rarities or devices.

> **AssetStudio is _not_ used anywhere here.** Geometry = AssetRipper; materials *and* shaders = UnityPy.
> (Decompiling a shader for a new rarity is also UnityPy + SPIRV-Cross — see [SHADERS.md](SHADERS.md).)

---

## Path A — run the sample cards

```bash
git clone https://github.com/cccRaim/pocket-card-render
cd pocket-card-render
npm install
```

The 112-card globally minimum coverage set, five minimum additional rarity-rendering witnesses,
and six supplemental regression scenes are prebuilt,
but their **art is not committed** (it's the game's). Provide it
from an AssetRipper export of **your own** copy of the game (see *Path B → step 2* for the export
config), then gather just what the samples reference:

```bash
npm run gather -- /path/to/AssetRipper-export   # copies the meshes+textures into public/game/
npm run serve                                    # → http://127.0.0.1:8011
```

`gather` also reopens the official Unity Mesh objects with UnityPy and restores the copied GLB
accessors after AssetRipper/SharpGLTF conversion. This preserves the official float32 position,
normal, tangent, and UV payload while retaining the exporter's hierarchy and material primitives.
Run `npm run audit:official-mesh-payload` to compare the four canonical prefabs as ordered expanded
triangle streams; the audit uses no screenshots or image thresholds.

Open <http://127.0.0.1:8011> and use the card dropdown. It exposes all 112 globally minimum
coverage scenes, five rarity-rendering witnesses, and six supplemental regression scenes. Entries remain disabled until their
referenced `/game/` assets have been gathered; the server never treats a generic fallback recipe as
a ready built-in example.

To regenerate that minimum catalog from your own official inputs, inspect the plan first and then
opt into gathering the referenced art:

```bash
npm run materialize:official-card-examples -- --dry-run
npm run materialize:official-card-examples -- --gather
```

The command generates only missing per-card recipes from `Face/<illId>/L` plus the shared official
card/shader roots. The fixed Git-tracked minimum proof remains independent of screenshots and
compose output.

---

## Path B — render a new card (full pipeline)

```
 decrypt (upstream, game-specific)         ── you provide the decrypted *_bundles
        │
        ├─► AssetRipper  ──► composed .glb geometry + .png textures        (export root)
        └─► UnityPy      ──► <illId>_render_full.json  material recipe      (dump_recipe.py)
                 │
                 ▼
          build/build.mjs  ──►  public/scene.<illId>.json
          build/gather.mjs ──►  public/game/…  (the art the scene references)
                 │
                 ▼
            npm run serve  ──►  ?scene=scene.<illId>.json
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

This writes the per-material recipe (`m_Floats`/`m_Colors`/`m_TexEnvs`, shader name, custom/effective
queue, world transform), plus official Renderer/Material/Shader/Mesh `CAB:pathID` identities and the serialized
Material/Shader keyword inputs used by native draw sorting. It also decodes compiled Shader parameter
reflection: a decisive per-renderer property outside `UnityPerDraw` writes `srpBatcherCompatible: 0`;
absence of that witness stays `null` rather than being guessed. The `--shared` dirs let cross-bundle
texture/shader pointers resolve. Direct renderer dependencies outside those roots are followed by
their serialized CAB owner identity from the nearest `decrypted` ancestor; this includes official
cross-card Material reuse and top-level shared Logo assets without card-name aliases. Use
`--dependency-root` only when the decrypted root cannot be inferred from the input path. (Schema: see
[ASSETS.md](ASSETS.md).)

When `m_CustomRenderQueue` is `-1`, the recipe resolves the effective queue
from the same official Shader's serialized SubShader `Queue` tag. A missing tag
means ShaderLab's `Geometry` default; unknown or subshader-dependent values fail
closed. Do not use a `card_shader_state.json` extracted from another game/Unity
version to fill this field.

### 5. Build the scene

`build.mjs` joins the recipe + the AssetRipper glb + textures into `scene.<illId>.json`. Point it at your
two roots via env vars:

```bash
PCR_GAME_SRC="<export-root>" PCR_RECIPES="recipes" \
  node build/build.mjs <illId>
```

(`PCR_GAME_SRC` = the AssetRipper export root, `PCR_RECIPES` = the dir holding
`<illId>_render_full.json`. They default to a sibling `../ptcg-apk-parser/apks/...` checkout.)
Pass an explicit third argument only when you intentionally want a non-canonical output filename.

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
npm run serve            # → http://127.0.0.1:8011/?scene=scene.<illId>.json
```

### 9. (advanced, optional) Capture official runtime draw-sort fields

The remaining equal-prefix draw-order inputs are process-session state, not serialized asset data. Capturing
them requires the pinned PTCGP `1.6.0 (293311)` arm64 build on a rooted test device, ADB, and a matching
`frida-server`. First verify that the read-only probe still matches the local official `libunity.so`:

```powershell
npm run audit:official-sort-runtime-capture-tool
frida -U -f jp.pokemon.pokemontcgp -l build/capture-official-sort-runtime.js |
  Tee-Object sort-capture.log
```

Open the target card in the official game, capture a stable frame, then stop Frida. Import that single session
against the exact scene; the importer rejects mixed sessions/releases, independently recomputes entry `+0x08`
and `+0x28`, ignores unrelated screen draws, and never guesses ambiguous Renderer mappings:

```powershell
npm run import:official-sort-runtime-capture -- sort-capture.log public/scene.<illId>.json public/sort-import.<illId>.json
npm run test:official-sort-runtime-import
```

Load it explicitly with
`?scene=scene.<illId>.json&sortCapture=sort-import.<illId>.json`. The renderer verifies the raw scene SHA-256
and activates captured ordering only for collision groups whose every member has an exact draw mapping;
incomplete groups fall back as a whole.

The generated artifact is session-bound evidence. Do not reuse it across cold starts or game versions, and do
not publish it as general draw-order data until repeated captures prove the required low bytes are stable.

---

## Troubleshooting

- **Card renders but no art / 404 on `/game/…`** — run `npm run gather -- <export-root>` (Path A step).
- **`dump_recipe.py` prints 0 materials** — the `--shared` dirs are wrong, or the bundles aren't
  decrypted. UnityPy must see `Material` objects.
- **Wrong layer order / black card with only dynamic text visible** — regenerate
  the recipe with the current `dump_recipe.py` and same-version `Common/Shader`
  bundles. Recipe v2 must contain `effectiveRenderQueue` and
  `effectiveRenderQueueSource`; the scene builder rejects unresolved queues.
- **Text missing on a non-sample card** — expected (see step 7); the geometry/foils still render.
