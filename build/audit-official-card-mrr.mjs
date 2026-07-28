#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CARD_MRR_MATERIAL_OVERRIDE_PRODUCER_SCHEMA,
  CARD_MRR_PRODUCER_SCHEMA,
} from "../public/render/card-mrr.js";

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
  Awake: [0x4425310, 24, "2e58fbc6896a85c2a794bb91f45354d61549ef5ef0de6fe155b0df59c9f7d6ec"],
  Initialize: [0x4425328, 236, "bfbd17f3a7a0b2a749bf31192ac9815c90d5d30ee367573107d25c815f3b5033"],
  LateUpdate: [0x4425414, 40, "5a9f3e9c3047bbb38439340ee43d461b93465babad177b51495be1ff53522c23"],
  Validate: [0x442543C, 1020, "7f0392c87a74988f52f8f09fdf73e38812a2ff166aa195225ceda4f3ae77dfa3"],
  EvaluateAnim: [0x4425838, 612, "cdba5ea8686cb7b1228b24dd34d4d8eb722e6a751b34ed7e24e242a85e1de5d3"],
  UpdateTilt: [0x4425A9C, 592, "80b14a63043d741ef253651259ab0aac80bab7e738c0f8e055e8a78649902110"],
  UpdateAnimation: [0x4425CEC, 592, "43f5516f8753be875f6f684ba0776cc08c0811644b9db7c3f947ec07740e90d1"],
  ApplyParams: [0x4425F3C, 1096, "91a15a97e2fa288c0aea7bb99bf156b0707f9acd84a6981640ff1520a547c10e"],
  ".ctor": [0x4426384, 208, "501f289399037a1e95802769330becdcda74e10b228f1ce36c55d6ece5db83cb"],
  ".cctor": [0x4426454, 760, "e375ae5c19ba63481461cd998b4ffe12c0d365010a80c6de575de642414195c3"],
};
const CASES = [
  {
    cardId: "cPK_10_012330_00_MEGAABSOLex_RR",
    bundleByteLength: 2144879,
    bundleSha256: "b4cbb08fc14d0e35dded5c4bb43c67df1616171c2d5bb9b3c780d112733c1505",
    rawSha256: "8c378e0e406fb285949fd253a12d507a3f5a361200fec46c1cd0bca667071cb8",
    componentIdentity: "CAB-dcaafb44ef63ab9f25e3923fe7d85208:-2500324852403229865",
  },
  {
    cardId: "cPK_10_013460_00_MEGAMIMILOPex_RR",
    bundleByteLength: 2105265,
    bundleSha256: "98218aa5eab67a25626cf81fef5f790fd6412146778397323cc21f7c230782d9",
    rawSha256: "db7fbb7aef87a62450e2039c1db9306fd3ef466991e43a3bc6e83dd7e2f21763",
    componentIdentity: "CAB-b7aaf8be113bd8d6cb4b457718214ca7:964443821872407604",
  },
];
const EXPECTED_SETTINGS = {
  bundleByteLength: 4103,
  bundleSha256: "755d2f10c81ea739f1c060a41f487eb95965ba53147fe53564b552cca610ab4a",
  rawByteLength: 1832,
  rawSha256: "c30eac4a3bcbee745ed140e363f7985421e54533a16e3e69b9def833a7fbb018",
  identity: "CAB-f6658af8a4c8142c58363fda8a488df9:-817433177353697485",
};
const EXPECTED_SHADERS = {
  Effect_Emit: [
    "CAB-3bcca3ad31dec4415b63ba1eef387789:-8142363382816375908",
    "Card-Effect-Emit",
    19689,
    "0bbf4a83d5fc1f063f552b255171519b3290bea0ca3d583d9136cac675a71421",
    "8444c47100454a7d216ad66269d2d34315883056e6a746a853416b5346bbbfe9",
  ],
  Flash: [
    "CAB-a0908b9b0270c1f22f25cb97c702e2fe:4414619660851596902",
    "MRR-ChangeColor-Lighting",
    23918,
    "8e8498bce5b8c3a06bec944959a546729168877e03f04030e84324dabdb531c0",
    "2bff453ee5a02b1f4239d14f7f4d9bf13bcb426d204917a8ce6289d7f265549b",
  ],
  Card_Parallax_MRR: [
    "CAB-c39994707095a808526076cfa10aa332:4085261867850344489",
    "MRR-ChangeColor-Lighting",
    22482,
    "aebefda7d9b4a0222cd9ee8defcff19ad7b0139d3b429645a8a1f1ec081367a2",
    "efbb4b19502dbe8e242c4db6324c73eccdd914af0472272b9dc3bb3a75c70ada",
  ],
  Card_Parallax_Flash: [
    "CAB-eeb3b28a77923ed00deaaa1baf8678a9:5677331643493683988",
    "MRR-Parallax-Flash",
    20338,
    "7200e948d33513ac220193ecbc3ec75180b76f9a031efeaf0f2e1af35174f076",
    "aced68a90d0ec4fc378b8cc82af412dd106c5108c08c0c9ebc7deb97ccfe9609",
  ],
  "Frame-Holo-2Layer": [
    "CAB-b69d132787e6b446783c630e4f5170ed:-324863385430330581",
    "Frame-Holo-2Layer",
    22857,
    "8a8b66d89d8cfa286a08bf04b3fab15c90e7059025d871d5cc682e3d0c15c9c4",
    "c7c3c89d2e4c87174ed3a3fb8b23645e1ee11f90742bb024b5724e6bac3784e3",
  ],
};
const MANIFESTS = {
  Effect_Emit: "effect_emit_uniforms.json",
  Flash: "shadowbox_flash_uniforms.json",
  Card_Parallax_MRR: "card_parallax_mrr_uniforms.json",
  Card_Parallax_Flash: "card_parallax_flash_uniforms.json",
  "Frame-Holo-2Layer": "frame_holo_2layer_legacy_uniforms.json",
};
const MRR_UNIFORMS = {
  Effect_Emit: ["_Switch", "_AdditiveIntensity", "_Color3Blend", "_EmissiveIntensity"],
  Flash: ["_ChangeColor", "_LightColorIntensity", "_LightEmitIntensity", "_LightPower"],
  Card_Parallax_MRR: ["_ChangeColor", "_LightColorIntensity", "_LightEmitIntensity", "_LightPower"],
  Card_Parallax_Flash: ["_FlashIntensity", "_RadialScaling", "_RadialAnim"],
  "Frame-Holo-2Layer": [
    "_Layer2UVTranslate",
    "_Layer2ColorPower",
    "_Layer2EmissiveIntensity",
  ],
};
const ROLE_TAGS = {
  main: new Set(["MRR-ChangeColor-Lighting", "Frame-Holo-2Layer"]),
  effect: new Set(["Card-Effect-Emit"]),
  flash: new Set(["MRR-Parallax-Flash"]),
};

