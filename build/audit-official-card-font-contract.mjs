import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

const result = spawnSync(
  process.platform === "win32" ? "python" : "python3",
  ["build/extract_official_card_font_contract.py", "--check"],
  { cwd: root, encoding: "utf8", shell: process.platform === "win32" },
);

if (result.error) throw result.error;
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
if (result.status !== 0) process.exit(result.status ?? 1);

const contract = JSON.parse(readFileSync(join(root, "public", "render", "card-font-contract.json"), "utf8"));
assert.equal(contract.schemaVersion, 2);
assert.deepEqual(contract.cardTextTypes, { Default: 1, Bold: 2, Region: 3, MultiLine: 4 });
assert.deepEqual(contract.inlineElements, {
  producer: "LtUIImgTagCommand.PreProcessElement",
  producerRva: "0x464e9a4",
  defaultFontSize: 23,
  fontId: "1866416259400829261",
  materialIds: {
    Black: "-5102697118585943731",
    White: "2417365139982267753",
    BlackWithWhiteOutline: "1470737543190596764",
  },
  glyphs: {
    Dragon: "\uE005", Water: "\uE007", Grass: "\uE008", Fire: "\uE009", Fairy: "\uE00A",
    Lightning: "\uE00B", Psychic: "\uE00C", Fighting: "\uE00D", Colorless: "\uE00E",
    Darkness: "\uE00F", Metal: "\uE010",
  },
});
assert.ok(contract.fonts[contract.inlineElements.fontId], "missing inline-element FontAsset");
for (const materialId of Object.values(contract.inlineElements.materialIds)) {
  assert.ok(contract.materials[materialId], `missing inline-element TMP Material ${materialId}`);
}
for (const locale of Object.values(contract.locales)) {
  for (const preset of Object.values(locale.presets)) {
    for (const style of Object.values(preset.types || {})) {
      assert.ok(contract.fonts[style.fontId], `missing FontAsset ${style.fontId}`);
      assert.ok(contract.materials[style.materialId], `missing TMP Material ${style.materialId}`);
    }
  }
}

const black = contract.fonts["8286394459813532775"];
assert.deepEqual({
  name: black.name,
  pointSize: black.pointSize,
  atlasSize: [black.atlasWidth, black.atlasHeight],
  padding: black.atlasPadding,
  renderMode: black.atlasRenderMode,
  populationMode: black.atlasPopulationMode,
  sourceSize: black.source.byteSize,
  sourceSha256: black.source.sha256,
  atlasSha256: black.atlases[0].payloadSha256,
}, {
  name: "TPC-MXiangHeHeiTC-Black SDF",
  pointSize: 40,
  atlasSize: [1024, 1024],
  padding: 9,
  renderMode: 4165,
  populationMode: 1,
  sourceSize: 6570220,
  sourceSha256: "3835249e7f885dc52e7ca4ffdd1f94f64ab594a953622b00f0d490e309f4d654",
  atlasSha256: "730bc9a0732751ef47b59129e3d25631088de4e1390fbe383e784f3136ed8b6f",
});

const zhBody = contract.locales.zh_TW.presets["CardDescription-WhiteOutline"];
assert.deepEqual({
  defaultFont: zhBody.types.Default.fontId,
  defaultMaterial: zhBody.types.Default.materialId,
  boldFont: zhBody.types.Bold.fontId,
  boldMaterial: zhBody.types.Bold.materialId,
}, {
  defaultFont: "1482346930774817996",
  defaultMaterial: "1071188550088116610",
  boldFont: "8286394459813532775",
  boldMaterial: "39010727359333490",
});
console.log("Official card font object/reference audit OK");
