import { evaluateKiraPuyoCurve } from "./kira-puyo.js";
import {
  normalizeQuaternion,
  rotateVectorByQuaternion,
  threeQuaternionToUnity,
} from "./official-touch-rotation.js";

export const CARD_ANCIENT_PRODUCER_SCHEMA =
  "pocket-card-render/card-ancient-object-arm64-state-port@1";

const LOCAL_FRONT = Object.freeze([0, 0, -1]);
const LIGHT_DIR = Object.freeze([1, 1, 0]);
const LIGHT_DIR_2 = Object.freeze([1, -1, 0]);
const STRATA_COUNT = 6;
const f32 = Math.fround;

const AnimState = Object.freeze({
  Idle: 0,
  Start: 1,
  Middle: 2,
  End: 3,
});

function requireFinite(value, field) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    throw new TypeError(`CardAncientObject.${field} must be finite`);
  }
  return numeric;
}

function requireIdentity(value, field) {
  const identity = String(value || "");
  if (!identity.includes(":")) {
    throw new TypeError(`CardAncientObject.${field} must be an official identity`);
  }
  return identity;
}

function requireVector2(value, field) {
  return Object.freeze([
    requireFinite(value?.x, `${field}.x`),
    requireFinite(value?.y, `${field}.y`),
  ]);
}

function validateCurve(curve, field, allowEmpty = false) {
  if (!curve || !Array.isArray(curve.keys)
      || (!allowEmpty && curve.keys.length < 2)) {
    throw new TypeError(`AncientBGAnimationSettings.${field} is incomplete`);
  }
  return curve;
}

export function validateCardAncientConfig(config, curveSettings) {
  if (!config || typeof config !== "object" || !curveSettings?.curves) {
    throw new TypeError("CardAncientObject config and curve settings are required");
  }
  const scalarFields = [
    "animCurveScale", "animStartDelayRangeA", "animStartDelayRangeB",
    "changeRangeStart", "changeRangeEnd", "zuzuGoalAnimThreshold",
    "goalThreshold", "scrollLength", "shapeChangeSpeed", "dot2Multiply",
    "accellRatio", "diffOffset", "shakeSpeed", "noiseScale",
    "frictionScale", "maxFriction", "startSandBaseEmissionRate",
    "middleSandBaseEmissionRate", "endSandBaseEmissionRate",
  ];
  const normalized = {
    componentIdentity: requireIdentity(config.componentIdentity, "componentIdentity"),
    componentGoIdentity: requireIdentity(config.componentGoIdentity, "componentGoIdentity"),
    componentGoPath: String(config.componentGoPath || ""),
    scriptIdentity: requireIdentity(config.scriptIdentity, "scriptIdentity"),
    curveSettingsIdentity: requireIdentity(
      config.curveSettingsIdentity,
      "curveSettingsIdentity",
    ),
    rendererBindings: Object.freeze([...(config.rendererBindings || [])]),
    scrolls: Object.freeze((config.scrolls || []).map((value, index) =>
      requireFinite(value, `scrolls[${index}]`))),
    shakeAIntensity: requireVector2(config.shakeAIntensity, "shakeAIntensity"),
    shakeAFrequency: requireVector2(config.shakeAFrequency, "shakeAFrequency"),
    shakeBIntensity: requireVector2(config.shakeBIntensity, "shakeBIntensity"),
    shakeBFrequency: requireVector2(config.shakeBFrequency, "shakeBFrequency"),
    isAnimationStopped: Number(config.isAnimationStopped || 0),
    ...Object.fromEntries(scalarFields.map((field) => [
      field,
      requireFinite(config[field], field),
    ])),
  };
  if (!normalized.componentGoPath
      || normalized.rendererBindings.length === 0
      || normalized.rendererBindings.some((identity) =>
        typeof identity !== "string" || !identity.includes(":"))
      || normalized.scrolls.length < STRATA_COUNT
      || ![0, 1].includes(normalized.isAnimationStopped)
      || curveSettings.scriptIdentity == null
      || config.curveSettingsIdentity !== curveSettings.identity) {
    throw new Error("CardAncientObject identity/binding contract is incomplete");
  }
  validateCurve(curveSettings.curves.ZuzuA, "ZuzuA");
  validateCurve(curveSettings.curves.ZuzuB, "ZuzuB", true);
  validateCurve(curveSettings.curves.ZuzuC, "ZuzuC", true);
  validateCurve(curveSettings.curves.Zzzzz, "Zzzzz");
  validateCurve(curveSettings.curves.ZuzuGoal, "ZuzuGoal");
  validateCurve(curveSettings.curves.ShakeIntensity, "ShakeIntensity");
  return {
    config: Object.freeze(normalized),
    curveSettings,
  };
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

export function cardAncientGoalFault(threeQuaternion, dot2Multiply) {
  const unityQuaternion = threeQuaternionToUnity(threeQuaternion);
  const rotation = normalizeQuaternion(unityQuaternion);
  const worldFront = normalizeVector3(rotateVectorByQuaternion(LOCAL_FRONT, rotation));
  const first = dot3(worldFront, normalizeVector3(LIGHT_DIR));
  const second = dot3(worldFront, normalizeVector3(LIGHT_DIR_2));
  return f32(first + f32(second * f32(dot2Multiply)));
}

function identitySeed(identity) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < identity.length; index += 1) {
    hash ^= identity.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0 || 0x6d2b79f5;
}

