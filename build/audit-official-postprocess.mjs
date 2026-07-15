// Pin MRT/Bloom evidence to one exact official APKM and fail on byte or semantic drift.
import { createHash } from "node:crypto";
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
    bloomGetBufferSize: "060d3cdcc3a3eb9f7c468e7a614ee03c4a6ad89bf75919e5db0b758637f2f0ec",
    bloomGetSheetSize: "eff8910701cc236ab4177b2e2d4f8e005d6e1a0432061fc085d8e4b6514106e5",
    finalBlitExecute: "821bbb2f8ca357392fbde0df1cd359e6bc8647786db6d2316e55f01c01706b82",
  },
  serializedObjects: {
    14713: [5477504, 234624, 148, "e209f7ba0db7101a8e61db6ee2e7dea625d0a8abf36f2466db67730afaf6816e"],
    14715: [5478040, 235160, 68, "6b8b84ec257493cba5f6734056663e2ea03662950aceb92741ba26fa05b4dcf3"],
    14716: [5478112, 235232, 68, "3a44d80ab49efa707afc92ed3388d59c9a32250f5d1b5e5e23540421586f8120"],
    14717: [5478184, 235304, 68, "198e66d17a401b636ab2267cfba940973a526ae9685d1da58147327163d7da64"],
    14718: [5478256, 235376, 68, "6554e6446d39ec70097fc5a03bac1f79d2af31f628b07a41fb9f4a1e09b83360"],
    14719: [5478328, 235448, 64, "b1a2db7730428975e3b7ad999c5a7a90f2ec0bf195a0f80be7b6845a469a527f"],
    14721: [5478840, 235960, 64, "9e072095fd99ca73c346765493b1536f52576c388b26a96e85382505264122fa"],
    14722: [5478904, 236024, 80, "8cb8ee3aa1339c798a888cad5baa59033d5c1d9c8ff911d8307e4dd94b1e3371"],
    14723: [5478984, 236104, 80, "8cb8ee3aa1339c798a888cad5baa59033d5c1d9c8ff911d8307e4dd94b1e3371"],
    14724: [5479064, 236184, 80, "8cb8ee3aa1339c798a888cad5baa59033d5c1d9c8ff911d8307e4dd94b1e3371"],
    14725: [5479144, 236264, 80, "8cb8ee3aa1339c798a888cad5baa59033d5c1d9c8ff911d8307e4dd94b1e3371"],
    14726: [5479224, 236344, 80, "8cb8ee3aa1339c798a888cad5baa59033d5c1d9c8ff911d8307e4dd94b1e3371"],
  },
};

const official = readOfficialPostprocess();
const issues = [];

