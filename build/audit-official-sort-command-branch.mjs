#!/usr/bin/env node
// Read-only audit of the DrawingSettings branch-selector path used by the
// official Pokemon TCG Pocket 1.6.0 DrawOpaque/DrawTransparent passes.
// Authority is package-matched APKM, libil2cpp, and libunity bytes only.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { inflateRawSync } from "node:zlib";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const APKM = path.resolve(process.env.PCR_APKM
  || path.join(ROOT, "../ptcg-apk-parser/apks/jp.pokemon.pokemontcgp_1.6.0.apkm"));
const ARM64_SPLIT_CACHE = path.resolve(process.env.PCR_ARM64_SPLIT
  || path.join(ROOT, "../.cache/ptcgp-1.6.0/split_config.arm64_v8a.apk"));
const JSON_MODE = process.argv.includes("--json");

const EXPECTED = Object.freeze({
  apkmSha256: "9b7f9067e00a54f342bd4f17e669ceeb86b80bb7d34ff2d0d0fe82050a62f201",
  arm64SplitSha256: "7faf449bae431dcfeda4f882ecb04290af66cc4ccfeefc620e24cac70d22fcec",
  libil2cppSha256: "3e78eedc62770fff4cb129b4b8d898950e131b710b3c099237fe20d2d34ca48e",
  libunitySha256: "43a04223f94b6ca0c7cf128b399fe0656c57b5a18a10bf21bb9ce27aeb219722",
  unityVersion: "2022.3.62f2_7670c08855a9",
});

const PASSES = Object.freeze([
  Object.freeze({
    name: "DrawOpaque",
    ctorStart: 0x430b714,
    ctorEnd: 0x430ba24,
    executeStart: 0x430d3e8,
    executeEnd: 0x430d694,
    helperCall: 0x430d508,
    drawCall: 0x430d5a0,
    tagListStore: Object.freeze([0x430b9f4, "748e0ef8"]),
    tagAdds: Object.freeze([
      [0x430b8e8, "8068b697"], [0x430b914, "7568b697"],
      [0x430b940, "6a68b697"], [0x430b96c, "5f68b697"],
      [0x430b998, "5468b697"], [0x430b9c4, "4968b697"],
      [0x430b9f0, "3e68b697"],
    ]),
  }),
  Object.freeze({
    name: "DrawTransparent",
    ctorStart: 0x430bbd0,
    ctorEnd: 0x430bee0,
    executeStart: 0x430d938,
    executeEnd: 0x430dcc0,
    helperCall: 0x430db0c,
    drawCall: 0x430dba4,
    tagListStore: Object.freeze([0x430beb0, "748e0ef8"]),
    tagAdds: Object.freeze([
      [0x430bda4, "5167b697"], [0x430bdd0, "4667b697"],
      [0x430bdfc, "3b67b697"], [0x430be28, "3067b697"],
      [0x430be54, "2567b697"], [0x430be80, "1a67b697"],
      [0x430beac, "0f67b697"],
    ]),
  }),
]);

