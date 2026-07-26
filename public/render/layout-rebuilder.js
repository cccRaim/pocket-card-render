import {
  CONTENT_FIT_MODE,
  calculateLayoutGroupAxis,
  controlLayoutGroupAxis,
  resolveLayoutMetrics,
} from "./layout-fitters.js";

export const LAYOUT_REBUILDER_COMPONENT_KIND = Object.freeze({
  LayoutElement: "layout-element",
  LayoutGroup: "layout-group",
  ContentSizeFitter: "content-size-fitter",
  AspectRatioFitter: "aspect-ratio-fitter",
  LayoutIgnorer: "layout-ignorer",
});

const CONTROLLER_KINDS = new Set([
  LAYOUT_REBUILDER_COMPONENT_KIND.LayoutGroup,
  LAYOUT_REBUILDER_COMPONENT_KIND.ContentSizeFitter,
  LAYOUT_REBUILDER_COMPONENT_KIND.AspectRatioFitter,
]);
const SELF_CONTROLLER_KINDS = new Set([
  LAYOUT_REBUILDER_COMPONENT_KIND.ContentSizeFitter,
  LAYOUT_REBUILDER_COMPONENT_KIND.AspectRatioFitter,
]);
const LAYOUT_ELEMENT_KINDS = new Set([
  LAYOUT_REBUILDER_COMPONENT_KIND.LayoutElement,
  LAYOUT_REBUILDER_COMPONENT_KIND.LayoutGroup,
]);
const RECT_PROPERTIES = Object.freeze([
  "anchorMin",
  "anchorMax",
  "anchoredPosition",
  "sizeDelta",
  "pivot",
  "localScale",
]);
const ADAPTER_KEYS = Object.freeze([
  "activeInHierarchy",
  "layoutIgnored",
  "childrenInSiblingOrder",
  "setSizeWithCurrentAnchors",
  "clearDriven",
  "writeDrivenRect",
]);

function fail(message) {
  throw new TypeError(`layout rebuilder: ${message}`);
}

function finite(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value)) fail(`${label} must be finite`);
  return value;
}

function integer(value, label) {
  if (!Number.isInteger(value)) fail(`${label} must be an integer`);
  return value;
}

function bool(value, label) {
  if (value !== true && value !== false) fail(`${label} must be boolean`);
  return value;
}

function vec2(value, label) {
  if (!Array.isArray(value) || value.length !== 2) fail(`${label} must be vec2`);
  return [finite(value[0], `${label}[0]`), finite(value[1], `${label}[1]`)];
}

function cloneRect(rect, label) {
  if (!rect || typeof rect !== "object" || Array.isArray(rect)) fail(`${label} must be an object`);
  return Object.fromEntries(
    RECT_PROPERTIES.map((property) => [
      property,
      vec2(rect[property], `${label}.${property}`),
    ]),
  );
}

function cloneValue(value) {
  return structuredClone(value);
}

function rectEqual(left, right) {
  return RECT_PROPERTIES.every(
    (property) => left[property][0] === right[property][0]
      && left[property][1] === right[property][1],
  );
}

function componentEnabled(component, activeInHierarchy) {
  return activeInHierarchy && component.enabled;
}

function componentPriority(component) {
  if (component.kind === LAYOUT_REBUILDER_COMPONENT_KIND.LayoutGroup) {
    return component.layoutPriority ?? 0;
  }
  return component.layoutPriority;
}

function defaultActiveInHierarchy({ nodes, nodeId }) {
  let current = nodes.get(nodeId);
  while (current) {
    if (!current.activeSelf) return false;
    current = current.parentId === null ? null : nodes.get(current.parentId);
  }
  return true;
}

function defaultLayoutIgnored({ node }) {
  const ignorers = node.components.filter((component) => (
    component.kind === LAYOUT_REBUILDER_COMPONENT_KIND.LayoutIgnorer
    || Object.hasOwn(component, "ignoreLayout")
  ));
  return ignorers.length > 0 && ignorers.every((component) => component.ignoreLayout);
}

