import assert from "node:assert/strict";
import {
  OFFICIAL_GLITTER_FLOW_DEFAULTS,
  createGlitterFlowState,
  updateGlitterFlow,
} from "../public/render/glitter-flow.js";

const close = (actual, expected, epsilon = 1e-7) => {
  assert.ok(Math.abs(actual - expected) <= epsilon, `expected ${expected}, got ${actual}`);
};

const randomValues = [0.25, 0.75];
const state = createGlitterFlowState({ random: () => randomValues.shift() });
close(state.flowARotate, 1.5707963705062866);
close(state.flowBRotate, 4.71238899230957);
assert.deepEqual(state.flowSpeed, [0, 0]);
assert.deepEqual(state.flowParams[0], [0, -0, 0, 0]);

const zeroSpeedState = createGlitterFlowState({ random: () => 0.5 });
updateGlitterFlow(zeroSpeedState, { forward: [0, 0, 1], deltaTime: 1 / 60 });
assert.deepEqual(zeroSpeedState.flowSpeed, [0, 0], "default forward must preserve finite zero flow speed");
assert.deepEqual(zeroSpeedState.flowMapUVOffset, [0, 0], "zero flow speed must not move UV offsets");
assert.ok(zeroSpeedState.flowParams.flat().every(Number.isFinite), "default state produced non-finite FlowParams");
close(zeroSpeedState.lightTiming, 0.004166666883975267);
close(zeroSpeedState.flowARotate, 3.1416094303131104);
close(zeroSpeedState.flowBRotate, 3.141576051712036);

updateGlitterFlow(state, { forward: [0.6, 0.8, 0], deltaTime: 1 / 60 });
const expectedStep1 = {
  flowSpeed: [-0.05961000174283981, -0.07948000729084015],
  flowMapUVOffset: [0.001159083447419107, 0.001655833562836051],
  lightTiming: 0.004166666883975267,
  flowARotate: 1.5708425045013428,
  flowBRotate: 4.712342739105225,
};
for (let i = 0; i < 2; i += 1) close(state.flowSpeed[i], expectedStep1.flowSpeed[i]);
for (let i = 0; i < 2; i += 1) close(state.flowMapUVOffset[i], expectedStep1.flowMapUVOffset[i]);
close(state.lightTiming, expectedStep1.lightTiming);
close(state.flowARotate, expectedStep1.flowARotate);
close(state.flowBRotate, expectedStep1.flowBRotate);
assert.deepEqual(state.flowParams[0], [state.flowMapUVOffset[0], -state.flowMapUVOffset[1], state.lightTiming, 0]);
assert.deepEqual(state.flowParams[1], [state.flowARotate, state.flowBRotate, 0, 0]);

updateGlitterFlow(state, { forward: [-0.2, 0.4, 0.8], deltaTime: 0.125 });
const expectedStep2 = {
  flowSpeed: [-0.037542589008808136, -0.12232328206300735],
  flowMapUVOffset: [0.01236771047115326, 0.017643727362155914],
  lightTiming: 0.03541666641831398,
  flowARotate: 1.5713162422180176,
  flowBRotate: 4.711868762969971,
};
for (let i = 0; i < 2; i += 1) close(state.flowSpeed[i], expectedStep2.flowSpeed[i]);
for (let i = 0; i < 2; i += 1) close(state.flowMapUVOffset[i], expectedStep2.flowMapUVOffset[i]);
close(state.lightTiming, expectedStep2.lightTiming);
close(state.flowARotate, expectedStep2.flowARotate);
close(state.flowBRotate, expectedStep2.flowBRotate);

const phaseState = createGlitterFlowState({
  random: () => 0.5,
  params: { ...OFFICIAL_GLITTER_FLOW_DEFAULTS, initFlowSpeed: 0.1 },
});
updateGlitterFlow(phaseState, { forward: [0, 0, 1], deltaTime: 4 });
close(phaseState.lightTiming, 0);
assert.equal(phaseState.flowParams[0][2], phaseState.lightTiming);

const paused = structuredClone(phaseState);
updateGlitterFlow(phaseState, { forward: [0, 0, 1], deltaTime: 0 });
assert.equal(phaseState.lightTiming, paused.lightTiming, "scaled dt=0 must pause light phase");
assert.equal(phaseState.flowARotate, paused.flowARotate, "scaled dt=0 must pause rotation");
assert.equal(phaseState.flowMapUVOffset[0], paused.flowMapUVOffset[0], "scaled dt=0 must pause UV offset");
assert.notDeepEqual(phaseState.flowSpeed, paused.flowSpeed, "official per-frame speed damping is not deltaTime-scaled");

assert.throws(() => updateGlitterFlow(state, { forward: [0, 0, 1], deltaTime: -1 }), /deltaTime/);
console.log("GlitterFlowMaps state machine: OK");
console.log("  zero-speed regression, deterministic initialization, fixed-step values, 4 s phase period, scaled-dt pause behavior");
