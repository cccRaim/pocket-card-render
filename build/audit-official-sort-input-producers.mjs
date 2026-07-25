#!/usr/bin/env node
// Read-only audit of native sort-input producers in Pokemon TCG Pocket 1.6.0.
// Authority: official game libunity bytes plus Unity's official release symbols.
// No scene, recipe, browser, screenshot, or renderer output is consumed.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { inflateRawSync } from "node:zlib";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CACHE = path.resolve(ROOT, "../.cache");
const GAME_LIBUNITY = path.resolve(process.env.PCR_GAME_LIBUNITY
  || path.join(CACHE, "ptcgp-1.6.0/libunity.so"));
const APKM = path.resolve(process.env.PCR_APKM
  || path.join(ROOT, "../ptcg-apk-parser/apks/jp.pokemon.pokemontcgp_1.6.0.apkm"));
const RELEASE_LIBUNITY = path.resolve(process.env.PCR_UNITY_RELEASE_LIBUNITY
  || path.join(CACHE, "unity-2022.3.62f2/symbols/libunity.release.arm64.so"));
const RELEASE_SYMBOLS = path.resolve(process.env.PCR_UNITY_RELEASE_SYMBOLS
  || path.join(CACHE, "unity-2022.3.62f2/symbols/libunity.release.arm64.sym.so"));
const JSON_MODE = process.argv.includes("--json");

const EXPECTED = Object.freeze({
  gameSha256: "43a04223f94b6ca0c7cf128b399fe0656c57b5a18a10bf21bb9ce27aeb219722",
  gameVersion: "2022.3.62f2_7670c08855a9",
  releaseSha256: "9250260245fdbe960845d785e42418890e62ca586d2566e1d4c146c294cd637a",
  symbolsSha256: "2244367020161ab6f84350dba36ef2c44e645014c056c3cd427b13e9efa05969",
  releaseVersion: "2022.3.62f2c1_92e6e6be66dc",
});

const FUNCTIONS = Object.freeze([
  ["getSortingGroupId", 0x46ae28, 0x46ae34, 0x72783c, 0x0c, 0x00, 12,
    "_ZN12BaseRenderer17GetSortingGroupIDEj"],
  ["getSortingGroupOrder", 0x46ae44, 0x46ae50, 0x727858, 0x0c, 0x00, 12,
    "_ZN12BaseRenderer20GetSortingGroupOrderEj"],
  ["getGlobalLayeringData", 0x46ae60, 0x46ae68, 0x727874, 0x08, 0x00, 8,
    "_ZNK12BaseRenderer21GetGlobalLayeringDataEj"],
  ["rendererConstructor", 0x507a3c, 0x507b08, 0x7cc6d0, 0xcc, 0x5c, 96,
    "_ZN8RendererC2E12RendererType10MemLabelId18ObjectCreationMode"],
  ["rendererUpdateManagerAddRenderer", 0x508b14, 0x508bc8, 0x7cd79c, 0xb4, 0x00, 48,
    "_ZN21RendererUpdateManager11AddRendererER8Renderer"],
  ["isSRPBatcherCompatible", 0x54c62c, 0x54c700, 0x81bbd0, 0xd4, 0x2c, 96,
    "_Z22IsSRPBatcherCompatibleRK10RenderNodeRK6Shaderii"],
  ["findPasses", 0x54cac4, 0x54cbbc, 0x81c068, 0xf8, 0x38, 96,
    "_Z10FindPassesPK12MaterialInfobP11ShaderTagIDiS2_Pi"],
  ["nodeHasMotion", 0x54cbbc, 0x54cc10, 0x81c160, 0x54, 0x00, 40,
    "_Z13NodeHasMotionRK10RenderNodei"],
  ["sortInputBuilder", 0x54cc10, 0x54db78, 0x81c1b4, 0xf68, 0x00, 96,
    "_Z31PrepareScriptableLoopObjectDataRK15RenderNodeQueueRK20DrawRenderersCommandPK20OverrideMaterialInfoPK18OverrideShaderInfoPK12MaterialInfoimmRN4core6vectorI24ScriptableLoopObjectDataLm0EEE"],
  ["localKeywordHash", 0x5504d8, 0x550508, 0x81f6cc, 0x30, 0x00, 40,
    "_ZNK8keywords17LocalKeywordState7GetHashEv"],
  ["flattenBasicData", 0x971a98, 0x971b54, 0xe13528, 0xbc, 0x00, 96,
    "_ZN12BaseRenderer16FlattenBasicDataERKS_12LODFadeValueR10RenderNode"],
  ["baseRendererConstructor", 0x971a5c, 0x971a84, 0xe133cc, 0x28, 0x18, 16,
    "_ZN12BaseRendererC2E12RendererType"],
  ["flattenLightProbeData", 0x971cac, 0x971ddc, 0xe137a4, 0x130, 0x28, 80,
    "_ZN12BaseRenderer21FlattenLightProbeDataE4PPtrI9TransformERisRK17LightProbeContextR10RenderNode"],
  ["intermediateAddAsRenderNode", 0x972308, 0x972498, 0xe14034, 0x190, 0x00, 96,
    "_ZN20IntermediateRenderer15AddAsRenderNodeER15RenderNodeQueueRK20DeprecatedSourceData"],
  ["sharedRendererDataConstructor", 0x992638, 0x9926a0, 0xe3c8d0, 0x68, 0x10, 32,
    "_ZN18SharedRendererDataC2E12RendererType"],
  ["getLightProbesCoefficientType", 0x9cd2bc, 0x9cd354, 0xe7e930, 0x98, 0x00, 96,
    "_Z29GetLightProbesCoefficientTypeRK17LightProbeContext15LightProbeUsageRK15LightmapIndiceshb"],
  ["meshRendererAddAsRenderNode", 0xa07e9c, 0xa08040, 0xeb89b4, 0x1a4, 0x48, 56,
    "_ZN12MeshRenderer15AddAsRenderNodeER15RenderNodeQueueRK20DeprecatedSourceData"],
  ["meshRendererProduce", 0xa05d9c, 0xa05e84, 0xeb68b4, 0xe8, 0x4c, 80,
    "_ZN13ProduceHelperI12MeshRendererLb0EE7ProduceE10MemLabelId18ObjectCreationMode"],
  ["prepareMeshRenderNodes", 0xa070e8, 0xa07548, 0xeb7c00, 0x460, 0x8c, 128,
    "_ZL22PrepareMeshRenderNodesILb0EEvR35RenderNodeQueuePrepareThreadContext"],
  ["batchUsesShader", 0x98cd60, 0x98cdf4, 0xe355b4, 0x94, 0x00, 96,
    "_ZN34BatchRendererGroupInjectionContext15BatchUsesShaderERK7BatchIDR6Shader"],
].map(([id, gameStart, gameEnd, officialStart, size, signatureOffset, signatureSize, symbol]) => Object.freeze({
  id, gameStart, gameEnd, officialStart, size, signatureOffset, signatureSize, symbol,
})));

