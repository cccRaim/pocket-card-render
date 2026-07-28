#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CARD_FUTURE_PRODUCER_SCHEMA,
  advanceCardFutureFrame,
  createCardFutureState,
  updateCardFuture,
} from "../public/render/card-future.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCENE = path.join(
  ROOT,
  "public",
  "scene.cPK_20_018280_00_TETSUNOTSUTSUMIex_SR.json",
);
const MANIFEST = path.join(ROOT, "public", "shaders", "card_parallax_future_uniforms.json");

const EXPECTED_SOURCE = {
  sampleId: "ptcgp-1.6.0-unity-2022.3.62f2-proof-r2",
  sampleManifestSha256:
    "6308a8551afa4702c359c26f8506a62fb74774c98b6af09747a4e560af8901e6",
  apkmSha256: "9b7f9067e00a54f342bd4f17e669ceeb86b80bb7d34ff2d0d0fe82050a62f201",
  arm64SplitSha256: "7faf449bae431dcfeda4f882ecb04290af66cc4ccfeefc620e24cac70d22fcec",
  libil2cppSha256: "3e78eedc62770fff4cb129b4b8d898950e131b710b3c099237fe20d2d34ca48e",
};

const EXPECTED_METHODS = {
  get_IsAnimationStopped: [8, "6770a96f4998ce8df43beb8e497cf1a56ff280479bbf45eeb6d10b8b1fe08600"],
  set_IsAnimationStopped: [8, "525490d17fbdb7a82a823d4a82d7829c51d1c751e9080bfb96f9f6a5e95e2c92"],
  Awake: [52, "a1a095644ef5288748c45a6d0550611f69197fe09b6f4df2086754641836bff6"],
  Validate: [620, "f3f8a01f0215a92ee0c94b7ffbcce4ff00dc97475169992239e1c54d51246ea9"],
  UpdateTilt: [760, "6edc4ae62e1e397d73bcdee14d5b4b66eab45606d265d6e3bba3b1691acdcc01"],
  UpdateGoalAnimFrame: [412, "a05ad01f879e666843e8c28c470d4ce288993aa0adf0ffba42ff596a679fc076"],
  InitializeAnimFrame: [16, "ce8ae59ce7bb5eda9f64d187c9e84d1dc85bd763e95d77048376c13c1e07df6e"],
  ApplyParams: [352, "d8a770cebf16036de3adc5fbc63731b6f0526cdc132ccd074e85ed29401b6fa3"],
  LateUpdate: [48, "33618be83af674ff80b9424d19562d59ffcb21d34571fb7dead42dc214089b98"],
  UpdateAnimFrame: [192, "61ed0f2450f9f393058fb137c7f27d0445b6e33c528d0191f410e54d9678a9b5"],
  ".ctor": [172, "87105970c889312194d0ed4f4cdb964ac370b08ed45b9400dad1ac185eb7c0f8"],
  ".cctor": [220, "464116c0259eaeb8e0ef1e42037abab8ac7a85ee6470c101940a98fb41c4b4fe"],
};

const EXPECTED_COMPONENT = {
  bundleByteLength: 895057,
  bundleSha256: "10a8c1c9b48d3028675ff346266d218974feb25ef1213ea60316b95630b6f9dd",
  rawByteLength: 60,
  rawSha256: "e04284a3ddd020f9d3ca60b510c5b12adde65e206e0b2c8a9fef8c60524b7906",
  config: {
    componentIdentity: "CAB-45f133359554b6c323f6c14ab97ef376:3301337077437332915",
    componentGoIdentity: "CAB-45f133359554b6c323f6c14ab97ef376:-4242945921789624909",
    scriptIdentity: "CAB-1e36700dd93ee778e75c5e8df73b6de5:3959991545325558588",
    animationTexFrameCount: 240,
    animationFrameCount: 9,
    animSwitchSpeed: 5,
    animFrameOffset: 39,
    skipAnimThreshold: 4,
    accellRatio: 5,
    isAnimationStopped: 0,
  },
};

function extractEvidence() {
  const runner = process.env.PYTHON || "python";
  const result = spawnSync(runner, ["-B", "build/extract_official_card_future.py"], {
    cwd: ROOT,
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
    shell: process.platform === "win32" && runner === "python",
  });
  if (result.status !== 0) {
    throw new Error(`${result.error || ""}\n${result.stdout || ""}\n${result.stderr || ""}`.trim());
  }
  return JSON.parse(result.stdout.replace(/^\uFEFF/, ""));
}

function floatFromBits(bits) {
  return Buffer.from(bits, "hex").readFloatLE();
}

function floatBits(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeFloatLE(Math.fround(value));
  return buffer.toString("hex");
}

