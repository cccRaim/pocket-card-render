#!/usr/bin/env node
// Read-only audit of Unity's native InstanceID remapping path.
// Authority: the official Unity release binary/symbols and the shipped game libunity.
// No scene, CAB payload, browser, screenshot, or renderer output is consumed.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CACHE = path.resolve(ROOT, "../.cache");
const RELEASE_LIBUNITY = path.resolve(process.env.PCR_UNITY_RELEASE_LIBUNITY
  || path.join(CACHE, "unity-2022.3.62f2/symbols/libunity.release.arm64.so"));
const RELEASE_SYMBOLS = path.resolve(process.env.PCR_UNITY_RELEASE_SYMBOLS
  || path.join(CACHE, "unity-2022.3.62f2/symbols/libunity.release.arm64.sym.so"));
const GAME_LIBUNITY = path.resolve(process.env.PCR_GAME_LIBUNITY
  || path.join(CACHE, "ptcgp-1.6.0/libunity.so"));
const JSON_MODE = process.argv.includes("--json");

const EXPECTED = Object.freeze({
  releaseSha256: "9250260245fdbe960845d785e42418890e62ca586d2566e1d4c146c294cd637a",
  releaseSymbolsSha256: "2244367020161ab6f84350dba36ef2c44e645014c056c3cd427b13e9efa05969",
  gameSha256: "43a04223f94b6ca0c7cf128b399fe0656c57b5a18a10bf21bb9ce27aeb219722",
  releaseVersion: "2022.3.62f2c1_92e6e6be66dc",
  gameVersion: "2022.3.62f2_7670c08855a9",
  increaseHighestCoreSha256: "510877586d8751232b7f32ad46c7acc2ebe37efe3e649454c8362758602b5e8f",
  constructorDefaultsHex: "000000000000000000000000ffffffff",
});

const FUNCTIONS = Object.freeze([
  [
    "remapperCtor", 0x9b6990, 0x6c2e28, 0x6c, 0x40, 44,
    "_ZN8RemapperC2E10MemLabelId",
    "b47f5cc24e9afad9e86a3dd3697cafba85d6137cb35532769f8bad6282837c48",
    "4233a2c998da00dccaa5126afad47632d7cba5cbbd4cc5806a7d67edf17e2b8e",
  ],
  [
    "getOrGenerate", 0x9b1714, 0x6bda9c, 0xc0, 0x00, 100,
    "_ZN8Remapper23GetOrGenerateInstanceIDERK26SerializedObjectIdentifier",
    "058453d380495358e167a64eaa50e1fd87db082e9b1d688b73211de48bce2f32",
    "373f832f3833adde8a77758a7b57bd976917f3619a87304e56401da13e8abd2f",
  ],
  [
    "increaseHighest", 0x9b69fc, 0x6c2e94, 0x8c, 0x00, 36,
    "_ZN8Remapper49IncreaseHighestInstanceIDAndCrashInCaseOfOverflowEi",
    "a986cf504d84e1e50713dbaa0d34f8f0a987000745b451090ed63f5cc5fa5946",
    "e5fa38c8be924d8402e87d05f4ebc8a3a256ff6d67131ed9cede5438ed8fd9d8",
  ],
  [
    "loadFileCompletelyThreaded", 0x9b45c0, 0x6c096c, 0x390, 0x00, 184,
    "_ZN17PersistentManager26LoadFileCompletelyThreadedEN4core16basic_string_refIcEEPlPiiNS_9LoadFlagsER12LoadProgressNS_9LockFlagsE",
    "0d9cf148caea05778e42c6ec5ec7640cacc65cfd937186bdbaf9e51f40e9fb5d",
    "3f27fd0c4ddd8940fe13d58dc4bbbfe2971853acbcaa56fe44f58b3970584010",
  ],
  [
    "produceObject", 0x9b3bb8, 0x6bffe8, 0x354, 0x00, 88,
    "_ZN17PersistentManager13ProduceObjectER14SerializedFile26SerializedObjectIdentifieri18ObjectCreationModeNS_9LockFlagsE",
    "d3e78987bf59626732f21c76429cfa1c4085eef62e3d7d445e1fe662329a4fda",
    "3f219a3214e62158484368e353550ec511b019d8640fff4a252594fe7c3c0136",
  ],
  [
    "objectProduce", 0x748140, 0x4888a4, 0xfc, 0x00, 112,
    "_ZN6Object7ProduceEPKN5Unity4TypeES3_i10MemLabelId18ObjectCreationMode",
    "8307822bfe11454673fd57d2e508d6d9e72ccb85c1efd81ffb1a102012304a52",
    "7dd41ff0366723cc0098f120f9ff56da1015df8319533f3f0d3bd332ba4f1a48",
  ],
  [
    "serializedIdentifierComparator", 0x9c240c, 0x6cf8f4, 0x78, 0x00, 120,
    "_ZNSt6__ndk16__treeINS_12__value_typeI26SerializedObjectIdentifieriEENS_19__map_value_compareIS2_S3_NS_4lessIS2_EELb1EEE20memory_pool_explicitIS3_EE12__find_equalIS2_EERPNS_16__tree_node_baseIPvEERPNS_15__tree_end_nodeISF_EERKT_",
    "d2cbec3fc6310456695f17598617ba7d4af2226308e738ccdd896f99df6e8b9c",
    "d2cbec3fc6310456695f17598617ba7d4af2226308e738ccdd896f99df6e8b9c",
  ],
  [
    "readAndActivate", 0x9b4098, 0x6c04c0, 0x160, 0x00, 76,
    "_ZN17PersistentManager29ReadAndActivateObjectThreadedEiRK26SerializedObjectIdentifierP14SerializedFilebbNS_9LockFlagsE",
    "66ec45d7d4b3ea802ccd98683be3fbf0806a1ea105a4fae0305d6fcb4327ec28",
    "14058090c633c2aa59ec9ff3f20d1ea372967f309923c6705fc2b25faebd5e8c",
  ],
  [
    "createActivationEntry", 0x9b3a98, 0x6bfec8, 0x120, 0x68, 132,
    "_ZN17PersistentManager32CreateThreadActivationQueueEntryER14SerializedFile26SerializedObjectIdentifieribNS_9LockFlagsE",
    "3a1b47f5ab62b68891efa01b108e74fadc0d64e89f92780a005884a7e1b97685",
    "b813509fbd2d2e7faacb272e81e66f2c78ce11e7d9e3da622d49ebe305b20b7d",
  ],
].map(([
  id, releaseStart, gameStart, size, signatureOffset, signatureSize, symbol,
  releaseFunctionSha256, gameFunctionSha256,
]) => Object.freeze({
  id,
  releaseStart,
  gameStart,
  size,
  signatureOffset,
  signatureSize,
  symbol,
  releaseFunctionSha256,
  gameFunctionSha256,
})));

