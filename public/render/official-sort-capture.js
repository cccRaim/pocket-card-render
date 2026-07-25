import {
  OFFICIAL_PASS_CRITERIA,
  compareOfficialCapturedSuffix,
} from "./official-draw-order.js";

function requireObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value;
}

function requireString(value, label) {
  if (typeof value !== "string" || !value) throw new TypeError(`${label} must be a non-empty string`);
  return value;
}

export function createOfficialCapturedSortResolver({ artifact, collisionManifest, cardId, sceneSha256 }) {
  requireObject(artifact, "artifact");
  requireObject(collisionManifest, "collisionManifest");
  requireString(cardId, "cardId");
  requireString(sceneSha256, "sceneSha256");
  if (artifact.schema !== "pocket-card-render/official-sort-import@1") {
    throw new Error(`unsupported captured sort artifact schema ${artifact.schema}`);
  }
  if (collisionManifest.schema !== "pocket-card-render/official-sort-collision-groups@1") {
    throw new Error(`unsupported collision manifest schema ${collisionManifest.schema}`);
  }
  if (artifact.source?.cardId !== cardId) throw new Error("captured sort artifact cardId mismatch");
  if (artifact.source?.sceneSha256 !== sceneSha256) throw new Error("captured sort artifact scene SHA256 mismatch");
  const draws = requireObject(artifact.draws, "artifact.draws");
  if (!Array.isArray(collisionManifest.groups)) throw new TypeError("collisionManifest.groups must be an array");

  const groupByDrawId = new Map();
  const completeGroups = new Map();
  const incompleteGroupIds = [];
  for (const group of collisionManifest.groups.filter((item) => item.cardId === cardId)) {
    requireObject(group, "collision group");
    const groupId = requireString(group.groupId, "collision group.groupId");
    if (!Array.isArray(group.members) || group.members.length < 2) {
      throw new Error(`${groupId}: collision group must contain at least two members`);
    }
    const descriptors = [];
    let complete = true;
    for (const member of group.members) {
      const drawId = requireString(member.drawId, `${groupId} member.drawId`);
      if (groupByDrawId.has(drawId)) throw new Error(`${drawId}: belongs to multiple collision groups`);
      groupByDrawId.set(drawId, groupId);
      const descriptor = draws[drawId];
      if (!descriptor) {
        complete = false;
        continue;
      }
      if (descriptor.drawId !== drawId || descriptor.materialName !== member.materialName) {
        throw new Error(`${drawId}: captured descriptor identity mismatch`);
      }
      for (const [field, expected] of Object.entries(group.knownOptimizeTies || {})) {
        if (descriptor[field] !== expected) {
          throw new Error(`${drawId}: captured ${field} does not match collision-manifest evidence`);
        }
      }
      descriptors.push([drawId, descriptor]);
    }
    if (complete && descriptors.length === group.members.length) {
      completeGroups.set(groupId, {
        pass: group.pass,
        descriptors: new Map(descriptors),
      });
    } else {
      incompleteGroupIds.push(groupId);
    }
  }

  return Object.freeze({
    cardId,
    completeGroupCount: completeGroups.size,
    incompleteGroupIds: Object.freeze(incompleteGroupIds),
    compare(drawIdA, drawIdB, criteria) {
      if (drawIdA === drawIdB) return 0;
      const groupId = groupByDrawId.get(drawIdA);
      if (!groupId || groupByDrawId.get(drawIdB) !== groupId) return null;
      const group = completeGroups.get(groupId);
      if (!group) return null;
      const expectedCriteria = group.pass === "opaque"
        ? OFFICIAL_PASS_CRITERIA.DrawOpaque.criteria
        : OFFICIAL_PASS_CRITERIA.DrawTransparent.criteria;
      if ((criteria >>> 0) !== expectedCriteria) throw new Error(`${groupId}: pass criteria mismatch`);
      return compareOfficialCapturedSuffix(
        group.descriptors.get(drawIdA),
        group.descriptors.get(drawIdB),
        { criteria: expectedCriteria },
      );
    },
  });
}
