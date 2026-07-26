// Read-only audit of official sorting-prefix collisions in the four canonical cards.
// It parses scene recipes and GLB geometry directly; no browser, renderer, or screenshot is used.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import {
  OFFICIAL_DISTANCE_METRIC,
  OFFICIAL_PASS_CRITERIA,
  OFFICIAL_RENDERER_TYPE,
  float32Bits,
  officialDistanceKey,
} from "../public/render/official-draw-order.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC = path.join(ROOT, "public");
const CARD_DISPLAY_CONTRACT = path.join(PUBLIC, "render", "card-display-contract.json");
const CANONICAL_SCENES = Object.freeze([
  "scene.cPK_10_000040_00_FUSHIGIBANAex_RR.json",
  "scene.cTR_20_000230_00_LEAF_SR.json",
  "scene.cTR_20_000670_00_IIBUINOBAKKU_UR.json",
  "scene.cPK_20_008900_02_HOUOUex_UR.json",
]);

const EXPECTED = Object.freeze({
  cards: 4,
  sortableDraws: 98,
  groups: 17,
  opaqueGroups: 14,
  transparentGroups: 3,
  collidingDraws: 36,
  materialSortByte17cOnlyGroups: 6,
  sharedShaderInstanceIdGroups: 3,
  distinctShaderInstanceIdGroups: 8,
  // Digest of the data-derived card/pass/prefix/material/node membership below.
  groupDigestSha256: "d2f843b10ac651a9abff8f09a63cba6297526b3e220c94592ed7e9516db6a4ed",
  decisionDigestSha256: "8fef885623b3f86d2e5140cd36cb6054d3eebd58b907194a2b68198b6dfc2e4c",
});

const GLB_MAGIC = 0x46546c67;
const GLB_JSON_CHUNK = 0x4e4f534a;
const GLB_BIN_CHUNK = 0x004e4942;

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function digest(value) {
  return crypto.createHash("sha256").update(stable(value)).digest("hex");
}

function readGlb(file) {
  const data = fs.readFileSync(file);
  assert.ok(data.length >= 20, `${file}: truncated GLB`);
  assert.equal(data.readUInt32LE(0), GLB_MAGIC, `${file}: invalid GLB magic`);
  assert.equal(data.readUInt32LE(4), 2, `${file}: unsupported GLB version`);
  assert.equal(data.readUInt32LE(8), data.length, `${file}: declared GLB length drifted`);

  let gltf = null;
  let binary = null;
  let offset = 12;
  while (offset + 8 <= data.length) {
    const byteLength = data.readUInt32LE(offset);
    const type = data.readUInt32LE(offset + 4);
    offset += 8;
    assert.ok(offset + byteLength <= data.length, `${file}: GLB chunk exceeds file length`);
    const chunk = data.subarray(offset, offset + byteLength);
    if (type === GLB_JSON_CHUNK) {
      assert.equal(gltf, null, `${file}: multiple JSON chunks`);
      gltf = JSON.parse(chunk.toString("utf8").replace(/[\0\x20]+$/, ""));
    } else if (type === GLB_BIN_CHUNK) {
      assert.equal(binary, null, `${file}: multiple BIN chunks`);
      binary = chunk;
    }
    offset += byteLength;
  }
  assert.ok(gltf, `${file}: JSON chunk missing`);
  assert.ok(binary, `${file}: BIN chunk missing`);
  return { gltf, binary };
}

function nodeLocalMatrix(node) {
  if (node.matrix) {
    assert.equal(node.matrix.length, 16, "GLB node matrix must contain 16 values");
    return new THREE.Matrix4().fromArray(node.matrix);
  }
  const position = new THREE.Vector3(...(node.translation || [0, 0, 0]));
  const rotation = new THREE.Quaternion(...(node.rotation || [0, 0, 0, 1]));
  const scale = new THREE.Vector3(...(node.scale || [1, 1, 1]));
  return new THREE.Matrix4().compose(position, rotation, scale);
}

