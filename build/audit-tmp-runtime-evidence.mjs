import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  TMP_RUNTIME_CANONICAL_SCENES,
  TMP_RUNTIME_DEFINITION,
  tmpRuntimeCaptureInventoryMatches,
  tmpRuntimeExpectedCaptureKeys,
  tmpRuntimeOfficialSampleIdentityMatches,
  tmpRuntimeSourceFiles,
  tmpRuntimeSourceIdentityMatches,
} from "./tmp-runtime-sources.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_ARTIFACT = path.join(ROOT, "tmp-runtime-evidence.local.json");

function sha256(root, file) {
  return crypto.createHash("sha256").update(fs.readFileSync(path.join(root, file))).digest("hex");
}

function nonemptyReadback(value) {
  return Number.isInteger(value?.alphaNonzero)
    && value.alphaNonzero > 0
    && value.alphaMax === 255
    && Array.isArray(value.bounds)
    && value.bounds.length === 4
    && /^[0-9a-f]{8}$/.test(value.fnv1a32 || "");
}

function countOccurrences(text, needle) {
  if (!needle) return 0;
  let count = 0;
  let offset = 0;
  while ((offset = text.indexOf(needle, offset)) >= 0) {
    count += 1;
    offset += needle.length;
  }
  return count;
}

function canonicalInlineExpectations(root, canonical) {
  const textFile = path.join(root, "public", "text", `${canonical.textStem}.zh_TW.json`);
  const text = JSON.parse(fs.readFileSync(textFile, "utf8"));
  const inlineElements = new Map();
  const exSprites = [];
  for (const element of text.elements || []) {
    for (const [sentinel, sprite] of Object.entries(element.inlineSprites || {})) {
      const glyphCount = countOccurrences(element.text || "", sentinel);
      if (glyphCount === 0) continue;
      const key = `${sprite.sdf?.fontId}|${sprite.sdf?.materialId}`;
      const previous = inlineElements.get(key);
      inlineElements.set(key, {
        fontId: sprite.sdf?.fontId,
        materialId: sprite.sdf?.materialId,
        glyphCount: (previous?.glyphCount || 0) + glyphCount,
      });
    }
    if (element.inlineEx) exSprites.push(element.inlineEx);
  }
  return {
    inlineElements: [...inlineElements.values()],
    exSprites,
  };
}

