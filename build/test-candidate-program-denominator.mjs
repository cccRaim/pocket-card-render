#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadOfficialSample } from "./official-sample.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT_ROOT = path.resolve(
  process.env.PCR_CANDIDATE_OUTPUT_ROOT
    || path.join(
      ROOT,
      "..",
      "ptcgp-tools-master",
      "masterdata_decoder",
      ".output-full",
    ),
);
const loaded = loadOfficialSample(
  process.env.PCR_OFFICIAL_CANDIDATE_MANIFEST
    || "build/official-samples/candidate.json",
);
const sample = loaded.sample;
const stem = sample.sampleId.replace(/-candidate$/, "");
const inventory = JSON.parse(fs.readFileSync(
  path.join(OUTPUT_ROOT, "material-program-inventory-full.json"),
  "utf8",
));
const analysis = JSON.parse(fs.readFileSync(
  path.join(
    ROOT,
    "build",
    "official-samples",
    `${stem}-shader-analysis.json`,
  ),
  "utf8",
));

function routeKey(row) {
  return JSON.stringify([
    row.shaderName,
    [...(row.keywords || [])].sort(),
    row.subshader,
    row.pass,
  ]);
}

assert.equal(inventory.portIndex.length, 79);
const inventoryByRoute = new Map(
  inventory.portIndex.map((row) => [routeKey(row), row]),
);
assert.equal(inventoryByRoute.size, inventory.portIndex.length);
const formalInventory = inventory.portIndex.filter(
  (row) => row.runtimeEngineVariantBoundary !== true,
);
const runtimeInventory = inventory.portIndex.filter(
  (row) => row.runtimeEngineVariantBoundary === true,
);
assert.equal(formalInventory.length, 78);
assert.equal(runtimeInventory.length, 1);

const reusable = analysis.staticReuseValidation.filter(
  (row) => row.reuseEligible === true,
);
const rejected = analysis.staticReuseValidation.filter(
  (row) => row.reuseEligible === false,
);
assert.equal(reusable.length, 69);
assert.equal(rejected.length, 1);
const reusableRuntime = reusable.filter(
  (row) => inventoryByRoute.get(routeKey(row))?.runtimeEngineVariantBoundary,
);
const reusableFormal = reusable.filter(
  (row) => !inventoryByRoute.get(routeKey(row))?.runtimeEngineVariantBoundary,
);
assert.equal(reusableRuntime.length, 1);
assert.equal(reusableFormal.length, 68);
assert.equal(analysis.routes.length, 9);
assert.equal(analysis.routes.length + rejected.length, 10);
assert.equal(reusableFormal.length + analysis.routes.length + rejected.length, 78);

console.log("Candidate program denominator OK");
console.log("  formal:  68 reused + 10 changed/default-sensitive = 78");
console.log("  runtime: 1 engine-owned variant boundary");