function random01(state) {
  let value = state.randomState >>> 0;
  value ^= value << 13;
  value ^= value >>> 17;
  value ^= value << 5;
  state.randomState = value >>> 0;
  return f32((state.randomState >>> 0) / 0x100000000);
}

function randomRange(state, minimum, maximum) {
  return f32(f32(minimum) + f32(f32(maximum - minimum) * random01(state)));
}

function fade(value) {
  const t = f32(value);
  return f32(f32(f32(t * t) * t)
    * f32(f32(f32(t * f32(6)) - f32(15)) * t + f32(10)));
}

function gradient(index, distance) {
  let hash = Math.imul(index | 0, 0x27d4eb2d);
  hash ^= hash >>> 15;
  return f32((hash & 1 ? -1 : 1) * distance);
}

// Unity's native Mathf.PerlinNoise1D remains a guest/runtime boundary. This
// deterministic 1D gradient-noise substitute preserves its smooth frequency
// behavior so the complete Strata path remains inspectable in WebGL.
export function cardAncientPerlinNoise1D(value) {
  const input = f32(value);
  const left = Math.floor(input);
  const fraction = f32(input - left);
  const blend = fade(fraction);
  const a = gradient(left, fraction);
  const b = gradient(left + 1, f32(fraction - 1));
  return f32(f32(0.5) + f32(f32(a + f32((b - a) * blend)) * f32(0.5)));
}

function signedFractionNoise(value, noiseScale) {
  const scaled = f32(cardAncientPerlinNoise1D(value) * f32(noiseScale));
  const fraction = f32(scaled - Math.floor(scaled));
  return f32(f32(fraction + fraction) - f32(1));
}

function selectStrataCurve(curves, animState) {
  if (animState === AnimState.Start) return curves.ZuzuA;
  if (animState === AnimState.Middle) return curves.Zzzzz;
  if (animState === AnimState.End) return curves.ZuzuGoal;
  return null;
}

function updateStrataFault(state, index) {
  const { config, curveSettings } = state;
  const strata = state.strata[index];
  const difference = f32(Math.abs(f32(state.goalStrataFaults - strata.strataFault)));
  if (difference < f32(config.goalThreshold)) {
    strata.strataFault = state.goalStrataFaults;
    strata.animElapsedTime = f32(0);
    strata.speed = f32(0);
    strata.animState = AnimState.Idle;
  } else {
    const direction = state.goalStrataFaults - strata.strataFault >= 0 ? 1 : -1;
    if (strata.animState === AnimState.Idle || strata.lastDir !== direction) {
      strata.animElapsedTime = f32(0);
      strata.speed = f32(0);
      strata.animState = AnimState.Start;
      strata.changeAnimTypeTime = randomRange(
        state,
        config.changeRangeStart,
        config.changeRangeEnd,
      );
      strata.animStartDelay = randomRange(
        state,
        config.animStartDelayRangeA,
        config.animStartDelayRangeB,
      );
    }
    const curveTime = Math.max(
      0,
      f32(strata.animElapsedTime - strata.animStartDelay),
    );
    if (curveTime <= strata.changeAnimTypeTime) {
      strata.animState = AnimState.Start;
    } else if (difference > f32(config.zuzuGoalAnimThreshold)) {
      strata.animState = AnimState.Middle;
    } else {
      strata.animState = AnimState.End;
    }
    const curve = selectStrataCurve(curveSettings.curves, strata.animState);
    let speed = curve
      ? f32(evaluateKiraPuyoCurve(curve, curveTime)
        * f32(direction * config.animCurveScale))
      : f32(0);
    if (strata.animState === AnimState.Middle) {
      speed = f32(speed * Math.max(
        f32(config.accellRatio * difference),
        f32(1),
      ));
    }
    strata.speed = speed;
    strata.lastDir = direction;
    strata.animElapsedTime = f32(strata.animElapsedTime + state.deltaTime);
    strata.strataFault = Math.max(
      -1,
      Math.min(1, f32(strata.strataFault + f32(speed * state.deltaTime))),
    );
  }
  strata.remappedStrataFault = f32(
    f32(strata.strataFault * f32(config.scrolls[index]))
      * f32(config.scrollLength),
  );
  state.remappedStrataFaults[index] = strata.remappedStrataFault;
}

