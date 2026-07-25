#!/usr/bin/env node
// Read-only audit of serialized LocalKeywordState construction and hashing.
// Authority: official Unity release symbols, release/game libunity bytes, and canonical scenes.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CACHE = path.resolve(ROOT, "../.cache");
const GAME = path.resolve(process.env.PCR_GAME_LIBUNITY
  || path.join(CACHE, "ptcgp-1.6.0/libunity.so"));
const RELEASE = path.resolve(process.env.PCR_UNITY_RELEASE_LIBUNITY
  || path.join(CACHE, "unity-2022.3.62f2/symbols/libunity.release.arm64.so"));
const SYMBOLS = path.resolve(process.env.PCR_UNITY_RELEASE_SYMBOLS
  || path.join(CACHE, "unity-2022.3.62f2/symbols/libunity.release.arm64.sym.so"));
const JSON_MODE = process.argv.includes("--json");
const REPORT_CURRENT = process.argv.includes("--report-current");
const SEED = 0x8f37154b;
const SCHEMA = "pocket-card-render/official-local-keyword-state@1";

const EXPECTED = Object.freeze({
  gameSha256: "43a04223f94b6ca0c7cf128b399fe0656c57b5a18a10bf21bb9ce27aeb219722",
  releaseSha256: "9250260245fdbe960845d785e42418890e62ca586d2566e1d4c146c294cd637a",
  symbolsSha256: "2244367020161ab6f84350dba36ef2c44e645014c056c3cd427b13e9efa05969",
  rows: 88,
  materials: 70,
  rowsSha256: "68ce8d730eaa4b95ce31470ed8df5000035415a50facb5f156a33ddffc53ce47",
  materialsSha256: "558239bfc058d975948175a23cda9eb4751ba1162b491e3ebb20a2fd9e38eca4",
  auditSha256: "746e3bd0b8d35859cd758559a66a92b70b5b9497382e0267b960ed0a75784698",
});

const SCENES = Object.freeze([
  ["scene.cPK_10_000040_00_FUSHIGIBANAex_RR.json", "cPK_10_000040_00_FUSHIGIBANAex_RR"],
  ["scene.cPK_20_008900_02_HOUOUex_UR.json", "cPK_20_008900_02_HOUOUex_UR"],
  ["scene.cTR_20_000230_00_LEAF_SR.json", "cTR_20_000230_00_LEAF_SR"],
  ["scene.cTR_20_000670_00_IIBUINOBAKKU_UR.json", "cTR_20_000670_00_IIBUINOBAKKU_UR"],
]);

