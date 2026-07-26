import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  compactOfficialUIImageState,
  resolveOfficialUIImageDrawState,
} from "../public/render/official-ugui-image.js";
import { CANONICAL_LOCALIZED_TEXT_FILES } from "./full-runtime-sources.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const layout = JSON.parse(fs.readFileSync(path.join(ROOT, "public/render/card-ui-layout-contract.json"), "utf8"));
const textDir = path.join(ROOT, "public/text");

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function pptr(value) {
  return { fileId: Number(value?.fileId || 0), pathId: String(value?.pathId || "0") };
}

function expectedState(node, provenance) {
  const image = node.image;
  const canvasRenderer = node.canvasRenderer;
  return {
    imageObjectSha256: image.objectSha256,
    enabled: Boolean(image.m_Enabled),
    color: [image.m_Color.r, image.m_Color.g, image.m_Color.b, image.m_Color.a].map(Number),
    material: pptr(image.m_Material),
    sprite: pptr(image.m_Sprite),
    type: Number(image.m_Type),
    preserveAspect: Boolean(image.m_PreserveAspect),
    fillCenter: Boolean(image.m_FillCenter),
    fillMethod: Number(image.m_FillMethod),
    fillAmount: Number(image.m_FillAmount),
    fillClockwise: Boolean(image.m_FillClockwise),
    fillOrigin: Number(image.m_FillOrigin),
    useSpriteMesh: Boolean(image.m_UseSpriteMesh),
    pixelsPerUnitMultiplier: Number(image.m_PixelsPerUnitMultiplier),
    canvasRenderer: canvasRenderer ? {
      objectSha256: canvasRenderer.objectSha256,
      cullTransparentMesh: Boolean(canvasRenderer.m_CullTransparentMesh),
    } : null,
    prefabGameObjectActive: provenance.prefabGameObjectActive,
    prefabActiveInHierarchy: provenance.prefabActiveInHierarchy,
    hierarchyOrder: provenance.hierarchyOrder,
  };
}

assert.equal(layout.schemaVersion, 3);
assert.equal(layout.summary.imageComponentCount, 314);
assert.equal(layout.summary.canvasRendererComponentCount, 414);
assert.equal(layout.summary.canvasComponentCount, 171);
assert.equal(layout.summary.maskComponentCount, 0);
assert.equal(layout.summary.rectMask2DComponentCount, 0);

const nodes = new Map();
const imageRows = [];
const canvasRows = [];
for (const prefab of layout.prefabs) {
  let order = 0;
  function walk(node, parentPath = "", parentActive = true) {
    const layoutPath = `${parentPath}/${node.gameObject.name}`;
    const provenance = {
      prefabGameObjectActive: Boolean(node.gameObject.active),
      prefabActiveInHierarchy: parentActive && Boolean(node.gameObject.active),
      hierarchyOrder: order++,
    };
    nodes.set(layoutPath, { node, provenance });
    if (node.image) {
      const expected = expectedState(node, provenance);
      assert.deepEqual(
        compactOfficialUIImageState(node.image, node.canvasRenderer, provenance),
        expected,
        `${layoutPath}: compact Image state drifted`,
      );
      imageRows.push({ path: layoutPath, state: expected });
    }
    if (node.canvas) canvasRows.push({ path: layoutPath, state: node.canvas });
    for (const child of node.children || []) walk(child, layoutPath, provenance.prefabActiveInHierarchy);
  }
  for (const root of prefab.roots) walk(root);
}

assert.equal(imageRows.length, 314);
assert.equal(canvasRows.length, 171);
assert.equal(imageRows.filter(({ state }) => state.enabled).length, 314);
assert.equal(imageRows.filter(({ state }) => state.type === 0).length, 314);
assert.equal(imageRows.filter(({ state }) => state.preserveAspect).length, 5);
assert.equal(imageRows.filter(({ state }) => state.fillAmount === 1).length, 314);
assert.equal(imageRows.filter(({ state }) => state.useSpriteMesh).length, 0);
assert.equal(imageRows.filter(({ state }) => state.prefabGameObjectActive).length, 74);
assert.equal(imageRows.filter(({ state }) => state.prefabActiveInHierarchy).length, 31);
assert.equal(imageRows.filter(({ state }) => state.canvasRenderer?.cullTransparentMesh).length, 83);
assert.equal(canvasRows.filter(({ state }) => state.m_Enabled === 1).length, 171);
assert.equal(canvasRows.filter(({ state }) => state.m_RenderMode === 2).length, 171);
assert.equal(canvasRows.filter(({ state }) => Number(state.m_AdditionalShaderChannelsFlag) === 25).length, 4);

const stateSha256 = sha256(JSON.stringify({ imageRows, canvasRows }));
assert.equal(stateSha256, "6f9b6c16d0ce539c3adc31e0d55a69bae1b32b81c2fba7db9f0e6d1b4eb43907", "official UGUI serialized state digest changed");