function positionCenter(gltf, binary, accessorIndex, label) {
  const accessor = gltf.accessors?.[accessorIndex];
  assert.ok(accessor, `${label}: POSITION accessor ${accessorIndex} missing`);
  assert.equal(accessor.type, "VEC3", `${label}: POSITION is not VEC3`);
  assert.equal(accessor.componentType, 5126, `${label}: POSITION is not FLOAT`);
  assert.equal(accessor.normalized || false, false, `${label}: normalized POSITION is unsupported`);
  assert.equal(accessor.sparse, undefined, `${label}: sparse POSITION is unsupported`);
  const view = gltf.bufferViews?.[accessor.bufferView];
  assert.ok(view, `${label}: POSITION bufferView missing`);
  assert.equal(view.buffer || 0, 0, `${label}: external GLB buffer is unsupported`);
  const stride = view.byteStride || 12;
  assert.ok(stride >= 12, `${label}: invalid POSITION byteStride ${stride}`);
  const start = (view.byteOffset || 0) + (accessor.byteOffset || 0);
  assert.ok(start + Math.max(0, accessor.count - 1) * stride + 12 <= binary.length,
    `${label}: POSITION accessor exceeds BIN chunk`);

  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let index = 0; index < accessor.count; index += 1) {
    const offset = start + index * stride;
    for (let axis = 0; axis < 3; axis += 1) {
      const value = binary.readFloatLE(offset + axis * 4);
      assert.ok(Number.isFinite(value), `${label}: non-finite POSITION value`);
      min[axis] = Math.min(min[axis], value);
      max[axis] = Math.max(max[axis], value);
    }
  }
  assert.ok(accessor.count > 0, `${label}: empty POSITION accessor`);
  return new THREE.Vector3(
    (min[0] + max[0]) * 0.5,
    (min[1] + max[1]) * 0.5,
    (min[2] + max[2]) * 0.5,
  );
}

function publicAssetPath(url, label) {
  assert.equal(typeof url, "string", `${label}: asset URL missing`);
  assert.ok(url.startsWith("/"), `${label}: asset URL must be root-relative`);
  const resolved = path.resolve(PUBLIC, `.${url}`);
  assert.ok(resolved.startsWith(`${PUBLIC}${path.sep}`), `${label}: asset escapes public directory`);
  return resolved;
}

function requireSortDescriptor(cardId, materialName, recipe) {
  const sort = recipe?.sort;
  assert.ok(sort, `${cardId}:${materialName}: sort descriptor missing`);
  assert.equal(sort.rendererType, "MeshRenderer", `${cardId}:${materialName}: unsupported renderer type`);
  assert.equal(sort.rendererTypeValue, OFFICIAL_RENDERER_TYPE.MeshRenderer,
    `${cardId}:${materialName}: native renderer type drifted`);
  assert.ok(Number.isInteger(sort.materialSlot) && sort.materialSlot >= 0,
    `${cardId}:${materialName}: material slot is invalid`);
  assert.equal(sort.staticBatchFirstSubMesh, 0, `${cardId}:${materialName}: static batch first submesh`);
  assert.equal(sort.staticBatchSubMeshCount, 0, `${cardId}:${materialName}: static batch submesh count`);
  assert.equal(sort.packedLightmapIndices, 0xffffffff, `${cardId}:${materialName}: packed lightmap indices`);
  assert.equal(sort.lodFadeHighByte, 0, `${cardId}:${materialName}: LOD fade high byte`);
  assert.equal(sort.sortingGroupId, 0xfffff, `${cardId}:${materialName}: default SortingGroup ID`);
  assert.equal(sort.sortingGroupOrder, 0, `${cardId}:${materialName}: default SortingGroup order`);
  assert.equal(sort.sortingGroupKey, 0xfffff000, `${cardId}:${materialName}: default SortingGroup key`);
  assert.equal(sort.canvasOrder, 0, `${cardId}:${materialName}: canvas order`);
  for (const field of ["sortingLayerValue", "sortingOrder", "distanceOffset"]) {
    assert.ok(Number.isFinite(sort[field]), `${cardId}:${materialName}: sort.${field} is not finite`);
  }
  assert.ok(Number.isInteger(recipe.queue), `${cardId}:${materialName}: queue is not an integer`);
  return sort;
}

