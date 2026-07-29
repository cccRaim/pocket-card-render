#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadOfficialSample,
  officialSampleDigest,
} from "./official-sample.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SAMPLE_MANIFEST = path.resolve(
  process.env.PCR_OFFICIAL_CANDIDATE_MANIFEST
    || path.join(ROOT, "build", "official-samples", "candidate.json"),
);
const loaded = loadOfficialSample(SAMPLE_MANIFEST);
const sample = loaded.sample;
const candidateStem = sample.sampleId.replace(/-candidate$/, "");
const MIGRATION_ANALYSIS = path.join(
  ROOT,
  "build",
  "official-samples",
  `${candidateStem}-shader-analysis.json`,
);
const PORT_ROOT = path.resolve(
  process.env.PCR_CANDIDATE_PORT_ROOT
    || path.join(
      ROOT,
      "..",
      "ptcgp-tools-master",
      "masterdata_decoder",
      ".output-full",
      "webgl-ports",
    ),
);
const EXPECTED = Object.freeze({
  "card-aura": [
    "card_aura_base_uniforms.json",
    "card_aura_col4_uniforms.json",
    "card_aura_old_noise_uniforms.json",
  ],
  "shadow-holograms": [
    "card_parallax_hologram_shadow_effect_uniforms.json",
    "card_parallax_hologram_shadow_layers_uniforms.json",
    "opaque_hologram_shadow_uniforms.json",
  ],
  "mega-rr": [
    "shadowbox_flash_uniforms.json",
  ],
  "shadowbox-effect-flow": [
    "shadowbox_effect_flow_default_uniforms.json",
    "shadowbox_effect_flow_use_col4_uniforms.json",
    "shadowbox_effect_flow_use_old_noise_uniforms.json",
  ],
});

const sampleManifestSha256 = officialSampleDigest(sample);
const expectedSample = {
  sampleId: sample.sampleId,
  sampleManifestSha256,
  unityVersion: sample.unity.serializedVersion,
  status: "candidate",
};
const expectedInventory = {
  schema: sample.proofSets.materialPrograms.inventorySchema,
  proofGraphSha256: sample.proofSets.materialPrograms.proofGraphSha256,
  portIndexSha256: sample.proofSets.materialPrograms.portIndexSha256,
};
const migrationAnalysis = JSON.parse(fs.readFileSync(MIGRATION_ANALYSIS, "utf8"));
assert.equal(migrationAnalysis.candidateSampleId, sample.sampleId);
assert.equal(migrationAnalysis.summary.staticReuseCandidates, 70);
assert.equal(migrationAnalysis.summary.staticReuseValidated, 69);
assert.equal(migrationAnalysis.summary.staticReuseRejected, 1);
assert.deepEqual(
  migrationAnalysis.summary.staticReuseBaselineEvidence,
  { "raw-selector-extraction": 70, "formal-port-manifest": 0 },
  "candidate static reuse must remain fully backed by raw baseline selector extraction",
);
assert.equal(migrationAnalysis.summary.staticReuseFieldMatches.programBindChannelsSame, 70);
const identities = new Set();
let count = 0;
let shadowboxFlashChecked = false;

for (const [group, expectedFiles] of Object.entries(EXPECTED)) {
  const directory = path.join(PORT_ROOT, group);
  const actualFiles = fs.readdirSync(directory)
    .filter((name) => name.endsWith("_uniforms.json"))
    .sort();
  assert.deepEqual(actualFiles, [...expectedFiles].sort(), `${group}: candidate manifest set changed`);
  for (const name of actualFiles) {
    const absolute = path.join(directory, name);
    const source = fs.readFileSync(absolute, "utf8");
    assert.doesNotMatch(source, /(?:[A-Za-z]:\\|[A-Za-z]:\/|\/Users\/)/, `${name}: absolute path leaked`);
    assert.doesNotMatch(source, /2022\.3\.62f2/, `${name}: baseline Unity identity leaked`);
    const manifest = JSON.parse(source);
    assert.deepEqual(manifest.official_sample, expectedSample, `${name}: official sample provenance`);
    assert.deepEqual(manifest.official_inventory, expectedInventory, `${name}: inventory provenance`);
    assert.equal(
      manifest.official_vertex_inputs?.unityVersion,
      sample.unity.serializedVersion,
      `${name}: vertex-input Unity version`,
    );
    assert.match(
      manifest.official_vertex_inputs?.sourceSha256 || "",
      /^[0-9a-f]{64}$/,
      `${name}: vertex-input source hash`,
    );
    const selector = manifest.official_selector;
    const identity = JSON.stringify([
      selector?.selectorId,
      selector?.candidateWitnessId,
      selector?.subshader,
      selector?.pass,
    ]);
    assert.match(selector?.selectorId || "", /^[0-9a-f]{64}$/, `${name}: selector ID`);
    assert.match(
      selector?.candidateWitnessId || "",
      /^[0-9a-f]{64}$/,
      `${name}: candidate witness ID`,
    );
    assert(!identities.has(identity), `${name}: duplicate composite selector identity`);
    identities.add(identity);
    if (group === "mega-rr" && name === "shadowbox_flash_uniforms.json") {
      assert.equal(
        selector.selectorId,
        "82528f3915b2b361479e0df196542fbf1ee40311c5b45fd2651300216150dd9c",
        `${name}: candidate selector identity`,
      );
      assert.equal(
        selector.candidateWitnessId,
        "7e163d22f08dc70773f66920293b530c37d7f5af1136edf3d24887e75fcae3c1",
        `${name}: candidate witness identity`,
      );
      assert.equal(
        selector.semanticExecutableId,
        "dfc77dc0e742fdfbdfda5e84e1b4b5de5ac03b0f09fe7f3565a8ee0d63f2bf94",
        `${name}: candidate semantic identity`,
      );
      assert.equal(
        manifest.official_shader_property_defaults?.textures?._MainTex,
        "black",
        `${name}: _MainTex texture default`,
      );
      assert.equal(
        manifest.official_shader_property_defaults?.textureDescriptors?._MainTex?.defaultName,
        "black",
        `${name}: _MainTex descriptor default`,
      );
      shadowboxFlashChecked = true;
    }
    count += 1;
  }
}

assert.equal(count, 10);
assert.equal(shadowboxFlashChecked, true, "ShadowBox/Flash default-only migration was not audited");
console.log(`Candidate migration-port audit OK: ${count}/10 manifests`);
console.log(`  sample:    ${sample.sampleId}`);
console.log(`  manifest:  ${sampleManifestSha256}`);
console.log(`  inventory: ${expectedInventory.proofGraphSha256}`);
