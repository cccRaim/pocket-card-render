import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { updateMegaRuntime } from "../public/render/mega-runtime.js";
import {
  THREE_PERSPECTIVE_ZBUFFER_PRODUCER_SCHEMA,
} from "../public/render/projection-depth.js";
import {
  compileRuntimeMaterialDispatchIndex,
  resolveRuntimeMaterialDispatch,
} from "../public/render/runtime-dispatch-contract.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCENE_FILE = "public/scene.cPK_20_010840_00_MEGAKAILIOSex_SR.json";
const MANIFEST_FILES = [
  "public/shaders/card_parallax_emit_mask_uniforms.json",
  "public/shaders/hologram_flip_outline_uniforms.json",
  "public/shaders/card_parallax_transparent_translate_uniforms.json",
  "public/shaders/shadowbox_effect_flow_default_uniforms.json",
  "public/shaders/shadowbox_effect_flow_use_col4_uniforms.json",
  "public/shaders/shadowbox_effect_flow_use_old_noise_uniforms.json",
  "public/shaders/card_aura_base_uniforms.json",
  "public/shaders/card_aura_col4_uniforms.json",
  "public/shaders/card_aura_old_noise_uniforms.json",
];
const SHADERS = new Set([
  "Card_Parallax_EmitMask",
  "Hologram-FlipOutline",
  "Card_Parallax_Transparent_Translate",
  "Card_ShadowBox_Effect_Flow",
  "Card_Aura",
]);

const readJson = (file) => JSON.parse(fs.readFileSync(path.join(ROOT, file), "utf8"));
const scene = readJson(SCENE_FILE);
const contract = readJson("public/shaders/official_program_port_contract.json");
const dispatch = compileRuntimeMaterialDispatchIndex(contract);
const manifests = MANIFEST_FILES.map(readJson);
const manifestBySelector = new Map(
  manifests.map((manifest) => [manifest.official_selector.selectorId, manifest]),
);

function assertMaterialBindings(recipe, manifest) {
  for (const binding of manifest.sampler_bindings) {
    const descriptor = manifest.official_shader_property_defaults
      .textureDescriptors?.[binding.slot];
    const backendDefault = manifest.runtime_contract.backend_texture_defaults?.[binding.slot];
    assert.ok(
      recipe.textures?.[binding.slot] || descriptor?.defaultName || backendDefault,
      `${recipe.go}/${binding.slot} is unresolved`,
    );
  }
  for (const name of manifest.runtime_contract.material_uniforms.floats) {
    assert.ok(
      Object.hasOwn(recipe.floats || {}, name)
        || Object.hasOwn(manifest.official_shader_property_defaults.floats || {}, name),
      `${recipe.go}/${name} is unresolved`,
    );
  }
  for (const name of manifest.runtime_contract.material_uniforms.ints) {
    assert.ok(
      Object.hasOwn(recipe.floats || {}, name)
        || Object.hasOwn(manifest.official_shader_property_defaults.floats || {}, name),
      `${recipe.go}/${name} is unresolved`,
    );
  }
  for (const name of Object.keys(manifest.runtime_contract.material_uniforms.vectors)) {
    assert.ok(
      Object.hasOwn(recipe.colors || {}, name)
        || Object.hasOwn(manifest.official_shader_property_defaults.vectors || {}, name),
      `${recipe.go}/${name} is unresolved`,
    );
  }
}

test("Mega SR Shader defaults preserve the official normal-map fallback", () => {
  const flip = manifests.find(
    (manifest) => manifest.runtime_contract.shader_key === "Hologram-FlipOutline",
  );
  const descriptor = flip.official_shader_property_defaults.textureDescriptors._NormalMap;
  assert.deepEqual(descriptor, { defaultName: "bump", dimension: 2 });
  assert.equal(flip.runtime_contract.require_complete_active_bindings, true);
});

