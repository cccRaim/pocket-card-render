import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
  CAPTURE_MANIFEST_SCHEMA,
  CAPTURE_SCHEMA,
  IMPORT_SCHEMA,
  RAW_CAPTURE_INVENTORY_SCHEMA,
  buildCandidateOfficialGuestRuntimeBatch,
  canonicalDigest,
  deterministicImportSnapshot,
} from "./build-candidate-official-guest-runtime-batch.mjs";
import {
  loadOfficialSample,
  officialSampleDigest,
} from "./official-sample.mjs";
import {
  REQUIRED_EVIDENCE_COVERAGE,
} from "./import-official-vulkan-runtime-capture.mjs";
import {
  classifyVulkanFunctionBoundaries,
} from "./gfxreconstruct-state-boundaries.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const BUILDER = path.join(
  ROOT,
  "build",
  "build-candidate-official-guest-runtime-batch.mjs",
);
const GFXRECON_TOOLCHAIN_PATH = path.join(
  ROOT,
  "build",
  "gfxreconstruct-toolchain.json",
);

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function writeJson(filename, value) {
  const encoded = `${JSON.stringify(value, null, 2)}\n`;
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  fs.writeFileSync(filename, encoded);
  return sha256(Buffer.from(encoded));
}

function readJson(filename) {
  return JSON.parse(fs.readFileSync(filename, "utf8"));
}

function artifactFields(report) {
  return Object.fromEntries(
    Object.entries(report.inputs.packageAndNativeSha256)
      .map(([name, value]) => [`${name}Sha256`, value]),
  );
}

function officialEvidenceFields(report) {
  return {
    materialProgramInventorySha256:
      report.inputs.officialEvidence.materialProgramInventory.sha256,
    proofGraphSha256:
      report.inputs.officialEvidence.materialProgramInventory
        .proofGraphSha256,
    portIndexSha256:
      report.inputs.officialEvidence.materialProgramInventory.portIndexSha256,
    programPortContractSha256:
      report.inputs.officialEvidence.programPortContract.sha256,
    programPortManifestSetSha256:
      report.inputs.officialEvidence.programPortManifests
        .manifestSetSha256,
    importerSha256:
      report.inputs.officialEvidence.importer.sha256,
  };
}

