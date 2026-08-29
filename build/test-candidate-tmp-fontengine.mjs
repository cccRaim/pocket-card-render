#!/usr/bin/env node
import assert from "node:assert/strict";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BUILDER = path.join(
  ROOT,
  "build",
  "build-candidate-tmp-fontengine-report.mjs",
);

function mutation(name, value, pattern) {
  const result = spawnSync(
    process.execPath,
    [BUILDER, "--check"],
    {
      cwd: ROOT,
      encoding: "utf8",
      windowsHide: true,
      env: {
        ...process.env,
        PCR_TEST_CANDIDATE_TMP_FONTENGINE_MUTATION: value,
        PYTHONDONTWRITEBYTECODE: "1",
        PYTHONIOENCODING: "utf-8",
        PYTHONUTF8: "1",
      },
    },
  );
  assert.notEqual(result.status, 0, `${name} mutation was accepted`);
  assert.match(
    `${result.stdout}\n${result.stderr}`,
    pattern,
    `${name} mutation failed for an unrelated reason`,
  );
}

mutation(
  "dynamic atlas render mode",
  "render-mode",
  /expected 'mov w9, #0x1044', got 'mov w9, #0x1045'/,
);
mutation(
  "edge-delta call count",
  "edge-delta-count",
  /edge-delta call count expected 8, got 9/,
);

console.log("Candidate Unity 6 TMP FontEngine mutation tests OK");
