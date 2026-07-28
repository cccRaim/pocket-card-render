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
const PUBLIC = path.join(ROOT, "public");
const SCENES = Object.freeze([
  "scene.cPK_20_002880_00_MEGAYANMAex_SR.json",
  "scene.cPK_20_016510_01_MEGAHASSAMex_SSR.json",
  "scene.cTR_20_000700_00_BOTAN_SR.json",
]);
const SHADER_KEY = "Transparent-Hologram";
const MANIFEST = "shaders/transparent_hologram_uniforms.json";

function readJson(relative) {
  return JSON.parse(fs.readFileSync(path.join(PUBLIC, relative), "utf8"));
}

test("Transparent-Hologram corpus routes every serialized draw through one exact selector", () => {
  const contract = readJson("shaders/official_program_port_contract.json");
  const index = compileRuntimeMaterialDispatchIndex(contract);
  const manifest = readJson(MANIFEST);
  const route = contract.runtimeDispatch.routes.find(
    (candidate) => candidate.dispatch.shaderKey === SHADER_KEY,
  );
  assert.ok(route, `${SHADER_KEY} has no official runtime route`);
  assert.equal(route.dispatch.support, "implemented");
  assert.equal(route.dispatch.strategy, "shadowboxTransparentHologram");
  assert.equal(route.selectorId, manifest.official_selector.selectorId);
  assert.equal(route.candidateWitnessId, manifest.official_selector.candidateWitnessId);
  assert.equal(route.semanticExecutableId, manifest.official_selector.semanticExecutableId);
  assert.equal(manifest.runtime_contract.require_complete_active_bindings, true);
  assert.deepEqual(manifest.runtime_contract.backend_texture_defaults, {
    _CubeMap: "neutral-gray-cube",
  });

  let drawCount = 0;
  for (const sceneFile of SCENES) {
    const scene = readJson(sceneFile);
    const draws = Object.entries(scene.materials || {})
      .filter(([, recipe]) => recipe.shader === SHADER_KEY);
    assert.ok(draws.length > 0, `${sceneFile} has no ${SHADER_KEY} draw`);
    for (const [materialName, recipe] of draws) {
      assert.deepEqual(
        recipe._missing || [],
        [],
        `${sceneFile}:${materialName} has unresolved serialized references`,
      );
      const dispatch = resolveRuntimeMaterialDispatch(index, recipe);
      assert.equal(dispatch?.support, "implemented");
      assert.equal(dispatch?.strategy, "shadowboxTransparentHologram");
      assert.equal(dispatch?.officialPorts?.length, 1);
      for (const binding of manifest.sampler_bindings) {
        const descriptor = manifest.official_shader_property_defaults
          .textureDescriptors?.[binding.slot];
        const backendDefault = manifest.runtime_contract
          .backend_texture_defaults?.[binding.slot];
        assert.ok(
          recipe.textures?.[binding.slot]
            || manifest.official_shader_property_defaults.textures?.[binding.slot]
            || backendDefault,
          `${sceneFile}:${materialName} cannot resolve sampler ${binding.slot}`,
        );
        assert.ok(descriptor, `${binding.slot} lacks an official Shader property descriptor`);
      }
      drawCount += 1;
    }
  }
  assert.equal(drawCount, 5);
});

console.log("Transparent-Hologram corpus contract: 3 scenes, 5 exact selector-bound draws");
