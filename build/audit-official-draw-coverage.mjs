// Read-only coverage audit for every official Material draw in the four reference prefabs.
// It joins the official Renderer -> Material -> Shader extraction with scene recipes and
// active GLB primitives. No browser, render, screenshot, or repository write is involved.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { SHADER } from "../public/render/rarities.js";
import { loadExactShaderPortsFromContract } from "../public/render/exact-port-loader.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC = path.join(ROOT, "public");
const PYTHON = process.env.PYTHON || "python";
const DECRYPTED_ROOT = path.resolve(process.env.PCR_DECRYPTED_ROOT
  || "D:/DevProjectes/ptcgp-tools-master/masterdata_decoder/.output/decrypted");

const CATEGORY = Object.freeze({
  EXACT: "local-port-present",
  STENCIL: "Stencil-legal",
  GLITTER: "Glitter-single-RT-precompose",
  LENS_FLARE: "LensFlare-restored",
  SIDE_BACK: "Side&Back-deferred",
});
const CATEGORY_ORDER = Object.values(CATEGORY);

const EXPECTED_CARDS = Object.freeze({
  cPK_10_000040_00_FUSHIGIBANAex_RR: {
    meshRenderers: 23,
    materialReferences: 30,
  },
  cPK_20_008900_02_HOUOUex_UR: {
    meshRenderers: 18,
    materialReferences: 22,
  },
  cTR_20_000230_00_LEAF_SR: {
    meshRenderers: 18,
    materialReferences: 23,
  },
  cTR_20_000670_00_IIBUINOBAKKU_UR: {
    meshRenderers: 19,
    materialReferences: 23,
  },
});
const EXPECTED_TOTAL = Object.values(EXPECTED_CARDS)
  .reduce((sum, card) => sum + card.materialReferences, 0);

const PORT_CONTRACT = JSON.parse(fs.readFileSync(
  path.join(PUBLIC, "shaders", "official_program_port_contract.json"),
  "utf8",
));
if (PORT_CONTRACT.schema !== "pocket-card-render/official-program-port-contract@2") {
  throw new Error("unsupported official program port contract");
}

function filesystemResponse(body) {
  return {
    ok: true,
    async json() { return JSON.parse(body); },
    async text() { return body; },
  };
}

const exactShaders = await loadExactShaderPortsFromContract({
  fetchAsset: async (url) => {
    const file = path.join(PUBLIC, ...String(url).replaceAll("\\", "/").split("/"));
    return fs.existsSync(file)
      ? filesystemResponse(fs.readFileSync(file, "utf8"))
      : { ok: false };
  },
});
const FORMAL_PORT_KEYS = new Set(
  Object.entries(exactShaders)
    .filter(([, port]) => !port.stageSourceOnly)
    .map(([key]) => key),
);

const issues = [];

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function same(label, actual, expected) {
  if (stable(actual) !== stable(expected)) {
    issues.push(`${label}: expected ${stable(expected)}, got ${stable(actual)}`);
  }
}

function requireCondition(condition, label) {
  if (!condition) issues.push(label);
}

function sorted(values) {
  return [...values].sort((a, b) => String(a).localeCompare(String(b)));
}

function emptyCategoryCounts() {
  return Object.fromEntries(CATEGORY_ORDER.map((category) => [category, 0]));
}

function countCategories(draws) {
  const result = emptyCategoryCounts();
  for (const draw of draws) {
    if (Object.hasOwn(result, draw.category)) result[draw.category] += 1;
  }
  return { ...result, total: draws.length };
}

function increment(map, key, amount = 1) {
  map.set(key, (map.get(key) || 0) + amount);
}

function mapObject(map) {
  return Object.fromEntries(sorted(map.keys()).map((key) => [key, map.get(key)]));
}

function classifyShader(shader) {
  if (["IllustStencil", "InnerStencil", "OuterStencil"].includes(shader)) return CATEGORY.STENCIL;
  if (shader === "Card_UR_Glitter_FlowMaps") return CATEGORY.GLITTER;
  if (shader === "Card_UR_LensFlare") return CATEGORY.LENS_FLARE;
  if (shader === "Side&Back") return CATEGORY.SIDE_BACK;
  if (FORMAL_PORT_KEYS.has(shader)) return CATEGORY.EXACT;
  return null;
}

