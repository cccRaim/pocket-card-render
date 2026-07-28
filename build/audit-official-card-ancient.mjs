#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CARD_ANCIENT_PRODUCER_SCHEMA } from "../public/render/card-ancient.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCENE = path.join(
  ROOT,
  "public",
  "scene.cPK_20_018410_00_HABATAKUKAMIex_SR.json",
);
const MANIFEST = path.join(
  ROOT,
  "public",
  "shaders",
  "card_parallax_strata_uniforms.json",
);

const EXPECTED_SOURCE = {
  sampleId: "ptcgp-1.6.0-unity-2022.3.62f2-proof-r2",
  sampleManifestSha256:
    "6308a8551afa4702c359c26f8506a62fb74774c98b6af09747a4e560af8901e6",
  apkmSha256: "9b7f9067e00a54f342bd4f17e669ceeb86b80bb7d34ff2d0d0fe82050a62f201",
  arm64SplitSha256: "7faf449bae431dcfeda4f882ecb04290af66cc4ccfeefc620e24cac70d22fcec",
  libil2cppSha256: "3e78eedc62770fff4cb129b4b8d898950e131b710b3c099237fe20d2d34ca48e",
};

const EXPECTED_METHODS = {
  get_IsAnimationStopped: [8, "c63fed20e2ceaaf72fc9c51417d9989ea9f15afbfd3e27079f89be3155d4f630"],
  set_IsAnimationStopped: [8, "7ebe8d262f3e1f429674f8c1553195bbe937f612ed507a31f3bc4c79604943b3"],
  Awake: [32, "7659c293fca817c659343759e2b7505bbb09d4c2e79ce4d11ff7498c020a9b14"],
  Validate: [632, "41b40db68e5012b600c239f7eed89209494ee7259713982eab54ee02265a9818"],
  Initialize: [1856, "7b1a8d772759f95f56e5e8384f8037696f1d0792fedb4111c4e5d611c88b6b3e"],
  LateUpdate: [84, "0e5d6e7162fc011c6d7983ad580d5a0cfd6359cf37289129826a884cb775f001"],
  UpdateTilt: [952, "a0ad3d950518429eb6fe55a7a9d21fde7737ce7a4d84ed1a5c858e518d18c160"],
  UpdateStrataFaults: [52, "a59b952aa04381917b2c1353175eb30f537eeec53a8e3765b48d43427560b994"],
  UpdateShake: [476, "2e45cf42e402129f8f078262df372b215373243cdd3c14846e82e844123c6f28"],
  UpdateSandVolumes: [736, "c1c030c82c361522382ef7e302f5da3d9f9e1df3f8bffaf4828052efffb0b4b7"],
  ApplyParams: [352, "f7cd0772c90cbd77eac5da21a1f7c4aad6b2408c8d6dc0b13327ae86c69c4b28"],
  SetEmissionRate: [364, "5d8b0f420c7303f28db1afacf646aff71206c6fcb5a8eae6ab7670dfc916d418"],
  UpdateStrataFault: [712, "b3b682719cf47f7d3791a32cf9260d115bd2bffc9b6a19db07f37b0c17aa3826"],
  ".ctor": [300, "50165f4e4931c128c8961adfb3289c3dbf56c989710cf044ee9dc8d13f5d5fad"],
  ".cctor": [228, "88c90d2da578c97f48ae61d04c94b9b8b99fc440fd3088d0598f6d2bdc318899"],
  "StrataData..ctor": [24, "9da1c89d89b40dd52349ad6d73375a507a5711f489a825ba40793ee33e5710c5"],
};

const EXPECTED_ASSETS = {
  component: {
    bundleByteLength: 1162695,
    bundleSha256: "86479e00b5e9d9b69fc88cab76e1e55b9eed2745b647eb1b4835ff9310686fe8",
    rawByteLength: 300,
    rawSha256: "fa1ad18e1b51d6b34e3a865e012668d4e825ec506826c0820abbe37c49b44bc6",
    identity: "CAB-2be294aa4da7bcb498eb4352d4afed3d:-6848210623870774095",
  },
  settings: {
    bundleByteLength: 2608,
    bundleSha256: "6d524c69fc82f092d7cdfdaa5e041a813c799e36684978e992800810de496524",
    rawByteLength: 876,
    rawSha256: "d145102c0149f71f4c87127a22488f82f5558c9bd1c2a67091f91da3ac3ee21b",
    identity: "CAB-1fb0e33dbac4335dd1d5f42e30b28d4b:6433345847792838671",
  },
};

