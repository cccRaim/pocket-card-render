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
programs cover 26 of 64 reference layers.” That number must not be renamed, averaged, or presented as
“game fidelity.”

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
node build/audit-official-equivalence.mjs --json
```

The command runs the complete static audit matrix and reports dispatch coverage, transpiled official
program coverage, and partial bytecode-guard coverage as separate dimensions. It also reports renderer
pipeline parity as `not-proven` while official runtime evidence is incomplete, and visual parity as
`not-evaluated`. A passing command means the declared source/data/bytecode invariants hold; it does not
mean the final image has a numeric fidelity score.
