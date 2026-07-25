import * as THREE from "three";

function adjustmentValues(record) {
  const value = record?.m_GlyphValueRecord || {};
  return {
    xPlacement: Number(value.m_XPlacement || 0),
    yPlacement: Number(value.m_YPlacement || 0),
    xAdvance: Number(value.m_XAdvance || 0),
    yAdvance: Number(value.m_YAdvance || 0),
  };
}

function addAdjustment(a, b) {
  return {
    xPlacement: a.xPlacement + b.xPlacement,
    yPlacement: a.yPlacement + b.yPlacement,
    xAdvance: a.xAdvance + b.xAdvance,
    yAdvance: a.yAdvance + b.yAdvance,
  };
}

const ZERO_ADJUSTMENT = Object.freeze({ xPlacement: 0, yPlacement: 0, xAdvance: 0, yAdvance: 0 });

export function indexOfficialTmpFonts(manifest, settingsContract = null) {
  if (manifest?.schemaVersion !== 1) throw new Error("unsupported official TMP atlas manifest schema");
  if (settingsContract && settingsContract.schemaVersion !== 2) {
    throw new Error("unsupported official TMP settings contract schema");
  }
  const fonts = new Map();
  for (const [fontId, source] of Object.entries(manifest.fonts || {})) {
    const characters = new Map([
      ...(source.characters || []).map((entry) => [entry.unicode, { ...entry, source: "official-preloaded" }]),
      ...(source.runtimeCharacters || []).map((entry) => [entry.unicode, { ...entry, source: "native-generated" }]),
    ]);
    const glyphs = new Map([
      ...(source.glyphs || []).map((entry) => [entry.index, { ...entry, source: "official-preloaded" }]),
      ...(source.runtimeGlyphs || []).map((entry) => [entry.glyphIndex, { ...entry, source: "native-generated" }]),
    ]);
    const pairs = new Map();
    for (const pair of source.fontFeatureTable?.m_GlyphPairAdjustmentRecords || []) {
      const first = pair.m_FirstAdjustmentRecord;
      const second = pair.m_SecondAdjustmentRecord;
      pairs.set(`${first.m_GlyphIndex}:${second.m_GlyphIndex}`, {
        first: adjustmentValues(first),
        second: adjustmentValues(second),
        lookupFlags: Number(pair.m_FeatureLookupFlags || 0),
      });
    }
    fonts.set(fontId, { ...source, characters, glyphs, pairs });
  }
  const settings = settingsContract ? {
    contract: settingsContract,
    leadingCharacters: new Set([...settingsContract.lineBreaking.leadingCharacters.text]),
    followingCharacters: new Set([...settingsContract.lineBreaking.followingCharacters.text]),
    useModernHangulLineBreakingRules: Boolean(settingsContract.settings.useModernHangulLineBreakingRules),
    missingGlyphCharacter: Number(settingsContract.settings.missingGlyphCharacter || 0),
    fallbackFontAssetIds: (settingsContract.settings.fallbackFontAssetPPtrs || [])
      .map((pointer) => String(pointer.pathId || 0))
      .filter((pathId) => pathId !== "0"),
    defaultFontAssetId: String(settingsContract.settings.defaultFontAssetPPtr?.pathId || 0),
    defaultSpriteAssetId: String(settingsContract.settings.defaultSpriteAssetPPtr?.pathId || 0),
  } : null;
  return { manifest, settings, fonts, textures: new Map() };
}

export async function loadOfficialTmpFonts(
  url = "/game/tmp-fonts/manifest.json",
  settingsUrl = "/render/tmp-settings-contract.json",
) {
  const [response, settingsResponse] = await Promise.all([fetch(url), fetch(settingsUrl)]);
  if (!response.ok) throw new Error(`official TMP atlas manifest: HTTP ${response.status}`);
  if (!settingsResponse.ok) throw new Error(`official TMP settings contract: HTTP ${settingsResponse.status}`);
  return indexOfficialTmpFonts(await response.json(), await settingsResponse.json());
}

export function resolveOfficialTmpGlyph(index, fontId, codePoint) {
  const font = index.fonts.get(String(fontId));
  if (!font) return null;
  const characterRecord = font.characters.get(codePoint);
  if (!characterRecord) return null;
  const glyph = font.glyphs.get(characterRecord.glyphIndex);
  if (!glyph) return null;
  const atlas = glyph.source === "native-generated"
    ? font.runtimeAtlases?.[glyph.page]
    : font.atlases?.[glyph.atlasIndex];
  return { fontId: String(fontId), font, characterRecord, glyph, atlas };
}