function defaultChildrenInSiblingOrder({ nodes, candidateIds }) {
  return [...candidateIds].sort((leftId, rightId) => {
    const difference = nodes.get(leftId).siblingIndex - nodes.get(rightId).siblingIndex;
    return difference || leftId.localeCompare(rightId);
  });
}

function defaultSetSizeWithCurrentAnchors({ rect, parentSize, axis, size }) {
  const nextRect = cloneRect(rect, "setSizeWithCurrentAnchors.rect");
  const parent = vec2(parentSize, "setSizeWithCurrentAnchors.parentSize");
  integer(axis, "setSizeWithCurrentAnchors.axis");
  if (axis !== 0 && axis !== 1) fail("setSizeWithCurrentAnchors.axis must be 0 or 1");
  nextRect.sizeDelta[axis] = finite(size, "setSizeWithCurrentAnchors.size")
    - parent[axis] * (nextRect.anchorMax[axis] - nextRect.anchorMin[axis]);
  return nextRect;
}

function defaultClearDriven({ driven, driverId }) {
  return driven.filter((entry) => entry.driverId !== driverId);
}

function defaultWriteDrivenRect({
  driven,
  nodeId,
  driverId,
  previousRect,
  nextRect,
  properties,
}) {
  const changed = !rectEqual(previousRect, nextRect);
  const propertySet = new Set(properties);
  const nextDriven = driven.filter(
    (entry) => entry.nodeId !== nodeId || !propertySet.has(entry.property),
  );
  for (const property of properties) {
    nextDriven.push({ nodeId, property, driverId });
  }
  return {
    rect: cloneRect(nextRect, "writeDrivenRect.nextRect"),
    driven: nextDriven,
    changed,
    dirtyNodeIds: changed ? [nodeId] : [],
  };
}

export function createLayoutRebuilderAdapters(overrides = {}) {
  if (!overrides || typeof overrides !== "object" || Array.isArray(overrides)) {
    fail("adapter overrides must be an object");
  }
  for (const key of Object.keys(overrides)) {
    if (!ADAPTER_KEYS.includes(key)) fail(`unknown adapter ${key}`);
    if (typeof overrides[key] !== "function") fail(`adapter ${key} must be a function`);
  }
  return Object.freeze({
    activeInHierarchy: defaultActiveInHierarchy,
    layoutIgnored: defaultLayoutIgnored,
    childrenInSiblingOrder: defaultChildrenInSiblingOrder,
    setSizeWithCurrentAnchors: defaultSetSizeWithCurrentAnchors,
    clearDriven: defaultClearDriven,
    writeDrivenRect: defaultWriteDrivenRect,
    ...overrides,
  });
}

function normalizeComponent(component, nodeId, index) {
  const label = `nodes[${nodeId}].components[${index}]`;
  if (!component || typeof component !== "object" || Array.isArray(component)) {
    fail(`${label} must be an object`);
  }
  if (typeof component.id !== "string" || component.id.length === 0) {
    fail(`${label}.id must be a non-empty string`);
  }
  if (!Object.values(LAYOUT_REBUILDER_COMPONENT_KIND).includes(component.kind)) {
    fail(`${label}.kind is unsupported`);
  }
  const normalized = cloneValue(component);
  if (component.kind === LAYOUT_REBUILDER_COMPONENT_KIND.LayoutIgnorer) {
    normalized.ignoreLayout = bool(component.ignoreLayout, `${label}.ignoreLayout`);
    return normalized;
  }
  if (Object.hasOwn(component, "ignoreLayout")) {
    normalized.ignoreLayout = bool(component.ignoreLayout, `${label}.ignoreLayout`);
  }
  normalized.enabled = bool(component.enabled, `${label}.enabled`);
  if (LAYOUT_ELEMENT_KINDS.has(component.kind)) {
    normalized.layoutPriority = integer(
      componentPriority(component),
      `${label}.layoutPriority`,
    );
  }
  if (component.kind !== LAYOUT_REBUILDER_COMPONENT_KIND.LayoutElement) {
    if (!component.value || typeof component.value !== "object" || Array.isArray(component.value)) {
      fail(`${label}.value must be an object`);
    }
    normalized.value = { ...cloneValue(component.value), enabled: normalized.enabled };
  }
  return normalized;
}

