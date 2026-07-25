// Unity 2022.3.62f2 native draw-order contract recovered from the official
// Pokemon TCG Pocket 1.6.0 arm64 package. Unknown native fields deliberately
// retain offset-only names; see build/audit-official-draw-order-native.mjs.

const f32 = Math.fround;
const FLOAT_BITS_BUFFER = new ArrayBuffer(4);
const FLOAT_BITS_VIEW = new DataView(FLOAT_BITS_BUFFER);

export const OFFICIAL_DISTANCE_METRIC = Object.freeze({
  Perspective: 0,
  Orthographic: 1,
  CustomAxis: 2,
});

export const OFFICIAL_RENDERER_TYPE = Object.freeze({
  MeshRenderer: 1,
});

export const OFFICIAL_SORTING_CRITERIA = Object.freeze({
  None: 0x00,
  SortingLayer: 0x01,
  RenderQueue: 0x02,
  BackToFront: 0x04,
  QuantizedFrontToBack: 0x08,
  OptimizeStateChanges: 0x10,
  CanvasOrder: 0x20,
  RendererPriority: 0x40,
  CommonOpaque: 0x3b,
  CommonTransparent: 0x17,
});

export const OFFICIAL_DRAW_ORDER_LAYOUT = Object.freeze({
  entryByteSize: 0x58,
  nodeStride: 0x198,
  entry: Object.freeze({
    "u32@0x08": 0x08,
    materialBatchStateKey: 0x08,
    visibleNodeIndex: 0x0c,
    "i16@0x10": 0x10,
    "i32@0x18": 0x18,
    rendererPriority: 0x18,
    "u16@0x1c": 0x1c,
    materialSlotAndSrpBatcherFlags: 0x1c,
    distanceKey: 0x20,
    quantizedDistanceByte: 0x23,
    "u32@0x28": 0x28,
    "u32@0x2c": 0x2c,
    sortingLayerKey: 0x2c,
    "u32@0x30": 0x30,
    sortingGroupKey: 0x30,
    selectedShaderPassIndex: 0x48,
    drawCandidateOrdinal: 0x4c,
    "u64@0x50": 0x50,
  }),
  node: Object.freeze({
    "u16@0xb8": 0xb8,
    staticBatchFirstSubMesh: 0xb8,
    "u16@0xba": 0xba,
    staticBatchSubMeshCount: 0xba,
    "u32@0xe4": 0xe4,
    packedLightmapIndices: 0xe4,
    "u32@0xe8": 0xe8,
    packedRendererFlags: 0xe8,
    rendererTypeMask: 0x3f,
    "i32@0x100": 0x100,
    meshGeometryUniqueId: 0x100,
    "u8@0x106": 0x106,
    lodFadeHighByte: 0x106,
    "u16@0x122": 0x122,
    canvasOrder: 0x122,
  }),
});

