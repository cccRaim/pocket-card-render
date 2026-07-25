// Reproducible, official-only audit of the 1.6.0 card display path and RT0 alpha.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PYTHON = process.env.PYTHON || "python";

const EXPECTED_SOURCE = {
  apkm: [285917033, "9b7f9067e00a54f342bd4f17e669ceeb86b80bb7d34ff2d0d0fe82050a62f201"],
  baseApk: [43516766, "815dc606f3b3e3404199fac80abb46b9249948828178a5cbf6aedb3d9e6809de"],
  arm64Split: [56968881, "7faf449bae431dcfeda4f882ecb04290af66cc4ccfeefc620e24cac70d22fcec"],
  libil2cpp: [128218264, "3e78eedc62770fff4cb129b4b8d898950e131b710b3c099237fe20d2d34ca48e"],
  globalgamemanagers: [880940, "5a1ca51ec16b267710479b85e33bfe150c4aab255e9716fd33d51ce7a33ea017"],
  metadataEncrypted: [31429300, "b691dbdd2f9b35dc0dd6d3eb9cb54782c1013bc5b24fe2a6ed1c87db64ecada2"],
  metadataPlaintext: [31429296, "bf58e06a98f9e9e05a1635f512ea432d33971bfc8280ba26df1c93e94b4f3cb9"],
};

const EXPECTED_METHODS = {
  uiCardViewCreateRenderer: ["0x443d880", "0x443d96c", 236, "6bfe5bd0cc20a873e19f87dc7f3ebd6c80a58b735b17f9f91de4fab8ffee8d38"],
  cardRendererCtor: ["0x443d96c", "0x443da4c", 224, "f21dc5d97436d8d46e8521149984e5b7f2c4a37abebb7bfc67b51712d8890dc4"],
  cardRendererCreateRenderTexture: ["0x4444410", "0x4444794", 900, "45ca1caf6da17b9fb87887caa5ac075211c9b99fde4b07b3a879cb40198e488d"],
  asset3DCreateRenderTexture: ["0x4396050", "0x439612c", 220, "c5023cb59cc7c680154fd16da7e76c32de8942341c8a74e77da2c20b2056f094"],
  asset3DGetRenderTexture: ["0x4395654", "0x439565c", 8, "ac1915dbf8ae56825a9e0c79c21190a655d4b32b9c10f299546aad7c9ecadc66"],
  uiAssetInitializeMoveNext: ["0x43942ec", "0x4394f74", 3208, "902a14b9c72def1b44095001d883de1d4fc3374c27a0e8bb8a33aa4d00898f39"],
  rawImageSetTexture: ["0x6726f1c", "0x6726fd8", 188, "98749d5c08cb5ee61280b150f2def5e11208e2bddc2fe78d79c7dc0a072e4b9e"],
  graphicSetMaterialDirty: ["0x65beea0", "0x65bef34", 148, "6371eba3107c678665394a262393d335cc9d28eb462d24dd83cda71e05df985a"],
  graphicRebuild: ["0x65c01e4", "0x65c02c8", 228, "44bf236158c8d61fab11b2bdef489459a5ffcb15bbafd5c0e27b8445885c04db"],
  graphicUpdateMaterial: ["0x65c02d0", "0x65c0388", 184, "da43d6966189ab8bfdf94358531d5e8dbcac23395fc77705cb1481ceaf984ec1"],
  canvasSetMaterialCount: ["0x6718304", "0x6718348", 68, "f1ff3dec87aa16d70061bb79ae5c022c32018767f57ea3630eeb5e13d73e61a6"],
  canvasSetMaterial: ["0x67188f4", "0x6718948", 84, "13c6de528a9ceb61d466c2f38c6a884c553349f94a2e713c7ddd490b592d01a8"],
  canvasSetTexture: ["0x6718a24", "0x6718a68", 68, "2ec96948a7bd2fccc5adde7b629ad67de66747550174137f6534f43a3774e401"],
};

