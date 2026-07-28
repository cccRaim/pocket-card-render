import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import {
  buildOfficialUGUIResourceContract,
  extractOfficialUGUIResources,
  serializeOfficialUGUIResourceContract,
} from "./build-official-ugui-resources.mjs";
import {
  assertEvolutionSourceImage,
  canonicalUGUICorpus,
} from "./official-ugui-corpus.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONTRACT_PATH = path.join(ROOT, "public", "render", "card-ui-resource-contract.json");
const TEXT_DIR = path.join(ROOT, "public", "text");
const ENERGY_SPRITE_PRODUCER_SCHEMA = "pocket-card-render/runtime-sprite-producer@1";
const ENERGY_SPRITE_PRODUCER = "CardEnergyIconView.SetEnergy";
const ENERGY_ICON = {
  Grass: "01", Fire: "02", Water: "03", Lightning: "04", Psychic: "05",
  Fighting: "06", Darkness: "07", Metal: "08", Dragon: "09", Colorless: "10",
};

const EXPECTED = {
  evidenceSha256: "090e7b0c37705f57034fc9c361220ec1f12c218039a1dd354a54d18f6c263201",
  digests: {
    prefabs: "4dcfb9127d719a02e0d29deab3a160d9786d8c65ccd4bc9034674667091c294f",
    images: "e1e3d5356aea436175a23213e723104a7d1059ccad95e1ae0911a46f9869eb71",
    sprites: "f6250ad494ced918bc279efe6a29f7dbf13753ce0f98c743f7ae4bb2aa5fc3c0",
    textures: "cb698a2211f6b5505781e744924784678ef075055e3ec8d3f81b345346e8b103",
    materials: "15e469149cfa756c641c8ecdae663d51c52a73315c6936c93204c063ac604288",
    shaders: "d5d991c90d1e2f2a9ebd2e63d2a83e38ec3ebc641c8fab6651731e17865ecbef",
  },
  material: {
    identity: "CAB-b03ac178e097f0b5b749149090b41913:-5098138999901745883",
    rawSha256: "11cd5b30fc3e464b84bedda43e297576dfd5c36732fc8aa85ba33597c95f3db6",
  },
  shader: {
    identity: "CAB-475bda97c86c2e19de716358682956e4:5313265162950190389",
    rawSha256: "186554d5da124466d167a320be7ee170a087bcbc9b74c0be8ee3c8315995b4b6",
  },
};

function runtimeSpriteBinding(element) {
  const binding = element.runtimeSpriteProducer;
  if (!binding) return null;
  const energyType = binding.input?.energyType;
  const code = ENERGY_ICON[energyType];
  if (binding.schema !== ENERGY_SPRITE_PRODUCER_SCHEMA
      || binding.producer !== ENERGY_SPRITE_PRODUCER
      || binding.target !== "Image.sprite"
      || !code) {
    return { status: "invalid-runtime-sprite" };
  }
  const spriteName = `card_icn_attribute_${code}`;
  const textureUrl = `/game/Assets/Lettuce/_Data/Common/CardNew/Common/UI/Textures/CardUIPokemonFormat8x8/${spriteName}.png`;
  if (binding.output?.spriteName !== spriteName
      || binding.output?.textureUrl !== textureUrl
      || element.url !== textureUrl) {
    return { status: "wrong-runtime-url", expectedUrl: textureUrl };
  }
  return { status: "runtime-sprite", expectedUrl: textureUrl };
}

function staticBinding(element, contract) {
  const runtime = runtimeSpriteBinding(element);
  if (runtime) return runtime;
  const resource = contract.images[element.uiImage?.imageObjectSha256];
  if (!resource) return { status: "unresolved-image" };
  if (!resource.sprite) return { status: "runtime-sprite", resource };
  return {
    status: element.url === resource.sprite.texture.url ? "exact" : "wrong-url",
    resource,
    expectedUrl: resource.sprite.texture.url,
  };
}

const extracted = extractOfficialUGUIResources();
assert.equal(extracted.schema, "pocket-card-render/official-ugui-resources@1");
assert.equal(extracted.unityVersion, "2022.3.62f2");
assert.equal(extracted.evidenceSha256, EXPECTED.evidenceSha256);
assert.deepEqual(extracted.digests, EXPECTED.digests);
assert.deepEqual(extracted.summary, {
  prefabs: 2,
  images: 314,
  nonnullImageSprites: 312,
  uniqueSprites: 168,
  uniqueTextures: 168,
  uniqueMaterials: 1,
  uniqueShaders: 1,
  atlasSprites: 0,
  alphaTextures: 0,
});
assert.deepEqual(extracted.prefabs.map(({ serializedCab, imageCount, sha256 }) => [serializedCab, imageCount, sha256]), [
  ["CAB-784454e0fd2625a37242e19a61036aca", 177, "405a783ca9f7fb58f6c6f55aaa37d6d018b7e83f22c1f5b14bfe09ecc0fb2c05"],
  ["CAB-cd5ef381b82a512ef3d9bc554cc14eeb", 137, "33b3af9be400cf2b6aed6696e2b9eb8d4a78f8cbe41ca3d80a12d2cb6d9fb484"],
]);

