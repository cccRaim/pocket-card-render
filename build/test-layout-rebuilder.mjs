import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  LAYOUT_REBUILDER_COMPONENT_KIND as KIND,
  createLayoutRebuilderAdapters,
  rebuildLayout,
} from "../public/render/layout-rebuilder.js";
import {
  decodeSerializedLayoutComponent,
} from "../public/render/layout-fitters.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const clone = (value) => structuredClone(value);
const rect = (width, height) => ({
  anchorMin: [0, 0],
  anchorMax: [0, 0],
  anchoredPosition: [0, 0],
  sizeDelta: [width, height],
  pivot: [0.5, 0.5],
  localScale: [1, 1],
});
const layoutElement = (id, width, height, priority = 1) => ({
  id,
  kind: KIND.LayoutElement,
  enabled: true,
  layoutPriority: priority,
  fixture: {
    min: [width, height],
    preferred: [width, height],
    flexible: [0, 0],
  },
});
const groupValue = (kind) => ({
  kind,
  enabled: true,
  padding: { left: 0, right: 0, top: 0, bottom: 0 },
  childAlignment: 0,
  spacing: kind === "horizontal" ? 10 : 0,
  childForceExpand: [false, false],
  childControl: [true, true],
  childScale: [false, false],
  reverseArrangement: false,
});
const layoutGroup = (id, kind) => ({
  id,
  kind: KIND.LayoutGroup,
  enabled: true,
  layoutPriority: 0,
  value: groupValue(kind),
});
const contentFitter = (id) => ({
  id,
  kind: KIND.ContentSizeFitter,
  enabled: true,
  value: { kind: "content-size", enabled: true, fit: [2, 2] },
});
const aspectFitter = (id) => ({
  id,
  kind: KIND.AspectRatioFitter,
  enabled: true,
  value: {
    kind: "aspect-ratio",
    enabled: true,
    aspectMode: 1,
    aspectRatio: 2,
  },
});

function syntheticHierarchy() {
  return {
    nodes: [
      {
        id: "root",
        parentId: null,
        siblingIndex: 0,
        activeSelf: true,
        rootParentSize: [0, 0],
        rect: rect(210, 100),
        components: [layoutGroup("root-group", "horizontal")],
      },
      {
        id: "panel-a",
        parentId: "root",
        siblingIndex: 0,
        activeSelf: true,
        rect: rect(1, 1),
        // Deliberately put the group first: control must still run the self-fitter first.
        components: [
          layoutGroup("panel-group", "vertical"),
          contentFitter("panel-fit"),
          layoutElement("panel-layout", 100, 100),
        ],
      },
      {
        id: "leaf-a",
        parentId: "panel-a",
        siblingIndex: 0,
        activeSelf: true,
        rect: rect(1, 1),
        components: [layoutElement("leaf-layout", 100, 100)],
      },
      {
        id: "panel-b",
        parentId: "root",
        siblingIndex: 1,
        activeSelf: true,
        rect: rect(1, 1),
        components: [
          layoutElement("panel-b-layout", 100, 100),
          aspectFitter("panel-b-aspect"),
        ],
      },
    ],
    driven: [],
  };
}

function fixtureMeasure({ component, axis }) {
  return {
    min: component.fixture.min[axis],
    preferred: component.fixture.preferred[axis],
    flexible: component.fixture.flexible[axis],
  };
}

function run(hierarchy = syntheticHierarchy(), options = {}) {
  return rebuildLayout({
    hierarchy,
    dirtyRoots: ["root"],
    measure: fixtureMeasure,
    ...options,
  });
}

const source = fs.readFileSync(
  path.join(ROOT, "public", "render", "layout-rebuilder.js"),
  "utf8",
);
assert.doesNotMatch(source, /official-layout-fitters|ptcgp|PokemonCardUI|TrainersCardUI/);

