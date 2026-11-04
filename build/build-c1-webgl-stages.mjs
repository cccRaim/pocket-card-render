import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { atomicWriteFileSync } from "./atomic-publish.mjs";
import { adaptUnityDataStage } from "./unity-data-stage.mjs";

const build = path.dirname(fileURLToPath(import.meta.url));
const destination = path.resolve(build, "../public/programs/c1/shaders");
const check = process.argv.includes("--check");
if (process.argv.slice(2).some(arg => arg !== "--check")) throw new Error("Unknown C1 stage build argument");
if (!process.env.PCR_SHADERS) throw new Error("Set PCR_SHADERS to the C1 Common/Shader directory");
const extraction = spawnSync(process.env.PYTHON || "python", [
  "-B", path.join(build, "extract_c1_webgl_stages.py"), path.resolve(process.env.PCR_SHADERS),
], { encoding: "utf8", maxBuffer: 8 * 1024 * 1024, windowsHide: true });
if (extraction.error) throw extraction.error;
if (extraction.status !== 0) throw new Error(extraction.stderr || "C1 stage extraction failed");
const outputs = new Map();
for (const [name, stages] of Object.entries(JSON.parse(extraction.stdout))) {
  const manifest = JSON.parse(fs.readFileSync(path.join(destination, name), "utf8"));
  for (const stage of ["vertex", "fragment"]) {
    const { source, contract } = adaptUnityDataStage(stages[stage], { stage, inputBasis: "unity-flattened" });
    assert.deepEqual(contract, manifest.runtime_contract.backend_data_stages[stage], name);
    const filename = path.join(destination, path.basename(manifest.webgl_sources[stage]));
    if (outputs.has(filename)) assert.equal(outputs.get(filename), source);
    outputs.set(filename, source);
  }
}
for (const [file, source] of outputs) {
  if (check) assert.equal(fs.readFileSync(file, "utf8").replaceAll("\r\n", "\n"), source, file);
  else atomicWriteFileSync(file, source);
}
console.log(`${check ? "Verified" : "Built"} ${outputs.size} C1 WebGL stages from Unity Shader bundles`);
