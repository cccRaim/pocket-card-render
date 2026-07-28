// Evidence-backed restoration score for the canonical renderer scope.
//
// This is deliberately not an image-similarity score. The denominator is a
// versioned set of renderer obligations. Unknown and target-runtime-only work
// remains in the denominator, and only exact evidence contributes to the
// primary score.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { buildEvidenceReport } from "./report-renderer-evidence.mjs";
import { auditTmpRuntimeEvidence } from "./audit-tmp-runtime-evidence.mjs";
import { auditFullRuntimeEvidence } from "./audit-full-runtime-evidence.mjs";
import { auditOfficialInlineElements } from "./audit-official-inline-elements.mjs";
import { auditOfficialTmpSprite } from "./audit-official-tmp-sprite.mjs";
import { auditOfficialTmpFallback } from "./audit-official-tmp-fallback.mjs";
import { auditOfficialTmpAutoSize } from "./audit-official-tmp-autosize.mjs";
import { auditOfficialTmpGlyphQuad } from "./audit-official-tmp-glyph-quad.mjs";
import { auditRuntimeDisplayFidelity } from "./audit-runtime-display-fidelity.mjs";
import { auditOfficialRuntimeQuality } from "./audit-official-runtime-quality.mjs";
import {
  CANONICAL_FULL_RUNTIME_SCENES,
  CANONICAL_LOCALIZED_TEXT_FILES,
} from "./full-runtime-sources.mjs";
import { officialSample } from "./official-sample.mjs";
import {
  evaluatePipelineProof,
  validatePipelineProofGraph,
} from "./restoration-proof-graph.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFINITION_VERSION = 34;
const STATUS = new Set(["exact", "partial-exact", "inferred", "runtime-required", "missing", "unknown"]);
const CANONICAL_SCENES = CANONICAL_FULL_RUNTIME_SCENES.map(({ file }) => file);
const PIPELINE_PROOF_NODES = validatePipelineProofGraph({
  "texture-color-space": [
    {
      id: "pipeline.texture-color-space.official-active-color-space",
      verifiers: ["official-player-pipeline"],
      evidence: "official PlayerSettings active color-space extraction",
    },
  ],
  "alpha-convention": [],
  "sampler-state": [
    {
      id: "pipeline.sampler-state.serialized-texture-state",
      verifiers: ["official-texture-samplers", "official-texture-payload"],
      evidence: "official serialized sampler fields joined to official texture payloads",
    },
  ],
  "render-target-formats": [
    {
      id: "pipeline.render-target-formats.official-allocation-contract",
      verifiers: ["official-postprocess"],
      evidence: "official render-target allocation and postprocess descriptor contract",
    },
  ],
  "mrt-routing": [
    {
      id: "pipeline.mrt-routing.official-attachment-contract",
      verifiers: ["official-postprocess", "official-mrt-outputs"],
      evidence: "official dual-attachment routing and fragment output contract",
    },
    {
      id: "pipeline.mrt-routing.material-output-inventory",
      verifiers: ["official-mrt-outputs", "official-draw-coverage"],
      evidence: "official material output-location inventory for the canonical draw corpus",
    },
  ],
  "draw-order": [
    {
      id: "pipeline.draw-order.pass-partition",
      verifiers: ["official-pass-partition"],
      evidence: "official opaque/transparent pass partition",
    },
    {
      id: "pipeline.draw-order.serialized-sort-inputs",
      verifiers: [
        "official-material-sort-inputs",
        "official-reference-sort-inputs",
        "official-pass-candidates",
      ],
      evidence: "official serialized material/reference sort inputs and pass candidates",
    },
    {
      id: "pipeline.draw-order.srp-branch",
      verifiers: ["official-srp-batcher"],
      evidence: "official SRP-batcher compatibility branch",
    },
  ],
  "blend-stencil-depth": [
    {
      id: "pipeline.blend-stencil-depth.official-pass-state",
      verifiers: ["official-pass-partition", "official-program-port-coverage"],
      evidence: "official pass state attached to selector-bound executable ports",
    },
  ],
  "shader-precision": [
    {
      id: "pipeline.shader-precision.official-program-qualifiers",
      verifiers: ["official-shader-precision"],
      evidence: "official SPIR-V precision qualifier and opcode audit",
    },
  ],
  "camera-transforms": [
    {
      id: "pipeline.camera-transforms.official-card-transform",
      verifiers: ["official-camera-transform"],
      evidence: "official camera, root and homography transform extraction",
    },
    {
      id: "pipeline.camera-transforms.official-touch-rotation",
      verifiers: ["official-touch-rotation"],
      evidence: "official touch quaternion order and clamp extraction",
    },
  ],
  "animation-timing": [
    {
      id: "pipeline.animation-timing.official-clock",
      verifiers: ["official-animation-timing"],
      evidence: "official animation timing and material clock contract",
    },
    {
      id: "pipeline.animation-timing.android-pause-chain",
      verifiers: ["official-android-lifecycle"],
      evidence: "official Android pause-to-player-loop chain",
    },
    {
      id: "pipeline.animation-timing.kira-puyo",
      verifiers: ["official-kira-puyo"],
      evidence: "official Kira/Puyo timing and parameter extraction",
    },
    {
      id: "pipeline.animation-timing.circular-kira-trail",
      verifiers: ["official-circular-kira", "circular-kira-state"],
      evidence: "hash-pinned CircularKira UpdateTrailParams ARM64 control flow and float32 state vectors",
    },
    {
      id: "pipeline.animation-timing.card-future-object",
      verifiers: ["official-card-future"],
      evidence: "hash-pinned CardFutureObject ARM64 state transition, serialized component and renderer binding",
    },
  ],
  "bloom-tone-mapping": [
    {
      id: "pipeline.bloom-tone-mapping.hdr-gamma-policy",
      scopeId: "hdr-gamma-policy",
      claimVerifier: "official-player-pipeline",
      verifiers: ["official-player-pipeline", "official-postprocess"],
      evidence: "official Gamma/HDR-disabled policy and Bloom composition without an extra tone-map stage",
    },
    {
      id: "pipeline.bloom-tone-mapping.official-pass-graph",
      scopeId: "official-pass-program",
      claimVerifier: "official-bloom-program",
      verifiers: ["official-bloom-program", "official-postprocess"],
      evidence: "official six-pass Bloom program bytes, bindings, state and native execution graph",
    },
    {
      id: "pipeline.bloom-tone-mapping.serialized-config-sizing",
      scopeId: "serialized-config-sizing",
      claimVerifier: "official-postprocess",
      verifiers: ["official-postprocess"],
      evidence: "official BloomVolume values and hash-pinned ARM64 buffer/sheet sizing",
    },
    {
      id: "pipeline.bloom-tone-mapping.generated-webgl-artifacts",
      scopeId: "generated-webgl-artifacts",
      claimVerifier: "exact-bloom",
      verifiers: [
        "official-bloom-program",
        "exact-bloom",
        "exact-final-blit",
        "final-blit-backend-proof",
        "final-blit-backend-proof-mutations",
      ],
      evidence: "current-sample-bound Bloom and FinalBlit WebGL source artifact identity",
    },
    {
      id: "pipeline.bloom-tone-mapping.material-mrt-inputs",
      scopeId: "material-mrt-inputs",
      claimVerifier: "official-mrt-outputs",
      verifiers: ["official-mrt-outputs", "bloom-activation", "official-program-port-coverage"],
      evidence: "official per-material MRT bloom inputs and selector-bound activation routing",
    },
    {
      id: "pipeline.bloom-tone-mapping.canonical-runtime-lifecycle",
      scopeId: "canonical-runtime-lifecycle",
      claimVerifier: "bloom-pipeline-proof",
      verifiers: [
        "bloom-pipeline-proof",
        "bloom-pipeline-proof-mutations",
        "full-runtime-evidence",
      ],
      evidence: "source-current four-card WebGL pass sequence, target layout, weights and error-free lifecycle",
    },
  ],
  "display-transfer": [
    {
      id: "pipeline.display-transfer.official-color-policy",
      verifiers: ["official-player-pipeline"],
      evidence: "official active color-space and display policy",
    },
    {
      id: "pipeline.display-transfer.final-blit-contract",
      verifiers: ["official-postprocess"],
      evidence: "official FinalBlit program and postprocess transfer contract",
    },
  ],
});
const VERIFIERS = [
  ["restoration-proof-graph", process.execPath, "build/test-restoration-proof-graph.mjs"],
  ["claim-contract", process.execPath, "build/audit-render-claim-contract.mjs"],
  ["official-player-pipeline", process.execPath, "build/audit-official-player-pipeline.mjs"],
  ["official-texture-samplers", process.execPath, "build/audit-official-texture-sampler.mjs"],
  ["official-postprocess", process.execPath, "build/audit-official-postprocess.mjs"],
  ["official-animation-timing", process.execPath, "build/audit-official-animation-timing.mjs"],
  ["official-android-lifecycle", process.execPath, "build/audit-official-android-lifecycle.mjs"],
  ["official-shader-precision", process.execPath, "build/audit-official-shader-precision.mjs"],
  ["official-shader-toolchain", process.execPath, "build/audit-official-shader-toolchain.mjs"],
  ["official-smolv-corpus", process.execPath, "build/audit-official-smolv-corpus.mjs"],
  ["official-kira-puyo", process.execPath, "build/audit-official-kira-puyo.mjs"],
  ["official-circular-kira", process.execPath, "build/audit-official-circular-kira.mjs"],
  ["official-card-future", process.execPath, "build/audit-official-card-future.mjs"],
  ["circular-kira-state", process.execPath, "build/test-circular-kira.mjs"],
  ["bloom-activation", process.execPath, "build/test-bloom-activation.mjs"],
  ["official-bloom-program", process.execPath, "build/audit-official-bloom-program.mjs"],
  ["exact-bloom", process.execPath, "build/build-exact-bloom.mjs", { PCR_EXACT_CHECK: "1" }],
  ["exact-final-blit", process.execPath, "build/build-exact-final-blit.mjs", { PCR_EXACT_CHECK: "1" }],
  ["final-blit-backend-proof", process.execPath, "build/audit-final-blit-backend-proof.mjs"],
  ["final-blit-backend-proof-mutations", process.execPath, "build/test-final-blit-backend-proof.mjs"],
  ["bloom-pipeline-proof", process.execPath, "build/audit-bloom-pipeline-proof.mjs"],
  ["bloom-pipeline-proof-mutations", process.execPath, "build/test-bloom-pipeline-proof.mjs"],
  ["official-pass-partition", process.execPath, "build/audit-official-pass-partition.mjs"],
  ["official-material-sort-inputs", process.execPath, "build/audit-official-material-sort-inputs.mjs"],
  ["official-reference-sort-inputs", process.execPath, "build/audit-official-reference-sort-inputs.mjs"],
  ["official-srp-batcher", process.execPath, "build/audit-official-srp-batcher.mjs"],
  ["official-material-properties", process.execPath, "build/audit-official-material-properties.mjs"],
  ["official-local-keyword-state", process.execPath, "build/audit-official-local-keyword-state.mjs"],
  ["official-pass-candidates", process.execPath, "build/audit-official-pass-candidates.mjs"],
  ["official-camera-transform", process.execPath, "build/audit-official-camera-transform.mjs"],
  ["display-density-integration", process.execPath, "build/test-display-density-integration.mjs"],
  ["official-card-font-contract", process.execPath, "build/audit-official-card-font-contract.mjs"],
  ["official-card-text-design", process.execPath, "build/build-official-card-text-design-contract.mjs", { PCR_CARD_TEXT_DESIGN_CHECK: "1" }],
  ["card-text-design-unicode", process.execPath, "build/test-card-text-design-unicode.mjs"],
  ["official-text-variant-corpus", process.execPath, "build/build-official-text-variant-corpus.mjs", { PCR_OFFICIAL_TEXT_VARIANT_CORPUS_CHECK: "1" }],
  ["official-text-variant-corpus-mutations", process.execPath, "build/test-official-text-variant-corpus.mjs"],
  ["official-text-variant-execution", process.execPath, "build/test-official-text-variant-execution.mjs"],
  ["official-card-examples", process.execPath, "build/build-official-card-examples.mjs", { PCR_OFFICIAL_CARD_EXAMPLES_CHECK: "1" }],
  ["official-card-example-mutations", process.execPath, "build/test-official-card-examples.mjs"],
  ["official-card-example-materialization", process.execPath, "build/test-materialize-official-card-examples.mjs"],
  ["rarity-rendering-completeness", process.execPath, "build/audit-rarity-rendering-completeness.mjs"],
  ["rarity-rendering-completeness-mutations", process.execPath, "build/test-rarity-rendering-completeness.mjs"],
  ["official-card-ui-layout", process.execPath, "build/build-official-card-ui-layout.mjs", { PCR_CARD_UI_LAYOUT_CHECK: "1" }],
  ["dynamic-ui-layout", process.execPath, "build/audit-dynamic-ui-layout.mjs"],
  ["official-ugui-image-state", process.execPath, "build/audit-official-ugui-image-state.mjs"],
  ["official-ugui-resources", process.execPath, "build/audit-official-ugui-resources.mjs"],
  ["official-ugui-runtime-state", process.execPath, "build/audit-official-ugui-runtime-state.mjs"],
  ["official-card-corpus", process.execPath, "build/audit-official-card-corpus.mjs"],
  ["official-illustration-inventory", process.execPath, "build/audit-official-illustration-inventory.mjs"],
  ["official-shader-variant-selection", process.execPath, "build/audit-official-shader-variant-selection.mjs"],
  ["official-material-program-inventory", process.execPath, "build/audit-official-material-program-inventory.mjs"],
  ["official-program-port-contract", process.execPath, "build/build-official-program-port-contract.mjs", { PCR_PROGRAM_PORT_CONTRACT_CHECK: "1" }],
  ["official-program-port-generators", process.execPath, "build/audit-official-program-port-generators.mjs"],
  ["webgl-adaptation-contract-mutations", process.execPath, "build/test-webgl-adaptation-contract.mjs"],
  ["ui-affine-transform-integration", process.execPath, "build/test-ui-affine-transform-integration.mjs"],
  ["ugui-state-reducer", process.execPath, "build/test-ugui-state-reducer.mjs"],
  ["ugui-state-replay-integration", process.execPath, "build/test-ugui-state-replay-integration.mjs"],
  ["official-layout-fitters", process.execPath, "build/build-official-layout-fitters.mjs", { PCR_OFFICIAL_LAYOUT_FITTERS_CHECK: "1" }],
  ["layout-fitter-mutations", process.execPath, "build/test-layout-fitters.mjs"],
  ["layout-rebuilder-mutations", process.execPath, "build/test-layout-rebuilder.mjs"],
  ["webgl-runtime-port-contract-mutations", process.execPath, "build/test-webgl-runtime-port-contract.mjs"],
  ["dynamic-uniform-producer-mutations", process.execPath, "build/test-dynamic-uniform-producer.mjs"],
  ["webgl-adaptation-contract", process.execPath, "build/audit-webgl-adaptation-contract.mjs"],
  ["official-program-port-coverage", process.execPath, "build/audit-official-program-port-coverage.mjs"],
  ["official-vertex-input-mutations", process.env.PYTHON || "python", "build/test_official_vertex_inputs.py"],
  ["official-vertex-inputs", process.env.PYTHON || "python", "build/audit_official_vertex_inputs.py"],
  ["official-mesh-vertex-binding-mutations", process.env.PYTHON || "python", "build/test_official_mesh_vertex_bindings.py"],
  ["official-mesh-vertex-bindings", process.env.PYTHON || "python", "build/audit_official_mesh_vertex_bindings.py"],
  ["exact-shader-port-selection", process.execPath, "build/test-exact-shader-port-selection.mjs"],
  ["official-pass-state", process.execPath, "build/test-official-pass-state.mjs"],
  ["unity-parameter-entry-parser", process.env.PYTHON || "python", "build/test_unity_parameter_entry.py"],
  ["runtime-source-identity", process.execPath, "build/test-runtime-source-identity.mjs"],
  ["official-locale-coverage", process.execPath, "build/audit-official-locale-coverage.mjs"],
  ["official-card-text-runtime", process.execPath, "build/audit-official-card-text-runtime.mjs"],
  ["card-text-resolver", process.execPath, "build/test-card-text-resolver.mjs"],
  ["carddata-corpus", process.execPath, "build/test-carddata-corpus.mjs"],
  ["compose-corpus", process.execPath, "build/test-compose-corpus.mjs"],
  ["official-inline-elements", process.execPath, "build/audit-official-inline-elements.mjs"],
  ["official-tmp-sprite-contract", process.execPath, "build/build-official-tmp-sprite.mjs", { PCR_TMP_SPRITE_CHECK: "1" }],
  ["official-tmp-sprite", process.execPath, "build/audit-official-tmp-sprite.mjs"],
  ["official-tmp-sprite-program", process.execPath, "build/build-official-tmp-sprite-program.mjs", { PCR_OFFICIAL_TMP_SPRITE_PROGRAM_CHECK: "1" }],
  ["official-tmp-sprite-program-mutations", process.execPath, "build/test-official-tmp-sprite-program.mjs"],
  ["official-tmp-sprite-runtime", process.execPath, "build/test-official-tmp-sprite-runtime.mjs"],
  ["official-tmp-sprite-layout", process.execPath, "build/test-official-tmp-sprite-layout.mjs"],
  ["official-tmp-settings", process.execPath, "build/build-official-tmp-settings.mjs", { PCR_TMP_SETTINGS_CHECK: "1" }],
  ["official-tmp-fallback", process.execPath, "build/audit-official-tmp-fallback.mjs"],
  ["official-tmp-autosize-contract", process.execPath, "build/build-official-tmp-autosize.mjs", { PCR_TMP_AUTOSIZE_CHECK: "1" }],
  ["official-tmp-autosize", process.execPath, "build/audit-official-tmp-autosize.mjs"],
  ["official-tmp-line-layout-contract", process.execPath, "build/build-official-tmp-line-layout.mjs", { PCR_TMP_LINE_LAYOUT_CHECK: "1" }],
  ["official-tmp-line-layout", process.execPath, "build/audit-official-tmp-line-layout.mjs"],
  ["official-tmp-sdf", process.execPath, "build/audit-official-tmp-sdf.mjs"],
  ["official-tmp-glyph-metrics", "python", "build/audit_official_tmp_glyph_metrics.py"],
  ["official-tmp-fontengine", process.execPath, "build/audit-official-tmp-fontengine.mjs"],
  ["official-tmp-atlas-pixels", "python", "build/audit_official_tmp_atlas_pixels.py"],
  ["official-tmp-atlases", "python", "build/build_official_tmp_atlases.py", { PCR_TMP_ATLAS_CHECK: "1" }],
  ["official-tmp-text-coverage", process.execPath, "build/audit-official-tmp-text-coverage.mjs"],
  ["official-tmp-rich-text", process.execPath, "build/test-official-tmp-rich-text.mjs"],
  ["official-tmp-mesh", process.execPath, "build/audit-official-tmp-mesh.mjs"],
  ["official-tmp-glyph-quad", process.execPath, "build/audit-official-tmp-glyph-quad.mjs"],
  ["tmp-runtime-evidence", process.execPath, "build/audit-tmp-runtime-evidence.mjs"],
  ["full-runtime-evidence", process.execPath, "build/audit-full-runtime-evidence.mjs"],
  ["runtime-display-fidelity", process.execPath, "build/test-runtime-display-fidelity.mjs"],
  ["official-runtime-quality", process.execPath, "build/audit-official-runtime-quality.mjs"],
  ["official-local-field-diff", process.execPath, "build/audit-official-local-field-diff.mjs", { PCR_FIELD_DIFF_SELF_TEST: "1" }],
  ["official-port-renderer-draw-matching", process.execPath, "build/test-official-port-renderer-draw-matching.mjs"],
  ["exact-tmp-sdf", process.execPath, "build/build-exact-tmp-sdf.mjs", { PCR_EXACT_CHECK: "1" }],
  ["exact-ui-default-to-rt", process.execPath, "build/build-exact-ui-default-to-rt.mjs", { PCR_EXACT_CHECK: "1" }],
  ["localized-card-text", process.execPath, "build/prebuild_text.mjs", { PCR_TEXT_CHECK: "1" }],
  ["official-texture-payload", process.execPath, "build/audit-official-texture-payload.mjs"],
  ["official-mesh-payload", process.execPath, "build/audit-official-mesh-payload.mjs"],
  ["official-program-assets", process.execPath, "build/audit-official-program-assets.mjs"],
  ["official-draw-coverage", process.execPath, "build/audit-official-draw-coverage.mjs"],
  ["official-mrt-outputs", process.execPath, "build/audit-official-mrt-outputs.mjs"],
  ["scene-texture-usage", process.execPath, "build/audit-scene-texture-usage.mjs"],
  ["scene-float-usage", process.execPath, "build/audit-scene-float-usage.mjs"],
  ["scene-color-usage", process.execPath, "build/audit-scene-color-usage.mjs"],
  ["official-touch-rotation", process.execPath, "build/audit-official-touch-rotation.mjs"],
  ["exact-ui-default-from-rt", process.execPath, "build/build-exact-ui-default-from-rt.mjs", { PCR_EXACT_CHECK: "1" }],
];
validatePipelineProofGraph(PIPELINE_PROOF_NODES, {
  registeredVerifiers: VERIFIERS.map(([name]) => name),
});

