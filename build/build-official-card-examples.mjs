import assert from "node:assert/strict";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  officialSample,
  officialSampleSha256,
} from "./official-sample.mjs";
import {
  CARD_TEXT_SENTINELS,
  createCardTextResolver,
} from "./card-text-resolver.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MASTER_ROOT = path.resolve(
  process.env.PCR_MASTERDATA
    || "D:/DevProjectes/ptcgp-cloudbase/cloud/src/functions/app/ptcgp-masterdata/MasterData",
);
const LOCALE_ROOT = path.resolve(
  process.env.PTCG_LOCALE_ROOT
    || process.env.PCR_RECIPES
    || path.join(ROOT, "..", "ptcg-apk-parser", "apks", "output"),
);
const INVENTORY = path.join(
  ROOT,
  "$cache",
  "official-material-program-inventory-v4-full.json",
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
const OUTPUT = path.join(ROOT, "public", "card-examples.json");
const LOCALES = Object.freeze([
  "de_DE",
  "en_US",
  "es_ES",
  "fr_FR",
  "it_IT",
  "ja_JP",
  "ko_KR",
  "pt_BR",
  "zh_TW",
]);
const EXPECTED = Object.freeze({
  sourceCurrentCards: 3191,
  assetGapCards: 114,
  visualPairs: 106,
  semanticExecutables: 77,
  materialStates: 166,
  unresolvedMaterials: 0,
  featureUniverse: 444,
  minimumWitnesses: 112,
  rarityRenderingFeatures: 543,
  rarityRenderingAdditionalWitnesses: 5,
});

function compareText(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function assertNoUnicodeReplacement(value, label) {
  assert(
    !JSON.stringify(value).includes("\uFFFD"),
    `${label} contains U+FFFD replacement characters`,
  );
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort(compareText).map((key) => [key, sortKeys(value[key])]),
    );
  }
  return value;
}

function canonicalDigest(value) {
  return sha256(JSON.stringify(sortKeys(value)));
}

function readJsonBytes(filename) {
  const bytes = fs.readFileSync(filename);
  const text = bytes.toString("utf8");
  assertNoUnicodeReplacement(text, path.relative(ROOT, filename));
  return { bytes, value: JSON.parse(text) };
}

function indexUnique(rows, key, label) {
  const result = new Map();
  for (const row of rows) {
    assert(!result.has(row[key]), `${label} has duplicate ${key} ${row[key]}`);
    result.set(row[key], row);
  }
  return result;
}

function sortedUnique(values) {
  return [...new Set(values)].sort(compareText);
}

function ensureInventory() {
  if (fs.existsSync(INVENTORY)) return;
  fs.mkdirSync(path.dirname(INVENTORY), { recursive: true });
  const result = spawnSync(process.env.PYTHON || "python", [
    "build/extract_official_material_program_inventory.py",
    "--full",
    "--out",
    INVENTORY,
  ], {
    cwd: ROOT,
    encoding: "utf8",
    windowsHide: true,
    shell: process.platform === "win32",
    maxBuffer: 16 * 1024 * 1024,
  });
  assert.equal(
    result.status,
    0,
    `official material/program extraction failed:\n${result.stderr || result.stdout}`,
  );
}

function dynamicUIStateId(design) {
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

function materialStateId(material) {
  return canonicalDigest([
    material.shaderIdentity,
    material.keywords,
    material.customRenderQueue,
    material.disabledShaderPasses,
    material.enableInstancingVariants,
  ]);
}

function featureDomain(featureId) {
  if (featureId.startsWith("visual-pair:")
    || featureId.startsWith("kind-rarity:")
    || featureId.startsWith("font-group:")
    || featureId.startsWith("dynamic-ui:")) {
    return "serialized-card-design";
  }
  if (featureId.startsWith("semantic-executable:")
    || featureId.startsWith("material-state:")
    || featureId.startsWith("engine-variant-boundary:")) {
    return "official-gpu-program";
  }
  if (featureId.startsWith("material-locator-boundary:")) {
    return "official-asset-boundary";
  }
  return "card-face-semantics";
}

export function deterministicGreedySetCover(cards, universe) {
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
    assert(best && bestNew.length > 0, "set-cover cannot cover the feature universe");
    remaining.delete(best.illustrationId);
    for (const id of bestNew) uncovered.delete(id);
    steps.push({
      rank: steps.length + 1,
      ...best,
      newlyCovered: bestNew,
    });
  }
  return steps;
}

