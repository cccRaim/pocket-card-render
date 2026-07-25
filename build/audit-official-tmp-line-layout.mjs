import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  computeOfficialTmpJustificationOffsets,
  indexOfficialTmpFonts,
  wrapOfficialTmpItems,
} from "../public/render/tmp-font-data.js";
import { parseOfficialTmpRuns } from "../public/render/tmp-rich-text.js";
import { CANONICAL_LOCALIZED_TEXT_FILES } from "./full-runtime-sources.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONTRACT_PATH = path.join(ROOT, "public", "render", "tmp-line-layout-contract.json");
const SETTINGS_PATH = path.join(ROOT, "public", "render", "tmp-settings-contract.json");
const MANIFEST_PATH = path.join(ROOT, "public", "game", "tmp-fonts", "manifest.json");
const TEXT_DIR = path.join(ROOT, "public", "text");
const contract = JSON.parse(fs.readFileSync(CONTRACT_PATH, "utf8"));
const settings = JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf8"));
const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
const fontIndex = indexOfficialTmpFonts(manifest, settings);

assert.equal(contract.schemaVersion, 1);
assert.equal(contract.source.textMeshProVersion, "3.0.6");
assert.equal(contract.source.packageSha256, settings.source.textMeshProPackage.package.sha256);
assert.equal(contract.source.nativeGenerateTextMesh.sha256, settings.native.generateTextMesh.sha256);
assert.equal(contract.cardUiCensus.tmpComponentCount, 68);
assert.equal(contract.cardUiCensus.wrappedComponentCount, 23);
assert.deepEqual(contract.cardUiCensus.overflowMode, { 0: 68 });
assert.deepEqual(contract.cardUiCensus.rightToLeft, { 0: 68 });
assert.deepEqual(contract.cardUiCensus.wrappedHorizontalAlignment, { 1: 8, 2: 4, 4: 5, 8: 6 });
assert.equal(contract.localizedCanonicalCorpus.fileCount, 36);
assert.equal(contract.localizedCanonicalCorpus.locales.length, 9);

const NON_BREAKING = new Set(contract.constants.nonBreakingCodePoints);
const HARD_BREAK = new Set(contract.constants.explicitLineBreakCodePoints);
const leading = fontIndex.settings.leadingCharacters;
const following = fontIndex.settings.followingCharacters;
const modernHangul = fontIndex.settings.useModernHangulLineBreakingRules;

function inExclusiveRanges(codePoint, ranges) {
  return ranges.some(([start, end]) => codePoint > start && codePoint < end);
}

function isEastAsian(codePoint) {
  return (!modernHangul && inExclusiveRanges(codePoint, contract.constants.legacyHangulExclusiveRanges))
    || inExclusiveRanges(codePoint, contract.constants.cjkExclusiveRanges);
}

function isWhitespace(character) {
  const codePoint = character.codePointAt(0);
  return !NON_BREAKING.has(codePoint) && (/\s/u.test(character) || codePoint === 0x200B);
}