const unitySlices = Object.freeze({
  icallRegister: Object.freeze({ startRva: 0x40f09c, endRva: 0x40f0b0, byteSize: 20, sha256: "ded5a1812bf51433c4fbfbf714d9cf1dd20c9901ec9abe7963193995c6877582", bytesHex: "e0e5fff0a1ffffb00034109121302791c9430914" }),
  drawWrapper: Object.freeze({ startRva: 0x4049cc, endRva: 0x4049e8, byteSize: 28, sha256: "5bf98050233da7f277918fd4870305beb1541cc6633e4098e083019d9bf3e53e", bytesHex: "e80340b9840040b9000040f9bf1c0072e5079f1ae80300b9a2ee0414" }),
  rendererListCommand: Object.freeze({ startRva: 0x5404ac, endRva: 0x540608, byteSize: 348, sha256: "90647be0474c324ad829ba61b492b9a376fb0ca00f5097e49a3f65909b174fa1" }),
  entryComparator: Object.freeze({ startRva: 0x54c830, endRva: 0x54cac4, byteSize: 660, sha256: "62ef555ee9af1a0687aebebbbc5b9f8628cc72959209b986a913a14f3f9f94ad", officialSymbol: "RenderObjectSorter::operator()" }),
  shaderPassCandidate: Object.freeze({ startRva: 0x54cac4, endRva: 0x54cc10, byteSize: 332, sha256: "85c9a8316b601459729a9ef55dbab3d375ec7df2f86908647a0f4c2f2d80047e", officialSymbols: Object.freeze(["FindPasses", "NodeHasMotion"]) }),
  sortInputBuilder: Object.freeze({ startRva: 0x54cc10, endRva: 0x54db78, byteSize: 3944, sha256: "440935172837465a015f4bcf481c831aa800129fb7b8c40a1dffe9d11c2c88ac", officialSymbol: "PrepareScriptableLoopObjectData" }),
  distanceKey: Object.freeze({ startRva: 0x54db78, endRva: 0x54dc3c, byteSize: 196, sha256: "47b03b726dcec5baacd70f1a61090f7e6424dfb8ccb147a6fb00bc5090da22ef", officialSymbol: "ComputeSortingDistance" }),
  sortOffsetLoad: Object.freeze({ startRva: 0x54cecc, endRva: 0x54cee4, byteSize: 24, sha256: "99673cadda6b33ea949891991aa93c103c299a61005acbdd87b0d61785f99d7d", bytesHex: "18cd4bb801415cfc02c15cbce88f00f9004d40bde85340b9" }),
  sortOffsetZero: Object.freeze({ startRva: 0x54cf0c, endRva: 0x54cf20, byteSize: 20, sha256: "f442aeddc52b146555dfb2bd61730b07611a6249b37a895a2babc0ba3b9325fb", bytesHex: "e9ef40f98a038052e003271e08250a9b010140fd" }),
  distanceCallInput: Object.freeze({ startRva: 0x54cf44, endRva: 0x54cf7c, byteSize: 56, sha256: "a10ce611c065c5c6e1f8e4b162b7269481818983d968ac162ac29eed635ce16d", bytesHex: "e31b40fde03f40b9e1030891e2030691e3c300fde32f40bde3c30591e4830591ecbb00fde38b01bded7b01bde1b300fde26b01bd00030094" }),
  meshEntryStore: Object.freeze({ startRva: 0x54d3e4, endRva: 0x54d434, byteSize: 80, sha256: "3cc90a39a94b12c902dbb3653760292b6fc25bc59931f35474dfc2ceb062e40b", bytesHex: "090b8052950900f9e0e7076fc822099be97b40f9144d0929730600911f0313eb100100f9112501290d2100790325007902290079011900b91d3900790825042d172900b91bc102f81ce903a9002900fd" }),
  alternateEntryStore: Object.freeze({ startRva: 0x54d8c8, endRva: 0x54d930, byteSize: 104, sha256: "073d6b378eeb71ff2c55e21f6cc84c19b94f72143d86a99c508d60922ea4967d", bytesHex: "090b80521d0800f92b008052a822099b0e0100f91a4501290f2100791b25007913290079e9eb42b9eadb45790b1d00b9ebff8f920b00b0f217510929940600910b00def29f0314eb0825042d1f2900b90bc102f81f3500b90dd903a90a350079096101b80c610a29" }),
  rendererListPrepare: Object.freeze({ startRva: 0x54e37c, endRva: 0x54e438, byteSize: 188, sha256: "7a2874960d2556520dde456f7eed37ad0a6d488cfafcc5bfa23fe8bc0dafae1a", officialSymbol: "PrepareScriptableDrawRenderersJob" }),
  parallelSortDriver: Object.freeze({ startRva: 0x550508, endRva: 0x55078c, byteSize: 644, sha256: "8eec7c421c7b8f3d760a0c04d22d84889028384612a128adf05ca09e9c29831e", officialSymbol: "QSortBlittableMultiThreaded<ScriptableLoopObjectData, RenderObjectSorter>::Sorter::Sort" }),
  quickSort: Object.freeze({ startRva: 0x550b58, endRva: 0x550edc, byteSize: 900, sha256: "b6c4e9a7bbc4c41afb9446ed067261a6632d644840b38b8c2e001b7f6a407dfe", officialSymbol: "qsort_internal::QSort<ScriptableLoopObjectData*, long, RenderObjectSorter>" }),
  quantizedWindow: Object.freeze({ startRva: 0x54c894, endRva: 0x54c8b0, byteSize: 28, sha256: "5562d0b461e5c022094a10265c133286cb1f20268364954568ce84b3db493137", bytesHex: "cb021037cb0018362c8c40394d8c40399f010d6be0279f1a410d0054" }),
  optimizeWindow: Object.freeze({ startRva: 0x54c918, endRva: 0x54cac4, byteSize: 428, sha256: "c17f580cbc111872601d6e7a1cbd31a08340441b8ed82cba6c8cc04f1c8ebce5" }),
  finalTieWindow: Object.freeze({ startRva: 0x54c8d4, endRva: 0x54c8ec, byteSize: 24, sha256: "916468681830b846d44348ba1da79c76df88b78e6e486e4e322e0f754ce6d3e5", bytesHex: "1f01096ba10b0054284c40b9494c40b91f01096b5a000014" }),
});

