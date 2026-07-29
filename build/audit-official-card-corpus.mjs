import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BUSINESS_ROOT = path.resolve(process.env.PCR_BUSINESS_MASTERDATA_ROOT
  || "D:/DevProjectes/ptcgp-cloudbase/cloud/src/functions/app/ptcgp-masterdata");
const MASTER_ROOT = path.join(BUSINESS_ROOT, "MasterData");
const BUSINESS_LOCALE_ROOT = path.join(BUSINESS_ROOT, "Locale");
const LOCALE_ROOT = path.resolve(process.env.PTCG_LOCALE_ROOT
  || path.join(ROOT, "..", "ptcg-apk-parser", "apks", "output"));
const CARD_DATA_SOURCE = path.join(ROOT, "build", "carddata.mjs");
const COMPOSE_SOURCE = path.join(ROOT, "build", "compose.mjs");
const LAYOUT_CONTRACT = path.join(ROOT, "public", "render", "card-ui-layout-contract.json");

const EXPECTED = Object.freeze({
  cards: 3305,
  pokemonCards: 3042,
  trainerCards: 263,
  visible: 3304,
  hidden: 1,
  trainerTypes: { 1: 173, 2: 39, 3: 31, 4: 10, 5: 10 },
});

const LOCALES = ["de_DE", "en_US", "es_ES", "fr_FR", "it_IT", "ja_JP", "ko_KR", "pt_BR", "zh_TW"];
const TRAINER_TYPE_NAMES = {
  1: "Supporter",
  2: "Item",
  3: "Pokemon Tool",
  4: "Item (Fossil)",
  5: "Stadium",
};
const CATEGORY_NAMES = { 0: "normal", 1: "ultraBeast", 2: "ancient", 3: "future" };
const DAMAGE_SYMBOL_NAMES = { 0: "plain", 1: "plus", 2: "multiply", 3: "minus" };

function readJson(filename) {
  assert(fs.existsSync(filename), `required input is absent: ${filename}`);
  return JSON.parse(fs.readFileSync(filename, "utf8"));
}

function loadTable(name) {
  const rows = readJson(path.join(MASTER_ROOT, `${name}.json`));
  assert(Array.isArray(rows), `${name}.json must contain an array`);
  return rows;
}

function indexUnique(rows, key, label) {
  const index = new Map();
  const duplicates = [];
  for (const row of rows) {
    const value = row[key];
    if (index.has(value)) duplicates.push(value);
    else index.set(value, row);
  }
  assert.deepEqual(duplicates, [], `${label}.${key} contains duplicate values`);
  return index;
}

function sortedObject(entries, numeric = false) {
  return Object.fromEntries([...entries].sort(([a], [b]) => numeric
    ? Number(a) - Number(b)
    : String(a).localeCompare(String(b))));
}

function countBy(rows, valueOf, weightOf = () => 1, numeric = false) {
  const counts = new Map();
  for (const row of rows) {
    const value = String(valueOf(row));
    counts.set(value, (counts.get(value) || 0) + weightOf(row));
  }
  return sortedObject(counts, numeric);
}

function increment(map, key, amount = 1) {
  map.set(key, (map.get(key) || 0) + amount);
}

function valuesOfObjectLiteral(source, name) {
  const body = new RegExp(`const\\s+${name}\\s*=\\s*\\{([\\s\\S]*?)\\};`).exec(source)?.[1] || "";
  const values = new Map();
  for (const match of body.matchAll(/(\d+)\s*:\s*"([^"]+)"/g)) values.set(Number(match[1]), match[2]);
  return values;
}

function keysOfObjectLiteral(source, name) {
  const body = new RegExp(`const\\s+${name}\\s*=\\s*\\{([\\s\\S]*?)\\};`).exec(source)?.[1] || "";
  return [...new Set([...body.matchAll(/(\d+)\s*:/g)].map((match) => Number(match[1])))].sort((a, b) => a - b);
}

