import assert from "node:assert/strict";

export const CANDIDATE_GUEST_PIPELINE_EXPECTATION_SCHEMA =
  "pocket-card-render/candidate-guest-pipeline-expectation@1";

// UnityEngine.Rendering.BlendMode -> VkBlendFactor.
export const UNITY_BLEND_TO_VULKAN = Object.freeze({
  0: 0,   // Zero
  1: 1,   // One
  2: 4,   // DstColor
  3: 2,   // SrcColor
  4: 5,   // OneMinusDstColor
  5: 6,   // SrcAlpha
  6: 3,   // OneMinusSrcColor
  7: 8,   // DstAlpha
  8: 9,   // OneMinusDstAlpha
  9: 14,  // SrcAlphaSaturate
  10: 7,  // OneMinusSrcAlpha
});

// Unity CompareFunction is one-based; Vulkan VkCompareOp is zero-based.
export const UNITY_COMPARE_TO_VULKAN = Object.freeze({
  1: 0,
  2: 1,
  3: 2,
  4: 3,
  5: 4,
  6: 5,
  7: 6,
  8: 7,
});

export const UNITY_CULL_TO_VULKAN = Object.freeze({
  0: 0,
  1: 1,
  2: 2,
});

export function unityColorWriteMaskToVulkan(value) {
  if (!Number.isInteger(value) || value < 0 || value > 15) return null;
  return (
    ((value & 0x8) ? 0x1 : 0)
    | ((value & 0x4) ? 0x2 : 0)
    | ((value & 0x2) ? 0x4 : 0)
    | ((value & 0x1) ? 0x8 : 0)
  );
}

function numeric(value) {
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}

function resolveParameter(parameter, recipe, defaults, label, unresolved) {
  if (!parameter || typeof parameter !== "object") {
    unresolved.push(`${label}:parameter-absent`);
    return null;
  }
  if (parameter.name) {
    const materialValue =
      recipe?.floats?.[parameter.name]
      ?? recipe?.ints?.[parameter.name];
    if (materialValue !== undefined) {
      const result = numeric(materialValue);
      if (result !== null) return result;
    }
    const defaultValue = defaults?.[parameter.name];
    if (defaultValue !== undefined) {
      const result = numeric(defaultValue);
      if (result !== null) return result;
    }
    const fallback = numeric(parameter.val);
    if (fallback !== null) return fallback;
    unresolved.push(`${label}:unresolved-property:${parameter.name}`);
    return null;
  }
  const result = numeric(parameter.val);
  if (result === null) unresolved.push(`${label}:non-numeric-literal`);
  return result;
}

function mapValue(table, value, label, unresolved) {
  if (value === null) return null;
  const mapped = table[value];
  if (mapped === undefined) unresolved.push(`${label}:unsupported:${value}`);
  return mapped ?? null;
}

function blendState(pass, recipe, defaults, unresolved) {
  if (!pass?.shared_mrt_blend || !pass.blend) {
    unresolved.push("blend:separate-or-absent");
    return null;
  }
  const value = (name) => resolveParameter(
    pass.blend[name],
    recipe,
    defaults,
    `blend.${name}`,
    unresolved,
  );
  const srcColor = mapValue(
    UNITY_BLEND_TO_VULKAN,
    value("src_rgb"),
    "blend.src_rgb",
    unresolved,
  );
  const dstColor = mapValue(
    UNITY_BLEND_TO_VULKAN,
    value("dst_rgb"),
    "blend.dst_rgb",
    unresolved,
  );
  const srcAlpha = mapValue(
    UNITY_BLEND_TO_VULKAN,
    value("src_alpha"),
    "blend.src_alpha",
    unresolved,
  );
  const dstAlpha = mapValue(
    UNITY_BLEND_TO_VULKAN,
    value("dst_alpha"),
    "blend.dst_alpha",
    unresolved,
  );
  const colorOp = value("op_rgb");
  const alphaOp = value("op_alpha");
  const unityWriteMask = value("color_mask");
  const writeMask = unityColorWriteMaskToVulkan(unityWriteMask);
  for (const [label, result] of [
    ["blend.colorOp", colorOp],
    ["blend.alphaOp", alphaOp],
  ]) {
    if (result !== null && (!Number.isInteger(result) || result < 0
        || result > 4)) {
      unresolved.push(`${label}:unsupported:${result}`);
    }
  }
  if (unityWriteMask !== null && writeMask === null) {
    unresolved.push(`blend.writeMask:unsupported:${unityWriteMask}`);
  }
  const enable = srcColor === 1
    && dstColor === 0
    && srcAlpha === 1
    && dstAlpha === 0
    && colorOp === 0
    && alphaOp === 0
    ? 0
    : 1;
  return {
    enable,
    srcColor,
    dstColor,
    colorOp,
    srcAlpha,
    dstAlpha,
    alphaOp,
    writeMask,
  };
}

