#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  loadOfficialSample,
  officialSampleDigest,
} from "./official-sample.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_CANDIDATE =
  "build/official-samples/candidate.json";
const DEFAULT_ADB = process.platform === "win32"
  ? "D:/dev/Android/Sdk/platform-tools/adb.exe"
  : "adb";
const GFXRECON_LAYER = "VK_LAYER_LUNARG_gfxreconstruct";
const GFXRECON_PACKAGE = "com.lunarg.gfxreconstruct.replay";

function parseArgs(argv) {
  const args = {
    candidateManifest:
      process.env.PCR_OFFICIAL_CANDIDATE_MANIFEST || DEFAULT_CANDIDATE,
    adb: process.env.ADB || DEFAULT_ADB,
    serial: process.env.ANDROID_SERIAL || null,
    json: false,
    requireDevice: false,
    requireReady: false,
    selfTest: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--candidate-manifest") {
      args.candidateManifest = argv[++index];
    } else if (value === "--adb") {
      args.adb = argv[++index];
    } else if (value === "--serial") {
      args.serial = argv[++index];
    } else if (value === "--json") {
      args.json = true;
    } else if (value === "--require-device") {
      args.requireDevice = true;
    } else if (value === "--require-ready") {
      args.requireReady = true;
    } else if (value === "--self-test") {
      args.selfTest = true;
    } else {
      throw new Error(`unknown argument: ${value}`);
    }
  }
  return args;
}

export function parseAdbDevices(output) {
  return output
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [serial, state, ...details] = line.split(/\s+/);
      return { serial, state, details };
    });
}

export function parsePackageAbi(output) {
  const read = (name) => {
    const match = output.match(new RegExp(`\\b${name}=([^\\s]+)`));
    return match?.[1] === "null" ? null : match?.[1] || null;
  };
  return {
    primary: read("primaryCpuAbi"),
    secondary: read("secondaryCpuAbi"),
  };
}

export function parseSha256Sums(output) {
  return Object.fromEntries(
    output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const match = line.match(/^([0-9a-f]{64})\s+\*?(.+)$/i);
        return match
          ? [path.posix.basename(match[2]), match[1].toLowerCase()]
          : null;
      })
      .filter(Boolean),
  );
}

export function parseElfIdentity(output) {
  const bytes = output
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((value) => Number.parseInt(value, 16));
  if (
    bytes.length < 20
    || bytes.some((value) => !Number.isInteger(value) || value < 0 || value > 255)
    || bytes[0] !== 0x7f
    || bytes[1] !== 0x45
    || bytes[2] !== 0x4c
    || bytes[3] !== 0x46
  ) {
    return { valid: false, elfClass: null, endianness: null, machine: null };
  }
  const littleEndian = bytes[5] === 1;
  const machineCode = littleEndian
    ? bytes[18] | (bytes[19] << 8)
    : (bytes[18] << 8) | bytes[19];
  const machine = new Map([
    [0x3e, "x86_64"],
    [0xb7, "arm64-v8a"],
  ]).get(machineCode) || `elf-machine-${machineCode}`;
  return {
    valid: true,
    elfClass: bytes[4] === 2 ? "ELF64" : bytes[4] === 1 ? "ELF32" : null,
    endianness: littleEndian ? "little" : bytes[5] === 2 ? "big" : null,
    machine,
  };
}

export function classifyProcessMaps(output) {
  const lines = output.split(/\r?\n/).filter(Boolean);
  return {
    hasGameLibunity: lines.some((line) => /\/libunity\.so(?:\s|$)/.test(line)),
    hasVulkanLoader: lines.some((line) => /\/libvulkan\.so(?:\s|$)/.test(line)),
    hasGfxreconstructLayer: lines.some(
      (line) => /libVkLayer_gfxreconstruct\.so/.test(line),
    ),
    nativeBridgeLibraries: lines
      .filter((line) => /houdini|ndk_translation|native_bridge/i.test(line))
      .map((line) => line.trim()),
  };
}

function invoke(filename, args) {
  const result = spawnSync(filename, args, {
    cwd: ROOT,
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
  });
  return {
    ok: result.status === 0,
    exitCode: result.status,
    stdout: (result.stdout || "").trim(),
    stderr: (result.stderr || "").trim(),
    error: result.error?.message || null,
  };
}

