import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  assertOfficialPortVerifierSessionStable,
  createOfficialPortVerifierSession,
  preloadOfficialProgramExtractions,
  verify,
} from "./official-port-verifier-lib.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const key = {
  selectorId: "82d74793623781f7ff66286bbd165df6b62567ccb9dd5bdd3594133d19e29931",
  candidateWitnessId: "60d74858874bf4a236896b464909975dff080498545e876ee63d7f9251f262a6",
  subshader: 0,
  pass: 0,
};

function runCli(script) {
  const args = [
    script,
    "--selector-id", key.selectorId,
    "--candidate-witness-id", key.candidateWitnessId,
    "--subshader", String(key.subshader),
    "--pass", String(key.pass),
  ];
  const result = spawnSync(process.execPath, args, {
    cwd: ROOT,
    env: { ...process.env, PCR_PROGRAM_PORT_GENERATORS_EXTERNALLY_VERIFIED: "1" },
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

const inventory = JSON.parse(fs.readFileSync(path.join(ROOT, "$cache", "official-material-program-inventory-v4-full.json"), "utf8"));
const preload = preloadOfficialProgramExtractions({
  ports: [key],
  expectedProofGraphSha256: inventory.digests.proofGraphSha256,
  expectedPortIndexSha256: inventory.digests.portIndexSha256,
});
assert.equal(preload.statistics.inventoryLoadCount, 1);
assert.equal(preload.statistics.extractionCount, 1);
const session = createOfficialPortVerifierSession({
  generatorsExternallyVerified: true,
  officialExtractions: preload.extractions,
  requirePreloadedExtractions: true,
});
for (const [field, script] of [
  ["stageProgram", "build/verify-official-port-stage-program.mjs"],
  ["parameterEntry", "build/verify-official-port-parameter-entry.mjs"],
]) {
  assert.deepEqual(verify(field, key, session), runCli(script));
}
for (const field of ["passState", "commonBindings", "runtimeDispatch"]) verify(field, key, session);
assert.equal(session.contexts.size, 1);
assert.equal(session.officialExtractions.size, 1);
assert.equal(session.checkedGenerators.size, 0);
assert.equal(assertOfficialPortVerifierSessionStable(session), true);
assert.throws(() => verify("stageProgram", { ...key, candidateWitnessId: "0".repeat(64) }, session),
  /resolves to 0 contract rows/);
const missingPreloadSession = createOfficialPortVerifierSession({
  generatorsExternallyVerified: true,
  requirePreloadedExtractions: true,
});
assert.throws(() => verify("parameterEntry", key, missingPreloadSession), /was not preloaded/);

const formerlySpecializedPorts = [
  "simple_opaque_uniforms.json",
  "transparent_hologram_tuning_uniforms.json",
  "card_hologram_tuning_uniforms.json",
].map((file) => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "public", "shaders", file), "utf8"));
  return {
    selectorId: manifest.official_selector.selectorId,
    candidateWitnessId: manifest.official_selector.candidateWitnessId,
    subshader: manifest.official_selector.subshader,
    pass: manifest.official_selector.pass,
  };
});
const formerlySpecializedPreload = preloadOfficialProgramExtractions({
  ports: formerlySpecializedPorts,
  expectedProofGraphSha256: inventory.digests.proofGraphSha256,
  expectedPortIndexSha256: inventory.digests.portIndexSha256,
});
const formerlySpecializedSession = createOfficialPortVerifierSession({
  generatorsExternallyVerified: true,
  officialExtractions: formerlySpecializedPreload.extractions,
  requirePreloadedExtractions: true,
});
for (const port of formerlySpecializedPorts) {
  const verification = verify("stageProgram", port, formerlySpecializedSession);
  assert.equal(verification.verdict, "source-hash-bound");
  assert.equal(verification.verificationLayers, undefined);
  for (const field of ["passState", "commonBindings", "runtimeDispatch"]) {
    const runtimeVerification = verify(field, port, formerlySpecializedSession);
    assert.equal(runtimeVerification.verificationLayers, undefined);
  }
}

const typedOnlyManifest = JSON.parse(fs.readFileSync(
  path.join(ROOT, "public", "shaders", "effect_eff1_uniforms.json"),
  "utf8",
));
assert.equal(typedOnlyManifest.webgl_adaptation.vertex.substitutions, undefined);
assert.equal(typedOnlyManifest.webgl_adaptation.fragment.substitutions, undefined);
const typedOnlyPort = {
  selectorId: typedOnlyManifest.official_selector.selectorId,
  candidateWitnessId: typedOnlyManifest.official_selector.candidateWitnessId,
  subshader: typedOnlyManifest.official_selector.subshader,
  pass: typedOnlyManifest.official_selector.pass,
};
const typedOnlyPreload = preloadOfficialProgramExtractions({
  ports: [typedOnlyPort],
  expectedProofGraphSha256: inventory.digests.proofGraphSha256,
  expectedPortIndexSha256: inventory.digests.portIndexSha256,
});
const typedOnlySession = createOfficialPortVerifierSession({
  generatorsExternallyVerified: true,
  officialExtractions: typedOnlyPreload.extractions,
  requirePreloadedExtractions: true,
});
assert.equal(verify("stageProgram", typedOnlyPort, typedOnlySession).verdict, "source-hash-bound");

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "pcr-verifier-session-test-"));
try {
  const inventoryPath = path.join(temporary, "inventory.json");
  const contractPath = path.join(temporary, "contract.json");
  const runtimePath = path.join(temporary, "runtime.json");
  fs.copyFileSync(path.join(ROOT, "$cache", "official-material-program-inventory-v4-full.json"), inventoryPath);
  fs.copyFileSync(path.join(ROOT, "public", "shaders", "official_program_port_contract.json"), contractPath);
  fs.copyFileSync(path.join(ROOT, "$cache", "full-runtime-evidence.local.json"), runtimePath);
  const mutationSession = createOfficialPortVerifierSession({ inventoryPath, contractPath, runtimePath });
  fs.appendFileSync(contractPath, "\n");
  assert.throws(() => assertOfficialPortVerifierSessionStable(mutationSession),
    /contract changed during verification session/);
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}

console.log("Official port verifier session caching/differential/mutation checks OK");
