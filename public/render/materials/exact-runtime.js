import * as THREE from "three";
import { bindExtendedCardRuntime } from "../card-extended-runtime.js";
import { bindDynamicUniformProducerContract } from "../dynamic-uniform-producer.js";
import {
  CARD_FUTURE_PRODUCER_SCHEMA,
  createCardFutureState,
} from "../card-future.js";
import {
  CARD_ANCIENT_PRODUCER_SCHEMA,
  createCardAncientState,
} from "../card-ancient.js";
import {
  CARD_MARBLE_PRODUCER_SCHEMA,
  createCardMarbleCurveSamples,
  createCardMarbleState,
} from "../card-marble.js";
import {
  CARD_MSR_PRODUCER_SCHEMA,
  createCardMSRState,
} from "../card-msr.js";
import {
  CARD_MRR_MATERIAL_OVERRIDE_PRODUCER_SCHEMA,
  CARD_MRR_PRODUCER_SCHEMA,
  createCardMRRState,
} from "../card-mrr.js";
import {
  CARD_BEHAVIOUR_ROTATION_PRODUCER_SCHEMA,
  resolveCardBehaviourHologramRotation,
} from "../card-behaviour-rotation.js";

function createCardMarbleCurveTexture(config) {
  const { size, values } = createCardMarbleCurveSamples(config);
  const texture = new THREE.DataTexture(
    values,
    size,
    size,
    THREE.RedFormat,
    THREE.FloatType,
  );
  texture.name = `${config.componentIdentity}:_DefaultNoiseRemapCurveTexture`;
  texture.colorSpace = THREE.NoColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.flipY = false;
  texture.needsUpdate = true;
  texture.userData.officialSource = CARD_MARBLE_PRODUCER_SCHEMA;
  texture.userData.backendAdaptation = "Unity R16 linear Texture2D -> WebGL R32F";
  return texture;
}

function componentCache(ctx, field) {
  if (ctx[field] === undefined) ctx[field] = new Map();
  if (!(ctx[field] instanceof Map)) {
    throw new TypeError(`RenderContext.${field} must be a Map`);
  }
  return ctx[field];
}

function getOrCreateComponentValue(ctx, field, key, create) {
  const cache = componentCache(ctx, field);
  if (!cache.has(key)) cache.set(key, create());
  return cache.get(key);
}

function parseDynamicUniformType(type) {
  const match = /^(float|int|vec2|vec3|vec4|sampler2D|samplerCube)(?:\[([1-9][0-9]*)\])?$/.exec(type);
  if (!match) throw new Error(`unsupported exact-port dynamic uniform type ${type}`);
  if (match[2] && match[1].startsWith("sampler")) {
    throw new Error(`unsupported exact-port dynamic uniform type ${type}`);
  }
  return {
    baseType: match[1],
    size: match[2] ? Number(match[2]) : 1,
  };
}

function dynamicUniformValue(type, value = 0) {
  const { baseType, size } = parseDynamicUniformType(type);
  if (baseType === "sampler2D" || baseType === "samplerCube") {
    return value?.isTexture ? value : null;
  }
  const numeric = Number(value) || 0;
  if (size > 1) {
    const components = baseType.startsWith("vec") ? Number(baseType.slice(3)) : 1;
    const output = baseType === "int"
      ? new Int32Array(size * components)
      : new Float32Array(size * components);
    output.fill(numeric);
    return output;
  }
  if (baseType === "float" || baseType === "int") return numeric;
  if (baseType === "vec2") return new THREE.Vector2();
  if (baseType === "vec3") return new THREE.Vector3();
  if (baseType === "vec4") return new THREE.Vector4();
  throw new Error(`unsupported exact-port dynamic uniform type ${type}`);
}

function cloneDynamicUniformValue(value) {
  if (ArrayBuffer.isView(value)) return value.slice();
  if (value?.clone) return value.clone();
  return value;
}

