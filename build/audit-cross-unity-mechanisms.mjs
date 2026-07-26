import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const THIS_FILE = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(THIS_FILE), "..");
const THIS_RELATIVE = path.relative(ROOT, THIS_FILE).replaceAll("\\", "/");
const JSON_MODE = process.argv.includes("--json");
const REQUIRE_EXACT = process.argv.includes("--require-exact");
const GATE_TIMEOUT_MS = 120_000;
const MAX_GATE_OUTPUT_BYTES = 8 * 1024 * 1024;
const MAX_DEBT_FINDINGS = 40;

const VERSION_BOUND_INPUTS = Object.freeze({
  "official-package-native": {
    label: "Current APK/APKM, split APKs, libunity/libil2cpp bytes, symbols, RVAs and native method hashes",
    treatment: "excluded",
  },
  "official-serialized-assets": {
    label: "Current Unity serialized objects, PPtrs, path IDs, bundle layouts and object hashes",
    treatment: "excluded",
  },
  "official-shader-programs": {
    label: "Current SMOL-V/SPIR-V bytes, selector/candidate identities and program/pass/common-binding hashes",
    treatment: "excluded",
  },
  "official-content-snapshots": {
    label: "Current Material, texture, font, locale, masterdata and card-corpus values or hashes",
    treatment: "excluded",
  },
  "official-runtime-captures": {
    label: "Official guest dispatch, descriptor, uniform, attachment, vertex binding and draw-order captures",
    treatment: "excluded",
  },
  "local-runtime-captures": {
    label: "Local browser capture artifacts, screenshots, pixels and source-bound runtime evidence",
    treatment: "excluded",
  },
  "device-presentation": {
    label: "GPU/driver behavior, Android compositor, color management and physical display transfer",
    treatment: "excluded",
  },
});

const EXCLUSIONS = Object.freeze([
  {
    id: "official-version-facts",
    label: "Facts belonging to one official game or Unity build",
    scored: false,
    reason: "They must be re-extracted after an official version change and therefore cannot prove reusable mechanism completeness.",
    inputs: [
      "official-package-native",
      "official-serialized-assets",
      "official-shader-programs",
      "official-content-snapshots",
    ],
  },
  {
    id: "official-guest-gpu-state",
    label: "Official guest/native GPU execution facts",
    scored: false,
    reason: "Dispatch, descriptors, uniforms, attachments and submitted vertices are external observations, not reusable implementation mechanisms.",
    inputs: ["official-runtime-captures"],
  },
  {
    id: "backend-semantic-equivalence",
    label: "Independent Vulkan-to-WebGL instruction-semantic equivalence",
    scored: false,
    reason: "It is an external proof obligation for a concrete backend pair, not evidence that the adaptation framework itself is reusable.",
    inputs: ["official-shader-programs", "device-presentation"],
  },
  {
    id: "visual-output",
    label: "Screenshots, pixel similarity and local runtime captures",
    scored: false,
    reason: "They are unstable, source/version bound and explicitly outside this mechanism denominator.",
    inputs: ["local-runtime-captures", "device-presentation"],
  },
]);

function nodeGate(id, label, args, options = {}) {
  return {
    id,
    label,
    executable: process.execPath,
    args,
    fixtureMode: options.fixtureMode || "synthetic",
    versionBoundInputs: [],
    timeoutMs: options.timeoutMs || GATE_TIMEOUT_MS,
  };
}

function selfGate(id, label, probe) {
  return nodeGate(id, label, [THIS_RELATIVE, "--probe", probe]);
}

