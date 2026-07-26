import assert from "node:assert/strict";

import {
  replayDynamicUIHierarchy,
  resolveBoxes,
} from "./compose.mjs";
import { createOfficialUIImageQuadGeometry } from "../public/render/tmp-sdf-renderer.js";

const identityRotation = [0, 0, 0, 1];
const identityScale = [1, 1];

function node(go, siblingIndex, {
  active = true,
  pos = [0, 0],
  size = [10, 10],
  children = [],
} = {}) {
  return {
    go,
    active,
    siblingIndex,
    pos,
    size,
    aMin: [0.5, 0.5],
    aMax: [0.5, 0.5],
    piv: [0.5, 0.5],
    rotation: identityRotation,
    scale: identityScale,
    style: null,
    children,
  };
}

const root = node("Root", 0, {
  size: [100, 100],
  children: [
    node("Controller", 0, {
      size: [100, 100],
      children: [
        node("Normal", 0, { active: true, pos: [-20, 0], size: [20, 10] }),
        node("Holo", 1, { active: false, pos: [20, 0], size: [30, 12] }),
      ],
    }),
  ],
});
const program = [{
  label: "Title",
  controller: { path: "/Root/Controller" },
  target: { path: "/Root/Controller/Holo" },
}];

const replay = replayDynamicUIHierarchy(root, program);
assert.equal(replay.replay.schema, "pocket-card-render/ugui-state-replay@2");
assert.deepEqual(
  replay.replay.appliedOperations.map(({ operationIndex, opcode, value }) => ({
    operationIndex,
    opcode,
    value,
  })),
  [
    { operationIndex: 0, opcode: "SetActive", value: false },
    { operationIndex: 1, opcode: "SetActive", value: true },
  ],
);

const layout = resolveBoxes(root, program);
const normal = layout.nodeByPath("/Root/Controller/Normal");
const holo = layout.nodeByPath("/Root/Controller/Holo");
assert.equal(normal.runtimeGameObjectActive, false);
assert.equal(normal.activeInHierarchy, false);
assert.equal(holo.runtimeGameObjectActive, true);
assert.equal(holo.activeInHierarchy, true);
assert.deepEqual(
  layout.dynamicUIReplay.appliedOperations.map(
    ({ operationIndex, targetPath, value }) => ({
      operationIndex,
      targetPath,
      value,
    }),
  ),
  [
    {
      operationIndex: 0,
      targetPath: "/Root/Controller/Normal",
      value: false,
    },
    {
      operationIndex: 1,
      targetPath: "/Root/Controller/Holo",
      value: true,
    },
  ],
);

const activeDrawNodes = [normal, holo]
  .filter((entry) => entry.activeInHierarchy)
  .sort((left, right) => left.hierarchyOrder - right.hierarchyOrder);
assert.deepEqual(activeDrawNodes.map((entry) => entry.path), [
  "/Root/Controller/Holo",
]);

const draw = activeDrawNodes[0];
const geometry = createOfficialUIImageQuadGeometry({
  source: { width: 30, height: 12 },
  rect: {
    left: draw.box.l * layout.CW,
    top: draw.box.t * layout.CH,
    width: (draw.box.r - draw.box.l) * layout.CW,
    height: (draw.box.b - draw.box.t) * layout.CH,
  },
  color: [1, 1, 1, 1],
});
assert.equal(geometry.attributes.position.count, 4);
assert.equal(geometry.attributes.uv.count, 4);
assert.equal(geometry.attributes.color.count, 4);
assert.deepEqual(Array.from(geometry.index.array), [0, 1, 2, 0, 2, 3]);
geometry.dispose();

const disabledParent = structuredClone(root);
disabledParent.children[0].active = false;
const disabledLayout = resolveBoxes(disabledParent, program);
assert.equal(
  disabledLayout.nodeByPath("/Root/Controller/Holo").runtimeGameObjectActive,
  true,
);
assert.equal(
  disabledLayout.nodeByPath("/Root/Controller/Holo").activeInHierarchy,
  false,
  "selected child must remain effectively inactive under a disabled parent",
);

console.log(
  "UGUI state replay integration OK: official SetActive order -> effective hierarchy -> Image draw geometry",
);
