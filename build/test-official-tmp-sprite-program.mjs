import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const GENERATOR = "build/build-official-tmp-sprite-program.mjs";
const EXTRACTOR = "build/extract_official_tmp_sprite_program.py";
const CONTRACT = "public/render/tmp-sprite-program.json";
const SOURCES = {
  vertex: "public/shaders/tmp_sprite_to_rt.vert.glsl",
  fragment: "public/shaders/tmp_sprite_to_rt.frag.glsl",
};
const REPOSITORY_INPUTS = [GENERATOR, EXTRACTOR, CONTRACT, ...Object.values(SOURCES)];
const PYTHON = process.env.PYTHON || "python";
const MAX_BUFFER = 16 * 1024 * 1024;

function absolute(root, relative) {
  return path.join(root, ...relative.split("/"));
}

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: MAX_BUFFER,
    windowsHide: true,
    ...options,
  });
}

function outputOf(result) {
  return `${result.stdout || ""}\n${result.stderr || ""}`;
}

function requireSuccess(result, label, expectedOutput) {
  assert.ifError(result.error);
  assert.equal(
    result.status,
    0,
    `${label} failed with status ${result.status}:\n${outputOf(result)}`,
  );
  if (expectedOutput) assert.match(outputOf(result), expectedOutput, label);
}

function requireFailure(result, label, expectedOutput) {
  assert.ifError(result.error);
  assert.notEqual(result.status, 0, `${label} unexpectedly passed`);
  const output = outputOf(result);
  for (const pattern of Array.isArray(expectedOutput) ? expectedOutput : [expectedOutput]) {
    assert.match(output, pattern, `${label} failed for the wrong reason:\n${output}`);
  }
}

function extractOfficialEvidence(contract) {
  const args = [
    EXTRACTOR,
    "--expected-selector-id",
    contract.officialSelector.selectorId,
    "--expected-candidate-witness-id",
    contract.officialSelector.candidateWitnessId,
  ];
  if (process.env.PCR_DECRYPTED_ROOT) {
    args.push("--decrypted-root", process.env.PCR_DECRYPTED_ROOT);
  }
  if (process.env.PCR_OFFICIAL_SAMPLE_MANIFEST) {
    args.push(
      "--official-sample-manifest",
      process.env.PCR_OFFICIAL_SAMPLE_MANIFEST,
    );
  }
  const result = run(PYTHON, args, {
    shell: process.platform === "win32",
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
  });
  requireSuccess(result, "official TMP Sprite extractor");
  return JSON.parse(result.stdout.replace(/^\uFEFF/, ""));
}

function writeFixtureExtractor(target) {
  const source = String.raw`const fs = require("node:fs");
const path = require("node:path");

const evidence = JSON.parse(
  fs.readFileSync(path.join(__dirname, "tmp-sprite-evidence.json"), "utf8"),
);
const mutation = process.env.PCR_TMP_SPRITE_MUTATION || "";
const hash = (character) => character.repeat(64);

if (mutation === "selector") {
  evidence.selector.selectorId = hash("0");
} else if (mutation === "candidate") {
  evidence.selector.candidateWitnessId = hash("1");
} else if (mutation === "pass-state") {
  evidence.pass.passStateSha256 = hash("2");
} else if (mutation === "common-bindings") {
  evidence.pass.commonBindingsSha256 = hash("3");
} else if (mutation.startsWith("runtime-boundary:")) {
  const id = mutation.slice("runtime-boundary:".length);
  const boundary = evidence.runtimeBoundaries.find((entry) => entry.id === id);
  if (!boundary) throw new Error("unknown runtime boundary mutation: " + id);
  boundary.status = "exact";
} else if (mutation) {
  throw new Error("unknown TMP Sprite mutation: " + mutation);
}

process.stdout.write(JSON.stringify(evidence));
`;
  fs.writeFileSync(target, source);
}