const EXPECTED_DEFINITIONS = {
  uiCardView: {
    index: 29442, token: "0x02000091",
    fields: { cardRenderer: ["_cardRenderer", "0x040004be"] },
    methods: { createRenderer: ["CreateRenderer", 0, 78, "0x06000278"] },
  },
  cardRenderer: {
    index: 29470, token: "0x020000b4", fields: {},
    methods: {
      ctor: [".ctor", 4, 65535, "0x060002f5"],
      createRenderTexture: ["CreateRenderTexture", 2, 65535, "0x060002fe"],
    },
  },
  asset3DRenderer: {
    index: 39701, token: "0x02000015",
    fields: { renderTexture: ["_renderTexture", "0x0400005b"] },
    methods: {
      getRenderTexture: ["get_RenderTexture", 0, 6, "0x060000aa"],
      createRenderTexture: ["CreateRenderTexture", 4, 65535, "0x060000b9"],
    },
  },
  asset3DRendererInterface: {
    index: 39702, token: "0x02000017", fields: {},
    methods: { getRenderTexture: ["get_RenderTexture", 0, 2, "0x060000c1"] },
  },
  uiAsset3DView: {
    index: 39699, token: "0x02000011",
    fields: { assetRenderer: ["<AssetRenderer>k__BackingField", "0x0400003c"] },
    methods: {
      createRenderer: ["CreateRenderer", 0, 78, "0x0600008f"],
      initialize: ["Initialize", 1, 81, "0x06000092"],
    },
  },
  uiAssetInitializeState: {
    index: 39697, token: "0x02000013",
    fields: {
      view: ["<>4__this", "0x04000048"],
      child: ["<child>5__2", "0x0400004a"],
    },
    methods: { moveNext: ["MoveNext", 0, 4, "0x0600009f"] },
  },
  rawImage: {
    index: 29675, token: "0x02000051",
    fields: { texture: ["m_Texture", "0x04000185"] },
    methods: { setTexture: ["set_texture", 1, 65535, "0x06000344"] },
  },
  graphic: {
    index: 29618, token: "0x02000018",
    fields: {
      canvasRenderer: ["m_CanvasRenderer", "0x0400005f"],
      materialDirty: ["m_MaterialDirty", "0x04000062"],
    },
    methods: {
      setMaterialDirty: ["SetMaterialDirty", 0, 29, "0x060000c7"],
      rebuild: ["Rebuild", 1, 37, "0x060000db"],
      updateMaterial: ["UpdateMaterial", 0, 40, "0x060000de"],
    },
  },
  canvasRenderer: {
    index: 41122, token: "0x02000004", fields: {},
    methods: {
      setMaterialCount: ["set_materialCount", 1, 65535, "0x0600000f"],
      setMaterial: ["SetMaterial", 2, 65535, "0x06000022"],
      setTexture: ["SetTexture", 1, 65535, "0x06000026"],
    },
  },
};

const EXPECTED_ICALLS = {
  setMaterialCount: [
    "canvasSetMaterialCount", "0x1ad7671",
    "UnityEngine.CanvasRenderer::set_materialCount(System.Int32)", 59,
    "d9dccec92e32dae9a857d000f4ca9777cdf8a33c1fbe377d445d21895da6b1db",
  ],
  setMaterial: [
    "canvasSetMaterial", "0x1ab5333",
    "UnityEngine.CanvasRenderer::SetMaterial(UnityEngine.Material,System.Int32)", 74,
    "3a36f6345597067f0fd89b0ad1515e3ccf15204f49c74e6b9498d743de075934",
  ],
  setTexture: [
    "canvasSetTexture", "0x1acbc90",
    "UnityEngine.CanvasRenderer::SetTexture(UnityEngine.Texture)", 59,
    "9a05a3c4a41c3c25ed6fc7ef75a1c7dd84aa7ba3f34d28797dfc2b4d8321d556",
  ],
};

const EXPECTED_CARDS = {
  cPK_10_000040_00_FUSHIGIBANAex_RR: {
    byteSize: 1837057,
    sha256: "5cd3dfd1fa5514f106cb575bbcf17344f4cc87dda51cf5fc6f1bfd20b004b560",
    meshRenderers: 23, materialReferences: 30,
    counts: { "clear-to-zero": 11, "multiply-by-1-srcA": 13, preserve: 6 },
  },
  cPK_20_008900_02_HOUOUex_UR: {
    byteSize: 1074403,
    sha256: "e960197906b1d192c5426c4bc280cba670b94d04a74a900807a021ada5981ee2",
    meshRenderers: 18, materialReferences: 22,
    counts: { "clear-to-zero": 6, "multiply-by-1-srcA": 7, preserve: 9 },
  },
  cTR_20_000230_00_LEAF_SR: {
    byteSize: 1476442,
    sha256: "97e131723201ba98d18224d3efc5ea4c95e6f307c08cfc875b2d7d3b032e8dca",
    meshRenderers: 18, materialReferences: 23,
    counts: { "clear-to-zero": 8, "multiply-by-1-srcA": 8, preserve: 7 },
  },
  cTR_20_000670_00_IIBUINOBAKKU_UR: {
    byteSize: 981664,
    sha256: "737840d2d8dd532793d758b92c15efa75caad968603fcd99b936107ffe922ce5",
    meshRenderers: 19, materialReferences: 23,
    counts: { "clear-to-zero": 6, "multiply-by-1-srcA": 8, preserve: 9 },
  },
};

