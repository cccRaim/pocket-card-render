import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import {
  CARD_MARBLE_PRODUCER_SCHEMA,
  createCardMarbleCurveSamples,
  createCardMarbleState,
  updateCardMarble,
  validateCardMarbleConfig,
} from "../public/render/card-marble.js";
import { buildExactRuntimeMaterial } from "../public/render/materials/exact-runtime.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCENE_FILES = [
  "scene.cPK_20_007480_00_MASSIVOONex_SR.json",
  "scene.cPK_20_007800_00_AKUZIKINGex_SR.json",
];
const scenes = SCENE_FILES.map((name) => JSON.parse(fs.readFileSync(
  path.join(ROOT, "public", name),
  "utf8",
)));
const configs = scenes.map((scene) => Object.values(
  scene.runtimeSettings.cardMarble,
)[0]);

function tiltedQuaternion(axis, degrees = 30) {
  const half = degrees * Math.PI / 360;
  const sine = Math.sin(half);
  const cosine = Math.cos(half);
  return axis === "x"
    ? [sine, 0, 0, cosine]
    : [0, sine, 0, cosine];
}

function marbleRecipe(scene) {
  const [materialName, material] = Object.entries(scene.materials)
    .find(([, recipe]) => recipe.shader === "Card_Parallax_Marble");
  const draw = scene.officialDraws.find((item) => item.materialName === materialName);
  assert.ok(draw?.rendererProperties?.cardMarble);
  return {
    ...material,
    rendererProperties: draw.rendererProperties,
    runtimeDispatch: { shaderKey: "Card_Parallax_Marble" },
  };
}

function materialFixture(scene) {
  const recipe = marbleRecipe(scene);
  const dynamicPortMats = [];
  const runtimeComponentStates = new Map();
  const runtimeComponentTextures = new Map();
  const dynamicUniforms = {
    _Attributes: { type: "vec4[4]", source: CARD_MARBLE_PRODUCER_SCHEMA },
    _DefaultNoiseRemapCurveTexture: {
      type: "sampler2D",
      source: CARD_MARBLE_PRODUCER_SCHEMA,
    },
    _Front: { type: "vec2", source: CARD_MARBLE_PRODUCER_SCHEMA },
    _PointCount: { type: "int", source: CARD_MARBLE_PRODUCER_SCHEMA },
    _Tilt: { type: "float", source: CARD_MARBLE_PRODUCER_SCHEMA },
    _TiltRotation: { type: "float", source: CARD_MARBLE_PRODUCER_SCHEMA },
    _WorldFront: { type: "vec3", source: CARD_MARBLE_PRODUCER_SCHEMA },
  };
  const manifest = {
    official_pass_runtime: {},
    official_selector: { selectorId: "marble-selector" },
    official_executable_identity: { semanticExecutableId: "marble-executable" },
    runtime_contract: { dynamic_uniforms: dynamicUniforms },
  };
  const ctx = {
    dynamicPortMats,
    runtimeSettings: scene.runtimeSettings,
    runtimeComponentStates,
    runtimeComponentTextures,
    exactShaderPort: () => ({
      vert: `#version 300 es
in vec3 position;
void main() { gl_Position = vec4(position, 1.0); }
`,
      frag: `#version 300 es
precision highp float;
layout(location = 0) out vec4 pc_fragColor;
void main() { pc_fragColor = vec4(1.0); }
`,
      manifest,
    }),
    exactPortUniforms: () => ({}),
    layerCubeDefault: () => null,
    layerTexDefault: () => null,
  };
  return { recipe, ctx };
}

test("CardMarbleLayer scenes retain both official component configurations", () => {
  assert.deepEqual(
    configs.map((config) => config.componentIdentity),
    [
      "CAB-1ed23675c1ceb1daae810e7848156956:283780890072378615",
      "CAB-f2c0424503d777f9a434ad066b5a8235:-8314688116202635352",
    ],
  );
  assert.deepEqual(configs.map((config) => config.points.length), [4, 4]);
  assert.deepEqual(configs.map((config) => config.defaultNoiseRemapSettings.resolution), [7, 7]);
  for (const [scene, config] of scenes.map((scene, index) => [scene, configs[index]])) {
    const recipe = marbleRecipe(scene);
    assert.equal(recipe.rendererProperties.cardMarble.componentIdentity, config.componentIdentity);
    assert.equal(
      recipe.rendererProperties.cardMarble.rendererIdentity,
      config.rendererBindings[0],
    );
    assert.equal(validateCardMarbleConfig(config).componentIdentity, config.componentIdentity);
  }
});

