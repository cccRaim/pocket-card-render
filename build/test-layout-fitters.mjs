import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ASPECT_MODE,
  CONTENT_FIT_MODE,
  decodeSerializedLayoutComponent,
  executeAspectRatioFitter,
  executeContentSizeFitter,
  executeLayoutGroup,
  rectFromSerialized,
  resolveLayoutMetrics,
  resolveLayoutProperty,
} from "../public/render/layout-fitters.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const contract = JSON.parse(fs.readFileSync(
  path.join(ROOT, "public", "render", "official-layout-fitters.json"),
  "utf8",
));
const records = contract.prefabs.flatMap((prefab) => prefab.components);
const clone = (value) => structuredClone(value);
const close = (actual, expected, label) => {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${label}: ${actual} != ${expected}`);
};

assert.equal(records.length, 127);
const decoded = records.map(decodeSerializedLayoutComponent);
assert.deepEqual(
  decoded.reduce((counts, component) => {
    counts[component.kind] = (counts[component.kind] || 0) + 1;
    return counts;
  }, {}),
  {
    "aspect-ratio": 51,
    "content-size": 5,
    horizontal: 20,
    "layout-element": 43,
    vertical: 8,
  },
);

const serializedLayoutElements = decoded.filter(
  (component) => component.kind === "layout-element",
);
assert.equal(serializedLayoutElements.length, 43);
assert.equal(serializedLayoutElements.filter((component) => component.ignoreLayout).length, 9);
assert(serializedLayoutElements.every((component) => component.layoutPriority === 1));
const sixPixelSpacer = serializedLayoutElements.find(
  (component) => component.min[0] === 6 && component.preferred[0] === 6,
);
assert(sixPixelSpacer, "official illustrator spacing LayoutElement is absent");
const layoutElementRecord = records.find(
  (record) => record.componentType === "LayoutElement",
);
const badLayoutPriority = clone(layoutElementRecord);
badLayoutPriority.serialized.m_LayoutPriority = 1.5;
assert.throws(
  () => decodeSerializedLayoutComponent(badLayoutPriority),
  /must be an integer/,
);
const badIgnoreLayout = clone(layoutElementRecord);
badIgnoreLayout.serialized.m_IgnoreLayout = 2;
assert.throws(
  () => decodeSerializedLayoutComponent(badIgnoreLayout),
  /must be boolean/,
);

for (const record of records.filter((item) => item.componentType === "AspectRatioFitter")) {
  const result = executeAspectRatioFitter({
    component: decodeSerializedLayoutComponent(record),
    rect: rectFromSerialized(record.rectTransform.serialized),
    parentSize: [734, 1024],
  });
  assert.equal(result.applied, false, `${record.gameObject.hierarchyPath} must remain disabled`);
}

const firstGroup = records.find((record) => record.componentType === "HorizontalLayoutGroup");
const missingField = clone(firstGroup);
delete missingField.serialized.m_Spacing;
assert.throws(() => decodeSerializedLayoutComponent(missingField), /field set changed/);
const futureField = clone(firstGroup);
futureField.serialized.m_MaxSpacing = 10;
assert.throws(() => decodeSerializedLayoutComponent(futureField), /field set changed/);
const badBoolean = clone(firstGroup);
badBoolean.serialized.m_ReverseArrangement = 2;
assert.throws(() => decodeSerializedLayoutComponent(badBoolean), /must be boolean/);
const unsupportedType = clone(firstGroup);
unsupportedType.componentType = "GridLayoutGroup";
assert.throws(() => decodeSerializedLayoutComponent(unsupportedType), /unsupported/);

const elements = [
  {
    id: "low",
    activeAndEnabled: true,
    priority: 0,
    min: [30, 20],
    preferred: [100, 60],
    flexible: [0, 0],
  },
  {
    id: "high",
    activeAndEnabled: true,
    priority: 2,
    min: [20, -1],
    preferred: [50, -1],
    flexible: [1, -1],
  },
  {
    id: "high-max",
    activeAndEnabled: true,
    priority: 2,
    min: [25, -1],
    preferred: [70, -1],
    flexible: [2, -1],
  },
  {
    id: "disabled",
    activeAndEnabled: false,
    priority: 99,
    min: [999, 999],
    preferred: [999, 999],
    flexible: [999, 999],
  },
];
assert.deepEqual(resolveLayoutMetrics(elements), {
  min: [25, 20],
  preferred: [70, 60],
  flexible: [2, 0],
});
assert.deepEqual(resolveLayoutProperty(elements, "preferred", 0), {
  value: 70,
  sourceId: "high-max",
  priority: 2,
});
const priorityMutation = clone(elements);
priorityMutation[0].priority = 3;
assert.equal(resolveLayoutMetrics(priorityMutation).preferred[0], 100);
const negativeMutation = clone(elements);
negativeMutation[1].preferred[0] = -1;
negativeMutation[2].preferred[0] = -1;
assert.equal(resolveLayoutMetrics(negativeMutation).preferred[0], 100);

const baseRect = (size, scale = [1, 1]) => ({
  anchorMin: [0.5, 0.5],
  anchorMax: [0.5, 0.5],
  anchoredPosition: [0, 0],
  sizeDelta: size,
  pivot: [0.5, 0.5],
  localScale: scale,
});
const child = (id, metrics, size, extra = {}) => ({
  id,
  activeInHierarchy: true,
  ignoreLayout: false,
  rect: baseRect(size, extra.scale || [1, 1]),
  layoutElements: [{
    id: `${id}-layout`,
    activeAndEnabled: true,
    priority: 1,
    min: metrics.min,
    preferred: metrics.preferred,
    flexible: metrics.flexible,
  }],
  ...extra,
});
const horizontal = {
  kind: "horizontal",
  enabled: true,
  padding: { left: 10, right: 20, top: 5, bottom: 5 },
  childAlignment: 0,
  spacing: 5,
  childForceExpand: [false, false],
  childControl: [true, true],
  childScale: [false, false],
  reverseArrangement: false,
};
const groupChildren = [
  child("a", { min: [50, 20], preferred: [100, 30], flexible: [0, 0] }, [2, 2]),
  child("b", { min: [30, 10], preferred: [50, 40], flexible: [1, 0] }, [2, 2]),
  child(
    "ignored",
    { min: [999, 999], preferred: [999, 999], flexible: [0, 0] },
    [999, 999],
    { ignoreLayout: true },
  ),
];
const laidOut = executeLayoutGroup({
  component: horizontal,
  containerSize: [300, 100],
  children: groupChildren,
});
assert.deepEqual(laidOut.includedChildIds, ["a", "b"]);
assert.deepEqual(laidOut.layoutInput, {
  min: [115, 30],
  preferred: [185, 50],
  flexible: [1, 0],
});
assert.deepEqual(laidOut.children[0].rect.sizeDelta, [100, 30]);
assert.deepEqual(laidOut.children[1].rect.sizeDelta, [165, 40]);
close(laidOut.children[0].rect.anchoredPosition[0], 60, "child a x");
close(laidOut.children[1].rect.anchoredPosition[0], 197.5, "child b x");
close(laidOut.children[0].rect.anchoredPosition[1], -20, "child a y");
close(laidOut.children[1].rect.anchoredPosition[1], -25, "child b y");
assert.deepEqual(laidOut.children[2].rect, baseRect([999, 999]));

const spacingMutation = executeLayoutGroup({
  component: { ...horizontal, spacing: 15 },
  containerSize: [300, 100],
  children: groupChildren,
});
assert.notDeepEqual(spacingMutation.layoutInput, laidOut.layoutInput);
assert.notEqual(
  spacingMutation.children[1].rect.anchoredPosition[0],
  laidOut.children[1].rect.anchoredPosition[0],
);
const reverseMutation = executeLayoutGroup({
  component: { ...horizontal, reverseArrangement: true },
  containerSize: [300, 100],
  children: groupChildren,
});
assert.ok(
  reverseMutation.children[1].rect.anchoredPosition[0]
  < reverseMutation.children[0].rect.anchoredPosition[0],
);
const scaleMutationChildren = clone(groupChildren);
scaleMutationChildren[0].rect.localScale = [2, 1];
const scaleMutation = executeLayoutGroup({
  component: { ...horizontal, childScale: [true, false] },
  containerSize: [300, 100],
  children: scaleMutationChildren,
});
assert.notDeepEqual(scaleMutation.layoutInput, laidOut.layoutInput);
assert.throws(
  () => executeLayoutGroup({
    component: { ...horizontal, childAlignment: 9 },
    containerSize: [300, 100],
    children: groupChildren,
  }),
  /unsupported value/,
);

const fitterRect = {
  anchorMin: [0, 0],
  anchorMax: [1, 0],
  anchoredPosition: [0, 0],
  sizeDelta: [10, 20],
  pivot: [0.5, 0.5],
  localScale: [1, 1],
};
const fitted = executeContentSizeFitter({
  component: {
    kind: "content-size",
    enabled: true,
    fit: [CONTENT_FIT_MODE.PreferredSize, CONTENT_FIT_MODE.MinSize],
  },
  rect: fitterRect,
  parentSize: [100, 100],
  layoutElements: [{
    id: "text",
    activeAndEnabled: true,
    priority: 0,
    min: [30, 40],
    preferred: [80, 90],
    flexible: [0, 0],
  }],
});
assert.deepEqual(fitted.driven, ["sizeDeltaX", "sizeDeltaY"]);
assert.deepEqual(fitted.rect.sizeDelta, [-20, 40]);
const fitModeMutation = executeContentSizeFitter({
  component: { kind: "content-size", enabled: true, fit: [1, 2] },
  rect: fitterRect,
  parentSize: [100, 100],
  layoutElements: [{
    id: "text",
    activeAndEnabled: true,
    priority: 0,
    min: [30, 40],
    preferred: [80, 90],
    flexible: [0, 0],
  }],
});
assert.deepEqual(fitModeMutation.rect.sizeDelta, [-70, 90]);
assert.throws(
  () => executeContentSizeFitter({
    component: { kind: "content-size", enabled: true, fit: [3, 0] },
    rect: fitterRect,
    parentSize: [100, 100],
    layoutElements: [],
  }),
  /unsupported value/,
);

const aspectRect = baseRect([100, 50]);
const aspect = (aspectMode, aspectRatio = 1) => ({
  kind: "aspect-ratio",
  enabled: true,
  aspectMode,
  aspectRatio,
});
assert.deepEqual(
  executeAspectRatioFitter({
    component: aspect(ASPECT_MODE.WidthControlsHeight),
    rect: aspectRect,
    parentSize: [200, 100],
  }).rect.sizeDelta,
  [100, 100],
);
assert.deepEqual(
  executeAspectRatioFitter({
    component: aspect(ASPECT_MODE.HeightControlsWidth, 2),
    rect: aspectRect,
    parentSize: [200, 100],
  }).rect.sizeDelta,
  [100, 50],
);
assert.deepEqual(
  executeAspectRatioFitter({
    component: aspect(ASPECT_MODE.FitInParent),
    rect: aspectRect,
    parentSize: [200, 100],
  }).rect,
  {
    anchorMin: [0, 0],
    anchorMax: [1, 1],
    anchoredPosition: [0, 0],
    sizeDelta: [-100, 0],
    pivot: [0.5, 0.5],
    localScale: [1, 1],
  },
);
assert.deepEqual(
  executeAspectRatioFitter({
    component: aspect(ASPECT_MODE.EnvelopeParent),
    rect: aspectRect,
    parentSize: [200, 100],
  }).rect.sizeDelta,
  [0, 100],
);
assert.equal(
  executeAspectRatioFitter({
    component: aspect(ASPECT_MODE.FitInParent),
    rect: aspectRect,
    parentSize: null,
  }).applied,
  false,
);
assert.equal(
  executeAspectRatioFitter({
    component: aspect(ASPECT_MODE.WidthControlsHeight),
    rect: aspectRect,
    parentSize: [200, 100],
    isRootScreenCanvas: true,
  }).applied,
  false,
);
assert.throws(
  () => executeAspectRatioFitter({
    component: aspect(ASPECT_MODE.WidthControlsHeight, 0),
    rect: aspectRect,
    parentSize: [200, 100],
  }),
  /must be positive/,
);

console.log("Official layout fitter contract/executor mutation tests OK");
console.log("  127/127 serialized components decoded; all layout elements, fitter modes and group controls gated");
