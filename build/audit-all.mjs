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
  ["render-claim-contract", "build/audit-render-claim-contract.mjs"],
  ["scene-assets", "build/audit-scene-assets.mjs"],
  ["dynamic-ui-layout", "build/audit-dynamic-ui-layout.mjs"],
  ["postprocess-assumptions", "build/audit-postprocess-assumptions.mjs"],
  ["scene-alpha-mode", "build/audit-scene-alpha-mode.mjs"],
  ["texture-color-space", "build/audit-texture-color-space.mjs"],
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
  ["shader-defaults", "build/audit-shader-defaults.mjs"],
  ["shader-float-defaults", "build/audit-shader-float-defaults.mjs"],
  ["shader-color-defaults", "build/audit-shader-color-defaults.mjs"],
  ["shader-gating", "build/audit-shader-gating.mjs"],
  ["official-dead-fields", "build/audit-official-dead-fields.mjs"],
  ["official-mrt-usage", "build/audit-official-mrt-usage.mjs", {
    PCR_AUDIT_STRICT_MRT: "1",
  }],
  ["official-ur-core-constants", "build/audit-official-ur-core-constants.mjs"],
  ["official-effect-core", "build/audit-official-effect-core.mjs"],
  ["official-parallax-core", "build/audit-official-parallax-core.mjs"],
  ["official-flat-core", "build/audit-official-flat-core.mjs"],
  ["official-holo-core", "build/audit-official-holo-core.mjs"],
  ["official-ur-remainder-core", "build/audit-official-ur-remainder-core.mjs"],
  ["exact-frame-holo-ur", "build/build-exact-frame-holo-ur.mjs", { PCR_EXACT_CHECK: "1" }],
  ["exact-transparent-hologram", "build/build-exact-transparent-hologram-tuning.mjs", { PCR_EXACT_CHECK: "1" }],
  ["exact-basic-holograms", "build/build-exact-basic-holograms.mjs", { PCR_EXACT_CHECK: "1" }],
  ["exact-classic-holograms", "build/build-exact-classic-holograms.mjs", { PCR_EXACT_CHECK: "1" }],
  ["official-program-assets", "build/audit-official-program-assets.mjs"],
  ["evidence-threshold", "build/audit-evidence-threshold.mjs"],
  ["official-program-threshold", "build/audit-official-program-threshold.mjs"],
];

const interesting = /^(BAD|WARN)\b|issue\(s\) found|mismatch|missing|not found|TypeError|SyntaxError|Error:/i;
let failed = false;
const started = Date.now();

for (const [name, script, extraEnv = {}] of AUDITS) {
  const t0 = Date.now();
  const result = spawnSync(process.execPath, [script], {
    cwd: ROOT,
    env: { ...process.env, ...extraEnv },
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
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
