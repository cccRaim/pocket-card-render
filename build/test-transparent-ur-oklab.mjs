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
  "scene.cPK_20_007790_00_UTUROID_UR.json",
  "scene.cTR_20_001170_00_ELECTRICGENERATOR_UR.json",
]);
const SHADER_KEY = "Transparent-UR-Oklab";
const MANIFEST = "shaders/transparent_ur_oklab_uniforms.json";

function readJson(relative) {
  return JSON.parse(fs.readFileSync(path.join(PUBLIC, relative), "utf8"));
}

test("Transparent-UR-Oklab corpus resolves every exact active binding", () => {
  const contract = readJson("shaders/official_program_port_contract.json");
  const index = compileRuntimeMaterialDispatchIndex(contract);
  const manifest = readJson(MANIFEST);
  const route = contract.runtimeDispatch.routes.find(
    (candidate) => candidate.dispatch.shaderKey === SHADER_KEY,
  );
  assert.ok(route, `${SHADER_KEY} has no official runtime route`);
  assert.equal(route.dispatch.support, "implemented");
  assert.equal(route.dispatch.strategy, "sbHoloUr");
  assert.equal(route.dispatch.blend, "premult");
  assert.equal(route.selectorId, manifest.official_selector.selectorId);
  assert.equal(route.candidateWitnessId, manifest.official_selector.candidateWitnessId);
  assert.equal(route.semanticExecutableId, manifest.official_selector.semanticExecutableId);
  assert.equal(manifest.runtime_contract.require_complete_active_bindings, true);
  assert.equal(manifest.runtime_contract.mrt_attachments, 2);
  assert.equal(manifest.official_pass_runtime.depth.write.val, 1);

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
      assert.equal(dispatch?.strategy, "sbHoloUr");
      assert.equal(dispatch?.officialPorts?.length, 1);
      for (const binding of manifest.sampler_bindings) {
        const descriptor = manifest.official_shader_property_defaults
          .textureDescriptors?.[binding.slot];
        const shaderDefault = manifest.official_shader_property_defaults
          .textures?.[binding.slot];
        const backendDefault = binding.slot === "_CubeMap" ? "neutral-gray-cube" : null;
        assert.ok(
          recipe.textures?.[binding.slot] || shaderDefault || backendDefault,
          `${sceneFile}:${materialName} cannot resolve sampler ${binding.slot}`,
        );
        assert.ok(descriptor, `${binding.slot} lacks an official Shader property descriptor`);
      }
      drawCount += 1;
    }
  }
  assert.equal(drawCount, 3);
});

console.log("Transparent-UR-Oklab corpus contract: 2 scenes, 3 exact selector-bound draws");