function adbCommand(adb, serial, args) {
  return invoke(adb, [
    ...(serial ? ["-s", serial] : []),
    ...args,
  ]);
}

function shell(adb, serial, ...args) {
  return adbCommand(adb, serial, ["shell", ...args]);
}

function readShell(adb, serial, ...args) {
  const result = shell(adb, serial, ...args);
  return result.ok ? result.stdout : null;
}

function selectedDevice(devices, explicitSerial) {
  const online = devices.filter(({ state }) => state === "device");
  if (explicitSerial) {
    return online.find(({ serial }) => serial === explicitSerial) || null;
  }
  return online.length === 1 ? online[0] : null;
}

function property(adb, serial, name) {
  return readShell(adb, serial, "getprop", name) || null;
}

function globalSetting(adb, serial, name) {
  const value = readShell(adb, serial, "settings", "get", "global", name);
  return value === "null" ? null : value;
}

function rootCommand(adb, serial, command) {
  return shell(adb, serial, "su", "-c", command);
}

function processEvidence(adb, serial, packageName, rootAvailable) {
  const pids = (readShell(adb, serial, "pidof", packageName) || "")
    .split(/\s+/)
    .filter((value) => /^\d+$/.test(value));
  if (pids.length === 0) {
    return {
      running: false,
      pids: [],
      executable: null,
      maps: null,
    };
  }
  const pid = pids[0];
  const readlink = rootAvailable
    ? rootCommand(adb, serial, `readlink /proc/${pid}/exe`)
    : shell(adb, serial, "readlink", `/proc/${pid}/exe`);
  const mapCommand =
    `grep -E 'libunity\\.so|libvulkan\\.so|libVkLayer_gfxreconstruct\\.so`
    + `|houdini|ndk_translation|native_bridge' /proc/${pid}/maps`;
  const maps = rootAvailable
    ? rootCommand(adb, serial, mapCommand)
    : shell(adb, serial, "sh", "-c", mapCommand);
  return {
    running: true,
    pids,
    executable: readlink.ok ? readlink.stdout : null,
    maps: maps.ok ? classifyProcessMaps(maps.stdout) : null,
    mapReadError: maps.ok ? null : maps.stderr || maps.error,
  };
}

