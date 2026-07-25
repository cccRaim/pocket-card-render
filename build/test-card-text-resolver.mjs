import assert from "node:assert/strict";
import fs from "node:fs";
import {
  CARD_TEXT_SENTINELS,
  createCardTextResolver,
  hasKoreanPatchim,
  inlineElementSentinel,
  inlineElementTypeFromSentinel,
  resolveKoreanPatchim,
} from "./card-text-resolver.mjs";

const locale = JSON.parse(fs.readFileSync(
  "D:/DevProjectes/ptcg-apk-parser/apks/output/locale_en_US.json",
  "utf8",
)).Master;
const resolve = createCardTextResolver(locale, {
  attackName: () => "Rolling Rampage",
  abilityName: () => "Victorious Star",
}, "en_US");

assert.equal(
  resolve('[Gr:Count s="a " ref="0"][Num:Int id="0" plural_only=" "]card', [1]),
  "a card",
);
assert.equal(
  resolve('[Gr:Count s="a " ref="0"][Num:Int id="0" plural_only=" "]card', [2]),
  "2 card",
);
assert.equal(resolve('[Num:Int id="0" visible="0"]x', [7]), "x");
assert.equal(resolve('[Text:AttackName id="0"]', ["unused"]), "Rolling Rampage");
assert.equal(resolve('[Text:AbilityName id="0" suffix="Short"]', ["unused"]), "Victorious Star");
assert.equal(
  resolve('[Text:SpecialCondition id="0"]', ["Asleep"]),
  "Asleep",
);
assert.equal(
  resolve('[Text:EvolutionPokemon id="0"]', ["Basic"]),
  "Basic Pokémon",
);
const element = resolve('[Img:Element name="R"]');
assert.equal([...element].length, 1);
assert.equal(inlineElementTypeFromSentinel(element), "Fire");
assert.equal(resolve('[Ctrl:Italic]note[/Ctrl:Italic]'), `${CARD_TEXT_SENTINELS.italicStart}note${CARD_TEXT_SENTINELS.italicEnd}`);
assert.equal(resolve('[Ctrl:NoBreak]−20[/Ctrl:NoBreak]'), `${CARD_TEXT_SENTINELS.noBreakStart}−20${CARD_TEXT_SENTINELS.noBreakEnd}`);
assert.equal(resolve('a[C:Nbsp]b[C:Nnbsp]c'), "a\u00A0b\u202Fc");
assert.equal(
  resolve('trocá[C:Nbh]lo'),
  `trocá${CARD_TEXT_SENTINELS.noBreakStart}-${CARD_TEXT_SENTINELS.noBreakEnd}lo`,
);
assert.equal(resolve('CHECK [C:Lsb]check[C:Rsb]'), "CHECK [check]");
assert.equal(hasKoreanPatchim("잠듦"), true);
assert.equal(hasKoreanPatchim("마비"), false);
assert.equal(hasKoreanPatchim("불", "으로/로"), false, "rieul omits 으 before 로");
assert.equal(hasKoreanPatchim("물", "으로/로"), false, "rieul energy proxy omits 으 before 로");
assert.equal(resolveKoreanPatchim("잠듦", "으로/로"), "으로");
assert.equal(resolveKoreanPatchim("마비", "으로/로"), "로");
assert.equal(resolveKoreanPatchim(inlineElementSentinel("Grass"), "gwa_wa"), "과");
assert.equal(resolveKoreanPatchim(inlineElementSentinel("Lightning"), "gwa_wa"), "와");
assert.equal(resolve('[Gr:Patchim v="으로/로"] 만든다', [], {}), "로 만든다");
assert.equal(resolve('[Ctrl:Italic][[note]][/Ctrl:Italic]'), `${CARD_TEXT_SENTINELS.italicStart}[note]${CARD_TEXT_SENTINELS.italicEnd}`);

console.log("Official card text resolver test OK");
console.log("  plural-only, references, inline energy, style and no-break tokens retained");
