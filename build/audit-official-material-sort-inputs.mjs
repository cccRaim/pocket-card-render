#!/usr/bin/env node
// Audit canonical scene Material sort inputs against independently decoded official bundles.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PYTHON = process.env.PYTHON || "python";
const SCHEMA = "pocket-card-render/official-material-sort-inputs@1";
const UNITY_VERSION = "2022.3.62f2";
const CANONICAL_SCENES = Object.freeze([
  ["scene.cPK_10_000040_00_FUSHIGIBANAex_RR.json", "cPK_10_000040_00_FUSHIGIBANAex_RR"],
  ["scene.cPK_20_008900_02_HOUOUex_UR.json", "cPK_20_008900_02_HOUOUex_UR"],
  ["scene.cTR_20_000230_00_LEAF_SR.json", "cTR_20_000230_00_LEAF_SR"],
  ["scene.cTR_20_000670_00_IIBUINOBAKKU_UR.json", "cTR_20_000670_00_IIBUINOBAKKU_UR"],
]);
const EXPECTED = Object.freeze({
  sceneRows: 88,
  uniqueMaterials: 70,
  uniqueShaders: 27,
  sourceBundles: 71,
  instancingMaterials: 2,
  shaderQueueFallbackMaterials: 12,
  invalidKeywordMaterials: 37,
  keywordSpaceWidths: Object.freeze([
    4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4,
    5, 5, 7, 8, 9,
  ]),
  digests: Object.freeze({
    sourceBundlesSha256: "a9ccd96152e8e820475058a1537be62add15839779197296809beed851f685d4",
    rowsSha256: "94544c09c67be602ef86c8cea0831ee4b41ea1806fb6a02776583408420e607d",
    materialsSha256: "bb0e4897ff2eff4483bba6f0cc4c391420be24a6fa1c2bea852917ed6a2ba5c7",
    shadersSha256: "e98348b0c6f8db8d26a468e6173a972d90c1d464669ccaf8021919c43e0f46df",
    evidenceSha256: "879c4b6bdeac823e78ab0fa724b79cd0a69671d388967ad8a6c902896fb1bba8",
  }),
});
const IDENTITY_RE = /^(CAB-[0-9a-f]{32}):(-?[0-9]+)$/;
const SHA256_RE = /^[0-9a-f]{64}$/;
const OFFICIAL_KEYS = Object.freeze([
  "customRenderQueue",
  "enableInstancingVariants",
  "invalidKeywords",
  "material",
  "shader",
  "shaderKeywordFlags",
  "shaderKeywordNames",
  "validKeywords",
]);

