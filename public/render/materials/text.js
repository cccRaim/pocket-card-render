import * as THREE from "three";
import { defineMaterial } from "../registry.js";

const requiresDynamicText = (recipe, ctx) => !!(
  ctx.dynUITex
  && ctx.exactShaderPort(recipe)
);

function buildDynamicText(recipe, ctx) {
  const exact = ctx.exactShaderPort(recipe);
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
  const dynamicUIBinding = exact.manifest?.sampler_bindings
    ?.find(({ slot }) => slot === "_DynamicUITex");
  if (!dynamicUIBinding?.spirvName) {
    material.dispose();
    throw new Error(`${recipe.shader}: exact port has no _DynamicUITex sampler binding`);
  }
  material.userData.dynamicUIRole = "text";
  material.userData.dynamicUIUniform = dynamicUIBinding.spirvName;
  material.userData.exactShader = recipe.runtimeDispatch.shaderKey;
  material.userData.officialPassRuntime = exact.manifest?.official_pass_runtime || null;
  material.userData.officialSelector = exact.manifest?.official_selector || null;
  material.userData.officialExecutableIdentity = exact.manifest?.official_executable_identity || null;
  return material;
}

defineMaterial("dynamicText", {
  requires: requiresDynamicText,
  build: buildDynamicText,
});

// Text_Alpha has a distinct selector/pass and fragment program. It shares only the DynamicUI
// texture lifecycle with Text; keeping a separate strategy prevents accidental shader aliasing.
defineMaterial("dynamicTextAlpha", {
  requires: requiresDynamicText,
  build: buildDynamicText,
});