function cardWeights(cards, foreignKey) {
  const weights = new Map();
  for (const card of cards) increment(weights, card[foreignKey]);
  return weights;
}

function categoryOf(row) {
  const values = row?.AdditionalCategories || [];
  return values.length ? values.join("+") : "0";
}

function missingJoin(sourceRows, sourceKey, targetIndex) {
  return sourceRows
    .filter((row) => !targetIndex.has(row[sourceKey]))
    .map((row) => row[sourceKey])
    .sort();
}

assert(fs.existsSync(MASTER_ROOT), `authoritative MasterData root is absent: ${MASTER_ROOT}`);
assert(fs.existsSync(BUSINESS_LOCALE_ROOT), `authoritative Locale root is absent: ${BUSINESS_LOCALE_ROOT}`);

const pokemonCards = loadTable("PokemonCard");
const trainerCards = loadTable("TrainerCard");
const pokemon = loadTable("Pokemon");
const trainers = loadTable("Trainer");
const characters = loadTable("Character");
const attacks = loadTable("PokemonAttack");
const attackNames = loadTable("PokemonAttackName");
const abilities = loadTable("PokemonAbility");
const abilityNames = loadTable("PokemonAbilityName");
const collectionNumbers = loadTable("ExpansionCollectionNumber");

const pokemonCardIndex = indexUnique(pokemonCards, "CardID", "PokemonCard");
const trainerCardIndex = indexUnique(trainerCards, "CardID", "TrainerCard");
const pokemonIndex = indexUnique(pokemon, "PokemonID", "Pokemon");
const trainerIndex = indexUnique(trainers, "TrainerID", "Trainer");
const characterIndex = indexUnique(characters, "CharacterID", "Character");
const attackIndex = indexUnique(attacks, "PokemonAttackID", "PokemonAttack");
const attackNameIndex = indexUnique(attackNames, "PokemonAttackNameID", "PokemonAttackName");
const abilityIndex = indexUnique(abilities, "PokemonAbilityID", "PokemonAbility");
const abilityNameIndex = indexUnique(abilityNames, "PokemonAbilityNameID", "PokemonAbilityName");

const allCards = [...pokemonCards, ...trainerCards];
const allCardIds = allCards.map((card) => card.CardID);
const duplicateCrossTypeCardIds = allCardIds.filter((id) => pokemonCardIndex.has(id) && trainerCardIndex.has(id));
assert.deepEqual(duplicateCrossTypeCardIds, [], "PokemonCard and TrainerCard CardID domains overlap");

const pokemonWeights = cardWeights(pokemonCards, "PokemonID");
const trainerWeights = cardWeights(trainerCards, "TrainerID");

const joins = {
  pokemonCardToPokemon: missingJoin(pokemonCards, "PokemonID", pokemonIndex),
  trainerCardToTrainer: missingJoin(trainerCards, "TrainerID", trainerIndex),
  pokemonToCharacter: missingJoin(pokemon, "CharacterID", characterIndex),
  trainerToCharacter: missingJoin(trainers, "CharacterID", characterIndex),
  pokemonToAttack: [],
  pokemonToAbility: [],
  attackToName: missingJoin(attacks, "PokemonAttackNameID", attackNameIndex),
  abilityToName: missingJoin(abilities, "PokemonAbilityNameID", abilityNameIndex),
  collectionNumberToCard: [],
  cardToCollectionNumber: [],
};

for (const row of pokemon) {
  for (const id of row.PokemonAttackIDs || []) if (!attackIndex.has(id)) joins.pokemonToAttack.push(`${row.PokemonID}:${id}`);
  for (const id of row.PokemonAbilityIDs || []) if (!abilityIndex.has(id)) joins.pokemonToAbility.push(`${row.PokemonID}:${id}`);
}

const allCardIdSet = new Set(allCardIds);
const collectionCardIdSet = new Set(collectionNumbers.map((row) => row.CardID));
joins.collectionNumberToCard = [...collectionCardIdSet].filter((id) => !allCardIdSet.has(id)).sort();
joins.cardToCollectionNumber = [...allCardIdSet].filter((id) => !collectionCardIdSet.has(id)).sort();

