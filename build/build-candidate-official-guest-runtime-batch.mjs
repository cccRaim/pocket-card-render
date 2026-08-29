#!/usr/bin/env node
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  loadOfficialSample,
  officialSampleDigest,
} from "./official-sample.mjs";
import { atomicWriteFileSync } from "./atomic-publish.mjs";
import {
  buildCandidateExpectedDraws,
  importOfficialVulkanCapture,
  parseGlbPrimitiveDraws,
  REQUIRED_EVIDENCE_COVERAGE,
} from "./import-official-vulkan-runtime-capture.mjs";
import {
  classifyVulkanFunctionBoundaries,
} from "./gfxreconstruct-state-boundaries.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_CANDIDATE = "build/official-samples/candidate.json";
export const CAPTURE_MANIFEST_SCHEMA =
  "pocket-card-render/candidate-official-guest-capture-manifest@1";
export const IMPORT_SCHEMA =
  "pocket-card-render/official-vulkan-runtime-import@1";
export const CAPTURE_SCHEMA =
  "pocket-card-render/official-vulkan-audit-capture@1";
export const RAW_CAPTURE_INVENTORY_SCHEMA =
  "pocket-card-render/candidate-raw-capture-artifact-inventory@1";
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const RAW_CAPTURE_ROOT = "capture";
const RAW_CAPTURE_EVENTS = "events.jsonl";
const RAW_CAPTURE_TRACE = "trace.gfxr";
const RAW_CAPTURE_GFXRECON_JSONL = "gfxreconstruct.jsonl";
const RAW_CAPTURE_CONVERSION_MANIFEST = "conversion-manifest.json";
const RAW_CAPTURE_SHADER_PATTERN = /^shader-[^/]+\.spv$/;
const GFXRECON_CONVERSION_SCHEMA =
  "pocket-card-render/gfxreconstruct-vulkan-audit-conversion@1";
const GFXRECON_TOOLCHAIN_SCHEMA =
  "pocket-card-render/gfxreconstruct-toolchain@1";
const GFXRECON_TOOLCHAIN_PATH = path.join(
  ROOT,
  "build",
  "gfxreconstruct-toolchain.json",
);
const REQUIRED_ARTIFACTS = Object.freeze([
  "baseApk",
  "arm64Split",
  "bundledTreeSplit",
  "libunity",
  "libil2cpp",
]);

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

