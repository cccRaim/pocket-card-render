import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildCardData } from "./carddata.mjs";

const MASTER_ROOT = process.env.PTCG_MASTERDATA
  || "D:/DevProjectes/ptcgp-cloudbase/cloud/src/functions/app/ptcgp-masterdata/MasterData";
const LOCALE_ROOT = process.env.PTCG_LOCALE_ROOT
  || join(import.meta.dirname, "..", "..", "ptcg-apk-parser", "apks", "output");
const LOCALES = ["de_DE", "en_US", "es_ES", "fr_FR", "it_IT", "ja_JP", "ko_KR", "pt_BR", "zh_TW"];
const TRAINER_TYPE_KEYS = {
  1: "TRAINER_TYPE_SUPPORT",
  2: "TRAINER_TYPE_GOODS",
  3: "TRAINER_TYPE_EQUIPMENT",
  4: "TRAINER_TYPE_FOSSIL",
  5: "TRAINER_TYPE_STADIUM",
};
const TRAINER_FOOTER_KEYS = {
  1: "support_description",
  2: "goods_description",
  3: "goods_description",
  4: "goods_description",
  5: "stadium_description",
};
const CATEGORY_KINDS = { 1: "ultraBeast", 2: "ancient", 3: "future" };
const DAMAGE_SYMBOL_KINDS = { 1: "plus", 2: "multiply", 3: "minus" };

const readMaster = (name) => JSON.parse(readFileSync(join(MASTER_ROOT, `${name}.json`), "utf8"));
const readLocale = (locale) => JSON.parse(readFileSync(join(LOCALE_ROOT, `locale_${locale}.json`), "utf8"));
const index = (rows, key) => new Map(rows.map((row) => [row[key], row]));
const withoutRichText = (value) => !/\[(?:\/?)[A-Za-z]+(?::[A-Za-z]+)?[^\]]*\]/.test(value);

const pokemonCards = readMaster("PokemonCard");
const trainerCards = readMaster("TrainerCard");
const pokemon = readMaster("Pokemon");
const trainers = readMaster("Trainer");
const characters = readMaster("Character");
const attacks = readMaster("PokemonAttack");
const abilities = readMaster("PokemonAbility");
const abilityNames = readMaster("PokemonAbilityName");
const trainerById = index(trainers, "TrainerID");
const pokemonById = index(pokemon, "PokemonID");
const characterById = index(characters, "CharacterID");
const attackById = index(attacks, "PokemonAttackID");
const abilityById = index(abilities, "PokemonAbilityID");
const abilityNameById = index(abilityNames, "PokemonAbilityNameID");
const en = readLocale("en_US");

for (const localeName of LOCALES) {
  const locale = readLocale(localeName);
  for (const type of [1, 2, 3, 4, 5]) {
    assert(locale.Master[TRAINER_TYPE_KEYS[type]], `${localeName} lacks Trainer Type ${type} label`);
    assert(locale.UI[TRAINER_FOOTER_KEYS[type]], `${localeName} lacks Trainer Type ${type} footer`);
  }
}

for (const type of [1, 2, 3, 4, 5]) {
  const sourceCard = trainerCards.find((card) => trainerById.get(card.TrainerID).TrainerType === type);
  const actual = buildCardData(sourceCard.CardID, "en_US");
  assert.equal(actual.trainerType, type);
  assert.equal(actual.typeLabel, en.Master[TRAINER_TYPE_KEYS[type]]);
  assert.equal(actual.ui.footer, en.UI[TRAINER_FOOTER_KEYS[type]]);
}

const rightEndCard = trainerCards.find((card) => card.RightEndDisplayNameMSID);
assert(rightEndCard, "authoritative corpus lacks RightEndDisplayNameMSID coverage");
assert.equal(buildCardData(rightEndCard.CardID, "en_US").rightEndDisplayName, en.Master[rightEndCard.RightEndDisplayNameMSID]);

const fossilCard = trainerCards.find((card) => trainerById.get(card.TrainerID).TrainerType === 4);
const fossil = trainerById.get(fossilCard.TrainerID);
assert.equal(buildCardData(fossilCard.CardID, "en_US").fossilHp, Number(fossil.TrainerLogicParameters[0]));

