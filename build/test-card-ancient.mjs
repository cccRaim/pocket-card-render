import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  CARD_ANCIENT_PRODUCER_SCHEMA,
  cardAncientGoalFault,
  cardAncientPerlinNoise1D,
  createCardAncientState,
  updateCardAncient,
} from "../public/render/card-ancient.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scene = JSON.parse(fs.readFileSync(
  path.join(
    ROOT,
    "public",
    "scene.cPK_20_018410_00_HABATAKUKAMIex_SR.json",
  ),
  "utf8",
));
const [config] = Object.values(scene.runtimeSettings.cardAncient);
const curveSettings = scene.runtimeSettings.ancientBGAnimation[
  config.curveSettingsIdentity
];

function tiltedQuaternion(axis, degrees = 30) {
  const half = degrees * Math.PI / 360;
  const sine = Math.sin(half);
  const cosine = Math.cos(half);
  return axis === "x"
    ? [sine, 0, 0, cosine]
    : [0, sine, 0, cosine];
}

test("CardAncientObject scene contract binds one component, settings object and renderer", () => {
  assert.equal(config.componentIdentity, "CAB-2be294aa4da7bcb498eb4352d4afed3d:-6848210623870774095");
  assert.equal(config.curveSettingsIdentity, "CAB-1fb0e33dbac4335dd1d5f42e30b28d4b:6433345847792838671");
  assert.deepEqual(config.rendererBindings, [
    "CAB-2be294aa4da7bcb498eb4352d4afed3d:-620010077910969167",
  ]);
  assert.deepEqual(
    Object.fromEntries(Object.entries(curveSettings.curves)
      .map(([name, curve]) => [name, curve.keys.length])),
    {
      ZuzuA: 14,
      ZuzuB: 0,
      ZuzuC: 0,
      Zzzzz: 4,
      ZuzuGoal: 3,
      ShakeIntensity: 5,
    },
  );
});

test("CardAncientObject remains neutral at the official identity pose", () => {
  const state = createCardAncientState(config, curveSettings);
  const result = updateCardAncient(state, {
    threeQuaternion: [0, 0, 0, 1],
    deltaTime: 1 / 60,
  });
  assert.equal(state.schema, CARD_ANCIENT_PRODUCER_SCHEMA);
  assert.equal(result.goalStrataFaults, 0);
  assert.equal(Array.from(result.strataFaults).every((value) => value === 0), true);
  assert.equal(Array.from(result.shake).every((value) => value === 0), true);
});

test("CardAncientObject produces deterministic six-lane strata motion under tilt", () => {
  const first = createCardAncientState(config, curveSettings);
  const second = createCardAncientState(config, curveSettings);
  const quaternion = tiltedQuaternion("y");
  let firstResult;
  let secondResult;
  for (let frame = 0; frame < 180; frame += 1) {
    firstResult = updateCardAncient(first, {
      threeQuaternion: quaternion,
      deltaTime: 1 / 60,
    });
    secondResult = updateCardAncient(second, {
      threeQuaternion: quaternion,
      deltaTime: 1 / 60,
    });
  }
  assert.equal(firstResult.strataFaults.length, 6);
  assert.equal(firstResult.strataFaults.some((value) => value !== 0), true);
  assert.equal([...firstResult.strataFaults, ...firstResult.shake].every(Number.isFinite), true);
  assert.deepEqual(
    Array.from(firstResult.strataFaults),
    Array.from(secondResult.strataFaults),
  );
  assert.deepEqual(Array.from(firstResult.shake), Array.from(secondResult.shake));
  assert.deepEqual(firstResult.nativeBoundaries, [
    "UnityEngine.Random.Range",
    "UnityEngine.Mathf.PerlinNoise1D",
  ]);
});

test("CardAncientObject tilt goal changes sign and local noise is stable", () => {
  const positive = cardAncientGoalFault(
    tiltedQuaternion("y", 30),
    config.dot2Multiply,
  );
  const negative = cardAncientGoalFault(
    tiltedQuaternion("y", -30),
    config.dot2Multiply,
  );
  assert.equal(Math.sign(positive), -Math.sign(negative));
  const samples = [0, 0.25, 1, 4.75].map(cardAncientPerlinNoise1D);
  assert.equal(samples.every(Number.isFinite), true);
  assert.deepEqual(samples, [0.5, 0.5732421875, 0.5, 0.34912109375]);
});
