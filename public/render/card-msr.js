import { cardAncientPerlinNoise1D } from "./card-ancient.js";
import { evaluateKiraPuyoCurve } from "./kira-puyo.js";
import {
  normalizeQuaternion,
  rotateVectorByQuaternion,
  threeQuaternionToUnity,
} from "./official-touch-rotation.js";

export const CARD_MSR_PRODUCER_SCHEMA =
  "pocket-card-render/card-msr-object-arm64-state-port@1";

const LOCAL_FRONT = Object.freeze([0, 0, -1]);
const RAD_TO_DEG = Math.fround(57.295780181884766);
const REFLECTION_TILT_THRESHOLD = Math.fround(0.004999999888241291);
const f32 = Math.fround;

const AnimState = Object.freeze({
  Idle: 0,
  Play: 1,
  Stop: 2,
});

const ReflectPDState = Object.freeze({
  Idle: 0,
  Play: 1,
  Afterglow: 2,
});

const CURVE_NAMES = Object.freeze([
  "OutlineReflectCenterX",
  "OutlineReflectColorIntensity",
  "ColorIntensityNoiseStrength",
  "OutlineReflectFlipBookAnim",
  "OutlineReflectStartSpeed",
  "OutlineReflectEndSpeed",
  "AuraTransparency",
  "ParallaxTransparency",
  "ParallaxTranslate",
  "ParallaxAppearTransparency",
  "ParallaxAppearTranslate",
  "ParallaxDisappearTransparency",
  "ParallaxDisappearTranslate",
]);

const REQUIRED_CURVES = new Set(CURVE_NAMES.slice(0, 9));

function requireFinite(value, field) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    throw new TypeError(`CardMSRObject.${field} must be finite`);
  }
  return numeric;
}

function requireIdentity(value, field) {
  const identity = String(value || "");
  if (!identity.includes(":")) {
    throw new TypeError(`CardMSRObject.${field} must be an official identity`);
  }
  return identity;
}

function requireCurve(curve, field, allowEmpty) {
  if (!curve || !Array.isArray(curve.keys)
      || (!allowEmpty && curve.keys.length < 2)) {
    throw new TypeError(`MSRAnimationSettings.${field} is incomplete`);
  }
  for (const [index, key] of curve.keys.entries()) {
    for (const name of [
      "time", "value", "inSlope", "outSlope",
      "weightedMode", "inWeight", "outWeight",
    ]) {
      requireFinite(key?.[name], `${field}.keys[${index}].${name}`);
    }
  }
  return curve;
}

export function validateCardMSRConfig(config, animationSettings) {
  if (!config || typeof config !== "object" || !animationSettings?.curves) {
    throw new TypeError(
      "CardMSRObject config and MSRAnimationSettings are required",
    );
  }
  const scalarFields = [
    "animStartDegree", "animTimeScale", "animDuration", "endAnimDuration",
    "stopAnimTiming", "timeOffset", "intensityNoiseSpeed",
    "reflectFlipBookMaxSpeed", "reflectStartBane", "reflectStartNensei",
    "reflectEndBane", "reflectEndNensei", "checkRotatingTime",
    "rotatingEndThreshold", "rotatingStartThreshold", "disappearBane",
    "disappearNensei", "appearBane", "appearNensei",
  ];
  const rendererBindings = Object.fromEntries(
    ["aura", "parallax", "shadowbox"].map((role) => [
      role,
      Object.freeze([...(config.rendererBindings?.[role] || [])]),
    ]),
  );
  const normalized = {
    componentIdentity: requireIdentity(
      config.componentIdentity,
      "componentIdentity",
    ),
    componentGoIdentity: requireIdentity(
      config.componentGoIdentity,
      "componentGoIdentity",
    ),
    componentGoPath: String(config.componentGoPath || ""),
    scriptIdentity: requireIdentity(config.scriptIdentity, "scriptIdentity"),
    animationSettingsIdentity: requireIdentity(
      config.animationSettingsIdentity,
      "animationSettingsIdentity",
    ),
    rendererBindings: Object.freeze(rendererBindings),
    isAnimationStopped: Number(config.isAnimationStopped),
    ...Object.fromEntries(scalarFields.map((field) => [
      field,
      requireFinite(config[field], field),
    ])),
  };
  if (!normalized.componentGoPath
      || normalized.animationSettingsIdentity !== animationSettings.identity
      || ![0, 1].includes(normalized.isAnimationStopped)
      || Object.values(rendererBindings).some((bindings) =>
        bindings.length === 0
        || bindings.some((identity) =>
          typeof identity !== "string" || !identity.includes(":")))) {
    throw new Error("CardMSRObject identity/binding contract is incomplete");
  }
  requireIdentity(animationSettings.identity, "animationSettings.identity");
  requireIdentity(
    animationSettings.scriptIdentity,
    "animationSettings.scriptIdentity",
  );
  for (const name of CURVE_NAMES) {
    requireCurve(
      animationSettings.curves[name],
      name,
      !REQUIRED_CURVES.has(name),
    );
  }
  return {
    config: Object.freeze(normalized),
    animationSettings,
  };
}

