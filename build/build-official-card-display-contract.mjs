// Compile the official card-display facts into one runtime-readable contract.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PYTHON = process.env.PYTHON || "python";
const OUT = path.join(ROOT, "public", "render", "card-display-contract.json");
const CHECK = process.argv.includes("--check") || process.env.PCR_EXACT_CHECK === "1";
const APKM_SHA256 = "9b7f9067e00a54f342bd4f17e669ceeb86b80bb7d34ff2d0d0fe82050a62f201";
const SPIRV_CROSS = process.env.SPIRV_CROSS || "spirv-cross";
const OFFICIAL_BINARY_HASHES = {
  apkm_sha256: APKM_SHA256,
  base_apk_sha256: "815dc606f3b3e3404199fac80abb46b9249948828178a5cbf6aedb3d9e6809de",
  arm64_split_sha256: "7faf449bae431dcfeda4f882ecb04290af66cc4ccfeefc620e24cac70d22fcec",
  globalgamemanagers_sha256: "5a1ca51ec16b267710479b85e33bfe150c4aab255e9716fd33d51ce7a33ea017",
  libunity_sha256: "43a04223f94b6ca0c7cf128b399fe0656c57b5a18a10bf21bb9ce27aeb219722",
  libil2cpp_sha256: "3e78eedc62770fff4cb129b4b8d898950e131b710b3c099237fe20d2d34ca48e",
};
const RENDER_TEXTURE_NATIVE_WINDOW_HASHES = {
  legacyRenderTextureFormatToGraphicsFormat: "6a3a423ed98b255de65f2124f980ae8c0a11ebec071e277f0464c95d85185088",
  compatibleFormatSearch: "5e338b045ac0c006635937c433c7d6583e552b54028a8e2ecea3f6f1213f1674",
  depthBitsLegacy: "eb863f8cc72d57b997057470a00ab7c8d0978ad369b0453c1be7b131b306310f",
  activeColorSpaceLegacyMapping: "3de21f15ee29a37fdae1300889ade6cdbea3147914fec601e5a737cdb2525e9e",
  systemInfoCompatibleFormat: "aa17d843f3cb0776a6fa8bfbe3d6e1f98b6f69838eb59d2aa554736f13bc4489",
  deviceCompatibleFormat: "a2acac7b37e1b987ab91aa0d48afbe568a312355370abf6111654808ed03c6c9",
  deviceFormatCapabilityLookup: "ede1863f239d0e1f08320b3cc875e4111e8b2b44feb2902064a909958536b7e8",
  defaultFormatLookup: "e7e5941e5392176cff14c9c21463a690850fee0201e27467917414330444902f",
  vulkanFormatDescriptorLookup: "ffe8156b138dea274bd6a1f56771810a317d6a4426289f2847ed4f9047d14783",
  vulkanCapabilityTableAndDepthDefault: "a5d93492be6dbbda0104f94f594b7e7eb93ecf629cabfd7c058396bf796ef49d",
  graphicsUvStartsAtTop: "c317bdfcddcbbc0c320c9f1675e9156a748be88f92632b55353965bb33061aa0",
  vulkanUvOriginInitialization: "960a952aa4abef2fa13d3a6c28c521bfd8d0178e4bf9a685797f76f01554d540",
  vulkanViewportProcLoad: "25951ad591319728c9e9bbe6dba74e07928421bf3fe2331962846f3202fdb711",
  vulkanPipelineCacheHeader: "adca1220e3b3a8cb424c68e3cdaf2b9cd2ecdded0f0f67fd3657941f357c8679",
};

function extract(script) {
  const result = spawnSync(PYTHON, [path.join("build", script)], {
    cwd: ROOT,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    shell: process.platform === "win32",
    windowsHide: true,
  });
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || `${script} failed`).trim());
  }
  return JSON.parse(result.stdout.replace(/^\uFEFF/, ""));
}

