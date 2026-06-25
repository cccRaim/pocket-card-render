# Asset contract — bring your own game data

This renderer ships **no game assets**. To render a card you provide two things, both derived from
**your own** copy of the game:

1. a **scene recipe** — `public/scene.<tag>.json`
2. the **art** it references — meshes + textures under `public/game/`

## 1. The scene recipe (`scene.*.json`)

A scene is the per-draw-call manifest the renderer consumes. Shape:

```jsonc
{
  "card":      { "id": "cTR_20_000670_00_IIBUINOBAKKU_UR", "name": "...", "rarity": "UR", ... },
  "prefabGlb": "/game/Assets/PrefabHierarchyObject/<illId>_L.glb",
  "materials": {
    "<material.name>": {                 // keyed by the glb mesh's material name (authoritative)
      "shader":  "Card_UR_Plate",        // shader NAME → app.js SHADER{} map picks the render kind
      "queue":   2200,                    // resolved render queue (painter's order)
      "clip":    "card" | "window",       // stencil region
      "stencil": 2 | null,
      "floats":  { "_FakeSpecularPower": 1.0, ... },   // material m_Floats (drive the shader)
      "colors":  { "_BaseColor": [r,g,b,a], ... },     // material m_Colors
      "keywords":[ ... ],
      "textures":{ "_MainTex": { "name": "...", "url": "/game/Assets/.../foo.png" }, ... }
    }
  },
  "textures":  { "<name>": "/game/Assets/.../foo.png", ... },   // name → url, for gather + alpha
  "alphaMode": { "<name>": "straight" | "premult" | "opaque" }
}
```

Every `url` is a `/game/<relative-path>` that the server resolves to `public/game/<relative-path>`.
The `<relative-path>` mirrors the AssetRipper export layout (`Assets/...`).

## 2. The art (`public/game/`)

`public/game/` mirrors the `/game/` URLs: e.g. `/game/Assets/PrefabHierarchyObject/X_L.glb` →
`public/game/Assets/PrefabHierarchyObject/X_L.glb`. Two asset kinds:

- **meshes** — `<illId>_L.glb`: the *composed* prefab (full hierarchy + world transforms, every
  material as a named sub-mesh). Export with **AssetRipper** (free), settings: default Unity version
  `2022.3.62f2`, experimental **"Enable Prefab Outline"** on → produces `Assets/PrefabHierarchyObject/*.glb`.
- **textures** — `.png`, at their real container paths under `Assets/`.

`npm run gather -- <export-root>` copies exactly the files the prebuilt scenes reference, so you only
stage what you need.

## Producing a scene for a NEW card

`build/build.mjs` builds a scene from a **material recipe** (`<illId>_render_full.json`) + the
AssetRipper glb + textures:

```bash
node build/build.mjs <illId> "" scene.<tag>.json
```

The material recipe (per-material `m_Floats`/`m_Colors`/`m_TexEnvs`, shader name, render queue) is the
one piece that comes from the **decrypted Unity material bundles**, not the AssetRipper glb (the glb
carries geometry + material *names* only). Generating it is a data-prep step outside this repo; commit
the resulting `scene.*.json` here and `gather` its art. See the project notes for the recipe tool.

## Why two tools

The composed glb (geometry) comes from **AssetRipper**; the material parameters come from the
**decrypted material bundles**. Neither source alone is sufficient — this is by design, verified, and
intentional. The renderer here only ever consumes the resulting `scene.json` + `public/game/` art.
