#!/usr/bin/env node
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CACHE = path.join(ROOT, "$cache", "toolchains");
const SMOLV_CPP = path.join(ROOT, "build", "shaderdec", "smolv.cpp");
const SMOLV_HEADER = path.join(ROOT, "build", "shaderdec", "smolv.h");
const ORACLE_SOURCE = path.join(ROOT, "build", "shaderdec", "smolv_oracle.cpp");
const PYTHON_AUDIT = path.join(ROOT, "build", "audit_official_smolv_corpus.py");
const UPSTREAM = Object.freeze({
  repository: "https://github.com/aras-p/smol-v",
  commit: "9dd54c379ac29fa148cb1b829bb939ba7381d8f4",
  cppNormalizedSha256: "c3fc96b455ee173250f3302c187f1dea4dbc8ab45bf2ab370e63aa271ad0b790",
  headerSha256: "2030c450cc18649747999362aec474b2e239d974ddc3285e0cf81ba8e956b1c0",
  zigVersion: "0.14.1",
  zigExeSha256: "1ddf230367e07738c4a769eae66c1db7469e37bd520e81c86356453d0db2b9fd",
});

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    ...options,
  });
  if (result.error) throw result.error;
  assert.equal(
    result.status,
    0,
    `${command} ${args.join(" ")} failed\n${result.stdout || ""}${result.stderr || ""}`,
  );
  return result.stdout.trim();
}

function findZig() {
  const candidates = [
    process.env.PCR_ZIG,
    path.join(CACHE, "ziglang-0.14.1", "ziglang", "zig.exe"),
    path.join(CACHE, "zig-x86_64-windows-0.14.1", "zig.exe"),
    "zig",
  ].filter(Boolean);
  for (const candidate of candidates) {
    const result = spawnSync(candidate, ["version"], { encoding: "utf8" });
    if (!result.error && result.status === 0 && result.stdout.trim() === UPSTREAM.zigVersion) return candidate;
  }
  throw new Error("Zig 0.14.1 is required; set PCR_ZIG or install the pinned toolchain under $cache/toolchains");
}

function findPython() {
  if (process.env.PCR_PYTHON) return process.env.PCR_PYTHON;
  if (process.platform !== "win32") return process.env.PYTHON || "python3";
  const probe = spawnSync(
    process.env.ComSpec || "cmd.exe",
    ["/d", "/s", "/c", "pyenv which python"],
    { cwd: ROOT, encoding: "utf8" },
  );
  assert.equal(probe.status, 0, `cannot resolve pyenv Python\n${probe.stderr || ""}`);
  const executable = probe.stdout.trim();
  assert.ok(fs.existsSync(executable) && fs.statSync(executable).isFile(),
    `resolved Python executable is missing: ${executable}`);
  return executable;
}

assert.equal(
  sha256(fs.readFileSync(SMOLV_CPP, "utf8").replace(/\r\n/g, "\n")),
  UPSTREAM.cppNormalizedSha256,
  `smolv.cpp drifted from ${UPSTREAM.commit}`,
);
assert.equal(sha256(fs.readFileSync(SMOLV_HEADER)), UPSTREAM.headerSha256,
  `smolv.h drifted from ${UPSTREAM.commit}`);

const zig = findZig();
assert.equal(sha256(fs.readFileSync(zig)), UPSTREAM.zigExeSha256, "pinned Zig executable identity drifted");
const sourceSetSha256 = sha256(Buffer.concat([
  fs.readFileSync(SMOLV_CPP),
  fs.readFileSync(SMOLV_HEADER),
  fs.readFileSync(ORACLE_SOURCE),
]));
fs.mkdirSync(CACHE, { recursive: true });
const oracle = path.join(CACHE, `smolv-oracle-${sourceSetSha256.slice(0, 16)}.exe`);
if (!fs.existsSync(oracle)) {
  run(zig, [
    "c++",
    "-std=c++11",
    "-O2",
    "-DNDEBUG",
    `-I${path.dirname(SMOLV_HEADER)}`,
    ORACLE_SOURCE,
    SMOLV_CPP,
    "-o",
    oracle,
  ]);
}

const output = run(findPython(), [
  "-B",
  PYTHON_AUDIT,
  "--oracle",
  oracle,
  ...(process.env.PCR_DECRYPTED_ROOT ? ["--decrypted-root", process.env.PCR_DECRYPTED_ROOT] : []),
  ...(process.env.SPIRV_VAL ? ["--spirv-val", process.env.SPIRV_VAL] : []),
]);
const report = JSON.parse(output);
assert.equal(report.schema, "pocket-card-render/official-smolv-corpus@1");
assert.equal(report.summary.occurrences, 588);
assert.equal(report.summary.uniqueCompressed, 380);
assert.equal(report.summary.validatedUniqueSpirv, 380);
assert.equal(report.summary.truncationMutationsRejected, 380);

console.log("Official SMOL-V full-corpus differential: PASS");
console.log(`  upstream: ${UPSTREAM.commit}`);
console.log(`  compiler: Zig ${run(zig, ["version"])}`);
console.log(`  physical occurrences: ${report.summary.occurrences}`);
console.log(`  unique Python/C++ byte-identical modules: ${report.summary.uniqueCompressed}`);
console.log(`  spirv-val + truncation mutations: ${report.summary.validatedUniqueSpirv}/${report.summary.truncationMutationsRejected}`);
console.log(`  occurrence digest: ${report.digests.occurrencesSha256}`);
