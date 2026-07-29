// Audit DynamicUI layout fields that must come from the official UI prefab,
// not from visual tuning in the canvas renderer.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  computeOfficialNameExParentDelta,
  shiftOfficialNameExBox,
} from "../public/render/official-name-ex-layout.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const textDir = path.join(ROOT, "public", "text");

const issues = [];

for (const file of fs.readdirSync(textDir).filter((f) => /\.json$/.test(f)).sort()) {
  const full = path.join(textDir, file);
  const json = JSON.parse(fs.readFileSync(full, "utf8"));
  for (const [i, el] of (json.elements || []).entries()) {
    if (el.exAfter) issues.push(`${file}: elements[${i}] still uses legacy procedural exAfter`);
    if (el.unityLayer !== 17 && el.unityLayer !== 18) {
      issues.push(`${file}: elements[${i}] lacks official CardUIText/CardUIMetallic layer`);
    }
  }
  for (const name of (json.elements || []).filter((element) => element.nameExLayout)) {
    const layers = (json.elements || [])
      .filter((element) => element.nameExOwnerPath === name.layoutPath)
      .sort((left, right) => left.hierarchyOrder - right.hierarchyOrder);
    const layerNames = layers.map((element) => element.nameExLayer);
    const expected = layerNames.includes("white-outline")
      ? ["white-outline", "base", "outline"]
      : ["base", "outline"];
    if (JSON.stringify(layerNames) !== JSON.stringify(expected)) {
      issues.push(
        `${file}: ${name.layoutPath} official EX hierarchy is ${JSON.stringify(layerNames)}, `
        + `expected ${JSON.stringify(expected)}`,
      );
    }
    if (name.nameExLayout.contractId !== "PokemonCardNameView.UpdateExLayout"
        || !Number.isFinite(name.nameExLayout.anchorX)
        || !Number.isFinite(name.nameExLayout.authoredParentX)
        || !Number.isFinite(name.nameExLayout.maxW)) {
      issues.push(`${file}: ${name.layoutPath} has an invalid official EX parent layout contract`);
    }
    const base = layers.find((element) => element.nameExLayer === "base");
    for (const layer of layers) {
      if (!base || ["l", "r", "t", "b"].some((key) => (
        Math.abs(Number(layer.box?.[key]) - Number(base.box?.[key])) > 0.000001
      ))) {
        issues.push(`${file}: ${name.layoutPath} EX layer ${layer.nameExLayer} does not share the official parent box`);
      }
    }
  }
}