function proveMinimum(cards, universe) {
  const featureIndex = new Map(universe.map((id, index) => [id, index]));
  const payload = {
    candidateIds: cards.map((card) => card.illustrationId),
    coverage: cards.map((card) => card.obligations.map((id) => featureIndex.get(id))),
    universeCount: universe.length,
  };
  const result = spawnSync(process.env.PYTHON || "python", [
    "-B",
    "build/solve-official-card-example-cover.py",
  ], {
    cwd: ROOT,
    input: JSON.stringify(payload),
    encoding: "utf8",
    windowsHide: true,
    shell: process.platform === "win32",
    maxBuffer: 16 * 1024 * 1024,
  });
  assert.equal(
    result.status,
    0,
    `official example set-cover proof failed:\n${result.stderr || result.stdout}`,
  );
  const proof = JSON.parse(result.stdout);
  assert.equal(proof.status, 0);
  assert.equal(proof.mipGap, 0);
  assert.equal(proof.optimalCardinality, Math.round(proof.mipDualBound));
  return proof;
}

function displayName(resolve, source, isEx) {
  const resolved = resolve(source)
    .replaceAll(CARD_TEXT_SENTINELS.ex, " ex")
    .trim();
  return isEx && !/ex$/i.test(resolved) ? `${resolved} ex` : resolved;
}

function localizedNames({
  kind,
  card,
  definition,
  characterById,
  locales,
  localeResolvers,
}) {
  const character = characterById.get(definition.CharacterID);
  assert(character, `${card.IllustrationID} character is absent`);
  const names = {};
  for (const lc of LOCALES) {
    const source = locales.get(lc).Master[character.DisplayNameMSID];
    assert.equal(
      typeof source,
      "string",
      `${card.IllustrationID}:${lc} display name is absent`,
    );
    names[lc] = displayName(
      localeResolvers.get(lc),
      source,
      kind === "Pokemon" && definition.IsEX,
    );
  }
  return names;
}

function bundledSceneIndex() {
  const result = new Map();
  const tracked = spawnSync("git", [
    "ls-files",
    "--",
    "public/scene.*.json",
  ], {
    cwd: ROOT,
    encoding: "utf8",
    windowsHide: true,
  });
  assert.equal(
    tracked.status,
    0,
    `cannot enumerate tracked built-in scenes:\n${tracked.stderr || tracked.stdout}`,
  );
  for (const filename of tracked.stdout.split(/\r?\n/u).filter(Boolean)) {
    const name = path.basename(filename);
    const match = /^scene\.(c(?:PK|TR)_.+)\.json$/i.exec(name);
    if (match) result.set(match[1], name);
  }
  return result;
}

