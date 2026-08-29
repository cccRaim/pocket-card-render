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
import {
  buildOfficialUGUIResourceContract,
} from "./build-official-ugui-resources.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_CANDIDATE_POINTER = "build/official-samples/candidate.json";
const DEFAULT_UPSTREAM = path.resolve(ROOT, "..", "ptcg-apk-parser");
const DEFAULT_OUTPUT_ROOT = path.resolve(
  process.env.PCR_CANDIDATE_OUTPUT_ROOT
    || path.join(
      ROOT,
      "..",
      "ptcgp-tools-master",
      "masterdata_decoder",
      ".output-full",
  ),
);
const DETAIL_CARD_BUNDLE_RELATIVE = path.join(
  "Common",
  "UI",
  "Prefabs",
  "Common",
  "CommonUICardDetailCard.prefab_bundles",
);

function parseArgs(argv) {
  const args = {
    check: false,
    candidateManifest:
      process.env.PCR_OFFICIAL_CANDIDATE_MANIFEST
      || DEFAULT_CANDIDATE_POINTER,
    outputRoot: DEFAULT_OUTPUT_ROOT,
    decryptedRoot: null,
    masterdataRoot: null,
    artifactRoot: null,
    splitRoot:
      process.env.PCR_CANDIDATE_SPLITS
      || path.join(
        DEFAULT_UPSTREAM,
        "apks",
        "apkeep-downloads",
        "jp.pokemon.pokemontcgp",
        "jp.pokemon.pokemontcgp",
      ),
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
    fontEngineReport: null,
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
      "--output-root": "outputRoot",
      "--decrypted-root": "decryptedRoot",
      "--masterdata-root": "masterdataRoot",
      "--artifact-root": "artifactRoot",
      "--split-root": "splitRoot",
      "--locator-libil2cpp": "locatorLibil2cpp",
      "--script-json": "scriptJson",
      "--fontengine-report": "fontEngineReport",
      "--out": "out",
    }[token];
    if (!key) throw new Error(`unknown argument: ${token}`);
    const value = argv[++index];
    if (!value || value.startsWith("--")) {
      throw new Error(`${token} requires a value`);
    }
    args[key] = value;
  }
  args.outputRoot = path.resolve(args.outputRoot);
  args.decryptedRoot = path.resolve(
    args.decryptedRoot || path.join(args.outputRoot, "decrypted"),
  );
  args.masterdataRoot = path.resolve(
    args.masterdataRoot || path.join(args.decryptedRoot, "masterdata"),
  );
  args.splitRoot = path.resolve(args.splitRoot);
  args.locatorLibil2cpp = path.resolve(args.locatorLibil2cpp);
  args.scriptJson = path.resolve(args.scriptJson);
  if (args.fontEngineReport) {
    args.fontEngineReport = path.resolve(args.fontEngineReport);
  }
  return args;
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
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex");
}

