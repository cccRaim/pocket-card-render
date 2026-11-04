import test from "node:test";
import assert from "node:assert/strict";
import { Quaternion, Euler, Vector2, Vector3, Vector4 } from "three";
import { createCardDualMRRState, updateCardDualMRR, cardDualMRRUniforms,
  createCardDualMSRState, updateCardDualMSR, cardDualMSRUniforms,
  CARD_DUAL_MRR_PRODUCER_SCHEMA, CARD_DUAL_MSR_PRODUCER_SCHEMA } from "../public/render/card-dual.js";
import { createCardReliefState, updateCardRelief, CARD_RELIEF_PRODUCER_SCHEMA,
  CARD_RGB_PRODUCER_SCHEMA, CARD_UV_SHADOW_PRODUCER_SCHEMA } from "../public/render/card-parameters.js";
import { computeCardRgbColor } from "../public/render/card-parameters.js";
import { buildExactRuntimeMaterial } from "../public/render/materials/exact-runtime.js";
import "../public/render/materials/holo.js";
import { getMaterial } from "../public/render/registry.js";
import { updateMegaRuntime } from "../public/render/mega-runtime.js";

const pose = (x, y = 0) => new Quaternion().setFromEuler(new Euler(x * Math.PI / 180, y * Math.PI / 180, 0)).toArray();
const names = ["ChangeColorCurve", "LightColorIntensityCurve", "LightEmitIntensityCurve", "LightPower",
  "Layer2UVXTranslateByTiltingLeft", "Layer2UVXTranslateByTiltingRight", "Layer2ColorPower", "Layer2EmissiveIntensity",
  "EffSwitchColor", "EffAdditiveIntensity", "EffColor3Blend", "EffEmissiveIntensity", "FlashIntensity", "FlashRadialScaling", "FlashRadialAnim",
  "TypeEffectTransitionSwitchCurve", "TransitionBoundsCurve", "TransitionRangeCurve", "TypeIconHighlightTranslateByTiltingRight",
  "TypeIconHighlightTranslateByTiltingLeft", "HoloPowerCurve", "OutlineReflectCenterX", "OutlineReflectColorIntensity",
  "ColorIntensityNoiseStrength", "BGTransitionSwitchCurve", "FrameTransitionSwitchCurve", "FrameBandWidthCurve", "ShadowDecayCurve"];
function settings() {
  return { identity: "test:settings", curves: Object.fromEntries(names.map((name, index) => [name, { keys: [0, 1].map((time) => ({
    time, value: time * (index + 1), inSlope: index + 1, outSlope: index + 1,
    inWeight: 1 / 3, outWeight: 1 / 3, weightedMode: 0,
  })) }])) };
}
function config(kind = "dualMSR") {
  return { kind, componentIdentity: "test:component", animationSettingsIdentity: "test:settings",
    animStartDegree: 10, animTimeScale: 1, animDuration: 1, flashRadialStartOffset: .2, transitionAngle: 20,
    isAnimationStopped: 0, flashAnimTimeScale: .5, flashAnimDuration: .3, outlineAnimTimeScale: 1, outlineAnimDuration: .8,
    intensityNoiseSpeed: 2, checkRotatingTime: .1, rotatingStartThreshold: .1, rotatingEndThreshold: .01,
    reflectStartBane: 30, reflectEndBane: 20, reflectStartNensei: 5, reflectEndNensei: 4, reflectFlipBookMaxSpeed: 3,
    transitionBane: 25, transitionNensei: 4, translateOffset: [.1, -.2], lightDir: [0, 1, -1],
    rendererBindings: Object.fromEntries(["main", "effect", "flash", "typeIcon", "typeEffect", "shadowbox", "transition", "frame", "shadow"].map((role) => [role, ["test:renderer"]])) };
}

test("dual MRR starts its clock after the threshold frame and preserves left/right transition", () => {
  const state = createCardDualMRRState(config(), settings());
  updateCardDualMRR(state, { threeQuaternion: pose(20), deltaTime: .1 });
  assert.equal(state.elapsedAnimationTime, 0);
  assert.equal(state.isPlaying, true);
  assert(state.textureSwitch > 0);
  updateCardDualMRR(state, { threeQuaternion: pose(20), deltaTime: .1 });
  assert.equal(state.elapsedAnimationTime, Math.fround(.1));
  assert(Math.abs(state.changeColor - .1) < 1e-6);
  updateCardDualMRR(state, { threeQuaternion: pose(-20), deltaTime: 0 });
  assert(state.textureSwitch < 0);
  assert.equal(cardDualMRRUniforms(state, "typeEffect")._IsLeft, 1);
  assert.deepEqual(cardDualMRRUniforms(state, "transition"), cardDualMRRUniforms(state, "typeEffect"));
  assert.throws(() => cardDualMRRUniforms(state, "invalid"), /role/);
});

