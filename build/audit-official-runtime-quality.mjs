#!/usr/bin/env node
// Validate the live official quality preference without retaining its plaintext.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PYTHON = process.env.PYTHON || "python";
const SHA256 = /^[0-9a-f]{64}$/;
const DEFAULT_EVIDENCE = path.join(ROOT, "$cache", "official-runtime-quality.local.json");

function runExtractor() {
  const args = ["-B", "build/extract_official_runtime_quality.py"];
  if (process.env.PCR_SYSTEM_USER_PREFS) {
    args.push("--input", process.env.PCR_SYSTEM_USER_PREFS);
  }
  const result = spawnSync(PYTHON, args, {
    cwd: ROOT,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
    shell: process.platform === "win32",
    windowsHide: true,
  });
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || result.error?.message || "runtime quality extractor failed").trim());
  }
  return JSON.parse(result.stdout.replace(/^\uFEFF/, ""));
}

function evidencePath() {
  return path.resolve(process.env.PCR_OFFICIAL_RUNTIME_QUALITY_EVIDENCE || DEFAULT_EVIDENCE);
}

function readEvidence() {
  const source = evidencePath();
  if (fs.existsSync(source)) {
    const stored = JSON.parse(fs.readFileSync(source, "utf8"));
    const wrapped = stored?.kind === "official-runtime-quality-capture";
    return {
      evidence: wrapped ? stored.evidence : stored,
      origin: "captured-artifact",
      source,
      capturedAt: wrapped ? stored.capturedAt : fs.statSync(source).mtime.toISOString(),
    };
  }
  return { evidence: runExtractor(), origin: "live-extraction", source: null, capturedAt: new Date().toISOString() };
}

