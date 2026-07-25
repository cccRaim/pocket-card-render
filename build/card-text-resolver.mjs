const INLINE_ELEMENT_BASE = 0xE100;

export const CARD_TEXT_SENTINELS = Object.freeze({
  boldStart: "\x01",
  boldEnd: "\x02",
  ex: "\x03",
  italicStart: "\x04",
  italicEnd: "\x05",
  noBreakStart: "\x06",
  noBreakEnd: "\x07",
});

const ELEMENT_INDEX = Object.freeze({
  Grass: 1,
  Fire: 2,
  Water: 3,
  Lightning: 4,
  Psychic: 5,
  Fighting: 6,
  Darkness: 7,
  Metal: 8,
  Dragon: 9,
  Colorless: 10,
});

const ELEMENT_ALIAS = Object.freeze({
  G: "Grass",
  R: "Fire",
  W: "Water",
  L: "Lightning",
  P: "Psychic",
  F: "Fighting",
  D: "Darkness",
  M: "Metal",
  N: "Dragon",
  C: "Colorless",
});

const ELEMENT_BY_INDEX = new Map(Object.entries(ELEMENT_INDEX).map(([name, index]) => [index, name]));

// LtUIGrTagCommand.ReplaceSpecialCharForPatchim maps the official energy-font
// PUA characters to these Korean word endings before testing the jongseong.
const PATCHIM_ELEMENT_PROXY = Object.freeze({
  Grass: "풀",
  Fire: "꽃",
  Water: "물",
  Lightning: "개",
  Psychic: "초",
  Fighting: "투",
  Darkness: "악",
  Metal: "철",
  Dragon: "곤",
  Colorless: "색",
});

const PATCHIM_PRESET = Object.freeze({
  i_ga: "이/가",
  gwa_wa: "과/와",
  eul_reul: "을/를",
  eu_: "으/",
  eun_neun: "은/는",
  i_: "이/",
});

export function attributesOf(source) {
  return Object.fromEntries([...String(source || "").matchAll(/([A-Za-z_][\w-]*)="([^"]*)"/g)]
    .map((match) => [match[1], match[2]]));
}

export function inlineElementSentinel(value) {
  const name = ELEMENT_ALIAS[value] || value;
  const index = ELEMENT_INDEX[name];
  return index ? String.fromCodePoint(INLINE_ELEMENT_BASE + index) : "";
}

export function inlineElementTypeFromSentinel(character) {
  const index = String(character || "").codePointAt(0) - INLINE_ELEMENT_BASE;
  return ELEMENT_BY_INDEX.get(index) || null;
}

export function isCardTextControl(character) {
  const codePoint = String(character || "").codePointAt(0);
  return (codePoint >= 1 && codePoint <= 7) || ELEMENT_BY_INDEX.has(codePoint - INLINE_ELEMENT_BASE);
}

function patchimSubject(text) {
  const characters = [...String(text || "")];
  for (let index = characters.length - 1; index >= 0; index -= 1) {
    const character = characters[index];
    if (isCardTextControl(character)) {
      const element = inlineElementTypeFromSentinel(character);
      if (element) return PATCHIM_ELEMENT_PROXY[element] || "";
      continue;
    }
    if (/\s/u.test(character)) continue;
    return character;
  }
  return "";
}

export function hasKoreanPatchim(text, variant = "") {
  const subject = patchimSubject(text);
  if (!subject) return false;
  const codePoint = subject.codePointAt(0);
  const rieulException = ["eu_", "으/", "으로/로"].includes(variant);

  if (codePoint >= 0xAC00 && codePoint <= 0xD7A3) {
    const jongseong = (codePoint - 0xAC00) % 28;
    return jongseong !== 0 && !(rieulException && jongseong === 8);
  }

  if (/^[0-9]$/u.test(subject)) {
    const patchimDigits = rieulException ? "036" : "013678";
    return patchimDigits.includes(subject);
  }
  return false;
}

export function resolveKoreanPatchim(text, variant) {
  const resolvedVariant = PATCHIM_PRESET[variant] || variant || "";
  const [withPatchim = "", withoutPatchim = ""] = resolvedVariant.split("/", 2);
  return hasKoreanPatchim(text, variant) ? withPatchim : withoutPatchim;
}

function isPlural(value, locale) {
  const number = Number(value);
  if (!Number.isFinite(number)) return false;
  // The card corpus only supplies integer counts. French uses the game's zero/one
  // singular branch; the other supported card languages use one as singular.
  return locale === "fr_FR" ? Math.abs(number) > 1 : Math.abs(number) !== 1;
}

/**
 * Resolve the official card message-token subset while retaining TMP style and
 * inline-image semantics as compact sentinels for the browser layout stage.
 */
