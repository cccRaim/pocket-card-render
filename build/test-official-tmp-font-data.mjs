import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  computeOfficialTmpJustificationOffsets,
  indexOfficialTmpFonts,
  layoutOfficialTmpRun,
  measureOfficialTmpText,
  resolveOfficialTmpGlyph,
  resolveOfficialTmpTextElement,
  wrapOfficialTmpItems,
} from "../public/render/tmp-font-data.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "public/game/tmp-fonts/manifest.json"), "utf8"));
const settings = JSON.parse(fs.readFileSync(path.join(ROOT, "public/render/tmp-settings-contract.json"), "utf8"));
const index = indexOfficialTmpFonts(manifest, settings);
assert.equal(index.fonts.size, 14);
assert.equal(index.settings.leadingCharacters.size, 41);
assert.equal(index.settings.followingCharacters.size, 97);
assert.equal(index.settings.useModernHangulLineBreakingRules, false);
assert.deepEqual(index.settings.fallbackFontAssetIds, []);
assert.equal(index.settings.defaultFontAssetId, "0");
assert.equal(index.settings.defaultSpriteAssetId, "0");
assert.equal(index.settings.missingGlyphCharacter, 0);

const black = "8286394459813532775";
const leaf = resolveOfficialTmpGlyph(index, black, "\u8449".codePointAt(0));
assert(leaf);
assert.equal(leaf.glyph.source, "native-generated");
assert(leaf.atlas.alphaUrl.endsWith(".alpha.bin"));

const symbolFont = "1866416259400829261";
for (const codePoint of [0xE005, 0xE007, 0xE008, 0xE009, 0xE00A, 0xE00B, 0xE00C, 0xE00D, 0xE00E, 0xE00F, 0xE010]) {
  const symbol = resolveOfficialTmpGlyph(index, symbolFont, codePoint);
  assert(symbol, `missing official Pokesymbol glyph U+${codePoint.toString(16).toUpperCase()}`);
  assert(symbol.glyph.metrics.width > 0);
  assert(symbol.atlas.alphaUrl.endsWith(".alpha.bin"));
}

const number = "-757749988448016049";
const layout = layoutOfficialTmpRun(index, number, "123", 46, 10, 100);
assert.equal(layout.glyphs.length, 3);
assert.equal(layout.endX - 10, measureOfficialTmpText(index, number, "123", 46));
assert(layout.glyphs.every((glyph) => Number.isFinite(glyph.x) && Number.isFinite(glyph.y)));
assert(layout.glyphs.every((glyph) => glyph.atlas?.alphaUrl));
assert.equal(
  measureOfficialTmpText(index, number, "12", 46, { wordSpacing: 100 }),
  measureOfficialTmpText(index, number, "12", 46),
  "non-whitespace glyph records must not be coerced to '[object Object]'",
);

const missing = resolveOfficialTmpTextElement(index, black, 0x10FFFF);
assert(missing, "official missing-glyph chain did not produce a replacement");
assert.equal(missing.requestedCodePoint, 0x10FFFF);
assert.equal(missing.renderedCodePoint, 0x25A1);
assert.equal(missing.fallbackStage, "missing-square");
assert.equal(missing.glyph.source, "native-generated");

const unitItems = (text) => [...text].map((character) => ({ character }));
const wrap = (text, maxWidth) => wrapOfficialTmpItems(index, unitItems(text), {
  maxWidth,
  measure: (items) => items.filter((item) => item.character !== "\u00AD").length,
}).map((line) => line.items.map((item) => item.character).join(""));
assert.deepEqual(wrap("AB CD", 3), ["AB", "CD"]);
assert.deepEqual(wrap("A\u00A0B", 2), ["A\u00A0", "B"]);
assert.deepEqual(wrap("\u7532\u4E59\u3002\u4E19", 2), ["\u7532", "\u4E59\u3002", "\u4E19"]);
assert.deepEqual(wrap("\u7532\n\u4E59", 8), ["\u7532", "\u4E59"]);
assert.deepEqual(wrap("\u7532\uFF08\u4E59", 2), ["\u7532", "\uFF08\u4E59"]);
assert.deepEqual(wrap("AB\u00ADCD", 3), ["AB-", "CD"]);
const noBreakItems = unitItems("A-20 B").map((item, position) => ({
  ...item,
  noBreak: position >= 1 && position <= 3,
}));
assert.deepEqual(wrapOfficialTmpItems(index, noBreakItems, {
  maxWidth: 3,
  measure: (items) => items.length,
}).map((line) => line.items.map((item) => item.character).join("")), ["A-2", "0 B"]);
const movableNoBreakItems = unitItems("A -20 B").map((item, position) => ({
  ...item,
  noBreak: position >= 2 && position <= 4,
}));
assert.deepEqual(wrapOfficialTmpItems(index, movableNoBreakItems, {
  maxWidth: 4,
  measure: (items) => items.length,
}).map((line) => line.items.map((item) => item.character).join("")), ["A", "-20", "B"]);
assert([...index.fonts.values()].every((font) => Number.isFinite(font.italicStyle)));

const justifiedItems = unitItems("A B");
assert.deepEqual(computeOfficialTmpJustificationOffsets(justifiedItems, 3, 13, 1), [0, 0, 10]);
assert.deepEqual(computeOfficialTmpJustificationOffsets(justifiedItems, 3, 13, 0.4), [0, 6, 10]);
assert.deepEqual(computeOfficialTmpJustificationOffsets(unitItems("AB"), 2, 12, 0.4), [0, 10]);

console.log("Official TMP font data/layout test OK");
console.log(`  FontAssets=${index.fonts.size}; runtime glyph U+8449 -> ${leaf.glyph.glyphIndex}; inline Pokesymbol atlas exact`);
