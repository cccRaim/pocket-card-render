import test from "node:test";
import assert from "node:assert/strict";
import {
  CAPTURE_PREFIX,
  CAPTURE_SCHEMA,
  EXPECTED_RELEASE,
  IMPORT_SCHEMA,
  computeOfficialEntry28,
  computeOfficialStateKey,
  importOfficialSortRuntimeCapture,
  sha256Hex,
} from "./import-official-sort-runtime-capture.mjs";

const SESSION_ID = "293311:4242:1700000000000:0x7000000000";

function sceneObject({ ambiguous = false } = {}) {
  const materialName = "Card_L_SBM1";
  const materialIdentity = "CAB-material:101";
  const shaderIdentity = "CAB-shader:202";
  const draw = (renderer, go) => ({
    drawId: `${renderer}#0`,
    go,
    goPath: `Root/${go}`,
    materialName,
    materialSlot: 0,
    rendererIdentity: renderer,
    materialIdentity,
    shaderIdentity,
    meshIdentity: "CAB-mesh:303",
  });
  return {
    officialDrawSchemaVersion: 2,
    card: { id: "cTEST_UR", name: "TEST", rarityToken: "UR" },
    prefabGlb: "/game/test.glb",
    materials: {
      [materialName]: {
        shader: "Opaque-UR-Oklab",
        queue: 2106,
        sort: {
          materialSlot: 0,
          rendererTypeValue: 1,
          lodFadeHighByte: 0,
          canvasOrder: 0,
          staticBatchFirstSubMesh: 0,
          staticBatchSubMeshCount: 0,
          packedLightmapIndices: 0xffffffff,
          srpBatcherCompatible: 0,
          serializedLocalKeywordHash: 0x589f8e38,
        },
        official: { material: materialIdentity, shader: shaderIdentity },
      },
    },
    officialDraws: ambiguous
      ? [draw("CAB-renderer:401", "RareMark1"), draw("CAB-renderer:402", "RareMark2")]
      : [draw("CAB-renderer:401", "Main")],
  };
}

function manifest(overrides = {}) {
  return {
    schema: CAPTURE_SCHEMA,
    sessionId: SESSION_ID,
    type: "manifest",
    startedAtUnixMs: 1700000000000,
    processId: 4242,
    package: {
      name: EXPECTED_RELEASE.packageName,
      versionName: EXPECTED_RELEASE.versionName,
      versionCode: EXPECTED_RELEASE.versionCode,
      apkmSha256: EXPECTED_RELEASE.apkmSha256,
      libunitySha256: EXPECTED_RELEASE.libunitySha256,
    },
    moduleBase: "0x7000000000",
    instructionChecks: EXPECTED_RELEASE.instructionChecks,
    ...overrides,
  };
}

function validRows() {
  const materialName = "Card_L_SBM1";
  const shaderName = "Opaque-UR-Oklab";
  const shaderObjectInstanceId = -12345;
  const localKeywordHash = 0x589f8e38;
  const baseLow16 = 0x2345;
  const materialSortByte17c = 0x67;
  const materialSlot = 0;
  const srpBatcherCompatible = 0;
  const staticBatchFirstSubMesh = 0;
  const meshSmallMeshId = 0x89abcdef;
  const common = { schema: CAPTURE_SCHEMA, sessionId: SESSION_ID };
  return [
    manifest(),
    { ...common, type: "material", instanceId: 777, instanceIdLow8: 9, name: materialName },
    {
      ...common,
      type: "shader",
      instanceId: shaderObjectInstanceId,
      instanceIdLow8: shaderObjectInstanceId & 0xff,
      name: shaderName,
    },
    {
      ...common,
      type: "draw",
      materialName,
      shaderName,
      materialSortByte17c,
      shaderObjectInstanceId,
      shaderObjectInstanceIdLow8: shaderObjectInstanceId & 0xff,
      localKeywordHash,
      baseLow16,
      stateKey: computeOfficialStateKey({
        baseLow16,
        materialSortByte17c,
        localKeywordHash,
        shaderObjectInstanceId,
      }),
      packedMaterialSlotAndSrp: (materialSlot << 1) | srpBatcherCompatible,
      materialSlot,
      srpBatcherCompatible,
      staticBatchFirstSubMesh,
      staticBatchSubMeshCount: 0,
      packedLightmapIndices: 0xffffffff,
      entry28: computeOfficialEntry28({ meshSmallMeshId, staticBatchFirstSubMesh, materialSlot }),
      visibleNodeIndex: 17,
      meshSmallMeshId,
      drawCandidateOrdinal: 6,
    },
  ];
}

