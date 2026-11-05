// Compatibility for already-exported labels that used detail-panel strings.
// Values are the card-localization weakness/retreat strings. New compositions
// retain their <space> commands directly; never replace authored TMP spacing.
const CARD_LABELS = {
  weak_txt: { "弱點": "弱<space=1em>點", "弱点": "弱<space=1em>点", "약점": "약<space=1em>점" },
  escape_txt: { "撤退": "撤<space=1em>退", "にげる": "に<space=0.1em>げ<space=0.1em>る", "후퇴": "후<space=1em>퇴" },
};
export function withCardLabelSpacing(element) {
  const path = element.layoutPath || "";
  const labels = /\/weak_txt$/.test(path) ? CARD_LABELS.weak_txt
    : /\/escape_txt_[^/]+$/.test(path) ? CARD_LABELS.escape_txt : null;
  const text = labels?.[element.text];
  return text ? { ...element, text } : element;
}
