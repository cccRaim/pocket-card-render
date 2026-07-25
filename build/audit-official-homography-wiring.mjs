#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";


const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PYTHON = process.env.PYTHON || (process.platform === "win32" ? "python" : "python3");

const EXPECTED = {
  source: {
    apkm: [285917033, "9b7f9067e00a54f342bd4f17e669ceeb86b80bb7d34ff2d0d0fe82050a62f201"],
    baseApk: [43516766, "815dc606f3b3e3404199fac80abb46b9249948828178a5cbf6aedb3d9e6809de"],
    arm64Split: [56968881, "7faf449bae431dcfeda4f882ecb04290af66cc4ccfeefc620e24cac70d22fcec"],
    libil2cpp: [128218264, "3e78eedc62770fff4cb129b4b8d898950e131b710b3c099237fe20d2d34ca48e"],
    metadataEncrypted: [31429300, "b691dbdd2f9b35dc0dd6d3eb9cb54782c1013bc5b24fe2a6ed1c87db64ecada2"],
    metadataPlaintext: [31429296, "bf58e06a98f9e9e05a1635f512ea432d33971bfc8280ba26df1c93e94b4f3cb9"],
    unityDefaultResources: [1121184, "a9a74ab363888de3ea14ef01e780f851a395d4c6f5d5bcebad74a2a3e4785d16"],
  },
  tables: {
    methods: [6946348, 9377532, 36, 260487, "0c03d871175feb89c909671567b31bb25f2096e0060149ddec9e6241f54ba7ba"],
    fieldDefaults: [16391908, 347424, 12, 28952, "3ea442009a82dc97023239cd865d5ff7da7acf1d79f6b7c09603410e908a19b7"],
    defaultData: [16739336, 1093992, null, null, "503897e73ee809957157ef95d5324c7ba4d314d9b6a37d2f2bfd545f25508f2c"],
    fields: [20437640, 1989672, 12, 165806, "d2c07ede284b2fb1abdc0f5a8810327b27c5ff8d60bfdbe61e9cbb0144913fdd"],
    types: [24697284, 3793680, 88, 43110, "9f6f45662d5ee06fe73a2fcfed8e317aa8c3076f3bac9ee03c05d1be47d9aaf3"],
  },
  methods: {
    modelCardViewInitializeMoveNext: ["0x44315fc", "0x4432678", 4220, "48d6f86b4e0be15346effd54cbfe7cae028429fa201b9fd174c2825fd8b38e08"],
    cardPathsGetPrerenderCardMaterial: ["0x444bb48", "0x444bc10", 200, "4e0226c8300d0365fdbd064f8d92df448153802eb9396f7aa3ffe730fcf8bb28"],
    cardPathsGetPrerenderHomographyCardMaterial: ["0x444bc10", "0x444bcd8", 200, "29e7c7bc104f760593b3e0c82ffa6f52170900ba5dceb81be36b4d52cd21d443"],
    cardPathsImplPrerenderCardMaterial: ["0x4452260", "0x44522d0", 112, "c31ee30ba88281cf76fc71a37e3ef09767facd6483c51287c299c33619cca566"],
    cardPathsImplPrerenderHomographyCardMaterial: ["0x44522d0", "0x4452340", 112, "c254b0a8470a179aa0895bf12663a9aadf16bf265c0205006c1232f36d9e81d6"],
    dynamicUIApply: ["0x442c834", "0x442c968", 308, "fefd617def47b21a7e63dd34311efce0ce32fabefdf38da60c3c68ef283dfb19"],
    dynamicUITrySetTexture: ["0x442c968", "0x442ca8c", 292, "3f4fb88fbf5def2b117d6fe41312cfba464add3a5b4816f1e52150e76fb86b31"],
    dynamicShaderPropertyGetPropertyId: ["0x44511cc", "0x445131c", 336, "da860e2181967833061a2c9ab9bfa11b032857297fd637c87607282b07b95231"],
    dynamicShaderPropertyCctor: ["0x445131c", "0x445148c", 368, "c9092ca8a162ea52cb217cecb2d4b13430889af48266e99e8d2274f04e8f8a9a"],
    shaderPropertyToID: ["0x64ebcbc", "0x64ebcf8", 60, "245af4813e403884f66bf8510e2d4bdcd6c73a103c1391e8894d7f0d4a0a36c0"],
    rendererSetMaterial: ["0x64ec9ec", "0x64eca30", 68, "d638bbb057cf2f6f3c6d060d001cf4ef2d9a1d18ae7fd6c406c0074576be2318"],
    materialCopyConstructor: ["0x64f1f28", "0x64f1fb8", 144, "0237f0bc041761da955d061d4ae85404b68e921666af361203a7e369799b4d42"],
  },
  types: {
    initializeState: [29402, 104218, 87973, "d75dd1263da450541e73a720788c9f5c1721bfd9248b6f6c362c256be135011f"],
    modelCardView: [29408, 74193, 74217, "d3f3cf3d32325fb94af65e7f13f571a0c457649f7e6d2a79d3204e6b74008d96"],
    cardRenderer: [29470, 56689, 51832, "08a14f5f6f42c927cd5e3221ac81e11272f34e5e5e8a6e23d0a5a933b36a259c"],
    asset3DRenderer: [39701, 51832, 75565, "2e5e146e73e7aaacc6e7a1a975627db37834f17c3c39ec01f1770108015eb0e2"],
    dynamicUI: [29388, 62025, 74217, "15a14d65a13d5fa846f3d1373a4d43e2dc74227987785d53f3ff9f80042bc9ff"],
    dynamicShaderPropertyType: [29572, 62018, 62411, "ce76e0d71bc908a3d18d1e9570cd9af5aa7a2ad9add285e7b26f923d5aa53ab1"],
    dynamicShaderPropertyExtensions: [29573, 62021, 75565, "3f4aa38e294dbfdb2249bec100cfc8cacbd3b6f255c8d640a0bbed1894d5735c"],
    cardPaths: [29520, 56672, 75565, "ca779bf5f4759dc059788f24995de64149483f4184ba72ca622e14337ab52415"],
    cardPathsImpl: [39900, 56673, 75565, "2cdef14811486c822833641f3a653987178cec33cc70a5dae102b8ee3f04542d"],
  },
  bundles: {
    detailViewPrefab: [3438, "7116a8a703bad8d9af3af5be728cef21dcd8b51d90dd07ed27a726a216cdae6b"],
    prefab: [3132, "7177acd883ce90dc4df4375fad6c517ff5a12707b18d3419e3b2a742864ecd2c"],
    plainMaterial: [2552, "b7db9d30f20a9db441d493e92b969f9b30203eb3a159a76a9ecc4001bddbf451"],
    homographyMaterial: [2733, "bae81007d07cbf680c94ac1827b8855adf03a6ddf92db0b7e8c07fb7da8c3d61"],
    homographyShader: [18500, "00b8e07fdd4ff114513ed732abd5eae6489b1b744abf95eba5bd801544073f3a"],
  },
  objects: {
    detailViewAssetBundle: ["1", 628, "a9d2917fa8329f921a44a9b8f64ccc20d1a63f2944603221b51696cdd3975b1f"],
    detailViewModelCardView: ["-388964018856864275", 44, "610e73e39db705de868430b72ee8c74b3b29b9c5ed2e96e2eeb16ad1b353b97b"],
    prefabAssetBundle: ["1", 452, "3e6dd7ce7f199cda4c06d551c596a126c25c9ca73b59e7935e64d7e96248e4a4"],
    prefabGameObject: ["-4629609825712094815", 79, "3b636dbfce329f439b3e87d8e3a839f9fb394652a19409f3fffb5dd7853938e8"],
    dynamicUI: ["1522306667023810977", 52, "0b9c5605095dc68fe10b1eed5d39181832aa9693dccdc8956c8bac420ae7fe62"],
    renderer: ["3265241027643294113", 156, "33f37947204fd8740cb39120587aded20068b5529e2421dd79261525db8e7a47"],
    meshFilter: ["7137436611473097121", 24, "6d0a6d2c017aef9c7d9d510efea770a5ab4969b075f3650c3c71a4ca5eafe84b"],
    builtinQuad: ["10210", 608, "a011b7668060df09340e550322f72f1ea635e5c8461ea3fbfb2a6f4071fff82a"],
    plainAssetBundle: ["1", 340, "edfc16787ead4a17dfdd2eaa960c5af9c6bb5f57bbdd2129565f8f20f5c2bc3a"],
    plainMaterial: ["1578788169772424559", 652, "c8a8582a315f8968ef83bb19d7f533f83cbb64c189f5bc1791df88f6e1059ae5"],
    homographyAssetBundle: ["1", 364, "fb3f80ad6c5681c1542919b647e3cadf6a0e121160db563cc1cbd41220b8c928"],
    homographyMaterial: ["-332705428253792402", 864, "0178ec97db1f9ef89958a2f77ef190815cdcaa06b386e94c727b2f5427a03a37"],
    shaderAssetBundle: ["1", 336, "076803584baff5ddf73de12b61f235572608bc10aa3a643ba18b41d3f49d4a44"],
    homographyShader: ["-230642161556405053", 4724, "0a8c0df5d762ff75550f7155e98a2307ceab5c55bab119d794f4506b223196b1"],
  },
};


