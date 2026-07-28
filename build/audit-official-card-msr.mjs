#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CARD_MSR_PRODUCER_SCHEMA } from "../public/render/card-msr.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EXPECTED_SOURCE = {
  sampleId: "ptcgp-1.6.0-unity-2022.3.62f2-proof-r2",
  sampleManifestSha256:
    "6308a8551afa4702c359c26f8506a62fb74774c98b6af09747a4e560af8901e6",
  apkmSha256: "9b7f9067e00a54f342bd4f17e669ceeb86b80bb7d34ff2d0d0fe82050a62f201",
  arm64SplitSha256: "7faf449bae431dcfeda4f882ecb04290af66cc4ccfeefc620e24cac70d22fcec",
  libil2cppSha256: "3e78eedc62770fff4cb129b4b8d898950e131b710b3c099237fe20d2d34ca48e",
};
const EXPECTED_METHODS = {
  get_Tilt: [0x442674C, 8, "1100d241275fbe4bc4419e3f87ef9556d0bb3ad7853da97a0308ca737dce7179"],
  set_Tilt: [0x4426754, 8, "57661f811412cb467f08d37a263fc559a9860f5f9ff197bf1fbd33e3d2cd1a22"],
  Awake: [0x442675C, 80, "37e27426a33b3fe9cfb50c4a6baf8ddafb70d21eac9f9f6e9a02f440464ef6f4"],
  Validate: [0x44267AC, 996, "14f8bb9b133dfaccd507297d0732de24d97e3f30ee2490bcc869e02a10d4be26"],
  Initialize: [0x4426B90, 52, "5d13455f094ca96d7177c05852a00ae9e5d7bb69c7ba9eccd9ff869f8291e822"],
  LateUpdate: [0x4426BC4, 72, "ced36879bdbed5ac450e15bcbeb11e9177a0ffeccaaf56650c558dfdde1d4154"],
  EvaluateAnim: [0x4426C0C, 156, "fb0af96521ee967e075a9a01918760d49bc8172ac408c69641e7e549a4f6846b"],
  UpdateTilt: [0x4426CA8, 576, "6f03cc73527701dbbdb26e929a66da9adf99588c89bb76117163b4e7d7171765"],
  UpdateTranslateLayer: [0x4426EE8, 212, "b3c7efc0c804098b6049a2f5e4d2772e425a01abd9f37d643918201c4d3940a9"],
  UpdateAnimation: [0x4426FBC, 204, "e1d9475773ba0465c51dbcc5c5bdd1ddc56ccf769f8917c51d0893741e25993b"],
  UpdateReflection: [0x4427088, 692, "2c62c75930dd2c2a2a5146e916a96776f3c7541fc2d9a865b116446edd6b6253"],
  ApplyParams: [0x442733C, 924, "156dda4d9e791b3ef8596ced62e4c24239826daa48bba2f15e440b0c915530c8"],
  ".ctor": [0x44276D8, 216, "1a5b00f579d7eb7c26a1172829eaf1499848e4ff10b400fcdf2e6297df907026"],
  ".cctor": [0x44277B0, 444, "2281cbc7ac9d3a31d624fbb1f6292c435890746bbd87ece118eac37103152fcd"],
};
const CASES = [
  {
    cardId: "cPK_20_010840_00_MEGAKAILIOSex_SR",
    bundleByteLength: 2430178,
    bundleSha256: "0a6e50babbdc3aa5079245fed6b84d331b62387a8914cc19b525cb05c5ae57b3",
    rawSha256: "ff0b3b69723b845fc64bcebc37e50feb430e02e8bbfbb4741dc274c1b328dc94",
    componentIdentity: "CAB-46381ce04bcae4d175f44b2ba92ee9dd:6623677083657556003",
  },
  {
    cardId: "cPK_20_016210_00_MEGAYADORANex_SR",
    bundleByteLength: 2360777,
    bundleSha256: "2b2e9540166e5cc5fe5f66c98de922a9c66bd8da199161e198855fce29593206",
    rawSha256: "1c8a250a752b53f201b3bb91693ef16b67af469ef7df797c1b92ff0b3fdb3e2e",
    componentIdentity: "CAB-88b3bf2c8ec25c292b22fd7d98d65f1e:7789006433652531418",
  },
  {
    cardId: "cPK_20_016430_00_MEGAGANGARex_SR",
    bundleByteLength: 2412883,
    bundleSha256: "19f0917a2aecfe1e1fd8e36f0c14a530fd8e30cf06645aa0b70b91646015fe60",
    rawSha256: "3001bb77ea136d7aa9ad6cc3a3a964e4448a35c4f69059e3f63a545204a33260",
    componentIdentity: "CAB-9f39ecdfd81cc21b5031d491ba9b0826:-1780107615064738716",
  },
];
const EXPECTED_SETTINGS = {
  bundleByteLength: 3138,
  bundleSha256: "c626f604223e3703c7bb213f589cf577d35049309b818b21f4570911e7b54697",
  rawByteLength: 904,
  rawSha256: "b3b3e0cbd13022f259dffede0d3185ab361f4260a6dcc18084453a3c90c7b5b6",
  identity: "CAB-cd526098ad1cc44138da75873c83fdbb:4344838477251992114",
};
const EXPECTED_SHADERS = {
  Card_Aura: [
    "CAB-5ced508ac0196ce54fc27ff162e5e3a4:4889011790250279620",
    "Card-Aura",
    38491,
    "c1ccefd1cc754c2c75fe36acfd1bfb3d3882ded3cdd7617dd6014a19f6fb2f9e",
    "1427c06d62102accd8fee666edd2813eb8cfca75c2b7b9815c7563d1a750664a",
  ],
  Card_ShadowBox_Effect_Flow: [
    "CAB-b06ae8ddb8beaf64b3c2c0d09cc03e3b:2362128481372052300",
    "Card-Aura",
    39747,
    "cbbc3364f45d6c15362f44279966ab224e948593e976969b33ef2bdbd85fad14",
    "8b891672d03b1609d982cc7af22ccdce537dd7b7339cddf399605307299b8f40",
  ],
  Card_Parallax_Transparent_Translate: [
    "CAB-feca102e2ab42d700bc7d72a39330454:8147289495056524436",
    "Card_Parallax_Transparent_Translate",
    21256,
    "a233b608ad6120a326a26d27a14662b8e1e131d7413f1b4711449e4126369732",
    "5dadb7e95a23c3417584eb811e42bd167cd4d99d19865780b19a409110aaa527",
  ],
  "Hologram-FlipOutline": [
    "CAB-357d390f82e81058a0bb8f4f50dd2880:-336364313305745452",
    "ShadowBox_MSR",
    24624,
    "4be3eda958b7b20884ae4b87e865196750aec67d117a8613c01133294578490c",
    "5623b553352e14f5613b96ddbece7e135945d9b5375f376ccc920da54eccd6b3",
  ],
};
const MANIFESTS = {
  Card_Aura: [
    "card_aura_base_uniforms.json",
    "card_aura_col4_uniforms.json",
    "card_aura_old_noise_uniforms.json",
  ],
  Card_ShadowBox_Effect_Flow: [
    "shadowbox_effect_flow_default_uniforms.json",
    "shadowbox_effect_flow_use_col4_uniforms.json",
    "shadowbox_effect_flow_use_old_noise_uniforms.json",
  ],
  Card_Parallax_Transparent_Translate: [
    "card_parallax_transparent_translate_uniforms.json",
  ],
  "Hologram-FlipOutline": ["hologram_flip_outline_uniforms.json"],
};
const MSR_UNIFORMS = {
  Card_Aura: ["_TimeParam", "_Transparency"],
  Card_ShadowBox_Effect_Flow: ["_TimeParam", "_Transparency"],
  Card_Parallax_Transparent_Translate: ["_Translate", "_Transparency"],
  "Hologram-FlipOutline": [
    "_FlipAnim",
    "_FlipAnimOffset",
    "_FlipBlend",
    "_ReflectIntensity",
  ],
};
const ROLE_TAGS = {
  aura: "Card-Aura",
  parallax: "Card_Parallax_Transparent_Translate",
  shadowbox: "ShadowBox_MSR",
};

