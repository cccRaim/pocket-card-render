import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  compileRuntimeMaterialDispatchIndex,
  resolveRuntimeMaterialDispatch,
} from "../public/render/runtime-dispatch-contract.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SELECTOR_ID = "23fba2d0f26091a424cc0b5b83a45dcf03068d57a8abf2d01ac9cd2858406637";
const CANDIDATE_WITNESS_ID =
  "e65443ac76083cec5397404a522f5a9f5f0a975b0a22ecd3306aa05d7b368ceb";
const SCENES = [
  "scene.cPK_90_000010_00_FUSHIGIDANE_R.json",
  "scene.cPK_90_007290_00_NECROZMATASOGARENOTATEGAMI_R.json",
  "scene.cPK_90_018880_00_ZYGARDEPERFECTFORMEex_RR.json",
];

const contract = JSON.parse(fs.readFileSync(
  path.join(ROOT, "public", "shaders", "official_program_port_contract.json"),
  "utf8",
));
const dispatchIndex = compileRuntimeMaterialDispatchIndex(contract);

test("Logo/Opaque is a selector-bound exact runtime port with its own pass state", () => {
  const ports = contract.ports.filter((port) => port.selectorId === SELECTOR_ID);
  assert.equal(ports.length, 1);
  assert.equal(ports[0].candidateWitnessId, CANDIDATE_WITNESS_ID);
  assert.equal(ports[0].manifest, "public/shaders/logo_opaque_uniforms.json");

  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, ports[0].manifest), "utf8"));
  assert.equal(manifest.shader, "Lettuce/Common/CardNew/Logo/Opaque");
  assert.equal(manifest.runtime_contract.shader_key, "Opaque");
  assert.deepEqual(manifest.sampler_slots, ["_MainTex"]);
  assert.deepEqual(manifest.official_pass_runtime.depth, {
    test: { val: 0, name: "_ZTest" },
    write: { val: 0, name: "_ZWrite" },
  });
  assert.deepEqual(manifest.official_pass_runtime.culling, { val: 2, name: null });
  assert.equal(manifest.official_pass_runtime.blend.src_rgb.val, 1);
  assert.equal(manifest.official_pass_runtime.blend.dst_rgb.val, 0);
});

test("all canonical cPK_90 logo draws use official identity and serialized depth overrides", () => {
  let draws = 0;
  for (const file of SCENES) {
    const scene = JSON.parse(fs.readFileSync(path.join(ROOT, "public", file), "utf8"));
    const matches = Object.entries(scene.materials || {})
      .filter(([, recipe]) => recipe.shader === "Opaque");
    assert.equal(matches.length, 1, `${file}: Logo/Opaque draw count`);
    for (const [materialName, recipe] of matches) {
      const dispatch = resolveRuntimeMaterialDispatch(dispatchIndex, recipe);
      assert.ok(dispatch, `${file}:${materialName}: dispatch`);
      assert.equal(dispatch.support, "implemented");
      assert.equal(dispatch.strategy, "exactRuntime");
      assert.equal(dispatch.shaderKey, "Opaque");
      assert.deepEqual(recipe.official.validKeywords, []);
      assert.equal(recipe.official.shader, "CAB-596cc0831b33693ae475c2f8be0b7768:-7670412818071714871");
      assert.deepEqual(Object.keys(recipe.textures), ["_MainTex"]);
      assert.equal(recipe.floats._ZTest, 0);
      assert.equal(recipe.floats._ZWrite, 0);
      assert.equal(
        dispatch.officialPorts.some((port) => (
          port.selectorId === SELECTOR_ID
          && port.candidateWitnessId === CANDIDATE_WITNESS_ID
        )),
        true,
      );
      draws += 1;
    }
  }
  assert.equal(draws, 3);
});