const EXPECTED_SUMMARY = {
  cards: 4,
  meshRenderers: 78,
  materialReferences: 98,
  uniqueMaterials: 70,
  uniqueShaders: 27,
  alphaWritingReferences: 90,
  alphaMaskedReferences: 8,
  rt0AlphaCounts: {
    "clear-to-zero": 31,
    "multiply-by-1-srcA": 36,
    preserve: 31,
  },
};

const EXPECTED_REFERENCE_DIGEST = "9b93692fe9f6cac138cb798cb03adfa3f14abfdbb389ebbf82c41d799d719728";
const ALPHA_CLASSES = ["clear-to-zero", "multiply-by-1-srcA", "preserve"];

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function raw(record) {
  const bytes = Buffer.from(record.rawHex, "hex");
  assert.equal(bytes.length, record.byteSize, "raw record byte size drifted");
  assert.equal(sha256(bytes), record.sha256, "raw record hash drifted");
  return bytes;
}

function field(objectBytes, record) {
  const bytes = raw(record);
  assert.deepEqual(
    objectBytes.subarray(record.objectOffset, record.objectOffset + record.byteSize),
    bytes,
    `${record.name || "serialized field"} bytes are not at the pinned object offset`,
  );
  return bytes;
}

function selected(evidence, method, address) {
  return evidence.native.methods[method].selectedInstructions
    .find((row) => row.address === address)?.text;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  }
  return value;
}

function canonicalDigest(value) {
  return sha256(Buffer.from(JSON.stringify(stableValue(value)), "utf8"));
}

function runExtractor() {
  const args = ["build/extract_official-card-display.py"];
  if (process.env.PCR_APKM) args.push("--apkm", process.env.PCR_APKM);
  if (process.env.PCR_DECRYPTED_ROOT) {
    args.push("--decrypted-root", process.env.PCR_DECRYPTED_ROOT);
  }
  const result = spawnSync(PYTHON, args, {
    cwd: ROOT,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    shell: process.platform === "win32",
    windowsHide: true,
  });
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || "extractor failed").trim());
  }
  return JSON.parse(result.stdout.replace(/^\uFEFF/, ""));
}

const evidence = runExtractor();
assert.equal(evidence.schemaVersion, 1);
assert.equal(evidence.status, "proved-with-explicit-boundaries");
assert.deepEqual(evidence.evidencePolicy, {
  officialOnly: true,
  readInputs: [
    "1.6.0 APKM base.apk and arm64 split",
    "1.6.0 decrypted official card/shader bundles",
  ],
  excludedInputs: ["scene.json", "recipes", "browser runtime", "screenshots"],
});

for (const key of ["apkm", "baseApk", "arm64Split", "libil2cpp", "globalgamemanagers"]) {
  const source = evidence.source[key];
  assert.deepEqual([source.byteSize, source.sha256], EXPECTED_SOURCE[key], `${key} drifted`);
  assert.equal(source.rawHex, undefined, `${key} must not inflate evidence with full raw bytes`);
}
assert.deepEqual(
  [evidence.source.metadata.encryptedByteSize, evidence.source.metadata.encryptedSha256],
  EXPECTED_SOURCE.metadataEncrypted,
  "encrypted global metadata drifted",
);
assert.deepEqual(
  [evidence.source.metadata.plaintextByteSize, evidence.source.metadata.plaintextSha256],
  EXPECTED_SOURCE.metadataPlaintext,
  "decrypted global metadata drifted",
);
assert.equal(evidence.metadata.version, 31);

