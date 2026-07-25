#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateKiraPuyoCurve } from "../public/render/kira-puyo.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCENE = path.join(ROOT, "public", "scene.cPK_20_000010_01_FUSHIGIDANE_S.json");

const EXPECTED_SOURCE = {
  apkmSha256: "9b7f9067e00a54f342bd4f17e669ceeb86b80bb7d34ff2d0d0fe82050a62f201",
  splitSha256: "7faf449bae431dcfeda4f882ecb04290af66cc4ccfeefc620e24cac70d22fcec",
  libil2cppSha256: "3e78eedc62770fff4cb129b4b8d898950e131b710b3c099237fe20d2d34ca48e",
  libunitySha256: "43a04223f94b6ca0c7cf128b399fe0656c57b5a18a10bf21bb9ce27aeb219722",
};

const EXPECTED_METHODS = {
  Awake: [24, "bc841cb532bbbff6def853bd757b2d00366f1c4c22357c12067a594fcf3056ec"],
  LateUpdate: [24, "89957f7fcdc37df3aa75b5bab43161e74e4076f4d821c9423074db8e1758378f"],
  UpdateAnimation: [156, "a2e1dd1b032a2cbec939e484fe0138b61dfc5199ab441a6a589800982dbca68c"],
  UpdateMPB: [444, "94d0fbd0584b6836d5fc1b427b41d507d2ccdfafba8afa9e41d3e49133cd4a84"],
  Constructor: [44, "db3bccd443cf975b813ab36a8db55afeb6b8015b1726044cca5e8eff29486918"],
  StaticConstructor: [316, "2814c19969d27bbca9fab9f43a9e83990b97f0e371b092354fa84aeba566a2d6"],
};

const EXPECTED_UNITY_FUNCTIONS = {
  AnimationCurveEvaluate: [752, "ba82e76ca09dc1fa8fb5e042fd60cc39d5ac20b87ca7c395fd454c9180129f1a"],
  FindKeyframePair: [392, "a90d8550198933a19e604e5c9fa3530bab7035a3a96243de588ddf0bcf680f1a"],
  CacheKeyframePair: [296, "477177abfdbb68c49be3af2f1dacff028dede694df45ec4ae563485e3dfd2ef8"],
  EvaluateSegment: [292, "f9fa6ff00b865449ea0b2e2635a6e0a3151ac1e58c154920f869c455c60241d7"],
  EvaluateWeightedSegment: [244, "ef767657d75e83994b4f0f1b2fde0190fc72191c4009d0e2e55f5f55a463fbfa"],
  SolveBezierTime: [740, "cc301fe0eabee318756cf80b2da9bc2b300f0a3b3c334d2bd0a9bab7578babf3"],
};

const EXPECTED_SETTINGS = new Map([
  ["CAB-b870299d1f9f58958b3ac75a38ef912c:5883008121634607841", "c86f612b465efdaf93c8be10fe2bbb4a3dc5d7956469b39a414d05e6e34aef78"],
  ["CAB-e810183ab21bd6908b026ad371b6945a:4344854913775100460", "6a374bd89c2e80651da4386e21e628c9fa8e6dfa0fd6d8c2f3a806d8539cb753"],
  ["CAB-80ba33aa687a76c32f39a3479f055119:-5661983727547532451", "8c2cec4f343f802d8ccc33505d75dd504db1fefd026e40408c491c46ced6ff2c"],
]);

function extractEvidence() {
  const runner = process.env.PYTHON || "python";
  const result = spawnSync(runner, ["build/extract_official_kira_puyo.py"], {
    cwd: ROOT,
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 32 * 1024 * 1024,
    shell: process.platform === "win32" && runner === "python",
  });
  if (result.status !== 0) throw new Error(`${result.error || ""}\n${result.stdout || ""}\n${result.stderr || ""}`.trim());
  return JSON.parse(result.stdout.replace(/^\uFEFF/, ""));
}