const abilityPokemon = pokemon.find((row) => row.PokemonAbilityIDs.length > 0);
const abilityCard = pokemonCards.find((card) => card.PokemonID === abilityPokemon.PokemonID);
const abilityData = buildCardData(abilityCard.CardID, "en_US");
assert.equal(abilityData.abilities.length, abilityPokemon.PokemonAbilityIDs.length);
for (const [position, abilityId] of abilityPokemon.PokemonAbilityIDs.entries()) {
  const sourceAbility = abilityById.get(abilityId);
  const sourceName = abilityNameById.get(sourceAbility.PokemonAbilityNameID);
  assert.equal(abilityData.abilities[position].id, abilityId);
  assert.equal(abilityData.abilities[position].name, en.Master[sourceName.NameMSID]);
  assert(abilityData.abilities[position].desc.length > 0);
}

for (const category of [1, 2, 3]) {
  const sourcePokemon = pokemon.find((row) => row.AdditionalCategories.includes(category));
  const sourceCard = pokemonCards.find((card) => card.PokemonID === sourcePokemon.PokemonID);
  const actual = buildCardData(sourceCard.CardID, "en_US");
  assert.deepEqual(actual.additionalCategories, sourcePokemon.AdditionalCategories);
  assert(actual.categoryKinds.includes(CATEGORY_KINDS[category]));
}
for (const category of [2, 3]) {
  const sourceTrainer = trainers.find((row) => row.AdditionalCategories.includes(category));
  const sourceCard = trainerCards.find((card) => card.TrainerID === sourceTrainer.TrainerID);
  const actual = buildCardData(sourceCard.CardID, "en_US");
  assert.deepEqual(actual.additionalCategories, sourceTrainer.AdditionalCategories);
  assert(actual.categoryKinds.includes(CATEGORY_KINDS[category]));
}

for (const symbol of [1, 2, 3]) {
  const sourcePokemon = pokemon.find((row) => row.PokemonAttackIDs.some((id) => attackById.get(id).DamageSymbol === symbol));
  const sourceCard = pokemonCards.find((card) => card.PokemonID === sourcePokemon.PokemonID);
  const actual = buildCardData(sourceCard.CardID, "en_US");
  const actualAttack = actual.attacks.find((attack) => attack.damageSymbol === symbol);
  assert(actualAttack, `DamageSymbol ${symbol} was dropped`);
  assert.equal(actualAttack.damageSymbolKind, DAMAGE_SYMBOL_KINDS[symbol]);
}

const evolvedPokemon = pokemon.find((row) => row.PreevolvedCharacterID);
const evolvedCard = pokemonCards.find((card) => card.PokemonID === evolvedPokemon.PokemonID);
const evolvedData = buildCardData(evolvedCard.CardID, "en_US");
const preevolution = characterById.get(evolvedPokemon.PreevolvedCharacterID);
assert.equal(evolvedData.preevolvedCharacterId, evolvedPokemon.PreevolvedCharacterID);
assert.deepEqual(evolvedData.evolutionSource, {
  characterId: evolvedPokemon.PreevolvedCharacterID,
  name: en.Master[preevolution.DisplayNameMSID],
  text: `Evolves from ${en.Master[preevolution.DisplayNameMSID]}`,
});

const regionalPokemon = pokemon.find((row) => row.CharacterID === "ALOLABETBETER");
const regionalCard = pokemonCards.find((card) => card.PokemonID === regionalPokemon.PokemonID);
assert.equal(buildCardData(regionalCard.CardID, "en_US").name, "Alolan\u2005Grimer");
assert.equal(buildCardData(regionalCard.CardID, "zh_TW").name, "\u963f\u7f85\u62c9\u2005\u81ed\u6ce5");
assert(withoutRichText(buildCardData(regionalCard.CardID, "ko_KR").name));

const allCards = [...pokemonCards, ...trainerCards];
assert.equal(allCards.length, 3305);
for (const localeName of LOCALES) {
  for (const card of allCards) {
    const actual = buildCardData(card.CardID, localeName);
    assert.equal(actual.cardId, card.CardID);
    assert(withoutRichText(actual.name), `${localeName}:${card.CardID} name retains a rich-text tag: ${actual.name}`);
    if (actual.kind === "pokemon") {
      for (const ability of actual.abilities) {
        assert(withoutRichText(ability.name));
        assert(withoutRichText(ability.desc), `${localeName}:${card.CardID} ability retains a message tag: ${ability.desc}`);
      }
      for (const attack of actual.attacks) {
        assert(withoutRichText(attack.name));
        assert(withoutRichText(attack.desc), `${localeName}:${card.CardID} attack retains a message tag: ${attack.desc}`);
      }
    } else {
      assert(withoutRichText(actual.rightEndDisplayName));
      assert(withoutRichText(actual.rule), `${localeName}:${card.CardID} trainer rule retains a message tag: ${actual.rule}`);
    }
  }
}

console.log(`carddata corpus OK: ${allCards.length} cards x ${LOCALES.length} locales, all card-face message tags resolved`);
