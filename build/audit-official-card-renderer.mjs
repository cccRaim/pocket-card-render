// Pin the official 1.6.0 card-renderer facts to package/object/code bytes.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PYTHON = process.env.PYTHON || "python";

const EXPECTED = {
  source: {
    apkm: [285917033, "9b7f9067e00a54f342bd4f17e669ceeb86b80bb7d34ff2d0d0fe82050a62f201"],
    baseApk: [43516766, "815dc606f3b3e3404199fac80abb46b9249948828178a5cbf6aedb3d9e6809de"],
    arm64Split: [56968881, "7faf449bae431dcfeda4f882ecb04290af66cc4ccfeefc620e24cac70d22fcec"],
    libil2cpp: [128218264, "3e78eedc62770fff4cb129b4b8d898950e131b710b3c099237fe20d2d34ca48e"],
    globalgamemanagers: [880940, "5a1ca51ec16b267710479b85e33bfe150c4aab255e9716fd33d51ce7a33ea017"],
  },
  methods: {
    pixelSize: ["0x438d7fc", "0x438d8d0", 212, "c44a5882f9c89d9312a1c2e4bb71410d1464de865f5525814a683b6e6907ec63"],
    cardDimensionCctor: ["0x438d8d0", "0x438da6c", 412, "601a2e3697b44c50d76e5414b121a4b72f5e03b85509e51118459c6a0d3b4c03"],
    uiCardViewCreateRenderer: ["0x443d880", "0x443d96c", 236, "6bfe5bd0cc20a873e19f87dc7f3ebd6c80a58b735b17f9f91de4fab8ffee8d38"],
    cardRendererCtor: ["0x443d96c", "0x443da4c", 224, "f21dc5d97436d8d46e8521149984e5b7f2c4a37abebb7bfc67b51712d8890dc4"],
    cardRendererCreateRenderTexture: ["0x4444410", "0x4444794", 900, "45ca1caf6da17b9fb87887caa5ac075211c9b99fde4b07b3a879cb40198e488d"],
    cardRendererCctor: ["0x4444cd4", "0x4444d60", 140, "79ba69627ea3ac686efb38e127b1a356780535e97379e105723d34aa6181873d"],
    asset3DCreateRenderTexture: ["0x4396050", "0x439612c", 220, "c5023cb59cc7c680154fd16da7e76c32de8942341c8a74e77da2c20b2056f094"],
    toCardSize: ["0x4451828", "0x445184c", 36, "32e04986f89eb368a44e01f05ea0ac7bf1348a587126bb53c6c389f73f7180c6"],
    qualitySetup: ["0x469766c", "0x46978d4", 616, "5d7ab194e33ea4e774ec8fbd1c7caf955560862f14f831d14bec244856d7b071"],
    qualitySet: ["0x46978d4", "0x4697a84", 432, "493e0e5d3bf2f1438a93df3bd252f505d2936bcf97bfee88eb976ee17ee727e8"],
    frameRateSet: ["0x4697a84", "0x4697b2c", 168, "d95399e90c94dec8892846cdfcac5a1e9c0ade2c24df14ccf5cafd2f53d11b71"],
    renderOneShot: ["0x4398f24", "0x4399008", 228, "ba957a84c3ea65424792454aff46f376c22742d951511759a4b10356ef4ff44f"],
  },
};

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function raw(record) {
  const bytes = Buffer.from(record.rawHex, "hex");
  assert.equal(bytes.length, record.byteSize);
  assert.equal(sha256(bytes), record.sha256);
  return bytes;
}

function field(objectBytes, record) {
  const bytes = raw(record);
  assert.deepEqual(
    objectBytes.subarray(record.objectOffset, record.objectOffset + record.byteSize),
    bytes,
  );
  return bytes;
}