function stencilFace(pass, recipe, defaults, unresolved) {
  const generic = pass?.stencil?.generic;
  if (!generic) {
    unresolved.push("stencil.generic:absent");
    return null;
  }
  const value = (name) => resolveParameter(
    generic[name],
    recipe,
    defaults,
    `stencil.generic.${name}`,
    unresolved,
  );
  const compare = mapValue(
    UNITY_COMPARE_TO_VULKAN,
    value("comp"),
    "stencil.generic.comp",
    unresolved,
  );
  const failOp = value("fail");
  const passOp = value("pass");
  const depthFailOp = value("zFail");
  for (const [label, result] of [
    ["stencil.failOp", failOp],
    ["stencil.passOp", passOp],
    ["stencil.depthFailOp", depthFailOp],
  ]) {
    if (result !== null && (!Number.isInteger(result) || result < 0
        || result > 7)) {
      unresolved.push(`${label}:unsupported:${result}`);
    }
  }
  const compareMask = resolveParameter(
    pass.stencil.read_mask,
    recipe,
    defaults,
    "stencil.read_mask",
    unresolved,
  );
  const writeMask = resolveParameter(
    pass.stencil.write_mask,
    recipe,
    defaults,
    "stencil.write_mask",
    unresolved,
  );
  const reference = resolveParameter(
    pass.stencil.ref,
    recipe,
    defaults,
    "stencil.ref",
    unresolved,
  );
  return {
    failOp,
    passOp,
    depthFailOp,
    compareOp: compare,
    compareMask,
    writeMask,
    reference,
  };
}

export function compileCandidateGuestPipelineExpectation({
  manifest,
  recipe,
}) {
  assert(
    manifest?.official_pass_runtime,
    "candidate port manifest has no official_pass_runtime",
  );
  const pass = manifest.official_pass_runtime;
  const defaults = manifest.official_shader_property_defaults?.floats || {};
  const unresolved = [];
  const zTest = resolveParameter(
    pass.depth?.test,
    recipe,
    defaults,
    "depth.test",
    unresolved,
  );
  const zWrite = resolveParameter(
    pass.depth?.write,
    recipe,
    defaults,
    "depth.write",
    unresolved,
  );
  const cull = resolveParameter(
    pass.culling,
    recipe,
    defaults,
    "culling",
    unresolved,
  );
  const zClip = resolveParameter(
    pass.fixed?.zClip,
    recipe,
    defaults,
    "fixed.zClip",
    unresolved,
  );
  const alphaToMask = resolveParameter(
    pass.fixed?.alphaToMask,
    recipe,
    defaults,
    "fixed.alphaToMask",
    unresolved,
  );
  const offsetFactor = resolveParameter(
    pass.fixed?.offsetFactor,
    recipe,
    defaults,
    "fixed.offsetFactor",
    unresolved,
  );
  const offsetUnits = resolveParameter(
    pass.fixed?.offsetUnits,
    recipe,
    defaults,
    "fixed.offsetUnits",
    unresolved,
  );
  const conservative = resolveParameter(
    pass.fixed?.conservative,
    recipe,
    defaults,
    "fixed.conservative",
    unresolved,
  );
  const stencil = stencilFace(pass, recipe, defaults, unresolved);
  const stencilTest = stencil && (
    stencil.compareOp !== 7
      || [stencil.failOp, stencil.passOp, stencil.depthFailOp]
        .some((value) => value !== 0)
  ) ? 1 : 0;
  if (offsetFactor !== 0 || offsetUnits !== 0) {
    unresolved.push(
      "fixed.depthBias:nonzero-Unity-to-Vulkan-scaling-runtime-required",
    );
  }
  if (conservative !== 0) {
    unresolved.push("fixed.conservativeRasterization:runtime-required");
  }
  if (![0, 1].includes(zClip)) {
    unresolved.push(`fixed.zClip:unsupported:${zClip}`);
  }
  if (![0, 1].includes(alphaToMask)) {
    unresolved.push(`fixed.alphaToMask:unsupported:${alphaToMask}`);
  }
  if (![0, 1].includes(zWrite)) {
    unresolved.push(`depth.write:unsupported:${zWrite}`);
  }
  if (zTest !== null && zTest !== 0
      && UNITY_COMPARE_TO_VULKAN[zTest] === undefined) {
    unresolved.push(`depth.test:unsupported:${zTest}`);
  }

  return {
    schema: CANDIDATE_GUEST_PIPELINE_EXPECTATION_SCHEMA,
    source: {
      shader: manifest.shader,
      selector: manifest.official_selector,
      passStateSha256: pass.source_sha256,
    },
    fields: {
      cullMode: mapValue(
        UNITY_CULL_TO_VULKAN,
        cull,
        "culling",
        unresolved,
      ),
      depthClamp: zClip === null ? null : zClip === 0 ? 1 : 0,
      depthBias: offsetFactor === 0 && offsetUnits === 0 ? 0 : null,
      alphaToCoverage: alphaToMask,
      depthTest: zTest === null ? null : zTest === 0 ? 0 : 1,
      depthWrite: zWrite,
      depthCompareOp: zTest && zTest !== 0
        ? mapValue(
          UNITY_COMPARE_TO_VULKAN,
          zTest,
          "depth.test",
          unresolved,
        )
        : null,
      stencilTest,
      frontStencil: stencilTest ? stencil : null,
      backStencil: stencilTest ? stencil : null,
      blendAttachment: blendState(pass, recipe, defaults, unresolved),
    },
    unresolved: [...new Set(unresolved)].sort(),
    runtimeBoundaries: [
      "graphics-pipeline-pNext-chain",
      "Unity-native-render-state-to-Vulkan-backend-lowering",
      "render-pass-and-attachment-compatibility",
    ],
  };
}

