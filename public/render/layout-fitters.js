export const CONTENT_FIT_MODE = Object.freeze({
  Unconstrained: 0,
  MinSize: 1,
  PreferredSize: 2,
});

export const ASPECT_MODE = Object.freeze({
  None: 0,
  WidthControlsHeight: 1,
  HeightControlsWidth: 2,
  FitInParent: 3,
  EnvelopeParent: 4,
});

export const LAYOUT_COMPONENT_TYPE = Object.freeze({
  Horizontal: "HorizontalLayoutGroup",
  Vertical: "VerticalLayoutGroup",
  ContentSize: "ContentSizeFitter",
  AspectRatio: "AspectRatioFitter",
});

const GROUP_FIELDS = Object.freeze([
  "m_Enabled",
  "m_Name",
  "m_Padding",
  "m_ChildAlignment",
  "m_Spacing",
  "m_ChildForceExpandWidth",
  "m_ChildForceExpandHeight",
  "m_ChildControlWidth",
  "m_ChildControlHeight",
  "m_ChildScaleWidth",
  "m_ChildScaleHeight",
  "m_ReverseArrangement",
]);
const CONTENT_SIZE_FIELDS = Object.freeze([
  "m_Enabled",
  "m_Name",
  "m_HorizontalFit",
  "m_VerticalFit",
]);
const ASPECT_RATIO_FIELDS = Object.freeze([
  "m_Enabled",
  "m_Name",
  "m_AspectMode",
  "m_AspectRatio",
]);
const PADDING_FIELDS = Object.freeze(["m_Left", "m_Right", "m_Top", "m_Bottom"]);

function fail(message) {
  throw new TypeError(`layout fitter: ${message}`);
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
  if (value !== true && value !== false && value !== 0 && value !== 1) {
    fail(`${label} must be boolean`);
  }
  return Boolean(value);
}

function vec2(value, label) {
  if (!Array.isArray(value) || value.length !== 2) fail(`${label} must be vec2`);
  return [finite(value[0], `${label}[0]`), finite(value[1], `${label}[1]`)];
}