const evidence = buildEvidenceReport();
const pipeline = new Map(evidence.rendererPipelineParity.stages.map((stage) => [stage.id, stage]));
const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const fontContractPath = path.join(ROOT, "public", "render", "card-font-contract.json");
const fontContract = fs.existsSync(fontContractPath)
  ? JSON.parse(fs.readFileSync(fontContractPath, "utf8"))
  : null;
const tmpFontManifestPath = path.join(ROOT, "public", "game", "tmp-fonts", "manifest.json");
const tmpFontManifest = fs.existsSync(tmpFontManifestPath)
  ? JSON.parse(fs.readFileSync(tmpFontManifestPath, "utf8"))
  : null;
const inlineElementAudit = auditOfficialInlineElements();
const tmpSpriteAudit = auditOfficialTmpSprite();
const tmpSpriteProgramAuditResult = spawnSync(
  process.execPath,
  ["build/build-official-tmp-sprite-program.mjs", "--check"],
  {
    cwd: ROOT,
    encoding: "utf8",
    windowsHide: true,
  },
);
const tmpSpriteProgramMutationResult = spawnSync(
  process.execPath,
  ["build/test-official-tmp-sprite-program.mjs"],
  {
    cwd: ROOT,
    encoding: "utf8",
    windowsHide: true,
  },
);
const tmpSpriteProgramAuditPass = tmpSpriteProgramAuditResult.status === 0
  && tmpSpriteProgramMutationResult.status === 0;
