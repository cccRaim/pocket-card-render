function point(x, y) {
  return { x, y };
}

/**
 * TextMeshPro 3.0.6 TextMeshProUGUI.GenerateTextMesh character quad math,
 * transformed from Unity's y-up local space to the renderer's y-down UI space.
 */
export function buildOfficialTmpGlyphQuad(entry, padding, stylePadding = 0) {
  const metrics = entry?.glyph?.metrics;
  if (!metrics) throw new TypeError("TMP glyph metrics are required");

  const scale = Number(entry.scale);
  const widthScale = Number(entry.widthScale ?? 1);
  const glyphPadding = Number(padding || 0);
  const boldStylePadding = Number(stylePadding || 0);
  const horizontalPadding = (glyphPadding + boldStylePadding) * scale * widthScale;
  const verticalPadding = glyphPadding * scale;
  const top = Number(entry.y) - verticalPadding;
  const bottom = Number(entry.y) + Number(entry.height) + verticalPadding;
  const left = Number(entry.x) - horizontalPadding;
  const right = Number(entry.x) + Number(entry.width) + horizontalPadding;

  let topShift = 0;
  let bottomShift = 0;
  if (entry.italic) {
    const shear = Number(entry.italicAngle ?? entry.font?.italicStyle ?? 0) * 0.01;
    const bearingY = Number(metrics.horizontalBearingY);
    const height = Number(metrics.height);
    const topShear = shear * (bearingY + glyphPadding + boldStylePadding) * scale;
    const bottomShear = shear * (bearingY - height - glyphPadding - boldStylePadding) * scale;
    const shearAdjustment = (topShear - bottomShear) / 2;
    topShift = topShear - shearAdjustment;
    bottomShift = bottomShear - shearAdjustment;
  }

  const bottomLeft = point(left + bottomShift, bottom);
  const topLeft = point(left + topShift, top);
  const topRight = point(right + topShift, top);
  const bottomRight = point(right + bottomShift, bottom);
  return {
    bottomLeft,
    topLeft,
    topRight,
    bottomRight,
    positions: [bottomLeft, topLeft, topRight, bottomRight],
    widthScale,
    scale,
    topShift,
    bottomShift,
  };
}

export function officialTmpGlyphInkRight(entry) {
  const quad = buildOfficialTmpGlyphQuad(entry, 0, 0);
  return Math.max(quad.topRight.x, quad.bottomRight.x);
}

export function resolveOfficialTmpItalic(componentFontStyle, runItalic = false) {
  return Boolean(runItalic) || (Number(componentFontStyle || 0) & 2) !== 0;
}