function normalizeHierarchy(hierarchy) {
  if (!hierarchy || typeof hierarchy !== "object" || Array.isArray(hierarchy)) {
    fail("hierarchy must be an object");
  }
  if (!Array.isArray(hierarchy.nodes)) fail("hierarchy.nodes must be an array");
  const cloned = cloneValue(hierarchy);
  cloned.driven = Array.isArray(cloned.driven) ? cloned.driven : [];
  const nodes = new Map();
  const componentIds = new Set();
  cloned.nodes = cloned.nodes.map((node, index) => {
    const label = `hierarchy.nodes[${index}]`;
    if (!node || typeof node !== "object" || Array.isArray(node)) {
      fail(`${label} must be an object`);
    }
    if (typeof node.id !== "string" || node.id.length === 0) {
      fail(`${label}.id must be a non-empty string`);
    }
    if (nodes.has(node.id)) fail(`duplicate node id ${node.id}`);
    const normalized = {
      ...cloneValue(node),
      parentId: node.parentId === null ? null : String(node.parentId),
      siblingIndex: integer(node.siblingIndex, `${label}.siblingIndex`),
      activeSelf: bool(node.activeSelf, `${label}.activeSelf`),
      rect: cloneRect(node.rect, `${label}.rect`),
      components: Array.isArray(node.components)
        ? node.components.map((component, componentIndex) => (
          normalizeComponent(component, node.id, componentIndex)
        ))
        : fail(`${label}.components must be an array`),
    };
    if (normalized.parentId === null) {
      normalized.rootParentSize = vec2(node.rootParentSize, `${label}.rootParentSize`);
    }
    for (const component of normalized.components) {
      if (componentIds.has(component.id)) fail(`duplicate component id ${component.id}`);
      componentIds.add(component.id);
    }
    nodes.set(normalized.id, normalized);
    return normalized;
  });
  for (const node of cloned.nodes) {
    if (node.parentId !== null && !nodes.has(node.parentId)) {
      fail(`node ${node.id} has missing parent ${node.parentId}`);
    }
  }
  for (const node of cloned.nodes) {
    const seen = new Set([node.id]);
    let parentId = node.parentId;
    while (parentId !== null) {
      if (seen.has(parentId)) fail(`hierarchy cycle at ${parentId}`);
      seen.add(parentId);
      parentId = nodes.get(parentId).parentId;
    }
  }
  const siblings = new Map();
  for (const node of cloned.nodes) {
    const key = node.parentId ?? "<root>";
    const used = siblings.get(key) ?? new Set();
    if (used.has(node.siblingIndex)) {
      fail(`duplicate siblingIndex ${node.siblingIndex} under ${key}`);
    }
    used.add(node.siblingIndex);
    siblings.set(key, used);
  }
  cloned.driven = cloned.driven.map((entry, index) => {
    if (!entry || typeof entry !== "object") fail(`hierarchy.driven[${index}] is invalid`);
    if (!nodes.has(entry.nodeId)) fail(`driven entry references missing node ${entry.nodeId}`);
    if (!componentIds.has(entry.driverId)) {
      fail(`driven entry references missing driver ${entry.driverId}`);
    }
    if (typeof entry.property !== "string" || entry.property.length === 0) {
      fail(`hierarchy.driven[${index}].property is invalid`);
    }
    return {
      nodeId: entry.nodeId,
      property: entry.property,
      driverId: entry.driverId,
    };
  });
  return { hierarchy: cloned, nodes, componentIds };
}