function extractEvidence() {
  const runner = process.env.PYTHON || "python";
  const result = spawnSync(
    runner,
    ["-B", "build/extract_official_card_mrr.py"],
    {
      cwd: ROOT,
      encoding: "utf8",
      windowsHide: true,
      maxBuffer: 64 * 1024 * 1024,
      shell: process.platform === "win32" && runner === "python",
    },
  );
  if (result.status !== 0) {
    throw new Error(
      `${result.error || ""}\n${result.stdout || ""}\n${result.stderr || ""}`
        .trim(),
    );
  }
  return JSON.parse(result.stdout.replace(/^\uFEFF/, ""));
}

export function auditOfficialCardMRR() {
  const evidence = extractEvidence();
  assert.equal(evidence.schema, "pocket-card-render/official-card-mrr-evidence@1");
  assert.deepEqual(evidence.source, EXPECTED_SOURCE);
  assert.deepEqual(Object.keys(evidence.methods).sort(), Object.keys(EXPECTED_METHODS).sort());
  for (const [name, [rva, byteLength, sha256]] of Object.entries(EXPECTED_METHODS)) {
    assert.deepEqual(evidence.methods[name], { rva, byteLength, sha256 });
  }

  assert.equal(evidence.components.length, CASES.length);
  for (const [index, expected] of CASES.entries()) {
    const actual = evidence.components[index];
    assert.equal(actual.cardId, expected.cardId);
    assert.equal(actual.bundleByteLength, expected.bundleByteLength);
    assert.equal(actual.bundleSha256, expected.bundleSha256);
    assert.equal(actual.rawByteLength, 84);
    assert.equal(actual.rawSha256, expected.rawSha256);
    assert.equal(actual.config.componentIdentity, expected.componentIdentity);

    const scene = JSON.parse(fs.readFileSync(
      path.join(ROOT, "public", `scene.${expected.cardId}.json`),
      "utf8",
    ));
    const sceneConfig = scene.runtimeSettings.cardMRR[expected.componentIdentity];
    assert.ok(sceneConfig);
    for (const [field, value] of Object.entries(actual.config)) {
      assert.deepEqual(sceneConfig[field], value, `${expected.cardId}: ${field}`);
    }
    const descendants = new Set(actual.descendantRendererIdentities);
    const boundRenderers = new Set(
      Object.values(sceneConfig.rendererBindings).flat(),
    );
    assert.deepEqual(
      Object.fromEntries(
        Object.entries(sceneConfig.rendererBindings).map(([role, rows]) => [
          role,
          rows.length,
        ]),
      ),
      { main: 4, effect: 2, flash: 1 },
    );
    for (const rendererIdentity of boundRenderers) {
      assert.ok(descendants.has(rendererIdentity));
    }
    const draws = scene.officialDraws.filter(
      (draw) => draw.rendererProperties?.cardMRR?.componentIdentity
        === expected.componentIdentity,
    );
    assert.equal(draws.length, 10);
    for (const draw of draws) {
      const binding = draw.rendererProperties.cardMRR;
      assert.equal(draw.rendererIdentity, binding.rendererIdentity);
      assert.ok(
        sceneConfig.rendererBindings[binding.role].includes(
          binding.rendererIdentity,
        ),
      );
      assert.ok(ROLE_TAGS[binding.role].has(binding.searchTag));
    }
  }

  const settings = evidence.animationSettings;
  for (const field of [
    "bundleByteLength",
    "bundleSha256",
    "rawByteLength",
    "rawSha256",
  ]) {
    assert.equal(settings[field], EXPECTED_SETTINGS[field]);
  }
  assert.equal(settings.settings.identity, EXPECTED_SETTINGS.identity);
  for (const expected of CASES) {
    const scene = JSON.parse(fs.readFileSync(
      path.join(ROOT, "public", `scene.${expected.cardId}.json`),
      "utf8",
    ));
    assert.deepEqual(
      scene.runtimeSettings.mrrAnimation[EXPECTED_SETTINGS.identity],
      settings.settings,
    );
  }

  assert.equal(evidence.shaderSearchTags.length, 5);
  let producerBindingCount = 0;
  for (const shader of evidence.shaderSearchTags) {
    const [identity, searchTag, bundleLength, bundleHash, rawHash] =
      EXPECTED_SHADERS[shader.label];
    assert.equal(shader.shaderIdentity, identity);
    assert.equal(shader.searchTag, searchTag);
    assert.equal(shader.subShaderTags.SearchTag, searchTag);
    assert.equal(shader.bundleByteLength, bundleLength);
    assert.equal(shader.bundleSha256, bundleHash);
    assert.equal(shader.rawSha256, rawHash);
    const manifest = JSON.parse(fs.readFileSync(
      path.join(ROOT, "public", "shaders", MANIFESTS[shader.label]),
      "utf8",
    ));
    assert.equal(manifest.official_selector.shaderIdentity, identity);
    const materialNames = new Set([
      ...(manifest.runtime_contract.material_uniforms.floats || []),
      ...(manifest.runtime_contract.material_uniforms.ints || []),
      ...Object.keys(manifest.runtime_contract.material_uniforms.vectors || {}),
    ]);
    const expectedProducer = shader.label === "Effect_Emit"
      ? CARD_MRR_MATERIAL_OVERRIDE_PRODUCER_SCHEMA
      : CARD_MRR_PRODUCER_SCHEMA;
    for (const name of MRR_UNIFORMS[shader.label]) {
      assert.equal(
        manifest.runtime_contract.dynamic_uniforms[name]?.source,
        expectedProducer,
      );
      assert.equal(materialNames.has(name), false);
      producerBindingCount += 1;
    }
    assert.ok(
      manifest.runtime_boundaries.some(
        (boundary) =>
          boundary.producer === expectedProducer
          && boundary.status === "known-implementation",
      ),
    );
  }
  assert.equal(producerBindingCount, 18);

  return {
    status: "pass",
    exact: {
      selectedOfficialSample: true,
      il2cppMethods: "10/10",
      serializedComponents: "2/2",
      serializedAnimationSettings: "1/1",
      shaderSearchTags: "5/5",
      sceneRendererRoleBindings: "2/2 scenes",
      selectorProducerBindings: "18/18",
    },
    knownImplementation: [
      "tilt history, upward threshold trigger, optional speed adjustment and animation lifetime",
      "15 serialized AnimationCurve evaluations and 14 MPB payload fields",
      "component-identity state sharing across main, effect and flash renderer groups",
    ],
    runtimeRequired: [
      "Unity LateUpdate and Time.time/deltaTime sampling",
      "official guest MaterialPropertyBlock submission",
    ],
  };
}

const report = auditOfficialCardMRR();
if (process.argv.includes("--json")) console.log(JSON.stringify(report, null, 2));
else {
  console.log("Official CardMRRObject producer audit: PASS");
  console.log(`  IL2CPP methods:       ${report.exact.il2cppMethods}`);
  console.log(`  serialized assets:    ${report.exact.serializedComponents} + ${report.exact.serializedAnimationSettings}`);
  console.log(`  SearchTags:           ${report.exact.shaderSearchTags}`);
  console.log(`  producer bindings:    ${report.exact.selectorProducerBindings}`);
  console.log("  runtime boundaries:   LateUpdate/Time + guest MPB submission");
}