export function auditTmpRuntimeArtifact(artifact, {
  root = ROOT,
  definition = TMP_RUNTIME_DEFINITION,
} = {}) {
  const errors = [];
  if (artifact?.schemaVersion !== 1) errors.push("unsupported schemaVersion");
  if (artifact?.officialSample !== definition.sampleLabel) errors.push("official sample mismatch");
  if (!tmpRuntimeOfficialSampleIdentityMatches(artifact, definition)) {
    errors.push("official sample manifest/canonical corpus identity mismatch");
  }
  const sourceFiles = tmpRuntimeSourceFiles(root, definition);
  const currentHashes = Object.fromEntries(
    sourceFiles.map((source) => [source, sha256(root, source)]),
  );
  if (!tmpRuntimeSourceIdentityMatches(artifact?.sourceHashes, currentHashes)) {
    errors.push("runtime source hash inventory is incomplete or stale");
  }
  for (const source of sourceFiles) {
    if (artifact?.sourceHashes?.[source] !== currentHashes[source]) errors.push(`stale source hash: ${source}`);
  }
  const expectedKeys = tmpRuntimeExpectedCaptureKeys(definition);
  if (!tmpRuntimeCaptureInventoryMatches(artifact, definition)) {
    errors.push(
      `capture inventory must be exactly the ${expectedKeys.length} canonical zh_TW scenes`,
    );
  }
  const manifest = JSON.parse(
    fs.readFileSync(path.join(root, "public/shaders/tmp_sdf_program.json"), "utf8"),
  );
  const fontContract = JSON.parse(
    fs.readFileSync(path.join(root, "public/render/card-font-contract.json"), "utf8"),
  );
  const inlineContract = fontContract.inlineElements;
  const spriteContract = JSON.parse(
    fs.readFileSync(path.join(root, "public/render/tmp-sprite-contract.json"), "utf8"),
  );
  const spriteProgramContract = JSON.parse(
    fs.readFileSync(path.join(root, "public/render/tmp-sprite-program.json"), "utf8"),
  );
  const expectedProgram = manifest.official_source.decompressed_program_sha256;
  const artifactErrors = [...errors];
  const captures = definition.scenes.map((canonical) => {
    const capture = artifact?.captures?.[`${canonical.file}|zh_TW`];
    const captureErrors = [];
    if (artifactErrors.length) captureErrors.push("artifact-level source identity is stale or invalid");
    const evidence = capture?.evidence || {};
    if (capture?.scene !== canonical.file) captureErrors.push("canonical scene mismatch");
    if (capture?.locale !== "zh_TW") captureErrors.push("locale must be zh_TW");
    if (evidence.mode !== "official-tmp-sdf-webgl") captureErrors.push("wrong renderer mode");
    if (!(evidence.drawCount > 0) || !(evidence.glyphCount > 0)) captureErrors.push("no glyph draw output");
    if (evidence.fallbackCount !== 0) captureErrors.push("TMP layout or glyph path used a Canvas fallback");
    if (evidence.programManifest !== expectedProgram) captureErrors.push("official program hash mismatch");
    if (!Array.isArray(evidence.resourceBindings) || !evidence.resourceBindings.length) {
      captureErrors.push("TMP resource binding identity is absent");
    } else {
      for (const binding of evidence.resourceBindings) {
        if (!binding.fontId || !binding.materialId || !(binding.drawCount > 0) || !(binding.glyphCount > 0)) {
          captureErrors.push("TMP resource binding entry is malformed");
          break;
        }
      }
    }
    const inlineBindings = (evidence.resourceBindings || []).filter((binding) => binding.role === "inline-element");
    const spriteBindings = (evidence.spriteBindings || []).filter((binding) => binding.role === "inline-ex-sprite");
    const expectedInline = canonicalInlineExpectations(root, canonical);
    for (const expected of expectedInline.inlineElements) {
      if (expected.fontId !== inlineContract.fontId
          || !Object.values(inlineContract.materialIds).includes(expected.materialId)) {
        captureErrors.push("localized text inline-element contract disagrees with Pokesymbol2");
        continue;
      }
      if (!inlineBindings.some((binding) =>
        binding.fontId === expected.fontId
        && binding.materialId === expected.materialId
        && binding.glyphCount >= expected.glyphCount)) {
        captureErrors.push("official Pokesymbol2 inline-element binding was not executed");
      }
    }
    const expectsExSprite = expectedInline.exSprites.length > 0;
    for (const expected of expectedInline.exSprites) {
      const expectedSpriteIndex = spriteContract.preprocessor.fontTypeToSpriteIndex[expected.fontType];
      if (expected.spriteAssetId !== spriteContract.spriteAsset.pathId
          || expected.materialId !== spriteContract.material.pathId
          || expected.textureId !== spriteContract.texture.pathId
          || expected.spriteIndex !== expectedSpriteIndex) {
        captureErrors.push("localized text EX sprite contract disagrees with TextExSprite");
        continue;
      }
      if (!spriteBindings.some((binding) =>
        binding.spriteAssetId === expected.spriteAssetId
        && binding.materialId === expected.materialId
        && binding.textureId === expected.textureId
        && binding.spriteIndex === expected.spriteIndex
        && binding.characterName === expected.characterName
        && binding.tagFontSize === expected.fontSize
        && binding.elementScale > 0
        && binding.advance > 0)) {
        captureErrors.push("official TextExSprite binding and layout were not executed");
      }
    }
    const spriteDraws = (evidence.orderedDraws || []).filter((draw) =>
      draw.kind === "TMP-Sprite" && draw.role === "inline-ex-sprite");
    if (expectsExSprite) {
      if (evidence.tmpSpriteDrawCount !== spriteDraws.length || spriteDraws.length < 1) {
        captureErrors.push("inline EX did not execute through a dedicated TMP-Sprite draw");
      }
      if ((evidence.orderedDraws || []).some((draw) =>
        draw.kind === "Image" && draw.role === "inline-ex-sprite")) {
        captureErrors.push("inline EX incorrectly executed through the UIImage producer");
      }
      const spriteProgram = evidence.tmpSpriteProgram;
      if (spriteProgram?.selectorId !== spriteProgramContract.officialSelector.selectorId
          || spriteProgram?.candidateWitnessId
            !== spriteProgramContract.officialSelector.candidateWitnessId
          || spriteProgram?.executableId !== spriteProgramContract.officialSelector.executableId
          || spriteProgram?.semanticExecutableId
            !== spriteProgramContract.officialSelector.semanticExecutableId
          || spriteProgram?.passStateSha256
            !== spriteProgramContract.officialPass.passStateSha256
          || spriteProgram?.commonBindingsSha256
            !== spriteProgramContract.officialPass.commonBindingsSha256
          || spriteProgram?.webglAdaptationStatus !== "source-hash-bound") {
        captureErrors.push("dedicated TMP Sprite selector/program identity drifted");
      }
    } else if (spriteDraws.length || evidence.tmpSpriteDrawCount) {
      captureErrors.push("non-ex card unexpectedly executed a TMP-Sprite draw");
    }
    if (!expectsExSprite && spriteBindings.length) captureErrors.push("non-ex card unexpectedly executed TextExSprite");
    if (!nonemptyReadback(evidence.readback?.textSource)) {
      captureErrors.push("Text source RT is empty or malformed");
    }
    if (!nonemptyReadback(evidence.readback?.holoSource)) {
      captureErrors.push("Holo source RT is empty or malformed");
    }
    if (!nonemptyReadback(evidence.readback?.ui)) captureErrors.push("straight UI RT is empty or malformed");
    if (!nonemptyReadback(evidence.readback?.holo)) captureErrors.push("holo RT is empty or malformed");
    return {
      scene: canonical.file,
      locale: capture?.locale || "zh_TW",
      status: captureErrors.length ? "invalid" : "exact-local-runtime",
      resourceBindings: evidence.resourceBindings || [],
      inlineElementBindingCount: inlineBindings.length,
      tmpSpriteBindingCount: spriteBindings.length,
      tmpSpriteDrawCount: spriteDraws.length,
      tmpSpriteProgramBound: expectsExSprite
        && spriteDraws.length > 0
        && evidence.tmpSpriteProgram?.selectorId
          === spriteProgramContract.officialSelector.selectorId,
      errors: captureErrors,
    };
  });
  errors.push(...captures.flatMap((capture) => capture.errors.map((error) => `${capture.scene}|${capture.locale}: ${error}`)));
  return {
    status: errors.length ? "invalid" : "pass",
    validCaptureCount: captures.filter((capture) => capture.status === "exact-local-runtime").length,
    captures,
    errors,
  };
}

export function auditTmpRuntimeEvidence(file = process.env.PCR_TMP_RUNTIME_EVIDENCE || DEFAULT_ARTIFACT) {
  if (!fs.existsSync(file)) return {
    status: "missing",
    file,
    validCaptureCount: 0,
    captures: [],
    errors: [
      `runtime evidence artifact is absent; capture all ${TMP_RUNTIME_CANONICAL_SCENES.length}`
      + " canonical scenes with ?auditrt=1&lc=zh_TW",
    ],
  };
  const report = auditTmpRuntimeArtifact(JSON.parse(fs.readFileSync(file, "utf8")));
  return { ...report, file };
}

const isMain = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  const report = auditTmpRuntimeEvidence();
  console.log(`TMP no-screenshot runtime evidence: ${report.status}`);
  console.log(`  valid captures: ${report.validCaptureCount}/${TMP_RUNTIME_CANONICAL_SCENES.length}`);
  for (const capture of report.captures) console.log(`  ${capture.status.padEnd(19)} ${capture.scene}|${capture.locale}`);
  for (const error of report.errors) console.log(`  ERROR ${error}`);
  if (report.status === "invalid" || (process.argv.includes("--require") && report.status !== "pass")) process.exitCode = 1;
}
