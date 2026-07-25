#!/usr/bin/env node
// Strict, screenshot-free audit of the official TouchStateRotation chain.
import { createHash } from "node:crypto";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EXTRACTOR = path.join(ROOT, "build", "extract_official-touch-rotation.py");
const PYTHON = process.env.PYTHON || "python";
const APKM = path.resolve(process.env.PCR_APKM
  || "D:/DevProjectes/ptcg-apk-parser/apks/jp.pokemon.pokemontcgp_1.6.0.apkm");
const DETAIL_BUNDLE = path.resolve(process.env.PCR_CARD_VIEW_BUNDLE
  || "D:/DevProjectes/ptcgp-tools-master/masterdata_decoder/.output/decrypted/Common/UI/Prefabs/Common/CommonUICardDetailCard.prefab_bundles");
const JSON_MODE = process.argv.includes("--json");

const EXPECTED = {
  source: {
    apkmSha256: "9b7f9067e00a54f342bd4f17e669ceeb86b80bb7d34ff2d0d0fe82050a62f201",
    baseApkSha256: "815dc606f3b3e3404199fac80abb46b9249948828178a5cbf6aedb3d9e6809de",
    arm64SplitSha256: "7faf449bae431dcfeda4f882ecb04290af66cc4ccfeefc620e24cac70d22fcec",
    libil2cppSha256: "3e78eedc62770fff4cb129b4b8d898950e131b710b3c099237fe20d2d34ca48e",
    metadataEncryptedSha256: "b691dbdd2f9b35dc0dd6d3eb9cb54782c1013bc5b24fe2a6ed1c87db64ecada2",
    metadataPlaintextSha256: "bf58e06a98f9e9e05a1635f512ea432d33971bfc8280ba26df1c93e94b4f3cb9",
    detailBundleSha256: "3cada5b88742eaae8d7ce7c44953d7e22962345f2bb5ef4f86e0825231c3cc70",
  },
  types: {
    touchStateRotation: [39693, "e1245b36c1923dc1754a006764bcdd8e8a6d4448987c84106e7b0d200659ef9b"],
    uiAsset3DView: [39699, "a73d780b7f3f26ab6e5f4da3c55cacf1200949eef8f7490c639cd90b87bf2ff2"],
    uiCardView: [29442, "23699c0ae184645e8af828e2355714eb4ebb420d64f91bc5c60bd191750e1165"],
    pointerEventData: [29734, "cd473ad2fc1279102ad66cdc718c780c8b0fd5ae0f8d34f1ab2756730068096b"],
    rect: [21879, "a09e463c4dc2e4b5bc62de673b6560a60da9c7acb5a1c0beefa5fd8002e59e09"],
    vector3: [22000, "52c11f05a1fbb5168e407a725aadc39324ee64888a10c636d95383c02238ced5"],
    quaternion: [22001, "cb5f65279e28ee688e7b17d5af9d0a58351c357d0493fc2cea2e76b86fc5b1c7"],
    rectTransform: [22122, "dabbdff2e8d606eb2a937df046b31943d571d111ce1463abffd80f5c50926bcf"],
    rectTransformUtility: [41123, "4330c2790c66a8bef75fb155b977ea294ea9a2c88c22e0b67315d8e3ffd9b1ec"],
    transform: [22125, "4c85bb9f260913bd1a6141c10cd918e0c021bdda39b75a0f7f4e2455192ac8ff"],
  },
  methods: {
    touchOnUpdate: [1008, "c57f13028426f92b63a3db615f8f4673dbf5d9fed8ec928943457da288ff96b0"],
    touchOnDrag: [1396, "b0595881580c5b178f4fd355f099453927c458228cb3cd46524fd770137c4085"],
    initializeTouchStateMachine: [60, "3975ded092582fc3404e9709e8bb551c903a1d4be324be3029938e50abcedfd7"],
    uiAssetOnDrag: [352, "a43a7d449859c60f73c824b988713530042a3831f7a4d497058fa7541b612955"],
    createTouchStateMachine: [360, "16e11fcb386a6a6683e195e829974568a161bbc3fe4a3d0aa5f8ea7ffb2050c8"],
    vector3Cctor: [252, "959b796ccd54ed15c07608b797fef834b5ff9d3a4f26659d90d334325f1433cc"],
    quaternionCctor: [80, "4a67b85625d25f539af397c2afcdb6f41a6a41acf8e11fcb47643dfb37eaf956"],
  },
  windows: {
    touchOperationGate: [60, "3975ded092582fc3404e9709e8bb551c903a1d4be324be3029938e50abcedfd7"],
    rotationFactory30Degrees: [48, "6496c96e7ec766feeb1e6a31db7c907f50e257145e3e4ad8a668b6fc78ad5acb"],
    eventPositionToLocalPoint: [160, "6669e034367bec48c622f5bacd160a105598a2762b78cefb334ad10e335a721d"],
    xLocalNormalizeAcosDelta: [76, "7625ee6be559d72004a14ba76d8908edd82d82ac267454709664839c6e01c3aa"],
    qYAngleAxisAndIdentityProduct: [192, "e8ad2c61922621412c35ba90ef859d9fdf33473a7e30848ede070e3b5aff2677"],
    yLocalNormalizeAcosDelta: [68, "4ae1bf80aa40fe02d523128d0488571c56da81c9e63ac02bf2a76b686faca82b"],
    qXAngleAxisAndQYQXProduct: [192, "fcfecc2babbae3e4ae867ed3274ab83fc766925f7a559898efc86435f2c70734"],
    storeDragDelta: [56, "d00c63891dbd7627e6c029a1eb4169f93a7b88d1d89f810542770f702c2e7626"],
    currentTimesDelta: [168, "ae407258b12d311df52304b2604ee3a87166aba6e722edad5804dc2c0d8dee5f"],
    zeroRollAndRebuild: [124, "98ab984f785d3b4e2374fbe6dbb28745a0222b9252bbe6c5f3d23d879bb7a3ee"],
    angleClamp: [164, "d765b197298a290f6c87dfba0a93ec7c1bd0c589537b0a4df465130b7cdcfcb5"],
    setRotationAndClearDelta: [60, "b61da18b0dfcb56b7e04e834804e3df4f0263ef4f10bcc36d855b4fb2f35d634"],
    vector3UpLeftInitialization: [60, "146fd9969bd3a39bec50db9160ad8f0c417e3e255a8dda29f23bd0beb286418a"],
    quaternionIdentityInitialization: [24, "6424c3bca8d9329829685e2a09ebe581f6e766e696cae085b1b82a71f0a4449c"],
  },
};