function buildChildrenIndex(nodes) {
  const result = new Map();
  for (const node of nodes.values()) {
    const key = node.parentId;
    const children = result.get(key) ?? [];
    children.push(node.id);
    result.set(key, children);
  }
  return result;
}

function validatePermutation(actual, expected, label) {
  if (!Array.isArray(actual) || actual.length !== expected.length) {
    fail(`${label} must return every child exactly once`);
  }
  const actualSet = new Set(actual);
  if (actualSet.size !== actual.length || expected.some((id) => !actualSet.has(id))) {
    fail(`${label} must return a permutation of candidate children`);
  }
  return actual;
}

function adapterContext(runtime, extra = {}) {
  return {
    hierarchy: runtime.hierarchy,
    nodes: runtime.nodes,
    ...extra,
  };
}

function activeInHierarchy(runtime, nodeId) {
  const value = runtime.adapters.activeInHierarchy(
    adapterContext(runtime, { nodeId, node: runtime.nodes.get(nodeId) }),
  );
  return bool(value, `activeInHierarchy(${nodeId})`);
}

function childrenInSiblingOrder(runtime, nodeId) {
  const candidateIds = runtime.childrenByParent.get(nodeId) ?? [];
  const value = runtime.adapters.childrenInSiblingOrder(
    adapterContext(runtime, {
      nodeId,
      node: runtime.nodes.get(nodeId),
      candidateIds: [...candidateIds],
    }),
  );
  return validatePermutation(value, candidateIds, `childrenInSiblingOrder(${nodeId})`);
}

function layoutIgnored(runtime, nodeId) {
  const value = runtime.adapters.layoutIgnored(
    adapterContext(runtime, { nodeId, node: runtime.nodes.get(nodeId) }),
  );
  return bool(value, `layoutIgnored(${nodeId})`);
}

function activeComponents(runtime, nodeId, kinds) {
  const node = runtime.nodes.get(nodeId);
  const active = activeInHierarchy(runtime, nodeId);
  return node.components.filter(
    (component) => kinds.has(component.kind) && componentEnabled(component, active),
  );
}

function rectSize(runtime, nodeId, visiting = new Set()) {
  if (visiting.has(nodeId)) fail(`rect size recursion at ${nodeId}`);
  visiting.add(nodeId);
  const node = runtime.nodes.get(nodeId);
  const parentSize = node.parentId === null
    ? node.rootParentSize
    : rectSize(runtime, node.parentId, visiting);
  visiting.delete(nodeId);
  return [0, 1].map(
    (axis) => parentSize[axis] * (node.rect.anchorMax[axis] - node.rect.anchorMin[axis])
      + node.rect.sizeDelta[axis],
  );
}

function parentSize(runtime, nodeId) {
  const node = runtime.nodes.get(nodeId);
  return node.parentId === null ? [...node.rootParentSize] : rectSize(runtime, node.parentId);
}

function emptyMetrics() {
  return {
    min: [0, 0],
    preferred: [0, 0],
    flexible: [0, 0],
  };
}

function getMetrics(runtime, component) {
  if (!runtime.metrics.has(component.id)) {
    if (component.kind !== LAYOUT_REBUILDER_COMPONENT_KIND.LayoutGroup) {
      fail(`layout element ${component.id} was not measured`);
    }
    runtime.metrics.set(component.id, emptyMetrics());
  }
  return runtime.metrics.get(component.id);
}

function layoutElementDescriptors(runtime, nodeId) {
  return activeComponents(runtime, nodeId, LAYOUT_ELEMENT_KINDS).map((component) => ({
    id: component.id,
    activeAndEnabled: true,
    priority: componentPriority(component),
    ...cloneValue(getMetrics(runtime, component)),
  }));
}

