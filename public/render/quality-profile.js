const FIXED_QUALITY_NAMES = new Set(["high", "middle", "low"]);

export const DEFAULT_INSPECTION_QUALITY = "auto";

export function resolveRequestedCardQuality(
  requested,
  {
    runtimeEvidence = false,
    runtimeDefaultQuality = "middle",
  } = {},
) {
  const explicit = typeof requested === "string"
    ? requested.trim().toLowerCase()
    : "";
  const officialRuntimeDefault = typeof runtimeDefaultQuality === "string"
    ? runtimeDefaultQuality.trim().toLowerCase()
    : "";
  if (runtimeEvidence) {
    if (!FIXED_QUALITY_NAMES.has(officialRuntimeDefault)) {
      throw new Error(`unsupported runtime quality profile: ${runtimeDefaultQuality}`);
    }
    if (explicit && explicit !== officialRuntimeDefault) {
      throw new Error(
        `runtime evidence quality must be ${officialRuntimeDefault}, received ${explicit}`,
      );
    }
    return officialRuntimeDefault;
  }
  return explicit || DEFAULT_INSPECTION_QUALITY;
}

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
