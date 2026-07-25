import * as THREE from "three";
import { applyOfficialSampler } from "./official-texture.js";
import { loadOfficialTmpAtlasTexture } from "./tmp-font-data.js";
import { buildOfficialTmpGlyphQuad } from "./tmp-glyph-mesh.js";

const WHITE_PIXEL = new Uint8Array([255, 255, 255, 255]);

export const DYNAMIC_UI_COORDINATE_CONTRACT = Object.freeze({
  logicalOrigin: "top-left",
  logicalPositiveY: "down",
  renderTargetUvOrigin: "bottom-left",
  logicalTopRenderTargetV: 0,
  sources: Object.freeze({
    canvas: Object.freeze({ textureFlipY: true, logicalTopSampleV: 1 }),
    renderTarget: Object.freeze({ textureFlipY: false, logicalTopSampleV: 0 }),
  }),
});

export function createDynamicUIOrthographicCamera(width, height) {
  if (!(width > 0) || !(height > 0) || !Number.isFinite(width) || !Number.isFinite(height)) {
    throw new RangeError("DynamicUI camera dimensions must be positive and finite");
  }
  // Logical y=0 is intentionally written to framebuffer v=0. The card mesh's
  // serialized top edge also samples v=0, so no consumer-side texture flip is needed.
  const camera = new THREE.OrthographicCamera(0, width, height, 0, -1, 1);
  camera.position.z = 1;
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
  return camera;
}

function color4(value, fallback = [1, 1, 1, 1]) {
  if (Array.isArray(value)) return new THREE.Vector4(...value);
  if (value && typeof value === "object") {
    return new THREE.Vector4(value.r ?? 1, value.g ?? 1, value.b ?? 1, value.a ?? 1);
  }
  return new THREE.Vector4(...fallback);
}

export function packOfficialTmpUv(x, y) {
  return Math.trunc(Number(x) * 511) * 4096 + Math.trunc(Number(y) * 511);
}

export function officialTmpMaterialPadding(sdf) {
  const ratio = Number(sdf?.scaleRatioA ?? 1);
  const face = Number(sdf?.faceDilate ?? 0) * ratio;
  const outline = Number(sdf?.outlineWidth ?? 0) * ratio;
  const softness = Number(sdf?.outlineSoftness ?? 0) * ratio;
  const normalized = Math.min(Math.max(face + outline + softness, face, 0), 1);
  return normalized * Number(sdf?.gradientScale ?? 1) + 1.25;
}

export async function loadOfficialTmpSdfProgram() {
  const [vertexShader, fragmentShader, manifest] = await Promise.all([
    fetch("shaders/tmp_sdf.vert.glsl").then((response) => {
      if (!response.ok) throw new Error(`official TMP vertex shader: HTTP ${response.status}`);
      return response.text();
    }),
    fetch("shaders/tmp_sdf.frag.glsl").then((response) => {
      if (!response.ok) throw new Error(`official TMP fragment shader: HTTP ${response.status}`);
      return response.text();
    }),
    fetch("shaders/tmp_sdf_program.json").then((response) => {
      if (!response.ok) throw new Error(`official TMP shader manifest: HTTP ${response.status}`);
      return response.json();
    }),
  ]);
  if (manifest.evidence_status !== "exact-static-program-and-bindings") {
    throw new Error("official TMP shader manifest is not exact");
  }
  return { vertexShader, fragmentShader, manifest };
}

