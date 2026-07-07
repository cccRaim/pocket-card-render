// Node composer — turn (already-extracted UGUI layout + dynamic card text) into the positioned text elements
// the renderer's buildDynamicUITexture draws. This is the node equivalent of build_face.py/build_ui.py, but its
// LAYOUT source is the cached scan apks/output/card_ui_prefabs.json (RectTransform tree, no UnityPy needed) and
// its TEXT source is carddata.mjs (masterdata+locale). Works for ANY card type — picks the matching UI prefab.
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { buildCardData } from "./carddata.mjs";

function firstExistingDir(paths) {
  return paths.find((p) => p && existsSync(p)) || paths[0];
}

const OUTDIR = process.env.PCR_RECIPES || firstExistingDir([
  join(import.meta.dirname, "..", "..", "ptcg-apk-parser", "apks", "output"),
  join(import.meta.dirname, "..", "..", "apks", "output"),
]);
const ASSETS = join(OUTDIR, "..", "assets");
const prefabs = JSON.parse(readFileSync(join(OUTDIR, "card_ui_prefabs.json"), "utf8"));

// TMP m_HorizontalAlignment / m_VerticalAlignment → css align (build_face.py:137) and the real dark face colour
// (white prefab placeholder → #231813, the font material's _FaceColor — build_face.py:63/319-323).
const ALIGN = { 1: "left", 2: "center", 4: "right", 8: "left", 16: "left" };
const VALIGN = { 256: "top", 512: "middle", 1024: "bottom" };
const DARK = [0.137, 0.094, 0.082];

// the localized trainer UI label sprites (Supporter / Trainer …) live in this atlas dir (extracted to apks/assets).
const TRAINER_UI = "Assets/Lettuce/_Data/Common/CardNew/Common/UI/Textures/CardUITrainersFormat5x5";
const POKEMON_UI5 = "Assets/Lettuce/_Data/Common/CardNew/Common/UI/Textures/CardUIPokemonFormat5x5";
const POKEMON_UI8 = "Assets/Lettuce/_Data/Common/CardNew/Common/UI/Textures/CardUIPokemonFormat8x8";
const PUBLIC_GAME = join(import.meta.dirname, "..", "public", "game");
// locale → sprite filename suffix (the sprite files use _zh/_cn/_en/_jp…, distinct from the prefab node suffix).
const LOC_SUF = { zh_TW: "zh", zh_CN: "cn", en_US: "en", ja_JP: "jp", ko_KR: "ko", fr_FR: "fr",
                  de_DE: "de", es_ES: "es", it_IT: "it", pt_BR: "pt" };
const sufFor = (lc) => LOC_SUF[lc] || lc.slice(0, 2).toLowerCase();
// trainer TYPE (top-left) label: prefab box-node prefix + sprite-file series, by Trainer.TrainerType.
const TYPE_LABEL = { 1: { node: "support_txt_img", sprite: "card_txt_support" },   // Supporter
                     2: { node: "tools_txt_img",   sprite: "card_txt_tools" },     // Goods/Item
                     3: { node: "tools_txt_img",   sprite: "card_txt_pketools" } };// Pokémon Tool
const ENERGY_ICON = {
  Grass: "01", Fire: "02", Water: "03", Lightning: "04", Psychic: "05",
  Fighting: "06", Darkness: "07", Metal: "08", Dragon: "09", Colorless: "10",
};
const STAGE_SPRITE = { 1: "card_pla_evo_basic", 2: "card_pla_evo_stage1", 3: "card_pla_evo_stage2" };