const MIRRORED_WORDS = Object.freeze([
  // Constructor defaults: H=0, contiguous base/end=0, contiguous file index=-1.
  ["remapperCtor", 0x54, "9f7a00b9", "store zero at Remapper+0x78"],
  ["remapperCtor", 0x58, "938200b9", "store MemLabelId at Remapper+0x80"],
  ["remapperCtor", 0x5c, "8082883c", "store four default words at Remapper+0x88"],

  // GetOrGenerateInstanceID: sentinel and contiguous fast path.
  ["getOrGenerate", 0x0c, "280040b9", "load SerializedObjectIdentifier.fileIndex at +0"],
  ["getOrGenerate", 0x10, "1f050031", "compare fileIndex with -1 sentinel"],
  ["getOrGenerate", 0x18, "099440b9", "load contiguous fileIndex at Remapper+0x94"],
  ["getOrGenerate", 0x24, "3f050031", "test whether contiguous fileIndex is -1"],
  ["getOrGenerate", 0x2c, "3f01086b", "compare key fileIndex with contiguous fileIndex"],
  ["getOrGenerate", 0x34, "680a40b9", "load low 32 bits of pathID at key+8"],
  ["getOrGenerate", 0x38, "898e40b9", "load contiguous base at Remapper+0x8c"],
  ["getOrGenerate", 0x3c, "2005080b", "return contiguous base plus two times uint32(pathID)"],
  ["getOrGenerate", 0x44, "e0031f2a", "fileIndex -1 returns InstanceID zero"],

  // GetOrGenerateInstanceID: ordinary map path.
  ["getOrGenerate", 0x4c, "6002c03d", "copy the 16-byte SerializedObjectIdentifier"],
  ["getOrGenerate", 0x5c, "ff2300b9", "initialize map value to zero after the 16-byte key"],
  ["getOrGenerate", 0x60, "e007803d", "store the copied 16-byte key"],
  ["getOrGenerate", 0x68, "3f1c0072", "test map insertion result"],
  ["getOrGenerate", 0x74, "41008052", "new key increments highest InstanceID by two"],
  ["getOrGenerate", 0x84, "888a40b9", "load updated highest InstanceID at Remapper+0x88"],
  ["getOrGenerate", 0x94, "e80f00b9", "save newly allocated InstanceID"],
  ["getOrGenerate", 0x98, "a83200b9", "cache new InstanceID in the key map node at +0x30"],
  ["getOrGenerate", 0xac, "a03240b9", "duplicate key reuses the map node InstanceID"],

  // IncreaseHighestInstanceIDAndCrashInCaseOfOverflow core.
  ["increaseHighest", 0x08, "088840b9", "load highest InstanceID at Remapper+0x88"],
  ["increaseHighest", 0x0c, "0900b012", "materialize INT_MAX"],
  ["increaseHighest", 0x10, "2901084b", "compute remaining positive range"],
  ["increaseHighest", 0x14, "3f01016b", "compare remaining range with requested increment"],
  ["increaseHighest", 0x18, "0a030054", "non-overflow branch"],
  ["increaseHighest", 0x78, "0801010b", "add requested increment to highest InstanceID"],
  ["increaseHighest", 0x7c, "088800b9", "store highest InstanceID at Remapper+0x88"],

  // The tree comparator proves the 16-byte key is signed (fileIndex, pathID).
  ["serializedIdentifierComparator", 0x0c, "4a0040b9", "load signed i32 query fileIndex at +0"],
  ["serializedIdentifierComparator", 0x10, "4b0440f9", "load signed i64 query pathID at +8"],
  ["serializedIdentifierComparator", 0x18, "282140b9", "load signed i32 node fileIndex"],
  ["serializedIdentifierComparator", 0x1c, "5f01086b", "compare fileIndex values"],
  ["serializedIdentifierComparator", 0x20, "ab000054", "signed fileIndex less-than branch"],
  ["serializedIdentifierComparator", 0x24, "6c010054", "signed fileIndex greater-than branch"],
  ["serializedIdentifierComparator", 0x28, "281540f9", "load signed i64 node pathID"],
  ["serializedIdentifierComparator", 0x2c, "7f0108eb", "compare pathID values"],
  ["serializedIdentifierComparator", 0x30, "aa000054", "signed pathID greater-or-equal branch"],

  // LoadFileCompletelyThreaded ordinary branch.
  ["loadFileCompletelyThreaded", 0x158, "88020037", "load flag bit zero selects contiguous branch"],
  ["loadFileCompletelyThreaded", 0x16c, "a88640f8", "ordinary branch loads a full i64 pathID"],
  ["loadFileCompletelyThreaded", 0x178, "fb1b00b9", "key fileIndex is the runtime serialized-file index"],
  ["loadFileCompletelyThreaded", 0x17c, "e81300f9", "key pathID is stored at offset +8"],
  ["loadFileCompletelyThreaded", 0x188, "204700b8", "store GetOrGenerate result in the InstanceID array"],

  // LoadFileCompletelyThreaded contiguous branch.
  ["loadFileCompletelyThreaded", 0x1b8, "4b8540f8", "scan each full i64 pathID"],
  ["loadFileCompletelyThreaded", 0x1bc, "1f010beb", "compare pathIDs as signed i64"],
  ["loadFileCompletelyThreaded", 0x1c0, "68b1889a", "select the maximum signed pathID"],
  ["loadFileCompletelyThreaded", 0x1cc, "14791f53", "truncate max pathID to w32 and multiply by two"],
  ["loadFileCompletelyThreaded", 0x1dc, "41008052", "reserve two for the contiguous base"],
  ["loadFileCompletelyThreaded", 0x1e8, "b98a40b9", "load base after the first increment"],
  ["loadFileCompletelyThreaded", 0x1f4, "b98e00b9", "store contiguous base at Remapper+0x8c"],
  ["loadFileCompletelyThreaded", 0x1fc, "a88a40b9", "load highest after reserving the pathID span"],
  ["loadFileCompletelyThreaded", 0x204, "a86e1229", "store contiguous end and fileIndex at +0x90/+0x94"],
  ["loadFileCompletelyThreaded", 0x218, "2b8540b8", "load uint32(pathID) while stepping by eight bytes"],
  ["loadFileCompletelyThreaded", 0x220, "2b070b0b", "compute base plus two times uint32(pathID)"],
  ["loadFileCompletelyThreaded", 0x224, "4b4500b8", "store contiguous InstanceID"],
  ["loadFileCompletelyThreaded", 0x284, "417b75b8", "load InstanceID for activation"],
  ["loadFileCompletelyThreaded", 0x328, "1ffd1129", "clear contiguous base and end"],
  ["loadFileCompletelyThreaded", 0x32c, "099500b9", "restore contiguous fileIndex sentinel -1"],

  // InstanceID propagation to Object::m_InstanceID at object+0x08.
  ["readAndActivate", 0x24, "f503012a", "capture LoadFile InstanceID argument w1"],
  ["readAndActivate", 0x90, "e20e40a9", "forward the 16-byte SerializedObjectIdentifier"],
  ["readAndActivate", 0xa0, "e403152a", "forward InstanceID as CreateActivationEntry w4"],
  ["createActivationEntry", 0x3c, "e45f00b9", "save incoming InstanceID w4"],
  ["createActivationEntry", 0x9c, "e45f40b9", "reload InstanceID as ProduceObject w4"],
  ["produceObject", 0x24, "f403042a", "capture ProduceObject InstanceID w4"],
  ["produceObject", 0x78, "e203142a", "pass InstanceID as Object::Produce w2"],
  ["objectProduce", 0x28, "f603022a", "capture Object::Produce InstanceID w2"],
  ["objectProduce", 0x40, "760a00b9", "store InstanceID at Object+0x08"],
].map(([functionId, offset, bytesHex, meaning]) => Object.freeze({
  functionId, offset, bytesHex, meaning,
})));

