// Compare the renderer's shader texture defaults against the official Unity ShaderLab defaults.
// Source of truth: decrypted Common/Shader bundles, m_ParsedForm.m_PropInfo.m_Props[].m_DefTexture.
import { execSync } from "node:child_process";
import { SHADER } from "../public/render/rarities.js";
import { SHADER_TEXTURE_DEFAULTS } from "../public/render/shader-defaults.js";

const shaderRoot = process.env.PCR_SHADERS
  || "D:/DevProjectes/ptcgp-tools-master/masterdata_decoder/.output/decrypted/Common/Shader";
const shaderNames = Object.keys(SHADER).sort();
const supportedDefaults = new Set(["black", "white", "bump", "clear"]);

let official;
try {
  const stdout = execSync("python build/extract-shader-defaults.py", {
    input: JSON.stringify({ root: shaderRoot, shaders: shaderNames }),
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
    stdio: ["pipe", "pipe", "inherit"],
  });
  official = JSON.parse(stdout);
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
const rows = [];

for (const shader of official.missing) {
  rows.push({ ok: false, shader, slot: "", reason: "shader not found in official bundles" });
}

for (const shader of shaderNames) {
  const officialDefaults = official.found[shader]?.textures || {};
  const localDefaults = SHADER_TEXTURE_DEFAULTS[shader] || {};
  for (const [slot, officialValue] of Object.entries(officialDefaults)) {
    const localValue = localDefaults[slot];
    rows.push({
      ok: localValue === officialValue,
      shader,
      slot,
      official: officialValue,
      local: localValue ?? "(missing)",
      reason: localValue === officialValue ? "matches" : "default mismatch",
    });
  }
  for (const [slot, localValue] of Object.entries(localDefaults)) {
    if (officialDefaults[slot]) continue;
    rows.push({
      ok: false,
      shader,
      slot,
      official: "(none)",
      local: localValue,
      reason: "extra local default",
    });
  }
}

for (const row of rows) {
  if (row.ok && supportedDefaults.has(row.local)) continue;
  if (!row.ok) continue;
  row.ok = false;
  row.reason = `unsupported default texture ${row.local}`;
}

const grouped = new Map();
for (const row of rows) {
  const key = [row.ok, row.reason, row.shader].join("|");
  if (!grouped.has(key)) grouped.set(key, { ...row, count: 0, examples: [] });
  const item = grouped.get(key);
  item.count += 1;
  if (item.examples.length < 5) item.examples.push(`${row.slot}:${row.local}/${row.official}`);
}

for (const row of [...grouped.values()].sort((a, b) => a.shader.localeCompare(b.shader) || a.reason.localeCompare(b.reason))) {
  const mark = row.ok ? "OK " : "BAD";
  console.log(`${mark} ${row.shader.padEnd(35)} ${row.reason.padEnd(28)} count=${String(row.count).padStart(2)}`);
  console.log(`     e.g. ${row.examples.join(", ")}`);
}

const bad = rows.filter((row) => !row.ok);
if (bad.length) {
  console.error(`\n${bad.length} shader default issue(s) found.`);
  process.exitCode = 1;
}
