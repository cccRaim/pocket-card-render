import assert from "node:assert/strict";
import {
  answerLayerBisect,
  createLayerBisectState,
  layerBisectProbe,
  LAYER_BISECT_SCHEMA,
  parseHiddenLayerNumbers,
} from "../public/render/layer-bisect.js";

assert.deepEqual(parseHiddenLayerNumbers("25, 3,25"), [3, 25]);
assert.deepEqual(parseHiddenLayerNumbers(""), []);
assert.throws(() => parseHiddenLayerNumbers("0"), /positive 1-based/);
assert.throws(() => parseHiddenLayerNumbers("2.5"), /positive 1-based/);

let state = createLayerBisectState([2, 3, 4, 5, 6, 7, 8, 9]);
assert.equal(state.schema, LAYER_BISECT_SCHEMA);
assert.deepEqual(layerBisectProbe(state), {
  done: false,
  hidden: [2, 3, 4, 5],
  shownCandidates: [6, 7, 8, 9],
  visible: [6, 7, 8, 9],
});

state = answerLayerBisect(state, true);
assert.deepEqual(state.candidates, [6, 7, 8, 9]);
assert.deepEqual(state.context, []);
assert.deepEqual(state.removed, [2, 3, 4, 5]);
assert.deepEqual(layerBisectProbe(state).visible, [8, 9]);

state = answerLayerBisect(state, false);
assert.deepEqual(state.candidates, [6, 7]);
assert.deepEqual(state.context, [8, 9]);
assert.deepEqual(state.removed, [2, 3, 4, 5]);
assert.deepEqual(layerBisectProbe(state), {
  done: false,
  hidden: [6],
  shownCandidates: [7],
  visible: [7, 8, 9],
});

state = answerLayerBisect(state, false);
assert.deepEqual(layerBisectProbe(state), {
  done: true,
  candidate: 6,
  hidden: [2, 3, 4, 5],
  visible: [6, 7, 8, 9],
});

assert.throws(() => createLayerBisectState([]), /at least one candidate/);
assert.throws(() => createLayerBisectState([1, 1]), /duplicate/);
assert.throws(() => answerLayerBisect(state, true), /already complete/);

console.log("layer bisection: exclusion context and terminal candidate verified");
