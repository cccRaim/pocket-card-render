function finite(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`invalid TMP sprite ${label}`);
  return number;
}

export function resolveOfficialTmpSprite(contract, spriteIndex) {
  if (contract?.schemaVersion !== 1) throw new Error("unsupported TMP sprite contract schema");
  const index = Number(spriteIndex);
  const glyph = contract.spriteAsset.glyphs.find((entry) => entry.index === index);
  const character = contract.spriteAsset.characters.find((entry) => entry.glyphIndex === index);
  if (!glyph || !character) throw new Error(`missing official TMP sprite index ${spriteIndex}`);
  return { glyph, character };
}

/**
 * Port of Unity 2022.3.62f2 TextGenerator's pointSize==0 SpriteAsset branch.
 * Returned destination coordinates use Canvas' downward-positive Y axis.
 */
export function layoutOfficialTmpSprite(
  contract,
  fontFace,
  spriteIndex,
  currentFontSize,
  tagFontSize,
  xAdvance = 0,
  baseline = 0,
) {
  const { glyph, character } = resolveOfficialTmpSprite(contract, spriteIndex);
  const pointSize = finite(fontFace?.pointSize, "font point size");
  const fontScale = finite(fontFace?.scale ?? 1, "font scale");
  const fontAscent = finite(fontFace?.ascentLine, "font ascent");
  const fontDescent = finite(fontFace?.descentLine, "font descent");
  const currentSize = finite(currentFontSize, "current font size");
  const spriteSize = finite(tagFontSize, "tag font size");
  if (!(pointSize > 0) || !(glyph.metrics.height > 0)) throw new Error("invalid TMP sprite scale denominator");

  const beforeAdvance = finite(contract.preprocessor.spaceBeforeEm, "leading space") * currentSize;
  const afterAdvance = finite(contract.preprocessor.spaceAfterEm, "trailing space") * spriteSize;
  const spriteScale = spriteSize / pointSize * fontScale;
  const elementScale = fontAscent / glyph.metrics.height
    * finite(character.scale, "character scale")
    * finite(glyph.scale, "glyph scale")
    * spriteScale;
  const spriteOrigin = finite(xAdvance, "x advance") + beforeAdvance;
  const left = spriteOrigin + glyph.metrics.horizontalBearingX * elementScale;
  const top = finite(baseline, "baseline") - glyph.metrics.horizontalBearingY * elementScale;
  const spriteAdvance = glyph.metrics.horizontalAdvance * elementScale;
  const rect = glyph.glyphRect;
  return {
    spriteIndex: Number(spriteIndex),
    characterName: character.name,
    currentFontSize: currentSize,
    tagFontSize: spriteSize,
    spriteScale,
    elementScale,
    beforeAdvance,
    afterAdvance,
    spriteAdvance,
    advance: beforeAdvance + spriteAdvance + afterAdvance,
    left,
    top,
    width: glyph.metrics.width * elementScale,
    height: glyph.metrics.height * elementScale,
    ascent: fontAscent * spriteScale,
    descent: -fontDescent * spriteScale,
    source: {
      x: rect.x,
      y: contract.texture.height - rect.y - rect.height,
      width: rect.width,
      height: rect.height,
    },
  };
}
