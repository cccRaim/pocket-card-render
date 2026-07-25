import assert from "node:assert/strict";
import { parseOfficialTmpRuns } from "../public/render/tmp-rich-text.js";

const B0 = "\x01";
const B1 = "\x02";
const I0 = "\x04";
const I1 = "\x05";
const N0 = "\x06";
const N1 = "\x07";
const EX = "\x03";
const FIRE = "\uE102";

assert.deepEqual(
  parseOfficialTmpRuns(`${B0}A${B0}B${B1}C${B1}D`),
  [
    { t: "A", bold: true, italic: false, noBreak: false },
    { t: "B", bold: true, italic: false, noBreak: false },
    { t: "C", bold: true, italic: false, noBreak: false },
    { t: "D", bold: false, italic: false, noBreak: false },
  ],
);
const inlineEx = {
  spriteAssetId: "840073264968542736",
  materialId: "-1050951510632854060",
  textureId: "3209478181533236899",
  spriteIndex: 3,
  fontSize: 16,
};
assert.deepEqual(
  parseOfficialTmpRuns(EX, {}, inlineEx),
  [{ sprite: "ex", ...inlineEx, bold: false, italic: false, noBreak: false }],
  "[Img:ex] carries the official SpriteAsset binding instead of a generic image run",
);
assert.deepEqual(
  parseOfficialTmpRuns(`${I0}A${B0}B${I1}C${B1}`),
  [
    { t: "A", bold: false, italic: true, noBreak: false },
    { t: "B", bold: true, italic: true, noBreak: false },
    { t: "C", bold: true, italic: false, noBreak: false },
  ],
);
assert.deepEqual(
  parseOfficialTmpRuns(`${N0}A${N0}B${N1}C${N1}D`),
  [
    { t: "A", bold: false, italic: false, noBreak: true },
    { t: "B", bold: false, italic: false, noBreak: true },
    { t: "C", bold: false, italic: false, noBreak: false },
    { t: "D", bold: false, italic: false, noBreak: false },
  ],
  "Unity TextGenerator stores <nobr> as a boolean rather than a nested stack",
);
assert.deepEqual(
  parseOfficialTmpRuns(`${B0}A${EX}${FIRE}B${B1}`, {
    [FIRE]: { type: "Fire", glyph: "\uE009", fontSize: 23 },
  }),
  [
    { t: "A", bold: true, italic: false, noBreak: false },
    { img: "ex", bold: true, italic: false, noBreak: false },
    { symbol: "element", type: "Fire", glyph: "\uE009", fontSize: 23, bold: true, italic: false, noBreak: false },
    { t: "B", bold: true, italic: false, noBreak: false },
  ],
);
assert.deepEqual(
  parseOfficialTmpRuns(`${B1}A${I1}B`),
  [
    { t: "A", bold: false, italic: false, noBreak: false },
    { t: "B", bold: false, italic: false, noBreak: false },
  ],
  "unmatched closing tags saturate at zero like FontStyleStack.Remove",
);

console.log("Official TMP rich-text state test OK");
console.log("  FontStyleStack counters and TextGenerator <nobr> boolean are preserved");
