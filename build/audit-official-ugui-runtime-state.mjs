// Byte-level audit of the official Card Core methods that mutate UGUI state.
// Il2CppDumper script.json is a package-pinned locator only. Every semantic
// claim below is recomputed from the hash-pinned ARM64 libil2cpp method bytes.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const IL2CPP = path.resolve(ROOT, "../ptcg-apk-parser/apks/output/libil2cpp.so");
const METADATA = path.resolve(ROOT, "../ptcg-apk-parser/apks/output/global-metadata.dat");
const SCRIPT = path.resolve(ROOT, "../ptcg-apk-parser/tools/vendor/Il2CppDumper/out/script.json");

const EXPECTED = Object.freeze({
  libil2cpp: [128218264, "3e78eedc62770fff4cb129b4b8d898950e131b710b3c099237fe20d2d34ca48e"],
  metadata: [31429296, "bf58e06a98f9e9e05a1635f512ea432d33971bfc8280ba26df1c93e94b4f3cb9"],
  locator: [139197011, "c6bbe3dd41b5530fae30c3b8f6d27bdcf212e442c024da71478621b8818c1e21"],
  cardCoreMethodCount: 1189,
  directCallCount: 46,
  directCallSha256: "b877770afefec8d7297d1e5c94ada0359626696c0f75f0108492d32a4137dcfe",
});

const METHODS = Object.freeze([
  ["CardBehaviour.<Load>d__30.MoveNext", 0x4414170, 0x4414CE0, "d0ccfb291e0811fc73204825481ba06e99fd511b8a579563a4ac0e05e063c384"],
  ["CardBehaviour.<UpdateFace>d__35.MoveNext", 0x441B1C0, 0x441BD48, "b32d0b1b8bca591609a8e14f3b0bcd20ada0861484ddffcfe522960016c66eff"],
  ["CardConditionView.SetActive", 0x441E258, 0x441E7E8, "07c3e670000a4aca5b92d5e7630aadcd28778cb387980516d8226cb46d0b8785"],
  ["CardContainerViewExtensions.SetActive", 0x441EBC0, 0x441EE98, "98df6e62d1440086185398c8b1a148f84bd5acbd4e2416109be7de426bd58b02"],
  ["CardDynamicUIView.Apply", 0x441EEA0, 0x441EF58, "b13ff59db86f766dba9da9f0af9aae091fd923d2c50d57bff383090c7b5e5936"],
  ["CardEnergyIconView.SetEnergy", 0x441F290, 0x441F568, "8d3aa11f6ab807e347fae446507da3c88a45edb3b81f6fb412f7bdb720d6783a"],
  ["CardEnergyView.SetEnergy", 0x441F6B8, 0x441F7A4, "0c593c21feb290a40d773a5cf45bccb2bd76b5cf00e92622b8bf51f91b739706"],
  ["CardEnergyView.SetEnergies", 0x441F7A4, 0x441F8F4, "3d65e7beec096e050f7efbad473c5f7521d76c799ef0eb30e9204c9f6c7ded62"],
  ["CardEnergyView.SetNullEnergy", 0x441F8F4, 0x441F9D4, "a4d37b776fd4c68e0f140572fa2a083e1231dde499f3b25cc84603a3c85ef993"],
  ["CardSpriteView.SetSprite", 0x4429ED8, 0x4429F70, "216a6e0f19882a8553880d08ccbc980eff5f53ff8fb7a5b8ecdb6bbf084197c2"],
  ["ModelCardView.OnEnable", 0x44304C4, 0x4430568, "4736dbd5f9e44a796b5e5a161b16d32481060dde37deb6e75dcffde603346345"],
  ["ModelCardView.OnDisable", 0x4430568, 0x4430664, "b65d327fe8d01df5394c88ad3cef1d12a89d25e627fa100cfc4d6648c91c4f09"],
  ["ModelCardView.<Initialize>d__33.MoveNext", 0x44315FC, 0x4432678, "48d6f86b4e0be15346effd54cbfe7cae028429fa201b9fd174c2825fd8b38e08"],
  ["PokemonCardUIBehaviour.<ApplySequentialWorker>d__3.MoveNext", 0x4436DB8, 0x4437DB0, "59b450dc65796c71fece3c82e2a847e467173b6175de147cc3fd0962dcfcd54f"],
  ["TrainersCardUIBehaviour.<ApplySequentialWorker>d__4.MoveNext", 0x443A5B0, 0x443B3C8, "391f00e0b0b4c33adb3c9e4b11f5ddcd279d36f2334dbd5ca94a9069d1f385a7"],
  ["CardTextView.SetText", 0x444DCBC, 0x444DD58, "5a7f4251dede4e0383e7b9b44210e6683bdc15d16c11db718badacb04e1df935"],
  ["PokemonCardMegaEvolutionFromNameViewExtensions.SetActive", 0x444ECBC, 0x444EF8C, "da1b05ea285ac530705c8002f3018f23aca0d02c50643101d4839742abcdd747"],
  ["PokemonCardNameView.UpdateExLayout", 0x444F374, 0x444F508, "529632b00fa7b38daa92924e9a6d5be80d04976e2da5c3bad93aa3eec657bea9"],
  ["PokemonCardNameViewExtensions.SetActive", 0x444F624, 0x444F8F4, "ab95bf4eaef69231d4fb2ea83f8a8087e67aef637309def12198f41fddb1402a"],
  ["CardBehaviour.<UpdateDynamicTexture>d__39.MoveNext", 0x441A178, 0x441AB58, "ecdddf0b01fd3a554e241c60775cc9f892fd288a31fa35de1911ef168b9c8896"],
  ["CardBehaviour.<UpdateDynamicTexture>d__40.MoveNext", 0x441AB64, 0x441B1B4, "66985b8c172f8869335265fca5eb1d319f7beb2f014232afee0fc936220d7651"],
]);

