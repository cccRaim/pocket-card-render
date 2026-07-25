import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CANONICAL_LOCALIZED_TEXT_FILES } from "./full-runtime-sources.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SETTINGS_PATH = path.join(ROOT, "public", "render", "tmp-settings-contract.json");
const LAYOUT_PATH = path.join(ROOT, "public", "render", "card-ui-layout-contract.json");
const TEXT_DIR = path.join(ROOT, "public", "text");
const OUTPUT_PATH = path.join(ROOT, "public", "render", "tmp-line-layout-contract.json");
const TMP_PACKAGE = path.resolve(
  process.env.PCR_TMP_PACKAGE || "C:/Users/Admin/AppData/Local/Temp/tmp-3.0.6/package",
);
const check = process.argv.includes("--check") || process.env.PCR_TMP_LINE_LAYOUT_CHECK === "1";

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function fileFact(filename, logicalPath) {
  const bytes = fs.readFileSync(filename);
  return { path: logicalPath, byteSize: bytes.length, sha256: sha256(bytes) };
}

function sourceRange(lines, startLine, endLine) {
  const text = `${lines.slice(startLine - 1, endLine).join("\n")}\n`;
  return { startLine, endLine, sha256: sha256(Buffer.from(text, "utf8")) };
}

function collectTmpComponents(layout) {
  const rows = [];
  function walk(node, kind, parents = []) {
    const current = [...parents, node.gameObject?.name || "?"];
    if (node.tmp) rows.push({ kind, path: current.join("/"), ...node.tmp });
    for (const child of node.children || []) walk(child, kind, current);
  }
  for (const prefab of layout.prefabs || []) {
    for (const root of prefab.roots || []) walk(root, prefab.kind);
  }
  return rows;
}