function bytesDigest(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function fileDigest(filename) {
  return bytesDigest(fs.readFileSync(filename));
}

function repoPath(filename) {
  const relative = path.relative(ROOT, filename).replaceAll("\\", "/");
  assert(relative !== ".." && !relative.startsWith("../"), `${filename} is outside the repository`);
  return relative;
}

function runJson(script, args, environment = {}) {
  const stdout = execFileSync(
    process.env.PYTHON || "python",
    ["-B", script, ...args],
    {
      cwd: ROOT,
      encoding: "utf8",
      shell: process.platform === "win32",
      windowsHide: true,
      env: {
        ...process.env,
        ...environment,
        PYTHONDONTWRITEBYTECODE: "1",
        PYTHONIOENCODING: "utf-8",
        PYTHONUTF8: "1",
      },
      maxBuffer: 256 * 1024 * 1024,
    },
  );
  assert(!stdout.includes("\uFFFD"), `${script} output contains U+FFFD`);
  return JSON.parse(stdout.replace(/^\uFEFF/, ""));
}

function serialize(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function artifactFact(logicalPath, serialized) {
  const bytes = Buffer.from(serialized, "utf8");
  return {
    logicalPath,
    byteLength: bytes.length,
    sha256: bytesDigest(bytes),
  };
}

function sourceFileFact(logicalPath, filename) {
  const bytes = fs.readFileSync(filename);
  return {
    logicalPath,
    byteLength: bytes.length,
    sha256: bytesDigest(bytes),
  };
}

function validateLayout(layout, sample) {
  assert.equal(layout.schemaVersion, 3);
  assert.equal(layout.unityVersion, sample.unity.serializedVersion);
  assert.equal(layout.summary.prefabCount, 2);
  assert.equal(layout.prefabs.length, 2);
  for (const prefab of layout.prefabs) {
    assert(["pokemon", "trainer"].includes(prefab.kind));
    assert.match(prefab.bundleSha256, /^[0-9a-f]{64}$/);
    assert(prefab.rectTransformCount > 0);
    assert(prefab.tmpComponentCount > 0);
    assert(prefab.imageComponentCount > 0);
    assert(prefab.canvasRendererComponentCount > 0);
  }
}

function validateDesign(design, sample) {
  assert.equal(design.schema, "pocket-card-render/card-text-design-contract@1");
  assert.equal(design.schemaVersion, 1);
  assert.equal(design.sampleId, sample.sampleId);
  assert.equal(design.unityVersion, sample.unity.serializedVersion);
  assert.equal(
    design.summary.masterdataIllustrationCount,
    sample.snapshots.masterdata.illustrations,
  );
  assert.equal(
    design.summary.cardSettingsCount,
    sample.snapshots.faceBundles.count,
  );
  assert.equal(
    design.summary.missingIllustrationCount,
    sample.snapshots.faceBundles.missingIllustrations,
  );
  assert.equal(design.summary.unresolvedCardDesignCount, 0);
  assert.equal(design.summary.unresolvedFontConditionCount, 0);
  assert.equal(design.summary.unresolvedDynamicUICount, 0);
  assert.equal(design.nativeProducerStatus, "runtime-required");
  assert.equal(design.nativeProducers.status, "runtime-required");
  assert.equal(Object.keys(design.cards).length, design.summary.cardSettingsCount);
  assert.equal(Object.keys(design.designs).length, design.summary.designSettingsCount);
}

function validateCandidateNativeProducers(
  evidence,
  sample,
  sampleManifestSha256,
  design,
) {
  assert.equal(
    evidence.schema,
    "pocket-card-render/candidate-ugui-native-producers@1",
  );
  assert.equal(evidence.schemaVersion, 1);
  assert.equal(evidence.candidate.sampleId, sample.sampleId);
  assert.equal(
    evidence.candidate.sampleManifestSha256,
    sampleManifestSha256,
  );
  assert.equal(
    evidence.candidate.unityVersion,
    sample.unity.serializedVersion,
  );
  assert.equal(
    evidence.sources.libil2cpp.sha256,
    sample.artifacts.libil2cpp.sha256,
  );
  assert.equal(evidence.policy.locatorOnly, true);
  assert.equal(
    evidence.policy.semanticClaimsRecheckedAgainstCandidateLibil2cpp,
    true,
  );
  assert.equal(evidence.policy.runtimeStateInferred, false);
  assert.equal(evidence.summary.requiredMethodCount, 3);
  assert.equal(evidence.summary.exactCandidateMethodCount, 3);
  assert.equal(evidence.summary.controlFlowContractCount, 3);
  assert.equal(evidence.summary.exactControlFlowContractCount, 3);
  assert.equal(evidence.summary.runtimeBoundaryCount, 1);
  assert.deepEqual(
    Object.keys(evidence.methods).sort(compareText),
    [
      "dynamicUIControllerApply",
      "dynamicUILabelDispatch",
      "fontGroupSelection",
    ],
  );
  assert(
    Object.values(evidence.methods).every(
      (method) => /^[0-9a-f]{64}$/.test(method.sha256)
        && method.byteLength > 0,
    ),
  );
  assert(
    Object.values(evidence.contracts).every(
      (contract) =>
        contract.status === "exact-candidate-il2cpp-control-flow",
    ),
  );
  assert(
    evidence.runtimeBoundaries.every(
      (boundary) => boundary.status === "runtime-required",
    ),
  );
  const requiredMethods = Object.fromEntries(
    design.nativeProducers.requiredMethods.map(
      (method) => [method.key, method.name],
    ),
  );
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(evidence.methods).map(
        ([key, method]) => [key, method.name.replace("$$", ".")],
      ),
    ),
    requiredMethods,
  );
}

