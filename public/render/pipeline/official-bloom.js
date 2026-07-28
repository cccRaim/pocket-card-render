import * as THREE from "three";

const BUFFER_SIZE = 256;
const DOWN_SAMPLING_COUNT = 5;
const SCATTER = 0.5;
const INTENSITY = 1.0;
const TARGET_ASPECT = 9 / 16;
const MARGIN = 9;

const f32 = Math.fround;

export async function loadOfficialBloomPrograms() {
  const [manifest, programs] = await Promise.all([
    fetch("shaders/bloom_programs.json").then((response) => {
      if (!response.ok) throw new Error(`Bloom manifest: HTTP ${response.status}`);
      return response.json();
    }),
    Promise.all(Array.from({ length: 6 }, async (_, pass) => {
    const [vertexShader, fragmentShader] = await Promise.all([
      fetch(`shaders/bloom_pass${pass}.vert.glsl`).then((response) => {
        if (!response.ok) throw new Error(`Bloom pass ${pass} vertex shader: HTTP ${response.status}`);
        return response.text();
      }),
      fetch(`shaders/bloom_pass${pass}.frag.glsl`).then((response) => {
        if (!response.ok) throw new Error(`Bloom pass ${pass} fragment shader: HTTP ${response.status}`);
        return response.text();
      }),
    ]);
    return { vertexShader, fragmentShader };
    })),
  ]);
  if (!Array.isArray(manifest?.passes) || manifest.passes.length !== programs.length) {
    throw new Error("Bloom manifest must describe all six passes");
  }
  return programs.map((program, pass) => {
    const entry = manifest.passes[pass];
    if (entry?.pass !== pass || !entry.render_state) {
      throw new Error(`Bloom manifest pass ${pass} render state is missing`);
    }
    return { ...program, pass, renderState: entry.render_state };
  });
}

export async function loadOfficialFinalBlitProgram() {
  const [vertexShader, fragmentShader, manifest] = await Promise.all([
    fetch("shaders/final_blit.vert.glsl").then((response) => {
      if (!response.ok) throw new Error(`FinalBlit vertex shader: HTTP ${response.status}`);
      return response.text();
    }),
    fetch("shaders/final_blit.frag.glsl").then((response) => {
      if (!response.ok) throw new Error(`FinalBlit fragment shader: HTTP ${response.status}`);
      return response.text();
    }),
    fetch("shaders/final_blit_program.json").then((response) => {
      if (!response.ok) throw new Error(`FinalBlit manifest: HTTP ${response.status}`);
      return response.json();
    }),
  ]);
  if (!manifest?.render_state) throw new Error("FinalBlit manifest render state is missing");
  if (!manifest?.sampler_state) throw new Error("FinalBlit manifest sampler state is missing");
  return {
    vertexShader,
    fragmentShader,
    pass: "final-blit",
    renderState: manifest.render_state,
    samplerState: manifest.sampler_state,
  };
}

export function getOfficialBloomBufferSize(width, height, bufferSize = BUFFER_SIZE) {
  const landscape = width > height;
  const shortOverLong = landscape ? height / width : width / height;
  const longAxis = Math.trunc(bufferSize / Math.min(shortOverLong, TARGET_ASPECT));
  const shortAxis = Math.trunc(bufferSize / (1 - Math.max(shortOverLong - TARGET_ASPECT, 0)));
  return landscape
    ? { width: longAxis, height: shortAxis }
    : { width: shortAxis, height: longAxis };
}

