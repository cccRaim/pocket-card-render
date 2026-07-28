import assert from "node:assert/strict";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FULL_CACHE = path.join(ROOT, "$cache", "official-material-program-inventory-v4-full.json");
const EXPECTED = Object.freeze({
  schema: "pocket-card-render/official-material-program-inventory@4",
  unityVersion: "2022.3.62f2",
  summary: {
    lPrefabs: 3191,
    meshRenderers: 45171,
    materialSlotUsages: 58057,
    uniqueMaterials: 8460,
    resolvedMaterials: 8460,
    uniqueShaders: 62,
    selectorArchetypes: 78,
    exactStaticSelectors: 75,
    exactExecutableSelectors: 78,
    exactExecutableCandidates: 80,
    executableResolutionErrors: 0,
    executableArchetypes: 79,
    semanticExecutableArchetypes: 77,
    orderedMultipassSelectors: 2,
    nativeBestMatchSelectors: 1,
    runtimeEngineVariantSelectors: 1,
    ambiguousStaticSelectors: 0,
    unmatchedStaticSelectors: 0,
    stateArchetypes: 166,
    instancingMaterials: 2,
  },
  digests: {
    usageRowsSha256: "b54d9683c86902ab7dd10ae91d831cb25e0f9fc0f1d3a4df530a314a97b00c0f",
    materialsSha256: "aac015c4745c98833c1c69afd5dc8a8a6cd06c6de707a9624058f0a852029816",
    shadersSha256: "45048245c3d5ad19ad788b6317db0b02b7f3af653f918ffe20a5d6e4228f6cb1",
    selectorsSha256: "23c6a6acb9c353f45d4dba93a5b58582f82b39daecb63358b412d96735f76f4c",
    executablesSha256: "7d46b59e271de156dbda16f8e44977858e00c5b7e7aeee438ad39809379f3da2",
    semanticExecutablesSha256: "c0a52dd9a5c11c52052dcac4c691e5ca4cde57c72723c55f61c81561fbe4f170",
    portIndexSha256: "15095f34b9e75515bbcc3924f6f8b2abb826ba96b48e819ec911486bcfa6f5a9",
    stateArchetypesSha256: "fed17c187fa43f756ea9e9322f356321205cee2004ea92e97ecff887c551f430",
    sourceBundlesSha256: "b1e490b81f1176e2b7782c442b9a8b0d288afc132f91fffe6e69d0a0cfb1640d",
    exceptionalSha256: "773ed665f39a5b586806fd46b548bfc952dc61c953564f283221444facb31215",
    nativeVariantSelectionSha256: "0cd41159b8e7cf6b953edab10ba08c1bb51265ced6b01d5ad8efb8604a69f0c4",
    proofGraphSha256: "307ed3660e5d3b1bfd8cf9e6b3d64e44937af215da3b6ed84ead198800eeadc4",
  },
});

function canonicalDigest(value) {
  function sortKeys(current) {
    if (Array.isArray(current)) return current.map(sortKeys);
    if (current && typeof current === "object") {
      return Object.fromEntries(Object.keys(current).sort().map((key) => [key, sortKeys(current[key])]));
    }
    return current;
  }
  return crypto.createHash("sha256").update(JSON.stringify(sortKeys(value))).digest("hex");
}

function runExtractor() {
  fs.mkdirSync(path.dirname(FULL_CACHE), { recursive: true });
  const result = spawnSync(process.env.PYTHON || "python", [
    "build/extract_official_material_program_inventory.py",
    "--full",
    "--out", FULL_CACHE,
  ], {
    cwd: ROOT,
    encoding: "utf8",
    windowsHide: true,
    shell: process.platform === "win32",
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`official material/program extractor failed: ${result.error || "unknown spawn error"}\n${result.stderr || result.stdout || ""}`);
  }
  return JSON.parse(fs.readFileSync(FULL_CACHE, "utf8"));
}

const result = runExtractor();
assert.equal(result.schema, EXPECTED.schema);
assert.equal(result.schemaVersion, 4);
assert.equal(result.portIndex.length, 80);
assert.equal(result.unityVersion, EXPECTED.unityVersion);
assert.deepEqual(result.source.excludedInputs, ["scene JSON", "render recipe", "PNG", "GLB", "screenshot"]);
assert.deepEqual(result.summary, EXPECTED.summary);
assert.deepEqual(result.digests, EXPECTED.digests);
assert.equal(canonicalDigest(Object.fromEntries(
  Object.entries(result.digests).filter(([key]) => key !== "proofGraphSha256"),
)), EXPECTED.digests.proofGraphSha256);

const unresolved = result.exceptional.unresolvedMaterialCabs;
assert.deepEqual(unresolved, []);
assert.deepEqual(result.exceptional.unresolvedMaterials, []);
const logo = result.portIndex.find(
  (row) => row.shaderName === "Lettuce/Common/CardNew/Logo/Opaque",
);
assert.ok(logo);
assert.equal(logo.materialCount, 2);
assert.equal(logo.materialSlotUsages, 152);
assert.equal(
  logo.shaderIdentity,
  "CAB-596cc0831b33693ae475c2f8be0b7768:-7670412818071714871",
);
assert.equal(
  logo.identityFields.passStateSha256,
  "91e0b417062602e9e639ecc679cf6d181712c9531d152026a3d1beec19230d21",
);