function runExtractor() {
  const result = spawnSync(PYTHON, [
    EXTRACTOR,
    "--apkm", APKM,
    "--detail-bundle", DETAIL_BUNDLE,
  ], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    shell: process.platform === "win32",
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || `exit ${result.status}`).trim());
  }
  return JSON.parse(result.stdout);
}

function hashHex(rawHex) {
  return createHash("sha256").update(Buffer.from(rawHex, "hex")).digest("hex");
}

const checks = [];
const failures = [];
function check(category, label, condition, evidence = undefined) {
  const row = { category, label, status: condition ? "proved" : "failed" };
  if (evidence !== undefined) row.evidence = evidence;
  checks.push(row);
  if (!condition) failures.push(`${category}: ${label}`);
}

function pinnedRaw(category, label, actual, expectedSize, expectedHash) {
  check(category, label,
    actual?.byteSize === expectedSize
      && actual?.sha256 === expectedHash
      && hashHex(actual?.rawHex || "") === expectedHash,
    actual);
}

let evidence;
try {
  evidence = runExtractor();
} catch (error) {
  console.error(`BAD official touch-rotation extractor failed: ${error.message}`);
  process.exit(1);
}

check("schema", "schemaVersion is 1", evidence.schemaVersion === 1);
check("schema", "status keeps proof boundaries explicit",
  evidence.status === "proved-with-explicit-boundaries");

const source = evidence.source || {};
check("source", "official APKM hash", source.apkmSha256 === EXPECTED.source.apkmSha256);
check("source", "base APK hash", source.baseApkSha256 === EXPECTED.source.baseApkSha256);
check("source", "arm64 split hash", source.arm64SplitSha256 === EXPECTED.source.arm64SplitSha256);
check("source", "libil2cpp hash", source.libil2cppSha256 === EXPECTED.source.libil2cppSha256);
check("source", "encrypted metadata hash",
  source.metadata?.encryptedSha256 === EXPECTED.source.metadataEncryptedSha256);
check("source", "plaintext metadata hash/version",
  source.metadata?.plaintextSha256 === EXPECTED.source.metadataPlaintextSha256
    && source.metadata?.version === 31
    && source.metadata?.magic === "0xfab11baf");
check("source", "decrypted detail bundle hash",
  source.detailBundleSha256 === EXPECTED.source.detailBundleSha256);

for (const [key, [index, hash]] of Object.entries(EXPECTED.types)) {
  const actual = evidence.metadata?.types?.[key];
  pinnedRaw("metadata", `${key} type definition`, actual?.record, 88, hash);
  check("metadata", `${key} type index`, actual?.typeDefinitionIndex === index, actual?.typeDefinitionIndex);
}

const metadataTypes = evidence.metadata?.types || {};
check("metadata", "TouchStateRotation fields and methods are selected from metadata",
  ["_maxRotationDegree", "_prevPoint", "_rot"].every((name) => metadataTypes.touchStateRotation?.selectedFields?.[name]?.name === name)
    && metadataTypes.touchStateRotation?.selectedMethods?.OnDrag?.parameterCount === 1
    && metadataTypes.touchStateRotation?.selectedMethods?.OnUpdate?.parameterCount === 0
    && metadataTypes.touchStateRotation?.selectedMethods?.[".ctor"]?.parameterCount === 2);