function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

function outputLocations(source) {
  const locations = new Set();
  const clean = stripComments(source);
  for (const match of clean.matchAll(/layout\s*\(\s*location\s*=\s*(\d+)\s*\)\s*out\b/g)) {
    locations.add(Number(match[1]));
  }
  return [...locations].sort((a, b) => a - b);
}

function sourceBlock(source, startMarker, endMarker, label) {
  const start = source.indexOf(startMarker);
  const end = start < 0 ? -1 : source.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0) {
    issues.push(`${label} source contract could not be located`);
    return "";
  }
  return source.slice(start, end);
}

function parseGlbDrawMaterials(file) {
  const data = fs.readFileSync(file);
  if (data.length < 20 || data.readUInt32LE(0) !== 0x46546c67) throw new Error("not a GLB file");
  if (data.readUInt32LE(4) !== 2) throw new Error(`unsupported GLB version ${data.readUInt32LE(4)}`);
  if (data.readUInt32LE(8) !== data.length) throw new Error("GLB declared length does not match file size");

  let offset = 12;
  let gltf = null;
  while (offset + 8 <= data.length) {
    const length = data.readUInt32LE(offset);
    const type = data.readUInt32LE(offset + 4);
    offset += 8;
    if (offset + length > data.length) throw new Error("GLB chunk extends past end of file");
    if (type === 0x4e4f534a) {
      if (gltf) throw new Error("GLB has multiple JSON chunks");
      const json = data.subarray(offset, offset + length).toString("utf8").replace(/\0+$/, "");
      gltf = JSON.parse(json);
    }
    offset += length;
  }
  if (!gltf) throw new Error("GLB JSON chunk is missing");

  const sceneIndex = Number.isInteger(gltf.scene) ? gltf.scene : 0;
  const roots = gltf.scenes?.[sceneIndex]?.nodes;
  if (!Array.isArray(roots)) throw new Error(`GLB scene ${sceneIndex} has no root nodes`);
  const materialNames = (gltf.materials || []).map((material) => material?.name || "");
  const visited = new Set();
  const active = new Set();
  const draws = [];

  function visit(nodeIndex) {
    if (!Number.isInteger(nodeIndex) || !gltf.nodes?.[nodeIndex]) throw new Error(`invalid node index ${nodeIndex}`);
    if (active.has(nodeIndex)) throw new Error(`node cycle at index ${nodeIndex}`);
    if (visited.has(nodeIndex)) throw new Error(`node ${nodeIndex} is referenced more than once`);
    active.add(nodeIndex);
    visited.add(nodeIndex);
    const node = gltf.nodes[nodeIndex];
    if (node.mesh !== undefined) {
      if (!Number.isInteger(node.mesh) || !gltf.meshes?.[node.mesh]) throw new Error(`invalid mesh index ${node.mesh}`);
      for (const [primitiveIndex, primitive] of (gltf.meshes[node.mesh].primitives || []).entries()) {
        if (!Number.isInteger(primitive.material) || !materialNames[primitive.material]) {
          throw new Error(`node ${nodeIndex} primitive ${primitiveIndex} has no named material`);
        }
        draws.push({
          node: node.name || `node:${nodeIndex}`,
          material: materialNames[primitive.material],
        });
      }
    }
    for (const child of node.children || []) visit(child);
    active.delete(nodeIndex);
  }

  for (const root of roots) visit(root);
  return draws;
}

function runOfficialExtractor() {
  const script = path.join(ROOT, "build", "extract_official_mrt_outputs.py");
  const stdout = execFileSync(PYTHON, [script, "--decrypted-root", DECRYPTED_ROOT], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    shell: process.platform === "win32",
  });
  return JSON.parse(stdout);
}

