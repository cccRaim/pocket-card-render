import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONTRACT = path.join(ROOT, "public", "render", "tmp-sprite-contract.json");
const PNG = path.join(ROOT, "public", "game", "tmp-sprites", "TextExSprite.png");
const TEXT = path.join(ROOT, "public", "text");

const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");

export function auditOfficialTmpSprite() {
  const contract = JSON.parse(fs.readFileSync(CONTRACT, "utf8"));
  assert.equal(contract.schemaVersion, 1);
  assert.equal(contract.source.fontBundle.sha256, "88364448d71939764df209474b760b8d30623eba85a165d7b822e2488cc10589");
  assert.equal(contract.spriteAsset.objectSha256, "e6f1c89e38810a0d8f99ae1a382a3e2f0a0ed05b03281f40f0c57644eea2dd55");
  assert.equal(contract.material.objectSha256, "d5161b0bbbe99257643d3b9fd127b0433029beee5b87386eb796e20a5911b984");
  assert.equal(contract.texture.objectSha256, "579de24c79adec19a721dc8e786acd527f5d6648f9506d6c30ce6da5856e24ea");
  assert.equal(sha256(fs.readFileSync(PNG)), contract.texture.pngSha256);
  assert.deepEqual(contract.preprocessor.spriteIndexTable.values, [0, 2, 1, 3]);
  assert.equal(contract.preprocessor.formatLiteral.value,
    "<space=-0.01em><size={0}><sprite={1}><space=-0.1em></size>");
  assert.equal(contract.preprocessor.fontTypeToSpriteIndex.ExBlack, 3);
  assert.equal(contract.preprocessor.fontTypeToSpriteIndex.White, 2);
  assert.equal(contract.preprocessor.pokemonRuleSelection.normalEx, "ExBlack");
  assert.equal(contract.preprocessor.pokemonRuleSelection.megaEx, "White");
  for (const method of Object.values(contract.preprocessor.methods)) {
    assert.match(method.rva, /^0x[0-9a-f]+$/);
    assert(method.byteSize > 0);
    assert.match(method.sha256, /^[0-9a-f]{64}$/);
  }

  let generatedBindingCount = 0;
  for (const name of fs.readdirSync(TEXT).filter((entry) => entry.endsWith(".json"))) {
    const document = JSON.parse(fs.readFileSync(path.join(TEXT, name), "utf8"));
    for (const element of document.elements || []) {
      if (!element.text?.includes("\x03")) continue;
      const binding = element.inlineEx;
      assert(binding, `${name}: [Img:ex] has no SpriteAsset binding`);
      assert.equal(binding.spriteAssetId, contract.spriteAsset.pathId, `${name}: SpriteAsset mismatch`);
      assert.equal(binding.materialId, contract.material.pathId, `${name}: material mismatch`);
      assert.equal(binding.textureId, contract.texture.pathId, `${name}: texture mismatch`);
      assert.equal(binding.textureUrl, contract.texture.url, `${name}: texture URL mismatch`);
      assert.equal(binding.spriteIndex, 3, `${name}: normal ex must use ex_bl_01`);
      assert.equal(binding.characterName, "ex_bl_01", `${name}: sprite character mismatch`);
      assert.equal(binding.fontSize, 16, `${name}: localizer ex tag size mismatch`);
      assert.match(binding.tagSizeObjectSha256 || "", /^[0-9a-f]{64}$/);
      generatedBindingCount += 1;
    }
  }
  assert(generatedBindingCount > 0, "canonical corpus contains no [Img:ex] binding");

  const app = fs.readFileSync(path.join(ROOT, "public", "app.js"), "utf8");
  assert(/layoutOfficialTmpSprite/.test(app), "runtime does not use the official TMP sprite layout port");
  assert(/role:\s*"inline-ex-sprite"/.test(app), "runtime ex-sprite binding evidence is absent");
  assert(/crop\.x, crop\.y, crop\.width, crop\.height/.test(app), "runtime does not crop the official atlas rect");

  return {
    status: "pass",
    generatedBindingCount,
    spriteAssetId: contract.spriteAsset.pathId,
    materialId: contract.material.pathId,
    textureId: contract.texture.pathId,
    texturePngSha256: contract.texture.pngSha256,
    normalSpriteIndex: contract.preprocessor.fontTypeToSpriteIndex.ExBlack,
    megaSpriteIndex: contract.preprocessor.fontTypeToSpriteIndex.White,
  };
}

const isMain = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  const report = auditOfficialTmpSprite();
  console.log("official TMP ex sprite: pass");
  console.log(`  generated bindings: ${report.generatedBindingCount}`);
  console.log(`  SpriteAsset ${report.spriteAssetId}; texture ${report.textureId}`);
  console.log(`  normal index ${report.normalSpriteIndex}; mega index ${report.megaSpriteIndex}`);
}