const il2cppSlices = Object.freeze({
  drawOpaqueExecute: Object.freeze({ startRva: 0x430d3e8, endRva: 0x430d694, byteSize: 684, sha256: "3dcb70767a6e6737980e7cd1d131ee0e301dc1f3b289bfda355dcb7d9159e5d0" }),
  drawTransparentExecute: Object.freeze({ startRva: 0x430d938, endRva: 0x430dcc0, byteSize: 904, sha256: "854f599f20063b5db3d924ffa07ee210f82beb03e51698b61f4092daeabb8ddd" }),
  drawObjectsPassExecute: Object.freeze({ startRva: 0x6420748, endRva: 0x6420ca4, byteSize: 1372, sha256: "cc67f8a91439ca4e409397df5c94bb11c27f195e7129ad95b6787337a48a28dd" }),
  drawObjectsSortSelection: Object.freeze({ startRva: 0x64209a0, endRva: 0x6420a24, byteSize: 132, sha256: "0d430c52fabc156816ca197529cb4721c77a304677facecbfc090434c805bb7c" }),
  drawOpaqueCriteriaWindow: Object.freeze({ startRva: 0x430d4f0, endRva: 0x430d50c, byteSize: 28, sha256: "43ea54920f33dd201d784b2245c7b0e5c2c60eccd2832565fc7903c2a909db10", bytesHex: "a17640f9e8230191e00315aae20314aa63078052e4031faa9ada8294" }),
  drawTransparentCriteriaWindow: Object.freeze({ startRva: 0x430daf4, endRva: 0x430db10, byteSize: 28, sha256: "ea4088bf09634f8cc70742fa8e36b5ac866f430920bb6fea1b4b4d37c134fec7", bytesHex: "a17640f9e8630291e00315aae20314aae3028052e4031faa19d98294" }),
  defaultOpaqueFlagsWindow: Object.freeze({ startRva: 0x64209a0, endRva: 0x64209b8, byteSize: 24, sha256: "59726461808e918e773033d6043749e7307bf8ca69bdb253edb2ad64148147f7", bytesHex: "a9624b3969000034968e41b902000014f602805288ea40f9" }),
});

