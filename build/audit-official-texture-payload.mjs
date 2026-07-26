import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import { readOfficialTextureSampler } from "./official-texture-sampler.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = path.join(ROOT, "public", "texture-samplers.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const official = readOfficialTextureSampler();
const runtimeSource = fs.readFileSync(path.join(ROOT, "public", "render", "official-texture.js"), "utf8");
const issues = [];
const SHA256 = /^[0-9a-f]{64}$/;

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function same(actual, expected, label) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) issues.push(`${label}: manifest differs from official extraction`);
}

if (manifest.schemaVersion !== 3) issues.push(`manifest schema ${manifest.schemaVersion} != 3`);
const dynamicUI = manifest.runtimeTextures?._DynamicUITex;
same(dynamicUI?.image, {
  width: 734,
  height: 1024,
  format: "VK_FORMAT_R8G8B8A8_UNORM",
  mipCount: 1,
}, "_DynamicUITex runtime image");
same(dynamicUI?.sampler, {
  filterMode: 1,
  filter: "Bilinear",
  anisotropy: 1,
  wrapU: 1,
  wrapV: 1,
  wrapW: 1,
  mipCount: 1,
}, "_DynamicUITex normalized sampler");
if (!SHA256.test(dynamicUI?.evidence?.captureEventsSha256 || "")) {
  issues.push("_DynamicUITex capture event identity is missing");
}
if (Object.keys(manifest.textures || {}).length !== 131) issues.push("manifest must contain 131 official texture URLs");
if (official.summary.unresolvedCount !== 0) issues.push(`official identities unresolved: ${official.summary.unresolved.join(", ")}`);

