// Audit DynamicUI layout fields that must come from the official UI prefab,
// not from visual tuning in the canvas renderer.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const localesDir = path.join(ROOT, "public", "locales");
const textDir = path.join(ROOT, "public", "text");

const issues = [];

for (const file of fs.readdirSync(localesDir).filter((f) => /^card_face\..+\.json$/.test(f)).sort()) {
  const full = path.join(localesDir, file);
  const json = JSON.parse(fs.readFileSync(full, "utf8"));
  for (const [i, el] of (json.elements || []).entries()) {
    if (!el.exAfter) continue;
    for (const key of ["exH", "exAnchorX", "exMaxW"]) {
      if (typeof el[key] !== "number" || !Number.isFinite(el[key]) || el[key] <= 0) {
        issues.push(`${file}: elements[${i}] exAfter is missing numeric ${key}`);
      }
    }
  }
}

const layout = JSON.parse(fs.readFileSync(path.join(ROOT, "public", "render", "card-ui-layout-contract.json"), "utf8"));
if (layout.schemaVersion !== 3
    || layout.summary?.rectTransformCount !== 512
    || layout.summary?.tmpComponentCount !== 68
    || layout.summary?.imageComponentCount !== 314
    || layout.summary?.canvasRendererComponentCount !== 414
    || layout.summary?.maskComponentCount !== 0
    || layout.summary?.rectMask2DComponentCount !== 0
    || layout.summary?.canvasComponentCount !== 171) {
  issues.push("card-ui-layout-contract.json: unexpected schema or official object counts");
}
let officialWrapAndAutosizeCount = 0;
for (const prefab of layout.prefabs || []) {
  const pending = [...(prefab.roots || [])];
  while (pending.length) {
    const node = pending.pop();
    if (node.tmp?.m_enableWordWrapping && node.tmp?.m_enableAutoSizing) officialWrapAndAutosizeCount += 1;
    pending.push(...(node.children || []));
  }
}
if (officialWrapAndAutosizeCount !== 1) issues.push(`expected one official wrap+autosize TMP component, found ${officialWrapAndAutosizeCount}`);

const requiredNumericLayoutFields = [
  "fontWeight", "fontStyle", "characterSpacing", "wordSpacing", "lineSpacing",
  "lineSpacingMax", "paragraphSpacing", "charWidthMaxAdj", "wordWrappingRatios",
  "overflowMode", "horizontalAlignment", "verticalAlignment",
];
const requiredBooleanLayoutFields = ["kerning", "richText", "parseCtrlCharacters"];
let runtimeTextCount = 0;
for (const file of fs.readdirSync(textDir).filter((name) => name.endsWith(".json")).sort()) {
  const json = JSON.parse(fs.readFileSync(path.join(textDir, file), "utf8"));
  for (const [index, element] of (json.elements || []).entries()) {
    if (element.kind !== "text") continue;
    runtimeTextCount += 1;
    if (!/^[0-9a-f]{64}$/.test(element.layoutObjectSha256 || "")) {
      issues.push(`${file}: elements[${index}] lacks official TMP object identity`);
    }
    for (const field of requiredNumericLayoutFields) {
      const value = element[field];
      const valid = typeof value === "number" && Number.isFinite(value);
      if (!valid) issues.push(`${file}: elements[${index}] lacks serialized ${field}`);
    }
    if (!Array.isArray(element.margin) || element.margin.length !== 4 || !element.margin.every(Number.isFinite)) {
      issues.push(`${file}: elements[${index}] lacks serialized margin`);
    }
    for (const field of requiredBooleanLayoutFields) {
      if (typeof element[field] !== "boolean") issues.push(`${file}: elements[${index}] lacks serialized ${field}`);
    }
  }
}
if (runtimeTextCount < 200) issues.push(`expected at least 200 runtime text draw ops, found ${runtimeTextCount}`);

const tmpSettings = JSON.parse(fs.readFileSync(path.join(ROOT, "public", "render", "tmp-settings-contract.json"), "utf8"));
if (tmpSettings.schemaVersion !== 2
    || tmpSettings.settings?.rawSha256 !== "61213932599fe55e49d0d3ea1010c17df74eb7027edb7a8d7501b0c824bad8de"
    || [...(tmpSettings.lineBreaking?.leadingCharacters?.text || "")].length !== 41
    || [...(tmpSettings.lineBreaking?.followingCharacters?.text || "")].length !== 97) {
  issues.push("tmp-settings-contract.json: official APK line-breaking contract is missing or stale");
}

const compose = fs.readFileSync(path.join(ROOT, "build", "compose.mjs"), "utf8");
if (/card_ui_prefabs\.json/.test(compose)) {
  issues.push("build/compose.mjs: lossy cross-project card_ui_prefabs.json is still referenced");
}
if (!/card-ui-layout-contract\.json/.test(compose) || !/layoutObjectSha256/.test(compose)) {
  issues.push("build/compose.mjs: official compact layout contract is not wired through draw ops");
}
if (/else\s+if\s*\(s\.autosize/.test(compose)) {
  issues.push("build/compose.mjs: wrap and autosize are still incorrectly mutually exclusive");
}
if (!/const\s+nameElm\s*=\s*node\("name_elm"\)/.test(compose)) {
  issues.push("build/compose.mjs: Pokemon ex layout must derive exAnchorX from name_elm");
}
if (!/exAnchorX\s*=\s*nameElm\?\.box\?\.l\s*\?\?\s*name\.box\.l/.test(compose)) {
  issues.push("build/compose.mjs: dynamic Pokemon compose must emit exAnchorX with name box fallback");
}
if (!/exMaxW\s*=\s*300\s*\/\s*CW/.test(compose)) {
  issues.push("build/compose.mjs: dynamic Pokemon compose must emit the official 300px _textMaxWidthForEx");
}

const app = fs.readFileSync(path.join(ROOT, "public", "app.js"), "utf8");
if (!/\(e\.exAnchorX\s*\?\?\s*b\.l\)\s*\*\s*W\s*\+\s*Math\.min\(nw,\s*maxW\)/.test(app)) {
  issues.push("public/app.js: ex glyph placement must use exAnchorX before measured-name clamp");
}
if (/fs\s*\*\s*0\.06/.test(app)) {
  issues.push("public/app.js: ex glyph placement still contains the old visual gap tune");
}
if (!/characterSpacing:\s*Number\(e\.characterSpacing/.test(app)
    || !/Number\(e\.lineSpacing\s*\|\|\s*0\)\s*\*\s*emScale/.test(app)
    || !/charWidthMaxAdj/.test(app)) {
  issues.push("public/app.js: serialized TMP spacing/line-height/width-adjustment fields are not wired");
}
if (!/wrapOfficialTmpItems/.test(app)
    || !/computeOfficialTmpJustificationOffsets/.test(app)
    || !/horizontalAlignment\s*===\s*8/.test(app)
    || !/paragraphSpacing/.test(app)) {
  issues.push("public/app.js: official TMP wrap/justification/paragraph state is not wired");
}
if (!/officialFontVerticalBounds/.test(app) || /bounds\.push\(inkBounds\(e,\s*" "/.test(app)) {
  issues.push("public/app.js: empty-line metrics must come from official FontAsset face metrics without a synthetic space glyph");
}

if (issues.length) {
  console.error(`DynamicUI layout audit failed: ${issues.length} issue(s) found`);
  for (const issue of issues) console.error(`BAD ${issue}`);
  process.exit(1);
}

console.log("DynamicUI layout audit OK");
console.log(`  ${runtimeTextCount} runtime text draw ops carry official object/layout fields`);
