# Rendering Fidelity

> **English** | [简体中文](FIDELITY.zh-CN.md)

This project does not define game fidelity as one percentage. A layer can use official assets and
decompiled shader expressions while the final card is still wrong because texture decoding, MRT
composition, blending, precision, postprocessing, camera state, or display encoding differs from the
game runtime.

## The evidence vector

Every fidelity statement must name its dimension and scope:

| Dimension | What it establishes | What it does not establish |
|---|---|---|
| Source provenance | Meshes, textures, material values, keywords, and layer order came from the selected game data revision | That the renderer interprets them correctly |
| Layer implementation | A visible layer dispatches to a renderer strategy | Shader equivalence or correct pixels |
| Official shader evidence | The implementation is constrained by official shader bytecode | Whole-pipeline or final visual equivalence |
| Renderer-pipeline parity | Texture transfer functions, precision, render targets, MRT, blend, stencil, camera, and postprocess match the official runtime | Correct card output without validation captures |
| Controlled visual parity | The rendered layer/card matches controlled official captures at fixed poses and times | Generalization to cards and states outside the capture corpus |

Percentages are allowed only for an explicitly named coverage denominator such as selectors, material
slots, or audit obligations. The project does not currently publish `officialShaderRestorationPercent`:
without official guest draw/descriptor/uniform/attachment evidence and an independent proof of
Vulkan-to-WebGL semantic equivalence, that field remains `null`. Coverage is not pixel similarity or
`gameFidelity`.

## Versioned audit obligations

`npm run audit:restoration` uses a fixed, versioned denominator instead of deriving the denominator
from features the repository already knows how to audit. Its rules are:

- ten renderer dimensions have equal weight, so shader layer count cannot hide text or runtime gaps;
- every dimension contains explicit official-renderer obligations and advancement costs;
- only `exact` evidence contributes to the primary score;
- `inferred`, `runtime-required`, `missing`, and `unknown` remain in the denominator and score zero;
- `partial-exact` contributes only its enumerated exact subscopes;
- the fresh gate runs no-browser official byte/object/program verifiers and emits no screenshots;
- a failed fresh gate makes the audit-obligation completion rate non-reportable;
- the fresh gate recursively rejects Playwright/Puppeteer/browser launches; numeric browser probes are explicit separate tests.

The report emits `auditObligationExactPercent` and `knownImplementationPercent`. The first is still an
internal completion rate for this audit definition, and the second includes inferred work; neither is
official shader fidelity. They describe the current evidence graph for four canonical
RR/SR/Trainer-UR/Pokemon-UR scenes, not every card, target-device pixels, compositor output, or panel appearance.

```bash
npm run audit:restoration
npm run audit:restoration:json
```

Geometry is independently checked with `npm run audit:official-mesh-payload`. For the canonical
scope it resolves 78 official MeshFilters, separates four Unity built-in Quad filters, and compares
74 asset Mesh nodes / 130 GLB primitives / 81,606 expanded vertices byte-for-byte after the explicit
Unity-to-glTF coordinate conversion. Exporter vertex remapping and consecutive same-material
submesh merging are normalized structurally, not hidden behind numeric tolerances.

The DynamicUI/TMP runtime check is also screenshot-free. Open each canonical scene with `?auditrt=1`;
the local server records draw counts plus premultiplied/UI/holo render-target readbacks in
`tmp-runtime-evidence.local.json`. The artifact is git-ignored and pins SHA-256 hashes for the layout
implementation, prefab contract, generated text, font manifest, TMP renderer, official shaders, and
other actual inputs, so any relevant change invalidates stale runtime evidence automatically.

```bash
npm run audit:official-tmp-mesh
npm run audit:tmp-runtime-evidence
```

This proves that the local WebGL path submitted official-program glyph draws and produced nonempty
render targets for the captured canonical scenes. It is not a substitute for an official Vulkan
capture, target-GPU numerics, or final display comparison.

The card-face layout source is independently regenerated with
`npm run build:official-card-ui-layout` and checked with
`npm run audit:official-card-ui-layout`. The schema pins both official prefab bundle hashes plus
object hashes and unrounded values for 512 RectTransforms and 68 TMP components. It includes the
full serialized spacing, margins, auto-size, wrapping, kerning, rich-text, and alignment fields;
`compose.mjs` no longer consumes the lossy cross-project `card_ui_prefabs.json` scan. This proves
the serialized inputs, not yet every branch of TMP 3.0.6 `GenerateTextMesh` or UGUI runtime state.

