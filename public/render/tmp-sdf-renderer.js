import * as THREE from "three";
import { applyOfficialSampler } from "./official-texture.js";
import { createOfficialUIRTMaterial } from "./official-ui-rt.js";
import { createOfficialTmpSpriteMaterial } from "./tmp-sprite-program.js";
import { loadOfficialTmpAtlasTexture } from "./tmp-font-data.js";
import { buildOfficialTmpGlyphQuad } from "./tmp-glyph-mesh.js";
import {
  IDENTITY_UI_AFFINE,
  uiAffineToMatrix4,
} from "./ui-affine-transform.js";

const WHITE_PIXEL = new Uint8Array([255, 255, 255, 255]);

export const OFFICIAL_DYNAMIC_UI_LAYERS = Object.freeze({
  Text: 17,
  Holo: 18,
});

function requireDynamicUILayer(value, label) {
  const layer = Number(value);
  if (!Object.values(OFFICIAL_DYNAMIC_UI_LAYERS).includes(layer)) {
    throw new RangeError(`${label} has unsupported official Unity layer ${value}`);
  }
  return layer;
}

function dynamicUITypeForLayer(layer) {
  return layer === OFFICIAL_DYNAMIC_UI_LAYERS.Text ? "Text" : "Holo";
}

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
  geometry.setAttribute("color", new THREE.Float32BufferAttribute([
    1, 1, 1, 1,
    1, 1, 1, 1,
    1, 1, 1, 1,
    1, 1, 1, 1,
  ], 4));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  return geometry;
}

