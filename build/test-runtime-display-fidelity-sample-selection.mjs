import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { auditRuntimeDisplayFidelity } from "./audit-runtime-display-fidelity.mjs";
import {
  fullRuntimeOfficialSampleIdentity,
  loadFullRuntimeDefinition,
} from "./full-runtime-sources.mjs";

const CANDIDATE_MANIFEST =
  "build/official-samples/ptcgp-1.7.0-unity-6000.0.69f1-candidate.json";

function officialIdentity(definition) {
  return fullRuntimeOfficialSampleIdentity(definition);
}

function capture(scene) {
  return {
    scene: scene.file,
    locale: "zh_TW",
    diagnostics: {
      surface: {
        devicePixelRatio: 2,
        cssViewport: [500, 400],
        canvasCssSize: [500, 400],
        canvasBackingSize: [1000, 800],
        drawingBufferSize: [1000, 800],
        dynamicUITextureSize: [1122, 1122],
      },
      display: {
        sourceSize: [1122, 1122],
        displayTargetSize: [1000, 800],
      },
      quality: { selected: "Middle" },
      tmp: {
        textureWidth: 1122,
        textureHeight: 1122,
        fallbackCount: 0,
      },
    },
  };
}

function artifact(definition, { identity = true, scenes = definition.scenes } = {}) {
  const value = {
    captures: Object.fromEntries(
      scenes.map((scene) => [`${scene.file}|zh_TW`, capture(scene)]),
    ),
  };
  if (identity) {
    value.officialSampleIdentity = structuredClone(
      officialIdentity(definition),
    );
  }
  return value;
}

function localRequirements(report) {
  return report.requirements.slice(0, 6);
}

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "pcr-display-fidelity-"));
const artifactPath = path.join(temp, "full-runtime.json");
const missingHostPath = path.join(temp, "missing-host.json");
const legacyHostPath = path.join(temp, "legacy-host.json");
const baseline = loadFullRuntimeDefinition();
const candidate = loadFullRuntimeDefinition({ manifestPath: CANDIDATE_MANIFEST });
const passFullRuntime = (file) => {
  const value = JSON.parse(fs.readFileSync(file, "utf8"));
  return {
    status: "pass",
    validCaptureCount: Object.keys(value.captures || {}).length,
    captures: [],
    errors: [],
  };
};

