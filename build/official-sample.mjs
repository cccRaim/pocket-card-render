import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const DEFAULT_OFFICIAL_SAMPLE_RELATIVE =
  "build/official-samples/current.json";

function isSha256(value) {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

function requireValue(condition, message) {
  if (!condition) throw new Error(`official sample manifest: ${message}`);
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

export function officialSampleDigest(sample) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(canonicalize(sample)))
    .digest("hex");
}

export function validateOfficialSample(sample) {
  requireValue(sample && typeof sample === "object", "root must be an object");
  requireValue(sample.schemaVersion === 2, `unsupported schemaVersion ${sample.schemaVersion}`);
  requireValue(/^[a-z0-9.-]+$/.test(sample.sampleId || ""), "invalid sampleId");
  requireValue(sample.status === "baseline" || sample.status === "candidate", "invalid status");
  requireValue(sample.game?.packageName === "jp.pokemon.pokemontcgp", "unexpected packageName");
  requireValue(/^\d+\.\d+\.\d+$/.test(sample.game?.versionName || ""), "invalid game versionName");
  requireValue(Number.isInteger(sample.game?.versionCode), "invalid game versionCode");
  requireValue(sample.game?.architecture === "arm64-v8a", "unsupported architecture");
  requireValue(
    sample.game?.apkmBasename ===
      `${sample.game.packageName}_${sample.game.versionName}.apkm`,
    "APKM basename does not match package/version",
  );
  requireValue(
    /^\d{4}\.\d+\.\d+f\d+$/.test(sample.unity?.serializedVersion || ""),
    "invalid Unity serializedVersion",
  );
  requireValue(
    sample.unity?.playerBuildVersion?.startsWith(`${sample.unity.serializedVersion}_`),
    "playerBuildVersion does not match serializedVersion",
  );
  const requiredArtifacts = [
    "apkm",
    "baseApk",
    "arm64Split",
    "bundledTreeSplit",
    "libunity",
    "libil2cpp",
    "globalMetadataEncrypted",
    "globalMetadataPlaintext",
    "bootConfig",
    "globalGameManagers",
    "unityReleasePlayer",
    "unityReleaseSymbols",
  ];
  for (const name of requiredArtifacts) {
    const identity = sample.artifacts?.[name];
    requireValue(isSha256(identity?.sha256), `${name} has invalid SHA-256`);
    requireValue(Number.isInteger(identity?.byteLength) && identity.byteLength > 0,
      `${name} has invalid byteLength`);
  }
  requireValue(isSha256(sample.snapshots?.masterdata?.pokemonSha256),
    "invalid Pokemon masterdata SHA-256");
  requireValue(isSha256(sample.snapshots?.masterdata?.trainerSha256),
    "invalid Trainer masterdata SHA-256");
  requireValue(isSha256(sample.snapshots?.faceBundles?.inventorySha256),
    "invalid Face inventory SHA-256");
  requireValue(isSha256(sample.proofSets?.materialPrograms?.proofGraphSha256),
    "invalid shader proofGraphSha256");
  requireValue(isSha256(sample.proofSets?.materialPrograms?.portIndexSha256),
    "invalid shader portIndexSha256");
  requireValue(typeof sample.canonicalCorpus?.path === "string",
    "canonicalCorpus path must be present");
  requireValue(isSha256(sample.canonicalCorpus?.sha256),
    "invalid canonicalCorpus SHA-256");
  return sample;
}

export function loadOfficialSample(manifestPath = process.env.PCR_OFFICIAL_SAMPLE_MANIFEST) {
  const selectionAbsolute = manifestPath
    ? path.resolve(ROOT, manifestPath)
    : path.join(ROOT, DEFAULT_OFFICIAL_SAMPLE_RELATIVE);
  const selection = JSON.parse(fs.readFileSync(selectionAbsolute, "utf8"));
  const absolute = typeof selection.manifest === "string"
    ? path.resolve(path.dirname(selectionAbsolute), selection.manifest)
    : selectionAbsolute;
  if (typeof selection.manifest === "string") {
    requireValue(selection.schemaVersion === 1, "unsupported current pointer schema");
    requireValue(
      path.dirname(absolute) === path.dirname(selectionAbsolute),
      "current pointer must select a sibling manifest",
    );
  }
  const sample = validateOfficialSample(JSON.parse(fs.readFileSync(absolute, "utf8")));
  return {
    selectionPath: selectionAbsolute,
    selectionRelative: path.relative(ROOT, selectionAbsolute).replaceAll("\\", "/"),
    manifestPath: absolute,
    manifestRelative: path.relative(ROOT, absolute).replaceAll("\\", "/"),
    sample,
  };
}

const loaded = loadOfficialSample();
export const officialSample = Object.freeze(loaded.sample);
export const officialSampleSha256 = officialSampleDigest(officialSample);
export const officialSampleSelectionPath = loaded.selectionPath;
export const officialSampleSelectionRelative = loaded.selectionRelative;
export const officialSampleManifestPath = loaded.manifestPath;
export const officialSampleManifestRelative = loaded.manifestRelative;
export const officialSampleLabel =
  `PTCGP ${officialSample.game.versionName} / Unity ${officialSample.unity.serializedVersion}`;
