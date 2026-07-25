#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createKiraPuyoState,
  evaluateKiraPuyoCurve,
  updateKiraPuyo,
} from "../public/render/kira-puyo.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCENE = path.join(ROOT, "public", "scene.cPK_20_000010_01_FUSHIGIDANE_S.json");
const scene = JSON.parse(fs.readFileSync(SCENE, "utf8"));

const floatBuffer = new ArrayBuffer(4);
const floatView = new DataView(floatBuffer);
function floatFromHex(hex) {
  floatView.setUint32(0, Number.parseInt(hex, 16), true);
  return floatView.getFloat32(0, true);
}
function floatHex(value) {
  floatView.setFloat32(0, Math.fround(value), true);
  return floatView.getUint32(0, true).toString(16).padStart(8, "0");
}

assert.equal(scene.officialDrawSchemaVersion, 2);
const settings = scene.runtimeSettings?.kiraPuyo || {};
const draws = scene.officialDraws.filter((draw) => draw.rendererProperties?.kiraPuyo);
assert.equal(Object.keys(settings).length, 3, "official S prefab should resolve three KiraPuyo settings objects");
assert.equal(draws.length, 16, "official S prefab should expose all 16 KiraPuyo renderer components");
assert.equal(new Set(draws.map((draw) => draw.goPath)).size, draws.length);
assert.equal(new Set(draws.map((draw) => draw.rendererProperties.kiraPuyo.componentIdentity)).size, draws.length);

for (const draw of draws) {
  const component = draw.rendererProperties.kiraPuyo;
  const setting = settings[component.settingsIdentity];
  assert.ok(setting, `${draw.goPath}: unresolved KiraPuyo settings identity`);
  assert.match(draw.goPath, /^cPK_20_000010_01_FUSHIGIDANE_S_L\//);
  assert.equal(draw.meshName, "kirapuyo");
  assert.equal(component.rampRepeat, Math.fround(component.rampRepeat));
  assert.equal(component.scrollScale, Math.fround(component.scrollScale));
  assert.equal(component.scrollOffset, Math.fround(component.scrollOffset));
  assert.equal(component.vertScaleSpeed, Math.fround(component.vertScaleSpeed));
  assert.equal(component.scaleAnimationOffset, Math.fround(component.scaleAnimationOffset));
  assert.equal(evaluateKiraPuyoCurve(setting.curve, setting.curve.keys[0].time), Math.fround(setting.curve.keys[0].value));
  assert.equal(evaluateKiraPuyoCurve(setting.curve, setting.curve.keys.at(-1).time), Math.fround(setting.curve.keys.at(-1).value));
  for (const key of setting.curve.keys) assert.ok(Number.isFinite(evaluateKiraPuyoCurve(setting.curve, key.time)));
}

const normalSettings = settings["CAB-b870299d1f9f58958b3ac75a38ef912c:5883008121634607841"];
assert.equal(
  floatHex(evaluateKiraPuyoCurve(normalSettings.curve, floatFromHex("3e037c83"))),
  "3f053487",
  "negative-discriminant Cardano branch must match the official ARM64 result",
);

const first = draws.find((draw) => draw.go === "A_150");
assert.ok(first);
const firstComponent = first.rendererProperties.kiraPuyo;
const firstSettings = settings[firstComponent.settingsIdentity];
const neutral = createKiraPuyoState(firstComponent, firstSettings);
const neutralValues = updateKiraPuyo(neutral, [0, 0, -1]);
assert.equal(neutralValues.anim, Math.fround(0.5));
assert.equal(neutralValues.kiraScale, Math.fround(firstSettings.curve.keys[0].value));
assert.equal(neutralValues.rampRepeat, firstComponent.rampRepeat);
assert.equal(neutralValues.scrollScale, firstComponent.scrollScale);
assert.equal(neutralValues.scrollOffset, firstComponent.scrollOffset);

const phaseShifted = draws.find((draw) => draw.go === "B_50");
assert.ok(phaseShifted);
const shiftedComponent = phaseShifted.rendererProperties.kiraPuyo;
const shiftedSettings = settings[shiftedComponent.settingsIdentity];
const shiftedValues = updateKiraPuyo(createKiraPuyoState(shiftedComponent, shiftedSettings), [0, 0, -1]);
assert.equal(shiftedValues.anim, Math.fround(0.5));
assert.ok(Math.abs(shiftedValues.kiraScale - Math.fround(0.8)) < 1e-6);

assert.throws(() => evaluateKiraPuyoCurve({ keys: [] }, 0.5), /at least two keys/);
const mutated = structuredClone(firstSettings.curve);
mutated.keys[0].outWeight = Number.NaN;
assert.throws(() => evaluateKiraPuyoCurve(mutated, 0.5), /outWeight is invalid/);
assert.throws(() => updateKiraPuyo(neutral, [0, Number.NaN, -1]), /transformed LocalFront/);

console.log("KiraPuyo renderer/curve contract tests OK: 16 components, 3 official settings, Cardano regression");