const baseInput = syntheticHierarchy();
const untouchedInput = clone(baseInput);
const base = run(baseInput);
assert.deepEqual(baseInput, untouchedInput, "rebuildLayout must not mutate its input");
assert.equal(base.converged, true);
assert.equal(base.iterations, 2);
assert.equal(base.rebuildCount, 2);
assert.deepEqual(base.remainingDirtyRoots, []);
const baseNodes = Object.fromEntries(base.hierarchy.nodes.map((node) => [node.id, node]));
assert.deepEqual(base.runtime.groupChildren, {
  "panel-group": ["leaf-a"],
  "root-group": ["panel-a", "panel-b"],
});
assert.deepEqual(baseNodes["panel-a"].rect.sizeDelta, [100, 100]);
assert.deepEqual(baseNodes["panel-b"].rect.sizeDelta, [100, 100]);
assert.deepEqual(baseNodes["leaf-a"].rect.sizeDelta, [100, 100]);
assert.deepEqual(baseNodes["panel-a"].rect.anchoredPosition, [50, -50]);
assert.deepEqual(baseNodes["panel-b"].rect.anchoredPosition, [160, -50]);

const firstIteration = base.trace.filter((entry) => entry.iteration === 1);
const horizontalCalculate = firstIteration.filter(
  (entry) => entry.phase === "horizontal-calculate" && entry.action === "calculate",
);
assert.deepEqual(horizontalCalculate.map((entry) => entry.componentId), [
  "leaf-layout",
  "panel-group",
  "panel-layout",
  "panel-b-layout",
  "root-group",
]);
const horizontalControl = firstIteration.filter(
  (entry) => entry.phase === "horizontal-control"
    && (entry.action === "control" || entry.action === "control-noop"),
);
assert.deepEqual(horizontalControl.map((entry) => entry.componentId), [
  "root-group",
  "panel-fit",
  "panel-group",
  "panel-b-aspect",
]);
const verticalCalculate = firstIteration.filter(
  (entry) => entry.phase === "vertical-calculate" && entry.action === "calculate",
);
assert.deepEqual(
  verticalCalculate.map((entry) => entry.componentId),
  horizontalCalculate.map((entry) => entry.componentId),
);
const verticalControl = firstIteration.filter(
  (entry) => entry.phase === "vertical-control"
    && (entry.action === "control" || entry.action === "control-noop"),
);
assert.deepEqual(
  verticalControl.map((entry) => entry.componentId),
  horizontalControl.map((entry) => entry.componentId),
);
const phaseStarts = firstIteration
  .filter((entry) => entry.action === "phase-start")
  .map((entry) => entry.phase);
assert.deepEqual(phaseStarts, [
  "horizontal-calculate",
  "horizontal-control",
  "vertical-calculate",
  "vertical-control",
]);
assert.ok(
  base.trace.some(
    (entry) => entry.componentId === "panel-b-aspect"
      && entry.action === "control-noop"
      && /SetLayoutHorizontal/.test(entry.reason),
  ),
);
assert.ok(base.hierarchy.driven.some(
  (entry) => entry.driverId === "root-group" && entry.property === "sizeDeltaX",
));
assert.ok(base.hierarchy.driven.some(
  (entry) => entry.driverId === "panel-fit" && entry.property === "sizeDeltaY",
));

const inactiveHierarchy = syntheticHierarchy();
inactiveHierarchy.nodes.find((node) => node.id === "panel-b").activeSelf = false;
const inactive = run(inactiveHierarchy);
assert.deepEqual(inactive.runtime.groupChildren["root-group"], ["panel-a"]);
assert.equal(
  inactive.trace.some((entry) => entry.componentId === "panel-b-layout"),
  false,
);
assert.deepEqual(
  inactive.hierarchy.nodes.find((node) => node.id === "panel-b").rect.sizeDelta,
  [1, 1],
);

