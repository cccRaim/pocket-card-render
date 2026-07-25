// Audit the official Prerender Homography chain, SPIR-V, adaptation, and WebGL2 link.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PYTHON = process.env.PYTHON || "python";
const SPIRV_CROSS = process.env.SPIRV_CROSS || "spirv-cross";
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pcr-audit-homography-"));

const EXPECTED = {
  shader: {
    bundle: [18500, "00b8e07fdd4ff114513ed732abd5eae6489b1b744abf95eba5bd801544073f3a"],
    object: ["-230642161556405053", 4724, "0a8c0df5d762ff75550f7155e98a2307ceab5c55bab119d794f4506b223196b1"],
    serializedFile: "CAB-97b4be56dcc4d094ca2d7026a1259cfe",
  },
  material: {
    bundle: [2733, "bae81007d07cbf680c94ac1827b8855adf03a6ddf92db0b7e8c07fb7da8c3d61"],
    object: ["-332705428253792402", 864, "0178ec97db1f9ef89958a2f77ef190815cdcaa06b386e94c727b2f5427a03a37"],
    serializedFile: "CAB-43815086a58b85896718b16a4ea6cb2c",
  },
  program: {
    compressed: [1637, "fc016c55bce184f501b01fd4270749d9be91f4fb54d78c05468f9ab9041c4b14"],
    decompressed: [2488, "0e788dd3b902f0c1e34b11627957568b118f7d719608f10abf9f0e9d0e2dff1e"],
    parameter: [100, "8a1edba526ab9e9a4b6b004a5d0461c3099c4afd4c7d206853f55b9aefdd1fed"],
    program: [2360, "8e67a7a923cf8eb278ff1b8001f9f3b72f72f34c7544b513db9b2635ae8ea780"],
  },
  modules: {
    vertex: [
      4312,
      "ca8eb7a85ec900b4b96271fce705592f67a76c9e42d399245bcbad44c59c6a59",
      "0174c9fe432cb8906d101ee03d1314dcf420bb866fdfcc62210774ca2e836c72",
    ],
    fragment: [
      2928,
      "be76493bce4ebe9ddd00d1387270afebf1ef36ce7e60fb5066259d7e23eabab2",
      "1b60444eb96e78940f50e8e55fb1aef1cfb7c7fd111d5255ed9a8b9e1033bbb8",
    ],
  },
  apkm: {
    apkm: "9b7f9067e00a54f342bd4f17e669ceeb86b80bb7d34ff2d0d0fe82050a62f201",
    base: "815dc606f3b3e3404199fac80abb46b9249948828178a5cbf6aedb3d9e6809de",
    arm64: "7faf449bae431dcfeda4f882ecb04290af66cc4ccfeefc620e24cac70d22fcec",
    libil2cpp: "3e78eedc62770fff4cb129b4b8d898950e131b710b3c099237fe20d2d34ca48e",
    metadata: "bf58e06a98f9e9e05a1635f512ea432d33971bfc8280ba26df1c93e94b4f3cb9",
  },
  methods: {
    calcHomography: [432, "fc1463b7d34a6bd728470522b9c369dd9125dd9c1fe0f7e4885f4422482c55e0"],
    calcInverse: [484, "d88715856fd608cf6c9c1a756851288f592e6bd453cb6d3cb9213d9b6614daa0"],
    getRotatedKeyPoints: [272, "3dd9a748dd530c7e08e05009de0f44730f4d2662d6df1b926d4a1563bc8374e1"],
    cameraWorldToViewportDefault: [8, "d9861b18cda9f066a90c30e6752bb6966be1a110f517b2ed37b9b0d8f228e12e"],
    cameraWorldToViewportInjected: [204, "9ad895db6bb3889c22fcdc312586f7cfd52e6db5700daacd8bca8f990201a86f"],
    setParameters: [132, "6253248b683371c6aa0c8d9fa86defcea562f273a717e8cbf6f658a6b1e57719"],
    constructor: [188, "b014ddafef9f6163ad1840cbdfb96c831989d1632debdf70cc58428609a7d9ac"],
    floatArraySetter: [268, "56db4b6f82676cf10a899d750733e8b9fcdb5c25e833fe775d46b2f7b3dc0842"],
  },
  generated: {
    "homography.vert.glsl": "f3d6ed069d78a21e53a05acd370ac6737dbc658ca4e7c92e0555f3bcd1b62cc1",
    "homography.frag.glsl": "701ed6e5e784a60a24cc69ea47c36612b06e3fe6b2beca454395677a78f74542",
    "homography_program.json": "aa93b2a1e756af19d33f316fbbcb34fa1b340ca018819526b799ba21368c60b3",
  },
};

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

