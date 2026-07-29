import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadOfficialSample,
  officialSampleDigest,
} from "./official-sample.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_SAMPLES_ROOT = path.resolve(
  ROOT,
  "..",
  "ptcgp-tools-master",
  "masterdata_decoder",
  ".output-full",
  "samples",
);
const LOCALES = [
  "de_DE",
  "en_US",
  "es_ES",
  "fr_FR",
  "it_IT",
  "ja_JP",
  "ko_KR",
  "pt_BR",
  "zh_TW",
];

const ARTIFACT_PATHS = {
  apkm: "package/game.apkm",
  baseApk: "package/base.apk",
  arm64Split: "package/split_config.arm64_v8a.apk",
  bundledTreeSplit: "package/split_bundledtree.apk",
  libunity: "native/libunity.so",
  libil2cpp: "native/libil2cpp.so",
  globalMetadataEncrypted: "metadata/global-metadata.encrypted.dat",
  globalMetadataPlaintext: "metadata/global-metadata.dat",
  bootConfig: "data/boot.config",
  globalGameManagers: "data/globalgamemanagers",
  unityReleasePlayer: "unity-release/libunity.release.arm64.so",
  unityReleaseSymbols: "unity-release/libunity.release.arm64.sym.so",
};

function requireValue(condition, message) {
  if (!condition) throw new Error(`official sample inputs: ${message}`);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function sha256File(file) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(file));
  return hash.digest("hex");
}

function requireFile(file, label) {
  requireValue(fs.statSync(file, { throwIfNoEntry: false })?.isFile(), `${label} is missing: ${file}`);
}

function requireDirectory(directory, label) {
  requireValue(
    fs.statSync(directory, { throwIfNoEntry: false })?.isDirectory(),
    `${label} is missing: ${directory}`,
  );
}

function verifyIdentity(file, expected, label, verifyHash) {
  requireFile(file, label);
  const actualLength = fs.statSync(file).size;
  requireValue(
    actualLength === expected.byteLength,
    `${label} byteLength mismatch: expected ${expected.byteLength}, got ${actualLength}`,
  );
  if (verifyHash) {
    const actualSha256 = sha256File(file);
    requireValue(
      actualSha256 === expected.sha256,
      `${label} SHA-256 mismatch: expected ${expected.sha256}, got ${actualSha256}`,
    );
  }
}

