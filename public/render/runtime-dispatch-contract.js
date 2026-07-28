import { officialPortIdentityKey } from "./official-port-identity.js";

export const OFFICIAL_PROGRAM_PORT_CONTRACT_SCHEMA =
  "pocket-card-render/official-program-port-contract@2";
export const RUNTIME_MATERIAL_DISPATCH_SCHEMA =
  "pocket-card-render/runtime-material-dispatch@1";

const SUPPORT = new Set(["implemented", "deferred", "unsupported"]);
const BLEND = new Set(["premult", "over", "add_a", "multiply", "opaque"]);
const STENCIL = new Set(["none", "shadowbox", "read-stencil", "read-stencil-ref"]);
const BUILTIN_GEOMETRY = new Set(["none", "unity-quad"]);
const DIAGNOSTIC = new Set(["none", "card-parallax"]);
const SELECTION_MODE = new Set([
  "native-best-match",
  "ordered-multipass-structure",
  "unique-exact-keywords",
]);
const ROUTE_FIELDS = new Set([
  "candidateWitnessId",
  "dispatch",
  "keywords",
  "pass",
  "runtimeEngineVariantBoundary",
  "selectionMode",
  "selectorId",
  "semanticExecutableId",
  "shaderIdentity",
  "subshader",
]);
const CAPABILITY_FIELDS = new Set([
  "builtinGeometry",
  "diagnostic",
  "fakeSpecEnabledDefault",
  "fakeSpecIntensityDefault",
  "fixedShadowboxDepth",
  "stencil",
]);
const DISPATCH_FIELDS = new Set([
  "alphaTest",
  "blend",
  "capabilities",
  "cull",
  "defer",
  "materialBlend",
  "materialCull",
  "shaderKey",
  "strategy",
  "support",
]);