let iconCount = 0;
let directImageCount = 0;
for (const file of CANONICAL_LOCALIZED_TEXT_FILES) {
  const composition = JSON.parse(fs.readFileSync(path.join(textDir, file), "utf8"));
  for (const element of composition.elements || []) {
    if (element.kind !== "icon") continue;
    iconCount += 1;
    const binding = nodes.get(element.layoutPath);
    assert(binding, `${file}: ${element.layoutPath} is absent from official prefab hierarchy`);
    if (!binding.node.image) {
      assert.equal(element.uiImage, undefined, `${file}: runtime-generated Image inherited an unrelated prefab component`);
      continue;
    }
    directImageCount += 1;
    assert.deepEqual(
      element.uiImage,
      expectedState(binding.node, binding.provenance),
      `${file}: ${element.layoutPath} lost official Image state`,
    );
  }
}
assert.equal(iconCount, 441);
assert.equal(directImageCount, 198);
const topAttributeElements = CANONICAL_LOCALIZED_TEXT_FILES.flatMap((file) => {
  const composition = JSON.parse(fs.readFileSync(path.join(textDir, file), "utf8"));
  const elements = (composition.elements || []).filter((element) => (
    element.layoutPath?.startsWith("/PokemonCardUI/energy_view/CardEnergyIconView/")
  ));
  return elements.length ? [{ file, elements }] : [];
});
assert.equal(topAttributeElements.length, 18);
for (const { file, elements } of topAttributeElements) {
  assert.deepEqual(
    elements.map((element) => ({
      path: element.layoutPath,
      hierarchyOrder: element.hierarchyOrder,
      imageObjectSha256: element.uiImage?.imageObjectSha256,
    })),
    [
      {
        path: "/PokemonCardUI/energy_view/CardEnergyIconView/Outline",
        hierarchyOrder: 23,
        imageObjectSha256: "f391450c9f6aba02cc37491542af9dcfd43323dac89c45e9e0f4ff6f840877bd",
      },
      {
        path: "/PokemonCardUI/energy_view/CardEnergyIconView/icn_gra_img",
        hierarchyOrder: 24,
        imageObjectSha256: "7e15fefa1a318903714300eedfa9db3540a00427444baecc5f5dc28e6b360296",
      },
    ],
    `${file}: top attribute lost official Outline -> icon child order`,
  );
  const [outline, icon] = elements;
  assert(
    icon.box.l > outline.box.l
      && icon.box.r < outline.box.r
      && icon.box.t > outline.box.t
      && icon.box.b < outline.box.b,
    `${file}: top attribute icon lost its inset official child RectTransform`,
  );
}
const exOutlineElements = CANONICAL_LOCALIZED_TEXT_FILES.flatMap((file) => {
  const composition = JSON.parse(fs.readFileSync(path.join(textDir, file), "utf8"));
  return (composition.elements || [])
    .filter((element) => element.layoutPath?.endsWith("/ImgExOutlineWhite/ImgExOutlineWhite"))
    .map((element) => ({ file, element }));
});
assert.equal(exOutlineElements.length, 9);
assert.ok(exOutlineElements.every(({ file, element }) => (
  file.startsWith("PK_20_008900_02.")
  && element.hierarchyOrder === 7
  && element.uiImage?.imageObjectSha256
    === "a26a81faf3d5a4d61f6d37a0c6a5b6f6384b124f4f794702f6c86629d395c3c1"
)));

const exTitle = imageRows.find(({ path: layoutPath }) => layoutPath.endsWith("/PokemonExRuleView/ex_rule_ttl_txt/ex_rule_ttl_txt_zh"));
assert(exTitle, "official zh_TW ex-rule Image is absent");
const baseElement = { fit: "contain", color: [1, 1, 1, 1], uiImage: exTitle.state };
assert.deepEqual(resolveOfficialUIImageDrawState(baseElement), {
  visible: true,
  color: [0.9254902005195618, 0.7647058963775635, 0, 1],
  fit: "stretch",
  evidence: "official-prefab-image",
});
assert.equal(resolveOfficialUIImageDrawState({ ...baseElement, uiImage: { ...exTitle.state, enabled: false } }).visible, false);
assert.equal(resolveOfficialUIImageDrawState({ ...baseElement, uiImage: { ...exTitle.state, preserveAspect: true } }).fit, "contain");
assert.throws(() => resolveOfficialUIImageDrawState({ ...baseElement, uiImage: { ...exTitle.state, type: 3 } }), /unsupported official UGUI Image type/);
assert.throws(() => resolveOfficialUIImageDrawState({ ...baseElement, uiImage: { ...exTitle.state, useSpriteMesh: true } }), /useSpriteMesh/);
assert.throws(() => resolveOfficialUIImageDrawState({ ...baseElement, uiImage: { ...exTitle.state, pixelsPerUnitMultiplier: 2 } }), /pixelsPerUnitMultiplier/);

const app = fs.readFileSync(path.join(ROOT, "public/app.js"), "utf8");
assert.match(app, /resolveOfficialUIImageDrawState\(e\)/, "runtime drawSprite bypasses official Image state");

console.log("Official UGUI Image/static Canvas state audit OK");
console.log(`  ${imageRows.length} Images + ${canvasRows.length} Canvases hash-pinned`);
console.log(`  ${directImageCount}/${iconCount} prebuilt icon ops carry direct official Image state`);
console.log("  mutation tests reject disabled/filled/mesh/non-unit-PUP state drift");
