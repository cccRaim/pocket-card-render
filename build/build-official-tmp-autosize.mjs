import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SETTINGS_PATH = path.join(ROOT, "public", "render", "tmp-settings-contract.json");
const LAYOUT_PATH = path.join(ROOT, "public", "render", "card-ui-layout-contract.json");
const OUTPUT_PATH = path.join(ROOT, "public", "render", "tmp-autosize-contract.json");
const TMP_PACKAGE = path.resolve(
  process.env.PCR_TMP_PACKAGE || "C:/Users/Admin/AppData/Local/Temp/tmp-3.0.6/package",
);
const check = process.argv.includes("--check") || process.env.PCR_TMP_AUTOSIZE_CHECK === "1";

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

function buildContract() {
  const settings = JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf8"));
  const layout = JSON.parse(fs.readFileSync(LAYOUT_PATH, "utf8"));
  assert.equal(settings.schemaVersion, 2);
  assert.equal(layout.schemaVersion, 3);

  const runtimeDir = path.join(TMP_PACKAGE, "Scripts", "Runtime");
  const uguiPath = path.join(runtimeDir, "TMPro_UGUI_Private.cs");
  const tmpTextPath = path.join(runtimeDir, "TMP_Text.cs");
  const ugui = fileFact(
    uguiPath,
    "com.unity.textmeshpro@3.0.6/Scripts/Runtime/TMPro_UGUI_Private.cs",
  );
  assert.equal(ugui.sha256, settings.source.textMeshProPackage.uguiGenerator.sha256);
  const uguiLines = fs.readFileSync(uguiPath, "utf8").split(/\r?\n/);
  const tmpText = fileFact(
    tmpTextPath,
    "com.unity.textmeshpro@3.0.6/Scripts/Runtime/TMP_Text.cs",
  );
  const tmpTextLines = fs.readFileSync(tmpTextPath, "utf8").split(/\r?\n/);
  const rows = collectTmpComponents(layout);

  return {
    schemaVersion: 1,
    scope: "PTCGP 1.6.0 PokemonCardUI and TrainersCardUI reachable TMP autosize/overflow branches",
    source: {
      textMeshProVersion: "3.0.6",
      packageSha256: settings.source.textMeshProPackage.package.sha256,
      uguiGenerator: {
        ...ugui,
        ranges: {
          resetAndIterationLoop: sourceRange(uguiLines, 1647, 1672),
          currentLineVerticalOverflow: sourceRange(uguiLines, 2446, 2512),
          wordWrapWidthAutosize: sourceRange(uguiLines, 2621, 2722),
          wrappedHeightAutosize: sourceRange(uguiLines, 2750, 2837),
          unwrappedWidthAutosize: sourceRange(uguiLines, 2952, 3011),
          upperFontSizeBounds: sourceRange(uguiLines, 3517, 3542),
        },
      },
      tmpText: {
        ...tmpText,
        ranges: {
          overflowEnum: sourceRange(tmpTextLines, 98, 98),
          maxIterationCount: sourceRange(tmpTextLines, 510, 510),
        },
      },
      nativeGenerateTextMesh: settings.native.generateTextMesh,
    },
    constants: {
      widthEpsilon: 0.0001,
      justifiedWidthMultiplier: 1.05,
      fontSizeEpsilon: 0.051,
      minimumFontSizeStep: 0.05,
      fontSizeRoundingMultiplier: 20,
      maxIterations: 100,
    },
    cardUiCensus: {
      contractSha256: fileFact(LAYOUT_PATH).sha256,
      tmpComponentCount: rows.length,
      autosize: histogram(rows, "m_enableAutoSizing"),
      wordWrap: histogram(rows, "m_enableWordWrapping"),
      overflowMode: histogram(rows, "m_overflowMode"),
      lineSpacingMax: histogram(rows, "m_lineSpacingMax"),
      charWidthMaxAdj: histogram(rows, "m_charWidthMaxAdj"),
      autosizeAndWordWrapCount: rows.filter((row) => row.m_enableAutoSizing && row.m_enableWordWrapping).length,
      reachableOverflowModes: [...new Set(rows.map((row) => Number(row.m_overflowMode)))].sort((a, b) => a - b),
    },
  };
}

const contract = buildContract();
const serialized = `${JSON.stringify(contract, null, 2)}\n`;
if (check) {
  assert.equal(fs.readFileSync(OUTPUT_PATH, "utf8"), serialized, "TMP autosize contract is stale");
  console.log("Official TMP autosize contract OK");
} else {
  fs.writeFileSync(OUTPUT_PATH, serialized);
  console.log(`Wrote ${path.relative(ROOT, OUTPUT_PATH)}`);
}
