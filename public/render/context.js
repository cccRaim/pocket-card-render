// RenderContext + shared render-state helpers.
//
// The RenderContext bundles the runtime dependencies a material strategy needs (resolved textures,
// the env cubemap, the per-frame animation lists) so strategies are pure modules — they never reach
// into app.js's closure. app.js builds ONE ctx after the textures/cubemap load and passes it to every
// strategy's requires()/build().

import * as THREE from "three";
import {
  resolveStencilRegionFloats,
  STENCIL_BUFFER_VALUES,
  STENCIL_REGION_BITS,
} from "./stencil-region.js";
import { SHADER_TEXTURE_DEFAULTS } from "./shader-defaults.js";
import {
  officialPortIdentityKey,
  orderOfficialPasses,
} from "./official-port-identity.js";
import { unityTexEnvToThreeGltfSt } from "./texture-transform.js";

// Unity blend-factor enum → three.js factor (card_shader_state.json uses these indices).
export const BF = {
  0: THREE.ZeroFactor, 1: THREE.OneFactor, 2: THREE.DstColorFactor, 3: THREE.SrcColorFactor,
  4: THREE.OneMinusDstColorFactor, 5: THREE.SrcAlphaFactor, 6: THREE.OneMinusSrcColorFactor,
  7: THREE.DstAlphaFactor, 8: THREE.OneMinusDstAlphaFactor, 9: THREE.SrcAlphaSaturateFactor,
  10: THREE.OneMinusSrcAlphaFactor,
};
export const ZF = {
  1: THREE.NeverDepth, 2: THREE.LessDepth, 3: THREE.EqualDepth, 4: THREE.LessEqualDepth,
  5: THREE.GreaterDepth, 6: THREE.NotEqualDepth, 7: THREE.GreaterEqualDepth, 8: THREE.AlwaysDepth,
};
const BLEND_EQUATION = {
  0: THREE.AddEquation,
  1: THREE.SubtractEquation,
  2: THREE.ReverseSubtractEquation,
  3: THREE.MinEquation,
  4: THREE.MaxEquation,
};
const STENCIL_FUNC = {
  1: THREE.NeverStencilFunc, 2: THREE.LessStencilFunc, 3: THREE.EqualStencilFunc,
  4: THREE.LessEqualStencilFunc, 5: THREE.GreaterStencilFunc, 6: THREE.NotEqualStencilFunc,
  7: THREE.GreaterEqualStencilFunc, 8: THREE.AlwaysStencilFunc,
};
const STENCIL_OP = {
  0: THREE.KeepStencilOp, 1: THREE.ZeroStencilOp, 2: THREE.ReplaceStencilOp,
  3: THREE.IncrementStencilOp, 4: THREE.DecrementStencilOp, 5: THREE.InvertStencilOp,
  6: THREE.IncrementWrapStencilOp, 7: THREE.DecrementWrapStencilOp,
};
// After the exported GLB/Three handedness adaptation, Unity Cull Front retains back faces and Cull Back
// retains front faces. three.js names the surviving side rather than the culled side.
export const SIDE = { 0: THREE.DoubleSide, 1: THREE.BackSide, 2: THREE.FrontSide };

// Stencil bits: outer card = bit 1, inner window = card|window bits (3). Official shaders use
// read masks 1 or 2, so window pixels must keep the card bit while also carrying the window bit.
export const REGION = STENCIL_BUFFER_VALUES;

function normalizedShaderFloatDefaults(manifest) {
  const raw = manifest?.official_shader_property_defaults?.floats;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`${manifest?.shader || "exact shader"}: official Shader float defaults are missing`);
  }
  return Object.fromEntries(Object.entries(raw).map(([name, value]) => {
    const numeric = Number(value);
    if (!name || !Number.isFinite(numeric)) {
      throw new Error(`${manifest?.shader || "exact shader"}: invalid Shader default ${name || "<empty>"}`);
    }
    return [name, numeric];
  }));
}