## Advancement cost

Cost is reported as a work class plus remaining scope, never as an unsupported calendar estimate:

- `maintenance`: the dimension is complete for the current reference scope; only regression upkeep remains.
- `renderer-integration`: missing layer dispatch or runtime binding work.
- `source-tracing-and-bytecode-audit`: official provenance or bytecode evidence is missing.
- `shader-reverse-engineering`: extract/decompile an official program, recover bindings, port it, and add guards.
- `backend-semantic-equivalence`: prove the Vulkan SPIR-V to WebGL GLSL/fixed-function adaptation over the target input domain.
- `runtime-pipeline-research`: establish shared official-runtime behavior such as formats, MRT, precision, or display transfer.
- `textmeshpro-runtime-port`: recover and implement TMP mesh/layout behavior from official IL2CPP and Unity code.
- `target-runtime-capture`: capture and compare official draw state, descriptors, uniforms, and render targets.
- `target-device-precision-probe`: establish GPU-specific precision, decode, and transcendental behavior.
- `corpus-expansion`: extend the fixed reference scope to additional card and material archetypes.
- `excluded-by-policy`: deliberately outside automatic auditing.

The current official program proof graph has the following reviewable coverage:

| Dimension | Current state | Advancement cost | Remaining scope |
|---|---:|---|---:|
| Official selectors resolved | 77/77 | `maintenance` | 0 selectors |
| Stage-source-bound semantic executables | 26/76 | `shader-reverse-engineering` | 50 executables |
| Backend-semantic complete closure | 0/76 | `backend-semantic-equivalence` | 76 executables |
| Exact five-field obligations | 27/135 | `runtime-regression` / `target-runtime-capture` | 108 obligations |
| Official material slots stage-source-bound | 46,810/58,057 | `shader-reverse-engineering` | 11,247 slots |
| Renderer-pipeline parity | `not-proven` | `runtime-pipeline-research` | guest runtime and backend equivalence remain open |
| Visual parity | `unmeasured` | `excluded-by-policy` | 0 automated work units |

These counts come from the hash-pinned official AssetBundle/Shader proof graph and selector port contract.
The four-card runtime evidence is intentionally fail-closed after the current source changes and must be
recaptured before runtime fields can regain exact credit. `stage-source-bound` means official SPIR-V identity is
bound to generated source; it does not mean exact Vulkan-to-WebGL instruction semantics.

The renderer-pipeline row is further split into 12 machine-readable stages. Each stage reports
`proven`, `partial`, or `not-proven`, the official artifacts used as evidence, remaining subscopes, and
a relative advancement cost. A complete official shader program does not promote its surrounding
sampler, render-target, camera, timing, or postprocess stages.

## Shader evidence levels

- `E0 dispatch-only`: the layer is recognized and rendered, with no official-bytecode equivalence claim.
- `E1 partial-bytecode-guard`: a hand port is checked against selected constants, expressions, outputs,
  or control-flow invariants from official bytecode. Unchecked shader behavior remains unknown.
- `E2 transpiled-official-program`: a SPIRV-Cross program derived from the official shader is present and
  structurally bound to runtime inputs. WebGL adaptation and the surrounding pipeline can still change
  its output.

`E2` is stronger source evidence than `E1`; neither is a visual-fidelity score and neither proves exact
official pixels by itself.

## Pipeline and visual states

Pipeline parity is `not-proven` until every shared stage has official-runtime evidence: texture color
space, alpha convention, sampler state, render-target format, MRT routing, blend/stencil/depth state,
precision, camera transforms, animation timing, bloom, tone mapping, and final display transfer.
Repository audits can prevent assumptions from drifting, but an assertion about our own code is not
proof of the official runtime.

Visual parity is:

- `unmeasured`: no official comparison capture exists;
- `qualitative-only`: an uncontrolled photo or screenshot helps diagnose appearance but cannot produce a score;
- `controlled-layer`: fixed-pose, fixed-time official captures exist for individual layers;
- `controlled-final`: the final composite is compared over the required pose/time matrix.

