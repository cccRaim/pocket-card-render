// Node composer — turn (already-extracted UGUI layout + dynamic card text) into the positioned text elements
// the renderer's buildDynamicUITexture draws. This is the node equivalent of build_face.py/build_ui.py, but its
// LAYOUT source is the cached scan apks/output/card_ui_prefabs.json (RectTransform tree, no UnityPy needed) and
// its TEXT source is carddata.mjs (masterdata+locale). Works for ANY card type — picks the matching UI prefab.
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { buildCardData } from "./carddata.mjs";

const OUTDIR = join(import.meta.dirname, "..", "..", "apks", "output");
const ASSETS = join(OUTDIR, "..", "assets");
const prefabs = JSON.parse(readFileSync(join(OUTDIR, "card_ui_prefabs.json"), "utf8"));

// TMP m_HorizontalAlignment / m_VerticalAlignment → css align (build_face.py:137) and the real dark face colour
// (white prefab placeholder → #231813, the font material's _FaceColor — build_face.py:63/319-323).
const ALIGN = { 1: "left", 2: "center", 4: "right", 8: "left", 16: "left" };
const VALIGN = { 256: "top", 512: "middle", 1024: "bottom" };
const DARK = [0.137, 0.094, 0.082];

// the localized trainer UI label sprites (Supporter / Trainer …) live in this atlas dir (extracted to apks/assets).
const TRAINER_UI = "Assets/Lettuce/_Data/Common/CardNew/Common/UI/Textures/CardUITrainersFormat5x5";
// locale → sprite filename suffix (the sprite files use _zh/_cn/_en/_jp…, distinct from the prefab node suffix).
const LOC_SUF = { zh_TW: "zh", zh_CN: "cn", en_US: "en", ja_JP: "jp", ko_KR: "ko", fr_FR: "fr",
                  de_DE: "de", es_ES: "es", it_IT: "it", pt_BR: "pt" };
const sufFor = (lc) => LOC_SUF[lc] || lc.slice(0, 2).toLowerCase();
// trainer TYPE (top-left) label: prefab box-node prefix + sprite-file series, by Trainer.TrainerType.
const TYPE_LABEL = { 1: { node: "support_txt_img", sprite: "card_txt_support" },   // Supporter
                     2: { node: "tools_txt_img",   sprite: "card_txt_tools" },     // Goods/Item
                     3: { node: "tools_txt_img",   sprite: "card_txt_pketools" } };// Pokémon Tool

// font role by element name (build_face.py F_NAME/F_BODY/F_NUM): card names → name font, illustrator credit →
// Futura/num, everything else (rule/description) → body.
function fontRole(go) {
  if (/card_name_(main|sub)/.test(go)) return "name";
  if (/illustrator/i.test(go)) return "num";
  return "body";
}

// Text outline is NOT blanket — it's whatever font PRESET the field's FontGroup _key selects, resolved to the
// preset material's real _OutlineColor/_OutlineWidth (apks/output/card_font_outline.json, built by
// tools/render/extract_card_font_outline.py). The FontGroup depends on the card LAYOUT: a full-art trainer (text
// OVER the illustration) uses `Trainers_OverNumber` → name/rule/illustrator get a white outline but the footer
// (`Rule`, which has no outline variant) stays plain; a windowed trainer uses `Trainers_Normal` → all plain.
const FONT_OUTLINE = JSON.parse(readFileSync(join(OUTDIR, "card_font_outline.json"), "utf8"));

// recipe manifest for a card (per-card if present else per-type default) — used to tell full-art from windowed.
function recipeFor(illId) {
  const per = `${illId}_render_full.json`;
  if (illId && existsSync(join(OUTDIR, per))) return per;
  return /^cTR/.test(illId || "") ? "tr_render_full.json" : "card_render_full.json";
}
// full-art = the card composites text OVER the illustration (has L_*_Full_* layers, no _Window_ image). That
// selects the "OverNumber" FontGroup (white outline); a windowed layout selects "Normal" (plain).
function trainerFontGroup(illId) {
  try {
    const full = JSON.parse(readFileSync(join(OUTDIR, recipeFor(illId)), "utf8"));
    const windowed = full.layers.some((l) => /_Window_/.test(l.go || "") || /Window/.test(l.material || ""));
    return windowed ? "Trainers_Normal" : "Trainers_OverNumber";
  } catch { return "Trainers_OverNumber"; }
}

