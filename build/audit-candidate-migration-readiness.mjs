#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  loadOfficialSample,
  officialSampleDigest,
} from "./official-sample.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT_ROOT = path.resolve(
  process.env.PCR_CANDIDATE_OUTPUT_ROOT
    || path.join(
      ROOT,
      "..",
      "ptcgp-tools-master",
      "masterdata_decoder",
      ".output-full",
    ),
);
const SPLIT_ROOT = path.resolve(
  process.env.PCR_CANDIDATE_SPLITS
    || path.join(
      ROOT,
      "..",
      "ptcg-apk-parser",
      "apks",
      "apkeep-downloads",
      "jp.pokemon.pokemontcgp",
      "jp.pokemon.pokemontcgp",
    ),
);
const CANDIDATE_POINTER = path.resolve(
  process.env.PCR_OFFICIAL_CANDIDATE_MANIFEST
    || path.join(ROOT, "build", "official-samples", "candidate.json"),
);
const DOMAIN_ORDER = [
  "package-native",
  "unity-runtime",
  "serialized-assets",
  "shader-programs",
  "runtime-evidence",
  "documentation",
];

function sha256File(filename) {
  return crypto
    .createHash("sha256")
    .update(fs.readFileSync(filename))
    .digest("hex");
}

function readJson(filename) {
  return JSON.parse(fs.readFileSync(filename, "utf8").replace(/^\uFEFF/, ""));
}

function existsFile(filename) {
  return fs.statSync(filename, { throwIfNoEntry: false })?.isFile() === true;
}

function run(command, args, envOverrides = {}) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: "utf8",
    shell: process.platform === "win32",
    windowsHide: true,
    env: {
      ...process.env,
      ...envOverrides,
    },
  });
  return {
    ok: result.status === 0,
    command: [command, ...args].join(" "),
    exitCode: result.status,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    output: `${result.stdout || ""}${result.stderr || ""}`.trim(),
  };
}

function parseJsonCommand(result) {
  if (!result?.ok || typeof result.stdout !== "string") return null;
  try {
    return JSON.parse(result.stdout.replace(/^\uFEFF/, ""));
  } catch {
    return null;
  }
}

function check(id, ok, detail, evidence = undefined) {
  return {
    id,
    status: ok ? "pass" : "fail",
    detail,
    ...(evidence === undefined ? {} : { evidence }),
  };
}

function domain(id, checks, remaining, blockedBy = []) {
  const failed = checks.some((item) => item.status !== "pass");
  const status = blockedBy.length > 0
    ? "blocked"
    : failed || remaining.length > 0
      ? "partial"
      : "pass";
  return { id, status, checks, remaining, blockedBy };
}

function unresolvedRoots(sample) {
  const roots = [];
  for (const [name, value] of Object.entries(sample.artifacts)) {
    if (value?.status === "unresolved") roots.push(`artifacts.${name}`);
  }
  for (const name of ["playerBuildVersion", "releaseSupportVersion"]) {
    if (sample.unity[name]?.status === "unresolved") roots.push(`unity.${name}`);
  }
  if (sample.proofSets?.materialPrograms?.status === "unresolved") {
    roots.push("proofSets.materialPrograms");
  }
  if (sample.canonicalCorpus?.status === "unresolved") {
    roots.push("canonicalCorpus");
  }
  return roots;
}

function staticReuseManifestCount(root) {
  if (!fs.statSync(root, { throwIfNoEntry: false })?.isDirectory()) return 0;
  return fs.readdirSync(root)
    .filter((name) => name.endsWith("_uniforms.json"))
    .length;
}

function artifactFactBound(root, fact) {
  if (
    typeof fact?.logicalPath !== "string"
    || !Number.isInteger(fact?.byteLength)
    || !/^[0-9a-f]{64}$/.test(fact?.sha256 || "")
  ) {
    return false;
  }
  const filename = path.resolve(root, fact.logicalPath);
  const relative = path.relative(root, filename);
  if (relative === ".." || relative.startsWith(`..${path.sep}`)) return false;
  return existsFile(filename)
    && fs.statSync(filename).size === fact.byteLength
    && sha256File(filename) === fact.sha256;
}

function canonicalSceneArtifactsBound(reportPath, corpusRoot) {
  if (!existsFile(reportPath)) return false;
  const report = readJson(reportPath);
  if (!Array.isArray(report.scenes) || report.scenes.length === 0) return false;
  return report.scenes.every((scene) => (
    artifactFactBound(
      corpusRoot,
      {
        logicalPath: `scenes/${scene.file}`,
        byteLength: scene.byteLength,
        sha256: scene.sha256,
      },
    )
    && artifactFactBound(corpusRoot, scene.recipe)
  )) && artifactFactBound(corpusRoot, report.textureEvidence);
}