test("dual MSR flash and outline have separate clocks and afterglow states", () => {
  const state = createCardDualMSRState(config(), settings());
  updateCardDualMSR(state, { threeQuaternion: pose(20), deltaTime: .1 });
  assert.equal(state.flashAnimElapsedTime, Math.fround(.1));
  assert.equal(state.outlineAnimElapsedTime, Math.fround(.1));
  assert(Math.abs(state.holoPower - 4.2) < 1e-6);
  updateCardDualMSR(state, { threeQuaternion: pose(20), deltaTime: .1 });
  assert.equal(state.flashAnimState, 0);
  assert.equal(state.outlineAnimState, 1);
  for (let i = 0; i < 8; i++) updateCardDualMSR(state, { threeQuaternion: pose(20), deltaTime: .1 });
  assert.equal(state.outlineAnimState, 0);
  assert.equal(state.reflectPDState, 0);
  assert(Object.values(cardDualMSRUniforms(state, "shadowbox")).every(Number.isFinite));
});

test("dual NoParallax starts at zero and restarts on a repeated threshold crossing", () => {
  const state = createCardDualMSRState(config("dualNoParallax"), settings());
  updateCardDualMSR(state, { threeQuaternion: pose(20), deltaTime: .1 });
  assert.equal(state.flashAnimElapsedTime, 0);
  updateCardDualMSR(state, { threeQuaternion: pose(0), deltaTime: .1 });
  assert(state.highlightTranslate[0] > 0);
  updateCardDualMSR(state, { threeQuaternion: pose(20), deltaTime: .1 });
  assert.equal(state.flashAnimElapsedTime, 0);
  assert.equal(state.outlineAnimState, 0);
  assert.equal(state.transitionPDTilt, 0);
});

test("stopped transition remains frozen while flash animation continues", () => {
  const state = createCardDualMSRState({ ...config(), isAnimationStopped: 1 }, settings());
  updateCardDualMSR(state, { threeQuaternion: pose(20), deltaTime: .1 });
  assert.equal(state.transitionPDTilt, 0);
  assert(state.holoPower > 0);
  const mrr = createCardDualMRRState({ ...config(), isAnimationStopped: 1 }, settings());
  updateCardDualMRR(mrr, { threeQuaternion: pose(20), deltaTime: .1 });
  assert.equal(mrr.textureSwitch, 0);
  assert(mrr.isPlaying);
});

test("dual MRR triggers from equality and restarts a playing animation", () => {
  const state = createCardDualMRRState(config(), settings());
  state.lastTiltDegree = 10;
  updateCardDualMRR(state, { threeQuaternion: pose(20), deltaTime: .1 });
  assert.equal(state.isPlaying, true);
  updateCardDualMRR(state, { threeQuaternion: pose(0), deltaTime: .1 });
  updateCardDualMRR(state, { threeQuaternion: pose(20), deltaTime: .1 });
  assert.equal(state.elapsedAnimationTime, 0);
  updateCardDualMRR(state, { threeQuaternion: pose(0), deltaTime: .1 });
  updateCardDualMRR(state, { threeQuaternion: pose(20), deltaTime: .1 });
  assert.equal(state.elapsedAnimationTime, 0);
});

test("Relief suppresses elapsed time on its first frame and keeps shadow UV vector shape", () => {
  const state = createCardReliefState(config(), settings());
  updateCardRelief(state, { threeQuaternion: pose(20), globalTime: 4, deltaTime: .2 });
  assert.equal(state.elapsedAnimationTime, 0);
  const output = updateCardRelief(state, { threeQuaternion: pose(20), globalTime: 4.2, deltaTime: .2 });
  assert(Math.abs(output._ChangeColor - .2) < 1e-6);
  assert(Math.abs(output._ShadowDecay - 5.6) < 1e-6);
  assert(output._ShadowUVTranslate instanceof Float32Array);
});

