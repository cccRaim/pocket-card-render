import assert from "node:assert/strict";
import * as THREE from "three";
import { threeWorldForwardToUnity } from "../public/render/glitter-flow.js";
import {
  OFFICIAL_MAX_ROTATION_DEGREES,
  angleAxisRadians,
  beginOfficialTouchDrag,
  createOfficialTouchRotationState,
  dragOfficialTouchRotation,
  endOfficialTouchDrag,
  multiplyQuaternions,
  quaternionAngleDegrees,
  quaternionToUnityEulerRadians,
  rotateVectorByQuaternion,
  screenPointToNormalizedLocal,
  setAbsolutePointerTilt,
  setOfficialDebugTilt,
  unityQuaternionToThree,
  updateOfficialTouchRotation,
} from "../public/render/official-touch-rotation.js";

const close = (actual, expected, epsilon = 1e-9) => {
  assert.ok(Math.abs(actual - expected) <= epsilon, `expected ${expected}, got ${actual}`);
};
const closeArray = (actual, expected, epsilon = 1e-9) => {
  assert.equal(actual.length, expected.length);
  actual.forEach((value, index) => close(value, expected[index], epsilon));
};
const closeMatrix = (actual, expected, epsilon = 1e-8) => {
  closeArray(actual.elements, expected.elements, epsilon);
};

const ASSET_EXPORT_BASIS = new THREE.Matrix4().makeScale(-1, 1, 1);
const RUNTIME_BASIS = new THREE.Matrix4().makeScale(1, 1, -1);
const OFFICIAL_FACE_PARENT = new THREE.Matrix4().makeRotationY(Math.PI);

// AssetRipper converts each serialized Unity Transform through A=diag(-1,1,1).
// The normal card face then adds the official Ry(180) parent, so P*A=C, where
// C=diag(1,1,-1) is the runtime Unity-world -> Three-world boundary.
closeMatrix(
  OFFICIAL_FACE_PARENT.clone().multiply(ASSET_EXPORT_BASIS),
  RUNTIME_BASIS,
  1e-8,
);

const rect = { left: 10, top: 20, width: 200, height: 100 };
closeArray(screenPointToNormalizedLocal(110, 70, rect), [0, 0]);
closeArray(screenPointToNormalizedLocal(10, 20, rect), [-1, 1]);
closeArray(screenPointToNormalizedLocal(210, 120, rect), [1, -1]);
closeArray(screenPointToNormalizedLocal(-100, 500, rect), [-1, -1]);

const right = createOfficialTouchRotationState();
beginOfficialTouchDrag(right, [0, 0], 1);
dragOfficialTouchRotation(right, [0.2, 0], 1);
const rightRotation = updateOfficialTouchRotation(right);
assert.ok(rightRotation[1] < 0, "right drag must produce negative Unity yaw from direct acos delta");
assert.ok(quaternionAngleDegrees([0, 0, 0, 1], rightRotation) < OFFICIAL_MAX_ROTATION_DEGREES);

const up = createOfficialTouchRotationState();
beginOfficialTouchDrag(up, [0, 0], 2);
dragOfficialTouchRotation(up, [0, 0.2], 2);
const upRotation = updateOfficialTouchRotation(up);
assert.ok(upRotation[0] > 0, "up drag around Vector3.left with negative acos delta must produce positive Unity x");

const mixed = createOfficialTouchRotationState();
beginOfficialTouchDrag(mixed, [0, 0], 3);
dragOfficialTouchRotation(mixed, [0.15, 0.1], 3);
dragOfficialTouchRotation(mixed, [0.3, -0.05], 3);
const x1 = Math.acos(0.15) - Math.acos(0);
const y1 = Math.acos(0.1) - Math.acos(0);
const x2 = Math.acos(0.3) - Math.acos(0.15);
const y2 = Math.acos(-0.05) - Math.acos(0.1);
const expectedPending = multiplyQuaternions(
  multiplyQuaternions(angleAxisRadians(x1, [0, 1, 0]), angleAxisRadians(y1, [-1, 0, 0])),
  multiplyQuaternions(angleAxisRadians(x2, [0, 1, 0]), angleAxisRadians(y2, [-1, 0, 0])),
);
closeArray(mixed.pendingRotation, expectedPending, 1e-8);
const mixedRotation = updateOfficialTouchRotation(mixed);
close(quaternionToUnityEulerRadians(mixedRotation)[2], 0, 1e-8);

const clamped = createOfficialTouchRotationState();
beginOfficialTouchDrag(clamped, [0, 0], 4);
dragOfficialTouchRotation(clamped, [1, 1], 4);
updateOfficialTouchRotation(clamped);
close(quaternionAngleDegrees([0, 0, 0, 1], clamped.rotation), OFFICIAL_MAX_ROTATION_DEGREES, 2e-6);
endOfficialTouchDrag(clamped, 4);
const held = [...clamped.rotation];
updateOfficialTouchRotation(clamped);
closeArray(clamped.rotation, held, 1e-9);

const debugA = createOfficialTouchRotationState();
const debugB = createOfficialTouchRotationState();
closeArray(setOfficialDebugTilt(debugA, [0.7, -0.25]), setOfficialDebugTilt(debugB, [0.7, -0.25]));
const pointerA = createOfficialTouchRotationState();
const pointerB = createOfficialTouchRotationState();
closeArray(setAbsolutePointerTilt(pointerA, [-0.4, 0.6]), setOfficialDebugTilt(pointerB, [-0.4, 0.6]));
assert.equal(pointerA.dragging, false, "absolute desktop pointer mapping must not leave drag state active");

