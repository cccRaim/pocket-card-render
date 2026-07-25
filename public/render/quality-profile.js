const FIXED_QUALITY_NAMES = new Set(["high", "middle", "low"]);

export function selectCardQualityProfile(requested, profiles, displaySide, maxTextureSize) {
  if (requested !== "auto" && !FIXED_QUALITY_NAMES.has(requested)) {
    throw new Error(`unsupported quality profile: ${requested}`);
  }
  if (!profiles?.high || !profiles?.middle || !profiles?.low) {
    throw new Error("official quality profiles are incomplete");
  }
  if (requested !== "auto") return profiles[requested];

  const middleSide = profiles.middle.source_render_target_request.width;
  const sourceSide = Math.min(maxTextureSize, Math.max(middleSide, Math.round(displaySide)));
  return {
    quality_name: "AutoNativeDisplay",
    quality_factor: sourceSide / middleSide,
    source_render_target_request: { width: sourceSide, height: sourceSide },
    evidence: "inspection-only-derived-from-drawing-buffer",
  };
}

export function selectDynamicUIRenderScale(requested, selectedProfile, profiles) {
  if (requested !== "auto") return 1;
  return selectedProfile.source_render_target_request.width
    / profiles.middle.source_render_target_request.width;
}