const ignoredHierarchy = syntheticHierarchy();
ignoredHierarchy.nodes.find((node) => node.id === "panel-b").components.push({
  id: "ignore-panel-b",
  kind: KIND.LayoutIgnorer,
  ignoreLayout: true,
});
const ignored = run(ignoredHierarchy);
assert.deepEqual(ignored.runtime.groupChildren["root-group"], ["panel-a"]);
const ignoreFalseHierarchy = clone(ignoredHierarchy);
ignoreFalseHierarchy.nodes.find((node) => node.id === "panel-b").components.push({
  id: "keep-panel-b",
  kind: KIND.LayoutIgnorer,
  ignoreLayout: false,
});
const ignoreFalse = run(ignoreFalseHierarchy);
assert.deepEqual(
  ignoreFalse.runtime.groupChildren["root-group"],
  ["panel-a", "panel-b"],
);
const elementIgnorerHierarchy = syntheticHierarchy();
elementIgnorerHierarchy.nodes
  .find((node) => node.id === "panel-b")
  .components
  .find((component) => component.id === "panel-b-layout")
  .ignoreLayout = true;
const elementIgnorer = run(elementIgnorerHierarchy);
assert.deepEqual(elementIgnorer.runtime.groupChildren["root-group"], ["panel-a"]);

const siblingHierarchy = syntheticHierarchy();
siblingHierarchy.nodes.find((node) => node.id === "panel-a").siblingIndex = 1;
siblingHierarchy.nodes.find((node) => node.id === "panel-b").siblingIndex = 0;
const siblingMutation = run(siblingHierarchy);
assert.deepEqual(
  siblingMutation.runtime.groupChildren["root-group"],
  ["panel-b", "panel-a"],
);
const siblingNodes = Object.fromEntries(
  siblingMutation.hierarchy.nodes.map((node) => [node.id, node]),
);
assert.deepEqual(siblingNodes["panel-b"].rect.anchoredPosition, [50, -50]);
assert.deepEqual(siblingNodes["panel-a"].rect.anchoredPosition, [160, -50]);

const defaults = createLayoutRebuilderAdapters();
const activeAdapterMutation = run(syntheticHierarchy(), {
  adapters: createLayoutRebuilderAdapters({
    activeInHierarchy(args) {
      return args.nodeId === "panel-b" ? false : defaults.activeInHierarchy(args);
    },
  }),
});
assert.deepEqual(activeAdapterMutation.runtime.groupChildren["root-group"], ["panel-a"]);

const ignoreAdapterMutation = run(syntheticHierarchy(), {
  adapters: createLayoutRebuilderAdapters({
    layoutIgnored(args) {
      return args.nodeId === "panel-b" || defaults.layoutIgnored(args);
    },
  }),
});
assert.deepEqual(ignoreAdapterMutation.runtime.groupChildren["root-group"], ["panel-a"]);

const siblingAdapterMutation = run(syntheticHierarchy(), {
  adapters: createLayoutRebuilderAdapters({
    childrenInSiblingOrder(args) {
      return defaults.childrenInSiblingOrder(args).reverse();
    },
  }),
});
assert.deepEqual(
  siblingAdapterMutation.runtime.groupChildren["root-group"],
  ["panel-b", "panel-a"],
);

let sizeAdapterCalls = 0;
const sizeAdapterMutation = run(syntheticHierarchy(), {
  maxIterations: 1,
  adapters: createLayoutRebuilderAdapters({
    setSizeWithCurrentAnchors(args) {
      sizeAdapterCalls += 1;
      const result = defaults.setSizeWithCurrentAnchors(args);
      result.sizeDelta[args.axis] += 7;
      return result;
    },
  }),
});
assert.ok(sizeAdapterCalls >= 2);
assert.deepEqual(
  sizeAdapterMutation.hierarchy.nodes.find((node) => node.id === "panel-a").rect.sizeDelta,
  [107, 107],
);
assert.equal(sizeAdapterMutation.converged, false);

