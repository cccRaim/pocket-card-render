import * as THREE from "three";
import {
  calcHomographyMatrix,
  calcInverseMatrix,
} from "./official-homography.js";

const DEFAULT_URLS = Object.freeze({
  vertex: new URL("../../shaders/homography.vert.glsl", import.meta.url),
  fragment: new URL("../../shaders/homography.frag.glsl", import.meta.url),
  manifest: new URL("../../shaders/homography_program.json", import.meta.url),
});

const BLEND_FACTORS = new Map([
  [0, THREE.ZeroFactor],
  [1, THREE.OneFactor],
  [10, THREE.OneMinusSrcAlphaFactor],
]);
const BLEND_OPERATIONS = new Map([[0, THREE.AddEquation]]);
const DEPTH_TESTS = new Map([[4, THREE.LessEqualDepth]]);
const CULL_MODES = new Map([
  [0, THREE.DoubleSide],
  [1, THREE.BackSide],
  [2, THREE.FrontSide],
]);
const STENCIL_TESTS = new Map([[8, THREE.AlwaysStencilFunc]]);
const STENCIL_OPERATIONS = new Map([[0, THREE.KeepStencilOp]]);
const materialPrograms = new WeakMap();

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function requireCondition(condition, message) {
  if (!condition) throw new Error(`Invalid Homography display contract: ${message}`);
}

function requireLiteral(field, label) {
  requireCondition(field && field.property === null, `${label} must be a serialized literal`);
  return field.value;
}

function mappedValue(map, value, label) {
  requireCondition(map.has(value), `unsupported ${label} value ${value}`);
  return map.get(value);
}

function validateProgram(program) {
  requireCondition(program && typeof program === "object", "program is required");
  requireCondition(typeof program.vertexShader === "string", "vertex shader source is missing");
  requireCondition(typeof program.fragmentShader === "string", "fragment shader source is missing");
  const manifest = program.manifest;
  requireCondition(manifest && typeof manifest === "object", "program manifest is missing");
  requireCondition(manifest.bindings?.homography?.name === "_HomographyMatrix", "H binding name drifted");
  requireCondition(manifest.bindings?.inverse_homography?.name === "_InvHomographyMatrix", "Hinv binding name drifted");
  requireCondition(manifest.bindings?.dynamic_ui_texture?.name === "_DynamicUITex", "texture binding name drifted");
  requireCondition(manifest.bindings.homography.array_length === 9, "H must contain nine floats");
  requireCondition(manifest.bindings.inverse_homography.array_length === 9, "Hinv must contain nine floats");
  requireCondition(manifest.bindings.vertex_attribute?.webgl2 === "uv", "vertex input must use built-in Quad UV0");
  requireCondition(
    JSON.stringify(manifest.bindings.vertex_attribute?.official_indices) === "[0,3,1,3,0,2]"
      && JSON.stringify(manifest.bindings.vertex_attribute?.webgl2_indices) === "[0,1,3,3,2,0]",
    "built-in Quad winding adaptation drifted",
  );
  requireCondition(manifest.mrt?.primary?.location === 0, "primary output must be MRT0");
  requireCondition(manifest.mrt?.secondary?.location === 1, "secondary output must be MRT1");
  requireCondition(manifest.fragment_contract?.alpha === "1.0 - sampled.a", "alpha formula drifted");
  requireCondition(manifest.fragment_contract?.secondary_output === "vec4(0.0)", "MRT1 formula drifted");
  requireCondition(
    /uniform highp float _InvHomographyMatrix\[9\];/.test(program.vertexShader),
    "vertex Hinv declaration is missing",
  );
  requireCondition(
    /uniform highp float _HomographyMatrix\[9\];/.test(program.fragmentShader),
    "fragment H declaration is missing",
  );
  requireCondition(
    /layout\(location = 0\) in vec2 uv;/.test(program.vertexShader)
      && /vec2 _12 = uv;/.test(program.vertexShader),
    "vertex UV0 adaptation is missing",
  );
  requireCondition(
    /sampled = texture\(_DynamicUITex, _63\);/.test(program.fragmentShader),
    "fragment texture sample drifted",
  );
  requireCondition(
    /inverseAlpha = \(-sampled\.w\) \+ 1\.0;/.test(program.fragmentShader),
    "fragment alpha implementation drifted",
  );
  requireCondition(/outAux = vec4\(0\.0\);/.test(program.fragmentShader), "fragment MRT1 implementation drifted");
  return program;
}

async function fetchText(fetchImpl, url, label) {
  const response = await fetchImpl(url);
  if (!response.ok) throw new Error(`${label}: HTTP ${response.status}`);
  return response.text();
}

export async function loadHomographyDisplayProgram({
  fetchImpl = globalThis.fetch,
  vertexUrl = DEFAULT_URLS.vertex,
  fragmentUrl = DEFAULT_URLS.fragment,
  manifestUrl = DEFAULT_URLS.manifest,
} = {}) {
  if (typeof fetchImpl !== "function") throw new TypeError("fetchImpl must be a function");
  const [vertexShader, fragmentShader, manifestText] = await Promise.all([
    fetchText(fetchImpl, vertexUrl, "Homography vertex shader"),
    fetchText(fetchImpl, fragmentUrl, "Homography fragment shader"),
    fetchText(fetchImpl, manifestUrl, "Homography program manifest"),
  ]);
  const program = {
    vertexShader,
    fragmentShader,
    manifest: deepFreeze(JSON.parse(manifestText)),
  };
  validateProgram(program);
  return Object.freeze(program);
}