function runExtractor() {
  const args = ["build/extract_official_card_renderer.py"];
  if (process.env.PCR_APKM) args.push("--apkm", process.env.PCR_APKM);
  if (process.env.PCR_DECRYPTED_ROOT) {
    args.push("--decrypted-root", process.env.PCR_DECRYPTED_ROOT);
  }
  if (process.env.SPIRV_CROSS) args.push("--spirv-cross", process.env.SPIRV_CROSS);
  const result = spawnSync(PYTHON, args, {
    cwd: ROOT,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || "extractor failed").trim());
  }
  return JSON.parse(result.stdout.replace(/^\uFEFF/, ""));
}

const evidence = runExtractor();
assert.equal(evidence.schemaVersion, 1);

for (const [key, expected] of Object.entries(EXPECTED.source)) {
  assert.deepEqual(
    [evidence.source[key].byteSize, evidence.source[key].sha256],
    expected,
    `${key} source drifted`,
  );
}

for (const [key, expected] of Object.entries(EXPECTED.methods)) {
  const method = evidence.methods[key];
  const body = raw(method);
  assert.deepEqual(
    [method.rvaStart, method.rvaEndExclusive, method.byteSize, method.sha256],
    expected,
    `${key} body drifted`,
  );
  for (const instruction of method.selectedInstructions) {
    const bytes = Buffer.from(instruction.bytesHex, "hex");
    assert.equal(sha256(bytes), instruction.sha256);
    const offset = Number.parseInt(instruction.address, 16) - Number.parseInt(method.rvaStart, 16);
    assert.deepEqual(body.subarray(offset, offset + bytes.length), bytes);
  }
}

function selected(key, address) {
  return evidence.methods[key].selectedInstructions.find((row) => row.address === address)?.text;
}

// Critical instructions are independently pinned here, in addition to whole-method hashes.
assert.equal(selected("uiCardViewCreateRenderer", "0x443d900"), "ldr w22, [x19, #0x158]");
assert.equal(selected("uiCardViewCreateRenderer", "0x443d914"), "bl #0x4451828");
assert.equal(selected("toCardSize", "0x445183c"), "ldr w0, [x9, w8, sxtw #2]");
assert.equal(selected("cardRendererCreateRenderTexture", "0x4444514"), "bl #0x438d7fc");
assert.equal(selected("cardRendererCreateRenderTexture", "0x44445f4"), "fdiv s9, s1, s8");
assert.equal(selected("cardRendererCreateRenderTexture", "0x4444618"), "fmul s9, s9, s8");
assert.equal(selected("cardRendererCreateRenderTexture", "0x4444684"), "tst x8, #1");
assert.equal(selected("cardRendererCreateRenderTexture", "0x44446cc"), "mov w2, w1");
assert.equal(selected("cardRendererCreateRenderTexture", "0x44446d0"), "bl #0x4396050");
assert.equal(selected("asset3DCreateRenderTexture", "0x43960a8"), "mov w3, #0x18");
assert.equal(selected("asset3DCreateRenderTexture", "0x43960ac"), "mov w4, wzr");
assert.equal(selected("qualitySetup", "0x46977f8"), "cinc w21, w23, ne");
assert.equal(selected("qualitySetup", "0x4697854"), "bl #0x473e144");
assert.equal(selected("qualitySetup", "0x4697870"), "bl #0x473e144");
assert.equal(selected("qualitySet", "0x4697984"), "fmov s9, #1.00000000");
assert.equal(selected("frameRateSet", "0x4697ac0"), "mov w19, #0x3c");
assert.equal(selected("frameRateSet", "0x4697acc"), "mov w19, #0x1e");
assert.equal(selected("renderOneShot", "0x4398fcc"), "bl #0x64df244");

