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
import { readOfficialTextureSampler } from "./official-texture-sampler.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
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
  const args = {
    check: false,
    candidateManifest:
      process.env.PCR_OFFICIAL_CANDIDATE_MANIFEST
      || "build/official-samples/candidate.json",
    outputRoot: DEFAULT_OUTPUT_ROOT,
    decryptedRoot: null,
    artifactRoot: null,
    recipesRoot: null,
    inventory: null,
    out: null,
    publishPublic: false,
    checkPublic: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--check") {
      args.check = true;
      continue;
    }
    if (token === "--publish-public") {
      args.publishPublic = true;
      continue;
    }
    if (token === "--check-public") {
      args.checkPublic = true;
      continue;
    }
    const key = {
      "--candidate-manifest": "candidateManifest",
      "--output-root": "outputRoot",
      "--decrypted-root": "decryptedRoot",
      "--artifact-root": "artifactRoot",
      "--recipes-root": "recipesRoot",
      "--inventory": "inventory",
      "--out": "out",
    }[token];
    if (!key) throw new Error(`unknown argument: ${token}`);
    const value = argv[++index];
    if (!value || value.startsWith("--")) throw new Error(`${token} requires a value`);
    args[key] = value;
  }
  args.outputRoot = path.resolve(args.outputRoot);
  args.decryptedRoot = path.resolve(
    args.decryptedRoot || path.join(args.outputRoot, "decrypted"),
  );
  args.inventory = path.resolve(
    args.inventory || path.join(args.outputRoot, "material-program-inventory-full.json"),
  );
  return args;
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

