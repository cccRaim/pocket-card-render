import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  officialSample,
  officialSampleSha256,
} from "./official-sample.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MASTER_ROOT = path.resolve(
  process.env.PCR_MASTERDATA
    || "D:/DevProjectes/ptcgp-cloudbase/cloud/src/functions/app/ptcgp-masterdata/MasterData",
);
const DESIGN_CONTRACT = path.join(
  ROOT,
  "public",
  "render",
  "card-text-design-contract.json",
);
const FONT_CONTRACT = path.join(
  ROOT,
  "public",
  "render",
  "card-font-contract.json",
);
const OUTPUT = path.join(
  ROOT,
  "build",
  "official-text-variant-corpus.json",
);

const EXPECTED = Object.freeze({
  masterdataCards: 3305,
  sourceCurrentCards: 3191,
  assetGapCards: 114,
  kindRarities: 16,
  visualPairs: 106,
  fontGroups: 10,
  dynamicUIStateVectors: 4,
});

function compareText(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function readJsonBytes(filename) {
  const bytes = fs.readFileSync(filename);
  const text = bytes.toString("utf8");
  assertNoUnicodeReplacement(text, path.relative(ROOT, filename));
  return { bytes, value: JSON.parse(text) };
}

function assertNoUnicodeReplacement(value, label) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  assert(
    !text.includes("\uFFFD"),
    `${label} contains U+FFFD replacement characters`,
  );
}

function indexUnique(rows, key, label) {
  const result = new Map();
  for (const row of rows) {
    const value = row[key];
    assert(!result.has(value), `${label} has duplicate ${key} ${value}`);
    result.set(value, row);
  }
  return result;
}

function sortedUnique(values) {
  return [...new Set(values)].sort(compareText);
}

function increment(map, key) {
  map.set(key, (map.get(key) || 0) + 1);
}

function dynamicUIStateVector(design) {
  const states = (design.dynamicUIs || [])
    .map((entry) => ({
      label: entry.label,
      controllerPath: entry.controller.path,
      targetName: entry.target?.name ?? null,
      targetPath: entry.target?.path ?? null,
    }))
    .sort((a, b) => compareText(a.label, b.label)
      || compareText(a.controllerPath, b.controllerPath));
  assert(states.length > 0, `${design.name} has no DynamicUI state`);
  return {
    id: states
      .map((state) => `${state.label}=${state.targetName ?? "null"}`)
      .join("|"),
    states,
  };
}

function obligationIds(card) {
  return [
    `visual-pair:${card.visualPairId}`,
    `kind-rarity:${card.kindRarityId}`,
    `font-group:${card.fontGroup}`,
    `dynamic-ui:${card.dynamicUIStateId}`,
  ].sort(compareText);
}

function deterministicSetCover(cards, universe) {
  const uncovered = new Set(universe);
  const remaining = new Map(cards.map((card) => [card.illustrationId, card]));
  const steps = [];

  while (uncovered.size > 0) {
    let best = null;
    let bestNew = [];
    for (const card of remaining.values()) {
      const newlyCovered = card.obligations.filter((id) => uncovered.has(id));
      if (
        newlyCovered.length > bestNew.length
        || (
          newlyCovered.length === bestNew.length
          && newlyCovered.length > 0
          && (
            best === null
            || compareText(card.cardId, best.cardId) < 0
            || (
              card.cardId === best.cardId
              && compareText(card.illustrationId, best.illustrationId) < 0
            )
          )
        )
      ) {
        best = card;
        bestNew = newlyCovered;
      }
    }
    assert(best && bestNew.length > 0, [
      "set-cover cannot cover obligations:",
      ...[...uncovered].sort(compareText),
    ].join(" "));
    remaining.delete(best.illustrationId);
    for (const id of bestNew) uncovered.delete(id);
    steps.push({
      rank: steps.length + 1,
      cardId: best.cardId,
      illustrationId: best.illustrationId,
      kind: best.kind,
      rarity: best.rarity,
      design: best.design,
      fontGroup: best.fontGroup,
      visualPairId: best.visualPairId,
      kindRarityId: best.kindRarityId,
      dynamicUIStateId: best.dynamicUIStateId,
      obligations: best.obligations,
      newlyCovered: bestNew,
    });
  }

  return steps;
}

