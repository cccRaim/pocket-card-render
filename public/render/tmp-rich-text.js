const BOLD_START = "\x01";
const BOLD_END = "\x02";
const EX_IMAGE = "\x03";
const ITALIC_START = "\x04";
const ITALIC_END = "\x05";
const NO_BREAK_START = "\x06";
const NO_BREAK_END = "\x07";

/**
 * Decode compact card-text controls into TMP layout runs. Bold and italic
 * mirror Unity's FontStyleStack counters; <nobr> mirrors its boolean state.
 */
export function parseOfficialTmpRuns(text, inlineSprites = {}, inlineEx = null) {
  const runs = [];
  let boldDepth = 0;
  let italicDepth = 0;
  let noBreak = false;
  let current = "";

  const style = () => ({ bold: boldDepth > 0, italic: italicDepth > 0, noBreak });
  const flush = () => {
    if (!current) return;
    runs.push({ t: current, ...style() });
    current = "";
  };

  for (const character of String(text || "")) {
    if (character === BOLD_START) {
      flush(); boldDepth = Math.min(255, boldDepth + 1);
    } else if (character === BOLD_END) {
      flush(); boldDepth = Math.max(0, boldDepth - 1);
    } else if (character === ITALIC_START) {
      flush(); italicDepth = Math.min(255, italicDepth + 1);
    } else if (character === ITALIC_END) {
      flush(); italicDepth = Math.max(0, italicDepth - 1);
    } else if (character === NO_BREAK_START || character === NO_BREAK_END) {
      flush(); noBreak = character === NO_BREAK_START;
    } else if (character === EX_IMAGE) {
      flush();
      runs.push(inlineEx
        ? { sprite: "ex", ...inlineEx, ...style() }
        : { img: "ex", ...style() });
    } else if (inlineSprites[character]) {
      flush();
      const inline = inlineSprites[character];
      runs.push(inline.glyph
        ? { symbol: "element", ...inline, ...style() }
        : { img: "element", ...inline, ...style() });
    } else {
      current += character;
    }
  }
  flush();
  return runs;
}
