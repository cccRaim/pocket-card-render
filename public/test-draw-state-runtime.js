window.__drawStateRuntimeState = { done: false, result: null, error: null };
document.getElementById("draw-state-status").textContent = "module-start";
window.__finishDrawStateRuntime = (result, error) => {
  window.__drawStateRuntimeState = { done: true, result, error };
  document.getElementById("draw-state-status").textContent =
    JSON.stringify(window.__drawStateRuntimeState, null, 2);
};

import * as THREE from "three";
import {
  REGION,
  applyCullState,
  applyDepthState,
  applyRenderQueueState,
  applyStencilState,
  setBlend,
  stencilWriter,
} from "./render/context.js";
import {
  OFFICIAL_MRT_DESCRIPTOR,
  createOfficialMrtTarget,
  disposeOfficialMrtTarget,
} from "./render/pipeline/official-mrt.js";

const WIDTH = 8;
const HEIGHT = 8;
const SAMPLE_Y = 4;
const LEFT_X = 1;
const RIGHT_X = 6;
const PIXEL_TOLERANCE = 2;

const PROBE = Object.freeze({
  clear0: [32, 64, 96, 192].map((value) => value / 255),
  clear1: [144, 24, 80, 160].map((value) => value / 255),
  source0: [176, 48, 112, 96].map((value) => value / 255),
  source1: [40, 184, 72, 144].map((value) => value / 255),
  marker0: [208, 120, 40, 255].map((value) => value / 255),
  marker1: [24, 136, 224, 255].map((value) => value / 255),
});

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function makeGeometry(positions) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  return geometry;
}

const FULL_GEOMETRY = makeGeometry([
  -1, -1, 0, 1, -1, 0, -1, 1, 0,
  -1, 1, 0, 1, -1, 0, 1, 1, 0,
]);
const MIXED_WINDING_GEOMETRY = makeGeometry([
  -1, -1, 0, 0, -1, 0, -0.5, 1, 0,
  0, -1, 0, 0.5, 1, 0, 1, -1, 0,
]);

function makeProbeMaterial(rt0, rt1) {
  return new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: {
      uRt0: { value: new THREE.Vector4(...rt0) },
      uRt1: { value: new THREE.Vector4(...rt1) },
    },
    vertexShader: `
      in vec3 position;
      void main() { gl_Position = vec4(position, 1.0); }
    `,
    fragmentShader: `
      precision highp float;
      uniform vec4 uRt0;
      uniform vec4 uRt1;
      layout(location = 0) out vec4 outRt0;
      layout(location = 1) out vec4 outRt1;
      void main() {
        outRt0 = uRt0;
        outRt1 = uRt1;
      }
    `,
    toneMapped: false,
  });
}

function applyRuntimeState(material, testCase) {
  const { config, recipe } = testCase;
  setBlend(
    material,
    config.blend,
    false,
    config.materialBlend ? recipe.floats : undefined,
  );
  assert(applyRenderQueueState(material, recipe.queue), `${testCase.id}: invalid render queue`);
  const depthApplied = applyDepthState(material, recipe.floats);
  const cullApplied = applyCullState(
    material,
    recipe.floats,
    config.cull ?? 2,
    !!config.materialCull,
  );
  const stencilApplied = applyStencilState(material, recipe);
  return { depthApplied, cullApplied, stencilApplied };
}

function makeMesh(label, geometry, material, renderOrder = 0) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = renderOrder;
  mesh.onBeforeRender = () => { activeDrawLabel = label; };
  mesh.onAfterRender = () => { activeDrawLabel = null; };
  return mesh;
}

function firstSetBit(value) {
  for (let bit = 1; bit <= 0x80; bit <<= 1) {
    if (value & bit) return bit;
  }
  return 0;
}

function glEnumName(gl, value) {
  const names = [
    "ZERO", "ONE", "SRC_COLOR", "ONE_MINUS_SRC_COLOR", "DST_COLOR",
    "ONE_MINUS_DST_COLOR", "SRC_ALPHA", "ONE_MINUS_SRC_ALPHA", "DST_ALPHA",
    "ONE_MINUS_DST_ALPHA", "SRC_ALPHA_SATURATE", "FUNC_ADD", "FUNC_SUBTRACT",
    "FUNC_REVERSE_SUBTRACT", "MIN", "MAX", "NEVER", "LESS", "EQUAL",
    "LEQUAL", "GREATER", "NOTEQUAL", "GEQUAL", "ALWAYS", "KEEP", "REPLACE",
    "INCR", "DECR", "INVERT", "INCR_WRAP", "DECR_WRAP", "FRONT", "BACK",
    "FRONT_AND_BACK", "CCW", "CW", "BACK", "NONE", "COLOR_ATTACHMENT0",
    "COLOR_ATTACHMENT1", "FRAMEBUFFER_COMPLETE",
  ];
  for (const name of names) {
    if (gl[name] === value) return name;
  }
  return `0x${Number(value).toString(16)}`;
}

