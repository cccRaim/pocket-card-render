function fnv1a32(value) {
  const bytes = new TextEncoder().encode(String(value || ""));
  let hash = 0x811c9dc5;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function sha256Hex(value) {
  const bytes = new TextEncoder().encode(String(value || ""));
  const words = [];
  for (let index = 0; index < bytes.length; index += 1) {
    words[index >> 2] = (words[index >> 2] || 0) | (bytes[index] << (24 - (index % 4) * 8));
  }
  const bitLength = bytes.length * 8;
  words[bitLength >> 5] = (words[bitLength >> 5] || 0) | (0x80 << (24 - bitLength % 32));
  words[(((bitLength + 64) >> 9) << 4) + 15] = bitLength;
  const constants = [];
  const initial = [];
  let candidate = 2;
  while (constants.length < 64) {
    let prime = true;
    for (let divisor = 2; divisor * divisor <= candidate; divisor += 1) {
      if (candidate % divisor === 0) { prime = false; break; }
    }
    if (prime) {
      if (initial.length < 8) initial.push((Math.sqrt(candidate) * 0x100000000) | 0);
      constants.push((Math.cbrt(candidate) * 0x100000000) | 0);
    }
    candidate += 1;
  }
  const hash = initial;
  const rotate = (word, amount) => (word >>> amount) | (word << (32 - amount));
  for (let offset = 0; offset < words.length; offset += 16) {
    const schedule = [];
    for (let index = 0; index < 64; index += 1) {
      if (index < 16) schedule[index] = words[offset + index] | 0;
      else {
        const a = schedule[index - 15];
        const b = schedule[index - 2];
        const s0 = rotate(a, 7) ^ rotate(a, 18) ^ (a >>> 3);
        const s1 = rotate(b, 17) ^ rotate(b, 19) ^ (b >>> 10);
        schedule[index] = (schedule[index - 16] + s0 + schedule[index - 7] + s1) | 0;
      }
    }
    let [a, b, c, d, e, f, g, h] = hash;
    for (let index = 0; index < 64; index += 1) {
      const sum1 = rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25);
      const choose = (e & f) ^ (~e & g);
      const temp1 = (h + sum1 + choose + constants[index] + schedule[index]) | 0;
      const sum0 = rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (sum0 + majority) | 0;
      [h, g, f, e, d, c, b, a] = [g, f, e, (d + temp1) | 0, c, b, a, (temp1 + temp2) | 0];
    }
    hash[0] = (hash[0] + a) | 0; hash[1] = (hash[1] + b) | 0;
    hash[2] = (hash[2] + c) | 0; hash[3] = (hash[3] + d) | 0;
    hash[4] = (hash[4] + e) | 0; hash[5] = (hash[5] + f) | 0;
    hash[6] = (hash[6] + g) | 0; hash[7] = (hash[7] + h) | 0;
  }
  return hash.map((word) => (word >>> 0).toString(16).padStart(8, "0")).join("");
}

function safeParameter(gl, parameter) {
  try {
    const value = gl.getParameter(parameter);
    return ArrayBuffer.isView(value) ? Array.from(value) : value;
  } catch {
    return null;
  }
}

function drainWebglErrors(gl, errors, stage) {
  for (let error = gl.getError(); error !== gl.NO_ERROR; error = gl.getError()) {
    errors.push({ stage, error });
  }
}

function enumName(gl, value) {
  if (!Number.isInteger(value)) return value;
  const names = [
    "ZERO", "ONE", "SRC_COLOR", "ONE_MINUS_SRC_COLOR", "DST_COLOR", "ONE_MINUS_DST_COLOR",
    "SRC_ALPHA", "ONE_MINUS_SRC_ALPHA", "DST_ALPHA", "ONE_MINUS_DST_ALPHA", "CONSTANT_COLOR",
    "ONE_MINUS_CONSTANT_COLOR", "CONSTANT_ALPHA", "ONE_MINUS_CONSTANT_ALPHA", "SRC_ALPHA_SATURATE",
    "FUNC_ADD", "FUNC_SUBTRACT", "FUNC_REVERSE_SUBTRACT", "MIN", "MAX", "NEVER", "LESS", "EQUAL",
    "LEQUAL", "GREATER", "NOTEQUAL", "GEQUAL", "ALWAYS", "FRONT", "BACK", "FRONT_AND_BACK", "CW", "CCW",
    "KEEP", "REPLACE", "INCR", "DECR", "INVERT", "INCR_WRAP", "DECR_WRAP", "NONE",
  ];
  return names.find((name) => gl[name] === value) || `0x${value.toString(16)}`;
}