const CALL_EDGES = Object.freeze([
  ["getOrGenerate", 0x80, "increaseHighest"],
  ["loadFileCompletelyThreaded", 0x180, "getOrGenerate"],
  ["loadFileCompletelyThreaded", 0x1e4, "increaseHighest"],
  ["loadFileCompletelyThreaded", 0x1f8, "increaseHighest"],
  ["loadFileCompletelyThreaded", 0x2bc, "readAndActivate"],
  ["readAndActivate", 0xa8, "createActivationEntry"],
  ["createActivationEntry", 0xb8, "produceObject"],
  ["produceObject", 0x80, "objectProduce"],
].map(([callerId, offset, calleeId]) => Object.freeze({ callerId, offset, calleeId })));

const FORMULAS = Object.freeze({
  ordinaryNewKeyLow8: "(H_before + 2) & 0xff",
  ordinaryNthNewKeyLow8: "(H0 + 2*n) & 0xff, n starts at 1; duplicate keys reuse their prior ID",
  contiguousBase: "B = H_before + 2",
  contiguousLow8: "(B + 2*uint32(pathID)) & 0xff == (B + 2*(pathID & 0x7f)) & 0xff",
  freshConstructorHighest: 0,
});

const SERIALIZED_IDENTIFIER = Object.freeze({
  byteSize: 16,
  fileIndex: Object.freeze({ offset: 0x00, widthBits: 32, signed: true, sentinel: -1 }),
  padding: Object.freeze({ offset: 0x04, byteSize: 4, compared: false }),
  pathID: Object.freeze({ offset: 0x08, widthBits: 64, signed: true }),
  ordering: "signed lexicographic (fileIndex, pathID)",
  identity: "runtime serialized-file index plus local serialized object identifier/pathID",
  sentinelResult: "fileIndex == -1 returns InstanceID 0",
});