function histogram(rows, key) {
  const output = {};
  for (const row of rows) {
    const value = String(row[key]);
    output[value] = (output[value] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(output).sort(([a], [b]) => a.localeCompare(b, "en", { numeric: true })));
}

function buildLocalizedCensus() {
  const files = CANONICAL_LOCALIZED_TEXT_FILES;
  const controls = new Map([
    [0x0A, "LF"], [0x0B, "VT"], [0x0D, "CR"], [0xAD, "softHyphen"],
    [0xA0, "noBreakSpace"], [0x2007, "figureSpace"], [0x2011, "noBreakHyphen"],
    [0x2028, "lineSeparator"], [0x2029, "paragraphSeparator"], [0x202F, "narrowNoBreakSpace"],
    [0x2060, "wordJoiner"], [0x06, "noBreakTagStart"], [0x07, "noBreakTagEnd"],
  ]);
  const counts = Object.fromEntries([...controls.values()].map((name) => [name, 0]));
  const locales = new Set();
  let textElementCount = 0;
  let wrappedTextElementCount = 0;
  let characterCount = 0;
  for (const name of files) {
    const document = JSON.parse(fs.readFileSync(path.join(TEXT_DIR, name), "utf8"));
    locales.add(document.locale);
    for (const element of document.elements || []) {
      if (element.kind !== "text") continue;
      textElementCount += 1;
      if (element.wrap) wrappedTextElementCount += 1;
      for (const character of String(element.text || "")) {
        characterCount += 1;
        const label = controls.get(character.codePointAt(0));
        if (label) counts[label] += 1;
      }
    }
  }
  return {
    fileCount: files.length,
    locales: [...locales].sort(),
    textElementCount,
    wrappedTextElementCount,
    characterCount,
    controls: counts,
  };
}

function buildContract() {
  const settings = JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf8"));
  const layout = JSON.parse(fs.readFileSync(LAYOUT_PATH, "utf8"));
  assert.equal(settings.schemaVersion, 2);
  assert.equal(layout.schemaVersion, 3);

  const runtimeDir = path.join(TMP_PACKAGE, "Scripts", "Runtime");
  const uguiPath = path.join(runtimeDir, "TMPro_UGUI_Private.cs");
  const tmpTextPath = path.join(runtimeDir, "TMP_Text.cs");
  const meshUtilitiesPath = path.join(runtimeDir, "TMPro_MeshUtilities.cs");
  const ugui = fileFact(
    uguiPath,
    "com.unity.textmeshpro@3.0.6/Scripts/Runtime/TMPro_UGUI_Private.cs",
  );
  const tmpText = fileFact(
    tmpTextPath,
    "com.unity.textmeshpro@3.0.6/Scripts/Runtime/TMP_Text.cs",
  );
  const meshUtilities = fileFact(
    meshUtilitiesPath,
    "com.unity.textmeshpro@3.0.6/Scripts/Runtime/TMPro_MeshUtilities.cs",
  );
  assert.equal(ugui.sha256, settings.source.textMeshProPackage.uguiGenerator.sha256);
  const uguiLines = fs.readFileSync(uguiPath, "utf8").split(/\r?\n/);
  const tmpTextLines = fs.readFileSync(tmpTextPath, "utf8").split(/\r?\n/);
  const meshLines = fs.readFileSync(meshUtilitiesPath, "utf8").split(/\r?\n/);
  const rows = collectTmpComponents(layout);
  const wrapped = rows.filter((row) => Number(row.m_enableWordWrapping) === 1);

  return {
    schemaVersion: 1,
    scope: "PTCGP 1.6.0 card UI reachable TMP 3.0.6 LTR Overflow line layout",
    source: {
      textMeshProVersion: "3.0.6",
      packageSha256: settings.source.textMeshProPackage.package.sha256,
      uguiGenerator: {
        ...ugui,
        ranges: {
          initializeSavedStates: sourceRange(uguiLines, 1855, 1870),
          horizontalOverflowAndSoftBreak: sourceRange(uguiLines, 2621, 2748),
          carriageReturnAndLineTermination: sourceRange(uguiLines, 3258, 3375),
          saveBreakpoints: sourceRange(uguiLines, 3435, 3506),
          justifiedAlignment: sourceRange(uguiLines, 3694, 3758),
        },
      },
      tmpText: {
        ...tmpText,
        ranges: {
          saveWordWrappingState: sourceRange(tmpTextLines, 5101, 5180),
          restoreWordWrappingState: sourceRange(tmpTextLines, 5190, 5277),
          noBreakTags: sourceRange(tmpTextLines, 7395, 7402),
        },
      },
      meshUtilities: {
        ...meshUtilities,
        ranges: { wordWrapState: sourceRange(meshLines, 344, 422) },
      },
      nativeGenerateTextMesh: settings.native.generateTextMesh,
    },
    constants: {
      horizontalOverflowEpsilon: 0.0001,
      justifiedWidthMultiplier: 1.05,
      nonBreakingCodePoints: [0xA0, 0x2007, 0x2011, 0x202F, 0x2060],
      explicitLineBreakCodePoints: [0x0A, 0x0B, 0x2028, 0x2029],
      softHyphen: 0xAD,
      zeroWidthSpace: 0x200B,
      cjkExclusiveRanges: [[0x2E80, 0x9FFF], [0xF900, 0xFAFF], [0xFE30, 0xFE4F], [0xFF00, 0xFFEF]],
      legacyHangulExclusiveRanges: [[0x1100, 0x11FF], [0xA960, 0xA97F], [0xAC00, 0xD7FF]],
    },
    cardUiCensus: {
      contractSha256: fileFact(LAYOUT_PATH).sha256,
      tmpComponentCount: rows.length,
      wrappedComponentCount: wrapped.length,
      wordWrap: histogram(rows, "m_enableWordWrapping"),
      overflowMode: histogram(rows, "m_overflowMode"),
      rightToLeft: histogram(rows, "m_isRightToLeft"),
      horizontalAlignment: histogram(rows, "m_HorizontalAlignment"),
      wrappedHorizontalAlignment: histogram(wrapped, "m_HorizontalAlignment"),
      wrappedAutoSize: histogram(wrapped, "m_enableAutoSizing"),
      reachableOverflowModes: [...new Set(rows.map((row) => Number(row.m_overflowMode)))].sort((a, b) => a - b),
    },
    localizedCanonicalCorpus: buildLocalizedCensus(),
  };
}

const contract = buildContract();
const serialized = `${JSON.stringify(contract, null, 2)}\n`;
if (check) {
  assert.equal(fs.readFileSync(OUTPUT_PATH, "utf8"), serialized, "TMP line-layout contract is stale");
  console.log("Official TMP line-layout contract OK");
} else {
  fs.writeFileSync(OUTPUT_PATH, serialized);
  console.log(`Wrote ${path.relative(ROOT, OUTPUT_PATH)}`);
}