const MECHANISM_DEFINITIONS = Object.freeze([
  {
    id: "official-input-provenance",
    label: "Official input/provenance boundary",
    description: "Selects one immutable input manifest and invalidates dependent domains without embedding one sample's values in the mechanism score.",
    gates: [
      selfGate(
        "synthetic-provenance-mutations",
        "Synthetic manifest selection, canonical digest and invalidation mutations",
        "official-input-provenance",
      ),
    ],
    blockingDebtIds: [],
    versionBoundInputs: [
      "official-package-native",
      "official-serialized-assets",
      "official-shader-programs",
      "official-content-snapshots",
    ],
    incompleteCost: {
      band: "medium",
      engineerDays: [2, 5],
      driver: "Manifest schema, migration-domain invalidation and producer provenance must all fail closed.",
    },
  },
  {
    id: "selector-extraction",
    label: "Selector extraction framework",
    description: "Extracts a composite selector route into validated stage programs, reflection, pass state and bindings using synthetic extractor fixtures.",
    gates: [
      nodeGate(
        "synthetic-selector-core",
        "Synthetic selector binding, pass and write/check mutation tests",
        [
          "--test",
          "--test-name-pattern=canonical JSON|official vertex inputs join|common sampler bindings|program bindings close|pass contract is policy-bound|write-or-check detects drift",
          "build/test-exact-selector-port-core.mjs",
        ],
      ),
      nodeGate(
        "synthetic-selector-extractor",
        "Synthetic selector extraction and high-level generator mutation tests",
        [
          "--test",
          "--test-name-pattern=selector extraction validates hashes|high-level selector generator",
          "build/test-exact-selector-port-core.mjs",
        ],
      ),
    ],
    blockingDebtIds: [],
    versionBoundInputs: ["official-shader-programs", "official-serialized-assets"],
    incompleteCost: {
      band: "high",
      engineerDays: [5, 12],
      driver: "Strict binary parsing, reflection joins, temporary artifact lifecycle and composite identity checks.",
    },
  },
  {
    id: "typed-webgl-adaptation",
    label: "Typed WebGL adaptation",
    description: "Represents backend conversion as typed operations rather than anonymous-member, source-regex or ordinal substitutions.",
    gates: [
      nodeGate(
        "typed-adaptation-mutations",
        "Synthetic typed adaptation graph and mutation tests",
        [
          "--test",
          "--test-name-pattern=^(?!formal ports are fully native).*$",
          "build/test-webgl-adaptation-contract.mjs",
        ],
      ),
    ],
    blockingDebtIds: ["legacy-generator-source-adaptation"],
    versionBoundInputs: ["official-shader-programs"],
    incompleteCost: {
      band: "very-high",
      engineerDays: [12, 25],
      driver: "Legacy generators must move from _mN/source-regex/ordinal rewrites to reflected typed IR operations.",
    },
  },
  {
    id: "runtime-contract-dispatch",
    label: "Runtime contract dispatch",
    description: "Loads and dispatches declarative runtime contracts by composite identity without browser behavior branches keyed by shader names.",
    gates: [
      nodeGate(
        "runtime-contract-schema-mutations",
        "Synthetic runtime-port schema and mutation tests",
        [
          "--test",
          "--test-name-pattern=runtime contract normalizes|runtime contract rejects|dynamic uniform array",
          "build/test-webgl-runtime-port-contract.mjs",
        ],
      ),
      selfGate(
        "synthetic-contract-loader",
        "Synthetic formal/runtime-bound contract loader and identity mutations",
        "runtime-contract-dispatch",
      ),
    ],
    blockingDebtIds: ["browser-shader-name-dispatch"],
    versionBoundInputs: ["official-shader-programs", "official-runtime-captures"],
    incompleteCost: {
      band: "high",
      engineerDays: [4, 8],
      driver: "Behavioral shader-name branches must become contract fields or selector-owned capabilities.",
    },
  },
  {
    id: "resource-default-transform-binding",
    label: "Resource/default/transform binding",
    description: "Resolves active resources, Shader defaults, Material overrides and Unity TexEnv transforms through typed contracts.",
    gates: [
      selfGate(
        "synthetic-resource-binding",
        "Synthetic sampler, scalar, vector and TexEnv default/override mutations",
        "resource-default-transform-binding",
      ),
    ],
    blockingDebtIds: [],
    versionBoundInputs: ["official-serialized-assets", "official-content-snapshots"],
    incompleteCost: {
      band: "medium",
      engineerDays: [2, 6],
      driver: "Every binding class needs typed precedence, dimension validation and fail-closed unresolved handling.",
    },
  },
  {
    id: "pass-mrt-bloom-framework",
    label: "Pass/MRT/bloom execution framework",
    description: "Applies declarative pass state, manages two-attachment MRT lifecycle and derives bloom activation/layout without visual evidence.",
    gates: [
      nodeGate(
        "pass-state-mutations",
        "Synthetic pass-state defaults, stencil and normalization tests",
        ["build/test-official-pass-state.mjs"],
      ),
      nodeGate(
        "bloom-activation-mutations",
        "Synthetic MRT-output-driven bloom activation tests",
        ["build/test-bloom-activation.mjs"],
      ),
      selfGate(
        "mrt-bloom-lifecycle",
        "Synthetic MRT capability/lifecycle and bloom-layout tests",
        "pass-mrt-bloom-framework",
      ),
    ],
    blockingDebtIds: [],
    versionBoundInputs: [
      "official-serialized-assets",
      "official-shader-programs",
      "official-runtime-captures",
    ],
    incompleteCost: {
      band: "high",
      engineerDays: [4, 10],
      driver: "Pass-state normalization, attachment lifecycle and postprocess activation must remain independently testable.",
    },
  },
  {
    id: "dynamic-producer",
    label: "Dynamic uniform producer framework",
    description: "Binds producer contracts to material values and verifies type, array size, upload value and clock semantics.",
    gates: [
      nodeGate(
        "dynamic-producer-mutations",
        "Synthetic dynamic uniform producer and upload mutation tests",
        ["build/test-dynamic-uniform-producer.mjs"],
      ),
    ],
    blockingDebtIds: [],
    versionBoundInputs: ["official-package-native", "official-runtime-captures"],
    incompleteCost: {
      band: "high",
      engineerDays: [3, 8],
      driver: "Producer schemas, array uploads, per-frame values and mutation coverage must be generic.",
    },
  },
  {
    id: "root-coordinate-transform",
    label: "Root/coordinate transform",
    description: "Maintains one shared card root and explicit Unity/Three basis, quaternion and pointer/touch transform semantics.",
    gates: [
      nodeGate(
        "root-coordinate-numerics",
        "Synthetic hierarchy, basis, quaternion, clamp and pointer/touch numeric tests",
        ["build/test-official-touch-rotation.mjs"],
      ),
    ],
    blockingDebtIds: [],
    versionBoundInputs: ["official-package-native", "official-runtime-captures"],
    incompleteCost: {
      band: "medium",
      engineerDays: [2, 5],
      driver: "Hierarchy ownership and every vector/matrix basis crossing need numeric mutation tests.",
    },
  },
  {
    id: "ugui-rect-transform",
    label: "UGUI RectTransform framework",
    description: "Composes anchors, pivot, local rotation and local scale into deterministic Canvas and Three transforms.",
    gates: [
      selfGate(
        "ugui-affine-unit",
        "Synthetic RectTransform arithmetic, nesting and consumer-matrix tests",
        "ugui-rect-transform",
      ),
      nodeGate(
        "ugui-affine-compose-integration",
        "Pure integration test from synthetic RectTransform hierarchy to compose/render consumers",
        ["build/test-ui-affine-transform-integration.mjs"],
      ),
    ],
    blockingDebtIds: [],
    versionBoundInputs: ["official-serialized-assets"],
    incompleteCost: {
      band: "medium",
      engineerDays: [2, 6],
      driver: "Affine composition, non-planar rejection and both Canvas/Three consumers must share one contract.",
    },
  },
  {
    id: "ugui-state-replay",
    label: "UGUI state replay",
    description: "Replays SetActive, enabled and Sprite operations sequentially with last-write-wins state into active hierarchy and deterministic draw order, including renderer integration.",
    gates: [
      nodeGate(
        "ugui-state-reducer-mutations",
        "Synthetic UGUI reducer sequential ordering, last-write-wins, idempotency and fail-closed mutation tests",
        ["build/test-ugui-state-reducer.mjs"],
      ),
      nodeGate(
        "ugui-state-render-integration",
        "Pure integration test from replayed state to compose/render draw plan",
        ["build/test-ugui-state-replay-integration.mjs"],
      ),
    ],
    blockingDebtIds: [],
    versionBoundInputs: ["official-serialized-assets", "official-runtime-captures"],
    incompleteCost: {
      band: "high",
      engineerDays: [3, 6],
      driver: "The reducer exists, but a version-independent compose/render integration gate is required before exact.",
    },
  },
  {
    id: "tmp-content-resolver",
    label: "TMP/content resolver",
    description: "Resolves message tokens, inline elements and TMP style-stack semantics from synthetic dictionaries and inputs.",
    gates: [
      selfGate(
        "synthetic-card-text-resolver",
        "Synthetic message-token, plural, reference and inline-element mutations",
        "tmp-content-resolver",
      ),
      nodeGate(
        "tmp-rich-text-state",
        "Synthetic TMP rich-text and inline-run state tests",
        ["build/test-official-tmp-rich-text.mjs"],
      ),
    ],
    blockingDebtIds: [],
    versionBoundInputs: [
      "official-serialized-assets",
      "official-content-snapshots",
      "local-runtime-captures",
    ],
    incompleteCost: {
      band: "high",
      engineerDays: [4, 10],
      driver: "Token grammar, style stacks, inline elements and fallback behavior need synthetic exhaustive tests.",
    },
  },
  {
    id: "display-density-framework",
    label: "Display density framework",
    description: "Maps CSS/DPR/drawing-buffer dimensions into source, display and DynamicUI target density without relying on runtime captures.",
    gates: [
      nodeGate(
        "quality-profile-selection",
        "Synthetic quality-profile and DynamicUI scale tests",
        ["build/test-quality-profile.mjs"],
      ),
      nodeGate(
        "display-density-integration",
        "Pure no-browser integration test for CSS/DPR/source/display/DynamicUI sizing",
        ["build/test-display-density-integration.mjs"],
      ),
    ],
    blockingDebtIds: [],
    versionBoundInputs: [
      "official-content-snapshots",
      "local-runtime-captures",
      "official-runtime-captures",
      "device-presentation",
    ],
    incompleteCost: {
      band: "medium",
      engineerDays: [1, 3],
      driver: "Core selection is tested; a no-browser end-to-end sizing contract is still required.",
    },
  },
  {
    id: "source-freshness",
    label: "Source freshness",
    description: "Rejects missing, extra or changed source identities without assigning score to any captured digest value.",
    gates: [
      selfGate(
        "synthetic-source-freshness",
        "Synthetic complete/missing/extra/changed source-identity mutations",
        "source-freshness",
      ),
    ],
    blockingDebtIds: [],
    versionBoundInputs: ["local-runtime-captures", "official-shader-programs"],
    incompleteCost: {
      band: "low",
      engineerDays: [1, 3],
      driver: "Recursive source discovery and strict set/hash equality need mutation coverage.",
    },
  },
  {
    id: "structured-audit-derivation",
    label: "Structured audit derivation",
    description: "Derives exact units only from explicit proof nodes and freshly executed gates, with inventory-only evidence capped below exact.",
    gates: [
      nodeGate(
        "proof-graph-mutations",
        "Synthetic proof-node denominator and verifier mutation tests",
        ["build/test-restoration-proof-graph.mjs"],
      ),
      selfGate(
        "cross-audit-state-invariants",
        "Synthetic exact/partial/missing/debt state invariants",
        "structured-audit-derivation",
      ),
    ],
    blockingDebtIds: [],
    versionBoundInputs: [
      "official-shader-programs",
      "official-runtime-captures",
      "local-runtime-captures",
    ],
    incompleteCost: {
      band: "medium",
      engineerDays: [2, 5],
      driver: "Every denominator unit needs a unique executable proof path and mutation-tested status invariants.",
    },
  },
]);

