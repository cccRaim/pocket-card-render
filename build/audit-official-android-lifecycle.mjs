#!/usr/bin/env node
// Read-only audit of Unity's Android pause/resume path used by the official game.
// Authority: game libunity bytes plus Unity 2022.3.62f2 Android release symbols.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { syncOfficialClockVisibility } from "../public/render/official-clock.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CACHE = path.resolve(ROOT, "../.cache");
const GAME_LIBUNITY = path.resolve(process.env.PCR_GAME_LIBUNITY
  || path.join(CACHE, "ptcgp-1.6.0/libunity.so"));
const RELEASE_LIBUNITY = path.resolve(process.env.PCR_UNITY_RELEASE_LIBUNITY
  || path.join(CACHE, "unity-2022.3.62f2/symbols/libunity.release.arm64.so"));
const RELEASE_SYMBOLS = path.resolve(process.env.PCR_UNITY_RELEASE_SYMBOLS
  || path.join(CACHE, "unity-2022.3.62f2/symbols/libunity.release.arm64.sym.so"));

const EXPECTED = Object.freeze({
  gameSha256: "43a04223f94b6ca0c7cf128b399fe0656c57b5a18a10bf21bb9ce27aeb219722",
  releaseSha256: "9250260245fdbe960845d785e42418890e62ca586d2566e1d4c146c294cd637a",
  symbolsSha256: "2244367020161ab6f84350dba36ef2c44e645014c056c3cd427b13e9efa05969",
});

const FUNCTIONS = Object.freeze([
  ["UnityPlayerLoop", 0x9e41bc, 0x6f3458, 1060, "7b59f9652b6ae2cc8fcada9923b75756b635e6f4492e69712c8f41667498b602", "_Z15UnityPlayerLoopv"],
  ["UnityPause", 0x9e45e0, 0x6f387c, 428, "2f9f6195ba913b4715b628907a6db19126bc599ab787114a16350cedb600c25b", "_Z10UnityPausei"],
  ["nativePause", 0x9fd8fc, 0x70d248, 100, "435bb0a1e75e6958a0e79b7e05e84a38abfdb9d31715d2891f11780af117a872", "_Z11nativePauseP7_JNIEnvP8_jobject"],
  ["nativeResume", 0x9fd960, 0x70d2ac, 72, "3d4ef798dfa9835d71d96ee6b4716cf7d75b0d66f9d91848b3fdc80a97ec41b0", "_Z12nativeResumeP7_JNIEnvP8_jobject"],
  ["SetPlayerPause", 0x8503a4, 0x57bfbc, 420, "36626f27594ac9f36aaeb184bb019ecfe83bf7a2131ce7eb8178a7cff3b8dda7", "_Z14SetPlayerPause11PlayerPauseb"],
  ["GetPlayerPause", 0x841d1c, 0x5712e4, 12, "d1cd0413be50609ca51c1e87502f11ad401acf747b415b4ccd6633e7c574027b", "_Z14GetPlayerPausev"],
  ["SetPlayerPauseDirect", 0x841d28, 0x5712f0, 12, "f791a46bdfe5d0e40d85564895e7306a305b952d20118e677b05d6ca9f19325c", "_Z20SetPlayerPauseDirect11PlayerPause"],
  ["InputSubsystemHandleAppPaused", 0xdbb3e4, 0x9557d8, 136, "615e5a8aee1af2380d2e74f9815e12ebc1892c6f6b2eba65c3fd8047430b50f1", "_ZL29InputSubsystemHandleAppPausedb"],
].map(([id, releaseRva, gameRva, byteSize, normalizedSha256, symbol]) => Object.freeze({
  id, releaseRva, gameRva, byteSize, normalizedSha256, symbol,
})));

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function safeNumber(value, label) {
  const result = Number(value);
  assert.ok(Number.isSafeInteger(result), `${label} exceeds the exact integer range`);
  return result;
}

