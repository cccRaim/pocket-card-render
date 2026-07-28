import * as THREE from "three";
import { defineMaterial } from "../registry.js";

function exactStencilMaterial(recipe, ctx) {
  const exact = ctx.exactShaderPort(recipe);
  if (!exact) return null;
  const material = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: ctx.exactPortUniforms(
      recipe,
      exact,
      ({ slot }) => ctx.layerTexDefault(recipe, slot),
    ),
    vertexShader: exact.vert,
    fragmentShader: exact.frag,
    toneMapped: false,
  });
  material.userData.exactShader = recipe.runtimeDispatch.shaderKey;
  material.userData.officialPassRuntime = exact.manifest?.official_pass_runtime || null;
  material.userData.officialSelector = exact.manifest?.official_selector || null;
  material.userData.officialExecutableIdentity = exact.manifest?.official_executable_identity || null;
  return material;
}

defineMaterial("outerStencil", {
  requires: (recipe, ctx) => !!ctx.exactShaderPort(recipe),
  build: (recipe, ctx) => exactStencilMaterial(recipe, ctx),
});

defineMaterial("innerStencil", {
  requires: (recipe, ctx) => (
    !!ctx.exactShaderPort(recipe)
    && !!ctx.layerTexDefault(recipe, "_BaseTex")
  ),
  build: (recipe, ctx) => exactStencilMaterial(recipe, ctx),
});

defineMaterial("illustStencil", {
  requires: (recipe, ctx) => (
    !!ctx.exactShaderPort(recipe)
    && !!ctx.layerTexDefault(recipe, "_BaseTex")
  ),
  build: (recipe, ctx) => exactStencilMaterial(recipe, ctx),
});
