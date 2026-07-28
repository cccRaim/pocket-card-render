import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import { createOfficialBloomPipeline } from "../public/render/pipeline/official-bloom.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PASS_SEQUENCE = Object.freeze([0, 1, 1, 1, 1, 1, 2, 3, 3, 4, 5]);
const TARGET_SEQUENCE = Object.freeze([
  "rt0", "rt1", "rt2", "rt3", "rt4", "rt5",
  "rt6", "rt7", "rt6", "rt8", "scene", "screen",
]);
const TARGET_SIZES = Object.freeze([
  [512, 910], [256, 455], [128, 227], [64, 113], [32, 56], [16, 28],
  [420, 473], [420, 473], [420, 473], [256, 455], [450, 800], null,
]);
const PASS_UNIFORMS = Object.freeze([
  ["_MainTex"],
  ["_MainTex", "_MainTex_TexelSize"],
  ["_DownSampling1Tex", "_DownSampling2Tex", "_DownSampling3Tex", "_DownSampling4Tex",
    "_DownSampling5Tex", "_DownSampling6Tex", "_DownSampling7Tex"],
  ["_GlobalMipBias", "_MainTex", "_MainTex_TexelSize", "_Vector"],
  ["_GlobalMipBias", "_MainTex"],
  ["_GlobalMipBias", "_MainTex"],
]);

function read(relative) {
  return fs.readFileSync(path.join(ROOT, relative), "utf8");
}

function sameJson(actual, expected) {
  return JSON.stringify(actual) === JSON.stringify(expected);
}

function serializeVector(value) {
  if (value?.isVector2 || value?.isVector3 || value?.isVector4) return value.toArray();
  return value;
}

function geometryAttributes(mesh) {
  return Object.keys(mesh.geometry?.attributes || {}).sort();
}

