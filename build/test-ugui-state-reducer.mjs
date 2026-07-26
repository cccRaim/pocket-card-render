import assert from "node:assert/strict";
import {
  replayUGUIState,
  UGUI_STATE_REPLAY_SCHEMA,
} from "../public/render/ugui-state-reducer.js";

const IDENTITY_ROTATION = [0, 0, 0, 1];
const IDENTITY_SCALE = [1, 1, 1];
const QUARTER_TURN_Z = [0, 0, Math.SQRT1_2, Math.SQRT1_2];

function transform(localRotation = IDENTITY_ROTATION, localScale = IDENTITY_SCALE) {
  return {
    localRotation: [...localRotation],
    localScale: [...localScale],
  };
}

function sprite(identity, fileId, pathId) {
  return { identity, pptr: { fileId, pathId } };
}

function component(
  identity,
  componentIndex,
  kind,
  initialEnabled,
  spriteIdentity = undefined,
) {
  const value = { identity, componentIndex, kind, initialEnabled };
  if (spriteIdentity !== undefined) value.spriteIdentity = spriteIdentity;
  return value;
}

function node({
  identity,
  parent,
  siblingIndex,
  initialActive = true,
  rectTransform = transform(),
  components = [],
}) {
  return {
    identity,
    parent,
    siblingIndex,
    initialActive,
    rectTransform,
    components,
  };
}

function fixture() {
  return {
    schema: UGUI_STATE_REPLAY_SCHEMA,
    sprites: [
      sprite("sprite:primary", 1, "101"),
      sprite("sprite:alternate", 0, "-202"),
    ],
    nodes: [
      node({
        identity: "root",
        parent: null,
        siblingIndex: 0,
        components: [component("root:canvas", 0, "Canvas", true)],
      }),
      node({
        identity: "panel",
        parent: "root",
        siblingIndex: 0,
        rectTransform: transform(QUARTER_TURN_Z, [2, -1, 0.5]),
        components: [
          component("panel:image", 0, "Image", true, "sprite:primary"),
          component("panel:text", 1, "TMP_Text", true),
        ],
      }),
      node({
        identity: "hidden-child",
        parent: "panel",
        siblingIndex: 0,
        initialActive: false,
        rectTransform: transform([0, Math.SQRT1_2, 0, Math.SQRT1_2], [0, 3, 4]),
        components: [
          component("hidden:image", 0, "Image", true, null),
        ],
      }),
      node({
        identity: "footer",
        parent: "root",
        siblingIndex: 1,
        components: [
          component("footer:image", 0, "Image", true, "sprite:alternate"),
        ],
      }),
    ],
    operations: [
      { opcode: "set_sprite", target: "panel:image", value: "sprite:alternate" },
      { opcode: "set_enabled", target: "panel:text", value: false },
      { opcode: "SetActive", target: "hidden-child", value: true },
    ],
  };
}

function clone(value) {
  return structuredClone(value);
}

function expectReject(mutator, pattern) {
  const input = fixture();
  mutator(input);
  assert.throws(() => replayUGUIState(input), pattern);
}

function permutations(values) {
  if (values.length < 2) return [values];
  return values.flatMap((value, index) => permutations([
    ...values.slice(0, index),
    ...values.slice(index + 1),
  ]).map((rest) => [value, ...rest]));
}

const input = fixture();
const before = clone(input);
const output = replayUGUIState(input);
assert.deepEqual(input, before, "replay must not mutate its input");
assert.equal(output.schema, UGUI_STATE_REPLAY_SCHEMA);
assert.equal(Object.isFrozen(output), true);
assert.deepEqual(
  output.appliedOperations,
  input.operations.map((operation, operationIndex) => ({
    operationIndex,
    ...operation,
  })),
  "operation trace must preserve official call order",
);
assert.deepEqual(
  output.hierarchy.map((entry) => entry.identity),
  ["root", "panel", "hidden-child", "footer"],
);
assert.deepEqual(output.siblingOrder, [
  { parent: null, children: ["root"] },
  { parent: "root", children: ["panel", "footer"] },
  { parent: "panel", children: ["hidden-child"] },
  { parent: "hidden-child", children: [] },
  { parent: "footer", children: [] },
]);
assert.deepEqual(
  output.drawOrder,
  ["root:canvas", "panel:image", "hidden:image", "footer:image"],
);
assert.deepEqual(
  output.contentDrawPlan.map(({ drawIndex, componentIdentity }) => ({
    drawIndex,
    componentIdentity,
  })),
  [
    { drawIndex: 0, componentIdentity: "root:canvas" },
    { drawIndex: 1, componentIdentity: "panel:image" },
    { drawIndex: 2, componentIdentity: "hidden:image" },
    { drawIndex: 3, componentIdentity: "footer:image" },
  ],
);

