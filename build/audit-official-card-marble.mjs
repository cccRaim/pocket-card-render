#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CARD_MARBLE_PRODUCER_SCHEMA } from "../public/render/card-marble.js";
import {
  CARD_BEHAVIOUR_ROTATION_PRODUCER_SCHEMA,
} from "../public/render/card-behaviour-rotation.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CASES = [
  {
    cardId: "cPK_20_007480_00_MASSIVOONex_SR",
    scene: "scene.cPK_20_007480_00_MASSIVOONex_SR.json",
    manifest: "card_parallax_marble_magnetic_uniforms.json",
    component: {
      bundleByteLength: 1188371,
      bundleSha256: "6bd976945aa49f11462cb2a934d06590e2e9ddd8dbdf10d9cf87a41f10f48de2",
      rawByteLength: 468,
      rawSha256: "e9c2eab3df5f9cf2bad82d9cb5c1bbd638df31a9a1133e75d89653ce4da195ae",
      identity: "CAB-1ed23675c1ceb1daae810e7848156956:283780890072378615",
      path: "cPK_20_007480_00_MASSIVOONex_SR_L/L_Pokemon_Full_Marble_D",
      renderer: "CAB-1ed23675c1ceb1daae810e7848156956:-3932689789347894025",
    },
  },
  {
    cardId: "cPK_20_007800_00_AKUZIKINGex_SR",
    scene: "scene.cPK_20_007800_00_AKUZIKINGex_SR.json",
    manifest: "card_parallax_marble_outside_relax_uniforms.json",
    component: {
      bundleByteLength: 1455587,
      bundleSha256: "eb4d68dcae068dcea134322048fa1d6c27446f45412f35bfb43457cb00db4dc4",
      rawByteLength: 468,
      rawSha256: "3cd5330ea8fca0055fee2c3be79167793ced1c422a8addd70859be5fa91aa57d",
      identity: "CAB-f2c0424503d777f9a434ad066b5a8235:-8314688116202635352",
      path: "cPK_20_007800_00_AKUZIKINGex_SR_L/L_Pokemon_Full_Marble_C",
      renderer: "CAB-f2c0424503d777f9a434ad066b5a8235:615382661046828968",
    },
  },
];

const EXPECTED_SOURCE = {
  sampleId: "ptcgp-1.6.0-unity-2022.3.62f2-proof-r2",
  sampleManifestSha256:
    "6308a8551afa4702c359c26f8506a62fb74774c98b6af09747a4e560af8901e6",
  apkmSha256: "9b7f9067e00a54f342bd4f17e669ceeb86b80bb7d34ff2d0d0fe82050a62f201",
  arm64SplitSha256: "7faf449bae431dcfeda4f882ecb04290af66cc4ccfeefc620e24cac70d22fcec",
  libil2cppSha256: "3e78eedc62770fff4cb129b4b8d898950e131b710b3c099237fe20d2d34ca48e",
};