function groupChildren(runtime, childIds) {
  return childIds.map((childId) => ({
    id: childId,
    activeInHierarchy: true,
    ignoreLayout: false,
    rect: cloneRect(runtime.nodes.get(childId).rect, `node ${childId}.rect`),
    layoutElements: layoutElementDescriptors(runtime, childId),
  }));
}

function trace(runtime, entry) {
  runtime.trace.push({
    iteration: runtime.iteration,
    rootId: runtime.currentRootId,
    ...entry,
  });
}

function clearDriven(runtime, nodeId, driverId, phase) {
  const result = runtime.adapters.clearDriven(adapterContext(runtime, {
    driven: cloneValue(runtime.hierarchy.driven),
    nodeId,
    driverId,
    phase,
  }));
  if (!Array.isArray(result)) fail("clearDriven must return a driven array");
  runtime.hierarchy.driven = cloneValue(result);
}

function writeDrivenRect(runtime, {
  nodeId,
  driverId,
  nextRect,
  properties,
  phase,
}) {
  const node = runtime.nodes.get(nodeId);
  const previousRect = cloneRect(node.rect, `node ${nodeId}.rect`);
  const normalizedNext = cloneRect(nextRect, `next rect for ${nodeId}`);
  const result = runtime.adapters.writeDrivenRect(adapterContext(runtime, {
    driven: cloneValue(runtime.hierarchy.driven),
    nodeId,
    driverId,
    previousRect,
    nextRect: normalizedNext,
    properties: [...properties],
    phase,
  }));
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    fail("writeDrivenRect must return an object");
  }
  node.rect = cloneRect(result.rect, `writeDrivenRect(${nodeId}).rect`);
  if (!Array.isArray(result.driven)) fail("writeDrivenRect.driven must be an array");
  runtime.hierarchy.driven = cloneValue(result.driven);
  bool(result.changed, "writeDrivenRect.changed");
  if (!Array.isArray(result.dirtyNodeIds)) {
    fail("writeDrivenRect.dirtyNodeIds must be an array");
  }
  for (const dirtyNodeId of result.dirtyNodeIds) {
    if (!runtime.nodes.has(dirtyNodeId)) {
      fail(`writeDrivenRect returned missing dirty node ${dirtyNodeId}`);
    }
    runtime.roundDirty.add(dirtyNodeId);
  }
  trace(runtime, {
    phase,
    action: "driven-write",
    nodeId,
    componentId: driverId,
    properties: [...properties],
    changed: result.changed,
  });
}

function measureLayoutElement(runtime, nodeId, component, axis, phase) {
  const measured = runtime.measure({
    hierarchy: runtime.hierarchy,
    node: cloneValue(runtime.nodes.get(nodeId)),
    component: cloneValue(component),
    axis,
    phase,
    iteration: runtime.iteration,
    rootId: runtime.currentRootId,
  });
  if (!measured || typeof measured !== "object" || Array.isArray(measured)) {
    fail(`measure(${component.id}) must return an object`);
  }
  const metrics = runtime.metrics.get(component.id) ?? emptyMetrics();
  runtime.metrics.set(component.id, metrics);
  metrics.min[axis] = finite(measured.min, `measure(${component.id}).min`);
  metrics.preferred[axis] = finite(
    measured.preferred,
    `measure(${component.id}).preferred`,
  );
  metrics.flexible[axis] = finite(
    measured.flexible,
    `measure(${component.id}).flexible`,
  );
  trace(runtime, {
    phase,
    action: "calculate",
    nodeId,
    componentId: component.id,
    componentKind: component.kind,
  });
}

