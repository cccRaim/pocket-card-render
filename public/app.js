// card_render — layer-driven three.js renderer (v2).
//
// Consumes public/scene.<cardId>.json: an ordered list of draw LAYERS (each = shader + blend + floats +
// resolved textures + the FBX node whose geometry it uses), taken from the prior pipeline's
// runtime-resolved manifest. Geometry comes from the FBX. Blends per shader are the game's real
// values (card_shader_state.json). No per-layer guessing — each draw call's shader/blend/queue
// is data.
//
// Pipeline status: visible card-face layers are dispatched by shader strategy; render state, texture
// defaults, MRT usage, and high-impact UR constants are audited against official assets. Remaining
// Layer dispatch is implementation coverage; official-runtime and visual parity need separate evidence.

import "./render/page-errors.js";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { SHADER } from "./render/rarities.js";
import { getMaterial } from "./render/registry.js";
import { makeRenderContext, setBlend, applyRenderQueueState, applyDepthState, applyCullState, applyStencilState, applyOfficialPassState } from "./render/context.js";
import { threeWorldForwardToUnity, updateGlitterFlow } from "./render/glitter-flow.js";
import { updateKiraPuyo } from "./render/kira-puyo.js";
import { OfficialClock, syncOfficialClockVisibility } from "./render/official-clock.js";
import { bindCircularKiraMesh, finalizeCircularKiraBindings, updateCircularKira } from "./render/circular-kira.js";
import {
  beginOfficialTouchDrag,
  createOfficialTouchRotationState,
  dragOfficialTouchRotation,
  endOfficialTouchDrag,
  screenPointToNormalizedLocal,
  setAbsolutePointerTilt,
  setOfficialDebugTilt,
  unityQuaternionToThree,
  updateOfficialTouchRotation,
} from "./render/official-touch-rotation.js";
import {
  createOfficialMrtTarget,
  resizeOfficialMrtTarget,
} from "./render/pipeline/official-mrt.js";
import {
  createOfficialBloomPipeline,
  loadOfficialBloomPrograms,
  loadOfficialFinalBlitProgram,
} from "./render/pipeline/official-bloom.js";
import { sceneUsesBloomProducer } from "./render/pipeline/bloom-activation.js";
import {
  createHomographyDisplayMaterial,
  loadHomographyDisplayProgram,
  setHomographyDisplayPoints,
} from "./render/pipeline/homography-display.js";
import { applyOfficialSampler, loadOfficialTexture } from "./render/official-texture.js";
import { attachLocalDrawAudit } from "./render/local-draw-audit.js";
import { createOfficialHoloDynamicTexture } from "./render/dynamic-ui-texture.js";
import { selectCardQualityProfile, selectDynamicUIRenderScale } from "./render/quality-profile.js";
import {
  applyUiAffineToCanvas,
  IDENTITY_UI_AFFINE,
} from "./render/ui-affine-transform.js";
import { resolveOfficialUIImageDrawState } from "./render/official-ugui-image.js";
import { computeOfficialTmpJustificationOffsets, loadOfficialTmpFonts, layoutOfficialTmpRun, measureOfficialTmpText, wrapOfficialTmpItems } from "./render/tmp-font-data.js";
import { loadOfficialTmpSdfProgram, renderOfficialTmpDynamicTexture } from "./render/tmp-sdf-renderer.js";
import { loadOfficialUIRTPrograms } from "./render/official-ui-rt.js";
import { loadOfficialTmpSpriteProgram } from "./render/tmp-sprite-program.js";
import { parseOfficialTmpRuns } from "./render/tmp-rich-text.js";
import { layoutOfficialTmpSprite } from "./render/tmp-sprite-data.js";
import { resolveOfficialTmpAutoSize } from "./render/tmp-autosize.js";
import { officialTmpGlyphInkRight, resolveOfficialTmpItalic } from "./render/tmp-glyph-mesh.js";
import {
  computeOfficialNameExParentDelta,
  shiftOfficialNameExBox,
} from "./render/official-name-ex-layout.js";
import {
  OFFICIAL_DISTANCE_METRIC,
  OFFICIAL_PASS_CRITERIA,
  OFFICIAL_RENDERER_TYPE,
  officialDistanceKey,
} from "./render/official-draw-order.js";
import { createOfficialCapturedSortResolver } from "./render/official-sort-capture.js";
import { orderOfficialPasses } from "./render/official-port-identity.js";
import { loadExactShaderPortsFromContract } from "./render/exact-port-loader.js";
import {
  answerLayerBisect,
  createLayerBisectState,
  layerBisectProbe,
  parseHiddenLayerNumbers,
} from "./render/layer-bisect.js";
import {
  LOGIC_BISECT_CASES,
  logicBisectCaseUrl,
  resolveLogicBisectCase,
} from "./render/logic-bisect.js";
import "./render/materials/index.js";   // registers every material strategy (side effect)

const errEl = document.getElementById("err");
const log = (m) => { errEl.textContent = m; console.log(m); };
// loading UX: full-screen overlay for the heavy initial load (model+textures+fonts), small spinner for switches
const loadingEl = document.getElementById("loading");
const loadingTxt = document.getElementById("loading-txt");
const busyEl = document.getElementById("busy"), busyTxt = document.getElementById("busy-txt");
const controlsEl = document.getElementById("controls");
const setLoading = (t) => { if (loadingTxt && t) loadingTxt.textContent = t; };
const hideLoading = () => loadingEl && loadingEl.classList.add("hidden");
const busy = (on, t) => { if (!busyEl) return; if (t && busyTxt) busyTxt.textContent = t; busyEl.classList.toggle("on", on); };
function publishTmpSdfStatus(value) {
  const status = value || { mode: "canvas-fallback" };
  window.__tmpSdfStatus = status;
  document.documentElement.dataset.tmpSdfStatus = JSON.stringify(status);
  console.log("official TMP runtime:", status);
  if (status.readback) {
    const query = new URLSearchParams(location.search);
    window.fetch("/audit/tmp-runtime", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        scene: query.get("scene"),
        locale: query.get("lc") || "zh_TW",
        url: location.href,
        evidence: status,
      }),
    }).catch((error) => console.warn("TMP runtime evidence write failed", error));
  }
}
const DEFAULT_SCENE = "scene.cPK_10_000040_00_FUSHIGIBANAex_RR.json";
const fail = (m) => {   // surface load errors in the overlay instead of an endless spinner
  errEl.textContent = "ERR: " + m; console.error(m);
  if (loadingEl) { setLoading("⚠ " + m); const s = loadingEl.querySelector(".spinner"); if (s) s.style.display = "none"; }
};

// Unity Blend enum -> three factor.

// the name-adjacent "ex" glyph sprites (placed dynamically after the measured card name)
const EX_GLYPH = "/game/Assets/Lettuce/_Data/Common/CardNew/Common/UI/Textures/CardUIPokemonFormat5x5/card_icn_ex.png";

// TMP font role -> CSS family, resolved PER POSITION from the game's FontGroup presets (zh_TW = _language 7),
// using the REAL fonts from the decrypted Common/Font bundle. The WEIGHT differs by role:
//   name / skill  = ShoukakuHei TC Black (CardName/AttackName preset, heavy CJK)
//   HP / damage / illustrator = FuturaLTPro-Heavy (Number/CollectionData preset, latin heavy)
//   body (desc / rule / weak-retreat labels) = ShoukakuHei TC Book (CardDescription/Rule/CardDetail preset, regular)
// (RodinPro-EB is the JP-language font — NOT used for zh_TW, so not loaded.)
// the CURRENT locale's font families (set per locale from locales/manifest.json). faceFont() reads these so a
// language switch just changes the families. Roles: name/skill, body (desc/labels), num (HP/damage/illustrator).
let curFonts = { name: "Noto Sans TC", body: "Noto Sans TC", num: "Jost" };
let curWeights = { name: 900, body: 400, num: 700 };   // per-role weight (free fonts express weight via font-weight, not a heavy family)
function roleWeight(font) { return font === "num" ? curWeights.num : font === "name" ? curWeights.name : curWeights.body; }
function faceFont(font, fs) {
  const fam = font === "num" ? curFonts.num : font === "name" ? curFonts.name : curFonts.body;
  return `${roleWeight(font)} ${fs}px "${fam}", "${curFonts.body}", sans-serif`;   // body family as CJK fallback
}

// load the given font families (by url from the manifest) once; cached across locale switches
const _fontLoaded = new Set();
function loadFonts(fontFiles, families) {
  const requested = [...new Set(families)];
  return Promise.all(requested.filter((f) => fontFiles[f] && !_fontLoaded.has(f)).map((f) => {
    const ff = new FontFace(f, `url(${fontFiles[f]})`);
    return ff.load().then((x) => { document.fonts.add(x); _fontLoaded.add(f); }).catch((e) => console.warn("font fail", f, e));
  })).then(() => requested.every((family) => _fontLoaded.has(family)));
}

// ── DynamicUI: composite the per-card UI elements into one canvas, exactly as the game renders the
// PokemonCardUI UGUI canvas to a RenderTexture (_DynamicUITex) mapped onto Card_Base_UI. card_ui.json =
// sprite layers (banner/badge bg), card_face.json = text + energy icons. Every box is a real prefab
// RectTransform (card top-left fractions); every string/icon is real masterdata. Transparent bg.
// the EX rainbow foil (L_FullFace_Holo_P, _UseDynamicUI=1) must shimmer on ONLY the gold ex elements —
// the "ex" glyph + the ex-rule banner — NOT the whole UI. So we build a SECOND canvas (foil mask) holding
// just those, and feed its alpha to the foil shader. (Masking by the full UI alpha made the rainbow bleed
// over every text/icon.) A card_ui element is a foil element if its sprite is the ex-rule banner.
const isFoilSprite = (e) => typeof e.sprite === "string" && e.sprite.startsWith("card_pla_rule");

// The holo/foil shaders sample _CubeMap (L_001_ENV) as a REAL samplerCube (SPIR-V dim=Cube), with the
// reflection vector — NOT a flat 2D matcap (which plastered the env photo on = the "mirror" artifact).
// L_001_ENV ships as a 128×768 VERTICAL STRIP = 6 stacked 128×128 cube faces (+X,-X,+Y,-Y,+Z,-Z, the
// three.js CubeTexture order). Slice it into a CubeTexture so the reflection moves with the surface.
function loadEnvCube(url, samplerState) {
  return new Promise((res) => {
    const img = new Image(); img.crossOrigin = "anonymous";
    img.onload = () => {
      const fw = img.width, fh = img.width;            // square faces (128) from the 128×768 strip
      const faces = [];
      for (let i = 0; i < 6; i++) {
        const c = document.createElement("canvas"); c.width = fw; c.height = fh;
        c.getContext("2d").drawImage(img, 0, i * fh, fw, fh, 0, 0, fw, fh);
        faces.push(c);
      }
      const cube = new THREE.CubeTexture(faces);
      cube.colorSpace = THREE.NoColorSpace;
      applyOfficialSampler(cube, samplerState);
      cube.needsUpdate = true;
      res(cube);
    };
    img.onerror = () => { console.warn("env cube fail", url); res(null); };
    img.src = url;
  });
}

