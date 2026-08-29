// Generate the WebGL2 Prerender Homography program from official Vulkan SPIR-V.
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { atomicWriteFileSync } from "./atomic-publish.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHADER_ROOT = process.env.PCR_SHADERS
  || "D:/DevProjectes/ptcgp-tools-master/masterdata_decoder/.output/decrypted/Common/Shader";
const APKM = process.env.PCR_APKM
  || path.resolve(ROOT, "..", "ptcg-apk-parser", "apks", "jp.pokemon.pokemontcgp_1.6.0.apkm");
const DECRYPTED_ROOT = process.env.PCR_DECRYPTED_ROOT
  || "D:/DevProjectes/ptcgp-tools-master/masterdata_decoder/.output/decrypted";
const PYTHON = process.env.PYTHON || "python";
const SPIRV_CROSS = process.env.SPIRV_CROSS || "spirv-cross";
const OUT = path.join(ROOT, "public", "shaders");
const CHECK = process.argv.includes("--check") || process.env.PCR_EXACT_CHECK === "1";
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pcr-homography-"));

const PINNED = {
  shader: {
    name: "Lettuce/Common/CardNew/Prerender/Homography(from RT)",
    bundleByteSize: 18500,
    bundleSha256: "00b8e07fdd4ff114513ed732abd5eae6489b1b744abf95eba5bd801544073f3a",
    objectPathId: "-230642161556405053",
    objectByteSize: 4724,
    objectSha256: "0a8c0df5d762ff75550f7155e98a2307ceab5c55bab119d794f4506b223196b1",
    serializedFile: "CAB-97b4be56dcc4d094ca2d7026a1259cfe",
  },
  material: {
    name: "PrerenderHomographyCard",
    bundleByteSize: 2733,
    bundleSha256: "bae81007d07cbf680c94ac1827b8855adf03a6ddf92db0b7e8c07fb7da8c3d61",
    objectPathId: "-332705428253792402",
    objectByteSize: 864,
    objectSha256: "0178ec97db1f9ef89958a2f77ef190815cdcaa06b386e94c727b2f5427a03a37",
    serializedFile: "CAB-43815086a58b85896718b16a4ea6cb2c",
  },
  program: {
    compressedByteSize: 1637,
    compressedSha256: "fc016c55bce184f501b01fd4270749d9be91f4fb54d78c05468f9ab9041c4b14",
    decompressedByteSize: 2488,
    decompressedSha256: "0e788dd3b902f0c1e34b11627957568b118f7d719608f10abf9f0e9d0e2dff1e",
    parameterByteSize: 100,
    parameterSha256: "8a1edba526ab9e9a4b6b004a5d0461c3099c4afd4c7d206853f55b9aefdd1fed",
    programByteSize: 2360,
    programSha256: "8e67a7a923cf8eb278ff1b8001f9f3b72f72f34c7544b513db9b2635ae8ea780",
  },
  modules: {
    vertex: {
      byteSize: 4312,
      spirvSha256: "ca8eb7a85ec900b4b96271fce705592f67a76c9e42d399245bcbad44c59c6a59",
      reflectionSha256: "0174c9fe432cb8906d101ee03d1314dcf420bb866fdfcc62210774ca2e836c72",
    },
    fragment: {
      byteSize: 2928,
      spirvSha256: "be76493bce4ebe9ddd00d1387270afebf1ef36ce7e60fb5066259d7e23eabab2",
      reflectionSha256: "1b60444eb96e78940f50e8e55fb1aef1cfb7c7fd111d5255ed9a8b9e1033bbb8",
    },
  },
  apkm: {
    sha256: "9b7f9067e00a54f342bd4f17e669ceeb86b80bb7d34ff2d0d0fe82050a62f201",
    baseApkSha256: "815dc606f3b3e3404199fac80abb46b9249948828178a5cbf6aedb3d9e6809de",
    arm64SplitSha256: "7faf449bae431dcfeda4f882ecb04290af66cc4ccfeefc620e24cac70d22fcec",
    libil2cppSha256: "3e78eedc62770fff4cb129b4b8d898950e131b710b3c099237fe20d2d34ca48e",
    metadataSha256: "bf58e06a98f9e9e05a1635f512ea432d33971bfc8280ba26df1c93e94b4f3cb9",
  },
  builtinQuad: {
    resourcesSha256: "a9a74ab363888de3ea14ef01e780f851a395d4c6f5d5bcebad74a2a3e4785d16",
    objectSha256: "a011b7668060df09340e550322f72f1ea635e5c8461ea3fbfb2a6f4071fff82a",
    vertexDataSha256: "08be4edecc1d612e615cdaafc4460eaabd1fefa3d5681e44c266832c403be841",
    indexDataSha256: "87a2848d2d137388dae050ee16920af5b5808427aa09d0f85b52075bffa3879e",
  },
  methods: {
    calcHomography: "fc1463b7d34a6bd728470522b9c369dd9125dd9c1fe0f7e4885f4422482c55e0",
    calcInverse: "d88715856fd608cf6c9c1a756851288f592e6bd453cb6d3cb9213d9b6614daa0",
    getRotatedKeyPoints: "3dd9a748dd530c7e08e05009de0f44730f4d2662d6df1b926d4a1563bc8374e1",
    cameraWorldToViewportDefault: "d9861b18cda9f066a90c30e6752bb6966be1a110f517b2ed37b9b0d8f228e12e",
    cameraWorldToViewportInjected: "9ad895db6bb3889c22fcdc312586f7cfd52e6db5700daacd8bca8f990201a86f",
    setParameters: "6253248b683371c6aa0c8d9fa86defcea562f273a717e8cbf6f658a6b1e57719",
    constructor: "b014ddafef9f6163ad1840cbdfb96c831989d1632debdf70cc58428609a7d9ac",
    floatArraySetter: "56db4b6f82676cf10a899d750733e8b9fcdb5c25e833fe775d46b2f7b3dc0842",
  },
};

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });
}