export function probeCandidateGuestVulkanCapture({
  candidateManifest = DEFAULT_CANDIDATE,
  adb = DEFAULT_ADB,
  serial = null,
} = {}) {
  const loaded = loadOfficialSample(candidateManifest);
  const sample = loaded.sample;
  assert.equal(sample.status, "candidate");
  const adbExists = path.isAbsolute(adb) ? fs.existsSync(adb) : true;
  const devicesResult = adbExists
    ? invoke(adb, ["devices", "-l"])
    : {
        ok: false,
        stdout: "",
        stderr: "",
        error: `adb is absent: ${adb}`,
      };
  const devices = devicesResult.ok
    ? parseAdbDevices(devicesResult.stdout)
    : [];
  const device = selectedDevice(devices, serial);
  const base = {
    schema: "pocket-card-render/candidate-guest-vulkan-capture-probe@2",
    candidate: {
      selection: loaded.selectionRelative,
      manifest: loaded.manifestRelative,
      sampleId: sample.sampleId,
      sampleManifestSha256: officialSampleDigest(sample),
      packageName: sample.game.packageName,
      architecture: sample.game.architecture,
    },
    adb: {
      executable: adb,
      available: adbExists && devicesResult.ok,
      devices,
      selectedSerial: device?.serial || null,
      error: devicesResult.ok
        ? null
        : devicesResult.stderr || devicesResult.error,
    },
    scope: {
      mutatesDevice: false,
      launchesTarget: false,
      installsPackages: false,
      observedCaptureLayerInitialization: false,
      observedGuestTrace: false,
      fidelityContribution: 0,
      officialShaderRestorationPercent: null,
    },
  };
  if (!device) {
    return {
      ...base,
      status: "external-device-required",
      blockers: [
        devices.some(({ state }) => state !== "device")
          ? "no selected ADB device is online"
          : "no ADB device is connected",
      ],
    };
  }

  const packageName = sample.game.packageName;
  const packagePath = shell(adb, device.serial, "pm", "path", packageName);
  const packageDump = packagePath.ok
    ? shell(adb, device.serial, "dumpsys", "package", packageName)
    : { ok: false, stdout: "", stderr: "package is absent" };
  const root = rootCommand(adb, device.serial, "id");
  const rootAvailable = root.ok && /\buid=0\b/.test(root.stdout);
  const buildType = property(adb, device.serial, "ro.build.type");
  const layerDirectory = rootAvailable
    ? rootCommand(adb, device.serial, "ls -la /data/local/debug/vulkan")
    : { ok: false, stdout: "", stderr: "root is unavailable" };
  const abi = parsePackageAbi(packageDump.stdout);
  const process = processEvidence(
    adb,
    device.serial,
    packageName,
    rootAvailable,
  );
  const debuggable = /\bDEBUGGABLE\b/.test(packageDump.stdout);
  const injectLayersEnabled = (
    /com\.android\.graphics\.injectLayers\.enable(?:=|:\s*)true\b/i
      .test(packageDump.stdout)
  );
  const externalLayerEligible = debuggable
    || injectLayersEnabled
    || (rootAvailable && /^(?:eng|userdebug)$/.test(buildType || ""));
  const layerFilesPresent = layerDirectory.ok
    && /libVkLayer_gfxreconstruct\.so/.test(layerDirectory.stdout);
  const layerPath =
    "/data/local/debug/vulkan/libVkLayer_gfxreconstruct.so";
  const layerHash = rootAvailable && layerFilesPresent
    ? rootCommand(adb, device.serial, `sha256sum ${layerPath}`)
    : { ok: false, stdout: "", stderr: "capture layer is unavailable" };
  const layerHeader = rootAvailable && layerFilesPresent
    ? rootCommand(adb, device.serial, `od -An -tx1 -N20 ${layerPath}`)
    : { ok: false, stdout: "", stderr: "capture layer is unavailable" };
  const layerSha256 = layerHash.ok
    ? parseSha256Sums(layerHash.stdout)[path.posix.basename(layerPath)] || null
    : null;
  const layerElf = layerHeader.ok
    ? parseElfIdentity(layerHeader.stdout)
    : { valid: false, elfClass: null, endianness: null, machine: null };
  const configuredLayer = globalSetting(
    adb,
    device.serial,
    "gpu_debug_layers",
  );
  const gpuDebugEnabled = globalSetting(
    adb,
    device.serial,
    "enable_gpu_debug_layers",
  );
  const gpuDebugApp = globalSetting(adb, device.serial, "gpu_debug_app");
  const gpuDebugLayerApp = globalSetting(
    adb,
    device.serial,
    "gpu_debug_layer_app",
  );
  const apkPaths = packagePath.ok ? packagePath.stdout.split(/\r?\n/) : [];
  const baseApkPath = apkPaths
    .map((line) => line.replace(/^package:/, "").trim())
    .find((value) => value.endsWith("/base.apk"));
  const installedNative = rootAvailable && baseApkPath
    ? rootCommand(
        adb,
        device.serial,
        `sha256sum ${path.posix.dirname(baseApkPath)}/lib/arm64/libunity.so `
          + `${path.posix.dirname(baseApkPath)}/lib/arm64/libil2cpp.so`,
      )
    : { ok: false, stdout: "", stderr: "installed native roots unavailable" };
  const installedNativeSha256 = installedNative.ok
    ? parseSha256Sums(installedNative.stdout)
    : {};
  const versionIdentityMatchesCandidate = (
    packageDump.stdout.match(/\bversionName=([^\s]+)/)?.[1]
      === sample.game.versionName
    && Number(packageDump.stdout.match(/\bversionCode=(\d+)/)?.[1] || 0)
      === sample.game.versionCode
  );
  const nativeIdentityMatchesCandidate = (
    installedNativeSha256["libunity.so"] === sample.artifacts.libunity.sha256
    && installedNativeSha256["libil2cpp.so"]
      === sample.artifacts.libil2cpp.sha256
  );
  const guestArchitectureMatchesCandidate = (
    property(adb, device.serial, "ro.product.cpu.abi")
      === sample.game.architecture
  );
  const layerArchitectureMatchesCandidate = (
    layerElf.valid
    && layerElf.elfClass === "ELF64"
    && layerElf.machine === sample.game.architecture
  );
  const layerSettingsReady = (
    gpuDebugEnabled === "1"
    && gpuDebugApp === packageName
    && configuredLayer?.split(":").includes(GFXRECON_LAYER)
    && gpuDebugLayerApp === GFXRECON_PACKAGE
  );
  const candidateIdentityReady = (
    packagePath.ok
    && abi.primary === sample.game.architecture
    && versionIdentityMatchesCandidate
    && nativeIdentityMatchesCandidate
  );
  const blockers = [];
  if (!packagePath.ok) blockers.push("candidate game package is not installed");
  if (packagePath.ok && !versionIdentityMatchesCandidate) {
    blockers.push("installed package version does not match the candidate manifest");
  }
  if (packagePath.ok && !nativeIdentityMatchesCandidate) {
    blockers.push(
      "installed libunity/libil2cpp hashes do not match the candidate manifest",
    );
  }
  if (!externalLayerEligible) {
    blockers.push(
      "target is not debuggable and the production user build does not authorize external Vulkan layers",
    );
  }
  if (!layerFilesPresent) {
    blockers.push("GFXReconstruct capture layer is not present in the guest");
  }
  if (abi.primary && abi.primary !== sample.game.architecture) {
    blockers.push(
      `installed package primary ABI ${abi.primary} differs from ${sample.game.architecture}`,
    );
  }
  if (!guestArchitectureMatchesCandidate) {
    blockers.push(
      `guest primary ABI ${property(adb, device.serial, "ro.product.cpu.abi") || "unknown"} `
      + `differs from ${sample.game.architecture}; native-bridge execution is not `
      + "official ARM64 guest evidence",
    );
  }
  if (layerFilesPresent && !layerArchitectureMatchesCandidate) {
    blockers.push(
      `capture layer ELF ${layerElf.machine || "unknown"} does not match `
      + `${sample.game.architecture}`,
    );
  }
  if (layerFilesPresent && !layerSettingsReady) {
    blockers.push(
      "GPU debug layer settings are not fully bound to the candidate package "
      + "and GFXReconstruct source app",
    );
  }
  const capturePrerequisitesReady = blockers.length === 0;
  return {
    ...base,
    status: capturePrerequisitesReady
      ? "load-test-required"
      : "capture-prerequisites-incomplete",
    readiness: {
      candidateIdentityReady,
      guestArchitectureMatchesCandidate,
      layerArchitectureMatchesCandidate,
      layerSettingsReady,
      capturePrerequisitesReady,
    },
    device: {
      serial: device.serial,
      sdk: property(adb, device.serial, "ro.build.version.sdk"),
      productAbi: property(adb, device.serial, "ro.product.cpu.abi"),
      productAbiList: property(adb, device.serial, "ro.product.cpu.abilist"),
      nativeBridge: property(adb, device.serial, "ro.dalvik.vm.native.bridge"),
      hardwareVulkan: property(adb, device.serial, "ro.hardware.vulkan"),
      hardwareEgl: property(adb, device.serial, "ro.hardware.egl"),
      systemDebuggable: property(adb, device.serial, "ro.debuggable"),
      buildType,
      buildFingerprint: property(adb, device.serial, "ro.build.fingerprint"),
      manufacturer: property(adb, device.serial, "ro.product.manufacturer"),
      model: property(adb, device.serial, "ro.product.model"),
      product: property(adb, device.serial, "ro.product.name"),
      hardware: property(adb, device.serial, "ro.hardware"),
      rootAvailable,
      externalLayerEligible,
    },
    target: {
      installed: packagePath.ok,
      apkPaths,
      debuggable,
      injectLayersEnabled,
      abi,
      versionName:
        packageDump.stdout.match(/\bversionName=([^\s]+)/)?.[1] || null,
      versionCode: Number(
        packageDump.stdout.match(/\bversionCode=(\d+)/)?.[1] || 0,
      ) || null,
      versionIdentityMatchesCandidate,
      installedNativeSha256,
      nativeIdentityMatchesCandidate,
      process,
    },
    layer: {
      expectedName: GFXRECON_LAYER,
      replayPackage: GFXRECON_PACKAGE,
      globalDirectoryReadable: layerDirectory.ok,
      filesPresent: layerFilesPresent,
      binary: {
        path: layerPath,
        sha256: layerSha256,
        elf: layerElf,
        architectureMatchesCandidate: layerArchitectureMatchesCandidate,
      },
      directoryListing: layerDirectory.ok ? layerDirectory.stdout : null,
      settings: {
        enabled: gpuDebugEnabled,
        targetApp: gpuDebugApp,
        layers: configuredLayer,
        sourceApp: gpuDebugLayerApp,
        globalLayerProperty: property(
          adb,
          device.serial,
          "debug.vulkan.layers",
        ),
      },
      settingsReady: layerSettingsReady,
      externalLayerEligible,
      loadedInRunningTarget: process.maps?.hasGfxreconstructLayer || false,
    },
    blockers,
  };
}