function logText(rows) {
  return [
    "Frida startup noise that is intentionally ignored",
    ...rows.map((row) => `${CAPTURE_PREFIX}${JSON.stringify(row)}`),
    "",
  ].join("\n");
}

function sceneText(options) {
  return `${JSON.stringify(sceneObject(options), null, 2)}\n`;
}

test("imports one exact session and independently records source hashes", () => {
  const capture = logText(validRows());
  const scene = sceneText();
  const output = importOfficialSortRuntimeCapture(capture, scene);

  assert.equal(output.schema, IMPORT_SCHEMA);
  assert.equal(output.source.sessionId, SESSION_ID);
  assert.equal(output.source.captureSha256, sha256Hex(capture));
  assert.equal(output.source.sceneSha256, sha256Hex(scene));
  assert.equal(output.source.packageVersion, "1.6.0");
  assert.equal(output.unresolved.length, 0);
  assert.equal(Object.keys(output.states).length, 1);
  assert.deepEqual(Object.keys(output.draws), ["CAB-renderer:401#0"]);
  const draw = output.draws["CAB-renderer:401#0"];
  assert.equal(draw.drawId, "CAB-renderer:401#0");
  assert.equal(draw.materialName, "Card_L_SBM1");
  assert.equal(draw.rendererTypeValue, 1);
  assert.equal(draw.lodFadeHighByte, 0);
  assert.equal(draw.canvasOrder, 0);
  const state = output.states[draw.stateRef];
  assert.equal(state.materialSortByte17c, 0x67);
  assert.equal(draw.stateKey, state.stateKey);
  assert.equal(state.shaderObjectInstanceId, -12345);
  assert.equal("materialInstanceId" in state, false);
});

test("rejects independently recomputed stateKey and entry28 formula errors", async (t) => {
  await t.test("stateKey", () => {
    const rows = validRows();
    rows.at(-1).stateKey = (rows.at(-1).stateKey + 1) >>> 0;
    assert.throws(() => importOfficialSortRuntimeCapture(logText(rows), sceneText()), /draw\.stateKey mismatch/);
  });
  await t.test("entry28", () => {
    const rows = validRows();
    rows.at(-1).entry28 = (rows.at(-1).entry28 + 1) >>> 0;
    assert.throws(() => importOfficialSortRuntimeCapture(logText(rows), sceneText()), /draw\.entry28 mismatch/);
  });
});

test("rejects non-exact material and shader names without fuzzy matching", async (t) => {
  await t.test("material name", () => {
    const rows = validRows();
    rows.at(-1).materialName = "Card_L_SBM1 (Instance)";
    assert.throws(() => importOfficialSortRuntimeCapture(logText(rows), sceneText()),
      /no draw rows with exact scene material names/);
  });
  await t.test("shader name", () => {
    const rows = validRows();
    rows.at(-1).shaderName = "Opaque-UR-Oklab (Instance)";
    assert.throws(() => importOfficialSortRuntimeCapture(logText(rows), sceneText()), /draw\.shaderName must equal/);
  });
});

test("rejects multiple manifests and every missing or cross-session row sessionId", async (t) => {
  await t.test("multiple manifests", () => {
    const rows = validRows();
    rows.push(manifest({ sessionId: "second-session" }));
    assert.throws(() => importOfficialSortRuntimeCapture(logText(rows), sceneText()), /exactly one manifest, found 2/);
  });
  await t.test("missing row sessionId", () => {
    const rows = validRows();
    delete rows.at(-1).sessionId;
    assert.throws(() => importOfficialSortRuntimeCapture(logText(rows), sceneText()), /sessionId must equal/);
  });
  await t.test("cross-session row", () => {
    const rows = validRows();
    rows.at(-1).sessionId = "another-session";
    assert.throws(() => importOfficialSortRuntimeCapture(logText(rows), sceneText()), /sessionId must equal/);
  });
});

