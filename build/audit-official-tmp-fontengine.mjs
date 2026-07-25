import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

const output = execFileSync(
  process.env.PYTHON || "python",
  ["build/extract_official_tmp_fontengine.py"],
  {
    encoding: "utf8",
    shell: process.platform === "win32",
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
    maxBuffer: 4 * 1024 * 1024,
  },
);
const evidence = JSON.parse(output.replace(/^\uFEFF/, ""));

assert.equal(evidence.schemaVersion, 1);
assert.deepEqual({
  unityVersion: evidence.source.unityVersion,
  gameVersion: evidence.source.gameVersion,
  gameLibunityByteSize: evidence.source.gameLibunityByteSize,
  gameLibunitySha256: evidence.source.gameLibunitySha256,
  releaseLibunityByteSize: evidence.source.releaseLibunityByteSize,
  releaseLibunitySha256: evidence.source.releaseLibunitySha256,
  releaseSymbolsByteSize: evidence.source.releaseSymbolsByteSize,
  releaseSymbolsSha256: evidence.source.releaseSymbolsSha256,
}, {
  unityVersion: "2022.3.62f2",
  gameVersion: "1.6.0",
  gameLibunityByteSize: 18753592,
  gameLibunitySha256: "43a04223f94b6ca0c7cf128b399fe0656c57b5a18a10bf21bb9ce27aeb219722",
  releaseLibunityByteSize: 25197120,
  releaseLibunitySha256: "9250260245fdbe960845d785e42418890e62ca586d2566e1d4c146c294cd637a",
  releaseSymbolsByteSize: 10801824,
  releaseSymbolsSha256: "2244367020161ab6f84350dba36ef2c44e645014c056c3cd427b13e9efa05969",
});

assert.deepEqual(evidence.functions.map((entry) => ({
  id: entry.id,
  releaseRva: entry.releaseRva,
  gameRva: entry.gameRva,
  byteSize: entry.byteSize,
  anchorOffset: entry.anchorOffset,
  anchorByteSize: entry.anchorByteSize,
  exactInstructionBytes: entry.exactInstructionBytes,
  wholeFunctionExact: entry.wholeFunctionExact,
  releaseSha256: entry.releaseSha256,
  gameSha256: entry.gameSha256,
})), [
  ["setPixelSizeAndUpsampling", "0xc3dd08", "0x8d1dec", 204, 0, 28, 128, false, "3afdb6ecba106cf7e6b3fbcbebb4ec3241372c4fd019a18cbacc9f2059f6ab68", "b38cbea56e83c0090168207aa894c378e0e0dd4dbe73472bb4fa7512a761106f"],
  ["loadGlyphSlot", "0xc3ded8", "0x8d1fbc", 620, 108, 104, 512, false, "65142644525f9e9c662565c53da616c643fe1ee4c6c800da24be4ec9962117e1", "3ec816c04f2f96837c3cd61deb9323e1e2a996e93b861000f4af195e759322e5"],
  ["copyGlyphSlotToTexture", "0xc3e144", "0x8d2228", 460, 0, 460, 460, true, "732391500e1954192ba4bbe34a31f23844ddc6e6b5b4c4feb6e92730e8587b52", "732391500e1954192ba4bbe34a31f23844ddc6e6b5b4c4feb6e92730e8587b52"],
  ["generateSdf", "0xc3e310", "0x8d23f4", 576, 84, 492, 568, false, "9f0915975a773bc4049024151c5bd2763c6a55d8a5a9e8d7025b93de9841d3df", "a23b40ea686dac4fb221b6278c75864b49a4b7ab06f590fe05a6ebc68c68afb2"],
  ["generate3x3AaEdt", "0xc3e550", "0x8d2634", 548, 264, 240, 500, false, "6038fd68d4883e75586951365883a66d345520ccc699209f3004129e072a460d", "c34fd17054e41271683529a15b672b2600439dc88f9be9858a63b94143119b97"],
  ["renderGlyphToTextureJob", "0xc3eeb4", "0x8d2858", 204, 16, 112, 160, false, "ef62106d5a71035ed2776bcfd83672c577974181aa0da969e90b5aebb20fd809", "745980482703e8f51abb750383319e52327a0fde417627e5010fda5608a64090"],
  ["computeEdgeGradient", "0xc4542c", "0x8d4260", 408, 316, 92, 388, false, "a84a108265a11469e8edb708006c09c49fd56cc83deeb3d2fa9d9a121532c90b", "ccd092788c09b08c43a28515678f87edd813da670cd8b44b5715a96e5c981e6f"],
  ["approximateEdgeDelta", "0xc455c4", "0x8d43f8", 196, 0, 196, 196, true, "23d5dd3edc64aafe40508a28da0dfa2f1907ea98d7644d62ccf0186dc2da98fd", "23d5dd3edc64aafe40508a28da0dfa2f1907ea98d7644d62ccf0186dc2da98fd"],
  ["calculate3x3AaEdt", "0xc45688", "0x8d44bc", 2012, 0, 2012, 2012, true, "a5e7d0dbbc3f81a8e8a16c46a7786363eca3af156f3446ab070dfed33e30c587", "a5e7d0dbbc3f81a8e8a16c46a7786363eca3af156f3446ab070dfed33e30c587"],
].map(([id, releaseRva, gameRva, byteSize, anchorOffset, anchorByteSize, exactInstructionBytes, wholeFunctionExact, releaseSha256, gameSha256]) => ({
  id,
  releaseRva,
  gameRva,
  byteSize,
  anchorOffset,
  anchorByteSize,
  exactInstructionBytes,
  wholeFunctionExact,
  releaseSha256,
  gameSha256,
})));

assert.deepEqual(evidence.facts, {
  dynamicAtlasRenderMode: { decimal: 4165, hex: "0x1045" },
  glyphLoadFlags: 6,
  glyphSlotCopyForDynamicAtlas: "generate3x3AaEdt",
  freeTypeSdfPathForDynamicAtlas: false,
  renderJobCallsGlyphSlotCopy: true,
  distanceTransform: {
    generator: "generate3x3AaEdt",
    calculator: "calculate3x3AaEdt",
    edgeGradient: "computeEdgeGradient",
    edgeDelta: "approximateEdgeDelta",
    pixelStrideBytes: 32,
    outputCenter: 127,
    outputScaleFormula: "255 / (2 * padding + 2)",
    rounding: "add 0.5 then fcvtzs",
  },
});

console.log("Official Unity TextCore SDFAA native-chain audit OK");
console.log("  render mode 0x1045 -> FT load flags 6 -> Generate_3X3AAEDT");
console.log("  exact game bodies: Copy_FT_GlyphSlot_DataToTexture, ApproximateEdgeDelta, Calculate3x3AAEDT");