for (const [key, expected] of Object.entries(EXPECTED_METHODS)) {
  const method = evidence.native.methods[key];
  const body = raw(method);
  assert.deepEqual(
    [method.rvaStart, method.rvaEndExclusive, method.byteSize, method.sha256],
    expected,
    `${key} method body drifted`,
  );
  for (const instruction of method.selectedInstructions) {
    const bytes = Buffer.from(instruction.bytesHex, "hex");
    assert.equal(sha256(bytes), instruction.sha256, `${key} instruction hash drifted`);
    const offset = Number.parseInt(instruction.address, 16) - Number.parseInt(method.rvaStart, 16);
    assert.deepEqual(body.subarray(offset, offset + bytes.length), bytes);
  }
}

// Producer, storage, retrieval, and the exact UI handoff.
assert.equal(selected(evidence, "uiCardViewCreateRenderer", "0x443d940"), "bl #0x443d96c");
assert.equal(selected(evidence, "uiCardViewCreateRenderer", "0x443d94c"), "str x25, [x19, #0x168]");
assert.equal(selected(evidence, "cardRendererCtor", "0x443da48"), "b #0x4444410");
assert.equal(selected(evidence, "cardRendererCreateRenderTexture", "0x44446d0"), "bl #0x4396050");
assert.equal(selected(evidence, "cardRendererCreateRenderTexture", "0x44446dc"), "str x1, [x0, #0x40]!");
assert.equal(selected(evidence, "asset3DGetRenderTexture", "0x4395654"), "ldr x0, [x0, #0x40]");
assert.equal(selected(evidence, "uiAssetInitializeMoveNext", "0x43945a0"), "ldr x9, [x8, #0x618]");
assert.equal(selected(evidence, "uiAssetInitializeMoveNext", "0x43945b4"), "str x1, [x20, #0x128]");
assert.equal(selected(evidence, "uiAssetInitializeMoveNext", "0x43947a4"), "ldr x23, [x23]");
assert.equal(selected(evidence, "uiAssetInitializeMoveNext", "0x43947ec"), "mov w2, #2");
assert.equal(selected(evidence, "uiAssetInitializeMoveNext", "0x4394814"), "mov x1, x0");
assert.equal(selected(evidence, "uiAssetInitializeMoveNext", "0x4394824"), "bl #0x6726f1c");

// RawImage dirties Graphic; the CanvasUpdate.PreRender rebuild reaches UpdateMaterial.
assert.equal(selected(evidence, "rawImageSetTexture", "0x6726f64"), "ldr x22, [x21, #0xd8]!");
assert.equal(selected(evidence, "rawImageSetTexture", "0x6726f9c"), "str x20, [x19, #0xd8]");
assert.equal(selected(evidence, "rawImageSetTexture", "0x6726fcc"), "ldr x2, [x8, #0x308]");
assert.equal(selected(evidence, "graphicSetMaterialDirty", "0x65beef4"), "strb w8, [x19, #0x69]");
assert.equal(selected(evidence, "graphicRebuild", "0x65c0268"), "cmp w20, #3");
assert.equal(selected(evidence, "graphicRebuild", "0x65c0294"), "ldrb w8, [x19, #0x69]");
assert.equal(selected(evidence, "graphicRebuild", "0x65c02a4"), "ldr x9, [x8, #0x3b8]");
assert.equal(selected(evidence, "graphicUpdateMaterial", "0x65c0374"), "b #0x6718a24");

assert.deepEqual(evidence.native.fieldOffsets, {
  "UICardView._cardRenderer": "0x168",
  "Asset3DRenderer._renderTexture": "0x40",
  "UIAsset3DView.<AssetRenderer>k__BackingField": "0x128",
  "RawImage.m_Texture": "0xd8",
  "Graphic.m_MaterialDirty": "0x69",
});

for (const [key, expected] of Object.entries(EXPECTED_DEFINITIONS)) {
  const actual = evidence.metadata.types[key];
  raw(actual.record);
  assert.deepEqual(
    [actual.typeDefinitionIndex, actual.token],
    [expected.index, expected.token],
    `${key} metadata type drifted`,
  );
  assert.deepEqual(Object.keys(actual.selectedFields).sort(), Object.keys(expected.fields).sort());
  for (const [fieldKey, fieldExpected] of Object.entries(expected.fields)) {
    const entry = actual.selectedFields[fieldKey];
    raw(entry.record);
    assert.deepEqual([entry.name, entry.token], fieldExpected, `${key}.${fieldKey} metadata drifted`);
  }
  assert.deepEqual(Object.keys(actual.selectedMethods).sort(), Object.keys(expected.methods).sort());
  for (const [methodKey, methodExpected] of Object.entries(expected.methods)) {
    const entry = actual.selectedMethods[methodKey];
    raw(entry.record);
    assert.deepEqual(
      [entry.name, entry.parameterCount, entry.slot, entry.token],
      methodExpected,
      `${key}.${methodKey} metadata drifted`,
    );
  }
}

