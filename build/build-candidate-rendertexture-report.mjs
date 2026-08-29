#!/usr/bin/env node
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  loadOfficialSample,
  officialSampleDigest,
} from "./official-sample.mjs";
import { atomicWriteFileSync } from "./atomic-publish.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EXPECTED_SAMPLE_ID =
  "ptcgp-1.7.0-unity-6000.0.69f1-candidate";
const EXPECTED_UNITY_VERSION = "6000.0.69f1";
const DEFAULT_CANDIDATE_POINTER = "build/official-samples/candidate.json";
const DEFAULT_UPSTREAM = path.resolve(ROOT, "..", "ptcg-apk-parser");
const DEFAULT_OUTPUT_FULL = path.resolve(
  ROOT,
  "..",
  "ptcgp-tools-master",
  "masterdata_decoder",
  ".output-full",
);

function parseArgs(argv) {
  const args = {
    check: false,
    candidateManifest:
      process.env.PCR_OFFICIAL_CANDIDATE_MANIFEST
      || DEFAULT_CANDIDATE_POINTER,
    splitRoot:
      process.env.PCR_CANDIDATE_SPLITS
      || path.join(
        DEFAULT_UPSTREAM,
        "apks",
        "apkeep-downloads",
        "jp.pokemon.pokemontcgp",
        "jp.pokemon.pokemontcgp",
      ),
    outputFull:
      process.env.PCR_CANDIDATE_OUTPUT_ROOT || DEFAULT_OUTPUT_FULL,
    decryptedRoot: null,
    snapshot: null,
    plaintextMetadata:
      process.env.PCR_CANDIDATE_PLAINTEXT_METADATA
      || path.join(DEFAULT_UPSTREAM, "apks", "output", "global-metadata.dat"),
    locatorLibil2cpp:
      process.env.PCR_CANDIDATE_LOCATOR_LIBIL2CPP
      || path.join(DEFAULT_UPSTREAM, "apks", "output", "libil2cpp.so"),
    scriptJson:
      process.env.PCR_CANDIDATE_SCRIPT_JSON
      || path.join(
        DEFAULT_UPSTREAM,
        "apks",
        "output",
        "Il2CppDumper",
        "script.json",
      ),
    dumpCs:
      process.env.PCR_CANDIDATE_DUMP_CS
      || path.join(
        DEFAULT_UPSTREAM,
        "apks",
        "output",
        "Il2CppDumper",
        "dump.cs",
      ),
    unityReleasePlayer:
      process.env.PCR_CANDIDATE_UNITY_RELEASE_PLAYER
      || path.resolve(
        ROOT,
        "..",
        ".cache",
        "unity-6000.0.69f1",
        "symbols",
        "libunity.release.arm64.so",
      ),
    unityReleaseSymbols:
      process.env.PCR_CANDIDATE_UNITY_RELEASE_SYMBOLS
      || path.resolve(
        ROOT,
        "..",
        ".cache",
        "unity-6000.0.69f1",
        "symbols",
        "libunity.release.arm64.sym.so",
      ),
    serializedUiReport: null,
    out: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--check") {
      args.check = true;
      continue;
    }
    const key = {
      "--candidate-manifest": "candidateManifest",
      "--split-root": "splitRoot",
      "--output-full": "outputFull",
      "--decrypted-root": "decryptedRoot",
      "--snapshot": "snapshot",
      "--plaintext-metadata": "plaintextMetadata",
      "--locator-libil2cpp": "locatorLibil2cpp",
      "--script-json": "scriptJson",
      "--dump-cs": "dumpCs",
      "--unity-release-player": "unityReleasePlayer",
      "--unity-release-symbols": "unityReleaseSymbols",
      "--serialized-ui-report": "serializedUiReport",
      "--out": "out",
    }[token];
    if (!key) throw new Error(`unknown argument: ${token}`);
    const value = argv[++index];
    if (!value || value.startsWith("--")) {
      throw new Error(`${token} requires a value`);
    }
    args[key] = value;
  }
  args.splitRoot = path.resolve(args.splitRoot);
  args.outputFull = path.resolve(args.outputFull);
  args.decryptedRoot = path.resolve(
    args.decryptedRoot || path.join(args.outputFull, "decrypted"),
  );
  args.snapshot = path.resolve(
    args.snapshot || path.join(args.outputFull, "snapshot.json"),
  );
  args.plaintextMetadata = path.resolve(args.plaintextMetadata);
  args.locatorLibil2cpp = path.resolve(args.locatorLibil2cpp);
  args.scriptJson = path.resolve(args.scriptJson);
  args.dumpCs = path.resolve(args.dumpCs);
  args.unityReleasePlayer = path.resolve(args.unityReleasePlayer);
  args.unityReleaseSymbols = path.resolve(args.unityReleaseSymbols);
  if (args.serializedUiReport) {
    args.serializedUiReport = path.resolve(args.serializedUiReport);
  }
  return args;
}

