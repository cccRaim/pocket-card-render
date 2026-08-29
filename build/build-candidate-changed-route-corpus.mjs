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

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC = path.join(ROOT, "public");
const DEFAULT_CANDIDATE_POINTER =
  "build/official-samples/candidate.json";
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

function parseArgs(argv) {
  const result = {
    check: false,
    candidateManifest:
      process.env.PCR_OFFICIAL_CANDIDATE_MANIFEST
      || DEFAULT_CANDIDATE_POINTER,
    analysis: null,
    inventory:
      process.env.PCR_CANDIDATE_MATERIAL_INVENTORY
      || path.join(DEFAULT_OUTPUT_ROOT, "material-program-inventory-full.json"),
    out: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--check") {
      result.check = true;
      continue;
    }
    const key = {
      "--candidate-manifest": "candidateManifest",
      "--analysis": "analysis",
      "--inventory": "inventory",
      "--out": "out",
    }[token];
    if (!key) throw new Error(`unknown argument: ${token}`);
    const value = argv[++index];
    if (!value || value.startsWith("--")) {
      throw new Error(`${token} requires a value`);
    }
    result[key] = value;
  }
  return result;
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sortedUnique(values) {
  return [...new Set(values)].sort(compareText);
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

function fileDigest(filename) {
  return crypto
    .createHash("sha256")
    .update(fs.readFileSync(filename))
    .digest("hex");
}

function repoPath(filename) {
  const relative = path.relative(ROOT, filename).replaceAll("\\", "/");
  assert(
    relative !== ".." && !relative.startsWith("../"),
    `${filename} is outside the repository`,
  );
  return relative;
}

function readJson(filename) {
  return JSON.parse(fs.readFileSync(filename, "utf8"));
}

function routeKey(route) {
  return JSON.stringify([
    route.shaderName,
    [...(route.keywords || [])].sort(compareText),
    route.subshader,
    route.pass,
  ]);
}

function sameKeywords(left, right) {
  return JSON.stringify([...(left || [])].sort(compareText))
    === JSON.stringify([...(right || [])].sort(compareText));
}

function cardIdFromIllustration(illustrationId) {
  const match = /^c((?:PK|TR)_\d+_\d+_\d+)_/.exec(illustrationId);
  assert(match, `cannot derive card ID from ${illustrationId}`);
  return match[1];
}

function collectGameUrls(value, result = new Set()) {
  if (typeof value === "string") {
    if (value.startsWith("/game/")) result.add(value);
    return result;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectGameUrls(item, result);
    return result;
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value)) collectGameUrls(item, result);
  }
  return result;
}

