// Resolve card-face text and structural metadata from the game's masterdata and locale files.
// Usage: import { buildCardData } from "./carddata.mjs"; buildCardData("TR_20_000230_00", "zh_TW").
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createCardTextResolver } from "./card-text-resolver.mjs";

function firstExistingDir(paths) {
  return paths.find((path) => path && existsSync(path)) || paths[0];
}

const MD = firstExistingDir([
  process.env.PTCG_MASTERDATA,
  "D:/DevProjectes/ptcgp-cloudbase/cloud/src/functions/app/ptcgp-masterdata/MasterData",
  "D:/DevProjectes/ptcgp-tools-master/pokemon-tcgp-dumped-masterdata/exported",
  "D:/DevProjectes/ptcgp-tools-master/masterdata_decoder/.output/decrypted/masterdata",
]);
const OUTDIR = process.env.PTCG_LOCALE_ROOT || process.env.PCR_RECIPES || firstExistingDir([
  join(import.meta.dirname, "..", "..", "ptcg-apk-parser", "apks", "output"),
  join(import.meta.dirname, "..", "..", "apks", "output"),
]);

const ENERGY = {
  1: "Colorless", 2: "Grass", 3: "Fire", 4: "Water", 5: "Lightning", 6: "Psychic",
  7: "Fighting", 8: "Darkness", 9: "Metal", 10: "Dragon", 11: "Fairy",
};
const TRAINER_TYPE = {
  1: "TRAINER_TYPE_SUPPORT",
  2: "TRAINER_TYPE_GOODS",
  3: "TRAINER_TYPE_EQUIPMENT",
  4: "TRAINER_TYPE_FOSSIL",
  5: "TRAINER_TYPE_STADIUM",
};
const TRAINER_FOOTER = {
  1: "support_description",
  2: "goods_description",
  3: "goods_description",
  4: "goods_description",
  5: "stadium_description",
};
const ADDITIONAL_CATEGORY = { 1: "ultraBeast", 2: "ancient", 3: "future" };
const DAMAGE_SYMBOL = { 0: "plain", 1: "plus", 2: "multiply", 3: "minus" };
const EVOLUTION_STAGE = { 1: "EVOLUTION_STAGE_Basic", 2: "EVOLUTION_STAGE_One", 3: "EVOLUTION_STAGE_Two" };
const tableCache = new Map();
const indexCache = new Map();
const localeCache = new Map();

function load(name) {
  if (!tableCache.has(name)) {
    tableCache.set(name, JSON.parse(readFileSync(join(MD, `${name}.json`), "utf8")));
  }
  return tableCache.get(name);
}

function tableIndex(name, rows, key) {
  const cacheKey = `${name}:${key}`;
  if (!indexCache.has(cacheKey)) {
    indexCache.set(cacheKey, new Map(rows.filter((row) => key in row).map((row) => [row[key], row])));
  }
  return indexCache.get(cacheKey);
}

function loadLocale(lc) {
  if (!localeCache.has(lc)) {
    localeCache.set(lc, JSON.parse(readFileSync(join(OUTDIR, `locale_${lc}.json`), "utf8")));
  }
  return localeCache.get(lc);
}

function categoryData(row) {
  const additionalCategories = [...(row.AdditionalCategories || [])];
  return {
    additionalCategories,
    categoryKinds: additionalCategories.map((category) => ADDITIONAL_CATEGORY[category] || String(category)),
  };
}