function assertPinnedFunctions(actual, expected, kind) {
  assert.deepEqual(Object.keys(actual).sort(), Object.keys(expected).sort(), `${kind} function set drifted`);
  for (const [name, [size, sha256]] of Object.entries(expected)) {
    assert.equal(actual[name].size, size, `${kind} ${name} size drifted`);
    assert.equal(actual[name].sha256, sha256, `${kind} ${name} bytes drifted`);
  }
}

const floatBuffer = new ArrayBuffer(4);
const floatView = new DataView(floatBuffer);
function floatFromHex(hex) {
  floatView.setUint32(0, Number.parseInt(hex, 16), true);
  return floatView.getFloat32(0, true);
}
function floatHex(value) {
  floatView.setFloat32(0, Math.fround(value), true);
  return floatView.getUint32(0, true).toString(16).padStart(8, "0");
}

export function auditOfficialKiraPuyo() {
  const evidence = extractEvidence();
  assert.equal(evidence.schema, "pocket-card-render/official-kira-puyo-evidence@1");
  for (const [field, expected] of Object.entries(EXPECTED_SOURCE)) {
    assert.equal(evidence.source[field], expected, `official source ${field} drifted`);
  }
  assertPinnedFunctions(evidence.methods, EXPECTED_METHODS, "IL2CPP");
  assertPinnedFunctions(evidence.unityFunctions, EXPECTED_UNITY_FUNCTIONS, "libunity");

  assert.deepEqual(evidence.pltImports, {
    "0x1187360": { got: "0x11d07b0", symbol: "logf" },
    "0x1187380": { got: "0x11d07c0", symbol: "atan2f" },
    "0x1187dd0": { got: "0x11d0ce8", symbol: "cosf" },
    "0x1188100": { got: "0x11d0e80", symbol: "exp" },
  });

  const scene = JSON.parse(fs.readFileSync(SCENE, "utf8"));
  const sceneSettings = scene.runtimeSettings?.kiraPuyo || {};
  assert.equal(evidence.settings.length, EXPECTED_SETTINGS.size);
  assert.deepEqual(Object.keys(sceneSettings).sort(), [...EXPECTED_SETTINGS.keys()].sort());
  for (const setting of evidence.settings) {
    assert.equal(setting.bundleSha256, EXPECTED_SETTINGS.get(setting.identity), `${setting.identity} bundle drifted`);
    assert.deepEqual(sceneSettings[setting.identity], setting.value, `${setting.identity} scene setting is not raw-bundle exact`);
  }

  let sampleCount = 0;
  const mismatches = [];
  for (const setting of evidence.settings) {
    for (const sample of evidence.samples[setting.identity] || []) {
      const actual = floatHex(evaluateKiraPuyoCurve(setting.value.curve, floatFromHex(sample.timeBits)));
      sampleCount += 1;
      if (actual !== sample.valueBits) {
        mismatches.push({ identity: setting.identity, ...sample, actual });
      }
    }
  }
  assert.equal(sampleCount, 790, "official curve corpus size drifted");
  assert.deepEqual(mismatches, [], "local curve evaluator differs from official ARM64 instruction execution");
  assert.deepEqual(evidence.oracle.importCalls, { atan2f: 132, cosf: 396, exp: 1102, logf: 1102 });

  return {
    status: "pass",
    exact: {
      officialSourceIdentity: true,
      serializedSettings: `${evidence.settings.length}/${evidence.settings.length}`,
      arm64InstructionSamples: `${sampleCount}/${sampleCount}`,
      maxUlpOnHostMathOracle: 0,
    },
    runtimeRequired: [
      "target Android bionic logf/atan2f/cosf/exp results",
      "official guest KiraPuyoObject.UpdateMPB arguments for representative Renderer instances",
    ],
  };
}

const report = auditOfficialKiraPuyo();
if (process.argv.includes("--json")) console.log(JSON.stringify(report, null, 2));
else {
  console.log("Official KiraPuyo CPU/AnimationCurve audit: PASS");
  console.log(`  raw settings:       ${report.exact.serializedSettings}`);
  console.log(`  ARM64 samples:      ${report.exact.arm64InstructionSamples} (max host-oracle ULP ${report.exact.maxUlpOnHostMathOracle})`);
  console.log("  target libm/guest MPB remain runtime-required");
}