const SLICES = Object.freeze({
  il2cpp: Object.freeze([
    ["DrawOpaquePass..ctor", 0x430b714, 0x430ba24, "8d3381a10b2aa01841fd2a391c2e7288a0846d40a2983f3442cdd98010cb846f"],
    ["DrawTransparentPass..ctor", 0x430bbd0, 0x430bee0, "7fff5f064edc884501cdaefeed761a21e5d5e97134099e9e0ca9786fee2ae493"],
    ["DrawOpaquePass.Execute", 0x430d3e8, 0x430d694, "3dcb70767a6e6737980e7cd1d131ee0e301dc1f3b289bfda355dcb7d9159e5d0"],
    ["DrawTransparentPass.Execute", 0x430d938, 0x430dcc0, "854f599f20063b5db3d924ffa07ee210f82beb03e51698b61f4092daeabb8ddd"],
    ["pass DrawingSettings helper", 0x63c3f70, 0x63c4034, "f444001c417357ec743093ce8a5512af5da02851b087bcb50db522c6e08d1432"],
    ["create DrawingSettings", 0x63edc5c, 0x63eddf0, "d0b5e6f413ea753be6a87442f9cb6d53c993a788cf6cebaafcb20b37ad0d311e"],
    ["create DrawingSettings from tags", 0x63eddf0, 0x63ee00c, "9bfed6585cd08a96575dc3d0257ddf85159d1df0fd0d62bcd0d7d325f9066244"],
    ["DrawingSettings..ctor", 0x6543408, 0x65434dc, "b72523e458eed6d2bada29496bcada432d87a5a40db7891e2e0fc056e969b252"],
    ["DrawingSettings fixed setters", 0x65434dc, 0x6543514, "7326715d8ba9942fdbc051f3ccfd51d06f17ed8a3ae1e2a7aea9e37f01528a05"],
    ["DrawingSettings +0xbc setter", 0x65435a8, 0x65435b0, "1a158e533322fcbc506c0b9689f42ca75fce925f597c4c881ddf0dd2ac6b0582"],
    ["DrawingSettings pass-name setter valid path", 0x6543710, 0x65437a4, "7a336dfc1d9e56c401bddc838321b7257872fdeabb88dc2a7fa786b43d721f2e"],
    ["ScriptableRenderContext.DrawRenderers", 0x6548f1c, 0x6548fd8, "d83f49d2a32df98ae1474891ad8412f9b28f89c9cf7e7853d78e3b1abf12f49d"],
    ["DrawRenderers_Internal_Injected resolver", 0x6547dd4, 0x6547eac, "e7b5199b2b44df649d900009282e19597a56305e7f073d90f0acb6c33cb202a2"],
  ]),
  unity: Object.freeze([
    ["DrawRenderers injected icall registration", 0x40f09c, 0x40f0b0, "ded5a1812bf51433c4fbfbf714d9cf1dd20c9901ec9abe7963193995c6877582"],
    ["DrawRenderers injected wrapper", 0x4049cc, 0x4049e8, "5bf98050233da7f277918fd4870305beb1541cc6633e4098e083019d9bf3e53e"],
    ["DrawRenderers injected bridge", 0x54046c, 0x5404ac, "824805110b475b60f558aa7e3acb0b1123622a6f9ccf323fea4c80b60c924b90"],
    ["CreateRendererList", 0x5404ac, 0x540608, "90647be0474c324ad829ba61b492b9a376fb0ca00f5097e49a3f65909b174fa1"],
    ["PrepareDrawRenderersCommand", 0x54dd08, 0x54e37c, "fc05f3119151fdc6a2394add86eba61f77432e230cf0f8acedbeed611d68cb7e"],
    ["PrepareScriptableLoopObjectData", 0x54cc10, 0x54db78, "440935172837465a015f4bcf481c831aa800129fb7b8c40a1dffe9d11c2c88ac"],
    ["entry+0x08 branch window", 0x54d264, 0x54d308, "38e0a447edc0b6d1f4ee6e80fbe9a46ef71bc9ad29a585404484fee41ec9877f"],
  ]),
});

