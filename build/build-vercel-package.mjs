#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { gzipSync, gunzipSync } from "node:zlib";
import {
  createStagingDirectorySync,
  publishDirectorySync,
} from "./atomic-publish.mjs";
import { gameAssetRelativePath } from "./scene-example-availability.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC = path.join(ROOT, "public");
const GAME = path.join(PUBLIC, "game");
const DEFAULT_OUTPUT = path.join(ROOT, "vercel");
const VERCEL_HOBBY_SOURCE_LIMIT = 100_000_000;
const CORPUS = JSON.parse(
  fs.readFileSync(path.join(ROOT, "build", "canonical-corpus.json"), "utf8"),
);

function parseArgs(argv) {
  const options = {
    output: DEFAULT_OUTPUT,
    locales: [...CORPUS.locales],
    allLocales: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--all-locales") {
      options.allLocales = true;
      continue;
    }
    if (token === "--out" || token === "--locales") {
      const value = argv[++index];
      if (!value || value.startsWith("--")) throw new Error(`${token} requires a value`);
      if (token === "--out") options.output = path.resolve(ROOT, value);
      else options.locales = value.split(",").map((item) => item.trim()).filter(Boolean);
      continue;
    }
    throw new Error(`unknown argument: ${token}`);
  }
  if (options.allLocales) options.locales = [...CORPUS.locales];
  return options;
}

function posix(value) {
  return value.split(path.sep).join("/");
}

function copyFile(source, target) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
}

function copyRelative(sourceRoot, outputRoot, relative) {
  const source = path.join(sourceRoot, relative);
  assert(fs.statSync(source).isFile(), `missing package source: ${relative}`);
  copyFile(source, path.join(outputRoot, relative));
}

function copyTree(source, target) {
  fs.cpSync(source, target, { recursive: true, force: true });
}

function relativeModuleSpecifiers(source) {
  const output = new Set();
  for (const pattern of [
    /(?:import|export)\s+(?:[^"']*?\s+from\s+)?["'](\.\.?\/[^"']+)["']/g,
    /import\s*\(\s*["'](\.\.?\/[^"']+)["']\s*\)/g,
  ]) {
    for (const match of source.matchAll(pattern)) output.add(match[1]);
  }
  return [...output];
}

function resolveRelativeModule(fromRelative, specifier) {
  const bareSpecifier = specifier.replace(/[?#].*$/, "");
  let imported = path.posix.normalize(
    path.posix.join(path.posix.dirname(fromRelative), bareSpecifier),
  );
  if (!path.posix.extname(imported)) imported += ".js";
  return imported;
}

function runtimeAssetSpecifiers(source) {
  const output = new Set();
  for (const match of source.matchAll(
    /["'`]([^"'`]+?\.(?:json|glsl|png|bin|wasm)(?:[?#][^"'`]*)?)["'`]/g,
  )) {
    if (!match[1].includes("${")) output.add(match[1]);
  }
  return [...output];
}

function resolveRuntimeAssetCandidates(fromRelative, specifier) {
  const bareSpecifier = specifier.replace(/[?#].*$/, "");
  if (/^(?:[a-z]+:)?\/\//i.test(bareSpecifier)) return [];
  if (bareSpecifier.startsWith("/")) return [bareSpecifier.slice(1)];
  return [...new Set([
    path.posix.normalize(bareSpecifier),
    path.posix.normalize(path.posix.join(path.posix.dirname(fromRelative), bareSpecifier)),
  ])];
}

function collectRuntimePublicFiles() {
  const queue = ["app.js"];
  const files = new Set();
  for (let index = 0; index < queue.length; index += 1) {
    const relative = queue[index];
    if (files.has(relative)) continue;
    files.add(relative);
    const source = fs.readFileSync(path.join(PUBLIC, relative), "utf8");
    for (const specifier of relativeModuleSpecifiers(source)) {
      const imported = resolveRelativeModule(relative, specifier);
      if (fs.existsSync(path.join(PUBLIC, imported))) queue.push(imported);
    }
    for (const specifier of runtimeAssetSpecifiers(source)) {
      for (const candidate of resolveRuntimeAssetCandidates(relative, specifier)) {
        if (fs.existsSync(path.join(PUBLIC, candidate))) files.add(candidate);
      }
    }
  }
  for (const required of [
    "render/tmp-settings-contract.json",
  ]) {
    assert(fs.existsSync(path.join(PUBLIC, required)), `missing runtime contract: ${required}`);
    files.add(required);
  }
  return [...files].sort();
}

function writeJson(filename, value) {
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  fs.writeFileSync(filename, `${JSON.stringify(value, null, 2)}\n`);
}

function walkFiles(directory) {
  if (!fs.existsSync(directory)) return [];
  const output = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) output.push(...walkFiles(absolute));
    else if (entry.isFile()) output.push(absolute);
  }
  return output;
}

function collectStrings(value, output) {
  if (typeof value === "string") {
    output.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const child of value) collectStrings(child, output);
    return;
  }
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) collectStrings(child, output);
  }
}

function collectGameUrls(value, output) {
  if (typeof value === "string") {
    if (value.startsWith("/game/") && !/[()*]/.test(value)) {
      output.add(gameAssetRelativePath(value));
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const child of value) collectGameUrls(child, output);
    return;
  }
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) collectGameUrls(child, output);
  }
}

