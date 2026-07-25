// Verify the browser Bloom graph without screenshots. Expected float bits and
// render states are decoded from the pinned official UpdateMesh/Shader bytes.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getOfficialBloomLayout } from "../public/render/pipeline/official-bloom.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = fs.readFileSync(path.join(ROOT, "public/render/pipeline/official-bloom.js"), "utf8");
const app = fs.readFileSync(path.join(ROOT, "public/app.js"), "utf8");
const issues = [];

function same(label, actual, expected) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    issues.push(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function floatBits(value) {
  const bytes = new ArrayBuffer(4);
  new DataView(bytes).setFloat32(0, value, false);
  return new DataView(bytes).getUint32(0, false).toString(16).padStart(8, "0");
}

function requireSource(label, pattern) {
  if (!pattern.test(source)) issues.push(`${label}: runtime source pattern missing`);
}

const layout = getOfficialBloomLayout(450, 800);
same("9:16 base size", layout.base, { width: 256, height: 455 });
same("pass 0 prefilter size", layout.prefilter, { width: 512, height: 910 });
same("sheet size", layout.sheet, { width: 420, height: 473 });
same("downsample sizes", layout.levels.map(({ width, height }) => [width, height]), [
  [256, 455], [128, 227], [64, 113], [32, 56], [16, 28],
]);
same("weight denominator bits", floatBits(layout.weightDenominator), "3ff80000");
same("weight bits", layout.levels.map(({ weight }) => floatBits(weight)), [
  "3f042108", "3e842108", "3e042108", "3d842108", "3d042108",
]);
same("atlas UV float bits", layout.levels.map(({ uv }) => uv.map(floatBits)), [
  ["3caf8af9", "3c9bdf87", "3f218619", "3f7b2103"],
  ["3f2c7ec9", "3c9bdf87", "3f7a83aa", "3eff7572"],
  ["3f2c7ec9", "3f0978b1", "3f538139", "3f46a148"],
  ["3f5e79e9", "3f0978b1", "3f71fb21", "3f27c7b6"],
  ["3f5e79e9", "3f3185ae", "3f683a85", "3f40ad30"],
]);
same("image-to-sheet NDC float bits", layout.levels.map(({ ndc }) => ndc.map(floatBits)), [
  ["bf750750", "bf764208", "3e861864", "3f764206"],
  ["3eb1fb24", "bf764208", "3f750754", "bb0a8e00"],
  ["3eb1fb24", "3d978b10", "3f270272", "3f0d4290"],
  ["3f3cf3d2", "3d978b10", "3f63f642", "3e9f1ed8"],
  ["3f3cf3d2", "3ec616b8", "3f50750a", "3f015a60"],
]);

requireSource("official pass sequence", /passSequence:\s*enabled\s*\?\s*\[0,\s*1,\s*1,\s*1,\s*1,\s*1,\s*2,\s*3,\s*3,\s*4,\s*5\]/);
requireSource("vertical blur first", /_Vector\.value\.set\(0,\s*1\)[\s\S]*?_Vector\.value\.set\(1,\s*0\)/);
requireSource("pass 4 One SrcAlpha", /applyBlendState\(pass4,\s*THREE\.OneFactor,\s*THREE\.SrcAlphaFactor\)/);
requireSource("pass 5 separate RGB and alpha blend", /applyBlendState\(pass5,\s*THREE\.OneFactor,\s*THREE\.OneFactor,\s*THREE\.ZeroFactor,\s*THREE\.OneFactor\)/);
requireSource("Bloom RGBA8 unsigned-byte linear descriptor", /format:\s*THREE\.RGBAFormat,[\s\S]*?internalFormat:\s*"RGBA8",[\s\S]*?type:\s*THREE\.UnsignedByteType,[\s\S]*?colorSpace:\s*THREE\.NoColorSpace,[\s\S]*?minFilter:\s*THREE\.LinearFilter,[\s\S]*?magFilter:\s*THREE\.LinearFilter/);
requireSource("Bloom descriptor disables depth stencil mip and MSAA", /depthBuffer:\s*false,[\s\S]*?stencilBuffer:\s*false,[\s\S]*?generateMipmaps:\s*false,[\s\S]*?samples:\s*0/);
requireSource("pass 5 direct additive scene ColorRT write", /draw\(fullMesh,\s*sceneTarget,\s*pass5,\s*"pass5-add-to-scene-color",\s*false\)/);
if (/targets\.color|color-attachment-rebind/.test(source)) {
  issues.push("pass 5 still uses an extra full-size color bridge target");
}
requireSource("official FinalBlit uniforms", /_BlitScaleBias:\s*\{\s*value:\s*new THREE\.Vector4\(1,\s*1,\s*0,\s*0\)[\s\S]*?_BlitMipLevel:\s*\{\s*value:\s*0\s*\}/);

if (/0\.227027|1\.384615|3\.230769|0\.316216|0\.070270/.test(app + source)) {
  issues.push("legacy five-tap Gaussian constants remain in the browser runtime");
}
if (!/createOfficialBloomPipeline/.test(app) || !/loadOfficialBloomPrograms/.test(app)
    || !/loadOfficialFinalBlitProgram/.test(app)) {
  issues.push("public/app.js is not wired to the official Bloom pipeline");
}

if (issues.length) {
  console.error(`Official Bloom runtime audit failed: ${issues.length} issue(s)`);
  for (const issue of issues) console.error(`BAD ${issue}`);
  process.exit(1);
}

console.log("Official Bloom runtime audit OK");
console.log(`base ${layout.base.width}x${layout.base.height}, prefilter ${layout.prefilter.width}x${layout.prefilter.height}, sheet ${layout.sheet.width}x${layout.sheet.height}`);
console.log(`levels ${layout.levels.map(({ width, height }) => `${width}x${height}`).join(" -> ")}`);
console.log(`weights ${layout.levels.map(({ weight }) => weight).join(" + ")}`);
