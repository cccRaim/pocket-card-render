// Run the complete renderer-evidence audit matrix with strict defaults.
//
// Individual audits stay useful while iterating, but this command is the
// single gate for "does the current scene/shader data still line up with the
// official assets and bytecode we know how to verify?"
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const verbose = process.argv.includes("--verbose");

const AUDITS = [
  ["official-version-boundary-tests", "build/test-official-version-boundaries.mjs"],
  ["official-version-boundaries", "build/audit-official-version-boundaries.mjs"],
  ["render-claim-contract", "build/audit-render-claim-contract.mjs"],
  ["official-player-pipeline", "build/audit-official-player-pipeline.mjs"],
  ["official-texture-samplers", "build/audit-official-texture-sampler.mjs"],
  ["texture-sampler-runtime-map", "build/build-official-texture-samplers.mjs", { PCR_EXACT_CHECK: "1" }],
  ["official-animation-timing", "build/audit-official-animation-timing.mjs"],
  ["official-kira-puyo", "build/audit-official-kira-puyo.mjs"],
  ["official-circular-kira", "build/audit-official-circular-kira.mjs"],
  ["circular-kira-state", "build/test-circular-kira.mjs"],
  ["bloom-activation", "build/test-bloom-activation.mjs"],
  ["official-android-lifecycle", "build/audit-official-android-lifecycle.mjs"],
  ["glitter-flow-state", "build/test-glitter-flow.mjs"],
  ["official-postprocess", "build/audit-official-postprocess.mjs"],
  ["official-bloom-program", "build/audit-official-bloom-program.mjs"],
  ["exact-bloom", "build/build-exact-bloom.mjs", { PCR_EXACT_CHECK: "1" }],
  ["official-bloom-runtime", "build/audit-official-bloom-runtime.mjs"],
  ["official-final-blit", "build/audit-official-final-blit.mjs"],
  ["exact-final-blit", "build/build-exact-final-blit.mjs", { PCR_EXACT_CHECK: "1" }],
  ["official-display-transfer", "build/audit-official-display-transfer.mjs"],
  ["display-transfer-runtime", "build/test-display-transfer-runtime.mjs", {
    PCR_DISPLAY_TRANSFER_STATIC_VERIFIED: "1",
  }],
  ["official-shader-precision", "build/audit-official-shader-precision.mjs"],
  ["official-shader-toolchain", "build/audit-official-shader-toolchain.mjs"],
  ["official-smolv-corpus-mutations", "build/test_official_smolv_corpus.py", {}, "python"],
  ["official-smolv-corpus", "build/audit-official-smolv-corpus.mjs"],
  ["shader-precision-runtime", "build/test-shader-precision-runtime.mjs"],
  ["official-pass-partition", "build/audit-official-pass-partition.mjs"],
  ["official-draw-order-native", "build/audit-official-draw-order-native.mjs"],
  ["official-unity-symbol-map", "build/audit-official-unity-symbol-map.mjs"],
  ["official-reference-sort-inputs", "build/audit-official-reference-sort-inputs.mjs"],
  ["official-material-sort-inputs", "build/audit-official-material-sort-inputs.mjs"],
  ["official-material-properties", "build/audit-official-material-properties.mjs"],
  ["official-pass-candidates", "build/audit-official-pass-candidates.mjs"],
  ["official-sort-input-producers", "build/audit-official-sort-input-producers.mjs"],
  ["official-instance-id-remapper", "build/audit-official-instance-id-remapper.mjs"],
  ["official-sort-command-branch", "build/audit-official-sort-command-branch.mjs"],
  ["official-srp-batcher", "build/audit-official-srp-batcher.mjs"],
  ["official-local-keyword-state", "build/audit-official-local-keyword-state.mjs"],
  ["official-sort-prefix-collisions", "build/audit-official-sort-prefix-collisions.mjs"],
  ["official-sort-collision-groups", "build/build-official-sort-collision-groups.mjs", { PCR_EXACT_CHECK: "1" }],
  ["official-sort-runtime-capture-tool", "build/audit-official-sort-runtime-capture-tool.mjs"],
  ["official-sort-runtime-import", "build/test-official-sort-runtime-import.mjs"],
  ["official-sort-captured-descriptor", "build/test-official-sort-captured-descriptor.mjs"],
  ["official-sort-capture-resolver", "build/test-official-sort-capture-resolver.mjs"],
  ["official-vulkan-runtime-import", "build/test-official-vulkan-runtime-import.mjs"],
  ["official-vulkan-runtime-capture", "build/audit-official-vulkan-runtime-capture.mjs"],
  ["official-local-field-diff", "build/audit-official-local-field-diff.mjs", { PCR_FIELD_DIFF_SELF_TEST: "1" }],
  ["official-draw-order-numeric", "build/test-official-draw-order.mjs"],
  ["official-camera-transform", "build/audit-official-camera-transform.mjs"],
  ["official-card-renderer", "build/audit-official-card-renderer.mjs"],
  ["official-card-display", "build/audit-official-card-display.mjs"],
  ["official-runtime-quality", "build/audit-official-runtime-quality.mjs"],
  ["official-touch-rotation", "build/audit-official-touch-rotation.mjs"],
  ["display-density-integration", "build/test-display-density-integration.mjs"],
  ["official-homography", "build/audit-official-homography.mjs"],
  ["exact-homography", "build/build-exact-homography.mjs", { PCR_EXACT_CHECK: "1" }],
  ["homography-runtime", "build/test-homography-runtime.mjs"],
  ["homography-display-runtime", "build/test-homography-display-runtime.mjs"],
  ["official-homography-wiring", "build/audit-official-homography-wiring.mjs"],
  ["official-card-display-contract", "build/build-official-card-display-contract.mjs", { PCR_EXACT_CHECK: "1" }],
  ["official-rendertexture-contract", "build/audit-official-rendertexture-contract.mjs"],
  ["official-ui-default-from-rt", "build/audit-official-ui-default-from-rt.mjs"],
  ["exact-ui-default-from-rt", "build/build-exact-ui-default-from-rt.mjs", { PCR_EXACT_CHECK: "1" }],
  ["official-ui-default-to-rt", "build/audit-official-ui-default-to-rt.mjs"],
  ["exact-ui-default-to-rt", "build/build-exact-ui-default-to-rt.mjs", { PCR_EXACT_CHECK: "1" }],
  ["official-side-back", "build/audit-official-side-back.mjs"],
  ["exact-side-back", "build/build-exact-side-back.mjs", { PCR_EXACT_CHECK: "1" }],
  ["scene-assets", "build/audit-scene-assets.mjs"],
  ["official-mesh-payload", "build/audit-official-mesh-payload.mjs"],
  ["official-card-font-contract", "build/audit-official-card-font-contract.mjs"],
  ["official-card-text-design", "build/build-official-card-text-design-contract.mjs", { PCR_CARD_TEXT_DESIGN_CHECK: "1" }],
  ["card-text-design-unicode", "build/test-card-text-design-unicode.mjs"],
  ["official-text-variant-corpus", "build/build-official-text-variant-corpus.mjs", { PCR_OFFICIAL_TEXT_VARIANT_CORPUS_CHECK: "1" }],
  ["official-text-variant-corpus-mutations", "build/test-official-text-variant-corpus.mjs"],
  ["official-text-variant-execution", "build/test-official-text-variant-execution.mjs"],
  ["official-card-examples", "build/build-official-card-examples.mjs", { PCR_OFFICIAL_CARD_EXAMPLES_CHECK: "1" }],
  ["official-card-example-mutations", "build/test-official-card-examples.mjs"],
  ["official-card-example-materialization", "build/test-materialize-official-card-examples.mjs"],
  ["dynamic-ui-layout", "build/audit-dynamic-ui-layout.mjs"],
  ["card-example-availability", "build/test-card-example-availability.mjs"],
  ["official-card-ui-layout", "build/build-official-card-ui-layout.mjs", { PCR_CARD_UI_LAYOUT_CHECK: "1" }],
  ["official-ugui-image-state", "build/audit-official-ugui-image-state.mjs"],
  ["official-ugui-resources", "build/audit-official-ugui-resources.mjs"],
  ["official-ugui-runtime-state", "build/audit-official-ugui-runtime-state.mjs"],
  ["official-card-corpus", "build/audit-official-card-corpus.mjs"],
  ["official-illustration-inventory", "build/audit-official-illustration-inventory.mjs"],
  ["official-shader-variant-selection", "build/audit-official-shader-variant-selection.mjs"],
  ["official-material-program-inventory", "build/audit-official-material-program-inventory.mjs"],
  ["official-program-port-contract", "build/build-official-program-port-contract.mjs", { PCR_PROGRAM_PORT_CONTRACT_CHECK: "1" }],
  ["official-program-port-generators", "build/audit-official-program-port-generators.mjs"],
  ["official-selector-program", "build/test_official_selector_program.py", {}, "python"],
  ["official-selector-program-batch", "build/test_official_selector_program_batch.py", {}, "python"],
  ["exact-selector-port-core", "build/test-exact-selector-port-core.mjs"],
  ["exact-port-loader", "build/test-exact-port-loader.mjs"],
  ["webgl-position-invariance-mutations", "build/test-webgl-position-invariance.mjs"],
  ["ui-affine-transform", "build/test-ui-affine-transform.mjs"],
  ["ui-affine-transform-integration", "build/test-ui-affine-transform-integration.mjs"],
  ["ugui-state-reducer", "build/test-ugui-state-reducer.mjs"],
  ["ugui-state-replay-integration", "build/test-ugui-state-replay-integration.mjs"],
  ["official-layout-fitters", "build/build-official-layout-fitters.mjs", { PCR_OFFICIAL_LAYOUT_FITTERS_CHECK: "1" }],
  ["layout-fitter-mutations", "build/test-layout-fitters.mjs"],
  ["layout-rebuilder-mutations", "build/test-layout-rebuilder.mjs"],
  ["webgl-adaptation-contract-mutations", "build/test-webgl-adaptation-contract.mjs"],
  ["webgl-runtime-port-contract-mutations", "build/test-webgl-runtime-port-contract.mjs"],
  ["dynamic-uniform-producer-mutations", "build/test-dynamic-uniform-producer.mjs"],
  ["webgl-adaptation-contract", "build/audit-webgl-adaptation-contract.mjs"],
  ["official-port-verifier-session", "build/test-official-port-verifier-session.mjs"],
  ["official-program-port-coverage", "build/audit-official-program-port-coverage.mjs", {
    PCR_PROGRAM_PORT_GENERATORS_EXTERNALLY_VERIFIED: "1",
  }],
  ["official-vertex-input-mutations", "build/test_official_vertex_inputs.py", {}, "python"],
  ["official-vertex-inputs", "build/audit_official_vertex_inputs.py", {}, "python"],
  ["official-mesh-vertex-binding-mutations", "build/test_official_mesh_vertex_bindings.py", {}, "python"],
  ["official-mesh-vertex-bindings", "build/audit_official_mesh_vertex_bindings.py", {}, "python"],
  ["runtime-source-identity", "build/test-runtime-source-identity.mjs"],
  ["official-locale-coverage", "build/audit-official-locale-coverage.mjs"],
  ["official-card-text-runtime", "build/audit-official-card-text-runtime.mjs"],
  ["card-text-resolver", "build/test-card-text-resolver.mjs"],
  ["carddata-corpus", "build/test-carddata-corpus.mjs"],
  ["compose-corpus", "build/test-compose-corpus.mjs"],
  ["official-inline-elements", "build/audit-official-inline-elements.mjs"],
  ["official-tmp-settings", "build/build-official-tmp-settings.mjs", { PCR_TMP_SETTINGS_CHECK: "1" }],
  ["official-tmp-fallback", "build/audit-official-tmp-fallback.mjs"],
  ["official-tmp-autosize-contract", "build/build-official-tmp-autosize.mjs", { PCR_TMP_AUTOSIZE_CHECK: "1" }],
  ["official-tmp-autosize", "build/audit-official-tmp-autosize.mjs"],
  ["official-tmp-line-layout-contract", "build/build-official-tmp-line-layout.mjs", { PCR_TMP_LINE_LAYOUT_CHECK: "1" }],
  ["official-tmp-line-layout", "build/audit-official-tmp-line-layout.mjs"],
  ["official-tmp-sdf", "build/audit-official-tmp-sdf.mjs"],
  ["official-tmp-glyph-metrics", "build/audit_official_tmp_glyph_metrics.py", {}, "python"],
  ["official-tmp-fontengine", "build/audit-official-tmp-fontengine.mjs"],
  ["official-tmp-atlas-pixels", "build/audit_official_tmp_atlas_pixels.py", {}, "python"],
  ["official-tmp-atlases", "build/build_official_tmp_atlases.py", { PCR_TMP_ATLAS_CHECK: "1" }, "python"],
  ["official-tmp-text-coverage", "build/audit-official-tmp-text-coverage.mjs"],
  ["official-tmp-font-data", "build/test-official-tmp-font-data.mjs"],
  ["official-tmp-rich-text", "build/test-official-tmp-rich-text.mjs"],
  ["official-tmp-sprite-contract", "build/build-official-tmp-sprite.mjs", { PCR_TMP_SPRITE_CHECK: "1" }],
  ["official-tmp-sprite", "build/audit-official-tmp-sprite.mjs"],
  ["official-tmp-sprite-program", "build/build-official-tmp-sprite-program.mjs", { PCR_OFFICIAL_TMP_SPRITE_PROGRAM_CHECK: "1" }],
  ["official-tmp-sprite-program-mutations", "build/test-official-tmp-sprite-program.mjs"],
  ["official-tmp-sprite-runtime", "build/test-official-tmp-sprite-runtime.mjs"],
  ["official-tmp-sprite-layout", "build/test-official-tmp-sprite-layout.mjs"],
  ["official-tmp-sdf-renderer", "build/test-official-tmp-sdf-renderer.mjs"],
  ["official-tmp-mesh", "build/audit-official-tmp-mesh.mjs"],
  ["official-tmp-glyph-quad", "build/audit-official-tmp-glyph-quad.mjs"],
  ["tmp-runtime-evidence", "build/audit-tmp-runtime-evidence.mjs"],
  ["full-runtime-evidence", "build/audit-full-runtime-evidence.mjs"],
  ["exact-tmp-sdf", "build/build-exact-tmp-sdf.mjs", { PCR_EXACT_CHECK: "1" }],
  ["localized-card-text", "build/prebuild_text.mjs", { PCR_TEXT_CHECK: "1" }],
  ["postprocess-assumptions", "build/audit-postprocess-assumptions.mjs"],
  ["scene-alpha-mode", "build/audit-scene-alpha-mode.mjs"],
  ["texture-color-space", "build/audit-texture-color-space.mjs"],
  ["texture-upload-runtime", "build/test-texture-upload-runtime.mjs"],
  ["official-texture-payload", "build/audit-official-texture-payload.mjs"],
  ["texture-mip-runtime", "build/test-texture-mip-runtime.mjs"],
  ["scene-texture-usage", "build/audit-scene-texture-usage.mjs"],
  ["scene-float-usage", "build/audit-scene-float-usage.mjs", {
    PCR_AUDIT_EXTRA_FLOATS: "1",
    PCR_AUDIT_STRICT_EXTRA_FLOATS: "1",
  }],
  ["scene-color-usage", "build/audit-scene-color-usage.mjs", {
    PCR_AUDIT_EXTRA_COLORS: "1",
    PCR_AUDIT_STRICT_EXTRA_COLORS: "1",
  }],
  ["scene-keyword-usage", "build/audit-scene-keyword-usage.mjs"],
  ["layer-coverage", "build/audit-layer-coverage.mjs"],
  ["render-state", "build/audit-render-state.mjs"],
  ["official-draw-state", "build/audit-official-draw-state.mjs"],
  ["shader-texture-defaults-current", "build/build-shader-texture-defaults.mjs", {
    PCR_BUILD_CHECK: "1",
  }],
  ["shader-defaults", "build/audit-shader-defaults.mjs"],
  ["shader-float-defaults", "build/audit-shader-float-defaults.mjs"],
  ["shader-color-defaults", "build/audit-shader-color-defaults.mjs"],
  ["shader-gating", "build/audit-shader-gating.mjs"],
  ["official-dead-fields", "build/audit-official-dead-fields.mjs"],
  ["official-mrt-outputs", "build/audit-official-mrt-outputs.mjs"],
  ["official-draw-coverage", "build/audit-official-draw-coverage.mjs"],
  ["three-mrt-runtime", "build/audit-three-mrt-runtime.mjs"],
  ["mrt-runtime", "build/test-mrt-runtime.mjs"],
  ["official-mrt-usage", "build/audit-official-mrt-usage.mjs", {
    PCR_AUDIT_STRICT_MRT: "1",
  }],
  ["official-ur-core-constants", "build/audit-official-ur-core-constants.mjs"],
  ["official-effect-core", "build/audit-official-effect-core.mjs"],
  ["official-parallax-core", "build/audit-official-parallax-core.mjs"],
  ["official-flat-core", "build/audit-official-flat-core.mjs"],
  ["official-holo-core", "build/audit-official-holo-core.mjs"],
  ["official-ur-remainder-core", "build/audit-official-ur-remainder-core.mjs"],
  ["exact-shader-port-selection", "build/test-exact-shader-port-selection.mjs"],
  ["simple-premultiply-hologram-port", "build/test-simple-premultiply-hologram-port.mjs"],
  ["official-pass-state", "build/test-official-pass-state.mjs"],
  ["stencil-region-binding", "build/test-stencil-region-binding.mjs"],
  ["official-program-assets", "build/audit-official-program-assets.mjs"],
  ["official-program-assets-contract", "build/test-official-program-assets-contract.mjs"],
  ["evidence-threshold", "build/audit-evidence-threshold.mjs"],
  ["official-program-threshold", "build/audit-official-program-threshold.mjs"],
];