const WORDS = Object.freeze({
  il2cpp: Object.freeze([
    // Passes load their seven-tag list, call the same helper, copy all 0xc4
    // DrawingSettings bytes, and pass that copy to DrawRenderers.
    [0x430d4f0, "a17640f9", "opaque: load tag list at pass+0xe8"],
    [0x430d4f4, "e8230191", "opaque: helper result at sp+0x48"],
    [0x430d500, "63078052", "opaque: CommonOpaque 0x3b"],
    [0x430d504, "e4031faa", "opaque: null metadata argument"],
    [0x430d508, "9ada8294", "opaque: call shared helper"],
    [0x430d510, "e0430491", "opaque: copied settings at sp+0x110"],
    [0x430d514, "e1230191", "opaque: helper result source"],
    [0x430d518, "82188052", "opaque: copy 0xc4 bytes"],
    [0x430d520, "d8c59294", "opaque: copy DrawingSettings"],
    [0x430d594, "e3430491", "opaque: DrawRenderers settings pointer"],
    [0x430d5a0, "5fee8894", "opaque: DrawRenderers"],
    [0x430daf4, "a17640f9", "transparent: load tag list at pass+0xe8"],
    [0x430daf8, "e8630291", "transparent: helper result at sp+0x98"],
    [0x430db04, "e3028052", "transparent: CommonTransparent 0x17"],
    [0x430db08, "e4031faa", "transparent: null metadata argument"],
    [0x430db0c, "19d98294", "transparent: call shared helper"],
    [0x430db14, "e0830591", "transparent: copied settings at sp+0x160"],
    [0x430db18, "e1630291", "transparent: helper result source"],
    [0x430db1c, "82188052", "transparent: copy 0xc4 bytes"],
    [0x430db24, "57c49294", "transparent: copy DrawingSettings"],
    [0x430db98, "e3830591", "transparent: DrawRenderers settings pointer"],
    [0x430dba4, "deec8894", "transparent: DrawRenderers"],

    // Shared helper chain and complete 0xc4-byte returns.
    [0x63c3f8c, "f30308aa", "outer helper: preserve result pointer"],
    [0x63c3fdc, "e8030091", "outer helper: nested result at sp"],
    [0x63c3ff0, "80a70094", "outer helper: call tag-list helper"],
    [0x63c3ff4, "e1030091", "outer helper: copy source at sp"],
    [0x63c3ff8, "e00313aa", "outer helper: restore result pointer"],
    [0x63c3ffc, "82188052", "outer helper: copy 0xc4 bytes"],
    [0x63c4000, "20eb0f94", "outer helper: return full settings"],
    [0x63ede20, "f30308aa", "tag helper: preserve result pointer"],
    [0x63edef0, "5bffff97", "tag helper: create first-tag settings"],
    [0x63edf04, "34008052", "tag helper: additional tags start at index 1"],
    [0x63edf38, "e103142a", "tag helper: pass current tag index"],
    [0x63edf44, "f3550594", "tag helper: set additional pass name"],
    [0x63edf48, "a81a40b9", "tag helper: reload tag count"],
    [0x63edf4c, "94060011", "tag helper: increment tag index"],
    [0x63edf50, "9f02086b", "tag helper: compare index with count"],
    [0x63edf54, "cbfdff54", "tag helper: loop while index is in range"],
    [0x63edfd0, "e00313aa", "tag helper: restore result pointer"],
    [0x63edfd4, "82188052", "tag helper: copy 0xc4 bytes"],
    [0x63edfd8, "2a430f94", "tag helper: return full settings"],

    // The constructor zeros +0xc0. Every subsequently called fixed setter is
    // pinned to +0xa0, +0xa4, or +0xbc; pass-name writes stay below +0x80.
    [0x63edd30, "e0830491", "builder: DrawingSettings destination"],
    [0x63edd3c, "b3550594", "builder: DrawingSettings constructor"],
    [0x63edd4c, "e4550594", "builder: call +0xa0 setter"],
    [0x63edd5c, "13560594", "builder: call +0xbc setter"],
    [0x63edd6c, "de550594", "builder: call first +0xa4 bit setter"],
    [0x63edda8, "d3550594", "builder: call second +0xa4 bit setter"],
    [0x63eddb4, "82188052", "builder: copy 0xc4 bytes"],
    [0x63eddb8, "b2430f94", "builder: return full settings"],
    [0x65434c4, "7fc200b9", "DrawingSettings ctor: str wzr,[settings,#0xc0]"],
    [0x65434dc, "01a000b9", "setter writes settings+0xa0"],
    [0x65434ec, "08a400b9", "setter writes settings+0xa4"],
    [0x654350c, "08a400b9", "setter writes settings+0xa4"],
    [0x65435a8, "01bc00b9", "setter writes settings+0xbc"],
    [0x654376c, "085c40f9", "pass-name setter: load maximum count"],
    [0x6543774, "1f01136b", "pass-name setter: bounds check index"],
    [0x6543784, "934a338b", "pass-name setter: base+index*4"],
    [0x654378c, "606200b9", "pass-name setter: store at settings+0x60+index*4"],

    // Managed DrawRenderers preserves its DrawingSettings pointer as argument 2
    // to the resolved injected icall.
    [0x6548f40, "f40303aa", "DrawRenderers: preserve DrawingSettings argument x3"],
    [0x6548fa0, "e20314aa", "DrawRenderers: forward settings as injected x2"],
    [0x6548fbc, "86fbff97", "DrawRenderers: call injected resolver"],
    [0x6547e04, "f60302aa", "injected resolver: preserve settings x2"],
    [0x6547e54, "20abfdd0", "injected resolver: icall literal page"],
    [0x6547e58, "00041e91", "injected resolver: icall literal address"],
    [0x6547e68, "25030012", "injected resolver: bool mask"],
    [0x6547e78, "e20316aa", "injected resolver: forward settings x2"],
    [0x6547e8c, "00013fd6", "injected resolver: call resolved icall"],
  ]),
  unity: Object.freeze([
    // Icall registration and wrapper tie the managed name to 0x54046c.
    [0x40f09c, "e0e5fff0", "icall registration: name page"],
    [0x40f0a0, "a1ffffb0", "icall registration: wrapper page"],
    [0x40f0a4, "00341091", "icall registration: name at 0xce40d"],
    [0x40f0a8, "21302791", "icall registration: wrapper at 0x4049cc"],
    [0x4049e4, "a2ee0414", "injected wrapper: branch to bridge"],
    [0x540480, "e8230091", "bridge: command result at sp+8"],
    [0x54048c, "08000094", "bridge: call CreateRendererList"],

    // CreateRendererList keeps settings as x27, copies bytes 0..0xc0 into the
    // command, then writes the independent injected bool at command+0xec.
    [0x5404fc, "f903052a", "CreateRendererList: preserve injected bool"],
    [0x540508, "fb0302aa", "CreateRendererList: preserve settings pointer x2"],
    [0x540510, "870f0094", "CreateRendererList: allocate command"],
    [0x540514, "22188052", "CreateRendererList: copy size 0xc1"],
    [0x540518, "e1031baa", "CreateRendererList: settings copy source"],
    [0x54051c, "f70300aa", "CreateRendererList: command destination"],
    [0x540520, "201b3194", "CreateRendererList: copy settings to command"],
    [0x540548, "28030012", "CreateRendererList: mask injected bool"],
    [0x540578, "e8b20339", "CreateRendererList: strb bool,[command,#0xec]"],

    // PrepareDrawRenderersCommand copies the complete 0x108-byte command.
    [0x54dd2c, "f40300aa", "PrepareDrawRenderersCommand: preserve source command"],
    [0x54de10, "00400191", "PrepareDrawRenderersCommand: destination at job+0x50"],
    [0x54de14, "02218052", "PrepareDrawRenderersCommand: copy size 0x108"],
    [0x54de18, "e10314aa", "PrepareDrawRenderersCommand: source command"],
    [0x54de24, "dfe43094", "PrepareDrawRenderersCommand: copy full command"],

    // The regular producer preserves its command argument, reads byte +0xc0,
    // and takes the zero target at 0x54d29c (the hashed entry+0x08 branch).
    [0x54cc80, "fb0301aa", "producer: preserve command argument x1"],
    [0x54cdc0, "fb8b00f9", "producer: save command pointer"],
    [0x54d268, "f58b40f9", "producer: reload command pointer"],
    [0x54d274, "a9024339", "producer: ldrb branch selector,[command,#0xc0]"],
    [0x54d278, "29010034", "producer: cbz selector,hashed branch"],
    [0x54d29c, "09e14539", "hashed branch entry"],
    [0x54d2e0, "00610091", "hashed branch: material keyword state"],
    [0x54d2e4, "7d0c0094", "hashed branch: keyword hash call"],
    [0x54d2e8, "a8024339", "hashed branch: selector remains command+0xc0"],
  ]),
});

