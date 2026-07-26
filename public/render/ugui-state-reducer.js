export const UGUI_STATE_REPLAY_SCHEMA = "pocket-card-render/ugui-state-replay@2";

const SIGNED_INT64_MIN = -(1n << 63n);
const SIGNED_INT64_MAX = (1n << 63n) - 1n;
const FLOAT32_MAX = 3.4028234663852886e38;
const QUATERNION_UNIT_TOLERANCE = 1e-5;

function fail(message) {
  throw new Error(`UGUI state replay rejected: ${message}`);
}

function compareText(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function isRecord(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function requireRecord(value, label) {
  if (!isRecord(value)) fail(`${label} must be a plain object`);
  return value;
}

function requireOnlyKeys(value, allowed, label) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail(`${label} has unknown field ${JSON.stringify(key)}`);
  }
}

function requireIdentity(value, label) {
  if (
    typeof value !== "string"
    || value.length === 0
    || value !== value.trim()
    || /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    fail(`${label} must be a stable non-empty identity`);
  }
  return value;
}

function requireBoolean(value, label) {
  if (typeof value !== "boolean") fail(`${label} must be boolean`);
  return value;
}

function requireIndex(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    fail(`${label} must be a non-negative safe integer`);
  }
  return value;
}

function requireFloat(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > FLOAT32_MAX) {
    fail(`${label} must be a finite float32 value`);
  }
  return value;
}

function requireVector(value, length, label) {
  if (!Array.isArray(value) || value.length !== length) {
    fail(`${label} must contain exactly ${length} values`);
  }
  return value.map((entry, index) => requireFloat(entry, `${label}[${index}]`));
}

function normalizeRectTransform(value, label) {
  const transform = requireRecord(value, label);
  requireOnlyKeys(transform, new Set(["localRotation", "localScale"]), label);
  if (!Object.hasOwn(transform, "localRotation") || !Object.hasOwn(transform, "localScale")) {
    fail(`${label} must contain complete localRotation and localScale`);
  }

  const localRotation = requireVector(transform.localRotation, 4, `${label}.localRotation`);
  const localScale = requireVector(transform.localScale, 3, `${label}.localScale`);
  const quaternionLength = Math.hypot(...localRotation);
  if (
    !(quaternionLength > 0)
    || Math.abs(quaternionLength - 1) > QUATERNION_UNIT_TOLERANCE
  ) {
    fail(`${label}.localRotation must be a unit quaternion`);
  }
  return { localRotation, localScale };
}

function normalizePPtr(value, label) {
  const pointer = requireRecord(value, label);
  requireOnlyKeys(pointer, new Set(["fileId", "pathId"]), label);
  if (!Object.hasOwn(pointer, "fileId") || !Object.hasOwn(pointer, "pathId")) {
    fail(`${label} must contain fileId and pathId`);
  }
  if (
    !Number.isSafeInteger(pointer.fileId)
    || pointer.fileId < 0
    || pointer.fileId > 0x7fffffff
  ) {
    fail(`${label}.fileId must be a non-negative int32`);
  }
  if (
    typeof pointer.pathId !== "string"
    || !/^-?(?:0|[1-9]\d*)$/u.test(pointer.pathId)
    || pointer.pathId === "-0"
  ) {
    fail(`${label}.pathId must be a canonical signed int64 string`);
  }
  const pathId = BigInt(pointer.pathId);
  if (pathId < SIGNED_INT64_MIN || pathId > SIGNED_INT64_MAX || pathId === 0n) {
    fail(`${label}.pathId must be a non-zero signed int64`);
  }
  return { fileId: pointer.fileId, pathId: pointer.pathId };
}

function registerIdentity(identityOwners, identity, owner) {
  const previous = identityOwners.get(identity);
  if (previous) {
    fail(`duplicate identity ${JSON.stringify(identity)} (${previous} and ${owner})`);
  }
  identityOwners.set(identity, owner);
}

