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
| SMOL-V decoders | `build/shaderdec/smolv.py` + pinned upstream C++ oracle | SMOL-V → SPIR-V, full-corpus differential |
| **SPIRV-Cross** | [Vulkan SDK](https://vulkan.lunarg.com/) or [standalone](https://github.com/KhronosGroup/SPIRV-Cross) | SPIR-V → GLSL (the authoritative Khronos transpiler) |

You also need your **decrypted** `Common/Shader` bundles (`<DECRYPTED>` — see [SETUP.md](SETUP.md) step 1).

The Python decoder is checked against upstream `aras-p/smol-v` commit
`9dd54c379ac29fa148cb1b829bb939ba7381d8f4` across all 588 physical SMOL-V records shipped in the 128
`Common/Shader` bundles. Run `npm run audit:official-smolv-corpus`; it also validates all 380 unique outputs with
`spirv-val`. This proves decoder equivalence for the pinned asset version, not Vulkan-to-WebGL or runtime-draw
equivalence.

## Step 1 — extract the SPIR-V

Exact ports must use `build/extract_official_selector_program.py` through a selector-keyed generator. The join key
is `selectorId + candidateWitnessId + subshader/pass`; shader names and module size are not identities.

`dump_shader.py` remains an exploratory convenience only:

Find the shader's name in the recipe (`scene.json` → `materials[*].shader`, e.g. `Frame-Holo-UR-New`),
then:

```bash
pip install UnityPy lz4
python build/shaderdec/dump_shader.py "Frame-Holo-UR-New" frameur \
    --shaders "<DECRYPTED>/Common/Shader" --out shaders_spv
# → shaders_spv/frameur_frag.spv  (+ frameur_vert.spv)
```

If the material enables a compiled shader keyword, the exploratory command can narrow the output, but this still
does not promote it to exact evidence:

```bash
python build/shaderdec/dump_shader.py Card_Parallax card_parallax \
    --keyword _UVASPECTRATIO_SQUARE \
    --shaders "<DECRYPTED>/Common/Shader" --out shaders_spv
```

The keyword must come from official serialized Material data for an exact port, not from a generated recipe.
Different variants can contain different math even when they share the same shader name.

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

The browser runtime now uses a real two-attachment WebGL2 target. Official Shader pass data has
`rtSeparateBlend=false`, so both attachments share each material's active RT0 blend state; serialized
`rtBlend1` values are inactive defaults. `npm run test:mrt-runtime` verifies both results numerically in one draw,
without screenshots. The postprocess runtime then executes the official six Bloom programs in the decoded
`0,1,2,3,3,4,5` graph, including five fixed-size downsample levels, float32 atlas weights, serialized blend state,
and the official `Rendering/CustomRenderer/Blit` final pass.

The render-target descriptor proof is deliberately scoped. Official ARM64 constructors and CommandBuffer calls
pin two scene ARGB32 color targets, Depth24, and Point filtering; Bloom intermediates request ARGB32, Linear
read/write, Bilinear filtering, Depth0, MSAA1, volume depth 1, and no memoryless mode. The browser explicitly
maps those requests to RGBA8/unsigned-byte targets, Nearest/Linear filtering, and its tested WebGL2 depth/sample
settings. This mapping is a browser adaptation, not proof of the physical Vulkan color/depth formats returned by
Unity's device-specific `GetCompatibleFormat`.

The detail-card source RT is a separate stage. `npm run audit:official-card-renderer` pins its square
ARGB32/Depth24/AA1 constructor and the serialized `_cardSize=6`, which maps to `CardSizeType.Large`
(734×1024). The official `roundToEven(pixelHeight / VerticalPercentageInRT * UICardQuality)` formula with
the ordinary Android default `Middle=0.8` yields `1122×1122`; `561×561` is only the counterfactual
`Medium` result. The same official formula yields `1403×1403` for High and `982×982` for Low. Actual persisted
device quality remains device state. The browser defaults to display-driven `auto`, deriving a source RT no
smaller than the physical drawing buffer to avoid desktop upscaling; that inspection-only size is not evidence
for the captured runtime state. `quality=middle` reproduces the captured profile; High and Low keep the exact
official fixed sizes.

SPIRV-Cross output uses Unity conventions. Adapt to three.js:

- alias the attributes (`position` / `normal` / `uv`) and use `projectionMatrix * modelViewMatrix` for
  `gl_Position`;
- compute the camera-relative basis with `inverse(modelMatrix) * cameraPosition` (see
  `render/glsl.js` — the shared `VIEW_BASIS_VS` does exactly this);
- preserve every active color output at its original MRT location; do not replay emissive layers in a second
  render pass;
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
- `npm run build:exact-classic-holograms` regenerates `Frame-Holo-Tuning` and
  `Opaque-Hologram_Tuning`. In addition to SPIR-V reflection, its audit checks Unity's compiled
  `m_CommonParameters` texture and constant-buffer bindings against the runtime mapping.
- `npm run build:exact-opaque-ur-oklab` selects the four-keyword `Opaque-UR-Oklab` variant and
  regenerates it from official SPIR-V. Its audit also parses the compiled variant parameter blob to
  recover all 13 texture bindings and both named UBO layouts; `npm run audit:exact-opaque-ur-oklab`
  checks the committed program byte-for-byte.
- `npm run build:exact-ur-bg-hologram` regenerates the single-program
  `Card_Parallax_Hologram_UR_New` shader and verifies all six compiled texture bindings, both UBO
  layouts, and its zero-valued secondary MRT output.
- `npm run build:exact-ur-plate` regenerates `Card_UR_Plate`, including its eight compiled texture
  bindings, material-local Cubemap semantics, both UBO layouts, and zero-valued secondary MRT output.
- `npm run build:exact-ur-lens-flare` regenerates the no-keyword `Card_UR_LensFlare` program, including
  its VAT vertex path and nonzero secondary MRT emissive output. AssetRipper retains the serialized flare
  transforms but drops their `unity default resources` Quad; the runtime restores that built-in mesh from the
  scene recipe, and the no-screenshot runtime test asserts two flare draws on each UR reference card.
- `npm run audit:official-shader-precision` pins precision decorations and float-control opcodes across
  14 official programs. Glitter preserves its official mixed mediump/highp chain; the no-screenshot runtime
  probe classifies SwiftShader's FP32-like mediump promotion without extrapolating it to Android GPUs.
- `test:official-touch-rotation` and `test:official-clock` cover the native incremental drag quaternion,
  30-degree clamp, hierarchy-derived Glitter forward, scaled delta, shared LensFlare `_Time`, and suspend state.
  `audit:official-android-lifecycle` pins eight official Unity symbols and the exact Android
  pause/deferred-resume chain, then verifies the browser visibility adapter without screenshots.
- `audit:official-texture-payload` and `test:texture-mip-runtime` pin official object/payload identities and
  upload all 38 stored mip levels explicitly; implicit browser mip generation is forbidden.
- `npm run build:exact-bloom` regenerates all six `Hidden/CustomPostEffect/Bloom` programs from the official
  serialized Shader in the APKM. `audit:official-bloom-program` pins the asset, pass mapping, bindings, and
  render state; `audit:official-bloom-runtime` pins the RT descriptor/sizes, atlas coordinates, weights, blur order,
  graph, and pass 5's direct additive write to scene ColorRT.
- `npm run build:exact-final-blit` follows the official ResourceManager → Material → Shader chain and regenerates
  `Rendering/CustomRenderer/Blit`. Its audit pins explicit mip-0 sampling, scale/bias, fixed-function state, and
  verifies the paired Vulkan-to-WebGL Y adaptation with an asymmetric 2×2 GPU draw/readback fixture.
- `npm run build:exact-side-back` regenerates `Side&Back` from the `INSTANCING_ON` Vulkan variant observed in
  the official runtime capture, including its `_BaseTex`/`_Blend` fragment math and zero secondary MRT output.
  The WebGL2 adaptation folds the captured single-instance arrays to element zero. `audit:official-side-back`
  pins the serialized material slots, both compiled variants, runtime module hashes, queue, depth/cull/blend state,
  camera-facing geometry, and source hashes.
- `npm run audit:official-vulkan-runtime-capture -- <capture-dir> <scene.json>` imports the raw JSONL/SPIR-V
  capture without screenshots. It verifies every captured shader file by size, SPIR-V magic, FNV-1a, and SHA-256,
  replays pipeline and draw state, then maps draws to official scene identities without using scene queue as an
  identity oracle. The current legacy Eevee Bag capture has three submitted matching 23-draw scopes and 23/23
  byte-identical vertex+fragment+specialization programs. It uniquely identifies 19/23 draws; the two equivalent
  `Frame-Holo-UR-New` draws and two equivalent `Card_UR_LensFlare` draws remain explicitly unresolved. Because this
  capture predates the manifest schema, its game/device/GPU/driver provenance remains incomplete.
- `npm run audit:official-pass-partition` pins the official opaque and transparent renderer events, queue ranges,
  sorting criteria, dual-target/depth bindings, and ShaderTag order without using screenshots.
- `npm run audit:official-draw-order-native` and `npm run test:official-draw-order` pin the APKM/native
  Float32 distance key, quantized bucket, raw Optimize/transparent comparator branches, and final ties.
  `npm run audit:official-unity-symbol-map` maps those game byte ranges to Unity's official Android Build
  Support public symbols and verifies the source installer and both ELF payload hashes.
  `npm run audit:official-reference-sort-inputs` independently pins the four official L prefab bundles and
  raw MeshRenderer objects, then checks 94 active draw identities and 84 scene material rows against them.
  `npm run audit:official-material-sort-inputs` independently reopens the official Face/CardNew Common/Shader
  bundles and verifies those rows against 69 serialized Materials and 26 serialized Shaders without recipe data.
  Runtime uses the exact distance/bucket prefix and the proved MeshRenderer zero offset.
  `npm run audit:official-pass-candidates` proves all 98 reference draws
  select pass 0 with candidate ordinal 0; runtime identity values used by equal-prefix Optimize ties remain a boundary.
  The raw prefab audit also proves non-static batching, `65535/65535` lightmap indices, and no `LODGroup` for
  all 78 reference MeshRenderers. Those fields, material slots, Canvas order, and non-LOD fade now enter scene
  sort descriptors. It also resolves 7/7/9/9 Mesh identity equivalence classes and the native-default
  SortingGroup key. The scene also preserves raw queue, instancing, and valid/invalid keyword state.
  `npm run audit:official-srp-batcher` proves all 26 canonical Shaders are SRP-batcher incompatible, making the
  bit zero for all 94 active draws. `npm run audit:official-local-keyword-state` independently rebuilds and
  verifies the ordered bitset plus official-seed XXH32 hash for all 84 rows, so final keyword state is known.
  The first unresolved Optimize field is entry `+0x08` on the command-proved hashed branch; Material/Shader
  inputs still requiring capture are Material `+0x17c` and the Shader Object InstanceID low byte. Absolute
  entry `+0x28`, RenderNodeQueue slot, and candidate ordinal are captured by the same probe if state keys tie;
  the four canonical cards use the non-static-batch comparator branch.
  `npm run audit:official-sort-input-producers` pins 20 producer/helper symbols, 107 exact AArch64 words, the
  regular Renderer versus BRG packing formulas, the non-LOD zero relocation, and `MeshRenderer`'s low-six-bit
  `RendererType=1` propagation into `RenderNode+0xe8`, without consuming scene or recipe output.
  `npm run audit:official-instance-id-remapper` pins 136 additional official/game AArch64 instructions, both
  InstanceID allocation formulas, and the propagation into `Object+0x08`. It proves that static `CAB:pathID`
  cannot recover the low byte without the live Remapper allocation event stream.
  `npm run audit:official-sort-command-branch` proves the official opaque and transparent pass commands both
  select the hashed Material/Shader state-key branch at entry `+0x08`.
  `npm run audit:official-sort-prefix-collisions` emits a per-field decision table for 17 stable groups covering
  36 draws. All reach OptimizeStateChanges and tie on the known Renderer/LOD/static/lightmap keys without running
  a browser or renderer. Their runtime boundary classes are 6 Material-`+0x17c`-only, 3 shared-Shader, and 8
  distinct-Shader groups. `npm run audit:official-sort-runtime-capture-tool` statically verifies the read-only
  PTCGP 1.6.0 Frida probe; actual capture requires a rooted arm64 test device. The generated collision manifest,
  20,000-pair raw comparator differential, and atomic group resolver are separate no-browser gates. Static PPtr
  identities are correlation keys, not substitute sort keys.
- `npm run audit:official-draw-state` intercepts representative opaque, transparent, CullOff, stencil, and
  shared-MRT WebGL2 draw calls. Its queried state and framebuffer probes currently pass 98/98 assertions,
  including the official stencil write mask `4`. This is selected three.js r165/Chromium coverage, not proof of
  every material, native Unity/Vulkan state, sorting, shader math, or final pixels.
- `npm run build:exact-homography` regenerates the official `Prerender/Homography(from RT)` vertex and fragment
  programs from Vulkan SPIR-V. The audits pin H/Hinv `float[9]` bindings and IL2CPP upload contracts, while
  `npm run test:homography-runtime` verifies the ARM64-ordered Float32 H/Hinv helpers for identity, convex,
  degenerate, and near-degenerate inputs. `audit:official-homography-wiring` proves the `_clampParallax`
  material branch and CardRenderer RT to `_DynamicUITex` path; `audit:official-card-display` proves the
  remaining-transmission alpha contract over 98 official material references. `public/app.js` now wires the
  fixed source MRT/camera, source-only touch root, projected keypoints, exact Homography MRT, and exact FinalBlit
  presentation. `test:texture-upload-runtime` proves hidden-RGB preservation, straight partial-alpha bytes, and
  Y orientation through the shared Chromium texture loader with GPU readback. The display-transfer audits pin
  the official Vulkan surface policy and browser compositor-input bytes. Native RT physical Y, physical texture
  format, and target-device swapchain/compositor/OS/panel transfer remain unproven.
- `npm run build:exact-ui-default-from-rt` regenerates the official outer RawImage display shader. It preserves
  vertex color times `_Color`, `_MainTex_ST`, `_TextureSampleAdd`, `alpha = 1 - sample.a`, zero MRT1, and
  `One / OneMinusSrcAlpha`, with no texture-coordinate Y flip. Runtime `_TextureSampleAdd`, physical texture
  format, Dynamic UI keyword state, and Canvas-resolved color-mask/Z-test/stencil values remain explicit
  boundaries; ShaderLab property placeholders are not runtime fixed-function values.
- `npm run build:official-card-display-contract` compiles the official 1122-square RT, camera, clear/alpha,
  keypoint, and display-mode facts into `public/render/card-display-contract.json`.
- `npm run audit:official-rendertexture-contract` pins the ARGB32/GF8/Vulkan and Depth24 compatible-format
  algorithms plus Unity/Homography/FinalBlit Y semantics; actual device formats and VkViewport remain device state.
- `npm run audit:official-camera-transform` also pins `_useGyro=false` in the ordinary
  `CommonUICardDetailCard` serialized component. The browser therefore intentionally has no device-gyro path
  for that view; unknowns in a generic gyro-enabled view must not be treated as missing ordinary-detail work.

## Reality check (don't hand-tune)

- Small shaders port almost 1:1 from SPIRV-Cross. The big ones (Frame-Holo ≈ 1219 instructions, ShadowBox
  ≈ 1306) **plus** stripped names are genuinely hard — that's why the strategies in `render/materials/`
  exist; reuse them.
- **Verify numerically, not by eye.** Feed identical inputs to the real `.spv` and your GLSL and diff the
  output; a constant texture makes the comparison pure arithmetic. Every constant must trace to the recipe
  or the byte-trace — never an eyeballed value.
