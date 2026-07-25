// Verify scene sort descriptors against independently decoded official prefab bytes.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { OFFICIAL_RENDERER_TYPE } from "../public/render/official-draw-order.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PYTHON = process.env.PYTHON || "python";
const EXPECTED = {
  cPK_10_000040_00_FUSHIGIBANAex_RR: {
    bundle: [1837057, "5cd3dfd1fa5514f106cb575bbcf17344f4cc87dda51cf5fc6f1bfd20b004b560"],
    renderers: [23, 30, "a844d62e527e6b74c68af8e8d4fcc22645f07ab43e191874cb09f583ec74dfec"],
    meshes: 7,
  },
  cTR_20_000230_00_LEAF_SR: {
    bundle: [1476442, "97e131723201ba98d18224d3efc5ea4c95e6f307c08cfc875b2d7d3b032e8dca"],
    renderers: [18, 23, "9a06e2bcf18c5dc7f474cb197b5cf05015c5130cbe8d544402757903892f091d"],
    meshes: 7,
  },
  cTR_20_000670_00_IIBUINOBAKKU_UR: {
    bundle: [981664, "737840d2d8dd532793d758b92c15efa75caad968603fcd99b936107ffe922ce5"],
    renderers: [19, 23, "d29ce5186363128b9502622bdf8efedf43e950575d103404683caee8e2819ea0"],
    meshes: 9,
  },
  cPK_20_008900_02_HOUOUex_UR: {
    bundle: [1074403, "e960197906b1d192c5426c4bc280cba670b94d04a74a900807a021ada5981ee2"],
    renderers: [18, 22, "2597e3f91e2f3a7ce8b34df8aa8035efcd116f1d7a2d22ce2098075d46b87fd3"],
    meshes: 9,
  },
};

const args = ["build/extract_official_reference_sort_inputs.py"];
if (process.env.PCR_DECRYPTED_ROOT) {
  args.push("--decrypted-root", process.env.PCR_DECRYPTED_ROOT);
}
const extracted = spawnSync(PYTHON, args, {
  cwd: ROOT,
  env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
  encoding: "utf8",
  maxBuffer: 16 * 1024 * 1024,
  shell: process.platform === "win32",
});
if (extracted.status !== 0) {
  throw new Error((extracted.stderr || extracted.stdout || "sort-input extractor failed").trim());
}

const evidence = JSON.parse(extracted.stdout.replace(/^\uFEFF/, ""));
assert.equal(evidence.schemaVersion, 5);
assert.equal(evidence.unityVersion, "2022.3.62f2");
assert.equal(evidence.distinctMeshIdentityCount, 18, "cross-card Mesh identity classes");

