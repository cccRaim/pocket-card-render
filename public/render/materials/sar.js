import * as THREE from "three";
import { defineMaterial } from "../registry.js";

function exactMaterial(recipe, ctx, shaderKey, resolveSampler) {
  const exact = ctx.exactShaderPort(recipe, shaderKey);
  if (!exact) return null;
  const material = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: ctx.exactPortUniforms(recipe, exact, resolveSampler),
    vertexShader: exact.vert,
    fragmentShader: exact.frag,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  material.userData.exactShader = shaderKey;
  material.userData.officialPassRuntime = exact.manifest?.official_pass_runtime || null;
  material.userData.officialSelector = exact.manifest?.official_selector || null;
  material.userData.officialExecutableIdentity = exact.manifest?.official_executable_identity || null;
  return material;
}

defineMaterial("sarDoubleTexture", {
  requires: (recipe, ctx) => !!ctx.exactShaderPort(recipe, "Card_Illust_DoubleTexture"),
  build(recipe, ctx) {
    return exactMaterial(recipe, ctx, "Card_Illust_DoubleTexture", ({ slot }) => (
      slot === "_CubeMap"
        ? ctx.layerCubeDefault(recipe, slot, "shaderlab-black")
        : ctx.layerTexDefault(recipe, slot)
    ));
  },
});

defineMaterial("sarHologramLayer", {
  requires: (recipe, ctx) => !!(
    ctx.dynHoloTex
    && ctx.exactShaderPort(recipe, "Transparent_HologramLayer")
  ),
  build(recipe, ctx) {
    const exact = ctx.exactShaderPort(recipe, "Transparent_HologramLayer");
    const material = exactMaterial(recipe, ctx, "Transparent_HologramLayer", ({ slot }) => {
      if (slot === "_DynamicUITex") return ctx.dynHoloTex;
      if (slot === "_CubeMap") return ctx.layerCubeDefault(recipe, slot, "shaderlab-white");
      return ctx.layerTexDefault(recipe, slot);
    });
    if (!material || !exact) return null;
    const dynamicBinding = exact.manifest.sampler_bindings
      .find(({ slot }) => slot === "_DynamicUITex");
    if (!dynamicBinding) return null;
    material.userData.dynamicHoloUniform = dynamicBinding.spirvName;
    ctx.exHoloMats.push(material);
    return material;
  },
});

defineMaterial("sarMegaRainbow", {
  requires: (recipe, ctx) => !!(
    ctx.dynHoloTex
    && ctx.exactShaderPort(recipe, "Card_ShadowBoxUI_Transparent_Rainbow")
  ),
  build(recipe, ctx) {
    const exact = ctx.exactShaderPort(recipe, "Card_ShadowBoxUI_Transparent_Rainbow");
    const material = exactMaterial(
      recipe,
      ctx,
      "Card_ShadowBoxUI_Transparent_Rainbow",
      ({ slot }) => slot === "_DynamicUITex"
        ? ctx.dynHoloTex
        : ctx.layerTexDefault(recipe, slot),
    );
    if (!material || !exact) return null;
    const dynamicBinding = exact.manifest.sampler_bindings
      .find(({ slot }) => slot === "_DynamicUITex");
    if (!dynamicBinding) return null;
    material.userData.dynamicHoloUniform = dynamicBinding.spirvName;
    ctx.exHoloMats.push(material);
    return material;
  },
});