function collectFontIds(value, output, key = "") {
  if (Array.isArray(value)) {
    for (const child of value) collectFontIds(child, output, key);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [childKey, child] of Object.entries(value)) {
    if (childKey === "fontId" && (typeof child === "string" || typeof child === "number")) {
      output.add(String(child));
    }
    collectFontIds(child, output, childKey);
  }
}

function selectedCodePoints(strings) {
  const codePoints = new Set();
  for (let codePoint = 0x20; codePoint <= 0x7e; codePoint += 1) codePoints.add(codePoint);
  for (const text of strings) {
    for (const character of text) codePoints.add(character.codePointAt(0));
  }
  for (const codePoint of [0x0003, 0x00a0, 0x2005, 0x200b, 0x25a1, 0xfffc]) {
    codePoints.add(codePoint);
  }
  return codePoints;
}

function unicodeArgument(codePoints) {
  return [...codePoints]
    .sort((left, right) => left - right)
    .map((codePoint) => `U+${codePoint.toString(16).toUpperCase().padStart(4, "0")}`)
    .join(",");
}

function subsetFont(source, target, unicodes) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const command = process.env.PYFTSUBSET || "pyftsubset";
  const result = spawnSync(command, [
    source,
    `--output-file=${target}`,
    `--unicodes=${unicodes}`,
    "--layout-features=*",
    "--glyph-names",
    "--symbol-cmap",
    "--legacy-cmap",
    "--notdef-glyph",
    "--notdef-outline",
    "--recommended-glyphs",
    "--name-IDs=*",
    "--name-legacy",
    "--name-languages=*",
    "--drop-tables+=DSIG",
  ], {
    cwd: ROOT,
    encoding: "utf8",
    shell: process.platform === "win32",
    windowsHide: true,
  });
  if (result.status !== 0) {
    throw new Error(
      (result.stderr || result.stdout || result.error?.message || "pyftsubset failed").trim(),
    );
  }
}

function sceneInfo(sceneFile, scene) {
  return {
    file: sceneFile,
    id: scene.card?.id || "",
    name: scene.card?.name || sceneFile.replace(/\.json$/i, ""),
    rarityToken: scene.card?.rarityToken || "",
    availability: {
      selectable: true,
      reasonCodes: [],
      missingAssets: [],
    },
  };
}

function glyphIndex(entry) {
  return Number(entry?.glyphIndex ?? entry?.index);
}

function stripAtlasPreview(atlas, index) {
  const {
    url,
    pngByteSize,
    pngSha256,
    ...runtimeAtlas
  } = atlas;
  return { ...runtimeAtlas, index };
}

function pruneAtlasPages(atlases, usedPages) {
  const pageMap = new Map();
  const rows = [];
  for (let oldIndex = 0; oldIndex < (atlases || []).length; oldIndex += 1) {
    if (!usedPages.has(oldIndex)) continue;
    pageMap.set(oldIndex, rows.length);
    rows.push(stripAtlasPreview(atlases[oldIndex], rows.length));
  }
  return { pageMap, rows };
}