export function getOfficialBloomLayout(width, height) {
  const base = getOfficialBloomBufferSize(width, height);
  const sheet = {
    width: base.width + (base.width >> 1) + MARGIN * 4,
    height: base.height + MARGIN * 2,
  };
  const invWidth = f32(1 / sheet.width);
  const invHeight = f32(1 / sheet.height);
  const marginX = f32(MARGIN * invWidth);
  const marginY = f32(MARGIN * invHeight);
  let denominator = f32(0);
  for (let index = 0; index < DOWN_SAMPLING_COUNT; index += 1) {
    denominator = f32(denominator + f32(Math.pow(SCATTER, index)));
  }

  let offsetX = f32(0);
  let offsetY = f32(0);
  let levelWidth = base.width;
  let levelHeight = base.height;
  const levels = [];
  for (let level = 1; level <= DOWN_SAMPLING_COUNT; level += 1) {
    const u0 = f32(marginX + offsetX);
    const v0 = f32(marginY + offsetY);
    const normalizedWidth = f32(levelWidth * invWidth);
    const normalizedHeight = f32(levelHeight * invHeight);
    const u1 = f32(u0 + normalizedWidth);
    const v1 = f32(v0 + normalizedHeight);
    const weight = f32(INTENSITY * f32(f32(Math.pow(SCATTER, level - 1)) / denominator));
    levels.push({
      level,
      width: levelWidth,
      height: levelHeight,
      uv: [u0, v0, u1, v1],
      ndc: [
        f32(f32(u0 + u0) - 1),
        f32(f32(v0 + v0) - 1),
        f32(f32(u1 + u1) - 1),
        f32(f32(v1 + v1) - 1),
      ],
      weight,
    });
    if (level & 1) offsetX = f32(offsetX + f32(normalizedWidth + f32(marginX + marginX)));
    else offsetY = f32(offsetY + f32(normalizedHeight + f32(marginY + marginY)));
    levelWidth >>= 1;
    levelHeight >>= 1;
  }
  return {
    base,
    prefilter: { width: base.width * 2, height: base.height * 2 },
    sheet,
    levels,
    scatter: SCATTER,
    intensity: INTENSITY,
    weightDenominator: denominator,
  };
}

function makeRenderTarget(width, height) {
  const target = new THREE.WebGLRenderTarget(width, height, {
    format: THREE.RGBAFormat,
    internalFormat: "RGBA8",
    type: THREE.UnsignedByteType,
    colorSpace: THREE.NoColorSpace,
    depthBuffer: false,
    stencilBuffer: false,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    wrapS: THREE.ClampToEdgeWrapping,
    wrapT: THREE.ClampToEdgeWrapping,
    generateMipmaps: false,
    samples: 0,
  });
  target.texture.colorSpace = THREE.NoColorSpace;
  target.texture.generateMipmaps = false;
  return target;
}

function makeGeometry(positions, attributes, indices) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  for (const [name, { values, size }] of Object.entries(attributes)) {
    geometry.setAttribute(name, new THREE.Float32BufferAttribute(values, size));
  }
  geometry.setIndex(indices);
  return geometry;
}

function fullScreenGeometry() {
  return makeGeometry(
    [-1, -1, 0, 1, -1, 0, -1, 1, 0, 1, 1, 0],
    {
      uv: { values: [0, 0, 1, 0, 0, 1, 1, 1], size: 2 },
      color: { values: Array(4).fill([1, 1, 1, 1]).flat(), size: 4 },
    },
    [0, 1, 2, 2, 1, 3],
  );
}

function imageToSheetGeometry(layout) {
  const positions = [];
  const uvSelector = [];
  const indices = [];
  for (const { level, ndc: [left, bottom, right, top] } of layout.levels) {
    const base = positions.length / 3;
    positions.push(left, bottom, 0, right, bottom, 0, left, top, 0, right, top, 0);
    uvSelector.push(0, 0, level, 1, 0, level, 0, 1, level, 1, 1, level);
    indices.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
  }
  return makeGeometry(positions, { uvSelector: { values: uvSelector, size: 3 } }, indices);
}

function sheetToImageGeometry(layout) {
  const positions = [];
  const uvw = [];
  const colors = [];
  const indices = [];
  const appendQuad = (coords, color) => {
    const base = positions.length / 3;
    positions.push(-1, -1, 0, 1, -1, 0, -1, 1, 0, 1, 1, 0);
    uvw.push(...coords);
    colors.push(...Array(4).fill(color).flat());
    indices.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
  };
  appendQuad(Array(4).fill([0, 0, 0]).flat(), [0, 0, 0, 0]);
  for (const { uv: [u0, v0, u1, v1], weight } of layout.levels) {
    appendQuad([u0, v0, weight, u1, v0, weight, u0, v1, weight, u1, v1, weight], [1, 1, 1, 1]);
  }
  return makeGeometry(positions, {
    uvw: { values: uvw, size: 3 },
    color: { values: colors, size: 4 },
  }, indices);
}

const BLEND_FACTOR = Object.freeze({
  0: THREE.ZeroFactor,
  1: THREE.OneFactor,
  5: THREE.SrcAlphaFactor,
});