check("metadata", "serialized gates and input/rect fields are named by metadata",
  metadataTypes.uiAsset3DView?.selectedFields?._useTouchOperation?.name === "_useTouchOperation"
    && metadataTypes.uiCardView?.selectedFields?._useGyro?.name === "_useGyro"
    && metadataTypes.pointerEventData?.selectedFields?.["<position>k__BackingField"]?.name === "<position>k__BackingField"
    && metadataTypes.rect?.selectedFields?.m_Width?.name === "m_Width"
    && metadataTypes.rect?.selectedFields?.m_Height?.name === "m_Height");

const detail = evidence.serializedDetail || {};
pinnedRaw("prefab", "detail bundle bytes", detail.bundle, 7868, EXPECTED.source.detailBundleSha256);
pinnedRaw("prefab", "detail component raw bytes", detail.component, 124,
  "358807c75edeb46834cf4686b686e4874f44bf5ca31f612544b5a7870d9fbec6");
check("prefab", "precise detail object identity",
  detail.container === "Assets/Lettuce/_Data/Common/UI/Prefabs/Common/CommonUICardDetailCard.prefab"
    && detail.component?.pathId === "-2600777029953942905"
    && detail.component?.byteStart === 25056
    && detail.gameObject?.pathId === "7108130666142665351"
    && detail.gameObject?.name === "card_img");

const useTouch = detail.fields?._useTouchOperation;
const cardSize = detail.fields?._cardSize;
const useGyro = detail.fields?._useGyro;
check("prefab", "ordinary detail _useTouchOperation=true at serialized offset 0x58",
  useTouch?.value === true && useTouch?.objectOffset === 0x58
    && useTouch?.logicalByteSize === 1
    && useTouch?.alignedSlot?.rawHex === "01000000"
    && useTouch?.alignedSlot?.sha256 === "67abdd721024f0ff4e0b3f4c2fc13bc5bad42d0b7851d456d88d203d15aaa450");
check("prefab", "ordinary detail _cardSize=6 at serialized offset 0x60",
  cardSize?.value === 6 && cardSize?.objectOffset === 0x60
    && cardSize?.alignedSlot?.rawHex === "06000000");
check("prefab", "ordinary detail _useGyro=false at serialized offset 0x64",
  useGyro?.value === false && useGyro?.objectOffset === 0x64
    && useGyro?.logicalByteSize === 1
    && useGyro?.alignedSlot?.rawHex === "00000000"
    && useGyro?.alignedSlot?.sha256 === "df3f619804a92fdb4057192dc43dd748ea778adc52bc498ce80524c014b81119");

for (const [key, [size, hash]] of Object.entries(EXPECTED.methods)) {
  pinnedRaw("method-body", key, evidence.native?.methods?.[key], size, hash);
}
for (const [key, [size, hash]] of Object.entries(EXPECTED.windows)) {
  pinnedRaw("byte-window", key, evidence.native?.windows?.[key], size, hash);
}

const imported = evidence.native?.acosfImport;
pinnedRaw("native-import", "acosf PLT entry", imported?.entry, 16,
  "05a44033f0dde526226039a5d87e6e92e04029c76525da38d88f70d0b692a354");
pinnedRaw("native-import", "acosf relocation", imported?.relocation, 24,
  "d95dca22b0658f457e4b5451b3cefa3b99c4670a6f5ac35cfbf0d84eb9df1869");
pinnedRaw("native-import", "acosf dynamic symbol", imported?.dynamicSymbol, 24,
  "9300c043408c21a9badc29fb2511fdebfefc70b54eaae0369a77bc5323b3187a");
check("native-import", "direct official import is acosf, never claimed as direct asinf",
  imported?.entryRva === "0x67bed20"
    && imported?.gotRva === "0x6d27780"
    && imported?.name === "acosf"
    && imported?.nameBytes?.rawHex === "61636f7366");

const constants = evidence.native?.constants || {};
check("constants", "Rad2Deg raw constant",
  constants.radToDeg?.rva === "0x1af90f4"
    && constants.radToDeg?.rawHex === "e12e6542"
    && constants.radToDeg?.values?.[0] === Math.fround(180 / Math.PI));
check("constants", "Vector3.up and Vector3.left raw constants",
  JSON.stringify(constants.vectorUpXY?.values) === JSON.stringify([0, 1])
    && constants.vectorUpXY?.rawHex === "000000000000803f"
    && JSON.stringify(constants.vectorLeftXY?.values) === JSON.stringify([-1, 0])
    && constants.vectorLeftXY?.rawHex === "000080bf00000000");
