import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveTextureAssetPath } from "./build.mjs";
import { SHADER } from "../public/render/rarities.js";
import "../public/render/materials/index.js";
import { listKinds } from "../public/render/registry.js";
import { selectExactShaderPort } from "../public/render/context.js";
import { loadExactShaderPortsFromContract } from "../public/render/exact-port-loader.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC = path.join(ROOT, "public");
const SCENES = [
  ["scene.cPK_20_000470_01_FIREex_SAR.json", []],
  ["scene.cPK_20_007800_01_AKUZIKINGex_SAR.json", []],
  ["scene.cPK_20_010840_01_MEGAKAILIOSex_SAR.json", ["Card_ShadowBoxUI_Transparent_Rainbow"]],
  ["scene.cPK_20_018280_01_TETSUNOTSUTSUMIex_SAR.json", ["Transparent_HologramLayer", "Card_Illust_DoubleTexture"]],
  ["scene.cPK_20_018410_01_HABATAKUKAMIex_SAR.json", ["Transparent_HologramLayer", "Card_Illust_DoubleTexture"]],
];
const SAR_EXACT = new Set([
  "Card_Illust_DoubleTexture",
  "Transparent_HologramLayer",
  "Card_ShadowBoxUI_Transparent_Rainbow",
]);
const textDesignContract = JSON.parse(fs.readFileSync(
  path.join(PUBLIC, "render", "card-text-design-contract.json"),
  "utf8",
));
const officialSarDesigns = Object.entries(textDesignContract.counts.cardsByDesign)
  .filter(([design]) => design.startsWith("Pokemon_SAR"))
  .sort(([left], [right]) => left.localeCompare(right));

function response(body) {
  return {
    ok: true,
    async json() { return JSON.parse(body); },
    async text() { return body; },
  };
}

const exactShaders = await loadExactShaderPortsFromContract({
  contractUrl: "shaders/official_program_port_contract.json",
  fetchAsset: async (url) => {
    const file = path.join(PUBLIC, ...String(url).replaceAll("\\", "/").split("/"));
    return fs.existsSync(file) ? response(fs.readFileSync(file, "utf8")) : { ok: false };
  },
});
const kinds = new Set(listKinds());
const selectorHits = new Map();
const corpusSarDesigns = new Set();

