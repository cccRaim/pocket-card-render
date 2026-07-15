// Official Lettuce.Infrastructure.Card.Core.GlitterFlowMaps state update.
// This module intentionally has no renderer or Three.js dependency.

const f32 = Math.fround;
const add = (a, b) => f32(f32(a) + f32(b));
const sub = (a, b) => f32(f32(a) - f32(b));
const mul = (a, b) => f32(f32(a) * f32(b));
const div = (a, b) => f32(f32(a) / f32(b));
const sqrt = (value) => f32(Math.sqrt(f32(value)));
const neg = (value) => f32(-f32(value));

const ONE = f32(1);
const HALF = f32(0.5);
const TWENTY = f32(20);
const NORMALIZE_EPSILON = f32(0.00001);
const FLOW_DIRECTION_X = f32(0.5821118950843811);
const FLOW_DIRECTION_Y = f32(0.8131087422370911);
const TWO_PI = f32(6.2831854820251465);

export const OFFICIAL_GLITTER_FLOW_DEFAULTS = Object.freeze({
  accelIntensity: f32(0.10000000149011612),
  maxFlowSpeed: f32(1),
  minFlowSpeed: f32(0.05000000074505806),
  initFlowSpeed: f32(0),
  resistance: f32(0.006500000134110451),
  minTiltPower: f32(0.699999988079071),
  lightSpeed: f32(0.25),
  flowAMinRotateSpeed: f32(0.019999999552965164),
  flowAMaxRotateSpeed: f32(0.699999988079071),
  flowBMinRotateSpeed: f32(-0.019999999552965164),
  flowBMaxRotateSpeed: f32(-0.699999988079071),
});

function vectorLength2(x, y) {
  return sqrt(add(mul(x, x), mul(y, y)));
}

function normalized2(x, y) {
  const length = vectorLength2(x, y);
  return length > NORMALIZE_EPSILON
    ? [div(x, length), div(y, length)]
    : [f32(0), f32(0)];
}

function normalizedForwardXY(forward) {
  const x = f32(forward[0]);
  const y = f32(forward[1]);
  const z = f32(forward[2]);
  const length = sqrt(add(add(mul(x, x), mul(y, y)), mul(z, z)));
  return length > NORMALIZE_EPSILON
    ? [div(x, length), div(y, length)]
    : [f32(0), f32(0)];
}

function frac(value) {
  const v = f32(value);
  return f32(v - Math.floor(v));
}

function fmod(value, length) {
  return f32(f32(value) % f32(length));
}

function lerp(a, b, t) {
  return add(a, mul(sub(b, a), t));
}

function clamp01(value) {
  const v = f32(value);
  return v < 0 ? f32(0) : v > 1 ? f32(1) : v;
}

function copyParams(params) {
  return Object.fromEntries(Object.entries(params).map(([key, value]) => [key, f32(value)]));
}

function syncFlowParams(state) {
  state.flowParams[0][0] = state.flowMapUVOffset[0];
  state.flowParams[0][1] = neg(state.flowMapUVOffset[1]);
  state.flowParams[0][2] = state.lightTiming;
  state.flowParams[0][3] = f32(0);
  state.flowParams[1][0] = state.flowARotate;
  state.flowParams[1][1] = state.flowBRotate;
  state.flowParams[1][2] = f32(0);
  state.flowParams[1][3] = f32(0);
}

export function createGlitterFlowState({ params = {}, random = Math.random } = {}) {
  if (typeof random !== "function") throw new TypeError("random must be a function");
  const config = copyParams({ ...OFFICIAL_GLITTER_FLOW_DEFAULTS, ...params });
  const randomAngle = () => mul(f32(random()), TWO_PI);
  const state = {
    config,
    flowSpeed: [config.initFlowSpeed, config.initFlowSpeed],
    flowMapUVOffset: [f32(0), f32(0)],
    lightTiming: f32(0),
    flowARotate: randomAngle(),
    flowBRotate: randomAngle(),
    flowParams: [
      [f32(0), f32(0), f32(0), f32(0)],
      [f32(0), f32(0), f32(0), f32(0)],
    ],
  };
  syncFlowParams(state);
  return state;
}