function verifyRaw(record, hashKey = "sha256", sizeKey = "byteSize", hexKey = "rawHex") {
  const bytes = Buffer.from(record[hexKey], "hex");
  assert.equal(bytes.length, record[sizeKey]);
  assert.equal(sha256(bytes), record[hashKey]);
  return bytes;
}

function extract() {
  const args = ["build/extract_official_homography_program.py"];
  if (process.env.PCR_SHADERS) args.push("--shaders", process.env.PCR_SHADERS);
  if (process.env.PCR_APKM) args.push("--apkm", process.env.PCR_APKM);
  const result = spawnSync(PYTHON, args, {
    cwd: ROOT,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || "homography extractor failed").trim());
  }
  return JSON.parse(result.stdout.replace(/^\uFEFF/, ""));
}

function reflect(file) {
  return JSON.parse(execFileSync(SPIRV_CROSS, [file, "--reflect"], { encoding: "utf8" }));
}

function block(reflection, name) {
  const row = (reflection.ubos || []).find((item) => item.name === name);
  assert.ok(row, `${name} reflection is missing`);
  return {
    set: row.set,
    binding: row.binding,
    size: row.block_size,
    members: reflection.types[row.type].members.map((member) => ({
      name: member.name,
      type: member.type,
      offset: member.offset,
      ...(member.array ? { array: member.array } : {}),
      ...(member.array_stride != null ? { stride: member.array_stride } : {}),
    })),
  };
}

function rows(reflection, key) {
  return (reflection[key] || []).map(({ name, type, location, set, binding }) => ({
    name,
    type,
    ...(location != null ? { location } : {}),
    ...(set != null ? { set } : {}),
    ...(binding != null ? { binding } : {}),
  })).sort((a, b) => (a.location ?? a.binding) - (b.location ?? b.binding));
}

