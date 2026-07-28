// Pin the exact official Bloom Shader asset, pass programs, and proven bindings.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readOfficialPostprocess } from "./official-postprocess.mjs";
import { officialSample } from "./official-sample.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const EXPECTED = {
  source: {
    apkmSha256: "9b7f9067e00a54f342bd4f17e669ceeb86b80bb7d34ff2d0d0fe82050a62f201",
    baseApkSha256: "815dc606f3b3e3404199fac80abb46b9249948828178a5cbf6aedb3d9e6809de",
    globalgamemanagersSha256: "5a1ca51ec16b267710479b85e33bfe150c4aab255e9716fd33d51ce7a33ea017",
    globalgamemanagersResourceSha256: "035e89da4ddfe2becba4a5848356d1c99dd4d123ee5a03646b547378de56d696",
  },
  asset: {
    name: "Hidden/CustomPostEffect/Bloom",
    pathId: 10,
    type: "Shader",
    classId: 48,
    resourceOffset: 5452640,
    splitPath: "assets/bin/Data/globalgamemanagers.assets.split5",
    splitOffset: 209760,
    byteSize: 19900,
    rawSha256: "8684703cededfb2cbd1bddb656c650be5689ba80cfe1d0ae30deecf35826ccef",
  },
  program: {
    compressedLength: 4325,
    compressedSha256: "1f923d6c1b6cb41e2ec631b66c433ff59ff27a9835e1cfc844c3f3a070a214ba",
    decompressedLength: 11684,
    decompressedSha256: "cbb7eee99c33df71d8eb2bb0a763357978e4f5c5aedab9a9b5662d42b7c3b500",
    programSetSha256: "212cac8fa20e4336ca6c9fd06622000f210fb08171a77e7fe161739f0b69422b",
  },
  passes: [
    {
      parameterBlobIndex: 0,
      programBlobIndex: 1,
      parameterSha256: "abc9260ca44693aa494b92e17dc211246ea95940de3171a4f069997a805e263c",
      programSha256: "0461f6b48af1c0f79ac42d48d49f41bb466764cf038b0bb0ff53fcd610ba6ace",
      modules: [
        ["fragment", 1476, "801650bce9770e4916791417a67838a0d6492bdf3865b78aac7034db00993bd5"],
        ["vertex", 2388, "005ae2db725c0855cd7639112f4fcbe8a927962c1d3cbabad4253140cf0442ee"],
      ],
      samplers: ["_MainTex|0|134217728|-1|2|false"],
      uniforms: [
        "unity_MatrixVP|VGlobals3489135400|matrix|64|4",
        "unity_ObjectToWorld|VGlobals3489135400|matrix|0|4",
      ],
      state: [1, 0, 1, 0, 0, 0, 15, false, 4, 1, 2],
    },
    {
      parameterBlobIndex: 2,
      programBlobIndex: 3,
      parameterSha256: "a6437bf1be4beb49e61df7edb497f46a680eac4e3721b858a6e3f43561d9d36c",
      programSha256: "d3af06e5a4ac1b1ede51ba4425042ee3d2d9f04cb9ede27a78c733c957cca061",
      modules: [
        ["fragment", 2860, "e07a14939c2270f4decfa8fd759749f8e8b61969e67cbcc7751a6f2a9875d3ed"],
        ["vertex", 3604, "345ad63197d4f528fd23b42ca3f5630600ab0e9738b3eb646c198a1eec71f6ff"],
      ],
      samplers: ["_MainTex|0|134217728|-1|2|false"],
      uniforms: [
        "_MainTex_TexelSize|PGlobals2631070036|vector|0|4",
        "unity_ObjectToWorld|UnityPerDraw|matrix|0|4",
        "unity_MatrixVP|VGlobals2631070036|matrix|0|4",
      ],
      state: [1, 0, 1, 0, 0, 0, 15, false, 4, 1, 2],
    },
    {
      parameterBlobIndex: 4,
      programBlobIndex: 5,
      parameterSha256: "b226335b552b116b73f2a1f3825e5b993f206c7c9a68933647cfd8936ebc36ab",
      programSha256: "b2a841a47e114952d615bdd320d1e7051df969099e37875098b28262e6ec7800",
      modules: [
        ["fragment", 4176, "0b715f2bb9ce16be7898d38ba63c80764fddedc0d938e3e56632f74cd89dbbfe"],
        ["vertex", 3504, "b4cd4802893d1bfd1042386e3f79bafaf658b502707d005fb2df76cb8a747e02"],
      ],
      samplers: [1, 2, 3, 4, 5, 6, 7].map((n, index) => `_DownSampling${n}Tex|${index}|${134217728 + index}|-1|2|false`),
      uniforms: [
        "unity_ObjectToWorld|UnityPerDraw|matrix|0|4",
        "unity_MatrixVP|VGlobals2537441929|matrix|0|4",
      ],
      state: [1, 0, 1, 0, 0, 0, 15, false, 0, 0, 2],
    },
    {
      parameterBlobIndex: 6,
      programBlobIndex: 7,
      parameterSha256: "8f688399ea775476cd53ac5139a0f1b92659437299499a8e3f511dedd9087204",
      programSha256: "f7cea732009cf2b172dfa6bdfe97ae115ce0d2f5e5ecbbcf5345312e8e247eb2",
      modules: [
        ["fragment", 3432, "64e5101598193c179f84aa18625d472595c3c7f188037d870e541cda7e1524ad"],
        ["vertex", 3504, "47d77db73cb2da6e5ddbd9aa29b273f30e4662002f18b0e072751f6306082b21"],
      ],
      samplers: ["_MainTex|0|134217728|-1|2|false"],
      uniforms: [
        "_GlobalMipBias|PGlobals2868980751|vector|0|2",
        "_MainTex_TexelSize|PGlobals2868980751|vector|16|4",
        "_Vector|PGlobals2868980751|vector|32|2",
        "unity_ObjectToWorld|UnityPerDraw|matrix|0|4",
        "unity_MatrixVP|VGlobals2868980751|matrix|0|4",
      ],
      state: [1, 0, 1, 0, 0, 0, 15, false, 4, 1, 2],
    },
    {
      parameterBlobIndex: 8,
      programBlobIndex: 9,
      parameterSha256: "f48c52f47256668fe904e5086210156d55dfb4e3561fb99686bef582ce84b078",
      programSha256: "e58a9b189797b38661b0a1ec56e0b957cc14c5e984cc3720e8af28f8b4aa93cc",
      modules: [
        ["fragment", 1408, "3cd41d46192418a497e907d947d328b948bb6f99855cadbefb8f5a52fcbf2586"],
        ["vertex", 3604, "240d6492f4889dfd160e84881a59dcd0c3c0e4e84c6b494cc9c06aea00926f56"],
      ],
      samplers: ["_MainTex|0|134217728|-1|2|false"],
      uniforms: [
        "_GlobalMipBias|PGlobals2172634743|vector|0|2",
        "unity_ObjectToWorld|UnityPerDraw|matrix|0|4",
        "unity_MatrixVP|VGlobals2172634743|matrix|0|4",
      ],
      state: [1, 5, 1, 5, 0, 0, 15, false, 4, 1, 2],
    },
    {
      parameterBlobIndex: 10,
      programBlobIndex: 11,
      parameterSha256: "3587f63135b4dd7aab5bdf0e2488a68d3f8ea3ad15891808d6b7274165e97bbf",
      programSha256: "c25d8ba99d108fe51249427a2ee17dfe7e5d326994233b2761cee5e68c654d38",
      modules: [
        ["fragment", 1052, "aaa4a2b3e10d9ee617e167bab26754c6b045ca448db5023c6d30afb6fc99606c"],
        ["vertex", 3504, "47d77db73cb2da6e5ddbd9aa29b273f30e4662002f18b0e072751f6306082b21"],
      ],
      samplers: ["_MainTex|0|134217728|-1|2|false"],
      uniforms: [
        "_GlobalMipBias|PGlobals2113300213|vector|0|2",
        "unity_ObjectToWorld|UnityPerDraw|matrix|0|4",
        "unity_MatrixVP|VGlobals2113300213|matrix|0|4",
      ],
      state: [1, 1, 0, 1, 0, 0, 15, false, 0, 0, 2],
    },
  ],
};

