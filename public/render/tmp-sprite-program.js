import * as THREE from "three";

const CONTRACT_URL = "render/tmp-sprite-program.json";
const VERTEX_URL = "shaders/tmp_sprite_to_rt.vert.glsl";
const FRAGMENT_URL = "shaders/tmp_sprite_to_rt.frag.glsl";

async function fetchText(url, label) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${label}: HTTP ${response.status}`);
  return response.text();
}

async function fetchJson(url, label) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${label}: HTTP ${response.status}`);
  return response.json();
}

async function sha256(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

function validateContract(contract) {
  if (contract?.schema !== "pocket-card-render/tmp-sprite-program@1") {
    throw new Error("official TMP Sprite program schema drifted");
  }
  if (contract.classification?.shaderFamily !== "TextMeshPro/Sprite(to RT)") {
    throw new Error("official TMP Sprite shader family drifted");
  }
  if (contract.classification?.isTmpSdfGlyph !== false
      || contract.classification?.isUnityUiImage !== false) {
    throw new Error("official TMP Sprite draw classification drifted");
  }
  const selector = contract.officialSelector;
  if (!selector?.selectorId || !selector?.candidateWitnessId
      || selector.subshader !== 0 || selector.pass !== 0) {
    throw new Error("official TMP Sprite selector identity drifted");
  }
  const fixed = contract.officialPass?.fixedSerializedState;
  if (fixed?.blend?.source !== "One"
      || fixed?.blend?.destination !== "OneMinusSrcAlpha"
      || fixed.depthWrite !== false
      || fixed.cull !== "Off"
      || fixed.alphaToCoverage !== false) {
    throw new Error("official TMP Sprite fixed pass state drifted");
  }
  const attributes = contract.officialBindings?.attributes || [];
  const identity = attributes.map((entry) => (
    `${entry.officialChannel}:${entry.spirvLocation}:${entry.webglName}`
  ));
  if (JSON.stringify(identity) !== JSON.stringify([
    "Vertex:0:position",
    "Color:1:color",
    "UV0:2:uv",
  ])) {
    throw new Error("official TMP Sprite vertex binding drifted");
  }
  if (contract.fragmentSemantics?.alphaModel !== "premultiplied") {
    throw new Error("official TMP Sprite alpha model drifted");
  }
  return contract;
}

export async function loadOfficialTmpSpriteProgram() {
  const [contract, vertexShader, fragmentShader] = await Promise.all([
    fetchJson(CONTRACT_URL, "official TMP Sprite program contract"),
    fetchText(VERTEX_URL, "official TMP Sprite vertex shader"),
    fetchText(FRAGMENT_URL, "official TMP Sprite fragment shader"),
  ]);
  validateContract(contract);
  const [vertexSha256, fragmentSha256] = await Promise.all([
    sha256(vertexShader),
    sha256(fragmentShader),
  ]);
  if (vertexSha256 !== contract.webglSources?.vertex?.sha256
      || fragmentSha256 !== contract.webglSources?.fragment?.sha256) {
    throw new Error("official TMP Sprite generated source hash drifted");
  }
  return { contract, vertexShader, fragmentShader };
}

export function createOfficialTmpSpriteMaterial(program, {
  texture,
  color = [1, 1, 1, 1],
  textureSampleAdd = [0, 0, 0, 0],
} = {}) {
  if (!texture) throw new Error("official TMP Sprite material requires a texture");
  validateContract(program?.contract);
  const material = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: {
      _MainTex: { value: texture },
      _TextureSampleAdd: { value: new THREE.Vector4(...textureSampleAdd) },
      _Color: { value: new THREE.Vector4(...color) },
    },
    vertexShader: program.vertexShader,
    fragmentShader: program.fragmentShader,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.OneFactor,
    blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    toneMapped: false,
  });
  material.userData.officialTmpSprite = {
    selectorId: program.contract.officialSelector.selectorId,
    candidateWitnessId: program.contract.officialSelector.candidateWitnessId,
    executableId: program.contract.officialSelector.executableId,
    semanticExecutableId: program.contract.officialSelector.semanticExecutableId,
    passStateSha256: program.contract.officialPass.passStateSha256,
    commonBindingsSha256: program.contract.officialPass.commonBindingsSha256,
    webglAdaptationStatus: program.contract.webglAdaptation.status,
    runtimeBoundaries: program.contract.runtimeBoundaries,
  };
  return material;
}