function selfTest() {
  assert.deepEqual(
    parseAdbDevices(
      "List of devices attached\n127.0.0.1:5555 device product:x model:y\n"
      + "offline-one offline\n",
    ),
    [
      {
        serial: "127.0.0.1:5555",
        state: "device",
        details: ["product:x", "model:y"],
      },
      {
        serial: "offline-one",
        state: "offline",
        details: [],
      },
    ],
  );
  assert.deepEqual(
    parsePackageAbi("primaryCpuAbi=arm64-v8a secondaryCpuAbi=null"),
    { primary: "arm64-v8a", secondary: null },
  );
  assert.deepEqual(
    parseSha256Sums(
      `${"a".repeat(64)}  /data/app/pkg/lib/arm64/libunity.so\n`
      + `${"B".repeat(64)}  /data/app/pkg/lib/arm64/libil2cpp.so\n`,
    ),
    {
      "libunity.so": "a".repeat(64),
      "libil2cpp.so": "b".repeat(64),
    },
  );
  assert.deepEqual(
    classifyProcessMaps(
      "x /data/app/lib/arm64/libunity.so\n"
      + "x /system/lib64/libvulkan.so\n"
      + "x /data/local/debug/vulkan/libVkLayer_gfxreconstruct.so\n"
      + "x /system/lib64/libndk_translation.so\n",
    ),
    {
      hasGameLibunity: true,
      hasVulkanLoader: true,
      hasGfxreconstructLayer: true,
      nativeBridgeLibraries: [
        "x /system/lib64/libndk_translation.so",
      ],
    },
  );
  assert.deepEqual(
    parseElfIdentity(
      "7f 45 4c 46 02 01 01 00 00 00 00 00 00 00 00 00 03 00 b7 00",
    ),
    {
      valid: true,
      elfClass: "ELF64",
      endianness: "little",
      machine: "arm64-v8a",
    },
  );
  assert.deepEqual(
    parseElfIdentity(
      "7f 45 4c 46 02 01 01 00 00 00 00 00 00 00 00 00 03 00 3e 00",
    ),
    {
      valid: true,
      elfClass: "ELF64",
      endianness: "little",
      machine: "x86_64",
    },
  );
  console.log("Candidate guest Vulkan capture probe self-test: pass");
}

