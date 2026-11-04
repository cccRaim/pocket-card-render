import { evaluateKiraPuyoCurve } from "./kira-puyo.js";
import { evaluateCardMRRAnimation } from "./card-mrr.js";
import { updateCardMSRSpring, updateCardMSRTilt } from "./card-msr.js";
import { cardAncientPerlinNoise1D } from "./card-ancient.js";
import { normalizeQuaternion, rotateVectorByQuaternion, threeQuaternionToUnity } from "./official-touch-rotation.js";

// Producer identifiers select arithmetic; they do not establish native evidence.
export const CARD_DUAL_MRR_PRODUCER_SCHEMA = "pocket-card-render/card-dual-mrr-object-arm64-state-port@1";
export const CARD_DUAL_MSR_PRODUCER_SCHEMA = "pocket-card-render/card-dual-msr-object-arm64-state-port@1";
export const CARD_DUAL_EVIDENCE_SCOPE = "reference-only";
const f32 = Math.fround;
const RAD_TO_DEG = f32(57.295780181884766);

function curve(state, name, time) {
  const value = state.animationSettings.curves[name];
  if (!Array.isArray(value?.keys)) throw new Error(`Missing dual card curve ${name}`);
  return value.keys.length === 0 ? 0 : value.keys.length === 1
    ? f32(value.keys[0].value) : f32(evaluateKiraPuyoCurve(value, f32(time)));
}

function validate(config, settings, fields, curves) {
  if (!config || !settings?.curves || config.animationSettingsIdentity !== settings.identity) {
    throw new Error("Dual card component/settings identity mismatch");
  }
  for (const field of fields) {
    if (!Number.isFinite(config[field])) throw new TypeError(`Dual card ${field} must be finite`);
    if (/TimeScale$/.test(field) && config[field] <= 0 || /Duration$/.test(field) && config[field] < 0) {
      throw new RangeError(`Invalid dual card ${field}`);
    }
  }
  for (const name of curves) {
    const keys = settings.curves[name]?.keys;
    if (!Array.isArray(keys) || keys.some((key) => !Number.isFinite(key.time) || !Number.isFinite(key.value))) {
      throw new TypeError(`Missing or invalid dual card curve ${name}`);
    }
  }
}

function validateFrame(quaternion, deltaTime) {
  if (!Number.isFinite(deltaTime) || deltaTime < 0 || quaternion?.length !== 4
      || Array.from(quaternion).some((value) => !Number.isFinite(value))) {
    throw new TypeError("Dual card requires finite quaternion and nonnegative deltaTime");
  }
}

function updateHighlight(state, time) {
  state.highlightTranslate[0] = curve(state, state.worldFrontAtAnimStart[0] > 0
    ? "TypeIconHighlightTranslateByTiltingRight" : "TypeIconHighlightTranslateByTiltingLeft", time);
}

const HIGHLIGHT_CURVES = ["TypeIconHighlightTranslateByTiltingRight", "TypeIconHighlightTranslateByTiltingLeft"];
const MRR_CURVES = ["ChangeColorCurve", "LightColorIntensityCurve", "LightEmitIntensityCurve", "LightPower",
  "Layer2UVXTranslateByTiltingLeft", "Layer2UVXTranslateByTiltingRight", "Layer2ColorPower", "Layer2EmissiveIntensity",
  "EffSwitchColor", "EffAdditiveIntensity", "EffColor3Blend", "EffEmissiveIntensity", "FlashIntensity",
  "FlashRadialScaling", "FlashRadialAnim", "TypeEffectTransitionSwitchCurve", "TransitionBoundsCurve", "TransitionRangeCurve"];

function evaluateDualMRR(state, time) {
  evaluateCardMRRAnimation(state, time);
  updateHighlight(state, time);
}

export function createCardDualMRRState(config, animationSettings) {
  validate(config, animationSettings,
    ["animStartDegree", "animTimeScale", "animDuration", "flashRadialStartOffset", "transitionAngle"],
    [...MRR_CURVES, ...HIGHLIGHT_CURVES]);
  const keys = animationSettings.curves.FlashRadialScaling.keys;
  if (!keys.length) throw new Error("FlashRadialScaling requires keys");
  const state = {
    schema: CARD_DUAL_MRR_PRODUCER_SCHEMA, config, animationSettings,
    worldFront: new Float32Array([0, 0, -1]), worldFrontAtAnimStart: new Float32Array(3),
    layer2UVTranslate: new Float32Array(4), highlightTranslate: new Float32Array(2),
    maxRadialScaling: f32(keys.at(-1).value), minRadialScaling: f32(keys[0].value),
    tiltDegree: 0, lastTiltDegree: 0, tiltToBoundary: 0, isPlaying: false,
    elapsedAnimationTime: 0, gradationBoundsOffset: 0, gradationRange: 0, textureSwitch: 0,
  };
  evaluateDualMRR(state, 0);
  return state;
}

