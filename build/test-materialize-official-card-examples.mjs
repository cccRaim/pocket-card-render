import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildMaterializationPlan,
} from "./materialize-official-card-examples.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(
  fs.readFileSync(path.join(ROOT, "public", "card-examples.json"), "utf8"),
);
const fakeRoot = path.join("X:", "official");
const allPresent = () => true;
const plan = buildMaterializationPlan({
  manifest,
  decryptedRoot: path.join(fakeRoot, "decrypted"),
  recipeRoot: path.join(fakeRoot, "recipes"),
  publicRoot: path.join(fakeRoot, "public"),
  gameSourceRoot: path.join(fakeRoot, "assets"),
  exists: allPresent,
});

assert.equal(plan.length, 117);
assert.equal(new Set(plan.map((row) => row.illustrationId)).size, plan.length);
assert(plan.every((row) => row.faceAvailable));
assert(plan.every((row) => row.recipeAvailable));
assert(plan.every((row) => row.sceneAvailable));
assert(plan.every((row) => row.prefabAvailable));
for (const row of plan) {
  assert(row.faceRoot.endsWith(
    path.join("Face", row.illustrationId, "L"),
  ));
  assert(row.recipeFile.endsWith(
    `${row.illustrationId}_render_full.json`,
  ));
  assert(row.sceneFile.endsWith(`scene.${row.illustrationId}.json`));
  assert(row.prefabGlb.endsWith(`${row.illustrationId}_L.glb`));
}

const selectedId = plan[0].illustrationId;
const selected = buildMaterializationPlan({
  manifest,
  ids: new Set([selectedId]),
  exists: () => false,
});
assert.equal(selected.length, 1);
assert.equal(selected[0].illustrationId, selectedId);
assert.equal(selected[0].recipeAvailable, false);
assert.throws(
  () => buildMaterializationPlan({
    manifest,
    ids: new Set(["cPK_not_a_minimum_witness"]),
    exists: allPresent,
  }),
  /non-witness/u,
);

console.log("Official card-example materialization plan tests OK");
console.log("  globally minimal witnesses: 112");
console.log("  additional rarity-rendering witnesses: 5");