let rendererCount = 0;
let sceneMaterialCount = 0;
let sceneDrawCount = 0;
const uniqueSceneMaterials = new Map();
const uniqueSceneShaders = new Set();
const uniqueShaderKeywordSpaces = new Map();
for (const [cardId, expected] of Object.entries(EXPECTED)) {
  const card = evidence.cards[cardId];
  assert.ok(card, `${cardId}: official prefab evidence missing`);
  assert.deepEqual(
    [card.bundle.byteSize, card.bundle.sha256],
    expected.bundle,
    `${cardId}: official L prefab bundle drifted`,
  );
  assert.deepEqual(
    [card.rendererCount, card.materialReferenceCount, card.rendererAggregateSha256],
    expected.renderers,
    `${cardId}: official renderer objects drifted`,
  );
  assert.equal(card.lodGroupCount, 0, `${cardId}: LODGroup count`);
  assert.equal(card.distinctMeshIdentityCount, expected.meshes, `${cardId}: Mesh identity classes`);

  for (const renderer of card.renderers) {
    assert.equal(renderer.rendererType, "MeshRenderer", `${cardId}:${renderer.pathId}`);
    assert.ok(renderer.gameObjectName, `${cardId}:${renderer.pathId} GameObject name`);
    assert.equal(renderer.identity?.pathId, renderer.pathId, `${cardId}:${renderer.pathId} renderer identity path`);
    assert.equal(typeof renderer.identity?.source, "string", `${cardId}:${renderer.pathId} renderer identity source`);
    assert.equal(renderer.identity?.identity, `${renderer.identity.source}:${renderer.pathId}`,
      `${cardId}:${renderer.pathId} renderer identity`);
    assert.ok(renderer.mesh?.identity, `${cardId}:${renderer.pathId} Mesh identity`);
    assert.equal(renderer.materials.length, renderer.materialReferenceCount,
      `${cardId}:${renderer.pathId} Material PPtr identities`);
    assert.ok(renderer.materials.every((material) => material.identity),
      `${cardId}:${renderer.pathId} Material identity`);
    assert.equal(renderer.rendererPriority, 0, `${cardId}:${renderer.pathId} rendererPriority`);
    assert.equal(renderer.renderingLayerMask, 1, `${cardId}:${renderer.pathId} renderingLayerMask`);
    assert.equal(renderer.sortingLayerId, 0, `${cardId}:${renderer.pathId} sortingLayerId`);
    assert.equal(renderer.sortingLayerValue, 0, `${cardId}:${renderer.pathId} sortingLayerValue`);
    assert.equal(renderer.sortingOrder, 0, `${cardId}:${renderer.pathId} sortingOrder`);
    assert.equal(renderer.sortingFudgePresent, false, `${cardId}:${renderer.pathId} sortingFudge field`);
    assert.equal(renderer.sortingFudge, null, `${cardId}:${renderer.pathId} sortingFudge value`);
    assert.equal(renderer.lightmapIndex, 0xffff, `${cardId}:${renderer.pathId} static lightmap index`);
    assert.equal(renderer.lightmapIndexDynamic, 0xffff, `${cardId}:${renderer.pathId} dynamic lightmap index`);
    assert.deepEqual(renderer.staticBatchInfo, { firstSubMesh: 0, subMeshCount: 0 },
      `${cardId}:${renderer.pathId} static batch info`);
    assert.equal(renderer.staticBatchRootPathId, "0", `${cardId}:${renderer.pathId} static batch root`);
    assert.equal(renderer.staticShadowCaster, 0, `${cardId}:${renderer.pathId} static shadow caster`);
  }
  rendererCount += card.rendererCount;

  const scenePath = path.join(ROOT, "public", `scene.${cardId}.json`);
  const scene = JSON.parse(fs.readFileSync(scenePath, "utf8"));
  const renderersByIdentity = new Map(card.renderers.map((renderer) => [renderer.identity.identity, renderer]));
  assert.equal(scene.officialDrawSchemaVersion, 2, `${cardId}: official draw schema`);
  assert.equal(scene.officialDraws.length, expected.renderers[1],
    `${cardId}: every official material slot must remain in scene draws`);
  for (const [drawIndex, draw] of scene.officialDraws.entries()) {
    const renderer = renderersByIdentity.get(draw.rendererIdentity);
    assert.ok(renderer, `${cardId}:draw${drawIndex} renderer ${draw.rendererIdentity} is absent from the official prefab`);
    assert.equal(draw.drawId, `${draw.rendererIdentity}#${draw.materialSlot}`,
      `${cardId}:draw${drawIndex} stable draw ID`);
    assert.equal(draw.go, renderer.gameObjectName, `${cardId}:draw${drawIndex} GameObject`);
    assert.equal(typeof draw.goPath, "string", `${cardId}:draw${drawIndex} GameObject path type`);
    assert.ok(draw.goPath.endsWith(`/${renderer.gameObjectName}`),
      `${cardId}:draw${drawIndex} GameObject path suffix`);
    assert.equal(draw.meshIdentity, renderer.mesh.identity, `${cardId}:draw${drawIndex} Mesh identity`);
    assert.ok(Number.isInteger(draw.materialSlot) && draw.materialSlot >= 0,
      `${cardId}:draw${drawIndex} material slot`);
    assert.equal(draw.materialIdentity, renderer.materials[draw.materialSlot]?.identity,
      `${cardId}:draw${drawIndex} Material PPtr identity`);
    assert.equal(scene.materials[draw.materialName]?.official?.material, draw.materialIdentity,
      `${cardId}:draw${drawIndex} scene Material identity`);
    assert.equal(scene.materials[draw.materialName]?.official?.shader, draw.shaderIdentity,
      `${cardId}:draw${drawIndex} scene Shader identity`);
    sceneDrawCount += 1;
  }
  for (const [materialName, material] of Object.entries(scene.materials)) {
    const sort = material.sort;
    assert.equal(sort.rendererType, "MeshRenderer", `${cardId}:${materialName} renderer type`);
    assert.equal(sort.rendererTypeValue, OFFICIAL_RENDERER_TYPE.MeshRenderer,
      `${cardId}:${materialName} native renderer type`);
    assert.equal(sort.rendererPriority, 0, `${cardId}:${materialName} renderer priority`);
    assert.ok(Number.isInteger(sort.materialSlot) && sort.materialSlot >= 0,
      `${cardId}:${materialName} material slot`);
    assert.equal(sort.staticBatchFirstSubMesh, 0, `${cardId}:${materialName} static first submesh`);
    assert.equal(sort.staticBatchSubMeshCount, 0, `${cardId}:${materialName} static submesh count`);
    assert.equal(sort.lightmapIndex, 0xffff, `${cardId}:${materialName} static lightmap index`);
    assert.equal(sort.lightmapIndexDynamic, 0xffff, `${cardId}:${materialName} dynamic lightmap index`);
    assert.equal(sort.packedLightmapIndices, 0xffffffff, `${cardId}:${materialName} packed lightmap indices`);
    assert.equal(sort.lodFadeHighByte, 0, `${cardId}:${materialName} LOD fade high byte`);
    assert.equal(sort.lodFadeSource, "non-LODGroup-native-default", `${cardId}:${materialName} LOD fade source`);
    assert.equal(sort.sortingGroupId, 0xfffff, `${cardId}:${materialName} SortingGroup ID`);
    assert.equal(sort.sortingGroupOrder, 0, `${cardId}:${materialName} SortingGroup order`);
    assert.equal(sort.sortingGroupKey, 0xfffff000, `${cardId}:${materialName} SortingGroup key`);
    assert.equal(sort.sortingGroupSource, "no-SortingGroup-native-default",
      `${cardId}:${materialName} SortingGroup source`);
    assert.equal(sort.canvasOrder, 0, `${cardId}:${materialName} canvas order`);
    assert.equal(sort.sortingLayerId, 0, `${cardId}:${materialName} sorting layer id`);
    assert.equal(sort.sortingLayerValue, 0, `${cardId}:${materialName} sorting layer value`);
    assert.equal(sort.sortingOrder, 0, `${cardId}:${materialName} sorting order`);
    assert.equal(sort.distanceOffset, 0, `${cardId}:${materialName} distance offset`);
    assert.equal(sort.distanceOffsetSource, "MeshRenderer-native-zero",
      `${cardId}:${materialName} distance source`);
    assert.equal(sort.srpBatcherCompatible, 0, `${cardId}:${materialName} SRP Batcher bit`);
    assert.equal(sort.srpBatcherSource, "non-UnityPerDraw-unity_ObjectToWorld",
      `${cardId}:${materialName} SRP Batcher source`);
    assert.equal(sort.materialBatchStateBranch, "hashed",
      `${cardId}:${materialName} Material/Shader state branch`);
    assert.equal(sort.materialBatchStateBranchSource, "DrawOpaque/DrawTransparent-command-selector-zero",
      `${cardId}:${materialName} Material/Shader state branch source`);
    assert.equal(sort.localKeywordCount, material.official.shaderKeywordNames.length,
      `${cardId}:${materialName} LocalKeywordState bit count`);
    assert.match(sort.serializedLocalKeywordStateHex, /^[0-9a-f]*$/,
      `${cardId}:${materialName} serialized LocalKeywordState bytes`);
    assert.equal(sort.serializedLocalKeywordStateHex.length,
      Math.ceil(sort.localKeywordCount / 64) * 16,
      `${cardId}:${materialName} serialized LocalKeywordState byte width`);
    assert.ok(Number.isInteger(sort.serializedLocalKeywordHash)
      && sort.serializedLocalKeywordHash >= 0 && sort.serializedLocalKeywordHash <= 0xffffffff,
    `${cardId}:${materialName} serialized LocalKeywordState hash`);
    assert.equal(sort.serializedLocalKeywordHashLow8, sort.serializedLocalKeywordHash & 0xff,
      `${cardId}:${materialName} serialized LocalKeywordState hash low byte`);
    assert.equal(sort.serializedLocalKeywordHashSource,
      "m_KeywordNames-order+m_ValidKeywords+XXH32-seed-0x8f37154b",
    `${cardId}:${materialName} serialized LocalKeywordState hash source`);
    assert.equal(typeof material.official?.material, "string", `${cardId}:${materialName} Material identity`);
    assert.equal(typeof material.official?.shader, "string", `${cardId}:${materialName} Shader identity`);
    assert.ok(Number.isInteger(material.official?.customRenderQueue),
      `${cardId}:${materialName} raw m_CustomRenderQueue`);
    assert.equal(typeof material.official?.enableInstancingVariants, "boolean",
      `${cardId}:${materialName} m_EnableInstancingVariants`);
    assert.ok(Array.isArray(material.official?.validKeywords), `${cardId}:${materialName} m_ValidKeywords`);
    assert.ok(Array.isArray(material.official?.invalidKeywords), `${cardId}:${materialName} m_InvalidKeywords`);
    assert.ok(Array.isArray(material.official?.shaderKeywordNames),
      `${cardId}:${materialName} Shader m_KeywordNames`);
    assert.ok(Array.isArray(material.official?.shaderKeywordFlags),
      `${cardId}:${materialName} Shader m_KeywordFlags`);
    assert.equal(material.official.shaderKeywordNames.length, material.official.shaderKeywordFlags.length,
      `${cardId}:${materialName} Shader keyword-space width`);
    assert.deepEqual(material.keywords, material.official.validKeywords,
      `${cardId}:${materialName} serialized valid keywords`);
    const shaderKeywords = new Set(material.official.shaderKeywordNames);
    assert.ok(material.official.validKeywords.every((keyword) => shaderKeywords.has(keyword)),
      `${cardId}:${materialName} valid keyword must belong to the serialized Shader keyword space`);
    assert.ok(material.official.invalidKeywords.every((keyword) => !shaderKeywords.has(keyword)),
      `${cardId}:${materialName} invalid keyword unexpectedly belongs to the serialized Shader keyword space`);
    const prior = uniqueSceneMaterials.get(material.official.material);
    if (prior) assert.deepEqual(prior, material.official, `${cardId}:${materialName} shared Material state`);
    else uniqueSceneMaterials.set(material.official.material, material.official);
    uniqueSceneShaders.add(material.official.shader);
    const shaderKeywordSpace = {
      names: material.official.shaderKeywordNames,
      flags: material.official.shaderKeywordFlags,
    };
    const priorKeywordSpace = uniqueShaderKeywordSpaces.get(material.official.shader);
    if (priorKeywordSpace) {
      assert.deepEqual(priorKeywordSpace, shaderKeywordSpace, `${cardId}:${materialName} shared Shader keyword space`);
    } else {
      uniqueShaderKeywordSpaces.set(material.official.shader, shaderKeywordSpace);
    }
    sceneMaterialCount += 1;
  }
}