let evidence;
try {
  evidence = runOfficialExtractor();
} catch (error) {
  console.error(`BAD official MRT/prefab extractor failed: ${error.message}`);
  process.exit(1);
}

const expectedCardIds = Object.keys(EXPECTED_CARDS);
same("official prefab card set", sorted(evidence.source?.cards || []), sorted(expectedCardIds));
same("official Material draw total", evidence.summary?.materialReferences, EXPECTED_TOTAL);
same("official MeshRenderer total", evidence.summary?.meshRenderers, 78);

const cardEvidence = new Map((evidence.cards || []).map((card) => [card.card, card]));
for (const cardId of expectedCardIds) {
  const actual = cardEvidence.get(cardId);
  requireCondition(!!actual, `${cardId}: official prefab summary is missing`);
  if (!actual) continue;
  same(`${cardId}: official MeshRenderer count`, actual.meshRenderers, EXPECTED_CARDS[cardId].meshRenderers);
  same(`${cardId}: official Material draw count`, actual.materialReferences, EXPECTED_CARDS[cardId].materialReferences);
}
same("official prefab summary card set", sorted(cardEvidence.keys()), sorted(expectedCardIds));

const draws = [];
const officialExactShaders = new Set();
const drawKeys = new Set();
for (const variant of evidence.variants || []) {
  const shader = variant.shortShader;
  const category = classifyShader(shader);
  if (!category) issues.push(`unknown official shader category: ${shader} (${variant.key})`);
  else if (category === CATEGORY.EXACT) officialExactShaders.add(shader);

  const locations = sorted(new Set((variant.outputs || []).map((output) => Number(output.location))));
  same(
    `${variant.key}: official fragment output locations`,
    locations,
    category === CATEGORY.STENCIL ? [0] : [0, 1],
  );
  same(`${variant.key}: materialUseCount`, variant.materialUses?.length || 0, variant.materialUseCount);

  for (const use of variant.materialUses || []) {
    const drawKey = `${use.card}:${use.rendererPathId}:${use.materialSlot}`;
    if (drawKeys.has(drawKey)) issues.push(`duplicate official draw key: ${drawKey}`);
    drawKeys.add(drawKey);
    requireCondition(typeof use.material === "string" && use.material.length > 0, `${drawKey}: official material name is missing`);
    requireCondition(
      !!use.materialPPtr?.targetCab && !!use.materialPPtr?.pathId,
      `${drawKey}: official Renderer -> Material PPtr evidence is incomplete`,
    );
    draws.push({ ...use, shader, category, variant: variant.key });
  }
}
same("flattened official draw total", draws.length, EXPECTED_TOTAL);

const appSource = fs.readFileSync(path.join(PUBLIC, "app.js"), "utf8");
const sceneExactShaders = new Set();
for (const cardId of expectedCardIds) {
  const scene = JSON.parse(fs.readFileSync(path.join(PUBLIC, `scene.${cardId}.json`), "utf8"));
  for (const material of Object.values(scene.materials || {})) {
    if (classifyShader(material.shader) === CATEGORY.EXACT) sceneExactShaders.add(material.shader);
  }
}
same("official local-port shader set", sorted(officialExactShaders), sorted(sceneExactShaders));

  requireCondition(
    appSource.includes('import { loadExactShaderPortsFromContract } from "./render/exact-port-loader.js";')
      && /loadExactShaderPortsFromContract\(\{\s*exactEnabled,\s*canonicalizeObjectClipPosition:\s*!logicBisectCase\.disableCanonicalObjectClipPosition,\s*\}\)/.test(appSource),
    "app does not dispatch the generated official program port contract",
  );
requireCondition(
  !appSource.includes("loadExactShaderPorts({") && !/manifest:\s*"shaders\/[^"]+_uniforms\.json"/.test(appSource),
  "app still contains a parallel hand-maintained shader-port inventory",
);
for (const [shader, port] of Object.entries(exactShaders)) {
  const fragments = port.stageSourceOnly
    ? [port.frag]
    : Object.values(port.sourcesByPort).map((source) => source.frag);
  const expectedLocations = ["IllustStencil", "InnerStencil", "OuterStencil"].includes(shader)
    ? [0]
    : [0, 1];
  for (const [index, fragment] of fragments.entries()) {
    same(`${shader}[${index}]: local fragment output locations`, outputLocations(fragment), expectedLocations);
  }
}