const BRANCHES = Object.freeze({
  il2cpp: Object.freeze([
    [0x430d508, "bl", 0x63c3f70], [0x430d520, "bl", 0x67bec80],
    [0x430d5a0, "bl", 0x6548f1c], [0x430db0c, "bl", 0x63c3f70],
    [0x430db24, "bl", 0x67bec80], [0x430dba4, "bl", 0x6548f1c],
    [0x63c3ff0, "bl", 0x63eddf0], [0x63c4000, "bl", 0x67bec80],
    [0x63edef0, "bl", 0x63edc5c], [0x63edf44, "bl", 0x6543710],
    [0x63edfd8, "bl", 0x67bec80], [0x63edd3c, "bl", 0x6543408],
    [0x63edd4c, "bl", 0x65434dc], [0x63edd5c, "bl", 0x65435a8],
    [0x63edd6c, "bl", 0x65434e4], [0x63edda8, "bl", 0x65434f4],
    [0x63eddb8, "bl", 0x67bec80], [0x6548fbc, "bl", 0x6547dd4],
  ]),
  unity: Object.freeze([
    [0x4049e4, "b", 0x54046c], [0x54048c, "bl", 0x5404ac],
    [0x540520, "bl", 0x11871a0], [0x54de24, "bl", 0x11871a0],
    [0x54d278, "cbz", 0x54d29c],
  ]),
});