const panelState = output.hierarchy.find((entry) => entry.identity === "panel");
assert.deepEqual(panelState.rectTransform, transform(QUARTER_TURN_Z, [2, -1, 0.5]));
assert.equal(panelState.components[0].spriteIdentity, "sprite:alternate");
assert.deepEqual(panelState.components[0].sprite.pptr, { fileId: 0, pathId: "-202" });
assert.equal(panelState.components[1].enabled, false);
const hiddenPlan = output.contentDrawPlan.find(
  (entry) => entry.componentIdentity === "hidden:image",
);
assert.deepEqual(
  hiddenPlan.transformChain.map((entry) => ({
    nodeIdentity: entry.nodeIdentity,
    localRotation: entry.localRotation,
    localScale: entry.localScale,
  })),
  [
    { nodeIdentity: "root", ...transform() },
    { nodeIdentity: "panel", ...transform(QUARTER_TURN_Z, [2, -1, 0.5]) },
    {
      nodeIdentity: "hidden-child",
      ...transform([0, Math.SQRT1_2, 0, Math.SQRT1_2], [0, 3, 4]),
    },
  ],
  "non-identity rotation and scale must survive into the draw plan",
);

const reordered = fixture();
reordered.nodes.reverse();
reordered.sprites.reverse();
assert.deepEqual(
  replayUGUIState(reordered),
  output,
  "serialized node and sprite array order must not affect hierarchy replay",
);
const stateWithoutTrace = ({ appliedOperations: _appliedOperations, ...state }) => state;
for (const operations of permutations(fixture().operations)) {
  const permuted = fixture();
  permuted.operations = operations;
  assert.deepEqual(
    stateWithoutTrace(replayUGUIState(permuted)),
    stateWithoutTrace(output),
    "independent operation permutations must produce the same final state",
  );
  assert.deepEqual(
    replayUGUIState(permuted).appliedOperations.map(({ operationIndex, ...entry }) => entry),
    operations,
    "operation trace must retain each permutation instead of canonicalizing it",
  );
}

const duplicated = fixture();
duplicated.operations.push(
  { opcode: "SetActive", target: "hidden-child", value: true },
  { opcode: "set_enabled", target: "panel:text", value: false },
  { opcode: "set_sprite", target: "panel:image", value: "sprite:alternate" },
);
assert.deepEqual(
  stateWithoutTrace(replayUGUIState(duplicated)),
  stateWithoutTrace(output),
  "repeating identical operations must be state-idempotent",
);
assert.equal(replayUGUIState(duplicated).appliedOperations.length, 6);

const independentSameTarget = fixture();
independentSameTarget.operations = [
  { opcode: "set_enabled", target: "panel:image", value: false },
  { opcode: "set_sprite", target: "panel:image", value: "sprite:alternate" },
];
const independentSameTargetReversed = clone(independentSameTarget);
independentSameTargetReversed.operations.reverse();
assert.deepEqual(
  stateWithoutTrace(replayUGUIState(independentSameTarget)),
  stateWithoutTrace(replayUGUIState(independentSameTargetReversed)),
  "orthogonal state slots on one component must commute",
);

const sequentialWrites = fixture();
sequentialWrites.operations = [
  { opcode: "SetActive", target: "hidden-child", value: true },
  { opcode: "SetActive", target: "hidden-child", value: false },
  { opcode: "set_enabled", target: "panel:text", value: false },
  { opcode: "set_enabled", target: "panel:text", value: true },
  { opcode: "set_sprite", target: "panel:image", value: "sprite:alternate" },
  { opcode: "set_sprite", target: "panel:image", value: "sprite:primary" },
];
const sequentialOutput = replayUGUIState(sequentialWrites);
const sequentialHidden = sequentialOutput.hierarchy.find(
  (entry) => entry.identity === "hidden-child",
);
const sequentialPanel = sequentialOutput.hierarchy.find(
  (entry) => entry.identity === "panel",
);
assert.equal(sequentialHidden.selfActive, false);
assert.equal(sequentialPanel.components[1].enabled, true);
assert.equal(sequentialPanel.components[0].spriteIdentity, "sprite:primary");
assert.deepEqual(
  sequentialOutput.appliedOperations.map(({ operationIndex }) => operationIndex),
  [0, 1, 2, 3, 4, 5],
  "same-slot writes must execute sequentially and retain their trace",
);