function validateUguiResources(contract, sample) {
  assert.equal(contract.schema, "pocket-card-render/card-ui-resource-contract@1");
  assert.equal(contract.schemaVersion, 1);
  assert.equal(contract.unityVersion, sample.unity.serializedVersion);
  assert.equal(contract.summary.prefabs, 2);
  assert.equal(Object.keys(contract.images).length, contract.summary.images);
  assert(contract.summary.nonnullImageSprites > 0);
  assert(contract.summary.uniqueSprites > 0);
  assert.equal(contract.summary.uniqueSprites, contract.summary.uniqueTextures);
  assert.equal(contract.summary.uniqueMaterials, 1);
  assert.equal(contract.summary.uniqueShaders, 1);
}

function validateFontContract(contract) {
  assert.equal(contract.schemaVersion, 2);
  assert.equal(Object.keys(contract.locales).length, 9);
  assert(Object.keys(contract.groups).length > 0);
  assert(Object.keys(contract.fonts).length > 0);
  assert(Object.keys(contract.materials).length > 0);
  assert(contract.inlineElements?.fontId);
  assert(contract.fonts[contract.inlineElements.fontId]);
}

function validateTmpSdf(evidence, sample) {
  assert.equal(evidence.schemaVersion, 1);
  assert.equal(evidence.unityVersion, sample.unity.serializedVersion);
  assert.equal(
    evidence.shader.name,
    "Lettuce/Common/Card/TextMeshPro/Distance Field (to RT)",
  );
  assert.equal(evidence.shader.platforms.length, 1);
  assert.equal(evidence.shader.platforms[0], 18);
  assert.equal(evidence.program.modules.length, 2);
  assert(evidence.bindings.textures.length > 0);
  assert.equal(evidence.evidence.status, "exact-static-program-and-bindings");
}

function validateLayoutFitters(contract, sample, layout) {
  assert.equal(contract.schemaVersion, 1);
  assert.equal(contract.contractId, "pocket-card-render/official-layout-fitters@1");
  assert.equal(contract.sample.sampleId, sample.sampleId);
  assert.equal(contract.sample.unityVersion, sample.unity.serializedVersion);
  assert.equal(contract.sources.cardUiLayoutContract.sha256, bytesDigest(
    Buffer.from(serialize(layout)),
  ));
  assert(contract.observed.componentCount > 0);
  assert.equal(contract.prefabs.length, 2);
  assert(contract.nativeProducerBoundaries.every(
    (boundary) => boundary.status === "native-runtime-required",
  ));
}

