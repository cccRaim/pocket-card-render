#!/usr/bin/env node
// Read-only mapping from Pokemon TCG Pocket's official libunity bytes to the
// public symbols shipped in Unity's official Android Build Support installer.
// No scene, recipe, screenshot, browser, or generated renderer output is used.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { OFFICIAL_DRAW_ORDER_EVIDENCE } from "../public/render/official-draw-order.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_CACHE = path.resolve(ROOT, "../.cache");
const INSTALLER = path.resolve(process.env.PCR_UNITY_ANDROID_SUPPORT
  || path.join(DEFAULT_CACHE, "unity-2022.3.62f2/UnitySetup-Android-Support-for-Editor-2022.3.62f2.exe"));
const GAME_LIBUNITY = path.resolve(process.env.PCR_GAME_LIBUNITY
  || path.join(DEFAULT_CACHE, "ptcgp-1.6.0/libunity.so"));
const RELEASE_LIBUNITY = path.resolve(process.env.PCR_UNITY_RELEASE_LIBUNITY
  || path.join(DEFAULT_CACHE, "unity-2022.3.62f2/symbols/libunity.release.arm64.so"));
const RELEASE_SYMBOLS = path.resolve(process.env.PCR_UNITY_RELEASE_SYMBOLS
  || path.join(DEFAULT_CACHE, "unity-2022.3.62f2/symbols/libunity.release.arm64.sym.so"));

const EXPECTED = OFFICIAL_DRAW_ORDER_EVIDENCE.officialUnitySymbols;
const GAME_VERSION = OFFICIAL_DRAW_ORDER_EVIDENCE.package.unityVersion;

const mappings = Object.freeze([
  ["entryComparator", 0x54c830, 0x54cac4, 0x81bdd4, 660, 660, "_ZNK18RenderObjectSorterclERK24ScriptableLoopObjectDataS2_"],
  ["findPasses", 0x54cac4, 0x54cbbc, 0x81c068, 248, 52, "_Z10FindPassesPK12MaterialInfobP11ShaderTagIDiS2_Pi"],
  ["nodeHasMotion", 0x54cbbc, 0x54cc10, 0x81c160, 84, 40, "_Z13NodeHasMotionRK10RenderNodei"],
  ["sortInputBuilder", 0x54cc10, 0x54db78, 0x81c1b4, 3944, 108, "_Z31PrepareScriptableLoopObjectDataRK15RenderNodeQueueRK20DrawRenderersCommandPK20OverrideMaterialInfoPK18OverrideShaderInfoPK12MaterialInfoimmRN4core6vectorI24ScriptableLoopObjectDataLm0EEE"],
  ["distanceKey", 0x54db78, 0x54dc3c, 0x81d11c, 196, 196, "_ZL22ComputeSortingDistance22RendererDistanceMetricRK10Matrix4x4f8Vector3fS3_S3_f"],
  ["sortWithFence", 0x54dc3c, 0x54dd08, 0x81d1e0, 204, 40, "_ZL37SortScriptableLoopObjectDataWithFenceR8JobFenceRK15RenderNodeQueue23RendererSortingCriteriaRN4core6vectorI24ScriptableLoopObjectDataLm0EEE"],
  ["prepareCommand", 0x54dd08, 0x54e37c, 0x81d2ac, 1652, 48, "_Z27PrepareDrawRenderersCommandRK20DrawRenderersCommandR18JobBatchDispatcher"],
  ["rendererListPrepare", 0x54e37c, 0x54e438, 0x81d920, 188, 36, "_ZL33PrepareScriptableDrawRenderersJobP26ScriptableRenderContextArg"],
  ["parallelSortDriver", 0x550508, 0x55078c, 0x81f6fc, 644, 72, "_ZN14qsort_internal31QSortBlittableMultiThreadedImplI24ScriptableLoopObjectData18RenderObjectSorterZNS_27QSortBlittableMultiThreadedIS1_S2_EEvR8JobFencePT_S7_T0_RKS4_PN9profiling6MarkerEE6SorterE4SortES5_PS1_SG_S2_SE_SA_SD_"],
  ["quickSort", 0x550b58, 0x550edc, 0x81fd4c, 900, 192, "_ZN14qsort_internal5QSortIP24ScriptableLoopObjectDatal18RenderObjectSorterEEvT_S4_T0_T1_"],
].map(([id, gameStartRva, gameEndRva, officialRva, symbolSize, uniquePrefixByteSize, symbol]) => Object.freeze({
  id,
  gameStartRva,
  gameEndRva,
  officialRva,
  symbolSize,
  uniquePrefixByteSize,
  symbol,
})));

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