function print(report) {
  console.log(`Candidate guest Vulkan capture probe: ${report.status}`);
  console.log(
    `  device: ${report.adb.selectedSerial || "none"}; `
    + `mutates device: ${report.scope.mutatesDevice}`,
  );
  if (report.target) {
    console.log(
      `  target: installed=${report.target.installed} `
      + `debuggable=${report.target.debuggable} `
      + `abi=${report.target.abi.primary || "unknown"}`,
    );
    console.log(
      `  root=${report.device.rootAvailable} `
      + `layer files=${report.layer.filesPresent} `
      + `layer loaded=${report.layer.loadedInRunningTarget}`,
    );
  }
  for (const blocker of report.blockers) console.log(`  - ${blocker}`);
  console.log("  fidelity contribution: 0");
}

const IS_CLI = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (IS_CLI) {
  const args = parseArgs(process.argv.slice(2));
  if (args.selfTest) {
    selfTest();
  } else {
    const report = probeCandidateGuestVulkanCapture(args);
    if (args.json) console.log(JSON.stringify(report, null, 2));
    else print(report);
    if (
      (args.requireDevice && !report.adb.selectedSerial)
      || (args.requireReady && !report.readiness?.capturePrerequisitesReady)
    ) {
      process.exitCode = 1;
    }
  }
}