function calculateGroup(runtime, nodeId, component, axis, phase) {
  if (axis === 0) {
    clearDriven(runtime, nodeId, component.id, phase);
    const candidates = childrenInSiblingOrder(runtime, nodeId).map((childId) => ({
      id: childId,
      activeInHierarchy: activeInHierarchy(runtime, childId),
      ignoreLayout: layoutIgnored(runtime, childId),
      rect: cloneRect(runtime.nodes.get(childId).rect, `node ${childId}.rect`),
      layoutElements: layoutElementDescriptors(runtime, childId),
    }));
    const calculated = calculateLayoutGroupAxis({
      component: component.value,
      children: candidates,
      axis,
    });
    runtime.groupChildren.set(component.id, calculated.includedChildIds);
    const metrics = getMetrics(runtime, component);
    metrics.min[axis] = calculated.layoutInput.min;
    metrics.preferred[axis] = calculated.layoutInput.preferred;
    metrics.flexible[axis] = calculated.layoutInput.flexible;
  } else {
    if (!runtime.groupChildren.has(component.id)) {
      fail(`layout group ${component.id} has no horizontal child snapshot`);
    }
    const calculated = calculateLayoutGroupAxis({
      component: component.value,
      children: groupChildren(runtime, runtime.groupChildren.get(component.id)),
      axis,
    });
    const metrics = getMetrics(runtime, component);
    metrics.min[axis] = calculated.layoutInput.min;
    metrics.preferred[axis] = calculated.layoutInput.preferred;
    metrics.flexible[axis] = calculated.layoutInput.flexible;
  }
  trace(runtime, {
    phase,
    action: "calculate",
    nodeId,
    componentId: component.id,
    componentKind: component.kind,
    childIds: [...runtime.groupChildren.get(component.id)],
  });
}

function performCalculation(runtime, nodeId, axis, phase) {
  const node = runtime.nodes.get(nodeId);
  const activeElements = activeComponents(runtime, nodeId, LAYOUT_ELEMENT_KINDS);
  const hasAnyLayoutGroup = node.components.some(
    (component) => component.kind === LAYOUT_REBUILDER_COMPONENT_KIND.LayoutGroup,
  );
  if (activeElements.length === 0 && !hasAnyLayoutGroup) return;
  for (const childId of childrenInSiblingOrder(runtime, nodeId)) {
    performCalculation(runtime, childId, axis, phase);
  }
  for (const component of activeElements) {
    if (component.kind === LAYOUT_REBUILDER_COMPONENT_KIND.LayoutGroup) {
      calculateGroup(runtime, nodeId, component, axis, phase);
    } else {
      measureLayoutElement(runtime, nodeId, component, axis, phase);
    }
  }
}

function controlContentSizeFitter(runtime, nodeId, component, axis, phase) {
  if (component.value.kind !== "content-size") {
    fail(`content fitter ${component.id} has invalid value.kind`);
  }
  if (axis === 0) clearDriven(runtime, nodeId, component.id, phase);
  const fit = component.value.fit?.[axis];
  if (![0, 1, 2].includes(fit)) fail(`content fitter ${component.id} has invalid fit mode`);
  trace(runtime, {
    phase,
    action: "control",
    nodeId,
    componentId: component.id,
    componentKind: component.kind,
  });
  if (fit === CONTENT_FIT_MODE.Unconstrained) return;
  const metrics = resolveLayoutMetrics(layoutElementDescriptors(runtime, nodeId));
  const target = fit === CONTENT_FIT_MODE.MinSize
    ? metrics.min[axis]
    : metrics.preferred[axis];
  const nextRect = runtime.adapters.setSizeWithCurrentAnchors(adapterContext(runtime, {
    nodeId,
    driverId: component.id,
    rect: cloneRect(runtime.nodes.get(nodeId).rect, `node ${nodeId}.rect`),
    parentSize: parentSize(runtime, nodeId),
    axis,
    size: target,
    phase,
  }));
  writeDrivenRect(runtime, {
    nodeId,
    driverId: component.id,
    nextRect,
    properties: [axis === 0 ? "sizeDeltaX" : "sizeDeltaY"],
    phase,
  });
}

function controlAspectRatioFitter(runtime, nodeId, component, phase) {
  if (component.value.kind !== "aspect-ratio") {
    fail(`aspect fitter ${component.id} has invalid value.kind`);
  }
  trace(runtime, {
    phase,
    action: "control-noop",
    nodeId,
    componentId: component.id,
    componentKind: component.kind,
    reason: "official SetLayoutHorizontal/SetLayoutVertical are empty",
  });
}

