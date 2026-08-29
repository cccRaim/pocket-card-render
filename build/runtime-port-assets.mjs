import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const BASELINE_CONTRACT_SCHEMA =
  "pocket-card-render/official-program-port-contract@2";
const CANDIDATE_CONTRACT_SCHEMA =
  "pocket-card-render/candidate-program-port-contract@1";
const CONTRACT_ROUTE = "/runtime/official-program-port-contract.json";
const CANDIDATE_PORT_ROUTE = "/runtime/candidate-port/";
const HASH = /^[0-9a-f]{64}$/;

function fail(message) {
  throw new Error(`runtime port assets: ${message}`);
}

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function readJsonBytes(filename, label) {
  const bytes = fs.readFileSync(filename);
  try {
    return { bytes, value: JSON.parse(bytes.toString("utf8")) };
  } catch (error) {
    fail(`${label} is invalid JSON: ${error.message}`);
  }
}

function candidateStem(sampleId) {
  return String(sampleId || "").replace(/-candidate$/, "");
}

export function runtimePortContractRelative(definition) {
  if (definition?.sample?.status === "candidate") {
    return `build/official-samples/${candidateStem(definition.sampleId)}-program-port-contract.json`;
  }
  return "public/shaders/official_program_port_contract.json";
}

function registerAsset(assets, route, filename, expectedSha256, label) {
  if (!HASH.test(expectedSha256 || "")) fail(`${label} has no valid SHA-256`);
  const existing = assets.get(route);
  if (existing) {
    if (existing.filename !== filename || existing.expectedSha256 !== expectedSha256) {
      fail(`${route} resolves to conflicting candidate assets`);
    }
    return;
  }
  const bytes = fs.readFileSync(filename);
  if (sha256(bytes) !== expectedSha256) fail(`${label} bytes drifted`);
  assets.set(route, Object.freeze({ filename, expectedSha256 }));
}

function candidateAssetIndex(contract, candidatePortRoot) {
  const assets = new Map();
  for (const [index, row] of contract.ports.entries()) {
    const declared = row?.manifest;
    if (typeof declared !== "string" || !declared.startsWith("candidate-port:")) {
      fail(`candidate ports[${index}] has an invalid manifest path`);
    }
    const relative = declared.slice("candidate-port:".length);
    const manifestFile = path.resolve(candidatePortRoot, relative);
    const rootRelative = path.relative(candidatePortRoot, manifestFile);
    if (!rootRelative || rootRelative === ".." || rootRelative.startsWith(`..${path.sep}`)
        || path.isAbsolute(rootRelative)) {
      fail(`candidate ports[${index}] escapes the candidate port root`);
    }
    const manifestRoute = `${CANDIDATE_PORT_ROUTE}${relative.replaceAll("\\", "/")}`;
    registerAsset(
      assets,
      manifestRoute,
      manifestFile,
      row.manifestSha256,
      `candidate ports[${index}] manifest`,
    );
    const manifest = readJsonBytes(manifestFile, `candidate ports[${index}] manifest`).value;
    if (manifest.official_sample?.sampleId !== contract.provenance.sampleId
        || manifest.official_sample?.sampleManifestSha256
          !== contract.provenance.sampleManifestSha256) {
      fail(`candidate ports[${index}] manifest provenance disagrees with the contract`);
    }
    for (const stage of ["vertex", "fragment"]) {
      const logical = manifest.webgl_sources?.[stage];
      if (typeof logical !== "string" || !logical) {
        fail(`candidate ports[${index}] has no ${stage} source`);
      }
      if (logical.startsWith("public/")) continue;
      const sourceFile = path.join(path.dirname(manifestFile), path.basename(logical));
      const sourceRoute =
        `${CANDIDATE_PORT_ROUTE}${path.posix.dirname(relative.replaceAll("\\", "/"))}`
        + `/${path.basename(logical)}`;
      registerAsset(
        assets,
        sourceRoute,
        sourceFile,
        manifest.webgl_adaptation?.[stage]?.outputSha256,
        `candidate ports[${index}] ${stage} source`,
      );
    }
  }
  return assets;
}

export function createRuntimePortAssetResolver({
  root,
  definition,
  candidatePortRoot = process.env.PCR_CANDIDATE_PORT_ROOT
    || path.resolve(root, "..", "ptcgp-tools-master", "masterdata_decoder", ".output-full", "webgl-ports"),
} = {}) {
  if (!path.isAbsolute(root || "")) fail("repository root must be absolute");
  const contractRelative = runtimePortContractRelative(definition);
  const contractFile = path.resolve(root, contractRelative);
  const contractResult = readJsonBytes(contractFile, "selected contract");
  const contract = contractResult.value;
  const candidate = definition?.sample?.status === "candidate";
  const expectedSchema = candidate ? CANDIDATE_CONTRACT_SCHEMA : BASELINE_CONTRACT_SCHEMA;
  if (contract?.schema !== expectedSchema || !Array.isArray(contract.ports)
      || !Array.isArray(contract.runtimeBound)) {
    fail(`selected contract schema is not ${expectedSchema}`);
  }
  if (candidate && (
    contract.provenance?.sampleId !== definition.sampleId
    || contract.provenance?.sampleManifestSha256 !== definition.sampleManifestSha256
  )) {
    fail("candidate contract provenance disagrees with the selected official sample");
  }
  const candidateAssets = candidate
    ? candidateAssetIndex(contract, path.resolve(candidatePortRoot))
    : new Map();

  return Object.freeze({
    contract,
    contractRelative,
    contractSha256: sha256(contractResult.bytes),
    candidate,
    read(pathname) {
      if (pathname === CONTRACT_ROUTE) {
        const bytes = fs.readFileSync(contractFile);
        if (sha256(bytes) !== sha256(contractResult.bytes)) {
          fail("selected contract changed after server initialization");
        }
        return { bytes, extension: ".json" };
      }
      const asset = candidateAssets.get(pathname);
      if (!asset) return null;
      const bytes = fs.readFileSync(asset.filename);
      if (sha256(bytes) !== asset.expectedSha256) {
        fail(`${pathname} changed after server initialization`);
      }
      return { bytes, extension: path.extname(asset.filename).toLowerCase() };
    },
  });
}

export const RUNTIME_PORT_CONTRACT_ROUTE = CONTRACT_ROUTE;
export const RUNTIME_CANDIDATE_PORT_ROUTE = CANDIDATE_PORT_ROUTE;