const joinMissingCounts = Object.fromEntries(Object.entries(joins).map(([name, values]) => [name, values.length]));
const totalJoinMissing = Object.values(joinMissingCounts).reduce((sum, count) => sum + count, 0);
assert.equal(totalJoinMissing, 0, `authoritative joins are broken: ${JSON.stringify(joinMissingCounts)}`);
assert.equal(new Set(pokemonCards.map((card) => card.PokemonID)).size, pokemon.length, "unreferenced Pokemon definitions exist");
assert.equal(new Set(trainerCards.map((card) => card.TrainerID)).size, trainers.length, "unreferenced Trainer definitions exist");

const visible = allCards.filter((card) => !card.IsNotDisplayedOutgame).length;
const hidden = allCards.length - visible;
const trainerTypeCards = countBy(
  trainerCards,
  (card) => trainerIndex.get(card.TrainerID).TrainerType,
  () => 1,
  true,
);
const trainerTypeDefinitions = countBy(trainers, (row) => row.TrainerType, () => 1, true);

assert.equal(pokemonCards.length, EXPECTED.pokemonCards, "PokemonCard corpus drifted");
assert.equal(trainerCards.length, EXPECTED.trainerCards, "TrainerCard corpus drifted");
assert.equal(allCards.length, EXPECTED.cards, "total CardID corpus drifted");
assert.equal(new Set(allCardIds).size, EXPECTED.cards, "CardID uniqueness drifted");
assert.equal(visible, EXPECTED.visible, "visible CardID count drifted");
assert.equal(hidden, EXPECTED.hidden, "hidden CardID count drifted");
assert.deepEqual(trainerTypeCards, EXPECTED.trainerTypes, "Trainer Type card counts drifted");

const pokemonByStage = countBy(pokemon, (row) => row.EvolutionStage, () => 1, true);
const pokemonCardsByStage = countBy(pokemon, (row) => row.EvolutionStage, (row) => pokemonWeights.get(row.PokemonID), true);
const pokemonByCategory = countBy(pokemon, categoryOf, () => 1, true);
const pokemonCardsByCategory = countBy(pokemon, categoryOf, (row) => pokemonWeights.get(row.PokemonID), true);
const trainerByCategory = countBy(trainers, categoryOf, () => 1, true);
const trainerCardsByCategory = countBy(trainers, categoryOf, (row) => trainerWeights.get(row.TrainerID), true);

function exKind(row) {
  if (row.IsMegaEvolution) return "megaEx";
  return row.IsEX ? "ex" : "normal";
}

function skillShape(row) {
  return `A${(row.PokemonAbilityIDs || []).length}T${(row.PokemonAttackIDs || []).length}`;
}

const attackUsageByDamageSymbol = new Map();
const attackUsageByCostLength = new Map();
for (const row of pokemon) {
  const weight = pokemonWeights.get(row.PokemonID);
  for (const attackId of row.PokemonAttackIDs || []) {
    const attack = attackIndex.get(attackId);
    increment(attackUsageByDamageSymbol, DAMAGE_SYMBOL_NAMES[attack.DamageSymbol] || String(attack.DamageSymbol), weight);
    increment(attackUsageByCostLength, String((attack.AttackCost || []).length), weight);
  }
}

const layout = readJson(LAYOUT_CONTRACT);
assert.equal(layout.schemaVersion, 3, "unsupported card UI layout contract schema");
const layoutNodeNames = new Set();
const layoutTmpNodes = [];
function collectLayoutNodes(node) {
  layoutNodeNames.add(node.gameObject.name);
  if (node.tmp) layoutTmpNodes.push(node);
  for (const child of node.children || []) collectLayoutNodes(child);
}
for (const prefab of layout.prefabs || []) for (const root of prefab.roots || []) collectLayoutNodes(root);