A controlled capture records game version, card and asset revision, device/render backend, resolution,
camera pose, animation time, locale, and whether the image was captured before or after display
processing. Metric thresholds must be derived from repeated-capture variance and documented; they must
not be chosen because a particular implementation happens to pass.

## Project claim rule

The project may claim a card is “official-output validated” only when source provenance is complete,
all visible layers have declared shader evidence, shared pipeline parity is proven, and controlled final
comparisons pass across the declared pose/time matrix. The weakest dimension determines the card's
status. Missing evidence is reported as unknown, never estimated into a percentage.

Run the current evidence report with:

```bash
npm run report:evidence
npm run report:evidence -- --json
```

The report deliberately returns `gameFidelity.score: null` while pipeline parity or controlled visual
parity is missing.

## Automated official-equivalence audit

The automatic audit uses official assets, material configuration, shader bytecode, and runtime wiring.
Screenshots and image-derived thresholds are intentionally excluded because capture timing, camera,
backend, exposure, and display processing make them unstable evidence.

```bash
npm run audit:official-equivalence
npm run audit:official-player-pipeline
npm run audit:official-texture-samplers
npm run test:texture-upload-runtime
npm run audit:official-texture-payload
npm run test:texture-mip-runtime
npm run audit:official-animation-timing
npm run audit:official-android-lifecycle
npm run audit:official-postprocess
npm run audit:official-bloom-program
npm run audit:official-bloom-runtime
npm run audit:official-final-blit
npm run audit:official-display-transfer
npm run test:display-transfer-runtime
npm run audit:official-shader-precision
npm run test:shader-precision-runtime
npm run test:official-touch-rotation
npm run test:official-clock
npm run audit:official-pass-partition
npm run audit:official-draw-state
npm run audit:official-camera-transform
npm run audit:official-card-renderer
npm run audit:official-rendertexture-contract
npm run audit:official-homography
npm run audit:exact-homography
npm run test:homography-runtime
npm run audit:official-mrt-outputs
npm run audit:exact-ur-lens-flare
npm run test:runtime
node build/audit-official-equivalence.mjs --json
```

The command runs the complete static audit matrix and reports dispatch coverage, transpiled official
program coverage, partial bytecode-guard coverage, and advancement cost as separate dimensions. It also reports renderer
pipeline parity as `not-proven` while official runtime evidence is incomplete, and visual parity as
`unmeasured`. A passing command means the declared source/data/bytecode invariants hold; it does not
mean the final image has a numeric fidelity score.

The sampler, animation, and postprocess commands extract their evidence from official serialized
objects, native ARM64 code, and shader bytecode. `test:runtime` loads all four reference scenes in one
browser process, advances deterministic frames, and checks console, network, and mesh counts without
capturing screenshots.

`test:texture-upload-runtime` uses the renderer's shared `HTMLImageElement -> THREE.Texture` loader and
an asymmetric 2x2 PNG. A raw WebGL2 shader and `readPixels` verify exact RGBA bytes after browser decode,
upload, sampling, and render-target storage, including nonzero RGB at alpha zero, straight RGB at partial
alpha, and texture Y orientation. It takes no screenshots. This proves the selected Chromium/SwiftShader
browser path; it does not by itself prove Android's native texture upload implementation.

The texture-payload audit identifies all 131 Texture2D objects by bundle, PathID, object hash, and payload
hash. Four stored mip chains (38 levels, 11.2 MB decoded RGBA8) are generated from official payloads,
uploaded explicitly with `generateMipmaps=false`, and verified level-by-level through `textureLod` GPU
readback. Target-device ASTC/ETC hardware decoding and anisotropy remain device-dependent.

The display-transfer audits pin the official Vulkan/Gamma surface-format policy and verify the browser's
RGBA8/linear-attachment/sRGB/opaque-alpha compositor input with numeric readback. The Android device's
actual swapchain choice and both platforms' compositor, OS color management, and panel output remain
runtime device state; the report intentionally marks that final sub-scope `not-observable` here.

The precision audit pins 14 official SPIR-V programs: all numeric types are Float32, 3,653 results are
decorated `RelaxedPrecision`, and there are no Float16 types, `OpQuantizeToF16`, `NoContraction`, or
float-control execution modes. Glitter now preserves the official mixed mediump/highp qualifiers. The
SwiftShader numeric probe observes FP32-like mediump promotion, which is explicitly backend-conditional;
Adreno/Mali behavior still requires target-device probes.

