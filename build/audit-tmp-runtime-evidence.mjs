import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { tmpRuntimeSourceFiles, tmpRuntimeSourceIdentityMatches } from "./tmp-runtime-sources.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_ARTIFACT = path.join(ROOT, "tmp-runtime-evidence.local.json");
const SOURCE_FILES = tmpRuntimeSourceFiles(ROOT);

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(path.join(ROOT, file))).digest("hex");
}

function nonemptyReadback(value) {
  return Number.isInteger(value?.alphaNonzero)
    && value.alphaNonzero > 0
    && value.alphaMax === 255
    && Array.isArray(value.bounds)
    && value.bounds.length === 4
    && /^[0-9a-f]{8}$/.test(value.fnv1a32 || "");
}

export function auditTmpRuntimeEvidence(file = process.env.PCR_TMP_RUNTIME_EVIDENCE || DEFAULT_ARTIFACT) {
  if (!fs.existsSync(file)) return {
    status: "missing",
    file,
    validCaptureCount: 0,
    captures: [],
    errors: ["runtime evidence artifact is absent; open a canonical scene with ?auditrt=1"],
  };
  const artifact = JSON.parse(fs.readFileSync(file, "utf8"));
  const errors = [];
  if (artifact.schemaVersion !== 1) errors.push("unsupported schemaVersion");
  if (artifact.officialSample !== "PTCGP 1.6.0 / Unity 2022.3.62f2") errors.push("official sample mismatch");
  const currentHashes = Object.fromEntries(SOURCE_FILES.map((source) => [source, sha256(source)]));
  if (!tmpRuntimeSourceIdentityMatches(artifact.sourceHashes, currentHashes)) {
    errors.push("runtime source hash inventory is incomplete or stale");
  }
  for (const source of SOURCE_FILES) {
    if (artifact.sourceHashes?.[source] !== currentHashes[source]) errors.push(`stale source hash: ${source}`);
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "public/shaders/tmp_sdf_program.json"), "utf8"));
  const fontContract = JSON.parse(fs.readFileSync(path.join(ROOT, "public/render/card-font-contract.json"), "utf8"));
  const inlineContract = fontContract.inlineElements;
  const spriteContract = JSON.parse(fs.readFileSync(path.join(ROOT, "public/render/tmp-sprite-contract.json"), "utf8"));
  const expectedProgram = manifest.official_source.decompressed_program_sha256;
  const artifactErrors = [...errors];
  const captures = Object.values(artifact.captures || {}).map((capture) => {
    const captureErrors = [];
    if (artifactErrors.length) captureErrors.push("artifact-level source identity is stale or invalid");
    const evidence = capture.evidence || {};
    if (!/^scene\.[\w-]+\.json$/.test(capture.scene || "")) captureErrors.push("invalid scene");
    if (!/^[a-z]{2}_[A-Z]{2}$/.test(capture.locale || "")) captureErrors.push("invalid locale");
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
    const expectsInlineElements = capture.scene === "scene.cPK_20_008900_02_HOUOUex_UR.json";
    if (expectsInlineElements && !inlineBindings.some((binding) =>
      binding.fontId === inlineContract.fontId
      && Object.values(inlineContract.materialIds).includes(binding.materialId)
      && binding.glyphCount >= 3)) {
      captureErrors.push("official Pokesymbol2 inline-element binding was not executed");
    }
    const expectsExSprite = capture.scene === "scene.cPK_10_000040_00_FUSHIGIBANAex_RR.json"
      || capture.scene === "scene.cPK_20_008900_02_HOUOUex_UR.json";
    if (expectsExSprite && !spriteBindings.some((binding) =>
      binding.spriteAssetId === spriteContract.spriteAsset.pathId
      && binding.materialId === spriteContract.material.pathId
      && binding.textureId === spriteContract.texture.pathId
      && binding.spriteIndex === spriteContract.preprocessor.fontTypeToSpriteIndex.ExBlack
      && binding.tagFontSize === 16
      && binding.elementScale > 0
      && binding.advance > 0)) {
      captureErrors.push("official TextExSprite binding and layout were not executed");
    }
    if (!expectsExSprite && spriteBindings.length) captureErrors.push("non-ex card unexpectedly executed TextExSprite");
    if (!nonemptyReadback(evidence.readback?.premultiplied)) captureErrors.push("premultiplied RT is empty or malformed");
    if (!nonemptyReadback(evidence.readback?.ui)) captureErrors.push("straight UI RT is empty or malformed");
    if (!nonemptyReadback(evidence.readback?.holo)) captureErrors.push("holo RT is empty or malformed");
    return {
      scene: capture.scene,
      locale: capture.locale,
      status: captureErrors.length ? "invalid" : "exact-local-runtime",
      resourceBindings: evidence.resourceBindings || [],
      inlineElementBindingCount: inlineBindings.length,
      tmpSpriteBindingCount: spriteBindings.length,
      errors: captureErrors,
    };
  });
  errors.push(...captures.flatMap((capture) => capture.errors.map((error) => `${capture.scene}|${capture.locale}: ${error}`)));
  return {
    status: errors.length ? "invalid" : "pass",
    file,
    validCaptureCount: captures.filter((capture) => capture.status === "exact-local-runtime").length,
    captures,
    errors,
  };
}

const isMain = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  const report = auditTmpRuntimeEvidence();
  console.log(`TMP no-screenshot runtime evidence: ${report.status}`);
  console.log(`  valid captures: ${report.validCaptureCount}`);
  for (const capture of report.captures) console.log(`  ${capture.status.padEnd(19)} ${capture.scene}|${capture.locale}`);
  for (const error of report.errors) console.log(`  ERROR ${error}`);
  if (report.status === "invalid" || (process.argv.includes("--require") && report.status !== "pass")) process.exitCode = 1;
}
