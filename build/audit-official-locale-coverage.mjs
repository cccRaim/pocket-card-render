import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const MASTER_ROOT = path.resolve(process.env.PTCG_MASTERDATA
  || "D:/DevProjectes/ptcgp-cloudbase/cloud/src/functions/app/ptcgp-masterdata/MasterData");
const LOCALE_ROOT = path.resolve(process.env.PTCG_LOCALE_ROOT
  || path.join(import.meta.dirname, "..", "..", "ptcg-apk-parser", "apks", "output"));
const LOCALES = ["de_DE", "en_US", "es_ES", "fr_FR", "it_IT", "ja_JP", "ko_KR", "pt_BR", "zh_TW"];
const TABLES = [
  "Character", "Pokemon", "PokemonAbility", "PokemonAbilityName", "PokemonAttack",
  "PokemonAttackName", "PokemonCard", "Trainer", "TrainerCard",
];

function readBytes(filename) {
  assert(fs.existsSync(filename), `required authoritative input is absent: ${filename}`);
  return fs.readFileSync(filename);
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function readJson(filename) {
  return JSON.parse(readBytes(filename).toString("utf8"));
}

function loadTable(name) {
  const filename = path.join(MASTER_ROOT, `${name}.json`);
  const bytes = readBytes(filename);
  const rows = JSON.parse(bytes.toString("utf8"));
  assert(Array.isArray(rows), `${filename} must contain an array`);
  return { filename, bytes, rows };
}

function indexUnique(rows, key, label) {
  const result = new Map();
  for (const row of rows) {
    assert(!result.has(row[key]), `${label}.${key} contains duplicate ${row[key]}`);
    result.set(row[key], row);
  }
  return result;
}

function hasText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function groupBy(rows, keyOf) {
  const result = new Map();
  for (const row of rows) {
    const key = keyOf(row);
    const values = result.get(key) || [];
    values.push(row);
    result.set(key, values);
  }
  return result;
}

const tables = Object.fromEntries(TABLES.map((name) => [name, loadTable(name)]));
const pokemonCards = tables.PokemonCard.rows;
const trainerCards = tables.TrainerCard.rows;
const pokemon = tables.Pokemon.rows;
const trainers = tables.Trainer.rows;
const characters = indexUnique(tables.Character.rows, "CharacterID", "Character");
const attacks = indexUnique(tables.PokemonAttack.rows, "PokemonAttackID", "PokemonAttack");
const attackNames = indexUnique(tables.PokemonAttackName.rows, "PokemonAttackNameID", "PokemonAttackName");
const abilities = indexUnique(tables.PokemonAbility.rows, "PokemonAbilityID", "PokemonAbility");
const abilityNames = indexUnique(tables.PokemonAbilityName.rows, "PokemonAbilityNameID", "PokemonAbilityName");
const pokemonCardsByDefinition = groupBy(pokemonCards, (card) => card.PokemonID);
const trainerCardsByDefinition = groupBy(trainerCards, (card) => card.TrainerID);
const references = [];

function addReference(field, ownerId, msid, cardIds) {
  if (msid) references.push({ field, ownerId, msid, cardIds });
}

for (const row of pokemon) {
  const cardIds = (pokemonCardsByDefinition.get(row.PokemonID) || []).map((card) => card.CardID);
  addReference("pokemonName", row.PokemonID, characters.get(row.CharacterID)?.DisplayNameMSID, cardIds);
  for (const id of row.PokemonAttackIDs || []) {
    const attack = attacks.get(id);
    assert(attack, `Pokemon ${row.PokemonID} references absent attack ${id}`);
    addReference("attackName", id, attackNames.get(attack.PokemonAttackNameID)?.NameMSID, cardIds);
    addReference("attackDescription", id, attack.DescriptionMSID, cardIds);
  }
  for (const id of row.PokemonAbilityIDs || []) {
    const ability = abilities.get(id);
    assert(ability, `Pokemon ${row.PokemonID} references absent ability ${id}`);
    addReference("abilityName", id, abilityNames.get(ability.PokemonAbilityNameID)?.NameMSID, cardIds);
    addReference("abilityDescription", id, ability.DescriptionMSID, cardIds);
  }
}
for (const card of pokemonCards) {
  addReference("flavor", card.CardID, card.FlavorTextMSID, [card.CardID]);
  for (const msid of card.IllustratorNameMSIDs || []) addReference("illustrator", card.CardID, msid, [card.CardID]);
}
for (const row of trainers) {
  const cardIds = (trainerCardsByDefinition.get(row.TrainerID) || []).map((card) => card.CardID);
  addReference("trainerName", row.TrainerID, characters.get(row.CharacterID)?.DisplayNameMSID, cardIds);
  addReference("trainerDescription", row.TrainerID, row.DescriptionMSID, cardIds);
}
for (const card of trainerCards) {
  addReference("trainerSubName", card.CardID, card.RightEndDisplayNameMSID, [card.CardID]);
  for (const msid of card.IllustratorNameMSIDs || []) addReference("illustrator", card.CardID, msid, [card.CardID]);
}

const staticReferences = [
  { field: "trainerType", section: "Master", keys: ["TRAINER_TYPE_SUPPORT", "TRAINER_TYPE_GOODS", "TRAINER_TYPE_EQUIPMENT", "TRAINER_TYPE_FOSSIL", "TRAINER_TYPE_STADIUM"] },
  { field: "trainerFooter", section: "UI", keys: ["support_description", "goods_description", "stadium_description"] },
  { field: "evolutionStage", section: "Master", keys: ["EVOLUTION_STAGE_Basic", "EVOLUTION_STAGE_One", "EVOLUTION_STAGE_Two"] },
  { field: "evolutionFrom", section: "UI", keys: ["evolution_from"] },
  { field: "exRule", section: "UI", keys: ["ex_rule", "ex_pokemon_down_description"] },
  { field: "megaExRule", section: "UI", keys: ["megaex_rule", "megaex_pokemon_down_description"] },
];
const alternativeReferences = [
  { field: "categoryLabel", candidates: [["UI", "common_card_detail_column_status_07"], ["Master", "common_card_detail_column_status_07"]] },
  { field: "weaknessLabel", candidates: [["Master", "common_card_detail_column_status_04"], ["UI", "common_card_detail_column_status_04"]] },
  { field: "retreatLabel", candidates: [["Master", "common_card_detail_column_status_05"], ["UI", "common_card_detail_column_status_05"]] },
  { field: "hpLabel", candidates: [["UI", "hp"], ["Master", "common_card_detail_column_status_03"]] },
];

const provenancePath = path.join(LOCALE_ROOT, "locale-provenance.json");
const provenance = readJson(provenancePath);
assert.equal(provenance.schemaVersion, 1, "unsupported locale provenance schema");
assert(provenance.assetIndex, "locale provenance is not tied to an official Aladin index");
assert(provenance.assetCatalog, "locale provenance is not tied to the parsed official asset catalog");
const indexBytes = readBytes(provenance.assetIndex.path);
assert.equal(path.parse(provenance.assetIndex.path).name, provenance.assetIndex.aladdinHash, "Aladdin hash does not match index filename");
assert.equal(sha256(indexBytes), provenance.assetIndex.sha256, "official asset index hash drifted");
const catalogBytes = readBytes(provenance.assetCatalog.path);
assert.equal(sha256(catalogBytes), provenance.assetCatalog.sha256, "official asset catalog hash drifted");
const catalog = readJson(provenance.assetCatalog.path);
assert.equal(catalog.length, provenance.assetCatalog.entryCount, "official asset catalog entry count drifted");
const catalogByPath = new Map(catalog.map((entry) => [entry.path, entry]));

const localeReports = {};
let totalMissing = 0;
let totalEmpty = 0;
for (const locale of LOCALES) {
  const localePath = path.join(LOCALE_ROOT, `locale_${locale}.json`);
  const localeBytes = readBytes(localePath);
  const value = JSON.parse(localeBytes.toString("utf8"));
  assert(value.Master && value.UI, `${localePath} must contain Master and UI maps`);
  const source = provenance.locales?.[locale];
  assert(source, `locale provenance omitted ${locale}`);
  const assetPath = `Common/Locale/${locale}_bundles`;
  assert.deepEqual(source.asset, catalogByPath.get(assetPath), `${locale} catalog identity drifted`);
  const bundleBytes = readBytes(source.bundlePath);
  assert.equal(sha256(bundleBytes), source.bundleSha256, `${locale} bundle hash drifted`);
  assert.equal(bundleBytes.length, source.bundleByteLength, `${locale} bundle size drifted`);
  assert.equal(sha256(localeBytes), source.outputSha256, `${locale} extracted JSON hash drifted`);
  assert.equal(path.resolve(source.outputPath), localePath, `${locale} output provenance points at another file`);

  const missing = [];
  const empty = [];
  for (const reference of references) {
    if (!(reference.msid in value.Master)) missing.push({ field: reference.field, key: reference.msid });
    else if (!hasText(value.Master[reference.msid])) empty.push({ field: reference.field, key: reference.msid });
  }
  for (const group of staticReferences) {
    for (const key of group.keys) {
      const section = value[group.section];
      if (!(key in section)) missing.push({ field: group.field, key: `${group.section}.${key}` });
      else if (!hasText(section[key])) empty.push({ field: group.field, key: `${group.section}.${key}` });
    }
  }
  for (const group of alternativeReferences) {
    if (!group.candidates.some(([section, key]) => hasText(value[section]?.[key]))) {
      missing.push({ field: group.field, key: group.candidates.map(([section, key]) => `${section}.${key}`).join("|") });
    }
  }
  totalMissing += missing.length;
  totalEmpty += empty.length;
  localeReports[locale] = {
    outputSha256: sha256(localeBytes),
    bundleSha256: source.bundleSha256,
    blobHash: source.asset.blobHash,
    masterEntries: Object.keys(value.Master).length,
    uiEntries: Object.keys(value.UI).length,
    evaluatedDynamicReferences: references.length,
    missingCount: missing.length,
    emptyCount: empty.length,
    missing: missing.slice(0, 50),
    empty: empty.slice(0, 50),
  };
}

assert.equal(totalMissing, 0, `official locale closure has ${totalMissing} missing card-face references`);
assert.equal(totalEmpty, 0, `official locale closure has ${totalEmpty} empty card-face references`);
const uniqueMasterKeys = new Set(references.map((reference) => reference.msid));
const report = {
  schemaVersion: 1,
  exact: true,
  authority: {
    masterDataRoot: MASTER_ROOT,
    localeRoot: LOCALE_ROOT,
    assetAladdinHash: provenance.assetIndex.aladdinHash,
    assetIndexSha256: provenance.assetIndex.sha256,
    assetCatalogSha256: provenance.assetCatalog.sha256,
  },
  masterData: {
    cards: pokemonCards.length + trainerCards.length,
    pokemonCards: pokemonCards.length,
    trainerCards: trainerCards.length,
    tables: Object.fromEntries(TABLES.map((name) => [name, {
      rowCount: tables[name].rows.length,
      sha256: sha256(tables[name].bytes),
    }])),
  },
  coverage: {
    locales: LOCALES.length,
    dynamicReferencesPerLocale: references.length,
    uniqueMasterKeys: uniqueMasterKeys.size,
    staticReferencesPerLocale: staticReferences.reduce((sum, group) => sum + group.keys.length, 0),
    alternativeReferencesPerLocale: alternativeReferences.length,
    evaluatedDynamicReferences: references.length * LOCALES.length,
    totalMissing,
    totalEmpty,
  },
  locales: localeReports,
};

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
