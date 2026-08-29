#!/usr/bin/env node
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  loadOfficialSample,
  officialSampleDigest,
} from "./official-sample.mjs";
import { atomicWriteFileSync } from "./atomic-publish.mjs";
import {
  probeCandidateGuestVulkanCapture,
} from "./probe-candidate-guest-vulkan-capture.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_CANDIDATE = "build/official-samples/candidate.json";
const SCHEMA =
  "pocket-card-render/candidate-guest-platform-blocker@1";
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

function digest(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function canonicalDigest(value) {
  return digest(Buffer.from(JSON.stringify(canonicalize(value))));
}

function fileIdentity(filename) {
  const bytes = fs.readFileSync(filename);
  return {
    byteLength: bytes.length,
    sha256: digest(bytes),
  };
}

function parseArgs(argv) {
  const args = {
    candidateManifest:
      process.env.PCR_OFFICIAL_CANDIDATE_MANIFEST || DEFAULT_CANDIDATE,
    tombstone: process.env.PCR_CANDIDATE_GUEST_TOMBSTONE || null,
    adb: process.env.ADB,
    serial: process.env.ANDROID_SERIAL || null,
    output: null,
    check:
      process.env.PCR_CANDIDATE_GUEST_PLATFORM_BLOCKER_CHECK === "1",
    selfTest:
      process.env.PCR_CANDIDATE_GUEST_PLATFORM_BLOCKER_SELF_TEST === "1",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--candidate-manifest") {
      args.candidateManifest = argv[++index];
    } else if (value === "--tombstone") {
      args.tombstone = argv[++index];
    } else if (value === "--adb") {
      args.adb = argv[++index];
    } else if (value === "--serial") {
      args.serial = argv[++index];
    } else if (value === "--output") {
      args.output = argv[++index];
    } else if (value === "--check") {
      args.check = true;
    } else if (value === "--self-test") {
      args.selfTest = true;
    } else {
      throw new Error(`unknown argument: ${value}`);
    }
  }
  return args;
}

export function parseGuestCrashTombstone(source) {
  const processMatch = source.match(
    /^pid:\s*(\d+),\s*tid:\s*(\d+),\s*name:\s*(.*?)\s*>>>\s*(.*?)\s*<<</m,
  );
  const signalMatch = source.match(
    /^signal\s+(\d+)\s+\(([^)]+)\),\s*code\s+(\d+)\s+\(([^)]+)\),\s*fault addr\s+(\S+)/m,
  );
  const backtraceMatch = source.match(
    /^backtrace:\r?\n((?:\s+#\d+.*(?:\r?\n|$))+)/m,
  );
  const backtrace = backtraceMatch?.[1]
    ?.split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean) || [];
  const modules = [...new Set(
    backtrace
      .map((line) => line.match(/\s(\/\S+?\.so)(?:\s|$)/)?.[1] || null)
      .filter(Boolean),
  )];
  const libunityBuildIds = [...new Set(
    [...source.matchAll(
      /\/libunity\.so \(BuildId:\s*([0-9a-f]+)\)/gi,
    )].map((match) => match[1].toLowerCase()),
  )];
  return {
    buildFingerprint:
      source.match(/^Build fingerprint:\s*'([^']+)'/m)?.[1] || null,
    processAbi: source.match(/^ABI:\s*'?([^'\s]+)'?/m)?.[1] || null,
    pid: Number(processMatch?.[1] || 0) || null,
    tid: Number(processMatch?.[2] || 0) || null,
    threadName: processMatch?.[3]?.trim() || null,
    packageName: processMatch?.[4]?.trim() || null,
    signalNumber: Number(signalMatch?.[1] || 0) || null,
    signalName: signalMatch?.[2] || null,
    signalCode: Number(signalMatch?.[3] || 0) || null,
    signalCodeName: signalMatch?.[4] || null,
    faultAddress: signalMatch?.[5] || null,
    backtrace,
    backtraceModules: modules,
    nativeBridgeModule:
      modules.find((value) => /\/libhoudini\.so$/i.test(value))
      || modules.find((value) => /ndk_translation/i.test(value))
      || null,
    libunityBuildIds,
    gfxreconstructMapped:
      /libVkLayer_gfxreconstruct\.so/.test(source),
  };
}

