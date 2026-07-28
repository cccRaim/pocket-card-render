import {
  CARD_FUTURE_PRODUCER_SCHEMA,
  updateCardFuture,
} from "./card-future.js";
import {
  CARD_ANCIENT_PRODUCER_SCHEMA,
  updateCardAncient,
} from "./card-ancient.js";
import {
  CARD_MARBLE_PRODUCER_SCHEMA,
  updateCardMarble,
} from "./card-marble.js";
import {
  CARD_MSR_PRODUCER_SCHEMA,
  updateCardMSR,
} from "./card-msr.js";
import {
  CARD_MRR_MATERIAL_OVERRIDE_PRODUCER_SCHEMA,
  CARD_MRR_PRODUCER_SCHEMA,
  updateCardMRR,
} from "./card-mrr.js";
import {
  CARD_BEHAVIOUR_ROTATION_PRODUCER_SCHEMA,
} from "./card-behaviour-rotation.js";
import {
  THREE_PERSPECTIVE_ZBUFFER_PRODUCER_SCHEMA,
  threePerspectiveZBufferParams,
} from "./projection-depth.js";

const DYNAMIC_RUNTIME_AUDIT_SCHEMA =
  "pocket-card-render/dynamic-port-runtime-audit@1";
const FLOW_COMPONENT_SOURCE =
  "Card_ShadowBox_Effect_Flow component runtime (unresolved)";
const OFFICIAL_COMMON_VALUE_SOURCE =
  "pocket-card-render/official-guest-common-value-unresolved@1";

function copyNeutralValue(uniform, fallback) {
  if (ArrayBuffer.isView(uniform.value)) {
    uniform.value.fill(0);
    if (ArrayBuffer.isView(fallback) || Array.isArray(fallback)) {
      uniform.value.set(Array.from(fallback).slice(0, uniform.value.length));
    } else if (Number.isFinite(Number(fallback))) {
      uniform.value.fill(Number(fallback));
    }
    return uniform.value;
  }
  if (uniform.value?.isVector2 || uniform.value?.isVector3 || uniform.value?.isVector4) {
    const values = Array.isArray(fallback) || ArrayBuffer.isView(fallback)
      ? Array.from(fallback)
      : [];
    uniform.value.set(
      Number(values[0]) || 0,
      Number(values[1]) || 0,
      Number(values[2]) || 0,
      Number(values[3]) || 0,
    );
    return uniform.value;
  }
  uniform.value = Number(fallback) || 0;
  return uniform.value;
}

function setThreeProjectionZBufferParams(uniform, camera) {
  if (!camera || !Number.isFinite(camera.near) || !Number.isFinite(camera.far)) {
    uniform.value.set(0, 0, 1, 0);
    return "neutral-no-camera";
  }
  uniform.value.set(
    ...threePerspectiveZBufferParams(camera.near, camera.far),
  );
  return "three-perspective-derived";
}

