// Guard the browser-side postprocess bridge against visual tuning that is not
// sourced from card shader data. The shader strategies already scale MRT RGB
// with _EmissivePattern/_EmissiveColor; the composite pass must not add another
// hand-tuned attenuation on top.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const app = fs.readFileSync(path.join(ROOT, "public", "app.js"), "utf8");

const issues = [];
const compositeStart = app.indexOf("const composite = new THREE.ShaderMaterial");
const compositeEnd = app.indexOf("const resize =", compositeStart);
const compositeBlock = compositeStart >= 0 && compositeEnd > compositeStart ? app.slice(compositeStart, compositeEnd) : "";

if (/uBloom:\s*\{\s*value:\s*0\.32\s*\}/.test(app)) {
  issues.push("public/app.js: bloom composite still uses the old hand-tuned 0.32 gain");
}
if (!/uBloom:\s*\{\s*value:\s*1(?:\.0)?\s*\}/.test(app)) {
  issues.push("public/app.js: bloom composite should use unity gain; shader data already scales MRT RGB");
}
if (!/const cardTargetColorSpace\s*=\s*THREE\.NoColorSpace/.test(app)) {
  issues.push("public/app.js: card-sheet render targets must preserve raw shader output");
}
if (!/renderer\.outputColorSpace\s*=\s*THREE\.LinearSRGBColorSpace/.test(app)) {
  issues.push("public/app.js: renderer output must avoid implicit sRGB encoding during card-sheet compositing");
}
if (!/const rtColorSpace\s*=\s*cardTargetColorSpace/.test(app)) {
  issues.push("public/app.js: card scene/bloom render targets must preserve raw shader output");
}
if (!/tex\.colorSpace\s*=\s*THREE\.NoColorSpace/.test(app)) {
  issues.push("public/app.js: official Gamma workflow requires raw scene texture samples");
}
if (!/tex\.premultiplyAlpha\s*=\s*false/.test(app)) {
  issues.push("public/app.js: texture upload must explicitly preserve unpremultiplied stored RGB");
}
if (!/bgRT\.texture\.colorSpace\s*=\s*cardTargetColorSpace/.test(app)) {
  issues.push("public/app.js: UR background render target must preserve raw shader output before it is sampled back");
}
if (!/window\.__post\s*=\s*makeBloomPass\(hasOfficialEmissive\)/.test(app)) {
  issues.push("public/app.js: all cards must render through the final postprocess encode pass");
}
if (!/bgQuad\s*=\s*new THREE\.Mesh[\s\S]+#include <colorspace_fragment>/.test(app)) {
  issues.push("public/app.js: UR background quad must pass through colorspace_fragment when sampling bgRT");
}
if (!/gl_FragColor\s*=\s*vec4\(base\.rgb\s*\+\s*glow,\s*base\.a\)/.test(compositeBlock)) {
  issues.push("public/app.js: Gamma-workflow postprocess must composite raw scene and glow values directly");
}
if (/pcrLinearToSrgb|linearToSrgb/i.test(compositeBlock)) {
  issues.push("public/app.js: Gamma-workflow composite must not add a display transfer");
}
if (/#include <colorspace_fragment>/.test(compositeBlock)) {
  issues.push("public/app.js: postprocess composite must not add a second colorspace_fragment encode");
}

if (issues.length) {
  console.error(`Postprocess assumption audit failed: ${issues.length} issue(s) found`);
  for (const issue of issues) console.error(`BAD ${issue}`);
  process.exit(1);
}

console.log("Postprocess assumption audit OK");
