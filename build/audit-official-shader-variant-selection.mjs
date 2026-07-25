#!/usr/bin/env node
// Read-only proof of Unity's shader-variant selection contract in the
// version-locked PTCGP 1.6.0 ARM64 player. No scene, recipe, or screenshot is
// accepted as evidence.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { inflateRawSync } from "node:zlib";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CACHE = path.resolve(ROOT, "..", ".cache", "ptcgp-1.6.0");
const LIBUNITY = path.resolve(process.env.PCR_GAME_LIBUNITY || path.join(CACHE, "libunity.so"));
const BASE_APK = path.resolve(process.env.PCR_BASE_APK || path.join(CACHE, "base.apk"));
const JSON_MODE = process.argv.includes("--json");

const EXPECTED = Object.freeze({
  unityVersion: "2022.3.62f2",
  libunitySha256: "43a04223f94b6ca0c7cf128b399fe0656c57b5a18a10bf21bb9ce27aeb219722",
  baseApkSha256: "815dc606f3b3e3404199fac80abb46b9249948828178a5cbf6aedb3d9e6809de",
  bootConfigSha256: "b886ce8a232bda260099e3639b8718ae7336a244bf5a097fd3119f74b1017bcd",
  functions: {
    ComputeKeywordMatch: [0x5d5a0c, 0x5d5aa8, "5265cc641b149955d106a95401a9e0a082db9ee6fc44974cb6d2b69a4aa09ca0"],
    FindBestMatchingSubProgram: [0x5e4a8c, 0x5e4be4, "c6a1fa408892d54c9558c07e4eb05f436b37b4b7da05b6b3c8e8f27843c6d766"],
    FindExactlyMatchingSubProgram: [0x5e4c18, 0x5e4d40, "ed9886556cd54b8dc38ef1b2d11db53dacaa1abd64c8fedff9554d26ba19419a"],
    GetMatchingSubProgram: [0x5e4eb8, 0x5e55a8, "5c9c04efabee614548964f7ef8be069cd05e2cc893636f6f9e64d738b02993dd"],
    FindSubProgramsToUse: [0x5dc1d4, 0x5dc560, "5b6e23375670fac5adace4c7f404d77944b8043039d55aaa88ec4416886a64bd"],
  },
  windows: {
    keywordScore: [0x5d5a54, "6d8540f84e8540f88c0500f1cf010d8aad012e8ae001679e0058200ea101679e2158200e0038302e2138302e0d00261e08010d0b2d00261e29010d0b21feff54e913094b02000014e9031f2a0001090bc0035fd6"],
    bestScoreAndTie: [0x5e4ac8, "1d00b0520800801215058052e81f00b907000014fd03172ae8031b2afb1f00b97b0700917f031aeb20040054681640f9e00316aa6123159bc3c3ff971f001d6b0dffff54"],
    strictBranch: [0x5e50cc, "886300b008615a39fa23029109008012e92f00b9280c0034c87e42b909058052e08301910871099b01a1009165c1ff97e1830191e2b30091e00316aac4feff971f0000f1f50300aa"],
    bestCall: [0x5e5264, "e1830191e2b30091e00316aa07feff97"],
    strictDefaultFalse: [0x5e2e38, "6adbff906b01889aa8f4ffd021a019914a11139108211c913f2800a9610100f9210100f9200800f93f600039"],
    strictFlagPropagation: [0x5e54ec, "08215a39806300b0896300b000801a9128611a396e6b2e9485feff17886300b008015a391f010071e0079f1a08000012806300b0896300b000401a9128211a39"],
  },
});

function sha256(data) {
  return createHash("sha256").update(data).digest("hex");
}

