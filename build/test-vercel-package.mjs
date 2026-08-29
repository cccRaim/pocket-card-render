#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BUILDER = path.join(ROOT, "build", "build-vercel-package.mjs");

function sha256(filename) {
  return createHash("sha256").update(fs.readFileSync(filename)).digest("hex");
}

function runBuilder(output, extra = []) {
  return spawnSync(
    process.execPath,
    [BUILDER, "--out", output, ...extra],
    {
      cwd: ROOT,
      encoding: "utf8",
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024,
    },
  );
}

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pcr-vercel-package-"));
const output = path.join(temporaryRoot, "deployment");
try {
  const first = runBuilder(output);
  assert.equal(first.status, 0, first.stderr || first.stdout);
  const manifest = path.join(output, "deployment-manifest.json");
  const firstHash = sha256(manifest);
  const firstReport = JSON.parse(fs.readFileSync(manifest, "utf8"));
  assert.equal(firstReport.schema, "pocket-card-render/vercel-package@1");
  assert(firstReport.output.fileCount > 0);
  assert(firstReport.output.byteLength > 0);

  const rejected = runBuilder(output, ["--locales", "xx_XX"]);
  assert.notEqual(rejected.status, 0, "unsupported locale build must fail");
  assert.equal(
    sha256(manifest),
    firstHash,
    "a failed build must preserve the previous deployment byte-for-byte",
  );

  const second = runBuilder(output);
  assert.equal(second.status, 0, second.stderr || second.stdout);
  assert.equal(sha256(manifest), firstHash, "repeated builds must be deterministic");
  assert.deepEqual(
    fs.readdirSync(temporaryRoot),
    ["deployment"],
    "staging and previous trees must be cleaned",
  );
  console.log(
    `Vercel package transaction tests OK `
    + `(${firstReport.output.fileCount} files, ${firstReport.output.byteLength} bytes)`,
  );
} finally {
  fs.rmSync(temporaryRoot, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 50,
  });
}
