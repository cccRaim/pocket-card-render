// Node port of tools/render/build_card_data.py — resolve a card's TEXT content (name/labels/rule/attacks/
// illustrator) from the game's OWN masterdata + locale, for ANY card, DYNAMICALLY (no offline pre-gen).
// Pure JSON joins — the masterdata is plain decrypted JSON and the locale is the pre-extracted locale_<lc>.json,
// so this needs no UnityPy/Python. Handles Pokémon (PokemonCard/Pokemon) AND Trainers (TrainerCard/Trainer).
// Usage (server-side): import { buildCardData } from "./carddata.mjs"; buildCardData("TR_20_000230_00","zh_TW").
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

function firstExistingDir(paths) {
  return paths.find((p) => p && existsSync(p)) || paths[0];
}

const MD = firstExistingDir([
  process.env.PTCG_MASTERDATA,
  "D:/DevProjectes/ptcgp-cloudbase/cloud/src/functions/app/ptcgp-masterdata/MasterData",
  "D:/DevProjectes/ptcgp-tools-master/pokemon-tcgp-dumped-masterdata/exported",
  "D:/DevProjectes/ptcgp-tools-master/masterdata_decoder/.output/decrypted/masterdata",
]);
const OUTDIR = process.env.PCR_RECIPES || firstExistingDir([
  join(import.meta.dirname, "..", "..", "ptcg-apk-parser", "apks", "output"),
  join(import.meta.dirname, "..", "..", "apks", "output"),
]);   // locale_<lc>.json lives here

const ENERGY = { 1: "Colorless", 2: "Grass", 3: "Fire", 4: "Water", 5: "Lightning", 6: "Psychic",
                 7: "Fighting", 8: "Darkness", 9: "Metal", 10: "Dragon", 11: "Fairy" };
const TRAINER_TYPE = { 1: "TRAINER_TYPE_SUPPORT", 2: "TRAINER_TYPE_GOODS", 3: "TRAINER_TYPE_EQUIPMENT" };
const TRAINER_FOOTER = { 1: "support_description", 2: "goods_description", 3: "equipment_description" };

const _cache = {};
const load = (n) => (_cache[n] ??= JSON.parse(readFileSync(join(MD, n + ".json"), "utf8")));
const index = (rows, key) => Object.fromEntries(rows.filter((r) => key in r).map((r) => [r[key], r]));

// Rich-text resolution — same tag set as the Python resolve(): [Num:Int id="N"] runtime param, [Img:ex] → \x03
// ex-glyph sentinel, [Ctrl:Bold]..[/Ctrl:Bold] → \x01/\x02, strip the rest of the TMP/Ctrl/Img markup.
function resolve(text, params = [], nameOf = null) {
  if (!text) return "";
  // [Num:Int id="N"] → runtime param N (e.g. damage/HP); [Text:CardName id="N"] → param N is a CharacterID →
  // its display name (the trainer rule's [Text:CardName] pre-evolution name, e.g. EIEVUI -> Eevee).
  text = text.replace(/\[Num:Int[^\]]*\]/g, (m) => {
    const i = /id="(\d+)"/.exec(m); const n = i ? +i[1] : -1;
    return (n >= 0 && n < params.length) ? String(params[n]) : "";
  });
  text = text.replace(/\[Text:CardName[^\]]*\]/g, (m) => {
    const i = /id="(\d+)"/.exec(m); const n = i ? +i[1] : -1;
    return (nameOf && n >= 0 && n < params.length) ? nameOf(params[n]) : "";
  });
  // [Ctrl:OL] … [Ctrl:LI]item[/Ctrl:LI] … [/Ctrl:OL] → an ORDERED LIST: number each item ①②③ (the game shows the
  // two "choose 1 of 2 effects" as ① / ②). Number per-OL; strip the LI/OL control tags.
  text = text.replace(/\[Ctrl:OL\s*\]([\s\S]*?)\[\/Ctrl:OL\s*\]/g, (m, body) => {
    let n = 0;
    return body.replace(/\[Ctrl:LI\s*\]/g, () => String.fromCodePoint(0x2460 + (n++)))   // ①②③…
               .replace(/\[\/Ctrl:LI\s*\]/g, "");
  });
  text = text.replace(/\[Img:ex\s*\]/g, "\x03")
             .replace(/\[Ctrl:Bold\s*\]/g, "\x01").replace(/\[\/Ctrl:Bold\s*\]/g, "\x02")
             .replace(/\[C:Nbsp\s*\]/g, " ").replace(/\[\/?Ctrl:[^\]]*\]/g, "")
             .replace(/<\/?[a-zA-Z][^>]*>/g, "").replace(/\[[A-Za-z][^\]]*\]/g, "");
  return text.trim();
}

