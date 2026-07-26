import assert from "node:assert/strict";
import * as THREE from "three";
import { resolveBoxes } from "./compose.mjs";
import {
  IDENTITY_UI_AFFINE,
  applyUiAffineToCanvas,
  isIdentityUiAffine,
  multiplyUiAffine,
  rectTransformUiAffine,
  transformUiPoint,
  uiAffineToMatrix4,
} from "../public/render/ui-affine-transform.js";

const close = (actual, expected, epsilon = 1e-6) => {
  assert.equal(actual.length, expected.length);
  actual.forEach((value, index) => assert.ok(
    Math.abs(value - expected[index]) <= epsilon,
    `${index}: expected ${expected[index]}, got ${value}`,
  ));
};

assert.equal(isIdentityUiAffine(IDENTITY_UI_AFFINE), true);
close(transformUiPoint(IDENTITY_UI_AFFINE, [3, 4]), [3, 4]);

const ninety = rectTransformUiAffine({
  pivot: [10, 20],
  rotation: [0, 0, Math.SQRT1_2, Math.SQRT1_2],
  scale: [2, 3],
});
close(transformUiPoint(ninety, [11, 20]), [10, 22]);
close(transformUiPoint(ninety, [10, 21]), [7, 20]);

const child = rectTransformUiAffine({
  pivot: [4, 5],
  rotation: [0, 0, 0, 1],
  scale: [0.5, 2],
}, ninety);
close(
  transformUiPoint(child, [7, 8]),
  transformUiPoint(ninety, transformUiPoint(
    rectTransformUiAffine({ pivot: [4, 5], rotation: [0, 0, 0, 1], scale: [0.5, 2] }),
    [7, 8],
  )),
);
close(multiplyUiAffine(IDENTITY_UI_AFFINE, child), child);

const matrix = uiAffineToMatrix4(child, THREE.Matrix4);
const point = new THREE.Vector3(7, 8, 0).applyMatrix4(matrix);
close([point.x, point.y], transformUiPoint(child, [7, 8]));

const calls = [];
applyUiAffineToCanvas({ transform: (...values) => calls.push(values) }, child);
assert.deepEqual(calls, [child]);

assert.throws(
  () => rectTransformUiAffine({ pivot: [0, 0], rotation: [0.1, 0, 0, 1], scale: [1, 1] }),
  /non-planar/,
);
assert.throws(
  () => rectTransformUiAffine({ pivot: [0, 0], rotation: [0, 0, 0, 0], scale: [1, 1] }),
  /zero/,
);
assert.throws(() => transformUiPoint([1, 0, 0, 1, 0, NaN], [0, 0]), /finite/);

const synthetic = {
  go: "Root",
  active: true,
  siblingIndex: 0,
  pos: [0, 0],
  size: [100, 100],
  aMin: [0.5, 0.5],
  aMax: [0.5, 0.5],
  piv: [0.5, 0.5],
  rotation: [0, 0, 0, 1],
  scale: [1, 1],
  style: null,
  children: [{
    go: "Child",
    active: true,
    siblingIndex: 0,
    pos: [10, 0],
    size: [20, 10],
    aMin: [0.5, 0.5],
    aMax: [0.5, 0.5],
    piv: [0.5, 0.5],
    rotation: [0, 0, Math.SQRT1_2, Math.SQRT1_2],
    scale: [2, 1],
    style: null,
    children: [],
  }],
};
const childNode = resolveBoxes(synthetic).node("Child");
assert(childNode);
assert.equal(isIdentityUiAffine(childNode.uiTransform), false);
close(transformUiPoint(childNode.uiTransform, [10, 0]), [10, 0]);
close(transformUiPoint(childNode.uiTransform, [11, 0]), [10, 2]);

console.log("UGUI affine transform tests OK");
