import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildCardData } from "./carddata.mjs";
import { composeFace } from "./compose.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CORPUS = JSON.parse(fs.readFileSync(
  path.join(ROOT, "public", "card-examples.json"),
  "utf8",
));
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

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function dynamicUIStateId(composition) {
  return composition.dynamicUIState
    .map((state) => ({
      label: state.label,
      controllerPath: state.controllerPath,
      targetName: state.targetPath?.split("/").pop() || null,
    }))
    .sort((left, right) => (
      compareText(left.label, right.label)
      || compareText(left.controllerPath, right.controllerPath)
    ))
    .map((state) => `${state.label}=${state.targetName ?? "null"}`)
    .join("|");
}

function assertSdfBinding(binding, label) {
  assert(binding, `${label} has no official SDF binding`);
  assert(/^-?(?:0|[1-9]\d*)$/u.test(String(binding.fontId)), `${label} has invalid fontId`);
  assert(/^-?(?:0|[1-9]\d*)$/u.test(String(binding.materialId)), `${label} has invalid materialId`);
  assert(Number(binding.gradientScale) > 0, `${label} has invalid gradientScale`);
}

function assertBox(box, label) {
  assert(box && typeof box === "object", `${label} has no box`);
  for (const edge of ["l", "r", "t", "b"]) {
    assert(Number.isFinite(box[edge]), `${label}.${edge} is not finite`);
  }
}

const EXPECTED_LAYOUT = Object.freeze({
  Pokemon: Object.freeze({
    prefabKind: "pokemon",
    nodeCount: 318,
    fitterComponentCount: 93,
  }),
  Trainer: Object.freeze({
    prefabKind: "trainer",
    nodeCount: 194,
    fitterComponentCount: 34,
  }),
});

assert.equal(
  CORPUS.schema,
  "pocket-card-render/official-card-examples@1",
);
assert.equal(CORPUS.summary.minimumWitnessCount, 112);
assert.equal(CORPUS.coverageSet.selectedWitnesses.length, 112);
assert.equal(CORPUS.coverageSet.uncovered.length, 0);
assert.equal(CORPUS.summary.featureUniverseCount, 444);
assert.equal(CORPUS.summary.featureDomainCounts["serialized-card-design"], 136);
assert.equal(CORPUS.summary.featureDomainCounts["card-face-semantics"], 64);

const executedObligations = new Set();
const executedVisualLocales = new Set();
const executedKindRarities = new Set();
const executedFontGroups = new Set();
const executedDynamicStates = new Set();
const executedRarities = new Set();
let compositionCount = 0;
let elementCount = 0;
let textElementCount = 0;
let hpLabelElementCount = 0;
let hpNumberElementCount = 0;
let hpCompositeElementCount = 0;
let convergedLayoutCount = 0;

const textFeatureUniverse = CORPUS.features
  .filter(({ domain }) => (
    domain === "serialized-card-design"
    || domain === "card-face-semantics"
  ))
  .map(({ id }) => id);
const textFeatureSet = new Set(textFeatureUniverse);