const EXPECTED_METHODS = {
  Awake: [0x44207A4, 48, "e8969e184a82737d587d50fb4ecfe3499cf48a744185e0ea9b06feafe784c2ef"],
  Validate: [0x44207D4, 536, "6b95f9bf0f0d05664c868c134aa2a4945f0bbf0a1b2d8b66a4087639341646d0"],
  Initialize: [0x44209EC, 288, "a93aa9067d738b5065bb6db591562c9ec0bb174d7807a8483fabd342521512f3"],
  UpdateCurveTextures: [0x4420B0C, 24, "71d7c46df4184d2e6c8c313b2bf521f9e04509e69eed6a27da6a1a86eb85db03"],
  FixedUpdate: [0x4420B24, 48, "4c26585196435dba0052cd459aa36b031b5b0968b549902bf045dd3feb82db09"],
  OnValidate: [0x4420B54, 24, "82dec6e23b10fcc64df6106d504916ee7d33ebca9b53cb2e39525c6d46e9d5f8"],
  UpdateTilt: [0x4420B6C, 584, "31a9158c69ffa3bbce5cdca2a8921fa4b12d30d62bde60fb07a401b579db6c87"],
  UpdateMarble: [0x4420DB4, 232, "cc690c48bd41ee5b7e4ea579871d7e139da8914bd2a55c55844a2975c64a45ff"],
  ApplyParams: [0x4420E9C, 520, "b05ea7bd4e4c17d2f8f5b3304fc272a289b7c3cd9d2800a7990d1fcc5d52f495"],
  UpdatePointGoals: [0x44210A4, 308, "5aeef0d3cbdec0563eba92a0d30843a89d8239764c9acb610ecaa30f5f992ee3"],
  UpdatePosition: [0x44211D8, 908, "16b182ce505a22b4ec07b9e9d52c43565dcd517a41ced471cebf3bbef563876a"],
  "RemapCurveSettings.UpdateRemapTex": [
    0x4421564, 984, "9e9608bdd25fb1fd69ee200bbf3223a50336be653004d15d99ed9fdd8fcbd790",
  ],
  "RemapCurveSettings.ApplyParams": [
    0x442193C, 64, "ff77913bd58b08734d316376385216293f8e036ecc1ba7d8f116c94ee487200e",
  ],
  OnDestroy: [0x442197C, 24, "0cb2909ea2edadd28f132424950c9040de107f711c7926cdb84f2267beb24b12"],
  "RemapCurveSettings.DisposeTexture": [
    0x4421994, 188, "cf7e0b938415070fd92e5342c1046416de0885aa4fdd9eca9a77c4cd1cf567b8",
  ],
  ".ctor": [0x4421A50, 148, "f5ecf2afdffc53d7f7778d97b3186d3ccf564ffd4b84521de612564f3ee3a161"],
  "RemapCurveSettings..ctor": [
    0x4421AE4, 180, "2d3be62a69e264457fba6f5ebdeaff4ee348ed9cc6ba954170edf35a758dfaaa",
  ],
  ".cctor": [0x4421B98, 368, "68fd10db5f200ecbdabdd5655be0b10ed6a7c42005a5656d5a51c8db95aa5958"],
  "Point..ctor": [0x4421D08, 8, "96b457161e37287667d1b96c2ef5756fabcf3ba07425eaa0b32800230aa9e7b1"],
  "RemapCurveSettings.get_RemapCurveId": [
    0x4421D10, 12, "f1d4f35eb667190f134b0350a89c015b36e210e885c75da62328c3e254a67fdf",
  ],
  "RemapCurveSettings.get_TextureResolution": [
    0x4421D1C, 64, "6c9fbeef9f90e2846bb89e7259f37c73059ebbef43143e8fd0d00d13f7c12db1",
  ],
};

function extractEvidence() {
  const runner = process.env.PYTHON || "python";
  const result = spawnSync(runner, ["-B", "build/extract_official_card_marble.py"], {
    cwd: ROOT,
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 32 * 1024 * 1024,
    shell: process.platform === "win32" && runner === "python",
  });
  if (result.status !== 0) {
    throw new Error(`${result.error || ""}\n${result.stdout || ""}\n${result.stderr || ""}`.trim());
  }
  return JSON.parse(result.stdout.replace(/^\uFEFF/, ""));
}

