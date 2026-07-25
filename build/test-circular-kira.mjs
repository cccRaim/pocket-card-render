#!/usr/bin/env node
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import * as THREE from "three";
import { fileURLToPath } from "node:url";
import {
  bindCircularKiraMesh,
  circularTrailIndex,
  createCircularKiraState,
  finalizeCircularKiraBindings,
  roundTiesToEvenF32,
  updateCircularKira,
  updateCircularKiraTrail,
} from "../public/render/circular-kira.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scene = JSON.parse(fs.readFileSync(
  path.join(ROOT, "public", "scene.cPK_20_000010_01_FUSHIGIDANE_S.json"),
  "utf8",
));
const [componentIdentity, config] = Object.entries(scene.runtimeSettings.circularKira)[0];

const state = createCircularKiraState(componentIdentity, config);
assert.equal(state.defaultCircularAngle, 35);
assert.equal(state.primitives.length, 4);
assert.deepEqual([...state.primTypes.slice(0, 4)], [0, 1, 2, 2]);
assert.deepEqual([...state.primAngles.slice(0, 4)], [157.5, 0, 67.5, 112.5]);

const uniforms = {
  _Tilt: { value: -1 },
  _CircularDefaultAngle: { value: -1 },
  _MoveAngle: { value: -1 },
  _NoiseTime: { value: -1 },
};
state.materials.add({ uniforms });

const geometry = new THREE.BufferGeometry();
geometry.setAttribute("uv", new THREE.Float32BufferAttribute(new Float32Array(402 * 2), 2));
const trailA = new THREE.Mesh(geometry);
const trailB = new THREE.Mesh(geometry);
bindCircularKiraMesh(state, "trailA", trailA);
bindCircularKiraMesh(state, "trailB", trailB);
bindCircularKiraMesh(state, "movingA", new THREE.Object3D());
bindCircularKiraMesh(state, "movingB", new THREE.Object3D());
finalizeCircularKiraBindings(state, new THREE.Object3D());
assert.throws(() => bindCircularKiraMesh(state, "trailA", {
  geometry: new THREE.BufferGeometry(),
}), /trail UV count/);

const uv = geometry.getAttribute("uv");
const uvVersion = uv.version;
updateCircularKira(state, [0, 0, 1], 0.1);
assert.equal(state.tilt, 0);
assert.ok(Object.is(state.moveAngle, 0) || Object.is(state.moveAngle, -0));
assert.equal(state.speedState, 0);
assert.equal(uniforms._CircularDefaultAngle.value, 35);
assert.equal(uniforms._NoiseTime.value, 0.2);
assert.ok(uv.version > uvVersion);
assert.equal(state.lastTrailIndex, 200, "first frame initializes at the current trail index");

updateCircularKira(state, [0.1, 0, Math.sqrt(0.99)], 0.1);
assert.ok(Array.from({ length: uv.count }, (_, index) => uv.getY(index)).some((value) => value > 0));
assert.ok(Array.from({ length: uv.count }, (_, index) => uv.getY(index)).every(Number.isFinite));

for (let index = 0; index < 3; index++) updateCircularKira(state, [1, 0, 0], 0.1);
assert.ok(Math.abs(state.tilt - 1) < 1e-6);
assert.equal(state.moveAngle, -182.5);
assert.equal(state.tiltState, true);
assert.equal(state.speedState, 1);
updateCircularKira(state, [1, 0, 0], 0.1);
assert.ok(state.primitives.every((primitive) => primitive.speed > 0));
assert.equal(uniforms._Tilt.value, state.tilt);
assert.equal(uniforms._MoveAngle.value, state.moveAngle);
assert.ok(geometry.getAttribute("uv").needsUpdate !== false);

for (let index = 0; index < 3; index++) updateCircularKira(state, [0, 0, 1], 0.1);
assert.equal(state.tiltState, false);
assert.equal(state.speedState, 2);
assert.ok(state.primitives.every((primitive) => primitive.brakeGoalAngle >= primitive.angle));