Touch and animation timing are now modeled from native evidence rather than pointer position heuristics:
incremental drag accumulation, `qY * qX`, roll removal, the 30-degree clamp, release hold, full-hierarchy
Glitter `transform.forward`, shared scaled `_Time`, `maximumDeltaTime`, and suspend/resume all have numeric
tests. The Android lifecycle audit maps eight official Unity symbols back to the game `libunity`: pause enters
`UnityPause(1)`, resume defers through `UnityPause(0)`, and the next `UnityPlayerLoop` completes
`SetPlayerPause(0,true)`. The browser visibility adapter and zero-delta resumed frame are tested separately,
so animation timing is now proven for the renderer scope.

The Bloom audits pin all six official SPIR-V programs, the five-level render-target graph, float32
atlas layout and weights, blur order, and fixed-function blend state. The FinalBlit audit follows the
official ResourceManager → Material → Shader chain, pins the mip-0 `textureLod` presentation pass, and
uses an asymmetric 2×2 GPU draw/readback fixture to verify the paired Vulkan-to-WebGL Y adaptation.
Pinned ARM64 constructors and `CommandBuffer.GetTemporaryRT` overloads prove that the scene path requests
two ARGB32 color targets plus Depth24 and uses Point filtering. Bloom intermediates request ARGB32,
Linear read/write, Bilinear filtering, Depth0, MSAA1, volume depth 1, and no memoryless mode. The browser
maps these requests to explicit RGBA8/unsigned-byte targets, Nearest or Linear filtering as appropriate,
and no Bloom depth or multisampling. That tested WebGL2 mapping is not evidence for the physical Vulkan
color/depth formats selected by Unity's device-specific `GetCompatibleFormat`; those remain unproven.
The generated RenderTexture contract now pins the selection algorithm itself: Gamma `ARGB32 -> GF8`,
conditionally `VK_FORMAT_R8G8B8A8_UNORM`, and `Depth24 -> GF92/GF94` through the official 152-entry
capability table. Unity top-origin, Homography sampling, and FinalBlit `1-v` are separated from the
target device's actual VkFormat, stencil aspects, image layout, and per-pass VkViewport.
Pass 5 binds the scene MRT directly and additively writes ColorRT; its WebGL2 adaptation emits zero to
the still-active EmissiveRT attachment, which is a no-op under the official shared blend state. The
Bloom program/graph stage is therefore `proven (8/8)` in the report, while render-target formats and the
whole renderer pipeline remain `partial` and `not-proven`, respectively.

The MRT-output audit follows official prefab Material PPtrs and complete keyword sets to the selected
Vulkan programs. It proves which shaders write location 1 and their RT1 replace state. The pass-partition
audit pins the official opaque/transparent renderer events, queue ranges, sorting criteria, MRT/depth
bindings, and ShaderTag order. The screenshot-free legacy Eevee Bag Vulkan capture contains three submitted matching
23-draw scopes and byte-identifies all 23 vertex+fragment+specialization programs. Nineteen draw identities are
unique; one Frame-Holo pair and one LensFlare pair remain unresolved. It also selects the `INSTANCING_ON` Side&Back
modules used by the generated WebGL2 program. The capture predates the manifest schema, so game/device/GPU/driver
provenance remains incomplete and MRT routing stays `partial`; it also does not prove uncaptured RR, SR, Pokemon UR,
or target-device physical formats.

