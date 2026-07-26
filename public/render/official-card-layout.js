import {
  decodeSerializedLayoutComponent,
} from "./layout-fitters.js";
import {
  LAYOUT_REBUILDER_COMPONENT_KIND,
  rebuildLayout,
} from "./layout-rebuilder.js";
import { rectTransformUiAffine } from "./ui-affine-transform.js";
import {
  measureOfficialTmpLayoutElement,
} from "./tmp-layout-metrics.js";

const IDENTITY_UI_AFFINE = Object.freeze([1, 0, 0, 1, 0, 0]);

function fail(message) {
  throw new TypeError(`official card layout: ${message}`);
}

function nodeId(gameObjectId) {
  return `go:${String(gameObjectId)}`;
}

function componentId(pathId) {
  return `component:${String(pathId)}`;
}

function tmpComponentId(pathId) {
  return `tmp:${String(pathId)}`;
}

function finitePair(value, label) {
  if (!Array.isArray(value) || value.length !== 2) fail(`${label} must be vec2`);
  const result = value.map(Number);
  if (!result.every(Number.isFinite)) fail(`${label} must be finite`);
  return result;
}

function fitterComponents(fitterPrefab) {
  const byGameObject = new Map();
  for (const record of fitterPrefab.components || []) {
    const id = String(record.gameObject?.pathId || "");
    if (!id) fail("fitter record lacks GameObject identity");
    const list = byGameObject.get(id) || [];
    list.push(record);
    byGameObject.set(id, list);
  }
  return byGameObject;
}

function compileComponent(record) {
  const decoded = decodeSerializedLayoutComponent(record);
  const common = {
    id: componentId(record.componentPathId),
    enabled: decoded.enabled,
    officialComponentType: record.componentType,
    officialComponentPathId: String(record.componentPathId),
    officialComponentObjectSha256: record.componentObjectSha256,
  };
  if (decoded.kind === "layout-element") {
    return {
      ...common,
      kind: LAYOUT_REBUILDER_COMPONENT_KIND.LayoutElement,
      ignoreLayout: decoded.ignoreLayout,
      layoutPriority: decoded.layoutPriority,
      source: "serialized-layout-element",
      metrics: {
        min: decoded.min,
        preferred: decoded.preferred,
        flexible: decoded.flexible,
      },
    };
  }
  if (decoded.kind === "horizontal" || decoded.kind === "vertical") {
    return {
      ...common,
      kind: LAYOUT_REBUILDER_COMPONENT_KIND.LayoutGroup,
      layoutPriority: 0,
      value: decoded,
    };
  }
  if (decoded.kind === "content-size") {
    return {
      ...common,
      kind: LAYOUT_REBUILDER_COMPONENT_KIND.ContentSizeFitter,
      value: decoded,
    };
  }
  if (decoded.kind === "aspect-ratio") {
    return {
      ...common,
      kind: LAYOUT_REBUILDER_COMPONENT_KIND.AspectRatioFitter,
      value: decoded,
    };
  }
  fail(`unsupported decoded component kind ${decoded.kind}`);
}

function compileHierarchy({
  root,
  fitterPrefab,
  runtimeActiveByGameObjectId,
  activeOverrides,
}) {
  const recordsByGameObject = fitterComponents(fitterPrefab);
  const nodes = [];
  const metadata = new Map();
  const seenGameObjects = new Set();

  function visit(source, parentId) {
    const gameObjectId = String(source.gameObjectId || "");
    if (!gameObjectId) fail(`${source.go || "<unnamed>"} lacks GameObject pathId`);
    if (seenGameObjects.has(gameObjectId)) fail(`duplicate GameObject ${gameObjectId}`);
    seenGameObjects.add(gameObjectId);
    const id = nodeId(gameObjectId);
    const rect = {
      anchorMin: finitePair(source.aMin, `${id}.anchorMin`),
      anchorMax: finitePair(source.aMax, `${id}.anchorMax`),
      anchoredPosition: finitePair(source.pos, `${id}.anchoredPosition`),
      sizeDelta: finitePair(source.size, `${id}.sizeDelta`),
      pivot: finitePair(source.piv, `${id}.pivot`),
      localScale: finitePair(source.scale, `${id}.localScale`),
    };
    const components = (recordsByGameObject.get(gameObjectId) || [])
      .map(compileComponent);
    if (source.tmpId) {
      components.push({
        id: tmpComponentId(source.tmpId),
        kind: LAYOUT_REBUILDER_COMPONENT_KIND.LayoutElement,
        enabled: source.tmpEnabled !== false,
        layoutPriority: 0,
        source: "tmp-ilayout-element",
        tmpPathId: String(source.tmpId),
      });
    }
    const initialActive = runtimeActiveByGameObjectId.has(gameObjectId)
      ? runtimeActiveByGameObjectId.get(gameObjectId)
      : Boolean(source.active);
    const activeSelf = activeOverrides.has(gameObjectId)
      ? activeOverrides.get(gameObjectId)
      : initialActive;
    nodes.push({
      id,
      parentId,
      siblingIndex: Number(source.siblingIndex || 0),
      activeSelf: Boolean(activeSelf),
      rect,
      components,
      ...(parentId === null ? { rootParentSize: [0, 0] } : {}),
    });
    metadata.set(id, {
      gameObjectId,
      gameObjectObjectSha256: source.gameObjectObjectSha256,
      rectTransformId: source.rectTransformId,
      rectTransformObjectSha256: source.rectTransformObjectSha256,
      go: source.go,
      path: source.path,
      rotation: source.rotation,
      scale: source.scale,
    });
    for (const child of source.children || []) visit(child, id);
  }

  visit(root, null);
  const orphanRecords = [...recordsByGameObject.keys()].filter(
    (id) => !seenGameObjects.has(id),
  );
  if (orphanRecords.length) {
    fail(`fitter records reference ${orphanRecords.length} absent GameObjects`);
  }
  return {
    hierarchy: { nodes, driven: [] },
    metadata,
    rootId: nodeId(root.gameObjectId),
  };
}

