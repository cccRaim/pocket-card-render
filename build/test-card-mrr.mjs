import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  CARD_MRR_PRODUCER_SCHEMA,
  createCardMRRState,
  updateCardMRR,
  validateCardMRRConfig,
} from "../public/render/card-mrr.js";
import { buildExactRuntimeMaterial } from "../public/render/materials/exact-runtime.js";
import { updateMegaRuntime } from "../public/render/mega-runtime.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CARD_IDS = [
  "cPK_10_012330_00_MEGAABSOLex_RR",
  "cPK_10_013460_00_MEGAMIMILOPex_RR",
];
const scenes = CARD_IDS.map((cardId) => JSON.parse(fs.readFileSync(
  path.join(ROOT, "public", `scene.${cardId}.json`),
  "utf8",
)));
const configs = scenes.map((scene) =>
  Object.values(scene.runtimeSettings.cardMRR)[0]);
const settings = scenes.map((scene, index) =>
  scene.runtimeSettings.mrrAnimation[configs[index].animationSettingsIdentity]);

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

function drawForRole(scene, role, shader) {
  const draw = scene.officialDraws.find((candidate) =>
    candidate.rendererProperties?.cardMRR?.role === role
      && (!shader || scene.materials[candidate.materialName].shader === shader));
  assert.ok(draw, `missing ${role}/${shader || "*"} CardMRR draw`);
  return draw;
}