function pruneTmpFont(font, codePoints, keepAllGlyphs) {
  const keepCharacter = (entry) => keepAllGlyphs || codePoints.has(Number(entry.unicode));
  const characters = (font.characters || []).filter(keepCharacter);
  const runtimeCharacters = (font.runtimeCharacters || []).filter(keepCharacter);
  const syntheticCharacters = (font.syntheticCharacters || []).filter(keepCharacter);
  const usedGlyphs = new Set(
    [...characters, ...runtimeCharacters, ...syntheticCharacters].map(glyphIndex),
  );
  const glyphs = (font.glyphs || []).filter((entry) => usedGlyphs.has(glyphIndex(entry)));
  const runtimeGlyphs = (font.runtimeGlyphs || [])
    .filter((entry) => usedGlyphs.has(glyphIndex(entry)));
  const syntheticGlyphs = (font.syntheticGlyphs || [])
    .filter((entry) => usedGlyphs.has(glyphIndex(entry)));

  const officialPages = new Set(glyphs.map((entry) => Number(entry.atlasIndex || 0)));
  const generatedPages = new Set(runtimeGlyphs.map((entry) => Number(entry.page || 0)));
  const official = pruneAtlasPages(font.atlases, officialPages);
  const generated = pruneAtlasPages(font.runtimeAtlases, generatedPages);
  for (const glyph of glyphs) glyph.atlasIndex = official.pageMap.get(Number(glyph.atlasIndex || 0));
  for (const glyph of runtimeGlyphs) glyph.page = generated.pageMap.get(Number(glyph.page || 0));

  const pairRecords = (font.fontFeatureTable?.m_GlyphPairAdjustmentRecords || [])
    .filter((pair) => usedGlyphs.has(Number(pair.m_FirstAdjustmentRecord?.m_GlyphIndex))
      && usedGlyphs.has(Number(pair.m_SecondAdjustmentRecord?.m_GlyphIndex)));
  return {
    ...font,
    fontFeatureTable: {
      ...(font.fontFeatureTable || {}),
      m_GlyphPairAdjustmentRecords: pairRecords,
    },
    atlases: official.rows,
    glyphs,
    characters,
    runtimeAtlases: generated.rows,
    runtimeGlyphs,
    runtimeCharacters,
    syntheticGlyphs,
    syntheticCharacters,
  };
}

function pruneTmpManifest(manifest, fontIds, codePoints, inlineFontId) {
  const fonts = {};
  for (const id of [...fontIds].sort()) {
    assert(manifest.fonts?.[id], `TMP FontAsset ${id} is absent`);
    fonts[id] = pruneTmpFont(
      manifest.fonts[id],
      codePoints,
      id === String(inlineFontId),
    );
  }
  return {
    ...manifest,
    source: {
      ...manifest.source,
      deploymentSubset: true,
      localizedTextFileCount: undefined,
    },
    fonts,
  };
}

function compressTmpAtlases(manifest, outputRoot) {
  const targets = new Set();
  const report = [];
  for (const font of Object.values(manifest.fonts || {})) {
    for (const atlas of [...(font.atlases || []), ...(font.runtimeAtlases || [])]) {
      const sourceRelative = gameAssetRelativePath(atlas.alphaUrl);
      const targetRelative = `${sourceRelative}.pcrgz`;
      const source = fs.readFileSync(path.join(GAME, sourceRelative));
      const compressed = gzipSync(source, { level: 9 });
      assert.deepEqual(gunzipSync(compressed), source, `TMP gzip mismatch: ${sourceRelative}`);
      const target = path.join(outputRoot, "game", targetRelative);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, compressed);
      atlas.alphaUrl = `/game/${posix(targetRelative)}`;
      atlas.alphaEncoding = "gzip";
      atlas.compressedByteSize = compressed.length;
      targets.add(targetRelative);
      report.push({
        path: `game/${posix(targetRelative)}`,
        sourceByteLength: source.length,
        compressedByteLength: compressed.length,
      });
    }
  }
  return { targets, report };
}

function enableCompressedTmpAtlasLoader(outputRoot) {
  const filename = path.join(outputRoot, "render", "tmp-font-data.js");
  const source = fs.readFileSync(filename, "utf8");
  const needle = "    const alpha = new Uint8Array(await response.arrayBuffer());";
  const replacement = [
    "    const payload = await response.arrayBuffer();",
    "    if (atlas.alphaEncoding === \"gzip\" && typeof DecompressionStream !== \"function\") {",
    "      throw new Error(\"this browser cannot decompress the packaged TMP atlas\");",
    "    }",
    "    const decoded = atlas.alphaEncoding === \"gzip\"",
    "      ? await new Response(",
    "        new Blob([payload]).stream().pipeThrough(new DecompressionStream(\"gzip\")),",
    "      ).arrayBuffer()",
    "      : payload;",
    "    const alpha = new Uint8Array(decoded);",
  ].join("\n");
  assert(source.includes(needle), "TMP atlas loader hook changed");
  fs.writeFileSync(filename, source.replace(needle, replacement));
}