export const OFFICIAL_DRAW_ORDER_EVIDENCE = Object.freeze({
  package: Object.freeze({
    unityVersion: "2022.3.62f2_7670c08855a9",
    apkmSha256: "9b7f9067e00a54f342bd4f17e669ceeb86b80bb7d34ff2d0d0fe82050a62f201",
    baseApkSha256: "815dc606f3b3e3404199fac80abb46b9249948828178a5cbf6aedb3d9e6809de",
    arm64SplitSha256: "7faf449bae431dcfeda4f882ecb04290af66cc4ccfeefc620e24cac70d22fcec",
    libunitySha256: "43a04223f94b6ca0c7cf128b399fe0656c57b5a18a10bf21bb9ce27aeb219722",
    libil2cppSha256: "3e78eedc62770fff4cb129b4b8d898950e131b710b3c099237fe20d2d34ca48e",
  }),
  metadata: Object.freeze({
    encryptedByteSize: 31429300,
    encryptedSha256: "b691dbdd2f9b35dc0dd6d3eb9cb54782c1013bc5b24fe2a6ed1c87db64ecada2",
    plaintextByteSize: 31429296,
    plaintextSha256: "bf58e06a98f9e9e05a1635f512ea432d33971bfc8280ba26df1c93e94b4f3cb9",
    magic: 0xfab11baf,
    version: 31,
    keyTableRva: 0x7a52554,
    keyTableBytesHex: "b195674699a63503e79e67149da46f04",
    keyTableSha256: "1d36f6dc069f4de139538327e8dbd42ad4c7a45d7465446c127283e9278faf5d",
  }),
  officialUnitySymbols: Object.freeze({
    installerVersion: "2022.3.62f2c1_92e6e6be66dc",
    installerSha256: "891b811f36e607f77be2e232cd5ba46fb403b4ed52fbc9832aa1bf46791a158f",
    releaseLibunitySha256: "9250260245fdbe960845d785e42418890e62ca586d2566e1d4c146c294cd637a",
    releaseSymbolsSha256: "2244367020161ab6f84350dba36ef2c44e645014c056c3cd427b13e9efa05969",
    source: "Unity 2022.3.62f2 Android Build Support Release arm64-v8a libunity.so + libunity.sym.so",
  }),
  libunitySlices: unitySlices,
  libil2cppSlices: il2cppSlices,
});

export const OFFICIAL_PASS_CRITERIA = Object.freeze({
  DrawOpaque: Object.freeze({
    criteria: OFFICIAL_SORTING_CRITERIA.CommonOpaque,
    renderQueueRange: Object.freeze({ lowerBound: 0, upperBound: 2500 }),
    order: Object.freeze(["SortingLayer", "RenderQueue", "QuantizedFrontToBack", "OptimizeStateChanges", "CanvasOrder"]),
    source: "game DrawOpaquePass FilteringSettings range and hardcoded criteria immediate at RVA 0x430d500",
  }),
  DrawTransparent: Object.freeze({
    criteria: OFFICIAL_SORTING_CRITERIA.CommonTransparent,
    renderQueueRange: Object.freeze({ lowerBound: 2501, upperBound: 5000 }),
    order: Object.freeze(["SortingLayer", "RenderQueue", "BackToFront", "OptimizeStateChanges"]),
    source: "game DrawTransparentPass FilteringSettings range and hardcoded criteria immediate at RVA 0x430db04",
  }),
  boundaries: Object.freeze({
    f: "Native visible-node float@0x108 load and explicit-zero alternate path are proved. Its public semantic name is not proved; the four reference prefabs contain MeshRenderer only and serialize no m_SortingFudge.",
    defaultOpaqueSortFlags: "Generic URP DrawObjectsPass reads cameraData + 0x18c, but its runtime value is not proved. The two game custom passes above use hardcoded criteria.",
    optimizeFieldNames: "The 0x58-byte ScriptableLoopObjectData and 0x198-byte RenderNode layouts are proved. SortingGroupKey, static-batch ranges, packed lightmap indices, RendererPriority, SRP-batcher compatibility, LOD fade source, and Mesh SmallMeshID have official/native names; entry+0x08, entry+0x28, and packed Renderer flag bit names remain operational/raw names.",
    exceptionalFloatEnvironment: "NaN payload, subnormal FTZ/DAZ, and target FSQRT edge behavior are not claimed equivalent beyond the raw comparator/formula contract.",
  }),
});

