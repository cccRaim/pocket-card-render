import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import {
  DYNAMIC_UI_COORDINATE_CONTRACT,
  createDynamicUIOrthographicCamera,
  createDynamicUIQuadGeometry,
  officialTmpMaterialPadding,
  packOfficialTmpUv,
} from "../public/render/tmp-sdf-renderer.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const app = fs.readFileSync(path.join(ROOT, "public", "app.js"), "utf8");
const renderer = fs.readFileSync(path.join(ROOT, "public", "render", "tmp-sdf-renderer.js"), "utf8");
const contract = JSON.parse(fs.readFileSync(path.join(ROOT, "public", "render", "card-font-contract.json"), "utf8"));

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

assert.match(app, /renderOfficialTmpDynamicTexture/);
assert.match(renderer, /THREE\.OneFactor/);
assert.match(renderer, /THREE\.OneMinusSrcAlphaFactor/);
assert.match(renderer, /outColor = vec4\(sampled\.rgb, 1\.0 - sampled\.a\)/);
assert.match(renderer, /loadOfficialTmpAtlasTexture/);
assert.doesNotMatch(app, /__uiflipy/);

console.log("official TMP SDF renderer contract: OK");
console.log(`  PackUV corners: 0, 511, ${511 * 4096}, ${511 * 4096 + 511}`);
console.log(`  CardName material padding: ${expectedPadding.toFixed(8)}`);
console.log("  DynamicUI orientation: Canvas-to-RT and RT-to-RT UV origins are distinct");
