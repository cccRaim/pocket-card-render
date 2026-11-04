// Float32 color and shadow-UV parameter arithmetic.
// Native producer and runtime equivalence remain unverified.
import {
  multiplyQuaternions,
  rotateVectorByQuaternion,
  threeQuaternionToUnity,
} from "./official-touch-rotation.js";
import { evaluateKiraPuyoCurve } from "./kira-puyo.js";

export const CARD_PARAMETER_EVIDENCE_SCOPE = "reference-only";
export const CARD_RGB_PRODUCER_SCHEMA = "pocket-card-render/card-rgb-oklab-arm64-port@1";
export const CARD_UV_SHADOW_PRODUCER_SCHEMA = "pocket-card-render/card-uv-shadow-arm64-port@1";
export const CARD_RELIEF_PRODUCER_SCHEMA = "pocket-card-render/card-m-relief-sr-arm64-port@1";
const f32 = Math.fround;
const add = (a, b) => f32(a + b);
const mul = (a, b) => f32(a * b);
const dot = (a, b) => add(add(mul(a[0], b[0]), mul(a[1], b[1])), mul(a[2], b[2]));

function vector(value, length, field) {
  if (!(Array.isArray(value) || ArrayBuffer.isView(value))
      || value.length !== length || Array.from(value).some((x) => !Number.isFinite(x))) {
    throw new TypeError(`${field} requires ${length} finite components`);
  }
  return Float32Array.from(value);
}

function referenceLinearChannel(value) {
  const channel = f32(value);
  return channel < f32(.04045)
    ? f32(channel / f32(12.92))
    : f32(Math.pow(f32(add(channel, f32(.055)) / f32(1.055)), f32(2.4)));
}

function referenceCubeRoot(value) {
  return value < 0
    ? f32(-f32(Math.pow(f32(-value), f32(1 / 3))))
    : f32(Math.pow(value, f32(1 / 3)));
}

export function computeCardRgbColor(srgb) {
  const rgb = vector(srgb, 3, "sRGB");
  const linear = Array.from(rgb, referenceLinearChannel);
  const lms = [
    [.4121656119823456, .5362752079963684, .051457565277814865],
    [.2118591070175171, .6807189583778381, .10740657895803452],
    [.08830979466438293, .28184741735458374, .6302613615989685],
  ].map((row) => referenceCubeRoot(dot(row, linear)));
  // This coefficient set uses a positive third L coefficient and must not be
  // substituted for the usual Oklab matrix without verifying the producer.
  return Float32Array.from([
    [.21045425534248352, .7936177849769592, .004072046838700771],
    [1.9779984951019287, -2.4285922050476074, .4505937099456787],
    [.025904037058353424, .7827717661857605, -.8086757659912109],
  ].map((row) => dot(row, lms)));
}

export function computeCardRgbUniforms({ colors, defaults, uniforms }) {
  const values = {};
  for (const name of uniforms) {
    if (!/^_(Area[AB]Color|UIColor[RG])Oklab$/.test(name)) throw new Error(`unsupported RGB reference uniform ${name}`);
    const colorName = name.replace(/Oklab$/, "");
    const color = colors?.[colorName] ?? defaults?.[colorName];
    const rgb = Array.isArray(color) || ArrayBuffer.isView(color)
      ? Array.from(color).slice(0, 3) : [color?.r, color?.g, color?.b];
    values[name] = computeCardRgbColor(rgb);
  }
  return values;
}

function normalize(vectorValue) {
  const rounded = Array.from(vectorValue, f32);
  const length = f32(Math.sqrt(dot(rounded, rounded)));
  return length > f32(1e-5) ? rounded.map((x) => f32(x / length)) : [0, 0, 0];
}

export function createUvShadowState({ translateOffset, lightDir, localFront = [0, 0, -1], localRotation = [0, 0, 0, 1] }) {
  return {
    translateOffset: vector(translateOffset, 2, "translateOffset"),
    lightDir: vector(lightDir, 3, "lightDir"),
    localFront: vector(localFront, 3, "localFront"),
    localRotation: vector(localRotation, 4, "localRotation"),
    value: new Float32Array(2),
  };
}

