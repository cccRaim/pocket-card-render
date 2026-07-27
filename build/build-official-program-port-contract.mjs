#!/usr/bin/env node
// Generate selector-keyed verification obligations over the compact official
// executable index. This file routes evidence; verifier output owns verdicts.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  officialSample,
  officialSampleSha256,
} from "./official-sample.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const INVENTORY = path.resolve(process.env.PCR_MATERIAL_PROGRAM_INVENTORY
  || path.join(ROOT, "$cache", "official-material-program-inventory-v4-full.json"));
const OUTPUT = path.join(ROOT, "public", "shaders", "official_program_port_contract.json");
const CHECK = process.argv.includes("--check") || process.env.PCR_PROGRAM_PORT_CONTRACT_CHECK === "1";

function walkJson(directory) {
  const rows = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) rows.push(...walkJson(target));
    else if (entry.isFile() && entry.name.endsWith(".json") && target !== OUTPUT) rows.push(target);
  }
  return rows;
}

function keywords(manifest) {
  if (Array.isArray(manifest.selected_keywords)) return manifest.selected_keywords;
  if (Array.isArray(manifest.selector?.keywords)) return manifest.selector.keywords;
  if (Array.isArray(manifest.official_variant?.keywords)) return manifest.official_variant.keywords;
  return null;
}

function keywordSetsEqual(left, right) {
  return JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
}

function shaderNameMatches(officialName, manifestName) {
  return officialName === manifestName || officialName.endsWith(`/${manifestName}`);
}

function scalarMapSignature(value) {
  return JSON.stringify(Object.entries(value || {})
    .map(([name, scalar]) => [name, Number(scalar)])
    .sort(([a], [b]) => a.localeCompare(b)));
}

function validatePassShaderDefaults(manifest, relative) {
  const pass = manifest.official_pass_runtime;
  if (!pass) return;
  const defaults = manifest.official_shader_property_defaults?.floats;
  if (!defaults || typeof defaults !== "object" || Array.isArray(defaults)) {
    throw new Error(`${relative} has a pass contract without official Shader float defaults`);
  }
  for (const [name, value] of Object.entries(defaults)) {
    if (!name || !Number.isFinite(Number(value))) {
      throw new Error(`${relative} has invalid official Shader default ${name || "<empty>"}`);
    }
  }
  const namedParameters = new Set();
  const visit = (value) => {
    if (!value || typeof value !== "object") return;
    if (Object.hasOwn(value, "val") && typeof value.name === "string" && value.name) {
      namedParameters.add(value.name);
    }
    for (const child of Object.values(value)) visit(child);
  };
  visit(pass);
  const missing = [...namedParameters].filter((name) => !Object.hasOwn(defaults, name));
  if (missing.length) {
    throw new Error(`${relative} pass parameters lack Shader defaults: ${missing.join(", ")}`);
  }
  if (pass.shader_property_defaults
      && scalarMapSignature(pass.shader_property_defaults) !== scalarMapSignature(defaults)) {
    throw new Error(`${relative} embeds pass defaults that disagree with official Shader defaults`);
  }
}

const OBLIGATIONS = {
  stageProgram: { scope: "semantic-executable", verifier: "build/verify-official-port-stage-program.mjs" },
  parameterEntry: { scope: "semantic-executable", verifier: "build/verify-official-port-parameter-entry.mjs" },
  passState: { scope: "selector-local-port", verifier: "build/verify-official-port-pass-state.mjs" },
  commonBindings: { scope: "semantic-executable", verifier: "build/verify-official-port-common-bindings.mjs" },
  runtimeDispatch: { scope: "local-port-dispatch", verifier: "build/verify-official-port-runtime-dispatch.mjs" },
};

if (!fs.existsSync(INVENTORY)) {
  throw new Error(`official material/program inventory is absent: ${INVENTORY}`);
}
const inventory = JSON.parse(fs.readFileSync(INVENTORY, "utf8"));
if (inventory.schema !== "pocket-card-render/official-material-program-inventory@4"
  || !Array.isArray(inventory.portIndex) || inventory.portIndex.length !== 79) {
  throw new Error("official material/program inventory v4 compact portIndex is invalid");
}