function normalizeSprites(input, identityOwners) {
  if (!Array.isArray(input)) fail("sprites must be an array");
  const sprites = new Map();
  const pointerOwners = new Map();
  for (const [index, rawSprite] of input.entries()) {
    const label = `sprites[${index}]`;
    const sprite = requireRecord(rawSprite, label);
    requireOnlyKeys(sprite, new Set(["identity", "pptr"]), label);
    const identity = requireIdentity(sprite.identity, `${label}.identity`);
    registerIdentity(identityOwners, identity, label);
    const pptr = normalizePPtr(sprite.pptr, `${label}.pptr`);
    const pointerKey = `${pptr.fileId}:${pptr.pathId}`;
    if (pointerOwners.has(pointerKey)) {
      fail(
        `duplicate sprite PPtr ${pointerKey} `
        + `(${pointerOwners.get(pointerKey)} and ${identity})`,
      );
    }
    pointerOwners.set(pointerKey, identity);
    sprites.set(identity, { identity, pptr });
  }
  return sprites;
}

function normalizeComponents(input, nodeLabel, identityOwners) {
  if (!Array.isArray(input)) fail(`${nodeLabel}.components must be an array`);
  const components = [];
  const indices = new Set();
  for (const [index, rawComponent] of input.entries()) {
    const label = `${nodeLabel}.components[${index}]`;
    const component = requireRecord(rawComponent, label);
    requireOnlyKeys(
      component,
      new Set(["identity", "componentIndex", "kind", "initialEnabled", "spriteIdentity"]),
      label,
    );
    const identity = requireIdentity(component.identity, `${label}.identity`);
    registerIdentity(identityOwners, identity, label);
    const componentIndex = requireIndex(component.componentIndex, `${label}.componentIndex`);
    if (indices.has(componentIndex)) {
      fail(`${nodeLabel} has duplicate componentIndex ${componentIndex}`);
    }
    indices.add(componentIndex);
    const kind = requireIdentity(component.kind, `${label}.kind`);
    const initialEnabled = requireBoolean(
      component.initialEnabled,
      `${label}.initialEnabled`,
    );
    const spriteCapable = Object.hasOwn(component, "spriteIdentity");
    let spriteIdentity = null;
    if (spriteCapable && component.spriteIdentity !== null) {
      spriteIdentity = requireIdentity(component.spriteIdentity, `${label}.spriteIdentity`);
    }
    components.push({
      identity,
      componentIndex,
      kind,
      initialEnabled,
      spriteCapable,
      spriteIdentity,
    });
  }
  components.sort((a, b) => a.componentIndex - b.componentIndex);
  components.forEach((component, index) => {
    if (component.componentIndex !== index) {
      fail(`${nodeLabel}.componentIndex values must be contiguous from zero`);
    }
  });
  return components;
}

function normalizeNodes(input, identityOwners) {
  if (!Array.isArray(input) || input.length === 0) {
    fail("nodes must be a non-empty array");
  }
  const nodes = new Map();
  const componentOwners = new Map();

  for (const [index, rawNode] of input.entries()) {
    const label = `nodes[${index}]`;
    const node = requireRecord(rawNode, label);
    requireOnlyKeys(
      node,
      new Set([
        "identity",
        "parent",
        "siblingIndex",
        "initialActive",
        "rectTransform",
        "components",
      ]),
      label,
    );
    const identity = requireIdentity(node.identity, `${label}.identity`);
    registerIdentity(identityOwners, identity, label);
    const parent = node.parent === null
      ? null
      : requireIdentity(node.parent, `${label}.parent`);
    const siblingIndex = requireIndex(node.siblingIndex, `${label}.siblingIndex`);
    const initialActive = requireBoolean(node.initialActive, `${label}.initialActive`);
    const rectTransform = normalizeRectTransform(
      node.rectTransform,
      `${label}.rectTransform`,
    );
    const components = normalizeComponents(node.components, label, identityOwners);
    for (const component of components) componentOwners.set(component.identity, identity);
    nodes.set(identity, {
      identity,
      parent,
      siblingIndex,
      initialActive,
      rectTransform,
      components,
    });
  }
  return { nodes, componentOwners };
}

function validateSpriteReferences(nodes, sprites) {
  for (const node of nodes.values()) {
    for (const component of node.components) {
      if (component.spriteIdentity !== null && !sprites.has(component.spriteIdentity)) {
        fail(
          `component ${JSON.stringify(component.identity)} references unknown sprite `
          + JSON.stringify(component.spriteIdentity),
        );
      }
    }
  }
}

