import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readOfficialTextureSampler } from "./official-texture-sampler.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const samplerCorpus = JSON.parse(
  fs.readFileSync(path.join(ROOT, "build", "texture-sampler-corpus.json"), "utf8"),
);
const official = readOfficialTextureSampler({
  scenes: samplerCorpus.scenes.map((file) => path.join(ROOT, "public", file)),
});
const issues = [];
const entries = Object.values(official.textures);
const app = fs.readFileSync(path.join(ROOT, "public", "app.js"), "utf8");
const context = fs.readFileSync(path.join(ROOT, "public", "render", "context.js"), "utf8");
const textureRuntime = fs.readFileSync(path.join(ROOT, "public", "render", "official-texture.js"), "utf8");

function countBy(values, selector) {
  const counts = new Map();
  for (const value of values) {
    const key = selector(value);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return Object.fromEntries([...counts.entries()].sort(([a], [b]) => String(a).localeCompare(String(b))));
}

if (official.schemaVersion !== 1) issues.push(`unsupported schema version ${official.schemaVersion}`);
if (official.scenes.length !== samplerCorpus.scenes.length) {
  issues.push(`expected ${samplerCorpus.scenes.length} reference scenes, got ${official.scenes.length}`);
}
if (official.summary.unresolvedCount !== 0) {
  issues.push(`unresolved official texture identities: ${official.summary.unresolved.join(", ")}`);
}

for (const entry of entries) {
  if (!entry.sampler || !entry.serialized) {
    issues.push(`${entry.url}: sampler fields are unavailable (${entry.resolution})`);
    continue;
  }
  if (!entry.candidates.length) issues.push(`${entry.url}: missing official object evidence`);
  for (const candidate of entry.candidates) {
    const identity = candidate.identity;
    if (!/^[0-9a-f]{64}$/.test(identity.bundleSha256)) {
      issues.push(`${entry.url}: invalid bundle SHA-256 for ${identity.bundle}`);
    }
    if (!identity.cab || !identity.pathId) issues.push(`${entry.url}: missing CAB/PathID identity`);
  }
  if (!["Point", "Bilinear"].includes(entry.sampler.filter)) {
    issues.push(`${entry.url}: unexpected filter ${entry.sampler.filter}`);
  }
  for (const axis of ["wrapU", "wrapV", "wrapW"]) {
    if (!["Repeat", "Clamp"].includes(entry.sampler[axis])) {
      issues.push(`${entry.url}: unexpected ${axis} ${entry.sampler[axis]}`);
    }
  }
  if (entry.sampler.anisotropy === 4) {
    issues.push(`${entry.url}: official anisotropy unexpectedly equals renderer default 4`);
  }
}

for (const scene of official.scenes) {
  const sceneEntries = scene.textureUrls.map((url) => official.textures[url]);
  const filters = countBy(sceneEntries, (entry) => entry.sampler?.filter || "missing");
  const expectedPoint = scene.rarity === "UR" ? 7 : 0;
  const actualPoint = filters.Point || 0;
  const actualBilinear = filters.Bilinear || 0;
  if (actualPoint !== expectedPoint) {
    issues.push(`${scene.file}: expected ${expectedPoint} Point textures, got ${actualPoint}`);
  }
  if (actualPoint + actualBilinear !== sceneEntries.length) {
    issues.push(`${scene.file}: non-Point/Bilinear filters found ${JSON.stringify(filters)}`);
  }
}

const mipChains = entries.filter((entry) => (entry.serialized?.mipCount || 0) > 1);
const expectedMipChains = new Map([
  ["card_rarity_outline", 6],
  ["cPK_10_000040_00_FUSHIGIBANAex_RR_L_MASK", 11],
  ["cPK_20_008900_02_HOUOUex_UR_L_TM", 11],
  ["SR-TR_RMP_UI", 10],
]);
if (mipChains.length !== expectedMipChains.size) {
  issues.push(`expected ${expectedMipChains.size} official mip chains, got ${mipChains.length}`);
}
for (const [name, expectedCount] of expectedMipChains) {
  const found = mipChains.find((entry) => entry.objectName === name);
  if (!found) issues.push(`missing official mip chain ${name}`);
  else if (found.serialized.mipCount !== expectedCount) {
    issues.push(`${name}: expected mipCount=${expectedCount}, got ${found.serialized.mipCount}`);
  }
}

if (!/fetch\("texture-samplers\.json"\)/.test(app)
  || !/loadOfficialTexture\(url, officialSamplerMap\[url\]\)/.test(app)) {
  issues.push("browser runtime does not consume the official per-texture sampler map");
}
if (!/runtimeTextures\?\._DynamicUITex\?\.sampler/.test(app)
  || !/applyOfficialSampler\(t, samplerState\)/.test(app)) {
  issues.push("browser runtime does not consume the captured _DynamicUITex sampler contract");
}
if (!/NearestFilter/.test(textureRuntime) || !/LinearMipmapNearestFilter/.test(textureRuntime)) {
  issues.push("browser runtime does not map official Point/Bilinear+mip state");
}
if (/anisotropy\s*=\s*4/.test(textureRuntime)) issues.push("browser runtime still hard-codes anisotropy=4");
if (/\.wrapS\s*=\s*c\.wrapT\s*=\s*THREE\.RepeatWrapping/.test(context)) {
  issues.push("material slot helper still overwrites official per-texture wrap state");
}

if (issues.length) {
  console.error(`Official texture sampler audit failed: ${issues.length} issue(s) found`);
  for (const issue of issues) console.error(`BAD ${issue}`);
  process.exit(1);
}

console.log("Official texture sampler audit OK");
console.log(`reference scenes:      ${official.scenes.length}`);
console.log(`unique texture URLs:   ${entries.length}`);
console.log(`identity resolution:   ${official.summary.exactCount} exact, ${official.summary.equivalentCandidateCount} equivalent-candidate`);
console.log(`filter distribution:   ${JSON.stringify(countBy(entries, (entry) => entry.sampler.filter))}`);
console.log(`wrap U distribution:   ${JSON.stringify(countBy(entries, (entry) => entry.sampler.wrapU))}`);
console.log(`anisotropy distribution:${JSON.stringify(countBy(entries, (entry) => entry.sampler.anisotropy))}`);
console.log(`official mip chains:   ${mipChains.map((entry) => `${entry.objectName}:${entry.serialized.mipCount}`).join(", ")}`);