function writeRawCapture(cardRoot, card, ordinal) {
  const captureRoot = path.join(cardRoot, "capture");
  const events = Buffer.from(
    `${JSON.stringify({
      event: "capture-start",
      captureId: `capture-${ordinal}`,
      cardId: card.cardId,
    })}\n`
      + `${JSON.stringify({
        event: "present",
        captureId: `capture-${ordinal}`,
        presentIndex: ordinal,
        result: 0,
      })}\n`,
  );
  const shaderWords = new Uint32Array([
    0x07230203,
    0x00010000,
    ordinal + 1,
    4,
    0,
  ]);
  const shader = Buffer.from(
    shaderWords.buffer,
    shaderWords.byteOffset,
    shaderWords.byteLength,
  );
  const metadata = Buffer.from(`${JSON.stringify({
    cardId: card.cardId,
    captureId: `capture-${ordinal}`,
  })}\n`);
  const trace = Buffer.from(`fixture-gfxr:${card.cardId}:${ordinal}\n`);
  const rawGfxRecords = [{
    header: {
      "source-path": "trace.gfxr",
      "gfxrecon-version": "1.0.5",
      "vulkan-version": "1.4.350",
    },
  }, {
    index: 1,
    function: {
      name: "vkAllocateMemory",
      return: "VK_SUCCESS",
      args: {},
    },
  }, {
    index: 2,
    function: {
      name: "vkCreateBuffer",
      return: "VK_SUCCESS",
      args: {},
    },
  }, {
    index: 3,
    function: {
      name: "vkBindBufferMemory",
      return: "VK_SUCCESS",
      args: {},
    },
  }, {
    index: 4,
    function: {
      name: "vkMapMemory",
      return: "VK_SUCCESS",
      args: {},
    },
  }, {
    index: 5,
    function: {
      name: "vkFlushMappedMemoryRanges",
      return: "VK_SUCCESS",
      args: {},
    },
  }];
  const gfxreconstructJsonl = Buffer.from(
    `${rawGfxRecords.map((record) => JSON.stringify(record)).join("\n")}\n`,
  );
  const functionBoundaries = classifyVulkanFunctionBoundaries(
    rawGfxRecords
      .filter((record) => record.function)
      .map((record) => record.function.name),
  );
  const shaderPath = `shader-fixture-${shader.length}.spv`;
  const pinnedToolchainBytes = fs.readFileSync(GFXRECON_TOOLCHAIN_PATH);
  const pinnedToolchain = JSON.parse(pinnedToolchainBytes);
  const toolFact = (role) => {
    const expected = pinnedToolchain.tools[role];
    return {
      logicalPath: expected.executable,
      byteLength: expected.byteLength,
      sha256: expected.sha256,
      version: expected.versionIncludes.join("\n"),
    };
  };
  const conversionManifest = {
    schema: "pocket-card-render/gfxreconstruct-vulkan-audit-conversion@1",
    schemaVersion: 1,
    status: "exact-gfxreconstruct-jsonl-to-audit-events",
    scope: {
      sourceApi: "Vulkan",
      sourceTracePreserved: true,
      framebufferPixelsRead: false,
      bufferMemoryReconstructed: false,
      stateReconstruction: "partial-runtime-required",
      vulkanFunctionBoundaryContract: functionBoundaries.contract,
      unreconstructedFunctionFamilies:
        functionBoundaries.families.map(({ id }) => id),
      officialShaderRestorationPercent: null,
    },
    toolchain: {
      manifest: {
        logicalPath: "build/gfxreconstruct-toolchain.json",
        byteLength: pinnedToolchainBytes.length,
        sha256: sha256(pinnedToolchainBytes),
      },
      toolchainId: pinnedToolchain.toolchainId,
      converter: toolFact("converter"),
      extractor: toolFact("extractor"),
    },
    inputs: {
      trace: {
        logicalPath: "trace.gfxr",
        byteLength: trace.length,
        sha256: sha256(trace),
      },
      gfxreconstructJsonl: {
        logicalPath: "gfxreconstruct.jsonl",
        byteLength: gfxreconstructJsonl.length,
        sha256: sha256(gfxreconstructJsonl),
      },
      header: {
        "source-path": "trace.gfxr",
        "gfxrecon-version": "1.0.5",
        "vulkan-version": "1.4.350",
      },
    },
    summary: {
      sourceRecordCount: rawGfxRecords.length,
      sourceFunctionCount: functionBoundaries.sourceFunctionCallCount,
      uniqueFunctionCount: 5,
      emittedEventCount: 2,
      shaderModuleCount: 1,
      presentCount: 1,
      unsupportedRelevantFunctionCount: 0,
      eventReconstructedFunctionCount:
        functionBoundaries.eventReconstructedFunctionCallCount,
      unreconstructedFunctionCount:
        functionBoundaries.unreconstructedFunctionCallCount,
      unreconstructedUniqueFunctionCount:
        functionBoundaries.unreconstructedUniqueFunctionCount,
      unreconstructedFamilyCount:
        functionBoundaries.unreconstructedFamilyCount,
    },
    sourceFunctions: rawGfxRecords
      .filter((record) => record.function)
      .map((record) => record.function.name)
      .sort(),
    unsupportedRelevantFunctions: [],
    unreconstructedVulkanFunctions: functionBoundaries.families,
    shaderModules: [{
      module: `fixture-${ordinal}`,
      fnv1a64: "fixture",
      codeSize: shader.length,
      sha256: sha256(shader),
    }],
    artifacts: {
      events: {
        logicalPath: "events.jsonl",
        byteLength: events.length,
        sha256: sha256(events),
      },
    },
  };
  conversionManifest.proofSha256 = canonicalDigest(conversionManifest);
  const conversionManifestBytes = Buffer.from(
    `${JSON.stringify(conversionManifest, null, 2)}\n`,
  );
  const files = new Map([
    ["conversion-manifest.json", conversionManifestBytes],
    ["events.jsonl", events],
    ["gfxreconstruct.jsonl", gfxreconstructJsonl],
    ["metadata/session.json", metadata],
    [shaderPath, shader],
    ["trace.gfxr", trace],
  ]);
  for (const [relative, bytes] of files) {
    const filename = path.join(captureRoot, ...relative.split("/"));
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    fs.writeFileSync(filename, bytes);
  }
  return {
    schema: RAW_CAPTURE_INVENTORY_SCHEMA,
    root: "capture",
    artifacts: [...files.entries()]
      .map(([relative, bytes]) => ({
        path: relative,
        byteLength: bytes.length,
        sha256: sha256(bytes),
      }))
      .sort((left, right) => left.path.localeCompare(right.path)),
  };
}

