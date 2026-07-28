import { auditFinalBlitBackendProof } from "./final-blit-backend-proof.mjs";

try {
  const result = auditFinalBlitBackendProof();
  console.log(
    `FinalBlit backend proof: ${result.exactObligations}/${result.totalObligations} exact`,
  );
  console.log(`sampler: ${result.obligations.samplerState.decoded.webgl2.minFilter}`
    + ` / ${result.obligations.samplerState.decoded.webgl2.wrapS}`);
} catch (error) {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
}