function scalarMapSignature(value) {
  return JSON.stringify(Object.entries(value || {})
    .map(([name, scalar]) => [name, Number(scalar)])
    .sort(([a], [b]) => a.localeCompare(b)));
}

// ShaderLab pass parameters name Material properties such as _ZTest/_ZWrite. The serialized pass
// blob also carries a fallback `val`, but Unity resolves a missing Material override through the
// Shader property's default first. Keep that precedence in one selector-port boundary so every
// generated manifest receives the same fail-closed behavior.
export function bindOfficialPassDefaults(manifest) {
  const pass = manifest?.official_pass_runtime;
  if (!pass) return manifest;
  const defaults = normalizedShaderFloatDefaults(manifest);
  if (pass.shader_property_defaults
      && scalarMapSignature(pass.shader_property_defaults) !== scalarMapSignature(defaults)) {
    throw new Error(`${manifest.shader}: pass defaults disagree with official Shader defaults`);
  }
  return {
    ...manifest,
    official_pass_runtime: {
      ...pass,
      shader_property_defaults: defaults,
    },
  };
}

export function selectExactShaderPorts(exactShaders, recipe, key) {
  const dispatchedPorts = recipe?.runtimeDispatch?.officialPorts;
  if (Array.isArray(dispatchedPorts) && dispatchedPorts.length > 0) {
    if (key !== undefined && key !== recipe.runtimeDispatch.shaderKey) return [];
    const matches = dispatchedPorts.map((identity) => {
      const identityKey = officialPortIdentityKey(identity);
      const source = identityKey ? exactShaders?.sourcesByPortIdentity?.[identityKey] : null;
      if (!source?.vert || !source?.frag || !source?.manifest) return null;
      try {
        return { ...source, manifest: bindOfficialPassDefaults(source.manifest) };
      } catch {
        return null;
      }
    });
    if (matches.some((match) => !match)) return [];
    if (matches.length === 1) return matches;
    try {
      return orderOfficialPasses(matches, (match) => match.manifest?.official_selector);
    } catch {
      return [];
    }
  }
  const port = exactShaders?.[key];
  const official = recipe?.official;
  if (!port || typeof official?.shader !== "string" || !Array.isArray(official.validKeywords)
      || official.validKeywords.some((value) => typeof value !== "string")) return [];
  const manifests = Array.isArray(port.manifests)
    ? port.manifests
    : port.manifest ? [port.manifest] : [];
  const actualKeywords = [...official.validKeywords].sort();
  const matches = [];
  for (const manifest of manifests) {
    const selector = manifest?.official_selector;
    const officialShaderName = selector?.shaderName;
    const declaredKey = manifest?.runtime_contract?.shader_key
      || (typeof officialShaderName === "string" ? officialShaderName.split("/").at(-1) : null);
    if (!selector || declaredKey !== key
        || (manifest.shader !== key && manifest.shader !== officialShaderName)
        || typeof selector.shaderIdentity !== "string" || !Array.isArray(selector.keywords)
        || selector.keywords.some((value) => typeof value !== "string")) continue;
    const expectedKeywords = [...selector.keywords].sort();
    if (official.shader === selector.shaderIdentity
        && JSON.stringify(actualKeywords) === JSON.stringify(expectedKeywords)) {
      const identityKey = officialPortIdentityKey(selector);
      const selectorSources = identityKey ? port.sourcesByPort?.[identityKey] : null;
      const singleManifestFallback = manifests.length === 1 && port.vert && port.frag
        ? { vert: port.vert, frag: port.frag }
        : null;
      const sources = selectorSources || singleManifestFallback;
      if (!sources?.vert || !sources?.frag) return [];
      try {
        matches.push({ ...port, ...sources, manifest: bindOfficialPassDefaults(manifest) });
      } catch {
        return [];
      }
    }
  }
  if (matches.length === 0) return [];
  if (matches.length === 1) {
    return matches[0].manifest?.official_selector?.selectionMode === "ordered-multipass-structure"
      ? []
      : matches;
  }
  try {
    return orderOfficialPasses(matches, (match) => match.manifest?.official_selector);
  } catch {
    return [];
  }
}