const REQUIRED_MECHANISM_IDS = Object.freeze([
  "official-input-provenance",
  "selector-extraction",
  "typed-webgl-adaptation",
  "runtime-contract-dispatch",
  "resource-default-transform-binding",
  "pass-mrt-bloom-framework",
  "dynamic-producer",
  "root-coordinate-transform",
  "ugui-rect-transform",
  "ugui-state-replay",
  "tmp-content-resolver",
  "display-density-framework",
  "source-freshness",
  "structured-audit-derivation",
]);

function compactOutput(value, maximumLines = 16) {
  const lines = String(value || "")
    .replace(/\u001b\[[0-9;]*m/g, "")
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean);
  return lines.slice(-maximumLines).join("\n");
}

function quoteCommandPart(value) {
  const text = String(value);
  return /[\s"]/u.test(text) ? JSON.stringify(text) : text;
}

function displayCommand(gate) {
  const executable = path.resolve(gate.executable) === path.resolve(process.execPath)
    ? "node"
    : gate.executable;
  return [executable, ...gate.args].map(quoteCommandPart).join(" ");
}

function runGate(gate) {
  const started = Date.now();
  const result = spawnSync(gate.executable, gate.args, {
    cwd: ROOT,
    env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" },
    encoding: "utf8",
    maxBuffer: MAX_GATE_OUTPUT_BYTES,
    timeout: gate.timeoutMs,
    windowsHide: true,
  });
  const elapsedMs = Date.now() - started;
  const combined = compactOutput(`${result.stdout || ""}\n${result.stderr || ""}`);
  let status;
  if (result.error?.code === "ETIMEDOUT") status = "timeout";
  else if (result.status === 0) status = "pass";
  else if (/ERR_MODULE_NOT_FOUND|MODULE_NOT_FOUND|Cannot find module|can't open file/iu.test(combined)) {
    status = "missing";
  } else {
    status = "fail";
  }
  return {
    id: gate.id,
    label: gate.label,
    command: displayCommand(gate),
    fixtureMode: gate.fixtureMode,
    versionBoundInputs: [...gate.versionBoundInputs],
    fresh: true,
    status,
    exitCode: Number.isInteger(result.status) ? result.status : null,
    signal: result.signal || null,
    elapsedMs,
    ...(status === "pass" ? {} : {
      diagnostic: combined || result.error?.message || "gate failed without output",
    }),
  };
}

function sourceLines(file) {
  return fs.readFileSync(file, "utf8").split(/\r?\n/);
}

function debtFinding(relative, line, category, source) {
  return {
    file: relative,
    line,
    category,
    snippet: source.trim().replace(/\s+/g, " ").slice(0, 220),
  };
}

function probeLegacyGeneratorDebt() {
  const buildRoot = path.join(ROOT, "build");
  const files = fs.readdirSync(buildRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^build-exact-.*\.mjs$/u.test(entry.name))
    .map((entry) => path.join(buildRoot, entry.name))
    .sort((left, right) => left.localeCompare(right));
  const findings = [];
  for (const file of files) {
    const relative = path.relative(ROOT, file).replaceAll("\\", "/");
    for (const [index, line] of sourceLines(file).entries()) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("//")) continue;
      if (/(?:^|[^A-Za-z0-9])_m(?:\d+|\$\{)/u.test(line)) {
        findings.push(debtFinding(relative, index + 1, "anonymous-member-ordinal", line));
        continue;
      }
      if (
        /\bnew\s+RegExp\s*\(/u.test(line)
        || /\b(?:source|out|output|normalized)\s*(?:=|\.)[\s\S]*?\.replace(?:All)?\s*\(\s*\//u.test(line)
        || /^\s*\.replace(?:All)?\s*\(\s*\//u.test(line)
      ) {
        findings.push(debtFinding(relative, index + 1, "source-regex-adaptation", line));
        continue;
      }
      if (/\b(?:ubos|textures|members|inputs|outputs)\?\.\[\d+\]/u.test(line)) {
        findings.push(debtFinding(relative, index + 1, "reflection-ordinal-selection", line));
      }
    }
  }
  return {
    id: "legacy-generator-source-adaptation",
    label: "Legacy build-exact _mN/source-regex/ordinal adaptation",
    fresh: true,
    status: findings.length === 0 ? "clear" : "debt",
    blocksExact: ["typed-webgl-adaptation"],
    scannedFileCount: files.length,
    findingCount: findings.length,
    findings: findings.slice(0, MAX_DEBT_FINDINGS),
    findingsTruncated: findings.length > MAX_DEBT_FINDINGS,
  };
}

function recursiveJavaScriptFiles(directory, output = []) {
  if (!fs.existsSync(directory)) return output;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) recursiveJavaScriptFiles(absolute, output);
    else if (entry.isFile() && entry.name.endsWith(".js")) output.push(absolute);
  }
  return output;
}

function probeBrowserShaderDispatchDebt() {
  const files = [
    path.join(ROOT, "public", "app.js"),
    ...recursiveJavaScriptFiles(path.join(ROOT, "public", "render")),
  ].sort((left, right) => left.localeCompare(right));
  const patterns = [
    {
      category: "direct-shader-conditional",
      expression: /\b(?:r|recipe|material|layer)\??\.shader\s*(?:===|!==|==|!=)/u,
    },
    {
      category: "shader-table-dispatch",
      expression: /\bSHADER\s*\[\s*(?:r|recipe|material|layer)\??\.shader\s*\]/u,
    },
    {
      category: "shader-indexed-behavior",
      expression: /\b[A-Z][A-Z0-9_]*(?:_DEFAULT)?\s*\[\s*(?:r|recipe|material|layer)\??\.shader\s*\]/u,
    },
    {
      category: "shader-switch-dispatch",
      expression: /\bswitch\s*\([^)]*\bshader\b[^)]*\)/u,
    },
  ];
  const findings = [];
  for (const file of files) {
    const relative = path.relative(ROOT, file).replaceAll("\\", "/");
    for (const [index, line] of sourceLines(file).entries()) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("//")) continue;
      const match = patterns.find(({ expression }) => expression.test(line));
      if (match) findings.push(debtFinding(relative, index + 1, match.category, line));
    }
  }
  return {
    id: "browser-shader-name-dispatch",
    label: "Browser behavior dispatch keyed by shader name",
    fresh: true,
    status: findings.length === 0 ? "clear" : "debt",
    blocksExact: ["runtime-contract-dispatch"],
    scannedFileCount: files.length,
    findingCount: findings.length,
    findings: findings.slice(0, MAX_DEBT_FINDINGS),
    findingsTruncated: findings.length > MAX_DEBT_FINDINGS,
  };
}