function requireNumber(value, label) {
  if (typeof value !== "number") throw new TypeError(`${label} must be a number`);
  return f32(value);
}

function requireVector(value, length, label) {
  if (value == null || typeof value.length !== "number" || value.length < length) {
    throw new TypeError(`${label} must contain at least ${length} numbers`);
  }
  return Array.from({ length }, (_, index) => requireNumber(value[index], `${label}[${index}]`));
}

export function float32Bits(value) {
  FLOAT_BITS_VIEW.setFloat32(0, requireNumber(value, "value"), true);
  return FLOAT_BITS_VIEW.getUint32(0, true);
}

export function quantizedFrontToBackBucket(distanceKey) {
  return float32Bits(distanceKey) >>> 24;
}

export function officialDistanceKey(input) {
  if (!input || typeof input !== "object") throw new TypeError("distance input is required");
  if (!Object.hasOwn(input, "metric")) throw new TypeError("distance input.metric is required");
  if (!Object.hasOwn(input, "position")) throw new TypeError("distance input.position is required");
  if (!Object.hasOwn(input, "worldToCamera")) throw new TypeError("distance input.worldToCamera is required");
  if (!Object.hasOwn(input, "f")) throw new TypeError("distance input.f is required; no equivalent default is proved");

  const metric = input.metric;
  if (!Object.values(OFFICIAL_DISTANCE_METRIC).includes(metric)) {
    throw new RangeError(`unsupported distance metric ${metric}`);
  }
  const [px, py, pz] = requireVector(input.position, 3, "position");
  const matrix = requireVector(input.worldToCamera, 16, "worldToCamera");
  const sortOffset = requireNumber(input.f, "f");

  const zx = f32(matrix[2] * px);
  const zy = f32(matrix[6] * py);
  const zxy = f32(zx + zy);
  const zz = f32(matrix[10] * pz);
  const cameraSpaceZ = f32(f32(zxy + zz) + matrix[14]);

  let primary;
  if (metric === OFFICIAL_DISTANCE_METRIC.Orthographic) {
    primary = f32(cameraSpaceZ - sortOffset);
  } else if (metric === OFFICIAL_DISTANCE_METRIC.CustomAxis) {
    if (!Object.hasOwn(input, "customAxis")) throw new TypeError("distance input.customAxis is required for CustomAxis");
    const [ax, ay, az] = requireVector(input.customAxis, 3, "customAxis");
    const dotXY = f32(f32(px * ax) + f32(py * ay));
    const dot = f32(dotXY + f32(pz * az));
    primary = f32(f32(-dot) - sortOffset);
  } else {
    if (!Object.hasOwn(input, "cameraPosition")) throw new TypeError("distance input.cameraPosition is required for Perspective");
    const [cx, cy, cz] = requireVector(input.cameraPosition, 3, "cameraPosition");
    const dx = f32(px - cx);
    const dy = f32(py - cy);
    const dz = f32(pz - cz);
    const xy2 = f32(f32(dx * dx) + f32(dy * dy));
    const squaredDistance = f32(xy2 + f32(dz * dz));
    if (sortOffset === 0) {
      primary = f32(-squaredDistance);
    } else {
      const adjustedDistance = f32(f32(Math.sqrt(squaredDistance)) + sortOffset);
      const square = f32(adjustedDistance * adjustedDistance);
      const selected = adjustedDistance < 0 ? f32(-square) : square;
      primary = f32(-selected);
    }
  }

  return Object.freeze({
    primary,
    secondary: f32(-cameraSpaceZ),
    cameraSpaceZ,
    quantizedFrontToBackBucket: quantizedFrontToBackBucket(primary),
  });
}

function asDataView(value, label) {
  if (value instanceof DataView) return value;
  if (value instanceof ArrayBuffer) return new DataView(value);
  if (ArrayBuffer.isView(value)) return new DataView(value.buffer, value.byteOffset, value.byteLength);
  throw new TypeError(`${label} must be a DataView, ArrayBuffer, or typed array`);
}