function collectCardDraws(sceneFile, parentMatrix, camera) {
  const scenePath = path.join(PUBLIC, sceneFile);
  const scene = JSON.parse(fs.readFileSync(scenePath, "utf8"));
  const cardId = scene.card?.id;
  assert.ok(cardId, `${sceneFile}: card.id missing`);
  assert.equal(sceneFile, `scene.${cardId}.json`, `${sceneFile}: not the canonical card scene name`);
  const glbPath = publicAssetPath(scene.prefabGlb, sceneFile);
  const { gltf, binary } = readGlb(glbPath);
  const materialNames = (gltf.materials || []).map((material) => material?.name || "");
  const sceneIndex = Number.isInteger(gltf.scene) ? gltf.scene : 0;
  const roots = gltf.scenes?.[sceneIndex]?.nodes;
  assert.ok(Array.isArray(roots), `${sceneFile}: active GLB scene has no roots`);

  const active = new Set();
  const visited = new Set();
  const firstNodeByName = new Map();
  const worldByNode = new Map();
  const draws = [];

  function visit(nodeIndex, parentWorld) {
    assert.ok(Number.isInteger(nodeIndex) && gltf.nodes?.[nodeIndex], `${sceneFile}: invalid node ${nodeIndex}`);
    assert.ok(!active.has(nodeIndex), `${sceneFile}: node cycle at ${nodeIndex}`);
    assert.ok(!visited.has(nodeIndex), `${sceneFile}: node ${nodeIndex} is instanced in active hierarchy`);
    active.add(nodeIndex);
    visited.add(nodeIndex);
    const node = gltf.nodes[nodeIndex];
    const world = parentWorld.clone().multiply(nodeLocalMatrix(node));
    worldByNode.set(nodeIndex, world);
    if (node.name && !firstNodeByName.has(node.name)) firstNodeByName.set(node.name, nodeIndex);

    if (node.mesh !== undefined) {
      const mesh = gltf.meshes?.[node.mesh];
      assert.ok(mesh, `${sceneFile}: node ${nodeIndex} has invalid mesh ${node.mesh}`);
      for (const [primitiveIndex, primitive] of (mesh.primitives || []).entries()) {
        const materialName = materialNames[primitive.material];
        const recipe = scene.materials?.[materialName];
        if (!recipe) continue;
        const accessorIndex = primitive.attributes?.POSITION;
        assert.ok(Number.isInteger(accessorIndex), `${cardId}:${materialName}: POSITION missing`);
        const center = positionCenter(
          gltf,
          binary,
          accessorIndex,
          `${cardId}:node${nodeIndex}:primitive${primitiveIndex}`,
        ).applyMatrix4(world).applyMatrix4(parentMatrix);
        draws.push({
          cardId,
          material: materialName,
          shader: recipe.shader,
          node: node.name || `node:${nodeIndex}`,
          primitiveIndex,
          center,
          queue: recipe.queue,
          sort: requireSortDescriptor(cardId, materialName, recipe),
          source: "glb-primitive",
        });
      }
    }
    for (const child of node.children || []) visit(child, world);
    active.delete(nodeIndex);
  }

  for (const root of roots) visit(root, new THREE.Matrix4());

  const drawnMaterials = new Set(draws.map((draw) => draw.material));
  for (const [materialName, recipe] of Object.entries(scene.materials || {})) {
    if (recipe.shader !== "Card_UR_LensFlare" || drawnMaterials.has(materialName)) continue;
    assert.ok(recipe.go, `${cardId}:${materialName}: LensFlare go missing`);
    const nodeIndex = firstNodeByName.get(recipe.go);
    assert.notEqual(nodeIndex, undefined, `${cardId}:${materialName}: LensFlare node ${recipe.go} missing`);
    const center = new THREE.Vector3().applyMatrix4(worldByNode.get(nodeIndex)).applyMatrix4(parentMatrix);
    draws.push({
      cardId,
      material: materialName,
      shader: recipe.shader,
      node: recipe.go,
      primitiveIndex: 0,
      center,
      queue: recipe.queue,
      sort: requireSortDescriptor(cardId, materialName, recipe),
      source: "official-builtin-quad",
    });
  }

  const cameraPosition = new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld).toArray();
  for (const draw of draws) {
    draw.distance = officialDistanceKey({
      metric: OFFICIAL_DISTANCE_METRIC.Perspective,
      position: draw.center.toArray(),
      worldToCamera: camera.matrixWorldInverse.elements,
      cameraPosition,
      f: draw.sort.distanceOffset,
    });
    const opaqueRange = OFFICIAL_PASS_CRITERIA.DrawOpaque.renderQueueRange;
    const transparentRange = OFFICIAL_PASS_CRITERIA.DrawTransparent.renderQueueRange;
    if (draw.queue >= opaqueRange.lowerBound && draw.queue <= opaqueRange.upperBound) {
      draw.pass = "opaque";
    } else if (draw.queue >= transparentRange.lowerBound && draw.queue <= transparentRange.upperBound) {
      draw.pass = "transparent";
    } else {
      assert.fail(`${draw.cardId}:${draw.material}: queue ${draw.queue} is outside both official passes`);
    }
    draw.distanceComponent = draw.pass === "opaque"
      ? draw.distance.quantizedFrontToBackBucket
      : float32Bits(draw.distance.primary);
    draw.prefixKey = [
      draw.sort.sortingLayerValue,
      draw.sort.sortingOrder,
      draw.queue,
      draw.distanceComponent,
    ].join(":");
  }
  const officialDrawsByMaterial = new Map();
  for (const officialDraw of scene.officialDraws || []) {
    if (!officialDrawsByMaterial.has(officialDraw.materialName)) {
      officialDrawsByMaterial.set(officialDraw.materialName, []);
    }
    officialDrawsByMaterial.get(officialDraw.materialName).push(officialDraw);
  }
  return { cardId, draws, officialDrawsByMaterial, sceneMaterials: scene.materials };
}