const DRAWING_SETTINGS_OFFSET = 0xc0;
const MANAGED_SETTINGS_SIZE = 0xc4;
const SETTINGS_TO_COMMAND_SIZE = 0xc1;
const INJECTED_BOOL_OFFSET = 0xec;
const COMMAND_SIZE = 0x108;
const TAG_LIST_ADD = 0x30a5ae8;
const DRAWING_SETTINGS_MUTATORS = new Set([
  0x6543408, 0x65434dc, 0x65434e4, 0x65434f4, 0x65435a8, 0x6543710,
]);

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

function zipEntry(zip, wantedName) {
  const minimum = Math.max(0, zip.length - 0x10000 - 22);
  let eocd = -1;
  for (let offset = zip.length - 22; offset >= minimum; offset -= 1) {
    if (zip.readUInt32LE(offset) === 0x06054b50) {
      eocd = offset;
      break;
    }
  }
  requireCondition(eocd >= 0, "ZIP end-of-central-directory was not found");
  const entryCount = zip.readUInt16LE(eocd + 10);
  let cursor = zip.readUInt32LE(eocd + 16);
  for (let index = 0; index < entryCount; index += 1) {
    requireCondition(zip.readUInt32LE(cursor) === 0x02014b50,
      "invalid ZIP central-directory entry");
    const method = zip.readUInt16LE(cursor + 10);
    const compressedSize = zip.readUInt32LE(cursor + 20);
    const uncompressedSize = zip.readUInt32LE(cursor + 24);
    const nameLength = zip.readUInt16LE(cursor + 28);
    const extraLength = zip.readUInt16LE(cursor + 30);
    const commentLength = zip.readUInt16LE(cursor + 32);
    const localOffset = zip.readUInt32LE(cursor + 42);
    const name = zip.toString("utf8", cursor + 46, cursor + 46 + nameLength);
    if (name === wantedName) {
      requireCondition(zip.readUInt32LE(localOffset) === 0x04034b50,
        `invalid local ZIP entry ${name}`);
      const localNameLength = zip.readUInt16LE(localOffset + 26);
      const localExtraLength = zip.readUInt16LE(localOffset + 28);
      const dataStart = localOffset + 30 + localNameLength + localExtraLength;
      const compressed = zip.subarray(dataStart, dataStart + compressedSize);
      const value = method === 0 ? Buffer.from(compressed)
        : method === 8 ? inflateRawSync(compressed)
          : null;
      requireCondition(value, `unsupported ZIP compression method ${method} for ${name}`);
      requireCondition(value.length === uncompressedSize, `ZIP size mismatch for ${name}`);
      return value;
    }
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  fail(`ZIP entry not found: ${wantedName}`);
}

function readElf(buffer, label) {
  requireCondition(buffer.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46])),
    `${label}: not ELF`);
  requireCondition(buffer[4] === 2 && buffer[5] === 1,
    `${label}: expected ELF64 little-endian`);
  requireCondition(buffer.readUInt16LE(0x12) === 183, `${label}: expected AArch64`);
  const programOffset = safeNumber(buffer.readBigUInt64LE(0x20), `${label} program offset`);
  const programEntrySize = buffer.readUInt16LE(0x36);
  const programCount = buffer.readUInt16LE(0x38);
  const segments = [];
  for (let index = 0; index < programCount; index += 1) {
    const offset = programOffset + index * programEntrySize;
    if (buffer.readUInt32LE(offset) !== 1) continue;
    segments.push(Object.freeze({
      fileOffset: safeNumber(buffer.readBigUInt64LE(offset + 8), `${label} segment file offset`),
      virtualAddress: safeNumber(buffer.readBigUInt64LE(offset + 16), `${label} segment address`),
      fileSize: safeNumber(buffer.readBigUInt64LE(offset + 32), `${label} segment size`),
    }));
  }
  requireCondition(segments.length > 0, `${label}: no PT_LOAD segments`);
  return Object.freeze({ buffer, label, segments });
}

