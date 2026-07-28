import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  auditRarityRenderingCompleteness,
} from "./audit-rarity-rendering-completeness.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (filename) => JSON.parse(fs.readFileSync(filename, "utf8"));
const inventory = read(path.join(
  ROOT,
  "$cache",
  "official-material-program-inventory-v4-full.json",
));
const examples = read(path.join(ROOT, "public", "card-examples.json"));
const portContract = read(path.join(
  ROOT,
  "public",
  "shaders",
  "official_program_port_contract.json",
));
const scenes = new Map();
const textArtifacts = new Map();
const loadScene = (witness) => {
  if (!scenes.has(witness.illustrationId)) {
    scenes.set(witness.illustrationId, read(path.join(
      ROOT,
      "public",
      witness.bundledSceneFile || `scene.${witness.illustrationId}.json`,
    )));
  }
  return scenes.get(witness.illustrationId);
};
const loadText = (witness, locale) => {
  const key = `${witness.cardId}|${locale}`;
  if (!textArtifacts.has(key)) {
    textArtifacts.set(key, read(path.join(
      ROOT,
      "public",
      "text",
      `${witness.cardId}.${locale}.json`,
    )));
  }
  return textArtifacts.get(key);
};
const assetExists = (url) => fs.existsSync(path.join(
  ROOT,
  "public",
  decodeURI(url).replace(/^\//u, ""),
));

const baseline = auditRarityRenderingCompleteness({
  inventory,
  examples,
  portContract,
  loadScene,
  loadText,
  assetExists,
});
assert.equal(baseline.summary.renderPathInputClosurePercent, 100);
assert.equal(baseline.summary.rarityRenderingFeaturesExact, 543);

const firstWitness = examples.coverageSet.selectedWitnesses[0];
const missingDrawScenes = new Map(scenes);
const missingDraw = structuredClone(loadScene(firstWitness));
missingDraw.officialDraws.pop();
missingDrawScenes.set(firstWitness.illustrationId, missingDraw);
assert.throws(
  () => auditRarityRenderingCompleteness({
    inventory,
    examples,
    portContract,
    loadScene: (witness) => (
      missingDrawScenes.get(witness.illustrationId) || loadScene(witness)
    ),
    loadText,
    assetExists,
  }),
  /scene draw inventory is incomplete/u,
);

const missingWitnessExamples = structuredClone(examples);
missingWitnessExamples.rarityRenderingCoverageSet.additionalWitnesses.pop();
assert.throws(
  () => auditRarityRenderingCompleteness({
    inventory,
    examples: missingWitnessExamples,
    portContract,
    loadScene,
    loadText,
    assetExists,
  }),
);

const evolutionWitness = examples.coverageSet.selectedWitnesses.find(
  (witness) => witness.obligations.includes("evolution-source:true"),
);
assert(evolutionWitness, "minimum witnesses contain no evolution source");
const missingEvolutionTexts = new Map(textArtifacts);
const evolutionKey = `${evolutionWitness.cardId}|zh_TW`;
const missingEvolutionImage = structuredClone(
  loadText(evolutionWitness, "zh_TW"),
);
missingEvolutionImage.elements = missingEvolutionImage.elements.filter(
  (element) =>
    element.layoutPath !== "/PokemonCardUI/PokemonSourceView/source_elm/source_img",
);
missingEvolutionTexts.set(evolutionKey, missingEvolutionImage);
assert.throws(
  () => auditRarityRenderingCompleteness({
    inventory,
    examples,
    portContract,
    loadScene,
    loadText: (witness, locale) => (
      missingEvolutionTexts.get(`${witness.cardId}|${locale}`)
      || loadText(witness, locale)
    ),
    assetExists,
  }),
  /evolution source image is absent/u,
);

console.log("Rarity rendering completeness mutation tests OK");
console.log("  missing official draw rejected");
console.log("  missing minimum rarity witness rejected");
console.log("  missing evolution source image rejected");