export function buildExactRuntimeMaterial(recipe, ctx, {
  side = THREE.FrontSide,
  straight = false,
} = {}) {
  const exact = ctx.exactShaderPort(recipe);
  if (!exact) return null;
  const properties = recipe.rendererProperties;
  const uiSlots = properties?.dynamicUISlots ?? Object.fromEntries(
    (properties?.dynamicUI ?? []).map(({ slot, uiType }) => [slot, uiType]),
  );
  const uiUniforms = {};
  const uniforms = ctx.exactPortUniforms(
    recipe,
    exact,
    ({ slot, dimension, spirvName }) => {
      if (Object.hasOwn(uiSlots, slot)) {
        const type = uiSlots[slot];
        const texture = type === 0 ? ctx.dynUITex : type === 1 ? ctx.dynHoloTex : null;
        if (!texture || Number(dimension) !== 2) throw new Error(`Missing DynamicUI texture for ${slot} (type ${type})`);
        uiUniforms[spirvName] = type;
        return texture;
      }
      if (Number(dimension) !== 4) return ctx.layerTex(recipe, slot);
      if (recipe.textures?.[slot] && ctx.envCubeTex) return ctx.envCubeTex;
      const manifest = exact.manifest;
      if (manifest.runtime_contract.backend_texture_defaults?.[slot]
          || manifest.official_shader_property_defaults?.textureDescriptors?.[slot]?.defaultName) {
        return null; // Let exactPortUniforms resolve the selected program's declared default.
      }
      return ctx.layerCubeDefault(recipe, slot);
    },
  );
  const dynamic = structuredClone(exact.manifest.runtime_contract.dynamic_uniforms || {});
  const dynamicDefaults = {};
  for (const [name, spec] of Object.entries(dynamic)) {
    const value = uniforms[name]?.value
      ?? recipe.floats?.[name]
      ?? 0;
    const uniformValue = dynamicUniformValue(spec.type, value);
    dynamicDefaults[name] = cloneDynamicUniformValue(uniformValue);
    uniforms[name] = { value: uniformValue };
  }
  const material = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms,
    vertexShader: exact.vert,
    fragmentShader: exact.frag,
    side,
    toneMapped: false,
  });
  material.userData.straight = straight;
  if (Object.keys(uiUniforms).length) material.userData.dynamicUISamplers = uiUniforms;
  material.userData.exactShader = recipe.runtimeDispatch.shaderKey;
  material.userData.officialPassRuntime = exact.manifest.official_pass_runtime;
  material.userData.officialSelector = exact.manifest.official_selector;
  material.userData.officialExecutableIdentity = exact.manifest.official_executable_identity;
  material.userData.dynamicPortUniforms = Object.keys(dynamic);
  material.userData.dynamicPortUniformSpecs = dynamic;
  material.userData.dynamicPortDefaults = dynamicDefaults;
  try {
    bindExtendedCardRuntime(material, recipe, ctx, exact.manifest);
  } catch (error) {
    material.dispose();
    throw error;
  }
  const futureBindings = Object.values(dynamic)
    .filter((spec) => spec.source === CARD_FUTURE_PRODUCER_SCHEMA);
  if (futureBindings.length) {
    const binding = recipe.rendererProperties?.cardFuture;
    const config = binding?.componentIdentity
      ? ctx.runtimeSettings?.cardFuture?.[binding.componentIdentity]
      : null;
    if (!config
        || typeof binding.rendererIdentity !== "string"
        || !config.rendererBindings?.includes(binding.rendererIdentity)) {
      material.dispose();
      throw new Error(
        `${recipe.runtimeDispatch.shaderKey}: CardFutureObject renderer binding is missing`,
      );
    }
    material.userData.cardFutureState = createCardFutureState(config);
    material.userData.cardFutureComponentIdentity = binding.componentIdentity;
  }
  const ancientBindings = Object.values(dynamic)
    .filter((spec) => spec.source === CARD_ANCIENT_PRODUCER_SCHEMA);
  if (ancientBindings.length) {
    const binding = recipe.rendererProperties?.cardAncient;
    const config = binding?.componentIdentity
      ? ctx.runtimeSettings?.cardAncient?.[binding.componentIdentity]
      : null;
    const curveSettings = config?.curveSettingsIdentity
      ? ctx.runtimeSettings?.ancientBGAnimation?.[config.curveSettingsIdentity]
      : null;
    if (!config
        || !curveSettings
        || typeof binding.rendererIdentity !== "string"
        || !config.rendererBindings?.includes(binding.rendererIdentity)) {
      material.dispose();
      throw new Error(
        `${recipe.runtimeDispatch.shaderKey}: CardAncientObject renderer binding is missing`,
      );
    }
    material.userData.cardAncientState = createCardAncientState(
      config,
      curveSettings,
    );
    material.userData.cardAncientComponentIdentity = binding.componentIdentity;
  }
  const marbleBindings = Object.values(dynamic)
    .filter((spec) => spec.source === CARD_MARBLE_PRODUCER_SCHEMA);
  if (marbleBindings.length) {
    const binding = recipe.rendererProperties?.cardMarble;
    const config = binding?.componentIdentity
      ? ctx.runtimeSettings?.cardMarble?.[binding.componentIdentity]
      : null;
    if (!config
        || typeof binding.rendererIdentity !== "string"
        || !config.rendererBindings?.includes(binding.rendererIdentity)) {
      material.dispose();
      throw new Error(
        `${recipe.runtimeDispatch.shaderKey}: CardMarbleLayer renderer binding is missing`,
      );
    }
    const componentKey = `${CARD_MARBLE_PRODUCER_SCHEMA}\u0000${binding.componentIdentity}`;
    material.userData.cardMarbleState = getOrCreateComponentValue(
      ctx,
      "runtimeComponentStates",
      componentKey,
      () => createCardMarbleState(config),
    );
    material.userData.cardMarbleComponentIdentity = binding.componentIdentity;
    material.userData.cardMarbleCurveTexture = getOrCreateComponentValue(
      ctx,
      "runtimeComponentTextures",
      `${componentKey}\u0000_DefaultNoiseRemapCurveTexture`,
      () => createCardMarbleCurveTexture(config),
    );
    for (const [name, spec] of Object.entries(dynamic)) {
      if (spec.source === CARD_MARBLE_PRODUCER_SCHEMA
          && spec.type === "sampler2D") {
        uniforms[name].value = material.userData.cardMarbleCurveTexture;
      }
    }
  }
  const msrBindings = Object.values(dynamic)
    .filter((spec) => spec.source === CARD_MSR_PRODUCER_SCHEMA);
  if (msrBindings.length) {
    const binding = recipe.rendererProperties?.cardMSR;
    const config = binding?.componentIdentity
      ? ctx.runtimeSettings?.cardMSR?.[binding.componentIdentity]
      : null;
    const animationSettings = config?.animationSettingsIdentity
      ? ctx.runtimeSettings?.msrAnimation?.[config.animationSettingsIdentity]
      : null;
    if (!config
        || !animationSettings
        || !["aura", "parallax", "shadowbox"].includes(binding?.role)
        || typeof binding.rendererIdentity !== "string"
        || !config.rendererBindings?.[binding.role]?.includes(
          binding.rendererIdentity,
        )) {
      material.dispose();
      throw new Error(
        `${recipe.runtimeDispatch.shaderKey}: CardMSRObject renderer binding is missing`,
      );
    }
    const componentKey =
      `${CARD_MSR_PRODUCER_SCHEMA}\u0000${binding.componentIdentity}`;
    material.userData.cardMSRState = getOrCreateComponentValue(
      ctx,
      "runtimeComponentStates",
      componentKey,
      () => createCardMSRState(config, animationSettings),
    );
    material.userData.cardMSRComponentIdentity = binding.componentIdentity;
    material.userData.cardMSRRole = binding.role;
    material.userData.cardMSRSearchTag = binding.searchTag;
  }
  const mrrBindings = Object.values(dynamic)
    .filter((spec) => [
      CARD_MRR_PRODUCER_SCHEMA,
      CARD_MRR_MATERIAL_OVERRIDE_PRODUCER_SCHEMA,
    ].includes(spec.source));
  if (mrrBindings.length && !material.userData.cardDualMRRState && !material.userData.cardDualMSRState) {
    const binding = recipe.rendererProperties?.cardMRR;
    const materialFallbackAllowed = mrrBindings.every(
      (spec) =>
        spec.source === CARD_MRR_MATERIAL_OVERRIDE_PRODUCER_SCHEMA,
    );
    if (!binding && materialFallbackAllowed) {
      material.userData.cardMRRStaticMaterial = true;
    } else {
      const config = binding?.componentIdentity
        ? ctx.runtimeSettings?.cardMRR?.[binding.componentIdentity]
        : null;
      const animationSettings = config?.animationSettingsIdentity
        ? ctx.runtimeSettings?.mrrAnimation?.[config.animationSettingsIdentity]
        : null;
      if (!config
          || !animationSettings
          || !["main", "effect", "flash"].includes(binding?.role)
          || typeof binding.rendererIdentity !== "string"
          || !config.rendererBindings?.[binding.role]?.includes(
            binding.rendererIdentity,
          )) {
        material.dispose();
        throw new Error(
          `${recipe.runtimeDispatch.shaderKey}: CardMRRObject renderer binding is missing`,
        );
      }
      const componentKey =
        `${CARD_MRR_PRODUCER_SCHEMA}\u0000${binding.componentIdentity}`;
      material.userData.cardMRRState = getOrCreateComponentValue(
        ctx,
        "runtimeComponentStates",
        componentKey,
        () => createCardMRRState(config, animationSettings),
      );
      material.userData.cardMRRComponentIdentity = binding.componentIdentity;
      material.userData.cardMRRRole = binding.role;
      material.userData.cardMRRSearchTag = binding.searchTag;
    }
  }
  const rotationBindings = Object.entries(dynamic)
    .filter(([, spec]) =>
      spec.source === CARD_BEHAVIOUR_ROTATION_PRODUCER_SCHEMA);
  for (const [name] of rotationBindings) {
    if (name !== "_Rotation") {
      material.dispose();
      throw new Error(
        `${recipe.runtimeDispatch.shaderKey}: unsupported CardDataGroup rotation output ${name}`,
      );
    }
  }
  if (rotationBindings.length) {
    material.userData.cardBehaviourHologramRotation =
      resolveCardBehaviourHologramRotation(
        ctx.runtimeSettings?.cardDataGroup?.hologramRotation,
      );
  }
  // Compatibility aliases for the existing runtime updater and audit artifacts.
  material.userData.megaDynamicUniforms = material.userData.dynamicPortUniforms;
  material.userData.megaDynamicUniformSpecs = material.userData.dynamicPortUniformSpecs;
  material.userData.megaDynamicDefaults = material.userData.dynamicPortDefaults;
  bindDynamicUniformProducerContract(material, {
    ...exact.manifest,
    runtime_contract: { ...exact.manifest.runtime_contract, dynamic_uniforms: dynamic },
  });
  if (material.userData.dynamicPortUniforms.length
      || material.userData.cardDualMRRState || material.userData.cardDualMSRState) {
    ctx.dynamicPortMats.push(material);
  }
  return material;
}
