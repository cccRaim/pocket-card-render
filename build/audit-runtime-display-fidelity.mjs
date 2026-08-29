import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { auditFullRuntimeEvidence } from "./audit-full-runtime-evidence.mjs";
import {
  FULL_RUNTIME_DEFINITION,
  fullRuntimeOfficialSampleIdentityMatches,
  loadFullRuntimeDefinition,
} from "./full-runtime-sources.mjs";

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

function sameRuntimeDefinition(left, right) {
  return left?.sampleId === right?.sampleId
    && left?.sampleManifestSha256 === right?.sampleManifestSha256
    && left?.canonicalCorpusRelative === right?.canonicalCorpusRelative
    && left?.canonicalCorpusSha256 === right?.canonicalCorpusSha256;
}

function inspectHostPresentation(file, definition) {
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
    if (!fullRuntimeOfficialSampleIdentityMatches(value, definition)) {
      errors.push("host presentation evidence is not bound to the selected official sample");
    }
    return { status: errors.length ? "invalid" : "pass", file, value, errors };
  } catch (error) {
    return { status: "invalid", file, errors: [error.message] };
  }
}

export function auditRuntimeDisplayFidelity({
  fullRuntimePath = process.env.PCR_FULL_RUNTIME_EVIDENCE || DEFAULT_FULL_RUNTIME,
  hostPresentationPath = process.env.PCR_OFFICIAL_HOST_PRESENTATION || DEFAULT_HOST_PRESENTATION,
  officialSampleManifestPath = process.env.PCR_OFFICIAL_SAMPLE_MANIFEST,
  officialSampleDefinition = null,
  fullRuntimeDefinition = FULL_RUNTIME_DEFINITION,
  auditFullRuntime = auditFullRuntimeEvidence,
} = {}) {
  const definition = officialSampleDefinition || loadFullRuntimeDefinition({
    manifestPath: officialSampleManifestPath,
  });
  const canonicalSceneCount = definition.scenes.length;
  const expectedCaptureKeys = definition.scenes
    .map(({ file }) => `${file}|zh_TW`)
    .sort();
  const full = auditFullRuntime(fullRuntimePath);
  const host = inspectHostPresentation(hostPresentationPath, definition);
  const artifact = full.status === "pass" ? readJson(fullRuntimePath) : null;
  const actualCaptureKeys = Object.keys(artifact?.captures || {}).sort();
  const definitionMatchesVerifier = sameRuntimeDefinition(
    definition,
    fullRuntimeDefinition,
  );
  const artifactIdentityMatches = artifact
    ? fullRuntimeOfficialSampleIdentityMatches(artifact, definition)
    : false;
  const captureInventoryMatches = actualCaptureKeys.length === expectedCaptureKeys.length
    && actualCaptureKeys.every((value, index) => value === expectedCaptureKeys[index]);
  const verifiedCaptureCountMatches =
    full.validCaptureCount === canonicalSceneCount;
  const localRuntimeErrors = [];
  if (full.status !== "pass") {
    localRuntimeErrors.push(
      ...((full.errors || []).length
        ? full.errors
        : ["full-runtime evidence did not pass its source/provenance verifier"]),
    );
  }
  if (!definitionMatchesVerifier) {
    localRuntimeErrors.push(
      "full-runtime verifier was initialized for a different official sample; "
        + "start the process with PCR_OFFICIAL_SAMPLE_MANIFEST",
    );
  }
  if (artifact && !artifactIdentityMatches) {
    localRuntimeErrors.push(
      "artifact does not bind the selected sampleId, sample manifest digest, and canonical corpus hash",
    );
  }
  if (artifact && !captureInventoryMatches) {
    localRuntimeErrors.push(
      `capture inventory is not exactly the selected ${canonicalSceneCount}-scene canonical corpus`,
    );
  }
  if (full.status === "pass" && !verifiedCaptureCountMatches) {
    localRuntimeErrors.push(
      `full-runtime verifier did not validate all ${canonicalSceneCount} canonical captures`,
    );
  }
  const localRuntimeEligible = full.status === "pass"
    && definitionMatchesVerifier
    && artifactIdentityMatches
    && captureInventoryMatches
    && verifiedCaptureCountMatches;
  const captures = localRuntimeEligible
    ? expectedCaptureKeys.map((key) => artifact.captures[key])
    : [];
  const exactCaptureCount = captures.length;
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
  const localEvidence = (count, detail) => (
    count > 0
      ? [`${count}/${canonicalSceneCount} ${detail}`]
      : []
  );
  const localRemaining = (count, detail) => {
    if (!localRuntimeEligible) return [...new Set(localRuntimeErrors)];
    return count === canonicalSceneCount ? [] : [detail];
  };

  const requirements = [
    requirement("local-runtime-inventory", `${canonicalSceneCount} source-current no-screenshot canonical captures`,
      exactCaptureCount, canonicalSceneCount,
      localEvidence(exactCaptureCount, "canonical captures are source/provenance-bound"),
      localRemaining(exactCaptureCount, "recapture every selected canonical scene with surface diagnostics")),
    requirement("css-dpr-drawing-buffer", "CSS viewport, DPR, canvas backing store and WebGL drawing buffer",
      surfaceExact, canonicalSceneCount,
      localEvidence(surfaceExact, "captures execute the DPR-capped physical backing-store policy"),
      localRemaining(surfaceExact, "close every CSS-to-physical-pixel mismatch")),
    requirement("display-rt-density", "Display RT reaches the drawing buffer without an extra scale",
      displayExact, canonicalSceneCount,
      localEvidence(displayExact, "display targets equal their drawing buffers"),
      localRemaining(displayExact, "remove unintended display-target scaling")),
    requirement("source-rt-contract", "Runtime source RT matches the selected official quality profile",
      sourceContractExact, canonicalSceneCount,
      localEvidence(sourceContractExact, "source targets match their selected official profile dimensions"),
      localRemaining(sourceContractExact,
        "select an official quality profile and execute its exact source RT dimensions")),
    requirement("dynamic-ui-density", "DynamicUI/TMP texture follows source quality with zero fallback",
      dynamicUiExact, canonicalSceneCount,
      localEvidence(dynamicUiExact, "DynamicUI texture sizes match TMP runtime evidence"),
      localRemaining(dynamicUiExact, "bind DynamicUI raster density to the source RT quality")),
    requirement("official-default-quality-active",
      "Canonical audit runtime selects official ordinary-Android Middle profile",
      officialProfileExact, canonicalSceneCount,
      localEvidence(officialProfileExact, "captures select Middle at 1122x1122"),
      localRemaining(officialProfileExact,
        "canonical audit URLs must select the contract-derived official Middle profile")),
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
    fidelityPercent: null,
    fidelityPercentUnavailableReason:
      "guest Vulkan card-frame and native-device display evidence remain external/runtime-required",
    exactUnits,
    totalUnits,
    requirements,
    officialSample: {
      status: definition.sample.status,
      sampleId: definition.sampleId,
      sampleManifestSha256: definition.sampleManifestSha256,
      selection: definition.selectionRelative,
      manifest: definition.manifestRelative,
      canonicalCorpus: {
        path: definition.canonicalCorpusRelative,
        sha256: definition.canonicalCorpusSha256,
        sceneCount: canonicalSceneCount,
      },
    },
    localRuntimeEligibility: {
      status: localRuntimeEligible ? "pass" : "runtime-required",
      definitionMatchesVerifier,
      artifactIdentityMatches,
      captureInventoryMatches,
      verifiedCaptureCountMatches,
      errors: [...new Set(localRuntimeErrors)],
    },
    sources: {
      fullRuntimePath,
      hostPresentationPath,
      officialSampleManifestPath:
        officialSampleManifestPath || definition.selectionRelative,
    },
  };
}

function print(report) {
  console.log("Runtime display fidelity audit (no screenshots)");
  console.log(`exact evidence units: ${report.exactUnits}/${report.totalUnits}`);
  console.log(`fidelity percentage: unavailable (${report.fidelityPercentUnavailableReason})`);
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