Draw ordering remains a separate high-cost `partial` stage. Direct APKM/native-byte auditing now pins
Unity's `CommonOpaque`/`CommonTransparent` criteria, Float32 distance-key arithmetic,
`QuantizedFrontToBack` most-significant-byte bucket, raw `OptimizeStateChanges` branches, transparent ties,
and final visible-node/draw-candidate tie-break. `audit:official-reference-sort-inputs` independently decodes
the four official L prefab bundles, pins their raw `MeshRenderer` object hashes, and checks every generated
scene sort descriptor. Generated scenes now carry a 94-draw identity table: each active draw is tied to its
official Renderer, Material, Shader, and Mesh `CAB:pathID`, while all 84 material rows preserve raw queue,
instancing, and valid/invalid keyword state. `audit:official-material-sort-inputs` independently reopens the
official Face/CardNew Common/Shader bundles and verifies those 84 rows against 69 serialized Materials and
26 serialized Shaders, without consuming recipe output. Production sorting now uses the official distance/bucket prefix and the native-zero
distance offset proved for these `MeshRenderer` nodes. `audit:official-pass-candidates` independently follows
the official prefab Material PPtrs and Shader assets, proving that all 98 reference draws have selected pass
index 0 and candidate ordinal 0. `audit:official-srp-batcher` combines the official native return paths with
compiled Shader reflection and proves all 26 canonical Shaders are incompatible, so all 94 active draw bits are
zero. `audit:official-local-keyword-state` pins six official/game native functions, independently reconstructs
the serialized keyword bitset in Shader `m_KeywordNames` order, and applies the official XXH32 seed. It verifies
all 84 scene rows against 69 canonical Materials, so the final LocalKeywordState hash is no longer an unknown.
Equal-prefix ties still remain approximate. The first unresolved Optimize key is now entry `+0x08`, using the
command-proved hashed Material/Shader formula. Its remaining unknowns are the runtime Material raw byte at
`+0x17c` and Shader Object InstanceID low byte. If that key still ties, these non-static-batched reference draws
next compare packed lightmaps and entry `+0x28`, followed by CanvasOrder, the compacted RenderNodeQueue slot used
as VisibleNodeIndex, and candidate ordinal. The read-only probe captures and formula-checks that complete suffix.
The same raw-prefab audit proves all 78 reference MeshRenderers are non-static-batched, use `65535/65535`
static/dynamic lightmap indices, and belong to prefabs with no `LODGroup`. The official bundle extractor now
carries those fields, material slot, and native-zero Canvas order/LOD fade into every scene sort descriptor.
The extractor also resolves serialized Mesh identities into 7/7/9/9 equivalence classes for the four cards and
proves that all renderers use the native no-SortingGroup key `0xfffff000`. These facts collapse every
pre-Optimize transparent tie key to a known constant, but do not determine the runtime identity values above.
`audit:official-sort-input-producers` pins the native construction path separately: 20 official producer/helper
symbol identities, 107 exact AArch64 load/store/pack/control-flow instructions, all regular
Renderer entry and RenderNode offsets used by the comparator, the non-LOD native zero relocation, and the
separate BRG formula. The constructor chain also proves that `MeshRenderer` passes `RendererType=1`, stores it
in the low six bits of `Renderer+0x128`, and copies it to `RenderNode+0xe8`. Unknown private C++ member names
remain raw offset names instead of being guessed.
`audit:official-instance-id-remapper` pins 136 additional AArch64 instructions across Unity's official release
binary and the shipped game. It proves both ordinary and contiguous InstanceID allocation formulas and the
propagation into `Object+0x08`. It also proves the static boundary: `CAB:pathID` lacks the live Remapper base,
prior unique-key history, duplicate hits, and load mode/order, so it cannot independently recover the low byte.
`audit:official-sort-command-branch` pins the official `DrawOpaquePass.Execute` and
`DrawTransparentPass.Execute` command setup and proves both passes set branch selector 0, selecting the hashed
Material/Shader state-key formula at entry `+0x08`.
`audit:official-unity-symbol-map` additionally maps the game functions to the public symbols shipped in
Unity's official Android Build Support package. The complete comparator and distance functions match byte
for byte as `RenderObjectSorter::operator()` and `ComputeSortingDistance`; relocated functions are guarded
by unique instruction prefixes, exact symbol starts, and exact symbol sizes.
`audit:official-sort-prefix-collisions` parses the four canonical GLBs and scene sort descriptors without a
renderer. It currently finds 17 stable collision groups covering 36 draws. Its per-field decision table proves
that all 14 opaque and 3 transparent groups reach `OptimizeStateChanges`, tie on RendererType, LOD fade,
static-batch gate, packed lightmaps, and the official SRP-compatibility bit 0. Their first unresolved field is
entry `+0x08`, on the proved hashed branch. The recovered keyword hashes classify the groups into 6 that need
only Material `+0x17c`, 3 that share a Shader but need its InstanceID, and 8 that involve distinct Shaders
(and need Material `+0x17c` only if their top bytes tie).
`audit:official-sort-runtime-capture-tool` statically pins the read-only Frida probe to three PTCGP 1.6.0
`libunity.so` functions and six hook instruction words. Running that probe still requires a rooted arm64 test
device with matching ADB/Frida. The strict importer binds every row to one session and release, recomputes both
native packed keys, ignores unrelated screen draws, and preserves ambiguous Renderer candidates. Its synthetic
failure/success matrix is part of the no-browser audit, but no synthetic row is treated as official evidence.
No device capture is treated as evidence yet. Static PPtr
identities are retained for runtime-capture correlation but are never used as a substitute sort order.
The generated 17-group/36-draw collision manifest is checked back against the static audit. The browser-side
resolver requires the artifact's exact scene SHA-256 and enables the captured native suffix atomically per
complete group. Its object comparator matches the raw native entry/node comparator across 20,000 deterministic
opaque/transparent pairs; partial groups never mix captured and fallback keys.

