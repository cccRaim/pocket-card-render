const IMG_TAG_FONT_TYPE = Object.freeze({
  1: "Black",
  2: "White",
  3: "BlackWithWhiteOutline",
  4: "ExBlack",
});

export function resolveOfficialImgTagFontType(serializedType, fontGroupName = "") {
  const fontType = IMG_TAG_FONT_TYPE[serializedType];
  if (!fontType) {
    const group = fontGroupName ? ` ${fontGroupName}` : "";
    throw new Error(
      `official FontGroupSettings${group} has invalid ImgTagFontType ${serializedType}`,
    );
  }
  return fontType;
}