function textureIdentity(texture) {
  const image = texture?.image;
  const sourceUrl = texture?.userData?.sourceUrl
    || texture?.userData?.officialMipFallback?.url
    || image?.currentSrc
    || image?.src
    || null;
  return {
    kind: texture?.isCubeTexture ? "cube-texture" : "texture",
    name: texture?.name || null,
    sourceUrl,
    width: image?.width || texture?.source?.data?.width || null,
    height: image?.height || texture?.source?.data?.height || null,
    sampler: texture?.userData?.officialSampler || null,
  };
}

export function serializeAuditValue(value, depth = 0) {
  if (value == null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : String(value);
  if (depth > 4) return "[depth-limit]";
  if (value?.isTexture) return textureIdentity(value);
  if (ArrayBuffer.isView(value)) return Array.from(value, (entry) => serializeAuditValue(entry, depth + 1));
  if (Array.isArray(value)) return value.map((entry) => serializeAuditValue(entry, depth + 1));
  if (value?.isColor || value?.isVector2 || value?.isVector3 || value?.isVector4 || value?.isQuaternion) {
    return value.toArray().map((entry) => serializeAuditValue(entry, depth + 1));
  }
  if (value?.isMatrix3 || value?.isMatrix4) return Array.from(value.elements);
  if (typeof value === "object") {
    const output = {};
    for (const key of Object.keys(value).sort()) {
      if (["uuid", "version", "needsUpdate"].includes(key)) continue;
      const child = value[key];
      if (typeof child === "function" || child === undefined) continue;
      output[key] = serializeAuditValue(child, depth + 1);
    }
    return output;
  }
  return String(value);
}

function samplerTarget(gl, type) {
  const twoDimensional = new Set([
    gl.SAMPLER_2D, gl.INT_SAMPLER_2D, gl.UNSIGNED_INT_SAMPLER_2D,
    gl.SAMPLER_2D_SHADOW,
  ]);
  const cube = new Set([
    gl.SAMPLER_CUBE, gl.INT_SAMPLER_CUBE, gl.UNSIGNED_INT_SAMPLER_CUBE,
    gl.SAMPLER_CUBE_SHADOW,
  ]);
  if (twoDimensional.has(type)) return { target: gl.TEXTURE_2D, binding: gl.TEXTURE_BINDING_2D, name: "TEXTURE_2D" };
  if (cube.has(type)) return { target: gl.TEXTURE_CUBE_MAP, binding: gl.TEXTURE_BINDING_CUBE_MAP, name: "TEXTURE_CUBE_MAP" };
  return null;
}

function samplerBinding(gl, renderer, material, name, type, value) {
  const target = samplerTarget(gl, type);
  if (!target || !Number.isInteger(value) || value < 0) return null;
  const texture = material?.uniforms?.[name]?.value;
  const previousUnit = safeParameter(gl, gl.ACTIVE_TEXTURE);
  try {
    gl.activeTexture(gl.TEXTURE0 + value);
    const actual = safeParameter(gl, target.binding);
    const expected = texture?.isTexture ? renderer.properties.get(texture)?.__webglTexture : null;
    return {
      unit: value,
      target: target.name,
      matchesMaterialTexture: Boolean(actual && expected && actual === expected),
      materialTexture: texture?.isTexture ? textureIdentity(texture) : null,
    };
  } finally {
    if (Number.isInteger(previousUnit)) gl.activeTexture(previousUnit);
  }
}

function programSignature(gl, renderer, material) {
  const program = safeParameter(gl, gl.CURRENT_PROGRAM);
  if (!program || typeof gl.getAttachedShaders !== "function") return null;
  const result = {
    linked: Boolean(gl.getProgramParameter(program, gl.LINK_STATUS)),
    uniforms: [],
    attributes: [],
  };
  for (const shader of gl.getAttachedShaders(program) || []) {
    const type = gl.getShaderParameter(shader, gl.SHADER_TYPE);
    const source = gl.getShaderSource(shader) || "";
    const key = type === gl.VERTEX_SHADER ? "vertex" : type === gl.FRAGMENT_SHADER ? "fragment" : String(type);
    const materialSource = key === "vertex" ? material?.vertexShader : key === "fragment" ? material?.fragmentShader : null;
    result[key] = {
      sourceByteLength: new TextEncoder().encode(source).length,
      sourceFnv1a32: fnv1a32(source),
      sourceSha256: sha256Hex(source),
      containsMaterialSource: typeof materialSource === "string" && source.includes(materialSource.trim()),
    };
  }
  const uniformCount = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS) || 0;
  for (let index = 0; index < uniformCount; index += 1) {
    const info = gl.getActiveUniform(program, index);
    if (!info) continue;
    const location = gl.getUniformLocation(program, info.name);
    const value = serializeAuditValue(location == null ? null : gl.getUniform(program, location));
    result.uniforms.push({
      name: info.name.replace(/\[0\]$/, ""),
      size: info.size,
      type: enumName(gl, info.type),
      value,
      samplerBinding: samplerBinding(gl, renderer, material, info.name.replace(/\[0\]$/, ""), info.type, value),
    });
  }
  result.uniforms.sort((a, b) => a.name.localeCompare(b.name));
  const attributeCount = gl.getProgramParameter(program, gl.ACTIVE_ATTRIBUTES) || 0;
  for (let index = 0; index < attributeCount; index += 1) {
    const info = gl.getActiveAttrib(program, index);
    if (!info) continue;
    result.attributes.push({
      name: info.name,
      size: info.size,
      type: enumName(gl, info.type),
      location: gl.getAttribLocation(program, info.name),
    });
  }
  result.attributes.sort((a, b) => a.name.localeCompare(b.name));
  return result;
}