function same(actual, expected, label) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  }
  return value;
}

function reflectionHash(reflection) {
  return sha256(JSON.stringify(stable(reflection)));
}

function replaceOnce(source, before, after, label) {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`${label}: source pattern was not found`);
  if (source.indexOf(before, first + before.length) >= 0) {
    throw new Error(`${label}: source pattern was not unique`);
  }
  return source.slice(0, first) + after + source.slice(first + before.length);
}

function stripVersion(source) {
  return replaceOnce(source.replace(/\r\n/g, "\n"), "#version 300 es\n", "", "GLSL version removal");
}

function replaceUbo(source, block, owner, declarations) {
  const pattern = new RegExp(`layout\\(std140\\) uniform ${block}[\\s\\S]*?}\\s*${owner};\\s*`);
  const output = source.replace(pattern, `${declarations.join("\n")}\n\n`);
  if (output === source) throw new Error(`${block} replacement failed`);
  return output;
}

function adaptVertex(source) {
  let output = stripVersion(source);
  output = replaceUbo(output, "_23_25", "_25", [
    "uniform highp mat4 modelMatrix;",
    "uniform highp mat4 viewMatrix;",
    "uniform highp mat4 projectionMatrix;",
    "uniform highp float _InvHomographyMatrix[9];",
  ]);
  output = replaceOnce(
    output,
    "layout(location = 0) in vec2 _12;",
    "layout(location = 0) in vec2 uv;",
    "vertex UV0 attribute",
  );
  output = replaceOnce(
    output,
    "out vec2 vs_TEXCOORD0;",
    "out highp vec2 vHomographyUv;",
    "primary vertex varying",
  );
  output = replaceOnce(
    output,
    "out vec4 vs_TEXCOORD1;",
    "out highp vec4 vSourcePosition;",
    "secondary vertex varying",
  );
  output = output
    .replace(/\bvs_TEXCOORD0\b/g, "vHomographyUv")
    .replace(/\bvs_TEXCOORD1\b/g, "vSourcePosition")
    .replace(/_25\._m2/g, "_InvHomographyMatrix")
    .replace(/_25\._m0/g, "_ObjectToWorld")
    .replace(/_25\._m1/g, "_ViewProjection");
  output = replaceOnce(
    output,
    "void main()\n{",
    `void main()
{
    vec2 _12 = uv;
    mat4 _ObjectToWorld = modelMatrix;
    mat4 _ViewProjection = projectionMatrix * viewMatrix;`,
    "vertex WebGL inputs",
  );
  output = replaceOnce(
    output,
    "    gl_Position.y = -gl_Position.y;\n",
    "",
    "Vulkan clip-space Y flip",
  );
  if (/layout\(std140\)|_25\._m|vs_TEXCOORD|gl_Position\.y\s*=\s*-gl_Position\.y/.test(output)) {
    throw new Error("Homography vertex adaptation is incomplete");
  }
  return `precision highp float;\nprecision highp int;\n\n${output.trim()}\n`;
}

