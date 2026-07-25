#!/usr/bin/env node
// Compare scene Material values with independently decoded official m_SavedProperties.
import fs from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PYTHON = process.env.PYTHON || "python";
const EXPECTED = Object.freeze({
  schema: "pocket-card-render/official-material-properties@1",
  sceneRows: 88,
  uniqueMaterials: 70,
  sourceBundles: 44,
  integers: 0,
  floats: 1783,
  colors: 169,
  textureEnvironments: 296,
  nonNullTextures: 252,
  nullTextures: 44,
  nondefaultTextureTransforms: 0,
  sourceBundlesSha256: "3f549b7b157bc8496c90bc233389e95659859b3d1530f3968ed0785622ae1809",
  rowsSha256: "dd689fb274a55f6960a3ddeed8a541b5aba1baa00389a85da677b6e55d2362f8",
  materialsSha256: "dd6b645b8a9317149cdc943918dae0a85691e002072a5ab47de9b722f7e66c5f",
  evidenceSha256: "382fd37948ed24e732a257b537c139f2cade32f7bd9f5315d9bb6f1e3fd33356",
});
const SHA256 = /^[0-9a-f]{64}$/;
const RUNTIME_PRODUCED_TEXTURE_SLOTS = Object.freeze({
  Text: new Set(["_DynamicUITex"]),
});

function readJson(relative) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relative), "utf8"));
}

function extractOfficialProperties() {
  const result = spawnSync(PYTHON, ["build/extract_official_material_properties.py"], {
    cwd: ROOT,
    env: process.env,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    shell: process.platform === "win32" && PYTHON === "python",
    windowsHide: true,
  });
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || result.error?.message
      || "official Material property extractor failed").trim());
  }
  return JSON.parse(result.stdout);
}

function sortedKeys(value) {
  return Object.keys(value || {}).sort((left, right) => left.localeCompare(right, "en"));
}

function auditProperties(evidence, scenes, textureManifest, { checkPinned = true } = {}) {
  const issues = [];
  const check = (condition, message) => { if (!condition) issues.push(message); };
  const same = (actual, expected, message) => check(isDeepStrictEqual(actual, expected), message);

  if (checkPinned) {
    check(evidence.schema === EXPECTED.schema, "official Material property schema mismatch");
    check(evidence.schemaVersion === 1, "official Material property schemaVersion mismatch");
    check(evidence.unityVersion === "2022.3.62f2", "official Unity version mismatch");
    for (const field of ["sceneRows", "uniqueMaterials", "sourceBundles"]) {
      check(evidence.summary?.[field] === EXPECTED[field], `official summary ${field} mismatch`);
    }
    for (const field of ["sourceBundlesSha256", "rowsSha256", "materialsSha256", "evidenceSha256"]) {
      check(evidence.digests?.[field] === EXPECTED[field], `official digest ${field} mismatch`);
    }
  }

  const materials = new Map();
  for (const material of evidence.materials || []) {
    check(typeof material.identity === "string" && !materials.has(material.identity),
      `duplicate or invalid official Material identity ${material.identity}`);
    materials.set(material.identity, material);
    check(SHA256.test(material.sourceBundleSha256 || ""), `${material.identity}: source bundle hash missing`);
    check(SHA256.test(material.rawSha256 || ""), `${material.identity}: raw object hash missing`);
    check(Number.isInteger(material.rawByteSize) && material.rawByteSize > 0,
      `${material.identity}: raw object size invalid`);
  }
  check(materials.size === EXPECTED.uniqueMaterials, "official Material identity count mismatch");

  const propertyCounts = {
    integers: 0,
    floats: 0,
    colors: 0,
    textureEnvironments: 0,
    nonNullTextures: 0,
    nullTextures: 0,
    nondefaultTextureTransforms: 0,
  };
  for (const material of materials.values()) {
    const saved = material.savedProperties || {};
    propertyCounts.integers += sortedKeys(saved.integers).length;
    propertyCounts.floats += sortedKeys(saved.floats).length;
    propertyCounts.colors += sortedKeys(saved.colors).length;
    for (const texture of Object.values(saved.textureEnvironments || {})) {
      propertyCounts.textureEnvironments += 1;
      propertyCounts[texture.texture ? "nonNullTextures" : "nullTextures"] += 1;
      if (!isDeepStrictEqual(texture.scale, [1, 1]) || !isDeepStrictEqual(texture.offset, [0, 0])) {
        propertyCounts.nondefaultTextureTransforms += 1;
      }
    }
  }
  for (const [field, value] of Object.entries(propertyCounts)) {
    check(value === EXPECTED[field], `official Material property count ${field} mismatch`);
  }

  const rowsByScene = new Map();
  for (const row of evidence.rows || []) {
    const rows = rowsByScene.get(row.sceneFile) || [];
    rows.push(row);
    rowsByScene.set(row.sceneFile, rows);
  }
  for (const [sceneFile, scene] of scenes) {
    const rows = rowsByScene.get(sceneFile) || [];
    same(sortedKeys(scene.materials), rows.map((row) => row.materialName).sort((a, b) => a.localeCompare(b, "en")),
      `${sceneFile}: scene Material inventory differs from official rows`);
    check(Array.isArray(scene._missing) && scene._missing.length === 0,
      `${sceneFile}: unresolved scene dependencies remain`);

    for (const row of rows) {
      const label = `${sceneFile}:${row.materialName}`;
      const sceneMaterial = scene.materials?.[row.materialName];
      const officialMaterial = materials.get(row.materialIdentity);
      check(Boolean(sceneMaterial && officialMaterial), `${label}: Material row cannot be joined`);
      if (!sceneMaterial || !officialMaterial) continue;
      check(sceneMaterial.official?.material === row.materialIdentity, `${label}: official Material identity mismatch`);
      check(officialMaterial.name === row.materialName, `${label}: serialized Material name mismatch`);

      const saved = officialMaterial.savedProperties;
      const integerKeys = new Set(sortedKeys(saved.integers));
      check(sortedKeys(saved.floats).every((key) => !integerKeys.has(key)),
        `${label}: integer and float properties overlap`);
      const expectedFloats = { ...saved.integers, ...saved.floats };
      same(sceneMaterial.floats || {}, expectedFloats, `${label}: float/int saved properties mismatch`);

      const expectedColors = Object.fromEntries(Object.entries(saved.colors || {}).map(([key, value]) => [key, {
        r: value[0], g: value[1], b: value[2], a: value[3],
      }]));
      same(sceneMaterial.colors || {}, expectedColors, `${label}: Color saved properties mismatch`);

      const runtimeProducedSlots = RUNTIME_PRODUCED_TEXTURE_SLOTS[sceneMaterial.shader] || new Set();
      const expectedTextureSlots = Object.entries(saved.textureEnvironments || {})
        .filter(([slot, value]) => value.texture && !runtimeProducedSlots.has(slot))
        .map(([key]) => key)
        .sort((a, b) => a.localeCompare(b, "en"));
      same(sortedKeys(sceneMaterial.textures), expectedTextureSlots, `${label}: texture slot inventory mismatch`);
      for (const [slot, textureEnvironment] of Object.entries(saved.textureEnvironments || {})) {
        same(textureEnvironment.scale, [1, 1], `${label}:${slot}: unsupported nondefault texture scale`);
        same(textureEnvironment.offset, [0, 0], `${label}:${slot}: unsupported nondefault texture offset`);
        const sceneTexture = sceneMaterial.textures?.[slot];
        if (!textureEnvironment.texture) {
          check(sceneTexture == null, `${label}:${slot}: null official texture became a scene binding`);
          continue;
        }
        if (runtimeProducedSlots.has(slot)) {
          check(sceneTexture == null, `${label}:${slot}: runtime-produced texture became a static scene binding`);
          continue;
        }
        check(typeof sceneTexture?.url === "string", `${label}:${slot}: scene texture URL missing`);
        const manifestTexture = textureManifest.textures?.[sceneTexture?.url];
        check(Boolean(manifestTexture), `${label}:${slot}: texture URL is absent from official payload manifest`);
        if (manifestTexture) {
          const manifestIdentity = `${manifestTexture.identity?.cab}:${manifestTexture.identity?.pathId}`;
          check(manifestIdentity === textureEnvironment.texture.identity,
            `${label}:${slot}: texture CAB/pathID differs from official m_TexEnvs PPtr`);
        }
      }
    }
  }

  return { issues, propertyCounts };
}

