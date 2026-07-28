import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import {
  DYNAMIC_UI_COORDINATE_CONTRACT,
  createDynamicUIOrthographicCamera,
  createDynamicUIQuadGeometry,
  createOfficialUIImageQuadGeometry,
  officialTmpMaterialPadding,
  packOfficialTmpUv,
} from "../public/render/tmp-sdf-renderer.js";
import { createOfficialUIRTMaterial } from "../public/render/official-ui-rt.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const app = fs.readFileSync(path.join(ROOT, "public", "app.js"), "utf8");
const renderer = fs.readFileSync(path.join(ROOT, "public", "render", "tmp-sdf-renderer.js"), "utf8");
const runtimeAudit = fs.readFileSync(path.join(ROOT, "build", "audit-tmp-runtime-evidence.mjs"), "utf8");
const contract = JSON.parse(fs.readFileSync(path.join(ROOT, "public", "render", "card-font-contract.json"), "utf8"));
const toRTManifest = JSON.parse(fs.readFileSync(path.join(ROOT, "public", "shaders", "ui_default_to_rt_program.json"), "utf8"));
const fromRTManifest = JSON.parse(fs.readFileSync(path.join(ROOT, "public", "shaders", "ui_default_from_rt_program.json"), "utf8"));

assert.equal(packOfficialTmpUv(0, 0), 0);
assert.equal(packOfficialTmpUv(0, 1), 511);
assert.equal(packOfficialTmpUv(1, 0), 511 * 4096);
assert.equal(packOfficialTmpUv(1, 1), 511 * 4096 + 511);
assert.equal(packOfficialTmpUv(0.5, 0.25), 255 * 4096 + 127);

const nameMaterial = contract.materials["5357336657525401712"];
const expectedPadding = Math.min(
  (nameMaterial.faceDilate + nameMaterial.outlineWidth + nameMaterial.outlineSoftness)
    * nameMaterial.scaleRatioA,
  1,
) * nameMaterial.gradientScale + 1.25;
assert.ok(Math.abs(officialTmpMaterialPadding(nameMaterial) - expectedPadding) < 1e-7);

assert.deepEqual(DYNAMIC_UI_COORDINATE_CONTRACT, {
  logicalOrigin: "top-left",
  logicalPositiveY: "down",
  renderTargetUvOrigin: "bottom-left",
  logicalTopRenderTargetV: 0,
  sources: {
    canvas: { textureFlipY: true, logicalTopSampleV: 1 },
    renderTarget: { textureFlipY: false, logicalTopSampleV: 0 },
  },
});
const logicalWidth = 100;
const logicalHeight = 200;
const camera = createDynamicUIOrthographicCamera(logicalWidth, logicalHeight);
const project = (x, y) => new THREE.Vector3(x, y, 0).project(camera).toArray().slice(0, 2);
assert.deepEqual(project(0, 0), [-1, -1], "logical top-left must write framebuffer v=0");
assert.deepEqual(project(logicalWidth, 0), [1, -1], "logical top-right must write framebuffer v=0");
assert.deepEqual(project(0, logicalHeight), [-1, 1], "logical bottom-left must write framebuffer v=1");
assert.deepEqual(project(logicalWidth, logicalHeight), [1, 1], "logical bottom-right must write framebuffer v=1");
assert.throws(() => createDynamicUIOrthographicCamera(0, logicalHeight), RangeError);

const quadUvs = (sourceKind) => {
  const geometry = createDynamicUIQuadGeometry(logicalWidth, logicalHeight, sourceKind);
  assert.equal(geometry.attributes.color.count, 4);
  assert.deepEqual(Array.from(geometry.attributes.color.array), new Array(16).fill(1));
  const uv = geometry.attributes.uv;
  const values = Array.from({ length: uv.count }, (_, index) => [uv.getX(index), uv.getY(index)]);
  geometry.dispose();
  return values;
};
assert.deepEqual(quadUvs("canvas"), [[0, 1], [0, 0], [1, 0], [1, 1]],
  "Canvas upload top is sampled at v=1");
assert.deepEqual(quadUvs("renderTarget"), [[0, 0], [0, 1], [1, 1], [1, 0]],
  "RT-to-RT pass must preserve logical top at v=0");
assert.throws(() => createDynamicUIQuadGeometry(logicalWidth, logicalHeight, "unknown"), RangeError);