// UGUI RectTransform → normalised box {l,r,t,b}∈[0,1] AND the node's real TMP style, carried together so the
// composer is fully DATA-DRIVEN (fs/align/colour/autosize/wrap from the prefab, never guessed). Math = build_face.py:91-109.
function resolveBoxes(root) {
  const out = {};
  function walk(n, P) {
    const aL = P.L + n.aMin[0] * P.w, aR = P.L + n.aMax[0] * P.w;
    const aB = P.B + n.aMin[1] * P.h, aT = P.B + n.aMax[1] * P.h;
    const w = (aR - aL) + n.size[0], h = (aT - aB) + n.size[1];
    const pivX = aL + n.piv[0] * (aR - aL) + n.pos[0], pivY = aB + n.piv[1] * (aT - aB) + n.pos[1];
    const L = pivX - n.piv[0] * w, B = pivY - n.piv[1] * h;
    const node = { L, R: L + w, B, T: B + h, w, h, style: n.style };
    out[n.go] = out[n.go] || node;             // first (highest) wins for duplicate names
    for (const c of (n.children || [])) walk(c, node);
  }
  // root rect centred at origin (its own size), matching the prefab canvas
  walk(root, { L: -root.size[0] / 2, B: -root.size[1] / 2, w: root.size[0], h: root.size[1] });
  const CW = root.size[0], CH = root.size[1];
  const box = (n) => ({
    l: +((n.L + CW / 2) / CW).toFixed(4), r: +((n.R + CW / 2) / CW).toFixed(4),
    t: +((CH / 2 - n.T) / CH).toFixed(4), b: +((CH / 2 - n.B) / CH).toFixed(4) });
  const node = (g) => { const n = out[g]; return n ? { go: g, box: box(n), style: n.style } : null; };
  // first node whose name starts with `prefix` (locale label variants e.g. support_txt_img_* all share ~one box).
  const nodeByPrefix = (prefix) => { const g = Object.keys(out).find((k) => k.startsWith(prefix)); return g ? node(g) : null; };
  return { node, nodeByPrefix, CW, CH };
}

// a localized label SPRITE (Supporter / Trainer …) drawn as an icon at its real prefab box. `prefix` = sprite-file
// series; falls back to the no-locale sprite, else null (skip) — never invents a position.
function labelIcon(nodeObj, prefix, lc) {
  if (!nodeObj) return null;
  for (const suf of [sufFor(lc), ""]) {
    const rel = `${TRAINER_UI}/${prefix}${suf ? "_" + suf : ""}.png`;
    if (existsSync(join(ASSETS, rel))) return { kind: "icon", box: nodeObj.box, fit: "stretch", url: "/game/" + rel };
  }
  return null;
}

function prefabTree(name) {
  const e = prefabs.find((c) => String(c.prefab).includes(name));
  return e ? e.tree[0] : null;
}

// Build a text draw-op from a resolved node + string — fs/align/colour/autosize/wrap ALL from the node's real
// prefab TMP style (build_face.py parity). White placeholder colour → the real dark face colour. Returns null
// if the node/string is missing, so callers can .filter(Boolean).
function textEl(node, text, outlineTbl) {
  if (!node || !node.style || text == null || text === "") return null;
  const s = node.style;
  let color = s.color.slice();
  if (color[0] > 0.9 && color[1] > 0.9 && color[2] > 0.9) color = [...DARK, color[3] ?? 1];
  const el = { kind: "text", text, box: node.box, font: fontRole(node.go),
               fs: s.fs, align: ALIGN[s.align] || "left", valign: VALIGN[s.valign] || "middle", color };
  // outline iff this field's FontGroup preset (keyed by the prefab _key) carries one — data, never blanket.
  const outline = outlineTbl && s.key != null ? outlineTbl[s.key] : null;
  if (outline) el.outline = { color: outline.color, width: outline.width };
  if (s.wrap) { el.wrap = true; el.fsmin = s.fsmin || Math.round(s.fs * 0.6); }
  // autosize (shrink-to-fit width) only for a real-width box; a point-anchored box (w≈0, e.g. illustrator)
  // overflows in-engine, so shrinking it to fit width 0 would vanish the text — keep the authored fs.
  else if (s.autosize && (node.box.r - node.box.l) > 0.02) { el.autosize = true; el.fsmin = s.fsmin || Math.round(s.fs * 0.5); }
  return el;
}