function resolveFromFontTree(index, fontId, codePoint, searched = new Set()) {
  const id = String(fontId || 0);
  if (id === "0" || searched.has(id)) return null;
  searched.add(id);
  const direct = resolveOfficialTmpGlyph(index, id, codePoint);
  if (direct) return direct;
  const font = index.fonts.get(id);
  for (const fallbackId of font?.fallbackFontAssetIds || []) {
    const resolved = resolveFromFontTree(index, fallbackId, codePoint, searched);
    if (resolved) return resolved;
  }
  return null;
}

function withResolution(resolved, requestedCodePoint, renderedCodePoint, fallbackStage) {
  return resolved ? {
    ...resolved,
    requestedCodePoint,
    renderedCodePoint,
    fallbackStage,
  } : null;
}

/** Reproduce TMP 3.0.6's UGUI font/default/missing-glyph search order. */
export function resolveOfficialTmpTextElement(index, fontId, codePoint) {
  const requested = Number(codePoint);
  let resolved = resolveFromFontTree(index, fontId, requested);
  if (resolved) return withResolution(resolved, requested, requested, "primary-or-local-fallback");

  for (const fallbackId of index.settings?.fallbackFontAssetIds || []) {
    resolved = resolveFromFontTree(index, fallbackId, requested);
    if (resolved) return withResolution(resolved, requested, requested, "global-fallback");
  }
  resolved = resolveFromFontTree(index, index.settings?.defaultFontAssetId, requested);
  if (resolved) return withResolution(resolved, requested, requested, "default-font");

  const replacement = Number(index.settings?.missingGlyphCharacter || 0) || 0x25A1;
  resolved = resolveFromFontTree(index, fontId, replacement);
  if (resolved) return withResolution(resolved, requested, replacement, "missing-square");
  for (const fallbackId of index.settings?.fallbackFontAssetIds || []) {
    resolved = resolveFromFontTree(index, fallbackId, replacement);
    if (resolved) return withResolution(resolved, requested, replacement, "missing-square-global-fallback");
  }
  resolved = resolveFromFontTree(index, index.settings?.defaultFontAssetId, replacement);
  if (resolved) return withResolution(resolved, requested, replacement, "missing-square-default-font");

  resolved = resolveFromFontTree(index, fontId, 0x20);
  if (resolved) return withResolution(resolved, requested, 0x20, "missing-space");
  resolved = resolveFromFontTree(index, fontId, 0x03);
  return withResolution(resolved, requested, 0x03, "missing-etx");
}

export function layoutOfficialTmpRun(
  index,
  fontId,
  text,
  fontSize,
  startX = 0,
  baselineY = 0,
  options = {},
) {
  const font = index.fonts.get(String(fontId));
  if (!font) throw new Error(`unknown official TMP FontAsset ${fontId}`);
  const scale = Number(fontSize) / Number(font.face.pointSize) * Number(font.face.scale || 1);
  const emScale = Number(fontSize) * 0.01;
  const widthScale = 1 - Number(options.charWidthAdjustment || 0);
  const characterSpacing = Number(options.characterSpacing || 0);
  const wordSpacing = Number(options.wordSpacing || 0);
  const entries = [...text].map((character) => {
    const resolved = resolveOfficialTmpTextElement(index, fontId, character.codePointAt(0));
    if (!resolved) throw new Error(`FontAsset ${fontId} lacks ${JSON.stringify(character)}`);
    return { character, ...resolved };
  });
  const output = [];
  let penX = Number(startX);
  let carried = ZERO_ADJUSTMENT;
  let carriedIgnoreSpacing = false;
  let lastSpacing = 0;
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const next = entries[i + 1];
    const pair = options.kerning === false || !next
      ? null
      : font.pairs.get(`${entry.glyph.index ?? entry.glyph.glyphIndex}:${next.glyph.index ?? next.glyph.glyphIndex}`);
    const current = addAdjustment(carried, pair?.first || ZERO_ADJUSTMENT);
    const ignoreSpacing = carriedIgnoreSpacing || Boolean(Number(pair?.lookupFlags || 0) & 0x100);
    const metrics = entry.glyph.metrics;
    const x = penX + (metrics.horizontalBearingX + current.xPlacement) * scale * widthScale;
    const y = baselineY - (metrics.horizontalBearingY + current.yPlacement) * scale;
    output.push({
      ...entry,
      x,
      y,
      width: metrics.width * scale * widthScale,
      height: metrics.height * scale,
      scale,
      widthScale,
      penX,
      adjustment: current,
    });
    const spacing = (Number(font.normalSpacingOffset || 0) + (ignoreSpacing ? 0 : characterSpacing)) * emScale;
    lastSpacing = spacing;
    penX += ((metrics.horizontalAdvance + current.xAdvance) * scale + spacing) * widthScale;
    if (/\s/u.test(entry.character) || entry.character.codePointAt(0) === 0x200b) {
      penX += wordSpacing * emScale;
    }
    carried = pair?.second || ZERO_ADJUSTMENT;
    carriedIgnoreSpacing = Boolean(Number(pair?.lookupFlags || 0) & 0x100);
  }
  const trailingSpacing = entries.length ? lastSpacing * widthScale : 0;
  const advance = penX - Number(startX) - trailingSpacing;
  return { glyphs: output, advance, endX: Number(startX) + advance, scale, widthScale };
}