function captureManifest({
  report,
  sample,
  card,
  ordinal,
  rawCapture,
}) {
  const seed = `${card.cardId}:${ordinal}`;
  return {
    schema: CAPTURE_MANIFEST_SCHEMA,
    schemaVersion: 1,
    captureSchema: CAPTURE_SCHEMA,
    candidate: {
      sampleId: report.candidate.sampleId,
      sampleManifestSha256: report.candidate.sampleManifestSha256,
      canonicalCorpusSha256: report.candidate.canonicalCorpusSha256,
      cardId: card.cardId,
      sceneFile: card.sceneFile,
      sceneSha256: card.sceneSha256,
      glbSha256: card.glbSha256,
    },
    package: {
      packageName: sample.game.packageName,
      versionName: sample.game.versionName,
      versionCode: sample.game.versionCode,
      architecture: sample.game.architecture,
    },
    artifacts: artifactFields(report),
    officialEvidence: officialEvidenceFields(report),
    device: {
      serialHashSha256: sha256(`serial:${seed}`),
      manufacturer: "Fixture",
      model: "Fixture Device",
      product: "fixture_product",
      hardware: "fixture_hardware",
      buildFingerprint: "fixture/build/fingerprint",
      androidRelease: "15",
      sdkInt: 35,
      abi: sample.game.architecture,
    },
    gpu: {
      vendorId: 0x13B5,
      deviceId: ordinal + 1,
      deviceName: `Fixture GPU ${ordinal}`,
      apiVersion: "1.3.280",
    },
    driver: {
      driverId: "fixture-driver",
      driverName: "Fixture Driver",
      driverInfo: `fixture-info-${ordinal}`,
      driverVersion: "1.0.0",
      conformanceVersion: "1.3.0.0",
    },
    vulkan: {
      loaderVersion: "1.3.280",
      instanceApiVersion: "1.3.280",
      physicalDeviceApiVersion: "1.3.280",
      instanceExtensionsSha256: sha256(`instance-ext:${seed}`),
      deviceExtensionsSha256: sha256(`device-ext:${seed}`),
      enabledLayersSha256: sha256(`layers:${seed}`),
    },
    captureTool: {
      name: "Fixture Vulkan Audit Layer",
      version: "1.0.0",
      binarySha256: sha256(`tool:${seed}`),
      configurationSha256: sha256(`tool-config:${seed}`),
    },
    session: {
      sessionId: `session-${ordinal}`,
      startedAtUtc: `2026-07-30T00:${String(ordinal).padStart(2, "0")}:00Z`,
      processId: 1000 + ordinal,
      processStartTimeUtc:
        `2026-07-30T00:${String(ordinal).padStart(2, "0")}:01Z`,
      packageName: sample.game.packageName,
      packageVersion: sample.game.versionName,
    },
    frame: {
      captureId: `capture-${ordinal}`,
      frameIndex: ordinal,
      presentIndex: ordinal,
      timestampUtc:
        `2026-07-30T00:${String(ordinal).padStart(2, "0")}:02Z`,
      eventsSha256:
        rawCapture.artifacts.find(({ path: relative }) => (
          relative === "events.jsonl"
        )).sha256,
    },
    rawCapture,
  };
}

