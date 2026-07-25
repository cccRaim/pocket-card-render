function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function pointer(value) {
  return {
    fileId: finiteNumber(value?.fileId),
    pathId: String(value?.pathId ?? "0"),
  };
}

function color(value) {
  return [
    finiteNumber(value?.r, 1),
    finiteNumber(value?.g, 1),
    finiteNumber(value?.b, 1),
    finiteNumber(value?.a, 1),
  ];
}

export function compactOfficialUIImageState(image, canvasRenderer = null, provenance = {}) {
  if (!image) return null;
  return {
    imageObjectSha256: String(image.objectSha256 || ""),
    enabled: Boolean(image.m_Enabled),
    color: color(image.m_Color),
    material: pointer(image.m_Material),
    sprite: pointer(image.m_Sprite),
    type: finiteNumber(image.m_Type),
    preserveAspect: Boolean(image.m_PreserveAspect),
    fillCenter: Boolean(image.m_FillCenter),
    fillMethod: finiteNumber(image.m_FillMethod),
    fillAmount: finiteNumber(image.m_FillAmount, 1),
    fillClockwise: Boolean(image.m_FillClockwise),
    fillOrigin: finiteNumber(image.m_FillOrigin),
    useSpriteMesh: Boolean(image.m_UseSpriteMesh),
    pixelsPerUnitMultiplier: finiteNumber(image.m_PixelsPerUnitMultiplier, 1),
    canvasRenderer: canvasRenderer ? {
      objectSha256: String(canvasRenderer.objectSha256 || ""),
      cullTransparentMesh: Boolean(canvasRenderer.m_CullTransparentMesh),
    } : null,
    prefabGameObjectActive: Boolean(provenance.prefabGameObjectActive),
    prefabActiveInHierarchy: Boolean(provenance.prefabActiveInHierarchy),
    hierarchyOrder: finiteNumber(provenance.hierarchyOrder),
  };
}

export function resolveOfficialUIImageDrawState(element) {
  const state = element?.uiImage;
  if (!state) {
    return {
      visible: true,
      color: element?.color || null,
      fit: element?.fit || "stretch",
      evidence: "legacy-or-runtime-generated",
    };
  }
  if (state.type !== 0) {
    throw new Error(`unsupported official UGUI Image type ${state.type}`);
  }
  if (state.useSpriteMesh) {
    throw new Error("official UGUI Image useSpriteMesh is not implemented");
  }
  if (Math.abs(state.pixelsPerUnitMultiplier - 1) > 1e-6) {
    throw new Error(`unsupported official UGUI pixelsPerUnitMultiplier ${state.pixelsPerUnitMultiplier}`);
  }
  const tint = state.color.map(Number);
  return {
    visible: state.enabled && tint[3] > 0,
    color: tint,
    fit: state.preserveAspect ? "contain" : "stretch",
    evidence: "official-prefab-image",
  };
}