const SETTERS = Object.freeze([
  ["GameObject.SetActive", "UnityEngine.GameObject$$SetActive", 39],
  ["Image.sprite", "UnityEngine.UI.Image$$set_sprite", 3],
  ["Behaviour.enabled", "UnityEngine.Behaviour$$set_enabled", 4],
  ["Graphic.color", "UnityEngine.UI.Graphic$$set_color", 0],
  ["Graphic.material", "UnityEngine.UI.Graphic$$set_material", 0],
  ["Image.fillAmount", "UnityEngine.UI.Image$$set_fillAmount", 0],
  ["MaskableGraphic.maskable", "UnityEngine.UI.MaskableGraphic$$set_maskable", 0],
  ["CanvasRenderer.cull", "UnityEngine.CanvasRenderer$$set_cull", 0],
  ["CanvasRenderer.cullTransparentMesh", "UnityEngine.CanvasRenderer$$set_cullTransparentMesh", 0],
  ["CanvasRenderer.SetAlpha", "UnityEngine.CanvasRenderer$$SetAlpha", 0],
  ["CanvasRenderer.SetColor", "UnityEngine.CanvasRenderer$$SetColor", 0],
  ["CanvasRenderer.SetMaterial", "UnityEngine.CanvasRenderer$$SetMaterial", 0],
  ["CanvasRenderer.EnableRectClipping", "UnityEngine.CanvasRenderer$$EnableRectClipping", 0],
  ["CanvasRenderer.DisableRectClipping", "UnityEngine.CanvasRenderer$$DisableRectClipping", 0],
  ["CanvasRenderer.clippingSoftness", "UnityEngine.CanvasRenderer$$set_clippingSoftness", 0],
]);

const CRITICAL_CALLS = Object.freeze([
  ["0x44142e4", "GameObject.SetActive"], ["0x44148e0", "GameObject.SetActive"],
  ["0x441b464", "GameObject.SetActive"], ["0x441b848", "GameObject.SetActive"],
  ["0x441e7bc", "GameObject.SetActive"], ["0x441eda0", "GameObject.SetActive"],
  ["0x441ef2c", "GameObject.SetActive"], ["0x441f384", "Image.sprite"],
  ["0x441f4c0", "Image.sprite"], ["0x441f4e0", "GameObject.SetActive"],
  ["0x4429f48", "Behaviour.enabled"], ["0x4429f68", "Image.sprite"],
  ["0x444dd2c", "GameObject.SetActive"], ["0x444f4f8", "GameObject.SetActive"],
]);

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function source(bytes, expected, label) {
  assert.equal(bytes.length, expected[0], `${label} byte length`);
  assert.equal(sha256(bytes), expected[1], `${label} SHA-256`);
}

function loadSegments(bytes) {
  assert.equal(bytes.toString("ascii", 0, 4), "\x7fELF", "libil2cpp ELF magic");
  assert.equal(bytes[4], 2, "libil2cpp ELF64");
  assert.equal(bytes[5], 1, "libil2cpp little endian");
  const offset = Number(bytes.readBigUInt64LE(32));
  const entrySize = bytes.readUInt16LE(54);
  const count = bytes.readUInt16LE(56);
  const segments = [];
  for (let index = 0; index < count; index += 1) {
    const cursor = offset + index * entrySize;
    if (bytes.readUInt32LE(cursor) !== 1) continue;
    segments.push({
      fileOffset: Number(bytes.readBigUInt64LE(cursor + 8)),
      virtualAddress: Number(bytes.readBigUInt64LE(cursor + 16)),
      fileSize: Number(bytes.readBigUInt64LE(cursor + 32)),
    });
  }
  return segments;
}