function identityDigests(manifest) {
  return {
    deviceSha256: canonicalDigest(manifest.device),
    gpuSha256: canonicalDigest(manifest.gpu),
    driverSha256: canonicalDigest(manifest.driver),
    vulkanSha256: canonicalDigest(manifest.vulkan),
    captureToolSha256: canonicalDigest(manifest.captureTool),
    sessionSha256: canonicalDigest(manifest.session),
    frameSha256: canonicalDigest(manifest.frame),
    ...(manifest.rawCapture
      ? { rawCaptureSha256: canonicalDigest(manifest.rawCapture) }
      : {}),
  };
}

function importArtifact({
  report,
  card,
  manifest,
  captureManifestSha256,
}) {
  const evidenceCoverage = {
    schema: "pocket-card-render/official-vulkan-evidence-coverage@1",
    requirements: REQUIRED_EVIDENCE_COVERAGE.map((id) => {
      const facts = {
        cardId: card.cardId,
        captured: true,
      };
      return {
        id,
        status: "exact",
        reason: "synthetic complete fixture",
        facts,
        proofSha256: canonicalDigest({ id, status: "exact", facts }),
      };
    }),
  };
  const artifact = {
    schema: IMPORT_SCHEMA,
    status: "exact",
    provenance: {
      status: "complete",
      sampleId: report.candidate.sampleId,
      sampleManifestSha256: report.candidate.sampleManifestSha256,
      canonicalCorpusSha256: report.candidate.canonicalCorpusSha256,
      cardId: card.cardId,
      sceneSha256: card.sceneSha256,
      glbSha256: card.glbSha256,
      artifacts: artifactFields(report),
      officialEvidence: officialEvidenceFields(report),
      captureManifestSha256,
      frameEventsSha256: manifest.frame.eventsSha256,
      identities: identityDigests(manifest),
    },
    source: {
      declaredCaptureSchema: CAPTURE_SCHEMA,
      provenanceStatus: "complete",
      captureEventsSha256: manifest.frame.eventsSha256,
      sceneSha256: card.sceneSha256,
      glbSha256: card.glbSha256,
      card: card.cardId,
      officialEvidence: {
        kind: "candidate-material-program-inventory",
        sha256:
          report.inputs.officialEvidence.materialProgramInventory.sha256,
        proofGraphSha256:
          report.inputs.officialEvidence.materialProgramInventory
            .proofGraphSha256,
        portIndexSha256:
          report.inputs.officialEvidence.materialProgramInventory
            .portIndexSha256,
        programPortContractSha256:
          report.inputs.officialEvidence.programPortContract.sha256,
        programPortManifestSetSha256:
          report.inputs.officialEvidence.programPortManifests
            .manifestSetSha256,
      },
    },
    capture: {
      matchedCardScopes: 1,
      successfulPresents: 1,
      captureStarts: [{ captureId: manifest.frame.captureId }],
      presents: [{
        presentIndex: manifest.frame.presentIndex,
        result: 0,
      }],
      provenance: { status: "complete", missing: [] },
    },
    bestSummary: {
      expected: 1,
      observed: 1,
      exact: 1,
      unresolved: 0,
      mismatch: 0,
      exactProgram: 1,
      exactProgramExpected: 1,
    },
    evidenceCoverage,
    scopes: [{
      assignmentSearchTruncated: false,
      submissions: [{ queueSubmitOrdinal: 0 }],
    }],
  };
  artifact.provenance.deterministicImportSha256 = canonicalDigest(
    deterministicImportSnapshot(artifact),
  );
  return artifact;
}

function buildFixtureBatch(root) {
  return buildCandidateOfficialGuestRuntimeBatch({
    artifactRoot: root,
    importCapture({ captureDir }) {
      return readJson(path.join(path.dirname(captureDir), "import.json"));
    },
  });
}

