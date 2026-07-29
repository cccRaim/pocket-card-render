#!/usr/bin/env node
// Version-locked proof of Unity 6 shader-variant best-match selection.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { inflateRawSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { loadOfficialSample } from "./official-sample.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SAMPLE_FILE = path.resolve(
  process.env.PCR_OFFICIAL_CANDIDATE_MANIFEST
    || path.join(ROOT, "build", "official-samples", "candidate.json"),
);
const DEFAULT_SPLIT_ROOT = path.resolve(
  ROOT,
  "..",
  "ptcg-apk-parser",
  "apks",
  "apkeep-downloads",
  "jp.pokemon.pokemontcgp",
  "jp.pokemon.pokemontcgp",
);
const SPLIT_ROOT = path.resolve(process.env.PCR_CANDIDATE_SPLITS || DEFAULT_SPLIT_ROOT);
const JSON_MODE = process.argv.includes("--json");
const outIndex = process.argv.indexOf("--out");
const OUT = outIndex >= 0 ? path.resolve(process.argv[outIndex + 1]) : null;

const EXPECTED = Object.freeze({
  sampleId: "ptcgp-1.7.0-unity-6000.0.69f1-candidate",
  unityVersion: "6000.0.69f1",
  functions: {
    ComputeKeywordMatch: [0x6dc4b8, 0x6dc540, "5a7872d98aab22609b72c13eb26110f15c9b4cf162a34957e60bc40350ab883b"],
    FindBestMatchingSubProgram: [0x6f2f70, 0x6f30cc, "c2b49b0e6ddb3d8fcb929891f9f42a31d65a663d1f7b665ed90c0e6e49e57950"],
    StrictVariantGetter: [0x6f0d38, 0x6f0dd8, "4cfc70300fe08dd112ede2a03dc600db2497c1743314c5e6143318a8a44b3277"],
  },
  windows: {
    keywordScore: [0x6dc4f0, "8d8540f8080500f16e8540f8cf010d8aad012e8ae001679ea101679e0058200e2158200e0038302e2138302e0d00261e2e00261e29010d0b4a010e0b21feff5420110a4bc0035fd6"],
    bestScoreAndTie: [0x6f2fac, "1b00b0521a0080121405805206000014fb03002afa03192a390700913f0318ebc0040054681640f91f2003d52123149be00315aa36a5ff971f001b6bedfeff54686a41f9"],
    strictBranch: [0x6f360c, "cbf5ff97c00c0036fc0000b4887e43b909058052e04301910871a99b01a10091bea2ff97e1430191e2730091e00314aab1feff97"],
    bestCall: [0x6f37a8, "e1430191e2730091e00314aaeffdff97"],
    strictDefaultFalse: [0x6f0b48, "a86d0090ab6d0090017200f021202a91083140f9e9d3ffb029f13491e20313aa0a0140f96b2d40f93f2400a9f44f44a93f600039"],
    strictFlagGetter: [0x6f0d38, "fe0f1ff8087200f008c12a9108fddf0828010036087200f008012b9109fddf08087200f04902003600e16a39fe0741f8c0035fd6"],
  },
});