export function buildCardData(cardId, lc = "zh_TW") {
  const L = JSON.parse(readFileSync(join(OUTDIR, `locale_${lc}.json`), "utf8"));
  const M = L.Master, UI = L.UI;
  const chars = index(load("Character"), "CharacterID");
  const charName = (cid) => (cid && chars[cid]) ? (M[chars[cid].DisplayNameMSID] || "") : "";

  // ── TRAINER (Supporter / Item / Tool) ──────────────────────────────────────────────────────────
  if (/^TR_/.test(cardId)) {
    const tc = index(load("TrainerCard"), "CardID")[cardId];
    if (!tc) throw new Error(`trainer card ${cardId} not in masterdata`);
    const tr = index(load("Trainer"), "TrainerID")[tc.TrainerID] || {};
    const typeLabel = resolve(M[TRAINER_TYPE[tr.TrainerType]] || "");
    return {
      cardId, kind: "trainer",
      name: charName(tr.CharacterID),
      trainerType: tr.TrainerType,                                // 1=SUPPORT 2=GOODS 3=EQUIPMENT (label sprite series)
      typeLabel,                                                  // Supporter / Goods / Pokémon Tool
      categoryLabel: resolve(UI.common_card_detail_column_status_07 || M.common_card_detail_column_status_07 || ""), // Trainer
      rule: resolve(M[tr.DescriptionMSID] || "", tr.TrainerLogicParameters || [], charName),
      rarity: tc.Rarity,
      illustrationId: tc.IllustrationID,
      illustrator: (tc.IllustratorNameMSIDs || []).map((x) => M[x] || "").filter(Boolean).join(" / "),
      ui: { footer: resolve(UI[TRAINER_FOOTER[tr.TrainerType]] || "") },
    };
  }

  // ── POKÉMON (parity with build_card_data.py) ───────────────────────────────────────────────────
  const c = index(load("PokemonCard"), "CardID")[cardId];
  if (!c) throw new Error(`card ${cardId} not in masterdata`);
  const p = index(load("Pokemon"), "PokemonID")[c.PokemonID];
  const atks = index(load("PokemonAttack"), "PokemonAttackID");
  const anames = index(load("PokemonAttackName"), "PokemonAttackNameID");
  const mega = !!p.IsMegaEvolution, isEx = !!p.IsEX;
  const preevo = p.PreevolvedCharacterID ? charName(p.PreevolvedCharacterID) : "";
  const stage = p.EvolutionStage;
  const stageLabel = resolve(M[{ 1: "EVOLUTION_STAGE_Basic", 2: "EVOLUTION_STAGE_One", 3: "EVOLUTION_STAGE_Two" }[stage] || ""] || "");
  const evolveFrom = preevo ? resolve((UI.evolution_from || "").replace(/\[Mst:CardCharacterName ?\]/g, preevo)) : "";
  const attacks = (p.PokemonAttackIDs || []).map((aid) => {
    const a = atks[aid];
    return {
      name: anames[a.PokemonAttackNameID] ? (M[anames[a.PokemonAttackNameID].NameMSID] || "") : "",
      cost: (a.AttackCost || []).map((x) => ENERGY[x] || String(x)),
      damage: a.Damage || 0, damageSymbol: a.DamageSymbol || 0,
      desc: resolve(M[a.DescriptionMSID || ""] || "", a.AttackLogicParameters || []),
    };
  });
  const ui = {
    weakLabel: resolve(M.common_card_detail_column_status_04 || UI.common_card_detail_column_status_04 || ""),
    retreatLabel: resolve(M.common_card_detail_column_status_05 || UI.common_card_detail_column_status_05 || ""),
    hpLabel: resolve(UI.hp || M.common_card_detail_column_status_03 || "HP"),
  };
  if (isEx) {
    ui.exRuleTitle = resolve(UI[mega ? "megaex_rule" : "ex_rule"] || "");
    const rawBody = UI[mega ? "megaex_pokemon_down_description" : "ex_pokemon_down_description"] || "";
    ui.exRuleIndent = +(/<line-indent=(\d+)/.exec(rawBody)?.[1] || 0);
    ui.exRuleBody = resolve(rawBody);
  }
  return {
    cardId, kind: "pokemon", name: charName(p.CharacterID), hp: p.HP, isEX: isEx, isMega: mega,
    type: p.PokemonTypes ? ENERGY[p.PokemonTypes[0]] : null, weakness: ENERGY[p.WeaknessType],
    retreat: p.RetreatAmount || 0, stage, stageLabel, evolvesFrom: preevo, evolveFromText: evolveFrom,
    rarity: c.Rarity, illustrationId: c.IllustrationID,
    illustrator: (c.IllustratorNameMSIDs || []).map((x) => M[x] || "").filter(Boolean).join(" / "),
    flavor: resolve(M[c.FlavorTextMSID || ""] || ""), attacks, ui,
  };
}

// CLI: node carddata.mjs <cardId> [locale]
if (process.argv[1] && process.argv[1].endsWith("carddata.mjs")) {
  const [, , id = "TR_20_000230_00", lc = "zh_TW"] = process.argv;
  console.log(JSON.stringify(buildCardData(id, lc), null, 1));
}