function adaptFragment(source) {
  let output = stripVersion(source);
  output = replaceUbo(output, "_19_21", "_21", [
    "uniform highp float _HomographyMatrix[9];",
  ]);
  output = replaceOnce(
    output,
    "uniform mediump sampler2D _97;",
    "uniform mediump sampler2D _DynamicUITex;",
    "combined Dynamic UI sampler",
  );
  output = replaceOnce(
    output,
    "in highp vec2 vs_TEXCOORD0;",
    "in highp vec2 vHomographyUv;",
    "fragment varying",
  );
  output = replaceOnce(
    output,
    "layout(location = 0) out highp vec4 _109;",
    "layout(location = 0) out highp vec4 outColor;",
    "primary fragment output",
  );
  output = replaceOnce(
    output,
    "layout(location = 1) out highp vec4 _118;",
    "layout(location = 1) out highp vec4 outAux;",
    "secondary fragment output",
  );
  output = replaceOnce(output, "vec4 _93;", "vec4 sampled;", "sample temporary");
  output = replaceOnce(output, "float _101;", "float inverseAlpha;", "alpha temporary");
  output = output
    .replace(/\bvs_TEXCOORD0\b/g, "vHomographyUv")
    .replace(/_21\._m0/g, "_HomographyMatrix")
    .replace(/\b_97\b/g, "_DynamicUITex")
    .replace(/\b_109\b/g, "outColor")
    .replace(/\b_118\b/g, "outAux")
    .replace(/\b_93\b/g, "sampled")
    .replace(/\b_101\b/g, "inverseAlpha");
  if (!output.includes("inverseAlpha = (-sampled.w) + 1.0;")) {
    throw new Error("official alpha inversion was not preserved");
  }
  if (!output.includes("outAux = vec4(0.0);")) {
    throw new Error("official zero secondary output was not preserved");
  }
  if (/layout\(std140\)|_21\._m|vs_TEXCOORD|\b_97\b|\b_109\b|\b_118\b/.test(output)) {
    throw new Error("Homography fragment adaptation is incomplete");
  }
  return `${output.trim()}\n`;
}

function moduleFor(evidence, stage) {
  const module = evidence.modules.find((item) => item.stage === stage);
  if (!module) throw new Error(`official ${stage} module is missing`);
  const bytes = Buffer.from(module.spvHex, "hex");
  if (bytes.length !== module.byteSize || sha256(bytes) !== module.sha256) {
    throw new Error(`official ${stage} module bytes do not match extractor evidence`);
  }
  return { module, bytes };
}

function reflection(file) {
  return JSON.parse(run(SPIRV_CROSS, [file, "--reflect"]));
}

function reflectedBlock(data, name) {
  const ubo = (data.ubos || []).find((item) => item.name === name);
  if (!ubo) throw new Error(`${name} reflection is missing`);
  return {
    name: ubo.name,
    set: ubo.set,
    binding: ubo.binding,
    blockSize: ubo.block_size,
    members: (data.types[ubo.type]?.members || []).map((member) => ({
      name: member.name,
      type: member.type,
      offset: member.offset,
      ...(member.array ? { array: member.array } : {}),
      ...(member.array_stride != null ? { arrayStride: member.array_stride } : {}),
    })),
  };
}

function interfaceRows(data, key) {
  return (data[key] || []).map(({ name, type, location, set, binding }) => ({
    name,
    type,
    ...(location != null ? { location } : {}),
    ...(set != null ? { set } : {}),
    ...(binding != null ? { binding } : {}),
  })).sort((a, b) => (a.location ?? a.binding) - (b.location ?? b.binding));
}

