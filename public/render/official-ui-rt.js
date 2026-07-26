import * as THREE from "three";

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

function validateProgram(program, role) {
  const manifest = program.manifest;
  if (manifest.role !== role) {
    throw new Error(`official UI RT role drifted: ${manifest.role}`);
  }
  if (manifest.bindings?.main_texture?.name !== "_MainTex") {
    throw new Error(`official UI RT ${role} _MainTex binding drifted`);
  }
  if (manifest.bindings?.texture_sample_add?.name !== "_TextureSampleAdd") {
    throw new Error(`official UI RT ${role} _TextureSampleAdd binding drifted`);
  }
  const attributes = manifest.bindings?.attributes?.map(({ name, location }) => `${name}:${location}`);
  if (JSON.stringify(attributes) !== JSON.stringify(["position:0", "color:1", "uv:2"])) {
    throw new Error(`official UI RT ${role} vertex inputs drifted`);
  }
  if (manifest.mrt?.primary?.location !== 0 || manifest.mrt?.secondary?.location !== 1) {
    throw new Error(`official UI RT ${role} MRT contract drifted`);
  }
  return program;
}

export async function loadOfficialUIRTPrograms() {
  const [toVertex, toFragment, toManifest, fromVertex, fromFragment, fromManifest] = await Promise.all([
    fetchText("shaders/ui_default_to_rt.vert.glsl", "official UI ToRT vertex shader"),
    fetchText("shaders/ui_default_to_rt.frag.glsl", "official UI ToRT fragment shader"),
    fetchJson("shaders/ui_default_to_rt_program.json", "official UI ToRT manifest"),
    fetchText("shaders/ui_default_from_rt.vert.glsl", "official UI FromRT vertex shader"),
    fetchText("shaders/ui_default_from_rt.frag.glsl", "official UI FromRT fragment shader"),
    fetchJson("shaders/ui_default_from_rt_program.json", "official UI FromRT manifest"),
  ]);
  return {
    toRT: validateProgram({
      vertexShader: toVertex,
      fragmentShader: toFragment,
      manifest: toManifest,
    }, "producer-to-render-texture"),
    fromRT: validateProgram({
      vertexShader: fromVertex,
      fragmentShader: fromFragment,
      manifest: fromManifest,
    }, "display-from-render-texture"),
  };
}

function blendFactors(role) {
  return role === "producer-to-render-texture"
    ? {
        source: THREE.SrcAlphaFactor,
        destination: THREE.OneMinusSrcAlphaFactor,
      }
    : {
        source: THREE.OneFactor,
        destination: THREE.OneMinusSrcAlphaFactor,
      };
}

export function createOfficialUIRTMaterial(program, {
  texture,
  color = [1, 1, 1, 1],
  textureSampleAdd = [0, 0, 0, 0],
} = {}) {
  if (!texture) throw new Error("official UI RT material requires a texture");
  const role = program?.manifest?.role;
  const blend = blendFactors(role);
  const material = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: {
      _MainTex: { value: texture },
      _Color: { value: new THREE.Vector4(...color) },
      _MainTex_ST: { value: new THREE.Vector4(1, 1, 0, 0) },
      _TextureSampleAdd: { value: new THREE.Vector4(...textureSampleAdd) },
    },
    vertexShader: program.vertexShader,
    fragmentShader: program.fragmentShader,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: blend.source,
    blendDst: blend.destination,
    blendSrcAlpha: blend.source,
    blendDstAlpha: blend.destination,
    toneMapped: false,
  });
  material.userData.officialUIRTRole = role;
  material.userData.officialProgramSha256 =
    program.manifest.official_source?.decompressed_program_sha256 || null;
  material.userData.runtimeBoundaries = program.manifest.runtime_boundaries
    || program.manifest.unproved
    || [];
  return material;
}
