// Guard the browser-side postprocess bridge against visual tuning that is not
// present in the pinned official Bloom programs and serialized pass state.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const app = fs.readFileSync(path.join(ROOT, "public", "app.js"), "utf8");
const textureRuntime = fs.readFileSync(path.join(ROOT, "public", "render", "official-texture.js"), "utf8");
const bloom = fs.readFileSync(path.join(ROOT, "public", "render", "pipeline", "official-bloom.js"), "utf8");

const issues = [];

if (/uBloom\b|0\.227027|1\.384615|3\.230769|0\.316216|0\.070270/.test(app + bloom)) {
  issues.push("browser runtime still contains the removed hand-tuned Bloom composite/Gaussian path");
}
if (!/const cardTargetColorSpace\s*=\s*THREE\.NoColorSpace/.test(app)) {
  issues.push("public/app.js: card-sheet render targets must preserve raw shader output");
}
if (!/renderer\.outputColorSpace\s*=\s*THREE\.LinearSRGBColorSpace/.test(app)) {
  issues.push("public/app.js: renderer output must avoid implicit sRGB encoding during card-sheet compositing");
}
if (!/colorSpace:\s*THREE\.NoColorSpace/.test(bloom)
    || !/target\.texture\.colorSpace\s*=\s*THREE\.NoColorSpace/.test(bloom)) {
  issues.push("official Bloom render targets must preserve raw shader output");
}
if (!/texture\.colorSpace\s*=\s*THREE\.NoColorSpace/.test(textureRuntime)
  || !/loadOfficialTexture\(url, officialSamplerMap\[url\]\)/.test(app)) {
  issues.push("public/app.js: official Gamma workflow requires raw scene texture samples");
}
if (!/texture\.premultiplyAlpha\s*=\s*false/.test(textureRuntime)
  || !/loadOfficialTexture\(url, officialSamplerMap\[url\]\)/.test(app)) {
  issues.push("public/app.js: texture upload must explicitly preserve unpremultiplied stored RGB");
}
if (/\bbgRT\b|\bbgQuad\b|window\.__bg/.test(app)) {
  issues.push("public/app.js: legacy single-target UR background precompose must not bypass the official MRT");
}
if (!/window\.__post\s*=\s*makeBloomPass\(hasBloomProducer\)/.test(app)
    || !/sceneUsesBloomProducer\(scene_data\.materials,\s*exactShaders\)/.test(app)) {
  issues.push("public/app.js: all cards must render through the final postprocess encode pass");
}
if (!/loadOfficialBloomPrograms/.test(app) || !/createOfficialBloomPipeline/.test(app)) {
  issues.push("public/app.js: official six-pass Bloom programs are not wired into the runtime");
}
if (!/loadOfficialFinalBlitProgram/.test(app)
    || !/_BlitScaleBias:\s*\{\s*value:\s*new THREE\.Vector4\(1,\s*1,\s*0,\s*0\)/.test(bloom)
    || !/_BlitMipLevel:\s*\{\s*value:\s*0\s*\}/.test(bloom)) {
  issues.push("official FinalBlit program/scaleBias/mip-0 state is not wired into the runtime");
}
if (!/post\.apply\(\)/.test(app)
    || !/setHomographyDisplayPoints/.test(app)
    || !/renderer\.render\(displayScene,\s*displayCamera\)/.test(app)
    || !/displayPost\.present\(\)/.test(app)) {
  issues.push("public/app.js: Bloom and Homography MRT must finish before the final presentation pass");
}
if (!/applyBlendState\(pass5,\s*THREE\.OneFactor,\s*THREE\.OneFactor,\s*THREE\.ZeroFactor,\s*THREE\.OneFactor\)/.test(bloom)) {
  issues.push("official Bloom pass 5 RGB/alpha blend state is missing");
}
if (!/draw\(fullMesh,\s*sceneTarget,\s*pass5,\s*"pass5-add-to-scene-color",\s*false\)/.test(bloom)) {
  issues.push("official Bloom pass 5 direct scene ColorRT write is missing");
}
if (/targets\.color|color-attachment-rebind/.test(bloom)) {
  issues.push("Bloom pass 5 must not use an extra full-size ColorRT bridge");
}
if (/pcrLinearToSrgb|linearToSrgb|colorspace_fragment/i.test(bloom)) {
  issues.push("official Gamma-workflow Bloom pipeline must not add a display transfer");
}

if (issues.length) {
  console.error(`Postprocess assumption audit failed: ${issues.length} issue(s) found`);
  for (const issue of issues) console.error(`BAD ${issue}`);
  process.exit(1);
}

console.log("Postprocess assumption audit OK");
