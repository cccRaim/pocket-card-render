// Pure-JS port of Lettuce.Infrastructure.Asset3D.Core.TouchStateRotation.
// Values and operation order are pinned by build/audit-official-touch-rotation.mjs.

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const IDENTITY = Object.freeze([0, 0, 0, 1]);

export const OFFICIAL_TOUCH_ROTATION_EVIDENCE = Object.freeze({
  maxRotationDegrees: 30,
  radToDeg: Math.fround(180 / Math.PI),
  normalize: "local / half RectTransform extent, clamped to [-1, 1]",
  angleDelta: "acos(current) - acos(previous)",
  axes: Object.freeze({ y: Object.freeze([0, 1, 0]), x: Object.freeze([-1, 0, 0]) }),
  dragComposition: "qY * qX",
  frameComposition: "currentLocalRotation * dragDelta",
  clampOperation: "SlerpUnclamped(identity, candidate, min(30 / angle, 1))",
});

export const OFFICIAL_MAX_ROTATION_DEGREES = OFFICIAL_TOUCH_ROTATION_EVIDENCE.maxRotationDegrees;

export function multiplyQuaternions(a, b) {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

export function normalizeQuaternion(q) {
  const length = Math.hypot(q[0], q[1], q[2], q[3]);
  if (!(length > 0) || !Number.isFinite(length)) return [...IDENTITY];
  return q.map((value) => value / length);
}

export function angleAxisRadians(angle, axis) {
  const axisLength = Math.hypot(axis[0], axis[1], axis[2]);
  if (!(axisLength > 0) || !Number.isFinite(angle)) return [...IDENTITY];
  const scale = Math.sin(angle * 0.5) / axisLength;
  return normalizeQuaternion([
    axis[0] * scale,
    axis[1] * scale,
    axis[2] * scale,
    Math.cos(angle * 0.5),
  ]);
}

export function rotateVectorByQuaternion(vector, quaternion) {
  const [x, y, z, w] = normalizeQuaternion(quaternion);
  const [vx, vy, vz] = vector;
  const tx = 2 * (y * vz - z * vy);
  const ty = 2 * (z * vx - x * vz);
  const tz = 2 * (x * vy - y * vx);
  return [
    vx + w * tx + (y * tz - z * ty),
    vy + w * ty + (z * tx - x * tz),
    vz + w * tz + (x * ty - y * tx),
  ];
}

// Unity Quaternion.Euler uses ZXY order. These are the stable, non-gimbal
// branches used inside the official 30-degree clamp.
export function quaternionToUnityEulerRadians(quaternion) {
  const [x, y, z, w] = normalizeQuaternion(quaternion);
  const m12 = 2 * (y * z - w * x);
  const m02 = 2 * (x * z + w * y);
  const m22 = 1 - 2 * (x * x + y * y);
  const m10 = 2 * (x * y + w * z);
  const m11 = 1 - 2 * (x * x + z * z);
  return [
    Math.asin(clamp(-m12, -1, 1)),
    Math.atan2(m02, m22),
    Math.atan2(m10, m11),
  ];
}

function rebuildWithoutUnityRoll(quaternion) {
  const [x, y] = quaternionToUnityEulerRadians(quaternion);
  const qY = angleAxisRadians(y, OFFICIAL_TOUCH_ROTATION_EVIDENCE.axes.y);
  const qX = angleAxisRadians(x, [1, 0, 0]);
  return normalizeQuaternion(multiplyQuaternions(qY, qX));
}

export function quaternionAngleDegrees(a, b) {
  const qa = normalizeQuaternion(a);
  const qb = normalizeQuaternion(b);
  const dot = Math.abs(qa[0] * qb[0] + qa[1] * qb[1] + qa[2] * qb[2] + qa[3] * qb[3]);
  return 2 * Math.acos(clamp(dot, -1, 1)) * OFFICIAL_TOUCH_ROTATION_EVIDENCE.radToDeg;
}

export function slerpUnclamped(a, b, t) {
  const qa = normalizeQuaternion(a);
  let qb = normalizeQuaternion(b);
  let dot = qa[0] * qb[0] + qa[1] * qb[1] + qa[2] * qb[2] + qa[3] * qb[3];
  if (dot < 0) {
    qb = qb.map((value) => -value);
    dot = -dot;
  }
  dot = clamp(dot, -1, 1);
  if (dot === 1) return qa;
  const angle = Math.acos(dot);
  const sinAngle = Math.sin(angle);
  const aScale = Math.sin((1 - t) * angle) / sinAngle;
  const bScale = Math.sin(t * angle) / sinAngle;
  return normalizeQuaternion(qa.map((value, index) => value * aScale + qb[index] * bScale));
}

export function screenPointToNormalizedLocal(clientX, clientY, rect) {
  if (!(rect?.width > 0) || !(rect?.height > 0)) throw new RangeError("rect must have positive width and height");
  return [
    clamp((clientX - rect.left) / (rect.width * 0.5) - 1, -1, 1),
    clamp(1 - (clientY - rect.top) / (rect.height * 0.5), -1, 1),
  ];
}

function normalizedPoint(point) {
  if (!Array.isArray(point) || point.length < 2 || !point.slice(0, 2).every(Number.isFinite)) {
    throw new TypeError("point must be a finite [x, y]");
  }
  return [clamp(point[0], -1, 1), clamp(point[1], -1, 1)];
}

export function createOfficialTouchRotationState({
  maxRotationDegrees = OFFICIAL_MAX_ROTATION_DEGREES,
} = {}) {
  if (!(maxRotationDegrees > 0) || !Number.isFinite(maxRotationDegrees)) {
    throw new RangeError("maxRotationDegrees must be positive and finite");
  }
  return {
    maxRotationDegrees,
    rotation: [...IDENTITY],
    pendingRotation: [...IDENTITY],
    hasPendingRotation: false,
    previousPoint: null,
    dragging: false,
    pointerId: null,
  };
}

export function beginOfficialTouchDrag(state, point, pointerId = 0) {
  if (state.dragging && state.pointerId !== pointerId) return false;
  state.dragging = true;
  state.pointerId = pointerId;
  state.previousPoint = normalizedPoint(point);
  state.pendingRotation = [...IDENTITY];
  state.hasPendingRotation = false;
  return true;
}

export function dragOfficialTouchRotation(state, point, pointerId = state.pointerId) {
  if (!state.dragging || state.pointerId !== pointerId || !state.previousPoint) return false;
  const current = normalizedPoint(point);
  const xDelta = Math.acos(current[0]) - Math.acos(state.previousPoint[0]);
  const yDelta = Math.acos(current[1]) - Math.acos(state.previousPoint[1]);
  const qY = angleAxisRadians(xDelta, OFFICIAL_TOUCH_ROTATION_EVIDENCE.axes.y);
  const qX = angleAxisRadians(yDelta, OFFICIAL_TOUCH_ROTATION_EVIDENCE.axes.x);
  const dragDelta = multiplyQuaternions(qY, qX);
  state.pendingRotation = normalizeQuaternion(multiplyQuaternions(state.pendingRotation, dragDelta));
  state.hasPendingRotation = true;
  state.previousPoint = current;
  return true;
}

export function updateOfficialTouchRotation(state) {
  if (!state.hasPendingRotation) return [...state.rotation];
  const candidate = rebuildWithoutUnityRoll(
    multiplyQuaternions(state.rotation, state.pendingRotation),
  );
  const angle = quaternionAngleDegrees(IDENTITY, candidate);
  const factor = angle > 0 ? Math.min(state.maxRotationDegrees / angle, 1) : 1;
  state.rotation = slerpUnclamped(IDENTITY, candidate, factor);
  state.pendingRotation = [...IDENTITY];
  state.hasPendingRotation = false;
  return [...state.rotation];
}

export function endOfficialTouchDrag(state, pointerId = state.pointerId) {
  if (!state.dragging || state.pointerId !== pointerId) return false;
  state.dragging = false;
  state.pointerId = null;
  state.previousPoint = null;
  return true;
}

export function setAbsolutePointerTilt(state, point) {
  const absolute = normalizedPoint(point);
  const maxRadians = state.maxRotationDegrees * Math.PI / 180;
  // OnDrag consumes differences of acos(screenPoint). Feeding an absolute
  // [-1, 1] pointer directly into that incremental formula reaches 30 degrees
  // at x=0.5. Use the inverse domain so center-to-edge maps linearly to the
  // official rotation limit while preserving the official qY*qX/clamp path.
  const virtualDragPoint = absolute.map((value) => Math.sin(value * maxRadians));
  state.rotation = [...IDENTITY];
  state.pendingRotation = [...IDENTITY];
  state.hasPendingRotation = false;
  beginOfficialTouchDrag(state, [0, 0], "debug");
  dragOfficialTouchRotation(state, virtualDragPoint, "debug");
  const rotation = updateOfficialTouchRotation(state);
  endOfficialTouchDrag(state, "debug");
  return rotation;
}

// Backward-compatible automation entry point. It intentionally shares the
// desktop absolute-pointer adapter rather than a second rotation formula.
export const setOfficialDebugTilt = setAbsolutePointerTilt;

// C = diag(1, 1, -1). Quaternion axes are pseudovectors, so
// R_three = C * R_unity * C maps (x, y, z, w) to (-x, -y, z, w).
export function unityQuaternionToThree(quaternion) {
  const [x, y, z, w] = normalizeQuaternion(quaternion);
  return [-x, -y, z, w];
}

// C * R * C is an involution, so the inverse runtime-basis conversion has
// the same component mapping. Keep the direction explicit at call sites.
export function threeQuaternionToUnity(quaternion) {
  const [x, y, z, w] = normalizeQuaternion(quaternion);
  return [-x, -y, z, w];
}