function outputStats(outputRoot) {
  const files = walkFiles(outputRoot);
  const byteLength = files.reduce((total, filename) => total + fs.statSync(filename).size, 0);
  return { fileCount: files.length, byteLength };
}

function verifyGameClosure(outputRoot) {
  const references = new Set();
  const textExtensions = new Set([".json", ".js", ".html", ".css"]);
  for (const filename of walkFiles(outputRoot)) {
    const extension = path.extname(filename).toLowerCase();
    if (!textExtensions.has(extension)) continue;
    if (extension === ".json") {
      collectGameUrls(JSON.parse(fs.readFileSync(filename, "utf8")), references);
      continue;
    }
    const source = fs.readFileSync(filename, "utf8");
    for (const match of source.matchAll(/["'`]\/game\/([^"'`\s)]+)/g)) {
      references.add(gameAssetRelativePath(`/game/${match[1]}`));
    }
  }
  const missing = [...references].filter(
    (relative) => !fs.existsSync(path.join(outputRoot, "game", relative)),
  );
  assert.deepEqual(missing, [], `deployment has missing /game assets: ${missing.join(", ")}`);
  return references;
}

function verifyModuleClosure(outputRoot) {
  const missing = [];
  for (const filename of walkFiles(outputRoot).filter((file) => file.endsWith(".js"))) {
    const relative = posix(path.relative(outputRoot, filename));
    const source = fs.readFileSync(filename, "utf8");
    for (const specifier of relativeModuleSpecifiers(source)) {
      const imported = resolveRelativeModule(relative, specifier);
      if (!fs.existsSync(path.join(outputRoot, imported))) {
        missing.push({ from: relative, specifier, imported });
      }
    }
  }
  assert.deepEqual(missing, [], `deployment has missing JS modules: ${JSON.stringify(missing)}`);
}

function verifyRuntimeAssetClosure(outputRoot) {
  const missing = [];
  for (const filename of walkFiles(outputRoot).filter((file) => file.endsWith(".js"))) {
    const relative = posix(path.relative(outputRoot, filename));
    const source = fs.readFileSync(filename, "utf8");
    for (const specifier of runtimeAssetSpecifiers(source)) {
      for (const candidate of resolveRuntimeAssetCandidates(relative, specifier)) {
        if (fs.existsSync(path.join(PUBLIC, candidate))
            && !fs.existsSync(path.join(outputRoot, candidate))) {
          missing.push({ from: relative, specifier, candidate });
        }
      }
    }
  }
  assert.deepEqual(
    missing,
    [],
    `deployment has missing runtime assets: ${JSON.stringify(missing)}`,
  );
}

function buildPackage(options) {
  const localeManifest = JSON.parse(
    fs.readFileSync(path.join(PUBLIC, "locales", "manifest.json"), "utf8"),
  );
  const localeRows = localeManifest.locales.filter((row) => options.locales.includes(row.lc));
  assert.equal(
    localeRows.length,
    options.locales.length,
    "one or more requested locales are unsupported",
  );

  copyRelative(PUBLIC, options.output, "index.html");
  copyRelative(PUBLIC, options.output, "texture-samplers.json");
  for (const relative of collectRuntimePublicFiles()) {
    copyRelative(PUBLIC, options.output, relative);
  }
  copyTree(path.join(PUBLIC, "shaders"), path.join(options.output, "shaders"));
  for (const relative of [
    "build/three.module.js",
    "examples/jsm/loaders/GLTFLoader.js",
    "examples/jsm/utils/BufferGeometryUtils.js",
  ]) {
    copyFile(
      path.join(ROOT, "node_modules", "three", relative),
      path.join(options.output, "vendor", "three", relative),
    );
  }

  const strings = [];
  const fontIds = new Set();
  const gameUrls = new Set();
  const scenes = [];
  for (const row of CORPUS.scenes) {
    const scene = JSON.parse(fs.readFileSync(path.join(PUBLIC, row.file), "utf8"));
    copyRelative(PUBLIC, options.output, row.file);
    collectStrings(scene, strings);
    collectGameUrls(scene, gameUrls);
    scenes.push(sceneInfo(row.file, scene));
    for (const locale of options.locales) {
      const relative = `text/${row.textStem}.${locale}.json`;
      const text = JSON.parse(fs.readFileSync(path.join(PUBLIC, relative), "utf8"));
      copyRelative(PUBLIC, options.output, relative);
      collectStrings(text, strings);
      collectGameUrls(text, gameUrls);
      collectFontIds(text, fontIds);
    }
  }

  const selectedFamilies = new Set();
  for (const row of localeRows) {
    for (const family of Object.values(row.fonts || {})) selectedFamilies.add(family);
    const uiRelative = `locales/card_ui.${row.lc}.json`;
    const faceRelative = `locales/card_face.${row.lc}.json`;
    copyRelative(PUBLIC, options.output, uiRelative);
    copyRelative(PUBLIC, options.output, faceRelative);
    collectStrings(JSON.parse(fs.readFileSync(path.join(PUBLIC, uiRelative), "utf8")), strings);
    collectStrings(JSON.parse(fs.readFileSync(path.join(PUBLIC, faceRelative), "utf8")), strings);
  }
  const fontFiles = Object.fromEntries(
    Object.entries(localeManifest.fontFiles)
      .filter(([family]) => selectedFamilies.has(family)),
  );
  const deploymentLocaleManifest = {
    ...localeManifest,
    default: options.locales.includes(localeManifest.default)
      ? localeManifest.default
      : options.locales[0],
    fontFiles,
    locales: localeRows,
  };
  writeJson(
    path.join(options.output, "locales", "manifest.json"),
    deploymentLocaleManifest,
  );
  collectStrings(deploymentLocaleManifest, strings);
  collectGameUrls(deploymentLocaleManifest, gameUrls);

  const cardFontContract = JSON.parse(
    fs.readFileSync(path.join(PUBLIC, "render", "card-font-contract.json"), "utf8"),
  );
  if (cardFontContract.inlineElements?.fontId) {
    fontIds.add(String(cardFontContract.inlineElements.fontId));
  }
  const sourceTmpManifest = JSON.parse(
    fs.readFileSync(path.join(GAME, "tmp-fonts", "manifest.json"), "utf8"),
  );
  const codePoints = selectedCodePoints(strings);
  const tmpManifest = pruneTmpManifest(
    sourceTmpManifest,
    fontIds,
    codePoints,
    cardFontContract.inlineElements?.fontId,
  );
  const tmpAtlasCompression = compressTmpAtlases(tmpManifest, options.output);
  writeJson(path.join(options.output, "game", "tmp-fonts", "manifest.json"), tmpManifest);
  enableCompressedTmpAtlasLoader(options.output);
  collectGameUrls(tmpManifest, gameUrls);

  writeJson(path.join(options.output, "scenes.json"), { scenes });
  writeJson(path.join(options.output, "card-examples.json"), {
    schema: "pocket-card-render/deployment-card-examples@1",
    schemaVersion: 1,
    coverageSet: { selectedWitnesses: [] },
    rarityRenderingCoverageSet: { additionalWitnesses: [] },
    supplementalBundledExamples: [],
  });
  writeJson(path.join(options.output, "vercel.json"), {
    rewrites: [{ source: "/scenes", destination: "/scenes.json" }],
    headers: [
      {
        source: "/game/(.*)",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
      {
        source: "/vendor/(.*)",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
      {
        source: "/shaders/(.*)",
        headers: [{
          key: "Cache-Control",
          value: "public, max-age=3600, stale-while-revalidate=604800",
        }],
      },
      {
        source: "/render/(.*)",
        headers: [{
          key: "Cache-Control",
          value: "public, max-age=3600, stale-while-revalidate=86400",
        }],
      },
      {
        source: "/text/(.*)",
        headers: [{
          key: "Cache-Control",
          value: "public, max-age=3600, stale-while-revalidate=86400",
        }],
      },
      {
        source: "/locales/(.*)",
        headers: [{
          key: "Cache-Control",
          value: "public, max-age=3600, stale-while-revalidate=86400",
        }],
      },
      {
        source: "/scene.(.*).json",
        headers: [{
          key: "Cache-Control",
          value: "public, max-age=3600, stale-while-revalidate=86400",
        }],
      },
      {
        source: "/app.js",
        headers: [{
          key: "Cache-Control",
          value: "public, max-age=3600, stale-while-revalidate=86400",
        }],
      },
    ],
  });

  for (const filename of walkFiles(options.output)) {
    if (path.extname(filename).toLowerCase() !== ".json") continue;
    collectGameUrls(JSON.parse(fs.readFileSync(filename, "utf8")), gameUrls);
  }
  for (const filename of [
    path.join(options.output, "app.js"),
    ...walkFiles(path.join(options.output, "render")).filter((file) => file.endsWith(".js")),
  ]) {
    const source = fs.readFileSync(filename, "utf8");
    for (const match of source.matchAll(/["'`]\/game\/([^"'`\s)]+)/g)) {
      gameUrls.add(gameAssetRelativePath(`/game/${match[1]}`));
    }
  }

  const fontTargets = new Set(Object.values(fontFiles).map(
    (url) => gameAssetRelativePath(url),
  ));
  const generatedGameTargets = new Set([
    "tmp-fonts/manifest.json",
    ...fontTargets,
    ...tmpAtlasCompression.targets,
  ]);
  for (const relative of [...gameUrls].sort()) {
    if (generatedGameTargets.has(relative)) continue;
    copyRelative(GAME, path.join(options.output, "game"), relative);
  }

  const unicodes = unicodeArgument(codePoints);
  const fontReport = [];
  for (const relative of [...fontTargets].sort()) {
    const source = path.join(GAME, relative);
    const target = path.join(options.output, "game", relative);
    subsetFont(source, target, unicodes);
    fontReport.push({
      path: `game/${posix(relative)}`,
      sourceByteLength: fs.statSync(source).size,
      subsetByteLength: fs.statSync(target).size,
    });
  }

  verifyModuleClosure(options.output);
  verifyRuntimeAssetClosure(options.output);
  const referencedGameAssets = verifyGameClosure(options.output);
  const beforeManifest = {
    schema: "pocket-card-render/vercel-package@1",
    cards: CORPUS.scenes.map((row) => row.cardId),
    locales: options.locales,
    gameAssetCount: referencedGameAssets.size,
    tmpFontAssetIds: [...fontIds].sort(),
    limits: {
      vercelHobbySourceUploadByteLength: VERCEL_HOBBY_SOURCE_LIMIT,
    },
    tmpAtlasCompression: tmpAtlasCompression.report,
    fontSubsets: fontReport,
  };
  writeJson(path.join(options.output, "deployment-manifest.json"), beforeManifest);
  const initialStats = outputStats(options.output);
  const manifestWithStats = {
    ...beforeManifest,
    output: {
      fileCount: initialStats.fileCount,
      byteLength: initialStats.byteLength,
      mebibytes: Number((initialStats.byteLength / (1024 * 1024)).toFixed(2)),
    },
  };
  writeJson(path.join(options.output, "deployment-manifest.json"), manifestWithStats);
  const stats = outputStats(options.output);
  manifestWithStats.output = {
    fileCount: stats.fileCount,
    byteLength: stats.byteLength,
    mebibytes: Number((stats.byteLength / (1024 * 1024)).toFixed(2)),
  };
  writeJson(path.join(options.output, "deployment-manifest.json"), manifestWithStats);
  assert(
    stats.byteLength < VERCEL_HOBBY_SOURCE_LIMIT,
    `deployment exceeds Vercel Hobby source limit: ${stats.byteLength} bytes`,
  );

  return { fontReport, stats };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const staging = createStagingDirectorySync(options.output);
  let summary;
  try {
    summary = buildPackage({ ...options, output: staging });
    publishDirectorySync(staging, options.output);
  } catch (error) {
    try {
      fs.rmSync(staging, {
        recursive: true,
        force: true,
        maxRetries: 7,
        retryDelay: 25,
      });
    } catch (cleanupError) {
      error.cleanupError = cleanupError;
    }
    throw error;
  }

  console.log(`Vercel package: ${posix(path.relative(ROOT, options.output))}`);
  console.log(`  cards=${CORPUS.scenes.length} locales=${options.locales.join(",")}`);
  console.log(
    `  files=${summary.stats.fileCount} `
    + `size=${(summary.stats.byteLength / (1024 * 1024)).toFixed(2)} MiB`,
  );
  console.log(
    `  OTF fonts=${summary.fontReport.length} `
    + `${(summary.fontReport.reduce(
      (sum, row) => sum + row.sourceByteLength,
      0,
    ) / (1024 * 1024)).toFixed(2)}`
    + " -> "
    + `${(summary.fontReport.reduce(
      (sum, row) => sum + row.subsetByteLength,
      0,
    ) / (1024 * 1024)).toFixed(2)} MiB`,
  );
}

main();
