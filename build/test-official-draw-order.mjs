import assert from "node:assert/strict";
import {
  OFFICIAL_DISTANCE_METRIC,
  OFFICIAL_DRAW_ORDER_LAYOUT,
  OFFICIAL_PASS_CRITERIA,
  OFFICIAL_RENDERER_TYPE,
  OFFICIAL_SORTING_CRITERIA,
  compareOfficialDrawEntries,
  float32Bits,
  officialDistanceKey,
  officialDrawPrecedes,
  quantizedFrontToBackBucket,
} from "../public/render/official-draw-order.js";

const f32 = Math.fround;
const identity = Object.freeze([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

function floatFromBits(bits) {
  const view = new DataView(new ArrayBuffer(4));
  view.setUint32(0, bits >>> 0, true);
  return view.getFloat32(0, true);
}

function entry(values = {}) {
  const view = new DataView(new ArrayBuffer(OFFICIAL_DRAW_ORDER_LAYOUT.entryByteSize));
  view.setUint32(0x08, values.raw08 ?? 0, true);
  view.setUint32(0x0c, values.visibleNodeIndex ?? 0, true);
  view.setInt16(0x10, values.raw10 ?? 0, true);
  view.setInt32(0x18, values.raw18 ?? 0, true);
  view.setUint16(0x1c, values.raw1c ?? 0, true);
  view.setFloat32(0x20, values.distanceKey ?? -1, true);
  view.setUint32(0x28, values.raw28 ?? 0, true);
  view.setUint32(0x2c, values.raw2c ?? 0, true);
  view.setUint32(0x30, values.raw30 ?? 0, true);
  view.setUint32(0x48, values.selectedShaderPassIndex ?? 0, true);
  view.setUint32(0x4c, values.drawCandidateOrdinal ?? 0, true);
  return view;
}

function nodeTable(count = 2) {
  return new DataView(new ArrayBuffer(OFFICIAL_DRAW_ORDER_LAYOUT.nodeStride * count));
}

function setNode(nodes, index, values = {}) {
  const base = index * OFFICIAL_DRAW_ORDER_LAYOUT.nodeStride;
  nodes.setUint16(base + 0xb8, values.rawB8 ?? 0, true);
  nodes.setUint16(base + 0xba, values.rawBA ?? 0, true);
  nodes.setUint32(base + 0xe4, values.rawE4 ?? 0, true);
  nodes.setUint32(base + 0xe8, values.rawE8 ?? 0, true);
  nodes.setInt32(base + 0x100, values.raw100 ?? 0, true);
  nodes.setUint8(base + 0x106, values.raw106 ?? 0);
  nodes.setUint16(base + 0x122, values.raw122 ?? 0, true);
}

function precedes(a, b, criteria, nodes) {
  return officialDrawPrecedes(a, b, { criteria, nodes });
}

function assertBefore(a, b, criteria, nodes, label) {
  assert.equal(precedes(a, b, criteria, nodes), true, `${label}: lhs must precede rhs`);
  assert.equal(precedes(b, a, criteria, nodes), false, `${label}: reverse must not precede`);
  assert.equal(compareOfficialDrawEntries(a, b, { criteria, nodes }), -1, `${label}: tri-state comparator`);
}

assert.equal(OFFICIAL_SORTING_CRITERIA.CommonOpaque, 0x3b);
assert.equal(OFFICIAL_SORTING_CRITERIA.CommonTransparent, 0x17);
assert.equal(OFFICIAL_RENDERER_TYPE.MeshRenderer, 1);
assert.equal(OFFICIAL_DRAW_ORDER_LAYOUT.entryByteSize, 0x58);
assert.equal(OFFICIAL_DRAW_ORDER_LAYOUT.entry["u64@0x50"], 0x50);
assert.equal(OFFICIAL_DRAW_ORDER_LAYOUT.entry.materialBatchStateKey, 0x08);
assert.equal(OFFICIAL_DRAW_ORDER_LAYOUT.entry.rendererPriority, 0x18);
assert.equal(OFFICIAL_DRAW_ORDER_LAYOUT.entry.materialSlotAndSrpBatcherFlags, 0x1c);
assert.equal(OFFICIAL_DRAW_ORDER_LAYOUT.entry.sortingGroupKey, 0x30);
assert.equal(OFFICIAL_DRAW_ORDER_LAYOUT.node.staticBatchFirstSubMesh, 0xb8);
assert.equal(OFFICIAL_DRAW_ORDER_LAYOUT.node.staticBatchSubMeshCount, 0xba);
assert.equal(OFFICIAL_DRAW_ORDER_LAYOUT.node.packedLightmapIndices, 0xe4);
assert.equal(OFFICIAL_DRAW_ORDER_LAYOUT.node.rendererTypeMask, 0x3f);
assert.equal(OFFICIAL_DRAW_ORDER_LAYOUT.node.meshGeometryUniqueId, 0x100);
assert.equal(OFFICIAL_PASS_CRITERIA.DrawOpaque.criteria, 0x3b);
assert.equal(OFFICIAL_PASS_CRITERIA.DrawTransparent.criteria, 0x17);
assert.deepEqual(OFFICIAL_PASS_CRITERIA.DrawOpaque.renderQueueRange, { lowerBound: 0, upperBound: 2500 });
assert.deepEqual(OFFICIAL_PASS_CRITERIA.DrawTransparent.renderQueueRange, { lowerBound: 2501, upperBound: 5000 });

const position = [12345.678, -0.0001234, 3.1415927];
const cameraPosition = [12340.125, -1.25, 8.5];
const customAxis = [0.25, -0.75, 0.5];
const worldToCamera = [1, 0, 0.125, 0, 0, 1, -0.25, 0, 0, 0, 0.75, 0, 0, 0, -2.5, 1];

let distance = officialDistanceKey({
  metric: OFFICIAL_DISTANCE_METRIC.Perspective,
  position,
  cameraPosition,
  worldToCamera,
  f: 0,
});
assert.equal(float32Bits(distance.primary), 0xc2746e28, "Perspective f=0 ARM-order primary bits");
assert.equal(float32Bits(distance.secondary), 0xc4c0e21c, "Perspective secondary -cameraSpaceZ bits");
assert.equal(float32Bits(distance.cameraSpaceZ), 0x44c0e21c);

distance = officialDistanceKey({
  metric: OFFICIAL_DISTANCE_METRIC.Perspective,
  position,
  cameraPosition,
  worldToCamera,
  f: 0.125,
});
assert.equal(float32Bits(distance.primary), 0xc27c4f58, "Perspective positive f ARM-order bits");

distance = officialDistanceKey({
  metric: OFFICIAL_DISTANCE_METRIC.Perspective,
  position,
  cameraPosition,
  worldToCamera,
  f: -10,
});
assert.equal(float32Bits(distance.primary), 0x40987a1d, "Perspective negative adjusted distance branch");

distance = officialDistanceKey({
  metric: OFFICIAL_DISTANCE_METRIC.Orthographic,
  position,
  worldToCamera,
  f: 0.125,
});
assert.equal(float32Bits(distance.primary), 0x44c0de1c, "Orthographic z-f ARM-order bits");

distance = officialDistanceKey({
  metric: OFFICIAL_DISTANCE_METRIC.CustomAxis,
  position,
  customAxis,
  worldToCamera,
  f: 0.125,
});
assert.equal(float32Bits(distance.primary), 0xc54101d8, "CustomAxis -dot-f ARM-order bits");

for (const [bits, bucket] of [
  [0x80000000, 0x80],
  [0xbeffffff, 0xbe],
  [0xbf000000, 0xbf],
  [0xbfffffff, 0xbf],
  [0xc0000000, 0xc0],
  [0xc0ffffff, 0xc0],
  [0xc1000000, 0xc1],
  [0xff800000, 0xff],
]) {
  assert.equal(quantizedFrontToBackBucket(floatFromBits(bits)), bucket, `bucket boundary 0x${bits.toString(16)}`);
}

assert.throws(() => officialDistanceKey({ metric: 0, position: [0, 0, 0], cameraPosition: [0, 0, 0], worldToCamera: identity }), /input\.f is required/);
assert.throws(() => officialDistanceKey({ metric: 0, position: [0, 0, 0], worldToCamera: identity, f: 0 }), /cameraPosition/);
assert.throws(() => officialDistanceKey({ metric: 2, position: [0, 0, 0], worldToCamera: identity, f: 0 }), /customAxis/);

let nodes = nodeTable();
setNode(nodes, 0);
setNode(nodes, 1);
const opaque = OFFICIAL_SORTING_CRITERIA.CommonOpaque;
const transparent = OFFICIAL_SORTING_CRITERIA.CommonTransparent;

assertBefore(entry({ raw2c: 0, visibleNodeIndex: 0 }), entry({ raw2c: 0xffffffff, visibleNodeIndex: 1 }), opaque, nodes, "SortingLayer u32 ASC");
assertBefore(entry({ raw10: -32768, visibleNodeIndex: 0 }), entry({ raw10: 32767, visibleNodeIndex: 1 }), opaque, nodes, "RenderQueue i16 ASC");
assertBefore(entry({ raw18: -1, visibleNodeIndex: 0 }), entry({ raw18: 1, visibleNodeIndex: 1 }), OFFICIAL_SORTING_CRITERIA.RendererPriority, undefined, "RendererPriority i32 ASC");
assertBefore(entry({ distanceKey: -1, visibleNodeIndex: 0 }), entry({ distanceKey: -2, visibleNodeIndex: 1 }), opaque, nodes, "Quantized top byte ASC");

nodes = nodeTable();
setNode(nodes, 0);
setNode(nodes, 1);
assertBefore(entry({ raw1c: 1, visibleNodeIndex: 0 }), entry({ raw1c: 0, visibleNodeIndex: 1 }), opaque, nodes, "Optimize entry u16@0x1c bit0 DESC");

nodes = nodeTable();
setNode(nodes, 0, { rawE8: 0xffffffc1 });
setNode(nodes, 1, { rawE8: 0x00000002 });
assertBefore(entry({ visibleNodeIndex: 0 }), entry({ visibleNodeIndex: 1 }), opaque, nodes, "Optimize node u32@0xe8 low6 ASC");

nodes = nodeTable();
setNode(nodes, 0, { raw106: 0 });
setNode(nodes, 1, { raw106: 255 });
assertBefore(entry({ visibleNodeIndex: 0 }), entry({ visibleNodeIndex: 1 }), opaque, nodes, "Optimize node u8@0x106 ASC");

nodes = nodeTable();
setNode(nodes, 0, { rawBA: 1 });
setNode(nodes, 1, { rawBA: 2 });
assertBefore(entry({ raw08: 0, visibleNodeIndex: 0 }), entry({ raw08: 0xffffffff, visibleNodeIndex: 1 }), opaque, nodes, "Optimize g!=0 entry u32@0x08 ASC unsigned");

nodes = nodeTable();
setNode(nodes, 0, { rawBA: 1, raw100: -1 });
setNode(nodes, 1, { rawBA: 1, raw100: 1 });
assertBefore(entry({ visibleNodeIndex: 0 }), entry({ visibleNodeIndex: 1 }), opaque, nodes, "Optimize g!=0 node i32@0x100 ASC signed");

nodes = nodeTable();
setNode(nodes, 0, { rawBA: 1, rawB8: 0 });
setNode(nodes, 1, { rawBA: 1, rawB8: 0xffff });
assertBefore(entry({ visibleNodeIndex: 0 }), entry({ visibleNodeIndex: 1 }), opaque, nodes, "Optimize g!=0 node u16@0xb8 ASC");

nodes = nodeTable();
setNode(nodes, 0, { rawBA: 1 });
setNode(nodes, 1, { rawBA: 0 });
assertBefore(entry({ visibleNodeIndex: 0 }), entry({ visibleNodeIndex: 1 }), opaque, nodes, "Optimize exactly-one g nonzero first");

nodes = nodeTable();
setNode(nodes, 0, { rawE4: 0 });
setNode(nodes, 1, { rawE4: 0xffffffff });
assertBefore(entry({ visibleNodeIndex: 0 }), entry({ visibleNodeIndex: 1 }), opaque, nodes, "Optimize g==0 node u32@0xe4 ASC unsigned");

nodes = nodeTable();
setNode(nodes, 0);
setNode(nodes, 1);
assertBefore(entry({ raw08: 0, visibleNodeIndex: 0 }), entry({ raw08: 0xffffffff, visibleNodeIndex: 1 }), opaque, nodes, "Optimize g==0 entry u32@0x08 ASC unsigned");
assertBefore(entry({ raw28: 0xffffffff, visibleNodeIndex: 0 }), entry({ raw28: 0, visibleNodeIndex: 1 }), opaque, nodes, "Optimize g==0 entry u32@0x28 DESC unsigned");

nodes = nodeTable();
setNode(nodes, 0, { raw122: 0xffff });
setNode(nodes, 1, { raw122: 0 });
assertBefore(entry({ visibleNodeIndex: 0 }), entry({ visibleNodeIndex: 1 }), opaque, nodes, "Canvas node u16@0x122 DESC");

nodes = nodeTable();
setNode(nodes, 0);
setNode(nodes, 1);
assertBefore(entry({ visibleNodeIndex: 0 }), entry({ visibleNodeIndex: 1 }), opaque, nodes, "final visibleNodeIndex u32 ASC");
assertBefore(entry({ visibleNodeIndex: 0, drawCandidateOrdinal: 0 }), entry({ visibleNodeIndex: 0, drawCandidateOrdinal: 0xffffffff }), opaque, nodes, "final drawCandidateOrdinal u32 ASC");
assertBefore(
  entry({ visibleNodeIndex: 0, selectedShaderPassIndex: 0xffffffff, drawCandidateOrdinal: 0 }),
  entry({ visibleNodeIndex: 0, selectedShaderPassIndex: 0, drawCandidateOrdinal: 1 }),
  opaque,
  nodes,
  "selected shader pass index is not a final tie-break field",
);

nodes = nodeTable();
setNode(nodes, 0);
setNode(nodes, 1);
assertBefore(entry({ distanceKey: -4, visibleNodeIndex: 0 }), entry({ distanceKey: -1, visibleNodeIndex: 1 }), transparent, nodes, "BackToFront float ASC");
assertBefore(entry({ distanceKey: -1, raw30: 0, visibleNodeIndex: 0 }), entry({ distanceKey: -1, raw30: 5, visibleNodeIndex: 1 }), transparent, nodes, "BackToFront tie entry u32@0x30 ASC");

nodes = nodeTable();
setNode(nodes, 0, { raw122: 0 });
setNode(nodes, 1, { raw122: 1 });
assertBefore(entry({ distanceKey: -1, raw30: 0xfffff000, visibleNodeIndex: 0 }), entry({ distanceKey: -1, raw30: 0xffffffff, visibleNodeIndex: 1 }), transparent, nodes, "BackToFront reserved u32@0x30 skips to node u16@0x122 ASC");

nodes = nodeTable();
setNode(nodes, 0);
setNode(nodes, 1);
assertBefore(entry({ distanceKey: -1, raw1c: 0x0002, visibleNodeIndex: 0 }), entry({ distanceKey: -1, raw1c: 0x0004, visibleNodeIndex: 1 }), transparent, nodes, "BackToFront tie entry u16@0x1c>>1 ASC");

const finalNodes = nodeTable(1);
setNode(finalNodes, 0);
const ordinals = [7, 1, 9, 0, 5, 3, 8, 2, 6, 4].map((value) => entry({ visibleNodeIndex: 0, drawCandidateOrdinal: value }));
function deliberatelyUnstableSelectionSort(values) {
  const result = [...values];
  for (let end = result.length - 1; end > 0; end -= 1) {
    let greatest = 0;
    for (let index = 1; index <= end; index += 1) {
      if (precedes(result[greatest], result[index], opaque, finalNodes)) greatest = index;
    }
    [result[greatest], result[end]] = [result[end], result[greatest]];
  }
  return result;
}
assert.deepEqual(
  deliberatelyUnstableSelectionSort(ordinals).map((item) => item.getUint32(0x4c, true)),
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  "final native tie-break must make result independent of stable-sort behavior",
);

assert.throws(() => officialDrawPrecedes(entry(), entry(), { criteria: opaque }), /context\.nodes is required/);
assert.throws(() => officialDrawPrecedes(entry({ visibleNodeIndex: 1 }), entry(), { criteria: opaque, nodes: nodeTable(1) }), /outside the supplied raw node table/);
assert.equal(f32(floatFromBits(0x80000000)), -0);

console.log("Official native draw-order pure numeric tests: OK");
console.log("  Float32 ARM distance metrics, MSB buckets, full raw Optimize/g branches, transparent ties, final deterministic key");