function exactKeys(value, expected, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(`${label} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    fail(`${label} serialized field set changed`);
  }
}

function enumValue(value, allowed, label) {
  integer(value, label);
  if (!allowed.includes(value)) fail(`${label} has unsupported value ${value}`);
  return value;
}

function cloneRect(rect, label = "rect") {
  if (!rect || typeof rect !== "object" || Array.isArray(rect)) fail(`${label} must be an object`);
  return {
    anchorMin: vec2(rect.anchorMin, `${label}.anchorMin`),
    anchorMax: vec2(rect.anchorMax, `${label}.anchorMax`),
    anchoredPosition: vec2(rect.anchoredPosition, `${label}.anchoredPosition`),
    sizeDelta: vec2(rect.sizeDelta, `${label}.sizeDelta`),
    pivot: vec2(rect.pivot, `${label}.pivot`),
    localScale: vec2(rect.localScale, `${label}.localScale`),
  };
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function clamp(value, min, max) {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function clamp01(value) {
  return clamp(value, 0, 1);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function axisName(axis) {
  if (axis !== 0 && axis !== 1) fail(`axis must be 0 or 1`);
  return axis === 0 ? "width" : "height";
}

function paddingAlongAxis(group, axis) {
  return axis === 0
    ? group.padding.left + group.padding.right
    : group.padding.top + group.padding.bottom;
}

function paddingStart(group, axis) {
  return axis === 0 ? group.padding.left : group.padding.top;
}

function alignmentOnAxis(group, axis) {
  return axis === 0
    ? (group.childAlignment % 3) * 0.5
    : Math.floor(group.childAlignment / 3) * 0.5;
}

function setChildAlongAxis(rect, axis, pos, scaleFactor, size) {
  rect.anchorMin = [0, 1];
  rect.anchorMax = [0, 1];
  if (size !== undefined) rect.sizeDelta[axis] = size;
  const drivenSize = size === undefined ? rect.sizeDelta[axis] : size;
  rect.anchoredPosition[axis] = axis === 0
    ? pos + drivenSize * rect.pivot[axis] * scaleFactor
    : -pos - drivenSize * (1 - rect.pivot[axis]) * scaleFactor;
}

function setSizeWithCurrentAnchors(rect, parentSize, axis, size) {
  const parent = vec2(parentSize, "parentSize");
  const result = cloneRect(rect);
  result.sizeDelta[axis] = finite(size, `${axisName(axis)} target`)
    - parent[axis] * (result.anchorMax[axis] - result.anchorMin[axis]);
  return result;
}

function normalizedLayoutElement(element, index) {
  if (!element || typeof element !== "object" || Array.isArray(element)) {
    fail(`layoutElements[${index}] must be an object`);
  }
  if (typeof element.id !== "string" || element.id.length === 0) {
    fail(`layoutElements[${index}].id must be a non-empty string`);
  }
  return {
    id: element.id,
    activeAndEnabled: bool(
      element.activeAndEnabled,
      `layoutElements[${index}].activeAndEnabled`,
    ),
    priority: integer(element.priority, `layoutElements[${index}].priority`),
    min: vec2(element.min, `layoutElements[${index}].min`),
    preferred: vec2(element.preferred, `layoutElements[${index}].preferred`),
    flexible: vec2(element.flexible, `layoutElements[${index}].flexible`),
  };
}

export function resolveLayoutProperty(layoutElements, property, axis, defaultValue = 0) {
  axisName(axis);
  if (!["min", "preferred", "flexible"].includes(property)) {
    fail(`unsupported layout property ${property}`);
  }
  if (!Array.isArray(layoutElements)) fail("layoutElements must be an array");
  let result = finite(defaultValue, "defaultValue");
  let maxPriority = Number.MIN_SAFE_INTEGER;
  let sourceId = null;
  layoutElements.map(normalizedLayoutElement).forEach((element) => {
    if (!element.activeAndEnabled || element.priority < maxPriority) return;
    const candidate = element[property][axis];
    if (candidate < 0) return;
    if (element.priority > maxPriority || candidate > result) {
      result = candidate;
      maxPriority = element.priority;
      sourceId = element.id;
    }
  });
  return { value: result, sourceId, priority: maxPriority };
}

export function resolveLayoutMetrics(layoutElements) {
  const min = [0, 1].map((axis) => resolveLayoutProperty(layoutElements, "min", axis).value);
  const preferred = [0, 1].map((axis) => Math.max(
    min[axis],
    resolveLayoutProperty(layoutElements, "preferred", axis).value,
  ));
  const flexible = [0, 1].map(
    (axis) => resolveLayoutProperty(layoutElements, "flexible", axis).value,
  );
  return { min, preferred, flexible };
}

function normalizedChild(child, index) {
  if (!child || typeof child !== "object" || Array.isArray(child)) {
    fail(`children[${index}] must be an object`);
  }
  if (typeof child.id !== "string" || child.id.length === 0) {
    fail(`children[${index}].id must be a non-empty string`);
  }
  return {
    id: child.id,
    activeInHierarchy: bool(child.activeInHierarchy, `children[${index}].activeInHierarchy`),
    ignoreLayout: bool(child.ignoreLayout, `children[${index}].ignoreLayout`),
    rect: cloneRect(child.rect, `children[${index}].rect`),
    layoutElements: Array.isArray(child.layoutElements)
      ? child.layoutElements.map(normalizedLayoutElement)
      : fail(`children[${index}].layoutElements must be an array`),
  };
}

function getChildSizes(child, group, axis) {
  const controlSize = group.childControl[axis];
  let min;
  let preferred;
  let flexible;
  if (!controlSize) {
    min = child.rect.sizeDelta[axis];
    preferred = min;
    flexible = 0;
  } else {
    const metrics = resolveLayoutMetrics(child.layoutElements);
    min = metrics.min[axis];
    preferred = metrics.preferred[axis];
    flexible = metrics.flexible[axis];
  }
  if (group.childForceExpand[axis]) flexible = Math.max(flexible, 1);
  return { min, preferred, flexible };
}

function calculateAlongAxis(group, children, axis) {
  const isVertical = group.kind === "vertical";
  const combinedPadding = paddingAlongAxis(group, axis);
  const useScale = group.childScale[axis];
  const alongOtherAxis = isVertical !== (axis === 1);
  let totalMin = combinedPadding;
  let totalPreferred = combinedPadding;
  let totalFlexible = 0;

  children.forEach((child) => {
    let { min, preferred, flexible } = getChildSizes(child, group, axis);
    if (useScale) {
      const scale = child.rect.localScale[axis];
      min *= scale;
      preferred *= scale;
      flexible *= scale;
    }
    if (alongOtherAxis) {
      totalMin = Math.max(min + combinedPadding, totalMin);
      totalPreferred = Math.max(preferred + combinedPadding, totalPreferred);
      totalFlexible = Math.max(flexible, totalFlexible);
    } else {
      totalMin += min + group.spacing;
      totalPreferred += preferred + group.spacing;
      totalFlexible += flexible;
    }
  });
  if (!alongOtherAxis && children.length > 0) {
    totalMin -= group.spacing;
    totalPreferred -= group.spacing;
  }
  totalPreferred = Math.max(totalMin, totalPreferred);
  return { min: totalMin, preferred: totalPreferred, flexible: totalFlexible };
}

function getStartOffset(group, containerSize, axis, requiredWithoutPadding) {
  const required = requiredWithoutPadding + paddingAlongAxis(group, axis);
  const surplus = containerSize[axis] - required;
  return paddingStart(group, axis) + surplus * alignmentOnAxis(group, axis);
}

function setChildrenAlongAxis(group, children, containerSize, layoutInput, axis) {
  const isVertical = group.kind === "vertical";
  const controlSize = group.childControl[axis];
  const useScale = group.childScale[axis];
  const alongOtherAxis = isVertical !== (axis === 1);
  const order = group.reverseArrangement ? [...children].reverse() : children;
  const alignment = alignmentOnAxis(group, axis);

  if (alongOtherAxis) {
    const innerSize = containerSize[axis] - paddingAlongAxis(group, axis);
    order.forEach((child) => {
      const { min, preferred, flexible } = getChildSizes(child, group, axis);
      const scale = useScale ? child.rect.localScale[axis] : 1;
      const required = clamp(innerSize, min, flexible > 0 ? containerSize[axis] : preferred);
      const start = getStartOffset(group, containerSize, axis, required * scale);
      if (controlSize) {
        setChildAlongAxis(child.rect, axis, start, scale, required);
      } else {
        const offset = (required - child.rect.sizeDelta[axis]) * alignment;
        setChildAlongAxis(child.rect, axis, start + offset, scale);
      }
    });
    return;
  }

  let pos = paddingStart(group, axis);
  let flexibleMultiplier = 0;
  const surplus = containerSize[axis] - layoutInput.preferred[axis];
  if (surplus > 0) {
    if (layoutInput.flexible[axis] === 0) {
      pos = getStartOffset(
        group,
        containerSize,
        axis,
        layoutInput.preferred[axis] - paddingAlongAxis(group, axis),
      );
    } else {
      flexibleMultiplier = surplus / layoutInput.flexible[axis];
    }
  }
  const denominator = layoutInput.preferred[axis] - layoutInput.min[axis];
  const minMaxLerp = denominator === 0
    ? 0
    : clamp01((containerSize[axis] - layoutInput.min[axis]) / denominator);

  order.forEach((child) => {
    const { min, preferred, flexible } = getChildSizes(child, group, axis);
    const scale = useScale ? child.rect.localScale[axis] : 1;
    const childSize = lerp(min, preferred, minMaxLerp) + flexible * flexibleMultiplier;
    if (controlSize) {
      setChildAlongAxis(child.rect, axis, pos, scale, childSize);
    } else {
      const offset = (childSize - child.rect.sizeDelta[axis]) * alignment;
      setChildAlongAxis(child.rect, axis, pos + offset, scale);
    }
    pos += childSize * scale + group.spacing;
  });
}

function normalizeGroupComponent(component) {
  if (!component || !["horizontal", "vertical"].includes(component.kind)) {
    fail("component must be a normalized horizontal or vertical LayoutGroup");
  }
  return {
    kind: component.kind,
    enabled: bool(component.enabled, "component.enabled"),
    padding: {
      left: finite(component.padding?.left, "component.padding.left"),
      right: finite(component.padding?.right, "component.padding.right"),
      top: finite(component.padding?.top, "component.padding.top"),
      bottom: finite(component.padding?.bottom, "component.padding.bottom"),
    },
    childAlignment: enumValue(
      component.childAlignment,
      [0, 1, 2, 3, 4, 5, 6, 7, 8],
      "component.childAlignment",
    ),
    spacing: finite(component.spacing, "component.spacing"),
    childForceExpand: [
      bool(component.childForceExpand?.[0], "component.childForceExpand[0]"),
      bool(component.childForceExpand?.[1], "component.childForceExpand[1]"),
    ],
    childControl: [
      bool(component.childControl?.[0], "component.childControl[0]"),
      bool(component.childControl?.[1], "component.childControl[1]"),
    ],
    childScale: [
      bool(component.childScale?.[0], "component.childScale[0]"),
      bool(component.childScale?.[1], "component.childScale[1]"),
    ],
    reverseArrangement: bool(component.reverseArrangement, "component.reverseArrangement"),
  };
}

function normalizeGroupChildren(children) {
  if (!Array.isArray(children)) fail("children must be an array");
  const normalized = children.map(normalizedChild);
  if (new Set(normalized.map((child) => child.id)).size !== normalized.length) {
    fail("children ids must be unique");
  }
  return normalized;
}

function normalizeGroupLayoutInput(layoutInput) {
  if (!layoutInput || typeof layoutInput !== "object" || Array.isArray(layoutInput)) {
    fail("layoutInput must be an object");
  }
  return {
    min: vec2(layoutInput.min, "layoutInput.min"),
    preferred: vec2(layoutInput.preferred, "layoutInput.preferred"),
    flexible: vec2(layoutInput.flexible, "layoutInput.flexible"),
  };
}

export function calculateLayoutGroupAxis({ component, children, axis }) {
  axisName(axis);
  const group = normalizeGroupComponent(component);
  const normalized = normalizeGroupChildren(children);
  const included = normalized.filter((child) => child.activeInHierarchy && !child.ignoreLayout);
  if (!group.enabled) {
    return {
      applied: false,
      layoutInput: null,
      includedChildIds: [],
    };
  }
  return {
    applied: true,
    layoutInput: calculateAlongAxis(group, included, axis),
    includedChildIds: included.map((child) => child.id),
  };
}

export function controlLayoutGroupAxis({
  component,
  containerSize,
  children,
  layoutInput,
  axis,
}) {
  axisName(axis);
  const group = normalizeGroupComponent(component);
  const size = vec2(containerSize, "containerSize");
  const normalized = normalizeGroupChildren(children);
  const included = normalized.filter((child) => child.activeInHierarchy && !child.ignoreLayout);
  if (!group.enabled) {
    return {
      applied: false,
      includedChildIds: [],
      children: normalized,
    };
  }
  setChildrenAlongAxis(
    group,
    included,
    size,
    normalizeGroupLayoutInput(layoutInput),
    axis,
  );
  return {
    applied: true,
    includedChildIds: included.map((child) => child.id),
    children: normalized,
  };
}

export function executeLayoutGroup({ component, containerSize, children }) {
  const group = normalizeGroupComponent(component);
  const size = vec2(containerSize, "containerSize");
  const normalized = normalizeGroupChildren(children);
  const included = normalized.filter((child) => child.activeInHierarchy && !child.ignoreLayout);
  if (!group.enabled) {
    return {
      applied: false,
      layoutInput: null,
      includedChildIds: [],
      children: normalized,
    };
  }
  const axisInput = [0, 1].map((axis) => calculateAlongAxis(group, included, axis));
  const layoutInput = {
    min: axisInput.map((item) => item.min),
    preferred: axisInput.map((item) => item.preferred),
    flexible: axisInput.map((item) => item.flexible),
  };
  setChildrenAlongAxis(group, included, size, layoutInput, 0);
  setChildrenAlongAxis(group, included, size, layoutInput, 1);
  return {
    applied: true,
    layoutInput,
    includedChildIds: included.map((child) => child.id),
    children: normalized,
  };
}

export function executeContentSizeFitter({
  component,
  rect,
  parentSize,
  layoutElements,
}) {
  if (!component || component.kind !== "content-size") {
    fail("component must be a normalized ContentSizeFitter");
  }
  const enabled = bool(component.enabled, "component.enabled");
  const fit = [
    enumValue(component.fit?.[0], [0, 1, 2], "component.fit[0]"),
    enumValue(component.fit?.[1], [0, 1, 2], "component.fit[1]"),
  ];
  let result = cloneRect(rect);
  if (!enabled) return { applied: false, driven: [], rect: result };
  const metrics = resolveLayoutMetrics(layoutElements);
  const driven = [];
  for (let axis = 0; axis < 2; axis += 1) {
    if (fit[axis] === CONTENT_FIT_MODE.Unconstrained) continue;
    const target = fit[axis] === CONTENT_FIT_MODE.MinSize
      ? metrics.min[axis]
      : metrics.preferred[axis];
    result = setSizeWithCurrentAnchors(result, parentSize, axis, target);
    driven.push(axis === 0 ? "sizeDeltaX" : "sizeDeltaY");
  }
  return { applied: driven.length > 0, driven, rect: result, layoutMetrics: metrics };
}

export function executeAspectRatioFitter({
  component,
  rect,
  parentSize = null,
  isRootScreenCanvas = false,
}) {
  if (!component || component.kind !== "aspect-ratio") {
    fail("component must be a normalized AspectRatioFitter");
  }
  const enabled = bool(component.enabled, "component.enabled");
  const mode = enumValue(component.aspectMode, [0, 1, 2, 3, 4], "component.aspectMode");
  const ratio = finite(component.aspectRatio, "component.aspectRatio");
  const rootCanvas = bool(isRootScreenCanvas, "isRootScreenCanvas");
  let result = cloneRect(rect);
  if (!enabled || rootCanvas || mode === ASPECT_MODE.None) {
    return { applied: false, driven: [], rect: result };
  }
  if (ratio <= 0) fail("component.aspectRatio must be positive");
  if (parentSize === null && (
    mode === ASPECT_MODE.FitInParent
    || mode === ASPECT_MODE.EnvelopeParent
  )) {
    return { applied: false, driven: [], rect: result };
  }
  const parent = vec2(parentSize, "parentSize");
  if (mode === ASPECT_MODE.HeightControlsWidth) {
    const height = parent[1] * (result.anchorMax[1] - result.anchorMin[1])
      + result.sizeDelta[1];
    result = setSizeWithCurrentAnchors(result, parent, 0, height * ratio);
    return { applied: true, driven: ["sizeDeltaX"], rect: result };
  }
  if (mode === ASPECT_MODE.WidthControlsHeight) {
    const width = parent[0] * (result.anchorMax[0] - result.anchorMin[0])
      + result.sizeDelta[0];
    result = setSizeWithCurrentAnchors(result, parent, 1, width / ratio);
    return { applied: true, driven: ["sizeDeltaY"], rect: result };
  }

  result.anchorMin = [0, 0];
  result.anchorMax = [1, 1];
  result.anchoredPosition = [0, 0];
  result.sizeDelta = [0, 0];
  if ((parent[1] * ratio < parent[0]) !== (mode === ASPECT_MODE.FitInParent)) {
    result.sizeDelta[1] = parent[0] / ratio - parent[1];
  } else {
    result.sizeDelta[0] = parent[1] * ratio - parent[0];
  }
  return {
    applied: true,
    driven: ["anchors", "anchoredPosition", "sizeDeltaX", "sizeDeltaY"],
    rect: result,
  };
}

export function decodeSerializedLayoutComponent(record) {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    fail("serialized component record must be an object");
  }
  const type = record.componentType;
  const fields = record.serialized;
  if (type === LAYOUT_COMPONENT_TYPE.Horizontal || type === LAYOUT_COMPONENT_TYPE.Vertical) {
    exactKeys(fields, GROUP_FIELDS, type);
    exactKeys(fields.m_Padding, PADDING_FIELDS, `${type}.m_Padding`);
    return {
      kind: type === LAYOUT_COMPONENT_TYPE.Horizontal ? "horizontal" : "vertical",
      enabled: bool(fields.m_Enabled, `${type}.m_Enabled`),
      padding: {
        left: finite(fields.m_Padding.m_Left, `${type}.m_Padding.m_Left`),
        right: finite(fields.m_Padding.m_Right, `${type}.m_Padding.m_Right`),
        top: finite(fields.m_Padding.m_Top, `${type}.m_Padding.m_Top`),
        bottom: finite(fields.m_Padding.m_Bottom, `${type}.m_Padding.m_Bottom`),
      },
      childAlignment: enumValue(
        fields.m_ChildAlignment,
        [0, 1, 2, 3, 4, 5, 6, 7, 8],
        `${type}.m_ChildAlignment`,
      ),
      spacing: finite(fields.m_Spacing, `${type}.m_Spacing`),
      childForceExpand: [
        bool(fields.m_ChildForceExpandWidth, `${type}.m_ChildForceExpandWidth`),
        bool(fields.m_ChildForceExpandHeight, `${type}.m_ChildForceExpandHeight`),
      ],
      childControl: [
        bool(fields.m_ChildControlWidth, `${type}.m_ChildControlWidth`),
        bool(fields.m_ChildControlHeight, `${type}.m_ChildControlHeight`),
      ],
      childScale: [
        bool(fields.m_ChildScaleWidth, `${type}.m_ChildScaleWidth`),
        bool(fields.m_ChildScaleHeight, `${type}.m_ChildScaleHeight`),
      ],
      reverseArrangement: bool(
        fields.m_ReverseArrangement,
        `${type}.m_ReverseArrangement`,
      ),
    };
  }
  if (type === LAYOUT_COMPONENT_TYPE.ContentSize) {
    exactKeys(fields, CONTENT_SIZE_FIELDS, type);
    return {
      kind: "content-size",
      enabled: bool(fields.m_Enabled, `${type}.m_Enabled`),
      fit: [
        enumValue(fields.m_HorizontalFit, [0, 1, 2], `${type}.m_HorizontalFit`),
        enumValue(fields.m_VerticalFit, [0, 1, 2], `${type}.m_VerticalFit`),
      ],
    };
  }
  if (type === LAYOUT_COMPONENT_TYPE.AspectRatio) {
    exactKeys(fields, ASPECT_RATIO_FIELDS, type);
    return {
      kind: "aspect-ratio",
      enabled: bool(fields.m_Enabled, `${type}.m_Enabled`),
      aspectMode: enumValue(
        fields.m_AspectMode,
        [0, 1, 2, 3, 4],
        `${type}.m_AspectMode`,
      ),
      aspectRatio: finite(fields.m_AspectRatio, `${type}.m_AspectRatio`),
    };
  }
  fail(`unsupported serialized component type ${String(type)}`);
}

export function rectFromSerialized(serialized) {
  if (!serialized || typeof serialized !== "object") fail("serialized RectTransform missing");
  const toVec = (value, label) => [
    finite(value?.x, `${label}.x`),
    finite(value?.y, `${label}.y`),
  ];
  return {
    anchorMin: toVec(serialized.m_AnchorMin, "m_AnchorMin"),
    anchorMax: toVec(serialized.m_AnchorMax, "m_AnchorMax"),
    anchoredPosition: toVec(serialized.m_AnchoredPosition, "m_AnchoredPosition"),
    sizeDelta: toVec(serialized.m_SizeDelta, "m_SizeDelta"),
    pivot: toVec(serialized.m_Pivot, "m_Pivot"),
    localScale: toVec(serialized.m_LocalScale, "m_LocalScale"),
  };
}

export function cloneLayoutState(value) {
  return cloneJson(value);
}
