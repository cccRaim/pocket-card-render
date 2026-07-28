import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  CARD_MSR_PRODUCER_SCHEMA,
  createCardMSRState,
  updateCardMSR,
  validateCardMSRConfig,
} from "../public/render/card-msr.js";
import { buildExactRuntimeMaterial } from "../public/render/materials/exact-runtime.js";
import { updateMegaRuntime } from "../public/render/mega-runtime.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CARD_IDS = [
  "cPK_20_010840_00_MEGAKAILIOSex_SR",
  "cPK_20_016210_00_MEGAYADORANex_SR",
  "cPK_20_016430_00_MEGAGANGARex_SR",
];
const scenes = CARD_IDS.map((cardId) => JSON.parse(fs.readFileSync(
  path.join(ROOT, "public", `scene.${cardId}.json`),
  "utf8",
)));
const configs = scenes.map((scene) =>
  Object.values(scene.runtimeSettings.cardMSR)[0]);
const settings = scenes.map((scene, index) =>
  scene.runtimeSettings.msrAnimation[configs[index].animationSettingsIdentity]);

const VERTEX = `#version 300 es
in vec3 position;
void main() { gl_Position = vec4(position, 1.0); }
`;
const FRAGMENT = `#version 300 es
precision highp float;
layout(location = 0) out vec4 pc_fragColor;
void main() { pc_fragColor = vec4(1.0); }
`;

function tiltedQuaternion(degrees = 30) {
  const half = degrees * Math.PI / 360;
  return [0, Math.sin(half), 0, Math.cos(half)];
}

function firstDrawForRole(scene, role) {
  const draw = scene.officialDraws.find(
    (candidate) => candidate.rendererProperties?.cardMSR?.role === role,
  );
  assert.ok(draw, `missing ${role} CardMSR draw`);
  return draw;
}

function fixtureForRole(scene, role, dynamicUniforms) {
  const draw = firstDrawForRole(scene, role);
  const recipe = {
    ...scene.materials[draw.materialName],
    rendererProperties: draw.rendererProperties,
    runtimeDispatch: { shaderKey: `CardMSR_${role}` },
  };
  const manifest = {
    official_pass_runtime: {},
    official_selector: { selectorId: `card-msr-${role}` },
    official_executable_identity: {
      semanticExecutableId: `card-msr-${role}-executable`,
    },
    runtime_contract: { dynamic_uniforms: dynamicUniforms },
  };
  return {
    recipe,
    manifest,
  };
}

function sharedContext(scene) {
  return {
    dynamicPortMats: [],
    runtimeSettings: scene.runtimeSettings,
    runtimeComponentStates: new Map(),
    runtimeComponentTextures: new Map(),
    exactShaderPort: (recipe) => ({
      vert: VERTEX,
      frag: FRAGMENT,
      manifest: recipe.__manifest,
    }),
    exactPortUniforms: () => ({}),
    layerCubeDefault: () => null,
    layerTexDefault: () => null,
  };
}

test("Mega SR scenes preserve three official CardMSRObject components and one settings asset", () => {
  assert.deepEqual(
    configs.map((config) => config.componentIdentity),
    [
      "CAB-46381ce04bcae4d175f44b2ba92ee9dd:6623677083657556003",
      "CAB-88b3bf2c8ec25c292b22fd7d98d65f1e:7789006433652531418",
      "CAB-9f39ecdfd81cc21b5031d491ba9b0826:-1780107615064738716",
    ],
  );
  assert.equal(
    new Set(configs.map((config) => config.animationSettingsIdentity)).size,
    1,
  );
  for (const [index, config] of configs.entries()) {
    const validated = validateCardMSRConfig(config, settings[index]);
    assert.equal(validated.config.componentIdentity, config.componentIdentity);
    assert.deepEqual(
      Object.fromEntries(
        Object.entries(config.rendererBindings).map(([role, bindings]) => [
          role,
          bindings.length,
        ]),
      ),
      { aura: 2, parallax: 1, shadowbox: 1 },
    );
  }
});

test("CardMSRObject identity pose starts from serialized curves and time offset", () => {
  const state = createCardMSRState(configs[0], settings[0]);
  const result = updateCardMSR(state, {
    threeQuaternion: [0, 0, 0, 1],
    deltaTime: 0,
  });
  assert.equal(result.timeParam, configs[0].timeOffset);
  assert.equal(result.tilt, 0);
  assert.equal(result.tiltDegree, 0);
  assert.equal(result.animState, 0);
  assert.equal(result.frameCount, 1);
  for (const value of [
    result.transparency,
    result.parallaxTransparency,
    result.parallaxTranslate,
    result.flipAnimOffset,
    result.reflectIntensity,
    result.flipAnim,
    result.flipBlend,
  ]) {
    assert.equal(Number.isFinite(value), true);
  }
});