const STATIC_BOUNDARY = "Static CAB identity/pathID supplies object identity and, in contiguous mode, only an offset. "
  + "It does not contain the live Remapper H/B state, prior unique-key allocation order, duplicate-hit history, "
  + "or load-mode/order state, so static CAB/pathID cannot independently recover the absolute InstanceID low 8 bits.";

function fail(message) {
  throw new Error(message);
}

function requireCondition(condition, message) {
  if (!condition) fail(message);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function safeNumber(value, label) {
  const result = Number(value);
  requireCondition(Number.isSafeInteger(result), `${label} exceeds JavaScript's exact integer range`);
  return result;
}

function readElf(buffer, label) {
  requireCondition(buffer.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46])), `${label}: not ELF`);
  requireCondition(buffer[4] === 2 && buffer[5] === 1, `${label}: expected ELF64 little-endian`);

  const programOffset = safeNumber(buffer.readBigUInt64LE(0x20), `${label} program offset`);
  const sectionOffset = safeNumber(buffer.readBigUInt64LE(0x28), `${label} section offset`);
  const programEntrySize = buffer.readUInt16LE(0x36);
  const programCount = buffer.readUInt16LE(0x38);
  const sectionEntrySize = buffer.readUInt16LE(0x3a);
  const sectionCount = buffer.readUInt16LE(0x3c);
  const sectionNameIndex = buffer.readUInt16LE(0x3e);
  const segments = [];
  for (let index = 0; index < programCount; index += 1) {
    const offset = programOffset + index * programEntrySize;
    if (buffer.readUInt32LE(offset) !== 1) continue;
    segments.push(Object.freeze({
      flags: buffer.readUInt32LE(offset + 4),
      fileOffset: safeNumber(buffer.readBigUInt64LE(offset + 8), `${label} segment file offset`),
      virtualAddress: safeNumber(buffer.readBigUInt64LE(offset + 16), `${label} segment address`),
      fileSize: safeNumber(buffer.readBigUInt64LE(offset + 32), `${label} segment file size`),
    }));
  }

  const rawSections = [];
  for (let index = 0; index < sectionCount; index += 1) {
    const offset = sectionOffset + index * sectionEntrySize;
    rawSections.push({
      nameOffset: buffer.readUInt32LE(offset),
      fileOffset: safeNumber(buffer.readBigUInt64LE(offset + 24), `${label} section file offset`),
      size: safeNumber(buffer.readBigUInt64LE(offset + 32), `${label} section size`),
      link: buffer.readUInt32LE(offset + 40),
      entrySize: safeNumber(buffer.readBigUInt64LE(offset + 56), `${label} section entry size`),
    });
  }
  const namesSection = rawSections[sectionNameIndex];
  requireCondition(namesSection, `${label}: missing section-name table`);
  const names = buffer.subarray(namesSection.fileOffset, namesSection.fileOffset + namesSection.size);
  const sections = rawSections.map((section) => {
    const end = names.indexOf(0, section.nameOffset);
    return Object.freeze({
      ...section,
      name: names.toString("utf8", section.nameOffset, end < 0 ? names.length : end),
    });
  });
  return Object.freeze({ buffer, label, segments, sections });
}

