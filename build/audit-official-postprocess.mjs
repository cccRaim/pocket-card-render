// Pin MRT/Bloom evidence to one exact official APKM and fail on byte or semantic drift.
import { readOfficialPostprocess } from "./official-postprocess.mjs";

const EXPECTED = {
  source: {
    apkmSha256: "9b7f9067e00a54f342bd4f17e669ceeb86b80bb7d34ff2d0d0fe82050a62f201",
    baseApkSha256: "815dc606f3b3e3404199fac80abb46b9249948828178a5cbf6aedb3d9e6809de",
    arm64SplitSha256: "7faf449bae431dcfeda4f882ecb04290af66cc4ccfeefc620e24cac70d22fcec",
    globalgamemanagersSha256: "5a1ca51ec16b267710479b85e33bfe150c4aab255e9716fd33d51ce7a33ea017",
    globalgamemanagersResourceSha256: "035e89da4ddfe2becba4a5848356d1c99dd4d123ee5a03646b547378de56d696",
    libil2cppSha256: "3e78eedc62770fff4cb129b4b8d898950e131b710b3c099237fe20d2d34ca48e",
  },
  bloom: {
    compressedLength: 4325,
    decompressedLength: 11684,
    compressedSha256: "1f923d6c1b6cb41e2ec631b66c433ff59ff27a9835e1cfc844c3f3a070a214ba",
    decompressedSha256: "cbb7eee99c33df71d8eb2bb0a763357978e4f5c5aedab9a9b5662d42b7c3b500",
    moduleHashes: [
      "801650bce9770e4916791417a67838a0d6492bdf3865b78aac7034db00993bd5",
      "005ae2db725c0855cd7639112f4fcbe8a927962c1d3cbabad4253140cf0442ee",
      "e07a14939c2270f4decfa8fd759749f8e8b61969e67cbcc7751a6f2a9875d3ed",
      "345ad63197d4f528fd23b42ca3f5630600ab0e9738b3eb646c198a1eec71f6ff",
      "0b715f2bb9ce16be7898d38ba63c80764fddedc0d938e3e56632f74cd89dbbfe",
      "b4cd4802893d1bfd1042386e3f79bafaf658b502707d005fb2df76cb8a747e02",
      "64e5101598193c179f84aa18625d472595c3c7f188037d870e541cda7e1524ad",
      "47d77db73cb2da6e5ddbd9aa29b273f30e4662002f18b0e072751f6306082b21",
      "3cd41d46192418a497e907d947d328b948bb6f99855cadbefb8f5a52fcbf2586",
      "240d6492f4889dfd160e84881a59dcd0c3c0e4e84c6b494cc9c06aea00926f56",
      "aaa4a2b3e10d9ee617e167bab26754c6b045ca448db5023c6d30afb6fc99606c",
      "47d77db73cb2da6e5ddbd9aa29b273f30e4662002f18b0e072751f6306082b21",
    ],
  },
  methodBodyHashes: {
    rendererDataCtor: "3573238d4b54cc23a8ffa8060c9b76bbcd80daf91864f762b24f9ebf04abd352",
    customRendererSetup: "603d2a61c3cee701b9c818d5fe69a8635b997f2006d71bf0c1148717816cce07",
    drawOpaqueOnCameraSetup: "e0372a597b0200ac0a34b982cf790e58ea16886ad8f2588a2bb9f766d02038b2",
    drawPostProcessExecute: "deec08b7c97952cb369553974c3231426571dc9599e81074736ffa147701cae5",
    drawTransparentOnCameraSetup: "1a944fc339f35c0c3c21da1eca3ec9f77e007d6dc91a14aaa58450383b2fa811",
    rendererDataGetTemporary: "31766608f2ed1b28c961a2f287cbf5eb1a5de51f1790669c4fa1414c128a997b",
    bloomPassExecute: "93605d8ec5b1263018cb5922c271878c431aca2011bdc7d1c073e1f6a1a7b3d2",
  },
};

const official = readOfficialPostprocess();
const issues = [];

