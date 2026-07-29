import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const IL2CPP = path.resolve(process.env.PCR_IL2CPP
  || path.join(ROOT, "../ptcg-apk-parser/apks/output/libil2cpp.so"));
const METADATA = path.resolve(process.env.PCR_GLOBAL_METADATA
  || path.join(ROOT, "../ptcg-apk-parser/apks/output/global-metadata.dat"));
const EXPECTED_LIBRARY = Object.freeze({
  byteLength: 128218264,
  sha256: "3e78eedc62770fff4cb129b4b8d898950e131b710b3c099237fe20d2d34ca48e",
});
const METHODS = Object.freeze([
  ["LtUICtrlTagCommand.PreProcessForTMP", 0x464BD64, 0x464C248, "d1eb9c5613ad44f17075da0cbaa6a0a6503dfc88f7cf80545431a55ec99505db"],
  ["LtUIMessageTagHandler.IsNumTagPlural", 0x464C97C, 0x464CA78, "eae8ba8b58d5726182641c40647dc9357cc8748b88208096f78935d06f86d482"],
  ["LtUIGrTagCommand.ReplaceSpecialCharForPatchim", 0x464DF10, 0x464DF54, "f324264f8fbf273ef75d1c59d2473c8a379bd583906e1b0d4c002582fb9a787e"],
  ["LtUIImgTagCommand.PreProcessElement", 0x464E9A4, 0x464F5E8, "468b2543d090aa1368b90b046270e072c7f11663c56f63e472f60abf89a4413d"],
  ["MtUIGrTagCommand.PreProcessPatchim", 0x57996F4, 0x5799920, "857fb3efeb6ab2af84b6b4de145a1ab10f22f5a17db199edfb640242f19e05ff"],
  ["MtUIGrTagCommand.IsPatchim", 0x5799920, 0x5799C2C, "08c2a32310e1f3a71a178132340210d6bc19463d61fd6c20eafdfd179a6de7b9"],
  ["MtUIGrTagCommand.TryOmitPatchim", 0x5799C2C, 0x5799E4C, "de0dc1f7216de6db11bdbd84fa964f743352546fd9b6360234e277d55e27cda8"],
]);
const PATCHIM_TABLE = Object.freeze({
  rva: 0x1C49984,
  sha256: "08b8725dc7b8a10fb8a468b82ceb9af0174adf06300eb905dd07669ddee59259",
  codeUnits: [0xB9AC, 0, 0xACE4, 0xD480, 0xAF43, 0xBB3C, 0xAC1C, 0xCD08, 0xD22C, 0xC0C9, 0xC545, 0xCCA0],
});
const EXPECTED_METADATA = Object.freeze({
  byteLength: 31429296,
  sha256: "bf58e06a98f9e9e05a1635f512ea432d33971bfc8280ba26df1c93e94b4f3cb9",
  literals: [
    [0xD4710, "Nbh"],
    [0x77BBD, "<nobr>"],
    [0x76BFE, "</nobr>"],
    [0xCCFAD, "Lsb"],
    [0xDB990, "Patchim"],
  ],
});

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function readSegments(bytes) {
  assert.equal(bytes.toString("ascii", 0, 4), "\x7fELF", "libil2cpp ELF magic");
  assert.equal(bytes[4], 2, "libil2cpp must be ELF64");
  assert.equal(bytes[5], 1, "libil2cpp must be little-endian");
  const programHeaderOffset = Number(bytes.readBigUInt64LE(32));
  const entrySize = bytes.readUInt16LE(54);
  const count = bytes.readUInt16LE(56);
  const segments = [];
  for (let index = 0; index < count; index += 1) {
    const offset = programHeaderOffset + index * entrySize;
    if (bytes.readUInt32LE(offset) !== 1) continue;
    segments.push({
      fileOffset: Number(bytes.readBigUInt64LE(offset + 8)),
      virtualAddress: Number(bytes.readBigUInt64LE(offset + 16)),
      fileSize: Number(bytes.readBigUInt64LE(offset + 32)),
    });
  }
  return segments;
}

function elfRange(bytes, segments, startRva, endRva) {
  const segment = segments.find((entry) => startRva >= entry.virtualAddress
    && endRva <= entry.virtualAddress + entry.fileSize);
  assert.ok(segment, `RVA 0x${startRva.toString(16)}..0x${endRva.toString(16)} is file-backed`);
  const start = segment.fileOffset + startRva - segment.virtualAddress;
  return bytes.subarray(start, start + endRva - startRva);
}

assert.ok(fs.existsSync(IL2CPP), `official libil2cpp missing: ${IL2CPP}`);
assert.ok(fs.existsSync(METADATA), `official metadata missing: ${METADATA}`);
const library = fs.readFileSync(IL2CPP);
assert.equal(library.length, EXPECTED_LIBRARY.byteLength, "libil2cpp byte length");
assert.equal(sha256(library), EXPECTED_LIBRARY.sha256, "libil2cpp SHA-256");
const segments = readSegments(library);

for (const [name, startRva, endRva, expectedHash] of METHODS) {
  const bytes = elfRange(library, segments, startRva, endRva);
  assert.equal(sha256(bytes), expectedHash, `${name} method bytes`);
}

const table = elfRange(library, segments, PATCHIM_TABLE.rva, PATCHIM_TABLE.rva + PATCHIM_TABLE.codeUnits.length * 2);
assert.equal(sha256(table), PATCHIM_TABLE.sha256, "Patchim PUA table bytes");
assert.deepEqual(
  Array.from({ length: PATCHIM_TABLE.codeUnits.length }, (_unused, index) => table.readUInt16LE(index * 2)),
  PATCHIM_TABLE.codeUnits,
  "Patchim PUA table code units",
);

const metadata = fs.readFileSync(METADATA);
assert.equal(metadata.length, EXPECTED_METADATA.byteLength, "global-metadata byte length");
assert.equal(sha256(metadata), EXPECTED_METADATA.sha256, "global-metadata SHA-256");
for (const [offset, literal] of EXPECTED_METADATA.literals) {
  assert.equal(metadata.toString("utf8", offset, offset + Buffer.byteLength(literal)), literal,
    `metadata literal ${literal}`);
}

console.log("Official card text runtime audit OK");
console.log(`  libil2cpp ${EXPECTED_LIBRARY.sha256}`);
console.log(`  ${METHODS.length} message/TMP method bodies, ${EXPECTED_METADATA.literals.length} metadata literals and ${PATCHIM_TABLE.codeUnits.length} Patchim PUA entries byte-pinned`);