function elfRange(elf, startRva, endRva) {
  requireCondition(Number.isInteger(startRva) && Number.isInteger(endRva) && endRva >= startRva,
    `${elf.label}: invalid RVA range`);
  const segment = elf.segments.find((candidate) => startRva >= candidate.virtualAddress
    && endRva <= candidate.virtualAddress + candidate.fileSize);
  requireCondition(segment,
    `${elf.label}: RVA 0x${startRva.toString(16)}..0x${endRva.toString(16)} is not file-backed`);
  const offset = segment.fileOffset + startRva - segment.virtualAddress;
  return elf.buffer.subarray(offset, offset + endRva - startRva);
}

function readFunctionSymbols(elf) {
  const symtab = elf.sections.find((section) => section.name === ".symtab");
  requireCondition(symtab?.entrySize === 24, `${elf.label}: missing ELF64 .symtab`);
  const stringTable = elf.sections[symtab.link];
  requireCondition(stringTable?.name === ".strtab", `${elf.label}: .symtab does not link .strtab`);
  const strings = elf.buffer.subarray(stringTable.fileOffset, stringTable.fileOffset + stringTable.size);
  const symbols = new Set();
  for (let offset = symtab.fileOffset; offset < symtab.fileOffset + symtab.size; offset += symtab.entrySize) {
    if ((elf.buffer[offset + 4] & 0x0f) !== 2) continue;
    const nameOffset = elf.buffer.readUInt32LE(offset);
    const value = safeNumber(elf.buffer.readBigUInt64LE(offset + 8), `${elf.label} symbol value`);
    const size = safeNumber(elf.buffer.readBigUInt64LE(offset + 16), `${elf.label} symbol size`);
    if (!value) continue;
    const end = strings.indexOf(0, nameOffset);
    const name = strings.toString("utf8", nameOffset, end < 0 ? strings.length : end);
    symbols.add(`${value}:${size}:${name}`);
  }
  return symbols;
}

function occurrenceCount(haystack, needle) {
  let count = 0;
  for (let offset = haystack.indexOf(needle); offset >= 0; offset = haystack.indexOf(needle, offset + 1)) {
    count += 1;
  }
  return count;
}

function decodeBlTarget(word, pc) {
  requireCondition((word >>> 26) === 0x25,
    `RVA 0x${pc.toString(16)} is not an AArch64 BL instruction`);
  let immediate = word & 0x03ffffff;
  if ((immediate & 0x02000000) !== 0) immediate -= 0x04000000;
  return pc + immediate * 4;
}

function decodeAdrpPage(word, pc) {
  requireCondition(((word & 0x9f000000) >>> 0) === 0x90000000,
    `RVA 0x${pc.toString(16)} is not an AArch64 ADRP instruction`);
  const immediateLow = (word >>> 29) & 0x3;
  const immediateHigh = (word >>> 5) & 0x7ffff;
  let immediate = immediateHigh * 4 + immediateLow;
  if ((immediate & 0x100000) !== 0) immediate -= 0x200000;
  return Math.floor(pc / 0x1000) * 0x1000 + immediate * 0x1000;
}