function requireEntry(value, label) {
  const view = asDataView(value, label);
  if (view.byteLength < OFFICIAL_DRAW_ORDER_LAYOUT.entryByteSize) {
    throw new RangeError(`${label} must contain at least 0x58 bytes`);
  }
  return view;
}

function requireCriteria(value) {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
    throw new TypeError("criteria must be an unsigned 32-bit integer");
  }
  return value >>> 0;
}

function nodeAt(nodes, entry, label) {
  const index = entry.getUint32(0x0c, true);
  const byteOffset = index * OFFICIAL_DRAW_ORDER_LAYOUT.nodeStride;
  if (!Number.isSafeInteger(byteOffset)
      || byteOffset + OFFICIAL_DRAW_ORDER_LAYOUT.nodeStride > nodes.byteLength) {
    throw new RangeError(`${label} visibleNodeIndex ${index} is outside the supplied raw node table`);
  }
  return new DataView(nodes.buffer, nodes.byteOffset + byteOffset, OFFICIAL_DRAW_ORDER_LAYOUT.nodeStride);
}

function requiresNodes(criteria) {
  return Boolean(criteria & (OFFICIAL_SORTING_CRITERIA.BackToFront
    | OFFICIAL_SORTING_CRITERIA.OptimizeStateChanges
    | OFFICIAL_SORTING_CRITERIA.CanvasOrder));
}

