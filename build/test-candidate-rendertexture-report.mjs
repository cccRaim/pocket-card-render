#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CANDIDATE_SAMPLE_ID =
  "ptcgp-1.7.0-unity-6000.0.69f1-candidate";
const CANDIDATE_STEM = CANDIDATE_SAMPLE_ID.replace(/-candidate$/, "");
const REPORT = path.join(
  ROOT,
  "build",
  "official-samples",
  `${CANDIDATE_STEM}-serialized-ui-corpus.json`,
);
const BUILDER = path.join(
  ROOT,
  "build",
  "build-candidate-rendertexture-report.mjs",
);

function runExtractorMutation(name, mutation, expectedPattern) {
  const result = spawnSync(
    process.execPath,
    [BUILDER, "--check"],
    {
      cwd: ROOT,
      encoding: "utf8",
      windowsHide: true,
      env: {
        ...process.env,
        PCR_TEST_CANDIDATE_RENDERTEXTURE_MUTATION: mutation,
        PYTHONDONTWRITEBYTECODE: "1",
        PYTHONIOENCODING: "utf-8",
        PYTHONUTF8: "1",
      },
    },
  );
  assert.notEqual(result.status, 0, `${name} mutation was accepted`);
  assert.match(
    `${result.stdout}\n${result.stderr}`,
    expectedPattern,
    `${name} mutation failed for an unrelated reason`,
  );
}

function runMutation(name, mutate, expectedMessage) {
  const temporaryRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), `pcr-rendertexture-${name}-`),
  );
  try {
    const report = JSON.parse(fs.readFileSync(REPORT, "utf8"));
    mutate(report);
    const mutatedPath = path.join(temporaryRoot, "serialized-ui.json");
    fs.writeFileSync(mutatedPath, `${JSON.stringify(report, null, 2)}\n`);
    const result = spawnSync(
      process.execPath,
      [
        BUILDER,
        "--check",
        "--serialized-ui-report",
        mutatedPath,
      ],
      {
        cwd: ROOT,
        encoding: "utf8",
        windowsHide: true,
        env: {
          ...process.env,
          PYTHONDONTWRITEBYTECODE: "1",
          PYTHONIOENCODING: "utf-8",
          PYTHONUTF8: "1",
        },
      },
    );
    assert.notEqual(result.status, 0, `${name} mutation was accepted`);
    const output = `${result.stdout}\n${result.stderr}`;
    assert.match(
      output,
      new RegExp(expectedMessage.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      `${name} failed for an unrelated reason:\n${output}`,
    );
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

runMutation(
  "sample-manifest",
  (report) => {
    report.candidate.sampleManifestSha256 = "0".repeat(64);
  },
  "serialized-UI corpus is bound to another sample manifest",
);

runMutation(
  "detail-card-bundle",
  (report) => {
    report.inputs.renderTextureDetailCardViewBundle.sha256 = "0".repeat(64);
  },
  "serialized-UI corpus is bound to another detail-card bundle",
);

runExtractorMutation(
  "candidate Bloom FilterMode",
  "bloom-filter",
  /expected 'mov w3, #1'/,
);

const sceneMrtMutation = spawnSync(
  process.execPath,
  [BUILDER, "--check"],
  {
    cwd: ROOT,
    encoding: "utf8",
    windowsHide: true,
    env: {
      ...process.env,
      PCR_TEST_CANDIDATE_RENDERTEXTURE_MUTATION:
        "rendergraph-mrt-slot",
      PYTHONDONTWRITEBYTECODE: "1",
      PYTHONIOENCODING: "utf-8",
      PYTHONUTF8: "1",
    },
  },
);
assert.notEqual(
  sceneMrtMutation.status,
  0,
  "candidate RenderGraph emissive attachment mutation was accepted",
);
assert.match(
  `${sceneMrtMutation.stdout}\n${sceneMrtMutation.stderr}`,
  /expected 'mov w3, #2'/,
  "candidate RenderGraph MRT mutation failed for an unrelated reason",
);

const sceneMrtMetadataMutation = spawnSync(
  process.execPath,
  [BUILDER, "--check"],
  {
    cwd: ROOT,
    encoding: "utf8",
    windowsHide: true,
    env: {
      ...process.env,
      PCR_TEST_CANDIDATE_RENDERTEXTURE_MUTATION:
        "rendergraph-mrt-metadata",
      PYTHONDONTWRITEBYTECODE: "1",
      PYTHONIOENCODING: "utf-8",
      PYTHONUTF8: "1",
    },
  },
);
assert.notEqual(
  sceneMrtMetadataMutation.status,
  0,
  "candidate RenderGraph metadata relocation mutation was accepted",
);
assert.match(
  `${sceneMrtMetadataMutation.stdout}\n${sceneMrtMetadataMutation.stderr}`,
  /expected 'Method\$UnityEngine\.Rendering\.ContextContainer\.Get<CustomBloomData>\(\)'/,
  "candidate RenderGraph metadata mutation failed for an unrelated reason",
);

const playerTransferMutation = spawnSync(
  process.execPath,
  [BUILDER, "--check"],
  {
    cwd: ROOT,
    encoding: "utf8",
    windowsHide: true,
    env: {
      ...process.env,
      PCR_TEST_CANDIDATE_RENDERTEXTURE_MUTATION:
        "player-settings-transfer-tail",
      PYTHONDONTWRITEBYTECODE: "1",
      PYTHONIOENCODING: "utf-8",
      PYTHONUTF8: "1",
    },
  },
);
assert.notEqual(
  playerTransferMutation.status,
  0,
  "candidate PlayerSettings transfer-tail mutation was accepted",
);
assert.match(
  `${playerTransferMutation.stdout}\n${playerTransferMutation.stderr}`,
  /does not reference member #0x4cc/,
  "candidate PlayerSettings transfer-tail mutation failed for an unrelated reason",
);

const playerSuffixMutation = spawnSync(
  process.execPath,
  [BUILDER, "--check"],
  {
    cwd: ROOT,
    encoding: "utf8",
    windowsHide: true,
    env: {
      ...process.env,
      PCR_TEST_CANDIDATE_RENDERTEXTURE_MUTATION:
        "player-settings-unread-suffix",
      PYTHONDONTWRITEBYTECODE: "1",
      PYTHONIOENCODING: "utf-8",
      PYTHONUTF8: "1",
    },
  },
);
assert.notEqual(
  playerSuffixMutation.status,
  0,
  "candidate PlayerSettings unread-suffix mutation was accepted",
);
assert.match(
  `${playerSuffixMutation.stdout}\n${playerSuffixMutation.stderr}`,
  /official-transfer unread suffix expected 01000000, got 00000000/,
  "candidate PlayerSettings unread-suffix mutation failed for an unrelated reason",
);

runExtractorMutation(
  "candidate native RenderTexture format table",
  "native-format-table",
  /requested ARGB32 Linear GraphicsFormat expected 9, got 8/,
);

runExtractorMutation(
  "candidate native RenderTexture descriptor defaults",
  "native-defaults",
  /RenderTextureDesc default msaaSamples expected 2, got 1/,
);

console.log(
  "Candidate RenderTexture binding/native-default/Bloom/scene-MRT/PlayerSettings mutation tests OK",
);
