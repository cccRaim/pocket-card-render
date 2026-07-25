import assert from "node:assert/strict";
import fs from "node:fs";
import { execFileSync } from "node:child_process";

const evidence = JSON.parse(execFileSync(
  process.env.PYTHON || "python",
  ["build/extract_official_tmp_mesh.py"],
  {
    encoding: "utf8",
    shell: process.platform === "win32",
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
    maxBuffer: 8 * 1024 * 1024,
  },
).replace(/^\uFEFF/, ""));

assert.equal(evidence.schemaVersion, 2);
assert.deepEqual({
  byteSize: evidence.source.byteSize,
  sha256: evidence.source.sha256,
  gameVersion: evidence.source.gameVersion,
  unityVersion: evidence.source.unityVersion,
}, {
  byteSize: 128218264,
  sha256: "3e78eedc62770fff4cb129b4b8d898950e131b710b3c099237fe20d2d34ca48e",
  gameVersion: "1.6.0",
  unityVersion: "2022.3.62f2",
});
assert.deepEqual(evidence.packUvConstant, {
  rva: "0x1af8e1c",
  bytes: "0080ff43",
  float32: 511,
});
assert.deepEqual(Object.fromEntries(Object.entries(evidence.methods).map(([id, method]) => [id, [
  method.startRva, method.endRva, method.byteSize, method.sha256,
]])), {
  tmpTextPackUvVector2: ["0x648ed90", "0x648ede8", 88, "b02e82390efceb7c741bb49daaffcc7c69b6a5f449957e927dadf1393e27ff68"],
  tmpTextPackUvFloat: ["0x648fe30", "0x648fe90", 96, "296035301ac250b98dee72832b080914c4b0e84c75e8f151c9ba8084b97760c5"],
  tmpTextUtilitiesPackUvVector2: ["0x65ad424", "0x65ad47c", 88, "8328e071d330a2cd74830f9fa438422513e4f7edf49be839c2257d33bc0fc501"],
});
assert.deepEqual(Object.fromEntries(Object.entries(evidence.meshBlocks).map(([id, block]) => [id, [block.byteSize, block.sha256]])), {
  uguiPackedUvWrites: [260, "d788eb24bfafbfe1c75de7b373869373a9b9865714cd17598fcf936f2306705b"],
  uguiStyleAndScaleLoads: [100, "7bbdd9683030d8048bac78fecd920948ef58d3a713a66fbe618bc1785d10890f"],
});
assert.deepEqual(evidence.methodBodies.textMeshProUguiGenerateTextMesh, {
  startRva: "0x644f2f8",
  endRva: "0x6466270",
  byteSize: 94072,
  sha256: "c3559a284da59e15e3a2311079b5693837ddfc6edbde683e05d2d88ab8b25c39",
});
assert.deepEqual({
  version: evidence.textMeshProSource.version,
  byteSize: evidence.textMeshProSource.byteSize,
  sha256: evidence.textMeshProSource.sha256,
  nativeGenerateTextMesh: evidence.textMeshProSource.nativeGenerateTextMesh.sha256,
  ranges: Object.fromEntries(Object.entries(evidence.textMeshProSource.ranges).map(([name, range]) => [name, range.sha256])),
}, {
  version: "3.0.6",
  byteSize: 247329,
  sha256: "1f8ba223bdd284bd0dfff1aefcf5988c872c9f6dd616673a8d4d58a9b2bf816a",
  nativeGenerateTextMesh: "63e11353317c008927215ccb1d6d7977a18ee8b4d3d2728ace5b5d9cf65240b8",
  ranges: {
    baseScale: "d1c7ed5b627dc1223c3b10f27a3e5f98803c593970b456cd1d93fc9db694659a",
    characterScale: "8c7bfe8b258aa4356247c9baea091b304effc54aea83d223a0ce9b7121c2cb72",
    characterQuadAndItalic: "69d80e799d7c978190607815aa2319d5f694bceeaadfbe848da100050dcb50ea",
    characterAdvance: "d332c9a7222659129d0819ac2f465a50fbd8721811cca88f0932d224efb386ac",
    packedUvScale: "f67213e6b19e9f9061cb06897ee01eadcf88977e17be8c8572947c369f1fcabe",
  },
});
assert.deepEqual(evidence.reachableCardUi, {
  contractSha256: "26783bf6ef2d82f6057c677f42dc65288f29e6a6b6423eb41a4587ec1e9c0a6b",
  tmpComponentCount: 68,
  fontStyle: { 0: 59, 2: 9 },
  fontWeight: { 400: 68 },
  orthographic: { 1: 68 },
  rightToLeft: { 0: 68 },
  extraPadding: { 0: 68 },
  geometrySortingOrder: { 0: 68 },
});

const vectorOps = evidence.methods.tmpTextPackUvVector2.instructions.map((entry) => `${entry.mnemonic} ${entry.operands}`);
assert(vectorOps.includes("fmul s0, s0, s3"));
assert(vectorOps.includes("fmul s1, s1, s3"));
assert(vectorOps.includes("fcvtzs s3, s0"));
assert(vectorOps.includes("fmul s1, s3, s7"));
assert(vectorOps.includes("fmov s1, s2"));
const meshOps = evidence.meshBlocks.uguiPackedUvWrites.instructions;
assert.equal(meshOps.filter((entry) => entry.mnemonic === "bl" && entry.operands === "#0x648fe30").length, 4);
const fieldOps = evidence.meshBlocks.uguiStyleAndScaleLoads.instructions.map((entry) => `${entry.mnemonic} ${entry.operands}`);
assert(fieldOps.includes("ldrb w10, [x10, #0x170]"));
assert(fieldOps.includes("ldr s7, [x8, #0x140]"));

const renderer = fs.readFileSync("public/render/tmp-sdf-renderer.js", "utf8");
assert.match(renderer, /Math\.trunc\(Number\(x\) \* 511\) \* 4096 \+ Math\.trunc\(Number\(y\) \* 511\)/);
assert.match(renderer, /packOfficialTmpUv\(0, 0\), entry\.sdfScale/);
assert.match(renderer, /buildOfficialTmpGlyphQuad\(entry, padding/);
assert.match(renderer, /blendSrc:\s*THREE\.OneFactor/);
assert.match(renderer, /blendDst:\s*THREE\.OneMinusSrcAlphaFactor/);

console.log("Official TMP mesh packing audit OK");
console.log("  TextMeshProUGUI.GenerateTextMesh full ARM64 method body is byte-pinned");
console.log("  PackUV Vector2/float and TextMeshProUGUI four-corner writes are byte-pinned");
console.log("  character style/scale fields and One/OneMinusSrcAlpha blend are wired");