function normalizeVector3(vector) {
  const length = f32(Math.hypot(vector[0], vector[1], vector[2]));
  if (!(length > 0)) return [0, 0, 0];
  return vector.map((value) => f32(f32(value) / length));
}

function distance3(left, right) {
  return f32(Math.hypot(
    f32(left[0] - right[0]),
    f32(left[1] - right[1]),
    f32(left[2] - right[2]),
  ));
}

function evaluateAnimation(state, progress) {
  const curves = state.animationSettings.curves;
  state.auraTransparency = f32(
    evaluateKiraPuyoCurve(curves.AuraTransparency, progress),
  );
  state.outlineReflectCenterX = f32(
    evaluateKiraPuyoCurve(curves.OutlineReflectCenterX, progress),
  );
  state.colorIntensityNoiseStrength = f32(
    evaluateKiraPuyoCurve(curves.ColorIntensityNoiseStrength, progress),
  );
  state.outlineReflectColorIntensity = f32(
    evaluateKiraPuyoCurve(curves.OutlineReflectColorIntensity, progress),
  );
}

function updateTilt(state, threeQuaternion) {
  const unityQuaternion = normalizeQuaternion(
    threeQuaternionToUnity(threeQuaternion),
  );
  const worldFront = normalizeVector3(
    rotateVectorByQuaternion(LOCAL_FRONT, unityQuaternion),
  );
  state.worldFront.set(worldFront);
  const planarLength = f32(Math.hypot(worldFront[0], worldFront[1]));
  const tiltRadians = f32(Math.atan2(planarLength, f32(-worldFront[2])));
  state.tiltDegree = f32(tiltRadians * RAD_TO_DEG);
  state.tilt = f32(Math.sin(f32(tiltRadians * f32(3))));

  state.tiltDistanceQueue.push({
    distance: distance3(state.lastWorldFront, worldFront),
    deltaTime: state.deltaTime,
    elapsedTime: state.elapsedTime,
  });
  while (state.tiltDistanceQueue.length > 0
      && f32(
        state.elapsedTime - state.tiltDistanceQueue[0].elapsedTime,
      ) > f32(state.config.checkRotatingTime)) {
    state.tiltDistanceQueue.shift();
  }
  state.lastWorldFront.set(worldFront);
}

function updateTranslateLayer(state) {
  if (state.config.isAnimationStopped) return;
  const difference = f32(state.tilt - state.parallaxPDTilt);
  const projectedDifference = f32(
    difference - f32(state.deltaTime * state.parallaxPDSpeed),
  );
  const useDisappear = difference !== 0 && !Number.isNaN(difference);
  const spring = f32(useDisappear
    ? state.config.disappearBane
    : state.config.appearBane);
  const damping = f32(useDisappear
    ? state.config.disappearNensei
    : state.config.appearNensei);
  const acceleration = f32(
    f32(spring * projectedDifference)
      - f32(state.parallaxPDSpeed * damping),
  );
  state.parallaxPDSpeed = f32(
    state.parallaxPDSpeed
      + f32(
        f32(state.deltaTime * acceleration)
          / f32(
            1
              + f32(
                state.deltaTime * f32(state.config.disappearNensei),
              ),
          ),
      ),
  );
  state.parallaxPDTilt = Math.max(0, Math.min(1, f32(
    state.parallaxPDTilt
      + f32(state.deltaTime * state.parallaxPDSpeed),
  )));
  state.parallaxTransparency = f32(evaluateKiraPuyoCurve(
    state.animationSettings.curves.ParallaxTransparency,
    state.parallaxPDTilt,
  ));
  state.parallaxTranslate = f32(evaluateKiraPuyoCurve(
    state.animationSettings.curves.ParallaxTranslate,
    state.parallaxPDTilt,
  ));
}

