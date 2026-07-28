import { defineMaterial } from "../registry.js";
import { buildExactRuntimeMaterial } from "./exact-runtime.js";

defineMaterial("exactRuntime", {
  requires: (recipe, ctx) => !!ctx.exactShaderPort(recipe),
  build: buildExactRuntimeMaterial,
});