export function selectExactShaderPort(exactShaders, recipe, key) {
  const matches = selectExactShaderPorts(exactShaders, recipe, key);
  return matches.length === 1 ? matches[0] : null;
}

export function selectCompatibleStageSource(exactShaders, key) {
  const resolvedKey = typeof key === "string" ? key : key?.runtimeDispatch?.shaderKey;
  const source = exactShaders?.[resolvedKey];
  return source?.stageSourceOnly === true && source.vert && source.frag ? source : null;
}

/**
 * Build the RenderContext.
 * @param {Map<string,{tex:THREE.Texture, straight:boolean}>} texInfo  name → loaded texture + alpha mode
 * @param {THREE.CubeTexture|null} envCubeTex   the env cubemap (L_001_ENV) for holo/metal reflections
 * @param {THREE.Material[]} animMats        materials wanting a per-frame uTime
 * @param {THREE.Material[]} exactGlitMats   selector-bound glitter materials driven by FlowParams state
 * @param {THREE.Material[]} kiraPuyoMats    Card_Scaling_Kira materials driven by renderer MPBs
 * @param {Map<string, object>} circularKiraComponents Card_Circular_* component states
 * @param {THREE.Material[]} megaDynamicMats Mega RR materials with inferred runtime intensity inputs
 * @param {THREE.Texture|null} dynUITex       DynamicUIType.Text texture (Unity layer 17 / CardUIText)
 * @param {THREE.Texture|null} dynHoloTex     DynamicUIType.Holo texture (Unity layer 18 / CardUIMetallic)
 * @param {THREE.Texture|null} foilTex        alpha mask for UI foil-only regions
 * @param {THREE.Material[]} exHoloMats       EX/UI holo materials whose DynamicUI textures can be swapped
 */