function assertEvidence(evidence) {
  same(evidence.shader.name, PINNED.shader.name, "official shader name");
  same(
    [evidence.source.bundle.byteSize, evidence.source.bundle.sha256],
    [PINNED.shader.bundleByteSize, PINNED.shader.bundleSha256],
    "official shader bundle",
  );
  same(
    [evidence.source.shaderObject.pathId, evidence.source.shaderObject.byteSize,
      evidence.source.shaderObject.sha256, evidence.source.shaderSerializedFile],
    [PINNED.shader.objectPathId, PINNED.shader.objectByteSize,
      PINNED.shader.objectSha256, PINNED.shader.serializedFile],
    "official Shader object",
  );
  same(evidence.shader.properties, [{
    name: "_DynamicUITex",
    description: "Main Texture",
    attributes: [],
    type: 4,
    flags: 4,
    defaultValue: [0, 0, 0, 0],
    defaultTexture: { name: "white", dimension: 2 },
  }], "serialized shader properties");
  same(evidence.shader.keywordNames, [
    "STEREO_INSTANCING_ON", "UNITY_SINGLE_PASS_STEREO",
    "STEREO_MULTIVIEW_ON", "STEREO_CUBEMAP_RENDER_ON",
  ], "serialized keyword names");
  same(evidence.selectedVariant, {
    stageMetadata: "progVertex",
    groupIndex: 3,
    variantIndex: 0,
    keywordIndices: [],
    keywords: [],
    parameterBlobIndex: 0,
    programBlobIndex: 1,
    gpuProgramType: 25,
    shaderRequirements: 1,
  }, "official empty-keyword variant");

  const material = evidence.officialMaterial;
  same(
    [material.name, material.bundle.byteSize, material.bundle.sha256,
      material.materialObject.pathId, material.materialObject.byteSize,
      material.materialObject.sha256, material.serializedFile],
    [PINNED.material.name, PINNED.material.bundleByteSize, PINNED.material.bundleSha256,
      PINNED.material.objectPathId, PINNED.material.objectByteSize,
      PINNED.material.objectSha256, PINNED.material.serializedFile],
    "official PrerenderHomographyCard material",
  );
  same(material.shaderPPtr, { fileId: 1, pathId: PINNED.shader.objectPathId }, "material Shader PPtr");
  same(material.shaderExternal.name, PINNED.shader.serializedFile, "material Shader external");
  same(material.dynamicUITexture, {
    fileId: 0, pathId: "0", scale: [1, 1], offset: [0, 0],
  }, "material Dynamic UI texture slot");
  same(material.validKeywords, [], "material valid keywords");
  same(material.invalidKeywords, [], "material invalid keywords");
  same(material.customRenderQueue, -1, "material custom queue");

  same(
    [evidence.programBlock.compressed.byteSize, evidence.programBlock.compressed.sha256],
    [PINNED.program.compressedByteSize, PINNED.program.compressedSha256],
    "compressed Vulkan program block",
  );
  same(
    [evidence.programBlock.decompressed.byteSize, evidence.programBlock.decompressed.sha256],
    [PINNED.program.decompressedByteSize, PINNED.program.decompressedSha256],
    "decompressed Vulkan program block",
  );
  same(
    evidence.programBlock.entries.map(({ length, sha256: hash }) => [length, hash]),
    [
      [PINNED.program.parameterByteSize, PINNED.program.parameterSha256],
      [PINNED.program.programByteSize, PINNED.program.programSha256],
    ],
    "ShaderProgram entries",
  );

  same(evidence.bindings.common.textures, [{
    name: "_DynamicUITex", stageMetadata: "progVertex", binding: 0,
    encodedIndex: 134217728, samplerIndex: -1, dimension: 2, multisampled: false,
  }], "serialized Dynamic UI texture binding");
  same(evidence.bindings.common.constantBuffers, [
    {
      name: "PGlobals445077468", stageMetadata: "progVertex", size: 144, partial: true,
      vectorFields: [{
        name: "_HomographyMatrix", offset: 0, arraySize: 9, scalarType: 0, dimension: 1,
      }],
      matrixFields: [],
    },
    {
      name: "VGlobals445077468", stageMetadata: "progVertex", size: 272, partial: true,
      vectorFields: [{
        name: "_InvHomographyMatrix", offset: 128, arraySize: 9, scalarType: 0, dimension: 1,
      }],
      matrixFields: [
        { name: "unity_MatrixVP", offset: 64, arraySize: 0, scalarType: 0, rowCount: 4 },
        { name: "unity_ObjectToWorld", offset: 0, arraySize: 0, scalarType: 0, rowCount: 4 },
      ],
    },
  ], "serialized homography constant buffers");
  same(evidence.bindings.common.constantBufferBindings, [
    { name: "PGlobals445077468", stageMetadata: "progVertex", encodedIndex: 134283264, arraySize: 1 },
    { name: "VGlobals445077468", stageMetadata: "progVertex", encodedIndex: 67174401, arraySize: 1 },
  ], "serialized constant-buffer binding indices");
  same(evidence.bindings.parameterEntry, {
    version: 202012090,
    constantBlockCount: 3,
    constantBuffers: [
      { name: "", size: 0, fields: [] },
      { name: "PGlobals445077468", size: 144, fields: [] },
      { name: "VGlobals445077468", size: 272, fields: [] },
    ],
    resourceCount: 0,
    resourceDecoding: "empty-exact",
    textures: [],
    constantBufferBindings: [],
  }, "variant parameter entry");

  const source = evidence.apkm.source;
  same(source.apkmSha256, PINNED.apkm.sha256, "APKM hash");
  same(source.baseApkSha256, PINNED.apkm.baseApkSha256, "base APK hash");
  same(source.arm64SplitSha256, PINNED.apkm.arm64SplitSha256, "arm64 split hash");
  same(source.libil2cppSha256, PINNED.apkm.libil2cppSha256, "libil2cpp hash");
  same(source.metadata.plaintextSha256, PINNED.apkm.metadataSha256, "global metadata hash");
  same(Object.fromEntries(Object.entries(evidence.apkm.propertyLiterals).map(([key, item]) => [key, item.value])), {
    dynamicUITexture: "_DynamicUITex",
    homography: "_HomographyMatrix",
    inverseHomography: "_InvHomographyMatrix",
  }, "libil2cpp property literals");
  same(
    Object.fromEntries(Object.entries(evidence.apkm.methods).map(([key, item]) => [key, item.sha256])),
    PINNED.methods,
    "libil2cpp homography methods",
  );
  same(evidence.apkm.coordinateContract, {
    coordinateSpace: "UnityEngine.Camera.WorldToViewportPoint",
    projectedPointCount: 4,
    getRotatedKeyPointsRva: "0x439899c",
    cameraDefaultWrapperRva: "0x64ddce0",
    cameraInjectedWrapperRva: "0x64dda74",
    defaultStereoEyeArgument: 2,
    nativeIcall: {
      rva: "0x1aefb9e",
      value: "UnityEngine.Camera::WorldToViewportPoint_Injected",
      byteSize: 49,
      sha256: "06bce24701b9aea3bb254d19b130bb43ad48f4b4f9573fb4b778e9e9f2e97eea",
      rawHex: "556e697479456e67696e652e43616d6572613a3a576f726c64546f56696577706f7274506f696e745f496e6a6563746564",
    },
    projectedPointOrder: [
      { index: 0, field: "_keyPointLeftDown", instanceOffset: 56, arrayDataOffset: 32, loadInstruction: { rva: "0x43989a8", text: "ldr x0, [x0, #0x38]" }, storeInstruction: { rva: "0x43989dc", text: "stp s0, s1, [x21, #0x20]" } },
      { index: 1, field: "_keyPointRightDown", instanceOffset: 64, arrayDataOffset: 40, loadInstruction: { rva: "0x43989e0", text: "ldr x0, [x19, #0x40]" }, storeInstruction: { rva: "0x4398a18", text: "stp s0, s1, [x21, #0x28]" } },
      { index: 2, field: "_keyPointLeftUp", instanceOffset: 72, arrayDataOffset: 48, loadInstruction: { rva: "0x4398a1c", text: "ldr x0, [x19, #0x48]" }, storeInstruction: { rva: "0x4398a54", text: "stp s0, s1, [x21, #0x30]" } },
      { index: 3, field: "_keyPointRightUp", instanceOffset: 80, arrayDataOffset: 56, loadInstruction: { rva: "0x4398a58", text: "ldr x0, [x19, #0x50]" }, storeInstruction: { rva: "0x4398a90", text: "stp s0, s1, [x21, #0x38]" } },
    ],
  }, "WorldToViewportPoint keypoint coordinate contract");
  same(evidence.apkm.uploadContract, {
    homographyLength: 9,
    inverseHomographyLength: 9,
    homographyPropertyIdFieldOffset: 112,
    inverseHomographyPropertyIdFieldOffset: 116,
    homographyProducerRva: "0x43987ec",
    inverseProducerRva: "0x4398aac",
    floatArraySetterRva: "0x442cac4",
  }, "libil2cpp float-array upload contract");

  const state = evidence.shader.pass.renderState;
  same(state.blend.separate, false, "separate blend state");
  same(state.blend.targets[0], {
    srcColor: { value: 1, property: null },
    dstColor: { value: 10, property: null },
    srcAlpha: { value: 0, property: null },
    dstAlpha: { value: 10, property: null },
    colorOp: { value: 0, property: null },
    alphaOp: { value: 0, property: null },
    colorMask: { value: 15, property: null },
  }, "render target zero blend state");
  same(state.depth, {
    test: { value: 4, property: null },
    write: { value: 0, property: null },
    clip: { value: 1, property: null },
  }, "depth state");
  same(state.cull, { value: 2, property: null }, "cull state");
}

