import * as THREE from "three";
import { createKiraPuyoState } from "../kira-puyo.js";
import { createCircularKiraState } from "../circular-kira.js";
import { defineMaterial } from "../registry.js";

const KIRA_SLOTS = ["_BaseTex", "_ScrollLayerMask", "_RampTex"];

defineMaterial("scalingKira", {
  requires: (recipe, ctx) => KIRA_SLOTS.every((slot) => !!ctx.layerTexDefault(recipe, slot)),
  build(recipe, ctx) {
    const exact = ctx.exactShaderPort(recipe, "Card_Scaling_Kira");
    const component = recipe.rendererProperties?.kiraPuyo;
    const settings = component && ctx.runtimeSettings?.kiraPuyo?.[component.settingsIdentity];
    if (!exact || !component || !settings) return null;
    const state = createKiraPuyoState(component, settings);
    const uniforms = ctx.exactPortUniforms(
      recipe,
      exact,
      (binding) => ctx.layerTexDefault(recipe, binding.slot),
    );
    Object.assign(uniforms, {
      _RampRepeat: { value: component.rampRepeat },
      _ScrollScale: { value: component.scrollScale },
      _ScrollOffset: { value: component.scrollOffset },
      _KiraScale: { value: state.kiraScale },
      _Anim: { value: state.anim },
    });
    const material = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      uniforms,
      vertexShader: exact.vert,
      fragmentShader: exact.frag,
      side: THREE.FrontSide,
      toneMapped: false,
    });
    material.userData.straight = true;
    material.userData.exactShader = "Card_Scaling_Kira";
    material.userData.officialPassRuntime = exact.manifest?.official_pass_runtime || null;
    material.userData.officialSelector = exact.manifest?.official_selector || null;
    material.userData.officialExecutableIdentity = exact.manifest?.official_executable_identity || null;
    material.userData.kiraPuyoState = state;
    ctx.kiraPuyoMats.push(material);
    return material;
  },
});

function circularState(recipe, ctx) {
  const binding = recipe.rendererProperties?.circularKira;
  const config = binding && ctx.runtimeSettings?.circularKira?.[binding.componentIdentity];
  if (!binding || !config) return null;
  let state = ctx.circularKiraComponents.get(binding.componentIdentity);
  if (!state) {
    state = createCircularKiraState(binding.componentIdentity, config);
    ctx.circularKiraComponents.set(binding.componentIdentity, state);
  }
  return { binding, state };
}

function hasCircularContract(recipe, ctx) {
  const binding = recipe.rendererProperties?.circularKira;
  return !!binding && !!ctx.runtimeSettings?.circularKira?.[binding.componentIdentity];
}

function circularMaterials(recipe, ctx, shader, dynamicUniforms) {
  const component = circularState(recipe, ctx);
  const ports = ctx.exactShaderPorts(recipe, shader);
  if (!component || ports.length !== 2) return null;
  return ports.map((port) => {
    const uniforms = ctx.exactPortUniforms(
      recipe,
      port,
      (sampler) => ctx.layerTexDefault(recipe, sampler.slot),
    );
    Object.assign(uniforms, dynamicUniforms(component.state));
    const material = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      uniforms,
      vertexShader: port.vert,
      fragmentShader: port.frag,
      side: THREE.FrontSide,
      toneMapped: false,
    });
    material.userData.straight = true;
    material.userData.exactShader = shader;
    material.userData.officialPassRuntime = port.manifest?.official_pass_runtime || null;
    material.userData.officialSelector = port.manifest?.official_selector || null;
    material.userData.officialExecutableIdentity = port.manifest?.official_executable_identity || null;
    material.userData.circularKiraState = component.state;
    material.userData.circularKiraRole = component.binding.role;
    component.state.materials.add(material);
    return material;
  });
}

defineMaterial("circularMovingKira", {
  requires: (recipe, ctx) => hasCircularContract(recipe, ctx)
    && ctx.exactShaderPorts(recipe, "Card_Circular_Moving_Kira").length === 2,
  build: (recipe, ctx) => circularMaterials(
    recipe,
    ctx,
    "Card_Circular_Moving_Kira",
    (state) => ({
      _Tilt: { value: state.tilt },
      _CircularDefaultAngle: { value: state.defaultCircularAngle },
      _MoveAngle: { value: state.moveAngle },
      _PrimAngles: { value: state.primAngles },
      _PrimBaseScales: { value: state.primBaseScales },
      _PrimBaseIntensities: { value: state.primBaseIntensities },
      _PrimMinIntensities: { value: state.primMinIntensities },
      _PrimMaxIntensities: { value: state.primMaxIntensities },
      _PrimFlickerScaling: { value: state.primFlickerScaling },
      _PrimFlickerAnimOffsets: { value: state.primFlickerAnimOffsets },
      _PrimTypes: { value: state.primTypes },
      _PrimMorphing: { value: state.primMorphing },
    }),
  ),
});

defineMaterial("circularTrailKira", {
  requires: (recipe, ctx) => hasCircularContract(recipe, ctx)
    && ctx.exactShaderPorts(recipe, "Card_Circular_Trail_Kira").length === 2,
  build: (recipe, ctx) => circularMaterials(
    recipe,
    ctx,
    "Card_Circular_Trail_Kira",
    (state) => ({
      _CircularDefaultAngle: { value: state.defaultCircularAngle },
      _NoiseTime: { value: state.time * 2 },
    }),
  ),
});
