import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { auditFullRuntimeEvidence } from "./audit-full-runtime-evidence.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_FULL_RUNTIME = path.join(ROOT, "$cache", "full-runtime-evidence.local.json");
const DEFAULT_HOST_PRESENTATION = path.join(ROOT, "$cache", "official-host-presentation.json");
const SHA256 = /^[0-9a-f]{64}$/;

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function requirement(id, label, exactUnits, totalUnits, evidence = [], remaining = []) {
  return {
    id,
    label,
    status: exactUnits === totalUnits ? "exact" : exactUnits > 0 ? "partial-exact" : "runtime-required",
    exactUnits,
    totalUnits,
    evidence,
    remaining,
  };
}

function sameSize(left, right, tolerance = 0) {
  return Array.isArray(left) && Array.isArray(right) && left.length === 2 && right.length === 2
    && left.every((value, index) => Math.abs(value - right[index]) <= tolerance);
}

function inspectHostPresentation(file) {
  if (!fs.existsSync(file)) return { status: "missing", file, errors: ["host presentation manifest is absent"] };
  try {
    const value = readJson(file);
    const errors = [];
    if (value.schema !== "pocket-card-render/official-host-presentation@1") errors.push("schema mismatch");
    if (value.status !== "complete") errors.push("extractor did not complete");
    if (value.classification !== "emulator-host-compositor-only") errors.push("capture boundary is not host-only");
    if (value.api !== "GraphicsAPI.OpenGL") errors.push("capture API is not host OpenGL");
    if (!SHA256.test(value.captureSha256 || "")) errors.push("capture SHA-256 is invalid");
    if (value.pixelDataIncluded !== false) errors.push("manifest must not contain screenshot/pixel data");
    if (value.drawCount !== 2 || value.swapCount !== 1) errors.push("unexpected host action inventory");
    if (value.presentation?.containsGuestShaderDraws !== false) errors.push("host capture overclaims guest draws");
    if (!Array.isArray(value.presentation?.upscales) || value.presentation.upscales.length < 1) {
      errors.push("guest-surface upscale was not observed");
    }
    if (!Array.isArray(value.presentation?.backbuffers)
      || !value.presentation.backbuffers.some((texture) => /_SRGB$/.test(texture.format))) {
      errors.push("sRGB host backbuffer was not observed");
    }
    return { status: errors.length ? "invalid" : "pass", file, value, errors };
  } catch (error) {
    return { status: "invalid", file, errors: [error.message] };
  }
}