const tmpSpriteRuntimeRouteResult = spawnSync(
  process.execPath,
  ["build/test-official-tmp-sprite-runtime.mjs"],
  {
    cwd: ROOT,
    encoding: "utf8",
    windowsHide: true,
  },
);
const tmpSpriteRuntimeRoutePass = tmpSpriteRuntimeRouteResult.status === 0;
const tmpFallbackAudit = auditOfficialTmpFallback();
const tmpAutoSizeAudit = auditOfficialTmpAutoSize();
const tmpGlyphQuadAudit = auditOfficialTmpGlyphQuad();
const tmpLineLayoutAuditResult = spawnSync(process.execPath, ["build/audit-official-tmp-line-layout.mjs"], {
  cwd: ROOT,
  encoding: "utf8",
  windowsHide: true,
});
const tmpLineLayoutAuditPass = tmpLineLayoutAuditResult.status === 0;
const localeCoverageAuditResult = spawnSync(process.execPath, ["build/audit-official-locale-coverage.mjs"], {
  cwd: ROOT,
  encoding: "utf8",
  windowsHide: true,
});
const localeCoverageAuditPass = localeCoverageAuditResult.status === 0;
const materialPropertiesAuditResult = spawnSync(process.execPath, ["build/audit-official-material-properties.mjs"], {
  cwd: ROOT,
  encoding: "utf8",
  windowsHide: true,
});
const materialPropertiesAuditPass = materialPropertiesAuditResult.status === 0;
const uguiImageStateAuditResult = spawnSync(process.execPath, ["build/audit-official-ugui-image-state.mjs"], {
  cwd: ROOT,
  encoding: "utf8",
  windowsHide: true,
});
const uguiImageStateAuditPass = uguiImageStateAuditResult.status === 0;
const uguiResourceAuditResult = spawnSync(process.execPath, ["build/audit-official-ugui-resources.mjs"], {
  cwd: ROOT,
  encoding: "utf8",
  windowsHide: true,
});
const uguiResourceAuditPass = uguiResourceAuditResult.status === 0;
const uguiRuntimeStateAuditResult = spawnSync(process.execPath, ["build/audit-official-ugui-runtime-state.mjs"], {
  cwd: ROOT,
  encoding: "utf8",
  windowsHide: true,
});
const uguiRuntimeStateAuditPass = uguiRuntimeStateAuditResult.status === 0;
const officialLayoutFittersAuditResult = spawnSync(
  process.execPath,
  ["build/build-official-layout-fitters.mjs", "--check"],
  {
    cwd: ROOT,
    encoding: "utf8",
    windowsHide: true,
  },
);
const officialLayoutFittersAuditPass = officialLayoutFittersAuditResult.status === 0;
const layoutFitterMutationResult = spawnSync(
  process.execPath,
  ["build/test-layout-fitters.mjs"],
  {
    cwd: ROOT,
    encoding: "utf8",
    windowsHide: true,
  },
);
const layoutFitterMutationPass = layoutFitterMutationResult.status === 0;
const layoutRebuilderMutationResult = spawnSync(
  process.execPath,
  ["build/test-layout-rebuilder.mjs"],
  {
    cwd: ROOT,
    encoding: "utf8",
    windowsHide: true,
  },
);
const layoutRebuilderMutationPass = layoutRebuilderMutationResult.status === 0;
const illustrationInventoryAuditResult = spawnSync(process.execPath, ["build/audit-official-illustration-inventory.mjs"], {
  cwd: ROOT,
  encoding: "utf8",
  windowsHide: true,
});
const illustrationInventoryAuditPass = illustrationInventoryAuditResult.status === 0;
const programPortGeneratorAuditResult = spawnSync(process.execPath, [
  "build/audit-official-program-port-generators.mjs", "--json",
], {
  cwd: ROOT,
  encoding: "utf8",
  windowsHide: true,
  maxBuffer: 16 * 1024 * 1024,
});
const programPortCoverageResult = programPortGeneratorAuditResult.status === 0
  ? spawnSync(process.execPath, [
    "build/audit-official-program-port-coverage.mjs", "--json",
  ], {
    cwd: ROOT,
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
    env: {
      ...process.env,
      PCR_PROGRAM_PORT_GENERATORS_EXTERNALLY_VERIFIED: "1",
    },
  })
  : {
    status: 1,
    stdout: "",
    stderr: "official program port generator audit failed",
  };
const programPortCoverage = programPortCoverageResult.status === 0
  ? JSON.parse(programPortCoverageResult.stdout)
  : null;
const officialVertexInputAuditResult = spawnSync(process.env.PYTHON || "python", [
  "-B", "build/audit_official_vertex_inputs.py", "--json",
], {
  cwd: ROOT,
  encoding: "utf8",
  windowsHide: true,
  maxBuffer: 16 * 1024 * 1024,
  shell: process.platform === "win32" && !process.env.PYTHON,
});
const officialVertexInputAudit = officialVertexInputAuditResult.status === 0
  ? JSON.parse(officialVertexInputAuditResult.stdout)
  : null;
const officialMeshVertexBindingAuditResult = spawnSync(process.env.PYTHON || "python", [
  "-B", "build/audit_official_mesh_vertex_bindings.py", "--json",
], {
  cwd: ROOT,
  encoding: "utf8",
  windowsHide: true,
  maxBuffer: 64 * 1024 * 1024,
  shell: process.platform === "win32" && !process.env.PYTHON,
});
const officialMeshVertexBindingAudit = officialMeshVertexBindingAuditResult.status === 0
  ? JSON.parse(officialMeshVertexBindingAuditResult.stdout)
  : null;
const PRECOMPUTED_VERIFIER_RESULTS = new Map([
  ["official-tmp-line-layout", tmpLineLayoutAuditResult],
  ["official-locale-coverage", localeCoverageAuditResult],
  ["official-material-properties", materialPropertiesAuditResult],
  ["official-ugui-image-state", uguiImageStateAuditResult],
  ["official-ugui-resources", uguiResourceAuditResult],
  ["official-ugui-runtime-state", uguiRuntimeStateAuditResult],
  ["official-layout-fitters", officialLayoutFittersAuditResult],
  ["layout-fitter-mutations", layoutFitterMutationResult],
  ["layout-rebuilder-mutations", layoutRebuilderMutationResult],
  ["official-illustration-inventory", illustrationInventoryAuditResult],
  ["official-program-port-generators", programPortGeneratorAuditResult],
  ["official-program-port-coverage", programPortCoverageResult],
  ["official-vertex-inputs", officialVertexInputAuditResult],
  ["official-mesh-vertex-bindings", officialMeshVertexBindingAuditResult],
]);

function has(...files) {
  return files.every((file) => fs.existsSync(path.join(ROOT, file)));
}

function requirement({
  id,
  label,
  status,
  exactUnits = status === "exact" ? 1 : 0,
  knownUnits = status === "exact" ? 1 : status === "inferred" ? 1 : exactUnits,
  totalUnits = 1,
  evidence: proof = [],
  remaining = [],
  cost = "maintenance",
}) {
  if (!STATUS.has(status)) throw new Error(`invalid restoration status for ${id}: ${status}`);
  if (!(totalUnits > 0) || exactUnits < 0 || knownUnits < exactUnits || knownUnits > totalUnits) {
    throw new Error(`invalid restoration units for ${id}`);
  }
  if ((status === "exact" || status === "partial-exact") && !proof.length) {
    throw new Error(`${id} claims exact units without evidence`);
  }
  if (status === "exact" && exactUnits !== totalUnits) {
    throw new Error(`${id} claims exact status without closing its denominator`);
  }
  if (status === "partial-exact" && !(exactUnits > 0 && exactUnits < totalUnits)) {
    throw new Error(`${id} claims partial-exact status without a partial exact numerator`);
  }
  if (status !== "exact" && status !== "partial-exact" && exactUnits !== 0) {
    throw new Error(`${id} carries exact units under non-exact status ${status}`);
  }
  if (exactUnits > totalUnits) throw new Error(`${id} exact units exceed denominator`);
  return { id, label, status, exactUnits, knownUnits, totalUnits, evidence: proof, remaining, cost };
}

function exactWhen(condition, spec, fallback = {}) {
  return requirement(condition
    ? { ...spec, status: "exact" }
    : {
        ...spec,
        status: fallback.status || "missing",
        exactUnits: 0,
        knownUnits: fallback.knownUnits || 0,
        evidence: fallback.evidence || [],
        remaining: fallback.remaining || ["required implementation or evidence is absent"],
        cost: fallback.cost || spec.cost,
      });
}

function knownWhen(condition, spec, fallback = {}) {
  return requirement(condition
    ? {
        ...spec,
        status: "inferred",
        exactUnits: 0,
        knownUnits: spec.totalUnits || 1,
      }
    : {
        ...spec,
        status: fallback.status || "missing",
        exactUnits: 0,
        knownUnits: fallback.knownUnits || 0,
        evidence: fallback.evidence || [],
        remaining: fallback.remaining || ["required implementation or evidence is absent"],
        cost: fallback.cost || spec.cost,
      });
}

function pipelineRequirement(id, label, cost) {
  const stage = pipeline.get(id);
  if (!stage) {
    return requirement({
      id: `pipeline-${id}`,
      label,
      status: "unknown",
      remaining: ["pipeline stage is absent from the evidence inventory"],
      cost,
    });
  }
  const proof = evaluatePipelineProof({
    stage,
    proofNodes: PIPELINE_PROOF_NODES[id] || [],
    verifierPassed,
  });
  return requirement({
    id: `pipeline-${id}`,
    label,
    status: proof.status,
    exactUnits: proof.exactUnits,
    knownUnits: proof.knownUnits,
    totalUnits: stage.totalSubscopes,
    evidence: [
      ...stage.evidence,
      ...proof.passed.map((node) => `exact proof node ${node.id}: ${node.evidence}`),
    ],
    remaining: [
      ...stage.remaining,
      ...proof.failed.map((node) =>
        `proof node ${node.id} requires fresh verifiers: ${node.verifiers.join(", ")}`),
      ...(proof.unmodeledUnits > 0
        ? [`${proof.unmodeledUnits} denominator unit(s) do not yet have an explicit exact proof node`]
        : []),
      ...(stage.coveredSubscopes > proof.exactUnits
        ? ["source/file inventory contributes known coverage only; it cannot promote exact units"]
        : []),
    ],
    cost,
  });
}

const officialSemanticExecutableCount =
  officialSample.proofSets.materialPrograms.semanticExecutableCount;
if (
  programPortCoverage?.summary?.officialSemanticExecutables != null
  && programPortCoverage.summary.officialSemanticExecutables
    !== officialSemanticExecutableCount
) {
  throw new Error(
    "program-port coverage semantic denominator does not match the current official sample",
  );
}
const layerEvidence = {
  layers: programPortCoverage?.summary.completeExecutableClosures || 0,
  known: programPortCoverage?.summary.stageBoundSemanticExecutables || 0,
  total: officialSemanticExecutableCount,
};
const commonBindingVerdicts = programPortCoverage?.fieldVerdicts?.commonBindings || {};
const bindingEvidence = {
  exact: commonBindingVerdicts.exact || 0,
  known: (commonBindingVerdicts.exact || 0) + (commonBindingVerdicts["source-hash-bound"] || 0),
  total: layerEvidence.total,
};
const allProgramsExact = layerEvidence.layers === layerEvidence.total && layerEvidence.total > 0;
const fourScenesPresent = CANONICAL_SCENES.every((name) => has(`public/${name}`));
const textFiles = CANONICAL_LOCALIZED_TEXT_FILES;
const textOpsCarryObjectIds = textFiles.length > 0 && textFiles.every((name) => {
  const value = JSON.parse(fs.readFileSync(path.join(ROOT, "public", "text", name), "utf8"));
  return (value.elements || [])
    .filter((entry) => entry.kind === "text" && entry.sdf)
    .every((entry) => typeof entry.sdf.fontId === "string" && typeof entry.sdf.materialId === "string");
});
const tmpRuntimeEvidence = auditTmpRuntimeEvidence();
const canonicalTmpRuntimeScenes = new Set(
  tmpRuntimeEvidence.captures
    .filter((capture) => capture.status === "exact-local-runtime" && capture.locale === "zh_TW")
    .map((capture) => capture.scene),
);
const allCanonicalTmpRuntime = tmpRuntimeEvidence.status === "pass"
  && CANONICAL_SCENES.every((scene) => canonicalTmpRuntimeScenes.has(scene));
const hououTmpCapture = tmpRuntimeEvidence.captures.find((capture) =>
  capture.scene === "scene.cPK_20_008900_02_HOUOUex_UR.json"
  && capture.locale === "zh_TW");
const inlineElementRuntimeExact = hououTmpCapture?.status === "exact-local-runtime"
  && hououTmpCapture.inlineElementBindingCount > 0;
