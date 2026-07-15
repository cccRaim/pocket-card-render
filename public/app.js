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

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { SHADER, isBackgroundLayer } from "./render/rarities.js";
import { getMaterial } from "./render/registry.js";
import { makeRenderContext, setBlend, applyDepthState, applyCullState, applyStencilState, stencilWriter, applyClip, REGION } from "./render/context.js";
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
const DEFAULT_SCENE = "scene.cPK_10_000040_00_FUSHIGIBANAex_RR.json";
const fail = (m) => {   // surface load errors in the overlay instead of an endless spinner
  errEl.textContent = "ERR: " + m; console.error(m);
  if (loadingEl) { setLoading("⚠ " + m); const s = loadingEl.querySelector(".spinner"); if (s) s.style.display = "none"; }
};

// Unity Blend enum -> three factor.

// the name-adjacent "ex" glyph sprites (placed dynamically after the measured card name)
const EX_GLYPH = "/game/Assets/Lettuce/_Data/Common/CardNew/Common/UI/Textures/CardUIPokemonFormat5x5/card_icn_ex.png";
const EX_GLYPH_OUTLINE = "/game/Assets/Lettuce/_Data/Common/CardNew/Common/UI/Textures/CardUIPokemonFormat5x5/card_icn_ex_outline.png";

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
  return Promise.all([...new Set(families)].filter((f) => fontFiles[f] && !_fontLoaded.has(f)).map((f) => {
    const ff = new FontFace(f, `url(${fontFiles[f]})`);
    return ff.load().then((x) => { document.fonts.add(x); _fontLoaded.add(f); }).catch((e) => console.warn("font fail", f, e));
  }));
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
function loadEnvCube(url) {
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
      cube.colorSpace = THREE.NoColorSpace; cube.needsUpdate = true;
      res(cube);
    };
    img.onerror = () => { console.warn("env cube fail", url); res(null); };
    img.src = url;
  });
}

