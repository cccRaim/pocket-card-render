import {
  normalizeQuaternion,
  rotateVectorByQuaternion,
  threeQuaternionToUnity,
} from "./official-touch-rotation.js";

export const CARD_FUTURE_PRODUCER_SCHEMA =
  "pocket-card-render/card-future-object-arm64-port@1";

const LOCAL_FRONT = Object.freeze([0, 0, -1]);
const LIGHT_DIR = Object.freeze([1, 1, 0]);
const LIGHT_DIR_2 = Object.freeze([1, -1, 0]);
const FRAME_EPSILON = Math.fround(0.0001);

const f32 = Math.fround;

function requireFinite(value, field) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    throw new TypeError(`CardFutureObject.${field} must be finite`);
  }
  return numeric;
}

function requireInteger(value, field, minimum = 0) {
  const numeric = requireFinite(value, field);
  if (!Number.isInteger(numeric) || numeric < minimum) {
    throw new RangeError(`CardFutureObject.${field} must be an integer >= ${minimum}`);
  }
  return numeric;
}

function normalizeVector3(vector) {
  const length = f32(Math.hypot(vector[0], vector[1], vector[2]));
  if (!(length > 0)) return [0, 0, 0];
  return vector.map((value) => f32(f32(value) / length));
}

function dot3(left, right) {
  return f32(f32(f32(left[0] * right[0]) + f32(left[1] * right[1]))
    + f32(left[2] * right[2]));
}

function roundToEven(value) {
  if (!Number.isFinite(value)) return value;
  const floor = Math.floor(value);
  const fraction = value - floor;
  if (fraction < 0.5) return floor;
  if (fraction > 0.5) return floor + 1;
  return floor % 2 === 0 ? floor : floor + 1;
}

export function validateCardFutureConfig(config) {
  if (!config || typeof config !== "object") {
    throw new TypeError("CardFutureObject config is required");
  }
  const normalized = {
    componentIdentity: String(config.componentIdentity || ""),
    componentGoIdentity: String(config.componentGoIdentity || ""),
    componentGoPath: String(config.componentGoPath || ""),
    scriptIdentity: String(config.scriptIdentity || ""),
    rendererBindings: Array.isArray(config.rendererBindings)
      ? [...config.rendererBindings]
      : [],
    animationTexFrameCount: requireInteger(
      config.animationTexFrameCount,
      "animationTexFrameCount",
      1,
    ),
    animationFrameCount: requireInteger(config.animationFrameCount, "animationFrameCount", 1),
    animSwitchSpeed: requireFinite(config.animSwitchSpeed, "animSwitchSpeed"),
    animFrameOffset: requireInteger(config.animFrameOffset, "animFrameOffset"),
    skipAnimThreshold: requireInteger(config.skipAnimThreshold, "skipAnimThreshold"),
    accellRatio: requireFinite(config.accellRatio, "accellRatio"),
    isAnimationStopped: requireInteger(config.isAnimationStopped, "isAnimationStopped"),
  };
  if (![normalized.componentIdentity, normalized.componentGoIdentity, normalized.scriptIdentity]
    .every((identity) => identity.includes(":"))
      || !normalized.componentGoPath
      || normalized.rendererBindings.length === 0
      || normalized.rendererBindings.some((identity) => typeof identity !== "string" || !identity.includes(":"))
      || ![0, 1].includes(normalized.isAnimationStopped)) {
    throw new Error("CardFutureObject identity/binding contract is incomplete");
  }
  return Object.freeze(normalized);
}

export function cardFutureTiltDot(unityQuaternion) {
  const rotation = normalizeQuaternion(unityQuaternion);
  const worldFront = normalizeVector3(rotateVectorByQuaternion(LOCAL_FRONT, rotation));
  const first = dot3(worldFront, normalizeVector3(LIGHT_DIR));
  const second = dot3(worldFront, normalizeVector3(LIGHT_DIR_2));
  return f32(first + f32(second * f32(0.5)));
}

export function cardFutureGoalFrame(tiltDot, animationFrameCount) {
  const scaled = f32(f32(tiltDot) * f32(10));
  const bucket = Math.min(10, Math.max(0, roundToEven(f32(scaled + f32(5)))));
  return Math.trunc((bucket * (animationFrameCount - 1)) / 10);
}

export function advanceCardFutureFrame(current, goal, {
  skipAnimThreshold,
  accellRatio,
}, deltaTime) {
  const target = f32(goal);
  let value = f32(current);
  let distance = f32(Math.abs(f32(target - value)));
  if (distance < FRAME_EPSILON) return target;

  const sign = target - value >= 0 ? 1 : -1;
  const skip = f32(skipAnimThreshold);
  if (distance > skip) {
    value = f32(value + f32(f32(distance - skip) * sign));
    distance = f32(Math.abs(f32(target - value)));
  }

  const signedDistance = f32(distance * sign);
  const acceleration = f32(f32(accellRatio) * signedDistance);
  const next = f32(value + f32(acceleration * f32(deltaTime)));
  return sign > 0
    ? (next > target ? target : next)
    : (next < target ? target : next);
}

export function createCardFutureState(config, threeQuaternion = [0, 0, 0, 1]) {
  const normalizedConfig = validateCardFutureConfig(config);
  const unityQuaternion = threeQuaternionToUnity(threeQuaternion);
  const tiltDot = cardFutureTiltDot(unityQuaternion);
  const goalAnimFrame = cardFutureGoalFrame(
    tiltDot,
    normalizedConfig.animationFrameCount,
  );
  return {
    schema: CARD_FUTURE_PRODUCER_SCHEMA,
    config: normalizedConfig,
    tiltDot,
    goalAnimFrame,
    lastGoalAnimFrame: goalAnimFrame,
    animFrame: f32(goalAnimFrame),
    frameCount: 0,
  };
}

export function updateCardFuture(state, {
  threeQuaternion,
  deltaTime,
}) {
  if (state?.schema !== CARD_FUTURE_PRODUCER_SCHEMA) {
    throw new TypeError("invalid CardFutureObject state");
  }
  const dt = requireFinite(deltaTime, "deltaTime");
  if (dt < 0) throw new RangeError("CardFutureObject.deltaTime must be >= 0");

  const unityQuaternion = threeQuaternionToUnity(threeQuaternion);
  const tiltDot = cardFutureTiltDot(unityQuaternion);
  const goalAnimFrame = cardFutureGoalFrame(
    tiltDot,
    state.config.animationFrameCount,
  );
  const lastGoalAnimFrame = state.goalAnimFrame;
  const animFrame = advanceCardFutureFrame(
    state.animFrame,
    goalAnimFrame,
    state.config,
    dt,
  );
  state.tiltDot = tiltDot;
  state.lastGoalAnimFrame = lastGoalAnimFrame;
  state.goalAnimFrame = goalAnimFrame;
  state.animFrame = animFrame;
  state.frameCount += 1;
  return {
    animFrame: f32(animFrame + state.config.animFrameOffset),
    componentAnimFrame: animFrame,
    goalAnimFrame,
    lastGoalAnimFrame,
    tiltDot,
  };
}
