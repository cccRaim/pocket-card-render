import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { IMPORT_SCHEMA, STATUS as IMPORT_STATUS } from "./import-official-vulkan-runtime-capture.mjs";
import { FULL_RUNTIME_SCHEMA_VERSION } from "./full-runtime-sources.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const VK_BLEND_FACTOR = [
  "ZERO", "ONE", "SRC_COLOR", "ONE_MINUS_SRC_COLOR", "DST_COLOR", "ONE_MINUS_DST_COLOR",
  "SRC_ALPHA", "ONE_MINUS_SRC_ALPHA", "DST_ALPHA", "ONE_MINUS_DST_ALPHA", "CONSTANT_COLOR",
  "ONE_MINUS_CONSTANT_COLOR", "CONSTANT_ALPHA", "ONE_MINUS_CONSTANT_ALPHA", "SRC_ALPHA_SATURATE",
  "SRC1_COLOR", "ONE_MINUS_SRC1_COLOR", "SRC1_ALPHA", "ONE_MINUS_SRC1_ALPHA",
];
const VK_BLEND_OP = ["FUNC_ADD", "FUNC_SUBTRACT", "FUNC_REVERSE_SUBTRACT", "MIN", "MAX"];
const VK_COMPARE = ["NEVER", "LESS", "EQUAL", "LEQUAL", "GREATER", "NOTEQUAL", "GEQUAL", "ALWAYS"];
const VK_CULL = ["NONE", "FRONT", "BACK", "FRONT_AND_BACK"];
const VK_FRONT_FACE = ["CCW", "CW"];