function sha256Bytes(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function sha256File(filename) {
  return sha256Bytes(fs.readFileSync(filename));
}

function canonicalDigest(value) {
  return sha256Bytes(Buffer.from(JSON.stringify(canonicalize(value))));
}

function serialize(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function logicalRepoPath(filename) {
  const relative = path.relative(ROOT, filename).replaceAll("\\", "/");
  assert(relative !== ".." && !relative.startsWith("../"));
  return relative;
}

function identityKey(value) {
  if (typeof value === "string") return value;
  const identity = value?.identity || value;
  if (typeof identity === "string") return identity;
  if (identity?.cab && identity?.pathId != null) {
    return `${identity.cab}:${identity.pathId}`;
  }
  return null;
}

function drawKey(row) {
  return [
    row.rendererIdentity,
    Number(row.materialSlot),
    row.materialIdentity,
  ].join("#");
}

function migrationWitnessRows(canonical, changedRoutes, sample, sampleManifestSha256) {
  assert.equal(
    changedRoutes.schema,
    "pocket-card-render/candidate-changed-route-migration-subcorpus@1",
  );
  assert.equal(changedRoutes.candidate.sampleId, sample.sampleId);
  assert.equal(
    changedRoutes.candidate.sampleManifestSha256,
    sampleManifestSha256,
  );
  assert.equal(
    changedRoutes.summary.selectedWitnessCount,
    changedRoutes.witnesses.length,
  );
  assert.equal(changedRoutes.summary.uncoveredSelectorCount, 0);

  const rows = new Map();
  for (const scene of canonical.scenes) {
    rows.set(scene.cardId, {
      ...scene,
      coverageRoles: ["baseline-regression"],
      selectorObligations: [],
    });
  }
  for (const witness of changedRoutes.witnesses) {
    const selectorObligations = witness.selectorCoverage.map((coverage) => ({
      selectorId: coverage.selectorId,
      candidateWitnessId: coverage.candidateWitnessId,
      sourceKind: coverage.sourceKind,
      sourceClassification: coverage.sourceClassification,
      shaderName: coverage.shaderName,
      keywords: coverage.keywords,
      subshader: coverage.subshader,
      pass: coverage.pass,
    }));
    const existing = rows.get(witness.illustrationId);
    if (existing) {
      existing.coverageRoles = [
        ...new Set([...existing.coverageRoles, "changed-route-witness"]),
      ];
      existing.selectorObligations = [
        ...existing.selectorObligations,
        ...selectorObligations,
      ];
      continue;
    }
    rows.set(witness.illustrationId, {
      file: `scene.${witness.illustrationId}.json`,
      cardId: witness.illustrationId,
      textStem: witness.cardId,
      coverageRoles: ["changed-route-witness"],
      selectorObligations,
    });
  }

  const requiredSelectors = new Set(
    changedRoutes.selectorObligations.map((row) => row.selectorId),
  );
  const coveredSelectors = new Set(
    [...rows.values()]
      .flatMap((row) => row.selectorObligations)
      .map((row) => row.selectorId),
  );
  assert.deepEqual([...coveredSelectors].sort(), [...requiredSelectors].sort());
  return {
    scenes: [...rows.values()],
    requiredSelectors,
    baselineCount: canonical.scenes.length,
    changedWitnessCount: changedRoutes.witnesses.length,
  };
}

function validateScene(scene, canonical, usageRows) {
  assert.equal(scene.officialDrawSchemaVersion, 2);
  assert.equal(scene.card.id, canonical.cardId);
  assert.equal(scene.prefabGlb, `/game/Assets/PrefabHierarchyObject/${canonical.cardId}_L.glb`);
  assert.deepEqual(scene._missing, []);

  const expectedMaterials = new Set(usageRows.map((row) => row.materialIdentity));
  const actualMaterials = new Set(
    Object.values(scene.materials).map((material) => material.official.material),
  );
  assert.deepEqual(
    [...actualMaterials].sort(),
    [...expectedMaterials].sort(),
    `${canonical.cardId}: candidate Material identity set differs`,
  );

  const expectedDraws = usageRows.map(drawKey).sort();
  const actualDraws = scene.officialDraws.map(drawKey).sort();
  assert.deepEqual(
    actualDraws,
    expectedDraws,
    `${canonical.cardId}: candidate renderer/slot/Material rows differ`,
  );
}

function textureStateProjection(textures) {
  return Object.fromEntries(
    Object.entries(textures || {}).map(([slot, texture]) => [
      slot,
      {
        name: texture.officialName || texture.tex,
        identity:
          texture.textureIdentity?.identity
          || texture.textureIdentity
          || null,
        assetPath: texture.assetPath || null,
        scale: texture.scale,
        offset: texture.offset,
      },
    ]),
  );
}

function validateMaterialState(scene, recipe, materialByIdentity) {
  assert.equal(recipe.schema, "pocket-card-render/material-recipe@2");
  assert.equal(recipe.schemaVersion, 2);
  const recipeDraws = new Map();
  for (const layer of recipe.layers) {
    if (!layer.material) continue;
    const key = [
      layer.rendererIdentity?.identity,
      Number(layer.materialSlot),
      layer.materialIdentity?.identity,
    ].join("#");
    assert(!recipeDraws.has(key), `${scene.card.id}: duplicate recipe draw ${key}`);
    recipeDraws.set(key, layer);
  }

  const uniqueMaterials = new Set();
  for (const draw of scene.officialDraws) {
    const key = drawKey(draw);
    const layer = recipeDraws.get(key);
    assert(layer, `${scene.card.id}: recipe draw ${key} is absent`);
    const identity = draw.materialIdentity;
    const inventoryMaterial = materialByIdentity.get(identity);
    assert(inventoryMaterial, `${scene.card.id}: inventory Material ${identity} is absent`);
    const serialized = layer.materialSerialized;
    assert(serialized, `${scene.card.id}: ${identity} lacks Material byte provenance`);
    assert.equal(serialized.rawByteSize, inventoryMaterial.rawByteSize);
    assert.equal(serialized.rawSha256, inventoryMaterial.rawSha256);
    assert.deepEqual(
      serialized.savedProperties,
      inventoryMaterial.savedProperties,
      `${scene.card.id}: ${identity} saved properties differ from inventory`,
    );
    assert.equal(layer.renderQueue, inventoryMaterial.customRenderQueue);
    assert(Number.isInteger(layer.effectiveRenderQueue));
    assert(layer.effectiveRenderQueue >= 0 && layer.effectiveRenderQueue <= 5000);
    const expectedQueue = layer.renderQueue >= 0
      ? layer.renderQueue
      : layer.shaderRenderQueue?.effectiveRenderQueue;
    assert.equal(
      layer.effectiveRenderQueue,
      expectedQueue,
      `${scene.card.id}: ${identity} effective render queue is not derived from official bytes`,
    );
    assert.equal(
      layer.effectiveRenderQueueSource,
      layer.renderQueue >= 0
        ? "serialized-material-custom-render-queue"
        : "serialized-shader-subshader-tags",
    );
    assert.equal(
      layer.enableInstancingVariants,
      inventoryMaterial.enableInstancingVariants,
    );
    assert.deepEqual(layer.keywords, inventoryMaterial.keywords);
    assert.deepEqual(layer.invalidKeywords, inventoryMaterial.invalidKeywords);

    const projected = scene.materials[draw.materialName];
    assert(projected, `${scene.card.id}: projected Material ${draw.materialName} is absent`);
    assert.equal(projected.official.material, identity);
    assert.equal(projected.official.rawByteSize, inventoryMaterial.rawByteSize);
    assert.equal(projected.official.rawSha256, inventoryMaterial.rawSha256);
    assert.equal(projected.queue, layer.effectiveRenderQueue);
    assert.equal(projected.official.effectiveRenderQueue, layer.effectiveRenderQueue);
    assert.equal(
      projected.official.effectiveRenderQueueSource,
      layer.effectiveRenderQueueSource,
    );
    assert.deepEqual(projected.official.shaderRenderQueue, layer.shaderRenderQueue);
    assert.deepEqual(
      projected.official.savedProperties,
      inventoryMaterial.savedProperties,
    );
    assert.deepEqual(projected.floats, layer.floats || {});
    assert.deepEqual(projected.ints, layer.ints || {});
    assert.deepEqual(projected.colors, layer.colors || {});
    assert.deepEqual(projected.keywords, layer.keywords || []);
    assert.deepEqual(
      textureStateProjection(projected.textures),
      textureStateProjection(layer.textures),
      `${scene.card.id}: ${identity} projected TexEnv state differs`,
    );
    uniqueMaterials.add(identity);
  }
  return {
    drawCount: scene.officialDraws.length,
    exactDrawCount: scene.officialDraws.length,
    uniqueMaterialIdentities: uniqueMaterials,
  };
}

function validateTextureEvidence(scenes, evidence, sample) {
  assert.equal(evidence.schemaVersion, 1);
  assert.equal(evidence.source.unityVersionFallback, sample.unity.serializedVersion);
  assert.equal(evidence.summary.sceneCount, scenes.length);
  assert.equal(evidence.summary.unresolvedCount, 0);
  assert.equal(
    evidence.summary.exactCount + evidence.summary.equivalentCandidateCount,
    evidence.summary.uniqueTextureCount,
  );

  let bindingCount = 0;
  for (const { scene } of scenes) {
    for (const material of Object.values(scene.materials)) {
      for (const texture of Object.values(material.textures || {})) {
        bindingCount += 1;
        const officialIdentity = identityKey(texture.textureIdentity);
        assert(officialIdentity, `${scene.card.id}: texture identity is absent`);
        const resolved = evidence.textures[texture.url];
        assert(resolved, `${scene.card.id}: ${texture.url} is absent from texture evidence`);
        const candidates = new Set(
          (resolved.candidates || []).map((candidate) => identityKey(candidate)).filter(Boolean),
        );
        assert(
          candidates.has(officialIdentity),
          `${scene.card.id}: ${texture.url} does not resolve to ${officialIdentity}`,
        );
      }
    }
  }
  return bindingCount;
}

async function buildReport(args) {
  const loaded = loadOfficialSample(args.candidateManifest);
  const sample = loaded.sample;
  assert.equal(sample.status, "candidate");
  const candidateStem = sample.sampleId.replace(/-candidate$/, "");
  assert.notEqual(candidateStem, sample.sampleId);
  args.artifactRoot = path.resolve(
    args.artifactRoot
      || path.join(
        args.outputRoot,
        "canonical-corpus",
        candidateStem,
        "scenes",
      ),
  );
  args.recipesRoot = path.resolve(
    args.recipesRoot
      || path.join(
        args.outputRoot,
        "canonical-corpus",
        candidateStem,
        "recipes",
      ),
  );
  const outputAbsolute = path.resolve(
    ROOT,
    args.out
      || path.join(
        "build",
        "official-samples",
        `${candidateStem}-canonical-scenes.json`,
      ),
  );

  const baselineCanonicalPath = path.join(ROOT, "build", "canonical-corpus.json");
  const baselineCanonical = JSON.parse(
    fs.readFileSync(baselineCanonicalPath, "utf8"),
  );
  assert.equal(typeof sample.canonicalCorpus?.path, "string");
  const canonicalPath = path.resolve(ROOT, sample.canonicalCorpus.path);
  assert.equal(sha256File(canonicalPath), sample.canonicalCorpus.sha256);
  const canonical = JSON.parse(fs.readFileSync(canonicalPath, "utf8"));
  assert.equal(canonical.schemaVersion, 2);
  assert.equal(canonical.sampleId, sample.sampleId);
  const changedRoutesPath = path.join(
    ROOT,
    "build",
    "official-samples",
    `${candidateStem}-changed-route-corpus.json`,
  );
  const changedRoutes = JSON.parse(
    fs.readFileSync(changedRoutesPath, "utf8"),
  );
  const sampleManifestSha256 = officialSampleDigest(sample);
  const migrationWitnesses = migrationWitnessRows(
    baselineCanonical,
    changedRoutes,
    sample,
    sampleManifestSha256,
  );
  const witnessProjection = (scene) => ({
    file: scene.file,
    cardId: scene.cardId,
    textStem: scene.textStem,
    coverageRoles: scene.coverageRoles,
  });
  assert.deepEqual(
    canonical.scenes.map(witnessProjection),
    migrationWitnesses.scenes.map(witnessProjection),
  );
  assert.deepEqual(canonical.locales, baselineCanonical.locales);
  const inventory = JSON.parse(fs.readFileSync(args.inventory, "utf8"));
  assert.equal(inventory.unityVersion, sample.unity.serializedVersion);
  assert.equal(
    sha256File(args.inventory),
    sample.proofSets.materialPrograms.inventorySha256,
  );
  const usageRows = inventory.proofGraph.usageRows;
  const materialByIdentity = new Map(
    inventory.proofGraph.materials.map((material) => [
      material.identity,
      material,
    ]),
  );
  const usageByCard = new Map(
    migrationWitnesses.scenes.map((card) => [
      card.cardId,
      usageRows.filter((row) => row.illustrationId === card.cardId),
    ]),
  );
  assert([...usageByCard.values()].every((rows) => rows.length > 0));

  process.env.PCR_RECIPES = args.recipesRoot;
  process.env.PCR_UNITY_VERSION = sample.unity.serializedVersion;
  const { buildScene } = await import("./build.mjs");
  const scenes = migrationWitnesses.scenes.map((card) => {
    const recipeName = `${card.cardId}_render_full.json`;
    const recipePath = path.join(args.recipesRoot, recipeName);
    assert(fs.statSync(recipePath, { throwIfNoEntry: false })?.isFile());
    const recipe = JSON.parse(fs.readFileSync(recipePath, "utf8"));
    const scene = buildScene(card.cardId, recipeName);
    validateScene(scene, card, usageByCard.get(card.cardId));
    const materialState = validateMaterialState(
      scene,
      recipe,
      materialByIdentity,
    );
    const serialized = serialize(scene);
    return {
      canonical: card,
      recipeName,
      recipePath,
      scene,
      materialState,
      serialized,
      absolute: path.join(args.artifactRoot, card.file),
    };
  });

  if (!args.check) {
    fs.mkdirSync(args.artifactRoot, { recursive: true });
    for (const item of scenes) atomicWriteFileSync(item.absolute, item.serialized);
  } else {
    for (const item of scenes) {
      assert(fs.statSync(item.absolute, { throwIfNoEntry: false })?.isFile());
      assert.equal(fs.readFileSync(item.absolute, "utf8"), item.serialized);
    }
  }
  if (args.publishPublic) {
    for (const item of scenes) {
      atomicWriteFileSync(
        path.join(ROOT, "public", item.canonical.file),
        item.serialized,
      );
    }
  }
  if (args.checkPublic) {
    for (const item of scenes) {
      const published = path.join(ROOT, "public", item.canonical.file);
      assert(
        fs.statSync(published, { throwIfNoEntry: false })?.isFile(),
        `published candidate scene is missing: ${item.canonical.file}`,
      );
      assert.equal(
        fs.readFileSync(published, "utf8"),
        item.serialized,
        `published candidate scene is stale: ${item.canonical.file}`,
      );
    }
  }

  const textureEvidence = readOfficialTextureSampler({
    scenes: scenes.map((item) => item.absolute),
    decryptedRoot: args.decryptedRoot,
    unityVersion: sample.unity.serializedVersion,
  });
  const textureBindingCount = validateTextureEvidence(scenes, textureEvidence, sample);
  const textureSerialized = serialize(textureEvidence);
  const textureAbsolute = path.join(args.artifactRoot, "texture-sampler-evidence.json");
  if (!args.check) {
    atomicWriteFileSync(textureAbsolute, textureSerialized);
  } else {
    assert(fs.statSync(textureAbsolute, { throwIfNoEntry: false })?.isFile());
    assert.equal(fs.readFileSync(textureAbsolute, "utf8"), textureSerialized);
  }

  const sceneFacts = scenes.map((item) => ({
    file: item.canonical.file,
    cardId: item.canonical.cardId,
    textStem: item.canonical.textStem,
    coverageRoles: item.canonical.coverageRoles,
    selectorObligations: item.canonical.selectorObligations,
    byteLength: Buffer.byteLength(item.serialized),
    sha256: sha256Bytes(Buffer.from(item.serialized)),
    recipe: {
      logicalPath: `recipes/${item.recipeName}`,
      byteLength: fs.statSync(item.recipePath).size,
      sha256: sha256File(item.recipePath),
    },
    materialCount: Object.keys(item.scene.materials).length,
    officialDrawCount: item.scene.officialDraws.length,
    textureCount: Object.keys(item.scene.textures).length,
    materialStateDrawCount: item.materialState.drawCount,
    exactMaterialStateDrawCount: item.materialState.exactDrawCount,
    uniqueMaterialStateCount:
      item.materialState.uniqueMaterialIdentities.size,
  }));
  const textureFact = {
    logicalPath: "scenes/texture-sampler-evidence.json",
    byteLength: Buffer.byteLength(textureSerialized),
    sha256: sha256Bytes(Buffer.from(textureSerialized)),
  };
  const report = {
    schema: "pocket-card-render/candidate-canonical-scenes@3",
    schemaVersion: 3,
    candidate: {
      selection: loaded.selectionRelative,
      manifest: loaded.manifestRelative,
      sampleId: sample.sampleId,
      sampleManifestSha256,
      gameVersion: sample.game.versionName,
      unityVersion: sample.unity.serializedVersion,
    },
    scope: {
      status:
        "exact-static-scene-draw-material-state-and-texture-bindings",
      denominator:
        "baseline regression scenes union candidate changed/default-sensitive route witnesses",
      completeForDeclaredMigrationWitnessSet: true,
      fullMaterialSerializedState:
        "exact-official-raw-bytes-and-renderer-projection",
      effectiveRenderQueue:
        "exact Material override or serialized Shader SubShader Queue tag",
      candidateCanonicalCorpus: true,
      officialShaderRestorationPercent: null,
      gameFidelity: false,
      runtimeFidelity: false,
    },
    inputs: {
      canonicalCorpus: {
        logicalPath: logicalRepoPath(canonicalPath),
        sha256: sha256File(canonicalPath),
      },
      baselineRegressionCorpus: {
        logicalPath: logicalRepoPath(baselineCanonicalPath),
        sha256: sha256File(baselineCanonicalPath),
      },
      changedRouteCorpus: {
        logicalPath:
          `build/official-samples/${candidateStem}-changed-route-corpus.json`,
        sha256: sha256File(changedRoutesPath),
      },
      materialProgramInventory: {
        logicalSourceId: "candidate-material-program-inventory-full",
        sha256: sha256File(args.inventory),
        proofGraphSha256: inventory.digests.proofGraphSha256,
      },
      generators: {
        recipe: {
          logicalPath: "build/dump_recipe.py",
          sha256: sha256File(path.join(ROOT, "build", "dump_recipe.py")),
        },
        scene: {
          logicalPath: "build/build.mjs",
          sha256: sha256File(path.join(ROOT, "build", "build.mjs")),
        },
        texture: {
          logicalPath: "build/extract_official_texture_sampler.py",
          sha256: sha256File(path.join(ROOT, "build", "extract_official_texture_sampler.py")),
        },
      },
    },
    scenes: sceneFacts,
    textureEvidence: textureFact,
    aggregateSha256: canonicalDigest({ scenes: sceneFacts, textureEvidence: textureFact }),
    summary: {
      sceneCount: scenes.length,
      baselineRegressionSceneCount: migrationWitnesses.baselineCount,
      changedRouteWitnessSceneCount: migrationWitnesses.changedWitnessCount,
      selectorObligationCount: migrationWitnesses.requiredSelectors.size,
      coveredSelectorObligationCount: migrationWitnesses.requiredSelectors.size,
      materialCount: sceneFacts.reduce((sum, item) => sum + item.materialCount, 0),
      materialStateDrawCount:
        sceneFacts.reduce((sum, item) => sum + item.materialStateDrawCount, 0),
      exactMaterialStateDrawCount:
        sceneFacts.reduce(
          (sum, item) => sum + item.exactMaterialStateDrawCount,
          0,
        ),
      uniqueMaterialStateCount: new Set(
        scenes.flatMap(
          (item) => [...item.materialState.uniqueMaterialIdentities],
        ),
      ).size,
      officialDrawCount: sceneFacts.reduce((sum, item) => sum + item.officialDrawCount, 0),
      sceneTextureCount: sceneFacts.reduce((sum, item) => sum + item.textureCount, 0),
      textureBindingCount,
      uniqueTextureCount: textureEvidence.summary.uniqueTextureCount,
      exactTextureCount: textureEvidence.summary.exactCount,
      payloadEquivalentTextureCount: textureEvidence.summary.equivalentCandidateCount,
      unresolvedTextureCount: textureEvidence.summary.unresolvedCount,
    },
    runtimeBoundaries: [
      {
        id: "candidate-scene-guest-dispatch",
        status: "runtime-required",
        reason:
          "serialized renderer/material/texture closure does not prove candidate guest draw dispatch, descriptors, uniforms, or attachments",
      },
      {
        id: "candidate-runtime-render-texture",
        status: "runtime-required",
        reason:
          "_DynamicUITex is produced at runtime and is outside static Texture2D/Cubemap bundle evidence",
      },
    ],
  };
  return { report, outputAbsolute };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { report, outputAbsolute } = await buildReport(args);
  const serialized = serialize(report);
  if (args.check) {
    assert(fs.statSync(outputAbsolute, { throwIfNoEntry: false })?.isFile());
    assert.equal(fs.readFileSync(outputAbsolute, "utf8"), serialized);
    console.log("Candidate canonical scene check OK");
  } else {
    atomicWriteFileSync(outputAbsolute, serialized);
    console.log(`wrote ${logicalRepoPath(outputAbsolute)}`);
  }
  console.log(
    `  ${report.summary.sceneCount} scenes, ${report.summary.officialDrawCount} draws, `
    + `${report.summary.uniqueTextureCount} unique textures`,
  );
  console.log(
    `  ${report.summary.textureBindingCount} texture bindings, `
    + `${report.summary.unresolvedTextureCount} unresolved`,
  );
}

if (
  process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await main();
}
