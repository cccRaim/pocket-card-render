// Build representative runtime probes from scene recipes and the same official
// ShaderLab extraction consumed by audit-render-state.mjs, then execute them in
// three r165/WebGL2 SwiftShader without screenshots.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import {
  REGION,
  applyCullState,
  applyDepthState,
  applyRenderQueueState,
  applyStencilState,
  setBlend,
} from "../public/render/context.js";
import { SHADER } from "../public/render/rarities.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const IS_MAIN = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
const SHADER_ROOT = process.env.PCR_SHADERS
  || "D:/DevProjectes/ptcgp-tools-master/masterdata_decoder/.output/decrypted/Common/Shader";

const UNITY_BLEND_TO_WEBGL = Object.freeze({
  0: "ZERO",
  1: "ONE",
  2: "DST_COLOR",
  3: "SRC_COLOR",
  4: "ONE_MINUS_DST_COLOR",
  5: "SRC_ALPHA",
  6: "ONE_MINUS_SRC_COLOR",
  7: "DST_ALPHA",
  8: "ONE_MINUS_DST_ALPHA",
  9: "SRC_ALPHA_SATURATE",
  10: "ONE_MINUS_SRC_ALPHA",
});
const UNITY_COMPARE_TO_WEBGL = Object.freeze({
  1: "NEVER",
  2: "LESS",
  3: "EQUAL",
  4: "LEQUAL",
  5: "GREATER",
  6: "NOTEQUAL",
  7: "GEQUAL",
  8: "ALWAYS",
});
const UNITY_STENCIL_OP_TO_WEBGL = Object.freeze({
  0: "KEEP",
  1: "ZERO",
  2: "REPLACE",
  3: "INCR",
  4: "DECR",
  5: "INVERT",
  6: "INCR_WRAP",
  7: "DECR_WRAP",
});
const UNITY_BLEND_OP_TO_WEBGL = Object.freeze({
  0: "FUNC_ADD",
  1: "FUNC_SUBTRACT",
  2: "FUNC_REVERSE_SUBTRACT",
  3: "MIN",
  4: "MAX",
});

function fail(message, detail = "") {
  throw new Error(detail ? `${message}\n${detail}` : message);
}

