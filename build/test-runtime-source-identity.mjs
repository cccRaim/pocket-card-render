import assert from "node:assert/strict";
import {
  FULL_RUNTIME_LEGACY_NON_RENDER_SOURCES,
  fullRuntimeSourceFiles,
  fullRuntimeSourceIdentityMatches,
  runtimeShaderManifestReferences,
} from "./full-runtime-sources.mjs";
import {
  TMP_RUNTIME_LEGACY_NON_RENDER_SOURCES,
  tmpRuntimeSourceIdentityMatches,
} from "./tmp-runtime-sources.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const DIGEST_A = "a".repeat(64);
const DIGEST_B = "b".repeat(64);

function testFullIdentity() {
  const files = ["public/app.js", "public/render/context.js"];
  const current = Object.fromEntries(files.map((file) => [file, DIGEST_A]));
  const exact = { sourceFiles: [...files], sourceHashes: { ...current } };
  assert.equal(fullRuntimeSourceIdentityMatches(exact, files, current), true);

  const legacy = structuredClone(exact);
  for (const file of FULL_RUNTIME_LEGACY_NON_RENDER_SOURCES) {
    legacy.sourceFiles.push(file);
    legacy.sourceHashes[file] = DIGEST_B;
  }
  assert.equal(fullRuntimeSourceIdentityMatches(legacy, files, current), true);

  const unknown = structuredClone(exact);
  unknown.sourceFiles.push("unknown.txt");
  unknown.sourceHashes["unknown.txt"] = DIGEST_B;
  assert.equal(fullRuntimeSourceIdentityMatches(unknown, files, current), false);

  const missing = structuredClone(exact);
  missing.sourceFiles.pop();
  delete missing.sourceHashes[files.at(-1)];
  assert.equal(fullRuntimeSourceIdentityMatches(missing, files, current), false);

  const changed = structuredClone(exact);
  changed.sourceHashes[files[0]] = DIGEST_B;
  assert.equal(fullRuntimeSourceIdentityMatches(changed, files, current), false);
}

function testTmpIdentity() {
  const current = {
    "public/render/tmp-sdf-renderer.js": DIGEST_A,
    "public/shaders/tmp_sdf.frag.glsl": DIGEST_A,
  };
  assert.equal(tmpRuntimeSourceIdentityMatches({ ...current }, current), true);

  const legacy = { ...current };
  for (const file of TMP_RUNTIME_LEGACY_NON_RENDER_SOURCES) legacy[file] = DIGEST_B;
  assert.equal(tmpRuntimeSourceIdentityMatches(legacy, current), true);

  assert.equal(tmpRuntimeSourceIdentityMatches({ ...current, "unknown.txt": DIGEST_B }, current), false);
  const missing = { ...current };
  delete missing[Object.keys(current)[0]];
  assert.equal(tmpRuntimeSourceIdentityMatches(missing, current), false);
  assert.equal(tmpRuntimeSourceIdentityMatches({ ...current, [Object.keys(current)[0]]: DIGEST_B }, current), false);
}

function testFullSourceClassification() {
  assert.deepEqual(runtimeShaderManifestReferences(`
    fetch("shaders/a.json");
    new URL("../../shaders/b.json", import.meta.url);
    fetch("not-shaders/c.json");
  `), ["public/shaders/a.json", "public/shaders/b.json"]);
  const files = fullRuntimeSourceFiles(ROOT);
  assert.equal(files.includes("public/shaders/homography_program.json"), true);
  assert.equal(files.includes("public/shaders/tmp_sdf_program.json"), true);
  assert.equal(files.includes("public/shaders/glitter.frag.glsl"), true);
  assert.equal(files.includes("public/shaders/ur_plate_uniforms.json"), true);
  assert.equal(files.includes("public/shaders/official_program_port_contract.json"), true);
  assert.equal(files.includes("public/shaders/side_back_program.json"), true);

  const runtimeManifest = "public/shaders/ur_plate_uniforms.json";
  const hashes = Object.fromEntries(files.map((file) => [file, DIGEST_A]));
  const artifact = { sourceFiles: [...files], sourceHashes: { ...hashes } };
  assert.equal(fullRuntimeSourceIdentityMatches(artifact, files, hashes), true);
  artifact.sourceHashes[runtimeManifest] = DIGEST_B;
  assert.equal(fullRuntimeSourceIdentityMatches(artifact, files, hashes), false);
}

testFullIdentity();
testTmpIdentity();
testFullSourceClassification();
console.log("Runtime source identity mutation tests OK");
