// Presentation spacing for the two short Chinese card-detail labels.
// TMP characterSpacing is expressed in hundredths of the current font size.
export function withCardLabelSpacing(element) {
  if (!/^(?:撤退|弱點|弱点)$/.test(element.text || "")) return element;
  if (!/(?:\/weak_txt|\/escape_txt_[^/]+)$/.test(element.layoutPath || "")) return element;
  if (Number(element.characterSpacing || 0) !== 0) return element;
  return { ...element, characterSpacing: 50 };
}
