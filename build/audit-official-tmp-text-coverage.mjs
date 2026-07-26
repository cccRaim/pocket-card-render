import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isCardTextControl } from "./card-text-resolver.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TEXT_DIR = path.join(ROOT, "public/text");
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "public/game/tmp-fonts/manifest.json"), "utf8"));
assert.equal(manifest.schemaVersion, 1);
const localizedTextFiles = fs.readdirSync(TEXT_DIR).filter((filename) => /\.json$/.test(filename)).sort();
assert.equal(manifest.source.localizedTextFileCount, localizedTextFiles.length);

const fonts = new Map(Object.entries(manifest.fonts).map(([fontId, font]) => {
  const characters = new Map([
    ...(font.characters || []).map((entry) => [entry.unicode, { ...entry, source: "official-preloaded" }]),
    ...(font.runtimeCharacters || []).map((entry) => [entry.unicode, { ...entry, source: "native-generated" }]),
    ...(font.syntheticCharacters || []).map((entry) => [entry.unicode, { ...entry, source: "game-tag-synthetic" }]),
  ]);
  const glyphs = new Map([
    ...(font.glyphs || []).map((entry) => [entry.index, { ...entry, source: "official-preloaded" }]),
    ...(font.runtimeGlyphs || []).map((entry) => [entry.glyphIndex, { ...entry, source: "native-generated" }]),
    ...(font.syntheticGlyphs || []).map((entry) => [entry.glyphIndex, { ...entry, source: "game-tag-synthetic" }]),
  ]);
  return [fontId, { ...font, characters, glyphs }];
}));

let files = 0;
let textElements = 0;
let characters = 0;
let preloaded = 0;
let generated = 0;
let synthetic = 0;

function checkText(fontId, text, filename) {
  const font = fonts.get(String(fontId));
  assert(font, `${filename}: unknown FontAsset ${fontId}`);
  for (const character of text) {
    if ("\r\n".includes(character) || isCardTextControl(character)) continue;
    const row = font.characters.get(character.codePointAt(0));
    assert(row, `${filename}: FontAsset ${fontId} lacks ${JSON.stringify(character)}`);
    assert(font.glyphs.has(row.glyphIndex), `${filename}: glyph ${row.glyphIndex} has no metrics/rect row`);
    characters += 1;
    if (row.source === "official-preloaded") preloaded += 1;
    else if (row.source === "native-generated") generated += 1;
    else {
      assert.equal(character.codePointAt(0), 0x2005, `${filename}: unexpected synthetic character`);
      assert.equal(row.provenance, "masterdata:Text:Char/FOUR-PER-EM-SPACE");
      const glyph = font.glyphs.get(row.glyphIndex);
      assert.equal(glyph.advanceEm, 0.25);
      assert.equal(glyph.metrics.horizontalAdvance, Number(font.face.pointSize) / 4);
      assert.equal(glyph.rect.width, 0);
      assert.equal(glyph.rect.height, 0);
      synthetic += 1;
    }
  }
}

for (const filename of localizedTextFiles) {
  const data = JSON.parse(fs.readFileSync(path.join(TEXT_DIR, filename), "utf8"));
  files += 1;
  for (const element of data.elements || []) {
    if (element.kind !== "text") continue;
    let bold = false;
    let run = "";
    const flush = () => {
      if (run) checkText(bold ? (element.boldStyle?.fontId || element.sdf?.fontId) : element.sdf?.fontId, run, filename);
      run = "";
    };
    for (const character of element.text || "") {
      if (character === "\x01" || character === "\x02") {
        flush();
        bold = character === "\x01";
      } else if (character !== "\x03") {
        run += character;
      }
    }
    flush();
    textElements += 1;
  }
}

assert.equal(files, localizedTextFiles.length);
assert(characters > 0);
assert(preloaded > 0);
assert(generated > 0);
assert(synthetic > 0);
console.log("Official TMP localized text glyph coverage OK");
console.log(`  files=${files} text-elements=${textElements} characters=${characters}`);
console.log(`  official-preloaded=${preloaded} native-generated=${generated} game-tag-synthetic=${synthetic}`);