function buildHierarchy(nodes) {
  const roots = [];
  const children = new Map([[null, roots]]);
  for (const identity of nodes.keys()) children.set(identity, []);

  for (const node of nodes.values()) {
    if (node.parent === node.identity) {
      fail(`node ${JSON.stringify(node.identity)} cannot parent itself`);
    }
    if (node.parent !== null && !nodes.has(node.parent)) {
      fail(
        `node ${JSON.stringify(node.identity)} has unknown parent `
        + JSON.stringify(node.parent),
      );
    }
    children.get(node.parent).push(node);
  }

  for (const [parent, siblings] of children.entries()) {
    siblings.sort((a, b) => (
      a.siblingIndex - b.siblingIndex
      || compareText(a.identity, b.identity)
    ));
    siblings.forEach((node, index) => {
      if (node.siblingIndex !== index) {
        const parentLabel = parent === null ? "<root>" : JSON.stringify(parent);
        fail(`${parentLabel} siblingIndex values must be unique and contiguous from zero`);
      }
    });
  }

  const visitState = new Map();
  function visitForCycles(node) {
    const state = visitState.get(node.identity) || 0;
    if (state === 1) fail(`cycle detected at node ${JSON.stringify(node.identity)}`);
    if (state === 2) return;
    visitState.set(node.identity, 1);
    if (node.parent !== null) visitForCycles(nodes.get(node.parent));
    visitState.set(node.identity, 2);
  }
  [...nodes.values()]
    .sort((a, b) => compareText(a.identity, b.identity))
    .forEach(visitForCycles);

  if (roots.length !== 1) fail(`prefab must have exactly one root, found ${roots.length}`);

  const preorder = [];
  function visitPreorder(node) {
    preorder.push(node);
    children.get(node.identity).forEach(visitPreorder);
  }
  visitPreorder(roots[0]);
  if (preorder.length !== nodes.size) fail("prefab hierarchy is disconnected");

  return { roots, children, preorder };
}

function normalizeOperations(input, nodes, componentOwners, sprites) {
  if (!Array.isArray(input)) fail("operations must be an array");
  const operations = [];

  for (const [index, rawOperation] of input.entries()) {
    const label = `operations[${index}]`;
    const operation = requireRecord(rawOperation, label);
    requireOnlyKeys(operation, new Set(["opcode", "target", "value"]), label);
    const opcode = requireIdentity(operation.opcode, `${label}.opcode`);
    const target = requireIdentity(operation.target, `${label}.target`);
    let slot;
    let value;

    if (opcode === "SetActive") {
      if (!nodes.has(target)) fail(`${label} has unknown GameObject target ${JSON.stringify(target)}`);
      value = requireBoolean(operation.value, `${label}.value`);
      slot = `node\0${target}\0selfActive`;
    } else if (opcode === "set_enabled") {
      if (!componentOwners.has(target)) {
        fail(`${label} has unknown component target ${JSON.stringify(target)}`);
      }
      value = requireBoolean(operation.value, `${label}.value`);
      slot = `component\0${target}\0enabled`;
    } else if (opcode === "set_sprite") {
      if (!componentOwners.has(target)) {
        fail(`${label} has unknown component target ${JSON.stringify(target)}`);
      }
      const owner = nodes.get(componentOwners.get(target));
      const component = owner.components.find((entry) => entry.identity === target);
      if (!component.spriteCapable) {
        fail(`${label} targets component without a sprite slot ${JSON.stringify(target)}`);
      }
      if (operation.value === null) {
        value = null;
      } else {
        value = requireIdentity(operation.value, `${label}.value`);
        if (!sprites.has(value)) fail(`${label} references unknown sprite ${JSON.stringify(value)}`);
      }
      slot = `component\0${target}\0spriteIdentity`;
    } else {
      fail(`${label} has unknown opcode ${JSON.stringify(opcode)}`);
    }

    operations.push({
      operationIndex: index,
      opcode,
      target,
      value,
      slot,
    });
  }

  return operations;
}

function cloneTransform(transform) {
  return {
    localRotation: [...transform.localRotation],
    localScale: [...transform.localScale],
  };
}

