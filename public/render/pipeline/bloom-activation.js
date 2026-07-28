import { selectExactShaderPorts } from "../context.js";
import { resolveRuntimeMaterialDispatch } from "../runtime-dispatch-contract.js";

function manifestsFor(entry) {
  if (!entry || typeof entry !== "object") return [];
  if (Array.isArray(entry.manifests) && entry.manifests.length) return entry.manifests;
  return entry.manifest ? [entry.manifest] : [];
}

export function exactManifestHasActiveBloomOutput(manifest) {
  const mrt = manifest?.mrt;
  if (!mrt || typeof mrt !== "object") return false;
  if (mrt.emissive_value === "alpha-only") return false;
  if (Array.isArray(mrt.secondary_value)
      && mrt.secondary_value.slice(0, 3).every((value) => Number(value) === 0)) {
    return false;
  }
  if (mrt.secondary_value === "zero") return false;
  if (mrt.secondary_value === "emissive-rgb") return true;
  if (typeof mrt.secondary_rgb === "string") {
    return !["zero", "inactive", "alpha-only"].includes(mrt.secondary_rgb);
  }
  return typeof mrt.emissive === "string" && mrt.emissive.length > 0;
}

export function exactShaderHasActiveBloomOutput(entry) {
  return manifestsFor(entry).some(exactManifestHasActiveBloomOutput);
}

export function sceneUsesExactBloomProducer(materials, exactShaders, runtimeDispatchIndex) {
  return Object.values(materials || {}).some((material) => {
    const runtimeDispatch = resolveRuntimeMaterialDispatch(runtimeDispatchIndex, material);
    if (!runtimeDispatch) return false;
    return selectExactShaderPorts(exactShaders, { ...material, runtimeDispatch })
      .some((port) => exactManifestHasActiveBloomOutput(port.manifest));
  });
}

export function sceneUsesBloomProducer(materials, exactShaders, runtimeDispatchIndex) {
  return sceneUsesExactBloomProducer(materials, exactShaders, runtimeDispatchIndex);
}