export function updateCardDualMRR(state, { threeQuaternion, deltaTime }) {
  if (state?.schema !== CARD_DUAL_MRR_PRODUCER_SCHEMA) throw new TypeError("Invalid dual MRR state");
  validateFrame(threeQuaternion, deltaTime);
  const front = rotateVectorByQuaternion([0, 0, -1], normalizeQuaternion(threeQuaternionToUnity(threeQuaternion)));
  state.worldFront.set(front);
  state.tiltDegree = f32(Math.atan2(Math.hypot(front[0], front[1]), -front[2]) * RAD_TO_DEG);
  const angle = f32(state.config.transitionAngle * -.01745329238474369);
  const across = f32(f32(Math.sin(angle) * front[0]) + f32(Math.cos(angle) * front[1]));
  const along = f32(f32(Math.cos(angle) * front[0]) - f32(Math.sin(angle) * front[1]));
  state.tiltToBoundary = f32(Math.atan2(across, Math.hypot(along, front[2])) * RAD_TO_DEG);
  if (!state.config.isAnimationStopped) {
    const time = f32(Math.abs(state.tiltToBoundary) / 30);
    const sign = state.tiltToBoundary < 0 ? 1 : -1;
    state.textureSwitch = f32(sign * curve(state, "TypeEffectTransitionSwitchCurve", time));
    state.gradationBoundsOffset = f32(sign * curve(state, "TransitionBoundsCurve", time));
    state.gradationRange = curve(state, "TransitionRangeCurve", time);
  }
  if (state.isPlaying) {
    state.elapsedAnimationTime = f32(state.elapsedAnimationTime + f32(deltaTime));
    evaluateDualMRR(state, f32(state.elapsedAnimationTime / f32(state.config.animTimeScale)));
    state.isPlaying = state.elapsedAnimationTime <= f32(state.config.animDuration * state.config.animTimeScale);
  }
  if (state.lastTiltDegree <= state.config.animStartDegree
      && state.tiltDegree > state.config.animStartDegree) {
    state.elapsedAnimationTime = 0;
    state.isPlaying = true;
    state.worldFrontAtAnimStart.set(front);
  }
  state.lastTiltDegree = state.tiltDegree;
  return state;
}

function evaluateFlash(state, time) {
  updateHighlight(state, time);
  state.holoPower = curve(state, "HoloPowerCurve", time);
  state.effectSwitchColor = curve(state, "EffSwitchColor", time);
  state.effectAdditiveIntensity = curve(state, "EffAdditiveIntensity", time);
  state.effectColor3Blend = curve(state, "EffColor3Blend", time);
  state.effectEmissiveIntensity = curve(state, "EffEmissiveIntensity", time);
}

function evaluateOutline(state, time) {
  state.outlineReflectCenterX = curve(state, "OutlineReflectCenterX", time);
  state.outlineReflectColorIntensity = curve(state, "OutlineReflectColorIntensity", time);
  state.colorIntensityNoiseStrength = curve(state, "ColorIntensityNoiseStrength", time);
}

export function createCardDualMSRState(config, animationSettings) {
  if (!["dualMSR", "dualNoParallax"].includes(config?.kind)) throw new Error("Invalid dual card kind");
  const msr = config.kind === "dualMSR";
  validate(config, animationSettings, msr
    ? ["animStartDegree", "flashAnimTimeScale", "flashAnimDuration", "outlineAnimTimeScale", "outlineAnimDuration",
      "intensityNoiseSpeed", "checkRotatingTime", "rotatingStartThreshold", "rotatingEndThreshold",
      "reflectStartBane", "reflectEndBane", "reflectStartNensei", "reflectEndNensei", "reflectFlipBookMaxSpeed",
      "transitionAngle", "transitionBane", "transitionNensei"]
    : ["animStartDegree", "animTimeScale", "animDuration"], msr
    ? [...HIGHLIGHT_CURVES, "HoloPowerCurve", "EffSwitchColor", "EffAdditiveIntensity", "EffColor3Blend", "EffEmissiveIntensity",
      "OutlineReflectCenterX", "OutlineReflectColorIntensity", "ColorIntensityNoiseStrength",
      "BGTransitionSwitchCurve", "FrameTransitionSwitchCurve", "FrameBandWidthCurve"] : HIGHLIGHT_CURVES);
  const state = {
    schema: CARD_DUAL_MSR_PRODUCER_SCHEMA, config, animationSettings,
    worldFront: new Float32Array(3), lastWorldFront: new Float32Array(3), worldFrontAtAnimStart: new Float32Array(3),
    highlightTranslate: new Float32Array(4), tiltDistanceQueue: [],
    tilt: 0, tiltDegree: 0, lastTiltDegree: 0, elapsedTime: 0, deltaTime: 0,
    flashAnimState: 0, outlineAnimState: 0, flashAnimElapsedTime: 0, outlineAnimElapsedTime: 0,
    transitionPDTilt: 0, transitionPDSpeed: 0, isLeft: 0, frameBandWidth: 0,
    reflectPDState: 0, reflectFlipBookSpeed: 0, reflectPDSpeed: 0, reflectFlipBookAnim: 0,
    reflectFlipBookBlend: 0, reflectColorIntensityOffset: 0, rotatingSpeed: 0,
  };
  if (msr) { evaluateFlash(state, 0); evaluateOutline(state, 0); }
  else updateHighlight(state, 0);
  return state;
}

