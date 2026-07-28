import {
  evaluateBloomPipelineProof,
  observeBloomPipeline,
} from "./bloom-pipeline-proof.mjs";

const result = evaluateBloomPipelineProof(observeBloomPipeline());
const issues = Object.entries(result).flatMap(([scope, rows]) =>
  rows.map((issue) => `${scope}: ${issue}`));

if (issues.length) {
  console.error(`Bloom pipeline proof failed: ${issues.length} issue(s)`);
  for (const issue of issues) console.error(`BAD ${issue}`);
  process.exit(1);
}

console.log("Bloom pipeline proof OK");
console.log("draws: 11 Bloom + 1 FinalBlit; source MRT1 -> pass 0; pass 5 -> scene ColorRT");
