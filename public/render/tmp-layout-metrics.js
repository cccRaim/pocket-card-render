import {
  layoutOfficialTmpRun,
  measureOfficialTmpText,
  wrapOfficialTmpItems,
} from "./tmp-font-data.js";
import { officialTmpGlyphInkRight } from "./tmp-glyph-mesh.js";
import { parseOfficialTmpRuns } from "./tmp-rich-text.js";
import { layoutOfficialTmpSprite } from "./tmp-sprite-data.js";

function finite(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new TypeError(`${label} must be finite`);
  return number;
}

function runSdf(element, bold) {
  return bold && element.boldStyle
    ? {
        ...(element.boldStyle.sdf || {}),
        fontId: element.boldStyle.fontId,
        materialId: element.boldStyle.materialId,
      }
    : element.sdf;
}

export function officialTmpLayoutOptions(element) {
  return {
    characterSpacing: Number(element.characterSpacing || 0),
    wordSpacing: Number(element.wordSpacing || 0),
    charWidthAdjustment: Number(element.charWidthAdjustment || 0),
    kerning: element.kerning !== false,
  };
}

function fontFor(fonts, element, bold = false) {
  const fontId = runSdf(element, bold)?.fontId;
  const font = fontId && fonts?.fonts?.get(String(fontId));
  if (!font) {
    throw new Error(
      `official TMP layout lacks FontAsset ${String(fontId || "<unset>")}`,
    );
  }
  return { fontId: String(fontId), font };
}

function textBounds(fonts, element, text, fontSize, bold = false, italic = false) {
  const { fontId, font } = fontFor(fonts, element, bold);
  const layout = layoutOfficialTmpRun(
    fonts,
    fontId,
    text,
    fontSize,
    0,
    0,
    officialTmpLayoutOptions(element),
  );
  const right = layout.glyphs.reduce(
    (value, glyph) => Math.max(
      value,
      officialTmpGlyphInkRight(italic ? { ...glyph, italic: true } : glyph),
    ),
    0,
  );
  return {
    advance: layout.advance,
    right,
    ascent: Number(font.face.ascentLine) * layout.scale,
    descent: -Number(font.face.descentLine) * layout.scale,
  };
}

function fontVerticalBounds(fonts, element, fontSize, bold = false) {
  const { font } = fontFor(fonts, element, bold);
  const scale = fontSize / Number(font.face.pointSize) * Number(font.face.scale || 1);
  return {
    ascent: Number(font.face.ascentLine) * scale,
    descent: -Number(font.face.descentLine) * scale,
  };
}

function lineHeight(fonts, element, fontSize, lineSpacingDelta = 0) {
  const { font } = fontFor(fonts, element, false);
  const baseScale = fontSize / Number(font.face.pointSize) * Number(font.face.scale || 1);
  const emScale = fontSize * 0.01;
  return (Number(font.face.lineHeight) + Number(lineSpacingDelta || 0)) * baseScale
    + Number(element.lineSpacing || 0) * emScale;
}

function spriteBounds(fonts, spriteContract, element, item, fontSize) {
  if (!spriteContract) throw new Error("official TMP sprite contract is absent");
  const { font } = fontFor(fonts, element, false);
  return layoutOfficialTmpSprite(
    spriteContract,
    font.face,
    item.spriteIndex,
    fontSize,
    Number(item.fontSize || fontSize),
  );
}

function itemizeRuns(runs) {
  const items = [];
  for (const run of runs) {
    if (run.sprite || run.img || run.symbol) {
      items.push({ character: "\uFFFC", ...run });
      continue;
    }
    for (const character of String(run.t || "")) {
      items.push({
        character,
        t: character,
        bold: run.bold,
        italic: run.italic,
        noBreak: run.noBreak,
      });
    }
  }
  return items;
}

function groupItems(items) {
  const groups = [];
  for (const item of items) {
    const previous = groups[groups.length - 1];
    if (
      !item.sprite
      && !item.img
      && !item.symbol
      && previous
      && !previous.sprite
      && !previous.img
      && !previous.symbol
      && previous.bold === item.bold
      && previous.italic === item.italic
    ) {
      previous.t += item.t;
    } else {
      groups.push(
        item.sprite || item.img || item.symbol
          ? { ...item }
          : {
              t: item.t,
              bold: item.bold,
              italic: item.italic,
              noBreak: item.noBreak,
            },
      );
    }
  }
  return groups;
}