export function buildOfficialCardExamples({ verifyOptimal = true } = {}) {
  assert.equal(
    verifyOptimal,
    true,
    "canonical card examples cannot claim global optimality without running the independent MILP proof",
  );
  ensureInventory();
  const designInput = readJsonBytes(DESIGN_CONTRACT);
  const fontInput = readJsonBytes(FONT_CONTRACT);
  const inventoryInput = readJsonBytes(INVENTORY);
  const tableNames = [
    "PokemonCard",
    "TrainerCard",
    "Pokemon",
    "Trainer",
    "PokemonAttack",
    "Character",
    "RarityDisplay",
  ];
  const tableInputs = Object.fromEntries(
    tableNames.map((name) => [
      name,
      readJsonBytes(path.join(MASTER_ROOT, `${name}.json`)),
    ]),
  );
  const localeInputs = new Map(
    LOCALES.map((lc) => [
      lc,
      readJsonBytes(path.join(LOCALE_ROOT, `locale_${lc}.json`)),
    ]),
  );

  const designContract = designInput.value;
  const fontContract = fontInput.value;
  const inventory = inventoryInput.value;
  assert.equal(designContract.sampleId, officialSample.sampleId);
  assert.equal(designContract.sampleManifestSha256, officialSampleSha256);
  assert.equal(inventory.schemaVersion, 4);
  assert.equal(inventory.summary.lPrefabs, EXPECTED.sourceCurrentCards);
  assert.equal(
    inventory.summary.semanticExecutableArchetypes,
    EXPECTED.semanticExecutables,
  );
  assert.equal(inventory.summary.stateArchetypes, EXPECTED.materialStates);
  assert.equal(
    inventory.exceptional.unresolvedMaterials.length,
    EXPECTED.unresolvedMaterials,
  );

  const pokemonCards = tableInputs.PokemonCard.value;
  const trainerCards = tableInputs.TrainerCard.value;
  const pokemonById = indexUnique(tableInputs.Pokemon.value, "PokemonID", "Pokemon");
  const trainerById = indexUnique(tableInputs.Trainer.value, "TrainerID", "Trainer");
  const attackById = indexUnique(
    tableInputs.PokemonAttack.value,
    "PokemonAttackID",
    "PokemonAttack",
  );
  const characterById = indexUnique(
    tableInputs.Character.value,
    "CharacterID",
    "Character",
  );
  const rarityByValue = indexUnique(
    tableInputs.RarityDisplay.value,
    "Rarity",
    "RarityDisplay",
  );
  const locales = new Map(
    [...localeInputs].map(([lc, input]) => [lc, input.value]),
  );
  const localeResolvers = new Map(
    [...locales].map(([lc, locale]) => [
      lc,
      createCardTextResolver(locale.Master, {}, lc),
    ]),
  );
  const materialsById = indexUnique(
    inventory.proofGraph.materials,
    "identity",
    "official Materials",
  );
  const selectorsById = indexUnique(
    inventory.proofGraph.selectors,
    "selectorId",
    "official selectors",
  );
  const unresolvedMaterials = new Set(inventory.exceptional.unresolvedMaterials);
  const usagesByIllustration = new Map();
  for (const usage of inventory.proofGraph.usageRows) {
    const list = usagesByIllustration.get(usage.illustrationId) || [];
    list.push(usage);
    usagesByIllustration.set(usage.illustrationId, list);
  }

  const semanticExecutableMetadata = new Map();
  for (const row of inventory.portIndex) {
    const prior = semanticExecutableMetadata.get(row.semanticExecutableId) || {
      shaderNames: new Set(),
      selectorIds: new Set(),
    };
    prior.shaderNames.add(row.shaderName);
    prior.selectorIds.add(row.selectorId);
    semanticExecutableMetadata.set(row.semanticExecutableId, prior);
  }
  const stateMetadata = new Map();
  for (const material of inventory.proofGraph.materials) {
    const id = materialStateId(material);
    const prior = stateMetadata.get(id) || {
      materialCount: 0,
      materialNames: new Set(),
    };
    prior.materialCount += 1;
    prior.materialNames.add(material.name);
    stateMetadata.set(id, prior);
  }

  const featureMetadata = new Map();
  const addFeature = (features, id, metadata = {}) => {
    features.add(id);
    if (!featureMetadata.has(id)) {
      featureMetadata.set(id, {
        id,
        domain: featureDomain(id),
        ...metadata,
      });
    }
  };
  const cards = [];
  const masterCards = [
    ...pokemonCards.map((card) => ({ kind: "Pokemon", card })),
    ...trainerCards.map((card) => ({ kind: "Trainer", card })),
  ];
  for (const { kind, card } of masterCards) {
    const contractCard = designContract.cards[card.IllustrationID];
    if (!contractCard) continue;
    const design = designContract.designs[contractCard.design];
    const features = new Set();
    const rarityRenderingFeatures = new Set();
    const visualPairId = `${contractCard.design}::${contractCard.fontGroup}`;
    addFeature(features, `visual-pair:${visualPairId}`, {
      design: contractCard.design,
      fontGroup: contractCard.fontGroup,
    });
    addFeature(features, `kind-rarity:${kind}:${card.Rarity}`, {
      kind,
      rarity: card.Rarity,
    });
    addFeature(features, `font-group:${contractCard.fontGroup}`, {
      fontGroup: contractCard.fontGroup,
    });
    addFeature(features, `dynamic-ui:${dynamicUIStateId(design)}`);
    addFeature(features, `card-kind:${kind}`);
    addFeature(features, `promotion:${Boolean(card.IsPromotion)}`);
    addFeature(features, `mirror-type:${card.MirrorType}`);

    for (const usage of usagesByIllustration.get(card.IllustrationID) || []) {
      const material = materialsById.get(usage.materialIdentity);
      if (!material) {
        assert(
          unresolvedMaterials.has(usage.materialIdentity),
          `${card.IllustrationID} has an unexplained Material boundary`,
        );
        addFeature(
          features,
          `material-locator-boundary:${usage.materialIdentity}`,
          { materialIdentity: usage.materialIdentity },
        );
        continue;
      }
      const selectorId = canonicalDigest([
        material.shaderIdentity,
        material.keywords,
      ]);
      const selector = selectorsById.get(selectorId);
      assert(selector, `${material.identity} selector is absent`);
      for (const executable of selector.staticExecutables || []) {
        rarityRenderingFeatures.add(
          `rarity-semantic-executable:${card.Rarity}:${executable.executable.semanticExecutableId}`,
        );
        addFeature(
          features,
          `semantic-executable:${executable.executable.semanticExecutableId}`,
        );
      }
      if (selector.runtimeEngineVariantBoundary) {
        addFeature(
          features,
          `engine-variant-boundary:${selector.selectorId}`,
          { selectorId: selector.selectorId },
        );
      }
      const stateId = materialStateId(material);
      rarityRenderingFeatures.add(
        `rarity-material-state:${card.Rarity}:${stateId}`,
      );
      addFeature(features, `material-state:${stateId}`);
    }

    let definition;
    if (kind === "Pokemon") {
      definition = pokemonById.get(card.PokemonID);
      assert(definition, `${card.IllustrationID} Pokemon definition is absent`);
      const exKind = definition.IsMegaEvolution
        ? "mega-ex"
        : definition.IsEX ? "ex" : "normal";
      addFeature(features, `pokemon-ex-kind:${exKind}`);
      addFeature(
        features,
        `skill-shape:A${definition.PokemonAbilityIDs.length}T${definition.PokemonAttackIDs.length}`,
      );
      addFeature(features, `evolution-stage:${definition.EvolutionStage}`);
      addFeature(
        features,
        `evolution-source:${Boolean(definition.PreevolvedCharacterID)}`,
      );
      addFeature(
        features,
        `mega-predecessor:${Boolean(definition.MegaEvolutionPreevolvedCharacterID)}`,
      );
      addFeature(
        features,
        `flavor-mode:${
          definition.IsMegaEvolution
            ? "suppressed-mega"
            : card.FlavorTextMSID ? "visible" : "empty"
        }`,
      );
      addFeature(
        features,
        `ex-sprite:${
          definition.IsMegaEvolution ? "_02" : definition.IsEX ? "_01" : "none"
        }`,
      );
      for (const attackId of definition.PokemonAttackIDs) {
        const attack = attackById.get(attackId);
        assert(attack, `${card.IllustrationID} attack ${attackId} is absent`);
        addFeature(features, `damage-symbol:${attack.DamageSymbol}`);
        addFeature(features, `attack-cost-count:${attack.AttackCost.length}`);
      }
      const character = characterById.get(definition.CharacterID);
      assert(character, `${card.IllustrationID} Character is absent`);
      for (const lc of LOCALES) {
        const source = locales.get(lc).Master[character.DisplayNameMSID];
        assert.equal(typeof source, "string");
        const name = localeResolvers.get(lc)(source);
        addFeature(
          features,
          `name-layout:${lc}:${
            definition.IsMegaEvolution
              ? "mega"
              : name.includes("\n") ? "two-line" : "one-line"
          }`,
        );
      }
    } else {
      definition = trainerById.get(card.TrainerID);
      assert(definition, `${card.IllustrationID} Trainer definition is absent`);
      addFeature(features, `trainer-type:${definition.TrainerType}`);
      addFeature(
        features,
        `trainer-right-end:${Boolean(card.RightEndDisplayNameMSID)}`,
      );
    }
    const categories = definition.AdditionalCategories || [];
    addFeature(
      features,
      `category-vector:${categories.length ? categories.join(",") : "none"}`,
    );

    const rarity = rarityByValue.get(card.Rarity);
    assert(rarity, `${card.IllustrationID} rarity is absent`);
    cards.push({
      cardId: card.CardID,
      illustrationId: card.IllustrationID,
      kind,
      rarity: card.Rarity,
      rarityDisplayGroupId: rarity.RarityDisplayGroupID,
      rarityDisplayId: rarity.RarityDisplayID,
      design: contractCard.design,
      fontGroup: contractCard.fontGroup,
      names: localizedNames({
        kind,
        card,
        definition,
        characterById,
        locales,
        localeResolvers,
      }),
      obligations: [...features].sort(compareText),
      rarityRenderingObligations:
        [...rarityRenderingFeatures].sort(compareText),
    });
  }
  cards.sort((a, b) => compareText(a.cardId, b.cardId)
    || compareText(a.illustrationId, b.illustrationId));
  assert.equal(cards.length, EXPECTED.sourceCurrentCards);
  assert.equal(
    masterCards.length - cards.length,
    EXPECTED.assetGapCards,
  );

  for (const [id, metadata] of semanticExecutableMetadata) {
    Object.assign(featureMetadata.get(`semantic-executable:${id}`), {
      shaderNames: [...metadata.shaderNames].sort(compareText),
      selectorIds: [...metadata.selectorIds].sort(compareText),
    });
  }
  for (const [id, metadata] of stateMetadata) {
    Object.assign(featureMetadata.get(`material-state:${id}`), {
      materialCount: metadata.materialCount,
      materialNames: [...metadata.materialNames].sort(compareText),
    });
  }

  const universe = [...featureMetadata.keys()].sort(compareText);
  assert.equal(universe.length, EXPECTED.featureUniverse);
  const domainCounts = {};
  for (const id of universe) {
    const domain = featureMetadata.get(id).domain;
    domainCounts[domain] = (domainCounts[domain] || 0) + 1;
  }
  assert.equal(
    universe.filter((id) => id.startsWith("visual-pair:")).length,
    EXPECTED.visualPairs,
  );
  assert.equal(
    universe.filter((id) => id.startsWith("semantic-executable:")).length,
    EXPECTED.semanticExecutables,
  );
  assert.equal(
    universe.filter((id) => id.startsWith("material-state:")).length,
    EXPECTED.materialStates,
  );
  assert.equal(
    universe.filter((id) => id.startsWith("material-locator-boundary:")).length,
    EXPECTED.unresolvedMaterials,
  );

  const selection = deterministicGreedySetCover(cards, universe);
  const reversedSelection = deterministicGreedySetCover(
    [...cards].reverse(),
    universe,
  );
  assert.deepEqual(
    reversedSelection.map((card) => card.illustrationId),
    selection.map((card) => card.illustrationId),
    "set-cover selection depends on candidate enumeration order",
  );
  assert.equal(selection.length, EXPECTED.minimumWitnesses);
  const optimality = proveMinimum(cards, universe);
  assert.equal(optimality.optimalCardinality, selection.length);

  const rarityRenderingUniverse = sortedUnique(
    cards.flatMap((card) => card.rarityRenderingObligations),
  );
  assert.equal(
    rarityRenderingUniverse.length,
    EXPECTED.rarityRenderingFeatures,
  );
  const primaryRarityRenderingCoverage = new Set(
    selection.flatMap((card) => card.rarityRenderingObligations),
  );
  const missingRarityRenderingUniverse = rarityRenderingUniverse
    .filter((id) => !primaryRarityRenderingCoverage.has(id));
  const rarityRenderingCandidates = cards.map((card) => ({
    ...card,
    obligations: card.rarityRenderingObligations
      .filter((id) => missingRarityRenderingUniverse.includes(id)),
  }));
  const rarityRenderingSelection = deterministicGreedySetCover(
    rarityRenderingCandidates,
    missingRarityRenderingUniverse,
  );
  assert.equal(
    rarityRenderingSelection.length,
    EXPECTED.rarityRenderingAdditionalWitnesses,
  );
  const rarityRenderingOptimality = proveMinimum(
    rarityRenderingCandidates,
    missingRarityRenderingUniverse,
  );
  assert.equal(
    rarityRenderingOptimality.optimalCardinality,
    rarityRenderingSelection.length,
  );
  const completeRarityRenderingCoverage = new Set([
    ...primaryRarityRenderingCoverage,
    ...rarityRenderingSelection.flatMap((card) => card.newlyCovered),
  ]);
  assert.deepEqual(
    rarityRenderingUniverse.filter(
      (id) => !completeRarityRenderingCoverage.has(id),
    ),
    [],
  );

  const bundledScenes = bundledSceneIndex();
  const selectedIds = new Set(selection.map((card) => card.illustrationId));
  const rarityRenderingIds = new Set(
    rarityRenderingSelection.map((card) => card.illustrationId),
  );
  const cardByIllustration = new Map(
    cards.map((card) => [card.illustrationId, card]),
  );
  const selectedExamples = selection.map((card) => ({
    ...card,
    bundledSceneFile: bundledScenes.get(card.illustrationId) || null,
  }));
  const rarityRenderingExamples = rarityRenderingSelection.map(({
    obligations: _missingObligations,
    newlyCovered,
    ...card
  }) => ({
    ...card,
    rarityRenderingNewlyCovered: newlyCovered,
    bundledSceneFile: bundledScenes.get(card.illustrationId) || null,
  }));
  const supplementalExamples = [...bundledScenes]
    .filter(([illustrationId]) => (
      !selectedIds.has(illustrationId)
      && !rarityRenderingIds.has(illustrationId)
    ))
    .map(([illustrationId, sceneFile]) => {
      const card = cardByIllustration.get(illustrationId);
      assert(card, `${sceneFile} is outside the source-current card corpus`);
      return {
        cardId: card.cardId,
        illustrationId,
        kind: card.kind,
        rarity: card.rarity,
        rarityDisplayGroupId: card.rarityDisplayGroupId,
        rarityDisplayId: card.rarityDisplayId,
        names: card.names,
        bundledSceneFile: sceneFile,
        reason: "bundled-local-regression-scene",
      };
    })
    .sort((a, b) => compareText(a.cardId, b.cardId));

  const result = {
    schema: "pocket-card-render/official-card-examples@1",
    schemaVersion: 1,
    sampleId: officialSample.sampleId,
    sampleManifestSha256: officialSampleSha256,
    sourcePolicy: {
      expectationSources: [
        "official-masterdata",
        "official-locales",
        "official-card-text-design-contract",
        "official-card-font-contract",
        "official-material-program-proof-graph",
      ],
      forbiddenExpectationSources: [
        "scene",
        "render-recipe",
        "screenshot",
        "compose-output",
      ],
      availabilityOnlySources: [
        "tracked-prebuilt-scene-filenames",
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
      materialProgramProofGraph: {
        logicalSourceId: "official-material-program-inventory-v4-full",
        proofGraphSha256: inventory.digests.proofGraphSha256,
        usageRowsSha256: inventory.digests.usageRowsSha256,
        materialsSha256: inventory.digests.materialsSha256,
        selectorsSha256: inventory.digests.selectorsSha256,
        semanticExecutablesSha256:
          inventory.digests.semanticExecutablesSha256,
        stateArchetypesSha256: inventory.digests.stateArchetypesSha256,
      },
      masterdata: Object.fromEntries(
        tableNames.map((name) => [
          name,
          {
            rowCount: tableInputs[name].value.length,
            sha256: sha256(tableInputs[name].bytes),
          },
        ]),
      ),
      locales: Object.fromEntries(
        [...localeInputs].map(([lc, input]) => [
          lc,
          { sha256: sha256(input.bytes) },
        ]),
      ),
    },
    summary: {
      masterdataCardCount: masterCards.length,
      sourceCurrentCardCount: cards.length,
      assetGapCardCount: masterCards.length - cards.length,
      featureUniverseCount: universe.length,
      featureDomainCounts: Object.fromEntries(
        Object.entries(domainCounts).sort(([a], [b]) => compareText(a, b)),
      ),
      minimumWitnessCount: selection.length,
      bundledSelectedCount:
        selectedExamples.filter((card) => card.bundledSceneFile).length,
      rarityRenderingFeatureCount: rarityRenderingUniverse.length,
      primaryRarityRenderingFeatureCount:
        primaryRarityRenderingCoverage.size,
      minimumAdditionalRarityRenderingWitnessCount:
        rarityRenderingSelection.length,
      bundledAdditionalRarityRenderingWitnessCount:
        rarityRenderingExamples.filter((card) => card.bundledSceneFile).length,
      bundledSupplementalCount: supplementalExamples.length,
    },
    optimality: {
      claim: "global-minimum-cardinality",
      lowerBound: optimality.optimalCardinality,
      upperBound: selection.length,
      solver: optimality.solver,
      solverStatus: optimality.status,
      mipGap: optimality.mipGap,
      selectionIsIndependent:
        "The committed witness order comes from deterministic greedy; MILP independently proves its cardinality is globally minimal.",
    },
    features: universe.map((id) => featureMetadata.get(id)),
    coverageSet: {
      selectedWitnesses: selectedExamples,
      uncovered: [],
    },
    rarityRenderingCoverageSet: {
      featureUniverse: rarityRenderingUniverse,
      primaryWitnessIllustrationIds:
        selection.map((card) => card.illustrationId),
      primaryCoveredFeatureCount: primaryRarityRenderingCoverage.size,
      additionalWitnesses: rarityRenderingExamples,
      uncovered: [],
      optimality: {
        claim: "minimum-additional-cardinality-after-primary-witnesses",
        lowerBound: rarityRenderingOptimality.optimalCardinality,
        upperBound: rarityRenderingSelection.length,
        solver: rarityRenderingOptimality.solver,
        solverStatus: rarityRenderingOptimality.status,
        mipGap: rarityRenderingOptimality.mipGap,
      },
    },
    supplementalBundledExamples: supplementalExamples,
    boundaries: [
      {
        scope: "asset-snapshot",
        status: "partial-exact",
        count: EXPECTED.assetGapCards,
        detail:
          "Official masterdata cards without CardSettings in the immutable Face snapshot cannot enter the current candidate matrix.",
      },
      {
        scope: "local-playability",
        status: "availability-only",
        count:
          selectedExamples.filter((card) => !card.bundledSceneFile).length
          + rarityRenderingExamples
            .filter((card) => !card.bundledSceneFile).length,
        detail:
          "Catalog examples without a tracked prebuilt scene remain disabled until their exact per-card recipe and gathered assets are produced.",
      },
      {
        scope: "material-locator",
        status: "exact",
        count: EXPECTED.unresolvedMaterials,
        detail:
          "All 8,460 official Material identities resolve by immutable-snapshot CAB ownership, including the shared cPK_90 Logo bundle.",
      },
      {
        scope: "engine-variant-dispatch",
        status: "runtime-required",
        count: 1,
        detail:
          "The Side&Back INSTANCING_ON selector boundary is represented for every card; static selection does not prove the official guest dispatch.",
      },
    ],
  };
  assertNoUnicodeReplacement(result, "official card examples");
  return result;
}

export function serializeOfficialCardExamples(value) {
  return `${JSON.stringify(value, null, 1)}\n`;
}

function main() {
  assert.equal(
    process.argv.includes("--skip-optimal"),
    false,
    "--skip-optimal is not valid for the canonical card-examples artifact",
  );
  const examples = buildOfficialCardExamples();
  const serialized = serializeOfficialCardExamples(examples);
  const check = process.argv.includes("--check")
    || process.env.PCR_OFFICIAL_CARD_EXAMPLES_CHECK === "1";
  if (check) {
    assert.equal(
      fs.readFileSync(OUTPUT, "utf8"),
      serialized,
      "official card examples manifest is stale",
    );
    console.log("Official card examples generation check OK");
  } else {
    fs.writeFileSync(OUTPUT, serialized);
    console.log(`wrote ${path.relative(ROOT, OUTPUT)}`);
  }
  console.log([
    `${examples.summary.featureUniverseCount} official features`,
    `${examples.summary.minimumWitnessCount} globally minimal witnesses`,
    `${examples.summary.bundledSelectedCount} selected scenes ready`,
    `${examples.summary.rarityRenderingFeatureCount} rarity rendering features`,
    `${examples.summary.bundledAdditionalRarityRenderingWitnessCount} additional rarity scenes ready`,
    `${examples.summary.bundledSupplementalCount} supplemental scenes ready`,
  ].join(", "));
}

if (
  process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main();
}
