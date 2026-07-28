import assert from "node:assert/strict";
import {
  advanceCardFutureFrame,
  cardFutureGoalFrame,
  cardFutureTiltDot,
  createCardFutureState,
  updateCardFuture,
  validateCardFutureConfig,
} from "../public/render/card-future.js";
import {
  angleAxisRadians,
  unityQuaternionToThree,
} from "../public/render/official-touch-rotation.js";

const CONFIG = {
  componentIdentity: "CAB-test:1",
  componentGoIdentity: "CAB-test:2",
  componentGoPath: "Card",
  scriptIdentity: "CAB-script:3",
  rendererBindings: ["CAB-test:4"],
  animationTexFrameCount: 240,
  animationFrameCount: 9,
  animSwitchSpeed: 5,
  animFrameOffset: 39,
  skipAnimThreshold: 4,
  accellRatio: 5,
  isAnimationStopped: 0,
};

assert.deepEqual(validateCardFutureConfig(CONFIG).rendererBindings, ["CAB-test:4"]);
for (const mutation of [
  { animationFrameCount: 0 },
  { rendererBindings: [] },
  { componentIdentity: "" },
  { isAnimationStopped: 2 },
]) {
  assert.throws(() => validateCardFutureConfig({ ...CONFIG, ...mutation }));
}

assert.equal(cardFutureTiltDot([0, 0, 0, 1]), 0);
assert.equal(cardFutureGoalFrame(0, 9), 4);
assert.equal(cardFutureGoalFrame(-1, 9), 0);
assert.equal(cardFutureGoalFrame(1, 9), 8);
assert.equal(advanceCardFutureFrame(4, 4, CONFIG, 1 / 60), 4);
assert.equal(advanceCardFutureFrame(0, 8, CONFIG, 0), 4);

const state = createCardFutureState(CONFIG);
assert.equal(state.animFrame, 4);
assert.equal(updateCardFuture(state, {
  threeQuaternion: [0, 0, 0, 1],
  deltaTime: 1 / 60,
}).animFrame, 43);

const unityTilt = angleAxisRadians(Math.PI / 6, [1, 0, 0]);
const tilted = updateCardFuture(state, {
  threeQuaternion: unityQuaternionToThree(unityTilt),
  deltaTime: 1 / 60,
});
assert.notEqual(tilted.tiltDot, 0);
assert.ok(tilted.animFrame >= CONFIG.animFrameOffset);
assert.ok(tilted.animFrame <= CONFIG.animFrameOffset + CONFIG.animationFrameCount - 1);

console.log("CardFutureObject numeric and mutation tests: OK");