const tmpSpriteLayoutRuntimeExact = [
  "scene.cPK_10_000040_00_FUSHIGIBANAex_RR.json",
  "scene.cPK_20_008900_02_HOUOUex_UR.json",
].every((scene) => tmpRuntimeEvidence.captures.some((capture) =>
  capture.scene === scene
  && capture.locale === "zh_TW"
  && capture.status === "exact-local-runtime"
  && capture.tmpSpriteBindingCount > 0
  && capture.tmpSpriteDrawCount > 0
  && capture.tmpSpriteProgramBound));
const allCardFontLocalFallbacksEmpty = tmpFontManifest
  && Object.keys(tmpFontManifest.fonts || {}).length >= 14
  && Object.values(tmpFontManifest.fonts || {}).every((font) =>
    Array.isArray(font.fallbackFontAssetIds) && font.fallbackFontAssetIds.length === 0);
const fullRuntimeEvidence = auditFullRuntimeEvidence();
const runtimeDisplayFidelity = auditRuntimeDisplayFidelity();
let officialRuntimeQuality;
try {
  officialRuntimeQuality = auditOfficialRuntimeQuality();
} catch (error) {
  officialRuntimeQuality = Object.freeze({
    status: "runtime-required",
    selectedQuality: null,
    evidence: Object.freeze([]),
    remaining: Object.freeze([
      "connect the pinned PTCGP 1.6.0 target and re-read the live SystemUserPrefs quality selection",
    ]),
    unavailableReason: String(error?.message || error),
  });
}
const runtimeDisplayRequirements = new Map(
  runtimeDisplayFidelity.requirements.map((item) => [item.id, item]),
);
const runtimeBrowserDensityIds = [
  "css-dpr-drawing-buffer",
  "display-rt-density",
  "source-rt-contract",
  "dynamic-ui-density",
];
const runtimeBrowserDensityExact = runtimeBrowserDensityIds.reduce(
  (sum, id) => sum + (runtimeDisplayRequirements.get(id)?.exactUnits || 0),
  0,
);
const runtimeBrowserDensityTotal = runtimeBrowserDensityIds.reduce(
  (sum, id) => sum + (runtimeDisplayRequirements.get(id)?.totalUnits || 0),
  0,
);
const runtimeOfficialProfile = runtimeDisplayRequirements.get("official-default-quality-active");
const runtimeHostPresentation = runtimeDisplayRequirements.get("emulator-host-presentation");
const allCanonicalFullRuntime = fullRuntimeEvidence.status === "pass"
  && fullRuntimeEvidence.validCaptureCount === CANONICAL_SCENES.length;
const allCanonicalTransformPairs = allCanonicalFullRuntime
  && fullRuntimeEvidence.captures.every((capture) => capture.transformPairExact === true);
const hasOfficialCapture = Boolean(process.env.PCR_OFFICIAL_VULKAN_CAPTURE);
const hasSortCapture = Boolean(process.env.PCR_OFFICIAL_SORT_CAPTURE);
const verification = runVerification();
const passedVerifiers = new Set(verification.checks
  .filter((check) => check.status === "pass")
  .map((check) => check.name));
function verifierPassed(...names) {
  return names.length > 0 && names.every((name) => passedVerifiers.has(name));
}
const exactTmpGenerated = verifierPassed("official-tmp-sdf", "exact-tmp-sdf");
const tmpRuntimeWired = verifierPassed("exact-tmp-sdf");
const officialTmpLayoutStatic = verifierPassed("official-card-ui-layout", "official-tmp-settings");
const carddataCorpusCovered = verifierPassed("carddata-corpus");
const composeCorpusCovered = verifierPassed("compose-corpus");
const officialCardLayoutExecutionCovered = verifierPassed(
  "official-text-variant-execution",
);
const dynamicUILayoutCovered = verifierPassed("dynamic-ui-layout");
const cardTextRuntimeCovered = verifierPassed("official-card-text-runtime", "card-text-resolver");
const officialCardExamplesCovered = verifierPassed(
  "official-card-examples",
  "official-card-example-mutations",
);
const rarityRenderingCoverageCovered = verifierPassed(
  "rarity-rendering-completeness",
  "rarity-rendering-completeness-mutations",
);
const fieldDiffInfrastructure = verifierPassed(
  "official-local-field-diff",
  "official-port-renderer-draw-matching",
);
const materialProgramInventoryIntegrated = verifierPassed(
  "official-shader-variant-selection",
  "official-material-program-inventory",
  "official-program-port-contract",
  "official-program-port-coverage",
);