function decompileSpirvModule(evidence, stage) {
  const module = evidence.shaderProgram.pass.modules.find((item) => item.stage === stage);
  assert.ok(module, `official FinalBlit ${stage} module is missing`);
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "pcr-rendertexture-contract-"));
  const modulePath = path.join(temporaryDirectory, `final-blit.${stage}.spv`);
  try {
    fs.writeFileSync(modulePath, Buffer.from(module.spvHex, "hex"));
    const result = spawnSync(SPIRV_CROSS, [modulePath, "--version", "300", "--es"], {
      cwd: ROOT,
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024,
      windowsHide: true,
    });
    if (result.status !== 0) {
      throw new Error((result.stderr || result.stdout || `SPIR-V ${stage} decompile failed`).trim());
    }
    return { module, source: result.stdout.replace(/\r\n/g, "\n") };
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

const cameraEvidence = extract("extract_official_camera_transform.py");
const rendererEvidence = extract("extract_official_card_renderer.py");
const displayEvidence = extract("extract_official-card-display.py");
const wiringEvidence = extract("extract_official-homography-wiring.py");
const homographyEvidence = extract("extract_official_homography_program.py");
const renderTextureEvidence = extract("extract_official_rendertexture_contract.py");
const finalBlitEvidence = extract("extract_official_final_blit.py");

assert.equal(cameraEvidence.source.apkmSha256, APKM_SHA256);
assert.equal(rendererEvidence.source.apkm.sha256, APKM_SHA256);
assert.equal(displayEvidence.source.apkm.sha256, APKM_SHA256);
assert.equal(wiringEvidence.source.apkm.sha256, APKM_SHA256);
assert.equal(homographyEvidence.apkm.source.apkmSha256, APKM_SHA256);
assert.deepEqual({
  apkm_sha256: renderTextureEvidence.source.apkmSha256,
  base_apk_sha256: renderTextureEvidence.source.baseApkSha256,
  arm64_split_sha256: renderTextureEvidence.source.arm64SplitSha256,
  globalgamemanagers_sha256: renderTextureEvidence.source.globalgamemanagersSha256,
  libunity_sha256: renderTextureEvidence.source.libunitySha256,
  libil2cpp_sha256: renderTextureEvidence.source.libil2cppSha256,
}, OFFICIAL_BINARY_HASHES);
assert.equal(finalBlitEvidence.source.apkmSha256, APKM_SHA256);

const camera = cameraEvidence.official.camera;
const parentFace = cameraEvidence.official.parentFace;
const layer = cameraEvidence.official.layer;
const hierarchy = Object.fromEntries(
  camera.serializedPrefab.hierarchy.map((item) => [item.gameObject, item]),
);
const detail = rendererEvidence.derived.detailView;
const renderTexture = rendererEvidence.native.renderTexture;
const quality = rendererEvidence.native.quality;
const renderOneShot = rendererEvidence.native.renderOneShot;
const homographyConsumer = rendererEvidence.homography.consumer;
const clearColor = displayEvidence.serialized.modelRenderStudio.camera.clearColor;
const alpha = displayEvidence.prefabRt0Alpha;

assert.equal(camera.status, "proved");
assert.equal(detail.defaultSourceRenderTexture.width, detail.defaultSourceRenderTexture.height);
assert.equal(renderTexture.square, true);
assert.equal(renderTexture.formula, "roundToEven(pixelHeight / VerticalPercentageInRT * UICardQuality)");
assert.equal(clearColor.sha256, "7ab8f6c26e4f9862c95a18c8e5c50403eeb64d8869fbbf9a7a6397d9a63b7b0e");
assert.equal(alpha.status, "proved-for-four-pinned-official-prefabs");
assert.equal(alpha.summary.materialReferences, 98);
assert.deepEqual(alpha.summary.rt0AlphaCounts, {
  "clear-to-zero": 31,
  "multiply-by-1-srcA": 36,
  preserve: 31,
});
assert.deepEqual(wiringEvidence.notEstablished, [{
  id: "native-render-texture-physical-y",
  status: "unproved",
  claim: "native RenderTexture physical Y origin/orientation",
}]);
assert.deepEqual(rendererEvidence.unproved, [
  "native RenderTexture physical Y origin",
  "runtime producer and SetTexture assignment path for _DynamicUITex",
  "producer-side alpha convention and end-to-end alpha contract",
  "actual persisted quality selected on a runtime device",
]);

const ordinaryAndroid = quality.defaults.ordinaryAndroid;
const ordinaryQuality = quality.byEnum[String(ordinaryAndroid.qualityEnum)];
const sourceTargetsByQuality = detail.sourceRenderTexturesByQuality;
assert.deepEqual(ordinaryAndroid, {
  qualityEnum: 1,
  qualityName: "Middle",
  fpsEnum: 0,
  fps: 60,
});
assert.deepEqual(ordinaryQuality, {
  name: "Middle",
  factor: 0.800000011920929,
  constant: {
    rva: "0x1af8e54",
    byteSize: 4,
    sha256: "030a1a64b337c633d995221728d15e8b0d086cc0dcf4557205111b089b04464d",
    rawHex: "cdcc4c3f",
  },
});
assert.equal(detail.defaultAndroidQuality, ordinaryQuality.name);
assert.equal(detail.defaultAndroidQualityFactor, ordinaryQuality.factor);
assert.deepEqual(
  Object.fromEntries(Object.entries(sourceTargetsByQuality).map(([name, target]) => [name, target.side])),
  { High: 1403, Middle: 1122, Low: 982 },
);
assert.equal(quality.persistedOverride.provedCapable, true);
assert.deepEqual(quality.persistedOverride, {
  provedCapable: true,
  updateDefaultTarget: "0x47446ac",
  getIntTarget: "0x473e144",
  setIntTarget: "0x473e128",
  saveTarget: "0x473e500",
});

// These are constructor request arguments. The extractor does not establish
// the compatible physical GPU color/depth formats selected by Unity.
assert.deepEqual(renderTexture.underlying, {
  methodRva: "0x4396050",
  widthArgument: "w1",
  heightArgument: "w2",
  depthBits: 24,
  renderTextureFormatEnum: 0,
  renderTextureFormat: "ARGB32",
  antiAliasingSetterRva: "0x650c73c",
  antiAliasingSetterCalled: false,
  antiAliasing: 1,
});

const renderTextureNative = renderTextureEvidence.native;
const renderTextureInstructions = renderTextureNative.selectedInstructions;
const nativeInstruction = (address, expected) => {
  assert.equal(renderTextureInstructions[address], expected, `libunity RenderTexture instruction ${address}`);
};

assert.equal(renderTextureEvidence.source.unityVersion, "2022.3.62f2_7670c08855a9");
assert.deepEqual(renderTextureEvidence.playerSettings, {
  graphicsAPIs: [21],
  activeColorSpace: 0,
  disableDepthAndStencilBuffers: false,
  vulkanEnableSetSRGBWrite: false,
  vulkanEnablePreTransform: false,
});
assert.deepEqual(renderTextureEvidence.elf, {
  class: 64,
  endianness: "little",
  type: 3,
  machine: 183,
  virtualAddressMapping: "PT_LOAD file-backed range",
  loadSegments: [
    { offset: "0x0", virtualAddress: "0x0", fileSize: "0x3ab84c", memorySize: "0x3ab84c", flags: 4 },
    { offset: "0x3ab850", virtualAddress: "0x3af850", fileSize: "0xdd8ed0", memorySize: "0xdd8ed0", flags: 5 },
    { offset: "0x1184720", virtualAddress: "0x118c720", fileSize: "0x44a70", memorySize: "0x44a70", flags: 6 },
    { offset: "0x11c9190", virtualAddress: "0x11d5190", fileSize: "0x18dd0", memorySize: "0x103820", flags: 6 },
  ],
});
assert.deepEqual(
  Object.fromEntries(Object.entries(renderTextureNative.windows).map(([name, window]) => [name, window.sha256])),
  RENDER_TEXTURE_NATIVE_WINDOW_HASHES,
);

assert.deepEqual(renderTextureEvidence.color, {
  legacyRenderTextureFormat: { value: 0, name: "ARGB32" },
  legacyTableRva: "0x176430",
  linearOrGammaGraphicsFormat: 8,
  srgbGraphicsFormat: 4,
  activeColorSpace: 0,
  requestedGraphicsFormat: 8,
  vulkan: {
    tableRva: "0x11de2c8",
    gf4: { graphicsFormat: 4, vkFormat: 43, descriptorWords: [43, 37, 0, 0] },
    gf8: { graphicsFormat: 8, vkFormat: 37, descriptorWords: [37, 37, 1, 0] },
  },
});
assert.deepEqual(renderTextureEvidence.depth, {
  requestedBits: 24,
  defaultFormat: { value: 2, name: "DepthStencil" },
  preferredGraphicsFormat: { value: 92, name: "D24_UNorm_S8_UInt" },
  formatUsage: { value: 4, name: "Render" },
  preserveCompatibleFormat: true,
  vulkan: {
    gf92: { graphicsFormat: 92, vkFormat: 129, descriptorWords: [129, 129, 0, 0] },
    gf94: { graphicsFormat: 94, vkFormat: 130, descriptorWords: [130, 130, 0, 0] },
  },
});
assert.deepEqual(renderTextureEvidence.y, {
  unityGraphicsUvStartsAtTop: true,
  vulkanDeviceFlagOffset: "0xe0",
  vulkanDeviceFlagInitializedValue: 0,
  vkCmdSetViewport: { procNameRva: "0x1045d9", globalSlotRva: "0x1290760" },
});
assert.deepEqual(renderTextureEvidence.pipelineCache, {
  shippedInApks: false,
  runtimePath: "/vulkan_pso_cache.bin",
  runtimePathFileOffset: "0x15a71d",
  headerCompatibilityFields: ["version", "vendorId", "deviceId", "pipelineCacheUUID"],
});

// Pin the branches that turn the serialized request into a device capability query.
nativeInstruction("0x5183e0", "bl #0xa4b22c");
nativeInstruction("0x5183e4", "cmp w0, #1");
nativeInstruction("0x5183fc", "b #0xa7c004");
nativeInstruction("0xa7c048", "adrp x9, #0x176000");
nativeInstruction("0xa7c04c", "add x9, x9, #0x430");
nativeInstruction("0x5c12d0", "b #0x5bf024");
nativeInstruction("0x5bf044", "bl #0x5c11ec");
nativeInstruction("0x5bf07c", "b #0xa7c0d0");
nativeInstruction("0x5befd4", "ldr w8, [x8, #0x160]");
nativeInstruction("0xb02628", "cmp x25, #0x98");
nativeInstruction("0xb0262c", "str w8, [x9, #0x160]");
nativeInstruction("0xb026b0", "bl #0xaf2d98");
nativeInstruction("0xb026d0", "blr x8");
nativeInstruction("0xb02884", "mov w0, #0x5c");
nativeInstruction("0xb02888", "mov w1, #4");
nativeInstruction("0xb0288c", "mov w2, #1");
nativeInstruction("0xb02890", "bl #0xa7c0d0");
nativeInstruction("0xb02898", "str w0, [x20, #0x3c8]");
nativeInstruction("0xa7c2a4", "cmp w0, #0x18");
nativeInstruction("0xa7c2e0", "mov w1, #2");
nativeInstruction("0xa7c2e4", "mov w2, #3");
nativeInstruction("0xa7c2ec", "b #0x5bf478");
nativeInstruction("0xaf2d98", "adrp x8, #0x11de000");
nativeInstruction("0xaf2d9c", "add x8, x8, #0x2c8");
nativeInstruction("0xb021e0", "strb wzr, [x20, #0xe0]");
nativeInstruction("0x5c0fb8", "ldrb w8, [x0, #0xe0]");
nativeInstruction("0x5c0fc0", "cset w0, eq");
nativeInstruction("0xae8b7c", "add x1, x1, #0x5d9");
nativeInstruction("0xae8b88", "str x0, [x24, #0x760]");

const finalBlitVertex = decompileSpirvModule(finalBlitEvidence, "vertex");
assert.equal(finalBlitVertex.module.sha256, "a95fea7dba0fd2f084b7e1e9e9be33e13464b26ed50710a18049b7b096333c63");
const finalBlitClipSpaceYFlip = /gl_Position\.y\s*=\s*-gl_Position\.y\s*;/.test(finalBlitVertex.source);
const finalBlitRenderTargetUvOneMinusY = /\.[xyz]\s*=\s*\(-[^;]+\.y\)\s*\+\s*1\.0\s*;/.test(finalBlitVertex.source);
assert.equal(finalBlitClipSpaceYFlip, true);
assert.equal(finalBlitRenderTargetUvOneMinusY, true);

// Pin the official no-texture-flip path separately from Vulkan clip-space Y.
assert.deepEqual(homographyConsumer, {
  fragmentSamplesDirectUvWithoutOneMinusY: true,
  fragmentHasNoTextureST: true,
  vertexHasVulkanClipYFlip: true,
  consumerAlphaFormula: "1.0 - sampled.a",
});
assert.equal(renderOneShot.hasManagedBlitOrFlip, false);
assert.deepEqual(renderOneShot.managedGraphicsBlitTargetsPresent, []);
const textureUvYFlip = !homographyConsumer.fragmentSamplesDirectUvWithoutOneMinusY;

const homographyNative = homographyEvidence.apkm;
const { projectedPointOrder: nativeProjectedPointOrder, ...coordinateContract } =
  homographyNative.coordinateContract;
assert.deepEqual(coordinateContract, {
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
});
assert.equal(
  homographyNative.methods.getRotatedKeyPoints.sha256,
  "3dd9a748dd530c7e08e05009de0f44730f4d2662d6df1b926d4a1563bc8374e1",
);
assert.deepEqual(
  homographyNative.methods.getRotatedKeyPoints.selectedInstructions.map(({ address, text }) => ({ address, text })),
  [
    { address: "0x43989cc", text: "bl #0x64ddce0" },
    { address: "0x4398a04", text: "bl #0x64ddce0" },
    { address: "0x4398a40", text: "bl #0x64ddce0" },
    { address: "0x4398a7c", text: "bl #0x64ddce0" },
  ],
);

const keyPointRoot = hierarchy.KeyPoints;
assert.ok(keyPointRoot, "KeyPoints is missing from official ModelRenderStudio hierarchy");
const serializedKeyPoints = camera.serializedPrefab.hierarchy.filter(
  (item) => item.parentTransformPathId === keyPointRoot.transformPathId,
);
assert.deepEqual(
  serializedKeyPoints.map((item) => ({ name: item.gameObject, localPosition: item.localPosition })),
  [
    { name: "LeftDown", localPosition: [0.6029999852180481, -0.6029999852180481, 0] },
    { name: "LeftUp", localPosition: [0.6029999852180481, 0.6029999852180481, 0] },
    { name: "RightDown", localPosition: [-0.6029999852180481, -0.6029999852180481, 0] },
    { name: "RightUp", localPosition: [-0.6029999852180481, 0.6029999852180481, 0] },
  ],
);
assert.equal(serializedKeyPoints.length, homographyNative.coordinateContract.projectedPointCount);
const keyPointByName = Object.fromEntries(
  serializedKeyPoints.map((item) => [item.gameObject, item]),
);
const keyPointOrder = nativeProjectedPointOrder.map((item) => item.field.replace(/^_keyPoint/, ""));
assert.deepEqual(keyPointOrder, ["LeftDown", "RightDown", "LeftUp", "RightUp"]);
const keyPoints = nativeProjectedPointOrder.map((item) => {
  const name = item.field.replace(/^_keyPoint/, "");
  const point = keyPointByName[name];
  assert.ok(point, `${item.field} has no serialized keypoint Transform`);
  return {
    name,
    field: item.field,
    projected_array_index: item.index,
    instance_offset: item.instanceOffset,
    array_data_offset: item.arrayDataOffset,
    local_position: point.localPosition,
  };
});

const wiring = wiringEvidence.derived.runtimeWiring;
assert.equal(
  wiring[0],
  "ModelCardView.<Initialize>d__33.MoveNext reads _clampParallax at ModelCardView+0x28",
);
assert.equal(
  wiring[1],
  "true selects CardPaths.get_PrerenderHomographyCardMaterial; false selects CardPaths.get_PrerenderCardMaterial",
);
assert.equal(
  wiring[9],
  "DynamicShaderPropertyType.DynamicUI is serialized metadata enum value 0, jump-table case 0, and the case-0 static property ID is initialized from Shader.PropertyToID(\"_DynamicUITex\")",
);
const clampField = wiringEvidence.metadata.types.modelCardView.selectedFields.clampParallax;
assert.equal(clampField.name, "_clampParallax");
assert.equal(wiringEvidence.native.fieldOffsets["ModelCardView._clampParallax"], "0x28");
const detailView = wiringEvidence.serialized.detailViewPrefab;
assert.equal(
  detailView.relativePath,
  "Common/CardNew/System/Prefabs/L_Card_Base_Pokemon_RS.prefab_bundles",
);
assert.deepEqual(
  [
    detailView.modelCardView.cardSize.value,
    detailView.modelCardView.clampParallax.value,
    detailView.modelCardView.alwaysDetailEffect.value,
  ],
  [3, 1, 0],
);
const dynamicProperty = wiringEvidence.native.propertyLiterals.dynamicUI;
assert.equal(dynamicProperty.value, "_DynamicUITex");
assert.equal(wiringEvidence.metadata.dynamicShaderPropertyTypeDynamicUI.default.value, 0);
assert.equal(wiringEvidence.serialized.prefab.dynamicUI.dynamicPropertyType.value, 0);
assert.equal(wiringEvidence.serialized.prefab.dynamicUI.dynamicUIType.value, 0);
const plainDisplayMaterial = wiringEvidence.serialized.plainMaterial.name;
const homographyDisplayMaterial = wiringEvidence.serialized.homographyMaterial.name;
assert.equal(plainDisplayMaterial, "PrerenderCard");
assert.equal(homographyDisplayMaterial, "PrerenderHomographyCard");

const contract = {
  schema_version: 5,
  generated_by: "build/build-official-card-display-contract.mjs",
  official_source: {
    version: "1.6.0",
    apkm_sha256: APKM_SHA256,
    binary_hashes: OFFICIAL_BINARY_HASHES,
    unity_version: renderTextureEvidence.source.unityVersion,
    evidence: [
      "build/extract_official_camera_transform.py",
      "build/extract_official_card_renderer.py",
      "build/extract_official-card-display.py",
      "build/extract_official-homography-wiring.py",
      "build/extract_official_homography_program.py",
      "build/extract_official_final_blit.py",
      "build/extract_official_rendertexture_contract.py",
    ],
  },
  profiles: {
    ordinary_android_default_middle_without_persisted_override: {
      applicability: {
        platform_default: "ordinaryAndroid",
        quality_enum: ordinaryAndroid.qualityEnum,
        quality_name: ordinaryQuality.name,
        quality_factor: ordinaryQuality.factor,
        persisted_quality_override: "absent",
        note: "1122x1122 applies only to the ordinary Android default Middle profile when no persisted quality override replaces it",
      },
      card_view: {
        serialized_size_type: detail.serializedUICardViewSizeType,
        size_type: detail.cardSizeType,
        size_name: detail.cardSizeName,
        pixel_width: detail.pixelSize.width,
        pixel_height: detail.pixelSize.height,
      },
      display_mode: {
        serialized_prefab: detailView.relativePath,
        clamp_parallax: detailView.modelCardView.clampParallax.value === 1,
        selected_material: homographyDisplayMaterial,
      },
      source_render_target_request: {
        width: detail.defaultSourceRenderTexture.width,
        height: detail.defaultSourceRenderTexture.height,
        square: renderTexture.square,
        size_formula: renderTexture.formula,
        requested_color_format: {
          unity_enum: renderTexture.underlying.renderTextureFormatEnum,
          unity_name: renderTexture.underlying.renderTextureFormat,
        },
        requested_depth_bits: renderTexture.underlying.depthBits,
        requested_anti_aliasing: renderTexture.underlying.antiAliasing,
      },
    },
  },
  quality_profiles: Object.fromEntries(
    Object.entries(quality.byEnum).map(([qualityEnum, profile]) => {
      const target = sourceTargetsByQuality[profile.name];
      return [profile.name.toLowerCase(), {
        quality_enum: Number(qualityEnum),
        quality_name: profile.name,
        quality_factor: profile.factor,
        source_render_target_request: {
          width: target.width,
          height: target.height,
          square: renderTexture.square,
          size_formula: renderTexture.formula,
        },
      }];
    }),
  ),
  render_target_semantics: {
    clear_rgba: clearColor.rgba,
    alpha_semantics: {
      meaning: "remaining transmission",
      initial_value: clearColor.alpha.value,
      official_reference_count: alpha.summary.materialReferences,
      official_reference_digest_sha256: alpha.referenceDigestSha256,
      rt0_classes: alpha.summary.rt0AlphaCounts,
    },
  },
  render_texture_physical_contract: {
    status: "conditionally-proven",
    applicability: {
      unity_version: renderTextureEvidence.source.unityVersion,
      graphics_api: {
        serialized_value: renderTextureEvidence.playerSettings.graphicsAPIs[0],
        name: "Vulkan",
      },
      active_color_space: {
        serialized_value: renderTextureEvidence.playerSettings.activeColorSpace,
        name: "Gamma",
      },
      depth_and_stencil_buffers_disabled:
        renderTextureEvidence.playerSettings.disableDepthAndStencilBuffers,
    },
    request: {
      color: renderTextureEvidence.color.legacyRenderTextureFormat,
      depth_bits: renderTextureEvidence.depth.requestedBits,
      anti_aliasing: renderTexture.underlying.antiAliasing,
      distinction: "the constructor request is not the device-selected physical format",
    },
    color: {
      legacy_mapping: {
        status: "proven",
        render_texture_format: renderTextureEvidence.color.legacyRenderTextureFormat,
        linear_or_gamma_graphics_format: {
          value: renderTextureEvidence.color.linearOrGammaGraphicsFormat,
          name: "R8G8B8A8_UNorm",
        },
        srgb_graphics_format: {
          value: renderTextureEvidence.color.srgbGraphicsFormat,
          name: "R8G8B8A8_SRGB",
        },
        selected_for_official_gamma_player: {
          value: renderTextureEvidence.color.requestedGraphicsFormat,
          name: "R8G8B8A8_UNorm",
        },
      },
      compatible_format_chain: {
        status: "proven",
        steps: [
          "legacy RenderTextureFormat mapping",
          "GfxDevice format capability lookup",
          "GetCompatibleFormat when the requested usage is unsupported",
          "Vulkan GraphicsFormat descriptor lookup",
        ],
        capability_entry_count: 152,
        capability_table_device_offset: "0x160",
        format_usage: renderTextureEvidence.depth.formatUsage,
      },
      preferred_vulkan_format: {
        status: "conditionally-proven",
        condition: "the running Vulkan device reports GF8 supported for FormatUsage.Render",
        graphics_format: {
          value: renderTextureEvidence.color.vulkan.gf8.graphicsFormat,
          name: "R8G8B8A8_UNorm",
        },
        vk_format: {
          value: renderTextureEvidence.color.vulkan.gf8.vkFormat,
          name: "VK_FORMAT_R8G8B8A8_UNORM",
        },
      },
      srgb_vulkan_mapping: {
        graphics_format: renderTextureEvidence.color.vulkan.gf4.graphicsFormat,
        vk_format: renderTextureEvidence.color.vulkan.gf4.vkFormat,
        name: "VK_FORMAT_R8G8B8A8_SRGB",
      },
      actual_vulkan_format: {
        status: "device-state",
        reason: "the selected compatible format depends on the runtime Vulkan format capability table",
      },
    },
    depth_stencil: {
      selection_chain: {
        status: "proven",
        requested_bits: renderTextureEvidence.depth.requestedBits,
        default_format: renderTextureEvidence.depth.defaultFormat,
        preferred_graphics_format: renderTextureEvidence.depth.preferredGraphicsFormat,
        get_compatible_format: {
          format_usage: renderTextureEvidence.depth.formatUsage,
          preserve: renderTextureEvidence.depth.preserveCompatibleFormat,
        },
      },
      known_vulkan_mappings: [
        {
          graphics_format: renderTextureEvidence.depth.vulkan.gf92.graphicsFormat,
          graphics_format_name: "D24_UNorm_S8_UInt",
          vk_format: renderTextureEvidence.depth.vulkan.gf92.vkFormat,
          vk_format_name: "VK_FORMAT_D24_UNORM_S8_UINT",
        },
        {
          graphics_format: renderTextureEvidence.depth.vulkan.gf94.graphicsFormat,
          graphics_format_name: "D32_SFloat_S8_UInt",
          vk_format: renderTextureEvidence.depth.vulkan.gf94.vkFormat,
          vk_format_name: "VK_FORMAT_D32_SFLOAT_S8_UINT",
        },
      ],
      preferred_vulkan_format: {
        status: "conditionally-proven",
        condition: "the running Vulkan device reports GF92 supported for FormatUsage.Render with preserve=true",
        vk_format: renderTextureEvidence.depth.vulkan.gf92.vkFormat,
        name: "VK_FORMAT_D24_UNORM_S8_UINT",
      },
      actual_graphics_format: {
        status: "device-state",
        reason: "DefaultFormat.DepthStencil is initialized through GetCompatibleFormat and the device capability table",
      },
      actual_depth_stencil_aspects: {
        status: "device-state",
        reason: "depth/stencil aspects follow the runtime-selected compatible GraphicsFormat",
      },
    },
    y: {
      unity_uv_origin: {
        status: "proven",
        graphics_uv_starts_at_top: renderTextureEvidence.y.unityGraphicsUvStartsAtTop,
        native_flag_offset: renderTextureEvidence.y.vulkanDeviceFlagOffset,
        native_initialized_value: renderTextureEvidence.y.vulkanDeviceFlagInitializedValue,
      },
      homography_sampling: {
        status: "proven",
        extra_one_minus_y: !homographyConsumer.fragmentSamplesDirectUvWithoutOneMinusY,
        managed_blit_or_flip_before_consumer: renderOneShot.hasManagedBlitOrFlip,
        vulkan_clip_space_y_flip: homographyConsumer.vertexHasVulkanClipYFlip,
      },
      final_blit_sampling: {
        status: "proven",
        render_target_uv_one_minus_y: finalBlitRenderTargetUvOneMinusY,
        vulkan_clip_space_y_flip: finalBlitClipSpaceYFlip,
        vertex_spirv_sha256: finalBlitVertex.module.sha256,
      },
      actual_vk_viewport: {
        status: "device-state",
        proc_name_rva: renderTextureEvidence.y.vkCmdSetViewport.procNameRva,
        proc_global_slot_rva: renderTextureEvidence.y.vkCmdSetViewport.globalSlotRva,
        reason: "VkViewport.y/height are emitted per command buffer and are not serialized in the APKM or pipeline cache",
      },
      physical_row_origin: {
        status: "device-state",
        reason: "effective orientation is the composition of projection, VkViewport, shader clip-space transform, and sampling transform",
      },
    },
    pipeline_cache: {
      status: "device-state",
      shipped_in_apks: renderTextureEvidence.pipelineCache.shippedInApks,
      runtime_path: renderTextureEvidence.pipelineCache.runtimePath,
      compatibility_header_fields: renderTextureEvidence.pipelineCache.headerCompatibilityFields,
      consequence: "the runtime PSO cache is device-specific and is not a portable RenderTexture format or viewport oracle",
    },
    static_evidence: {
      elf_virtual_address_mapping: renderTextureEvidence.elf.virtualAddressMapping,
      elf_load_segments: renderTextureEvidence.elf.loadSegments,
      native_windows: renderTextureNative.windows,
    },
  },
  camera: {
    field_of_view_degrees: camera.fieldOfViewDegrees,
    aspect: detail.defaultSourceRenderTexture.width / detail.defaultSourceRenderTexture.height,
    local_position: camera.localPosition,
    distance: camera.distance.values[0],
    culling_layer: { index: layer.index, bit: layer.bit },
  },
  card_transform: {
    set_flipped_argument: parentFace.setFlippedArgument,
    parent_local_euler_degrees: parentFace.parentLocalEulerDegrees,
  },
  homography: {
    keypoint_root_rotation: keyPointRoot.localRotation,
    keypoint_order: keyPointOrder,
    keypoints: keyPoints,
    projected_coordinate_space: homographyNative.coordinateContract.coordinateSpace,
    texture_uv: {
      y_flip: textureUvYFlip,
      transform: textureUvYFlip ? "one-minus-y" : "identity",
      managed_blit_or_flip_before_consumer: renderOneShot.hasManagedBlitOrFlip,
      vulkan_vertex_clip_space_y_flip: homographyConsumer.vertexHasVulkanClipYFlip,
    },
  },
  display_modes: {
    selector: `ModelCardView.${clampField.name}`,
    false: plainDisplayMaterial,
    true: homographyDisplayMaterial,
    source_texture_property: dynamicProperty.value,
    pinned_detail_profile: {
      clamp_parallax: detailView.modelCardView.clampParallax.value === 1,
      selected_material: homographyDisplayMaterial,
      evidence: `${detailView.relativePath} ModelCardView._clampParallax`,
    },
  },
  runtime_boundaries: {
    clamp_parallax_selection: {
      pinned_detail_profile: "proved from the serialized ModelCardView instance",
      other_view_prefabs: "must supply their own serialized _clampParallax value",
    },
    quality_selection: {
      persisted_override_supported: quality.persistedOverride.provedCapable,
      actual_persisted_quality_on_runtime_device: {
        status: "unproved",
        claim: rendererEvidence.unproved[3],
      },
      consequence: "the 1122x1122 profile is not universal; recompute the requested square side from the actual selected quality",
    },
    physical_render_texture: {
      requested_color_format_is_not_physical_format: true,
      physical_color_format: {
        status: "conditionally-proven",
        condition: "GF8 Render support selects VK_FORMAT_R8G8B8A8_UNORM; any compatible fallback remains device-state",
      },
      physical_depth_format: {
        status: "device-state",
        condition: "Depth24 resolves through DefaultFormat.DepthStencil and GetCompatibleFormat(GF92, Render, preserve=true)",
      },
      unity_uv_origin: {
        status: "proven",
        graphics_uv_starts_at_top: renderTextureEvidence.y.unityGraphicsUvStartsAtTop,
      },
      actual_vk_viewport: {
        status: "device-state",
        claim: "pass-specific VkViewport.y and VkViewport.height",
      },
    },
    texture_sample_add_per_draw: "unproved",
    main_texture_physical_srgb: "unproved",
    dynamic_ui_runtime_keywords: "unproved",
  },
};

const output = `${JSON.stringify(contract, null, 2)}\n`;
if (CHECK) {
  assert.equal(fs.readFileSync(OUT, "utf8"), output, "card display contract drifted");
  console.log("Official card display contract check OK");
} else {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, output);
  console.log(`Generated ${path.relative(ROOT, OUT)} from official evidence`);
}