function collisionGroups(cards) {
  const groups = [];
  for (const card of cards) {
    const byPrefix = new Map();
    for (const draw of card.draws) {
      const key = `${draw.pass}:${draw.prefixKey}`;
      if (!byPrefix.has(key)) byPrefix.set(key, []);
      byPrefix.get(key).push(draw);
    }
    for (const members of byPrefix.values()) {
      if (members.length < 2) continue;
      members.sort((a, b) => (
        a.material.localeCompare(b.material)
        || a.node.localeCompare(b.node)
        || a.primitiveIndex - b.primitiveIndex
      ));
      const first = members[0];
      groups.push({
        cardId: card.cardId,
        pass: first.pass,
        queue: first.queue,
        sortingLayerValue: first.sort.sortingLayerValue,
        sortingOrder: first.sort.sortingOrder,
        distance: first.pass === "opaque"
          ? { quantizedFrontToBackBucket: first.distanceComponent }
          : {
            primaryFloat32Bits: `0x${first.distanceComponent.toString(16).padStart(8, "0")}`,
            primary: first.distance.primary,
          },
        boundary: "enters-OptimizeStateChanges",
        members: members.map((draw) => ({
          material: draw.material,
          node: draw.node,
          primitiveIndex: draw.primitiveIndex,
          shader: draw.shader,
          source: draw.source,
        })),
      });
    }
  }
  return groups.sort((a, b) => (
    a.cardId.localeCompare(b.cardId)
    || a.pass.localeCompare(b.pass)
    || a.queue - b.queue
    || stable(a.distance).localeCompare(stable(b.distance))
    || stable(a.members).localeCompare(stable(b.members))
  ));
}

