#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function source(relative) {
  return fs.readFileSync(path.join(ROOT, relative), "utf8");
}

function requireText(relative, pattern, label) {
  assert.match(source(relative), pattern, `${relative}: missing ${label}`);
}

function forbidText(relative, pattern, label) {
  assert.doesNotMatch(source(relative), pattern, `${relative}: forbidden ${label}`);
}

const helper = "build/atomic-publish.mjs";
for (const api of [
  "atomicWriteFile",
  "atomicWriteFileSync",
  "atomicCopyFileSync",
  "atomicLinkFileSync",
  "publishDirectorySync",
  "readOrCreateFile",
  "withFileLock",
]) {
  requireText(helper, new RegExp(`export (?:async )?function ${api}\\b`), api);
}
assert.equal(
  [...source(helper).matchAll(/rename(?:Sync)?WithRetry\(destination,\s*backup\)/g)].length,
  1,
  `${helper}: only recoverable directory publication may move the valid destination`,
);

requireText(
  "server.mjs",
  /withFileLock\(\s*TMP_RUNTIME_EVIDENCE,[\s\S]*?writeTmpRuntimeEvidence/,
  "cross-process TMP evidence transaction",
);
requireText(
  "server.mjs",
  /withFileLock\(\s*FULL_RUNTIME_EVIDENCE,[\s\S]*?writeFullRuntimeCapture/,
  "cross-process full-runtime evidence transaction",
);
forbidText(
  "server.mjs",
  /\b(?:writeFile|rename|unlink|copyFile|rm)\s*\(/,
  "raw final evidence publication",
);

const criticalSingleFilePublishers = [
  "build/prebuild_text.mjs",
  "build/build.mjs",
  "build/fetch-aladin-repair-set.mjs",
  "build/gather.mjs",
  "build/materialize-official-sample-inputs.mjs",
  "build/materialize-official-card-examples.mjs",
  "build/build-official-tmp-sprite.mjs",
  "build/build-official-tmp-sprite-program.mjs",
];
for (const relative of criticalSingleFilePublishers) {
  requireText(relative, /atomic(?:Write|Copy|Link)File(?:Sync)?\(/, "atomic publisher");
}

forbidText(
  "build/fetch-aladin-repair-set.mjs",
  /\.part\b|await rm\(|await rename\(|await writeFile\(/,
  "delete-before-download publication",
);
forbidText(
  "build/materialize-official-sample-inputs.mjs",
  /\.part\b|\b(?:writeFileSync|renameSync|copyFileSync|linkSync|rmSync)\s*\(/,
  "raw materialized-input publication",
);
forbidText(
  "build/prebuild_text.mjs",
  /\bwriteFileSync\s*\(/,
  "in-place localized text overwrite",
);
forbidText(
  "build/gather.mjs",
  /\bcopyFileSync\s*\(/,
  "in-place gathered asset overwrite",
);

const candidateFiles = fs.readdirSync(path.join(ROOT, "build"))
  .filter((name) => /^build-candidate-.*\.mjs$/.test(name));
for (const name of candidateFiles) {
  const relative = `build/${name}`;
  const content = source(relative);
  assert.doesNotMatch(
    content,
    /\bfs\.(?:rmSync|unlinkSync|renameSync|copyFileSync)\s*\(/,
    `${relative}: raw candidate final-path mutation`,
  );
  for (const match of content.matchAll(/\bfs\.writeFileSync\s*\(([^;\n]+)/g)) {
    assert.match(
      match[1],
      /\b(?:staging|temp|tmp|spv)\b/i,
      `${relative}: writeFileSync is only allowed for an unpublished staging/scratch path`,
    );
  }
}

const exactFinalPublishers = [
  "build/exact-selector-port-core.mjs",
  "build/build-exact-bloom.mjs",
  "build/build-exact-final-blit.mjs",
  "build/build-exact-homography.mjs",
  "build/build-exact-side-back.mjs",
  "build/build-exact-simple-opaque.mjs",
  "build/build-exact-tmp-sdf.mjs",
  "build/build-exact-ui-default-from-rt.mjs",
  "build/build-exact-ui-default-to-rt.mjs",
];
for (const relative of exactFinalPublishers) {
  requireText(relative, /atomicWriteFileSync\(/, "atomic exact-port output");
}

console.log(
  "Atomic publish boundary audit OK "
  + `(${candidateFiles.length} candidate generators, `
  + `${exactFinalPublishers.length} exact output paths)`,
);