test("CardMarbleLayer curve texture sampling is deterministic and finite", () => {
  const samples = configs.map(createCardMarbleCurveSamples);
  assert.deepEqual(samples.map(({ size }) => size), [128, 128]);
  assert.equal(samples.every(({ values }) =>
    values.length === 128 * 128 && values.every(Number.isFinite)), true);
  assert.deepEqual(
    samples.map(({ values }) => [
      values[0],
      values[63],
      values[127],
      values[127 * 128],
      values.at(-1),
    ]),
    [
      [0.22974318265914917, 1, 1, 0.003921151161193848, 1],
      [0.22974318265914917, 1, 1, 0.003921151161193848, 1],
    ],
  );
});

test("CardMarbleLayer starts from serialized point defaults at the identity pose", () => {
  for (const config of configs) {
    const state = createCardMarbleState(config);
    const result = updateCardMarble(state, {
      threeQuaternion: [0, 0, 0, 1],
      deltaTime: 1 / 60,
    });
    assert.equal(state.schema, CARD_MARBLE_PRODUCER_SCHEMA);
    assert.equal(result.pointCount, 4);
    assert.equal(result.tilt, 0);
    assert.deepEqual(result.worldFront, [0, 0, -1]);
    for (let index = 0; index < config.points.length; index += 1) {
      assert.deepEqual(
        Array.from(result.attributes.slice(index * 4, index * 4 + 4)),
        [
          config.points[index].defaultPosition.x,
          config.points[index].defaultPosition.y,
          config.points[index].defaultForce,
          0,
        ],
      );
    }
  }
});

test("CardMarbleLayer tilt drives deterministic finite spring motion", () => {
  const results = configs.map((config) => {
    const state = createCardMarbleState(config);
    let result;
    for (let frame = 0; frame < 180; frame += 1) {
      result = updateCardMarble(state, {
        threeQuaternion: tiltedQuaternion("y"),
        deltaTime: 1 / 60,
      });
    }
    return result;
  });
  for (const result of results) {
    assert.equal(result.attributes.every(Number.isFinite), true);
    assert.equal(result.front.every(Number.isFinite), true);
    assert.ok(result.tilt > 0);
    assert.equal(result.frameCount, 180);
  }
  assert.notDeepEqual(
    Array.from(results[0].attributes),
    Array.from(results[1].attributes),
  );
});

test("one official CardMarbleLayer component shares state and curve texture across materials", () => {
  const { recipe, ctx } = materialFixture(scenes[0]);
  const first = buildExactRuntimeMaterial(recipe, ctx);
  const second = buildExactRuntimeMaterial(recipe, ctx);
  assert.equal(first.userData.cardMarbleState, second.userData.cardMarbleState);
  assert.equal(
    first.userData.cardMarbleCurveTexture,
    second.userData.cardMarbleCurveTexture,
  );
  assert.equal(ctx.runtimeComponentStates.size, 1);
  assert.equal(ctx.runtimeComponentTextures.size, 1);
  const texture = first.userData.cardMarbleCurveTexture;
  assert.equal(texture instanceof THREE.DataTexture, true);
  assert.equal(texture.image.width, 128);
  assert.equal(texture.image.height, 128);
  assert.equal(texture.format, THREE.RedFormat);
  assert.equal(texture.type, THREE.FloatType);
  assert.equal(texture.userData.backendAdaptation, "Unity R16 linear Texture2D -> WebGL R32F");
});

test("CardMarbleLayer malformed identity and curve contracts fail closed", () => {
  assert.throws(
    () => validateCardMarbleConfig({ ...configs[0], rendererBindings: [] }),
    /identity\/binding contract is incomplete/,
  );
  assert.throws(
    () => validateCardMarbleConfig({
      ...configs[0],
      defaultNoiseRemapSettings: {
        ...configs[0].defaultNoiseRemapSettings,
        defaultRemapCurve: { keys: [] },
      },
    }),
    /defaultRemapCurve is incomplete/,
  );
});
