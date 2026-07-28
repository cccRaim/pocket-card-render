import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  auditFinalBlitBackendProof,
  readOfficialFinalBlitEvidence,
  readOfficialInlineSamplerEvidence,
} from "./final-blit-backend-proof.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const vertexSource = fs.readFileSync(
  path.join(ROOT, "public/shaders/final_blit.vert.glsl"),
  "utf8",
);
const fragmentSource = fs.readFileSync(
  path.join(ROOT, "public/shaders/final_blit.frag.glsl"),
  "utf8",
);
const officialEvidence = readOfficialFinalBlitEvidence();
const inlineSamplerEvidence = readOfficialInlineSamplerEvidence();
const manifest = JSON.parse(fs.readFileSync(
  path.join(ROOT, "public/shaders/final_blit_program.json"),
  "utf8",
));
const options = {
  officialEvidence,
  inlineSamplerEvidence,
  manifest,
  vertexSource,
  fragmentSource,
};

const baseline = auditFinalBlitBackendProof(options);
assert.equal(baseline.status, "exact");
assert.equal(baseline.exactObligations, 6);
assert.equal(baseline.obligations.explicitLodPrecision.localRoundTripRelaxedPrecision, false);

assert.throws(
  () => auditFinalBlitBackendProof({
    ...options,
    fragmentSource: fragmentSource.replace("highp sampler2D", "mediump sampler2D"),
  }),
  /highp\s+sampler2D|mediump\s+sampler2D|RelaxedPrecision/,
);
assert.throws(
  () => auditFinalBlitBackendProof({
    ...options,
    fragmentSource: fragmentSource.replace("textureLod(", "texture("),
  }),
  /textureLod|exactly one texture operation/,
);
assert.throws(
  () => auditFinalBlitBackendProof({
    ...options,
    vertexSource: vertexSource.replace("& 1u", "& 2u"),
  }),
  /bit-0 extraction/,
);
assert.throws(
  () => auditFinalBlitBackendProof({
    ...options,
    scaleBias: [1, 0.5, 0, 0],
  }),
  /scaleY \+ 2\*biasY/,
);
assert.throws(
  () => auditFinalBlitBackendProof({
    ...options,
    vertexSource: vertexSource.replace("_30.z = _30.y;", "_30.z = 1.0 - _30.y;"),
  }),
  /_30\\\.z|match/,
);

const wrongBufferEvidence = structuredClone(officialEvidence);
wrongBufferEvidence.shaderProgram.pass.bindings.constantBuffers[0].size = 16;
assert.throws(
  () => auditFinalBlitBackendProof({
    ...options,
    officialEvidence: wrongBufferEvidence,
  }),
  /constant-buffer layout/,
);

const wrongSamplerEvidence = structuredClone(officialEvidence);
wrongSamplerEvidence.shaderProgram.pass.bindings.serializedSamplerStates[0].sampler = 84;
assert.throws(
  () => auditFinalBlitBackendProof({
    ...options,
    officialEvidence: wrongSamplerEvidence,
  }),
  /serialized sampler state/,
);

const wrongTextureBindingEvidence = structuredClone(officialEvidence);
wrongTextureBindingEvidence.shaderProgram.pass.bindings.samplers[0].dimension = 3;
assert.throws(
  () => auditFinalBlitBackendProof({
    ...options,
    officialEvidence: wrongTextureBindingEvidence,
  }),
  /texture binding/,
);

const wrongInlineSamplerEvidence = structuredClone(inlineSamplerEvidence);
wrongInlineSamplerEvidence.decoded.packedValue = 84;
assert.throws(
  () => auditFinalBlitBackendProof({
    ...options,
    inlineSamplerEvidence: wrongInlineSamplerEvidence,
  }),
  /inline sampler value/,
);

const wrongSamplerManifest = structuredClone(manifest);
wrongSamplerManifest.sampler_state.webgl2.minFilter = "NEAREST";
assert.throws(
  () => auditFinalBlitBackendProof({
    ...options,
    manifest: wrongSamplerManifest,
  }),
  /sampler mapping/,
);

console.log("FinalBlit backend proof mutations: 10/10 passed");