function stencilFace(gl, face) {
  const back = face === "back";
  return {
    func: enumName(gl, safeParameter(gl, back ? gl.STENCIL_BACK_FUNC : gl.STENCIL_FUNC)),
    ref: safeParameter(gl, back ? gl.STENCIL_BACK_REF : gl.STENCIL_REF),
    valueMask: safeParameter(gl, back ? gl.STENCIL_BACK_VALUE_MASK : gl.STENCIL_VALUE_MASK),
    writeMask: safeParameter(gl, back ? gl.STENCIL_BACK_WRITEMASK : gl.STENCIL_WRITEMASK),
    fail: enumName(gl, safeParameter(gl, back ? gl.STENCIL_BACK_FAIL : gl.STENCIL_FAIL)),
    depthFail: enumName(gl, safeParameter(gl, back ? gl.STENCIL_BACK_PASS_DEPTH_FAIL : gl.STENCIL_PASS_DEPTH_FAIL)),
    pass: enumName(gl, safeParameter(gl, back ? gl.STENCIL_BACK_PASS_DEPTH_PASS : gl.STENCIL_PASS_DEPTH_PASS)),
  };
}

function drawCount(geometry, group) {
  const total = geometry?.index?.count ?? geometry?.attributes?.position?.count ?? 0;
  const start = Number(group?.start || 0);
  const available = Math.max(0, total - start);
  return Math.min(Number.isFinite(group?.count) ? group.count : available, available);
}