function auditOfficialRuntimeQuality(input = null) {
  const loaded = input
    ? { evidence: input, origin: "provided", source: null, capturedAt: new Date().toISOString() }
    : readEvidence();
  const { evidence } = loaded;
  assert.equal(evidence.schemaVersion, 1);
  assert.equal(evidence.status, "exact-runtime-preference");
  assert.deepEqual(evidence.evidencePolicy, {
    officialOnly: true,
    readInputs: [
      "PTCGP 1.6.0 libil2cpp.so",
      "PTCGP 1.6.0 global-metadata.dat",
      "live encrypted SystemUserPrefs",
    ],
    emittedPreferenceKeys: ["ConfigSystem/Fps", "ConfigSystem/Quality"],
    rawPreferenceBytesEmitted: false,
    decryptedPreferenceBytesEmitted: false,
  });
  assert.deepEqual(
    [evidence.officialSource.libil2cpp.byteSize, evidence.officialSource.libil2cpp.sha256],
    [128218264, "3e78eedc62770fff4cb129b4b8d898950e131b710b3c099237fe20d2d34ca48e"],
  );
  assert.deepEqual(
    [evidence.officialSource.metadata.byteSize, evidence.officialSource.metadata.sha256],
    [31429296, "bf58e06a98f9e9e05a1635f512ea432d33971bfc8280ba26df1c93e94b4f3cb9"],
  );
  assert.equal(Object.keys(evidence.officialSource.methods).length, 7);
  assert.deepEqual(
    Object.fromEntries(Object.entries(evidence.officialSource.constants).map(([key, value]) => [key, value.sha256])),
    {
      key: "42c43af4f4399b90f8af4a41153883f06746070e95c64f344b55342c9a4788f4",
      turns: "8d33c836063c4f870c3c08f668ba99e12cb43f5c258dbd687e5a46de9e1b794b",
      sigma: "d93920a685aab16b74fca9bf5e5c5b844995ccb5394f261a91d847bec62580bc",
    },
  );

  assert.equal(evidence.target.kind, "live-bluestacks-adb", "exact target evidence must come from the live device");
  assert.equal(typeof evidence.target.serial, "string");
  assert.ok(evidence.target.serial.length > 0);
  assert.equal(evidence.target.package, "jp.pokemon.pokemontcgp");
  assert.equal(evidence.target.versionName, "1.6.0");
  assert.equal(evidence.target.versionCode, 293311);
  assert.equal(typeof evidence.target.androidRelease, "string");
  assert.ok(evidence.target.androidRelease.length > 0);
  assert.equal(typeof evidence.target.systemAbi, "string");
  assert.ok(evidence.target.systemAbi.length > 0);
  assert.equal(evidence.target.rootVerified, true);
  assert.equal(
    evidence.preferenceFile.path,
    "/data/data/jp.pokemon.pokemontcgp/files/UserPreferences/v1/SystemUserPrefs",
  );
  assert.equal(evidence.preferenceFile.headerHex, "4550464c");
  assert.ok(evidence.preferenceFile.byteSize > 16);
  assert.match(evidence.preferenceFile.sha256, SHA256);
  assert.deepEqual(evidence.preferenceFile.layout, {
    headerBytes: 4,
    nonceBytes: 8,
    nonceFillBytes: 4,
    ciphertextOffset: 16,
  });
  assert.equal(evidence.cipher.name, "Aladin.Crypto.Acpb / ChaCha20BurstStream");
  assert.deepEqual(evidence.cipher.counterInitial, [1, 2, 3, 4]);
  assert.deepEqual(evidence.cipher.counterIncremental, [4, 4, 4, 4]);
  assert.ok(Number.isInteger(evidence.cipher.roundSelector)
    && evidence.cipher.roundSelector >= 0 && evidence.cipher.roundSelector < 16);
  assert.ok([5, 6].includes(evidence.cipher.doubleRounds));
  assert.equal(evidence.protobuf.fullyConsumed, true);
  assert.ok(Number.isInteger(evidence.protobuf.byteSize) && evidence.protobuf.byteSize > 0);
  assert.ok(Number.isInteger(evidence.protobuf.intEntryCount) && evidence.protobuf.intEntryCount >= 1);
  assert.equal(evidence.protobuf.fieldCounts[2], evidence.protobuf.intEntryCount);
  assert.deepEqual(evidence.runtime.quality, {
    key: "ConfigSystem/Quality",
    persisted: true,
    enum: 1,
    name: "Middle",
  });
  assert.equal(evidence.runtime.fps.key, "ConfigSystem/Fps");
  assert.equal(typeof evidence.runtime.fps.persisted, "boolean");
  if (evidence.runtime.fps.persisted) assert.ok(Number.isInteger(evidence.runtime.fps.enum));
  else assert.equal(evidence.runtime.fps.enum, null);

  const contract = JSON.parse(fs.readFileSync(
    path.join(ROOT, "public", "render", "card-display-contract.json"),
    "utf8",
  ));
  const profile = Object.values(contract.quality_profiles)
    .find((candidate) => candidate.quality_enum === evidence.runtime.quality.enum);
  assert.ok(profile, "live quality enum is missing from the official display contract");
  assert.equal(profile.quality_name, evidence.runtime.quality.name);
  assert.equal(profile.quality_factor, 0.800000011920929);
  assert.deepEqual(profile.source_render_target_request, {
    width: 1122,
    height: 1122,
    square: true,
    size_formula: "roundToEven(pixelHeight / VerticalPercentageInRT * UICardQuality)",
  });

  return Object.freeze({
    status: "pass",
    evidenceOrigin: loaded.origin,
    evidencePath: loaded.source,
    capturedAt: loaded.capturedAt,
    target: evidence.target,
    preferenceFile: evidence.preferenceFile,
    selectedQuality: Object.freeze({
      enum: profile.quality_enum,
      name: profile.quality_name,
      factor: profile.quality_factor,
      sourceRenderTarget: [
        profile.source_render_target_request.width,
        profile.source_render_target_request.height,
      ],
    }),
    fpsOverridePresent: evidence.runtime.fps.persisted,
    evidence: Object.freeze([
      "live root-read EPFL preference hash and structure",
      "pinned IL2CPP EncryptedPreferenceFile/Acpb method hashes",
      "pinned metadata key/sigma/round-table hashes",
      "fully consumed Protobuf int map restricted to Quality/Fps",
      "quality enum mapped through the official card display contract",
    ]),
  });
}

const isMain = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  try {
    if (process.argv.includes("--capture")) {
      const evidence = runExtractor();
      auditOfficialRuntimeQuality(evidence);
      fs.mkdirSync(path.dirname(evidencePath()), { recursive: true });
      fs.writeFileSync(evidencePath(), `${JSON.stringify({
        schemaVersion: 1,
        kind: "official-runtime-quality-capture",
        capturedAt: new Date().toISOString(),
        evidence,
      }, null, 2)}\n`);
      console.log(`captured official runtime quality evidence: ${evidencePath()}`);
    }
    const report = auditOfficialRuntimeQuality();
    if (process.argv.includes("--json")) console.log(JSON.stringify(report, null, 2));
    else {
      console.log(
        `official runtime quality OK: ${report.selectedQuality.name} `
        + `(enum ${report.selectedQuality.enum}, ${report.selectedQuality.sourceRenderTarget.join("x")}); `
        + `${report.evidenceOrigin === "live-extraction" ? "live" : "captured"} PTCGP ${report.target.versionName} on ${report.target.serial}; `
        + `${report.fpsOverridePresent ? "persisted Fps override present" : "no persisted Fps override"}`,
      );
    }
  } catch (error) {
    console.error(`BAD official runtime quality: ${error.message}`);
    process.exitCode = 1;
  }
}

export { auditOfficialRuntimeQuality, runExtractor };