function evaluateMechanism(definition, gateResults, debtById) {
  const blockingDebts = definition.blockingDebtIds
    .map((id) => debtById.get(id))
    .filter((debt) => debt?.status === "debt")
    .map((debt) => ({
      id: debt.id,
      label: debt.label,
      findingCount: debt.findingCount,
    }));
  const passedGates = gateResults.filter((gate) => gate.status === "pass").length;
  const allGatesPassed = gateResults.length > 0 && passedGates === gateResults.length;
  const status = allGatesPassed && blockingDebts.length === 0
    ? "exact"
    : passedGates > 0
      ? "partial"
      : "missing";
  const remainingCost = status === "exact"
    ? {
      band: "none",
      engineerDays: [0, 0],
      driver: "All fresh mechanism gates passed and no blocking static debt was detected.",
    }
    : definition.incompleteCost;
  return {
    id: definition.id,
    label: definition.label,
    description: definition.description,
    status,
    exactUnits: status === "exact" ? 1 : 0,
    totalUnits: 1,
    passedGates,
    totalGates: gateResults.length,
    gates: gateResults,
    blockingDebts,
    cost: {
      baselineImplementation: definition.incompleteCost,
      remainingToExact: remainingCost,
    },
    versionBoundInputs: definition.versionBoundInputs.map((id) => ({
      id,
      treatment: VERSION_BOUND_INPUTS[id].treatment,
    })),
  };
}

function validateDefinition() {
  const ids = MECHANISM_DEFINITIONS.map(({ id }) => id);
  assert.deepEqual(
    [...ids].sort(),
    [...REQUIRED_MECHANISM_IDS].sort(),
    "cross-Unity denominator must contain exactly the required mechanism IDs",
  );
  assert.equal(new Set(ids).size, ids.length, "mechanism IDs must be unique");
  const gateIds = new Set();
  for (const definition of MECHANISM_DEFINITIONS) {
    assert(definition.gates.length > 0, `${definition.id} has no executable gate`);
    for (const gate of definition.gates) {
      assert(!gateIds.has(gate.id), `duplicate gate ID ${gate.id}`);
      gateIds.add(gate.id);
      assert.equal(gate.fixtureMode, "synthetic", `${gate.id} is not a synthetic mechanism gate`);
      assert.deepEqual(gate.versionBoundInputs, [], `${gate.id} consumes a version-bound input`);
    }
    for (const input of definition.versionBoundInputs) {
      assert(Object.hasOwn(VERSION_BOUND_INPUTS, input), `${definition.id} has unknown version-bound input ${input}`);
    }
  }
  for (const exclusion of EXCLUSIONS) {
    assert.equal(exclusion.scored, false, `${exclusion.id} must not enter the denominator`);
  }
}

function validateReport(report) {
  assert.equal(report.total, REQUIRED_MECHANISM_IDS.length);
  assert.equal(report.mechanisms.length, report.total);
  assert.equal(report.exact, report.mechanisms.filter(({ status }) => status === "exact").length);
  assert.equal(report.partial, report.mechanisms.filter(({ status }) => status === "partial").length);
  assert.equal(report.missing, report.mechanisms.filter(({ status }) => status === "missing").length);
  assert.equal(report.exact + report.partial + report.missing, report.total);
  for (const item of report.mechanisms) {
    assert(item.totalGates > 0, `${item.id} has no fresh gates`);
    assert(item.gates.every(({ fresh }) => fresh === true), `${item.id} contains a cached gate`);
    if (item.status === "exact") {
      assert.equal(item.passedGates, item.totalGates, `${item.id} exact with a failed gate`);
      assert.equal(item.blockingDebts.length, 0, `${item.id} exact with blocking debt`);
      assert.equal(item.exactUnits, 1);
    } else {
      assert.equal(item.exactUnits, 0, `${item.id} non-exact item contributed exact units`);
    }
  }
}

