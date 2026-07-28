import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const NEUTRAL_SOURCE =
  "pocket-card-render/official-guest-common-value-unresolved@1";
const FLOW_SOURCE =
  "Card_ShadowBox_Effect_Flow component runtime (unresolved)";

function runExtractor() {
  const result = spawnSync(
    process.env.PYTHON || "python",
    ["-B", "build/extract_official_unbound_uniform_boundaries.py"],
    {
      cwd: ROOT,
      encoding: "utf8",
      windowsHide: true,
      shell: process.platform === "win32",
      maxBuffer: 4 * 1024 * 1024,
    },
  );
  if (result.status !== 0) {
    throw new Error(
      `unbound-uniform extractor failed\n${result.stderr || result.stdout}`,
    );
  }
  return JSON.parse(result.stdout);
}

function readManifest(name) {
  return JSON.parse(fs.readFileSync(
    path.join(ROOT, "public", "shaders", name),
    "utf8",
  ));
}

function floats(material) {
  return new Map(material.floatProperties);
}

const official = runExtractor();
assert.equal(
  official.schema,
  "pocket-card-render/official-unbound-uniform-boundaries@1",
);
assert.deepEqual(official.source.excludedInputs, [
  "scene JSON",
  "render recipe",
  "PNG",
  "GLB",
  "screenshot",
]);

const groups = new Map(official.groups.map((group) => [group.id, group]));
const legacyMaterial = groups.get("legacy-frame").materials[0];
const legacyFloats = floats(legacyMaterial);
assert.equal(legacyFloats.get("_CutOut"), 0.009999999776482582);
assert.equal(legacyFloats.get("_Cutoff"), 0.5);
assert.equal(legacyFloats.has("_CutOff"), false);

for (const material of groups.get("shadowbox-flow").materials) {
  const materialFloats = floats(material);
  assert.equal(materialFloats.get("_NoiseMaskSpeed"), 0.7300000190734863);
  assert.equal(materialFloats.has("_NoiseMaskNoiseSpeed"), false);
}

for (const name of [
  "frame_holo_legacy_uniforms.json",
  "frame_holo_2layer_legacy_uniforms.json",
]) {
  const manifest = readManifest(name);
  assert.equal(
    manifest.official_shader_property_defaults.floats._CutOut > 0,
    true,
  );
  assert.equal(
    manifest.runtime_contract.dynamic_uniforms._CutOff.source,
    NEUTRAL_SOURCE,
  );
  assert.equal(
    manifest.runtime_boundaries.some((boundary) =>
      boundary.status === "runtime-required"
      && boundary.payload?.includes("_CutOff")),
    true,
  );
}

for (const name of [
  "shadowbox_effect_flow_default_uniforms.json",
  "shadowbox_effect_flow_use_col4_uniforms.json",
  "shadowbox_effect_flow_use_old_noise_uniforms.json",
]) {
  const manifest = readManifest(name);
  assert.equal(
    manifest.official_shader_property_defaults.floats._NoiseMaskSpeed,
    1,
  );
  assert.equal(
    manifest.runtime_contract.dynamic_uniforms._NoiseMaskNoiseSpeed.source,
    FLOW_SOURCE,
  );
  assert.equal(
    manifest.runtime_boundaries.some((boundary) =>
      boundary.status === "runtime-required"
      && boundary.uniforms?.includes("_NoiseMaskNoiseSpeed")),
    true,
  );
}

const exactRuntimeSource = fs.readFileSync(
  path.join(ROOT, "public", "render", "materials", "exact-runtime.js"),
  "utf8",
);
assert.equal(
  exactRuntimeSource.includes(
    'name === "_NoiseMaskNoiseSpeed" ? recipe.floats?._NoiseMaskSpeed',
  ),
  false,
  "unproved Material aliases must not enter the runtime binding path",
);

console.log("Official unbound-uniform boundary audit OK");
console.log("  legacy frame:       _Cutoff != _CutOut != _CutOff");
console.log("  ShadowBox Flow:     _NoiseMaskSpeed != _NoiseMaskNoiseSpeed");
console.log("  local behavior:     exact-name binding, neutral unresolved value");
console.log("  remaining evidence: official guest constant-buffer values");
