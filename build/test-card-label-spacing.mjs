import assert from "node:assert/strict";
import fs from "node:fs";
import { withCardLabelSpacing } from "../public/render/card-label-spacing.js";
import { indexOfficialTmpFonts, layoutOfficialTmpRun } from "../public/render/tmp-font-data.js";
import { layoutCanvasTmpSpaceText } from "../public/render/tmp-space.js";

const fonts = indexOfficialTmpFonts(JSON.parse(fs.readFileSync(
  new URL("../public/game/tmp-fonts/manifest.json", import.meta.url), "utf8",
)));
const fontId = "1482346930774817996";
for (const [text, path] of [["弱點", "/weak_txt"], ["撤退", "/escape_txt_jp"]]) {
  for (const characterSpacing of [-1, 0, 11]) {
    const element = { text, layoutPath: path, characterSpacing };
    const corrected = withCardLabelSpacing(element);
    assert.equal(corrected.characterSpacing, characterSpacing);
    assert.equal(element.text, text);
    assert.equal(withCardLabelSpacing(corrected), corrected);
    for (const fontSize of [8, 16, 32]) {
      const plain = layoutOfficialTmpRun(fonts, fontId, text, fontSize, 0, 0, element);
      const spaced = layoutOfficialTmpRun(fonts, fontId, corrected.text, fontSize, 0, 0, corrected);
      assert.equal(spaced.glyphs.length, 2, "space tags must not create glyphs");
      assert.ok(Math.abs(spaced.advance - plain.advance - fontSize) < 1e-6);
      assert.ok(Math.abs(spaced.glyphs[1].x - plain.glyphs[1].x - fontSize) < 1e-6);
      assert.equal(spaced.glyphs[0].width, plain.glyphs[0].width);
      assert.ok(Math.abs((spaced.glyphs[0].x - spaced.advance / 2)
        - (plain.glyphs[0].x - plain.advance / 2) + fontSize / 2) < 1e-6);
    }
  }
}
const body = { text: "弱點", layoutPath: "/description_txt" };
assert.equal(withCardLabelSpacing(body), body);
assert.equal(withCardLabelSpacing({ text: "にげる", layoutPath: "/escape_txt_jp" }).text,
  "に<space=0.1em>げ<space=0.1em>る");
assert.equal(withCardLabelSpacing({ text: "약점", layoutPath: "/weak_txt" }).text, "약<space=1em>점");
const measure = { measureText: text => ({ width: [...text].length * 16 }) };
assert.deepEqual(layoutCanvasTmpSpaceText(measure, "弱<space=1em>點", 16).runs.map(r => [r.text, r.x]),
  [["弱", 0], ["點", 32]]);
assert.equal(layoutCanvasTmpSpaceText(measure, "A<space=-2px>B", 16).width, 30);
console.log("Card label spacing OK: markup advance, authored spacing, scaling, centering, fallback and idempotence");
