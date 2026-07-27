import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadExactShaderPortsFromContract } from "../public/render/exact-port-loader.js";
import { WEBGL_POSITION_INVARIANCE_SCHEMA } from "../public/render/webgl-position-invariance.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function response(body) {
  return {
    ok: true,
    async json() { return JSON.parse(body); },
    async text() { return body; },
  };
}

function filesystemFetch(overrides = new Map()) {
  return async (url) => {
    const key = String(url).replaceAll("\\", "/");
    if (overrides.has(key)) return response(overrides.get(key));
    const file = path.join(ROOT, "public", ...key.split("/"));
    return fs.existsSync(file)
      ? response(fs.readFileSync(file, "utf8"))
      : { ok: false };
  };
}

const contractUrl = "shaders/official_program_port_contract.json";
const contract = JSON.parse(fs.readFileSync(
  path.join(ROOT, "public", "shaders", "official_program_port_contract.json"),
  "utf8",
));

const loaded = await loadExactShaderPortsFromContract({
  fetchAsset: filesystemFetch(),
  contractUrl,
});
assert.equal(Object.keys(loaded).length, 37);
assert.equal(Object.values(loaded).filter((port) => !port.stageSourceOnly)
  .flatMap((port) => port.manifests).length, 45);
assert.equal(loaded.Card_Illust_DoubleTexture.manifests.length, 2);
assert.deepEqual(
  loaded.Card_Illust_DoubleTexture.manifests
    .map((manifest) => manifest.official_selector.keywords)
    .sort((left, right) => left.length - right.length),
  [[], ["_USEGRADATIONTEXTURE_ON"]],
);
assert.equal(loaded.Transparent_HologramLayer.manifests.length, 1);
assert.equal(loaded.Card_ShadowBoxUI_Transparent_Rainbow.manifests.length, 1);
assert.equal(loaded.Card_Circular_Moving_Kira.manifests.length, 2);
assert.equal(loaded.Card_Circular_Trail_Kira.manifests.length, 2);
assert.equal(loaded.Effect.manifests.length, 6);
assert.equal(loaded["Side&Back"].stageSourceOnly, true);
assert.match(loaded["Side&Back"].runtimeBoundary, /INSTANCING_ON/);
assert.match(loaded["Side&Back"].vert, /uniform highp mat4 modelMatrix/);
assert.equal(loaded.Card_Parallax.canonicalObjectClipPosition, true);
assert.equal(loaded["Side&Back"].canonicalObjectClipPosition, true);
assert.equal(loaded.Effect.canonicalObjectClipPosition, false);
for (const [key, port] of Object.entries(loaded)) {
  assert.equal(
    port.vertexRuntimePolicy,
    WEBGL_POSITION_INVARIANCE_SCHEMA,
    `${key}: runtime position policy`,
  );
  assert.equal(
    (port.vert.match(/\binvariant\s+gl_Position\s*;/g) || []).length,
    1,
    `${key}: invariant gl_Position declaration`,
  );
  for (const source of Object.values(port.sourcesByPort || {})) {
    assert.equal(
      (source.vert.match(/\binvariant\s+gl_Position\s*;/g) || []).length,
      1,
      `${key}: per-selector invariant gl_Position declaration`,
    );
  }
}

const canonical = await loadExactShaderPortsFromContract({
  fetchAsset: filesystemFetch(),
  contractUrl,
  canonicalizeObjectClipPosition: true,
});
assert.equal(canonical.Card_Parallax.canonicalObjectClipPosition, true);
assert.equal(canonical["Side&Back"].canonicalObjectClipPosition, true);
assert.equal(canonical.Effect.canonicalObjectClipPosition, false);
assert.match(
  canonical.Card_Parallax.vert,
  /gl_Position = projectionMatrix \* viewMatrix \* modelMatrix \* vec4\(position, 1\.0\);/,
);

const rawPerProgram = await loadExactShaderPortsFromContract({
  fetchAsset: filesystemFetch(),
  contractUrl,
  canonicalizeObjectClipPosition: false,
});
assert.equal(rawPerProgram.Card_Parallax.canonicalObjectClipPosition, false);
assert.equal(rawPerProgram["Side&Back"].canonicalObjectClipPosition, false);
assert.doesNotMatch(
  rawPerProgram.Card_Parallax.vert,
  /gl_Position = projectionMatrix \* viewMatrix \* modelMatrix \* vec4\(position, 1\.0\);/,
);

const withoutEffect = await loadExactShaderPortsFromContract({
  fetchAsset: filesystemFetch(),
  contractUrl,
  exactEnabled: (key) => key !== "Effect",
});
assert.equal(Object.hasOwn(withoutEffect, "Effect"), false);
assert.equal(Object.hasOwn(withoutEffect, "Card_Illust"), true);

const mismatched = structuredClone(contract);
mismatched.ports[0].candidateWitnessId = "0".repeat(64);
await assert.rejects(
  loadExactShaderPortsFromContract({
    fetchAsset: filesystemFetch(new Map([[contractUrl, JSON.stringify(mismatched)]])),
    contractUrl,
  }),
  /contract and manifest identity disagree/,
);

const sideBackPath = "shaders/side_back_program.json";
const sideBack = JSON.parse(fs.readFileSync(
  path.join(ROOT, "public", "shaders", "side_back_program.json"),
  "utf8",
));
delete sideBack.runtime_contract.stage_source_only;
await assert.rejects(
  loadExactShaderPortsFromContract({
    fetchAsset: filesystemFetch(new Map([[sideBackPath, JSON.stringify(sideBack)]])),
    contractUrl,
  }),
  /runtime-bound stage source contract is malformed/,
);

console.log("Exact port contract loader tests OK: 45 formal ports + 1 runtime boundary");