function verifyExpectedCounts(summary) {
  assert.deepEqual(summary, {
    masterdataCardCount: EXPECTED.masterdataCards,
    sourceCurrentCardCount: EXPECTED.sourceCurrentCards,
    assetGapCardCount: EXPECTED.assetGapCards,
    kindRarityCount: EXPECTED.kindRarities,
    visualPairCount: EXPECTED.visualPairs,
    selectedFontGroupCount: EXPECTED.fontGroups,
    dynamicUIStateVectorCount: EXPECTED.dynamicUIStateVectors,
    setCoverUniverseCount:
      EXPECTED.visualPairs
      + EXPECTED.kindRarities
      + EXPECTED.fontGroups
      + EXPECTED.dynamicUIStateVectors,
  });
}

export function buildOfficialTextVariantCorpus() {
  const designInput = readJsonBytes(DESIGN_CONTRACT);
  const fontInput = readJsonBytes(FONT_CONTRACT);
  const pokemonInput = readJsonBytes(path.join(MASTER_ROOT, "PokemonCard.json"));
  const trainerInput = readJsonBytes(path.join(MASTER_ROOT, "TrainerCard.json"));
  const rarityInput = readJsonBytes(path.join(MASTER_ROOT, "RarityDisplay.json"));

  const designContract = designInput.value;
  const fontContract = fontInput.value;
  const pokemonRows = pokemonInput.value;
  const trainerRows = trainerInput.value;
  const rarityRows = rarityInput.value;

  assert.equal(
    designContract.schema,
    "pocket-card-render/card-text-design-contract@1",
  );
  assert.equal(designContract.schemaVersion, 1);
  assert.equal(designContract.sampleId, officialSample.sampleId);
  assert.equal(
    designContract.sampleManifestSha256,
    officialSampleSha256,
  );
  assert.equal(
    sha256(pokemonInput.bytes),
    officialSample.snapshots.masterdata.pokemonSha256,
  );
  assert.equal(
    sha256(trainerInput.bytes),
    officialSample.snapshots.masterdata.trainerSha256,
  );
  assert.equal(fontContract.schemaVersion, 2);
  assert(Array.isArray(pokemonRows));
  assert(Array.isArray(trainerRows));
  assert(Array.isArray(rarityRows));

  const masterCards = [
    ...pokemonRows.map((row) => ({ kind: "Pokemon", row })),
    ...trainerRows.map((row) => ({ kind: "Trainer", row })),
  ];
  const masterByIllustration = indexUnique(
    masterCards.map(({ kind, row }) => ({
      ...row,
      kind,
    })),
    "IllustrationID",
    "masterdata",
  );
  indexUnique(masterCards.map(({ row }) => row), "CardID", "masterdata");
  const rarityByValue = indexUnique(rarityRows, "Rarity", "RarityDisplay");
  assert.equal(masterCards.length, EXPECTED.masterdataCards);

  const sourceIds = new Set(Object.keys(designContract.cards));
  const gapIds = new Set(designContract.missingIllustrations);
  assert.equal(sourceIds.size, Object.keys(designContract.cards).length);
  assert.equal(gapIds.size, designContract.missingIllustrations.length);
  assert.equal(sourceIds.size, EXPECTED.sourceCurrentCards);
  assert.equal(gapIds.size, EXPECTED.assetGapCards);
  for (const id of sourceIds) {
    assert(!gapIds.has(id), `${id} is both source-current and asset-gap`);
  }
  assert.deepEqual(
    [...sourceIds, ...gapIds].sort(compareText),
    [...masterByIllustration.keys()].sort(compareText),
    "CardSettings and asset-gap IDs do not equal authoritative masterdata",
  );

  const cards = [];
  const allKindRarityCounts = new Map();
  const currentKindRarityCounts = new Map();
  const visualPairCounts = new Map();
  const fontGroupCounts = new Map();
  const dynamicVectorCounts = new Map();
  const dynamicVectors = new Map();

  for (const { kind, row } of masterCards) {
    const kindRarityId = `${kind}:${row.Rarity}`;
    increment(allKindRarityCounts, kindRarityId);
    assert(
      rarityByValue.has(row.Rarity),
      `${row.IllustrationID} has unknown rarity ${row.Rarity}`,
    );
    if (!sourceIds.has(row.IllustrationID)) continue;

    const contractCard = designContract.cards[row.IllustrationID];
    assert(contractCard, `${row.IllustrationID} CardSettings is absent`);
    assert.equal(contractCard.id, row.CardID);
    assert.equal(contractCard.masterdataRarity, row.Rarity);
    assert.equal(contractCard.seriesId, row.SeriesID);
    const design = designContract.designs[contractCard.design];
    assert(design, `${row.IllustrationID} design is absent`);
    assert.equal(design.name, contractCard.design);
    assert.equal(design.fontCondition, contractCard.fontCondition);
    assert(
      designContract.fontGroups[contractCard.fontGroup],
      `${row.IllustrationID} serialized FontGroup is absent`,
    );
    assert(
      fontContract.groups[contractCard.fontGroup],
      `${row.IllustrationID} renderer FontGroup is absent`,
    );

    const vector = dynamicUIStateVector(design);
    const priorVector = dynamicVectors.get(vector.id);
    if (priorVector) {
      assert.deepEqual(
        priorVector.states,
        vector.states,
        `${vector.id} has conflicting DynamicUI states`,
      );
    } else {
      dynamicVectors.set(vector.id, {
        ...vector,
        sourceCurrentCardCount: 0,
      });
    }
    dynamicVectors.get(vector.id).sourceCurrentCardCount += 1;

    const visualPairId = `${contractCard.design}::${contractCard.fontGroup}`;
    const card = {
      cardId: row.CardID,
      illustrationId: row.IllustrationID,
      kind,
      rarity: row.Rarity,
      rarityDisplayGroupId:
        rarityByValue.get(row.Rarity).RarityDisplayGroupID,
      rarityDisplayId: rarityByValue.get(row.Rarity).RarityDisplayID,
      seriesId: row.SeriesID,
      design: contractCard.design,
      fontCondition: contractCard.fontCondition,
      fontGroup: contractCard.fontGroup,
      visualPairId,
      kindRarityId,
      dynamicUIStateId: vector.id,
    };
    card.obligations = obligationIds(card);
    cards.push(card);
    increment(currentKindRarityCounts, kindRarityId);
    increment(visualPairCounts, visualPairId);
    increment(fontGroupCounts, contractCard.fontGroup);
    increment(dynamicVectorCounts, vector.id);
  }

  cards.sort((a, b) => compareText(a.cardId, b.cardId)
    || compareText(a.illustrationId, b.illustrationId));
  assert.equal(cards.length, EXPECTED.sourceCurrentCards);

  const kindRarityIds = sortedUnique(allKindRarityCounts.keys());
  assert.deepEqual(
    kindRarityIds,
    sortedUnique(currentKindRarityCounts.keys()),
    "asset gaps changed the kind x rarity domain",
  );
  const visualPairIds = sortedUnique(visualPairCounts.keys());
  const fontGroupIds = sortedUnique(fontGroupCounts.keys());
  const dynamicVectorIds = sortedUnique(dynamicVectorCounts.keys());

  const universe = [
    ...visualPairIds.map((id) => `visual-pair:${id}`),
    ...kindRarityIds.map((id) => `kind-rarity:${id}`),
    ...fontGroupIds.map((id) => `font-group:${id}`),
    ...dynamicVectorIds.map((id) => `dynamic-ui:${id}`),
  ].sort(compareText);
  const selection = deterministicSetCover(cards, universe);
  const selectedIds = new Set(selection.map((step) => step.illustrationId));
  const selectedCards = cards.filter((card) => selectedIds.has(card.illustrationId));

  const covered = new Set(selectedCards.flatMap((card) => card.obligations));
  const uncovered = universe.filter((id) => !covered.has(id));
  assert.deepEqual(uncovered, []);
  for (const visualPairId of visualPairIds) {
    assert(
      selectedCards.some((card) => card.visualPairId === visualPairId),
      `${visualPairId} has no selected witness`,
    );
  }

  const selectedByPair = new Map();
  for (const card of selectedCards) {
    const list = selectedByPair.get(card.visualPairId) || [];
    list.push(card);
    selectedByPair.set(card.visualPairId, list);
  }
  const sourceCardsByPair = new Map();
  for (const card of cards) {
    const list = sourceCardsByPair.get(card.visualPairId) || [];
    list.push(card);
    sourceCardsByPair.set(card.visualPairId, list);
  }

  const assetGaps = masterCards
    .filter(({ row }) => gapIds.has(row.IllustrationID))
    .map(({ kind, row }) => ({
      cardId: row.CardID,
      illustrationId: row.IllustrationID,
      kind,
      rarity: row.Rarity,
      seriesId: row.SeriesID,
    }))
    .sort((a, b) => compareText(a.cardId, b.cardId));
  assert.equal(assetGaps.length, EXPECTED.assetGapCards);
  assert(
    assetGaps.every((card) => card.seriesId === "B"),
    "asset gaps are not exclusively Series B",
  );

  const summary = {
    masterdataCardCount: masterCards.length,
    sourceCurrentCardCount: cards.length,
    assetGapCardCount: assetGaps.length,
    kindRarityCount: kindRarityIds.length,
    visualPairCount: visualPairIds.length,
    selectedFontGroupCount: fontGroupIds.length,
    dynamicUIStateVectorCount: dynamicVectorIds.length,
    setCoverUniverseCount: universe.length,
  };
  verifyExpectedCounts(summary);

  const result = {
    schema: "pocket-card-render/official-text-variant-corpus@1",
    schemaVersion: 1,
    sampleId: designContract.sampleId,
    sampleManifestSha256: designContract.sampleManifestSha256,
    sourcePolicy: {
      expectationSources: [
        "official-card-text-design-contract",
        "official-card-font-contract",
        "official-masterdata",
      ],
      forbiddenExpectationSources: [
        "scene",
        "screenshot",
        "compose-output",
      ],
      selectionAlgorithm:
        "deterministic-greedy-set-cover(max-new-obligations,cardId,illustrationId)",
    },
    inputs: {
      cardTextDesignContract: {
        logicalPath: "public/render/card-text-design-contract.json",
        sha256: sha256(designInput.bytes),
      },
      cardFontContract: {
        logicalPath: "public/render/card-font-contract.json",
        sha256: sha256(fontInput.bytes),
      },
      pokemonMasterdata: {
        logicalPath: "MasterData/PokemonCard.json",
        rowCount: pokemonRows.length,
        sha256: sha256(pokemonInput.bytes),
      },
      trainerMasterdata: {
        logicalPath: "MasterData/TrainerCard.json",
        rowCount: trainerRows.length,
        sha256: sha256(trainerInput.bytes),
      },
      rarityDisplayMasterdata: {
        logicalPath: "MasterData/RarityDisplay.json",
        rowCount: rarityRows.length,
        sha256: sha256(rarityInput.bytes),
      },
    },
    summary,
    dimensions: {
      kindRarities: kindRarityIds.map((id) => {
        const [kind, rarityText] = id.split(":");
        const rarity = Number(rarityText);
        const rarityDisplay = rarityByValue.get(rarity);
        return {
          id,
          kind,
          rarity,
          rarityDisplayGroupId: rarityDisplay.RarityDisplayGroupID,
          rarityDisplayId: rarityDisplay.RarityDisplayID,
          masterdataCardCount: allKindRarityCounts.get(id),
          sourceCurrentCardCount: currentKindRarityCounts.get(id),
          assetGapCardCount:
            allKindRarityCounts.get(id) - currentKindRarityCounts.get(id),
        };
      }),
      visualPairs: visualPairIds.map((id) => {
        const [design, fontGroup] = id.split("::");
        const pairCards = sourceCardsByPair.get(id);
        return {
          id,
          design,
          fontGroup,
          sourceCurrentCardCount: visualPairCounts.get(id),
          kindRarityIds: sortedUnique(
            pairCards.map((card) => card.kindRarityId),
          ),
          dynamicUIStateIds: sortedUnique(
            pairCards.map((card) => card.dynamicUIStateId),
          ),
          selectedWitnesses: (selectedByPair.get(id) || [])
            .map((card) => ({
              cardId: card.cardId,
              illustrationId: card.illustrationId,
            }))
            .sort((a, b) => compareText(a.cardId, b.cardId)),
        };
      }),
      fontGroups: fontGroupIds.map((id) => ({
        id,
        sourceCurrentCardCount: fontGroupCounts.get(id),
        serializedObjectSha256:
          designContract.fontGroups[id].objectSha256,
        rendererBindingCount:
          Object.keys(fontContract.groups[id]).length,
      })),
      dynamicUIStateVectors: dynamicVectorIds.map((id) => ({
        id,
        states: dynamicVectors.get(id).states,
        sourceCurrentCardCount: dynamicVectorCounts.get(id),
      })),
    },
    setCover: {
      universe,
      selectedWitnessCount: selection.length,
      selectedWitnesses: selection,
      uncovered: [],
    },
    uncoveredWithReason: [
      {
        scope: "masterdata-cards",
        reason: "asset-snapshot-gap",
        detail:
          "Illustration exists in official masterdata but has no CardSettings in the current immutable Face snapshot.",
        count: assetGaps.length,
        cards: assetGaps,
      },
    ],
  };

  assertNoUnicodeReplacement(result, "official text variant corpus");
  return result;
}