function updateReflection(state) {
  const { config, deltaTime } = state;
  state.reflectColorIntensityOffset = state.reflectPDState !== 0
    ? f32(cardAncientPerlinNoise1D(f32(state.elapsedTime * config.intensityNoiseSpeed)) * state.colorIntensityNoiseStrength) : 0;
  let distance = 0, duration = 0;
  for (const sample of state.tiltDistanceQueue) {
    distance = f32(distance + sample.distance);
    duration = f32(duration + sample.deltaTime);
  }
  const speed = duration > 0 ? f32(distance / duration) : 0;
  if (state.reflectPDState === 0 && config.rotatingStartThreshold < speed && f32(.004999999888241291) < state.tilt) {
    state.reflectPDState = 1;
  }
  if ((state.reflectPDState === 1 || state.reflectPDState === 2)
      && state.outlineAnimState !== 1 && speed < config.rotatingEndThreshold) state.reflectPDState = 0;
  if (state.reflectPDState !== 2) {
    const playing = state.reflectPDState === 1;
    const next = updateCardMSRSpring(state.reflectFlipBookSpeed, state.reflectPDSpeed, playing ? 1 : 0,
      playing ? config.reflectStartBane : config.reflectEndBane,
      playing ? config.reflectStartNensei : config.reflectEndNensei, deltaTime);
    state.reflectFlipBookSpeed = next.position;
    state.reflectPDSpeed = next.speed;
  }
  state.reflectFlipBookBlend = state.reflectFlipBookSpeed;
  state.reflectFlipBookAnim = f32(state.reflectFlipBookAnim + f32(f32(state.reflectFlipBookBlend * config.reflectFlipBookMaxSpeed) * deltaTime));
  state.rotatingSpeed = speed;
}

export function updateCardDualMSR(state, { threeQuaternion, deltaTime }) {
  if (state?.schema !== CARD_DUAL_MSR_PRODUCER_SCHEMA) throw new TypeError("Invalid dual MSR state");
  validateFrame(threeQuaternion, deltaTime);
  const config = state.config;
  state.deltaTime = f32(deltaTime);
  state.elapsedTime = f32(state.elapsedTime + state.deltaTime);
  if (config.kind === "dualNoParallax") {
    state.worldFront.set(rotateVectorByQuaternion([0, 0, -1], normalizeQuaternion(threeQuaternionToUnity(threeQuaternion))));
    state.tiltDegree = f32(Math.atan2(Math.hypot(state.worldFront[0], state.worldFront[1]), -state.worldFront[2]) * RAD_TO_DEG);
    if (state.flashAnimState === 1) {
      state.flashAnimElapsedTime = f32(state.flashAnimElapsedTime + state.deltaTime);
      updateHighlight(state, f32(state.flashAnimElapsedTime / config.animTimeScale));
      state.flashAnimState = state.flashAnimElapsedTime <= f32(config.animDuration * config.animTimeScale) ? 1 : 0;
    }
    if (state.lastTiltDegree < config.animStartDegree
        && config.animStartDegree < state.tiltDegree) {
      state.flashAnimElapsedTime = 0;
      state.flashAnimState = 1;
      state.worldFrontAtAnimStart.set(state.worldFront);
    }
  } else {
    updateCardMSRTilt(state, threeQuaternion);
    const crossed = state.lastTiltDegree < config.animStartDegree && config.animStartDegree < state.tiltDegree;
    if (state.flashAnimState === 0 && crossed) {
      state.flashAnimState = 1;
      state.worldFrontAtAnimStart.set(state.worldFront);
    }
    if (state.flashAnimState === 1) {
      state.flashAnimElapsedTime = f32(state.flashAnimElapsedTime + state.deltaTime);
      evaluateFlash(state, f32(state.flashAnimElapsedTime / config.flashAnimTimeScale));
      if (state.flashAnimElapsedTime > f32(config.flashAnimDuration * config.flashAnimTimeScale)) {
        state.flashAnimState = 0;
        state.flashAnimElapsedTime = 0;
      }
    }
    if (state.outlineAnimState === 0 && crossed) { state.outlineAnimState = 1; state.reflectPDState = 1; }
    if (state.outlineAnimState === 1) {
      state.outlineAnimElapsedTime = f32(state.outlineAnimElapsedTime + state.deltaTime);
      evaluateOutline(state, f32(state.outlineAnimElapsedTime / config.outlineAnimTimeScale));
      if (state.outlineAnimElapsedTime > f32(config.outlineAnimDuration * config.outlineAnimTimeScale)) {
        state.outlineAnimState = 0;
        state.outlineAnimElapsedTime = 0;
        state.reflectPDState = 2;
      }
    }
    if (!config.isAnimationStopped) {
      const angle = f32(config.transitionAngle * f32(Math.PI / 180));
      const along = f32(f32(Math.cos(angle) * state.worldFront[0]) - f32(Math.sin(angle) * state.worldFront[1]));
      const across = f32(f32(Math.sin(angle) * state.worldFront[0]) + f32(Math.cos(angle) * state.worldFront[1]));
      const tilt = f32(Math.atan2(across, f32(Math.hypot(along, state.worldFront[2]))) * RAD_TO_DEG);
      const target = f32(f32(f32(f32(30 - tilt) / 60) * 2) - 1);
      const next = updateCardMSRSpring(state.transitionPDTilt, state.transitionPDSpeed, target,
        config.transitionBane, config.transitionNensei, state.deltaTime);
      state.transitionPDTilt = f32(Math.min(1, Math.max(-1, next.position)));
      state.transitionPDSpeed = next.speed;
      // These curves are evaluated by the producer, but do not replace the PD output.
      curve(state, "BGTransitionSwitchCurve", state.transitionPDTilt);
      curve(state, "FrameTransitionSwitchCurve", state.transitionPDTilt);
      state.frameBandWidth = curve(state, "FrameBandWidthCurve", Math.abs(state.transitionPDTilt));
      state.isLeft = state.transitionPDTilt < 0 ? 1 : 0;
    }
    updateReflection(state);
  }
  state.lastTiltDegree = state.tiltDegree;
  return state;
}

