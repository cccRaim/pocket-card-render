import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildOfficialCardExamples,
  serializeOfficialCardExamples,
} from "./build-official-card-examples.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ARTIFACT = path.join(ROOT, "public", "card-examples.json");

const examples = buildOfficialCardExamples();
assert.equal(
  fs.readFileSync(ARTIFACT, "utf8"),
  serializeOfficialCardExamples(examples),
  "official card examples artifact is stale",
);
assert.equal(examples.schemaVersion, 1);
assert.equal(examples.summary.featureUniverseCount, 444);
assert.equal(examples.summary.minimumWitnessCount, 112);
assert.equal(examples.optimality.lowerBound, 112);
assert.equal(examples.optimality.upperBound, 112);
assert.equal(examples.optimality.mipGap, 0);
assert.deepEqual(examples.coverageSet.uncovered, []);
assert.deepEqual(examples.sourcePolicy.forbiddenExpectationSources, [
  "scene",
  "render-recipe",
  "screenshot",
  "compose-output",
]);

const features = new Set(examples.features.map((feature) => feature.id));
assert.equal(features.size, examples.features.length);
const selected = examples.coverageSet.selectedWitnesses;
assert.equal(
  new Set(selected.map((card) => card.illustrationId)).size,
  selected.length,
);
const covered = new Set(selected.flatMap((card) => card.obligations));
assert.deepEqual(
  [...features].filter((id) => !covered.has(id)),
  [],
);

for (const card of selected) {
  assert(card.newlyCovered.length > 0, `${card.illustrationId} is a no-op witness`);
  assert(card.newlyCovered.every((id) => card.obligations.includes(id)));
  const withoutCard = new Set(
    selected
      .filter((candidate) => candidate !== card)
      .flatMap((candidate) => candidate.obligations),
  );
  assert(
    [...features].some((id) => !withoutCard.has(id)),
    `${card.illustrationId} is removable from a claimed minimum set`,
  );
  assert.deepEqual(Object.keys(card.names).sort(), [
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
  for (const name of Object.values(card.names)) {
    assert(!/\[Text:/u.test(name), `${card.illustrationId} retained a message token`);
    assert(!/\bex\s+ex$/iu.test(name), `${card.illustrationId} duplicated the ex suffix`);
    assert(!/[\x01-\x07]/u.test(name), `${card.illustrationId} retained a text sentinel`);
  }
}

const bundled = [
  ...selected.filter((card) => card.bundledSceneFile),
  ...examples.supplementalBundledExamples,
];
assert.equal(
  bundled.length,
  examples.summary.bundledSelectedCount
    + examples.summary.bundledSupplementalCount,
);
assert.equal(examples.summary.bundledSelectedCount, selected.length);
assert.equal(
  examples.boundaries.find((item) => item.scope === "local-playability")?.count,
  0,
);
for (const card of bundled) {
  assert(
    fs.existsSync(path.join(ROOT, "public", card.bundledSceneFile)),
    `${card.bundledSceneFile} is not actually bundled`,
  );
}

const mutation = structuredClone(examples);
mutation.coverageSet.selectedWitnesses.pop();
const mutatedCoverage = new Set(
  mutation.coverageSet.selectedWitnesses.flatMap((card) => card.obligations),
);
assert(
  [...features].some((id) => !mutatedCoverage.has(id)),
  "removing a witness did not break coverage",
);

console.log("Official card examples audit OK");
console.log(`  official feature obligations: ${features.size}`);
console.log(`  globally minimal witnesses:   ${selected.length}`);
console.log(`  bundled playable examples:    ${bundled.length}`);
