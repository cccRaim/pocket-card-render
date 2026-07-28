import { evaluateKiraPuyoCurve } from "./kira-puyo.js";
import {
  normalizeQuaternion,
  rotateVectorByQuaternion,
  threeQuaternionToUnity,
} from "./official-touch-rotation.js";

export const CARD_MARBLE_PRODUCER_SCHEMA =
  "pocket-card-render/card-marble-layer-arm64-state-port@1";

const LOCAL_FRONT = Object.freeze([0, 0, -1]);
const RAD_TO_DEG = Math.fround(180 / Math.PI);
const DEG_TO_RAD = Math.fround(Math.PI / 180);
const f32 = Math.fround;

function requireFinite(value, field) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    throw new TypeError(`CardMarbleLayer.${field} must be finite`);
  }
  return numeric;
}

function requireIdentity(value, field) {
  const identity = String(value || "");
  if (!identity.includes(":")) {
    throw new TypeError(`CardMarbleLayer.${field} must be an official identity`);
  }
  return identity;
}

function requireVector2(value, field) {
  return Object.freeze([
    requireFinite(value?.x, `${field}.x`),
    requireFinite(value?.y, `${field}.y`),
  ]);
}

function requireCurve(curve, field) {
  if (!curve || !Array.isArray(curve.keys) || curve.keys.length < 2) {
    throw new TypeError(`CardMarbleLayer.${field} is incomplete`);
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

export function validateCardMarbleConfig(config) {
  if (!config || typeof config !== "object") {
    throw new TypeError("CardMarbleLayer config is required");
  }
  const scalarFields = [
    "tiltPower", "delayTime2", "pointAccel", "shearAccel",
    "dorodoroDistance", "resistancePower", "minDorodoroCoef",
    "maxPointSpeed", "minPointSpeed", "goalThreshold",
    "pointMoveByTilt", "pointForceChangeByTilt",
  ];
  const remap = config.defaultNoiseRemapSettings || {};
  const resolution = requireFinite(remap.resolution, "defaultNoiseRemapSettings.resolution");
  const points = (config.points || []).map((point, index) => Object.freeze({
    defaultPosition: requireVector2(point?.defaultPosition, `points[${index}].defaultPosition`),
    tiltMovePosition: requireVector2(point?.tiltMovePosition, `points[${index}].tiltMovePosition`),
    rotationWithTilt: requireFinite(point?.rotationWithTilt, `points[${index}].rotationWithTilt`),
    defaultForce: requireFinite(point?.defaultForce, `points[${index}].defaultForce`),
    tiltForce: requireFinite(point?.tiltForce, `points[${index}].tiltForce`),
  }));
  const normalized = {
    componentIdentity: requireIdentity(config.componentIdentity, "componentIdentity"),
    componentGoIdentity: requireIdentity(config.componentGoIdentity, "componentGoIdentity"),
    componentGoPath: String(config.componentGoPath || ""),
    scriptIdentity: requireIdentity(config.scriptIdentity, "scriptIdentity"),
    rendererBindings: Object.freeze([...(config.rendererBindings || [])]),
    useMarbleDelay: Number(config.useMarbleDelay),
    points: Object.freeze(points),
    defaultNoiseRemapSettings: Object.freeze({
      curveLabel: String(remap.curveLabel || ""),
      resolution,
      defaultRemapCurve: requireCurve(
        remap.defaultRemapCurve,
        "defaultNoiseRemapSettings.defaultRemapCurve",
      ),
      tiltRemapCurve: requireCurve(
        remap.tiltRemapCurve,
        "defaultNoiseRemapSettings.tiltRemapCurve",
      ),
      remapRemapCurve: requireCurve(
        remap.remapRemapCurve,
        "defaultNoiseRemapSettings.remapRemapCurve",
      ),
    }),
    ...Object.fromEntries(scalarFields.map((field) => [
      field,
      requireFinite(config[field], field),
    ])),
  };
  if (!normalized.componentGoPath
      || normalized.rendererBindings.length === 0
      || normalized.rendererBindings.some((identity) =>
        typeof identity !== "string" || !identity.includes(":"))
      || ![0, 1].includes(normalized.useMarbleDelay)
      || normalized.points.length < 1
      || normalized.points.length > 4
      || !Number.isInteger(resolution)
      || resolution < 1
      || resolution > 12
      || normalized.defaultNoiseRemapSettings.curveLabel
        !== "_DefaultNoiseRemapCurveTexture") {
    throw new Error("CardMarbleLayer identity/binding contract is incomplete");
  }
  return Object.freeze(normalized);
}

function normalizeVector3(vector) {
  const length = f32(Math.hypot(vector[0], vector[1], vector[2]));
  if (!(length > 0)) return [0, 0, 0];
  return vector.map((value) => f32(f32(value) / length));
}

function rotate2(vector, radians) {
  const cosine = f32(Math.cos(f32(radians)));
  const sine = f32(Math.sin(f32(radians)));
  return [
    f32(f32(vector[0] * cosine) - f32(vector[1] * sine)),
    f32(f32(vector[0] * sine) + f32(vector[1] * cosine)),
  ];
}

function updatePointGoals(state, goalTilt) {
  const directionDegrees = f32(
    f32(Math.atan2(f32(goalTilt[1]), f32(goalTilt[0]))) * RAD_TO_DEG,
  );
  for (const point of state.points) {
    const radians = f32(
      f32(directionDegrees * f32(point.rotationWithTilt)) * DEG_TO_RAD,
    );
    const rotated = rotate2(point.tiltMovePosition, radians);
    point.goalPosition[0] = f32(
      point.defaultPosition[0]
        + f32(f32(rotated[0] * f32(goalTilt[2])) * f32(state.config.pointMoveByTilt)),
    );
    point.goalPosition[1] = f32(
      point.defaultPosition[1]
        + f32(f32(rotated[1] * f32(goalTilt[2])) * f32(state.config.pointMoveByTilt)),
    );
    point.goalPosition[2] = f32(
      point.defaultForce
        + f32(f32(f32(goalTilt[2]) * f32(point.tiltForce))
          * f32(state.config.pointForceChangeByTilt)),
    );
  }
}

function vectorLength(vector) {
  return f32(Math.hypot(vector[0], vector[1], vector[2]));
}

function updatePosition(state, accel, speed, currentPosition, goalPosition) {
  const difference = [
    f32(goalPosition[0] - currentPosition[0]),
    f32(goalPosition[1] - currentPosition[1]),
    f32(goalPosition[2] - currentPosition[2]),
  ];
  const distance = vectorLength(difference);
  if (distance < f32(state.config.goalThreshold)) {
    speed.fill(0);
    return;
  }
  const direction = distance > f32(0)
    ? difference.map((value) => f32(value / distance))
    : [0, 0, 0];
  for (let index = 0; index < 3; index += 1) {
    speed[index] = f32(
      speed[index]
        + f32(f32(direction[index] * f32(accel)) * f32(state.deltaTime)),
    );
  }
  if (distance <= f32(state.config.dorodoroDistance)) {
    const normalizedDistance = f32(distance / f32(state.config.dorodoroDistance));
    const resistance = f32(
      1 - Math.pow(
        f32(1 - normalizedDistance),
        f32(state.config.resistancePower),
      ),
    );
    const coefficient = f32(
      f32(state.config.minDorodoroCoef)
        + f32(resistance * f32(1 - f32(state.config.minDorodoroCoef))),
    );
    for (let index = 0; index < 3; index += 1) {
      speed[index] = f32(speed[index] * coefficient);
    }
  }
  const speedLength = vectorLength(speed);
  if (speedLength > f32(state.config.maxPointSpeed)) {
    const scale = f32(f32(state.config.maxPointSpeed) / speedLength);
    for (let index = 0; index < 3; index += 1) {
      speed[index] = f32(speed[index] * scale);
    }
  } else if (speedLength < f32(state.config.minPointSpeed)) {
    for (let index = 0; index < 3; index += 1) {
      speed[index] = f32(direction[index] * f32(state.config.minPointSpeed));
    }
  }
  for (let index = 0; index < 3; index += 1) {
    currentPosition[index] = f32(
      currentPosition[index] + f32(speed[index] * f32(state.deltaTime)),
    );
  }
}

function updateTilt(state, threeQuaternion) {
  const unityQuaternion = normalizeQuaternion(
    threeQuaternionToUnity(threeQuaternion),
  );
  state.worldFront = normalizeVector3(
    rotateVectorByQuaternion(LOCAL_FRONT, unityQuaternion),
  );
  const planarLength = f32(Math.hypot(state.worldFront[0], state.worldFront[1]));
  const polarAngle = f32(Math.atan2(planarLength, state.worldFront[2]));
  state.tilt = Math.max(0, Math.min(1, f32(
    f32(Math.sin(f32(polarAngle * f32(3)))) * f32(state.config.tiltPower),
  )));

  if (state.config.useMarbleDelay) {
    state.tiltQueue.push([
      state.worldFront[0],
      state.worldFront[1],
      state.tilt,
      state.elapsedTime,
    ]);
    let changed = false;
    while (state.tiltQueue.length > 0
        && f32(state.elapsedTime - state.tiltQueue[0][3])
          > f32(state.config.delayTime2)) {
      const delayed = state.tiltQueue.shift();
      state.goalTilt.set(delayed.slice(0, 3));
      changed = true;
    }
    if (changed) updatePointGoals(state, state.goalTilt);
  }

  state.tiltRotation = f32(
    f32(f32(Math.atan2(state.worldFront[1], state.worldFront[0])) / f32(Math.PI)
      + f32(1)) * f32(0.5),
  );
}

function updateMarble(state) {
  if (!state.config.useMarbleDelay) return;
  for (const point of state.points) {
    updatePosition(
      state,
      state.config.pointAccel,
      point.speed,
      point.currentPosition,
      point.goalPosition,
    );
  }
  updatePosition(
    state,
    state.config.shearAccel,
    state.tiltSpeed,
    state.currentTilt,
    state.goalTilt,
  );
}

function writeAttributes(state) {
  state.attributes.fill(0);
  for (let index = 0; index < state.points.length; index += 1) {
    state.attributes.set(state.points[index].currentPosition, index * 4);
  }
}

export function createCardMarbleCurveSamples(config) {
  const normalized = validateCardMarbleConfig(config);
  const settings = normalized.defaultNoiseRemapSettings;
  const size = 2 ** settings.resolution;
  const values = new Float32Array(size * size);
  for (let y = 0; y < size; y += 1) {
    const blend = Math.max(0, Math.min(1, evaluateKiraPuyoCurve(
      settings.remapRemapCurve,
      f32(y / size),
    )));
    for (let x = 0; x < size; x += 1) {
      const time = f32(x / size);
      const defaultValue = evaluateKiraPuyoCurve(settings.defaultRemapCurve, time);
      const tiltValue = evaluateKiraPuyoCurve(settings.tiltRemapCurve, time);
      values[y * size + x] = f32(
        defaultValue + f32(blend * f32(tiltValue - defaultValue)),
      );
    }
  }
  return { size, values };
}

export function createCardMarbleState(config) {
  const normalized = validateCardMarbleConfig(config);
  const points = normalized.points.map((point) => {
    const currentPosition = new Float32Array([
      point.defaultPosition[0],
      point.defaultPosition[1],
      point.defaultForce,
    ]);
    return {
      ...point,
      currentPosition,
      goalPosition: currentPosition.slice(),
      speed: new Float32Array(3),
    };
  });
  const state = {
    schema: CARD_MARBLE_PRODUCER_SCHEMA,
    config: normalized,
    elapsedTime: f32(0),
    deltaTime: f32(0),
    points,
    attributes: new Float32Array(points.length * 4),
    tilt: f32(0),
    tiltRotation: f32(0.5),
    worldFront: [0, 0, -1],
    currentTilt: new Float32Array(3),
    goalTilt: new Float32Array(3),
    tiltSpeed: new Float32Array(3),
    tiltQueue: [],
    frameCount: 0,
  };
  writeAttributes(state);
  return state;
}

export function updateCardMarble(state, {
  threeQuaternion,
  deltaTime,
}) {
  if (state?.schema !== CARD_MARBLE_PRODUCER_SCHEMA) {
    throw new TypeError("invalid CardMarbleLayer state");
  }
  const dt = requireFinite(deltaTime, "deltaTime");
  if (dt < 0) throw new RangeError("CardMarbleLayer.deltaTime must be >= 0");
  state.deltaTime = f32(dt);
  state.elapsedTime = f32(state.elapsedTime + state.deltaTime);
  updateTilt(state, threeQuaternion);
  updateMarble(state);
  writeAttributes(state);
  state.frameCount += 1;
  return {
    attributes: state.attributes,
    front: state.currentTilt,
    pointCount: state.points.length,
    tilt: state.tilt,
    tiltRotation: state.tiltRotation,
    worldFront: state.worldFront,
    frameCount: state.frameCount,
    schedulerBoundary: "Unity FixedUpdate cadence is adapted to the browser frame clock",
  };
}