function normalizeShader(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function colorMask(mask) {
  return [1, 2, 4, 8].map((bit) => Boolean(Number(mask) & bit));
}

function fullRect(rect, area) {
  if (!rect || !area) return false;
  return Number(rect.x) === Number(area.x)
    && Number(rect.y) === Number(area.y)
    && Math.abs(Number(rect.width)) === Number(area.width)
    && Math.abs(Number(rect.height)) === Number(area.height);
}

function localFullRect(rect) {
  return Array.isArray(rect) && rect.length === 4
    && rect[0] === 0 && rect[1] === 0 && rect[2] > 0 && rect[3] > 0;
}

export function canonicalOfficialDraw(row, scope) {
  const state = row.runtime?.pipelineState || {};
  const blend = state.blendAttachments?.[0] || {};
  return {
    shader: row.candidates.length === 1 ? row.candidates[0].shader : null,
    geometry: {
      indexed: row.runtime?.event === "cmd-draw-indexed",
      count: row.runtime?.indexCount ?? row.runtime?.vertexCount ?? null,
      instanceCount: row.runtime?.instanceCount ?? null,
    },
    raster: {
      cullEnabled: Number(state.cullMode) !== 0,
      cullFace: VK_CULL[state.cullMode] || null,
      frontFace: VK_FRONT_FACE[state.frontFace] || null,
    },
    depth: {
      test: Boolean(state.depthTest),
      write: Boolean(state.depthWrite),
      func: VK_COMPARE[state.depthCompareOp] || null,
    },
    blend: {
      enabled: Boolean(blend.enable),
      srcRgb: VK_BLEND_FACTOR[blend.srcColor] || null,
      dstRgb: VK_BLEND_FACTOR[blend.dstColor] || null,
      srcAlpha: VK_BLEND_FACTOR[blend.srcAlpha] || null,
      dstAlpha: VK_BLEND_FACTOR[blend.dstAlpha] || null,
      equationRgb: VK_BLEND_OP[blend.colorOp] || null,
      equationAlpha: VK_BLEND_OP[blend.alphaOp] || null,
      colorMask: colorMask(blend.writeMask),
    },
    viewportFull: fullRect(row.runtime?.viewport, scope.area),
    scissorFull: fullRect(row.runtime?.scissor, scope.area),
    colorAttachments: state.blendAttachments?.length ?? 0,
  };
}

export function canonicalLocalDraw(draw) {
  return {
    shader: draw.identity?.shader || draw.material?.exactShader || null,
    geometry: {
      indexed: Boolean(draw.geometry?.indexed),
      count: draw.geometry?.count ?? null,
      instanceCount: draw.geometry?.instanceCount ?? null,
    },
    raster: draw.pipeline?.raster || null,
    depth: draw.pipeline?.depth || null,
    blend: draw.pipeline?.blend || null,
    viewportFull: localFullRect(draw.pipeline?.viewport),
    scissorFull: !draw.pipeline?.scissorEnabled || localFullRect(draw.pipeline?.scissor),
    colorAttachments: (draw.pipeline?.drawBuffers || []).filter((entry) => entry && entry !== "NONE" && entry !== "0x0").length,
  };
}

function fieldDiff(expected, actual, pathPrefix = "") {
  const rows = [];
  if (expected && typeof expected === "object" && !Array.isArray(expected)) {
    for (const key of Object.keys(expected).sort()) {
      rows.push(...fieldDiff(expected[key], actual?.[key], pathPrefix ? `${pathPrefix}.${key}` : key));
    }
    return rows;
  }
  const exact = JSON.stringify(expected) === JSON.stringify(actual);
  rows.push({ field: pathPrefix, status: exact ? "exact" : "mismatch", official: expected, local: actual });
  return rows;
}

function candidateNames(row) {
  return [...new Set((row.candidates || []).map((candidate) => candidate.materialName))];
}

function solveLocalAssignments(officialRows, localDraws) {
  const relevantNames = new Set(officialRows.flatMap(candidateNames));
  const relevantLocal = localDraws.filter((draw) => relevantNames.has(draw.identity?.materialName));
  const candidates = officialRows.map((row) => relevantLocal
    .map((draw, index) => ({ draw, index }))
    .filter(({ draw }) => candidateNames(row).includes(draw.identity?.materialName)
      && (row.runtime?.indexCount ?? row.runtime?.vertexCount) === draw.geometry?.count));
  const solutions = [];
  const used = new Set();
  const current = [];
  function visit(index) {
    if (solutions.length >= 4096) return;
    if (index === officialRows.length) {
      solutions.push([...current]);
      return;
    }
    for (const candidate of candidates[index]) {
      if (used.has(candidate.index)) continue;
      used.add(candidate.index);
      current.push(candidate.index);
      visit(index + 1);
      current.pop();
      used.delete(candidate.index);
    }
  }
  if (relevantLocal.length === officialRows.length) visit(0);
  return { relevantLocal, candidates, solutions };
}

export function diffOfficialAndLocal({ officialImport, localArtifact, scene }) {
  assert.equal(officialImport?.schema, IMPORT_SCHEMA, "unsupported official Vulkan import schema");
  assert.equal(localArtifact?.schemaVersion, FULL_RUNTIME_SCHEMA_VERSION, "unsupported local runtime evidence schema");
  const sceneFile = scene || path.basename(officialImport.source?.scene || "");
  const capture = localArtifact.captures?.[`${sceneFile}|zh_TW`];
  assert(capture, `local runtime capture is absent for ${sceneFile}|zh_TW`);
  assert.equal(capture.diagnostics?.scene?.sha256, officialImport.source?.sceneSha256, "official/local scene hash mismatch");
  const scope = officialImport.scopes?.find((entry) => entry.ordinal === officialImport.bestScopeOrdinal);
  assert(scope, "official import has no matched card scope");
  const assignment = solveLocalAssignments(scope.draws, capture.localDraws || []);
  const unique = assignment.solutions.length === 1;
  const draws = scope.draws.map((row, ordinal) => {
    const localIndices = unique
      ? [assignment.solutions[0][ordinal]]
      : [...new Set(assignment.solutions.map((solution) => solution[ordinal]))];
    const localCandidates = localIndices.map((index) => assignment.relevantLocal[index]).filter(Boolean);
    if (row.status === IMPORT_STATUS.MISMATCH || localCandidates.length === 0) {
      return { ordinal, status: "mismatch", candidates: candidateNames(row), localCandidates: [], fields: [] };
    }
    if (row.status !== IMPORT_STATUS.EXACT || localCandidates.length !== 1) {
      return {
        ordinal,
        status: "unresolved",
        candidates: candidateNames(row),
        localCandidates: localCandidates.map((draw) => draw.identity?.materialName),
        fields: [],
      };
    }
    const official = canonicalOfficialDraw(row, scope);
    const local = canonicalLocalDraw(localCandidates[0]);
    const fields = fieldDiff(official, local).map((entry) => (
      entry.field === "shader" && normalizeShader(entry.official) === normalizeShader(entry.local)
        ? { ...entry, status: "exact" }
        : entry
    ));
    return {
      ordinal,
      status: fields.every((field) => field.status === "exact") ? "exact" : "mismatch",
      candidates: candidateNames(row),
      localCandidates: [localCandidates[0].identity?.materialName],
      fields,
    };
  });
  const counts = Object.fromEntries(["exact", "unresolved", "mismatch"].map((status) => [
    status,
    draws.filter((draw) => draw.status === status).length,
  ]));
  return {
    schemaVersion: 1,
    kind: "official-vulkan-to-local-webgl-field-diff",
    scene: sceneFile,
    officialStatus: officialImport.status,
    assignmentSolutions: assignment.solutions.length,
    status: counts.mismatch ? "mismatch" : counts.unresolved ? "unresolved" : "exact-comparable-fields",
    counts,
    draws,
    notComparable: [
      "descriptor resource identity: capture layer currently records opaque Vulkan handles only",
      "uniform payload bytes: capture layer currently records buffer ranges and dynamic offsets, not mapped buffer contents",
      "target GPU numeric output: requires a controlled target-device probe",
    ],
  };
}

function fixture() {
  const localDraw = {
    ordinal: 0,
    identity: { materialName: "Material", shader: "Frame-Holo-UR-New" },
    geometry: { indexed: true, count: 6, instanceCount: 1 },
    pipeline: {
      viewport: [0, 0, 256, 455], scissor: [0, 0, 256, 455], scissorEnabled: true,
      drawBuffers: ["0x8ce0", "0x8ce1"],
      raster: { cullEnabled: true, cullFace: "BACK", frontFace: "CCW" },
      depth: { test: true, write: false, func: "LEQUAL" },
      blend: {
        enabled: true, srcRgb: "SRC_ALPHA", dstRgb: "ONE_MINUS_SRC_ALPHA",
        srcAlpha: "ONE", dstAlpha: "ONE_MINUS_SRC_ALPHA",
        equationRgb: "FUNC_ADD", equationAlpha: "FUNC_ADD", colorMask: [true, true, true, true],
      },
    },
  };
  const officialRow = {
    status: IMPORT_STATUS.EXACT,
    candidates: [{ materialName: "Material", shader: "Frame-Holo-UR-New" }],
    runtime: {
      event: "cmd-draw-indexed", indexCount: 6, instanceCount: 1,
      viewport: { x: 0, y: 0, width: 256, height: 455 },
      scissor: { x: 0, y: 0, width: 256, height: 455 },
      pipelineState: {
        cullMode: 2, frontFace: 0, depthTest: 1, depthWrite: 0, depthCompareOp: 3,
        blendAttachments: [{
          enable: 1, srcColor: 6, dstColor: 7, colorOp: 0,
          srcAlpha: 1, dstAlpha: 7, alphaOp: 0, writeMask: 15,
        }, {}],
      },
    },
  };
  const sceneSha256 = "a".repeat(64);
  return {
    officialImport: {
      schema: IMPORT_SCHEMA, status: IMPORT_STATUS.EXACT,
      source: { scene: "public/scene.fixture.json", sceneSha256 }, bestScopeOrdinal: 0,
      scopes: [{ ordinal: 0, area: { x: 0, y: 0, width: 256, height: 455 }, draws: [officialRow] }],
    },
    localArtifact: {
      schemaVersion: FULL_RUNTIME_SCHEMA_VERSION,
      captures: { "scene.fixture.json|zh_TW": { diagnostics: { scene: { sha256: sceneSha256 } }, localDraws: [localDraw] } },
    },
  };
}

function selfTest() {
  const input = fixture();
  const exact = diffOfficialAndLocal(input);
  assert.equal(exact.status, "exact-comparable-fields");
  assert.deepEqual(exact.counts, { exact: 1, unresolved: 0, mismatch: 0 });
  input.localArtifact.captures["scene.fixture.json|zh_TW"].localDraws[0].pipeline.depth.write = true;
  const mismatch = diffOfficialAndLocal(input);
  assert.equal(mismatch.status, "mismatch");
  assert(mismatch.draws[0].fields.some((field) => field.field === "depth.write" && field.status === "mismatch"));
  console.log("Official Vulkan -> local WebGL field diff self-test OK");
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(path.resolve(file), "utf8").replace(/^\uFEFF/, ""));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.includes("--self-test") || process.env.PCR_FIELD_DIFF_SELF_TEST === "1") selfTest();
  else if (args.length >= 2) {
    const report = diffOfficialAndLocal({ officialImport: readJson(args[0]), localArtifact: readJson(args[1]), scene: args[2] });
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (report.status === "mismatch") process.exitCode = 1;
  } else {
    console.log("official/local field diff: runtime-required (pass <official-import.json> <full-runtime-evidence.json> [scene])");
  }
}