try {
  const evidence = JSON.parse(run(PYTHON, [
    "build/extract_official_homography_program.py",
    "--shaders", SHADER_ROOT,
    "--apkm", APKM,
  ], {
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
    shell: process.platform === "win32",
    maxBuffer: 4 * 1024 * 1024,
  }));
  assertEvidence(evidence);
  const wiring = JSON.parse(run(PYTHON, [
    "build/extract_official-homography-wiring.py",
    "--apkm", APKM,
    "--decrypted-root", DECRYPTED_ROOT,
  ], {
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
    shell: process.platform === "win32",
    maxBuffer: 16 * 1024 * 1024,
  }));
  const quad = wiring.builtinResources?.quad;
  same(wiring.builtinResources?.source?.sha256, PINNED.builtinQuad.resourcesSha256, "built-in resources hash");
  same(quad?.object?.sha256, PINNED.builtinQuad.objectSha256, "built-in Quad object hash");
  same(quad?.vertexData?.sha256, PINNED.builtinQuad.vertexDataSha256, "built-in Quad vertex buffer hash");
  same(quad?.indexData?.sha256, PINNED.builtinQuad.indexDataSha256, "built-in Quad index buffer hash");
  same(wiring.serialized?.prefab?.meshFilter?.meshPPtr, { fileId: 3, pathId: "10210" }, "PrerenderCard Quad PPtr");
  same(quad.vertices.map(({ position, uv0 }) => [position.slice(0, 2), uv0]), [
    [[-0.5, -0.5], [0, 0]],
    [[0.5, -0.5], [1, 0]],
    [[-0.5, 0.5], [0, 1]],
    [[0.5, 0.5], [1, 1]],
  ], "built-in Quad position/UV0 distinction");
  same(quad.indices, [0, 3, 1, 3, 0, 2], "built-in Quad triangle indices");
  const webgl2Indices = [];
  for (let index = 0; index < quad.indices.length; index += 3) {
    webgl2Indices.push(quad.indices[index], quad.indices[index + 2], quad.indices[index + 1]);
  }

  const outputs = {};
  const moduleManifest = {};
  const reflections = {};
  for (const stage of ["vertex", "fragment"]) {
    const pinned = PINNED.modules[stage];
    const { module, bytes } = moduleFor(evidence, stage);
    same(module.byteSize, pinned.byteSize, `${stage} SPIR-V byte size`);
    same(module.sha256, pinned.spirvSha256, `${stage} SPIR-V hash`);
    const spv = path.join(tmp, `homography.${stage}.spv`);
    fs.writeFileSync(spv, bytes);
    const reflected = reflection(spv);
    const reflectedSha256 = reflectionHash(reflected);
    same(reflectedSha256, pinned.reflectionSha256, `${stage} reflection hash`);
    reflections[stage] = reflected;
    const official = run(SPIRV_CROSS, [spv, "--version", "300", "--es"]);
    outputs[`homography.${stage === "vertex" ? "vert" : "frag"}.glsl`] = stage === "vertex"
      ? adaptVertex(official)
      : adaptFragment(official);
    moduleManifest[stage] = {
      byte_size: pinned.byteSize,
      spirv_sha256: pinned.spirvSha256,
      reflection_sha256: reflectedSha256,
    };
  }

  same(reflectedBlock(reflections.fragment, "_19_21"), {
    name: "_19_21", set: 1, binding: 0, blockSize: 144,
    members: [{ name: "_m0", type: "float", offset: 0, array: [9], arrayStride: 16 }],
  }, "fragment homography reflection");
  same(reflectedBlock(reflections.vertex, "_23_25"), {
    name: "_23_25", set: 1, binding: 1, blockSize: 272,
    members: [
      { name: "_m0", type: "vec4", offset: 0, array: [4], arrayStride: 16 },
      { name: "_m1", type: "vec4", offset: 64, array: [4], arrayStride: 16 },
      { name: "_m2", type: "float", offset: 128, array: [9], arrayStride: 16 },
    ],
  }, "vertex inverse-homography reflection");
  same(interfaceRows(reflections.vertex, "inputs"), [
    { name: "_12", type: "vec2", location: 0 },
  ], "vertex input reflection");
  same(interfaceRows(reflections.vertex, "outputs"), [
    { name: "vs_TEXCOORD0", type: "vec2", location: 0 },
    { name: "vs_TEXCOORD1", type: "vec4", location: 1 },
  ], "vertex output reflection");
  same(interfaceRows(reflections.fragment, "inputs"), [
    { name: "vs_TEXCOORD0", type: "vec2", location: 0 },
  ], "fragment input reflection");
  same(interfaceRows(reflections.fragment, "outputs"), [
    { name: "_109", type: "vec4", location: 0 },
    { name: "_118", type: "vec4", location: 1 },
  ], "fragment output reflection");
  same(interfaceRows(reflections.fragment, "textures"), [
    { name: "_97", type: "sampler2D", set: 0, binding: 0 },
  ], "Dynamic UI sampler reflection");

  outputs["homography_program.json"] = `${JSON.stringify({
    shader: PINNED.shader.name,
    generated_by: "build/build-exact-homography.mjs",
    evidence_scope: ["APKM", "serialized Shader", "serialized Material", "serialized PrerenderCard", "built-in Quad", "SPIR-V", "libil2cpp"],
    official_source: {
      bundle_relative_path: evidence.source.bundleRelativePath,
      bundle_byte_size: PINNED.shader.bundleByteSize,
      bundle_sha256: PINNED.shader.bundleSha256,
      shader_object_path_id: PINNED.shader.objectPathId,
      shader_object_byte_size: PINNED.shader.objectByteSize,
      shader_object_sha256: PINNED.shader.objectSha256,
      shader_serialized_file: PINNED.shader.serializedFile,
      material_relative_path: evidence.officialMaterial.relativePath,
      material_bundle_sha256: PINNED.material.bundleSha256,
      material_object_path_id: PINNED.material.objectPathId,
      material_object_sha256: PINNED.material.objectSha256,
      compressed_program_sha256: PINNED.program.compressedSha256,
      decompressed_program_sha256: PINNED.program.decompressedSha256,
      parameter_entry_sha256: PINNED.program.parameterSha256,
      program_entry_sha256: PINNED.program.programSha256,
    },
    apkm_source: {
      apkm_sha256: PINNED.apkm.sha256,
      base_apk_sha256: PINNED.apkm.baseApkSha256,
      arm64_split_sha256: PINNED.apkm.arm64SplitSha256,
      libil2cpp_sha256: PINNED.apkm.libil2cppSha256,
      global_metadata_sha256: PINNED.apkm.metadataSha256,
      unity_default_resources_sha256: PINNED.builtinQuad.resourcesSha256,
    },
    official_variant: {
      keywords: [],
      variant_index: 0,
      parameter_blob_index: 0,
      program_blob_index: 1,
      gpu_program_type: 25,
      shader_requirements: 1,
    },
    modules: moduleManifest,
    bindings: {
      dynamic_ui_texture: {
        name: "_DynamicUITex",
        spirv_set: 0,
        spirv_binding: 0,
        serialized_binding: 0,
        serialized_encoded_index: 134217728,
        dimension: 2,
        multisampled: false,
        shader_default: "white",
        material_texture_pptr: { file_id: 0, path_id: "0" },
        material_scale: [1, 1],
        material_offset: [0, 0],
      },
      homography: {
        name: "_HomographyMatrix",
        stage: "fragment",
        scalar_type: "float",
        array_length: 9,
        std140_array_stride: 16,
        serialized_buffer: "PGlobals445077468",
        serialized_buffer_size: 144,
        serialized_offset: 0,
        serialized_encoded_binding: 134283264,
        spirv_set: 1,
        spirv_binding: 0,
      },
      inverse_homography: {
        name: "_InvHomographyMatrix",
        stage: "vertex",
        scalar_type: "float",
        array_length: 9,
        std140_array_stride: 16,
        serialized_buffer: "VGlobals445077468",
        serialized_buffer_size: 272,
        serialized_offset: 128,
        serialized_encoded_binding: 67174401,
        spirv_set: 1,
        spirv_binding: 1,
      },
      matrices: [
        { official: "unity_ObjectToWorld", offset: 0, webgl2: "modelMatrix" },
        { official: "unity_MatrixVP", offset: 64, webgl2: "projectionMatrix * viewMatrix" },
      ],
      vertex_attribute: {
        official: "_12",
        location: 0,
        type: "vec2",
        webgl2: "uv",
        source_mesh: "unity default resources/Quad PathID 10210",
        source_position_range: [[-0.5, -0.5], [0.5, 0.5]],
        source_uv0_range: [[0, 0], [1, 1]],
        official_indices: quad.indices,
        webgl2_indices: webgl2Indices,
        winding_adaptation: "reverse each Unity triangle for left-handed to right-handed mesh conversion",
      },
    },
    runtime_upload: {
      property_literals: {
        homography: evidence.apkm.propertyLiterals.homography.value,
        inverse_homography: evidence.apkm.propertyLiterals.inverseHomography.value,
        dynamic_ui_texture: evidence.apkm.propertyLiterals.dynamicUITexture.value,
      },
      property_id_fields: { homography_offset: 112, inverse_homography_offset: 116 },
      float_array_length: 9,
      methods: Object.fromEntries(Object.entries(evidence.apkm.methods).map(([key, item]) => [key, {
        name: item.name,
        rva_start: item.rvaStart,
        rva_end_exclusive: item.rvaEndExclusive,
        byte_size: item.byteSize,
        sha256: item.sha256,
      }])),
      keypoint_coordinates: {
        space: evidence.apkm.coordinateContract.coordinateSpace,
        projected_point_count: evidence.apkm.coordinateContract.projectedPointCount,
        default_stereo_eye_argument: evidence.apkm.coordinateContract.defaultStereoEyeArgument,
        native_icall: evidence.apkm.coordinateContract.nativeIcall.value,
        native_icall_sha256: evidence.apkm.coordinateContract.nativeIcall.sha256,
        projected_point_order: evidence.apkm.coordinateContract.projectedPointOrder.map((item) => ({
          index: item.index,
          field: item.field,
          instance_offset: item.instanceOffset,
          array_data_offset: item.arrayDataOffset,
        })),
      },
    },
    render_state: evidence.shader.pass.renderState,
    tags: evidence.shader.tags,
    fragment_contract: {
      sample_coordinates: "H * vHomographyUv, homogeneous divide by row 2",
      rgb: "sampled.rgb",
      alpha: "1.0 - sampled.a",
      secondary_output: "vec4(0.0)",
    },
    mrt: {
      primary: { name: "outColor", location: 0 },
      secondary: { name: "outAux", location: 1, value: "vec4(0.0)" },
    },
    webgl2_adaptation: [
      "remove the SPIRV-Cross #version directive for host-side WebGL2 version injection",
      "add explicit highp float and int precision declarations to the vertex stage",
      "flatten the official std140 H and Hinv float[9] arrays into named WebGL2 uniform arrays",
      "map unity_ObjectToWorld and unity_MatrixVP to modelMatrix and projectionMatrix * viewMatrix",
      "map the official location-0 vec2 input to the PrerenderCard built-in Quad UV0 attribute",
      "combine the official image and sampler as _DynamicUITex",
      "remove the Vulkan clip-space Y flip",
      "rename stage interface symbols and temporaries without changing shader math",
    ],
    not_established: [
      "physical RenderTexture Y-coordinate convention",
      "runtime wiring into public/app.js",
    ],
  }, null, 2)}\n`;

  fs.mkdirSync(OUT, { recursive: true });
  for (const [name, content] of Object.entries(outputs)) {
    const file = path.join(OUT, name);
    if (CHECK) {
      if (!fs.existsSync(file) || fs.readFileSync(file, "utf8") !== content) {
        throw new Error(`${name} does not match pinned official Homography generation`);
      }
    } else {
      atomicWriteFileSync(file, content);
    }
  }
  console.log(`${CHECK ? "verified" : "generated"} official Prerender Homography WebGL2 program from Vulkan SPIR-V`);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
