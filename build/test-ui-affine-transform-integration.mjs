import assert from "node:assert/strict";
import * as THREE from "three";

import { resolveBoxes } from "./compose.mjs";
import { createOfficialUIImageQuadGeometry } from "../public/render/tmp-sdf-renderer.js";
import {
  applyUiAffineToCanvas,
  transformUiPoint,
  uiAffineToMatrix4,
} from "../public/render/ui-affine-transform.js";

const root = {
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
    go: "RotatedImage",
    active: true,
    siblingIndex: 0,
    pos: [10, 5],
    size: [20, 10],
    aMin: [0.5, 0.5],
    aMax: [0.5, 0.5],
    piv: [0.5, 0.5],
    rotation: [0, 0, Math.SQRT1_2, Math.SQRT1_2],
    scale: [2, 0.5],
    style: null,
    children: [],
  }],
};

const layout = resolveBoxes(root);
const image = layout.nodeByPath("/Root/RotatedImage");
const rect = {
  left: image.box.l * layout.CW,
  top: image.box.t * layout.CH,
  width: (image.box.r - image.box.l) * layout.CW,
  height: (image.box.b - image.box.t) * layout.CH,
};
const geometry = createOfficialUIImageQuadGeometry({
  source: { width: 20, height: 10 },
  rect,
  color: [1, 1, 1, 1],
});
const matrix = uiAffineToMatrix4(image.uiTransform, THREE.Matrix4);
const canvasCalls = [];
applyUiAffineToCanvas(
  { transform: (...values) => canvasCalls.push(values) },
  image.uiTransform,
);
assert.deepEqual(canvasCalls, [image.uiTransform]);

for (let index = 0; index < geometry.attributes.position.count; index += 1) {
  const source = [
    geometry.attributes.position.getX(index),
    geometry.attributes.position.getY(index),
  ];
  const expected = transformUiPoint(image.uiTransform, source);
  const actual = new THREE.Vector3(source[0], source[1], 0).applyMatrix4(matrix);
  assert.ok(Math.abs(actual.x - expected[0]) <= 1e-6);
  assert.ok(Math.abs(actual.y - expected[1]) <= 1e-6);
}
geometry.dispose();

const nonPlanar = structuredClone(root);
nonPlanar.children[0].rotation = [Math.SQRT1_2, 0, 0, Math.SQRT1_2];
assert.throws(
  () => resolveBoxes(nonPlanar),
  /non-planar RectTransform rotation/,
  "compose must fail closed instead of flattening a 3D RectTransform",
);

console.log(
  "UGUI affine compose/render integration OK: one matrix drives Canvas and Three Image geometry",
);