export function buildCardData(cardId, lc = "zh_TW") {
  const locale = loadLocale(lc);
  const M = locale.Master;
  const UI = locale.UI;
  const characters = tableIndex("Character", load("Character"), "CharacterID");
  const attackNamesById = tableIndex("PokemonAttackName", load("PokemonAttackName"), "PokemonAttackNameID");
  const abilityNamesById = tableIndex("PokemonAbilityName", load("PokemonAbilityName"), "PokemonAbilityNameID");
  const resolve = createCardTextResolver(M, {
    attackName: (id) => M[attackNamesById.get(id)?.NameMSID] || "",
    abilityName: (id) => M[abilityNamesById.get(id)?.NameMSID] || "",
  }, lc);
  const charName = (characterId) => resolve(M[characters.get(characterId)?.DisplayNameMSID] || "");

  if (/^TR_/.test(cardId)) {
    const card = tableIndex("TrainerCard", load("TrainerCard"), "CardID").get(cardId);
    if (!card) throw new Error(`trainer card ${cardId} not in masterdata`);
    const trainer = tableIndex("Trainer", load("Trainer"), "TrainerID").get(card.TrainerID);
    if (!trainer) throw new Error(`trainer ${card.TrainerID} not in masterdata`);

    return {
      cardId,
      kind: "trainer",
      name: charName(trainer.CharacterID),
      rightEndDisplayName: resolve(M[card.RightEndDisplayNameMSID] || ""),
      trainerType: trainer.TrainerType,
      typeLabel: resolve(M[TRAINER_TYPE[trainer.TrainerType]] || ""),
      categoryLabel: resolve(UI.common_card_detail_column_status_07 || M.common_card_detail_column_status_07 || ""),
      ...categoryData(trainer),
      fossilHp: trainer.TrainerType === 4 ? Number(trainer.TrainerLogicParameters?.[0] || 0) : 0,
      rule: resolve(M[trainer.DescriptionMSID] || "", trainer.TrainerLogicParameters || [], { cardName: charName }),
      rarity: card.Rarity,
      illustrationId: card.IllustrationID,
      illustrator: (card.IllustratorNameMSIDs || []).map((key) => resolve(M[key] || "")).filter(Boolean).join(" / "),
      ui: { footer: resolve(UI[TRAINER_FOOTER[trainer.TrainerType]] || "") },
    };
  }

  const card = tableIndex("PokemonCard", load("PokemonCard"), "CardID").get(cardId);
  if (!card) throw new Error(`card ${cardId} not in masterdata`);
  const pokemon = tableIndex("Pokemon", load("Pokemon"), "PokemonID").get(card.PokemonID);
  if (!pokemon) throw new Error(`pokemon ${card.PokemonID} not in masterdata`);

  const attacksById = tableIndex("PokemonAttack", load("PokemonAttack"), "PokemonAttackID");
  const abilitiesById = tableIndex("PokemonAbility", load("PokemonAbility"), "PokemonAbilityID");
  const isMega = !!pokemon.IsMegaEvolution;
  const isEx = !!pokemon.IsEX;
  const preevolvedCharacterId = pokemon.PreevolvedCharacterID || "";
  const evolvesFrom = charName(preevolvedCharacterId);
  const stage = pokemon.EvolutionStage;
  const stageLabel = resolve(M[EVOLUTION_STAGE[stage]] || "");
  const evolveFromText = evolvesFrom
    ? resolve((UI.evolution_from || "").replace(/\[Mst:CardCharacterName\s*\]/g, evolvesFrom))
    : "";

  const abilities = (pokemon.PokemonAbilityIDs || []).map((abilityId) => {
    const ability = abilitiesById.get(abilityId);
    if (!ability) throw new Error(`ability ${abilityId} not in masterdata`);
    const abilityName = abilityNamesById.get(ability.PokemonAbilityNameID);
    return {
      id: abilityId,
      name: resolve(M[abilityName?.NameMSID] || ""),
      desc: resolve(M[ability.DescriptionMSID] || "", ability.AbilityLogicParameters || [], { cardName: charName }),
    };
  });

  const attacks = (pokemon.PokemonAttackIDs || []).map((attackId) => {
    const attack = attacksById.get(attackId);
    if (!attack) throw new Error(`attack ${attackId} not in masterdata`);
    const attackName = attackNamesById.get(attack.PokemonAttackNameID);
    const damageSymbol = attack.DamageSymbol ?? 0;
    return {
      id: attackId,
      name: resolve(M[attackName?.NameMSID] || ""),
      cost: (attack.AttackCost || []).map((energy) => ENERGY[energy] || String(energy)),
      damage: attack.Damage ?? 0,
      damageSymbol,
      damageSymbolKind: DAMAGE_SYMBOL[damageSymbol] || String(damageSymbol),
      desc: resolve(M[attack.DescriptionMSID] || "", attack.AttackLogicParameters || [], { cardName: charName }),
    };
  });

  const ui = {
    weakLabel: resolve(M.common_card_detail_column_status_04 || UI.common_card_detail_column_status_04 || ""),
    retreatLabel: resolve(M.common_card_detail_column_status_05 || UI.common_card_detail_column_status_05 || ""),
    hpLabel: resolve(UI.hp || M.common_card_detail_column_status_03 || "HP"),
  };
  if (isEx) {
    ui.exRuleTitle = resolve(UI[isMega ? "megaex_rule" : "ex_rule"] || "");
    const rawBody = UI[isMega ? "megaex_pokemon_down_description" : "ex_pokemon_down_description"] || "";
    ui.exRuleIndent = +(/<line-indent=(\d+)/.exec(rawBody)?.[1] || 0);
    ui.exRuleBody = resolve(rawBody);
  }

  return {
    cardId,
    kind: "pokemon",
    name: charName(pokemon.CharacterID),
    hp: pokemon.HP,
    isEX: isEx,
    isMega,
    type: pokemon.PokemonTypes?.length ? ENERGY[pokemon.PokemonTypes[0]] : null,
    weakness: ENERGY[pokemon.WeaknessType],
    retreat: pokemon.RetreatAmount || 0,
    stage,
    stageLabel,
    preevolvedCharacterId,
    evolvesFrom,
    evolveFromText,
    evolutionSource: preevolvedCharacterId ? { characterId: preevolvedCharacterId, name: evolvesFrom, text: evolveFromText } : null,
    ...categoryData(pokemon),
    rarity: card.Rarity,
    illustrationId: card.IllustrationID,
    illustrator: (card.IllustratorNameMSIDs || []).map((key) => resolve(M[key] || "")).filter(Boolean).join(" / "),
    flavor: resolve(M[card.FlavorTextMSID] || ""),
    abilities,
    attacks,
    ui,
  };
}

if (process.argv[1] && process.argv[1].endsWith("carddata.mjs")) {
  const [, , id = "TR_20_000230_00", lc = "zh_TW"] = process.argv;
  console.log(JSON.stringify(buildCardData(id, lc), null, 1));
}