function fixture(scene, role, shader, dynamicUniforms) {
  const draw = drawForRole(scene, role, shader);
  const recipe = {
    ...scene.materials[draw.materialName],
    rendererProperties: draw.rendererProperties,
    runtimeDispatch: { shaderKey: shader },
  };
  recipe.__manifest = {
    official_pass_runtime: {},
    official_selector: { selectorId: `card-mrr-${shader}` },
    official_executable_identity: {
      semanticExecutableId: `card-mrr-${shader}-executable`,
    },
    runtime_contract: { dynamic_uniforms: dynamicUniforms },
  };
  return recipe;
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

const dynamic = (names) => Object.fromEntries(
  names.map(([name, type = "float"]) => [
    name,
    { type, source: CARD_MRR_PRODUCER_SCHEMA },
  ]),
);

test("Mega RR scenes preserve official CardMRRObject and MRRAnimationSettings assets", () => {
  assert.deepEqual(
    configs.map((config) => config.componentIdentity),
    [
      "CAB-dcaafb44ef63ab9f25e3923fe7d85208:-2500324852403229865",
      "CAB-b7aaf8be113bd8d6cb4b457718214ca7:964443821872407604",
    ],
  );
  assert.equal(
    new Set(configs.map((config) => config.animationSettingsIdentity)).size,
    1,
  );
  for (const [index, config] of configs.entries()) {
    const validated = validateCardMRRConfig(config, settings[index]);
    assert.equal(validated.config.componentIdentity, config.componentIdentity);
    assert.deepEqual(
      Object.fromEntries(
        Object.entries(config.rendererBindings).map(([role, bindings]) => [
          role,
          bindings.length,
        ]),
      ),
      { main: 4, effect: 2, flash: 1 },
    );
  }
});

test("CardMRRObject initializes all 14 active MPB payload values from official curves", () => {
  const state = createCardMRRState(configs[0], settings[0]);
  const result = updateCardMRR(state, {
    threeQuaternion: [0, 0, 0, 1],
    deltaTime: 0,
  });
  assert.equal(result.tiltDegree, 0);
  assert.equal(result.isPlaying, false);
  assert.equal(result.frameCount, 1);
  for (const value of [
    result.changeColor,
    result.lightColorIntensity,
    result.lightEmitIntensity,
    result.lightPower,
    ...result.layer2UVTranslate,
    result.layer2ColorPower,
    result.layer2EmissiveIntensity,
    result.effectSwitchColor,
    result.effectAdditiveIntensity,
    result.effectColor3Blend,
    result.effectEmissiveIntensity,
    result.flashIntensity,
    result.flashRadialScaling,
    result.flashRadialAnim,
  ]) {
    assert.equal(Number.isFinite(value), true);
  }
  const rawRadial = settings[0].curves.FlashRadialScaling.keys[0].value;
  const offset = configs[0].flashRadialStartOffset;
  const max = settings[0].curves.FlashRadialScaling.keys.at(-1).value;
  assert.equal(
    result.flashRadialScaling,
    Math.fround(
      Math.fround(offset * Math.fround(max))
        + Math.fround(Math.fround(1 - Math.fround(offset)) * Math.fround(rawRadial)),
    ),
  );
});

test("CardMRRObject starts on the official upward threshold crossing", () => {
  const state = createCardMRRState(configs[0], settings[0]);
  updateCardMRR(state, {
    threeQuaternion: [0, 0, 0, 1],
    deltaTime: 1 / 60,
  });
  const result = updateCardMRR(state, {
    threeQuaternion: tiltedQuaternion(30),
    deltaTime: 1 / 60,
  });
  assert.ok(result.tiltDegree > configs[0].animStartDegree);
  assert.equal(result.isPlaying, true);
  assert.equal(state.elapsedAnimationTime > 0, true);
  assert.equal(state.worldFrontAtAnimStart[0] !== 0, true);
});

test("CardMRRObject speed adjustment uses the bounded tilt-history average", () => {
  const state = createCardMRRState(
    { ...configs[0], useSpeedAdjust: 1 },
    settings[0],
  );
  updateCardMRR(state, {
    threeQuaternion: [0, 0, 0, 1],
    deltaTime: 1 / 60,
  });
  const result = updateCardMRR(state, {
    threeQuaternion: tiltedQuaternion(30),
    deltaTime: 1 / 60,
  });
  assert.ok(result.adjustedAnimSpeed >= configs[0].minAnimSpeed);
  assert.ok(result.adjustedAnimSpeed <= configs[0].maxAnimSpeed);
  assert.equal(
    state.elapsedAnimationTime,
    Math.fround(Math.fround(1 / 60) * result.adjustedAnimSpeed),
  );
});

test("one CardMRRObject state is shared and advanced once across five shader roles", () => {
  const scene = scenes[0];
  const ctx = sharedContext(scene);
  const cases = [
    ["main", "Flash", dynamic([
      ["_ChangeColor"],
      ["_LightColorIntensity"],
      ["_LightEmitIntensity"],
      ["_LightPower"],
    ])],
    ["main", "Frame-Holo-2Layer", dynamic([
      ["_Layer2UVTranslate", "vec2"],
      ["_Layer2ColorPower"],
      ["_Layer2EmissiveIntensity"],
    ])],
    ["effect", "Effect_Emit", dynamic([
      ["_Switch"],
      ["_AdditiveIntensity"],
      ["_Color3Blend"],
      ["_EmissiveIntensity"],
    ])],
    ["flash", "Card_Parallax_Flash", dynamic([
      ["_FlashIntensity"],
      ["_RadialScaling"],
      ["_RadialAnim"],
    ])],
  ];
  const materials = cases.map(([role, shader, uniforms]) =>
    buildExactRuntimeMaterial(fixture(scene, role, shader, uniforms), ctx));
  assert.equal(ctx.runtimeComponentStates.size, 1);
  assert.equal(
    new Set(materials.map((material) => material.userData.cardMRRState)).size,
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
  const result = materials[0].userData.dynamicPortRuntimeAudit.cardMRR;
  assert.equal(materials[0].userData.cardMRRState.frameCount, 1);
  assert.equal(materials[0].uniforms._ChangeColor.value, result.changeColor);
  assert.deepEqual(
    materials[1].uniforms._Layer2UVTranslate.value.toArray(),
    Array.from(result.layer2UVTranslate.slice(0, 2)),
  );
  assert.equal(
    materials[2].uniforms._Color3Blend.value,
    result.effectColor3Blend,
  );
  assert.equal(
    materials[3].uniforms._RadialAnim.value,
    result.flashRadialAnim,
  );
});

test("CardMRRObject malformed settings and renderer groups fail closed", () => {
  assert.throws(
    () => validateCardMRRConfig({
      ...configs[0],
      rendererBindings: {
        ...configs[0].rendererBindings,
        flash: [],
      },
    }, settings[0]),
    /identity\/binding contract is incomplete/,
  );
  assert.throws(
    () => validateCardMRRConfig(configs[0], {
      ...settings[0],
      curves: {
        ...settings[0].curves,
        FlashIntensity: { keys: [] },
      },
    }),
    /FlashIntensity is incomplete/,
  );
});
