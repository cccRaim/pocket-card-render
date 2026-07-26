export const WEBGL_POSITION_INVARIANCE_SCHEMA =
  "pocket-card-render/webgl-position-invariance@2";

const DECLARATION = "invariant gl_Position;";
const DECLARATION_PATTERN = /\binvariant\s+gl_Position\s*;/g;
const POSITION_WRITE_PATTERN = /\bgl_Position\s*=/;
const CANONICAL_OBJECT_CLIP_WRITE =
  "gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);";

function findMainClosingBrace(source) {
  const main = /\bvoid\s+main\s*\(\s*\)\s*\{/.exec(source);
  if (!main) throw new Error("WebGL vertex source has no main function");
  let depth = 1;
  let state = "code";
  for (let index = main.index + main[0].length; index < source.length; index += 1) {
    const current = source[index];
    const next = source[index + 1];
    if (state === "line-comment") {
      if (current === "\n") state = "code";
      continue;
    }
    if (state === "block-comment") {
      if (current === "*" && next === "/") {
        state = "code";
        index += 1;
      }
      continue;
    }
    if (current === "/" && next === "/") {
      state = "line-comment";
      index += 1;
      continue;
    }
    if (current === "/" && next === "*") {
      state = "block-comment";
      index += 1;
      continue;
    }
    if (current === "{") depth += 1;
    if (current === "}") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  throw new Error("WebGL vertex source main function is not closed");
}

export function canonicalizeWebglObjectClipPosition(source) {
  for (const declaration of [
    /\buniform(?:\s+\w+)?\s+mat4\s+modelMatrix\s*;/,
    /\buniform(?:\s+\w+)?\s+mat4\s+viewMatrix\s*;/,
    /\buniform(?:\s+\w+)?\s+mat4\s+projectionMatrix\s*;/,
    /\bin\s+vec3\s+position\s*;/,
  ]) {
    if (!declaration.test(source)) {
      throw new Error(`WebGL canonical object clip position is missing ${declaration}`);
    }
  }
  const closingBrace = findMainClosingBrace(source);
  return `${source.slice(0, closingBrace)}    ${CANONICAL_OBJECT_CLIP_WRITE}\n${source.slice(closingBrace)}`;
}

function formalPortUsesStandardObjectClipPosition(manifest) {
  const runtime = manifest?.runtime_contract;
  const operations = manifest?.webgl_adaptation?.vertex?.operations;
  return runtime?.attributes?.position === "vec3"
    && runtime?.engine_uniforms?.modelMatrix === "mat4"
    && runtime?.engine_uniforms?.viewMatrix === "mat4"
    && runtime?.engine_uniforms?.projectionMatrix === "mat4"
    && Array.isArray(operations)
    && operations.some((operation) => operation?.kind === "engine-uniform-binding")
    && !operations.some((operation) => operation?.kind === "view-depth-offset");
}

function stageSourceUsesStandardObjectClipPosition(manifest) {
  return manifest?.runtime_contract?.object_clip_position === "standard-object-to-clip";
}

export function manifestUsesStandardObjectClipPosition(manifest) {
  return formalPortUsesStandardObjectClipPosition(manifest)
    || stageSourceUsesStandardObjectClipPosition(manifest);
}

/**
 * WebGL compiles each material as a separate program. GLSL ES permits the
 * same gl_Position expression to vary between programs unless it is invariant,
 * which breaks the official coplanar, depth-writing card stack.
 */
export function enforceWebglPositionInvariance(source) {
  if (typeof source !== "string" || source.length === 0) {
    throw new TypeError("WebGL vertex source must be a non-empty string");
  }
  if (!POSITION_WRITE_PATTERN.test(source)) {
    throw new Error("WebGL vertex source does not write gl_Position");
  }
  const declarations = source.match(DECLARATION_PATTERN) || [];
  if (declarations.length > 1) {
    throw new Error("WebGL vertex source declares gl_Position invariant more than once");
  }
  if (declarations.length === 1) {
    if (source.indexOf(DECLARATION) > source.search(POSITION_WRITE_PATTERN)) {
      throw new Error("gl_Position invariant must be declared before its first use");
    }
    return source;
  }

  const version = source.match(/^\s*#version[^\r\n]*(?:\r?\n|$)/);
  if (!version) return `${DECLARATION}\n${source}`;
  return `${version[0]}${DECLARATION}\n${source.slice(version[0].length)}`;
}

export function prepareWebglVertexSource(source, {
  manifest = null,
  canonicalizeObjectClipPosition = true,
} = {}) {
  const shouldCanonicalize = canonicalizeObjectClipPosition
    && manifestUsesStandardObjectClipPosition(manifest);
  const positioned = shouldCanonicalize
    ? canonicalizeWebglObjectClipPosition(source)
    : source;
  return {
    source: enforceWebglPositionInvariance(positioned),
    policy: WEBGL_POSITION_INVARIANCE_SCHEMA,
    canonicalObjectClipPosition: shouldCanonicalize,
  };
}