const dimensions = [
  {
    id: "source-assets",
    label: "Official source and assets",
    requirements: [
      exactWhen(verifierPassed("official-player-pipeline"), {
        id: "official-apk-version",
        label: "Official APKM, PlayerSettings and native version identity",
        evidence: ["audit-official-player-pipeline reads the pinned APKM and ARM64 native image"],
        cost: "maintenance",
      }),
      exactWhen(verifierPassed("official-material-sort-inputs", "official-reference-sort-inputs"), {
        id: "material-ptr-identity",
        label: "Prefab renderer, Material, Shader and Mesh PPtr identities",
        evidence: ["independent official bundle/PPtr audits for the four canonical prefabs"],
        cost: "maintenance",
      }),
      exactWhen(verifierPassed("official-texture-payload", "official-texture-samplers"), {
        id: "texture-object-payload",
        label: "Texture object and compressed payload identity",
        evidence: ["Texture2D/Cubemap PathID, object hash and payload hash audit"],
        cost: "maintenance",
      }),
      exactWhen(verifierPassed("official-card-font-contract")
        && fontContract?.schemaVersion === 2 && Object.keys(fontContract.fonts || {}).length === 14, {
        id: "font-object-identity",
        label: "TMP FontAsset, source OTF, atlas and material object identity",
        evidence: ["schema-2 card-font-contract extracts 13 card FontAssets plus Pokesymbol2 directly from Common/Font_bundles"],
        cost: "maintenance",
      }),
      exactWhen(verifierPassed("official-card-corpus"), {
        id: "official-card-corpus-inventory",
        label: "Authoritative CardID, archetype and foreign-key corpus inventory",
        evidence: ["3305 CardIDs (3042 Pokemon, 263 Trainer), visibility, Trainer Type 1-5 and zero-missing authoritative joins are audited directly"],
        cost: "maintenance",
      }),
      requirement({
        id: "localized-masterdata-scope",
        label: "Localized masterdata content for every renderer archetype",
        status: carddataCorpusCovered && composeCorpusCovered && cardTextRuntimeCovered && localeCoverageAuditPass
          ? "exact"
          : carddataCorpusCovered && composeCorpusCovered ? "partial-exact" : "inferred",
        exactUnits: carddataCorpusCovered && composeCorpusCovered && cardTextRuntimeCovered
          ? 3 + Number(localeCoverageAuditPass)
          : carddataCorpusCovered && composeCorpusCovered ? 2 : 0,
        knownUnits: carddataCorpusCovered && composeCorpusCovered && cardTextRuntimeCovered
          ? 3 + Number(localeCoverageAuditPass)
          : carddataCorpusCovered && composeCorpusCovered ? 2 : 1,
        totalUnits: 4,
        evidence: carddataCorpusCovered && composeCorpusCovered ? [
          "all 3305 authoritative CardIDs parse without structural loss across nine locales",
          "Trainer Type 1-5, Ability, category, evolution-source, damage-symbol and sub-name branches are joined from masterdata and routed to hash-pinned UGUI nodes",
          ...(cardTextRuntimeCovered ? ["all card-face message tags resolve across the 3305 x 9 corpus; official grammar, style and Patchim producer method bytes are pinned to libil2cpp 1.6.0"] : []),
          ...(localeCoverageAuditPass ? ["latest official Aladin locale bundles are hash-pinned; 103473 dynamic card-face references plus static UI keys close with zero missing and zero empty values across nine locales"] : []),
        ] : [`${textFiles.length} data-derived files cover the four canonical Pokemon/trainer scenes in nine locales`],
        remaining: localeCoverageAuditPass ? [] : [
          "resolve authoritative locale omissions and pin each locale bundle to the official asset index",
        ],
        cost: localeCoverageAuditPass ? "maintenance" : "data-provenance-expansion",
      }),
      requirement({
        id: "scene-intermediate-independence",
        label: "Scene generation independent of untrusted intermediate recipes",
        status: materialPropertiesAuditPass ? "exact" : "partial-exact",
        exactUnits: materialPropertiesAuditPass ? 4 : 3,
        knownUnits: materialPropertiesAuditPass ? 4 : 3,
        totalUnits: 4,
        evidence: [
          "material, shader and texture identities are independently re-opened from official bundles",
          ...(materialPropertiesAuditPass ? [
            "84 scene Material rows independently match 69 raw official m_SavedProperties objects: 1773 floats, 169 colors, 251 bound and 44 null texture PPtrs",
            "all 295 official texture scale/offset pairs are serialized defaults; mutation tests reject changed values and texture identities",
          ] : []),
        ],
        remaining: materialPropertiesAuditPass ? [] : [
          "independently close Material floats, colors, texture PPtrs and texture transforms from official serialized objects",
        ],
        cost: materialPropertiesAuditPass ? "maintenance" : "source-tracing-and-bytecode-audit",
      }),
    ],
  },
  {
    id: "scene-geometry",
    label: "Scene, geometry and draw inventory",
    requirements: [
      exactWhen(verifierPassed("official-draw-coverage"), {
        id: "official-draw-inventory",
        label: "Canonical official draw inventory and active material slots",
        evidence: ["official draw coverage resolves the four prefab Material PPtrs and expected draw identities"],
        cost: "maintenance",
      }),
      exactWhen(verifierPassed("official-pass-partition"), {
        id: "official-pass-partition",
        label: "Opaque/transparent pass partition and shader-tag candidates",
        evidence: ["official pass, queue-range and candidate audit"],
        cost: "maintenance",
      }),
      exactWhen(fourScenesPresent && evidence.scope.referenceScenes.length >= 4, {
        id: "canonical-scene-coverage",
        label: "RR, SR, Trainer UR and Pokemon UR canonical scene coverage",
        evidence: ["four complete-id canonical scenes participate in the evidence report"],
        cost: "maintenance",
      }),
      exactWhen(verifierPassed("official-mesh-payload"), {
        id: "mesh-payload-equivalence",
        label: "Vertex/index/UV payload equivalence after AssetRipper to glTF conversion",
        evidence: [
          "four canonical prefab bundles are decoded through UnityPy MeshHandler",
          "74 asset Mesh nodes, 130 primitives and 81,606 expanded vertices match official float32 payloads byte-for-byte",
          "position/normal/tangent/UV conversion, triangle winding and merged submesh ranges are independently checked",
        ],
        cost: "maintenance",
      }),
      requirement({
        id: "canonical-mesh-vertex-binding-closure",
        label: "Canonical Mesh material-slot and selector vertex-channel closure",
        status: verifierPassed(
          "official-mesh-vertex-binding-mutations",
          "official-mesh-vertex-bindings",
        ) && officialMeshVertexBindingAudit?.summary?.runtimeRequiredMaterialSlots === 0
          ? "partial-exact"
          : "missing",
        exactUnits: verifierPassed(
          "official-mesh-vertex-binding-mutations",
          "official-mesh-vertex-bindings",
        ) && officialMeshVertexBindingAudit?.summary?.runtimeRequiredMaterialSlots === 0 ? 4 : 0,
        knownUnits: verifierPassed(
          "official-mesh-vertex-binding-mutations",
          "official-mesh-vertex-bindings",
        ) && officialMeshVertexBindingAudit?.summary?.runtimeRequiredMaterialSlots === 0 ? 4 : 0,
        totalUnits: 5,
        evidence: officialMeshVertexBindingAudit ? [
          `${officialMeshVertexBindingAudit.summary.canonicalMaterialSlotResolutions} submeshes resolve to official Material slots: ${officialMeshVertexBindingAudit.summary.exactDirectMaterialSlots} direct and ${officialMeshVertexBindingAudit.summary.exactUniqueMaterialSlots} unique-material`,
          `${officialMeshVertexBindingAudit.summary.exactPortDrawPassRows} canonical selector draw/pass rows require ${officialMeshVertexBindingAudit.summary.requiredChannelBindings} channels; ${officialMeshVertexBindingAudit.summary.presentChannelBindings} exist and ${officialMeshVertexBindingAudit.summary.missingChannelBindings} are statically proven absent`,
          "renderer sibling identity, official usage inventory, selector witness and Mesh payload hashes are joined fail-closed",
          "official guest VkVertexInput/default binding is deliberately excluded from static exact evidence",
        ] : [],
        remaining: officialMeshVertexBindingAudit ? [
          `capture official guest vertex bindings for ${officialMeshVertexBindingAudit.summary.officialGuestVertexBindingRuntimeRequiredRows} draw/pass rows and resolve ${officialMeshVertexBindingAudit.summary.guestDefaultBindingObligations} missing-channel default obligation`,
        ] : ["close canonical Mesh-to-selector vertex binding evidence"],
        cost: officialMeshVertexBindingAudit ? "target-runtime-capture" : "source-tracing-and-bytecode-audit",
      }),
      requirement({
        id: "runtime-active-draw-set",
        label: "Official runtime active draw set for every canonical card and pose",
        status: "runtime-required",
        exactUnits: 0,
        knownUnits: 0,
        totalUnits: 4,
        evidence: hasOfficialCapture ? ["PCR_OFFICIAL_VULKAN_CAPTURE is configured; importer must still prove all four cards"] : [],
        remaining: ["capture RR, SR, Trainer UR and Pokemon UR draw scopes on the target runtime"],
        cost: "target-runtime-capture",
      }),
    ],
  },
  {
    id: "shader-programs",
    label: "Shader programs and variants",
    requirements: [
      exactWhen(verifierPassed("official-smolv-corpus"), {
        id: "smolv-decoder-corpus",
        label: "All shipped SMOL-V records decode identically to pinned upstream C++",
        evidence: [
          "128 official Common/Shader bundles and 588 physical records are enumerated without Material or scene reachability filtering",
          "380 unique records are byte-identical between the Python decoder and pinned upstream C++, then pass spirv-val",
          "container boundaries and truncation mutations fail closed; this proof does not imply WebGL backend or runtime dispatch equivalence",
        ],
        cost: "maintenance",
      }),
      requirement({
        id: "visible-layer-programs",
        label: "Complete local executable-port closures across the audited corpus",
        status: allProgramsExact ? "exact" : layerEvidence.layers > 0 ? "partial-exact" : "unknown",
        exactUnits: layerEvidence.layers,
        knownUnits: layerEvidence.known,
        totalUnits: layerEvidence.total,
        evidence: programPortCoverage ? [
          `${layerEvidence.known}/${layerEvidence.total} semantic executables have selector-keyed official vertex+fragment SPIR-V ownership`,
          `${layerEvidence.layers}/${layerEvidence.total} close parameter entry, pass state, common bindings, backend-semantic proof and local runtime dispatch`,
        ] : ["the selector-keyed program-port audit is unavailable"],
        remaining: allProgramsExact ? [] : [`${layerEvidence.total - layerEvidence.layers} semantic executables lack complete five-field and dispatch closure`],
        cost: allProgramsExact ? "maintenance" : "shader-reverse-engineering",
      }),
      exactWhen(verifierPassed("official-local-keyword-state", "official-pass-candidates"), {
        id: "keyword-variant-selection",
        label: "Material keyword bitset, selected pass and variant identity",
        evidence: ["official serialized keyword state plus native pass-candidate audit"],
        cost: "maintenance",
      }),
      requirement({
        id: "shader-resource-bindings",
        label: "Shader input, texture, UBO and output binding structure",
        status: bindingEvidence.exact === bindingEvidence.total
          ? "exact"
          : bindingEvidence.exact > 0 ? "partial-exact" : "unknown",
        exactUnits: bindingEvidence.exact,
        knownUnits: bindingEvidence.known,
        totalUnits: bindingEvidence.total,
        evidence: programPortCoverage ? [
          `${bindingEvidence.exact}/${bindingEvidence.total} semantic executables have independently verified exact common-binding closure`,
          `${bindingEvidence.known}/${bindingEvidence.total} have at least official byte-identity ownership`,
        ] : ["the selector-keyed common-binding verifier is unavailable"],
        remaining: bindingEvidence.exact === bindingEvidence.total ? [] : [
          `${bindingEvidence.total - bindingEvidence.exact} semantic executables still lack full active-uniform, sampler and UBO-member closure`,
        ],
        cost: bindingEvidence.exact === bindingEvidence.total ? "maintenance" : "shader-reverse-engineering",
      }),
      exactWhen(
        verifierPassed("official-vertex-input-mutations", "official-vertex-inputs")
          && officialVertexInputAudit?.summary?.portCount > 0
          && officialVertexInputAudit.summary.officialSemanticExactPorts
            === officialVertexInputAudit.summary.portCount
          && officialVertexInputAudit.summary.localAdapterExactPorts
            === officialVertexInputAudit.summary.portCount,
        {
          id: "vertex-input-semantic-adapters",
          label: "Official vertex semantics to Three.js r165 attribute adapters",
          exactUnits: officialVertexInputAudit?.summary?.portCount || 41,
          knownUnits: officialVertexInputAudit?.summary?.portCount || 41,
          totalUnits: officialVertexInputAudit?.summary?.portCount || 41,
          evidence: officialVertexInputAudit ? [
            `${officialVertexInputAudit.summary.officialSemanticExactPorts}/${officialVertexInputAudit.summary.portCount} selector ports close ShaderSubProgram bind channels against SPIR-V input locations`,
            `${officialVertexInputAudit.summary.localAdapterExactPorts}/${officialVertexInputAudit.summary.portCount} local adapters use the exact Three.js r165 attribute names and GLSL types`,
            "Three.js GLTF semantic mapping, default attributes and WebGL binding paths are version/hash pinned; official guest default values remain outside this proof",
          ] : [],
          remaining: [],
          cost: "maintenance",
        },
        {
          status: "missing",
          remaining: ["close official bind-channel semantics and local Three.js attributes for every selector port"],
          cost: "shader-reverse-engineering",
        },
      ),
      exactWhen(verifierPassed("official-mrt-outputs"), {
        id: "shader-mrt-outputs",
        label: "Per-variant MRT output locations and formulas",
        evidence: ["official fragment SPIR-V output audit"],
        cost: "maintenance",
      }),
      pipelineRequirement("shader-precision", "Static shader precision and target backend behavior", "target-device-precision-probe"),
      requirement({
        id: "official-runtime-program-binding",
        label: "Programs and specialization constants actually bound by the official runtime",
        status: "runtime-required",
        exactUnits: 0,
        knownUnits: 0,
        totalUnits: 4,
        evidence: hasOfficialCapture ? ["configured Vulkan capture importer"] : [],
        remaining: ["complete-provenance Vulkan capture for all four canonical cards"],
        cost: "target-runtime-capture",
      }),
    ],
  },
  {
    id: "resources-uniforms",
    label: "Textures, samplers and uniforms",
    requirements: [
      pipelineRequirement("texture-color-space", "Texture color-space upload and sampling", "runtime-pipeline-research"),
      pipelineRequirement("alpha-convention", "Straight/premultiplied alpha and transmission convention", "runtime-pipeline-research"),
      pipelineRequirement("sampler-state", "Serialized sampler state and target-device behavior", "target-device-texture-probe"),
      exactWhen(verifierPassed("scene-texture-usage", "scene-float-usage", "scene-color-usage"), {
        id: "static-material-bindings",
        label: "Static texture, float and color material bindings",
        evidence: ["scene usage audits are constrained by official program bindings"],
        cost: "maintenance",
      }),
      knownWhen(verifierPassed("official-texture-payload"), {
        id: "texture-mip-chain",
        label: "Official compressed payload and deterministic mip-chain upload",
        evidence: ["official payload hash and deterministic generated mip bytes; GPU textureLod readback remains an explicit browser test"],
        remaining: ["run the explicit browser textureLod probe for the selected WebGL backend and obtain target-device sampler evidence"],
        cost: "target-device-texture-probe",
      }),
      requirement({
        id: "dynamic-uniform-values",
        label: "Per-frame official descriptors, UBO values and push constants",
        status: "runtime-required",
        remaining: ["capture and compare neutral and tilted frames at fixed official clock values"],
        cost: "target-runtime-capture",
      }),
      requirement({
        id: "target-texture-decode",
        label: "Target GPU ASTC/ETC decode, anisotropy and descriptor capabilities",
        status: "runtime-required",
        remaining: ["target-device decode and sampler probe"],
        cost: "target-device-texture-probe",
      }),
    ],
  },
  {
    id: "fixed-function-order",
    label: "Fixed-function state and draw order",
    requirements: [
      pipelineRequirement("blend-stencil-depth", "Blend, depth, stencil, cull and color-mask state", "runtime-gl-state-verification"),
      pipelineRequirement("draw-order", "Official opaque/transparent ordering and native tie-breaks", "target-runtime-sort-capture"),
      exactWhen(verifierPassed("official-pass-partition"), {
        id: "draw-pass-routing",
        label: "Renderer-list routing to opaque and transparent command passes",
        evidence: ["official renderer-feature/pass partition audit"],
        cost: "maintenance",
      }),
      requirement({
        id: "target-viewport-scissor",
        label: "Official target-device viewport, scissor, image layout and barriers",
        status: "runtime-required",
        remaining: ["target Vulkan pipeline-state capture"],
        cost: "target-runtime-capture",
      }),
      requirement({
        id: "runtime-sort-suffix",
        label: "Material+0x17c and Shader InstanceID draw-order suffix",
        status: "runtime-required",
        exactUnits: 0,
        knownUnits: 0,
        totalUnits: 2,
        evidence: hasSortCapture ? ["PCR_OFFICIAL_SORT_CAPTURE is configured"] : [],
        remaining: ["capture all 17 collision groups and atomically activate the native suffix"],
        cost: "target-runtime-sort-capture",
      }),
    ],
  },
  {
    id: "camera-dynamics",
    label: "Camera, interaction and animation",
    requirements: [
      pipelineRequirement("camera-transforms", "Card camera, touch rotation and homography transforms", "runtime-pipeline-research"),
      pipelineRequirement("animation-timing", "Official clocks, pause/resume and animated material timing", "runtime-pipeline-research"),
      exactWhen(verifierPassed("official-touch-rotation"), {
        id: "touch-state-machine",
        label: "Touch delta accumulation, quaternion order and clamp",
        evidence: ["official ARM64 method audit and numeric runtime tests"],
        cost: "maintenance",
      }),
      knownWhen(verifierPassed("official-camera-transform"), {
        id: "homography-program-producer",
        label: "Homography H/Hinv producer and exact display program",
        evidence: ["official IL2CPP producer and SPIR-V identity; browser numeric audit is deliberately outside the no-browser gate"],
        remaining: ["prove the Vulkan-to-WebGL homography adaptation semantically and retain the explicit numeric browser regression"],
        cost: "backend-semantic-equivalence",
      }),
      requirement({
        id: "runtime-transform-space-coupling",
        label: "Neutral/tilted transform ownership and homography dependency",
        status: allCanonicalTransformPairs ? "exact" : "runtime-required",
        exactUnits: allCanonicalTransformPairs ? 1 : 0,
        knownUnits: allCanonicalTransformPairs ? 1 : 0,
        evidence: allCanonicalTransformPairs ? [
          "official ARM64 transform ownership and mutation tests reject render-object pose reuse in studio keypoints",
          "four source-bound neutral/nonzero-tilt runtime pairs preserve studio homography while render-object and output pixels change",
        ] : [
          "official ARM64 transform ownership plus a mutation test reject render-object pose reuse in studio keypoints",
        ],
        remaining: allCanonicalTransformPairs ? [] : [
          "capture source-bound neutral and nonzero-tilt state pairs and compare renderObjectQuaternion, displayQuaternion, viewportPoints, homography and RGBA hashes",
        ],
        cost: "runtime-regression",
      }),
      exactWhen(officialRuntimeQuality.status === "pass", {
        id: "actual-quality-profile",
        label: "Actual persisted quality profile selected on the target runtime",
        evidence: officialRuntimeQuality.evidence,
        cost: "runtime-preference-maintenance",
      }, {
        status: "runtime-required",
        remaining: ["read and validate the live game quality selection"],
        cost: "target-runtime-capture",
      }),
    ],
  },
  {
    id: "dynamic-ui-text",
    label: "Dynamic UI and TMP text",
    requirements: [
      exactWhen(verifierPassed("official-card-font-contract") && fontContract?.schemaVersion === 2, {
        id: "tmp-font-material-contract",
        label: "Locale/CardTextType FontAsset and TMP material selection",
        evidence: ["official FontGroupSettings, presets, FontAssets and Materials"],
        cost: "maintenance",
      }),
      exactWhen(textOpsCarryObjectIds, {
        id: "text-object-identity",
        label: "Generated text draw ops carry official fontId and materialId",
        evidence: [`${textFiles.length} localized text files resolve explicit official object identities`],
        cost: "maintenance",
      }),
      exactWhen(verifierPassed("exact-tmp-sdf") && exactTmpGenerated, {
        id: "tmp-shader-bytecode",
        label: "Official TMP SDF shader variant, bindings and WebGL port",
        evidence: ["pinned TMP shader bundle/object/program/module hashes and generated GLSL"],
        cost: "maintenance",
      }),
      exactWhen(verifierPassed("official-tmp-glyph-metrics"), {
        id: "tmp-glyph-metrics",
        label: "Glyph metrics from the official source OTF at FontAsset point size",
        evidence: ["all 1,677 serialized glyphs across 13 FontAssets are audited: 1,676 source-exact and one pinned tabular advance override"],
        cost: "maintenance",
      }),
      requirement({
        id: "tmp-dynamic-sdf-atlas",
        label: "Unity 2022.3.62f2 SDFAA dynamic glyph atlas generation",
        status: verifierPassed("official-tmp-atlas-pixels", "official-tmp-atlases") ? "exact" : "missing",
        exactUnits: verifierPassed("official-tmp-atlas-pixels", "official-tmp-atlases") ? 1 : 0,
        knownUnits: verifierPassed("official-tmp-atlas-pixels", "official-tmp-atlases") ? 1 : 0,
        evidence: verifierPassed("official-tmp-atlas-pixels", "official-tmp-atlases")
          ? ["4,496,108 official atlas pixels are byte-exact and all missing canonical glyphs are generated by the pinned native SDFAA chain"]
          : [],
        remaining: verifierPassed("official-tmp-atlas-pixels", "official-tmp-atlases") ? [] : ["build and verify deterministic official TMP atlas assets"],
        cost: "native-fontengine-integration",
      }),
      requirement({
        id: "tmp-glyph-mesh-uv2",
        label: "TMP glyph quads, UV0 and packed UV2 weight/scale semantics",
        status: tmpGlyphQuadAudit.status === "pass" && tmpRuntimeWired ? "exact" : "missing",
        exactUnits: tmpGlyphQuadAudit.status === "pass" && tmpRuntimeWired ? 3 : 0,
        knownUnits: tmpGlyphQuadAudit.status === "pass" && tmpRuntimeWired ? 3 : 0,
        totalUnits: 3,
        evidence: tmpGlyphQuadAudit.status === "pass" && tmpRuntimeWired
          ? [
              "official IL2CPP PackUV methods, 511 constant, four-corner UGUI writes, style/scale field loads, padding and blend state are byte-pinned",
              "TMP 3.0.6 character scale, quad, italic shear and advance source ranges plus the native GenerateTextMesh body are hash-pinned",
              "all 68 official card TMP components and 7,456 glyph geometry variants execute the exact reachable normal/italic and width-adjustment formulas",
            ]
          : [],
        remaining: tmpGlyphQuadAudit.status === "pass" && tmpRuntimeWired ? [] : ["restore and execute the source-bound reachable TMP glyph quad branches"],
        cost: "textmeshpro-runtime-port",
      }),
      requirement({
        id: "tmp-runtime-pass",
        label: "Official TMP SDF program renders text into DynamicUI RT",
        status: allCanonicalTmpRuntime ? "exact" : tmpRuntimeWired ? "inferred" : "missing",
        exactUnits: allCanonicalTmpRuntime ? 1 : 0,
        knownUnits: allCanonicalTmpRuntime ? 1 : 0,
        totalUnits: 1,
        evidence: allCanonicalTmpRuntime
          ? ["source-hash-bound, no-screenshot WebGL readback proves nonempty Text/Holo source RT and final UI/holo RT output for all four canonical cards"]
          : tmpRuntimeWired ? ["official TMP WebGL path is statically wired; fresh canonical runtime evidence is incomplete"] : [],
        remaining: allCanonicalTmpRuntime ? [] : ["open every canonical scene with ?auditrt=1 and retain source-current readback evidence"],
        cost: "textmeshpro-runtime-port",
      }),
      requirement({
        id: "tmp-line-layout-core",
        label: "TMP line breaking, alignment, kerning and spacing core",
        status: tmpLineLayoutAuditPass ? "exact" : officialTmpLayoutStatic ? "partial-exact" : "unknown",
        exactUnits: tmpLineLayoutAuditPass ? 2 : officialTmpLayoutStatic ? 1 : 0,
        knownUnits: tmpLineLayoutAuditPass ? 2 : officialTmpLayoutStatic ? 1 : 0,
        totalUnits: 2,
        evidence: tmpLineLayoutAuditPass ? [
          "TMP 3.0.6 initialization, horizontal overflow, saved breakpoints, Save/RestoreWordWrappingState, no-break tags and justification source ranges are hash-pinned",
          "the official 68-component census proves 23 wrapped LTR Overflow nodes and the reachable Left/Center/Right/Justified alignment set",
          "an independent source-transcribed oracle matches 18,720 exhaustive saved-state cases and 630 canonical localized boundary cases across nine locales",
        ] : officialTmpLayoutStatic ? [
          "official prefab bundle/object hashes bind all 512 RectTransforms and 68 TMP components",
          "official APK TMP Settings raw hash binds the 41 leading and 97 following East Asian line-breaking characters",
          "runtime consumes official glyph metrics, GPOS pairs, saved word-wrap breakpoints, spacing, margins, justification and char-width adjustment limits",
        ] : [],
        remaining: tmpLineLayoutAuditPass ? [] : ["prove every saved wrap-state and overflow transition against the source-bound independent oracle"],
        cost: tmpLineLayoutAuditPass ? "maintenance" : "textmeshpro-runtime-port",
      }),
      exactWhen(cardTextRuntimeCovered && verifierPassed("official-tmp-rich-text"), {
        id: "tmp-rich-text-style-stack",
        label: "TMP nested bold/italic counters and no-break control semantics",
        evidence: ["official TMP 3.0.6 FontStyleStack byte counters and no-break boolean are ported and saturation-tested"],
        cost: "maintenance",
      }),
      exactWhen(inlineElementAudit.status === "pass" && inlineElementRuntimeExact, {
        id: "tmp-inline-element-font-tags",
        label: "[Img:Element] Pokesymbol2 PUA glyph, material and runtime binding",
        evidence: [
          "LtUIImgTagCommand.PreProcessElement ARM64 method and exact 11-glyph PUA table are pinned",
          "official Pokesymbol2 static atlas and three materials are audited",
          "source-hash-bound Ho-Oh runtime evidence executes the official FontAsset/material binding with zero Canvas fallback",
        ],
        cost: "maintenance",
      }, {
        status: inlineElementAudit.status === "pass" ? "runtime-required" : "missing",
        knownUnits: inlineElementAudit.status === "pass" ? 1 : 0,
        evidence: inlineElementAudit.status === "pass" ? ["official static inline-element contract and generated card corpus pass"] : [],
        remaining: ["refresh Ho-Oh ?auditrt=1 evidence with binding identity enabled"],
      }),
      exactWhen(allCardFontLocalFallbacksEmpty, {
        id: "tmp-card-font-local-fallbacks",
        label: "Current card FontAsset local fallback tables",
        evidence: ["all 14 audited card and Pokesymbol2 FontAssets serialize empty fallbackFontAssetIds tables"],
        cost: "maintenance",
      }),
      exactWhen(tmpFallbackAudit.status === "pass", {
        id: "tmp-global-fallback-resolution",
        label: "TMP Settings global/default font fallback resolution",
        evidence: [
          "official 248-byte TMP Settings object proves the global fallback list is empty and default FontAsset/SpriteAsset are null",
          "package-matched TMP 3.0.6 search ranges and official IL2CPP GetTextElement/GenerateTextMesh bodies are hash-pinned",
          "the local resolver executes U+10FFFF -> U+25A1 and square-absent -> space branches against native-generated official font glyphs",
        ],
        cost: "maintenance",
      }, {
        status: "missing",
        remaining: ["restore the official TMP settings/fallback contract and executable missing-glyph test"],
      }),
      requirement({
        id: "tmp-ex-sprite-layout",
        label: "[Img:ex] TextExSprite asset, preprocessing, layout, shader and runtime binding",
        status: tmpSpriteAudit.status === "pass"
          ? "partial-exact"
          : "missing",
        exactUnits: tmpSpriteAudit.status === "pass"
          ? 2
            + Number(tmpSpriteLayoutRuntimeExact)
            + Number(tmpSpriteProgramAuditPass)
          : 0,
        knownUnits: tmpSpriteAudit.status === "pass"
          ? 2
            + Number(tmpSpriteLayoutRuntimeExact)
            + 2 * Number(tmpSpriteProgramAuditPass)
            + Number(tmpSpriteRuntimeRoutePass)
          : 0,
        totalUnits: 7,
        evidence: tmpSpriteAudit.status === "pass" ? [
          "official TextExSprite SpriteAsset, Material, ASTC payload, decoded RGBA and four glyph rects are hash-pinned",
          "PreProcessEX format string, [0,2,1,3] index table, normal/Mega selection and localizer tag size are byte/object-pinned",
          "Unity 2022.3.62f2 pointSize-zero sprite scale, baseline, crop and negative-em advance formulas are ported and tested",
          ...(tmpSpriteLayoutRuntimeExact
            ? ["source-current Venusaur and Ho-Oh runtime evidence executes the expected SpriteAsset/index binding and layout"]
            : []),
          ...(tmpSpriteProgramAuditPass ? [
            "the official empty-keyword selector, candidate witness, SMOL-V modules, parameter entry, pass state and common bindings are byte- and identity-pinned",
            "the generated WebGL2 source is source-hash-bound; this records implementation knowledge without claiming Vulkan-to-WebGL semantic equivalence",
          ] : []),
          ...(tmpSpriteRuntimeRoutePass ? [
            "inline sprite quads are routed as dedicated TMP-Sprite draws with selector evidence and premultiplied One/OneMinusSrcAlpha material state",
          ] : []),
        ] : [],
        remaining: [
          ...(!tmpSpriteLayoutRuntimeExact ? [
            "refresh Venusaur and Ho-Oh ?auditrt=1 evidence to prove the expected SpriteAsset/index binding executes",
          ] : []),
          ...(!tmpSpriteProgramAuditPass ? [
            "extract and verify the selector-bound Lettuce/Common/Card/TextMeshPro/Sprite(to RT) executable and premultiplied pass",
          ] : []),
          ...(!tmpSpriteRuntimeRoutePass ? [
            "route inline TMP sprite quads through the dedicated Sprite(to RT) program instead of the UIImage producer",
          ] : []),
          "independently prove Vulkan-to-WebGL stage semantics for the generated source",
          "capture official guest Canvas dynamic stencil, clip, attachment and submitted descriptor/uniform state",
        ],
        cost: "textmeshpro-runtime-port",
      }),
      exactWhen(tmpAutoSizeAudit.status === "pass", {
        id: "tmp-autosize-overflow",
        label: "TMP autosize and reachable official card-UI overflow branches",
        evidence: [
          "TMP 3.0.6 source ranges and the official IL2CPP GenerateTextMesh body are hash-pinned",
          "the official 68-component card-UI census proves 35 autosize nodes and Overflow (0) as the only reachable overflow mode",
          "float width adjustment, line-spacing gate, 0.05pt min/max iteration and Overflow termination execute in boundary tests",
        ],
        cost: "maintenance",
      }, {
        status: officialTmpLayoutStatic ? "inferred" : "unknown",
        knownUnits: officialTmpLayoutStatic ? 1 : 0,
        remaining: ["restore and execute the source-bound TMP autosize state machine for the official card-UI field census"],
      }),
      requirement({
        id: "dynamic-ui-composition",
        label: "UGUI hierarchy, sprites, masks and text composition into _DynamicUITex",
        status: composeCorpusCovered && dynamicUILayoutCovered ? "partial-exact" : "inferred",
        exactUnits: composeCorpusCovered && dynamicUILayoutCovered
          ? 2
            + Number(uguiImageStateAuditPass)
            + Number(uguiResourceAuditPass)
            + Number(uguiRuntimeStateAuditPass)
            + Number(officialLayoutFittersAuditPass)
            + Number(layoutFitterMutationPass)
            + Number(layoutRebuilderMutationPass)
            + Number(officialCardLayoutExecutionCovered)
          : 0,
        knownUnits: composeCorpusCovered && dynamicUILayoutCovered
          ? 2
            + Number(uguiImageStateAuditPass)
            + Number(uguiResourceAuditPass)
            + Number(uguiRuntimeStateAuditPass)
            + Number(officialLayoutFittersAuditPass)
            + Number(layoutFitterMutationPass)
            + Number(layoutRebuilderMutationPass)
            + Number(officialCardLayoutExecutionCovered)
          : 1,
        totalUnits: 10,
        evidence: composeCorpusCovered && dynamicUILayoutCovered ? [
          "3191 source-current zh_TW compositions and the 112-witness x nine-locale matrix resolve every element through hash-pinned official RectTransform/TMP paths; 114 version-gap cards fail closed",
          "Trainer Type 1-5, A1T1 Ability, category, evolution source and damage-symbol branches use their official prefab nodes",
          ...(uguiImageStateAuditPass ? [
            "all 314 official Image and 171 Canvas serialized states are object/hash-pinned; direct icon draw ops consume Image color, preserveAspect and enabled state",
            "locale-specific stage and ex-rule nodes preserve their own Sprite/Material PPtr and object identity instead of borrowing the first locale node",
          ] : []),
          ...(uguiResourceAuditPass ? [
            "all 314 Image PPtrs resolve through 168 official Sprite/Texture2D pairs and the UI-Default-ToRT Material/Shader chain with bundle, object and streamed-payload hashes",
            "117 static direct Image icon draws bind the exact prefab Texture2D URL; nine evolution-source draws remain explicit IL2CPP runtime Sprite assignments",
          ] : []),
          ...(uguiRuntimeStateAuditPass ? [
            "21 official Card UI producer/dispatcher ARM64 method bodies and all direct UGUI mutation call sites are byte-pinned",
            "Card Core direct-call census proves SetActive/Image.sprite/Behaviour.enabled writers and zero direct color/material/fill/maskable/CanvasRenderer writers",
          ] : []),
          ...(officialLayoutFittersAuditPass ? [
            "84/84 serialized Horizontal/Vertical LayoutGroup, ContentSizeFitter and AspectRatioFitter components are object- and prefab-hash-pinned",
          ] : []),
          ...(layoutFitterMutationPass ? [
            "the pure layout executor covers all official enum modes, LayoutUtility priority, padding/alignment/spacing/control/expand/scale/reverse behavior and fail-closed schema mutations",
          ] : []),
          ...(layoutRebuilderMutationPass ? [
            "the pure LayoutRebuilder scheduler executes official horizontal calculate/control then vertical calculate/control ordering with bottom-up/top-down traversal and deterministic dirty-root convergence",
          ] : []),
          ...(officialCardLayoutExecutionCovered ? [
            "all 112 globally minimal witnesses across nine locales feed official TMP and serialized LayoutElement metrics through LayoutRebuilder convergence; every emitted draw retains its official GameObject identity, authored box and final composed RectTransform",
          ] : []),
        ] : ["bundle- and object-hash-pinned PokemonCardUI/TrainersCardUI hierarchy drives the composition path"],
        remaining: [
          ...(!officialCardLayoutExecutionCovered ? [
            "feed actual TMP/ILayoutElement min, preferred and flexible metrics through LayoutRebuilder horizontal/vertical convergence into composed RectTransforms",
          ] : []),
          "capture which byte-pinned IL2CPP activation and sprite branches execute for each target card",
          "compare composed DynamicUI attachments against the official target-runtime draw and resource state",
        ],
        cost: "ugui-runtime-reconstruction",
      }),
      knownWhen(verifierPassed("exact-ui-default-to-rt"), {
        id: "ui-default-to-rt",
        label: "Official Card_UI_Default_ToRT producer program and blend state",
        evidence: ["hash-pinned generated WebGL2 port; explicit MRT numeric browser audit is outside the no-browser gate"],
        remaining: ["prove backend semantic equivalence and run the explicit MRT numeric regression"],
        cost: "backend-semantic-equivalence",
      }),
    ],
  },
  {
    id: "render-target-post",
    label: "Render targets, MRT and postprocess",
    requirements: [
      pipelineRequirement("render-target-formats", "Render-target descriptors and target physical formats", "target-runtime-capture"),
      pipelineRequirement("mrt-routing", "Two-attachment scene routing and runtime scope", "target-runtime-capture"),
      pipelineRequirement("bloom-tone-mapping", "Bloom graph, programs, state and FinalBlit", "maintenance"),
      pipelineRequirement("display-transfer", "Display transfer through compositor and panel", "target-device-display-probe"),
      knownWhen(verifierPassed("exact-ui-default-from-rt"), {
        id: "ui-default-from-rt",
        label: "Official UI_Default_From_RT outer display pass",
        evidence: ["hash-pinned generated WebGL program; explicit link/numeric browser audit is outside the no-browser gate"],
        remaining: ["prove backend semantic equivalence and run the explicit display-pass numeric regression"],
        cost: "backend-semantic-equivalence",
      }),
      requirement({
        id: "browser-physical-density-chain",
        label: "Browser CSS/DPR, drawing buffer, display RT and DynamicUI density chain",
        status: runtimeBrowserDensityExact === runtimeBrowserDensityTotal
          ? "exact"
          : runtimeBrowserDensityExact > 0 ? "partial-exact" : "runtime-required",
        exactUnits: runtimeBrowserDensityExact,
        knownUnits: runtimeBrowserDensityExact,
        totalUnits: runtimeBrowserDensityTotal,
        evidence: runtimeBrowserDensityExact ? [
          `${runtimeBrowserDensityExact}/${runtimeBrowserDensityTotal} schema-3 source-bound runtime density obligations pass across four canonical cards`,
        ] : [],
        remaining: runtimeBrowserDensityExact === runtimeBrowserDensityTotal ? [] : [
          "close every CSS-to-backing-store, display-RT or DynamicUI raster-density mismatch",
        ],
        cost: "runtime-regression",
      }),
      requirement({
        id: "official-default-quality-active",
        label: "Canonical audit URL selects the official ordinary-Android Middle quality profile",
        status: runtimeOfficialProfile?.exactUnits === runtimeOfficialProfile?.totalUnits ? "exact" : "missing",
        exactUnits: runtimeOfficialProfile?.exactUnits || 0,
        knownUnits: runtimeOfficialProfile?.exactUnits || 0,
        totalUnits: runtimeOfficialProfile?.totalUnits || 4,
        evidence: runtimeOfficialProfile?.exactUnits ? runtimeOfficialProfile.evidence : [],
        remaining: runtimeOfficialProfile?.remaining || ["runtime display profile evidence is absent"],
        cost: "runtime-profile-alignment",
      }),
    ],
  },
  {
    id: "target-runtime",
    label: "Official target-runtime closure",
    requirements: [
      ...CANONICAL_SCENES.map((name) => requirement({
        id: `capture-${name.slice(6, -5)}`,
        label: `Complete-provenance Vulkan capture: ${name.slice(6, -5)}`,
        status: "runtime-required",
        remaining: ["capture neutral and tilted submitted card render scopes"],
        cost: "target-runtime-capture",
      })),
      requirement({
        id: "target-descriptors-uniforms",
        label: "Official per-draw pipeline, descriptor and uniform comparison",
        status: "runtime-required",
        remaining: ["import target captures and compare every canonical draw field"],
        cost: "target-runtime-capture",
      }),
      requirement({
        id: "target-gpu-numerics",
        label: "Adreno/Mali precision, texture decode and transcendental behavior",
        status: "runtime-required",
        remaining: ["run the numeric probe on a native target GPU"],
        cost: "target-device-precision-probe",
      }),
      requirement({
        id: "target-display-output",
        label: "Swapchain, compositor, OS color management and panel transfer",
        status: runtimeHostPresentation?.exactUnits ? "partial-exact" : "runtime-required",
        exactUnits: runtimeHostPresentation?.exactUnits || 0,
        knownUnits: runtimeHostPresentation?.exactUnits || 0,
        totalUnits: 3,
        evidence: runtimeHostPresentation?.evidence || [],
        remaining: runtimeHostPresentation?.exactUnits ? [
          "capture the guest Vulkan swapchain and card draw scopes",
          "probe a native Android compositor, color-management and panel path",
        ] : ["capture target surface selection and controlled display path"],
        cost: "target-device-display-probe",
      }),
    ],
  },
  {
    id: "scope-regression",
    label: "Scope, regression and generalization",
    requirements: [
      exactWhen(fourScenesPresent, {
        id: "four-reference-scenes",
        label: "Four canonical RR/SR/Trainer-UR/Pokemon-UR scenes are present",
        evidence: ["canonical complete-id scene files"],
        cost: "maintenance",
      }),
      exactWhen(verifierPassed("localized-card-text") && textFiles.length === 36 && packageJson.scripts?.["audit:text"], {
        id: "localized-text-freshness",
        label: "Deterministic freshness audit for 36 localized canonical text files",
        evidence: ["prebuild_text --check compares exact generated JSON"],
        cost: "maintenance",
      }),
      exactWhen(verifierPassed("official-card-font-contract", "official-tmp-sdf"), {
        id: "audit-matrix-integration",
        label: "Font and TMP bytecode audits participate in the aggregate matrix",
        evidence: ["audit-all includes official-card-font-contract and official-tmp-sdf"],
        cost: "maintenance",
      }),
      requirement({
        id: "browser-runtime-regression",
        label: "No-screenshot browser runtime regression across all four cards",
        status: allCanonicalFullRuntime ? "exact" : "inferred",
        exactUnits: allCanonicalFullRuntime ? 1 : 0,
        knownUnits: 1,
        evidence: allCanonicalFullRuntime
          ? ["source-hash-bound local WebGL readback covers source MRT0/MRT1, display MRT0 and per-draw GL state for all four canonical cards with zero TMP fallback"]
          : ["runtime path exists, but source-current four-card full-RT evidence is incomplete"],
        remaining: allCanonicalFullRuntime ? [] : ["open every canonical scene once with ?auditrt=1&lc=zh_TW and retain the source-current full-RT artifact"],
        cost: "runtime-regression",
      }),
      requirement({
        id: "all-card-generalization",
        label: "Renderer generalizes to every official card/material archetype",
        status: carddataCorpusCovered && composeCorpusCovered ? "partial-exact" : "unknown",
        exactUnits: carddataCorpusCovered && composeCorpusCovered
          ? 2
            + Number(officialCardExamplesCovered)
            + Number(rarityRenderingCoverageCovered)
          : 0,
        knownUnits: carddataCorpusCovered && composeCorpusCovered
          ? 2
            + Number(officialCardExamplesCovered)
            + Number(rarityRenderingCoverageCovered)
          : 0,
        totalUnits: 5,
        evidence: carddataCorpusCovered && composeCorpusCovered ? [
          "all 3305 CardIDs pass authoritative masterdata parsing",
          "all 3305 CardIDs pass official-layout composition in zh_TW plus a nine-locale archetype matrix",
          ...(officialCardExamplesCovered ? [
            "a deterministic 444-obligation matrix joins serialized card design, 77 semantic executables, 166 material-state archetypes, zero locator boundaries, one engine-owned variant boundary and 64 card-face semantic branches; deterministic greedy selects 112 witnesses and an independent HiGHS MILP proves 112 is the global minimum",
          ] : []),
          ...(rarityRenderingCoverageCovered ? [
            "a second official inventory join closes all 543 rarity x semantic-executable/material-state obligations with the 112 primary witnesses plus five independently proven minimum additional witnesses; 2,725 rendererIdentity/materialSlot/materialIdentity rows match their generated scene draws exactly",
          ] : []),
          ...(illustrationInventoryAuditPass ? [
            "the business-masterdata/decrypted-asset version inventory hash-pins 3191/3305 Face L bundles (1,181,259,080 bytes) and identifies exactly 114 absent Series B illustrations",
          ] : []),
          ...(materialProgramInventoryIntegrated ? [
            "the official-byte corpus graph enumerates 58,057 MeshRenderer material slots, 8,460 fully located Materials and 62 Shaders without scene/recipe/PNG/GLB inputs; all 78 selectors resolve to 80 pass executable candidates / 79 container archetypes / 77 semantic executable archetypes through 75 exact-keyword selectors, two ordered multi-pass selectors and one version-locked native best-match selector",
            "the native selector audit pins PTCGP 1.6.0 libunity ComputeKeywordMatch, strict/best branching, first-candidate tie behavior and boot.config; engine-owned INSTANCING_ON remains explicitly runtime-bound",
          ] : []),
        ] : [],
        remaining: [
          "acquire the 114 Series B Face bundles absent from the current decrypted asset snapshot",
          "prove backend-semantic equivalence for all 77 official semantic executable archetypes and retain Side&Back INSTANCING_ON as an engine-owned runtime boundary until guest capture closes it",
          "capture guest runtime bindings to confirm actual multi-pass dispatch and engine-owned instancing variants without inflating static implementation coverage",
          "run source-bound no-fallback runtime coverage over every material and layout archetype",
        ],
        cost: "corpus-expansion",
      }),
      requirement({
        id: "official-local-field-diff",
        label: "Every official runtime field is automatically diffed against the local renderer",
        status: fieldDiffInfrastructure ? "partial-exact" : "missing",
        exactUnits: fieldDiffInfrastructure ? 1 : 0,
        knownUnits: fieldDiffInfrastructure ? 1 : 0,
        totalUnits: 2,
        evidence: fieldDiffInfrastructure ? [
          "source-bound local captures retain actual WebGL program, fixed-function, uniform and texture state for every card draw",
          "schema-checked Vulkan-to-WebGL canonicalizer reports every comparable field and preserves unresolved identities",
        ] : [],
        remaining: ["complete target captures and run the field diff over all four canonical neutral and tilted frames"],
        cost: fieldDiffInfrastructure ? "target-runtime-capture" : "audit-infrastructure",
      }),
    ],
  },
];

