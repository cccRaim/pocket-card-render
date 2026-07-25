import * as THREE from "three";
import { defineMaterial } from "../registry.js";

function exactStencilMaterial(recipe, ctx, shaderKey) {
  const exact = ctx.exactShaderPort(recipe, shaderKey);
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
  material.userData.exactShader = shaderKey;
  material.userData.officialPassRuntime = exact.manifest?.official_pass_runtime || null;
  material.userData.officialSelector = exact.manifest?.official_selector || null;
  material.userData.officialExecutableIdentity = exact.manifest?.official_executable_identity || null;
  return material;
}

defineMaterial("outerStencil", {
  requires: (recipe, ctx) => !!ctx.exactShaderPort(recipe, "OuterStencil"),
  build: (recipe, ctx) => exactStencilMaterial(recipe, ctx, "OuterStencil"),
});

defineMaterial("innerStencil", {
  requires: (recipe, ctx) => (
    !!ctx.exactShaderPort(recipe, "InnerStencil")
    && !!ctx.layerTexDefault(recipe, "_BaseTex")
  ),
  build: (recipe, ctx) => exactStencilMaterial(recipe, ctx, "InnerStencil"),
});

defineMaterial("illustStencil", {
  requires: (recipe, ctx) => (
    !!ctx.exactShaderPort(recipe, "IllustStencil")
    && !!ctx.layerTexDefault(recipe, "_BaseTex")
  ),
  build: (recipe, ctx) => exactStencilMaterial(recipe, ctx, "IllustStencil"),
});
