import assert from "node:assert/strict";
import fs from "node:fs";
import * as THREE from "three";
import { applyOfficialPassState } from "../public/render/context.js";
import {
  STENCIL_BUFFER_VALUES,
  STENCIL_REGION_BITS,
} from "../public/render/stencil-region.js";

const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const inner = readJson("public/shaders/inner_stencil_uniforms.json");
const outer = readJson("public/shaders/outer_stencil_uniforms.json");
const parallax = readJson("public/shaders/card_parallax_uniforms.json");
const metal = readJson("public/shaders/card_parallax_metal_uniforms.json");
const venusaur = readJson("public/scene.cPK_10_000040_00_FUSHIGIBANAex_RR.json");

assert.deepEqual(STENCIL_REGION_BITS, { card: 1, window: 2 });
assert.deepEqual(STENCIL_BUFFER_VALUES, { outside: 0, card: 1, window: 3 });

const outerStencil = outer.official_pass_runtime.stencil;
assert.equal(outerStencil.ref.val, STENCIL_REGION_BITS.card);
assert.equal(outerStencil.write_mask.val, STENCIL_REGION_BITS.card);
assert.equal(outerStencil.generic.comp.val, 8);
assert.equal(outerStencil.generic.pass.val, 2);

const innerStencil = inner.official_pass_runtime.stencil;
assert.equal(innerStencil.ref.val, STENCIL_REGION_BITS.window);
assert.equal(innerStencil.write_mask.val, STENCIL_REGION_BITS.window);
assert.equal(innerStencil.generic.comp.val, 8);
assert.equal(innerStencil.generic.pass.val, 2);

function assertRegionBinding(materialName, manifest, expectedRegion) {
  const recipe = venusaur.materials[materialName];
  assert.ok(recipe, `${materialName}: scene recipe`);
  assert.equal(recipe.clip, expectedRegion);
  assert.equal(recipe.floats._StencilRef, 0,
    `${materialName}: static Material remains distinct from its runtime region binding`);
  const material = new THREE.MeshBasicMaterial();
  assert.equal(applyOfficialPassState(
    material,
    recipe,
    manifest.official_pass_runtime,
  ), true);
  const expectedBit = STENCIL_REGION_BITS[expectedRegion];
  assert.equal(material.stencilFunc, THREE.EqualStencilFunc);
  assert.equal(material.stencilRef, expectedBit);
  assert.equal(material.stencilFuncMask, expectedBit);
  assert.equal(material.stencilZPass, THREE.KeepStencilOp);
  assert.equal(material.userData.stencilRegionBinding.region, expectedRegion);
}

for (const name of [
  "cPK_10_000040_00_FUSHIGIBANAex_RR_L_PAR1",
  "cPK_10_000040_00_FUSHIGIBANAex_RR_L_PAR2",
  "cPK_10_000040_00_FUSHIGIBANAex_RR_L_PAR3",
]) {
  assertRegionBinding(name, parallax, "window");
}
assertRegionBinding(
  "cPK_10_000040_00_FUSHIGIBANAex_RR_L_METAL",
  metal,
  "window",
);
assertRegionBinding(
  "cPK_10_000040_00_FUSHIGIBANAex_RR_L_ILL",
  parallax,
  "card",
);

const unboundRecipe = structuredClone(
  venusaur.materials.cPK_10_000040_00_FUSHIGIBANAex_RR_L_PAR1,
);
delete unboundRecipe.clip;
const unbound = new THREE.MeshBasicMaterial();
assert.equal(applyOfficialPassState(
  unbound,
  unboundRecipe,
  parallax.official_pass_runtime,
), true);
assert.equal(unbound.stencilRef, 0);
assert.equal(unbound.stencilFuncMask, 0,
  "mutation witness: deleting renderer region recreates the formerly unprotected draw");

console.log("Official stencil region binding OK: writer bits + 5 Venusaur renderer bindings");
