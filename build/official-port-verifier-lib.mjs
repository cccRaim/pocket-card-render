import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  CANONICAL_FULL_RUNTIME_SCENES,
  FULL_RUNTIME_SCHEMA_VERSION,
  fullRuntimeSourceFiles,
  fullRuntimeSourceIdentityMatches,
} from "./full-runtime-sources.mjs";
import {
  OFFICIAL_PORT_IDENTITY_FIELDS,
  officialPortIdentityKey,
  sameOfficialPortIdentity,
} from "../public/render/official-port-identity.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const INVENTORY = path.resolve(process.env.PCR_MATERIAL_PROGRAM_INVENTORY
  || path.join(ROOT, "$cache", "official-material-program-inventory-v4-full.json"));
const CONTRACT = path.join(ROOT, "public", "shaders", "official_program_port_contract.json");
const SHADER_ROOT = process.env.PCR_SHADERS
  || "D:/DevProjectes/ptcgp-tools-master/masterdata_decoder/.output/decrypted/Common/Shader";
const PYTHON = process.env.PYTHON || "python";
const FIELDS = new Set(["stageProgram", "parameterEntry", "passState", "commonBindings", "runtimeDispatch"]);
const SIMPLE_OPAQUE_SELECTOR = "ba9f1662214113f55fc89c0657dcb826bc418dff969484de83ed08d9e0b65a13";
const TRANSPARENT_HOLOGRAM_SELECTOR = "0fe1d8427061f16237a00867b4f4398f62a01d6ac39168111b70332cb1142bf2";
const CARD_HOLOGRAM_SELECTOR = "782e751eb65ac33e9e7e197acbbe0808e47da620c49de39f13ef173100723380";
const FULL_RUNTIME = path.join(ROOT, "$cache", "full-runtime-evidence.local.json");
const EXPECTED_FULL_RUNTIME_SHA256 = process.env.PCR_FULL_RUNTIME_EVIDENCE_SHA256 || null;

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function readJsonSnapshot(file) {
  const bytes = fs.readFileSync(file);
  return {
    value: JSON.parse(bytes.toString("utf8")),
    sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
  };
}

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function optionalSha256(file) {
  return fs.existsSync(file) ? sha256(file) : null;
}

function argument(name, required = false) {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : null;
  if (required && !value) throw new Error(`${name} is required`);
  return value;
}

export function selectContractPort(ports, {
  selectorId,
  candidateWitnessId = null,
  subshader = null,
  pass = null,
}) {
  const matches = ports.filter((row) => row.selectorId === selectorId
    && (candidateWitnessId === null || row.candidateWitnessId === candidateWitnessId)
    && (subshader === null || row.subshader === Number(subshader))
    && (pass === null || row.pass === Number(pass)));
  if (matches.length !== 1) {
    throw new Error(`selector/pass resolves to ${matches.length} contract rows: ${selectorId}`);
  }
  return matches[0];
}

function selectorKeyId({ selectorId, candidateWitnessId, subshader, pass }) {
  return `${selectorId}:${candidateWitnessId}:${Number(subshader)}:${Number(pass)}`;
}

export function preloadOfficialProgramExtractions({
  ports,
  inventoryPath = INVENTORY,
  decryptedRoot = path.resolve(SHADER_ROOT, "..", ".."),
  expectedProofGraphSha256,
  expectedPortIndexSha256,
} = {}) {
  assert.ok(Array.isArray(ports) && ports.length > 0, "selector extraction batch is empty");
  assert.match(expectedProofGraphSha256 || "", /^[0-9a-f]{64}$/);
  assert.match(expectedPortIndexSha256 || "", /^[0-9a-f]{64}$/);
  const expected = new Map();
  const requests = ports.map((port, index) => {
    const key = selectorKeyId(port);
    assert.ok(!expected.has(key), `duplicate selector extraction key: ${key}`);
    expected.set(key, port);
    return {
      selectorId: port.selectorId,
      candidateWitnessId: port.candidateWitnessId,
      subshader: Number(port.subshader),
      pass: Number(port.pass),
      prefix: `port_${String(index).padStart(3, "0")}`,
    };
  });
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "pcr-port-batch-"));
  const requestPath = path.join(directory, "request.json");
  const resultPath = path.join(directory, "result.json");
  const artifactDirectory = path.join(directory, "artifacts");
  try {
    fs.writeFileSync(requestPath, `${JSON.stringify({
      schema: "pocket-card-render/official-selector-program-batch-request@1",
      inventory: path.resolve(inventoryPath),
      decryptedRoot: path.resolve(decryptedRoot),
      expectedProofGraphSha256,
      expectedPortIndexSha256,
      out: artifactDirectory,
      requests,
    }, null, 2)}\n`, "ascii");
    execFileSync(PYTHON, [
      "build/extract_official_selector_program_batch.py",
      "--request", requestPath,
      "--result", resultPath,
    ], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      shell: process.platform === "win32",
    });
    const batch = readJson(resultPath);
    assert.equal(batch.schema, "pocket-card-render/official-selector-program-batch-result@1");
    assert.deepEqual(batch.inventory, {
      proofGraphSha256: expectedProofGraphSha256,
      portIndexSha256: expectedPortIndexSha256,
    });
    assert.equal(batch.results?.length, expected.size);
    const extractions = new Map();
    for (const row of batch.results) {
      const key = selectorKeyId(row.selectorKey || {});
      const expectedPort = expected.get(key);
      assert.ok(expectedPort, `unexpected selector extraction result: ${key}`);
      assert.ok(!extractions.has(key), `duplicate selector extraction result: ${key}`);
      assert.equal(row.metadata?.schema, "pocket-card-render/official-selector-program-extract@1");
      assert.deepEqual(row.selectorKey, {
        selectorId: expectedPort.selectorId,
        candidateWitnessId: expectedPort.candidateWitnessId,
        subshader: Number(expectedPort.subshader),
        pass: Number(expectedPort.pass),
      });
      assert.deepEqual(row.metadata.selector, {
        ...row.metadata.selector,
        selectorId: expectedPort.selectorId,
        candidateWitnessId: expectedPort.candidateWitnessId,
        subshader: Number(expectedPort.subshader),
        pass: Number(expectedPort.pass),
      });
      extractions.set(key, row.metadata);
    }
    assert.equal(extractions.size, expected.size);
    assert.equal(batch.statistics?.inventoryLoadCount, 1);
    assert.equal(batch.statistics?.extractionCount, expected.size);
    return { extractions, statistics: batch.statistics };
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

function selectorKeyFromArguments() {
  return {
    selectorId: argument("--selector-id", true),
    candidateWitnessId: argument("--candidate-witness-id"),
    subshader: argument("--subshader"),
    pass: argument("--pass"),
  };
}

export function createOfficialPortVerifierSession({
  inventoryPath = INVENTORY,
  contractPath = CONTRACT,
  runtimePath = FULL_RUNTIME,
  expectedRuntimeSha256 = EXPECTED_FULL_RUNTIME_SHA256,
  generatorsExternallyVerified = process.env.PCR_PROGRAM_PORT_GENERATORS_EXTERNALLY_VERIFIED === "1",
  officialExtractions = null,
  requirePreloadedExtractions = false,
} = {}) {
  const inventorySnapshot = readJsonSnapshot(inventoryPath);
  const contractSnapshot = readJsonSnapshot(contractPath);
  const inventory = inventorySnapshot.value;
  const contract = contractSnapshot.value;
  assert.equal(contract.schema, "pocket-card-render/official-program-port-contract@2");
  const runtimeBytes = fs.existsSync(runtimePath) ? fs.readFileSync(runtimePath) : null;
  const runtimeEvidenceSha256 = runtimeBytes
    ? crypto.createHash("sha256").update(runtimeBytes).digest("hex")
    : null;
  if (expectedRuntimeSha256) {
    assert.equal(runtimeEvidenceSha256, expectedRuntimeSha256,
      "full runtime evidence changed during verification session");
  }
  const extractionEntries = officialExtractions instanceof Map
    ? [...officialExtractions]
    : Object.entries(officialExtractions || {});
  return {
    inventory,
    contract,
    inventoryPath,
    contractPath,
    inventorySha256: inventorySnapshot.sha256,
    contractSha256: contractSnapshot.sha256,
    runtimePath,
    runtimeEvidenceSha256,
    runtimeArtifact: runtimeBytes ? JSON.parse(runtimeBytes.toString("utf8")) : null,
    expectedRuntimeSha256,
    generatorsExternallyVerified,
    contexts: new Map(),
    checkedGenerators: new Set(),
    officialExtractions: new Map(extractionEntries),
    requirePreloadedExtractions,
    manifestSha256ByPath: new Map(),
  };
}

export function assertOfficialPortVerifierSessionStable(session) {
  assert.equal(sha256(session.inventoryPath), session.inventorySha256,
    "official inventory changed during verification session");
  assert.equal(sha256(session.contractPath), session.contractSha256,
    "official program-port contract changed during verification session");
  assert.equal(optionalSha256(session.runtimePath), session.runtimeEvidenceSha256,
    "full runtime evidence changed during verification session");
  for (const [manifestPath, digest] of session.manifestSha256ByPath) {
    assert.equal(sha256(manifestPath), digest,
      `selector manifest changed during verification session: ${manifestPath}`);
  }
  return true;
}

function readFullRuntimeArtifact(context) {
  assert.ok(context.session.runtimeArtifact, "full runtime evidence is absent");
  return context.session.runtimeArtifact;
}

function loadContext(field, selectorKey, session) {
  assert.ok(FIELDS.has(field));
  const { selectorId, candidateWitnessId = null, subshader = null, pass = null } = selectorKey;
  const { inventory, contract } = session;
  const port = selectContractPort(contract.ports, { selectorId, candidateWitnessId, subshader, pass });
  const cacheKey = selectorKeyId(port);
  if (session.contexts.has(cacheKey)) {
    const cached = session.contexts.get(cacheKey);
    assert.equal(cached.port.obligations?.[field]?.verifier, `build/verify-official-port-${field
      .replace("stageProgram", "stage-program")
      .replace("parameterEntry", "parameter-entry")
      .replace("passState", "pass-state")
      .replace("commonBindings", "common-bindings")
      .replace("runtimeDispatch", "runtime-dispatch")}.mjs`);
    return cached;
  }
  const official = inventory.portIndex.find((row) => row.selectorId === selectorId
    && row.subshader === port.subshader && row.pass === port.pass);
  if (!official) throw new Error(`selector is absent from official inventory: ${selectorId}`);
  const manifestPath = path.resolve(ROOT, port.manifest);
  if (!manifestPath.startsWith(path.join(ROOT, "public", "shaders") + path.sep)) {
    throw new Error(`manifest escapes public/shaders: ${port.manifest}`);
  }
  const manifestSnapshot = readJsonSnapshot(manifestPath);
  const manifest = manifestSnapshot.value;
  const manifestSha256 = manifestSnapshot.sha256;
  if (session.manifestSha256ByPath.has(manifestPath)) {
    assert.equal(manifestSha256, session.manifestSha256ByPath.get(manifestPath),
      `selector manifest changed during verification session: ${manifestPath}`);
  } else {
    session.manifestSha256ByPath.set(manifestPath, manifestSha256);
  }
  assert.equal(port.candidateWitnessId, official.candidateWitnessId);
  assert.equal(port.semanticExecutableId, official.semanticExecutableId);
  assert.deepEqual(port.officialIdentityFields, official.identityFields);
  assert.equal(port.obligations?.[field]?.verifier, `build/verify-official-port-${field
    .replace("stageProgram", "stage-program")
    .replace("parameterEntry", "parameter-entry")
    .replace("passState", "pass-state")
    .replace("commonBindings", "common-bindings")
    .replace("runtimeDispatch", "runtime-dispatch")}.mjs`);
  const context = { inventory, contract, port, official, manifest, manifestPath, session };
  session.contexts.set(cacheKey, context);
  return context;
}