function calculateMatrices(viewportPoints) {
  const homography = calcHomographyMatrix(viewportPoints);
  const inverseHomography = calcInverseMatrix(homography);
  if (![...homography, ...inverseHomography].every(Number.isFinite)) {
    throw new RangeError("viewportPoints must produce finite H and Hinv matrices");
  }
  return { homography, inverseHomography };
}

function applyRenderState(material, manifest) {
  const state = manifest.render_state;
  requireCondition(state?.blend?.separate === false, "separate MRT blending is unsupported");
  const target = state.blend.targets?.[0];
  requireCondition(target, "RT0 blend state is missing");
  requireCondition(requireLiteral(target.colorMask, "RT0 color mask") === 15, "partial color masks are unsupported");

  material.transparent = manifest.tags?.QUEUE === "Transparent";
  requireCondition(material.transparent, "official queue must be Transparent");
  material.blending = THREE.CustomBlending;
  material.blendSrc = mappedValue(
    BLEND_FACTORS,
    requireLiteral(target.srcColor, "RT0 source color blend"),
    "source color blend",
  );
  material.blendDst = mappedValue(
    BLEND_FACTORS,
    requireLiteral(target.dstColor, "RT0 destination color blend"),
    "destination color blend",
  );
  material.blendSrcAlpha = mappedValue(
    BLEND_FACTORS,
    requireLiteral(target.srcAlpha, "RT0 source alpha blend"),
    "source alpha blend",
  );
  material.blendDstAlpha = mappedValue(
    BLEND_FACTORS,
    requireLiteral(target.dstAlpha, "RT0 destination alpha blend"),
    "destination alpha blend",
  );
  material.blendEquation = mappedValue(
    BLEND_OPERATIONS,
    requireLiteral(target.colorOp, "RT0 color operation"),
    "color blend operation",
  );
  material.blendEquationAlpha = mappedValue(
    BLEND_OPERATIONS,
    requireLiteral(target.alphaOp, "RT0 alpha operation"),
    "alpha blend operation",
  );

  const depthTest = requireLiteral(state.depth?.test, "depth test");
  material.depthTest = depthTest !== 0;
  if (material.depthTest) material.depthFunc = mappedValue(DEPTH_TESTS, depthTest, "depth test");
  material.depthWrite = requireLiteral(state.depth?.write, "depth write") !== 0;
  requireCondition(requireLiteral(state.depth?.clip, "depth clip") === 1, "disabled depth clipping is unsupported");
  material.side = mappedValue(CULL_MODES, requireLiteral(state.cull, "cull mode"), "cull mode");

  const stencil = state.stencil;
  material.stencilWrite = true;
  material.stencilRef = requireLiteral(stencil?.reference, "stencil reference");
  material.stencilFuncMask = requireLiteral(stencil?.readMask, "stencil read mask");
  material.stencilWriteMask = requireLiteral(stencil?.writeMask, "stencil write mask");
  material.stencilFunc = mappedValue(
    STENCIL_TESTS,
    requireLiteral(stencil?.compare, "stencil compare"),
    "stencil compare",
  );
  material.stencilZPass = mappedValue(
    STENCIL_OPERATIONS,
    requireLiteral(stencil?.pass, "stencil pass"),
    "stencil pass",
  );
  material.stencilFail = mappedValue(
    STENCIL_OPERATIONS,
    requireLiteral(stencil?.fail, "stencil fail"),
    "stencil fail",
  );
  material.stencilZFail = mappedValue(
    STENCIL_OPERATIONS,
    requireLiteral(stencil?.depthFail, "stencil depth fail"),
    "stencil depth fail",
  );
  material.alphaToCoverage = requireLiteral(state.alphaToMask, "alpha-to-mask") !== 0;
  material.toneMapped = false;
}

function requireTexture(texture) {
  if (!texture?.isTexture) throw new TypeError("dynamicUITexture must be a THREE.Texture");
  return texture;
}

function requireDisplayMaterial(material) {
  if (!materialPrograms.has(material)) {
    throw new TypeError("material must be created by createHomographyDisplayMaterial()");
  }
  return material;
}

export function createHomographyDisplayMaterial({
  program,
  dynamicUITexture,
  viewportPoints,
}) {
  validateProgram(program);
  const texture = requireTexture(dynamicUITexture);
  const { homography, inverseHomography } = calculateMatrices(viewportPoints);
  const material = new THREE.RawShaderMaterial({
    name: program.manifest.shader,
    glslVersion: THREE.GLSL3,
    vertexShader: program.vertexShader,
    fragmentShader: program.fragmentShader,
    uniforms: {
      _DynamicUITex: { value: texture },
      _HomographyMatrix: { value: homography },
      _InvHomographyMatrix: { value: inverseHomography },
    },
  });
  try {
    applyRenderState(material, program.manifest);
    materialPrograms.set(material, program);
    return material;
  } catch (error) {
    material.dispose();
    throw error;
  }
}

export function setHomographyDisplayPoints(material, viewportPoints) {
  requireDisplayMaterial(material);
  const { homography, inverseHomography } = calculateMatrices(viewportPoints);
  material.uniforms._HomographyMatrix.value.set(homography);
  material.uniforms._InvHomographyMatrix.value.set(inverseHomography);
  material.uniformsNeedUpdate = true;
  return { homography, inverseHomography };
}

export function setHomographyDisplayTexture(material, dynamicUITexture) {
  requireDisplayMaterial(material);
  material.uniforms._DynamicUITex.value = requireTexture(dynamicUITexture);
  material.uniformsNeedUpdate = true;
  return material;
}