// Independent source transcription used as the audit oracle. It intentionally
// returns only saved-state boundaries, not the renderer's materialized lines.
function referenceBoundaries(items, maxWidth, firstLineWidth = maxWidth) {
  const output = [];
  let lineStart = 0;
  let wordBreak = 0;
  let softBreak = -1;
  let lastSoftBreak = 0;
  let lineIndex = 0;
  let firstWord = true;
  const finish = (end, hardBreak, kind) => {
    const softHyphen = !hardBreak && items[end - 1]?.character?.codePointAt(0) === 0xAD;
    output.push({
      sourceStart: lineStart,
      sourceEnd: end,
      hardBreak,
      breakKind: softHyphen ? "soft-hyphen" : kind,
    });
    lineStart = end;
    wordBreak = end;
    lineIndex += 1;
    firstWord = true;
  };

  for (let index = 0; index < items.length; index += 1) {
    if (index < lineStart) continue;
    const character = items[index].character || "\uFFFC";
    const codePoint = character.codePointAt(0);
    if (HARD_BREAK.has(codePoint)) {
      finish(index, true, "hard");
      lineStart = index + 1;
      wordBreak = lineStart;
      continue;
    }
    const width = items.slice(lineStart, index + 1).filter((item) => item.character?.codePointAt(0) !== 0xAD).length;
    const available = lineIndex === 0 ? firstLineWidth : maxWidth;
    if (width > available + contract.constants.horizontalOverflowEpsilon && index > lineStart) {
      let end = wordBreak > lineStart ? wordBreak : index;
      let kind = "word";
      if (firstWord && softBreak > lineStart && softBreak !== lastSoftBreak) {
        end = softBreak;
        lastSoftBreak = softBreak;
        kind = "soft";
      }
      finish(end, false, kind);
      index = lineStart - 1;
      continue;
    }

    const nextCharacter = items[index + 1]?.character || "";
    const hardCandidate = isWhitespace(character) || codePoint === 0x2D || codePoint === 0xAD;
    if (!items[index].noBreak && hardCandidate && !NON_BREAKING.has(codePoint)) {
      wordBreak = index + 1;
      firstWord = false;
      softBreak = -1;
      continue;
    }
    if (!items[index].noBreak && isEastAsian(codePoint)) {
      const currentLeading = leading.has(character);
      const nextFollowing = following.has(nextCharacter);
      if (!currentLeading && !nextFollowing) {
        wordBreak = index + 1;
        firstWord = false;
      }
      if (!currentLeading && firstWord) {
        if (isWhitespace(character)) softBreak = index + 1;
        wordBreak = index + 1;
      } else if (currentLeading && firstWord && index === lineStart) {
        if (isWhitespace(character)) softBreak = index + 1;
        wordBreak = index + 1;
      }
    } else if (firstWord) {
      if (isWhitespace(character) || codePoint === 0xAD) softBreak = index + 1;
      wordBreak = index + 1;
    }
  }
  output.push({ sourceStart: lineStart, sourceEnd: items.length, hardBreak: false, breakKind: "end" });
  return output;
}

function actualBoundaries(items, maxWidth, firstLineWidth = maxWidth) {
  return wrapOfficialTmpItems(fontIndex, items, {
    maxWidth,
    firstLineWidth,
    measure: (line) => line.filter((item) => item.character?.codePointAt(0) !== 0xAD).length,
  }).map(({ sourceStart, sourceEnd, hardBreak, breakKind }) => ({ sourceStart, sourceEnd, hardBreak, breakKind }));
}

function assertMatchesOracle(items, maxWidth, firstLineWidth = maxWidth, label = "case") {
  assert.deepEqual(
    actualBoundaries(items, maxWidth, firstLineWidth),
    referenceBoundaries(items, maxWidth, firstLineWidth),
    `${label} does not match TMP saved-state boundaries`,
  );
}

const fullWidthLeading = [...leading].find((character) => {
  const codePoint = character.codePointAt(0);
  return codePoint > 0xFF00 && codePoint < 0xFFEF;
});
const fullWidthFollowing = [...following].find((character) => {
  const codePoint = character.codePointAt(0);
  return codePoint > 0xFF00 && codePoint < 0xFFEF;
});
assert(fullWidthLeading && fullWidthFollowing, "official line-breaking tables lack full-width audit characters");

const alphabet = ["A", " ", "-", "\u00AD", "\u00A0", "\u7532", fullWidthLeading, fullWidthFollowing];
let exhaustiveCases = 0;
function visit(prefix, remaining) {
  if (prefix.length) {
    const items = prefix.map((character) => ({ character }));
    for (let width = 1; width <= 4; width += 1) {
      assertMatchesOracle(items, width, Math.max(1, width - 1), `exhaustive ${JSON.stringify(prefix)}/${width}`);
      exhaustiveCases += 1;
    }
  }
  if (!remaining) return;
  for (const character of alphabet) visit([...prefix, character], remaining - 1);
}
visit([], 4);

