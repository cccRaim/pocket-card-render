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

Percentages are allowed only for coverage within a named dimension, for example “transpiled official
programs cover 64 of 64 reference layers.” That number must not be renamed, averaged, or presented as
“game fidelity.”

## Advancement cost

Cost is reported as a work class plus remaining scope, never as an unsupported calendar estimate:

- `maintenance`: the dimension is complete for the current reference scope; only regression upkeep remains.
- `renderer-integration`: missing layer dispatch or runtime binding work.
- `source-tracing-and-bytecode-audit`: official provenance or bytecode evidence is missing.
- `shader-reverse-engineering`: extract/decompile an official program, recover bindings, port it, and add guards.
- `runtime-pipeline-research`: establish shared official-runtime behavior such as formats, MRT, precision, or display transfer.
- `excluded-by-policy`: deliberately outside automatic auditing.

For the current 64-layer reference scope, the report produces:

| Dimension | Current state | Advancement cost | Remaining scope |
|---|---:|---|---:|
| Layer dispatch | 64/64 | `maintenance` | 0 layers |
| Transpiled official programs | 64/64 | `maintenance` | 0 layers |
| Promote partial guards from E1 to E2 | 0 E1 layers | `maintenance` | 0 layers |
| Any official source evidence | 64/64 | `maintenance` | 0 layers |
| Renderer-pipeline parity | `not-proven` | `runtime-pipeline-research` | 11 shared stages affecting all 64 layers |
| Visual parity | `unmeasured` | `excluded-by-policy` | 0 automated work units |

The counts are generated from the loaded reference scenes. Adding scenes or promoting a shader changes
them automatically in `report:evidence` and `audit:official-equivalence`.

The renderer-pipeline row is further split into 11 machine-readable stages. Each stage reports
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
npm run audit:official-animation-timing
npm run audit:official-postprocess
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

The MRT-output audit follows official prefab Material PPtrs and complete keyword sets to the selected
Vulkan programs. It proves which shaders write location 1 and their RT1 replace state; the browser still
reports MRT routing as partial until both attachments are written in the same draw with indexed blending.

`audit:official-player-pipeline` reads `globalgamemanagers` and ARM64 `libil2cpp.so` directly from the
official APKM (override its path with `PCR_APKM`). It currently proves the Unity Gamma workflow, HDR and
quality state, and the card render-target constructor. This research audit needs Python packages
`UnityPy` and `capstone`; derived recipes are not accepted as authority.