export function observeBloomPipeline() {
  const sourceManifest = JSON.parse(read("public/shaders/bloom_programs.json"));
  const finalBlitManifest = JSON.parse(read("public/shaders/final_blit_program.json"));
  const programs = Array.from({ length: 6 }, (_, pass) => ({
    vertexShader: read(`public/shaders/bloom_pass${pass}.vert.glsl`),
    fragmentShader: read(`public/shaders/bloom_pass${pass}.frag.glsl`),
    pass,
    renderState: sourceManifest.passes[pass].render_state,
  }));
  const finalBlitProgram = {
    vertexShader: read("public/shaders/final_blit.vert.glsl"),
    fragmentShader: read("public/shaders/final_blit.frag.glsl"),
    pass: "final-blit",
    renderState: finalBlitManifest.render_state,
    samplerState: finalBlitManifest.sampler_state,
  };
  const sceneTextures = [{ label: "scene.mrt0" }, { label: "scene.mrt1" }];
  const sceneTarget = { width: 450, height: 800, textures: sceneTextures };
  const targetIds = new Map();
  const textureIds = new Map(sceneTextures.map((texture) => [texture, texture.label]));
  const draws = [];
  const samplerEvents = [];
  let activeTarget = null;
  let boundSampler = null;
  let activeTexture = 0x84c0;
  const gl = {
    ACTIVE_TEXTURE: "ACTIVE_TEXTURE",
    SAMPLER_BINDING: "SAMPLER_BINDING",
    TEXTURE0: 0x84c0,
    TEXTURE_MIN_FILTER: "TEXTURE_MIN_FILTER",
    TEXTURE_MAG_FILTER: "TEXTURE_MAG_FILTER",
    TEXTURE_WRAP_S: "TEXTURE_WRAP_S",
    TEXTURE_WRAP_T: "TEXTURE_WRAP_T",
    LINEAR: "LINEAR",
    CLAMP_TO_EDGE: "CLAMP_TO_EDGE",
    createSampler() {
      return { parameters: {} };
    },
    samplerParameteri(sampler, parameter, value) {
      sampler.parameters[parameter] = value;
    },
    bindSampler(textureUnit, sampler) {
      if (textureUnit !== 0) throw new Error(`unexpected sampler texture unit ${textureUnit}`);
      boundSampler = sampler;
      samplerEvents.push({
        textureUnit,
        action: sampler ? "bind" : "unbind",
        parameters: sampler ? { ...sampler.parameters } : null,
      });
    },
    activeTexture(value) {
      activeTexture = value;
    },
    getParameter(parameter) {
      if (parameter === gl.ACTIVE_TEXTURE) return activeTexture;
      if (parameter === gl.SAMPLER_BINDING) return boundSampler;
      throw new Error(`unexpected sampler query ${parameter}`);
    },
  };

  function targetId(target) {
    if (target === null) return "screen";
    if (target === sceneTarget) return "scene";
    if (!targetIds.has(target)) {
      const id = `rt${targetIds.size}`;
      targetIds.set(target, id);
      textureIds.set(target.texture, `${id}.texture`);
    }
    return targetIds.get(target);
  }

  function serializeUniform(value) {
    if (textureIds.has(value)) return textureIds.get(value);
    return serializeVector(value);
  }

  const renderer = {
    autoClear: true,
    getContext() {
      return gl;
    },
    setRenderTarget(target) {
      activeTarget = target;
      targetId(target);
    },
    render(scene) {
      const visible = scene.children.filter((child) => child.visible);
      if (visible.length !== 1) throw new Error(`Bloom trace expected one visible mesh, got ${visible.length}`);
      const mesh = visible[0];
      const material = mesh.material;
      const pass = programs.findIndex((program) =>
        program.vertexShader === material.vertexShader
        && program.fragmentShader === material.fragmentShader);
      const finalBlit = material.vertexShader === finalBlitProgram.vertexShader
        && material.fragmentShader === finalBlitProgram.fragmentShader;
      draws.push({
        target: targetId(activeTarget),
        targetSize: activeTarget && activeTarget !== sceneTarget
          ? [activeTarget.width, activeTarget.height]
          : activeTarget === sceneTarget ? [sceneTarget.width, sceneTarget.height] : null,
        clear: renderer.autoClear,
        pass: finalBlit ? "final-blit" : pass,
        geometryAttributes: geometryAttributes(mesh),
        uniforms: Object.fromEntries(Object.entries(material.uniforms || {})
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([name, entry]) => [name, serializeUniform(entry?.value)])),
        state: {
          blending: material.blending,
          blendEquation: material.blendEquation,
          blendEquationAlpha: material.blendEquationAlpha,
          blendSrc: material.blendSrc,
          blendDst: material.blendDst,
          blendSrcAlpha: material.blendSrcAlpha,
          blendDstAlpha: material.blendDstAlpha,
          depthTest: material.depthTest,
          depthFunc: material.depthFunc,
          depthWrite: material.depthWrite,
          side: material.side,
          toneMapped: material.toneMapped,
          sampler: boundSampler ? { ...boundSampler.parameters } : null,
        },
      });
    },
  };

  const pipeline = createOfficialBloomPipeline({
    renderer,
    sceneTarget,
    programs,
    finalBlitProgram,
    enabled: true,
    resizeSceneTarget() {
      throw new Error("Bloom trace must not resize the source target");
    },
  });
  pipeline.apply();
  pipeline.present();

  return {
    draws,
    diagnostics: pipeline.diagnostics(),
    samplerEvents,
    sourceManifest,
    finalBlitManifest,
  };
}

function commonStateIssues(draw, label, expected) {
  const issues = [];
  if (draw.state.depthTest !== expected.depthTest) issues.push(`${label} depthTest drifted`);
  if (draw.state.depthWrite !== expected.depthWrite) issues.push(`${label} depthWrite drifted`);
  if (draw.state.depthFunc !== expected.depthFunc) issues.push(`${label} depthFunc drifted`);
  if (draw.state.side !== expected.side) issues.push(`${label} cull mapping drifted`);
  if (draw.state.toneMapped !== false) issues.push(`${label} toneMapped must be disabled`);
  return issues;
}