function extractOfficial(context) {
  const cacheKey = selectorKeyId(context.port);
  if (context.session.officialExtractions.has(cacheKey)) {
    return context.session.officialExtractions.get(cacheKey);
  }
  if (context.session.requirePreloadedExtractions) {
    throw new Error(`official selector extraction was not preloaded: ${cacheKey}`);
  }
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "pcr-port-verify-"));
  const metadata = path.join(directory, "selector.json");
  try {
    execFileSync(PYTHON, [
      "build/extract_official_selector_program.py",
      "--selector-id", context.port.selectorId,
      "--candidate-witness-id", context.port.candidateWitnessId,
      "--expected-proof-graph-sha256", context.contract.inventory.proofGraphSha256,
      "--expected-port-index-sha256", context.contract.inventory.portIndexSha256,
      "--decrypted-root", path.resolve(SHADER_ROOT, "..", ".."),
      "--out", directory,
      "--prefix", "verify",
      "--metadata", metadata,
    ], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      shell: process.platform === "win32",
    });
    const extracted = readJson(metadata);
    context.session.officialExtractions.set(cacheKey, extracted);
    return extracted;
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

function result(field, context, verdict, exactSubclaims, unresolved, extra = {}) {
  const runtimeEvidenceSha256 = context.session.runtimeEvidenceSha256;
  if (context.session.expectedRuntimeSha256) assert.equal(
    runtimeEvidenceSha256,
    context.session.expectedRuntimeSha256,
    "full runtime evidence changed during verification session",
  );
  return {
    schema: "pocket-card-render/official-port-verifier-result@1",
    field,
    scope: context.port.obligations[field].scope,
    selectorKey: {
      selectorId: context.port.selectorId,
      candidateWitnessId: context.port.candidateWitnessId,
      subshader: context.port.subshader,
      pass: context.port.pass,
    },
    semanticExecutableId: context.port.semanticExecutableId,
    officialRawAnchors: context.port.officialIdentityFields,
    localEvidence: {
      manifest: context.port.manifest,
      manifestSha256: sha256(context.manifestPath),
      generator: context.port.generator,
      runtimeEvidenceSha256,
    },
    verdict,
    exactSubclaims,
    unresolved,
    ...extra,
  };
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function finiteArray(value, length) {
  return Array.isArray(value) && value.length === length && value.every((item) => Number.isFinite(Number(item)));
}

function cameraFromViewMatrix(value) {
  if (!finiteArray(value, 16)) return null;
  const rows = Array.from({ length: 4 }, (_, row) => [
    ...Array.from({ length: 4 }, (_, column) => Number(value[column * 4 + row])),
    ...Array.from({ length: 4 }, (_, column) => row === column ? 1 : 0),
  ]);
  for (let column = 0; column < 4; column++) {
    let pivot = column;
    for (let row = column + 1; row < 4; row++) {
      if (Math.abs(rows[row][column]) > Math.abs(rows[pivot][column])) pivot = row;
    }
    if (Math.abs(rows[pivot][column]) < 1e-12) return null;
    [rows[column], rows[pivot]] = [rows[pivot], rows[column]];
    const divisor = rows[column][column];
    rows[column] = rows[column].map((item) => item / divisor);
    for (let row = 0; row < 4; row++) {
      if (row === column) continue;
      const factor = rows[row][column];
      rows[row] = rows[row].map((item, index) => item - factor * rows[column][index]);
    }
  }
  const inverse = Array.from({ length: 16 }, (_, index) => rows[index % 4][4 + Math.floor(index / 4)]);
  return inverse.slice(12, 15);
}

function simpleOpaqueRuntime(context) {
  const errors = [];
  if (!fs.existsSync(FULL_RUNTIME)) return { errors: ["full runtime evidence is absent"], draws: [] };
  const artifact = readFullRuntimeArtifact(context);
  const sourceFiles = fullRuntimeSourceFiles(ROOT);
  const sourceHashes = Object.fromEntries(sourceFiles.map((file) => [file, sha256(path.join(ROOT, file))]));
  if (artifact.schemaVersion !== FULL_RUNTIME_SCHEMA_VERSION
      || !fullRuntimeSourceIdentityMatches(artifact, sourceFiles, sourceHashes)) {
    return { errors: ["full runtime evidence is stale for the current render sources"], draws: [] };
  }
  const manifest = context.manifest;
  const expectedSelector = manifest.official_selector;
  const vertexSourceSha256 = manifest.webgl_adaptation?.vertex?.outputSha256;
  const fragmentSourceSha256 = manifest.webgl_adaptation?.fragment?.outputSha256;
  const draws = [];
  for (const canonical of CANONICAL_FULL_RUNTIME_SCENES) {
    const key = `${canonical.file}|zh_TW`;
    const capture = artifact.captures?.[key];
    if (!capture) { errors.push(`${key}: capture is absent`); continue; }
    const scene = readJson(path.join(ROOT, "public", canonical.file));
    const expectedMaterials = Object.entries(scene.materials || {})
      .filter(([, recipe]) => recipe.shader === "Simple-Opaque"
        && recipe.official?.shader === expectedSelector.shaderIdentity
        && sameJson([...(recipe.official?.validKeywords || [])].sort(), [...expectedSelector.keywords].sort()));
    const actual = (capture.localDraws || []).filter((draw) => draw.identity?.shader === "Simple-Opaque");
    const actualNames = new Set(actual.map((draw) => draw.identity?.materialName));
    if (!expectedMaterials.length) errors.push(`${key}: selector-matching scene material is absent`);
    for (const [materialName] of expectedMaterials) {
      if (!actualNames.has(materialName)) errors.push(`${key}: ${materialName} was not drawn`);
    }
    if (!actual.length) errors.push(`${key}: Simple-Opaque runtime draw is absent`);
    for (const [index, draw] of actual.entries()) {
      const prefix = `${key}:draw${index}`;
      const material = draw.material || {};
      const program = draw.pipeline?.program || {};
      if (material.type !== "RawShaderMaterial" || material.exactShader !== "Simple-Opaque") {
        errors.push(`${prefix}: exact RawShaderMaterial was not used`);
      }
      const selector = material.officialSelector;
      for (const field of [
        ...OFFICIAL_PORT_IDENTITY_FIELDS, "shaderIdentity", "programBlobIndex", "parameterBlobIndex",
        "executableId", "semanticExecutableId",
      ]) {
        if (selector?.[field] !== expectedSelector[field]) errors.push(`${prefix}: selector ${field} mismatch`);
      }
      if (!sameJson(selector?.keywords, expectedSelector.keywords)) errors.push(`${prefix}: selector keywords mismatch`);
      if (!sameJson(material.officialExecutableIdentity, manifest.official_executable_identity)) {
        errors.push(`${prefix}: executable identity mismatch`);
      }
      if (material.officialPassStateSha256 !== manifest.official_pass_runtime?.source_sha256) {
        errors.push(`${prefix}: pass-state source mismatch`);
      }
      if (material.shaderSources?.vertexSha256 !== vertexSourceSha256
          || material.shaderSources?.fragmentSha256 !== fragmentSourceSha256) {
        errors.push(`${prefix}: material shader source mismatch`);
      }
      for (const stage of ["vertex", "fragment"]) {
        if (!/^[0-9a-f]{64}$/.test(program[stage]?.sourceSha256 || "")
            || program[stage]?.containsMaterialSource !== true) {
          errors.push(`${prefix}: linked ${stage} source is not bound to the material source`);
        }
      }
      draws.push({ prefix, draw });
    }
  }
  return { errors, draws };
}

function verifySimpleOpaque(field, context) {
  const manifest = context.manifest;
  if (field === "stageProgram") {
    const generator = path.join(ROOT, context.port.generator);
    if (!context.session.generatorsExternallyVerified
        && !context.session.checkedGenerators.has(generator)) {
      execFileSync(process.execPath, [generator, "--check"], {
        cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
      });
      context.session.checkedGenerators.add(generator);
    }
    const adaptation = manifest.webgl_adaptation;
    assert.equal(adaptation?.schema, "pocket-card-render/webgl-stage-adaptation@1");
    assert.equal(adaptation.vertex.officialSpirvSha256, context.official.identityFields.vertexSpirvSha256);
    assert.equal(adaptation.fragment.officialSpirvSha256, context.official.identityFields.fragmentSpirvSha256);
    assert.equal(adaptation.vertex.outputSha256, sha256(path.join(ROOT, "public/shaders/simple_opaque.vert.glsl")));
    assert.equal(adaptation.fragment.outputSha256, sha256(path.join(ROOT, "public/shaders/simple_opaque.frag.glsl")));
    assert.deepEqual(adaptation.vertex.substitutions, [
      "position vec4 := vec4(three.position, 1.0)",
      "uv location 1 := three.uv",
      "unity_ObjectToWorld := three.modelMatrix",
      "unity_MatrixVP := three.projectionMatrix * three.viewMatrix",
      "remove Unity Vulkan clip-space Y inversion for WebGL clip space",
      "algebraically compose MatrixVP * ObjectToWorld as projectionMatrix * modelViewMatrix",
    ]);
    assert.deepEqual(adaptation.fragment.substitutions, [
      "remove #version directive supplied by Three.js RawShaderMaterial",
    ]);
    return result(field, context, "source-hash-bound", [
      "the selector-owned vertex and fragment SPIR-V are re-extracted from the hash-pinned official bundle",
      "the complete SPIRV-Cross output is shape-locked before deterministic backend substitutions",
      "the shipped WebGL2 sources hash exactly to the generated adaptation outputs",
    ], ["Vulkan-to-WebGL backend substitutions still require an independent semantic-equivalence proof"]);
  }

  const runtime = simpleOpaqueRuntime(context);
  if (runtime.errors.length) {
    return result(field, context, "runtime-required", [], runtime.errors);
  }
  const passErrors = [];
  const bindingErrors = [];
  for (const { prefix, draw } of runtime.draws) {
    const pipeline = draw.pipeline || {};
    const raster = pipeline.raster || {};
    const depth = pipeline.depth || {};
    const blend = pipeline.blend || {};
    const stencil = pipeline.stencil || {};
    if (!raster.cullEnabled || raster.cullFace !== "BACK" || raster.frontFace !== "CCW"
        || raster.polygonOffsetEnabled || raster.polygonOffsetFactor !== 0
        || raster.polygonOffsetUnits !== 0 || raster.sampleAlphaToCoverage) {
      passErrors.push(`${prefix}: raster state mismatch`);
    }
    if (depth.test || depth.write) passErrors.push(`${prefix}: depth state mismatch`);
    if (!blend.enabled || blend.srcRgb !== "ONE" || blend.dstRgb !== "ZERO"
        || blend.srcAlpha !== "ZERO" || blend.dstAlpha !== "ZERO"
        || blend.equationRgb !== "FUNC_ADD" || blend.equationAlpha !== "FUNC_ADD"
        || !sameJson(blend.colorMask, [true, true, true, true])) {
      passErrors.push(`${prefix}: blend state mismatch`);
    }
    if (stencil.enabled) passErrors.push(`${prefix}: stencil must be disabled`);
    if (!sameJson(pipeline.drawBuffers, ["0x8ce0", "0x8ce1"])) {
      passErrors.push(`${prefix}: MRT draw buffers mismatch`);
    }

    const program = pipeline.program || {};
    const uniforms = new Map((program.uniforms || []).map((row) => [row.name, row]));
    const attributes = new Map((program.attributes || []).map((row) => [row.name, row]));
    for (const name of ["modelViewMatrix", "projectionMatrix", "_13"]) {
      if (!uniforms.has(name)) bindingErrors.push(`${prefix}: active uniform ${name} is absent`);
    }
    for (const name of ["position", "uv"]) {
      if (!attributes.has(name)) bindingErrors.push(`${prefix}: active attribute ${name} is absent`);
    }
    const sampler = uniforms.get("_13")?.samplerBinding;
    if (sampler?.target !== "TEXTURE_2D" || sampler.matchesMaterialTexture !== true
        || !Number.isInteger(sampler.unit) || sampler.unit < 0) {
      bindingErrors.push(`${prefix}: _MainTex sampler object binding mismatch`);
    }
  }
  if (field === "passState") {
    return result(field, context, passErrors.length ? "runtime-required" : "exact", passErrors.length ? [] : [
      "all canonical local draws match the selector-bound blend, depth, cull, stencil, polygon-offset and alpha-to-coverage state",
      "both MRT attachments are active and the official pass-state byte identity is attached to every draw",
    ], passErrors);
  }
  if (field === "commonBindings") {
    return result(field, context, bindingErrors.length ? "runtime-required" : "exact", bindingErrors.length ? [] : [
      "official ObjectToWorld and MatrixVP bindings are closed by the audited Three.js matrix adaptation",
      "the active position/UV interface and _MainTex sampler target/object binding match every canonical draw",
      "linked WebGL shader sources contain the hash-verified material sources",
    ], bindingErrors);
  }
  if (field === "runtimeDispatch") {
    return result(field, context, "exact", [
      "all four canonical scene recipes satisfy the exact shader identity and empty-keyword selector",
      "every selector-matching material is drawn through the exact port with matching executable and pass identities",
      "runtime evidence is source-current and linked-program-bound",
    ], [], { localDrawCount: runtime.draws.length });
  }
  return null;
}

function transparentHologramRuntime(context) {
  const errors = [];
  if (!fs.existsSync(FULL_RUNTIME)) return { errors: ["full runtime evidence is absent"], draws: [] };
  const artifact = readFullRuntimeArtifact(context);
  const sourceFiles = fullRuntimeSourceFiles(ROOT);
  const sourceHashes = Object.fromEntries(sourceFiles.map((file) => [file, sha256(path.join(ROOT, file))]));
  if (artifact.schemaVersion !== FULL_RUNTIME_SCHEMA_VERSION
      || !fullRuntimeSourceIdentityMatches(artifact, sourceFiles, sourceHashes)) {
    return { errors: ["full runtime evidence is stale for the current render sources"], draws: [] };
  }
  const manifest = context.manifest;
  const expectedSelector = manifest.official_selector;
  const expectedVertex = manifest.webgl_adaptation?.vertex?.outputSha256;
  const expectedFragment = manifest.webgl_adaptation?.fragment?.outputSha256;
  const draws = [];
  let expectedCount = 0;
  for (const canonical of CANONICAL_FULL_RUNTIME_SCENES) {
    const key = `${canonical.file}|zh_TW`;
    const capture = artifact.captures?.[key];
    if (!capture) { errors.push(`${key}: capture is absent`); continue; }
    const scene = readJson(path.join(ROOT, "public", canonical.file));
    const expectedMaterials = Object.entries(scene.materials || {})
      .filter(([, recipe]) => recipe.shader === "Transparent_Hologram_Tuning"
        && recipe.official?.shader === expectedSelector.shaderIdentity
        && sameJson([...(recipe.official?.validKeywords || [])].sort(), [...expectedSelector.keywords].sort()));
    expectedCount += expectedMaterials.length;
    const actual = (capture.localDraws || []).filter((draw) => draw.identity?.shader === "Transparent_Hologram_Tuning");
    const actualNames = new Set(actual.map((draw) => draw.identity?.materialName));
    for (const [materialName] of expectedMaterials) {
      if (!actualNames.has(materialName)) errors.push(`${key}: ${materialName} was not drawn`);
    }
    for (const [index, draw] of actual.entries()) {
      const prefix = `${key}:draw${index}`;
      const material = draw.material || {};
      const program = draw.pipeline?.program || {};
      if (material.type !== "RawShaderMaterial" || material.exactShader !== "Transparent_Hologram_Tuning") {
        errors.push(`${prefix}: exact RawShaderMaterial was not used`);
      }
      const selector = material.officialSelector;
      for (const field of [
        ...OFFICIAL_PORT_IDENTITY_FIELDS, "shaderIdentity", "programBlobIndex", "parameterBlobIndex",
        "executableId", "semanticExecutableId",
      ]) {
        if (selector?.[field] !== expectedSelector[field]) errors.push(`${prefix}: selector ${field} mismatch`);
      }
      if (!sameJson(selector?.keywords, expectedSelector.keywords)) errors.push(`${prefix}: selector keywords mismatch`);
      if (!sameJson(material.officialExecutableIdentity, manifest.official_executable_identity)) {
        errors.push(`${prefix}: executable identity mismatch`);
      }
      if (material.officialPassStateSha256 !== manifest.official_pass_runtime?.source_sha256) {
        errors.push(`${prefix}: pass-state source mismatch`);
      }
      if (material.shaderSources?.vertexSha256 !== expectedVertex
          || material.shaderSources?.fragmentSha256 !== expectedFragment) {
        errors.push(`${prefix}: material shader source mismatch`);
      }
      for (const stage of ["vertex", "fragment"]) {
        if (!/^[0-9a-f]{64}$/.test(program[stage]?.sourceSha256 || "")
            || program[stage]?.containsMaterialSource !== true) {
          errors.push(`${prefix}: linked ${stage} source is not bound to the material source`);
        }
      }
      draws.push({ prefix, draw, recipe: scene.materials[draw.identity?.materialName] });
    }
  }
  if (expectedCount === 0) errors.push("no canonical scene owns the exact Transparent_Hologram_Tuning selector");
  if (draws.length === 0) errors.push("Transparent_Hologram_Tuning runtime draw is absent");
  return { errors, draws };
}

function verifyTransparentHologram(field, context) {
  const manifest = context.manifest;
  if (field === "stageProgram") {
    const generator = path.join(ROOT, context.port.generator);
    if (!context.session.generatorsExternallyVerified
        && !context.session.checkedGenerators.has(generator)) {
      execFileSync(process.execPath, [generator, "--check"], {
        cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
      });
      context.session.checkedGenerators.add(generator);
    }
    const adaptation = manifest.webgl_adaptation;
    assert.equal(adaptation?.schema, "pocket-card-render/webgl-stage-adaptation@1");
    assert.equal(adaptation.vertex.officialSpirvSha256, context.official.identityFields.vertexSpirvSha256);
    assert.equal(adaptation.fragment.officialSpirvSha256, context.official.identityFields.fragmentSpirvSha256);
    assert.equal(adaptation.vertex.outputSha256, sha256(path.join(ROOT, "public/shaders/transparent_hologram_tuning.vert.glsl")));
    assert.equal(adaptation.fragment.outputSha256, sha256(path.join(ROOT, "public/shaders/transparent_hologram_tuning.frag.glsl")));
    assert.deepEqual(adaptation.vertex.substitutions, [
      "position vec4 := vec4(three.position, 1.0)", "uv location 1 := three.uv",
      "normal location 2 := three.normal", "unity_ObjectToWorld := three.modelMatrix",
      "unity_WorldToObject := inverse(three.modelMatrix)",
      "unity_MatrixVP := three.projectionMatrix * three.viewMatrix",
      "remove Unity Vulkan clip-space Y inversion for WebGL clip space",
    ]);
    assert.deepEqual(adaptation.fragment.substitutions, [
      "replace serialized PGlobals UBO members with same-name Three.js uniforms",
    ]);
    return result(field, context, "source-hash-bound", [
      "the selector-owned vertex and fragment SPIR-V are re-extracted from the hash-pinned official bundle",
      "both complete SPIRV-Cross outputs are digest-locked before deterministic backend substitutions",
      "the shipped WebGL2 sources hash exactly to the generated adaptation outputs",
    ], ["Vulkan-to-WebGL backend substitutions still require an independent semantic-equivalence proof"]);
  }

  const runtime = transparentHologramRuntime(context);
  if (runtime.errors.length) return result(field, context, "runtime-required", [], runtime.errors);
  const passErrors = [];
  const bindingErrors = [];
  assert.equal(manifest.official_common_bindings?.source_sha256, context.official.identityFields.commonBindingsSha256);
  const samplerBindings = manifest.sampler_bindings || [];
  assert.equal(samplerBindings.length, 6);
  const officialTextures = new Map((manifest.official_common_bindings.textures || []).map((row) => [row.binding, row]));
  for (const row of samplerBindings) {
    const official = officialTextures.get(row.binding);
    assert.equal(official?.name, row.slot);
    assert.equal(official?.dim, row.dimension);
  }
  const samplerTargets = new Map(samplerBindings.map((row) => [row.spirvName, {
    slot: row.slot,
    target: row.glslType === "samplerCube" ? "TEXTURE_CUBE_MAP" : "TEXTURE_2D",
    glType: row.glslType === "samplerCube" ? "0x8b60" : "0x8b5e",
  }]));
  const scalarUniforms = [
    "_Shininess", "_BaseColorIntensity", "_SpecularIntensity", "_DiffractionIntensity",
    "_DiffractionPower", "_RampRepeat", "_RampSpeed", "_RampOffset", "_RampInterval",
    "_AlphaBlend", "_EmitMasking",
  ];
  for (const { prefix, draw, recipe } of runtime.draws) {
    const pipeline = draw.pipeline || {};
    const raster = pipeline.raster || {};
    const depth = pipeline.depth || {};
    const blend = pipeline.blend || {};
    const stencil = pipeline.stencil || {};
    if (!raster.cullEnabled || raster.cullFace !== "BACK" || raster.frontFace !== "CCW"
        || raster.polygonOffsetEnabled || raster.polygonOffsetFactor !== 0
        || raster.polygonOffsetUnits !== 0 || raster.sampleAlphaToCoverage) {
      passErrors.push(`${prefix}: raster state mismatch`);
    }
    if (depth.test || depth.write) passErrors.push(`${prefix}: depth state mismatch`);
    if (!blend.enabled || blend.srcRgb !== "SRC_ALPHA" || blend.dstRgb !== "ONE_MINUS_SRC_ALPHA"
        || blend.srcAlpha !== "ZERO" || blend.dstAlpha !== "ONE_MINUS_SRC_ALPHA"
        || blend.equationRgb !== "FUNC_ADD" || blend.equationAlpha !== "FUNC_ADD"
        || !sameJson(blend.colorMask, [true, true, true, true])) {
      passErrors.push(`${prefix}: blend state mismatch`);
    }
    if (stencil.enabled) passErrors.push(`${prefix}: stencil must be disabled`);
    if (!sameJson(pipeline.drawBuffers, ["0x8ce0", "0x8ce1"])) passErrors.push(`${prefix}: MRT draw buffers mismatch`);

    const program = pipeline.program || {};
    const uniforms = new Map((program.uniforms || []).map((row) => [row.name, row]));
    const attributes = new Map((program.attributes || []).map((row) => [row.name, row]));
    for (const name of ["modelMatrix", "viewMatrix", "projectionMatrix", "cameraPosition", "_Rotation", ...scalarUniforms, ...samplerTargets.keys()]) {
      if (!uniforms.has(name)) bindingErrors.push(`${prefix}: active uniform ${name} is absent`);
    }
    for (const name of ["position", "uv", "normal"]) {
      if (!attributes.has(name)) bindingErrors.push(`${prefix}: active attribute ${name} is absent`);
    }
    for (const [name, descriptor] of samplerTargets) {
      const uniform = uniforms.get(name);
      const sampler = uniform?.samplerBinding;
      if (uniform?.type !== descriptor.glType || sampler?.target !== descriptor.target || sampler.matchesMaterialTexture !== true
          || !Number.isInteger(sampler.unit) || sampler.unit < 0) {
        bindingErrors.push(`${prefix}: ${name} sampler object binding mismatch`);
      }
      const recipeTexture = recipe?.textures?.[descriptor.slot];
      if (recipeTexture?.url && descriptor.target === "TEXTURE_2D"
          && sampler.materialTexture?.sourceUrl !== recipeTexture.url) {
        bindingErrors.push(`${prefix}: ${descriptor.slot} recipe texture identity mismatch`);
      }
    }
    for (const name of scalarUniforms) {
      const uniform = uniforms.get(name);
      const expected = recipe?.floats?.[name] ?? manifest.official_shader_property_defaults?.floats?.[name];
      if (uniform?.type !== "0x1406" || !Number.isFinite(Number(uniform?.value))
          || Number(uniform.value) !== Number(expected)) {
        bindingErrors.push(`${prefix}: ${name} material value mismatch`);
      }
    }
    const matrixTypes = ["modelMatrix", "viewMatrix", "projectionMatrix"];
    for (const name of matrixTypes) {
      const uniform = uniforms.get(name);
      if (uniform?.type !== "0x8b5c" || !finiteArray(uniform.value, 16)) {
        bindingErrors.push(`${prefix}: ${name} matrix binding mismatch`);
      }
    }
    const rotation = uniforms.get("_Rotation");
    const expectedRotation = recipe?.colors?._Rotation
      ? [recipe.colors._Rotation.r, recipe.colors._Rotation.g, recipe.colors._Rotation.b]
      : (manifest.official_shader_property_defaults?.vectors?._Rotation || []).slice(0, 3);
    if (rotation?.type !== "0x8b51" || !sameJson(rotation.value, expectedRotation)) {
      bindingErrors.push(`${prefix}: _Rotation binding mismatch`);
    }
    const camera = uniforms.get("cameraPosition");
    const derivedCamera = cameraFromViewMatrix(uniforms.get("viewMatrix")?.value);
    if (camera?.type !== "0x8b51" || !finiteArray(camera.value, 3) || !derivedCamera
        || camera.value.some((value, index) => Math.abs(value - derivedCamera[index]) > 1e-5)) {
      bindingErrors.push(`${prefix}: cameraPosition does not match inverse viewMatrix`);
    }
    const expectedAttributeTypes = new Map([["position", "0x8b51"], ["uv", "0x8b50"], ["normal", "0x8b51"]]);
    for (const [name, type] of expectedAttributeTypes) {
      if (attributes.get(name)?.type !== type) bindingErrors.push(`${prefix}: ${name} attribute type mismatch`);
    }
  }
  if (field === "passState") {
    return result(field, context, passErrors.length ? "runtime-required" : "exact", passErrors.length ? [] : [
      "all canonical local draws match the selector-bound MRT blend, depth, cull, stencil, polygon-offset and alpha-to-coverage state",
      "the official pass-state byte identity is attached to every draw",
    ], passErrors);
  }
  if (field === "commonBindings") {
    return result(field, context, bindingErrors.length ? "runtime-required" : "exact", bindingErrors.length ? [] : [
      "all six official texture bindings have the correct active sampler dimension and material texture object",
      "sampler names are joined to semantic slots by shared binding numbers from SPIR-V reflection and official common bindings",
      "matrix, camera, rotation, scalar and vertex attribute types are checked in every canonical draw",
      "material values equal scene or serialized Shader property defaults and linked sources contain the hash-verified material sources",
    ], bindingErrors);
  }
  if (field === "runtimeDispatch") {
    return result(field, context, "exact", [
      "every canonical selector-matching recipe is dispatched through the exact RawShaderMaterial port",
      "selector, executable, pass and shipped-source identities match every observed draw",
      "runtime evidence is source-current and linked-program-bound",
    ], [], { localDrawCount: runtime.draws.length });
  }
  return null;
}

function cardHologramRuntime(context) {
  const errors = [];
  if (!fs.existsSync(FULL_RUNTIME)) return { errors: ["full runtime evidence is absent"], draws: [] };
  const artifact = readFullRuntimeArtifact(context);
  const sourceFiles = fullRuntimeSourceFiles(ROOT);
  const sourceHashes = Object.fromEntries(sourceFiles.map((file) => [file, sha256(path.join(ROOT, file))]));
  if (artifact.schemaVersion !== FULL_RUNTIME_SCHEMA_VERSION
      || !fullRuntimeSourceIdentityMatches(artifact, sourceFiles, sourceHashes)) {
    return { errors: ["full runtime evidence is stale for the current render sources"], draws: [] };
  }
  const manifest = context.manifest;
  const expectedSelector = manifest.official_selector;
  const expectedVertex = manifest.webgl_adaptation?.vertex?.outputSha256;
  const expectedFragment = manifest.webgl_adaptation?.fragment?.outputSha256;
  const draws = [];
  let expectedCount = 0;
  for (const canonical of CANONICAL_FULL_RUNTIME_SCENES) {
    const key = `${canonical.file}|zh_TW`;
    const capture = artifact.captures?.[key];
    if (!capture) { errors.push(`${key}: capture is absent`); continue; }
    const scene = readJson(path.join(ROOT, "public", canonical.file));
    const expectedMaterials = Object.entries(scene.materials || {})
      .filter(([, recipe]) => recipe.shader === "Card_Hologram_Tuning"
        && recipe.official?.shader === expectedSelector.shaderIdentity
        && sameJson([...(recipe.official?.validKeywords || [])].sort(), [...expectedSelector.keywords].sort()));
    expectedCount += expectedMaterials.length;
    const actual = (capture.localDraws || []).filter((draw) => draw.identity?.shader === "Card_Hologram_Tuning");
    const actualNames = new Set(actual.map((draw) => draw.identity?.materialName));
    for (const [materialName] of expectedMaterials) {
      if (!actualNames.has(materialName)) errors.push(`${key}: ${materialName} was not drawn`);
    }
    for (const [index, draw] of actual.entries()) {
      const prefix = `${key}:draw${index}`;
      const material = draw.material || {};
      const program = draw.pipeline?.program || {};
      if (material.type !== "RawShaderMaterial" || material.exactShader !== "Card_Hologram_Tuning") {
        errors.push(`${prefix}: exact RawShaderMaterial was not used`);
      }
      const selector = material.officialSelector;
      for (const name of [
        ...OFFICIAL_PORT_IDENTITY_FIELDS, "shaderIdentity", "programBlobIndex", "parameterBlobIndex",
        "executableId", "semanticExecutableId",
      ]) {
        if (selector?.[name] !== expectedSelector[name]) errors.push(`${prefix}: selector ${name} mismatch`);
      }
      if (!sameJson(selector?.keywords, expectedSelector.keywords)) errors.push(`${prefix}: selector keywords mismatch`);
      if (!sameJson(material.officialExecutableIdentity, manifest.official_executable_identity)) {
        errors.push(`${prefix}: executable identity mismatch`);
      }
      if (material.officialPassStateSha256 !== manifest.official_pass_runtime?.source_sha256) {
        errors.push(`${prefix}: pass-state source mismatch`);
      }
      if (material.shaderSources?.vertexSha256 !== expectedVertex
          || material.shaderSources?.fragmentSha256 !== expectedFragment) {
        errors.push(`${prefix}: material shader source mismatch`);
      }
      for (const stage of ["vertex", "fragment"]) {
        if (!/^[0-9a-f]{64}$/.test(program[stage]?.sourceSha256 || "")
            || program[stage]?.containsMaterialSource !== true) {
          errors.push(`${prefix}: linked ${stage} source is not bound to the material source`);
        }
      }
      draws.push({ prefix, draw, recipe: scene.materials[draw.identity?.materialName] });
    }
  }
  if (expectedCount === 0) errors.push("no canonical scene owns the exact Card_Hologram_Tuning selector");
  if (draws.length === 0) errors.push("Card_Hologram_Tuning runtime draw is absent");
  return { errors, draws };
}

function verifyCardHologram(field, context) {
  const manifest = context.manifest;
  if (field === "stageProgram") {
    const generator = path.join(ROOT, context.port.generator);
    if (!context.session.generatorsExternallyVerified
        && !context.session.checkedGenerators.has(generator)) {
      execFileSync(process.execPath, [generator, "--check"], {
        cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
      });
      context.session.checkedGenerators.add(generator);
    }
    const adaptation = manifest.webgl_adaptation;
    assert.equal(adaptation?.schema, "pocket-card-render/webgl-stage-adaptation@1");
    assert.equal(adaptation.vertex.officialSpirvSha256, context.official.identityFields.vertexSpirvSha256);
    assert.equal(adaptation.fragment.officialSpirvSha256, context.official.identityFields.fragmentSpirvSha256);
    assert.equal(adaptation.vertex.outputSha256, sha256(path.join(ROOT, "public/shaders/card_hologram_tuning.vert.glsl")));
    assert.equal(adaptation.fragment.outputSha256, sha256(path.join(ROOT, "public/shaders/card_hologram_tuning.frag.glsl")));
    assert.deepEqual(adaptation.vertex.substitutions, [
      "position vec4 := vec4(three.position, 1.0)", "normal location 1 := three.normal",
      "UV0 location 2 := three.uv", "UV1 location 3 := three.uv1",
      "unity_ObjectToWorld := three.modelMatrix", "unity_WorldToObject := inverse(three.modelMatrix)",
      "unity_MatrixVP := three.projectionMatrix * three.viewMatrix",
      "remove Unity Vulkan clip-space Y inversion for WebGL clip space",
    ]);
    assert.deepEqual(adaptation.fragment.substitutions, [
      "replace serialized PGlobals UBO members with same-name Three.js uniforms",
    ]);
    return result(field, context, "source-hash-bound", [
      "the selector-owned vertex and fragment SPIR-V are re-extracted from the hash-pinned official bundle",
      "both complete SPIRV-Cross outputs are digest-locked before deterministic backend substitutions",
      "the shipped WebGL2 sources hash exactly to the generated adaptation outputs",
    ], ["Vulkan-to-WebGL backend substitutions still require an independent semantic-equivalence proof"]);
  }

  const runtime = cardHologramRuntime(context);
  if (runtime.errors.length) return result(field, context, "runtime-required", [], runtime.errors);
  const passErrors = [];
  const bindingErrors = [];
  assert.equal(manifest.official_common_bindings?.source_sha256, context.official.identityFields.commonBindingsSha256);
  assert.equal(manifest.official_pass_runtime?.source_sha256, context.official.identityFields.passStateSha256);
  const samplerBindings = manifest.sampler_bindings || [];
  assert.equal(samplerBindings.length, 5);
  const officialTextures = new Map((manifest.official_common_bindings.textures || []).map((row) => [row.binding, row]));
  for (const row of samplerBindings) {
    const official = officialTextures.get(row.binding);
    assert.equal(official?.name, row.slot);
    assert.equal(official?.dim, row.dimension);
  }
  const samplerTargets = new Map(samplerBindings.map((row) => [row.spirvName, {
    slot: row.slot,
    target: "TEXTURE_2D",
    glType: "0x8b5e",
  }]));
  const floatUniforms = [
    "_DiffractionIntensity", "_DiffractionPower", "_RampRepeat", "_RampSpeed", "_RampOffset",
    "_RampInterval", "_RampUVOffset", "_RampUVTiltOffset", "_RampScale", "_PhaseScale",
    "_RampRotate", "_PhaseRotate", "_AlphaBlend", "_MaskPower", "_CutOut",
  ];
  const intUniforms = ["_UseUv", "_UseMaskUv", "_UseAlphaAsAlphaBlendMask", "_UseReflectionAlpha"];
  const depthFunctions = new Map([[1, "NEVER"], [2, "LESS"], [3, "EQUAL"], [4, "LEQUAL"], [5, "GREATER"], [6, "NOTEQUAL"], [7, "GEQUAL"], [8, "ALWAYS"]]);
  for (const { prefix, draw, recipe } of runtime.draws) {
    const pipeline = draw.pipeline || {};
    const raster = pipeline.raster || {};
    const depth = pipeline.depth || {};
    const blend = pipeline.blend || {};
    const stencil = pipeline.stencil || {};
    const defaults = manifest.official_shader_property_defaults?.floats || {};
    const zTest = Number(recipe?.floats?._ZTest ?? defaults._ZTest);
    const zWrite = Number(recipe?.floats?._ZWrite ?? defaults._ZWrite) !== 0;
    const stencilRef = Number(recipe?.floats?._StencilRef ?? defaults._StencilRef);
    if (!raster.cullEnabled || raster.cullFace !== "BACK" || raster.frontFace !== "CCW"
        || raster.polygonOffsetEnabled || raster.polygonOffsetFactor !== 0
        || raster.polygonOffsetUnits !== 0 || raster.sampleAlphaToCoverage) {
      passErrors.push(`${prefix}: raster state mismatch`);
    }
    if (depth.test !== (zTest !== 0) || depth.write !== zWrite
        || (zTest !== 0 && depth.func !== depthFunctions.get(zTest))) {
      passErrors.push(`${prefix}: material-resolved depth state mismatch`);
    }
    if (!blend.enabled || blend.srcRgb !== "ONE" || blend.dstRgb !== "ONE_MINUS_SRC_ALPHA"
        || blend.srcAlpha !== "ZERO" || blend.dstAlpha !== "ONE_MINUS_SRC_ALPHA"
        || blend.equationRgb !== "FUNC_ADD" || blend.equationAlpha !== "FUNC_ADD"
        || !sameJson(blend.colorMask, [true, true, true, true])) {
      passErrors.push(`${prefix}: blend state mismatch`);
    }
    if (!stencil.enabled) {
      passErrors.push(`${prefix}: stencil must remain enabled even when its read mask is zero`);
    } else {
      for (const face of ["front", "back"]) {
        const state = stencil[face] || {};
        if (state.func !== "EQUAL" || state.ref !== stencilRef || state.valueMask !== stencilRef
            || state.writeMask !== 255 || state.fail !== "KEEP"
            || state.depthFail !== "KEEP" || state.pass !== "KEEP") {
          passErrors.push(`${prefix}: ${face} stencil state mismatch`);
        }
      }
    }
    if (!sameJson(pipeline.drawBuffers, ["0x8ce0", "0x8ce1"])) passErrors.push(`${prefix}: MRT draw buffers mismatch`);

    const program = pipeline.program || {};
    const uniforms = new Map((program.uniforms || []).map((row) => [row.name, row]));
    const attributes = new Map((program.attributes || []).map((row) => [row.name, row]));
    for (const name of ["modelMatrix", "viewMatrix", "projectionMatrix", "_Rotation", ...floatUniforms, ...intUniforms, ...samplerTargets.keys()]) {
      if (!uniforms.has(name)) bindingErrors.push(`${prefix}: active uniform ${name} is absent`);
    }
    for (const name of ["position", "normal", "uv", "uv1"]) {
      if (!attributes.has(name)) bindingErrors.push(`${prefix}: active attribute ${name} is absent`);
    }
    for (const [name, descriptor] of samplerTargets) {
      const uniform = uniforms.get(name);
      const sampler = uniform?.samplerBinding;
      if (uniform?.type !== descriptor.glType || sampler?.target !== descriptor.target
          || sampler.matchesMaterialTexture !== true || !Number.isInteger(sampler.unit) || sampler.unit < 0) {
        bindingErrors.push(`${prefix}: ${name} sampler object binding mismatch`);
      }
      const recipeTexture = recipe?.textures?.[descriptor.slot];
      if (recipeTexture?.url && sampler?.materialTexture?.sourceUrl !== recipeTexture.url) {
        bindingErrors.push(`${prefix}: ${descriptor.slot} recipe texture identity mismatch`);
      }
      if (!recipeTexture?.url && sampler?.materialTexture?.sourceUrl != null) {
        bindingErrors.push(`${prefix}: ${descriptor.slot} must use its serialized default texture`);
      }
    }
    for (const name of floatUniforms) {
      const uniform = uniforms.get(name);
      const expected = recipe?.floats?.[name] ?? defaults[name];
      if (uniform?.type !== "0x1406" || !Number.isFinite(Number(uniform?.value))
          || Number(uniform.value) !== Number(expected)) {
        bindingErrors.push(`${prefix}: ${name} material value mismatch`);
      }
    }
    for (const name of intUniforms) {
      const uniform = uniforms.get(name);
      const expected = Math.trunc(recipe?.floats?.[name] ?? defaults[name]);
      if (uniform?.type !== "0x1404" || Number(uniform?.value) !== expected) {
        bindingErrors.push(`${prefix}: ${name} material value mismatch`);
      }
    }
    for (const name of ["modelMatrix", "viewMatrix", "projectionMatrix"]) {
      const uniform = uniforms.get(name);
      if (uniform?.type !== "0x8b5c" || !finiteArray(uniform.value, 16)) {
        bindingErrors.push(`${prefix}: ${name} matrix binding mismatch`);
      }
    }
    const rotation = uniforms.get("_Rotation");
    const expectedRotation = recipe?.colors?._Rotation
      ? [recipe.colors._Rotation.r, recipe.colors._Rotation.g, recipe.colors._Rotation.b]
      : (manifest.official_shader_property_defaults?.vectors?._Rotation || []).slice(0, 3);
    if (rotation?.type !== "0x8b51" || !sameJson(rotation.value, expectedRotation)) {
      bindingErrors.push(`${prefix}: _Rotation binding mismatch`);
    }
    const expectedAttributeTypes = new Map([
      ["position", "0x8b51"], ["normal", "0x8b51"], ["uv", "0x8b50"], ["uv1", "0x8b50"],
    ]);
    for (const [name, type] of expectedAttributeTypes) {
      if (attributes.get(name)?.type !== type) bindingErrors.push(`${prefix}: ${name} attribute type mismatch`);
    }
  }
  if (field === "passState") {
    return result(field, context, passErrors.length ? "runtime-required" : "exact", passErrors.length ? [] : [
      "all selector-matching canonical draws resolve material-controlled depth and stencil values against official defaults",
      "MRT blend, cull, color mask, stencil faces, polygon offset and alpha-to-coverage match the official pass",
      "the official pass-state byte identity is attached to every draw",
    ], passErrors);
  }
  if (field === "commonBindings") {
    return result(field, context, bindingErrors.length ? "runtime-required" : "exact", bindingErrors.length ? [] : [
      "all five official texture bindings are joined by numeric binding and have the correct active sampler dimension and object",
      "matrix, UV-selection, alpha-selection, rotation, scalar and vertex attribute types are checked in every selector-matching canonical draw",
      "material values equal scene overrides or serialized Shader property defaults and linked sources contain the generated material sources",
    ], bindingErrors);
  }
  if (field === "runtimeDispatch") {
    return result(field, context, "exact", [
      "every canonical selector-matching recipe is dispatched through the exact RawShaderMaterial port",
      "canonical scenes without this selector remain negative controls and do not produce matching draws",
      "selector, executable, pass and shipped-source identities match every observed draw in source-current evidence",
    ], [], { localDrawCount: runtime.draws.length });
  }
  return null;
}

const WEBGL_TYPES = new Map([
  ["float", "0x1406"], ["int", "0x1404"], ["vec2", "0x8b50"], ["vec3", "0x8b51"],
  ["vec4", "0x8b52"], ["mat4", "0x8b5c"], ["sampler2D", "0x8b5e"], ["samplerCube", "0x8b60"],
]);
const VECTOR_COMPONENTS = new Map([["vec2", 2], ["vec3", 3], ["vec4", 4]]);
const UNITY_BLEND_FACTORS = new Map([
  [0, "ZERO"], [1, "ONE"], [2, "DST_COLOR"], [3, "SRC_COLOR"], [4, "ONE_MINUS_DST_COLOR"],
  [5, "SRC_ALPHA"], [6, "ONE_MINUS_SRC_COLOR"], [7, "DST_ALPHA"], [8, "ONE_MINUS_DST_ALPHA"],
  [9, "SRC_ALPHA_SATURATE"], [10, "ONE_MINUS_SRC_ALPHA"],
]);
const UNITY_BLEND_OPS = new Map([[0, "FUNC_ADD"], [1, "FUNC_SUBTRACT"], [2, "FUNC_REVERSE_SUBTRACT"], [3, "MIN"], [4, "MAX"]]);
const UNITY_COMPARE = new Map([[1, "NEVER"], [2, "LESS"], [3, "EQUAL"], [4, "LEQUAL"], [5, "GREATER"], [6, "NOTEQUAL"], [7, "GEQUAL"], [8, "ALWAYS"]]);
const UNITY_STENCIL_OP = new Map([[0, "KEEP"], [1, "ZERO"], [2, "REPLACE"], [3, "INCR"], [4, "DECR"], [5, "INVERT"], [6, "INCR_WRAP"], [7, "DECR_WRAP"]]);

function sourcePath(relative) {
  assert.equal(typeof relative, "string");
  const resolved = path.resolve(ROOT, relative);
  assert.ok(resolved.startsWith(path.join(ROOT, "public", "shaders") + path.sep));
  return resolved;
}

function verifyManifestStageProgram(context) {
  const generator = path.join(ROOT, context.port.generator);
  if (!context.session.generatorsExternallyVerified
      && !context.session.checkedGenerators.has(generator)) {
    execFileSync(process.execPath, [generator, "--check"], {
      cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
    });
    context.session.checkedGenerators.add(generator);
  }
  const { manifest, official } = context;
  const adaptation = manifest.webgl_adaptation;
  assert.equal(adaptation?.schema, "pocket-card-render/webgl-stage-adaptation@1");
  assert.equal(manifest.official_spirv_sha256?.vertex, official.identityFields.vertexSpirvSha256);
  assert.equal(manifest.official_spirv_sha256?.fragment, official.identityFields.fragmentSpirvSha256);
  assert.equal(adaptation.vertex.officialSpirvSha256, official.identityFields.vertexSpirvSha256);
  assert.equal(adaptation.fragment.officialSpirvSha256, official.identityFields.fragmentSpirvSha256);
  assert.equal(adaptation.vertex.outputSha256, sha256(sourcePath(manifest.webgl_sources?.vertex)));
  assert.equal(adaptation.fragment.outputSha256, sha256(sourcePath(manifest.webgl_sources?.fragment)));
  assert.ok(Array.isArray(adaptation.vertex.substitutions) && adaptation.vertex.substitutions.length > 0);
  assert.ok(Array.isArray(adaptation.fragment.substitutions) && adaptation.fragment.substitutions.length > 0);
  return result("stageProgram", context, "source-hash-bound", [
    "the selector-owned vertex and fragment SPIR-V are re-extracted from the hash-pinned official bundle",
    "both complete SPIRV-Cross outputs are digest-locked before declared backend substitutions",
    "the shipped WebGL2 sources hash exactly to the generated adaptation outputs",
  ], ["Vulkan-to-WebGL backend substitutions still require an independent semantic-equivalence proof"]);
}

function runtimeDrawKey(draw, selector) {
  return JSON.stringify([
    draw.drawId,
    draw.goPath,
    draw.materialSlot,
    draw.materialName,
    officialPortIdentityKey(selector),
  ]);
}

function incrementCount(counts, key) {
  counts.set(key, (counts.get(key) || 0) + 1);
}

export function matchGenericRuntimeRendererDraws({ scene, actualDraws, contract, expectedSelector, key }) {
  const errors = [];
  const expectedById = new Map();
  const expectedCounts = new Map();
  const matched = [];
  const officialDraws = scene?.officialDraws;
  if (!Array.isArray(officialDraws)) {
    return { errors: [`${key}: scene.officialDraws is absent`], draws: [], expectedCount: 0 };
  }

  for (const [index, officialDraw] of officialDraws.entries()) {
    const recipe = scene.materials?.[officialDraw?.materialName];
    const ownsSelector = recipe?.shader === contract.shader_key
      && recipe?.official?.shader === expectedSelector.shaderIdentity
      && sameJson([...(recipe?.official?.validKeywords || [])].sort(), [...expectedSelector.keywords].sort());
    if (!ownsSelector) continue;

    const prefix = `${key}:officialDraw${index}`;
    const drawId = officialDraw?.drawId;
    const goPath = officialDraw?.goPath;
    const materialSlot = officialDraw?.materialSlot;
    const materialName = officialDraw?.materialName;
    if (typeof drawId !== "string" || drawId.length === 0) errors.push(`${prefix}: drawId is absent`);
    if (typeof goPath !== "string" || goPath.length === 0) errors.push(`${prefix}: goPath is absent`);
    if (!Number.isInteger(materialSlot) || materialSlot < 0) errors.push(`${prefix}: materialSlot is invalid`);
    if (typeof materialName !== "string" || materialName.length === 0) errors.push(`${prefix}: materialName is absent`);
    if (officialDraw?.shaderIdentity !== expectedSelector.shaderIdentity) errors.push(`${prefix}: selector shader identity mismatch`);
    if (typeof officialDraw?.rendererIdentity !== "string"
        || drawId !== `${officialDraw.rendererIdentity}#${materialSlot}`) {
      errors.push(`${prefix}: drawId does not encode rendererIdentity and materialSlot`);
    }
    if (expectedById.has(drawId)) errors.push(`${prefix}: duplicate expected drawId ${drawId}`);

    const expected = { drawId, goPath, materialSlot, materialName, selectorId: expectedSelector.selectorId, recipe };
    expectedById.set(drawId, expected);
    incrementCount(expectedCounts, runtimeDrawKey(expected, expectedSelector));
  }

  const relevantActual = (actualDraws || []).filter((draw) => (
    sameOfficialPortIdentity(draw?.material?.officialSelector, expectedSelector)
  ));
  const actualCounts = new Map();
  for (const [index, draw] of relevantActual.entries()) {
    const prefix = `${key}:draw${index}`;
    const drawId = draw?.identity?.drawId;
    if (typeof drawId !== "string" || drawId.length === 0) {
      errors.push(`${prefix}: drawId is absent`);
      continue;
    }
    const expected = expectedById.get(drawId);
    if (!expected) {
      errors.push(`${prefix}: extra drawId ${drawId}`);
      continue;
    }
    const materialName = draw?.identity?.materialName;
    const rendererIdentity = draw?.identity?.rendererIdentity;
    const goPath = draw?.identity?.goPath;
    const materialSlot = draw?.identity?.materialSlot;
    const actualSelector = draw?.material?.officialSelector;
    if (materialName !== expected.materialName) errors.push(`${prefix}: materialName mismatch for ${drawId}`);
    if (rendererIdentity !== drawId.slice(0, drawId.lastIndexOf("#"))) errors.push(`${prefix}: rendererIdentity mismatch for ${drawId}`);
    if (goPath !== expected.goPath) errors.push(`${prefix}: goPath mismatch for ${drawId}`);
    if (materialSlot !== expected.materialSlot) errors.push(`${prefix}: materialSlot mismatch for ${drawId}`);
    for (const field of [
      ...OFFICIAL_PORT_IDENTITY_FIELDS, "shaderIdentity", "programBlobIndex", "parameterBlobIndex",
      "executableId", "semanticExecutableId",
    ]) {
      if (actualSelector?.[field] !== expectedSelector[field]) errors.push(`${prefix}: selector ${field} mismatch`);
    }
    if (!sameJson(actualSelector?.keywords, expectedSelector.keywords)) errors.push(`${prefix}: selector keywords mismatch`);

    const actualKey = runtimeDrawKey({
      drawId,
      goPath,
      materialSlot,
      materialName,
    }, actualSelector);
    incrementCount(actualCounts, actualKey);
    matched.push({ prefix, draw, recipe: expected.recipe, expected });
  }

  for (const [expectedKey, expectedCount] of expectedCounts) {
    const actualCount = actualCounts.get(expectedKey) || 0;
    if (actualCount < expectedCount) errors.push(`${key}: missing Renderer draw ${expectedKey} (${actualCount}/${expectedCount})`);
    if (actualCount > expectedCount) errors.push(`${key}: duplicate Renderer draw ${expectedKey} (${actualCount}/${expectedCount})`);
  }
  for (const [actualKey, actualCount] of actualCounts) {
    if (!expectedCounts.has(actualKey)) errors.push(`${key}: unexpected Renderer tuple ${actualKey} (${actualCount})`);
  }
  if (relevantActual.length !== expectedById.size) {
    errors.push(`${key}: Renderer draw count mismatch (${relevantActual.length}/${expectedById.size})`);
  }

  return { errors, draws: matched, expectedCount: expectedById.size };
}

export function validateOrderedRuntimePasses(actualDraws, expectedSelector, key = "runtime") {
  if (expectedSelector?.selectionMode !== "ordered-multipass-structure") return [];
  const errors = [];
  const siblings = (actualDraws || []).filter((draw) => {
    const selector = draw?.material?.officialSelector;
    return selector?.selectorId === expectedSelector.selectorId
      && selector?.shaderIdentity === expectedSelector.shaderIdentity
      && selector?.subshader === expectedSelector.subshader
      && selector?.selectionMode === "ordered-multipass-structure";
  });
  const byDrawId = new Map();
  for (const draw of siblings) {
    const drawId = draw?.identity?.drawId;
    if (typeof drawId !== "string" || !drawId) continue;
    if (!byDrawId.has(drawId)) byDrawId.set(drawId, []);
    byDrawId.get(drawId).push(draw);
  }
  for (const [drawId, rows] of byDrawId) {
    rows.forEach((draw, index) => {
      const pass = draw?.material?.officialSelector?.pass;
      if (pass !== index) errors.push(`${key}:${drawId}: ordered pass ${index} executed as ${pass}`);
      if (index > 0 && draw.ordinal !== rows[index - 1].ordinal + 1) {
        errors.push(`${key}:${drawId}: ordered passes were not adjacent draw calls`);
      }
    });
  }
  return errors;
}

function genericRuntimeDraws(context) {
  const errors = [];
  if (!fs.existsSync(FULL_RUNTIME)) return { errors: ["full runtime evidence is absent"], draws: [] };
  const artifact = readFullRuntimeArtifact(context);
  const sourceFiles = fullRuntimeSourceFiles(ROOT);
  const sourceHashes = Object.fromEntries(sourceFiles.map((file) => [file, sha256(path.join(ROOT, file))]));
  if (artifact.schemaVersion !== FULL_RUNTIME_SCHEMA_VERSION
      || !fullRuntimeSourceIdentityMatches(artifact, sourceFiles, sourceHashes)) {
    return { errors: ["full runtime evidence is stale for the current render sources"], draws: [] };
  }
  const { manifest } = context;
  const contract = manifest.runtime_contract;
  assert.equal(contract?.schema, "pocket-card-render/webgl-runtime-port@1");
  const expectedSelector = manifest.official_selector;
  const expectedVertex = manifest.webgl_adaptation?.vertex?.outputSha256;
  const expectedFragment = manifest.webgl_adaptation?.fragment?.outputSha256;
  const draws = [];
  let expectedCount = 0;
  for (const canonical of CANONICAL_FULL_RUNTIME_SCENES) {
    const key = `${canonical.file}|zh_TW`;
    const capture = artifact.captures?.[key];
    if (!capture) { errors.push(`${key}: capture is absent`); continue; }
    const scene = readJson(path.join(ROOT, "public", canonical.file));
    const runtimeMatch = matchGenericRuntimeRendererDraws({
      scene,
      actualDraws: capture.localDraws || [],
      contract,
      expectedSelector,
      key,
    });
    errors.push(...runtimeMatch.errors);
    errors.push(...validateOrderedRuntimePasses(capture.localDraws || [], expectedSelector, key));
    expectedCount += runtimeMatch.expectedCount;
    for (const { prefix, draw, recipe, expected } of runtimeMatch.draws) {
      const material = draw.material || {};
      const program = draw.pipeline?.program || {};
      if (material.type !== "RawShaderMaterial" || material.exactShader !== contract.shader_key) {
        errors.push(`${prefix}: exact RawShaderMaterial was not used`);
      }
      if (!sameJson(material.officialExecutableIdentity, manifest.official_executable_identity)) errors.push(`${prefix}: executable identity mismatch`);
      if (material.officialPassStateSha256 !== manifest.official_pass_runtime?.source_sha256) errors.push(`${prefix}: pass-state source mismatch`);
      if (material.shaderSources?.vertexSha256 !== expectedVertex || material.shaderSources?.fragmentSha256 !== expectedFragment) {
        errors.push(`${prefix}: material shader source mismatch`);
      }
      for (const stage of ["vertex", "fragment"]) {
        if (!/^[0-9a-f]{64}$/.test(program[stage]?.sourceSha256 || "") || program[stage]?.containsMaterialSource !== true) {
          errors.push(`${prefix}: linked ${stage} source is not bound to the material source`);
        }
      }
      draws.push({ prefix, draw, recipe, expected, capture });
    }
  }
  if (expectedCount === 0) errors.push(`no canonical scene owns the exact ${contract.shader_key} selector`);
  if (draws.length === 0) errors.push(`${contract.shader_key} runtime draw is absent`);
  return { errors, draws };
}

function resolveOfficialParameter(parameter, recipe, defaults) {
  if (!parameter?.name) return Number(parameter?.val);
  return Number(recipe?.floats?.[parameter.name] ?? defaults?.[parameter.name] ?? parameter.val);
}

function colorMask(value) {
  return [1, 2, 4, 8].map((bit) => (value & bit) !== 0);
}

function verifyGenericRuntimePort(field, context) {
  const runtime = genericRuntimeDraws(context);
  if (runtime.errors.length) return result(field, context, "runtime-required", [], runtime.errors);
  const { manifest } = context;
  const contract = manifest.runtime_contract;
  const pass = manifest.official_pass_runtime;
  assert.equal(pass?.source_sha256, context.official.identityFields.passStateSha256);
  assert.equal(manifest.official_common_bindings?.schema, "pocket-card-render/compiled-common-bindings@1");
  assert.equal(manifest.official_common_bindings?.source_sha256, context.official.identityFields.commonBindingsSha256);
  const programBindings = manifest.official_program_bindings;
  if (programBindings) {
    assert.equal(programBindings.schema, "pocket-card-render/compiled-program-bindings@1");
    assert.equal(programBindings.common_source_sha256, context.official.identityFields.commonBindingsSha256);
    assert.equal(programBindings.parameter_reflection_sha256, manifest.official_parameter_entry?.reflection_sha256);
  }
  const passErrors = [];
  const bindingErrors = [];
  const officialTextureRows = programBindings?.textures || manifest.official_common_bindings.textures || [];
  const officialTextures = new Map(officialTextureRows.map((row) => [`${row.set}:${row.binding}`, row]));
  const samplerBindings = manifest.sampler_bindings || [];
  for (const row of samplerBindings) {
    const official = officialTextures.get(`0:${row.binding}`);
    assert.equal(official?.name, row.slot);
    assert.equal(official?.dim, row.dimension);
  }
  for (const { prefix, draw, recipe, capture } of runtime.draws) {
    const pipeline = draw.pipeline || {};
    const raster = pipeline.raster || {};
    const depth = pipeline.depth || {};
    const blend = pipeline.blend || {};
    const stencil = pipeline.stencil || {};
    const defaults = manifest.official_shader_property_defaults?.floats || {};
    const cull = resolveOfficialParameter(pass.culling, recipe, defaults);
    if (raster.cullEnabled !== (cull !== 0)
        || (cull === 1 && raster.cullFace !== "FRONT") || (cull === 2 && raster.cullFace !== "BACK")
        || raster.frontFace !== "CCW" || raster.polygonOffsetEnabled
        || raster.polygonOffsetFactor !== pass.fixed.offsetFactor.val
        || raster.polygonOffsetUnits !== pass.fixed.offsetUnits.val
        || raster.sampleAlphaToCoverage !== (pass.fixed.alphaToMask.val !== 0)) {
      passErrors.push(`${prefix}: raster state mismatch`);
    }
    const zTest = resolveOfficialParameter(pass.depth.test, recipe, defaults);
    const zWrite = resolveOfficialParameter(pass.depth.write, recipe, defaults) !== 0;
    if (depth.test !== (zTest !== 0) || depth.write !== zWrite || (zTest !== 0 && depth.func !== UNITY_COMPARE.get(zTest))) {
      passErrors.push(`${prefix}: depth state mismatch`);
    }
    const expectedBlend = pass.blend;
    if (!blend.enabled
        || blend.srcRgb !== UNITY_BLEND_FACTORS.get(resolveOfficialParameter(expectedBlend.src_rgb, recipe, defaults))
        || blend.dstRgb !== UNITY_BLEND_FACTORS.get(resolveOfficialParameter(expectedBlend.dst_rgb, recipe, defaults))
        || blend.srcAlpha !== UNITY_BLEND_FACTORS.get(resolveOfficialParameter(expectedBlend.src_alpha, recipe, defaults))
        || blend.dstAlpha !== UNITY_BLEND_FACTORS.get(resolveOfficialParameter(expectedBlend.dst_alpha, recipe, defaults))
        || blend.equationRgb !== UNITY_BLEND_OPS.get(resolveOfficialParameter(expectedBlend.op_rgb, recipe, defaults))
        || blend.equationAlpha !== UNITY_BLEND_OPS.get(resolveOfficialParameter(expectedBlend.op_alpha, recipe, defaults))
        || !sameJson(blend.colorMask, colorMask(resolveOfficialParameter(expectedBlend.color_mask, recipe, defaults)))) {
      passErrors.push(`${prefix}: blend state mismatch`);
    }
    const stencilComp = resolveOfficialParameter(pass.stencil.generic.comp, recipe, defaults);
    const stencilOps = ["fail", "zFail", "pass"].map((name) => resolveOfficialParameter(pass.stencil.generic[name], recipe, defaults));
    const canDisableStencil = contract.stencil_normalization === "disable-when-always-keep"
      && stencilComp === 8 && stencilOps.every((value) => value === 0);
    if (canDisableStencil) {
      if (stencil.enabled) passErrors.push(`${prefix}: inert stencil state was not normalized away`);
    } else if (!stencil.enabled) {
      passErrors.push(`${prefix}: stencil state is disabled`);
    } else {
      const ref = resolveOfficialParameter(pass.stencil.ref, recipe, defaults);
      const readMask = resolveOfficialParameter(pass.stencil.read_mask, recipe, defaults);
      const writeMask = resolveOfficialParameter(pass.stencil.write_mask, recipe, defaults);
      assert.equal(contract.stencil_face_mode, "generic");
      for (const face of ["front", "back"]) {
        const actual = stencil[face] || {};
        const source = pass.stencil.generic;
        if (actual.func !== UNITY_COMPARE.get(resolveOfficialParameter(source.comp, recipe, defaults))
            || actual.ref !== ref || actual.valueMask !== readMask || actual.writeMask !== writeMask
            || actual.fail !== UNITY_STENCIL_OP.get(resolveOfficialParameter(source.fail, recipe, defaults))
            || actual.depthFail !== UNITY_STENCIL_OP.get(resolveOfficialParameter(source.zFail, recipe, defaults))
            || actual.pass !== UNITY_STENCIL_OP.get(resolveOfficialParameter(source.pass, recipe, defaults))) {
          passErrors.push(`${prefix}: ${face} stencil state mismatch`);
        }
      }
    }
    const expectedDrawBuffers = Array.from({ length: contract.mrt_attachments }, (_, index) => `0x${(0x8ce0 + index).toString(16)}`);
    if (!sameJson(pipeline.drawBuffers, expectedDrawBuffers)) passErrors.push(`${prefix}: MRT draw buffers mismatch`);

    const program = pipeline.program || {};
    const uniforms = new Map((program.uniforms || []).map((row) => [row.name, row]));
    const attributes = new Map((program.attributes || []).map((row) => [row.name, row]));
    for (const [name, type] of Object.entries(contract.attributes || {})) {
      if (attributes.get(name)?.type !== WEBGL_TYPES.get(type)) bindingErrors.push(`${prefix}: ${name} attribute mismatch`);
    }
    for (const [name, type] of Object.entries(contract.engine_uniforms || {})) {
      const uniform = uniforms.get(name);
      if (uniform?.type !== WEBGL_TYPES.get(type)) bindingErrors.push(`${prefix}: ${name} engine uniform mismatch`);
      if (type === "mat4" && !finiteArray(uniform?.value, 16)) bindingErrors.push(`${prefix}: ${name} matrix value mismatch`);
    }
    for (const name of contract.material_uniforms?.floats || []) {
      const uniform = uniforms.get(name);
      const expected = recipe?.floats?.[name] ?? defaults[name];
      if (uniform?.type !== WEBGL_TYPES.get("float") || Number(uniform?.value) !== Number(expected)) {
        bindingErrors.push(`${prefix}: ${name} float binding mismatch`);
      }
    }
    for (const name of contract.material_uniforms?.ints || []) {
      const uniform = uniforms.get(name);
      const expected = Math.trunc(recipe?.floats?.[name] ?? defaults[name]);
      if (uniform?.type !== WEBGL_TYPES.get("int") || Number(uniform?.value) !== expected) {
        bindingErrors.push(`${prefix}: ${name} int binding mismatch`);
      }
    }
    for (const [name, type] of Object.entries(contract.material_uniforms?.vectors || {})) {
      const uniform = uniforms.get(name);
      const value = recipe?.colors?.[name];
      const serializedDefault = manifest.official_shader_property_defaults?.vectors?.[name]
        || manifest.official_shader_property_defaults?.colors?.[name]
        || [];
      const components = VECTOR_COMPONENTS.get(type);
      assert.ok(components, `unsupported material vector type: ${type}`);
      const source = value ? [value.r, value.g, value.b, value.a] : serializedDefault;
      const expected = source.slice(0, components);
      if (uniform?.type !== WEBGL_TYPES.get(type) || !sameJson(uniform?.value, expected)) {
        bindingErrors.push(`${prefix}: ${name} vector binding mismatch`);
      }
    }
    for (const [name, spec] of Object.entries(contract.dynamic_uniforms || {})) {
      const uniform = uniforms.get(name);
      if (uniform?.type !== WEBGL_TYPES.get(spec.type)) {
        bindingErrors.push(`${prefix}: ${name} dynamic uniform type mismatch`);
        continue;
      }
      if (spec.source === "official-clock") {
        const expected = Number(capture?.transformProbe?.neutral?.officialTime);
        if (!Number.isFinite(expected) || Number(uniform.value) !== expected) {
          bindingErrors.push(`${prefix}: ${name} does not match OfficialClock`);
        }
      } else {
        bindingErrors.push(`${prefix}: ${name} has unsupported dynamic source ${spec.source}`);
      }
    }
    for (const [name, spec] of Object.entries(contract.backend_uniforms || {})) {
      const uniform = uniforms.get(name);
      if (uniform?.type !== WEBGL_TYPES.get(spec.type) || !sameJson(uniform?.value, spec.value)) {
        bindingErrors.push(`${prefix}: ${name} backend uniform mismatch`);
      }
    }
    for (const row of samplerBindings) {
      const uniform = uniforms.get(row.spirvName);
      const sampler = uniform?.samplerBinding;
      const target = row.glslType === "samplerCube" ? "TEXTURE_CUBE_MAP" : "TEXTURE_2D";
      if (uniform?.type !== WEBGL_TYPES.get(row.glslType) || sampler?.target !== target
          || sampler?.matchesMaterialTexture !== true || !Number.isInteger(sampler?.unit) || sampler.unit < 0) {
        bindingErrors.push(`${prefix}: ${row.slot} sampler object mismatch`);
      }
      const recipeTexture = recipe?.textures?.[row.slot];
      if (recipeTexture?.url && target === "TEXTURE_2D" && sampler?.materialTexture?.sourceUrl !== recipeTexture.url) {
        bindingErrors.push(`${prefix}: ${row.slot} recipe texture identity mismatch`);
      }
    }
    if (contract.camera_from_view) {
      const camera = uniforms.get("cameraPosition");
      const derived = cameraFromViewMatrix(uniforms.get("viewMatrix")?.value);
      if (!derived || !finiteArray(camera?.value, 3)
          || camera.value.some((value, index) => Math.abs(value - derived[index]) > 1e-5)) {
        bindingErrors.push(`${prefix}: cameraPosition does not match inverse viewMatrix`);
      }
    }
    if (contract.require_complete_active_bindings) {
      const expectedAttributes = new Set(Object.keys(contract.attributes || {}));
      const expectedUniforms = new Set([
        ...Object.keys(contract.engine_uniforms || {}),
        ...(contract.material_uniforms?.floats || []),
        ...(contract.material_uniforms?.ints || []),
        ...Object.keys(contract.material_uniforms?.vectors || {}),
        ...Object.keys(contract.dynamic_uniforms || {}),
        ...Object.keys(contract.backend_uniforms || {}),
        ...samplerBindings.map((row) => row.spirvName),
      ]);
      if (!sameJson([...attributes.keys()].sort(), [...expectedAttributes].sort())) {
        bindingErrors.push(`${prefix}: active attribute set is not completely declared`);
      }
      if (!sameJson([...uniforms.keys()].sort(), [...expectedUniforms].sort())) {
        bindingErrors.push(`${prefix}: active uniform set is not completely declared`);
      }
      if (new Set(samplerBindings.map((row) => `${row.binding}:${row.slot}:${row.spirvName}`)).size !== samplerBindings.length
          || samplerBindings.length !== officialTextures.size) {
        bindingErrors.push(`${prefix}: sampler alias map is not a complete one-to-one binding`);
      }
    }
  }
  if (field === "passState") return result(field, context, passErrors.length ? "runtime-required" : "exact", passErrors.length ? [] : [
    "every source-current selector draw matches the official material-resolved pass state and MRT topology",
    contract.stencil_normalization === "disable-when-always-keep"
      ? "backend stencil normalization is explicit and limited to an inert Always/Keep state"
      : "active generic-face stencil state matches the official compare, masks, reference and operations",
  ], passErrors);
  if (field === "commonBindings") return result(field, context, bindingErrors.length ? "runtime-required" : "exact", bindingErrors.length ? [] : [
    "all declared engine, material, attribute and sampler bindings match active WebGL program types and values",
    "samplers are joined by official descriptor binding and SPIR-V reflection rather than parallel hand-written arrays",
  ], bindingErrors);
  if (field === "runtimeDispatch") return result(field, context, "exact", [
    "every canonical selector recipe reaches the exact RawShaderMaterial port and no non-selector recipe does",
    "selector, executable, pass and source identities are attached to every source-current draw",
  ], [], { localDrawCount: runtime.draws.length });
  return null;
}

export function verify(field, selectorKey = null, session = null) {
  const activeSession = session || createOfficialPortVerifierSession();
  const context = loadContext(field, selectorKey || selectorKeyFromArguments(), activeSession);
  const { manifest, official } = context;
  if (field === "stageProgram" && manifest.runtime_contract) {
    return verifyManifestStageProgram(context);
  }
  if (["passState", "commonBindings", "runtimeDispatch"].includes(field) && manifest.runtime_contract) {
    return verifyGenericRuntimePort(field, context);
  }
  if (context.port.selectorId === SIMPLE_OPAQUE_SELECTOR && field !== "parameterEntry") {
    return verifySimpleOpaque(field, context);
  }
  if (context.port.selectorId === TRANSPARENT_HOLOGRAM_SELECTOR && field !== "parameterEntry") {
    return verifyTransparentHologram(field, context);
  }
  if (context.port.selectorId === CARD_HOLOGRAM_SELECTOR && field !== "parameterEntry") {
    return verifyCardHologram(field, context);
  }
  if (field === "stageProgram") {
    assert.equal(manifest.official_spirv_sha256?.vertex, official.identityFields.vertexSpirvSha256);
    assert.equal(manifest.official_spirv_sha256?.fragment, official.identityFields.fragmentSpirvSha256);
    return result(field, context, "source-hash-bound", [
      "official selector owns the pinned vertex and fragment SPIR-V modules",
      "generated manifest is bound to the same stage hashes",
    ], ["WebGL GLSL adaptation has no instruction-level semantic-equivalence proof"]);
  }

  const identity = manifest.official_executable_identity;
  if (field === "parameterEntry" && manifest.official_parameter_entry && identity) {
    const extracted = extractOfficial(context);
    assert.equal(extracted.identityFields.parameterEntrySha256, official.identityFields.parameterEntrySha256);
    assert.equal(manifest.official_parameter_entry.source_sha256, extracted.identityFields.parameterEntrySha256);
    assert.equal(manifest.official_parameter_entry.byte_size, extracted.artifacts.parameterEntry.byteSize);
    assert.equal(manifest.official_parameter_entry.reflection_sha256, extracted.parameterReflectionSha256);
    const { source_sha256, byte_size, reflection_sha256, ...reflection } = manifest.official_parameter_entry;
    assert.deepEqual(reflection, extracted.parameterReflection);
    return result(field, context, "exact", [
      "raw parameter-entry bytes are re-extracted from the hash-pinned official Shader bundle",
      `the complete ${byte_size}-byte entry parses without trailing data`,
      "parameter reflection and serialized common binding declarations agree",
    ], [], { officialArtifactByteSize: byte_size, officialReflectionSha256: reflection_sha256 });
  }

  if ((field === "passState" || field === "commonBindings") && identity) {
    const identityName = field === "passState" ? "passStateSha256" : "commonBindingsSha256";
    assert.equal(identity[identityName], official.identityFields[identityName]);
    return result(field, context, "source-hash-bound", [
      `generated manifest is bound to the official ${field} byte identity`,
    ], field === "passState" ? [
      "actual WebGL polygon offset, alpha-to-coverage, MRT masks and stencil-face state are not fully captured",
    ] : [
      "local active-uniform types, sampler dimensions and every UBO-member mapping are not fully closed",
    ]);
  }

  if (field === "runtimeDispatch") {
    return result(field, context, "runtime-required", [], [
      "source-current local draw evidence is required",
    ]);
  }

  return result(field, context, "unproved", [], [`${field} has no independently verified local-port evidence`]);
}

export function printVerification(field) {
  console.log(JSON.stringify(verify(field)));
}