const imageGeometry = createOfficialUIImageQuadGeometry({
  source: { width: 200, height: 100 },
  sourceRect: { x: 20, y: 10, width: 80, height: 40 },
  rect: { left: 12, top: 34, width: 56, height: 78 },
  color: [0.1, 0.2, 0.3, 0.4],
});
const attributeRows = (attribute) => Array.from(
  { length: attribute.count },
  (_, index) => Array.from(
    { length: attribute.itemSize },
    (__, component) => attribute.array[index * attribute.itemSize + component],
  ),
);
assert.deepEqual(attributeRows(imageGeometry.attributes.position), [
  [12, 34, 0],
  [12, 112, 0],
  [68, 112, 0],
  [68, 34, 0],
]);
const assertRowsClose = (actual, expected, epsilon = 1e-6) => {
  assert.equal(actual.length, expected.length);
  actual.forEach((row, rowIndex) => {
    assert.equal(row.length, expected[rowIndex].length);
    row.forEach((value, columnIndex) => assert.ok(
      Math.abs(value - expected[rowIndex][columnIndex]) <= epsilon,
      `${rowIndex},${columnIndex}: expected ${expected[rowIndex][columnIndex]}, got ${value}`,
    ));
  });
};
assertRowsClose(attributeRows(imageGeometry.attributes.uv), [
  [0.1, 0.9],
  [0.1, 0.5],
  [0.5, 0.5],
  [0.5, 0.9],
]);
for (const row of attributeRows(imageGeometry.attributes.color)) {
  row.forEach((value, index) => assert.ok(
    Math.abs(value - [0.1, 0.2, 0.3, 0.4][index]) < 1e-6,
  ));
}
assert.deepEqual(Array.from(imageGeometry.index.array), [0, 1, 2, 0, 2, 3]);
imageGeometry.dispose();
assert.throws(
  () => createOfficialUIImageQuadGeometry({
    source: { width: 0, height: 100 },
    rect: { left: 0, top: 0, width: 10, height: 10 },
  }),
  /positive source and destination dimensions/,
);

const texture = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
const shader = {
  vertexShader: fs.readFileSync(path.join(ROOT, "public", "shaders", "ui_default_to_rt.vert.glsl"), "utf8"),
  fragmentShader: fs.readFileSync(path.join(ROOT, "public", "shaders", "ui_default_to_rt.frag.glsl"), "utf8"),
};
const toRTMaterial = createOfficialUIRTMaterial({ ...shader, manifest: toRTManifest }, { texture });
const fromRTMaterial = createOfficialUIRTMaterial({
  vertexShader: fs.readFileSync(path.join(ROOT, "public", "shaders", "ui_default_from_rt.vert.glsl"), "utf8"),
  fragmentShader: fs.readFileSync(path.join(ROOT, "public", "shaders", "ui_default_from_rt.frag.glsl"), "utf8"),
  manifest: fromRTManifest,
}, { texture });
assert.equal(toRTMaterial.blendSrc, THREE.SrcAlphaFactor);
assert.equal(toRTMaterial.blendDst, THREE.OneMinusSrcAlphaFactor);
assert.equal(fromRTMaterial.blendSrc, THREE.OneFactor);
assert.equal(fromRTMaterial.blendDst, THREE.OneMinusSrcAlphaFactor);
assert.equal(toRTMaterial.userData.officialUIRTRole, "producer-to-render-texture");
assert.equal(fromRTMaterial.userData.officialUIRTRole, "display-from-render-texture");
toRTMaterial.dispose();
fromRTMaterial.dispose();
texture.dispose();

assert.match(app, /renderOfficialTmpDynamicTexture/);
assert.match(renderer, /THREE\.OneFactor/);
assert.match(renderer, /THREE\.OneMinusSrcAlphaFactor/);
assert.match(renderer, /createOfficialUIRTMaterial\(uiRTPrograms\.toRT/);
assert.match(renderer, /createOfficialUIRTMaterial\(uiRTPrograms\.fromRT/);
assert.doesNotMatch(renderer, /function fullscreenMaterial/u);
assert.match(renderer, /loadOfficialTmpAtlasTexture/);
assert.match(renderer, /hierarchyOrder - right\.hierarchyOrder/);
assert.match(renderer, /orderedDraws/);
assert.match(renderer, /Text:\s*17/);
assert.match(renderer, /Holo:\s*18/);
assert.match(renderer, /mesh\.layers\.set\(unityLayer\)/);
assert.match(renderer, /camera\.layers\.set\(unityLayer\)/);
assert.match(renderer, /\[\s*textSource,\s*ui\s*\]/);
assert.match(renderer, /\[\s*holoSource,\s*holo\s*\]/);
for (const target of ["textSource", "holoSource", "ui", "holo"]) {
  assert.match(renderer, new RegExp(`${target}: summarizeRenderTarget`));
  assert.match(runtimeAudit, new RegExp(`readback\\?\\.${target}`));
}
assert.doesNotMatch(runtimeAudit, /readback\?\.premultiplied/);
assert.match(app, /dynamicUITextMaterials/);
assert.match(app, /material\.uniforms\[uniformName\]\.value\s*=\s*t\.ui/);
assert.doesNotMatch(app, /__uiflipy/);

console.log("official TMP SDF renderer contract: OK");
console.log(`  PackUV corners: 0, 511, ${511 * 4096}, ${511 * 4096 + 511}`);
console.log(`  CardName material padding: ${expectedPadding.toFixed(8)}`);
console.log("  DynamicUI orientation: Canvas-to-RT and RT-to-RT UV origins are distinct");
console.log("  Official Image crop, UV, tint and hierarchy draw evidence: exact local contract");