export function createOfficialUIImageQuadGeometry(draw) {
  const { left, top, width, height } = draw.rect;
  const sourceWidth = Number(draw.source?.width || 0);
  const sourceHeight = Number(draw.source?.height || 0);
  if (!(width > 0) || !(height > 0) || !(sourceWidth > 0) || !(sourceHeight > 0)) {
    throw new RangeError("official UI Image draw requires positive source and destination dimensions");
  }
  const crop = draw.sourceRect || {
    x: 0,
    y: 0,
    width: sourceWidth,
    height: sourceHeight,
  };
  const u0 = crop.x / sourceWidth;
  const u1 = (crop.x + crop.width) / sourceWidth;
  const vTop = 1 - crop.y / sourceHeight;
  const vBottom = 1 - (crop.y + crop.height) / sourceHeight;
  const color = draw.color || [1, 1, 1, 1];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute([
    left, top, 0,
    left, top + height, 0,
    left + width, top + height, 0,
    left + width, top, 0,
  ], 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute([
    u0, vTop,
    u0, vBottom,
    u1, vBottom,
    u1, vTop,
  ], 2));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute([
    ...color, ...color, ...color, ...color,
  ], 4));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  return geometry;
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
  const model = uiAffineToMatrix4(draw.uiTransform || IDENTITY_UI_AFFINE, THREE.Matrix4);
  const worldToObject = model.clone().invert();
  const material = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: program.vertexShader,
    fragmentShader: program.fragmentShader,
    uniforms: {
      _WorldSpaceCameraPos: { value: new THREE.Vector3(0, 0, 1) },
      _ScreenParams: { value: new THREE.Vector4(draw.textureWidth, draw.textureHeight, 0, 0) },
      uWorldToObject: { value: worldToObject },
      uEnvMatrix: { value: new THREE.Matrix4() },
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
  includeBaseCanvas = false,
  imageDraws = [],
  tmpSpriteDraws = [],
  draws,
  fonts,
  program,
  uiRTPrograms,
  tmpSpriteProgram = null,
  samplerState,
  logicalWidth,
  logicalHeight,
  textureWidth,
  textureHeight,
  collectReadback = false,
}) {
  if (!uiRTPrograms?.toRT || !uiRTPrograms?.fromRT) {
    throw new Error("official UI ToRT/FromRT programs are required");
  }
  const textSource = target(textureWidth, textureHeight, samplerState, "TMP DynamicUI Text source");
  const holoSource = target(textureWidth, textureHeight, samplerState, "TMP DynamicUI Holo source");
  const ui = target(textureWidth, textureHeight, samplerState, "TMP DynamicUI Text");
  const holo = target(textureWidth, textureHeight, samplerState, "TMP DynamicUI Holo");
  const camera = createDynamicUIOrthographicCamera(logicalWidth, logicalHeight);

  const drawScene = new THREE.Scene();
  const drawRecords = [];
  const imageTextures = new Map();
  const textureForSource = (source) => {
    if (imageTextures.has(source)) return imageTextures.get(source);
    const texture = new THREE.Texture(source);
    texture.colorSpace = THREE.NoColorSpace;
    texture.flipY = true;
    texture.premultiplyAlpha = false;
    texture.generateMipmaps = false;
    texture.needsUpdate = true;
    imageTextures.set(source, texture);
    return texture;
  };
  if (includeBaseCanvas) {
    imageDraws = [{
      source: baseCanvas,
      rect: { left: 0, top: 0, width: logicalWidth, height: logicalHeight },
      color: [1, 1, 1, 1],
      hierarchyOrder: -1,
      sequence: -1,
      role: "canvas-fallback",
      unityLayer: OFFICIAL_DYNAMIC_UI_LAYERS.Text,
    }, ...imageDraws];
  }
  for (const draw of imageDraws) {
    const unityLayer = requireDynamicUILayer(draw.unityLayer, draw.layoutPath || draw.role || "Image");
    const geometry = createOfficialUIImageQuadGeometry(draw);
    const material = createOfficialUIRTMaterial(uiRTPrograms.toRT, {
      texture: textureForSource(draw.source),
      textureSampleAdd: draw.textureSampleAdd || [0, 0, 0, 0],
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.matrix.copy(uiAffineToMatrix4(draw.uiTransform || IDENTITY_UI_AFFINE, THREE.Matrix4));
    mesh.matrixAutoUpdate = false;
    mesh.frustumCulled = false;
    mesh.layers.set(unityLayer);
    drawScene.add(mesh);
    drawRecords.push({
      mesh,
      kind: "Image",
      role: draw.role || "image",
      layoutPath: draw.layoutPath || null,
      unityLayer,
      hierarchyOrder: Number(draw.hierarchyOrder ?? 0),
      sequence: Number(draw.sequence ?? 0),
    });
  }
  if (tmpSpriteDraws.length && !tmpSpriteProgram) {
    throw new Error("official TMP Sprite program is required for inline sprite draws");
  }
  for (const draw of tmpSpriteDraws) {
    const unityLayer = requireDynamicUILayer(
      draw.unityLayer,
      draw.layoutPath || draw.role || "TMP-Sprite",
    );
    const geometry = createOfficialUIImageQuadGeometry(draw);
    const material = createOfficialTmpSpriteMaterial(tmpSpriteProgram, {
      texture: textureForSource(draw.source),
      color: draw.materialColor || [1, 1, 1, 1],
      textureSampleAdd: draw.textureSampleAdd || [0, 0, 0, 0],
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.matrix.copy(uiAffineToMatrix4(draw.uiTransform || IDENTITY_UI_AFFINE, THREE.Matrix4));
    mesh.matrixAutoUpdate = false;
    mesh.frustumCulled = false;
    mesh.layers.set(unityLayer);
    drawScene.add(mesh);
    drawRecords.push({
      mesh,
      kind: "TMP-Sprite",
      role: draw.role || "inline-sprite",
      layoutPath: draw.layoutPath || null,
      unityLayer,
      hierarchyOrder: Number(draw.hierarchyOrder ?? 0),
      sequence: Number(draw.sequence ?? 0),
    });
  }

  const white = whiteTexture();
  let glyphCount = 0;
  const bindingCounts = new Map();
  for (const draw of draws) {
    const unityLayer = requireDynamicUILayer(draw.unityLayer, draw.layoutPath || draw.role || "TMP");
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
      mesh.matrix.copy(uiAffineToMatrix4(draw.uiTransform || IDENTITY_UI_AFFINE, THREE.Matrix4));
      mesh.matrixAutoUpdate = false;
      mesh.frustumCulled = false;
      mesh.layers.set(unityLayer);
      drawScene.add(mesh);
      drawRecords.push({
        mesh,
        kind: "TMP",
        role: draw.role || "text",
        layoutPath: draw.layoutPath || null,
        unityLayer,
        hierarchyOrder: Number(draw.hierarchyOrder ?? 0),
        sequence: Number(draw.sequence ?? 0),
      });
      const runGlyphCount = geometry.index.count / 6;
      glyphCount += runGlyphCount;
      const binding = {
        role: draw.role || "text",
        unityLayer,
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
  const orderedDraws = drawRecords
    .sort((left, right) => (
      left.hierarchyOrder - right.hierarchyOrder
      || left.sequence - right.sequence
    ))
    .map((record, drawIndex) => {
      record.mesh.renderOrder = drawIndex;
      return {
        drawIndex,
        kind: record.kind,
        role: record.role,
        layoutPath: record.layoutPath,
        unityLayer: record.unityLayer,
        dynamicUIType: dynamicUITypeForLayer(record.unityLayer),
        hierarchyOrder: record.hierarchyOrder,
        sequence: record.sequence,
      };
    });

  const priorTarget = renderer.getRenderTarget();
  const priorAutoClear = renderer.autoClear;
  const priorSort = renderer.sortObjects;
  const priorColor = renderer.getClearColor(new THREE.Color());
  const priorAlpha = renderer.getClearAlpha();
  renderer.autoClear = false;
  renderer.sortObjects = true;
  renderer.setClearColor(0, 0);
  for (const [unityLayer, renderTarget] of [
    [OFFICIAL_DYNAMIC_UI_LAYERS.Text, textSource],
    [OFFICIAL_DYNAMIC_UI_LAYERS.Holo, holoSource],
  ]) {
    camera.layers.set(unityLayer);
    renderer.setRenderTarget(renderTarget);
    renderer.clear(true, false, false);
    renderer.render(drawScene, camera);
  }

  const postScene = new THREE.Scene();
  // RT-to-RT passes sample v=0 from the logical top written by the producer.
  // Reusing the Canvas quad here would vertically invert both final textures.
  const postGeometry = createDynamicUIQuadGeometry(logicalWidth, logicalHeight, "renderTarget");
  const postPairs = [[textSource, ui], [holoSource, holo]];
  const postMesh = new THREE.Mesh(
    postGeometry,
    createOfficialUIRTMaterial(uiRTPrograms.fromRT, {
      texture: postPairs[0][0].texture,
    }),
  );
  postScene.add(postMesh);
  camera.layers.set(0);
  for (const [index, [source, destination]] of postPairs.entries()) {
    if (index) {
      postMesh.material.dispose();
      postMesh.material = createOfficialUIRTMaterial(uiRTPrograms.fromRT, {
        texture: source.texture,
      });
    }
    renderer.setRenderTarget(destination);
    renderer.clear(true, false, false);
    renderer.render(postScene, camera);
  }

  const readback = collectReadback ? {
    textSource: summarizeRenderTarget(renderer, textSource),
    holoSource: summarizeRenderTarget(renderer, holoSource),
    ui: summarizeRenderTarget(renderer, ui),
    holo: summarizeRenderTarget(renderer, holo),
  } : null;

  renderer.setRenderTarget(priorTarget);
  renderer.setClearColor(priorColor, priorAlpha);
  renderer.autoClear = priorAutoClear;
  renderer.sortObjects = priorSort;

  postMesh.material.dispose();
  postGeometry.dispose();
  textSource.dispose();
  holoSource.dispose();
  disposeScene(drawScene);
  for (const texture of imageTextures.values()) texture.dispose();
  white.dispose();

  return {
    ui: ui.texture,
    holo: holo.texture,
    evidence: {
      mode: "official-tmp-sdf-webgl",
      drawCount: drawRecords.length,
      imageDrawCount: imageDraws.length,
      tmpSpriteDrawCount: tmpSpriteDraws.length,
      glyphDrawCount: drawRecords.length - imageDraws.length - tmpSpriteDraws.length,
      glyphCount,
      orderedDraws,
      dynamicUILayers: {
        Text: OFFICIAL_DYNAMIC_UI_LAYERS.Text,
        Holo: OFFICIAL_DYNAMIC_UI_LAYERS.Holo,
      },
      textureWidth,
      textureHeight,
      programManifest: program.manifest?.official_source?.decompressed_program_sha256 || null,
      uiToRTProgramManifest:
        uiRTPrograms.toRT.manifest?.official_source?.decompressed_program_sha256 || null,
      uiFromRTProgramManifest:
        uiRTPrograms.fromRT.manifest?.official_source?.decompressed_program_sha256 || null,
      tmpSpriteProgram: tmpSpriteProgram ? {
        selectorId: tmpSpriteProgram.contract.officialSelector.selectorId,
        candidateWitnessId: tmpSpriteProgram.contract.officialSelector.candidateWitnessId,
        executableId: tmpSpriteProgram.contract.officialSelector.executableId,
        semanticExecutableId: tmpSpriteProgram.contract.officialSelector.semanticExecutableId,
        passStateSha256: tmpSpriteProgram.contract.officialPass.passStateSha256,
        commonBindingsSha256: tmpSpriteProgram.contract.officialPass.commonBindingsSha256,
        webglAdaptationStatus: tmpSpriteProgram.contract.webglAdaptation.status,
        runtimeBoundaries: tmpSpriteProgram.contract.runtimeBoundaries,
      } : null,
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
