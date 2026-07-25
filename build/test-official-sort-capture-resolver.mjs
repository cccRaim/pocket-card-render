import assert from "node:assert/strict";
import fs from "node:fs";
import { OFFICIAL_PASS_CRITERIA } from "../public/render/official-draw-order.js";
import { createOfficialCapturedSortResolver } from "../public/render/official-sort-capture.js";

const base = Object.freeze({
  materialSlot: 0,
  srpBatcherCompatible: 0,
  rendererTypeValue: 1,
  lodFadeHighByte: 0,
  staticBatchFirstSubMesh: 0,
  staticBatchSubMeshCount: 0,
  packedLightmapIndices: 0xffffffff,
  stateKey: 0,
  entry28: 0,
  canvasOrder: 0,
  visibleNodeIndex: 0,
  meshSmallMeshId: 0,
  drawCandidateOrdinal: 0,
});

function descriptor(drawId, materialName, overrides = {}) {
  return { ...base, drawId, materialName, ...overrides };
}

const manifest = {
  schema: "pocket-card-render/official-sort-collision-groups@1",
  groups: [
    {
      groupId: "card:opaque:q2000",
      cardId: "card",
      pass: "opaque",
      knownOptimizeTies: {
        rendererTypeValue: 1,
        lodFadeHighByte: 0,
        staticBatchSubMeshCount: 0,
        packedLightmapIndices: 0xffffffff,
        srpBatcherCompatible: 0,
      },
      members: [
        { drawId: "draw:a", materialName: "A" },
        { drawId: "draw:b", materialName: "B" },
      ],
    },
    {
      groupId: "card:transparent:q2650",
      cardId: "card",
      pass: "transparent",
      knownOptimizeTies: {
        rendererTypeValue: 1,
        lodFadeHighByte: 0,
        staticBatchSubMeshCount: 0,
        packedLightmapIndices: 0xffffffff,
        srpBatcherCompatible: 0,
      },
      members: [
        { drawId: "draw:c", materialName: "C" },
        { drawId: "draw:d", materialName: "D" },
      ],
    },
  ],
};

const artifact = {
  schema: "pocket-card-render/official-sort-import@1",
  source: { cardId: "card", sceneSha256: "scene-hash" },
  draws: {
    "draw:a": descriptor("draw:a", "A", { stateKey: 1 }),
    "draw:b": descriptor("draw:b", "B", { stateKey: 2 }),
    "draw:c": descriptor("draw:c", "C", { stateKey: 3 }),
  },
};

const resolver = createOfficialCapturedSortResolver({
  artifact,
  collisionManifest: manifest,
  cardId: "card",
  sceneSha256: "scene-hash",
});
assert.equal(resolver.completeGroupCount, 1);
assert.deepEqual(resolver.incompleteGroupIds, ["card:transparent:q2650"]);
assert.equal(resolver.compare("draw:a", "draw:b", OFFICIAL_PASS_CRITERIA.DrawOpaque.criteria), -1);
assert.equal(resolver.compare("draw:b", "draw:a", OFFICIAL_PASS_CRITERIA.DrawOpaque.criteria), 1);
assert.equal(resolver.compare("draw:c", "draw:d", OFFICIAL_PASS_CRITERIA.DrawTransparent.criteria), null,
  "an incomplete group must fall back atomically");
assert.equal(resolver.compare("draw:a", "draw:c", OFFICIAL_PASS_CRITERIA.DrawOpaque.criteria), null,
  "different prefix groups must not use the captured suffix");
assert.throws(() => resolver.compare("draw:a", "draw:b", OFFICIAL_PASS_CRITERIA.DrawTransparent.criteria),
  /pass criteria mismatch/);
assert.throws(() => createOfficialCapturedSortResolver({
  artifact,
  collisionManifest: manifest,
  cardId: "card",
  sceneSha256: "wrong-hash",
}), /scene SHA256 mismatch/);
assert.throws(() => createOfficialCapturedSortResolver({
  artifact: {
    ...artifact,
    draws: { ...artifact.draws, "draw:a": descriptor("draw:a", "wrong", { stateKey: 1 }) },
  },
  collisionManifest: manifest,
  cardId: "card",
  sceneSha256: "scene-hash",
}), /descriptor identity mismatch/);

const canonicalManifest = JSON.parse(fs.readFileSync(
  new URL("../public/render/official-sort-collision-groups.json", import.meta.url), "utf8",
));
const canonicalGroup = canonicalManifest.groups[0];
const canonicalCardGroups = canonicalManifest.groups.filter((group) => group.cardId === canonicalGroup.cardId);
const canonicalArtifact = {
  schema: "pocket-card-render/official-sort-import@1",
  source: { cardId: canonicalGroup.cardId, sceneSha256: "canonical-scene-hash" },
  draws: Object.fromEntries(canonicalGroup.members.map((member, index) => [
    member.drawId,
    descriptor(member.drawId, member.materialName, {
      ...canonicalGroup.knownOptimizeTies,
      stateKey: index + 1,
      visibleNodeIndex: index,
    }),
  ])),
};
const canonicalResolver = createOfficialCapturedSortResolver({
  artifact: canonicalArtifact,
  collisionManifest: canonicalManifest,
  cardId: canonicalGroup.cardId,
  sceneSha256: "canonical-scene-hash",
});
assert.equal(canonicalResolver.completeGroupCount, 1, "one canonical group is atomically complete");
assert.equal(canonicalResolver.incompleteGroupIds.length, canonicalCardGroups.length - 1,
  "the other canonical groups stay incomplete");
assert.equal(canonicalResolver.compare(
  canonicalGroup.members[0].drawId,
  canonicalGroup.members[1].drawId,
  canonicalGroup.pass === "opaque"
    ? OFFICIAL_PASS_CRITERIA.DrawOpaque.criteria
    : OFFICIAL_PASS_CRITERIA.DrawTransparent.criteria,
), -1, "canonical manifest member pair uses captured stateKey");

console.log("Official captured sort group resolver tests: OK");
console.log("  complete groups activate atomically; incomplete/cross-group pairs fall back; canonical manifest linked");