function compareField(rows, field, expected, actual) {
  if (expected === null || expected === undefined) return;
  rows.push({
    field,
    expected,
    actual,
    status: Object.is(expected, actual) ? "exact" : "mismatch",
  });
}

export function compareCandidateGuestPipelineState(expectation, actual) {
  assert.equal(
    expectation?.schema,
    CANDIDATE_GUEST_PIPELINE_EXPECTATION_SCHEMA,
  );
  const fields = [];
  const expected = expectation.fields;
  for (const name of [
    "cullMode",
    "depthClamp",
    "depthBias",
    "alphaToCoverage",
    "depthTest",
    "depthWrite",
    "depthCompareOp",
    "stencilTest",
  ]) {
    compareField(fields, name, expected[name], actual?.[name]);
  }
  if (expected.stencilTest) {
    for (const face of ["frontStencil", "backStencil"]) {
      for (const name of [
        "failOp",
        "passOp",
        "depthFailOp",
        "compareOp",
        "compareMask",
        "writeMask",
        "reference",
      ]) {
        compareField(
          fields,
          `${face}.${name}`,
          expected[face]?.[name],
          actual?.[face]?.[name],
        );
      }
    }
  }
  const attachments = actual?.blendAttachments || [];
  if (expected.blendAttachment) {
    if (attachments.length === 0) {
      fields.push({
        field: "blendAttachments",
        expected: "at-least-one",
        actual: 0,
        status: "mismatch",
      });
    }
    attachments.forEach((attachment, index) => {
      for (const name of [
        "enable",
        "srcColor",
        "dstColor",
        "colorOp",
        "srcAlpha",
        "dstAlpha",
        "alphaOp",
        "writeMask",
      ]) {
        compareField(
          fields,
          `blendAttachments[${index}].${name}`,
          expected.blendAttachment[name],
          attachment?.[name],
        );
      }
    });
  }
  const missingDynamicStates = actual?.missingDynamicStates || [];
  const mismatch = fields.some(({ status }) => status === "mismatch");
  const runtimeRequired = [
    ...expectation.unresolved,
    ...expectation.runtimeBoundaries,
    ...missingDynamicStates.map((state) => (
      `unobserved-dynamic-state:${state}`
    )),
  ];
  return {
    schema: "pocket-card-render/candidate-guest-pipeline-comparison@1",
    status: mismatch
      ? "mismatch"
      : runtimeRequired.length > 0
        ? "partial-exact"
        : "exact-comparable-fields",
    comparableFieldCount: fields.length,
    exactFieldCount:
      fields.filter(({ status }) => status === "exact").length,
    mismatchFieldCount:
      fields.filter(({ status }) => status === "mismatch").length,
    fields,
    runtimeRequired: [...new Set(runtimeRequired)].sort(),
  };
}
