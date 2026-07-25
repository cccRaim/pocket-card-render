import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

const evidence = JSON.parse(execFileSync(
  process.env.PYTHON || "python",
  ["-B", "build/extract_official_mesh_payload.py"],
  {
    encoding: "utf8",
    shell: process.platform === "win32",
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
    maxBuffer: 64 * 1024 * 1024,
  },
).replace(/^\uFEFF/, ""));

assert.equal(evidence.schemaVersion, 2);
assert.equal(evidence.unityVersion, "2022.3.62f2");
assert.deepEqual(evidence.conversion, {
  position: "(-x, y, z)",
  normal: "(-x, y, z)",
  tangent: "(-x, y, z, -w)",
  texcoord: "(u, 1-v)",
  triangleWinding: "(a,b,c) -> (c,b,a)",
  localPosition: "(-x, y, z)",
  localRotation: "(x, -y, -z, w), accepting quaternion sign equivalence",
  localScale: "(x, y, z)",
  comparison: "ordered expanded float32 triangle streams",
});
assert.deepEqual(evidence.summary, {
  cardCount: 4,
  meshFilterCount: 78,
  builtInMeshFilterCount: 4,
  matchedMeshNodeCount: 74,
  distinctOfficialMeshCount: 17,
  primitiveCount: 130,
  triangleCount: 27202,
  expandedVertexCount: 81606,
  materialSlotResolutionCount: 165,
  exactDirectMaterialSlotCount: 94,
  exactUniqueMaterialSlotCount: 71,
  runtimeRequiredMaterialSlotCount: 0,
  expandedPayloadAggregateSha256: "e3ffe8dd91b6c4a86a63c4c86d098c0ad8ab7d3c731c61584f6eb801c7f2264b",
  localTransformAggregateSha256: "2c8e61ca9edaac44415666fdeb1b4ec4731ad396624d1774ac505155112fe202",
});

assert.deepEqual(evidence.cards.map((card) => ({
  card: card.card,
  prefabSha256: card.prefabSha256,
  glbSha256: card.glbSha256,
  meshFilterCount: card.meshFilterCount,
  builtInMeshFilterCount: card.builtInMeshFilterCount,
  matchedMeshNodeCount: card.matchedMeshNodeCount,
})), [
  {
    card: "cPK_10_000040_00_FUSHIGIBANAex_RR",
    prefabSha256: "5cd3dfd1fa5514f106cb575bbcf17344f4cc87dda51cf5fc6f1bfd20b004b560",
    glbSha256: "f43d1ee4028433b08859968a95629c296d02feae988e766d4a499488d13537a1",
    meshFilterCount: 23,
    builtInMeshFilterCount: 0,
    matchedMeshNodeCount: 23,
  },
  {
    card: "cTR_20_000230_00_LEAF_SR",
    prefabSha256: "97e131723201ba98d18224d3efc5ea4c95e6f307c08cfc875b2d7d3b032e8dca",
    glbSha256: "2fc2dc593def98154e552b0be2ad2b470969b0cb1f43fb6bc693992c9d1de36a",
    meshFilterCount: 18,
    builtInMeshFilterCount: 0,
    matchedMeshNodeCount: 18,
  },
  {
    card: "cTR_20_000670_00_IIBUINOBAKKU_UR",
    prefabSha256: "737840d2d8dd532793d758b92c15efa75caad968603fcd99b936107ffe922ce5",
    glbSha256: "7baaec8f5530af237ec4c5a1fc8f316c8417ba54da94f7c21a32ee7ae833f440",
    meshFilterCount: 19,
    builtInMeshFilterCount: 2,
    matchedMeshNodeCount: 17,
  },
  {
    card: "cPK_20_008900_02_HOUOUex_UR",
    prefabSha256: "e960197906b1d192c5426c4bc280cba670b94d04a74a900807a021ada5981ee2",
    glbSha256: "79a6baac0b373bae63f3f7e382a3130ff009d6a7d3a5974446095a23aead5a9a",
    meshFilterCount: 18,
    builtInMeshFilterCount: 2,
    matchedMeshNodeCount: 16,
  },
]);

for (const card of evidence.cards) {
  assert.equal(card.nodes.length, card.matchedMeshNodeCount);
  assert.equal(card.nodes.flatMap((node) => node.primitives).length > 0, true);
  for (const node of card.nodes) {
    assert.match(node.renderer.identity, /^CAB-[0-9a-f]{32}:-?\d+$/);
    assert.equal(node.renderer.materialIdentities.length > 0, true);
    for (const identity of node.renderer.materialIdentities) {
      assert.match(identity, /^CAB-[0-9a-f]{32}:-?\d+$/);
    }
    assert.equal(Array.isArray(node.localTransform?.position), true);
    assert.equal(node.localTransform.position.length, 3);
    assert.equal(Array.isArray(node.localTransform?.rotation), true);
    assert.equal(node.localTransform.rotation.length, 4);
    assert.equal(Array.isArray(node.localTransform?.scale), true);
    assert.equal(node.localTransform.scale.length, 3);
    assert.match(node.localTransform.float32Sha256, /^[0-9a-f]{64}$/);
    assert.equal([
      ...node.localTransform.position,
      ...node.localTransform.rotation,
      ...node.localTransform.scale,
    ].every(Number.isFinite), true);
    for (const primitive of node.primitives) {
      assert.equal(primitive.materialSlotResolution.length, primitive.submeshes.length);
      for (const resolution of primitive.materialSlotResolution) {
        assert.equal(["exact-direct", "exact-unique-material"].includes(resolution.status), true);
        assert.equal(Number.isInteger(resolution.materialSlot), true);
        assert.equal(
          resolution.materialIdentity,
          node.renderer.materialIdentities[resolution.materialSlot],
        );
      }
    }
  }
}

console.log("Official Mesh payload audit OK");
console.log("  4 cards, 74 asset Mesh nodes, 4 Unity built-in Quad filters");
console.log("  130 primitives, 27,202 triangles, 81,606 expanded vertices byte-exact");
console.log("  165 submesh/material resolutions: 94 direct, 71 unique-material, 0 unresolved");
console.log(`  aggregate ${evidence.summary.expandedPayloadAggregateSha256}`);
console.log(`  74 local TRS nodes byte-exact ${evidence.summary.localTransformAggregateSha256}`);