function readBloomProgram() {
  const result = spawnSync(process.env.PYTHON || "python", ["build/extract_official_bloom_program.py"], {
    cwd: ROOT,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || result.error?.message || "unknown extraction failure").trim();
    throw new Error(`official Bloom program extraction failed: ${detail}`);
  }
  return JSON.parse(result.stdout);
}

const bloom = readBloomProgram();
const postprocess = readOfficialPostprocess();
const issues = [];

if (officialSample.artifacts.apkm.sha256 !== EXPECTED.source.apkmSha256) {
  issues.push("current official sample APKM hash does not match the pinned Bloom program");
}

function same(label, actual, expected) {
  if (actual !== expected) issues.push(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function sameJson(label, actual, expected) {
  same(label, JSON.stringify(actual), JSON.stringify(expected));
}

function hash(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function rawBytes(label, hex) {
  if (typeof hex !== "string" || hex.length % 2 || !/^[0-9a-f]*$/.test(hex)) {
    issues.push(`${label}: invalid lowercase hex bytes`);
    return Buffer.alloc(0);
  }
  return Buffer.from(hex, "hex");
}

function verifyRaw(label, record, hexKey = "rawHex") {
  const bytes = rawBytes(`${label}.${hexKey}`, record?.[hexKey]);
  same(`${label} byte length`, bytes.length, record?.byteSize ?? record?.length);
  same(`${label} sha256 from bytes`, hash(bytes), record?.sha256 ?? record?.rawSha256);
  return bytes;
}

for (const [key, expected] of Object.entries(EXPECTED.source)) {
  same(`source.${key}`, bloom.source[key], expected);
  same(`source.${key} cross-check`, bloom.source[key], postprocess.source[key]);
}

for (const [key, expected] of Object.entries(EXPECTED.asset)) {
  same(`shaderAsset.${key}`, bloom.shaderAsset[key], expected);
}
const assetBytes = rawBytes("shaderAsset.rawHex", bloom.shaderAsset.rawHex);
same("shader asset raw byte length", assetBytes.length, bloom.shaderAsset.byteSize);
same("shader asset raw hash from bytes", hash(assetBytes), bloom.shaderAsset.rawSha256);

sameJson("BloomPass Shader PPtr", postprocess.serializedPostProcess.bloomPass.fields.shader.value,
  { fileId: 0, pathId: bloom.shaderAsset.pathId });
same("postprocess Bloom shader name", postprocess.bloomShader.name, bloom.shaderAsset.name);

const program = bloom.shaderProgram;
sameJson("shader platforms", program.platforms, [18]);
same("Vulkan GpuProgramType", program.gpuProgramType, 25);
same("subshader count", program.subshaderCount, 1);
same("pass count", program.passCount, 6);
same("program entry count", program.programEntryCount, 6);
same("blob entry count", program.blobEntryCount, 12);
same("module count", program.moduleCount, 12);
for (const [key, expected] of Object.entries(EXPECTED.program)) same(`shaderProgram.${key}`, program[key], expected);

const compressed = rawBytes("shaderProgram.compressedHex", program.compressedHex);
same("compressed bytes length", compressed.length, program.compressedLength);
same("compressed bytes hash", hash(compressed), program.compressedSha256);
const decompressed = rawBytes("shaderProgram.decompressedHex", program.decompressedHex);
same("decompressed bytes length", decompressed.length, program.decompressedLength);
same("decompressed bytes hash", hash(decompressed), program.decompressedSha256);
same("postprocess compressed hash", program.compressedSha256, postprocess.bloomShader.compressedSha256);
same("postprocess decompressed hash", program.decompressedSha256, postprocess.bloomShader.decompressedSha256);

function samplerSignature(item) {
  return [item.name, item.binding, item.encodedIndex, item.samplerIndex, item.dimension, item.multisampled].join("|");
}

function uniformSignature(item) {
  return [item.name, item.buffer, item.kind, item.offset, item.dimension ?? item.rowCount].join("|");
}

function stateSignature(state) {
  return [
    state.srcBlend, state.destBlend, state.srcBlendAlpha, state.destBlendAlpha,
    state.blendOp, state.blendOpAlpha, state.colorMask, state.separateBlend,
    state.zTest, state.zWrite, state.cull,
  ];
}

const flattenedModuleHashes = [];
for (let index = 0; index < EXPECTED.passes.length; index += 1) {
  const actual = program.passes[index];
  const expected = EXPECTED.passes[index];
  same(`pass ${index} index`, actual.pass, index);
  same(`pass ${index} metadata stage`, actual.metadataStage, "progVertex");
  same(`pass ${index} platform`, actual.platforms.join(","), "18");
  same(`pass ${index} program mask`, actual.programMask, 6);
  same(`pass ${index} GpuProgramType`, actual.gpuProgramType, 25);
  sameJson(`pass ${index} keywords`, actual.keywordIndices, []);
  same(`pass ${index} parameter blob index`, actual.parameterBlobIndex, expected.parameterBlobIndex);
  same(`pass ${index} program blob index`, actual.programBlobIndex, expected.programBlobIndex);
  same(`pass ${index} parameter entry index`, actual.parameterEntry.index, expected.parameterBlobIndex);
  same(`pass ${index} program entry index`, actual.programEntry.index, expected.programBlobIndex);
  same(`pass ${index} parameter entry hash`, actual.parameterEntry.sha256, expected.parameterSha256);
  same(`pass ${index} program entry hash`, actual.programEntry.sha256, expected.programSha256);

  for (const [label, entry] of [["parameter", actual.parameterEntry], ["program", actual.programEntry]]) {
    const entryBytes = verifyRaw(`pass ${index} ${label} entry`, entry);
    same(`pass ${index} ${label} entry table slice`, entryBytes.toString("hex"),
      decompressed.subarray(entry.offset, entry.offset + entry.length).toString("hex"));
    same(`pass ${index} ${label} unknown word`, entry.unknownWord, 0);
  }

  same(`pass ${index} module count`, actual.modules.length, 2);
  for (let moduleIndex = 0; moduleIndex < expected.modules.length; moduleIndex += 1) {
    const module = actual.modules[moduleIndex];
    const [stage, byteSize, sha256] = expected.modules[moduleIndex];
    same(`pass ${index} module ${moduleIndex} stage`, module.stage, stage);
    same(`pass ${index} module ${moduleIndex} execution model`, module.executionModel, stage === "fragment" ? 4 : 0);
    same(`pass ${index} module ${moduleIndex} entry point`, module.entryPoint, "main");
    same(`pass ${index} module ${moduleIndex} byte size`, module.byteSize, byteSize);
    same(`pass ${index} module ${moduleIndex} hash`, module.sha256, sha256);
    const spv = rawBytes(`pass ${index} module ${moduleIndex}.spvHex`, module.spvHex);
    same(`pass ${index} module ${moduleIndex} SPIR-V size`, spv.length, byteSize);
    same(`pass ${index} module ${moduleIndex} SPIR-V hash from bytes`, hash(spv), sha256);
    same(`pass ${index} module ${moduleIndex} SPIR-V magic`, spv.subarray(0, 4).toString("hex"), "03022307");
    flattenedModuleHashes.push(module.sha256);
  }

  sameJson(`pass ${index} proven sampler bindings`, actual.bindings.samplers.map(samplerSignature), expected.samplers);
  sameJson(`pass ${index} proven uniforms`, actual.bindings.uniforms.map(uniformSignature), expected.uniforms);
  sameJson(`pass ${index} separate sampler states`, actual.bindings.serializedSamplerStates, []);
  sameJson(`pass ${index} serialized render state`, stateSignature(actual.renderState), expected.state);
}

sameJson("module hash list from pass mapping", program.moduleHashes, flattenedModuleHashes);
sameJson("module hashes cross-check postprocess", flattenedModuleHashes,
  postprocess.bloomShader.modules.map((module) => module.sha256));

const operationMap = Array.from({ length: 6 }, () => []);
for (const item of postprocess.native.bloomExecuteSequence) operationMap[item.pass].push(item.operation);
sameJson("pass 0-5 Execute mapping", operationMap, [
  ["Blit"],
  ["Blit/downsample loop"],
  ["DrawMesh/Image2Sheet"],
  ["Blit/blur", "Blit/blur"],
  ["DrawMesh/Sheet2Image"],
  ["Blit/final"],
]);

if (issues.length) {
  console.error(`Official Bloom program audit failed: ${issues.length} issue(s)`);
  for (const issue of issues) console.error(`BAD ${issue}`);
  process.exit(1);
}

console.log("Official Bloom program audit OK");
console.log(`Shader asset: PathID ${bloom.shaderAsset.pathId}, ${bloom.shaderAsset.byteSize} bytes, sha256 ${bloom.shaderAsset.rawSha256}`);
console.log(`Programs: ${program.passCount} passes, ${program.programEntryCount} entries, ${program.moduleCount} SPIR-V modules`);
for (const pass of program.passes) {
  const modules = pass.modules.map((module) => `${module.stage}:${module.sha256.slice(0, 12)}`).join(" ");
  const samplers = pass.bindings.samplers.map((item) => item.name).join(",");
  const uniforms = pass.bindings.uniforms.map((item) => item.name).join(",");
  console.log(`pass ${pass.pass}: blob ${pass.programBlobIndex} ${modules} samplers=[${samplers}] uniforms=[${uniforms}]`);
}