for (const node of layoutTmpNodes) {
  const tagFontSizes = node.tagFontSizes;
  assert(tagFontSizes, `${node.gameObject.name} lost its official tag-font-size localizer`);
  assert.match(tagFontSizes.pathId, /^-?\d+$/, `${node.gameObject.name} has an invalid localizer PathID`);
  assert.match(tagFontSizes.objectSha256, /^[0-9a-f]{64}$/, `${node.gameObject.name} has an invalid localizer object hash`);
  assert.equal(Number.isFinite(tagFontSizes.element), true, `${node.gameObject.name} has an invalid element tag font size`);
  assert.equal(Number.isFinite(tagFontSizes.ex), true, `${node.gameObject.name} has an invalid ex tag font size`);
}
assert.equal(layoutTmpNodes.length, layout.summary.tmpComponentCount, "layout TMP summary count drifted");
assert.equal(layoutTmpNodes.length, layout.summary.tagFontSizeComponentCount, "layout tag-font-size summary count drifted");
for (const prefab of layout.prefabs || []) {
  const nodes = [];
  function collectPrefabTmp(node) {
    if (node.tmp) nodes.push(node);
    for (const child of node.children || []) collectPrefabTmp(child);
  }
  for (const root of prefab.roots || []) collectPrefabTmp(root);
  assert.equal(nodes.length, prefab.tmpComponentCount, `${prefab.kind} TMP count drifted`);
  assert.equal(nodes.length, prefab.tagFontSizeComponentCount, `${prefab.kind} tag-font-size count drifted`);
}

const requiredLayoutNodes = [
  "PokemonAbilityContainerView",
  "PokemonSkillContainerView_01",
  "PokemonSkillContainerView_02",
  "UltraBeastView",
  "AncientView",
  "FutureView",
  "PokemonExRuleView",
  "PokemoMegaExRuleView",
  "TxtSupportCardNameElm",
  "TxtToolsCardNameElm",
  "TxtItemCardNameElm",
  "TxtStadiumCardNameElm",
  "TxtFossilCardNameElm",
];
const missingLayoutNodes = requiredLayoutNodes.filter((name) => !layoutNodeNames.has(name));
assert.deepEqual(missingLayoutNodes, [], "official layout contract lost required archetype nodes");

const cardDataSource = fs.readFileSync(CARD_DATA_SOURCE, "utf8");
const composeSource = fs.readFileSync(COMPOSE_SOURCE, "utf8");
const implementationTrainerTypeMap = valuesOfObjectLiteral(cardDataSource, "TRAINER_TYPE");
const implementationTrainerFooterMap = valuesOfObjectLiteral(cardDataSource, "TRAINER_FOOTER");
const implementationTrainerLabelTypes = keysOfObjectLiteral(composeSource, "TYPE_LABEL");

const localeReports = {};
const relevantReferences = [];

function addReference(field, ownerId, msid, cardIds) {
  if (!msid) return;
  relevantReferences.push({ field, ownerId, msid, cardIds });
}

for (const row of pokemon) {
  const cardIds = pokemonCards.filter((card) => card.PokemonID === row.PokemonID).map((card) => card.CardID);
  addReference("pokemonName", row.PokemonID, characterIndex.get(row.CharacterID).DisplayNameMSID, cardIds);
  for (const id of row.PokemonAttackIDs || []) {
    const attack = attackIndex.get(id);
    addReference("attackName", id, attackNameIndex.get(attack.PokemonAttackNameID).NameMSID, cardIds);
    addReference("attackDescription", id, attack.DescriptionMSID, cardIds);
  }
  for (const id of row.PokemonAbilityIDs || []) {
    const ability = abilityIndex.get(id);
    addReference("abilityName", id, abilityNameIndex.get(ability.PokemonAbilityNameID).NameMSID, cardIds);
    addReference("abilityDescription", id, ability.DescriptionMSID, cardIds);
  }
}
for (const card of pokemonCards) {
  addReference("flavor", card.CardID, card.FlavorTextMSID, [card.CardID]);
  for (const msid of card.IllustratorNameMSIDs || []) addReference("illustrator", card.CardID, msid, [card.CardID]);
}
for (const row of trainers) {
  const cardIds = trainerCards.filter((card) => card.TrainerID === row.TrainerID).map((card) => card.CardID);
  addReference("trainerName", row.TrainerID, characterIndex.get(row.CharacterID).DisplayNameMSID, cardIds);
  addReference("trainerDescription", row.TrainerID, row.DescriptionMSID, cardIds);
}
for (const card of trainerCards) {
  addReference("trainerSubName", card.CardID, card.RightEndDisplayNameMSID, [card.CardID]);
  for (const msid of card.IllustratorNameMSIDs || []) addReference("illustrator", card.CardID, msid, [card.CardID]);
}