export function auditOfficialCardMarble() {
  const evidence = extractEvidence();
  assert.equal(
    evidence.schema,
    "pocket-card-render/official-card-marble-evidence@1",
  );
  assert.deepEqual(evidence.source, EXPECTED_SOURCE);
  assert.deepEqual(Object.keys(evidence.methods).sort(), Object.keys(EXPECTED_METHODS).sort());
  for (const [name, [rva, byteLength, sha256]] of Object.entries(EXPECTED_METHODS)) {
    assert.deepEqual(
      evidence.methods[name],
      { rva, byteLength, sha256 },
      `${name} native body`,
    );
  }
  assert.equal(evidence.components.length, CASES.length);

  for (const [index, row] of CASES.entries()) {
    const actual = evidence.components[index];
    const expected = row.component;
    assert.equal(actual.cardId, row.cardId);
    assert.equal(actual.bundleByteLength, expected.bundleByteLength);
    assert.equal(actual.bundleSha256, expected.bundleSha256);
    assert.equal(actual.rawByteLength, expected.rawByteLength);
    assert.equal(actual.rawSha256, expected.rawSha256);
    assert.equal(actual.config.componentIdentity, expected.identity);
    assert.deepEqual(actual.config.rendererBindings, [expected.renderer]);

    const scene = JSON.parse(fs.readFileSync(
      path.join(ROOT, "public", row.scene),
      "utf8",
    ));
    const sceneConfig = scene.runtimeSettings?.cardMarble?.[expected.identity];
    assert.ok(sceneConfig, `${row.cardId}: scene CardMarbleLayer config`);
    for (const [field, value] of Object.entries(actual.config)) {
      assert.deepEqual(sceneConfig[field], value, `${row.cardId}: scene.${field}`);
    }
    assert.equal(sceneConfig.componentGoPath, expected.path);
    const draws = scene.officialDraws.filter(
      (draw) => draw.rendererProperties?.cardMarble?.componentIdentity
        === expected.identity,
    );
    assert.equal(draws.length, 1, `${row.cardId}: bound Marble draw`);
    assert.equal(draws[0].rendererIdentity, expected.renderer);
    assert.equal(
      draws[0].rendererProperties.cardMarble.rendererIdentity,
      expected.renderer,
    );

    const manifest = JSON.parse(fs.readFileSync(
      path.join(ROOT, "public", "shaders", row.manifest),
      "utf8",
    ));
    const dynamic = manifest.runtime_contract.dynamic_uniforms;
    for (const name of [
      "_Attributes",
      "_Front",
      "_PointCount",
      "_Tilt",
      "_TiltRotation",
      "_WorldFront",
    ]) {
      assert.equal(dynamic[name].source, CARD_MARBLE_PRODUCER_SCHEMA, `${row.cardId}:${name}`);
    }
    const curveSamplers = Object.entries(dynamic).filter(([, spec]) =>
      spec.type === "sampler2D" && spec.source === CARD_MARBLE_PRODUCER_SCHEMA);
    assert.equal(curveSamplers.length, 1, `${row.cardId}: active remap curve sampler`);
    assert.equal(manifest.runtime_boundaries[0].producer, CARD_MARBLE_PRODUCER_SCHEMA);
    assert.equal(manifest.runtime_boundaries[0].status, "partial-exact");
    assert.equal(
      dynamic._Rotation.source,
      CARD_BEHAVIOUR_ROTATION_PRODUCER_SCHEMA,
    );
    assert.equal(
      manifest.runtime_boundaries[1].producer,
      CARD_BEHAVIOUR_ROTATION_PRODUCER_SCHEMA,
    );
    assert.equal(manifest.runtime_boundaries[1].status, "partial-exact");
    assert.equal(manifest.runtime_boundaries[2].producer, CARD_MARBLE_PRODUCER_SCHEMA);
    assert.equal(manifest.runtime_boundaries[2].status, "runtime-required");
  }

  return {
    status: "pass",
    exact: {
      selectedOfficialSample: true,
      serializedComponents: `${CASES.length}/${CASES.length}`,
      il2cppMethods:
        `${Object.keys(EXPECTED_METHODS).length}/${Object.keys(EXPECTED_METHODS).length}`,
      sceneProducerBindings: `${CASES.length}/${CASES.length}`,
      selectorProducerContracts: `${CASES.length}/${CASES.length}`,
    },
    knownImplementation: [
      "tilt delay queue, point goals, spring/resistance integration and MPB payload shape",
      "serialized AnimationCurve evaluation and 2^Resolution remap sampling",
      "component-identity state and generated-texture sharing across materials",
    ],
    runtimeRequired: [
      "Unity FixedUpdate scheduler cadence and catch-up behavior",
      "Unity R16 texture quantization and official guest GPU texture upload",
      "official guest MaterialPropertyBlock values for a captured frame",
      "official guest MaterialPropertyBlock submission for CardDataGroup.HologramRotation",
    ],
  };
}

const report = auditOfficialCardMarble();
if (process.argv.includes("--json")) console.log(JSON.stringify(report, null, 2));
else {
  console.log("Official CardMarbleLayer producer audit: PASS");
  console.log(`  IL2CPP methods:       ${report.exact.il2cppMethods}`);
  console.log(`  serialized assets:    ${report.exact.serializedComponents}`);
  console.log(`  scene bindings:       ${report.exact.sceneProducerBindings}`);
  console.log(`  selector contracts:   ${report.exact.selectorProducerContracts}`);
  console.log("  runtime boundaries:   FixedUpdate + R16 upload + guest MPB + _Rotation");
}