function createCompleteFixture({ includeRawCapture = true } = {}) {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "pcr-candidate-guest-runtime-"),
  );
  const loaded = loadOfficialSample(
    "build/official-samples/candidate.json",
  );
  const sample = loaded.sample;
  assert.equal(
    officialSampleDigest(sample),
    buildCandidateOfficialGuestRuntimeBatch({ artifactRoot: root })
      .report.candidate.sampleManifestSha256,
  );
  const denominator = buildCandidateOfficialGuestRuntimeBatch({
    artifactRoot: root,
  }).report;
  denominator.cards.forEach((card, ordinal) => {
    const cardRoot = path.join(root, card.cardId);
    const rawCapture = includeRawCapture
      ? writeRawCapture(cardRoot, card, ordinal)
      : null;
    const manifest = captureManifest({
      report: denominator,
      sample,
      card,
      ordinal,
      rawCapture: rawCapture || {
        schema: RAW_CAPTURE_INVENTORY_SCHEMA,
        root: "capture",
        artifacts: [{
          path: "events.jsonl",
          byteLength: 1,
          sha256: sha256(`missing-events:${card.cardId}`),
        }],
      },
    });
    if (!includeRawCapture) delete manifest.rawCapture;
    const manifestSha256 = writeJson(
      path.join(cardRoot, "capture-manifest.json"),
      manifest,
    );
    writeJson(
      path.join(cardRoot, "import.json"),
      importArtifact({
        report: denominator,
        card,
        manifest,
        captureManifestSha256: manifestSha256,
      }),
    );
  });
  return { root, sample, denominator };
}