const parentOff = fixture();
parentOff.operations = [
  { opcode: "SetActive", target: "panel", value: false },
  { opcode: "SetActive", target: "hidden-child", value: true },
];
const parentOffOutput = replayUGUIState(parentOff);
const hiddenState = parentOffOutput.hierarchy.find(
  (entry) => entry.identity === "hidden-child",
);
assert.equal(hiddenState.selfActive, true);
assert.equal(hiddenState.effectiveActive, false);
assert.equal(parentOffOutput.drawOrder.includes("hidden:image"), false);

expectReject(
  (value) => { value.schema = "pocket-card-render/ugui-state-replay@1"; },
  /schema must be/,
);
expectReject(
  (value) => { value.extra = true; },
  /unknown field "extra"/,
);
expectReject(
  (value) => { value.operations[0].opcode = "set_color"; },
  /unknown opcode "set_color"/,
);
expectReject(
  (value) => { value.operations[0].source = "runtime"; },
  /unknown field "source"/,
);
expectReject(
  (value) => { value.operations[0].target = "missing:component"; },
  /unknown component target/,
);
expectReject(
  (value) => { value.operations[2].target = "missing:node"; },
  /unknown GameObject target/,
);
expectReject(
  (value) => {
    value.operations = [
      { opcode: "set_sprite", target: "panel:text", value: "sprite:primary" },
    ];
  },
  /component without a sprite slot/,
);
expectReject(
  (value) => { value.operations[0].value = "sprite:missing"; },
  /unknown sprite/,
);

expectReject(
  (value) => { value.nodes[1].identity = "root"; },
  /duplicate identity "root"/,
);
expectReject(
  (value) => { value.nodes[1].components[0].identity = "root:canvas"; },
  /duplicate identity "root:canvas"/,
);
expectReject(
  (value) => { value.sprites[1].identity = "sprite:primary"; },
  /duplicate identity "sprite:primary"/,
);
expectReject(
  (value) => { value.sprites[1].pptr = clone(value.sprites[0].pptr); },
  /duplicate sprite PPtr/,
);
expectReject(
  (value) => { value.nodes[1].parent = "missing-parent"; },
  /unknown parent/,
);
expectReject(
  (value) => { value.nodes[0].parent = "hidden-child"; },
  /cycle detected/,
);
expectReject(
  (value) => { value.nodes[2].parent = "hidden-child"; },
  /cannot parent itself/,
);
expectReject(
  (value) => { value.nodes[3].siblingIndex = 0; },
  /siblingIndex values must be unique and contiguous/,
);
expectReject(
  (value) => { value.nodes[1].components[1].componentIndex = 0; },
  /duplicate componentIndex/,
);

expectReject(
  (value) => { value.sprites[0].pptr.pathId = "0"; },
  /non-zero signed int64/,
);
expectReject(
  (value) => { value.sprites[0].pptr.pathId = "01"; },
  /canonical signed int64 string/,
);
expectReject(
  (value) => { value.sprites[0].pptr.pathId = "9223372036854775808"; },
  /non-zero signed int64/,
);
expectReject(
  (value) => { value.sprites[0].pptr.fileId = -1; },
  /non-negative int32/,
);
expectReject(
  (value) => { value.nodes[1].components[0].spriteIdentity = "sprite:missing"; },
  /references unknown sprite/,
);

expectReject(
  (value) => { delete value.nodes[1].rectTransform.localScale; },
  /complete localRotation and localScale/,
);
expectReject(
  (value) => { value.nodes[1].rectTransform.localRotation = [0, 0, 1]; },
  /exactly 4 values/,
);
expectReject(
  (value) => { value.nodes[1].rectTransform.localRotation = [0, 0, 0, 2]; },
  /unit quaternion/,
);
expectReject(
  (value) => { value.nodes[1].rectTransform.localScale[0] = Number.NaN; },
  /finite float32 value/,
);
expectReject(
  (value) => { value.nodes[1].rectTransform.localScale[0] = Infinity; },
  /finite float32 value/,
);
expectReject(
  (value) => { value.nodes[1].rectTransform.shear = [0, 0]; },
  /unknown field "shear"/,
);

console.log(
  "UGUI state reducer tests OK: schema, hierarchy, draw order, operations, "
  + "sequential last-write-wins, PPtr, transform, purity, commutativity, "
  + "idempotence, and fail-closed mutations",
);