export function makeRenderContext({ texInfo, envCubeTex, exactShaders = {}, animMats, exactGlitMats, kiraPuyoMats, circularKiraComponents, megaDynamicMats = [], runtimeSettings = {}, dynUITex, dynHoloTex, foilTex, exHoloMats }) {
  // Native producer components own their state independently of Material
  // instances. Keying these stores by producer schema + official component
  // identity preserves that ownership when one renderer has multiple slots or
  // several materials consume the same MaterialPropertyBlock payload.
  const runtimeComponentStates = new Map();
  const runtimeComponentTextures = new Map();
  const makeDefaultTex = (rgba, backendTextureDefault) => {
    const t = new THREE.DataTexture(new Uint8Array(rgba), 1, 1, THREE.RGBAFormat);
    t.colorSpace = THREE.NoColorSpace;
    t.userData.backendTextureDefault = backendTextureDefault;
    t.needsUpdate = true;
    return t;
  };
  const defaultTex = {
    white: makeDefaultTex([255, 255, 255, 255], "shaderlab-white"),
    // ShaderLab's "black" default is the no-op texture for premultiplied card layers.
    black: makeDefaultTex([0, 0, 0, 0], "shaderlab-black"),
    gray: makeDefaultTex([128, 128, 128, 255], "shaderlab-gray"),
    clear: makeDefaultTex([0, 0, 0, 0], "shaderlab-clear"),
    bump: makeDefaultTex([128, 128, 255, 255], "shaderlab-bump"),
  };
  const makeDefaultCube = (rgba, backendTextureDefault, name) => {
    const texture = new THREE.CubeTexture(
      Array.from({ length: 6 }, () => makeDefaultTex(rgba, backendTextureDefault))
    );
    texture.name = name;
    texture.userData.backendTextureDefault = backendTextureDefault;
    texture.colorSpace = THREE.NoColorSpace;
    texture.needsUpdate = true;
    return texture;
  };
  const defaultCube = {
    "neutral-gray-cube": makeDefaultCube(
      [128, 128, 128, 255],
      "neutral-gray-cube",
      "PCR neutral gray cube",
    ),
    "shaderlab-black": makeDefaultCube([0, 0, 0, 0], "shaderlab-black", "PCR ShaderLab black cube"),
    "shaderlab-white": makeDefaultCube([255, 255, 255, 255], "shaderlab-white", "PCR ShaderLab white cube"),
  };
  const layerTex = (L, slot) => {
    const n = L.textures?.[slot]?.name;
    return n && texInfo.has(n) ? texInfo.get(n).tex : null;
  };
  const rawTexCache = new Map();
  const layerTexNoColorSpace = (L, slot) => {
    const n = L.textures?.[slot]?.name;
    if (!n || !texInfo.has(n)) return null;
    const src = texInfo.get(n).tex;
    if (src.colorSpace === THREE.NoColorSpace) return src;
    const key = `${n}:${slot}:raw`;
    if (!rawTexCache.has(key)) {
      const c = src.clone();
      c.colorSpace = THREE.NoColorSpace;
      c.needsUpdate = true;
      rawTexCache.set(key, c);
    }
    return rawTexCache.get(key);
  };
  const layerTexDefault = (L, slot) => {
    const t = layerTex(L, slot);
    if (t) return t;
    const def = SHADER_TEXTURE_DEFAULTS[L.runtimeDispatch?.shaderKey]?.[slot];
    return def ? defaultTex[def] : null;
  };
  // Legacy helper name retained for material strategies. Sampler wrap is texture-object data, so a slot
  // must not override the official per-texture state recovered by app.js.
  const layerTexRepeat = (L, slot) => {
    return layerTex(L, slot);
  };
  const layerTexDefaultRepeat = (L, slot) => layerTexRepeat(L, slot) || layerTexDefault(L, slot);
  // Unity's empty Cubemap property default is a built-in gray cube. A material without an explicit
  // _CubeMap must not inherit another material's environment map merely because the scene loaded one.
  const layerCubeDefault = (L, slot = "_CubeMap", backendTextureDefault = "neutral-gray-cube") => {
    if (L.textures?.[slot] && envCubeTex) return envCubeTex;
    const texture = defaultCube[backendTextureDefault];
    if (!texture) throw new Error(`${L.shader}: unsupported cube default ${backendTextureDefault}`);
    return texture;
  };
  const texStraight = (name) => !!(name && texInfo.has(name) && texInfo.get(name).straight);
  const exactShaderPort = (recipe, key) => selectExactShaderPort(exactShaders, recipe, key);
  const exactShaderPorts = (recipe, key) => selectExactShaderPorts(exactShaders, recipe, key);
  const compatibleStageSource = (recipe) => selectCompatibleStageSource(exactShaders, recipe);
  const exactPortUniforms = (recipe, port, resolveSampler) => {
    const manifest = port?.manifest;
    const contract = manifest?.runtime_contract;
    const defaults = manifest?.official_shader_property_defaults;
    if (!contract || !defaults || !Array.isArray(manifest.sampler_bindings)) {
      throw new Error(`${manifest?.shader || "exact shader"}: incomplete selector port manifest`);
    }
    const uniforms = {};
    const defaultSampler = (binding) => {
      const descriptor = defaults.textureDescriptors?.[binding.slot];
      const dimension = Number(binding.dimension ?? descriptor?.dimension);
      if (descriptor && Number(descriptor.dimension) !== dimension) {
        throw new Error(`${manifest.shader}: sampler ${binding.slot} dimension disagrees with Shader property`);
      }
      const backendDefault = contract.backend_texture_defaults?.[binding.slot];
      if (backendDefault) {
        const texture = dimension === 4
          ? defaultCube[backendDefault]
          : defaultTex[backendDefault];
        if (!texture) {
          throw new Error(`${manifest.shader}: unsupported backend texture default ${backendDefault}`);
        }
        return texture;
      }
      const shaderDefault = descriptor?.defaultName;
      // Unity resolves an empty/invalid 2D ShaderLab texture default to its built-in gray texture.
      // Non-2D defaults remain explicit backend policy because their submitted descriptor is not
      // proven by serialized Shader property bytes alone.
      if (shaderDefault === "" && dimension === 2) return defaultTex.gray;
      if (!shaderDefault) return null;
      const texture = dimension === 4
        ? defaultCube[`shaderlab-${shaderDefault}`]
        : defaultTex[shaderDefault];
      if (!texture) {
        throw new Error(`${manifest.shader}: unsupported Shader texture default ${shaderDefault}`);
      }
      return texture;
    };
    for (const binding of manifest.sampler_bindings) {
      const value = resolveSampler(binding) || defaultSampler(binding);
      const dynamicSampler = contract.dynamic_uniforms?.[binding.spirvName];
      if (!value && !["sampler2D", "samplerCube"].includes(dynamicSampler?.type)) {
        throw new Error(`${manifest.shader}: sampler ${binding.slot} is unresolved`);
      }
      uniforms[binding.spirvName] = { value };
    }
    const floats = recipe?.floats || {};
    const colors = recipe?.colors || {};
    const scalar = (name) => {
      const value = Number(floats[name] ?? defaults.floats?.[name]);
      if (!Number.isFinite(value)) throw new Error(`${manifest.shader}: scalar ${name} is unresolved`);
      return value;
    };
    for (const name of contract.material_uniforms?.floats || []) uniforms[name] = { value: scalar(name) };
    for (const name of contract.material_uniforms?.ints || []) uniforms[name] = { value: Math.trunc(scalar(name)) };
    for (const [name, type] of Object.entries(contract.material_uniforms?.vectors || {})) {
      const value = colors[name];
      const fallback = defaults.colors?.[name] || defaults.vectors?.[name];
      const source = value ? [value.r, value.g, value.b, value.a ?? 1] : fallback;
      if (!Array.isArray(source)) throw new Error(`${manifest.shader}: vector ${name} is unresolved`);
      const vector = type === "vec2"
        ? new THREE.Vector2(source[0], source[1])
        : type === "vec3"
          ? new THREE.Vector3(source[0], source[1], source[2])
          : type === "vec4"
            ? new THREE.Vector4(source[0], source[1], source[2], source[3])
            : null;
      if (!vector) throw new Error(`${manifest.shader}: unsupported vector type ${type}`);
      uniforms[name] = { value: vector };
    }
    for (const transform of contract.texture_coordinates?.vertex?.transforms || []) {
      if (transform.conversion !== "unity-texenv-to-three-gltf-v") {
        throw new Error(`${manifest.shader}: unsupported texture-coordinate conversion ${transform.conversion}`);
      }
      const value = unityTexEnvToThreeGltfSt(
        recipe?.textures?.[transform.slot],
        defaults.textureDescriptors?.[transform.slot],
      );
      uniforms[transform.uniform] = { value: new THREE.Vector4(...value) };
    }
    for (const [name, spec] of Object.entries(contract.backend_uniforms || {})) {
      const value = spec.type === "vec2"
        ? new THREE.Vector2(...spec.value)
        : spec.type === "vec3"
          ? new THREE.Vector3(...spec.value)
          : spec.type === "vec4"
            ? new THREE.Vector4(...spec.value)
            : spec.value;
      uniforms[name] = { value };
    }
    return uniforms;
  };
  return { THREE, layerTex, layerTexNoColorSpace, layerTexDefault, layerTexRepeat, layerTexDefaultRepeat, layerCubeDefault, texStraight, envCubeTex, exactShaders, exactShaderPort, exactShaderPorts, compatibleStageSource, exactPortUniforms, animMats, exactGlitMats, kiraPuyoMats, circularKiraComponents, dynamicPortMats: megaDynamicMats, megaDynamicMats, runtimeSettings, runtimeComponentStates, runtimeComponentTextures, dynUITex, dynHoloTex, foilTex, exHoloMats };
}