function sha256(data) {
  return crypto.createHash("sha256").update(data).digest("hex");
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

function canonicalDigest(value) {
  return sha256(JSON.stringify(canonicalize(value)));
}

function zipEntry(zip, wantedName) {
  const minimum = Math.max(0, zip.length - 0x10000 - 22);
  let eocd = -1;
  for (let offset = zip.length - 22; offset >= minimum; offset -= 1) {
    if (zip.readUInt32LE(offset) === 0x06054b50) {
      eocd = offset;
      break;
    }
  }
  if (eocd < 0) throw new Error("ZIP end-of-central-directory was not found");
  const entryCount = zip.readUInt16LE(eocd + 10);
  let cursor = zip.readUInt32LE(eocd + 16);
  for (let index = 0; index < entryCount; index += 1) {
    if (zip.readUInt32LE(cursor) !== 0x02014b50) {
      throw new Error("invalid ZIP central-directory entry");
    }
    const method = zip.readUInt16LE(cursor + 10);
    const compressedSize = zip.readUInt32LE(cursor + 20);
    const uncompressedSize = zip.readUInt32LE(cursor + 24);
    const nameLength = zip.readUInt16LE(cursor + 28);
    const extraLength = zip.readUInt16LE(cursor + 30);
    const commentLength = zip.readUInt16LE(cursor + 32);
    const localOffset = zip.readUInt32LE(cursor + 42);
    const name = zip.toString("utf8", cursor + 46, cursor + 46 + nameLength);
    if (name === wantedName) {
      const localNameLength = zip.readUInt16LE(localOffset + 26);
      const localExtraLength = zip.readUInt16LE(localOffset + 28);
      const start = localOffset + 30 + localNameLength + localExtraLength;
      const compressed = zip.subarray(start, start + compressedSize);
      const value = method === 0
        ? Buffer.from(compressed)
        : method === 8 ? inflateRawSync(compressed) : null;
      if (!value || value.length !== uncompressedSize) {
        throw new Error(`cannot decode ZIP entry ${name}`);
      }
      return value;
    }
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  throw new Error(`ZIP entry not found: ${wantedName}`);
}

function uint64Number(data, offset, label) {
  const value = data.readBigUInt64LE(offset);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError(`${label} exceeds safe integer range`);
  }
  return Number(value);
}

function elfRange(elf, startRva, endRva) {
  const phoff = uint64Number(elf, 32, "ELF program-header offset");
  const phentsize = elf.readUInt16LE(54);
  const phnum = elf.readUInt16LE(56);
  for (let index = 0; index < phnum; index += 1) {
    const cursor = phoff + index * phentsize;
    if (elf.readUInt32LE(cursor) !== 1) continue;
    const fileOffset = uint64Number(elf, cursor + 8, "PT_LOAD file offset");
    const virtualAddress = uint64Number(elf, cursor + 16, "PT_LOAD virtual address");
    const fileSize = uint64Number(elf, cursor + 32, "PT_LOAD file size");
    if (startRva >= virtualAddress && endRva <= virtualAddress + fileSize) {
      const start = fileOffset + startRva - virtualAddress;
      return elf.subarray(start, start + endRva - startRva);
    }
  }
  throw new RangeError(`RVA range 0x${startRva.toString(16)}..0x${endRva.toString(16)} is not file-backed`);
}

const loaded = loadOfficialSample(SAMPLE_FILE);
const sample = loaded.sample;
if (sample.sampleId !== EXPECTED.sampleId || sample.unity.serializedVersion !== EXPECTED.unityVersion) {
  throw new Error("candidate sample identity changed");
}

const baseApkPath = path.join(SPLIT_ROOT, sample.game.packageSource.splits.baseApk);
const arm64ApkPath = path.join(SPLIT_ROOT, sample.game.packageSource.splits.arm64Split);
const baseApk = fs.readFileSync(baseApkPath);
const arm64Apk = fs.readFileSync(arm64ApkPath);
const libunity = zipEntry(arm64Apk, "lib/arm64-v8a/libunity.so");
const bootConfig = zipEntry(baseApk, "assets/bin/Data/boot.config");
const checks = [];
const failures = [];

function check(label, condition, actual = undefined) {
  checks.push({ label, status: condition ? "proved" : "failed", actual });
  if (!condition) failures.push(label);
}

check("base APK SHA-256", sha256(baseApk) === sample.artifacts.baseApk.sha256, sha256(baseApk));
check("arm64 split SHA-256", sha256(arm64Apk) === sample.artifacts.arm64Split.sha256, sha256(arm64Apk));
check("libunity.so SHA-256", sha256(libunity) === sample.artifacts.libunity.sha256, sha256(libunity));
check("boot.config SHA-256", sha256(bootConfig) === sample.artifacts.bootConfig.sha256, sha256(bootConfig));
check("Unity version", libunity.indexOf(EXPECTED.unityVersion) >= 0);
check(
  "strict-shader-variant-matching absent",
  !bootConfig.includes("strict-shader-variant-matching"),
);
check(
  "strict-shader-variant-matching string unique",
  libunity.indexOf("strict-shader-variant-matching")
    === libunity.lastIndexOf("strict-shader-variant-matching"),
);
for (const [name, [startRva, endRva, expectedHash]] of Object.entries(EXPECTED.functions)) {
  const bytes = elfRange(libunity, startRva, endRva);
  check(`${name} body SHA-256`, sha256(bytes) === expectedHash, sha256(bytes));
}
for (const [name, [startRva, expectedHex]] of Object.entries(EXPECTED.windows)) {
  const bytes = elfRange(libunity, startRva, startRva + expectedHex.length / 2);
  check(`${name} exact ARM64 bytes`, bytes.toString("hex") === expectedHex, bytes.toString("hex"));
}

const report = {
  schema: "pocket-card-render/official-native-variant-selection-proof@1",
  sampleId: sample.sampleId,
  unityVersion: sample.unity.serializedVersion,
  sampleInputSha256: canonicalDigest({
    sampleId: sample.sampleId,
    unityVersion: sample.unity.serializedVersion,
    inputs: {
      baseApkSha256: sample.artifacts.baseApk.sha256,
      arm64SplitSha256: sample.artifacts.arm64Split.sha256,
      libunitySha256: sample.artifacts.libunity.sha256,
      bootConfigSha256: sample.artifacts.bootConfig.sha256,
    },
  }),
  status: failures.length ? "failed" : "proved",
  authority: "official PTCGP 1.7.0 ARM64 libunity.so + base.apk boot.config bytes",
  contract: {
    strictShaderVariantMatching: false,
    score: "popcount(requested & candidate) - 16 * popcount(candidate & ~requested)",
    tieBreak: "first-serialized-candidate",
  },
  inputs: {
    baseApkSha256: sample.artifacts.baseApk.sha256,
    arm64SplitSha256: sample.artifacts.arm64Split.sha256,
    libunitySha256: sample.artifacts.libunity.sha256,
    bootConfigSha256: sample.artifacts.bootConfig.sha256,
  },
  functions: Object.fromEntries(
    Object.entries(EXPECTED.functions).map(([name, [startRva, endRva, bodySha256]]) => [
      name,
      { startRva, endRva, bodySha256 },
    ]),
  ),
  checks,
  failures,
};
const encoded = `${JSON.stringify(report, null, 2)}\n`;
if (OUT) {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, encoded);
}
if (JSON_MODE) process.stdout.write(encoded);
else {
  if (failures.length) throw new Error(failures.join("; "));
  console.log("Official candidate native shader-variant selection audit OK");
  console.log("  strict variant matching: false");
  console.log("  best-match score:        intersection - 16 * extra candidate keywords");
  console.log("  tie break:               first serialized candidate");
}