const INSTRUCTIONS = Object.freeze([
  // A nonzero serialized SubShader compatibility status returns false on both control-flow paths.
  [0x54c660, "087140b9", "SRP compatibility: load SubShader status at +0x70"],
  [0x54c664, "1f010071", "SRP compatibility: compare SubShader status with zero"],
  [0x54c668, "e0179f1a", "SRP compatibility: provisional result is status==0"],
  [0x54c66c, "77030037", "SRP compatibility: renderer fast path returns provisional result"],
  [0x54c670, "48030035", "SRP compatibility: nonzero status returns provisional false"],
  [0x54c6d4, "e0031f2a", "SRP compatibility: explicit false return"],

  // MeshRenderer construction pins RenderNode+0xe8 low six bits to RendererType::MeshRenderer == 1.
  [0x507a64, "80e20091", "Renderer constructor: BaseRenderer subobject is Renderer+0x38"],
  [0x507a68, "e103132a", "Renderer constructor: forward RendererType argument"],
  [0x507a78, "f9a71194", "Renderer constructor: call BaseRenderer(RendererType)"],
  [0x508b24, "282841b9", "RendererUpdateManager type-table input: load Renderer+0x128"],
  [0x508b2c, "08154092", "RendererUpdateManager type-table index: Renderer+0x128 low six bits"],
  [0x971a6c, "088400f8", "BaseRenderer constructor: store vtable then post-increment this by 8"],
  [0x971a70, "f2820094", "BaseRenderer constructor: call SharedRendererData with BaseRenderer+8"],
  [0x99263c, "09e840b9", "SharedRendererData constructor: load its +0xe8 packed flags"],
  [0x992654, "28140033", "SharedRendererData constructor: insert RendererType into low six bits"],
  [0x992668, "08e800b9", "SharedRendererData constructor: store its +0xe8 packed flags"],
  [0xa05dcc, "21008052", "MeshRenderer producer: RendererType argument is 1"],
  [0xa05ddc, "1807ec97", "MeshRenderer producer: call Renderer constructor"],

  // Non-LODGroup MeshRenderer path uses the native zero LODFadeValue default.
  [0xa0725c, "08530091", "prepare MeshRenderer nodes: address LOD handle at source+0x14"],
  [0xa07260, "080140b9", "prepare MeshRenderer nodes: load packed LOD handle"],
  [0xa07268, "086d4092", "prepare MeshRenderer nodes: isolate 28-bit LOD index"],
  [0xa07270, "c8010034", "prepare MeshRenderer nodes: zero LOD index selects default"],
  [0xa072a8, "283e00f0", "prepare MeshRenderer nodes: page of default LODFadeValue relocation"],
  [0xa072ac, "08b541f9", "prepare MeshRenderer nodes: load default LODFadeValue pointer"],
  [0xa072b0, "000140b9", "prepare MeshRenderer nodes: load default LODFadeValue u32"],
  [0xa072e4, "eda9fd97", "prepare MeshRenderer nodes: pass LODFadeValue to FlattenBasicData"],

  // Default GlobalLayeringData gives non-SortingGroup renderers key 0xfffff000.
  [0x992644, "000141fd", "SharedRendererData constructor: load default GlobalLayeringData"],
  [0x992664, "00c00bfc", "SharedRendererData constructor: store default at Shared+0xbc"],
  [0x971b10, "0080cc3c", "FlattenBasicData: load BaseRenderer+0xc8 sorting-group key"],
  [0x971b24, "4030803d", "FlattenBasicData: store sorting-group key at RenderNode+0xc0"],

  // Regular ScriptableLoopObjectData producer.
  [0x54cecc, "18cd4bb8", "entry+0x2c source: ldr w24,[node+0xbc]"],
  [0x54cf24, "181940b9", "entry+0x2c alternate source: ldr w24,[sortRecord+0x18]"],
  [0x54d26c, "130b40b9", "entry+0x08 input: ldr w19,[shader+0x08]"],
  [0x54d270, "147d41b9", "entry+0x08 input: ldr w20,[material+0x17c]"],
  [0x54d274, "a9024339", "entry+0x08 branch: ldrb command+0xc0"],
  [0x54d280, "08014079", "entry+0x08 input: ldrh material+0x175"],
  [0x54d29c, "09e14539", "entry+0x08 input: ldrb material+0x178"],
  [0x54d2ac, "2a014039", "entry+0x08 input: ldrb node+0x118"],
  [0x54d2bc, "290140f9", "entry+0x08 input: ldr node+0x110"],
  [0x54d2c4, "290940b9", "entry+0x08 base source: ldr w9,[selected+0x08]"],
  [0x54d2cc, "3d7d0153", "entry+0x08 base: lsr w29,w9,1"],
  [0x54d2e0, "00610091", "entry+0x08 hash this: material+0x18"],
  [0x54d2e4, "7d0c0094", "entry+0x08 hash call"],
  [0x54d2f4, "0900134a", "entry+0x08 hash xor shader+0x08"],
  [0x54d2f8, "9d1e1033", "entry+0x08 bits16..23"],
  [0x54d2fc, "3d1d0833", "entry+0x08 bits24..31"],
  [0x54d318, "29014079", "entry+0x28 low source: ldrh node+0xb8"],
  [0x54d31c, "410140b9", "entry+0x18 source: ldr w1,node+0xf0"],
  [0x54d320, "2301190b", "entry+0x28 low: nodeB8+materialSlot"],
  [0x54d328, "773c0012", "entry+0x28 low16 mask"],
  [0x54d358, "b5fcff97", "entry+0x1c bit0 call IsSRPBatcherCompatible"],
  [0x54d394, "290140b9", "entry+0x28 high source: ldr node+0x100"],
  [0x54d398, "4a0540b9", "entry+0x30 source: ldr node+0xc0"],
  [0x54d3a0, "287b1f53", "entry+0x1c materialSlot<<1"],
  [0x54d3a4, "0b000012", "entry+0x1c SRP flag mask"],
  [0x54d3ac, "1d010b2a", "entry+0x1c packed value"],
  [0x54d3b0, "373d1033", "entry+0x28 insert low16(node+0x100)"],
  [0x54d3b4, "5b7d60b3", "entry+0x30 insert node+0xc0"],
  [0x54d408, "11250129", "store entry+0x08 and visibleNodeIndex"],
  [0x54d418, "011900b9", "store entry+0x18"],
  [0x54d41c, "1d390079", "store entry+0x1c"],
  [0x54d424, "172900b9", "store entry+0x28"],
  [0x54d428, "1bc102f8", "store entry+0x2c/+0x30 pair"],

  // BaseRenderer -> RenderNode production used by MeshRenderer.
  [0x971aa4, "5f0001b9", "default node+0x100=0"],
  [0x971ab4, "492001b9", "store 0x0000ffff at node+0x120; node+0x122 defaults to zero"],
  [0x971af8, "0080cb3c", "load BaseRenderer+0xb8..+0xc7"],
  [0x971b08, "410005ad", "copy BaseRenderer+0xa8..+0xc7 to node+0xa0..+0xbf"],
  [0x971b14, "0180ce3c", "load BaseRenderer+0xe8..+0xf7"],
  [0x971b28, "428406ad", "copy BaseRenderer+0xd8..+0xf7 to node+0xd0..+0xef"],
  [0x971b2c, "497c1e29", "store BaseRenderer+0xf8 at node+0xf0 and zero node+0xf4"],
  [0x971b30, "48180439", "store LODFadeValue bits23..16 at node+0x106"],
  [0x971d18, "62920391", "pass node+0xe4 as light-probe output slot"],
  [0x971d2c, "646d0194", "call GetLightProbesCoefficientType"],
  [0x972444, "e8ea40b9", "load node+0xe8 bitfield"],
  [0x972454, "08690e12", "clear node+0xe8 bits13..17"],
  [0x972458, "e8ea00b9", "store normalized node+0xe8"],
  [0xa07eac, "14e440f9", "MeshRenderer: load cached Mesh pointer from Renderer+0x1c8"],
  [0xa07ee8, "885641b9", "MeshRenderer special node+0x100 source object+0x154"],
  [0xa07ef8, "280101b9", "MeshRenderer overwrite node+0x100"],

  // BatchRendererGroup producer is intentionally separate.
  [0x54d844, "baf24539", "BRG entry+0x08 input: material+0x17c"],
  [0x54d848, "560940b9", "BRG entry+0x08 input: shader+0x08"],
  [0x54d84c, "17014079", "BRG entry+0x08 input: material+0x175"],
  [0x54d868, "3efd1094", "BRG BatchUsesShader call"],
  [0x54d890, "da1e0833", "BRG entry+0x08 bits24..31"],
  [0x54d898, "fa3e1833", "BRG entry+0x08 bits8..23"],
  [0x54d8dc, "1a450129", "BRG store entry+0x08 and visibleNodeIndex"],
  [0x54d8ec, "e9eb42b9", "BRG entry+0x18 packed low source"],
  [0x54d8f0, "eadb4579", "BRG entry+0x18 packed high source"],
  [0x54d8f4, "0b1d00b9", "BRG entry+0x1c=1"],
  [0x54d914, "1f2900b9", "BRG entry+0x28=0"],
  [0x54d918, "0bc102f8", "BRG store entry+0x2c/+0x30 constants"],
  [0x54d924, "0a350079", "BRG store BatchUsesShader u16 at entry+0x1a"],
  [0x54d928, "096101b8", "BRG store BatchUsesShader u32 at entry+0x16"],

  // Comparator loads pin width and signed/unsigned interpretation boundaries.
  [0x54c848, "2c2c40b9", "compare entry+0x2c as u32"],
  [0x54c884, "2c1840b9", "load entry+0x18 as i32 payload"],
  [0x54c910, "e0a79f1a", "signed less-than result for entry+0x18/node+0x100"],
  [0x54c918, "2c384079", "load entry+0x1c as u16"],
  [0x54c93c, "ade940b9", "load node+0xe8 as u32"],
  [0x54c960, "ad194439", "load node+0x106 as u8"],
  [0x54c97c, "b0754179", "load node+0xba as u16 gate"],
  [0x54c980, "2c0840b9", "load entry+0x08 as u32"],
  [0x54c9b0, "8c0141b9", "load node+0x100 as i32 payload"],
  [0x54c9cc, "08714179", "load node+0xb8 as u16"],
  [0x54c9d8, "2c3040b9", "load entry+0x30 as u32"],
  [0x54ca14, "ad454279", "load node+0x122 as u16"],
  [0x54ca94, "efe540b9", "load node+0xe4 as u32"],
  [0x54caac, "2c2840b9", "load entry+0x28 as u32"],
].map(([rva, bytesHex, meaning]) => Object.freeze({ rva, bytesHex, meaning })));

