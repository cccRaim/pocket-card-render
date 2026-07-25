function clampInteger(value, minimum, maximum) {
  const numeric = Number.isFinite(value) ? Math.trunc(value) : minimum;
  return Math.min(maximum, Math.max(minimum, numeric));
}

export function validatePipelineProofGraph(graph) {
  const seen = new Set();
  for (const [stageId, nodes] of Object.entries(graph)) {
    if (!Array.isArray(nodes)) {
      throw new Error(`pipeline proof nodes for ${stageId} must be an array`);
    }
    for (const node of nodes) {
      if (!node || typeof node.id !== "string" || node.id.length === 0) {
        throw new Error(`pipeline proof node in ${stageId} has no stable id`);
      }
      if (seen.has(node.id)) {
        throw new Error(`duplicate pipeline proof node id: ${node.id}`);
      }
      seen.add(node.id);
      if (!Array.isArray(node.verifiers) || node.verifiers.length === 0) {
        throw new Error(`pipeline proof node ${node.id} has no verifier`);
      }
      if (node.verifiers.some((name) => typeof name !== "string" || name.length === 0)) {
        throw new Error(`pipeline proof node ${node.id} has an invalid verifier name`);
      }
    }
  }
  return graph;
}

export function evaluatePipelineProof({ stage, proofNodes = [], verifierPassed }) {
  if (!stage || !Number.isInteger(stage.totalSubscopes) || stage.totalSubscopes <= 0) {
    throw new Error("pipeline stage must have a positive integer totalSubscopes");
  }
  if (proofNodes.length > stage.totalSubscopes) {
    throw new Error(`${stage.id || "pipeline stage"} has more proof nodes than denominator units`);
  }
  if (typeof verifierPassed !== "function") {
    throw new Error("pipeline proof evaluation requires verifierPassed");
  }

  const passed = [];
  const failed = [];
  for (const node of proofNodes) {
    const exact = node.verifiers.every((name) => verifierPassed(name));
    (exact ? passed : failed).push(node);
  }

  const exactUnits = passed.length;
  const inventoryKnownUnits = clampInteger(stage.coveredSubscopes, 0, stage.totalSubscopes);
  const knownUnits = Math.max(exactUnits, inventoryKnownUnits);
  const status = exactUnits === stage.totalSubscopes
    ? "exact"
    : exactUnits > 0
      ? "partial-exact"
      : knownUnits > 0 ? "inferred" : "unknown";

  return Object.freeze({
    status,
    exactUnits,
    knownUnits,
    passed: Object.freeze(passed),
    failed: Object.freeze(failed),
    unmodeledUnits: stage.totalSubscopes - proofNodes.length,
  });
}
