// Audit the six serialized Effect selectors against their official shader bytes and local runtime wiring.
// The generator owns byte extraction and backend substitutions; this audit must not infer one default
// Effect variant or treat the legacy fallback shader as official evidence.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MANIFESTS = [
  "effect_eff1_uniforms.json",
  "effect_eff2_uniforms.json",
  "effect_eff3_uniforms.json",
  "effect_eff3_grad_uniforms.json",
  "effect_eff1_grad_view_uniforms.json",
  "effect_eff2_grad_view_uniforms.json",
];
const FIELDS = [
  "vertexSpirvSha256",
  "fragmentSpirvSha256",
  "parameterEntrySha256",
  "passStateSha256",
  "commonBindingsSha256",
];
const issues = [];

function sha256(source) {
  return crypto.createHash("sha256").update(source).digest("hex");
}

const generated = spawnSync(process.execPath, ["build/build-exact-effect.mjs", "--check"], {
  cwd: ROOT,
  encoding: "utf8",
  windowsHide: true,
});
if (generated.status !== 0) {
  issues.push(`selector generator check failed: ${(generated.stderr || generated.stdout).trim()}`);
}

const selectors = new Set();
const semantics = new Set();
for (const name of MANIFESTS) {
  const manifestFile = path.join(ROOT, "public", "shaders", name);
  if (!fs.existsSync(manifestFile)) {
    issues.push(`missing selector manifest ${name}`);
    continue;
  }
  const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
  const selector = manifest.official_selector;
  const identity = manifest.official_executable_identity;
  if (manifest.shader !== "Lettuce/Common/CardNew/Effect"
      || manifest.generated_by !== "build/build-exact-effect.mjs"
      || manifest.runtime_contract?.shader_key !== "Effect") {
    issues.push(`${name}: invalid shader/generator/runtime ownership`);
  }
  if (!selector?.selectorId || !selector?.semanticExecutableId || !selector?.shaderIdentity) {
    issues.push(`${name}: incomplete official selector identity`);
  } else {
    selectors.add(selector.selectorId);
    semantics.add(selector.semanticExecutableId);
  }
  if (FIELDS.some((field) => !/^[0-9a-f]{64}$/.test(identity?.[field] || ""))) {
    issues.push(`${name}: incomplete five-field executable identity`);
  }
  if (manifest.runtime_contract?.mrt_attachments !== 2
      || !manifest.runtime_contract?.require_complete_active_bindings) {
    issues.push(`${name}: incomplete MRT/runtime binding contract`);
  }
  if (manifest.mrt?.secondary_value !== "zero" || !manifest.mrt?.secondary) {
    issues.push(`${name}: Effect MRT1 must be declared as the official zero secondary attachment`);
  }
  if (manifest.webgl_adaptation?.schema !== "pocket-card-render/webgl-stage-adaptation@2"
      || !manifest.official_vertex_inputs
      || !manifest.webgl_adaptation.vertex.operations?.some(
        (row) => row.kind === "texture-coordinate-basis-conversion",
      )) {
    issues.push(`${name}: Effect port is not a typed texture-coordinate adaptation`);
  }
  const coordinateContract = manifest.runtime_contract?.texture_coordinates?.vertex;
  if (coordinateContract?.transforms?.length !== 1
      || coordinateContract.transforms[0]?.uniform !== "_MainTex_ST"
      || coordinateContract.transforms[0]?.slot !== "_MainTex") {
    issues.push(`${name}: missing _MainTex TexEnv coordinate contract`);
  }
  const viewSelector = manifest.selected_keywords.includes("_UseViewMask");
  if (viewSelector !== Boolean(coordinateContract?.tangentViewY)) {
    issues.push(`${name}: tangent-view V-axis conversion does not match selector keywords`);
  }
  const joinedSamplers = (manifest.sampler_bindings || []).map(({ slot, spirvName }) => ({ slot, spirvName }));
  if (JSON.stringify(joinedSamplers.map((row) => row.slot)) !== JSON.stringify(manifest.sampler_slots)
      || JSON.stringify(joinedSamplers.map((row) => row.spirvName)) !== JSON.stringify(manifest.samplers)) {
    issues.push(`${name}: sampler bindings are not joined from official binding numbers`);
  }
  for (const stage of ["vertex", "fragment"]) {
    const relative = manifest.webgl_sources?.[stage]?.replace(/^public\//, "");
    const file = relative ? path.join(ROOT, "public", relative.replace(/^shaders\//, "shaders/")) : null;
    const source = file && fs.existsSync(file) ? fs.readFileSync(file) : null;
    if (!source || sha256(source) !== manifest.webgl_adaptation?.[stage]?.outputSha256) {
      issues.push(`${name}: ${stage} WebGL source hash mismatch`);
    }
  }
}

for (const sceneName of fs.readdirSync(path.join(ROOT, "public"))
  .filter((name) => /^scene\..+\.json$/.test(name))) {
  const scene = JSON.parse(fs.readFileSync(path.join(ROOT, "public", sceneName), "utf8"));
  for (const [materialName, material] of Object.entries(scene.materials || {})) {
    if (material.shader !== "Effect") continue;
    for (const [slot, texture] of Object.entries(material.textures || {})) {
      if (![texture?.scale?.x, texture?.scale?.y, texture?.offset?.x, texture?.offset?.y]
        .every(Number.isFinite)) {
        issues.push(`${sceneName}:${materialName}.${slot}: official TexEnv scale/offset is missing`);
      }
    }
  }
}

if (selectors.size !== 6) issues.push(`expected 6 unique selectors, got ${selectors.size}`);
if (semantics.size !== 4) issues.push(`expected 4 unique semantic executables, got ${semantics.size}`);

const baseSource = fs.readFileSync(path.join(ROOT, "public", "render", "materials", "base.js"), "utf8");
const effectStart = baseSource.indexOf('defineMaterial("effect"');
const exactStart = baseSource.indexOf('ctx.exactShaderPort(r, "Effect")', effectStart);
const fallbackStart = baseSource.indexOf('ctx.compatibleStageSource("Effect")', effectStart);
if (effectStart < 0 || exactStart < effectStart || fallbackStart < exactStart) {
  issues.push("Effect exact selector dispatch must precede the non-exact fallback");
}
for (const marker of [
  'm.userData.exactShader = "Effect"',
  "m.userData.officialPassRuntime = exact.manifest.official_pass_runtime",
  "m.userData.officialSelector = exact.manifest.official_selector",
  "m.userData.officialExecutableIdentity = exact.manifest.official_executable_identity",
]) {
  if (!baseSource.includes(marker)) issues.push(`missing runtime evidence marker: ${marker}`);
}

if (issues.length) {
  console.error(`Effect selector audit failed: ${issues.length} issue(s) found`);
  for (const issue of issues) console.error(`BAD ${issue}`);
  process.exit(1);
}

console.log("Effect selector audit OK: 6 selectors / 4 semantic executables / 30 identity fields");
