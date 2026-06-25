# Asset contract — bring your own game data

> **English** · [简体中文](ASSETS.zh-CN.md)

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
one piece that does **not** come from the AssetRipper glb (the glb carries geometry + material *names*
only). It is produced separately — see the toolchain below — then committed here as part of `scene.*.json`.

## The data-preparation toolchain

Two tools, because **no single one provides everything** (verified by execution):

| Tool | Produces | Notes |
|------|----------|-------|
| **AssetRipper** (.NET, free) | the *composed* glb geometry + textures | Settings as above. It instantiates the prefab hierarchy (the per-card Face prefab + the shared Template prefab) into one glb with every material as a named sub-mesh — geometry no other tool here reproduces. |
| **UnityPy** (Python) | the **material recipe** (`m_Floats`/`m_Colors`/`m_TexEnvs`, shader name, render queue) | Loads the **decrypted** Unity material bundles (`UnityPy.config.FALLBACK_UNITY_VERSION = "2022.3.62f2"`), resolves cross-bundle PPtrs, and writes the per-layer recipe in the schema above. The renderer needs this; the glb has only material *names*. |

> **AssetStudio was evaluated and does not fit here.** Its CLI cannot dump `Material` objects — Material
> is not an exportable type (`-m dump` only emits Mesh / Texture2D / MonoBehaviour / Shader), so it
> cannot supply the recipe. Use UnityPy for materials.

Both prep tools run against **your own** decrypted game data and live **outside this repo**; this repo
only ever consumes the resulting `scene.json` + `public/game/` art. (Decryption is an upstream,
game-specific step, also not included here.)