function selectCrashLogEvidence(source, unityVersion, packageName) {
  const lines = source
    .split(/\r?\n/)
    .filter((line) => (
      (
        line.includes(packageName)
        && /ActivityManager: START|ApplicationInfo|Process .* has died/.test(line)
      )
      || line.includes(`Version '${unityVersion}`)
      || /\bCRASH\s+:/.test(line)
      || /vulkan config = \[true\]|searching for layers in/.test(line)
    ));
  return {
    sourceSha256: digest(Buffer.from(source)),
    selectedLines: lines.slice(-96),
    candidateUnityVersionObserved:
      source.includes(`Version '${unityVersion}`),
    candidatePackageObserved: source.includes(packageName),
    vulkanInitializationObserved:
      /vulkan config = \[true\]/.test(source),
    sigsegvObserved:
      /signal 11 \(SIGSEGV\)/.test(source),
    tokioRuntimeThreadObserved:
      /tokio-runtime-w/.test(source),
    gfxreconstructInitializationObserved:
      /Initializing GFXReconstruct capture layer/.test(source),
  };
}

function outputPathFor(sample) {
  const stem = sample.sampleId.replace(/-candidate$/, "");
  return path.join(
    ROOT,
    "build",
    "official-samples",
    `${stem}-guest-platform-blocker.json`,
  );
}

function validateReport(report, sample, sampleManifestSha256) {
  assert.equal(report.schema, SCHEMA);
  assert.equal(report.schemaVersion, 1);
  assert.equal(report.candidate.sampleId, sample.sampleId);
  assert.equal(
    report.candidate.sampleManifestSha256,
    sampleManifestSha256,
  );
  assert.equal(report.candidate.gameVersion, sample.game.versionName);
  assert.equal(
    report.candidate.unityVersion,
    sample.unity.serializedVersion,
  );
  assert.equal(report.status, "tested-platform-blocked");
  assert.equal(report.scope.closesOfficialGuestRuntime, false);
  assert.equal(report.scope.fidelityContribution, 0);
  assert.equal(report.scope.officialShaderRestorationPercent, null);
  assert.equal(report.installedPackage.nativeIdentityMatchesCandidate, true);
  assert.equal(
    report.installedPackage.libunitySha256,
    sample.artifacts.libunity.sha256,
  );
  assert.equal(
    report.installedPackage.libil2cppSha256,
    sample.artifacts.libil2cpp.sha256,
  );
  assert.equal(report.crash.packageName, sample.game.packageName);
  assert.equal(report.crash.signalName, "SIGSEGV");
  assert.match(report.crash.nativeBridgeModule, /libhoudini\.so$/);
  assert.equal(report.crash.gfxreconstructMapped, false);
  assert.equal(report.platform.externalLayerEligible, false);
  assert.equal(report.platform.buildType, "user");
  assert.equal(report.platform.targetDebuggable, false);
  assert.equal(report.platform.targetInjectLayersEnabled, false);
  assert(Array.isArray(report.limitations) && report.limitations.length >= 3);
  assert(SHA256_PATTERN.test(report.source.tombstone.sha256));
  assert(SHA256_PATTERN.test(report.source.logcat.sha256));
  const { proofSha256, ...proofPayload } = report;
  assert.equal(proofSha256, canonicalDigest(proofPayload));
  return report;
}

