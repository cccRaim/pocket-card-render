import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  CANONICAL_FULL_RUNTIME_SCENES,
  FULL_RUNTIME_OFFICIAL_SAMPLE,
  FULL_RUNTIME_SCHEMA_VERSION,
  fullRuntimeSourceIdentityMatches,
  fullRuntimeSourceFiles,
} from "./full-runtime-sources.mjs";
import {
  FULL_RUNTIME_PROVENANCE_PROTOCOL,
  manifestSetRoot,
  signRuntimeArtifact,
  sourceSetRoot,
  verifyRuntimeArtifact,
} from "./runtime-evidence-provenance.mjs";
import { getOfficialBloomLayout } from "../public/render/pipeline/official-bloom.js";
import { exactManifestHasActiveBloomOutput } from "../public/render/pipeline/bloom-activation.js";
import { officialPortIdentityKey } from "../public/render/official-port-identity.js";
import {
  compileRuntimeMaterialDispatchIndex,
  resolveRuntimeMaterialDispatch,
} from "../public/render/runtime-dispatch-contract.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_ARTIFACT = path.join(ROOT, "$cache", "full-runtime-evidence.local.json");
const DEFAULT_ATTESTATION_KEY = path.join(ROOT, "$cache", "runtime-evidence-provenance.key");
const SHA256 = /^[0-9a-f]{64}$/;
const EXACT_UR_PLATE_SCENE = "scene.cTR_20_000670_00_IIBUINOBAKKU_UR.json";
const BLOOM_PASS_SEQUENCE = Object.freeze([0, 1, 1, 1, 1, 1, 2, 3, 3, 4, 5]);
const PROGRAM_PORT_CONTRACT = JSON.parse(fs.readFileSync(
  path.join(ROOT, "public/shaders/official_program_port_contract.json"),
  "utf8",
));
const RUNTIME_DISPATCH_INDEX = compileRuntimeMaterialDispatchIndex(PROGRAM_PORT_CONTRACT);
const BLOOM_MANIFEST_BY_PORT = new Map(PROGRAM_PORT_CONTRACT.ports.map((row) => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, row.manifest), "utf8"));
  const key = officialPortIdentityKey(manifest.official_selector);
  if (!key || key !== officialPortIdentityKey(row)) {
    throw new Error(`${row.manifest}: Bloom audit port identity mismatch`);
  }
  return [key, manifest];
}));

function sceneUsesCurrentBloomProducer(sceneFile) {
  const scene = JSON.parse(fs.readFileSync(path.join(ROOT, "public", sceneFile), "utf8"));
  return Object.values(scene.materials || {}).some((recipe) => {
    const dispatch = resolveRuntimeMaterialDispatch(RUNTIME_DISPATCH_INDEX, recipe);
    return dispatch?.officialPorts.some((port) => (
      exactManifestHasActiveBloomOutput(BLOOM_MANIFEST_BY_PORT.get(officialPortIdentityKey(port)))
    )) || false;
  });
}

const CANONICAL_BLOOM_SCENES = new Set(
  CANONICAL_FULL_RUNTIME_SCENES
    .filter(({ file }) => sceneUsesCurrentBloomProducer(file))
    .map(({ file }) => file),
);

const BLEND_FACTOR = Object.freeze({
  0: "ZERO", 1: "ONE", 2: "SRC_COLOR", 3: "ONE_MINUS_SRC_COLOR",
  4: "DST_COLOR", 5: "SRC_ALPHA", 6: "ONE_MINUS_SRC_ALPHA",
  7: "DST_ALPHA", 8: "ONE_MINUS_DST_ALPHA", 9: "SRC_ALPHA_SATURATE",
  10: "ONE_MINUS_SRC_ALPHA",
});
const BLEND_OP = Object.freeze({ 0: "FUNC_ADD", 1: "FUNC_SUBTRACT", 2: "FUNC_REVERSE_SUBTRACT", 3: "MIN", 4: "MAX" });
const DEPTH_FUNC = Object.freeze({ 1: "NEVER", 2: "LESS", 3: "EQUAL", 4: "LEQUAL", 5: "GREATER", 6: "NOTEQUAL", 7: "GEQUAL", 8: "ALWAYS" });
const STENCIL_FUNC = Object.freeze({ 1: "NEVER", 2: "LESS", 3: "EQUAL", 4: "LEQUAL", 5: "GREATER", 6: "NOTEQUAL", 7: "GEQUAL", 8: "ALWAYS" });
const STENCIL_OP = Object.freeze({ 0: "KEEP", 1: "ZERO", 2: "REPLACE", 3: "INCR", 4: "DECR", 5: "INVERT", 6: "INCR_WRAP", 7: "DECR_WRAP" });

function sha256(root, relative) {
  return crypto.createHash("sha256").update(fs.readFileSync(path.join(root, relative))).digest("hex");
}

function sameStringArray(actual, expected) {
  return Array.isArray(actual)
    && actual.length === expected.length
    && actual.every((value, index) => value === expected[index]);
}

function sameJson(actual, expected) {
  return JSON.stringify(actual) === JSON.stringify(expected);
}

