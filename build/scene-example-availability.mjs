import { stat } from "node:fs/promises";
import path from "node:path";

export function gameAssetRelativePath(url) {
  const raw = String(url || "").replace(/^\/game\/+/, "");
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export function collectGameAssetUrls(value, result = new Set()) {
  if (typeof value === "string") {
    if (value.startsWith("/game/")) result.add(value);
    return result;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectGameAssetUrls(item, result);
    return result;
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value)) collectGameAssetUrls(item, result);
  }
  return result;
}

export async function sceneExampleAvailability(data, publicRoot) {
  const referencedAssets = [...collectGameAssetUrls(data)].sort();
  const missingAssets = [];
  await Promise.all(referencedAssets.map(async (url) => {
    const file = path.join(
      publicRoot,
      "game",
      gameAssetRelativePath(url),
    );
    const info = await stat(file).catch(() => null);
    if (!info?.isFile()) missingAssets.push(url);
  }));
  const declaredMissing = Array.isArray(data._missing)
    ? data._missing.map(String)
    : ["scene-missing-list-absent"];
  const reasonCodes = [];
  if (declaredMissing.length) reasonCodes.push("scene-declared-missing");
  if (missingAssets.length) reasonCodes.push("gathered-assets-missing");
  return {
    status: reasonCodes.length ? "unavailable" : "prebuilt",
    selectable: reasonCodes.length === 0,
    referencedAssetCount: referencedAssets.length,
    missingAssetCount: missingAssets.length,
    declaredMissingCount: declaredMissing.length,
    reasonCodes,
  };
}
