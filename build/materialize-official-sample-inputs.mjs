#!/usr/bin/env node
import { createCipheriv, createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
} from "node:fs";
import path from "node:path";
import { inflateRawSync } from "node:zlib";
import { OFFICIAL_DRAW_ORDER_EVIDENCE } from "../public/render/official-draw-order.js";
import {
  loadOfficialSample,
  officialSampleDigest,
} from "./official-sample.mjs";
import {
  atomicLinkFileSync,
  atomicWriteFileSync,
} from "./atomic-publish.mjs";

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    if (!name.startsWith("--")) throw new Error(`Unexpected argument: ${name}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for ${name}`);
    }
    args[name.slice(2)] = path.resolve(value);
    index += 1;
  }
  for (const required of [
    "manifest",
    "apkm",
    "release-player",
    "release-symbols",
    "output-root",
  ]) {
    if (!args[required]) throw new Error(`--${required} is required`);
  }
  return args;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
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
      throw new Error("Invalid ZIP central-directory entry");
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
        throw new Error(`Cannot decode ZIP entry: ${name}`);
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
  throw new RangeError(
    `RVA range 0x${startRva.toString(16)}..0x${endRva.toString(16)} is not file-backed`,
  );
}

function decryptMetadata(encrypted, libil2cpp) {
  const evidence = OFFICIAL_DRAW_ORDER_EVIDENCE.metadata;
  if (encrypted.length < 4 || encrypted.readUInt32LE(0) !== encrypted.length - 4) {
    throw new Error("Encrypted global-metadata.dat length header mismatch");
  }
  const table = elfRange(
    libil2cpp,
    evidence.keyTableRva,
    evidence.keyTableRva + 16,
  );
  if (table.toString("hex") !== evidence.keyTableBytesHex) {
    throw new Error("Official metadata key-table bytes changed");
  }
  const key8 = Buffer.from("d4ac0576fb920d61", "hex");
  const key = Buffer.alloc(16);
  for (let index = 0; index < key.length; index += 1) {
    key[index] = table[index] ^ key8[index & 7];
  }
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
  if (plaintext.readUInt32LE(0) !== 0xfab11baf) {
    throw new Error("Decrypted global-metadata.dat magic mismatch");
  }
  return plaintext;
}

function assertArtifact(label, bytes, expected) {
  if (bytes.length !== expected.byteLength) {
    throw new Error(
      `${label} length mismatch: expected ${expected.byteLength}, got ${bytes.length}`,
    );
  }
  const digest = sha256(bytes);
  if (digest !== expected.sha256) {
    throw new Error(
      `${label} SHA-256 mismatch: expected ${expected.sha256}, got ${digest}`,
    );
  }
}

function persistBytes(outputRoot, relativePath, bytes, expected) {
  assertArtifact(relativePath, bytes, expected);
  const destination = path.join(outputRoot, ...relativePath.split("/"));
  mkdirSync(path.dirname(destination), { recursive: true });
  if (existsSync(destination)) {
    const existing = readFileSync(destination);
    assertArtifact(relativePath, existing, expected);
    return destination;
  }
  atomicWriteFileSync(destination, bytes);
  return destination;
}

