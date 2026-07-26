import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { buildCardData } from "./carddata.mjs";
import { composeFace } from "./compose.mjs";
import { compactOfficialUIImageState } from "../public/render/official-ugui-image.js";
import { isIdentityUiAffine } from "../public/render/ui-affine-transform.js";

const MASTER_ROOT = "D:/DevProjectes/ptcgp-cloudbase/cloud/src/functions/app/ptcgp-masterdata/MasterData";
const PUBLIC_GAME = join(import.meta.dirname, "..", "public", "game");
const LOCALES = ["de_DE", "en_US", "es_ES", "fr_FR", "it_IT", "ja_JP", "ko_KR", "pt_BR", "zh_TW"];
const TRAINER_NODE_SUF = {
  ja_JP: "jp", en_US: "en_id", fr_FR: "fr", it_IT: "it", de_DE: "de",
  es_ES: "es_es419", ko_KR: "ko", zh_TW: "zh", pt_BR: "pt",
};
const CATEGORY_NODE_SUF = {
  ja_JP: "jp", en_US: "en", fr_FR: "fr", it_IT: "it", de_DE: "de",
  es_ES: "es", ko_KR: "ko", zh_TW: "zh", pt_BR: "pt",
};
const ABILITY_NODE_SUF = {
  ja_JP: "jp_zh_cn", zh_TW: "jp_zh_cn", en_US: "en_id", fr_FR: "jp_fr", it_IT: "jp_it",
  de_DE: "jp_de", es_ES: "jp_es_es419", ko_KR: "jp_ko", pt_BR: "pt",
};
const TRAINER_TYPE = {
  1: { name: "TxtSupportCardNameElm/txt_support_card_name_main", sub: "TxtSupportCardNameElm/txt_support_card_name_sub", label: "support_txt/support_txt_img" },
  2: { name: "TxtToolsCardNameElm/txt_tools_card_name_main", sub: "TxtToolsCardNameElm/txt_tools_card_name_sub", label: "goods_txt/tools_txt_img" },
  3: { name: "TxtItemCardNameElm/txt_item_card_name_main", sub: "TxtItemCardNameElm/txt_item_card_name_sub", label: "item_txt/poketools_art_frm_ttl_img" },
  4: { name: "TxtFossilCardNameElm/txt_fossil_card_name_main", label: "goods_txt/tools_txt_img" },
  5: { name: "TxtStadiumCardNameElm/txt_stadium_card_name_main", label: "stadium_txt/stadium_txt_img" },
};

const load = (name) => JSON.parse(readFileSync(join(MASTER_ROOT, `${name}.json`), "utf8"));
const index = (rows, key) => new Map(rows.map((row) => [row[key], row]));
const pokemonCards = load("PokemonCard");
const trainerCards = load("TrainerCard");
const pokemon = load("Pokemon");
const trainers = load("Trainer");
const attacks = load("PokemonAttack");
const pokemonById = index(pokemon, "PokemonID");
const trainerById = index(trainers, "TrainerID");
const attackById = index(attacks, "PokemonAttackID");
const allCards = [...pokemonCards, ...trainerCards];
const textDesign = JSON.parse(readFileSync(
  join(import.meta.dirname, "..", "public", "render", "card-text-design-contract.json"),
  "utf8",
));
const uiLayout = JSON.parse(readFileSync(join(import.meta.dirname, "..", "public", "render", "card-ui-layout-contract.json"), "utf8"));
const layoutNodes = new Map();
for (const prefab of uiLayout.prefabs) {
  let hierarchyOrder = 0;
  function walk(node, parentPath = "", parentActive = true) {
    const layoutPath = `${parentPath}/${node.gameObject.name}`;
    const provenance = {
      prefabGameObjectActive: Boolean(node.gameObject.active),
      prefabActiveInHierarchy: parentActive && Boolean(node.gameObject.active),
      hierarchyOrder: hierarchyOrder++,
    };
    const bindings = layoutNodes.get(layoutPath) || [];
    bindings.push({ node, provenance });
    layoutNodes.set(layoutPath, bindings);
    for (const child of node.children || []) walk(child, layoutPath, provenance.prefabActiveInHierarchy);
  }
  for (const root of prefab.roots) walk(root);
}

function hasPath(composition, suffix) {
  return composition.elements.some((element) => element.layoutPath?.endsWith(suffix));
}

function elementAt(composition, suffix) {
  return composition.elements.find((element) => element.layoutPath?.endsWith(suffix));
}