function context(dynamic, uniforms, runtimeSettings) {
  const manifest = { runtime_contract: { dynamic_uniforms: dynamic } };
  return { manifest, ctx: { dynamicPortMats: [], runtimeSettings,
    exactShaderPort: () => ({ manifest, vert: "void main() {}", frag: "void main() {}" }),
    exactPortUniforms: () => Object.fromEntries(Object.entries(uniforms).map(([name, value]) => [name, { value: value?.clone ? value.clone() : value }])),
  } };
}
const recipe = (family, role) => ({ runtimeDispatch: { shaderKey: "Test_Card" }, rendererProperties: {
  [family]: { componentIdentity: "test:component", rendererIdentity: "test:renderer", role },
} });

test("published dynamic UI bindings select the text or hologram target by uiType", () => {
  const { ctx } = context({}, {}, {});
  ctx.dynUITex = {};
  ctx.dynHoloTex = {};
  ctx.exactPortUniforms = (_recipe, _port, resolve) => ({
    sampler: { value: resolve({ slot: "_DynamicUITex", dimension: 2, spirvName: "sampler" }) },
  });
  for (const [uiType, texture] of [ctx.dynUITex, ctx.dynHoloTex].entries()) {
    const material = buildExactRuntimeMaterial({
      runtimeDispatch: { shaderKey: "Test_Card" },
      rendererProperties: { dynamicUI: [{ slot: "_DynamicUITex", uiType }] },
    }, ctx);
    assert.equal(material.uniforms.sampler.value, texture);
    assert.deepEqual(material.userData.dynamicUISamplers, { sampler: uiType });
    material.dispose();
  }
});

test("dual materials share one component update across renderer roles and do not mutate the manifest", () => {
  const dynamic = { _TransitionSwitch: { type: "float", source: CARD_DUAL_MSR_PRODUCER_SCHEMA } };
  const { ctx, manifest } = context(dynamic, { _TransitionSwitch: 0, _BandWidth: 0 }, { cardDualMSR: { "test:component": config() }, dualMsrAnimation: { "test:settings": settings() } });
  const one = buildExactRuntimeMaterial(recipe("cardDualMSR", "transition"), ctx);
  const two = buildExactRuntimeMaterial(recipe("cardDualMSR", "frame"), ctx);
  assert.equal(one.userData.cardDualMSRState, two.userData.cardDualMSRState);
  updateMegaRuntime([one, two], new Quaternion().fromArray(pose(20)), 1, null, .1);
  assert.equal(one.userData.cardDualMSRState.elapsedTime, Math.fround(.1));
  assert.equal(one.uniforms._TransitionSwitch.value, two.uniforms._TransitionSwitch.value);
  assert.equal(manifest.runtime_contract.dynamic_uniforms._BandWidth, undefined);
  assert.equal(two.userData.dynamicPortRuntimeAudit.evidenceScope, "reference-only");
  assert.equal(two.userData.dynamicPortRuntimeAudit.runtimeEvidence, false);
});

test("inherited MRR outputs and static highlight uniforms are driven by the dual component", () => {
  const dynamic = { _ChangeColor: { type: "float", source: "pocket-card-render/card-mrr-object-arm64-state-port@1" } };
  const { ctx } = context(dynamic, { _ChangeColor: 0, _Layer2UVTranslate: new Vector4() }, { cardDualMRR: { "test:component": config() }, dualMrrAnimation: { "test:settings": settings() } });
  const material = buildExactRuntimeMaterial(recipe("cardDualMRR", "main"), ctx);
  updateMegaRuntime([material], new Quaternion().fromArray(pose(20)), 1, null, .1);
  updateMegaRuntime([material], new Quaternion().fromArray(pose(20)), 1.1, null, .1);
  assert(Math.abs(material.uniforms._ChangeColor.value - .1) < 1e-6);
  assert(material.uniforms._Layer2UVTranslate.value.x > 0);
});

