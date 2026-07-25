#!/usr/bin/env node
// Screenshot-free byte/hash/semantic audit of official camera, touch, and gyro behavior.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const APP_PATH = path.join(ROOT, "public", "app.js");
const EXTRACTOR = path.join(ROOT, "build", "extract_official_camera_transform.py");
const PYTHON = process.env.PYTHON || "python";
const APKM = path.resolve(process.env.PCR_APKM
  || "D:/DevProjectes/ptcg-apk-parser/apks/jp.pokemon.pokemontcgp_1.6.0.apkm");
const CARD_VIEW_BUNDLE = path.resolve(process.env.PCR_CARD_VIEW_BUNDLE
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
    studioPrefabSha256: "cd50054d1f2a06bc78a58f614a01ec159e5efa83eff0597e76b9ec5d369f3c8f",
    cardViewBundleSha256: "3cada5b88742eaae8d7ce7c44953d7e22962345f2bb5ef4f86e0825231c3cc70",
  },
  methods: {
    gyroGetActive: [8, "143b3c7bd83b0aed91598bc840f9d6c3eed331434f835849cdbe01fd7801fad5"],
    gyroSetActive: [8, "3ab378d7cdbd91d42ee22110e77f1ccc3c53e529536bf9f659c5127a462bd5b2"],
    gyroOnDisable: [36, "45a70f8c2d72675c7278e3cb37bfdd0e3e3be79f8a6758e1494cafaec7e531e6"],
    gyroOnEnable: [36, "edcbacce710af20dcedf1137d86e56d09b2f888448dd49c52a9fc195415ae11a"],
    gyroUpdate: [364, "abec8eea8519e7d84a15e57fda0c33650edfdb007d047009a1455745f1e5bbcf"],
    gyroUpdateBaseRotation: [252, "fb62a88aabd66ac09584b6780147693c05c9584c39265ffd3d99b8e2e46eecc0"],
    gyroUpdateRotationLimit: [440, "5346b286f3be42543dd64dcc0d267b6b056cf2b6722b6dbd07adb967ec11cb09"],
    gyroCtor: [124, "5a98caf2e3bedd5da86462fd90152c2f058afeb5c3dbe8a82328ea33e9f32d68"],
    assetCtor: [276, "543974e3b91b8b57cdf69f03f0008a557aa43f74baadfe1272c935b59d1a949b"],
    createNode: [960, "b0915a2271fb341bc622d2578af77875ab4669a03569c08ff28b72204ba11cf2"],
    setFlipped: [128, "161ea603f097bef4238794cfd6b76918bc9e224a0160c7d69cf3ec9e54604db4"],
    updateCamera: [328, "2eb1d83e5ebc446567f56668ea8dc90d8bcdadca7db79d0cbf38d3e8bc313f45"],
    setupRenderObject: [1364, "1119f77f9b279457fc1a621bb28ecf1a50f5248a4ab0164db37a4d8ebb1546e0"],
    touchOnUpdate: [1008, "c57f13028426f92b63a3db615f8f4673dbf5d9fed8ec928943457da288ff96b0"],
    touchOnDrag: [1396, "b0595881580c5b178f4fd355f099453927c458228cb3cd46524fd770137c4085"],
    uiCardTouch: [360, "16e11fcb386a6a6683e195e829974568a161bbc3fe4a3d0aa5f8ea7ffb2050c8"],
    uiCardCreateRenderer: [236, "6bfe5bd0cc20a873e19f87dc7f3ebd6c80a58b735b17f9f91de4fab8ffee8d38"],
    cardRendererCtor: [224, "f21dc5d97436d8d46e8521149984e5b7f2c4a37abebb7bfc67b51712d8890dc4"],
    cardLoad: [2404, "15ee855211ce89cf101fe884a9ae205bbeddaecb18607ff7d75de96a4186ae6a"],
    rotateGyro: [248, "174f2639a469ae60997c1db1372a3b0491d33e7df36d08ec904b3cd9f196f274"],
    calcHomography: [432, "fc1463b7d34a6bd728470522b9c369dd9125dd9c1fe0f7e4885f4422482c55e0"],
    getRotatedKeyPoints: [272, "3dd9a748dd530c7e08e05009de0f44730f4d2662d6df1b926d4a1563bc8374e1"],
    applyClampedRotation: [848, "ae0b3f711d45d7875a54e05fe30dae644f363692702c1a149aea4ebc21b4537f"],
    updateStudioRotation: [168, "65757be3a4aebe44d6830c06dbffe978f7bef820d47242190cb27d7f38405fd1"],
    setHomography: [132, "6253248b683371c6aa0c8d9fa86defcea562f273a717e8cbf6f658a6b1e57719"],
  },
  windows: {
    useGyroRead: [36, "3e46ee9f4fee7921c53489850812b9271dab013ebf01aee7b14ec8570fd5ada4"],
    useGyroPass: [24, "8440141c66493704a7d759bb4cc7bc05e2cfcdb17364e97eb1ebaace79550d32"],
    loadedAssetResult: [36, "d758bcf361da76abeb347719ab342702275c488efccb86b90c3c265e7e605a90"],
    gyroGateAndAddComponent: [96, "673cf784cbfd26e08d832195a7d4923eb91ec3d4f53941eb730e7ff83d688b95"],
    deltaTimesCurrentQuaternion: [152, "32fbbdfaf09c94a6592382d986c0ceb2c27d3853bf61df2244aa32f030c20ca5"],
    stationaryReturn: [208, "0458affc071bcd13efde52e154519cfd7243ea7e1b24f5fb0902fad68a7530b1"],
    eulerLimit: [364, "5ad69ed6cd06a92be4f8ad3228559084a7d2fe45fc64e6b946b88bcd525f4b9f"],
    constructorDefaults: [48, "1fbc97a1088cfcec7466676cd5bba799c66bfabe7ace1ff5852d5d68c8ec0e24"],
    onDisableEnable: [72, "dd56217ba756acb38b8128ed9582a141abae02384f888987bbeba9337ebc79ac"],
    lateUpdateOutput: [212, "0dfc9bc5c7199ab8e6476578c90032dd5d43a4607c92eff930bd0a7527609472"],
    touchRootResolve: [44, "21fa2e35b88014d58ddbacdb9ccab5c27e62e8c5206d879b52d57bc4bc151813"],
    touchRootWrite: [28, "bf410a8886326de9776685005d853d0d1c865d4578f924275f2e58f960da1da7"],
    keepParallaxRotationChain: [104, "b2fbbe8da66de1e7abe0cfc39475bf595463f7a61ff5980d791a2b0ee2ed50ca"],
  },
  metadataTables: {
    methods: [260487, 36, "0c03d871175feb89c909671567b31bb25f2096e0060149ddec9e6241f54ba7ba"],
    fields: [165806, 12, "d2c07ede284b2fb1abdc0f5a8810327b27c5ff8d60bfdbe61e9cbb0144913fdd"],
    types: [43110, 88, "9f6f45662d5ee06fe73a2fcfed8e317aa8c3076f3bac9ee03c05d1be47d9aaf3"],
  },
  metadataTypes: {
    gyroManager: [39683, "2d3c0332c16c136a6b1afbc1c9b027fc1f6407303bb2cf2262cac101717c6dd5"],
    rotateGyro: [39685, "c7a5bdfce42e9b2891db244add8ceac0bc7b9b6f3b3ed5fb1bccb4034771b410"],
    asset3DRenderer: [39701, "2e5e146e73e7aaacc6e7a1a975627db37834f17c3c39ec01f1770108015eb0e2"],
    touchController: [39687, "d8905c4eff4e285224b4c72a3527d09f351d8c326f7def05e6bc151d7d95342e"],
    touchStateRotation: [39693, "e1245b36c1923dc1754a006764bcdd8e8a6d4448987c84106e7b0d200659ef9b"],
    uiCardView: [29442, "23699c0ae184645e8af828e2355714eb4ebb420d64f91bc5c60bd191750e1165"],
    cardRenderer: [29470, "08a14f5f6f42c927cd5e3221ac81e11272f34e5e5e8a6e23d0a5a933b36a259c"],
    modelRenderStudio: [39736, "4928ac6c90913b0b1b6f4e9fe0487ea98ba3ba1aa0c10b9b1168485de63da57b"],
    keepParallaxCardBehaviour: [29336, "0029abc85e887c2584f2f7a0f1e6bd77ef682af2219243a97e97702ddc85a8c9"],
  },
  criticalInstructions: {
    "0x438dcd8": ["bl #0x656bc04", "cb778794"],
    "0x443d920": ["ldrb w23, [x19, #0x15c]", "77724539"],
    "0x443da18": ["bl #0x43956fc", "395ffd97"],
    "0x43964e0": ["ldrb w8, [x20, #0x70]", "88c24139"],
    "0x439653c": ["bl #0x3228874", "ce48ba97"],
    "0x4399350": ["b #0x652cddc", "a34e8614"],
    "0x441c45c": ["bl #0x4399008", "ebf2fd97"],
    "0x441c46c": ["b #0x441c474", "02000014"],
  },
  keyMethodRvas: {
    gyroUpdate: ["0x438dc98", "0x438de04"],
    gyroUpdateBaseRotation: ["0x438de04", "0x438df00"],
    gyroUpdateRotationLimit: ["0x438df00", "0x438e0b8"],
    gyroCtor: ["0x438e0b8", "0x438e134"],
    rotateGyro: ["0x438e134", "0x438e22c"],
    applyClampedRotation: ["0x4399008", "0x4399358"],
    updateStudioRotation: ["0x441c3cc", "0x441c474"],
  },
};

