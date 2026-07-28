import { officialPortIdentityKey } from "./official-port-identity.js";
import {
  prepareWebglVertexSource,
} from "./webgl-position-invariance.js";

const CONTRACT_SCHEMA = "pocket-card-render/official-program-port-contract@2";
const STAGE_SOURCE_SCHEMA = "pocket-card-render/stage-source-runtime-contract@1";

function assetPath(value) {
  if (typeof value !== "string" || !value) return null;
  return value.startsWith("public/") ? value.slice("public/".length) : value;
}

async function fetchJson(fetchAsset, url) {
  const response = await fetchAsset(url);
  if (!response?.ok) throw new Error(`failed to load ${url}`);
  return response.json();
}

async function fetchText(fetchAsset, url) {
  const response = await fetchAsset(url);
  if (!response?.ok) throw new Error(`failed to load ${url}`);
  return response.text();
}

function runtimeVertexSource(source, manifest, canonicalizeObjectClipPosition) {
  return prepareWebglVertexSource(source, {
    manifest,
    canonicalizeObjectClipPosition,
  });
}

function samePortIdentity(row, selector) {
  return row?.selectorId === selector?.selectorId
    && row?.candidateWitnessId === selector?.candidateWitnessId
    && row?.subshader === selector?.subshader
    && row?.pass === selector?.pass
    && row?.semanticExecutableId === selector?.semanticExecutableId;
}

function addSource(group, manifest, sources) {
  const identityKey = officialPortIdentityKey(manifest?.official_selector);
  if (!identityKey) throw new Error(`${group.key}: manifest has an incomplete port identity`);
  if (Object.hasOwn(group.sourcesByPort, identityKey)) {
    throw new Error(`${group.key}: duplicate exact port identity ${identityKey}`);
  }
  group.manifests.push(manifest);
  group.sourcesByPort[identityKey] = sources;
}

/**
 * Load every formal selector port from the generated official contract.
 * New ports become browser-visible by updating the contract; app.js owns no parallel manifest list.
 */
export async function loadExactShaderPortsFromContract({
  fetchAsset = globalThis.fetch,
  contractUrl = "shaders/official_program_port_contract.json",
  exactEnabled = () => true,
  canonicalizeObjectClipPosition = true,
} = {}) {
  if (typeof fetchAsset !== "function") throw new Error("fetchAsset must be a function");
  const contract = await fetchJson(fetchAsset, contractUrl);
  if (contract?.schema !== CONTRACT_SCHEMA || !Array.isArray(contract.ports)
      || !Array.isArray(contract.runtimeBound)) {
    throw new Error("official program port contract is malformed");
  }

  const manifestCache = new Map();
  const sourceCache = new Map();
  const loadManifest = async (declaredPath) => {
    const url = assetPath(declaredPath);
    if (!url) throw new Error("contract manifest path is invalid");
    if (!manifestCache.has(url)) manifestCache.set(url, fetchJson(fetchAsset, url));
    return manifestCache.get(url);
  };
  const loadSource = async (declaredPath) => {
    const url = assetPath(declaredPath);
    if (!url) throw new Error("manifest WebGL source path is invalid");
    if (!sourceCache.has(url)) sourceCache.set(url, fetchText(fetchAsset, url));
    return sourceCache.get(url);
  };

  const groups = new Map();
  for (const row of contract.ports) {
    const manifest = await loadManifest(row.manifest);
    const selector = manifest?.official_selector;
    const key = manifest?.runtime_contract?.shader_key;
    if (typeof key !== "string" || !key || !samePortIdentity(row, selector)) {
      throw new Error(`${row.manifest}: contract and manifest identity disagree`);
    }
    if (!exactEnabled(key)) continue;
    const vertexPath = manifest?.webgl_sources?.vertex;
    const fragmentPath = manifest?.webgl_sources?.fragment;
    const [rawVert, frag] = await Promise.all([
      loadSource(vertexPath),
      loadSource(fragmentPath),
    ]);
    const vertex = runtimeVertexSource(rawVert, manifest, canonicalizeObjectClipPosition);
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        manifests: [],
        sourcesByPort: {},
        vertexRuntimePolicy: vertex.policy,
        canonicalObjectClipPosition: vertex.canonicalObjectClipPosition,
      };
      groups.set(key, group);
    }
    if (group.vertexRuntimePolicy !== vertex.policy) {
      throw new Error(`${key}: vertex runtime policy drifted within a port group`);
    }
    if (group.canonicalObjectClipPosition !== vertex.canonicalObjectClipPosition) {
      throw new Error(`${key}: canonical object clip policy drifted within a port group`);
    }
    addSource(group, manifest, { vert: vertex.source, frag });
  }

  const result = {};
  const sourcesByPortIdentity = {};
  for (const [key, group] of groups) {
    const firstIdentity = officialPortIdentityKey(group.manifests[0]?.official_selector);
    const primary = group.sourcesByPort[firstIdentity];
    result[key] = {
      vert: primary.vert,
      frag: primary.frag,
      manifest: group.manifests[0],
      manifests: group.manifests,
      sourcesByPort: group.sourcesByPort,
      stageSourceOnly: false,
      vertexRuntimePolicy: group.vertexRuntimePolicy,
      canonicalObjectClipPosition: group.canonicalObjectClipPosition,
    };
    for (const manifest of group.manifests) {
      const identityKey = officialPortIdentityKey(manifest.official_selector);
      const sources = group.sourcesByPort[identityKey];
      sourcesByPortIdentity[identityKey] = {
        ...sources,
        manifest,
        shaderKey: key,
        stageSourceOnly: false,
        vertexRuntimePolicy: group.vertexRuntimePolicy,
        canonicalObjectClipPosition: group.canonicalObjectClipPosition,
      };
    }
  }

  for (const row of contract.runtimeBound) {
    const manifest = await loadManifest(row.manifest);
    const runtime = manifest?.runtime_contract;
    const key = runtime?.shader_key;
    if (runtime?.schema !== STAGE_SOURCE_SCHEMA || runtime?.stage_source_only !== true
        || typeof key !== "string" || !key) {
      throw new Error(`${row.manifest}: runtime-bound stage source contract is malformed`);
    }
    if (!exactEnabled(key)) continue;
    if (Object.hasOwn(result, key)) {
      throw new Error(`${key}: runtime-bound stage source conflicts with a formal port`);
    }
    const [rawVert, frag] = await Promise.all([
      loadSource(manifest?.webgl_sources?.vertex),
      loadSource(manifest?.webgl_sources?.fragment),
    ]);
    const vertex = runtimeVertexSource(rawVert, manifest, canonicalizeObjectClipPosition);
    result[key] = {
      vert: vertex.source,
      frag,
      manifest: null,
      manifests: [],
      sourcesByPort: {},
      stageSourceOnly: true,
      runtimeBoundary: row.boundary || null,
      vertexRuntimePolicy: vertex.policy,
      canonicalObjectClipPosition: vertex.canonicalObjectClipPosition,
    };
  }

  Object.defineProperty(result, "sourcesByPortIdentity", {
    value: Object.freeze(sourcesByPortIdentity),
    enumerable: false,
    configurable: false,
    writable: false,
  });
  return result;
}