// ── render state applied to a built material by the dispatcher ──

// Blend and depth are material/pass state; official opaque/transparent pass membership is applied
// separately from the effective Unity render queue by applyRenderQueueState().
export function setBlend(mat, mode, _straight, floats) {
  mat.transparent = false; mat.depthTest = false; mat.depthWrite = false;
  if (floats && floats._SrcFactor != null && floats._DstFactor != null) {
    mat.blending = THREE.CustomBlending; mat.blendEquation = THREE.AddEquation;
    // Blend factors are material/pass state. Texture-storage heuristics cannot rewrite them: the exact
    // fragment program decides whether its output is straight or premultiplied before this stage.
    mat.blendSrc = BF[floats._SrcFactor]; mat.blendDst = BF[floats._DstFactor];
    mat.blendSrcAlpha = BF[floats._SrcFactorA ?? floats._SrcFactor];
    mat.blendDstAlpha = BF[floats._DstFactorA ?? floats._DstFactor];
    return;
  }
  if (mode === "opaque") {
    // Unity alpha-test shaders are still queued with the transparent card stack here, but after clip/discard
    // they write their source colour opaquely. NormalBlending would let feathered AM alpha mix with the UR
    // foil background and wash out the ShadowBox on tilt.
    mat.blending = THREE.CustomBlending; mat.blendEquation = THREE.AddEquation;
    mat.blendSrc = THREE.OneFactor; mat.blendDst = THREE.ZeroFactor;
    mat.blendSrcAlpha = THREE.ZeroFactor; mat.blendDstAlpha = THREE.ZeroFactor;
    return;
  }
  mat.blending = THREE.CustomBlending; mat.blendEquation = THREE.AddEquation;
  let src, dst;
  if (mode === "multiply") [src, dst] = [2, 0];
  else if (mode === "add_a") [src, dst] = [5, 1];
  else if (mode === "over") [src, dst] = [5, 10];
  else [src, dst] = [1, 10];                  // premult → One / OneMinusSrcAlpha
  mat.blendSrc = BF[src]; mat.blendDst = BF[dst];
  mat.blendSrcAlpha = BF[0];
  mat.blendDstAlpha = BF[mode === "add_a" || mode === "multiply" ? 1 : 10];
}