function asciiCompare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function canonicalJson(value) {
  if (value === null || typeof value === "boolean" || typeof value === "number"
      || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  assert.equal(typeof value, "object", "digest input contains a non-JSON value");
  const entries = Object.keys(value).sort(asciiCompare).map(
    (key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`,
  );
  return `{${entries.join(",")}}`;
}

function digest(value) {
  return createHash("sha256").update(canonicalJson(value), "ascii").digest("hex");
}

function assertKeys(value, expected, label) {
  assert.ok(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
  assert.deepEqual(Object.keys(value).sort(asciiCompare), [...expected].sort(asciiCompare), `${label} schema`);
}

function assertStringArray(value, label) {
  assert.ok(Array.isArray(value), `${label} must be an array`);
  assert.ok(value.every((item) => typeof item === "string"), `${label} must contain strings`);
}

function parseIdentity(identity, label) {
  assert.equal(typeof identity, "string", `${label} must be a string`);
  const match = IDENTITY_RE.exec(identity);
  assert.ok(match, `${label} is not a CAB:pathID identity`);
  assert.equal(`${match[1]}:${BigInt(match[2])}`, identity, `${label} is not canonical`);
  return { cab: match[1], pathId: match[2] };
}

function uniqueMap(records, key, label) {
  const output = new Map();
  for (const record of records) {
    const identity = record[key];
    assert.ok(!output.has(identity), `${label} duplicate ${identity}`);
    output.set(identity, record);
  }
  return output;
}

function readCanonicalSceneRows() {
  const scenes = [];
  const rows = [];
  for (const [sceneFile, cardId] of CANONICAL_SCENES) {
    const scenePath = path.join(ROOT, "public", sceneFile);
    const scene = JSON.parse(fs.readFileSync(scenePath, "utf8"));
    assert.equal(scene.card?.id, cardId, `${sceneFile}: canonical card.id`);
    assert.ok(scene.materials && typeof scene.materials === "object" && !Array.isArray(scene.materials),
      `${sceneFile}: materials object`);
    const entries = Object.entries(scene.materials).sort(([left], [right]) => asciiCompare(left, right));
    scenes.push({ sceneFile, cardId, materialRows: entries.length });
    for (const [materialName, material] of entries) {
      assertKeys(material.official, OFFICIAL_KEYS, `${sceneFile}:${materialName}.official`);
      rows.push({ sceneFile, cardId, materialName, material });
    }
  }
  return { scenes, rows };
}

const extractorArgs = ["build/extract_official_material_sort_inputs.py"];
if (process.env.PCR_DECRYPTED_ROOT) {
  extractorArgs.push("--decrypted-root", process.env.PCR_DECRYPTED_ROOT);
}
const extracted = spawnSync(PYTHON, extractorArgs, {
  cwd: ROOT,
  env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
  encoding: "utf8",
  maxBuffer: 32 * 1024 * 1024,
  shell: process.platform === "win32",
});
if (extracted.error) throw extracted.error;
if (extracted.status !== 0) {
  throw new Error((extracted.stderr || extracted.stdout || "official Material extractor failed").trim());
}

const evidence = JSON.parse(extracted.stdout.replace(/^\uFEFF/, ""));
assertKeys(evidence, [
  "schema", "schemaVersion", "unityVersion", "canonicalScenes", "locator", "summary",
  "sourceBundles", "rows", "materials", "shaders", "digests",
], "extractor output");
assert.equal(evidence.schema, SCHEMA, "extractor schema identifier");
assert.equal(evidence.schemaVersion, 1, "extractor schema version");
assert.equal(evidence.unityVersion, UNITY_VERSION, "official Unity fallback version");
assertKeys(evidence.locator, [
  "materialBundleFiles", "shaderBundleFiles", "scannedBundleFiles", "loadedBundleFiles",
], "locator");
assertKeys(evidence.summary, [
  "sceneRows", "uniqueMaterials", "uniqueShaders", "sourceBundles",
], "summary");
assertKeys(evidence.digests, [
  "sourceBundlesSha256", "rowsSha256", "materialsSha256", "shadersSha256", "evidenceSha256",
], "digests");

for (const field of ["canonicalScenes", "sourceBundles", "rows", "materials", "shaders"]) {
  assert.ok(Array.isArray(evidence[field]), `${field} must be an array`);
}

const { scenes: canonicalScenes, rows: canonicalRows } = readCanonicalSceneRows();
assert.deepEqual(evidence.canonicalScenes, canonicalScenes, "canonical scene manifest");
assert.equal(canonicalRows.length, EXPECTED.sceneRows, "canonical active scene rows");
assert.deepEqual(evidence.summary, {
  sceneRows: EXPECTED.sceneRows,
  uniqueMaterials: EXPECTED.uniqueMaterials,
  uniqueShaders: EXPECTED.uniqueShaders,
  sourceBundles: EXPECTED.sourceBundles,
}, "canonical evidence counts");

const sourceBundles = uniqueMap(evidence.sourceBundles, "cab", "source bundle CAB");
const materials = uniqueMap(evidence.materials, "identity", "Material identity");
const shaders = uniqueMap(evidence.shaders, "identity", "Shader identity");
const extractedRows = uniqueMap(
  evidence.rows.map((row) => ({ ...row, rowKey: `${row.sceneFile}\0${row.materialName}` })),
  "rowKey",
  "scene Material row",
);

assert.equal(sourceBundles.size, EXPECTED.sourceBundles, "official source bundle count");
assert.equal(materials.size, EXPECTED.uniqueMaterials, "official Material identity count");
assert.equal(shaders.size, EXPECTED.uniqueShaders, "official Shader identity count");
assert.equal(extractedRows.size, EXPECTED.sceneRows, "extracted active row count");
assert.equal(evidence.locator.loadedBundleFiles, EXPECTED.sourceBundles,
  "extractor must load only owning source bundles");
assert.ok(evidence.locator.scannedBundleFiles >= evidence.locator.loadedBundleFiles,
  "locator scan count must cover loaded bundles");
assert.ok(evidence.locator.materialBundleFiles >= EXPECTED.uniqueMaterials,
  "Material locator candidate coverage");
assert.ok(evidence.locator.shaderBundleFiles >= EXPECTED.uniqueShaders,
  "Shader locator candidate coverage");

for (const bundle of evidence.sourceBundles) {
  assertKeys(bundle, ["cab", "roles", "relativePath", "byteSize", "sha256"],
    `source bundle ${bundle.cab}`);
  assert.match(bundle.cab, /^CAB-[0-9a-f]{32}$/, `${bundle.cab}: CAB identity`);
  assertStringArray(bundle.roles, `${bundle.cab}.roles`);
  assert.ok(bundle.roles.length > 0, `${bundle.cab}: source role missing`);
  assert.ok(Number.isInteger(bundle.byteSize) && bundle.byteSize > 0, `${bundle.cab}: bundle byte size`);
  assert.match(bundle.sha256, SHA256_RE, `${bundle.cab}: bundle SHA-256`);
  assert.ok(!path.isAbsolute(bundle.relativePath), `${bundle.cab}: source path must be relative`);
  assert.ok(!bundle.relativePath.split("/").includes(".."), `${bundle.cab}: source path escapes root`);
}

const materialCabs = new Set();
const shaderCabs = new Set();
for (const material of evidence.materials) {
  assertKeys(material, [
    "identity", "name", "sourceBundle", "sourceBundleSha256", "rawByteSize", "rawSha256",
    "customRenderQueue", "enableInstancingVariants", "validKeywords", "invalidKeywords",
    "shaderPointer", "shaderIdentity",
  ], `Material ${material.identity}`);
  const { cab } = parseIdentity(material.identity, "Material identity");
  materialCabs.add(cab);
  assert.equal(typeof material.name, "string", `${material.identity}: Material name`);
  assert.ok(Number.isInteger(material.rawByteSize) && material.rawByteSize > 0,
    `${material.identity}: raw Material byte size`);
  assert.match(material.rawSha256, SHA256_RE, `${material.identity}: raw Material SHA-256`);
  assert.ok(Number.isInteger(material.customRenderQueue), `${material.identity}: m_CustomRenderQueue`);
  assert.equal(typeof material.enableInstancingVariants, "boolean",
    `${material.identity}: m_EnableInstancingVariants`);
  assertStringArray(material.validKeywords, `${material.identity}: m_ValidKeywords`);
  assertStringArray(material.invalidKeywords, `${material.identity}: m_InvalidKeywords`);
  assertKeys(material.shaderPointer, ["sourceCab", "fileId", "pathId", "targetCab", "identity"],
    `${material.identity}.m_Shader`);
  assert.equal(material.shaderPointer.sourceCab, cab, `${material.identity}: m_Shader source CAB`);
  assert.ok(Number.isInteger(material.shaderPointer.fileId) && material.shaderPointer.fileId >= 0,
    `${material.identity}: m_Shader file ID`);
  assert.match(material.shaderPointer.targetCab, /^CAB-[0-9a-f]{32}$/,
    `${material.identity}: m_Shader target CAB`);
  assert.equal(material.shaderPointer.identity, material.shaderIdentity,
    `${material.identity}: resolved m_Shader identity`);
  assert.equal(parseIdentity(material.shaderIdentity, `${material.identity}: Shader identity`).cab,
    material.shaderPointer.targetCab, `${material.identity}: m_Shader target identity`);

  const bundle = sourceBundles.get(cab);
  assert.ok(bundle, `${material.identity}: source bundle evidence missing`);
  assert.equal(material.sourceBundle, bundle.relativePath, `${material.identity}: source bundle path`);
  assert.equal(material.sourceBundleSha256, bundle.sha256, `${material.identity}: source bundle hash`);
  assert.ok(bundle.relativePath.startsWith("Common/CardNew/Common/")
    || bundle.relativePath.startsWith("Common/CardNew/Face/"),
  `${material.identity}: Material source is outside Face/CardNew Common`);
}

for (const shader of evidence.shaders) {
  assertKeys(shader, [
    "identity", "name", "sourceBundle", "sourceBundleSha256", "rawByteSize", "rawSha256",
    "keywordNames", "keywordFlags",
  ], `Shader ${shader.identity}`);
  const { cab } = parseIdentity(shader.identity, "Shader identity");
  shaderCabs.add(cab);
  assert.equal(typeof shader.name, "string", `${shader.identity}: Shader name`);
  assert.ok(Number.isInteger(shader.rawByteSize) && shader.rawByteSize > 0,
    `${shader.identity}: raw Shader byte size`);
  assert.match(shader.rawSha256, SHA256_RE, `${shader.identity}: raw Shader SHA-256`);
  assertStringArray(shader.keywordNames, `${shader.identity}: m_ParsedForm.m_KeywordNames`);
  assert.ok(Array.isArray(shader.keywordFlags) && shader.keywordFlags.every(Number.isInteger),
    `${shader.identity}: m_ParsedForm.m_KeywordFlags`);
  assert.equal(shader.keywordNames.length, shader.keywordFlags.length,
    `${shader.identity}: serialized Shader keyword-space width`);
  const bundle = sourceBundles.get(cab);
  assert.ok(bundle, `${shader.identity}: source bundle evidence missing`);
  assert.equal(shader.sourceBundle, bundle.relativePath, `${shader.identity}: source bundle path`);
  assert.equal(shader.sourceBundleSha256, bundle.sha256, `${shader.identity}: source bundle hash`);
  assert.ok(bundle.relativePath.startsWith("Common/Shader/"),
    `${shader.identity}: Shader source is outside Common/Shader`);
}

assert.equal(materialCabs.size, 44, "canonical Material CAB count");
assert.equal(shaderCabs.size, EXPECTED.uniqueShaders, "canonical Shader CAB count");
assert.equal(new Set([...materialCabs, ...shaderCabs]).size, EXPECTED.sourceBundles,
  "Material and Shader owning CABs must be disjoint");
for (const bundle of evidence.sourceBundles) {
  const expectedRoles = [];
  if (materialCabs.has(bundle.cab)) expectedRoles.push("Material");
  if (shaderCabs.has(bundle.cab)) expectedRoles.push("Shader");
  assert.deepEqual(bundle.roles, expectedRoles, `${bundle.cab}: source bundle roles`);
}

const seenMaterials = new Set();
const seenShaders = new Set();
for (const { sceneFile, cardId, materialName, material: sceneMaterial } of canonicalRows) {
  const label = `${sceneFile}:${materialName}`;
  const row = extractedRows.get(`${sceneFile}\0${materialName}`);
  assert.ok(row, `${label}: extracted row missing`);
  assertKeys(row, [
    "sceneFile", "cardId", "materialName", "materialIdentity", "shaderIdentity", "rowKey",
  ], `${label}: extracted row`);
  assert.equal(row.cardId, cardId, `${label}: row card ID`);
  assert.equal(row.materialIdentity, sceneMaterial.official.material, `${label}: Material identity`);

  const material = materials.get(row.materialIdentity);
  assert.ok(material, `${label}: official Material object missing`);
  const shader = shaders.get(material.shaderIdentity);
  assert.ok(shader, `${label}: official Shader object missing`);
  assert.equal(row.shaderIdentity, material.shaderIdentity, `${label}: decoded m_Shader row identity`);
  assert.equal(material.name, materialName, `${label}: serialized Material name`);
  assert.equal(sceneMaterial.official.shader, material.shaderIdentity, `${label}: m_Shader identity`);
  assert.equal(sceneMaterial.official.customRenderQueue, material.customRenderQueue,
    `${label}: m_CustomRenderQueue`);
  assert.equal(sceneMaterial.official.enableInstancingVariants, material.enableInstancingVariants,
    `${label}: m_EnableInstancingVariants`);
  assert.deepEqual(sceneMaterial.official.validKeywords, material.validKeywords,
    `${label}: m_ValidKeywords`);
  assert.deepEqual(sceneMaterial.official.invalidKeywords, material.invalidKeywords,
    `${label}: m_InvalidKeywords`);
  assert.deepEqual(sceneMaterial.official.shaderKeywordNames, shader.keywordNames,
    `${label}: Shader m_ParsedForm.m_KeywordNames`);
  assert.deepEqual(sceneMaterial.official.shaderKeywordFlags, shader.keywordFlags,
    `${label}: Shader m_ParsedForm.m_KeywordFlags`);
  assert.deepEqual(sceneMaterial.keywords, material.validKeywords,
    `${label}: active recipe keyword projection`);

  const keywordSpace = new Set(shader.keywordNames);
  assert.ok(material.validKeywords.every((keyword) => keywordSpace.has(keyword)),
    `${label}: valid keyword is outside the serialized Shader keyword space`);
  assert.ok(material.invalidKeywords.every((keyword) => !keywordSpace.has(keyword)),
    `${label}: invalid keyword unexpectedly belongs to the serialized Shader keyword space`);
  seenMaterials.add(material.identity);
  seenShaders.add(shader.identity);
}
assert.equal(seenMaterials.size, EXPECTED.uniqueMaterials, "active Material identity coverage");
assert.equal(seenShaders.size, EXPECTED.uniqueShaders, "active Shader identity coverage");

assert.equal([...materials.values()].filter((material) => material.enableInstancingVariants).length,
  EXPECTED.instancingMaterials, "instancing-enabled official Materials");
assert.equal([...materials.values()].filter((material) => material.customRenderQueue === -1).length,
  EXPECTED.shaderQueueFallbackMaterials, "official Materials using Shader queue fallback");
assert.equal([...materials.values()].filter((material) => material.invalidKeywords.length > 0).length,
  EXPECTED.invalidKeywordMaterials, "official Materials carrying invalid keywords");
assert.deepEqual(
  [...shaders.values()].map((shader) => shader.keywordNames.length).sort((left, right) => left - right),
  EXPECTED.keywordSpaceWidths,
  "canonical Shader keyword-space widths",
);

const recomputedDigests = {
  sourceBundlesSha256: digest(evidence.sourceBundles),
  rowsSha256: digest(evidence.rows),
  materialsSha256: digest(evidence.materials),
  shadersSha256: digest(evidence.shaders),
  evidenceSha256: digest({
    sourceBundles: evidence.sourceBundles,
    rows: evidence.rows,
    materials: evidence.materials,
    shaders: evidence.shaders,
  }),
};
assert.deepEqual(evidence.digests, recomputedDigests, "extractor aggregate digests must be reproducible");
assert.deepEqual(recomputedDigests, EXPECTED.digests, "official bundle/object evidence drifted");

console.log(
  `official Material sort inputs: ${EXPECTED.sceneRows} rows / ${materials.size} Materials / `
  + `${shaders.size} Shaders verified from ${sourceBundles.size} official bundles`,
);
