import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  OFFICIAL_TMP_AUTOSIZE_CONSTANTS,
  resolveOfficialTmpAutoSize,
  roundOfficialTmpPointSize,
} from "../public/render/tmp-autosize.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONTRACT = path.join(ROOT, "public", "render", "tmp-autosize-contract.json");

function widthEvaluation(naturalWidthPerPoint) {
  return ({ fontSize, charWidthAdjustment }) => ({
    width: naturalWidthPerPoint * fontSize * (1 - charWidthAdjustment),
    height: fontSize,
    lineCount: 1,
    baseScale: 1,
  });
}

export function auditOfficialTmpAutoSize() {
  const contract = JSON.parse(fs.readFileSync(CONTRACT, "utf8"));
  assert.equal(contract.schemaVersion, 1);
  assert.equal(contract.source.textMeshProVersion, "3.0.6");
  assert.equal(contract.source.packageSha256, "640c3c9ea8d7e5431bfefaccc70d85ea7aed204686d16a596d412286d2b9ba0b");
  assert.equal(contract.source.uguiGenerator.sha256, "1f8ba223bdd284bd0dfff1aefcf5988c872c9f6dd616673a8d4d58a9b2bf816a");
  assert.equal(contract.source.nativeGenerateTextMesh.sha256, "63e11353317c008927215ccb1d6d7977a18ee8b4d3d2728ace5b5d9cf65240b8");
  assert.deepEqual(contract.cardUiCensus, {
    contractSha256: contract.cardUiCensus.contractSha256,
    tmpComponentCount: 68,
    autosize: { 0: 33, 1: 35 },
    wordWrap: { 0: 45, 1: 23 },
    overflowMode: { 0: 68 },
    lineSpacingMax: { 0: 68 },
    charWidthMaxAdj: { 0: 1, 50: 67 },
    autosizeAndWordWrapCount: 1,
    reachableOverflowModes: [0],
  });
  assert.deepEqual(OFFICIAL_TMP_AUTOSIZE_CONSTANTS, {
    widthEpsilon: contract.constants.widthEpsilon,
    fontSizeEpsilon: contract.constants.fontSizeEpsilon,
    minimumFontSizeStep: contract.constants.minimumFontSizeStep,
    fontSizeRounding: contract.constants.fontSizeRoundingMultiplier,
    maxIterations: contract.constants.maxIterations,
  });

  assert.equal(roundOfficialTmpPointSize(12.524), 12.5);
  assert.equal(roundOfficialTmpPointSize(12.526), 12.550000190734863);

  const widthOnly = resolveOfficialTmpAutoSize({
    fontSizeBase: 10, fontSizeMin: 1, fontSizeMax: 10,
    charWidthMaxAdj: 50, overflowMode: 0, maxWidth: 80,
  }, widthEvaluation(10));
  assert.equal(widthOnly.termination, "fit");
  assert.equal(widthOnly.fontSize, 10);
  assert(widthOnly.charWidthAdjustment > 0.2 && widthOnly.charWidthAdjustment < 0.201);
  assert.deepEqual(widthOnly.trace.map((entry) => entry.action), ["reduce-character-width", "fit"]);

  const widthAndFont = resolveOfficialTmpAutoSize({
    fontSizeBase: 10, fontSizeMin: 1, fontSizeMax: 10,
    charWidthMaxAdj: 50, overflowMode: 0, maxWidth: 40,
  }, widthEvaluation(10));
  assert.equal(widthAndFont.termination, "fit");
  assert(widthAndFont.evaluation.width <= 40);
  assert(widthAndFont.trace.some((entry) => entry.action === "reduce-font-horizontal"));
  assert(widthAndFont.trace.some((entry) => entry.action === "increase-font"));

  const lineSpacing = resolveOfficialTmpAutoSize({
    fontSizeBase: 10, fontSizeMin: 1, fontSizeMax: 10,
    charWidthMaxAdj: 50, lineSpacingMax: -20, overflowMode: 0,
    maxWidth: 1000, maxHeight: 80,
  }, ({ lineSpacingDelta }) => ({
    width: 10,
    height: 100 + lineSpacingDelta * 2,
    lineCount: 3,
    baseScale: 1,
  }));
  assert.equal(lineSpacing.lineSpacingDelta, -10);
  assert.deepEqual(lineSpacing.trace.map((entry) => entry.action), ["reduce-line-spacing", "fit"]);

  const officialZeroLineSpacing = resolveOfficialTmpAutoSize({
    fontSizeBase: 10, fontSizeMin: 5, fontSizeMax: 10,
    charWidthMaxAdj: 50, lineSpacingMax: 0, overflowMode: 0,
    maxWidth: 1000, maxHeight: 60,
  }, ({ fontSize, lineSpacingDelta }) => ({
    width: 10,
    height: fontSize * 10 + lineSpacingDelta * 2,
    lineCount: 3,
    baseScale: 1,
  }));
  assert.equal(officialZeroLineSpacing.lineSpacingDelta, 0);
  assert.equal(officialZeroLineSpacing.trace[0].action, "reduce-font-vertical");

  const acceptedOverflow = resolveOfficialTmpAutoSize({
    fontSizeBase: 5, fontSizeMin: 5, fontSizeMax: 5,
    charWidthMaxAdj: 0, overflowMode: 0, maxWidth: 10,
  }, widthEvaluation(10));
  assert.equal(acceptedOverflow.termination, "overflow");
  assert.equal(acceptedOverflow.trace.at(-1).action, "accept-overflow-horizontal");

  assert.throws(() => resolveOfficialTmpAutoSize({
    fontSizeBase: 10, fontSizeMin: 1, fontSizeMax: 10,
    overflowMode: 1, maxWidth: 10,
  }, widthEvaluation(10)), /official card prefabs use Overflow/);

  const appSource = fs.readFileSync(path.join(ROOT, "public", "app.js"), "utf8");
  const composeSource = fs.readFileSync(path.join(ROOT, "build", "compose.mjs"), "utf8");
  assert(appSource.includes('from "./render/tmp-autosize.js"'));
  assert(appSource.match(/resolveOfficialTmpAutoSize\(/g)?.length >= 3);
  for (const field of ["fsbase", "fsmin", "fsmax", "charWidthMaxAdj", "lineSpacingMax", "overflowMode"]) {
    assert(composeSource.includes(field), `compose does not carry ${field}`);
  }

  return {
    status: "pass",
    tmpComponents: contract.cardUiCensus.tmpComponentCount,
    autosizeComponents: contract.cardUiCensus.autosize[1],
    reachableOverflowModes: contract.cardUiCensus.reachableOverflowModes,
    sourceRanges: Object.keys(contract.source.uguiGenerator.ranges).length,
    executableCases: 7,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = auditOfficialTmpAutoSize();
  console.log("Official TMP autosize/overflow audit OK");
  console.log(`  TMP=${report.tmpComponents} autosize=${report.autosizeComponents} overflow=${report.reachableOverflowModes.join(",")}`);
  console.log(`  source-ranges=${report.sourceRanges} executable-cases=${report.executableCases}`);
}
