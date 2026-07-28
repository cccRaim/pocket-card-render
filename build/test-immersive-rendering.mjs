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
const IM_SCENES = Object.freeze([
  "scene.cPK_20_000360_01_LIZARDONex_IM.json",
  "scene.cPK_20_007480_01_MASSIVOONex_IM.json",
  "scene.cPK_20_011180_01_MEGABURSYAMOex_IM.json",
  "scene.cTR_20_000550_01_GUZUMA_IM.json",
]);
const IM_PORTS = Object.freeze({
  "Frame-Holo-ImmersiveUI": {
    strategy: "immersiveFrame",
    manifest: "frame_holo_immersive_ui_uniforms.json",
  },
  "Frame-Holo-Immersive": {
    strategy: "immersiveFrame",
    manifest: "frame_holo_immersive_uniforms.json",
  },
  "Card_Parallax_Immersive": {
    strategy: "immersiveParallax",
    manifest: "card_parallax_immersive_uniforms.json",
  },
  "Card_Parallax_MetalByTilt": {
    strategy: "metalByTilt",
    manifest: "card_parallax_metal_by_tilt_uniforms.json",
  },
  Text_Alpha: {
    strategy: "dynamicTextAlpha",
    manifest: "dynamic_ui_text_alpha_uniforms.json",
  },
});

function readJson(relative) {
  return JSON.parse(fs.readFileSync(path.join(PUBLIC, relative), "utf8"));
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function contractIndex() {
  return compileRuntimeMaterialDispatchIndex(
    readJson("shaders/official_program_port_contract.json"),
  );
}

function usedGlbMaterials(scene) {
  const buffer = fs.readFileSync(path.join(PUBLIC, scene.prefabGlb.replace(/^\//, "")));
  let offset = 12;
  let gltf = null;
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32LE(offset);
    const type = buffer.readUInt32LE(offset + 4);
    offset += 8;
    if (type === 0x4e4f534a) {
      gltf = JSON.parse(buffer.subarray(offset, offset + length).toString("utf8"));
    }
    offset += length;
  }
  assert.ok(gltf, `${scene.prefabGlb}: GLB JSON chunk is missing`);
  const names = (gltf.materials || []).map(({ name }) => name);
  return new Set((gltf.meshes || []).flatMap(({ primitives = [] }) => (
    primitives.map(({ material }) => names[material]).filter(Boolean)
  )));
}

test("IM corpus keeps every serialized material on an explicit implemented route", () => {
  const index = contractIndex();
  const shaderCounts = new Map();
  let materialCount = 0;
  for (const sceneFile of IM_SCENES) {
    const scene = readJson(sceneFile);
    assert.deepEqual(scene._missing || [], [], `${sceneFile}: scene asset references are incomplete`);
    const usedMaterials = usedGlbMaterials(scene);
    assert.deepEqual(
      [...usedMaterials].filter((name) => !scene.materials[name]),
      ["DefaultMaterial"],
      `${sceneFile}: unexpected GLB material is outside the official scene recipe`,
    );
    assert.deepEqual(
      Object.keys(scene.materials).filter((name) => !usedMaterials.has(name)),
      [],
      `${sceneFile}: a scene recipe is not used by the gathered GLB`,
    );
    for (const [materialName, recipe] of Object.entries(scene.materials || {})) {
      assert.deepEqual(
        recipe._missing || [],
        [],
        `${sceneFile}:${materialName} has unresolved serialized texture references`,
      );
      const dispatch = resolveRuntimeMaterialDispatch(index, recipe);
      assert.ok(dispatch, `${sceneFile}:${materialName} has no official runtime route`);
      assert.equal(
        dispatch.support,
        "implemented",
        `${sceneFile}:${materialName} is still ${dispatch.support}`,
      );
      shaderCounts.set(recipe.shader, (shaderCounts.get(recipe.shader) || 0) + 1);
      materialCount += 1;
    }
  }
  assert.equal(materialCount, 53);
  for (const shader of Object.keys(IM_PORTS)) {
    assert.ok(shaderCounts.get(shader) > 0, `${shader} has no IM corpus draw`);
  }
  assert.equal(shaderCounts.get("Text_Alpha"), 3, "the three Pokemon IM cards must keep Text_Alpha");
});

test("each newly supported IM family is bound to its selector-owned generated port", () => {
  const contract = readJson("shaders/official_program_port_contract.json");
  const routes = contract.runtimeDispatch.routes;
  for (const [shader, expected] of Object.entries(IM_PORTS)) {
    const matches = routes.filter((route) => route.dispatch.shaderKey === shader);
    assert.equal(matches.length, 1, `${shader} must resolve one selector/pass route`);
    const [route] = matches;
    assert.equal(route.dispatch.support, "implemented");
    assert.equal(route.dispatch.strategy, expected.strategy);
    const manifest = readJson(`shaders/${expected.manifest}`);
    assert.equal(manifest.official_selector.selectorId, route.selectorId);
    assert.equal(manifest.official_selector.candidateWitnessId, route.candidateWitnessId);
    assert.equal(manifest.official_selector.semanticExecutableId, route.semanticExecutableId);
    const uniformNames = [
      ...Object.keys(manifest.runtime_contract.engine_uniforms || {}),
      ...(manifest.runtime_contract.material_uniforms?.floats || []),
      ...(manifest.runtime_contract.material_uniforms?.ints || []),
      ...Object.keys(manifest.runtime_contract.material_uniforms?.vectors || {}),
    ];
    const generatedSource = Object.values(manifest.webgl_sources)
      .map((relative) => fs.readFileSync(path.join(ROOT, relative), "utf8"))
      .join("\n");
    for (const uniformName of uniformNames) {
      assert.doesNotMatch(
        generatedSource,
        new RegExp(`\\b${escapeRegex(uniformName)}\\d+\\b`),
        `${shader} contains a partial UBO ordinal replacement for ${uniformName}`,
      );
    }
    if (shader === "Text_Alpha") {
      const dynamicUIBinding = manifest.sampler_bindings
        .find(({ slot }) => slot === "_DynamicUITex");
      assert.equal(dynamicUIBinding.spirvName, "_13");
    }
  }
});

console.log("IM rendering corpus contract: 4 scenes, 53 materials, 5 newly closed shader families");
