// Compare browser-wide color handling with PlayerSettings and GraphicsSettings
// extracted directly from the official APKM's globalgamemanagers.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readOfficialPlayerPipeline } from "./official-player-pipeline.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const app = fs.readFileSync(path.join(ROOT, "public", "app.js"), "utf8");
const textureRuntime = fs.readFileSync(path.join(ROOT, "public", "render", "official-texture.js"), "utf8");
const bloom = fs.readFileSync(path.join(ROOT, "public", "render", "pipeline", "official-bloom.js"), "utf8");
const official = readOfficialPlayerPipeline();
const player = official.playerSettings;
const graphics = official.graphicsSettings;
const createRT = official.asset3DRenderer.createRenderTexture;
const issues = [];

if (player.activeColorSpaceValue !== 0 || player.activeColorSpace !== "Gamma") {
  issues.push(`unsupported official color space: ${player.activeColorSpace} (${player.activeColorSpaceValue})`);
}
if (!/texture\.colorSpace\s*=\s*THREE\.NoColorSpace/.test(textureRuntime)
    || !/loadOfficialTexture\(url, officialSamplerMap\[url\]\)/.test(app)) {
  issues.push("runtime textures must remain raw in the official Gamma workflow");
}
if (/colorSpace\s*=\s*scene_data\.textureColorSpace/.test(app + textureRuntime)) {
  issues.push("runtime must not enable per-texture sRGB decoding in the official Gamma workflow");
}
if (!/const cardTargetColorSpace\s*=\s*THREE\.NoColorSpace/.test(app)) {
  issues.push("card render targets must preserve raw gamma-domain shader output");
}
if (!/renderer\.outputColorSpace\s*=\s*THREE\.LinearSRGBColorSpace/.test(app)) {
  issues.push("browser framebuffer must not add an implicit sRGB encode");
}
if (!/applyBlendState\(pass5,\s*THREE\.OneFactor,\s*THREE\.OneFactor,\s*THREE\.ZeroFactor,\s*THREE\.OneFactor\)/.test(bloom)
    || !/post\.apply\(\)/.test(app)
    || !/setHomographyDisplayPoints/.test(app)
    || !/displayPost\.present\(\)/.test(app)) {
  issues.push("official Bloom pass 5 must add emissive RGB before the raw FinalBlit presentation pass");
}
if (/pcrLinearToSrgb|LinearToSrgb|linearToSrgb/i.test(app + bloom)) {
  issues.push("final composite contains an extra display transfer absent from Gamma workflow");
}
if (createRT.depthBits !== 24 || createRT.renderTextureFormatValue !== 0 || createRT.renderTextureFormat !== "ARGB32") {
  issues.push(`unsupported official card RT: depth=${createRT.depthBits}, format=${createRT.renderTextureFormat}`);
}
if (createRT.antiAliasingSetterCalled || createRT.antiAliasing !== 1) {
  issues.push("official CreateRenderTexture anti-aliasing behavior changed");
}
if (!/new THREE\.WebGLRenderer\(\{\s*canvas,\s*antialias:\s*false,\s*alpha:\s*true,\s*stencil:\s*true\s*\}\)/.test(app)) {
  issues.push("WebGL context anti-aliasing must match the official non-MSAA card target");
}
if (/samples:\s*[1-9]/.test(app)) {
  issues.push("card render targets must not enable MSAA absent from official CreateRenderTexture");
}

const hdrDisabled = !player.allowHDRDisplaySupport
  && !player.useHDRDisplay
  && graphics.tiers.every((tier) => !tier.useHDR);
if (!hdrDisabled) {
  issues.push("official global HDR state is no longer uniformly disabled; RT/postprocess assumptions need review");
}

if (issues.length) {
  console.error(`Official player pipeline audit failed: ${issues.length} issue(s) found`);
  for (const issue of issues) console.error(`BAD ${issue}`);
  process.exit(1);
}

console.log("Official player pipeline audit OK");
console.log(`APKM sha256:          ${official.source.apkmSha256}`);
console.log(`globalgamemanagers:   ${official.source.globalgamemanagersSha256}`);
console.log(`color space:          ${player.activeColorSpace} (${player.activeColorSpaceValue})`);
console.log(`HDR display/tier:     disabled`);
console.log(`selected quality:     ${official.qualitySettings.selectedName} (${official.qualitySettings.currentQuality})`);
console.log(`quality anti-alias:   ${official.qualitySettings.selectedAntiAliasing}`);
console.log(`card RT:             ${createRT.renderTextureFormat} depth=${createRT.depthBits} MSAA=${createRT.antiAliasing}`);
console.log(`CreateRT body sha256:${createRT.bodySha256}`);
