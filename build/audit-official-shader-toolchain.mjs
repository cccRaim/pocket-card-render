#!/usr/bin/env node
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  runCommand,
  withExtractedSelectorProgram,
} from "./exact-selector-port-core.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONTRACT = path.join(ROOT, "public", "shaders", "official_program_port_contract.json");
const SMOLV_CPP = path.join(ROOT, "build", "shaderdec", "smolv.cpp");
const DECRYPTED_ROOT = process.env.PCR_DECRYPTED_ROOT
  || "D:/DevProjectes/ptcgp-tools-master/masterdata_decoder/.output/decrypted";
const UPSTREAM_SMOLV = Object.freeze({
  repository: "https://github.com/aras-p/smol-v",
  commit: "9dd54c379ac29fa148cb1b829bb939ba7381d8f4",
  normalizedSourceSha256: "c3fc96b455ee173250f3302c187f1dea4dbc8ab45bf2ab370e63aa271ad0b790",
});

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function normalizedSourceSha256(file) {
  return sha256(fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n"));
}

assert.equal(normalizedSourceSha256(SMOLV_CPP), UPSTREAM_SMOLV.normalizedSourceSha256,
  `SMOL-V source drifted from upstream ${UPSTREAM_SMOLV.commit}`);

const spirvValVersion = runCommand(process.env.SPIRV_VAL || "spirv-val", ["--version"], { cwd: ROOT });
assert.match(spirvValVersion, /SPIRV-Tools/);
const spirvDisVersion = runCommand(process.env.SPIRV_DIS || "spirv-dis", ["--version"], { cwd: ROOT });
assert.match(spirvDisVersion, /SPIRV-Tools/);

const contract = JSON.parse(fs.readFileSync(CONTRACT, "utf8"));
assert.equal(contract.schema, "pocket-card-render/official-program-port-contract@2");
const port = contract.ports[0];
assert.ok(port, "program-port contract contains no selector");

const result = await withExtractedSelectorProgram({
  selectorId: port.selectorId,
  candidateWitnessId: port.candidateWitnessId,
  expectedProofGraphSha256: contract.inventory.proofGraphSha256,
  expectedPortIndexSha256: contract.inventory.portIndexSha256,
  prefix: "toolchain",
  decryptedRoot: DECRYPTED_ROOT,
  rootDir: ROOT,
}, ({ files, metadata }) => {
  const stages = [
    ["vertex", files.vertexSpirv, metadata.identityFields.vertexSpirvSha256],
    ["fragment", files.fragmentSpirv, metadata.identityFields.fragmentSpirvSha256],
  ];
  for (const [stage, file, expectedHash] of stages) {
    assert.equal(sha256(fs.readFileSync(file)), expectedHash, `${stage} SPIR-V identity`);
    const assembly = runCommand(process.env.SPIRV_DIS || "spirv-dis", [file, "--no-color"], { cwd: ROOT });
    assert.match(assembly, /OpCapability Shader/, `${stage} SPIR-V capability`);
    assert.match(assembly, /OpEntryPoint (Vertex|Fragment)/, `${stage} SPIR-V entry point`);
  }
  return {
    selectorId: port.selectorId,
    stageCount: stages.length,
  };
});

console.log("Official shader toolchain audit: PASS");
console.log(`  SMOL-V: ${UPSTREAM_SMOLV.commit} (${UPSTREAM_SMOLV.normalizedSourceSha256})`);
console.log(`  SPIRV-Tools: ${spirvValVersion.split(/\r?\n/, 1)[0]}`);
console.log(`  selector: ${result.selectorId}`);
console.log(`  independently validated/disassembled stages: ${result.stageCount}`);
