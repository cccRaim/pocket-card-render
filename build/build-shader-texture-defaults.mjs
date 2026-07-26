import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { SHADER } from "../public/render/rarities.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT = path.join(ROOT, "public", "render", "shader-defaults.js");
const CHECK = process.argv.includes("--check") || process.env.PCR_BUILD_CHECK === "1";
const shaderRoot = process.env.PCR_SHADERS
  || "D:/DevProjectes/ptcgp-tools-master/masterdata_decoder/.output/decrypted/Common/Shader";

const result = spawnSync(process.env.PCR_PYTHON || "python", ["build/extract-shader-defaults.py"], {
  cwd: ROOT,
  env: process.env,
  shell: process.platform === "win32",
  input: JSON.stringify({ root: shaderRoot, shaders: Object.keys(SHADER).sort() }),
  encoding: "utf8",
  maxBuffer: 32 * 1024 * 1024,
});
if (result.error) throw result.error;
if (result.status !== 0) {
  throw new Error(`official Shader defaults extraction failed\n${result.stderr || result.stdout}`);
}

const official = JSON.parse(result.stdout);
if (official.missing?.length) {
  throw new Error(`official Shader defaults missing: ${official.missing.join(", ")}`);
}
const defaults = Object.fromEntries(Object.keys(SHADER).sort().map((shader) => [
  shader,
  Object.fromEntries(Object.entries(official.found[shader]?.textures || {}).sort(([a], [b]) => a.localeCompare(b))),
]).filter(([, textures]) => Object.keys(textures).length));

const source = [
  "// Generated from official Unity Shader m_ParsedForm.m_PropInfo by",
  "// build/build-shader-texture-defaults.mjs. Do not edit this table by hand.",
  "",
  `export const SHADER_TEXTURE_DEFAULTS = ${JSON.stringify(defaults, null, 2)};`,
  "",
].join("\n");

if (CHECK) {
  if (!fs.existsSync(OUTPUT) || fs.readFileSync(OUTPUT, "utf8").replace(/\r\n/g, "\n") !== source) {
    console.error("public/render/shader-defaults.js is stale; run npm run build:shader-texture-defaults");
    process.exit(1);
  }
  console.log(`official Shader texture defaults current: ${Object.keys(defaults).length} shaders`);
} else {
  fs.writeFileSync(OUTPUT, source);
  console.log(`generated official Shader texture defaults: ${Object.keys(defaults).length} shaders`);
}