async function probeOfficialInputProvenance() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "pcr-cross-unity-provenance-"));
  const previous = process.env.PCR_OFFICIAL_SAMPLE_MANIFEST;
  try {
    const digest = (character) => character.repeat(64);
    const artifact = (character) => ({ sha256: digest(character), byteLength: 1 });
    const sample = {
      schemaVersion: 2,
      sampleId: "synthetic-9.8.7-unity-2099.1.2f3",
      status: "candidate",
      game: {
        packageName: "jp.pokemon.pokemontcgp",
        versionName: "9.8.7",
        versionCode: 987,
        architecture: "arm64-v8a",
        apkmBasename: "jp.pokemon.pokemontcgp_9.8.7.apkm",
      },
      unity: {
        serializedVersion: "2099.1.2f3",
        playerBuildVersion: "2099.1.2f3_synthetic",
        releaseSupportVersion: "2099.1.2f3c1_synthetic",
      },
      artifacts: {
        apkm: artifact("1"),
        baseApk: artifact("2"),
        arm64Split: artifact("3"),
        bundledTreeSplit: artifact("4"),
        libunity: artifact("5"),
        libil2cpp: artifact("6"),
        globalMetadataEncrypted: artifact("7"),
        globalMetadataPlaintext: artifact("8"),
        bootConfig: artifact("9"),
        globalGameManagers: artifact("a"),
        unityReleasePlayer: artifact("b"),
        unityReleaseSymbols: artifact("c"),
      },
      snapshots: {
        masterdata: { pokemonSha256: digest("d"), trainerSha256: digest("e") },
        faceBundles: { inventorySha256: digest("f") },
      },
      proofSets: {
        materialPrograms: {
          proofGraphSha256: digest("0"),
          portIndexSha256: digest("1"),
        },
      },
      canonicalCorpus: {
        path: "build/synthetic-corpus.json",
        sha256: digest("2"),
      },
    };
    const samplePath = path.join(temp, "synthetic.json");
    const pointerPath = path.join(temp, "current.json");
    fs.writeFileSync(samplePath, `${JSON.stringify(sample, null, 2)}\n`);
    fs.writeFileSync(pointerPath, `${JSON.stringify({
      schemaVersion: 1,
      manifest: "synthetic.json",
    }, null, 2)}\n`);
    process.env.PCR_OFFICIAL_SAMPLE_MANIFEST = pointerPath;
    const moduleUrl = `${pathToFileURL(path.join(ROOT, "build", "official-sample.mjs")).href}?synthetic=${Date.now()}`;
    const {
      loadOfficialSample,
      officialSampleDigest,
      validateOfficialSample,
    } = await import(moduleUrl);
    assert.deepEqual(validateOfficialSample(structuredClone(sample)), sample);
    const reordered = Object.fromEntries(Object.entries(sample).reverse());
    assert.equal(officialSampleDigest(reordered), officialSampleDigest(sample));
    assert.equal(loadOfficialSample(pointerPath).sample.sampleId, sample.sampleId);
    assert.throws(
      () => validateOfficialSample({
        ...structuredClone(sample),
        game: { ...sample.game, architecture: "x86_64" },
      }),
      /unsupported architecture/,
    );
    const invalidHash = structuredClone(sample);
    invalidHash.artifacts.libunity.sha256 = "not-a-hash";
    assert.throws(() => validateOfficialSample(invalidHash), /libunity has invalid SHA-256/);
    const invalidBasename = structuredClone(sample);
    invalidBasename.game.apkmBasename = "wrong.apkm";
    assert.throws(
      () => validateOfficialSample(invalidBasename),
      /APKM basename does not match/,
    );
  } finally {
    if (previous === undefined) delete process.env.PCR_OFFICIAL_SAMPLE_MANIFEST;
    else process.env.PCR_OFFICIAL_SAMPLE_MANIFEST = previous;
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

function response(body) {
  return {
    ok: true,
    async json() { return JSON.parse(body); },
    async text() { return body; },
  };
}

async function probeRuntimeContractDispatch() {
  const { loadExactShaderPortsFromContract } = await import(
    pathToFileURL(path.join(ROOT, "public", "render", "exact-port-loader.js")).href
  );
  const selector = {
    selectorId: "selector",
    candidateWitnessId: "candidate",
    semanticExecutableId: "semantic",
    shaderIdentity: "CAB:synthetic:1",
    shaderName: "Synthetic/Formal",
    keywords: [],
    selectionMode: "unique-exact-keywords",
    subshader: 0,
    pass: 0,
  };
  const contract = {
    schema: "pocket-card-render/official-program-port-contract@2",
    ports: [{
      selectorId: selector.selectorId,
      candidateWitnessId: selector.candidateWitnessId,
      semanticExecutableId: selector.semanticExecutableId,
      subshader: selector.subshader,
      pass: selector.pass,
      manifest: "public/shaders/formal.json",
    }],
    runtimeBound: [{
      manifest: "public/shaders/runtime.json",
      boundary: "synthetic runtime boundary",
    }],
  };
  const formal = {
    official_selector: selector,
    runtime_contract: { shader_key: "SyntheticFormal" },
    webgl_sources: {
      vertex: "public/shaders/formal.vert.glsl",
      fragment: "public/shaders/formal.frag.glsl",
    },
  };
  const runtime = {
    runtime_contract: {
      schema: "pocket-card-render/stage-source-runtime-contract@1",
      shader_key: "SyntheticRuntime",
      stage_source_only: true,
    },
    webgl_sources: {
      vertex: "public/shaders/runtime.vert.glsl",
      fragment: "public/shaders/runtime.frag.glsl",
    },
  };
  const assets = new Map([
    ["contract.json", JSON.stringify(contract)],
    ["shaders/formal.json", JSON.stringify(formal)],
    ["shaders/runtime.json", JSON.stringify(runtime)],
    ["shaders/formal.vert.glsl", "formal vertex"],
    ["shaders/formal.frag.glsl", "formal fragment"],
    ["shaders/runtime.vert.glsl", "runtime vertex"],
    ["shaders/runtime.frag.glsl", "runtime fragment"],
  ]);
  const fetchAsset = async (url) => (
    assets.has(String(url)) ? response(assets.get(String(url))) : { ok: false }
  );
  const loaded = await loadExactShaderPortsFromContract({
    fetchAsset,
    contractUrl: "contract.json",
  });
  assert.deepEqual(Object.keys(loaded).sort(), ["SyntheticFormal", "SyntheticRuntime"]);
  assert.equal(loaded.SyntheticFormal.manifests.length, 1);
  assert.equal(loaded.SyntheticFormal.stageSourceOnly, false);
  assert.equal(loaded.SyntheticRuntime.stageSourceOnly, true);
  assert.equal(loaded.SyntheticRuntime.runtimeBoundary, "synthetic runtime boundary");

  const rejected = structuredClone(contract);
  rejected.ports[0].candidateWitnessId = "wrong";
  const mutatedAssets = new Map(assets);
  mutatedAssets.set("contract.json", JSON.stringify(rejected));
  await assert.rejects(
    loadExactShaderPortsFromContract({
      fetchAsset: async (url) => (
        mutatedAssets.has(String(url)) ? response(mutatedAssets.get(String(url))) : { ok: false }
      ),
      contractUrl: "contract.json",
    }),
    /contract and manifest identity disagree/,
  );
}

async function probeResourceDefaultTransformBinding() {
  const THREE = await import("three");
  const { makeRenderContext } = await import(
    pathToFileURL(path.join(ROOT, "public", "render", "context.js")).href
  );
  const { unityTexEnvToThreeGltfSt } = await import(
    pathToFileURL(path.join(ROOT, "public", "render", "texture-transform.js")).href
  );
  assert.deepEqual(unityTexEnvToThreeGltfSt(null, {
    defaultName: "white",
    dimension: 2,
  }), [1, 1, 0, 0]);
  assert.deepEqual(unityTexEnvToThreeGltfSt({
    scale: { x: 2, y: 0.5 },
    offset: { x: 0.1, y: 0.2 },
  }), [2, 0.5, 0.1, 0.3]);
  assert.throws(
    () => unityTexEnvToThreeGltfSt(null, { defaultName: "gray", dimension: 4 }),
    /neither a Material TexEnv nor a 2D Shader default/,
  );

  const context = makeRenderContext({
    texInfo: new Map(),
    envCubeTex: null,
    exactShaders: {},
    animMats: [],
    exactGlitMats: [],
    kiraPuyoMats: [],
    circularKiraComponents: new Map(),
    runtimeSettings: {},
    dynUITex: null,
    dynHoloTex: null,
    foilTex: null,
    exHoloMats: [],
  });
  const sampler = new THREE.DataTexture(
    new Uint8Array([255, 255, 255, 255]),
    1,
    1,
    THREE.RGBAFormat,
  );
  const manifest = {
    shader: "Synthetic/Binding",
    sampler_bindings: [{
      slot: "_MainTex",
      spirvName: "_13",
      binding: 0,
      dimension: 2,
      glslType: "sampler2D",
    }],
    runtime_contract: {
      material_uniforms: {
        floats: ["_Amount"],
        ints: ["_Mode"],
        vectors: { _Tint: "vec4" },
      },
      texture_coordinates: {
        vertex: {
          transforms: [{
            uniform: "_MainTex_ST",
            slot: "_MainTex",
            input: "uv",
            output: "vUv",
            conversion: "unity-texenv-to-three-gltf-v",
          }],
        },
      },
      backend_uniforms: { _BackendFlag: { value: 1 } },
    },
    official_shader_property_defaults: {
      floats: { _Amount: 0.25, _Mode: 2 },
      colors: { _Tint: [0.1, 0.2, 0.3, 0.4] },
      vectors: {},
      textureDescriptors: {
        _MainTex: { defaultName: "white", dimension: 2 },
      },
    },
  };
  const defaults = context.exactPortUniforms({}, { manifest }, () => sampler);
  assert.equal(defaults._13.value, sampler);
  assert.equal(defaults._Amount.value, 0.25);
  assert.equal(defaults._Mode.value, 2);
  assert.deepEqual(defaults._Tint.value.toArray(), [0.1, 0.2, 0.3, 0.4]);
  assert.deepEqual(defaults._MainTex_ST.value.toArray(), [1, 1, 0, 0]);
  assert.equal(defaults._BackendFlag.value, 1);

  const overrides = context.exactPortUniforms({
    floats: { _Amount: 0.75, _Mode: 4 },
    colors: { _Tint: { r: 1, g: 0.5, b: 0.25, a: 1 } },
    textures: {
      _MainTex: {
        scale: { x: 2, y: 0.5 },
        offset: { x: 0.1, y: 0.2 },
      },
    },
  }, { manifest }, () => sampler);
  assert.equal(overrides._Amount.value, 0.75);
  assert.equal(overrides._Mode.value, 4);
  assert.deepEqual(overrides._Tint.value.toArray(), [1, 0.5, 0.25, 1]);
  assert.deepEqual(overrides._MainTex_ST.value.toArray(), [2, 0.5, 0.1, 0.3]);
  assert.throws(
    () => context.exactPortUniforms({}, { manifest }, () => null),
    /sampler _MainTex is unresolved/,
  );
  sampler.dispose();
}

async function probePassMrtBloomFramework() {
  const {
    OFFICIAL_MRT_DESCRIPTOR,
    createOfficialMrtTarget,
    disposeOfficialMrtTarget,
    inspectOfficialMrtCapabilities,
    resizeOfficialMrtTarget,
  } = await import(
    pathToFileURL(path.join(ROOT, "public", "render", "pipeline", "official-mrt.js")).href
  );
  const {
    getOfficialBloomBufferSize,
    getOfficialBloomLayout,
  } = await import(
    pathToFileURL(path.join(ROOT, "public", "render", "pipeline", "official-bloom.js")).href
  );
  const gl = {
    MAX_DRAW_BUFFERS: 0x8824,
    MAX_COLOR_ATTACHMENTS: 0x8cdf,
    drawBuffers() {},
    readBuffer() {},
    texStorage2D() {},
    createVertexArray() {},
    getParameter(parameter) {
      if (parameter === this.MAX_DRAW_BUFFERS) return 4;
      if (parameter === this.MAX_COLOR_ATTACHMENTS) return 4;
      return 0;
    },
  };
  const renderer = { getContext: () => gl };
  const capabilities = inspectOfficialMrtCapabilities(renderer);
  assert.equal(capabilities.supported, true);
  assert.equal(capabilities.requiredColorAttachments, 2);
  const target = createOfficialMrtTarget(renderer, 8, 16);
  assert.equal(target.textures.length, 2);
  assert.deepEqual(target.textures.map(({ name }) => name), ["sceneColor", "emissive"]);
  resizeOfficialMrtTarget(target, 16, 32);
  assert.equal(target.width, 16);
  assert.equal(target.height, 32);
  assert.equal(disposeOfficialMrtTarget(target), true);
  assert.equal(disposeOfficialMrtTarget(target), false);
  assert.throws(() => resizeOfficialMrtTarget(target, 4, 4), /disposed/);
  assert.throws(
    () => inspectOfficialMrtCapabilities(renderer, {
      ...OFFICIAL_MRT_DESCRIPTOR,
      count: 3,
    }),
    /does not match its attachments/,
  );

  assert.deepEqual(getOfficialBloomBufferSize(1920, 1080), { width: 455, height: 256 });
  assert.deepEqual(getOfficialBloomBufferSize(1080, 1920), { width: 256, height: 455 });
  const layout = getOfficialBloomLayout(1080, 1920);
  assert.equal(layout.levels.length, 5);
  assert(layout.levels.every((level, index) => (
    level.level === index + 1
    && level.width > 0
    && level.height > 0
    && level.uv.every(Number.isFinite)
    && level.ndc.every(Number.isFinite)
  )));
  const weight = layout.levels.reduce((sum, level) => sum + level.weight, 0);
  assert(Math.abs(weight - 1) < 1e-6);
}

async function probeTmpContentResolver() {
  const {
    CARD_TEXT_SENTINELS,
    createCardTextResolver,
    inlineElementTypeFromSentinel,
  } = await import(
    pathToFileURL(path.join(ROOT, "build", "card-text-resolver.mjs")).href
  );
  const resolve = createCardTextResolver({
    CONDITION: "Asleep",
    EVOLUTION_STAGE_POKEMON_BASIC: "Basic Pokemon",
  }, {
    cardName: (id) => `Card-${id}`,
    attackName: (id) => `Attack-${id}`,
    abilityName: (id, suffix) => `Ability-${id}-${suffix || "full"}`,
  }, "en_US");
  assert.equal(
    resolve('[Gr:Count s="one " p="many " ref="0"][Num:Int id="0"]', [1]),
    "one 1",
  );
  assert.equal(
    resolve('[Gr:Count s="one " p="many " ref="0"][Num:Int id="0"]', [2]),
    "many 2",
  );
  assert.equal(resolve('[Text:CardName id="0"]', [7]), "Card-7");
  assert.equal(resolve('[Text:AttackName id="0"]', [8]), "Attack-8");
  assert.equal(
    resolve('[Text:AbilityName id="0" suffix="Short"]', [9]),
    "Ability-9-Short",
  );
  assert.equal(resolve('[Text:SpecialCondition id="0"]', ["CONDITION"]), "Asleep");
  assert.equal(resolve('[Text:EvolutionPokemon id="0"]', ["BASIC"]), "Basic Pokemon");
  const inline = resolve('[Img:Element name="R"]');
  assert.equal(inlineElementTypeFromSentinel(inline), "Fire");
  assert.equal(
    resolve("[Ctrl:Bold]x[/Ctrl:Bold]"),
    `${CARD_TEXT_SENTINELS.boldStart}x${CARD_TEXT_SENTINELS.boldEnd}`,
  );
  assert.equal(resolve("a[C:Nbsp]b"), "a\u00a0b");
  assert.equal(resolve("[[literal]]"), "[literal]");
}

async function probeUguiRectTransform() {
  const THREE = await import("three");
  const {
    IDENTITY_UI_AFFINE,
    applyUiAffineToCanvas,
    isIdentityUiAffine,
    multiplyUiAffine,
    rectTransformUiAffine,
    transformUiPoint,
    uiAffineToMatrix4,
  } = await import(
    pathToFileURL(path.join(ROOT, "public", "render", "ui-affine-transform.js")).href
  );
  const close = (actual, expected, epsilon = 1e-7) => {
    assert.equal(actual.length, expected.length);
    actual.forEach((value, index) => assert(
      Math.abs(value - expected[index]) <= epsilon,
      `${index}: expected ${expected[index]}, got ${value}`,
    ));
  };
  assert.equal(isIdentityUiAffine(IDENTITY_UI_AFFINE), true);
  close(transformUiPoint(IDENTITY_UI_AFFINE, [3, 4]), [3, 4]);

  const quarterTurn = rectTransformUiAffine({
    pivot: [10, 20],
    rotation: [0, 0, Math.SQRT1_2, Math.SQRT1_2],
    scale: [2, 3],
  });
  close(transformUiPoint(quarterTurn, [11, 20]), [10, 22]);
  close(transformUiPoint(quarterTurn, [10, 21]), [7, 20]);
  const child = rectTransformUiAffine({
    pivot: [4, 5],
    rotation: [0, 0, 0, 1],
    scale: [0.5, 2],
  }, quarterTurn);
  close(
    transformUiPoint(child, [7, 8]),
    transformUiPoint(
      quarterTurn,
      transformUiPoint(
        rectTransformUiAffine({
          pivot: [4, 5],
          rotation: [0, 0, 0, 1],
          scale: [0.5, 2],
        }),
        [7, 8],
      ),
    ),
  );
  close(multiplyUiAffine(IDENTITY_UI_AFFINE, child), child);
  const matrix = uiAffineToMatrix4(child, THREE.Matrix4);
  const point = new THREE.Vector3(7, 8, 0).applyMatrix4(matrix);
  close([point.x, point.y], transformUiPoint(child, [7, 8]));
  const calls = [];
  applyUiAffineToCanvas({ transform: (...values) => calls.push(values) }, child);
  assert.deepEqual(calls, [child]);
  assert.throws(
    () => rectTransformUiAffine({
      pivot: [0, 0],
      rotation: [0.1, 0, 0, 1],
      scale: [1, 1],
    }),
    /non-planar/,
  );
  assert.throws(
    () => rectTransformUiAffine({
      pivot: [0, 0],
      rotation: [0, 0, 0, 0],
      scale: [1, 1],
    }),
    /zero/,
  );
}

async function probeSourceFreshness() {
  const {
    FULL_RUNTIME_LEGACY_NON_RENDER_SOURCES,
    fullRuntimeSourceIdentityMatches,
    runtimeShaderManifestReferences,
  } = await import(
    pathToFileURL(path.join(ROOT, "build", "full-runtime-sources.mjs")).href
  );
  const {
    TMP_RUNTIME_LEGACY_NON_RENDER_SOURCES,
    tmpRuntimeSourceIdentityMatches,
  } = await import(
    pathToFileURL(path.join(ROOT, "build", "tmp-runtime-sources.mjs")).href
  );
  const digestA = "a".repeat(64);
  const digestB = "b".repeat(64);
  const files = ["public/app.js", "public/render/context.js"];
  const hashes = Object.fromEntries(files.map((file) => [file, digestA]));
  const artifact = { sourceFiles: [...files], sourceHashes: { ...hashes } };
  assert.equal(fullRuntimeSourceIdentityMatches(artifact, files, hashes), true);
  assert.equal(fullRuntimeSourceIdentityMatches({
    sourceFiles: files.slice(0, 1),
    sourceHashes: { [files[0]]: digestA },
  }, files, hashes), false);
  assert.equal(fullRuntimeSourceIdentityMatches({
    sourceFiles: [...files],
    sourceHashes: { ...hashes, [files[0]]: digestB },
  }, files, hashes), false);
  const extra = structuredClone(artifact);
  extra.sourceFiles.push("unexpected.js");
  extra.sourceHashes["unexpected.js"] = digestB;
  assert.equal(fullRuntimeSourceIdentityMatches(extra, files, hashes), false);
  const legacy = structuredClone(artifact);
  for (const file of FULL_RUNTIME_LEGACY_NON_RENDER_SOURCES) {
    legacy.sourceFiles.push(file);
    legacy.sourceHashes[file] = digestB;
  }
  assert.equal(fullRuntimeSourceIdentityMatches(legacy, files, hashes), true);

  const tmp = {
    "public/render/tmp-sdf-renderer.js": digestA,
    "public/shaders/tmp_sdf.frag.glsl": digestA,
  };
  assert.equal(tmpRuntimeSourceIdentityMatches({ ...tmp }, tmp), true);
  const tmpLegacy = { ...tmp };
  for (const file of TMP_RUNTIME_LEGACY_NON_RENDER_SOURCES) tmpLegacy[file] = digestB;
  assert.equal(tmpRuntimeSourceIdentityMatches(tmpLegacy, tmp), true);
  assert.equal(tmpRuntimeSourceIdentityMatches({
    ...tmp,
    "unexpected.js": digestB,
  }, tmp), false);
  assert.deepEqual(runtimeShaderManifestReferences(`
    fetch("shaders/a.json");
    new URL("../../shaders/b.json", import.meta.url);
    fetch("not-shaders/c.json");
  `), ["public/shaders/a.json", "public/shaders/b.json"]);
}

function deriveSyntheticStatus(gates, blockingDebtCount = 0) {
  const passed = gates.filter((status) => status === "pass").length;
  if (gates.length > 0 && passed === gates.length && blockingDebtCount === 0) return "exact";
  return passed > 0 ? "partial" : "missing";
}

async function probeStructuredAuditDerivation() {
  assert.equal(deriveSyntheticStatus(["pass"]), "exact");
  assert.equal(deriveSyntheticStatus(["pass"], 1), "partial");
  assert.equal(deriveSyntheticStatus(["pass", "fail"]), "partial");
  assert.equal(deriveSyntheticStatus(["pass", "missing"]), "partial");
  assert.equal(deriveSyntheticStatus(["fail"]), "missing");
  assert.equal(deriveSyntheticStatus([]), "missing");
}

const PROBES = Object.freeze({
  "official-input-provenance": probeOfficialInputProvenance,
  "runtime-contract-dispatch": probeRuntimeContractDispatch,
  "resource-default-transform-binding": probeResourceDefaultTransformBinding,
  "pass-mrt-bloom-framework": probePassMrtBloomFramework,
  "ugui-rect-transform": probeUguiRectTransform,
  "tmp-content-resolver": probeTmpContentResolver,
  "source-freshness": probeSourceFreshness,
  "structured-audit-derivation": probeStructuredAuditDerivation,
});

function aggregateRemainingCost(mechanisms) {
  return mechanisms.reduce((result, item) => {
    const [minimum, maximum] = item.cost.remainingToExact.engineerDays;
    result.minimumEngineerDays += minimum;
    result.maximumEngineerDays += maximum;
    return result;
  }, {
    minimumEngineerDays: 0,
    maximumEngineerDays: 0,
    interpretation: "Order-of-magnitude implementation and evidence cost; external exclusions are not included.",
  });
}

function buildReport() {
  validateDefinition();
  const debtProbes = [
    probeLegacyGeneratorDebt(),
    probeBrowserShaderDispatchDebt(),
  ];
  const debtById = new Map(debtProbes.map((probe) => [probe.id, probe]));
  const mechanisms = MECHANISM_DEFINITIONS.map((definition) => {
    const gates = definition.gates.map(runGate);
    return evaluateMechanism(definition, gates, debtById);
  });
  const exact = mechanisms.filter(({ status }) => status === "exact").length;
  const partial = mechanisms.filter(({ status }) => status === "partial").length;
  const missing = mechanisms.filter(({ status }) => status === "missing").length;
  const total = mechanisms.length;
  const report = {
    schema: "pocket-card-render/cross-unity-mechanism-audit@1",
    definitionVersion: 1,
    generatedAt: new Date().toISOString(),
    scoreMeaning: "Reusable mechanism exactness only; this is not official shader restoration, pixel similarity, or current-sample coverage.",
    scoringPolicy: {
      denominator: "One equal unit for each required reusable mechanism.",
      exact: "Every listed gate executed fresh and passed, and every mapped static debt probe is clear.",
      partial: "At least one fresh gate passed, but a gate is failed/missing or a mapped static debt remains.",
      missing: "No fresh gate passed.",
      filePresence: "Never sufficient for a pass; every scored gate is executed in a child process.",
      versionFacts: "All version-bound inputs below are excluded from scoring.",
    },
    exact,
    total,
    percent: total === 0 ? 0 : exact / total * 100,
    partial,
    missing,
    remainingCost: aggregateRemainingCost(mechanisms),
    versionBoundInputs: Object.entries(VERSION_BOUND_INPUTS).map(([id, value]) => ({
      id,
      ...value,
      scored: false,
    })),
    exclusions: EXCLUSIONS,
    debtProbes,
    mechanisms,
  };
  validateReport(report);
  return report;
}

function pad(value, width) {
  const text = String(value);
  return text.length >= width ? text : `${text}${" ".repeat(width - text.length)}`;
}

function printHuman(report) {
  console.log("Cross-Unity reusable mechanism audit");
  console.log(
    `exact ${report.exact}/${report.total} (${report.percent.toFixed(2)}%); `
      + `partial ${report.partial}; missing ${report.missing}`,
  );
  console.log(
    `remaining cost ${report.remainingCost.minimumEngineerDays}`
      + `-${report.remainingCost.maximumEngineerDays} engineer-days (external exclusions omitted)`,
  );
  console.log("");
  console.log(`${pad("mechanism", 39)} ${pad("status", 8)} ${pad("gates", 7)} ${pad("remaining", 13)} blockers`);
  console.log("-".repeat(96));
  for (const item of report.mechanisms) {
    const remaining = item.cost.remainingToExact.engineerDays;
    const blockers = [
      ...item.gates.filter(({ status }) => status !== "pass").map(({ id, status }) => `${id}:${status}`),
      ...item.blockingDebts.map(({ id }) => id),
    ];
    console.log(
      `${pad(item.id, 39)} ${pad(item.status, 8)} `
        + `${pad(`${item.passedGates}/${item.totalGates}`, 7)} `
        + `${pad(`${remaining[0]}-${remaining[1]}d`, 13)} `
        + `${blockers.join(", ") || "-"}`,
    );
  }
  console.log("");
  console.log("Static debt probes");
  for (const probe of report.debtProbes) {
    console.log(
      `  ${probe.status === "clear" ? "CLEAR" : "DEBT "} `
        + `${probe.id}: ${probe.findingCount} finding(s) in ${probe.scannedFileCount} files`,
    );
    for (const finding of probe.findings.slice(0, 5)) {
      console.log(`    ${finding.file}:${finding.line} [${finding.category}] ${finding.snippet}`);
    }
    if (probe.findingCount > 5) console.log(`    ... ${probe.findingCount - 5} more`);
  }
  console.log("");
  console.log("Excluded from denominator");
  for (const exclusion of report.exclusions) {
    console.log(`  - ${exclusion.id}: ${exclusion.reason}`);
  }
}

async function runProbe(name) {
  const probe = PROBES[name];
  if (!probe) throw new Error(`unknown cross-Unity mechanism probe: ${name}`);
  await probe();
  console.log(`OK cross-Unity mechanism probe: ${name}`);
}

async function main() {
  const probeIndex = process.argv.indexOf("--probe");
  if (probeIndex >= 0) {
    const name = process.argv[probeIndex + 1];
    if (!name) throw new Error("--probe requires a probe name");
    await runProbe(name);
    return;
  }
  const report = buildReport();
  if (JSON_MODE) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else printHuman(report);
  if (REQUIRE_EXACT && report.exact !== report.total) process.exitCode = 1;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === THIS_FILE;
if (isMain) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : String(error));
    process.exitCode = 1;
  });
}