try {
  assert.equal(baseline.sample.status, "baseline");
  assert.equal(baseline.scenes.length, 4);
  assert.equal(candidate.sample.status, "candidate");
  assert.equal(candidate.scenes.length, 9);

  fs.writeFileSync(
    artifactPath,
    `${JSON.stringify(artifact(baseline, { identity: false }))}\n`,
  );
  const baselineReport = auditRuntimeDisplayFidelity({
    fullRuntimePath: artifactPath,
    hostPresentationPath: missingHostPath,
    fullRuntimeDefinition: baseline,
    auditFullRuntime: passFullRuntime,
  });
  assert.equal(baselineReport.officialSample.canonicalCorpus.sceneCount, 4);
  assert.equal(baselineReport.localRuntimeEligibility.status, "pass");
  assert.ok(localRequirements(baselineReport).every((item) => (
    item.status === "exact" && item.exactUnits === 4 && item.totalUnits === 4
  )));

  fs.writeFileSync(artifactPath, `${JSON.stringify(artifact(candidate))}\n`);
  const candidateReport = auditRuntimeDisplayFidelity({
    fullRuntimePath: artifactPath,
    hostPresentationPath: missingHostPath,
    officialSampleManifestPath: CANDIDATE_MANIFEST,
    fullRuntimeDefinition: candidate,
    auditFullRuntime: passFullRuntime,
  });
  assert.equal(candidateReport.officialSample.sampleId, candidate.sampleId);
  assert.equal(
    candidateReport.officialSample.sampleManifestSha256,
    candidate.sampleManifestSha256,
  );
  assert.equal(
    candidateReport.officialSample.canonicalCorpus.sha256,
    candidate.canonicalCorpusSha256,
  );
  assert.equal(
    candidateReport.officialSample.canonicalCorpus.path,
    candidate.canonicalCorpusRelative,
  );
  assert.equal(candidateReport.officialSample.canonicalCorpus.sceneCount, 9);
  assert.equal(candidateReport.localRuntimeEligibility.status, "pass");
  assert.ok(localRequirements(candidateReport).every((item) => (
    item.status === "exact" && item.exactUnits === 9 && item.totalUnits === 9
  )));
  assert.equal(candidateReport.fidelityPercent, null);
  assert.equal(Object.hasOwn(candidateReport, "exactPercent"), false);
  assert.equal(
    candidateReport.requirements.find((item) => item.id === "guest-vulkan-card-frame")
      .status,
    "runtime-required",
  );
  assert.equal(
    candidateReport.requirements.find((item) => item.id === "native-device-display")
      .status,
    "runtime-required",
  );

  fs.writeFileSync(legacyHostPath, `${JSON.stringify({
    schema: "pocket-card-render/official-host-presentation@1",
    status: "complete",
    classification: "emulator-host-compositor-only",
    api: "GraphicsAPI.OpenGL",
    captureSha256: "a".repeat(64),
    pixelDataIncluded: false,
    drawCount: 2,
    swapCount: 1,
    presentation: {
      containsGuestShaderDraws: false,
      upscales: [{}],
      backbuffers: [{ format: "RGBA8_SRGB" }],
    },
  })}\n`);
  const legacyHostCandidateReport = auditRuntimeDisplayFidelity({
    fullRuntimePath: artifactPath,
    hostPresentationPath: legacyHostPath,
    officialSampleDefinition: candidate,
    fullRuntimeDefinition: candidate,
    auditFullRuntime: passFullRuntime,
  });
  const hostRequirement = legacyHostCandidateReport.requirements
    .find((item) => item.id === "emulator-host-presentation");
  assert.equal(hostRequirement.status, "runtime-required");
  assert(hostRequirement.remaining.some((error) => /not bound/.test(error)));

  for (const oldArtifact of [
    artifact(baseline, { identity: false }),
    artifact(candidate, { scenes: baseline.scenes }),
  ]) {
    fs.writeFileSync(artifactPath, `${JSON.stringify(oldArtifact)}\n`);
    const report = auditRuntimeDisplayFidelity({
      fullRuntimePath: artifactPath,
      hostPresentationPath: missingHostPath,
      officialSampleDefinition: candidate,
      fullRuntimeDefinition: candidate,
      auditFullRuntime: passFullRuntime,
    });
    assert.equal(report.localRuntimeEligibility.status, "runtime-required");
    assert.ok(localRequirements(report).every((item) => (
      item.status === "runtime-required"
        && item.exactUnits === 0
        && item.totalUnits === 9
    )));
  }

  for (const mutate of [
    (identity) => { identity.sampleId = "wrong-candidate"; },
    (identity) => { identity.sampleManifestSha256 = "f".repeat(64); },
    (identity) => { identity.canonicalCorpus.sha256 = "f".repeat(64); },
  ]) {
    const wrongIdentity = artifact(candidate);
    mutate(wrongIdentity.officialSampleIdentity);
    fs.writeFileSync(artifactPath, `${JSON.stringify(wrongIdentity)}\n`);
    const report = auditRuntimeDisplayFidelity({
      fullRuntimePath: artifactPath,
      hostPresentationPath: missingHostPath,
      officialSampleDefinition: candidate,
      fullRuntimeDefinition: candidate,
      auditFullRuntime: passFullRuntime,
    });
    assert.equal(report.localRuntimeEligibility.artifactIdentityMatches, false);
    assert.ok(localRequirements(report).every((item) => item.exactUnits === 0));
  }

  fs.writeFileSync(artifactPath, `${JSON.stringify(artifact(candidate))}\n`);
  const wrongVerifierSample = auditRuntimeDisplayFidelity({
    fullRuntimePath: artifactPath,
    hostPresentationPath: missingHostPath,
    officialSampleDefinition: candidate,
    fullRuntimeDefinition: baseline,
    auditFullRuntime: passFullRuntime,
  });
  assert.equal(wrongVerifierSample.localRuntimeEligibility.definitionMatchesVerifier, false);
  assert.ok(localRequirements(wrongVerifierSample).every((item) => item.exactUnits === 0));

  console.log(
    "Runtime display fidelity sample selection: pass "
      + "(baseline 4, candidate 9, provenance fail-closed, no fidelity percent)",
  );
} finally {
  if (fs.existsSync(artifactPath)) fs.unlinkSync(artifactPath);
  if (fs.existsSync(legacyHostPath)) fs.unlinkSync(legacyHostPath);
  fs.rmdirSync(temp);
}