// Official RenderQueueRange bytes: opaque=[0,2500], transparent=[2501,5000]. The flag is used only
// to route a draw into three.js's two render lists; blending remains whatever setBlend configured.
export function applyRenderQueueState(mat, queue) {
  if (!Number.isFinite(queue) || queue < 0 || queue > 5000) return false;
  mat.transparent = queue >= 2501;
  return true;
}

export function applyDepthState(mat, floats) {
  if (!floats) return false;
  const zTest = floats._ZTest ?? floats._ZTestParam;
  const zWrite = floats._ZWrite ?? floats._ZWriteParam;
  let applied = false;
  if (zTest != null) {
    mat.depthTest = zTest !== 0;
    if (zTest !== 0 && ZF[zTest]) mat.depthFunc = ZF[zTest];
    applied = true;
  }
  if (zWrite != null) {
    mat.depthWrite = zWrite !== 0;
    applied = true;
  }
  return applied;
}

export function applyCullState(mat, floats, fallbackCull = 2, materialCull = false) {
  const cull = materialCull ? (floats?._CullMode ?? fallbackCull) : fallbackCull;
  if (cull == null || !Object.prototype.hasOwnProperty.call(SIDE, cull)) return false;
  mat.side = SIDE[cull];
  // Unity Cull Off disables face culling for one draw. three.js otherwise renders transparent
  // DoubleSide materials twice (back faces, then front faces), which doubles additive card effects.
  mat.forceSinglePass = cull === 0;
  return true;
}

