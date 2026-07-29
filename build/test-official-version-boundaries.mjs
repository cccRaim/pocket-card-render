import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  loadOfficialSample,
  officialSample,
  officialSampleSha256,
  validateOfficialSample,
} from "./official-sample.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

assert.equal(officialSample.game.versionName, "1.6.0");
assert.equal(officialSample.unity.serializedVersion, "2022.3.62f2");
assert.throws(
  () => validateOfficialSample({ ...officialSample, schemaVersion: 4 }),
  /unsupported schemaVersion/,
);
assert.throws(
  () => validateOfficialSample({ ...officialSample, schemaVersion: 3 }),
  /candidate-only/,
);
assert.throws(
  () => validateOfficialSample({
    ...officialSample,
    game: { ...officialSample.game, architecture: "x86_64" },
  }),
  /unsupported architecture/,
);

const pythonResult = spawnSync("python", ["-B", "build/official_sample.py", "--json"], {
  cwd: ROOT,
  encoding: "utf8",
  shell: process.platform === "win32",
  windowsHide: true,
});
assert.equal(pythonResult.status, 0, pythonResult.stderr);
const pythonSample = JSON.parse(pythonResult.stdout);
assert.equal(pythonSample.sample.sampleId, officialSample.sampleId);
assert.equal(
  pythonSample.sampleManifestSha256,
  officialSampleSha256,
);

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "pcr-official-sample-"));
try {
  const candidatePath = path.join(temp, "candidate.json");
  const candidate = structuredClone(officialSample);
  const candidateGameVersion = ["1", "7", "0"].join(".");
  const candidateUnityVersion = ["2022", "3", "70f1"].join(".");
  candidate.sampleId = `ptcgp-${candidateGameVersion}-unity-${candidateUnityVersion}`;
  candidate.status = "candidate";
  candidate.game.versionName = candidateGameVersion;
  candidate.game.versionCode += 1;
  candidate.game.apkmBasename =
    `${candidate.game.packageName}_${candidateGameVersion}.apkm`;
  candidate.unity.serializedVersion = candidateUnityVersion;
  candidate.unity.playerBuildVersion = `${candidateUnityVersion}_deadbeef`;
  candidate.unity.releaseSupportVersion = `${candidateUnityVersion}c1_deadbeef`;
  fs.writeFileSync(candidatePath, `${JSON.stringify(candidate, null, 2)}\n`);
  assert.equal(loadOfficialSample(candidatePath).sample.sampleId, candidate.sampleId);

  const unresolved = (reason) => ({ status: "unresolved", reason });
  const splitCandidatePath = path.join(temp, "split-candidate.json");
  const splitCandidate = structuredClone(candidate);
  splitCandidate.schemaVersion = 3;
  splitCandidate.game.packageSource = {
    kind: "split-directory",
    splits: {
      baseApk: "base.apk",
      arm64Split: "arm64.apk",
      bundledTreeSplit: "bundledtree.apk",
    },
  };
  delete splitCandidate.game.apkmBasename;
  splitCandidate.unity.playerBuildVersion = unresolved(
    "matching release player has not been acquired",
  );
  splitCandidate.unity.releaseSupportVersion = unresolved(
    "matching release support has not been acquired",
  );
  splitCandidate.artifacts.apkm = unresolved(
    "official source was delivered as split APK files",
  );
  splitCandidate.artifacts.unityReleasePlayer = unresolved(
    "matching release player has not been acquired",
  );
  splitCandidate.artifacts.unityReleaseSymbols = unresolved(
    "matching release symbols have not been acquired",
  );
  splitCandidate.canonicalCorpus = unresolved(
    "candidate canonical corpus has not been regenerated",
  );
  fs.writeFileSync(
    splitCandidatePath,
    `${JSON.stringify(splitCandidate, null, 2)}\n`,
  );
  assert.equal(
    loadOfficialSample(splitCandidatePath).sample.schemaVersion,
    3,
  );
  assert.throws(
    () => validateOfficialSample({
      ...splitCandidate,
      artifacts: {
        ...splitCandidate.artifacts,
        libunity: unresolved("short"),
      },
    }),
    /must explain why/,
  );

  const result = spawnSync(process.execPath, [
    "build/audit-official-version-boundaries.mjs",
    "--candidate",
    candidatePath,
    "--json",
  ], {
    cwd: ROOT,
    encoding: "utf8",
    windowsHide: true,
  });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert(report.migration.changedPaths.includes("game.versionName"));
  assert(report.migration.changedPaths.includes("unity.serializedVersion"));
  assert.deepEqual(
    report.migration.invalidatedDomains.map(({ id }) => id),
    [
      "package-native",
      "unity-runtime",
      "serialized-assets",
      "shader-programs",
      "runtime-evidence",
      "documentation",
    ],
  );

  const missingCandidateResult = spawnSync(process.execPath, [
    "build/audit-official-version-boundaries.mjs",
    "--candidate",
    "--json",
  ], {
    cwd: ROOT,
    encoding: "utf8",
    windowsHide: true,
  });
  assert.notEqual(missingCandidateResult.status, 0);
  assert.match(
    missingCandidateResult.stderr,
    /--candidate requires a manifest or pointer path/,
  );

  const defaultCandidateResult = spawnSync(process.execPath, [
    "build/audit-official-version-boundaries.mjs",
    "--candidate",
    "build/official-samples/candidate.json",
    "--json",
  ], {
    cwd: ROOT,
    encoding: "utf8",
    windowsHide: true,
  });
  assert.equal(defaultCandidateResult.status, 0, defaultCandidateResult.stderr);
  const defaultCandidateReport = JSON.parse(defaultCandidateResult.stdout);
  assert.equal(
    defaultCandidateReport.migration.candidateSampleId,
    "ptcgp-1.7.0-unity-6000.0.69f1-candidate",
  );

  const incompleteCandidateResult = spawnSync(process.execPath, [
    "build/audit-official-version-boundaries.mjs",
    "--candidate",
    "build/official-samples/candidate.json",
    "--require-complete",
    "--json",
  ], {
    cwd: ROOT,
    encoding: "utf8",
    windowsHide: true,
    env: {
      ...process.env,
      PCR_SKIP_CANDIDATE_READINESS: "1",
    },
  });
  assert.notEqual(incompleteCandidateResult.status, 0);
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}

console.log("OK official sample selection, validation, and migration invalidation");