function officialStateValue(parameter, floats) {
  const value = parameter?.name ? floats?.[parameter.name] : parameter?.val;
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

function validateUrPlateRuntimeDraw(draw, recipe, manifest, prefix, errors) {
  const selector = manifest?.official_selector;
  const executableIdentity = manifest?.official_executable_identity;
  const pass = manifest?.official_pass_runtime;
  if (!selector || !executableIdentity || !pass) {
    errors.push(`${prefix} exact manifest is incomplete`);
    return;
  }
  if (draw?.material?.type !== "RawShaderMaterial" || draw.material.exactShader !== "Card_UR_Plate") {
    errors.push(`${prefix} did not execute the exact RawShaderMaterial`);
  }
  const actualSelector = draw?.material?.officialSelector;
  for (const key of [
    "selectorId", "candidateWitnessId", "subshader", "pass", "shaderIdentity", "programBlobIndex", "parameterBlobIndex",
    "executableId", "semanticExecutableId",
  ]) {
    if (actualSelector?.[key] !== selector[key]) errors.push(`${prefix} selector ${key} mismatch`);
  }
  if (!sameStringArray(actualSelector?.keywords, selector.keywords || [])) {
    errors.push(`${prefix} selector keywords mismatch`);
  }
  if (!sameJson(draw?.material?.officialExecutableIdentity, executableIdentity)) {
    errors.push(`${prefix} executable identity mismatch`);
  }
  if (draw?.material?.officialPassStateSha256 !== pass.source_sha256) {
    errors.push(`${prefix} pass-state source hash mismatch`);
  }
  if (recipe?.official?.shader !== selector.shaderIdentity
    || !sameStringArray([...(recipe?.official?.validKeywords || [])].sort(), [...(selector.keywords || [])].sort())) {
    errors.push(`${prefix} scene shader identity/keywords do not satisfy the selector`);
  }
  for (const sampler of manifest.samplers || []) {
    if (!(sampler in (draw?.uniforms || {}))) errors.push(`${prefix} sampler ${sampler} is absent`);
  }
  const program = draw?.pipeline?.program || {};
  if (program.linked !== true) errors.push(`${prefix} WebGL program is not linked`);
  const activeUniforms = new Map((program.uniforms || []).map((row) => [row.name, row]));
  const activeAttributes = new Map((program.attributes || []).map((row) => [row.name, row]));
  const requiredFieldUniforms = new Set(
    (manifest.official_common_bindings?.constant_buffers || [])
      .flatMap((buffer) => buffer.vectors || [])
      .map((field) => field.name)
      .filter((name) => name && name !== "_WorldSpaceCameraPos"),
  );
  for (const name of requiredFieldUniforms) {
    if (!activeUniforms.has(name)) errors.push(`${prefix} active CBuffer uniform ${name} is absent`);
  }
  for (const name of ["cameraPosition", "modelMatrix", "viewMatrix", "projectionMatrix"]) {
    if (!activeUniforms.has(name)) errors.push(`${prefix} active matrix/camera uniform ${name} is absent`);
  }
  const samplerUnits = new Set();
  const commonTextureDimensions = new Map(
    (manifest.official_common_bindings?.textures || []).map((row) => [row.name, row.dim]),
  );
  for (const [index, sampler] of (manifest.samplers || []).entries()) {
    const active = activeUniforms.get(sampler);
    if (!active) errors.push(`${prefix} active sampler ${sampler} is absent`);
    else {
      const semanticSlot = manifest.sampler_slots?.[index];
      const expectedTarget = commonTextureDimensions.get(semanticSlot) === 4 ? "TEXTURE_CUBE_MAP" : "TEXTURE_2D";
      if (!Number.isInteger(active.value) || active.value < 0 || samplerUnits.has(active.value)) {
        errors.push(`${prefix} sampler ${sampler} texture unit is invalid or duplicated`);
      }
      samplerUnits.add(active.value);
      if (active.samplerBinding?.unit !== active.value
        || active.samplerBinding?.target !== expectedTarget
        || active.samplerBinding?.matchesMaterialTexture !== true
        || !sameJson(active.samplerBinding?.materialTexture, draw?.uniforms?.[sampler])) {
        errors.push(`${prefix} sampler ${sampler} is not bound to its material texture`);
      }
    }
  }
  for (const name of ["position", "normal", "tangent", "uv", "uv1"]) {
    const active = activeAttributes.get(name);
    if (!active || !Number.isInteger(active.location) || active.location < 0) {
      errors.push(`${prefix} active vertex attribute ${name} is absent`);
    }
  }

  const blend = draw?.pipeline?.blend || {};
  const expectedBlend = pass.blend;
  const blendChecks = [
    ["srcRgb", BLEND_FACTOR[officialStateValue(expectedBlend.src_rgb, recipe?.floats)]],
    ["dstRgb", BLEND_FACTOR[officialStateValue(expectedBlend.dst_rgb, recipe?.floats)]],
    ["srcAlpha", BLEND_FACTOR[officialStateValue(expectedBlend.src_alpha, recipe?.floats)]],
    ["dstAlpha", BLEND_FACTOR[officialStateValue(expectedBlend.dst_alpha, recipe?.floats)]],
    ["equationRgb", BLEND_OP[officialStateValue(expectedBlend.op_rgb, recipe?.floats)]],
    ["equationAlpha", BLEND_OP[officialStateValue(expectedBlend.op_alpha, recipe?.floats)]],
  ];
  if (blend.enabled !== true) errors.push(`${prefix} blend is disabled`);
  for (const [key, expected] of blendChecks) {
    if (!expected || blend[key] !== expected) errors.push(`${prefix} blend ${key} mismatch`);
  }
  const colorMask = officialStateValue(expectedBlend.color_mask, recipe?.floats);
  if (!sameJson(blend.colorMask, colorMask === 15 ? [true, true, true, true] : [false, false, false, false])) {
    errors.push(`${prefix} color mask mismatch`);
  }

  const zTest = officialStateValue(pass.depth?.test, recipe?.floats);
  const zWrite = officialStateValue(pass.depth?.write, recipe?.floats);
  if (draw?.pipeline?.depth?.test !== (zTest !== 0)
    || (zTest !== 0 && draw.pipeline.depth.func !== DEPTH_FUNC[zTest])
    || draw?.pipeline?.depth?.write !== (zWrite !== 0)) {
    errors.push(`${prefix} depth state mismatch`);
  }
  const cull = officialStateValue(pass.culling, recipe?.floats);
  const raster = draw?.pipeline?.raster || {};
  if (raster.cullEnabled !== (cull !== 0)
    || (cull === 2 && raster.cullFace !== "BACK")
    || (cull === 1 && raster.cullFace !== "FRONT")) {
    errors.push(`${prefix} cull state mismatch`);
  }

  const stencil = pass.stencil;
  const stencilFunc = officialStateValue(stencil?.generic?.comp, recipe?.floats);
  const stencilOps = ["fail", "zFail", "pass"]
    .map((name) => officialStateValue(stencil?.generic?.[name], recipe?.floats));
  const expectedStencil = {
    func: STENCIL_FUNC[stencilFunc],
    ref: officialStateValue(stencil?.ref, recipe?.floats),
    valueMask: officialStateValue(stencil?.read_mask, recipe?.floats),
    writeMask: officialStateValue(stencil?.write_mask, recipe?.floats),
    fail: STENCIL_OP[officialStateValue(stencil?.generic?.fail, recipe?.floats)],
    depthFail: STENCIL_OP[officialStateValue(stencil?.generic?.zFail, recipe?.floats)],
    pass: STENCIL_OP[officialStateValue(stencil?.generic?.pass, recipe?.floats)],
  };
  const expectedStencilEnabled = stencilFunc !== 8 || stencilOps.some((value) => value !== 0);
  if (draw?.pipeline?.stencil?.enabled !== expectedStencilEnabled
    || !sameJson(draw?.pipeline?.stencil?.front, expectedStencil)
    || !sameJson(draw?.pipeline?.stencil?.back, expectedStencil)) {
    errors.push(`${prefix} stencil state mismatch`);
  }
  if (!sameJson(draw?.pipeline?.drawBuffers, ["0x8ce0", "0x8ce1"])) {
    errors.push(`${prefix} MRT draw-buffer state mismatch`);
  }
}

function positiveSize(value) {
  return Array.isArray(value)
    && value.length === 2
    && value.every((entry) => Number.isInteger(entry) && entry > 0);
}

function positiveFiniteSize(value) {
  return Array.isArray(value)
    && value.length === 2
    && value.every((entry) => Number.isFinite(entry) && entry > 0);
}

function finiteArray(value, length) {
  return Array.isArray(value) && value.length === length && value.every(Number.isFinite);
}

function arraysAlmostEqual(actual, expected, epsilon = 1e-7) {
  return Array.isArray(actual) && Array.isArray(expected)
    && actual.length === expected.length
    && actual.every((value, index) => Number.isFinite(value)
      && Number.isFinite(expected[index])
      && Math.abs(value - expected[index]) <= epsilon);
}

function flattenPoints(points) {
  return Array.isArray(points) ? points.flatMap((point) => Array.isArray(point) ? point : []) : [];
}

function quaternionAngleDegrees(quaternion) {
  if (!finiteArray(quaternion, 4)) return Number.NaN;
  const length = Math.hypot(...quaternion);
  if (!(length > 0)) return Number.NaN;
  const w = Math.min(1, Math.max(-1, Math.abs(quaternion[3] / length)));
  return 2 * Math.acos(w) * 180 / Math.PI;
}

function validatePixelSummary(summary, attachment, expectedSize, label, errors) {
  if (!summary || typeof summary !== "object") {
    errors.push(`${label} pixel summary is absent`);
    return false;
  }
  if (summary.attachment !== attachment) errors.push(`${label} attachment index mismatch`);
  if (!Number.isInteger(summary.width) || !Number.isInteger(summary.height)
    || summary.width <= 0 || summary.height <= 0) {
    errors.push(`${label} dimensions are invalid`);
    return false;
  }
  if (expectedSize && (summary.width !== expectedSize[0] || summary.height !== expectedSize[1])) {
    errors.push(`${label} dimensions disagree with diagnostics`);
  }
  const pixelCount = summary.width * summary.height;
  if (summary.pixelCount !== pixelCount) errors.push(`${label} pixelCount mismatch`);
  if (!Number.isInteger(summary.nonzeroPixels)
    || summary.nonzeroPixels < 0 || summary.nonzeroPixels > pixelCount) {
    errors.push(`${label} nonzeroPixels is invalid`);
  }
  if (!Number.isInteger(summary.alphaNonzero)
    || summary.alphaNonzero < 0 || summary.alphaNonzero > pixelCount) {
    errors.push(`${label} alphaNonzero is invalid`);
  }
  if (!SHA256.test(summary.rgbaSha256 || "")) errors.push(`${label} RGBA SHA-256 is invalid`);
  if (summary.nonzeroPixels > 0) {
    const bounds = summary.bounds;
    if (!Array.isArray(bounds) || bounds.length !== 4
      || !bounds.every(Number.isInteger)
      || bounds[0] < 0 || bounds[1] < 0
      || bounds[2] < bounds[0] || bounds[3] < bounds[1]
      || bounds[2] >= summary.width || bounds[3] >= summary.height) {
      errors.push(`${label} nonempty bounds are invalid`);
    }
  } else if (summary.bounds !== null) {
    errors.push(`${label} empty bounds must be null`);
  }
  return summary.nonzeroPixels > 0;
}

function validateTransformProbeState(state, label, sourceSize, displaySize, errors) {
  if (!state || typeof state !== "object") {
    errors.push(`${label} transform state is absent`);
    return false;
  }
  const errorStart = errors.length;
  if (!Number.isFinite(state.officialTime)) errors.push(`${label} official time is invalid`);
  if (!finiteArray(state.renderObjectQuaternion, 4)) errors.push(`${label} render-object quaternion is invalid`);
  if (!finiteArray(state.displayQuaternion, 4)) errors.push(`${label} display quaternion is invalid`);
  if (!Array.isArray(state.viewportPoints) || state.viewportPoints.length !== 4
    || !state.viewportPoints.every((point) => finiteArray(point, 2))) {
    errors.push(`${label} viewport points are invalid`);
  }
  if (!finiteArray(state.homography, 9) || !finiteArray(state.inverseHomography, 9)) {
    errors.push(`${label} homography matrices are invalid`);
  }
  if (!Array.isArray(state.source?.attachments) || state.source.attachments.length !== 2) {
    errors.push(`${label} source attachment summaries are absent`);
  } else {
    validatePixelSummary(state.source.attachments[0], 0, sourceSize, `${label} source MRT0`, errors);
    validatePixelSummary(state.source.attachments[1], 1, sourceSize, `${label} source MRT1`, errors);
  }
  validatePixelSummary(state.display?.attachment, 0, displaySize, `${label} display MRT0`, errors);
  if (!Number.isInteger(state.localDrawCount) || state.localDrawCount <= 0) {
    errors.push(`${label} local draw count is invalid`);
  }
  return errors.length === errorStart;
}

function expectedBloomDiagnostics(width, height, enabled) {
  const layout = getOfficialBloomLayout(width, height);
  return {
    base: layout.base,
    prefilter: layout.prefilter,
    sheet: layout.sheet,
    levels: layout.levels.map(({ level, width: levelWidth, height: levelHeight, weight }) => ({
      level,
      width: levelWidth,
      height: levelHeight,
      weight,
    })),
    passSequence: enabled ? BLOOM_PASS_SEQUENCE : [],
  };
}

function fixtureFinalBlitSampler(presented) {
  return {
    magFilter: "LINEAR",
    minFilter: "LINEAR",
    wrapS: "CLAMP_TO_EDGE",
    wrapT: "CLAMP_TO_EDGE",
    textureUnit: 0,
    bindChecks: presented ? 1 : 0,
    unbindChecks: presented ? 1 : 0,
  };
}

function validateBloomPipelineDiagnostics(pipelines, sourceSize, displaySize, sceneFile, errors) {
  const source = pipelines?.source;
  const display = pipelines?.display;
  if (!source || !display || !positiveSize(sourceSize) || !positiveSize(displaySize)) return;
  const expectedSource = expectedBloomDiagnostics(
    sourceSize[0],
    sourceSize[1],
    CANONICAL_BLOOM_SCENES.has(sceneFile),
  );
  const expectedDisplay = expectedBloomDiagnostics(displaySize[0], displaySize[1], false);
  for (const [label, actual, expected, presented] of [
    ["source", source, expectedSource, false],
    ["display", display, expectedDisplay, true],
  ]) {
    for (const field of ["base", "prefilter", "sheet", "levels", "passSequence"]) {
      if (!sameJson(actual?.[field], expected[field])) {
        errors.push(`${label} Bloom diagnostics ${field} mismatch`);
      }
    }
    const sampler = actual?.finalBlitSampler;
    if (!sameJson(
      sampler && {
        magFilter: sampler.magFilter,
        minFilter: sampler.minFilter,
        wrapS: sampler.wrapS,
        wrapT: sampler.wrapT,
        textureUnit: sampler.textureUnit,
      },
      {
        magFilter: "LINEAR",
        minFilter: "LINEAR",
        wrapS: "CLAMP_TO_EDGE",
        wrapT: "CLAMP_TO_EDGE",
        textureUnit: 0,
      },
    )) {
      errors.push(`${label} FinalBlit inline sampler mapping mismatch`);
    }
    if (!Number.isInteger(sampler?.bindChecks)
      || !Number.isInteger(sampler?.unbindChecks)
      || sampler.unbindChecks !== sampler.bindChecks
      || (presented ? sampler.bindChecks <= 0 : sampler.bindChecks !== 0)) {
      errors.push(`${label} FinalBlit inline sampler presentation lifecycle mismatch`);
    }
  }
}

function validateCapture(capture, canonical, currentHashes, artifactErrors, runtimeContracts) {
  const errors = [];
  if (artifactErrors.length) errors.push("artifact-level identity is stale or invalid");
  if (!capture || typeof capture !== "object") {
    errors.push("canonical capture is absent");
    return { scene: canonical.file, locale: "zh_TW", status: "invalid", errors };
  }

  const diagnostics = capture.diagnostics || {};
  const scene = diagnostics.scene || {};
  const quality = diagnostics.quality || {};
  const surface = diagnostics.surface || {};
  const mrt = diagnostics.mrt || {};
  const display = diagnostics.display || {};
  const pipelines = diagnostics.pipelines || {};
  const tmp = diagnostics.tmp || {};

  if (capture.scene !== canonical.file || scene.file !== canonical.file) errors.push("scene filename mismatch");
  if (capture.locale !== "zh_TW" || diagnostics.locale !== "zh_TW") errors.push("locale must be zh_TW");
  if (scene.id !== canonical.cardId) errors.push("canonical card identity mismatch");
  if (scene.sha256 !== currentHashes[`public/${canonical.file}`]) errors.push("scene byte hash mismatch");
  if (typeof quality.requested !== "string" || !quality.requested
    || typeof quality.selected !== "string" || !quality.selected
    || !(Number.isFinite(quality.factor) && quality.factor > 0)
    || !Number.isInteger(quality.requestedDisplaySide) || quality.requestedDisplaySide <= 0) {
    errors.push("quality diagnostics are incomplete");
  }
  if (!positiveFiniteSize(surface.cssViewport)
    || !positiveFiniteSize(surface.canvasCssSize)
    || !positiveSize(surface.drawingBufferSize)
    || !positiveSize(surface.canvasBackingSize)
    || !positiveSize(surface.dynamicUITextureSize)
    || !(Number.isFinite(surface.devicePixelRatio) && surface.devicePixelRatio > 0)
    || !(Number.isFinite(surface.rendererPixelRatio) && surface.rendererPixelRatio > 0)) {
    errors.push("surface-density diagnostics are incomplete");
  } else {
    const expectedPixelRatio = Math.min(surface.devicePixelRatio, 2);
    if (Math.abs(surface.rendererPixelRatio - expectedPixelRatio) > 1e-6) {
      errors.push("renderer pixel ratio does not follow the physical-DPR policy");
    }
    if (surface.drawingBufferSize[0] !== surface.canvasBackingSize[0]
      || surface.drawingBufferSize[1] !== surface.canvasBackingSize[1]) {
      errors.push("canvas backing store disagrees with the WebGL drawing buffer");
    }
    for (let axis = 0; axis < 2; axis += 1) {
      const expected = Math.floor(surface.cssViewport[axis] * surface.rendererPixelRatio);
      if (Math.abs(surface.drawingBufferSize[axis] - expected) > 1) {
        errors.push(`drawing buffer axis ${axis} is not derived from CSS viewport x renderer DPR`);
      }
      if (Math.abs(surface.canvasCssSize[axis] - surface.cssViewport[axis]) > 1) {
        errors.push(`canvas CSS axis ${axis} does not fill the viewport`);
      }
    }
  }
  if (mrt.attachments !== 2) errors.push("source MRT must have 2 attachments");
  if (mrt.cardPasses !== 1) errors.push("source renderer must execute exactly 1 card pass");
  if (!positiveSize(display.sourceSize) || !positiveSize(display.displayTargetSize)) {
    errors.push("display target diagnostics are invalid");
  }
  if (display.finiteMatrices !== true
    || !finiteArray(display.homography, 9)
    || !finiteArray(display.inverseHomography, 9)) {
    errors.push("homography matrices are absent or non-finite");
  }
  if (!Array.isArray(display.viewportPoints)
    || display.viewportPoints.length !== 4
    || !display.viewportPoints.every((point) => finiteArray(point, 2))) {
    errors.push("homography viewport points are absent or non-finite");
  }
  if (display.homographyKeypointSpace !== "ModelRenderStudio.Root") {
    errors.push("homography keypoints are not bound to the serialized studio Root space");
  }
  if (!finiteArray(display.renderObjectQuaternion, 4)
    || !finiteArray(display.displayQuaternion, 4)) {
    errors.push("render-object/display transform diagnostics are absent or non-finite");
  }
  if (!Array.isArray(display.webglErrors)) {
    errors.push("frame-boundary WebGL diagnostics are absent");
  } else if (display.webglErrors.length) {
    errors.push("frame-boundary diagnostics contain WebGL errors");
  }
  if (tmp.mode !== "official-tmp-sdf-webgl" || tmp.fallbackCount !== 0) {
    errors.push("TMP renderer used a fallback or wrong mode");
  }
  if (!(tmp.drawCount > 0) || !(tmp.glyphCount > 0)) errors.push("TMP renderer produced no glyph draws");
  if (!pipelines.source || !pipelines.display
    || !Array.isArray(pipelines.source.webglErrors)
    || !Array.isArray(pipelines.display.webglErrors)) {
    errors.push("postprocess diagnostics are absent");
  } else if (pipelines.source.webglErrors.length || pipelines.display.webglErrors.length) {
    errors.push("postprocess diagnostics contain WebGL errors");
  }
  validateBloomPipelineDiagnostics(
    pipelines,
    display.sourceSize,
    display.displayTargetSize,
    canonical.file,
    errors,
  );

  const sourceAttachments = capture.source?.attachments;
  if (!Array.isArray(sourceAttachments) || sourceAttachments.length !== 2) {
    errors.push("source MRT summaries must contain exactly 2 attachments");
  }
  const sourceNonempty = Array.isArray(sourceAttachments)
    ? validatePixelSummary(sourceAttachments[0], 0, display.sourceSize, "source MRT0", errors)
    : false;
  if (Array.isArray(sourceAttachments)) {
    validatePixelSummary(sourceAttachments[1], 1, display.sourceSize, "source MRT1", errors);
  }
  const displayNonempty = validatePixelSummary(
    capture.display?.attachment,
    0,
    display.displayTargetSize,
    "display MRT0",
    errors,
  );
  if (!sourceNonempty) errors.push("source card MRT0 is empty");
  if (!displayNonempty) errors.push("homography/display MRT0 is empty");

  const localDraws = capture.localDraws;
  if (!Array.isArray(localDraws) || localDraws.length === 0) {
    errors.push("local per-draw WebGL trace is absent");
  } else {
    for (const [ordinal, draw] of localDraws.entries()) {
      const prefix = `local draw ${ordinal}`;
      if (draw?.ordinal !== ordinal) errors.push(`${prefix} ordinal mismatch`);
      if (typeof draw?.identity?.materialName !== "string" || !draw.identity.materialName) {
        errors.push(`${prefix} material identity is absent`);
      }
      if (!Number.isInteger(draw?.geometry?.count) || draw.geometry.count <= 0) {
        errors.push(`${prefix} geometry count is invalid`);
      }
      if (!/^[0-9a-f]{8}$/.test(draw?.pipeline?.program?.vertex?.sourceFnv1a32 || "")
        || !/^[0-9a-f]{8}$/.test(draw?.pipeline?.program?.fragment?.sourceFnv1a32 || "")) {
        errors.push(`${prefix} program source signatures are invalid`);
      }
      if (!finiteArray(draw?.pipeline?.viewport, 4) || !finiteArray(draw?.pipeline?.scissor, 4)) {
        errors.push(`${prefix} viewport/scissor is invalid`);
      }
      if (!draw?.pipeline?.blend || !draw?.pipeline?.depth || !draw?.pipeline?.raster || !draw?.pipeline?.stencil) {
        errors.push(`${prefix} fixed-function state is incomplete`);
      }
      if (!Array.isArray(draw?.diagnostics?.webglErrors)) {
        errors.push(`${prefix} WebGL error attribution is absent`);
      } else if (draw.diagnostics.webglErrors.length) {
        errors.push(`${prefix} contains WebGL errors`);
      }
    }
    if (canonical.file === EXACT_UR_PLATE_SCENE) {
      const exactDraws = localDraws.filter((draw) => draw?.identity?.shader === "Card_UR_Plate");
      if (exactDraws.length !== 1) {
        errors.push(`Card_UR_Plate exact draw count is ${exactDraws.length}, expected 1`);
      } else {
        const draw = exactDraws[0];
        const recipe = runtimeContracts.scene.materials?.[draw.identity.materialName];
        if (!recipe) errors.push("Card_UR_Plate scene recipe is absent");
        else validateUrPlateRuntimeDraw(draw, recipe, runtimeContracts.urPlate, "Card_UR_Plate", errors);
      }
    }
  }

  const transformErrorStart = errors.length;
  const transformProbe = capture.transformProbe || {};
  if (transformProbe.clock !== "OfficialClock.advance(0)") {
    errors.push("transform probe did not freeze the official clock");
  }
  if (transformProbe.adapter !== "official-touch-rotation/absolute-pointer") {
    errors.push("transform probe bypassed the official touch adapter");
  }
  if (!arraysAlmostEqual(transformProbe.normalizedTiltPoint, [0.5, -0.25], 0)) {
    errors.push("transform probe tilt point is not the canonical deterministic input");
  }
  const neutral = transformProbe.neutral;
  const tilted = transformProbe.tilted;
  const neutralValid = validateTransformProbeState(
    neutral, "neutral", display.sourceSize, display.displayTargetSize, errors,
  );
  const tiltedValid = validateTransformProbeState(
    tilted, "tilted", display.sourceSize, display.displayTargetSize, errors,
  );
  if (neutralValid && tiltedValid) {
    if (!arraysAlmostEqual(neutral.renderObjectQuaternion, [0, 0, 0, 1], 1e-6)) {
      errors.push("neutral render-object quaternion is not identity");
    }
    const tiltedAngle = quaternionAngleDegrees(tilted.renderObjectQuaternion);
    if (!(tiltedAngle > 1 && tiltedAngle <= 30.0001)) {
      errors.push(`tilted render-object angle is outside the official clamp: ${tiltedAngle}`);
    }
    if (!arraysAlmostEqual(neutral.displayQuaternion, [0, 0, 0, 1], 1e-6)
      || !arraysAlmostEqual(tilted.displayQuaternion, neutral.displayQuaternion, 1e-7)) {
      errors.push("outer display transform changed with the render object");
    }
    if (!arraysAlmostEqual(flattenPoints(tilted.viewportPoints), flattenPoints(neutral.viewportPoints), 1e-7)
      || !arraysAlmostEqual(tilted.homography, neutral.homography, 1e-7)
      || !arraysAlmostEqual(tilted.inverseHomography, neutral.inverseHomography, 1e-7)) {
      errors.push("studio keypoints/homography incorrectly depend on render-object rotation");
    }
    if (tilted.officialTime !== neutral.officialTime) {
      errors.push("official clock changed between neutral and tilted transform states");
    }
    if (tilted.localDrawCount !== neutral.localDrawCount) {
      errors.push("draw topology changed between neutral and tilted transform states");
    }
    if (tilted.source.attachments[0].rgbaSha256 === neutral.source.attachments[0].rgbaSha256) {
      errors.push("source card pixels did not respond to render-object rotation");
    }
    if (tilted.display.attachment.rgbaSha256 === neutral.display.attachment.rgbaSha256) {
      errors.push("display pixels did not carry the tilted source result");
    }
    if (!arraysAlmostEqual(display.renderObjectQuaternion, neutral.renderObjectQuaternion, 1e-7)
      || !arraysAlmostEqual(display.homography, neutral.homography, 1e-7)
      || capture.source?.attachments?.[0]?.rgbaSha256 !== neutral.source.attachments[0].rgbaSha256
      || capture.display?.attachment?.rgbaSha256 !== neutral.display.attachment.rgbaSha256
      || localDraws?.length !== neutral.localDrawCount) {
      errors.push("top-level canonical capture is not the neutral transform state");
    }
  }
  const transformPairExact = errors.length === transformErrorStart;

  return {
    scene: canonical.file,
    locale: capture.locale || "",
    status: errors.length ? "invalid" : "exact-local-runtime",
    transformPairExact,
    errors,
  };
}

export function auditFullRuntimeArtifact(artifact, { root = ROOT, attestationKey = null } = {}) {
  let sourceFiles = [];
  let currentHashes = {};
  const artifactErrors = [];
  let runtimeContracts = { scene: {}, urPlate: {} };
  try {
    sourceFiles = fullRuntimeSourceFiles(root);
    currentHashes = Object.fromEntries(sourceFiles.map((source) => [source, sha256(root, source)]));
    runtimeContracts = {
      scene: JSON.parse(fs.readFileSync(path.join(root, "public", EXACT_UR_PLATE_SCENE), "utf8")),
      urPlate: JSON.parse(fs.readFileSync(path.join(root, "public/shaders/ur_plate_uniforms.json"), "utf8")),
    };
  } catch (error) {
    artifactErrors.push(`cannot build current source inventory: ${error.message}`);
  }

  if (!artifact || typeof artifact !== "object") artifactErrors.push("artifact root is invalid");
  if (artifact?.schemaVersion !== FULL_RUNTIME_SCHEMA_VERSION) artifactErrors.push("unsupported schemaVersion");
  if (artifact?.kind !== "full-card-no-screenshot-runtime") artifactErrors.push("artifact kind mismatch");
  if (artifact?.officialSample !== FULL_RUNTIME_OFFICIAL_SAMPLE) artifactErrors.push("official sample mismatch");
  if (!fullRuntimeSourceIdentityMatches(artifact, sourceFiles, currentHashes)) {
    artifactErrors.push("runtime source inventory is incomplete or stale");
  }
  for (const source of sourceFiles) {
    if (artifact?.sourceHashes?.[source] !== currentHashes[source]) artifactErrors.push(`stale source hash: ${source}`);
  }

  const provenance = artifact?.provenance;
  const currentSourceRoot = sourceSetRoot(currentHashes);
  const currentManifestRoot = manifestSetRoot(currentHashes);
  if (provenance?.protocol !== FULL_RUNTIME_PROVENANCE_PROTOCOL) artifactErrors.push("runtime provenance protocol mismatch");
  if (typeof provenance?.batchId !== "string" || !provenance.batchId) artifactErrors.push("runtime provenance batchId is absent");
  if (!SHA256.test(provenance?.nonceSha256 || "")) artifactErrors.push("runtime provenance nonce hash is invalid");
  if (provenance?.sourceSetSha256 !== currentSourceRoot) artifactErrors.push("runtime provenance source-set root mismatch");
  if (provenance?.manifestSetSha256 !== currentManifestRoot) artifactErrors.push("runtime provenance manifest-set root mismatch");
  const issuedAtMs = Date.parse(provenance?.issuedAt || "");
  const expiresAtMs = Date.parse(provenance?.expiresAt || "");
  const completedAtMs = Date.parse(provenance?.completedAt || "");
  if (!Number.isFinite(issuedAtMs) || !Number.isFinite(expiresAtMs) || !Number.isFinite(completedAtMs)
    || !(issuedAtMs <= completedAtMs && completedAtMs <= expiresAtMs)) {
    artifactErrors.push("runtime provenance time window is invalid");
  }
  let key = attestationKey;
  if (!key) key = fs.existsSync(path.join(root, "$cache", "runtime-evidence-provenance.key"))
    ? fs.readFileSync(path.join(root, "$cache", "runtime-evidence-provenance.key")) : null;
  if (!key || !verifyRuntimeArtifact(artifact, key)) artifactErrors.push("runtime artifact HMAC attestation is missing or invalid");

  const expectedKeys = CANONICAL_FULL_RUNTIME_SCENES.map(({ file }) => `${file}|zh_TW`).sort();
  const actualKeys = Object.keys(artifact?.captures || {}).sort();
  if (!sameStringArray(actualKeys, expectedKeys)) artifactErrors.push("capture inventory must be exactly the four canonical zh_TW scenes");
  if (!sameStringArray(provenance?.captureKeys, expectedKeys)) artifactErrors.push("runtime provenance capture-key set mismatch");
  for (const [captureKey, capture] of Object.entries(artifact?.captures || {})) {
    const capturedAtMs = Date.parse(capture?.capturedAt || "");
    if (capture?.schemaVersion !== FULL_RUNTIME_SCHEMA_VERSION
      || capture?.provenance?.protocol !== FULL_RUNTIME_PROVENANCE_PROTOCOL
      || capture?.provenance?.batchId !== provenance?.batchId
      || capture?.provenance?.sourceSetSha256 !== currentSourceRoot
      || capture?.provenance?.manifestSetSha256 !== currentManifestRoot
      || !Number.isFinite(capturedAtMs) || capturedAtMs < issuedAtMs || capturedAtMs > expiresAtMs) {
      artifactErrors.push(`capture provenance mismatch: ${captureKey}`);
    }
    try {
      const url = new URL(capture?.url);
      const allowed = new Set(["scene", "lc", "auditrt", "quality"]);
      if (url.pathname !== "/" || url.searchParams.get("scene") !== capture?.scene
        || url.searchParams.get("lc") !== "zh_TW" || url.searchParams.get("auditrt") !== "1"
        || [...url.searchParams.keys()].some((name) => !allowed.has(name))
        || (url.searchParams.has("quality") && url.searchParams.get("quality") !== "middle")) {
        artifactErrors.push(`capture URL contract mismatch: ${captureKey}`);
      }
    } catch {
      artifactErrors.push(`capture URL is invalid: ${captureKey}`);
    }
  }

  const captures = CANONICAL_FULL_RUNTIME_SCENES.map((canonical) => validateCapture(
    artifact?.captures?.[`${canonical.file}|zh_TW`],
    canonical,
    currentHashes,
    artifactErrors,
    runtimeContracts,
  ));
  const errors = [
    ...artifactErrors,
    ...captures.flatMap((capture) => capture.errors.map((error) => `${capture.scene}|${capture.locale}: ${error}`)),
  ];
  return {
    status: errors.length ? "invalid" : "pass",
    validCaptureCount: captures.filter((capture) => capture.status === "exact-local-runtime").length,
    captures,
    errors,
  };
}

export function auditFullRuntimeEvidence(file = process.env.PCR_FULL_RUNTIME_EVIDENCE || DEFAULT_ARTIFACT) {
  if (!fs.existsSync(file)) return {
    status: "missing",
    file,
    validCaptureCount: 0,
    captures: [],
    errors: ["full runtime evidence artifact is absent; capture all four canonical scenes with ?auditrt=1&lc=zh_TW"],
  };
  try {
    const report = auditFullRuntimeArtifact(JSON.parse(fs.readFileSync(file, "utf8")));
    return { ...report, file };
  } catch (error) {
    return {
      status: "invalid",
      file,
      validCaptureCount: 0,
      captures: CANONICAL_FULL_RUNTIME_SCENES.map(({ file: scene }) => ({
        scene,
        locale: "zh_TW",
        status: "invalid",
        errors: ["artifact-level JSON is unreadable"],
      })),
      errors: [`artifact-level JSON is unreadable: ${error.message}`],
    };
  }
}

function selfTest() {
  const sourceFiles = fullRuntimeSourceFiles(ROOT);
  const sourceHashes = Object.fromEntries(sourceFiles.map((source) => [source, sha256(ROOT, source)]));
  const sourceSetSha256 = sourceSetRoot(sourceHashes);
  const manifestSetSha256 = manifestSetRoot(sourceHashes);
  const attestationKey = crypto.randomBytes(32);
  const batchId = "full-runtime-self-test";
  const issuedAt = "2026-01-01T00:00:00.000Z";
  const expiresAt = "2026-01-01T00:30:00.000Z";
  const capturedAt = "2026-01-01T00:10:00.000Z";
  const pixel = (attachment, nonzeroPixels = 1, hashDigit = "0") => ({
    attachment,
    width: 2,
    height: 2,
    pixelCount: 4,
    nonzeroPixels,
    alphaNonzero: nonzeroPixels,
    bounds: nonzeroPixels ? [0, 0, 0, 0] : null,
    rgbaSha256: hashDigit.repeat(64),
  });
  const urPlateManifest = JSON.parse(fs.readFileSync(path.join(ROOT, "public/shaders/ur_plate_uniforms.json"), "utf8"));
  const urPlateScene = JSON.parse(fs.readFileSync(path.join(ROOT, "public", EXACT_UR_PLATE_SCENE), "utf8"));
  const [urPlateMaterialName] = Object.entries(urPlateScene.materials)
    .find(([, recipe]) => recipe.shader === "Card_UR_Plate");
  const fixtureDraw = (canonical) => {
    const base = {
      ordinal: 0,
      identity: { materialName: "fixture" },
      geometry: { count: 3 },
      diagnostics: { webglErrors: [] },
      pipeline: {
        program: {
          vertex: { sourceFnv1a32: "00000000" },
          fragment: { sourceFnv1a32: "00000000" },
        },
        viewport: [0, 0, 2, 2],
        scissor: [0, 0, 2, 2],
        blend: {}, depth: {}, raster: {}, stencil: {},
      },
    };
    if (canonical.file !== EXACT_UR_PLATE_SCENE) return base;
    const samplerTextures = Object.fromEntries(urPlateManifest.samplers.map((sampler, index) => [
      sampler,
      {
        kind: urPlateManifest.sampler_slots[index] === "_CubeMap" ? "cube-texture" : "texture",
        name: urPlateManifest.sampler_slots[index],
        sourceUrl: `fixture://${urPlateManifest.sampler_slots[index]}`,
        width: 1,
        height: 1,
        sampler: null,
      },
    ]));
    return {
      ...base,
      identity: { materialName: urPlateMaterialName, shader: "Card_UR_Plate" },
      pipeline: {
        ...base.pipeline,
        program: {
          ...base.pipeline.program,
          linked: true,
          uniforms: [
            ...["cameraPosition", "modelMatrix", "viewMatrix", "projectionMatrix"],
            ...urPlateManifest.official_common_bindings.constant_buffers
              .flatMap((buffer) => buffer.vectors)
              .map((field) => field.name)
              .filter((name) => name !== "_WorldSpaceCameraPos"),
            ...urPlateManifest.samplers,
          ].map((name) => {
            const samplerIndex = urPlateManifest.samplers.indexOf(name);
            const unit = samplerIndex < 0 ? 0 : urPlateManifest.samplers.length - 1 - samplerIndex;
            return {
              name,
              size: 1,
              type: "fixture",
              value: unit,
              samplerBinding: samplerIndex < 0 ? null : {
                unit,
                target: urPlateManifest.sampler_slots[samplerIndex] === "_CubeMap"
                  ? "TEXTURE_CUBE_MAP" : "TEXTURE_2D",
                matchesMaterialTexture: true,
                materialTexture: samplerTextures[name],
              },
            };
          }),
          attributes: ["position", "normal", "tangent", "uv", "uv1"]
            .map((name, location) => ({ name, size: 1, type: "fixture", location })),
        },
        blend: {
          enabled: true,
          srcRgb: "SRC_ALPHA", dstRgb: "ONE_MINUS_SRC_ALPHA",
          srcAlpha: "ZERO", dstAlpha: "ONE_MINUS_SRC_ALPHA",
          equationRgb: "FUNC_ADD", equationAlpha: "FUNC_ADD",
          colorMask: [true, true, true, true],
        },
        depth: { test: true, write: false, func: "LEQUAL" },
        raster: { cullEnabled: true, cullFace: "BACK", frontFace: "CCW" },
        stencil: {
          enabled: true,
          front: { func: "EQUAL", ref: 1, valueMask: 1, writeMask: 255, fail: "KEEP", depthFail: "KEEP", pass: "KEEP" },
          back: { func: "EQUAL", ref: 1, valueMask: 1, writeMask: 255, fail: "KEEP", depthFail: "KEEP", pass: "KEEP" },
        },
        drawBuffers: ["0x8ce0", "0x8ce1"],
      },
      material: {
        type: "RawShaderMaterial",
        exactShader: "Card_UR_Plate",
        officialSelector: {
          selectorId: urPlateManifest.official_selector.selectorId,
          candidateWitnessId: urPlateManifest.official_selector.candidateWitnessId,
          subshader: urPlateManifest.official_selector.subshader,
          pass: urPlateManifest.official_selector.pass,
          shaderIdentity: urPlateManifest.official_selector.shaderIdentity,
          keywords: [...urPlateManifest.official_selector.keywords],
          programBlobIndex: urPlateManifest.official_selector.programBlobIndex,
          parameterBlobIndex: urPlateManifest.official_selector.parameterBlobIndex,
          executableId: urPlateManifest.official_selector.executableId,
          semanticExecutableId: urPlateManifest.official_selector.semanticExecutableId,
        },
        officialExecutableIdentity: structuredClone(urPlateManifest.official_executable_identity),
        officialPassStateSha256: urPlateManifest.official_pass_runtime.source_sha256,
      },
      uniforms: samplerTextures,
    };
  };
  const captures = Object.fromEntries(CANONICAL_FULL_RUNTIME_SCENES.map((canonical) => [
    `${canonical.file}|zh_TW`,
    {
      schemaVersion: FULL_RUNTIME_SCHEMA_VERSION,
      scene: canonical.file,
      locale: "zh_TW",
      url: `http://127.0.0.1:8011/?scene=${canonical.file}&lc=zh_TW&auditrt=1`,
      provenance: {
        protocol: FULL_RUNTIME_PROVENANCE_PROTOCOL,
        batchId,
        sourceSetSha256,
        manifestSetSha256,
      },
      capturedAt,
      diagnostics: {
        scene: { file: canonical.file, id: canonical.cardId, sha256: sourceHashes[`public/${canonical.file}`] },
        locale: "zh_TW",
        quality: { requested: "middle", selected: "Middle", factor: 1, requestedDisplaySide: 2 },
        surface: {
          cssViewport: [2, 2], devicePixelRatio: 1, rendererPixelRatio: 1,
          drawingBufferSize: [2, 2], canvasBackingSize: [2, 2], canvasCssSize: [2, 2],
          dynamicUITextureSize: [2, 2],
        },
        mrt: { attachments: 2, cardPasses: 1, drawCalls: 1 },
        display: {
          sourceSize: [2, 2], displayTargetSize: [2, 2], finiteMatrices: true,
          homography: [1, 0, 0, 0, 1, 0, 0, 0, 1],
          inverseHomography: [1, 0, 0, 0, 1, 0, 0, 0, 1],
          viewportPoints: [[0, 0], [1, 0], [0, 1], [1, 1]],
          homographyKeypointSpace: "ModelRenderStudio.Root",
          renderObjectQuaternion: [0, 0, 0, 1],
          displayQuaternion: [0, 0, 0, 1],
          webglErrors: [],
        },
        pipelines: {
          source: {
            ...expectedBloomDiagnostics(
              2,
              2,
              CANONICAL_BLOOM_SCENES.has(canonical.file),
            ),
            webglErrors: [],
            finalBlitSampler: fixtureFinalBlitSampler(false),
          },
          display: {
            ...expectedBloomDiagnostics(2, 2, false),
            webglErrors: [],
            finalBlitSampler: fixtureFinalBlitSampler(true),
          },
        },
        tmp: { mode: "official-tmp-sdf-webgl", fallbackCount: 0, drawCount: 1, glyphCount: 1 },
      },
      source: { attachments: [pixel(0), pixel(1, 0)] },
      display: { attachment: pixel(0) },
      localDraws: [fixtureDraw(canonical)],
      transformProbe: {
        clock: "OfficialClock.advance(0)",
        adapter: "official-touch-rotation/absolute-pointer",
        normalizedTiltPoint: [0.5, -0.25],
        neutral: {
          officialTime: 0,
          renderObjectQuaternion: [0, 0, 0, 1],
          displayQuaternion: [0, 0, 0, 1],
          viewportPoints: [[0, 0], [1, 0], [0, 1], [1, 1]],
          homography: [1, 0, 0, 0, 1, 0, 0, 0, 1],
          inverseHomography: [1, 0, 0, 0, 1, 0, 0, 0, 1],
          source: { attachments: [pixel(0), pixel(1, 0)] },
          display: { attachment: pixel(0) },
          localDrawCount: 1,
        },
        tilted: {
          officialTime: 0,
          renderObjectQuaternion: [0, -0.13052619222005157, 0, 0.9914448613738104],
          displayQuaternion: [0, 0, 0, 1],
          viewportPoints: [[0, 0], [1, 0], [0, 1], [1, 1]],
          homography: [1, 0, 0, 0, 1, 0, 0, 0, 1],
          inverseHomography: [1, 0, 0, 0, 1, 0, 0, 0, 1],
          source: { attachments: [pixel(0, 1, "1"), pixel(1, 0)] },
          display: { attachment: pixel(0, 1, "2") },
          localDrawCount: 1,
        },
      },
    },
  ]));
  const artifact = {
    schemaVersion: FULL_RUNTIME_SCHEMA_VERSION,
    kind: "full-card-no-screenshot-runtime",
    officialSample: FULL_RUNTIME_OFFICIAL_SAMPLE,
    sourceFiles,
    sourceHashes,
    provenance: {
      protocol: FULL_RUNTIME_PROVENANCE_PROTOCOL,
      batchId,
      nonceSha256: "a".repeat(64),
      issuedAt,
      expiresAt,
      completedAt: capturedAt,
      sourceSetSha256,
      manifestSetSha256,
      captureKeys: Object.keys(captures).sort(),
    },
    captures,
  };
  artifact.attestation = { algorithm: "HMAC-SHA256", keyId: "self-test" };
  artifact.attestation.hmacSha256 = signRuntimeArtifact(artifact, attestationKey);
  const audit = (value) => auditFullRuntimeArtifact(value, { attestationKey });
  const resign = (value) => {
    value.attestation.hmacSha256 = signRuntimeArtifact(value, attestationKey);
    return value;
  };
  const valid = audit(artifact);
  assert.equal(valid.status, "pass", valid.errors.join("\n"));
  assert.equal(valid.validCaptureCount, 4);
  assert.ok(valid.captures.every((capture) => capture.transformPairExact));
  assert.ok(Object.values(artifact.captures).every((capture) => !Object.hasOwn(capture.provenance, "sessionNonce")));

  const bloomSequenceMutation = structuredClone(artifact);
  const bloomCapture = bloomSequenceMutation.captures[
    "scene.cPK_20_008900_02_HOUOUex_UR.json|zh_TW"
  ];
  bloomCapture.diagnostics.pipelines.source.passSequence.pop();
  resign(bloomSequenceMutation);
  assert.match(audit(bloomSequenceMutation).errors.join("\n"), /Bloom diagnostics passSequence mismatch/);

  const finalBlitSamplerMutation = structuredClone(artifact);
  finalBlitSamplerMutation.captures[
    "scene.cPK_20_008900_02_HOUOUex_UR.json|zh_TW"
  ].diagnostics.pipelines.source.finalBlitSampler.minFilter = "NEAREST";
  resign(finalBlitSamplerMutation);
  assert.match(
    audit(finalBlitSamplerMutation).errors.join("\n"),
    /FinalBlit inline sampler mapping mismatch/,
  );

  const unexpectedSourcePresentation = structuredClone(artifact);
  unexpectedSourcePresentation.captures[
    "scene.cPK_20_008900_02_HOUOUex_UR.json|zh_TW"
  ].diagnostics.pipelines.source.finalBlitSampler.bindChecks = 1;
  unexpectedSourcePresentation.captures[
    "scene.cPK_20_008900_02_HOUOUex_UR.json|zh_TW"
  ].diagnostics.pipelines.source.finalBlitSampler.unbindChecks = 1;
  resign(unexpectedSourcePresentation);
  assert.match(
    audit(unexpectedSourcePresentation).errors.join("\n"),
    /source FinalBlit inline sampler presentation lifecycle mismatch/,
  );

  const missingDisplayPresentation = structuredClone(artifact);
  missingDisplayPresentation.captures[
    "scene.cPK_20_008900_02_HOUOUex_UR.json|zh_TW"
  ].diagnostics.pipelines.display.finalBlitSampler.bindChecks = 0;
  missingDisplayPresentation.captures[
    "scene.cPK_20_008900_02_HOUOUex_UR.json|zh_TW"
  ].diagnostics.pipelines.display.finalBlitSampler.unbindChecks = 0;
  resign(missingDisplayPresentation);
  assert.match(
    audit(missingDisplayPresentation).errors.join("\n"),
    /display FinalBlit inline sampler presentation lifecycle mismatch/,
  );

  const tamperedHmac = structuredClone(artifact);
  tamperedHmac.attestation.hmacSha256 = "f".repeat(64);
  assert.match(audit(tamperedHmac).errors.join("\n"), /HMAC attestation/);

  const mixedBatch = structuredClone(artifact);
  mixedBatch.captures[Object.keys(mixedBatch.captures)[0]].provenance.batchId = "another-batch";
  assert.match(audit(resign(mixedBatch)).errors.join("\n"), /capture provenance mismatch/);

  const debugUrl = structuredClone(artifact);
  debugUrl.captures[Object.keys(debugUrl.captures)[0]].url += "&noexact";
  assert.match(audit(resign(debugUrl)).errors.join("\n"), /capture URL contract mismatch/);

  const legacyCompatible = structuredClone(artifact);
  for (const file of ["build/audit-full-runtime-evidence.mjs", "build/full-runtime-sources.mjs", "package-lock.json", "package.json", "server.mjs"]) {
    legacyCompatible.sourceFiles.push(file);
    legacyCompatible.sourceHashes[file] = "f".repeat(64);
  }
  legacyCompatible.sourceFiles.sort();
  assert.equal(audit(resign(legacyCompatible)).status, "pass");

  const unknownExtra = structuredClone(artifact);
  unknownExtra.sourceFiles.push("unrelated.txt");
  unknownExtra.sourceHashes["unrelated.txt"] = "f".repeat(64);
  assert.equal(audit(resign(unknownExtra)).status, "invalid");

  const duplicatedPose = structuredClone(artifact);
  const duplicatedCapture = duplicatedPose.captures[`${CANONICAL_FULL_RUNTIME_SCENES[0].file}|zh_TW`];
  duplicatedCapture.transformProbe.tilted.viewportPoints[0][0] += 0.01;
  duplicatedCapture.transformProbe.tilted.homography[0] += 0.01;
  const duplicatedInvalid = audit(duplicatedPose);
  assert.equal(duplicatedInvalid.status, "invalid");
  assert.match(duplicatedInvalid.errors.join("\n"), /studio keypoints\/homography incorrectly depend/);

  const inertTilt = structuredClone(artifact);
  const inertCapture = inertTilt.captures[`${CANONICAL_FULL_RUNTIME_SCENES[0].file}|zh_TW`];
  inertCapture.transformProbe.tilted.source.attachments[0].rgbaSha256
    = inertCapture.transformProbe.neutral.source.attachments[0].rgbaSha256;
  const inertInvalid = audit(inertTilt);
  assert.equal(inertInvalid.status, "invalid");
  assert.match(inertInvalid.errors.join("\n"), /source card pixels did not respond/);

  const wrongSelector = structuredClone(artifact);
  wrongSelector.captures[`${EXACT_UR_PLATE_SCENE}|zh_TW`]
    .localDraws[0].material.officialSelector.selectorId = "f".repeat(64);
  const selectorInvalid = audit(wrongSelector);
  assert.equal(selectorInvalid.status, "invalid");
  assert.match(selectorInvalid.errors.join("\n"), /selector selectorId mismatch/);

  const wrongPass = structuredClone(artifact);
  wrongPass.captures[`${EXACT_UR_PLATE_SCENE}|zh_TW`]
    .localDraws[0].pipeline.blend.srcRgb = "ONE";
  const passInvalid = audit(wrongPass);
  assert.equal(passInvalid.status, "invalid");
  assert.match(passInvalid.errors.join("\n"), /blend srcRgb mismatch/);

  const stale = structuredClone(artifact);
  stale.sourceHashes[sourceFiles[0]] = "f".repeat(64);
  const invalid = audit(stale);
  assert.equal(invalid.status, "invalid");
  assert.equal(invalid.validCaptureCount, 0);
  assert.ok(invalid.captures.every((capture) => capture.status === "invalid"));

  const missing = auditFullRuntimeEvidence(path.join(ROOT, "$cache", "definitely-absent-full-runtime-evidence.json"));
  assert.equal(missing.status, "missing");
  console.log("Full runtime evidence self-test: pass (paired transforms, mutation rejection, artifact invalidation)");
}

const isMain = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  if (process.argv.includes("--self-test")) {
    selfTest();
  } else {
    const report = auditFullRuntimeEvidence();
    console.log(`Full-card no-screenshot runtime evidence: ${report.status}`);
    console.log(`  valid captures: ${report.validCaptureCount}/4`);
    for (const capture of report.captures) console.log(`  ${capture.status.padEnd(19)} ${capture.scene}|${capture.locale}`);
    for (const error of report.errors) console.log(`  ERROR ${error}`);
    if (report.status === "invalid" || (process.argv.includes("--require") && report.status !== "pass")) process.exitCode = 1;
  }
}