for (const [key, expected] of Object.entries(EXPECTED_ICALLS)) {
  const actual = evidence.native.icalls[key];
  raw(actual);
  assert.deepEqual(
    [actual.wrapperMethod, actual.rva, actual.value, actual.byteSize, actual.sha256],
    expected,
    `${key} icall string drifted`,
  );
}

const studio = evidence.serialized.modelRenderStudio;
assert.equal(studio.resourcePath, "assets/bin/Data/9d297022bee770046a337555c38bc47a");
assert.deepEqual(
  [studio.resource.byteSize, studio.resource.sha256],
  [2404, "cd50054d1f2a06bc78a58f614a01ec159e5efa83eff0597e76b9ec5d369f3c8f"],
);
assert.equal(studio.camera.pathId, "17");
const cameraBytes = raw(studio.camera.object);
assert.deepEqual(
  [studio.camera.object.byteSize, studio.camera.object.sha256],
  [184, "ad9758f33c51b0e53973ffc76d5772d7ae18cffd291fe5da613e70cc9781cfef"],
);
field(cameraBytes, studio.camera.clearFlags);
field(cameraBytes, studio.camera.clearColor);
field(cameraBytes, studio.camera.clearColor.alpha);
assert.deepEqual(
  [studio.camera.clearFlags.value, studio.camera.clearColor.rgba,
    studio.camera.clearColor.alpha.objectOffset, studio.camera.clearColor.alpha.value],
  [2, [0, 0, 0, 1], 32, 1],
  "ModelRenderStudio Camera clear color drifted",
);
assert.equal(evidence.derived.cameraClearColorAlpha, 1);

const corpus = evidence.prefabRt0Alpha;
assert.equal(corpus.references.length, 98);
assert.equal(corpus.referenceDigestSha256, EXPECTED_REFERENCE_DIGEST);
assert.equal(canonicalDigest(corpus.references), EXPECTED_REFERENCE_DIGEST, "98-reference digest drifted");

const cardNames = corpus.cards.map((card) => card.card);
assert.deepEqual(cardNames, Object.keys(EXPECTED_CARDS));
for (const card of corpus.cards) {
  const expected = EXPECTED_CARDS[card.card];
  assert.deepEqual(
    [card.prefabByteSize, card.prefabSha256, card.meshRenderers,
      card.materialReferences, card.rt0AlphaCounts],
    [expected.byteSize, expected.sha256, expected.meshRenderers,
      expected.materialReferences, expected.counts],
    `${card.card} official prefab corpus drifted`,
  );
}

const keys = new Set();
const materials = new Set();
const shaders = new Set();
const counts = Object.fromEntries(ALPHA_CLASSES.map((key) => [key, 0]));
let alphaWritingReferences = 0;
let alphaMaskedReferences = 0;

function identity(pointer) {
  return `${pointer.targetBundle}|${pointer.targetCab}|${pointer.pathId}`;
}

function classifyAlpha(reference) {
  const state = reference.rt0Alpha;
  const resolved = state.resolved;
  const writesRgb = Boolean(resolved.colorMask & 0x7);
  const writesAlpha = Boolean(resolved.colorMask & 0x8);
  assert.equal(state.writesRgb, writesRgb, `${reference.key}: writesRgb drifted`);
  assert.equal(state.writesAlpha, writesAlpha, `${reference.key}: writesAlpha drifted`);
  if (!writesAlpha) return "preserve";
  const signature = `${resolved.alphaOp}/${resolved.srcAlpha}/${resolved.dstAlpha}`;
  if (signature === "0/0/0") return "clear-to-zero";
  if (signature === "0/0/10") return "multiply-by-1-srcA";
  if (signature === "0/0/1") return "preserve";
  assert.fail(`${reference.key}: color-writing RT0 alpha state ${signature} is outside the three allowed classes`);
}