if (dimensions.length !== 10) throw new Error(`definition must contain exactly 10 equal-weight dimensions, found ${dimensions.length}`);
const ids = new Set();
for (const dimension of dimensions) {
  if (!dimension.requirements.length) throw new Error(`dimension ${dimension.id} has no requirements`);
  for (const item of dimension.requirements) {
    if (ids.has(item.id)) throw new Error(`duplicate restoration requirement: ${item.id}`);
    ids.add(item.id);
  }
}

function summarizeDimension(dimension) {
  const exactUnits = dimension.requirements.reduce((sum, item) => sum + item.exactUnits, 0);
  const knownUnits = dimension.requirements.reduce((sum, item) => sum + item.knownUnits, 0);
  const totalUnits = dimension.requirements.reduce((sum, item) => sum + item.totalUnits, 0);
  const counts = Object.fromEntries([...STATUS].map((status) => [
    status,
    dimension.requirements.filter((item) => item.status === status).length,
  ]));
  return {
    ...dimension,
    weight: 10,
    exactUnits,
    knownUnits,
    totalUnits,
    exactPercent: totalUnits ? exactUnits / totalUnits * 100 : 0,
    knownPercent: totalUnits ? knownUnits / totalUnits * 100 : 0,
    counts,
  };
}

const summarized = dimensions.map(summarizeDimension);
const exactScore = summarized.reduce((sum, item) => sum + item.exactPercent, 0) / summarized.length;
const knownCoverage = summarized.reduce((sum, item) => sum + item.knownPercent, 0) / summarized.length;
const allRequirements = summarized.flatMap((dimension) => dimension.requirements.map((item) => ({
  dimension: dimension.id,
  ...item,
})));