function officialStateValue(parameter, floats, defaults = {}) {
  if (!parameter || !Number.isFinite(Number(parameter.val))) return null;
  const materialValue = parameter.name ? (floats?.[parameter.name] ?? defaults?.[parameter.name]) : undefined;
  const value = materialValue ?? parameter.val;
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

// Apply a selector-bound ShaderLab pass contract. This is used only when the
// exact program manifest came from the same official Shader identity/keywords.
export function applyOfficialPassState(mat, recipe, contract, { stencil = true } = {}) {
  const resolvedStencilRegion = resolveStencilRegionFloats(recipe, contract);
  const floats = resolvedStencilRegion.floats;
  const defaults = contract?.shader_property_defaults || {};
  const blend = contract?.blend;
  if (!contract?.shared_mrt_blend || !blend) return false;
  const srcRgb = officialStateValue(blend.src_rgb, floats, defaults);
  const dstRgb = officialStateValue(blend.dst_rgb, floats, defaults);
  const srcAlpha = officialStateValue(blend.src_alpha, floats, defaults);
  const dstAlpha = officialStateValue(blend.dst_alpha, floats, defaults);
  const opRgb = officialStateValue(blend.op_rgb, floats, defaults);
  const opAlpha = officialStateValue(blend.op_alpha, floats, defaults);
  const colorMask = officialStateValue(blend.color_mask, floats, defaults);
  if (![srcRgb, dstRgb, srcAlpha, dstAlpha].every((value) => BF[value] != null)
      || BLEND_EQUATION[opRgb] == null || BLEND_EQUATION[opAlpha] == null
      || ![0, 15].includes(colorMask)) return false;
  mat.blending = THREE.CustomBlending;
  mat.blendSrc = BF[srcRgb]; mat.blendDst = BF[dstRgb];
  mat.blendSrcAlpha = BF[srcAlpha]; mat.blendDstAlpha = BF[dstAlpha];
  mat.blendEquation = BLEND_EQUATION[opRgb]; mat.blendEquationAlpha = BLEND_EQUATION[opAlpha];
  mat.colorWrite = colorMask === 15;

  const offsetFactor = officialStateValue(contract.fixed?.offsetFactor, floats, defaults);
  const offsetUnits = officialStateValue(contract.fixed?.offsetUnits, floats, defaults);
  const alphaToMask = officialStateValue(contract.fixed?.alphaToMask, floats, defaults);
  const conservative = officialStateValue(contract.fixed?.conservative, floats, defaults);
  const zClip = officialStateValue(contract.fixed?.zClip, floats, defaults);
  if (offsetFactor !== 0 || offsetUnits !== 0 || alphaToMask !== 0 || conservative !== 0 || zClip !== 1) {
    return false;
  }
  mat.polygonOffset = false;
  mat.polygonOffsetFactor = 0;
  mat.polygonOffsetUnits = 0;
  mat.alphaToCoverage = false;

  const zTest = officialStateValue(contract.depth?.test, floats, defaults);
  const zWrite = officialStateValue(contract.depth?.write, floats, defaults);
  if (zTest == null || zWrite == null || (zTest !== 0 && ZF[zTest] == null)) return false;
  mat.depthTest = zTest !== 0;
  if (mat.depthTest) mat.depthFunc = ZF[zTest];
  mat.depthWrite = zWrite !== 0;

  const cull = officialStateValue(contract.culling, floats, defaults);
  if (SIDE[cull] == null) return false;
  mat.side = SIDE[cull];
  mat.forceSinglePass = cull === 0;

  const stencilContract = contract.stencil;
  const stencilFunc = officialStateValue(stencilContract?.generic?.comp, floats, defaults);
  if (stencil) {
    const ref = officialStateValue(stencilContract.ref, floats, defaults);
    const readMask = officialStateValue(stencilContract.read_mask, floats, defaults);
    const writeMask = officialStateValue(stencilContract.write_mask, floats, defaults);
    const fail = officialStateValue(stencilContract.generic.fail, floats, defaults);
    const zFail = officialStateValue(stencilContract.generic.zFail, floats, defaults);
    const pass = officialStateValue(stencilContract.generic.pass, floats, defaults);
    if ([ref, readMask, writeMask].some((value) => value == null)
        || STENCIL_FUNC[stencilFunc] == null
        || [fail, zFail, pass].some((value) => STENCIL_OP[value] == null)) return false;
    const affectsStencil = stencilFunc !== 8
      || [fail, zFail, pass].some((value) => value !== 0);
    mat.stencilWrite = affectsStencil;
    if (affectsStencil) {
      mat.stencilRef = ref;
      mat.stencilFuncMask = readMask;
      mat.stencilWriteMask = writeMask;
      mat.stencilFunc = STENCIL_FUNC[stencilFunc];
      mat.stencilFail = STENCIL_OP[fail];
      mat.stencilZFail = STENCIL_OP[zFail];
      mat.stencilZPass = STENCIL_OP[pass];
    }
  } else {
    mat.stencilWrite = false;
  }
  mat.userData.officialPassStateSha256 = contract.source_sha256;
  if (resolvedStencilRegion.binding) {
    mat.userData.stencilRegionBinding = resolvedStencilRegion.binding;
  }
  return true;
}

export function applyStencilState(mat, recipe) {
  const resolvedStencilRegion = resolveStencilRegionFloats(recipe);
  const f = resolvedStencilRegion.floats;
  const mode = recipe?.runtimeDispatch?.capabilities?.stencil || "none";
  const read = mode === "shadowbox" || mode === "read-stencil"
    ? f._Stencil
    : mode === "read-stencil-ref" ? f._StencilRef : null;
  if (read == null) return false;

  mat.stencilWrite = true;
  mat.stencilFunc = THREE.EqualStencilFunc;
  mat.stencilFuncMask = read;
  mat.stencilFail = mat.stencilZFail = THREE.KeepStencilOp;

  if (mode === "shadowbox") {
    mat.stencilRef = 7;
    mat.stencilWriteMask = 4;
    mat.stencilZPass = THREE.ReplaceStencilOp;
  } else {
    mat.stencilRef = read;
    mat.stencilWriteMask = 0xff;
    mat.stencilZPass = THREE.KeepStencilOp;
  }
  if (resolvedStencilRegion.binding) {
    mat.userData.stencilRegionBinding = resolvedStencilRegion.binding;
  }
  return true;
}

// stencil writer (stamps a region id) + clip (tests a region) — the card-shape / window clipping.
export function stencilWriter(regionId) {
  const m = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, depthTest: false, side: THREE.DoubleSide });
  m.stencilWrite = true; m.stencilRef = regionId; m.stencilFunc = THREE.AlwaysStencilFunc;
  m.stencilZPass = m.stencilFail = m.stencilZFail = THREE.ReplaceStencilOp; m.stencilWriteMask = 0xff;
  return m;
}
export function applyClip(mat, clip) {
  if (!clip) return;
  const bit = STENCIL_REGION_BITS[clip];
  if (!bit) throw new Error(`Unsupported stencil clip region: ${clip}`);
  mat.stencilWrite = true;
  mat.stencilFail = mat.stencilZFail = mat.stencilZPass = THREE.KeepStencilOp;
  mat.stencilFunc = THREE.EqualStencilFunc;
  mat.stencilFuncMask = bit;
  mat.stencilRef = bit;
}
