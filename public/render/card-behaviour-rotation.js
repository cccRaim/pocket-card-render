export const CARD_BEHAVIOUR_ROTATION_PRODUCER_SCHEMA =
  "pocket-card-render/card-behaviour-hologram-rotation-arm64-port@1";

export const OFFICIAL_CARD_RENDERER_HOLOGRAM_ROTATION =
  Object.freeze([0, 0, 0]);

function finiteComponent(value, index) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    throw new TypeError(
      `CardDataGroup.HologramRotation[${index}] must be finite`,
    );
  }
  return Math.fround(numeric);
}
export function resolveCardBehaviourHologramRotation(
  value = OFFICIAL_CARD_RENDERER_HOLOGRAM_ROTATION,
) {
  if ((!Array.isArray(value) && !ArrayBuffer.isView(value))
      || value.length !== 3) {
    throw new TypeError(
      "CardDataGroup.HologramRotation must contain exactly three components",
    );
  }
  return Object.freeze(Array.from(value, finiteComponent));
}