export function updateUvShadow(state, threeQuaternion) {
  vector(threeQuaternion, 4, "threeQuaternion");
  const rotation = multiplyQuaternions(threeQuaternionToUnity(threeQuaternion), state.localRotation);
  const front = normalize(rotateVectorByQuaternion(state.localFront, rotation));
  const light = normalize(Array.from(state.lightDir, (x) => f32(-x)));
  const magnitude = dot(front, front);
  const projection = magnitude >= 1.401298464324817e-45 ? f32(dot(light, front) / magnitude) : 0;
  const tangentLight = light.map((x, index) => f32(x - mul(front[index], projection)));
  const local = rotateVectorByQuaternion(tangentLight, [-rotation[0], -rotation[1], -rotation[2], rotation[3]]);
  state.value[0] = add(f32(local[0]), state.translateOffset[0]);
  state.value[1] = add(f32(local[1]), state.translateOffset[1]);
  return state.value;
}

const RELIEF_CURVES = Object.freeze({
  _ChangeColor: "ChangeColorCurve",
  _LightColorIntensity: "LightColorIntensityCurve",
  _LightEmitIntensity: "LightEmitIntensityCurve",
  _LightPower: "LightPower",
  _ShadowDecay: "ShadowDecayCurve",
  _Switch: "EffSwitchColor",
  _AdditiveIntensity: "EffAdditiveIntensity",
  _FlashBlend: "EffColor3Blend",
  _EmissiveIntensity: "EffEmissiveIntensity",
});

function evaluateRelief(state, time) {
  for (const [uniform, name] of Object.entries(RELIEF_CURVES)) {
    state.values[uniform] = f32(evaluateKiraPuyoCurve(state.animationSettings.curves[name], time));
  }
}

export function createCardReliefState(config, animationSettings) {
  if (!config?.componentIdentity || !animationSettings?.curves
      || animationSettings.identity !== config.animationSettingsIdentity) {
    throw new TypeError("Relief card component/settings identity mismatch");
  }
  for (const field of ["animStartDegree", "animTimeScale", "animDuration"]) {
    if (!Number.isFinite(config[field])) throw new TypeError(`Relief ${field} must be finite`);
  }
  if (config.animTimeScale <= 0 || config.animDuration < 0) throw new RangeError("Invalid Relief animation timing");
  for (const name of Object.values(RELIEF_CURVES)) {
    const keys = animationSettings.curves[name]?.keys;
    if (!Array.isArray(keys) || keys.some((key) => !Number.isFinite(key.time) || !Number.isFinite(key.value))) {
      throw new Error(`Missing or invalid Relief curve ${name}`);
    }
  }
  const state = { config, animationSettings, shadow: createUvShadowState(config), values: {},
    playing: false, elapsedAnimationTime: 0, lastTiltDegree: 0, tiltDegree: 0, startTime: null };
  evaluateRelief(state, 0);
  return state;
}

export function updateCardRelief(state, { threeQuaternion, globalTime, deltaTime }) {
  if (!Number.isFinite(globalTime) || !Number.isFinite(deltaTime) || deltaTime < 0) {
    throw new TypeError("Relief card requires finite frame timing");
  }
  vector(threeQuaternion, 4, "threeQuaternion");
  if (state.startTime === null) state.startTime = f32(globalTime);
  const dt = f32(f32(globalTime) - state.startTime) > 0 ? f32(deltaTime) : 0;
  state.values._ShadowUVTranslate = updateUvShadow(state.shadow, threeQuaternion);
  const rotation = multiplyQuaternions(threeQuaternionToUnity(threeQuaternion), state.shadow.localRotation);
  const front = rotateVectorByQuaternion(state.shadow.localFront, rotation).map(f32);
  const length = f32(Math.sqrt(add(mul(front[0], front[0]), mul(front[1], front[1]))));
  state.tiltDegree = mul(f32(Math.atan2(length, f32(-front[2]))), f32(57.295780181884766));
  if (!state.playing && state.lastTiltDegree < f32(state.config.animStartDegree)
      && state.tiltDegree > f32(state.config.animStartDegree)) {
    state.elapsedAnimationTime = 0;
    state.playing = true;
  }
  if (state.playing) {
    state.elapsedAnimationTime = add(state.elapsedAnimationTime, dt);
    evaluateRelief(state, f32(state.elapsedAnimationTime / f32(state.config.animTimeScale)));
    state.playing = state.elapsedAnimationTime <= mul(f32(state.config.animDuration), f32(state.config.animTimeScale));
  }
  state.lastTiltDegree = state.tiltDegree;
  return state.values;
}