function hierarchyWorldBoxes(hierarchy, metadata, rootId) {
  const nodes = new Map(hierarchy.nodes.map((node) => [node.id, node]));
  const children = new Map();
  for (const node of hierarchy.nodes) {
    const list = children.get(node.parentId) || [];
    list.push(node.id);
    children.set(node.parentId, list);
  }
  for (const list of children.values()) {
    list.sort((left, right) => (
      nodes.get(left).siblingIndex - nodes.get(right).siblingIndex
      || left.localeCompare(right)
    ));
  }
  const root = nodes.get(rootId);
  const rootWidth = root.rect.sizeDelta[0];
  const rootHeight = root.rect.sizeDelta[1];
  const output = new Map();

  function visit(id, parent) {
    const node = nodes.get(id);
    const info = metadata.get(id);
    const rect = node.rect;
    const anchorLeft = parent.left + rect.anchorMin[0] * parent.width;
    const anchorRight = parent.left + rect.anchorMax[0] * parent.width;
    const anchorBottom = parent.bottom + rect.anchorMin[1] * parent.height;
    const anchorTop = parent.bottom + rect.anchorMax[1] * parent.height;
    const width = anchorRight - anchorLeft + rect.sizeDelta[0];
    const height = anchorTop - anchorBottom + rect.sizeDelta[1];
    const pivotX = anchorLeft
      + rect.pivot[0] * (anchorRight - anchorLeft)
      + rect.anchoredPosition[0];
    const pivotY = anchorBottom
      + rect.pivot[1] * (anchorTop - anchorBottom)
      + rect.anchoredPosition[1];
    const left = pivotX - rect.pivot[0] * width;
    const bottom = pivotY - rect.pivot[1] * height;
    const uiTransform = rectTransformUiAffine({
      pivot: [pivotX, pivotY],
      rotation: info.rotation,
      scale: info.scale,
    }, parent.uiTransform);
    output.set(info.gameObjectId, {
      box: {
        l: (left + rootWidth / 2) / rootWidth,
        r: (left + width + rootWidth / 2) / rootWidth,
        t: (rootHeight / 2 - bottom - height) / rootHeight,
        b: (rootHeight / 2 - bottom) / rootHeight,
      },
      uiTransform,
      rect: structuredClone(rect),
    });
    const world = {
      left,
      bottom,
      width,
      height,
      uiTransform,
    };
    for (const childId of children.get(id) || []) visit(childId, world);
  }

  visit(rootId, {
    left: -rootWidth / 2,
    bottom: -rootHeight / 2,
    width: rootWidth,
    height: rootHeight,
    uiTransform: IDENTITY_UI_AFFINE,
  });
  return output;
}