function directCallers(elf, targetRva) {
  const callers = [];
  for (const segment of elf.segments.filter((candidate) => (candidate.flags & 1) !== 0)) {
    const bytes = elf.buffer.subarray(segment.fileOffset, segment.fileOffset + segment.fileSize);
    for (let offset = 0; offset + 4 <= bytes.length; offset += 4) {
      const word = bytes.readUInt32LE(offset);
      if ((word >>> 26) !== 0x25) continue;
      const pc = segment.virtualAddress + offset;
      if (decodeBlTarget(word, pc) === targetRva) callers.push(pc);
    }
  }
  return callers;
}

function low8(value) {
  return Number(BigInt.asUintN(8, BigInt(value)));
}

function ordinaryNewKeyLow8(highestBefore) {
  return low8(BigInt(highestBefore) + 2n);
}

function ordinaryNthNewKeyLow8(initialHighest, oneBasedAllocationOrdinal) {
  requireCondition(Number.isInteger(oneBasedAllocationOrdinal) && oneBasedAllocationOrdinal >= 1,
    "ordinary allocation ordinal must start at one");
  return low8(BigInt(initialHighest) + 2n * BigInt(oneBasedAllocationOrdinal));
}

function contiguousLow8(base, pathID) {
  const machinePathID = BigInt.asUintN(32, BigInt(pathID));
  return low8(BigInt(base) + 2n * machinePathID);
}

function contiguousReducedLow8(base, pathID) {
  return low8(BigInt(base) + 2n * BigInt.asUintN(7, BigInt(pathID)));
}

function runFormulaChecks() {
  requireCondition(ordinaryNewKeyLow8(0) === 2, "fresh ordinary allocation formula mismatch");
  requireCondition(ordinaryNthNewKeyLow8(0, 128) === 0, "ordinary low-8 wrap formula mismatch");
  requireCondition(ordinaryNthNewKeyLow8(0xfe, 1) === 0, "ordinary carry formula mismatch");
  for (const [base, pathID] of [
    [2, 0n],
    [2, 1n],
    [0xfe, 1n],
    [0x12345678, 0x123456789abcdef0n],
    [0x80, -1n],
  ]) {
    requireCondition(contiguousLow8(base, pathID) === contiguousReducedLow8(base, pathID),
      `contiguous reduced low-8 formula mismatch for base=${base}, pathID=${pathID}`);
  }
}