assert.equal(extracted.images.filter((row) => !row.spritePointer).length, 2);
assert.ok(extracted.images.every((row) => row.materialPointer?.identity === EXPECTED.material.identity));
assert.ok(extracted.sprites.every((row) => row.atlasPointer === null));
assert.ok(extracted.sprites.every((row) => row.alphaTexturePointer === null));
assert.ok(extracted.sprites.every((row) => row.secondaryTextureCount === 0));
assert.ok(extracted.sprites.every((row) => row.texturePointer.fileId === 0));
assert.ok(extracted.sprites.every((row) => row.texturePointer.sourceCab === row.texturePointer.targetCab));
assert.equal(extracted.textures.filter((row) => row.textureFormat === 49).length, 167);
assert.equal(extracted.textures.filter((row) => row.textureFormat === 48).length, 1);
assert.ok(extracted.textures.every((row) => row.mipCount === 1 && row.colorSpace === 1));
assert.equal(extracted.textures.reduce((sum, row) => sum + row.payloadByteSize, 0), 3493072);
assert.ok(extracted.textures.every((row) => /^[0-9a-f]{64}$/.test(row.payloadSha256)));
assert.deepEqual(
  { identity: extracted.materials[0].identity, rawSha256: extracted.materials[0].rawSha256 },
  EXPECTED.material,
);
assert.equal(extracted.materials[0].name, "UI-Default-ToRT");
assert.deepEqual(
  { identity: extracted.shaders[0].identity, rawSha256: extracted.shaders[0].rawSha256 },
  EXPECTED.shader,
);
assert.equal(extracted.shaders[0].name, "Lettuce/Common/CardNew/UI/Default(to RT)");

const expectedContract = buildOfficialUGUIResourceContract(extracted);
const serializedContract = fs.readFileSync(CONTRACT_PATH, "utf8");
assert.equal(serializedContract, serializeOfficialUGUIResourceContract(expectedContract));
const contract = JSON.parse(serializedContract);

