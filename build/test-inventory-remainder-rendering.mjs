import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  compileRuntimeMaterialDispatchIndex,
  resolveRuntimeMaterialDispatch,
} from "../public/render/runtime-dispatch-contract.js";
import { CARD_MARBLE_PRODUCER_SCHEMA } from "../public/render/card-marble.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const contract = JSON.parse(fs.readFileSync(
  path.join(ROOT, "public", "shaders", "official_program_port_contract.json"),
  "utf8",
));
const dispatchIndex = compileRuntimeMaterialDispatchIndex(contract);

const CASES = [
  {
    selectorId: "23fba2d0f26091a424cc0b5b83a45dcf03068d57a8abf2d01ac9cd2858406637",
    scene: "scene.cPK_90_000010_00_FUSHIGIDANE_R.json",
    shader: "Opaque",
    strategy: "exactRuntime",
  },
  {
    selectorId: "47c914ef7efdabdb9ee66f2512db54ba7ce752cb00d43456e15a8c4a6a5558df",
    scene: "scene.cPK_10_003420_00_PACHIRISUex_RR.json",
    shader: "Simple-Opaque",
    strategy: "frameOutline",
  },
  {
    selectorId: "55ec8b288993628c3cf7f6756f92c49b053532bad778d3f40a8e4c62f054131d",
    scene: "scene.cPK_10_007800_00_AKUZIKINGex_RR.json",
    shader: "Simple-Opaque-Hologram_Tuning",
    strategy: "sbHoloSimple",
  },
  {
    selectorId: "a9ecd9600fcbad72d48f2a364c224375e92811abd07d0d0b7e11c8e702dee08f",
    scene: "scene.cPK_10_012330_00_MEGAABSOLex_RR.json",
    shader: "Frame-Holo-2Layer",
    strategy: "exactRuntime",
  },
  {
    selectorId: "4eddbe42b3aad7a33c0087927e44803a97149e772bbec502e662d535be411cf9",
    scene: "scene.cPK_10_018340_00_MIRAIDONex_RR.json",
    shader: "Card_Parallax",
    strategy: "depthParallax",
  },
  {
    selectorId: "1fdbe0eb8d0712cfb7195e524947b1b4936f99b22ea26be1074f182fc3e52bf6",
    scene: "scene.cPK_20_007480_00_MASSIVOONex_SR.json",
    shader: "Card_Parallax_Marble",
    strategy: "exactRuntime",
  },
  {
    selectorId: "46d3045fc119dd373c8a35dad147987c6e5c91816a44807ede65ad025011dcc2",
    scene: "scene.cPK_20_007800_00_AKUZIKINGex_SR.json",
    shader: "Card_Parallax_Marble",
    strategy: "exactRuntime",
  },
  {
    selectorId: "6b15110734185fce59434bc48692e2daa7801971bf0065926698b465b50c1977",
    scene: "scene.cPK_20_015120_00_MASQUERNYAex_SR.json",
    shader: "Card_Parallax",
    strategy: "depthParallax",
  },
  {
    selectorId: "cad05315c5090f5875de36d0ecb30eb5e7976e4ef960ad4d388fe3b8c8267d7d",
    scene: "scene.cPK_20_018280_00_TETSUNOTSUTSUMIex_SR.json",
    shader: "Card_Parallax_Future",
    strategy: "exactRuntime",
  },
  {
    selectorId: "f972087746bf2b351267b5816d259f913b2fb9fa050ad41e11979f4cdcbea51e",
    scene: "scene.cPK_20_018410_00_HABATAKUKAMIex_SR.json",
    shader: "Card_Parallax_Strata",
    strategy: "exactRuntime",
  },
  {
    selectorId: "bcb60b22bef8badefd443c779615ba8418fbf9be6d959747838cb91b1f825ec5",
    scene: "scene.cTR_10_000100_01_HIMITSUNOKOHAKU_C.json",
    shader: "Frame-Holo",
    strategy: "exactRuntime",
  },
];

function findSceneCase(row) {
  const scene = JSON.parse(fs.readFileSync(path.join(ROOT, "public", row.scene), "utf8"));
  const matches = Object.entries(scene.materials || {}).filter(([, recipe]) => {
    const dispatch = resolveRuntimeMaterialDispatch(dispatchIndex, recipe);
    return dispatch?.officialPorts.some((port) => port.selectorId === row.selectorId);
  });
  assert.equal(matches.length >= 1, true, `${row.scene}: selector is absent`);
  return matches[0];
}

test("minimum remainder corpus closes every non-engine selector with an official port", () => {
  assert.equal(new Set(CASES.map((row) => row.selectorId)).size, 11);
  for (const row of CASES) {
    const formal = contract.ports.filter((port) => port.selectorId === row.selectorId);
    assert.equal(formal.length, 1, `${row.selectorId}: formal port count`);
    const manifestPath = path.join(ROOT, ...formal[0].manifest.split("/"));
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    assert.equal(manifest.official_selector.selectorId, row.selectorId);
    assert.equal(
      manifest.official_selector.candidateWitnessId,
      formal[0].candidateWitnessId,
      `${row.selectorId}: candidate witness`,
    );

    const [materialName, recipe] = findSceneCase(row);
    const dispatch = resolveRuntimeMaterialDispatch(dispatchIndex, recipe);
    assert.equal(recipe.shader, row.shader, `${row.scene}:${materialName}: shader`);
    assert.equal(dispatch.support, "implemented", `${row.scene}:${materialName}: support`);
    assert.equal(dispatch.strategy, row.strategy, `${row.scene}:${materialName}: strategy`);
  }
});

test("stateful remainder producers expose their current evidence boundary", () => {
  const manifestBySelector = new Map(contract.ports.map((port) => [
    port.selectorId,
    JSON.parse(fs.readFileSync(path.join(ROOT, ...port.manifest.split("/")), "utf8")),
  ]));
  const future = manifestBySelector.get(CASES[8].selectorId);
  assert.equal(
    future.runtime_contract.dynamic_uniforms._AnimFrame.source,
    "pocket-card-render/card-future-object-arm64-port@1",
  );
  assert.equal(future.runtime_boundaries[0].status, "runtime-required");
  const strata = manifestBySelector.get(CASES[9].selectorId);
  assert.equal(strata.runtime_contract.dynamic_uniforms._Shake.type, "vec2");
  assert.equal(strata.runtime_contract.dynamic_uniforms._StrataFaults.type, "float[6]");
  assert.equal(
    strata.runtime_contract.dynamic_uniforms._StrataFaults.source,
    "pocket-card-render/card-ancient-object-arm64-state-port@1",
  );
  assert.equal(strata.runtime_boundaries[0].status, "runtime-required");
  for (const row of [CASES[5], CASES[6]]) {
    const marble = manifestBySelector.get(row.selectorId);
    assert.equal(marble.runtime_contract.shader_key, "Card_Parallax_Marble");
    assert.equal(marble.runtime_contract.dynamic_uniforms._Attributes.type, "vec4[4]");
    assert.equal(
      marble.runtime_contract.dynamic_uniforms._Attributes.source,
      CARD_MARBLE_PRODUCER_SCHEMA,
    );
    const dynamicSampler = Object.values(marble.runtime_contract.dynamic_uniforms)
      .find((spec) => spec.type === "sampler2D");
    assert.equal(
      dynamicSampler?.source,
      CARD_MARBLE_PRODUCER_SCHEMA,
    );
    assert.equal(marble.runtime_boundaries[0].producer, CARD_MARBLE_PRODUCER_SCHEMA);
    assert.equal(marble.runtime_boundaries[0].status, "partial-exact");
  }
});
