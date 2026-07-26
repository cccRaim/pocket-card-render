const EPSILON = 1e-7;

function finite(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new TypeError(`${label} must be finite`);
  return number;
}

function vector(value, length, label) {
  if (!Array.isArray(value) || value.length !== length) {
    throw new TypeError(`${label} must contain ${length} numbers`);
  }
  return value.map((entry, index) => finite(entry, `${label}[${index}]`));
}

export const IDENTITY_UI_AFFINE = Object.freeze([1, 0, 0, 1, 0, 0]);

export function multiplyUiAffine(leftValue, rightValue) {
  const left = vector(leftValue, 6, "left affine transform");
  const right = vector(rightValue, 6, "right affine transform");
  const [la, lb, lc, ld, le, lf] = left;
  const [ra, rb, rc, rd, re, rf] = right;
  return [
    la * ra + lc * rb,
    lb * ra + ld * rb,
    la * rc + lc * rd,
    lb * rc + ld * rd,
    la * re + lc * rf + le,
    lb * re + ld * rf + lf,
  ];
}

export function transformUiPoint(matrixValue, pointValue) {
  const [a, b, c, d, e, f] = vector(matrixValue, 6, "affine transform");
  const [x, y] = vector(pointValue, 2, "point");
  return [a * x + c * y + e, b * x + d * y + f];
}

export function rectTransformUiAffine({
  pivot,
  rotation,
  scale,
}, parentValue = IDENTITY_UI_AFFINE) {
  const [px, py] = vector(pivot, 2, "RectTransform pivot");
  const [qx, qy, qz, qw] = vector(rotation, 4, "RectTransform rotation");
  const [sx, sy] = vector(scale, 2, "RectTransform scale");
  const length = Math.hypot(qx, qy, qz, qw);
  if (!(length > EPSILON)) throw new RangeError("RectTransform rotation quaternion is zero");
  const nx = qx / length;
  const ny = qy / length;
  const nz = qz / length;
  const nw = qw / length;
  if (Math.abs(nx) > EPSILON || Math.abs(ny) > EPSILON) {
    throw new RangeError("non-planar RectTransform rotation requires a projected UGUI camera contract");
  }
  const angle = 2 * Math.atan2(nz, nw);
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  const local = [
    cosine * sx,
    sine * sx,
    -sine * sy,
    cosine * sy,
    px - cosine * sx * px + sine * sy * py,
    py - sine * sx * px - cosine * sy * py,
  ];
  return multiplyUiAffine(parentValue, local);
}

export function isIdentityUiAffine(value, epsilon = EPSILON) {
  const matrix = vector(value, 6, "affine transform");
  return matrix.every((entry, index) => Math.abs(entry - IDENTITY_UI_AFFINE[index]) <= epsilon);
}

export function applyUiAffineToCanvas(context, value) {
  if (!context || typeof context.transform !== "function") {
    throw new TypeError("Canvas 2D context is required");
  }
  const matrix = vector(value, 6, "affine transform");
  context.transform(...matrix);
}

export function uiAffineToMatrix4(value, Matrix4) {
  if (typeof Matrix4 !== "function") throw new TypeError("Matrix4 constructor is required");
  const [a, b, c, d, e, f] = vector(value, 6, "affine transform");
  return new Matrix4().set(
    a, c, 0, e,
    b, d, 0, f,
    0, 0, 1, 0,
    0, 0, 0, 1,
  );
}