function fail(message) {
  throw new Error(`runtime material dispatch: ${message}`);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function rejectUnknownFields(value, allowed, label) {
  for (const field of Object.keys(value)) {
    if (!allowed.has(field)) fail(`${label} has unknown field ${field}`);
  }
}

function optionalFinite(value, label) {
  if (value === undefined) return undefined;
  const number = Number(value);
  if (!Number.isFinite(number)) fail(`${label} must be finite`);
  return number;
}

function optionalBoolean(value, label, fallback = false) {
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") fail(`${label} must be boolean`);
  return value;
}

export function compileRuntimeMaterialDispatch(raw, label = "dispatch") {
  if (!isRecord(raw)) fail(`${label} must be an object`);
  rejectUnknownFields(raw, DISPATCH_FIELDS, label);
  if (!SUPPORT.has(raw.support)) fail(`${label}.support is unsupported`);
  if (typeof raw.shaderKey !== "string" || !raw.shaderKey) {
    fail(`${label}.shaderKey must be non-empty`);
  }
  const implemented = raw.support === "implemented";
  if (implemented && (typeof raw.strategy !== "string" || !raw.strategy)) {
    fail(`${label}.strategy must be non-empty for an implemented route`);
  }
  if (!implemented && raw.strategy !== null) {
    fail(`${label}.strategy must be null outside an implemented route`);
  }
  if (implemented && !BLEND.has(raw.blend)) fail(`${label}.blend is unsupported`);
  if (!implemented && raw.blend !== null) fail(`${label}.blend must be null outside an implemented route`);
  if (typeof raw.defer !== "boolean" || raw.defer !== !implemented) {
    fail(`${label}.defer must agree with support`);
  }
  if (!isRecord(raw.capabilities)) fail(`${label}.capabilities must be an object`);
  rejectUnknownFields(raw.capabilities, CAPABILITY_FIELDS, `${label}.capabilities`);
  const stencil = raw.capabilities.stencil ?? "none";
  const builtinGeometry = raw.capabilities.builtinGeometry ?? "none";
  const diagnostic = raw.capabilities.diagnostic ?? "none";
  if (!STENCIL.has(stencil)) fail(`${label}.capabilities.stencil is unsupported`);
  if (!BUILTIN_GEOMETRY.has(builtinGeometry)) {
    fail(`${label}.capabilities.builtinGeometry is unsupported`);
  }
  if (!DIAGNOSTIC.has(diagnostic)) fail(`${label}.capabilities.diagnostic is unsupported`);
  const fakeSpecEnabledDefault = optionalFinite(
    raw.capabilities.fakeSpecEnabledDefault,
    `${label}.capabilities.fakeSpecEnabledDefault`,
  );
  const fakeSpecIntensityDefault = optionalFinite(
    raw.capabilities.fakeSpecIntensityDefault,
    `${label}.capabilities.fakeSpecIntensityDefault`,
  );
  return {
    support: raw.support,
    shaderKey: raw.shaderKey,
    strategy: implemented ? raw.strategy : null,
    blend: implemented ? raw.blend : null,
    defer: !implemented,
    materialBlend: optionalBoolean(raw.materialBlend, `${label}.materialBlend`),
    materialCull: optionalBoolean(raw.materialCull, `${label}.materialCull`),
    ...(raw.alphaTest === undefined
      ? {}
      : { alphaTest: optionalFinite(raw.alphaTest, `${label}.alphaTest`) }),
    ...(raw.cull === undefined ? {} : { cull: optionalFinite(raw.cull, `${label}.cull`) }),
    capabilities: {
      stencil,
      builtinGeometry,
      diagnostic,
      fixedShadowboxDepth: optionalBoolean(
        raw.capabilities.fixedShadowboxDepth,
        `${label}.capabilities.fixedShadowboxDepth`,
      ),
      ...(fakeSpecEnabledDefault === undefined ? {} : { fakeSpecEnabledDefault }),
      ...(fakeSpecIntensityDefault === undefined ? {} : { fakeSpecIntensityDefault }),
    },
  };
}

function keywordSignature(values, label) {
  if (!Array.isArray(values) || values.some((value) => typeof value !== "string")) {
    fail(`${label} must be an array of strings`);
  }
  const sorted = [...values].sort();
  if (new Set(sorted).size !== sorted.length) fail(`${label} contains duplicates`);
  return JSON.stringify(sorted);
}

function requestKey(shaderIdentity, keywords) {
  return JSON.stringify([shaderIdentity, keywordSignature(keywords, "keywords")]);
}

function sameDispatch(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function compileRuntimeMaterialDispatchIndex(contract) {
  if (!isRecord(contract)
      || contract.schema !== OFFICIAL_PROGRAM_PORT_CONTRACT_SCHEMA
      || contract.runtimeDispatch?.schema !== RUNTIME_MATERIAL_DISPATCH_SCHEMA
      || !Array.isArray(contract.runtimeDispatch.routes)) {
    fail("official program port contract has no supported runtime dispatch table");
  }
  const routesByRequest = new Map();
  const allPortKeys = new Set();
  for (const [index, row] of contract.runtimeDispatch.routes.entries()) {
    const label = `routes[${index}]`;
    if (!isRecord(row)) fail(`${label} must be an object`);
    rejectUnknownFields(row, ROUTE_FIELDS, label);
    if (
        typeof row.shaderIdentity !== "string" || !row.shaderIdentity
        || typeof row.selectorId !== "string" || !row.selectorId
        || typeof row.candidateWitnessId !== "string" || !row.candidateWitnessId
        || typeof row.semanticExecutableId !== "string" || !row.semanticExecutableId
        || !Number.isInteger(row.subshader) || row.subshader < 0
        || !Number.isInteger(row.pass) || row.pass < 0
        || !SELECTION_MODE.has(row.selectionMode)
        || typeof row.runtimeEngineVariantBoundary !== "boolean") {
      fail(`${label} has an incomplete selector/pass identity`);
    }
    const portKey = officialPortIdentityKey(row);
    if (!portKey || allPortKeys.has(portKey)) fail(`${label} has a duplicate port identity`);
    allPortKeys.add(portKey);
    const dispatch = compileRuntimeMaterialDispatch(row.dispatch, `${label}.dispatch`);
    const key = requestKey(row.shaderIdentity, row.keywords);
    if (!routesByRequest.has(key)) routesByRequest.set(key, []);
    routesByRequest.get(key).push({
      selectorId: row.selectorId,
      candidateWitnessId: row.candidateWitnessId,
      semanticExecutableId: row.semanticExecutableId,
      shaderIdentity: row.shaderIdentity,
      keywords: [...row.keywords].sort(),
      selectionMode: row.selectionMode,
      runtimeEngineVariantBoundary: row.runtimeEngineVariantBoundary,
      subshader: row.subshader,
      pass: row.pass,
      dispatch,
    });
  }
  for (const [key, rows] of routesByRequest) {
    const first = rows[0];
    if (rows.some((row) => !sameDispatch(row.dispatch, first.dispatch))) {
      fail(`${key} assigns different behavior to sibling official passes`);
    }
    if (rows.length > 1) {
      if (rows.some((row) => row.selectionMode !== "ordered-multipass-structure"
          || row.selectorId !== first.selectorId
          || row.shaderIdentity !== first.shaderIdentity
          || row.subshader !== first.subshader)) {
        fail(`${key} is ambiguous outside one ordered multipass selector`);
      }
      rows.sort((left, right) => left.pass - right.pass);
      rows.forEach((row, pass) => {
        if (row.pass !== pass) fail(`${key} has a non-contiguous ordered pass sequence`);
      });
    }
  }
  if (!Array.isArray(contract.ports)) {
    fail("official program port contract has no formal ports");
  }
  for (const [index, port] of contract.ports.entries()) {
    const portKey = officialPortIdentityKey(port);
    if (!portKey || !allPortKeys.has(portKey)) {
      fail(`formal ports[${index}] has no matching runtime dispatch route`);
    }
  }
  return Object.freeze({
    schema: contract.runtimeDispatch.schema,
    routeCount: allPortKeys.size,
    routesByRequest,
  });
}

export function resolveRuntimeMaterialDispatch(index, recipe) {
  const official = recipe?.official;
  if (index?.schema !== RUNTIME_MATERIAL_DISPATCH_SCHEMA
      || typeof official?.shader !== "string" || !official.shader
      || !Array.isArray(official.validKeywords)) {
    return null;
  }
  let key;
  try {
    key = requestKey(official.shader, official.validKeywords);
  } catch {
    return null;
  }
  const rows = index.routesByRequest.get(key);
  if (!rows?.length) return null;
  const dispatch = rows[0].dispatch;
  return Object.freeze({
    ...dispatch,
    officialPorts: rows.map((row) => Object.freeze({
      selectorId: row.selectorId,
      candidateWitnessId: row.candidateWitnessId,
      semanticExecutableId: row.semanticExecutableId,
      shaderIdentity: row.shaderIdentity,
      keywords: row.keywords,
      selectionMode: row.selectionMode,
      runtimeEngineVariantBoundary: row.runtimeEngineVariantBoundary,
      subshader: row.subshader,
      pass: row.pass,
    })),
  });
}

export async function loadRuntimeMaterialDispatchFromContract({
  fetchAsset = globalThis.fetch,
  contractUrl = "shaders/official_program_port_contract.json",
} = {}) {
  if (typeof fetchAsset !== "function") fail("fetchAsset must be a function");
  const response = await fetchAsset(contractUrl);
  if (!response?.ok) fail(`failed to load ${contractUrl}`);
  return compileRuntimeMaterialDispatchIndex(await response.json());
}