function runExistingOfficialAudit() {
  const result = spawnSync(process.execPath, ["build/audit-render-state.mjs"], {
    cwd: ROOT,
    env: process.env,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.error) fail("could not run audit-render-state.mjs", result.error.message);
  if (result.status !== 0) {
    fail(
      "existing official render-state audit failed",
      `${result.stdout || ""}\n${result.stderr || ""}`.trim(),
    );
  }
}

function extractOfficialStates() {
  const python = process.env.PCR_PYTHON || "python";
  const result = spawnSync(python, ["build/extract-shader-defaults.py"], {
    cwd: ROOT,
    env: process.env,
    shell: process.platform === "win32",
    input: JSON.stringify({ root: SHADER_ROOT, shaders: Object.keys(SHADER).sort() }),
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.error) fail("could not run extract-shader-defaults.py", result.error.message);
  if (result.status !== 0) {
    fail("official ShaderLab state extraction failed", `${result.stdout || ""}\n${result.stderr || ""}`.trim());
  }
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    fail("official ShaderLab state extraction returned invalid JSON", error.message);
  }
}

function resolveParam(param, recipe) {
  if (!param) return null;
  const value = param.name ? recipe.floats?.[param.name] ?? param.val : param.val;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function passBlend(pass, target) {
  if (!pass) return null;
  const activeTarget = pass.rtSeparateBlend ? target : 0;
  return pass.rtBlends?.[activeTarget] || (activeTarget === 0 ? pass.blend : null);
}

function scoreVariant(pass, recipe) {
  if (!pass) return -1;
  const blend = passBlend(pass, 0);
  const parameters = [
    blend?.src,
    blend?.dst,
    blend?.srcAlpha,
    blend?.dstAlpha,
    pass.zTest,
    pass.zWrite,
    pass.culling,
    pass.stencilRef,
    pass.stencilReadMask,
    pass.stencilWriteMask,
    pass.stencilOp?.comp,
    pass.stencilOp?.pass,
  ];
  return parameters.filter((param) => param?.name && recipe.floats?.[param.name] != null).length;
}

function selectOfficialPass(official, shader, recipe) {
  const candidates = (official.found[shader]?.variants || [])
    .map((variant, index) => ({
      variant,
      index,
      pass: variant.passStates?.[0],
      score: scoreVariant(variant.passStates?.[0], recipe),
    }))
    .filter((candidate) => candidate.pass)
    .sort((a, b) => b.score - a.score || a.index - b.index);
  const best = candidates[0];
  if (!best) fail(`official pass missing for ${shader}`);
  return {
    key: best.variant.fullName || shader,
    pass: best.pass,
  };
}

function enumSymbol(table, value, label) {
  const symbol = table[value];
  if (!symbol) fail(`unsupported official ${label} enum ${value}`);
  return symbol;
}

function resolveBlend(pass, recipe, target = 0) {
  const blend = passBlend(pass, target);
  if (!blend) fail(`official blend state missing for ${recipe.shader} RT${target}`);
  const resolved = {
    srcRGBValue: resolveParam(blend.src, recipe),
    dstRGBValue: resolveParam(blend.dst, recipe),
    srcAlphaValue: resolveParam(blend.srcAlpha, recipe),
    dstAlphaValue: resolveParam(blend.dstAlpha, recipe),
    equationRGBValue: resolveParam(blend.op, recipe),
    equationAlphaValue: resolveParam(blend.opAlpha, recipe),
    colorMaskValue: resolveParam(blend.colMask, recipe),
  };
  for (const [field, value] of Object.entries(resolved)) {
    if (value == null) fail(`official ${recipe.shader} blend field ${field} is unresolved`);
  }
  return {
    enabled: true,
    srcRGB: enumSymbol(UNITY_BLEND_TO_WEBGL, resolved.srcRGBValue, "blend factor"),
    dstRGB: enumSymbol(UNITY_BLEND_TO_WEBGL, resolved.dstRGBValue, "blend factor"),
    srcAlpha: enumSymbol(UNITY_BLEND_TO_WEBGL, resolved.srcAlphaValue, "blend factor"),
    dstAlpha: enumSymbol(UNITY_BLEND_TO_WEBGL, resolved.dstAlphaValue, "blend factor"),
    equationRGB: enumSymbol(UNITY_BLEND_OP_TO_WEBGL, resolved.equationRGBValue, "blend op"),
    equationAlpha: enumSymbol(UNITY_BLEND_OP_TO_WEBGL, resolved.equationAlphaValue, "blend op"),
    colorMask: [1, 2, 4, 8].map((bit) => !!(resolved.colorMaskValue & bit)),
    unity: resolved,
  };
}

function resolveDepth(pass, recipe) {
  const test = resolveParam(pass.zTest, recipe);
  const write = resolveParam(pass.zWrite, recipe);
  return {
    enabled: test !== 0,
    func: test === 0 ? null : enumSymbol(UNITY_COMPARE_TO_WEBGL, test, "depth compare"),
    writeMask: write !== 0,
    unity: { test, write },
  };
}

function resolveCull(pass, recipe) {
  const value = resolveParam(pass.culling, recipe);
  if (![0, 1, 2].includes(value)) fail(`unsupported official cull enum ${value}`);
  return {
    enabled: value !== 0,
    mode: value === 1 ? "FRONT" : value === 2 ? "BACK" : null,
    frontFace: "CCW",
    unity: value,
  };
}

function resolveStencil(pass, recipe, runtimeMaterial) {
  if (!runtimeMaterial.stencilWrite) {
    return { enabled: false, unity: null };
  }
  const stencil = pass.stencilOp;
  const resolved = {
    ref: resolveParam(pass.stencilRef, recipe),
    readMask: resolveParam(pass.stencilReadMask, recipe),
    writeMask: resolveParam(pass.stencilWriteMask, recipe),
    func: resolveParam(stencil?.comp, recipe),
    depthPass: resolveParam(stencil?.pass, recipe),
    fail: resolveParam(stencil?.fail, recipe),
    depthFail: resolveParam(stencil?.zFail, recipe),
  };
  for (const [field, value] of Object.entries(resolved)) {
    if (value == null) fail(`official ${recipe.shader} stencil field ${field} is unresolved`);
  }
  return {
    enabled: true,
    ref: resolved.ref,
    readMask: resolved.readMask,
    writeMask: resolved.writeMask,
    func: enumSymbol(UNITY_COMPARE_TO_WEBGL, resolved.func, "stencil compare"),
    depthPass: enumSymbol(UNITY_STENCIL_OP_TO_WEBGL, resolved.depthPass, "stencil op"),
    fail: enumSymbol(UNITY_STENCIL_OP_TO_WEBGL, resolved.fail, "stencil op"),
    depthFail: enumSymbol(UNITY_STENCIL_OP_TO_WEBGL, resolved.depthFail, "stencil op"),
    unity: resolved,
  };
}

function runtimeProbe(record) {
  const material = new THREE.RawShaderMaterial();
  const { config, recipe } = record;
  setBlend(material, config.blend, false, config.materialBlend ? recipe.floats : undefined);
  if (!applyRenderQueueState(material, recipe.queue)) fail(`${record.source.material}: invalid queue ${recipe.queue}`);
  applyDepthState(material, recipe.floats);
  applyCullState(material, recipe.floats, config.cull ?? 2, !!config.materialCull);
  applyStencilState(material, recipe);
  const state = {
    transparent: material.transparent,
    side: material.side,
    forceSinglePass: material.forceSinglePass,
    stencilWrite: material.stencilWrite,
  };
  material.dispose();
  return state;
}

function buildRecord(official, scene, material, recipe) {
  const config = SHADER[recipe.shader];
  const selected = selectOfficialPass(official, recipe.shader, recipe);
  const record = {
    source: { scene, material, shader: recipe.shader, officialVariant: selected.key },
    config: {
      blend: config.blend,
      kind: config.kind,
      materialBlend: !!config.materialBlend,
      cull: config.cull ?? 2,
      materialCull: !!config.materialCull,
    },
    recipe: {
      shader: recipe.shader,
      queue: recipe.queue,
      floats: recipe.floats || {},
    },
    pass: selected.pass,
  };
  record.runtime = runtimeProbe(record);
  record.expected = {
    queueTransparent: record.runtime.transparent,
    drawBuffers: ["COLOR_ATTACHMENT0", "COLOR_ATTACHMENT1"],
    blend: resolveBlend(record.pass, record.recipe, 0),
    depth: resolveDepth(record.pass, record.recipe),
    cull: resolveCull(record.pass, record.recipe),
    stencil: resolveStencil(record.pass, record.recipe, record.runtime),
  };
  const rt1 = resolveBlend(record.pass, record.recipe, 1);
  for (const field of ["srcRGB", "dstRGB", "srcAlpha", "dstAlpha", "equationRGB", "equationAlpha", "colorMask"]) {
    if (JSON.stringify(rt1[field]) !== JSON.stringify(record.expected.blend[field])) {
      fail(`${recipe.shader} does not have the official shared MRT blend state at RT1 (${field})`);
    }
  }
  return record;
}

function readSceneRecords(official) {
  const publicRoot = path.join(ROOT, "public");
  const scenes = fs.readdirSync(publicRoot)
    .filter((name) => /^scene\..*\.json$/.test(name))
    .sort();
  const records = [];
  for (const scene of scenes) {
    const data = JSON.parse(fs.readFileSync(path.join(publicRoot, scene), "utf8"));
    for (const [material, recipe] of Object.entries(data.materials || {}).sort(([a], [b]) => a.localeCompare(b))) {
      const config = SHADER[recipe.shader];
      if (!config || config.defer) continue;
      records.push(buildRecord(official, scene, material, recipe));
    }
  }
  return records;
}

function selectOne(records, label, predicate) {
  const selected = records.find(predicate);
  if (!selected) fail(`could not select representative official ${label} draw`);
  return selected;
}

function publicCase(id, record) {
  return {
    id,
    source: record.source,
    config: record.config,
    recipe: record.recipe,
    expected: record.expected,
  };
}

function matchingRegion(stencil) {
  const region = Object.values(REGION).find(
    (value) => (value & stencil.readMask) === (stencil.ref & stencil.readMask),
  );
  if (region == null) fail(`no context REGION satisfies stencil ${stencil.ref}/${stencil.readMask}`);
  return region;
}

function failingStencilValue(stencil) {
  for (let value = 0; value <= 0xff; value += 1) {
    if ((value & stencil.readMask) !== (stencil.ref & stencil.readMask)) return value;
  }
  fail(`could not derive a failing stencil value for mask ${stencil.readMask}`);
}

function preservationBit(writeMask) {
  for (let bit = 0x80; bit >= 1; bit >>= 1) {
    if (!(writeMask & bit)) return bit;
  }
  fail(`stencil write mask ${writeMask} leaves no preservation bit`);
}

export function buildOfficialDrawStateInput() {
  runExistingOfficialAudit();
  const official = extractOfficialStates();
  const records = readSceneRecords(official);

  const opaque = selectOne(records, "opaque", (record) => (
    !record.runtime.transparent
    && record.config.blend === "opaque"
    && record.expected.blend.srcRGB === "ONE"
    && record.expected.blend.dstRGB === "ZERO"
    && record.expected.depth.enabled
    && record.expected.depth.writeMask
    && record.expected.cull.enabled
    && !record.expected.stencil.enabled
  ));
  const transparent = selectOne(records, "transparent", (record) => (
    record.runtime.transparent
    && record.config.blend === "over"
    && record.expected.blend.srcRGB === "SRC_ALPHA"
    && record.expected.blend.dstRGB === "ONE_MINUS_SRC_ALPHA"
    && !record.expected.depth.enabled
    && !record.expected.stencil.enabled
  ));
  const cullOff = selectOne(records, "CullOff", (record) => (
    record.runtime.transparent
    && record.config.materialCull
    && !record.expected.cull.enabled
    && record.runtime.side === THREE.DoubleSide
    && record.runtime.forceSinglePass
    && record.expected.stencil.enabled
  ));
  const stencil = selectOne(records, "stencil", (record) => (
    record.expected.stencil.enabled
    && record.expected.stencil.func === "EQUAL"
    && record.expected.stencil.depthPass === "REPLACE"
    && record.expected.stencil.writeMask !== 0xff
  ));

  const cullCase = publicCase("cullOff", cullOff);
  cullCase.setup = { stencilRef: matchingRegion(cullOff.expected.stencil) };

  const stencilCase = publicCase("stencil", stencil);
  const preserveBit = preservationBit(stencil.expected.stencil.writeMask);
  stencilCase.setup = {
    passValue: matchingRegion(stencil.expected.stencil) | preserveBit,
    failValue: failingStencilValue(stencil.expected.stencil),
    preserveBit,
  };

  return {
    schemaVersion: 1,
    provenance: {
      scenes: [...new Set([opaque, transparent, cullOff, stencil].map((record) => record.source.scene))],
      rarityTable: "public/render/rarities.js",
      runtimeMapping: "public/render/context.js",
      officialAudit: "build/audit-render-state.mjs",
      officialExtractor: "build/extract-shader-defaults.py",
      officialShaderRoot: SHADER_ROOT,
      note: "Probe colors and dimensions are sentinels only; every tested draw-state value comes from the selected scene recipe and official pass extraction.",
    },
    cases: {
      opaque: publicCase("opaque", opaque),
      transparent: publicCase("transparent", transparent),
      cullOff: cullCase,
      stencil: stencilCase,
      mrtSharedBlend: publicCase("mrtSharedBlend", transparent),
    },
  };
}

async function main() {
  const input = buildOfficialDrawStateInput();
  const { printDrawStateRuntimeResult, runDrawStateRuntime } = await import("./test-draw-state-runtime.mjs");
  const result = await runDrawStateRuntime(input);
  printDrawStateRuntimeResult(result);
  console.log("Proves:");
  for (const claim of result.scope.proves) console.log(`  - ${claim}`);
  console.log("Does not prove:");
  for (const claim of result.scope.doesNotProve) console.log(`  - ${claim}`);
  if (result.failures.length) process.exitCode = 1;
}

if (IS_MAIN) {
  main().catch((error) => {
    console.error(`BAD official draw-state audit: ${error.message}`);
    process.exitCode = 1;
  });
}