let iconCount = 0;
let directImageCount = 0;
let exactStaticCount = 0;
let runtimeSpriteCount = 0;
let energyRuntimeSpriteCount = 0;
let evolutionSourceRuntimeSpriteCount = 0;
const checkedPngs = new Set();
const corpus = canonicalUGUICorpus(ROOT);
const canonicalTextFiles = corpus.entries.map(({ file }) => file);
for (const entry of corpus.entries) {
  const { file, evolutionSourceCharacterId } = entry;
  const composition = JSON.parse(fs.readFileSync(path.join(TEXT_DIR, file), "utf8"));
  const evolutionSourceImage = assertEvolutionSourceImage(
    composition,
    evolutionSourceCharacterId,
    file,
  );
  if (evolutionSourceImage) {
    evolutionSourceRuntimeSpriteCount += 1;
    const pngPath = path.join(
      ROOT,
      "public",
      evolutionSourceImage.url.replace(/^\//, ""),
    );
    assert.ok(fs.existsSync(pngPath), `${file}: evolution source PNG is absent`);
  }
  for (const element of composition.elements || []) {
    if (element.kind !== "icon") continue;
    iconCount += 1;
    const runtime = runtimeSpriteBinding(element);
    assert.notEqual(runtime?.status, "invalid-runtime-sprite", `${file}:${element.layoutPath}: invalid runtime Sprite producer`);
    assert.notEqual(runtime?.status, "wrong-runtime-url", `${file}:${element.layoutPath}: expected ${runtime?.expectedUrl}, got ${element.url}`);
    if (runtime?.status === "runtime-sprite") energyRuntimeSpriteCount += 1;
    if (!element.uiImage) continue;
    directImageCount += 1;
    const binding = staticBinding(element, contract);
    assert.notEqual(binding.status, "unresolved-image", `${file}:${element.layoutPath}: Image object is unresolved`);
    assert.notEqual(binding.status, "invalid-runtime-sprite", `${file}:${element.layoutPath}: invalid runtime Sprite producer`);
    assert.notEqual(binding.status, "wrong-runtime-url", `${file}:${element.layoutPath}: expected ${binding.expectedUrl}, got ${element.url}`);
    if (binding.status === "runtime-sprite") {
      runtimeSpriteCount += 1;
      assert.ok(
        element.runtimeSpriteProducer || element.sourceCharacterId,
        `${file}:${element.layoutPath}: runtime Sprite lacks producer evidence`,
      );
      continue;
    }
    assert.equal(binding.status, "exact", `${file}:${element.layoutPath}: expected ${binding.expectedUrl}, got ${element.url}`);
    exactStaticCount += 1;
    if (checkedPngs.has(element.url)) continue;
    checkedPngs.add(element.url);
    const pngPath = path.join(ROOT, "public", element.url.replace(/^\//, ""));
    assert.ok(fs.existsSync(pngPath), `${element.url}: gathered PNG is absent`);
    const png = PNG.sync.read(fs.readFileSync(pngPath));
    assert.deepEqual(
      [png.width, png.height],
      [binding.resource.sprite.texture.width, binding.resource.sprite.texture.height],
      `${element.url}: exported dimensions differ from official Texture2D`,
    );
  }
}
assert.equal(canonicalTextFiles.length, 1107);
assert.equal(corpus.evolutionSourceCardCount, 39);
assert.equal(
  evolutionSourceRuntimeSpriteCount,
  corpus.evolutionSourceEntryCount,
);
assert.equal(iconCount - evolutionSourceRuntimeSpriteCount, 15849);
assert.equal(directImageCount - evolutionSourceRuntimeSpriteCount, 7281);
assert.equal(exactStaticCount, 6318);
assert.equal(runtimeSpriteCount - evolutionSourceRuntimeSpriteCount, 963);
assert.equal(energyRuntimeSpriteCount, 6579);
const exOutlineElements = canonicalTextFiles.flatMap((file) => {
  const composition = JSON.parse(fs.readFileSync(path.join(TEXT_DIR, file), "utf8"));
  return (composition.elements || [])
    .filter((element) => element.layoutPath?.endsWith("/ImgExOutlineWhite/ImgExOutlineWhite"))
    .map((element) => ({ file, element }));
});
assert.equal(exOutlineElements.length, 252);
for (const { file, element } of exOutlineElements) {
  assert.equal(
    element.url,
    "/game/Assets/Lettuce/_Data/Common/CardNew/Common/UI/Textures/CardUIPokemonFormat5x5/card_icn_ex_outline_white.png",
  );
  assert.equal(staticBinding(element, contract).status, "exact");
}

const exactElement = JSON.parse(fs.readFileSync(path.join(TEXT_DIR, "PK_20_008900_02.es_ES.json"), "utf8"))
  .elements.find((element) => element.layoutPath?.endsWith("/phase_txt_img_01_es_es419"));
assert(exactElement?.uiImage, "Spanish basic-stage Image test fixture is absent");
assert.equal(staticBinding(exactElement, contract).status, "exact");
assert.equal(staticBinding({ ...exactElement, url: "/game/wrong.png" }, contract).status, "wrong-url");
assert.equal(staticBinding({ ...exactElement, uiImage: { ...exactElement.uiImage, imageObjectSha256: "0".repeat(64) } }, contract).status, "unresolved-image");
const runtimeElement = JSON.parse(fs.readFileSync(path.join(TEXT_DIR, "PK_20_008900_02.zh_TW.json"), "utf8"))
  .elements.find((element) => element.layoutPath === "/PokemonCardUI/energy_view/CardEnergyIconView/icn_gra_img");
assert.equal(runtimeSpriteBinding(runtimeElement).status, "runtime-sprite");
assert.equal(staticBinding(runtimeElement, contract).status, "runtime-sprite");
assert.equal(
  runtimeElement.uiImage.sprite.pathId,
  "1014312146848883521",
  "runtime SetEnergy binding must preserve the prefab's initial Grass Sprite provenance",
);
assert.equal(runtimeSpriteBinding({
  ...runtimeElement,
  runtimeSpriteProducer: {
    ...runtimeElement.runtimeSpriteProducer,
    producer: "WrongProducer",
  },
}).status, "invalid-runtime-sprite");
assert.equal(runtimeSpriteBinding({ ...runtimeElement, url: "/game/wrong.png" }).status, "wrong-runtime-url");

const composeSource = fs.readFileSync(path.join(ROOT, "build", "compose.mjs"), "utf8");
assert.match(composeSource, /card-ui-resource-contract\.json/);
assert.match(composeSource, /function officialPrefabIcon/);
assert.match(composeSource, /UI_RESOURCES\.images\?\.\[imageHash\]/);
assert.match(composeSource, /CardEnergyIconView\.SetEnergy/);
assert.match(composeSource, /runtimeSpriteProducer/);

console.log("Official UGUI Sprite/Texture/Material/Shader resource audit OK");
console.log("  314 Images -> 168 Sprite/Texture pairs -> 1 Material/Shader chain hash-pinned");
console.log("  3,493,072 official streamed texture bytes hash-pinned");
console.log(`  ${canonicalTextFiles.length} localized files from the 123-scene canonical corpus audited`);
console.log(`  ${exactStaticCount}/${directImageCount} direct Image icon ops use their exact prefab Texture2D URL`);
console.log(`  ${runtimeSpriteCount}/${directImageCount} direct Image icon ops use explicit runtime Sprite producers`);
console.log(`  ${energyRuntimeSpriteCount} energy icons bind CardEnergyIconView.SetEnergy output provenance`);