for (const [file, requiredSpecialShaders] of SCENES) {
  const scene = JSON.parse(fs.readFileSync(path.join(PUBLIC, file), "utf8"));
  const design = textDesignContract.cards[scene.card.id]?.design;
  assert.ok(design?.startsWith("Pokemon_SAR"), `${file}: missing official SAR DesignSettings`);
  corpusSarDesigns.add(design);
  assert.deepEqual(scene._missing || [], [], `${file}: scene asset references`);
  const shaders = new Set(Object.values(scene.materials || {}).map((material) => material.shader));
  for (const shader of requiredSpecialShaders) {
    assert.ok(shaders.has(shader), `${file}: missing SAR shader ${shader}`);
  }
  for (const [index, suffix] of ["01", "02", "03"].entries()) {
    const material = scene.materials[`Pokemon_Frame_SSA${index + 1}`];
    assert.ok(material, `${file}: missing SAR frame ${suffix}`);
    const rampMask = material.textures?._RampMaskTex;
    const ramp = material.textures?._RampTex;
    assert.ok(rampMask && ramp, `${file}: SAR frame ${suffix} lacks ramp bindings`);
    assert.notEqual(rampMask.name, ramp.name, `${file}: SAR frame ${suffix} aliases RampMask and Ramp`);
    assert.match(rampMask.url, /\/OldHologram\/RampMask\//, `${file}: SAR frame ${suffix} mask path`);
    assert.match(ramp.url, /\/OldHologram\/Ramp\//, `${file}: SAR frame ${suffix} ramp path`);
    assert.ok(rampMask.textureIdentity?.identity, `${file}: SAR frame ${suffix} mask identity`);
    assert.ok(ramp.textureIdentity?.identity, `${file}: SAR frame ${suffix} ramp identity`);
    assert.notEqual(
      rampMask.textureIdentity.identity,
      ramp.textureIdentity.identity,
      `${file}: SAR frame ${suffix} official Texture2D identity`,
    );
  }
  for (const [materialName, material] of Object.entries(scene.materials || {})) {
    if (!material.shader) continue;
    const route = SHADER[material.shader];
    assert.ok(route, `${file}/${materialName}: unmapped shader ${material.shader}`);
    if (!route.defer) {
      assert.ok(kinds.has(route.kind), `${file}/${materialName}: missing material kind ${route.kind}`);
    }
    if (!SAR_EXACT.has(material.shader)) continue;
    const exact = selectExactShaderPort(exactShaders, material, material.shader);
    assert.ok(exact, `${file}/${materialName}: exact selector did not resolve`);
    const selector = exact.manifest.official_selector;
    const key = `${material.shader}:${JSON.stringify(selector.keywords)}`;
    selectorHits.set(key, (selectorHits.get(key) || 0) + 1);
    for (const binding of exact.manifest.sampler_bindings) {
      const descriptor = exact.manifest.official_shader_property_defaults
        ?.textureDescriptors?.[binding.slot];
      assert.ok(
        material.textures?.[binding.slot]?.name || descriptor,
        `${file}/${materialName}: sampler ${binding.slot} has no material value or Shader default`,
      );
    }
  }
}

assert.ok(selectorHits.has("Card_Illust_DoubleTexture:[]"));
assert.ok(selectorHits.has('Card_Illust_DoubleTexture:["_USEGRADATIONTEXTURE_ON"]'));
assert.ok(selectorHits.has(
  'Transparent_HologramLayer:["_USE_DYNAMIC_UI_AS_HOLO_MASK","_USE_DYNAMIC_UI_AS_METALLIC_MASK"]',
));
assert.ok(selectorHits.has("Card_ShadowBoxUI_Transparent_Rainbow:[]"));
assert.deepEqual(
  [...corpusSarDesigns].sort(),
  officialSarDesigns.map(([design]) => design),
  "the minimal SAR corpus must cover every official SAR DesignSettings family",
);
assert.equal(
  officialSarDesigns.reduce((sum, [, count]) => sum + count, 0),
  101,
  "the current official sample's SAR family inventory changed",
);

const collisionRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pcr-texture-collision-"));
try {
  const rampRelative = "Assets/Common/OldHologram/Ramp/SSA_RMP_Border_01.png";
  const maskRelative = "Assets/Common/OldHologram/RampMask/SSA_RMP_Border_01.png";
  const rampAbsolute = path.join(collisionRoot, ...rampRelative.split("/"));
  const maskAbsolute = path.join(collisionRoot, ...maskRelative.split("/"));
  fs.mkdirSync(path.dirname(rampAbsolute), { recursive: true });
  fs.mkdirSync(path.dirname(maskAbsolute), { recursive: true });
  fs.writeFileSync(rampAbsolute, "official-ramp");
  fs.writeFileSync(maskAbsolute, "official-mask");
  const collisionIndex = new Map([[
    "ssa_rmp_border_01",
    [maskAbsolute, rampAbsolute].sort(),
  ]]);
  const ramp = resolveTextureAssetPath({
    name: "SSA_RMP_Border_01",
    assetPath: rampRelative,
    assetsRoot: collisionRoot,
    pngIndex: collisionIndex,
    cardId: "fixture",
  });
  const mask = resolveTextureAssetPath({
    name: "SSA_RMP_Border_01",
    assetPath: maskRelative,
    assetsRoot: collisionRoot,
    pngIndex: collisionIndex,
    cardId: "fixture",
  });
  assert.equal(ramp.abs, rampAbsolute);
  assert.equal(mask.abs, maskAbsolute);
  assert.notEqual(ramp.resourceKey, mask.resourceKey);
  assert.throws(
    () => resolveTextureAssetPath({
      name: "SSA_RMP_Border_01",
      assetPath: null,
      assetsRoot: collisionRoot,
      pngIndex: collisionIndex,
      cardId: "fixture",
    }),
    /ambiguous across 2 official asset paths/,
  );
} finally {
  fs.rmSync(collisionRoot, { recursive: true, force: true });
}

console.log(
  `SAR rendering corpus OK: ${SCENES.length} DesignSettings families, `
  + `${selectorHits.size} selector/keyword routes, 101 official cards`,
);