let report;
try {
  for (const filename of [RELEASE_LIBUNITY, RELEASE_SYMBOLS, GAME_LIBUNITY]) {
    requireCondition(fs.existsSync(filename), `missing official input ${filename}`);
  }
  const releaseBytes = fs.readFileSync(RELEASE_LIBUNITY);
  const symbolBytes = fs.readFileSync(RELEASE_SYMBOLS);
  const gameBytes = fs.readFileSync(GAME_LIBUNITY);
  const hashes = Object.freeze({
    release: sha256(releaseBytes),
    releaseSymbols: sha256(symbolBytes),
    game: sha256(gameBytes),
  });
  requireCondition(hashes.release === EXPECTED.releaseSha256,
    `Unity release libunity SHA-256 mismatch: ${hashes.release}`);
  requireCondition(hashes.releaseSymbols === EXPECTED.releaseSymbolsSha256,
    `Unity release symbols SHA-256 mismatch: ${hashes.releaseSymbols}`);
  requireCondition(hashes.game === EXPECTED.gameSha256,
    `game libunity SHA-256 mismatch: ${hashes.game}`);
  requireCondition(releaseBytes.includes(Buffer.from(EXPECTED.releaseVersion)),
    "Unity release version identity mismatch");
  requireCondition(gameBytes.includes(Buffer.from(EXPECTED.gameVersion)),
    "game Unity version identity mismatch");

  const releaseElf = readElf(releaseBytes, "Unity release libunity");
  const symbolElf = readElf(symbolBytes, "Unity release symbols");
  const gameElf = readElf(gameBytes, "game libunity");
  const functionSymbols = readFunctionSymbols(symbolElf);
  const functionById = new Map(FUNCTIONS.map((item) => [item.id, item]));

  for (const item of FUNCTIONS) {
    requireCondition(functionSymbols.has(`${item.releaseStart}:${item.size}:${item.symbol}`),
      `${item.id}: official symbol identity/size mismatch`);
    const releaseFunction = elfRange(releaseElf, item.releaseStart, item.releaseStart + item.size);
    const gameFunction = elfRange(gameElf, item.gameStart, item.gameStart + item.size);
    requireCondition(sha256(releaseFunction) === item.releaseFunctionSha256,
      `${item.id}: release function hash mismatch`);
    requireCondition(sha256(gameFunction) === item.gameFunctionSha256,
      `${item.id}: game function hash mismatch`);
    const releaseSignature = releaseFunction.subarray(
      item.signatureOffset, item.signatureOffset + item.signatureSize,
    );
    const gameSignature = gameFunction.subarray(
      item.signatureOffset, item.signatureOffset + item.signatureSize,
    );
    requireCondition(releaseSignature.equals(gameSignature), `${item.id}: release/game signature mismatch`);
    requireCondition(occurrenceCount(releaseBytes, releaseSignature) === 1,
      `${item.id}: signature is not unique in release libunity`);
    requireCondition(occurrenceCount(gameBytes, gameSignature) === 1,
      `${item.id}: signature is not unique in game libunity`);
  }
  requireCondition(functionSymbols.has("10185104:108:_ZN8RemapperC1E10MemLabelId"),
    "Remapper complete-object constructor alias is missing");

  for (const check of MIRRORED_WORDS) {
    const item = functionById.get(check.functionId);
    requireCondition(item, `unknown instruction function ${check.functionId}`);
    for (const [elf, start, label] of [
      [releaseElf, item.releaseStart, "release"],
      [gameElf, item.gameStart, "game"],
    ]) {
      const actual = elfRange(elf, start + check.offset, start + check.offset + 4).toString("hex");
      requireCondition(actual === check.bytesHex,
        `${check.functionId}+0x${check.offset.toString(16)} ${label} instruction mismatch (${check.meaning}): ${actual}`);
    }
  }

  for (const edge of CALL_EDGES) {
    const caller = functionById.get(edge.callerId);
    const callee = functionById.get(edge.calleeId);
    requireCondition(caller && callee, `unknown call edge ${edge.callerId} -> ${edge.calleeId}`);
    for (const [elf, callerStart, calleeStart, label] of [
      [releaseElf, caller.releaseStart, callee.releaseStart, "release"],
      [gameElf, caller.gameStart, callee.gameStart, "game"],
    ]) {
      const pc = callerStart + edge.offset;
      const word = elfRange(elf, pc, pc + 4).readUInt32LE(0);
      requireCondition(decodeBlTarget(word, pc) === calleeStart,
        `${label} call edge ${edge.callerId}+0x${edge.offset.toString(16)} -> ${edge.calleeId} mismatch`);
    }
  }

  const increaseCoreStart = 0x6c2e9c;
  const increaseCoreEnd = 0x6c2f14;
  requireCondition(sha256(elfRange(gameElf, increaseCoreStart, increaseCoreEnd))
    === EXPECTED.increaseHighestCoreSha256,
  "IncreaseHighest game core 0x6c2e9c..0x6c2f14 hash mismatch");

  const constructorDefaults = [];
  for (const input of [
    {
      label: "release",
      elf: releaseElf,
      adrpRva: 0x9b69c4,
      adrpHex: "0abdffb0",
      loadRva: 0x9b69cc,
      loadHex: "40c9c03d",
      dataRva: 0x157320,
    },
    {
      label: "game",
      elf: gameElf,
      adrpRva: 0x6c2e5c,
      adrpHex: "0ad5ff90",
      loadRva: 0x6c2e64,
      loadHex: "4001c13d",
      dataRva: 0x162400,
    },
  ]) {
    const adrp = elfRange(input.elf, input.adrpRva, input.adrpRva + 4);
    const load = elfRange(input.elf, input.loadRva, input.loadRva + 4);
    requireCondition(adrp.toString("hex") === input.adrpHex, `${input.label} constructor ADRP mismatch`);
    requireCondition(load.toString("hex") === input.loadHex, `${input.label} constructor LDR Q mismatch`);
    const adrpWord = adrp.readUInt32LE(0);
    const loadWord = load.readUInt32LE(0);
    requireCondition((adrpWord & 0x1f) === 10, `${input.label} constructor ADRP does not target x10`);
    requireCondition(((loadWord >>> 5) & 0x1f) === 10 && (loadWord & 0x1f) === 0,
      `${input.label} constructor LDR does not load q0 from x10`);
    const decodedDataRva = decodeAdrpPage(adrpWord, input.adrpRva)
      + ((loadWord >>> 10) & 0xfff) * 16;
    requireCondition(decodedDataRva === input.dataRva,
      `${input.label} constructor defaults address mismatch: 0x${decodedDataRva.toString(16)}`);
    const defaults = elfRange(input.elf, input.dataRva, input.dataRva + 16);
    requireCondition(defaults.toString("hex") === EXPECTED.constructorDefaultsHex,
      `${input.label} constructor defaults payload mismatch`);
    constructorDefaults.push(Object.freeze({
      source: input.label,
      dataRva: `0x${input.dataRva.toString(16)}`,
      words: Object.freeze([0, 0, 0, -1]),
    }));
  }

  const create = functionById.get("createActivationEntry");
  requireCondition(JSON.stringify(directCallers(releaseElf, functionById.get("produceObject").releaseStart))
    === JSON.stringify([create.releaseStart + 0xb8]),
  "release ProduceObject must have exactly the activation-entry caller");
  requireCondition(JSON.stringify(directCallers(gameElf, functionById.get("produceObject").gameStart))
    === JSON.stringify([create.gameStart + 0xb8]),
  "game ProduceObject must have exactly the activation-entry caller");

  runFormulaChecks();

  report = Object.freeze({
    status: "proved-with-static-recovery-boundary",
    inputs: Object.freeze({
      release: Object.freeze({ path: RELEASE_LIBUNITY, sha256: hashes.release }),
      releaseSymbols: Object.freeze({ path: RELEASE_SYMBOLS, sha256: hashes.releaseSymbols }),
      game: Object.freeze({ path: GAME_LIBUNITY, sha256: hashes.game }),
      mode: "read-only; no browser/CAB/scene/screenshot input",
    }),
    functions: Object.freeze(FUNCTIONS.map((item) => Object.freeze({
      id: item.id,
      releaseRva: `0x${item.releaseStart.toString(16)}`,
      gameRva: `0x${item.gameStart.toString(16)}`,
      byteSize: item.size,
      symbol: item.symbol,
    }))),
    increaseHighestGameCore: Object.freeze({
      range: "0x6c2e9c..0x6c2f14",
      sha256: EXPECTED.increaseHighestCoreSha256,
      operation: "H = H + increment after signed INT_MAX overflow guard; H is Remapper+0x88",
    }),
    constructorDefaults: Object.freeze(constructorDefaults),
    instructionChecks: MIRRORED_WORDS.length * 2 + 4,
    directCallEdges: CALL_EDGES.length * 2,
    serializedObjectIdentifier: SERIALIZED_IDENTIFIER,
    formulas: FORMULAS,
    propagation: Object.freeze([
      "LoadFileCompletelyThreaded stores generated IDs and passes one as ReadAndActivateObjectThreaded w1",
      "ReadAndActivateObjectThreaded forwards it as CreateThreadActivationQueueEntry w4",
      "CreateThreadActivationQueueEntry forwards it as PersistentManager::ProduceObject w4",
      "PersistentManager::ProduceObject forwards it as Object::Produce w2",
      "Object::Produce stores w2 at Object+0x08",
    ]),
    staticRecoveryBoundary: STATIC_BOUNDARY,
  });
} catch (error) {
  console.error(`BAD official InstanceID Remapper audit: ${error.message}`);
  process.exit(1);
}