let browser;
try {
  const evidence = extract();

  assert.equal(evidence.shader.name, "Lettuce/Common/CardNew/Prerender/Homography(from RT)");
  assert.deepEqual(
    [evidence.source.bundle.byteSize, evidence.source.bundle.sha256],
    EXPECTED.shader.bundle,
  );
  verifyRaw(evidence.source.bundle);
  assert.deepEqual(
    [evidence.source.shaderObject.pathId, evidence.source.shaderObject.byteSize,
      evidence.source.shaderObject.sha256],
    EXPECTED.shader.object,
  );
  verifyRaw(evidence.source.shaderObject);
  assert.equal(evidence.source.shaderSerializedFile, EXPECTED.shader.serializedFile);
  assert.deepEqual(evidence.shader.properties, [{
    name: "_DynamicUITex",
    description: "Main Texture",
    attributes: [],
    type: 4,
    flags: 4,
    defaultValue: [0, 0, 0, 0],
    defaultTexture: { name: "white", dimension: 2 },
  }]);
  assert.deepEqual(evidence.selectedVariant, {
    stageMetadata: "progVertex",
    groupIndex: 3,
    variantIndex: 0,
    keywordIndices: [],
    keywords: [],
    parameterBlobIndex: 0,
    programBlobIndex: 1,
    gpuProgramType: 25,
    shaderRequirements: 1,
  });

  const material = evidence.officialMaterial;
  assert.deepEqual([material.bundle.byteSize, material.bundle.sha256], EXPECTED.material.bundle);
  verifyRaw(material.bundle);
  assert.deepEqual(
    [material.materialObject.pathId, material.materialObject.byteSize, material.materialObject.sha256],
    EXPECTED.material.object,
  );
  verifyRaw(material.materialObject);
  assert.equal(material.name, "PrerenderHomographyCard");
  assert.equal(material.serializedFile, EXPECTED.material.serializedFile);
  assert.deepEqual(material.shaderPPtr, { fileId: 1, pathId: EXPECTED.shader.object[0] });
  assert.equal(material.shaderExternal.name, EXPECTED.shader.serializedFile);
  assert.deepEqual(material.dynamicUITexture, {
    fileId: 0, pathId: "0", scale: [1, 1], offset: [0, 0],
  });
  assert.deepEqual(material.validKeywords, []);
  assert.deepEqual(material.invalidKeywords, []);
  assert.equal(material.customRenderQueue, -1);

  assert.deepEqual(
    [evidence.programBlock.compressed.byteSize, evidence.programBlock.compressed.sha256],
    EXPECTED.program.compressed,
  );
  verifyRaw(evidence.programBlock.compressed);
  assert.deepEqual(
    [evidence.programBlock.decompressed.byteSize, evidence.programBlock.decompressed.sha256],
    EXPECTED.program.decompressed,
  );
  verifyRaw(evidence.programBlock.decompressed);
  assert.deepEqual(
    evidence.programBlock.entries.map((entry) => [entry.length, entry.sha256]),
    [EXPECTED.program.parameter, EXPECTED.program.program],
  );
  for (const entry of evidence.programBlock.entries) verifyRaw(entry, "sha256", "length");

  const common = evidence.bindings.common;
  assert.deepEqual(common.textures, [{
    name: "_DynamicUITex",
    stageMetadata: "progVertex",
    binding: 0,
    encodedIndex: 134217728,
    samplerIndex: -1,
    dimension: 2,
    multisampled: false,
  }]);
  assert.deepEqual(common.constantBuffers, [
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
  ]);
  assert.deepEqual(common.constantBufferBindings, [
    { name: "PGlobals445077468", stageMetadata: "progVertex", encodedIndex: 134283264, arraySize: 1 },
    { name: "VGlobals445077468", stageMetadata: "progVertex", encodedIndex: 67174401, arraySize: 1 },
  ]);
  assert.deepEqual(evidence.bindings.parameterEntry, {
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
  });

  const state = evidence.shader.pass.renderState;
  const defaultTarget = {
    srcColor: { value: 1, property: null },
    dstColor: { value: 0, property: null },
    srcAlpha: { value: 1, property: null },
    dstAlpha: { value: 0, property: null },
    colorOp: { value: 0, property: null },
    alphaOp: { value: 0, property: null },
    colorMask: { value: 15, property: null },
  };
  assert.equal(state.blend.separate, false);
  assert.deepEqual(state.blend.targets[0], {
    srcColor: { value: 1, property: null },
    dstColor: { value: 10, property: null },
    srcAlpha: { value: 0, property: null },
    dstAlpha: { value: 10, property: null },
    colorOp: { value: 0, property: null },
    alphaOp: { value: 0, property: null },
    colorMask: { value: 15, property: null },
  });
  assert.deepEqual(state.blend.targets.slice(1), Array.from({ length: 7 }, () => defaultTarget));
  assert.deepEqual(state.depth, {
    test: { value: 4, property: null },
    write: { value: 0, property: null },
    clip: { value: 1, property: null },
  });
  assert.deepEqual(state.cull, { value: 2, property: null });
  assert.deepEqual(state.stencil, {
    reference: { value: 0, property: null },
    readMask: { value: 255, property: null },
    writeMask: { value: 255, property: null },
    compare: { value: 8, property: null },
    pass: { value: 0, property: null },
    fail: { value: 0, property: null },
    depthFail: { value: 0, property: null },
  });
  assert.deepEqual(state.alphaToMask, { value: 0, property: null });

  const apkm = evidence.apkm.source;
  assert.equal(apkm.apkmSha256, EXPECTED.apkm.apkm);
  assert.equal(apkm.baseApkSha256, EXPECTED.apkm.base);
  assert.equal(apkm.arm64SplitSha256, EXPECTED.apkm.arm64);
  assert.equal(apkm.libil2cppSha256, EXPECTED.apkm.libil2cpp);
  assert.equal(apkm.metadata.plaintextSha256, EXPECTED.apkm.metadata);
  assert.deepEqual(
    Object.fromEntries(Object.entries(evidence.apkm.propertyLiterals).map(([key, item]) => [key, item.value])),
    {
      dynamicUITexture: "_DynamicUITex",
      homography: "_HomographyMatrix",
      inverseHomography: "_InvHomographyMatrix",
    },
  );
  for (const item of Object.values(evidence.apkm.propertyLiterals)) {
    const relocation = Buffer.from(item.relocation.bytesHex, "hex");
    assert.equal(sha256(relocation), item.relocation.sha256);
    const literal = Buffer.from(item.metadataLiteral.utf8BytesHex, "hex");
    assert.equal(sha256(literal), item.metadataLiteral.utf8Sha256);
    assert.equal(literal.toString("utf8"), item.value);
  }
  assert.deepEqual(evidence.apkm.uploadContract, {
    homographyLength: 9,
    inverseHomographyLength: 9,
    homographyPropertyIdFieldOffset: 112,
    inverseHomographyPropertyIdFieldOffset: 116,
    homographyProducerRva: "0x43987ec",
    inverseProducerRva: "0x4398aac",
    floatArraySetterRva: "0x442cac4",
  });
  for (const [key, method] of Object.entries(evidence.apkm.methods)) {
    const [size, hash] = EXPECTED.methods[key];
    const bytes = verifyRaw(method);
    assert.equal(bytes.length, size);
    assert.equal(method.sha256, hash);
    for (const instruction of method.selectedInstructions) {
      assert.equal(sha256(Buffer.from(instruction.bytesHex, "hex")), instruction.sha256);
    }
  }
  assert.deepEqual(
    evidence.apkm.methods.calcHomography.selectedInstructions.map((item) => item.text),
    ["bl #0x439899c", "mov w1, #9", "str w8, [x0, #0x40]"],
  );
  assert.deepEqual(
    evidence.apkm.methods.calcInverse.selectedInstructions.map((item) => item.text),
    ["mov w1, #9", "bl #0x2f8d4a0", "str s0, [x0, #0x40]"],
  );
  assert.deepEqual(
    evidence.apkm.methods.getRotatedKeyPoints.selectedInstructions.map((item) => item.text),
    Array(4).fill("bl #0x64ddce0"),
  );
  assert.deepEqual(
    evidence.apkm.methods.cameraWorldToViewportDefault.selectedInstructions.map((item) => item.text),
    ["mov w1, #2", "b #0x64dda74"],
  );
  assert.deepEqual(evidence.apkm.coordinateContract, {
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
  });
  assert.deepEqual(
    evidence.apkm.methods.setParameters.selectedInstructions.map((item) => item.text),
    [
      "bl #0x43987ec", "bl #0x4398aac", "ldr w1, [x19, #0x70]",
      "bl #0x442cac4", "ldr w1, [x19, #0x74]", "b #0x442cac4",
    ],
  );
  assert.deepEqual(
    evidence.apkm.methods.constructor.selectedInstructions.map((item) => item.text),
    [
      "ldr x21, [x21, #0x7d0]", "ldr x20, [x20, #0x7d8]", "bl #0x64ebcbc",
      "str w0, [x19, #0x70]", "bl #0x64ebcbc", "str w8, [x19, #0x74]",
    ],
  );

  const reflectionByStage = {};
  const officialGlsl = {};
  for (const stage of ["vertex", "fragment"]) {
    const module = evidence.modules.find((item) => item.stage === stage);
    assert.ok(module, `${stage} module is missing`);
    const bytes = Buffer.from(module.spvHex, "hex");
    const [size, hash, reflectionHash] = EXPECTED.modules[stage];
    assert.equal(bytes.length, size);
    assert.equal(sha256(bytes), hash);
    const file = path.join(tmp, `${stage}.spv`);
    fs.writeFileSync(file, bytes);
    const reflected = reflect(file);
    reflectionByStage[stage] = reflected;
    assert.equal(sha256(JSON.stringify(stable(reflected))), reflectionHash);
    officialGlsl[stage] = execFileSync(
      SPIRV_CROSS,
      [file, "--version", "300", "--es"],
      { encoding: "utf8" },
    ).replace(/\r\n/g, "\n");
  }
  assert.deepEqual(block(reflectionByStage.fragment, "_19_21"), {
    set: 1,
    binding: 0,
    size: 144,
    members: [{ name: "_m0", type: "float", offset: 0, array: [9], stride: 16 }],
  });
  assert.deepEqual(block(reflectionByStage.vertex, "_23_25"), {
    set: 1,
    binding: 1,
    size: 272,
    members: [
      { name: "_m0", type: "vec4", offset: 0, array: [4], stride: 16 },
      { name: "_m1", type: "vec4", offset: 64, array: [4], stride: 16 },
      { name: "_m2", type: "float", offset: 128, array: [9], stride: 16 },
    ],
  });
  assert.deepEqual(rows(reflectionByStage.fragment, "textures"), [
    { name: "_97", type: "sampler2D", set: 0, binding: 0 },
  ]);
  assert.deepEqual(rows(reflectionByStage.vertex, "inputs"), [
    { name: "_12", type: "vec2", location: 0 },
  ]);
  assert.deepEqual(rows(reflectionByStage.vertex, "outputs"), [
    { name: "vs_TEXCOORD0", type: "vec2", location: 0 },
    { name: "vs_TEXCOORD1", type: "vec4", location: 1 },
  ]);
  assert.deepEqual(rows(reflectionByStage.fragment, "outputs"), [
    { name: "_109", type: "vec4", location: 0 },
    { name: "_118", type: "vec4", location: 1 },
  ]);
  assert.match(officialGlsl.vertex, /float _m2\[9\];/);
  assert.match(officialGlsl.fragment, /highp float _m0\[9\];/);
  assert.match(officialGlsl.fragment, /_93 = texture\(_97, _63\);/);
  assert.match(officialGlsl.fragment, /_101 = \(-_93\.w\) \+ 1\.0;/);
  assert.match(officialGlsl.fragment, /_109\.w = _101;/);
  assert.match(officialGlsl.fragment, /_118 = vec4\(0\.0\);/);

  const shaderDir = path.join(ROOT, "public", "shaders");
  for (const [name, hash] of Object.entries(EXPECTED.generated)) {
    assert.equal(sha256(fs.readFileSync(path.join(shaderDir, name))), hash, `${name} drifted`);
  }
  const vertex = fs.readFileSync(path.join(shaderDir, "homography.vert.glsl"), "utf8");
  const fragment = fs.readFileSync(path.join(shaderDir, "homography.frag.glsl"), "utf8");
  assert.match(vertex, /uniform highp float _InvHomographyMatrix\[9\];/);
  assert.match(vertex, /layout\(location = 0\) in vec2 uv;/);
  assert.match(vertex, /vec2 _12 = uv;/);
  assert.doesNotMatch(vertex, /in vec3 position|vec2 _12 = position\.xy/);
  assert.match(fragment, /uniform highp float _HomographyMatrix\[9\];/);
  assert.match(fragment, /sampled = texture\(_DynamicUITex, _63\);/);
  assert.match(fragment, /inverseAlpha = \(-sampled\.w\) \+ 1\.0;/);
  assert.match(fragment, /outColor\.w = inverseAlpha;/);
  assert.match(fragment, /outAux = vec4\(0\.0\);/);
  assert.doesNotMatch(vertex, /layout\(std140\)|gl_Position\.y\s*=\s*-gl_Position\.y/);
  assert.doesNotMatch(fragment, /layout\(std140\)/);

  const manifest = JSON.parse(fs.readFileSync(path.join(shaderDir, "homography_program.json"), "utf8"));
  assert.deepEqual(manifest.evidence_scope, [
    "APKM", "serialized Shader", "serialized Material", "serialized PrerenderCard", "built-in Quad", "SPIR-V", "libil2cpp",
  ]);
  assert.equal(
    manifest.apkm_source.unity_default_resources_sha256,
    "a9a74ab363888de3ea14ef01e780f851a395d4c6f5d5bcebad74a2a3e4785d16",
  );
  assert.deepEqual(manifest.bindings.dynamic_ui_texture, {
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
  });
  assert.deepEqual(manifest.bindings.homography, {
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
  });
  assert.deepEqual(manifest.bindings.inverse_homography, {
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
  });
  assert.deepEqual(manifest.bindings.vertex_attribute, {
    official: "_12",
    location: 0,
    type: "vec2",
    webgl2: "uv",
    source_mesh: "unity default resources/Quad PathID 10210",
    source_position_range: [[-0.5, -0.5], [0.5, 0.5]],
    source_uv0_range: [[0, 0], [1, 1]],
    official_indices: [0, 3, 1, 3, 0, 2],
    webgl2_indices: [0, 1, 3, 3, 2, 0],
    winding_adaptation: "reverse each Unity triangle for left-handed to right-handed mesh conversion",
  });
  assert.deepEqual(manifest.fragment_contract, {
    sample_coordinates: "H * vHomographyUv, homogeneous divide by row 2",
    rgb: "sampled.rgb",
    alpha: "1.0 - sampled.a",
    secondary_output: "vec4(0.0)",
  });
  assert.deepEqual(manifest.runtime_upload.keypoint_coordinates, {
    space: "UnityEngine.Camera.WorldToViewportPoint",
    projected_point_count: 4,
    default_stereo_eye_argument: 2,
    native_icall: "UnityEngine.Camera::WorldToViewportPoint_Injected",
    native_icall_sha256: "06bce24701b9aea3bb254d19b130bb43ad48f4b4f9573fb4b778e9e9f2e97eea",
    projected_point_order: [
      { index: 0, field: "_keyPointLeftDown", instance_offset: 56, array_data_offset: 32 },
      { index: 1, field: "_keyPointRightDown", instance_offset: 64, array_data_offset: 40 },
      { index: 2, field: "_keyPointLeftUp", instance_offset: 72, array_data_offset: 48 },
      { index: 3, field: "_keyPointRightUp", instance_offset: 80, array_data_offset: 56 },
    ],
  });
  assert.deepEqual(manifest.render_state, state);
  assert.deepEqual(manifest.webgl2_adaptation, [
    "remove the SPIRV-Cross #version directive for host-side WebGL2 version injection",
    "add explicit highp float and int precision declarations to the vertex stage",
    "flatten the official std140 H and Hinv float[9] arrays into named WebGL2 uniform arrays",
    "map unity_ObjectToWorld and unity_MatrixVP to modelMatrix and projectionMatrix * viewMatrix",
    "map the official location-0 vec2 input to the PrerenderCard built-in Quad UV0 attribute",
    "combine the official image and sampler as _DynamicUITex",
    "remove the Vulkan clip-space Y flip",
    "rename stage interface symbols and temporaries without changing shader math",
  ]);
  assert.deepEqual(manifest.not_established, [
    "physical RenderTexture Y-coordinate convention",
    "runtime wiring into public/app.js",
  ]);

  execFileSync(process.execPath, ["build/build-exact-homography.mjs", "--check"], {
    cwd: ROOT,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  browser = await chromium.launch({
    args: ["--enable-unsafe-swiftshader", "--use-gl=angle", "--use-angle=swiftshader", "--ignore-gpu-blocklist"],
  });
  const page = await browser.newPage();
  const linked = await page.evaluate(({ vertexSource, fragmentSource }) => {
    const gl = document.createElement("canvas").getContext("webgl2");
    if (!gl) throw new Error("WebGL2 is unavailable");
    const compile = (type, source) => {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, `#version 300 es\n${source}`);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        throw new Error(gl.getShaderInfoLog(shader));
      }
      return shader;
    };
    const program = gl.createProgram();
    gl.attachShader(program, compile(gl.VERTEX_SHADER, vertexSource));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragmentSource));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(program));
    }
    const names = [
      "modelMatrix", "viewMatrix", "projectionMatrix", "_InvHomographyMatrix[0]",
      "_HomographyMatrix[0]", "_DynamicUITex",
    ];
    return {
      maxDrawBuffers: gl.getParameter(gl.MAX_DRAW_BUFFERS),
      uniforms: names.map((name) => ({ name, active: gl.getUniformLocation(program, name) !== null })),
    };
  }, { vertexSource: vertex, fragmentSource: fragment });
  assert.ok(linked.maxDrawBuffers >= 2);
  assert.deepEqual(linked.uniforms, [
    { name: "modelMatrix", active: true },
    { name: "viewMatrix", active: true },
    { name: "projectionMatrix", active: true },
    { name: "_InvHomographyMatrix[0]", active: true },
    { name: "_HomographyMatrix[0]", active: true },
    { name: "_DynamicUITex", active: true },
  ]);

  console.log("Official Prerender Homography audit OK");
  console.log("Bindings: H/Hinv float[9], _DynamicUITex, matrices, vertex input, and MRT are pinned");
  console.log("State/math: serialized blend/cull/depth and alpha = 1 - sampled.a are pinned");
  console.log("Runtime evidence: APKM/libil2cpp producers, property IDs, and float-array uploads are pinned");
  console.log("Coordinates: four keypoints call Camera.WorldToViewportPoint_Injected through the default wrapper");
  console.log("WebGL2: deterministic generation plus SwiftShader compile/link passed without screenshots");
} finally {
  await browser?.close();
  fs.rmSync(tmp, { recursive: true, force: true });
}
