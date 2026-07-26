import assert from "node:assert/strict";
import {
  LOGIC_BISECT_CASES,
  LOGIC_BISECT_SCHEMA,
  logicBisectCaseUrl,
  resolveLogicBisectCase,
} from "../public/render/logic-bisect.js";

assert.equal(LOGIC_BISECT_SCHEMA, "pocket-card-render/logic-bisect@1");
assert.equal(new Set(LOGIC_BISECT_CASES.map(({ id }) => id)).size, LOGIC_BISECT_CASES.length);
assert.equal(resolveLogicBisectCase("missing").id, "baseline");
assert.equal(resolveLogicBisectCase("parallax-static-uv").freezeParallaxUv, true);
assert.deepEqual(resolveLogicBisectCase("parallax-fallback").disableExactShaders, ["Card_Parallax"]);
assert.equal(resolveLogicBisectCase("post-half-off").disableBloom, true);
assert.equal(resolveLogicBisectCase("post-half-off").bypassHomography, true);
assert.deepEqual(resolveLogicBisectCase("draw-half-off").disableExactShaders, ["Card_Parallax"]);
assert.equal(resolveLogicBisectCase("draw-half-off").freezeParallaxUv, true);
assert.equal(resolveLogicBisectCase("draw-half-off").disableParallaxDepthWrite, true);
assert.equal(resolveLogicBisectCase("draw-half-off").disableParallaxStencil, true);
assert.equal(resolveLogicBisectCase("raster-sampling-half").sourceRenderScale, 2);
assert.equal(resolveLogicBisectCase("raster-sampling-half").forceParallaxLowpass, true);
assert.equal(resolveLogicBisectCase("uv-input-half").forceParallaxUv0, true);
assert.equal(resolveLogicBisectCase("hide-parallax-draws").hideParallaxDraws, true);
assert.equal(resolveLogicBisectCase("all-no-depth").disableAllDepth, true);
assert.equal(
  resolveLogicBisectCase("canonical-object-clip").canonicalizeObjectClipPosition,
  true,
);
assert.equal(
  resolveLogicBisectCase("raw-object-clip").disableCanonicalObjectClipPosition,
  true,
);
assert.equal(resolveLogicBisectCase("bisect-nonparallax").excludeParallaxFromBisect, true);
assert.equal(resolveLogicBisectCase("bisect-effects").bisectEffectDraws, true);

const next = new URL(logicBisectCaseUrl(
  "http://127.0.0.1:8011/?scene=scene.test.json&lc=zh_TW&bisect=1",
  "no-bloom",
));
assert.equal(next.searchParams.get("scene"), "scene.test.json");
assert.equal(next.searchParams.get("lc"), "zh_TW");
assert.equal(next.searchParams.get("logicbisect"), "1");
assert.equal(next.searchParams.get("logiccase"), "no-bloom");
assert.equal(next.searchParams.has("bisect"), false);

console.log("logic bisection: cases and clean reload URLs verified");