function buildReport(args) {
  const loaded = loadOfficialSample(args.candidateManifest);
  const sample = loaded.sample;
  assert.equal(sample.status, "candidate");
  const candidateStem = sample.sampleId.replace(/-candidate$/, "");
  assert.notEqual(candidateStem, sample.sampleId);
  const fontEngineReportPath = path.resolve(
    args.fontEngineReport
      || path.join(
        ROOT,
        "build",
        "official-samples",
        `${candidateStem}-tmp-fontengine.json`,
      ),
  );
  const fontEngineReport = JSON.parse(
    fs.readFileSync(fontEngineReportPath, "utf8"),
  );
  assert.equal(
    fontEngineReport.schema,
    "pocket-card-render/candidate-tmp-fontengine-report@1",
  );
  assert.equal(fontEngineReport.candidate?.sampleId, sample.sampleId);
  assert.equal(
    fontEngineReport.candidate?.sampleManifestSha256,
    officialSampleDigest(sample),
  );
  assert.equal(
    fontEngineReport.scope?.nativeProducer,
    "exact-candidate-native-control-flow",
  );
  assert.equal(fontEngineReport.summary?.nativeFunctionCount, 9);
  assert.equal(fontEngineReport.summary?.exactNativeFunctionCount, 9);
  assert.equal(
    fontEngineReport.sources?.gameLibunity?.sha256,
    sample.artifacts.libunity.sha256,
  );
  args.artifactRoot = path.resolve(
    args.artifactRoot
      || path.join(
        args.outputRoot,
        "canonical-corpus",
        candidateStem,
        "serialized-ui",
      ),
  );
  const outputAbsolute = path.resolve(
    ROOT,
    args.out
      || path.join(
        "build",
        "official-samples",
        `${candidateStem}-serialized-ui-corpus.json`,
      ),
  );
  const detailCardBundlePath = path.join(
    args.decryptedRoot,
    DETAIL_CARD_BUNDLE_RELATIVE,
  );
  assert(
    fs.statSync(detailCardBundlePath).isFile(),
    "CommonUICardDetailCard.prefab_bundles is not a file",
  );

  const layout = runJson(
    "build/extract_official_card_ui_layout.py",
    [
      "--decrypted-root",
      args.decryptedRoot,
      "--unity-version",
      sample.unity.serializedVersion,
    ],
    { PCR_UNITY_VERSION: sample.unity.serializedVersion },
  );
  const layoutArtifactPath = path.join(
    args.artifactRoot,
    "card-ui-layout-contract.json",
  );
  const layoutSerialized = serialize(layout);
  if (args.check) {
    assert(fs.existsSync(layoutArtifactPath), "serialized-ui/card-ui-layout-contract.json does not exist");
    assert.equal(
      fs.readFileSync(layoutArtifactPath, "utf8"),
      layoutSerialized,
      "serialized-ui/card-ui-layout-contract.json is stale",
    );
  } else {
    fs.mkdirSync(args.artifactRoot, { recursive: true });
    atomicWriteFileSync(layoutArtifactPath, layoutSerialized);
  }
  const design = runJson(
    "build/extract_official_card_text_design_contract.py",
    [
      "--manifest",
      loaded.selectionPath,
      "--decrypted-root",
      args.decryptedRoot,
      "--masterdata-root",
      args.masterdataRoot,
      "--static-only",
    ],
    {
      PCR_UNITY_VERSION: sample.unity.serializedVersion,
      PCR_DECRYPTED_ROOT: args.decryptedRoot,
      PCR_MASTERDATA_ROOT: args.masterdataRoot,
    },
  );
  const candidateNativeProducers = runJson(
    "build/extract_candidate_ugui_native.py",
    [
      "--candidate-manifest",
      loaded.selectionPath,
      "--split-root",
      args.splitRoot,
      "--locator-libil2cpp",
      args.locatorLibil2cpp,
      "--script-json",
      args.scriptJson,
    ],
  );
  const uguiExtracted = runJson(
    "build/extract_official_ugui_resources.py",
    [
      "--decrypted-root",
      args.decryptedRoot,
      "--unity-version",
      sample.unity.serializedVersion,
    ],
    { PCR_UNITY_VERSION: sample.unity.serializedVersion },
  );
  const uguiResources = buildOfficialUGUIResourceContract(uguiExtracted);
  const fontContract = runJson(
    "build/extract_official_card_font_contract.py",
    [
      "--decrypted-root",
      args.decryptedRoot,
      "--unity-version",
      sample.unity.serializedVersion,
      "--stdout",
    ],
    { PCR_UNITY_VERSION: sample.unity.serializedVersion },
  );
  const tmpSdf = runJson(
    "build/extract_official_tmp_sdf.py",
    [
      "--decrypted-root",
      args.decryptedRoot,
      "--unity-version",
      sample.unity.serializedVersion,
    ],
    { PCR_UNITY_VERSION: sample.unity.serializedVersion },
  );
  tmpSdf.source.decryptedRoot = "candidate-decrypted-root";
  tmpSdf.source.bundle = path
    .relative(args.decryptedRoot, tmpSdf.source.bundle)
    .replaceAll("\\", "/");
  const layoutFitters = runJson(
    "build/extract_official_layout_fitters.py",
    [
      "--decrypted-root",
      args.decryptedRoot,
      "--layout-contract",
      layoutArtifactPath,
      "--manifest",
      loaded.selectionPath,
      "--unity-version",
      sample.unity.serializedVersion,
    ],
    { PCR_UNITY_VERSION: sample.unity.serializedVersion },
  );
  validateLayout(layout, sample);
  validateDesign(design, sample);
  validateCandidateNativeProducers(
    candidateNativeProducers,
    sample,
    officialSampleDigest(sample),
    design,
  );
  validateUguiResources(uguiResources, sample);
  validateFontContract(fontContract);
  validateTmpSdf(tmpSdf, sample);
  validateLayoutFitters(layoutFitters, sample, layout);

  const artifacts = [
    {
      filename: "card-ui-layout-contract.json",
      value: layout,
    },
    {
      filename: "card-text-design-contract.json",
      value: design,
    },
    {
      filename: "candidate-ugui-native-producers.json",
      value: candidateNativeProducers,
    },
    {
      filename: "card-ui-resource-contract.json",
      value: uguiResources,
    },
    {
      filename: "card-font-contract.json",
      value: fontContract,
    },
    {
      filename: "tmp-sdf-program-evidence.json",
      value: tmpSdf,
    },
    {
      filename: "official-layout-fitters.json",
      value: layoutFitters,
    },
  ].map((artifact) => {
    const serialized = serialize(artifact.value);
    const logicalPath = `serialized-ui/${artifact.filename}`;
    return {
      ...artifact,
      serialized,
      absolute: path.join(args.artifactRoot, artifact.filename),
      fact: artifactFact(logicalPath, serialized),
    };
  });

  const report = {
    schema: "pocket-card-render/candidate-serialized-ui-corpus@3",
    schemaVersion: 3,
    candidate: {
      selection: loaded.selectionRelative,
      manifest: loaded.manifestRelative,
      sampleId: sample.sampleId,
      sampleManifestSha256: officialSampleDigest(sample),
      gameVersion: sample.game.versionName,
      unityVersion: sample.unity.serializedVersion,
    },
    scope: {
      status:
        "exact-serialized-and-candidate-native-producers-with-runtime-state-boundary",
      officialShaderRestorationPercent: null,
      gameFidelity: false,
      runtimeFidelity: false,
    },
    inputs: {
      renderTextureDetailCardViewBundle: sourceFileFact(
        `candidate-decrypted-root/${
          DETAIL_CARD_BUNDLE_RELATIVE.replaceAll("\\", "/")
        }`,
        detailCardBundlePath,
      ),
      masterdata: {
        illustrationCount: sample.snapshots.masterdata.illustrations,
        pokemonSha256: fileDigest(path.join(args.masterdataRoot, "PokemonCard.json")),
        trainerSha256: fileDigest(path.join(args.masterdataRoot, "TrainerCard.json")),
      },
      faceBundles: {
        count: sample.snapshots.faceBundles.count,
        inventorySha256: sample.snapshots.faceBundles.inventorySha256,
      },
      candidateTmpFontEngine: sourceFileFact(
        repoPath(fontEngineReportPath),
        fontEngineReportPath,
      ),
      extractors: {
        cardUiLayout: {
          logicalPath: "build/extract_official_card_ui_layout.py",
          sha256: fileDigest(path.join(ROOT, "build", "extract_official_card_ui_layout.py")),
        },
        cardTextDesign: {
          logicalPath: "build/extract_official_card_text_design_contract.py",
          sha256: fileDigest(path.join(ROOT, "build", "extract_official_card_text_design_contract.py")),
        },
        candidateUguiNative: {
          logicalPath: "build/extract_candidate_ugui_native.py",
          sha256: fileDigest(path.join(ROOT, "build", "extract_candidate_ugui_native.py")),
        },
        uguiResources: {
          logicalPath: "build/extract_official_ugui_resources.py",
          sha256: fileDigest(path.join(ROOT, "build", "extract_official_ugui_resources.py")),
        },
        cardFontContract: {
          logicalPath: "build/extract_official_card_font_contract.py",
          sha256: fileDigest(path.join(ROOT, "build", "extract_official_card_font_contract.py")),
        },
        tmpSdf: {
          logicalPath: "build/extract_official_tmp_sdf.py",
          sha256: fileDigest(path.join(ROOT, "build", "extract_official_tmp_sdf.py")),
        },
        layoutFitters: {
          logicalPath: "build/extract_official_layout_fitters.py",
          sha256: fileDigest(path.join(ROOT, "build", "extract_official_layout_fitters.py")),
        },
      },
    },
    artifacts: Object.fromEntries(
      artifacts.map(({ filename, fact }) => [filename, fact]),
    ),
    aggregateSha256: canonicalDigest(
      artifacts.map(({ fact }) => fact),
    ),
    nativeProducerProof: {
      status: "exact-candidate-il2cpp-control-flow",
      artifact:
        artifacts.find(
          ({ filename }) =>
            filename === "candidate-ugui-native-producers.json",
        ).fact,
      methodCount:
        candidateNativeProducers.summary.requiredMethodCount,
      exactMethodCount:
        candidateNativeProducers.summary.exactCandidateMethodCount,
      controlFlowContractCount:
        candidateNativeProducers.summary.controlFlowContractCount,
      exactControlFlowContractCount:
        candidateNativeProducers.summary.exactControlFlowContractCount,
      runtimeStateStatus: "runtime-required",
    },
    summary: {
      cardSettingsCount: design.summary.cardSettingsCount,
      missingIllustrationCount: design.summary.missingIllustrationCount,
      designSettingsCount: design.summary.designSettingsCount,
      referencedDesignSettingsCount:
        design.summary.referencedDesignSettingsCount,
      fontConditionCount: design.summary.fontConditionCount,
      fontGroupCount: design.summary.fontGroupCount,
      selectedFontGroupCount: design.summary.selectedFontGroupCount,
      uiRectTransformCount: layout.summary.rectTransformCount,
      uiTmpComponentCount: layout.summary.tmpComponentCount,
      uiImageComponentCount: layout.summary.imageComponentCount,
      uiCanvasRendererComponentCount:
        layout.summary.canvasRendererComponentCount,
      uguiImageCount: uguiResources.summary.images,
      uguiSpriteCount: uguiResources.summary.uniqueSprites,
      uguiTextureCount: uguiResources.summary.uniqueTextures,
      fontLocaleCount: Object.keys(fontContract.locales).length,
      fontGroupCount: Object.keys(fontContract.groups).length,
      fontAssetCount: Object.keys(fontContract.fonts).length,
      fontMaterialCount: Object.keys(fontContract.materials).length,
      tmpSdfModuleCount: tmpSdf.program.modules.length,
      tmpSdfTextureBindingCount: tmpSdf.bindings.textures.length,
      layoutFitterComponentCount: layoutFitters.observed.componentCount,
      nativeProducerStaticStatus:
        "exact-candidate-il2cpp-control-flow",
      nativeProducerRuntimeStatus: "runtime-required",
      nativeProducerMethodCount:
        candidateNativeProducers.summary.requiredMethodCount,
      exactNativeProducerMethodCount:
        candidateNativeProducers.summary.exactCandidateMethodCount,
      nativeProducerControlFlowContractCount:
        candidateNativeProducers.summary.controlFlowContractCount,
      exactNativeProducerControlFlowContractCount:
        candidateNativeProducers.summary.exactControlFlowContractCount,
      nativeFontEngineFunctionCount:
        fontEngineReport.summary.nativeFunctionCount,
      exactNativeFontEngineFunctionCount:
        fontEngineReport.summary.exactNativeFunctionCount,
    },
    runtimeBoundaries: [
      {
        id: "card-design-native-runtime-state",
        status: "runtime-required",
        staticProducerEvidence:
          "serialized-ui/candidate-ugui-native-producers.json",
        requiredEvidence: [
          "live CardData energy and selected FontGroupSettings",
          "live CardDynamicUIView enumerable membership and order",
          "Unity GameObject names and SetActive outcomes",
        ],
        reason:
          candidateNativeProducers.runtimeBoundaries[0].reason,
      },
      {
        id: "unity6-tmp-fontengine",
        status: "runtime-required",
        nativeProducerStatus: "exact-candidate-native-control-flow",
        nativeProducerEvidence:
          repoPath(fontEngineReportPath),
        requiredEvidence: [
          "official guest dynamic glyph request order",
          "official guest dynamic atlas allocation and mutation",
          "official guest generated glyph metrics and mesh bindings",
          "official guest TMP descriptor and uniform bindings",
        ],
        reason:
          "candidate native SDFAA producer bodies are exact, but guest "
          + "request order, atlas placement, generated mesh and submitted "
          + "resources remain runtime-required",
      },
      {
        id: "candidate-tmp-sdf-dispatch",
        status: "runtime-required",
        requiredEvidence: [
          "official guest TMP draw dispatch",
          "descriptor/uniform bindings",
          "generated atlas and glyph mesh resources",
        ],
        reason: tmpSdf.evidence.runtimeBoundary,
      },
    ],
  };
  return { report, artifacts, outputAbsolute };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const { report, artifacts, outputAbsolute } = buildReport(args);
  const reportSerialized = serialize(report);
  if (args.check) {
    for (const artifact of artifacts) {
      assert(fs.existsSync(artifact.absolute), `${artifact.fact.logicalPath} does not exist`);
      assert.equal(
        fs.readFileSync(artifact.absolute, "utf8"),
        artifact.serialized,
        `${artifact.fact.logicalPath} is stale`,
      );
    }
    assert(fs.existsSync(outputAbsolute), `${repoPath(outputAbsolute)} does not exist`);
    assert.equal(
      fs.readFileSync(outputAbsolute, "utf8"),
      reportSerialized,
      `${repoPath(outputAbsolute)} is stale`,
    );
    console.log("Candidate serialized UI corpus check OK");
  } else {
    fs.mkdirSync(path.dirname(artifacts[0].absolute), { recursive: true });
    for (const artifact of artifacts) {
      atomicWriteFileSync(artifact.absolute, artifact.serialized);
    }
    atomicWriteFileSync(outputAbsolute, reportSerialized);
    console.log(`wrote ${repoPath(outputAbsolute)}`);
  }
  console.log(
    `  ${report.summary.cardSettingsCount} CardSettings, `
    + `${report.summary.designSettingsCount} designs, `
    + `${report.summary.uiRectTransformCount} UI RectTransforms`,
  );
  console.log(
    `  serialized exact; candidate native producers `
    + `${report.summary.exactNativeProducerMethodCount}/`
    + `${report.summary.nativeProducerMethodCount} exact, runtime state `
    + `${report.summary.nativeProducerRuntimeStatus}`,
  );
}

if (
  process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main();
}
