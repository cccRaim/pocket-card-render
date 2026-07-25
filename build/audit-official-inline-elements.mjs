import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONTRACT_PATH = path.join(ROOT, "public", "render", "card-font-contract.json");
const MANIFEST_PATH = path.join(ROOT, "public", "game", "tmp-fonts", "manifest.json");
const TEXT_DIR = path.join(ROOT, "public", "text");

const EXPECTED = {
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
    Dragon: "\uE005",
    Water: "\uE007",
    Grass: "\uE008",
    Fire: "\uE009",
    Fairy: "\uE00A",
    Lightning: "\uE00B",
    Psychic: "\uE00C",
    Fighting: "\uE00D",
    Colorless: "\uE00E",
    Darkness: "\uE00F",
    Metal: "\uE010",
  },
};

export function auditOfficialInlineElements() {
  const contract = JSON.parse(fs.readFileSync(CONTRACT_PATH, "utf8"));
  const inline = contract.inlineElements;
  assert(inline, "card font contract has no inlineElements section");
  assert.deepEqual(inline, EXPECTED, "official inline-element contract drifted");

  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
  const font = manifest.fonts?.[inline.fontId];
  assert(font, "Pokesymbol2 FontAsset is absent from the TMP atlas manifest");
  assert.deepEqual(font.fallbackFontAssetIds, [], "Pokesymbol2 unexpectedly gained a local fallback table");
  const available = new Set([
    ...(font.characters || []),
    ...(font.runtimeCharacters || []),
  ].map((entry) => Number(entry.unicode)));
  for (const [type, glyph] of Object.entries(inline.glyphs)) {
    assert(available.has(glyph.codePointAt(0)), `${type} PUA glyph is absent from the official atlas`);
  }

  const allowedMaterials = new Set(Object.values(inline.materialIds));
  let elementCount = 0;
  const typeCounts = {};
  for (const name of fs.readdirSync(TEXT_DIR).filter((entry) => entry.endsWith(".json"))) {
    const document = JSON.parse(fs.readFileSync(path.join(TEXT_DIR, name), "utf8"));
    for (const element of document.elements || []) {
      for (const value of Object.values(element.inlineSprites || {})) {
        elementCount += 1;
        typeCounts[value.type] = (typeCounts[value.type] || 0) + 1;
        assert.equal(value.url, undefined, `${name} still represents an element tag as a PNG sprite`);
        assert.equal(value.fontSize, inline.defaultFontSize, `${name} uses the wrong inline font size`);
        assert.equal(value.glyph, inline.glyphs[value.type], `${name} uses the wrong PUA glyph for ${value.type}`);
        assert.equal(value.sdf?.fontId, inline.fontId, `${name} uses the wrong inline FontAsset`);
        assert(allowedMaterials.has(value.sdf?.materialId), `${name} uses a non-official inline material`);
      }
    }
  }
  assert(elementCount > 0, "canonical generated text contains no inline-element evidence");

  const app = fs.readFileSync(path.join(ROOT, "public", "app.js"), "utf8");
  assert(/tmpRole:\s*"inline-element"/.test(app), "runtime does not label inline-element TMP draws");
  assert(/run\.symbol/.test(app) && /seg\.symbol/.test(app), "runtime symbol measure/draw branches are absent");

  return {
    status: "pass",
    producer: inline.producer,
    producerRva: inline.producerRva,
    fontId: inline.fontId,
    materialIds: inline.materialIds,
    glyphCount: Object.keys(inline.glyphs).length,
    generatedElementCount: elementCount,
    generatedTypes: typeCounts,
  };
}

const isMain = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  const report = auditOfficialInlineElements();
  console.log("official inline elements: pass");
  console.log(`  producer: ${report.producer} @ ${report.producerRva}`);
  console.log(`  official PUA glyphs: ${report.glyphCount}`);
  console.log(`  canonical generated entries: ${report.generatedElementCount}`);
  console.log(`  generated types: ${Object.entries(report.generatedTypes).map(([key, value]) => `${key}=${value}`).join(" ")}`);
}
