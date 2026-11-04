function finitePair(value, label) {
  const x = Number(value?.x);
  const y = Number(value?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new Error(`${label} must contain finite x/y values`);
  }
  return [x, y];
}

export function textureTransformForBasis(conversion, texture, shaderTextureDescriptor = null) {
  if (conversion !== "unity-texenv" && conversion !== "unity-texenv-to-three-gltf-v") {
    throw new Error(`unsupported texture-coordinate conversion ${conversion}`);
  }
  if (texture == null) {
    if (shaderTextureDescriptor?.dimension !== 2
        || typeof shaderTextureDescriptor?.defaultName !== "string") {
      throw new Error("Unity texture transform has neither a Material TexEnv nor a 2D Shader default");
    }
    return [1, 1, 0, 0];
  }
  const [scaleX, scaleY] = finitePair(texture?.scale, "Unity texture scale");
  const [offsetX, offsetY] = finitePair(texture?.offset, "Unity texture offset");
  return [scaleX, scaleY, offsetX, conversion === "unity-texenv" ? offsetY : 1 - scaleY - offsetY];
}

export function unityTexEnvToThreeGltfSt(texture, shaderTextureDescriptor = null) {
  return textureTransformForBasis("unity-texenv-to-three-gltf-v", texture, shaderTextureDescriptor);
}