function whiteTexture() {
  const texture = new THREE.DataTexture(WHITE_PIXEL, 1, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.colorSpace = THREE.NoColorSpace;
  texture.flipY = false;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

function target(width, height, samplerState, name) {
  const renderTarget = new THREE.WebGLRenderTarget(width, height, {
    depthBuffer: false,
    stencilBuffer: false,
    type: THREE.UnsignedByteType,
    format: THREE.RGBAFormat,
    colorSpace: THREE.NoColorSpace,
    generateMipmaps: false,
  });
  renderTarget.texture.name = name;
  renderTarget.texture.colorSpace = THREE.NoColorSpace;
  applyOfficialSampler(renderTarget.texture, samplerState);
  return renderTarget;
}

export function createDynamicUIQuadGeometry(width, height, sourceKind) {
  const source = DYNAMIC_UI_COORDINATE_CONTRACT.sources[sourceKind];
  if (!source) throw new RangeError(`unsupported DynamicUI source kind: ${sourceKind}`);
  const topV = source.logicalTopSampleV;
  const bottomV = 1 - topV;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute([
    0, 0, 0, 0, height, 0, width, height, 0, width, 0, 0,
  ], 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute([
    0, topV, 0, bottomV, 1, bottomV, 1, topV,
  ], 2));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  return geometry;
}

function fullscreenMaterial(map, mode) {
  const operations = {
    premultiply: "outColor = vec4(sampled.rgb * sampled.a, sampled.a);",
    straight: "outColor = sampled.a > 0.0 ? vec4(sampled.rgb / sampled.a, sampled.a) : vec4(0.0);",
    holo: "outColor = vec4(sampled.rgb, 1.0 - sampled.a);",
  };
  return new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: { map: { value: map } },
    vertexShader: `
      in vec3 position;
      in vec2 uv;
      out vec2 vUv;
      uniform mat4 modelViewMatrix;
      uniform mat4 projectionMatrix;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      precision highp float;
      uniform sampler2D map;
      in vec2 vUv;
      layout(location = 0) out vec4 outColor;
      void main() {
        vec4 sampled = texture(map, vUv);
        ${operations[mode]}
      }
    `,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
    transparent: false,
    toneMapped: false,
  });
}

function glyphGeometry(glyphs, padding) {
  const positions = [];
  const normals = [];
  const colors = [];
  const uvs = [];
  const uv2s = [];
  const indices = [];
  for (const entry of glyphs) {
    const rect = entry.glyph.rect;
    if (!rect?.width || !rect?.height) continue;
    const atlas = entry.atlas;
    const quad = buildOfficialTmpGlyphQuad(entry, padding, Number(entry.stylePadding || 0));
    const u0 = (rect.x - padding) / atlas.width;
    const v0 = (rect.y - padding) / atlas.height;
    const u1 = (rect.x + rect.width + padding) / atlas.width;
    const v1 = (rect.y + rect.height + padding) / atlas.height;
    const base = positions.length / 3;
    for (const vertex of quad.positions) positions.push(vertex.x, vertex.y, 0);
    uvs.push(u0, v0, u0, v1, u1, v1, u1, v0);
    uv2s.push(
      packOfficialTmpUv(0, 0), entry.sdfScale,
      packOfficialTmpUv(0, 1), entry.sdfScale,
      packOfficialTmpUv(1, 1), entry.sdfScale,
      packOfficialTmpUv(1, 0), entry.sdfScale,
    );
    for (let i = 0; i < 4; i++) {
      normals.push(0, 0, -1);
      colors.push(...entry.vertexColor);
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 4));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute("uv2", new THREE.Float32BufferAttribute(uv2s, 2));
  geometry.setIndex(indices);
  return geometry;
}

function splitAtlasRuns(draw) {
  const runs = [];
  let current = null;
  for (const glyph of draw.layout.glyphs) {
    const key = glyph.atlas?.alphaUrl;
    if (!key || !glyph.glyph.rect?.width || !glyph.glyph.rect?.height) continue;
    if (!current || current.key !== key) {
      current = { key, atlas: glyph.atlas, glyphs: [] };
      runs.push(current);
    }
    current.glyphs.push({
      ...glyph,
      sdfScale: draw.sdfScale ?? glyph.scale,
      vertexColor: draw.vertexColor,
    });
  }
  return runs;
}

