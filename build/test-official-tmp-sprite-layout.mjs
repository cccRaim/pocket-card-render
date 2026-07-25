import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  layoutOfficialTmpSprite,
  resolveOfficialTmpSprite,
} from "../public/render/tmp-sprite-data.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const contract = JSON.parse(fs.readFileSync(
  path.join(ROOT, "public", "render", "tmp-sprite-contract.json"),
  "utf8",
));
const manifest = JSON.parse(fs.readFileSync(
  path.join(ROOT, "public", "game", "tmp-fonts", "manifest.json"),
  "utf8",
));

assert.deepEqual(contract.preprocessor.spriteIndexTable.values, [0, 2, 1, 3]);
assert.equal(resolveOfficialTmpSprite(contract, 3).character.name, "ex_bl_01");
assert.equal(resolveOfficialTmpSprite(contract, 2).character.name, "ex_wh");

const font = Object.values(manifest.fonts).find((entry) => entry.face?.pointSize > 0);
assert(font, "no official TMP font with metrics");
const layout = layoutOfficialTmpSprite(contract, font.face, 3, 16, 16, 100, 80);
const expectedSpriteScale = 16 / font.face.pointSize * font.face.scale;
const expectedElementScale = font.face.ascentLine / 70 * 1.100000023841858 * expectedSpriteScale;
assert.equal(layout.spriteScale, expectedSpriteScale);
assert.equal(layout.elementScale, expectedElementScale);
assert.equal(layout.beforeAdvance, -0.16);
assert.equal(layout.afterAdvance, -1.6);
assert.equal(layout.left, 99.84);
assert.equal(layout.top, 80 - 60 * expectedElementScale);
assert.equal(layout.width, 138 * expectedElementScale);
assert.equal(layout.height, 70 * expectedElementScale);
assert.equal(layout.spriteAdvance, 138 * expectedElementScale);
assert.equal(layout.advance, -0.16 + 138 * expectedElementScale - 1.6);
assert.deepEqual(layout.source, { x: 0, y: 140, width: 138, height: 70 });

const generated = fs.readdirSync(path.join(ROOT, "public", "text"))
  .filter((name) => /^PK_.+\.json$/.test(name))
  .map((name) => [name, JSON.parse(fs.readFileSync(path.join(ROOT, "public", "text", name), "utf8"))]);
const exBodies = generated.flatMap(([name, value]) => (value.elements || [])
  .filter((entry) => entry.layoutPath?.endsWith("/ex_rule_description_txt_02") && entry.text.includes("\x03"))
  .map((entry) => [name, entry]));
assert(exBodies.length > 0, "canonical generated corpus has no [Img:ex] body");
for (const [name, body] of exBodies) {
  assert.equal(body.inlineEx?.spriteAssetId, contract.spriteAsset.pathId, `${name}: SpriteAsset identity`);
  assert.equal(body.inlineEx?.materialId, contract.material.pathId, `${name}: material identity`);
  assert.equal(body.inlineEx?.textureId, contract.texture.pathId, `${name}: texture identity`);
  assert.equal(body.inlineEx?.spriteIndex, 3, `${name}: normal ex sprite index`);
  assert.equal(body.inlineEx?.fontSize, 16, `${name}: localized tag font size`);
  assert.match(body.inlineEx?.tagSizeObjectSha256 || "", /^[0-9a-f]{64}$/, `${name}: tag-size source hash`);
}

console.log("Official TMP ex-sprite layout test OK");
console.log(`  ${exBodies.length} generated ex-rule bodies use TextExSprite index 3 at tag size 16`);
