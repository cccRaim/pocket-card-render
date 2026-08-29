import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { auditTmpRuntimeArtifact } from "./audit-tmp-runtime-evidence.mjs";
import {
  TMP_RUNTIME_DEFINITION,
  loadTmpRuntimeDefinition,
  tmpRuntimeCaptureInventoryMatches,
  tmpRuntimeExpectedCaptureKeys,
  tmpRuntimeOfficialSampleIdentity,
  tmpRuntimeOfficialSampleIdentityMatches,
  tmpRuntimeSourceFiles,
  validateTmpRuntimeCanonicalCorpus,
} from "./tmp-runtime-sources.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CANDIDATE_MANIFEST =
  "build/official-samples/ptcgp-1.7.0-unity-6000.0.69f1-candidate.json";

assert.equal(TMP_RUNTIME_DEFINITION.sample.status, "baseline");
assert.equal(TMP_RUNTIME_DEFINITION.explicitSelection, false);
assert.equal(
  tmpRuntimeOfficialSampleIdentityMatches({}),
  true,
  "implicit current baseline must retain legacy artifact compatibility",
);

const candidate = loadTmpRuntimeDefinition({
  root: ROOT,
  manifestPath: CANDIDATE_MANIFEST,
});
const candidateCorpus = JSON.parse(fs.readFileSync(
  path.join(ROOT, candidate.canonicalCorpusRelative),
  "utf8",
));
assert.equal(candidate.sample.status, "candidate");
assert.equal(candidate.explicitSelection, true);
assert.deepEqual(
  candidate.scenes.map(({ file }) => file),
  candidateCorpus.scenes.map(({ file }) => file),
);
assert(candidate.scenes.length > TMP_RUNTIME_DEFINITION.scenes.length);
assert.equal(tmpRuntimeExpectedCaptureKeys(candidate).length, candidate.scenes.length);

const candidateIdentity = tmpRuntimeOfficialSampleIdentity(candidate);
assert.equal(
  tmpRuntimeOfficialSampleIdentityMatches(
    { officialSampleIdentity: candidateIdentity },
    candidate,
  ),
  true,
);
assert.equal(
  tmpRuntimeOfficialSampleIdentityMatches({}, candidate),
  false,
  "candidate evidence must bind its sample identity explicitly",
);

const wrongSampleId = structuredClone(candidateIdentity);
wrongSampleId.sampleId = `${candidate.sampleId}-wrong`;
assert.equal(
  tmpRuntimeOfficialSampleIdentityMatches(
    { officialSampleIdentity: wrongSampleId },
    candidate,
  ),
  false,
);

const wrongManifestDigest = structuredClone(candidateIdentity);
wrongManifestDigest.sampleManifestSha256 = "f".repeat(64);
assert.equal(
  tmpRuntimeOfficialSampleIdentityMatches(
    { officialSampleIdentity: wrongManifestDigest },
    candidate,
  ),
  false,
);

const wrongCorpusDigest = structuredClone(candidateIdentity);
wrongCorpusDigest.canonicalCorpus.sha256 = "f".repeat(64);
assert.equal(
  tmpRuntimeOfficialSampleIdentityMatches(
    { officialSampleIdentity: wrongCorpusDigest },
    candidate,
  ),
  false,
);

const badCorpusBinding = structuredClone(candidate.sample);
badCorpusBinding.canonicalCorpus.sha256 = "f".repeat(64);
assert.throws(
  () => validateTmpRuntimeCanonicalCorpus(badCorpusBinding, { root: ROOT }),
  /canonical corpus hash does not match/,
);

const wrongCorpusSample = structuredClone(candidate.sample);
wrongCorpusSample.sampleId = `${candidate.sampleId}-wrong`;
assert.throws(
  () => validateTmpRuntimeCanonicalCorpus(wrongCorpusSample, { root: ROOT }),
  /candidate canonical corpus is not bound to the selected sampleId/,
);

const baselineSources = tmpRuntimeSourceFiles(ROOT, TMP_RUNTIME_DEFINITION);
const candidateSources = tmpRuntimeSourceFiles(ROOT, candidate);
assert.equal(
  baselineSources.includes(TMP_RUNTIME_DEFINITION.canonicalCorpusRelative),
  false,
  "implicit baseline source inventory shape must remain backward-compatible",
);
assert(candidateSources.includes(candidate.manifestRelative));
assert(candidateSources.includes(candidate.canonicalCorpusRelative));
assert(candidateSources.includes(candidate.canonicalScenesRelative));
for (const scene of candidate.scenes) {
  assert(candidateSources.includes(`public/${scene.file}`));
}

const oldCaptureInventory = {
  captures: Object.fromEntries(
    tmpRuntimeExpectedCaptureKeys(TMP_RUNTIME_DEFINITION).map((key) => [key, {}]),
  ),
};
assert.equal(
  tmpRuntimeCaptureInventoryMatches(oldCaptureInventory, TMP_RUNTIME_DEFINITION),
  true,
);
assert.equal(
  tmpRuntimeCaptureInventoryMatches(oldCaptureInventory, candidate),
  false,
  "the baseline capture set must not satisfy the candidate denominator",
);

const relabeledOldArtifact = {
  schemaVersion: 1,
  officialSample: candidate.sampleLabel,
  officialSampleIdentity: candidateIdentity,
  sourceHashes: {},
  captures: oldCaptureInventory.captures,
};
const relabeledAudit = auditTmpRuntimeArtifact(relabeledOldArtifact, {
  root: ROOT,
  definition: candidate,
});
assert.equal(relabeledAudit.status, "invalid");
assert(
  relabeledAudit.errors.some((error) =>
    error === `capture inventory must be exactly the ${candidate.scenes.length} canonical zh_TW scenes`),
  "the auditor did not reject the relabeled baseline capture inventory",
);

console.log(
  `TMP runtime sample selection tests OK `
  + `(${TMP_RUNTIME_DEFINITION.scenes.length} current baseline scenes, `
  + `${candidate.scenes.length} explicit candidate scenes)`,
);