function elfRange(elf, startRva, endRva) {
  const segment = elf.segments.find((candidate) => startRva >= candidate.virtualAddress
    && endRva <= candidate.virtualAddress + candidate.fileSize);
  requireCondition(segment,
    `${elf.label}: RVA 0x${startRva.toString(16)}..0x${endRva.toString(16)} is not file-backed`);
  const offset = segment.fileOffset + startRva - segment.virtualAddress;
  return elf.buffer.subarray(offset, offset + endRva - startRva);
}

function readCString(elf, rva, maximum = 512) {
  const bytes = elfRange(elf, rva, rva + maximum);
  const end = bytes.indexOf(0);
  requireCondition(end >= 0, `${elf.label}: unterminated string at RVA 0x${rva.toString(16)}`);
  return bytes.toString("utf8", 0, end);
}

function wordAt(elf, rva) {
  return elfRange(elf, rva, rva + 4).readUInt32LE(0);
}

function wordHex(elf, rva) {
  return elfRange(elf, rva, rva + 4).toString("hex");
}

function signExtend(value, bits) {
  const sign = 2 ** (bits - 1);
  return value >= sign ? value - 2 ** bits : value;
}

function branchTarget(elf, rva, kind) {
  const word = wordAt(elf, rva);
  if (kind === "b" || kind === "bl") {
    const opcode = word >>> 26;
    requireCondition(opcode === (kind === "bl" ? 0b100101 : 0b000101),
      `${elf.label}: expected ${kind} at RVA 0x${rva.toString(16)}`);
    return rva + signExtend(word & 0x03ffffff, 26) * 4;
  }
  requireCondition(kind === "cbz", `unsupported branch kind ${kind}`);
  requireCondition((word & 0x7f000000) === 0x34000000,
    `${elf.label}: expected cbz at RVA 0x${rva.toString(16)}`);
  return rva + signExtend((word >>> 5) & 0x7ffff, 19) * 4;
}

function directBlTargets(elf, startRva, endRva) {
  const targets = [];
  for (let rva = startRva; rva < endRva; rva += 4) {
    const word = wordAt(elf, rva);
    if ((word >>> 26) === 0b100101) {
      targets.push(Object.freeze({ rva, target: branchTarget(elf, rva, "bl") }));
    }
  }
  return targets;
}

function loadArm64Split(apkm) {
  if (fs.existsSync(ARM64_SPLIT_CACHE)) {
    return { bytes: fs.readFileSync(ARM64_SPLIT_CACHE), source: ARM64_SPLIT_CACHE };
  }
  return {
    bytes: zipEntry(apkm, "split_config.arm64_v8a.apk"),
    source: `${APKM}!split_config.arm64_v8a.apk`,
  };
}