function assertComposition(composition, cardId, locale) {
  assert.equal(composition.card, cardId);
  assert.equal(composition.locale, locale);
  assert.deepEqual(composition.canvasWH, [734, 1024]);
  assert(composition.elements.length > 0, `${cardId}/${locale} produced no elements`);
  for (const element of composition.elements) {
    assert(element.layoutPath?.startsWith("/"), `${cardId}/${locale} has an element without an official layoutPath`);
    assert(element.box && ["l", "r", "t", "b"].every((key) => Number.isFinite(element.box[key])), `${cardId}/${locale} has a non-finite box`);
    assert(Array.isArray(element.uiTransform) && element.uiTransform.length === 6,
      `${cardId}/${locale}/${element.layoutPath} lacks a complete RectTransform matrix`);
    assert(isIdentityUiAffine(element.uiTransform),
      `${cardId}/${locale}/${element.layoutPath} unexpectedly changed the current identity-transform corpus`);
    if (element.kind === "text") assert(element.layoutObjectSha256, `${cardId}/${locale}/${element.layoutPath} lacks style evidence`);
    const bindings = layoutNodes.get(element.layoutPath);
    assert(bindings?.length, `${cardId}/${locale}/${element.layoutPath} is absent from the official hierarchy`);
    const binding = bindings.find(({ provenance }) => (
      provenance.hierarchyOrder === element.hierarchyOrder
    ));
    assert(binding, `${cardId}/${locale}/${element.layoutPath} lost official hierarchy order`);
    if (element.kind === "icon" && binding.node.image) {
      assert.deepEqual(
        element.uiImage,
        compactOfficialUIImageState(binding.node.image, binding.node.canvasRenderer, binding.provenance),
        `${cardId}/${locale}/${element.layoutPath} lost official Image state`,
      );
    }
  }
}