function cloneSprite(sprite) {
  return sprite === null
    ? null
    : {
      identity: sprite.identity,
      pptr: { ...sprite.pptr },
    };
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

export function replayUGUIState(input) {
  const replay = requireRecord(input, "input");
  requireOnlyKeys(replay, new Set(["schema", "nodes", "sprites", "operations"]), "input");
  if (replay.schema !== UGUI_STATE_REPLAY_SCHEMA) {
    fail(`schema must be ${JSON.stringify(UGUI_STATE_REPLAY_SCHEMA)}`);
  }

  const identityOwners = new Map();
  const sprites = normalizeSprites(replay.sprites, identityOwners);
  const { nodes, componentOwners } = normalizeNodes(replay.nodes, identityOwners);
  validateSpriteReferences(nodes, sprites);
  const { children, preorder } = buildHierarchy(nodes);
  const operations = normalizeOperations(
    replay.operations,
    nodes,
    componentOwners,
    sprites,
  );

  const activeOverrides = new Map();
  const enabledOverrides = new Map();
  const spriteOverrides = new Map();
  for (const operation of operations) {
    if (operation.opcode === "SetActive") activeOverrides.set(operation.target, operation.value);
    else if (operation.opcode === "set_enabled") {
      enabledOverrides.set(operation.target, operation.value);
    } else {
      spriteOverrides.set(operation.target, operation.value);
    }
  }

  const hierarchy = [];
  const stateByNode = new Map();
  for (const [hierarchyIndex, node] of preorder.entries()) {
    const selfActive = activeOverrides.get(node.identity) ?? node.initialActive;
    const parentState = node.parent === null ? null : stateByNode.get(node.parent);
    const effectiveActive = selfActive && (parentState?.effectiveActive ?? true);
    const components = node.components.map((component) => {
      const enabled = enabledOverrides.get(component.identity) ?? component.initialEnabled;
      const spriteIdentity = spriteOverrides.has(component.identity)
        ? spriteOverrides.get(component.identity)
        : component.spriteIdentity;
      return {
        identity: component.identity,
        componentIndex: component.componentIndex,
        kind: component.kind,
        enabled,
        spriteCapable: component.spriteCapable,
        spriteIdentity,
        sprite: cloneSprite(spriteIdentity === null ? null : sprites.get(spriteIdentity)),
      };
    });
    const state = {
      identity: node.identity,
      parent: node.parent,
      siblingIndex: node.siblingIndex,
      hierarchyIndex,
      selfActive,
      effectiveActive,
      rectTransform: cloneTransform(node.rectTransform),
      components,
    };
    hierarchy.push(state);
    stateByNode.set(node.identity, state);
  }

  const siblingOrder = [
    {
      parent: null,
      children: children.get(null).map((node) => node.identity),
    },
    ...preorder.map((node) => ({
      parent: node.identity,
      children: children.get(node.identity).map((child) => child.identity),
    })),
  ];

  const contentDrawPlan = [];
  for (const nodeState of hierarchy) {
    if (!nodeState.effectiveActive) continue;
    const transformChain = [];
    let cursor = nodeState;
    while (cursor !== undefined) {
      transformChain.push({
        nodeIdentity: cursor.identity,
        ...cloneTransform(cursor.rectTransform),
      });
      cursor = cursor.parent === null ? undefined : stateByNode.get(cursor.parent);
    }
    transformChain.reverse();

    for (const component of nodeState.components) {
      if (!component.enabled) continue;
      contentDrawPlan.push({
        drawIndex: contentDrawPlan.length,
        hierarchyIndex: nodeState.hierarchyIndex,
        nodeIdentity: nodeState.identity,
        componentIdentity: component.identity,
        componentIndex: component.componentIndex,
        kind: component.kind,
        spriteIdentity: component.spriteIdentity,
        sprite: cloneSprite(component.sprite),
        transformChain: transformChain.map((entry) => ({
          nodeIdentity: entry.nodeIdentity,
          localRotation: [...entry.localRotation],
          localScale: [...entry.localScale],
        })),
      });
    }
  }

  const output = {
    schema: UGUI_STATE_REPLAY_SCHEMA,
    hierarchy,
    siblingOrder,
    drawOrder: contentDrawPlan.map((entry) => entry.componentIdentity),
    contentDrawPlan,
    appliedOperations: operations.map(({
      operationIndex,
      opcode,
      target,
      value,
    }) => ({
      operationIndex,
      opcode,
      target,
      value,
    })),
  };
  return deepFreeze(output);
}
