import * as THREE from "three";

const WRAP_MODE = {
  0: THREE.RepeatWrapping,
  1: THREE.ClampToEdgeWrapping,
  2: THREE.MirroredRepeatWrapping,
};

export function applyOfficialSampler(texture, state) {
  const filterMode = state?.filterMode ?? 1;
  const mipCount = state?.mipCount ?? 1;
  const point = filterMode === 0;
  texture.magFilter = point ? THREE.NearestFilter : THREE.LinearFilter;
  if (mipCount > 1) {
    texture.generateMipmaps = false;
    texture.minFilter = point
      ? THREE.NearestMipmapNearestFilter
      : filterMode === 2 ? THREE.LinearMipmapLinearFilter : THREE.LinearMipmapNearestFilter;
  } else {
    texture.generateMipmaps = false;
    texture.minFilter = point ? THREE.NearestFilter : THREE.LinearFilter;
  }
  texture.wrapS = WRAP_MODE[state?.wrapU] || THREE.ClampToEdgeWrapping;
  texture.wrapT = WRAP_MODE[state?.wrapV] || THREE.ClampToEdgeWrapping;
  texture.anisotropy = Math.max(1, state?.anisotropy ?? 1);
  texture.userData.officialSampler = state || null;
}

function configureOfficialTexture(texture, samplerState) {
  texture.colorSpace = THREE.NoColorSpace;
  texture.flipY = false;
  texture.premultiplyAlpha = false;
  texture.unpackAlignment = 1;
  applyOfficialSampler(texture, samplerState);
  return texture;
}

function validateMipChain(buffer, chain, samplerState) {
  if (!chain || chain.encoding !== "rgba8-mip-chain-v1") {
    throw new Error("official RGBA8 mip chain metadata is missing or unsupported");
  }
  if (buffer.byteLength !== chain.byteLength) {
    throw new Error(`official mip byte length mismatch: expected ${chain.byteLength}, got ${buffer.byteLength}`);
  }
  if (chain.levels.length !== samplerState.mipCount) {
    throw new Error(`official mip level count mismatch: expected ${samplerState.mipCount}, got ${chain.levels.length}`);
  }
  let offset = 0;
  for (let index = 0; index < chain.levels.length; index += 1) {
    const level = chain.levels[index];
    const expectedLength = level.width * level.height * 4;
    if (level.level !== index || level.offset !== offset || level.length !== expectedLength) {
      throw new Error(`invalid official mip descriptor at level ${index}`);
    }
    offset += level.length;
  }
  if (offset !== buffer.byteLength) throw new Error("official mip descriptors do not consume the fallback payload");
}

async function loadOfficialMipTexture(samplerState) {
  const chain = samplerState?.fallback?.rgba8MipChain;
  const response = await fetch(chain.url);
  if (!response.ok) throw new Error(`official mip texture load failed: ${chain.url} HTTP ${response.status}`);
  const buffer = await response.arrayBuffer();
  validateMipChain(buffer, chain, samplerState);
  const mipmaps = chain.levels.map((level) => ({
    data: new Uint8Array(buffer, level.offset, level.length),
    width: level.width,
    height: level.height,
  }));
  const base = mipmaps[0];
  const texture = new THREE.DataTexture(
    base.data,
    base.width,
    base.height,
    THREE.RGBAFormat,
    THREE.UnsignedByteType,
  );
  texture.mipmaps = mipmaps;
  configureOfficialTexture(texture, samplerState);
  texture.userData.officialMipFallback = chain;
  texture.needsUpdate = true;
  return texture;
}

function loadOfficialImageTexture(url, samplerState) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => {
      const texture = new THREE.Texture(image);
      configureOfficialTexture(texture, samplerState);
      texture.needsUpdate = true;
      resolve(texture);
    };
    image.onerror = () => reject(new Error(`texture load failed: ${url}`));
    image.src = url;
  });
}

export function loadOfficialTexture(url, samplerState) {
  const mipCount = samplerState?.mipCount ?? 1;
  if (samplerState?.fallback?.rgba8MipChain) {
    return loadOfficialMipTexture(samplerState).then((texture) => {
      texture.userData.sourceUrl = url;
      return texture;
    });
  }
  if (mipCount > 1) {
    return Promise.reject(new Error(`official mip fallback metadata missing: ${url}`));
  }
  return loadOfficialImageTexture(url, samplerState).then((texture) => {
    texture.userData.sourceUrl = url;
    return texture;
  });
}
