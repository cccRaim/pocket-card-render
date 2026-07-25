// KiraPuyoObject's renderer-independent CPU update. Serialized component and
// AnimationCurve data come from the official prefab bundles.

const f32 = Math.fround;
const add = (a, b) => f32(f32(a) + f32(b));
const sub = (a, b) => f32(f32(a) - f32(b));
const mul = (a, b) => f32(f32(a) * f32(b));
const div = (a, b) => f32(f32(a) / f32(b));
const HALF = f32(0.5);
const ONE = f32(1);
const DEFAULT_WEIGHT = f32(1 / 3);

function clamp01(value) {
  const v = f32(value);
  return v < 0 ? f32(0) : v > 1 ? ONE : v;
}

const ROOT_EPSILON = f32(0.0010000000474974513);
const TWO_PI_OVER_THREE = f32(2.094395160675049);

function inUnitInterval(value) {
  return value >= 0 && value <= 1;
}

function fallbackRoot(target) {
  return target < HALF ? f32(0) : ONE;
}

function signedCubicRoot(value) {
  const input = f32(value);
  if (input < 0) return f32(-Math.exp(f32(Math.log(f32(-input))) / 3));
  return f32(Math.exp(f32(Math.log(input)) / 3));
}

// ARM64 libunity.so 0xA3DB58..0xA3DE3C. The operation order and every
// single-precision boundary intentionally mirror the native instructions.
function solveBezierTime(normalizedTime, outWeight, inWeight) {
  const target = clamp01(normalizedTime);
  const x1 = clamp01(outWeight);
  const x2 = sub(ONE, clamp01(inWeight));
  const c = mul(x1, f32(3));
  const x2TimesThree = mul(x2, f32(3));
  const a = add(sub(c, x2TimesThree), ONE);
  const b = add(mul(x1, f32(-6)), x2TimesThree);

  if (Math.abs(a) > ROOT_EPSILON) {
    const threeA = mul(a, f32(3));
    const offset = div(f32(-b), threeA);
    const offsetSquared = mul(offset, offset);
    const offsetCubed = mul(offset, offsetSquared);
    const p = sub(div(c, threeA), offsetSquared);
    const q = add(offsetCubed, div(add(mul(c, b), mul(threeA, target)), mul(a, mul(a, f32(6)))));
    const discriminant = add(mul(q, q), mul(mul(p, p), p));

    if (discriminant < 0) {
      const radiusBase = f32(Math.sqrt(sub(mul(q, q), discriminant)));
      const angle = f32(Math.atan2(f32(Math.sqrt(f32(-discriminant))), q));
      const radiusLog = f32(Math.log(radiusBase));
      const radius = f32(Math.exp(radiusLog / 3));
      const doubleRadius = add(radius, radius);
      const thirdAngle = div(angle, f32(3));
      const roots = [
        add(offset, mul(doubleRadius, f32(Math.cos(thirdAngle)))),
        add(offset, mul(doubleRadius, f32(Math.cos(add(thirdAngle, TWO_PI_OVER_THREE))))),
        add(offset, mul(doubleRadius, f32(Math.cos(add(thirdAngle, f32(-TWO_PI_OVER_THREE)))))),
      ];
      return roots.find(inUnitInterval) ?? fallbackRoot(target);
    }

    const rootDiscriminant = f32(Math.sqrt(discriminant));
    const root = add(offset, add(signedCubicRoot(add(q, rootDiscriminant)), signedCubicRoot(sub(q, rootDiscriminant))));
    return inUnitInterval(root) ? root : fallbackRoot(target);
  }

  if (Math.abs(b) > ROOT_EPSILON) {
    const rootDiscriminant = f32(Math.sqrt(add(mul(c, c), mul(mul(b, f32(4)), target))));
    const denominator = add(b, b);
    const first = div(sub(f32(-c), rootDiscriminant), denominator);
    if (inUnitInterval(first)) return first;
    const second = div(sub(rootDiscriminant, c), denominator);
    return inUnitInterval(second) ? second : fallbackRoot(target);
  }

  return Math.abs(c) > ROOT_EPSILON ? div(target, c) : f32(0);
}