const evidence = extractOfficialProperties();
const scenes = new Map((evidence.canonicalScenes || []).map(({ sceneFile }) => [sceneFile, readJson(`public/${sceneFile}`)]));
const textureManifest = readJson("public/texture-samplers.json");
const report = auditProperties(evidence, scenes, textureManifest);

const mutatedFloatScenes = structuredClone(scenes);
const firstScene = mutatedFloatScenes.values().next().value;
const firstMaterial = Object.values(firstScene.materials).find((material) => sortedKeys(material.floats).length);
const firstFloat = sortedKeys(firstMaterial.floats)[0];
firstMaterial.floats[firstFloat] += 0.25;
const floatMutation = auditProperties(evidence, mutatedFloatScenes, textureManifest, { checkPinned: false });
checkMutation(floatMutation, /float\/int saved properties mismatch/, "float mutation");

const mutatedTextureScenes = structuredClone(scenes);
const textureScene = [...mutatedTextureScenes.values()].find((scene) => Object.values(scene.materials)
  .some((material) => sortedKeys(material.textures).length));
const textureMaterial = Object.values(textureScene.materials).find((material) => sortedKeys(material.textures).length);
const textureSlot = sortedKeys(textureMaterial.textures)[0];
textureMaterial.textures[textureSlot].url = "/game/Assets/Texture2D/Card_Back.png";
const textureMutation = auditProperties(evidence, mutatedTextureScenes, textureManifest, { checkPinned: false });
checkMutation(textureMutation, /texture CAB\/pathID differs/, "texture mutation");

function checkMutation(mutation, pattern, label) {
  if (!mutation.issues.some((issue) => pattern.test(issue))) {
    throw new Error(`${label} was not rejected by the Material property audit`);
  }
}

if (report.issues.length) {
  console.error(`Official Material property audit failed: ${report.issues.length} issue(s)`);
  for (const issue of report.issues) console.error(`BAD ${issue}`);
  process.exitCode = 1;
} else {
  console.log("Official Material saved-property audit OK");
  console.log(`  rows/materials: ${EXPECTED.sceneRows}/${EXPECTED.uniqueMaterials}`);
  console.log(`  floats/colors:  ${report.propertyCounts.floats}/${report.propertyCounts.colors}`);
  console.log(`  textures:       ${report.propertyCounts.nonNullTextures} bound + ${report.propertyCounts.nullTextures} null`);
  console.log(`  texture ST:     ${report.propertyCounts.textureEnvironments}/${report.propertyCounts.textureEnvironments} serialized defaults`);
  console.log("  mutation tests: float value and texture PPtr rejected");
}