function extractEvidence() {
  const runner = process.env.PYTHON || "python";
  const result = spawnSync(runner, ["-B", "build/extract_official_card_msr.py"], {
    cwd: ROOT,
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024,
    shell: process.platform === "win32" && runner === "python",
  });
  if (result.status !== 0) {
    throw new Error(`${result.error || ""}\n${result.stdout || ""}\n${result.stderr || ""}`.trim());
  }
  return JSON.parse(result.stdout.replace(/^\uFEFF/, ""));
}

export function auditOfficialCardMSR() {
  const evidence = extractEvidence();
  assert.equal(evidence.schema, "pocket-card-render/official-card-msr-evidence@1");
  assert.deepEqual(evidence.source, EXPECTED_SOURCE);
  assert.deepEqual(Object.keys(evidence.methods).sort(), Object.keys(EXPECTED_METHODS).sort());
  for (const [name, [rva, byteLength, sha256]] of Object.entries(EXPECTED_METHODS)) {
    assert.deepEqual(evidence.methods[name], { rva, byteLength, sha256 }, `${name} native body`);
  }

  assert.equal(evidence.components.length, CASES.length);
  for (const [index, expected] of CASES.entries()) {
    const actual = evidence.components[index];
    assert.equal(actual.cardId, expected.cardId);
    assert.equal(actual.bundleByteLength, expected.bundleByteLength);
    assert.equal(actual.bundleSha256, expected.bundleSha256);
    assert.equal(actual.rawByteLength, 124);
    assert.equal(actual.rawSha256, expected.rawSha256);
    assert.equal(actual.config.componentIdentity, expected.componentIdentity);

    const scene = JSON.parse(fs.readFileSync(
      path.join(ROOT, "public", `scene.${expected.cardId}.json`),
      "utf8",
    ));
    const sceneConfig = scene.runtimeSettings.cardMSR[expected.componentIdentity];
    assert.ok(sceneConfig, `${expected.cardId}: CardMSRObject config`);
    for (const [field, value] of Object.entries(actual.config)) {
      assert.deepEqual(sceneConfig[field], value, `${expected.cardId}: ${field}`);
    }
    const descendants = new Set(actual.descendantRendererIdentities);
    const boundRenderers = new Set(Object.values(sceneConfig.rendererBindings).flat());
    for (const rendererIdentity of boundRenderers) {
      assert.ok(descendants.has(rendererIdentity), `${expected.cardId}: descendant renderer`);
    }
    const draws = scene.officialDraws.filter(
      (draw) => draw.rendererProperties?.cardMSR?.componentIdentity
        === expected.componentIdentity,
    );
    assert.ok(draws.length > 0, `${expected.cardId}: bound draws`);
    for (const draw of draws) {
      const binding = draw.rendererProperties.cardMSR;
      assert.ok(boundRenderers.has(binding.rendererIdentity));
      assert.ok(sceneConfig.rendererBindings[binding.role].includes(binding.rendererIdentity));
      assert.equal(binding.searchTag, ROLE_TAGS[binding.role]);
      assert.equal(draw.rendererIdentity, binding.rendererIdentity);
    }
    for (const rendererIdentity of boundRenderers) {
      assert.ok(
        draws.some((draw) =>
          draw.rendererProperties.cardMSR.rendererIdentity === rendererIdentity),
        `${expected.cardId}: renderer has no bound draw`,
      );
    }
  }

  const settingsEvidence = evidence.animationSettings;
  for (const field of [
    "bundleByteLength",
    "bundleSha256",
    "rawByteLength",
    "rawSha256",
  ]) {
    assert.equal(settingsEvidence[field], EXPECTED_SETTINGS[field], `settings ${field}`);
  }
  assert.equal(settingsEvidence.settings.identity, EXPECTED_SETTINGS.identity);
  for (const expected of CASES) {
    const scene = JSON.parse(fs.readFileSync(
      path.join(ROOT, "public", `scene.${expected.cardId}.json`),
      "utf8",
    ));
    assert.deepEqual(
      scene.runtimeSettings.msrAnimation[EXPECTED_SETTINGS.identity],
      settingsEvidence.settings,
      `${expected.cardId}: MSRAnimationSettings`,
    );
  }

  assert.equal(evidence.shaderSearchTags.length, 4);
  for (const shader of evidence.shaderSearchTags) {
    const [identity, searchTag, bundleLength, bundleHash, rawHash] =
      EXPECTED_SHADERS[shader.label];
    assert.equal(shader.shaderIdentity, identity);
    assert.equal(shader.searchTag, searchTag);
    assert.equal(shader.subShaderTags.SearchTag, searchTag);
    assert.equal(shader.bundleByteLength, bundleLength);
    assert.equal(shader.bundleSha256, bundleHash);
    assert.equal(shader.rawSha256, rawHash);
    for (const filename of MANIFESTS[shader.label]) {
      const manifest = JSON.parse(fs.readFileSync(
        path.join(ROOT, "public", "shaders", filename),
        "utf8",
      ));
      assert.equal(manifest.official_selector.shaderIdentity, identity);
      for (const name of MSR_UNIFORMS[shader.label]) {
        assert.equal(
          manifest.runtime_contract.dynamic_uniforms[name]?.source,
          CARD_MSR_PRODUCER_SCHEMA,
          `${filename}: ${name}`,
        );
        assert.equal(
          manifest.runtime_contract.material_uniforms.floats.includes(name),
          false,
          `${filename}: ${name} cannot remain a material uniform`,
        );
      }
      assert.ok(
        manifest.runtime_boundaries.some(
          (boundary) => boundary.producer === CARD_MSR_PRODUCER_SCHEMA,
        ),
        `${filename}: CardMSR boundary`,
      );
    }
  }

  return {
    status: "pass",
    exact: {
      selectedOfficialSample: true,
      il2cppMethods: "14/14",
      serializedComponents: "3/3",
      serializedAnimationSettings: "1/1",
      shaderSearchTags: "4/4",
      sceneRendererRoleBindings: "3/3 scenes",
      selectorProducerContracts: "8/8",
    },
    knownImplementation: [
      "tilt history, animation threshold, translation and reflection spring state",
      "serialized AnimationCurve evaluation and role-specific MPB payload mapping",
      "component-identity state sharing across Aura, Parallax and ShadowBox renderers",
    ],
    runtimeRequired: [
      "UnityEngine.Mathf.PerlinNoise(x, 0) numeric equivalence",
      "Unity LateUpdate scheduling and official guest MaterialPropertyBlock submission",
      "Card_ShadowBox_Effect_Flow _NoiseMaskNoiseSpeed producer",
      "official guest camera/projection values for the known Three depth adaptation",
    ],
  };
}

const report = auditOfficialCardMSR();
if (process.argv.includes("--json")) console.log(JSON.stringify(report, null, 2));
else {
  console.log("Official CardMSRObject producer audit: PASS");
  console.log(`  IL2CPP methods:       ${report.exact.il2cppMethods}`);
  console.log(`  serialized assets:    ${report.exact.serializedComponents} + ${report.exact.serializedAnimationSettings}`);
  console.log(`  SearchTags:           ${report.exact.shaderSearchTags}`);
  console.log(`  selector contracts:   ${report.exact.selectorProducerContracts}`);
  console.log("  runtime boundaries:   Perlin + LateUpdate/MPB + Flow noise + camera");
}