for (const locale of LOCALES) {
  const value = readJson(path.join(LOCALE_ROOT, `locale_${locale}.json`));
  assert(value.Master && value.UI, `locale_${locale}.json must contain Master and UI maps`);
  const missingByField = new Map();
  const affectedByField = new Map();
  const residualNameTagCards = new Set();
  for (const reference of relevantReferences) {
    if ((reference.field === "pokemonName" || reference.field === "trainerName")
      && /\[[A-Za-z]/.test(value.Master[reference.msid] || "")) {
      for (const cardId of reference.cardIds) residualNameTagCards.add(cardId);
    }
    if (value.Master[reference.msid]) continue;
    increment(missingByField, reference.field);
    const affected = affectedByField.get(reference.field) || new Set();
    for (const cardId of reference.cardIds) affected.add(cardId);
    affectedByField.set(reference.field, affected);
  }

  const emptyTypeLabelCards = new Set();
  const emptyFooterCards = new Map();
  for (const card of trainerCards) {
    const type = trainerIndex.get(card.TrainerID).TrainerType;
    const typeKey = implementationTrainerTypeMap.get(type);
    if (!typeKey || !value.Master[typeKey]) emptyTypeLabelCards.add(card.CardID);
    const footerKey = implementationTrainerFooterMap.get(type);
    if (!footerKey || !value.UI[footerKey]) {
      const ids = emptyFooterCards.get(type) || new Set();
      ids.add(card.CardID);
      emptyFooterCards.set(type, ids);
    }
  }

  localeReports[locale] = {
    missingMasterKeysByField: sortedObject(missingByField),
    affectedCardsByField: sortedObject([...affectedByField].map(([field, ids]) => [field, ids.size])),
    currentImplementationEmptyNames: (affectedByField.get("pokemonName")?.size || 0)
      + (affectedByField.get("trainerName")?.size || 0),
    currentImplementationEmptyAttackNames: affectedByField.get("attackName")?.size || 0,
    currentImplementationResidualNameTags: residualNameTagCards.size,
    currentImplementationEmptyTrainerTypeLabels: emptyTypeLabelCards.size,
    currentImplementationEmptyTrainerFootersByType: sortedObject(
      [...emptyFooterCards].map(([type, ids]) => [String(type), ids.size]),
      true,
    ),
  };
}

const businessEnglish = readJson(path.join(BUSINESS_LOCALE_ROOT, "en.json"));
assert(businessEnglish.Master, "authoritative English locale must contain Master map");

const tagReferences = [];
function addTagText(field, ownerId, text, weight) {
  if (text) tagReferences.push({ field, ownerId, text, weight });
}
for (const reference of relevantReferences) {
  addTagText(reference.field, reference.ownerId, businessEnglish.Master[reference.msid], reference.cardIds.length);
}

const tagStats = new Map();
for (const reference of tagReferences) {
  for (const match of reference.text.matchAll(/\[(\/)?([A-Za-z]+(?::[A-Za-z]+)?)[^\]]*\]/g)) {
    if (match[1]) continue;
    const tag = match[2];
    const stat = tagStats.get(tag) || { occurrences: 0, weightedCardReferences: 0, fields: new Set() };
    stat.occurrences += 1;
    stat.weightedCardReferences += reference.weight;
    stat.fields.add(reference.field);
    tagStats.set(tag, stat);
  }
}