const FUNCTIONS = Object.freeze([
  ["fillKeywordSpace", 0x88c4e0, 0x5b5c54, 0xb0, 0, 56,
    "_ZN9ShaderLab16SerializedShader16FillKeywordSpaceERN8keywords10LocalSpaceE",
    "1811c164af2027e6861d30245a0137427de8d095750a7024c7108cd7310b4d48",
    "8fc27fb2295a70a606575696038c49490da350f3e8114187096ecba62afa39f4"],
  ["localSpaceAdd", 0x8b1e28, 0x5d5db8, 0x74, 32, 80,
    "_ZN8keywords10LocalSpace3AddERKN4core12basic_stringIcNS1_20StringStorageDefaultIcEEEENS_14GlobalOverrideE",
    "8d5ee373eb36f037a5df3f2af94e2c9c7e419680f383ea037d7f99824afe1eda",
    "083ffea388aa6ea9fb39e9ae57cbcbf2a832367da01660578e6ac7c335a0f8cc"],
  ["addNewKeyword", 0x8b1e9c, 0x5d5e2c, 0x1c8, 344, 96,
    "_ZN8keywords10LocalSpace13AddNewKeywordERKN4core12basic_stringIcNS1_20StringStorageDefaultIcEEEENS_14GlobalOverrideEb",
    "6fe2aa62dde1b521d621a6ff22e83fa141fd1127e877fb9b89375a94a5d739a8",
    "d340628fdcbb317a1af67633f74a877e1c41b043ffc4eb29c45fff5f4dd9e4f2"],
  ["stateFromKeywordNames", 0x8b272c, 0x5d6720, 0x6c, 0, 32,
    "_ZNK8keywords10LocalSpace21StateFromKeywordNamesERKN4core6vectorINS1_12basic_stringIcNS1_20StringStorageDefaultIcEEEELm0EEERNS_17LocalKeywordStateE",
    "95e9668a512eaa2eacb4e09b94d996b6f2d70df7fdd7f7370052becf8a681131",
    "efdf18135908628852e4726594d2adaaee2c999a85bcc2d6c50606cc7d4bc9ad"],
  ["enableName", 0x8b091c, 0x5d4da8, 0x90, 28, 96,
    "_ZNK8keywords10LocalSpace6EnableERKN4core12basic_stringIcNS1_20StringStorageDefaultIcEEEERNS_17LocalKeywordStateE",
    "3c0eb046094f5457813e7d779ea8c59844e8274e5bf826703e52ea212b3ad6ad",
    "c45c7bce8f4da286a251c2cfb609201fdd345cfaf4551d73191a5e71503920a8"],
  ["getHash", 0x81f6cc, 0x5504d8, 0x30, 0, 40,
    "_ZNK8keywords17LocalKeywordState7GetHashEv",
    "1032a38913bad6978360e536077208916313cdf9d3ff6c3856fc0ef4ed0d88e6",
    "a4ab44edee789c496d57696469f1e3f33023ba3563863f9cccf3b45a4464ef3c"],
].map(([id, officialRva, gameRva, size, signatureOffset, signatureSize, symbol,
  releaseHash, gameHash]) => Object.freeze({
  id, officialRva, gameRva, size, signatureOffset, signatureSize, symbol, releaseHash, gameHash,
})));

// These identical release/game instructions establish the serialized order, index, bit, and hash layout.
const INSTRUCTIONS = Object.freeze({
  fillKeywordSpace: [[0x3c, "762a40f9"], [0x44, "f7031faa"], [0x48, "f8031faa"],
    [0x50, "683240f9"], [0x64, "0101178b"], [0x88, "18070091"],
    [0x8c, "df0218eb"], [0x90, "f7a20091"], [0x94, "e1fdff54"]],
  localSpaceAdd: [[0x24, "aa0240f9"], [0x28, "e80340f9"], [0x2c, "2bf17dd3"],
    [0x30, "690109cb"], [0x34, "4901098b"], [0x38, "29e10091"],
    [0x3c, "1f0109eb"], [0x40, "60000054"], [0x4c, "e00315aa"],
    [0x50, "e10314aa"], [0x54, "e203132a"], [0x58, "e3031f2a"]],
  addNewKeyword: [[0x48, "681a40f9"], [0x50, "e8330079"], [0x58, "681240f9"],
    [0x5c, "691a40f9"], [0x60, "0a058052"], [0x64, "e2630091"],
    [0x68, "e00313aa"], [0x6c, "28210a9b"], [0x70, "01a100d1"],
    [0x74, "e8030091"]],
  stateFromKeywordNames: [[0x10, "400c00f9"], [0x24, "a11a40f9"],
    [0x28, "e00313aa"], [0x30, "960a40f9"], [0x38, "f7031faa"],
    [0x3c, "880240f9"], [0x48, "0101178b"], [0x50, "d60600f1"],
    [0x54, "f7a20091"], [0x58, "21ffff54"]],
  enableName: [[0x1c, "890a40b9"], [0x20, "8a0240f9"], [0x24, "e80340f9"],
    [0x28, "2bf17dd3"], [0x2c, "690109cb"], [0x30, "4901098b"],
    [0x34, "29e10091"], [0x38, "1f0109eb"], [0x40, "0a614079"],
    [0x44, "6b8e40f8"], [0x48, "4cfd43d3"], [0x50, "8c257d92"],
    [0x54, "6b010c8b"], [0x58, "6c020c8b"], [0x5c, "bf0502f1"],
    [0x60, "8b318b9a"], [0x64, "6c0140f9"], [0x68, "2d008052"],
    [0x6c, "aa21ca9a"], [0x70, "8a010aaa"], [0x74, "6a0100f9"]],
  getHash: [[0x00, "081040f9"], [0x04, "00200091"], [0x08, "1f0102f1"],
    [0x0c, "49000054"], [0x10, "000040f9"], [0x14, "09fd46d3"],
    [0x18, "1f1540f2"], [0x1c, "2805899a"], [0x20, "62a98252"],
    [0x24, "01f17dd3"], [0x28, "e2e6b172"]],
});

