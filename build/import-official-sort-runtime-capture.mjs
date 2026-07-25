import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

export const CAPTURE_SCHEMA = "pocket-card-render/official-sort-runtime-capture@1";
export const IMPORT_SCHEMA = "pocket-card-render/official-sort-import@1";
export const CAPTURE_PREFIX = "PCR_SORT_CAPTURE ";

export const EXPECTED_RELEASE = Object.freeze({
  packageName: "jp.pokemon.pokemontcgp",
  versionName: "1.6.0",
  versionCode: 293311,
  apkmSha256: "9b7f9067e00a54f342bd4f17e669ceeb86b80bb7d34ff2d0d0fe82050a62f201",
  libunitySha256: "43a04223f94b6ca0c7cf128b399fe0656c57b5a18a10bf21bb9ce27aeb219722",
  instructionChecks: 6,
});

function fail(message) {
  throw new Error(`official sort capture import: ${message}`);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireRecord(value, label) {
  if (!isRecord(value)) fail(`${label} must be an object`);
  return value;
}

function requireString(value, label) {
  if (typeof value !== "string" || value.length === 0) fail(`${label} must be a non-empty string`);
  return value;
}

function requireExactString(value, expected, label) {
  if (value !== expected) fail(`${label} must equal ${JSON.stringify(expected)}, got ${JSON.stringify(value)}`);
  return value;
}

function requireInteger(value, minimum, maximum, label) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    fail(`${label} must be an integer in [${minimum}, ${maximum}], got ${JSON.stringify(value)}`);
  }
  return value;
}

function requireU8(value, label) {
  return requireInteger(value, 0, 0xff, label);
}

function requireU16(value, label) {
  return requireInteger(value, 0, 0xffff, label);
}

function requireU32(value, label) {
  return requireInteger(value, 0, 0xffffffff, label);
}

function requireI32(value, label) {
  return requireInteger(value, -0x80000000, 0x7fffffff, label);
}

function inputBuffer(value, label) {
  if (Buffer.isBuffer(value)) return value;
  if (typeof value === "string") return Buffer.from(value, "utf8");
  fail(`${label} must be a string or Buffer so its SHA256 is reproducible`);
}

function decodeUtf8(buffer, label) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch (error) {
    fail(`${label} is not valid UTF-8: ${error.message}`);
  }
}