function sdfMaterial(program, atlasTexture, draw, white) {
  const sdf = draw.sdf || {};
  const identity = new THREE.Matrix4();
  const material = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: program.vertexShader,
    fragmentShader: program.fragmentShader,
    uniforms: {
      _WorldSpaceCameraPos: { value: new THREE.Vector3(0, 0, 1) },
      _ScreenParams: { value: new THREE.Vector4(draw.textureWidth, draw.textureHeight, 0, 0) },
      uWorldToObject: { value: identity },
      uEnvMatrix: { value: identity },
      _FaceDilate: { value: Number(sdf.faceDilate || 0) },
      _OutlineSoftness: { value: Number(sdf.outlineSoftness || 0) },
      _OutlineWidth: { value: Number(sdf.outlineWidth || 0) },
      _WeightNormal: { value: Number(sdf.weightNormal || 0) },
      _WeightBold: { value: Number(sdf.weightBold ?? 0.75) },
      _ScaleRatioA: { value: Number(sdf.scaleRatioA ?? 1) },
      _VertexOffsetX: { value: 0 },
      _VertexOffsetY: { value: 0 },
      _ClipRect: { value: new THREE.Vector4(-2e10, -2e10, 2e10, 2e10) },
      _MaskSoftnessX: { value: 0 },
      _MaskSoftnessY: { value: 0 },
      _GradientScale: { value: Number(sdf.gradientScale || 1) },
      _ScaleX: { value: 1 },
      _ScaleY: { value: 1 },
      _PerspectiveFilter: { value: Number(sdf.perspectiveFilter ?? 0.875) },
      _Sharpness: { value: Number(sdf.sharpness || 0) },
      _FaceTex_ST: { value: new THREE.Vector4(1, 1, 0, 0) },
      _OutlineTex_ST: { value: new THREE.Vector4(1, 1, 0, 0) },
      _Time: { value: new THREE.Vector4() },
      _FaceUVSpeedX: { value: 0 },
      _FaceUVSpeedY: { value: 0 },
      _FaceColor: { value: color4(sdf.faceColor) },
      _OutlineUVSpeedX: { value: 0 },
      _OutlineUVSpeedY: { value: 0 },
      _OutlineColor: { value: color4(sdf.outlineColor, [0, 0, 0, 1]) },
      _MainTex: { value: atlasTexture },
      _FaceTex: { value: white },
      _OutlineTex: { value: white },
    },
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
  return material;
}

function disposeScene(scene) {
  scene.traverse((object) => {
    object.geometry?.dispose();
    if (Array.isArray(object.material)) object.material.forEach((material) => material.dispose());
    else object.material?.dispose();
  });
}