for (const witness of CORPUS.coverageSet.selectedWitnesses) {
  const expectedDynamicState = witness.obligations.find(
    (obligation) => obligation.startsWith("dynamic-ui:"),
  )?.slice("dynamic-ui:".length);
  assert.notEqual(expectedDynamicState, undefined, `${witness.illustrationId} has no DynamicUI obligation`);
  for (const locale of LOCALES) {
    const cardData = buildCardData(witness.cardId, locale);
    const composition = composeFace(
      witness.cardId,
      locale,
      witness.illustrationId,
    );
    const label = `${witness.illustrationId}/${locale}`;
    assert(
      !JSON.stringify(composition).includes("\uFFFD"),
      `${label} contains U+FFFD`,
    );
    assert.equal(composition.card, witness.cardId);
    assert.equal(composition.locale, locale);
    assert.equal(composition.design, witness.design);
    assert.equal(composition.fontGroup, witness.fontGroup);
    assert.equal(cardData.name, witness.names[locale], `${label} localized display name drifted`);
    assert.equal(
      `${witness.kind}:${witness.rarity}`,
      witness.obligations.find((obligation) => obligation.startsWith("kind-rarity:"))
        ?.slice("kind-rarity:".length),
    );
    assert.equal(
      `${composition.design}::${composition.fontGroup}`,
      witness.obligations.find((obligation) => obligation.startsWith("visual-pair:"))
        ?.slice("visual-pair:".length),
    );
    assert.equal(
      dynamicUIStateId(composition),
      expectedDynamicState,
      `${label} executed the wrong DynamicUI vector`,
    );
    assert.equal(
      composition.dynamicUIReplay.schema,
      "pocket-card-render/ugui-state-replay@2",
    );
    assert.equal(
      composition.dynamicUIReplay.operationCount,
      composition.dynamicUIReplay.appliedOperations.length,
    );
    const expectedLayout = EXPECTED_LAYOUT[witness.kind];
    assert(expectedLayout, `${label} has no expected layout family`);
    assert.equal(
      composition.layoutRuntime.contractId,
      "pocket-card-render/official-layout-fitters@1",
    );
    assert.equal(composition.layoutRuntime.prefabKind, expectedLayout.prefabKind);
    assert.equal(composition.layoutRuntime.nodeCount, expectedLayout.nodeCount);
    assert.equal(
      composition.layoutRuntime.fitterComponentCount,
      expectedLayout.fitterComponentCount,
    );
    assert(composition.layoutRuntime.textLayoutElementCount > 0);
    assert(composition.layoutRuntime.iterations > 0);
    assert(composition.layoutRuntime.rebuildCount > 0);
    assert(
      composition.layoutRuntime.traceLength
        >= composition.layoutRuntime.rebuildCount,
    );
    assert.equal(composition.layoutRuntime.converged, true);
    convergedLayoutCount += 1;
    assert(composition.elements.length > 0, `${label} produced no draw elements`);

    for (const element of composition.elements) {
      elementCount += 1;
      assert(
        element.layoutNodeId,
        `${label}/${element.layoutPath} lacks official GameObject identity`,
      );
      assertBox(element.authoredBox, `${label}/${element.layoutPath}/authoredBox`);
      assertBox(element.box, `${label}/${element.layoutPath}/box`);
      assert(
        Number.isSafeInteger(element.hierarchyOrder)
          && element.hierarchyOrder >= 0,
        `${label}/${element.layoutPath} has invalid hierarchy order`,
      );
      assert(
        Array.isArray(element.uiTransform)
          && element.uiTransform.length === 6
          && element.uiTransform.every(Number.isFinite),
        `${label}/${element.layoutPath} has invalid RectTransform`,
      );
      if (element.kind === "text") {
        textElementCount += 1;
        assertSdfBinding(element.sdf, `${label}/${element.layoutPath}`);
        if (element.layoutPath?.endsWith("/hp_txt_elm/hp_txt")) {
          hpLabelElementCount += 1;
          assert(element.layoutNodeId, `${label} HP label lacks official GameObject identity`);
          assert(element.tmpComponentId, `${label} HP label lacks official TMP identity`);
        }
        if (element.layoutPath?.endsWith("/hp_num_txt")) {
          hpNumberElementCount += 1;
          assert(element.layoutNodeId, `${label} HP number lacks official GameObject identity`);
          assert(element.tmpComponentId, `${label} HP number lacks official TMP identity`);
        }
        if (element.boldStyle) {
          assertSdfBinding(
            element.boldStyle.sdf,
            `${label}/${element.layoutPath}/bold`,
          );
        }
      } else if (element.kind === "hp") {
        hpCompositeElementCount += 1;
      }
    }

    for (const obligation of witness.obligations) {
      if (textFeatureSet.has(obligation)) executedObligations.add(obligation);
    }
    executedVisualLocales.add(`${composition.design}::${composition.fontGroup}|${locale}`);
    executedKindRarities.add(`${witness.kind}:${witness.rarity}`);
    executedFontGroups.add(witness.fontGroup);
    executedDynamicStates.add(expectedDynamicState);
    executedRarities.add(witness.rarity);
    compositionCount += 1;
  }
}

assert.equal(compositionCount, 112 * LOCALES.length);
assert.equal(convergedLayoutCount, compositionCount);
assert.equal(executedVisualLocales.size, 106 * LOCALES.length);
assert.deepEqual(
  [...executedObligations].sort(compareText),
  [...textFeatureUniverse].sort(compareText),
);
assert.equal(executedKindRarities.size, 16);
assert.equal(executedFontGroups.size, 10);
assert.equal(executedDynamicStates.size, 4);
assert.deepEqual(
  [...executedRarities].sort((left, right) => left - right),
  [100, 200, 300, 400, 500, 600, 700, 800, 830, 860, 900],
);
assert(textElementCount > 0);
assert(hpLabelElementCount > 0);
assert.equal(hpLabelElementCount, hpNumberElementCount);
assert.equal(
  hpCompositeElementCount,
  0,
  "official HP nodes regressed to the removed synthetic composite draw",
);

const parentActivationWitness = composeFace(
  "PK_10_018180_00",
  "zh_TW",
  "cPK_10_018180_00_ARABURUTAKE_C",
);
assert(parentActivationWitness.dynamicUI.ExOutlineWhite);
assert.equal(
  parentActivationWitness.elements.some((element) => (
    element.layoutPath?.endsWith("/ImgExOutlineWhite/ImgExOutlineWhite")
  )),
  false,
  "DynamicUI child selection bypassed the official non-EX parent activation branch",
);

console.log("Official text variant execution corpus OK");
console.log([
  `${compositionCount} compositions`,
  `${executedVisualLocales.size} visual-pair x locale executions`,
  `${executedObligations.size}/${textFeatureUniverse.length} text/card-face obligations`,
  `${executedRarities.size} rarity classes`,
  `${elementCount} elements`,
  `${textElementCount} TMP text elements`,
  `${hpLabelElementCount} official HP label/number pairs`,
  `${hpCompositeElementCount} synthetic HP composites`,
  `${convergedLayoutCount} converged official layouts`,
].join(", "));