test("Relief and UV shadow require a world rotation and advance once across materials", () => {
  const dynamic = { _ShadowDecay: { type: "float", source: CARD_RELIEF_PRODUCER_SCHEMA }, _ShadowUVTranslate: { type: "vec2", source: CARD_UV_SHADOW_PRODUCER_SCHEMA } };
  const c = config();
  const { ctx } = context(dynamic, { _ShadowDecay: 0, _ShadowUVTranslate: new Vector2() }, {
    cardMReliefSR: { "test:component": c }, reliefMSRAnimationSettings: { "test:settings": settings() },
    cardUVShadow: { "test:component": { ...c, rendererBindings: ["test:renderer"] } },
  });
  const r = recipe("cardMReliefSR", "shadow");
  r.rendererProperties.cardUVShadow = recipe("cardUVShadow").rendererProperties.cardUVShadow;
  const one = getMaterial("shadowOpaqueHologram").build(r, ctx);
  const two = getMaterial("shadowParallaxHologram").build(r, ctx);
  assert.deepEqual(ctx.dynamicPortMats, [one, two]);
  assert.throws(() => updateMegaRuntime([one], new Quaternion(), 1, null, .1), /world quaternion/);
  const world = new Quaternion().fromArray(pose(20));
  updateMegaRuntime([one, two], new Quaternion(), 1, null, .1, world);
  updateMegaRuntime([one, two], new Quaternion(), 1.1, null, .1, world);
  assert.equal(one.userData.cardMReliefSRState.elapsedAnimationTime, Math.fround(.1));
  assert.deepEqual(one.uniforms._ShadowUVTranslate.value.toArray(), two.uniforms._ShadowUVTranslate.value.toArray());
});

test("extended producers reject missing settings, invalid timing and unbound renderer identities", () => {
  assert.throws(() => createCardDualMRRState({ ...config(), animTimeScale: 0 }, settings()), /Invalid/);
  assert.throws(() => createCardDualMSRState(config(), { identity: "other", curves: {} }), /mismatch/);
  assert.throws(() => updateCardDualMRR(createCardDualMRRState(config(), settings()), { threeQuaternion: pose(0), deltaTime: NaN }), /finite/);
  const { ctx } = context({ _TransitionSwitch: { type: "float", source: CARD_DUAL_MSR_PRODUCER_SCHEMA } }, {}, {});
  assert.throws(() => buildExactRuntimeMaterial(recipe("cardDualMSR", "transition"), ctx), /binding/);
  const rgb = context({ _AreaAColorOklab: { type: "vec3", source: CARD_RGB_PRODUCER_SCHEMA } }, {}, {});
  assert.throws(() => buildExactRuntimeMaterial(recipe("cardRGB"), rgb.ctx), /binding/);
});

test("RGB binds material colors before defaults and retains vec3 values across frames", () => {
  const { ctx, manifest } = context({ _AreaAColorOklab: { type: "vec3", source: CARD_RGB_PRODUCER_SCHEMA } }, {}, {
    cardRGB: { "test:component": { componentIdentity: "test:component", rendererBindings: ["test:renderer"] } },
  });
  manifest.official_shader_property_defaults = { colors: { _AreaAColor: [0, 1, 0, 1] } };
  const r = { ...recipe("cardRGB"), colors: { _AreaAColor: [1, 0, 0, 1] } };
  const material = buildExactRuntimeMaterial(r, ctx);
  const value = material.uniforms._AreaAColorOklab.value;
  assert(value instanceof Vector3);
  updateMegaRuntime([material], new Quaternion(), 0, null, .1);
  assert.equal(material.uniforms._AreaAColorOklab.value, value);
  assert.deepEqual(value.toArray(), Array.from(computeCardRgbColor([1, 0, 0])));
});

test("NoParallax highlight narrows to the shader vec2 and transition keeps its integer declaration", () => {
  const { ctx } = context({}, { _HighlightTranslate: new Vector2() }, {
    cardDualMSR: { "test:component": config("dualNoParallax") }, dualMsrAnimation: { "test:settings": settings() },
  });
  const material = buildExactRuntimeMaterial(recipe("cardDualMSR", "typeIcon"), ctx);
  updateMegaRuntime([material], new Quaternion().fromArray(pose(20)), 1, null, .1);
  updateMegaRuntime([material], new Quaternion().fromArray(pose(20)), 1.1, null, .1);
  assert.equal(material.uniforms._HighlightTranslate.value.isVector2, true);
  assert(material.uniforms._HighlightTranslate.value.x > 0);
  const other = context({ _IsLeft: { type: "int", source: CARD_DUAL_MSR_PRODUCER_SCHEMA } }, {}, {
    cardDualMSR: { "test:component": config() }, dualMsrAnimation: { "test:settings": settings() },
  });
  const transition = buildExactRuntimeMaterial(recipe("cardDualMSR", "transition"), other.ctx);
  assert.equal(transition.userData.dynamicPortUniformSpecs._IsLeft.type, "int");
});
