import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  indexOfficialTmpFonts,
  measureOfficialTmpText,
  resolveOfficialTmpTextElement,
} from "../public/render/tmp-font-data.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SETTINGS = path.join(ROOT, "public", "render", "tmp-settings-contract.json");
const MANIFEST = path.join(ROOT, "public", "game", "tmp-fonts", "manifest.json");
const BLACK_TC = "8286394459813532775";
const FUTURA_HEAVY = "-757749988448016049";

export function auditOfficialTmpFallback() {
  const settings = JSON.parse(fs.readFileSync(SETTINGS, "utf8"));
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
  assert.equal(settings.schemaVersion, 2);
  assert.equal(settings.settings.rawSha256, "61213932599fe55e49d0d3ea1010c17df74eb7027edb7a8d7501b0c824bad8de");
  assert.deepEqual(settings.settings.fallbackFontAssetPPtrs, []);
  assert.deepEqual(settings.settings.defaultFontAssetPPtr, { fileId: 0, pathId: 0 });
  assert.deepEqual(settings.settings.defaultSpriteAssetPPtr, { fileId: 0, pathId: 0 });
  assert.equal(settings.settings.missingGlyphCharacter, 0);
  assert.equal(settings.settings.warningsDisabled, true);
  assert.deepEqual({
    getTextElement: settings.native.getTextElement.sha256,
    generateTextMesh: settings.native.generateTextMesh.sha256,
    recursiveSearch: settings.source.textMeshProPackage.fontAssetUtilities.ranges.singleFontRecursiveSearch.sha256,
    missingGlyphResolution: settings.source.textMeshProPackage.uguiGenerator.ranges.missingGlyphResolution.sha256,
  }, {
    getTextElement: "979ea9dc300aca750014140698048e5c9f3405d578e291bcdd66e41ea1c2470d",
    generateTextMesh: "63e11353317c008927215ccb1d6d7977a18ee8b4d3d2728ace5b5d9cf65240b8",
    recursiveSearch: "4aaa65ed897dfd3a4f9ba753f382ca1bddae97aa7ba979e2748f913cc25ced52",
    missingGlyphResolution: "4bd4b22df978c0354cc7512c56a3e8242fe5701f53a500e7af30707f27772f9e",
  });

  const index = indexOfficialTmpFonts(manifest, settings);
  const square = resolveOfficialTmpTextElement(index, BLACK_TC, 0x10FFFF);
  assert(square);
  assert.equal(square.renderedCodePoint, 0x25A1);
  assert.equal(square.fallbackStage, "missing-square");
  assert.equal(square.glyph.source, "native-generated");
  assert(square.atlas?.alphaUrl.endsWith(".alpha.bin"));

  const space = resolveOfficialTmpTextElement(index, FUTURA_HEAVY, 0x10FFFF);
  assert(space);
  assert.equal(space.renderedCodePoint, 0x20);
  assert.equal(space.fallbackStage, "missing-space");

  const plain = measureOfficialTmpText(index, FUTURA_HEAVY, "12", 46);
  const spaced = measureOfficialTmpText(index, FUTURA_HEAVY, "12", 46, { wordSpacing: 100 });
  assert.equal(spaced, plain, "glyph metadata was coerced into whitespace");

  return {
    status: "pass",
    settingsPathId: settings.settings.pathId,
    globalFallbackCount: index.settings.fallbackFontAssetIds.length,
    defaultFontAssetId: index.settings.defaultFontAssetId,
    defaultSpriteAssetId: index.settings.defaultSpriteAssetId,
    replacement: {
      requestedCodePoint: square.requestedCodePoint,
      renderedCodePoint: square.renderedCodePoint,
      stage: square.fallbackStage,
      fontId: square.fontId,
      glyphIndex: square.glyph.glyphIndex,
    },
    secondaryFallback: {
      renderedCodePoint: space.renderedCodePoint,
      stage: space.fallbackStage,
      fontId: space.fontId,
    },
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = auditOfficialTmpFallback();
  console.log("Official TMP global/default fallback audit OK");
  console.log(`  global=${report.globalFallbackCount} defaultFont=${report.defaultFontAssetId} defaultSprite=${report.defaultSpriteAssetId}`);
  console.log(`  U+10FFFF -> U+${report.replacement.renderedCodePoint.toString(16).toUpperCase()} (${report.replacement.stage})`);
}