let fallbackFiles = 0;
let fallbackBytes = 0;
let mipLevels = 0;
let basePngMatches = 0;
for (const [url, extracted] of Object.entries(official.textures)) {
  const entry = manifest.textures[url];
  if (!entry) {
    issues.push(`${url}: missing manifest entry`);
    continue;
  }
  same(entry.identity, extracted.identity, `${url} identity`);
  same(entry.bundle, extracted.bundle, `${url} bundle`);
  same(entry.pathId, extracted.pathId, `${url} pathId`);
  same(entry.format, extracted.format, `${url} format`);
  same(entry.colorSpace, extracted.colorSpace, `${url} colorSpace`);
  same(entry.object, extracted.object, `${url} object`);
  same(entry.payload, extracted.payload, `${url} payload`);
  same(entry.serialized, extracted.serialized, `${url} serialized`);
  same(entry.fallback, extracted.fallback, `${url} fallback`);
  if (!SHA256.test(entry.identity?.bundleSha256 || "")
      || !SHA256.test(entry.identity?.objectSha256 || "")
      || !SHA256.test(entry.identity?.payloadSha256 || "")) {
    issues.push(`${url}: incomplete bundle/object/payload identity`);
  }
  if (entry.object?.sha256 !== entry.identity?.objectSha256) issues.push(`${url}: object identity hash mismatch`);
  if (entry.payload?.sha256 !== entry.identity?.payloadSha256) issues.push(`${url}: payload identity hash mismatch`);
  if (entry.format?.name === undefined || entry.format?.value === undefined || entry.colorSpace === undefined) {
    issues.push(`${url}: format/colorSpace metadata missing`);
  }

  let payloadOffset = 0;
  for (const [index, level] of (entry.payload?.mipLevels || []).entries()) {
    if (level.level !== index || level.offset !== payloadOffset || !SHA256.test(level.sha256 || "")) {
      issues.push(`${url}: invalid stored payload mip ${index}`);
    }
    payloadOffset += level.length;
  }
  if (payloadOffset !== entry.payload?.byteLength) issues.push(`${url}: stored mip levels do not consume payload`);

  const chain = entry.fallback?.rgba8MipChain;
  if (entry.mipCount > 1 && !chain) issues.push(`${url}: multi-mip texture has no deterministic fallback`);
  if (entry.format?.name?.startsWith("ASTC_HDR_")) {
    if (!chain) {
      issues.push(`${url}: ASTC HDR texture has no deterministic fallback`);
    } else if (chain.sourceEncoding !== entry.format.name
        || chain.decoder?.name !== "ARM astcenc"
        || !chain.decoder?.profile?.startsWith("HDR RGB/LDR alpha")
        || !SHA256.test(chain.decoder?.executableSha256 || "")) {
      issues.push(`${url}: ASTC HDR fallback lacks exact HDR decoder provenance`);
    }
  }
  if (!chain) continue;
  fallbackFiles += 1;
  fallbackBytes += chain.byteLength;
  mipLevels += chain.levels.length;
  const localPath = path.join(ROOT, "public", chain.url.replace(/^\//, ""));
  if (!fs.existsSync(localPath)) {
    issues.push(`${url}: fallback file missing at ${chain.url}`);
    continue;
  }
  const bytes = fs.readFileSync(localPath);
  if (bytes.length !== chain.byteLength || sha256(bytes) !== chain.sha256) {
    issues.push(`${url}: fallback file length/hash mismatch`);
  }
  let offset = 0;
  for (const [index, level] of chain.levels.entries()) {
    const expectedLength = level.width * level.height * 4;
    const slice = bytes.subarray(level.offset, level.offset + level.length);
    if (level.level !== index || level.offset !== offset || level.length !== expectedLength) {
      issues.push(`${url}: invalid RGBA8 fallback mip ${index}`);
    }
    if (sha256(slice) !== level.sha256) issues.push(`${url}: RGBA8 fallback mip ${index} hash mismatch`);
    offset += level.length;
  }
  if (offset !== bytes.length) issues.push(`${url}: RGBA8 fallback levels do not consume file`);

  const publicPngPath = path.join(ROOT, "public", url.replace(/^\//, ""));
  const publicPng = PNG.sync.read(fs.readFileSync(publicPngPath));
  const baseLevel = chain.levels[0];
  const baseBytes = bytes.subarray(baseLevel.offset, baseLevel.offset + baseLevel.length);
  if (publicPng.width !== baseLevel.width
      || publicPng.height !== baseLevel.height
      || sha256(publicPng.data) !== baseLevel.sha256
      || sha256(baseBytes) !== baseLevel.sha256) {
    issues.push(`${url}: gathered PNG does not match official fallback mip 0`);
  } else {
    basePngMatches += 1;
  }
}

const cardBack = manifest.textures["/game/Assets/Texture2D/Card_Back.png"];
const cardBackObjects = new Set(cardBack?.identityCandidates?.map((item) => item.objectSha256));
const cardBackPayloads = new Set(cardBack?.identityCandidates?.map((item) => item.payloadSha256));
if (cardBackObjects.size !== 2 || cardBackPayloads.size !== 1) {
  issues.push("Card_Back candidates must retain distinct object identities and payload-proven equivalence");
}
if (/generateMipmaps\s*=\s*true/.test(runtimeSource)) issues.push("runtime still enables browser mip generation");
if (!/new THREE\.DataTexture/.test(runtimeSource) || !/texture\.mipmaps\s*=\s*mipmaps/.test(runtimeSource)) {
  issues.push("runtime does not upload explicit official mip levels");
}
if (!/samplerState\?\.fallback\?\.rgba8MipChain/.test(runtimeSource)) {
  issues.push("runtime does not prefer an available deterministic official fallback");
}
if (/Canvas|canvas|getContext\s*\(/.test(runtimeSource)) issues.push("static official texture loader must not use Canvas");

if (fallbackFiles !== 4 || fallbackBytes !== 11194360 || mipLevels !== 38) {
  issues.push(`unexpected fallback set: ${fallbackFiles} files, ${fallbackBytes} bytes, ${mipLevels} levels`);
}

if (issues.length) {
  console.error(`Official texture payload audit failed: ${issues.length} issue(s)`);
  for (const issue of issues) console.error(`BAD ${issue}`);
  process.exit(1);
}

console.log("Official texture payload audit OK");
console.log(`textures:          ${Object.keys(manifest.textures).length}`);
console.log(`payload mip levels:${Object.values(manifest.textures).reduce((sum, entry) => sum + entry.payload.mipLevels.length, 0)}`);
console.log(`RGBA8 fallbacks:   ${fallbackFiles} files, ${fallbackBytes} bytes, ${mipLevels} levels`);
console.log(`Base PNG identity: ${basePngMatches}/${fallbackFiles} byte-exact`);
console.log("Card_Back:         2 object identities, 1 shared official payload identity");
console.log("Runtime:           explicit DataTexture mipmaps, generateMipmaps=false, no Canvas");
