import { evaluateKiraPuyoCurve } from "./kira-puyo.js";
import {
  normalizeQuaternion,
  rotateVectorByQuaternion,
  threeQuaternionToUnity,
} from "./official-touch-rotation.js";

export const CARD_MRR_PRODUCER_SCHEMA =
  "pocket-card-render/card-mrr-object-arm64-state-port@1";
export const CARD_MRR_MATERIAL_OVERRIDE_PRODUCER_SCHEMA =
  "pocket-card-render/material-with-optional-card-mrr-object-arm64-override@1";

const LOCAL_FRONT = Object.freeze([0, 0, -1]);
const RAD_TO_DEG = Math.fround(57.295780181884766);
const f32 = Math.fround;

const CURVE_NAMES = Object.freeze([
  "ChangeColorCurve",
  "LightColorIntensityCurve",
  "LightEmitIntensityCurve",
  "LightPower",
  "Layer2UVXTranslateByTiltingLeft",
  "Layer2UVXTranslateByTiltingRight",
  "Layer2ColorPower",
  "Layer2EmissiveIntensity",
  "EffSwitchColor",
  "EffAdditiveIntensity",
  "EffColor3Blend",
  "EffEmissiveIntensity",
  "FlashIntensity",
  "FlashRadialScaling",
  "FlashRadialAnim",
]);

function requireFinite(value, field) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    throw new TypeError(`CardMRRObject.${field} must be finite`);
  }
  return numeric;
}

function requireIdentity(value, field) {
  const identity = String(value || "");
  if (!identity.includes(":")) {
    throw new TypeError(`CardMRRObject.${field} must be an official identity`);
  }
  return identity;
}