function controlGroup(runtime, nodeId, component, axis, phase) {
  const childIds = runtime.groupChildren.get(component.id);
  if (!childIds) fail(`layout group ${component.id} has no calculated children`);
  const controlled = controlLayoutGroupAxis({
    component: component.value,
    containerSize: rectSize(runtime, nodeId),
    children: groupChildren(runtime, childIds),
    layoutInput: getMetrics(runtime, component),
    axis,
  });
  const controlledById = new Map(controlled.children.map((child) => [child.id, child]));
  const properties = [
    "anchors",
    axis === 0 ? "anchoredPositionX" : "anchoredPositionY",
  ];
  if (component.value.childControl?.[axis]) {
    properties.push(axis === 0 ? "sizeDeltaX" : "sizeDeltaY");
  }
  trace(runtime, {
    phase,
    action: "control",
    nodeId,
    componentId: component.id,
    componentKind: component.kind,
    childIds: [...childIds],
  });
  for (const childId of childIds) {
    const controlledChild = controlledById.get(childId);
    if (!controlledChild) fail(`layout group ${component.id} lost child ${childId}`);
    writeDrivenRect(runtime, {
      nodeId: childId,
      driverId: component.id,
      nextRect: controlledChild.rect,
      properties,
      phase,
    });
  }
}

function performControl(runtime, nodeId, axis, phase) {
  const controllers = activeComponents(runtime, nodeId, CONTROLLER_KINDS);
  if (controllers.length === 0) return;
  for (const component of controllers) {
    if (!SELF_CONTROLLER_KINDS.has(component.kind)) continue;
    if (component.kind === LAYOUT_REBUILDER_COMPONENT_KIND.ContentSizeFitter) {
      controlContentSizeFitter(runtime, nodeId, component, axis, phase);
    } else {
      controlAspectRatioFitter(runtime, nodeId, component, phase);
    }
  }
  for (const component of controllers) {
    if (SELF_CONTROLLER_KINDS.has(component.kind)) continue;
    controlGroup(runtime, nodeId, component, axis, phase);
  }
  for (const childId of childrenInSiblingOrder(runtime, nodeId)) {
    performControl(runtime, childId, axis, phase);
  }
}

function runRootPass(runtime, rootId) {
  runtime.currentRootId = rootId;
  const phases = [
    ["horizontal-calculate", () => performCalculation(runtime, rootId, 0, "horizontal-calculate")],
    ["horizontal-control", () => performControl(runtime, rootId, 0, "horizontal-control")],
    ["vertical-calculate", () => performCalculation(runtime, rootId, 1, "vertical-calculate")],
    ["vertical-control", () => performControl(runtime, rootId, 1, "vertical-control")],
  ];
  for (const [phase, execute] of phases) {
    trace(runtime, { phase, action: "phase-start", nodeId: rootId });
    execute();
    trace(runtime, { phase, action: "phase-end", nodeId: rootId });
  }
}

function hasActiveGroup(runtime, nodeId) {
  return activeComponents(
    runtime,
    nodeId,
    new Set([LAYOUT_REBUILDER_COMPONENT_KIND.LayoutGroup]),
  ).length > 0;
}

function hasActiveController(runtime, nodeId) {
  return activeComponents(runtime, nodeId, CONTROLLER_KINDS).length > 0;
}

function layoutRootForDirtyNode(runtime, nodeId) {
  let layoutRootId = nodeId;
  let parentId = runtime.nodes.get(nodeId).parentId;
  while (parentId !== null && hasActiveGroup(runtime, parentId)) {
    layoutRootId = parentId;
    parentId = runtime.nodes.get(parentId).parentId;
  }
  if (layoutRootId === nodeId && !hasActiveController(runtime, nodeId)) return null;
  return layoutRootId;
}