export function officialDrawPrecedes(lhsRaw, rhsRaw, context) {
  if (!context || typeof context !== "object" || !Object.hasOwn(context, "criteria")) {
    throw new TypeError("draw-order context.criteria is required");
  }
  const criteria = requireCriteria(context.criteria);
  const lhs = requireEntry(lhsRaw, "lhs entry");
  const rhs = requireEntry(rhsRaw, "rhs entry");
  let nodes = null;
  let lhsNode = null;
  let rhsNode = null;
  if (requiresNodes(criteria)) {
    if (!Object.hasOwn(context, "nodes")) {
      throw new TypeError("draw-order context.nodes is required by the selected criteria; no default node fields are equivalent");
    }
    nodes = asDataView(context.nodes, "node table");
    lhsNode = nodeAt(nodes, lhs, "lhs");
    rhsNode = nodeAt(nodes, rhs, "rhs");
  }

  if (criteria & OFFICIAL_SORTING_CRITERIA.SortingLayer) {
    const a = lhs.getUint32(0x2c, true);
    const b = rhs.getUint32(0x2c, true);
    if (a !== b) return a < b;
  }
  if (criteria & OFFICIAL_SORTING_CRITERIA.RenderQueue) {
    const a = lhs.getInt16(0x10, true);
    const b = rhs.getInt16(0x10, true);
    if (a !== b) return a < b;
  }
  if (criteria & OFFICIAL_SORTING_CRITERIA.RendererPriority) {
    const a = lhs.getInt32(0x18, true);
    const b = rhs.getInt32(0x18, true);
    if (a !== b) return a < b;
  }

  if (criteria & OFFICIAL_SORTING_CRITERIA.BackToFront) {
    const a = lhs.getFloat32(0x20, true);
    const b = rhs.getFloat32(0x20, true);
    if (a !== b) return a < b;

    const raw30A = lhs.getUint32(0x30, true);
    const raw30B = rhs.getUint32(0x30, true);
    const bothReserved = raw30A >= 0xfffff000 && raw30B >= 0xfffff000;
    if (!bothReserved && raw30A !== raw30B) return raw30A < raw30B;

    const node122A = lhsNode.getUint16(0x122, true);
    const node122B = rhsNode.getUint16(0x122, true);
    if (node122A !== node122B) return node122A < node122B;

    const raw1cA = lhs.getUint16(0x1c, true) >>> 1;
    const raw1cB = rhs.getUint16(0x1c, true) >>> 1;
    if (raw1cA !== raw1cB) return raw1cA < raw1cB;
  }

  if (criteria & OFFICIAL_SORTING_CRITERIA.QuantizedFrontToBack) {
    const a = lhs.getUint8(0x23);
    const b = rhs.getUint8(0x23);
    if (a !== b) return a < b;
  }

  if (criteria & OFFICIAL_SORTING_CRITERIA.OptimizeStateChanges) {
    const flagA = lhs.getUint16(0x1c, true) & 1;
    const flagB = rhs.getUint16(0x1c, true) & 1;
    if (flagA !== flagB) return flagA !== 0;

    const nodeE8A = lhsNode.getUint32(0xe8, true) & 0x3f;
    const nodeE8B = rhsNode.getUint32(0xe8, true) & 0x3f;
    if (nodeE8A !== nodeE8B) return nodeE8A < nodeE8B;

    const node106A = lhsNode.getUint8(0x106);
    const node106B = rhsNode.getUint8(0x106);
    if (node106A !== node106B) return node106A < node106B;

    const gA = lhsNode.getUint16(0xba, true);
    const gB = rhsNode.getUint16(0xba, true);
    if (gA !== 0 && gB !== 0) {
      const entry08A = lhs.getUint32(0x08, true);
      const entry08B = rhs.getUint32(0x08, true);
      if (entry08A !== entry08B) return entry08A < entry08B;

      const node100A = lhsNode.getInt32(0x100, true);
      const node100B = rhsNode.getInt32(0x100, true);
      if (node100A !== node100B) return node100A < node100B;

      const nodeB8A = lhsNode.getUint16(0xb8, true);
      const nodeB8B = rhsNode.getUint16(0xb8, true);
      if (nodeB8A !== nodeB8B) return nodeB8A < nodeB8B;
    } else if ((gA !== 0) !== (gB !== 0)) {
      return gA !== 0;
    } else {
      const nodeE4A = lhsNode.getUint32(0xe4, true);
      const nodeE4B = rhsNode.getUint32(0xe4, true);
      if (nodeE4A !== nodeE4B) return nodeE4A < nodeE4B;

      const entry08A = lhs.getUint32(0x08, true);
      const entry08B = rhs.getUint32(0x08, true);
      if (entry08A !== entry08B) return entry08A < entry08B;

      const entry28A = lhs.getUint32(0x28, true);
      const entry28B = rhs.getUint32(0x28, true);
      if (entry28A !== entry28B) return entry28A > entry28B;
    }
  }

  if (criteria & OFFICIAL_SORTING_CRITERIA.CanvasOrder) {
    const a = lhsNode.getUint16(0x122, true);
    const b = rhsNode.getUint16(0x122, true);
    if (a !== b) return a > b;
  }

  const visibleNodeA = lhs.getUint32(0x0c, true);
  const visibleNodeB = rhs.getUint32(0x0c, true);
  if (visibleNodeA !== visibleNodeB) return visibleNodeA < visibleNodeB;

  const candidateA = lhs.getUint32(0x4c, true);
  const candidateB = rhs.getUint32(0x4c, true);
  return candidateA < candidateB;
}

export function compareOfficialDrawEntries(lhs, rhs, context) {
  if (officialDrawPrecedes(lhs, rhs, context)) return -1;
  if (officialDrawPrecedes(rhs, lhs, context)) return 1;
  return 0;
}

function capturedInteger(descriptor, name, minimum, maximum, label) {
  const value = descriptor?.[name];
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new TypeError(`${label}.${name} must be an integer in [${minimum}, ${maximum}]`);
  }
  return value;
}

function capturedU8(descriptor, name, label) {
  return capturedInteger(descriptor, name, 0, 0xff, label);
}

function capturedU16(descriptor, name, label) {
  return capturedInteger(descriptor, name, 0, 0xffff, label);
}

