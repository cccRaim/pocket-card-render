import {
  CARD_RGB_PRODUCER_SCHEMA, CARD_UV_SHADOW_PRODUCER_SCHEMA, CARD_RELIEF_PRODUCER_SCHEMA,
  computeCardRgbUniforms, createUvShadowState, updateUvShadow, createCardReliefState, updateCardRelief,
} from "./card-parameters.js";
import {
  CARD_DUAL_MRR_PRODUCER_SCHEMA, CARD_DUAL_MSR_PRODUCER_SCHEMA,
  createCardDualMRRState, updateCardDualMRR, cardDualMRRUniforms,
  createCardDualMSRState, updateCardDualMSR, cardDualMSRUniforms,
} from "./card-dual.js";
import { CARD_MRR_PRODUCER_SCHEMA, CARD_MRR_MATERIAL_OVERRIDE_PRODUCER_SCHEMA } from "./card-mrr.js";
import { CARD_MSR_PRODUCER_SCHEMA } from "./card-msr.js";

const SOURCES = new Set([CARD_RGB_PRODUCER_SCHEMA, CARD_UV_SHADOW_PRODUCER_SCHEMA,
  CARD_RELIEF_PRODUCER_SCHEMA, CARD_DUAL_MRR_PRODUCER_SCHEMA, CARD_DUAL_MSR_PRODUCER_SCHEMA]);
const RELIEF_ROLES = {
  main: ["_ChangeColor", "_LightColorIntensity", "_LightEmitIntensity", "_LightPower"],
  shadow: ["_Switch", "_ShadowDecay"],
  effect: ["_Switch", "_AdditiveIntensity", "_FlashBlend", "_EmissiveIntensity"],
};

function cacheState(ctx, family, identity, create) {
  ctx.runtimeComponentStates ??= new Map();
  if (!(ctx.runtimeComponentStates instanceof Map)) throw new TypeError("runtimeComponentStates must be a Map");
  const key = `${family}\0${identity}`;
  if (!ctx.runtimeComponentStates.has(key)) ctx.runtimeComponentStates.set(key, create());
  return ctx.runtimeComponentStates.get(key);
}

function configFor(ctx, recipe, family, roles = null) {
  const binding = recipe.rendererProperties?.[family];
  const config = ctx.runtimeSettings?.[family]?.[binding?.componentIdentity];
  const renderers = roles ? config?.rendererBindings?.[binding?.role] : config?.rendererBindings;
  if (!config || config.componentIdentity !== binding?.componentIdentity
      || !binding?.rendererIdentity || roles && !roles.includes(binding.role)
      || !Array.isArray(renderers) || !renderers.includes(binding.rendererIdentity)) {
    throw new Error(`${recipe.runtimeDispatch.shaderKey}: ${family} renderer binding is missing`);
  }
  return { binding, config };
}

function setValue(uniform, value, name) {
  if (!uniform) throw new Error(`Missing extended card uniform ${name}`);
  if (Array.isArray(value) || ArrayBuffer.isView(value)) {
    if (!Array.from(value).every(Number.isFinite)) throw new Error(`Nonfinite card output ${name}`);
    const count = uniform.value?.isVector2 ? 2 : uniform.value?.isVector3 ? 3 : uniform.value?.isVector4 ? 4 : null;
    if (count) {
      if (value.length < count) throw new Error(`Invalid card output shape ${name}`);
      uniform.value.fromArray(value);
    } else if (ArrayBuffer.isView(uniform.value) && uniform.value.length === value.length) uniform.value.set(value);
    else throw new Error(`Invalid card uniform shape ${name}`);
  } else {
    if (!Number.isFinite(value) || typeof uniform.value !== "number") throw new Error(`Invalid scalar card output ${name}`);
    uniform.value = value;
  }
}