function snapshotDrawState(gl, method, args) {
  const drawBuffers = [];
  for (let index = 0; index < OFFICIAL_MRT_DESCRIPTOR.count; index += 1) {
    drawBuffers.push(gl.getParameter(gl.DRAW_BUFFER0 + index));
  }
  return {
    label: activeDrawLabel,
    method,
    args: Array.from(args, Number),
    framebufferStatus: gl.checkFramebufferStatus(gl.DRAW_FRAMEBUFFER),
    drawBuffers,
    blend: {
      enabled: gl.isEnabled(gl.BLEND),
      equationRGB: gl.getParameter(gl.BLEND_EQUATION_RGB),
      equationAlpha: gl.getParameter(gl.BLEND_EQUATION_ALPHA),
      srcRGB: gl.getParameter(gl.BLEND_SRC_RGB),
      dstRGB: gl.getParameter(gl.BLEND_DST_RGB),
      srcAlpha: gl.getParameter(gl.BLEND_SRC_ALPHA),
      dstAlpha: gl.getParameter(gl.BLEND_DST_ALPHA),
      colorMask: Array.from(gl.getParameter(gl.COLOR_WRITEMASK), Boolean),
    },
    depth: {
      enabled: gl.isEnabled(gl.DEPTH_TEST),
      func: gl.getParameter(gl.DEPTH_FUNC),
      writeMask: gl.getParameter(gl.DEPTH_WRITEMASK),
    },
    cull: {
      enabled: gl.isEnabled(gl.CULL_FACE),
      mode: gl.getParameter(gl.CULL_FACE_MODE),
      frontFace: gl.getParameter(gl.FRONT_FACE),
    },
    stencil: {
      enabled: gl.isEnabled(gl.STENCIL_TEST),
      func: gl.getParameter(gl.STENCIL_FUNC),
      ref: gl.getParameter(gl.STENCIL_REF),
      readMask: gl.getParameter(gl.STENCIL_VALUE_MASK),
      writeMask: gl.getParameter(gl.STENCIL_WRITEMASK),
      fail: gl.getParameter(gl.STENCIL_FAIL),
      depthFail: gl.getParameter(gl.STENCIL_PASS_DEPTH_FAIL),
      depthPass: gl.getParameter(gl.STENCIL_PASS_DEPTH_PASS),
    },
  };
}

function namedSnapshot(gl, snapshot) {
  const out = clone(snapshot);
  out.framebufferStatusName = glEnumName(gl, snapshot.framebufferStatus);
  out.drawBufferNames = snapshot.drawBuffers.map((value) => glEnumName(gl, value));
  for (const field of ["equationRGB", "equationAlpha", "srcRGB", "dstRGB", "srcAlpha", "dstAlpha"]) {
    out.blend[`${field}Name`] = glEnumName(gl, snapshot.blend[field]);
  }
  out.depth.funcName = glEnumName(gl, snapshot.depth.func);
  out.cull.modeName = glEnumName(gl, snapshot.cull.mode);
  out.cull.frontFaceName = glEnumName(gl, snapshot.cull.frontFace);
  for (const field of ["func", "fail", "depthFail", "depthPass"]) {
    out.stencil[`${field}Name`] = glEnumName(gl, snapshot.stencil[field]);
  }
  return out;
}