function readElf(buffer, label) {
  assert.deepEqual(buffer.subarray(0, 4), Buffer.from([0x7f, 0x45, 0x4c, 0x46]), `${label}: not ELF`);
  assert.equal(buffer[4], 2, `${label}: not ELF64`);
  assert.equal(buffer[5], 1, `${label}: not little-endian`);
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
      fileOffset: safeNumber(buffer.readBigUInt64LE(offset + 8), `${label} segment offset`),
      virtualAddress: safeNumber(buffer.readBigUInt64LE(offset + 16), `${label} segment address`),
      fileSize: safeNumber(buffer.readBigUInt64LE(offset + 32), `${label} segment size`),
    }));
  }
  const sections = [];
  for (let index = 0; index < sectionCount; index += 1) {
    const offset = sectionOffset + index * sectionEntrySize;
    sections.push({
      nameOffset: buffer.readUInt32LE(offset),
      fileOffset: safeNumber(buffer.readBigUInt64LE(offset + 24), `${label} section offset`),
      size: safeNumber(buffer.readBigUInt64LE(offset + 32), `${label} section size`),
      link: buffer.readUInt32LE(offset + 40),
      entrySize: safeNumber(buffer.readBigUInt64LE(offset + 56), `${label} section entry size`),
    });
  }
  const sectionNames = sections[sectionNameIndex];
  const names = buffer.subarray(sectionNames.fileOffset, sectionNames.fileOffset + sectionNames.size);
  for (const section of sections) {
    const end = names.indexOf(0, section.nameOffset);
    section.name = names.toString("utf8", section.nameOffset, end < 0 ? names.length : end);
  }
  return Object.freeze({ buffer, label, segments, sections });
}

function rangeAt(elf, rva, byteSize) {
  const segment = elf.segments.find((candidate) => rva >= candidate.virtualAddress
    && rva + byteSize <= candidate.virtualAddress + candidate.fileSize);
  assert.ok(segment, `${elf.label}: RVA 0x${rva.toString(16)} is not file-backed`);
  const start = segment.fileOffset + rva - segment.virtualAddress;
  return elf.buffer.subarray(start, start + byteSize);
}

function functionSymbols(elf) {
  const symtab = elf.sections.find((section) => section.name === ".symtab");
  assert.equal(symtab?.entrySize, 24, `${elf.label}: ELF64 symtab missing`);
  const stringsSection = elf.sections[symtab.link];
  assert.equal(stringsSection?.name, ".strtab", `${elf.label}: symtab string table missing`);
  const strings = elf.buffer.subarray(stringsSection.fileOffset, stringsSection.fileOffset + stringsSection.size);
  const result = new Set();
  for (let offset = symtab.fileOffset; offset < symtab.fileOffset + symtab.size; offset += symtab.entrySize) {
    if ((elf.buffer[offset + 4] & 0x0f) !== 2) continue;
    const nameOffset = elf.buffer.readUInt32LE(offset);
    const end = strings.indexOf(0, nameOffset);
    const name = strings.toString("utf8", nameOffset, end < 0 ? strings.length : end);
    const value = safeNumber(elf.buffer.readBigUInt64LE(offset + 8), `${name} value`);
    const size = safeNumber(elf.buffer.readBigUInt64LE(offset + 16), `${name} size`);
    result.add(`${value}:${size}:${name}`);
  }
  return result;
}

// Game and public release builds use different link addresses and native object layouts.
// Preserve opcode/register/control-flow identity while masking only embedded call/page/field immediates.
function normalizedInstructionShape(bytes) {
  assert.equal(bytes.length % 4, 0, "AArch64 body must be word-aligned");
  const normalized = Buffer.from(bytes);
  for (let offset = 0; offset < normalized.length; offset += 4) {
    let word = normalized.readUInt32LE(offset);
    if (((word & 0xfc000000) >>> 0) === 0x94000000) word &= 0xfc000000; // BL target
    else if (((word & 0x9f000000) >>> 0) === 0x90000000) word &= 0x9f00001f; // ADRP page
    else if (((word & 0x3b000000) >>> 0) === 0x39000000) word &= 0xffc003ff; // load/store field
    else if (((word & 0x1f000000) >>> 0) === 0x11000000) word &= 0xffc003ff; // ADD/SUB immediate
    normalized.writeUInt32LE(word >>> 0, offset);
  }
  return normalized;
}

function branchTarget(elf, instructionRva) {
  const word = rangeAt(elf, instructionRva, 4).readUInt32LE(0);
  assert.equal((word & 0xfc000000) >>> 0, 0x94000000, `0x${instructionRva.toString(16)} is not BL`);
  const immediate = word & 0x03ffffff;
  const displacement = (immediate << 6) >> 4;
  return instructionRva + displacement;
}

for (const file of [GAME_LIBUNITY, RELEASE_LIBUNITY, RELEASE_SYMBOLS]) {
  assert.ok(fs.existsSync(file), `official lifecycle source missing: ${file}`);
}
const gameBytes = fs.readFileSync(GAME_LIBUNITY);
const releaseBytes = fs.readFileSync(RELEASE_LIBUNITY);
const symbolBytes = fs.readFileSync(RELEASE_SYMBOLS);
assert.equal(sha256(gameBytes), EXPECTED.gameSha256, "game libunity hash drifted");
assert.equal(sha256(releaseBytes), EXPECTED.releaseSha256, "release libunity hash drifted");
assert.equal(sha256(symbolBytes), EXPECTED.symbolsSha256, "release symbol hash drifted");