// Only explicitly bound components activate these producers. Source identifiers
// are retained for dispatch compatibility; every new producer remains reference-only.
export function bindExtendedCardRuntime(material, recipe, ctx, manifest) {
  const data = material.userData;
  const specs = data.dynamicPortUniformSpecs;
  const register = (name, type, source) => {
    if (!material.uniforms[name]) return false;
    const reliefOverridesMRR = source === CARD_RELIEF_PRODUCER_SCHEMA
      && specs[name]?.source === CARD_MRR_PRODUCER_SCHEMA && !recipe.rendererProperties?.cardMRR;
    if (specs[name] && specs[name].source !== source && !reliefOverridesMRR) throw new Error(`Conflicting card producer for ${name}`);
    specs[name] = { ...specs[name], type, source };
    return true;
  };
  if (recipe.rendererProperties?.cardUVShadow && register("_ShadowUVTranslate", "vec2", CARD_UV_SHADOW_PRODUCER_SCHEMA)) {
    const { config } = configFor(ctx, recipe, "cardUVShadow");
    data.cardUVShadowState = cacheState(ctx, "cardUVShadow", config.componentIdentity, () => createUvShadowState(config));
  }
  const relief = recipe.rendererProperties?.cardMReliefSR;
  if (relief) {
    if (!RELIEF_ROLES[relief.role]) throw new Error(`Invalid Relief role ${relief.role}`);
    const registered = RELIEF_ROLES[relief.role].map((name) => register(name, "float", CARD_RELIEF_PRODUCER_SCHEMA));
    if (registered.some(Boolean)) {
      const { config } = configFor(ctx, recipe, "cardMReliefSR", Object.keys(RELIEF_ROLES));
      const settings = ctx.runtimeSettings?.reliefMSRAnimationSettings?.[config.animationSettingsIdentity];
      data.cardMReliefSRState = cacheState(ctx, "cardMReliefSR", config.componentIdentity, () => createCardReliefState(config, settings));
      data.cardMReliefSRRole = relief.role;
    }
  }
  for (const [family, settingsFamily, create, roles] of [
    ["cardDualMRR", "dualMrrAnimation", createCardDualMRRState, ["main", "effect", "flash", "typeIcon", "transition", "typeEffect"]],
    ["cardDualMSR", "dualMsrAnimation", createCardDualMSRState, ["shadowbox", "transition", "frame", "typeIcon", "effect"]],
  ]) {
    if (!recipe.rendererProperties?.[family]) continue;
    const { binding, config } = configFor(ctx, recipe, family, roles);
    const settings = ctx.runtimeSettings?.[settingsFamily]?.[config.animationSettingsIdentity];
    data[`${family}State`] = cacheState(ctx, family, binding.componentIdentity, () => create(config, settings));
    data[`${family}Role`] = binding.role;
    const source = family === "cardDualMRR" ? CARD_DUAL_MRR_PRODUCER_SCHEMA : CARD_DUAL_MSR_PRODUCER_SCHEMA;
    const values = (family === "cardDualMRR" ? cardDualMRRUniforms : cardDualMSRUniforms)(data[`${family}State`], binding.role);
    for (const [name, value] of Object.entries(values)) {
      const uniform = material.uniforms[name];
      if (!uniform) continue;
      const dualOverridesMSR = family === "cardDualMSR" && specs[name]?.source === CARD_MSR_PRODUCER_SCHEMA
        && !recipe.rendererProperties.cardMSR;
      if (specs[name] && !dualOverridesMSR && ![source, CARD_MRR_PRODUCER_SCHEMA, CARD_MRR_MATERIAL_OVERRIDE_PRODUCER_SCHEMA].includes(specs[name].source)) {
        throw new Error(`Conflicting dual card producer for ${name}`);
      }
      const type = specs[name]?.type ?? (uniform.value?.isVector2 ? "vec2" : uniform.value?.isVector3 ? "vec3"
        : uniform.value?.isVector4 ? "vec4" : typeof value === "number" ? name === "_IsLeft" ? "int" : "float" : null);
      if (!type) throw new Error(`Invalid dual card uniform shape ${name}`);
      specs[name] = { type, source };
    }
  }
  const rgbNames = Object.keys(specs).filter((name) => specs[name].source === CARD_RGB_PRODUCER_SCHEMA);
  if (rgbNames.length) {
    configFor(ctx, recipe, "cardRGB");
    const values = computeCardRgbUniforms({ colors: recipe.colors,
      defaults: manifest.official_shader_property_defaults?.colors, uniforms: rgbNames });
    for (const [name, value] of Object.entries(values)) setValue(material.uniforms[name], value, name);
    data.cardRGBValues = values;
  }
  for (const spec of Object.values(specs)) {
    const state = { [CARD_UV_SHADOW_PRODUCER_SCHEMA]: data.cardUVShadowState,
      [CARD_RELIEF_PRODUCER_SCHEMA]: data.cardMReliefSRState,
      [CARD_DUAL_MRR_PRODUCER_SCHEMA]: data.cardDualMRRState,
      [CARD_DUAL_MSR_PRODUCER_SCHEMA]: data.cardDualMSRState,
      [CARD_RGB_PRODUCER_SCHEMA]: data.cardRGBValues };
    if (SOURCES.has(spec.source) && !state[spec.source]) throw new Error(`Missing card producer binding ${spec.source}`);
  }
  data.dynamicPortUniforms = Object.keys(specs);
  if (Object.values(specs).some((spec) => SOURCES.has(spec.source)) || data.cardDualMRRState || data.cardDualMSRState) {
    data.cardProducerEvidenceScope = "reference-only";
  }
}