function compileOfficialPostprocessState(renderState, label) {
  if (!renderState || typeof renderState !== "object") {
    throw new Error(`${label} official render state is missing`);
  }
  if (renderState.blendOp !== 0 || renderState.blendOpAlpha !== 0) {
    throw new Error(`${label} uses an unsupported non-add blend equation`);
  }
  if (renderState.colorMask !== 15) {
    throw new Error(`${label} uses unsupported partial color mask ${renderState.colorMask}`);
  }
  if (![0, 4].includes(renderState.zTest) || ![0, 1].includes(renderState.zWrite)) {
    throw new Error(`${label} uses unsupported depth state`);
  }
  if (![0, 2].includes(renderState.cull)) {
    throw new Error(`${label} uses unsupported cull mode ${renderState.cull}`);
  }
  const factors = [
    renderState.srcBlend,
    renderState.destBlend,
    renderState.srcBlendAlpha,
    renderState.destBlendAlpha,
  ].map((factor) => BLEND_FACTOR[factor]);
  if (factors.some((factor) => factor === undefined)) {
    throw new Error(`${label} uses an unsupported blend factor`);
  }
  const opaque = renderState.srcBlend === 1
    && renderState.destBlend === 0
    && renderState.srcBlendAlpha === 1
    && renderState.destBlendAlpha === 0;
  return {
    transparent: !opaque,
    blending: opaque ? THREE.NoBlending : THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendEquationAlpha: THREE.AddEquation,
    blendSrc: factors[0],
    blendDst: factors[1],
    blendSrcAlpha: factors[2],
    blendDstAlpha: factors[3],
    depthTest: renderState.zTest !== 0,
    depthFunc: renderState.zTest === 4 ? THREE.LessEqualDepth : THREE.AlwaysDepth,
    depthWrite: renderState.zWrite !== 0,
    colorWrite: true,
    side: renderState.cull === 2 ? THREE.FrontSide : THREE.DoubleSide,
    toneMapped: false,
  };
}