function measureItems(fonts, spriteContract, element, items, fontSize) {
  let width = 0;
  let ascent = 0;
  let descent = 0;
  for (const item of groupItems(items)) {
    if (item.sprite) {
      const bounds = spriteBounds(fonts, spriteContract, element, item, fontSize);
      width += bounds.advance;
      ascent = Math.max(ascent, bounds.ascent);
      descent = Math.max(descent, bounds.descent);
    } else if (item.symbol) {
      const symbolSize = Number(item.fontSize || fontSize);
      const symbolElement = {
        ...element,
        sdf: item.sdf,
        charWidthAdjustment: 0,
      };
      const bounds = textBounds(
        fonts,
        symbolElement,
        item.glyph,
        symbolSize,
      );
      width += bounds.advance;
      ascent = Math.max(ascent, bounds.ascent);
      descent = Math.max(descent, bounds.descent);
    } else if (item.img) {
      throw new Error(
        "official TMP layout cannot measure an unbound inline image; "
        + "the composition must provide a TMP sprite or font glyph",
      );
    } else if (item.t) {
      const bounds = textBounds(
        fonts,
        element,
        item.t,
        fontSize,
        item.bold,
        item.italic,
      );
      width += bounds.advance;
      ascent = Math.max(ascent, bounds.ascent);
      descent = Math.max(descent, bounds.descent);
    }
  }
  if (ascent === 0 && descent === 0) {
    const bounds = fontVerticalBounds(fonts, element, fontSize);
    ascent = bounds.ascent;
    descent = bounds.descent;
  }
  return { width, ascent, descent };
}

function hardLines(items) {
  const lines = [[]];
  for (const item of items) {
    const codePoint = (item.character || "").codePointAt(0);
    if (codePoint === 0x0A || codePoint === 0x0B
      || codePoint === 0x2028 || codePoint === 0x2029) {
      lines.push([]);
    } else {
      lines[lines.length - 1].push(item);
    }
  }
  return lines;
}

function blockMetrics(fonts, spriteContract, element, lines, fontSize) {
  if (lines.length === 1 && lines[0].length === 0) {
    return {
      width: 0,
      height: 0,
      lineCount: 0,
      lines: [],
    };
  }
  const metrics = lines.map((items) => (
    measureItems(fonts, spriteContract, element, items, fontSize)
  ));
  const heightPerLine = lineHeight(fonts, element, fontSize);
  const first = metrics[0] || fontVerticalBounds(fonts, element, fontSize);
  const last = metrics[metrics.length - 1] || first;
  const height = metrics.length
    ? first.ascent + last.descent + Math.max(0, metrics.length - 1) * heightPerLine
    : 0;
  return {
    width: metrics.reduce((maximum, entry) => Math.max(maximum, entry.width), 0),
    height,
    lineCount: metrics.length,
    lines: metrics,
  };
}

/**
 * Return the values exposed by TMP_Text's ILayoutElement surface.
 *
 * Official ARM64 getters prove flexible=(-1,-1), min=(0,0), priority=0.
 * Preferred values are generated from the same font, rich-text, sprite and
 * line-breaking primitives used by the card renderer.
 */
export function measureOfficialTmpLayoutElement({
  fonts,
  spriteContract = null,
  element,
  rectSize,
}) {
  if (!element || element.kind !== "text") {
    throw new TypeError("official TMP layout requires a text element");
  }
  const width = finite(rectSize?.[0], "TMP RectTransform width");
  finite(rectSize?.[1], "TMP RectTransform height");
  const fontSize = finite(element.fs, "TMP font size");
  const margins = Array.isArray(element.margin) && element.margin.length === 4
    ? element.margin.map((value, index) => finite(value, `TMP margin[${index}]`))
    : [0, 0, 0, 0];
  const runs = parseOfficialTmpRuns(
    element.text,
    element.inlineSprites,
    element.inlineEx,
  );
  const items = itemizeRuns(runs);
  const unwrapped = blockMetrics(
    fonts,
    spriteContract,
    element,
    hardLines(items),
    fontSize,
  );
  let vertical = unwrapped;
  const availableWidth = width - margins[0] - margins[2];
  if (element.wrap && availableWidth > 0) {
    const layoutIndent = Number(
      element.layoutIndent ?? element.indent ?? 0,
    );
    const wrapped = wrapOfficialTmpItems(fonts, items, {
      maxWidth: availableWidth,
      firstLineWidth: Math.max(
        0.0001,
        availableWidth - layoutIndent,
      ),
      measure: (candidate) => (
        measureItems(fonts, spriteContract, element, candidate, fontSize).width
      ),
    });
    vertical = blockMetrics(
      fonts,
      spriteContract,
      element,
      wrapped.map((line) => line.items),
      fontSize,
    );
  }
  return {
    min: [0, 0],
    preferred: [
      unwrapped.width + margins[0] + margins[2],
      vertical.height + margins[1] + margins[3],
    ],
    flexible: [-1, -1],
    layoutPriority: 0,
    diagnostics: {
      unwrappedWidth: unwrapped.width,
      preferredHeight: vertical.height,
      lineCount: vertical.lineCount,
      fontSize,
    },
  };
}

export function measureOfficialTmpAdvance(fonts, element, text, fontSize) {
  const { fontId } = fontFor(fonts, element, false);
  return measureOfficialTmpText(
    fonts,
    fontId,
    text,
    fontSize,
    officialTmpLayoutOptions(element),
  );
}
