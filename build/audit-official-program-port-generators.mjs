#!/usr/bin/env node
// Regenerate every selector-bound stage port declared by the official contract.
// This is the only valid producer of the "generators externally verified" fact.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  officialSample,
  officialSampleManifestRelative,
  officialSampleSha256,
} from "./official-sample.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONTRACT = path.join(ROOT, "public", "shaders", "official_program_port_contract.json");
const JSON_MODE = process.argv.includes("--json");
const LOCAL_DECODER_ROOT = path.resolve(
  process.env.PCR_LOCAL_DECODER_ROOT
    || path.join(ROOT, "..", "ptcgp-tools-master", "masterdata_decoder"),
);
const DECRYPTED_ROOT = path.resolve(
  process.env.PCR_DECRYPTED_ROOT
    || path.join(
      LOCAL_DECODER_ROOT,
      ".output-full",
      "samples",
      officialSample.sampleId,
      "decrypted",
    ),
);
const SHADER_ROOT = path.resolve(
  process.env.PCR_SHADERS || path.join(DECRYPTED_ROOT, "Common", "Shader"),
);
const PROGRAM_INVENTORY = path.resolve(
  process.env.PCR_PROGRAM_INVENTORY
    || path.join(path.dirname(DECRYPTED_ROOT), "material-program-inventory-full.json"),
);

const contract = JSON.parse(fs.readFileSync(CONTRACT, "utf8"));
assert.equal(contract.schema, "pocket-card-render/official-program-port-contract@2");
assert.equal(contract.provenance?.sampleId, officialSample.sampleId,
  "official program port contract does not target the selected official sample");
assert.equal(contract.provenance?.sampleManifestSha256, officialSampleSha256,
  "official program port contract sample manifest provenance is stale");
assert.ok(fs.statSync(DECRYPTED_ROOT, { throwIfNoEntry: false })?.isDirectory(),
  `immutable decrypted sample is absent: ${DECRYPTED_ROOT}`);
assert.ok(fs.statSync(SHADER_ROOT, { throwIfNoEntry: false })?.isDirectory(),
  `immutable shader sample is absent: ${SHADER_ROOT}`);
assert.ok(fs.statSync(PROGRAM_INVENTORY, { throwIfNoEntry: false })?.isFile(),
  `immutable program inventory is absent: ${PROGRAM_INVENTORY}`);
const inventory = JSON.parse(fs.readFileSync(PROGRAM_INVENTORY, "utf8"));
assert.equal(inventory.schema, "pocket-card-render/official-material-program-inventory@4");
assert.equal(
  inventory.digests?.proofGraphSha256,
  officialSample.proofSets.materialPrograms.proofGraphSha256,
  "immutable program inventory proof graph does not target the selected official sample",
);
assert.equal(
  inventory.digests?.portIndexSha256,
  officialSample.proofSets.materialPrograms.portIndexSha256,
  "immutable program inventory port index does not target the selected official sample",
);

const generators = [...new Set(contract.ports.map((row) => row.generator))].sort();
assert.ok(generators.length > 0, "official program port contract has no generators");

const checks = [];
for (const relative of generators) {
  const target = path.resolve(ROOT, relative || "");
  assert.ok(target.startsWith(path.join(ROOT, "build") + path.sep), `${relative} escapes build/`);
  assert.ok(fs.statSync(target, { throwIfNoEntry: false })?.isFile(), `${relative} is absent`);
  const started = Date.now();
  const checked = spawnSync(process.execPath, [target, "--check"], {
    cwd: ROOT,
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
    env: {
      ...process.env,
      PCR_DECRYPTED_ROOT: DECRYPTED_ROOT,
      PCR_SHADERS: SHADER_ROOT,
      PCR_PROGRAM_INVENTORY: PROGRAM_INVENTORY,
    },
  });
  if (checked.status !== 0) {
    throw new Error(`${relative} --check failed\n${checked.stderr || checked.stdout || checked.error || ""}`);
  }
  checks.push({ generator: relative, elapsedMs: Date.now() - started });
}

const report = {
  schema: "pocket-card-render/official-program-port-generator-audit@1",
  contract: "public/shaders/official_program_port_contract.json",
  sampleId: officialSample.sampleId,
  sampleManifest: officialSampleManifestRelative,
  sampleManifestSha256: officialSampleSha256,
  localSource: process.env.PCR_DECRYPTED_ROOT || process.env.PCR_SHADERS
    ? "explicit-environment"
    : "immutable-sample-layout",
  generatorCount: generators.length,
  checks,
};

if (JSON_MODE) console.log(JSON.stringify(report));
else console.log(`Official program port generators OK: ${generators.length} unique generators`);
