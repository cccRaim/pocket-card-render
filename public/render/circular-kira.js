const DEG_PER_CIRCLE = 360;
const DEFAULT_ANGLES = [null, 50, 132, 35];

const clamp01 = (value) => Math.min(1, Math.max(0, value));
const f32 = Math.fround;
const fadd = (left, right) => f32(f32(left) + f32(right));
const fsub = (left, right) => f32(f32(left) - f32(right));
const fmul = (left, right) => f32(f32(left) * f32(right));
const fdiv = (left, right) => f32(f32(left) / f32(right));
const fpow = (base, exponent) => f32(Math.pow(f32(base), f32(exponent)));

function stableUnit(identity) {
  let hash = 2166136261;
  for (const char of identity) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 0x100000000;
}

// Unity exposes PerlinNoise1D through a native internal call. This deterministic gradient noise keeps
// the same input/range contract; it remains an explicit backend approximation until guest values are captured.
function perlinNoise1D(value) {
  const floor = Math.floor(value);
  const t = value - floor;
  const fade = t * t * t * (t * (t * 6 - 15) + 10);
  const gradient = (cell) => {
    let x = Math.imul(cell ^ 0x9e3779b9, 0x85ebca6b);
    x ^= x >>> 13;
    return (x & 1) ? -1 : 1;
  };
  const a = gradient(floor) * t;
  const b = gradient(floor + 1) * (t - 1);
  return clamp01((a + (b - a) * fade) * 0.5 + 0.5);
}

export function roundTiesToEvenF32(value) {
  const roundedInput = f32(value);
  const lower = Math.floor(roundedInput);
  const fraction = roundedInput - lower;
  if (fraction < 0.5) return lower;
  if (fraction > 0.5) return lower + 1;
  return lower % 2 === 0 ? lower : lower + 1;
}

export function circularTrailIndex(moveAngle, divideCount) {
  const shifted = fadd(moveAngle, DEG_PER_CIRCLE);
  const scaled = fmul(shifted, divideCount);
  return roundTiesToEvenF32(fdiv(scaled, DEG_PER_CIRCLE));
}

export function createCircularKiraState(componentIdentity, config) {
  const primitives = config.primitives.map((primitive) => ({
    ...primitive,
    speed: 0,
    angle: primitive.startAngle,
    brakeGoalAngle: 0,
    brakeStartAngle: 0,
    brakingTime: 0,
    speedAtBrakeStart: 0,
  }));
  const count = primitives.length;
  const defaultCircularAngle = DEFAULT_ANGLES[config.defaultCircularAnglePattern]
    ?? config.defaultCircularAngleManual;
  const state = {
    componentIdentity,
    config,
    primitives,
    defaultCircularAngle,
    tilt: 0,
    tiltState: false,
    tiltChangeElapsedTime: 0,
    speedState: 0,
    time: 0,
    moveAngle: 0,
    morphingAnimOffset: stableUnit(componentIdentity) * 10000,
    primAngles: new Float32Array(20),
    primBaseScales: new Float32Array(20),
    primBaseIntensities: new Float32Array(20),
    primMinIntensities: new Float32Array(20),
    primMaxIntensities: new Float32Array(20),
    primFlickerScaling: new Float32Array(20),
    primFlickerAnimOffsets: new Float32Array(20),
    primTypes: new Int32Array(20),
    primMorphing: new Float32Array(20),
    brightnesses: new Float32Array(config.meshDivideCount),
    tempBrightnesses: new Float32Array(config.meshDivideCount * 2),
    lastTrailIndex: null,
    expandBrightnessCap: 0,
    materials: new Set(),
    meshesByRole: new Map(),
    componentTransform: null,
    runtimeBoundary: {
      perlinNoise1D: "backend-approximation",
      randomInitialOffset: "distribution-equivalent-deterministic-seed",
    },
  };
  for (let index = 0; index < count; index++) {
    const primitive = primitives[index];
    state.primAngles[index] = primitive.startAngle;
    state.primBaseScales[index] = primitive.baseScale;
    state.primBaseIntensities[index] = primitive.baseIntensity;
    state.primMinIntensities[index] = primitive.minIntensity;
    state.primMaxIntensities[index] = primitive.maxIntensity;
    state.primFlickerScaling[index] = primitive.flickerScaling;
    state.primTypes[index] = primitive.primType;
  }
  return state;
}

