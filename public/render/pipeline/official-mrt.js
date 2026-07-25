import * as THREE from "three";

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

// Official Shader pass data has rtSeparateBlend=false. Both attachments use
// the active RT0 material state; serialized rtBlend1 is an inactive default.
export const OFFICIAL_MRT_DESCRIPTOR = deepFreeze({
  api: "WebGL2",
  threeRevision: "165",
  count: 2,
  color: {
    format: "RGBAFormat",
    internalFormat: "RGBA8",
    type: "UnsignedByteType",
    colorSpace: "NoColorSpace",
    minFilter: "NearestFilter",
    magFilter: "NearestFilter",
    generateMipmaps: false,
  },
  colorAttachments: [
    { name: "sceneColor", activeBlend: "rtBlend0" },
    { name: "emissive", activeBlend: "rtBlend0" },
  ],
  rtSeparateBlend: false,
  depthStencil: {
    depthBuffer: true,
    stencilBuffer: true,
    internalFormat: "DEPTH24_STENCIL8",
  },
  samples: 0,
});

const THREE_ENUMS = {
  RGBAFormat: THREE.RGBAFormat,
  UnsignedByteType: THREE.UnsignedByteType,
  NoColorSpace: THREE.NoColorSpace,
  NearestFilter: THREE.NearestFilter,
};
const targetState = new WeakMap();

function assertPositiveInteger(value, label) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive integer; got ${value}`);
  }
}

function resolveThreeEnum(name, label) {
  if (!Object.hasOwn(THREE_ENUMS, name)) throw new TypeError(`Unsupported ${label}: ${name}`);
  return THREE_ENUMS[name];
}

function validateDescriptor(descriptor) {
  if (!descriptor || typeof descriptor !== "object") throw new TypeError("MRT descriptor must be an object");
  assertPositiveInteger(descriptor.count, "MRT attachment count");
  if (descriptor.colorAttachments?.length !== descriptor.count) {
    throw new RangeError(`MRT descriptor count ${descriptor.count} does not match its attachments`);
  }
  if (descriptor.rtSeparateBlend !== false) {
    throw new TypeError("Official MRT requires rtSeparateBlend=false");
  }
  if (descriptor.depthStencil?.internalFormat !== "DEPTH24_STENCIL8") {
    throw new TypeError(`Unsupported depth/stencil format: ${descriptor.depthStencil?.internalFormat}`);
  }
  if (descriptor.samples !== 0) throw new TypeError(`This MRT path requires samples=0; got ${descriptor.samples}`);
  return descriptor;
}

function contextFrom(source) {
  if (source && typeof source.getContext === "function") return source.getContext();
  if (source && typeof source.getParameter === "function") return source;
  return null;
}

function looksLikeWebGL2(gl) {
  return !!(
    gl
    && typeof gl.drawBuffers === "function"
    && typeof gl.readBuffer === "function"
    && typeof gl.texStorage2D === "function"
    && typeof gl.createVertexArray === "function"
  );
}

export function inspectOfficialMrtCapabilities(source, descriptor = OFFICIAL_MRT_DESCRIPTOR) {
  validateDescriptor(descriptor);
  const gl = contextFrom(source);
  const isWebGL2 = looksLikeWebGL2(gl);
  const maxDrawBuffers = isWebGL2 ? gl.getParameter(gl.MAX_DRAW_BUFFERS) : 0;
  const maxColorAttachments = isWebGL2 ? gl.getParameter(gl.MAX_COLOR_ATTACHMENTS) : 0;
  const revisionMatches = String(THREE.REVISION) === String(descriptor.threeRevision);
  const failures = [];
  if (!gl) failures.push("no WebGL context");
  else if (!isWebGL2) failures.push("WebGL2 is required");
  if (maxDrawBuffers < descriptor.count) failures.push(`MAX_DRAW_BUFFERS=${maxDrawBuffers}, need ${descriptor.count}`);
  if (maxColorAttachments < descriptor.count) failures.push(`MAX_COLOR_ATTACHMENTS=${maxColorAttachments}, need ${descriptor.count}`);
  if (!revisionMatches) failures.push(`three.js revision is ${THREE.REVISION}, expected ${descriptor.threeRevision}`);
  return Object.freeze({
    supported: failures.length === 0,
    isWebGL2,
    requiredColorAttachments: descriptor.count,
    maxDrawBuffers,
    maxColorAttachments,
    threeRevision: String(THREE.REVISION),
    expectedThreeRevision: String(descriptor.threeRevision),
    revisionMatches,
    failures: Object.freeze(failures),
  });
}

export function assertOfficialMrtCapabilities(source, descriptor = OFFICIAL_MRT_DESCRIPTOR) {
  const capabilities = inspectOfficialMrtCapabilities(source, descriptor);
  if (!capabilities.supported) throw new Error(`Official MRT unavailable: ${capabilities.failures.join("; ")}`);
  return capabilities;
}

export function createOfficialMrtTarget(renderer, width, height, descriptor = OFFICIAL_MRT_DESCRIPTOR) {
  assertPositiveInteger(width, "MRT width");
  assertPositiveInteger(height, "MRT height");
  validateDescriptor(descriptor);
  const capabilities = assertOfficialMrtCapabilities(renderer, descriptor);
  const color = descriptor.color;
  const target = new THREE.WebGLRenderTarget(width, height, {
    count: descriptor.count,
    format: resolveThreeEnum(color.format, "color format"),
    internalFormat: color.internalFormat,
    type: resolveThreeEnum(color.type, "color type"),
    colorSpace: resolveThreeEnum(color.colorSpace, "color space"),
    minFilter: resolveThreeEnum(color.minFilter, "min filter"),
    magFilter: resolveThreeEnum(color.magFilter, "mag filter"),
    generateMipmaps: color.generateMipmaps,
    depthBuffer: descriptor.depthStencil.depthBuffer,
    stencilBuffer: descriptor.depthStencil.stencilBuffer,
    samples: descriptor.samples,
  });
  target.textures.forEach((texture, index) => { texture.name = descriptor.colorAttachments[index].name; });
  targetState.set(target, { capabilities, descriptor, disposed: false });
  return target;
}

function activeTargetState(target) {
  const state = targetState.get(target);
  if (!state) throw new TypeError("Expected a target created by createOfficialMrtTarget()");
  if (state.disposed) throw new Error("Official MRT target has been disposed");
  return state;
}

export function resizeOfficialMrtTarget(target, width, height) {
  activeTargetState(target);
  assertPositiveInteger(width, "MRT width");
  assertPositiveInteger(height, "MRT height");
  target.setSize(width, height);
  return target;
}

export function disposeOfficialMrtTarget(target) {
  const state = targetState.get(target);
  if (!state) throw new TypeError("Expected a target created by createOfficialMrtTarget()");
  if (state.disposed) return false;
  state.disposed = true;
  target.dispose();
  return true;
}