function isAncestor(runtime, ancestorId, nodeId) {
  let currentId = runtime.nodes.get(nodeId).parentId;
  while (currentId !== null) {
    if (currentId === ancestorId) return true;
    currentId = runtime.nodes.get(currentId).parentId;
  }
  return false;
}

function traversalRank(runtime) {
  const rank = new Map();
  let next = 0;
  const roots = runtime.childrenByParent.get(null) ?? [];
  const orderedRoots = runtime.adapters.childrenInSiblingOrder(adapterContext(runtime, {
    nodeId: null,
    node: null,
    candidateIds: [...roots],
  }));
  validatePermutation(orderedRoots, roots, "childrenInSiblingOrder(<roots>)");
  const visit = (nodeId) => {
    rank.set(nodeId, next);
    next += 1;
    for (const childId of childrenInSiblingOrder(runtime, nodeId)) visit(childId);
  };
  for (const rootId of orderedRoots) visit(rootId);
  return rank;
}

function canonicalDirtyRoots(runtime, dirtyNodeIds) {
  const roots = [];
  for (const nodeId of dirtyNodeIds) {
    if (!runtime.nodes.has(nodeId)) fail(`dirty node ${nodeId} does not exist`);
    const rootId = layoutRootForDirtyNode(runtime, nodeId);
    if (rootId !== null && !roots.includes(rootId)) roots.push(rootId);
  }
  const minimal = roots.filter(
    (rootId) => !roots.some(
      (candidate) => candidate !== rootId && isAncestor(runtime, candidate, rootId),
    ),
  );
  const rank = traversalRank(runtime);
  return minimal.sort((left, right) => rank.get(left) - rank.get(right));
}

function serializeRuntimeMetrics(runtime) {
  return Object.fromEntries(
    [...runtime.metrics.entries()].map(([componentId, metrics]) => [
      componentId,
      cloneValue(metrics),
    ]),
  );
}

export function rebuildLayout({
  hierarchy,
  dirtyRoots,
  measure,
  adapters = createLayoutRebuilderAdapters(),
  maxIterations = 8,
}) {
  if (typeof measure !== "function") fail("measure must be a function");
  integer(maxIterations, "maxIterations");
  if (maxIterations <= 0) fail("maxIterations must be positive");
  const normalized = normalizeHierarchy(hierarchy);
  const resolvedAdapters = createLayoutRebuilderAdapters(adapters);
  const runtime = {
    ...normalized,
    adapters: resolvedAdapters,
    childrenByParent: buildChildrenIndex(normalized.nodes),
    measure,
    metrics: new Map(),
    groupChildren: new Map(),
    trace: [],
    iteration: 0,
    currentRootId: null,
    roundDirty: new Set(),
  };
  const initialDirty = dirtyRoots === undefined
    ? [...runtime.nodes.keys()]
    : dirtyRoots;
  if (!Array.isArray(initialDirty)) fail("dirtyRoots must be an array");
  let pending = canonicalDirtyRoots(runtime, initialDirty);
  let rebuildCount = 0;
  while (pending.length > 0 && runtime.iteration < maxIterations) {
    runtime.iteration += 1;
    runtime.roundDirty = new Set();
    for (const rootId of pending) {
      runRootPass(runtime, rootId);
      rebuildCount += 1;
    }
    pending = canonicalDirtyRoots(runtime, runtime.roundDirty);
  }
  return {
    hierarchy: runtime.hierarchy,
    converged: pending.length === 0,
    iterations: runtime.iteration,
    rebuildCount,
    remainingDirtyRoots: [...pending],
    trace: runtime.trace,
    runtime: {
      layoutElementMetrics: serializeRuntimeMetrics(runtime),
      groupChildren: Object.fromEntries(
        [...runtime.groupChildren.entries()].map(([componentId, childIds]) => [
          componentId,
          [...childIds],
        ]),
      ),
    },
  };
}