async function sha256File(filename) {
  const hash = createHash("sha256");
  for await (const chunk of fs.createReadStream(filename)) hash.update(chunk);
  return hash.digest("hex");
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
      virtualAddress: safeNumber(buffer.readBigUInt64LE(offset + 16), `${label} segment virtual address`),
      fileSize: safeNumber(buffer.readBigUInt64LE(offset + 32), `${label} segment file size`),
    }));
  }

  const rawSections = [];
  for (let index = 0; index < sectionCount; index += 1) {
    const offset = sectionOffset + index * sectionEntrySize;
    rawSections.push({
      nameOffset: buffer.readUInt32LE(offset),
      type: buffer.readUInt32LE(offset + 4),
      address: safeNumber(buffer.readBigUInt64LE(offset + 16), `${label} section address`),
      fileOffset: safeNumber(buffer.readBigUInt64LE(offset + 24), `${label} section file offset`),
      size: safeNumber(buffer.readBigUInt64LE(offset + 32), `${label} section size`),
      link: buffer.readUInt32LE(offset + 40),
      entrySize: safeNumber(buffer.readBigUInt64LE(offset + 56), `${label} section entry size`),
    });
  }
  const namesSection = rawSections[sectionNameIndex];
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

function virtualAddressToFileOffset(elf, virtualAddress) {
  const segment = elf.segments.find((candidate) => virtualAddress >= candidate.virtualAddress
    && virtualAddress < candidate.virtualAddress + candidate.fileSize);
  requireCondition(segment, `${elf.label}: RVA 0x${virtualAddress.toString(16)} is not file-backed`);
  return segment.fileOffset + virtualAddress - segment.virtualAddress;
}

function fileOffsetToVirtualAddress(elf, fileOffset) {
  const segment = elf.segments.find((candidate) => fileOffset >= candidate.fileOffset
    && fileOffset < candidate.fileOffset + candidate.fileSize);
  requireCondition(segment, `${elf.label}: file offset 0x${fileOffset.toString(16)} is not mapped`);
  return segment.virtualAddress + fileOffset - segment.fileOffset;
}

function readFunctionSymbols(elf) {
  const symtab = elf.sections.find((section) => section.name === ".symtab");
  requireCondition(symtab && symtab.entrySize === 24, `${elf.label}: missing ELF64 .symtab`);
  const stringTable = elf.sections[symtab.link];
  requireCondition(stringTable?.name === ".strtab", `${elf.label}: .symtab does not link .strtab`);
  const strings = elf.buffer.subarray(stringTable.fileOffset, stringTable.fileOffset + stringTable.size);
  const symbols = new Map();
  for (let offset = symtab.fileOffset; offset < symtab.fileOffset + symtab.size; offset += symtab.entrySize) {
    const info = elf.buffer[offset + 4];
    if ((info & 0x0f) !== 2) continue;
    const nameOffset = elf.buffer.readUInt32LE(offset);
    const value = safeNumber(elf.buffer.readBigUInt64LE(offset + 8), `${elf.label} symbol value`);
    const size = safeNumber(elf.buffer.readBigUInt64LE(offset + 16), `${elf.label} symbol size`);
    if (!value) continue;
    const end = strings.indexOf(0, nameOffset);
    const name = strings.toString("utf8", nameOffset, end < 0 ? strings.length : end);
    symbols.set(`${value}:${size}:${name}`, Object.freeze({ value, size, name }));
  }
  return symbols;
}

function findAll(haystack, needle) {
  const offsets = [];
  for (let offset = haystack.indexOf(needle); offset >= 0; offset = haystack.indexOf(needle, offset + 1)) {
    offsets.push(offset);
  }
  return offsets;
}

for (const filename of [INSTALLER, GAME_LIBUNITY, RELEASE_LIBUNITY, RELEASE_SYMBOLS]) {
  requireCondition(fs.existsSync(filename), `missing official input ${filename}`);
}