export function updateMegaRuntime(
  materials,
  quaternion,
  globalTime = 0,
  camera = null,
  deltaTime = 0,
) {
  const msrValuesByState = new Map();
  const mrrValuesByState = new Map();
  for (const material of materials) {
    const dynamic = material.userData.dynamicPortUniforms
      || material.userData.megaDynamicUniforms
      || [];
    const specs = material.userData.dynamicPortUniformSpecs
      || material.userData.megaDynamicUniformSpecs
      || {};
    const defaults = material.userData.dynamicPortDefaults
      || material.userData.megaDynamicDefaults
      || {};
    const audit = {};
    let futureValues = null;
    let ancientValues = null;
    let marbleValues = null;
    let msrValues = null;
    for (const name of dynamic) {
      const uniform = material.uniforms[name];
      if (!uniform) throw new Error(`${material.userData.exactShader}: missing dynamic uniform ${name}`);
      const source = specs[name]?.source;
      if (source === FLOW_COMPONENT_SOURCE) {
        uniform.value = name === "_TimeParam" ? globalTime : defaults[name] ?? 0;
      } else if (source === THREE_PERSPECTIVE_ZBUFFER_PRODUCER_SCHEMA
          && name === "_ZBufferParams") {
        audit[name] = setThreeProjectionZBufferParams(uniform, camera);
        continue;
      } else if (source === CARD_MSR_PRODUCER_SCHEMA) {
        const state = material.userData.cardMSRState;
        if (!state) {
          throw new Error(
            `${material.userData.exactShader}: CardMSRObject state is missing`,
          );
        }
        if (!msrValuesByState.has(state)) {
          msrValuesByState.set(state, updateCardMSR(state, {
            threeQuaternion: quaternion.toArray
              ? quaternion.toArray()
              : [quaternion.x, quaternion.y, quaternion.z, quaternion.w],
            deltaTime,
          }));
        }
        msrValues = msrValuesByState.get(state);
        if (name === "_TimeParam") {
          uniform.value = msrValues.timeParam;
        } else if (name === "_Transparency") {
          uniform.value = material.userData.cardMSRRole === "parallax"
            ? msrValues.parallaxTransparency
            : msrValues.transparency;
        } else if (name === "_Translate") {
          uniform.value = msrValues.parallaxTranslate;
        } else if (name === "_FlipAnimOffset") {
          uniform.value = msrValues.flipAnimOffset;
        } else if (name === "_ReflectIntensity") {
          uniform.value = msrValues.reflectIntensity;
        } else if (name === "_FlipAnim") {
          uniform.value = msrValues.flipAnim;
        } else if (name === "_FlipBlend") {
          uniform.value = msrValues.flipBlend;
        } else {
          throw new Error(
            `${material.userData.exactShader}: unsupported CardMSRObject output ${name}`,
          );
        }
      } else if (source === CARD_MRR_PRODUCER_SCHEMA
          || source === CARD_MRR_MATERIAL_OVERRIDE_PRODUCER_SCHEMA) {
        if (source === CARD_MRR_MATERIAL_OVERRIDE_PRODUCER_SCHEMA
            && material.userData.cardMRRStaticMaterial) {
          copyNeutralValue(uniform, defaults[name]);
          audit[name] = uniform.value;
          continue;
        }
        const state = material.userData.cardMRRState;
        if (!state) {
          throw new Error(
            `${material.userData.exactShader}: CardMRRObject state is missing`,
          );
        }
        if (!mrrValuesByState.has(state)) {
          mrrValuesByState.set(state, updateCardMRR(state, {
            threeQuaternion: quaternion.toArray
              ? quaternion.toArray()
              : [quaternion.x, quaternion.y, quaternion.z, quaternion.w],
            deltaTime,
          }));
        }
        const mrrValues = mrrValuesByState.get(state);
        const role = material.userData.cardMRRRole;
        const scalarOutputs = {
          main: {
            _ChangeColor: "changeColor",
            _LightColorIntensity: "lightColorIntensity",
            _LightEmitIntensity: "lightEmitIntensity",
            _LightPower: "lightPower",
            _Layer2ColorPower: "layer2ColorPower",
            _Layer2EmissiveIntensity: "layer2EmissiveIntensity",
          },
          effect: {
            _Switch: "effectSwitchColor",
            _AdditiveIntensity: "effectAdditiveIntensity",
            _Color3Blend: "effectColor3Blend",
            _EmissiveIntensity: "effectEmissiveIntensity",
          },
          flash: {
            _FlashIntensity: "flashIntensity",
            _RadialScaling: "flashRadialScaling",
            _RadialAnim: "flashRadialAnim",
          },
        };
        if (role === "main" && name === "_Layer2UVTranslate"
            && uniform.value?.fromArray) {
          uniform.value.fromArray(mrrValues.layer2UVTranslate);
        } else {
          const output = scalarOutputs[role]?.[name];
          if (!output) {
            throw new Error(
              `${material.userData.exactShader}: unsupported CardMRRObject ${role} output ${name}`,
            );
          }
          uniform.value = mrrValues[output];
        }
      } else if (source === OFFICIAL_COMMON_VALUE_SOURCE) {
        copyNeutralValue(uniform, defaults[name]);
      } else if (source === CARD_FUTURE_PRODUCER_SCHEMA) {
        futureValues ||= updateCardFuture(material.userData.cardFutureState, {
          threeQuaternion: quaternion.toArray
            ? quaternion.toArray()
            : [quaternion.x, quaternion.y, quaternion.z, quaternion.w],
          deltaTime,
        });
        if (name !== "_AnimFrame") {
          throw new Error(`${material.userData.exactShader}: unsupported CardFutureObject output ${name}`);
        }
        uniform.value = futureValues.animFrame;
      } else if (source === CARD_ANCIENT_PRODUCER_SCHEMA) {
        ancientValues ||= updateCardAncient(material.userData.cardAncientState, {
          threeQuaternion: quaternion.toArray
            ? quaternion.toArray()
            : [quaternion.x, quaternion.y, quaternion.z, quaternion.w],
          deltaTime,
        });
        if (name === "_Shake" && uniform.value?.fromArray) {
          uniform.value.fromArray(ancientValues.shake);
        } else if (name === "_StrataFaults" && ArrayBuffer.isView(uniform.value)) {
          uniform.value.set(ancientValues.strataFaults);
        } else {
          throw new Error(`${material.userData.exactShader}: unsupported CardAncientObject output ${name}`);
        }
      } else if (source === CARD_MARBLE_PRODUCER_SCHEMA) {
        marbleValues ||= updateCardMarble(material.userData.cardMarbleState, {
          threeQuaternion: quaternion.toArray
            ? quaternion.toArray()
            : [quaternion.x, quaternion.y, quaternion.z, quaternion.w],
          deltaTime,
        });
        if (name === "_Attributes" && ArrayBuffer.isView(uniform.value)) {
          uniform.value.set(marbleValues.attributes);
        } else if (name === "_Front" && uniform.value?.fromArray) {
          uniform.value.fromArray(marbleValues.front);
        } else if (name === "_PointCount") {
          uniform.value = marbleValues.pointCount;
        } else if (name === "_Tilt") {
          uniform.value = marbleValues.tilt;
        } else if (name === "_TiltRotation") {
          uniform.value = marbleValues.tiltRotation;
        } else if (name === "_WorldFront" && uniform.value?.fromArray) {
          uniform.value.fromArray(marbleValues.worldFront);
        } else if (specs[name]?.type === "sampler2D"
            && material.userData.cardMarbleCurveTexture) {
          uniform.value = material.userData.cardMarbleCurveTexture;
        } else {
          throw new Error(`${material.userData.exactShader}: unsupported CardMarbleLayer output ${name}`);
        }
      } else if (source === CARD_BEHAVIOUR_ROTATION_PRODUCER_SCHEMA) {
        if (name !== "_Rotation"
            || !material.userData.cardBehaviourHologramRotation) {
          throw new Error(
            `${material.userData.exactShader}: invalid CardBehaviour rotation binding`,
          );
        }
        copyNeutralValue(
          uniform,
          material.userData.cardBehaviourHologramRotation,
        );
      } else {
        throw new Error(`${material.userData.exactShader}: unsupported dynamic producer ${source}`);
      }
      audit[name] = uniform.value;
    }
    material.userData.dynamicPortRuntimeAudit = {
      schema: DYNAMIC_RUNTIME_AUDIT_SCHEMA,
      status: Object.values(specs).some((spec) =>
        spec.source === FLOW_COMPONENT_SOURCE
        || spec.source === OFFICIAL_COMMON_VALUE_SOURCE)
        ? "runtime-required"
        : "known-implementation",
      globalTime,
      deltaTime,
      uniforms: audit,
      runtimeRequiredUniforms: Object.entries(specs)
        .filter(([, spec]) =>
          spec.source === FLOW_COMPONENT_SOURCE
          || spec.source === OFFICIAL_COMMON_VALUE_SOURCE)
        .map(([name]) => name),
      ...(futureValues ? {
        producer: CARD_FUTURE_PRODUCER_SCHEMA,
        componentIdentity: material.userData.cardFutureComponentIdentity,
        cardFuture: futureValues,
      } : {}),
      ...(ancientValues ? {
        producer: CARD_ANCIENT_PRODUCER_SCHEMA,
        componentIdentity: material.userData.cardAncientComponentIdentity,
        cardAncient: {
          shake: Array.from(ancientValues.shake),
          strataFaults: Array.from(ancientValues.strataFaults),
          goalStrataFaults: ancientValues.goalStrataFaults,
          frameCount: ancientValues.frameCount,
          nativeBoundaries: ancientValues.nativeBoundaries,
        },
      } : {}),
      ...(marbleValues ? {
        producer: CARD_MARBLE_PRODUCER_SCHEMA,
        componentIdentity: material.userData.cardMarbleComponentIdentity,
        cardMarble: {
          attributes: Array.from(marbleValues.attributes),
          front: Array.from(marbleValues.front),
          pointCount: marbleValues.pointCount,
          tilt: marbleValues.tilt,
          tiltRotation: marbleValues.tiltRotation,
          worldFront: marbleValues.worldFront,
          frameCount: marbleValues.frameCount,
          schedulerBoundary: marbleValues.schedulerBoundary,
        },
      } : {}),
      ...(msrValues ? {
        producer: CARD_MSR_PRODUCER_SCHEMA,
        componentIdentity: material.userData.cardMSRComponentIdentity,
        cardMSR: msrValues,
      } : {}),
      ...(material.userData.cardMRRState ? {
        producer: CARD_MRR_PRODUCER_SCHEMA,
        componentIdentity: material.userData.cardMRRComponentIdentity,
        cardMRR: mrrValuesByState.get(material.userData.cardMRRState),
      } : {}),
    };
    material.userData.megaRuntimeAudit = material.userData.dynamicPortRuntimeAudit;
  }
}

export function updateMegaTiltProxy(materials, quaternion) {
  updateMegaRuntime(materials, quaternion);
}