test("rejects a manifest that is not the pinned 1.6.0 release", async (t) => {
  await t.test("versionCode", () => {
    const rows = validRows();
    rows[0].package = { ...rows[0].package, versionCode: EXPECTED_RELEASE.versionCode + 1 };
    assert.throws(() => importOfficialSortRuntimeCapture(logText(rows), sceneText()), /package\.versionCode mismatch/);
  });
  await t.test("libunity SHA", () => {
    const rows = validRows();
    rows[0].package = { ...rows[0].package, libunitySha256: "0".repeat(64) };
    assert.throws(() => importOfficialSortRuntimeCapture(logText(rows), sceneText()), /package\.libunitySha256 must equal/);
  });
  await t.test("self-inconsistent sessionId", () => {
    const rows = validRows();
    rows[0].processId = 4243;
    assert.throws(() => importOfficialSortRuntimeCapture(logText(rows), sceneText()), /manifest\.sessionId must equal/);
  });
});

test("keeps multiple official draw candidates unresolved and never guesses a drawId", () => {
  const output = importOfficialSortRuntimeCapture(logText(validRows()), sceneText({ ambiguous: true }));
  assert.equal(output.unresolved.length, 1);
  assert.deepEqual(Object.keys(output.draws), ["unresolved:000001"]);
  const draw = output.draws["unresolved:000001"];
  assert.equal("drawId" in draw, false);
  assert.deepEqual(draw.candidateDrawIds, ["CAB-renderer:401#0", "CAB-renderer:402#0"]);
  assert.deepEqual(output.unresolved[0].candidateDrawIds, draw.candidateDrawIds);
});

test("rejects duplicate conflicting registry and exact draw values", async (t) => {
  await t.test("registry ID conflict", () => {
    const rows = validRows();
    rows.splice(2, 0, {
      schema: CAPTURE_SCHEMA,
      sessionId: SESSION_ID,
      type: "material",
      instanceId: 777,
      instanceIdLow8: 9,
      name: "DifferentName",
    });
    assert.throws(() => importOfficialSortRuntimeCapture(logText(rows), sceneText()), /conflicting exact names/);
  });
  await t.test("draw conflict", () => {
    const rows = validRows();
    const conflicting = { ...rows.at(-1), visibleNodeIndex: 18 };
    rows.push(conflicting);
    assert.throws(() => importOfficialSortRuntimeCapture(logText(rows), sceneText()), /duplicate conflicting runtime values/);
  });
});

test("ignores unrelated renderer-list draws and records their count", () => {
  const rows = validRows();
  rows.push({
    ...rows.at(-1),
    materialName: "Unrelated_UI_Material",
    shaderName: "UI/Default",
  });
  const output = importOfficialSortRuntimeCapture(logText(rows), sceneText());
  assert.equal(output.source.capturedDrawRows, 1);
  assert.equal(output.source.ignoredOutsideSceneDrawRows, 1);
  assert.equal(output.unresolved.length, 0);
});

test("allows same-name registry objects with different runtime IDs", () => {
  const rows = validRows();
  rows.splice(2, 0, {
    schema: CAPTURE_SCHEMA,
    sessionId: SESSION_ID,
    type: "material",
    instanceId: 778,
    instanceIdLow8: 10,
    name: "Card_L_SBM1",
  });
  const output = importOfficialSortRuntimeCapture(logText(rows), sceneText());
  assert.equal(output.source.capturedDrawRows, 1);
});

test("marks exact scene materials missing from the capture as unresolved", () => {
  const scene = sceneObject();
  scene.materials.Missing_Material = {
    ...scene.materials.Card_L_SBM1,
    official: { material: "CAB-material:999", shader: "CAB-shader:202" },
  };
  scene.officialDraws.push({
    ...scene.officialDraws[0],
    drawId: "CAB-renderer:999#0",
    materialName: "Missing_Material",
    rendererIdentity: "CAB-renderer:999",
    materialIdentity: "CAB-material:999",
  });
  const output = importOfficialSortRuntimeCapture(logText(validRows()), `${JSON.stringify(scene)}\n`);
  assert.deepEqual(output.unresolved, [{
    reason: "no-captured-draw-for-exact-scene-material",
    materialName: "Missing_Material",
    candidateDrawIds: ["CAB-renderer:999#0"],
  }]);
});