function same(label, actual, expected) {
  if (actual !== expected) issues.push(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

for (const [key, expected] of Object.entries(EXPECTED.source)) same(`source.${key}`, official.source[key], expected);
for (const [key, expected] of Object.entries(EXPECTED.methodBodyHashes)) {
  same(`native.methods.${key}.bodySha256`, official.native.methods[key]?.bodySha256, expected);
}

const mrt = official.native.mrt;
same("mrt.colorAttachmentCount", mrt.colorAttachmentCount, 2);
same("mrt.multiRenderTargetArrayLength", mrt.multiRenderTargetArrayLength, 2);
same("mrt.colorFormatValue", mrt.colorFormatValue, 0);
same("mrt.colorFormat", mrt.colorFormat, "ARGB32");
same("mrt.depthBufferBits", mrt.depthBufferBits, 24);
same("mrt.depthFormatValue", mrt.depthFormatValue, 1);
same("mrt.depthFormat", mrt.depthFormat, "Depth");
same("mrt.opaqueAndTransparentBindMrt", mrt.opaqueAndTransparentBindMrt, true);

const graph = official.native.customRendererPassGraph;
same("CustomRenderer pass graph", graph.map((row) => row.pass).join(" > "),
  "PrePass > DrawOpaque > DrawSkybox > CopyDepth > DrawTransparent > DrawPostProcess > FinalBlit");
same("CustomRenderer optional graph predicates", graph.map((row) => row.condition).join("|"),
  "always|always|IsSkybox|UseDepthTexture|always|IsPostGroupLast|resolveFinalTarget");
same("DrawPostProcess list dispatch", official.native.drawPostProcess.iteratesSerializedPassList, true);

const bloom = official.bloomShader;
same("Bloom shader name", bloom.name, "Hidden/CustomPostEffect/Bloom");
same("Bloom platform", bloom.platforms.join(","), "18");
same("Bloom compressed length", bloom.compressedLength, EXPECTED.bloom.compressedLength);
same("Bloom decompressed length", bloom.decompressedLength, EXPECTED.bloom.decompressedLength);
same("Bloom compressed hash", bloom.compressedSha256, EXPECTED.bloom.compressedSha256);
same("Bloom decompressed hash", bloom.decompressedSha256, EXPECTED.bloom.decompressedSha256);
same("Bloom module count", bloom.moduleCount, 12);
same("Bloom pass count", bloom.passCountFromModulePairs, 6);
same("Bloom module hashes", bloom.modules.map((module) => module.sha256).join("|"), EXPECTED.bloom.moduleHashes.join("|"));
same("Bloom module stages", bloom.modules.map((module) => module.stage).join("|"),
  ["fragment", "vertex", "fragment", "vertex", "fragment", "vertex", "fragment", "vertex", "fragment", "vertex", "fragment", "vertex"].join("|"));

same("Bloom Execute pass sequence", official.native.bloomExecuteSequence.map((row) => row.pass).join(","), "0,1,2,3,3,4,5");
same("Bloom Execute operation sequence", official.native.bloomExecuteSequence.map((row) => row.operation).join("|"),
  "Blit|Blit/downsample loop|DrawMesh/Image2Sheet|Blit/blur|Blit/blur|DrawMesh/Sheet2Image|Blit/final");

same("Bloom pass 0 constants", bloom.math.pass0.constantBits.join(","), "0x3e9c5112,0x3f2ea2c4,0x3c4d2cc2");
same("Bloom pass 0 image samples", bloom.math.pass0.imageSampleCount, 1);
same("Bloom pass 0 FAdd count", bloom.math.pass0.fAddCount, 2);
same("Bloom pass 0 FMul count", bloom.math.pass0.fMulCount, 3);
same("Bloom pass 0 threshold/knee", bloom.math.pass0.thresholdOrKneeDetected, false);

same("Bloom pass 1 image samples", bloom.math.pass1.imageSampleCount, 4);
same("Bloom pass 1 FMax instruction", bloom.math.pass1.fMaxExtInstruction, 40);
same("Bloom pass 1 FMax count", bloom.math.pass1.fMaxCount, 4);

same("Bloom pass 3 tap constants", bloom.math.pass3.tapU32Bits.join(","),
  "0x3f266666,0x3e47ae14,0x401b851f,0x3e418937,0x408bd70a,0x3db61134,0x40ca3d71,0x3cde00d2");
same("Bloom pass 3 static sample instructions", bloom.math.pass3.staticImageSampleInstructions, 2);
same("Bloom pass 3 loop", bloom.math.pass3.loopMergeCount, 1);

same("Bloom pass 5 image samples", bloom.math.pass5.imageSampleCount, 1);
same("Bloom pass 5 arithmetic opcodes", JSON.stringify(bloom.math.pass5.arithmeticOpcodes124To200), "{}");
same("Bloom pass 5 tone map", bloom.math.pass5.toneMapDetected, false);

if (issues.length) {
  console.error(`Official postprocess audit failed: ${issues.length} issue(s)`);
  for (const issue of issues) console.error(`BAD ${issue}`);
  process.exit(1);
}

console.log("Official MRT/Bloom audit OK");
console.log(`APKM sha256:          ${official.source.apkmSha256}`);
console.log(`libil2cpp sha256:     ${official.source.libil2cppSha256}`);
console.log(`GGM resource sha256:  ${official.source.globalgamemanagersResourceSha256}`);
console.log(`MRT:                  2x ARGB32 + Depth24/CopyDepth`);
console.log(`pass graph:           ${graph.map((row) => row.pass).join(" > ")}`);
console.log(`Bloom blob:           ${bloom.compressedLength} -> ${bloom.decompressedLength} bytes`);
console.log(`Bloom modules:        ${bloom.moduleCount} (${bloom.passCountFromModulePairs} pass pairs)`);
console.log(`Bloom pass sequence:  ${official.native.bloomExecuteSequence.map((row) => row.pass).join(" -> ")}`);
console.log("Bloom tone mapping:   absent inside the pinned Bloom shader/pass graph");
console.log(`Unproven scopes:      ${official.unproven.length}`);
for (const item of official.unproven) console.log(`  - ${item}`);
