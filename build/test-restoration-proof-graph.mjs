import assert from "node:assert/strict";
import {
  evaluatePipelineProof,
  validatePipelineProofGraph,
} from "./restoration-proof-graph.mjs";

const stage = Object.freeze({
  id: "example",
  coveredSubscopes: 3,
  totalSubscopes: 3,
});

const inventoryOnly = evaluatePipelineProof({
  stage,
  proofNodes: [],
  verifierPassed: () => true,
});
assert.equal(inventoryOnly.exactUnits, 0);
assert.equal(inventoryOnly.knownUnits, 3);
assert.equal(inventoryOnly.status, "inferred");

const oneExplicitClaim = evaluatePipelineProof({
  stage,
  proofNodes: [{ id: "example.claim-a", verifiers: ["claim-a"] }],
  verifierPassed: (name) => name === "claim-a",
});
assert.equal(oneExplicitClaim.exactUnits, 1);
assert.equal(oneExplicitClaim.knownUnits, 3);
assert.equal(oneExplicitClaim.status, "partial-exact");

const failedClaim = evaluatePipelineProof({
  stage,
  proofNodes: [{ id: "example.claim-a", verifiers: ["claim-a"] }],
  verifierPassed: () => false,
});
assert.equal(failedClaim.exactUnits, 0);
assert.equal(failedClaim.status, "inferred");

const complete = evaluatePipelineProof({
  stage,
  proofNodes: [
    { id: "example.claim-a", verifiers: ["claim-a"] },
    { id: "example.claim-b", verifiers: ["claim-b"] },
    { id: "example.claim-c", verifiers: ["claim-c"] },
  ],
  verifierPassed: () => true,
});
assert.equal(complete.exactUnits, 3);
assert.equal(complete.status, "exact");

assert.throws(() => validatePipelineProofGraph({
  first: [{ id: "duplicate", verifiers: ["a"] }],
  second: [{ id: "duplicate", verifiers: ["b"] }],
}), /duplicate pipeline proof node id/);

assert.throws(() => evaluatePipelineProof({
  stage,
  proofNodes: [
    { id: "a", verifiers: ["a"] },
    { id: "b", verifiers: ["b"] },
    { id: "c", verifiers: ["c"] },
    { id: "d", verifiers: ["d"] },
  ],
  verifierPassed: () => true,
}), /more proof nodes than denominator units/);

console.log("restoration pipeline proof graph: 11/11 passed");