Fixed-function draw state is audited separately without screenshots. Representative official opaque,
transparent, CullOff, stencil, and shared-MRT draws are intercepted at their actual WebGL2 draw calls;
queried state and framebuffer probes currently pass 98/98 assertions. This audit found and guards the
three.js `stencilWriteMask` mapping, including the official non-default mask value `4`. The 98 assertions
cover those selected draws on three.js r165 under Chromium/SwiftShader; they do not prove every material,
native Unity/Vulkan state, draw ordering, shader math, or final-card visual parity.

The official `Prerender/Homography(from RT)` vertex/fragment programs are also regenerated from Vulkan
SPIR-V. Their H/Hinv `float[9]` bindings, IL2CPP producers/uploads, material state, and
`alpha = 1 - sampled.a` formula are pinned. The browser H/Hinv helpers preserve the audited ARM64 Float32
operation order and pass bit-pattern/runtime cases for identity, convex, degenerate, and near-degenerate
inputs. Official IL2CPP also proves the `_clampParallax` material branch, source-only touch root, and the
CardRenderer RT to `_DynamicUITex` property-block path. Four pinned prefabs and 98 material references prove
the producer RT0 alpha classes and remaining-transmission contract. `public/app.js` now runs an official
quality-profile source MRT/camera (High 1403, Middle 1122, or Low 982), exact Bloom, projected keypoints,
exact Homography into a two-attachment display
target, and exact FinalBlit presentation. Runtime probes verify both MRT stages are nonblank, the display Quad
stays unrotated, and the keypoint order is not reflected. Native RenderTexture physical Y, per-draw
`_TextureSampleAdd`, physical texture format, and target-device compositor/OS/panel transfer remain
unproven, so the whole renderer is still not byte-complete.

The camera audit pins the official local -Z camera, distance/FOV, parent `Ry(180°)`, render layer 21,
keypoint square/order, accumulated drag-delta `qY * qX` touch rotation (direct native `acosf`), and the
30-degree quaternion clamp. The ordinary `CommonUICardDetailCard` serialized
component has `_cardSize=6`, which the official table maps to `CardSizeType.Large` (734×1024). With the
ordinary Android default quality `Middle=0.8`, the official square source-RT formula yields `1122×1122`;
`561×561` is only the counterfactual result for `Medium`, not the detail-view size. A persisted runtime
quality override is still device state. The browser defaults to display-driven `auto`, which derives a source
RT no smaller than the physical drawing buffer to avoid an extra desktop upscale; this inspection-only size is
not capture evidence. `quality=middle` reproduces the captured 1122-square source RT, while High and Low retain
their exact official fixed sizes. All
profiles retain the aspect-1 source camera. The same ordinary component has
`_useGyro=false`, so the browser intentionally
does not activate device gyro for this view. The generated `card-display-contract.json` collects the
official square RT, camera, clear/alpha, keypoint, and display-mode facts without hand-tuned constants.
Unknowns in the generic enabled-gyro path do not block the ordinary detail path. Native RT physical Y remains
a render-target/backend boundary rather than an unimplemented ordinary-detail camera transform.

`audit:official-player-pipeline` reads `globalgamemanagers` and ARM64 `libil2cpp.so` directly from the
official APKM (override its path with `PCR_APKM`). It currently proves the Unity Gamma workflow, HDR and
quality state, and the card render-target constructor. This research audit needs Python packages
`UnityPy` and `capstone`; derived recipes are not accepted as authority.