function updateShake(state) {
  const { config, curveSettings } = state;
  const time = f32(state.elapsedTime * f32(config.shakeSpeed));
  const noise = (frequency, phase) =>
    signedFractionNoise(f32(f32(time * f32(frequency)) + f32(phase)), config.noiseScale);
  const shakeAX = f32(
    f32(noise(config.shakeAFrequency[0], 0) * f32(config.shakeAIntensity[0]))
      * f32(0.1),
  );
  const shakeAY = f32(
    f32(noise(config.shakeAFrequency[1], 0.5) * f32(config.shakeAIntensity[1]))
      * f32(0.1),
  );
  const shakeBX = f32(
    f32(noise(config.shakeBFrequency[0], 0) * f32(config.shakeBIntensity[0]))
      * f32(0.1),
  );
  const shakeBY = f32(
    f32(noise(config.shakeBFrequency[1], 0.5) * f32(config.shakeBIntensity[1]))
      * f32(0.1),
  );
  const first = state.strata[0];
  const curveScale = evaluateKiraPuyoCurve(
    curveSettings.curves.ShakeIntensity,
    first.animElapsedTime,
  );
  const differenceScale = Math.max(0, Math.min(1, f32(
    f32(config.diffOffset)
      + f32(Math.abs(f32(state.goalStrataFaults - first.strataFault))),
  )));
  const intensity = f32(curveScale * f32(differenceScale));
  state.shake[0] = f32(f32(shakeAX + shakeBX) * intensity);
  state.shake[1] = f32(f32(shakeAY + shakeBY) * intensity);
}

export function createCardAncientState(config, curveSettings) {
  const validated = validateCardAncientConfig(config, curveSettings);
  return {
    schema: CARD_ANCIENT_PRODUCER_SCHEMA,
    config: validated.config,
    curveSettings: validated.curveSettings,
    randomState: identitySeed(validated.config.componentIdentity),
    elapsedTime: f32(0),
    deltaTime: f32(0),
    goalStrataFaults: f32(0),
    strata: Array.from({ length: STRATA_COUNT }, () => ({
      strataFault: f32(0),
      remappedStrataFault: f32(0),
      lastDir: 0,
      animElapsedTime: f32(0),
      changeAnimTypeTime: f32(0),
      animStartDelay: f32(0),
      speed: f32(0),
      animState: AnimState.Idle,
    })),
    remappedStrataFaults: new Float32Array(STRATA_COUNT),
    shake: new Float32Array(2),
    frameCount: 0,
  };
}

export function updateCardAncient(state, {
  threeQuaternion,
  deltaTime,
}) {
  if (state?.schema !== CARD_ANCIENT_PRODUCER_SCHEMA) {
    throw new TypeError("invalid CardAncientObject state");
  }
  const dt = requireFinite(deltaTime, "deltaTime");
  if (dt < 0) throw new RangeError("CardAncientObject.deltaTime must be >= 0");
  state.deltaTime = f32(dt);
  state.elapsedTime = f32(state.elapsedTime + state.deltaTime);
  state.goalStrataFaults = cardAncientGoalFault(
    threeQuaternion,
    state.config.dot2Multiply,
  );
  for (let index = 0; index < STRATA_COUNT; index += 1) {
    updateStrataFault(state, index);
  }
  updateShake(state);
  state.frameCount += 1;
  return {
    shake: state.shake,
    strataFaults: state.remappedStrataFaults,
    goalStrataFaults: state.goalStrataFaults,
    frameCount: state.frameCount,
    nativeBoundaries: Object.freeze([
      "UnityEngine.Random.Range",
      "UnityEngine.Mathf.PerlinNoise1D",
    ]),
  };
}