export function evaluateBloomGraph(observation) {
  const issues = [];
  const draws = observation?.draws || [];
  if (draws.length !== 12) issues.push(`draw count must be 12, got ${draws.length}`);
  if (!sameJson(draws.map((draw) => draw.pass), [...PASS_SEQUENCE, "final-blit"])) {
    issues.push("Bloom/FinalBlit pass sequence drifted");
  }
  if (!sameJson(draws.map((draw) => draw.target), TARGET_SEQUENCE)) {
    issues.push("Bloom render-target routing drifted");
  }
  if (!sameJson(draws.map((draw) => draw.targetSize), TARGET_SIZES)) {
    issues.push("Bloom render-target dimensions drifted");
  }
  if (!sameJson(observation?.diagnostics?.passSequence, PASS_SEQUENCE)) {
    issues.push("Bloom diagnostics pass sequence drifted");
  }
  if (!sameJson(observation?.diagnostics?.base, { width: 256, height: 455 })
    || !sameJson(observation?.diagnostics?.prefilter, { width: 512, height: 910 })
    || !sameJson(observation?.diagnostics?.sheet, { width: 420, height: 473 })) {
    issues.push("Bloom diagnostics layout drifted");
  }
  const depthEnabledPasses = new Set([0, 1, 3, 4]);
  for (let index = 0; index < Math.min(11, draws.length); index += 1) {
    const draw = draws[index];
    const pass = PASS_SEQUENCE[index];
    const depthEnabled = depthEnabledPasses.has(pass);
    issues.push(...commonStateIssues(draw, `draw ${index}`, {
      depthTest: depthEnabled,
      depthWrite: depthEnabled,
      depthFunc: depthEnabled ? THREE.LessEqualDepth : THREE.AlwaysDepth,
      side: THREE.FrontSide,
    }));
    if (!sameJson(Object.keys(draw.uniforms || {}).sort(), [...PASS_UNIFORMS[pass]].sort())) {
      issues.push(`draw ${index} pass ${pass} uniform set drifted`);
    }
  }
  const expectedGeometry = [
    ["color", "position", "uv"],
    ["color", "position", "uv"],
    ["color", "position", "uv"],
    ["color", "position", "uv"],
    ["color", "position", "uv"],
    ["color", "position", "uv"],
    ["position", "uvSelector"],
    ["color", "position", "uv"],
    ["color", "position", "uv"],
    ["color", "position", "uvw"],
    ["color", "position", "uv"],
  ];
  if (!sameJson(draws.slice(0, 11).map((draw) => draw.geometryAttributes), expectedGeometry)) {
    issues.push("Bloom geometry/vertex-input routing drifted");
  }
  const expectedSources = [
    "scene.mrt1",
    "rt0.texture", "rt1.texture", "rt2.texture", "rt3.texture", "rt4.texture",
    null, "rt6.texture", "rt7.texture", "rt6.texture", "rt8.texture",
  ];
  for (let index = 0; index < Math.min(11, draws.length); index += 1) {
    const expected = expectedSources[index];
    if (expected !== null && draws[index].uniforms?._MainTex !== expected) {
      issues.push(`draw ${index} source texture drifted`);
    }
  }
  const pass2 = draws[6]?.uniforms || {};
  for (let level = 1; level <= 7; level += 1) {
    const expected = `rt${Math.min(level, 5)}.texture`;
    if (pass2[`_DownSampling${level}Tex`] !== expected) {
      issues.push(`pass 2 downsample binding ${level} drifted`);
    }
  }
  if (!sameJson(draws[7]?.uniforms?._Vector, [0, 1])
    || !sameJson(draws[8]?.uniforms?._Vector, [1, 0])) {
    issues.push("Bloom vertical/horizontal blur order drifted");
  }
  const pass4 = draws[9]?.state || {};
  if (pass4.blending !== THREE.CustomBlending
    || pass4.blendSrc !== THREE.OneFactor || pass4.blendDst !== THREE.SrcAlphaFactor) {
    issues.push("Bloom pass 4 blend state drifted");
  }
  return issues;
}