export function createCardTextResolver(master, references = {}, locale = "zh_TW") {
  function resolve(text, params = [], callReferences = {}) {
    if (!text) return "";
    const refs = { ...references, ...callReferences };
    let lastNumberIndex = null;
    let value = String(text).replace(/\[Ctrl:OL\s*\]([\s\S]*?)\[\/Ctrl:OL\s*\]/g, (_match, body) => {
      let item = 0;
      return body
        .replace(/\[Ctrl:LI\s*\]/g, () => String.fromCodePoint(0x2460 + item++))
        .replace(/\[\/Ctrl:LI\s*\]/g, "");
    });

    value = value.replace(/\[(\/)?([A-Za-z]+(?::[A-Za-z]+)?)([^\]]*)\]/g,
      (match, closing, tag, rawAttributes) => {
        if (tag === "Ctrl:Bold") return closing ? CARD_TEXT_SENTINELS.boldEnd : CARD_TEXT_SENTINELS.boldStart;
        if (tag === "Ctrl:Italic") return closing ? CARD_TEXT_SENTINELS.italicEnd : CARD_TEXT_SENTINELS.italicStart;
        if (tag === "Ctrl:NoBreak") return closing ? CARD_TEXT_SENTINELS.noBreakEnd : CARD_TEXT_SENTINELS.noBreakStart;
        if (closing) return ["Ctrl:LI", "Ctrl:OL"].includes(tag) ? "" : match;

        const attributes = attributesOf(rawAttributes);
        const parameterIndex = attributes.id == null ? null : Number(attributes.id);
        const parameter = Number.isInteger(parameterIndex) && parameterIndex >= 0 && parameterIndex < params.length
          ? params[parameterIndex]
          : undefined;

        if (tag === "Num:Int") {
          if (parameterIndex != null) lastNumberIndex = parameterIndex;
          if (attributes.visible === "0") return "";
          if (parameter === undefined) return "";
          if (Object.hasOwn(attributes, "plural_only")) {
            return isPlural(parameter, locale) ? `${parameter}${attributes.plural_only}` : "";
          }
          return String(parameter);
        }
        if (tag === "Gr:Count") {
          const referenceIndex = Number(attributes.ref ?? attributes.id ?? lastNumberIndex);
          const referenceValue = Number.isInteger(referenceIndex) ? params[referenceIndex] : undefined;
          return isPlural(referenceValue, locale) ? (attributes.p ?? "") : (attributes.s ?? "");
        }
        if (tag === "Text:CardName") {
          const id = parameter ?? attributes.v;
          return id != null && refs.cardName ? resolve(refs.cardName(id), params, refs) : "";
        }
        if (tag === "Text:AttackName") {
          return parameter != null && refs.attackName ? resolve(refs.attackName(parameter), params, refs) : "";
        }
        if (tag === "Text:AbilityName") {
          return parameter != null && refs.abilityName
            ? resolve(refs.abilityName(parameter, attributes.suffix), params, refs)
            : "";
        }
        if (tag === "Text:SpecialCondition") return resolve(master[parameter] || "", params, refs);
        if (tag === "Text:EvolutionPokemon") {
          return resolve(master[`EVOLUTION_STAGE_POKEMON_${parameter}`] || "", params, refs);
        }
        if (tag === "Text:AdditionalName") return resolve(master[attributes.v] || "", params, refs);
        if (tag === "Text:Char") {
          return { "FOUR-PER-EM-SPACE": "\u2005", "MIDDLE-DOT": "\u00B7" }[attributes.v] || "";
        }
        if (tag === "Img:Element") return inlineElementSentinel(parameter ?? attributes.name);
        if (tag === "Img:ex") return CARD_TEXT_SENTINELS.ex;
        if (tag === "C:Nbsp") return "\u00A0";
        if (tag === "C:Nnbsp") return "\u202F";
        if (tag === "C:Nbh") {
          return `${CARD_TEXT_SENTINELS.noBreakStart}-${CARD_TEXT_SENTINELS.noBreakEnd}`;
        }
        if (tag === "C:Lsb") return "[";
        if (tag === "C:Rsb") return "]";
        if (tag === "Gr:Pron") return "";
        if (tag === "Ctrl:LI" || tag === "Ctrl:OL") return "";
        return match;
      });

    value = value.replace(/\[Gr:Patchim([^\]]*)\]/g,
      (match, rawAttributes, offset, source) => {
        const variant = attributesOf(rawAttributes).v;
        return variant ? resolveKoreanPatchim(source.slice(0, offset), variant) : match;
      });

    return value
      .replace(/<\/?[a-zA-Z][^>]*>/g, "")
      .replace(/\[\[/g, "[")
      .replace(/\]\]/g, "]")
      .trim();
  }

  return resolve;
}