for (const codePoint of contract.constants.nonBreakingCodePoints) {
  assertMatchesOracle([...`A${String.fromCodePoint(codePoint)}BC`].map((character) => ({ character })), 2, 2, `non-breaking U+${codePoint.toString(16)}`);
}
for (const codePoint of contract.constants.explicitLineBreakCodePoints) {
  assertMatchesOracle([...`A${String.fromCodePoint(codePoint)}B`].map((character) => ({ character })), 8, 8, `hard break U+${codePoint.toString(16)}`);
}
for (const codePoint of [0x1100, 0x1101, 0x11FE, 0x11FF, 0xA960, 0xA961, 0xA97E, 0xA97F, 0xAC00, 0xAC01, 0xD7FE, 0xD7FF]) {
  assertMatchesOracle([...`A${String.fromCodePoint(codePoint)}BC`].map((character) => ({ character })), 2, 2, `Hangul boundary U+${codePoint.toString(16)}`);
}

const noBreakCases = [
  [..."A-20 B"].map((character, index) => ({ character, noBreak: index >= 1 && index <= 3 })),
  [..."A -20 B"].map((character, index) => ({ character, noBreak: index >= 2 && index <= 4 })),
];
for (const [index, items] of noBreakCases.entries()) {
  for (const width of [2, 3, 4, 5]) assertMatchesOracle(items, width, width, `nobr-${index}/${width}`);
}

let localizedCases = 0;
let localizedElements = 0;
for (const name of CANONICAL_LOCALIZED_TEXT_FILES) {
  const document = JSON.parse(fs.readFileSync(path.join(TEXT_DIR, name), "utf8"));
  for (const element of document.elements || []) {
    if (element.kind !== "text" || !element.wrap) continue;
    localizedElements += 1;
    const items = [];
    for (const run of parseOfficialTmpRuns(element.text, {}, element.inlineEx)) {
      if (run.img || run.sprite || run.symbol) items.push({ character: "\uFFFC", ...run });
      else for (const character of run.t) items.push({ character, noBreak: run.noBreak, bold: run.bold, italic: run.italic });
    }
    for (const width of [1, 2, 3, 5, 8, 13, 21]) {
      assertMatchesOracle(items, width, Math.max(1, width - (element.indent ? 1 : 0)), `${name}:${element.layoutPath}/${width}`);
      localizedCases += 1;
    }
  }
}
assert.equal(localizedElements, contract.localizedCanonicalCorpus.wrappedTextElementCount);

assert.deepEqual(computeOfficialTmpJustificationOffsets(
  [{ character: "A" }, { character: "B" }], 2, 12, 0.4,
), [0, 10], "TMP uses ratio=1 when a justified line has no separators");
assert.deepEqual(computeOfficialTmpJustificationOffsets(
  [{ character: "A" }, { character: " " }, { character: "B" }], 3, 13, 0.4,
), [0, 6, 10]);
assert.deepEqual(computeOfficialTmpJustificationOffsets(
  [{ character: " " }, { character: "A" }], 1, 11, 0.4,
), [0, 10], "TMP excludes the first separator from the space divisor");

const fontDataSource = fs.readFileSync(path.join(ROOT, "public", "render", "tmp-font-data.js"), "utf8");
const appSource = fs.readFileSync(path.join(ROOT, "public", "app.js"), "utf8");
for (const token of ["savedWordBreak", "savedSoftBreak", "lastSoftBreak", "isJustificationSeparator"]) {
  assert(fontDataSource.includes(token), `runtime line-layout implementation lacks ${token}`);
}
assert(appSource.includes("computeOfficialTmpJustificationOffsets"));
assert(appSource.includes("wrapOfficialTmpItems"));

console.log("Official TMP line-layout audit OK");
console.log(`  source ranges=${Object.keys(contract.source.uguiGenerator.ranges).length + Object.keys(contract.source.tmpText.ranges).length + 1}; exhaustive states=${exhaustiveCases}`);
console.log(`  canonical localized wrap cases=${localizedCases} (${localizedElements} elements, 36 files, 9 locales)`);
console.log("  reachable UI: 23 wrapped components; Overflow(0); LTR; Left/Center/Right/Justified");
