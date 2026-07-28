import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  compileRuntimeMaterialDispatchIndex,
  resolveRuntimeMaterialDispatch,
  RUNTIME_MATERIAL_DISPATCH_SCHEMA,
} from "../public/render/runtime-dispatch-contract.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONTRACT_PATH = path.join(ROOT, "public", "shaders", "official_program_port_contract.json");

function contract() {
  return JSON.parse(fs.readFileSync(CONTRACT_PATH, "utf8"));
}

test("official selector inventory compiles into one strict runtime dispatch index", () => {
  const index = compileRuntimeMaterialDispatchIndex(contract());
  assert.equal(index.schema, RUNTIME_MATERIAL_DISPATCH_SCHEMA);
  assert.equal(index.routeCount, 80);
});

test("every material in the canonical scene corpus resolves by official identity and keywords", () => {
  const index = compileRuntimeMaterialDispatchIndex(contract());
  const sceneFiles = fs.readdirSync(path.join(ROOT, "public"))
    .filter((name) => /^scene\..+\.json$/.test(name))
    .sort();
  assert.equal(sceneFiles.length, 123);
  let materials = 0;
  let implemented = 0;
  let deferred = 0;
  for (const file of sceneFiles) {
    const scene = JSON.parse(fs.readFileSync(path.join(ROOT, "public", file), "utf8"));
    for (const [materialName, recipe] of Object.entries(scene.materials || {})) {
      const dispatch = resolveRuntimeMaterialDispatch(index, recipe);
      assert.ok(dispatch, `${file}:${materialName} did not resolve an official selector route`);
      assert.equal(dispatch.officialPorts.length >= 1, true, `${file}:${materialName} has no port identity`);
      materials += 1;
      if (dispatch.support === "implemented") implemented += 1;
      else deferred += 1;
    }
  }
  assert.equal(materials > 0, true);
  assert.equal(implemented > 0, true);
  assert.equal(deferred, 0, "all inventory routes now have an explicit implementation strategy");
});

test("runtime dispatch rejects schema drift, duplicate identities and sibling behavior drift", () => {
  const source = contract();
  const unknownRoute = structuredClone(source);
  unknownRoute.runtimeDispatch.routes[0].shaderName = "parallel-name-key";
  assert.throws(
    () => compileRuntimeMaterialDispatchIndex(unknownRoute),
    /unknown field shaderName/,
  );

  const unknown = structuredClone(source);
  unknown.runtimeDispatch.routes[0].dispatch.confidence = "high";
  assert.throws(
    () => compileRuntimeMaterialDispatchIndex(unknown),
    /unknown field confidence/,
  );

  const duplicate = structuredClone(source);
  duplicate.runtimeDispatch.routes.push(structuredClone(duplicate.runtimeDispatch.routes[0]));
  assert.throws(
    () => compileRuntimeMaterialDispatchIndex(duplicate),
    /duplicate port identity/,
  );

  const ordered = source.runtimeDispatch.routes
    .filter((row) => row.selectionMode === "ordered-multipass-structure");
  assert.equal(ordered.length, 4);
  const drift = structuredClone(source);
  const sibling = drift.runtimeDispatch.routes.find((row) => (
    row.selectorId === ordered[0].selectorId && row.pass !== ordered[0].pass
  ));
  sibling.dispatch.strategy = "wrongStrategy";
  assert.throws(
    () => compileRuntimeMaterialDispatchIndex(drift),
    /different behavior to sibling official passes/,
  );

  const badSelection = structuredClone(source);
  badSelection.runtimeDispatch.routes[0].selectionMode = "guess-first";
  assert.throws(
    () => compileRuntimeMaterialDispatchIndex(badSelection),
    /incomplete selector\/pass identity/,
  );

  const missingFormalRoute = structuredClone(source);
  const formalKey = missingFormalRoute.ports[0];
  missingFormalRoute.runtimeDispatch.routes = missingFormalRoute.runtimeDispatch.routes
    .filter((row) => !(
      row.selectorId === formalKey.selectorId
      && row.candidateWitnessId === formalKey.candidateWitnessId
      && row.subshader === formalKey.subshader
      && row.pass === formalKey.pass
    ));
  assert.throws(
    () => compileRuntimeMaterialDispatchIndex(missingFormalRoute),
    /formal ports\[0\] has no matching runtime dispatch route/,
  );
});

test("runtime dispatch fails closed for mutated scene identity and keyword state", () => {
  const index = compileRuntimeMaterialDispatchIndex(contract());
  const scene = JSON.parse(fs.readFileSync(
    path.join(ROOT, "public", "scene.cPK_10_000040_00_FUSHIGIBANAex_RR.json"),
    "utf8",
  ));
  const recipe = Object.values(scene.materials)[0];
  assert.ok(resolveRuntimeMaterialDispatch(index, recipe));
  const wrongShader = structuredClone(recipe);
  wrongShader.official.shader = "CAB-not-official:1";
  assert.equal(resolveRuntimeMaterialDispatch(index, wrongShader), null);
  const wrongKeywords = structuredClone(recipe);
  wrongKeywords.official.validKeywords = ["_NOT_AN_OFFICIAL_ROUTE"];
  assert.equal(resolveRuntimeMaterialDispatch(index, wrongKeywords), null);
});
