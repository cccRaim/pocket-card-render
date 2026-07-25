import assert from "node:assert/strict";
import test from "node:test";

import {
  matchGenericRuntimeRendererDraws,
  validateOrderedRuntimePasses,
} from "./official-port-verifier-lib.mjs";

const SELECTOR = {
  selectorId: "selector-1",
  candidateWitnessId: "candidate-1",
  subshader: 0,
  pass: 0,
  shaderIdentity: "CAB-shader:1",
  keywords: [],
  programBlobIndex: 1,
  parameterBlobIndex: 0,
  executableId: "executable-1",
  semanticExecutableId: "semantic-1",
};
const CONTRACT = { shader_key: "Exact-Holo" };

function fixture() {
  const materialName = "Shared-Holo-Material";
  const scene = {
    materials: {
      [materialName]: {
        shader: CONTRACT.shader_key,
        official: { shader: SELECTOR.shaderIdentity, validKeywords: [] },
      },
    },
    officialDraws: [
      {
        drawId: "CAB-renderer:10#0",
        rendererIdentity: "CAB-renderer:10",
        goPath: "Card/EXIcon",
        materialSlot: 0,
        materialName,
        shaderIdentity: SELECTOR.shaderIdentity,
      },
      {
        drawId: "CAB-renderer:20#0",
        rendererIdentity: "CAB-renderer:20",
        goPath: "Card/EXRule",
        materialSlot: 0,
        materialName,
        shaderIdentity: SELECTOR.shaderIdentity,
      },
    ],
  };
  const draw = (officialDraw) => ({
    identity: {
      drawId: officialDraw.drawId,
      rendererIdentity: officialDraw.rendererIdentity,
      goPath: officialDraw.goPath,
      materialSlot: officialDraw.materialSlot,
      materialName,
      shader: CONTRACT.shader_key,
    },
    material: { exactShader: CONTRACT.shader_key, officialSelector: structuredClone(SELECTOR) },
  });
  return { scene, draws: scene.officialDraws.map(draw), draw };
}

function match(scene, draws) {
  return matchGenericRuntimeRendererDraws({
    scene,
    actualDraws: draws,
    contract: CONTRACT,
    expectedSelector: SELECTOR,
    key: "scene.fixture.json|zh_TW",
  });
}

test("Renderer matching preserves two draws that share one material", () => {
  const { scene, draws } = fixture();
  const result = match(scene, draws);
  assert.deepEqual(result.errors, []);
  assert.equal(result.expectedCount, 2);
  assert.equal(result.draws.length, 2);
  assert.deepEqual(result.draws.map(({ expected }) => expected.goPath).sort(), ["Card/EXIcon", "Card/EXRule"]);
});

test("dropping one Renderer with a shared material fails closed", () => {
  const { scene, draws } = fixture();
  const result = match(scene, draws.slice(0, 1));
  assert.match(result.errors.join("\n"), /missing Renderer draw/);
  assert.match(result.errors.join("\n"), /Renderer draw count mismatch \(1\/2\)/);
});

