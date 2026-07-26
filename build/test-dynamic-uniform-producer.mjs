import assert from "node:assert/strict";
import test from "node:test";
import {
  bindDynamicUniformProducerContract,
  DYNAMIC_UNIFORM_PRODUCER_SCHEMA,
} from "../public/render/dynamic-uniform-producer.js";
import { verifyDynamicUniformBindings } from "./official-port-verifier-lib.mjs";

const dynamicUniforms = {
  _FlowParams: {
    type: "vec4[2]",
    source: "GlitterFlowMaps.Update/Material.SetVectorArray",
  },
};

test("material binding records the manifest-owned dynamic producer contract", () => {
  const material = { userData: {} };
  bindDynamicUniformProducerContract(material, {
    runtime_contract: { dynamic_uniforms: dynamicUniforms },
  });
  assert.deepEqual(material.userData.dynamicUniformProducerContract, {
    schema: DYNAMIC_UNIFORM_PRODUCER_SCHEMA,
    uniforms: dynamicUniforms,
  });
});

test("runtime verifier closes array type, size, contract and uploaded value", () => {
  const values = [[1, 2, 3, 4], [5, 6, 7, 8]];
  const producerContract = {
    schema: DYNAMIC_UNIFORM_PRODUCER_SCHEMA,
    uniforms: dynamicUniforms,
  };
  const programUniforms = new Map([["_FlowParams", {
    type: "0x8b52",
    size: 2,
    value: values,
  }]]);
  assert.deepEqual(verifyDynamicUniformBindings({
    contract: dynamicUniforms,
    producerContract,
    materialUniforms: { _FlowParams: values },
    programUniforms,
  }), []);

  assert.match(verifyDynamicUniformBindings({
    contract: dynamicUniforms,
    producerContract: { ...producerContract, uniforms: {} },
    materialUniforms: { _FlowParams: values },
    programUniforms,
  }).join("\n"), /producer contract mismatch/);
  assert.match(verifyDynamicUniformBindings({
    contract: dynamicUniforms,
    producerContract,
    materialUniforms: { _FlowParams: [[0, 0, 0, 0], [0, 0, 0, 0]] },
    programUniforms,
  }).join("\n"), /upload mismatch/);
  assert.match(verifyDynamicUniformBindings({
    contract: dynamicUniforms,
    producerContract,
    materialUniforms: { _FlowParams: values },
    programUniforms: new Map([["_FlowParams", { type: "0x8b52", size: 1, value: values }]]),
  }).join("\n"), /type mismatch/);
});

test("OfficialClock remains value-bound in addition to generic upload verification", () => {
  const contract = { uTime: { type: "float", source: "official-clock" } };
  const producerContract = {
    schema: DYNAMIC_UNIFORM_PRODUCER_SCHEMA,
    uniforms: contract,
  };
  const programUniforms = new Map([["uTime", { type: "0x1406", size: 1, value: 2 }]]);
  assert.deepEqual(verifyDynamicUniformBindings({
    contract,
    producerContract,
    materialUniforms: { uTime: 2 },
    programUniforms,
    officialTime: 2,
  }), []);
  assert.match(verifyDynamicUniformBindings({
    contract,
    producerContract,
    materialUniforms: { uTime: 2 },
    programUniforms,
    officialTime: 3,
  }).join("\n"), /OfficialClock/);
});