export function evaluateFinalBlit(observation) {
  const issues = [];
  const draw = observation?.draws?.[11];
  if (!draw || draw.pass !== "final-blit" || draw.target !== "screen" || draw.clear !== true) {
    issues.push("FinalBlit must be the clear-to-screen terminal draw");
    return issues;
  }
  issues.push(...commonStateIssues(draw, "FinalBlit", {
    depthTest: true,
    depthWrite: false,
    depthFunc: THREE.LessEqualDepth,
    side: THREE.DoubleSide,
  }));
  if (!sameJson(draw.geometryAttributes, ["position"])) issues.push("FinalBlit geometry contract drifted");
  if (draw.uniforms?._BlitTexture !== "scene.mrt0"
    || !sameJson(draw.uniforms?._BlitScaleBias, [1, 1, 0, 0])
    || draw.uniforms?._BlitMipLevel !== 0) {
    issues.push("FinalBlit texture/scaleBias/mip-0 binding drifted");
  }
  const expectedSampler = {
    TEXTURE_MIN_FILTER: "LINEAR",
    TEXTURE_MAG_FILTER: "LINEAR",
    TEXTURE_WRAP_S: "CLAMP_TO_EDGE",
    TEXTURE_WRAP_T: "CLAMP_TO_EDGE",
  };
  if (!sameJson(draw.state?.sampler, expectedSampler)) {
    issues.push("FinalBlit inline sampler binding drifted");
  }
  if (!sameJson(observation?.samplerEvents, [
    { textureUnit: 0, action: "bind", parameters: expectedSampler },
    { textureUnit: 0, action: "unbind", parameters: null },
  ])) {
    issues.push("FinalBlit inline sampler lifetime drifted");
  }
  if (!sameJson(observation?.diagnostics?.finalBlitSampler, {
    magFilter: "LINEAR",
    minFilter: "LINEAR",
    wrapS: "CLAMP_TO_EDGE",
    wrapT: "CLAMP_TO_EDGE",
    textureUnit: 0,
    bindChecks: 1,
    unbindChecks: 1,
  })) {
    issues.push("FinalBlit inline sampler diagnostics drifted");
  }
  const manifest = observation?.finalBlitManifest;
  if (manifest?.bindings?.lod?.explicit_texture_lod !== true
    || manifest?.render_state?.srcBlend !== 1
    || manifest?.render_state?.destBlend !== 0
    || manifest?.sampler_state?.packed_value !== 85) {
    issues.push("FinalBlit official manifest contract drifted");
  }
  return issues;
}

export function evaluateDirectColorWrite(observation) {
  const issues = [];
  const draw = observation?.draws?.[10];
  if (!draw || draw.pass !== 5 || draw.target !== "scene" || draw.clear !== false) {
    issues.push("Bloom pass 5 must write directly and non-clearing to scene ColorRT");
    return issues;
  }
  const state = draw.state || {};
  if (state.blending !== THREE.CustomBlending
    || state.blendEquation !== THREE.AddEquation
    || state.blendEquationAlpha !== THREE.AddEquation
    || state.blendSrc !== THREE.OneFactor
    || state.blendDst !== THREE.OneFactor
    || state.blendSrcAlpha !== THREE.ZeroFactor
    || state.blendDstAlpha !== THREE.OneFactor) {
    issues.push("Bloom pass 5 additive RGB/preserve-alpha blend state drifted");
  }
  const manifestPass = observation?.sourceManifest?.passes?.[5];
  if (manifestPass?.webgl_mrt_secondary_noop !== true) {
    issues.push("Bloom pass 5 must preserve MRT1 with an explicit no-op output");
  }
  return issues;
}

export function evaluateBloomPipelineProof(observation) {
  return {
    graph: evaluateBloomGraph(observation),
    finalBlit: evaluateFinalBlit(observation),
    directColorWrite: evaluateDirectColorWrite(observation),
  };
}
