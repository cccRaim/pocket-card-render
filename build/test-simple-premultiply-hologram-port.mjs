import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import { makeRenderContext, selectExactShaderPort } from "../public/render/context.js";
import { SHADER } from "../public/render/rarities.js";
import { getMaterial } from "../public/render/registry.js";
import { SHADER_TEXTURE_DEFAULTS } from "../public/render/shader-defaults.js";
import "../public/render/materials/index.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(fs.readFileSync(
  path.join(ROOT, "public", "shaders", "simple_premultiply_hologram_uniforms.json"),
  "utf8",
));
const vertex = fs.readFileSync(path.join(ROOT, manifest.webgl_sources.vertex), "utf8");
const fragment = fs.readFileSync(path.join(ROOT, manifest.webgl_sources.fragment), "utf8");
const shaderKey = "Simple-PreMultiply-Hologram";

assert.equal(manifest.generated_by, "build/build-exact-simple-premultiply-hologram.mjs");
assert.equal(manifest.official_selector.selectorId,
  "019ab096cef0a08f6e6736d6d6894ab88493fe8cbbe349dee3fd850f1f8b479d");
assert.equal(manifest.official_selector.candidateWitnessId,
  "f12371cc222c53d980a281d8870889277b7efb3223e9d857453f19f17717a901");
assert.equal(manifest.official_selector.semanticExecutableId,
  "14841ab2ded68d6d00c5e41575ceb8f265e1a1896532dc8f03f796af81abb5b3");
assert.deepEqual(manifest.official_selector.keywords, []);
assert.deepEqual(manifest.sampler_bindings.map(({ slot, spirvName, binding }) => ({ slot, spirvName, binding })), [
  { slot: "_MainTex", spirvName: "_491", binding: 0 },
  { slot: "_HologramMaskTex", spirvName: "_473", binding: 1 },
  { slot: "_PhaseTex", spirvName: "_334", binding: 2 },
  { slot: "_RampMaskTex", spirvName: "_400", binding: 3 },
  { slot: "_RampTex", spirvName: "_458", binding: 4 },
]);
assert.equal(manifest.official_pass_runtime.blend.src_rgb.val, 1);
assert.equal(manifest.official_pass_runtime.blend.dst_rgb.val, 10);
assert.equal(manifest.official_pass_runtime.stencil.generic.comp.val, 3);
assert.equal(manifest.official_pass_runtime.stencil.generic.pass.val, 2);
assert.deepEqual(manifest.mrt, { primary: "_504", secondary: "_516", secondary_value: "zero" });
assert.deepEqual(manifest.runtime_contract.attributes,
  { position: "vec3", normal: "vec3", color: "vec4", uv: "vec2", uv1: "vec2" });
assert.match(vertex, /in vec2 uv1;/);
assert.match(vertex, /in vec4 color;/);
assert.match(vertex, /vec2 _91 = uv1;/);
assert.match(vertex, /vec4 _134 = color;/);
assert.doesNotMatch(vertex, /in vec[24] (?:uv2|tangent);/);
assert.match(vertex, /vs_TEXCOORD3\s*=\s*\(-_134\.w\)\s*\+\s*1\.0/);
assert.match(fragment, /_239\s*=\s*\(_490\.xyz\s*\*\s*_490\.www\)\s*\+\s*_9\.xyz/);
assert.match(fragment, /_504\.w\s*=\s*_490\.w\s*\*\s*vs_TEXCOORD3/);
assert.doesNotMatch(`${vertex}\n${fragment}`, /uniform\s+_19_21|uniform\s+_35_37|gl_Position\.y\s*=\s*-gl_Position\.y/);

const exactShaders = {
  [shaderKey]: { vert: vertex, frag: fragment, manifest, manifests: [manifest] },
};
Object.defineProperty(exactShaders, "sourcesByPortIdentity", {
  value: {
    [JSON.stringify([
      manifest.official_selector.selectorId,
      manifest.official_selector.candidateWitnessId,
      manifest.official_selector.subshader,
      manifest.official_selector.pass,
    ])]: { vert: vertex, frag: fragment, manifest, shaderKey },
  },
  enumerable: false,
});
const recipe = {
  shader: shaderKey,
  official: {
    shader: manifest.official_selector.shaderIdentity,
    validKeywords: [],
  },
  floats: {},
  colors: {},
  textures: Object.fromEntries(manifest.sampler_slots.map((slot, index) => [slot, { name: `tex-${index}` }])),
};
const selected = selectExactShaderPort(exactShaders, recipe, shaderKey);
assert.deepEqual(selected?.manifest.official_selector, manifest.official_selector);
assert.deepEqual(selected?.manifest.official_pass_runtime.shader_property_defaults,
  manifest.official_shader_property_defaults.floats);
assert.equal(selectExactShaderPort(exactShaders, {
  ...recipe,
  official: { ...recipe.official, validKeywords: ["_MUTATED"] },
}, shaderKey), null);
assert.equal(selectExactShaderPort(exactShaders, {
  ...recipe,
  official: { ...recipe.official, shader: "CAB-mutated:1" },
}, shaderKey), null);

assert.deepEqual(SHADER[shaderKey], {
  blend: "premult",
  kind: "simplePremultiplyHologram",
  capabilities: { stencil: "shadowbox", fixedShadowboxDepth: true },
});
assert.deepEqual(SHADER_TEXTURE_DEFAULTS[shaderKey], {
  _PhaseTex: "white",
  _RampMaskTex: "black",
  _RampTex: "black",
  _HologramMaskTex: "white",
});
const texture = new THREE.Texture();
const texInfo = new Map(Object.values(recipe.textures).map(({ name }) => [name, { tex: texture, straight: false }]));
const dispatchRecipe = {
  ...recipe,
  runtimeDispatch: {
    shaderKey,
    capabilities: SHADER[shaderKey].capabilities,
    officialPorts: [manifest.official_selector],
  },
};
const context = makeRenderContext({
  texInfo,
  envCubeTex: null,
  exactShaders,
  animMats: [],
  exactGlitMats: [],
  kiraPuyoMats: [],
  circularKiraComponents: new Map(),
  exHoloMats: [],
});
const strategy = getMaterial("simplePremultiplyHologram");
assert.ok(strategy?.requires(dispatchRecipe, context));
const material = strategy.build(dispatchRecipe, context);
assert.ok(material.isRawShaderMaterial);
assert.equal(material.userData.exactShader, shaderKey);
assert.equal(material.userData.officialSelector.selectorId, manifest.official_selector.selectorId);
assert.deepEqual(Object.keys(material.uniforms).sort(), [
  ...manifest.sampler_bindings.map(({ spirvName }) => spirvName),
  ...manifest.runtime_contract.material_uniforms.floats,
  ...manifest.runtime_contract.material_uniforms.ints,
  ...Object.keys(manifest.runtime_contract.material_uniforms.vectors),
].sort());

const noExactContext = makeRenderContext({
  texInfo,
  envCubeTex: null,
  exactShaders: {},
  animMats: [],
  exactGlitMats: [],
  kiraPuyoMats: [],
  circularKiraComponents: new Map(),
  exHoloMats: [],
});
assert.equal(strategy.build(dispatchRecipe, noExactContext), null,
  "selector/source loss must fail closed instead of using an approximate hologram");

console.log("Simple-PreMultiply-Hologram selector/runtime port checks OK");
