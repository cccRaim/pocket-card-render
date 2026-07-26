import * as THREE from "three";
import { defineMaterial } from "../registry.js";

defineMaterial("dynamicText", {
  requires: (recipe, ctx) => !!(
    ctx.dynUITex
    && ctx.exactShaderPort(recipe, "Text")
  ),
  build(recipe, ctx) {
    const exact = ctx.exactShaderPort(recipe, "Text");
    if (!exact) return null;
    const material = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      uniforms: ctx.exactPortUniforms(
        recipe,
        exact,
        ({ slot }) => slot === "_DynamicUITex" ? ctx.dynUITex : null,
      ),
      vertexShader: exact.vert,
      fragmentShader: exact.frag,
      toneMapped: false,
    });
    material.userData.dynamicUIUniform = "_13";
    material.userData.exactShader = "Text";
    material.userData.officialPassRuntime = exact.manifest?.official_pass_runtime || null;
    material.userData.officialSelector = exact.manifest?.official_selector || null;
    material.userData.officialExecutableIdentity = exact.manifest?.official_executable_identity || null;
    return material;
  },
});