export function measureOfficialTmpText(index, fontId, text, fontSize, options = {}) {
  return layoutOfficialTmpRun(index, fontId, text, fontSize, 0, 0, options).advance;
}

const NON_BREAKING = new Set([0x00A0, 0x2007, 0x2011, 0x202F, 0x2060]);
const HARD_BREAK = new Set([0x0A, 0x0B, 0x2028, 0x2029]);

function isEastAsianBreakCharacter(codePoint, modernHangul) {
  const legacyHangul = !modernHangul && (
    (codePoint > 0x1100 && codePoint < 0x11FF)
    || (codePoint > 0xA960 && codePoint < 0xA97F)
    || (codePoint > 0xAC00 && codePoint < 0xD7FF)
  );
  return legacyHangul
    || (codePoint > 0x2E80 && codePoint < 0x9FFF)
    || (codePoint > 0xF900 && codePoint < 0xFAFF)
    || (codePoint > 0xFE30 && codePoint < 0xFE4F)
    || (codePoint > 0xFF00 && codePoint < 0xFFEF);
}

function isBreakWhitespace(character) {
  const codePoint = character.codePointAt(0);
  return !NON_BREAKING.has(codePoint) && (/\s/u.test(character) || codePoint === 0x200B);
}

function trimBreakWhitespace(items) {
  let end = items.length;
  while (end > 0 && isBreakWhitespace(items[end - 1].character || "\uFFFC")) end -= 1;
  return items.slice(0, end);
}

function materializeLine(items, revealSoftHyphen = false) {
  const trimmed = trimBreakWhitespace(items);
  const output = [];
  for (let index = 0; index < trimmed.length; index++) {
    const item = trimmed[index];
    if ((item.character || "").codePointAt(0) !== 0xAD) output.push(item);
    else if (revealSoftHyphen && index === trimmed.length - 1) output.push({ ...item, character: "-", t: item.t == null ? item.t : "-" });
  }
  return output;
}

/**
 * Reproduce TMP 3.0.6's saved word-wrap breakpoint selection. Items retain
 * caller-owned style/image data; `measure` must return the current xAdvance.
 */
export function wrapOfficialTmpItems(index, items, {
  maxWidth,
  firstLineWidth = maxWidth,
  measure,
} = {}) {
  if (!(maxWidth > 0) || typeof measure !== "function") throw new Error("invalid TMP wrap options");
  const leading = index?.settings?.leadingCharacters || new Set();
  const following = index?.settings?.followingCharacters || new Set();
  const modernHangul = Boolean(index?.settings?.useModernHangulLineBreakingRules);
  const lines = [];
  let lineStart = 0;
  let savedWordBreak = 0;
  let savedSoftBreak = -1;
  let lastSoftBreak = 0;
  let lineIndex = 0;
  let firstWordOfLine = true;

  const appendLine = (end, hardBreak = false, breakKind = hardBreak ? "hard" : "word") => {
    const source = items.slice(lineStart, end);
    const revealSoftHyphen = !hardBreak && (source[source.length - 1]?.character || "").codePointAt(0) === 0xAD;
    lines.push({
      items: materializeLine(source, revealSoftHyphen),
      hardBreak,
      breakKind: revealSoftHyphen ? "soft-hyphen" : breakKind,
      sourceStart: lineStart,
      sourceEnd: end,
    });
    lineIndex += 1;
    lineStart = end;
    savedWordBreak = lineStart;
    firstWordOfLine = true;
  };

  for (let i = 0; i < items.length; i += 1) {
    if (i < lineStart) continue;
    const character = items[i].character || "\uFFFC";
    const codePoint = character.codePointAt(0);
    if (HARD_BREAK.has(codePoint)) {
      appendLine(i, true);
      lineStart = i + 1;
      savedWordBreak = lineStart;
      continue;
    }

    const width = measure(items.slice(lineStart, i + 1));
    const available = lineIndex === 0 ? firstLineWidth : maxWidth;
    if (width > available + 0.0001 && i > lineStart) {
      let breakAt = savedWordBreak > lineStart ? savedWordBreak : i;
      let breakKind = "word";
      if (firstWordOfLine && savedSoftBreak > lineStart && savedSoftBreak !== lastSoftBreak) {
        breakAt = savedSoftBreak;
        lastSoftBreak = savedSoftBreak;
        breakKind = "soft";
      }
      appendLine(breakAt, false, breakKind);
      i = lineStart - 1;
      continue;
    }

    const nextCharacter = items[i + 1]?.character || "";
    const breakCode = codePoint === 0x2D || codePoint === 0xAD;
    if (!items[i].noBreak && (isBreakWhitespace(character) || breakCode) && !NON_BREAKING.has(codePoint)) {
      savedWordBreak = i + 1;
      firstWordOfLine = false;
      savedSoftBreak = -1;
      continue;
    }
    if (!items[i].noBreak && isEastAsianBreakCharacter(codePoint, modernHangul)) {
      if (!leading.has(character) && !following.has(nextCharacter)) {
        savedWordBreak = i + 1;
        firstWordOfLine = false;
      }
      if (!leading.has(character) && firstWordOfLine) {
        if (isBreakWhitespace(character)) savedSoftBreak = i + 1;
        savedWordBreak = i + 1;
      } else if (leading.has(character) && firstWordOfLine && i === lineStart) {
        if (isBreakWhitespace(character)) savedSoftBreak = i + 1;
        savedWordBreak = i + 1;
      }
    } else if (firstWordOfLine) {
      if (isBreakWhitespace(character) || codePoint === 0xAD) savedSoftBreak = i + 1;
      savedWordBreak = i + 1;
    }
  }
  if (lineStart <= items.length) {
    lines.push({
      items: materializeLine(items.slice(lineStart)),
      hardBreak: false,
      breakKind: "end",
      sourceStart: lineStart,
      sourceEnd: items.length,
    });
  }
  return lines;
}