export function serializeOfficialTextVariantCorpus(corpus) {
  return `${JSON.stringify(corpus, null, 1)}\n`;
}

function main() {
  const corpus = buildOfficialTextVariantCorpus();
  const serialized = serializeOfficialTextVariantCorpus(corpus);
  const check = process.argv.includes("--check")
    || process.env.PCR_OFFICIAL_TEXT_VARIANT_CORPUS_CHECK === "1";
  if (check) {
    assert.equal(
      fs.readFileSync(OUTPUT, "utf8"),
      serialized,
      "official text variant corpus is stale",
    );
    console.log("Official text variant corpus generation check OK");
  } else {
    fs.writeFileSync(OUTPUT, serialized);
    console.log(`wrote ${path.relative(ROOT, OUTPUT)}`);
  }
  console.log([
    `${corpus.summary.sourceCurrentCardCount} source-current`,
    `${corpus.summary.assetGapCardCount} asset-gap`,
    `${corpus.summary.kindRarityCount} kind x rarity`,
    `${corpus.summary.visualPairCount} visual pairs`,
    `${corpus.summary.selectedFontGroupCount} FontGroups`,
    `${corpus.summary.dynamicUIStateVectorCount} DynamicUI vectors`,
    `${corpus.setCover.selectedWitnessCount} selected witnesses`,
    `${corpus.setCover.uncovered.length} uncovered obligations`,
  ].join(", "));
}

if (
  process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main();
}
