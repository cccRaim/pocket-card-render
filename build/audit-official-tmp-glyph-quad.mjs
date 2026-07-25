import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  buildOfficialTmpGlyphQuad,
  officialTmpGlyphInkRight,
  resolveOfficialTmpItalic,
} from "../public/render/tmp-glyph-mesh.js";
import { CANONICAL_LOCALIZED_TEXT_FILES } from "./full-runtime-sources.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function close(actual, expected, label) {
  assert(Math.abs(actual - expected) < 1e-9, `${label}: ${actual} != ${expected}`);
}

function officialSourceEvidence() {
  return JSON.parse(execFileSync(
    process.env.PYTHON || "python",
    ["-B", "build/extract_official_tmp_mesh.py"],
    {
      cwd: ROOT,
      encoding: "utf8",
      shell: process.platform === "win32",
      maxBuffer: 16 * 1024 * 1024,
    },
  ).replace(/^\uFEFF/, ""));
}

export function auditOfficialTmpGlyphQuad() {
  const evidence = officialSourceEvidence();
  assert.equal(evidence.schemaVersion, 2);
  assert.equal(evidence.textMeshProSource.sha256, "1f8ba223bdd284bd0dfff1aefcf5988c872c9f6dd616673a8d4d58a9b2bf816a");
  assert.equal(evidence.textMeshProSource.nativeGenerateTextMesh.sha256, "63e11353317c008927215ccb1d6d7977a18ee8b4d3d2728ace5b5d9cf65240b8");
  assert.deepEqual(evidence.reachableCardUi.fontStyle, { 0: 59, 2: 9 });
  assert.deepEqual(evidence.reachableCardUi.orthographic, { 1: 68 });
  assert.deepEqual(evidence.reachableCardUi.rightToLeft, { 0: 68 });
  assert.deepEqual(evidence.reachableCardUi.extraPadding, { 0: 68 });

  const entry = {
    x: 100,
    y: 50,
    width: 8,
    height: 15,
    scale: 0.5,
    widthScale: 0.8,
    glyph: { metrics: { width: 20, height: 30, horizontalBearingY: 24 } },
    font: { italicStyle: 35 },
  };
  const normal = buildOfficialTmpGlyphQuad(entry, 4);
  close(normal.topLeft.x, 98.4, "normal top-left x");
  close(normal.topLeft.y, 48, "normal top-left y");
  close(normal.bottomLeft.y, 67, "normal bottom-left y");
  close(normal.topRight.x, 109.6, "normal top-right x");
  close(normal.bottomRight.x, 109.6, "normal bottom-right x");

  const italic = buildOfficialTmpGlyphQuad({ ...entry, italic: true }, 4);
  close(italic.topShift, 1.575, "italic top shear");
  close(italic.bottomShift, -5.075, "italic bottom shear");
  close(officialTmpGlyphInkRight({ ...entry, italic: true }), 109.575, "italic ink right");
  assert.equal(resolveOfficialTmpItalic(0, false), false);
  assert.equal(resolveOfficialTmpItalic(2, false), true);
  assert.equal(resolveOfficialTmpItalic(0, true), true);

  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "public", "game", "tmp-fonts", "manifest.json"), "utf8"));
  let glyphs = 0;
  let variants = 0;
  for (const font of Object.values(manifest.fonts)) {
    for (const glyph of [...(font.glyphs || []), ...(font.runtimeGlyphs || [])]) {
      const metrics = glyph.metrics;
      if (!metrics || !Number(metrics.width) || !Number(metrics.height)) continue;
      const scale = 23 / Number(font.face.pointSize) * Number(font.face.scale || 1);
      for (const widthScale of [1, 0.5]) {
        for (const italicState of [false, true]) {
          const candidate = {
            x: 17,
            y: 29,
            width: Number(metrics.width) * scale * widthScale,
            height: Number(metrics.height) * scale,
            scale,
            widthScale,
            italic: italicState,
            font,
            glyph: { metrics },
          };
          const quad = buildOfficialTmpGlyphQuad(candidate, 3.25);
          assert(quad.positions.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y)));
          close(quad.topRight.y, quad.topLeft.y, "quad top edge");
          close(quad.bottomRight.y, quad.bottomLeft.y, "quad bottom edge");
          variants += 1;
        }
      }
      glyphs += 1;
    }
  }
  assert(glyphs > 1600);

  let textFiles = 0;
  let componentItalicElements = 0;
  for (const filename of CANONICAL_LOCALIZED_TEXT_FILES) {
    const data = JSON.parse(fs.readFileSync(path.join(ROOT, "public", "text", filename), "utf8"));
    textFiles += 1;
    for (const element of data.elements || []) {
      if (element.kind === "text" && resolveOfficialTmpItalic(element.fontStyle, false)) componentItalicElements += 1;
    }
  }
  assert.equal(textFiles, CANONICAL_LOCALIZED_TEXT_FILES.length);
  assert(componentItalicElements > 0);

  const appSource = fs.readFileSync(path.join(ROOT, "public", "app.js"), "utf8");
  const rendererSource = fs.readFileSync(path.join(ROOT, "public", "render", "tmp-sdf-renderer.js"), "utf8");
  assert(appSource.includes("resolveOfficialTmpItalic(e.fontStyle, run.italic)"));
  assert(rendererSource.includes("buildOfficialTmpGlyphQuad(entry, padding"));

  return {
    status: "pass",
    tmpComponents: evidence.reachableCardUi.tmpComponentCount,
    componentItalicElements,
    glyphs,
    variants,
    sourceRanges: Object.keys(evidence.textMeshProSource.ranges).length,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = auditOfficialTmpGlyphQuad();
  console.log("Official TMP glyph quad audit OK");
  console.log(`  TMP=${report.tmpComponents} italic-elements=${report.componentItalicElements}`);
  console.log(`  glyphs=${report.glyphs} geometry-variants=${report.variants} source-ranges=${report.sourceRanges}`);
}