const game = readElf(gameBytes, "game libunity");
const release = readElf(releaseBytes, "Unity release libunity");
const symbols = functionSymbols(readElf(symbolBytes, "Unity release symbols"));
for (const fn of FUNCTIONS) {
  assert.ok(symbols.has(`${fn.releaseRva}:${fn.byteSize}:${fn.symbol}`), `${fn.id}: official symbol mismatch`);
  const releaseShape = normalizedInstructionShape(rangeAt(release, fn.releaseRva, fn.byteSize));
  const gameShape = normalizedInstructionShape(rangeAt(game, fn.gameRva, fn.byteSize));
  assert.deepEqual(gameShape, releaseShape, `${fn.id}: game/release instruction shape differs`);
  assert.equal(sha256(gameShape), fn.normalizedSha256, `${fn.id}: normalized body hash drifted`);
}

const gameRva = Object.fromEntries(FUNCTIONS.map((fn) => [fn.id, fn.gameRva]));
assert.equal(rangeAt(game, gameRva.nativePause + 0x54, 4).readUInt32LE(0), 0x52800020,
  "nativePause must pass argument 1");
assert.equal(branchTarget(game, gameRva.nativePause + 0x58), gameRva.UnityPause,
  "nativePause does not call UnityPause(1)");
assert.equal(rangeAt(game, gameRva.nativeResume + 0x20, 4).readUInt32LE(0), 0x350000a0,
  "nativeResume first zero-result gate drifted");
assert.equal(rangeAt(game, gameRva.nativeResume + 0x2c, 4).readUInt32LE(0), 0x35000040,
  "nativeResume second zero-result gate drifted");
assert.equal(branchTarget(game, gameRva.nativeResume + 0x30), gameRva.UnityPause,
  "nativeResume does not defer through UnityPause(0)");
assert.equal(rangeAt(game, gameRva.UnityPlayerLoop + 0xec, 4).readUInt32LE(0), 0x52800040,
  "UnityPlayerLoop deferred-resume argument is not 2");
assert.equal(branchTarget(game, gameRva.UnityPlayerLoop + 0xf0), gameRva.UnityPause,
  "UnityPlayerLoop does not consume deferred resume through UnityPause(2)");
assert.equal(rangeAt(game, gameRva.UnityPause + 0x4c, 4).readUInt32LE(0), 0x52800040,
  "UnityPause pause state is not PlayerPause=2");
assert.equal(rangeAt(game, gameRva.UnityPause + 0x50, 4).readUInt32LE(0), 0x52800021,
  "UnityPause pause callback flag is not true");
assert.equal(branchTarget(game, gameRva.UnityPause + 0x54), gameRva.SetPlayerPause,
  "UnityPause pause path does not call SetPlayerPause(2,true)");
assert.equal(rangeAt(game, gameRva.UnityPause + 0x16c, 4).readUInt32LE(0), 0x2a1f03e0,
  "UnityPause resume state is not PlayerPause=0");
assert.equal(rangeAt(game, gameRva.UnityPause + 0x168, 4).readUInt32LE(0), 0x52800021,
  "UnityPause resume callback flag is not true");
assert.equal(branchTarget(game, gameRva.UnityPause + 0x170), gameRva.SetPlayerPause,
  "UnityPause resume path does not call SetPlayerPause(0,true)");
assert.equal(branchTarget(game, gameRva.SetPlayerPause + 0x11c), gameRva.SetPlayerPauseDirect,
  "SetPlayerPause does not commit through SetPlayerPauseDirect");
assert.equal(rangeAt(game, gameRva.InputSubsystemHandleAppPaused + 0x58, 4).readUInt32LE(0), 0x2a1303e1,
  "Input subsystem callback does not receive the normalized pause bool");

const calls = [];
const testClock = {
  suspend() { calls.push("suspend"); },
  resume() { calls.push("resume"); },
};
syncOfficialClockVisibility(testClock, true);
syncOfficialClockVisibility(testClock, false);
assert.deepEqual(calls, ["suspend", "resume"], "browser visibility adapter drifted");

console.log("Official Android lifecycle audit OK");
console.log(`  symbols      ${FUNCTIONS.length}/${FUNCTIONS.length} official functions mapped to game instruction shapes`);
console.log("  pause        nativePause -> UnityPause(1) -> SetPlayerPause(2,true)");
console.log("  resume       nativeResume -> UnityPause(0) -> next UnityPlayerLoop -> UnityPause(2) -> SetPlayerPause(0,true)");
console.log("  browser      hidden/visible -> suspend/resume; resumed first frame remains zero-delta by clock test");
console.log("  sources      official game/release libunity bytes; no browser, screenshot, or generated scene input");