// font role by element name (build_face.py F_NAME/F_BODY/F_NUM): card names → name font, illustrator credit →
// Futura/num, everything else (rule/description) → body.
function fontRole(go) {
  if (/card_name|skill_name/i.test(go)) return "name";
  if (/illustrator|damage|TxtWeak/i.test(go)) return "num";
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
  const entries = [];
  function walk(n, P) {
    const aL = P.L + n.aMin[0] * P.w, aR = P.L + n.aMax[0] * P.w;
    const aB = P.B + n.aMin[1] * P.h, aT = P.B + n.aMax[1] * P.h;
    const w = (aR - aL) + n.size[0], h = (aT - aB) + n.size[1];
    const pivX = aL + n.piv[0] * (aR - aL) + n.pos[0], pivY = aB + n.piv[1] * (aT - aB) + n.pos[1];
    const L = pivX - n.piv[0] * w, B = pivY - n.piv[1] * h;
    const node = { L, R: L + w, B, T: B + h, w, h, style: n.style };
    node.path = (P.path || "") + "/" + n.go;
    entries.push(node);
    out[n.go] = out[n.go] || node;             // first (highest) wins for duplicate names
    for (const c of (n.children || [])) walk(c, node);
  }
  // root rect centred at origin (its own size), matching the prefab canvas
  walk(root, { L: -root.size[0] / 2, B: -root.size[1] / 2, w: root.size[0], h: root.size[1], path: "" });
  const CW = root.size[0], CH = root.size[1];
  const box = (n) => ({
    l: +((n.L + CW / 2) / CW).toFixed(4), r: +((n.R + CW / 2) / CW).toFixed(4),
    t: +((CH / 2 - n.T) / CH).toFixed(4), b: +((CH / 2 - n.B) / CH).toFixed(4) });
  const node = (g) => { const n = out[g]; return n ? { go: g, box: box(n), style: n.style } : null; };
  // first node whose name starts with `prefix` (locale label variants e.g. support_txt_img_* all share ~one box).
  const nodeByPrefix = (prefix) => { const g = Object.keys(out).find((k) => k.startsWith(prefix)); return g ? node(g) : null; };
  const fromEntry = (n) => n ? { go: n.go, path: n.path, box: box(n), style: n.style } : null;
  const nodeByPath = (suffix) => fromEntry(entries.find((n) => n.path.endsWith(suffix)));
  const nodesByPath = (suffix) => entries.filter((n) => n.path.endsWith(suffix)).map(fromEntry);
  const nodeByPrefixPath = (prefix) => fromEntry(entries.find((n) => n.path.split("/").pop().startsWith(prefix)));
  return { node, nodeByPrefix, nodeByPath, nodesByPath, nodeByPrefixPath, CW, CH };
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

function publicIcon(nodeObj, rel, fit = "contain", extra = {}) {
  if (!nodeObj || !existsSync(join(PUBLIC_GAME, rel))) return null;
  return { kind: "icon", box: nodeObj.box, fit, url: "/game/" + rel, ...extra };
}

function pokemonUiSprite(nodeObj, prefix, lc, fit = "stretch", extra = {}) {
  if (!nodeObj) return null;
  const base = `${POKEMON_UI5}/${prefix}`;
  const candidates = [
    `${base}_${sufFor(lc)}.png`,
    `${base}_${sufFor(lc) === "es" ? "es_it" : sufFor(lc)}.png`,
    `${base}_en.png`,
    `${base}.png`,
  ];
  for (const rel of candidates) {
    if (existsSync(join(PUBLIC_GAME, rel))) return { kind: "icon", box: nodeObj.box, fit, url: "/game/" + rel, ...extra };
  }
  return null;
}

function energyIcon(nodeObj, type, fit = "contain", extra = {}) {
  const code = ENERGY_ICON[type];
  return code ? publicIcon(nodeObj, `${POKEMON_UI8}/card_icn_attribute_${code}.png`, fit, extra) : null;
}

function energyOutline(nodeObj, fit = "contain", extra = {}) {
  return publicIcon(nodeObj, `${POKEMON_UI8}/card_icn_attribute_outline.png`, fit, extra);
}

function boxFromLeft(proto, left, width, gap, index) {
  const l = left + index * (width + gap);
  return { ...proto.box, l: +l.toFixed(4), r: +(l + width).toFixed(4) };
}

function nameWithoutEx(name, isEX) {
  return isEX ? String(name || "").replace(/\s*ex$/i, "") : name;
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

function pokemonAttackElements(layout, attack, basePath, ol) {
  const { nodeByPath, nodesByPath } = layout;
  const els = [];
  const energyNodes = nodesByPath(`${basePath}/SkillName/PokemonCardFaceEnergyContainerView/CardEnergyIconView`);
  (attack.cost || []).slice(0, energyNodes.length).forEach((type, i) => {
    const outline = energyOutline(energyNodes[i]);
    const icon = energyIcon(energyNodes[i], type);
    if (outline) els.push(outline);
    if (icon) els.push(icon);
  });
  const name = textEl(nodeByPath(`${basePath}/SkillName/skill_name_txt`), attack.name, ol);
  if (name) { name.font = "name"; name.autosize = true; name.fsmin = name.fsmin || name.fs * 0.1; els.push(name); }
  const damage = attack.damage ? textEl(nodeByPath(`${basePath}/SkillName/damage_num_elm/damage_txt`), String(attack.damage), ol) : null;
  if (damage) { damage.font = "num"; els.push(damage); }
  const desc = textEl(nodeByPath(`${basePath}/skill_description_txt`), attack.desc, ol);
  if (desc) els.push(desc);
  return els;
}

function composePokemonFace(cd, lc) {
  const tree = prefabTree("PokemonCardUI");
  if (!tree) throw new Error("PokemonCardUI layout not in card_ui_prefabs.json");
  const layout = resolveBoxes(tree);
  const { node, nodeByPath, nodeByPrefixPath, nodesByPath, CW, CH } = layout;
  const ol = FONT_OUTLINE[cd.isMega ? "Pokemon_Normal_Mega" : "Pokemon_Normal"] || {};
  const els = [];

  const topEnergy = energyIcon(node("energy_view"), cd.type);
  if (topEnergy) els.push(topEnergy);
  const stagePrefix = STAGE_SPRITE[cd.stage];
  if (stagePrefix) {
    const stageNode = nodeByPrefixPath(`phase_txt_img_0${cd.stage}_`);
    const stage = pokemonUiSprite(stageNode, stagePrefix, lc, "stretch");
    if (stage) els.push(stage);
  }
  const name = textEl(node("card_name_txt"), nameWithoutEx(cd.name, cd.isEX), ol);
  if (name) {
    name.autosize = true; name.fsmin = name.fsmin || name.fs * 0.1;
    if (cd.isEX) {
      const nameElm = node("name_elm");
      name.exAfter = true;
      name.exH = 55 / CH;
      name.exAnchorX = nameElm?.box?.l ?? name.box.l;
      name.exMaxW = 300 / CW;
    }
    els.push(name);
  }
  const hpNode = node("hp_elm");
  if (hpNode && cd.hp) {
    els.push({
      kind: "hp", box: hpNode.box, num: String(cd.hp), label: cd.ui.hpLabel || "HP",
      numFs: 46, labelFs: 22, font: "num", spacing: 1 / CW, labelCellW: 30 / CW, labelDY: 8, color: DARK,
    });
  }

  const attacks = cd.attacks || [];
  if (attacks.length >= 2) {
    els.push(...pokemonAttackElements(layout, attacks[0], "/PokemonCardUI/PokemonSkillContainerView/PokemonSkillContainerView_02/PokemonAttackView1", ol));
    els.push(...pokemonAttackElements(layout, attacks[1], "/PokemonCardUI/PokemonSkillContainerView/PokemonSkillContainerView_02/PokemonAttackView2", ol));
  } else if (attacks.length === 1) {
    els.push(...pokemonAttackElements(layout, attacks[0], "/PokemonCardUI/PokemonSkillContainerView/PokemonSkillContainerView_01/PokemonAttackView", ol));
  }

  const weakLabel = textEl(nodeByPath("/PokemonCardUI/PokemonWeakResistView/WeakValue/weak_txt"), cd.ui.weakLabel, ol);
  if (weakLabel) els.push(weakLabel);
  const weakIcon = energyIcon(nodeByPath("/PokemonCardUI/PokemonWeakResistView/WeakValue/energy_icon/CardEnergyIconView"), cd.weakness);
  if (weakIcon) els.push(weakIcon);
  const weakSign = textEl(nodeByPath("/PokemonCardUI/PokemonWeakResistView/WeakValue/TxtWeakSign"), cd.weakness ? "+" : "", ol);
  if (weakSign) { weakSign.font = "num"; els.push(weakSign); }
  const weakVal = textEl(nodeByPath("/PokemonCardUI/PokemonWeakResistView/WeakValue/TxtWeakValue"), cd.weakness ? "20" : "", ol);
  if (weakVal) { weakVal.font = "num"; els.push(weakVal); }

  const retreatLabel = textEl(nodeByPrefixPath("escape_txt_"), cd.ui.retreatLabel, ol);
  if (retreatLabel) els.push(retreatLabel);
  const retreatNodes = nodesByPath("/PokemonCardUI/PokemonEscapeView/Attributes/CardEnergyIconView");
  const retreatProto = retreatNodes[0];
  const retreatWidth = retreatProto ? retreatProto.box.r - retreatProto.box.l : 0;
  const retreatLeft = retreatProto ? (retreatProto.box.l + retreatProto.box.r) / 2 : 0;
  for (let i = 0; i < Math.min(cd.retreat || 0, retreatNodes.length); i++) {
    const iconNode = retreatProto ? { ...retreatProto, box: boxFromLeft(retreatProto, retreatLeft, retreatWidth, 1 / CW, i) } : retreatNodes[i];
    const icon = energyIcon(iconNode, "Colorless");
    if (icon) els.push(icon);
  }

  const ill = textEl(illustratorNode(node), cd.illustrator ? `Illus. ${cd.illustrator}` : "", ol);
  if (ill) els.push(ill);

  if (cd.isEX) {
    const root = cd.isMega ? "/PokemonCardUI/PokemoMegaExRuleView" : "/PokemonCardUI/PokemonExRuleView";
    const shadow = publicIcon(nodeByPath(`${root}/frm_bg_shadow`), `${POKEMON_UI5}/card_pla_rule_bg_shadow.png`, "stretch", { sprite: "card_pla_rule_bg_shadow" });
    const bg = publicIcon(nodeByPath(`${root}/frm_bg`), `${POKEMON_UI5}/card_pla_rule_bg.png`, "stretch", { sprite: "card_pla_rule_bg" });
    if (shadow) els.push(shadow);
    if (bg) els.push(bg);
    const ttl = pokemonUiSprite(nodeByPrefixPath("ex_rule_ttl_txt_"), "card_pla_rule_txt", lc, "contain", { sprite: "card_pla_rule_txt" });
    if (ttl) els.push(ttl);
    const body = textEl(nodeByPath(`${root}/ex_rule_description_txt_02`), cd.ui.exRuleBody, ol);
    if (body) { body.indent = (cd.ui.exRuleIndent || 0) / CW; body.fsmin = Math.max(body.fsmin || 0, 8); els.push(body); }
  }

  return { card: cd.cardId, locale: lc, kind: "pokemon", fontGroup: cd.isMega ? "Pokemon_Normal_Mega" : "Pokemon_Normal",
           canvasWH: [Math.round(CW), Math.round(CH)], elements: els };
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
  return composePokemonFace(cd, lc);
}

if (process.argv[1] && process.argv[1].endsWith("compose.mjs")) {
  const [, , id = "TR_20_000230_00", lc = "zh_TW", ill = "cTR_20_000230_00_LEAF_SR"] = process.argv;
  console.log(JSON.stringify(composeFace(id, lc, ill), null, 1));
}