function publicFileForGameUrl(url) {
  const pathname = url.split(/[?#]/, 1)[0];
  const relative = pathname.slice(1).replaceAll("/", path.sep);
  const absolute = path.resolve(PUBLIC, relative);
  const gameRoot = `${path.resolve(PUBLIC, "game")}${path.sep}`;
  assert(
    absolute.startsWith(gameRoot),
    `game URL escapes public/game: ${url}`,
  );
  return absolute;
}

function loadCandidateInventory(filename, sample) {
  const inventory = readJson(filename);
  assert.equal(
    inventory.schema,
    "pocket-card-render/official-material-program-inventory@4",
  );
  assert.equal(inventory.schemaVersion, 4);
  assert.equal(inventory.unityVersion, sample.unity.serializedVersion);
  assert.equal(
    fileDigest(filename),
    sample.proofSets.materialPrograms.inventorySha256,
    "candidate inventory file identity does not match the candidate manifest",
  );
  assert.equal(
    inventory.digests.proofGraphSha256,
    sample.proofSets.materialPrograms.proofGraphSha256,
  );
  assert.equal(
    inventory.digests.portIndexSha256,
    sample.proofSets.materialPrograms.portIndexSha256,
  );
  assert(Array.isArray(inventory.proofGraph?.materials));
  assert(Array.isArray(inventory.proofGraph?.usageRows));
  return inventory;
}

function deriveRouteObligations(analysis, inventory, sample) {
  assert.equal(
    analysis.schema,
    "pocket-card-render/official-program-migration-analysis@1",
  );
  assert.equal(analysis.schemaVersion, 1);
  assert.equal(analysis.candidateSampleId, sample.sampleId);
  assert.equal(analysis.summary.changedRoutes, 9);
  assert.equal(analysis.routes.length, 9);
  const rejected = analysis.staticReuseValidation
    .filter((row) => row.reuseEligible === false);
  assert.equal(
    rejected.length,
    1,
    "expected exactly one rejected static-reuse route",
  );

  const shaderByName = new Map(
    inventory.proofGraph.shaders.map((shader) => [shader.name, shader]),
  );
  const portByRoute = new Map(
    inventory.portIndex.map((port) => [routeKey(port), port]),
  );
  assert.equal(
    portByRoute.size,
    inventory.portIndex.length,
    "candidate inventory has duplicate route identities",
  );
  const usageByMaterial = new Map();
  for (const usage of inventory.proofGraph.usageRows) {
    const rows = usageByMaterial.get(usage.materialIdentity) || [];
    rows.push(usage);
    usageByMaterial.set(usage.materialIdentity, rows);
  }

  const sourceRows = [
    ...analysis.routes.map((row) => ({
      ...row,
      sourceKind: "changed",
      sourceClassification: row.classification,
    })),
    ...rejected.map((row) => ({
      ...row,
      sourceKind: "static-reuse-rejected",
      sourceClassification: "shader-default-only",
      changedFields: ["shaderPropertyDefaults"],
    })),
  ];
  assert.equal(sourceRows.length, 10);

  const obligations = sourceRows.map((source) => {
    const port = portByRoute.get(routeKey(source));
    assert(port, `candidate inventory is missing route ${routeKey(source)}`);
    if (source.candidateSelectorId !== undefined) {
      assert.equal(port.selectorId, source.candidateSelectorId);
    }
    if (source.candidateCandidateWitnessId !== undefined) {
      assert.equal(
        port.candidateWitnessId,
        source.candidateCandidateWitnessId,
      );
    }
    const shader = shaderByName.get(source.shaderName);
    assert(shader, `candidate inventory is missing Shader ${source.shaderName}`);
    const materials = inventory.proofGraph.materials
      .filter((material) => (
        material.shaderIdentity === shader.identity
        && sameKeywords(material.keywords, source.keywords)
      ))
      .sort((left, right) => compareText(left.identity, right.identity));
    assert.equal(
      materials.length,
      port.materialCount,
      `${source.shaderName}: selector Material count mismatch`,
    );

    const cards = new Map();
    let materialSlotUsages = 0;
    for (const material of materials) {
      const usages = usageByMaterial.get(material.identity) || [];
      materialSlotUsages += usages.length;
      for (const usage of usages) {
        const card = cards.get(usage.illustrationId) || {
          illustrationId: usage.illustrationId,
          materials: new Map(),
        };
        const materialCoverage = card.materials.get(material.identity) || {
          material,
          slotUsages: [],
        };
        materialCoverage.slotUsages.push({
          rendererIdentity: usage.rendererIdentity,
          materialSlot: usage.materialSlot,
        });
        card.materials.set(material.identity, materialCoverage);
        cards.set(usage.illustrationId, card);
      }
    }
    assert.equal(
      materialSlotUsages,
      port.materialSlotUsages,
      `${source.shaderName}: selector slot-usage count mismatch`,
    );
    assert(cards.size > 0, `${source.shaderName}: selector has no card witness`);
    return {
      source,
      port,
      shader,
      materials,
      materialSlotUsages,
      cards,
    };
  });
  assert.equal(
    new Set(obligations.map((row) => row.port.selectorId)).size,
    obligations.length,
    "changed-route selector obligations are not unique",
  );
  obligations.sort((left, right) => compareText(
    routeKey(left.source),
    routeKey(right.source),
  ));
  return obligations;
}

function indexCardExamples(examples) {
  assert.equal(
    examples.schema,
    "pocket-card-render/official-card-examples@1",
  );
  const result = new Map();
  const add = (section, rows) => {
    for (const row of rows || []) {
      const illustrationId = row.illustrationId || row;
      const sections = result.get(illustrationId) || [];
      sections.push(section);
      result.set(illustrationId, sections);
    }
  };
  add("coverageSet.selectedWitnesses", examples.coverageSet?.selectedWitnesses);
  add(
    "rarityRenderingCoverageSet.additionalWitnesses",
    examples.rarityRenderingCoverageSet?.additionalWitnesses,
  );
  add("supplementalBundledExamples", examples.supplementalBundledExamples);
  return result;
}

function discoverLocales() {
  const prefix = "card_face.";
  const suffix = ".json";
  const locales = fs.readdirSync(path.join(PUBLIC, "locales"))
    .filter((name) => name.startsWith(prefix) && name.endsWith(suffix))
    .map((name) => name.slice(prefix.length, -suffix.length))
    .sort(compareText);
  assert.equal(locales.length, 9, "expected exactly nine published locales");
  return locales;
}

function auditAvailability(
  illustrationId,
  locales,
  exampleIndex,
  { detailed = false, digestCache = new Map() } = {},
) {
  const cardId = cardIdFromIllustration(illustrationId);
  const sceneAbsolute = path.join(PUBLIC, `scene.${illustrationId}.json`);
  const sceneExists = fs.existsSync(sceneAbsolute);
  let scene = null;
  let gameUrls = [];
  let missingGameUrls = [];
  let sceneMissing = null;
  if (sceneExists) {
    scene = readJson(sceneAbsolute);
    gameUrls = [...collectGameUrls(scene)].sort(compareText);
    missingGameUrls = gameUrls.filter(
      (url) => !fs.existsSync(publicFileForGameUrl(url)),
    );
    sceneMissing = Array.isArray(scene._missing) ? scene._missing : null;
  }

  const localeFiles = locales.map((locale) => {
    const absolute = path.join(PUBLIC, "text", `${cardId}.${locale}.json`);
    return {
      locale,
      absolute,
      exists: fs.existsSync(absolute),
    };
  });
  const exampleSections = [...(exampleIndex.get(illustrationId) || [])]
    .sort(compareText);
  const summary = {
    illustrationId,
    cardId,
    sceneExists,
    sceneReady:
      sceneExists
      && Array.isArray(sceneMissing)
      && sceneMissing.length === 0
      && missingGameUrls.length === 0,
    examplePresent: exampleSections.length > 0,
    localeTextCount: localeFiles.filter((row) => row.exists).length,
    localeTextComplete: localeFiles.every((row) => row.exists),
  };
  summary.fullyAvailable = (
    summary.sceneReady
    && summary.examplePresent
    && summary.localeTextComplete
  );
  if (!detailed) return summary;

  const digest = (absolute) => {
    if (!digestCache.has(absolute)) digestCache.set(absolute, fileDigest(absolute));
    return digestCache.get(absolute);
  };
  const gameReferences = gameUrls.map((url) => {
    const absolute = publicFileForGameUrl(url);
    assert(fs.existsSync(absolute), `${illustrationId}: missing ${url}`);
    const stats = fs.statSync(absolute);
    return {
      url,
      byteLength: stats.size,
      sha256: digest(absolute),
    };
  });
  return {
    ...summary,
    publicScene: {
      logicalPath: repoPath(sceneAbsolute),
      byteLength: fs.statSync(sceneAbsolute).size,
      sha256: digest(sceneAbsolute),
      officialDrawCount: scene.officialDraws?.length ?? null,
      declaredMissing: sceneMissing,
    },
    cardExamples: {
      sections: exampleSections,
    },
    localeText: localeFiles.map((row) => {
      assert(row.exists, `${illustrationId}: missing ${row.locale} text`);
      return {
        locale: row.locale,
        logicalPath: repoPath(row.absolute),
        sha256: digest(row.absolute),
      };
    }),
    gameAssets: {
      referenceCount: gameReferences.length,
      missing: missingGameUrls,
      references: gameReferences,
      referenceSetSha256: canonicalDigest(gameReferences),
    },
    scene,
  };
}

function compareSolutions(left, right, availability) {
  if (left.length !== right.length) return left.length - right.length;
  const score = (rows, field) => rows.reduce(
    (sum, illustrationId) => sum + Number(availability.get(illustrationId)[field]),
    0,
  );
  for (const field of [
    "fullyAvailable",
    "sceneReady",
    "examplePresent",
    "localeTextComplete",
  ]) {
    const delta = score(right, field) - score(left, field);
    if (delta !== 0) return delta;
  }
  return compareText(left.join("\n"), right.join("\n"));
}

function solveExactSetCover(obligations, locales, exampleIndex) {
  assert(
    obligations.length < 31,
    "subset-lattice solver supports at most 30 obligations",
  );
  const cards = new Map();
  obligations.forEach((obligation, index) => {
    for (const illustrationId of obligation.cards.keys()) {
      cards.set(
        illustrationId,
        (cards.get(illustrationId) || 0) | (1 << index),
      );
    }
  });
  const availability = new Map(
    [...cards.keys()].sort(compareText).map((illustrationId) => [
      illustrationId,
      auditAvailability(illustrationId, locales, exampleIndex),
    ]),
  );
  const states = new Map([[0, []]]);
  for (const [illustrationId, coverage] of [...cards].sort(
    ([left], [right]) => compareText(left, right),
  )) {
    for (const [mask, solution] of [...states]) {
      const nextMask = mask | coverage;
      if (nextMask === mask) continue;
      const candidate = [...solution, illustrationId];
      const current = states.get(nextMask);
      if (
        !current
        || compareSolutions(candidate, current, availability) < 0
      ) {
        states.set(nextMask, candidate);
      }
    }
  }
  const fullMask = (1 << obligations.length) - 1;
  const selected = states.get(fullMask);
  assert(selected, "candidate route obligations are not coverable");
  return {
    selected,
    cards,
    availability,
    statesVisited: states.size,
  };
}

function materialSummary(materialCoverage) {
  const material = materialCoverage.material;
  return {
    identity: material.identity,
    name: material.name,
    sourceBundle: material.sourceBundle,
    sourceBundleSha256: material.sourceBundleSha256,
    rawSha256: material.rawSha256,
    slotUsageCount: materialCoverage.slotUsages.length,
  };
}

function faceBundleIdentity(inventory, illustrationId) {
  const suffix =
    `/${illustrationId}/L/Prefabs/${illustrationId}_L.prefab_bundles`;
  const rows = inventory.proofGraph.sourceBundles
    .filter(([logicalPath]) => logicalPath.endsWith(suffix));
  assert.equal(
    rows.length,
    1,
    `${illustrationId}: expected one candidate L Face prefab bundle`,
  );
  const [logicalPath, expectedSha256] = rows[0];
  const absolute = path.resolve(inventory.source.decryptedRoot, logicalPath);
  assert(fs.existsSync(absolute), `${illustrationId}: Face bundle is absent`);
  assert.equal(
    fileDigest(absolute),
    expectedSha256,
    `${illustrationId}: Face bundle differs from inventory proof`,
  );
  return {
    logicalPath,
    byteLength: fs.statSync(absolute).size,
    sha256: expectedSha256,
  };
}

function assertSceneMaterialCoverage(
  illustrationId,
  detailedAvailability,
  coverages,
) {
  const sceneMaterials = detailedAvailability.scene.materials;
  assert(
    sceneMaterials && typeof sceneMaterials === "object",
    `${illustrationId}: scene has no Material table`,
  );
  for (const coverage of coverages) {
    const expectedShader = coverage.shaderName.split("/").at(-1);
    for (const material of coverage.materials) {
      const sceneMaterial = sceneMaterials[material.name];
      assert(
        sceneMaterial,
        `${illustrationId}: scene is missing Material ${material.name}`,
      );
      assert.equal(
        sceneMaterial.shader,
        expectedShader,
        `${material.name}: scene Shader differs from candidate inventory`,
      );
      assert(
        sameKeywords(sceneMaterial.keywords, coverage.keywords),
        `${material.name}: scene keywords differ from candidate inventory`,
      );
    }
  }
}

function buildReport(args) {
  const candidateLoaded = loadOfficialSample(args.candidateManifest);
  const sample = candidateLoaded.sample;
  assert.equal(sample.status, "candidate");
  const candidateStem = sample.sampleId.replace(/-candidate$/, "");
  assert.notEqual(candidateStem, sample.sampleId, "candidate sample ID needs a -candidate suffix");
  const analysisAbsolute = path.resolve(
    ROOT,
    args.analysis
      || path.join(
        "build",
        "official-samples",
        `${candidateStem}-shader-analysis.json`,
      ),
  );
  const inventoryAbsolute = path.resolve(ROOT, args.inventory);
  const outputAbsolute = path.resolve(
    ROOT,
    args.out
      || path.join(
        "build",
        "official-samples",
        `${candidateStem}-changed-route-corpus.json`,
      ),
  );
  const analysis = readJson(analysisAbsolute);
  const inventory = loadCandidateInventory(inventoryAbsolute, sample);
  assert.equal(
    analysis.candidateInventorySha256,
    fileDigest(inventoryAbsolute),
    "shader analysis and candidate inventory identities differ",
  );
  const obligations = deriveRouteObligations(analysis, inventory, sample);
  const examplesAbsolute = path.join(PUBLIC, "card-examples.json");
  const examples = readJson(examplesAbsolute);
  const exampleIndex = indexCardExamples(examples);
  const locales = discoverLocales();
  const solution = solveExactSetCover(obligations, locales, exampleIndex);
  const digestCache = new Map();

  const witnesses = solution.selected.map((illustrationId) => {
    const detailed = auditAvailability(
      illustrationId,
      locales,
      exampleIndex,
      { detailed: true, digestCache },
    );
    assert(
      detailed.fullyAvailable,
      `${illustrationId}: selected witness is not fully available`,
    );
    const coverages = obligations.flatMap((obligation) => {
      const card = obligation.cards.get(illustrationId);
      if (!card) return [];
      return [{
        selectorId: obligation.port.selectorId,
        candidateWitnessId: obligation.port.candidateWitnessId,
        sourceKind: obligation.source.sourceKind,
        sourceClassification: obligation.source.sourceClassification,
        shaderName: obligation.source.shaderName,
        keywords: [...obligation.source.keywords].sort(compareText),
        subshader: obligation.source.subshader,
        pass: obligation.source.pass,
        materials: [...card.materials.values()]
          .map(materialSummary)
          .sort((left, right) => compareText(left.identity, right.identity)),
      }];
    });
    assertSceneMaterialCoverage(illustrationId, detailed, coverages);
    const { scene, ...availability } = detailed;
    return {
      illustrationId,
      cardId: detailed.cardId,
      candidateFaceBundle: faceBundleIdentity(inventory, illustrationId),
      selectorCoverage: coverages,
      availability,
    };
  });
  const coveredSelectors = new Set(
    witnesses.flatMap((witness) => (
      witness.selectorCoverage.map((coverage) => coverage.selectorId)
    )),
  );
  assert.equal(coveredSelectors.size, obligations.length);
  assert(witnesses.every((witness) => witness.availability.fullyAvailable));

  const report = {
    schema:
      "pocket-card-render/candidate-changed-route-migration-subcorpus@1",
    schemaVersion: 1,
    scope: {
      name: "changed-route-migration-subcorpus",
      included:
        "Nine changed selector routes plus the one rejected static-reuse selector route",
      canonicalCorpus: false,
      runtimeFidelity: false,
      gameFidelity: false,
      officialShaderRestorationPercent: null,
      excludedClaims: [
        "candidate canonical corpus completeness",
        "guest runtime dispatch or binding fidelity",
        "Vulkan to WebGL backend equivalence",
        "pixel or game-display fidelity",
      ],
    },
    candidate: {
      selectionPointer: candidateLoaded.selectionRelative,
      manifest: candidateLoaded.manifestRelative,
      sampleId: sample.sampleId,
      sampleManifestSha256: officialSampleDigest(sample),
      gameVersion: sample.game.versionName,
      unityVersion: sample.unity.serializedVersion,
    },
    inputs: {
      shaderAnalysis: {
        logicalPath: repoPath(analysisAbsolute),
        sha256: fileDigest(analysisAbsolute),
      },
      candidateMaterialInventory: {
        logicalSourceId: "candidate-material-program-inventory-full",
        sha256: fileDigest(inventoryAbsolute),
        schema: inventory.schema,
        proofGraphSha256: inventory.digests.proofGraphSha256,
        portIndexSha256: inventory.digests.portIndexSha256,
      },
      cardExamples: {
        logicalPath: repoPath(examplesAbsolute),
        sha256: fileDigest(examplesAbsolute),
        sampleId: examples.sampleId,
        availabilityOnly: true,
      },
    },
    summary: {
      changedSelectorCount: analysis.routes.length,
      staticReuseRejectedSelectorCount:
        analysis.staticReuseValidation.filter(
          (row) => row.reuseEligible === false,
        ).length,
      selectorObligationCount: obligations.length,
      exactMinimumWitnessCount: witnesses.length,
      selectedWitnessCount: witnesses.length,
      selectedSceneReadyCount:
        witnesses.filter((witness) => witness.availability.sceneReady).length,
      selectedExamplePresentCount:
        witnesses.filter((witness) => witness.availability.examplePresent).length,
      selectedLocaleTextCompleteCount:
        witnesses.filter(
          (witness) => witness.availability.localeTextComplete,
        ).length,
      selectedMissingGameReferenceCount: witnesses.reduce(
        (sum, witness) => (
          sum + witness.availability.gameAssets.missing.length
        ),
        0,
      ),
      uncoveredSelectorCount: 0,
    },
    optimality: {
      claim: "global-minimum-cardinality-for-this-ten-selector-subcorpus",
      solver: "exact-dynamic-programming-over-the-selector-subset-lattice",
      statesVisited: solution.statesVisited,
      lowerBound: witnesses.length,
      upperBound: witnesses.length,
      selectorFactsSource:
        "candidate inventory materials plus usageRows only",
      availabilityTieBreak: [
        "maximize fully available witnesses",
        "maximize ready public scenes",
        "maximize card-examples membership",
        "maximize complete nine-locale text",
        "lexicographically smallest illustrationId list",
      ],
    },
    selectorObligations: obligations.map((obligation) => {
      const selectedWitnesses = witnesses
        .filter((witness) => witness.selectorCoverage.some(
          (coverage) => coverage.selectorId === obligation.port.selectorId,
        ))
        .map((witness) => witness.illustrationId);
      assert(selectedWitnesses.length > 0);
      return {
        selectorId: obligation.port.selectorId,
        candidateWitnessId: obligation.port.candidateWitnessId,
        sourceKind: obligation.source.sourceKind,
        sourceClassification: obligation.source.sourceClassification,
        shaderName: obligation.source.shaderName,
        keywords: [...obligation.source.keywords].sort(compareText),
        subshader: obligation.source.subshader,
        pass: obligation.source.pass,
        changedFields: obligation.source.changedFields,
        inventoryMaterialCount: obligation.materials.length,
        inventoryMaterialSlotUsageCount: obligation.materialSlotUsages,
        candidateCardWitnessCount: obligation.cards.size,
        selectedWitnesses,
      };
    }),
    witnesses,
    uncoveredSelectors: [],
    boundaries: [
      {
        scope: "selector-and-material-witnessing",
        status: "exact-static",
        detail:
          "Selector, Material, slot usage, Face bundle, and minimum set-cover facts come from the candidate inventory and its hash-bound source bundles.",
      },
      {
        scope: "published-scene-and-resource-availability",
        status: "availability-only",
        detail:
          "Existing scenes, card-examples membership, localized text, and /game files are audited only for local availability and do not establish candidate provenance.",
      },
      {
        scope: "canonical-corpus-and-runtime",
        status: "out-of-scope",
        detail:
          "This migration subcorpus is not the candidate canonical corpus and contains no runtime or display-fidelity claim.",
      },
    ],
  };
  return { report, outputAbsolute };
}

function serialize(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const { report, outputAbsolute } = buildReport(args);
  const serialized = serialize(report);
  if (args.check) {
    assert(
      fs.existsSync(outputAbsolute),
      `${repoPath(outputAbsolute)} does not exist`,
    );
    assert.equal(
      fs.readFileSync(outputAbsolute, "utf8"),
      serialized,
      `${repoPath(outputAbsolute)} is stale`,
    );
    console.log("Candidate changed-route migration subcorpus check OK");
  } else {
    atomicWriteFileSync(outputAbsolute, serialized);
    console.log(`wrote ${repoPath(outputAbsolute)}`);
  }
  console.log([
    `${report.summary.selectorObligationCount} selector obligations`,
    `${report.summary.exactMinimumWitnessCount} exact-minimum witnesses`,
    `${report.summary.selectedSceneReadyCount} scenes ready`,
    `${report.summary.selectedMissingGameReferenceCount} missing /game references`,
  ].join(", "));
  console.log(
    "Scope: changed-route migration subcorpus only; no canonical-corpus or runtime-fidelity claim.",
  );
}

if (
  process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main();
}