const pointerHalf = createOfficialTouchRotationState();
setAbsolutePointerTilt(pointerHalf, [0.5, 0]);
close(
  quaternionAngleDegrees([0, 0, 0, 1], pointerHalf.rotation),
  OFFICIAL_MAX_ROTATION_DEGREES * 0.5,
  2e-6,
);
const pointerEdge = createOfficialTouchRotationState();
setAbsolutePointerTilt(pointerEdge, [1, 0]);
close(
  quaternionAngleDegrees([0, 0, 0, 1], pointerEdge.rotation),
  OFFICIAL_MAX_ROTATION_DEGREES,
  2e-6,
);
const pointerQuarter = createOfficialTouchRotationState();
setAbsolutePointerTilt(pointerQuarter, [-0.25, 0]);
close(
  quaternionAngleDegrees([0, 0, 0, 1], pointerQuarter.rotation),
  OFFICIAL_MAX_ROTATION_DEGREES * 0.25,
  2e-6,
);

// C=diag(1,1,-1): converted Unity forward must equal the Three forward and
// converting the numeric vector back to Unity flips only z.
const unityQ = mixedRotation;
const threeQ = unityQuaternionToThree(unityQ);
const unityForward = rotateVectorByQuaternion([0, 0, -1], unityQ);
const threeForward = rotateVectorByQuaternion([0, 0, 1], threeQ);
closeArray(threeForward, [unityForward[0], unityForward[1], -unityForward[2]], 1e-8);

const hierarchyCases = [
  [0, 0, 0, 1],
  rightRotation,
  upRotation,
  mixedRotation,
];
for (const rotation of hierarchyCases) {
  const studioRoot = new THREE.Group();
  const assetRoot = new THREE.Group();
  const rotationRoot = new THREE.Group();
  const parentRoot = new THREE.Group();
  const glitterTransform = new THREE.Group();
  assetRoot.quaternion.set(...unityQuaternionToThree(rotation));
  parentRoot.rotation.y = Math.PI;
  parentRoot.add(glitterTransform);
  rotationRoot.add(parentRoot);
  assetRoot.add(rotationRoot);
  studioRoot.add(assetRoot);
  studioRoot.updateWorldMatrix(true, true);
  const worldQ = glitterTransform.getWorldQuaternion(new THREE.Quaternion());
  const convertedWorldForward = new THREE.Vector3(0, 0, -1).applyQuaternion(worldQ).normalize();
  const runtimeUnityForward = threeWorldForwardToUnity(convertedWorldForward.toArray());
  const expectedUnityForward = rotateVectorByQuaternion([0, 0, -1], rotation);
  closeArray(runtimeUnityForward, expectedUnityForward, 1e-7);

  const unityRuntimeMatrix = new THREE.Matrix4().makeRotationFromQuaternion(
    new THREE.Quaternion(...rotation),
  );
  const threeRuntimeMatrix = new THREE.Matrix4().makeRotationFromQuaternion(
    new THREE.Quaternion(...unityQuaternionToThree(rotation)),
  );
  closeMatrix(
    threeRuntimeMatrix,
    RUNTIME_BASIS.clone().multiply(unityRuntimeMatrix).multiply(RUNTIME_BASIS),
    1e-8,
  );

  const unityLocal = new THREE.Matrix4().compose(
    new THREE.Vector3(0.13, -0.27, 0.041),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(0.19, -0.31, 0.07, "XYZ")),
    new THREE.Vector3(0.91, 1.08, 1.03),
  );
  const exportedLocal = ASSET_EXPORT_BASIS.clone().multiply(unityLocal).multiply(ASSET_EXPORT_BASIS);
  const threeWorld = threeRuntimeMatrix.clone().multiply(OFFICIAL_FACE_PARENT).multiply(exportedLocal);
  const officialWorld = unityRuntimeMatrix.clone().multiply(unityLocal);
  closeMatrix(
    threeWorld,
    RUNTIME_BASIS.clone().multiply(officialWorld).multiply(ASSET_EXPORT_BASIS),
    1e-7,
  );

  // Shader component arithmetic must recover the official matrix basis. Geometry projection can
  // consume Three's modelMatrix directly because positions were converted by A; reading a matrix
  // column as data cannot. For the Z axis: officialM[2].xyz = C * threeM[2].xyz.
  const threeAxisZ = new THREE.Vector3().setFromMatrixColumn(threeWorld, 2);
  const officialAxisZ = new THREE.Vector3().setFromMatrixColumn(officialWorld, 2);
  const recoveredOfficialAxisZ = new THREE.Vector3(threeAxisZ.x, threeAxisZ.y, -threeAxisZ.z);
  closeArray(recoveredOfficialAxisZ.toArray(), officialAxisZ.toArray(), 1e-7);
  const recoveredOfficialNegativeAxisZ = recoveredOfficialAxisZ.clone().negate();
  closeArray(recoveredOfficialNegativeAxisZ.toArray(), officialAxisZ.clone().negate().toArray(), 1e-7);
}

assert.equal(dragOfficialTouchRotation(clamped, [0, 0], 99), false);
console.log("Official touch rotation numeric tests: OK");
console.log("  rect-local acos deltas, qY*qX accumulation, roll removal, linear absolute adapter, 30-degree clamp, release hold");
console.log("  exact A asset export, P face parent, C runtime basis, composed model matrix and shader Z-axis recovery");
