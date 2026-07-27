import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readOfficialTextureSampler } from "./official-texture-sampler.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = path.join(ROOT, "public", "texture-samplers.json");
const publicPath = path.join(ROOT, "public");
const samplerCorpus = JSON.parse(fs.readFileSync(path.join(ROOT, "build", "texture-sampler-corpus.json"), "utf8"));
if (samplerCorpus.schemaVersion !== 1 || !Array.isArray(samplerCorpus.scenes)) {
  throw new Error("unsupported texture sampler corpus");
}
const scenePaths = samplerCorpus.scenes.map((file) => path.join(publicPath, file));
const official = readOfficialTextureSampler({ scenes: scenePaths });
const textures = {};
const runtimeTextures = {
  _DynamicUITex: {
    authority: "official Vulkan runtime capture descriptor and image state",
    evidence: {
      captureEventsSha256: "73a778aaff11d54cd77c6b40749e47eabdbef53b8615f31f47d14ec29020f0be",
      card: "cTR_20_000670_00_IIBUINOBAKKU_UR",
      shader: "Transparent_Hologram_Tuning",
      drawOrdinal: 20,
      provenance: "legacy capture; manifest provenance incomplete",
    },
    image: {
      width: 734,
      height: 1024,
      format: "VK_FORMAT_R8G8B8A8_UNORM",
      mipCount: 1,
    },
    rawVulkanSampler: {
      magFilter: "VK_FILTER_LINEAR",
      minFilter: "VK_FILTER_LINEAR",
      mipmapMode: "VK_SAMPLER_MIPMAP_MODE_NEAREST",
      addressModeU: "VK_SAMPLER_ADDRESS_MODE_CLAMP_TO_EDGE",
      addressModeV: "VK_SAMPLER_ADDRESS_MODE_CLAMP_TO_EDGE",
      anisotropyEnable: false,
      maxAnisotropy: 1,
    },
    // Normalized to the Unity-style values consumed by applyOfficialSampler().
    sampler: {
      filterMode: 1,
      filter: "Bilinear",
      anisotropy: 1,
      wrapU: 1,
      wrapV: 1,
      wrapW: 1,
      mipCount: 1,
    },
  },
};

for (const [url, entry] of Object.entries(official.textures)) {
  if (!entry.sampler || !entry.serialized || !entry.identity || !entry.payload || !entry.object) {
    throw new Error(`unresolved official texture payload: ${url}`);
  }
  textures[url] = {
    filterMode: entry.sampler.filterMode,
    filter: entry.sampler.filter,
    anisotropy: entry.sampler.anisotropy,
    mipBias: entry.sampler.mipBias,
    wrapU: entry.sampler.wrapUValue,
    wrapV: entry.sampler.wrapVValue,
    wrapW: entry.sampler.wrapWValue,
    mipCount: entry.serialized.mipCount,
    bundle: entry.bundle,
    pathId: entry.pathId,
    format: entry.format,
    colorSpace: entry.colorSpace,
    identity: entry.identity,
    identityCandidates: entry.candidates.map((candidate) => candidate.identity),
    object: entry.object,
    payload: entry.payload,
    serialized: entry.serialized,
    fallback: entry.fallback,
  };
}

const output = {
  schemaVersion: 3,
  authority: official.authority,
  source: official.source,
  summary: official.summary,
  referenceSceneHashes: Object.fromEntries(official.scenes.map((scene) => [scene.file, scene.sha256])),
  runtimeTextures,
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