requireCondition(
  /const isStencil = matName === "OuterStencil"\s*\|\| matName\.startsWith\("InnerStencil"\)\s*\|\| matName\.startsWith\("IllustStencil"\)/.test(appSource),
  "selector-bound stencil route is absent",
);
requireCondition(appSource.includes("stencilGroup.add(mesh)"), "stencil draw is not routed to the stencil group");
requireCondition(!appSource.includes("stencilWriter(region)"), "legacy MeshBasic stencil writer is still active");

same("Side&Back local-port kind", SHADER["Side&Back"]?.kind, "sideBack");
requireCondition(exactShaders["Side&Back"]?.stageSourceOnly === true,
  "Side&Back runtime boundary is not loaded from the official contract");
requireCondition(
  appSource.includes("fgGroup.add(mesh)") && !appSource.includes("isBackgroundLayer(r.shader, cfg, r)"),
  "official draws no longer route directly to the shared MRT scene",
);
requireCondition(!appSource.includes("bgRT = new THREE.WebGLRenderTarget"),
  "legacy single-target background precompose is still present");

const flareRestoreBlock = sourceBlock(
  appSource,
  "const unityQuad = new THREE.PlaneGeometry(1, 1);",
  "root.updateMatrixWorld(true);",
  "LensFlare built-in Quad restoration",
);
requireCondition(
  flareRestoreBlock.includes('recipe.shader !== "Card_UR_LensFlare"'),
  "LensFlare restoration is not gated by the official shader recipe",
);
requireCondition(
  flareRestoreBlock.includes("root.getObjectByName(recipe.go)"),
  "LensFlare restoration no longer consumes the serialized GameObject name",
);
requireCondition(
  flareRestoreBlock.includes("node.children.some((child) => child.isMesh)"),
  "LensFlare restoration does not defer to an exported mesh when present",
);
requireCondition(
  flareRestoreBlock.includes("proxyMaterial.name = matName"),
  "LensFlare restoration no longer routes the official Material recipe",
);

const drawsByCard = new Map(expectedCardIds.map((cardId) => [cardId, []]));
for (const draw of draws) {
  if (!drawsByCard.has(draw.card)) {
    issues.push(`official draw references an unexpected card: ${draw.card}`);
    continue;
  }
  drawsByCard.get(draw.card).push(draw);
}

