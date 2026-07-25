#!/usr/bin/env node
// Static guard for the read-only Frida capture probe. No device, browser, or renderer is started.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const GAME = path.resolve(process.env.PCR_GAME_LIBUNITY
  || path.join(ROOT, "../.cache/ptcgp-1.6.0/libunity.so"));
const PROBE = path.join(ROOT, "build/capture-official-sort-runtime.js");
const EXPECTED = Object.freeze({
  gameSha256: "43a04223f94b6ca0c7cf128b399fe0656c57b5a18a10bf21bb9ce27aeb219722",
  functions: Object.freeze([
    [0x5aba6c, 0x218, "251e055c88e41afed3d9393853b53be941cdd0b4cf4916915628da731df2978a"],
    [0x54c62c, 0x0d4, "07f09116be6e38f5682b68590a62852a45cdeeb617dc3d06e157d94f9ff85a5f"],
    [0x54cc10, 0xf68, "440935172837465a015f4bcf481c831aa800129fb7b8c40a1dffe9d11c2c88ac"],
  ]),
  words: Object.freeze([
    [0x5aba6c, 0xd101c3ff],
    [0x54c62c, 0xa9bd5ffe],
    [0x54cc10, 0x6db63bef],
    [0x54d274, 0x394302a9],
    [0x54d2f4, 0x4a130009],
    [0x54d408, 0x29012511],
  ]),
});

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
function safeNumber(value, label) {
  const number = Number(value);
  assert.ok(Number.isSafeInteger(number), `${label} exceeds the safe integer range`);
  return number;
}

function readElf(buffer) {
  assert.ok(buffer.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46])), "game libunity is not ELF");
  assert.equal(buffer[4], 2, "expected ELF64");
  assert.equal(buffer[5], 1, "expected little-endian ELF");
  const offset = safeNumber(buffer.readBigUInt64LE(0x20), "program-header offset");
  const entrySize = buffer.readUInt16LE(0x36);
  const count = buffer.readUInt16LE(0x38);
  const segments = [];
  for (let index = 0; index < count; index += 1) {
    const row = offset + index * entrySize;
    if (buffer.readUInt32LE(row) !== 1) continue;
    segments.push({
      fileOffset: safeNumber(buffer.readBigUInt64LE(row + 8), "segment file offset"),
      virtualAddress: safeNumber(buffer.readBigUInt64LE(row + 16), "segment virtual address"),
      fileSize: safeNumber(buffer.readBigUInt64LE(row + 32), "segment file size"),
    });
  }
  return { buffer, segments };
}

function range(elf, rva, size) {
  const segment = elf.segments.find((row) => rva >= row.virtualAddress
    && rva + size <= row.virtualAddress + row.fileSize);
  assert.ok(segment, `RVA 0x${rva.toString(16)} is not file-backed`);
  const offset = segment.fileOffset + rva - segment.virtualAddress;
  return elf.buffer.subarray(offset, offset + size);
}

assert.ok(fs.existsSync(GAME), `missing game libunity: ${GAME}`);
assert.ok(fs.existsSync(PROBE), `missing capture probe: ${PROBE}`);
const game = fs.readFileSync(GAME);
const elf = readElf(game);
assert.equal(sha256(game), EXPECTED.gameSha256, "game libunity SHA-256 drifted");
for (const [rva, size, digest] of EXPECTED.functions) {
  assert.equal(sha256(range(elf, rva, size)), digest, `function slice 0x${rva.toString(16)} drifted`);
}
for (const [rva, word] of EXPECTED.words) {
  assert.equal(range(elf, rva, 4).readUInt32LE(0), word, `instruction 0x${rva.toString(16)} drifted`);
}

const source = fs.readFileSync(PROBE, "utf8");
for (const [rva, word] of EXPECTED.words) {
  assert.ok(source.includes(`0x${rva.toString(16)}`), `probe RVA 0x${rva.toString(16)}`);
  assert.ok(source.includes(`0x${word.toString(16)}`), `probe guard word 0x${word.toString(16)}`);
}
for (const token of [
  "sessionId", "startedAtUnixMs", "processId",
  "materialSortByte17c", "shaderObjectInstanceIdLow8", "localKeywordHashLow8",
  "materialName", "shaderName", "this.context.x8", "this.context.x24",
  "stateKey", "entry28", "packedMaterialSlotAndSrp", "packedLightmapIndices",
  "visibleNodeIndex", "meshSmallMeshId", "drawCandidateOrdinal", "node.add(0x100).readU32()",
]) assert.ok(source.includes(token), `probe output is missing ${token}`);
assert.match(source, /stateKey !== expected/, "probe must verify its captured state-key formula");
assert.match(source, /entry28 !== expectedEntry28/, "probe must verify its captured entry+0x28 formula");
assert.match(source, /drawCandidateOrdinal:\s*\(u32\(this\.context\.x19\) - 1\) >>> 0/,
  "probe must undo the native candidate-ordinal increment before the store hook");
assert.doesNotMatch(source, /Interceptor\.replace|Memory\.patchCode|\.write(?:U|S|Pointer|ByteArray)/,
  "capture probe must remain read-only");

console.log(`official runtime-sort capture tool: ${EXPECTED.functions.length} functions / ${EXPECTED.words.length} hook words verified; device capture pending`);
