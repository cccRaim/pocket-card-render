import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readOfficialTextureSampler } from "./official-texture-sampler.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = path.join(ROOT, "public", "texture-samplers.json");
const official = readOfficialTextureSampler();
const textures = {};

for (const [url, entry] of Object.entries(official.textures)) {
  if (!entry.sampler || !entry.serialized) throw new Error(`unresolved official sampler: ${url}`);
  textures[url] = {
    filterMode: entry.sampler.filterMode,
    filter: entry.sampler.filter,
    anisotropy: entry.sampler.anisotropy,
    mipBias: entry.sampler.mipBias,
    wrapU: entry.sampler.wrapUValue,
    wrapV: entry.sampler.wrapVValue,
    wrapW: entry.sampler.wrapWValue,
    mipCount: entry.serialized.mipCount,
  };
}

const output = {
  schemaVersion: 1,
  authority: official.authority,
  referenceSceneHashes: Object.fromEntries(official.scenes.map((scene) => [scene.file, scene.sha256])),
  textures,
};
const rendered = `${JSON.stringify(output, null, 2)}\n`;

if (process.argv.includes("--check") || process.env.PCR_EXACT_CHECK === "1") {
  const current = fs.existsSync(outputPath) ? fs.readFileSync(outputPath, "utf8") : "";
  if (current !== rendered) {
    console.error("public/texture-samplers.json is stale; run npm run build:official-texture-samplers");
    process.exit(1);
  }
  console.log(`Official texture sampler runtime map OK: ${Object.keys(textures).length} textures`);
} else {
  fs.writeFileSync(outputPath, rendered);
  console.log(`wrote public/texture-samplers.json: ${Object.keys(textures).length} textures`);
}
