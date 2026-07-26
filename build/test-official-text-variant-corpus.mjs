import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildOfficialTextVariantCorpus,
  serializeOfficialTextVariantCorpus,
} from "./build-official-text-variant-corpus.mjs";
import {
  officialSample,
  officialSampleSha256,
} from "./official-sample.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MASTER_ROOT = path.resolve(
  process.env.PCR_MASTERDATA
    || "D:/DevProjectes/ptcgp-cloudbase/cloud/src/functions/app/ptcgp-masterdata/MasterData",
);
const ARTIFACT = path.join(
  ROOT,
  "build",
  "official-text-variant-corpus.json",
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

function compareText(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function readJson(filename) {
  const bytes = fs.readFileSync(filename);
  return {
    bytes,
    value: JSON.parse(bytes.toString("utf8")),
  };
}

function sortedUnique(values) {
  return [...new Set(values)].sort(compareText);
}

function increment(map, key) {
  map.set(key, (map.get(key) || 0) + 1);
}

function assertNoReplacement(value, label) {
  assert(
    !JSON.stringify(value).includes("\uFFFD"),
    `${label} contains U+FFFD`,
  );
}

function assertMutationRejected(callback, label) {
  let rejected = false;
  try {
    callback();
  } catch (error) {
    assert(error instanceof Error, `${label} threw a non-Error value`);
    rejected = true;
  }
  assert(rejected, `${label} did not fail closed`);
}

function dynamicVectorId(design) {
  return (design.dynamicUIs || [])
    .map((entry) => ({
      label: entry.label,
      controllerPath: entry.controller.path,
      targetName: entry.target?.name ?? null,
    }))
    .sort((a, b) => compareText(a.label, b.label)
      || compareText(a.controllerPath, b.controllerPath))
    .map((entry) => `${entry.label}=${entry.targetName ?? "null"}`)
    .join("|");
}

function validateArtifact(artifact) {
  assertNoReplacement(artifact, "artifact");
  assert.equal(
    artifact.schema,
    "pocket-card-render/official-text-variant-corpus@1",
  );
  assert.equal(artifact.schemaVersion, 1);
  assert.equal(artifact.sampleId, officialSample.sampleId);
  assert.equal(artifact.sampleManifestSha256, officialSampleSha256);
  assert.deepEqual(artifact.sourcePolicy.forbiddenExpectationSources, [
    "scene",
    "screenshot",
    "compose-output",
  ]);

  const designInput = readJson(DESIGN_CONTRACT);
  const fontInput = readJson(FONT_CONTRACT);
  const pokemonInput = readJson(path.join(MASTER_ROOT, "PokemonCard.json"));
  const trainerInput = readJson(path.join(MASTER_ROOT, "TrainerCard.json"));
  const rarityInput = readJson(path.join(MASTER_ROOT, "RarityDisplay.json"));
  const design = designInput.value;
  const font = fontInput.value;
  const rarityByValue = new Map(
    rarityInput.value.map((row) => [row.Rarity, row]),
  );

  assert.equal(
    artifact.inputs.cardTextDesignContract.sha256,
    sha256(designInput.bytes),
  );
  assert.equal(
    artifact.inputs.cardFontContract.sha256,
    sha256(fontInput.bytes),
  );
  assert.equal(
    artifact.inputs.pokemonMasterdata.sha256,
    sha256(pokemonInput.bytes),
  );
  assert.equal(
    artifact.inputs.trainerMasterdata.sha256,
    sha256(trainerInput.bytes),
  );
  assert.equal(
    artifact.inputs.rarityDisplayMasterdata.sha256,
    sha256(rarityInput.bytes),
  );
  assert.equal(
    sha256(pokemonInput.bytes),
    officialSample.snapshots.masterdata.pokemonSha256,
  );
  assert.equal(
    sha256(trainerInput.bytes),
    officialSample.snapshots.masterdata.trainerSha256,
  );

  const masterCards = [
    ...pokemonInput.value.map((row) => ({ kind: "Pokemon", row })),
    ...trainerInput.value.map((row) => ({ kind: "Trainer", row })),
  ];
  const masterIds = sortedUnique(
    masterCards.map(({ row }) => row.IllustrationID),
  );
  const sourceIds = sortedUnique(Object.keys(design.cards));
  const gapIds = sortedUnique(design.missingIllustrations);
  assert.equal(masterIds.length, 3305);
  assert.equal(sourceIds.length, 3191);
  assert.equal(gapIds.length, 114);
  assert.deepEqual(sortedUnique([...sourceIds, ...gapIds]), masterIds);

  const expectedKindRarity = new Set();
  const expectedVisualPairs = new Set();
  const expectedFontGroups = new Set();
  const expectedDynamicVectors = new Set();
  const expectedUniverse = new Set();
  const allKindRarityCounts = new Map();
  const currentKindRarityCounts = new Map();
  const visualPairCounts = new Map();
  const fontGroupCounts = new Map();
  const dynamicVectorCounts = new Map();
  const dynamicVectorStates = new Map();
  const sourceCardByIllustration = new Map();
  const gapCardByIllustration = new Map();

  for (const { kind, row } of masterCards) {
    const kindRarityId = `${kind}:${row.Rarity}`;
    expectedKindRarity.add(kindRarityId);
    increment(allKindRarityCounts, kindRarityId);
    assert(rarityByValue.has(row.Rarity));
    if (!design.cards[row.IllustrationID]) {
      gapCardByIllustration.set(row.IllustrationID, { kind, row });
      continue;
    }
    const card = design.cards[row.IllustrationID];
    assert.equal(card.id, row.CardID);
    assert.equal(card.masterdataRarity, row.Rarity);
    assert(design.designs[card.design]);
    assert(design.fontGroups[card.fontGroup]);
    assert(font.groups[card.fontGroup]);
    const visualPairId = `${card.design}::${card.fontGroup}`;
    const dynamicUIStateId = dynamicVectorId(design.designs[card.design]);
    expectedVisualPairs.add(visualPairId);
    expectedFontGroups.add(card.fontGroup);
    expectedDynamicVectors.add(dynamicUIStateId);
    increment(currentKindRarityCounts, kindRarityId);
    increment(visualPairCounts, visualPairId);
    increment(fontGroupCounts, card.fontGroup);
    increment(dynamicVectorCounts, dynamicUIStateId);
    const dynamicStates = (design.designs[card.design].dynamicUIs || [])
      .map((entry) => ({
        label: entry.label,
        controllerPath: entry.controller.path,
        targetName: entry.target?.name ?? null,
        targetPath: entry.target?.path ?? null,
      }))
      .sort((a, b) => compareText(a.label, b.label)
        || compareText(a.controllerPath, b.controllerPath));
    if (dynamicVectorStates.has(dynamicUIStateId)) {
      assert.deepEqual(
        dynamicVectorStates.get(dynamicUIStateId),
        dynamicStates,
      );
    } else {
      dynamicVectorStates.set(dynamicUIStateId, dynamicStates);
    }
    sourceCardByIllustration.set(row.IllustrationID, {
      cardId: row.CardID,
      illustrationId: row.IllustrationID,
      kind,
      rarity: row.Rarity,
      design: card.design,
      fontCondition: card.fontCondition,
      visualPairId,
      kindRarityId,
      fontGroup: card.fontGroup,
      dynamicUIStateId,
    });
  }

  assert.equal(sourceCardByIllustration.size, 3191);
  assert.equal(gapCardByIllustration.size, 114);
  assert.equal(expectedKindRarity.size, 16);
  assert.equal(expectedVisualPairs.size, 106);
  assert.equal(expectedFontGroups.size, 10);
  assert.equal(expectedDynamicVectors.size, 4);

  for (const id of expectedVisualPairs) {
    expectedUniverse.add(`visual-pair:${id}`);
  }
  for (const id of expectedKindRarity) {
    expectedUniverse.add(`kind-rarity:${id}`);
  }
  for (const id of expectedFontGroups) {
    expectedUniverse.add(`font-group:${id}`);
  }
  for (const id of expectedDynamicVectors) {
    expectedUniverse.add(`dynamic-ui:${id}`);
  }
  assert.equal(expectedUniverse.size, 136);

  assert.deepEqual(artifact.summary, {
    masterdataCardCount: 3305,
    sourceCurrentCardCount: 3191,
    assetGapCardCount: 114,
    kindRarityCount: 16,
    visualPairCount: 106,
    selectedFontGroupCount: 10,
    dynamicUIStateVectorCount: 4,
    setCoverUniverseCount: 136,
  });
  assert.deepEqual(
    artifact.dimensions.kindRarities.map((entry) => entry.id).sort(compareText),
    [...expectedKindRarity].sort(compareText),
  );
  for (const entry of artifact.dimensions.kindRarities) {
    const rarity = rarityByValue.get(entry.rarity);
    assert.equal(entry.id, `${entry.kind}:${entry.rarity}`);
    assert.equal(entry.rarityDisplayGroupId, rarity.RarityDisplayGroupID);
    assert.equal(entry.rarityDisplayId, rarity.RarityDisplayID);
    assert.equal(entry.masterdataCardCount, allKindRarityCounts.get(entry.id));
    assert.equal(
      entry.sourceCurrentCardCount,
      currentKindRarityCounts.get(entry.id),
    );
    assert.equal(
      entry.assetGapCardCount,
      allKindRarityCounts.get(entry.id) - currentKindRarityCounts.get(entry.id),
    );
  }
  assert.deepEqual(
    artifact.dimensions.visualPairs.map((entry) => entry.id).sort(compareText),
    [...expectedVisualPairs].sort(compareText),
  );
  for (const entry of artifact.dimensions.visualPairs) {
    assert.equal(entry.id, `${entry.design}::${entry.fontGroup}`);
    assert.equal(
      entry.sourceCurrentCardCount,
      visualPairCounts.get(entry.id),
    );
  }
  assert.deepEqual(
    artifact.dimensions.fontGroups.map((entry) => entry.id).sort(compareText),
    [...expectedFontGroups].sort(compareText),
  );
  for (const entry of artifact.dimensions.fontGroups) {
    assert.equal(entry.sourceCurrentCardCount, fontGroupCounts.get(entry.id));
    assert.equal(
      entry.serializedObjectSha256,
      design.fontGroups[entry.id].objectSha256,
    );
    assert.equal(
      entry.rendererBindingCount,
      Object.keys(font.groups[entry.id]).length,
    );
  }
  assert.deepEqual(
    artifact.dimensions.dynamicUIStateVectors
      .map((entry) => entry.id)
      .sort(compareText),
    [...expectedDynamicVectors].sort(compareText),
  );
  for (const entry of artifact.dimensions.dynamicUIStateVectors) {
    assert.deepEqual(entry.states, dynamicVectorStates.get(entry.id));
    assert.equal(
      entry.sourceCurrentCardCount,
      dynamicVectorCounts.get(entry.id),
    );
  }
  assert.deepEqual(
    artifact.setCover.universe,
    [...expectedUniverse].sort(compareText),
  );
  assert.deepEqual(artifact.setCover.uncovered, []);

  const independentlySelected = [];
  const independentlyUncovered = new Set(expectedUniverse);
  const independentRemaining = new Map(sourceCardByIllustration);
  while (independentlyUncovered.size > 0) {
    let best = null;
    let bestNew = [];
    for (const card of independentRemaining.values()) {
      const obligations = [
        `visual-pair:${card.visualPairId}`,
        `kind-rarity:${card.kindRarityId}`,
        `font-group:${card.fontGroup}`,
        `dynamic-ui:${card.dynamicUIStateId}`,
      ].sort(compareText);
      const newlyCovered = obligations.filter(
        (id) => independentlyUncovered.has(id),
      );
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
    assert(best && bestNew.length > 0);
    independentlySelected.push({
      illustrationId: best.illustrationId,
      newlyCovered: bestNew,
    });
    independentRemaining.delete(best.illustrationId);
    for (const id of bestNew) independentlyUncovered.delete(id);
  }
  assert.deepEqual(
    artifact.setCover.selectedWitnesses.map((witness) => ({
      illustrationId: witness.illustrationId,
      newlyCovered: witness.newlyCovered,
    })),
    independentlySelected,
    "artifact does not follow the declared deterministic set-cover rule",
  );

  const selectedIllustrations = new Set();
  const covered = new Set();
  const coveredPairs = new Set();
  for (const [index, witness] of
    artifact.setCover.selectedWitnesses.entries()) {
    assert.equal(witness.rank, index + 1);
    assert(!selectedIllustrations.has(witness.illustrationId));
    selectedIllustrations.add(witness.illustrationId);
    const source = sourceCardByIllustration.get(witness.illustrationId);
    assert(source, `${witness.illustrationId} is not source-current`);
    assert.equal(witness.cardId, source.cardId);
    assert.equal(witness.kind, source.kind);
    assert.equal(witness.rarity, source.rarity);
    assert.equal(witness.visualPairId, source.visualPairId);
    assert.equal(witness.kindRarityId, source.kindRarityId);
    assert.equal(witness.fontGroup, source.fontGroup);
    assert.equal(witness.dynamicUIStateId, source.dynamicUIStateId);
    const expectedObligations = [
      `visual-pair:${source.visualPairId}`,
      `kind-rarity:${source.kindRarityId}`,
      `font-group:${source.fontGroup}`,
      `dynamic-ui:${source.dynamicUIStateId}`,
    ].sort(compareText);
    assert.deepEqual(witness.obligations, expectedObligations);
    for (const obligation of witness.obligations) covered.add(obligation);
    coveredPairs.add(witness.visualPairId);
  }
  assert.equal(artifact.setCover.selectedWitnessCount, selectedIllustrations.size);
  assert.deepEqual(
    [...covered].sort(compareText),
    [...expectedUniverse].sort(compareText),
  );
  assert.deepEqual(
    [...coveredPairs].sort(compareText),
    [...expectedVisualPairs].sort(compareText),
  );

  for (const pair of artifact.dimensions.visualPairs) {
    assert(pair.selectedWitnesses.length >= 1, `${pair.id} has no witness`);
    for (const witness of pair.selectedWitnesses) {
      assert(selectedIllustrations.has(witness.illustrationId));
      assert.equal(
        sourceCardByIllustration.get(witness.illustrationId).visualPairId,
        pair.id,
      );
    }
  }

  assert.equal(artifact.uncoveredWithReason.length, 1);
  const gap = artifact.uncoveredWithReason[0];
  assert.equal(gap.scope, "masterdata-cards");
  assert.equal(gap.reason, "asset-snapshot-gap");
  assert.equal(gap.count, 114);
  assert.equal(gap.cards.length, 114);
  assert.deepEqual(
    gap.cards.map((card) => card.illustrationId).sort(compareText),
    gapIds,
  );
  for (const card of gap.cards) {
    const source = gapCardByIllustration.get(card.illustrationId);
    assert(source);
    assert.equal(card.cardId, source.row.CardID);
    assert.equal(card.kind, source.kind);
    assert.equal(card.rarity, source.row.Rarity);
    assert.equal(card.seriesId, "B");
  }

  return {
    sourceCurrent: sourceCardByIllustration.size,
    assetGaps: gapCardByIllustration.size,
    universe: expectedUniverse.size,
    selected: selectedIllustrations.size,
  };
}

const artifact = readJson(ARTIFACT).value;
const result = validateArtifact(artifact);

const rebuiltA = buildOfficialTextVariantCorpus();
const rebuiltB = buildOfficialTextVariantCorpus();
assert.deepEqual(rebuiltA, rebuiltB, "generator is not deterministic");
assert.equal(
  serializeOfficialTextVariantCorpus(artifact),
  serializeOfficialTextVariantCorpus(rebuiltA),
  "checked-in corpus is stale",
);

const unicodeMutation = structuredClone(artifact);
unicodeMutation.setCover.selectedWitnesses[0].illustrationId += "\uFFFD";
assert.throws(
  () => validateArtifact(unicodeMutation),
  /U\+FFFD/u,
  "U+FFFD mutation did not fail closed",
);

const witnessMutation = structuredClone(artifact);
const removedPair =
  witnessMutation.setCover.selectedWitnesses.at(-1).visualPairId;
witnessMutation.setCover.selectedWitnesses =
  witnessMutation.setCover.selectedWitnesses.filter(
    (witness) => witness.visualPairId !== removedPair,
  );
witnessMutation.setCover.selectedWitnessCount =
  witnessMutation.setCover.selectedWitnesses.length;
assertMutationRejected(
  () => validateArtifact(witnessMutation),
  "visual-pair witness deletion",
);

const gapMutation = structuredClone(artifact);
gapMutation.uncoveredWithReason[0].cards.pop();
gapMutation.uncoveredWithReason[0].count -= 1;
assertMutationRejected(
  () => validateArtifact(gapMutation),
  "asset-gap deletion",
);

console.log("Official text variant corpus audit OK");
console.log([
  `${result.sourceCurrent} source-current`,
  `${result.assetGaps} asset-gap`,
  "16 kind x rarity",
  "106 visual pairs",
  "10 FontGroups",
  "4 DynamicUI vectors",
  `${result.selected} selected witnesses`,
  `${result.universe} obligations`,
  "0 uncovered obligations",
  "U+FFFD/witness/gap mutations rejected",
].join(", "));
