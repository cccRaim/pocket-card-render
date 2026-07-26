import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  collectGameAssetUrls,
  gameAssetRelativePath,
  sceneExampleAvailability,
} from "./scene-example-availability.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC = path.join(ROOT, "public");
const scenes = fs.readdirSync(PUBLIC)
  .filter((name) => /^scene\..+\.json$/i.test(name))
  .sort();
const examples = JSON.parse(
  fs.readFileSync(path.join(PUBLIC, "card-examples.json"), "utf8"),
);
const expectedSceneCount =
  examples.summary.bundledSelectedCount
  + examples.summary.bundledSupplementalCount;
assert.equal(scenes.length, expectedSceneCount);

for (const sceneFile of scenes) {
  const scene = JSON.parse(fs.readFileSync(path.join(PUBLIC, sceneFile), "utf8"));
  const availability = await sceneExampleAvailability(scene, PUBLIC);
  assert.equal(availability.status, "prebuilt");
  assert.equal(availability.selectable, true);
  assert(availability.referencedAssetCount > 0);
  assert.equal(availability.missingAssetCount, 0);
  assert.equal(availability.declaredMissingCount, 0);

  const missingAsset = structuredClone(scene);
  missingAsset.prefabGlb = "/game/__missing_example_asset__.glb";
  const missingResult = await sceneExampleAvailability(missingAsset, PUBLIC);
  assert.equal(missingResult.status, "unavailable");
  assert.equal(missingResult.selectable, false);
  assert.deepEqual(missingResult.reasonCodes, ["gathered-assets-missing"]);

  const declaredMissing = structuredClone(scene);
  declaredMissing._missing = ["official-texture"];
  const declaredResult = await sceneExampleAvailability(declaredMissing, PUBLIC);
  assert.equal(declaredResult.status, "unavailable");
  assert.equal(declaredResult.selectable, false);
  assert.deepEqual(declaredResult.reasonCodes, ["scene-declared-missing"]);

  const absentContract = structuredClone(scene);
  delete absentContract._missing;
  const absentResult = await sceneExampleAvailability(absentContract, PUBLIC);
  assert.equal(absentResult.status, "unavailable");
  assert.equal(absentResult.declaredMissingCount, 1);
}

assert.deepEqual(
  [...collectGameAssetUrls({
    a: "/game/a.png",
    b: ["/game/b.glb", "/render/not-game.json", "/game/a.png"],
  })].sort(),
  ["/game/a.png", "/game/b.glb"],
);
assert.equal(
  gameAssetRelativePath("/game/Mask/link_mask_100%25.png"),
  "Mask/link_mask_100%.png",
);
assert.equal(
  gameAssetRelativePath("/game/Mask/link_mask_100%.png"),
  "Mask/link_mask_100%.png",
);

console.log("Card example availability mutation tests OK");
console.log(`  ${scenes.length} prebuilt scenes are asset-closed`);
