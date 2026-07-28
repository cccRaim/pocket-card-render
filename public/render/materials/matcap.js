import * as THREE from "three";
import { defineMaterial } from "../registry.js";

defineMaterial("matCapLighting", {
  requires: (recipe, ctx) => !!(
    ctx.exactShaderPort(recipe)
    && ctx.layerTexDefault(recipe, "_MatCapLightTex")
    && ctx.layerTexDefault(recipe, "_LightingMask")
  ),
  build(recipe, ctx) {
    const exact = ctx.exactShaderPort(recipe);
    if (!exact) return null;
    const material = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      uniforms: ctx.exactPortUniforms(recipe, exact, ({ slot }) => ctx.layerTexDefault(recipe, slot)),
      vertexShader: exact.vert,
      fragmentShader: exact.frag,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    material.userData.exactShader = "Card_Parallax_MatCap_Lighting";
    material.userData.officialPassRuntime = exact.manifest?.official_pass_runtime || null;
    material.userData.officialSelector = exact.manifest?.official_selector || null;
    material.userData.officialExecutableIdentity = exact.manifest?.official_executable_identity || null;
    return material;
  },
});