function isJustificationSeparator(item) {
  if (item.img || item.sprite || item.symbol) return false;
  const character = item.character || "";
  return character === "\t" || (character !== "\u00A0" && /\p{Z}/u.test(character));
}

export function computeOfficialTmpJustificationOffsets(items, lineWidth, availableWidth, ratio = 0.4) {
  const offsets = new Array(items.length).fill(0);
  const gap = Math.max(0, Number(availableWidth) - Number(lineWidth));
  let separators = items.filter(isJustificationSeparator).length;
  let visible = items.filter((item) => item.img || item.sprite || item.symbol || !isBreakWhitespace(item.character || "\uFFFC")).length - 1;
  if (items.length && isJustificationSeparator(items[0])) {
    separators -= 1;
    visible += 1;
  }
  const effectiveRatio = separators > 0 ? Number(ratio) : 1;
  const separatorDivisor = Math.max(1, separators);
  const visibleDivisor = Math.max(1, visible);
  let offset = 0;
  for (let index = 1; index < items.length; index++) {
    const item = items[index];
    if (isJustificationSeparator(item)) {
      offset += gap * (1 - effectiveRatio) / separatorDivisor;
    } else {
      offset += gap * effectiveRatio / visibleDivisor;
    }
    offsets[index] = offset;
  }
  return offsets;
}

export async function loadOfficialTmpAtlasTexture(index, atlas) {
  if (!atlas?.alphaUrl) throw new Error("official TMP atlas has no Alpha8 URL");
  if (index.textures.has(atlas.alphaUrl)) return index.textures.get(atlas.alphaUrl);
  const pending = fetch(atlas.alphaUrl).then(async (response) => {
    if (!response.ok) throw new Error(`official TMP Alpha8 atlas: HTTP ${response.status}`);
    const alpha = new Uint8Array(await response.arrayBuffer());
    if (alpha.length !== atlas.width * atlas.height) throw new Error("official TMP Alpha8 atlas byte size mismatch");
    const rgba = new Uint8Array(alpha.length * 4);
    for (let i = 0; i < alpha.length; i++) {
      const offset = i * 4;
      rgba[offset] = 255;
      rgba[offset + 1] = 255;
      rgba[offset + 2] = 255;
      rgba[offset + 3] = alpha[i];
    }
    const texture = new THREE.DataTexture(rgba, atlas.width, atlas.height, THREE.RGBAFormat, THREE.UnsignedByteType);
    texture.name = `TMP Alpha8 ${atlas.alphaUrl}`;
    texture.colorSpace = THREE.NoColorSpace;
    texture.flipY = false;
    texture.premultiplyAlpha = false;
    texture.unpackAlignment = 1;
    texture.magFilter = atlas.sampler?.m_FilterMode === 0 ? THREE.NearestFilter : THREE.LinearFilter;
    texture.minFilter = texture.magFilter;
    texture.wrapS = atlas.sampler?.m_WrapU === 1 ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
    texture.wrapT = atlas.sampler?.m_WrapV === 1 ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
    texture.generateMipmaps = false;
    texture.needsUpdate = true;
    return texture;
  });
  index.textures.set(atlas.alphaUrl, pending);
  return pending;
}