function createOfficialInlineSampler(renderer, samplerState) {
  const gl = renderer.getContext?.();
  if (!gl || typeof gl.createSampler !== "function"
    || typeof gl.samplerParameteri !== "function"
    || typeof gl.bindSampler !== "function") {
    throw new Error("FinalBlit official inline sampler requires WebGL2 sampler objects");
  }
  if (samplerState?.bind_point !== 0x08000001
    || samplerState?.packed_value !== 85
    || samplerState?.webgl2?.minFilter !== "LINEAR"
    || samplerState?.webgl2?.magFilter !== "LINEAR"
    || samplerState?.webgl2?.wrapS !== "CLAMP_TO_EDGE"
    || samplerState?.webgl2?.wrapT !== "CLAMP_TO_EDGE") {
    throw new Error("FinalBlit inline sampler manifest is unsupported or incomplete");
  }
  const sampler = gl.createSampler();
  if (!sampler) throw new Error("FinalBlit WebGLSampler allocation failed");
  gl.samplerParameteri(sampler, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.samplerParameteri(sampler, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.samplerParameteri(sampler, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.samplerParameteri(sampler, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return {
    gl,
    sampler,
    textureUnit: 0,
    bindChecks: 0,
    unbindChecks: 0,
  };
}

function assertSamplerBinding(inlineSampler, expected) {
  const { gl, textureUnit } = inlineSampler;
  if (typeof gl.activeTexture !== "function" || typeof gl.getParameter !== "function") {
    throw new Error("FinalBlit inline sampler state inspection is unavailable");
  }
  const previousActiveTexture = gl.getParameter(gl.ACTIVE_TEXTURE);
  gl.activeTexture(gl.TEXTURE0 + textureUnit);
  const actual = gl.getParameter(gl.SAMPLER_BINDING);
  gl.activeTexture(previousActiveTexture);
  if (actual !== expected) throw new Error("FinalBlit WebGLSampler binding did not reach the requested texture unit");
}

function material(program, uniforms = {}) {
  return new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: program.vertexShader,
    fragmentShader: program.fragmentShader,
    uniforms,
    ...compileOfficialPostprocessState(
      program.renderState,
      `Bloom pass ${program.pass ?? "unknown"}`,
    ),
  });
}

export function createOfficialBloomPipeline({
  renderer,
  sceneTarget,
  programs,
  finalBlitProgram,
  enabled,
  resizeSceneTarget,
  resizeSourceToDrawingBuffer = true,
  diagnosticsEnabled = false,
}) {
  if (!Array.isArray(programs) || programs.length !== 6) throw new Error("official Bloom requires six programs");
  if (!finalBlitProgram?.vertexShader || !finalBlitProgram?.fragmentShader) {
    throw new Error("official FinalBlit program is required");
  }

  const postScene = new THREE.Scene();
  const postCamera = new THREE.Camera();
  const fullGeometry = fullScreenGeometry();
  const fullMesh = new THREE.Mesh(fullGeometry);
  fullMesh.frustumCulled = false;
  postScene.add(fullMesh);
  const finalGeometry = new THREE.BufferGeometry();
  finalGeometry.setAttribute("position", new THREE.Float32BufferAttribute(Array(9).fill(0), 3));
  const finalMesh = new THREE.Mesh(finalGeometry);
  finalMesh.frustumCulled = false;
  postScene.add(finalMesh);

  const pass0 = material(programs[0], { _MainTex: { value: sceneTarget.textures[1] } });
  const pass1 = material(programs[1], {
    _MainTex: { value: null },
    _MainTex_TexelSize: { value: new THREE.Vector4() },
  });
  const pass2 = material(programs[2], Object.fromEntries(
    Array.from({ length: 7 }, (_, index) => [`_DownSampling${index + 1}Tex`, { value: null }]),
  ));
  const pass3 = material(programs[3], {
    _MainTex: { value: null },
    _GlobalMipBias: { value: new THREE.Vector2(0, 0) },
    _MainTex_TexelSize: { value: new THREE.Vector4() },
    _Vector: { value: new THREE.Vector2(0, 1) },
  });
  const pass4 = material(programs[4], {
    _MainTex: { value: null },
    _GlobalMipBias: { value: new THREE.Vector2(0, 0) },
  });
  const pass5 = material(programs[5], {
    _MainTex: { value: null },
    _GlobalMipBias: { value: new THREE.Vector2(0, 0) },
  });

  const present = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: {
      _BlitTexture: { value: sceneTarget.textures[0] },
      _BlitScaleBias: { value: new THREE.Vector4(1, 1, 0, 0) },
      _BlitMipLevel: { value: 0 },
    },
    vertexShader: finalBlitProgram.vertexShader,
    fragmentShader: finalBlitProgram.fragmentShader,
    ...compileOfficialPostprocessState(
      finalBlitProgram.renderState,
      "FinalBlit",
    ),
  });
  const presentSampler = createOfficialInlineSampler(renderer, finalBlitProgram.samplerState);

  let layout = null;
  let targets = null;
  let imageToSheetMesh = null;
  let sheetToImageMesh = null;
  const webglErrors = [];

  const drainWebglErrors = (stage) => {
    if (!diagnosticsEnabled) return;
    const gl = renderer.getContext();
    for (let error = gl.getError(); error !== gl.NO_ERROR; error = gl.getError()) {
      webglErrors.push({ stage, error });
    }
  };

  const disposeTargets = () => {
    if (!targets) return;
    targets.prefilter.dispose();
    for (const target of targets.down) target.dispose();
    targets.sheet1.dispose();
    targets.sheet2.dispose();
    targets.bloom.dispose();
  };

  const rebuild = (width, height) => {
    layout = getOfficialBloomLayout(width, height);
    if (!enabled) return;
    disposeTargets();
    targets = {
      prefilter: makeRenderTarget(layout.prefilter.width, layout.prefilter.height),
      down: layout.levels.map((level) => makeRenderTarget(level.width, level.height)),
      sheet1: makeRenderTarget(layout.sheet.width, layout.sheet.height),
      sheet2: makeRenderTarget(layout.sheet.width, layout.sheet.height),
      bloom: makeRenderTarget(layout.base.width, layout.base.height),
    };
    imageToSheetMesh?.geometry.dispose();
    sheetToImageMesh?.geometry.dispose();
    imageToSheetMesh = new THREE.Mesh(imageToSheetGeometry(layout), pass2);
    sheetToImageMesh = new THREE.Mesh(sheetToImageGeometry(layout), pass4);
    imageToSheetMesh.frustumCulled = false;
    sheetToImageMesh.frustumCulled = false;
  };

  const draw = (mesh, target, drawMaterial, stage, clear = true, inlineSampler = null) => {
    const previousAutoClear = renderer.autoClear;
    renderer.autoClear = clear;
    fullMesh.visible = mesh === fullMesh;
    finalMesh.visible = mesh === finalMesh;
    if (imageToSheetMesh) {
      if (imageToSheetMesh.parent !== postScene) postScene.add(imageToSheetMesh);
      imageToSheetMesh.visible = mesh === imageToSheetMesh;
    }
    if (sheetToImageMesh) {
      if (sheetToImageMesh.parent !== postScene) postScene.add(sheetToImageMesh);
      sheetToImageMesh.visible = mesh === sheetToImageMesh;
    }
    mesh.material = drawMaterial;
    renderer.setRenderTarget(target);
    if (inlineSampler) {
      inlineSampler.gl.bindSampler(inlineSampler.textureUnit, inlineSampler.sampler);
      assertSamplerBinding(inlineSampler, inlineSampler.sampler);
      inlineSampler.bindChecks += 1;
    }
    try {
      renderer.render(postScene, postCamera);
    } finally {
      if (inlineSampler) {
        inlineSampler.gl.bindSampler(inlineSampler.textureUnit, null);
        assertSamplerBinding(inlineSampler, null);
        inlineSampler.unbindChecks += 1;
      }
    }
    renderer.autoClear = previousAutoClear;
    drainWebglErrors(stage);
  };

  rebuild(Math.max(1, sceneTarget.width), Math.max(1, sceneTarget.height));

  const resize = () => {
    if (resizeSourceToDrawingBuffer) {
      const next = renderer.getDrawingBufferSize(new THREE.Vector2());
      resizeSceneTarget(sceneTarget, Math.max(1, next.x), Math.max(1, next.y));
    }
    const width = Math.max(1, sceneTarget.width);
    const height = Math.max(1, sceneTarget.height);
    const nextBase = getOfficialBloomBufferSize(width, height);
    if (!layout || layout.base.width !== nextBase.width || layout.base.height !== nextBase.height) rebuild(width, height);
  };

  const apply = () => {
    if (!enabled || !targets) return;
    webglErrors.length = 0;
    drainWebglErrors("before-bloom");
    pass0.uniforms._MainTex.value = sceneTarget.textures[1];
    draw(fullMesh, targets.prefilter, pass0, "pass0-prefilter");

    let source = targets.prefilter;
    for (let index = 0; index < targets.down.length; index += 1) {
      const target = targets.down[index];
      pass1.uniforms._MainTex.value = source.texture;
      pass1.uniforms._MainTex_TexelSize.value.set(1 / source.width, 1 / source.height, source.width, source.height);
      draw(fullMesh, target, pass1, `pass1-downsample-${index + 1}`);
      source = target;
    }

    for (let index = 0; index < 7; index += 1) {
      pass2.uniforms[`_DownSampling${index + 1}Tex`].value = targets.down[Math.min(index, targets.down.length - 1)].texture;
    }
    draw(imageToSheetMesh, targets.sheet1, pass2, "pass2-image-to-sheet");

    pass3.uniforms._MainTex.value = targets.sheet1.texture;
    pass3.uniforms._MainTex_TexelSize.value.set(
      1 / layout.sheet.width, 1 / layout.sheet.height, layout.sheet.width, layout.sheet.height,
    );
    pass3.uniforms._Vector.value.set(0, 1);
    draw(fullMesh, targets.sheet2, pass3, "pass3-blur-up");
    pass3.uniforms._MainTex.value = targets.sheet2.texture;
    pass3.uniforms._Vector.value.set(1, 0);
    draw(fullMesh, targets.sheet1, pass3, "pass3-blur-right");

    pass4.uniforms._MainTex.value = targets.sheet1.texture;
    draw(sheetToImageMesh, targets.bloom, pass4, "pass4-sheet-to-image");

    pass5.uniforms._MainTex.value = targets.bloom.texture;
    draw(fullMesh, sceneTarget, pass5, "pass5-add-to-scene-color", false);
    renderer.setRenderTarget(null);
  };

  const presentToScreen = () => {
    present.uniforms._BlitTexture.value = sceneTarget.textures[0];
    draw(finalMesh, null, present, "final-present", true, presentSampler);
    renderer.setRenderTarget(null);
  };

  return {
    sceneRT: sceneTarget,
    hasBloom: enabled,
    apply,
    present: presentToScreen,
    resize,
    diagnostics: () => ({
      base: { ...layout.base },
      prefilter: { ...layout.prefilter },
      sheet: { ...layout.sheet },
      levels: layout.levels.map(({ level, width, height, weight }) => ({ level, width, height, weight })),
      passSequence: enabled ? [0, 1, 1, 1, 1, 1, 2, 3, 3, 4, 5] : [],
      webglErrors: webglErrors.map((entry) => ({ ...entry })),
      finalBlitSampler: {
        ...finalBlitProgram.samplerState.webgl2,
        textureUnit: presentSampler.textureUnit,
        bindChecks: presentSampler.bindChecks,
        unbindChecks: presentSampler.unbindChecks,
      },
    }),
  };
}