let composedCardCount = 0;
let missingCardCount = 0;
for (const card of allCards) {
  const official = textDesign.cards[card.IllustrationID];
  if (!official) {
    missingCardCount += 1;
    assert.throws(
      () => composeFace(card.CardID, "zh_TW", card.IllustrationID),
      /official CardSettings is unavailable/,
      `${card.IllustrationID} must fail closed outside the official Face snapshot`,
    );
    continue;
  }
  composedCardCount += 1;
  const composition = composeFace(card.CardID, "zh_TW", card.IllustrationID);
  assertComposition(composition, card.CardID, "zh_TW");
  assert.equal(composition.design, official.design);
  assert.equal(composition.fontCondition, official.fontCondition);
  assert.equal(composition.fontGroup, official.fontGroup);
  assert.equal(composition.branchEvidence, "official-card-design-settings");
  if (card.CardID.startsWith("PK_")) {
    const cardData = buildCardData(card.CardID, "zh_TW");
    if (cardData.flavor) {
      const flavor = elementAt(composition, "/PokemonCardUI/library_flavor_txt");
      if (cardData.isMega) {
        assert.equal(flavor, undefined, `${card.IllustrationID} rendered flavor for a Mega Pokemon`);
      } else {
        assert.equal(
          flavor?.text,
          cardData.flavor,
          `${card.IllustrationID} did not render FlavorTextMSID through library_flavor_txt`,
        );
      }
    }
    const expectedNamePath = cardData.isMega
      ? "/PokemonCardUI/mega_name_elm/card_name_txt"
      : `/PokemonCardUI/name_elm/${
        /\r\n|\r|\n/.test(cardData.name) ? "card_name_two_line_txt" : "card_name_txt"
      }`;
    assert(
      elementAt(composition, expectedNamePath),
      `${card.IllustrationID} selected the wrong Pokemon name line variant`,
    );
    if (cardData.isEX) {
      const ruleRoot = cardData.isMega ? "PokemoMegaExRuleView" : "PokemonExRuleView";
      const ruleNode = cardData.isMega
        ? "ex_rule_description_txt_02"
        : "ex_rule_description_txt_01";
      const ruleBody = elementAt(composition, `/PokemonCardUI/${ruleRoot}/${ruleNode}`);
      assert(
        ruleBody,
        `${card.IllustrationID} selected the wrong EX rule text variant`,
      );
      const nameExBase = composition.elements.find(
        (element) => element.nameExLayer === "base",
      );
      const nameExOutline = composition.elements.find(
        (element) => element.nameExLayer === "outline",
      );
      assert.equal(
        nameExBase?.unityLayer,
        cardData.isMega ? 17 : 18,
        `${card.IllustrationID} EX base serialized layer`,
      );
      assert.equal(
        nameExOutline?.unityLayer,
        cardData.isMega ? 18 : 17,
        `${card.IllustrationID} EX outline serialized layer`,
      );
      assert.equal(ruleBody.unityLayer, 17, `${card.IllustrationID} EX rule text must use CardUIText`);
      for (const imageNode of ["frm_bg_shadow", "frm_bg"]) {
        const matches = composition.elements.filter(
          (element) => element.layoutPath === `/PokemonCardUI/${ruleRoot}/${imageNode}`,
        );
        assert.equal(
          matches.length,
          1,
          `${card.IllustrationID} must compose ${imageNode} exactly once`,
        );
        assert.equal(
          matches[0].unityLayer,
          imageNode === "frm_bg" ? 18 : 17,
          `${card.IllustrationID} ${imageNode} DynamicUI layer`,
        );
      }
      if (!cardData.isMega) {
        assert.equal(
          composition.elements.filter(
            (element) => element.layoutPath === `/PokemonCardUI/${ruleRoot}/frm`,
          ).length,
          1,
          `${card.IllustrationID} must compose the normal EX title background exactly once`,
        );
        assert.equal(ruleBody.fs, ruleBody.fsbase, `${card.IllustrationID} normal EX body base size`);
        assert.equal(ruleBody.fsmax, ruleBody.fsbase, `${card.IllustrationID} normal EX body max size`);
        assert.equal(ruleBody.fsmin, ruleBody.fsbase / 2, `${card.IllustrationID} normal EX body min size`);
        assert.equal(ruleBody.wrap, true, `${card.IllustrationID} normal EX body wrapping`);
        assert.equal(ruleBody.autosize, true, `${card.IllustrationID} normal EX body autosizing`);
      }
    }
  }
  for (const [elementIndex, element] of composition.elements.entries()) {
    assert(
      element.unityLayer === 17 || element.unityLayer === 18,
      `${card.IllustrationID} element ${elementIndex} lacks an official DynamicUI layer`,
    );
  }
  assert.equal(
    composition.dynamicUIState.length,
    textDesign.designs[official.design].dynamicUIs.length,
  );
  assert.equal(composition.dynamicUIReplay.schema, "pocket-card-render/ugui-state-replay@2");
  assert.equal(
    composition.dynamicUIReplay.operationCount,
    composition.dynamicUIState.reduce(
      (count, state) => count + state.candidates.length,
      0,
    ),
  );
  assert.deepEqual(
    composition.dynamicUIReplay.appliedOperations.map(
      ({ operationIndex }) => operationIndex,
    ),
    Array.from(
      { length: composition.dynamicUIReplay.operationCount },
      (_, index) => index,
    ),
    `${card.IllustrationID} lost sequential DynamicUI operation indices`,
  );
  for (const state of composition.dynamicUIState) {
    assert(state.candidates.length > 0, `${card.IllustrationID}/${state.label} has no candidates`);
    assert.equal(state.operationIndices.length, state.candidates.length);
    assert.deepEqual(
      state.candidates.filter(({ active }) => active).map(({ path }) => path),
      state.targetPath ? [state.targetPath] : [],
      `${card.IllustrationID}/${state.label} did not replay CardDynamicUIView.Apply`,
    );
    for (const candidate of state.candidates) {
      assert.equal(
        candidate.effectiveActive,
        candidate.active,
        `${card.IllustrationID}/${state.label}/${candidate.path} lost parent-active propagation`,
      );
    }
  }
}
assert.equal(allCards.length, 3305, "authoritative card corpus drifted");
assert.equal(composedCardCount, 3191, "source-current compose success count drifted");
assert.equal(missingCardCount, 114, "source-current asset-gap count drifted");
assert.equal(Object.keys(textDesign.cards).length, 3191);
assert.equal(textDesign.missingIllustrations.length, 114);
assert.deepEqual(
  Object.keys(textDesign.counts.cardsByMasterdataRarity).map(Number),
  [100, 200, 300, 400, 500, 600, 700, 800, 830, 860, 900],
  "official text-design corpus does not span every rarity class",
);

const trainerCardByType = new Map();
for (const card of trainerCards) {
  const type = trainerById.get(card.TrainerID).TrainerType;
  if (!trainerCardByType.has(type)) trainerCardByType.set(type, card);
}
for (const [type, expected] of Object.entries(TRAINER_TYPE)) {
  const card = trainerCardByType.get(Number(type));
  const composition = composeFace(card.CardID, "zh_TW", card.IllustrationID);
  assert(hasPath(composition, `/CollectionView/${expected.name}`), `Trainer Type ${type} uses the wrong name branch`);
  assert(composition.elements.some((element) => element.layoutPath?.includes(`/${expected.label}_zh`)), `Trainer Type ${type} uses the wrong label branch`);
}

