import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  compileRuntimeMaterialDispatchIndex,
  resolveRuntimeMaterialDispatch,
} from "../public/render/runtime-dispatch-contract.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCENES = [
  "public/scene.cPK_20_000360_03_LIZARDONex_SR.json",
  "public/scene.cPK_20_007480_02_MASSIVOONex_SR.json",
];
const MANIFESTS = [
  "public/shaders/card_parallax_hologram_shadow_layers_uniforms.json",
  "public/shaders/card_parallax_hologram_shadow_effect_uniforms.json",
  "public/shaders/opaque_hologram_shadow_uniforms.json",
];

const readJson = (file) => JSON.parse(fs.readFileSync(path.join(ROOT, file), "utf8"));
const contract = readJson("public/shaders/official_program_port_contract.json");
const dispatch = compileRuntimeMaterialDispatchIndex(contract);
const manifests = MANIFESTS.map(readJson);
const manifestBySelector = new Map(
  manifests.map((manifest) => [manifest.official_selector.selectorId, manifest]),
);

test("Shadow hologram corpus resolves all three selector-owned programs", () => {
  let parallaxDraws = 0;
  let opaqueDraws = 0;
  const selectors = new Set();
  for (const sceneFile of SCENES) {
    const scene = readJson(sceneFile);
    for (const recipe of Object.values(scene.materials)) {
      if (!["Card_Parallax_Hologram_Shadow", "Opaque-Hologram_Shadow"].includes(recipe.shader)) {
        continue;
      }
      const route = resolveRuntimeMaterialDispatch(dispatch, recipe);
      assert.ok(route, `${sceneFile}: ${recipe.name} has no runtime dispatch`);
      assert.equal(route.support, "implemented");
      assert.equal(route.defer, false);
      assert.equal(route.officialPorts.length, 1);
      const selector = route.officialPorts[0];
      const manifest = manifestBySelector.get(selector.selectorId);
      assert.ok(manifest, `${sceneFile}: ${recipe.name} has no exact manifest`);
      assert.equal(selector.candidateWitnessId, manifest.official_selector.candidateWitnessId);
      assert.equal(selector.semanticExecutableId, manifest.official_selector.semanticExecutableId);
      assert.equal(manifest.runtime_contract.require_complete_active_bindings, true);
      assert.equal(manifest.runtime_contract.mrt_attachments, 2);
      assert.equal(manifest.mrt.secondary_value, "zero");
      assert.deepEqual(manifest.runtime_contract.backend_uniforms._ShadowUVTranslate, {
        type: "vec2",
        value: [0, 0],
      });
      assert.deepEqual(manifest.runtime_contract.backend_texture_defaults, {
        _CubeMap: "neutral-gray-cube",
      });
      for (const binding of manifest.sampler_bindings) {
        const descriptor = manifest.official_shader_property_defaults
          .textureDescriptors?.[binding.slot];
        const explicit = recipe.textures?.[binding.slot];
        const backendDefault = manifest.runtime_contract.backend_texture_defaults?.[binding.slot];
        assert.ok(
          explicit || descriptor?.defaultName || backendDefault,
          `${sceneFile}: ${recipe.name}/${binding.slot} is unresolved`,
        );
      }
      for (const name of manifest.runtime_contract.material_uniforms.floats) {
        assert.ok(
          Object.hasOwn(recipe.floats || {}, name)
            || Object.hasOwn(manifest.official_shader_property_defaults.floats || {}, name),
          `${sceneFile}: ${recipe.name}/${name} is unresolved`,
        );
      }
      for (const name of manifest.runtime_contract.material_uniforms.ints) {
        assert.ok(
          Object.hasOwn(recipe.floats || {}, name)
            || Object.hasOwn(manifest.official_shader_property_defaults.floats || {}, name),
          `${sceneFile}: ${recipe.name}/${name} is unresolved`,
        );
      }
      for (const name of Object.keys(manifest.runtime_contract.material_uniforms.vectors)) {
        assert.ok(
          Object.hasOwn(recipe.colors || {}, name)
            || Object.hasOwn(manifest.official_shader_property_defaults.vectors || {}, name),
          `${sceneFile}: ${recipe.name}/${name} is unresolved`,
        );
      }
      selectors.add(selector.selectorId);
      if (recipe.shader === "Card_Parallax_Hologram_Shadow") parallaxDraws += 1;
      else opaqueDraws += 1;
    }
  }
  assert.equal(selectors.size, 3);
  assert.equal(parallaxDraws, 4);
  assert.equal(opaqueDraws, 6);
});

test("Shadow hologram routes retain their official blend and stencil families", () => {
  const parallax = resolveRuntimeMaterialDispatch(dispatch, {
    official: {
      shader: manifests[0].official_selector.shaderIdentity,
      validKeywords: manifests[0].official_selector.keywords,
    },
  });
  const opaque = resolveRuntimeMaterialDispatch(dispatch, {
    official: {
      shader: manifests[2].official_selector.shaderIdentity,
      validKeywords: manifests[2].official_selector.keywords,
    },
  });
  assert.equal(parallax.strategy, "shadowParallaxHologram");
  assert.equal(parallax.blend, "premult");
  assert.equal(parallax.capabilities.stencil, "read-stencil-ref");
  assert.equal(opaque.strategy, "shadowOpaqueHologram");
  assert.equal(opaque.blend, "opaque");
  assert.equal(opaque.capabilities.stencil, "shadowbox");
  assert.equal(opaque.capabilities.fixedShadowboxDepth, true);
});

console.log("Shadow hologram corpus contract: 2 scenes, 3 exact programs, 10 draws");