function updateAnimation(state) {
  if (state.animState === AnimState.Stop) {
    state.timeParam = f32(state.timeParam + state.deltaTime);
    if (state.tiltDegree <= f32(state.config.animStartDegree)) {
      state.animState = AnimState.Play;
      state.reflectPDState = ReflectPDState.Play;
    }
  } else if (state.animState === AnimState.Play) {
    state.animElapsedTime = f32(state.animElapsedTime + state.deltaTime);
    state.timeParam = f32(state.timeParam + state.deltaTime);
    evaluateAnimation(
      state,
      f32(state.animElapsedTime / f32(state.config.animTimeScale)),
    );
    if (f32(state.config.animDuration * state.config.animTimeScale)
        <= state.animElapsedTime) {
      state.animState = AnimState.Idle;
      state.animElapsedTime = f32(0);
      state.timeParam = f32(0);
      state.reflectPDState = ReflectPDState.Afterglow;
    }
  } else if (state.animState === AnimState.Idle
      && state.lastTiltDegree <= f32(state.config.animStartDegree)
      && f32(state.config.animStartDegree) < state.tiltDegree) {
    state.animState = AnimState.Play;
    state.reflectPDState = ReflectPDState.Play;
    state.animElapsedTime = f32(state.animElapsedTime + state.deltaTime);
    state.timeParam = f32(state.timeParam + state.deltaTime);
    evaluateAnimation(
      state,
      f32(state.animElapsedTime / f32(state.config.animTimeScale)),
    );
  }
  state.lastTiltDegree = state.tiltDegree;
}

function updateSpring(position, speed, target, spring, damping, deltaTime) {
  const projectedDifference = f32(
    f32(target - position) - f32(deltaTime * speed),
  );
  const acceleration = f32(
    f32(f32(spring) * projectedDifference)
      - f32(speed * f32(damping)),
  );
  const nextSpeed = f32(
    speed + f32(
      f32(deltaTime * acceleration)
        / f32(1 + f32(deltaTime * f32(damping))),
    ),
  );
  return {
    speed: nextSpeed,
    position: f32(position + f32(deltaTime * nextSpeed)),
  };
}

function updateReflection(state) {
  state.reflectColorIntensityOffset = state.animState !== AnimState.Idle
    ? f32(
      cardAncientPerlinNoise1D(
        f32(state.elapsedTime * f32(state.config.intensityNoiseSpeed)),
      ) * state.colorIntensityNoiseStrength,
    )
    : f32(0);

  let distanceSum = f32(0);
  let timeSum = f32(0);
  for (const sample of state.tiltDistanceQueue) {
    distanceSum = f32(distanceSum + sample.distance);
    timeSum = f32(timeSum + sample.deltaTime);
  }
  const rotatingSpeed = timeSum > 0
    ? f32(distanceSum / timeSum)
    : f32(0);

  if (state.reflectPDState === ReflectPDState.Idle
      && f32(state.config.rotatingStartThreshold) < rotatingSpeed
      && REFLECTION_TILT_THRESHOLD < state.tilt) {
    state.reflectPDState = ReflectPDState.Play;
  }
  if ((state.reflectPDState === ReflectPDState.Play
        || state.reflectPDState === ReflectPDState.Afterglow)
      && state.animState !== AnimState.Play
      && rotatingSpeed < f32(state.config.rotatingEndThreshold)) {
    state.reflectPDState = ReflectPDState.Idle;
  }

  if (state.reflectPDState === ReflectPDState.Play) {
    const next = updateSpring(
      state.reflectFlipBookSpeed,
      state.reflectPDSpeed,
      1,
      state.config.reflectStartBane,
      state.config.reflectStartNensei,
      state.deltaTime,
    );
    state.reflectFlipBookSpeed = next.position;
    state.reflectPDSpeed = next.speed;
  } else if (state.reflectPDState === ReflectPDState.Idle) {
    const next = updateSpring(
      state.reflectFlipBookSpeed,
      state.reflectPDSpeed,
      0,
      state.config.reflectEndBane,
      state.config.reflectEndNensei,
      state.deltaTime,
    );
    state.reflectFlipBookSpeed = next.position;
    state.reflectPDSpeed = next.speed;
  }

  state.reflectFlipBookBlend = state.reflectFlipBookSpeed;
  state.reflectFlipBookAnim = f32(
    state.reflectFlipBookAnim
      + f32(
        f32(state.reflectFlipBookBlend
          * f32(state.config.reflectFlipBookMaxSpeed))
          * state.deltaTime,
      ),
  );
  state.rotatingSpeed = rotatingSpeed;
}

