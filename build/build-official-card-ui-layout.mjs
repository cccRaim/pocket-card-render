import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT = path.join(ROOT, "public", "render", "card-ui-layout-contract.json");
const check = process.argv.includes("--check") || process.env.PCR_CARD_UI_LAYOUT_CHECK === "1";
const extracted = JSON.parse(execFileSync(
  process.env.PYTHON || "python",
  ["-B", "build/extract_official_card_ui_layout.py"],
  {
    cwd: ROOT,
    encoding: "utf8",
    shell: process.platform === "win32",
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
    maxBuffer: 32 * 1024 * 1024,
  },
));

assert.equal(extracted.schemaVersion, 3);
assert.equal(extracted.unityVersion, "2022.3.62f2");
assert.deepEqual(extracted.summary, {
  prefabCount: 2,
  rectTransformCount: 512,
  tmpComponentCount: 68,
  tagFontSizeComponentCount: 68,
  imageComponentCount: 314,
  canvasRendererComponentCount: 414,
  maskComponentCount: 0,
  rectMask2DComponentCount: 0,
  canvasComponentCount: 171,
});
assert.deepEqual(extracted.prefabs.map((prefab) => [
  prefab.kind,
  prefab.bundleByteSize,
  prefab.bundleSha256,
  prefab.rectTransformCount,
  prefab.tmpComponentCount,
  prefab.tagFontSizeComponentCount,
  prefab.imageComponentCount,
  prefab.canvasRendererComponentCount,
  prefab.maskComponentCount,
  prefab.rectMask2DComponentCount,
  prefab.canvasComponentCount,
]), [
  ["pokemon", 85874, "405a783ca9f7fb58f6c6f55aaa37d6d018b7e83f22c1f5b14bfe09ecc0fb2c05", 318, 47, 47, 177, 256, 0, 0, 83],
  ["trainer", 54692, "33b3af9be400cf2b6aed6696e2b9eb8d4a78f8cbe41ca3d80a12d2cb6d9fb484", 194, 21, 21, 137, 158, 0, 0, 88],
]);

const IMAGE_FIELDS = [
  "m_Enabled", "m_Script", "m_Name", "m_Material", "m_Color",
  "m_RaycastTarget", "m_RaycastPadding", "m_Maskable", "m_OnCullStateChanged",
  "m_Sprite", "m_Type", "m_PreserveAspect", "m_FillCenter", "m_FillMethod",
  "m_FillAmount", "m_FillClockwise", "m_FillOrigin", "m_UseSpriteMesh",
  "m_PixelsPerUnitMultiplier",
];
const CANVAS_RENDERER_FIELDS = ["m_CullTransparentMesh"];
const CANVAS_FIELDS = [
  "m_Enabled", "m_RenderMode", "m_Camera", "m_PlaneDistance", "m_PixelPerfect",
  "m_ReceivesEvents", "m_OverrideSorting", "m_OverridePixelPerfect",
  "m_SortingBucketNormalizedSize", "m_VertexColorAlwaysGammaSpace",
  "m_AdditionalShaderChannelsFlag", "m_UpdateRectTransformForStandalone",
  "m_SortingLayerID", "m_SortingOrder", "m_TargetDisplay",
];
const COMPONENT_FIELDS = {
  image: IMAGE_FIELDS,
  canvasRenderer: CANVAS_RENDERER_FIELDS,
  canvas: CANVAS_FIELDS,
};
const EXPECTED_NODE_COUNTS = [
  { image: 177, canvasRenderer: 256, mask: 0, rectMask2D: 0, canvas: 83 },
  { image: 137, canvasRenderer: 158, mask: 0, rectMask2D: 0, canvas: 88 },
];
const componentKeys = ["image", "canvasRenderer", "mask", "rectMask2D", "canvas"];
for (const [prefabIndex, prefab] of extracted.prefabs.entries()) {
  const actual = Object.fromEntries(componentKeys.map((key) => [key, 0]));
  const pending = [...prefab.roots];
  while (pending.length) {
    const node = pending.pop();
    for (const componentKey of componentKeys) {
      const component = node[componentKey];
      if (!component) continue;
      actual[componentKey] += 1;
      assert.match(component.pathId, /^-?\d+$/);
      assert.match(component.objectSha256, /^[0-9a-f]{64}$/);
      if (COMPONENT_FIELDS[componentKey]) {
        assert.deepEqual(
          Object.keys(component),
          ["pathId", "objectSha256", ...COMPONENT_FIELDS[componentKey]],
          `${prefab.kind} ${componentKey} serialized field set changed`,
        );
      }
    }
    pending.push(...node.children);
  }
  assert.deepEqual(actual, EXPECTED_NODE_COUNTS[prefabIndex]);
}

const serialized = `${JSON.stringify(extracted, null, 1)}\n`;
if (check) {
  assert.equal(fs.readFileSync(OUTPUT, "utf8"), serialized, "card UI layout contract is stale");
  console.log("Official card UI layout contract audit OK");
} else {
  fs.writeFileSync(OUTPUT, serialized);
  console.log(`wrote ${path.relative(ROOT, OUTPUT)}`);
}
console.log([
  `  ${extracted.summary.rectTransformCount} RectTransforms`,
  `${extracted.summary.tmpComponentCount} TMP`,
  `${extracted.summary.tagFontSizeComponentCount} localized tag sizes`,
  `${extracted.summary.imageComponentCount} Images`,
  `${extracted.summary.canvasRendererComponentCount} CanvasRenderers`,
  `${extracted.summary.maskComponentCount} Masks`,
  `${extracted.summary.rectMask2DComponentCount} RectMask2Ds`,
  `${extracted.summary.canvasComponentCount} Canvases`,
].join(", "));