const CALLS = Object.freeze([
  ["fillKeywordSpace", 0x68, 0x8b1e28, 0x5d5db8],
  ["localSpaceAdd", 0x5c, 0x8b1e9c, 0x5d5e2c],
  ["stateFromKeywordNames", 0x20, 0x8b1554, 0x5d5480],
  ["stateFromKeywordNames", 0x2c, 0x8affe8, 0x5d498c],
  ["stateFromKeywordNames", 0x4c, 0x8b091c, 0x5d4da8],
  ["getHash", 0x2c, 0x11abd3c, 0xcab7ec],
]);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function safeNumber(value, label) {
  const result = Number(value);
  requireCondition(Number.isSafeInteger(result), `${label} exceeds exact integer range`);
  return result;
}

function readElf(buffer, label) {
  requireCondition(buffer.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46])), `${label}: not ELF`);
  requireCondition(buffer[4] === 2 && buffer[5] === 1, `${label}: expected ELF64 LE`);
  const phoff = safeNumber(buffer.readBigUInt64LE(0x20), `${label} phoff`);
  const shoff = safeNumber(buffer.readBigUInt64LE(0x28), `${label} shoff`);
  const phentsize = buffer.readUInt16LE(0x36);
  const phnum = buffer.readUInt16LE(0x38);
  const shentsize = buffer.readUInt16LE(0x3a);
  const shnum = buffer.readUInt16LE(0x3c);
  const shstrndx = buffer.readUInt16LE(0x3e);
  const segments = [];
  for (let i = 0; i < phnum; i += 1) {
    const offset = phoff + i * phentsize;
    if (buffer.readUInt32LE(offset) !== 1) continue;
    segments.push({
      fileOffset: safeNumber(buffer.readBigUInt64LE(offset + 8), `${label} segment offset`),
      address: safeNumber(buffer.readBigUInt64LE(offset + 16), `${label} segment address`),
      size: safeNumber(buffer.readBigUInt64LE(offset + 32), `${label} segment size`),
    });
  }
  const rawSections = [];
  for (let i = 0; i < shnum; i += 1) {
    const offset = shoff + i * shentsize;
    rawSections.push({
      nameOffset: buffer.readUInt32LE(offset),
      fileOffset: safeNumber(buffer.readBigUInt64LE(offset + 24), `${label} section offset`),
      size: safeNumber(buffer.readBigUInt64LE(offset + 32), `${label} section size`),
      link: buffer.readUInt32LE(offset + 40),
      entrySize: safeNumber(buffer.readBigUInt64LE(offset + 56), `${label} section entsize`),
    });
  }
  const namesSection = rawSections[shstrndx];
  const names = buffer.subarray(namesSection.fileOffset, namesSection.fileOffset + namesSection.size);
  const sections = rawSections.map((section) => {
    const end = names.indexOf(0, section.nameOffset);
    return { ...section, name: names.toString("utf8", section.nameOffset, end) };
  });
  return { buffer, label, segments, sections };
}

function elfRange(elf, start, end) {
  const segment = elf.segments.find((item) => start >= item.address && end <= item.address + item.size);
  requireCondition(segment, `${elf.label}: range 0x${start.toString(16)}..0x${end.toString(16)} is not file-backed`);
  const offset = segment.fileOffset + start - segment.address;
  return elf.buffer.subarray(offset, offset + end - start);
}

