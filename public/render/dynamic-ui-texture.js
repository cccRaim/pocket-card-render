import * as THREE from "three";
import { applyOfficialSampler } from "./official-texture.js";

export function encodeOfficialHoloDynamicPixels(source) {
  const encoded = new Uint8Array(source.length);
  for (let offset = 0; offset < source.length; offset += 4) {
    const alpha = source[offset + 3];
    encoded[offset] = Math.round(source[offset] * alpha / 255);
    encoded[offset + 1] = Math.round(source[offset + 1] * alpha / 255);
    encoded[offset + 2] = Math.round(source[offset + 2] * alpha / 255);
    encoded[offset + 3] = 255 - alpha;
  }
  return encoded;
}

export function createOfficialHoloDynamicTexture(imageData, samplerState) {
  const texture = new THREE.DataTexture(
    encodeOfficialHoloDynamicPixels(imageData.data),
    imageData.width,
    imageData.height,
    THREE.RGBAFormat,
    THREE.UnsignedByteType,
  );
  texture.colorSpace = THREE.NoColorSpace;
  texture.flipY = false;
  texture.premultiplyAlpha = false;
  texture.unpackAlignment = 1;
  applyOfficialSampler(texture, samplerState);
  texture.needsUpdate = true;
  return texture;
}