test("CardMSRObject starts its official animation on an upward tilt crossing", () => {
  const state = createCardMSRState(configs[0], settings[0]);
  updateCardMSR(state, {
    threeQuaternion: [0, 0, 0, 1],
    deltaTime: 1 / 60,
  });
  const result = updateCardMSR(state, {
    threeQuaternion: tiltedQuaternion(30),
    deltaTime: 1 / 60,
  });
  assert.ok(result.tiltDegree > configs[0].animStartDegree);
  assert.equal(result.animState, 1);
  assert.ok(result.timeParam > configs[0].timeOffset);
  assert.ok(result.parallaxTranslate >= 0);
  assert.equal(result.frameCount, 2);
});

test("CardMSRObject preserves native translation denominator and Afterglow exit", () => {
  const config = {
    ...configs[0],
    appearNensei: 2,
    disappearNensei: 10,
  };
  const state = createCardMSRState(config, settings[0]);
  state.parallaxPDSpeed = Math.fround(1);
  state.parallaxPDTilt = Math.fround(0);
  updateCardMSR(state, {
    threeQuaternion: [0, 0, 0, 1],
    deltaTime: 0.1,
  });
  const f32 = Math.fround;
  const dt = f32(0.1);
  const projected = f32(f32(0) - f32(dt * f32(1)));
  const acceleration = f32(
    f32(f32(48) * projected) - f32(f32(1) * f32(2)),
  );
  const expectedSpeed = f32(
    f32(1)
      + f32(
        f32(dt * acceleration)
          / f32(1 + f32(dt * f32(10))),
      ),
  );
  assert.equal(state.parallaxPDSpeed, expectedSpeed);
  assert.equal(state.parallaxPDTilt, Math.fround(
    dt * expectedSpeed,
  ));

  state.reflectPDState = 2;
  state.lastWorldFront.set([0, 0, -1]);
  state.tiltDistanceQueue.length = 0;
  const result = updateCardMSR(state, {
    threeQuaternion: [0, 0, 0, 1],
    deltaTime: 0.1,
  });
  assert.equal(result.reflectPDState, 0);
});

test("one CardMSRObject state is shared and advanced once across all renderer roles", () => {
  const scene = scenes[0];
  const ctx = sharedContext(scene);
  const cases = [
    ["aura", {
      _TimeParam: { type: "float", source: CARD_MSR_PRODUCER_SCHEMA },
      _Transparency: { type: "float", source: CARD_MSR_PRODUCER_SCHEMA },
    }],
    ["parallax", {
      _Translate: { type: "float", source: CARD_MSR_PRODUCER_SCHEMA },
      _Transparency: { type: "float", source: CARD_MSR_PRODUCER_SCHEMA },
    }],
    ["shadowbox", {
      _FlipAnim: { type: "float", source: CARD_MSR_PRODUCER_SCHEMA },
      _FlipAnimOffset: { type: "float", source: CARD_MSR_PRODUCER_SCHEMA },
      _FlipBlend: { type: "float", source: CARD_MSR_PRODUCER_SCHEMA },
      _ReflectIntensity: { type: "float", source: CARD_MSR_PRODUCER_SCHEMA },
    }],
  ];
  const materials = cases.map(([role, dynamic]) => {
    const { recipe, manifest } = fixtureForRole(scene, role, dynamic);
    recipe.__manifest = manifest;
    return buildExactRuntimeMaterial(recipe, ctx);
  });
  assert.equal(ctx.runtimeComponentStates.size, 1);
  assert.equal(
    new Set(materials.map((material) => material.userData.cardMSRState)).size,
    1,
  );

  const quaternion = tiltedQuaternion(30);
  updateMegaRuntime(
    materials,
    {
      x: quaternion[0],
      y: quaternion[1],
      z: quaternion[2],
      w: quaternion[3],
    },
    0,
    null,
    1 / 60,
  );
  assert.equal(materials[0].userData.cardMSRState.frameCount, 1);
  const result = materials[0].userData.dynamicPortRuntimeAudit.cardMSR;
  assert.equal(materials[0].uniforms._TimeParam.value, result.timeParam);
  assert.equal(
    materials[0].uniforms._Transparency.value,
    result.transparency,
  );
  assert.equal(
    materials[1].uniforms._Transparency.value,
    result.parallaxTransparency,
  );
  assert.equal(materials[1].uniforms._Translate.value, result.parallaxTranslate);
  assert.equal(materials[2].uniforms._FlipAnim.value, result.flipAnim);
  assert.equal(materials[2].uniforms._FlipBlend.value, result.flipBlend);
});

test("CardMSRObject malformed settings and renderer bindings fail closed", () => {
  assert.throws(
    () => validateCardMSRConfig({
      ...configs[0],
      rendererBindings: {
        ...configs[0].rendererBindings,
        shadowbox: [],
      },
    }, settings[0]),
    /identity\/binding contract is incomplete/,
  );
  assert.throws(
    () => validateCardMSRConfig(configs[0], {
      ...settings[0],
      curves: {
        ...settings[0].curves,
        AuraTransparency: { keys: [] },
      },
    }),
    /AuraTransparency is incomplete/,
  );
});