const ports = [];
const runtimeBound = [];
for (const file of walkJson(path.join(ROOT, "public", "shaders"))) {
  const manifest = JSON.parse(fs.readFileSync(file, "utf8"));
  const spirv = manifest.official_spirv_sha256;
  if (!spirv?.vertex || !spirv?.fragment || !manifest.shader) continue;
  const relative = path.relative(ROOT, file).replaceAll("\\", "/");
  validatePassShaderDefaults(manifest, relative);
  const explicitKeywords = keywords(manifest);
  if (manifest.shader === "Lettuce/Common/CardNew/Face/Side&Back"
    && explicitKeywords && keywordSetsEqual(explicitKeywords, ["INSTANCING_ON"])) {
    runtimeBound.push({
      manifest: relative,
      generator: manifest.generated_by,
      boundary: "engine-owned INSTANCING_ON runtime variant",
    });
    continue;
  }
  const explicitSelector = manifest.official_selector;
  const matches = inventory.portIndex.filter((row) => {
    const selectorMatches = explicitSelector
      ? row.selectorId === explicitSelector.selectorId
        && row.candidateWitnessId === explicitSelector.candidateWitnessId
        && row.subshader === explicitSelector.subshader
        && row.pass === explicitSelector.pass
      : shaderNameMatches(row.shaderName, manifest.shader);
    return selectorMatches
      && row.identityFields.vertexSpirvSha256 === spirv.vertex
      && row.identityFields.fragmentSpirvSha256 === spirv.fragment
      && (explicitKeywords === null || keywordSetsEqual(row.keywords, explicitKeywords));
  });
  if (matches.length !== 1) {
    throw new Error(`${relative} resolves to ${matches.length} official selector/pass rows`);
  }
  const selected = matches[0];
  ports.push({
    selectorId: selected.selectorId,
    candidateWitnessId: selected.candidateWitnessId,
    subshader: selected.subshader,
    pass: selected.pass,
    semanticExecutableId: selected.semanticExecutableId,
    manifest: relative,
    generator: manifest.generated_by,
    officialIdentityFields: selected.identityFields,
    obligations: OBLIGATIONS,
  });
}
const portKey = (row) => `${row.selectorId}:${row.candidateWitnessId}:${row.subshader}:${row.pass}`;
ports.sort((a, b) => portKey(a).localeCompare(portKey(b)));
runtimeBound.sort((a, b) => a.manifest.localeCompare(b.manifest));
if (ports.length !== 45 || new Set(ports.map(portKey)).size !== ports.length) {
  throw new Error(`expected 45 unique selector/pass ports, got ${ports.length}`);
}

const output = {
  schema: "pocket-card-render/official-program-port-contract@2",
  generatedBy: "build/build-official-program-port-contract.mjs",
  provenance: {
    sampleId: officialSample.sampleId,
    sampleManifestSha256: officialSampleSha256,
  },
  inventory: {
    schema: inventory.schema,
    proofGraphSha256: inventory.digests.proofGraphSha256,
    portIndexSha256: inventory.digests.portIndexSha256,
  },
  ports,
  runtimeBound,
};
const encoded = `${JSON.stringify(output, null, 2)}\n`;
if (CHECK) {
  if (!fs.existsSync(OUTPUT) || fs.readFileSync(OUTPUT, "utf8") !== encoded) {
    console.error("BAD official program port contract: generated output is stale");
    process.exit(1);
  }
  console.log(`Official program port contract OK: ${ports.length} selector/pass-keyed stage ports`);
} else {
  fs.writeFileSync(OUTPUT, encoded);
  console.log(`Wrote ${path.relative(ROOT, OUTPUT)} with ${ports.length} selector/pass-keyed stage ports`);
}