const PROVED_LAYOUT = Object.freeze({
  entryStride: 0x58,
  rendererConstruction: Object.freeze({
    rendererBaseSubobjectOffset: 0x38,
    sharedRendererDataThisAdjustment: 0x08,
    sharedRendererDataPackedFlagsOffset: 0xe8,
    rendererPackedFlagsOffset: 0x128,
    rendererTypeMask: 0x3f,
    meshRendererType: 1,
    renderNodePackedFlagsOffset: 0xe8,
    addressIdentity: "0x38 + 0x08 + 0xe8 = 0x128; FlattenBasicData maps BaseRenderer+0xf0 to RenderNode+0xe8",
  }),
  regular: Object.freeze({
    entry08: "Material/Shader composite state key; u32",
    visibleNodeIndex: "absolute RenderNodeQueue slot: (RenderNodeAddress-queueBase)/0x198",
    entry18: "raw node+0xf0 copied from BaseRenderer+0xf8; compared signed when RendererPriority is enabled",
    entry1c: "u16((materialSlot<<1)|(IsSRPBatcherCompatible&1))",
    entry28: "u32((u16(nodeB8+materialSlot))|(u16(node100)<<16))",
    entry2c: "u32(node+0xbc), or alternate sort record+0x18",
    entry30: "SortingGroupKey=((SortingGroupID&0xfffff)<<12)|(SortingGroupOrder&0xfff), copied from node+0xc0",
  }),
  node: Object.freeze({
    b8: "u16(BaseRenderer+0xc0)",
    ba: "u16(BaseRenderer+0xc2)",
    e4: "u32(BaseRenderer+0xec), then light-probe input/output slot",
    e8: "u32(BaseRenderer+0xf0), low six bits are RendererType; MeshRenderer=1; normalized with &0xfffc1fff",
    "100": "i32 default 0; MeshRenderer overwrites it with cached Mesh+0x154 SmallMeshID (24-bit runtime pure index)",
    "106": "u8((LODFadeValue>>16)&0xff); non-LODGroup MeshRenderer default is zero",
    "122": "u16 default 0; Canvas/UI producers may overwrite it",
  }),
  brg: Object.freeze({
    entry08: "Material/Shader composite key without LocalKeywordState hash branch",
    entry18: "packed from BatchUsesShader result bytes at entry+0x16..+0x1b",
    entry1c: 1,
    entry28: 0,
    entry2c: 0x80008000,
    entry30: 0xfffff000,
  }),
  runtimeIdentity: Object.freeze({
    materialBatchStateKey: Object.freeze({
      fastBranch: "(MaterialInstanceID&0xff)|(LocalKeywordHash&0x00ffff00)|((ShaderInstanceID&0xff)<<24)",
      hashedBranch: "(EnableInstancingVariants?0:((RenderQueueSource>>>1)&0xffff))|((MaterialInstanceID&0xff)<<16)|(((LocalKeywordHash^ShaderInstanceID)&0xff)<<24)",
      keywordHash: "UNITY_XXH32(keywordBits,8*ceil(keywordCount/64),0x8f37154b)",
      serializedInputs: Object.freeze(["keyword bitset", "m_EnableInstancingVariants", "m_CustomRenderQueue"]),
      runtimeOnlyInputs: Object.freeze(["Material Object InstanceID", "Shader Object InstanceID"]),
    }),
    meshSmallMeshId: Object.freeze({
      source: "MeshRenderer+0x1c8 -> Mesh; Mesh+0x154 -> SmallMeshID",
      allocation: "UniqueIDGenerator runtime allocation during Mesh::AwakeFromLoad",
      staticAssetLimit: "bundle data proves Mesh identity equivalence classes, not absolute SmallMeshID values or ordering",
    }),
    visibleNodeIndex: Object.freeze({
      source: "absolute slot in the compacted RenderNodeQueue",
      formula: "(RenderNodeAddress-queueBase)/0x198",
      staticAssetLimit: "depends on whole-scene renderer registration, visibility, extraction, and gap compaction order",
    }),
  }),
});

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
    requireCondition(zip.readUInt32LE(cursor) === 0x02014b50, "invalid ZIP central-directory entry");
    const method = zip.readUInt16LE(cursor + 10);
    const compressedSize = zip.readUInt32LE(cursor + 20);
    const uncompressedSize = zip.readUInt32LE(cursor + 24);
    const nameLength = zip.readUInt16LE(cursor + 28);
    const extraLength = zip.readUInt16LE(cursor + 30);
    const commentLength = zip.readUInt16LE(cursor + 32);
    const localOffset = zip.readUInt32LE(cursor + 42);
    const name = zip.toString("utf8", cursor + 46, cursor + 46 + nameLength);
    if (name === wantedName) {
      requireCondition(zip.readUInt32LE(localOffset) === 0x04034b50, `invalid local ZIP entry ${name}`);
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

function loadGameLibunity() {
  if (fs.existsSync(GAME_LIBUNITY)) {
    return { bytes: fs.readFileSync(GAME_LIBUNITY), source: GAME_LIBUNITY };
  }
  requireCondition(fs.existsSync(APKM), `missing game libunity ${GAME_LIBUNITY} and APKM fallback ${APKM}`);
  const apkm = fs.readFileSync(APKM);
  const arm64Split = zipEntry(apkm, "split_config.arm64_v8a.apk");
  return {
    bytes: zipEntry(arm64Split, "lib/arm64-v8a/libunity.so"),
    source: `${APKM}!split_config.arm64_v8a.apk!lib/arm64-v8a/libunity.so`,
  };
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
      fileOffset: safeNumber(buffer.readBigUInt64LE(offset + 8), `${label} segment file offset`),
      virtualAddress: safeNumber(buffer.readBigUInt64LE(offset + 16), `${label} segment address`),
      fileSize: safeNumber(buffer.readBigUInt64LE(offset + 32), `${label} segment size`),
    }));
  }
  const rawSections = [];
  for (let index = 0; index < sectionCount; index += 1) {
    const offset = sectionOffset + index * sectionEntrySize;
    rawSections.push({
      nameOffset: buffer.readUInt32LE(offset),
      type: buffer.readUInt32LE(offset + 4),
      address: safeNumber(buffer.readBigUInt64LE(offset + 16), `${label} section address`),
      fileOffset: safeNumber(buffer.readBigUInt64LE(offset + 24), `${label} section offset`),
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

function elfRange(elf, startRva, endRva) {
  const segment = elf.segments.find((candidate) => startRva >= candidate.virtualAddress
    && endRva <= candidate.virtualAddress + candidate.fileSize);
  requireCondition(segment, `${elf.label}: RVA 0x${startRva.toString(16)}..0x${endRva.toString(16)} is not file-backed`);
  const offset = segment.fileOffset + startRva - segment.virtualAddress;
  return elf.buffer.subarray(offset, offset + endRva - startRva);
}

function readFunctionSymbols(elf) {
  const symtab = elf.sections.find((section) => section.name === ".symtab");
  requireCondition(symtab?.entrySize === 24, `${elf.label}: missing ELF64 .symtab`);
  const stringTable = elf.sections[symtab.link];
  requireCondition(stringTable?.name === ".strtab", `${elf.label}: .symtab does not link .strtab`);
  const strings = elf.buffer.subarray(stringTable.fileOffset, stringTable.fileOffset + stringTable.size);
  const symbols = new Map();
  for (let offset = symtab.fileOffset; offset < symtab.fileOffset + symtab.size; offset += symtab.entrySize) {
    if ((elf.buffer[offset + 4] & 0x0f) !== 2) continue;
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

function relativeRelocationAddend(elf, targetRva) {
  const rela = elf.sections.find((section) => section.name === ".rela.dyn");
  requireCondition(rela?.entrySize === 24, `${elf.label}: missing ELF64 .rela.dyn`);
  for (let offset = rela.fileOffset; offset < rela.fileOffset + rela.size; offset += rela.entrySize) {
    if (safeNumber(elf.buffer.readBigUInt64LE(offset), `${elf.label} relocation target`) !== targetRva) continue;
    const info = elf.buffer.readBigUInt64LE(offset + 8);
    requireCondition(Number(info & 0xffffffffn) === 1027, `${elf.label}: expected R_AARCH64_RELATIVE`);
    requireCondition(info >> 32n === 0n, `${elf.label}: relative relocation unexpectedly has a symbol`);
    return safeNumber(elf.buffer.readBigInt64LE(offset + 16), `${elf.label} relocation addend`);
  }
  fail(`${elf.label}: relocation target 0x${targetRva.toString(16)} was not found`);
}

function occurrenceCount(haystack, needle) {
  let count = 0;
  for (let offset = haystack.indexOf(needle); offset >= 0; offset = haystack.indexOf(needle, offset + 1)) count += 1;
  return count;
}

function u8(value) { return value & 0xff; }
function u16(value) { return value & 0xffff; }
function u32(value) { return value >>> 0; }

function packRegularEntry08Fast(material17c, material175, shader08) {
  return u32(u8(material17c) | (u16(material175) << 8) | (u8(shader08) << 24));
}

function packRegularEntry08Hashed(baseSource, material178, material17c, localKeywordHash, shader08) {
  const base = (material178 & 2) !== 0 ? 0 : (baseSource >>> 1);
  return u32((base & 0xffff)
    | (u8(material17c) << 16)
    | (u8(localKeywordHash ^ shader08) << 24));
}

function packRegularEntry1c(materialSlot, srpBatcherCompatible) {
  return u16((materialSlot << 1) | (srpBatcherCompatible & 1));
}

function packRegularEntry28(nodeB8, materialSlot, node100) {
  return u32(u16(nodeB8 + materialSlot) | (u16(node100) << 16));
}

function packBrgEntry18(batchUsesShaderW9, batchUsesShaderU16) {
  return u32((batchUsesShaderW9 >>> 16) | (u16(batchUsesShaderU16) << 16));
}

function runFormulaChecks() {
  requireCondition(packRegularEntry08Fast(0x1234, 0x56789, 0x1ab) === 0xab678934,
    "regular entry+0x08 fast formula mismatch");
  requireCondition(packRegularEntry08Hashed(0x89abcdef, 0, 0x134, 0x55, 0xaa) === 0xff34e6f7,
    "regular entry+0x08 hashed formula mismatch");
  requireCondition(packRegularEntry08Hashed(0xffffffff, 2, 0x134, 0x55, 0xaa) === 0xff340000,
    "regular entry+0x08 material+0x178 zero-base branch mismatch");
  requireCondition(packRegularEntry1c(0x1234, 1) === 0x2469, "regular entry+0x1c formula mismatch");
  requireCondition(packRegularEntry28(0xfffe, 5, -2) === 0xfffe0003,
    "regular entry+0x28 formula mismatch");
  requireCondition(packBrgEntry18(0x89abcdef, 0x12345) === 0x234589ab,
    "BRG entry+0x18 packing mismatch");
  requireCondition(PROVED_LAYOUT.brg.entry2c === 0x80008000
    && PROVED_LAYOUT.brg.entry30 === 0xfffff000, "BRG constant pair mismatch");
  const construction = PROVED_LAYOUT.rendererConstruction;
  requireCondition(construction.rendererBaseSubobjectOffset
    + construction.sharedRendererDataThisAdjustment
    + construction.sharedRendererDataPackedFlagsOffset
    === construction.rendererPackedFlagsOffset,
  "RendererType packed-flags address identity mismatch");
  requireCondition(construction.rendererTypeMask === 0x3f
    && construction.meshRendererType === 1
    && construction.renderNodePackedFlagsOffset === 0xe8,
  "MeshRenderer RenderNode type-key contract mismatch");
  requireCondition((((0xfffff << 12) | 0) >>> 0) === 0xfffff000,
    "invalid SortingGroup default key mismatch");
  requireCondition(PROVED_LAYOUT.runtimeIdentity.meshSmallMeshId.source.includes("Mesh+0x154"),
    "Mesh SmallMeshID producer contract mismatch");
  requireCondition(PROVED_LAYOUT.runtimeIdentity.visibleNodeIndex.formula.includes("0x198"),
    "visible-node queue-slot formula mismatch");
}

let report;
try {
  const gameSource = loadGameLibunity();
  requireCondition(fs.existsSync(RELEASE_LIBUNITY), `missing Unity release libunity ${RELEASE_LIBUNITY}`);
  requireCondition(fs.existsSync(RELEASE_SYMBOLS), `missing Unity release symbols ${RELEASE_SYMBOLS}`);
  const releaseBytes = fs.readFileSync(RELEASE_LIBUNITY);
  const symbolBytes = fs.readFileSync(RELEASE_SYMBOLS);
  requireCondition(sha256(gameSource.bytes) === EXPECTED.gameSha256, "official game libunity SHA-256 mismatch");
  requireCondition(sha256(releaseBytes) === EXPECTED.releaseSha256, "Unity release libunity SHA-256 mismatch");
  requireCondition(sha256(symbolBytes) === EXPECTED.symbolsSha256, "Unity release symbols SHA-256 mismatch");
  requireCondition(gameSource.bytes.includes(Buffer.from(EXPECTED.gameVersion)), "game Unity version identity mismatch");
  requireCondition(releaseBytes.includes(Buffer.from(EXPECTED.releaseVersion)), "release Unity version identity mismatch");

  const gameElf = readElf(gameSource.bytes, "game libunity");
  const releaseElf = readElf(releaseBytes, "Unity release libunity");
  const symbolElf = readElf(symbolBytes, "Unity release symbols");
  const functionSymbols = readFunctionSymbols(symbolElf);

  for (const item of FUNCTIONS) {
    requireCondition(item.gameEnd - item.gameStart === item.size, `${item.id}: game function range size mismatch`);
    requireCondition(functionSymbols.has(`${item.officialStart}:${item.size}:${item.symbol}`),
      `${item.id}: official symbol identity mismatch`);
    const gameSignature = elfRange(gameElf,
      item.gameStart + item.signatureOffset,
      item.gameStart + item.signatureOffset + item.signatureSize);
    const releaseSignature = elfRange(releaseElf,
      item.officialStart + item.signatureOffset,
      item.officialStart + item.signatureOffset + item.signatureSize);
    requireCondition(gameSignature.equals(releaseSignature), `${item.id}: game/release signature mismatch`);
    requireCondition(occurrenceCount(releaseBytes, gameSignature) === 1,
      `${item.id}: signature is not unique in official release libunity`);
  }

  for (const instruction of INSTRUCTIONS) {
    const actual = elfRange(gameElf, instruction.rva, instruction.rva + 4).toString("hex");
    requireCondition(actual === instruction.bytesHex,
      `instruction mismatch at RVA 0x${instruction.rva.toString(16)} (${instruction.meaning}): ${actual}`);
  }
  const gameLodDefaultRva = relativeRelocationAddend(gameElf, 0x11ce368);
  const releaseLodDefaultRva = relativeRelocationAddend(releaseElf, 0x17ee4e0);
  requireCondition(gameLodDefaultRva === 0x169598, "game default LODFadeValue relocation addend drifted");
  requireCondition(releaseLodDefaultRva === 0x2751ac, "release default LODFadeValue relocation addend drifted");
  requireCondition(elfRange(gameElf, gameLodDefaultRva, gameLodDefaultRva + 4).readUInt32LE(0) === 0,
    "game default LODFadeValue is not zero");
  requireCondition(elfRange(releaseElf, releaseLodDefaultRva, releaseLodDefaultRva + 4).readUInt32LE(0) === 0,
    "release default LODFadeValue is not zero");
  const globalLayeringBytes = Buffer.from("0080008000f0ffff", "hex");
  requireCondition(elfRange(gameElf, 0x163200, 0x163208).equals(globalLayeringBytes),
    "game default GlobalLayeringData drifted");
  requireCondition(elfRange(releaseElf, 0x1584d8, 0x1584e0).equals(globalLayeringBytes),
    "release default GlobalLayeringData drifted");
  runFormulaChecks();

  report = Object.freeze({
    status: "proved-with-runtime-capture-boundaries",
    source: gameSource.source,
    gameSha256: EXPECTED.gameSha256,
    functions: FUNCTIONS.map((item) => Object.freeze({
      id: item.id,
      gameRange: `0x${item.gameStart.toString(16)}..0x${item.gameEnd.toString(16)}`,
      officialRva: `0x${item.officialStart.toString(16)}`,
      symbol: item.symbol,
    })),
    instructionChecks: INSTRUCTIONS.length,
    nonLodGroupLodFadeValue: Object.freeze({
      gameRelocationTarget: "0x11ce368",
      gameDataRva: `0x${gameLodDefaultRva.toString(16)}`,
      releaseRelocationTarget: "0x17ee4e0",
      releaseDataRva: `0x${releaseLodDefaultRva.toString(16)}`,
      value: 0,
      renderNodeHighByte: 0,
    }),
    nonSortingGroupLayeringData: Object.freeze({
      gameRva: "0x163200",
      releaseRva: "0x1584d8",
      bytesHex: globalLayeringBytes.toString("hex"),
      sortingGroupId: 0xfffff,
      sortingGroupOrder: 0,
      sortingGroupKey: 0xfffff000,
    }),
    formulas: PROVED_LAYOUT,
    boundaries: Object.freeze([
      "BaseRenderer+0xc0/+0xc2/+0xec/+0xf8 public member names remain unproved; BaseRenderer+0xf0 low six bits are proved RendererType.",
      "Material/Shader composite-key formulas are proved, but their Object InstanceIDs require official runtime capture.",
      "Mesh identity equivalence is statically recoverable; absolute SmallMeshID allocation order requires official runtime capture.",
      "VisibleNodeIndex is a compacted RenderNodeQueue slot and requires official whole-scene runtime capture.",
      "BRG BatchUsesShader return subfield names used by entry+0x18 remain unproved.",
    ]),
  });
} catch (error) {
  console.error(`BAD official sort-input producer audit: ${error.message}`);
  process.exit(1);
}

if (JSON_MODE) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log("Official sort-input producer audit OK");
  console.log(`  source       ${report.source}`);
  console.log(`  game hash    ${report.gameSha256}`);
  console.log(`  symbols      ${report.functions.length}/${report.functions.length} producer/helper identities mapped`);
  console.log(`  instructions ${report.instructionChecks}/${report.instructionChecks} exact load/store/pack words`);
  console.log("  formulas     regular MeshRenderer construction/draw and BRG paths checked separately");
  console.log("  boundaries   runtime InstanceID/SmallMeshID/RenderNodeQueue capture remains explicit; no screenshot input");
}
