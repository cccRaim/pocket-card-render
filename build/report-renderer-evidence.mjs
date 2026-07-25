// Report traceable implementation evidence for the reference scenes.
//
// Coverage is intentionally not collapsed into a "game fidelity" percentage.
// Static source evidence cannot prove renderer-pipeline or final visual parity.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";
import { SHADER } from "../public/render/rarities.js";
import { readOfficialPlayerPipeline } from "./official-player-pipeline.mjs";
import { readOfficialPostprocess } from "./official-postprocess.mjs";
import { importOfficialVulkanCapture } from "./import-official-vulkan-runtime-capture.mjs";
import { CANONICAL_FULL_RUNTIME_SCENES } from "./full-runtime-sources.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const sceneNames = CANONICAL_FULL_RUNTIME_SCENES.map(({ file }) => file).sort();

const RUNTIME_SPECIAL_MATERIALS = new Set(["DefaultMaterial"]);
const UR_CORE_GUARDED = new Set([
  "Card_UR_Plate",
  "Card_Parallax_Hologram_UR_New",
  "Frame-Holo-UR-New",
  "Frame-2Layer-UR",
  "Opaque-UR-Oklab",
  "Card_UR_LensFlare",
]);
const UR_REMAINDER_GUARDED = new Set([
  "Card_Parallax_UR",
  "Transparent-UR-New",
]);
const MRT_RGB_GUARDED = new Set([
  "Card_UR_LensFlare",
  "Card_UR_LensFlare",
  "Frame-2Layer-UR",
  "Frame-Holo-UR-New",
  "Opaque-UR-Oklab",
]);
const EFFECT_GUARDED = new Set(["Effect"]);
const PARALLAX_GUARDED = new Set(["Card_Parallax", "Card_Parallax_Metal"]);
const FLAT_GUARDED = new Set(["Card_Illust", "Frame", "Simple-Opaque", "Simple-Transparent"]);
const HOLO_GUARDED = new Set([
  "Transparent_Hologram_Tuning",
  "Frame-Holo-Tuning",
  "Card_Hologram_Tuning",
  "Opaque_Hologram_Tuning",
  "Opaque-Hologram_Tuning",
  "Simple-Opaque-Hologram_Tuning",
  "Card_Parallax_Hologram_Tuning",
]);
const PIPELINE_PARITY_STAGES = [
  "texture-color-space",
  "alpha-convention",
  "sampler-state",
  "render-target-formats",
  "mrt-routing",
  "draw-order",
  "blend-stencil-depth",
  "shader-precision",
  "camera-transforms",
  "animation-timing",
  "bloom-tone-mapping",
  "display-transfer",
];

const PIPELINE_STAGE_RESEARCH = {
  "texture-color-space": ["official-player-config-and-runtime-wiring", "low"],
  "alpha-convention": ["asset-import-and-blend-research", "high"],
  "sampler-state": ["asset-sampler-state-extraction", "high"],
  "render-target-formats": ["il2cpp-render-target-disassembly", "medium"],
  "mrt-routing": ["multi-attachment-pass-reconstruction", "high"],
  "draw-order": ["native-sort-input-capture-and-runtime-wiring", "high"],
  "blend-stencil-depth": ["runtime-gl-state-verification", "medium"],
  "shader-precision": ["target-device-precision-probe", "high"],
  "camera-transforms": ["il2cpp-camera-and-homography-reconstruction", "high"],
  "animation-timing": ["il2cpp-animation-clock-disassembly", "high"],
  "bloom-tone-mapping": ["official-postprocess-pass-reconstruction", "very-high"],
  "display-transfer": ["target-device-display-probe", "medium"],
};

function officialPlayerEvidence() {
  try {
    return { value: readOfficialPlayerPipeline(), error: null };
  } catch (error) {
    return { value: null, error: String(error?.message || error) };
  }
}

function officialPostprocessEvidence() {
  try {
    return { value: readOfficialPostprocess(), error: null };
  } catch (error) {
    return { value: null, error: String(error?.message || error) };
  }
}

function readJsonIfPresent(file) {
  try {
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null;
  } catch {
    return null;
  }
}

let officialVulkanCaptureCache;
function officialVulkanCaptureEvidence() {
  if (officialVulkanCaptureCache !== undefined) return officialVulkanCaptureCache;
  const captureDir = process.env.PCR_OFFICIAL_VULKAN_CAPTURE;
  if (!captureDir) return (officialVulkanCaptureCache = { value: null, error: null });
  const scenePath = process.env.PCR_OFFICIAL_VULKAN_SCENE
    || path.join(ROOT, "public", "scene.cTR_20_000670_00_IIBUINOBAKKU_UR.json");
  try {
    return (officialVulkanCaptureCache = {
      value: importOfficialVulkanCapture({ captureDir, scenePath }),
      error: null,
    });
  } catch (error) {
    return (officialVulkanCaptureCache = { value: null, error: String(error?.message || error) });
  }
}

