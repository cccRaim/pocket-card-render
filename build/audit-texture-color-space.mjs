// Audit official Texture2D color-space metadata and the Gamma-workflow browser upload.
// Shader-slot names and scene-derived color/data guesses are diagnostics, not authority.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readOfficialPlayerPipeline } from "./official-player-pipeline.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC = path.join(ROOT, "public");
const manifest = JSON.parse(fs.readFileSync(path.join(PUBLIC, "texture-samplers.json"), "utf8"));
const official = readOfficialPlayerPipeline();
const app = fs.readFileSync(path.join(PUBLIC, "app.js"), "utf8");
const textureRuntime = fs.readFileSync(
  path.join(PUBLIC, "render", "official-texture.js"),
  "utf8",
);
const issues = [];

if (official.playerSettings.activeColorSpaceValue !== 0
    || official.playerSettings.activeColorSpace !== "Gamma") {
  issues.push("official PlayerSettings is not the pinned Gamma workflow");
}
if (manifest.schemaVersion !== 3) issues.push(`texture manifest schema ${manifest.schemaVersion} != 3`);

const entries = Object.entries(manifest.textures || {});
if (entries.length !== 131) issues.push(`expected 131 official Texture2D entries, got ${entries.length}`);
const colorSpaceCounts = new Map();
for (const [url, entry] of entries) {
  if (entry.colorSpace !== 0 && entry.colorSpace !== 1) {
    issues.push(`${url}: invalid official m_ColorSpace ${entry.colorSpace}`);
  }
  colorSpaceCounts.set(entry.colorSpace, (colorSpaceCounts.get(entry.colorSpace) || 0) + 1);
}
if (colorSpaceCounts.get(0) !== 46 || colorSpaceCounts.get(1) !== 85) {
  issues.push(`official m_ColorSpace distribution drifted: ${JSON.stringify(Object.fromEntries(colorSpaceCounts))}`);
}

if (!/texture\.colorSpace\s*=\s*THREE\.NoColorSpace/.test(textureRuntime)
    || !/texture\.premultiplyAlpha\s*=\s*false/.test(textureRuntime)
    || !/loadOfficialTexture\(url, officialSamplerMap\[url\]\)/.test(app)) {
  issues.push("browser runtime is not using the shared raw texture upload path");
}
if (/colorSpace\s*=\s*scene_data\.textureColorSpace/.test(app + textureRuntime)) {
  issues.push("Gamma runtime still consumes scene-derived per-texture color-space conversion");
}

let compared = 0;
let sceneMetadataMismatches = 0;
const mismatchedUrls = new Set();
for (const sceneName of fs.readdirSync(PUBLIC).filter((name) => /^scene\..*\.json$/.test(name))) {
  const scene = JSON.parse(fs.readFileSync(path.join(PUBLIC, sceneName), "utf8"));
  for (const [name, url] of Object.entries(scene.textures || {})) {
    const sceneValue = scene.textureColorSpace?.[name];
    const officialValue = manifest.textures[url]?.colorSpace;
    if (sceneValue === undefined || officialValue === undefined) continue;
    compared += 1;
    if (sceneValue !== officialValue) {
      sceneMetadataMismatches += 1;
      mismatchedUrls.add(url);
    }
  }
}

if (issues.length) {
  console.error(`Texture color-space audit failed: ${issues.length} issue(s)`);
  for (const issue of issues) console.error(`BAD ${issue}`);
  process.exit(1);
}

console.log("Official texture color-space audit OK");
console.log(`Player workflow:       ${official.playerSettings.activeColorSpace} (${official.playerSettings.activeColorSpaceValue})`);
console.log(`Official Texture2D:    ${entries.length}; m_ColorSpace 0=${colorSpaceCounts.get(0)}, 1=${colorSpaceCounts.get(1)}`);
console.log("Browser upload:        NoColorSpace, unpremultiplied, shared official loader");
console.log(`Scene metadata:        ${sceneMetadataMismatches}/${compared} references, ${mismatchedUrls.size}/${entries.length} unique textures differ`);
console.log("                       diagnostic only; Gamma runtime ignores scene-derived color-space guesses");
