import assert from "node:assert/strict";
import test from "node:test";
import {
  THREE_PERSPECTIVE_ZBUFFER_PRODUCER_SCHEMA,
  offsetThreePerspectiveNdcZ,
  threePerspectiveZBufferParams,
} from "../public/render/projection-depth.js";

function ndcFromEyeDepth(depth, near, far) {
  return (far + near) / (far - near)
    - (2 * far * near) / ((far - near) * depth);
}

test("Three perspective adapter has a versioned producer identity", () => {
  assert.equal(
    THREE_PERSPECTIVE_ZBUFFER_PRODUCER_SCHEMA,
    "pocket-card-render/three-perspective-zbuffer-adaptation@1",
  );
  const params = threePerspectiveZBufferParams(0.3, 1000);
  assert.equal(params.length, 4);
  assert.equal(params[0], 0);
  assert.equal(params[1], 0);
});

test("linearize, offset and delinearize matches the Three projection", () => {
  for (const [near, far] of [[0.1, 100], [0.3, 1000], [1, 10]]) {
    const params = threePerspectiveZBufferParams(near, far);
    for (const depth of [near, near * 2, Math.sqrt(near * far), far * 0.9]) {
      for (const offset of [-depth * 0.1, 0, depth * 0.25]) {
        const actual = offsetThreePerspectiveNdcZ(
          ndcFromEyeDepth(depth, near, far),
          offset,
          params,
        );
        const expected = ndcFromEyeDepth(depth + offset, near, far);
        assert.ok(
          Math.abs(actual - expected) < 2e-6,
          `${near}/${far}/${depth}/${offset}: ${actual} != ${expected}`,
        );
      }
    }
  }
});

test("invalid camera and depth inputs fail closed", () => {
  assert.throws(() => threePerspectiveZBufferParams(0, 100), /positive/);
  assert.throws(() => threePerspectiveZBufferParams(10, 1), /greater/);
  assert.throws(
    () => offsetThreePerspectiveNdcZ(0, 1, [0, 0, 0, 1]),
    /invalid/,
  );
});