const explicitTagSupport = new Set(
  [
    "Num:Int", "Text:CardName", "Text:AdditionalName", "Text:Char", "Gr:Pron",
    "Ctrl:OL", "Ctrl:LI", "Img:ex", "Ctrl:Bold", "C:Nbsp", "C:Nnbsp",
  ]
    .filter((tag) => cardDataSource.includes(tag)),
);
const tagReport = [...tagStats]
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([tag, stat]) => ({
    tag,
    occurrences: stat.occurrences,
    weightedCardReferences: stat.weightedCardReferences,
    fields: [...stat.fields].sort(),
    explicitlyHandledByCurrentResolver: explicitTagSupport.has(tag),
  }));

const taggedCharacterNameCards = new Set();
for (const row of [...pokemon, ...trainers]) {
  const text = businessEnglish.Master[characterIndex.get(row.CharacterID).DisplayNameMSID] || "";
  if (!/\[[A-Za-z]/.test(text)) continue;
  const cards = row.PokemonID
    ? pokemonCards.filter((card) => card.PokemonID === row.PokemonID)
    : trainerCards.filter((card) => card.TrainerID === row.TrainerID);
  for (const card of cards) taggedCharacterNameCards.add(card.CardID);
}

const abilityCards = pokemon.reduce(
  (sum, row) => sum + ((row.PokemonAbilityIDs || []).length ? pokemonWeights.get(row.PokemonID) : 0),
  0,
);
const categorizedPokemonCards = pokemon.reduce(
  (sum, row) => sum + ((row.AdditionalCategories || []).length ? pokemonWeights.get(row.PokemonID) : 0),
  0,
);
const categorizedTrainerCards = trainers.reduce(
  (sum, row) => sum + ((row.AdditionalCategories || []).length ? trainerWeights.get(row.TrainerID) : 0),
  0,
);
const evolutionCards = pokemon.reduce(
  (sum, row) => sum + (row.PreevolvedCharacterID ? pokemonWeights.get(row.PokemonID) : 0),
  0,
);
const nonPlainDamageSymbolReferences = [...attackUsageByDamageSymbol]
  .filter(([symbol]) => symbol !== "plain")
  .reduce((sum, [, count]) => sum + count, 0);

const report = {
  schemaVersion: 1,
  authority: {
    businessRoot: BUSINESS_ROOT,
    masterDataRoot: MASTER_ROOT,
    businessLocaleRoot: BUSINESS_LOCALE_ROOT,
  },
  census: {
    cardIds: allCards.length,
    uniqueCardIds: new Set(allCardIds).size,
    pokemonCards: pokemonCards.length,
    trainerCards: trainerCards.length,
    visible,
    hidden,
    pokemonDefinitions: pokemon.length,
    trainerDefinitions: trainers.length,
    uniqueIllustrationIds: new Set(allCards.map((card) => card.IllustrationID)).size,
    promotionCards: allCards.filter((card) => card.IsPromotion).length,
    mirrorCards: allCards.filter((card) => Number(card.MirrorType) !== 0).length,
    serialCards: allCards.filter((card) => card.IsSerial).length,
  },
  trainerTypes: {
    cards: Object.fromEntries(Object.entries(trainerTypeCards).map(([type, count]) => [type, {
      officialEnglishName: TRAINER_TYPE_NAMES[type],
      count,
    }])),
    definitions: trainerTypeDefinitions,
  },
  joins: {
    totalMissing: totalJoinMissing,
    missingByJoin: joinMissingCounts,
  },
  archetypes: {
    pokemon: {
      definitionsByStage: pokemonByStage,
      cardsByStage: pokemonCardsByStage,
      definitionsByExKind: countBy(pokemon, exKind),
      cardsByExKind: countBy(pokemon, exKind, (row) => pokemonWeights.get(row.PokemonID)),
      definitionsBySkillShape: countBy(pokemon, skillShape),
      cardsBySkillShape: countBy(pokemon, skillShape, (row) => pokemonWeights.get(row.PokemonID)),
      definitionsByCategory: Object.fromEntries(Object.entries(pokemonByCategory).map(([category, count]) => [CATEGORY_NAMES[category] || category, count])),
      cardsByCategory: Object.fromEntries(Object.entries(pokemonCardsByCategory).map(([category, count]) => [CATEGORY_NAMES[category] || category, count])),
      attackCardReferencesByDamageSymbol: sortedObject(attackUsageByDamageSymbol),
      attackCardReferencesByCostLength: sortedObject(attackUsageByCostLength, true),
    },
    trainer: {
      definitionsByCategory: Object.fromEntries(Object.entries(trainerByCategory).map(([category, count]) => [CATEGORY_NAMES[category] || category, count])),
      cardsByCategory: Object.fromEntries(Object.entries(trainerCardsByCategory).map(([category, count]) => [CATEGORY_NAMES[category] || category, count])),
      cardsWithRightEndDisplayName: trainerCards.filter((card) => card.RightEndDisplayNameMSID).length,
    },
  },
  inputs: {
    rendererLocaleRoot: LOCALE_ROOT,
    locales: localeReports,
    compose: {
      cardDataSource: CARD_DATA_SOURCE,
      composeSource: COMPOSE_SOURCE,
      layoutContract: LAYOUT_CONTRACT,
      layoutSchemaVersion: layout.schemaVersion,
      tmpComponentsWithOfficialTagFontSizes: layoutTmpNodes.length,
      requiredArchetypeNodesPresent: requiredLayoutNodes.length,
      requiredArchetypeNodesMissing: missingLayoutNodes,
    },
  },
  implementationGaps: {
    currentTrainerTypeMappings: Object.fromEntries([...implementationTrainerTypeMap]),
    currentTrainerFooterMappings: Object.fromEntries([...implementationTrainerFooterMap]),
    currentTrainerLabelMappedTypes: implementationTrainerLabelTypes,
    trainerLabelFallsBackToSupporter: /TYPE_LABEL\[cd\.trainerType\]\s*\|\|\s*TYPE_LABEL\[1\]/.test(composeSource),
    trainerComposerUsesOnlySupportNameNode: composeSource.includes('node("txt_support_card_name_main")')
      && !composeSource.includes('node("txt_tools_card_name_main")'),
    ability: {
      definitions: pokemon.filter((row) => (row.PokemonAbilityIDs || []).length > 0).length,
      cards: abilityCards,
      parsedByCardData: /load\(["']PokemonAbility["']\)/.test(cardDataSource),
      composed: composeSource.includes("PokemonAbilityContainerView"),
    },
    classification: {
      pokemonCards: categorizedPokemonCards,
      trainerCards: categorizedTrainerCards,
      parsedByCardData: cardDataSource.includes("AdditionalCategories"),
      composed: ["UltraBeastView", "AncientView", "FutureView"].some((name) => composeSource.includes(name)),
    },
    evolution: {
      cardsWithPreevolution: evolutionCards,
      sourceComposed: composeSource.includes("source_img") || composeSource.includes("evolveFromText"),
    },
    damageSymbol: {
      nonPlainAttackCardReferences: nonPlainDamageSymbolReferences,
      composed: composeSource.includes("damageSymbol"),
    },
    trainerSubName: {
      cards: trainerCards.filter((card) => card.RightEndDisplayNameMSID).length,
      parsedByCardData: cardDataSource.includes("RightEndDisplayNameMSID"),
    },
    taggedCharacterNames: {
      sourceCards: taggedCharacterNameCards.size,
      characterNamePassedThroughResolver: /const\s+charName[^;]*resolve/.test(cardDataSource),
    },
    richTextTags: tagReport,
  },
};

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
