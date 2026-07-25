import * as THREE from "three";
import { defineMaterial } from "../registry.js";

defineMaterial("prism", {
  requires: (recipe, ctx) => !!ctx.layerTexDefault(recipe, "_BaseTex"),
  build(recipe, ctx) {
    const exact = ctx.exactShaderPort(recipe, "Card_Prism");
    if (!exact) return null;
    const uniforms = ctx.exactPortUniforms(
      recipe,
      exact,
      (binding) => ctx.layerTexDefault(recipe, binding.slot),
    );
    uniforms.uTime = { value: 0 };
    const material = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      uniforms,
      vertexShader: exact.vert,
      fragmentShader: exact.frag,
      side: THREE.FrontSide,
      toneMapped: false,
    });
    material.userData.straight = false;
    material.userData.exactShader = "Card_Prism";
    material.userData.officialPassRuntime = exact.manifest?.official_pass_runtime || null;
    material.userData.officialSelector = exact.manifest?.official_selector || null;
    material.userData.officialExecutableIdentity = exact.manifest?.official_executable_identity || null;
    ctx.animMats.push(material);
    return material;
  },
});
