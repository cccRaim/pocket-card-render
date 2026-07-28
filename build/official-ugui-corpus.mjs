import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { buildCardData } from "./carddata.mjs";

export const EVOLUTION_SOURCE_IMAGE_PATH =
  "/PokemonCardUI/PokemonSourceView/source_elm/source_img";

export function canonicalUGUICorpus(root) {
  const examples = JSON.parse(fs.readFileSync(
    path.join(root, "public", "card-examples.json"),
    "utf8",
  ));
  const localeManifest = JSON.parse(fs.readFileSync(
    path.join(root, "public", "locales", "manifest.json"),
    "utf8",
  ));
  assert.equal(examples.schema, "pocket-card-render/official-card-examples@1");
  assert.equal(examples.summary.minimumWitnessCount, 112);
  assert.equal(
    examples.summary.minimumAdditionalRarityRenderingWitnessCount,
    5,
  );
  assert.equal(examples.summary.bundledSupplementalCount, 6);
  const rows = [
    ...examples.coverageSet.selectedWitnesses,
    ...examples.rarityRenderingCoverageSet.additionalWitnesses,
    ...examples.supplementalBundledExamples,
  ];
  const cardIds = [...new Set(rows.map((row) => row.cardId))];
  const locales = localeManifest.locales.map((entry) => entry.lc);
  assert.equal(rows.length, 123);
  assert.equal(cardIds.length, 123);
  assert.equal(locales.length, 9);

  const evolutionSources = new Map(cardIds.flatMap((cardId) => {
    const source = buildCardData(cardId, "zh_TW").evolutionSource;
    return source ? [[cardId, source.characterId]] : [];
  }));
  const entries = cardIds.flatMap((cardId) => locales.map((locale) => ({
    cardId,
    locale,
    file: `${cardId}.${locale}.json`,
    evolutionSourceCharacterId: evolutionSources.get(cardId) || null,
  })));
  return {
    rows,
    cardIds,
    locales,
    entries,
    evolutionSourceCardCount: evolutionSources.size,
    evolutionSourceEntryCount: evolutionSources.size * locales.length,
  };
}

export function assertEvolutionSourceImage(
  composition,
  expectedCharacterId,
  context,
) {
  const elements = (composition.elements || []).filter(
    (element) => element.layoutPath === EVOLUTION_SOURCE_IMAGE_PATH,
  );
  assert.equal(
    elements.length,
    expectedCharacterId ? 1 : 0,
    `${context}: evolution source image count drifted`,
  );
  if (!expectedCharacterId) return null;
  const element = elements[0];
  const expectedUrl =
    `/game/Assets/Lettuce/_Data/Common/CardNew/Pokemon/`
    + `${expectedCharacterId}/${expectedCharacterId}.png`;
  assert.equal(
    element.sourceCharacterId,
    expectedCharacterId,
    `${context}: evolution source character drifted`,
  );
  assert.equal(
    element.url,
    expectedUrl,
    `${context}: evolution source texture URL drifted`,
  );
  return element;
}