export function auditRuntimeDisplayFidelity({
  fullRuntimePath = process.env.PCR_FULL_RUNTIME_EVIDENCE || DEFAULT_FULL_RUNTIME,
  hostPresentationPath = process.env.PCR_OFFICIAL_HOST_PRESENTATION || DEFAULT_HOST_PRESENTATION,
} = {}) {
  const full = auditFullRuntimeEvidence(fullRuntimePath);
  const host = inspectHostPresentation(hostPresentationPath);
  const artifact = full.status === "pass" ? readJson(fullRuntimePath) : null;
  const captures = artifact ? Object.values(artifact.captures) : [];
  const exactCaptureCount = full.status === "pass" ? captures.length : 0;
  const surfaceExact = captures.filter((capture) => {
    const surface = capture.diagnostics.surface;
    const ratio = Math.min(surface.devicePixelRatio, 2);
    return sameSize(surface.drawingBufferSize, surface.canvasBackingSize)
      && sameSize(surface.canvasCssSize, surface.cssViewport, 1)
      && surface.drawingBufferSize.every((value, axis) => (
        Math.abs(value - Math.floor(surface.cssViewport[axis] * ratio)) <= 1
      ));
  }).length;
  const displayExact = captures.filter((capture) => sameSize(
    capture.diagnostics.display.displayTargetSize,
    capture.diagnostics.surface.drawingBufferSize,
  )).length;
  const displayContract = readJson(path.join(ROOT, "public", "render", "card-display-contract.json"));
  const officialProfiles = new Map(Object.values(displayContract.quality_profiles).map((profile) => [
    profile.quality_name,
    profile,
  ]));
  const sourceContractExact = captures.filter((capture) => {
    const diagnostics = capture.diagnostics;
    const selected = officialProfiles.get(diagnostics.quality.selected);
    return selected && sameSize(diagnostics.display.sourceSize, [
      selected.source_render_target_request.width,
      selected.source_render_target_request.height,
    ]);
  }).length;
  const dynamicUiExact = captures.filter((capture) => {
    const diagnostics = capture.diagnostics;
    return sameSize(
      diagnostics.surface.dynamicUITextureSize,
      [diagnostics.tmp.textureWidth, diagnostics.tmp.textureHeight],
    ) && diagnostics.tmp.fallbackCount === 0;
  }).length;
  const officialProfile = displayContract.profiles.ordinary_android_default_middle_without_persisted_override;
  const officialProfileExact = captures.filter((capture) => {
    const diagnostics = capture.diagnostics;
    const request = officialProfile.source_render_target_request;
    return diagnostics.quality.selected === officialProfile.applicability.quality_name
      && sameSize(diagnostics.display.sourceSize, [request.width, request.height]);
  }).length;
  const hostExact = host.status === "pass" ? 1 : 0;

  const requirements = [
    requirement("local-runtime-inventory", "Four source-current no-screenshot browser captures", exactCaptureCount, 4,
      exactCaptureCount ? [`${exactCaptureCount}/4 canonical captures are schema-3 and source-hash-bound`] : [],
      exactCaptureCount === 4 ? [] : ["recapture every canonical scene with schema-3 surface diagnostics"]),
    requirement("css-dpr-drawing-buffer", "CSS viewport, DPR, canvas backing store and WebGL drawing buffer", surfaceExact, 4,
      surfaceExact ? [`${surfaceExact}/4 captures execute the DPR-capped physical backing-store policy`] : [],
      surfaceExact === 4 ? [] : ["close every CSS-to-physical-pixel mismatch"]),
    requirement("display-rt-density", "Display RT reaches the drawing buffer without an extra scale", displayExact, 4,
      displayExact ? [`${displayExact}/4 display targets equal their drawing buffers`] : [],
      displayExact === 4 ? [] : ["remove unintended display-target scaling"]),
    requirement("source-rt-contract", "Runtime source RT matches the selected official quality profile", sourceContractExact, 4,
      sourceContractExact ? [`${sourceContractExact}/4 source targets match their selected official profile dimensions`] : [],
      sourceContractExact === 4 ? [] : ["select an official quality profile and execute its exact source RT dimensions"]),
    requirement("dynamic-ui-density", "DynamicUI/TMP texture follows source quality with zero fallback", dynamicUiExact, 4,
      dynamicUiExact ? [`${dynamicUiExact}/4 DynamicUI texture sizes match TMP runtime evidence`] : [],
      dynamicUiExact === 4 ? [] : ["bind DynamicUI raster density to the source RT quality"]),
    requirement("official-default-quality-active", "Canonical audit runtime selects official ordinary-Android Middle profile", officialProfileExact, 4,
      officialProfileExact ? [`${officialProfileExact}/4 captures select Middle at 1122x1122`] : [],
      officialProfileExact === 4 ? [] : ["canonical audit URLs must select the contract-derived official Middle profile"]),
    requirement("emulator-host-presentation", "BlueStacks host sampling, upscale and sRGB backbuffer chain", hostExact, 1,
      hostExact ? [
        `RenderDoc capture ${host.value.captureSha256} exposes 2 host draws and one SwapBuffers`,
        "the 750x1333 guest surface is sampled into 1080x1920 before an sRGB backbuffer present",
      ] : [], hostExact ? [] : host.errors),
    requirement("guest-vulkan-card-frame", "Guest Vulkan card draw state, descriptors and uniforms", 0, 1, [],
      ["the host capture contains no guest shader draws; obtain a guest/native Vulkan capture"]),
    requirement("native-device-display", "Native device compositor, color management and panel transfer", 0, 1, [],
      ["BlueStacks host presentation is not a native Android display probe"]),
  ];
  const exactUnits = requirements.reduce((sum, item) => sum + item.exactUnits, 0);
  const totalUnits = requirements.reduce((sum, item) => sum + item.totalUnits, 0);
  return {
    schema: "pocket-card-render/runtime-display-fidelity-audit@1",
    status: requirements.every((item) => item.status === "exact") ? "exact" : "partial",
    screenshotPolicy: "No screenshots, thumbnails, image similarity, or captured pixel payloads are scored.",
    exactUnits,
    totalUnits,
    exactPercent: totalUnits ? exactUnits / totalUnits * 100 : 0,
    requirements,
    sources: { fullRuntimePath, hostPresentationPath },
  };
}

function print(report) {
  console.log("Runtime display fidelity audit (no screenshots)");
  console.log(`exact: ${report.exactUnits}/${report.totalUnits} (${report.exactPercent.toFixed(1)}%)`);
  for (const item of report.requirements) {
    console.log(`${item.status.padEnd(16)} ${item.id} ${item.exactUnits}/${item.totalUnits}`);
    for (const line of item.remaining) console.log(`  - ${line}`);
  }
}

const isMain = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  const report = auditRuntimeDisplayFidelity();
  if (process.argv.includes("--json")) console.log(JSON.stringify(report, null, 2));
  else print(report);
  if (process.argv.includes("--require-exact") && report.status !== "exact") process.exitCode = 1;
}