export function auditOfficialCardFuture() {
  const evidence = extractEvidence();
  assert.equal(evidence.schema, "pocket-card-render/official-card-future-evidence@1");
  assert.deepEqual(evidence.source, EXPECTED_SOURCE);
  assert.deepEqual(evidence.rodata, {
    frameEpsilonBits: "17b7d138",
    lightDir2Bits: "0000803f000080bf",
  });
  assert.deepEqual(
    {
      bundleByteLength: evidence.component.bundleByteLength,
      bundleSha256: evidence.component.bundleSha256,
      rawByteLength: evidence.component.rawByteLength,
      rawSha256: evidence.component.rawSha256,
      config: evidence.component.config,
    },
    EXPECTED_COMPONENT,
  );
  assert.deepEqual(Object.keys(evidence.methods).sort(), Object.keys(EXPECTED_METHODS).sort());
  for (const [name, [byteLength, sha256]] of Object.entries(EXPECTED_METHODS)) {
    assert.equal(evidence.methods[name].byteLength, byteLength, `${name} byte length`);
    assert.equal(evidence.methods[name].sha256, sha256, `${name} bytes`);
  }

  const scene = JSON.parse(fs.readFileSync(SCENE, "utf8"));
  const sceneConfig = scene.runtimeSettings?.cardFuture?.[
    EXPECTED_COMPONENT.config.componentIdentity
  ];
  assert.ok(sceneConfig, "Future scene has no CardFutureObject config");
  for (const [field, value] of Object.entries(EXPECTED_COMPONENT.config)) {
    assert.deepEqual(sceneConfig[field], value, `scene CardFutureObject.${field}`);
  }
  assert.equal(
    sceneConfig.componentGoPath,
    "cPK_20_018280_00_TETSUNOTSUTSUMIex_SR_L",
  );
  assert.deepEqual(sceneConfig.rendererBindings, [
    "CAB-45f133359554b6c323f6c14ab97ef376:-5319050326432186957",
  ]);
  const futureDraws = scene.officialDraws.filter(
    (draw) => draw.rendererProperties?.cardFuture,
  );
  assert.equal(futureDraws.length, 1);
  assert.equal(
    futureDraws[0].rendererProperties.cardFuture.componentIdentity,
    sceneConfig.componentIdentity,
  );
  assert.equal(
    futureDraws[0].rendererProperties.cardFuture.rendererIdentity,
    futureDraws[0].rendererIdentity,
  );

  const manifest = JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
  assert.equal(
    manifest.runtime_contract.dynamic_uniforms._AnimFrame.source,
    CARD_FUTURE_PRODUCER_SCHEMA,
  );
  assert.equal(manifest.runtime_boundaries[0].producer, CARD_FUTURE_PRODUCER_SCHEMA);
  assert.equal(manifest.runtime_boundaries[0].status, "runtime-required");

  const mismatches = [];
  for (const sample of evidence.updateAnimFrameSamples) {
    const actual = advanceCardFutureFrame(
      floatFromBits(sample.currentBits),
      sample.goal,
      sceneConfig,
      floatFromBits(sample.deltaTimeBits),
    );
    if (floatBits(actual) !== sample.resultBits) {
      mismatches.push({ ...sample, actualBits: floatBits(actual) });
    }
  }
  assert.equal(evidence.updateAnimFrameSamples.length, 144);
  assert.deepEqual(mismatches, [], "JS UpdateAnimFrame differs from official ARM64");

  const state = createCardFutureState(sceneConfig);
  assert.equal(state.goalAnimFrame, 4);
  assert.equal(state.animFrame, 4);
  const neutral = updateCardFuture(state, {
    threeQuaternion: [0, 0, 0, 1],
    deltaTime: 1 / 60,
  });
  assert.equal(neutral.animFrame, 43);
  assert.equal(neutral.tiltDot, 0);

  return {
    status: "pass",
    exact: {
      selectedOfficialSample: true,
      serializedComponent: true,
      il2cppMethods: `${Object.keys(EXPECTED_METHODS).length}/${Object.keys(EXPECTED_METHODS).length}`,
      arm64UpdateAnimSamples: `${evidence.updateAnimFrameSamples.length}/${evidence.updateAnimFrameSamples.length}`,
      sceneProducerBinding: "1/1",
    },
    runtimeRequired: [
      "official guest transform and MaterialPropertyBlock submission for a captured frame",
      "target Android floating-point/libm behavior outside the sampled UpdateAnimFrame body",
    ],
  };
}

const report = auditOfficialCardFuture();
if (process.argv.includes("--json")) console.log(JSON.stringify(report, null, 2));
else {
  console.log("Official CardFutureObject producer audit: PASS");
  console.log(`  IL2CPP methods:       ${report.exact.il2cppMethods}`);
  console.log(`  ARM64 frame samples:  ${report.exact.arm64UpdateAnimSamples}`);
  console.log(`  scene bindings:       ${report.exact.sceneProducerBinding}`);
}