const interesting = /^(BAD|WARN)\b|issue\(s\) found|mismatch|missing|not found|TypeError|SyntaxError|Error:/i;
let failed = false;
const started = Date.now();

for (const [name, script, extraEnv = {}, runner = process.execPath] of AUDITS) {
  const t0 = Date.now();
  const result = spawnSync(runner, [script], {
    cwd: ROOT,
    env: { ...process.env, ...extraEnv },
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    shell: process.platform === "win32" && runner === "python",
    windowsHide: true,
  });
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  if (verbose && result.stdout) process.stdout.write(result.stdout);
  if (verbose && result.stderr) process.stderr.write(result.stderr);

  if (result.status === 0) {
    console.log(`OK   ${name.padEnd(27)} ${elapsed}s`);
    continue;
  }

  failed = true;
  console.log(`FAIL ${name.padEnd(27)} ${elapsed}s`);
  const lines = `${result.stdout || ""}\n${result.stderr || ""}`
    .split(/\r?\n/)
    .filter(Boolean);
  const selected = lines.filter((line) => interesting.test(line));
  for (const line of (selected.length ? selected : lines.slice(-80))) {
    console.log(`     ${line}`);
  }
}

const total = ((Date.now() - started) / 1000).toFixed(1);
console.log(`${failed ? "FAIL" : "OK"}   audit-all ${total}s`);
if (failed) process.exitCode = 1;
