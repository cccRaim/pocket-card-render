import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  auditSelectorBoundProgramAssets,
  officialPortKey,
} from "./audit-official-program-assets.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHADERS = path.join(ROOT, "public", "shaders");
const CONTRACT_PATH = path.join(SHADERS, "official_program_port_contract.json");

function hash(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

function sourcePathByHash() {
  const result = new Map();
  for (const file of fs.readdirSync(SHADERS).filter((name) => /\.(?:vert|frag)\.glsl$/.test(name)).sort()) {
    const source = fs.readFileSync(path.join(SHADERS, file), "utf8");
    if (!result.has(hash(source))) result.set(hash(source), `public/shaders/${file}`);
  }
  return result;
}

function loadFixture() {
  const contract = JSON.parse(fs.readFileSync(CONTRACT_PATH, "utf8"));
  const sourcePaths = sourcePathByHash();
  const manifestEntries = contract.ports.map((port) => {
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, port.manifest), "utf8"));
    return {
      manifest,
      manifestPath: port.manifest,
      fallbackSources: {
        vertex: sourcePaths.get(manifest.webgl_adaptation.vertex.outputSha256),
        fragment: sourcePaths.get(manifest.webgl_adaptation.fragment.outputSha256),
      },
    };
  });
  const readSourceText = (repoPath) => {
    const absolute = path.join(ROOT, ...String(repoPath).replaceAll("\\", "/").split("/"));
    return fs.existsSync(absolute) ? fs.readFileSync(absolute, "utf8") : null;
  };
  return { contract, manifestEntries, readSourceText };
}

function audit(fixture) {
  return auditSelectorBoundProgramAssets(fixture);
}

function failures(result) {
  return result.rows.filter((row) => !row.ok).map((row) => row.reason);
}

function entryByShader(fixture, shaderKey) {
  const entry = fixture.manifestEntries.find((candidate) =>
    candidate.manifest.runtime_contract?.shader_key === shaderKey
      || candidate.manifest.shader?.endsWith(`/${shaderKey}`));
  assert.ok(entry, `missing fixture manifest for ${shaderKey}`);
  return entry;
}

test("current source-bound manifests close the full 41-port composite-key set", () => {
  const fixture = loadFixture();
  const result = audit(fixture);
  assert.deepEqual(failures(result), []);
  assert.equal(result.expectedKeys.length, 41);
  assert.deepEqual(result.discoveredKeys, result.expectedKeys);
  assert.equal(new Set(fixture.contract.ports.map((port) => port.selectorId)).size, 39);
  assert.equal(new Set(fixture.contract.ports.map(officialPortKey)).size, 41);
});

test("missing MatCap is rejected instead of being hidden by a hand-maintained audit map", () => {
  const fixture = loadFixture();
  fixture.manifestEntries = fixture.manifestEntries.filter((entry) =>
    entry.manifest.runtime_contract?.shader_key !== "Card_Parallax_MatCap_Lighting");
  const bad = failures(audit(fixture));
  assert.ok(bad.some((reason) => reason.includes("full-key set mismatch")));
  assert.ok(bad.some((reason) => reason.includes("contract port not consumed")));
});

test("candidate witness mutation fails the full composite identity join", () => {
  const fixture = loadFixture();
  entryByShader(fixture, "Card_Parallax_MatCap_Lighting")
    .manifest.official_selector.candidateWitnessId = "0".repeat(64);
  const bad = failures(audit(fixture));
  assert.ok(bad.some((reason) => reason.includes("full-key set mismatch")));
  assert.ok(bad.some((reason) => reason.includes("contract port not consumed")));
});

for (const [field, value] of [["subshader", 7], ["pass", 7]]) {
  test(`${field} mutation fails the full composite identity join`, () => {
    const fixture = loadFixture();
    entryByShader(fixture, "Card_Parallax_MatCap_Lighting").manifest.official_selector[field] = value;
    const bad = failures(audit(fixture));
    assert.ok(bad.some((reason) => reason.includes("full-key set mismatch")));
    assert.ok(bad.some((reason) => reason.includes("contract port not consumed")));
  });
}

test("duplicate manifest identity fails closed", () => {
  const fixture = loadFixture();
  fixture.manifestEntries.push(structuredClone(fixture.manifestEntries[0]));
  const bad = failures(audit(fixture));
  assert.ok(bad.some((reason) => reason.includes("duplicate manifest keys")));
});

test("Glitter semantics come from official reflection and runtime contract", () => {
  const fixture = loadFixture();
  const glitter = entryByShader(fixture, "Card_UR_Glitter_FlowMaps").manifest;
  const flow = glitter.official_program_bindings.common_constant_buffers
    .flatMap((buffer) => buffer.vectors)
    .find((field) => field.name === "_FlowParams");
  flow.arraySize = 1;
  const bad = failures(audit(fixture));
  assert.ok(bad.some((reason) => reason.includes("Glitter FlowParams vec4[2] reflection")));
});

test("MatCap structured reflection/runtime regressions fail without source-text regex", () => {
  const fixture = loadFixture();
  const matcap = entryByShader(fixture, "Card_Parallax_MatCap_Lighting").manifest;
  matcap.runtime_contract.material_uniforms.ints = matcap.runtime_contract.material_uniforms.ints
    .filter((name) => name !== "_UseUv2");
  const bad = failures(audit(fixture));
  assert.ok(bad.some((reason) => reason.includes("MatCap runtime attributes, integer controls, and MRT contract")));
});

test("a declared WebGL source cannot silently lose its runtime contract", () => {
  const fixture = loadFixture();
  delete entryByShader(fixture, "Card_Parallax_MatCap_Lighting").manifest.runtime_contract;
  const bad = failures(audit(fixture));
  assert.ok(bad.some((reason) => reason.includes("declared WebGL source lacks runtime contract")));
});
