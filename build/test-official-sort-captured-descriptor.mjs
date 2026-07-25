import assert from "node:assert/strict";
import {
  OFFICIAL_DRAW_ORDER_LAYOUT,
  OFFICIAL_PASS_CRITERIA,
  compareOfficialCapturedSuffix,
  compareOfficialDrawEntries,
} from "../public/render/official-draw-order.js";

function entry(values) {
  const view = new DataView(new ArrayBuffer(OFFICIAL_DRAW_ORDER_LAYOUT.entryByteSize));
  view.setUint32(0x08, values.stateKey, true);
  view.setUint32(0x0c, values.visibleNodeIndex, true);
  view.setInt16(0x10, 2000, true);
  view.setUint16(0x1c, (values.materialSlot << 1) | values.srpBatcherCompatible, true);
  view.setFloat32(0x20, -1, true);
  view.setUint32(0x28, values.entry28, true);
  view.setUint32(0x2c, 0, true);
  view.setUint32(0x30, 0xfffff000, true);
  view.setUint32(0x4c, values.drawCandidateOrdinal, true);
  return view;
}

function setNode(nodes, index, values) {
  const base = index * OFFICIAL_DRAW_ORDER_LAYOUT.nodeStride;
  nodes.setUint16(base + 0xb8, values.staticBatchFirstSubMesh, true);
  nodes.setUint16(base + 0xba, values.staticBatchSubMeshCount, true);
  nodes.setUint32(base + 0xe4, values.packedLightmapIndices, true);
  nodes.setUint32(base + 0xe8, values.rendererTypeValue, true);
  nodes.setInt32(base + 0x100, values.meshSmallMeshId | 0, true);
  nodes.setUint8(base + 0x106, values.lodFadeHighByte);
  nodes.setUint16(base + 0x122, values.canvasOrder, true);
}

let randomState = 0x6d2b79f5;
function randomU32() {
  randomState ^= randomState << 13;
  randomState ^= randomState >>> 17;
  randomState ^= randomState << 5;
  return randomState >>> 0;
}

function randomDescriptor(index, transparent) {
  return {
    materialSlot: transparent ? 0 : randomU32() & 0x7fff,
    srpBatcherCompatible: randomU32() & 1,
    rendererTypeValue: randomU32() & 0x3f,
    lodFadeHighByte: randomU32() & 0xff,
    staticBatchFirstSubMesh: randomU32() & 0xffff,
    staticBatchSubMeshCount: randomU32() % 3,
    packedLightmapIndices: randomU32(),
    stateKey: randomU32(),
    entry28: randomU32(),
    canvasOrder: transparent ? 0 : randomU32() & 0xffff,
    visibleNodeIndex: index,
    meshSmallMeshId: randomU32(),
    drawCandidateOrdinal: randomU32(),
  };
}

function verifyPair(lhs, rhs, criteria, label) {
  const nodes = new DataView(new ArrayBuffer(OFFICIAL_DRAW_ORDER_LAYOUT.nodeStride * 2));
  setNode(nodes, 0, lhs);
  setNode(nodes, 1, rhs);
  const raw = compareOfficialDrawEntries(entry(lhs), entry(rhs), { criteria, nodes });
  const captured = compareOfficialCapturedSuffix(lhs, rhs, { criteria });
  assert.equal(captured, raw, `${label}: object descriptor must match raw native layout`);
  assert.equal(compareOfficialCapturedSuffix(rhs, lhs, { criteria }), -raw,
    `${label}: reverse comparator result`);
}

for (const [label, criteria, transparent] of [
  ["opaque", OFFICIAL_PASS_CRITERIA.DrawOpaque.criteria, false],
  ["transparent-after-prefix", OFFICIAL_PASS_CRITERIA.DrawTransparent.criteria, true],
]) {
  for (let index = 0; index < 10000; index += 1) {
    verifyPair(randomDescriptor(0, transparent), randomDescriptor(1, transparent), criteria,
      `${label} case ${index}`);
  }
}

const tied = {
  materialSlot: 0,
  srpBatcherCompatible: 0,
  rendererTypeValue: 1,
  lodFadeHighByte: 0,
  staticBatchFirstSubMesh: 0,
  staticBatchSubMeshCount: 0,
  packedLightmapIndices: 0xffffffff,
  stateKey: 1,
  entry28: 2,
  canvasOrder: 0,
  visibleNodeIndex: 3,
  meshSmallMeshId: 4,
  drawCandidateOrdinal: 5,
};
assert.equal(compareOfficialCapturedSuffix(tied, { ...tied }, {
  criteria: OFFICIAL_PASS_CRITERIA.DrawOpaque.criteria,
}), 0, "identical captured descriptors tie");
assert.throws(() => compareOfficialCapturedSuffix({ ...tied, stateKey: -1 }, tied, {
  criteria: OFFICIAL_PASS_CRITERIA.DrawOpaque.criteria,
}), /lhs\.stateKey/);

console.log("Official captured sort descriptor differential tests: OK");
console.log("  20,000 deterministic object-vs-raw native comparator pairs");