function readFunctionSymbols(elf) {
  const symtab = elf.sections.find((section) => section.name === ".symtab");
  requireCondition(symtab?.entrySize === 24, `${elf.label}: missing ELF64 .symtab`);
  const strtab = elf.sections[symtab.link];
  const strings = elf.buffer.subarray(strtab.fileOffset, strtab.fileOffset + strtab.size);
  const symbols = new Set();
  for (let offset = symtab.fileOffset; offset < symtab.fileOffset + symtab.size; offset += 24) {
    if ((elf.buffer[offset + 4] & 0x0f) !== 2) continue;
    const nameOffset = elf.buffer.readUInt32LE(offset);
    const end = strings.indexOf(0, nameOffset);
    const name = strings.toString("utf8", nameOffset, end);
    const address = safeNumber(elf.buffer.readBigUInt64LE(offset + 8), "symbol address");
    const size = safeNumber(elf.buffer.readBigUInt64LE(offset + 16), "symbol size");
    if (address) symbols.add(`${address}:${size}:${name}`);
  }
  return symbols;
}

function branchTarget(elf, address) {
  const instruction = elfRange(elf, address, address + 4).readUInt32LE(0);
  requireCondition((instruction & 0x7c000000) === 0x14000000, `0x${address.toString(16)} is not B/BL`);
  let immediate = instruction & 0x03ffffff;
  if (immediate & 0x02000000) immediate -= 0x04000000;
  return address + immediate * 4;
}

function occurrenceCount(buffer, needle) {
  let count = 0;
  for (let offset = buffer.indexOf(needle); offset >= 0; offset = buffer.indexOf(needle, offset + 1)) count += 1;
  return count;
}

function rotl32(value, count) {
  return ((value << count) | (value >>> (32 - count))) >>> 0;
}

function xxh32(bytes, seed = 0) {
  const p1 = 0x9e3779b1;
  const p2 = 0x85ebca77;
  const p3 = 0xc2b2ae3d;
  const p4 = 0x27d4eb2f;
  const p5 = 0x165667b1;
  const u32 = (value) => value >>> 0;
  const round = (accumulator, input) => u32(Math.imul(rotl32(u32(accumulator + Math.imul(input, p2)), 13), p1));
  let offset = 0;
  let hash;
  if (bytes.length >= 16) {
    let v1 = u32(seed + p1 + p2);
    let v2 = u32(seed + p2);
    let v3 = u32(seed);
    let v4 = u32(seed - p1);
    while (offset <= bytes.length - 16) {
      v1 = round(v1, bytes.readUInt32LE(offset));
      v2 = round(v2, bytes.readUInt32LE(offset + 4));
      v3 = round(v3, bytes.readUInt32LE(offset + 8));
      v4 = round(v4, bytes.readUInt32LE(offset + 12));
      offset += 16;
    }
    hash = u32(rotl32(v1, 1) + rotl32(v2, 7) + rotl32(v3, 12) + rotl32(v4, 18));
  } else {
    hash = u32(seed + p5);
  }
  hash = u32(hash + bytes.length);
  while (offset <= bytes.length - 4) {
    hash = u32(Math.imul(rotl32(u32(hash + Math.imul(bytes.readUInt32LE(offset), p3)), 17), p4));
    offset += 4;
  }
  while (offset < bytes.length) {
    hash = u32(Math.imul(rotl32(u32(hash + Math.imul(bytes[offset], p5)), 11), p1));
    offset += 1;
  }
  hash ^= hash >>> 15;
  hash = u32(Math.imul(hash, p2));
  hash ^= hash >>> 13;
  hash = u32(Math.imul(hash, p3));
  hash ^= hash >>> 16;
  return u32(hash);
}

function asciiCompare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value).sort(asciiCompare)
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
}

function digest(value) {
  return sha256(Buffer.from(canonicalJson(value), "ascii"));
}

function buildState(names, validKeywords, label) {
  assert.equal(new Set(names).size, names.length, `${label}: duplicate shader keyword name`);
  const bits = Buffer.alloc(Math.ceil(names.length / 64) * 8);
  const enabledIndices = validKeywords.map((name) => {
    const index = names.indexOf(name);
    assert.notEqual(index, -1, `${label}: valid keyword ${name} is absent from shader keyword space`);
    bits[index >>> 3] |= 1 << (index & 7);
    return index;
  });
  const hash = xxh32(bits, SEED);
  return {
    shaderKeywordNames: names,
    validKeywords,
    keywordCount: names.length,
    enabledIndices,
    bitsetHex: bits.toString("hex"),
    byteLength: bits.length,
    hash,
    hashHex: `0x${hash.toString(16).padStart(8, "0")}`,
    low8: hash & 0xff,
  };
}

