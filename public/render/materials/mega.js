import * as THREE from "three";
import { defineMaterial } from "../registry.js";
import { buildExactRuntimeMaterial } from "./exact-runtime.js";

function exactMegaMaterial(recipe, ctx) {
  return buildExactRuntimeMaterial(recipe, ctx, { side: THREE.FrontSide });
}

for (const kind of [
  "megaEffectEmit",
  "megaShadowFlash",
  "megaParallaxMrr",
  "megaParallaxFlash",
  "megaShadowboxEffectFlow",
  "megaAura",
  "megaParallaxTranslate",
  "megaFlipOutline",
]) {
  defineMaterial(kind, {
    requires: (recipe, ctx) => !!ctx.exactShaderPort(recipe),
    build: exactMegaMaterial,
  });
}