export function resolveOfficialSampleInputs({
  manifestPath = process.env.PCR_OFFICIAL_SAMPLE_MANIFEST,
  samplesRoot = process.env.PCR_OFFICIAL_SAMPLES_ROOT || DEFAULT_SAMPLES_ROOT,
  verifyArtifactHashes = true,
} = {}) {
  const loaded = loadOfficialSample(manifestPath);
  const { sample } = loaded;
  requireValue(sample.status === "baseline", `selected sample ${sample.sampleId} is not a baseline`);

  const absoluteSamplesRoot = path.resolve(samplesRoot);
  const sampleRoot = path.join(absoluteSamplesRoot, sample.sampleId);
  const artifactsRoot = path.join(sampleRoot, "artifacts");
  const decryptedRoot = path.join(sampleRoot, "decrypted-full");
  const masterdataRoot = path.join(sampleRoot, "business-masterdata-full", "MasterData");
  // Face/Shader proof roots are the B3a asset snapshot. Business MasterData
  // and localized strings are the later B3b content domain pinned by the
  // manifest's 3305-card denominator.
  const localeRoot = path.join(sampleRoot, "locale-json-b3b");
  const inventoryPath = path.join(sampleRoot, "material-program-inventory-full.json");
  const il2CppDumperRoot = path.join(artifactsRoot, "il2cppdumper");

  requireDirectory(sampleRoot, "sample root");
  requireDirectory(decryptedRoot, "full decrypted asset root");
  requireDirectory(masterdataRoot, "full business MasterData root");
  requireDirectory(path.join(path.dirname(masterdataRoot), "Locale"), "business Locale root");
  requireDirectory(localeRoot, "locale JSON root");

  const artifactFiles = {};
  for (const [identityName, relativePath] of Object.entries(ARTIFACT_PATHS)) {
    const file = path.join(artifactsRoot, ...relativePath.split("/"));
    verifyIdentity(
      file,
      sample.artifacts[identityName],
      `artifact ${identityName}`,
      verifyArtifactHashes,
    );
    artifactFiles[identityName] = file;
  }

  const materialized = readJson(path.join(artifactsRoot, "materialized-inputs.json"));
  requireValue(materialized.sampleId === sample.sampleId, "materialized artifact sampleId mismatch");
  requireValue(
    materialized.sampleManifestSha256 === officialSampleDigest(sample),
    "materialized artifact manifest digest mismatch",
  );

  const decryptedAudit = readJson(path.join(sampleRoot, "decrypted-full-audit.json"));
  requireValue(decryptedAudit.status === "exact", "full decrypted asset audit is not exact");
  requireValue(
    decryptedAudit.catalogEntries === decryptedAudit.actualFiles
      && decryptedAudit.exactXxHash64 === decryptedAudit.catalogEntries,
    "full decrypted asset audit denominator is not closed",
  );

  const masterdataInventory = readJson(
    path.join(sampleRoot, "business-masterdata-full-inventory.json"),
  );
  requireValue(masterdataInventory.sampleId === sample.sampleId, "MasterData sampleId mismatch");
  requireValue(masterdataInventory.fileCount === 188, "MasterData inventory is incomplete");
  verifyIdentity(
    path.join(masterdataRoot, "PokemonCard.json"),
    {
      byteLength: fs.statSync(path.join(masterdataRoot, "PokemonCard.json")).size,
      sha256: sample.snapshots.masterdata.pokemonSha256,
    },
    "PokemonCard snapshot",
    true,
  );
  verifyIdentity(
    path.join(masterdataRoot, "TrainerCard.json"),
    {
      byteLength: fs.statSync(path.join(masterdataRoot, "TrainerCard.json")).size,
      sha256: sample.snapshots.masterdata.trainerSha256,
    },
    "TrainerCard snapshot",
    true,
  );

  const localeProvenance = readJson(path.join(localeRoot, "locale-provenance.json"));
  requireValue(localeProvenance.schemaVersion === 1, "unsupported locale provenance schema");
  for (const locale of LOCALES) {
    const identity = localeProvenance.locales?.[locale];
    requireValue(identity?.outputSha256, `locale ${locale} has no output identity`);
    const localeFile = path.join(localeRoot, `locale_${locale}.json`);
    verifyIdentity(
      localeFile,
      {
        byteLength: fs.statSync(localeFile, { throwIfNoEntry: false })?.size,
        sha256: identity.outputSha256,
      },
      `locale ${locale}`,
      true,
    );
  }

  requireFile(inventoryPath, "material/program inventory");
  const programInventory = readJson(inventoryPath);
  const proofSet = sample.proofSets.materialPrograms;
  requireValue(
    programInventory.unityVersion === sample.unity.serializedVersion,
    "material/program inventory Unity version mismatch",
  );
  requireValue(
    programInventory.summary?.lPrefabs === sample.snapshots.faceBundles.count
      && programInventory.summary?.uniqueMaterials === proofSet.materialCount
      && programInventory.summary?.resolvedMaterials === proofSet.resolvedMaterialCount
      && programInventory.summary?.selectorArchetypes === proofSet.selectorCount
      && programInventory.summary?.semanticExecutableArchetypes === proofSet.semanticExecutableCount,
    "material/program inventory summary does not match the selected manifest",
  );

  const shaderRoot = path.join(decryptedRoot, "Common", "Shader");
  const faceRoot = path.join(decryptedRoot, "Common", "CardNew", "Face");
  const cardViewBundle = path.join(
    decryptedRoot,
    "Common",
    "UI",
    "Prefabs",
    "Common",
    "CommonUICardDetailCard.prefab_bundles",
  );
  const glitterBundle = path.join(
    decryptedRoot,
    "Common",
    "CardNew",
    "Common",
    "Model",
    "Prefabs",
    "Parts",
    "UR",
    "L_Card_Glitter_FLowMaps.prefab_bundles",
  );
  for (const [directory, label] of [
    [shaderRoot, "official Shader root"],
    [faceRoot, "official Face root"],
  ]) requireDirectory(directory, label);
  for (const [file, label] of [
    [cardViewBundle, "card detail prefab"],
    [glitterBundle, "UR glitter prefab"],
  ]) requireFile(file, label);
  const il2CppScript = path.join(il2CppDumperRoot, "script.json");
  const il2CppDump = path.join(il2CppDumperRoot, "dump.cs");
  const il2CppStringLiterals = path.join(il2CppDumperRoot, "stringliteral.json");
  verifyIdentity(
    il2CppScript,
    {
      byteLength: 139197011,
      sha256: "c6bbe3dd41b5530fae30c3b8f6d27bdcf212e442c024da71478621b8818c1e21",
    },
    "Il2CppDumper script.json",
    verifyArtifactHashes,
  );
  verifyIdentity(
    il2CppDump,
    {
      byteLength: 54799526,
      sha256: "c4cb0e42469f1ad76cabdc01be989f9b761f8bc7ffc9ee5139ba5a1496d9e213",
    },
    "Il2CppDumper dump.cs",
    verifyArtifactHashes,
  );
  verifyIdentity(
    il2CppStringLiterals,
    {
      byteLength: 3851838,
      sha256: "514ff3abee1a7f302d23323054dfc5de74e49688ee8b217ba27ea9b9a37bfa57",
    },
    "Il2CppDumper stringliteral.json",
    verifyArtifactHashes,
  );

  const environment = {
    // Preserve the selected entry point (normally current.json). Runtime
    // provenance intentionally hashes both that pointer and its immutable
    // manifest; replacing the pointer with the resolved manifest would make
    // otherwise identical server and audit processes disagree on source identity.
    PCR_OFFICIAL_SAMPLE_MANIFEST: loaded.selectionPath,
    PCR_OFFICIAL_SAMPLES_ROOT: absoluteSamplesRoot,
    PCR_DECRYPTED_ROOT: decryptedRoot,
    PCR_SHADERS: shaderRoot,
    PCR_OFFICIAL_FACE_ROOT: faceRoot,
    PCR_BUSINESS_MASTERDATA_ROOT: path.dirname(masterdataRoot),
    PCR_MASTERDATA_ROOT: masterdataRoot,
    PCR_MASTERDATA: masterdataRoot,
    PTCG_MASTERDATA: masterdataRoot,
    PTCG_LOCALE_ROOT: localeRoot,
    PCR_APKM: artifactFiles.apkm,
    PCR_BASE_APK: artifactFiles.baseApk,
    PCR_ARM64_SPLIT: artifactFiles.arm64Split,
    PCR_ARM64_SPLIT_CACHE: artifactFiles.arm64Split,
    PCR_BUNDLED_TREE_SPLIT: artifactFiles.bundledTreeSplit,
    PCR_GAME_LIBUNITY: artifactFiles.libunity,
    PCR_LIBIL2CPP: artifactFiles.libil2cpp,
    PCR_IL2CPP: artifactFiles.libil2cpp,
    PCR_METADATA: artifactFiles.globalMetadataPlaintext,
    PCR_GLOBAL_METADATA: artifactFiles.globalMetadataPlaintext,
    PCR_IL2CPP_DUMPER_OUT: il2CppDumperRoot,
    PCR_IL2CPP_SCRIPT: il2CppScript,
    PCR_DUMP_CS: il2CppDump,
    PCR_METADATA_ENCRYPTED: artifactFiles.globalMetadataEncrypted,
    PCR_BOOT_CONFIG: artifactFiles.bootConfig,
    PCR_GLOBALGAMEMANAGERS: artifactFiles.globalGameManagers,
    PCR_UNITY_RELEASE_LIBUNITY: artifactFiles.unityReleasePlayer,
    PCR_UNITY_RELEASE_SYMBOLS: artifactFiles.unityReleaseSymbols,
    PCR_PROGRAM_INVENTORY: inventoryPath,
    PCR_MATERIAL_PROGRAM_INVENTORY: inventoryPath,
    PCR_CARD_VIEW_BUNDLE: cardViewBundle,
    PCR_GLITTER_BUNDLE: glitterBundle,
  };

  return {
    loaded,
    sampleRoot,
    artifactsRoot,
    decryptedRoot,
    masterdataRoot,
    localeRoot,
    inventoryPath,
    environment,
  };
}

export const officialSamplesRootDefault = DEFAULT_SAMPLES_ROOT;

if (
  process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const resolved = resolveOfficialSampleInputs();
  process.stdout.write(`${JSON.stringify({
    schemaVersion: 1,
    status: "exact",
    sampleId: resolved.loaded.sample.sampleId,
    sampleManifestSha256: officialSampleDigest(resolved.loaded.sample),
    decryptedAssetAudit: readJson(
      path.join(resolved.sampleRoot, "decrypted-full-audit.json"),
    ),
    masterdataInventory: {
      fileCount: 188,
      aggregateSha256: readJson(
        path.join(resolved.sampleRoot, "business-masterdata-full-inventory.json"),
      ).aggregateSha256,
    },
    localeIndexHash: readJson(
      path.join(resolved.localeRoot, "locale-provenance.json"),
    ).assetIndex.aladdinHash,
    environmentKeys: Object.keys(resolved.environment).sort(),
  }, null, 2)}\n`);
}