export function resolveOfficialCardLayout({
  kind,
  root,
  fitterContract,
  elements,
  fonts,
  spriteContract = null,
  runtimeActiveByGameObjectId = new Map(),
  activeOverrides = new Map(),
  maxIterations = 8,
}) {
  if (!["pokemon", "trainer"].includes(kind)) fail(`unsupported prefab kind ${kind}`);
  if (!Array.isArray(elements)) fail("elements must be an array");
  const fitterPrefab = fitterContract?.prefabs?.find(
    (prefab) => prefab.kind === kind,
  );
  if (!fitterPrefab) fail(`layout fitter contract lacks ${kind}`);
  const runtimeActive = runtimeActiveByGameObjectId instanceof Map
    ? runtimeActiveByGameObjectId
    : new Map(Object.entries(runtimeActiveByGameObjectId || {}));
  const overrides = activeOverrides instanceof Map
    ? activeOverrides
    : new Map(Object.entries(activeOverrides || {}));
  for (const [id, value] of overrides) {
    if (value !== true && value !== false) fail(`active override ${id} must be boolean`);
  }
  const compiled = compileHierarchy({
    root,
    fitterPrefab,
    runtimeActiveByGameObjectId: runtimeActive,
    activeOverrides: overrides,
  });
  const textByGameObject = new Map();
  for (const element of elements) {
    if (element.kind !== "text" || !element.layoutNodeId) continue;
    if (textByGameObject.has(String(element.layoutNodeId))) {
      fail(`multiple TMP elements target GameObject ${element.layoutNodeId}`);
    }
    textByGameObject.set(String(element.layoutNodeId), element);
  }

  const rebuilt = rebuildLayout({
    hierarchy: compiled.hierarchy,
    dirtyRoots: compiled.hierarchy.nodes.map((node) => node.id),
    maxIterations,
    measure({ hierarchy, node, component, axis }) {
      if (component.source === "serialized-layout-element") {
        return {
          min: component.metrics.min[axis],
          preferred: component.metrics.preferred[axis],
          flexible: component.metrics.flexible[axis],
        };
      }
      if (component.source !== "tmp-ilayout-element") {
        fail(`unknown layout-element source ${component.source}`);
      }
      const gameObjectId = compiled.metadata.get(node.id)?.gameObjectId;
      const element = textByGameObject.get(gameObjectId);
      if (!element) {
        fail(`active TMP LayoutElement ${component.tmpPathId} has no text producer`);
      }
      const parent = node.parentId === null
        ? [0, 0]
        : rebuiltRectSize(hierarchy, node.parentId);
      const rectSize = [0, 1].map((dimension) => (
        parent[dimension]
          * (node.rect.anchorMax[dimension] - node.rect.anchorMin[dimension])
        + node.rect.sizeDelta[dimension]
      ));
      const metrics = measureOfficialTmpLayoutElement({
        fonts,
        spriteContract,
        element,
        rectSize,
      });
      return {
        min: metrics.min[axis],
        preferred: metrics.preferred[axis],
        flexible: metrics.flexible[axis],
      };
    },
  });
  if (!rebuilt.converged) {
    fail(
      `LayoutRebuilder did not converge after ${rebuilt.iterations} iterations; `
      + `remaining=${rebuilt.remainingDirtyRoots.join(",")}`,
    );
  }
  const boxes = hierarchyWorldBoxes(
    rebuilt.hierarchy,
    compiled.metadata,
    compiled.rootId,
  );
  const resolvedElements = elements.map((element) => {
    if (!element.layoutNodeId) return element;
    const resolved = boxes.get(String(element.layoutNodeId));
    if (!resolved) fail(`draw element references absent layout node ${element.layoutNodeId}`);
    return {
      ...element,
      authoredBox: element.authoredBox || element.box,
      box: resolved.box,
      uiTransform: resolved.uiTransform,
    };
  });
  return {
    elements: resolvedElements,
    hierarchy: rebuilt.hierarchy,
    diagnostics: {
      contractId: fitterContract.contractId,
      prefabKind: kind,
      nodeCount: rebuilt.hierarchy.nodes.length,
      fitterComponentCount: fitterPrefab.components.length,
      textLayoutElementCount: textByGameObject.size,
      activeOverrideCount: overrides.size,
      iterations: rebuilt.iterations,
      rebuildCount: rebuilt.rebuildCount,
      converged: rebuilt.converged,
      traceLength: rebuilt.trace.length,
    },
  };
}

function rebuiltRectSize(hierarchy, nodeId, visiting = new Set()) {
  if (visiting.has(nodeId)) fail(`rect size recursion at ${nodeId}`);
  visiting.add(nodeId);
  const nodes = new Map(hierarchy.nodes.map((node) => [node.id, node]));
  const node = nodes.get(nodeId);
  if (!node) fail(`rect size references absent node ${nodeId}`);
  const parentSize = node.parentId === null
    ? node.rootParentSize
    : rebuiltRectSize(hierarchy, node.parentId, visiting);
  visiting.delete(nodeId);
  return [0, 1].map((axis) => (
    parentSize[axis] * (node.rect.anchorMax[axis] - node.rect.anchorMin[axis])
    + node.rect.sizeDelta[axis]
  ));
}