for (let index = 0; index < 3; index++) updateCircularKira(state, [1, 0, 0], 0.1);
assert.equal(state.tiltState, true);
assert.equal(state.speedState, 1);
assert.ok(state.primitives.every((primitive) => (
  primitive.brakeGoalAngle === 0
  && primitive.brakeStartAngle === 0
  && primitive.brakingTime === 0
  && primitive.speedAtBrakeStart === 0
)), "ResetBrakeParams must clear all four contiguous brake fields");

const brakeOrder = createCircularKiraState(componentIdentity, {
  ...config,
  useLengthLimit: 0,
  useDistanceFadeOut: 0,
});
brakeOrder.speedState = 2;
for (const primitive of brakeOrder.primitives) {
  primitive.angle = 1;
  primitive.brakeStartAngle = 0;
  primitive.brakeGoalAngle = 100;
  primitive.brakingTime = 0;
  primitive.speedAtBrakeStart = 1;
}
updateCircularKira(brakeOrder, [0, 0, 1], 0.1);
assert.ok(brakeOrder.primitives.every((primitive) => primitive.speed === 1),
  "Brake must calculate speed from the old brakingTime before incrementing it");
assert.ok(brakeOrder.primitives.every((primitive) => primitive.brakingTime === Math.fround(0.1)));

const stopped = createCircularKiraState(componentIdentity, { ...config, isAnimationStopped: 1 });
updateCircularKira(stopped, [1, 0, 0], 1);
assert.equal(stopped.time, 0);
assert.equal(stopped.tilt, 0);

assert.equal(circularTrailIndex(0, 200), 200);
assert.deepEqual([2.5, 3.5, -1.5, -2.5].map(roundTiesToEvenF32), [2, 4, -2, -2]);

const firstFrame = createCircularKiraState(componentIdentity, {
  ...config,
  useLengthLimit: 0,
  useDistanceFadeOut: 0,
  fadeOut: 0,
  centerIntensity: 1,
  expandLength: 0,
});
firstFrame.moveAngle = 0;
updateCircularKiraTrail(firstFrame, 0);
assert.equal(firstFrame.lastTrailIndex, 200);
assert.equal([...firstFrame.tempBrightnesses].filter((value) => value !== 0).length, 1,
  "initialization must not draw a false path from slot 0");

const fadePastZero = createCircularKiraState(componentIdentity, {
  ...config,
  useLengthLimit: 0,
  useDistanceFadeOut: 0,
  fadeOut: 1,
  fadeOutEnd: 0.001,
  centerIntensity: 0.01,
  expandLength: 0,
});
fadePastZero.moveAngle = 0;
fadePastZero.lastTrailIndex = 200;
updateCircularKiraTrail(fadePastZero, 0.02);
assert.equal(fadePastZero.tempBrightnesses[200], Math.fround(-0.01),
  "official fade stores the negative crossing until the following frame");

const limited = createCircularKiraState(componentIdentity, {
  ...config,
  centerIntensity: 0.8,
  fadeOut: 0,
  useDistanceFadeOut: 0,
  expandLength: 0,
  useLengthLimit: 1,
  limitLengthRatio: 0.1,
  limitAdjustCurvePower: 1.1,
  limitAdjustSpeed: 0.2,
});
limited.moveAngle = 0;
limited.lastTrailIndex = 200;
limited.tilt = 0;
for (let index = 170; index <= 230; index++) {
  limited.tempBrightnesses[index] = Math.fround(0.1 + (1 - Math.abs(index - 200) / 31) * 0.7);
}
updateCircularKiraTrail(limited, 0);
const trailHash = crypto.createHash("sha256")
  .update(Buffer.from(limited.tempBrightnesses.buffer))
  .update(Buffer.from(limited.brightnesses.buffer))
  .digest("hex");
assert.equal(trailHash, "9aa9cda372a96cc109adf02728c1f86959284ae4d793b9ff78770d5c3b7cc83b",
  "full float32 length-limit vector drifted");

console.log("CircularKira CPU state tests: PASS");
console.log("  brake reset/order, ties-to-even indexing, endpoint shrink, curve cap, fade crossing and first-frame initialization are locked");
console.log("  Unity PerlinNoise1D/Random seed and final ARM64 libm ULP equivalence remain runtime-required");
