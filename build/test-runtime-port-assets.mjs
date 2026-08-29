import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  createRuntimePortAssetResolver,
  RUNTIME_PORT_CONTRACT_ROUTE,
} from "./runtime-port-assets.mjs";
import { loadFullRuntimeDefinition } from "./full-runtime-sources.mjs";
import { loadExactShaderPortsFromContract } from "../public/render/exact-port-loader.js";
import {
  loadRuntimeMaterialDispatchFromContract,
} from "../public/render/runtime-dispatch-contract.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CANDIDATE_POINTER = path.join(ROOT, "build", "official-samples", "candidate.json");
const CANDIDATE_PORT_ROOT = path.resolve(
  process.env.PCR_CANDIDATE_PORT_ROOT
    || path.join(ROOT, "..", "ptcgp-tools-master", "masterdata_decoder", ".output-full", "webgl-ports"),
);

function response(bytes) {
  return {
    ok: true,
    async json() { return JSON.parse(bytes.toString("utf8")); },
    async text() { return bytes.toString("utf8"); },
  };
}

function resolverFetch(resolver) {
  return async (rawUrl) => {
    const url = String(rawUrl);
    const runtime = resolver.read(url);
    if (runtime) return response(runtime.bytes);
    const publicFile = path.resolve(ROOT, "public", url.replace(/^\/+/, ""));
    return fs.statSync(publicFile, { throwIfNoEntry: false })?.isFile()
      ? response(fs.readFileSync(publicFile))
      : { ok: false };
  };
}

const candidate = loadFullRuntimeDefinition({
  root: ROOT,
  manifestPath: CANDIDATE_POINTER,
});
const resolver = createRuntimePortAssetResolver({
  root: ROOT,
  definition: candidate,
  candidatePortRoot: CANDIDATE_PORT_ROOT,
});
assert.equal(resolver.candidate, true);
assert.match(resolver.contractSha256, /^[0-9a-f]{64}$/);
assert.equal(resolver.read("/runtime/candidate-port/../secret"), null);

const fetchAsset = resolverFetch(resolver);
const exactPorts = await loadExactShaderPortsFromContract({ fetchAsset });
assert.equal(Object.keys(exactPorts.sourcesByPortIdentity).length, 78);
assert.equal(Object.values(exactPorts).filter((port) => port.stageSourceOnly).length, 0);
for (const port of Object.values(exactPorts)) {
  for (const manifest of port.manifests) {
    assert.equal(manifest.official_sample.sampleId, candidate.sampleId);
    assert.equal(
      manifest.official_sample.sampleManifestSha256,
      candidate.sampleManifestSha256,
    );
  }
}
const dispatch = await loadRuntimeMaterialDispatchFromContract({ fetchAsset });
assert.equal(dispatch.routeCount, 79);

const contractBytes = resolver.read(RUNTIME_PORT_CONTRACT_ROUTE).bytes;
assert.deepEqual(JSON.parse(contractBytes), resolver.contract);

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "pcr-runtime-port-assets-"));
try {
  fs.cpSync(CANDIDATE_PORT_ROOT, temporary, { recursive: true });
  const first = resolver.contract.ports[0];
  const firstManifest = path.join(
    temporary,
    first.manifest.slice("candidate-port:".length),
  );
  fs.appendFileSync(firstManifest, "\n");
  assert.throws(
    () => createRuntimePortAssetResolver({
      root: ROOT,
      definition: candidate,
      candidatePortRoot: temporary,
    }),
    /manifest bytes drifted/,
  );

  fs.cpSync(CANDIDATE_PORT_ROOT, temporary, { recursive: true, force: true });
  const changed = resolver.contract.ports.find((row) => {
    const filename = path.join(
      temporary,
      row.manifest.slice("candidate-port:".length),
    );
    const manifest = JSON.parse(fs.readFileSync(filename, "utf8"));
    return Object.values(manifest.webgl_sources || {})
      .some((source) => !source.startsWith("public/"));
  });
  assert.ok(changed);
  const changedManifestFile = path.join(
    temporary,
    changed.manifest.slice("candidate-port:".length),
  );
  const changedManifest = JSON.parse(fs.readFileSync(changedManifestFile, "utf8"));
  const changedSource = path.join(
    path.dirname(changedManifestFile),
    path.basename(changedManifest.webgl_sources.vertex),
  );
  fs.appendFileSync(changedSource, "\n");
  assert.throws(
    () => createRuntimePortAssetResolver({
      root: ROOT,
      definition: candidate,
      candidatePortRoot: temporary,
    }),
    /vertex source bytes drifted/,
  );
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}

console.log("Runtime port assets OK: candidate 78 formal ports, 79 dispatch routes");
