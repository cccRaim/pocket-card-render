# Decompiling the card shaders

> **English** · [简体中文](SHADERS.zh-CN.md)

This is the exact workflow that produced the GLSL in this repo (the inline shaders in
`render/materials/*.js` and the exact ports in `public/shaders/*.glsl`). You only need it to add a **new** shader
(a new rarity's effect) — existing shaders already ship as GLSL.

The game's shaders are Unity sub-program blobs: **lz4-compressed → SMOL-V → SPIR-V**, with the **uniform
names stripped**. The toolchain: extract the SPIR-V, transpile to GLSL, recover the stripped names, port.

## Tools

| Tool | Install | Role |
|------|---------|------|
| Python + UnityPy + lz4 | `pip install UnityPy lz4` | read the shader bundle, lz4-decompress |
| SMOL-V decoder | ships here: `build/shaderdec/smolv.py` (pure Python) | SMOL-V → SPIR-V |
| **SPIRV-Cross** | [Vulkan SDK](https://vulkan.lunarg.com/) or [standalone](https://github.com/KhronosGroup/SPIRV-Cross) | SPIR-V → GLSL (the authoritative Khronos transpiler) |

You also need your **decrypted** `Common/Shader` bundles (`<DECRYPTED>` — see [SETUP.md](SETUP.md) step 1).

## Step 1 — extract the SPIR-V

Find the shader's name in the recipe (`scene.json` → `materials[*].shader`, e.g. `Frame-Holo-UR-New`),
then:

```bash
pip install UnityPy lz4
python build/shaderdec/dump_shader.py "Frame-Holo-UR-New" frameur \
    --shaders "<DECRYPTED>/Common/Shader" --out shaders_spv
# → shaders_spv/frameur_frag.spv  (+ frameur_vert.spv)
```

If the material enables a compiled shader keyword, select that exact sub-program instead of relying on
the default largest-module heuristic:

```bash
python build/shaderdec/dump_shader.py Card_Parallax card_parallax \
    --keyword _UVASPECTRATIO_SQUARE \
    --shaders "<DECRYPTED>/Common/Shader" --out shaders_spv
```

The keyword must come from the material recipe. Different variants can contain different math even
when they share the same shader name.

## Step 2 — SPIR-V → GLSL with SPIRV-Cross

```bash
spirv-cross shaders_spv/frameur_frag.spv --version 300 --es --flatten-ubo > frameur_frag.glsl
```

- `--flatten-ubo` turns the constant buffer into `uniform vec4 _NN[k]` indexed by **byte offset**.
- samplers come out in **binding order** (`_13`, `_205`, … → `_FlowAMap`, `_ALightTex`, … by their slot).

## Step 3 — recover the stripped uniform names

SPIRV-Cross can only emit anonymous `_NN[k]` because the names were stripped. Map offsets → real param
names by reading a **sibling** shader variant that kept its reflection:

```bash
python build/shaderdec/reflect.py "<SiblingShaderSuffix>" --shaders "<DECRYPTED>/Common/Shader"
# prints  @84 _SpecularIntensity   @88 _DiffractionIntensity   @96 _DiffractionPower  …
```

Cross-reference those byte offsets with the `_NN[k]` layout from step 2 to label each param (then look it
up in the recipe `r.floats` / `r.colors`). If **no** sibling kept the names, that one param is not
statically recoverable — but first check whether the term is even active for your card.

## Step 4 — port the GLSL into a material strategy

SPIRV-Cross output uses Unity conventions. Adapt to three.js:

- alias the attributes (`position` / `normal` / `uv`) and use `projectionMatrix * modelViewMatrix` for
  `gl_Position`;
- compute the camera-relative basis with `inverse(modelMatrix) * cameraPosition` (see
  `render/glsl.js` — the shared `VIEW_BASIS_VS` does exactly this);
- preserve every active color output; when WebGL cannot expose the official MRT layout directly, route the
  unchanged official output into the corresponding renderer pass and audit that adaptation explicitly;
- wire the uniforms from the recipe via the [RenderContext](public/render/context.js)
  (`ctx.layerTex(r, slot)`, `r.floats`, `r.colors`);
- preserve implicit ShaderLab defaults by texture dimension; for example an empty Cubemap property is
  Unity's built-in gray cube, not another material's scene environment map;
- wrap it as `defineMaterial(kind, { requires, build })` — see [CONTRIBUTING.md](CONTRIBUTING.md).

**Worked examples already in the repo:**

- `render/materials/ur.js` → `plate` is byte-traced from `urplate_frag.spv` (comment cites the trace).
- `render/materials/holo.js` → `frameHolo` is the full SSA trace of `framh_frag.spv` (names recovered
  from a sibling, per step 3).
- `public/shaders/glitter.*.glsl` preserves the large anonymous constant-buffer layout in a
  `RawShaderMaterial`.
- `public/shaders/card_parallax*.glsl` shows smaller official programs adapted to named three.js
  uniforms, including exact keyword-variant selection and cube-map bindings.
- `npm run build:exact-frame-holo-ur` regenerates `Frame-Holo-UR-New` from the official bundle. Its
  location-1 emissive expression is preserved and routed unchanged into the WebGL bloom pass;
  `npm run audit:exact-frame-holo-ur` verifies the checked-in files byte-for-byte against regeneration.
- `npm run build:exact-transparent-hologram-tuning` regenerates the DynamicUI hologram program while
  preserving its alpha-only location-1 mask output and Unity's implicit gray Cubemap default.
- `npm run build:exact-basic-holograms` regenerates `Card_Parallax_Hologram_Tuning` and
  `Card_Hologram_Tuning`, including their complete UBO layouts, sampler bindings, vertex attributes,
  and MRT outputs; `npm run audit:exact-basic-holograms` verifies the checked-in programs.

## Reality check (don't hand-tune)

- Small shaders port almost 1:1 from SPIRV-Cross. The big ones (Frame-Holo ≈ 1219 instructions, ShadowBox
  ≈ 1306) **plus** stripped names are genuinely hard — that's why the strategies in `render/materials/`
  exist; reuse them.
- **Verify numerically, not by eye.** Feed identical inputs to the real `.spv` and your GLSL and diff the
  output; a constant texture makes the comparison pure arithmetic. Every constant must trace to the recipe
  or the byte-trace — never an eyeballed value.