const drivenOperations = [];
const clearOperations = [];
const drivenAdapterMutation = run(syntheticHierarchy(), {
  adapters: createLayoutRebuilderAdapters({
    clearDriven(args) {
      clearOperations.push({ nodeId: args.nodeId, driverId: args.driverId });
      return defaults.clearDriven(args);
    },
    writeDrivenRect(args) {
      drivenOperations.push({
        nodeId: args.nodeId,
        driverId: args.driverId,
        properties: [...args.properties],
      });
      return defaults.writeDrivenRect(args);
    },
  }),
});
assert.equal(drivenAdapterMutation.converged, true);
assert.ok(drivenOperations.some(
  (operation) => operation.driverId === "root-group"
    && operation.properties.includes("anchoredPositionX"),
));
assert.ok(clearOperations.some((operation) => operation.driverId === "root-group"));
assert.ok(clearOperations.some((operation) => operation.driverId === "panel-fit"));

const nonConvergent = run(syntheticHierarchy(), {
  maxIterations: 3,
  adapters: createLayoutRebuilderAdapters({
    writeDrivenRect(args) {
      const result = defaults.writeDrivenRect(args);
      return { ...result, dirtyNodeIds: [args.nodeId] };
    },
  }),
});
assert.equal(nonConvergent.converged, false);
assert.equal(nonConvergent.iterations, 3);
assert.deepEqual(nonConvergent.remainingDirtyRoots, ["root"]);

const measuredMutation = run(syntheticHierarchy(), {
  measure(args) {
    const result = fixtureMeasure(args);
    if (args.component.id === "panel-b-layout") {
      return { min: 50, preferred: 50, flexible: result.flexible };
    }
    return result;
  },
});
assert.equal(
  measuredMutation.runtime.layoutElementMetrics["panel-b-layout"].preferred[0],
  50,
);
assert.equal(
  measuredMutation.hierarchy.nodes.find((node) => node.id === "panel-b").rect.sizeDelta[0],
  50,
);

assert.throws(
  () => run(syntheticHierarchy(), {
    adapters: createLayoutRebuilderAdapters({
      childrenInSiblingOrder() {
        return [];
      },
    }),
  }),
  /every child exactly once/,
);
assert.throws(
  () => run(syntheticHierarchy(), {
    measure() {
      return { min: 0, preferred: Number.NaN, flexible: 0 };
    },
  }),
  /preferred must be finite/,
);
const duplicateSibling = syntheticHierarchy();
duplicateSibling.nodes.find((node) => node.id === "panel-b").siblingIndex = 0;
assert.throws(() => run(duplicateSibling), /duplicate siblingIndex/);

const contract = JSON.parse(fs.readFileSync(
  path.join(ROOT, "public", "render", "official-layout-fitters.json"),
  "utf8",
));
const contractRecords = contract.prefabs.flatMap((prefab) => prefab.components);
assert.equal(contractRecords.length, contract.observed.componentCount);
const fixtureGroupRecord = contractRecords.find((record) => {
  if (!record.componentType.endsWith("LayoutGroup")) return false;
  return decodeSerializedLayoutComponent(record).enabled;
});
assert.ok(fixtureGroupRecord);
const fixtureGroup = decodeSerializedLayoutComponent(fixtureGroupRecord);
const fixtureResult = rebuildLayout({
  hierarchy: {
    nodes: [{
      id: "fixture-root",
      parentId: null,
      siblingIndex: 0,
      activeSelf: true,
      rootParentSize: [0, 0],
      rect: rect(32, 32),
      components: [{
        id: "fixture-group",
        kind: KIND.LayoutGroup,
        enabled: fixtureGroup.enabled,
        layoutPriority: 0,
        value: fixtureGroup,
      }],
    }],
  },
  dirtyRoots: ["fixture-root"],
  measure() {
    throw new Error("empty fixture group must not measure");
  },
});
assert.equal(fixtureResult.converged, true);
assert.equal(fixtureResult.iterations, 1);

console.log("Pure LayoutRebuilder scheduler mutation tests OK");
console.log("  four official phases, adapter mutations, dirty convergence, contract fixture");