function createFixture(parent, name, evidence) {
  const root = path.join(parent, name);
  fs.mkdirSync(absolute(root, "build"), { recursive: true });
  fs.mkdirSync(absolute(root, "public/render"), { recursive: true });
  fs.mkdirSync(absolute(root, "public/shaders"), { recursive: true });
  fs.copyFileSync(absolute(ROOT, GENERATOR), absolute(root, GENERATOR));
  fs.copyFileSync(absolute(ROOT, CONTRACT), absolute(root, CONTRACT));
  for (const relative of Object.values(SOURCES)) {
    fs.copyFileSync(absolute(ROOT, relative), absolute(root, relative));
  }
  fs.writeFileSync(
    absolute(root, "build/official-sample.mjs"),
    [
      `export const officialSample = Object.freeze(${JSON.stringify({
        sampleId: evidence.provenance.sampleId,
      })});`,
      `export const officialSampleSha256 = ${JSON.stringify(
        evidence.provenance.sampleManifestSha256,
      )};`,
      "",
    ].join("\n"),
  );
  fs.writeFileSync(
    absolute(root, "build/tmp-sprite-evidence.json"),
    JSON.stringify(evidence),
  );
  writeFixtureExtractor(absolute(root, EXTRACTOR));
  return root;
}

function runFixture(root, mutation = "") {
  return run(process.execPath, [absolute(root, GENERATOR), "--check"], {
    cwd: root,
    env: {
      ...process.env,
      PYTHON: process.execPath,
      PYTHONDONTWRITEBYTECODE: "1",
      PCR_TMP_SPRITE_MUTATION: mutation,
    },
  });
}

const repositorySnapshot = new Map(
  REPOSITORY_INPUTS.map((relative) => [
    relative,
    fs.readFileSync(absolute(ROOT, relative)),
  ]),
);
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pcr-test-tmp-sprite-"));

try {
  const baseline = run(process.execPath, [absolute(ROOT, GENERATOR), "--check"]);
  requireSuccess(
    baseline,
    "official TMP Sprite generator --check",
    /verified official TMP Sprite\(to RT\) selector-bound static port/,
  );

  const contract = JSON.parse(fs.readFileSync(absolute(ROOT, CONTRACT), "utf8"));
  const evidence = extractOfficialEvidence(contract);

  const evidenceMutations = [
    {
      name: "selector",
      mutation: "selector",
      expected: /0{64}/,
    },
    {
      name: "candidate",
      mutation: "candidate",
      expected: /1{64}/,
    },
    {
      name: "pass-state hash",
      mutation: "pass-state",
      expected: /2{64}/,
    },
    {
      name: "common-bindings hash",
      mutation: "common-bindings",
      expected: /3{64}/,
    },
  ];
  for (const test of evidenceMutations) {
    const fixture = createFixture(
      tempRoot,
      `evidence-${test.mutation}`,
      evidence,
    );
    requireFailure(
      runFixture(fixture, test.mutation),
      `${test.name} mutation`,
      test.expected,
    );
  }

  for (const boundary of evidence.runtimeBoundaries) {
    const mutation = `runtime-boundary:${boundary.id}`;
    const fixture = createFixture(
      tempRoot,
      `boundary-${boundary.id}`,
      evidence,
    );
    requireFailure(
      runFixture(fixture, mutation),
      `${boundary.id} runtime-boundary promotion`,
      [/runtime-required/, /\bexact\b/],
    );
  }

  for (const [stage, relative] of Object.entries(SOURCES)) {
    const fixture = createFixture(tempRoot, `glsl-${stage}`, evidence);
    fs.appendFileSync(absolute(fixture, relative), "\n// mutation\n");
    requireFailure(
      runFixture(fixture),
      `${stage} GLSL source mutation`,
      new RegExp(
        `${path.basename(relative).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} drifted`,
      ),
    );
  }

  for (const stage of Object.keys(SOURCES)) {
    const fixture = createFixture(
      tempRoot,
      `contract-source-hash-${stage}`,
      evidence,
    );
    const fixtureContractPath = absolute(fixture, CONTRACT);
    const fixtureContract = JSON.parse(
      fs.readFileSync(fixtureContractPath, "utf8"),
    );
    fixtureContract.webglSources[stage].sha256 = "4".repeat(64);
    fs.writeFileSync(
      fixtureContractPath,
      `${JSON.stringify(fixtureContract, null, 2)}\n`,
    );
    requireFailure(
      runFixture(fixture),
      `${stage} contract source-hash mutation`,
      /tmp-sprite-program\.json drifted/,
    );
  }

  console.log(
    `official TMP Sprite program: generator check + ${
      evidenceMutations.length
      + evidence.runtimeBoundaries.length
      + Object.keys(SOURCES).length * 2
    } fail-closed mutations passed`,
  );
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
  for (const [relative, expected] of repositorySnapshot) {
    assert.ok(
      fs.readFileSync(absolute(ROOT, relative)).equals(expected),
      `${relative} was modified by the mutation test`,
    );
  }
}