function buildReport({
  candidateManifest,
  tombstone,
  adb,
  serial,
}) {
  assert(tombstone, "--tombstone is required when building evidence");
  const tombstonePath = path.resolve(ROOT, tombstone);
  assert(fs.statSync(tombstonePath, { throwIfNoEntry: false })?.isFile(),
    `tombstone is absent: ${tombstone}`);
  const loaded = loadOfficialSample(candidateManifest);
  const sample = loaded.sample;
  assert.equal(sample.status, "candidate");
  const sampleManifestSha256 = officialSampleDigest(sample);
  const probe = probeCandidateGuestVulkanCapture({
    candidateManifest,
    ...(adb ? { adb } : {}),
    serial,
  });
  assert(probe.adb.selectedSerial, "an online ADB device is required");
  assert.equal(probe.target?.installed, true);
  assert.equal(probe.target.versionName, sample.game.versionName);
  assert.equal(probe.target.versionCode, sample.game.versionCode);
  assert.equal(probe.target.nativeIdentityMatchesCandidate, true);
  const tombstoneSource = fs.readFileSync(tombstonePath, "utf8");
  const crash = parseGuestCrashTombstone(tombstoneSource);
  assert.equal(crash.packageName, sample.game.packageName);
  assert.equal(crash.buildFingerprint, probe.device.buildFingerprint);
  assert.equal(crash.signalName, "SIGSEGV");
  assert.match(crash.nativeBridgeModule || "", /libhoudini\.so$/);
  assert.equal(crash.gfxreconstructMapped, false);

  const logcatResult = spawnSync(
    probe.adb.executable,
    [
      ...(probe.adb.selectedSerial
        ? ["-s", probe.adb.selectedSerial]
        : []),
      "logcat",
      "-d",
      "-v",
      "threadtime",
    ],
    {
      cwd: ROOT,
      encoding: "utf8",
      windowsHide: true,
      maxBuffer: 32 * 1024 * 1024,
    },
  );
  assert.equal(logcatResult.status, 0, "failed to read candidate logcat");
  const logcatSource = logcatResult.stdout || "";
  const logcat = selectCrashLogEvidence(
    logcatSource,
    sample.unity.serializedVersion,
    sample.game.packageName,
  );
  assert.equal(logcat.candidateUnityVersionObserved, true);
  assert.equal(logcat.candidatePackageObserved, true);
  assert.equal(logcat.vulkanInitializationObserved, true);
  assert.equal(logcat.sigsegvObserved, true);
  assert.equal(logcat.gfxreconstructInitializationObserved, false);

  const serialHash = digest(Buffer.from(probe.device.serial));
  const report = {
    schema: SCHEMA,
    schemaVersion: 1,
    status: "tested-platform-blocked",
    candidate: {
      selection: loaded.selectionRelative,
      manifest: loaded.manifestRelative,
      sampleId: sample.sampleId,
      sampleManifestSha256,
      packageName: sample.game.packageName,
      gameVersion: sample.game.versionName,
      versionCode: sample.game.versionCode,
      architecture: sample.game.architecture,
      unityVersion: sample.unity.serializedVersion,
    },
    platform: {
      kind: "BlueStacks-ARM-native-bridge",
      serialHashSha256: serialHash,
      androidSdk: Number(probe.device.sdk),
      buildFingerprint: probe.device.buildFingerprint,
      buildType: probe.device.buildType,
      productAbi: probe.device.productAbi,
      productAbiList: probe.device.productAbiList,
      nativeBridge: probe.device.nativeBridge,
      manufacturer: probe.device.manufacturer,
      model: probe.device.model,
      product: probe.device.product,
      hardware: probe.device.hardware,
      rootAvailable: probe.device.rootAvailable,
      externalLayerEligible: probe.device.externalLayerEligible,
      targetDebuggable: probe.target.debuggable,
      targetInjectLayersEnabled: probe.target.injectLayersEnabled,
    },
    installedPackage: {
      versionName: probe.target.versionName,
      versionCode: probe.target.versionCode,
      primaryAbi: probe.target.abi.primary,
      libunitySha256:
        probe.target.installedNativeSha256["libunity.so"],
      libil2cppSha256:
        probe.target.installedNativeSha256["libil2cpp.so"],
      nativeIdentityMatchesCandidate:
        probe.target.nativeIdentityMatchesCandidate,
    },
    crash,
    cleanRestartLog: {
      candidateUnityVersionObserved:
        logcat.candidateUnityVersionObserved,
      candidatePackageObserved: logcat.candidatePackageObserved,
      vulkanInitializationObserved: logcat.vulkanInitializationObserved,
      sigsegvObserved: logcat.sigsegvObserved,
      tokioRuntimeThreadObserved: logcat.tokioRuntimeThreadObserved,
      gfxreconstructInitializationObserved:
        logcat.gfxreconstructInitializationObserved,
      selectedLines: logcat.selectedLines,
    },
    source: {
      tombstone: {
        logicalId: "BlueStacks Pie64 /data/tombstones/tombstone_04",
        ...fileIdentity(tombstonePath),
      },
      logcat: {
        logicalId: "clean post-reboot candidate launch logcat",
        byteLength: Buffer.byteLength(logcatSource),
        sha256: logcat.sourceSha256,
      },
    },
    scope: {
      testedPlatformOnly: true,
      closesOfficialGuestRuntime: false,
      closesNativeDeviceDisplay: false,
      createsCaptureData: false,
      fidelityContribution: 0,
      officialShaderRestorationPercent: null,
      gameFidelity: false,
    },
    blocker: {
      id: "bluestacks-houdini-unity6-candidate-crash",
      status: "external-platform-blocker",
      reason:
        "the hash-matched ARM64 candidate crashes inside the x86_64 "
        + "libhoudini native bridge before a stable captureable card frame",
      remediation:
        "use a real ARM64 device or an eng/userdebug ARM64 environment that "
        + "can run the candidate and authorize an external Vulkan layer",
    },
    limitations: [
      "this proves only that the tested BlueStacks Pie64 environment is unsuitable",
      "it does not prove that the official game crashes on a real ARM64 device",
      "it does not provide a guest Vulkan capture, descriptor, uniform, attachment, vertex, compositor or display fact",
      "it contributes zero units to official shader restoration or game fidelity",
    ],
  };
  report.proofSha256 = canonicalDigest(report);
  return validateReport(report, sample, sampleManifestSha256);
}