function extractEvidence() {
  const runner = process.env.PYTHON || "python";
  const result = spawnSync(runner, ["-B", "build/extract_official_card_ancient.py"], {
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

export function auditOfficialCardAncient() {
  const evidence = extractEvidence();
  assert.equal(
    evidence.schema,
    "pocket-card-render/official-card-ancient-evidence@1",
  );
  assert.deepEqual(evidence.source, EXPECTED_SOURCE);
  assert.deepEqual(evidence.rodata, {
    sandAndStrataCounts: "0400000006000000",
    lightDir2: "0000803f000080bf",
    normalizeEpsilon: "acc52737",
  });
  assert.deepEqual(Object.keys(evidence.methods).sort(), Object.keys(EXPECTED_METHODS).sort());
  for (const [name, [byteLength, sha256]] of Object.entries(EXPECTED_METHODS)) {
    assert.equal(evidence.methods[name].byteLength, byteLength, `${name} byte length`);
    assert.equal(evidence.methods[name].sha256, sha256, `${name} bytes`);
  }
  for (const assetName of ["component", "settings"]) {
    const expected = EXPECTED_ASSETS[assetName];
    const actual = evidence[assetName];
    assert.equal(actual.bundleByteLength, expected.bundleByteLength);
    assert.equal(actual.bundleSha256, expected.bundleSha256);
    assert.equal(actual.rawByteLength, expected.rawByteLength);
    assert.equal(actual.rawSha256, expected.rawSha256);
    assert.equal(
      assetName === "component"
        ? actual.config.componentIdentity
        : actual.identity,
      expected.identity,
    );
  }

  const scene = JSON.parse(fs.readFileSync(SCENE, "utf8"));
  const sceneConfig = scene.runtimeSettings?.cardAncient?.[
    EXPECTED_ASSETS.component.identity
  ];
  assert.ok(sceneConfig, "Strata scene has no CardAncientObject config");
  for (const [field, value] of Object.entries(evidence.component.config)) {
    assert.deepEqual(sceneConfig[field], value, `scene CardAncientObject.${field}`);
  }
  assert.equal(
    sceneConfig.componentGoPath,
    "cPK_20_018410_00_HABATAKUKAMIex_SR_L",
  );
  assert.deepEqual(sceneConfig.rendererBindings, [
    "CAB-2be294aa4da7bcb498eb4352d4afed3d:-620010077910969167",
  ]);
  const sceneSettings = scene.runtimeSettings?.ancientBGAnimation?.[
    EXPECTED_ASSETS.settings.identity
  ];
  assert.deepEqual(sceneSettings, {
    identity: evidence.settings.identity,
    name: evidence.settings.name,
    scriptIdentity: evidence.settings.scriptIdentity,
    curves: evidence.settings.curves,
  });
  const strataDraws = scene.officialDraws.filter(
    (draw) => draw.rendererProperties?.cardAncient,
  );
  assert.equal(strataDraws.length, 1);
  assert.equal(
    strataDraws[0].rendererProperties.cardAncient.componentIdentity,
    sceneConfig.componentIdentity,
  );
  assert.equal(
    strataDraws[0].rendererProperties.cardAncient.rendererIdentity,
    strataDraws[0].rendererIdentity,
  );

  const manifest = JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
  assert.equal(
    manifest.runtime_contract.dynamic_uniforms._Shake.source,
    CARD_ANCIENT_PRODUCER_SCHEMA,
  );
  assert.equal(
    manifest.runtime_contract.dynamic_uniforms._StrataFaults.source,
    CARD_ANCIENT_PRODUCER_SCHEMA,
  );
  assert.equal(manifest.runtime_boundaries[0].producer, CARD_ANCIENT_PRODUCER_SCHEMA);
  assert.equal(manifest.runtime_boundaries[0].status, "runtime-required");

  return {
    status: "pass",
    exact: {
      selectedOfficialSample: true,
      serializedComponent: true,
      serializedCurveSettings: true,
      il2cppMethods: `${Object.keys(EXPECTED_METHODS).length}/${Object.keys(EXPECTED_METHODS).length}`,
      sceneProducerBinding: "1/1",
    },
    knownImplementation: [
      "six-lane StrataData state machine and official AnimationCurve evaluation",
      "tilt goal, remap and MaterialPropertyBlock payload shape",
    ],
    runtimeRequired: [
      "UnityEngine.Random.Range global guest state",
      "native Mathf.PerlinNoise1D value equivalence",
      "official guest MaterialPropertyBlock submission for a captured frame",
      "ParticleSystem sand side effects, which do not feed the Strata shader payload",
    ],
  };
}

const report = auditOfficialCardAncient();
if (process.argv.includes("--json")) console.log(JSON.stringify(report, null, 2));
else {
  console.log("Official CardAncientObject producer audit: PASS");
  console.log(`  IL2CPP methods:       ${report.exact.il2cppMethods}`);
  console.log("  serialized assets:   component + AncientBGAnimationSettings");
  console.log(`  scene bindings:       ${report.exact.sceneProducerBinding}`);
  console.log("  native boundaries:    Random.Range + PerlinNoise1D + guest MPB");
}