function factorVector(symbol, source, destination) {
  const one = [1, 1, 1, 1];
  const zero = [0, 0, 0, 0];
  const invert = (value) => value.map((channel) => 1 - channel);
  switch (symbol) {
    case "ZERO": return zero;
    case "ONE": return one;
    case "SRC_COLOR": return source;
    case "ONE_MINUS_SRC_COLOR": return invert(source);
    case "DST_COLOR": return destination;
    case "ONE_MINUS_DST_COLOR": return invert(destination);
    case "SRC_ALPHA": return one.map(() => source[3]);
    case "ONE_MINUS_SRC_ALPHA": return one.map(() => 1 - source[3]);
    case "DST_ALPHA": return one.map(() => destination[3]);
    case "ONE_MINUS_DST_ALPHA": return one.map(() => 1 - destination[3]);
    case "SRC_ALPHA_SATURATE": {
      const factor = Math.min(source[3], 1 - destination[3]);
      return [factor, factor, factor, 1];
    }
    default: throw new Error(`unsupported blend factor ${symbol}`);
  }
}

function applyEquation(symbol, sourceTerm, destinationTerm) {
  if (symbol === "FUNC_ADD") return sourceTerm + destinationTerm;
  if (symbol === "FUNC_SUBTRACT") return sourceTerm - destinationTerm;
  if (symbol === "FUNC_REVERSE_SUBTRACT") return destinationTerm - sourceTerm;
  if (symbol === "MIN") return Math.min(sourceTerm, destinationTerm);
  if (symbol === "MAX") return Math.max(sourceTerm, destinationTerm);
  throw new Error(`unsupported blend equation ${symbol}`);
}

function expectedPixel(source, destination, blend) {
  const srcRGB = factorVector(blend.srcRGB, source, destination);
  const dstRGB = factorVector(blend.dstRGB, source, destination);
  const srcAlpha = factorVector(blend.srcAlpha, source, destination);
  const dstAlpha = factorVector(blend.dstAlpha, source, destination);
  return source.map((channel, index) => {
    const sourceFactor = index === 3 ? srcAlpha[index] : srcRGB[index];
    const destinationFactor = index === 3 ? dstAlpha[index] : dstRGB[index];
    const equation = index === 3 ? blend.equationAlpha : blend.equationRGB;
    const value = applyEquation(
      equation,
      channel * sourceFactor,
      destination[index] * destinationFactor,
    );
    return Math.round(Math.min(1, Math.max(0, value)) * 255);
  });
}

function bytes(rgba) {
  return rgba.map((channel) => Math.round(channel * 255));
}

let activeDrawLabel = null;

async function inputFromUrl() {
  const params = new URL(location.href).searchParams;
  const inputUrl = params.get("inputUrl");
  if (inputUrl) {
    const response = await fetch(inputUrl);
    assert(response.ok, `could not load draw-state input: ${response.status}`);
    return response.json();
  }
  const encoded = params.get("input");
  if (encoded) {
    const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  }
  return null;
}

