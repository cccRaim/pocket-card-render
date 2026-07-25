// Float32 translation of HomographyShapeCorrector's ARM64 scalar operations.
// The input order is P0/P1/P2/P3 for unit-square (0,0)/(1,0)/(0,1)/(1,1).

const f32 = Math.fround;
const add = (a, b) => f32(f32(a) + f32(b));
const sub = (a, b) => f32(f32(a) - f32(b));
const mul = (a, b) => f32(f32(a) * f32(b));
const div = (a, b) => f32(f32(a) / f32(b));

function readPoint(point, label) {
  if (!point || typeof point !== "object") {
    throw new TypeError(`${label} must provide x/y or [x, y]`);
  }
  const x = point.x ?? point[0];
  const y = point.y ?? point[1];
  if (x === undefined || y === undefined) {
    throw new TypeError(`${label} must provide x/y or [x, y]`);
  }
  return [f32(x), f32(y)];
}

function resolvePoints(p0, p1, p2, p3) {
  if (p1 === undefined && p2 === undefined && p3 === undefined) {
    if (!p0 || p0.length !== 4) {
      throw new TypeError("viewportPoints must contain P0/P1/P2/P3");
    }
    return p0;
  }
  return [p0, p1, p2, p3];
}

export function calcHomographyMatrix(p0, p1, p2, p3) {
  [p0, p1, p2, p3] = resolvePoints(p0, p1, p2, p3);
  const [x0, y0] = readPoint(p0, "P0");
  const [x1, y1] = readPoint(p1, "P1");
  const [x2, y2] = readPoint(p2, "P2");
  const [x3, y3] = readPoint(p3, "P3");

  // 0x4398888..0x43988cc: preserve the native register/data dependency order.
  let s0 = sub(y0, y2);
  let s1 = sub(x0, x2);
  let s7 = sub(x2, x3);
  let s4 = sub(y1, y3);
  const s16 = sub(y2, y3);
  s0 = sub(s0, y1);
  let s2 = sub(s1, x1);
  s1 = sub(x1, x3);
  const s5 = add(s0, y3);
  const s6 = add(x3, s2);
  s2 = mul(s7, s4);
  let s3 = mul(s1, s16);
  s0 = mul(s6, s16);
  s7 = mul(s7, s5);
  s0 = sub(s0, s7);
  s7 = sub(s3, s2);
  s0 = div(s0, s7);

  const result = new Float32Array(9);
  s7 = sub(x1, x0);
  let temporary = mul(x1, s0);
  result[0] = add(s7, temporary);

  // 0x43988e4..0x4398908 computes the second projective coefficient.
  s4 = mul(s6, s4);
  s1 = mul(s1, s5);
  s2 = sub(s2, s3);
  s1 = sub(s4, s1);
  s1 = div(s1, s2);
  s2 = sub(x2, x0);
  s3 = mul(x2, s1);
  result[1] = add(s2, s3);
  result[2] = x0;

  s2 = sub(y1, y0);
  s3 = mul(y1, s0);
  result[3] = add(s2, s3);
  s2 = sub(y2, y0);
  temporary = mul(y2, s1);
  result[4] = add(s2, temporary);
  result[5] = y0;
  result[6] = s0;
  result[7] = s1;
  result[8] = f32(1);
  return result;
}

export function calcInverseMatrix(matrix) {
  if (!matrix || matrix.length < 9) {
    throw new TypeError("matrix must contain nine row-major floats");
  }

  // Register names follow 0x4398b38..0x4398c7c. The official method assumes
  // H[8] == 1 and therefore loads only H[0] through H[7].
  const s8 = f32(matrix[0]);
  const s9 = f32(matrix[1]);
  const s14 = f32(matrix[2]);
  const s12 = f32(matrix[3]);
  const s13 = f32(matrix[4]);
  const s15 = f32(matrix[5]);
  const s10 = f32(matrix[6]);
  const s11 = f32(matrix[7]);

  let s5 = mul(s9, s15);
  let s0 = mul(s8, s13);
  let s3 = mul(s14, s12);
  const s6 = mul(s14, s13);
  let s1 = mul(s5, s10);
  let s2 = mul(s3, s11);
  let s4 = mul(s6, s10);
  s1 = add(s0, s1);
  s1 = add(s1, s2);
  s2 = sub(s1, s4);
  s1 = mul(s9, s12);
  s4 = mul(s8, s15);
  s2 = sub(s2, s1);
  let s7 = mul(s4, s11);
  s2 = sub(s2, s7);
  s2 = div(f32(1), s2);

  const result = new Float32Array(9);
  s7 = mul(s15, s11);
  s7 = sub(s13, s7);
  result[0] = div(s7, s2);
  s7 = mul(s14, s11);
  s7 = sub(s7, s9);
  result[1] = div(s7, s2);
  s5 = sub(s5, s6);
  result[2] = div(s5, s2);
  s5 = mul(s15, s10);
  s5 = sub(s5, s12);
  result[3] = div(s5, s2);
  s5 = mul(s14, s10);
  s5 = sub(s8, s5);
  result[4] = div(s5, s2);
  s3 = sub(s3, s4);
  result[5] = div(s3, s2);
  s3 = mul(s12, s11);
  s4 = mul(s13, s10);
  s3 = sub(s3, s4);
  result[6] = div(s3, s2);
  s3 = mul(s9, s10);
  s4 = mul(s8, s11);
  s3 = sub(s3, s4);
  result[7] = div(s3, s2);
  s0 = sub(s0, s1);
  result[8] = div(s0, s2);
  return result;
}