export function auditCandidateMigrationReadiness({
  candidateManifest = CANDIDATE_POINTER,
  deep = false,
} = {}) {
  const loaded = loadOfficialSample(candidateManifest);
  const sample = loaded.sample;
  if (sample.status !== "candidate") {
    throw new Error("candidate readiness requires a status:candidate sample");
  }
  const sampleManifestSha256 = officialSampleDigest(sample);
  const candidateStem = sample.sampleId.replace(/-candidate$/, "");
  const probePath = path.join(OUTPUT_ROOT, "candidate-probe.json");
  const snapshotPath = path.join(OUTPUT_ROOT, "snapshot.json");
  const inventoryPath = path.join(
    OUTPUT_ROOT,
    "material-program-inventory-full.json",
  );
  const migrationPath = path.join(
    ROOT,
    "build",
    "official-samples",
    `${candidateStem}-shader-migration.json`,
  );
  const analysisPath = path.join(
    ROOT,
    "build",
    "official-samples",
    `${candidateStem}-shader-analysis.json`,
  );
  const subcorpusPath = path.join(
    ROOT,
    "build",
    "official-samples",
    `${candidateStem}-changed-route-corpus.json`,
  );
  const meshPayloadPath = path.join(
    ROOT,
    "build",
    "official-samples",
    `${candidateStem}-mesh-payload.json`,
  );
  const vertexBindingsPath = path.join(
    ROOT,
    "build",
    "official-samples",
    `${candidateStem}-vertex-bindings.json`,
  );
  const serializedUiPath = path.join(
    ROOT,
    "build",
    "official-samples",
    `${candidateStem}-serialized-ui-corpus.json`,
  );
  const canonicalScenesPath = path.join(
    ROOT,
    "build",
    "official-samples",
    `${candidateStem}-canonical-scenes.json`,
  );
  const tmpSerializedPath = path.join(
    ROOT,
    "build",
    "official-samples",
    `${candidateStem}-tmp-serialized.json`,
  );
  const tmpSpritePath = path.join(
    ROOT,
    "build",
    "official-samples",
    `${candidateStem}-tmp-sprite.json`,
  );
  const tmpFontEnginePath = path.join(
    ROOT,
    "build",
    "official-samples",
    `${candidateStem}-tmp-fontengine.json`,
  );
  const renderTexturePath = path.join(
    ROOT,
    "build",
    "official-samples",
    `${candidateStem}-candidate-rendertexture-boundary.json`,
  );
  const unityNativePath = path.join(
    ROOT,
    "build",
    "official-samples",
    `${candidateStem}-unity-native.json`,
  );
  const metadataDerivationPath = path.join(
    ROOT,
    "build",
    "official-samples",
    `${candidateStem}-metadata-derivation.json`,
  );
  const localizedTextPath = path.join(
    ROOT,
    "build",
    "official-samples",
    `${candidateStem}-localized-text-corpus.json`,
  );
  const officialGuestRuntimeBatchPath = path.join(
    ROOT,
    "build",
    "official-samples",
    `${candidateStem}-official-guest-runtime-batch.json`,
  );
  const guestPlatformBlockerPath = path.join(
    ROOT,
    "build",
    "official-samples",
    `${candidateStem}-guest-platform-blocker.json`,
  );
  const staticReuseRoot = path.join(
    OUTPUT_ROOT,
    "webgl-ports",
    "static-reuse",
  );
  const candidateCorpusRoot = path.join(
    OUTPUT_ROOT,
    "canonical-corpus",
    candidateStem,
  );
  const staticReuseScript = path.join(
    ROOT,
    "build",
    "build-candidate-static-port-reuse.mjs",
  );
  const candidateContractPath = path.join(
    ROOT,
    "build",
    "official-samples",
    `${candidateStem}-program-port-contract.json`,
  );
  const staticReuseCount = staticReuseManifestCount(staticReuseRoot);
  const staticReuseIndexPath = path.join(staticReuseRoot, "index.json");
  const metadataPath = path.resolve(
    process.env.PCR_CANDIDATE_METADATA
      || path.join(
        ROOT,
        "..",
        "ptcg-apk-parser",
        "apks",
        "output",
        "global-metadata.dat",
      ),
  );
  const unityReleaseRoot = path.resolve(
    ROOT,
    "..",
    ".cache",
    `unity-${sample.artifacts.unityReleasePlayer?.source?.version || "missing"}`,
    "symbols",
  );
  const releasePlayerPath = path.resolve(
    process.env.PCR_UNITY_RELEASE_LIBUNITY
      || path.join(unityReleaseRoot, "libunity.release.arm64.so"),
  );
  const releaseSymbolsPath = path.resolve(
    process.env.PCR_UNITY_RELEASE_SYMBOLS
      || path.join(unityReleaseRoot, "libunity.release.arm64.sym.so"),
  );
  const packageArgs = [
    "-B",
    "build/verify_official_sample_inputs.py",
    "--manifest",
    loaded.selectionPath,
    "--splits",
    SPLIT_ROOT,
    "--metadata-plaintext",
    metadataPath,
  ];
  if (sample.artifacts.unityReleasePlayer?.status !== "unresolved") {
    packageArgs.push("--unity-release-player", releasePlayerPath);
  }
  if (sample.artifacts.unityReleaseSymbols?.status !== "unresolved") {
    packageArgs.push("--unity-release-symbols", releaseSymbolsPath);
  }
  const packageCheck = run("python", packageArgs);
  const nativeVariant = run(process.execPath, [
    "build/audit-candidate-shader-variant-selection.mjs",
  ]);
  const migrationDiff = run(process.execPath, [
    "build/compare_official_program_inventories.mjs",
    "--check",
  ]);
  const changedPorts = run("npm", [
    "run",
    "audit:candidate-changed-ports",
    "--silent",
  ]);
  const staticReuseIndex = existsFile(staticReuseIndexPath)
    ? readJson(staticReuseIndexPath)
    : null;
  const staticReuseFastBound = Boolean(
    staticReuseCount === 68
    && staticReuseIndex?.schema
      === "pocket-card-render/candidate-static-port-reuse-index@1"
    && staticReuseIndex.candidate?.sampleId === sample.sampleId
    && staticReuseIndex.candidate?.sampleManifestSha256
      === sampleManifestSha256
    && staticReuseIndex.evidence?.candidateInventory?.sha256
      === sample.proofSets.materialPrograms.inventorySha256
    && staticReuseIndex.denominator?.formalStaticReusePorts === 68
    && staticReuseIndex.denominator?.engineOwnedRuntimeBoundaries === 1
    && staticReuseIndex.denominator?.totalFormalCandidatePorts === 78
    && staticReuseIndex.formalPorts?.length === 68
    && staticReuseIndex.formalPorts.every((port) => {
      const filename = path.join(staticReuseRoot, port.manifest);
      return existsFile(filename) && sha256File(filename) === port.manifestSha256;
    }),
  );
  const staticReuseAudit = deep
    && existsFile(staticReuseScript)
    && staticReuseFastBound
    ? run(process.execPath, [
        "build/build-candidate-static-port-reuse.mjs",
        "--check",
      ])
    : {
        ok: staticReuseFastBound,
        command: deep ? null : "index-and-manifest-hash-verification",
        exitCode: staticReuseFastBound ? 0 : null,
      };
  const candidateContractAudit = existsFile(candidateContractPath)
    ? run(process.execPath, [
        "build/build-candidate-program-port-contract.mjs",
        "--check",
      ])
    : { ok: false, command: null, exitCode: null };
  const meshPayloadAudit = existsFile(meshPayloadPath)
    ? run(process.execPath, [
        "build/build-candidate-mesh-payload-evidence.mjs",
        "--check",
      ])
    : { ok: false, command: null, exitCode: null };
  const vertexBindingsAudit = existsFile(vertexBindingsPath)
    ? run(process.execPath, [
        "build/build-candidate-vertex-binding-evidence.mjs",
        "--check",
      ])
    : { ok: false, command: null, exitCode: null };
  const serializedUiAudit = existsFile(serializedUiPath)
    ? run(process.execPath, [
        "build/build-candidate-serialized-ui-corpus.mjs",
        "--check",
      ])
    : { ok: false, command: null, exitCode: null };
  const canonicalScenesFastBound = canonicalSceneArtifactsBound(
    canonicalScenesPath,
    candidateCorpusRoot,
  );
  const canonicalScenesAudit = deep
    && existsFile(canonicalScenesPath)
    && canonicalScenesFastBound
    ? run(process.execPath, [
        "build/build-candidate-canonical-scenes.mjs",
        "--check",
      ])
    : {
        ok: canonicalScenesFastBound,
        command: deep ? null : "canonical-scene-artifact-hashes",
        exitCode: canonicalScenesFastBound ? 0 : null,
      };
  const effectiveRenderQueueAudit = run(
    process.env.PYTHON || "python",
    ["-B", "build/test_effective_render_queue.py"],
  );
  const tmpSerializedAudit = existsFile(tmpSerializedPath)
    ? run(process.execPath, [
        "build/build-candidate-tmp-serialized-report.mjs",
        "--check",
      ])
    : { ok: false, command: null, exitCode: null };
  const tmpSpriteAudit = existsFile(tmpSpritePath)
    ? run(process.execPath, [
        "build/build-candidate-tmp-sprite-report.mjs",
        "--check",
      ])
    : { ok: false, command: null, exitCode: null };
  const tmpFontEngineAudit = existsFile(tmpFontEnginePath)
    ? run(process.execPath, [
        "build/build-candidate-tmp-fontengine-report.mjs",
        "--check",
      ])
    : { ok: false, command: null, exitCode: null };
  const renderTextureAudit = existsFile(renderTexturePath)
    ? run(process.execPath, [
        "build/build-candidate-rendertexture-report.mjs",
        "--check",
      ])
    : { ok: false, command: null, exitCode: null };
  const unityNativeAudit = existsFile(unityNativePath)
    ? run(process.execPath, [
        "build/build-candidate-unity-native-report.mjs",
        "--check",
      ])
    : { ok: false, command: null, exitCode: null };
  const metadataDerivationAudit = existsFile(metadataDerivationPath)
    ? run(process.execPath, [
        "build/build-candidate-metadata-derivation-report.mjs",
        "--check",
      ])
    : { ok: false, command: null, exitCode: null };
  const localizedTextAudit = existsFile(localizedTextPath)
    ? run(process.execPath, [
        "build/build-candidate-localized-text-corpus.mjs",
        "--check",
      ])
    : { ok: false, command: null, exitCode: null };
  const candidateRuntimeEnvironment = {
    PCR_OFFICIAL_SAMPLE_MANIFEST: loaded.manifestPath,
  };
  const localFullRuntimeAudit = run(process.execPath, [
    "build/audit-full-runtime-evidence.mjs",
    "--require",
  ], candidateRuntimeEnvironment);
  const candidateProgramPortCoverage = run(process.execPath, [
    "build/audit-candidate-program-port-coverage.mjs",
  ], {
    ...candidateRuntimeEnvironment,
    PCR_PROGRAM_PORT_GENERATORS_EXTERNALLY_VERIFIED:
      changedPorts.ok && staticReuseAudit.ok && candidateContractAudit.ok ? "1" : "0",
  });
  const localTmpRuntimeAudit = run(process.execPath, [
    "build/audit-tmp-runtime-evidence.mjs",
    "--require",
  ], candidateRuntimeEnvironment);
  const localDisplayAuditCommand = run(process.execPath, [
    "build/audit-runtime-display-fidelity.mjs",
    "--json",
  ], candidateRuntimeEnvironment);
  const localDisplayAudit = parseJsonCommand(localDisplayAuditCommand);
  const officialGuestRuntimeBatchAudit = run(process.execPath, [
    "build/build-candidate-official-guest-runtime-batch.mjs",
    "--candidate-manifest",
    loaded.selectionPath,
    "--check",
  ]);
  const gfxreconstructConversionAudit = run(process.execPath, [
    "--test",
    "build/test-gfxrecon-vulkan-capture-conversion.mjs",
  ]);
  const guestPlatformBlockerAudit = existsFile(guestPlatformBlockerPath)
    ? run(process.execPath, [
        "build/build-candidate-guest-platform-blocker.mjs",
        "--candidate-manifest",
        loaded.selectionPath,
        "--check",
      ])
    : { ok: false, command: null, exitCode: null };

  const snapshot = existsFile(snapshotPath) ? readJson(snapshotPath) : null;
  const inventory = existsFile(inventoryPath) ? readJson(inventoryPath) : null;
  const analysis = existsFile(analysisPath) ? readJson(analysisPath) : null;
  const subcorpus = existsFile(subcorpusPath) ? readJson(subcorpusPath) : null;
  const meshPayload = existsFile(meshPayloadPath)
    ? readJson(meshPayloadPath)
    : null;
  const vertexBindings = existsFile(vertexBindingsPath)
    ? readJson(vertexBindingsPath)
    : null;
  const serializedUi = existsFile(serializedUiPath)
    ? readJson(serializedUiPath)
    : null;
  const canonicalScenes = existsFile(canonicalScenesPath)
    ? readJson(canonicalScenesPath)
    : null;
  const tmpSerialized = existsFile(tmpSerializedPath)
    ? readJson(tmpSerializedPath)
    : null;
  const tmpSprite = existsFile(tmpSpritePath)
    ? readJson(tmpSpritePath)
    : null;
  const tmpFontEngine = existsFile(tmpFontEnginePath)
    ? readJson(tmpFontEnginePath)
    : null;
  const renderTexture = existsFile(renderTexturePath)
    ? readJson(renderTexturePath)
    : null;
  const unityNative = existsFile(unityNativePath)
    ? readJson(unityNativePath)
    : null;
  const metadataDerivation = existsFile(metadataDerivationPath)
    ? readJson(metadataDerivationPath)
    : null;
  const localizedText = existsFile(localizedTextPath)
    ? readJson(localizedTextPath)
    : null;
  const officialGuestRuntimeBatch =
    existsFile(officialGuestRuntimeBatchPath)
      ? readJson(officialGuestRuntimeBatchPath)
      : null;
  const guestPlatformBlocker = existsFile(guestPlatformBlockerPath)
    ? readJson(guestPlatformBlockerPath)
    : null;
  const snapshotBound = Boolean(
    snapshot?.complete
    && snapshot.game?.appVersion === sample.game.versionName
    && snapshot.game?.unityVersion === sample.unity.serializedVersion
    && existsFile(probePath)
    && snapshot.evidence?.candidateProbeSha256 === sha256File(probePath)
    && existsFile(inventoryPath)
    && snapshot.evidence?.materialProgramInventorySha256
      === sha256File(inventoryPath),
  );
  const inventoryBound = Boolean(
    inventory?.schema === sample.proofSets.materialPrograms.inventorySchema
    && sha256File(inventoryPath)
      === sample.proofSets.materialPrograms.inventorySha256
    && inventory.digests?.proofGraphSha256
      === sample.proofSets.materialPrograms.proofGraphSha256
    && inventory.digests?.portIndexSha256
      === sample.proofSets.materialPrograms.portIndexSha256,
  );
  const analysisBound = Boolean(
    analysis?.candidateSampleId === sample.sampleId
    && analysis?.candidateInventorySha256
      === sample.proofSets.materialPrograms.inventorySha256
    && analysis?.summary?.changedRoutes === 9
    && analysis?.summary?.staticReuseValidated === 69
    && analysis?.summary?.staticReuseRejected === 1,
  );
  const changedSubcorpusBound = Boolean(
    subcorpus?.candidate?.sampleId === sample.sampleId
    && subcorpus?.candidate?.sampleManifestSha256 === sampleManifestSha256
    && subcorpus?.summary?.selectorObligationCount === 10
    && subcorpus?.summary?.uncoveredSelectorCount === 0
    && subcorpus?.summary?.selectedMissingGameReferenceCount === 0,
  );
  const meshPayloadBound = Boolean(
    meshPayload?.schema
      === "pocket-card-render/candidate-mesh-payload-evidence@1"
    && meshPayload?.candidate?.sampleId === sample.sampleId
    && meshPayload?.candidate?.sampleManifestSha256 === sampleManifestSha256
    && meshPayload?.inputs?.materialProgramInventory?.sha256
      === sample.proofSets.materialPrograms.inventorySha256
    && meshPayload?.proof?.status === "exact-static"
    && meshPayload?.proof?.geometryReuse === "exact"
    && meshPayload?.proof?.runtimeGuestVertexBinding === "runtime-required"
    && meshPayload?.summary?.runtimeRequiredMaterialSlotCount === 0
    && meshPayload?.cards?.length === 4,
  );
  const vertexBindingsBound = Boolean(
    existsFile(meshPayloadPath)
    && vertexBindings?.schema
      === "pocket-card-render/candidate-vertex-binding-evidence@1"
    && vertexBindings?.candidate?.sampleId === sample.sampleId
    && vertexBindings?.candidate?.sampleManifestSha256
      === sampleManifestSha256
    && vertexBindings?.inputs?.materialProgramInventory?.sha256
      === sample.proofSets.materialPrograms.inventorySha256
    && existsFile(candidateContractPath)
    && vertexBindings?.inputs?.candidateProgramPortContract?.sha256
      === sha256File(candidateContractPath)
    && vertexBindings?.inputs?.meshPayloadEvidence?.sha256
      === sha256File(meshPayloadPath)
    && vertexBindings?.proof?.status
      === "exact-static-with-runtime-boundary"
    && vertexBindings?.proof?.selectorSemantics === "exact"
    && vertexBindings?.proof?.localWebglAdapter === "exact"
    && vertexBindings?.summary?.officialSemanticExactPorts
      === vertexBindings?.summary?.selectorPortCount
    && vertexBindings?.summary?.localAdapterExactPorts
      === vertexBindings?.summary?.selectorPortCount
    && vertexBindings?.summary?.presentChannelBindings
      + vertexBindings?.summary?.missingChannelBindings
      === vertexBindings?.summary?.requiredChannelBindings
    && vertexBindings?.summary?.officialGuestVertexBindingExactRows === 0,
  );
  const serializedUiBound = Boolean(
    serializedUi?.schema
      === "pocket-card-render/candidate-serialized-ui-corpus@3"
    && serializedUi?.candidate?.sampleId === sample.sampleId
    && serializedUi?.candidate?.sampleManifestSha256
      === sampleManifestSha256
    && serializedUi?.summary?.cardSettingsCount
      === sample.snapshots.faceBundles.count
    && serializedUi?.summary?.missingIllustrationCount === 0
    && serializedUi?.summary?.uiRectTransformCount > 0
    && serializedUi?.summary?.uiTmpComponentCount > 0
    && serializedUi?.summary?.uguiImageCount > 0
    && serializedUi?.summary?.uguiSpriteCount
      === serializedUi?.summary?.uguiTextureCount
    && serializedUi?.summary?.fontLocaleCount === 9
    && serializedUi?.summary?.fontAssetCount > 0
    && serializedUi?.summary?.tmpSdfModuleCount === 2
    && serializedUi?.scope?.status
      === "exact-serialized-and-candidate-native-producers-with-runtime-state-boundary"
    && serializedUi?.nativeProducerProof?.status
      === "exact-candidate-il2cpp-control-flow"
    && serializedUi?.summary?.nativeProducerStaticStatus
      === "exact-candidate-il2cpp-control-flow"
    && serializedUi?.summary?.nativeProducerRuntimeStatus
      === "runtime-required"
    && serializedUi?.summary?.exactNativeProducerMethodCount
      === serializedUi?.summary?.nativeProducerMethodCount
    && serializedUi?.summary?.nativeProducerMethodCount === 3
    && serializedUi?.summary?.exactNativeProducerControlFlowContractCount
      === serializedUi?.summary?.nativeProducerControlFlowContractCount
    && serializedUi?.summary?.nativeFontEngineFunctionCount === 9
    && serializedUi?.summary?.exactNativeFontEngineFunctionCount === 9
    && serializedUi?.inputs?.candidateTmpFontEngine?.sha256
      === (existsFile(tmpFontEnginePath)
        ? sha256File(tmpFontEnginePath)
        : null)
    && serializedUi?.summary?.nativeProducerControlFlowContractCount === 3
    && serializedUi?.runtimeBoundaries?.every(
      (boundary) => boundary.status === "runtime-required",
    ),
  );
  const canonicalScenesBound = Boolean(
    canonicalScenes?.schema
      === "pocket-card-render/candidate-canonical-scenes@3"
    && canonicalScenes?.candidate?.sampleId === sample.sampleId
    && canonicalScenes?.candidate?.sampleManifestSha256
      === sampleManifestSha256
    && canonicalScenes?.inputs?.materialProgramInventory?.sha256
      === sample.proofSets.materialPrograms.inventorySha256
    && canonicalScenes?.inputs?.changedRouteCorpus?.sha256
      === (existsFile(subcorpusPath) ? sha256File(subcorpusPath) : null)
    && canonicalScenes?.scope?.status
      === "exact-static-scene-draw-material-state-and-texture-bindings"
    && canonicalScenes?.scope?.completeForDeclaredMigrationWitnessSet === true
    && canonicalScenes?.scope?.fullMaterialSerializedState
      === "exact-official-raw-bytes-and-renderer-projection"
    && canonicalScenes?.scope?.candidateCanonicalCorpus === true
    && canonicalScenes?.inputs?.canonicalCorpus?.logicalPath
      === sample.canonicalCorpus.path
    && canonicalScenes?.inputs?.canonicalCorpus?.sha256
      === sample.canonicalCorpus.sha256
    && canonicalScenes?.summary?.sceneCount
      === canonicalScenes?.scenes?.length
    && canonicalScenes?.summary?.baselineRegressionSceneCount > 0
    && canonicalScenes?.summary?.changedRouteWitnessSceneCount > 0
    && canonicalScenes?.summary?.coveredSelectorObligationCount
      === canonicalScenes?.summary?.selectorObligationCount
    && canonicalScenes?.summary?.exactMaterialStateDrawCount
      === canonicalScenes?.summary?.materialStateDrawCount
    && canonicalScenes?.summary?.materialStateDrawCount
      === canonicalScenes?.summary?.officialDrawCount
    && canonicalScenes?.summary?.uniqueMaterialStateCount > 0
    && canonicalScenes?.summary?.officialDrawCount > 0
    && canonicalScenes?.summary?.textureBindingCount > 0
    && canonicalScenes?.summary?.unresolvedTextureCount === 0
    && canonicalScenes?.runtimeBoundaries?.every(
      (boundary) => boundary.status === "runtime-required",
    ),
  );
  const tmpSerializedBound = Boolean(
    tmpSerialized?.schema
      === "pocket-card-render/candidate-tmp-serialized-report@2"
    && tmpSerialized?.candidate?.sampleId === sample.sampleId
    && tmpSerialized?.candidate?.sampleManifestSha256
      === sampleManifestSha256
    && tmpSerialized?.summary?.decodedTmpSettingsPayloadFieldCount === 36
    && tmpSerialized?.tmpSettings?.fieldLayout?.strictEof === true
    && tmpSerialized?.summary?.fontAssetCount > 0
    && tmpSerialized?.summary?.atlasTextureCount > 0
    && tmpSerialized?.summary?.glyphCount > 0
    && tmpSerialized?.summary?.characterCount > 0
    && tmpSerialized?.scope?.nativeCodeUsed === true
    && tmpSerialized?.nativeFontEngine?.status
      === "exact-candidate-native-control-flow"
    && tmpSerialized?.inputs?.candidateTmpFontEngine?.sha256
      === (existsFile(tmpFontEnginePath)
        ? sha256File(tmpFontEnginePath)
        : null)
    && tmpSerialized?.summary?.nativeFontEngineFunctionCount === 9
    && tmpSerialized?.summary?.exactNativeFontEngineFunctionCount === 9
    && tmpSerialized?.runtimeBoundaries?.length > 0
    && tmpSerialized.runtimeBoundaries.every(
      (boundary) => boundary.status === "runtime-required",
    )
  );
  const tmpSpriteBound = Boolean(
    tmpSprite?.schema
      === "pocket-card-render/candidate-tmp-sprite-report@1"
    && tmpSprite?.candidate?.sampleId === sample.sampleId
    && tmpSprite?.candidate?.sampleManifestSha256 === sampleManifestSha256
    && tmpSprite?.scope?.serializedSpriteAsset === "exact"
    && tmpSprite?.scope?.nativePreprocessor
      === "exact-native-instruction-pattern"
    && tmpSprite?.scope?.unity6TextGeneratorLayout === "runtime-required"
    && tmpSprite?.scope?.baselineUnity2022LayoutReused === false
    && tmpSprite?.summary?.glyphCount === 4
    && tmpSprite?.summary?.characterCount === 4
    && tmpSprite?.summary?.nativeMethodCount === 3
    && tmpSprite?.runtimeBoundary?.status === "runtime-required"
  );
  const tmpFontEngineBound = Boolean(
    tmpFontEngine?.schema
      === "pocket-card-render/candidate-tmp-fontengine-report@1"
    && tmpFontEngine?.candidate?.sampleId === sample.sampleId
    && tmpFontEngine?.candidate?.sampleManifestSha256
      === sampleManifestSha256
    && tmpFontEngine?.scope?.nativeProducer
      === "exact-candidate-native-control-flow"
    && tmpFontEngine?.scope?.guestDynamicAtlas === "runtime-required"
    && tmpFontEngine?.scope?.baselineUnity2022EvidenceReused === false
    && tmpFontEngine?.sources?.gameLibunity?.sha256
      === sample.artifacts.libunity.sha256
    && tmpFontEngine?.sources?.releasePlayer?.sha256
      === sample.artifacts.unityReleasePlayer.sha256
    && tmpFontEngine?.sources?.releaseSymbols?.sha256
      === sample.artifacts.unityReleaseSymbols.sha256
    && tmpFontEngine?.summary?.nativeFunctionCount === 9
    && tmpFontEngine?.summary?.exactNativeFunctionCount === 9
    && tmpFontEngine?.summary?.literalLoadThunkFunctionCount === 1
    && tmpFontEngine?.facts?.dynamicAtlasRenderMode?.decimal === 4165
    && tmpFontEngine?.facts?.glyphLoadFlags === 6
    && tmpFontEngine?.facts?.distanceTransform?.edgeDeltaCallCount === 9
    && tmpFontEngine?.runtimeBoundary?.status === "runtime-required"
  );
  const renderTextureBound = Boolean(
    renderTexture?.schema
      === "pocket-card-render/candidate-rendertexture-boundary@5"
    && renderTexture?.candidate?.sampleId === sample.sampleId
    && renderTexture?.candidate?.sampleManifestSha256
      === sampleManifestSha256
    && renderTexture?.scope?.status
      === "partial-exact-request-native-defaults-scene-mrt-and-player-settings-boundary"
    && renderTexture?.scope?.oldEvidenceInherited === false
    && renderTexture?.serializedBoundary?.status
      === "exact-candidate-serialized-ui-and-player-settings-transfer-bound"
    && renderTexture?.serializedBoundary?.playerSettingsContext
      ?.parser?.status
      === "official-transfer-exact-with-unread-object-suffix"
    && renderTexture?.serializedBoundary?.playerSettingsContext
      ?.officialTransferContract?.status
      === "exact-official-transfer-schema-with-unread-object-suffix"
    && renderTexture?.summary?.strictSemanticSerializedObjectCount === 5
    && renderTexture?.summary?.officialTransferExactSerializedObjectCount
      === 1
    && renderTexture?.summary?.partialParserSerializedObjectCount === 0
    && renderTexture?.summary?.exactPlayerSettingsFieldCount === 5
    && renderTexture?.summary?.officialTransferUnreadSuffixByteCount === 4
    && renderTexture?.summary
      ?.candidateSerializedUiBoundDescriptorInputFieldCount === 2
    && renderTexture?.summary?.snapshotBoundDescriptorInputFieldCount === 0
    && renderTexture?.inputs?.serializedUiCorpus?.sha256
      === (existsFile(serializedUiPath) ? sha256File(serializedUiPath) : null)
    && renderTexture?.inputs?.serializedUiCorpus?.aggregateSha256
      === serializedUi?.aggregateSha256
    && renderTexture?.inputs?.unityReleasePlayer?.sha256
      === sample.artifacts.unityReleasePlayer.sha256
    && renderTexture?.inputs?.unityReleaseSymbols?.sha256
      === sample.artifacts.unityReleaseSymbols.sha256
    && renderTexture?.summary?.candidateNativeRequestMethodCount === 10
    && renderTexture?.summary?.exactCandidateNativeRequestMethodCount === 10
    && renderTexture?.summary?.candidateUnityNativeFunctionCount === 6
    && renderTexture?.summary?.exactCandidateUnityNativeFunctionCount === 6
    && renderTexture?.summary
      ?.candidateUnityNativeFormatTableEntryCount === 29
    && renderTexture?.summary
      ?.exactCandidateUnityNativeFormatTableEntryCount === 29
    && renderTexture?.summary
      ?.candidateUnityNativeDescriptorDefaultFieldCount === 11
    && renderTexture?.summary
      ?.exactCandidateUnityNativeDescriptorDefaultFieldCount === 11
    && renderTexture?.summary?.exactRequestedGraphicsFormatMappingCount === 1
    && renderTexture?.summary?.candidateSceneMrtMethodCount === 4
    && renderTexture?.summary?.exactCandidateSceneMrtMethodCount === 4
    && renderTexture?.summary
      ?.candidateSceneMrtMetadataRelocationCount === 6
    && renderTexture?.summary
      ?.exactCandidateSceneMrtMetadataRelocationCount === 6
    && renderTexture?.summary?.sceneMrtAttachmentCount === 2
    && renderTexture?.summary?.exactSceneMrtAttachmentCount === 2
    && renderTexture?.summary?.requestVariantCount === 3
    && renderTexture?.summary?.exactRequestVariantCount === 3
    && renderTexture?.summary?.exactGuestDescriptorVariantCount === 0
    && renderTexture?.summary?.exactOrPartialExactProducerFamilyCount === 3
    && renderTexture?.summary?.runtimeRequiredProducerFamilyCount === 1
    && renderTexture?.summary?.blockerCount === 4
    && renderTexture?.producerFamilies?.some(
      (family) => family.id === "card-source-rendertexture"
        && family.status === "partial-exact",
    )
    && renderTexture?.candidateUnityNativeRenderTexture?.status
      === "exact-candidate-native-request-mapping-and-default-descriptor"
    && renderTexture?.candidateUnityNativeRenderTexture?.formatMapping
      ?.requestedGraphicsFormat?.value === 8
    && renderTexture?.candidateUnityNativeRenderTexture?.formatMapping
      ?.compatibleGraphicsFormat?.status
      === "runtime-required-device-capability"
    && renderTexture?.candidateUnityNativeRenderTexture?.descriptorDefaults
      ?.antiAliasing === 1
    && renderTexture?.candidateUnityNativeRenderTexture?.descriptorDefaults
      ?.volumeDepth === 1
    && renderTexture?.candidateUnityNativeRenderTexture?.descriptorDefaults
      ?.memoryless?.value === 0
    && renderTexture?.blockers?.some(
      (blocker) =>
        blocker.id === "unity-runtime-rendertexture-compatible-allocation"
        && blocker.status === "blocked",
    )
    && renderTexture?.producerFamilies?.some(
      (family) => family.id === "bloom-commandbuffer-intermediates"
        && family.status === "partial-exact",
    )
    && renderTexture?.producerFamilies?.some(
      (family) => family.id === "rendergraph-scene-mrt"
        && family.status === "partial-exact",
    )
    && renderTexture?.candidateNativeRequestProducer?.renderGraphSceneMrt
      ?.status
      === "partial-exact-candidate-rendergraph-scene-mrt-topology"
    && renderTexture?.candidateNativeRequestProducer?.renderGraphSceneMrt
      ?.attachments?.color?.attachmentIndex === 0
    && renderTexture?.candidateNativeRequestProducer?.renderGraphSceneMrt
      ?.attachments?.emissive?.attachmentIndex === 1
    && renderTexture?.candidateNativeRequestProducer?.bloomTemporaryRt
      ?.status === "partial-exact-candidate-command-buffer-topology"
    && renderTexture?.candidateNativeRequestProducer?.bloomTemporaryRt
      ?.allocations?.staticCallSiteCount === 5
    && renderTexture?.candidateNativeRequestProducer?.bloomTemporaryRt
      ?.releases?.staticCallSiteCount === 5
  );
  const unityNativeBound = Boolean(
    unityNative?.schema
      === "pocket-card-render/candidate-unity-native-report@1"
    && unityNative?.candidate?.sampleId === sample.sampleId
    && unityNative?.candidate?.sampleManifestSha256
      === sampleManifestSha256
    && unityNative?.candidate?.releaseSupportVersion
      === sample.unity.releaseSupportVersion
    && unityNative?.sources?.gameLibunity?.sha256
      === sample.artifacts.libunity.sha256
    && unityNative?.sources?.releasePlayer?.sha256
      === sample.artifacts.unityReleasePlayer.sha256
    && unityNative?.sources?.releaseSymbols?.sha256
      === sample.artifacts.unityReleaseSymbols.sha256
    && unityNative?.scope?.releasePlayerAndSymbols
      === "exact-official-hash-bound"
    && unityNative?.scope?.lifecycle
      === "exact-candidate-native-contract"
    && unityNative?.scope?.oldUnity2022EvidenceInherited === false
    && unityNative?.summary?.exactLifecycleFunctionCount
      === unityNative?.summary?.lifecycleFunctionCount
    && unityNative?.summary?.lifecycleFunctionCount === 8
    && unityNative?.summary?.mappedFunctionCount
      === unityNative?.summary?.targetFunctionCount
    && unityNative?.summary?.unmappedFunctionCount === 0
    && unityNative?.summary?.partialExactStaticFunctionCount === 3
    && unityNative?.summary?.exactStaticLocationFunctionCount === 3
    && unityNative?.summary?.unresolvedStrippedGlobalCount === 2
    && unityNative?.summary?.sortSemanticExactCount === 5
    && unityNative?.scope?.sortFieldSemantics === "partial-exact-static"
    && unityNative?.mapping?.records?.filter(
      (record) => record.semanticStaticProof?.status
        === "exact-static-semantic-shape",
    ).length === 5
    && unityNative?.runtimeBoundaries?.every(
      (boundary) => boundary.status === "runtime-required",
    )
  );
  const metadataDerivationBound = Boolean(
    metadataDerivation?.schema
      === "pocket-card-render/candidate-metadata-derivation-proof@1"
    && metadataDerivation?.candidate?.sampleId === sample.sampleId
    && metadataDerivation?.candidate?.sampleManifestSha256
      === sampleManifestSha256
    && metadataDerivation?.scope?.status
      === "exact-candidate-static-transformation"
    && metadataDerivation?.scope?.officialShaderRestorationPercent === null
    && metadataDerivation?.sources?.libil2cpp?.sha256
      === sample.artifacts.libil2cpp.sha256
    && metadataDerivation?.sources?.globalMetadataEncrypted?.sha256
      === sample.artifacts.globalMetadataEncrypted.sha256
    && metadataDerivation?.sources?.globalMetadataPlaintextExpected?.sha256
      === sample.artifacts.globalMetadataPlaintext.sha256
    && metadataDerivation?.nativeContract?.status
      === "exact-candidate-native-transformation-contract"
    && Object.keys(metadataDerivation?.nativeContract?.functions || {}).length
      === 7
    && metadataDerivation?.nativeContract?.selectedInstructionChecks?.length
      === 46
    && metadataDerivation?.nativeContract?.aesEvidence
      ?.standardKnownAnswerTest?.passed === true
    && metadataDerivation?.transformation?.status
      === "exact-byte-derivation"
    && metadataDerivation?.transformation?.decrypt?.derivedPlaintext?.sha256
      === sample.artifacts.globalMetadataPlaintext.sha256
    && metadataDerivation?.transformation?.reencrypt
      ?.byteEqualToReconstructedCiphertext === true
    && metadataDerivation?.metadata?.status
      === "strict-il2cpp-metadata-v31"
    && metadataDerivation?.metadata?.version === 31
    && metadataDerivation?.metadata?.tableCount === 31
    && Object.values(metadataDerivation?.metadata?.strictChecks || {})
      .every((value) => value === true)
  );
  const localizedTextBound = Boolean(
    localizedText?.schema
      === "pocket-card-render/candidate-localized-text-corpus@2"
    && localizedText?.candidate?.sampleId === sample.sampleId
    && localizedText?.candidate?.sampleManifestSha256
      === sampleManifestSha256
    && localizedText?.scope?.localeSerializedSource
      === "exact-file-hash-bound"
    && localizedText?.scope?.semanticResolution === "known-local-port"
    && localizedText?.scope?.localCompose === "known-local-port"
    && localizedText?.scope?.unity6RuntimeLayout === "runtime-required"
    && localizedText?.scope?.runtimeCaptureUsed === false
    && localizedText?.summary?.sceneCount
      === canonicalScenes?.summary?.sceneCount
    && localizedText?.summary?.entryCount
      === localizedText?.summary?.sceneCount
        * localizedText?.summary?.localeCount
    && localizedText?.summary?.semanticDataCount
      === localizedText?.summary?.entryCount
    && localizedText?.summary?.localStaticComposeCount
        + localizedText?.summary?.dynamicGlyphRequiredEntryCount
      === localizedText?.summary?.entryCount
    && localizedText?.summary?.unity6RuntimeLayoutExactCount === 0
    && localizedText?.summary?.unity6RuntimeLayoutRequiredCount
      === localizedText?.summary?.entryCount
    && localizedText?.summary?.nativeFontEngineFunctionCount === 9
    && localizedText?.summary?.exactNativeFontEngineFunctionCount === 9
    && localizedText?.inputs?.candidateTmpFontEngine?.sha256
      === sha256File(tmpFontEnginePath)
    && localizedText?.runtimeBoundaries?.find(
      (boundary) => boundary.id === "unity6-dynamic-fontengine",
    )?.nativeProducerStatus === "exact-candidate-native-function-bodies"
    && localizedText?.runtimeBoundaries?.length > 0
    && localizedText.runtimeBoundaries.every(
      (boundary) => boundary.status === "runtime-required",
    )
  );
  const localDisplayRequirementIds = new Set([
    "local-runtime-inventory",
    "css-dpr-drawing-buffer",
    "display-rt-density",
    "source-rt-contract",
    "dynamic-ui-density",
    "official-default-quality-active",
  ]);
  const localDisplayRequirements = Array.isArray(localDisplayAudit?.requirements)
    ? localDisplayAudit.requirements.filter(
        ({ id }) => localDisplayRequirementIds.has(id),
      )
    : [];
  const localDisplayBound = Boolean(
    localDisplayAuditCommand.ok
    && localDisplayAudit?.officialSample?.sampleId === sample.sampleId
    && localDisplayAudit?.officialSample?.sampleManifestSha256
      === sampleManifestSha256
    && localDisplayAudit?.localRuntimeEligibility?.status === "pass"
    && localDisplayRequirements.length === localDisplayRequirementIds.size
    && localDisplayRequirements.every(
      (requirement) => requirement.status === "exact"
        && requirement.exactUnits === requirement.totalUnits,
    )
    && localDisplayAudit?.fidelityPercent === null
  );
  const officialGuestRuntimeBatchBound = Boolean(
    officialGuestRuntimeBatchAudit.ok
    && officialGuestRuntimeBatch?.schema
      === "pocket-card-render/candidate-official-guest-runtime-batch@1"
    && officialGuestRuntimeBatch?.candidate?.sampleId === sample.sampleId
    && officialGuestRuntimeBatch?.candidate?.sampleManifestSha256
      === sampleManifestSha256
    && officialGuestRuntimeBatch?.candidate?.canonicalCorpusSha256
      === sample.canonicalCorpus.sha256
    && officialGuestRuntimeBatch?.summary?.requiredCardCount === 9
    && officialGuestRuntimeBatch?.summary?.completeCardCount
      + officialGuestRuntimeBatch?.summary?.runtimeRequiredCardCount
      === officialGuestRuntimeBatch?.summary?.requiredCardCount
    && officialGuestRuntimeBatch?.summary?.fidelityContribution === 0
    && officialGuestRuntimeBatch?.scope?.officialShaderRestorationPercent
      === null
  );
  const officialGuestRuntimeBatchComplete = Boolean(
    officialGuestRuntimeBatchBound
    && officialGuestRuntimeBatch.summary.completeCardCount
      === officialGuestRuntimeBatch.summary.requiredCardCount
  );
  const guestPlatformBlockerBound = Boolean(
    guestPlatformBlockerAudit.ok
    && guestPlatformBlocker?.schema
      === "pocket-card-render/candidate-guest-platform-blocker@1"
    && guestPlatformBlocker?.candidate?.sampleId === sample.sampleId
    && guestPlatformBlocker?.candidate?.sampleManifestSha256
      === sampleManifestSha256
    && guestPlatformBlocker?.status === "tested-platform-blocked"
    && guestPlatformBlocker?.installedPackage
      ?.nativeIdentityMatchesCandidate === true
    && guestPlatformBlocker?.scope?.testedPlatformOnly === true
    && guestPlatformBlocker?.scope?.closesOfficialGuestRuntime === false
    && guestPlatformBlocker?.scope?.fidelityContribution === 0
    && guestPlatformBlocker?.scope?.officialShaderRestorationPercent
      === null
  );
  const unresolved = unresolvedRoots(sample);
  const releaseBlockers = unresolved.filter((root) => (
    root === "unity.releaseSupportVersion"
    || root === "artifacts.unityReleasePlayer"
    || root === "artifacts.unityReleaseSymbols"
  ));
  const corpusBlocked = unresolved.includes("canonicalCorpus");

  const domains = [
    domain("package-native", [
      check(
        "split-and-nested-byte-identities",
        packageCheck.ok,
        "base/arm64/bundledtree splits and nested native/Unity entries",
        { command: packageCheck.command, exitCode: packageCheck.exitCode },
      ),
      check(
        "candidate-player-build-identity",
        typeof sample.unity.playerBuildVersion === "string"
          && sample.unity.playerBuildVersion.startsWith(
            `${sample.unity.serializedVersion}_`,
          ),
        "playerBuildVersion extracted from the game libunity.so",
        sample.unity.playerBuildVersion,
      ),
      check(
        "native-shader-variant-selection",
        nativeVariant.ok,
        "candidate ARM64 libunity variant best-match producer",
        { command: nativeVariant.command, exitCode: nativeVariant.exitCode },
      ),
      check(
        "candidate-unity-native-symbol-map",
        unityNativeBound && unityNativeAudit.ok,
        "matching Unity 6 release player/symbols and candidate game function relocation",
        {
          command: unityNativeAudit.command,
          exitCode: unityNativeAudit.exitCode,
          releasePlayer:
            unityNative?.sources?.releasePlayer?.sha256,
          releaseSymbols:
            unityNative?.sources?.releaseSymbols?.sha256,
          mapped:
            `${unityNative?.summary?.mappedFunctionCount}/`
            + `${unityNative?.summary?.targetFunctionCount}`,
        },
      ),
      check(
        "candidate-metadata-derivation",
        metadataDerivationBound && metadataDerivationAudit.ok,
        "candidate native-byte metadata decrypt/re-encrypt and strict v31 structure proof",
        {
          command: metadataDerivationAudit.command,
          exitCode: metadataDerivationAudit.exitCode,
          nativeFunctions:
            Object.keys(metadataDerivation?.nativeContract?.functions || {}).length,
          instructionChecks:
            metadataDerivation?.nativeContract?.selectedInstructionChecks?.length,
          metadataTables: metadataDerivation?.metadata?.tableCount,
          plaintext:
            metadataDerivation?.transformation?.decrypt?.derivedPlaintext?.sha256,
        },
      ),
    ], []),
    domain("unity-runtime", [
      check(
        "game-player-build",
        typeof sample.unity.playerBuildVersion === "string",
        "game player build identity",
      ),
      check(
        "candidate-tmp-static-and-native",
        tmpSerializedBound
          && tmpSerializedAudit.ok
          && tmpSpriteBound
          && tmpSpriteAudit.ok
          && tmpFontEngineBound
          && tmpFontEngineAudit.ok,
        "Unity 6 TMP settings/font atlases, TextExSprite preprocessing and native SDFAA producer",
        {
          settingsCommand: tmpSerializedAudit.command,
          settingsExitCode: tmpSerializedAudit.exitCode,
          spriteCommand: tmpSpriteAudit.command,
          spriteExitCode: tmpSpriteAudit.exitCode,
          fontEngineCommand: tmpFontEngineAudit.command,
          fontEngineExitCode: tmpFontEngineAudit.exitCode,
          settingsFields:
            tmpSerialized?.summary?.decodedTmpSettingsPayloadFieldCount,
          fontAssets: tmpSerialized?.summary?.fontAssetCount,
          spriteGlyphs: tmpSprite?.summary?.glyphCount,
          exactFontEngineFunctions:
            `${tmpFontEngine?.summary?.exactNativeFunctionCount}/`
            + `${tmpFontEngine?.summary?.nativeFunctionCount}`,
          layoutStatus: tmpSprite?.scope?.unity6TextGeneratorLayout,
        },
      ),
      check(
        "candidate-rendertexture-request-boundary",
        renderTextureBound && renderTextureAudit.ok,
        "candidate IL2CPP requests plus Unity 6 format/default descriptor contract, with device-compatible physical allocation boundary",
        {
          command: renderTextureAudit.command,
          exitCode: renderTextureAudit.exitCode,
          exactNativeMethods:
            renderTexture?.summary?.exactCandidateNativeRequestMethodCount,
          exactRequestVariants:
            renderTexture?.summary?.exactRequestVariantCount,
          exactUnityNativeFunctions:
            renderTexture?.summary?.exactCandidateUnityNativeFunctionCount,
          requestedGraphicsFormat:
            renderTexture?.candidateUnityNativeRenderTexture?.formatMapping
              ?.requestedGraphicsFormat?.name,
          exactGuestDescriptors:
            renderTexture?.summary?.exactGuestDescriptorVariantCount,
        },
      ),
      check(
        "candidate-android-lifecycle",
        unityNativeBound && unityNativeAudit.ok,
        "Unity 6 native pause/deferred-resume/player-loop contract",
        {
          command: unityNativeAudit.command,
          exitCode: unityNativeAudit.exitCode,
          exactFunctions:
            `${unityNative?.summary?.exactLifecycleFunctionCount}/`
            + `${unityNative?.summary?.lifecycleFunctionCount}`,
          baselineResumeChainReused:
            unityNative?.lifecycle?.baselineUnity2022ResumeChainReused,
          contract: unityNative?.lifecycle?.resume?.contract,
        },
      ),
      check(
        "candidate-effective-render-queue",
        effectiveRenderQueueAudit.ok && canonicalScenesAudit.ok,
        "Unity 6 Material -1 inherits the serialized Shader/SubShader Queue for every canonical draw",
        {
          command: effectiveRenderQueueAudit.command,
          exitCode: effectiveRenderQueueAudit.exitCode,
          canonicalSceneCommand: canonicalScenesAudit.command,
          canonicalSceneExitCode: canonicalScenesAudit.exitCode,
          exactMaterialStateDraws:
            `${canonicalScenes?.summary?.exactMaterialStateDrawCount}/`
            + `${canonicalScenes?.summary?.materialStateDrawCount}`,
        },
      ),
    ], [
      "capture Unity 6 TMP sprite layout, guest dynamic-atlas/mesh output, UGUI and physical RenderTexture descriptors",
      "capture Unity 6 sortInputBuilder/comparator live inputs, job output, render defaults and guest input state",
    ], releaseBlockers),
    domain("serialized-assets", [
      check(
        "full-output-snapshot",
        snapshotBound,
        "full asset/masterdata snapshot binds candidate probe and program inventory",
        snapshot?.evidence,
      ),
      check(
        "face-inventory",
        sample.snapshots.faceBundles.missingIllustrations === 0
          && sample.snapshots.faceBundles.count
            === sample.snapshots.masterdata.illustrations,
        "candidate masterdata and canonical Face bundles close the same denominator",
        {
          illustrations: sample.snapshots.masterdata.illustrations,
          faceBundles: sample.snapshots.faceBundles.count,
        },
      ),
      check(
        "candidate-mesh-payload",
        meshPayloadBound && meshPayloadAudit.ok,
        "Unity 6 Mesh payload, local transforms, submeshes, and Material slots against canonical GLBs",
        {
          command: meshPayloadAudit.command,
          exitCode: meshPayloadAudit.exitCode,
          matchedMeshNodeCount: meshPayload?.summary?.matchedMeshNodeCount,
          materialSlotResolutionCount:
            meshPayload?.summary?.materialSlotResolutionCount,
          geometryReuse: meshPayload?.proof?.geometryReuse,
          guestVertexBinding:
            meshPayload?.proof?.runtimeGuestVertexBinding,
        },
      ),
      check(
        "candidate-vertex-bindings",
        vertexBindingsBound && vertexBindingsAudit.ok,
        "candidate selector semantics, Three adapter, and canonical Mesh channel join",
        {
          command: vertexBindingsAudit.command,
          exitCode: vertexBindingsAudit.exitCode,
          selectorSemantics:
            `${vertexBindings?.summary?.officialSemanticExactPorts}/`
            + `${vertexBindings?.summary?.selectorPortCount}`,
          meshChannels:
            `${vertexBindings?.summary?.presentChannelBindings}/`
            + `${vertexBindings?.summary?.requiredChannelBindings}`,
          guestBinding:
            `${vertexBindings?.summary?.officialGuestVertexBindingExactRows}/`
            + `${vertexBindings?.summary?.exactPortDrawPassRows}`,
        },
      ),
      check(
        "candidate-serialized-ui",
        serializedUiBound && serializedUiAudit.ok,
        "Unity 6 RectTransform/TMP/Image, Sprite/Texture, font, and TMP SDF serialized corpus",
        {
          command: serializedUiAudit.command,
          exitCode: serializedUiAudit.exitCode,
          cardSettings: serializedUi?.summary?.cardSettingsCount,
          rectTransforms: serializedUi?.summary?.uiRectTransformCount,
          tmpComponents: serializedUi?.summary?.uiTmpComponentCount,
          uguiImages: serializedUi?.summary?.uguiImageCount,
          fontAssets: serializedUi?.summary?.fontAssetCount,
          nativeProducerStatic:
            `${serializedUi?.summary?.exactNativeProducerMethodCount}/`
            + `${serializedUi?.summary?.nativeProducerMethodCount} exact`,
          nativeProducerRuntime:
            serializedUi?.summary?.nativeProducerRuntimeStatus,
        },
      ),
      check(
        "candidate-canonical-scenes",
        canonicalScenesBound && canonicalScenesAudit.ok,
        "candidate draw/Material identity/Texture bindings for the baseline plus changed-route witness union",
        {
          command: canonicalScenesAudit.command,
          exitCode: canonicalScenesAudit.exitCode,
          scenes: canonicalScenes?.summary?.sceneCount,
          draws: canonicalScenes?.summary?.officialDrawCount,
          textureBindings:
            canonicalScenes?.summary?.textureBindingCount,
          unresolvedTextures:
            canonicalScenes?.summary?.unresolvedTextureCount,
          baselineRegressionScenes:
            canonicalScenes?.summary?.baselineRegressionSceneCount,
          changedRouteWitnessScenes:
            canonicalScenes?.summary?.changedRouteWitnessSceneCount,
          selectorObligations:
            `${canonicalScenes?.summary?.coveredSelectorObligationCount}/`
            + `${canonicalScenes?.summary?.selectorObligationCount}`,
          fullMaterialSerializedState:
            canonicalScenes?.scope?.fullMaterialSerializedState,
          materialStateDraws:
            `${canonicalScenes?.summary?.exactMaterialStateDrawCount}/`
            + `${canonicalScenes?.summary?.materialStateDrawCount}`,
          uniqueMaterialStates:
            canonicalScenes?.summary?.uniqueMaterialStateCount,
        },
      ),
      check(
        "candidate-localized-text",
        localizedTextBound && localizedTextAudit.ok,
        "candidate locale/masterdata semantic corpus and fail-closed Unity 6 TMP layout obligations",
        {
          command: localizedTextAudit.command,
          exitCode: localizedTextAudit.exitCode,
          scenes: localizedText?.summary?.sceneCount,
          locales: localizedText?.summary?.localeCount,
          semanticData:
            `${localizedText?.summary?.semanticDataCount}/`
            + `${localizedText?.summary?.entryCount}`,
          localStaticCompose:
            localizedText?.summary?.localStaticComposeCount,
          dynamicGlyphRequired:
            localizedText?.summary?.dynamicGlyphRequiredEntryCount,
          unity6RuntimeLayoutExact:
            localizedText?.summary?.unity6RuntimeLayoutExactCount,
        },
      ),
    ], [
      "capture candidate guest TMP/UGUI/RT dispatch, generated payloads, and physical descriptors",
    ], corpusBlocked ? ["canonicalCorpus"] : []),
    domain("shader-programs", [
      check(
        "material-program-inventory",
        inventoryBound,
        "candidate full Material/program proof graph",
        sample.proofSets.materialPrograms.inventorySha256,
      ),
      check(
        "program-migration-diff",
        migrationDiff.ok && existsFile(migrationPath),
        "baseline-to-candidate route diff is reproducible",
        { command: migrationDiff.command, exitCode: migrationDiff.exitCode },
      ),
      check(
        "program-migration-analysis",
        analysisBound,
        "9 changed, 69 reusable, and 1 default-only rejected route",
        analysis?.summary,
      ),
      check(
        "changed-route-ports-and-subcorpus",
        changedPorts.ok && changedSubcorpusBound,
        "10 changed/default-sensitive selector ports and data-derived witnesses",
        { command: changedPorts.command, exitCode: changedPorts.exitCode },
      ),
      check(
        "static-reuse-candidate-manifests",
        staticReuseCount === 68 && staticReuseAudit.ok,
        "candidate-bound formal manifests for all statically reusable routes",
        {
          expectedFormal: 68,
          engineOwnedRuntimeBoundary: 1,
          actualFormal: staticReuseCount,
          verification: deep ? "deep-reextraction" : "index-and-manifest-hashes",
          command: staticReuseAudit.command,
          exitCode: staticReuseAudit.exitCode,
        },
      ),
      check(
        "candidate-program-port-contract",
        candidateContractAudit.ok,
        "complete 78-port candidate selector contract plus one runtime boundary",
        {
          command: candidateContractAudit.command,
          exitCode: candidateContractAudit.exitCode,
        },
      ),
      check(
        "candidate-program-port-coverage",
        candidateProgramPortCoverage.ok,
        "all 78 formal candidate ports are re-extracted and independently verified",
        {
          command: candidateProgramPortCoverage.command,
          exitCode: candidateProgramPortCoverage.exitCode,
          output: candidateProgramPortCoverage.output,
        },
      ),
    ], [
      ...(staticReuseCount === 68 && staticReuseAudit.ok
        ? []
        : ["materialize 68 candidate-bound static-reuse formal port manifests"]),
      ...(candidateContractAudit.ok
        ? []
        : ["build and verify a complete 78-port candidate selector contract plus one engine-owned runtime boundary"]),
      ...(candidateProgramPortCoverage.ok
        ? []
        : ["re-extract and verify all 78 formal candidate selector ports against the candidate runtime batch"]),
      "collect candidate guest dispatch/binding/backend runtime evidence",
    ]),
    domain("runtime-evidence", [
      check(
        "candidate-local-full-runtime",
        localFullRuntimeAudit.ok,
        "source-current candidate canonical local WebGL draw/runtime batch",
        {
          command: localFullRuntimeAudit.command,
          exitCode: localFullRuntimeAudit.exitCode,
          output: localFullRuntimeAudit.output,
        },
      ),
      check(
        "candidate-local-tmp-runtime",
        localTmpRuntimeAudit.ok,
        "candidate canonical DynamicUI/TMP local runtime batch",
        {
          command: localTmpRuntimeAudit.command,
          exitCode: localTmpRuntimeAudit.exitCode,
          output: localTmpRuntimeAudit.output,
        },
      ),
      check(
        "candidate-local-display-runtime",
        localDisplayBound,
        "candidate local CSS/DPR, display/source RT, DynamicUI density and official Middle profile",
        {
          command: localDisplayAuditCommand.command,
          exitCode: localDisplayAuditCommand.exitCode,
          localRuntimeEligibility:
            localDisplayAudit?.localRuntimeEligibility?.status,
          exactLocalRequirements:
            `${localDisplayRequirements.filter(
              ({ status }) => status === "exact",
            ).length}/${localDisplayRequirementIds.size}`,
          exactEvidenceUnits: localDisplayAudit
            ? `${localDisplayAudit.exactUnits}/${localDisplayAudit.totalUnits}`
            : null,
          fidelityPercent: localDisplayAudit?.fidelityPercent ?? null,
        },
      ),
      check(
        "candidate-official-guest-runtime-batch",
        officialGuestRuntimeBatchComplete,
        "candidate official guest Vulkan frame batch over all canonical cards",
        {
          command: officialGuestRuntimeBatchAudit.command,
          exitCode: officialGuestRuntimeBatchAudit.exitCode,
          reportBound: officialGuestRuntimeBatchBound,
          complete:
            `${officialGuestRuntimeBatch?.summary?.completeCardCount ?? 0}/`
            + `${officialGuestRuntimeBatch?.summary?.requiredCardCount ?? 9}`,
          runtimeRequired:
            officialGuestRuntimeBatch?.summary?.runtimeRequiredCardCount ?? 9,
          fidelityContribution: 0,
        },
      ),
      check(
        "candidate-gfxreconstruct-conversion",
        gfxreconstructConversionAudit.ok,
        "hash-bound GFXReconstruct trace/JSONL/SPIR-V to strict audit-event conversion",
        {
          command: gfxreconstructConversionAudit.command,
          exitCode: gfxreconstructConversionAudit.exitCode,
          framebufferPixelsRead: false,
          bufferMemoryReconstructed: false,
          fidelityContribution: 0,
        },
      ),
      check(
        "candidate-tested-guest-platform-blocker",
        guestPlatformBlockerBound,
        "hash-bound evidence that the tested BlueStacks ARM native-bridge path cannot produce candidate guest evidence",
        {
          command: guestPlatformBlockerAudit.command,
          exitCode: guestPlatformBlockerAudit.exitCode,
          blocker: guestPlatformBlocker?.blocker?.id,
          platform: guestPlatformBlocker?.platform?.kind,
          nativeBridge: guestPlatformBlocker?.platform?.nativeBridge,
          crashModule:
            guestPlatformBlocker?.crash?.nativeBridgeModule,
          closesOfficialGuestRuntime: false,
          fidelityContribution: 0,
        },
      ),
    ], [
      ...(!localFullRuntimeAudit.ok
        ? ["collect a source-current candidate canonical local runtime batch"]
        : []),
      ...(!localTmpRuntimeAudit.ok
        ? ["recapture candidate DynamicUI/TMP local runtime evidence"]
        : []),
      ...(!localDisplayBound
        ? ["recapture candidate local display/source RT and density evidence"]
        : []),
      ...(!officialGuestRuntimeBatchComplete
        ? [
            "capture all nine candidate official guest Vulkan frames with descriptors, uniforms, attachments, vertex bindings, and the missing-UV1 default",
          ]
        : []),
      "capture native-device compositor, color-management, and panel-transfer evidence",
    ], [
      ...(corpusBlocked ? ["canonicalCorpus"] : []),
      ...(guestPlatformBlockerBound && !officialGuestRuntimeBatchComplete
        ? [
            "tested BlueStacks Pie64 is blocked by the libhoudini ARM native bridge; use a real ARM64 or authorized userdebug/eng capture environment",
          ]
        : []),
    ]),
    domain("documentation", [
      check(
        "upgrade-guides",
        ["UPGRADING.md", "UPGRADING.zh-CN.md"].every((relative) => (
          fs.readFileSync(path.join(ROOT, relative), "utf8")
            .includes("audit:candidate-changed-ports")
        )),
        "upgrade guides document candidate pointers, strict gate, and changed-port scope",
      ),
    ], []),
  ];
  const ordered = DOMAIN_ORDER.map(
    (id) => domains.find((item) => item.id === id),
  );
  return {
    schema: "pocket-card-render/official-candidate-migration-readiness@1",
    schemaVersion: 1,
    candidate: {
      selection: path.relative(ROOT, loaded.selectionPath).replaceAll("\\", "/"),
      manifest: loaded.manifestRelative,
      sampleId: sample.sampleId,
      sampleManifestSha256,
      gameVersion: sample.game.versionName,
      unityVersion: sample.unity.serializedVersion,
    },
    scope: {
      officialShaderRestorationPercent: null,
      gameFidelity: false,
      runtimeFidelity: false,
      definition: "version-migration obligation readiness, not visual fidelity",
    },
    summary: {
      pass: ordered.filter(({ status }) => status === "pass").length,
      partial: ordered.filter(({ status }) => status === "partial").length,
      blocked: ordered.filter(({ status }) => status === "blocked").length,
      total: ordered.length,
      complete: ordered.every(({ status }) => status === "pass"),
    },
    unresolvedRoots: unresolved,
    externalBlockers: guestPlatformBlockerBound
      ? [{
          id: guestPlatformBlocker.blocker.id,
          status: guestPlatformBlocker.blocker.status,
          testedPlatformOnly: true,
          closesOfficialGuestRuntime: false,
          remediation: guestPlatformBlocker.blocker.remediation,
        }]
      : [],
    domains: ordered,
  };
}

const IS_CLI = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (IS_CLI) {
  const report = auditCandidateMigrationReadiness({
    deep: process.argv.includes("--deep"),
  });
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(
      `Candidate migration readiness: ${report.candidate.sampleId}`,
    );
    for (const item of report.domains) {
      const passedChecks = item.checks.filter(
        ({ status }) => status === "pass",
      ).length;
      console.log(
        `  ${item.id.padEnd(18)} ${item.status.padEnd(7)}`
        + ` checks ${passedChecks}/${item.checks.length}`
        + ` remaining ${item.remaining.length}`,
      );
    }
    console.log(
      `  domains: ${report.summary.pass} pass,`
      + ` ${report.summary.partial} partial,`
      + ` ${report.summary.blocked} blocked`,
    );
    console.log("  official shader restoration: unavailable");
  }
  if (process.argv.includes("--require-complete") && !report.summary.complete) {
    process.exitCode = 1;
  }
}