function collisionDecisionTable(groups, cards) {
  return groups.map((group) => {
    const card = cards.find((candidate) => candidate.cardId === group.cardId);
    assert.ok(card, `${group.cardId}: collision card missing`);
    const members = group.members.map((member) => {
      const identities = card.officialDrawsByMaterial.get(member.material) || [];
      assert.equal(identities.length, 1,
        `${group.cardId}:${member.material}: collision member must map to exactly one official draw identity`);
      const draw = card.draws.find((candidate) => (
        candidate.material === member.material
        && candidate.node === member.node
        && candidate.primitiveIndex === member.primitiveIndex
      ));
      assert.ok(draw, `${group.cardId}:${member.material}: sortable draw missing`);
      const materialState = card.sceneMaterials[member.material]?.official;
      assert.ok(materialState, `${group.cardId}:${member.material}: serialized Material state missing`);
      return {
        material: member.material,
        materialSlot: draw.sort.materialSlot,
        rendererTypeValue: draw.sort.rendererTypeValue,
        lodFadeHighByte: draw.sort.lodFadeHighByte,
        staticBatchSubMeshCount: draw.sort.staticBatchSubMeshCount,
        packedLightmapIndices: draw.sort.packedLightmapIndices >>> 0,
        srpBatcherCompatible: draw.sort.srpBatcherCompatible,
        materialBatchStateBranch: draw.sort.materialBatchStateBranch,
        serializedLocalKeywordHash: draw.sort.serializedLocalKeywordHash,
        serializedLocalKeywordHashLow8: draw.sort.serializedLocalKeywordHashLow8,
        customRenderQueue: materialState.customRenderQueue,
        enableInstancingVariants: materialState.enableInstancingVariants,
        validKeywords: materialState.validKeywords,
        invalidKeywords: materialState.invalidKeywords,
        shaderKeywordNames: materialState.shaderKeywordNames,
        shaderKeywordFlags: materialState.shaderKeywordFlags,
        ...identities[0],
      };
    });
    assert.equal(new Set(members.map((member) => member.materialIdentity)).size, members.length,
      `${group.cardId}: collision members must have distinct official Material identities`);
    assert.equal(new Set(members.map((member) => member.rendererTypeValue)).size, 1,
      `${group.cardId}: RendererType must tie before the runtime boundary`);
    assert.equal(new Set(members.map((member) => member.lodFadeHighByte)).size, 1,
      `${group.cardId}: LOD fade must tie before the runtime boundary`);
    assert.equal(new Set(members.map((member) => member.staticBatchSubMeshCount)).size, 1,
      `${group.cardId}: static-batch gate must tie before the runtime boundary`);
    assert.equal(new Set(members.map((member) => member.packedLightmapIndices)).size, 1,
      `${group.cardId}: packed lightmaps must tie before the runtime boundary`);
    assert.equal(new Set(members.map((member) => member.srpBatcherCompatible)).size, 1,
      `${group.cardId}: SRP Batcher bit must tie before the runtime boundary`);
    assert.equal(members[0].srpBatcherCompatible, 0,
      `${group.cardId}: canonical SRP Batcher bit`);
    assert.ok(members.every((member) => member.materialBatchStateBranch === "hashed"),
      `${group.cardId}: canonical Material/Shader state branch`);
    const shaderCount = new Set(members.map((member) => member.shaderIdentity)).size;
    const keywordHashCount = new Set(members.map((member) => member.serializedLocalKeywordHash)).size;
    const runtimeBoundaryClass = shaderCount === 1
      ? (keywordHashCount === 1 ? "material-sort-byte17c-only" : "shared-shader-instance-id-low8")
      : "distinct-shader-instance-id-low8-then-material-byte17c-on-tie";
    return {
      cardId: group.cardId,
      pass: group.pass,
      queue: group.queue,
      knownOptimizeTies: {
        rendererTypeValue: members[0].rendererTypeValue,
        lodFadeHighByte: members[0].lodFadeHighByte,
        staticBatchSubMeshCount: members[0].staticBatchSubMeshCount,
        packedLightmapIndices: members[0].packedLightmapIndices,
        srpBatcherCompatible: members[0].srpBatcherCompatible,
      },
      firstUnresolvedField: "entry+0x08: hashed Material/Shader composite state key",
      entry08Branch: "hashed",
      runtimeBoundaryClass,
      members: members.map((member) => ({
        drawId: member.drawId,
        materialName: member.materialName,
        materialSlot: member.materialSlot,
        rendererIdentity: member.rendererIdentity,
        materialIdentity: member.materialIdentity,
        shaderIdentity: member.shaderIdentity,
        meshIdentity: member.meshIdentity,
        customRenderQueue: member.customRenderQueue,
        enableInstancingVariants: member.enableInstancingVariants,
        validKeywords: member.validKeywords,
        invalidKeywords: member.invalidKeywords,
        shaderKeywordNames: member.shaderKeywordNames,
        shaderKeywordFlags: member.shaderKeywordFlags,
        srpBatcherCompatible: member.srpBatcherCompatible,
        materialBatchStateBranch: member.materialBatchStateBranch,
        serializedLocalKeywordHash: member.serializedLocalKeywordHash,
        serializedLocalKeywordHashLow8: member.serializedLocalKeywordHashLow8,
      })),
    };
  });
}