function persistLink(outputRoot, relativePath, source, expected) {
  const bytes = readFileSync(source);
  assertArtifact(relativePath, bytes, expected);
  const destination = path.join(outputRoot, ...relativePath.split("/"));
  mkdirSync(path.dirname(destination), { recursive: true });
  if (existsSync(destination)) {
    const existing = readFileSync(destination);
    assertArtifact(relativePath, existing, expected);
    return destination;
  }
  atomicLinkFileSync(source, destination, {
    validate(staging) {
      assertArtifact(relativePath, readFileSync(staging), expected);
    },
  });
  return destination;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const loaded = loadOfficialSample(args.manifest);
  const sample = loaded.sample;
  if (
    sample.sampleId !== "ptcgp-1.6.0-unity-2022.3.62f2-proof-r2" ||
    sample.unity.serializedVersion !== "2022.3.62f2"
  ) {
    throw new Error("This metadata materializer is locked to the proof-r2 sample");
  }

  const apkm = readFileSync(args.apkm);
  assertArtifact("apkm", apkm, sample.artifacts.apkm);
  const baseApk = zipEntry(apkm, sample.artifacts.baseApk.entry);
  const arm64Split = zipEntry(apkm, sample.artifacts.arm64Split.entry);
  const bundledTreeSplit = zipEntry(
    apkm,
    sample.artifacts.bundledTreeSplit.entry,
  );
  const libunity = zipEntry(
    arm64Split,
    sample.artifacts.libunity.entry.split("!").at(-1),
  );
  const libil2cpp = zipEntry(
    arm64Split,
    sample.artifacts.libil2cpp.entry.split("!").at(-1),
  );
  const encryptedMetadata = zipEntry(
    baseApk,
    sample.artifacts.globalMetadataEncrypted.entry.split("!").at(-1),
  );
  const metadata = decryptMetadata(encryptedMetadata, libil2cpp);
  const bootConfig = zipEntry(
    baseApk,
    sample.artifacts.bootConfig.entry.split("!").at(-1),
  );
  const globalGameManagers = zipEntry(
    baseApk,
    sample.artifacts.globalGameManagers.entry.split("!").at(-1),
  );

  const rows = [
    ["package/game.apkm", () => persistLink(
      args["output-root"],
      "package/game.apkm",
      args.apkm,
      sample.artifacts.apkm,
    ), sample.artifacts.apkm],
    ["package/base.apk", () => persistBytes(
      args["output-root"],
      "package/base.apk",
      baseApk,
      sample.artifacts.baseApk,
    ), sample.artifacts.baseApk],
    ["package/split_config.arm64_v8a.apk", () => persistBytes(
      args["output-root"],
      "package/split_config.arm64_v8a.apk",
      arm64Split,
      sample.artifacts.arm64Split,
    ), sample.artifacts.arm64Split],
    ["package/split_bundledtree.apk", () => persistBytes(
      args["output-root"],
      "package/split_bundledtree.apk",
      bundledTreeSplit,
      sample.artifacts.bundledTreeSplit,
    ), sample.artifacts.bundledTreeSplit],
    ["native/libunity.so", () => persistBytes(
      args["output-root"],
      "native/libunity.so",
      libunity,
      sample.artifacts.libunity,
    ), sample.artifacts.libunity],
    ["native/libil2cpp.so", () => persistBytes(
      args["output-root"],
      "native/libil2cpp.so",
      libil2cpp,
      sample.artifacts.libil2cpp,
    ), sample.artifacts.libil2cpp],
    ["metadata/global-metadata.encrypted.dat", () => persistBytes(
      args["output-root"],
      "metadata/global-metadata.encrypted.dat",
      encryptedMetadata,
      sample.artifacts.globalMetadataEncrypted,
    ), sample.artifacts.globalMetadataEncrypted],
    ["metadata/global-metadata.dat", () => persistBytes(
      args["output-root"],
      "metadata/global-metadata.dat",
      metadata,
      sample.artifacts.globalMetadataPlaintext,
    ), sample.artifacts.globalMetadataPlaintext],
    ["data/boot.config", () => persistBytes(
      args["output-root"],
      "data/boot.config",
      bootConfig,
      sample.artifacts.bootConfig,
    ), sample.artifacts.bootConfig],
    ["data/globalgamemanagers", () => persistBytes(
      args["output-root"],
      "data/globalgamemanagers",
      globalGameManagers,
      sample.artifacts.globalGameManagers,
    ), sample.artifacts.globalGameManagers],
    ["unity-release/libunity.release.arm64.so", () => persistLink(
      args["output-root"],
      "unity-release/libunity.release.arm64.so",
      args["release-player"],
      sample.artifacts.unityReleasePlayer,
    ), sample.artifacts.unityReleasePlayer],
    ["unity-release/libunity.release.arm64.sym.so", () => persistLink(
      args["output-root"],
      "unity-release/libunity.release.arm64.sym.so",
      args["release-symbols"],
      sample.artifacts.unityReleaseSymbols,
    ), sample.artifacts.unityReleaseSymbols],
  ];

  const artifacts = {};
  for (const [relativePath, materialize, expected] of rows) {
    const output = materialize();
    artifacts[relativePath] = {
      byteLength: statSync(output).size,
      sha256: expected.sha256,
    };
    console.log(`Materialized ${relativePath}`);
  }

  const report = {
    schemaVersion: 1,
    sampleId: sample.sampleId,
    sampleManifestSha256: officialSampleDigest(sample),
    artifacts,
  };
  const reportPath = path.join(args["output-root"], "materialized-inputs.json");
  atomicWriteFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Materialized official sample inputs: ${reportPath}`);
}

try {
  main();
} catch (error) {
  console.error(error.stack || error.message);
  process.exitCode = 1;
}