function buildDynamicUITexture(
  cardUI,
  face,
  samplerState,
  renderScale = 1,
  tmpFonts = null,
  renderer = null,
  tmpProgram = null,
  uiRTPrograms = null,
  tmpSpriteProgram = null,
  collectTmpReadback = false,
  tmpSpriteContract = null,
) {
  const [W, H] = cardUI.canvasWH;
  const textureW = Math.max(1, Math.round(W * renderScale));
  const textureH = Math.max(1, Math.round(H * renderScale));
  const cv = document.createElement("canvas"); cv.width = textureW; cv.height = textureH;
  const ctx = cv.getContext("2d");
  ctx.scale(textureW / W, textureH / H);
  const foilCv = document.createElement("canvas"); foilCv.width = textureW; foilCv.height = textureH;   // ex-foil mask
  const foilCtx = foilCv.getContext("2d");
  foilCtx.scale(textureW / W, textureH / H);
  const tmpDraws = [];
  const imageDraws = [];
  const tmpSpriteDraws = [];
  const tmpSpriteBindings = [];
  const nameExParentDeltas = new Map();
  let tmpFallbackCount = 0;
  let drawSequence = 0;
  const exactTmp = !!(tmpFonts && renderer && tmpProgram && uiRTPrograms);
  const faceEls = (face && face.elements) || [];
  const loadImg = (url) => new Promise((res) => {
    const i = new Image(); i.crossOrigin = "anonymous"; i.onload = () => res(i); i.onerror = () => { console.warn("ui tex fail", url); res(null); }; i.src = url;
  });
  const urls = new Set([EX_GLYPH]);
  cardUI.elements.forEach((e) => urls.add(e.url));
  faceEls.forEach((e) => {
    if (e.kind === "icon") urls.add(e.url);
    for (const sprite of Object.values(e.inlineSprites || {})) if (sprite.url) urls.add(sprite.url);
    if (e.inlineEx?.textureUrl) urls.add(e.inlineEx.textureUrl);
  });

  const hierarchyOrderOf = (element) => Number(
    element?.hierarchyOrder
      ?? element?.uiImage?.hierarchyOrder
      ?? element?.order
      ?? 0,
  );
  function registerImageDraw(source, rect, element, {
    color = [1, 1, 1, 1],
    sourceRect = null,
    role = "image",
  } = {}) {
    if (!source) return;
    imageDraws.push({
      source,
      sourceRect,
      rect,
      color,
      role,
      unityLayer: Number(element?.unityLayer),
      hierarchyOrder: hierarchyOrderOf(element),
      sequence: drawSequence++,
      uiTransform: element?.uiTransform || IDENTITY_UI_AFFINE,
      layoutPath: element?.layoutPath || null,
    });
  }
  function registerTmpSpriteDraw(source, rect, element, {
    sourceRect,
    role = "inline-sprite",
    textureSampleAdd = [0, 0, 0, 0],
  } = {}) {
    if (!source) return;
    tmpSpriteDraws.push({
      source,
      sourceRect,
      rect,
      color: [1, 1, 1, 1],
      materialColor: [1, 1, 1, 1],
      textureSampleAdd,
      role,
      unityLayer: Number(element?.unityLayer),
      hierarchyOrder: hierarchyOrderOf(element),
      sequence: drawSequence++,
      uiTransform: element?.uiTransform || IDENTITY_UI_AFFINE,
      layoutPath: element?.layoutPath || null,
    });
  }

  function drawSprite(e, img, target) {                // card_ui.json image element (tint / contain / stretch)
    const primaryTarget = !target || target === ctx;
    target = target || ctx;
    if (!img) return;
    const imageState = resolveOfficialUIImageDrawState(e);
    if (!imageState.visible) return;
    const b = e.box, bx = b.l * W, by = b.t * H, bw = (b.r - b.l) * W, bh = (b.b - b.t) * H;
    let rect;
    if (imageState.fit === "contain") {
      const scale = Math.min(bw / img.width, bh / img.height);
      const width = img.width * scale;
      const height = img.height * scale;
      rect = {
        left: bx + (bw - width) / 2,
        top: by + (bh - height) / 2,
        width,
        height,
      };
    } else {
      rect = { left: bx, top: by, width: bw, height: bh };
    }
    if (exactTmp && primaryTarget) {
      registerImageDraw(img, rect, e, {
        color: imageState.color,
        role: e.sprite ? `image:${e.sprite}` : "image",
      });
      return;
    }
    let src = img;
    const tintColor = imageState.color;
    if (tintColor && tintColor.some((value) => Math.abs(value - 1) > 1e-6)) {
      const t = document.createElement("canvas"); t.width = img.width; t.height = img.height;
      const tc = t.getContext("2d"); tc.drawImage(img, 0, 0);
      tc.globalCompositeOperation = "source-in";
      tc.fillStyle = `rgba(${(tintColor[0]*255)|0},${(tintColor[1]*255)|0},${(tintColor[2]*255)|0},${tintColor[3]})`;
      tc.fillRect(0, 0, img.width, img.height); src = t;
    }
    target.drawImage(src, rect.left, rect.top, rect.width, rect.height);
  }

  function withUiTransform(targets, element, draw) {
    const contexts = targets.filter(Boolean);
    for (const target of contexts) {
      target.save();
      applyUiAffineToCanvas(target, element.uiTransform || IDENTITY_UI_AFFINE);
    }
    try {
      return draw();
    } finally {
      for (const target of contexts.reverse()) target.restore();
    }
  }

  // tint an image to a solid rgb via its alpha (cached). The rule-body ex glyph is the gold ex SPRITE shape,
  // but in the body it's drawn in the BLACK body-text colour (#231813) — not gold — so fill its silhouette.
  const _tintCache = new Map();
  function tint(img, c) {
    if (!img) return null;
    const key = img.src + "|" + c.join(",");
    if (_tintCache.has(key)) return _tintCache.get(key);
    const cv = document.createElement("canvas"); cv.width = img.width; cv.height = img.height;
    const tc = cv.getContext("2d");
    tc.drawImage(img, 0, 0);
    tc.globalCompositeOperation = "source-in";
    tc.fillStyle = `rgba(${(c[0]*255)|0},${(c[1]*255)|0},${(c[2]*255)|0},${c[3] ?? 1})`;
    tc.fillRect(0, 0, cv.width, cv.height);
    _tintCache.set(key, cv); return cv;
  }
  // rich text: \x01/\x02 sentinels (from [Ctrl:Bold]…[/Ctrl:Bold]) → bold runs (bold body = the heavier "name"
  // font); \x03 (from [Img:ex ]) → an inline ex-glyph image run, drawn as the ex sprite within the flowing text.
  const runFont = (e, bold, fs, italic = false) => {
    const face = bold
      ? `${curWeights.name} ${fs}px "${curFonts.name}", "${curFonts.body}", sans-serif`
      : faceFont(e.font, fs);
    return italic ? `italic ${face}` : face;
  };
  const runSdf = (e, bold) => bold && e.boldStyle
    ? { ...(e.boldStyle.sdf || {}), fontId: e.boldStyle.fontId, materialId: e.boldStyle.materialId }
    : e.sdf;
  const tmpLayoutOptions = (e) => ({
    characterSpacing: Number(e.characterSpacing || 0),
    wordSpacing: Number(e.wordSpacing || 0),
    charWidthAdjustment: Number(e.charWidthAdjustment || 0),
    kerning: e.kerning !== false,
  });
  function measureRun(e, text, fs, bold = false, italic = false) {
    const sdf = runSdf(e, bold);
    if (tmpFonts && sdf?.fontId) {
      try { return measureOfficialTmpText(tmpFonts, sdf.fontId, text, fs, tmpLayoutOptions(e)); }
      catch (error) { tmpFallbackCount += 1; console.warn("TMP metric fallback", error); }
    }
    ctx.font = runFont(e, bold, fs, italic);
    return ctx.measureText(text).width;
  }
  function inkBounds(e, text, fs, bold = false, italic = false) {
    const sdf = runSdf(e, bold);
    if (tmpFonts && sdf?.fontId) {
      try {
        const layout = layoutOfficialTmpRun(tmpFonts, sdf.fontId, text, fs, 0, 0, tmpLayoutOptions(e));
        const right = layout.glyphs.reduce((value, glyph) => Math.max(
          value,
          officialTmpGlyphInkRight(italic ? { ...glyph, italic: true } : glyph),
        ), 0);
        const font = tmpFonts.fonts.get(String(sdf.fontId));
        const ascent = Number(font.face.ascentLine) * layout.scale;
        const descent = -Number(font.face.descentLine) * layout.scale;
        return { advance: layout.advance, right, ascent, descent };
      } catch (error) { tmpFallbackCount += 1; console.warn("TMP ink fallback", error); }
    }
    ctx.font = runFont(e, bold, fs, italic);
    const metrics = ctx.measureText(text);
    return {
      advance: metrics.width,
      right: metrics.actualBoundingBoxRight || metrics.width,
      ascent: metrics.actualBoundingBoxAscent || fs * 0.7,
      descent: metrics.actualBoundingBoxDescent || 0,
    };
  }
  function officialFontVerticalBounds(e, fs, bold = false) {
    const sdf = runSdf(e, bold);
    const font = sdf?.fontId && tmpFonts?.fonts.get(String(sdf.fontId));
    if (!font) return { ascent: fs * 0.7, descent: 0 };
    const scale = fs / Number(font.face.pointSize) * Number(font.face.scale || 1);
    return {
      ascent: Number(font.face.ascentLine) * scale,
      descent: -Number(font.face.descentLine) * scale,
    };
  }
  function officialLineHeight(e, fs, bold = false, lineSpacingDelta = 0) {
    const sdf = runSdf(e, bold);
    const font = sdf?.fontId && tmpFonts?.fonts.get(String(sdf.fontId));
    if (!font) return fs * 1.18;
    const baseScale = fs / Number(font.face.pointSize) * Number(font.face.scale || 1);
    const emScale = fs * 0.01;
    return (Number(font.face.lineHeight) + Number(lineSpacingDelta || 0)) * baseScale
      + Number(e.lineSpacing || 0) * emScale;
  }
  function exSpriteLayout(e, item, currentSize, x = 0, baseline = 0) {
    const fontId = runSdf(e, false)?.fontId;
    const font = fontId && tmpFonts?.fonts.get(String(fontId));
    if (!tmpSpriteContract || !font) return null;
    return layoutOfficialTmpSprite(
      tmpSpriteContract,
      font.face,
      item.spriteIndex,
      currentSize,
      Number(item.fontSize || currentSize),
      x,
      baseline,
    );
  }
  function drawExSprite(target, source, e, item, currentSize, x, baseline) {
    const layout = exSpriteLayout(e, item, currentSize, x, baseline);
    if (!source || !layout) return layout;
    const crop = layout.source;
    if (exactTmp && tmpSpriteProgram && target === ctx) {
      registerTmpSpriteDraw(
        source,
        {
          left: layout.left,
          top: layout.top,
          width: layout.width,
          height: layout.height,
        },
        e,
        {
          sourceRect: crop,
          role: "inline-ex-sprite",
        },
      );
    } else {
      if (exactTmp && target === ctx) tmpFallbackCount += 1;
      target.drawImage(
        source,
        crop.x, crop.y, crop.width, crop.height,
        layout.left, layout.top, layout.width, layout.height,
      );
    }
    tmpSpriteBindings.push({
      role: "inline-ex-sprite",
      spriteAssetId: item.spriteAssetId,
      materialId: item.materialId,
      textureId: item.textureId,
      spriteIndex: item.spriteIndex,
      characterName: item.characterName,
      fontId: String(runSdf(e, false)?.fontId || ""),
      currentFontSize: Number(currentSize),
      tagFontSize: Number(item.fontSize || currentSize),
      elementScale: layout.elementScale,
      advance: layout.advance,
    });
    return layout;
  }
  function fitOfficialTmpAutoSize(e, text, requestedSize, maxWidth) {
    if (!e.autosize || !(maxWidth > 0) || !tmpFonts || !e.sdf?.fontId) {
      return { fontSize: requestedSize, charWidthAdjustment: 0, lineSpacingDelta: 0 };
    }
    return resolveOfficialTmpAutoSize({
      fontSizeBase: Number(e.fsbase ?? requestedSize),
      fontSizeMin: Number(e.fsmin ?? requestedSize * 0.1),
      fontSizeMax: Number(e.fsmax ?? requestedSize),
      charWidthMaxAdj: Number(e.charWidthMaxAdj || 0),
      lineSpacingMax: Number(e.lineSpacingMax || 0),
      overflowMode: Number(e.overflowMode || 0),
      maxWidth,
    }, ({ fontSize, charWidthAdjustment }) => ({
      width: measureRun({ ...e, charWidthAdjustment }, text, fontSize),
      height: 0,
      lineCount: 1,
      baseScale: 1,
    }));
  }
  // word-wrap over runs: latin words stay whole, CJK breaks per char; first line shortened by `indent`.
  // an image run (inline ex glyph) is one non-breaking token sized fs·exAR wide.
  function wrapRuns(runs, e, fs, maxW, indent, imap) {
    const items = [];
    for (const run of runs) {
      if (run.img || run.sprite) {
        items.push({ character: "\uFFFC", ...run });
        continue;
      }
      if (run.symbol) {
        items.push({ character: run.glyph, t: run.glyph, ...run });
        continue;
      }
      for (const character of run.t) {
        items.push({ character, t: character, bold: run.bold, italic: run.italic, noBreak: run.noBreak });
      }
    }
    const imageAspect = (item) => {
      const image = item.img === "ex" ? imap?.get(EX_GLYPH) : imap?.get(item.url);
      return image?.height ? image.width / image.height : 1;
    };
    const measure = (lineItems) => {
      let width = 0;
      let text = "";
      let bold = null;
      let italic = null;
      const flush = () => {
        if (text) width += measureRun(e, text, fs, bold, italic);
        text = "";
      };
      for (const item of lineItems) {
        if ((item.character || "").codePointAt(0) === 0xAD) continue;
        if (item.sprite) {
          flush();
          const layout = exSpriteLayout(e, item, fs);
          width += layout ? layout.advance : fs;
          bold = null;
          italic = null;
        } else if (item.img) {
          flush();
          width += fs * imageAspect(item);
          bold = null;
          italic = null;
        } else if (item.symbol) {
          flush();
          width += measureRun(
            { ...e, sdf: item.sdf, charWidthAdjustment: 0 },
            item.glyph,
            Number(item.fontSize || fs),
          );
          bold = null;
          italic = null;
        } else if (bold === null || (bold === item.bold && italic === item.italic)) {
          text += item.t;
          bold = item.bold;
          italic = item.italic;
        } else {
          flush();
          text = item.t;
          bold = item.bold;
          italic = item.italic;
        }
      }
      flush();
      return width;
    };
    return wrapOfficialTmpItems(tmpFonts, items, {
      maxWidth: maxW,
      firstLineWidth: maxW - indent,
      measure,
    }).map((line) => ({ ...line, width: measure(line.items) }));
  }

  function groupWrappedItems(items) {
    const segments = [];
    for (let index = 0; index < items.length; index++) {
      const item = items[index];
      const previous = segments[segments.length - 1];
      if (!item.img && !item.sprite && !item.symbol && previous
          && !previous.img && !previous.sprite && !previous.symbol
          && previous.bold === item.bold && previous.italic === item.italic) {
        previous.t += item.t;
        previous.end = index + 1;
      } else {
        segments.push(item.img || item.sprite || item.symbol
          ? { ...item, start: index, end: index + 1 }
          : { t: item.t, bold: item.bold, italic: item.italic, noBreak: item.noBreak, start: index, end: index + 1 });
      }
    }
    return segments;
  }

  function wrappedBlockMetrics(lines, e, fs, lineHeight) {
    const lineMetrics = lines.map((line) => {
      const bounds = groupWrappedItems(line.items)
        .filter((segment) => !segment.img)
        .map((segment) => segment.sprite
          ? (exSpriteLayout(e, segment, fs) || officialFontVerticalBounds(e, fs, false))
          : segment.symbol
          ? inkBounds(
            { ...e, sdf: segment.sdf, charWidthAdjustment: 0 },
            segment.glyph,
            Number(segment.fontSize || fs),
          )
          : inkBounds(e, segment.t || " ", fs, segment.bold, segment.italic));
      if (!bounds.length) bounds.push(officialFontVerticalBounds(e, fs, false));
      return {
        ascent: Math.max(...bounds.map((value) => value.ascent)),
        descent: Math.max(...bounds.map((value) => value.descent)),
      };
    });
    const paragraphExtra = lines.slice(0, -1).reduce(
      (sum, line) => sum + (line.hardBreak ? Number(e.paragraphSpacing || 0) * fs * 0.01 : 0),
      0,
    );
    const first = lineMetrics[0] || { ascent: 0, descent: 0 };
    const last = lineMetrics[lineMetrics.length - 1] || first;
    const blockHeight = lines.length
      ? first.ascent + last.descent + Math.max(0, lines.length - 1) * lineHeight + paragraphExtra
      : 0;
    return { lineMetrics, paragraphExtra, blockHeight };
  }

  function sdfStyleFor(e, fs, bold = false) {
    const outline = bold && e.boldStyle?.outline ? e.boldStyle.outline : e.outline;
    if (!outline || !outline.width) return null;
    const oc = outline.color || [1, 1, 1, 1];
    return {
      outerLineWidth: fs * outline.width * 0.5,
      outlineCss: `rgba(${(oc[0]*255)|0},${(oc[1]*255)|0},${(oc[2]*255)|0},${oc[3] ?? 1})`,
    };
  }
  function drawSdfText(target, e, text, x, y, fs, bold = false, italic = false, align = "left", glyphOffsets = null) {
    const sdf = runSdf(e, bold);
    if (exactTmp && sdf?.fontId && sdf?.materialId) {
      try {
        const options = tmpLayoutOptions(e);
        const probe = layoutOfficialTmpRun(tmpFonts, sdf.fontId, text, fs, 0, 0, options);
        const startX = align === "right" ? x - probe.advance : align === "center" ? x - probe.advance / 2 : x;
        let layout = layoutOfficialTmpRun(tmpFonts, sdf.fontId, text, fs, startX, y, options);
        if (italic) layout = { ...layout, glyphs: layout.glyphs.map((glyph) => ({ ...glyph, italic: true })) };
        if (glyphOffsets?.some((offset) => offset !== 0)) {
          layout = {
            ...layout,
            glyphs: layout.glyphs.map((glyph, index) => ({ ...glyph, x: glyph.x + Number(glyphOffsets[index] || 0) })),
            endX: layout.endX + Number(glyphOffsets[glyphOffsets.length - 1] || 0),
          };
        }
        const componentColor = e.vertexColor || [1, 1, 1, 1];
        const resolvedSdf = { ...sdf };
        if (!resolvedSdf.faceColor) {
          const c = e.color || [1, 1, 1, 1];
          resolvedSdf.faceColor = { r: c[0], g: c[1], b: c[2], a: c[3] ?? 1 };
        }
        if (!resolvedSdf.outlineColor) {
          const c = (bold && e.boldStyle?.outline?.color) || e.outline?.color || [0, 0, 0, 1];
          resolvedSdf.outlineColor = { r: c[0], g: c[1], b: c[2], a: c[3] ?? 1 };
        }
        tmpDraws.push({
          layout,
          sdf: resolvedSdf,
          sdfScale: layout.scale,
          vertexColor: componentColor,
          role: e.tmpRole || "text",
          unityLayer: Number(e.unityLayer),
          layoutPath: e.layoutPath || null,
          uiTransform: e.uiTransform || IDENTITY_UI_AFFINE,
          hierarchyOrder: hierarchyOrderOf(e),
          sequence: drawSequence++,
        });
        return;
      } catch (error) { tmpFallbackCount += 1; console.warn("TMP glyph fallback", error); }
    }
    const style = sdfStyleFor(e, fs, bold);
    target.textAlign = align;
    target.textBaseline = "alphabetic";
    if (style?.outerLineWidth > 0) {
      target.lineWidth = style.outerLineWidth;
      target.strokeStyle = style.outlineCss;
      target.lineJoin = "round";
      target.miterLimit = 2;
      target.strokeText(text, x, y);
    }
    target.fillText(text, x, y);
  }
  function drawText(e, imap) {
    let fs = e.fs; const b = e.box, va = e.valign || "middle";
    const runs = parseOfficialTmpRuns(e.text, e.inlineSprites, e.inlineEx).map((run) => (
      run.img || run.sprite || run.symbol
        ? run
        : { ...run, italic: resolveOfficialTmpItalic(e.fontStyle, run.italic) }
    ));
    const exImg = imap && imap.get(EX_GLYPH);                          // inline ex glyph (for [Img:ex] in body text)
    const exSpriteSheet = e.inlineEx?.textureUrl && imap?.get(e.inlineEx.textureUrl);
    if (e.wrap) {                                       // multi-line: wrap to box width, shrink to fit box height
      const margin = e.margin || [0, 0, 0, 0];
      const boxLeft = b.l * W + Number(margin[0] || 0);
      const boxRight = b.r * W - Number(margin[2] || 0);
      const boxTop = b.t * H + Number(margin[1] || 0);
      const boxBottom = b.b * H - Number(margin[3] || 0);
      const boxW = boxRight - boxLeft, boxH = boxBottom - boxTop, indentPx = (e.indent || 0) * W;
      const c = e.color; ctx.fillStyle = `rgba(${(c[0]*255)|0},${(c[1]*255)|0},${(c[2]*255)|0},${c[3] ?? 1})`;
      ctx.textAlign = "left"; ctx.textBaseline = "top";
      const layoutWrappedAt = ({ fontSize: size, charWidthAdjustment = 0, lineSpacingDelta = 0 }) => {
        const layoutElement = { ...e, charWidthAdjustment };
        const candidateLines = wrapRuns(runs, layoutElement, size, boxW, indentPx, imap);
        const lineHeight = officialLineHeight(layoutElement, size, false, lineSpacingDelta);
        const metrics = wrappedBlockMetrics(candidateLines, layoutElement, size, lineHeight);
        const sdf = runSdf(layoutElement, false);
        const font = sdf?.fontId && tmpFonts?.fonts.get(String(sdf.fontId));
        const baseScale = font ? size / Number(font.face.pointSize) * Number(font.face.scale || 1) : 1;
        return {
          lines: candidateLines,
          lineHeight,
          lineSpacingDelta,
          metrics,
          width: candidateLines.reduce((maximum, line) => Math.max(maximum, line.width), 0),
          height: metrics.blockHeight,
          lineCount: candidateLines.length,
          baseScale,
        };
      };
      let wrapped;
      if (e.autosize) {
        const fitted = resolveOfficialTmpAutoSize({
          fontSizeBase: Number(e.fsbase ?? fs),
          fontSizeMin: Number(e.fsmin ?? fs * 0.1),
          fontSizeMax: Number(e.fsmax ?? fs),
          charWidthMaxAdj: Number(e.charWidthMaxAdj || 0),
          lineSpacingMax: Number(e.lineSpacingMax || 0),
          overflowMode: Number(e.overflowMode || 0),
          maxWidth: boxW,
          maxHeight: boxH,
          justifiedOrFlush: e.horizontalAlignment === 8 || e.horizontalAlignment === 16,
        }, layoutWrappedAt);
        fs = fitted.fontSize;
        e = { ...e, charWidthAdjustment: fitted.charWidthAdjustment };
        wrapped = fitted.evaluation;
      } else {
        wrapped = layoutWrappedAt({ fontSize: fs });
      }
      const { lines, lineHeight: lh, metrics } = wrapped;
      // TMP Valign: Bottom anchors the block bottom at box.b; Middle centres the block in the box (the rule body
      // box is tall and the text is V=Middle → sits at the box centre, not the top); else Top.
      const firstAscent = metrics.lineMetrics[0]?.ascent || 0;
      let baseline = va === "bottom" ? boxBottom - metrics.blockHeight + firstAscent
                   : va === "middle" ? (boxTop + boxBottom - metrics.blockHeight) / 2 + firstAscent
                   : boxTop + firstAscent;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const available = boxW - (i === 0 ? indentPx : 0);
        let xx = boxLeft + (i === 0 ? indentPx : 0);
        if (e.align === "right") xx += available - line.width;
        else if (e.align === "center") xx += (available - line.width) / 2;
        const justify = (e.horizontalAlignment === 16 || (e.horizontalAlignment === 8 && i < lines.length - 1))
          && !line.hardBreak;
        const offsets = justify
          ? computeOfficialTmpJustificationOffsets(line.items, line.width, available, Number(e.wordWrappingRatios ?? 0.4))
          : new Array(line.items.length).fill(0);
        let advance = 0;
        for (const seg of groupWrappedItems(line.items)) {
          const drawX = xx + advance + offsets[seg.start];
          if (seg.sprite) {
            const layout = drawExSprite(ctx, exSpriteSheet, e, seg, fs, drawX, baseline);
            advance += layout ? layout.advance : fs;
          } else if (seg.symbol) {
            const symbolSize = Number(seg.fontSize || fs);
            const symbolElement = {
              ...e,
              sdf: seg.sdf,
              charWidthAdjustment: 0,
              outline: null,
              tmpRole: "inline-element",
            };
            drawSdfText(ctx, symbolElement, seg.glyph, drawX, baseline, symbolSize);
            advance += measureRun(symbolElement, seg.glyph, symbolSize);
          } else if (seg.img) {
            const source = seg.img === "ex" ? exImg : imap?.get(seg.url);
            const eh = fs, ew = eh * (source?.height ? source.width / source.height : 1);
            const lineTop = baseline - (metrics.lineMetrics[i]?.ascent || firstAscent);
            if (source) {
              const top = lineTop + lh - eh - fs * 0.12;
              if (exactTmp) {
                registerImageDraw(
                  source,
                  { left: drawX, top, width: ew, height: eh },
                  e,
                  {
                    color: seg.img === "ex" ? e.color : [1, 1, 1, 1],
                    role: "inline-image",
                  },
                );
              } else {
                const image = seg.img === "ex" ? tint(source, e.color) : source;
                ctx.drawImage(image, drawX, top, ew, eh);
              }
            }
            advance += ew;
          } else {
            ctx.font = runFont(e, seg.bold, fs, seg.italic);
            const baseOffset = offsets[seg.start];
            const glyphOffsets = offsets.slice(seg.start, seg.end).map((offset) => offset - baseOffset);
            drawSdfText(ctx, e, seg.t, drawX, baseline, fs, seg.bold, seg.italic, "left", glyphOffsets);
            advance += measureRun(e, seg.t, fs, seg.bold, seg.italic);
          }
        }
        baseline += lh + (line.hardBreak ? Number(e.paragraphSpacing || 0) * fs * 0.01 : 0);
      }
      return;
    }
    const hasMixedRuns = runs.some((run) => run.img || run.sprite || run.symbol || run.bold || run.italic || run.noBreak);
    if (hasMixedRuns) {
      const metricsAt = (size, charWidthAdjustment = 0) => {
        const layoutElement = { ...e, charWidthAdjustment };
        const widthScale = 1 - charWidthAdjustment;
        let width = 0;
        let ascent = 0;
        let descent = 0;
        const segments = [];
        for (const run of runs) {
          if (run.sprite) {
            const layout = exSpriteLayout(e, run, size);
            const advance = (layout?.advance ?? size) * widthScale;
            segments.push({ ...run, source: exSpriteSheet, size, advance, spriteLayout: layout });
            width += advance;
            ascent = Math.max(ascent, layout?.ascent ?? size * 0.88);
            descent = Math.max(descent, layout?.descent ?? size * 0.12);
          } else if (run.symbol) {
            const symbolSize = Number(run.fontSize || size);
            const symbolElement = {
              ...layoutElement,
              sdf: run.sdf,
              outline: null,
              tmpRole: "inline-element",
            };
            const bounds = inkBounds(symbolElement, run.glyph, symbolSize);
            const advance = measureRun(symbolElement, run.glyph, symbolSize);
            segments.push({ ...run, element: symbolElement, size: symbolSize, advance });
            width += advance;
            ascent = Math.max(ascent, bounds.ascent);
            descent = Math.max(descent, bounds.descent);
          } else if (run.img) {
            const source = run.img === "ex" ? exImg : imap?.get(run.url);
            const advance = size * (source?.height ? source.width / source.height : 1) * widthScale;
            segments.push({ ...run, source, size, advance });
            width += advance;
            ascent = Math.max(ascent, size * 0.88);
            descent = Math.max(descent, size * 0.12);
          } else if (run.t) {
            const bounds = inkBounds(layoutElement, run.t, size, run.bold, run.italic);
            const advance = measureRun(layoutElement, run.t, size, run.bold, run.italic);
            segments.push({ ...run, size, advance });
            width += advance;
            ascent = Math.max(ascent, bounds.ascent);
            descent = Math.max(descent, bounds.descent);
          }
        }
        return { width, ascent, descent, segments };
      };
      const boxW = (b.r - b.l) * W;
      let mixed = metricsAt(fs);
      if (e.autosize && boxW > 1) {
        const fitted = resolveOfficialTmpAutoSize({
          fontSizeBase: Number(e.fsbase ?? fs),
          fontSizeMin: Number(e.fsmin ?? fs * 0.1),
          fontSizeMax: Number(e.fsmax ?? fs),
          charWidthMaxAdj: Number(e.charWidthMaxAdj || 0),
          lineSpacingMax: Number(e.lineSpacingMax || 0),
          overflowMode: Number(e.overflowMode || 0),
          maxWidth: boxW,
        }, ({ fontSize, charWidthAdjustment }) => {
          const metrics = metricsAt(fontSize, charWidthAdjustment);
          return { ...metrics, height: metrics.ascent + metrics.descent, lineCount: 1, baseScale: 1 };
        });
        fs = fitted.fontSize;
        e = { ...e, charWidthAdjustment: fitted.charWidthAdjustment };
        mixed = fitted.evaluation;
      }
      let baseline;
      if (va === "bottom") baseline = b.b * H - mixed.descent;
      else if (va === "top") baseline = b.t * H + mixed.ascent;
      else baseline = (b.t + b.b) / 2 * H + (mixed.ascent - mixed.descent) / 2;
      let cursor = e.align === "right" ? b.r * W - mixed.width
        : e.align === "center" ? (b.l + b.r) / 2 * W - mixed.width / 2
        : b.l * W;
      const c = e.color;
      ctx.fillStyle = `rgba(${(c[0]*255)|0},${(c[1]*255)|0},${(c[2]*255)|0},${c[3] ?? 1})`;
      for (const segment of mixed.segments) {
        if (segment.sprite) {
          drawExSprite(ctx, segment.source, e, segment, fs, cursor, baseline);
        } else if (segment.symbol) {
          drawSdfText(ctx, segment.element, segment.glyph, cursor, baseline, segment.size);
        } else if (segment.img) {
          if (segment.source) {
            const rect = {
              left: cursor,
              top: baseline - segment.size * 0.88,
              width: segment.advance,
              height: segment.size,
            };
            if (exactTmp) {
              registerImageDraw(segment.source, rect, e, {
                color: segment.img === "ex" ? e.color : [1, 1, 1, 1],
                role: "inline-image",
              });
            } else {
              const image = segment.img === "ex" ? tint(segment.source, e.color) : segment.source;
              ctx.drawImage(image, rect.left, rect.top, rect.width, rect.height);
            }
          }
        } else {
          drawSdfText(ctx, e, segment.t, cursor, baseline, fs, segment.bold, segment.italic);
        }
        cursor += segment.advance;
      }
      return;
    }
    // TMP auto-sizing: shrink the font from fs down to fsmin so the text fits its box width (long translations)
    if (e.autosize) {
      const boxW = (b.r - b.l) * W;
      if (boxW > 1) {
        const fitted = fitOfficialTmpAutoSize(e, e.text, fs, boxW);
        fs = fitted.fontSize;
        e = { ...e, charWidthAdjustment: fitted.charWidthAdjustment };
      }
    }
    ctx.font = faceFont(e.font, fs);
    const x = e.align === "right" ? b.r * W : e.align === "center" ? (b.l + b.r) / 2 * W : b.l * W;
    // TMP vertical alignment: Middle centres the GLYPH INK bounds at the box centre (NOT the em box — canvas
    // "middle" uses the em box, which drops symbols like "+" below the digit line). Compute the baseline from
    // the actual ink metrics so "+" and "20" (and all numerals) sit consistently.
    let y;
    const mm = inkBounds(e, e.text, fs);
    if (va === "bottom") y = b.b * H - mm.descent;
    else if (va === "top") y = b.t * H + mm.ascent;
    else {
      const ia = mm.ascent, id = mm.descent;
      y = (b.t + b.b) / 2 * H + (ia - id) / 2;          // ink-centre at the box centre
    }
    const c = e.color;
    ctx.fillStyle = `rgba(${(c[0]*255)|0},${(c[1]*255)|0},${(c[2]*255)|0},${c[3] ?? 1})`;
    drawSdfText(ctx, e, e.text, x, y, fs, false, false, e.align);
    if (e.nameExLayout) {                               // PokemonCardNameView.UpdateExLayout (byte-traced):
      const mn = inkBounds(e, e.text, fs);              //   ex.anchoredPosition.x = min(nameWidth, _textMaxWidthForEx)
      const nameWidth = mn.right > 0 ? mn.right : mn.advance;
      nameExParentDeltas.set(
        e.layoutPath,
        computeOfficialNameExParentDelta(e.nameExLayout, nameWidth, W),
      );
    }
  }

  return Promise.all([...urls].map((u) => loadImg(u).then((img) => [u, img]))).then((pairs) => {
    const imap = new Map(pairs);
    return (document.fonts ? document.fonts.ready : Promise.resolve()).then(async () => {
      const orderedElements = [...cardUI.elements, ...faceEls]
        .map((element, stableOrder) => ({ element, stableOrder }))
        .sort((left, right) => (
          hierarchyOrderOf(left.element) - hierarchyOrderOf(right.element)
          || left.stableOrder - right.stableOrder
        ));
      for (const { element: e } of orderedElements) {
        if (e.kind === "icon" || e.url) {
          const deltaX = e.nameExOwnerPath
            ? nameExParentDeltas.get(e.nameExOwnerPath)
            : null;
          if (e.nameExOwnerPath && !Number.isFinite(deltaX)) {
            throw new Error(`official Pokemon EX parent layout was not resolved for ${e.nameExOwnerPath}`);
          }
          const drawElement = e.nameExOwnerPath
            ? { ...e, box: shiftOfficialNameExBox(e.box, deltaX, W) }
            : e;
          const img = imap.get(drawElement.url);
          withUiTransform([ctx], drawElement, () => (
            drawSprite({ ...drawElement, fit: drawElement.fit || "contain" }, img)
          ));
          if (drawElement.nameExLayer === "base" || isFoilSprite(drawElement)) {
            withUiTransform([foilCtx], drawElement, () => drawSprite(drawElement, img, foilCtx));
          }
        } else if (e.kind === "text") {
          withUiTransform([ctx, foilCtx], e, () => drawText(e, imap));
        }
      }
      const mk = (canvas) => {
        const t = new THREE.CanvasTexture(canvas);
        t.colorSpace = THREE.NoColorSpace;
        // The card mesh consumes DynamicUI with its serialized UVs. Producer-side
        // top-left mapping is owned by tmp-sdf-renderer; no consumer flip belongs here.
        t.flipY = false;
        applyOfficialSampler(t, samplerState);
        return t;
      };
      const foil = mk(foilCv);
      if (exactTmp && (tmpDraws.length || imageDraws.length || tmpSpriteDraws.length)) {
        const rendered = await renderOfficialTmpDynamicTexture({
          renderer,
          baseCanvas: cv,
          includeBaseCanvas: tmpFallbackCount > 0,
          imageDraws,
          tmpSpriteDraws,
          draws: tmpDraws,
          fonts: tmpFonts,
          program: tmpProgram,
          uiRTPrograms,
          tmpSpriteProgram,
          samplerState,
          logicalWidth: W,
          logicalHeight: H,
          textureWidth: textureW,
          textureHeight: textureH,
          collectReadback: collectTmpReadback,
        });
        return {
          ...rendered,
          evidence: {
            ...rendered.evidence,
            fallbackCount: tmpFallbackCount,
            spriteBindings: tmpSpriteBindings,
          },
          foil,
          dispose() {
            rendered.dispose();
            foil.dispose();
          },
        };
      }
      const holoImageData = ctx.getImageData(0, 0, cv.width, cv.height);
      return {
        ui: mk(cv),
        holo: createOfficialHoloDynamicTexture(holoImageData, samplerState),
        foil,
      };
    });
  });
}

