import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  CARD_MRR_MATERIAL_OVERRIDE_PRODUCER_SCHEMA,
} from "../public/render/card-mrr.js";
import { buildExactRuntimeMaterial } from "../public/render/materials/exact-runtime.js";
import { updateMegaRuntime } from "../public/render/mega-runtime.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");
const readJson = (file) => JSON.parse(read(file));
const manifest = readJson("public/shaders/effect_emit_uniforms.json");
const exact = {
  vert: read("public/shaders/effect_emit.vert.glsl"),
  frag: read("public/shaders/effect_emit.frag.glsl"),
  manifest,
};
const DYNAMIC = [
  "_Switch",
  "_AdditiveIntensity",
  "_Color3Blend",
  "_EmissiveIntensity",
];
const SCENES = [
  "public/scene.cPK_20_011840_02_MEGATYLTALISex_SSR.json",
  "public/scene.cPK_20_016510_01_MEGAHASSAMex_SSR.json",
];

function context() {
  return {
    dynamicPortMats: [],
    runtimeComponentStates: new Map(),
    runtimeComponentTextures: new Map(),
    runtimeSettings: {},
    exactShaderPort: () => exact,
    exactPortUniforms: () => ({}),
    layerCubeDefault: () => null,
    layerTexDefault: () => null,
  };
}

test("Effect_Emit static SSR draws retain exact Material values without CardMRR", () => {
  let draws = 0;
  for (const sceneFile of SCENES) {
    const scene = readJson(sceneFile);
    for (const draw of scene.officialDraws) {
      const recipe = scene.materials[draw.materialName];
      if (recipe?.shader !== "Effect_Emit") continue;
      assert.deepEqual(draw.rendererProperties, {});
      const ctx = context();
      const material = buildExactRuntimeMaterial({
        ...recipe,
        runtimeDispatch: { shaderKey: "Effect_Emit" },
        rendererProperties: draw.rendererProperties,
      }, ctx);
      assert.equal(material.userData.cardMRRStaticMaterial, true);
      for (const name of DYNAMIC) {
        const expected = recipe.floats[name]
          ?? manifest.official_shader_property_defaults.floats?.[name]
          ?? 0;
        assert.equal(
          manifest.runtime_contract.dynamic_uniforms[name].source,
          CARD_MRR_MATERIAL_OVERRIDE_PRODUCER_SCHEMA,
        );
        assert.equal(material.uniforms[name].value, expected);
      }
      updateMegaRuntime([material], { x: 0, y: 0, z: 0, w: 1 });
      for (const name of DYNAMIC) {
        const expected = recipe.floats[name]
          ?? manifest.official_shader_property_defaults.floats?.[name]
          ?? 0;
        assert.equal(material.uniforms[name].value, expected);
      }
      assert.equal(
        material.userData.dynamicPortRuntimeAudit.status,
        "known-implementation",
      );
      assert.deepEqual(
        material.userData.dynamicPortRuntimeAudit.runtimeRequiredUniforms,
        [],
      );
      material.dispose();
      draws += 1;
    }
  }
  assert.equal(draws, 4);
});