const buildSource = fs.readFileSync(path.join(ROOT, "build", "build.mjs"), "utf8");
assert.match(buildSource, /unsupported rendererType/);
assert.match(buildSource, /shared by renderers with different sort inputs/);
assert.match(buildSource, /MeshRenderer-native-zero/);
assert.match(buildSource, /packedLightmapIndices/);
assert.match(buildSource, /officialDraws/);

const appSource = fs.readFileSync(path.join(ROOT, "public", "app.js"), "utf8");
assert.match(appSource, /officialDistanceKey/);
assert.match(appSource, /userData\.officialSort/);
assert.doesNotMatch(appSource, /\.renderOrder\s*=\s*-100/);
assert.match(appSource, /applyRenderQueueState\(mat,\s*r\.queue\)/);
assert.match(appSource, /mesh\.renderOrder\s*=\s*r\.queue/);
assert.match(appSource, /mesh\.userData\.officialSort\s*=\s*r\.sort/);
assert.match(appSource, /attachOfficialDrawIdentity/);
assert.match(appSource, /officialDrawCandidates/);
assert.match(appSource, /first unresolved key is entry\+0x08 hashed Material\/Shader state/);
assert.match(appSource, /setOpaqueSort\(\(a, b\) => compareOfficialPrefix\(a, b, false\)\)/);
assert.match(appSource, /setTransparentSort\(\(a, b\) => compareOfficialPrefix\(a, b, true\)\)/);

assert.equal(sceneDrawCount, 98, "canonical official draw identity coverage");
assert.equal(uniqueSceneMaterials.size, 70, "canonical unique official Material identities");
assert.equal(uniqueSceneShaders.size, 27, "canonical unique official Shader identities");
assert.equal(uniqueShaderKeywordSpaces.size, 27, "canonical serialized Shader keyword spaces");
assert.deepEqual(
  [...uniqueShaderKeywordSpaces.values()].map((space) => space.names.length).sort((a, b) => a - b),
  [4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 5, 5, 7, 8, 9],
  "canonical Shader keyword-space widths",
);
assert.equal([...uniqueSceneMaterials.values()].filter((material) => material.enableInstancingVariants).length, 2,
  "official instancing-enabled Material identities");
assert.equal([...uniqueSceneMaterials.values()].filter((material) => material.customRenderQueue === -1).length, 12,
  "official Materials using Shader queue fallback");
assert.equal([...uniqueSceneMaterials.values()].filter((material) => material.invalidKeywords.length > 0).length, 37,
  "official Materials carrying invalid keywords");
console.log(`official reference sort inputs: ${rendererCount} raw renderers -> ${sceneDrawCount} draws / ${sceneMaterialCount} scene materials verified`);