function capturedU32(descriptor, name, label) {
  return capturedInteger(descriptor, name, 0, 0xffffffff, label) >>> 0;
}

function compareAscending(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function compareDescending(a, b) {
  return a > b ? -1 : a < b ? 1 : 0;
}

// Compares the native suffix beginning at OptimizeStateChanges after every earlier
// criterion has already tied. This object form is for session-bound capture artifacts;
// compareOfficialDrawEntries above remains the byte-layout authority.
export function compareOfficialCapturedSuffix(lhs, rhs, context) {
  if (!lhs || typeof lhs !== "object" || !rhs || typeof rhs !== "object") {
    throw new TypeError("captured draw descriptors are required");
  }
  if (!context || typeof context !== "object" || !Object.hasOwn(context, "criteria")) {
    throw new TypeError("captured draw-order context.criteria is required");
  }
  const criteria = requireCriteria(context.criteria);

  if (criteria & OFFICIAL_SORTING_CRITERIA.OptimizeStateChanges) {
    let order = compareDescending(
      capturedInteger(lhs, "srpBatcherCompatible", 0, 1, "lhs"),
      capturedInteger(rhs, "srpBatcherCompatible", 0, 1, "rhs"),
    );
    if (order) return order;

    order = compareAscending(
      capturedInteger(lhs, "rendererTypeValue", 0, 0x3f, "lhs"),
      capturedInteger(rhs, "rendererTypeValue", 0, 0x3f, "rhs"),
    );
    if (order) return order;

    order = compareAscending(
      capturedU8(lhs, "lodFadeHighByte", "lhs"),
      capturedU8(rhs, "lodFadeHighByte", "rhs"),
    );
    if (order) return order;

    const staticCountA = capturedU16(lhs, "staticBatchSubMeshCount", "lhs");
    const staticCountB = capturedU16(rhs, "staticBatchSubMeshCount", "rhs");
    if (staticCountA !== 0 && staticCountB !== 0) {
      order = compareAscending(capturedU32(lhs, "stateKey", "lhs"), capturedU32(rhs, "stateKey", "rhs"));
      if (order) return order;
      order = compareAscending(
        capturedU32(lhs, "meshSmallMeshId", "lhs") | 0,
        capturedU32(rhs, "meshSmallMeshId", "rhs") | 0,
      );
      if (order) return order;
      order = compareAscending(
        capturedU16(lhs, "staticBatchFirstSubMesh", "lhs"),
        capturedU16(rhs, "staticBatchFirstSubMesh", "rhs"),
      );
      if (order) return order;
    } else if ((staticCountA !== 0) !== (staticCountB !== 0)) {
      return staticCountA !== 0 ? -1 : 1;
    } else {
      order = compareAscending(
        capturedU32(lhs, "packedLightmapIndices", "lhs"),
        capturedU32(rhs, "packedLightmapIndices", "rhs"),
      );
      if (order) return order;
      order = compareAscending(capturedU32(lhs, "stateKey", "lhs"), capturedU32(rhs, "stateKey", "rhs"));
      if (order) return order;
      order = compareDescending(capturedU32(lhs, "entry28", "lhs"), capturedU32(rhs, "entry28", "rhs"));
      if (order) return order;
    }
  }

  if (criteria & OFFICIAL_SORTING_CRITERIA.CanvasOrder) {
    const order = compareDescending(
      capturedU16(lhs, "canvasOrder", "lhs"),
      capturedU16(rhs, "canvasOrder", "rhs"),
    );
    if (order) return order;
  }

  let order = compareAscending(
    capturedU32(lhs, "visibleNodeIndex", "lhs"),
    capturedU32(rhs, "visibleNodeIndex", "rhs"),
  );
  if (order) return order;
  order = compareAscending(
    capturedU32(lhs, "drawCandidateOrdinal", "lhs"),
    capturedU32(rhs, "drawCandidateOrdinal", "rhs"),
  );
  return order;
}