function runVerification() {
  if (!process.argv.includes("--verify")) {
    return {
      status: "not-run",
      browserEntryPointGuard: "not-run",
      browserEntryPoints: [],
      note: "Use --verify to run the fresh no-browser evidence gate.",
      checks: [],
    };
  }
  const browserPatterns = [
    /(?:from\s*|import\s*\(|require\s*\()\s*["']playwright["']/,
    /(?:chromium|firefox|webkit)\.launch\s*\(/,
    /(?:from\s*|import\s*\(|require\s*\()\s*["']puppeteer["']/,
    /(?:^|[\\/])shot\.mjs(?:["']|$)/m,
  ];
  const importPattern = /(?:from\s*|import\s*\()\s*["'](\.[^"']+)["']/g;
  const scanned = new Set();
  const browserEntryPoints = [];
  function scanLocalModule(relative) {
    const absolute = path.resolve(ROOT, relative);
    if (scanned.has(absolute) || !absolute.startsWith(`${ROOT}${path.sep}`) || !fs.existsSync(absolute)) return;
    scanned.add(absolute);
    const source = fs.readFileSync(absolute, "utf8");
    if (browserPatterns.some((pattern) => pattern.test(source))) {
      browserEntryPoints.push(path.relative(ROOT, absolute).split(path.sep).join("/"));
    }
    for (const match of source.matchAll(importPattern)) {
      let dependency = path.resolve(path.dirname(absolute), match[1]);
      if (!path.extname(dependency)) {
        for (const extension of [".mjs", ".js", ".py"]) {
          if (fs.existsSync(`${dependency}${extension}`)) {
            dependency = `${dependency}${extension}`;
            break;
          }
        }
      }
      scanLocalModule(path.relative(ROOT, dependency));
    }
  }
  for (const [, , script] of VERIFIERS) scanLocalModule(script);
  if (browserEntryPoints.length) {
    return {
      status: "fail",
      browserEntryPointGuard: "fail",
      browserEntryPoints: [...new Set(browserEntryPoints)].sort(),
      note: "The no-browser verifier graph contains a browser entry point.",
      checks: [],
    };
  }
  const checks = VERIFIERS.map(([name, runner, script, extraEnv = {}]) => {
    const precomputed = PRECOMPUTED_VERIFIER_RESULTS.get(name);
    if (precomputed) {
      return {
        name,
        status: precomputed.status === 0 ? "pass" : "fail",
        elapsedMs: 0,
        reusedFreshResult: true,
        output: precomputed.status === 0
          ? undefined
          : `${precomputed.stdout || ""}\n${precomputed.stderr || ""}`.trim(),
      };
    }
    const started = Date.now();
    const result = spawnSync(runner, [script], {
      cwd: ROOT,
      env: { ...process.env, ...extraEnv },
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      shell: process.platform === "win32" && runner === "python",
      windowsHide: true,
    });
    return {
      name,
      status: result.status === 0 ? "pass" : "fail",
      elapsedMs: Date.now() - started,
      output: result.status === 0 ? undefined : `${result.stdout || ""}\n${result.stderr || ""}`.trim(),
    };
  });
  return {
    status: checks.every((check) => check.status === "pass") ? "pass" : "fail",
    browserEntryPointGuard: "pass",
    browserEntryPoints: [],
    note: "The recursively scanned verifier graph contains no Playwright/Puppeteer/browser launch entry point.",
    checks,
  };
}

const report = {
  schemaVersion: 1,
  definitionVersion: DEFINITION_VERSION,
  generatedAt: new Date().toISOString(),
  scope: {
    renderer: "Pokemon TCG Pocket card detail renderer",
    officialSample: "PTCGP 1.6.0 / Unity 2022.3.62f2",
    canonicalScenes: CANONICAL_SCENES,
    denominatorPolicy: "10 equal-weight dimensions; exact subscopes only; inferred/runtime-required/missing/unknown remain in the denominator",
    evidenceValidityPolicy: "runtime captures are source-hash-bound, artifact-valid as a whole, nonempty, and must report zero Canvas fallbacks",
    screenshotPolicy: "No screenshot or image-similarity input is used by this audit.",
  },
  score: {
    auditObligationExactPercent: exactScore,
    freshAuditObligationExactPercent: verification.status === "pass" ? exactScore : null,
    knownImplementationPercent: knownCoverage,
    officialShaderRestorationPercent: null,
    officialShaderRestorationReason: "a percentage requires complete official guest dispatch/descriptors/uniforms plus independently proven Vulkan-to-WebGL semantics",
    claim: "versioned audit-obligation completion rate; not official shader fidelity or pixel similarity",
    auditReportCurrent: verification.status === "pass",
    officialFidelityReportable: false,
  },
  verification,
  runtimeDisplayFidelity,
  officialRuntimeQuality,
  counts: Object.fromEntries([...STATUS].map((status) => [
    status,
    allRequirements.filter((item) => item.status === status).length,
  ])),
  dimensions: summarized,
};

function pct(value) {
  return `${value.toFixed(1)}%`;
}

function printHuman() {
  console.log("Official renderer restoration audit (no screenshots)");
  console.log(`definition:       v${DEFINITION_VERSION}`);
  console.log(`fresh evidence:   ${verification.status} (${verification.checks.length} no-browser checks)`);
  console.log(`audit obligations:${report.score.freshAuditObligationExactPercent == null ? "   unavailable (fresh gate failed)" : pct(report.score.freshAuditObligationExactPercent).padStart(15)}`);
  console.log("official shader:  unavailable (guest/runtime/backend semantic proof incomplete)");
  console.log(`known coverage:   ${pct(report.score.knownImplementationPercent)}  (includes inferred work; not fidelity)`);
  console.log(`requirements:     ${allRequirements.length}`);
  console.log(`status counts:    ${[...STATUS].map((s) => `${s}=${report.counts[s]}`).join(" ")}`);
  if (verification.status === "fail") {
    console.log("");
    console.log("Failed evidence checks");
    for (const check of verification.checks.filter((entry) => entry.status === "fail")) {
      console.log(`FAIL ${check.name} (${check.elapsedMs}ms)`);
      for (const line of String(check.output || "").split(/\r?\n/).filter(Boolean).slice(-30)) {
        console.log(`  ${line}`);
      }
    }
  }
  console.log("");
  console.log("Equal-weight dimensions");
  for (const dimension of summarized) {
    console.log(`${dimension.label.padEnd(42)} ${pct(dimension.exactPercent).padStart(7)} exact  ${pct(dimension.knownPercent).padStart(7)} known  ${dimension.exactUnits}/${dimension.totalUnits}`);
  }
  console.log("");
  console.log("Remaining non-exact obligations");
  for (const item of allRequirements.filter((entry) => entry.status !== "exact")) {
    console.log(`${item.status.padEnd(16)} ${item.dimension}/${item.id}  cost=${item.cost}`);
    for (const remaining of item.remaining) console.log(`  - ${remaining}`);
  }
}

if (process.argv.includes("--json")) console.log(JSON.stringify(report, null, 2));
else printHuman();

if (verification.status === "fail") process.exitCode = 1;

export { report };