assert.deepEqual(
  OFFICIAL_PASS_CRITERIA.DrawOpaque.order,
  ["SortingLayer", "RenderQueue", "QuantizedFrontToBack", "OptimizeStateChanges", "CanvasOrder"],
  "opaque official prefix contract drifted",
);
assert.deepEqual(
  OFFICIAL_PASS_CRITERIA.DrawTransparent.order,
  ["SortingLayer", "RenderQueue", "BackToFront", "OptimizeStateChanges"],
  "transparent official prefix contract drifted",
);

const displayContract = JSON.parse(fs.readFileSync(CARD_DISPLAY_CONTRACT, "utf8"));
const parentEuler = displayContract.card_transform?.parent_local_euler_degrees;
assert.deepEqual(parentEuler, [0, 180, 0], "official card parent transform drifted");
const parentMatrix = new THREE.Matrix4().makeRotationY(THREE.MathUtils.degToRad(parentEuler[1]));
const cameraConfig = displayContract.camera;
assert.ok(cameraConfig, "official camera contract missing");
const camera = new THREE.PerspectiveCamera(
  cameraConfig.field_of_view_degrees,
  cameraConfig.aspect,
  cameraConfig.near_clip_plane,
  cameraConfig.far_clip_plane,
);
camera.position.set(
  cameraConfig.local_position[0],
  cameraConfig.local_position[1],
  -cameraConfig.local_position[2],
);
camera.lookAt(0, 0, 0);
camera.updateMatrixWorld(true);

const cards = CANONICAL_SCENES.map((sceneFile) => collectCardDraws(sceneFile, parentMatrix, camera));
const groups = collisionGroups(cards);
const decisions = collisionDecisionTable(groups, cards);
const opaqueGroups = groups.filter((group) => group.pass === "opaque");
const transparentGroups = groups.filter((group) => group.pass === "transparent");
const drawCount = cards.reduce((total, card) => total + card.draws.length, 0);
const collidingDraws = groups.reduce((total, group) => total + group.members.length, 0);
const groupDigest = digest(groups);
const decisionDigest = digest(decisions);
const boundaryClassCounts = Object.fromEntries([
  "material-sort-byte17c-only",
  "shared-shader-instance-id-low8",
  "distinct-shader-instance-id-low8-then-material-byte17c-on-tie",
].map((kind) => [kind, decisions.filter((decision) => decision.runtimeBoundaryClass === kind).length]));