export function bindCircularKiraMesh(state, role, mesh) {
  if (!["movingA", "movingB", "trailA", "trailB"].includes(role)) {
    throw new Error(`CircularKiraObject has an unknown renderer role ${role}`);
  }
  if (role.startsWith("trail")) {
    const uv = mesh?.geometry?.getAttribute?.("uv");
    const expectedCount = state.brightnesses.length * 2 + 2;
    if (!uv || uv.count !== expectedCount) {
      throw new Error(`${role}: CircularKira trail UV count must be ${expectedCount}`);
    }
  }
  if (!state.meshesByRole.has(role)) state.meshesByRole.set(role, new Set());
  state.meshesByRole.get(role).add(mesh);
}

export function finalizeCircularKiraBindings(state, componentTransform) {
  for (const role of ["movingA", "movingB", "trailA", "trailB"]) {
    if (!state.meshesByRole.get(role)?.size) {
      throw new Error(`CircularKiraObject is missing renderer role ${role}`);
    }
  }
  if (!componentTransform?.isObject3D) {
    throw new Error("CircularKiraObject component transform is missing");
  }
  state.componentTransform = componentTransform;
}

function symmetryCount(config, primType) {
  if (primType === 0) return config.primTypeASymmetryCount;
  if (primType === 1) return config.primTypeBSymmetryCount;
  if (primType === 2) return config.primTypeCSymmetryCount;
  return 1;
}

function resetBrakeParams(state) {
  for (const primitive of state.primitives) {
    primitive.brakeGoalAngle = 0;
    primitive.brakeStartAngle = 0;
    primitive.brakingTime = 0;
    primitive.speedAtBrakeStart = 0;
  }
}

function calculateBrakeTiming(state) {
  const radiansPerDegree = Math.PI / 180;
  for (const primitive of state.primitives) {
    primitive.speedAtBrakeStart = primitive.speed;
    const step = DEG_PER_CIRCLE / symmetryCount(state.config, primitive.primType);
    const remainder = ((primitive.angle - primitive.startAngle) % step + step) % step;
    let goal = primitive.angle + (step - remainder);
    const minimumTravel = primitive.speed * state.config.brakeDuration * Math.PI * 0.25;
    while (goal - primitive.angle < minimumTravel) goal += step;
    primitive.brakeGoalAngle = goal;
    primitive.brakeStartAngle = goal - minimumTravel;
  }
}

function updateTilt(state, worldFront, deltaTime) {
  const radial = Math.hypot(worldFront[0], worldFront[1]);
  const angle = Math.atan2(radial, worldFront[2]);
  state.tilt = clamp01(Math.pow(Math.sin(angle * 3), state.config.tiltPower));
  const nextTiltState = state.tilt > state.config.tiltThreshold;
  if (nextTiltState !== state.tiltState) {
    state.tiltChangeElapsedTime += deltaTime;
    if (state.tiltChangeElapsedTime > state.config.tiltStateChangeDelay) {
      state.tiltState = nextTiltState;
      state.tiltChangeElapsedTime = 0;
    }
  } else {
    state.tiltChangeElapsedTime = 0;
  }
}