function evaluateBezierNative(leftValue, control1, control2, rightValue, parameter) {
  const tSquared = mul(parameter, parameter);
  const inverse = sub(ONE, parameter);
  const tCubed = mul(parameter, tSquared);
  const inverseSquared = mul(inverse, inverse);
  const inverseCubed = mul(inverse, inverseSquared);
  const leftWeight = mul(mul(parameter, f32(3)), inverseSquared);
  const rightWeight = mul(inverse, mul(tSquared, f32(3)));
  let value = add(mul(leftValue, inverseCubed), mul(control1, leftWeight));
  value = add(mul(control2, rightWeight), value);
  return add(mul(rightValue, tCubed), value);
}

function validateCurve(curve) {
  const keys = curve?.keys;
  if (!Array.isArray(keys) || keys.length < 2) throw new TypeError("KiraPuyo AnimationCurve needs at least two keys");
  for (const key of keys) {
    for (const field of ["time", "value", "inSlope", "outSlope", "weightedMode", "inWeight", "outWeight"]) {
      if (!Number.isFinite(key[field])) throw new TypeError(`AnimationCurve key ${field} is invalid`);
    }
  }
  return keys;
}

export function evaluateKiraPuyoCurve(curve, time) {
  const keys = validateCurve(curve);
  const value = f32(time);
  if (value <= f32(keys[0].time)) return f32(keys[0].value);
  if (value >= f32(keys.at(-1).time)) return f32(keys.at(-1).value);
  let rightIndex = 1;
  while (rightIndex < keys.length && value >= f32(keys[rightIndex].time)) rightIndex += 1;
  const left = keys[rightIndex - 1];
  const right = keys[rightIndex];
  const duration = sub(right.time, left.time);
  if (!(duration > 0)) return f32(left.value);
  const normalized = div(sub(value, left.time), duration);
  const outWeighted = (Math.trunc(left.weightedMode) & 2) !== 0;
  const inWeighted = (Math.trunc(right.weightedMode) & 1) !== 0;
  const outWeight = outWeighted ? f32(left.outWeight) : DEFAULT_WEIGHT;
  const inWeight = inWeighted ? f32(right.inWeight) : DEFAULT_WEIGHT;
  const parameter = (outWeighted || inWeighted)
    ? solveBezierTime(normalized, outWeight, inWeight)
    : normalized;
  const y0 = f32(left.value);
  const y1 = add(y0, mul(mul(outWeight, duration), left.outSlope));
  const y3 = f32(right.value);
  const y2 = sub(y3, mul(mul(inWeight, duration), right.inSlope));
  return evaluateBezierNative(y0, y1, y2, y3, parameter);
}

export function createKiraPuyoState(component, settings) {
  if (!component || !settings?.curve) throw new TypeError("KiraPuyo component/settings are required");
  validateCurve(settings.curve);
  return {
    component,
    settings,
    anim: f32(0.5),
    kiraScale: evaluateKiraPuyoCurve(settings.curve, f32(component.scaleAnimationOffset + component.vertScaleSpeed * 0.5)),
  };
}

export function updateKiraPuyo(state, unityLocalFront) {
  if (!state?.component || !state?.settings?.curve
      || !Array.isArray(unityLocalFront) || unityLocalFront.length < 3
      || !unityLocalFront.slice(0, 3).every(Number.isFinite)) {
    throw new TypeError("KiraPuyo state and transformed LocalFront are required");
  }
  const x01 = add(mul(unityLocalFront[0], HALF), HALF);
  const y01 = add(mul(unityLocalFront[1], HALF), HALF);
  const anim = add(mul(x01, HALF), mul(y01, HALF));
  const rawTime = add(state.component.scaleAnimationOffset, mul(state.component.vertScaleSpeed, anim));
  const fractional = sub(rawTime, f32(Math.floor(rawTime)));
  const curveTime = rawTime < 0 ? f32(0) : Math.min(fractional, ONE);
  state.anim = anim;
  state.kiraScale = evaluateKiraPuyoCurve(state.settings.curve, curveTime);
  return {
    rampRepeat: f32(state.component.rampRepeat),
    scrollScale: f32(state.component.scrollScale),
    scrollOffset: f32(state.component.scrollOffset),
    anim: state.anim,
    kiraScale: state.kiraScale,
  };
}