function same(label, actual, expected) {
  if (actual !== expected) issues.push(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function sameJson(label, actual, expected) {
  same(label, JSON.stringify(actual), JSON.stringify(expected));
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function rawBytes(label, hex) {
  if (typeof hex !== "string" || hex.length % 2 || !/^[0-9a-f]*$/.test(hex)) {
    issues.push(`${label}: invalid lowercase hex bytes`);
    return Buffer.alloc(0);
  }
  return Buffer.from(hex, "hex");
}

function verifyBodyBytes(key, method, expectedHash) {
  const body = rawBytes(`native.methods.${key}.bodyHex`, method?.bodyHex);
  same(`native.methods.${key}.bodyHex length`, body.length, method?.bodySize);
  same(`native.methods.${key}.bodyHex sha256`, sha256(body), method?.bodySha256);
  same(`native.methods.${key}.pinned body sha256`, method?.bodySha256, expectedHash);
}

function verifyInstructionBytes(label, method, instruction) {
  const body = rawBytes(`${label}.method.bodyHex`, method.bodyHex);
  const instructionBytes = rawBytes(`${label}.fileBytesHex`, instruction.fileBytesHex);
  const relativeOffset = Number.parseInt(instruction.address, 16) - Number.parseInt(method.rva, 16);
  same(`${label}.bytes from method body`, instructionBytes.toString("hex"),
    body.subarray(relativeOffset, relativeOffset + instructionBytes.length).toString("hex"));
}

function verifyObjectBytes(label, object, expected) {
  const [resourceOffset, splitOffset, byteSize, rawSha256] = expected;
  same(`${label}.pathId`, object?.pathId, Number(label));
  same(`${label}.type`, object?.type, "MonoBehaviour");
  same(`${label}.classId`, object?.classId, 114);
  same(`${label}.resourceOffset`, object?.resourceOffset, resourceOffset);
  same(`${label}.splitPath`, object?.splitPath, "assets/bin/Data/globalgamemanagers.assets.split5");
  same(`${label}.splitOffset`, object?.splitOffset, splitOffset);
  same(`${label}.byteSize`, object?.byteSize, byteSize);
  const raw = rawBytes(`${label}.rawHex`, object?.rawHex);
  same(`${label}.rawHex length`, raw.length, byteSize);
  same(`${label}.rawHex sha256`, sha256(raw), object?.rawSha256);
  same(`${label}.pinned raw sha256`, object?.rawSha256, rawSha256);
  return raw;
}

function verifyFieldBytes(label, object, field) {
  const objectRaw = rawBytes(`${label}.object.rawHex`, object.rawHex);
  const fieldRaw = rawBytes(`${label}.rawHex`, field?.rawHex);
  const expectedRaw = objectRaw.subarray(field?.objectOffset, field?.objectOffset + field?.byteSize);
  same(`${label}.sourcePathId`, field?.sourcePathId, object.pathId);
  same(`${label}.resourceOffset`, field?.resourceOffset, object.resourceOffset + field?.objectOffset);
  same(`${label}.splitPath`, field?.splitPath, object.splitPath);
  same(`${label}.splitOffset`, field?.splitOffset, object.splitOffset + field?.objectOffset);
  same(`${label}.rawHex from object`, fieldRaw.toString("hex"), expectedRaw.toString("hex"));
  return fieldRaw;
}

function pinBool(label, object, field, expected) {
  const raw = verifyFieldBytes(label, object, field);
  same(`${label}.decoded from raw`, field?.value, raw[0] !== 0);
  same(`${label}.value`, field?.value, expected);
}

function pinInt32(label, object, field, expected) {
  const raw = verifyFieldBytes(label, object, field);
  same(`${label}.decoded from raw`, field?.value, raw.length === 4 ? raw.readInt32LE() : null);
  same(`${label}.value`, field?.value, expected);
}

function pinUint32(label, object, field, expected) {
  const raw = verifyFieldBytes(label, object, field);
  same(`${label}.decoded from raw`, field?.value, raw.length === 4 ? raw.readUInt32LE() : null);
  same(`${label}.value`, field?.value, expected);
}

function pinFloat32(label, object, field, expected) {
  const raw = verifyFieldBytes(label, object, field);
  same(`${label}.decoded from raw`, field?.value, raw.length === 4 ? raw.readFloatLE() : null);
  same(`${label}.value`, field?.value, expected);
}

function pinPPtr(label, object, field, expected) {
  const raw = verifyFieldBytes(label, object, field);
  const decoded = raw.length === 12 ? {
    fileId: raw.readInt32LE(0),
    pathId: Number(raw.readBigInt64LE(4)),
  } : null;
  sameJson(`${label}.decoded from raw`, field?.value, decoded);
  sameJson(`${label}.value`, field?.value, expected);
}

function pinUnityString(label, object, field, expected) {
  const raw = verifyFieldBytes(label, object, field);
  const length = raw.length >= 4 ? raw.readUInt32LE(0) : 0;
  const decoded = raw.subarray(4, 4 + length).toString("utf8");
  same(`${label}.decoded from raw`, field?.value, decoded);
  same(`${label}.value`, field?.value, expected);
}

for (const [key, expected] of Object.entries(EXPECTED.source)) same(`source.${key}`, official.source[key], expected);
for (const [key, expected] of Object.entries(EXPECTED.methodBodyHashes)) {
  verifyBodyBytes(key, official.native.methods[key], expected);
}

const serialized = official.serializedPostProcess;
same("serialized format version", serialized.serializedFile.formatVersion, 22);
same("serialized Unity version", serialized.serializedFile.unityVersion, "2022.3.62f2");
same("serialized endian", serialized.serializedFile.endian, "<");
same("serialized metadata size", serialized.serializedFile.metadataSize, 354061);
same("serialized file/resource size", serialized.serializedFile.fileSize, 5479304);
same("serialized resource size", serialized.serializedFile.resourceSize, 5479304);
same("serialized data offset", serialized.serializedFile.dataOffset, 354112);
same("serialized object count", serialized.serializedFile.objectCount, 14726);
same("serialized embedded type tree", serialized.serializedFile.embeddedTypeTreeEnabled, false);
same("serialized custom type tree fallback", serialized.decode.typeTreeReadableForAllTargets, false);
same("serialized type tree attempt count", serialized.decode.typeTreeAttempts.length, 12);
same("serialized target type trees unreadable", serialized.decode.typeTreeAttempts.every((item) => !item.readable), true);
same("serialized resource hash linkage", serialized.serializedFile.resourceSha256,
  official.source.globalgamemanagersResourceSha256);

const targetObjects = [
  serialized.postProcessData,
  ...serialized.profiles,
  serialized.bloomPass,
  ...serialized.bloomVolumes,
];
const objectByPathId = new Map(targetObjects.map((item) => [item.object.pathId, item.object]));
for (const [pathId, expected] of Object.entries(EXPECTED.serializedObjects)) {
  verifyObjectBytes(pathId, objectByPathId.get(Number(pathId)), expected);
}

const postProcessData = serialized.postProcessData;
pinUnityString("PostProcessData.name", postProcessData.object, postProcessData.monoBehaviour.name, "PostProcessData");
pinUint32("PostProcessData.profileCount", postProcessData.object, postProcessData.profileCount, 5);
const expectedProfileEntries = [
  [0, 14717],
  [27, 14716],
  [28, 14715],
  [31, 14718],
  [29, 14719],
];
same("PostProcessData profile entry count", postProcessData.profiles.length, expectedProfileEntries.length);
for (let index = 0; index < expectedProfileEntries.length; index += 1) {
  const entry = postProcessData.profiles[index];
  const [type, pathId] = expectedProfileEntries[index];
  pinInt32(`PostProcessData.profiles[${index}].type`, postProcessData.object, entry.type, type);
  pinPPtr(`PostProcessData.profiles[${index}].profile`, postProcessData.object, entry.profile,
    { fileId: 0, pathId });
}
pinUint32("PostProcessData.postProcessPassCount", postProcessData.object,
  postProcessData.postProcessPassCount, 1);
same("PostProcessData post-process pass array length", postProcessData.postProcessPasses.length, 1);
pinPPtr("PostProcessData.postProcessPasses[0]", postProcessData.object,
  postProcessData.postProcessPasses[0].pass, { fileId: 0, pathId: 14721 });
sameJson("PostProcessData only BloomPass PathID", serialized.derived.postProcessPassPathIds, [14721]);

const expectedProfiles = [
  [14715, "BattleVolumeProfile", 14722],
  [14716, "CardVolumeProfile", 14723],
  [14717, "DefaultVolumeProfile", 14724],
  [14718, "PackVolumeProfile", 14725],
  [14719, "UIVolumeProfile", 14726],
];
for (let index = 0; index < expectedProfiles.length; index += 1) {
  const profile = serialized.profiles[index];
  const [pathId, name, componentPathId] = expectedProfiles[index];
  same(`profile[${index}].PathID`, profile.object.pathId, pathId);
  pinUnityString(`profile[${index}].name`, profile.object, profile.monoBehaviour.name, name);
  pinUint32(`profile[${index}].componentCount`, profile.object, profile.componentCount, 1);
  same(`profile[${index}] component array length`, profile.components.length, 1);
  pinPPtr(`profile[${index}].components[0]`, profile.object, profile.components[0].component,
    { fileId: 0, pathId: componentPathId });
}
sameJson("five profile BloomVolume PathIDs", serialized.derived.profileComponentPathIds,
  [14722, 14723, 14724, 14725, 14726]);

const bloomPassObject = serialized.bloomPass.object;
pinUnityString("BloomPass.name", bloomPassObject, serialized.bloomPass.monoBehaviour.name, "BloomPass");
pinPPtr("BloomPass.shader", bloomPassObject, serialized.bloomPass.fields.shader, { fileId: 0, pathId: 10 });
pinBool("BloomPass.applyToSceneView", bloomPassObject, serialized.bloomPass.fields.applyToSceneView, true);
pinInt32("BloomPass.limitCount", bloomPassObject, serialized.bloomPass.fields.limitCount, 3);

same("BloomVolume object count", serialized.bloomVolumes.length, 5);
same("BloomVolume raw bytes identical", serialized.derived.bloomVolumeRawIdentical, true);
same("BloomVolume common raw sha256", serialized.derived.bloomVolumeRawSha256,
  "8cb8ee3aa1339c798a888cad5baa59033d5c1d9c8ff911d8307e4dd94b1e3371");
same("BloomVolume rawHex identity",
  new Set(serialized.bloomVolumes.map((volume) => volume.object.rawHex)).size, 1);
for (let index = 0; index < serialized.bloomVolumes.length; index += 1) {
  const volume = serialized.bloomVolumes[index];
  const fields = volume.fields;
  pinUnityString(`BloomVolume[${index}].name`, volume.object, volume.monoBehaviour.name, "BloomVolume");
  pinBool(`BloomVolume[${index}].active`, volume.object, fields.active, true);
  pinBool(`BloomVolume[${index}].bufferSize.overrideState`, volume.object,
    fields.bufferSize.overrideState, true);
  pinInt32(`BloomVolume[${index}].bufferSize.value`, volume.object, fields.bufferSize.value, 256);
  pinBool(`BloomVolume[${index}].downSamplingCount.overrideState`, volume.object,
    fields.downSamplingCount.overrideState, true);
  pinInt32(`BloomVolume[${index}].downSamplingCount.value`, volume.object,
    fields.downSamplingCount.value, 5);
  pinBool(`BloomVolume[${index}].scatter.overrideState`, volume.object,
    fields.scatter.overrideState, true);
  pinFloat32(`BloomVolume[${index}].scatter.value`, volume.object, fields.scatter.value, 0.5);
  pinBool(`BloomVolume[${index}].intensity.overrideState`, volume.object,
    fields.intensity.overrideState, true);
  pinFloat32(`BloomVolume[${index}].intensity.value`, volume.object, fields.intensity.value, 1);
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

const getBufferMethod = official.native.methods.bloomGetBufferSize;
const getSheetMethod = official.native.methods.bloomGetSheetSize;
const finalBlitMethod = official.native.methods.finalBlitExecute;
same("GetBufferSize RVA", getBufferMethod.rva, "0x4308b80");
same("GetBufferSize end RVA", getBufferMethod.endRvaExclusive, "0x4308c2c");
same("GetBufferSize file offset", getBufferMethod.fileOffset, "0x4304b80");
same("GetBufferSize body size", getBufferMethod.bodySize, 172);
same("GetSheetSize RVA", getSheetMethod.rva, "0x4308c2c");
same("GetSheetSize end RVA", getSheetMethod.endRvaExclusive, "0x4308c84");
same("FinalBlit RVA", finalBlitMethod.rva, "0x430dcc0");
same("FinalBlit end RVA", finalBlitMethod.endRvaExclusive, "0x430e284");
same("FinalBlit file offset", finalBlitMethod.fileOffset, "0x4309cc0");
same("FinalBlit body size", finalBlitMethod.bodySize, 1476);
same("FinalBlit evidence method key", official.native.finalBlit.methodKey, "finalBlitExecute");

const sizing = official.native.bloomSizing;
same("GetBufferSize sizing method key", sizing.getBufferSize.methodKey, "bloomGetBufferSize");
same("GetBufferSize target aspect", sizing.getBufferSize.targetAspect.value, 0.5625);
same("GetBufferSize target aspect fraction", sizing.getBufferSize.targetAspect.fraction, "9/16");
same("GetBufferSize target instruction", sizing.getBufferSize.targetAspect.instruction.text,
  "fmov s2, #0.56250000");
verifyInstructionBytes("GetBufferSize target aspect", getBufferMethod,
  sizing.getBufferSize.targetAspect.instruction);
for (const instruction of sizing.getBufferSize.instructionEvidence) {
  verifyInstructionBytes(`GetBufferSize ${instruction.address}`, getBufferMethod, instruction);
}
same("GetBufferSize 9:16 example aspect", sizing.portraitExample.aspect, "9:16");
sameJson("GetBufferSize 9:16 input", sizing.portraitExample.inputSize, { width: 9, height: 16 });
same("GetBufferSize bufferSize", sizing.portraitExample.bufferSize.value, 256);
same("GetBufferSize buffer source PathID", sizing.portraitExample.bufferSize.sourcePathId, 14722);
same("GetBufferSize buffer source object offset", sizing.portraitExample.bufferSize.objectOffset, 52);
same("GetBufferSize buffer source raw", sizing.portraitExample.bufferSize.rawHex, "00010000");
sameJson("GetBufferSize 9:16 base", sizing.portraitExample.baseSize, { width: 256, height: 455 });
sameJson("Bloom pass 0 scale", sizing.portraitExample.pass0.scale, { width: 2, height: 2 });
sameJson("Bloom pass 0 size", sizing.portraitExample.pass0.size, { width: 512, height: 910 });
for (const instruction of sizing.portraitExample.pass0.instructionEvidence) {
  verifyInstructionBytes(`Bloom pass 0 ${instruction.address}`,
    official.native.methods.bloomPassExecute, instruction);
}
same("Bloom sheet width formula", sizing.portraitExample.sheet.formula.width,
  "baseWidth + (baseWidth >> 1) + 36");
same("Bloom sheet height formula", sizing.portraitExample.sheet.formula.height, "baseHeight + 18");
sameJson("Bloom sheet size", sizing.portraitExample.sheet.size, { width: 420, height: 473 });
for (const instruction of sizing.portraitExample.sheet.instructionEvidence) {
  verifyInstructionBytes(`Bloom sheet ${instruction.address}`,
    official.native.methods.bloomPassExecute, instruction);
}
for (const instruction of sizing.getSheetSizeHelper.instructionEvidence) {
  verifyInstructionBytes(`GetSheetSize ${instruction.address}`, getSheetMethod, instruction);
}

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

sameJson("unproven scopes", official.unproven, [
  "Bloom sheet vertex weights/intensity-scatter encoding and the complete per-level downsample/blur render-target size sequence.",
  "FinalBlit shader selection, blend semantics, and any final tone mapping beyond the pinned IL2CPP body bytes.",
  "Physical Vulkan image formats selected by a particular Android device for Unity ARGB32/Depth enums.",
]);

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
console.log(`PostProcessData:      PathID ${postProcessData.object.pathId} -> BloomPass ${serialized.derived.postProcessPassPathIds.join(",")}`);
console.log(`Bloom profiles:       ${serialized.profiles.length} profiles -> ${serialized.derived.profileComponentPathIds.join(",")}`);
console.log(`Bloom volume:         buffer=${serialized.bloomVolumes[0].fields.bufferSize.value.value} levels=${serialized.bloomVolumes[0].fields.downSamplingCount.value.value} scatter=${serialized.bloomVolumes[0].fields.scatter.value.value} intensity=${serialized.bloomVolumes[0].fields.intensity.value.value}`);
console.log(`Bloom 9:16 sizes:     base ${sizing.portraitExample.baseSize.width}x${sizing.portraitExample.baseSize.height}, pass0 ${sizing.portraitExample.pass0.size.width}x${sizing.portraitExample.pass0.size.height}, sheet ${sizing.portraitExample.sheet.size.width}x${sizing.portraitExample.sheet.size.height}`);
console.log(`FinalBlit body:       ${finalBlitMethod.bodySize} bytes sha256 ${finalBlitMethod.bodySha256}`);
console.log("Bloom tone mapping:   absent inside the pinned Bloom shader/pass graph");
console.log(`Unproven scopes:      ${official.unproven.length}`);
for (const item of official.unproven) console.log(`  - ${item}`);