test("duplicate and extra Renderer draws are rejected", () => {
  const { scene, draws, draw } = fixture();
  const duplicate = match(scene, [draws[0], draws[0], draws[1]]);
  assert.match(duplicate.errors.join("\n"), /duplicate Renderer draw/);
  assert.match(duplicate.errors.join("\n"), /Renderer draw count mismatch \(3\/2\)/);

  const extra = match(scene, [...draws, draw({
    drawId: "CAB-renderer:30#0",
    rendererIdentity: "CAB-renderer:30",
    goPath: "Card/Extra",
    materialSlot: 0,
  })]);
  assert.match(extra.errors.join("\n"), /extra drawId CAB-renderer:30#0/);
  assert.match(extra.errors.join("\n"), /Renderer draw count mismatch \(3\/2\)/);
});

test("material and selector mutations cannot reuse a valid drawId", () => {
  const { scene, draws } = fixture();
  const wrongMaterial = structuredClone(draws);
  wrongMaterial[1].identity.materialName = "Wrong-Material";
  const materialResult = match(scene, wrongMaterial);
  assert.match(materialResult.errors.join("\n"), /materialName mismatch/);
  assert.match(materialResult.errors.join("\n"), /missing Renderer draw/);

  const wrongSelector = structuredClone(draws);
  wrongSelector[1].material.officialSelector.selectorId = "selector-mutated";
  const selectorResult = match(scene, wrongSelector);
  assert.match(selectorResult.errors.join("\n"), /missing Renderer draw/);

  const wrongPath = structuredClone(draws);
  wrongPath[1].identity.goPath = "Card/Wrong";
  const pathResult = match(scene, wrongPath);
  assert.match(pathResult.errors.join("\n"), /goPath mismatch/);
  assert.match(pathResult.errors.join("\n"), /missing Renderer draw/);
});

test("ordered sibling passes are matched independently by composite identity", () => {
  const { scene, draws } = fixture();
  const passOne = {
    ...SELECTOR,
    candidateWitnessId: "candidate-2",
    pass: 1,
    programBlobIndex: 3,
    parameterBlobIndex: 2,
    executableId: "executable-2",
    semanticExecutableId: "semantic-2",
  };
  const passOneDraws = draws.map((draw) => ({
    ...structuredClone(draw),
    material: { ...structuredClone(draw.material), officialSelector: structuredClone(passOne) },
  }));
  const allDraws = [...draws, ...passOneDraws];
  const passZeroResult = match(scene, allDraws);
  assert.deepEqual(passZeroResult.errors, []);
  assert.equal(passZeroResult.draws.length, 2);
  const passOneResult = matchGenericRuntimeRendererDraws({
    scene,
    actualDraws: allDraws,
    contract: CONTRACT,
    expectedSelector: passOne,
    key: "scene.fixture.json|zh_TW",
  });
  assert.deepEqual(passOneResult.errors, []);
  assert.equal(passOneResult.draws.length, 2);

  const mutated = structuredClone(allDraws);
  mutated[3].material.officialSelector.candidateWitnessId = "candidate-mutated";
  const rejected = matchGenericRuntimeRendererDraws({
    scene,
    actualDraws: mutated,
    contract: CONTRACT,
    expectedSelector: passOne,
    key: "scene.fixture.json|zh_TW",
  });
  assert.match(rejected.errors.join("\n"), /missing Renderer draw/);
});

test("ordered multi-pass runtime draws must be adjacent and pass-ascending per Renderer", () => {
  const passZero = { ...SELECTOR, selectionMode: "ordered-multipass-structure", pass: 0 };
  const passOne = {
    ...passZero,
    candidateWitnessId: "candidate-2",
    pass: 1,
  };
  const runtimeDraw = (drawId, ordinal, selector) => ({
    ordinal,
    identity: { drawId },
    material: { officialSelector: structuredClone(selector) },
  });
  const valid = [
    runtimeDraw("renderer-a#0", 0, passZero),
    runtimeDraw("renderer-a#0", 1, passOne),
    runtimeDraw("renderer-b#0", 2, passZero),
    runtimeDraw("renderer-b#0", 3, passOne),
  ];
  assert.deepEqual(validateOrderedRuntimePasses(valid, passZero), []);

  const reversed = structuredClone(valid);
  [reversed[0], reversed[1]] = [reversed[1], reversed[0]];
  reversed.forEach((draw, index) => { draw.ordinal = index; });
  assert.match(validateOrderedRuntimePasses(reversed, passZero).join("\n"), /ordered pass/);

  const interleaved = [valid[0], valid[2], valid[1], valid[3]];
  interleaved.forEach((draw, index) => { draw.ordinal = index; });
  assert.match(validateOrderedRuntimePasses(interleaved, passZero).join("\n"), /not adjacent/);
});