async function run() {
  const input = window.__PCR_DRAW_STATE_INPUT__ || await inputFromUrl();
  assert(input?.schemaVersion === 1, "missing draw-state audit input");
  const requireSwiftShader =
    new URL(location.href).searchParams.get("requireSwiftShader") === "1";

  const canvas = document.getElementById("draw-state");
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false,
    alpha: true,
    depth: true,
    stencil: true,
  });
  renderer.setSize(WIDTH, HEIGHT, false);
  renderer.autoClear = false;
  const gl = renderer.getContext();
  assert(typeof gl.drawBuffers === "function", "WebGL2 drawBuffers is unavailable");
  assert(String(THREE.REVISION) === "165", `expected three r165, got r${THREE.REVISION}`);

  const debugInfo = gl.getExtension("WEBGL_debug_renderer_info");
  const glVendor = debugInfo
    ? gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL)
    : gl.getParameter(gl.VENDOR);
  const glRenderer = debugInfo
    ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL)
    : gl.getParameter(gl.RENDERER);

  const target = createOfficialMrtTarget(renderer, WIDTH, HEIGHT);
  const captures = [];
  const originals = new Map();
  for (const method of ["drawArrays", "drawElements", "drawArraysInstanced", "drawElementsInstanced"]) {
    if (typeof gl[method] !== "function") continue;
    const original = gl[method];
    originals.set(method, original);
    gl[method] = function drawStateHook(...args) {
      if (activeDrawLabel) captures.push(snapshotDrawState(gl, method, args));
      return original.apply(gl, args);
    };
    assert(gl[method] !== original, `could not hook WebGL2.${method}`);
  }

  const failures = [];
  const checks = [];
  const caseResults = {};
  const record = (condition, label, detail = "") => {
    checks.push({ ok: !!condition, label, detail });
    if (!condition) failures.push(detail ? `${label}: ${detail}` : label);
  };
  const same = (actual, expected, label) => {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    record(ok, label, ok ? "" : `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  };
  const pixelNear = (actual, expected, label) => {
    const delta = actual.map((value, index) => Math.abs(value - expected[index]));
    record(
      delta.every((value) => value <= PIXEL_TOLERANCE),
      label,
      `expected ${expected.join(",")}, got ${actual.join(",")}, delta ${delta.join(",")}`,
    );
  };

  function resetTarget(clear0 = PROBE.clear0, clear1 = PROBE.clear1, stencil = 0) {
    renderer.setRenderTarget(null);
    renderer.state.reset();
    renderer.setRenderTarget(target);
    gl.viewport(0, 0, WIDTH, HEIGHT);
    gl.disable(gl.SCISSOR_TEST);
    gl.colorMask(true, true, true, true);
    gl.depthMask(true);
    gl.stencilMask(0xff);
    gl.clearBufferfv(gl.COLOR, 0, new Float32Array(clear0));
    gl.clearBufferfv(gl.COLOR, 1, new Float32Array(clear1));
    gl.clearBufferfi(gl.DEPTH_STENCIL, 0, 1, stencil);
  }

  function clearColors(clear0 = PROBE.clear0, clear1 = PROBE.clear1) {
    gl.colorMask(true, true, true, true);
    gl.clearBufferfv(gl.COLOR, 0, new Float32Array(clear0));
    gl.clearBufferfv(gl.COLOR, 1, new Float32Array(clear1));
  }

  function seedLeftStencil(passValue, failValue) {
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(0, 0, WIDTH, HEIGHT);
    gl.clearBufferiv(gl.STENCIL, 0, new Int32Array([failValue]));
    gl.scissor(0, 0, WIDTH / 2, HEIGHT);
    gl.clearBufferiv(gl.STENCIL, 0, new Int32Array([passValue]));
    gl.disable(gl.SCISSOR_TEST);
  }

  function readAttachment(index, x, y) {
    const pixel = new Uint8Array(4);
    gl.readBuffer(gl.COLOR_ATTACHMENT0 + index);
    gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    return Array.from(pixel);
  }

  function findCaptures(label, start) {
    return captures.slice(start).filter((capture) => capture.label === label);
  }

  function checkCommonState(testCase, capture, parts) {
    const expected = testCase.expected;
    same(capture.drawBufferNames, expected.drawBuffers, `${testCase.id} draw buffers`);
    same(capture.framebufferStatusName, "FRAMEBUFFER_COMPLETE", `${testCase.id} framebuffer`);
    if (parts.includes("blend")) {
      same(capture.blend.enabled, expected.blend.enabled, `${testCase.id} BLEND enable`);
      for (const field of ["equationRGB", "equationAlpha", "srcRGB", "dstRGB", "srcAlpha", "dstAlpha"]) {
        same(capture.blend[`${field}Name`], expected.blend[field], `${testCase.id} blend ${field}`);
      }
      same(capture.blend.colorMask, expected.blend.colorMask, `${testCase.id} color mask`);
    }
    if (parts.includes("depth")) {
      same(capture.depth.enabled, expected.depth.enabled, `${testCase.id} DEPTH_TEST enable`);
      if (expected.depth.enabled) same(capture.depth.funcName, expected.depth.func, `${testCase.id} depth func`);
      same(capture.depth.writeMask, expected.depth.writeMask, `${testCase.id} depth write mask`);
    }
    if (parts.includes("cull")) {
      same(capture.cull.enabled, expected.cull.enabled, `${testCase.id} CULL_FACE enable`);
      if (expected.cull.enabled) same(capture.cull.modeName, expected.cull.mode, `${testCase.id} cull mode`);
      same(capture.cull.frontFaceName, expected.cull.frontFace, `${testCase.id} front face`);
    }
    if (parts.includes("stencil")) {
      same(capture.stencil.enabled, expected.stencil.enabled, `${testCase.id} STENCIL_TEST enable`);
      if (expected.stencil.enabled) {
        same(capture.stencil.funcName, expected.stencil.func, `${testCase.id} stencil func`);
        same(capture.stencil.ref, expected.stencil.ref, `${testCase.id} stencil ref`);
        same(capture.stencil.readMask & 0xff, expected.stencil.readMask, `${testCase.id} stencil read mask`);
        same(capture.stencil.writeMask & 0xff, expected.stencil.writeMask, `${testCase.id} stencil write mask`);
        same(capture.stencil.failName, expected.stencil.fail, `${testCase.id} stencil fail`);
        same(capture.stencil.depthFailName, expected.stencil.depthFail, `${testCase.id} stencil depth-fail`);
        same(capture.stencil.depthPassName, expected.stencil.depthPass, `${testCase.id} stencil depth-pass`);
      }
    }
  }

  function runSingleDraw(testCase, geometry, source0 = PROBE.source0, source1 = PROBE.source1) {
    resetTarget();
    const material = makeProbeMaterial(source0, source1);
    const applied = applyRuntimeState(material, testCase);
    const label = `${testCase.id}:draw`;
    const scene = new THREE.Scene();
    const mesh = makeMesh(label, geometry, material);
    scene.add(mesh);
    const start = captures.length;
    renderer.render(scene, new THREE.Camera());
    gl.finish();
    const drawCaptures = findCaptures(label, start).map((capture) => namedSnapshot(gl, capture));
    const pixels = {
      rt0Left: readAttachment(0, LEFT_X, SAMPLE_Y),
      rt0Right: readAttachment(0, RIGHT_X, SAMPLE_Y),
      rt1Left: readAttachment(1, LEFT_X, SAMPLE_Y),
      rt1Right: readAttachment(1, RIGHT_X, SAMPLE_Y),
    };
    const materialState = {
      transparent: material.transparent,
      side: material.side,
      forceSinglePass: material.forceSinglePass,
      applied,
    };
    scene.remove(mesh);
    material.dispose();
    return { drawCaptures, pixels, materialState };
  }

  try {
    const opaque = input.cases.opaque;
    const opaqueResult = runSingleDraw(opaque, FULL_GEOMETRY);
    same(opaqueResult.drawCaptures.length, 1, "opaque draw count");
    if (opaqueResult.drawCaptures[0]) {
      checkCommonState(opaque, opaqueResult.drawCaptures[0], ["blend", "depth", "cull", "stencil"]);
    }
    same(opaqueResult.materialState.transparent, opaque.expected.queueTransparent, "opaque queue partition");
    pixelNear(
      opaqueResult.pixels.rt0Left,
      expectedPixel(PROBE.source0, PROBE.clear0, opaque.expected.blend),
      "opaque RT0 result",
    );
    caseResults.opaque = opaqueResult;

    const transparent = input.cases.transparent;
    const transparentResult = runSingleDraw(transparent, FULL_GEOMETRY);
    same(transparentResult.drawCaptures.length, 1, "transparent draw count");
    if (transparentResult.drawCaptures[0]) {
      checkCommonState(transparent, transparentResult.drawCaptures[0], ["blend", "depth", "cull", "stencil"]);
    }
    same(
      transparentResult.materialState.transparent,
      transparent.expected.queueTransparent,
      "transparent queue partition",
    );
    pixelNear(
      transparentResult.pixels.rt0Left,
      expectedPixel(PROBE.source0, PROBE.clear0, transparent.expected.blend),
      "transparent RT0 result",
    );
    caseResults.transparent = transparentResult;

    const cullOff = input.cases.cullOff;
    resetTarget();
    const cullScene = new THREE.Scene();
    const writerMaterial = stencilWriter(cullOff.setup.stencilRef);
    const writer = makeMesh("cullOff:stencil-writer", FULL_GEOMETRY, writerMaterial, -1);
    const cullMaterial = makeProbeMaterial(PROBE.source0, PROBE.source1);
    const cullApplied = applyRuntimeState(cullMaterial, cullOff);
    const cullMesh = makeMesh("cullOff:draw", MIXED_WINDING_GEOMETRY, cullMaterial, 1);
    cullScene.add(writer, cullMesh);
    const cullStart = captures.length;
    renderer.render(cullScene, new THREE.Camera());
    gl.finish();
    const cullCaptures = findCaptures("cullOff:draw", cullStart).map((capture) => namedSnapshot(gl, capture));
    const cullPixels = {
      left: readAttachment(0, LEFT_X, SAMPLE_Y),
      right: readAttachment(0, RIGHT_X, SAMPLE_Y),
    };
    same(cullCaptures.length, 1, "CullOff single draw count");
    if (cullCaptures[0]) checkCommonState(cullOff, cullCaptures[0], ["blend", "depth", "cull", "stencil"]);
    same(cullMaterial.forceSinglePass, true, "CullOff forceSinglePass");
    same(cullMaterial.transparent, cullOff.expected.queueTransparent, "CullOff queue partition");
    const cullExpectedPixel = expectedPixel(PROBE.source0, PROBE.clear0, cullOff.expected.blend);
    pixelNear(cullPixels.left, cullExpectedPixel, "CullOff CCW triangle result");
    pixelNear(cullPixels.right, cullExpectedPixel, "CullOff CW triangle result");
    caseResults.cullOff = {
      drawCaptures: cullCaptures,
      pixels: cullPixels,
      materialState: {
        transparent: cullMaterial.transparent,
        side: cullMaterial.side,
        forceSinglePass: cullMaterial.forceSinglePass,
        applied: cullApplied,
      },
    };
    cullScene.remove(writer, cullMesh);
    writerMaterial.dispose();
    cullMaterial.dispose();

    const stencil = input.cases.stencil;
    resetTarget();
    seedLeftStencil(stencil.setup.passValue, stencil.setup.failValue);
    const stencilMaterial = makeProbeMaterial(PROBE.source0, PROBE.source1);
    const stencilApplied = applyRuntimeState(stencilMaterial, stencil);
    const stencilScene = new THREE.Scene();
    const stencilMesh = makeMesh("stencil:draw", FULL_GEOMETRY, stencilMaterial);
    stencilScene.add(stencilMesh);
    const stencilStart = captures.length;
    renderer.render(stencilScene, new THREE.Camera());
    gl.finish();
    const stencilCaptures = findCaptures("stencil:draw", stencilStart).map((capture) => namedSnapshot(gl, capture));
    const stencilPixels = {
      pass: readAttachment(0, LEFT_X, SAMPLE_Y),
      fail: readAttachment(0, RIGHT_X, SAMPLE_Y),
    };
    same(stencilCaptures.length, 1, "stencil draw count");
    if (stencilCaptures[0]) checkCommonState(stencil, stencilCaptures[0], ["stencil"]);
    pixelNear(
      stencilPixels.pass,
      expectedPixel(PROBE.source0, PROBE.clear0, stencil.expected.blend),
      "stencil compare pass pixel",
    );
    pixelNear(stencilPixels.fail, bytes(PROBE.clear0), "stencil compare reject pixel");

    clearColors();
    const preserveBit = stencil.setup.preserveBit;
    assert(preserveBit === firstSetBit(preserveBit), "stencil preservation probe requires one bit");
    const verifyMaterial = makeProbeMaterial(PROBE.marker0, PROBE.marker1);
    setBlend(verifyMaterial, "opaque", false);
    verifyMaterial.depthTest = false;
    verifyMaterial.depthWrite = false;
    verifyMaterial.side = THREE.DoubleSide;
    verifyMaterial.forceSinglePass = true;
    verifyMaterial.stencilWrite = true;
    verifyMaterial.stencilWriteMask = 0;
    verifyMaterial.stencilFunc = THREE.EqualStencilFunc;
    verifyMaterial.stencilRef = preserveBit;
    verifyMaterial.stencilFuncMask = preserveBit;
    verifyMaterial.stencilFail = THREE.KeepStencilOp;
    verifyMaterial.stencilZFail = THREE.KeepStencilOp;
    verifyMaterial.stencilZPass = THREE.KeepStencilOp;
    const verifyScene = new THREE.Scene();
    const verifyMesh = makeMesh("stencil:preservation-probe", FULL_GEOMETRY, verifyMaterial);
    verifyScene.add(verifyMesh);
    renderer.render(verifyScene, new THREE.Camera());
    gl.finish();
    const preservationPixels = {
      pass: readAttachment(0, LEFT_X, SAMPLE_Y),
      fail: readAttachment(0, RIGHT_X, SAMPLE_Y),
    };
    pixelNear(
      preservationPixels.pass,
      expectedPixel(PROBE.marker0, PROBE.clear0, {
        enabled: true,
        equationRGB: "FUNC_ADD",
        equationAlpha: "FUNC_ADD",
        srcRGB: "ONE",
        dstRGB: "ZERO",
        srcAlpha: "ZERO",
        dstAlpha: "ZERO",
      }),
      "stencil write-mask preserves unrelated bit",
    );
    pixelNear(preservationPixels.fail, bytes(PROBE.clear0), "stencil preservation reject pixel");
    caseResults.stencil = {
      drawCaptures: stencilCaptures,
      pixels: stencilPixels,
      preservationPixels,
      materialState: {
        transparent: stencilMaterial.transparent,
        side: stencilMaterial.side,
        forceSinglePass: stencilMaterial.forceSinglePass,
        applied: stencilApplied,
      },
    };
    stencilScene.remove(stencilMesh);
    verifyScene.remove(verifyMesh);
    stencilMaterial.dispose();
    verifyMaterial.dispose();

    const mrt = input.cases.mrtSharedBlend;
    const mrtResult = runSingleDraw(mrt, FULL_GEOMETRY, PROBE.source0, PROBE.source1);
    same(mrtResult.drawCaptures.length, 1, "MRT shared-blend draw count");
    if (mrtResult.drawCaptures[0]) checkCommonState(mrt, mrtResult.drawCaptures[0], ["blend"]);
    const expectedRt0 = expectedPixel(PROBE.source0, PROBE.clear0, mrt.expected.blend);
    const expectedRt1 = expectedPixel(PROBE.source1, PROBE.clear1, mrt.expected.blend);
    pixelNear(mrtResult.pixels.rt0Left, expectedRt0, "MRT shared blend RT0 result");
    pixelNear(mrtResult.pixels.rt1Left, expectedRt1, "MRT shared blend RT1 result");
    record(
      mrtResult.pixels.rt0Left.join(",") !== mrtResult.pixels.rt1Left.join(","),
      "MRT attachments retain independent shader outputs",
    );
    caseResults.mrtSharedBlend = mrtResult;

    const error = gl.getError();
    same(error, gl.NO_ERROR, "final WebGL error");

    const swiftShader = /swiftshader/i.test(`${glVendor} ${glRenderer}`);
    const result = {
      runtime: {
        threeRevision: String(THREE.REVISION),
        webglVersion: gl.getParameter(gl.VERSION),
        shadingLanguageVersion: gl.getParameter(gl.SHADING_LANGUAGE_VERSION),
        vendor: glVendor,
        renderer: glRenderer,
        swiftShader,
        requiredRenderer: requireSwiftShader ? "SwiftShader" : null,
        maxDrawBuffers: gl.getParameter(gl.MAX_DRAW_BUFFERS),
        maxColorAttachments: gl.getParameter(gl.MAX_COLOR_ATTACHMENTS),
        targetDescriptor: OFFICIAL_MRT_DESCRIPTOR,
      },
      provenance: input.provenance,
      selected: Object.fromEntries(
        Object.entries(input.cases).map(([name, testCase]) => [name, testCase.source]),
      ),
      cases: caseResults,
      checks,
      failures,
      scope: {
        proves: [
          "Each passing assertion establishes the named state or framebuffer effect for its selected official draw; failed assertions remain explicit counterevidence.",
          "The snapshots report WebGL2 fixed-function state queried synchronously at the actual draw call.",
          "The byte probes independently test blend output, CullOff winding coverage, stencil accept/reject and masked replacement, and shared MRT blending.",
          `The run used Chromium's reported ${swiftShader ? "SwiftShader" : "hardware-backed ANGLE"} renderer without taking a screenshot.`,
        ],
        doesNotProve: [
          "Visual parity of complete cards, shader formulas, textures, geometry, animation, sorting ties, bloom, or final presentation.",
          "Every material/state combination; these are representative official draws plus a non-default stencil write-mask case.",
          "Parity on native Unity, Vulkan, untested GPUs, other browsers, or three.js revisions other than r165.",
          "Correctness of the official extractor itself beyond the existing static official audits required by the Node orchestrator.",
        ],
      },
    };
    if (requireSwiftShader) {
      record(result.runtime.swiftShader, "SwiftShader runtime", `${glVendor} / ${glRenderer}`);
    }
    result.failures = failures;
    result.checks = checks;
    return result;
  } finally {
    for (const [method, original] of originals) gl[method] = original;
    renderer.setRenderTarget(null);
    disposeOfficialMrtTarget(target);
    renderer.dispose();
    FULL_GEOMETRY.dispose();
    MIXED_WINDING_GEOMETRY.dispose();
  }
}

run().then(
  (result) => window.__finishDrawStateRuntime(result, null),
  (error) => window.__finishDrawStateRuntime(null, {
    message: error.message || String(error),
    stack: error.stack || "",
  }),
);
