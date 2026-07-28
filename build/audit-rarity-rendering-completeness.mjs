import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  compileRuntimeMaterialDispatchIndex,
  resolveRuntimeMaterialDispatch,
} from "../public/render/runtime-dispatch-contract.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const INVENTORY_PATH = path.join(
  ROOT,
  "$cache",
  "official-material-program-inventory-v4-full.json",
);
const EXAMPLES_PATH = path.join(ROOT, "public", "card-examples.json");
const PORT_CONTRACT_PATH = path.join(
  ROOT,
  "public",
  "shaders",
  "official_program_port_contract.json",
);

function compareText(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
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
  return crypto.createHash("sha256")
    .update(JSON.stringify(sortKeys(value)))
    .digest("hex");
}

function normalizedIdentity(value) {
  assert.equal(typeof value, "string");
  return value.toLowerCase();
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

function selectorId(material) {
  return canonicalDigest([
    material.shaderIdentity,
    material.keywords,
  ]);
}

function usageKey(row) {
  return [
    normalizedIdentity(row.rendererIdentity),
    row.materialSlot,
    normalizedIdentity(row.materialIdentity),
  ].join("#");
}

function featureParts(id) {
  const match = /^rarity-(semantic-executable|material-state):(\d+):([0-9a-f]{64})$/u
    .exec(id);
  assert(match, `invalid rarity-rendering feature ${id}`);
  return {
    type: match[1],
    rarity: Number(match[2]),
    identity: match[3],
  };
}

function addMaterialFeatures(target, rarity, material, selectorsById) {
  const state = materialStateId(material);
  target.add(`rarity-material-state:${rarity}:${state}`);
  const selector = selectorsById.get(selectorId(material));
  assert(selector, `${material.identity}: selector is absent`);
  for (const executable of selector.staticExecutables || []) {
    target.add(
      `rarity-semantic-executable:${rarity}:`
      + executable.executable.semanticExecutableId,
    );
  }
}

function obligationValue(witness, prefix) {
  assert(
    witness.obligations === undefined || Array.isArray(witness.obligations),
    `${witness.illustrationId}: obligations must be an array when present`,
  );
  const row = (witness.obligations || []).find(
    (value) => value.startsWith(prefix),
  );
  return row ? row.slice(prefix.length) : null;
}

function uiImageElements(textArtifact) {
  return (textArtifact.elements || []).filter(
    (element) => element.kind === "icon" || element.url,
  );
}

function summarizeByRarity(expected, actual, witnessRarities) {
  const rarities = new Set([
    ...[...expected].map((id) => featureParts(id).rarity),
    ...witnessRarities,
  ]);
  return [...rarities].sort((a, b) => a - b).map((rarity) => {
    const expectedRows = [...expected]
      .map(featureParts)
      .filter((row) => row.rarity === rarity);
    const actualRows = [...actual]
      .map(featureParts)
      .filter((row) => row.rarity === rarity);
    const count = (rows, type) => rows.filter((row) => row.type === type).length;
    return {
      rarity,
      witnessCards: witnessRarities.filter((value) => value === rarity).length,
      semanticExecutables: {
        exact: count(actualRows, "semantic-executable"),
        total: count(expectedRows, "semantic-executable"),
      },
      materialStates: {
        exact: count(actualRows, "material-state"),
        total: count(expectedRows, "material-state"),
      },
    };
  });
}

export function auditRarityRenderingCompleteness({
  inventory,
  examples,
  portContract,
  loadScene,
  loadText,
  assetExists,
}) {
  assert.equal(inventory.schemaVersion, 4);
  assert.equal(examples.schema, "pocket-card-render/official-card-examples@1");
  assert.equal(
    examples.inputs.materialProgramProofGraph.proofGraphSha256,
    inventory.digests.proofGraphSha256,
    "card examples and official inventory use different proof roots",
  );
  assert.equal(
    examples.inputs.materialProgramProofGraph.usageRowsSha256,
    inventory.digests.usageRowsSha256,
    "card examples and official usage rows differ",
  );
  assert.equal(examples.summary.rarityRenderingFeatureCount, 543);
  assert.equal(
    examples.summary.minimumAdditionalRarityRenderingWitnessCount,
    5,
  );

  const materialsById = new Map(
    inventory.proofGraph.materials.map((material) => [
      normalizedIdentity(material.identity),
      material,
    ]),
  );
  const selectorsById = new Map(
    inventory.proofGraph.selectors.map((selector) => [
      selector.selectorId,
      selector,
    ]),
  );
  const usagesByIllustration = new Map();
  for (const usage of inventory.proofGraph.usageRows) {
    const rows = usagesByIllustration.get(usage.illustrationId) || [];
    rows.push(usage);
    usagesByIllustration.set(usage.illustrationId, rows);
  }
  const dispatchIndex = compileRuntimeMaterialDispatchIndex(portContract);
  const primary = examples.coverageSet.selectedWitnesses;
  const additional =
    examples.rarityRenderingCoverageSet.additionalWitnesses;
  const witnesses = [...primary, ...additional];
  assert.equal(primary.length, 112);
  assert.equal(additional.length, 5);
  assert.equal(
    new Set(witnesses.map((row) => row.illustrationId)).size,
    witnesses.length,
  );

  const actualFeatures = new Set();
  let exactDraws = 0;
  let materialRecipes = 0;
  let uiArtifacts = 0;
  let uiResourceBindings = 0;
  let uiRuntimeProducerBindings = 0;
  let uiStructuralObligations = 0;
  for (const witness of witnesses) {
    const scene = loadScene(witness);
    assert.equal(scene.card?.id, witness.illustrationId);
    assert.equal(scene.officialDrawSchemaVersion, 2);
    assert.deepEqual(scene._missing, [], `${witness.illustrationId}: scene has missing assets`);

    const expectedRows = usagesByIllustration.get(witness.illustrationId) || [];
    const actualRows = scene.officialDraws || [];
    assert.deepEqual(
      actualRows.map(usageKey).sort(compareText),
      expectedRows.map(usageKey).sort(compareText),
      `${witness.illustrationId}: scene draw inventory is incomplete`,
    );
    exactDraws += actualRows.length;

    for (const draw of actualRows) {
      const material = materialsById.get(
        normalizedIdentity(draw.materialIdentity),
      );
      assert(material, `${witness.illustrationId}: unresolved ${draw.materialIdentity}`);
      assert.equal(
        normalizedIdentity(draw.shaderIdentity),
        normalizedIdentity(material.shaderIdentity),
        `${witness.illustrationId}: draw Shader identity drifted`,
      );
      const recipe = scene.materials?.[draw.materialName];
      assert(recipe, `${witness.illustrationId}: ${draw.materialName} recipe is absent`);
      assert.equal(
        normalizedIdentity(recipe.official?.material),
        normalizedIdentity(draw.materialIdentity),
        `${witness.illustrationId}: recipe Material identity drifted`,
      );
      assert.equal(
        normalizedIdentity(recipe.official?.shader),
        normalizedIdentity(draw.shaderIdentity),
        `${witness.illustrationId}: recipe Shader identity drifted`,
      );
      assert(
        resolveRuntimeMaterialDispatch(dispatchIndex, recipe),
        `${witness.illustrationId}: ${draw.materialName} has no runtime dispatch`,
      );
      materialRecipes += 1;
      addMaterialFeatures(
        actualFeatures,
        witness.rarity,
        material,
        selectorsById,
      );
    }

    const locales = Object.keys(witness.names || {}).sort(compareText);
    assert(locales.length > 0, `${witness.illustrationId}: no official locales`);
    const stage = obligationValue(witness, "evolution-stage:");
    const hasEvolutionSource =
      obligationValue(witness, "evolution-source:") === "true";
    for (const locale of locales) {
      const textArtifact = loadText(witness, locale);
      assert.equal(
        textArtifact.card,
        witness.cardId,
        `${witness.illustrationId}/${locale}: card text identity drifted`,
      );
      assert.equal(
        textArtifact.locale,
        locale,
        `${witness.illustrationId}/${locale}: locale identity drifted`,
      );
      assert(
        Array.isArray(textArtifact.elements) && textArtifact.elements.length > 0,
        `${witness.illustrationId}/${locale}: UI artifact has no draw elements`,
      );
      uiArtifacts += 1;

      for (const element of uiImageElements(textArtifact)) {
        assert.equal(
          typeof element.url,
          "string",
          `${witness.illustrationId}/${locale}: UI image has no texture URL`,
        );
        assert(
          assetExists(element.url),
          `${witness.illustrationId}/${locale}: UI image asset is absent: ${element.url}`,
        );
        uiResourceBindings += 1;
        if (element.runtimeSpriteProducer) {
          assert.equal(
            element.runtimeSpriteProducer.output?.textureUrl,
            element.url,
            `${witness.illustrationId}/${locale}: runtime Sprite output drifted`,
          );
          uiRuntimeProducerBindings += 1;
        }
      }

      if (witness.kind === "Pokemon" && stage) {
        const markerPath =
          `/PokemonCardUI/PokemonSourceView/phase_elm/phase${stage}_txt/`;
        assert(
          textArtifact.elements.some(
            (element) =>
              element.kind === "icon"
              && element.layoutPath?.startsWith(markerPath),
          ),
          `${witness.illustrationId}/${locale}: evolution stage marker is absent`,
        );
        uiStructuralObligations += 1;
      }
      if (hasEvolutionSource) {
        const sourceRoot = "/PokemonCardUI/PokemonSourceView/source_elm";
        const sourceText = textArtifact.elements.find(
          (element) =>
            element.kind === "text"
            && element.layoutPath === `${sourceRoot}/source_txt`,
        );
        const sourceImage = textArtifact.elements.find(
          (element) =>
            element.kind === "icon"
            && element.layoutPath === `${sourceRoot}/source_img`,
        );
        assert(
          sourceText?.text,
          `${witness.illustrationId}/${locale}: evolution source text is absent`,
        );
        assert(
          sourceImage?.sourceCharacterId,
          `${witness.illustrationId}/${locale}: evolution source image is absent`,
        );
        const expectedSuffix =
          `/Pokemon/${sourceImage.sourceCharacterId}/`
          + `${sourceImage.sourceCharacterId}.png`;
        assert(
          sourceImage.url.endsWith(expectedSuffix),
          `${witness.illustrationId}/${locale}: evolution source image identity drifted`,
        );
        uiStructuralObligations += 2;
      }
    }
  }

  const expectedFeatures = new Set(
    examples.rarityRenderingCoverageSet.featureUniverse,
  );
  assert.equal(expectedFeatures.size, 543);
  assert.deepEqual(
    [...expectedFeatures].filter((id) => !actualFeatures.has(id)),
    [],
    "rarity rendering feature witness is missing from generated scenes",
  );
  assert.deepEqual(
    [...actualFeatures].filter((id) => !expectedFeatures.has(id)),
    [],
    "generated scenes contain an unversioned rarity rendering feature",
  );

  const rarityRows = summarizeByRarity(
    expectedFeatures,
    actualFeatures,
    witnesses.map((row) => row.rarity),
  );
  for (const row of rarityRows) {
    assert.equal(
      row.semanticExecutables.exact,
      row.semanticExecutables.total,
      `rarity ${row.rarity}: semantic executable coverage`,
    );
    assert.equal(
      row.materialStates.exact,
      row.materialStates.total,
      `rarity ${row.rarity}: Material state coverage`,
    );
  }
  const uiObligations =
    uiArtifacts
    + uiResourceBindings
    + uiRuntimeProducerBindings
    + uiStructuralObligations;
  const exactObligations = actualFeatures.size + uiObligations;
  const totalObligations = expectedFeatures.size + uiObligations;
  return {
    schema: "pocket-card-render/rarity-rendering-completeness-audit@1",
    sampleId: examples.sampleId,
    sampleManifestSha256: examples.sampleManifestSha256,
    scope: {
      claim: "source-current-minimum-witness-render-path-input-closure",
      excludes: [
        "official-guest-vulkan-dispatch",
        "official-guest-descriptor-and-uniform-values",
        "vulkan-to-webgl-backend-semantic-equivalence",
        "114-masterdata-cards-outside-the-current-Face-snapshot",
      ],
    },
    summary: {
      sourceCurrentCards: examples.summary.sourceCurrentCardCount,
      primaryWitnessCards: primary.length,
      additionalWitnessCards: additional.length,
      witnessCards: witnesses.length,
      officialDrawsJoined: exactDraws,
      materialRecipesJoined: materialRecipes,
      rarityRenderingFeaturesExact: actualFeatures.size,
      rarityRenderingFeaturesTotal: expectedFeatures.size,
      dynamicUiArtifactsJoined: uiArtifacts,
      dynamicUiResourceBindingsJoined: uiResourceBindings,
      dynamicUiRuntimeProducerBindingsJoined: uiRuntimeProducerBindings,
      dynamicUiStructuralObligationsExact: uiStructuralObligations,
      renderPathObligationsExact: exactObligations,
      renderPathObligationsTotal: totalObligations,
      renderPathInputClosurePercent:
        exactObligations / totalObligations * 100,
    },
    rarities: rarityRows,
  };
}

function main() {
  const inventory = JSON.parse(fs.readFileSync(INVENTORY_PATH, "utf8"));
  const examples = JSON.parse(fs.readFileSync(EXAMPLES_PATH, "utf8"));
  const portContract = JSON.parse(
    fs.readFileSync(PORT_CONTRACT_PATH, "utf8"),
  );
  const result = auditRarityRenderingCompleteness({
    inventory,
    examples,
    portContract,
    loadScene: (witness) => JSON.parse(fs.readFileSync(
      path.join(
        ROOT,
        "public",
        witness.bundledSceneFile || `scene.${witness.illustrationId}.json`,
      ),
      "utf8",
    )),
    loadText: (witness, locale) => JSON.parse(fs.readFileSync(
      path.join(ROOT, "public", "text", `${witness.cardId}.${locale}.json`),
      "utf8",
    )),
    assetExists: (url) => fs.existsSync(path.join(
      ROOT,
      "public",
      decodeURI(url).replace(/^\//u, ""),
    )),
  });
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log("Rarity rendering completeness audit OK");
  console.log(
    `  official draw join: ${result.summary.officialDrawsJoined}/`
    + `${result.summary.officialDrawsJoined}`,
  );
  console.log(
    `  rarity render features: ${result.summary.rarityRenderingFeaturesExact}/`
    + `${result.summary.rarityRenderingFeaturesTotal}`,
  );
  console.log(
    `  dynamic UI artifacts: ${result.summary.dynamicUiArtifactsJoined}, `
    + `resources ${result.summary.dynamicUiResourceBindingsJoined}, `
    + `runtime producers ${result.summary.dynamicUiRuntimeProducerBindingsJoined}, `
    + `structural obligations ${result.summary.dynamicUiStructuralObligationsExact}`,
  );
  for (const row of result.rarities) {
    console.log(
      `  ${String(row.rarity).padStart(3)}: `
      + `program ${row.semanticExecutables.exact}/${row.semanticExecutables.total}, `
      + `state ${row.materialStates.exact}/${row.materialStates.total}, `
      + `${row.witnessCards} witness card(s)`,
    );
  }
  console.log(
    "  official Shader restoration remains unscored until guest Vulkan evidence exists",
  );
}

if (
  process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main();
}
