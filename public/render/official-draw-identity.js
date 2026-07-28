function requireNonemptyString(value, field) {
  if (typeof value !== "string" || !value) {
    throw new TypeError(`official draw ${field} must be a non-empty string`);
  }
  return value;
}

function nodeMaterialKey(nodePath, materialName) {
  return `${nodePath}\u0000${materialName}`;
}

export function buildOfficialDrawIdentityIndex(draws) {
  if (!Array.isArray(draws)) {
    throw new TypeError("official draw identity table must be an array");
  }
  const byMaterial = new Map();
  const byNodeMaterial = new Map();
  for (const draw of draws) {
    const drawId = requireNonemptyString(draw?.drawId, "drawId");
    const nodePath = requireNonemptyString(draw?.goPath, `${drawId}.goPath`);
    const materialName = requireNonemptyString(
      draw?.materialName,
      `${drawId}.materialName`,
    );
    if (!byMaterial.has(materialName)) byMaterial.set(materialName, []);
    byMaterial.get(materialName).push(draw);
    const key = nodeMaterialKey(nodePath, materialName);
    if (!byNodeMaterial.has(key)) byNodeMaterial.set(key, []);
    byNodeMaterial.get(key).push(draw);
  }
  return Object.freeze({ byMaterial, byNodeMaterial });
}

export function resolveOfficialDrawIdentity(index, nodePath, materialName) {
  if (!(index?.byMaterial instanceof Map)
      || !(index?.byNodeMaterial instanceof Map)) {
    throw new TypeError("invalid official draw identity index");
  }
  const normalizedPath = requireNonemptyString(nodePath, "source node path");
  const normalizedMaterial = requireNonemptyString(
    materialName,
    "source material name",
  );
  const exactMatches = index.byNodeMaterial.get(
    nodeMaterialKey(normalizedPath, normalizedMaterial),
  ) || [];
  if (exactMatches.length > 1) {
    throw new Error(
      `${normalizedPath}:${normalizedMaterial} maps to multiple official draw identities`,
    );
  }
  if (exactMatches.length === 1) {
    return Object.freeze({
      draw: exactMatches[0],
      nodePath: normalizedPath,
      resolution: "exact-node-material",
      candidateIds: Object.freeze([]),
    });
  }

  const candidates = index.byMaterial.get(normalizedMaterial) || [];
  if (candidates.length === 1) {
    // AssetRipper can flatten or rename a source node. A single official draw
    // for the serialized Material remains an identity join; occurrence order
    // is never used when more than one candidate exists.
    return Object.freeze({
      draw: candidates[0],
      nodePath: normalizedPath,
      resolution: "unique-material-candidate",
      candidateIds: Object.freeze([]),
    });
  }
  return Object.freeze({
    draw: null,
    nodePath: normalizedPath,
    resolution: "unresolved",
    candidateIds: Object.freeze(candidates.map((draw) => draw.drawId)),
  });
}