function runExtractor() {
  const result = spawnSync(PYTHON, [
    EXTRACTOR,
    "--apkm", APKM,
    "--card-view-bundle", CARD_VIEW_BUNDLE,
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

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function sha256Hex(bytesHex) {
  return createHash("sha256").update(Buffer.from(bytesHex, "hex")).digest("hex");
}

const checks = [];
const failures = [];
function check(category, label, condition, evidence = undefined) {
  const row = { category, label, status: condition ? "proved" : "failed" };
  if (evidence !== undefined) row.evidence = evidence;
  checks.push(row);
  if (!condition) failures.push(`${category}: ${label}`);
}

let official;
try {
  official = runExtractor();
} catch (error) {
  console.error(`BAD official camera/gyro extractor failed: ${error.message}`);
  process.exit(1);
}

const facts = official.official || {};
const gyro = facts.gyro || {};
const definitions = official.globalMetadata?.definitions || {};

check("source", "schemaVersion is 2", official.schemaVersion === 2);
for (const [key, expected] of Object.entries(EXPECTED.source)) {
  const actual = {
    apkmSha256: official.source?.apkmSha256,
    baseApkSha256: official.source?.baseApkSha256,
    arm64SplitSha256: official.source?.arm64SplitSha256,
    libil2cppSha256: official.source?.libil2cppSha256,
    metadataEncryptedSha256: official.source?.metadata?.encryptedSha256,
    metadataPlaintextSha256: official.source?.metadata?.plaintextSha256,
    studioPrefabSha256: facts.camera?.serializedPrefab?.resourceSha256,
    cardViewBundleSha256: official.source?.ordinaryCardViewBundle?.sha256,
  }[key];
  check("source", `${key} is pinned`, actual === expected, actual);
}

for (const [key, [count, recordSize, hash]] of Object.entries(EXPECTED.metadataTables)) {
  const actual = definitions.tables?.[key];
  check("metadata", `${key} table count/record/hash`, actual?.count === count
    && actual?.recordSize === recordSize && actual?.sha256 === hash, actual);
}
for (const [key, [index, hash]] of Object.entries(EXPECTED.metadataTypes)) {
  const actual = definitions.types?.[key];
  check("metadata", `${key} type record`, actual?.typeDefinitionIndex === index
    && actual?.record?.sha256 === hash
    && sha256Hex(actual?.record?.bytesHex || "") === hash, actual?.record);
}

for (const [key, [size, hash]] of Object.entries(EXPECTED.methods)) {
  const actual = facts.nativeMethods?.[key];
  check("native-methods", `${key} body`, actual?.byteSize === size && actual?.sha256 === hash, actual);
}
for (const [key, [start, end]] of Object.entries(EXPECTED.keyMethodRvas)) {
  const actual = facts.nativeMethods?.[key];
  check("native-methods", `${key} RVA range`, actual?.rvaStart === start
    && actual?.rvaEnd === end, actual);
}
for (const [key, [size, hash]] of Object.entries(EXPECTED.windows)) {
  const actual = gyro.byteWindows?.[key];
  check("byte-windows", `${key} bytes/hash`, actual?.byteSize === size
    && actual?.sha256 === hash
    && sha256Hex(actual?.bytesHex || "") === hash, actual);
}

const selectedInstructions = Object.values(facts.nativeMethods || {})
  .flatMap((method) => method.selectedInstructions || []);
for (const [address, [text, bytesHex]] of Object.entries(EXPECTED.criticalInstructions)) {
  const matches = selectedInstructions.filter((item) => item.address === address);
  check("instructions", `${address} ${text}`, matches.length === 1
    && matches[0].text === text
    && matches[0].bytesHex === bytesHex
    && sha256Hex(bytesHex) === matches[0].sha256, matches[0]);
}

const constants = gyro.defaults?.constructorConstants || {};
check("defaults", "rotationPower/max constant bytes", constants.rotationPowerAndMax?.bytesHex
  === "3333b33e0000f0410000f04100000000"
  && constants.rotationPowerAndMax?.sha256
  === "b7d166a2c8a1fd5f30b7500da84ae0407478f71833c34fd03f40feabdff9ce1a");
check("defaults", "threshold/timeStep constant bytes", constants.thresholdAndTimeStep?.bytesHex
  === "0000003f6f12033a"
  && constants.thresholdAndTimeStep?.sha256
  === "6da29696be94c2cbac75b3aeaa5b40524b12857b0384eb451c33bdd43dcd11d8");
check("defaults", "waitingTime MOV/MOVK value", constants.waitingTime?.bitsHex === "0x3e99999a"
  && constants.waitingTime?.valueBytesHex === "9a99993e"
  && constants.waitingTime?.valueSha256
  === "45a6d738a7607576d3fe0862200bc67b10c12d5ed74167b4d5d5a708974c0f32");
check("defaults", "GyroManager defaults", gyro.defaults?.active === false
  && gyro.defaults?.axialMovementRestriction === false
  && Object.is(gyro.defaults?.radius, 0)
  && gyro.defaults?.rotationPower === Math.fround(0.35)
  && JSON.stringify(gyro.defaults?.maxRotationAngleDegrees) === JSON.stringify([30, 30, 0])
  && gyro.defaults?.angularVelocityThreshold === Math.fround(0.5)
  && gyro.defaults?.timeStep === Math.fround(0.0005)
  && gyro.defaults?.waitingTime === Math.fround(0.3));

check("camera", "official Camera local -Z, distance 1.911506, FOV 35", facts.camera?.status === "proved"
  && Math.abs(facts.camera.distance.values[0] - 1.911506) < 1e-6
  && facts.camera.fieldOfViewDegrees === 35
  && Math.abs(facts.camera.localPosition[2] + facts.camera.distance.values[0]) < 1e-9);
check("camera", "SetFlipped(false) parent Ry(180)", facts.parentFace?.status === "proved"
  && facts.parentFace.setFlippedArgument === false
  && JSON.stringify(facts.parentFace.parentLocalEulerDegrees) === JSON.stringify([0, 180, 0]));
check("camera", "card camera selects only UICardViewRenderer layer 21", facts.layer?.status === "proved"
  && facts.layer.index === 21 && facts.layer.bit === 0x00200000
  && facts.layer.cameraCullingMask === 0x00200000);
const studioHierarchy = Object.fromEntries(
  (facts.camera?.serializedPrefab?.hierarchy || []).map((item) => [item.gameObject, item]),
);
const keyPointPosition = (name, expected) => {
  const point = studioHierarchy[name];
  return point?.parentTransformPathId === studioHierarchy.KeyPoints?.transformPathId
    && point.localPosition.every((value, index) => Math.abs(value - expected[index]) < 1e-7);
};
check("camera", "serialized Homography keypoint square and order are pinned",
  JSON.stringify(studioHierarchy.KeyPoints?.localRotation) === JSON.stringify([0, 1, 0, 0])
  && keyPointPosition("LeftDown", [0.6029999852180481, -0.6029999852180481, 0])
  && keyPointPosition("RightDown", [-0.6029999852180481, -0.6029999852180481, 0])
  && keyPointPosition("LeftUp", [0.6029999852180481, 0.6029999852180481, 0])
  && keyPointPosition("RightUp", [-0.6029999852180481, 0.6029999852180481, 0]));
check("touch", "touch qY*qX clamp and root target", facts.touch?.status === "proved"
  && facts.touch.composition === "qY * qX"
  && facts.touch.maxRotationDegrees === 30
  && facts.touch.target === "ITouchStateMachineController.Root / Asset3DRenderer.root"
  && facts.touch.targetInterfaceMethod === "ITouchStateMachineController.get_Root");

const keepParallax = facts.homography?.keepParallaxTransform || {};
check("homography-transform", "KeepParallax uses one render-object rotation before homography upload",
  keepParallax.status === "proved"
  && keepParallax.frameGate === "one update per Time.frameCount value"
  && keepParallax.sourceTransform === "KeepParallaxCardBehaviour.transform"
  && keepParallax.cameraTransform === "KeepParallaxCardBehaviour._renderingCamera.transform"
  && keepParallax.maxRotationField === "KeepParallaxCardBehaviour._maxRotationDegree at +0x20"
  && keepParallax.application
    === "ModelRenderStudio.ApplyClampedRotation writes one _renderObject.transform.localRotation"
  && keepParallax.homographyKeypointSource
    === "ModelRenderStudio serialized _keyPoint* transforms under KeyPoints/Root"
  && keepParallax.homographyKeypointDependency
    === "GetRotatedKeyPoints reads _keyPoint* world positions and _camera only; it does not read _renderObject.localRotation"
  && /Euler z is cleared before quaternion-angle clamp/.test(keepParallax.rotationRule || "")
  && JSON.stringify(keepParallax.order)
    === JSON.stringify(["ApplyClampedRotation", "SetHomographyParameters"]));
check("homography-transform", "KeepParallax native object chain offsets are pinned",
  JSON.stringify(keepParallax.fieldOffsets) === JSON.stringify({
    initialized: "0x38",
    faceGameObject: "0x28",
    rotationUpdateTimeStamp: "0x4c",
    renderingCamera: "0x50",
    cardRendererOnModelCardView: "0x38",
    renderStudioOnAsset3DRenderer: "0x48",
    renderObjectOnModelRenderStudio: "0x60",
  })
  && keepParallax.byteWindow?.sha256 === EXPECTED.windows.keepParallaxRotationChain[1]);

const expectedUseGyroPath = ["0x443d920", "0x443da18", "0x43964e0", "0x439653c"];
check("gyro-semantics", "gyro core is proved", gyro.status === "proved");
check("gyro-semantics", "rotationRateUnbiased call is pinned", gyro.input?.sample
  === "Input.gyro.rotationRateUnbiased" && gyro.input?.sampleCallRva === "0x438dcd8"
  && gyro.input?.sampleCallTargetRva === "0x656bc04"
  && JSON.stringify(gyro.input?.axesUsed) === JSON.stringify(["x", "y"])
  && gyro.input?.zIgnored === true);
check("gyro-semantics", "state machine composes dq*q", gyro.stateMachine?.composition === "dq * q"
  && gyro.stateMachine?.deltaQuaternion
  === "Quaternion.Euler(-x * rotationPower, -y * rotationPower, 0)"
  && /no deltaTime multiplier/.test(gyro.stateMachine?.integrationClock || ""));
check("gyro-semantics", "stationary return uses scaled wait and per-update step",
  gyro.stateMachine?.stationaryReturn?.stationaryCondition
    === "abs(x) < threshold && abs(y) < threshold"
  && gyro.stateMachine?.stationaryReturn?.waitingAccumulator
    === "currentWaitingTime += Time.deltaTime"
  && gyro.stateMachine?.stationaryReturn?.waitingClock === "scaled Time.deltaTime"
  && gyro.stateMachine?.stationaryReturn?.step
    === "timeCount = clamp01(timeCount + timeStep)"
  && /no deltaTime multiplier/.test(gyro.stateMachine?.stationaryReturn?.stepClock || ""));
check("gyro-semantics", "Euler axial restriction/clamp/roll are pinned",
  gyro.stateMachine?.rotationLimit?.space === "signed Euler degrees"
  && /dominant abs axis exceeds radius/.test(gyro.stateMachine?.rotationLimit?.axialRestriction || "")
  && gyro.stateMachine?.rotationLimit?.clamp === "x to +/-max.x; y to +/-max.y"
  && gyro.stateMachine?.rotationLimit?.rollDegrees === 0
  && gyro.stateMachine?.rotationLimit?.maxZStoredButUnused === true);
check("gyro-semantics", "LateUpdate reverses X, preserves Y, clears roll",
  JSON.stringify(gyro.lateUpdateOutput?.eulerMapping) === JSON.stringify(["-X", "+Y", "0"])
  && gyro.lateUpdateOutput?.xSign === "reversed"
  && gyro.lateUpdateOutput?.ySign === "preserved"
  && gyro.lateUpdateOutput?.rollDegrees === 0);
check("gyro-semantics", "touch root is above gyro loaded-asset target",
  gyro.placement?.touchTarget === "Asset3DRenderer.root"
  && gyro.placement?.gyroTarget === "loaded card asset"
  && JSON.stringify(gyro.placement?.useGyroPath?.map((item) => item.rva))
    === JSON.stringify(expectedUseGyroPath)
  && gyro.placement?.sameFrameCompositionOrder === "unproved");

const detail = gyro.ordinaryDetailView || {};
check("ordinary-detail", "precise CommonUICardDetailCard bundle/object is pinned",
  detail.bundleByteSize === 7868
  && detail.bundleSha256 === EXPECTED.source.cardViewBundleSha256
  && detail.container
    === "Assets/Lettuce/_Data/Common/UI/Prefabs/Common/CommonUICardDetailCard.prefab"
  && detail.componentPathId === "-2600777029953942905"
  && detail.componentRawByteSize === 124
  && detail.componentRawSha256
    === "358807c75edeb46834cf4686b686e4874f44bf5ca31f612544b5a7870d9fbec6"
  && detail.gameObjectPathId === "7108130666142665351"
  && detail.gameObjectName === "card_img"
  && detail.cardSize === 6);
check("ordinary-detail", "ordinary detail _useGyro raw gate is false",
  detail.field?.name === "_useGyro" && detail.field?.value === false
  && detail.field?.rawByteOffset === 100 && detail.field?.rawByteSize === 4
  && detail.field?.bytesHex === "00000000"
  && detail.field?.sha256
    === "df3f619804a92fdb4057192dc43dd748ea778adc52bc498ce80524c014b81119"
  && gyro.policy?.ordinaryCardGyroDefault === "disabled"
  && gyro.policy?.pinnedDetailViewGate === false);

const gyroManagerMetadata = definitions.types?.gyroManager;
check("pause-timeScale", "OnDisable/OnEnable toggle Unity Input.gyro",
  gyro.pauseAndTimeScale?.onDisable === "Input.gyro.enabled = false"
  && gyro.pauseAndTimeScale?.onEnable === "Input.gyro.enabled = true");
check("pause-timeScale", "timeScale-sensitive and frame-based clocks stay distinct",
  gyro.pauseAndTimeScale?.stationaryWaitClock === "scaled Time.deltaTime"
  && /not scaled by deltaTime/.test(gyro.pauseAndTimeScale?.integrationClock || "")
  && /not scaled by deltaTime/.test(gyro.pauseAndTimeScale?.returnStepClock || "")
  && gyro.pauseAndTimeScale?.onApplicationPauseMethodPresent === false
  && !gyroManagerMetadata?.methodNames?.includes("OnApplicationPause"));

const unprovedIds = gyro.unproved?.map((item) => item.id).sort() || [];
const expectedUnprovedIds = [
  "active-enable-origin",
  "same-frame-touch-gyro-order",
  "unity-android-sensor-backend",
].sort();
check("proof-boundary", "three required unknowns remain explicitly unproved",
  JSON.stringify(unprovedIds) === JSON.stringify(expectedUnprovedIds)
  && gyro.unproved.every((item) => item.status === "unproved"));

function inspectRuntimeTransformOwnership(source) {
  const facts = {
    sharedRenderObject: /window\.__tilt\s*=\s*assetRoot\s*;/.test(source)
      && /if\s*\(window\.__tilt\)\s*window\.__tilt\.quaternion\.copy\(targetQ\)\s*;/.test(source),
    studioKeypointProjection: /point\.clone\(\)\.project\(camera\)/.test(source),
    noRenderObjectPoseInKeypoints:
      !/point\.clone\(\)\.applyMatrix4\(assetRoot\.matrixWorld\)\.project\(camera\)/.test(source),
    keypointSpaceIsDeclared: /homographyKeypointSpace:\s*"ModelRenderStudio\.Root"/.test(source),
    hierarchyMatchesContract: /parentRoot\.add\(cardGroup\)\s*;/.test(source)
      && /assetRoot\.add\(rotationRoot\)\s*;/.test(source),
    noPerLayerPose: !/dbgLayers[^;]*(?:rotation|quaternion)/.test(source),
  };
  return {
    facts,
    pass: Object.values(facts).every(Boolean),
  };
}

const runtime = stripComments(fs.readFileSync(APP_PATH, "utf8"));
check("runtime", "public/app.js retains official camera transform",
  /cardDisplayContract\.camera\.field_of_view_degrees/.test(runtime)
  && /cardDisplayContract\.camera\.aspect/.test(runtime)
  && /const\s+cameraPosition\s*=\s*cardDisplayContract\.camera\.local_position/.test(runtime)
  && /camera\.position\.set\(cameraPosition\[0\],\s*cameraPosition\[1\],\s*-cameraPosition\[2\]\)/.test(runtime)
  && /parentRoot\.rotation\.y\s*=\s*Math\.PI\s*;/.test(runtime)
  && /camera\.layers\.set\(21\)\s*;/.test(runtime)
  && !/cardDisplay\.mesh\.quaternion\.copy\(targetQ\)/.test(runtime));
const transformOwnership = inspectRuntimeTransformOwnership(runtime);
check("runtime", "draw layers share one render-object tilt while homography keeps the studio keypoint space",
  transformOwnership.pass);

const duplicatedPoseMutation = runtime.replace(
  "point.clone().project(camera)",
  "point.clone().applyMatrix4(assetRoot.matrixWorld).project(camera)",
);
const mutatedOwnership = inspectRuntimeTransformOwnership(duplicatedPoseMutation);
check("audit-self-test", "duplicate render-object pose in homography is rejected",
  duplicatedPoseMutation !== runtime
  && !mutatedOwnership.pass
  && mutatedOwnership.facts.sharedRenderObject
  && mutatedOwnership.facts.studioKeypointProjection === false
  && mutatedOwnership.facts.noRenderObjectPoseInKeypoints === false);
check("runtime", "ordinary browser card does not activate gyro without serialized true evidence",
  !/DeviceOrientationEvent|\bGyroscope\b|rotationRateUnbiased|navigator\.permissions[^;]*gyroscope|RotateGyro/.test(runtime));

const report = {
  status: failures.length ? "failed" : "passed-with-explicit-unproved",
  screenshotUsed: false,
  source: {
    apkm: official.source?.apkm,
    apkmSha256: official.source?.apkmSha256,
    libil2cppSha256: official.source?.libil2cppSha256,
    metadataSha256: official.source?.metadata?.plaintextSha256,
    ordinaryCardViewBundle: detail.bundlePath,
    ordinaryCardViewBundleSha256: detail.bundleSha256,
    ordinaryCardViewObjectSha256: detail.componentRawSha256,
  },
  summary: {
    checks: checks.length,
    proved: checks.filter((row) => row.status === "proved").length,
    failed: failures.length,
    nativeMethodsPinned: Object.keys(EXPECTED.methods).length,
    byteWindowsPinned: Object.keys(EXPECTED.windows).length,
    metadataTypesPinned: Object.keys(EXPECTED.metadataTypes).length,
  },
  checks,
  unproved: gyro.unproved,
  failures,
};

if (JSON_MODE) {
  console.log(JSON.stringify(report, null, 2));
} else if (failures.length) {
  console.error(`Official camera/gyro transform audit FAILED (${failures.length} mismatch(es))`);
  for (const failure of failures) console.error(`BAD ${failure}`);
} else {
  console.log("Official camera/gyro transform audit OK (required proof boundaries retained)");
  console.log(`  package/source hashes: ${Object.keys(EXPECTED.source).length}/${Object.keys(EXPECTED.source).length}`);
  console.log(`  native method bodies: ${report.summary.nativeMethodsPinned}/${report.summary.nativeMethodsPinned}`);
  console.log(`  algorithm byte windows: ${report.summary.byteWindowsPinned}/${report.summary.byteWindowsPinned}`);
  console.log(`  metadata type records: ${report.summary.metadataTypesPinned}/${report.summary.metadataTypesPinned}`);
  console.log(`  ordinary detail: _cardSize=${detail.cardSize}, _useGyro=${detail.field.value}, object ${detail.componentRawSha256}`);
  for (const item of gyro.unproved) console.log(`  UNPROVED ${item.id}: ${item.claim}`);
  console.log("  screenshots: not used");
}

if (failures.length) process.exit(1);
