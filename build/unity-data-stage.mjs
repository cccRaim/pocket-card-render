// Backend adapter for flattened shaders retaining Unity-space arithmetic.
// Applying it to an already adapted WebGL port is deliberately rejected.
import crypto from "node:crypto";
export const UNITY_DATA_STAGE_SCHEMA = "pocket-card-render/unity-data-stage@1";
const digest = (source) => crypto.createHash("sha256").update(source).digest("hex");

const INPUTS = [
  ["position", "vec3", "vec3(-position.x, position.yz)"],
  ["normal", "vec3", "vec3(-normal.x, normal.yz)"],
  ["tangent", "vec4", "vec4(-tangent.x, tangent.yz, -tangent.w)"],
  ...["uv", "uv1", "uv2", "uv3"].map((name) => [name, "vec2", `vec2(${name}.x, 1.0 - ${name}.y)`]),
];
const UNIFORMS = [
  ["modelMatrix", "mat4", "pcrUnityFromThreeWorld * modelMatrix * pcrUnityFromGlbObject"],
  ["viewMatrix", "mat4", "viewMatrix * pcrUnityFromThreeWorld"],
  ["modelViewMatrix", "mat4", "modelViewMatrix * pcrUnityFromGlbObject"],
  ["cameraPosition", "vec3", "vec3(cameraPosition.xy, -cameraPosition.z)"],
];
const PRELUDE = [
  "const highp mat4 pcrUnityFromThreeWorld = mat4(1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, -1.0, 0.0, 0.0, 0.0, 0.0, 1.0);",
  "const highp mat4 pcrUnityFromGlbObject = mat4(-1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0);",
  "highp vec2 pcrStoredUv(highp vec2 value) { return vec2(value.x, 1.0 - value.y); }",
].join("\n");

function maskComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n\r]*/g,
    (value) => value.replace(/[^\r\n]/g, " "));
}

function declarations(header) {
  const rows = [];
  const pattern = /(?:layout\s*\([^)]*\)\s*)?\b(in|uniform)\s+(?:(?:highp|mediump|lowp)\s+)?(\w+)\s+(\w+)\s*(\[[^\]]*\])?\s*;/g;
  for (const match of header.matchAll(pattern)) {
    rows.push({ storage: match[1], type: match[2], name: match[3], array: match[4], start: match.index, end: match.index + match[0].length });
  }
  return rows;
}

function splitArguments(masked, open) {
  const args = [];
  let start = open + 1;
  let depth = 0;
  for (let index = start; index < masked.length; index += 1) {
    const char = masked[index];
    if (char === "(") depth += 1;
    if (char === ")") {
      if (!depth) return [...args, [start, index]];
      depth -= 1;
    }
    if (char === "," && !depth) {
      args.push([start, index]);
      start = index + 1;
    }
  }
  throw new Error("unterminated texture call");
}

/**
 * Convert only the data boundary, keeping the flattened official calculations.
 * Callers must explicitly supply Unity-space input. Formal generators must
 * bind the returned contract and separately preserve the official program,
 * clip-space, vertex-input and runtime identities.
 */