const hashes = {
  installer: await sha256File(INSTALLER),
  gameLibunity: await sha256File(GAME_LIBUNITY),
  releaseLibunity: await sha256File(RELEASE_LIBUNITY),
  releaseSymbols: await sha256File(RELEASE_SYMBOLS),
};
requireCondition(hashes.installer === EXPECTED.installerSha256, `Unity installer hash mismatch: ${hashes.installer}`);
requireCondition(hashes.gameLibunity === OFFICIAL_DRAW_ORDER_EVIDENCE.package.libunitySha256, `game libunity hash mismatch: ${hashes.gameLibunity}`);
requireCondition(hashes.releaseLibunity === EXPECTED.releaseLibunitySha256, `Unity release libunity hash mismatch: ${hashes.releaseLibunity}`);
requireCondition(hashes.releaseSymbols === EXPECTED.releaseSymbolsSha256, `Unity symbol file hash mismatch: ${hashes.releaseSymbols}`);

const gameElf = readElf(fs.readFileSync(GAME_LIBUNITY), "game libunity");
const releaseElf = readElf(fs.readFileSync(RELEASE_LIBUNITY), "Unity release libunity");
const symbolElf = readElf(fs.readFileSync(RELEASE_SYMBOLS), "Unity release symbols");
requireCondition(gameElf.buffer.includes(Buffer.from(GAME_VERSION)), `game libunity lacks ${GAME_VERSION}`);
requireCondition(releaseElf.buffer.includes(Buffer.from(EXPECTED.installerVersion)), `Unity release libunity lacks ${EXPECTED.installerVersion}`);
const functionSymbols = readFunctionSymbols(symbolElf);

const results = [];
for (const mapping of mappings) {
  const gameStart = virtualAddressToFileOffset(gameElf, mapping.gameStartRva);
  const gameEnd = virtualAddressToFileOffset(gameElf, mapping.gameEndRva);
  const gameFunction = gameElf.buffer.subarray(gameStart, gameEnd);
  requireCondition(gameFunction.length === mapping.symbolSize, `${mapping.id}: game function size mismatch`);
  const prefix = gameFunction.subarray(0, mapping.uniquePrefixByteSize);
  const occurrences = findAll(releaseElf.buffer, prefix);
  requireCondition(occurrences.length === 1, `${mapping.id}: expected one official prefix match, got ${occurrences.length}`);
  const officialRva = fileOffsetToVirtualAddress(releaseElf, occurrences[0]);
  requireCondition(officialRva === mapping.officialRva, `${mapping.id}: mapped RVA 0x${officialRva.toString(16)}`);
  const symbol = functionSymbols.get(`${mapping.officialRva}:${mapping.symbolSize}:${mapping.symbol}`);
  requireCondition(symbol, `${mapping.id}: official public symbol or size mismatch`);
  const wholeFunctionMatches = findAll(releaseElf.buffer, gameFunction).length;
  if (mapping.uniquePrefixByteSize === mapping.symbolSize) {
    requireCondition(wholeFunctionMatches === 1, `${mapping.id}: expected one whole-function match`);
  }
  results.push(Object.freeze({
    id: mapping.id,
    gameRva: `0x${mapping.gameStartRva.toString(16)}`,
    officialRva: `0x${mapping.officialRva.toString(16)}`,
    byteSize: mapping.symbolSize,
    uniquePrefixByteSize: mapping.uniquePrefixByteSize,
    wholeFunctionExact: wholeFunctionMatches === 1,
    gameSha256: sha256(gameFunction),
    symbol: mapping.symbol,
  }));
}

console.log(`Official Unity symbol map: ${results.length}/${mappings.length} functions mapped`);
console.log(`  game       ${GAME_VERSION}  ${hashes.gameLibunity}`);
console.log(`  symbols    ${EXPECTED.installerVersion}  ${hashes.releaseSymbols}`);
for (const result of results) {
  console.log(`  ${result.id.padEnd(22)} ${result.gameRva} -> ${result.officialRva}`
    + `  ${String(result.byteSize).padStart(4)} bytes  prefix=${String(result.uniquePrefixByteSize).padStart(4)}`
    + `  whole=${result.wholeFunctionExact ? "exact" : "relocated"}`);
}