if (JSON_MODE) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log("Official InstanceID Remapper audit OK");
  console.log(`  release      2022.3.62f2  ${report.inputs.release.sha256}`);
  console.log(`  game         PTCGP 1.6.0  ${report.inputs.game.sha256}`);
  console.log("  mappings     Remapper ctor 0x9b6990/0x6c2e28; GetOrGenerate 0x9b1714/0x6bda9c");
  console.log("               LoadFileCompletelyThreaded 0x9b45c0/0x6c096c");
  console.log("               ProduceObject 0x9b3bb8/0x6bffe8; Object::Produce 0x748140/0x4888a4");
  console.log(`  increase     ${report.increaseHighestGameCore.range}  ${report.increaseHighestGameCore.operation}`);
  console.log(`  ordinary     new key low8=${FORMULAS.ordinaryNewKeyLow8}; nth=${FORMULAS.ordinaryNthNewKeyLow8}`);
  console.log(`  contiguous   ${FORMULAS.contiguousBase}; low8=${FORMULAS.contiguousLow8}`);
  console.log("  key          SerializedObjectIdentifier[16] = signed i32 fileIndex@0 + padding@4 + signed i64 pathID@8");
  console.log(`               ${SERIALIZED_IDENTIFIER.ordering}; ${SERIALIZED_IDENTIFIER.sentinelResult}`);
  console.log("  flow         generated ID -> activation entry -> ProduceObject -> Object::Produce -> Object+0x08");
  console.log(`  boundary     ${STATIC_BOUNDARY}`);
  console.log("  inputs       read-only official ELF bytes/symbols; no browser, CAB payload, scene, or screenshot");
}