function summarizeRenderTarget(renderer, renderTarget) {
  const { width, height } = renderTarget;
  const pixels = new Uint8Array(width * height * 4);
  renderer.readRenderTargetPixels(renderTarget, 0, 0, width, height, pixels);
  let alphaNonzero = 0;
  let alphaMax = 0;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  let hash = 0x811c9dc5;
  for (let pixel = 0, offset = 0; pixel < width * height; pixel++, offset += 4) {
    const alpha = pixels[offset + 3];
    hash ^= pixels[offset];
    hash = Math.imul(hash, 0x01000193);
    hash ^= pixels[offset + 1];
    hash = Math.imul(hash, 0x01000193);
    hash ^= pixels[offset + 2];
    hash = Math.imul(hash, 0x01000193);
    hash ^= alpha;
    hash = Math.imul(hash, 0x01000193);
    if (!alpha) continue;
    alphaNonzero++;
    alphaMax = Math.max(alphaMax, alpha);
    const x = pixel % width;
    const y = Math.floor(pixel / width);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return {
    alphaNonzero,
    alphaMax,
    bounds: alphaNonzero ? [minX, minY, maxX, maxY] : null,
    fnv1a32: (hash >>> 0).toString(16).padStart(8, "0"),
  };
}

export async function renderOfficialTmpDynamicTexture({
  renderer,
  baseCanvas,
  draws,
  fonts,
  program,
  samplerState,
  logicalWidth,
  logicalHeight,
  textureWidth,
  textureHeight,
  collectReadback = false,
}) {
  const premultiplied = target(textureWidth, textureHeight, samplerState, "TMP premultiplied DynamicUI");
  const ui = target(textureWidth, textureHeight, samplerState, "TMP straight DynamicUI");
  const holo = target(textureWidth, textureHeight, samplerState, "TMP holo DynamicUI");
  const camera = createDynamicUIOrthographicCamera(logicalWidth, logicalHeight);

  const baseTexture = new THREE.CanvasTexture(baseCanvas);
  baseTexture.colorSpace = THREE.NoColorSpace;
  baseTexture.flipY = true;
  baseTexture.premultiplyAlpha = false;
  baseTexture.generateMipmaps = false;
  baseTexture.needsUpdate = true;
  const baseScene = new THREE.Scene();
  const baseMesh = new THREE.Mesh(
    createDynamicUIQuadGeometry(logicalWidth, logicalHeight, "canvas"),
    fullscreenMaterial(baseTexture, "premultiply"),
  );
  baseScene.add(baseMesh);

  const textScene = new THREE.Scene();
  const white = whiteTexture();
  let order = 0;
  let glyphCount = 0;
  const bindingCounts = new Map();
  for (const draw of draws) {
    const padding = officialTmpMaterialPadding(draw.sdf);
    for (const run of splitAtlasRuns(draw)) {
      const atlasTexture = await loadOfficialTmpAtlasTexture(fonts, run.atlas);
      const geometry = glyphGeometry(run.glyphs, padding);
      if (!geometry.index?.count) {
        geometry.dispose();
        continue;
      }
      const material = sdfMaterial(program, atlasTexture, {
        ...draw,
        textureWidth,
        textureHeight,
      }, white);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.renderOrder = order++;
      mesh.frustumCulled = false;
      textScene.add(mesh);
      const runGlyphCount = geometry.index.count / 6;
      glyphCount += runGlyphCount;
      const binding = {
        role: draw.role || "text",
        fontId: String(draw.sdf?.fontId || ""),
        materialId: String(draw.sdf?.materialId || ""),
        atlasIndex: Number(run.atlas?.index || 0),
      };
      const bindingKey = JSON.stringify(binding);
      const previous = bindingCounts.get(bindingKey) || { ...binding, drawCount: 0, glyphCount: 0 };
      previous.drawCount += 1;
      previous.glyphCount += runGlyphCount;
      bindingCounts.set(bindingKey, previous);
    }
  }

  const priorTarget = renderer.getRenderTarget();
  const priorAutoClear = renderer.autoClear;
  const priorSort = renderer.sortObjects;
  const priorColor = renderer.getClearColor(new THREE.Color());
  const priorAlpha = renderer.getClearAlpha();
  renderer.autoClear = false;
  renderer.sortObjects = true;
  renderer.setClearColor(0, 0);
  renderer.setRenderTarget(premultiplied);
  renderer.clear(true, false, false);
  renderer.render(baseScene, camera);
  renderer.render(textScene, camera);

  const postScene = new THREE.Scene();
  // RT-to-RT passes sample v=0 from the logical top written by the producer.
  // Reusing the Canvas quad here would vertically invert both final textures.
  const postGeometry = createDynamicUIQuadGeometry(logicalWidth, logicalHeight, "renderTarget");
  const straightMaterial = fullscreenMaterial(premultiplied.texture, "straight");
  const postMesh = new THREE.Mesh(postGeometry, straightMaterial);
  postScene.add(postMesh);
  renderer.setRenderTarget(ui);
  renderer.clear(true, false, false);
  renderer.render(postScene, camera);
  postMesh.material = fullscreenMaterial(premultiplied.texture, "holo");
  renderer.setRenderTarget(holo);
  renderer.clear(true, false, false);
  renderer.render(postScene, camera);

  const readback = collectReadback ? {
    premultiplied: summarizeRenderTarget(renderer, premultiplied),
    ui: summarizeRenderTarget(renderer, ui),
    holo: summarizeRenderTarget(renderer, holo),
  } : null;

  renderer.setRenderTarget(priorTarget);
  renderer.setClearColor(priorColor, priorAlpha);
  renderer.autoClear = priorAutoClear;
  renderer.sortObjects = priorSort;

  straightMaterial.dispose();
  postMesh.material.dispose();
  postGeometry.dispose();
  disposeScene(baseScene);
  disposeScene(textScene);
  baseTexture.dispose();
  white.dispose();
  premultiplied.dispose();

  return {
    ui: ui.texture,
    holo: holo.texture,
    evidence: {
      mode: "official-tmp-sdf-webgl",
      drawCount: order,
      glyphCount,
      textureWidth,
      textureHeight,
      programManifest: program.manifest?.official_source?.decompressed_program_sha256 || null,
      resourceBindings: [...bindingCounts.values()].sort((left, right) =>
        `${left.role}|${left.fontId}|${left.materialId}|${left.atlasIndex}`
          .localeCompare(`${right.role}|${right.fontId}|${right.materialId}|${right.atlasIndex}`)),
      readback,
    },
    dispose() {
      ui.dispose();
      holo.dispose();
    },
  };
}
