import test from "node:test";
import assert from "node:assert/strict";
import { Quaternion, Euler } from "three";
import {
  computeCardRgbColor,
  computeCardRgbUniforms,
  createUvShadowState,
  updateUvShadow,
} from "../public/render/card-parameters.js";

test("RGB reference preserves its published float32 coefficients, including nonstandard white L", () => {
  assert.deepEqual([...computeCardRgbColor([0, 0, 0])], [0, 0, 0]);
  const white = computeCardRgbColor([1, 1, 1]);
  assert.deepEqual([...white], [1.0081335306167603, .000008255243301391602, -.0001175999641418457]);
  const red = computeCardRgbColor([1, 0, 0]);
  assert(red[0] > .6 && red[0] < .7 && red[1] > .2 && red[2] > .1);
  assert.throws(() => computeCardRgbColor([1, NaN, 0]), /finite/);
});

test("RGB uniforms resolve Material colors before Shader defaults and reject missing values", () => {
  const result = computeCardRgbUniforms({
    colors: { _AreaAColor: { r: 1, g: 0, b: 0, a: 1 } },
    defaults: { _AreaAColor: [0, 1, 0, 1], _UIColorG: [1, 1, 1, 1] },
    uniforms: ["_AreaAColorOklab", "_UIColorGOklab"],
  });
  assert.deepEqual(result._AreaAColorOklab, computeCardRgbColor([1, 0, 0]));
  assert.deepEqual(result._UIColorGOklab, computeCardRgbColor([1, 1, 1]));
  assert.throws(() => computeCardRgbUniforms({ uniforms: ["_AreaBColorOklab"] }), /finite/);
  assert.throws(() => computeCardRgbUniforms({ uniforms: ["_UnknownOklab"] }), /unsupported/);
});

test("UV shadow projects light into the card plane before applying local offset", () => {
  const state = createUvShadowState({ lightDir: [-3, 0, -4], translateOffset: [.1, -.2] });
  const value = updateUvShadow(state, [0, 0, 0, 1]);
  assert(Math.abs(value[0] - .7) < 1e-6);
  assert.equal(value[1], Math.fround(-.2));
  const zero = createUvShadowState({ lightDir: [0, 0, 0], translateOffset: [.1, -.2] });
  assert.deepEqual([...updateUvShadow(zero, [0, 0, 0, 1])], [...zero.translateOffset]);
});

test("UV shadow supports component rotation and gives repeatable finite tilted values", () => {
  const state = createUvShadowState({ lightDir: [0, 1, -1], translateOffset: [0, 0], localRotation: new Quaternion().setFromEuler(new Euler(.2, -.3, .1)).toArray() });
  const pose = new Quaternion().setFromEuler(new Euler(-.3, .4, -.1)).toArray();
  const first = [...updateUvShadow(state, pose)];
  assert(first.every(Number.isFinite));
  assert.deepEqual([...updateUvShadow(state, pose)], first);
  assert.throws(() => createUvShadowState({ lightDir: [0, 1], translateOffset: [0, 0] }), /finite/);
  assert.throws(() => updateUvShadow(state, [0, 0, NaN, 1]), /finite/);
});