assert.equal(cards.length, EXPECTED.cards, "canonical card count drifted");
assert.equal(drawCount, EXPECTED.sortableDraws, "canonical sortable draw coverage drifted");
assert.equal(groups.length, EXPECTED.groups, "sort-prefix collision group count drifted");
assert.equal(opaqueGroups.length, EXPECTED.opaqueGroups, "opaque collision group count drifted");
assert.equal(transparentGroups.length, EXPECTED.transparentGroups, "transparent collision group count drifted");
assert.equal(collidingDraws, EXPECTED.collidingDraws, "colliding draw count drifted");
assert.equal(boundaryClassCounts["material-sort-byte17c-only"],
  EXPECTED.materialSortByte17cOnlyGroups, "Material+0x17c-only runtime-boundary group count drifted");
assert.equal(boundaryClassCounts["shared-shader-instance-id-low8"],
  EXPECTED.sharedShaderInstanceIdGroups, "shared-Shader runtime-boundary group count drifted");
assert.equal(boundaryClassCounts["distinct-shader-instance-id-low8-then-material-byte17c-on-tie"],
  EXPECTED.distinctShaderInstanceIdGroups, "distinct-Shader runtime-boundary group count drifted");
assert.equal(groupDigest, EXPECTED.groupDigestSha256, "sort-prefix collision membership drifted");
assert.equal(decisionDigest, EXPECTED.decisionDigestSha256,
  `sort collision decision table drifted; actual ${decisionDigest}`);
assert.ok(opaqueGroups.every((group) => group.boundary === "enters-OptimizeStateChanges"));
assert.ok(transparentGroups.every((group) => group.boundary === "enters-OptimizeStateChanges"));
for (const group of transparentGroups) {
  const card = cards.find((candidate) => candidate.cardId === group.cardId);
  const members = group.members.map((member) => card.draws.find((draw) => (
    draw.material === member.material
    && draw.node === member.node
    && draw.primitiveIndex === member.primitiveIndex
  )));
  assert.ok(members.every((draw) => (
    draw.sort.sortingGroupKey === 0xfffff000
    && draw.sort.canvasOrder === 0
    && draw.sort.materialSlot === 0
  )), `${group.cardId}: transparent collision must tie on known SortingGroup/Canvas/material-slot keys`);
}

if (process.argv.includes("--json")) {
  console.log(JSON.stringify({
    summary: {
      groups: groups.length,
      opaqueGroups: opaqueGroups.length,
      transparentGroups: transparentGroups.length,
      collidingDraws,
      sortableDraws: drawCount,
      groupDigest,
      decisionDigest,
      boundaryClassCounts,
    },
    decisions,
  }, null, 2));
  process.exit(0);
}

console.log("Official sort-prefix collision audit");
for (const group of groups) {
  const distance = group.pass === "opaque"
    ? `bucket=${group.distance.quantizedFrontToBackBucket}`
    : `primaryBits=${group.distance.primaryFloat32Bits}`;
  console.log(
    `${group.cardId} ${group.pass.padEnd(11)} q${group.queue} ${distance}`
    + ` ${group.boundary}: ${group.members.map((member) => member.material).join(" | ")}`,
  );
}
console.log("");
console.log(`summary: ${groups.length} groups (${opaqueGroups.length} opaque + ${transparentGroups.length} transparent), ${collidingDraws} draws / ${drawCount} total`);
console.log(`group digest: ${groupDigest}`);
console.log(`decision digest: ${decisionDigest}`);
console.log(`runtime boundaries: Material+0x17c-only=${boundaryClassCounts["material-sort-byte17c-only"]}, shared-Shader=${boundaryClassCounts["shared-shader-instance-id-low8"]}, distinct-Shader=${boundaryClassCounts["distinct-shader-instance-id-low8-then-material-byte17c-on-tie"]}`);
console.log("opaque boundary: equal SortingLayer/RenderQueue/QuantizedFrontToBack prefix enters OptimizeStateChanges");
console.log("transparent boundary: equal BackToFront distance, native-default SortingGroupKey, CanvasOrder=0, and materialSlot=0 enter OptimizeStateChanges");
console.log("all collision members tie at SRP bit 0; first unresolved field is entry+0x08 hashed Material/Shader state");
