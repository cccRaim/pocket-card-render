#!/usr/bin/env node
// Read-only, screenshot-free audit of native draw-order evidence in the
// official 1.6.0 APKM. It does not consume scene, recipe, or report output.
import fs from "node:fs";
import path from "node:path";
import { createCipheriv, createHash } from "node:crypto";
import { inflateRawSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import {
  OFFICIAL_DRAW_ORDER_EVIDENCE,
  OFFICIAL_PASS_CRITERIA,
  OFFICIAL_SORTING_CRITERIA,
} from "../public/render/official-draw-order.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const APKM = path.resolve(process.env.PCR_APKM
  || "D:/DevProjectes/ptcg-apk-parser/apks/jp.pokemon.pokemontcgp_1.6.0.apkm");
const JSON_MODE = process.argv.includes("--json");

function sha256(data) {
  return createHash("sha256").update(data).digest("hex");
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
        : method === 8 ? inflateRawSync(compressed)
          : null;
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

function decryptMetadata(encrypted, libil2cpp) {
  const evidence = OFFICIAL_DRAW_ORDER_EVIDENCE.metadata;
  if (encrypted.length < 4 || encrypted.readUInt32LE(0) !== encrypted.length - 4) {
    throw new Error("encrypted global-metadata.dat length header mismatch");
  }
  const table = elfRange(libil2cpp, evidence.keyTableRva, evidence.keyTableRva + 16);
  const key8 = Buffer.from("d4ac0576fb920d61", "hex");
  const key = Buffer.alloc(16);
  for (let index = 0; index < key.length; index += 1) key[index] = table[index] ^ key8[index & 7];

  const ciphertext = encrypted.subarray(4);
  const counters = Buffer.alloc(ciphertext.length);
  for (let offset = 0, counter = 1; offset < counters.length; offset += 16, counter += 1) {
    counters.writeUInt32BE(counter, offset + 12);
  }
  const aes = createCipheriv("aes-128-ecb", key, null);
  aes.setAutoPadding(false);
  const stream = Buffer.concat([aes.update(counters), aes.final()]);
  const plaintext = Buffer.allocUnsafe(ciphertext.length);
  for (let index = 0; index < ciphertext.length; index += 1) {
    plaintext[index] = ciphertext[index] ^ stream[index];
  }
  return { plaintext, table };
}

const checks = [];
const failures = [];
function check(category, label, condition, actual = undefined) {
  checks.push({ category, label, status: condition ? "proved" : "failed", actual });
  if (!condition) failures.push(`${category}: ${label}`);
}

function checkSlice(libraryName, library, name, expected) {
  const bytes = elfRange(library, expected.startRva, expected.endRva);
  check(libraryName, `${name} RVA size`, bytes.length === expected.byteSize, bytes.length);
  check(libraryName, `${name} SHA-256`, sha256(bytes) === expected.sha256, sha256(bytes));
  if (expected.bytesHex) {
    check(libraryName, `${name} exact bytes`, bytes.toString("hex") === expected.bytesHex, bytes.toString("hex"));
  }
}

let report;
try {
  const apkm = fs.readFileSync(APKM);
  const baseApk = zipEntry(apkm, "base.apk");
  const arm64Split = zipEntry(apkm, "split_config.arm64_v8a.apk");
  const libunity = zipEntry(arm64Split, "lib/arm64-v8a/libunity.so");
  const libil2cpp = zipEntry(arm64Split, "lib/arm64-v8a/libil2cpp.so");
  const encryptedMetadata = zipEntry(baseApk, "assets/bin/Data/Managed/Metadata/global-metadata.dat");
  const expectedPackage = OFFICIAL_DRAW_ORDER_EVIDENCE.package;

  check("source", "official APKM SHA-256", sha256(apkm) === expectedPackage.apkmSha256, sha256(apkm));
  check("source", "base.apk SHA-256", sha256(baseApk) === expectedPackage.baseApkSha256, sha256(baseApk));
  check("source", "arm64 split SHA-256", sha256(arm64Split) === expectedPackage.arm64SplitSha256, sha256(arm64Split));
  check("source", "libunity.so SHA-256", sha256(libunity) === expectedPackage.libunitySha256, sha256(libunity));
  check("source", "libil2cpp.so SHA-256", sha256(libil2cpp) === expectedPackage.libil2cppSha256, sha256(libil2cpp));
  check("source", "Unity version note string", libunity.indexOf(expectedPackage.unityVersion) >= 0);

  const metadataExpected = OFFICIAL_DRAW_ORDER_EVIDENCE.metadata;
  check("metadata", "encrypted byte size", encryptedMetadata.length === metadataExpected.encryptedByteSize, encryptedMetadata.length);
  check("metadata", "encrypted SHA-256", sha256(encryptedMetadata) === metadataExpected.encryptedSha256, sha256(encryptedMetadata));
  const { plaintext, table } = decryptMetadata(encryptedMetadata, libil2cpp);
  check("metadata", "key-table exact bytes", table.toString("hex") === metadataExpected.keyTableBytesHex, table.toString("hex"));
  check("metadata", "key-table SHA-256", sha256(table) === metadataExpected.keyTableSha256, sha256(table));
  check("metadata", "plaintext byte size", plaintext.length === metadataExpected.plaintextByteSize, plaintext.length);
  check("metadata", "plaintext SHA-256", sha256(plaintext) === metadataExpected.plaintextSha256, sha256(plaintext));
  check("metadata", "magic/version", plaintext.readUInt32LE(0) === metadataExpected.magic
    && plaintext.readUInt32LE(4) === metadataExpected.version,
  { magic: `0x${plaintext.readUInt32LE(0).toString(16)}`, version: plaintext.readUInt32LE(4) });
  for (const value of ["SortingCriteria", "CommonOpaque", "CommonTransparent", "QuantizedFrontToBack", "OptimizeStateChanges", "defaultOpaqueSortFlags", "DrawObjectsPass"]) {
    check("metadata", `contains ${value}`, plaintext.indexOf(value) >= 0);
  }

  for (const [name, expected] of Object.entries(OFFICIAL_DRAW_ORDER_EVIDENCE.libunitySlices)) {
    checkSlice("libunity", libunity, name, expected);
  }
  for (const [name, expected] of Object.entries(OFFICIAL_DRAW_ORDER_EVIDENCE.libil2cppSlices)) {
    checkSlice("libil2cpp", libil2cpp, name, expected);
  }

  check("contract", "CommonOpaque bit contract", OFFICIAL_SORTING_CRITERIA.CommonOpaque === 0x3b
    && OFFICIAL_PASS_CRITERIA.DrawOpaque.criteria === 0x3b);
  check("contract", "CommonTransparent bit contract", OFFICIAL_SORTING_CRITERIA.CommonTransparent === 0x17
    && OFFICIAL_PASS_CRITERIA.DrawTransparent.criteria === 0x17);
  check("contract", "visible-node distance offset producer", /float@0x108 load/.test(OFFICIAL_PASS_CRITERIA.boundaries.f)
    && /explicit-zero alternate path/.test(OFFICIAL_PASS_CRITERIA.boundaries.f));
  check("boundaries", "defaultOpaqueSortFlags remains explicitly unproved", /not proved/.test(OFFICIAL_PASS_CRITERIA.boundaries.defaultOpaqueSortFlags));

  report = {
    status: failures.length ? "failed" : "proved-with-explicit-boundaries",
    source: { apkm: APKM, authority: "official package bytes only" },
    checks,
    failures,
    boundaries: OFFICIAL_PASS_CRITERIA.boundaries,
  };
} catch (error) {
  console.error(`BAD official native draw-order audit: ${error.message}`);
  process.exit(1);
}

if (JSON_MODE) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`Official native draw-order audit ${failures.length ? "FAILED" : "OK"}`);
  console.log(`Checks: ${checks.length - failures.length}/${checks.length} passed; package bytes only; no screenshots`);
  console.log("Contracts: Float32 distance -> MSB bucket; raw Optimize branches; final node/candidate tie; opaque=0x3b transparent=0x17");
  console.log("Unproved: float@0x108 public semantic name; generic URP defaultOpaqueSortFlags runtime value; remaining raw Optimize member/flag names; exceptional FP environment");
  for (const failure of failures) console.error(`BAD ${failure}`);
}

if (failures.length) process.exit(1);
