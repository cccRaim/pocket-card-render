export const STENCIL_REGION_CONTRACT_SCHEMA =
  "pocket-card-render/stencil-region-binding@1";

// The official writers use independent bits: OuterStencil writes bit 0 and
// InnerStencil writes bit 1. A window pixel therefore contains both bits.
export const STENCIL_REGION_BITS = Object.freeze({
  card: 1,
  window: 2,
});

export const STENCIL_BUFFER_VALUES = Object.freeze({
  outside: 0,
  card: STENCIL_REGION_BITS.card,
  window: STENCIL_REGION_BITS.card | STENCIL_REGION_BITS.window,
});

function selectorUsesStencilRef(contract) {
  if (!contract) return true;
  return contract.stencil?.ref?.name === "_StencilRef"
    && contract.stencil?.read_mask?.name === "_StencilRef";
}

/**
 * Scene `clip` is the renderer-level region assignment. The serialized
 * Material often leaves _StencilRef at zero; the runtime binding supplies the
 * bit consumed by selector passes whose ref and read mask share that property.
 */
export function resolveStencilRegionBinding(recipe, officialPassRuntime = null) {
  const region = recipe?.clip;
  const bit = STENCIL_REGION_BITS[region];
  if (!bit || !Object.hasOwn(recipe?.floats || {}, "_StencilRef")
      || !selectorUsesStencilRef(officialPassRuntime)) {
    return null;
  }
  return Object.freeze({
    schema: STENCIL_REGION_CONTRACT_SCHEMA,
    region,
    property: "_StencilRef",
    value: bit,
    source: "scene-clip-and-official-stencil-writer-bits",
    evidenceLevel: "inferred-runtime-material-override",
  });
}

export function resolveStencilRegionFloats(recipe, officialPassRuntime = null) {
  const binding = resolveStencilRegionBinding(recipe, officialPassRuntime);
  return {
    binding,
    floats: binding
      ? { ...(recipe?.floats || {}), [binding.property]: binding.value }
      : (recipe?.floats || {}),
  };
}