export function adaptUnityDataStage(source, { stage, inputBasis } = {}) {
  if (inputBasis !== "unity-flattened") throw new Error("explicit unity-flattened input basis is required");
  if (!["vertex", "fragment"].includes(stage)) throw new Error("unknown shader stage");
  if (typeof source !== "string" || !source.trim()) throw new Error("GLSL source is required");
  const masked = maskComments(source);
  if (/\bpcr(?:Unity|StoredUv)\w*\b/.test(masked)) throw new Error("source already contains a basis adaptation");
  if (/^\s*#/m.test(masked)) throw new Error("preprocessor directives must be resolved before adaptation");
  const mains = [...masked.matchAll(/\bvoid\s+main\s*\(\s*\)\s*\{/g)];
  if (mains.length !== 1) throw new Error("exactly one main function is required");
  const main = mains[0];
  const bodyStart = main.index + main[0].length;
  let nesting = 1;
  let bodyEnd = bodyStart;
  while (bodyEnd < masked.length && nesting) {
    if (masked[bodyEnd] === "{") nesting += 1;
    if (masked[bodyEnd] === "}") nesting -= 1;
    bodyEnd += 1;
  }
  if (nesting || masked.slice(bodyEnd).trim()) throw new Error("main must be complete and the final declaration");
  const header = masked.slice(0, main.index);
  const rows = declarations(header);
  const strippedHeader = header.replace(/(?:layout\s*\([^)]*\)\s*)?\b(?:in|uniform)\s+(?:(?:highp|mediump|lowp)\s+)?\w+\s+\w+\s*(?:\[[^\]]*\])?\s*;/g, "");
  const rules = [...(stage === "vertex" ? INPUTS.map((row) => ["in", ...row]) : []), ...UNIFORMS.map((row) => ["uniform", ...row])];
  const aliases = new Map();
  const locals = [];
  for (const [storage, name, type, expression] of rules) {
    const matches = rows.filter((row) => row.storage === storage && row.name === name);
    if (!matches.length) continue;
    if (matches.length !== 1 || matches[0].type !== type || matches[0].array) throw new Error(`unsupported ${name} declaration`);
    if (new RegExp(`\\b${name}\\b`).test(strippedHeader)) throw new Error(`${name} used outside main`);
    const alias = `pcrUnityInput_${name}`;
    aliases.set(name, alias);
    // Distinct names keep initializers bound to Three's real globals. Never
    // shadow modelMatrix/position in their own GLSL initializers.
    locals.push(`    highp ${type} ${alias} = ${expression};`);
  }
  const samplerRows = rows.filter((row) => row.type.includes("sampler"));
  if (samplerRows.some((row) => row.array || !["sampler2D", "samplerCube"].includes(row.type))) throw new Error("unsupported sampler type or array");
  const samplers = new Map(samplerRows.map((row) => [row.name, row.type]));
  if (samplerRows.length && /\b(?:texture\w*|texelFetch\w*)\s*\(/.test(strippedHeader)) throw new Error("texture sampling outside main is unsupported");

  const edits = [];
  const body = masked.slice(bodyStart);
  for (const match of body.matchAll(/\b(?:texture\w*|texelFetch\w*)\s*\(/g)) {
    const name = /^\w+/.exec(match[0])[0];
    const open = bodyStart + match.index + match[0].lastIndexOf("(");
    const args = splitArguments(masked, open);
    const sampler = masked.slice(...args[0]).trim();
    const type = samplers.get(sampler);
    if (!type) throw new Error(`unresolved sampler expression: ${sampler}`);
    if (type === "samplerCube") continue;
    if (!((name === "texture" && [2, 3].includes(args.length)) || (name === "textureLod" && args.length === 3))) throw new Error(`unsupported sampler2D operation: ${name}`);
    const [start, end] = args[1];
    edits.push([start, start, " pcrStoredUv("], [end, end, ")"]);
  }
  for (const match of body.matchAll(/\b[A-Za-z_]\w*\b/g)) {
    if (aliases.has(match[0])) edits.push([bodyStart + match.index, bodyStart + match.index + match[0].length, aliases.get(match[0])]);
  }
  // Reject a local that would change the meaning of a converted global.
  for (const name of aliases.keys()) {
    if (new RegExp(`\\b(?:vec[234]|mat[234]|float|int)\\s+${name}\\b`).test(body)) throw new Error(`local shadows converted input ${name}`);
  }
  let transformed = source;
  for (const [start, end, replacement] of edits.sort((a, b) => b[0] - a[0] || b[1] - a[1])) {
    transformed = transformed.slice(0, start) + replacement + transformed.slice(end);
  }
  transformed = transformed.slice(0, bodyStart) + "\n" + locals.join("\n") + transformed.slice(bodyStart);
  transformed = transformed.slice(0, main.index) + PRELUDE + "\n" + transformed.slice(main.index);
  const output = transformed.replace(/[\t ]+$/gm, "").trimEnd() + "\n";
  const inputs = [...aliases.keys()];
  const storedVSampleCount = edits.filter(([start, end, replacement]) => start === end && replacement.includes("pcrStoredUv")).length;
  return {
    source: output,
    schema: UNITY_DATA_STAGE_SCHEMA,
    stage,
    inputs,
    storedVSampleCount,
    contract: { schema: UNITY_DATA_STAGE_SCHEMA, stage, inputBasis,
      inputSourceSha256: digest(source), outputSourceSha256: digest(output), inputs, storedVSampleCount },
    runtimeEvidence: false,
    backendSemanticEquivalence: false,
  };
}

export function compileUnityDataStageContract(raw) {
  const fields = ["schema", "stage", "inputBasis", "inputSourceSha256", "outputSourceSha256", "inputs", "storedVSampleCount"];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)
      || Object.keys(raw).some((key) => !fields.includes(key))
      || raw.schema !== UNITY_DATA_STAGE_SCHEMA || !["vertex", "fragment"].includes(raw.stage)
      || raw.inputBasis !== "unity-flattened"
      || ![raw.inputSourceSha256, raw.outputSourceSha256].every((value) => /^[a-f0-9]{64}$/.test(value))
      || !Number.isSafeInteger(raw.storedVSampleCount) || raw.storedVSampleCount < 0
      || !Array.isArray(raw.inputs) || new Set(raw.inputs).size !== raw.inputs.length) {
    throw new Error("Invalid Unity data-stage contract");
  }
  const allowed = [...(raw.stage === "vertex" ? INPUTS.map(([name]) => name) : []), ...UNIFORMS.map(([name]) => name)];
  if (raw.inputs.some((name) => !allowed.includes(name))) throw new Error("Unsupported Unity data-stage input");
  return Object.fromEntries(fields.map((key) => [key, key === "inputs" ? [...raw.inputs] : raw[key]]));
}

export function validateUnityDataStageSourceText(source, raw) {
  const contract = compileUnityDataStageContract(raw);
  if (digest(source) !== contract.outputSourceSha256) throw new Error("Unity data-stage output source hash mismatch");
  const masked = maskComments(source);
  if (!masked.includes(PRELUDE)) throw new Error("Unity data-stage prelude is missing");
  const main = /\bvoid\s+main\s*\(\s*\)\s*\{/.exec(masked);
  if (!main) throw new Error("Unity data-stage main is missing");
  const body = masked.slice(main.index + main[0].length);
  const rules = [...INPUTS, ...UNIFORMS];
  for (const [name, type, expression] of rules) {
    const declaration = `highp ${type} pcrUnityInput_${name} = ${expression};`;
    const count = body.split(declaration).length - 1;
    if (count !== (contract.inputs.includes(name) ? 1 : 0)) throw new Error(`Unity data-stage alias mismatch: ${name}`);
  }
  const calls = [...body.matchAll(/\bpcrStoredUv\s*\(/g)].length;
  if (calls !== contract.storedVSampleCount) throw new Error("Unity data-stage stored V sample count mismatch");
  return contract;
}
