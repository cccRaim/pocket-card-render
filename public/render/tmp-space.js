// TMP <space> advances the pen without creating a glyph or a break opportunity.
export function tmpTextTokens(text) {
  return [...String(text).matchAll(/<space=([+-]?(?:\d+(?:\.\d*)?|\.\d+))(em|px)?>|([\s\S])/gu)]
    .map((match) => match[3] !== undefined ? { character: match[3] }
      : { space: Number(match[1]), unit: match[2] || "px" });
}

export function tmpSpaceAdvance(token, fontSize) {
  return token.space * (token.unit === "em" ? fontSize : 1);
}

export function layoutCanvasTmpSpaceText(context, text, fontSize) {
  const runs = [];
  let width = 0;
  let current = "";
  const flush = () => {
    if (!current) return;
    const metrics = context.measureText(current);
    runs.push({ text: current, x: width, metrics });
    width += metrics.width;
    current = "";
  };
  for (const token of tmpTextTokens(text)) {
    if (token.space === undefined) current += token.character;
    else { flush(); width += tmpSpaceAdvance(token, fontSize); }
  }
  flush();
  return { runs, width };
}