export function createCardMSRState(config, animationSettings) {
  const validated = validateCardMSRConfig(config, animationSettings);
  const state = {
    schema: CARD_MSR_PRODUCER_SCHEMA,
    config: validated.config,
    animationSettings: validated.animationSettings,
    worldFront: new Float32Array(3),
    lastWorldFront: new Float32Array(3),
    tiltDistanceQueue: [],
    auraTransparency: f32(0),
    parallaxPDTilt: f32(0),
    parallaxPDSpeed: f32(0),
    parallaxTransparency: f32(0),
    parallaxTranslate: f32(0),
    outlineReflectCenterX: f32(0),
    outlineReflectColorIntensity: f32(0),
    colorIntensityNoiseStrength: f32(0),
    reflectCenterXOffset: f32(0),
    reflectColorIntensityOffset: f32(0),
    reflectFlipBookAnim: f32(0),
    reflectFlipBookSpeed: f32(0),
    reflectFlipBookBlend: f32(0),
    reflectPDSpeed: f32(0),
    reflectPDState: ReflectPDState.Idle,
    tilt: f32(0),
    tiltDegree: f32(0),
    lastTiltDegree: f32(0),
    animState: AnimState.Idle,
    animElapsedTime: f32(0),
    endAnimElapsedTime: f32(0),
    timeParam: f32(0),
    elapsedTime: f32(0),
    deltaTime: f32(0),
    rotatingSpeed: f32(0),
    frameCount: 0,
  };
  evaluateAnimation(state, f32(0));
  return state;
}

export function updateCardMSR(state, {
  threeQuaternion,
  deltaTime,
}) {
  if (state?.schema !== CARD_MSR_PRODUCER_SCHEMA) {
    throw new TypeError("invalid CardMSRObject state");
  }
  const dt = requireFinite(deltaTime, "deltaTime");
  if (dt < 0) throw new RangeError("CardMSRObject.deltaTime must be >= 0");
  state.deltaTime = f32(dt);
  state.elapsedTime = f32(state.elapsedTime + state.deltaTime);
  updateTilt(state, threeQuaternion);
  updateTranslateLayer(state);
  updateAnimation(state);
  updateReflection(state);
  state.frameCount += 1;
  return Object.freeze({
    timeParam: f32(state.config.timeOffset + state.timeParam),
    transparency: state.auraTransparency,
    parallaxTransparency: state.parallaxTransparency,
    parallaxTranslate: state.parallaxTranslate,
    flipAnimOffset: f32(
      state.reflectCenterXOffset + state.outlineReflectCenterX,
    ),
    reflectIntensity: f32(
      state.reflectColorIntensityOffset
        + state.outlineReflectColorIntensity,
    ),
    flipAnim: state.reflectFlipBookAnim,
    flipBlend: state.reflectFlipBookBlend,
    tilt: state.tilt,
    tiltDegree: state.tiltDegree,
    rotatingSpeed: state.rotatingSpeed,
    animState: state.animState,
    reflectPDState: state.reflectPDState,
    frameCount: state.frameCount,
    nativeBoundaries: Object.freeze([
      "UnityEngine.Mathf.PerlinNoise(x, 0)",
      "Unity LateUpdate frame scheduling",
      "official guest MaterialPropertyBlock submission",
    ]),
  });
}
