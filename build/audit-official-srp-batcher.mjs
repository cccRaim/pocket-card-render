#!/usr/bin/env node
// Prove the canonical draws' SRP-batcher sort bit from official native code and Shader reflection.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PYTHON = process.env.PYTHON || "python";
const JSON_MODE = process.argv.includes("--json");
const EXPECTED = Object.freeze({
  schema: "pocket-card-render/official-srp-batcher@1",
  cards: 4,
  draws: 98,
  uniqueMaterials: 70,
  uniqueShaders: 27,
  sourceBundles: 71,
  nativeInstructionChecks: 107,
  cardDraws: Object.freeze([30, 22, 23, 23]),
  digests: Object.freeze({
    canonicalDrawsSha256: "bc218d9329d473efd5042aff83d018aa6e455a69c7ea86f398ab96e142b38718",
    sourceBundlesSha256: "a9ccd96152e8e820475058a1537be62add15839779197296809beed851f685d4",
    materialShaderPPtrsSha256: "63ca79630f6baf46e14e1c3a22c976bf02f082f2d95f01a72d4d793c158d08e0",
    shaderReflectionsSha256: "36d9a7613e72a63a476980f510b3c105ce3fb0446dd56a282462549ea0b03a4e",
    evidenceSha256: "ebd03f2857653b6a2303ce2090ae1eddb83252c2825ba507a2c2ce7a46919b8a",
  }),
});

function run(command, args, label) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    shell: process.platform === "win32",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${label} failed: ${(result.stderr || result.stdout || "no output").trim()}`);
  }
  return JSON.parse(result.stdout.replace(/^\uFEFF/, ""));
}

function asciiCompare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function canonicalJson(value) {
  if (value === null || typeof value === "boolean" || typeof value === "number"
      || typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  assert.equal(typeof value, "object", "digest input must be JSON-compatible");
  return `{${Object.keys(value).sort(asciiCompare).map(
    (key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`,
  ).join(",")}}`;
}

function digest(value) {
  return createHash("sha256").update(canonicalJson(value), "ascii").digest("hex");
}

const producer = run(process.execPath, ["build/audit-official-sort-input-producers.mjs", "--json"],
  "official native sort-input producer audit");
assert.equal(producer.status, "proved-with-runtime-capture-boundaries", "native producer status");
assert.equal(producer.instructionChecks, EXPECTED.nativeInstructionChecks, "native instruction coverage");
assert.ok(producer.functions.some((row) => row.id === "isSRPBatcherCompatible"
  && row.gameRange === "0x54c62c..0x54c700"
  && row.officialRva === "0x81bbd0"), "official IsSRPBatcherCompatible symbol mapping");
assert.equal(producer.formulas.regular.entry1c,
  "u16((materialSlot<<1)|(IsSRPBatcherCompatible&1))", "entry+0x1c SRP-bit formula");

const extractorArgs = ["build/extract_official_srp_batcher.py"];
if (process.env.PCR_DECRYPTED_ROOT) extractorArgs.push("--decrypted-root", process.env.PCR_DECRYPTED_ROOT);
const evidence = run(PYTHON, extractorArgs, "official SRP Shader-reflection extractor");
assert.equal(evidence.schema, EXPECTED.schema, "extractor schema");
assert.equal(evidence.schemaVersion, 1, "extractor schema version");
assert.deepEqual(evidence.summary, {
  cards: EXPECTED.cards,
  draws: EXPECTED.draws,
  uniqueMaterials: EXPECTED.uniqueMaterials,
  uniqueShaders: EXPECTED.uniqueShaders,
  sourceBundles: EXPECTED.sourceBundles,
  singleSubshaderShaders: EXPECTED.uniqueShaders,
  witnessShaders: EXPECTED.uniqueShaders,
}, "canonical SRP evidence counts");
assert.deepEqual(evidence.canonicalScenes.map((scene) => scene.drawCount), EXPECTED.cardDraws,
  "canonical per-card draw counts");
assert.deepEqual(evidence.digests, EXPECTED.digests, "official SRP evidence digest drift");
assert.equal(digest(evidence.draws), evidence.digests.canonicalDrawsSha256, "draw digest");
assert.equal(digest(evidence.sourceBundles), evidence.digests.sourceBundlesSha256, "bundle digest");
assert.equal(digest(evidence.materials), evidence.digests.materialShaderPPtrsSha256, "Material digest");
assert.equal(digest(evidence.shaders), evidence.digests.shaderReflectionsSha256, "Shader digest");
assert.equal(digest({
  draws: evidence.draws,
  sourceBundles: evidence.sourceBundles,
  materials: evidence.materials,
  shaders: evidence.shaders,
}), evidence.digests.evidenceSha256, "aggregate evidence digest");

const shaders = new Map();
for (const shader of evidence.shaders) {
  assert.equal(shader.subshaderCount, 1, `${shader.identity}: canonical single SubShader scope`);
  assert.ok(shader.vulkanReferenceCount > 0, `${shader.identity}: Vulkan program reference`);
  assert.ok(shader.nonUnityPerDrawObjectToWorldWitnesses.length > 0,
    `${shader.identity}: missing non-UnityPerDraw unity_ObjectToWorld witness`);
  for (const witness of shader.nonUnityPerDrawObjectToWorldWitnesses) {
    assert.equal(witness.field, "unity_ObjectToWorld", `${shader.identity}: witness field`);
    assert.notEqual(witness.buffer, "UnityPerDraw", `${shader.identity}: witness CBUFFER`);
    assert.match(witness.buffer, /^[PV]Globals\d+$/, `${shader.identity}: globals CBUFFER identity`);
  }
  shaders.set(shader.identity, shader);
}
assert.equal(shaders.size, EXPECTED.uniqueShaders, "unique Shader evidence");

const materials = new Map(evidence.materials.map((material) => [material.identity, material]));
assert.equal(materials.size, EXPECTED.uniqueMaterials, "unique Material evidence");
const derivedDraws = evidence.draws.map((draw) => {
  const material = materials.get(draw.materialIdentity);
  assert.ok(material, `${draw.drawId}: Material evidence`);
  assert.equal(material.shaderIdentity, draw.shaderIdentity, `${draw.drawId}: official m_Shader PPtr`);
  assert.ok(shaders.has(draw.shaderIdentity), `${draw.drawId}: Shader reflection evidence`);
  return { drawId: draw.drawId, srpBatcherCompatible: 0 };
});
assert.equal(derivedDraws.length, EXPECTED.draws, "derived SRP draw count");
assert.equal(new Set(derivedDraws.map((draw) => draw.drawId)).size, EXPECTED.draws, "unique SRP draw IDs");
assert.ok(derivedDraws.every((draw) => draw.srpBatcherCompatible === 0), "all canonical SRP bits are zero");

const report = {
  status: "proved-for-canonical-draws",
  nativeFunction: "IsSRPBatcherCompatible(RenderNode const&, Shader const&, int, int)",
  rule: "nonzero SubShader compatibility status returns false; a built-in per-renderer property outside UnityPerDraw makes that status nonzero",
  shaders: shaders.size,
  draws: derivedDraws.length,
  srpBatcherCompatible: 0,
  firstRemainingOptimizeField: "entry+0x08 hashed Material/Shader state key",
  evidenceSha256: evidence.digests.evidenceSha256,
};

if (JSON_MODE) console.log(JSON.stringify(report, null, 2));
else console.log(`official SRP Batcher: ${report.draws}/${report.draws} draws use bit 0; next key is entry+0x08 hashed state`);