for (const reference of corpus.references) {
  assert.equal(keys.has(reference.key), false, `duplicate official reference ${reference.key}`);
  keys.add(reference.key);
  assert.equal(reference.renderer.type, "MeshRenderer");
  assert.match(reference.renderer.rawSha256, /^[0-9a-f]{64}$/);
  assert.equal(reference.materialPPtr.targetCab, reference.material.cab);
  assert.equal(reference.materialPPtr.pathId, reference.material.pathId);
  assert.match(reference.materialPPtr.targetBundleSha256, /^[0-9a-f]{64}$/);
  assert.equal(reference.shaderPPtr.targetCab, reference.shader.cab);
  assert.equal(reference.shaderPPtr.pathId, reference.shader.pathId);
  assert.equal(reference.shaderPPtr.targetBundle, reference.shader.bundle);
  assert.equal(reference.shaderPPtr.targetBundleSha256, reference.shader.bundleSha256);
  assert.match(reference.material.rawSha256, /^[0-9a-f]{64}$/);
  assert.match(reference.shader.rawSha256, /^[0-9a-f]{64}$/);
  assert.deepEqual([reference.pass.subShaderIndex, reference.pass.passIndex], [0, 0]);
  assert.equal(reference.rt0Alpha.rtSeparateBlend, false);
  assert.deepEqual(
    Object.keys(reference.rt0Alpha.bindings).sort(),
    ["alphaOp", "colorMask", "colorOp", "dstAlpha", "dstColor", "srcAlpha", "srcColor"],
  );
  for (const [name, binding] of Object.entries(reference.rt0Alpha.bindings)) {
    assert.equal(binding.value, reference.rt0Alpha.resolved[name]);
    assert.ok(Number.isInteger(binding.value), `${reference.key}: ${name} must be an enum integer`);
    if (binding.source === "material-property") {
      assert.equal(typeof binding.property, "string");
      assert.ok(binding.property.length > 0);
    } else {
      assert.equal(binding.source, "shader-state-literal");
      assert.equal(binding.property, null);
    }
  }
  const classification = classifyAlpha(reference);
  assert.equal(reference.rt0Alpha.classification, classification, `${reference.key}: alpha class drifted`);
  assert.ok(ALPHA_CLASSES.includes(classification));
  counts[classification] += 1;
  if (reference.rt0Alpha.writesAlpha) alphaWritingReferences += 1;
  else alphaMaskedReferences += 1;
  materials.add(identity(reference.materialPPtr));
  shaders.add(identity(reference.shaderPPtr));
}

const independentlyDerivedSummary = {
  cards: corpus.cards.length,
  meshRenderers: corpus.cards.reduce((sum, card) => sum + card.meshRenderers, 0),
  materialReferences: corpus.references.length,
  uniqueMaterials: materials.size,
  uniqueShaders: shaders.size,
  alphaWritingReferences,
  alphaMaskedReferences,
  rt0AlphaCounts: counts,
};
assert.deepEqual(independentlyDerivedSummary, EXPECTED_SUMMARY);
assert.deepEqual(corpus.summary, EXPECTED_SUMMARY);

assert.deepEqual(evidence.derived.rt0AlphaAllowedClasses, ALPHA_CLASSES);
assert.deepEqual(evidence.unproved, [
  {
    id: "same-rt-to-homography-material-setter",
    status: "unproved",
    claim: "object identity of this same RenderTexture through a setter on the Homography Material",
  },
  {
    id: "card-ui-default-from-rt",
    status: "unproved",
    claim: "the runtime role or wiring of Card_UI_Default_FromRT",
  },
  {
    id: "render-texture-physical-y",
    status: "unproved",
    claim: "native RenderTexture physical Y origin/orientation",
  },
]);

console.log("Official card display audit OK");
console.log("chain: UICardView.CreateRenderer -> CardRenderer RT -> UIAsset3DView -> RawImage -> Graphic -> CanvasRenderer.SetTexture");
console.log(`RT0 alpha: clear-to-zero=${counts["clear-to-zero"]}, multiply-by-1-srcA=${counts["multiply-by-1-srcA"]}, preserve=${counts.preserve}`);
console.log(`official refs: ${corpus.references.length} across ${corpus.cards.length} prefabs; digest=${corpus.referenceDigestSha256}`);
console.log(`ModelRenderStudio Camera clear color: rgba=${studio.camera.clearColor.rgba.join(",")}`);
console.log("Unproved retained: same RT to Homography Material setter; Card_UI_Default_FromRT; physical Y");
