export const DYNAMIC_UNIFORM_PRODUCER_SCHEMA =
  "pocket-card-render/dynamic-uniform-producer-binding@1";

export function bindDynamicUniformProducerContract(material, manifest) {
  const uniforms = manifest?.runtime_contract?.dynamic_uniforms;
  if (!uniforms || Object.keys(uniforms).length === 0) return material;
  material.userData.dynamicUniformProducerContract = {
    schema: DYNAMIC_UNIFORM_PRODUCER_SCHEMA,
    uniforms,
  };
  return material;
}