function buildDynamicUITexture(cardUI, face) {
  const [W, H] = cardUI.canvasWH;
  const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
  const ctx = cv.getContext("2d");
  const foilCv = document.createElement("canvas"); foilCv.width = W; foilCv.height = H;   // ex-foil mask
  const foilCtx = foilCv.getContext("2d");
  function makeHoloDynamicCanvas(src) {
    const out = document.createElement("canvas"); out.width = src.width; out.height = src.height;
    const sctx = src.getContext("2d"), octx = out.getContext("2d");
    const im = sctx.getImageData(0, 0, src.width, src.height);
    const d = im.data;
    for (let i = 0; i < d.length; i += 4) {
      const coverage = d[i + 3] / 255;
      d[i] = Math.round(d[i] * coverage);
      d[i + 1] = Math.round(d[i + 1] * coverage);
      d[i + 2] = Math.round(d[i + 2] * coverage);
      d[i + 3] = Math.round((1 - coverage) * 255);
    }
    octx.putImageData(im, 0, 0);
    return out;
  }
  const faceEls = (face && face.elements) || [];
  const loadImg = (url) => new Promise((res) => {
    const i = new Image(); i.crossOrigin = "anonymous"; i.onload = () => res(i); i.onerror = () => { console.warn("ui tex fail", url); res(null); }; i.src = url;
  });
  const urls = new Set([EX_GLYPH, EX_GLYPH_OUTLINE]);
  cardUI.elements.forEach((e) => urls.add(e.url));
  faceEls.forEach((e) => { if (e.kind === "icon") urls.add(e.url); });

  function drawSprite(e, img, target) {                // card_ui.json image element (tint / contain / stretch)
    target = target || ctx;
    if (!img) return;
    const b = e.box, bx = b.l * W, by = b.t * H, bw = (b.r - b.l) * W, bh = (b.b - b.t) * H;
    let src = img;
    if (e.color) {                                      // tint to the UI Image m_Color (ex-rule title text)
      const t = document.createElement("canvas"); t.width = img.width; t.height = img.height;
      const tc = t.getContext("2d"); tc.drawImage(img, 0, 0);
      tc.globalCompositeOperation = "source-in";
      tc.fillStyle = `rgba(${(e.color[0]*255)|0},${(e.color[1]*255)|0},${(e.color[2]*255)|0},${e.color[3]})`;
      tc.fillRect(0, 0, img.width, img.height); src = t;
    }
    if (e.fit === "contain") {                          // preserve aspect, center in box (pre-evo / energy icon)
      const s = Math.min(bw / img.width, bh / img.height), dw = img.width * s, dh = img.height * s;
      target.drawImage(src, bx + (bw - dw) / 2, by + (bh - dh) / 2, dw, dh);
    } else {
      target.drawImage(src, bx, by, bw, bh);
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
  function parseRuns(text) {
    const runs = []; let bold = false, cur = "";
    const flush = () => { if (cur) runs.push({ t: cur, bold }); cur = ""; };
    for (const ch of text) {
      if (ch === "\x01" || ch === "\x02") { flush(); bold = (ch === "\x01"); }
      else if (ch === "\x03") { flush(); runs.push({ img: "ex", bold }); }
      else cur += ch;
    }
    flush();
    return runs;
  }
  const runFont = (e, bold, fs) => bold ? `${curWeights.name} ${fs}px "${curFonts.name}", "${curFonts.body}", sans-serif` : faceFont(e.font, fs);
  // word-wrap over runs: latin words stay whole, CJK breaks per char; first line shortened by `indent`.
  // an image run (inline ex glyph) is one non-breaking token sized fs·exAR wide.
  function wrapRuns(runs, e, fs, maxW, indent, exAR) {
    const toks = [];
    for (const r of runs) {
      if (r.img) { toks.push({ img: r.img, bold: r.bold }); continue; }
      // honour EXPLICIT newlines (\n) in the source string as HARD breaks (the masterdata rule separates its
      // effects with \n\n\n) — split on \n into a `br` token, else they'd tokenize as whitespace and be dropped.
      r.t.split("\n").forEach((seg, i) => {
        if (i > 0) toks.push({ br: true });
        for (const p of (seg.match(/\s+|[A-Za-z0-9À-ÿ.,;:!?'"()%·\-]+|[^\s]/g) || [])) toks.push({ t: p, bold: r.bold });
      });
    }
    const lines = [[]]; let lw = 0, avail = maxW - indent;
    for (const tk of toks) {
      if (tk.br) { lines.push([]); lw = 0; avail = maxW; continue; }   // hard line break
      const w = tk.img ? fs * (exAR || 1.6) : (ctx.font = runFont(e, tk.bold, fs), ctx.measureText(tk.t).width);
      const cur = lines[lines.length - 1];
      if (lw + w > avail && cur.some((s) => s.t.trim())) {
        lines.push([]); lw = 0; avail = maxW;
        if (/^\s+$/.test(tk.t)) continue;
      }
      lines[lines.length - 1].push(tk); lw += w;
    }
    return lines;
  }

  // TMP SDF outline → canvas stroke. Outward thickness(px) = fs · OutlineWidth · GradientScale/pointSize (=10/40);
  // canvas strokeText is centred on the path (half hidden under the fill) so lineWidth = 2× that = fs·width·0.5.
  function outlineFor(e, fs) {
    if (!e.outline || !e.outline.width) return null;
    const oc = e.outline.color || [1, 1, 1, 1];
    return { lw: fs * e.outline.width * 0.5, css: `rgba(${(oc[0]*255)|0},${(oc[1]*255)|0},${(oc[2]*255)|0},${oc[3] ?? 1})` };
  }
  function drawText(e, imap) {
    let fs = e.fs; const b = e.box, va = e.valign || "middle";
    const runs = parseRuns(e.text);
    const exImg = imap && imap.get(EX_GLYPH);                          // inline ex glyph (for [Img:ex] in body text)
    const exAR = exImg ? exImg.width / exImg.height : 1.6;
    if (e.wrap) {                                       // multi-line: wrap to box width, shrink to fit box height
      const boxW = (b.r - b.l) * W, boxH = (b.b - b.t) * H, indentPx = (e.indent || 0) * W;
      const c = e.color; ctx.fillStyle = `rgba(${(c[0]*255)|0},${(c[1]*255)|0},${(c[2]*255)|0},${c[3] ?? 1})`;
      ctx.textAlign = "left"; ctx.textBaseline = "top";
      let lines, lh;
      for (; ; fs -= 0.5) { lines = wrapRuns(runs, e, fs, boxW, indentPx, exAR); lh = fs * 1.18; if (lines.length * lh <= boxH || fs <= (e.fsmin || 6)) break; }
      // TMP Valign: Bottom anchors the block bottom at box.b; Middle centres the block in the box (the rule body
      // box is tall and the text is V=Middle → sits at the box centre, not the top); else Top.
      const blockH = lines.length * lh;
      let yy = va === "bottom" ? b.b * H - blockH
             : va === "middle" ? (b.t + b.b) / 2 * H - blockH / 2
             : b.t * H;
      const ol = outlineFor(e, fs);                     // white SDF outline (drawn under each glyph)
      for (let i = 0; i < lines.length; i++) {
        let xx = b.l * W + (i === 0 ? indentPx : 0);
        for (const seg of lines[i]) {
          if (seg.img) {                                // inline ex glyph: black (body-text colour), on the text line
            const eh = fs, ew = eh * exAR;
            if (exImg) ctx.drawImage(tint(exImg, e.color), xx, yy + lh - eh - fs * 0.12, ew, eh);
            xx += ew;
          } else {
            ctx.font = runFont(e, seg.bold, fs);
            if (ol) { ctx.lineWidth = ol.lw; ctx.strokeStyle = ol.css; ctx.lineJoin = "round"; ctx.miterLimit = 2; ctx.strokeText(seg.t, xx, yy); }
            ctx.fillText(seg.t, xx, yy); xx += ctx.measureText(seg.t).width;
          }
        }
        yy += lh;
      }
      return;
    }
    if (e.text.indexOf("\x01") >= 0 || e.text.indexOf("\x03") >= 0) e = { ...e, text: runs.map((r) => r.t || "").join("") };  // strip sentinels/inline-img for plain draw
    // TMP auto-sizing: shrink the font from fs down to fsmin so the text fits its box width (long translations)
    if (e.autosize) {
      const boxW = (b.r - b.l) * W;
      if (boxW > 1) {
        ctx.font = faceFont(e.font, fs);
        const tw = ctx.measureText(e.text).width;
        if (tw > boxW) fs = Math.max(e.fsmin || fs * 0.1, fs * boxW / tw);
      }
    }
    ctx.font = faceFont(e.font, fs);
    ctx.textAlign = e.align;
    const x = e.align === "right" ? b.r * W : e.align === "center" ? (b.l + b.r) / 2 * W : b.l * W;
    // TMP vertical alignment: Middle centres the GLYPH INK bounds at the box centre (NOT the em box — canvas
    // "middle" uses the em box, which drops symbols like "+" below the digit line). Compute the baseline from
    // the actual ink metrics so "+" and "20" (and all numerals) sit consistently.
    let y;
    if (va === "bottom") { ctx.textBaseline = "alphabetic"; y = b.b * H - fs * 0.12; }
    else if (va === "top") { ctx.textBaseline = "top"; y = b.t * H; }
    else {
      ctx.textBaseline = "alphabetic";
      const mm = ctx.measureText(e.text);
      const ia = mm.actualBoundingBoxAscent || fs * 0.7, id = mm.actualBoundingBoxDescent || 0;
      y = (b.t + b.b) / 2 * H + (ia - id) / 2;          // ink-centre at the box centre
    }
    const c = e.color;
    ctx.fillStyle = `rgba(${(c[0]*255)|0},${(c[1]*255)|0},${(c[2]*255)|0},${c[3] ?? 1})`;
    const ol = outlineFor(e, fs);                        // white SDF outline under the glyph (full-art text)
    if (ol) { ctx.lineWidth = ol.lw; ctx.strokeStyle = ol.css; ctx.lineJoin = "round"; ctx.miterLimit = 2; ctx.strokeText(e.text, x, y); }
    ctx.fillText(e.text, x, y);
    if (e.exAfter) {                                    // PokemonCardNameView.UpdateExLayout (byte-traced):
      const mn = ctx.measureText(e.text);                //   ex.anchoredPosition.x = min(nameWidth, _textMaxWidthForEx)
      // use the INK right edge (not the advance width) so the ex follows the VISIBLE name end — the advance
      // includes the last glyph's right side-bearing, which made the name↔ex gap look a touch wide for latin names.
      const nw = (mn.actualBoundingBoxRight != null && mn.actualBoundingBoxRight > 0) ? mn.actualBoundingBoxRight : mn.width;
      const ex = imap.get(EX_GLYPH), exo = imap.get(EX_GLYPH_OUTLINE);
      if (ex) {
        const exH = (e.exH ? e.exH * H : fs * 0.95), ar = ex.width / ex.height, exW = exH * ar;  // size from prefab box
        const maxW = (e.exMaxW ?? 0.41) * W;           // _textMaxWidthForEx (300) — clamp for very long names
        const nameMidY = (b.t + b.b) / 2 * H;          // ex centred on the name box centre (y is now the baseline)
        // Official PokemonCardNameView.UpdateExLayout anchors the glyph to name_elm, not card_name_txt:
        // _ex.anchoredPosition.x = min(nameWidth, _textMaxWidthForEx).
        const x0 = (e.exAnchorX ?? b.l) * W + Math.min(nw, maxW), yTop = nameMidY - exH / 2;
        if (exo) ctx.drawImage(exo, x0, yTop, exW, exH);
        ctx.drawImage(ex, x0, yTop, exW, exH);
        foilCtx.drawImage(ex, x0, yTop, exW, exH);      // the ex glyph foils → into the mask
      }
    }
  }

  // HP: hp_elm's HorizontalLayoutGroup (LowerRight) — number right-aligned at the container right edge, the
  // localized label (HP/PS/PV/KP) just to its left, both sitting on the container bottom (shared baseline).
  function drawHP(e) {
    // hp_elm HorizontalLayoutGroup (LowerRight): number right-aligned at hp_elm.r, vertically centred (Valign=Middle).
    // label = center-aligned in a 30px cell whose right edge sits one spacing left of the number, and nudged down
    // by hp_txt's ap.y (=8px) so the small label baseline-aligns with the big number.
    const b = e.box, midY = (b.t + b.b) / 2 * H, rx = b.r * W, c = e.color;
    ctx.fillStyle = `rgba(${(c[0]*255)|0},${(c[1]*255)|0},${(c[2]*255)|0},${c[3] ?? 1})`;
    ctx.textBaseline = "middle";
    ctx.textAlign = "right"; ctx.font = faceFont(e.font, e.numFs); ctx.fillText(e.num, rx, midY);
    const numW = ctx.measureText(e.num).width;
    const cellRight = rx - numW - (e.spacing || 0) * W, cellCenter = cellRight - (e.labelCellW || 0) * W / 2;
    ctx.textAlign = "center"; ctx.font = faceFont(e.font, e.labelFs);
    ctx.fillText(e.label, cellCenter, midY + (e.labelDY || 0));
  }

  return Promise.all([...urls].map((u) => loadImg(u).then((img) => [u, img]))).then((pairs) => {
    const imap = new Map(pairs);
    return (document.fonts ? document.fonts.ready : Promise.resolve()).then(() => {
      // 1. sprite layers (UGUI hierarchy order: children paint after parents = back-to-front). Ex-rule banner
      //    sprites are also drawn into the foil mask.
      cardUI.elements.slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).forEach((e) => {
        const img = imap.get(e.url); drawSprite(e, img);
        if (isFoilSprite(e)) drawSprite(e, img, foilCtx);
      });
      // 2. energy icons (contain-fit), then 3. text on top (drawText also feeds the ex glyph into the foil mask)
      faceEls.filter((e) => e.kind === "icon").forEach((e) => drawSprite({ ...e, fit: e.fit || "contain" }, imap.get(e.url)));
      faceEls.filter((e) => e.kind === "text").forEach((e) => drawText(e, imap));
      faceEls.filter((e) => e.kind === "hp").forEach((e) => drawHP(e));
      const mk = (canvas) => { const t = new THREE.CanvasTexture(canvas); t.colorSpace = THREE.NoColorSpace; t.flipY = window.__uiflipy ?? false; t.anisotropy = 4; return t; };
      return { ui: mk(cv), holo: mk(makeHoloDynamicCanvas(cv)), foil: mk(foilCv) };
    });
  });
}

function compactCardName(name) {
  return String(name || "").replace(/ex$/i, " ex").replace(/_/g, " ");
}

function sceneLabel(scene, repeatedIds, lc) {
  const localized = scene.names && scene.names[lc];
  const bits = [localized || compactCardName(scene.name)];
  if (scene.rarityToken) bits.push(scene.rarityToken);
  if (repeatedIds.has(scene.id || scene.name)) bits.push(scene.file.replace(/\.json$/i, ""));
  return bits.filter(Boolean).join(" · ") || scene.file;
}

async function main() {
  // ?scene=scene.<cardId>.json renders an alternate prebuilt card.
  // debug URL params (for headless screenshots): ?only=<substr> solos layers, ?nohud hides the overlays.
  const qp = new URLSearchParams(location.search);
  // ?card=<illustrationId> builds the scene DYNAMICALLY for any card (server /scene). ?scene=<file> still works
  // (a prebuilt scene). Missing scene files fall back to the first prebuilt scene returned by /scenes.
  const cardParam = qp.get("card");
  const sceneList = await fetch("/scenes")
    .then((r) => r.ok ? r.json() : null)
    .then((j) => (j && Array.isArray(j.scenes)) ? j.scenes : [])
    .catch(() => []);
  const requestedScene = qp.get("scene");
  const firstSceneFile = sceneList[0]?.file || DEFAULT_SCENE;
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
  const exactEnabled = (name) => !exactAllOff && !exactDisabled.has(name);
  const shotMode = qp.has("shot");
  const frameCap = Number(qp.get("fps") || 0);
  window.__frameInterval = Number.isFinite(frameCap) && frameCap > 0 ? 1000 / frameCap : 0;
  if (qp.has("nohud")) { window.__nohud = true; if (errEl) errEl.style.display = "none"; }
  const scene_data = await fetch(sceneSrc).then((r) => r.json());
  const hasOfficialEmissive = !qp.has("nobloom") && Object.values(scene_data.materials || {}).some((m) => {
    const p = m.floats?._EmissivePattern ?? 0;
    const e = m.colors?._EmissiveColor;
    const rgb = e ? Math.max(e.r || 0, e.g || 0, e.b || 0) : 0;
    return rgb > 0 && (p > 0 || m.shader === "Opaque-UR-Oklab");
  });
  const currentSceneFile = cardParam ? "" : sceneSrc.replace(/^\.?\//, "");
  // ── locale: load per-language content + fonts from locales/manifest.json (falls back to the legacy single files) ──
  const manifest = await fetch("locales/manifest.json").then((r) => r.json()).catch(() => null);
  let curLoc = qp.get("lc") || (manifest && manifest.default) || "zh_TW";
  if (manifest && manifest.locales && !manifest.locales.some((l) => l.lc === curLoc)) curLoc = manifest.default || "zh_TW";
  async function loadLocaleData(lc) {
    const ui = await fetch(`locales/card_ui.${lc}.json`).then((r) => r.json()).catch(() => null);
    const face = await fetch(`locales/card_face.${lc}.json`).then((r) => r.json()).catch(() => null);
    const lm = manifest && manifest.locales.find((l) => l.lc === lc);
    if (lm) { curFonts = lm.fonts; if (lm.weights) curWeights = lm.weights; await loadFonts(manifest.fontFiles, Object.values(lm.fonts)); }
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
  // "default" = the card the prebuilt cardUI/card_face was baked for (Venusaur, card_ui.json.card). Keyed on the
  // card IDENTITY (not the scene filename) so it holds whether loaded via a prebuilt scene OR ?card=. Any OTHER card is
  // composed dynamically from masterdata+locale via /compose.
  const isDefaultCard = !!(cardUI && cardUI.card && mdId === cardUI.card);
  // DynamicUI (the L_FullFace_Text overlay). Built GENERICALLY for ANY card: the default Venusaur uses the
  // prebuilt cardUI/cardFace; any other card is composed DYNAMICALLY from masterdata+locale via /compose
  // (server runs carddata.mjs + compose.mjs — no per-card offline pre-gen, no _UT bake).
  async function buildFace(lc) {
    if (isDefaultCard && cardUI && cardUI.elements && cardUI.elements.length) return buildDynamicUITexture(cardUI, cardFace);
    if (!mdId) return null;
    // prefer the prebaked static composed-text file (public/text/<mdId>.<lc>.json); fall back to the live
    // /compose endpoint (advanced — only works if you run the server with your own masterdata).
    const composeUrl = `/compose?id=${mdId}&lc=${lc}&ill=${encodeURIComponent(scene_data.card.id || "")}`;
    let composed = null;
    if (mdId.startsWith("PK_")) composed = await fetch(composeUrl).then((r) => r.ok ? r.json() : null).catch(() => null);
    if (!composed) composed = await fetch(`text/${mdId}.${lc}.json`).then((r) => r.ok ? r.json() : null).catch(() => null);
    if (!composed && !mdId.startsWith("PK_")) composed = await fetch(composeUrl).then((r) => r.ok ? r.json() : null).catch(() => null);
    if (!composed || !composed.elements || !composed.elements.length) return null;
    return buildDynamicUITexture({ canvasWH: composed.canvasWH, elements: [] }, { elements: composed.elements });
  }
  let dynTex = await buildFace(curLoc);
  const dynUITex = dynTex && dynTex.ui;       // full UI text canvas (mapped onto the L_FullFace_Text quad)
  const dynHoloTex = dynTex && dynTex.holo;   // DynamicUI encoded like the game's holo RT (alpha inverted)
  const foilTex = dynTex && dynTex.foil;      // ex-foil mask (only the ex glyph + ex-rule banner)
  // real environment cubemap for the holo/foil reflections (samplerCube, not a 2D matcap)
  const envCubeUrl = (Object.values(scene_data.materials).find((m) => m.textures && m.textures._CubeMap) || {}).textures?._CubeMap?.url;
  const envCubeTex = envCubeUrl ? await loadEnvCube(envCubeUrl) : null;

  // EXACT glitter: the REAL game vertex+fragment bytecode transpiled by SPIRV-Cross (tools/render/build_exact_
  // glitter.py), run verbatim as a three.js RawShaderMaterial. Loaded once; null if absent → falls back to the hand
  // port. (data-verified faithful: tools/render/shaderdec/sc_port_check.py max|err|=0.)
  const exactGlit = exactEnabled("Card_UR_Glitter_FlowMaps") ? await Promise.all([
    fetch("shaders/glitter.vert.glsl").then((r) => r.ok ? r.text() : null).catch(() => null),
    fetch("shaders/glitter.frag.glsl").then((r) => r.ok ? r.text() : null).catch(() => null),
  ]).then(([vert, frag]) => (vert && frag) ? { vert, frag } : null) : null;
  async function loadExactShaderPorts(spec) {
    const out = {};
    await Promise.all(Object.entries(spec).map(async ([name, files]) => {
      if (!exactEnabled(name)) return;
      const [vert, frag] = await Promise.all([
        fetch(files.vert).then((r) => r.ok ? r.text() : null).catch(() => null),
        fetch(files.frag).then((r) => r.ok ? r.text() : null).catch(() => null),
      ]);
      if (vert && frag) out[name] = { vert, frag };
    }));
    return out;
  }
  const exactShaders = await loadExactShaderPorts({
    Card_Illust: { vert: "shaders/card_illust.vert.glsl", frag: "shaders/card_illust.frag.glsl" },
    Frame: { vert: "shaders/textured.vert.glsl", frag: "shaders/frame.frag.glsl" },
    "Simple-Opaque": { vert: "shaders/textured.vert.glsl", frag: "shaders/simple_opaque.frag.glsl" },
    "Simple-Transparent": { vert: "shaders/textured.vert.glsl", frag: "shaders/simple_transparent.frag.glsl" },
    Effect: { vert: "shaders/effect.vert.glsl", frag: "shaders/effect.frag.glsl" },
    Card_Parallax: { vert: "shaders/card_parallax.vert.glsl", frag: "shaders/card_parallax.frag.glsl" },
    Card_Parallax_Metal: { vert: "shaders/card_parallax_metal.vert.glsl", frag: "shaders/card_parallax_metal.frag.glsl" },
    Card_Parallax_UR: { vert: "shaders/parallax_ur.vert.glsl", frag: "shaders/parallax_ur.frag.glsl" },
  });
  const exactGlitMats = [];   // RawShaderMaterials needing per-frame time/rotation

  const canvas = document.getElementById("c");
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, stencil: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  // The decompiled card shaders do their own color-domain work (UR/Oklab paths explicitly call
  // srgbToLinear/linearToSrgb around Oklab math), so texture samples must arrive as the same raw values the
  // shader bytecode expects. Keep the card-sheet RT/blit path raw as well; display conversion is shader-owned.
  const cardTargetColorSpace = THREE.NoColorSpace;
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.setClearColor(0x14161c, 1);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, innerWidth / innerHeight, 0.01, 100);

  function makeBloomPass(hasBloom) {
    const rtColorSpace = cardTargetColorSpace;
    const ds = renderer.getDrawingBufferSize(new THREE.Vector2());
    const w = Math.max(1, ds.x || innerWidth), h = Math.max(1, ds.y || innerHeight);
    const bw = Math.max(1, Math.floor(w / 2)), bh = Math.max(1, Math.floor(h / 2));
    const sceneRT = new THREE.WebGLRenderTarget(w, h, { stencilBuffer: true, samples: 4 });
    const emissiveRT = new THREE.WebGLRenderTarget(bw, bh, { stencilBuffer: true });
    const bloomA = new THREE.WebGLRenderTarget(bw, bh, { depthBuffer: false, stencilBuffer: false });
    const bloomB = new THREE.WebGLRenderTarget(bw, bh, { depthBuffer: false, stencilBuffer: false });
    for (const rt of [sceneRT, emissiveRT, bloomA, bloomB]) rt.texture.colorSpace = rtColorSpace;
    const postScene = new THREE.Scene();
    const postCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    quad.frustumCulled = false; postScene.add(quad);
    const vs = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
    const blur = new THREE.ShaderMaterial({
      uniforms: { rt: { value: emissiveRT.texture }, uTexel: { value: new THREE.Vector2(1 / bw, 1 / bh) }, uDir: { value: new THREE.Vector2(1, 0) } },
      vertexShader: vs,
      fragmentShader: `
        uniform sampler2D rt; uniform vec2 uTexel, uDir; varying vec2 vUv;
        void main() {
          vec2 d = uTexel * uDir;
          vec3 c = texture2D(rt, vUv).rgb * 0.227027;
          c += texture2D(rt, vUv + d * 1.384615).rgb * 0.316216;
          c += texture2D(rt, vUv - d * 1.384615).rgb * 0.316216;
          c += texture2D(rt, vUv + d * 3.230769).rgb * 0.070270;
          c += texture2D(rt, vUv - d * 3.230769).rgb * 0.070270;
          gl_FragColor = vec4(c, 1.0);
        }`,
      depthTest: false, depthWrite: false, toneMapped: false,
    });
    const composite = new THREE.ShaderMaterial({
      uniforms: { rt: { value: sceneRT.texture }, bloom: { value: bloomB.texture }, uBloom: { value: 1.0 } },
      vertexShader: vs,
      fragmentShader: `
        uniform sampler2D rt, bloom; uniform float uBloom; varying vec2 vUv;
        vec3 pcrLinearToSrgb(vec3 c) {
          c = max(c, vec3(0.0));
          vec3 lo = c * 12.9200000763;
          vec3 hi = pow(c, vec3(0.4166666567)) * 1.0549999475 - 0.055;
          return mix(lo, hi, step(vec3(0.0031308001), c));
        }
        void main() {
          vec4 base = texture2D(rt, vUv);
          vec3 glow = texture2D(bloom, vUv).rgb * uBloom;
          gl_FragColor = vec4(pcrLinearToSrgb(base.rgb + glow), base.a);
        }`,
      depthTest: false, depthWrite: false, toneMapped: false,
    });
    const resize = () => {
      const s = renderer.getDrawingBufferSize(new THREE.Vector2());
      const nw = Math.max(1, s.x || innerWidth), nh = Math.max(1, s.y || innerHeight);
      const nbw = Math.max(1, Math.floor(nw / 2)), nbh = Math.max(1, Math.floor(nh / 2));
      sceneRT.setSize(nw, nh); emissiveRT.setSize(nbw, nbh); bloomA.setSize(nbw, nbh); bloomB.setSize(nbw, nbh);
      blur.uniforms.uTexel.value.set(1 / nbw, 1 / nbh);
    };
    composite.uniforms.uBloom.value = hasBloom ? 1.0 : 0.0;
    return { sceneRT, emissiveRT, bloomA, bloomB, postScene, postCamera, quad, blur, composite, resize, hasBloom };
  }

  // ── texture preload with straight/premultiplied detection ──
  // We never rely on GPU premultiply (flaky). Instead we detect each texture's alpha mode and
  // pick blend factors: straight-alpha (transparent stored bright, e.g. L_AM) -> SrcAlpha/…,
  // already-premultiplied (transparent stored black, e.g. L_ILL) -> One/…. Same over result.
  // alpha mode comes from the build (build/detect_alpha.py with PIL — reliable, unlike canvas).
  const alphaMode = scene_data.alphaMode || {};
  const texInfo = new Map();                 // name -> { tex, straight }
  function preloadTextures(urlMap) {
    const entries = Object.entries(urlMap); let done = 0;
    const tick = () => { done++; setLoading(`Loading textures… ${done}/${entries.length}`); };
    return Promise.all(entries.map(([name, url]) => new Promise((res) => {
      const img = new Image(); img.crossOrigin = "anonymous";
      img.onload = () => {
        const tex = new THREE.Texture(img);
        tex.colorSpace = scene_data.textureColorSpace?.[name] === 1 ? THREE.SRGBColorSpace : THREE.NoColorSpace;
        tex.flipY = false; tex.anisotropy = 4;
        tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping; tex.needsUpdate = true;
        texInfo.set(name, { tex, straight: alphaMode[name] === "straight" });
        tick(); res();
      };
      img.onerror = () => { console.warn("tex fail", url); tick(); res(); };
      img.src = url;
    })));
  }

  const animMats = [];

  setLoading("Loading textures…");
  await preloadTextures(scene_data.textures);
  // RenderContext: the runtime deps every material strategy needs (resolved textures, env cubemap,
  // per-frame animation lists, the DynamicUI foil). Built once, after textures load.
  const exHoloMats = [];   // EX-foil materials (the language switch swaps their dynUI/foil textures)
  const ctx = makeRenderContext({ texInfo, envCubeTex, exactGlit, exactShaders, animMats, exactGlitMats, dynUITex, dynHoloTex, foilTex, exHoloMats });

  const ORIENT_Y = window.__oy ?? 1;   // glb already does Unity->glTF axis conversion; no extra flip
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
    const cardGroup = new THREE.Group();
    cardGroup.scale.y = ORIENT_Y;
    cardGroup.scale.x = window.__ox ?? -1;   // glb comes in X-mirrored (Unity LH->glTF negate-X); flip back
    // The UR gold-foil BACKGROUND stack (parallax base + holo + glitter UNDER a semi-transparent Uzumaki plate)
    // can't be drawn under the illustration via three.js's opaque/transparent pass split. So it goes in its OWN
    // group, pre-rendered to an off-screen RT in queue order (no illustration there → the plate's transparency
    // reveals the layers beneath), then shown as a fullscreen background while fgGroup (everything else) draws on
    // top. bgGroup empty (non-UR) → the RT pass is skipped, normal render. Both groups inherit cardGroup's tilt.
    const bgGroup = new THREE.Group(), fgGroup = new THREE.Group(), stencilGroup = new THREE.Group();
    cardGroup.add(stencilGroup); cardGroup.add(fgGroup); cardGroup.add(bgGroup);   // stencilGroup stays visible in BOTH passes (clips the bg layers to the card shape)

    let built = 0, deferred = 0, writers = 0, skipped = 0;
    const builtMeshes = [], bloomMeshes = [];
    let dynUIMat = null;
    const ONLY = window.__only || "";
    // All layers (flat + depth diorama) render together (rotated) to the RT; the game's HOMOGRAPHY (computed
    // from the card's 4 corners, post-rotation → fixed rectangle) then corrects the shape so nothing swings,
    // while the off-plane layers' parallax (the 3D depth feel) is preserved. So no per-layer swing hacks here.
    root.traverse((o) => {
      if (!o.isMesh) return;
      const matName = (o.material && o.material.name) || "";
      if (ONLY && !/Stencil/.test(matName) && !matName.includes(ONLY)) return;

      // stencil writers (by material name; InnerStencil_Window for Pokémon, InnerStencil_Trainers for trainers)
      if (matName === "OuterStencil" || matName.startsWith("InnerStencil")) {
        const region = matName.startsWith("InnerStencil") ? REGION.window : REGION.card;
        const mw = new THREE.Mesh(o.geometry, stencilWriter(region));
        mw.applyMatrix4(o.matrixWorld); mw.renderOrder = -100; mw.frustumCulled = false; stencilGroup.add(mw); writers++; return;
      }
      // DynamicUI quad (Card_Base_UI mesh, material L_FullFace_Text): the per-card UGUI content
      // (pre-evo image, ex-rule banner, …) composited into a canvas → mapped onto this full-card-face
      // quad (UV 0..1). Drawn as an overlay over the card content. build.mjs skips this material, so
      // intercept by name here.
      if (matName === "L_FullFace_Text") {
        if (!dynUITex) { skipped++; return; }
        const m = new THREE.MeshBasicMaterial({ map: dynUITex, side: THREE.DoubleSide, toneMapped: false });
        dynUIMat = m;                                  // keep ref for the language switch
        setBlend(m, "over", true);                    // straight-alpha over (transparent canvas bg)
        applyClip(m, window.__raw ? null : "card");
        const mesh = new THREE.Mesh(o.geometry, m);
        mesh.applyMatrix4(o.matrixWorld); mesh.renderOrder = 2900; mesh.frustumCulled = false;
        mesh.userData.label = "DynamicUI (card_ui.json)";
        fgGroup.add(mesh); builtMeshes.push(mesh); built++; return;
      }
      const r = materials[matName];
      if (!r) { skipped++; return; }                 // DefaultMaterial / dynamic-UI / unknown
      const cfg = SHADER[r.shader];
      if (!cfg || cfg.defer) { deferred++; return; }  // metal (no-op), card back/edges, LOD

      // dispatch by kind → the registered material strategy (Strategy + Registry pattern). requires()
      // gates whether the layer renders; build() returns the three.js material (sets userData.straight).
      const strat = getMaterial(cfg.kind);
      if (!strat || !strat.requires(r, ctx)) { skipped++; return; }
      const mat = strat.build(r, ctx);
      if (!mat) { skipped++; return; }
      const straight = !!mat.userData.straight;
      const fullFaceHolo = !!mat.userData.fullFaceHolo;
      if (cfg.alphaTest && mat.isMeshBasicMaterial) mat.alphaTest = cfg.alphaTest;
      // Some official shaders use material-controlled blend factors (_SrcFactor/_DstFactor).
      setBlend(mat, cfg.blend, straight, cfg.materialBlend ? r.floats : undefined);
      if (!window.__raw) applyStencilState(mat, r);
      applyDepthState(mat, r.floats);
      applyCullState(mat, r.floats, cfg.cull ?? 2, cfg.materialCull);
      // The shadowbox (SBM2/SBM4) is a real 3D DIORAMA with Z-depth — not a flat coplanar layer. The
      // painter's-order hack (depthTest off) makes its layered planes overlap in arbitrary mesh order →
      // the depth looks inverted (concave) with seam LINES. Give the SB real depth testing so its own
      // geometry resolves correctly (near occludes far = convex). Opaque SBM2 writes depth; SBM4 tests only.
      const isSB = r.shader === "Simple-Opaque-Hologram_Tuning" || r.shader === "Simple-Transparent"
                || r.shader === "Opaque-Hologram_Tuning"     // trainer SR shadowbox (same diorama mesh)
                || r.shader === "Opaque-UR-Oklab";           // UR shadowbox (same diorama mesh, Oklab colour)
      // SB is a 3D diorama → give it real depth testing (so its layers resolve, no seam lines). It stays in
      // the live cardGroup, so KEEP its stencil clip (applyClip above) — without it the SB draws unclipped.
      if (isSB) { mat.depthTest = true; mat.depthWrite = (cfg.blend === "opaque"); }   // opaque SB pass writes depth
      // Non-SB layers that carry _ZTest/_ZWrite now use those material-controlled official states.
      // Layers without explicit depth floats keep setBlend's painter-order default.
      // SB diorama is built facing -Z (normals point away from the +Z camera) → its depth reads inverted
      // (bulges INTO the card). Flip the SB's local Z about its own centre so it pops TOWARD the viewer
      // (convex). Other layers are flat quads (z≈0) → the flip is a visual no-op for them, so SB-only.
      let geom = o.geometry;
      if (isSB) { geom = o.geometry.clone(); geom.scale(1, 1, -1); }
      const mesh = new THREE.Mesh(geom, mat);
      mesh.applyMatrix4(o.matrixWorld);
      // Z-CONVENTION FIX (the real root cause): the card FRONT faces -Z in the glb (ILL normal=-Z; the back
      // L_Card_R_M normal=+Z) — we view it from the BACK (+Z) via DoubleSide + scale.x=-1. The depth diorama
      // (SB + effects, z=-0.03..-0.075) pops toward -Z = the FRONT (toward the real card's viewer). From our
      // +Z camera that reads INVERTED → it looked recessed/"swinging". Reflect the depth layers about the card
      // plane (z≈-0.005) so they pop toward OUR camera = float UP, as the data intends. (SB also has its
      // internal geometry z mirrored above.) Effects then float; SB pops convex — both per the data, no hacks.
      // Reflect EVERY off-plane layer (incl. effects) about the card plane so its depth matches our +Z camera.
      // The effects carry real per-layer glb z (EFM1=-0.075 front … EFM3=-0.03 back, straddling the SB at
      // -0.041): in Unity, MORE-negative z = closer to the viewer. Reflecting maps that to our camera so EFM1/
      // EFM2 land IN FRONT of the character and EFM3 BEHIND it — then depthTest sorts them by real z. (Earlier
      // this excluded effects, which left ALL of them behind the SB: EFM3 looked right by luck, EFM1/2 wrong.)
      if (Math.abs(o.matrixWorld.elements[14]) > 0.015) mesh.position.z = -0.01 - mesh.position.z;
      // EX foil shimmers ON TOP of the DynamicUI banner/badge (drawn at 2900), so lift it above.
      // The SB is a 3D diorama that POPS toward the viewer; on a tilt its silhouette can recede in z and lose the
      // back-to-front sort tie against COPLANAR frame/panel layers at the same queue (q2400) → the nameplate then
      // clips the character's head. Nudge the SB +6 so it always sits just above those coplanar layers, while
      // still BELOW the foreground effects (q2500) and UI overlays. (Painter's-order stand-in for the real depth
      // pop-out.) renderOrder = real queue otherwise.
      mesh.renderOrder = (cfg.kind === "exHolo" && !fullFaceHolo) ? 2950 : isSB ? r.queue + 6 : r.queue;
      mesh.frustumCulled = false;
      mesh.userData.label = `${matName}  ·  ${r.shader}  ·  q${mesh.renderOrder}`;
      builtMeshes.push(mesh);
      if (mat.userData?.bloomSource && mat.uniforms?.uBloomOnly) bloomMeshes.push(mesh);
      // Holistic root cause: ANY layer off the card plane (z≠0) swings when the card 3D-rotates. The card
      // plane is z≈-0.005; the depth diorama (effects -0.03..-0.075, shadowbox -0.04) is way off → it swings.
      // Bake ALL of those to the RT (homography), not just the SB. Flat layers (z≈0) stay (rotated-flat = homography).
      // UR gold-foil background layers → bgGroup (pre-composited to the RT); everything else → fgGroup.
      (isBackgroundLayer(r.shader, cfg, r) ? bgGroup : fgGroup).add(mesh);
      built++;
    });


    const tiltPivot = new THREE.Group();
    tiltPivot.add(cardGroup);
    scene.add(tiltPivot);
    tiltPivot.updateWorldMatrix(true, true);
    const box = new THREE.Box3().setFromObject(cardGroup);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    cardGroup.position.sub(center);
    // EXACT game camera (Asset3DRenderer): CameraDistance 1.911506, fov 35. The shadowbox is a
    // depth diorama calibrated to this distance — a closer bbox-fit over-separates the parts.
    const dist = 1.911506;
    camera.position.set(0, 0, dist); camera.lookAt(0, 0, 0);

    log(`built ${built} meshes (${writers} stencil, ${deferred} deferred, ${skipped} skipped)  ${scene_data.card.name} ${scene_data.card.rarityToken}`);
    window.__tilt = tiltPivot;
    window.__bloomSource = { builtMeshes, bloomMeshes };

    // ── UR gold-foil BACKGROUND RT pass ──────────────────────────────────────────────────────────────────────
    // bgGroup (parallax base + holo + glitter + semi-transparent Uzumaki plate) pre-renders to an RT in queue
    // order (with the stencil writers, so it's clipped to the card shape). A fullscreen quad then samples the RT
    // as the background, and fgGroup draws over it — so the semi-transparent plate reveals the layers beneath
    // WITHOUT three.js drawing it over the illustration. bgGroup empty (non-UR) → skipped, plain render.
    const bgPass = bgGroup.children.length > 0;
    let bgRT = null, bgQuad = null;
    if (bgPass) {
      const ds = renderer.getDrawingBufferSize(new THREE.Vector2());
      bgRT = new THREE.WebGLRenderTarget(ds.x || 1024, ds.y || 1434, { stencilBuffer: true, samples: 4 });
      bgRT.texture.colorSpace = cardTargetColorSpace;
      bgQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
        uniforms: { rt: { value: bgRT.texture } },
        vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.9999, 1.0); }`,   // fullscreen, at far depth
        fragmentShader: `
          uniform sampler2D rt; varying vec2 vUv;
          void main(){
            gl_FragColor = texture2D(rt, vUv);
            #include <colorspace_fragment>
          }`,
        depthTest: false, depthWrite: false, toneMapped: false,
      }));
      bgQuad.frustumCulled = false; bgQuad.renderOrder = -100000; bgQuad.visible = false;
      scene.add(bgQuad);
      window.__bg = { rt: bgRT, quad: bgQuad, bgGroup, fgGroup };   // for resize
    }

    // ── LANGUAGE SWITCH: rebuild only the DynamicUI canvas (content + fonts) and swap the textures in place ──
    window.__post = makeBloomPass(hasOfficialEmissive);
    // its own font download + canvas rebuild takes a beat, so show the small busy spinner and lock the dropdown.
    let switching = false;
    let cardSel = null, repeatedSceneIds = new Set();
    function refreshCardSelectLabels() {
      if (!cardSel) return;
      for (const op of cardSel.options) {
        const sceneInfo = sceneList.find((s) => s.file === op.value);
        if (sceneInfo) op.textContent = sceneLabel(sceneInfo, repeatedSceneIds, curLoc);
      }
    }
    async function switchLocale(lc, selEl) {
      if (switching) return;
      switching = true; busy(true, "Switching…"); if (selEl) selEl.disabled = true;
      try {
        await loadLocaleData(lc);                          // sets curFonts + loads that locale's fonts
        const t = await buildFace(lc);                     // rebuild the DynamicUI for the new locale (any card)
        if (t && dynUIMat) { dynUIMat.map = t.ui; dynUIMat.needsUpdate = true; }
        if (t) for (const m of exHoloMats) {
          if (m.uniforms.dynUI) m.uniforms.dynUI.value = t.ui;
          if (m.uniforms.dynHolo) m.uniforms.dynHolo.value = t.holo;
          if (m.uniforms.foilMask) m.uniforms.foilMask.value = t.foil;
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
    if (controlsEl && sceneList.length > 1) {
      const counts = new Map();
      for (const s of sceneList) {
        const key = s.id || s.name || s.file;
        counts.set(key, (counts.get(key) || 0) + 1);
      }
      repeatedSceneIds = new Set([...counts].filter(([, n]) => n > 1).map(([k]) => k));
      const sel = document.createElement("select");
      cardSel = sel;
      sel.setAttribute("aria-label", "Card");
      for (const s of sceneList) {
        const op = document.createElement("option"); op.value = s.file; op.textContent = sceneLabel(s, repeatedSceneIds, curLoc);
        if (s.file === currentSceneFile) op.selected = true; sel.appendChild(op);
      }
      if (cardParam) {
        const op = document.createElement("option"); op.value = ""; op.textContent = compactCardName(scene_data.card.name) || cardParam;
        op.selected = true; sel.prepend(op);
      }
      sel.onchange = () => {
        if (!sel.value || sel.value === currentSceneFile) return;
        busy(true, "Loading…");
        const next = new URL(location.href);
        next.searchParams.delete("card");
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

    // ── DEBUG MODE: isolate layers to find which RESOURCE has an artifact (the face lines, AM, ILL …) ──
    // Each built mesh is tagged userData.label (material · shader · queue, or "DynamicUI"). Cycle through
    // them solo, with the current resource shown on screen. Plus PREVIEW (flat, no tilt) vs SELECT (tilt).
    const dbgLayers = [];
    cardGroup.traverse((o) => { if (o.isMesh && o.userData.label) dbgLayers.push(o); });
    dbgLayers.sort((a, b) => a.renderOrder - b.renderOrder);
    const hud = document.createElement("div");
    // selectable (so you can copy the label) + above the canvas
    hud.style.cssText = "position:fixed;left:8px;bottom:8px;font:12px/1.5 monospace;color:#fff;background:rgba(0,0,0,.78);padding:7px 10px;white-space:pre;user-select:text;-webkit-user-select:text;z-index:9;border-radius:4px;max-width:94vw";
    if (!window.__nohud) document.body.appendChild(hud);
    // full numbered layer list to the console (copyable; reference a layer by its number)
    console.log("=== card layers (renderOrder) ===\n" + dbgLayers.map((m, i) => `[${i + 1}/${dbgLayers.length}] ${m.userData.label}`).join("\n"));
    let solo = -1;
    window.__preview = window.__preview ?? false;
    function applyDbg() {
      dbgLayers.forEach((m, i) => { m.visible = solo < 0 || i === solo; });
      const mode = window.__preview ? "PREVIEW (flat, no tilt)" : "SELECT (mouse-tilt)";
      const cur = solo < 0 ? `ALL — ${dbgLayers.length} layers` : `SOLO [${solo + 1}/${dbgLayers.length}]  ${dbgLayers[solo].userData.label}`;
      hud.textContent = `mode: ${mode}\nlayer: ${cur}\n[←/→] solo prev/next   [a] all   [p] preview/select   [h] hide`;
      if (solo >= 0) console.log(`SOLO [${solo + 1}/${dbgLayers.length}] ${dbgLayers[solo].userData.label}`);
    }
    addEventListener("keydown", (e) => {
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

  // ── mouse-follow tilt (TouchStateRotation: rotate card toward pointer, clamp 30°) ──
  const MAX = THREE.MathUtils.degToRad(30);
  let mx = 0, my = 0;
  addEventListener("pointermove", (e) => {
    const r = renderer.domElement.getBoundingClientRect();
    mx = ((e.clientX - r.left) / r.width) * 2 - 1;
    my = ((e.clientY - r.top) / r.height) * 2 - 1;
  });
  const targetQ = new THREE.Quaternion(), euler = new THREE.Euler();
  const HM_PV = new THREE.Matrix4(), HM_R = new THREE.Matrix4();
  let lastRender = -Infinity;
  function renderFrame(t) {
    let rx = my * MAX, ry = mx * MAX;
    if (window.__preview) { rx = 0; ry = 0; }          // PREVIEW mode: flat, no tilt (debug)
    const m = Math.hypot(rx, ry); if (m > MAX) { rx *= MAX / m; ry *= MAX / m; }
    targetQ.setFromEuler(euler.set(rx, ry, 0, "XYZ"));
    if (window.__tilt) window.__tilt.quaternion.slerp(targetQ, 0.15);
    // Depth diorama: cancel the CENTRE's lateral swing (a point at depth z0 swings ≈ z0·tilt under the
    // rotation) so the diorama stays on the card; the per-layer parallax (different z) is preserved.
    // cardGroup.scale.x=-1 flips X. `?dcomp=` tunes the strength (0=off, default 1; negative to flip).
    for (const am of animMats) am.uniforms.uTime.value = (t || 0) * 0.001;
    for (const em of exactGlitMats) {
      const s = (t || 0) * 0.001;                        // elapsed seconds
      // ONLY the flow time animates (_37[0]); the flow-map scroll + the _37[4] pulse window = the twinkle.
      // _78[15] (the flow-field rotation angle) is left at 0 — it is an undeclared cbuffer slot that reads 0
      // in-game (identity rotation = no spin). Animating it is what produced the bogus rotation.
      em.uniforms._37.value[0].set(s / 20, s, s * 2, s * 3);
    }
    function renderCard(target) {
      const bg = window.__bg;   // set in the FBX callback for UR cards (gold-foil background RT pass); else undefined
      if (bg) {
      // pass 1: gold-foil stack → RT (stencil writers stay visible to clip it to the card; fg + bgQuad hidden).
      bg.quad.visible = false; bg.bgGroup.visible = true; bg.fgGroup.visible = false;
        renderer.setRenderTarget(bg.rt); renderer.render(scene, camera);
      // pass 2: screen — fullscreen RT background behind, fgGroup (illustration/frame/text) over it.
        bg.quad.visible = true; bg.bgGroup.visible = false; bg.fgGroup.visible = true;
        renderer.setRenderTarget(target); renderer.render(scene, camera);
        renderer.setRenderTarget(null);
      } else {
        renderer.setRenderTarget(target);
        renderer.render(scene, camera);   // direct render (card 3D-tilts; the diorama parallax is the real glb depth)
        renderer.setRenderTarget(null);
      }
    }
    function renderBloomSource(target) {
      const src = window.__bloomSource;
      if (!src || !src.bloomMeshes.length) return false;

      const bloomSet = new Set(src.bloomMeshes);
      const prevVisible = src.builtMeshes.map((m) => m.visible);
      const bg = window.__bg;
      const prevBg = bg ? {
        quad: bg.quad.visible,
        bgGroup: bg.bgGroup.visible,
        fgGroup: bg.fgGroup.visible,
      } : null;

      for (const m of src.builtMeshes) m.visible = bloomSet.has(m);
      for (const m of src.bloomMeshes) m.material.uniforms.uBloomOnly.value = 1;
      if (bg) {
        bg.quad.visible = false;
        bg.bgGroup.visible = true;
        bg.fgGroup.visible = true;
      }

      const clearColor = renderer.getClearColor(new THREE.Color()).clone();
      const clearAlpha = renderer.getClearAlpha();
      renderer.setClearColor(0x000000, 0);
      renderer.setRenderTarget(target);
      renderer.clear(true, true, true);
      renderer.render(scene, camera);
      renderer.setRenderTarget(null);
      renderer.setClearColor(clearColor, clearAlpha);

      for (const m of src.bloomMeshes) m.material.uniforms.uBloomOnly.value = 0;
      src.builtMeshes.forEach((m, i) => { m.visible = prevVisible[i]; });
      if (bg && prevBg) {
        bg.quad.visible = prevBg.quad;
        bg.bgGroup.visible = prevBg.bgGroup;
        bg.fgGroup.visible = prevBg.fgGroup;
      }
      return true;
    }
    const post = window.__post;
    if (post) {
      renderCard(post.sceneRT);
      if (post.hasBloom) {
        const hasBloomSource = renderBloomSource(post.emissiveRT);
        if (!hasBloomSource) {
          const clearColor = renderer.getClearColor(new THREE.Color()).clone();
          const clearAlpha = renderer.getClearAlpha();
          renderer.setClearColor(0x000000, 0);
          renderer.setRenderTarget(post.emissiveRT);
          renderer.clear(true, true, true);
          renderer.setRenderTarget(null);
          renderer.setClearColor(clearColor, clearAlpha);
        }
        post.blur.uniforms.rt.value = post.emissiveRT.texture; post.blur.uniforms.uDir.value.set(1, 0);
        post.quad.material = post.blur;
        renderer.setRenderTarget(post.bloomB); renderer.render(post.postScene, post.postCamera);
        post.blur.uniforms.rt.value = post.bloomB.texture; post.blur.uniforms.uDir.value.set(0, 1);
        renderer.setRenderTarget(post.bloomA); renderer.render(post.postScene, post.postCamera);
        post.composite.uniforms.bloom.value = post.bloomA.texture;
      }
      post.quad.material = post.composite;
      renderer.setRenderTarget(null); renderer.render(post.postScene, post.postCamera);
    } else {
      renderCard(null);
    }
  }
  window.__renderShotFrames = async (count = 10, dtMs = 83) => {
    const base = performance.now();
    for (let i = 0; i < count; i++) renderFrame(base + i * dtMs);
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

  addEventListener("resize", () => {
    renderer.setSize(innerWidth, innerHeight);
    camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
    const ds = renderer.getDrawingBufferSize(new THREE.Vector2());
    if (window.__bg) window.__bg.rt.setSize(ds.x || innerWidth, ds.y || innerHeight);
    if (window.__post) window.__post.resize();
  });
}

main().catch((e) => fail(e.stack || String(e)));