function digest(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function fileIdentity(filename) {
  const bytes = fs.readFileSync(filename);
  return { byteLength: bytes.length, sha256: digest(bytes) };
}

function repoPath(filename) {
  const relative = path.relative(ROOT, filename).replaceAll("\\", "/");
  assert(
    relative !== ".." && !relative.startsWith("../"),
    `${filename} is outside the repository`,
  );
  return relative;
}

function serialize(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort(compareText)
        .map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

function canonicalDigest(value) {
  return digest(Buffer.from(JSON.stringify(canonicalize(value)), "utf8"));
}

function runExtractor(args, loaded) {
  const extractor = path.join(
    ROOT,
    "build",
    "extract_candidate_rendertexture_boundary.py",
  );
  const stdout = execFileSync(
    process.env.PYTHON || "python",
    [
      "-B",
      extractor,
      "--candidate-manifest",
      loaded.selectionPath,
      "--split-root",
      args.splitRoot,
      "--decrypted-root",
      args.decryptedRoot,
      "--snapshot",
      args.snapshot,
      "--plaintext-metadata",
      args.plaintextMetadata,
      "--locator-libil2cpp",
      args.locatorLibil2cpp,
      "--script-json",
      args.scriptJson,
      "--dump-cs",
      args.dumpCs,
      "--unity-release-player",
      args.unityReleasePlayer,
      "--unity-release-symbols",
      args.unityReleaseSymbols,
    ],
    {
      cwd: ROOT,
      encoding: "utf8",
      shell: process.platform === "win32",
      windowsHide: true,
      env: {
        ...process.env,
        PYTHONDONTWRITEBYTECODE: "1",
        PYTHONIOENCODING: "utf-8",
        PYTHONUTF8: "1",
      },
      maxBuffer: 256 * 1024 * 1024,
    },
  );
  assert(!stdout.includes("\uFFFD"), "extractor output contains U+FFFD");
  return JSON.parse(stdout.replace(/^\uFEFF/, ""));
}

function validateExtraction(extraction, sample, sampleManifestSha256) {
  assert.equal(
    extraction.schema,
    "pocket-card-render/candidate-rendertexture-extraction@4",
  );
  assert.equal(extraction.schemaVersion, 4);
  assert.equal(extraction.candidate.sampleId, EXPECTED_SAMPLE_ID);
  assert.equal(extraction.candidate.sampleId, sample.sampleId);
  assert.equal(extraction.candidate.unityVersion, EXPECTED_UNITY_VERSION);
  assert.equal(
    extraction.candidate.sampleManifestSha256,
    sampleManifestSha256,
  );
  assert.deepEqual(
    extraction.sources.baseApk,
    {
      byteLength: sample.artifacts.baseApk.byteLength,
      sha256: sample.artifacts.baseApk.sha256,
    },
  );
  assert.deepEqual(
    extraction.sources.arm64Split,
    {
      byteLength: sample.artifacts.arm64Split.byteLength,
      sha256: sample.artifacts.arm64Split.sha256,
    },
  );
  assert.equal(
    extraction.sources.globalgamemanagers.sha256,
    sample.artifacts.globalGameManagers.sha256,
  );
  assert.equal(
    extraction.sources.libil2cpp.sha256,
    sample.artifacts.libil2cpp.sha256,
  );
  assert.equal(
    extraction.sources.libunity.sha256,
    sample.artifacts.libunity.sha256,
  );
  assert.deepEqual(
    extraction.sources.unityReleasePlayer,
    {
      byteLength: sample.artifacts.unityReleasePlayer.byteLength,
      sha256: sample.artifacts.unityReleasePlayer.sha256,
    },
  );
  assert.deepEqual(
    extraction.sources.unityReleaseSymbols,
    {
      byteLength: sample.artifacts.unityReleaseSymbols.byteLength,
      sha256: sample.artifacts.unityReleaseSymbols.sha256,
    },
  );
  assert.equal(
    extraction.sources.plaintextMetadata.sha256,
    sample.artifacts.globalMetadataPlaintext.sha256,
  );
  assert.equal(
    extraction.serialized.globalSettings.buildSettings.graphicsApis.values[0],
    21,
  );
  assert.equal(
    extraction.serialized.detailCardView.fields._cardSize.value,
    6,
  );
  assert.equal(
    extraction.serialized.detailCardView.fields._useMipMap.value,
    0,
  );
  const playerSettings =
    extraction.serialized.globalSettings.playerSettings;
  assert.equal(
    playerSettings.parser.status,
    "official-transfer-exact-with-unread-object-suffix",
  );
  assert.equal(playerSettings.parser.officialTransferFieldBytes, 848);
  assert.equal(playerSettings.parser.objectByteLength, 852);
  assert.equal(playerSettings.parser.unreadSuffix.rawHex, "00000000");
  assert.equal(
    playerSettings.officialTransferContract.status,
    "exact-official-transfer-schema-with-unread-object-suffix",
  );
  assert.deepEqual(
    playerSettings.officialTransferContract.gameLibunity
      .terminalTransferTails.map((item) => item.role),
    ["GenerateTypeTreeTransfer", "SafeBinaryRead"],
  );
  assert.equal(
    playerSettings.officialTransferContract.terminalField,
    "androidVulkanAllowFilterList",
  );
  assert(
    Object.values(playerSettings.fields)
      .every((field) => field.status === "exact-candidate-serialized-field"),
    "candidate PlayerSettings relevant fields are not exact",
  );
  assert.equal(
    extraction.nativeProducer.renderTextureRequest.depthBits,
    24,
  );
  assert.equal(
    extraction.nativeProducer.renderTextureRequest.renderTextureFormatValue,
    0,
  );
  assert.equal(
    extraction.nativeProducer.renderTextureRequest.antiAliasingSetterCalled,
    false,
  );
  assert.equal(
    extraction.nativeProducer.renderTextureRequest.effectiveAntiAliasing,
    1,
  );
  const nativeRenderTexture = extraction.unityNativeRenderTexture;
  assert.equal(
    nativeRenderTexture.status,
    "exact-candidate-native-request-mapping-and-default-descriptor",
  );
  assert.equal(
    nativeRenderTexture.releasePlayer.formatTable.sha256,
    nativeRenderTexture.candidateLibunity.formatTable.sha256,
  );
  assert.equal(
    nativeRenderTexture.formatMapping.tableEntryCount,
    29,
  );
  assert.deepEqual(
    nativeRenderTexture.formatMapping.requestedGraphicsFormat,
    {
      value: 8,
      name: "R8G8B8A8_UNorm",
      status: "exact-candidate-managed-and-native-control-flow",
    },
  );
  assert.deepEqual(
    {
      activeColorSpace:
        nativeRenderTexture.formatMapping.activeColorSpace.name,
      readWrite:
        nativeRenderTexture.formatMapping.managedReadWrite.name,
      resolvedTextureColorSpace:
        nativeRenderTexture.formatMapping.resolvedTextureColorSpace.name,
    },
    {
      activeColorSpace: "Gamma",
      readWrite: "Default",
      resolvedTextureColorSpace: "Linear",
    },
  );
  assert.deepEqual(
    {
      antiAliasing:
        nativeRenderTexture.descriptorDefaults.antiAliasing,
      volumeDepth:
        nativeRenderTexture.descriptorDefaults.volumeDepth,
      memoryless:
        nativeRenderTexture.descriptorDefaults.memoryless.value,
      dimension:
        nativeRenderTexture.descriptorDefaults.dimension.name,
      shadowSamplingMode:
        nativeRenderTexture.descriptorDefaults.shadowSamplingMode.name,
      vrUsage:
        nativeRenderTexture.descriptorDefaults.vrUsage.name,
      creationFlags:
        nativeRenderTexture.descriptorDefaults.creationFlags,
    },
    {
      antiAliasing: 1,
      volumeDepth: 1,
      memoryless: 0,
      dimension: "Tex2D",
      shadowSamplingMode: "None",
      vrUsage: "None",
      creationFlags: {
        value: 130,
        names: ["AllowVerticalFlip", "AutoGenerateMips"],
      },
    },
  );
  assert.equal(
    nativeRenderTexture.formatMapping.compatibleGraphicsFormat.status,
    "runtime-required-device-capability",
  );
  assert.equal(
    nativeRenderTexture.effectiveCardSourceBoundary
      .physicalYOrientation,
    "runtime-required-native-and-guest-allocation",
  );
  assert.equal(
    extraction.derivedCardSource.requestVariants.length,
    3,
  );
  assert.deepEqual(
    extraction.derivedCardSource.requestVariants.map(
      (variant) => [
        variant.quality,
        variant.request.width,
        variant.request.height,
      ],
    ),
    [
      ["High", 1403, 1403],
      ["Middle", 1122, 1122],
      ["Low", 982, 982],
    ],
  );
  assert(
    Object.values(
      extraction.nativeProducer.renderGraphBoundary.legacyMethodCounts,
    ).every((count) => count === 0),
    "legacy non-RenderGraph producer unexpectedly exists in candidate",
  );
  assert.equal(
    Object.keys(
      extraction.nativeProducer.renderGraphBoundary.candidateMethods,
    ).length,
    4,
  );
  assert.equal(
    extraction.nativeProducer.bloomTemporaryRt.status,
    "partial-exact-candidate-command-buffer-topology",
  );
  assert.equal(
    extraction.nativeProducer.bloomTemporaryRt.allocations
      .staticCallSiteCount,
    5,
  );
  assert.equal(
    extraction.nativeProducer.bloomTemporaryRt.releases
      .staticCallSiteCount,
    5,
  );
  assert.equal(
    extraction.nativeProducer.renderGraphSceneMrt.status,
    "partial-exact-candidate-rendergraph-scene-mrt-topology",
  );
  assert.equal(
    extraction.nativeProducer.renderGraphSceneMrt.methodCount,
    4,
  );
  assert.equal(
    extraction.nativeProducer.renderGraphSceneMrt
      .selectedInstructionChecks.metadataRelocations.length,
    6,
  );
  assert.equal(
    extraction.nativeProducer.renderGraphSceneMrt.descriptor
      .graphicsFormat,
    "R8G8B8A8_UNorm",
  );
  assert.equal(
    extraction.nativeProducer.renderGraphSceneMrt.descriptor.depthBits,
    "None",
  );
  assert.equal(
    extraction.nativeProducer.renderGraphSceneMrt.attachments.color
      .attachmentIndex,
    0,
  );
  assert.equal(
    extraction.nativeProducer.renderGraphSceneMrt.attachments.emissive
      .attachmentIndex,
    1,
  );
  assert.equal(
    extraction.nativeProducer.renderGraphSceneMrt.attachments.emissive
      .accessFlags,
    "Write",
  );
}

function loadSerializedUiBinding(
  args,
  sample,
  sampleManifestSha256,
  extraction,
) {
  const candidateStem = sample.sampleId.replace(/-candidate$/, "");
  assert.notEqual(candidateStem, sample.sampleId);
  const reportPath = path.resolve(
    args.serializedUiReport
      || path.join(
        ROOT,
        "build",
        "official-samples",
        `${candidateStem}-serialized-ui-corpus.json`,
      ),
  );
  const reportBytes = fs.readFileSync(reportPath);
  const report = JSON.parse(reportBytes.toString("utf8"));
  assert.equal(
    report.schema,
    "pocket-card-render/candidate-serialized-ui-corpus@3",
  );
  assert.equal(report.schemaVersion, 3);
  assert.equal(report.candidate?.sampleId, sample.sampleId);
  assert.equal(
    report.candidate?.sampleManifestSha256,
    sampleManifestSha256,
    "serialized-UI corpus is bound to another sample manifest",
  );
  assert.equal(
    report.scope?.status,
    "exact-serialized-and-candidate-native-producers-with-runtime-state-boundary",
  );
  assert.equal(
    report.nativeProducerProof?.status,
    "exact-candidate-il2cpp-control-flow",
  );
  assert.equal(
    report.summary?.exactNativeProducerMethodCount,
    report.summary?.nativeProducerMethodCount,
  );
  assert.equal(
    report.summary?.nativeProducerRuntimeStatus,
    "runtime-required",
  );
  assert.equal(
    report.inputs?.masterdata?.illustrationCount,
    sample.snapshots.masterdata.illustrations,
  );
  assert.equal(
    report.inputs?.faceBundles?.inventorySha256,
    sample.snapshots.faceBundles.inventorySha256,
  );
  const detailBundle = report.inputs?.renderTextureDetailCardViewBundle;
  assert.deepEqual(
    {
      byteLength: detailBundle?.byteLength,
      sha256: detailBundle?.sha256,
    },
    extraction.serialized.detailCardView.bundle,
    "serialized-UI corpus is bound to another detail-card bundle",
  );
  const artifactRoot = path.join(
    args.outputFull,
    "canonical-corpus",
    candidateStem,
    "serialized-ui",
  );
  const artifactFacts = Object.values(report.artifacts || {});
  assert(artifactFacts.length > 0, "serialized-UI corpus has no artifacts");
  for (const fact of artifactFacts) {
    assert.equal(
      path.dirname(fact.logicalPath),
      "serialized-ui",
      "serialized-UI artifact has an invalid logical path",
    );
    const actual = fileIdentity(
      path.join(artifactRoot, path.basename(fact.logicalPath)),
    );
    assert.deepEqual(
      actual,
      { byteLength: fact.byteLength, sha256: fact.sha256 },
      `${fact.logicalPath} differs from serialized-UI corpus`,
    );
  }
  assert.equal(
    report.aggregateSha256,
    canonicalDigest(artifactFacts),
    "serialized-UI corpus aggregate is invalid",
  );
  return {
    logicalPath: repoPath(reportPath),
    byteLength: reportBytes.length,
    sha256: digest(reportBytes),
    aggregateSha256: report.aggregateSha256,
    detailCardViewBundle: detailBundle,
  };
}

function buildReport(args) {
  const loaded = loadOfficialSample(args.candidateManifest);
  const { sample } = loaded;
  assert.equal(sample.status, "candidate");
  assert.equal(sample.sampleId, EXPECTED_SAMPLE_ID);
  assert.equal(sample.unity.serializedVersion, EXPECTED_UNITY_VERSION);
  const sampleManifestSha256 = officialSampleDigest(sample);
  const extraction = runExtractor(args, loaded);
  validateExtraction(extraction, sample, sampleManifestSha256);
  const serializedUiBinding = loadSerializedUiBinding(
    args,
    sample,
    sampleManifestSha256,
    extraction,
  );
  assert.equal(sample.artifacts.unityReleasePlayer?.status, "resolved");
  assert.equal(sample.artifacts.unityReleaseSymbols?.status, "resolved");

  const stem = sample.sampleId.replace(/-candidate$/, "");
  const outputAbsolute = path.resolve(
    args.out
      || path.join(
        ROOT,
        "build",
        "official-samples",
        `${stem}-candidate-rendertexture-boundary.json`,
      ),
  );
  const extractorPath = path.join(
    ROOT,
    "build",
    "extract_candidate_rendertexture_boundary.py",
  );
  const builderPath = fileURLToPath(import.meta.url);
  const requestVariants =
    extraction.derivedCardSource.requestVariants.map((variant) => ({
      quality: variant.quality,
      status: variant.status,
      descriptorRequest: variant.request,
      compatibleFormatAndPhysicalAllocationStatus: "runtime-required",
    }));
  const methods = extraction.nativeProducer.methods;
  const exactMethodCount = Object.keys(methods).length;
  const producerFamilies = [
    {
      id: "card-source-rendertexture",
      status: "partial-exact",
      serializedInputs:
        "exact bytes bound through the candidate serialized-UI corpus",
      candidateIl2cppRequestProducer: "exact",
      candidateUnityNativeRequestMappingAndDefaults: "exact",
      candidateUnityNativeAllocation: "runtime-required",
      candidateGuestAllocation: "runtime-required",
    },
    {
      id: "rendergraph-scene-mrt",
      status: "partial-exact",
      candidateIl2cppTopology:
        "PrepareBloomPass creates an R8G8B8A8_UNorm depthless emissive TextureHandle; CustomDrawObjectsPass binds active color at MRT slot 0 and emissive at slot 1 with AccessFlags.Write for opaque and transparent passes",
      candidateMetadataLayouts:
        "TextureDesc, CustomBloomData, EmissiveSourceData, CustomDrawObjectsPass.PassData and IRasterRenderGraphBuilder are hash-bound",
      liveDescriptorValues: "runtime-required",
      candidateUnityNativeAllocation: "runtime-required",
      candidateGuestAttachmentSubmission: "runtime-required",
    },
    {
      id: "bloom-commandbuffer-intermediates",
      status: "partial-exact",
      candidateIl2cppTopology:
        "five GetTemporaryRT call sites, five ReleaseTemporaryRT call sites, ARGB32 base descriptor and Bilinear filtering are exact",
      liveDescriptorValues: "runtime-required",
      candidateUnityNativeAllocation: "runtime-required",
      candidateGuestAllocation: "runtime-required",
    },
    {
      id: "dynamic-ugui-text-rendertexture",
      status: "runtime-required",
      reason:
        "candidate UGUI selection/activation control flow is exact, but it does not prove Unity 6 dynamic UGUI/TMP RenderTexture allocation or guest bindings",
    },
  ];
  const blockers = [
    {
      id: "rendergraph-scene-mrt-live-descriptor-and-allocation",
      domain: "runtime-state",
      status: "blocked",
      reason:
        "candidate IL2CPP proves the scene MRT topology and descriptor overrides, but inherited TextureDesc fields, live BloomVolume size, Unity allocation/aliasing and guest attachment submission still require runtime evidence",
    },
    {
      id: "unity-runtime-rendertexture-compatible-allocation",
      domain: "candidate-libunity",
      status: "blocked",
      reason:
        "candidate managed/native bytes now prove ARGB32+Gamma+Default maps to requested R8G8B8A8_UNorm and prove the Unity 6 default descriptor (MSAA 1, volumeDepth 1, memoryless None); SystemInfo device-compatible color format, legacy depth conversion, physical allocation and Y orientation still require runtime evidence",
    },
    {
      id: "runtime-card-quality-selection",
      domain: "runtime-state",
      status: "blocked",
      reason:
        "High/Middle/Low requests are exact, but the persisted quality selected on a guest device is runtime state",
    },
    {
      id: "guest-rendertexture-bindings",
      domain: "official-guest",
      status: "blocked",
      reason:
        "no candidate guest VkImage/view, descriptor, attachment, layout transition, viewport, or submission capture is bound",
    },
  ];

  const report = {
    schema: "pocket-card-render/candidate-rendertexture-boundary@5",
    schemaVersion: 5,
    candidate: {
      selection: loaded.selectionRelative,
      manifest: loaded.manifestRelative,
      sampleId: sample.sampleId,
      sampleManifestSha256,
      gameVersion: sample.game.versionName,
      unityVersion: sample.unity.serializedVersion,
      playerBuildVersion: sample.unity.playerBuildVersion,
    },
    scope: {
      status:
        "partial-exact-request-native-defaults-scene-mrt-and-player-settings-boundary",
      oldEvidenceInherited: false,
      officialShaderRestorationPercent: null,
      gameFidelity: false,
      runtimeFidelity: false,
      claim:
        "candidate card-source RenderTexture requests, Unity 6 format mapping/default descriptor, scene MRT IL2CPP topology and official PlayerSettings transfer boundary; not device-compatible physical Unity or guest GPU resources",
    },
    tools: {
      extractor: {
        logicalPath: repoPath(extractorPath),
        ...fileIdentity(extractorPath),
      },
      builder: {
        logicalPath: repoPath(builderPath),
        ...fileIdentity(builderPath),
      },
    },
    inputs: {
      ...extraction.sources,
      serializedUiCorpus: serializedUiBinding,
      unityReleasePlayer: sample.artifacts.unityReleasePlayer,
      unityReleaseSymbols: sample.artifacts.unityReleaseSymbols,
    },
    serializedBoundary: {
      status:
        "exact-candidate-serialized-ui-and-player-settings-transfer-bound",
      extractorStatus: extraction.serialized.descriptorInputStatus,
      manifestRootedGlobalSettings:
        extraction.serialized.globalSettings,
      candidateSerializedUiBoundDetailCardView:
        extraction.serialized.detailCardView,
      exactDescriptorInputs: {
        cardSize:
          extraction.serialized.detailCardView.fields._cardSize,
        useMipMap:
          extraction.serialized.detailCardView.fields._useMipMap,
      },
      playerSettingsContext:
        extraction.serialized.globalSettings.playerSettings,
    },
    candidateNativeRequestProducer: {
      status: "exact-candidate-il2cpp-request",
      locatorPolicy:
        "Il2CppDumper addresses locate methods only; every claim is rechecked against manifest-matched libil2cpp bytes",
      locator: extraction.nativeProducer.locator,
      methodCount: exactMethodCount,
      methods,
      selectedInstructionChecks:
        extraction.nativeProducer.selectedInstructionChecks,
      cardDimensions: extraction.nativeProducer.cardDimensions,
      uiCardViewSizeMap:
        extraction.nativeProducer.uiCardViewSizeMap,
      verticalPercentageInRT:
        extraction.nativeProducer.verticalPercentageInRT,
      cardQuality: extraction.nativeProducer.cardQuality,
      requestContract:
        extraction.nativeProducer.renderTextureRequest,
      candidateMetadataEnums: extraction.metadataEnums,
      renderGraphMigrationBoundary:
        extraction.nativeProducer.renderGraphBoundary,
      renderGraphSceneMrt:
        extraction.nativeProducer.renderGraphSceneMrt,
      bloomTemporaryRt:
        extraction.nativeProducer.bloomTemporaryRt,
    },
    candidateUnityNativeRenderTexture: {
      ...extraction.unityNativeRenderTexture,
      scopeBoundary:
        "release-player symbols identify the implementation; matching candidate libunity bytes prove the request mapping and default descriptor only, while SystemInfo compatibility and physical allocation remain runtime-required",
    },
    cardSourceRequests: {
      status: "exact-candidate-request-selected-variant-runtime-required",
      serializedUICardViewSizeType:
        extraction.derivedCardSource.serializedUICardViewSizeType,
      mappingSource: extraction.derivedCardSource.mappingSource,
      mappingIndex: extraction.derivedCardSource.mappingIndex,
      cardSizeType: extraction.derivedCardSource.cardSizeType,
      cardSizeName: extraction.derivedCardSource.cardSizeName,
      pixelSize: extraction.derivedCardSource.pixelSize,
      variants: requestVariants,
      selectedRuntimeVariant:
        extraction.derivedCardSource.selectedRuntimeVariant,
    },
    producerFamilies,
    blockers,
    summary: {
      serializedObjectCount: 5,
      strictSemanticSerializedObjectCount: 5,
      unityPyStrictSerializedObjectCount: 4,
      officialTransferExactSerializedObjectCount: 1,
      partialParserSerializedObjectCount: 0,
      exactPlayerSettingsFieldCount: Object.keys(
        extraction.serialized.globalSettings.playerSettings.fields,
      ).length,
      officialTransferUnreadSuffixByteCount:
        extraction.serialized.globalSettings.playerSettings
          .parser.unreadSuffix.byteLength,
      exactDescriptorInputFieldCount: 2,
      manifestRootedDescriptorInputFieldCount: 0,
      candidateSerializedUiBoundDescriptorInputFieldCount: 2,
      snapshotBoundDescriptorInputFieldCount: 0,
      candidateNativeRequestMethodCount: exactMethodCount,
      exactCandidateNativeRequestMethodCount: exactMethodCount,
      exactCandidateUnityNativeFunctionCount: 6,
      candidateUnityNativeFunctionCount: 6,
      exactCandidateUnityNativeFormatTableEntryCount:
        extraction.unityNativeRenderTexture.formatMapping.tableEntryCount,
      candidateUnityNativeFormatTableEntryCount:
        extraction.unityNativeRenderTexture.formatMapping.tableEntryCount,
      exactCandidateUnityNativeDescriptorDefaultFieldCount: 11,
      candidateUnityNativeDescriptorDefaultFieldCount: 11,
      exactRequestedGraphicsFormatMappingCount: 1,
      candidateSceneMrtMethodCount:
        extraction.nativeProducer.renderGraphSceneMrt.methodCount,
      exactCandidateSceneMrtMethodCount:
        extraction.nativeProducer.renderGraphSceneMrt.methodCount,
      candidateSceneMrtMetadataRelocationCount:
        extraction.nativeProducer.renderGraphSceneMrt
          .selectedInstructionChecks.metadataRelocations.length,
      exactCandidateSceneMrtMetadataRelocationCount:
        extraction.nativeProducer.renderGraphSceneMrt
          .selectedInstructionChecks.metadataRelocations.length,
      sceneMrtAttachmentCount: 2,
      exactSceneMrtAttachmentCount: 2,
      requestVariantCount: requestVariants.length,
      exactRequestVariantCount: requestVariants.length,
      producerFamilyCount: producerFamilies.length,
      exactOrPartialExactProducerFamilyCount:
        producerFamilies.filter(
          (family) => family.status === "exact"
            || family.status === "partial-exact",
        ).length,
      runtimeRequiredProducerFamilyCount:
        producerFamilies.filter(
          (family) => family.status === "runtime-required",
        ).length,
      guestDescriptorVariantCount: requestVariants.length,
      exactGuestDescriptorVariantCount: 0,
      blockerCount: blockers.length,
    },
  };
  return { outputAbsolute, report };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const { outputAbsolute, report } = buildReport(args);
  const serialized = serialize(report);
  if (args.check) {
    assert(fs.existsSync(outputAbsolute), `${repoPath(outputAbsolute)} is missing`);
    assert.equal(
      fs.readFileSync(outputAbsolute, "utf8"),
      serialized,
      `${repoPath(outputAbsolute)} is stale`,
    );
    console.log("Candidate RenderTexture boundary report check OK");
  } else {
    fs.mkdirSync(path.dirname(outputAbsolute), { recursive: true });
    atomicWriteFileSync(outputAbsolute, serialized);
    console.log(`wrote ${repoPath(outputAbsolute)}`);
  }
  console.log(
    `  request variants ${report.summary.exactRequestVariantCount}/`
    + `${report.summary.requestVariantCount} exact`,
  );
  console.log(
    `  native request methods ${report.summary.exactCandidateNativeRequestMethodCount}/`
    + `${report.summary.candidateNativeRequestMethodCount} exact`,
  );
  console.log(
    `  producer families ${report.summary.exactOrPartialExactProducerFamilyCount}/`
    + `${report.summary.producerFamilyCount} exact/partial; `
    + `${report.summary.blockerCount} blockers`,
  );
}

if (
  process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main();
}
