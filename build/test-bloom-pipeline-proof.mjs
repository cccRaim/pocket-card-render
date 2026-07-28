import assert from "node:assert/strict";
import {
  evaluateBloomGraph,
  evaluateDirectColorWrite,
  evaluateFinalBlit,
  observeBloomPipeline,
} from "./bloom-pipeline-proof.mjs";

const observation = observeBloomPipeline();
assert.deepEqual(evaluateBloomGraph(observation), []);
assert.deepEqual(evaluateFinalBlit(observation), []);
assert.deepEqual(evaluateDirectColorWrite(observation), []);

const sequenceMutation = structuredClone(observation);
sequenceMutation.draws[3].pass = 4;
assert.match(evaluateBloomGraph(sequenceMutation).join("\n"), /pass sequence/);

const routeMutation = structuredClone(observation);
routeMutation.draws[10].target = "rt9";
assert.match(evaluateDirectColorWrite(routeMutation).join("\n"), /directly/);

const blendMutation = structuredClone(observation);
blendMutation.draws[10].state.blendDst = 0;
assert.match(evaluateDirectColorWrite(blendMutation).join("\n"), /blend state/);

const cullMutation = structuredClone(observation);
cullMutation.draws[4].state.side = 2;
assert.match(evaluateBloomGraph(cullMutation).join("\n"), /cull mapping/);

const depthMutation = structuredClone(observation);
depthMutation.draws[7].state.depthWrite = false;
assert.match(evaluateBloomGraph(depthMutation).join("\n"), /depthWrite/);

const finalTextureMutation = structuredClone(observation);
finalTextureMutation.draws[11].uniforms._BlitTexture = "scene.mrt1";
assert.match(evaluateFinalBlit(finalTextureMutation).join("\n"), /binding/);

const layoutMutation = structuredClone(observation);
layoutMutation.diagnostics.levels[2].weight = 0;
layoutMutation.draws[2].targetSize = [127, 227];
assert.match(evaluateBloomGraph(layoutMutation).join("\n"), /dimensions/);

const samplerStateMutation = structuredClone(observation);
samplerStateMutation.draws[11].state.sampler.TEXTURE_MIN_FILTER = "NEAREST";
assert.match(evaluateFinalBlit(samplerStateMutation).join("\n"), /sampler binding/);

const samplerLifetimeMutation = structuredClone(observation);
samplerLifetimeMutation.samplerEvents.pop();
assert.match(evaluateFinalBlit(samplerLifetimeMutation).join("\n"), /sampler lifetime/);

const samplerDiagnosticsMutation = structuredClone(observation);
samplerDiagnosticsMutation.diagnostics.finalBlitSampler.bindChecks = 0;
assert.match(evaluateFinalBlit(samplerDiagnosticsMutation).join("\n"), /sampler diagnostics/);

console.log("Bloom pipeline proof mutations: 10/10 passed");
