import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  FULL_RUNTIME_DEFINITION,
  fullRuntimeOfficialSampleIdentity,
  fullRuntimeOfficialSampleIdentityMatches,
  fullRuntimeSourceFiles,
  fullRuntimeSourceIdentityMatches,
  loadFullRuntimeDefinition,
  validateFullRuntimeCanonicalCorpus,
} from "./full-runtime-sources.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CANDIDATE_MANIFEST =
  "build/official-samples/ptcgp-1.7.0-unity-6000.0.69f1-candidate.json";

assert.equal(FULL_RUNTIME_DEFINITION.sample.status, "baseline");
assert.equal(FULL_RUNTIME_DEFINITION.explicitSelection, false);
assert.equal(
  fullRuntimeOfficialSampleIdentityMatches({}),
  true,
  "the implicit current baseline must retain legacy artifact compatibility",
);

const candidate = loadFullRuntimeDefinition({
  root: ROOT,
  manifestPath: CANDIDATE_MANIFEST,
});
const candidateCorpus = JSON.parse(fs.readFileSync(
  path.join(ROOT, candidate.canonicalCorpusRelative),
  "utf8",
));
assert.equal(candidate.sample.status, "candidate");
assert.equal(candidate.explicitSelection, true);
assert.equal(candidate.scenes.length, candidateCorpus.scenes.length);
assert.deepEqual(
  candidate.scenes.map(({ file }) => file),
  candidateCorpus.scenes.map(({ file }) => file),
);
assert(candidate.scenes.length > FULL_RUNTIME_DEFINITION.scenes.length);

const candidateIdentity = fullRuntimeOfficialSampleIdentity(candidate);
assert.equal(
  fullRuntimeOfficialSampleIdentityMatches(
    { officialSampleIdentity: candidateIdentity },
    candidate,
  ),
  true,
);
assert.equal(
  fullRuntimeOfficialSampleIdentityMatches({}, candidate),
  false,
  "candidate evidence must never inherit baseline identity implicitly",
);

const wrongManifestDigest = structuredClone(candidateIdentity);
wrongManifestDigest.sampleManifestSha256 = "f".repeat(64);
assert.equal(
  fullRuntimeOfficialSampleIdentityMatches(
    { officialSampleIdentity: wrongManifestDigest },
    candidate,
  ),
  false,
);

const wrongCorpusDigest = structuredClone(candidateIdentity);
wrongCorpusDigest.canonicalCorpus.sha256 = "f".repeat(64);
assert.equal(
  fullRuntimeOfficialSampleIdentityMatches(
    { officialSampleIdentity: wrongCorpusDigest },
    candidate,
  ),
  false,
);

const badCorpusBinding = structuredClone(candidate.sample);
badCorpusBinding.canonicalCorpus.sha256 = "f".repeat(64);
assert.throws(
  () => validateFullRuntimeCanonicalCorpus(badCorpusBinding, { root: ROOT }),
  /canonical corpus hash does not match/,
);

const wrongCorpusSample = structuredClone(candidate.sample);
wrongCorpusSample.sampleId = `${candidate.sampleId}-wrong`;
assert.throws(
  () => validateFullRuntimeCanonicalCorpus(wrongCorpusSample, { root: ROOT }),
  /candidate canonical corpus is not bound to the selected sampleId/,
);

const baselineSources = fullRuntimeSourceFiles(ROOT, FULL_RUNTIME_DEFINITION);
const candidateSources = fullRuntimeSourceFiles(ROOT, candidate);
assert.equal(
  baselineSources.includes(FULL_RUNTIME_DEFINITION.canonicalCorpusRelative),
  false,
  "implicit baseline source inventory shape must remain backward-compatible",
);
assert(candidateSources.includes(candidate.manifestRelative));
assert(candidateSources.includes(candidate.canonicalCorpusRelative));
for (const { file, textStem } of candidate.scenes) {
  assert(candidateSources.includes(`public/${file}`));
  assert(candidateSources.includes(`public/text/${textStem}.zh_TW.json`));
}

const baselineHashes = Object.fromEntries(
  baselineSources.map((file) => [file, "a".repeat(64)]),
);
assert.equal(
  fullRuntimeSourceIdentityMatches(
    { sourceFiles: baselineSources, sourceHashes: baselineHashes },
    candidateSources,
    Object.fromEntries(candidateSources.map((file) => [file, "a".repeat(64)])),
  ),
  false,
  "a baseline source inventory must not satisfy the candidate denominator",
);

console.log(
  `Full runtime sample selection tests OK `
  + `(${FULL_RUNTIME_DEFINITION.scenes.length} current baseline scenes, `
  + `${candidate.scenes.length} explicit candidate scenes)`,
);
