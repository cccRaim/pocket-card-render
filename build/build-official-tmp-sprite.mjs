import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { atomicWriteFileSync } from "./atomic-publish.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONTRACT = path.join(ROOT, "public", "render", "tmp-sprite-contract.json");
const PNG = path.join(ROOT, "public", "game", "tmp-sprites", "TextExSprite.png");
const check = process.argv.includes("--check") || process.env.PCR_TMP_SPRITE_CHECK === "1";
const extracted = JSON.parse(execFileSync(
  process.env.PYTHON || "python",
  ["-B", "build/extract_official_tmp_sprite.py"],
  {
    cwd: ROOT,
    encoding: "utf8",
    shell: process.platform === "win32",
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
    maxBuffer: 32 * 1024 * 1024,
  },
));
const png = Buffer.from(extracted._pngBase64, "base64");
delete extracted._pngBase64;

assert.equal(extracted.schemaVersion, 1);
assert.equal(extracted.unityVersion, "2022.3.62f2");
assert.equal(extracted.gameVersion, "1.6.0");
assert.deepEqual(extracted.preprocessor.spriteIndexTable.values, [0, 2, 1, 3]);
assert.deepEqual(extracted.preprocessor.fontTypeToSpriteIndex, {
  Black: 0,
  White: 2,
  BlackWithWhiteOutline: 1,
  ExBlack: 3,
});
assert.deepEqual(extracted.preprocessor.pokemonRuleSelection, {
  normalEx: "ExBlack",
  megaEx: "White",
});
assert.equal(extracted.spriteAsset.pathId, "840073264968542736");
assert.equal(extracted.spriteAsset.objectSha256, "e6f1c89e38810a0d8f99ae1a382a3e2f0a0ed05b03281f40f0c57644eea2dd55");
assert.equal(extracted.material.pathId, "-1050951510632854060");
assert.equal(extracted.material.objectSha256, "d5161b0bbbe99257643d3b9fd127b0433029beee5b87386eb796e20a5911b984");
assert.equal(extracted.texture.pathId, "3209478181533236899");
assert.equal(extracted.texture.objectSha256, "579de24c79adec19a721dc8e786acd527f5d6648f9506d6c30ce6da5856e24ea");
assert.equal(extracted.texture.compressedPayloadSha256, "041def58c34618782cf3ded71ce0b08283ea6c9a03effea79912265c005861a7");
assert.equal(extracted.texture.decodedRgbaSha256, "a5844651ffd27f40725e9eb1399f9d89bdded513ca6af502aec0c5279d1486e9");
assert.equal(extracted.texture.width, 512);
assert.equal(extracted.texture.height, 256);
assert.equal(extracted.texture.textureFormat, 47);
assert.deepEqual(extracted.spriteAsset.characters.map((entry) => [entry.name, entry.glyphIndex]), [
  ["ex_bl_01", 3],
  ["ex_wh_ol", 0],
  ["ex_wh", 2],
  ["ex_bl_02", 1],
]);
assert.deepEqual(extracted.spriteAsset.glyphs.map((entry) => [
  entry.index,
  entry.metrics.width,
  entry.metrics.height,
  entry.metrics.horizontalBearingY,
  entry.metrics.horizontalAdvance,
  entry.glyphRect.x,
  entry.glyphRect.y,
]), [
  [0, 138, 70, 60, 138, 0, 186],
  [1, 138, 70, 60, 138, 138, 186],
  [2, 138, 70, 60, 138, 0, 116],
  [3, 138, 70, 60, 138, 0, 46],
]);
assert.equal(png.length, extracted.texture.pngByteSize);

const serialized = `${JSON.stringify(extracted, null, 1)}\n`;
if (check) {
  assert.equal(fs.readFileSync(CONTRACT, "utf8"), serialized, "TMP sprite contract is stale");
  assert.deepEqual(fs.readFileSync(PNG), png, "TextExSprite PNG is stale");
  console.log("Official TMP sprite contract audit OK");
} else {
  atomicWriteFileSync(PNG, png);
  atomicWriteFileSync(CONTRACT, serialized);
  console.log(`wrote ${path.relative(ROOT, CONTRACT)} and ${path.relative(ROOT, PNG)}`);
}
console.log(`  4 glyphs; ${extracted.texture.width}x${extracted.texture.height}; ${extracted.texture.pngSha256}`);