const native = evidence.native;
assert.deepEqual(native.cardDimensions.byCardSizeType, {
  1: { name: "Small", width: 275, height: 384, staticOffset: 16 },
  2: { name: "Medium", width: 367, height: 512, staticOffset: 8 },
  3: { name: "Large", width: 734, height: 1024, staticOffset: 0 },
});
assert.deepEqual(
  [native.cardDimensions.meterSize.rva, native.cardDimensions.meterSize.rawHex,
    native.cardDimensions.meterSize.sha256],
  ["0x1af73a0", "ae47213fae47613f", "5e51866efb1da6b707e4be24e474f3875c7fee1aef4d20b98ffc597ab3ee6133"],
);
raw(native.cardDimensions.meterSize);
assert.deepEqual(
  [native.verticalPercentageInRT.denominator.rva,
    native.verticalPercentageInRT.denominator.value,
    native.verticalPercentageInRT.denominator.rawHex],
  ["0x1af8f8c", 0.6026955842971802, "424a1a3f"],
);
raw(native.verticalPercentageInRT.denominator);
assert.equal(native.verticalPercentageInRT.valueF32, 0.7300534844398499);
assert.deepEqual(
  [native.uiCardViewSizeMap.tableRva, native.uiCardViewSizeMap.values,
    native.uiCardViewSizeMap.sha256],
  ["0x1c492f0", [1, 2, 3, 3, 3, 3],
    "ed587607462bfe3611c38114d9197e3dfbd372ebd599de8f4aad900af517eca2"],
);
raw(native.uiCardViewSizeMap);

assert.deepEqual(
  Object.fromEntries(Object.entries(native.quality.byEnum).map(([key, row]) => [key, [row.name, row.factor]])),
  { 0: ["High", 1], 1: ["Middle", 0.800000011920929], 2: ["Low", 0.699999988079071] },
);
assert.deepEqual(native.quality.defaults, {
  ordinaryAndroid: { qualityEnum: 1, qualityName: "Middle", fpsEnum: 0, fps: 60 },
  listedLowSoC: { qualityEnum: 2, qualityName: "Low", fpsEnum: 1, fps: 30 },
});
assert.equal(native.quality.persistedOverride.provedCapable, true);
raw(native.quality.byEnum[1].constant);
raw(native.quality.byEnum[2].constant);

assert.deepEqual(native.renderTexture.underlying, {
  methodRva: "0x4396050",
  widthArgument: "w1",
  heightArgument: "w2",
  depthBits: 24,
  renderTextureFormatEnum: 0,
  renderTextureFormat: "ARGB32",
  antiAliasingSetterRva: "0x650c73c",
  antiAliasingSetterCalled: false,
  antiAliasing: 1,
});
assert.equal(native.renderTexture.square, true);
assert.equal(native.renderTexture.formula,
  "roundToEven(pixelHeight / VerticalPercentageInRT * UICardQuality)");
assert.deepEqual(native.renderOneShot.managedGraphicsBlitTargetsPresent, []);
assert.equal(native.renderOneShot.hasManagedBlitOrFlip, false);

const build = evidence.serialized.buildSettings;
const buildRaw = raw(build.object);
assert.deepEqual(
  [build.object.pathId, build.object.byteStart, build.object.byteSize, build.object.sha256],
  ["11", 695976, 436, "0084735f1fc2532b992ff1427436a2cc2dea6a54c16f0b343fab491339d2d0f4"],
);
assert.equal(build.unityVersion, "2022.3.62f2");
assert.deepEqual(build.graphicsApis.values, [21]);
field(buildRaw, build.graphicsApis.arrayCount);
field(buildRaw, build.graphicsApis.elements[0]);
assert.deepEqual(evidence.derived.android, {
  graphicsApiValues: [21], graphicsApiNames: ["Vulkan"],
});

const soc = evidence.serialized.lowQualitySoC;
raw(soc.resource);
const socRaw = raw(soc.object);
assert.deepEqual(
  [soc.resource.byteSize, soc.resource.sha256, soc.object.pathId, soc.object.byteStart,
    soc.object.byteSize, soc.object.sha256],
  [324, "f0db9234071ecf8c6878bb6d1661aea55532a2e200fef46fb74515883734f44f",
    "1", 208, 116, "5fcabe383aecec58364c51d80337a72d50bfc8c23a11fea82f38870c2630bc92"],
);
field(socRaw, soc.arrayCount);
assert.deepEqual(soc.entries.map((row) => [row.id.value, row.soc.value]), [
  ["1", "Apple A10 GPU"], ["2", "Apple A11 GPU"],
]);
for (const row of soc.entries) {
  field(socRaw, row.id);
  field(socRaw, row.soc);
  field(socRaw, row.entry);
}