check("constants", "Quaternion.identity raw constant",
  JSON.stringify(constants.quaternionIdentity?.values) === JSON.stringify([0, 0, 0, 1])
    && constants.quaternionIdentity?.rawHex === "0000000000000000000000000000803f");

const derived = evidence.derived || {};
check("semantics", "local rect normalization is width/height half extent",
  derived.localNormalization?.conversion === "RectTransformUtility.ScreenPointToLocalPointInRectangle"
    && derived.localNormalization?.x === "clamp(localX / (rect.width * 0.5), -1, 1)"
    && derived.localNormalization?.y === "clamp(localY / (rect.height * 0.5), -1, 1)");
check("semantics", "acosf delta and derived asin identity remain distinguished",
  derived.angleDelta?.directImportedFunction === "acosf"
    && derived.angleDelta?.directRadians === "acos(currentNormalized) - acos(previousNormalized)"
    && derived.angleDelta?.equivalentAsinRadians === "asin(previousNormalized) - asin(currentNormalized)"
    && /mathematical derivation/.test(derived.angleDelta?.warning || "")
    && /official direct symbol is acosf/.test(derived.angleDelta?.warning || ""));
check("semantics", "drag delta is qY * qX",
  derived.dragDeltaQuaternion?.composition === "qY * qX"
    && derived.dragDeltaQuaternion?.hamiltonOperandOrder === "left=qY, right=qX"
    && /Vector3\.up/.test(derived.dragDeltaQuaternion?.qY || "")
    && /Vector3\.left/.test(derived.dragDeltaQuaternion?.qX || ""));
check("semantics", "application is current * delta with roll cleared",
  derived.application?.composition === "currentLocalRotation * dragDelta"
    && derived.application?.hamiltonOperandOrder === "left=currentLocalRotation, right=dragDelta"
    && /set z=0/.test(derived.application?.roll || ""));
check("semantics", "30 degree quaternion-angle clamp",
  derived.clamp?.factoryMaxDegrees === 30
    && derived.clamp?.angle === "2 * acos(abs(dot(identity, candidate))) * Rad2Deg"
    && derived.clamp?.factor === "min(maxRotationDegree / angle, 1)"
    && derived.clamp?.operation === "Quaternion.SlerpUnclamped(identity, candidate, factor)");
check("semantics", "pinned ordinary detail enables touch and disables gyro",
  derived.ordinaryDetail?.useTouchOperation === true
    && derived.ordinaryDetail?.useGyro === false);

const expectedUnproved = [
  "other-prefabs-or-runtime-mutation",
  "pointer-samples-and-event-cadence",
  "browser-runtime-equivalence",
  "visual-output-parity",
].sort();
const unproved = evidence.unproved || [];
check("proof-boundary", "four required unknowns remain explicitly unproved",
  JSON.stringify(unproved.map((row) => row.id).sort()) === JSON.stringify(expectedUnproved)
    && unproved.every((row) => row.status === "unproved")
    && unproved.some((row) => /screenshots are not evidence/.test(row.claim)));

const report = {
  status: failures.length ? "failed" : "passed-with-explicit-unproved",
  screenshotUsed: false,
  source: {
    apkmSha256: source.apkmSha256,
    libil2cppSha256: source.libil2cppSha256,
    metadataSha256: source.metadata?.plaintextSha256,
    detailBundleSha256: source.detailBundleSha256,
    detailComponentSha256: detail.component?.sha256,
  },
  summary: {
    checks: checks.length,
    proved: checks.filter((row) => row.status === "proved").length,
    failed: failures.length,
    methodBodiesPinned: Object.keys(EXPECTED.methods).length,
    byteWindowsPinned: Object.keys(EXPECTED.windows).length,
  },
  checks,
  unproved,
  failures,
};

if (JSON_MODE) {
  console.log(JSON.stringify(report, null, 2));
} else if (failures.length) {
  console.error(`Official touch-rotation audit FAILED (${failures.length} mismatch(es))`);
  for (const failure of failures) console.error(`BAD ${failure}`);
} else {
  console.log("Official touch-rotation audit OK (required proof boundaries retained)");
  console.log(`  method bodies: ${report.summary.methodBodiesPinned}/${report.summary.methodBodiesPinned}`);
  console.log(`  byte windows:  ${report.summary.byteWindowsPinned}/${report.summary.byteWindowsPinned}`);
  console.log("  ordinary detail: _useTouchOperation=true, _useGyro=false");
  console.log("  drag: local half-rect normalize, direct acosf, qY*qX");
  console.log("  apply: current*delta, roll=0, quaternion angle clamp=30 degrees");
  for (const item of unproved) console.log(`  UNPROVED ${item.id}: ${item.claim}`);
  console.log("  screenshots: not used");
}

if (failures.length) process.exit(1);