function selfTest() {
  const parsed = parseGuestCrashTombstone(
    "Build fingerprint: 'vendor/product:user/release-keys'\n"
    + "ABI: 'x86_64'\n"
    + "pid: 12, tid: 34, name: UnityMain  >>> pkg.name <<<\n"
    + "signal 11 (SIGSEGV), code 1 (SEGV_MAPERR), fault addr 0xdead0000\n"
    + "backtrace:\n"
    + "    #00 pc 0001 /system/lib64/libhoudini.so\n"
    + "    #01 pc 0002 /system/lib64/libhoudini.so\n"
    + "x /data/app/pkg/lib/arm64/libunity.so (BuildId: abc123)\n",
  );
  assert.equal(parsed.packageName, "pkg.name");
  assert.equal(parsed.threadName, "UnityMain");
  assert.equal(parsed.signalName, "SIGSEGV");
  assert.equal(parsed.nativeBridgeModule, "/system/lib64/libhoudini.so");
  assert.deepEqual(parsed.libunityBuildIds, ["abc123"]);
  assert.equal(parsed.gfxreconstructMapped, false);
  console.log("Candidate guest platform blocker self-test: pass");
}

const IS_CLI = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (IS_CLI) {
  const args = parseArgs(process.argv.slice(2));
  if (args.selfTest) {
    selfTest();
  } else {
    const loaded = loadOfficialSample(args.candidateManifest);
    const outputPath = args.output
      ? path.resolve(ROOT, args.output)
      : outputPathFor(loaded.sample);
    if (args.check && !args.tombstone) {
      const report = JSON.parse(fs.readFileSync(outputPath, "utf8"));
      validateReport(
        report,
        loaded.sample,
        officialSampleDigest(loaded.sample),
      );
      console.log(
        `Candidate guest platform blocker: ${report.status} `
        + `(${path.relative(ROOT, outputPath).replaceAll("\\", "/")})`,
      );
    } else {
      const report = buildReport(args);
      const serialized = `${JSON.stringify(report, null, 2)}\n`;
      if (args.check) {
        assert.equal(fs.readFileSync(outputPath, "utf8"), serialized);
      } else {
        fs.mkdirSync(path.dirname(outputPath), { recursive: true });
        atomicWriteFileSync(outputPath, serialized);
      }
      console.log(
        `Candidate guest platform blocker: ${report.status}; `
        + `fidelity contribution ${report.scope.fidelityContribution}`,
      );
    }
  }
}