const rightEndCard = trainerCards.find((card) => card.RightEndDisplayNameMSID);
const rightEndType = trainerById.get(rightEndCard.TrainerID).TrainerType;
const rightEndComposition = composeFace(rightEndCard.CardID, "zh_TW", rightEndCard.IllustrationID);
assert(hasPath(rightEndComposition, `/CollectionView/${TRAINER_TYPE[rightEndType].sub}`), "RightEndDisplayName did not use the official sub-name node");

const toolCard = trainerCardByType.get(3);
const toolComposition = composeFace(toolCard.CardID, "zh_TW", toolCard.IllustrationID);
assert.equal(elementAt(toolComposition, "/TrainersCardUI/CollectionView/card_rule_txt")?.text, buildCardData(toolCard.CardID, "zh_TW").ui.footer);

const fossilCard = trainerCardByType.get(4);
const fossilData = buildCardData(fossilCard.CardID, "zh_TW");
const fossilComposition = composeFace(fossilCard.CardID, "zh_TW", fossilCard.IllustrationID);
assert.equal(elementAt(fossilComposition, "/TxtFossilCardNameElm/hp_elm/hp_num_txt")?.text, String(fossilData.fossilHp));

const stadiumCard = trainerCardByType.get(5);
for (const locale of LOCALES) {
  const composition = composeFace(stadiumCard.CardID, locale, stadiumCard.IllustrationID);
  const footer = ["it_IT", "de_DE", "es_ES"].includes(locale) ? "card_rule_four_line_txt" : "card_rule_txt";
  assert(hasPath(composition, `/TrainersCardUI/CollectionView/${footer}`), `Stadium footer branch is wrong for ${locale}`);
}

const pokemonCardForShape = (abilityCount, attackCount) => pokemonCards.find((card) => {
  const row = pokemonById.get(card.PokemonID);
  return (row.PokemonAbilityIDs || []).length === abilityCount && (row.PokemonAttackIDs || []).length === attackCount;
});
const a0t1 = pokemonCardForShape(0, 1);
const a0t2 = pokemonCardForShape(0, 2);
const a1t1 = pokemonCardForShape(1, 1);
assert(hasPath(composeFace(a0t1.CardID, "zh_TW", a0t1.IllustrationID), "/PokemonSkillContainerView_01/PokemonAttackView/SkillName/skill_name_txt"));
assert(hasPath(composeFace(a0t2.CardID, "zh_TW", a0t2.IllustrationID), "/PokemonSkillContainerView_02/PokemonAttackView2/SkillName/skill_name_txt"));
const abilityComposition = composeFace(a1t1.CardID, "zh_TW", a1t1.IllustrationID);
for (const suffix of [
  "/PokemonAbilityContainerView/ability_elm/ability_name_elm/ability_icn/ability_icn_img",
  "/PokemonAbilityContainerView/ability_elm/ability_name_elm/ability_icn/ability_icn_txt_img_jp_zh_cn",
  "/PokemonAbilityContainerView/ability_elm/ability_name_elm/ability_name_txt",
  "/PokemonAbilityContainerView/ability_elm/ability_description_txt",
  "/PokemonAbilityContainerView/PokemonAttackView/SkillName/skill_name_txt",
]) assert(hasPath(abilityComposition, suffix), `A1T1 is missing ${suffix}`);

const nonExWithOutlineTarget = pokemonCards.find((card) => {
  const official = textDesign.cards[card.IllustrationID];
  const design = official && textDesign.designs[official.design];
  const target = design?.dynamicUIs?.find(({ label }) => label === "ExOutlineWhite")?.target;
  return target && !pokemonById.get(card.PokemonID)?.IsEX;
});
assert(nonExWithOutlineTarget, "official corpus has no non-EX card with an ExOutlineWhite child target");
const nonExOutlineComposition = composeFace(
  nonExWithOutlineTarget.CardID,
  "zh_TW",
  nonExWithOutlineTarget.IllustrationID,
);
assert.equal(
  nonExOutlineComposition.elements.some((element) => (
    element.layoutPath?.endsWith("/ImgExOutlineWhite/ImgExOutlineWhite")
  )),
  false,
  "a non-EX card rendered a child of the inactive official EX parent hierarchy",
);