function zipEntry(zip, wantedName) {
  const minimum = Math.max(0, zip.length - 0x10000 - 22);
  let eocd = -1;
  for (let offset = zip.length - 22; offset >= minimum; offset -= 1) {
    if (zip.readUInt32LE(offset) === 0x06054b50) { eocd = offset; break; }
  }
  if (eocd < 0) throw new Error("ZIP end-of-central-directory was not found");
  const entryCount = zip.readUInt16LE(eocd + 10);
  let cursor = zip.readUInt32LE(eocd + 16);
  for (let index = 0; index < entryCount; index += 1) {
    if (zip.readUInt32LE(cursor) !== 0x02014b50) throw new Error("invalid ZIP central-directory entry");
    const method = zip.readUInt16LE(cursor + 10);
    const compressedSize = zip.readUInt32LE(cursor + 20);
    const uncompressedSize = zip.readUInt32LE(cursor + 24);
    const nameLength = zip.readUInt16LE(cursor + 28);
    const extraLength = zip.readUInt16LE(cursor + 30);
    const commentLength = zip.readUInt16LE(cursor + 32);
    const localOffset = zip.readUInt32LE(cursor + 42);
    const name = zip.toString("utf8", cursor + 46, cursor + 46 + nameLength);
    if (name === wantedName) {
      if (zip.readUInt32LE(localOffset) !== 0x04034b50) throw new Error(`invalid local ZIP entry ${name}`);
      const localNameLength = zip.readUInt16LE(localOffset + 26);
      const localExtraLength = zip.readUInt16LE(localOffset + 28);
      const dataStart = localOffset + 30 + localNameLength + localExtraLength;
      const compressed = zip.subarray(dataStart, dataStart + compressedSize);
      const value = method === 0 ? Buffer.from(compressed)
        : method === 8 ? inflateRawSync(compressed) : null;
      if (!value) throw new Error(`unsupported ZIP compression method ${method} for ${name}`);
      if (value.length !== uncompressedSize) throw new Error(`ZIP size mismatch for ${name}`);
      return value;
    }
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  throw new Error(`ZIP entry not found: ${wantedName}`);
}

function uint64Number(data, offset, label) {
  const value = data.readBigUInt64LE(offset);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError(`${label} exceeds safe integer range`);
  return Number(value);
}

function elfRange(elf, startRva, endRva) {
  if (elf.toString("ascii", 0, 4) !== "\x7fELF" || elf[4] !== 2 || elf[5] !== 1) {
    throw new Error("expected a little-endian ELF64 image");
  }
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

const checks = [];
const failures = [];
function check(label, condition, actual = undefined) {
  checks.push({ label, status: condition ? "proved" : "failed", actual });
  if (!condition) failures.push(label);
}

try {
  const libunity = fs.readFileSync(LIBUNITY);
  const baseApk = fs.readFileSync(BASE_APK);
  const bootConfig = zipEntry(baseApk, "assets/bin/Data/boot.config");
  check("libunity.so SHA-256", sha256(libunity) === EXPECTED.libunitySha256, sha256(libunity));
  check("base.apk SHA-256", sha256(baseApk) === EXPECTED.baseApkSha256, sha256(baseApk));
  check("Unity version", libunity.indexOf(EXPECTED.unityVersion) >= 0);
  check("boot.config SHA-256", sha256(bootConfig) === EXPECTED.bootConfigSha256, sha256(bootConfig));
  check("strict-shader-variant-matching absent", !bootConfig.includes("strict-shader-variant-matching"));
  for (const [name, [startRva, endRva, expectedHash]] of Object.entries(EXPECTED.functions)) {
    const bytes = elfRange(libunity, startRva, endRva);
    check(`${name} body SHA-256`, sha256(bytes) === expectedHash, sha256(bytes));
  }
  for (const [name, [startRva, expectedHex]] of Object.entries(EXPECTED.windows)) {
    const bytes = elfRange(libunity, startRva, startRva + expectedHex.length / 2);
    check(`${name} exact ARM64 bytes`, bytes.toString("hex") === expectedHex, bytes.toString("hex"));
  }
  const report = {
    status: failures.length ? "failed" : "proved",
    authority: "official PTCGP 1.6.0 ARM64 libunity.so + base.apk boot.config bytes",
    contract: {
      strictShaderVariantMatching: false,
      score: "popcount(requested & candidate) - 16 * popcount(candidate & ~requested)",
      tieBreak: "first-serialized-candidate",
    },
    checks,
    failures,
  };
  if (JSON_MODE) console.log(JSON.stringify(report));
  else {
    if (failures.length) throw new Error(failures.join("; "));
    console.log("Official native shader-variant selection audit OK");
    console.log("  strict variant matching: false (default + boot.config absence)");
    console.log("  best-match score:        intersection - 16 * extra candidate keywords");
    console.log("  tie break:               first serialized candidate");
  }
} catch (error) {
  console.error(`BAD official shader-variant selection audit: ${error.message}`);
  process.exit(1);
}
