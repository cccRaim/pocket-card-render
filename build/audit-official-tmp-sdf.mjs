import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

const output = execFileSync(
  process.env.PYTHON || "python",
  ["build/extract_official_tmp_sdf.py"],
  {
    encoding: "utf8",
    shell: process.platform === "win32",
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
    maxBuffer: 4 * 1024 * 1024,
  },
);
const evidence = JSON.parse(output.replace(/^\uFEFF/, ""));

assert.equal(evidence.schemaVersion, 1);
assert.equal(evidence.shader.name, "Lettuce/Common/Card/TextMeshPro/Distance Field (to RT)");
assert.deepEqual(evidence.shader.platforms, [18]);
assert.deepEqual({
  bundleByteSize: evidence.source.bundleByteSize,
  bundleSha256: evidence.source.bundleSha256,
  shaderPathId: evidence.source.shaderPathId,
  shaderObjectByteSize: evidence.source.shaderObjectByteSize,
  shaderObjectSha256: evidence.source.shaderObjectSha256,
}, {
  bundleByteSize: 28556,
  bundleSha256: "5bd303380d2e26d265c1c81d8eb91a55f12d8c65415a6f1be2c163197c1fc9d2",
  shaderPathId: "-7558725283898987281",
  shaderObjectByteSize: 18304,
  shaderObjectSha256: "052c08e5bf09008a8289c65671ffa9a40be228d3f0e93709a8a5af07c591663d",
});
assert.deepEqual(evidence.shader.selectedVariant, {
  subshaderIndex: 0,
  passIndex: 0,
  metadataStage: "progVertex",
  playerGroup: 3,
  variantIndex: 0,
  programBlobIndex: 8,
  parameterBlobIndex: 0,
  gpuProgramType: 25,
  shaderRequirements: 227,
  keywordIndices: [],
});
assert.deepEqual(evidence.program.modules.map(({ stage, byteSize, sha256 }) => [stage, byteSize, sha256]), [
  ["fragment", 7124, "738b2fbd5864492ff81f6aafc16c02b8a564a08ff7858ac48e78d62127076d41"],
  ["vertex", 12324, "328d360fe02386b01be96298b84f108f7fd0fcd2870da4aaec1c1a56c020a373"],
]);
assert.deepEqual({
  compressedByteSize: evidence.program.compressedByteSize,
  compressedSha256: evidence.program.compressedSha256,
  decompressedByteSize: evidence.program.decompressedByteSize,
  decompressedSha256: evidence.program.decompressedSha256,
  entryCount: evidence.program.entryCount,
}, {
  compressedByteSize: 10322,
  compressedSha256: "f773c4aa156a8ea6cea1c840806ee8f270b61723ab8c36da79bbee6514c8b7e3",
  decompressedByteSize: 67564,
  decompressedSha256: "9fe5f5c2c89921817fd6c379ba086fb55851a74418baa69706e3e356816f32b7",
  entryCount: 16,
});
assert.deepEqual(evidence.bindings.textures.map(({ name, binding }) => [name, binding]), [
  ["_MainTex", 0],
  ["_FaceTex", 1],
  ["_OutlineTex", 2],
]);

const fields = new Map(evidence.bindings.constantBuffers.flatMap((buffer) => (
  buffer.fields.map((field) => [`${buffer.name}.${field.name}`, field.offset])
)));
assert.equal(fields.get("PGlobals3555819490._FaceColor"), 32);
assert.equal(fields.get("PGlobals3555819490._OutlineColor"), 64);
assert.equal(fields.get("PGlobals3555819490._OutlineWidth"), 80);
assert.equal(fields.get("PGlobals3555819490._ScaleRatioA"), 84);
assert.equal(fields.get("VGlobals3555819490._FaceDilate"), 288);
assert.equal(fields.get("VGlobals3555819490._WeightNormal"), 368);
assert.equal(fields.get("VGlobals3555819490._WeightBold"), 372);
assert.equal(fields.get("VGlobals3555819490._GradientScale"), 424);

console.log("Official TMP SDF Vulkan program/binding audit OK");