const venusaurComposition = composeFace(
  "PK_10_000040_00",
  "zh_TW",
  "cPK_10_000040_00_FUSHIGIBANAex_RR",
);
const topEnergyElements = venusaurComposition.elements.filter((element) => (
  element.layoutPath?.startsWith("/PokemonCardUI/energy_view/CardEnergyIconView/")
));
assert.deepEqual(
  topEnergyElements.map((element) => ({
    path: element.layoutPath,
    hierarchyOrder: element.hierarchyOrder,
  })),
  [
    {
      path: "/PokemonCardUI/energy_view/CardEnergyIconView/Outline",
      hierarchyOrder: 23,
    },
    {
      path: "/PokemonCardUI/energy_view/CardEnergyIconView/icn_gra_img",
      hierarchyOrder: 24,
    },
  ],
  "top Pokemon attribute must preserve the official Outline -> icon child draw order",
);
assert(
  topEnergyElements[1].box.l > topEnergyElements[0].box.l
    && topEnergyElements[1].box.r < topEnergyElements[0].box.r
    && topEnergyElements[1].box.t > topEnergyElements[0].box.t
    && topEnergyElements[1].box.b < topEnergyElements[0].box.b,
  "top Pokemon attribute icon must use its inset official child RectTransform",
);

for (const category of [1, 2, 3]) {
  const row = pokemon.find((candidate) => (candidate.AdditionalCategories || []).includes(category));
  const card = pokemonCards.find((candidate) => candidate.PokemonID === row.PokemonID);
  const composition = composeFace(card.CardID, "zh_TW", card.IllustrationID);
  const view = category === 1 ? "UltraBeastView" : category === 2 ? "AncientView" : "FutureView";
  assert(composition.elements.some((element) => element.layoutPath?.includes(`/PokemonCardUI/${view}/`) && element.category), `Pokemon category ${category} was not activated`);
}
for (const category of [2, 3]) {
  const row = trainers.find((candidate) => (candidate.AdditionalCategories || []).includes(category));
  const card = trainerCards.find((candidate) => candidate.TrainerID === row.TrainerID);
  const composition = composeFace(card.CardID, "zh_TW", card.IllustrationID);
  const view = category === 2 ? "AncientView" : "FutureView";
  assert(composition.elements.some((element) => element.layoutPath?.includes(`/TrainersCardUI/${view}/`) && element.category), `Trainer category ${category} was not activated`);
}

const evolutionCard = pokemonCards.find((card) => {
  const characterId = pokemonById.get(card.PokemonID).PreevolvedCharacterID;
  return characterId && existsSync(join(PUBLIC_GAME, `Assets/Lettuce/_Data/Common/CardNew/Pokemon/${characterId}/${characterId}.png`));
});
assert(evolutionCard, "gathered assets contain no evolution source sprite");
const evolutionComposition = composeFace(evolutionCard.CardID, "zh_TW", evolutionCard.IllustrationID);
assert(hasPath(evolutionComposition, "/PokemonCardUI/PokemonSourceView/source_elm/source_txt"));
assert(hasPath(evolutionComposition, "/PokemonCardUI/PokemonSourceView/source_elm/source_img"));

for (const symbol of [1, 2, 3]) {
  const row = pokemon.find((candidate) => (candidate.PokemonAttackIDs || []).some((id) => attackById.get(id).DamageSymbol === symbol));
  const card = pokemonCards.find((candidate) => candidate.PokemonID === row.PokemonID);
  const composition = composeFace(card.CardID, "zh_TW", card.IllustrationID);
  const element = composition.elements.find((candidate) => candidate.layoutPath?.endsWith("/damage_num_elm/plus_txt") && candidate.damageSymbol === symbol);
  assert(element, `DamageSymbol ${symbol} did not use plus_txt`);
  assert.equal(element.text, ["", "+", "x", "-"][symbol]);
  assert.equal(element.evidence, symbol === 1 ? "exact" : "inferred");
}

for (const locale of LOCALES) {
  for (const [type, expected] of Object.entries(TRAINER_TYPE)) {
    const card = trainerCardByType.get(Number(type));
    const composition = composeFace(card.CardID, locale, card.IllustrationID);
    assert(hasPath(composition, `/CollectionView/${expected.name}`));
    const suffix = Number(type) === 5 ? CATEGORY_NODE_SUF[locale] : TRAINER_NODE_SUF[locale];
    assert(composition.elements.some((element) => element.layoutPath?.includes(`/${expected.label}_${suffix}`)), `${locale} Trainer Type ${type} selected the wrong locale node`);
  }
  const composition = composeFace(a1t1.CardID, locale, a1t1.IllustrationID);
  assert(composition.elements.some((element) => element.layoutPath?.endsWith(`/ability_icn_txt_img_${ABILITY_NODE_SUF[locale]}`)), `${locale} Ability selected the wrong locale node`);
}

console.log(
  `compose corpus: ${Object.keys(textDesign.cards).length} source-current zh_TW cards, `
  + `${textDesign.missingIllustrations.length} version-gap cards fail closed, `
  + `${LOCALES.length} locale archetype matrices passed`,
);