let report;
try {
  requireCondition(fs.existsSync(APKM), `official APKM is missing: ${APKM}`);
  const apkm = fs.readFileSync(APKM);
  requireCondition(sha256(apkm) === EXPECTED.apkmSha256, "official APKM SHA-256 mismatch");

  const splitSource = loadArm64Split(apkm);
  requireCondition(sha256(splitSource.bytes) === EXPECTED.arm64SplitSha256,
    "official arm64 split SHA-256 mismatch");
  const libil2cpp = zipEntry(splitSource.bytes, "lib/arm64-v8a/libil2cpp.so");
  const libunity = zipEntry(splitSource.bytes, "lib/arm64-v8a/libunity.so");
  requireCondition(sha256(libil2cpp) === EXPECTED.libil2cppSha256,
    "official libil2cpp SHA-256 mismatch");
  requireCondition(sha256(libunity) === EXPECTED.libunitySha256,
    "official libunity SHA-256 mismatch");
  requireCondition(libunity.includes(Buffer.from(EXPECTED.unityVersion)),
    "official libunity version identity mismatch");

  const elves = Object.freeze({
    il2cpp: readElf(libil2cpp, "official libil2cpp"),
    unity: readElf(libunity, "official libunity"),
  });

  let sliceChecks = 0;
  for (const [library, rows] of Object.entries(SLICES)) {
    for (const [name, startRva, endRva, expectedHash] of rows) {
      const bytes = elfRange(elves[library], startRva, endRva);
      requireCondition(bytes.length === endRva - startRva, `${name}: slice size mismatch`);
      requireCondition(sha256(bytes) === expectedHash, `${name}: body SHA-256 mismatch`);
      sliceChecks += 1;
    }
  }

  let wordChecks = 0;
  for (const [library, rows] of Object.entries(WORDS)) {
    for (const [rva, expectedHex, meaning] of rows) {
      const actualHex = wordHex(elves[library], rva);
      requireCondition(actualHex === expectedHex,
        `${meaning}: instruction mismatch at RVA 0x${rva.toString(16)} (${actualHex})`);
      wordChecks += 1;
    }
  }

  let branchChecks = 0;
  for (const [library, rows] of Object.entries(BRANCHES)) {
    for (const [rva, kind, expectedTarget] of rows) {
      const actualTarget = branchTarget(elves[library], rva, kind);
      requireCondition(actualTarget === expectedTarget,
        `${kind} at RVA 0x${rva.toString(16)} targets 0x${actualTarget.toString(16)}, expected 0x${expectedTarget.toString(16)}`);
      branchChecks += 1;
    }
  }

  const il2cppIcall = "UnityEngine.Rendering.ScriptableRenderContext::DrawRenderers_Internal_Injected(UnityEngine.Rendering.ScriptableRenderContext&,System.IntPtr,UnityEngine.Rendering.DrawingSettings&,UnityEngine.Rendering.FilteringSettings&,UnityEngine.Rendering.ShaderTagId&,System.Boolean,System.IntPtr,System.IntPtr,System.Int32)";
  const unityIcall = "UnityEngine.Rendering.ScriptableRenderContext::DrawRenderers_Internal_Injected";
  requireCondition(readCString(elves.il2cpp, 0x1aad781) === il2cppIcall,
    "libil2cpp DrawRenderers injected icall literal mismatch");
  requireCondition(readCString(elves.unity, 0xce40d) === unityIcall,
    "libunity DrawRenderers injected icall registration literal mismatch");

  const passEvidence = [];
  for (const pass of PASSES) {
    const [storeRva, storeHex] = pass.tagListStore;
    requireCondition(wordHex(elves.il2cpp, storeRva) === storeHex,
      `${pass.name}: tag-list field store drifted`);
    wordChecks += 1;
    for (const [rva, expectedHex] of pass.tagAdds) {
      requireCondition(wordHex(elves.il2cpp, rva) === expectedHex,
        `${pass.name}: tag List.Add word drifted at RVA 0x${rva.toString(16)}`);
      requireCondition(branchTarget(elves.il2cpp, rva, "bl") === TAG_LIST_ADD,
        `${pass.name}: tag List.Add target drifted at RVA 0x${rva.toString(16)}`);
      wordChecks += 1;
      branchChecks += 1;
    }
    const actualAdds = directBlTargets(elves.il2cpp, pass.ctorStart, pass.ctorEnd)
      .filter((row) => row.target === TAG_LIST_ADD)
      .map((row) => row.rva);
    requireCondition(JSON.stringify(actualAdds) === JSON.stringify(pass.tagAdds.map(([rva]) => rva)),
      `${pass.name}: constructor no longer creates exactly the pinned seven-tag list`);

    const postHelperCalls = directBlTargets(elves.il2cpp, pass.helperCall + 4, pass.drawCall);
    const laterMutator = postHelperCalls.find((row) => DRAWING_SETTINGS_MUTATORS.has(row.target));
    requireCondition(!laterMutator,
      `${pass.name}: Execute calls a DrawingSettings mutator after the shared helper`);
    passEvidence.push(Object.freeze({
      pass: pass.name,
      executeRva: `0x${pass.executeStart.toString(16)}`,
      sharedHelperRva: "0x63c3f70",
      shaderTagCount: pass.tagAdds.length,
      postHelperDrawingSettingsMutators: 0,
    }));
  }

  requireCondition(PASSES.length === 2
    && PASSES[0].name === "DrawOpaque"
    && PASSES[1].name === "DrawTransparent",
  "audit scope must contain only DrawOpaque and DrawTransparent");
  requireCondition(PASSES.every((pass) => pass.tagAdds.length === 7),
    "both audited passes must have exactly seven shader tags");

  const additionalPassNameOffsets = Array.from(
    { length: PASSES[0].tagAdds.length - 1 },
    (_, index) => 0x60 + (index + 1) * 4,
  );
  const postCtorWriteOffsets = [...additionalPassNameOffsets, 0xa0, 0xa4, 0xbc];
  requireCondition(postCtorWriteOffsets.every((offset) => offset !== DRAWING_SETTINGS_OFFSET),
    "a post-constructor DrawingSettings setter can overwrite +0xc0");
  requireCondition(Math.max(...additionalPassNameOffsets) === 0x78,
    "seven-tag pass-name write range drifted");
  requireCondition(DRAWING_SETTINGS_OFFSET < MANAGED_SETTINGS_SIZE,
    "managed 0xc4 copy does not include branch selector");
  requireCondition(DRAWING_SETTINGS_OFFSET < SETTINGS_TO_COMMAND_SIZE,
    "native 0xc1 copy does not include branch selector");
  requireCondition(INJECTED_BOOL_OFFSET !== DRAWING_SETTINGS_OFFSET,
    "injected bool aliases branch selector");
  requireCondition(DRAWING_SETTINGS_OFFSET < COMMAND_SIZE
    && INJECTED_BOOL_OFFSET < COMMAND_SIZE,
  "0x108 command copy does not include required fields");

  const result = Object.freeze({
    branchSelector: 0,
    entry08Branch: "hashed",
    statement: "DrawOpaque/DrawTransparent branchSelector=0, entry08Branch=hashed",
  });
  report = Object.freeze({
    status: "proved",
    source: Object.freeze({
      apkm: APKM,
      arm64Split: splitSource.source,
      apkmSha256: EXPECTED.apkmSha256,
      libil2cppSha256: EXPECTED.libil2cppSha256,
      libunitySha256: EXPECTED.libunitySha256,
      unityVersion: EXPECTED.unityVersion,
    }),
    scope: Object.freeze({
      only: Object.freeze(["DrawOpaquePass.Execute", "DrawTransparentPass.Execute"]),
      excludesAllOtherPasses: true,
    }),
    passes: Object.freeze(passEvidence),
    transfer: Object.freeze({
      drawingSettingsConstructorRva: "0x6543408",
      branchSelectorStoreRva: "0x65434c4",
      branchSelectorOffset: "0xc0",
      postConstructorWriteOffsets: Object.freeze(postCtorWriteOffsets.map((offset) => `0x${offset.toString(16)}`)),
      managedCopyBytes: MANAGED_SETTINGS_SIZE,
      settingsToCommandCopyBytes: SETTINGS_TO_COMMAND_SIZE,
      injectedBoolOffset: "0xec",
      commandCopyBytes: COMMAND_SIZE,
      producerLoadRva: "0x54d274",
      hashedBranchRva: "0x54d29c",
    }),
    checks: Object.freeze({ sliceHashes: sliceChecks, exactInstructionWords: wordChecks, decodedBranches: branchChecks }),
    result,
  });
} catch (error) {
  console.error(`BAD official sort-command branch audit: ${error.message}`);
  process.exit(1);
}

if (JSON_MODE) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log("Official sort-command branch audit OK");
  console.log(`  APKM       ${report.source.apkmSha256}`);
  console.log(`  libil2cpp  ${report.source.libil2cppSha256}`);
  console.log(`  libunity   ${report.source.libunitySha256}`);
  console.log(`  evidence   ${report.checks.sliceHashes} function hashes, ${report.checks.exactInstructionWords} exact words, ${report.checks.decodedBranches} decoded branches`);
  console.log(report.result.statement);
  console.log("Scope: only DrawOpaquePass.Execute and DrawTransparentPass.Execute; all other passes are excluded.");
  console.log("Inputs: official package/native bytes only; no browser or screenshot evidence.");
}