// illustrator credit: box from the width-having parent illustrator_elm, style from the illustrator_name_txt child.
function illustratorNode(node) {
  const elm = node("illustrator_elm"), txt = node("illustrator_name_txt") || node("Illustrator_txt");
  if (elm && txt) return { go: txt.go, box: elm.box, style: txt.style };
  return txt || elm;
}

export function composeFace(cardId, lc = "zh_TW", illId = "") {
  const cd = buildCardData(cardId, lc);

  if (cd.kind === "trainer") {
    const tree = prefabTree("TrainersCardUI");
    if (!tree) throw new Error("TrainersCardUI layout not in card_ui_prefabs.json");
    const { node, nodeByPrefix, CW, CH } = resolveBoxes(tree);
    // outline table for THIS card's FontGroup (full-art → Trainers_OverNumber: name/rule/illustrator outlined,
    // footer plain; windowed → Trainers_Normal: all plain). _key on each field picks its entry.
    const ol = FONT_OUTLINE[trainerFontGroup(illId)] || {};
    // element→content mapping (boxes + TMP styles are REAL prefab data; verified against the M-size baked _UT):
    //   Supporter type label (top-left) + Trainer category label (top-right) = localized SPRITES at their prefab boxes;
    //   card name = txt_support_card_name_main (fs38 autosize), rule body = description_txt (fs23 wrap, V=middle →
    //   sits ~0.69), footer = card_rule_txt (fs17 wrap), illustrator = illustrator_name_txt (fs15 point-anchored).
    const tl = TYPE_LABEL[cd.trainerType] || TYPE_LABEL[1];
    const els = [
      // top labels (drawn first; text on top). type → its TrainerType series; category → Trainer (normal trainers).
      labelIcon(nodeByPrefix(tl.node + "_"), tl.sprite, lc),
      labelIcon(nodeByPrefix("normal_ttl_txt_img_"), "card_fra_trainers_top_txt_nor", lc),
      textEl(node("txt_support_card_name_main"), cd.name,    ol),
      textEl(node("description_txt"),            cd.rule,    ol),
      textEl(node("card_rule_txt"),              cd.ui.footer, ol),
      // illustrator: the TEXT node (illustrator_name_txt) is zero-width; its real placement is the PARENT
      // illustrator_elm (pos x=53, width 170) — build_face.py uses illustrator_elm for the Pokémon too. Take the
      // box from the parent, the TMP style from the text child.
      textEl(illustratorNode(node), cd.illustrator ? `Illus. ${cd.illustrator}` : "", ol),
    ].filter(Boolean);
    return { card: cardId, locale: lc, kind: "trainer", fontGroup: trainerFontGroup(illId),
             canvasWH: [Math.round(CW), Math.round(CH)], elements: els };
  }

  // pokemon: reuse the existing static card_face for now (the Pokémon path already works); the generic
  // pokemon composer (name/hp/attacks boxes from PokemonCardUI) is the next iteration.
  return { card: cardId, locale: lc, kind: "pokemon", elements: [], note: "pokemon uses the existing card_face pipeline" };
}

if (process.argv[1] && process.argv[1].endsWith("compose.mjs")) {
  const [, , id = "TR_20_000230_00", lc = "zh_TW", ill = "cTR_20_000230_00_LEAF_SR"] = process.argv;
  console.log(JSON.stringify(composeFace(id, lc, ill), null, 1));
}