function updateParticles(state, deltaTime) {
  const { config, primitives } = state;
  if (state.speedState === 2) {
    for (const primitive of primitives) {
      if (primitive.angle >= primitive.brakeGoalAngle) {
        primitive.speed = 0;
        primitive.angle = primitive.brakeGoalAngle;
      } else if (primitive.angle >= primitive.brakeStartAngle) {
        const brakingTime = f32(primitive.brakingTime);
        const progress = clamp01(fdiv(brakingTime, config.brakeDuration));
        primitive.speed = Math.max(
          fmul(Math.sin(Math.acos(fsub(0, progress))), primitive.speedAtBrakeStart),
          0.05,
        );
        primitive.brakingTime = fadd(brakingTime, deltaTime);
      }
    }
    if (state.tiltState) {
      state.speedState = 1;
      resetBrakeParams(state);
    }
  } else if (state.speedState === 1) {
    for (const primitive of primitives) {
      primitive.speed = Math.min(
        primitive.maxRotateSpeed,
        Math.max(0, primitive.speed + primitive.maxRotateSpeed * config.rotateAccel * deltaTime),
      );
    }
    if (!state.tiltState) {
      state.speedState = 2;
      calculateBrakeTiming(state);
    }
  } else if (state.tiltState) {
    state.speedState = 1;
    resetBrakeParams(state);
  }

  state.morphingAnimOffset += deltaTime;
  for (let index = 0; index < primitives.length; index++) {
    const primitive = primitives[index];
    state.primFlickerAnimOffsets[index] += deltaTime * primitive.flickerSpeed;
    primitive.angle += primitive.speed * deltaTime;
    state.primAngles[index] = primitive.reverseRotation ? -primitive.angle : primitive.angle;
    if (!primitive.useMorphing) continue;
    const phase = state.morphingAnimOffset * primitive.morphingSpeed;
    const wave = primitive.useMorphingNoise ? perlinNoise1D(phase) : Math.sin(phase);
    const shape = clamp01((wave - 0.5) * primitive.morphingClearly + 0.5);
    state.primMorphing[index] = shape * clamp01(primitive.speed / primitive.maxRotateSpeed);
  }
}

export function updateCircularKiraTrail(state, deltaTime) {
  const { config, tempBrightnesses, brightnesses } = state;
  const index = circularTrailIndex(state.moveAngle, config.meshDivideCount);
  const previousIndex = state.lastTrailIndex ?? index;
  const start = Math.min(index, previousIndex);
  const end = Math.max(index, previousIndex);
  const endpoints = new Int32Array(2);
  let endpointCount = 0;
  let previousBrightness = f32(0);
  state.expandBrightnessCap = f32(state.tilt);

  for (let position = 0; position < tempBrightnesses.length; position++) {
    const distance = Math.abs(position - index);
    let value = f32(tempBrightnesses[position]);
    if (position >= start && position <= end) {
      value = f32(config.centerIntensity);
    } else if (distance <= config.expandLength) {
      const ratio = clamp01(fdiv(distance, config.expandLength));
      const center = fmul(config.centerIntensity, state.expandBrightnessCap);
      const expanded = fpow(fadd(center, fmul(ratio, fsub(0, center))), config.expandPower);
      value = value > expanded ? value : expanded;
    }
    tempBrightnesses[position] = value;

    if (config.useLengthLimit && endpointCount <= 1) {
      if (position === 0 || position === tempBrightnesses.length - 1) {
        if (value > 0) endpoints[endpointCount++] = position;
      } else if (value === 0 && previousBrightness !== 0) {
        endpoints[endpointCount++] = position - 1;
      } else if (value !== 0 && previousBrightness === 0) {
        endpoints[endpointCount++] = position;
      }
      previousBrightness = value;
    }

    let fade = f32(config.fadeOut);
    if (config.useDistanceFadeOut) {
      const halfDenominator = fmul(config.limitLengthRatio, brightnesses.length);
      const denominator = fadd(halfDenominator, halfDenominator);
      const distanceCurve = fpow(fdiv(distance, denominator), config.distanceFadeOutCurvePower);
      fade = fmul(fade, fadd(1, fmul(config.distanceFadeOutSpeed, distanceCurve)));
    }
    tempBrightnesses[position] = value >= f32(config.fadeOutEnd)
      ? fsub(value, fmul(fade, deltaTime))
      : 0;
  }

  if (config.useLengthLimit) {
    const limit = Math.trunc(fmul(config.limitLengthRatio, brightnesses.length));
    let activeLength = endpoints[1] - endpoints[0] + 1;
    while (activeLength > limit) {
      const startValue = f32(tempBrightnesses[endpoints[0]]);
      const endValue = f32(tempBrightnesses[endpoints[1]]);
      const shrinkEnd = startValue >= endValue;
      const selectedPosition = endpoints[shrinkEnd ? 1 : 0];
      const selectedValue = f32(tempBrightnesses[selectedPosition]);
      if (shrinkEnd) endpoints[1] -= 1;
      else endpoints[0] += 1;
      activeLength -= 1;
      const speed = f32(config.limitAdjustSpeed);
      const retained = fmul(selectedValue, fsub(1, speed));
      const removed = fmul(speed, Math.min(selectedValue, 0));
      tempBrightnesses[selectedPosition] = fadd(retained, removed);
    }
    activeLength = Math.min(activeLength, limit);

    if (activeLength >= 1) {
      for (let offset = 0; offset < activeLength; offset++) {
        const position = endpoints[0] + offset;
        if (position < 0 || position >= tempBrightnesses.length) {
          throw new Error(`CircularKira active trail index ${position} is out of range`);
        }
        const distance = Math.abs(index - position);
        const denominator = index > position
          ? index - endpoints[0]
          : endpoints[1] - index;
        const curve = fpow(fdiv(distance, denominator), config.limitAdjustCurvePower);
        const cap = fmul(config.centerIntensity, fsub(1, curve));
        const value = f32(tempBrightnesses[position]);
        const target = value < cap ? value : cap;
        const speed = f32(config.limitAdjustSpeed);
        tempBrightnesses[position] = fadd(
          fmul(value, fsub(1, speed)),
          fmul(speed, target),
        );
      }
    }
  }
  for (let i = 0; i < brightnesses.length; i++) {
    const first = f32(tempBrightnesses[i]);
    const second = f32(tempBrightnesses[i + brightnesses.length]);
    brightnesses[i] = first > second ? first : second;
  }
  state.lastTrailIndex = index;
}