export function sha256Hex(value) {
  return createHash("sha256").update(inputBuffer(value, "hash input")).digest("hex");
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

function stableJson(value) {
  return JSON.stringify(stableValue(value));
}

function sameValue(actual, expected, label) {
  if (actual !== expected) {
    fail(`${label} mismatch: capture=${JSON.stringify(actual)}, scene/derived=${JSON.stringify(expected)}`);
  }
}

export function computeOfficialStateKey({
  baseLow16,
  materialSortByte17c,
  localKeywordHash,
  shaderObjectInstanceId,
}) {
  requireU16(baseLow16, "state formula baseLow16");
  requireU8(materialSortByte17c, "state formula materialSortByte17c");
  requireU32(localKeywordHash, "state formula localKeywordHash");
  requireI32(shaderObjectInstanceId, "state formula shaderObjectInstanceId");
  return (baseLow16
    | (materialSortByte17c << 16)
    | (((localKeywordHash ^ shaderObjectInstanceId) & 0xff) << 24)) >>> 0;
}

export function computeOfficialEntry28({ meshSmallMeshId, staticBatchFirstSubMesh, materialSlot }) {
  requireU32(meshSmallMeshId, "entry28 formula meshSmallMeshId");
  requireU16(staticBatchFirstSubMesh, "entry28 formula staticBatchFirstSubMesh");
  requireU16(materialSlot, "entry28 formula materialSlot");
  return ((((meshSmallMeshId & 0xffff) << 16)
    | ((staticBatchFirstSubMesh + materialSlot) & 0xffff)) >>> 0);
}

export function parseCaptureJsonl(captureInput) {
  const bytes = inputBuffer(captureInput, "capture log");
  const text = decodeUtf8(bytes, "capture log");
  const rows = [];

  for (const [index, rawLine] of text.split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    if (!line) continue;
    if (!line.startsWith(CAPTURE_PREFIX)) continue;
    const payload = line.slice(CAPTURE_PREFIX.length);
    let row;
    try {
      row = JSON.parse(payload);
    } catch (error) {
      fail(`line ${index + 1} has invalid JSON: ${error.message}`);
    }
    requireRecord(row, `line ${index + 1}`);
    rows.push({ ...row, _captureLine: index + 1 });
  }

  if (rows.length === 0) fail(`capture log contains no ${CAPTURE_PREFIX.trim()} rows`);
  const manifests = rows.filter((row) => row.type === "manifest");
  if (manifests.length !== 1) fail(`capture log must contain exactly one manifest, found ${manifests.length}`);

  const manifest = manifests[0];
  const sessionId = requireString(manifest.sessionId, `line ${manifest._captureLine} manifest.sessionId`);
  for (const row of rows) {
    requireExactString(row.schema, CAPTURE_SCHEMA, `line ${row._captureLine} schema`);
    requireExactString(row.sessionId, sessionId, `line ${row._captureLine} sessionId`);
  }

  return { bytes, rows, manifest, sessionId };
}

function validateManifest(manifest) {
  const packageState = requireRecord(manifest.package, "manifest.package");
  requireExactString(packageState.name, EXPECTED_RELEASE.packageName, "manifest.package.name");
  requireExactString(packageState.versionName, EXPECTED_RELEASE.versionName, "manifest.package.versionName");
  sameValue(packageState.versionCode, EXPECTED_RELEASE.versionCode, "manifest.package.versionCode");
  requireExactString(packageState.apkmSha256, EXPECTED_RELEASE.apkmSha256, "manifest.package.apkmSha256");
  requireExactString(packageState.libunitySha256, EXPECTED_RELEASE.libunitySha256,
    "manifest.package.libunitySha256");
  sameValue(manifest.instructionChecks, EXPECTED_RELEASE.instructionChecks, "manifest.instructionChecks");
  const moduleBase = requireString(manifest.moduleBase, "manifest.moduleBase");
  if (!/^0x[0-9a-f]+$/i.test(moduleBase)) fail(`manifest.moduleBase must be a hexadecimal pointer, got ${JSON.stringify(moduleBase)}`);
  const startedAtUnixMs = requireInteger(manifest.startedAtUnixMs, 0, Number.MAX_SAFE_INTEGER,
    "manifest.startedAtUnixMs");
  const processId = requireInteger(manifest.processId, 1, 0xffffffff, "manifest.processId");
  requireExactString(manifest.sessionId,
    `${EXPECTED_RELEASE.versionCode}:${processId}:${startedAtUnixMs}:${moduleBase}`,
    "manifest.sessionId");
}

function parseScene(sceneInput) {
  const bytes = inputBuffer(sceneInput, "scene JSON");
  const text = decodeUtf8(bytes, "scene JSON");
  let scene;
  try {
    scene = JSON.parse(text);
  } catch (error) {
    fail(`scene JSON is invalid: ${error.message}`);
  }
  requireRecord(scene, "scene root");
  sameValue(scene.officialDrawSchemaVersion, 2, "scene.officialDrawSchemaVersion");
  const card = requireRecord(scene.card, "scene.card");
  requireString(card.id, "scene.card.id");
  const materials = requireRecord(scene.materials, "scene.materials");
  if (!Array.isArray(scene.officialDraws)) fail("scene.officialDraws must be an array");

  const officialDrawsByMaterial = new Map();
  const seenDrawIds = new Set();
  for (const [index, drawValue] of scene.officialDraws.entries()) {
    const draw = requireRecord(drawValue, `scene.officialDraws[${index}]`);
    const drawId = requireString(draw.drawId, `scene.officialDraws[${index}].drawId`);
    requireString(draw.goPath, `scene.officialDraws[${index}].goPath`);
    if (seenDrawIds.has(drawId)) fail(`scene has duplicate drawId ${JSON.stringify(drawId)}`);
    seenDrawIds.add(drawId);
    const materialName = requireString(draw.materialName, `scene.officialDraws[${index}].materialName`);
    const material = materials[materialName];
    if (!isRecord(material)) fail(`scene official draw references unknown material ${JSON.stringify(materialName)}`);
    const official = requireRecord(material.official, `scene.materials[${JSON.stringify(materialName)}].official`);
    requireExactString(draw.materialIdentity, requireString(official.material,
      `scene.materials[${JSON.stringify(materialName)}].official.material`),
    `scene.officialDraws[${index}].materialIdentity`);
    requireExactString(draw.shaderIdentity, requireString(official.shader,
      `scene.materials[${JSON.stringify(materialName)}].official.shader`),
    `scene.officialDraws[${index}].shaderIdentity`);
    if (!officialDrawsByMaterial.has(materialName)) officialDrawsByMaterial.set(materialName, []);
    officialDrawsByMaterial.get(materialName).push(draw);
  }

  return { bytes, scene, card, materials, officialDrawsByMaterial };
}

function registerNamedObject(row, kind, byId, byName) {
  const line = row._captureLine;
  const name = requireString(row.name, `line ${line} ${kind}.name`);
  const instanceId = requireI32(row.instanceId, `line ${line} ${kind}.instanceId`);
  sameValue(requireU8(row.instanceIdLow8, `line ${line} ${kind}.instanceIdLow8`),
    instanceId & 0xff, `line ${line} ${kind}.instanceIdLow8`);

  const previousName = byId.get(instanceId);
  if (previousName !== undefined && previousName !== name) {
    fail(`${kind} instanceId ${instanceId} has conflicting exact names ${JSON.stringify(previousName)} and ${JSON.stringify(name)}`);
  }
  byId.set(instanceId, name);
  if (!byName.has(name)) byName.set(name, new Set());
  byName.get(name).add(instanceId);
}

function normalizedDraw(row, sceneState, registries) {
  const line = row._captureLine;
  const materialName = requireString(row.materialName, `line ${line} draw.materialName`);
  const hasExactMaterial = Object.hasOwn(sceneState.materials, materialName);
  const material = hasExactMaterial ? sceneState.materials[materialName] : undefined;
  if (!hasExactMaterial || !isRecord(material)) {
    fail(`line ${line} draw.materialName ${JSON.stringify(materialName)} is not an exact scene.materials key`);
  }
  const shaderName = requireString(row.shaderName, `line ${line} draw.shaderName`);
  requireExactString(shaderName, requireString(material.shader,
    `scene.materials[${JSON.stringify(materialName)}].shader`), `line ${line} draw.shaderName`);

  const materialRegistryIds = registries.materialByName.get(materialName);
  if (!materialRegistryIds?.size) {
    fail(`line ${line} draw.materialName ${JSON.stringify(materialName)} has no exact material registry row`);
  }
  const shaderObjectInstanceId = requireI32(row.shaderObjectInstanceId,
    `line ${line} draw.shaderObjectInstanceId`);
  sameValue(requireU8(row.shaderObjectInstanceIdLow8,
    `line ${line} draw.shaderObjectInstanceIdLow8`), shaderObjectInstanceId & 0xff,
  `line ${line} draw.shaderObjectInstanceIdLow8`);
  requireExactString(registries.shaderById.get(shaderObjectInstanceId), shaderName,
    `line ${line} shader registry name for instanceId ${shaderObjectInstanceId}`);

  const sort = requireRecord(material.sort, `scene.materials[${JSON.stringify(materialName)}].sort`);
  const official = requireRecord(material.official, `scene.materials[${JSON.stringify(materialName)}].official`);
  const localKeywordHash = requireU32(row.localKeywordHash, `line ${line} draw.localKeywordHash`);
  sameValue(localKeywordHash, requireU32(sort.serializedLocalKeywordHash,
    `scene.materials[${JSON.stringify(materialName)}].sort.serializedLocalKeywordHash`),
  `line ${line} draw.localKeywordHash`);
  if (row.localKeywordHashLow8 !== undefined) {
    sameValue(requireU8(row.localKeywordHashLow8, `line ${line} draw.localKeywordHashLow8`),
      localKeywordHash & 0xff, `line ${line} draw.localKeywordHashLow8`);
  }

  const materialSlot = requireInteger(row.materialSlot, 0, 0x7fff, `line ${line} draw.materialSlot`);
  sameValue(materialSlot, requireInteger(sort.materialSlot, 0, 0x7fff,
    `scene.materials[${JSON.stringify(materialName)}].sort.materialSlot`),
  `line ${line} draw.materialSlot`);
  const srpBatcherCompatible = requireInteger(row.srpBatcherCompatible, 0, 1,
    `line ${line} draw.srpBatcherCompatible`);
  sameValue(srpBatcherCompatible, requireInteger(sort.srpBatcherCompatible, 0, 1,
    `scene.materials[${JSON.stringify(materialName)}].sort.srpBatcherCompatible`),
  `line ${line} draw.srpBatcherCompatible`);

  const packedMaterialSlotAndSrp = requireU16(row.packedMaterialSlotAndSrp,
    `line ${line} draw.packedMaterialSlotAndSrp`);
  sameValue(packedMaterialSlotAndSrp, (materialSlot << 1) | srpBatcherCompatible,
    `line ${line} draw.packedMaterialSlotAndSrp`);
  const staticBatchFirstSubMesh = requireU16(row.staticBatchFirstSubMesh,
    `line ${line} draw.staticBatchFirstSubMesh`);
  sameValue(staticBatchFirstSubMesh, requireU16(sort.staticBatchFirstSubMesh,
    `scene.materials[${JSON.stringify(materialName)}].sort.staticBatchFirstSubMesh`),
  `line ${line} draw.staticBatchFirstSubMesh`);
  const staticBatchSubMeshCount = requireU16(row.staticBatchSubMeshCount,
    `line ${line} draw.staticBatchSubMeshCount`);
  sameValue(staticBatchSubMeshCount, requireU16(sort.staticBatchSubMeshCount,
    `scene.materials[${JSON.stringify(materialName)}].sort.staticBatchSubMeshCount`),
  `line ${line} draw.staticBatchSubMeshCount`);
  const packedLightmapIndices = requireU32(row.packedLightmapIndices,
    `line ${line} draw.packedLightmapIndices`);
  sameValue(packedLightmapIndices, requireU32(sort.packedLightmapIndices,
    `scene.materials[${JSON.stringify(materialName)}].sort.packedLightmapIndices`),
  `line ${line} draw.packedLightmapIndices`);
  const rendererTypeValue = requireInteger(sort.rendererTypeValue, 0, 0x3f,
    `scene.materials[${JSON.stringify(materialName)}].sort.rendererTypeValue`);
  const lodFadeHighByte = requireU8(sort.lodFadeHighByte,
    `scene.materials[${JSON.stringify(materialName)}].sort.lodFadeHighByte`);
  const canvasOrder = requireU16(sort.canvasOrder,
    `scene.materials[${JSON.stringify(materialName)}].sort.canvasOrder`);

  const materialSortByte17c = requireU8(row.materialSortByte17c,
    `line ${line} draw.materialSortByte17c`);
  const baseLow16 = requireU16(row.baseLow16, `line ${line} draw.baseLow16`);
  const stateKey = requireU32(row.stateKey, `line ${line} draw.stateKey`);
  sameValue(stateKey, computeOfficialStateKey({
    baseLow16,
    materialSortByte17c,
    localKeywordHash,
    shaderObjectInstanceId,
  }), `line ${line} draw.stateKey`);

  const meshSmallMeshId = requireU32(row.meshSmallMeshId, `line ${line} draw.meshSmallMeshId`);
  const entry28 = requireU32(row.entry28, `line ${line} draw.entry28`);
  sameValue(entry28, computeOfficialEntry28({ meshSmallMeshId, staticBatchFirstSubMesh, materialSlot }),
    `line ${line} draw.entry28`);
  const visibleNodeIndex = requireU32(row.visibleNodeIndex, `line ${line} draw.visibleNodeIndex`);
  const drawCandidateOrdinal = requireU32(row.drawCandidateOrdinal,
    `line ${line} draw.drawCandidateOrdinal`);

  const candidates = sceneState.officialDrawsByMaterial.get(materialName) || [];
  if (candidates.length === 0) {
    fail(`line ${line} material ${JSON.stringify(materialName)} has no scene.officialDraws candidate`);
  }
  for (const candidate of candidates) {
    sameValue(candidate.materialSlot, materialSlot,
      `line ${line} candidate ${JSON.stringify(candidate.drawId)} materialSlot`);
    requireExactString(candidate.materialIdentity, official.material,
      `line ${line} candidate ${JSON.stringify(candidate.drawId)} materialIdentity`);
    requireExactString(candidate.shaderIdentity, official.shader,
      `line ${line} candidate ${JSON.stringify(candidate.drawId)} shaderIdentity`);
  }

  const stateTuple = [official.material, official.shader, localKeywordHash, baseLow16];
  const stateRef = `state:${createHash("sha256").update(JSON.stringify(stateTuple)).digest("hex")}`;
  return {
    line,
    stateRef,
    state: {
      materialIdentity: official.material,
      shaderIdentity: official.shader,
      materialName,
      shaderName,
      materialSortByte17c,
      shaderObjectInstanceId,
      shaderObjectInstanceIdLow8: shaderObjectInstanceId & 0xff,
      localKeywordHash,
      baseLow16,
      stateKey,
      entry08: stateKey,
      drawIds: [],
      candidateDrawIds: [],
    },
    descriptor: {
      stateRef,
      materialName,
      materialSlot,
      srpBatcherCompatible,
      rendererTypeValue,
      lodFadeHighByte,
      packedMaterialSlotAndSrp,
      staticBatchFirstSubMesh,
      staticBatchSubMeshCount,
      packedLightmapIndices,
      stateKey,
      entry28,
      canvasOrder,
      visibleNodeIndex,
      meshSmallMeshId,
      drawCandidateOrdinal,
    },
    candidateDrawIds: candidates.map((candidate) => candidate.drawId),
  };
}

export function importOfficialSortRuntimeCapture(captureInput, sceneInput) {
  const capture = parseCaptureJsonl(captureInput);
  validateManifest(capture.manifest);
  const sceneState = parseScene(sceneInput);

  const registries = {
    materialById: new Map(),
    materialByName: new Map(),
    shaderById: new Map(),
    shaderByName: new Map(),
  };
  const drawRows = [];
  for (const row of capture.rows) {
    if (row.type === "manifest") continue;
    if (row.type === "material") {
      registerNamedObject(row, "material", registries.materialById, registries.materialByName);
    } else if (row.type === "shader") {
      registerNamedObject(row, "shader", registries.shaderById, registries.shaderByName);
    } else if (row.type === "draw") {
      drawRows.push(row);
    } else {
      fail(`line ${row._captureLine} has unsupported row type ${JSON.stringify(row.type)}`);
    }
  }
  if (drawRows.length === 0) fail("capture session contains no draw rows");

  const matchingDrawRows = drawRows.filter((row) => (
    typeof row.materialName === "string" && Object.hasOwn(sceneState.materials, row.materialName)
  ));
  if (matchingDrawRows.length === 0) {
    fail("capture session contains no draw rows with exact scene material names");
  }
  const normalized = matchingDrawRows.map((row) => normalizedDraw(row, sceneState, registries));
  const states = {};
  const draws = {};
  const unresolved = [];
  const unresolvedDedupe = new Map();

  for (const item of normalized) {
    const existingState = states[item.stateRef];
    if (existingState) {
      const comparableExisting = { ...existingState, drawIds: [], candidateDrawIds: [] };
      if (stableJson(comparableExisting) !== stableJson(item.state)) {
        fail(`state ${item.stateRef} has duplicate conflicting runtime values at line ${item.line}`);
      }
    } else {
      states[item.stateRef] = item.state;
    }
    const state = states[item.stateRef];

    if (item.candidateDrawIds.length === 1) {
      const drawId = item.candidateDrawIds[0];
      const descriptor = { ...item.descriptor, drawId };
      if (draws[drawId] && stableJson(draws[drawId]) !== stableJson(descriptor)) {
        fail(`drawId ${JSON.stringify(drawId)} has duplicate conflicting runtime values at line ${item.line}`);
      }
      draws[drawId] = descriptor;
      if (!state.drawIds.includes(drawId)) state.drawIds.push(drawId);
      continue;
    }

    const descriptor = { ...item.descriptor, candidateDrawIds: [...item.candidateDrawIds] };
    const dedupeKey = stableJson(descriptor);
    let drawRef = unresolvedDedupe.get(dedupeKey);
    if (!drawRef) {
      drawRef = `unresolved:${String(unresolvedDedupe.size + 1).padStart(6, "0")}`;
      unresolvedDedupe.set(dedupeKey, drawRef);
      draws[drawRef] = descriptor;
      unresolved.push({
        drawRef,
        reason: "multiple-official-draw-candidates-for-exact-material-name",
        materialName: descriptor.materialName,
        candidateDrawIds: [...descriptor.candidateDrawIds],
      });
    }
    for (const candidateDrawId of item.candidateDrawIds) {
      if (!state.candidateDrawIds.includes(candidateDrawId)) state.candidateDrawIds.push(candidateDrawId);
    }
  }

  for (const state of Object.values(states)) {
    state.drawIds.sort();
    state.candidateDrawIds.sort();
  }

  const capturedMaterials = new Set(normalized.map((item) => item.descriptor.materialName));
  for (const [materialName, candidates] of sceneState.officialDrawsByMaterial) {
    if (capturedMaterials.has(materialName)) continue;
    unresolved.push({
      reason: "no-captured-draw-for-exact-scene-material",
      materialName,
      candidateDrawIds: candidates.map((candidate) => candidate.drawId).sort(),
    });
  }

  return {
    schema: IMPORT_SCHEMA,
    source: {
      packageName: EXPECTED_RELEASE.packageName,
      packageVersion: EXPECTED_RELEASE.versionName,
      packageVersionCode: EXPECTED_RELEASE.versionCode,
      apkmSha256: EXPECTED_RELEASE.apkmSha256,
      libunitySha256: EXPECTED_RELEASE.libunitySha256,
      sessionId: capture.sessionId,
      cardId: sceneState.card.id,
      captureSha256: sha256Hex(capture.bytes),
      sceneSha256: sha256Hex(sceneState.bytes),
      capturedDrawRows: matchingDrawRows.length,
      ignoredOutsideSceneDrawRows: drawRows.length - matchingDrawRows.length,
    },
    states,
    draws,
    unresolved,
  };
}

function main(argv) {
  if (argv.length !== 3) {
    console.error("Usage: node build/import-official-sort-runtime-capture.mjs <capture.log> <scene.json> <output.json>");
    process.exitCode = 2;
    return;
  }
  const [capturePath, scenePath, outputPath] = argv.map((value) => path.resolve(value));
  const output = importOfficialSortRuntimeCapture(fs.readFileSync(capturePath), fs.readFileSync(scenePath));
  fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  console.log(`official sort runtime import: ${Object.keys(output.states).length} states, ${Object.keys(output.draws).length} draws, ${output.unresolved.length} unresolved`);
  console.log(`wrote ${outputPath}`);
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  }
}
