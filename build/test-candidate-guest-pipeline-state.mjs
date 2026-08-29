import assert from "node:assert/strict";
import test from "node:test";

import {
  UNITY_BLEND_TO_VULKAN,
  compareCandidateGuestPipelineState,
  compileCandidateGuestPipelineExpectation,
  unityColorWriteMaskToVulkan,
} from "./candidate-guest-pipeline-state.mjs";

function parameter(val, name = null) {
  return { val, name };
}

function fixture() {
  const stencil = {
    comp: parameter(3),
    fail: parameter(0),
    pass: parameter(2),
    zFail: parameter(0),
  };
  const manifest = {
    shader: "Fixture/Shader",
    official_selector: {
      selectorId: "selector",
      candidateWitnessId: "witness",
      subshader: 0,
      pass: 0,
    },
    official_shader_property_defaults: {
      floats: { _Stencil: 0 },
    },
    official_pass_runtime: {
      source_sha256: "a".repeat(64),
      shared_mrt_blend: true,
      depth: {
        test: parameter(4),
        write: parameter(0),
      },
      culling: parameter(2),
      stencil: {
        ref: parameter(7),
        read_mask: parameter(0, "_Stencil"),
        write_mask: parameter(4),
        generic: stencil,
      },
      fixed: {
        zClip: parameter(1),
        conservative: parameter(0),
        offsetFactor: parameter(0),
        offsetUnits: parameter(0),
        alphaToMask: parameter(1),
      },
      blend: {
        src_rgb: parameter(5),
        dst_rgb: parameter(10),
        src_alpha: parameter(1),
        dst_alpha: parameter(10),
        op_rgb: parameter(0),
        op_alpha: parameter(0),
        color_mask: parameter(15),
      },
    },
  };
  const recipe = { floats: { _Stencil: 3 }, ints: {} };
  const expectation = compileCandidateGuestPipelineExpectation({
    manifest,
    recipe,
  });
  const actual = {
    cullMode: 2,
    depthClamp: 0,
    depthBias: 0,
    alphaToCoverage: 1,
    depthTest: 1,
    depthWrite: 0,
    depthCompareOp: 3,
    stencilTest: 1,
    frontStencil: {
      failOp: 0,
      passOp: 2,
      depthFailOp: 0,
      compareOp: 2,
      compareMask: 3,
      writeMask: 4,
      reference: 7,
    },
    backStencil: {
      failOp: 0,
      passOp: 2,
      depthFailOp: 0,
      compareOp: 2,
      compareMask: 3,
      writeMask: 4,
      reference: 7,
    },
    blendAttachments: [{
      enable: 1,
      srcColor: 6,
      dstColor: 7,
      colorOp: 0,
      srcAlpha: 1,
      dstAlpha: 7,
      alphaOp: 0,
      writeMask: 15,
    }],
    missingDynamicStates: [],
  };
  return { manifest, recipe, expectation, actual };
}

test("maps every Unity blend factor to the Vulkan enum without alias drift", () => {
  assert.deepEqual(UNITY_BLEND_TO_VULKAN, {
    0: 0,
    1: 1,
    2: 4,
    3: 2,
    4: 5,
    5: 6,
    6: 3,
    7: 8,
    8: 9,
    9: 14,
    10: 7,
  });
});

test("remaps Unity ABGR color-mask bits to Vulkan RGBA bits", () => {
  assert.deepEqual(
    [0, 1, 2, 4, 8, 15].map(unityColorWriteMaskToVulkan),
    [0, 8, 4, 2, 1, 15],
  );
});

test("resolves Material properties before Shader defaults and compares fields", () => {
  const { expectation, actual } = fixture();
  assert.equal(expectation.fields.frontStencil.compareMask, 3);
  assert.equal(expectation.fields.depthCompareOp, 3);
  assert.equal(expectation.fields.blendAttachment.srcColor, 6);
  const comparison =
    compareCandidateGuestPipelineState(expectation, actual);
  assert.equal(comparison.mismatchFieldCount, 0);
  assert(comparison.comparableFieldCount > 20);
  assert.equal(comparison.status, "partial-exact");
});

test("uses Shader defaults before serialized pass literals", () => {
  const { manifest, recipe } = fixture();
  delete recipe.floats._Stencil;
  manifest.official_shader_property_defaults.floats._Stencil = 5;
  manifest.official_pass_runtime.stencil.read_mask.val = 1;
  const expectation = compileCandidateGuestPipelineExpectation({
    manifest,
    recipe,
  });
  assert.equal(expectation.fields.frontStencil.compareMask, 5);
});

test("falls back to the serialized pass literal after named sources", () => {
  const { manifest, recipe } = fixture();
  delete recipe.floats._Stencil;
  delete manifest.official_shader_property_defaults.floats._Stencil;
  manifest.official_pass_runtime.stencil.read_mask.val = 6;
  const expectation = compileCandidateGuestPipelineExpectation({
    manifest,
    recipe,
  });
  assert.equal(expectation.fields.frontStencil.compareMask, 6);
});

test("compares every MRT attachment when shared blend is serialized", () => {
  const { expectation, actual } = fixture();
  actual.blendAttachments.push(structuredClone(actual.blendAttachments[0]));
  const comparison =
    compareCandidateGuestPipelineState(expectation, actual);
  assert.equal(comparison.mismatchFieldCount, 0);
  assert(
    comparison.fields.some(({ field }) => (
      field === "blendAttachments[1].writeMask"
    )),
  );
  actual.blendAttachments[1].srcColor = 1;
  assert.equal(
    compareCandidateGuestPipelineState(expectation, actual)
      .mismatchFieldCount,
    1,
  );
});

test("rejects advanced Unity blend operations without guessing Vulkan lowering", () => {
  const { manifest, recipe } = fixture();
  manifest.official_pass_runtime.blend.op_rgb.val = 5;
  const expectation = compileCandidateGuestPipelineExpectation({
    manifest,
    recipe,
  });
  assert(
    expectation.unresolved.includes("blend.colorOp:unsupported:5"),
  );
});

test("reports field mismatches and unobserved dynamic state separately", () => {
  const { expectation, actual } = fixture();
  actual.depthWrite = 1;
  actual.missingDynamicStates = [1000267007];
  const comparison =
    compareCandidateGuestPipelineState(expectation, actual);
  assert.equal(comparison.status, "mismatch");
  assert(
    comparison.fields.some(({ field, status }) => (
      field === "depthWrite" && status === "mismatch"
    )),
  );
  assert(
    comparison.runtimeRequired.includes(
      "unobserved-dynamic-state:1000267007",
    ),
  );
});

test("fails closed when a named pass property has no Material or Shader value", () => {
  const { manifest, recipe } = fixture();
  manifest.official_pass_runtime.depth.write = {
    val: Number.NaN,
    name: "_ZWrite",
  };
  const expectation = compileCandidateGuestPipelineExpectation({
    manifest,
    recipe,
  });
  assert(
    expectation.unresolved.includes(
      "depth.write:unresolved-property:_ZWrite",
    ),
  );
});
