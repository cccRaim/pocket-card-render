import assert from "node:assert/strict";
import test from "node:test";
import {
  CARD_BEHAVIOUR_ROTATION_PRODUCER_SCHEMA,
  OFFICIAL_CARD_RENDERER_HOLOGRAM_ROTATION,
  resolveCardBehaviourHologramRotation,
} from "../public/render/card-behaviour-rotation.js";
import { updateMegaRuntime } from "../public/render/mega-runtime.js";

test("canonical CardRenderer profile resolves to official Vector3.zero", () => {
  assert.equal(
    CARD_BEHAVIOUR_ROTATION_PRODUCER_SCHEMA,
    "pocket-card-render/card-behaviour-hologram-rotation-arm64-port@1",
  );
  assert.deepEqual(OFFICIAL_CARD_RENDERER_HOLOGRAM_ROTATION, [0, 0, 0]);
  assert.deepEqual(resolveCardBehaviourHologramRotation(), [0, 0, 0]);
});

test("explicit CardDataGroup rotation remains a typed data input", () => {
  assert.deepEqual(
    resolveCardBehaviourHologramRotation([1.25, -2.5, 3.75]),
    [1.25, -2.5, 3.75],
  );
  assert.throws(
    () => resolveCardBehaviourHologramRotation([0, 1]),
    /exactly three/,
  );
  assert.throws(
    () => resolveCardBehaviourHologramRotation([0, Number.NaN, 0]),
    /must be finite/,
  );
});

test("runtime uploads the CardBehaviour input without tilt-derived mutation", () => {
  const uploaded = [Number.NaN, Number.NaN, Number.NaN];
  const vector = {
    isVector3: true,
    set(x, y, z) {
      uploaded.splice(0, 3, x, y, z);
    },
  };
  const material = {
    uniforms: { _Rotation: { value: vector } },
    userData: {
      exactShader: "Card_Parallax_Marble",
      dynamicPortUniforms: ["_Rotation"],
      dynamicPortUniformSpecs: {
        _Rotation: {
          type: "vec3",
          source: CARD_BEHAVIOUR_ROTATION_PRODUCER_SCHEMA,
        },
      },
      dynamicPortDefaults: { _Rotation: [9, 9, 9] },
      cardBehaviourHologramRotation: [0.5, -0.25, 0.125],
    },
  };
  updateMegaRuntime(
    [material],
    { x: 0, y: 0, z: 0, w: 1 },
    0,
    null,
    1 / 60,
  );
  assert.deepEqual(uploaded, [0.5, -0.25, 0.125]);
});
