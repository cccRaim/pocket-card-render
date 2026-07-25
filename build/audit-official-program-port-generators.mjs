#!/usr/bin/env node
// Regenerate every selector-bound stage port declared by the official contract.
// This is the only valid producer of the "generators externally verified" fact.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONTRACT = path.join(ROOT, "public", "shaders", "official_program_port_contract.json");
const JSON_MODE = process.argv.includes("--json");

const contract = JSON.parse(fs.readFileSync(CONTRACT, "utf8"));
assert.equal(contract.schema, "pocket-card-render/official-program-port-contract@2");

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
  });
  if (checked.status !== 0) {
    throw new Error(`${relative} --check failed\n${checked.stderr || checked.stdout || checked.error || ""}`);
  }
  checks.push({ generator: relative, elapsedMs: Date.now() - started });
}

const report = {
  schema: "pocket-card-render/official-program-port-generator-audit@1",
  contract: "public/shaders/official_program_port_contract.json",
  generatorCount: generators.length,
  checks,
};

if (JSON_MODE) console.log(JSON.stringify(report));
else console.log(`Official program port generators OK: ${generators.length} unique generators`);