function main() {
  for (const filename of [GAME, RELEASE, SYMBOLS]) requireCondition(fs.existsSync(filename), `missing official input ${filename}`);
  const gameBytes = fs.readFileSync(GAME);
  const releaseBytes = fs.readFileSync(RELEASE);
  const symbolBytes = fs.readFileSync(SYMBOLS);
  assert.equal(sha256(gameBytes), EXPECTED.gameSha256, "game libunity SHA-256");
  assert.equal(sha256(releaseBytes), EXPECTED.releaseSha256, "release libunity SHA-256");
  assert.equal(sha256(symbolBytes), EXPECTED.symbolsSha256, "release symbols SHA-256");
  const game = readElf(gameBytes, "game libunity");
  const release = readElf(releaseBytes, "release libunity");
  const symbols = readFunctionSymbols(readElf(symbolBytes, "release symbols"));
  const functionMap = new Map(FUNCTIONS.map((item) => [item.id, item]));

  for (const item of FUNCTIONS) {
    requireCondition(symbols.has(`${item.officialRva}:${item.size}:${item.symbol}`), `${item.id}: official symbol mismatch`);
    const releaseFunction = elfRange(release, item.officialRva, item.officialRva + item.size);
    const gameFunction = elfRange(game, item.gameRva, item.gameRva + item.size);
    assert.equal(sha256(releaseFunction), item.releaseHash, `${item.id}: release function slice hash`);
    assert.equal(sha256(gameFunction), item.gameHash, `${item.id}: game function slice hash`);
    const releaseSignature = releaseFunction.subarray(item.signatureOffset, item.signatureOffset + item.signatureSize);
    const gameSignature = gameFunction.subarray(item.signatureOffset, item.signatureOffset + item.signatureSize);
    assert.ok(releaseSignature.equals(gameSignature), `${item.id}: release/game signature mismatch`);
    assert.equal(occurrenceCount(releaseBytes, releaseSignature), 1, `${item.id}: release signature is not unique`);
    assert.equal(occurrenceCount(gameBytes, gameSignature), 1, `${item.id}: game signature is not unique`);
    for (const [offset, hex] of INSTRUCTIONS[item.id]) {
      assert.equal(elfRange(release, item.officialRva + offset, item.officialRva + offset + 4).toString("hex"), hex,
        `${item.id}: release instruction +0x${offset.toString(16)}`);
      assert.equal(elfRange(game, item.gameRva + offset, item.gameRva + offset + 4).toString("hex"), hex,
        `${item.id}: game instruction +0x${offset.toString(16)}`);
    }
  }
  for (const [callerId, offset, officialTarget, gameTarget] of CALLS) {
    const caller = functionMap.get(callerId);
    assert.equal(branchTarget(release, caller.officialRva + offset), officialTarget, `${callerId}: release call target`);
    assert.equal(branchTarget(game, caller.gameRva + offset), gameTarget, `${callerId}: game call target`);
  }
  requireCondition([...symbols].some((item) => item.startsWith("18529596:224:UNITY_XXH32")),
    "official UNITY_XXH32 symbol mismatch");

  assert.equal(xxh32(Buffer.alloc(0), 0), 0x02cc5d05, "XXH32 empty test vector");
  assert.equal(xxh32(Buffer.from("a"), 0), 0x550d7456, "XXH32 a test vector");
  assert.equal(xxh32(Buffer.from("abc"), 0), 0x32d153ff, "XXH32 abc test vector");

  const rows = [];
  const materialStates = new Map();
  for (const [sceneFile, cardId] of SCENES) {
    const scene = JSON.parse(fs.readFileSync(path.join(ROOT, "public", sceneFile), "utf8"));
    assert.equal(scene.card?.id, cardId, `${sceneFile}: card ID`);
    for (const [materialName, material] of Object.entries(scene.materials)
      .sort(([left], [right]) => asciiCompare(left, right))) {
      const official = material.official;
      assert.ok(Array.isArray(official?.shaderKeywordNames), `${sceneFile}:${materialName}: shaderKeywordNames`);
      assert.ok(Array.isArray(official?.validKeywords), `${sceneFile}:${materialName}: validKeywords`);
      const state = buildState(official.shaderKeywordNames, official.validKeywords, `${sceneFile}:${materialName}`);
      const sort = material.sort;
      assert.equal(sort.localKeywordCount, state.keywordCount, `${sceneFile}:${materialName}: scene keyword count`);
      assert.equal(sort.serializedLocalKeywordStateHex, state.bitsetHex, `${sceneFile}:${materialName}: scene bitset`);
      assert.equal(sort.serializedLocalKeywordHash, state.hash, `${sceneFile}:${materialName}: scene hash`);
      assert.equal(sort.serializedLocalKeywordHashLow8, state.low8, `${sceneFile}:${materialName}: scene hash low8`);
      const materialState = { materialIdentity: official.material, shaderIdentity: official.shader, ...state };
      const previous = materialStates.get(official.material);
      if (previous) assert.equal(canonicalJson(previous), canonicalJson(materialState), `${official.material}: reused state drift`);
      else materialStates.set(official.material, materialState);
      rows.push({ sceneFile, cardId, materialName, ...materialState });
    }
  }
  const materials = [...materialStates.values()]
    .sort((left, right) => asciiCompare(left.materialIdentity, right.materialIdentity));
  const digests = {
    rowsSha256: digest(rows),
    materialsSha256: digest(materials),
    auditSha256: digest({ schema: SCHEMA, seed: SEED, rows, materials }),
  };
  if (REPORT_CURRENT) {
    console.log(JSON.stringify({ rows: rows.length, materials: materials.length, ...digests }, null, 2));
    return;
  }
  assert.equal(rows.length, EXPECTED.rows, "canonical row count");
  assert.equal(materials.length, EXPECTED.materials, "canonical Material count");
  assert.deepEqual(digests, {
    rowsSha256: EXPECTED.rowsSha256,
    materialsSha256: EXPECTED.materialsSha256,
    auditSha256: EXPECTED.auditSha256,
  }, "canonical LocalKeywordState digest drift");

  const fullEfm = rows.filter((row) => /_EFM[12]$/.test(row.materialName)
    && row.validKeywords.includes("_UseGradationMap") && row.validKeywords.includes("_UseViewMask"));
  assert.equal(fullEfm.filter((row) => /_EFM1$/.test(row.materialName)).length, 3, "full-state EFM1 rows");
  assert.equal(fullEfm.filter((row) => /_EFM2$/.test(row.materialName)).length, 3, "full-state EFM2 rows");
  assert.ok(fullEfm.filter((row) => /_EFM1$/.test(row.materialName)).every((row) => row.low8 === 56), "EFM1 low8");
  assert.ok(fullEfm.filter((row) => /_EFM2$/.test(row.materialName)).every((row) => row.low8 === 11), "EFM2 low8");

  const report = { schema: SCHEMA, seed: SEED, functions: FUNCTIONS.length,
    instructionChecks: Object.values(INSTRUCTIONS).reduce((sum, entries) => sum + entries.length, 0),
    rows: rows.length, materials: materials.length, digests,
    effectFullStateLow8: { EFM1: 56, EFM2: 11 }, records: JSON_MODE ? rows : undefined };
  if (JSON_MODE) console.log(JSON.stringify(report, null, 2));
  else {
    console.log("Official LocalKeywordState audit OK");
    console.log(`  native      ${FUNCTIONS.length} symbols/slices; ${report.instructionChecks} AArch64 instructions`);
    console.log(`  canonical   ${rows.length} rows / ${materials.length} Materials`);
    console.log(`  rows        ${digests.rowsSha256}`);
    console.log(`  materials   ${digests.materialsSha256}`);
    console.log(`  audit       ${digests.auditSha256}`);
    console.log("  Effect      full-state EFM1/EFM2 hash low8 = 56/11");
  }
}

try {
  main();
} catch (error) {
  console.error(`BAD official LocalKeywordState audit: ${error.message}`);
  process.exitCode = 1;
}