export function createExtendedCardFrame(threeQuaternion, globalTime, deltaTime, worldQuaternion) {
  return { threeQuaternion, globalTime, deltaTime, worldQuaternion, states: new Map() };
}

const noExtendedUniform = () => false;
export function extendedCardUniforms(material, frame) {
  const data = material.userData;
  if (!data.cardDualMRRState && !data.cardDualMSRState && !data.cardUVShadowState
      && !data.cardMReliefSRState && !data.cardRGBValues) return noExtendedUniform;
  const once = (state, update, input) => {
    if (!frame.states.has(state)) frame.states.set(state, update(state, input));
    return frame.states.get(state);
  };
  const outputs = new Map();
  if (data.cardDualMRRState) {
    const state = once(data.cardDualMRRState, updateCardDualMRR, frame);
    const values = cardDualMRRUniforms(state, data.cardDualMRRRole);
    for (const source of [CARD_DUAL_MRR_PRODUCER_SCHEMA, CARD_MRR_PRODUCER_SCHEMA, CARD_MRR_MATERIAL_OVERRIDE_PRODUCER_SCHEMA]) outputs.set(source, values);
  }
  if (data.cardDualMSRState) {
    const state = once(data.cardDualMSRState, updateCardDualMSR, frame);
    const values = cardDualMSRUniforms(state, data.cardDualMSRRole);
    for (const source of [CARD_DUAL_MSR_PRODUCER_SCHEMA, CARD_MRR_PRODUCER_SCHEMA, CARD_MRR_MATERIAL_OVERRIDE_PRODUCER_SCHEMA]) outputs.set(source, values);
  }
  const worldFrame = { ...frame, threeQuaternion: frame.worldQuaternion };
  if ((data.cardUVShadowState || data.cardMReliefSRState) && !frame.worldQuaternion) {
    throw new Error("Shadow card producer requires an explicit world quaternion");
  }
  let reliefValues;
  if (data.cardMReliefSRState) {
    reliefValues = once(data.cardMReliefSRState, updateCardRelief, worldFrame);
    outputs.set(CARD_RELIEF_PRODUCER_SCHEMA, reliefValues);
  }
  if (data.cardUVShadowState) {
    const shadow = once(data.cardUVShadowState, (state) => updateUvShadow(state, frame.worldQuaternion));
    if (reliefValues && data.cardMReliefSRRole === "shadow"
        && shadow.some((value, index) => value !== reliefValues._ShadowUVTranslate[index])) {
      throw new Error("Overlapping shadow card producers disagree");
    }
    outputs.set(CARD_UV_SHADOW_PRODUCER_SCHEMA, { _ShadowUVTranslate: shadow });
  }
  if (data.cardRGBValues) outputs.set(CARD_RGB_PRODUCER_SCHEMA, data.cardRGBValues);
  return (name, source) => {
    const values = outputs.get(source);
    if (!values) return false;
    if (!Object.hasOwn(values, name)) throw new Error(`Unsupported card producer output ${name}`);
    setValue(material.uniforms[name], values[name], name);
    return true;
  };
}