assert.deepEqual(result.exceptional.ambiguousSelectors, []);
assert.deepEqual(result.exceptional.unmatchedSelectors, []);
assert.deepEqual(
  result.exceptional.orderedMultipassSelectors.map((row) => [
    row.shaderName,
    row.materials.length,
    row.orderedPasses.map((pass) => [pass.ordinal, pass.pass, pass.lightMode, pass.stateName]),
    row.staticExecutables.map((item) => item.executable.identityFields.passStateSha256),
  ]),
  [
    ["Lettuce/Common/CardNew/Face/Card_Circular_Moving_Kira", 2,
      [[0, 0, null, "AlphaBlendPass"], [1, 1, null, "AddPass"]],
      ["2b4075c736b03e048539e8c13ea87c5b092d9565f2449e9436b8c853add985f8", "1ff39e9a194201e9b6851dfd5b4e4596a8a47e26131b855e78150fc4e510eb4c"]],
    ["Lettuce/Common/CardNew/Face/Card_Circular_Trail_Kira", 4,
      [[0, 0, null, "AlphaBlendPass"], [1, 1, null, "AddPass"]],
      ["0b020e114b6b91ce4d7a5224d0f884cd54976a277c04835a792e44226d1f1c59", "85cde11675c40dbebb5cb5edf15222c6b686690595af03ac4191561245cfdf37"]],
  ],
);
const nativeBestMatch = result.exceptional.nativeBestMatchSelectors[0];
assert.equal(nativeBestMatch.shaderName, "Lettuce/Common/CardNew/Face/Card_Parallax");
assert.equal(nativeBestMatch.materials[0].name, "Layer_Parallax_BG_S");
assert.equal(nativeBestMatch.candidates[0].keywords[0], "_UVASPECTRATIO_SQUARE");
assert.deepEqual(nativeBestMatch.candidates[0].nativeBestMatch, {
  candidateCount: 3,
  bestScore: -16,
  tiedBestCandidates: 3,
  tieBreak: "first-serialized-candidate",
});
assert.equal(result.exceptional.instancingMaterials.length, 2);
assert.deepEqual(result.exceptional.executableResolutionErrors, []);
assert.equal(result.exceptional.runtimeEngineVariantSelectors.length, 1);
const sideBack = result.exceptional.runtimeEngineVariantSelectors[0];
assert.equal(sideBack.shaderName, "Lettuce/Common/CardNew/Face/Side&Back");
assert.deepEqual(sideBack.materials.map((row) => row.name), ["L_Card_R_M", "L_Card_S_M"]);
assert.deepEqual(sideBack.keywords, []);
assert.equal(sideBack.staticExecutable.executableId, "4585b2b8f408d64493dd072be2fc19833710b32329a11496eb7b395c07b65914");
assert.equal(sideBack.staticExecutable.semanticExecutableId, "0d7e8a8234f12806c86125e706caceef2ae576a1cca7a0ec8647a2c5839ce118");
assert.equal(sideBack.staticExecutable.identityFields.vertexSpirvSha256, "215f8207c068520aa82c877d6d2a32cc7f0e46c946ee5a25729ffe2911697bae");
assert.equal(sideBack.staticExecutable.identityFields.fragmentSpirvSha256, "12c4121a4fd3cc5694b21f983c40d9bd17e9ea6be3b14f797986d24502cd2370");

// Mutation proof: a changed subgraph digest cannot retain the pinned root.
const mutated = structuredClone(result.digests);
mutated.usageRowsSha256 = "0".repeat(64);
delete mutated.proofGraphSha256;
assert.notEqual(canonicalDigest(mutated), EXPECTED.digests.proofGraphSha256);

console.log("Official all-card material/program inventory audit OK");
console.log(`  official graph:          ${result.summary.materialSlotUsages} renderer-slot usages`);
console.log(`  resolved Materials:      ${result.summary.resolvedMaterials}/${result.summary.uniqueMaterials}`);
console.log(`  official Shaders:        ${result.summary.uniqueShaders}`);
console.log(`  selector programs:       ${result.summary.exactExecutableSelectors}/${result.summary.selectorArchetypes} resolved`);
console.log(`  pass executables:        ${result.summary.exactExecutableCandidates} candidates -> ${result.summary.executableArchetypes} container / ${result.summary.semanticExecutableArchetypes} semantic archetypes`);
console.log("  selection modes:         75 exact-keyword, 2 ordered multi-pass, 1 native best-match");
console.log("  runtime boundary:        1 engine-variant selector / 2 instancing Materials");
console.log("  dependency closure:      8460/8460 Materials, including 2 shared cPK_90 Logo Materials");
console.log(`  proof graph sha256:       ${result.digests.proofGraphSha256}`);