export function captureLocalWebGlDraw({ gl, renderer, object, geometry, material, group, ordinal }) {
  const descriptor = object.userData.localDrawAudit || {};
  const webglErrors = [];
  // Attribute errors to the draw or to the audit reader that caused them. Leaving these queued until
  // the final blit made unrelated material failures look like post-process failures.
  drainWebglErrors(gl, webglErrors, "before-local-draw-audit");
  const uniforms = {};
  for (const [name, entry] of Object.entries(material.uniforms || {}).sort(([a], [b]) => a.localeCompare(b))) {
    uniforms[name] = serializeAuditValue(entry?.value);
  }
  const viewport = safeParameter(gl, gl.VIEWPORT);
  const scissor = safeParameter(gl, gl.SCISSOR_BOX);
  const program = programSignature(gl, renderer, material);
  drainWebglErrors(gl, webglErrors, "program-introspection");
  const snapshot = {
    ordinal,
    identity: {
      materialName: descriptor.materialName || material.name || null,
      shader: descriptor.shader || material.userData?.exactShader || null,
      drawId: object.userData.officialDraw?.drawId || null,
      rendererIdentity: object.userData.officialDraw?.rendererIdentity || null,
      goPath: object.userData.officialDraw?.goPath || null,
      materialSlot: object.userData.officialDraw?.materialSlot ?? null,
      drawCandidates: object.userData.officialDrawCandidates || [],
      renderOrder: object.renderOrder,
    },
    geometry: {
      indexed: Boolean(geometry?.index),
      count: drawCount(geometry, group),
      instanceCount: object.isInstancedMesh ? object.count : 1,
    },
    pipeline: {
      program,
      viewport,
      scissor,
      scissorEnabled: gl.isEnabled(gl.SCISSOR_TEST),
      raster: {
        cullEnabled: gl.isEnabled(gl.CULL_FACE),
        cullFace: enumName(gl, safeParameter(gl, gl.CULL_FACE_MODE)),
        frontFace: enumName(gl, safeParameter(gl, gl.FRONT_FACE)),
        polygonOffsetEnabled: gl.isEnabled(gl.POLYGON_OFFSET_FILL),
        polygonOffsetFactor: safeParameter(gl, gl.POLYGON_OFFSET_FACTOR),
        polygonOffsetUnits: safeParameter(gl, gl.POLYGON_OFFSET_UNITS),
        sampleAlphaToCoverage: gl.isEnabled(gl.SAMPLE_ALPHA_TO_COVERAGE),
      },
      depth: {
        test: gl.isEnabled(gl.DEPTH_TEST),
        write: safeParameter(gl, gl.DEPTH_WRITEMASK),
        func: enumName(gl, safeParameter(gl, gl.DEPTH_FUNC)),
      },
      blend: {
        enabled: gl.isEnabled(gl.BLEND),
        srcRgb: enumName(gl, safeParameter(gl, gl.BLEND_SRC_RGB)),
        dstRgb: enumName(gl, safeParameter(gl, gl.BLEND_DST_RGB)),
        srcAlpha: enumName(gl, safeParameter(gl, gl.BLEND_SRC_ALPHA)),
        dstAlpha: enumName(gl, safeParameter(gl, gl.BLEND_DST_ALPHA)),
        equationRgb: enumName(gl, safeParameter(gl, gl.BLEND_EQUATION_RGB)),
        equationAlpha: enumName(gl, safeParameter(gl, gl.BLEND_EQUATION_ALPHA)),
        colorMask: safeParameter(gl, gl.COLOR_WRITEMASK),
      },
      stencil: {
        enabled: gl.isEnabled(gl.STENCIL_TEST),
        front: stencilFace(gl, "front"),
        back: stencilFace(gl, "back"),
      },
      drawBuffers: [safeParameter(gl, gl.DRAW_BUFFER0), safeParameter(gl, gl.DRAW_BUFFER1)]
        .map((value) => enumName(gl, value)),
    },
    material: {
      type: material.type,
      exactShader: material.userData?.exactShader || null,
      exactVariant: material.userData?.exactVariant || null,
      officialSelector: material.userData?.officialSelector ? {
        selectorId: material.userData.officialSelector.selectorId || null,
        candidateWitnessId: material.userData.officialSelector.candidateWitnessId || null,
        subshader: material.userData.officialSelector.subshader ?? null,
        pass: material.userData.officialSelector.pass ?? null,
        shaderIdentity: material.userData.officialSelector.shaderIdentity || null,
        keywords: [...(material.userData.officialSelector.keywords || [])],
        programBlobIndex: material.userData.officialSelector.programBlobIndex ?? null,
        parameterBlobIndex: material.userData.officialSelector.parameterBlobIndex ?? null,
        executableId: material.userData.officialSelector.executableId || null,
        semanticExecutableId: material.userData.officialSelector.semanticExecutableId || null,
      } : null,
      officialExecutableIdentity: material.userData?.officialExecutableIdentity || null,
      officialPassStateSha256: material.userData?.officialPassStateSha256 || null,
      shaderSources: material.isShaderMaterial ? {
        vertexSha256: sha256Hex(material.vertexShader || ""),
        fragmentSha256: sha256Hex(material.fragmentShader || ""),
      } : null,
      transparent: material.transparent,
      side: material.side,
      depthTest: material.depthTest,
      depthWrite: material.depthWrite,
      stencilWrite: material.stencilWrite,
    },
    uniforms,
  };
  drainWebglErrors(gl, webglErrors, "pipeline-state-introspection");
  snapshot.diagnostics = { webglErrors };
  return snapshot;
}

export function attachLocalDrawAudit(object, descriptor) {
  object.userData.localDrawAudit = { ...descriptor };
  const previous = object.onAfterRender;
  object.onAfterRender = function onAfterRender(renderer, scene, camera, geometry, material, group) {
    if (typeof previous === "function") previous.call(this, renderer, scene, camera, geometry, material, group);
    if (!window.__localDrawAuditActive || !Array.isArray(window.__localDrawAuditTrace)) return;
    window.__localDrawAuditTrace.push(captureLocalWebGlDraw({
      gl: renderer.getContext(),
      renderer,
      object: this,
      geometry,
      material,
      group,
      ordinal: window.__localDrawAuditTrace.length,
    }));
  };
}