function requireCurve(curve, field) {
  if (!curve || !Array.isArray(curve.keys) || curve.keys.length < 2) {
    throw new TypeError(`MRRAnimationSettings.${field} is incomplete`);
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

export function validateCardMRRConfig(config, animationSettings) {
  if (!config || typeof config !== "object" || !animationSettings?.curves) {
    throw new TypeError(
      "CardMRRObject config and MRRAnimationSettings are required",
    );
  }
  const scalarFields = [
    "animStartDegree", "animTimeScale", "animDuration",
    "flashRadialStartOffset", "recordingTime", "minTiltSpeed",
    "maxTiltSpeed", "minAnimSpeed", "maxAnimSpeed",
  ];
  const rendererBindings = Object.fromEntries(
    ["main", "effect", "flash"].map((role) => [
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
    useSpeedAdjust: Number(config.useSpeedAdjust),
    ...Object.fromEntries(scalarFields.map((field) => [
      field,
      requireFinite(config[field], field),
    ])),
  };
  if (!normalized.componentGoPath
      || normalized.animationSettingsIdentity !== animationSettings.identity
      || ![0, 1].includes(normalized.useSpeedAdjust)
      || normalized.animTimeScale <= 0
      || normalized.recordingTime < 0
      || normalized.maxTiltSpeed <= normalized.minTiltSpeed
      || Object.values(rendererBindings).some((bindings) =>
        bindings.length === 0
        || bindings.some((identity) =>
          typeof identity !== "string" || !identity.includes(":")))) {
    throw new Error("CardMRRObject identity/binding contract is incomplete");
  }
  requireIdentity(animationSettings.identity, "animationSettings.identity");
  requireIdentity(
    animationSettings.scriptIdentity,
    "animationSettings.scriptIdentity",
  );
  for (const name of CURVE_NAMES) {
    requireCurve(animationSettings.curves[name], name);
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

function curve(state, name, progress) {
  return f32(evaluateKiraPuyoCurve(
    state.animationSettings.curves[name],
    progress,
  ));
}

function evaluateAnimation(state, progress) {
  state.changeColor = curve(state, "ChangeColorCurve", progress);
  state.lightColorIntensity = curve(
    state,
    "LightColorIntensityCurve",
    progress,
  );
  state.lightEmitIntensity = curve(
    state,
    "LightEmitIntensityCurve",
    progress,
  );
  state.lightPower = curve(state, "LightPower", progress);
  const translateCurve = state.worldFrontAtAnimStart[0] > 0
    ? "Layer2UVXTranslateByTiltingRight"
    : "Layer2UVXTranslateByTiltingLeft";
  state.layer2UVTranslate[0] = curve(state, translateCurve, progress);
  state.layer2ColorPower = curve(state, "Layer2ColorPower", progress);
  state.layer2EmissiveIntensity = curve(
    state,
    "Layer2EmissiveIntensity",
    progress,
  );
  state.effectSwitchColor = curve(state, "EffSwitchColor", progress);
  state.effectAdditiveIntensity = curve(
    state,
    "EffAdditiveIntensity",
    progress,
  );
  state.effectColor3Blend = curve(state, "EffColor3Blend", progress);
  state.effectEmissiveIntensity = curve(
    state,
    "EffEmissiveIntensity",
    progress,
  );
  state.flashIntensity = curve(state, "FlashIntensity", progress);
  const radialScaling = curve(state, "FlashRadialScaling", progress);
  const offset = f32(state.config.flashRadialStartOffset);
  state.flashRadialScaling = f32(
    f32(offset * state.maxRadialScaling)
      + f32(f32(1 - offset) * radialScaling),
  );
  state.flashRadialAnim = f32(
    offset
      + f32(
        f32(1 - offset)
          * curve(state, "FlashRadialAnim", progress),
      ),
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
  state.worldFrontXY[0] = worldFront[0];
  state.worldFrontXY[1] = worldFront[1];
  const planarLength = f32(Math.hypot(worldFront[0], worldFront[1]));
  state.tiltDegree = f32(
    f32(Math.atan2(planarLength, f32(-worldFront[2]))) * RAD_TO_DEG,
  );
  state.tiltDistanceQueue.push({
    distance: distance3(state.lastWorldFront, worldFront),
    deltaTime: state.deltaTime,
    elapsedTime: state.elapsedTime,
  });
  while (state.tiltDistanceQueue.length > 0
      && f32(
        state.elapsedTime - state.tiltDistanceQueue[0].elapsedTime,
      ) > f32(state.config.recordingTime)) {
    state.tiltDistanceQueue.shift();
  }
  state.lastWorldFront.set(worldFront);
}

function adjustedAnimationSpeed(state) {
  let distanceSum = f32(0);
  let timeSum = f32(0);
  for (const sample of state.tiltDistanceQueue) {
    distanceSum = f32(distanceSum + sample.distance);
    timeSum = f32(timeSum + sample.deltaTime);
  }
  const tiltSpeed = timeSum > 0
    ? f32(distanceSum / timeSum)
    : f32(state.config.minTiltSpeed);
  const clamped = Math.max(
    f32(state.config.minTiltSpeed),
    Math.min(f32(state.config.maxTiltSpeed), tiltSpeed),
  );
  const ratio = f32(
    f32(clamped - f32(state.config.minTiltSpeed))
      / f32(
        f32(state.config.maxTiltSpeed)
          - f32(state.config.minTiltSpeed),
      ),
  );
  return f32(
    f32(state.config.minAnimSpeed)
      + f32(
        f32(
          f32(state.config.maxAnimSpeed)
            - f32(state.config.minAnimSpeed),
        ) * ratio,
      ),
  );
}

function updateAnimation(state) {
  if (!state.isPlaying
      && state.lastTiltDegree <= f32(state.config.animStartDegree)
      && f32(state.config.animStartDegree) < state.tiltDegree) {
    state.isPlaying = true;
    state.elapsedAnimationTime = f32(0);
    state.worldFrontAtAnimStart.set(state.worldFront);
    state.adjustedAnimSpeed = adjustedAnimationSpeed(state);
  }
  if (state.isPlaying) {
    const speed = state.config.useSpeedAdjust
      ? state.adjustedAnimSpeed
      : f32(1);
    state.elapsedAnimationTime = f32(
      state.elapsedAnimationTime + f32(state.deltaTime * speed),
    );
    evaluateAnimation(
      state,
      f32(
        state.elapsedAnimationTime / f32(state.config.animTimeScale),
      ),
    );
    state.isPlaying = state.elapsedAnimationTime <= f32(
      f32(state.config.animDuration) * f32(state.config.animTimeScale),
    );
  }
  state.lastTiltDegree = state.tiltDegree;
}

export function createCardMRRState(config, animationSettings) {
  const validated = validateCardMRRConfig(config, animationSettings);
  const radialKeys =
    validated.animationSettings.curves.FlashRadialScaling.keys;
  const state = {
    schema: CARD_MRR_PRODUCER_SCHEMA,
    config: validated.config,
    animationSettings: validated.animationSettings,
    changeColor: f32(0),
    lightColorIntensity: f32(0),
    lightEmitIntensity: f32(0),
    lightPower: f32(0),
    layer2UVTranslate: new Float32Array(4),
    layer2ColorPower: f32(0),
    layer2EmissiveIntensity: f32(0),
    effectSwitchColor: f32(0),
    effectAdditiveIntensity: f32(0),
    effectColor3Blend: f32(0),
    effectEmissiveIntensity: f32(0),
    flashIntensity: f32(0),
    flashRadialScaling: f32(0),
    flashRadialAnim: f32(0),
    worldFront: new Float32Array([0, 0, -1]),
    lastWorldFront: new Float32Array([0, 0, -1]),
    worldFrontXY: new Float32Array(2),
    worldFrontAtAnimStart: new Float32Array(3),
    tiltDegree: f32(0),
    lastTiltDegree: f32(0),
    isPlaying: false,
    elapsedAnimationTime: f32(0),
    tiltDistanceQueue: [],
    elapsedTime: f32(0),
    deltaTime: f32(0),
    adjustedAnimSpeed: f32(1),
    minRadialScaling: f32(radialKeys[0].value),
    maxRadialScaling: f32(radialKeys.at(-1).value),
    frameCount: 0,
  };
  evaluateAnimation(state, f32(0));
  return state;
}

export function updateCardMRR(state, {
  threeQuaternion,
  deltaTime,
}) {
  if (state?.schema !== CARD_MRR_PRODUCER_SCHEMA) {
    throw new TypeError("invalid CardMRRObject state");
  }
  const dt = requireFinite(deltaTime, "deltaTime");
  if (dt < 0) throw new RangeError("CardMRRObject.deltaTime must be >= 0");
  state.deltaTime = f32(dt);
  state.elapsedTime = f32(state.elapsedTime + state.deltaTime);
  updateTilt(state, threeQuaternion);
  updateAnimation(state);
  state.frameCount += 1;
  return Object.freeze({
    changeColor: state.changeColor,
    lightColorIntensity: state.lightColorIntensity,
    lightEmitIntensity: state.lightEmitIntensity,
    lightPower: state.lightPower,
    layer2UVTranslate: state.layer2UVTranslate,
    layer2ColorPower: state.layer2ColorPower,
    layer2EmissiveIntensity: state.layer2EmissiveIntensity,
    effectSwitchColor: state.effectSwitchColor,
    effectAdditiveIntensity: state.effectAdditiveIntensity,
    effectColor3Blend: state.effectColor3Blend,
    effectEmissiveIntensity: state.effectEmissiveIntensity,
    flashIntensity: state.flashIntensity,
    flashRadialScaling: state.flashRadialScaling,
    flashRadialAnim: state.flashRadialAnim,
    tiltDegree: state.tiltDegree,
    adjustedAnimSpeed: state.adjustedAnimSpeed,
    isPlaying: state.isPlaying,
    frameCount: state.frameCount,
    nativeBoundaries: Object.freeze([
      "Unity LateUpdate frame scheduling",
      "Unity Time.time/deltaTime sampling",
      "official guest MaterialPropertyBlock submission",
    ]),
  });
}
