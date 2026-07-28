export const THREE_PERSPECTIVE_ZBUFFER_PRODUCER_SCHEMA =
  "pocket-card-render/three-perspective-zbuffer-adaptation@1";

function finitePositive(value, field) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    throw new TypeError(`${field} must be finite and positive`);
  }
  return numeric;
}
export function threePerspectiveZBufferParams(nearValue, farValue) {
  const near = finitePositive(nearValue, "camera.near");
  const far = finitePositive(farValue, "camera.far");
  if (!(far > near)) {
    throw new RangeError("camera.far must be greater than camera.near");
  }
  return Object.freeze([
    0,
    0,
    Math.fround(-(far - near) / (2 * far * near)),
    Math.fround((far + near) / (2 * far * near)),
  ]);
}

export function offsetThreePerspectiveNdcZ(
  ndcZValue,
  eyeDepthOffsetValue,
  params,
) {
  const ndcZ = Number(ndcZValue);
  const offset = Number(eyeDepthOffsetValue);
  if (!Number.isFinite(ndcZ) || !Number.isFinite(offset)
      || (!Array.isArray(params) && !ArrayBuffer.isView(params))
      || params.length !== 4
      || !Number.isFinite(Number(params[2]))
      || !Number.isFinite(Number(params[3]))
      || Number(params[2]) === 0) {
    throw new TypeError("invalid perspective depth-offset input");
  }
  const z = Number(params[2]);
  const w = Number(params[3]);
  const eyeDepth = 1 / (z * ndcZ + w);
  return (1 / (eyeDepth + offset) - w) / z;
}