function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function verifyRaw(record) {
  const bytes = Buffer.from(record.rawHex, "hex");
  assert.equal(bytes.length, record.byteSize);
  assert.equal(sha256(bytes), record.sha256);
  return bytes;
}

function compact(record) {
  return [record.byteSize, record.sha256];
}

function compactObject(record) {
  return [record.pathId, record.byteSize, record.sha256];
}

function selected(method, address) {
  const row = method.selectedInstructions.find((item) => item.address === address);
  assert.ok(row, `${method.name} ${address} selected instruction is missing`);
  assert.equal(sha256(Buffer.from(row.bytesHex, "hex")), row.sha256);
  return row.text;
}

function runExtractor() {
  const args = ["build/extract_official-homography-wiring.py"];
  if (process.env.PCR_APKM) args.push("--apkm", process.env.PCR_APKM);
  if (process.env.PCR_DECRYPTED_ROOT) {
    args.push("--decrypted-root", process.env.PCR_DECRYPTED_ROOT);
  }
  const result = spawnSync(PYTHON, args, {
    cwd: ROOT,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    throw new Error(
      (result.stderr || result.stdout || result.error?.message || "Homography wiring extractor failed").trim(),
    );
  }
  return JSON.parse(result.stdout.replace(/^\uFEFF/, ""));
}


const evidence = runExtractor();

assert.equal(evidence.schemaVersion, 1);
assert.equal(evidence.status, "proved-with-native-y-explicitly-unproved");
assert.deepEqual(evidence.evidencePolicy, {
  officialOnly: true,
  readInputs: [
    "official 1.6.0 APKM base.apk and arm64 split bytes",
    "official decrypted Unity bundles and serialized objects",
  ],
  excludedInputs: [
    "Il2CppDumper output",
    "scene.json and recipes",
    "browser runtime and generated reports",
    "screenshots",
  ],
  rvaPolicy: "package-matched RVAs are locators; method bytes, metadata, literals, icalls, serialized objects, and PPtrs are read from official inputs at extraction time",
});

assert.deepEqual(compact(evidence.source.apkm), EXPECTED.source.apkm);
assert.deepEqual(compact(evidence.source.baseApk), EXPECTED.source.baseApk);
assert.deepEqual(compact(evidence.source.arm64Split), EXPECTED.source.arm64Split);
assert.deepEqual(compact(evidence.source.libil2cpp), EXPECTED.source.libil2cpp);
assert.deepEqual(
  [evidence.source.metadata.encryptedByteSize, evidence.source.metadata.encryptedSha256],
  EXPECTED.source.metadataEncrypted,
);
assert.deepEqual(
  [evidence.source.metadata.plaintextByteSize, evidence.source.metadata.plaintextSha256],
  EXPECTED.source.metadataPlaintext,
);
assert.equal(evidence.source.metadata.magic, "0xfab11baf");
assert.equal(evidence.source.metadata.version, 31);
assert.equal(evidence.metadata.version, 31);

assert.equal(evidence.builtinResources.path, "assets/bin/Data/unity default resources");
assert.deepEqual(compact(evidence.builtinResources.source), EXPECTED.source.unityDefaultResources);
const builtinQuad = evidence.builtinResources.quad;
assert.deepEqual(compactObject(builtinQuad.object), EXPECTED.objects.builtinQuad);
verifyRaw(builtinQuad.object);
assert.deepEqual(
  [builtinQuad.name, builtinQuad.pathId, builtinQuad.vertexCount, builtinQuad.vertexStride],
  ["Quad", "10210", 4, 48],
);
assert.deepEqual(builtinQuad.positionChannel, {
  index: 0, stream: 0, offset: 0, format: 0, dimension: 3,
});
assert.deepEqual(builtinQuad.uv0Channel, {
  index: 4, stream: 0, offset: 40, format: 0, dimension: 2,
});
assert.deepEqual(compact(builtinQuad.vertexData), [
  192, "08be4edecc1d612e615cdaafc4460eaabd1fefa3d5681e44c266832c403be841",
]);
verifyRaw(builtinQuad.vertexData);
assert.deepEqual(builtinQuad.vertices.map(({ position, uv0 }) => [position.slice(0, 2), uv0]), [
  [[-0.5, -0.5], [0, 0]],
  [[0.5, -0.5], [1, 0]],
  [[-0.5, 0.5], [0, 1]],
  [[0.5, 0.5], [1, 1]],
]);
assert.deepEqual(compact(builtinQuad.indexData), [
  12, "87a2848d2d137388dae050ee16920af5b5808427aa09d0f85b52075bffa3879e",
]);
verifyRaw(builtinQuad.indexData);
assert.deepEqual([builtinQuad.indexFormat, builtinQuad.indices], [0, [0, 3, 1, 3, 0, 2]]);

for (const [key, expected] of Object.entries(EXPECTED.tables)) {
  const table = evidence.metadata.tables[key];
  assert.deepEqual(
    [table.offset, table.byteSize, table.recordSize, table.count, table.sha256],
    expected,
    `${key} metadata table drifted`,
  );
}

for (const [key, expected] of Object.entries(EXPECTED.methods)) {
  const method = evidence.native.methods[key];
  assert.ok(method, `${key} method is missing`);
  assert.deepEqual(
    [method.rvaStart, method.rvaEndExclusive, method.byteSize, method.sha256],
    expected,
    `${key} method bytes drifted`,
  );
  verifyRaw(method);
  for (const instruction of method.selectedInstructions) {
    assert.equal(sha256(Buffer.from(instruction.bytesHex, "hex")), instruction.sha256);
  }
}

const init = evidence.native.methods.modelCardViewInitializeMoveNext;
assert.deepEqual([
  selected(init, "0x44316f8"),
  selected(init, "0x4431ba8"),
  selected(init, "0x4431bac"),
  selected(init, "0x4431bb4"),
  selected(init, "0x4431bc0"),
], [
  "ldr x20, [x19, #0x18]",
  "ldrb w8, [x20, #0x28]",
  "cbz w8, #0x4431bbc",
  "bl #0x444bc10",
  "bl #0x444bb48",
]);
assert.deepEqual([
  selected(init, "0x4431b3c"),
  selected(init, "0x4431b40"),
  selected(init, "0x4431c7c"),
  selected(init, "0x4431c84"),
  selected(init, "0x4431c8c"),
  selected(init, "0x4431ea8"),
  selected(init, "0x4431f04"),
  selected(init, "0x4431f1c"),
  selected(init, "0x4431f24"),
  selected(init, "0x4431f28"),
  selected(init, "0x4431f2c"),
  selected(init, "0x4431f30"),
  selected(init, "0x443216c"),
  selected(init, "0x4432178"),
], [
  "mov x21, x20",
  "ldr x22, [x21, #0xa8]!",
  "mov x1, x22",
  "blr x8",
  "str x1, [x21]",
  "ldr x21, [x20, #0xa8]",
  "blr x8",
  "mov x1, x22",
  "mov x21, x0",
  "bl #0x64f1f28",
  "mov x22, x20",
  "str x21, [x22, #0x58]!",
  "ldr x1, [x22]",
  "bl #0x64ec9ec",
]);
assert.deepEqual([
  selected(init, "0x4431f48"),
  selected(init, "0x4431f50"),
  selected(init, "0x4431fbc"),
  selected(init, "0x4431fc0"),
  selected(init, "0x443219c"),
  selected(init, "0x44321a0"),
  selected(init, "0x44321ac"),
  selected(init, "0x44321b4"),
  selected(init, "0x44321bc"),
  selected(init, "0x44321c0"),
], [
  "mov x21, x20",
  "ldr x0, [x21, #0x38]!",
  "bl #0x443d96c",
  "str x24, [x21]",
  "mov x22, x20",
  "str x1, [x22, #0x30]!",
  "ldr x8, [x21]",
  "ldr x0, [x22]",
  "ldr x1, [x8, #0x40]",
  "bl #0x442c834",
]);

assert.deepEqual(
  evidence.native.methods.cardPathsGetPrerenderCardMaterial.selectedInstructions.map((item) => item.text),
  ["ldr x19, [x8]", "mov w2, #7", "ldp x2, x1, [x0]", "br x2"],
);
assert.deepEqual(
  evidence.native.methods.cardPathsGetPrerenderHomographyCardMaterial.selectedInstructions.map((item) => item.text),
  ["ldr x19, [x8]", "mov w2, #8", "ldp x2, x1, [x0]", "br x2"],
);
assert.deepEqual(
  evidence.native.methods.cardPathsImplPrerenderCardMaterial.selectedInstructions.map((item) => item.text),
  ["ldr x8, [x0, #0xb8]", "ldr x8, [x8, #0x10]", "ldr x0, [x8, #0x10]", "mov x0, x1"],
);
assert.deepEqual(
  evidence.native.methods.cardPathsImplPrerenderHomographyCardMaterial.selectedInstructions.map((item) => item.text),
  ["ldr x8, [x0, #0xb8]", "ldr x8, [x8, #0x18]", "ldr x0, [x8, #0x10]", "mov x0, x1"],
);

const apply = evidence.native.methods.dynamicUIApply;
assert.deepEqual([
  selected(apply, "0x442c88c"),
  selected(apply, "0x442c8c4"),
  selected(apply, "0x442c8f8"),
  selected(apply, "0x442c900"),
  selected(apply, "0x442c908"),
  selected(apply, "0x442c914"),
  selected(apply, "0x442c930"),
  selected(apply, "0x442c934"),
  selected(apply, "0x442c938"),
  selected(apply, "0x442c93c"),
  selected(apply, "0x442c940"),
  selected(apply, "0x442c94c"),
  selected(apply, "0x442c960"),
], [
  "ldr x21, [x19, #0x20]",
  "ldr x8, [x21, #0x30]!",
  "ldr x0, [x19, #0x20]",
  "ldr x1, [x19, #0x30]",
  "bl #0x64ec5a8",
  "ldr w22, [x19, #0x28]",
  "bl #0x44511cc",
  "mov w1, w0",
  "mov x0, x19",
  "mov x2, x20",
  "bl #0x442c968",
  "ldr x1, [x21]",
  "b #0x64ec510",
]);

const trySet = evidence.native.methods.dynamicUITrySetTexture;
assert.deepEqual([
  selected(trySet, "0x442c978"),
  selected(trySet, "0x442c97c"),
  selected(trySet, "0x442c9a0"),
  selected(trySet, "0x442c9b4"),
  selected(trySet, "0x442c9f8"),
  selected(trySet, "0x442ca00"),
  selected(trySet, "0x442ca08"),
  selected(trySet, "0x442ca64"),
  selected(trySet, "0x442ca6c"),
  selected(trySet, "0x442ca70"),
  selected(trySet, "0x442ca84"),
], [
  "mov x21, x2",
  "mov w19, w1",
  "ldr x0, [x20, #0x20]",
  "bl #0x64eca30",
  "mov w1, w19",
  "bl #0x64f2ba8",
  "cbnz x21, #0x442ca30",
  "ldr x0, [x20, #0x30]",
  "mov w1, w19",
  "mov x2, x21",
  "b #0x64ebee8",
]);

assert.deepEqual(evidence.native.propertyJumpTable, {
  rva: "0x1c492e8",
  byteSize: 6,
  sha256: "8f0ced26a1d235e1aa1ba16d668639a396f9975fce8eaefa9252fc70be21faa2",
  rawHex: "000b151f2933",
  enumValues: [0, 1, 2, 3, 4, 5],
  caseRvas: ["0x445121c", "0x4451248", "0x4451270", "0x4451298", "0x44512c0", "0x44512e8"],
});
verifyRaw(evidence.native.propertyJumpTable);

assert.deepEqual([
  selected(evidence.native.methods.dynamicShaderPropertyGetPropertyId, "0x44511f8"),
  selected(evidence.native.methods.dynamicShaderPropertyGetPropertyId, "0x445120c"),
  selected(evidence.native.methods.dynamicShaderPropertyGetPropertyId, "0x4451210"),
  selected(evidence.native.methods.dynamicShaderPropertyGetPropertyId, "0x4451218"),
  selected(evidence.native.methods.dynamicShaderPropertyGetPropertyId, "0x4451238"),
  selected(evidence.native.methods.dynamicShaderPropertyGetPropertyId, "0x445130c"),
], [
  "cmp w19, #5",
  "adr x10, #0x445121c",
  "ldrb w11, [x9, x8]",
  "br x10",
  "ldr x8, [x0, #0xb8]",
  "ldr w0, [x8]",
]);
assert.deepEqual([
  selected(evidence.native.methods.dynamicShaderPropertyCctor, "0x4451350"),
  selected(evidence.native.methods.dynamicShaderPropertyCctor, "0x44513d0"),
  selected(evidence.native.methods.dynamicShaderPropertyCctor, "0x44513d8"),
  selected(evidence.native.methods.dynamicShaderPropertyCctor, "0x44513e4"),
  selected(evidence.native.methods.dynamicShaderPropertyCctor, "0x44513ec"),
], [
  "ldr x26, [x26, #0xc80]",
  "ldr x0, [x26]",
  "bl #0x64ebcbc",
  "ldr x9, [x8, #0xb8]",
  "str w0, [x9]",
]);

const expectedLiterals = {
  dynamicUI: ["_DynamicUITex", "f1215d3d579bb57c1d99915f1413d7b097ff92ddefa9506aac1da0336044a34e", "b4d2f8f1efc8c4b243f31662abcb091278a9d94375b7fa0fde7541283b194b73"],
  additionalDynamicUI: ["_AdditionalDynamicUITex", "7dd11f448efd10e35afd630c3e3a65f30f02a4e94497e4e31df5c5e40274aba7", "5911adeb5a1b0cd44d5b0451a3cf6f0c65e3599e2eabaddded32c1b0940337a1"],
  decoration: ["_DecorationTex", "d1adc0bd75630c9369482a9dff3a089b74f161e9373c460a941871c6a761719b", "49fa0e517333bf4a9d196149b659fe000daa3d2c37fdf360ebfe7e7ef280ff87"],
  rental: ["_RentalTex", "93bbdcde9c7bed44497ff2d7af476713df7b69a922838c1d8ff222a66956cc93", "a653afcdc70caf90da8fc299e091aa253cb34d1826c26e72f2021b52876580b4"],
  additionalFrame: ["_AdditionalFrameTex", "6197ebb352e447c49d2591ad5c4eac71b72d65ac55381bc99cba70fa64215738", "8ad687902d486adbbabdd174992e90de51ba89bb7bca1726e4c0d39bc290c5cd"],
  additionalFrameTrainersHeader: ["_AdditionalFrameTrainersHeaderTex", "6282c9012031a60057612bd5b7e11e46c1c4bb5376a45c7066770ede9d1b6198", "130785a9909e31c30e7fe905c030e83ce3966df0ed15434bc3138164d51ea770"],
};
for (const [key, [value, relocationHash, literalHash]] of Object.entries(expectedLiterals)) {
  const literal = evidence.native.propertyLiterals[key];
  assert.equal(literal.value, value);
  assert.equal(literal.relocation.sha256, relocationHash);
  assert.equal(sha256(Buffer.from(literal.relocation.bytesHex, "hex")), relocationHash);
  assert.equal(literal.metadataLiteral.utf8Sha256, literalHash);
  assert.equal(sha256(Buffer.from(literal.metadataLiteral.utf8BytesHex, "hex")), literalHash);
  assert.equal(Buffer.from(literal.metadataLiteral.utf8BytesHex, "hex").toString("utf8"), value);
}

assert.deepEqual(
  Object.fromEntries(Object.entries(evidence.native.nativeStrings).map(([key, row]) => [
    key, [row.rva, row.value, row.byteSize, row.sha256],
  ])),
  {
    shaderPropertyToID: ["0x1ae240f", "UnityEngine.Shader::PropertyToID(System.String)", 47, "690444d8ca9f9e051b36e686df40c8e404b6ec9047c6f5f0f9f00b57c1ad0f97"],
    rendererSetMaterial: ["0x1aacd34", "UnityEngine.Renderer::SetMaterial(UnityEngine.Material)", 55, "6866525d13ba7b5518b97a1f8f1eb316a49b69fa5ac2a8fbe2ea1e9226ce7ec5"],
    materialCreateWithMaterial: ["0x1ac1fb9", "UnityEngine.Material::CreateWithMaterial(UnityEngine.Material,UnityEngine.Material)", 83, "f1a52b0c19740962fbec097f1254ee2702d11df3d1246b4cea5a3cf775bea79e"],
  },
);
for (const row of Object.values(evidence.native.nativeStrings)) verifyRaw(row);

for (const [key, expected] of Object.entries(EXPECTED.types)) {
  const type = evidence.metadata.types[key];
  assert.deepEqual(
    [type.typeDefinitionIndex, type.byvalTypeIndex, type.parentTypeIndex, type.record.sha256],
    expected,
    `${key} metadata type drifted`,
  );
  verifyRaw(type.record);
  for (const field of Object.values(type.selectedFields)) verifyRaw(field.record);
  for (const method of Object.values(type.selectedMethods)) verifyRaw(method.record);
}
assert.equal(
  evidence.metadata.types.cardRenderer.parentTypeIndex,
  evidence.metadata.types.asset3DRenderer.byvalTypeIndex,
  "CardRenderer no longer inherits Asset3DRenderer",
);
assert.deepEqual(
  Object.fromEntries(Object.entries(evidence.metadata.types.modelCardView.selectedFields).map(([key, row]) => [key, row.name])),
  {
    clampParallax: "_clampParallax",
    renderedUI: "<RenderedUI>k__BackingField",
    cardRenderer: "<CardRenderer>k__BackingField",
    material: "_material",
    materialHandle: "_materialHandle",
  },
);
assert.deepEqual(
  Object.fromEntries(Object.entries(evidence.metadata.types.dynamicUI.selectedFields).map(([key, row]) => [key, row.name])),
  {
    renderer: "_renderer",
    dynamicPropertyType: "_dynamicPropertyType",
    dynamicUIType: "_dynamicUIType",
    propertyBlock: "_propertyBlock",
    material: "_material",
  },
);
assert.deepEqual(
  evidence.metadata.types.dynamicUI.selectedMethods.apply,
  {
    methodDefinitionIndex: 197636,
    name: "Apply",
    token: "0x0600019d",
    slot: 65535,
    parameterCount: 1,
    recordFileOffset: 14061244,
    record: evidence.metadata.types.dynamicUI.selectedMethods.apply.record,
  },
);
assert.deepEqual(
  evidence.metadata.types.dynamicUI.selectedMethods.trySetTexture,
  {
    methodDefinitionIndex: 197640,
    name: "TrySetTexture",
    token: "0x060001a1",
    slot: 65535,
    parameterCount: 2,
    recordFileOffset: 14061388,
    record: evidence.metadata.types.dynamicUI.selectedMethods.trySetTexture.record,
  },
);

const enumDefault = evidence.metadata.dynamicShaderPropertyTypeDynamicUI;
assert.equal(enumDefault.field.name, "DynamicUI");
assert.equal(enumDefault.field.fieldDefinitionIndex, 116318);
assert.deepEqual(enumDefault.default, {
  fieldDefaultIndex: 23936,
  fieldDefinitionIndex: 116318,
  typeIndex: 69951,
  dataIndex: 1014131,
  recordFileOffset: 16679140,
  record: {
    byteSize: 12,
    sha256: "b06ee06826ea6d70ac704a9ba35c9af6e6c841e93d3ba076aebfc98589342744",
    rawHex: "5ec601003f11010073790f00",
  },
  value: 0,
  encodedValueFileOffset: 17753467,
  encodedValue: {
    byteSize: 1,
    sha256: "6e340b9cffb37a989ca544e6bb780a2c78901d3fb33738768511a30617afa01d",
    rawHex: "00",
  },
});
verifyRaw(enumDefault.default.record);
verifyRaw(enumDefault.default.encodedValue);

assert.deepEqual(evidence.native.fieldOffsets, {
  "ModelCardView._clampParallax": "0x28",
  "ModelCardView.<RenderedUI>k__BackingField": "0x30",
  "ModelCardView.<CardRenderer>k__BackingField": "0x38",
  "ModelCardView._material": "0x58",
  "ModelCardView._materialHandle": "0xa8",
  "Asset3DRenderer._renderTexture": "0x40",
  "DynamicUI._renderer": "0x20",
  "DynamicUI._dynamicPropertyType": "0x28",
  "DynamicUI._propertyBlock": "0x30",
});

const serialized = evidence.serialized;
assert.deepEqual(compact(serialized.detailViewPrefab.bundle), EXPECTED.bundles.detailViewPrefab);
assert.deepEqual(compact(serialized.prefab.bundle), EXPECTED.bundles.prefab);
assert.deepEqual(compact(serialized.plainMaterial.bundle), EXPECTED.bundles.plainMaterial);
assert.deepEqual(compact(serialized.homographyMaterial.bundle), EXPECTED.bundles.homographyMaterial);
assert.deepEqual(compact(serialized.homographyShader.bundle), EXPECTED.bundles.homographyShader);

const objectChecks = [
  [serialized.detailViewPrefab.assetBundle.object, EXPECTED.objects.detailViewAssetBundle],
  [serialized.detailViewPrefab.modelCardView.object, EXPECTED.objects.detailViewModelCardView],
  [serialized.prefab.assetBundle.object, EXPECTED.objects.prefabAssetBundle],
  [serialized.prefab.gameObject.object, EXPECTED.objects.prefabGameObject],
  [serialized.prefab.dynamicUI.object, EXPECTED.objects.dynamicUI],
  [serialized.prefab.renderer.object, EXPECTED.objects.renderer],
  [serialized.prefab.meshFilter.object, EXPECTED.objects.meshFilter],
  [serialized.plainMaterial.assetBundle.object, EXPECTED.objects.plainAssetBundle],
  [serialized.plainMaterial.materialObject, EXPECTED.objects.plainMaterial],
  [serialized.homographyMaterial.assetBundle.object, EXPECTED.objects.homographyAssetBundle],
  [serialized.homographyMaterial.materialObject, EXPECTED.objects.homographyMaterial],
  [serialized.homographyShader.assetBundle.object, EXPECTED.objects.shaderAssetBundle],
  [serialized.homographyShader.shaderObject, EXPECTED.objects.homographyShader],
];
for (const [record, expected] of objectChecks) {
  assert.deepEqual(compactObject(record), expected);
  verifyRaw(record);
}
assert.equal(
  serialized.detailViewPrefab.relativePath,
  "Common/CardNew/System/Prefabs/L_Card_Base_Pokemon_RS.prefab_bundles",
);
assert.equal(serialized.detailViewPrefab.serializedFile, "CAB-8982309ee7832aef5e146ed039e479a2");
assert.deepEqual(serialized.detailViewPrefab.assetBundle.containers, [{
  name: "Assets/Lettuce/_Data/Common/CardNew/System/Prefabs/L_Card_Base_Pokemon_RS.prefab",
  preloadIndex: 0,
  preloadSize: 14,
  asset: { fileId: 0, pathId: "1343512140776461805" },
}]);
assert.deepEqual(
  Object.fromEntries(["cardSize", "clampParallax", "alwaysDetailEffect"].map((key) => {
    const field = serialized.detailViewPrefab.modelCardView[key];
    verifyRaw(field);
    return [key, [field.name, field.value, field.objectOffset, field.rawHex]];
  })),
  {
    cardSize: ["_cardSize", 3, 32, "03000000"],
    clampParallax: ["_clampParallax", 1, 36, "01000000"],
    alwaysDetailEffect: ["_alwaysDetailEffect", 0, 40, "00000000"],
  },
);

assert.equal(serialized.prefab.serializedFile, "CAB-f6148360c6cc566763c5f24e727f931b");
assert.deepEqual(serialized.prefab.meshFilter.meshPPtr, { fileId: 3, pathId: "10210" });
assert.deepEqual(serialized.prefab.meshFilter.meshExternal, {
  path: "Library/unity default resources",
  name: "unity default resources",
  guid: "00000000000000000e00000000000000",
  type: 0,
});
assert.deepEqual(serialized.prefab.assetBundle.containers, [{
  name: "Assets/Lettuce/_Data/Common/CardNew/System/Prefabs/PrerenderCard.prefab",
  preloadIndex: 0,
  preloadSize: 8,
  asset: { fileId: 0, pathId: "-4629609825712094815" },
}]);
assert.equal(serialized.prefab.gameObject.name, "PrerenderCard");
assert.deepEqual(serialized.prefab.dynamicUI.scriptPPtr, {
  fileId: 1,
  pathId: "-3995382214229620620",
});
assert.deepEqual(serialized.prefab.dynamicUI.rendererPPtr, {
  fileId: 0,
  pathId: "3265241027643294113",
  objectOffset: 32,
  byteSize: 12,
  sha256: "aeccd937353f65a8ce7e53ae88a30eec2026f500ae9941563be35b05417cbbb4",
  rawHex: "00000000a1c1b5266a77502d",
});
assert.deepEqual(serialized.prefab.dynamicUI.dynamicPropertyType, {
  name: "_dynamicPropertyType",
  value: 0,
  objectOffset: 44,
  byteSize: 4,
  sha256: "df3f619804a92fdb4057192dc43dd748ea778adc52bc498ce80524c014b81119",
  rawHex: "00000000",
});
assert.deepEqual(serialized.prefab.dynamicUI.dynamicUIType, {
  name: "_dynamicUIType",
  value: 0,
  objectOffset: 48,
  byteSize: 4,
  sha256: "df3f619804a92fdb4057192dc43dd748ea778adc52bc498ce80524c014b81119",
  rawHex: "00000000",
});
verifyRaw(serialized.prefab.dynamicUI.rendererPPtr);
verifyRaw(serialized.prefab.dynamicUI.dynamicPropertyType);
verifyRaw(serialized.prefab.dynamicUI.dynamicUIType);

assert.deepEqual(serialized.prefab.renderer.initialMaterialPPtr, {
  fileId: 2,
  pathId: "1578788169772424559",
  objectOffset: 72,
  byteSize: 12,
  sha256: "473ebf692af7c2c39078e7dd217e712a205f1975f5f4362a68422234645a87c2",
  rawHex: "020000006fdddfc279fbe815",
});
verifyRaw(serialized.prefab.renderer.initialMaterialPPtr);
assert.equal(
  serialized.prefab.renderer.initialMaterialExternal.name,
  "CAB-1fb783786b470d6c6402788dc9947859",
);

assert.equal(serialized.plainMaterial.name, "PrerenderCard");
assert.equal(serialized.plainMaterial.serializedFile, "CAB-1fb783786b470d6c6402788dc9947859");
assert.deepEqual(serialized.plainMaterial.assetBundle.containers, [{
  name: "Assets/Lettuce/_Data/Common/CardNew/System/Materials/PrerenderCard.mat",
  preloadIndex: 0,
  preloadSize: 2,
  asset: { fileId: 0, pathId: "1578788169772424559" },
}]);
assert.deepEqual(serialized.plainMaterial.dynamicUITexture, {
  texture: { fileId: 0, pathId: "0" },
  scale: [1, 1],
  offset: [0, 0],
});

assert.equal(serialized.homographyMaterial.name, "PrerenderHomographyCard");
assert.equal(serialized.homographyMaterial.serializedFile, "CAB-43815086a58b85896718b16a4ea6cb2c");
assert.deepEqual(serialized.homographyMaterial.assetBundle.containers, [{
  name: "Assets/Lettuce/_Data/Common/CardNew/System/Materials/PrerenderHomographyCard.mat",
  preloadIndex: 0,
  preloadSize: 2,
  asset: { fileId: 0, pathId: "-332705428253792402" },
}]);
assert.deepEqual(serialized.homographyMaterial.shaderPPtr, {
  fileId: 1,
  pathId: "-230642161556405053",
});
assert.equal(
  serialized.homographyMaterial.shaderExternal.name,
  "CAB-97b4be56dcc4d094ca2d7026a1259cfe",
);
assert.deepEqual(serialized.homographyMaterial.dynamicUITexture, {
  texture: { fileId: 0, pathId: "0" },
  scale: [1, 1],
  offset: [0, 0],
});
assert.equal(serialized.homographyShader.serializedFile, "CAB-97b4be56dcc4d094ca2d7026a1259cfe");
assert.equal(serialized.homographyShader.shaderObject.pathId, "-230642161556405053");
assert.equal(
  serialized.homographyShader.name,
  "Lettuce/Common/CardNew/Prerender/Homography(from RT)",
);

assert.deepEqual(evidence.notEstablished, [{
  id: "native-render-texture-physical-y",
  status: "unproved",
  claim: "native RenderTexture physical Y origin/orientation",
}]);
assert.ok(
  evidence.derived.runtimeWiring.includes(
    "the same _renderTexture pointer is passed to DynamicUI.Apply at RVA 0x44321c0",
  ),
);
assert.ok(
  evidence.derived.runtimeWiring.includes(
    "DynamicShaderPropertyType.DynamicUI is serialized metadata enum value 0, jump-table case 0, and the case-0 static property ID is initialized from Shader.PropertyToID(\"_DynamicUITex\")",
  ),
);

console.log("Official Homography runtime wiring audit OK");
console.log("Initialize: clamp branch, material load/clone/set, CardRenderer+0x38, and inherited RT+0x40 are pinned");
console.log("DynamicUI: Apply/TrySetTexture, enum 0 -> _DynamicUITex property ID, and property-block upload are pinned");
console.log("Serialized: PrerenderCard defaults plus PrerenderHomographyCard Material/Shader PPtrs are pinned");
console.log("Boundary: native RenderTexture physical Y remains explicitly unproved");