function compactCardName(name) {
  return String(name || "").replace(/ex$/i, " ex").replace(/_/g, " ");
}

function exampleLabel(example, lc) {
  const bits = [
    example.names?.[lc] || example.names?.en_US || example.illustrationId,
    example.rarityDisplayGroupId || example.rarityDisplayId,
  ];
  return bits.filter(Boolean).join(" · ");
}

const EXAMPLE_GROUP_LABELS = Object.freeze({
  de_DE: ["Minimale Abdeckung · bereit", "Lokale Regression", "Minimale Abdeckung · Assets erforderlich"],
  en_US: ["Minimum coverage · ready", "Local regression", "Minimum coverage · assets required"],
  es_ES: ["Cobertura minima · lista", "Regresion local", "Cobertura minima · requiere recursos"],
  fr_FR: ["Couverture minimale · prete", "Regression locale", "Couverture minimale · ressources requises"],
  it_IT: ["Copertura minima · pronta", "Regressione locale", "Copertura minima · risorse richieste"],
  ja_JP: ["最小カバレッジ · 実行可能", "ローカル回帰", "最小カバレッジ · アセット未収集"],
  ko_KR: ["최소 커버리지 · 실행 가능", "로컬 회귀", "최소 커버리지 · 애셋 필요"],
  pt_BR: ["Cobertura minima · pronta", "Regressao local", "Cobertura minima · requer recursos"],
  zh_TW: ["最小覆蓋集 · 可執行", "本機回歸樣本", "最小覆蓋集 · 尚未收集資產"],
});

function sceneLabel(scene, repeatedIds, lc) {
  const localized = scene.names && scene.names[lc];
  const bits = [localized || compactCardName(scene.name)];
  if (scene.rarityToken) bits.push(scene.rarityToken);
  if (repeatedIds.has(scene.id || scene.name)) bits.push(scene.file.replace(/\.json$/i, ""));
  return bits.filter(Boolean).join(" · ") || scene.file;
}