const detail = evidence.serialized.detailCardView;
raw(detail.bundle);
const detailRaw = raw(detail.object);
assert.deepEqual(
  [detail.bundle.byteSize, detail.bundle.sha256, detail.serializedFile,
    detail.object.pathId, detail.object.byteStart, detail.object.byteSize, detail.object.sha256],
  [7868, "3cada5b88742eaae8d7ce7c44953d7e22962345f2bb5ef4f86e0825231c3cc70",
    "CAB-e6a9153b29700ba9674dc609527659e1", "-2600777029953942905", 25056, 124,
    "358807c75edeb46834cf4686b686e4874f44bf5ca31f612544b5a7870d9fbec6"],
);
field(detailRaw, detail.fields._cardSize);
field(detailRaw, detail.fields._useGyro);
assert.deepEqual(
  [detail.fields._cardSize.objectOffset, detail.fields._cardSize.value,
    detail.fields._useGyro.objectOffset, detail.fields._useGyro.value],
  [0x60, 6, 0x64, 0],
);

const view = evidence.derived.detailView;
assert.deepEqual(
  [view.serializedUICardViewSizeType, view.tableIndex, view.cardSizeType,
    view.cardSizeName, view.pixelSize, view.callsiteFieldOffset],
  [6, 5, 3, "Large", { width: 734, height: 1024 }, 0x158],
);
assert.deepEqual(
  [view.defaultAndroidQuality, view.defaultAndroidQualityFactor,
    view.defaultSourceRenderTexture.side, view.defaultSourceRenderTexture.width,
    view.defaultSourceRenderTexture.height],
  ["Middle", 0.800000011920929, 1122, 1122, 1122],
);
assert.deepEqual(
  Object.fromEntries(Object.entries(view.sourceRenderTexturesByQuality)
    .map(([name, target]) => [name, [target.side, target.width, target.height]])),
  { High: [1403, 1403, 1403], Middle: [1122, 1122, 1122], Low: [982, 982, 982] },
);
assert.equal(view.mediumMiddleCounterfactual.side, 561);
assert.equal(view.sourceRenderTextureFixed561Proved, false);

const homography = evidence.homography;
for (const item of [homography.shader.bundle, homography.shader.object,
  homography.material.bundle, homography.material.object,
  homography.modules.vertex, homography.modules.fragment]) raw(item);
assert.deepEqual(
  [homography.modules.vertex.byteSize, homography.modules.vertex.sha256,
    homography.modules.fragment.byteSize, homography.modules.fragment.sha256],
  [4312, "ca8eb7a85ec900b4b96271fce705592f67a76c9e42d399245bcbad44c59c6a59",
    2928, "be76493bce4ebe9ddd00d1387270afebf1ef36ce7e60fb5066259d7e23eabab2"],
);
assert.deepEqual(homography.material.dynamicUITexture,
  { fileId: 0, pathId: "0", scale: [1, 1], offset: [0, 0] });
assert.deepEqual(homography.consumer, {
  fragmentSamplesDirectUvWithoutOneMinusY: true,
  fragmentHasNoTextureST: true,
  vertexHasVulkanClipYFlip: true,
  consumerAlphaFormula: "1.0 - sampled.a",
});

assert.deepEqual(evidence.unproved, [
  "native RenderTexture physical Y origin",
  "runtime producer and SetTexture assignment path for _DynamicUITex",
  "producer-side alpha convention and end-to-end alpha contract",
  "actual persisted quality selected on a runtime device",
]);

console.log("Official card renderer audit OK");
console.log("Detail view: serialized size 6 -> CardSizeType Large (3) -> 734x1024");
console.log("Default Android: Middle 0.8 -> 1122x1122 (561 is Medium-only counterfactual)");
console.log("RT: square ARGB32, depth 24, AA 1; RenderOneShot has no managed Blit/flip");
console.log("Unproved retained: native RT Y origin, SetTexture producer, alpha contract, persisted quality");