function applyTrailUvs(state) {
  for (const role of ["trailA", "trailB"]) {
    for (const mesh of state.meshesByRole.get(role) || []) {
      const uv = mesh.geometry.getAttribute("uv");
      if (!uv || uv.count !== state.brightnesses.length * 2 + 2) {
        throw new Error(`${role}: CircularKira trail UV topology drifted after binding`);
      }
      for (let i = 0; i < state.brightnesses.length; i++) {
        const value = state.brightnesses[i];
        const first = uv.count - 2 - i * 2;
        uv.setY(first, value);
        uv.setY(first + 1, value);
      }
      if (uv.count > 3) {
        uv.setY(0, uv.getY(3));
        uv.setY(1, uv.getY(uv.count - 1));
        uv.setY(2, uv.getY(uv.count - 1));
      }
      uv.needsUpdate = true;
    }
  }
}

export function updateCircularKira(state, worldFront, deltaTime) {
  if (state.config.isAnimationStopped) return state;
  state.time += deltaTime;
  updateTilt(state, worldFront, deltaTime);
  state.moveAngle = -(
    ((worldFront[0] * 0.5 + 0.5) * 0.5)
    + ((worldFront[1] * 0.5 + 0.5) * 0.5)
    - 0.5
  ) * state.config.moveAngleScale;
  updateParticles(state, deltaTime);
  updateCircularKiraTrail(state, deltaTime);
  applyTrailUvs(state);

  for (const material of state.materials) {
    const uniforms = material.uniforms;
    if (uniforms._Tilt) uniforms._Tilt.value = state.tilt;
    if (uniforms._CircularDefaultAngle) uniforms._CircularDefaultAngle.value = state.defaultCircularAngle;
    if (uniforms._MoveAngle) uniforms._MoveAngle.value = state.moveAngle;
    if (uniforms._NoiseTime) uniforms._NoiseTime.value = state.time * 2;
  }
  return state;
}
