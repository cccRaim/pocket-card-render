import { selectExactShaderPorts } from "../context.js";

function manifestsFor(entry) {
  if (!entry || typeof entry !== "object") return [];
  if (Array.isArray(entry.manifests) && entry.manifests.length) return entry.manifests;
  return entry.manifest ? [entry.manifest] : [];
}

export function exactManifestHasActiveBloomOutput(manifest) {
  return (
    typeof manifest?.mrt?.emissive === "string"
    && manifest.mrt.emissive.length > 0
    && manifest.mrt.secondary_rgb === "active"
  );
}

export function exactShaderHasActiveBloomOutput(entry) {
  return manifestsFor(entry).some(exactManifestHasActiveBloomOutput);
}

export function sceneUsesExactBloomProducer(materials, exactShaders) {
  return Object.values(materials || {}).some((material) => (
    selectExactShaderPorts(exactShaders, material, material?.shader)
      .some((port) => exactManifestHasActiveBloomOutput(port.manifest))
  ));
}

export function sceneUsesBloomProducer(materials, exactShaders) {
  return sceneUsesExactBloomProducer(materials, exactShaders);
}