function digest(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

export function canonicalDigest(value) {
  return digest(Buffer.from(JSON.stringify(canonicalize(value))));
}

function fileIdentity(filename) {
  const bytes = fs.readFileSync(filename);
  return {
    byteLength: bytes.length,
    sha256: digest(bytes),
  };
}

function serialize(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function portRouteKey(row) {
  return [
    row.selectorId,
    row.candidateWitnessId,
    row.subshader,
    row.pass,
  ].join(":");
}

function loadCandidatePortManifests(contract, portRoot) {
  const root = path.resolve(portRoot);
  assert(
    fs.statSync(root, { throwIfNoEntry: false })?.isDirectory(),
    `candidate port root is absent: ${root}`,
  );
  const manifests = new Map();
  const facts = [];
  for (const port of contract.ports || []) {
    assert(
      typeof port.manifest === "string"
        && port.manifest.startsWith("candidate-port:"),
      `candidate port ${portRouteKey(port)} has no candidate-port manifest`,
    );
    const relative = validateArtifactRelativePath(
      port.manifest.slice("candidate-port:".length),
      `candidate port ${portRouteKey(port)} manifest`,
    );
    const filename = path.resolve(root, ...relative.split("/"));
    assert(
      filename.startsWith(`${root}${path.sep}`),
      `candidate port manifest escapes the port root: ${relative}`,
    );
    const identity = fileIdentity(filename);
    assert.equal(
      identity.sha256,
      port.manifestSha256,
      `candidate port manifest identity differs: ${relative}`,
    );
    const key = portRouteKey(port);
    assert(
      !manifests.has(key),
      `candidate port manifest route is duplicated: ${key}`,
    );
    const manifest = readJson(
      filename,
      `candidate port manifest ${relative}`,
    );
    manifests.set(key, {
      manifest,
      sha256: identity.sha256,
      logicalPath: port.manifest,
    });
    facts.push({
      route: key,
      logicalPath: port.manifest,
      ...identity,
    });
  }
  facts.sort((left, right) => left.route.localeCompare(right.route));
  return {
    manifests,
    facts,
    sha256: canonicalDigest(facts),
  };
}

function isFile(filename) {
  return fs.statSync(filename, { throwIfNoEntry: false })?.isFile() === true;
}

function readJson(filename, label) {
  let value;
  try {
    value = JSON.parse(fs.readFileSync(filename, "utf8").replace(/^\uFEFF/, ""));
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error.message}`);
  }
  assert(value && typeof value === "object" && !Array.isArray(value),
    `${label} root must be an object`);
  return value;
}

function requireSha256(value, label) {
  assert(SHA256_PATTERN.test(value || ""), `${label} must be a lowercase SHA-256`);
}

function requireString(value, label) {
  assert(typeof value === "string" && value.trim().length > 0,
    `${label} must be a non-empty string`);
}

function requireInteger(value, label, minimum = 0) {
  assert(Number.isInteger(value) && value >= minimum,
    `${label} must be an integer >= ${minimum}`);
}

function requireIsoUtc(value, label) {
  requireString(value, label);
  assert(value.endsWith("Z") && !Number.isNaN(Date.parse(value)),
    `${label} must be an ISO UTC timestamp`);
}

function expectedArtifactHashes(sample) {
  return Object.fromEntries(
    REQUIRED_ARTIFACTS.map((name) => {
      const artifact = sample.artifacts[name];
      assert.equal(artifact?.status, "resolved", `${name} must be resolved`);
      requireSha256(artifact.sha256, `${name}.sha256`);
      return [name, artifact.sha256];
    }),
  );
}

function optionalExpected({
  value,
  expected,
  label,
  missing,
  validate = requireString,
}) {
  if (value === undefined || value === null || value === "") {
    missing.push(label);
    return false;
  }
  validate(value, label);
  assert.deepEqual(value, expected, `${label} identity mismatch`);
  return true;
}

function optionalValue({
  value,
  label,
  missing,
  validate = requireString,
}) {
  if (value === undefined || value === null || value === "") {
    missing.push(label);
    return false;
  }
  validate(value, label);
  return true;
}

function validateIdentityObject(value, label, fields, missing) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    missing.push(label);
    return null;
  }
  const localMissing = [];
  for (const [name, validate] of Object.entries(fields)) {
    optionalValue({
      value: value[name],
      label: `${label}.${name}`,
      missing: localMissing,
      validate,
    });
  }
  missing.push(...localMissing);
  return localMissing.length === 0 ? canonicalDigest(value) : null;
}

function validateArtifactRelativePath(value, label) {
  requireString(value, label);
  assert(!value.includes("\\"), `${label} must use POSIX separators`);
  assert(!path.posix.isAbsolute(value), `${label} must be relative`);
  assert.equal(
    path.posix.normalize(value),
    value,
    `${label} must be a canonical relative path`,
  );
  assert(
    value !== "."
      && value.split("/").every(
        (segment) => segment.length > 0 && segment !== "." && segment !== "..",
      ),
    `${label} must stay inside the raw capture root`,
  );
  return value;
}

function listRawCaptureFiles(root) {
  const files = [];
  function walk(directory, prefix) {
    const entries = fs.readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const relative = prefix
        ? `${prefix}/${entry.name}`
        : entry.name;
      const absolute = path.join(directory, entry.name);
      assert(
        !entry.isSymbolicLink(),
        `raw capture artifact must not be a symbolic link: ${relative}`,
      );
      if (entry.isDirectory()) {
        walk(absolute, relative);
      } else {
        assert(
          entry.isFile(),
          `raw capture artifact must be a regular file: ${relative}`,
        );
        files.push(relative);
      }
    }
  }
  walk(root, "");
  return files.sort();
}

function validateRawCaptureInventory({
  manifest,
  cardRoot,
  missing,
}) {
  const rawCapture = manifest.rawCapture;
  if (!rawCapture || typeof rawCapture !== "object"
      || Array.isArray(rawCapture)) {
    missing.push("captureManifest.rawCapture");
    return null;
  }
  optionalExpected({
    value: rawCapture.schema,
    expected: RAW_CAPTURE_INVENTORY_SCHEMA,
    label: "captureManifest.rawCapture.schema",
    missing,
  });
  optionalExpected({
    value: rawCapture.root,
    expected: RAW_CAPTURE_ROOT,
    label: "captureManifest.rawCapture.root",
    missing,
  });
  if (!Array.isArray(rawCapture.artifacts)
      || rawCapture.artifacts.length === 0) {
    missing.push("captureManifest.rawCapture.artifacts");
    return null;
  }

  const declaredPaths = [];
  const declaredPathKeys = new Set();
  for (const [index, artifact] of rawCapture.artifacts.entries()) {
    const label = `captureManifest.rawCapture.artifacts[${index}]`;
    assert(
      artifact && typeof artifact === "object" && !Array.isArray(artifact),
      `${label} must be an object`,
    );
    const relative = validateArtifactRelativePath(
      artifact.path,
      `${label}.path`,
    );
    requireInteger(artifact.byteLength, `${label}.byteLength`, 1);
    requireSha256(artifact.sha256, `${label}.sha256`);
    const pathKey = relative.toLowerCase();
    assert(
      !declaredPathKeys.has(pathKey),
      `raw capture inventory contains a duplicate path: ${relative}`,
    );
    declaredPathKeys.add(pathKey);
    declaredPaths.push(relative);
  }

  const rawRoot = path.join(cardRoot, RAW_CAPTURE_ROOT);
  const rawRootStat = fs.lstatSync(rawRoot, { throwIfNoEntry: false });
  assert(
    rawRootStat?.isDirectory() && !rawRootStat.isSymbolicLink(),
    `raw capture artifact root is missing: ${rawRoot}`,
  );
  const actualPaths = listRawCaptureFiles(rawRoot);
  assert.deepEqual(
    [...declaredPaths].sort(),
    actualPaths,
    "raw capture artifact inventory differs from files on disk",
  );
  assert(
    declaredPaths.includes(RAW_CAPTURE_EVENTS),
    `raw capture inventory must include ${RAW_CAPTURE_EVENTS}`,
  );
  for (const required of [
    RAW_CAPTURE_TRACE,
    RAW_CAPTURE_GFXRECON_JSONL,
    RAW_CAPTURE_CONVERSION_MANIFEST,
  ]) {
    assert(
      declaredPaths.includes(required),
      `raw capture inventory must include ${required}`,
    );
  }
  assert(
    declaredPaths.some((relative) => RAW_CAPTURE_SHADER_PATTERN.test(relative)),
    "raw capture inventory must include at least one shader-*.spv",
  );

  const byPath = new Map(
    rawCapture.artifacts.map((artifact) => [artifact.path, artifact]),
  );
  for (const relative of actualPaths) {
    const expected = byPath.get(relative);
    const actual = fileIdentity(
      path.join(rawRoot, ...relative.split("/")),
    );
    assert.deepEqual(
      actual,
      {
        byteLength: expected.byteLength,
        sha256: expected.sha256,
      },
      `raw capture artifact identity mismatch: ${relative}`,
    );
  }
  const eventsSha256 = byPath.get(RAW_CAPTURE_EVENTS).sha256;
  if (manifest.frame?.eventsSha256 !== undefined) {
    assert.equal(
      manifest.frame.eventsSha256,
      eventsSha256,
      "captureManifest.frame.eventsSha256 does not match raw events.jsonl",
    );
  }
  const conversionManifest = readJson(
    path.join(rawRoot, RAW_CAPTURE_CONVERSION_MANIFEST),
    "raw capture conversion manifest",
  );
  assert.equal(
    conversionManifest.schema,
    GFXRECON_CONVERSION_SCHEMA,
    "raw capture conversion manifest schema differs",
  );
  assert.equal(conversionManifest.schemaVersion, 1);
  assert.equal(
    conversionManifest.status,
    "exact-gfxreconstruct-jsonl-to-audit-events",
  );
  const rawJsonlRecords = fs.readFileSync(
    path.join(rawRoot, RAW_CAPTURE_GFXRECON_JSONL),
    "utf8",
  ).split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(
          `invalid raw GFXReconstruct JSONL line ${index + 1}: `
          + error.message,
        );
      }
    });
  assert(rawJsonlRecords.length > 0, "raw GFXReconstruct JSONL is empty");
  const rawFunctionNames = rawJsonlRecords
    .filter((record) => record.function)
    .map((record) => record.function.name);
  const functionBoundaries =
    classifyVulkanFunctionBoundaries(rawFunctionNames);
  assert.deepEqual(
    conversionManifest.scope,
    {
      sourceApi: "Vulkan",
      sourceTracePreserved: true,
      framebufferPixelsRead: false,
      bufferMemoryReconstructed: false,
      stateReconstruction: functionBoundaries.unreconstructedFunctionCallCount
        ? "partial-runtime-required"
        : "event-reconstructed-observed-subset",
      vulkanFunctionBoundaryContract: functionBoundaries.contract,
      unreconstructedFunctionFamilies:
        functionBoundaries.families.map(({ id }) => id),
      officialShaderRestorationPercent: null,
    },
    "raw capture conversion scope differs",
  );
  const proofSource = Object.fromEntries(
    Object.entries(conversionManifest).filter(
      ([key]) => key !== "proofSha256",
    ),
  );
  requireSha256(
    conversionManifest.proofSha256,
    "raw capture conversion manifest proofSha256",
  );
  assert.equal(
    conversionManifest.proofSha256,
    canonicalDigest(proofSource),
    "raw capture conversion manifest proof differs",
  );

  const pinnedToolchain = readJson(
    GFXRECON_TOOLCHAIN_PATH,
    "pinned GFXReconstruct toolchain",
  );
  assert.equal(pinnedToolchain.schema, GFXRECON_TOOLCHAIN_SCHEMA);
  const pinnedToolchainIdentity = fileIdentity(GFXRECON_TOOLCHAIN_PATH);
  assert.equal(
    conversionManifest.toolchain?.manifest?.sha256,
    pinnedToolchainIdentity.sha256,
    "conversion toolchain manifest SHA differs from the repository pin",
  );
  assert.equal(
    conversionManifest.toolchain?.manifest?.logicalPath,
    "build/gfxreconstruct-toolchain.json",
    "conversion toolchain manifest logical path differs",
  );
  assert.equal(
    conversionManifest.toolchain?.toolchainId,
    pinnedToolchain.toolchainId,
    "conversion toolchain id differs from the repository pin",
  );
  for (const role of ["converter", "extractor"]) {
    const actual = conversionManifest.toolchain?.[role];
    const expected = pinnedToolchain.tools?.[role];
    assert(actual && expected, `conversion toolchain ${role} is absent`);
    assert.deepEqual(
      {
        logicalPath: actual.logicalPath,
        byteLength: actual.byteLength,
        sha256: actual.sha256,
      },
      {
        logicalPath: expected.executable,
        byteLength: expected.byteLength,
        sha256: expected.sha256,
      },
      `conversion toolchain ${role} identity differs`,
    );
    for (const signature of expected.versionIncludes || []) {
      assert(
        String(actual.version || "").includes(signature),
        `conversion toolchain ${role} version differs`,
      );
    }
  }

  const requireConvertedArtifact = (fact, relative, label) => {
    assert(fact && typeof fact === "object", `${label} is absent`);
    assert.equal(fact.logicalPath, relative, `${label}.logicalPath differs`);
    assert.deepEqual(
      {
        byteLength: fact.byteLength,
        sha256: fact.sha256,
      },
      {
        byteLength: byPath.get(relative).byteLength,
        sha256: byPath.get(relative).sha256,
      },
      `${label} identity differs from raw capture inventory`,
    );
  };
  requireConvertedArtifact(
    conversionManifest.inputs?.trace,
    RAW_CAPTURE_TRACE,
    "conversion inputs.trace",
  );
  requireConvertedArtifact(
    conversionManifest.inputs?.gfxreconstructJsonl,
    RAW_CAPTURE_GFXRECON_JSONL,
    "conversion inputs.gfxreconstructJsonl",
  );
  requireConvertedArtifact(
    conversionManifest.artifacts?.events,
    RAW_CAPTURE_EVENTS,
    "conversion artifacts.events",
  );
  assert.equal(
    conversionManifest.summary?.unsupportedRelevantFunctionCount,
    0,
    "conversion contains unsupported relevant Vulkan calls",
  );
  assert.equal(
    conversionManifest.summary?.sourceRecordCount,
    rawJsonlRecords.length,
    "conversion source record denominator differs from raw JSONL",
  );
  assert.equal(
    conversionManifest.summary?.sourceFunctionCount,
    rawFunctionNames.length,
    "conversion source function denominator differs from raw JSONL",
  );
  assert.equal(
    conversionManifest.summary?.uniqueFunctionCount,
    new Set(rawFunctionNames).size,
    "conversion unique function denominator differs from raw JSONL",
  );
  assert.equal(
    conversionManifest.summary?.eventReconstructedFunctionCount,
    functionBoundaries.eventReconstructedFunctionCallCount,
    "conversion reconstructed Vulkan function denominator differs",
  );
  assert.equal(
    conversionManifest.summary?.unreconstructedFunctionCount,
    functionBoundaries.unreconstructedFunctionCallCount,
    "conversion unreconstructed Vulkan function denominator differs",
  );
  assert.equal(
    conversionManifest.summary?.unreconstructedUniqueFunctionCount,
    functionBoundaries.unreconstructedUniqueFunctionCount,
    "conversion unreconstructed unique Vulkan function denominator differs",
  );
  assert.equal(
    conversionManifest.summary?.unreconstructedFamilyCount,
    functionBoundaries.unreconstructedFamilyCount,
    "conversion unreconstructed Vulkan family denominator differs",
  );
  assert.deepEqual(
    conversionManifest.sourceFunctions,
    [...new Set(rawFunctionNames)].sort(),
    "conversion source Vulkan function inventory differs from raw JSONL",
  );
  assert.deepEqual(
    conversionManifest.unreconstructedVulkanFunctions,
    functionBoundaries.families,
    "conversion unreconstructed Vulkan function inventory differs",
  );
  assert(
    Number.isInteger(conversionManifest.summary?.shaderModuleCount)
      && conversionManifest.summary.shaderModuleCount > 0,
    "conversion shader module count is absent",
  );
  assert.equal(
    conversionManifest.shaderModules?.length,
    conversionManifest.summary.shaderModuleCount,
    "conversion shader module denominator differs",
  );
  for (const shader of conversionManifest.shaderModules || []) {
    const relative = `shader-${shader.fnv1a64}-${shader.codeSize}.spv`;
    assert(
      RAW_CAPTURE_SHADER_PATTERN.test(relative) && byPath.has(relative),
      `converted shader artifact is absent: ${relative}`,
    );
    assert.deepEqual(
      {
        byteLength: shader.codeSize,
        sha256: shader.sha256,
      },
      {
        byteLength: byPath.get(relative).byteLength,
        sha256: byPath.get(relative).sha256,
      },
      `converted shader identity differs: ${relative}`,
    );
  }
  const rawJsonlHeader = rawJsonlRecords[0].header;
  assert(
    rawJsonlHeader && typeof rawJsonlHeader === "object",
    "raw GFXReconstruct JSONL header is absent",
  );
  const sanitizedRawHeader = {
    ...rawJsonlHeader,
    ...("source-path" in rawJsonlHeader
      ? {
        "source-path": path.basename(String(rawJsonlHeader["source-path"])),
      }
      : {}),
  };
  assert.deepEqual(
    conversionManifest.inputs?.header,
    sanitizedRawHeader,
    "conversion manifest header differs from raw GFXReconstruct JSONL",
  );
  const sourcePath = sanitizedRawHeader["source-path"];
  assert(
    typeof sourcePath !== "string"
      || (!path.isAbsolute(sourcePath)
        && !sourcePath.includes("/")
        && !sourcePath.includes("\\")),
    "conversion JSONL header leaks a host source path",
  );
  return {
    inventorySha256: canonicalDigest(rawCapture),
    eventsSha256,
    artifactCount: actualPaths.length,
    conversionManifestSha256:
      byPath.get(RAW_CAPTURE_CONVERSION_MANIFEST).sha256,
    conversionProofSha256: conversionManifest.proofSha256,
    traceSha256: byPath.get(RAW_CAPTURE_TRACE).sha256,
  };
}

function validateCaptureManifest({
  manifest,
  manifestIdentity,
  cardRoot,
  card,
  sample,
  sampleManifestSha256,
  corpusSha256,
  artifactHashes,
  officialEvidence,
}) {
  const missing = [];
  optionalExpected({
    value: manifest.schema,
    expected: CAPTURE_MANIFEST_SCHEMA,
    label: "captureManifest.schema",
    missing,
  });
  optionalExpected({
    value: manifest.schemaVersion,
    expected: 1,
    label: "captureManifest.schemaVersion",
    missing,
    validate: (value, label) => requireInteger(value, label, 1),
  });
  optionalExpected({
    value: manifest.captureSchema,
    expected: CAPTURE_SCHEMA,
    label: "captureManifest.captureSchema",
    missing,
  });
  const candidate = manifest.candidate;
  if (!candidate || typeof candidate !== "object") {
    missing.push("captureManifest.candidate");
  } else {
    for (const [name, expected] of Object.entries({
      sampleId: sample.sampleId,
      sampleManifestSha256,
      canonicalCorpusSha256: corpusSha256,
      cardId: card.cardId,
      sceneFile: card.file,
      sceneSha256: card.sceneSha256,
      glbSha256: card.glbSha256,
    })) {
      optionalExpected({
        value: candidate[name],
        expected,
        label: `captureManifest.candidate.${name}`,
        missing,
        validate: name.endsWith("Sha256") ? requireSha256 : requireString,
      });
    }
  }
  const packageIdentity = manifest.package;
  if (!packageIdentity || typeof packageIdentity !== "object") {
    missing.push("captureManifest.package");
  } else {
    for (const [name, expected] of Object.entries({
      packageName: sample.game.packageName,
      versionName: sample.game.versionName,
      versionCode: sample.game.versionCode,
      architecture: sample.game.architecture,
    })) {
      optionalExpected({
        value: packageIdentity[name],
        expected,
        label: `captureManifest.package.${name}`,
        missing,
        validate: name === "versionCode"
          ? (value, label) => requireInteger(value, label, 1)
          : requireString,
      });
    }
  }
  const artifacts = manifest.artifacts;
  if (!artifacts || typeof artifacts !== "object") {
    missing.push("captureManifest.artifacts");
  } else {
    for (const [name, expected] of Object.entries(artifactHashes)) {
      optionalExpected({
        value: artifacts[`${name}Sha256`],
        expected,
        label: `captureManifest.artifacts.${name}Sha256`,
        missing,
        validate: requireSha256,
      });
    }
  }
  if (!manifest.officialEvidence
      || typeof manifest.officialEvidence !== "object"
      || Array.isArray(manifest.officialEvidence)) {
    missing.push("captureManifest.officialEvidence");
  } else {
    for (const [name, expected] of Object.entries(officialEvidence)) {
      optionalExpected({
        value: manifest.officialEvidence[name],
        expected,
        label: `captureManifest.officialEvidence.${name}`,
        missing,
        validate: requireSha256,
      });
    }
  }
  const identities = {
    deviceSha256: validateIdentityObject(
      manifest.device,
      "captureManifest.device",
      {
        serialHashSha256: requireSha256,
        manufacturer: requireString,
        model: requireString,
        product: requireString,
        hardware: requireString,
        buildFingerprint: requireString,
        androidRelease: requireString,
        sdkInt: (value, label) => requireInteger(value, label, 1),
        abi: requireString,
      },
      missing,
    ),
    gpuSha256: validateIdentityObject(
      manifest.gpu,
      "captureManifest.gpu",
      {
        vendorId: (value, label) => requireInteger(value, label),
        deviceId: (value, label) => requireInteger(value, label),
        deviceName: requireString,
        apiVersion: requireString,
      },
      missing,
    ),
    driverSha256: validateIdentityObject(
      manifest.driver,
      "captureManifest.driver",
      {
        driverId: requireString,
        driverName: requireString,
        driverInfo: requireString,
        driverVersion: requireString,
        conformanceVersion: requireString,
      },
      missing,
    ),
    vulkanSha256: validateIdentityObject(
      manifest.vulkan,
      "captureManifest.vulkan",
      {
        loaderVersion: requireString,
        instanceApiVersion: requireString,
        physicalDeviceApiVersion: requireString,
        instanceExtensionsSha256: requireSha256,
        deviceExtensionsSha256: requireSha256,
        enabledLayersSha256: requireSha256,
      },
      missing,
    ),
    captureToolSha256: validateIdentityObject(
      manifest.captureTool,
      "captureManifest.captureTool",
      {
        name: requireString,
        version: requireString,
        binarySha256: requireSha256,
        configurationSha256: requireSha256,
      },
      missing,
    ),
    sessionSha256: validateIdentityObject(
      manifest.session,
      "captureManifest.session",
      {
        sessionId: requireString,
        startedAtUtc: requireIsoUtc,
        processId: (value, label) => requireInteger(value, label, 1),
        processStartTimeUtc: requireIsoUtc,
        packageName: requireString,
        packageVersion: requireString,
      },
      missing,
    ),
    frameSha256: validateIdentityObject(
      manifest.frame,
      "captureManifest.frame",
      {
        captureId: requireString,
        frameIndex: (value, label) => requireInteger(value, label),
        presentIndex: (value, label) => requireInteger(value, label),
        timestampUtc: requireIsoUtc,
        eventsSha256: requireSha256,
      },
      missing,
    ),
  };
  const rawCapture = validateRawCaptureInventory({
    manifest,
    cardRoot,
    missing,
  });
  identities.rawCaptureSha256 = rawCapture?.inventorySha256 || null;
  if (manifest.device?.abi !== undefined) {
    assert.equal(manifest.device.abi, sample.game.architecture,
      "captureManifest.device.abi identity mismatch");
  }
  if (manifest.session?.packageName !== undefined) {
    assert.equal(manifest.session.packageName, sample.game.packageName,
      "captureManifest.session.packageName identity mismatch");
  }
  if (manifest.session?.packageVersion !== undefined) {
    assert.equal(manifest.session.packageVersion, sample.game.versionName,
      "captureManifest.session.packageVersion identity mismatch");
  }
  return {
    missing,
    rawCapture,
    identity: {
      manifestSha256: manifestIdentity.sha256,
      ...identities,
    },
  };
}

function validateImportArtifact({
  imported,
  card,
  sample,
  sampleManifestSha256,
  corpusSha256,
  artifactHashes,
  capture,
  officialEvidence,
}) {
  const missing = [];
  optionalExpected({
    value: imported.schema,
    expected: IMPORT_SCHEMA,
    label: "import.schema",
    missing,
  });
  const provenance = imported.provenance;
  if (!provenance || typeof provenance !== "object") {
    missing.push("import.provenance");
  } else {
    optionalExpected({
      value: provenance.status,
      expected: "complete",
      label: "import.provenance.status",
      missing,
    });
    for (const [name, expected] of Object.entries({
      sampleId: sample.sampleId,
      sampleManifestSha256,
      canonicalCorpusSha256: corpusSha256,
      cardId: card.cardId,
      sceneSha256: card.sceneSha256,
      glbSha256: card.glbSha256,
    })) {
      optionalExpected({
        value: provenance[name],
        expected,
        label: `import.provenance.${name}`,
        missing,
        validate: name.endsWith("Sha256") ? requireSha256 : requireString,
      });
    }
    for (const [name, expected] of Object.entries(artifactHashes)) {
      optionalExpected({
        value: provenance.artifacts?.[`${name}Sha256`],
        expected,
        label: `import.provenance.artifacts.${name}Sha256`,
        missing,
        validate: requireSha256,
      });
    }
    for (const [name, expected] of Object.entries(officialEvidence)) {
      optionalExpected({
        value: provenance.officialEvidence?.[name],
        expected,
        label: `import.provenance.officialEvidence.${name}`,
        missing,
        validate: requireSha256,
      });
    }
    if (capture) {
      optionalExpected({
        value: provenance.captureManifestSha256,
        expected: capture.identity.manifestSha256,
        label: "import.provenance.captureManifestSha256",
        missing,
        validate: requireSha256,
      });
      for (const [name, expected] of Object.entries(capture.identity)) {
        if (name === "manifestSha256" || expected === null) continue;
        optionalExpected({
          value: provenance.identities?.[name],
          expected,
          label: `import.provenance.identities.${name}`,
          missing,
          validate: requireSha256,
        });
      }
      optionalExpected({
        value: provenance.frameEventsSha256,
        expected: capture.frameEventsSha256,
        label: "import.provenance.frameEventsSha256",
        missing,
        validate: requireSha256,
      });
    } else {
      missing.push("import.provenance.captureManifestSha256");
    }
  }
  optionalExpected({
    value: imported.source?.card,
    expected: card.cardId,
    label: "import.source.card",
    missing,
  });
  for (const [name, expected] of Object.entries({
    materialProgramInventorySha256:
      officialEvidence.materialProgramInventorySha256,
    proofGraphSha256: officialEvidence.proofGraphSha256,
    portIndexSha256: officialEvidence.portIndexSha256,
    programPortContractSha256:
      officialEvidence.programPortContractSha256,
    programPortManifestSetSha256:
      officialEvidence.programPortManifestSetSha256,
  })) {
    optionalExpected({
      value: imported.source?.officialEvidence?.[
        name === "materialProgramInventorySha256" ? "sha256" : name
      ],
      expected,
      label: `import.source.officialEvidence.${name}`,
      missing,
      validate: requireSha256,
    });
  }
  optionalExpected({
    value: imported.source?.sceneSha256,
    expected: card.sceneSha256,
    label: "import.source.sceneSha256",
    missing,
    validate: requireSha256,
  });
  optionalExpected({
    value: imported.source?.glbSha256,
    expected: card.glbSha256,
    label: "import.source.glbSha256",
    missing,
    validate: requireSha256,
  });
  optionalExpected({
    value: imported.source?.declaredCaptureSchema,
    expected: CAPTURE_SCHEMA,
    label: "import.source.declaredCaptureSchema",
    missing,
  });
  optionalExpected({
    value: imported.source?.provenanceStatus,
    expected: "complete",
    label: "import.source.provenanceStatus",
    missing,
  });
  optionalExpected({
    value: imported.capture?.provenance?.status,
    expected: "complete",
    label: "import.capture.provenance.status",
    missing,
  });
  if (capture?.identity.frameSha256) {
    optionalExpected({
      value: imported.source?.captureEventsSha256,
      expected: capture.frameEventsSha256,
      label: "import/capture frame.eventsSha256",
      missing,
      validate: requireSha256,
    });
  }
  if (imported.status !== "exact") {
    missing.push("import.status=exact");
  }
  if (imported.evidenceCoverage?.schema
      !== "pocket-card-render/official-vulkan-evidence-coverage@1") {
    missing.push("import.evidenceCoverage");
  } else {
    const declaredRequirements = imported.evidenceCoverage.requirements || [];
    const requirements = new Map(
      declaredRequirements.map(
        (requirement) => [requirement.id, requirement],
      ),
    );
    for (const id of REQUIRED_EVIDENCE_COVERAGE) {
      const requirement = requirements.get(id);
      if (requirement?.status !== "exact"
          || !SHA256_PATTERN.test(requirement?.proofSha256 || "")) {
        missing.push(`import.evidenceCoverage.${id}=exact`);
      } else {
        const expectedProofSha256 = canonicalDigest({
          id: requirement.id,
          status: requirement.status,
          facts: requirement.facts ?? null,
        });
        if (requirement.proofSha256 !== expectedProofSha256) {
          missing.push(`import.evidenceCoverage.${id}.proofSha256`);
        }
      }
    }
    if (requirements.size !== REQUIRED_EVIDENCE_COVERAGE.length
        || declaredRequirements.length !== REQUIRED_EVIDENCE_COVERAGE.length) {
      missing.push("import.evidenceCoverage exact denominator");
    }
  }
  const summary = imported.bestSummary;
  if (!summary || typeof summary !== "object") {
    missing.push("import.bestSummary");
  } else {
    for (const name of [
      "expected",
      "observed",
      "exact",
      "unresolved",
      "mismatch",
      "exactProgram",
      "exactProgramExpected",
    ]) {
      optionalValue({
        value: summary[name],
        label: `import.bestSummary.${name}`,
        missing,
        validate: (value, label) => requireInteger(value, label),
      });
    }
    if (summary.expected !== undefined) {
      if (summary.expected <= 0) missing.push("import.bestSummary.expected>0");
      if (summary.observed !== summary.expected) {
        missing.push("import.bestSummary.observed=expected");
      }
      if (summary.exact !== summary.expected) {
        missing.push("import.bestSummary.exact=expected");
      }
      if (summary.exactProgram !== summary.exactProgramExpected) {
        missing.push("import.bestSummary.exactProgram=exactProgramExpected");
      }
      if (summary.unresolved !== 0) {
        missing.push("import.bestSummary.unresolved=0");
      }
      if (summary.mismatch !== 0) {
        missing.push("import.bestSummary.mismatch=0");
      }
    }
  }
  if (!Number.isInteger(imported.capture?.matchedCardScopes)
      || imported.capture.matchedCardScopes <= 0) {
    missing.push("import.capture.matchedCardScopes>0");
  }
  if (!Number.isInteger(imported.capture?.successfulPresents)
      || imported.capture.successfulPresents <= 0) {
    missing.push("import.capture.successfulPresents>0");
  }
  if (capture?.frame) {
    if (!Array.isArray(imported.capture?.captureStarts)
        || !imported.capture.captureStarts.some(
          (entry) => String(entry.captureId) ===
            String(capture.frame.captureId),
        )) {
      missing.push("import.capture.captureStarts frame captureId");
    }
    if (!Array.isArray(imported.capture?.presents)
        || !imported.capture.presents.some(
          (entry) => entry.presentIndex === capture.frame.presentIndex
            && entry.result === 0,
        )) {
      missing.push("import.capture.presents frame presentIndex/result");
    }
  }
  if (!Array.isArray(imported.scopes) || imported.scopes.length === 0) {
    missing.push("import.scopes");
  } else if (imported.scopes.some(
    (scope) => scope.assignmentSearchTruncated
      || !Array.isArray(scope.submissions)
      || scope.submissions.length === 0,
  )) {
    missing.push("import.scopes complete submitted assignments");
  }
  return { missing };
}

export function deterministicImportSnapshot(imported) {
  return {
    status: imported.status,
    source: {
      captureEventsSha256: imported.source?.captureEventsSha256,
      eventCount: imported.source?.eventCount,
      uniqueShaderModules: imported.source?.uniqueShaderModules,
      sceneSha256: imported.source?.sceneSha256,
      glbSha256: imported.source?.glbSha256,
      card: imported.source?.card,
      officialEvidence: imported.source?.officialEvidence,
    },
    expectedDraws: imported.expectedDraws,
    capture: {
      renderPassScopes: imported.capture?.renderPassScopes,
      matchedCardScopes: imported.capture?.matchedCardScopes,
      submissions: imported.capture?.submissions,
      queueSubmits: imported.capture?.queueSubmits,
      captureStarts: imported.capture?.captureStarts,
      presents: imported.capture?.presents,
      successfulPresents: imported.capture?.successfulPresents,
    },
    bestScopeOrdinal: imported.bestScopeOrdinal,
    bestSummary: imported.bestSummary,
    evidenceCoverage: imported.evidenceCoverage,
    scopes: imported.scopes,
  };
}

function parseArgs(argv) {
  const args = {
    check: process.env.PCR_CANDIDATE_GUEST_RUNTIME_CHECK === "1",
    requireComplete: false,
    candidateManifest:
      process.env.PCR_OFFICIAL_CANDIDATE_MANIFEST || DEFAULT_CANDIDATE,
    canonicalScenes: null,
    artifactRoot:
      process.env.PCR_CANDIDATE_OFFICIAL_GUEST_RUNTIME_ROOT || null,
    materialProgramInventory:
      process.env.PCR_CANDIDATE_MATERIAL_PROGRAM_INVENTORY || null,
    programPortContract: null,
    candidatePortRoot: null,
    out: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--check") {
      args.check = true;
      continue;
    }
    if (token === "--require-complete") {
      args.requireComplete = true;
      continue;
    }
    const key = {
      "--candidate-manifest": "candidateManifest",
      "--canonical-scenes": "canonicalScenes",
      "--artifact-root": "artifactRoot",
      "--material-program-inventory": "materialProgramInventory",
      "--program-port-contract": "programPortContract",
      "--candidate-port-root": "candidatePortRoot",
      "--out": "out",
    }[token];
    if (!key) throw new Error(`unknown argument: ${token}`);
    const value = argv[++index];
    if (!value || value.startsWith("--")) {
      throw new Error(`${token} requires a value`);
    }
    args[key] = value;
  }
  return args;
}

function validateCanonicalInputs(loaded, args) {
  const { sample } = loaded;
  assert.equal(sample.status, "candidate");
  const sampleManifestSha256 = officialSampleDigest(sample);
  const corpusPath = path.resolve(ROOT, sample.canonicalCorpus.path);
  const corpusIdentity = fileIdentity(corpusPath);
  assert.deepEqual(corpusIdentity, {
    byteLength: sample.canonicalCorpus.byteLength,
    sha256: sample.canonicalCorpus.sha256,
  },
    "candidate canonical corpus identity mismatch");
  const corpus = readJson(corpusPath, "candidate canonical corpus");
  assert.equal(corpus.schemaVersion, 2);
  assert.equal(corpus.sampleId, sample.sampleId);
  assert.equal(corpus.scenes.length, 9,
    "candidate official guest runtime denominator must contain 9 cards");
  assert.equal(new Set(corpus.scenes.map((scene) => scene.cardId)).size, 9,
    "candidate canonical corpus contains duplicate cards");

  const stem = sample.sampleId.replace(/-candidate$/, "");
  const canonicalScenesPath = path.resolve(
    ROOT,
    args.canonicalScenes
      || `build/official-samples/${stem}-canonical-scenes.json`,
  );
  const canonicalScenes = readJson(
    canonicalScenesPath,
    "candidate canonical scenes",
  );
  assert.equal(
    canonicalScenes.schema,
    "pocket-card-render/candidate-canonical-scenes@3",
  );
  assert.equal(canonicalScenes.candidate.sampleId, sample.sampleId);
  assert.equal(
    canonicalScenes.candidate.sampleManifestSha256,
    sampleManifestSha256,
  );
  assert.equal(
    canonicalScenes.inputs.canonicalCorpus.sha256,
    sample.canonicalCorpus.sha256,
  );
  assert.deepEqual(
    canonicalScenes.scenes.map((scene) => scene.cardId).sort(),
    corpus.scenes.map((scene) => scene.cardId).sort(),
    "candidate canonical scene denominator differs from canonical corpus",
  );
  const sceneByCard = new Map(
    canonicalScenes.scenes.map((scene) => [scene.cardId, scene]),
  );
  const cards = corpus.scenes.map((scene) => {
    const evidence = sceneByCard.get(scene.cardId);
    assert.equal(evidence.file, scene.file);
    requireSha256(evidence.sha256, `${scene.cardId}.sceneSha256`);
    const scenePath = path.join(ROOT, "public", scene.file);
    assert.deepEqual(
      fileIdentity(scenePath),
      {
        byteLength: evidence.byteLength,
        sha256: evidence.sha256,
      },
      `${scene.cardId} published scene differs from candidate evidence`,
    );
    const sceneValue = readJson(scenePath, `${scene.cardId} published scene`);
    assert.equal(sceneValue.card?.id, scene.cardId);
    const glbPath = path.resolve(
      ROOT,
      "public",
      String(sceneValue.prefabGlb).replace(/^[/\\]+/, ""),
    );
    const glbIdentity = fileIdentity(glbPath);
    return {
      cardId: scene.cardId,
      file: scene.file,
      coverageRoles: scene.coverageRoles,
      sceneSha256: evidence.sha256,
      scenePath,
      glbPath,
      glbSha256: glbIdentity.sha256,
      glbByteLength: glbIdentity.byteLength,
    };
  });
  return {
    sample,
    sampleManifestSha256,
    corpusPath,
    corpus,
    canonicalScenesPath,
    canonicalScenes,
    cards,
    stem,
  };
}

export function buildCandidateOfficialGuestRuntimeBatch(inputArgs = {}) {
  const args = {
    ...parseArgs([]),
    ...inputArgs,
  };
  const captureImporter = typeof inputArgs.importCapture === "function"
    ? inputArgs.importCapture
    : importOfficialVulkanCapture;
  const loaded = loadOfficialSample(args.candidateManifest);
  const inputs = validateCanonicalInputs(loaded, args);
  const {
    sample,
    sampleManifestSha256,
    corpusPath,
    canonicalScenesPath,
    cards,
    stem,
  } = inputs;
  const artifactRoot = path.resolve(
    args.artifactRoot
      || path.join(
        ROOT,
        "..",
        "ptcgp-tools-master",
        "masterdata_decoder",
        ".output-full",
        "official-guest-runtime",
        sample.sampleId,
      ),
  );
  const artifactHashes = expectedArtifactHashes(sample);
  const outputRoot = path.join(
    ROOT,
    "..",
    "ptcgp-tools-master",
    "masterdata_decoder",
    ".output-full",
  );
  const materialProgramInventoryPath = path.resolve(
    args.materialProgramInventory
      || path.join(outputRoot, "material-program-inventory-full.json"),
  );
  const materialProgramInventoryIdentity = fileIdentity(
    materialProgramInventoryPath,
  );
  assert.equal(
    materialProgramInventoryIdentity.sha256,
    sample.proofSets.materialPrograms.inventorySha256,
    "candidate Material program inventory differs from the sample manifest",
  );
  const materialProgramInventory = readJson(
    materialProgramInventoryPath,
    "candidate Material program inventory",
  );
  assert.equal(
    materialProgramInventory.schema,
    sample.proofSets.materialPrograms.inventorySchema,
  );
  assert.equal(
    materialProgramInventory.digests.proofGraphSha256,
    sample.proofSets.materialPrograms.proofGraphSha256,
  );
  assert.equal(
    materialProgramInventory.digests.portIndexSha256,
    sample.proofSets.materialPrograms.portIndexSha256,
  );
  const programPortContractPath = path.resolve(
    ROOT,
    args.programPortContract
      || `build/official-samples/${stem}-program-port-contract.json`,
  );
  const programPortContractIdentity = fileIdentity(programPortContractPath);
  const programPortContract = readJson(
    programPortContractPath,
    "candidate program port contract",
  );
  assert.equal(
    programPortContract.provenance?.sampleId,
    sample.sampleId,
  );
  assert.equal(
    programPortContract.provenance?.sampleManifestSha256,
    sampleManifestSha256,
  );
  assert.equal(
    programPortContract.inventory?.inventorySha256,
    materialProgramInventoryIdentity.sha256,
  );
  const candidatePortRoot = path.resolve(
    args.candidatePortRoot
      || process.env.PCR_CANDIDATE_PORT_ROOT
      || path.join(outputRoot, "webgl-ports"),
  );
  const programPortManifests = loadCandidatePortManifests(
    programPortContract,
    candidatePortRoot,
  );
  const importerIdentity = fileIdentity(path.join(
    ROOT,
    "build",
    "import-official-vulkan-runtime-capture.mjs",
  ));
  const officialEvidence = Object.freeze({
    materialProgramInventorySha256:
      materialProgramInventoryIdentity.sha256,
    proofGraphSha256:
      materialProgramInventory.digests.proofGraphSha256,
    portIndexSha256:
      materialProgramInventory.digests.portIndexSha256,
    programPortContractSha256: programPortContractIdentity.sha256,
    programPortManifestSetSha256: programPortManifests.sha256,
    importerSha256: importerIdentity.sha256,
  });
  const staticExpectedByCard = new Map(cards.map((card) => {
    const scene = readJson(card.scenePath, `${card.cardId} published scene`);
    const expectedDraws = buildCandidateExpectedDraws({
      scene,
      glbDraws: parseGlbPrimitiveDraws(card.glbPath),
      materialProgramInventory,
      programPortContract,
      programPortManifests: programPortManifests.manifests,
    });
    const formalDraws = expectedDraws.filter(
      ({ portContract }) => portContract.kind === "formal-port",
    );
    const unresolvedReasons = [...new Set(
      formalDraws.flatMap(
        ({ pipelineExpectation }) => pipelineExpectation?.unresolved || [],
      ),
    )].sort();
    return [card.cardId, {
      expectedDrawCount: expectedDraws.length,
      formalPortDrawCount: formalDraws.length,
      runtimeBoundaryDrawCount:
        expectedDraws.length - formalDraws.length,
      pipelineExpectationDrawCount:
        formalDraws.filter(({ pipelineExpectation }) => pipelineExpectation)
          .length,
      unresolvedPipelineExpectationDrawCount:
        formalDraws.filter(
          ({ pipelineExpectation }) => (
            (pipelineExpectation?.unresolved || []).length > 0
          ),
        ).length,
      unresolvedReasons,
    }];
  }));
  const rows = cards.map((card) => {
    const cardRoot = path.join(artifactRoot, card.cardId);
    const captureManifestPath = path.join(
      cardRoot,
      "capture-manifest.json",
    );
    const importPath = path.join(cardRoot, "import.json");
    const missing = [];
    let capture = null;
    let importIdentity = null;
    if (!isFile(captureManifestPath)) {
      missing.push("capture-manifest.json");
    } else {
      const manifestIdentity = fileIdentity(captureManifestPath);
      const manifest = readJson(
        captureManifestPath,
        `${card.cardId} capture manifest`,
      );
      capture = validateCaptureManifest({
        manifest,
        manifestIdentity,
        cardRoot,
        card,
        sample,
        sampleManifestSha256,
        corpusSha256: sample.canonicalCorpus.sha256,
        artifactHashes,
        officialEvidence,
      });
      capture.frameEventsSha256 = manifest.frame?.eventsSha256 || null;
      capture.frame = manifest.frame || null;
      missing.push(...capture.missing);
    }
    if (!isFile(importPath)) {
      missing.push("import.json");
    } else {
      importIdentity = fileIdentity(importPath);
      const imported = readJson(importPath, `${card.cardId} import artifact`);
      const validatedImport = validateImportArtifact({
        imported,
        card,
        sample,
        sampleManifestSha256,
        corpusSha256: sample.canonicalCorpus.sha256,
        artifactHashes,
        capture,
        officialEvidence,
      });
      missing.push(...validatedImport.missing);
      if (capture && capture.missing.length === 0) {
        try {
          const fresh = captureImporter({
            captureDir: path.join(cardRoot, RAW_CAPTURE_ROOT),
            scenePath: card.scenePath,
            glbPath: card.glbPath,
            materialProgramInventory,
            materialProgramInventorySha256:
              materialProgramInventoryIdentity.sha256,
            programPortContract,
            programPortContractSha256:
              programPortContractIdentity.sha256,
            programPortManifests: programPortManifests.manifests,
            programPortManifestSetSha256:
              programPortManifests.sha256,
          });
          const freshDigest = canonicalDigest(
            deterministicImportSnapshot(fresh),
          );
          if (canonicalDigest(deterministicImportSnapshot(imported))
              !== freshDigest) {
            missing.push(
              "import deterministic replay differs from persisted import",
            );
          }
          if (imported.provenance?.deterministicImportSha256
              !== freshDigest) {
            missing.push(
              "import.provenance.deterministicImportSha256",
            );
          }
        } catch (error) {
          missing.push(`deterministic raw reimport failed: ${error.message}`);
        }
      }
    }
    const uniqueMissing = [...new Set(missing)].sort();
    return {
      cardId: card.cardId,
      sceneFile: card.file,
      sceneSha256: card.sceneSha256,
      glbSha256: card.glbSha256,
      coverageRoles: card.coverageRoles,
      staticExpectedDraws: staticExpectedByCard.get(card.cardId),
      requiredArtifacts: {
        captureManifest: `${card.cardId}/capture-manifest.json`,
        importArtifact: `${card.cardId}/import.json`,
        rawCapture: `${card.cardId}/${RAW_CAPTURE_ROOT}/**`,
      },
      observedCaptureIdentity: capture?.identity?.frameSha256
        ? {
          frameSha256: capture.identity.frameSha256,
          eventsSha256: capture.frameEventsSha256,
        }
        : null,
      status: uniqueMissing.length === 0
        ? "complete-static-validation"
        : "runtime-required",
      missing: uniqueMissing,
      evidence: uniqueMissing.length === 0
        ? {
          captureManifestSha256: capture.identity.manifestSha256,
          importArtifactSha256: importIdentity.sha256,
          identities: Object.fromEntries(
            Object.entries(capture.identity)
              .filter(([name]) => name !== "manifestSha256"),
          ),
        }
        : null,
      fidelityContribution: 0,
    };
  });
  const completed = rows.filter(
    (row) => row.status === "complete-static-validation",
  );
  const observedFrameIdentities = rows
    .map((row) => row.observedCaptureIdentity?.frameSha256)
    .filter(Boolean);
  assert.equal(
    new Set(observedFrameIdentities).size,
    observedFrameIdentities.length,
    "candidate guest runtime batch contains duplicate frame identities",
  );
  const summary = {
    requiredCardCount: cards.length,
    completeCardCount: completed.length,
    runtimeRequiredCardCount: rows.length - completed.length,
    captureManifestCount: rows.filter(
      (row) => !row.missing.includes("capture-manifest.json"),
    ).length,
    importArtifactCount: rows.filter(
      (row) => !row.missing.includes("import.json"),
    ).length,
    fidelityContribution: 0,
  };
  assert.equal(summary.requiredCardCount, 9);
  assert.equal(
    summary.completeCardCount + summary.runtimeRequiredCardCount,
    summary.requiredCardCount,
  );
  const runtimeBoundaries = [
    {
      id: "candidate-official-guest-vulkan-capture-batch",
      status: summary.completeCardCount === summary.requiredCardCount
        ? "statically-validated-runtime-artifacts"
        : "runtime-required",
      required: summary.requiredCardCount,
      complete: summary.completeCardCount,
      remaining: summary.runtimeRequiredCardCount,
      reason:
        "each canonical card requires a separately captured, imported and "
        + "composite-identity-bound official guest Vulkan frame",
    },
    {
      id: "vulkan-to-webgl-semantic-equivalence",
      status: "runtime-required",
      reason:
        "a complete guest capture batch does not prove Vulkan-to-WebGL "
        + "instruction, resource, attachment or display equivalence",
    },
    {
      id: "native-device-display-transfer",
      status: "runtime-required",
      reason:
        "capture provenance does not prove Android compositor, color "
        + "management or physical display transfer",
    },
  ];
  const report = {
    schema:
      "pocket-card-render/candidate-official-guest-runtime-batch@1",
    schemaVersion: 1,
    candidate: {
      selection: loaded.selectionRelative,
      manifest: loaded.manifestRelative,
      sampleId: sample.sampleId,
      sampleManifestSha256,
      canonicalCorpusSha256: sample.canonicalCorpus.sha256,
      gameVersion: sample.game.versionName,
      unityVersion: sample.unity.serializedVersion,
    },
    scope: {
      status: summary.runtimeRequiredCardCount === 0
        ? "complete-static-validation"
        : "runtime-required",
      denominator:
        "all nine cards in the candidate canonicalCorpus",
      createsCaptureData: false,
      launchesDeviceBrowserOrCaptureTool: false,
      fidelityContribution: 0,
      officialShaderRestorationPercent: null,
      gameFidelity: false,
      runtimeFidelity: false,
    },
    inputs: {
      canonicalCorpus: {
        logicalPath: sample.canonicalCorpus.path,
        ...fileIdentity(corpusPath),
      },
      canonicalScenes: {
        logicalPath: path.relative(ROOT, canonicalScenesPath)
          .replaceAll("\\", "/"),
        ...fileIdentity(canonicalScenesPath),
      },
      officialEvidence: {
        materialProgramInventory: {
          logicalSourceId: "candidate-material-program-inventory-full",
          ...materialProgramInventoryIdentity,
          proofGraphSha256:
            materialProgramInventory.digests.proofGraphSha256,
          portIndexSha256:
            materialProgramInventory.digests.portIndexSha256,
        },
        programPortContract: {
          logicalPath: path.relative(ROOT, programPortContractPath)
            .replaceAll("\\", "/"),
          ...programPortContractIdentity,
        },
        programPortManifests: {
          denominator: programPortManifests.facts.length,
          manifestSetSha256: programPortManifests.sha256,
          manifests: programPortManifests.facts,
        },
        importer: {
          logicalPath:
            "build/import-official-vulkan-runtime-capture.mjs",
          ...importerIdentity,
        },
      },
      packageAndNativeSha256: artifactHashes,
      artifactLayout: {
        rootEnvironment:
          "PCR_CANDIDATE_OFFICIAL_GUEST_RUNTIME_ROOT",
        captureManifest: "<cardId>/capture-manifest.json",
        importArtifact: "<cardId>/import.json",
        rawCapture: `<cardId>/${RAW_CAPTURE_ROOT}/**`,
      },
      generator: {
        logicalPath:
          "build/build-candidate-official-guest-runtime-batch.mjs",
        ...fileIdentity(fileURLToPath(import.meta.url)),
      },
    },
    cards: rows,
    summary,
    runtimeBoundaries,
    claims: {
      fidelityContribution: 0,
      officialShaderRestorationPercent: null,
      gameFidelity: false,
      runtimeFidelity: false,
    },
  };
  report.proofSha256 = canonicalDigest({
    candidate: report.candidate,
    inputs: report.inputs,
    cards: report.cards,
    summary,
    runtimeBoundaries,
    claims: report.claims,
  });
  const out = path.resolve(
    ROOT,
    args.out
      || `build/official-samples/${stem}-official-guest-runtime-batch.json`,
  );
  return { report, out };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const { report, out } = buildCandidateOfficialGuestRuntimeBatch(args);
  const encoded = serialize(report);
  if (args.check) {
    assert(isFile(out), `candidate guest runtime batch is missing: ${out}`);
    assert.equal(
      fs.readFileSync(out, "utf8").replace(/\r\n/g, "\n"),
      encoded,
      "candidate guest runtime batch is stale",
    );
  }
  if (args.requireComplete) {
    assert.equal(
      report.summary.completeCardCount,
      report.summary.requiredCardCount,
      "candidate official guest runtime batch requires complete 9/9 evidence",
    );
  }
  if (!args.check) {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    atomicWriteFileSync(out, encoded);
  }
  console.log(
    `Candidate official guest runtime batch: `
      + `${report.summary.completeCardCount}/`
      + `${report.summary.requiredCardCount} complete; `
      + `${report.summary.runtimeRequiredCardCount} runtime-required; `
      + "fidelity contribution 0",
  );
}

if (
  process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main();
}