function updateFlowSpeed(state, forward) {
  const c = state.config;
  const direction = normalizedForwardXY(forward);
  let x = sub(state.flowSpeed[0], mul(direction[0], c.accelIntensity));
  let y = sub(state.flowSpeed[1], mul(direction[1], c.accelIntensity));

  let speed = vectorLength2(x, y);
  if (speed > c.maxFlowSpeed) {
    const scale = div(c.maxFlowSpeed, speed);
    x = mul(x, scale);
    y = mul(y, scale);
  }

  const resistance = sub(ONE, c.resistance);
  x = mul(x, resistance);
  y = mul(y, resistance);

  speed = vectorLength2(x, y);
  // Native 0x442F6A0..0x442F700 divides minFlowSpeed by speed without a zero
  // branch. Preserve its non-zero behavior, but keep the valid default state
  // finite when transform.forward.xy is exactly zero.
  if (speed > 0 && speed < c.minFlowSpeed) {
    const scale = div(c.minFlowSpeed, speed);
    x = mul(x, scale);
    y = mul(y, scale);
  }
  state.flowSpeed[0] = x;
  state.flowSpeed[1] = y;
}

function updateFlowMapUVOffset(state, deltaTime) {
  const c = state.config;
  const direction = normalized2(state.flowSpeed[0], state.flowSpeed[1]);
  const speed = vectorLength2(state.flowSpeed[0], state.flowSpeed[1]);
  const u = mul(add(add(mul(direction[0], FLOW_DIRECTION_X), mul(direction[1], FLOW_DIRECTION_Y)), ONE), HALF);
  const uSquared = mul(u, u);
  const oneMinusU = sub(ONE, u);
  const uMinusUSquared = sub(u, uSquared);
  const aCurveBase = add(u, uMinusUSquared);
  const oneMinusUSquared = mul(oneMinusU, oneMinusU);
  const oneMinusUMinusSquared = sub(oneMinusU, oneMinusUSquared);
  const bCurveBase = add(oneMinusU, oneMinusUMinusSquared);
  const tiltRange = sub(ONE, c.minTiltPower);
  const powerA = add(c.minTiltPower, mul(tiltRange, mul(aCurveBase, aCurveBase)));
  const powerB = add(c.minTiltPower, mul(tiltRange, mul(bCurveBase, bCurveBase)));
  const distance = mul(deltaTime, speed);

  state.flowMapUVOffset[0] = frac(add(state.flowMapUVOffset[0], mul(distance, powerA)));
  state.flowMapUVOffset[1] = frac(add(state.flowMapUVOffset[1], mul(distance, powerB)));

}

function updateLightTiming(state, deltaTime) {
  state.lightTiming = frac(add(state.lightTiming, mul(deltaTime, state.config.lightSpeed)));
}

function updateFlowRotate(state, deltaTime) {
  const c = state.config;
  const speed = vectorLength2(state.flowSpeed[0], state.flowSpeed[1]);
  const q = clamp01(div(sub(speed, c.minFlowSpeed), sub(c.maxFlowSpeed, c.minFlowSpeed)));
  const speedA = lerp(c.flowAMinRotateSpeed, c.flowAMaxRotateSpeed, q);
  const speedB = lerp(c.flowBMinRotateSpeed, c.flowBMaxRotateSpeed, q);
  state.flowARotate = fmod(add(state.flowARotate, div(mul(deltaTime, speedA), TWENTY)), TWO_PI);
  state.flowBRotate = fmod(add(state.flowBRotate, div(mul(deltaTime, speedB), TWENTY)), TWO_PI);
}

export function updateGlitterFlow(state, { forward, deltaTime }) {
  if (!state || !state.config || !state.flowParams) throw new TypeError("invalid glitter flow state");
  if (!Array.isArray(forward) || forward.length < 3) throw new TypeError("forward must be [x, y, z]");
  const dt = f32(deltaTime);
  if (!Number.isFinite(dt) || dt < 0) throw new RangeError("deltaTime must be a finite non-negative number");

  updateFlowSpeed(state, forward);
  updateFlowMapUVOffset(state, dt);
  updateLightTiming(state, dt);
  updateFlowRotate(state, dt);
  syncFlowParams(state);
  return state.flowParams;
}