function elfRange(bytes, segments, start, end) {
  const segment = segments.find((entry) => start >= entry.virtualAddress
    && end <= entry.virtualAddress + entry.fileSize);
  assert(segment, `RVA 0x${start.toString(16)}..0x${end.toString(16)} is file-backed`);
  const offset = segment.fileOffset + start - segment.virtualAddress;
  return bytes.subarray(offset, offset + end - start);
}

function directBranchTarget(word, address) {
  const opcode = (word & 0xFC000000) >>> 0;
  if (opcode !== 0x94000000 && opcode !== 0x14000000) return null;
  let immediate = word & 0x03FFFFFF;
  if (immediate & 0x02000000) immediate -= 0x04000000;
  return address + immediate * 4;
}

const library = fs.readFileSync(IL2CPP);
const metadata = fs.readFileSync(METADATA);
const locatorBytes = fs.readFileSync(SCRIPT);
source(library, EXPECTED.libil2cpp, "official libil2cpp");
source(metadata, EXPECTED.metadata, "official metadata");
source(locatorBytes, EXPECTED.locator, "Il2CppDumper locator");
const locator = JSON.parse(locatorBytes);
const segments = loadSegments(library);

for (const [name, start, end, expectedHash] of METHODS) {
  const bytes = elfRange(library, segments, start, end);
  assert.equal(sha256(bytes), expectedHash, `${name} method body`);
}

const methodStarts = [...new Set(locator.ScriptMethod.map((method) => method.Address).filter((address) => address > 0))]
  .sort((a, b) => a - b);
const targetByAddress = new Map();
for (const [label, locatorName] of SETTERS) {
  const matches = locator.ScriptMethod.filter((method) => method.Name === locatorName);
  assert(matches.length >= 1, `${locatorName} locator is absent`);
  for (const match of matches) targetByAddress.set(match.Address, label);
}

const coreMethods = locator.ScriptMethod.filter((method) => method.Address > 0
  && method.Name.startsWith("Lettuce.Infrastructure.Card.Core."));
assert.equal(coreMethods.length, EXPECTED.cardCoreMethodCount, "Card Core method locator census");
const directCalls = [];
for (const method of coreMethods) {
  const end = methodStarts.find((address) => address > method.Address);
  if (!end || end - method.Address > 0x20000) continue;
  const body = elfRange(library, segments, method.Address, end);
  for (let offset = 0; offset + 4 <= body.length; offset += 4) {
    const word = body.readUInt32LE(offset);
    const site = method.Address + offset;
    const target = directBranchTarget(word, site);
    const setter = targetByAddress.get(target);
    if (!setter) continue;
    directCalls.push({
      caller: method.Name,
      site: `0x${site.toString(16)}`,
      target: `0x${target.toString(16)}`,
      setter,
      kind: ((word & 0xFC000000) >>> 0) === 0x94000000 ? "bl" : "b",
    });
  }
}
directCalls.sort((a, b) => a.site.localeCompare(b.site) || a.caller.localeCompare(b.caller));
assert.equal(directCalls.length, EXPECTED.directCallCount, "Card Core direct UGUI mutation call count");
assert.equal(sha256(Buffer.from(JSON.stringify(directCalls))), EXPECTED.directCallSha256,
  "Card Core direct UGUI mutation call digest");
for (const [label, _locatorName, expectedCount] of SETTERS) {
  assert.equal(directCalls.filter((call) => call.setter === label).length, expectedCount,
    `${label} direct-call count`);
}
for (const [site, setter] of CRITICAL_CALLS) {
  assert(directCalls.some((call) => call.site === site && call.setter === setter),
    `${site} must call ${setter}`);
}

console.log("Official UGUI runtime-state producer audit OK");
console.log(`  ${METHODS.length} Card UI producer/dispatcher method bodies byte-pinned`);
console.log("  direct writes: SetActive=39, Image.sprite=3, Behaviour.enabled=4");
console.log("  zero direct Card Core writes: color/material/fill/maskable and CanvasRenderer cull/alpha/color/material/clip");
console.log("  runtime branch execution and libunity Canvas rebuild remain runtime-required");