export function buildPipelineParityStages(rows = collectEvidenceRows()) {
  const total = rows.length;
  const app = fs.readFileSync(path.join(ROOT, "public", "app.js"), "utf8");
  const context = fs.readFileSync(path.join(ROOT, "public", "render", "context.js"), "utf8");
  const textureRuntime = fs.readFileSync(
    path.join(ROOT, "public", "render", "official-texture.js"),
    "utf8",
  );
  const textureUploadAuditPath = path.join(ROOT, "build", "test-texture-upload-runtime.mjs");
  const textureUploadPagePath = path.join(ROOT, "public", "test-texture-upload-runtime.html");
  const textureUploadPage = fs.existsSync(textureUploadPagePath)
    ? fs.readFileSync(textureUploadPagePath, "utf8")
    : "";
  const officialMrtRuntimeText = fs.readFileSync(
    path.join(ROOT, "public", "render", "pipeline", "official-mrt.js"),
    "utf8",
  );
  const officialResult = officialPlayerEvidence();
  const official = officialResult.value;
  const postprocessResult = officialPostprocessEvidence();
  const postprocess = postprocessResult.value;
  const officialVulkanResult = officialVulkanCaptureEvidence();
  const officialVulkanCapture = officialVulkanResult.value;
  const officialVulkanRuntimeObserved = officialVulkanCapture?.capture?.matchedCardScopes > 0
    && officialVulkanCapture?.bestSummary?.mismatch === 0
    && officialVulkanCapture?.bestSummary?.exactProgram === officialVulkanCapture?.bestSummary?.exactProgramExpected
    && officialVulkanCapture?.bestSummary?.unresolved === 4
    && officialVulkanCapture?.scopes?.every((scope) => !scope.assignmentSearchTruncated && scope.submissions?.length > 0);
  const officialVulkanRuntimeProvenanceComplete = officialVulkanRuntimeObserved
    && officialVulkanCapture?.capture?.provenance?.status === "complete"
    && typeof officialVulkanCapture?.source?.declaredCaptureSchema === "string";
  const gamma = official?.playerSettings?.activeColorSpaceValue === 0;
  const rawTextures = /texture\.colorSpace\s*=\s*THREE\.NoColorSpace/.test(textureRuntime)
    && /loadOfficialTexture\(url, officialSamplerMap\[url\]\)/.test(app)
    && !/colorSpace\s*=\s*scene_data\.textureColorSpace/.test(app);
  const textureUploadAudit = fs.existsSync(textureUploadAuditPath)
    && /renderer\.readRenderTargetPixels/.test(textureUploadPage)
    && /17, 34, 51, 0/.test(textureUploadPage)
    && /texture\.premultiplyAlpha\s*===\s*false/.test(textureUploadPage)
    && /texture\.flipY\s*===\s*false/.test(textureUploadPage)
    && /screenshots:\s*0/.test(textureUploadPage);
  const rawDisplay = /renderer\.outputColorSpace\s*=\s*THREE\.LinearSRGBColorSpace/.test(app)
    && /post\.apply\(\)/.test(app)
    && /displayPost\.present\(\)/.test(app)
    && !/pcrLinearToSrgb/.test(app);
  const cardRT = official?.asset3DRenderer?.createRenderTexture;
  const cardRTMatched = cardRT?.renderTextureFormat === "ARGB32"
    && cardRT?.depthBits === 24
    && cardRT?.antiAliasing === 1
    && /antialias:\s*false/.test(app)
    && !/samples:\s*[1-9]/.test(app);
  const samplerMapPath = path.join(ROOT, "public", "texture-samplers.json");
  const samplerMap = fs.existsSync(samplerMapPath)
    ? JSON.parse(fs.readFileSync(samplerMapPath, "utf8"))
    : null;
  const samplerRuntime = samplerMap?.schemaVersion === 3
    && Object.keys(samplerMap.textures || {}).length > 0
    && /loadOfficialTexture\(url, officialSamplerMap\[url\]\)/.test(app)
    && /export function applyOfficialSampler/.test(textureRuntime)
    && !/anisotropy\s*=\s*4/.test(textureRuntime);
  const texturePayloadAudit = fs.existsSync(path.join(ROOT, "build", "audit-official-texture-payload.mjs"))
    && /texture\.mipmaps\s*=\s*mipmaps/.test(textureRuntime)
    && !/generateMipmaps\s*=\s*true/.test(textureRuntime);
  const textureMipRuntime = fs.existsSync(path.join(ROOT, "build", "test-texture-mip-runtime.mjs"))
    && fs.existsSync(path.join(ROOT, "public", "test-texture-mip-runtime.html"))
    && /textureLod/.test(fs.readFileSync(path.join(ROOT, "public", "test-texture-mip-runtime.html"), "utf8"));
  const officialBlendRuntime = !/if\s*\(straight\s*&&\s*sf\s*===\s*1\)/.test(context)
    && /else if \(mode === "over"\) \[src, dst\] = \[5, 10\]/.test(context)
    && /texture\.premultiplyAlpha\s*=\s*false/.test(textureRuntime)
    && /loadOfficialTexture\(url, officialSamplerMap\[url\]\)/.test(app);
  const officialMrt = postprocess?.native?.mrt;
  const officialMrtKnown = officialMrt?.colorAttachmentCount === 2
    && officialMrt?.colorFormat === "ARGB32"
    && officialMrt?.depthBufferBits === 24
    && officialMrt?.opaqueAndTransparentBindMrt === true;
  const officialBloomKnown = postprocess?.bloomShader?.moduleCount === 12
    && postprocess?.native?.bloomExecuteSequence?.map((item) => item.pass).join(",") === "0,1,2,3,3,4,5";
  const officialRtDescriptors = postprocess?.native?.renderTargets;
  const officialRtDescriptorsKnown = officialRtDescriptors?.sceneMrt?.filterMode === "Point"
    && officialRtDescriptors?.bloomIntermediate?.requestedColorFormat === "ARGB32"
    && officialRtDescriptors?.bloomIntermediate?.requestedReadWrite === "Linear"
    && officialRtDescriptors?.bloomIntermediate?.depthBufferBits === 0
    && officialRtDescriptors?.bloomIntermediate?.filterMode === "Bilinear"
    && officialRtDescriptors?.bloomIntermediate?.msaaSamples === 1
    && officialRtDescriptors?.bloomIntermediate?.constructorFlagsValue === 0x82;
  const serializedBloom = postprocess?.serializedPostProcess;
  const firstBloomVolume = serializedBloom?.bloomVolumes?.[0]?.fields;
  const bloomSizing = postprocess?.native?.bloomSizing?.portraitExample;
  const officialBloomConfigurationKnown = serializedBloom?.derived?.postProcessPassPathIds?.join(",") === "14721"
    && serializedBloom?.derived?.profileComponentPathIds?.join(",") === "14722,14723,14724,14725,14726"
    && serializedBloom?.derived?.bloomVolumeRawIdentical === true
    && firstBloomVolume?.active?.value === true
    && firstBloomVolume?.bufferSize?.overrideState?.value === true
    && firstBloomVolume?.bufferSize?.value?.value === 256
    && firstBloomVolume?.downSamplingCount?.overrideState?.value === true
    && firstBloomVolume?.downSamplingCount?.value?.value === 5
    && firstBloomVolume?.scatter?.overrideState?.value === true
    && firstBloomVolume?.scatter?.value?.value === 0.5
    && firstBloomVolume?.intensity?.overrideState?.value === true
    && firstBloomVolume?.intensity?.value?.value === 1
    && bloomSizing?.baseSize?.width === 256
    && bloomSizing?.baseSize?.height === 455
    && bloomSizing?.pass0?.scale?.width === 2
    && bloomSizing?.pass0?.scale?.height === 2
    && bloomSizing?.sheet?.size?.width === 420
    && bloomSizing?.sheet?.size?.height === 473
    && typeof postprocess?.native?.methods?.finalBlitExecute?.bodySha256 === "string";
  const mrtOutputAudit = fs.existsSync(path.join(ROOT, "build", "extract_official_mrt_outputs.py"))
    && fs.existsSync(path.join(ROOT, "build", "audit-official-mrt-outputs.mjs"))
    && /official-mrt-outputs/.test(fs.readFileSync(path.join(ROOT, "build", "audit-all.mjs"), "utf8"));
  const drawCoverageAudit = fs.existsSync(path.join(ROOT, "build", "audit-official-draw-coverage.mjs"))
    && /official-draw-coverage/.test(fs.readFileSync(path.join(ROOT, "build", "audit-all.mjs"), "utf8"));
  const auditAllSource = fs.readFileSync(path.join(ROOT, "build", "audit-all.mjs"), "utf8");
  const officialVulkanCaptureToolAudit = fs.existsSync(path.join(ROOT, "build", "import-official-vulkan-runtime-capture.mjs"))
    && fs.existsSync(path.join(ROOT, "build", "test-official-vulkan-runtime-import.mjs"))
    && fs.existsSync(path.join(ROOT, "build", "audit-official-vulkan-runtime-capture.mjs"))
    && /official-vulkan-runtime-import/.test(auditAllSource)
    && /official-vulkan-runtime-capture/.test(auditAllSource);
  const passPartitionAudit = fs.existsSync(path.join(ROOT, "build", "audit-official-pass-partition.mjs"))
    && /official-pass-partition/.test(auditAllSource);
  const drawOrderNativeAudit = fs.existsSync(path.join(ROOT, "build", "audit-official-draw-order-native.mjs"))
    && fs.existsSync(path.join(ROOT, "build", "audit-official-reference-sort-inputs.mjs"))
    && fs.existsSync(path.join(ROOT, "build", "test-official-draw-order.mjs"))
    && fs.existsSync(path.join(ROOT, "public", "render", "official-draw-order.js"))
    && /official-draw-order-native/.test(auditAllSource)
    && /official-reference-sort-inputs/.test(auditAllSource)
    && /official-draw-order-numeric/.test(auditAllSource);
  const drawOrderSymbolAudit = fs.existsSync(path.join(ROOT, "build", "audit-official-unity-symbol-map.mjs"))
    && /official-unity-symbol-map/.test(auditAllSource);
  const drawOrderMaterialAudit = fs.existsSync(path.join(ROOT, "build", "extract_official_material_sort_inputs.py"))
    && fs.existsSync(path.join(ROOT, "build", "audit-official-material-sort-inputs.mjs"))
    && /official-material-sort-inputs/.test(auditAllSource);
  const drawOrderCollisionAudit = fs.existsSync(path.join(ROOT, "build", "audit-official-sort-prefix-collisions.mjs"))
    && /official-sort-prefix-collisions/.test(auditAllSource);
  const drawOrderPassCandidateAudit = fs.existsSync(path.join(ROOT, "build", "audit-official-pass-candidates.mjs"))
    && /official-pass-candidates/.test(auditAllSource);
  const drawOrderProducerAudit = fs.existsSync(path.join(ROOT, "build", "audit-official-sort-input-producers.mjs"))
    && /official-sort-input-producers/.test(auditAllSource);
  const drawOrderInstanceIdAudit = fs.existsSync(path.join(ROOT, "build", "audit-official-instance-id-remapper.mjs"))
    && /official-instance-id-remapper/.test(auditAllSource);
  const drawOrderCommandBranchAudit = fs.existsSync(path.join(ROOT, "build", "audit-official-sort-command-branch.mjs"))
    && /official-sort-command-branch/.test(auditAllSource);
  const drawOrderSrpAudit = fs.existsSync(path.join(ROOT, "build", "extract_official_srp_batcher.py"))
    && fs.existsSync(path.join(ROOT, "build", "audit-official-srp-batcher.mjs"))
    && /official-srp-batcher/.test(auditAllSource);
  const drawOrderLocalKeywordAudit = fs.existsSync(path.join(ROOT, "build", "audit-official-local-keyword-state.mjs"))
    && /official-local-keyword-state/.test(auditAllSource);
  const drawOrderRuntimeCaptureToolAudit = fs.existsSync(path.join(ROOT, "build", "capture-official-sort-runtime.js"))
    && fs.existsSync(path.join(ROOT, "build", "audit-official-sort-runtime-capture-tool.mjs"))
    && fs.existsSync(path.join(ROOT, "build", "import-official-sort-runtime-capture.mjs"))
    && fs.existsSync(path.join(ROOT, "build", "test-official-sort-runtime-import.mjs"))
    && fs.existsSync(path.join(ROOT, "build", "test-official-sort-captured-descriptor.mjs"))
    && fs.existsSync(path.join(ROOT, "build", "build-official-sort-collision-groups.mjs"))
    && fs.existsSync(path.join(ROOT, "build", "test-official-sort-capture-resolver.mjs"))
    && fs.existsSync(path.join(ROOT, "public", "render", "official-sort-collision-groups.json"))
    && fs.existsSync(path.join(ROOT, "public", "render", "official-sort-capture.js"))
    && /official-sort-runtime-capture-tool/.test(auditAllSource)
    && /official-sort-runtime-import/.test(auditAllSource)
    && /official-sort-captured-descriptor/.test(auditAllSource)
    && /official-sort-collision-groups/.test(auditAllSource)
    && /official-sort-capture-resolver/.test(auditAllSource);
  const sideBackAudit = fs.existsSync(path.join(ROOT, "build", "audit-official-side-back.mjs"))
    && fs.existsSync(path.join(ROOT, "build", "build-exact-side-back.mjs"))
    && fs.existsSync(path.join(ROOT, "public", "shaders", "side_back_program.json"))
    && /official-side-back/.test(auditAllSource)
    && /exact-side-back/.test(auditAllSource);
  const cameraTransformAudit = fs.existsSync(path.join(ROOT, "build", "extract_official_camera_transform.py"))
    && fs.existsSync(path.join(ROOT, "build", "audit-official-camera-transform.mjs"))
    && /official-camera-transform/.test(auditAllSource);
  const cameraAuditSource = cameraTransformAudit
    ? fs.readFileSync(path.join(ROOT, "build", "audit-official-camera-transform.mjs"), "utf8")
    : "";
  const ordinaryGyroGateAudit = cameraTransformAudit
    && /ordinary browser card does not activate gyro/.test(cameraAuditSource)
    && /_useGyro raw gate is false/.test(cameraAuditSource);
  const cardRendererAudit = fs.existsSync(path.join(ROOT, "build", "extract_official_card_renderer.py"))
    && fs.existsSync(path.join(ROOT, "build", "audit-official-card-renderer.mjs"))
    && /official-card-renderer/.test(auditAllSource);
  const homographyProgramAudit = fs.existsSync(path.join(ROOT, "build", "extract_official_homography_program.py"))
    && fs.existsSync(path.join(ROOT, "build", "audit-official-homography.mjs"))
    && fs.existsSync(path.join(ROOT, "build", "build-exact-homography.mjs"))
    && fs.existsSync(path.join(ROOT, "build", "test-homography-runtime.mjs"))
    && fs.existsSync(path.join(ROOT, "public", "render", "pipeline", "official-homography.js"))
    && fs.existsSync(path.join(ROOT, "public", "shaders", "homography_program.json"))
    && /official-homography/.test(auditAllSource)
    && /exact-homography/.test(auditAllSource);
  const touchRotationAudit = fs.existsSync(path.join(ROOT, "build", "extract_official-touch-rotation.py"))
    && fs.existsSync(path.join(ROOT, "build", "audit-official-touch-rotation.mjs"))
    && /official-touch-rotation/.test(auditAllSource);
  const cardDisplayContractPath = path.join(ROOT, "public", "render", "card-display-contract.json");
  const cardDisplayContractData = readJsonIfPresent(cardDisplayContractPath);
  const cardDisplayContractAlpha = cardDisplayContractData?.render_target_semantics?.alpha_semantics;
  const cardDisplayAudit = fs.existsSync(path.join(ROOT, "build", "extract_official-card-display.py"))
    && fs.existsSync(path.join(ROOT, "build", "audit-official-card-display.mjs"))
    && /official-card-display/.test(auditAllSource)
    && cardDisplayContractAlpha?.meaning === "remaining transmission"
    && cardDisplayContractAlpha?.official_reference_count === 98
    && cardDisplayContractAlpha?.official_reference_digest_sha256
      === "9b93692fe9f6cac138cb798cb03adfa3f14abfdbb389ebbf82c41d799d719728";
  const homographyWiringAudit = fs.existsSync(path.join(ROOT, "build", "extract_official-homography-wiring.py"))
    && fs.existsSync(path.join(ROOT, "build", "audit-official-homography-wiring.mjs"))
    && /official-homography-wiring/.test(auditAllSource);
  const homographyDisplayRuntime = fs.existsSync(path.join(ROOT, "build", "test-homography-display-runtime.mjs"))
    && fs.existsSync(path.join(ROOT, "public", "test-homography-display-runtime.html"))
    && fs.existsSync(path.join(ROOT, "public", "render", "pipeline", "homography-display.js"))
    && /homography-display-runtime/.test(auditAllSource);
  const uiDefaultManifest = readJsonIfPresent(
    path.join(ROOT, "public", "shaders", "ui_default_from_rt_program.json"),
  );
  const uiDefaultFromRtAudit = fs.existsSync(path.join(ROOT, "build", "extract_official-ui-default-from-rt.py"))
    && fs.existsSync(path.join(ROOT, "build", "build-exact-ui-default-from-rt.mjs"))
    && fs.existsSync(path.join(ROOT, "build", "audit-official-ui-default-from-rt.mjs"))
    && fs.existsSync(path.join(ROOT, "public", "shaders", "ui_default_from_rt_program.json"))
    && /official-ui-default-from-rt/.test(auditAllSource)
    && /exact-ui-default-from-rt/.test(auditAllSource)
    && uiDefaultManifest?.official_source?.shader_object_sha256
      === "61b9ae7be77d58e2a363ffe0ad3243356601c0a8400016de0dd5dc4bef2a109a"
    && uiDefaultManifest?.official_source?.program_entry_sha256
      === "fa69bd7b706e1b43f15ecda7144694b5832e6edcc0c254a60cea4b7cd69cbf26"
    && uiDefaultManifest?.fragment_dataflow?.alpha === "(1.0 - sample.a) * tint.a"
    && uiDefaultManifest?.blend?.source === "One"
    && uiDefaultManifest?.blend?.destination === "OneMinusSrcAlpha";
  const cardDisplayContract = fs.existsSync(path.join(ROOT, "build", "build-official-card-display-contract.mjs"))
    && cardDisplayContractData?.generated_by === "build/build-official-card-display-contract.mjs"
    && /official-card-display-contract/.test(auditAllSource);
  const runtimeTestSource = fs.readFileSync(path.join(ROOT, "build", "test-runtime.mjs"), "utf8");
  const cardDisplayRuntime = cardDisplayContractData?.schema_version === 5
    && cardDisplayContractData?.profiles?.ordinary_android_default_middle_without_persisted_override
      ?.display_mode?.selected_material === "PrerenderHomographyCard"
    && /resizeSourceToDrawingBuffer:\s*false/.test(app)
    && /createHomographyDisplayMaterial/.test(app)
    && /setHomographyDisplayPoints/.test(app)
    && /window\.__displayPost\s*=\s*makeDisplayPass/.test(app)
    && /displayPost\.present\(\)/.test(app)
    && /sourcePixelProbe/.test(runtimeTestSource)
    && /displayQuaternion/.test(runtimeTestSource);
  const renderTextureContractAudit = cardDisplayContractData?.render_texture_physical_contract?.status
      === "conditionally-proven"
    && fs.existsSync(path.join(ROOT, "build", "audit-official-rendertexture-contract.mjs"))
    && /official-rendertexture-contract/.test(auditAllSource);
  const drawStateRuntimeAudit = fs.existsSync(path.join(ROOT, "build", "audit-official-draw-state.mjs"))
    && fs.existsSync(path.join(ROOT, "build", "test-draw-state-runtime.mjs"))
    && fs.existsSync(path.join(ROOT, "public", "test-draw-state-runtime.html"))
    && /official-draw-state/.test(auditAllSource)
    && /stencilWriteMask/.test(context)
    && !/\.stencilMask\s*=/.test(context);
  const bloomRuntimeSource = path.join(ROOT, "public", "render", "pipeline", "official-bloom.js");
  const mrtRuntime = fs.existsSync(path.join(ROOT, "public", "render", "pipeline", "official-mrt.js"))
    && /createOfficialMrtTarget\(renderer/.test(app)
    && fs.existsSync(bloomRuntimeSource)
    && /sceneTarget\.textures\[1\]/.test(fs.readFileSync(bloomRuntimeSource, "utf8"))
    && !/renderBloomSource/.test(app)
    && fs.existsSync(path.join(ROOT, "build", "test-mrt-runtime.mjs"));
  const bloomRuntime = fs.existsSync(bloomRuntimeSource)
    && fs.existsSync(path.join(ROOT, "build", "build-exact-bloom.mjs"))
    && fs.existsSync(path.join(ROOT, "build", "audit-official-bloom-program.mjs"))
    && fs.existsSync(path.join(ROOT, "build", "audit-official-bloom-runtime.mjs"))
    && /createOfficialBloomPipeline/.test(app)
    && /passSequence:\s*enabled\s*\?\s*\[0,\s*1,\s*1,\s*1,\s*1,\s*1,\s*2,\s*3,\s*3,\s*4,\s*5\]/
      .test(fs.readFileSync(bloomRuntimeSource, "utf8"));
  const bloomRuntimeText = fs.existsSync(bloomRuntimeSource)
    ? fs.readFileSync(bloomRuntimeSource, "utf8")
    : "";
  const bloomDirectColorRt = bloomRuntime
    && !/targets\.color/.test(bloomRuntimeText)
    && /pass5-add-to-scene-color/.test(bloomRuntimeText);
  const bloomRtDescriptorRuntime = /internalFormat:\s*"RGBA8"/.test(bloomRuntimeText)
    && /type:\s*THREE\.UnsignedByteType/.test(bloomRuntimeText)
    && /colorSpace:\s*THREE\.NoColorSpace/.test(bloomRuntimeText)
    && /minFilter:\s*THREE\.LinearFilter/.test(bloomRuntimeText)
    && /depthBuffer:\s*false/.test(bloomRuntimeText)
    && /samples:\s*0/.test(bloomRuntimeText)
    && /minFilter:\s*"NearestFilter"/.test(officialMrtRuntimeText);
  const bloomRtDescriptorMatched = officialRtDescriptorsKnown && bloomRtDescriptorRuntime;
  const finalBlitRuntime = fs.existsSync(path.join(ROOT, "build", "extract_official_final_blit.py"))
    && fs.existsSync(path.join(ROOT, "build", "audit-official-final-blit.mjs"))
    && fs.existsSync(path.join(ROOT, "build", "build-exact-final-blit.mjs"))
    && fs.existsSync(path.join(ROOT, "public", "shaders", "final_blit.vert.glsl"))
    && fs.existsSync(path.join(ROOT, "public", "shaders", "final_blit.frag.glsl"))
    && /loadOfficialFinalBlitProgram/.test(app)
    && /_BlitScaleBias:\s*\{\s*value:\s*new THREE\.Vector4\(1,\s*1,\s*0,\s*0\)/
      .test(fs.readFileSync(bloomRuntimeSource, "utf8"))
    && /asymmetric 2x2 draw\/readPixels orientation passed/
      .test(fs.readFileSync(path.join(ROOT, "build", "audit-official-final-blit.mjs"), "utf8"));
  const displayTransferStaticAudit = fs.existsSync(path.join(ROOT, "build", "audit-official-display-transfer.mjs"))
    && /VK_FORMAT_R8G8B8A8_UNORM/.test(fs.readFileSync(path.join(ROOT, "build", "audit-official-display-transfer.mjs"), "utf8"))
    && /VK_COLOR_SPACE_SRGB_NONLINEAR_KHR/.test(fs.readFileSync(path.join(ROOT, "build", "audit-official-display-transfer.mjs"), "utf8"));
  const displayTransferRuntime = fs.existsSync(path.join(ROOT, "build", "test-display-transfer-runtime.mjs"))
    && fs.existsSync(path.join(ROOT, "public", "test-display-transfer-runtime.html"))
    && /gammaDomainReadbackIdentity/.test(fs.readFileSync(path.join(ROOT, "public", "test-display-transfer-runtime.html"), "utf8"))
    && /deviceOutput:\s*\{\s*status:\s*"not-observable"/.test(fs.readFileSync(path.join(ROOT, "public", "test-display-transfer-runtime.html"), "utf8"));
  const shaderPrecisionAudit = fs.existsSync(path.join(ROOT, "build", "audit-official-shader-precision.mjs"))
    && /RelaxedPrecision/.test(fs.readFileSync(path.join(ROOT, "build", "audit-official-shader-precision.mjs"), "utf8"))
    && /precision mediump float;/.test(fs.readFileSync(path.join(ROOT, "public", "shaders", "glitter.frag.glsl"), "utf8"));
  const shaderPrecisionRuntime = fs.existsSync(path.join(ROOT, "build", "test-shader-precision-runtime.mjs"))
    && /officialTargetGpuInference, false/.test(fs.readFileSync(path.join(ROOT, "build", "test-shader-precision-runtime.mjs"), "utf8"));
  const animationRuntime = /updateGlitterFlow\(em\.userData\.glitterFlow/.test(app)
    && /new OfficialClock\(\)/.test(app)
    && /threeWorldForwardToUnity\(cardForward\.toArray\(\)\)/.test(app)
    && /beginOfficialTouchDrag/.test(app)
    && fs.existsSync(path.join(ROOT, "public", "render", "glitter-flow.js"))
    && fs.existsSync(path.join(ROOT, "public", "render", "official-clock.js"))
    && fs.existsSync(path.join(ROOT, "public", "render", "official-touch-rotation.js"))
    && fs.existsSync(path.join(ROOT, "build", "test-official-touch-rotation.mjs"))
    && fs.existsSync(path.join(ROOT, "build", "test-official-clock.mjs"));
  const androidLifecycleAudit = fs.existsSync(path.join(ROOT, "build", "audit-official-android-lifecycle.mjs"))
    && /official-android-lifecycle/.test(auditAllSource)
    && /syncOfficialClockVisibility\(officialClock, document\.hidden\)/.test(app);

  const definitions = {
    "texture-color-space": {
      status: gamma && rawTextures && textureUploadAudit ? "proven"
        : gamma && rawTextures ? "partial" : "not-proven",
      coveredSubscopes: gamma && rawTextures ? (textureUploadAudit ? 3 : 2) : 0,
      totalSubscopes: 3,
      evidence: [
        "official APKM globalgamemanagers PlayerSettings.m_ActiveColorSpace",
        "shared browser raw texture upload helper",
        ...(textureUploadAudit ? ["browser PNG decode/upload/sample RGBA byte readback"] : []),
      ],
      remaining: gamma && rawTextures && textureUploadAudit
        ? []
        : gamma && rawTextures
          ? ["browser GPU internal texture-format conversion"]
        : ["official color-space value and browser sampler wiring", "browser GPU internal texture-format conversion"],
    },
    "alpha-convention": {
      status: officialBlendRuntime && cardDisplayAudit && uiDefaultFromRtAudit
        && cardDisplayRuntime && textureUploadAudit ? "proven" : "partial",
      coveredSubscopes: officialBlendRuntime && cardDisplayAudit && uiDefaultFromRtAudit
        ? (cardDisplayRuntime ? (textureUploadAudit ? 5 : 4) : 3)
        : (officialBlendRuntime ? 2 : 1),
      totalSubscopes: 5,
      evidence: [
        "official pass blend factors",
        ...(officialBlendRuntime ? ["runtime preserves factors and requests unpremultiplied upload"] : []),
        ...(officialBlendRuntime && cardDisplayAudit && uiDefaultFromRtAudit ? [
          "official four-prefab RT0 alpha state proves remaining-transmission alpha, black-alpha-one clear, and exact UI_Default_From_RT alpha inversion",
        ] : []),
        ...(cardDisplayRuntime ? ["browser Homography MRT and FinalBlit outer display preserve the remaining-transmission chain"] : []),
        ...(textureUploadAudit ? ["browser PNG decode/upload/sample readback preserves hidden RGB at alpha zero and straight semi-transparent RGB"] : []),
      ],
      remaining: officialBlendRuntime && cardDisplayAudit && uiDefaultFromRtAudit
        && cardDisplayRuntime && textureUploadAudit
        ? []
        : officialBlendRuntime && cardDisplayAudit && uiDefaultFromRtAudit && cardDisplayRuntime
          ? ["browser hidden-RGB/upload behavior"]
        : officialBlendRuntime && cardDisplayAudit && uiDefaultFromRtAudit
          ? ["browser hidden-RGB/upload behavior and outer display wiring"]
        : ["official upload hidden-RGB behavior", "MRT attachment alpha semantics"],
    },
    "sampler-state": {
      status: samplerRuntime ? "partial" : "not-proven",
      coveredSubscopes: samplerRuntime ? (texturePayloadAudit && textureMipRuntime ? 3 : 2) : 0,
      totalSubscopes: 4,
      evidence: samplerRuntime ? [
        "official Texture2D/Cubemap serialized sampler fields",
        "runtime per-texture filter/wrap/aniso/mip wiring",
        ...(texturePayloadAudit && textureMipRuntime ? [
          "official compressed payload and 38-level deterministic RGBA8 mip chain with textureLod GPU hash readback",
        ] : []),
      ] : [],
      remaining: samplerRuntime
        ? ["target-device ASTC/ETC hardware decode, descriptor capability, and anisotropy behavior"]
        : ["filter mode", "wrap modes", "mip payload and anisotropy state"],
    },
    "render-target-formats": {
      status: cardRTMatched ? "partial" : "not-proven",
      coveredSubscopes: [
        cardRTMatched,
        officialMrtKnown,
        mrtRuntime,
        cardDisplayRuntime,
        bloomRtDescriptorMatched,
        renderTextureContractAudit,
      ].filter(Boolean).length,
      totalSubscopes: 7,
      evidence: cardRTMatched ? [
        "official Asset3DRenderer.CreateRenderTexture ARM64 body",
        "official RendererData.GetTemporary MRT allocation",
        ...(cardRendererAudit ? ["official detail-view Large/Middle square source RT sizing and quality branches"] : []),
        ...(cardDisplayContract ? ["generated official 1122-square RT/camera/clear/keypoint display contract"] : []),
        ...(cardDisplayRuntime ? ["browser fixed 1122-square source MRT and aspect-1 source camera runtime"] : []),
        ...(bloomRtDescriptorMatched ? ["official ARM64 Bloom/scene RT descriptors mapped to explicit browser RGBA8/UByte and filter state"] : []),
        ...(renderTextureContractAudit ? [
          "official ARGB32-to-GF8/Vk37 and Depth24 GF92/GF94 compatible-format algorithms plus split Unity/Homography/FinalBlit Y contract",
        ] : []),
      ] : [],
      remaining: cardDisplayRuntime && bloomRtDescriptorMatched && renderTextureContractAudit
        ? ["target-device selected color/depth format, stencil aspects, image layout, and per-pass VkViewport"]
        : mrtRuntime && bloomRtDescriptorMatched
        ? [
          "CardRenderer quality-selected square source RT dimensions and camera aspect in browser runtime",
          "device-selected GetCompatibleFormat fallback for color and depth/stencil",
        ]
        : [
          "browser simultaneous MRT allocation",
          "CardRenderer quality-selected square source RT dimensions and camera aspect",
          "Bloom intermediate descriptor mapping",
          "device format fallback",
        ],
    },
    "mrt-routing": {
      status: officialMrtKnown && mrtOutputAudit && mrtRuntime && drawCoverageAudit
        && passPartitionAudit && sideBackAudit && officialVulkanRuntimeProvenanceComplete ? "proven" : "partial",
      coveredSubscopes: officialMrtKnown
        ? (mrtOutputAudit
          ? (mrtRuntime
            ? (drawCoverageAudit
              ? (passPartitionAudit && sideBackAudit ? 6 + Number(officialVulkanRuntimeProvenanceComplete) : 5)
              : 4)
            : 3)
          : 2)
        : 1,
      totalSubscopes: 7,
      evidence: [
        "official opaque/transparent dual-attachment binding",
        "official prefab/material-keyword selected SPIR-V location 0/1 output matrix",
        "official ShaderLab rtSeparateBlend=false shared RT0 state",
        ...(mrtRuntime ? ["browser simultaneous two-attachment writes and numeric runtime sentinel"] : []),
        ...(drawCoverageAudit ? ["98-draw official category coverage and LensFlare built-in Quad restoration audit"] : []),
        ...(passPartitionAudit && sideBackAudit
          ? ["official opaque/transparent pass partition and exact Side&Back MRT program/runtime coverage"]
          : []),
        ...(officialVulkanRuntimeObserved ? [
          `legacy Vulkan capture contains ${officialVulkanCapture.capture.matchedCardScopes} submitted matching card RenderPass scopes, two color blend attachments, and ${officialVulkanCapture.bestSummary.exactProgram}/${officialVulkanCapture.bestSummary.exactProgramExpected} byte-identical vertex+fragment programs; target provenance is incomplete`,
        ] : []),
      ],
      remaining: passPartitionAudit && sideBackAudit && officialVulkanRuntimeProvenanceComplete
        ? []
        : passPartitionAudit && sideBackAudit && officialVulkanRuntimeObserved
          ? ["capture manifest declaring schema, game package/version, and device/GPU/driver identity"]
        : passPartitionAudit && sideBackAudit
          ? [officialVulkanResult.error || "one target-device Vulkan capture proving the official two-color-attachment draw scope"]
        : ["official opaque/transparent pass partition and exact Side&Back coverage"],
    },
    "draw-order": {
      status: passPartitionAudit ? "partial" : "not-proven",
      coveredSubscopes: passPartitionAudit ? (drawOrderNativeAudit ? 4 + Number(officialVulkanRuntimeObserved) : 2) : 0,
      totalSubscopes: 6,
      evidence: passPartitionAudit ? [
        "official CommonOpaque/CommonTransparent criteria and key priority",
        "runtime SortingLayer/RenderQueue/front-to-back direction routing",
        ...(drawOrderNativeAudit ? [
          "native Float32 distance-key formula and QuantizedFrontToBack most-significant-byte buckets",
          "native raw OptimizeStateChanges branches, transparent ties, and final visible-node/candidate tie-break",
          "official reference-prefab renderer sort fields, non-static-batch/lightmap constants, no-LOD scope, and native-zero distance offsets",
        ] : []),
        ...(drawOrderSymbolAudit
          ? ["official Unity Android Build Support public symbols mapped to the game comparator, distance, input-builder, and sort functions"]
          : []),
        ...(drawOrderMaterialAudit
          ? ["independent official-bundle audit verifies 84 scene rows against 69 serialized Materials and 26 serialized Shaders, including queue, instancing, and keyword state"]
          : []),
        ...(drawOrderCollisionAudit
          ? ["four-card static prefix audit identifies 17 collision groups; all 14 opaque and 3 transparent groups reach OptimizeStateChanges"]
          : []),
        ...(drawOrderPassCandidateAudit
          ? ["official prefab/Shader/native audit proves selected pass index and draw-candidate ordinal are both zero for all 98 reference draws"]
          : []),
        ...(drawOrderProducerAudit
          ? ["official native producer audit pins 20 producer/helper symbols, 107 load/store/pack/control-flow instructions, SortingGroup/SmallMeshID producers, separate regular Renderer/BRG formulas, SRP return paths, and MeshRenderer RendererType=1 propagation"]
          : []),
        ...(drawOrderInstanceIdAudit
          ? ["official Unity/game Remapper audit pins 136 AArch64 instructions, both InstanceID allocation formulas, and proves why static CAB:pathID cannot recover low bytes without the live allocation event stream"]
          : []),
        ...(drawOrderCommandBranchAudit
          ? ["official pass/command audit pins 20 native slices, 113 instruction words, and proves DrawOpaque/DrawTransparent use branchSelector=0 and the hashed Material/Shader state-key formula"]
          : []),
        ...(drawOrderSrpAudit
          ? ["official Shader-reflection/native audit proves all 26 canonical Shaders are SRP-batcher incompatible and all 94 draw sort bits are zero"]
          : []),
        ...(drawOrderLocalKeywordAudit
          ? ["official LocalKeywordState audit pins six native functions, independently rebuilds the serialized bitset and XXH32 hash for 84 rows, and verifies all 69 canonical Materials"]
          : []),
        ...(drawOrderCollisionAudit && drawOrderLocalKeywordAudit
          ? ["the 17 unresolved state-key groups are classified exactly as 6 Material+0x17c-only, 3 shared-Shader-InstanceID, and 8 distinct-Shader runtime boundaries"]
          : []),
        ...(drawOrderRuntimeCaptureToolAudit
          ? ["read-only Frida probe is pinned to three PTCGP 1.6.0 libunity functions and six hook words; its strict session-bound importer verifies entry+0x08/entry+0x28, 20,000 descriptor-vs-raw pairs prove the suffix, and a generated 17-group manifest enforces atomic activation"]
          : []),
        ...(officialVulkanCaptureToolAudit
          ? ["read-only Vulkan audit-layer importer validates JSONL, canonical vertex+fragment SPIR-V FNV/SHA/specialization identity, pipeline state, submitted command-buffer scopes, GLB index counts, non-queue-based global assignment, and search truncation"]
          : []),
        ...(officialVulkanRuntimeObserved ? [
          `legacy Eevee Bag capture has ${officialVulkanCapture.bestSummary.exactProgram}/${officialVulkanCapture.bestSummary.exactProgramExpected} exact programs and uniquely maps ${officialVulkanCapture.bestSummary.exact}/${officialVulkanCapture.bestSummary.expected} draw identities across ${officialVulkanCapture.capture.matchedCardScopes} submitted matching render-pass scopes; Frame-Holo and LensFlare each retain one indistinguishable pair`,
          "captured Side&Back selects the official INSTANCING_ON vertex+fragment variant rather than the serialized empty-keyword baseline",
        ] : []),
      ] : [],
      remaining: drawOrderNativeAudit && officialVulkanRuntimeObserved
        ? [
          "target-device Vulkan captures for the RR, SR, and Pokemon UR reference cards",
          "capture manifest/provenance plus producer identity for the indistinguishable Frame-Holo and LensFlare pairs, and Material/Shader InstanceID inputs for static sort-prefix collision groups",
        ]
        : drawOrderNativeAudit
        ? ["one target-device capture of final draw order plus Material+0x17c and Shader Object InstanceID low bytes for the 17 hashed state-key collision groups; if state keys tie, capture entry+0x28, VisibleNodeIndex, and candidate ordinal"]
        : [
          "Unity 2022.3.62f2 QuantizedFrontToBack bucket input, width, and boundaries",
          "OptimizeStateChanges and final tie-break key equivalence",
          "runtime production and wiring of native sort inputs",
        ],
    },
    "blend-stencil-depth": {
      status: drawStateRuntimeAudit ? "proven" : "partial",
      coveredSubscopes: drawStateRuntimeAudit ? 3 : 2,
      totalSubscopes: 3,
      evidence: [
        "official ShaderLab pass state",
        "audit:render-state source mapping",
        ...(drawStateRuntimeAudit
          ? ["actual WebGL2 draw-call state snapshots and framebuffer probes for blend, depth, cull, stencil masks, and shared MRT"]
          : []),
      ],
      remaining: drawStateRuntimeAudit ? [] : ["captured WebGL draw-state verification"],
    },
    "shader-precision": {
      status: "partial",
      coveredSubscopes: shaderPrecisionAudit && shaderPrecisionRuntime ? 2 : 1,
      totalSubscopes: 3,
      evidence: [
        "SPIRV-Cross precision qualifiers preserved in exact programs",
        ...(shaderPrecisionAudit && shaderPrecisionRuntime ? [
          "14-program RelaxedPrecision/Float16 opcode audit, corrected Glitter mixed qualifiers, and backend-conditional SwiftShader numeric probe",
        ] : []),
      ],
      remaining: ["Adreno/Mali target-device precision, denorm, contraction, and transcendental behavior"],
    },
    "camera-transforms": {
      status: cameraTransformAudit && homographyProgramAudit && ordinaryGyroGateAudit
        && homographyDisplayRuntime && cardDisplayRuntime ? "proven" : "partial",
      coveredSubscopes: cameraTransformAudit
        ? (homographyProgramAudit ? (ordinaryGyroGateAudit ? (cardDisplayRuntime ? 5 : 4) : 3) : 2)
        : 1,
      totalSubscopes: 5,
      evidence: [
        "official IL2CPP constants CameraDistance=1.911506 and Fov=35",
        ...(cameraTransformAudit ? ["official -Z camera, parent Ry180, layer 21, qY*qX, and quaternion clamp audit"] : []),
        ...(ordinaryGyroGateAudit
          ? ["ordinary CommonUICardDetailCard serialized _useGyro=false gate plus official gyro state-machine boundary"]
          : []),
        ...(cardRendererAudit
          ? ["official detail-view CardSizeType Large mapping and quality-selected square source RT formula"]
          : []),
        ...(homographyProgramAudit
          ? ["official PrerenderHomographyCard SPIR-V, H/Hinv Float32 producer, inverse and upload contract"]
          : []),
        ...(touchRotationAudit ? ["official accumulated drag-delta qY*qX touch rotation with direct acosf and 30-degree clamp"] : []),
        ...(homographyWiringAudit ? ["official _clampParallax material branch and CardRenderer RT to _DynamicUITex wiring"] : []),
        ...(homographyDisplayRuntime ? ["numeric WebGL2 Homography geometry/uniform/render-state probes without screenshots"] : []),
        ...(cardDisplayRuntime ? ["fixed source camera/RT, source-only touch root, projected keypoint order, and outer Homography runtime wiring"] : []),
      ],
      remaining: cameraTransformAudit && cardDisplayRuntime
        ? []
        : cameraTransformAudit
          ? ["final browser display/touch wiring"]
        : ["UpdateCameraSettings method", "root/flip/gyro transform order", "PrerenderHomographyCard runtime"],
    },
    "animation-timing": {
      status: animationRuntime && androidLifecycleAudit ? "proven"
        : animationRuntime ? "partial" : "not-proven",
      coveredSubscopes: animationRuntime ? (androidLifecycleAudit ? 5 : 4) : 0,
      totalSubscopes: 5,
      evidence: animationRuntime ? [
        "official GlitterFlowMaps ARM64 methods and prefab fields",
        "SPIR-V FlowParams binding and browser state-machine wiring",
        "official incremental touch rotation and full-hierarchy transform.forward basis conversion",
        "shared TimeManager-scaled Glitter/LensFlare clock with max-delta and suspend/resume tests",
        ...(androidLifecycleAudit ? [
          "official nativePause/UnityPause/UnityPlayerLoop/SetPlayerPause instruction chain and browser visibility adapter",
        ] : []),
      ] : [],
      remaining: androidLifecycleAudit
        ? []
        : ["target Android lifecycle-to-Unity pause dispatch and browser visibility-policy equivalence"],
    },
    "bloom-tone-mapping": {
      status: officialBloomKnown && bloomRuntime && finalBlitRuntime && bloomDirectColorRt
        ? "proven"
        : (officialBloomKnown ? "partial" : "not-proven"),
      coveredSubscopes: officialBloomKnown
        ? (officialBloomConfigurationKnown
          ? (mrtOutputAudit
            ? (mrtRuntime
              ? (bloomRuntime ? (finalBlitRuntime ? (bloomDirectColorRt ? 8 : 7) : 6) : 5)
              : 4)
            : 3)
          : 2)
        : 1,
      totalSubscopes: 8,
      evidence: [
        "official HDR display/tier disabled",
        ...(officialBloomKnown ? ["official Bloom pass graph and SPIR-V math"] : []),
        ...(officialBloomConfigurationKnown ? ["official serialized Bloom membership/volume values, GetBufferSize geometry, and pinned FinalBlit body"] : []),
        ...(mrtOutputAudit ? ["official per-material MRT1 formulas and configured nonzero shader set"] : []),
        ...(bloomRuntime ? ["browser exact pass0-5 programs, five-level RT graph, sheet float32 layout/weights, blur order, and fixed-function blend states"] : []),
        ...(finalBlitRuntime ? ["ResourceManager-to-Material-to-Shader FinalBlit chain, exact textureLod program, scaleBias/mip-0 state, and browser runtime wiring"] : []),
        ...(bloomDirectColorRt ? ["pass 5 direct additive write to RendererData.ColorRT"] : []),
      ],
      remaining: finalBlitRuntime && bloomDirectColorRt
        ? []
        : bloomRuntime
          ? [
            ...(finalBlitRuntime ? [] : ["FinalBlit shader selection, blend semantics, and final presentation program"]),
            ...(bloomDirectColorRt ? [] : ["pass 5 direct additive write to scene ColorRT without a full-size bridge target"]),
          ]
        : ["Bloom sheet weights and complete per-level downsample/blur sizes", "FinalBlit shader selection, blend semantics, and final presentation program"],
    },
    "display-transfer": {
      status: gamma && rawDisplay && uiDefaultFromRtAudit ? "partial" : "not-proven",
      coveredSubscopes: gamma && rawDisplay && uiDefaultFromRtAudit
        ? (cardDisplayRuntime ? (displayTransferStaticAudit && displayTransferRuntime ? 4 : 3) : 2)
        : 0,
      totalSubscopes: 5,
      evidence: [
        "official APKM globalgamemanagers PlayerSettings.m_ActiveColorSpace",
        "official FinalBlit textureLod pass plus exact UI_Default_From_RT outer display program",
        ...(cardDisplayRuntime ? ["browser exact Homography MRT, paired WebGL2 FinalBlit orientation, and canvas presentation wiring"] : []),
        ...(displayTransferStaticAudit && displayTransferRuntime ? [
          "official Vulkan UNORM/SRGB_NONLINEAR surface policy plus browser RGBA8/GL_LINEAR/sRGB opaque compositor-input readback",
        ] : []),
      ],
      remaining: gamma && rawDisplay && uiDefaultFromRtAudit && cardDisplayRuntime
        && displayTransferStaticAudit && displayTransferRuntime
        ? ["target-device swapchain selection, compositor/OS color management, and panel output"]
        : gamma && rawDisplay && uiDefaultFromRtAudit && cardDisplayRuntime
          ? ["browser compositor-input contract", "target-device compositor/OS display color management"]
        : gamma && rawDisplay && uiDefaultFromRtAudit
          ? ["browser outer display runtime wiring", "browser compositor and OS display color management"]
        : ["official display transfer and browser output wiring", "browser compositor and OS display color management"],
    },
  };

  return PIPELINE_PARITY_STAGES.map((id) => {
    const [workClass, relativeCost] = PIPELINE_STAGE_RESEARCH[id];
    const stage = definitions[id];
    return {
      id,
      ...stage,
      affectedVisibleLayers: total,
      advancementCost: {
        class: stage.status === "proven" ? "maintenance" : workClass,
        relative: stage.status === "proven" ? "low" : relativeCost,
        remainingSubscopes: stage.totalSubscopes - stage.coveredSubscopes,
      },
      sourceError: [
        official ? null : officialResult.error,
        (["render-target-formats", "mrt-routing", "bloom-tone-mapping"].includes(id) && !postprocess)
          ? postprocessResult.error
          : null,
      ].filter(Boolean).join("; ") || null,
    };
  });
}

export function sceneId(sceneName) {
  return sceneName.replace(/^scene\.|\.json$/g, "");
}

export function usedGlbMaterials(scene) {
  if (!scene.prefabGlb) return null;
  const file = path.join(ROOT, "public", scene.prefabGlb.replace(/^\//, ""));
  if (!fs.existsSync(file)) return null;
  const buf = fs.readFileSync(file);
  let off = 12;
  let gltf = null;
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32LE(off);
    const type = buf.readUInt32LE(off + 4);
    off += 8;
    if (type === 0x4e4f534a) gltf = JSON.parse(buf.subarray(off, off + len).toString("utf8"));
    off += len;
  }
  if (!gltf) return null;
  const names = (gltf.materials || []).map((m) => m.name);
  const used = new Set();
  for (const mesh of gltf.meshes || []) {
    for (const prim of mesh.primitives || []) {
      const name = names[prim.material];
      if (name) used.add(name);
    }
  }
  return used;
}

export function pct(n, d) {
  return d ? `${(n / d * 100).toFixed(1)}%` : "n/a";
}

export function collectEvidenceRows() {
  const rows = [];
  for (const sceneName of sceneNames) {
    const scene = JSON.parse(fs.readFileSync(path.join(ROOT, "public", sceneName), "utf8"));
    const used = usedGlbMaterials(scene);
    for (const [matName, mat] of Object.entries(scene.materials || {})) {
      if (used && !used.has(matName)) continue;
      const shader = mat.shader || "";
      if (!shader) continue;
      const cfg = SHADER[shader];
      if (cfg?.defer) continue;
      if (RUNTIME_SPECIAL_MATERIALS.has(matName)) continue;
      rows.push({
        scene: sceneId(sceneName),
        mat: matName,
        shader,
        kind: cfg?.kind || "",
        dispatched: !!(cfg && cfg.kind),
        // Complete official-program closure is selector-keyed and audited over
        // the all-card inventory. A shader display name is never sufficient.
        transpiledProgram: false,
        urGuarded: UR_CORE_GUARDED.has(shader),
        urRemainderGuarded: UR_REMAINDER_GUARDED.has(shader),
        effectGuarded: EFFECT_GUARDED.has(shader),
        parallaxGuarded: PARALLAX_GUARDED.has(shader),
        flatGuarded: FLAT_GUARDED.has(shader),
        holoGuarded: HOLO_GUARDED.has(shader),
        mrtGuarded: MRT_RGB_GUARDED.has(shader),
      });
    }
  }
  return rows;
}

export function summarizeEvidenceRows(rows) {
  const total = rows.length;
  const partialByteGuarded = rows.filter((r) => !r.transpiledProgram && (
    r.urGuarded || r.urRemainderGuarded || r.effectGuarded ||
    r.parallaxGuarded || r.flatGuarded || r.holoGuarded
  )).length;
  return {
    total,
    dispatched: rows.filter((r) => r.dispatched).length,
    transpiledProgram: rows.filter((r) => r.transpiledProgram).length,
    partialByteGuarded,
    urGuarded: rows.filter((r) => r.urGuarded).length,
    urRemainderGuarded: rows.filter((r) => r.urRemainderGuarded).length,
    effectGuarded: rows.filter((r) => r.effectGuarded).length,
    parallaxGuarded: rows.filter((r) => r.parallaxGuarded).length,
    flatGuarded: rows.filter((r) => r.flatGuarded).length,
    holoGuarded: rows.filter((r) => r.holoGuarded).length,
    mrtGuarded: rows.filter((r) => r.mrtGuarded).length,
    anyOfficialEvidence: rows.filter((r) => r.transpiledProgram || r.urGuarded || r.urRemainderGuarded || r.effectGuarded || r.parallaxGuarded || r.flatGuarded || r.holoGuarded).length,
  };
}

function shaderFamilies(rows, predicate) {
  return [...new Set(rows.filter(predicate).map((row) => row.shader))].sort();
}

export function buildAdvancementCosts(rows = collectEvidenceRows(), pipelineStages = buildPipelineParityStages(rows)) {
  const summary = summarizeEvidenceRows(rows);
  const undispatched = rows.filter((row) => !row.dispatched);
  const notTranspiled = rows.filter((row) => !row.transpiledProgram);
  const withoutOfficialEvidence = rows.filter((row) => !(
    row.transpiledProgram || row.urGuarded || row.urRemainderGuarded ||
    row.effectGuarded || row.parallaxGuarded || row.flatGuarded || row.holoGuarded
  ));
  return {
    model: {
      unit: "work-class-plus-remaining-scope",
      note: "Cost classes describe the required work type; remaining layer/family/stage counts describe scale. They are not time estimates.",
    },
    dispatched: {
      class: undispatched.length ? "renderer-integration" : "maintenance",
      remainingLayers: undispatched.length,
      remainingShaderFamilies: shaderFamilies(undispatched, () => true),
    },
    transpiledOfficialProgram: {
      class: notTranspiled.length ? "shader-reverse-engineering" : "maintenance",
      remainingLayers: notTranspiled.length,
      remainingShaderFamilies: shaderFamilies(notTranspiled, () => true),
      target: "selector-keyed complete official executable closure",
    },
    partialBytecodeGuards: {
      class: summary.partialByteGuarded ? "shader-reverse-engineering" : "maintenance",
      layersToPromote: summary.partialByteGuarded,
      shaderFamiliesToPromote: shaderFamilies(rows, (row) => !row.transpiledProgram && (
        row.urGuarded || row.urRemainderGuarded || row.effectGuarded ||
        row.parallaxGuarded || row.flatGuarded || row.holoGuarded
      )),
      target: "promote partial guards through selector, state, binding and dispatch closure",
    },
    anyOfficialSourceEvidence: {
      class: withoutOfficialEvidence.length ? "source-tracing-and-bytecode-audit" : "maintenance",
      remainingLayers: withoutOfficialEvidence.length,
      remainingShaderFamilies: shaderFamilies(withoutOfficialEvidence, () => true),
    },
    rendererPipelineParity: {
      class: pipelineStages.every((stage) => stage.status === "proven") ? "maintenance" : "runtime-pipeline-research",
      remainingSharedStages: pipelineStages.filter((stage) => stage.status !== "proven").map((stage) => stage.id),
      affectedVisibleLayers: summary.total,
      stages: pipelineStages,
    },
    visualParity: {
      class: "excluded-by-policy",
      remainingAutomatedWork: 0,
      reason: "Screenshot and image-derived auditing is intentionally outside the automatic audit.",
    },
  };
}

export function buildEvidenceReport(rows = collectEvidenceRows()) {
  const {
    total,
    dispatched,
    transpiledProgram,
    partialByteGuarded,
    urGuarded,
    urRemainderGuarded,
    effectGuarded,
    parallaxGuarded,
    flatGuarded,
    holoGuarded,
    mrtGuarded,
    anyOfficialEvidence,
  } = summarizeEvidenceRows(rows);

  const pipelineStages = buildPipelineParityStages(rows);
  const advancementCost = buildAdvancementCosts(rows, pipelineStages);
  const pipelineCounts = Object.fromEntries(["proven", "partial", "not-proven"].map((status) => [
    status,
    pipelineStages.filter((stage) => stage.status === status).length,
  ]));
  return {
    definitionVersion: 4,
    scope: {
      referenceScenes: sceneNames,
      visibleLayers: total,
    },
    implementationEvidence: {
      dispatched: { layers: dispatched, total, advancementCost: advancementCost.dispatched },
      transpiledOfficialProgram: { layers: transpiledProgram, total, advancementCost: advancementCost.transpiledOfficialProgram },
      partialBytecodeGuards: { layers: partialByteGuarded, total, advancementCost: advancementCost.partialBytecodeGuards },
      anyOfficialSourceEvidence: { layers: anyOfficialEvidence, total, advancementCost: advancementCost.anyOfficialSourceEvidence },
    },
    rendererPipelineParity: {
      status: pipelineCounts.proven === pipelineStages.length ? "proven" : "not-proven",
      reason: "Each shared stage is tracked separately; program equivalence cannot substitute for unresolved runtime pipeline stages.",
      counts: pipelineCounts,
      stages: pipelineStages,
      advancementCost: advancementCost.rendererPipelineParity,
    },
    controlledVisualParity: {
      status: "unmeasured",
      officialCaptureCorpus: 0,
      reason: "No controlled official per-pose capture corpus is available to this repository.",
      advancementCost: advancementCost.visualParity,
    },
    gameFidelity: {
      score: null,
      status: "not-claimable",
      reason: "A fidelity score is forbidden until renderer-pipeline parity and controlled official-output comparisons are both evidenced.",
    },
    rows,
    costModel: advancementCost.model,
  };
}

export function printReport(rows = collectEvidenceRows()) {
  const report = buildEvidenceReport(rows);
  const {
    total,
    dispatched,
    transpiledProgram,
    partialByteGuarded,
    urGuarded,
    urRemainderGuarded,
    effectGuarded,
    parallaxGuarded,
    flatGuarded,
    holoGuarded,
    mrtGuarded,
    anyOfficialEvidence,
  } = summarizeEvidenceRows(rows);

  console.log("Renderer implementation evidence (not a game-fidelity score)");
  console.log(`visible layers:       ${total}`);
  console.log(`strategy dispatched:  ${dispatched}/${total} (${pct(dispatched, total)})`);
  console.log(`complete programs:    ${transpiledProgram}/${total} (${pct(transpiledProgram, total)})  selector+state+binding+dispatch closure`);
  console.log(`partial byte guards:  ${partialByteGuarded}/${total} (${pct(partialByteGuarded, total)})  hand ports with selected bytecode invariants`);
  console.log(`UR byte-guarded:      ${urGuarded}/${total} (${pct(urGuarded, total)})`);
  console.log(`UR remainder guarded: ${urRemainderGuarded}/${total} (${pct(urRemainderGuarded, total)})`);
  console.log(`Effect byte-guarded:  ${effectGuarded}/${total} (${pct(effectGuarded, total)})`);
  console.log(`Parallax guarded:     ${parallaxGuarded}/${total} (${pct(parallaxGuarded, total)})`);
  console.log(`Flat/simple guarded:  ${flatGuarded}/${total} (${pct(flatGuarded, total)})`);
  console.log(`Holo byte-guarded:    ${holoGuarded}/${total} (${pct(holoGuarded, total)})`);
  console.log(`RGB MRT guarded:      ${mrtGuarded}/${total} (${pct(mrtGuarded, total)})`);
  console.log(`any official evidence:${String(anyOfficialEvidence).padStart(3)}/${total} (${pct(anyOfficialEvidence, total)})`);
  console.log(`pipeline parity:      ${report.rendererPipelineParity.status}`);
  console.log(`controlled visual:    ${report.controlledVisualParity.status}`);
  console.log("game fidelity score:  NOT CLAIMABLE");
  console.log("reason: static layer evidence does not prove official runtime or final pixels");
  console.log("");
  console.log("advancement cost (work type + remaining scope)");
  console.log(`dispatch:             ${report.implementationEvidence.dispatched.advancementCost.class} · ${report.implementationEvidence.dispatched.advancementCost.remainingLayers} layers`);
  console.log(`complete programs:    ${report.implementationEvidence.transpiledOfficialProgram.advancementCost.class} · ${report.implementationEvidence.transpiledOfficialProgram.advancementCost.remainingLayers} layers / ${report.implementationEvidence.transpiledOfficialProgram.advancementCost.remainingShaderFamilies.length} shader families`);
  console.log(`partial → E2:         ${report.implementationEvidence.partialBytecodeGuards.advancementCost.class} · ${report.implementationEvidence.partialBytecodeGuards.advancementCost.layersToPromote} layers / ${report.implementationEvidence.partialBytecodeGuards.advancementCost.shaderFamiliesToPromote.length} shader families`);
  console.log(`source evidence:      ${report.implementationEvidence.anyOfficialSourceEvidence.advancementCost.class} · ${report.implementationEvidence.anyOfficialSourceEvidence.advancementCost.remainingLayers} layers`);
  console.log(`pipeline parity:      ${report.rendererPipelineParity.advancementCost.class} · ${report.rendererPipelineParity.advancementCost.remainingSharedStages.length} shared stages / ${report.rendererPipelineParity.advancementCost.affectedVisibleLayers} affected layers`);
  console.log(`visual parity:        ${report.controlledVisualParity.advancementCost.class}`);
  console.log("");
  console.log("pipeline stages (status | relative cost | remaining subscopes)");
  for (const stage of report.rendererPipelineParity.stages) {
    console.log(`${stage.id.padEnd(24)} ${stage.status.padEnd(11)} | ${stage.advancementCost.relative.padEnd(9)} | ${stage.advancementCost.remainingSubscopes}/${stage.totalSubscopes}`);
  }
  console.log("");

  const grouped = new Map();
  for (const row of rows) {
    const key = `${row.shader}|${row.kind}|${row.dispatched}|${row.transpiledProgram}|${row.urGuarded}|${row.urRemainderGuarded}|${row.effectGuarded}|${row.parallaxGuarded}|${row.flatGuarded}|${row.holoGuarded}|${row.mrtGuarded}`;
    if (!grouped.has(key)) grouped.set(key, { ...row, count: 0, scenes: new Set(), examples: [] });
    const g = grouped.get(key);
    g.count += 1;
    g.scenes.add(row.scene);
    if (g.examples.length < 3) g.examples.push(row.mat);
  }

  for (const g of [...grouped.values()].sort((a, b) => b.count - a.count || a.shader.localeCompare(b.shader))) {
    const flags = [
      g.dispatched ? "strategy" : "missing",
      g.transpiledProgram ? "official-program" : null,
      g.urGuarded ? "ur-byte-guard" : null,
      g.urRemainderGuarded ? "ur-remainder-byte-guard" : null,
      g.effectGuarded ? "effect-byte-guard" : null,
      g.parallaxGuarded ? "parallax-byte-guard" : null,
      g.flatGuarded ? "flat-byte-guard" : null,
      g.holoGuarded ? "holo-byte-guard" : null,
      g.mrtGuarded ? "mrt-rgb-guard" : null,
    ].filter(Boolean).join(",");
    console.log(`${String(g.count).padStart(2)}  ${g.shader.padEnd(35)} kind=${g.kind.padEnd(16)} ${flags}`);
    console.log(`    scenes=${[...g.scenes].join(",")} e.g. ${g.examples.join(", ")}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(buildEvidenceReport(), null, 2));
  } else {
    printReport();
  }
}
