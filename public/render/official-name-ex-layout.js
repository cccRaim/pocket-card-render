function finite(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`invalid official name EX ${label}`);
  return number;
}

export function computeOfficialNameExParentDelta(layout, measuredNameWidth, canvasWidth) {
  if (layout?.contractId !== "PokemonCardNameView.UpdateExLayout") {
    throw new Error("unsupported official name EX layout contract");
  }
  const width = finite(canvasWidth, "canvas width");
  if (!(width > 0)) throw new Error("invalid official name EX canvas width");
  const nameWidth = Math.max(0, finite(measuredNameWidth, "measured name width"));
  const anchorX = finite(layout.anchorX, "anchor x") * width;
  const authoredParentX = finite(layout.authoredParentX, "authored parent x") * width;
  const maxWidth = finite(layout.maxW, "maximum name width") * width;
  if (!(maxWidth > 0)) throw new Error("invalid official name EX maximum width");
  return anchorX + Math.min(nameWidth, maxWidth) - authoredParentX;
}

export function shiftOfficialNameExBox(box, deltaX, canvasWidth) {
  const width = finite(canvasWidth, "canvas width");
  if (!(width > 0)) throw new Error("invalid official name EX canvas width");
  const shift = finite(deltaX, "parent delta") / width;
  for (const key of ["l", "r", "t", "b"]) finite(box?.[key], `box ${key}`);
  return {
    l: Number(box.l) + shift,
    r: Number(box.r) + shift,
    t: Number(box.t),
    b: Number(box.b),
  };
}