function withFixture(callback) {
  const fixture = createCompleteFixture();
  try {
    callback(fixture);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
}

test("derives the fail-closed 9-card denominator without creating captures", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pcr-empty-guest-runtime-"));
  try {
    const before = fs.readdirSync(root);
    const { report } = buildCandidateOfficialGuestRuntimeBatch({
      artifactRoot: root,
    });
    assert.deepEqual(report.summary, {
      requiredCardCount: 9,
      completeCardCount: 0,
      runtimeRequiredCardCount: 9,
      captureManifestCount: 0,
      importArtifactCount: 0,
      fidelityContribution: 0,
    });
    assert(report.cards.every((card) => (
      card.status === "runtime-required"
      && card.fidelityContribution === 0
      && card.missing.includes("capture-manifest.json")
      && card.missing.includes("import.json")
      && card.staticExpectedDraws.expectedDrawCount > 0
      && card.staticExpectedDraws.formalPortDrawCount
        === card.staticExpectedDraws.pipelineExpectationDrawCount
      && card.staticExpectedDraws
        .unresolvedPipelineExpectationDrawCount === 0
    )));
    assert.deepEqual(fs.readdirSync(root), before);
    assert.equal(report.scope.createsCaptureData, false);
    assert.equal(report.claims.officialShaderRestorationPercent, null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("accepts only a fully composite-bound 9-card artifact batch", () => {
  withFixture(({ root }) => {
    const { report } = buildFixtureBatch(root);
    assert.equal(
      report.summary.completeCardCount,
      9,
      JSON.stringify(report.cards[0].missing),
    );
    assert.equal(report.summary.runtimeRequiredCardCount, 0);
    assert.equal(report.summary.fidelityContribution, 0);
    assert(report.cards.every(
      (card) => card.status === "complete-static-validation",
    ));
  });
});

test("synthetic manifest and import JSON without raw capture stay runtime-required", () => {
  const fixture = createCompleteFixture({ includeRawCapture: false });
  try {
    const { report } = buildFixtureBatch(fixture.root);
    assert.equal(report.summary.completeCardCount, 0);
    assert.equal(report.summary.runtimeRequiredCardCount, 9);
    assert(report.cards.every((card) => (
      card.status === "runtime-required"
      && card.missing.includes("captureManifest.rawCapture")
      && card.evidence === null
    )));
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("missing per-card evidence remains runtime-required", () => {
  withFixture(({ root, denominator }) => {
    fs.rmSync(path.join(
      root,
      denominator.cards[0].cardId,
      "import.json",
    ));
    const { report } = buildFixtureBatch(root);
    assert.equal(report.summary.completeCardCount, 8);
    assert.equal(report.summary.runtimeRequiredCardCount, 1);
    assert.equal(report.summary.fidelityContribution, 0);
  });
});

test("one incomplete evidence category keeps the card runtime-required", () => {
  withFixture(({ root, denominator }) => {
    const card = denominator.cards[0];
    const importFile = path.join(root, card.cardId, "import.json");
    const imported = readJson(importFile);
    const descriptor = imported.evidenceCoverage.requirements.find(
      ({ id }) => id === "descriptorBindings",
    );
    descriptor.status = "runtime-required";
    descriptor.facts = null;
    descriptor.proofSha256 = null;
    writeJson(importFile, imported);

    const { report } = buildFixtureBatch(root);
    assert.equal(report.summary.completeCardCount, 8);
    assert.equal(report.summary.runtimeRequiredCardCount, 1);
    assert(
      report.cards[0].missing.includes(
        "import.evidenceCoverage.descriptorBindings=exact",
      ),
    );
  });
});

test("identity mutations and duplicate frames fail closed", () => {
  const mutations = [
    {
      name: "scene SHA",
      mutate({ root, denominator }) {
        const card = denominator.cards[0];
        const file = path.join(root, card.cardId, "capture-manifest.json");
        const value = readJson(file);
        value.candidate.sceneSha256 = "0".repeat(64);
        writeJson(file, value);
      },
      pattern: /sceneSha256 identity mismatch/,
    },
    {
      name: "sample manifest SHA",
      mutate({ root, denominator }) {
        const card = denominator.cards[0];
        const file = path.join(root, card.cardId, "import.json");
        const value = readJson(file);
        value.provenance.sampleManifestSha256 = "1".repeat(64);
        writeJson(file, value);
      },
      pattern: /sampleManifestSha256 identity mismatch/,
    },
    {
      name: "GPU digest",
      mutate({ root, denominator }) {
        const card = denominator.cards[0];
        const file = path.join(root, card.cardId, "capture-manifest.json");
        const value = readJson(file);
        value.gpu.deviceName = "Mutated GPU";
        const manifestSha256 = writeJson(file, value);
        const importFile = path.join(root, card.cardId, "import.json");
        const imported = readJson(importFile);
        imported.provenance.captureManifestSha256 = manifestSha256;
        writeJson(importFile, imported);
      },
      pattern: /gpuSha256 identity mismatch/,
    },
    {
      name: "libunity SHA",
      mutate({ root, denominator }) {
        const card = denominator.cards[0];
        const file = path.join(root, card.cardId, "capture-manifest.json");
        const value = readJson(file);
        value.artifacts.libunitySha256 = "2".repeat(64);
        writeJson(file, value);
      },
      pattern: /libunitySha256 identity mismatch/,
    },
    {
      name: "capture tool digest",
      mutate({ root, denominator }) {
        const card = denominator.cards[0];
        const file = path.join(root, card.cardId, "capture-manifest.json");
        const value = readJson(file);
        value.captureTool.binarySha256 = "3".repeat(64);
        const manifestSha256 = writeJson(file, value);
        const importFile = path.join(root, card.cardId, "import.json");
        const imported = readJson(importFile);
        imported.provenance.captureManifestSha256 = manifestSha256;
        writeJson(importFile, imported);
      },
      pattern: /captureToolSha256 identity mismatch/,
    },
    {
      name: "raw event bytes",
      mutate({ root, denominator }) {
        const card = denominator.cards[0];
        fs.appendFileSync(
          path.join(root, card.cardId, "capture", "events.jsonl"),
          `${JSON.stringify({ event: "forged-event" })}\n`,
        );
      },
      pattern: /raw capture artifact identity mismatch: events\.jsonl/,
    },
    {
      name: "conversion toolchain identity",
      mutate({ root, denominator }) {
        const card = denominator.cards[0];
        const cardRoot = path.join(root, card.cardId);
        const conversionFile = path.join(
          cardRoot,
          "capture",
          "conversion-manifest.json",
        );
        const conversion = readJson(conversionFile);
        conversion.toolchain.converter.sha256 = "4".repeat(64);
        delete conversion.proofSha256;
        conversion.proofSha256 = canonicalDigest(conversion);
        const conversionSha256 = writeJson(conversionFile, conversion);

        const manifestFile = path.join(cardRoot, "capture-manifest.json");
        const manifest = readJson(manifestFile);
        const conversionArtifact = manifest.rawCapture.artifacts.find(
          ({ path: relative }) => relative === "conversion-manifest.json",
        );
        conversionArtifact.byteLength = fs.statSync(conversionFile).size;
        conversionArtifact.sha256 = conversionSha256;
        const manifestSha256 = writeJson(manifestFile, manifest);

        const importFile = path.join(cardRoot, "import.json");
        const imported = readJson(importFile);
        imported.provenance.captureManifestSha256 = manifestSha256;
        imported.provenance.identities.rawCaptureSha256 =
          canonicalDigest(manifest.rawCapture);
        writeJson(importFile, imported);
      },
      pattern: /conversion toolchain converter identity differs/,
    },
    {
      name: "hidden unreconstructed Vulkan state family",
      mutate({ root, denominator }) {
        const card = denominator.cards[0];
        const cardRoot = path.join(root, card.cardId);
        const conversionFile = path.join(
          cardRoot,
          "capture",
          "conversion-manifest.json",
        );
        const conversion = readJson(conversionFile);
        const family = conversion.unreconstructedVulkanFunctions.find(
          ({ id }) => id === "memoryAllocationAndMapping",
        );
        family.callCount -= 1;
        family.functions[0].callCount -= 1;
        conversion.summary.unreconstructedFunctionCount -= 1;
        delete conversion.proofSha256;
        conversion.proofSha256 = canonicalDigest(conversion);
        const conversionSha256 = writeJson(conversionFile, conversion);

        const manifestFile = path.join(cardRoot, "capture-manifest.json");
        const manifest = readJson(manifestFile);
        const conversionArtifact = manifest.rawCapture.artifacts.find(
          ({ path: relative }) => relative === "conversion-manifest.json",
        );
        conversionArtifact.byteLength = fs.statSync(conversionFile).size;
        conversionArtifact.sha256 = conversionSha256;
        const manifestSha256 = writeJson(manifestFile, manifest);

        const importFile = path.join(cardRoot, "import.json");
        const imported = readJson(importFile);
        imported.provenance.captureManifestSha256 = manifestSha256;
        imported.provenance.identities.rawCaptureSha256 =
          canonicalDigest(manifest.rawCapture);
        writeJson(importFile, imported);
      },
      pattern: /conversion unreconstructed Vulkan function denominator differs/,
    },
    {
      name: "raw inventory provenance digest",
      mutate({ root, denominator }) {
        const card = denominator.cards[0];
        const manifestFile = path.join(
          root,
          card.cardId,
          "capture-manifest.json",
        );
        const manifest = readJson(manifestFile);
        manifest.rawCapture.artifacts.reverse();
        const manifestSha256 = writeJson(manifestFile, manifest);
        const importFile = path.join(root, card.cardId, "import.json");
        const imported = readJson(importFile);
        imported.provenance.captureManifestSha256 = manifestSha256;
        writeJson(importFile, imported);
      },
      pattern: /rawCaptureSha256 identity mismatch/,
    },
    {
      name: "undeclared raw artifact",
      mutate({ root, denominator }) {
        const card = denominator.cards[0];
        fs.writeFileSync(
          path.join(root, card.cardId, "capture", "undeclared.bin"),
          "not declared",
        );
      },
      pattern: /raw capture artifact inventory differs from files on disk/,
    },
    {
      name: "raw artifact path traversal",
      mutate({ root, denominator }) {
        const card = denominator.cards[0];
        const file = path.join(root, card.cardId, "capture-manifest.json");
        const value = readJson(file);
        value.rawCapture.artifacts[0].path = "../events.jsonl";
        writeJson(file, value);
      },
      pattern: /must stay inside the raw capture root/,
    },
    {
      name: "no captured shader",
      mutate({ root, denominator }) {
        const card = denominator.cards[0];
        const file = path.join(root, card.cardId, "capture-manifest.json");
        const value = readJson(file);
        const shader = value.rawCapture.artifacts.find(
          ({ path: relative }) => relative.endsWith(".spv"),
        );
        value.rawCapture.artifacts =
          value.rawCapture.artifacts.filter((artifact) => artifact !== shader);
        fs.rmSync(path.join(
          root,
          card.cardId,
          "capture",
          ...shader.path.split("/"),
        ));
        writeJson(file, value);
      },
      pattern: /must include at least one shader-\*\.spv/,
    },
    {
      name: "duplicate frame",
      mutate({ root, denominator }) {
        const first = denominator.cards[0];
        const second = denominator.cards[1];
        const firstManifest = readJson(path.join(
          root,
          first.cardId,
          "capture-manifest.json",
        ));
        const secondManifestFile = path.join(
          root,
          second.cardId,
          "capture-manifest.json",
        );
        const secondManifest = readJson(secondManifestFile);
        secondManifest.frame = firstManifest.frame;
        secondManifest.rawCapture = firstManifest.rawCapture;
        const firstCaptureRoot = path.join(
          root,
          first.cardId,
          "capture",
        );
        const secondCaptureRoot = path.join(
          root,
          second.cardId,
          "capture",
        );
        fs.rmSync(secondCaptureRoot, { recursive: true, force: true });
        fs.cpSync(firstCaptureRoot, secondCaptureRoot, { recursive: true });
        const manifestSha256 = writeJson(
          secondManifestFile,
          secondManifest,
        );
        const importFile = path.join(root, second.cardId, "import.json");
        const imported = readJson(importFile);
        imported.provenance.captureManifestSha256 = manifestSha256;
        imported.provenance.frameEventsSha256 =
          secondManifest.frame.eventsSha256;
        imported.provenance.identities.frameSha256 =
          canonicalDigest(secondManifest.frame);
        imported.provenance.identities.rawCaptureSha256 =
          canonicalDigest(secondManifest.rawCapture);
        imported.source.captureEventsSha256 =
          secondManifest.frame.eventsSha256;
        imported.capture.captureStarts = [{
          captureId: secondManifest.frame.captureId,
        }];
        imported.capture.presents = [{
          presentIndex: secondManifest.frame.presentIndex,
          result: 0,
        }];
        writeJson(importFile, imported);
      },
      pattern: /duplicate frame identities/,
    },
  ];
  for (const mutation of mutations) {
    withFixture((fixture) => {
      mutation.mutate(fixture);
      assert.throws(
        () => buildCandidateOfficialGuestRuntimeBatch({
          artifactRoot: fixture.root,
        }),
        mutation.pattern,
        mutation.name,
      );
    });
  }
});

test("--check is stable and --require-complete rejects missing evidence", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pcr-required-guest-"));
  try {
    const freshReport = path.join(root, "fresh-report.json");
    const generated = spawnSync(
      process.execPath,
      [
        BUILDER,
        "--artifact-root",
        root,
        "--out",
        freshReport,
      ],
      { cwd: ROOT, encoding: "utf8" },
    );
    assert.equal(generated.status, 0, generated.stderr || generated.stdout);
    const checked = spawnSync(
      process.execPath,
      [
        BUILDER,
        "--artifact-root",
        root,
        "--out",
        freshReport,
        "--check",
      ],
      { cwd: ROOT, encoding: "utf8" },
    );
    assert.equal(checked.status, 0, checked.stderr || checked.stdout);

    const staleReport = path.join(root, "stale-report.json");
    fs.writeFileSync(staleReport, "{}\n");
    const stale = spawnSync(
      process.execPath,
      [
        BUILDER,
        "--artifact-root",
        root,
        "--out",
        staleReport,
        "--check",
      ],
      { cwd: ROOT, encoding: "utf8" },
    );
    assert.notEqual(stale.status, 0);
    assert.match(
      stale.stderr + stale.stdout,
      /candidate guest runtime batch is stale/,
    );

    const required = spawnSync(
      process.execPath,
      [
        BUILDER,
        "--artifact-root",
        root,
        "--out",
        path.join(root, "report.json"),
        "--require-complete",
      ],
      { cwd: ROOT, encoding: "utf8" },
    );
    assert.notEqual(required.status, 0);
    assert.match(
      required.stderr + required.stdout,
      /requires complete 9\/9 evidence/,
    );
    assert.equal(fs.existsSync(path.join(root, "report.json")), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
