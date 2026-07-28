#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CARD_BEHAVIOUR_ROTATION_PRODUCER_SCHEMA,
  OFFICIAL_CARD_RENDERER_HOLOGRAM_ROTATION,
} from "../public/render/card-behaviour-rotation.js";

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
  "CardBehaviour.UpdateHologramRotation": [
    0x44133D4, 392,
    "dec4d2a68cd71b235dd6d5f8ee07ebd5ab5932a42da277578166a43a90584cab",
  ],
  "CardBehaviour..cctor": [
    0x4413B88, 104,
    "90f39cb126447366dc60f587b93e5ec0f524b40755adca52eb80c3c508ed5ba3",
  ],
  "CardDataGroup..ctor": [
    0x4445B84, 164,
    "787f1d605e38a2548ab0567f35c542da694c6130b21f7e43d6959e3d7bd57b36",
  ],
};
const EXPECTED_WINDOWS = {
  "CardRenderer.LoadAsset": [
    0x444574C, 192, 0x4445808,
    "baa9754994d6915e74a977e22183deaf1079f43ce7f5d22be5b055600863b50e",
  ],
  "UICardViewLoaderProgressive.LoadDetailCard": [
    0x4446A48, 84, 0x4446A98,
    "4fd1c8ab1841a402825c0e075792954e1ff3976988ee24effc96ff60ef5cf998",
  ],
  "UICardViewLoaderProgressive.LoadCard": [
    0x4447C10, 76, 0x4447C58,
    "e1e6cd5d33bb073a87738c246f37d88d50edd41850519a2e188b9ae17409f619",
  ],
  "UICardViewLoaderSimple.LoadCard": [
    0x44484C0, 92, 0x4448518,
    "54e58bcc5ede69d2b1db74ab2f445d22813401c90a5a205f21719b1c51899eba",
  ],
};
const EXPECTED_RELOCATIONS = {
  "UnityEngine.Vector3_TypeInfo": [
    "0x6bd9418", 1027, "0x747ffa8",
    "f2d9a186395d1ebb2f3ab428bceb90e42622b5c8f57d4e4f3941953c858bd851",
  ],
  CardBehaviour_TypeInfo: [
    "0x6c4a670", 1027, "0x746a340",
    "861ced8d5e5868b448689494c79c340901b486573928a5330803d6e3c20060cb",
  ],
  CardDataGroup_TypeInfo: [
    "0x6be3f30", 1027, "0x746a368",
    "dd7abe3da3415fa7835cdaf80fcb97943dc41f228fb0f0d3427c357d0f343bc6",
  ],
  _Rotation: [
    "0x6c4a6b0", 1027, "0x7573f90",
    "3e5c9462952995c7c76e2b786d83d8c0ad94d306b88bfb1298d333839252d879",
  ],
};
const MANIFESTS = [
  "card_parallax_marble_magnetic_uniforms.json",
  "card_parallax_marble_outside_relax_uniforms.json",
];

function extractEvidence() {
  const runner = process.env.PYTHON || "python";
  const result = spawnSync(
    runner,
    ["-B", "build/extract_official_card_behaviour_rotation.py"],
    {
      cwd: ROOT,
      encoding: "utf8",
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024,
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

export function auditOfficialCardBehaviourRotation() {
  const evidence = extractEvidence();
  assert.equal(
    evidence.schema,
    "pocket-card-render/official-card-behaviour-rotation-evidence@1",
  );
  assert.deepEqual(evidence.source, EXPECTED_SOURCE);
  for (const [name, [rva, byteLength, sha256]] of
    Object.entries(EXPECTED_METHODS)) {
    assert.deepEqual(evidence.methods[name], { rva, byteLength, sha256 });
  }
  for (const [name, [rva, byteLength, constructorCallRva, sha256]] of
    Object.entries(EXPECTED_WINDOWS)) {
    assert.deepEqual(evidence.zeroInputWindows[name], {
      rva,
      byteLength,
      sha256,
      constructorCallRva,
      constructorTargetRva: 0x4445B84,
    });
  }
  for (const [name, [targetRva, type, addendRva, sha256]] of
    Object.entries(EXPECTED_RELOCATIONS)) {
    assert.deepEqual(evidence.relocations[name], {
      targetRva,
      type,
      addendRva,
      sha256,
    });
  }
  assert.deepEqual(OFFICIAL_CARD_RENDERER_HOLOGRAM_ROTATION, [0, 0, 0]);

  for (const filename of MANIFESTS) {
    const manifest = JSON.parse(fs.readFileSync(
      path.join(ROOT, "public", "shaders", filename),
      "utf8",
    ));
    assert.deepEqual(
      manifest.runtime_contract.dynamic_uniforms._Rotation,
      {
        type: "vec3",
        source: CARD_BEHAVIOUR_ROTATION_PRODUCER_SCHEMA,
      },
    );
    const boundary = manifest.runtime_boundaries.find(
      (row) => row.producer === CARD_BEHAVIOUR_ROTATION_PRODUCER_SCHEMA,
    );
    assert.equal(boundary?.status, "partial-exact");
    assert.deepEqual(boundary?.payload, [{ name: "_Rotation", type: "vec3" }]);
  }

  return {
    status: "pass",
    exact: {
      il2cppMethods: "3/3",
      canonicalZeroInputPaths: "4/4",
      selectorBindings: "2/2",
    },
    runtimeRequired: [
      "official guest MaterialPropertyBlock submission and GPU upload",
      "non-canonical callers that intentionally provide a non-zero HologramRotation",
    ],
  };
}

const report = auditOfficialCardBehaviourRotation();
if (process.argv.includes("--json")) console.log(JSON.stringify(report, null, 2));
else {
  console.log("Official CardBehaviour hologram rotation audit: PASS");
  console.log(`  IL2CPP methods:       ${report.exact.il2cppMethods}`);
  console.log(`  zero-input paths:     ${report.exact.canonicalZeroInputPaths}`);
  console.log(`  selector bindings:    ${report.exact.selectorBindings}`);
  console.log("  runtime boundary:     guest MPB/GPU submission");
}