async function main() {
  // ?scene=scene.<cardId>.json renders an alternate prebuilt card.
  // Debug URL params: ?only=<substr> solos layers, ?bisect=1 enables exclusion bisection,
  // and ?nohud hides the overlays.
  const qp = new URLSearchParams(location.search);
  const fullRuntimeAudit = qp.get("auditrt") === "1";
  const layerBisectRequested = qp.get("bisect") === "1";
  const logicBisectRequested = qp.get("logicbisect") === "1";
  const logicBisectCase = logicBisectRequested
    ? resolveLogicBisectCase(qp.get("logiccase"))
    : resolveLogicBisectCase("baseline");
  // ?card=<illustrationId> builds the scene DYNAMICALLY for any card (server /scene). ?scene=<file> still works
  // (a prebuilt scene). Missing scene files fall back to the first prebuilt scene returned by /scenes.
  const cardParam = qp.get("card");
  const [sceneList, exampleManifest] = await Promise.all([
    fetch("/scenes")
      .then((r) => r.ok ? r.json() : null)
      .then((j) => (j && Array.isArray(j.scenes)) ? j.scenes : [])
      .catch(() => []),
    fetch("/card-examples.json")
      .then((r) => r.ok ? r.json() : null)
      .catch(() => null),
  ]);
  const coverageExamples =
    exampleManifest?.schemaVersion === 1
    && Array.isArray(exampleManifest.coverageSet?.selectedWitnesses)
      ? exampleManifest.coverageSet.selectedWitnesses
      : [];
  const supplementalExamples =
    exampleManifest?.schemaVersion === 1
    && Array.isArray(exampleManifest.supplementalBundledExamples)
      ? exampleManifest.supplementalBundledExamples
      : [];
  const requestedScene = qp.get("scene");
  const firstSceneFile =
    sceneList.find((sceneInfo) => sceneInfo.availability?.selectable !== false)?.file
    || sceneList[0]?.file
    || DEFAULT_SCENE;
  const sceneFile = (!requestedScene || sceneList.some((s) => s.file === requestedScene)) ? (requestedScene || firstSceneFile) : firstSceneFile;
  const sceneSrc = cardParam ? `/scene?card=${encodeURIComponent(cardParam)}` : sceneFile;
  if (!cardParam && requestedScene && requestedScene !== sceneFile) {
    const next = new URL(location.href);
    next.searchParams.set("scene", sceneFile);
    history.replaceState(null, "", next);
  }
  if (qp.has("only")) window.__only = qp.get("only");
  if (qp.has("preview")) window.__preview = true;
  const noExactParam = qp.get("noexact") || "";
  const exactAllOff = qp.has("noexact") && !noExactParam;
  const exactDisabled = new Set(noExactParam.split(",").map((s) => s.trim()).filter(Boolean));
  const exactEnabled = (name) => !exactAllOff
    && !exactDisabled.has(name)
    && !logicBisectCase.disableExactShaders.includes(name);
  const shotMode = qp.has("shot");
  const frameCap = Number(qp.get("fps") || 0);
  window.__frameInterval = Number.isFinite(frameCap) && frameCap > 0 ? 1000 / frameCap : 0;
  if (qp.has("nohud")) { window.__nohud = true; if (errEl) errEl.style.display = "none"; }
  const sceneResponse = await fetch(sceneSrc);
  if (!sceneResponse.ok) throw new Error(`scene: HTTP ${sceneResponse.status}`);
  const sceneBytes = await sceneResponse.arrayBuffer();
  const sceneSha256 = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", sceneBytes)))
    .map((value) => value.toString(16).padStart(2, "0")).join("");
  const scene_data = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(sceneBytes));
  const sortCaptureSrc = qp.get("sortCapture");
  let capturedSortResolver = null;
  if (sortCaptureSrc) {
    const [artifactResponse, collisionResponse] = await Promise.all([
      fetch(sortCaptureSrc),
      fetch("render/official-sort-collision-groups.json"),
    ]);
    if (!artifactResponse.ok) throw new Error(`sortCapture: HTTP ${artifactResponse.status}`);
    if (!collisionResponse.ok) throw new Error(`sort collision manifest: HTTP ${collisionResponse.status}`);
    capturedSortResolver = createOfficialCapturedSortResolver({
      artifact: await artifactResponse.json(),
      collisionManifest: await collisionResponse.json(),
      cardId: scene_data.card.id,
      sceneSha256,
    });
    console.log(`official captured sort: ${capturedSortResolver.completeGroupCount} complete groups`);
  }
  const officialSamplerManifest = await fetch("texture-samplers.json")
    .then((r) => r.ok ? r.json() : null)
    .catch(() => null);
  const officialSamplerMap = officialSamplerManifest?.textures || {};
  const dynamicUISamplerState = officialSamplerManifest?.runtimeTextures?._DynamicUITex?.sampler;
  if (!dynamicUISamplerState) throw new Error("official _DynamicUITex sampler contract is missing");
  const officialTmpFonts = await loadOfficialTmpFonts().catch((error) => {
    console.warn("official TMP font data unavailable; retaining Canvas metric fallback", error);
    return null;
  });
  const officialTmpSpriteContract = await fetch("/render/tmp-sprite-contract.json")
    .then((response) => {
      if (!response.ok) throw new Error(`official TMP sprite contract: HTTP ${response.status}`);
      return response.json();
    })
    .catch((error) => {
      console.warn("official TMP sprite contract unavailable; retaining legacy inline image fallback", error);
      return null;
    });
  const officialTmpSdfProgram = exactEnabled("TMP_SDF")
    ? await loadOfficialTmpSdfProgram().catch((error) => {
      console.warn("official TMP SDF program unavailable; retaining Canvas glyph fallback", error);
      return null;
    })
    : null;
  const officialUIRTPrograms = exactEnabled("UI_RT")
    ? await loadOfficialUIRTPrograms().catch((error) => {
      console.warn("official UI ToRT/FromRT programs unavailable; retaining Canvas texture fallback", error);
      return null;
    })
    : null;
  const officialTmpSpriteProgram = exactEnabled("TMP_SPRITE")
    ? await loadOfficialTmpSpriteProgram().catch((error) => {
      console.warn("official TMP Sprite program unavailable; retaining Canvas sprite fallback", error);
      return null;
    })
    : null;
  let hasBloomProducer = false;
  const currentSceneFile = cardParam ? "" : sceneSrc.replace(/^\.?\//, "");
  // ── locale: load per-language content + fonts from locales/manifest.json (falls back to the legacy single files) ──
  const manifest = await fetch("locales/manifest.json").then((r) => r.json()).catch(() => null);
  let curLoc = qp.get("lc") || (manifest && manifest.default) || "zh_TW";
  if (manifest && manifest.locales && !manifest.locales.some((l) => l.lc === curLoc)) curLoc = manifest.default || "zh_TW";
  const fullRuntimeSessionPromise = fullRuntimeAudit ? (async () => {
    const storageKey = "pocket-card-render.full-runtime-session.v1";
    const auditUrl = new URL(location.href);
    auditUrl.searchParams.set("scene", sceneFile);
    auditUrl.searchParams.set("lc", curLoc);
    auditUrl.searchParams.set("auditrt", "1");
    if (auditUrl.href !== location.href) history.replaceState(null, "", auditUrl);
    const stored = JSON.parse(sessionStorage.getItem(storageKey) || "null");
    const request = async (credentials = null) => fetch("/audit/full-runtime/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        url: auditUrl.href,
        ...(credentials ? {
          batchId: credentials.batchId,
          sessionNonce: credentials.sessionNonce,
        } : {}),
      }),
    });
    let response = await request(stored);
    if ((response.status === 401 || response.status === 409) && stored) {
      sessionStorage.removeItem(storageKey);
      response = await request();
    }
    if (!response.ok) throw new Error(`runtime session HTTP ${response.status}: ${await response.text()}`);
    const session = await response.json();
    sessionStorage.setItem(storageKey, JSON.stringify({
      batchId: session.batchId,
      sessionNonce: session.sessionNonce,
    }));
    if (session.expectedUrl !== location.href) throw new Error("runtime session URL does not match the active page");
    return session;
  })() : null;
  async function loadLocaleData(lc) {
    const ui = await fetch(`locales/card_ui.${lc}.json`).then((r) => r.json()).catch(() => null);
    const face = await fetch(`locales/card_face.${lc}.json`).then((r) => r.json()).catch(() => null);
    const lm = manifest && manifest.locales.find((l) => l.lc === lc);
    if (lm) {
      const officialFontsLoaded = await loadFonts(manifest.fontFiles, Object.values(lm.fonts));
      curFonts = officialFontsLoaded ? lm.fonts : (lm.fallbackFonts || lm.fonts);
      if (officialFontsLoaded && lm.weights) curWeights = lm.weights;
      else if (!officialFontsLoaded && lm.fallbackWeights) curWeights = lm.fallbackWeights;
    }
    return { ui, face };
  }
  setLoading("Loading fonts…");
  let { ui: cardUI, face: cardFace } = await loadLocaleData(curLoc);
  if (!cardUI) cardUI = await fetch("card_ui.json").then((r) => r.json()).catch(() => null);   // legacy fallback
  if (!cardFace) cardFace = await fetch("card_face.json").then((r) => r.json()).catch(() => null);
  // the DynamicUI canvas (card_face/card_ui + locales) is built for the DEFAULT card only. An alternate card
  // (?scene=) has its own face — trainers bake text into per-locale _UT textures — so don't paint the default
  // card's name/attacks onto it. (This was the "Venusaur text on the trainer" leak.)
  // the card's masterdata id (strip leading 'c' + the trailing _NAME_RARITY): cTR_20_000230_00_LEAF_SR → TR_20_000230_00
  const mdId = (/^c?((?:TR|PK)_\d+_\d+_\d+)/.exec(scene_data.card.id || "") || [])[1];
  // DynamicUI is composed generically for every card. The old per-locale card_ui files remain
  // offline fallbacks only; mixing them with /compose would draw shared UGUI Images twice.
  // (server runs carddata.mjs + compose.mjs — no per-card offline pre-gen, no _UT bake).
  let dynamicUIRenderScale = 1;
  async function buildFace(lc) {
    if (!mdId) return null;
    // Prefer source-current live composition; the prebaked text file is only an offline fallback.
    const composeUrl = `/compose?id=${mdId}&lc=${lc}&ill=${encodeURIComponent(scene_data.card.id || "")}`;
    let composed = await fetch(composeUrl).then((r) => r.ok ? r.json() : null).catch(() => null);
    if (!composed) composed = await fetch(`text/${mdId}.${lc}.json`).then((r) => r.ok ? r.json() : null).catch(() => null);
    if (!composed || !composed.elements || !composed.elements.length) return null;
    return buildDynamicUITexture(
      { canvasWH: composed.canvasWH, elements: [] },
      { elements: composed.elements },
      dynamicUISamplerState,
      dynamicUIRenderScale,
      officialTmpFonts,
      renderer,
      officialTmpSdfProgram,
      officialUIRTPrograms,
      officialTmpSpriteProgram,
      fullRuntimeAudit,
      officialTmpSpriteContract,
    );
  }

  // The generated contract is the only browser port inventory. Adding or migrating a port updates
  // the contract and its manifest; app.js owns no parallel shader/manifest/source list.
  const exactShaders = await loadExactShaderPortsFromContract({
    exactEnabled,
    canonicalizeObjectClipPosition: !logicBisectCase.disableCanonicalObjectClipPosition,
  });
  hasBloomProducer = !qp.has("nobloom")
    && !logicBisectCase.disableBloom
    && sceneUsesBloomProducer(scene_data.materials, exactShaders);
  const [officialBloomPrograms, officialFinalBlitProgram, cardDisplayContract, homographyDisplayProgram] = await Promise.all([
    loadOfficialBloomPrograms(),
    loadOfficialFinalBlitProgram(),
    fetch("render/card-display-contract.json").then((response) => {
      if (!response.ok) throw new Error(`Card display contract: HTTP ${response.status}`);
      return response.json();
    }),
    loadHomographyDisplayProgram(),
  ]);
  if (cardDisplayContract.schema_version !== 6) throw new Error("unsupported card display contract schema");
  const detailDisplayProfile = cardDisplayContract.profiles
    ?.ordinary_android_default_middle_without_persisted_override;
  if (!detailDisplayProfile?.display_mode?.clamp_parallax
    || detailDisplayProfile.display_mode.selected_material !== "PrerenderHomographyCard") {
    throw new Error("official detail display profile must select PrerenderHomographyCard");
  }
  if (typeof detailDisplayProfile.applicability?.quality_name !== "string"
    || !detailDisplayProfile.applicability.quality_name.trim()) {
    throw new Error("official detail display profile must name its default quality");
  }
  const officialDefaultQuality = detailDisplayProfile.applicability.quality_name.toLowerCase();
  const qualityParam = (qp.get("quality") || officialDefaultQuality).toLowerCase();
  const qualityProfiles = cardDisplayContract.quality_profiles;
  const canvas = document.getElementById("c");
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: true, stencil: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);

  // The captured game runtime uses the ordinary Android Middle profile. Auto is an inspection-only
  // profile derived from the actual physical drawing buffer: it preserves every official render step
  // while preventing the fixed mobile source RT from being enlarged during the desktop display pass.
  const drawingBuffer = renderer.getDrawingBufferSize(new THREE.Vector2());
  const requestedDisplaySide = Math.round(Math.min(drawingBuffer.x, drawingBuffer.y));
  const baseQualityProfile = selectCardQualityProfile(
    qualityParam,
    qualityProfiles,
    requestedDisplaySide,
    renderer.capabilities.maxTextureSize,
  );
  const selectedQualityProfile = logicBisectCase.sourceRenderScale
    ? {
      ...baseQualityProfile,
      quality_name: `${baseQualityProfile.quality_name}Diagnostic${logicBisectCase.sourceRenderScale}x`,
      source_render_target_request: {
        ...baseQualityProfile.source_render_target_request,
        width: Math.min(
          renderer.capabilities.maxTextureSize,
          Math.round(baseQualityProfile.source_render_target_request.width * logicBisectCase.sourceRenderScale),
        ),
        height: Math.min(
          renderer.capabilities.maxTextureSize,
          Math.round(baseQualityProfile.source_render_target_request.height * logicBisectCase.sourceRenderScale),
        ),
      },
    }
    : baseQualityProfile;
  dynamicUIRenderScale = selectDynamicUIRenderScale(
    qualityParam,
    selectedQualityProfile,
    qualityProfiles,
  );
  console.log(
    `official card quality: ${selectedQualityProfile.quality_name} `
    + `${selectedQualityProfile.source_render_target_request.width}x${selectedQualityProfile.source_render_target_request.height} `
    + `(requested ${qualityParam}, display side ${requestedDisplaySide})`,
  );
  console.log(`dynamic UI texture scale: ${dynamicUIRenderScale.toFixed(4)}`);
  let dynTex = await buildFace(curLoc);
  publishTmpSdfStatus(dynTex?.evidence);
  const dynUITex = dynTex && dynTex.ui;       // DynamicUIType.Text (Unity layer 17 / CardUIText)
  const dynHoloTex = dynTex && dynTex.holo;   // DynamicUIType.Holo (Unity layer 18 / CardUIMetallic)
  const foilTex = dynTex && dynTex.foil;      // ex-foil mask (only the ex glyph + ex-rule banner)
  // real environment cubemap for the holo/foil reflections (samplerCube, not a 2D matcap)
  const envCubeUrl = (Object.values(scene_data.materials).find((m) => m.textures && m.textures._CubeMap) || {}).textures?._CubeMap?.url;
  const envCubeTex = envCubeUrl ? await loadEnvCube(envCubeUrl, officialSamplerMap[envCubeUrl]) : null;
  const exactGlitMats = [];   // RawShaderMaterials driven by the native GlitterFlowMaps state machine

  // The official Android player uses Unity's Gamma color-space workflow. In that workflow texture samples,
  // render targets, and the display framebuffer stay in their stored gamma domain without automatic sRGB
  // decode/encode. The decompiled programs therefore receive and emit raw values.
  const cardTargetColorSpace = THREE.NoColorSpace;
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.setClearColor(0x14161c, 1);

  const scene = new THREE.Scene();
  const displayScene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(
    cardDisplayContract.camera.field_of_view_degrees,
    cardDisplayContract.camera.aspect,
    cardDisplayContract.camera.near_clip_plane,
    cardDisplayContract.camera.far_clip_plane,
  );
  const displayCamera = new THREE.PerspectiveCamera(
    cardDisplayContract.camera.field_of_view_degrees,
    innerWidth / innerHeight,
    cardDisplayContract.camera.near_clip_plane,
    cardDisplayContract.camera.far_clip_plane,
  );

  const sortLocalCenter = new THREE.Vector3();
  const sortWorldCenter = new THREE.Vector3();
  const sortCameraPosition = new THREE.Vector3();
  function nativeDistanceForRenderItem(item) {
    const sort = item.object.userData.officialSort;
    if (!sort) return null;
    if (sort.rendererType !== "MeshRenderer" || !Number.isFinite(sort.distanceOffset)) {
      throw new Error(`unsupported official sort descriptor for ${item.object.userData.label || item.object.name}`);
    }
    if (!item.geometry.boundingBox) item.geometry.computeBoundingBox();
    item.geometry.boundingBox.getCenter(sortLocalCenter);
    sortWorldCenter.copy(sortLocalCenter).applyMatrix4(item.object.matrixWorld);
    sortCameraPosition.setFromMatrixPosition(camera.matrixWorld);
    return officialDistanceKey({
      metric: OFFICIAL_DISTANCE_METRIC.Perspective,
      position: sortWorldCenter.toArray(),
      worldToCamera: camera.matrixWorldInverse.elements,
      cameraPosition: sortCameraPosition.toArray(),
      f: sort.distanceOffset,
    });
  }
  function compareOfficialPrefix(a, b, transparent) {
    const sortA = a.object.userData.officialSort;
    const sortB = b.object.userData.officialSort;
    if (sortA && sortB) {
      const layerValue = sortA.sortingLayerValue - sortB.sortingLayerValue;
      if (layerValue) return layerValue;
      const layerOrder = sortA.sortingOrder - sortB.sortingOrder;
      if (layerOrder) return layerOrder;
    } else {
      const group = a.groupOrder - b.groupOrder;
      if (group) return group;
    }
    const queue = a.renderOrder - b.renderOrder;
    if (queue) return queue;
    if (sortA && sortB) {
      const distanceA = nativeDistanceForRenderItem(a);
      const distanceB = nativeDistanceForRenderItem(b);
      const distance = transparent
        ? distanceA.primary - distanceB.primary
        : distanceA.quantizedFrontToBackBucket - distanceB.quantizedFrontToBackBucket;
      if (distance) return distance;
      if (transparent) {
        const groupA = sortA.sortingGroupKey >>> 0;
        const groupB = sortB.sortingGroupKey >>> 0;
        const bothReserved = groupA >= 0xfffff000 && groupB >= 0xfffff000;
        if (!bothReserved && groupA !== groupB) return groupA < groupB ? -1 : 1;
        if (sortA.canvasOrder !== sortB.canvasOrder) {
          return sortA.canvasOrder < sortB.canvasOrder ? -1 : 1;
        }
        if (sortA.materialSlot !== sortB.materialSlot) {
          return sortA.materialSlot < sortB.materialSlot ? -1 : 1;
        }
      }
      if (Number.isInteger(sortA.srpBatcherCompatible)
          && Number.isInteger(sortB.srpBatcherCompatible)
          && sortA.srpBatcherCompatible !== sortB.srpBatcherCompatible) {
        return sortA.srpBatcherCompatible < sortB.srpBatcherCompatible ? -1 : 1;
      }
    } else {
      const projected = transparent ? b.z - a.z : a.z - b.z;
      if (projected) return projected;
    }
    if (capturedSortResolver) {
      const drawIdA = a.object.userData.officialDraw?.drawId;
      const drawIdB = b.object.userData.officialDraw?.drawId;
      if (drawIdA && drawIdB) {
        const criteria = transparent
          ? OFFICIAL_PASS_CRITERIA.DrawTransparent.criteria
          : OFFICIAL_PASS_CRITERIA.DrawOpaque.criteria;
        const captured = capturedSortResolver.compare(drawIdA, drawIdB, criteria);
        if (captured !== null) return captured;
      }
    }
    // Without a complete session-bound collision group, keep the existing deterministic fallback.
    // Partial capture data is never mixed into a group because it can break comparator transitivity.
    return a.material.id - b.material.id || a.id - b.id;
  }
  renderer.setOpaqueSort((a, b) => compareOfficialPrefix(a, b, false));
  renderer.setTransparentSort((a, b) => compareOfficialPrefix(a, b, true));
  window.__officialSortDiagnostics = {
    opaque: "exact through statically proved SRP bit; first unresolved key is entry+0x08 hashed Material/Shader state",
    transparent: "exact through statically proved SRP bit; first unresolved key is entry+0x08 hashed Material/Shader state",
  };

  function makeBloomPass(hasBloom) {
    const source = selectedQualityProfile.source_render_target_request;
    const w = source.width, h = source.height;
    const sceneRT = createOfficialMrtTarget(renderer, w, h);
    for (const texture of sceneRT.textures) texture.colorSpace = cardTargetColorSpace;
    return createOfficialBloomPipeline({
      renderer,
      sceneTarget: sceneRT,
      programs: officialBloomPrograms,
      finalBlitProgram: officialFinalBlitProgram,
      enabled: hasBloom,
      resizeSceneTarget: resizeOfficialMrtTarget,
      resizeSourceToDrawingBuffer: false,
      diagnosticsEnabled: shotMode || fullRuntimeAudit,
    });
  }

  function makeDisplayPass() {
    const drawingBuffer = renderer.getDrawingBufferSize(new THREE.Vector2());
    const target = createOfficialMrtTarget(
      renderer,
      Math.max(1, drawingBuffer.x || innerWidth),
      Math.max(1, drawingBuffer.y || innerHeight),
    );
    for (const texture of target.textures) texture.colorSpace = cardTargetColorSpace;
    // The exact Homography fragment writes MRT0 and MRT1, so WebGL must render it into a
    // two-attachment target before the official FinalBlit presents MRT0 to the canvas.
    return createOfficialBloomPipeline({
      renderer,
      sceneTarget: target,
      programs: officialBloomPrograms,
      finalBlitProgram: officialFinalBlitProgram,
      enabled: false,
      resizeSceneTarget: resizeOfficialMrtTarget,
      resizeSourceToDrawingBuffer: true,
      diagnosticsEnabled: shotMode || fullRuntimeAudit,
    });
  }

  // Texture alpha classification is retained as source diagnostics only. Official pass/material state
  // controls blending; an input texture's stored RGB cannot rewrite the shader output convention.
  // alpha mode comes from the build (build/detect_alpha.py with PIL — reliable, unlike canvas).
  const alphaMode = scene_data.alphaMode || {};
  const texInfo = new Map();                 // name -> { tex, straight }
  function preloadOfficialTextures(urlMap) {
    const entries = Object.entries(urlMap);
    let done = 0;
    const tick = () => {
      done += 1;
      setLoading(`Loading textures ${done}/${entries.length}`);
    };
    return Promise.all(entries.map(async ([name, url]) => {
      try {
        const tex = await loadOfficialTexture(url, officialSamplerMap[url]);
        texInfo.set(name, { tex, straight: alphaMode[name] === "straight" });
      } catch {
        console.warn("tex fail", url);
      } finally {
        tick();
      }
    }));
  }

  const animMats = [];
  const kiraPuyoMats = [];
  const circularKiraComponents = new Map();

  setLoading("Loading textures…");
  await preloadOfficialTextures(scene_data.textures);
  // RenderContext: the runtime deps every material strategy needs (resolved textures, env cubemap,
  // per-frame animation lists, the DynamicUI foil). Built once, after textures load.
  const exHoloMats = [];   // EX-foil materials (the language switch swaps their dynUI/foil textures)
  const ctx = makeRenderContext({ texInfo, envCubeTex, exactShaders, animMats, exactGlitMats, kiraPuyoMats, circularKiraComponents, runtimeSettings: scene_data.runtimeSettings, dynUITex, dynHoloTex, foilTex, exHoloMats });

  const loader = new GLTFLoader();
  setLoading("Loading model…");
  loader.load(scene_data.prefabGlb, (gltf) => {
    const root = gltf.scene;
    root.updateMatrixWorld(true);

    // DEBUG: render the raw prefab glb as-is (like dragging into Blender) to check geometry.
    if (window.__fbxraw) {
      const only = window.__only || "";
      root.traverse((o) => { if (o.isMesh && only && !o.name.includes(only)) o.visible = false; });
      scene.add(root);
      const box = new THREE.Box3().setFromObject(root);
      const c = box.getCenter(new THREE.Vector3()), s = box.getSize(new THREE.Vector3());
      const d = Math.max(s.x, s.y, s.z) * 1.8;
      camera.position.set(c.x, c.y, c.z + d); camera.lookAt(c);
      window.__tilt = new THREE.Group();
      log(`glbraw: bbox ${s.x.toFixed(3)}x${s.y.toFixed(3)}x${s.z.toFixed(3)}`);
      return;
    }

    // ── AUTHORITATIVE: iterate the glb's OWN meshes, key each by its material.name ──
    // The glb is the scene of record (correct nodes, instances, materials, world transforms). Each
    // mesh's material.name maps to a recipe in scene_data.materials (shader/queue/clip/textures/floats).
    // No node-name guessing or counters: the 4 RareMark diamonds each carry material L_Raremark_Diamond_a
    // → same recipe at their own transforms; the outline primitives carry L_RaremarkFlame_a; SBM2/SBM4
    // and every multi-material node split into distinct materials automatically.
    const materials = scene_data.materials;
    if (scene_data.officialDrawSchemaVersion !== 2 || !Array.isArray(scene_data.officialDraws)) {
      throw new Error("scene is missing the official draw-identity table");
    }
    const officialDrawsByMaterial = new Map();
    const officialDrawsByNodeMaterial = new Map();
    const nodeMaterialKey = (nodePath, materialName) => `${nodePath}\u0000${materialName}`;
    for (const draw of scene_data.officialDraws) {
      if (typeof draw.goPath !== "string" || !draw.goPath) {
        throw new Error(`${draw.drawId || "official draw"}: missing GameObject path`);
      }
      if (!officialDrawsByMaterial.has(draw.materialName)) officialDrawsByMaterial.set(draw.materialName, []);
      officialDrawsByMaterial.get(draw.materialName).push(draw);
      const key = nodeMaterialKey(draw.goPath, draw.materialName);
      if (!officialDrawsByNodeMaterial.has(key)) officialDrawsByNodeMaterial.set(key, []);
      officialDrawsByNodeMaterial.get(key).push(draw);
    }
    function sourceNodePath(object) {
      if (typeof object.userData.officialNodePath === "string") {
        return object.userData.officialNodePath;
      }
      const names = [];
      for (let current = object; current && current !== root.parent; current = current.parent) {
        if (current.name) names.push(current.name);
      }
      return names.reverse().join("/");
    }
    function resolveOfficialDraw(sourceMesh, materialName) {
      const nodePath = sourceNodePath(sourceMesh);
      const matches = officialDrawsByNodeMaterial.get(nodeMaterialKey(nodePath, materialName)) || [];
      if (matches.length > 1) {
        throw new Error(`${nodePath}:${materialName} maps to multiple official draw identities`);
      }
      return { draw: matches[0] || null, nodePath };
    }
    function attachOfficialDrawIdentity(mesh, materialName, resolved) {
      mesh.userData.sourceNodePath = resolved.nodePath;
      if (resolved.draw) {
        mesh.userData.officialDraw = resolved.draw;
        return;
      }
      const candidates = officialDrawsByMaterial.get(materialName) || [];
      if (candidates.length === 1) {
        // AssetRipper may flatten or rename the source node path. A single material-bound official
        // draw remains an exact identity join; multiple same-name candidates are never guessed.
        mesh.userData.officialDraw = candidates[0];
        mesh.userData.officialDrawResolution = "unique-material-candidate";
        return;
      }
      if (candidates.length) {
        // Preserve the candidate set for diagnostics, but never guess by same-name occurrence order.
        mesh.userData.officialDrawCandidates = candidates.map((draw) => draw.drawId);
      }
    }
    function attachAuditDescriptor(mesh, materialName, recipe = null) {
      if (!fullRuntimeAudit) return;
      attachLocalDrawAudit(mesh, {
        materialName,
        shader: recipe?.shader || (materialName === "L_FullFace_Text" ? "Text" : null),
      });
    }
    // AssetRipper retains the official LensFlare GameObjects and transforms but drops their external
    // `unity default resources` Mesh PPtr (Quad, PathID 10210). Restore only that serialized built-in mesh;
    // material selection and Front/Back behavior still come entirely from each scene recipe.
    const unityQuad = new THREE.PlaneGeometry(1, 1);
    for (const [matName, recipe] of Object.entries(materials)) {
      if (recipe.shader !== "Card_UR_LensFlare" || !recipe.go) continue;
      const node = root.getObjectByName(recipe.go);
      if (!node || node.isMesh || node.children.some((child) => child.isMesh)) continue;
      const proxyMaterial = new THREE.MeshBasicMaterial();
      proxyMaterial.name = matName;
      const quad = new THREE.Mesh(unityQuad, proxyMaterial);
      quad.name = `${recipe.go}_Quad`;
      quad.userData.officialBuiltinQuad = true;
      const drawCandidates = (officialDrawsByMaterial.get(matName) || [])
        .filter((draw) => draw.go === recipe.go);
      if (drawCandidates.length !== 1) {
        throw new Error(`${matName}:${recipe.go} does not resolve one official built-in Quad draw`);
      }
      quad.userData.officialNodePath = drawCandidates[0].goPath;
      node.add(quad);
    }
    root.updateMatrixWorld(true);
    const cardGroup = new THREE.Group();
    // Every official draw shares one MRT and depth attachment. Effective render queue routing keeps the
    // UR gold stack before the illustration without a lossy single-target background precompose.
    const fgGroup = new THREE.Group(), stencilGroup = new THREE.Group();
    cardGroup.add(stencilGroup); cardGroup.add(fgGroup);

    let built = 0, deferred = 0, writers = 0, skipped = 0;
    let dynUIMat = null;
    const ONLY = window.__only || "";
    // All layers remain under the same official Asset3D transform hierarchy. The later game homography
    // stage is tracked separately; do not approximate it by moving individual layers here.
    root.traverse((o) => {
      if (!o.isMesh) return;
      const matName = (o.material && o.material.name) || "";
      const isStencil = matName === "OuterStencil"
        || matName.startsWith("InnerStencil")
        || matName.startsWith("IllustStencil");
      if (ONLY && !/Stencil/.test(matName) && !matName.includes(ONLY)) return;
      const resolvedOfficialDraw = resolveOfficialDraw(o, matName);

      const r = materials[matName];
      if (!r) { skipped++; return; }                 // DefaultMaterial / unknown
      if (!r.sort || r.sort.rendererType !== "MeshRenderer"
          || r.sort.rendererTypeValue !== OFFICIAL_RENDERER_TYPE.MeshRenderer
          || !Number.isInteger(r.sort.materialSlot) || r.sort.materialSlot < 0
          || !Number.isInteger(r.sort.staticBatchFirstSubMesh)
          || !Number.isInteger(r.sort.staticBatchSubMeshCount)
          || !Number.isInteger(r.sort.lightmapIndex)
          || !Number.isInteger(r.sort.lightmapIndexDynamic)
          || !Number.isInteger(r.sort.packedLightmapIndices)
          || r.sort.packedLightmapIndices
            !== (((r.sort.lightmapIndexDynamic << 16) | r.sort.lightmapIndex) >>> 0)
          || !Number.isInteger(r.sort.lodFadeHighByte)
          || r.sort.lodFadeHighByte < 0 || r.sort.lodFadeHighByte > 0xff
          || !Number.isInteger(r.sort.sortingGroupId)
          || !Number.isInteger(r.sort.sortingGroupOrder)
          || !Number.isInteger(r.sort.sortingGroupKey)
          || r.sort.sortingGroupKey
            !== (((r.sort.sortingGroupId & 0xfffff) << 12) | (r.sort.sortingGroupOrder & 0xfff)) >>> 0
          || !Number.isInteger(r.sort.canvasOrder)
          || !Number.isFinite(r.sort.sortingLayerValue)
          || !Number.isFinite(r.sort.sortingOrder)
          || !Number.isFinite(r.sort.distanceOffset)
          || ![0, 1, null].includes(r.sort.srpBatcherCompatible)
          || r.sort.materialBatchStateBranch !== "hashed") {
        throw new Error(`${matName}: missing official MeshRenderer sort descriptor`);
      }
      const cfg = SHADER[r.shader];
      if (!cfg || cfg.defer) { deferred++; return; }  // metal (no-op), card back/edges, LOD

      // dispatch by kind → the registered material strategy (Strategy + Registry pattern). requires()
      // gates whether the layer renders; build() returns the three.js material (sets userData.straight).
      const strat = getMaterial(cfg.kind);
      const drawRecipe = resolvedOfficialDraw.draw?.rendererProperties
        ? { ...r, rendererProperties: resolvedOfficialDraw.draw.rendererProperties }
        : r;
      if (!strat || !strat.requires(drawRecipe, ctx)) { skipped++; return; }
      const builtMaterial = strat.build(drawRecipe, ctx);
      if (!builtMaterial) { skipped++; return; }
      const rawMaterials = Array.isArray(builtMaterial) ? builtMaterial : [builtMaterial];
      if (rawMaterials.length === 0 || rawMaterials.some((material) => !material?.isMaterial)) {
        rawMaterials.forEach((material) => material?.dispose?.());
        throw new Error(`${matName}: material strategy returned an invalid pass collection`);
      }
      let passMaterials;
      try {
        passMaterials = rawMaterials.length > 1
          ? orderOfficialPasses(rawMaterials, (material) => material.userData?.officialSelector)
          : rawMaterials;
      } catch (error) {
        rawMaterials.forEach((material) => material.dispose());
        throw new Error(`${matName}: ${error.message}`);
      }
      const isSB = r.shader === "Simple-Opaque-Hologram_Tuning" || r.shader === "Simple-Transparent"
                || r.shader === "Opaque-Hologram_Tuning"     // trainer SR shadowbox (same diorama mesh)
                || r.shader === "Opaque-UR-Oklab";           // UR shadowbox (same diorama mesh, Oklab colour)
      const stagedMeshes = [];
      let invalidQueue = false;
      for (const [passOrdinal, mat] of passMaterials.entries()) {
        const straight = !!mat.userData.straight;
        if (cfg.alphaTest && mat.isMeshBasicMaterial) mat.alphaTest = cfg.alphaTest;
        const exactPassApplied = mat.userData.officialPassRuntime
          ? applyOfficialPassState(mat, r, mat.userData.officialPassRuntime, { stencil: isStencil || !window.__raw })
          : false;
        if (mat.userData.officialPassRuntime && !exactPassApplied) {
          passMaterials.forEach((material) => material.dispose());
          throw new Error(`${matName}: selector-bound official pass state is unsupported`);
        }
        if (!exactPassApplied) {
          // Some official shaders use material-controlled blend factors (_SrcFactor/_DstFactor).
          setBlend(mat, cfg.blend, straight, cfg.materialBlend ? r.floats : undefined);
          if (!window.__raw) applyStencilState(mat, r);
          applyDepthState(mat, r.floats);
          applyCullState(mat, r.floats, cfg.cull ?? 2, cfg.materialCull);
        }
        if (!applyRenderQueueState(mat, r.queue)) { invalidQueue = true; break; }
        // These shader families use fixed LEqual depth state in the official pass rather than material floats.
        if (isSB && !exactPassApplied) {
          mat.depthTest = true;
          mat.depthWrite = cfg.blend === "opaque";
        }
        if (r.shader === "Card_Parallax" && logicBisectCase.id !== "baseline") {
          if (logicBisectCase.freezeParallaxUv) {
            const heightPower = mat.uniforms?._HeightPower || mat.uniforms?.uHeightPower;
            if (!heightPower) throw new Error(`${matName}: logic bisect cannot find Card_Parallax _HeightPower`);
            heightPower.value = 0;
          }
          if (logicBisectCase.forceParallaxUv0) {
            const useUv = mat.uniforms?._UseUv || mat.uniforms?.uUseUv;
            if (!useUv) throw new Error(`${matName}: logic bisect cannot find Card_Parallax _UseUv`);
            useUv.value = 0;
          }
          if (logicBisectCase.forceParallaxLowpass) {
            const textureUniforms = Object.values(mat.uniforms || {})
              .filter((uniform) => uniform?.value?.isTexture);
            if (textureUniforms.length !== 1) {
              throw new Error(`${matName}: logic bisect expected one Card_Parallax texture sampler`);
            }
            const sourceTexture = textureUniforms[0].value;
            const diagnosticTexture = sourceTexture.clone();
            diagnosticTexture.generateMipmaps = true;
            diagnosticTexture.minFilter = THREE.LinearMipmapLinearFilter;
            diagnosticTexture.magFilter = THREE.LinearFilter;
            diagnosticTexture.anisotropy = renderer.capabilities.getMaxAnisotropy();
            diagnosticTexture.userData = {
              ...sourceTexture.userData,
              logicBisectSampler: "trilinear-generated-mips-max-anisotropy",
            };
            diagnosticTexture.needsUpdate = true;
            textureUniforms[0].value = diagnosticTexture;
          }
          if (logicBisectCase.disableParallaxDepthWrite) mat.depthWrite = false;
          if (logicBisectCase.disableParallaxStencil) mat.stencilWrite = false;
          mat.userData.logicBisectCase = logicBisectCase.id;
        }
        if (logicBisectCase.disableAllDepth) {
          mat.depthTest = false;
          mat.depthWrite = false;
          mat.userData.logicBisectCase = logicBisectCase.id;
        }
        const mesh = new THREE.Mesh(o.geometry, mat);
        if (r.shader === "Card_Parallax" && logicBisectCase.hideParallaxDraws) {
          mesh.visible = false;
          mesh.userData.logicBisectHidden = true;
        }
        mesh.applyMatrix4(o.matrixWorld);
        if (mat.userData.glitterFlow) mat.userData.glitterTransform = mesh;
        if (mat.userData.kiraPuyoState) mat.userData.kiraPuyoTransform = mesh;
        if (mat.userData.circularKiraState) {
          bindCircularKiraMesh(mat.userData.circularKiraState, mat.userData.circularKiraRole, mesh);
        }
        mesh.renderOrder = r.queue;
        mesh.frustumCulled = false;
        mesh.userData.officialSort = r.sort;
        mesh.userData.officialPassOrdinal = passOrdinal;
        mesh.userData.recipeShader = r.shader;
        attachOfficialDrawIdentity(mesh, matName, resolvedOfficialDraw);
        attachAuditDescriptor(mesh, matName, r);
        const selector = mat.userData.officialSelector;
        const passLabel = selector ? `  p${selector.subshader}:${selector.pass}` : "";
        mesh.userData.label = `${matName}  ·  ${r.shader}  ·  q${mesh.renderOrder}${passLabel}`;
        stagedMeshes.push(mesh);
      }
      if (invalidQueue) {
        passMaterials.forEach((material) => material.dispose());
        skipped++;
        return;
      }
      if (matName === "L_FullFace_Text") dynUIMat = passMaterials[0];
      for (const mesh of stagedMeshes) {
        // Stencil writers share the normal selector/pass/identity path; only their scene group differs.
        if (isStencil) {
          stencilGroup.add(mesh);
          writers++;
        } else {
          fgGroup.add(mesh);
          built++;
        }
      }
    });

    for (const state of circularKiraComponents.values()) {
      const matches = [];
      root.traverse((object) => {
        if (sourceNodePath(object) === state.config.componentGoPath) matches.push(object);
      });
      if (matches.length !== 1) {
        throw new Error(`${state.componentIdentity}: component GameObject path resolved ${matches.length} nodes`);
      }
      const componentTransform = new THREE.Object3D();
      matches[0].matrixWorld.decompose(
        componentTransform.position,
        componentTransform.quaternion,
        componentTransform.scale,
      );
      cardGroup.add(componentTransform);
      finalizeCircularKiraBindings(state, componentTransform);
    }


    // Official hierarchy: studioRoot -> Asset3D root -> rotation -> parent -> loaded asset.
    // SetFlipped(false), used for the normal card face, sets parent.localRotation = Ry(180 degrees).
    const studioRoot = new THREE.Group();
    const assetRoot = new THREE.Group();
    const rotationRoot = new THREE.Group();
    const parentRoot = new THREE.Group();
    parentRoot.rotation.y = Math.PI;
    parentRoot.add(cardGroup);
    rotationRoot.add(parentRoot);
    assetRoot.add(rotationRoot);
    studioRoot.add(assetRoot);
    scene.add(studioRoot);
    // ModelRenderStudio Camera.cullingMask is 0x00200000: layer 21, UICardViewRenderer.
    studioRoot.traverse((object) => object.layers.set(21));
    camera.layers.set(21);
    studioRoot.updateWorldMatrix(true, true);
    // EXACT game camera (Asset3DRenderer): CameraDistance 1.911506, fov 35. The shadowbox is a
    // depth diorama calibrated to this distance — a closer bbox-fit over-separates the parts.
    const cameraPosition = cardDisplayContract.camera.local_position;
    // In the exported GLB the front primitive is z=-0.005/normal=-Z. The official parent Ry(180)
    // moves it to z=+0.005/normal=+Z, so the converted Three camera must view it from +Z.
    camera.position.set(cameraPosition[0], cameraPosition[1], -cameraPosition[2]);
    camera.lookAt(0, 0, 0);
    // The official built-in Quad winds toward -Z and Homography serializes Cull Back. Its UI
    // camera must therefore view the quad from +Z as well.
    displayCamera.position.set(cameraPosition[0], cameraPosition[1], -cameraPosition[2]);
    displayCamera.lookAt(0, 0, 0);

    log(`built ${built} meshes (${writers} stencil, ${deferred} deferred, ${skipped} skipped)  ${scene_data.card.name} ${scene_data.card.rarityToken}`);
    window.__tilt = assetRoot;

    // ── LANGUAGE SWITCH: rebuild only the DynamicUI canvas (content + fonts) and swap the textures in place ──
    window.__post = makeBloomPass(hasBloomProducer);
    window.__displayPost = makeDisplayPass();
    const displayGeometry = new THREE.BufferGeometry();
    displayGeometry.setAttribute("position", new THREE.Float32BufferAttribute([
      -0.5, -0.5, 0,
       0.5, -0.5, 0,
      -0.5,  0.5, 0,
       0.5,  0.5, 0,
    ], 3));
    displayGeometry.setAttribute("uv", new THREE.Float32BufferAttribute([
      0, 0, 1, 0, 0, 1, 1, 1,
    ], 2));
    // APK base/assets/bin/Data/unity default resources, Quad PathID 10210. The manifest
    // reverses each Unity triangle when adapting the left-handed mesh to Three's right-handed world.
    displayGeometry.setIndex(homographyDisplayProgram.manifest.bindings.vertex_attribute.webgl2_indices);
    const keypointRotation = new THREE.Quaternion(...cardDisplayContract.homography.keypoint_root_rotation);
    const keypointLocals = cardDisplayContract.homography.keypoints.map(({ local_position: position }) => (
      new THREE.Vector3(...position).applyQuaternion(keypointRotation)
    ));
    const keypointExtent = keypointLocals.reduce((bounds, point) => ({
      minX: Math.min(bounds.minX, point.x), maxX: Math.max(bounds.maxX, point.x),
      minY: Math.min(bounds.minY, point.y), maxY: Math.max(bounds.maxY, point.y),
    }), { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity });
    const displayWorldSize = Math.max(
      keypointExtent.maxX - keypointExtent.minX,
      keypointExtent.maxY - keypointExtent.minY,
    );
    const projectedKeypoints = () => {
      // Official ModelRenderStudio.GetRotatedKeyPoints projects the serialized KeyPoints/Root
      // transforms. ApplyClampedRotation writes only _renderObject.localRotation, so feeding the
      // render object's tilt into these points would apply the same pose twice.
      camera.updateWorldMatrix(true, false);
      camera.updateProjectionMatrix();
      return keypointLocals.map((point) => {
        const projected = point.clone().project(camera);
        return [(projected.x + 1) * 0.5, (projected.y + 1) * 0.5];
      });
    };
    const displayMaterial = createHomographyDisplayMaterial({
      program: homographyDisplayProgram,
      dynamicUITexture: window.__post.sceneRT.textures[0],
      viewportPoints: [[0, 0], [1, 0], [0, 1], [1, 1]],
    });
    const displayMesh = new THREE.Mesh(displayGeometry, displayMaterial);
    displayMesh.frustumCulled = false;
    displayScene.add(displayMesh);
    const updateDisplayViewport = () => {
      displayCamera.aspect = innerWidth / innerHeight;
      displayCamera.updateProjectionMatrix();
      const containScale = Math.min(1, displayCamera.aspect);
      displayMesh.scale.setScalar(displayWorldSize * containScale);
    };
    updateDisplayViewport();
    window.__cardDisplay = {
      material: displayMaterial,
      mesh: displayMesh,
      projectedKeypoints,
      updateViewport: updateDisplayViewport,
    };
    // its own font download + canvas rebuild takes a beat, so show the small busy spinner and lock the dropdown.
    let switching = false;
    let cardSel = null, repeatedSceneIds = new Set();
    const sceneByFile = new Map(sceneList.map((sceneInfo) => [sceneInfo.file, sceneInfo]));
    const localSceneByIllustration = new Map(
      sceneList
        .filter((sceneInfo) => sceneInfo.id)
        .map((sceneInfo) => [sceneInfo.id, sceneInfo.file]),
    );
    const exampleSceneFile = (example) =>
      example.bundledSceneFile
      || localSceneByIllustration.get(example.illustrationId)
      || null;
    const exampleByIllustration = new Map([
      ...coverageExamples,
      ...supplementalExamples,
    ].map((example) => [example.illustrationId, example]));
    function refreshCardSelectLabels() {
      if (!cardSel) return;
      for (const op of cardSel.options) {
        const example = exampleByIllustration.get(op.dataset.illustrationId);
        if (example) {
          op.textContent = exampleLabel(example, curLoc);
          continue;
        }
        const sceneInfo = sceneByFile.get(op.value);
        if (sceneInfo) op.textContent = sceneLabel(sceneInfo, repeatedSceneIds, curLoc);
      }
      const labels = EXAMPLE_GROUP_LABELS[curLoc] || EXAMPLE_GROUP_LABELS.en_US;
      for (const group of cardSel.querySelectorAll("optgroup[data-example-group]")) {
        group.label = labels[Number(group.dataset.exampleGroup)];
      }
    }
    async function switchLocale(lc, selEl) {
      if (switching) return;
      switching = true; busy(true, "Switching…"); if (selEl) selEl.disabled = true;
      try {
        await loadLocaleData(lc);                          // sets curFonts + loads that locale's fonts
        const t = await buildFace(lc);                     // rebuild the DynamicUI for the new locale (any card)
        if (t && dynUIMat) {
          const uniformName = dynUIMat.userData.dynamicUIUniform;
          if (!uniformName || !dynUIMat.uniforms[uniformName]) {
            throw new Error("L_FullFace_Text: missing exact DynamicUI sampler binding");
          }
          dynUIMat.uniforms[uniformName].value = t.ui;
        }
        if (t) for (const m of exHoloMats) {
          if (m.uniforms.dynUI) m.uniforms.dynUI.value = t.ui;
          if (m.uniforms.dynHolo) m.uniforms.dynHolo.value = t.holo;
          if (m.uniforms._563) m.uniforms._563.value = t.holo;
          if (m.uniforms._581) m.uniforms._581.value = t.holo;
          if (m.uniforms.foilMask) m.uniforms.foilMask.value = t.foil;
        }
        if (t) {
          const previous = dynTex;
          dynTex = t;
          publishTmpSdfStatus(t.evidence);
          previous?.dispose?.();
        }
        curLoc = lc;
        refreshCardSelectLabels();
      } catch (e) { console.warn("switchLocale", e); }
      finally {
        switching = false; busy(false); if (selEl) selEl.disabled = false;
        const next = new URL(location.href);
        next.searchParams.set("lc", curLoc);
        history.replaceState(null, "", next);
      }
    }
    if (controlsEl && (sceneList.length > 1 || coverageExamples.length > 0)) {
      const counts = new Map();
      for (const s of sceneList) {
        const key = s.id || s.name || s.file;
        counts.set(key, (counts.get(key) || 0) + 1);
      }
      repeatedSceneIds = new Set([...counts].filter(([, n]) => n > 1).map(([k]) => k));
      const sel = document.createElement("select");
      cardSel = sel;
      sel.setAttribute("aria-label", "Card");
      const appendExampleGroup = (groupIndex, examples, disabled = false) => {
        if (!examples.length) return;
        const group = document.createElement("optgroup");
        group.dataset.exampleGroup = String(groupIndex);
        for (const example of examples) {
          const op = document.createElement("option");
          const sceneFile = exampleSceneFile(example);
          op.value = sceneFile || "";
          op.dataset.illustrationId = example.illustrationId;
          op.textContent = exampleLabel(example, curLoc);
          op.disabled = disabled || !sceneFile || !sceneByFile.has(sceneFile);
          if (sceneFile === currentSceneFile) op.selected = true;
          group.appendChild(op);
        }
        sel.appendChild(group);
      };
      const selectedReady = coverageExamples.filter(
        (example) =>
          exampleSceneFile(example)
          && sceneByFile.has(exampleSceneFile(example))
          && sceneByFile.get(exampleSceneFile(example))?.availability?.selectable !== false,
      );
      const selectedCatalog = coverageExamples.filter(
        (example) =>
          !exampleSceneFile(example)
          || !sceneByFile.has(exampleSceneFile(example))
          || sceneByFile.get(exampleSceneFile(example))?.availability?.selectable === false,
      );
      const supplementalReady = supplementalExamples.filter(
        (example) =>
          exampleSceneFile(example)
          && sceneByFile.has(exampleSceneFile(example))
          && sceneByFile.get(exampleSceneFile(example))?.availability?.selectable !== false,
      );
      appendExampleGroup(0, selectedReady);
      appendExampleGroup(1, supplementalReady);
      appendExampleGroup(2, selectedCatalog, true);
      const representedSceneFiles = new Set([
        ...selectedReady,
        ...supplementalReady,
      ].map(exampleSceneFile));
      for (const sceneInfo of sceneList) {
        if (representedSceneFiles.has(sceneInfo.file)) continue;
        const op = document.createElement("option");
        op.value = sceneInfo.file;
        op.textContent = sceneLabel(sceneInfo, repeatedSceneIds, curLoc);
        op.disabled = sceneInfo.availability?.selectable === false;
        if (sceneInfo.file === currentSceneFile) op.selected = true;
        sel.appendChild(op);
      }
      if (cardParam) {
        const op = document.createElement("option"); op.value = ""; op.textContent = compactCardName(scene_data.card.name) || cardParam;
        op.selected = true; sel.prepend(op);
      }
      refreshCardSelectLabels();
      sel.onchange = () => {
        if (!sel.value || sel.value === currentSceneFile) return;
        busy(true, "Loading…");
        const next = new URL(location.href);
        next.searchParams.delete("card");
        next.searchParams.delete("sortCapture");
        next.searchParams.set("scene", sel.value);
        next.searchParams.set("lc", curLoc);
        location.href = next;
      };
      controlsEl.appendChild(sel);
    }
    if (manifest && manifest.locales && manifest.locales.length > 1) {
      const sel = document.createElement("select");
      sel.setAttribute("aria-label", "Language");
      for (const l of manifest.locales) {
        const op = document.createElement("option"); op.value = l.lc; op.textContent = l.label;
        if (l.lc === curLoc) op.selected = true; sel.appendChild(op);
      }
      sel.onchange = () => switchLocale(sel.value, sel);
      (controlsEl || document.body).appendChild(sel);
    }

    if (logicBisectRequested && !window.__nohud) {
      const logicHud = document.createElement("div");
      logicHud.style.cssText = [
        "position:fixed",
        "right:8px",
        "top:8px",
        "width:min(390px,calc(100vw - 16px))",
        "max-height:calc(100vh - 16px)",
        "overflow:auto",
        "font:12px/1.45 monospace",
        "color:#fff",
        "background:rgba(0,0,0,.9)",
        "padding:10px",
        "z-index:11",
        "border:1px solid #666",
        "border-radius:4px",
        "box-sizing:border-box",
      ].join(";");
      const heading = document.createElement("div");
      heading.textContent = "逻辑对照（仅诊断，不改变正式默认路径）";
      heading.style.cssText = "font-weight:700;margin-bottom:5px";
      const active = document.createElement("div");
      active.textContent = `当前：${logicBisectCase.label}\n${logicBisectCase.description}`;
      active.style.cssText = "white-space:pre-wrap;color:#d8e7ff;margin-bottom:8px";
      const hint = document.createElement("div");
      hint.textContent = "每次切换会干净重载。请在同一倾角判断彩色纹路是否仍出现。";
      hint.style.cssText = "white-space:pre-wrap;color:#bbb;margin-bottom:8px";
      const caseList = document.createElement("div");
      caseList.style.cssText = "display:grid;grid-template-columns:1fr 1fr;gap:6px";
      for (const candidate of LOGIC_BISECT_CASES) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = `${candidate.group} · ${candidate.label}`;
        button.title = candidate.description;
        button.disabled = candidate.id === logicBisectCase.id;
        button.style.cssText = [
          "font:11px/1.3 monospace",
          "min-height:38px",
          "padding:5px 7px",
          "border:1px solid #777",
          "border-radius:3px",
          candidate.id === logicBisectCase.id ? "background:#315a88" : "background:#20242a",
          "color:#fff",
          candidate.id === logicBisectCase.id ? "cursor:default" : "cursor:pointer",
        ].join(";");
        button.addEventListener("click", () => {
          location.href = logicBisectCaseUrl(location.href, candidate.id);
        });
        caseList.appendChild(button);
      }
      const exit = document.createElement("button");
      exit.type = "button";
      exit.textContent = "退出逻辑对照";
      exit.style.cssText = "margin-top:8px;font:11px monospace;padding:5px 8px;border:1px solid #777;border-radius:3px;background:#20242a;color:#fff;cursor:pointer";
      exit.addEventListener("click", () => {
        const next = new URL(location.href);
        next.searchParams.delete("logicbisect");
        next.searchParams.delete("logiccase");
        location.href = next;
      });
      logicHud.append(heading, active, hint, caseList, exit);
      document.body.appendChild(logicHud);
      window.__logicBisect = {
        schema: "pocket-card-render/logic-bisect-runtime@1",
        activeCase: logicBisectCase,
      };
      document.documentElement.dataset.logicBisectCase = logicBisectCase.id;
    }

    // ── DEBUG MODE: isolate layers to find which RESOURCE has an artifact (the face lines, AM, ILL …) ──
    // Each built mesh is tagged userData.label (material · shader · queue, or "DynamicUI"). Cycle through
    // them solo, with the current resource shown on screen. Plus PREVIEW (flat, no tilt) vs SELECT (tilt).
    const dbgLayers = [];
    cardGroup.traverse((o) => { if (o.isMesh && o.userData.label) dbgLayers.push(o); });
    dbgLayers.sort((a, b) => a.renderOrder - b.renderOrder);
    window.__layerLabels = dbgLayers.map((mesh) => mesh.userData.label);
    const compositionDiagnostics = dbgLayers.map((mesh, index) => {
      if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
      const localBox = mesh.geometry.boundingBox;
      const cardBox = localBox.clone().applyMatrix4(mesh.matrix);
      return {
        layer: index + 1,
        label: mesh.userData.label,
        shader: mesh.userData.recipeShader,
        queue: mesh.renderOrder,
        depthTest: mesh.material.depthTest,
        depthWrite: mesh.material.depthWrite,
        depthFunc: mesh.material.depthFunc,
        cardMinZ: cardBox.min.z,
        cardMaxZ: cardBox.max.z,
        cardDepthSpan: cardBox.max.z - cardBox.min.z,
        drawId: mesh.userData.officialDraw?.drawId || null,
        goPath: mesh.userData.officialDraw?.goPath || null,
      };
    });
    window.__compositionDiagnostics = compositionDiagnostics;
    document.documentElement.dataset.compositionDiagnostics = JSON.stringify(compositionDiagnostics);
    console.log("=== composition diagnostics ===\n" + JSON.stringify(compositionDiagnostics));
    const diagnosticHiddenLayerNumbers = parseHiddenLayerNumbers(qp.get("hideLayer"));
    const diagnosticHiddenLayerIds = new Set(
      diagnosticHiddenLayerNumbers.map((number) => number - 1),
    );
    for (const layerId of diagnosticHiddenLayerIds) {
      if (layerId >= dbgLayers.length) {
        throw new RangeError(`hideLayer ${layerId + 1} exceeds ${dbgLayers.length} rendered layers`);
      }
    }
    const hud = document.createElement("div");
    // selectable (so you can copy the label) + above the canvas
    hud.style.cssText = "position:fixed;left:8px;bottom:8px;font:12px/1.5 monospace;color:#fff;background:rgba(0,0,0,.78);padding:7px 10px;white-space:pre;user-select:text;-webkit-user-select:text;z-index:9;border-radius:4px;max-width:94vw";
    if (!window.__nohud) document.body.appendChild(hud);
    // full numbered layer list to the console (copyable; reference a layer by its number)
    console.log("=== card layers (renderOrder) ===\n" + dbgLayers.map((m, i) => `[${i + 1}/${dbgLayers.length}] ${m.userData.label}`).join("\n"));
    let solo = -1;
    const isRegionStencilWriter = (mesh) => {
      const shader = mesh.material?.userData?.exactShader;
      return shader === "OuterStencil" || shader === "InnerStencil" || shader === "IllustStencil";
    };
    const effectBisectShaders = new Set([
      "Card_Parallax_Metal",
      "Card_Parallax_Hologram_Tuning",
      "Frame-Holo-Tuning",
      "Effect",
      "Transparent_Hologram_Tuning",
      "Opaque_Hologram_Tuning",
    ]);
    const bisectCandidateIds = dbgLayers
      .map((mesh, index) => ({ mesh, index }))
      .filter(({ mesh }) => (
        !isRegionStencilWriter(mesh)
        && !mesh.userData.logicBisectHidden
        && !(logicBisectCase.excludeParallaxFromBisect && mesh.userData.recipeShader === "Card_Parallax")
        && (!logicBisectCase.bisectEffectDraws || effectBisectShaders.has(mesh.userData.recipeShader))
      ))
      .map(({ index }) => index);
    const bisectCandidateIdSet = new Set(bisectCandidateIds);
    const fixedBisectIds = dbgLayers
      .map((_, index) => index)
      .filter((index) => !bisectCandidateIdSet.has(index));
    let bisectState = layerBisectRequested
      ? createLayerBisectState(bisectCandidateIds)
      : null;
    const bisectHud = document.createElement("div");
    bisectHud.style.cssText = [
      "position:fixed",
      "left:8px",
      "top:8px",
      "width:min(440px,calc(100vw - 16px))",
      "font:12px/1.45 monospace",
      "color:#fff",
      "background:rgba(0,0,0,.88)",
      "padding:10px",
      "z-index:10",
      "border:1px solid #555",
      "border-radius:4px",
      "box-sizing:border-box",
    ].join(";");
    const bisectText = document.createElement("div");
    bisectText.style.cssText = "white-space:pre-wrap;margin-bottom:8px";
    const bisectActions = document.createElement("div");
    bisectActions.style.cssText = "display:flex;gap:6px;flex-wrap:wrap";
    const bisectButton = (text, action, title) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = text;
      button.title = title;
      button.dataset.bisectAction = action;
      button.style.cssText = "font:12px monospace;padding:5px 8px;border:1px solid #777;border-radius:3px;background:#20242a;color:#fff;cursor:pointer";
      bisectActions.appendChild(button);
      return button;
    };
    const artifactStillButton = bisectButton("纹路仍在", "still", "当前隐藏层不是必要条件，继续检查仍显示的半组");
    const artifactGoneButton = bisectButton("纹路消失", "gone", "当前隐藏半组包含必要图层，恢复其余层并继续细分");
    const resetBisectButton = bisectButton("重新开始", "reset", "从全部非 stencil 图层重新二分");
    const exitBisectButton = bisectButton("退出二分", "exit", "恢复全部图层");
    bisectHud.append(bisectText, bisectActions);
    if (!window.__nohud) document.body.appendChild(bisectHud);
    bisectHud.style.display = bisectState ? "block" : "none";
    window.__preview = window.__preview ?? false;
    const formatLayerSet = (indices) => {
      if (!indices.length) return "(无)";
      const numbers = indices.map((index) => index + 1);
      return numbers.length <= 12
        ? numbers.join(", ")
        : `${numbers.slice(0, 6).join(", ")} ... ${numbers.slice(-3).join(", ")} (${numbers.length}层)`;
    };
    function updateBisectHud(probe) {
      bisectHud.style.display = bisectState && !window.__nohud ? "block" : "none";
      if (!bisectState) return;
      if (probe.done) {
        const label = dbgLayers[probe.candidate]?.userData?.label || "(missing label)";
        bisectText.textContent = [
          `二分完成 · 必要图层 [${probe.candidate + 1}/${dbgLayers.length}]`,
          label,
          `保留上下文: ${formatLayerSet(bisectState.context)}`,
          `已排除: ${formatLayerSet(bisectState.removed)}`,
        ].join("\n");
        artifactStillButton.disabled = true;
        artifactGoneButton.disabled = true;
        return;
      }
      artifactStillButton.disabled = false;
      artifactGoneButton.disabled = false;
      bisectText.textContent = [
        `排除式二分 · 第 ${bisectState.round} 轮 · 候选 ${bisectState.candidates.length} 层`,
        `本轮隐藏: ${formatLayerSet(probe.hidden)}`,
        `当前显示候选: ${formatLayerSet(probe.shownCandidates)}`,
        `固定非候选: ${formatLayerSet(fixedBisectIds)}`,
        `固定候选上下文: ${formatLayerSet(bisectState.context)}`,
        "保持当前倾角，判断彩色纹路是否还存在。",
      ].join("\n");
    }
    function applyDbg() {
      const bisectProbe = bisectState ? layerBisectProbe(bisectState) : null;
      const bisectVisible = bisectProbe ? new Set(bisectProbe.visible) : null;
      const selected = solo >= 0 ? dbgLayers[solo] : null;
      const selectedNeedsStencil = !!(
        selected?.material?.stencilWrite
        && selected.material.stencilFunc !== THREE.AlwaysStencilFunc
      );
      dbgLayers.forEach((m, i) => {
        if (diagnosticHiddenLayerIds.has(i)) {
          m.visible = false;
          return;
        }
        if (m.userData.logicBisectHidden) {
          m.visible = false;
          return;
        }
        if (bisectVisible) {
          m.visible = !bisectCandidateIdSet.has(i) || bisectVisible.has(i);
          return;
        }
        const stencilDependency = selectedNeedsStencil
          && m.material?.stencilWrite
          && m.material.stencilFunc === THREE.AlwaysStencilFunc;
        m.visible = solo < 0 || i === solo || stencilDependency;
      });
      const mode = window.__preview ? "PREVIEW (flat, no tilt)" : "SELECT (mouse-tilt)";
      const cur = solo < 0 ? `ALL — ${dbgLayers.length} layers` : `SOLO [${solo + 1}/${dbgLayers.length}]  ${dbgLayers[solo].userData.label}`;
      const hidden = diagnosticHiddenLayerNumbers.length
        ? `\nhidden: ${diagnosticHiddenLayerNumbers.join(", ")}`
        : "";
      hud.textContent = `mode: ${mode}\nlayer: ${cur}${hidden}\n[←/→] solo prev/next   [a] all   [p] preview/select   [h] hide`;
      updateBisectHud(bisectProbe);
      if (solo >= 0) console.log(`SOLO [${solo + 1}/${dbgLayers.length}] ${dbgLayers[solo].userData.label}`);
    }
    function answerBisect(artifactStillVisible) {
      if (!bisectState || layerBisectProbe(bisectState).done) return;
      bisectState = answerLayerBisect(bisectState, artifactStillVisible);
      solo = -1;
      applyDbg();
    }
    artifactStillButton.addEventListener("click", () => answerBisect(true));
    artifactGoneButton.addEventListener("click", () => answerBisect(false));
    resetBisectButton.addEventListener("click", () => {
      bisectState = createLayerBisectState(bisectCandidateIds);
      solo = -1;
      applyDbg();
    });
    exitBisectButton.addEventListener("click", () => {
      bisectState = null;
      solo = -1;
      applyDbg();
    });
    addEventListener("keydown", (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "y" && bisectState) { answerBisect(true); return; }
      if (e.key === "n" && bisectState) { answerBisect(false); return; }
      if (e.key === "r" && bisectState) {
        bisectState = createLayerBisectState(bisectCandidateIds);
        solo = -1;
        applyDbg();
        return;
      }
      if (e.key === "b") {
        bisectState = bisectState ? null : createLayerBisectState(bisectCandidateIds);
        solo = -1;
        applyDbg();
        return;
      }
      if (e.key === "ArrowRight" || e.key === "]") solo = solo + 1 >= dbgLayers.length ? -1 : solo + 1;
      else if (e.key === "ArrowLeft" || e.key === "[") solo = solo < 0 ? dbgLayers.length - 1 : solo - 1;
      else if (e.key === "a" || e.key === "0") solo = -1;
      else if (e.key === "p") window.__preview = !window.__preview;
      else if (e.key === "h") { hud.style.display = hud.style.display === "none" ? "block" : "none"; return; }
      else return;
      applyDbg();
    });
    applyDbg();
    // first frame is ready (meshes built, camera set) → reveal the card
    requestAnimationFrame(hideLoading);
  }, (ev) => { if (ev && ev.total) setLoading(`Loading model… ${Math.round(ev.loaded / ev.total * 100)}%`); },
     (e) => fail("FBX load: " + e));

  // Official TouchStateRotation acts on Asset3DRenderer.root. Homography keypoints
  // remain in the separate serialized ModelRenderStudio.Root/KeyPoints space.
  const touchRotation = createOfficialTouchRotationState();
  const touchPoint = (event) => screenPointToNormalizedLocal(
    event.clientX,
    event.clientY,
    renderer.domElement.getBoundingClientRect(),
  );
  renderer.domElement.style.touchAction = "none";
  renderer.domElement.addEventListener("pointerdown", (event) => {
    if (fullRuntimeAudit) return;
    if (event.pointerType === "mouse") {
      setAbsolutePointerTilt(touchRotation, touchPoint(event));
      return;
    }
    if (event.isPrimary === false || !beginOfficialTouchDrag(touchRotation, touchPoint(event), event.pointerId)) return;
    renderer.domElement.setPointerCapture(event.pointerId);
    event.preventDefault();
  });
  renderer.domElement.addEventListener("pointermove", (event) => {
    if (fullRuntimeAudit) return;
    if (event.pointerType === "mouse") {
      setAbsolutePointerTilt(touchRotation, touchPoint(event));
    } else if (touchRotation.dragging) {
      if (dragOfficialTouchRotation(touchRotation, touchPoint(event), event.pointerId)) event.preventDefault();
    } else if (shotMode) {
      // Synthetic non-mouse shot/debug callers remain deterministic.
      setOfficialDebugTilt(touchRotation, touchPoint(event));
    }
  });
  const finishPointer = (event) => {
    if (!endOfficialTouchDrag(touchRotation, event.pointerId)) return;
    if (renderer.domElement.hasPointerCapture(event.pointerId)) {
      renderer.domElement.releasePointerCapture(event.pointerId);
    }
    event.preventDefault();
  };
  renderer.domElement.addEventListener("pointerup", finishPointer);
  renderer.domElement.addEventListener("pointercancel", finishPointer);
  renderer.domElement.addEventListener("lostpointercapture", (event) => {
    endOfficialTouchDrag(touchRotation, event.pointerId);
  });
  window.__setDebugTilt = (x = 0, y = 0) => setOfficialDebugTilt(touchRotation, [x, y]);
  window.__officialTouchRotation = touchRotation;

  const identityQ = new THREE.Quaternion();
  const targetQ = new THREE.Quaternion();
  const glitterWorldQ = new THREE.Quaternion();
  const cardForward = new THREE.Vector3();
  let lastRender = -Infinity;
  const officialClock = new OfficialClock();
  syncOfficialClockVisibility(officialClock, document.hidden);
  window.__officialClock = officialClock;
  const fullRuntimeTiltPoint = Object.freeze([0.5, -0.25]);
  let fullRuntimeCaptureState = fullRuntimeAudit ? "await-neutral" : "disabled";
  let fullRuntimeNeutralSnapshot = null;
  if (fullRuntimeAudit) setOfficialDebugTilt(touchRotation, [0, 0]);
  window.__localDrawAuditActive = false;
  window.__localDrawAuditTrace = [];
  window.__fullRuntimeEvidenceStatus = { state: fullRuntimeCaptureState };
  document.documentElement.dataset.fullRuntimeEvidence = fullRuntimeCaptureState;

  function publishFullRuntimeEvidenceStatus(state, detail = {}) {
    fullRuntimeCaptureState = state;
    window.__fullRuntimeEvidenceStatus = { state, ...detail };
    document.documentElement.dataset.fullRuntimeEvidence = state;
  }

  function readFullRuntimePixels(target, attachment) {
    const pixels = new Uint8Array(target.width * target.height * 4);
    const previousTarget = renderer.getRenderTarget();
    const gl = renderer.getContext();
    renderer.setRenderTarget(target);
    gl.readBuffer(gl.COLOR_ATTACHMENT0 + attachment);
    renderer.readRenderTargetPixels(target, 0, 0, target.width, target.height, pixels);
    gl.readBuffer(gl.COLOR_ATTACHMENT0);
    renderer.setRenderTarget(previousTarget);
    return pixels;
  }

  async function summarizeFullRuntimePixels(pixels, width, height, attachment) {
    let nonzeroPixels = 0;
    let alphaNonzero = 0;
    let minX = width, minY = height, maxX = -1, maxY = -1;
    for (let pixel = 0, offset = 0; pixel < width * height; pixel += 1, offset += 4) {
      const nonzero = pixels[offset] !== 0 || pixels[offset + 1] !== 0
        || pixels[offset + 2] !== 0 || pixels[offset + 3] !== 0;
      if (pixels[offset + 3] !== 0) alphaNonzero += 1;
      if (!nonzero) continue;
      nonzeroPixels += 1;
      const x = pixel % width;
      const y = Math.floor(pixel / width);
      minX = Math.min(minX, x); minY = Math.min(minY, y);
      maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
    }
    const rgbaSha256 = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", pixels)))
      .map((value) => value.toString(16).padStart(2, "0")).join("");
    return {
      attachment,
      width,
      height,
      pixelCount: width * height,
      nonzeroPixels,
      alphaNonzero,
      bounds: nonzeroPixels ? [minX, minY, maxX, maxY] : null,
      rgbaSha256,
    };
  }

  function cloneRuntimeValue(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function readFullRuntimeState(label) {
    const post = window.__post;
    const displayPost = window.__displayPost;
    const mrt = window.__mrtDiagnostics;
    const display = window.__displayDiagnostics;
    const tmp = dynTex?.evidence;
    if (!post?.sceneRT || !displayPost?.sceneRT || !display || !mrt || !tmp) return null;

    const source0 = readFullRuntimePixels(post.sceneRT, 0);
    const source1 = readFullRuntimePixels(post.sceneRT, 1);
    const display0 = readFullRuntimePixels(displayPost.sceneRT, 0);
    const displaySnapshot = cloneRuntimeValue(display);
    const localDraws = cloneRuntimeValue(window.__localDrawAuditTrace);
    const officialTime = officialClock.globalTime;
    const pipelineSnapshot = {
      source: cloneRuntimeValue(post.diagnostics()),
      display: cloneRuntimeValue(displayPost.diagnostics()),
    };
    return Promise.all([
      summarizeFullRuntimePixels(source0, post.sceneRT.width, post.sceneRT.height, 0),
      summarizeFullRuntimePixels(source1, post.sceneRT.width, post.sceneRT.height, 1),
      summarizeFullRuntimePixels(display0, displayPost.sceneRT.width, displayPost.sceneRT.height, 0),
    ]).then(([sourceAttachment0, sourceAttachment1, displayAttachment0]) => ({
      label,
      officialTime,
      mrt: cloneRuntimeValue(mrt),
      display: displaySnapshot,
      pipelines: pipelineSnapshot,
      tmp: cloneRuntimeValue(tmp),
      source: { attachments: [sourceAttachment0, sourceAttachment1] },
      presentation: { attachment: displayAttachment0 },
      localDraws,
    }));
  }

  function compactTransformState(snapshot) {
    return {
      officialTime: snapshot.officialTime,
      renderObjectQuaternion: snapshot.display.renderObjectQuaternion,
      displayQuaternion: snapshot.display.displayQuaternion,
      viewportPoints: snapshot.display.viewportPoints,
      homography: snapshot.display.homography,
      inverseHomography: snapshot.display.inverseHomography,
      source: snapshot.source,
      display: snapshot.presentation,
      localDrawCount: snapshot.localDraws.length,
    };
  }

  function captureFullRuntimeEvidence() {
    if (!fullRuntimeAudit) return;
    if (fullRuntimeCaptureState === "await-neutral") {
      const snapshot = readFullRuntimeState("neutral");
      if (!snapshot) return;
      fullRuntimeNeutralSnapshot = snapshot;
      setOfficialDebugTilt(touchRotation, fullRuntimeTiltPoint);
      publishFullRuntimeEvidenceStatus("await-tilted", { normalizedTiltPoint: [...fullRuntimeTiltPoint] });
      return;
    }
    if (fullRuntimeCaptureState !== "await-tilted" || !fullRuntimeNeutralSnapshot) return;
    const tiltedSnapshot = readFullRuntimeState("tilted");
    if (!tiltedSnapshot) return;

    publishFullRuntimeEvidenceStatus("reading-pair");
    Promise.all([fullRuntimeNeutralSnapshot, tiltedSnapshot]).then(async ([neutral, tilted]) => {
      const runtimeSession = await fullRuntimeSessionPromise;
      const runtimeDrawingBuffer = renderer.getDrawingBufferSize(new THREE.Vector2());
      const canvasRect = canvas.getBoundingClientRect();
      const payload = {
        schemaVersion: 5,
        scene: sceneFile,
        locale: curLoc,
        url: runtimeSession.expectedUrl,
        provenance: {
          protocol: runtimeSession.protocol,
          batchId: runtimeSession.batchId,
          sessionNonce: runtimeSession.sessionNonce,
          sourceSetSha256: runtimeSession.sourceSetSha256,
          manifestSetSha256: runtimeSession.manifestSetSha256,
        },
        diagnostics: {
          scene: { file: sceneFile, id: scene_data.card.id, sha256: sceneSha256 },
          locale: curLoc,
          quality: {
            requested: qualityParam,
            selected: selectedQualityProfile.quality_name,
            factor: selectedQualityProfile.quality_factor,
            requestedDisplaySide,
          },
          surface: {
            cssViewport: [innerWidth, innerHeight],
            devicePixelRatio,
            rendererPixelRatio: renderer.getPixelRatio(),
            drawingBufferSize: [runtimeDrawingBuffer.x, runtimeDrawingBuffer.y],
            canvasBackingSize: [canvas.width, canvas.height],
            canvasCssSize: [canvasRect.width, canvasRect.height],
            dynamicUITextureSize: [dynUITex.image.width, dynUITex.image.height],
          },
          mrt: neutral.mrt,
          display: neutral.display,
          pipelines: neutral.pipelines,
          tmp: neutral.tmp,
        },
        source: neutral.source,
        display: neutral.presentation,
        localDraws: neutral.localDraws,
        transformProbe: {
          clock: "OfficialClock.advance(0)",
          adapter: "official-touch-rotation/absolute-pointer",
          normalizedTiltPoint: [...fullRuntimeTiltPoint],
          neutral: compactTransformState(neutral),
          tilted: compactTransformState(tilted),
        },
      };
      const response = await fetch("/audit/full-runtime", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`);
      publishFullRuntimeEvidenceStatus("posted", { payload });
      console.log("full-card runtime evidence recorded", payload);
    }).catch((error) => {
      publishFullRuntimeEvidenceStatus("failed", { error: String(error) });
      console.warn("full-card runtime evidence write failed", error);
    });
  }

  function readCenterProbe(target) {
    const probeSize = 16;
    const pixels = new Uint8Array(probeSize * probeSize * 4);
    const x = Math.max(0, Math.floor((target.width - probeSize) / 2));
    const y = Math.max(0, Math.floor((target.height - probeSize) / 2));
    renderer.readRenderTargetPixels(target, x, y, probeSize, probeSize, pixels);
    const colors = new Set();
    let maxRgb = 0;
    for (let offset = 0; offset < pixels.length; offset += 4) {
      colors.add(`${pixels[offset]},${pixels[offset + 1]},${pixels[offset + 2]}`);
      maxRgb = Math.max(maxRgb, pixels[offset], pixels[offset + 1], pixels[offset + 2]);
    }
    return { distinctRgb: colors.size, maxRgb };
  }
  function renderFrame(t, forcedDeltaSeconds = null) {
    let mrtCardPasses = 0;
    const frameWebglErrors = [];
    const drainFrameWebglErrors = (stage) => {
      if (!shotMode && !fullRuntimeAudit) return;
      const gl = renderer.getContext();
      for (let error = gl.getError(); error !== gl.NO_ERROR; error = gl.getError()) {
        frameWebglErrors.push({ stage, error });
      }
    };
    const now = Number.isFinite(t) ? t : 0;
    const clockFrame = fullRuntimeAudit && !["posted", "failed"].includes(fullRuntimeCaptureState)
      ? officialClock.advance(0)
      : forcedDeltaSeconds == null
        ? officialClock.tick(now)
        : officialClock.advance(forcedDeltaSeconds);
    const unityTouchQ = clockFrame.shouldUpdate
      ? updateOfficialTouchRotation(touchRotation)
      : touchRotation.rotation;
    const threeTouchQ = unityQuaternionToThree(unityTouchQ);
    targetQ.set(...threeTouchQ);
    if (window.__preview) targetQ.copy(identityQ);
    if (window.__tilt) window.__tilt.quaternion.copy(targetQ);
    if (clockFrame.shouldUpdate) {
      for (const am of animMats) am.uniforms.uTime.value = clockFrame.globalTime;
      window.__tilt?.updateWorldMatrix(true, true);
      for (const em of exactGlitMats) {
        const glitterTransform = em.userData.glitterTransform;
        if (!glitterTransform) throw new Error("exact GlitterFlowMaps material has no component transform");
        glitterTransform.getWorldQuaternion(glitterWorldQ);
        // Unity Transform.forward is local +Z. GLTF basis conversion maps that
        // local axis to Three -Z; convert the resulting world vector back at the
        // renderer-independent Unity simulation boundary.
        cardForward.set(0, 0, -1).applyQuaternion(glitterWorldQ).normalize();
        const unityForward = threeWorldForwardToUnity(cardForward.toArray());
        const flow = updateGlitterFlow(em.userData.glitterFlow, {
          forward: unityForward,
          deltaTime: clockFrame.scaledDeltaTime,
        });
        em.uniforms._FlowParams.value[0].set(...flow[0]);
        em.uniforms._FlowParams.value[1].set(...flow[1]);
      }
      for (const material of kiraPuyoMats) {
        const transform = material.userData.kiraPuyoTransform;
        if (!transform) throw new Error("Card_Scaling_Kira material has no KiraPuyoObject transform");
        transform.getWorldQuaternion(glitterWorldQ);
        cardForward.set(0, 0, 1).applyQuaternion(glitterWorldQ).normalize();
        const unityLocalFront = threeWorldForwardToUnity(cardForward.toArray());
        const values = updateKiraPuyo(material.userData.kiraPuyoState, unityLocalFront);
        material.uniforms._RampRepeat.value = values.rampRepeat;
        material.uniforms._ScrollScale.value = values.scrollScale;
        material.uniforms._ScrollOffset.value = values.scrollOffset;
        material.uniforms._KiraScale.value = values.kiraScale;
        material.uniforms._Anim.value = values.anim;
        material.userData.rendererPropertyBlockAudit = {
          schema: "pocket-card-render/renderer-property-block@1",
          producer: "KiraPuyoObject.UpdateMPB",
          unityLocalFront: [...unityLocalFront],
          values: {
            _RampRepeat: values.rampRepeat,
            _ScrollScale: values.scrollScale,
            _ScrollOffset: values.scrollOffset,
            _KiraScale: values.kiraScale,
            _Anim: values.anim,
          },
        };
      }
      for (const state of circularKiraComponents.values()) {
        const transform = state.componentTransform;
        if (!transform) throw new Error("CircularKiraObject has no component GameObject transform");
        transform.getWorldQuaternion(glitterWorldQ);
        // CircularKiraObject serializes localFront=(0,0,-1); Unity-to-GLTF handedness maps it to +Z.
        cardForward.set(0, 0, 1).applyQuaternion(glitterWorldQ).normalize();
        const unityFront = threeWorldForwardToUnity(cardForward.toArray());
        updateCircularKira(state, unityFront, clockFrame.scaledDeltaTime);
      }
    }
    function renderCard(target) {
      if (target?.textures?.length === 2) mrtCardPasses += 1;
      const traceDraws = fullRuntimeAudit
        && (fullRuntimeCaptureState === "await-neutral" || fullRuntimeCaptureState === "await-tilted");
      if (traceDraws) {
        window.__localDrawAuditTrace = [];
        window.__localDrawAuditActive = true;
      }
      try {
        drainFrameWebglErrors("before-card-render");
        renderer.setRenderTarget(target);
        renderer.render(scene, camera);
        drainFrameWebglErrors("after-card-render");
        renderer.setRenderTarget(null);
        drainFrameWebglErrors("after-card-target-detach");
      } finally {
        if (traceDraws) window.__localDrawAuditActive = false;
      }
    }
    const post = window.__post;
    if (post) {
      renderer.setClearColor(0x000000, cardDisplayContract.render_target_semantics.clear_rgba[3]);
      renderCard(post.sceneRT);
      post.apply();
      const sourcePixelProbe = shotMode ? readCenterProbe(post.sceneRT) : null;
      const cardDisplay = window.__cardDisplay;
      if (cardDisplay && !logicBisectCase.bypassHomography) {
        const viewportPoints = cardDisplay.projectedKeypoints();
        const matrices = setHomographyDisplayPoints(cardDisplay.material, viewportPoints);
        const displayPost = window.__displayPost;
        renderer.setClearColor(0x14161c, 1);
        drainFrameWebglErrors("before-homography-render");
        renderer.setRenderTarget(displayPost.sceneRT);
        renderer.render(displayScene, displayCamera);
        drainFrameWebglErrors("after-homography-render");
        renderer.setRenderTarget(null);
        drainFrameWebglErrors("after-display-target-detach");
        const pixelProbe = shotMode ? readCenterProbe(displayPost.sceneRT) : null;
        displayPost.present();
        drainFrameWebglErrors("after-display-present");
        window.__displayDiagnostics = {
          mode: detailDisplayProfile.display_mode.selected_material,
          clampParallax: detailDisplayProfile.display_mode.clamp_parallax,
          sourceSize: [post.sceneRT.width, post.sceneRT.height],
          quality: {
            requested: qualityParam,
            selected: selectedQualityProfile.quality_name,
            factor: selectedQualityProfile.quality_factor,
            requestedDisplaySide,
          },
          displayTargetSize: [displayPost.sceneRT.width, displayPost.sceneRT.height],
          sourceCameraAspect: camera.aspect,
          sourceCameraPosition: camera.position.toArray(),
          displayQuaternion: cardDisplay.mesh.quaternion.toArray(),
          homographyKeypointSpace: "ModelRenderStudio.Root",
          renderObjectQuaternion: window.__tilt?.quaternion.toArray() || identityQ.toArray(),
          vertexInput: homographyDisplayProgram.manifest.bindings.vertex_attribute.webgl2,
          viewportPoints,
          finiteMatrices: [...matrices.homography, ...matrices.inverseHomography].every(Number.isFinite),
          homography: [...matrices.homography],
          inverseHomography: [...matrices.inverseHomography],
          sourcePixelProbe,
          pixelProbe,
          webglErrors: frameWebglErrors.map((entry) => ({ ...entry })),
        };
      } else {
        post.present();
      }
    } else {
      renderCard(null);
    }
    window.__mrtDiagnostics = {
      attachments: post?.sceneRT.textures.length || 0,
      cardPasses: mrtCardPasses,
      drawCalls: renderer.info.render.calls,
    };
    captureFullRuntimeEvidence();
  }
  window.__renderShotFrames = async (count = 10, dtMs = 83) => {
    for (let i = 0; i < count; i++) renderFrame(0, dtMs * 0.001);
    await new Promise((resolve) => requestAnimationFrame(resolve));
  };
  function loop(t) {
    requestAnimationFrame(loop);
    if (window.__frameInterval && t - lastRender < window.__frameInterval) return;
    lastRender = t;
    renderFrame(t);
  }
  if (shotMode) renderFrame(performance.now());
  else requestAnimationFrame(loop);

  document.addEventListener("visibilitychange", () => {
    syncOfficialClockVisibility(officialClock, document.hidden);
  });

  addEventListener("resize", () => {
    renderer.setSize(innerWidth, innerHeight);
    window.__cardDisplay?.updateViewport();
    if (window.__post) window.__post.resize();
    if (window.__displayPost) window.__displayPost.resize();
  });
}

main().catch((e) => fail(e.stack || String(e)));