try {
  const layout = {
    contractId: "PokemonCardNameView.UpdateExLayout",
    anchorX: 140 / 734,
    authoredParentX: 347 / 734,
    maxW: 300 / 734,
  };
  const delta = computeOfficialNameExParentDelta(layout, 80, 734);
  if (delta !== -127) issues.push(`official EX parent delta test returned ${delta}, expected -127`);
  const shifted = shiftOfficialNameExBox({ l: 341 / 734, r: 436 / 734, t: 0.1, b: 0.2 }, delta, 734);
  if (Math.abs(shifted.l - 214 / 734) > 1e-12
      || Math.abs(shifted.r - 309 / 734) > 1e-12) {
    issues.push("official EX child layers do not inherit the parent displacement exactly");
  }
  let rejected = false;
  try {
    computeOfficialNameExParentDelta({ ...layout, contractId: "visual-tune" }, 80, 734);
  } catch {
    rejected = true;
  }
  if (!rejected) issues.push("official EX parent layout accepted an unsupported contract");
} catch (error) {
  issues.push(`official EX parent layout mutation gate failed: ${error.message}`);
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

const pokemonPrefab = layout.prefabs.find((prefab) => prefab.kind === "pokemon");
const layerByPath = new Map();
const fontKeyByPath = new Map();
function collectOfficialLayers(node, parentPath = "") {
  const nodePath = `${parentPath}/${node.gameObject.name}`;
  layerByPath.set(nodePath, node.gameObject.layer);
  if (node.tmp?.fontGroupKey != null) fontKeyByPath.set(nodePath, node.tmp.fontGroupKey);
  for (const child of node.children || []) collectOfficialLayers(child, nodePath);
}
for (const root of pokemonPrefab?.roots || []) collectOfficialLayers(root);
for (const [pathSuffix, expectedLayer] of [
  ["/PokemonCardUI/energy_view/CardEnergyIconView/icn_gra_img", 17],
  ["/PokemonCardUI/mega_name_elm/card_name_txt", 18],
  ["/PokemonCardUI/mega_name_elm/card_name_txt_outline", 17],
  ["/PokemonCardUI/name_elm/Ex/EX/ImgEx", 18],
  ["/PokemonCardUI/name_elm/Ex/EX/ImgExOutline", 17],
  ["/PokemonCardUI/PokemonExRuleView/frm_bg", 18],
  ["/PokemonCardUI/PokemonExRuleView/frm", 17],
  ["/PokemonCardUI/PokemonExRuleView/ex_rule_description_txt_01", 17],
]) {
  if (layerByPath.get(pathSuffix) !== expectedLayer) {
    issues.push(`card-ui-layout-contract.json: ${pathSuffix} expected Unity layer ${expectedLayer}`);
  }
}
for (const [pathSuffix, expectedKey] of [
  ["/PokemonCardUI/mega_name_elm/card_name_txt", 100],
  ["/PokemonCardUI/mega_name_elm/card_name_txt_outline", 118],
]) {
  if (fontKeyByPath.get(pathSuffix) !== expectedKey) {
    issues.push(`card-ui-layout-contract.json: ${pathSuffix} expected CardTextKey ${expectedKey}`);
  }
}

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
if (!/unityLayer:\s*Number\(entry\.gameObject\.layer\)/.test(compose)
    || !/unityLayer:\s*nodeObj\.unityLayer/.test(compose)
    || !/layoutPath:\s*node\.path,\s*unityLayer:\s*node\.unityLayer/.test(compose)) {
  issues.push("build/compose.mjs: serialized GameObject.m_Layer is not preserved through Image/TMP draw ops");
}
if (/else\s+if\s*\(s\.autosize/.test(compose)) {
  issues.push("build/compose.mjs: wrap and autosize are still incorrectly mutually exclusive");
}
if (!/const\s+nameElmPath\s*=\s*cd\.isMega/.test(compose)
    || !/\/PokemonCardUI\/mega_name_elm/.test(compose)
    || !/\/PokemonCardUI\/name_elm/.test(compose)) {
  issues.push("build/compose.mjs: Pokemon ex layout must derive the normal/Mega name_elm branch");
}
if (!/pokemonNameLayoutLayers/.test(compose)
    || !/\/PokemonCardUI\/mega_name_elm\/card_name_txt_outline/.test(compose)) {
  issues.push("build/compose.mjs: official Mega Pokemon base/outline TMP hierarchy is not emitted");
}
if (!/contractId:\s*["']PokemonCardNameView\.UpdateExLayout["']/.test(compose)
    || !/authoredParentX:\s*exParent\.box\.l/.test(compose)
    || !/anchorX:\s*nameElm\.box\.l/.test(compose)) {
  issues.push("build/compose.mjs: dynamic Pokemon compose must emit the official parent-level EX layout contract");
}
if (!/maxW:\s*300\s*\/\s*CW/.test(compose)) {
  issues.push("build/compose.mjs: dynamic Pokemon compose must emit the official 300px _textMaxWidthForEx");
}
if (!/nameExLayer:\s*layer/.test(compose)
    || !/nameExOwnerPath:\s*namePath/.test(compose)
    || !/white-outline/.test(compose)
    || !/ImgExOutline/.test(compose)) {
  issues.push("build/compose.mjs: official EX white/base/outline Image hierarchy is not emitted");
}

const app = fs.readFileSync(path.join(ROOT, "public", "app.js"), "utf8");
if (!/computeOfficialNameExParentDelta\(e\.nameExLayout,\s*nameWidth,\s*W\)/.test(app)
    || !/shiftOfficialNameExBox\(e\.box,\s*deltaX,\s*W\)/.test(app)) {
  issues.push("public/app.js: the full official EX Image hierarchy must inherit one parent displacement");
}
if (/role:\s*["']name-ex(?:-outline)?["']/.test(app)
    || /EX_GLYPH_OUTLINE/.test(app)) {
  issues.push("public/app.js: legacy procedural EX Image drawing is still present");
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
if (!/unityLayer:\s*Number\(element\?\.unityLayer\)/.test(app)
    || !/unityLayer:\s*Number\(e\.unityLayer\)/.test(app)
    || !/dynamicUITextMaterials/.test(app)
    || !/material\.uniforms\[uniformName\]\.value\s*=\s*t\.ui/.test(app)) {
  issues.push("public/app.js: DynamicUI Text/Holo draw and locale-swap partition is not wired");
}

const tmpRenderer = fs.readFileSync(
  path.join(ROOT, "public", "render", "tmp-sdf-renderer.js"),
  "utf8",
);
if (!/Text:\s*17/.test(tmpRenderer)
    || !/Holo:\s*18/.test(tmpRenderer)
    || !/mesh\.layers\.set\(unityLayer\)/.test(tmpRenderer)
    || !/camera\.layers\.set\(unityLayer\)/.test(tmpRenderer)
    || !/\[\s*textSource,\s*ui\s*\]/.test(tmpRenderer)
    || !/\[\s*holoSource,\s*holo\s*\]/.test(tmpRenderer)) {
  issues.push("tmp-sdf-renderer.js: official CardUIText/CardUIMetallic RT partition is absent");
}

const textMaterial = fs.readFileSync(
  path.join(ROOT, "public", "render", "materials", "text.js"),
  "utf8",
);
if (!/ctx\.dynUITex/.test(textMaterial) || /ctx\.dynHoloTex/.test(textMaterial)) {
  issues.push("materials/text.js: Text consumer is not isolated to DynamicUIType.Text");
}

if (issues.length) {
  console.error(`DynamicUI layout audit failed: ${issues.length} issue(s) found`);
  for (const issue of issues) console.error(`BAD ${issue}`);
  process.exit(1);
}

console.log("DynamicUI layout audit OK");
console.log(`  ${runtimeTextCount} runtime text draw ops carry official object/layout fields`);