test("Mega SR corpus routes all currently known families through exact selector ports", () => {
  const counts = new Map();
  for (const recipe of Object.values(scene.materials)) {
    if (!SHADERS.has(recipe.shader)) continue;
    const route = resolveRuntimeMaterialDispatch(dispatch, recipe);
    assert.ok(route, `${recipe.go} has no runtime dispatch`);
    assert.equal(route.support, "implemented");
    assert.equal(route.defer, false);
    assert.equal(route.officialPorts.length, 1);
    const selector = route.officialPorts[0];
    const manifest = manifestBySelector.get(selector.selectorId);
    assert.ok(manifest, `${recipe.go} has no exact manifest`);
    assert.equal(selector.candidateWitnessId, manifest.official_selector.candidateWitnessId);
    assert.equal(selector.semanticExecutableId, manifest.official_selector.semanticExecutableId);
    assert.equal(manifest.runtime_contract.require_complete_active_bindings, true);
    assert.equal(manifest.runtime_contract.mrt_attachments, 2);
    assertMaterialBindings(recipe, manifest);
    counts.set(recipe.shader, (counts.get(recipe.shader) || 0) + 1);
  }
  assert.equal(counts.get("Card_Parallax_EmitMask"), 2);
  assert.equal(counts.get("Hologram-FlipOutline"), 4);
  assert.equal(counts.get("Card_Parallax_Transparent_Translate"), 1);
  assert.equal(counts.get("Card_ShadowBox_Effect_Flow"), 4);
  assert.equal(counts.get("Card_Aura"), 1);
});

test("Mega SR routes keep their official composition families", () => {
  const emitMask = resolveRuntimeMaterialDispatch(dispatch, {
    official: {
      shader: manifests[0].official_selector.shaderIdentity,
      validKeywords: [],
    },
  });
  const flipOutline = resolveRuntimeMaterialDispatch(dispatch, {
    official: {
      shader: manifests[1].official_selector.shaderIdentity,
      validKeywords: [],
    },
  });
  assert.equal(emitMask.strategy, "emitMaskParallax");
  assert.equal(emitMask.blend, "premult");
  assert.equal(emitMask.capabilities.stencil, "read-stencil-ref");
  assert.equal(flipOutline.strategy, "megaFlipOutline");
  assert.equal(flipOutline.blend, "premult");
  assert.equal(flipOutline.capabilities.stencil, "shadowbox");
  assert.equal(flipOutline.capabilities.fixedShadowboxDepth, true);
  const expected = {
    Card_Parallax_Transparent_Translate: ["megaParallaxTranslate", "read-stencil-ref"],
    Card_ShadowBox_Effect_Flow: ["megaShadowboxEffectFlow", "read-stencil"],
    Card_Aura: ["megaAura", "read-stencil"],
  };
  for (const [shaderKey, [strategy, stencil]] of Object.entries(expected)) {
    const manifest = manifests.find(
      (candidate) => candidate.runtime_contract.shader_key === shaderKey,
    );
    const route = resolveRuntimeMaterialDispatch(dispatch, {
      official: {
        shader: manifest.official_selector.shaderIdentity,
        validKeywords: manifest.official_selector.keywords,
      },
    });
    assert.equal(route.strategy, strategy);
    assert.equal(route.blend, "premult");
    assert.equal(route.capabilities.stencil, stencil);
  }
});

test("Mega SR keeps only Effect Flow noise unresolved", () => {
  const vector = { value: null, set(...value) { this.value = value; } };
  const materials = [
    {
      uniforms: {
        _NoiseMaskNoiseSpeed: { value: -1 },
        _ZBufferParams: { value: vector },
      },
      userData: {
        exactShader: "Card_ShadowBox_Effect_Flow",
        megaDynamicUniforms: [
          "_NoiseMaskNoiseSpeed",
          "_ZBufferParams",
        ],
        megaDynamicUniformSpecs: {
          _NoiseMaskNoiseSpeed: {
            type: "float",
            source: "Card_ShadowBox_Effect_Flow component runtime (unresolved)",
          },
          _ZBufferParams: {
            type: "vec4",
            source: THREE_PERSPECTIVE_ZBUFFER_PRODUCER_SCHEMA,
          },
        },
        megaDynamicDefaults: {
          _NoiseMaskNoiseSpeed: 0.73,
        },
      },
    },
  ];
  updateMegaRuntime(materials, { x: 0, y: 0 }, 1.25, { near: 0.3, far: 1000 });
  assert.equal(materials[0].uniforms._NoiseMaskNoiseSpeed.value, 0.73);
  assert.equal(vector.value.length, 4);
  assert.equal(
    materials[0].userData.megaRuntimeAudit.status,
    "runtime-required",
  );
});

console.log("Mega SR corpus contract: 1 scene, 9 selector ports, 12 draws");