const reportRows = [];
let localGlbDrawTotal = 0;
let defaultMaterialTotal = 0;
for (const cardId of expectedCardIds) {
  const cardDraws = drawsByCard.get(cardId);
  const actualCounts = countCategories(cardDraws);
  reportRows.push({ cardId, counts: actualCounts });

  const officialCounts = new Map();
  const expectedGlbCounts = new Map();
  const materialShaders = new Map();
  const materialCategories = new Map();
  for (const draw of cardDraws) {
    increment(officialCounts, draw.material);
    if (draw.category !== CATEGORY.LENS_FLARE) increment(expectedGlbCounts, draw.material);
    if (materialShaders.has(draw.material) && materialShaders.get(draw.material) !== draw.shader) {
      issues.push(`${cardId}: material ${draw.material} resolves to multiple official shaders`);
    }
    if (materialCategories.has(draw.material) && materialCategories.get(draw.material) !== draw.category) {
      issues.push(`${cardId}: material ${draw.material} resolves to multiple coverage categories`);
    }
    materialShaders.set(draw.material, draw.shader);
    materialCategories.set(draw.material, draw.category);
  }

  const sceneName = `scene.${cardId}.json`;
  const sceneFile = path.join(PUBLIC, sceneName);
  let scene;
  try {
    scene = JSON.parse(fs.readFileSync(sceneFile, "utf8"));
  } catch (error) {
    issues.push(`${cardId}: cannot read ${sceneName}: ${error.message}`);
    continue;
  }

  same(`${cardId}: scene card id`, scene.card?.id, cardId);
  const expectedGlbUrl = `/game/Assets/PrefabHierarchyObject/${cardId}_L.glb`;
  same(`${cardId}: scene prefab GLB`, scene.prefabGlb, expectedGlbUrl);

  const recipes = scene.materials && typeof scene.materials === "object" ? scene.materials : {};
  const expectedRecipeNames = sorted(officialCounts.keys());
  same(`${cardId}: scene recipe material set`, sorted(Object.keys(recipes)), expectedRecipeNames);
  for (const material of expectedRecipeNames) {
    same(`${cardId}:${material}: scene shader`, recipes[material]?.shader, materialShaders.get(material));
  }

  let glbDraws;
  try {
    glbDraws = parseGlbDrawMaterials(path.join(PUBLIC, expectedGlbUrl.slice(1)));
  } catch (error) {
    issues.push(`${cardId}: cannot inspect active GLB draws: ${error.message}`);
    continue;
  }
  const actualGlbCounts = new Map();
  for (const draw of glbDraws) {
    if (draw.material === "DefaultMaterial") {
      defaultMaterialTotal += 1;
      continue;
    }
    increment(actualGlbCounts, draw.material);
    localGlbDrawTotal += 1;
  }
  same(`${cardId}: active GLB official draw multiset`, mapObject(actualGlbCounts), mapObject(expectedGlbCounts));
}

const actualTotal = countCategories(draws);
same("classified official draw total", actualTotal.total, EXPECTED_TOTAL);
same("active GLB covered official draw total", localGlbDrawTotal, EXPECTED_TOTAL - actualTotal[CATEGORY.LENS_FLARE]);

const columns = [
  [CATEGORY.EXACT, "port"],
  [CATEGORY.STENCIL, "stencil"],
  [CATEGORY.GLITTER, "glitter"],
  [CATEGORY.LENS_FLARE, "lens-rest"],
  [CATEGORY.SIDE_BACK, "side/back"],
];
console.log("Official draw coverage by card (Material PPtrs)");
console.log(`${"card".padEnd(43)} ${columns.map(([, label]) => label.padStart(9)).join(" ")} ${"total".padStart(7)}`);
for (const row of reportRows) {
  const values = columns.map(([category]) => String(row.counts[category]).padStart(9)).join(" ");
  console.log(`${row.cardId.padEnd(43)} ${values} ${String(row.counts.total).padStart(7)}`);
}
const totalValues = columns.map(([category]) => String(actualTotal[category]).padStart(9)).join(" ");
console.log(`${"TOTAL".padEnd(43)} ${totalValues} ${String(actualTotal.total).padStart(7)}`);

if (issues.length) {
  for (const issue of issues) console.error(`BAD ${issue}`);
  console.error(`\n${issues.length} official draw coverage issue(s) found.`);
  process.exit(1);
}

console.log("Official draw coverage audit OK");
console.log(`Official chain: ${evidence.summary.meshRenderers} MeshRenderers, ${draws.length} Material draws, 0 unknown`);
console.log(`Local GLBs:     ${localGlbDrawTotal}/${draws.length} official draws; ${defaultMaterialTotal} DefaultMaterial export placeholders ignored`);
console.log(`Exceptions:     Stencil ${actualTotal[CATEGORY.STENCIL]} selector-bound, Glitter ${actualTotal[CATEGORY.GLITTER]} precomposed`);
console.log(`Local ports:    ${actualTotal[CATEGORY.EXACT]} formal-port draws; LensFlare ${actualTotal[CATEGORY.LENS_FLARE]} built-in Quad draws`);
console.log(`Runtime bound:  Side&Back ${actualTotal[CATEGORY.SIDE_BACK]} stage-source-only draws`);
console.log("Exact closure:  see audit-official-program-port-coverage.mjs; this inventory audit grants no exact verdict");
console.log("Deferred/gaps:  none across the four reference prefabs");
