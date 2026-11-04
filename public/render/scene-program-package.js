const safePath = /^(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+$/;

export function sceneProgramPackageOptions(directory, { audit = false, fetchAsset = globalThis.fetch } = {}) {
  if (directory === undefined) return {};
  if (typeof directory !== "string" || !safePath.test(directory)) {
    throw new Error("Invalid scene program package directory");
  }
  if (audit) throw new Error("Canonical capture requires the selected sample program contract");
  const contractUrl = "shaders/official_program_port_contract.json";
  let contract;
  return {
    contractUrl,
    fallbackContractUrl: null,
    fetchAsset(asset) {
      if (typeof asset !== "string" || !/^shaders\/(?:[\w-]+\/)*[\w.-]+\.(?:json|glsl)$/.test(asset)) {
        throw new Error("Invalid asset in scene program package");
      }
      const url = "/" + directory + "/" + asset;
      if (asset !== contractUrl) return fetchAsset(url);
      contract ??= fetchAsset(url);
      return contract.then(response => response.clone());
    },
  };
}
