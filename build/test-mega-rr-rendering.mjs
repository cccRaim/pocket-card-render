import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  CARD_MRR_MATERIAL_OVERRIDE_PRODUCER_SCHEMA,
  CARD_MRR_PRODUCER_SCHEMA,
} from "../public/render/card-mrr.js";
import {
  compileRuntimeMaterialDispatchIndex,
  resolveRuntimeMaterialDispatch,
} from "../public/render/runtime-dispatch-contract.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCENE_FILE = "public/scene.cPK_10_012330_00_MEGAABSOLex_RR.json";
const SHADERS = [
  "Effect_Emit",
  "Flash",
  "Card_Parallax_MRR",
  "Card_Parallax_Flash",
  "Frame-Holo-2Layer",
];
const MANIFEST_FILES = [
  "effect_emit_uniforms.json",
  "shadowbox_flash_uniforms.json",
  "card_parallax_mrr_uniforms.json",
  "card_parallax_flash_uniforms.json",
  "frame_holo_2layer_legacy_uniforms.json",
].map((file) => `public/shaders/${file}`);

const readJson = (file) => JSON.parse(fs.readFileSync(path.join(ROOT, file), "utf8"));
const scene = readJson(SCENE_FILE);
const contract = readJson("public/shaders/official_program_port_contract.json");
const dispatch = compileRuntimeMaterialDispatchIndex(contract);
const manifests = MANIFEST_FILES.map(readJson);
const manifestByKey = new Map(
  manifests.map((manifest) => [manifest.runtime_contract.shader_key, manifest]),
);

test("Mega RR corpus routes all five CardMRR families through selector ports", () => {
  const counts = new Map();
  for (const recipe of Object.values(scene.materials)) {
    if (!SHADERS.includes(recipe.shader)) continue;
    const route = resolveRuntimeMaterialDispatch(dispatch, recipe);
    const manifest = manifestByKey.get(recipe.shader);
    assert.ok(route, `${recipe.go}: missing runtime route`);
    assert.equal(route.support, "implemented");
    assert.equal(route.defer, false);
    assert.equal(route.officialPorts.length, 1);
    assert.equal(route.officialPorts[0].selectorId, manifest.official_selector.selectorId);
    assert.equal(manifest.runtime_contract.require_complete_active_bindings, true);
    assert.equal(manifest.runtime_contract.mrt_attachments, 2);
    const expectedProducer = recipe.shader === "Effect_Emit"
      ? CARD_MRR_MATERIAL_OVERRIDE_PRODUCER_SCHEMA
      : CARD_MRR_PRODUCER_SCHEMA;
    assert.deepEqual(
      [...new Set(
        Object.values(manifest.runtime_contract.dynamic_uniforms)
          .filter((entry) => entry.source === expectedProducer)
          .map((entry) => entry.source),
      )],
      [expectedProducer],
    );
    assert.ok(
      manifest.runtime_boundaries.some(
        (boundary) =>
          boundary.producer === expectedProducer
          && boundary.status === "known-implementation",
      ),
    );
    const draw = scene.officialDraws.find(
      (candidate) => scene.materials[candidate.materialName] === recipe,
    );
    const binding = draw?.rendererProperties?.cardMRR;
    assert.ok(binding, `${recipe.go}: CardMRR renderer binding`);
    assert.equal(binding.rendererIdentity.includes(":"), true);
    for (const binding of manifest.sampler_bindings) {
      const descriptor = manifest.official_shader_property_defaults
        .textureDescriptors[binding.slot];
      assert.ok(
        recipe.textures?.[binding.slot]
          || (descriptor && typeof descriptor.defaultName === "string"),
        `${recipe.go}/${binding.slot}: unresolved sampler`,
      );
    }
    counts.set(recipe.shader, (counts.get(recipe.shader) || 0) + 1);
  }
  assert.deepEqual(Object.fromEntries(counts), {
    Effect_Emit: 2,
    Card_Parallax_Flash: 1,
    Card_Parallax_MRR: 2,
    Flash: 4,
    "Frame-Holo-2Layer": 1,
  });
});

test("Mega RR generated vertex adapters declare every remapped Three attribute", () => {
  for (const stem of ["card_parallax_mrr", "card_parallax_flash"]) {
    const source = fs.readFileSync(
      path.join(ROOT, "public", "shaders", `${stem}.vert.glsl`),
      "utf8",
    );
    assert.match(source, /\bin vec4 tangent;/);
    assert.doesNotMatch(source, /layout\(location\s*=\s*\d+\)\s+in\b/);
  }
});

test("CardMRR MPB outputs are absent from the five material-uniform sets", () => {
  const expectedDynamic = {
    Effect_Emit: ["_AdditiveIntensity", "_Color3Blend", "_EmissiveIntensity", "_Switch"],
    Flash: ["_ChangeColor", "_LightColorIntensity", "_LightEmitIntensity", "_LightPower"],
    Card_Parallax_MRR: ["_ChangeColor", "_LightColorIntensity", "_LightEmitIntensity", "_LightPower"],
    Card_Parallax_Flash: ["_FlashIntensity", "_RadialAnim", "_RadialScaling"],
    "Frame-Holo-2Layer": [
      "_Layer2ColorPower",
      "_Layer2EmissiveIntensity",
      "_Layer2UVTranslate",
    ],
  };
  for (const manifest of manifests) {
    const contract = manifest.runtime_contract;
    const expectedProducer = contract.shader_key === "Effect_Emit"
      ? CARD_MRR_MATERIAL_OVERRIDE_PRODUCER_SCHEMA
      : CARD_MRR_PRODUCER_SCHEMA;
    const dynamic = Object.entries(contract.dynamic_uniforms)
      .filter(([, spec]) => spec.source === expectedProducer)
      .map(([name]) => name)
      .sort();
    assert.deepEqual(dynamic, expectedDynamic[contract.shader_key].toSorted());
    const materialNames = new Set([
      ...(contract.material_uniforms.floats || []),
      ...(contract.material_uniforms.ints || []),
      ...Object.keys(contract.material_uniforms.vectors || {}),
    ]);
    for (const name of dynamic) assert.equal(materialNames.has(name), false);
  }
});

console.log("Mega RR corpus contract: 1 scene, 5 selector ports, 10 draws");