const MRR_OUTPUTS = {
  main: { _ChangeColor: "changeColor", _LightColorIntensity: "lightColorIntensity", _LightEmitIntensity: "lightEmitIntensity",
    _LightPower: "lightPower", _Layer2UVTranslate: "layer2UVTranslate", _Layer2ColorPower: "layer2ColorPower", _Layer2EmissiveIntensity: "layer2EmissiveIntensity" },
  effect: { _Switch: "effectSwitchColor", _AdditiveIntensity: "effectAdditiveIntensity", _Color3Blend: "effectColor3Blend", _EmissiveIntensity: "effectEmissiveIntensity" },
  flash: { _FlashIntensity: "flashIntensity", _RadialScaling: "flashRadialScaling", _RadialAnim: "flashRadialAnim" },
  typeIcon: { _HighlightTranslate: "highlightTranslate" },
  typeEffect: { _GradationBoundsOffset: "gradationBoundsOffset", _GradationRange: "gradationRange", _TextureSwitch: "textureSwitch" },
};

export function cardDualMRRUniforms(state, role) {
  const transition = role === "transition" || role === "typeEffect";
  const mapping = MRR_OUTPUTS[transition ? "typeEffect" : role];
  if (!mapping) throw new Error(`Invalid dual MRR renderer role ${role}`);
  return { ...Object.fromEntries(Object.entries(mapping).map(([uniform, field]) => [uniform, state[field]])),
    ...(transition ? { _IsLeft: state.tiltToBoundary >= 0 ? 1 : 0, _MainColorModMultiplier: 0, _SubColorModMultiplier: 0 } : {}) };
}

export function cardDualMSRUniforms(state, role) {
  switch (role) {
    case "shadowbox": return { _ReflectCenterX: state.outlineReflectCenterX, _ReflectIntensity: f32(state.outlineReflectColorIntensity + state.reflectColorIntensityOffset), _FlipAnim: state.reflectFlipBookAnim, _FlipBlend: state.reflectFlipBookBlend };
    case "transition": return { _TransitionSwitch: state.transitionPDTilt, _IsLeft: state.isLeft, _TransitionDiffractionPower: state.holoPower };
    case "frame": return { _TransitionSwitch: state.transitionPDTilt, _BandWidth: state.frameBandWidth };
    case "typeIcon": return { _HighlightTranslate: state.highlightTranslate };
    case "effect": return { _Switch: state.effectSwitchColor, _AdditiveIntensity: state.effectAdditiveIntensity, _Color3Blend: state.effectColor3Blend, _EmissiveIntensity: state.effectEmissiveIntensity };
    default: throw new Error(`Invalid dual MSR renderer role ${role}`);
  }
}
