#!/usr/bin/env node
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  atomicWriteFileSync,
  createStagingDirectorySync,
  publishDirectorySync,
} from "./atomic-publish.mjs";
import {
  EVENT_RECONSTRUCTED_VULKAN_FUNCTIONS,
  classifyVulkanFunctionBoundaries,
} from "./gfxreconstruct-state-boundaries.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_TOOLCHAIN_MANIFEST = path.join(
  ROOT,
  "build",
  "gfxreconstruct-toolchain.json",
);
const SCHEMA =
  "pocket-card-render/gfxreconstruct-vulkan-audit-conversion@1";
const TOOLCHAIN_SCHEMA =
  "pocket-card-render/gfxreconstruct-toolchain@1";

const ENUMS = Object.freeze({
  VK_PIPELINE_BIND_POINT_GRAPHICS: 0,
  VK_SHADER_STAGE_VERTEX_BIT: 0x00000001,
  VK_SHADER_STAGE_FRAGMENT_BIT: 0x00000010,
  VK_PRIMITIVE_TOPOLOGY_POINT_LIST: 0,
  VK_PRIMITIVE_TOPOLOGY_LINE_LIST: 1,
  VK_PRIMITIVE_TOPOLOGY_LINE_STRIP: 2,
  VK_PRIMITIVE_TOPOLOGY_TRIANGLE_LIST: 3,
  VK_PRIMITIVE_TOPOLOGY_TRIANGLE_STRIP: 4,
  VK_PRIMITIVE_TOPOLOGY_TRIANGLE_FAN: 5,
  VK_PRIMITIVE_TOPOLOGY_LINE_LIST_WITH_ADJACENCY: 6,
  VK_PRIMITIVE_TOPOLOGY_LINE_STRIP_WITH_ADJACENCY: 7,
  VK_PRIMITIVE_TOPOLOGY_TRIANGLE_LIST_WITH_ADJACENCY: 8,
  VK_PRIMITIVE_TOPOLOGY_TRIANGLE_STRIP_WITH_ADJACENCY: 9,
  VK_PRIMITIVE_TOPOLOGY_PATCH_LIST: 10,
  VK_POLYGON_MODE_FILL: 0,
  VK_POLYGON_MODE_LINE: 1,
  VK_POLYGON_MODE_POINT: 2,
  VK_CULL_MODE_NONE: 0,
  VK_CULL_MODE_FRONT_BIT: 0x1,
  VK_CULL_MODE_BACK_BIT: 0x2,
  VK_CULL_MODE_FRONT_AND_BACK: 0x3,
  VK_FRONT_FACE_COUNTER_CLOCKWISE: 0,
  VK_FRONT_FACE_CLOCKWISE: 1,
  VK_COMPARE_OP_NEVER: 0,
  VK_COMPARE_OP_LESS: 1,
  VK_COMPARE_OP_EQUAL: 2,
  VK_COMPARE_OP_LESS_OR_EQUAL: 3,
  VK_COMPARE_OP_GREATER: 4,
  VK_COMPARE_OP_NOT_EQUAL: 5,
  VK_COMPARE_OP_GREATER_OR_EQUAL: 6,
  VK_COMPARE_OP_ALWAYS: 7,
  VK_BLEND_FACTOR_ZERO: 0,
  VK_BLEND_FACTOR_ONE: 1,
  VK_BLEND_FACTOR_SRC_COLOR: 2,
  VK_BLEND_FACTOR_ONE_MINUS_SRC_COLOR: 3,
  VK_BLEND_FACTOR_DST_COLOR: 4,
  VK_BLEND_FACTOR_ONE_MINUS_DST_COLOR: 5,
  VK_BLEND_FACTOR_SRC_ALPHA: 6,
  VK_BLEND_FACTOR_ONE_MINUS_SRC_ALPHA: 7,
  VK_BLEND_FACTOR_DST_ALPHA: 8,
  VK_BLEND_FACTOR_ONE_MINUS_DST_ALPHA: 9,
  VK_BLEND_FACTOR_CONSTANT_COLOR: 10,
  VK_BLEND_FACTOR_ONE_MINUS_CONSTANT_COLOR: 11,
  VK_BLEND_FACTOR_CONSTANT_ALPHA: 12,
  VK_BLEND_FACTOR_ONE_MINUS_CONSTANT_ALPHA: 13,
  VK_BLEND_FACTOR_SRC_ALPHA_SATURATE: 14,
  VK_BLEND_FACTOR_SRC1_COLOR: 15,
  VK_BLEND_FACTOR_ONE_MINUS_SRC1_COLOR: 16,
  VK_BLEND_FACTOR_SRC1_ALPHA: 17,
  VK_BLEND_FACTOR_ONE_MINUS_SRC1_ALPHA: 18,
  VK_BLEND_OP_ADD: 0,
  VK_BLEND_OP_SUBTRACT: 1,
  VK_BLEND_OP_REVERSE_SUBTRACT: 2,
  VK_BLEND_OP_MIN: 3,
  VK_BLEND_OP_MAX: 4,
  VK_COLOR_COMPONENT_R_BIT: 0x1,
  VK_COLOR_COMPONENT_G_BIT: 0x2,
  VK_COLOR_COMPONENT_B_BIT: 0x4,
  VK_COLOR_COMPONENT_A_BIT: 0x8,
  VK_INDEX_TYPE_UINT16: 0,
  VK_INDEX_TYPE_UINT32: 1,
  VK_INDEX_TYPE_NONE_KHR: 1000165000,
  VK_INDEX_TYPE_UINT8_EXT: 1000265000,
  VK_STENCIL_OP_KEEP: 0,
  VK_STENCIL_OP_ZERO: 1,
  VK_STENCIL_OP_REPLACE: 2,
  VK_STENCIL_OP_INCREMENT_AND_CLAMP: 3,
  VK_STENCIL_OP_DECREMENT_AND_CLAMP: 4,
  VK_STENCIL_OP_INVERT: 5,
  VK_STENCIL_OP_INCREMENT_AND_WRAP: 6,
  VK_STENCIL_OP_DECREMENT_AND_WRAP: 7,
  VK_SAMPLE_COUNT_1_BIT: 0x1,
  VK_SAMPLE_COUNT_2_BIT: 0x2,
  VK_SAMPLE_COUNT_4_BIT: 0x4,
  VK_SAMPLE_COUNT_8_BIT: 0x8,
  VK_SAMPLE_COUNT_16_BIT: 0x10,
  VK_SAMPLE_COUNT_32_BIT: 0x20,
  VK_SAMPLE_COUNT_64_BIT: 0x40,
  VK_DYNAMIC_STATE_VIEWPORT: 0,
  VK_DYNAMIC_STATE_SCISSOR: 1,
  VK_DYNAMIC_STATE_LINE_WIDTH: 2,
  VK_DYNAMIC_STATE_DEPTH_BIAS: 3,
  VK_DYNAMIC_STATE_BLEND_CONSTANTS: 4,
  VK_DYNAMIC_STATE_DEPTH_BOUNDS: 5,
  VK_DYNAMIC_STATE_STENCIL_COMPARE_MASK: 6,
  VK_DYNAMIC_STATE_STENCIL_WRITE_MASK: 7,
  VK_DYNAMIC_STATE_STENCIL_REFERENCE: 8,
  VK_DYNAMIC_STATE_CULL_MODE: 1000267000,
  VK_DYNAMIC_STATE_CULL_MODE_EXT: 1000267000,
  VK_DYNAMIC_STATE_FRONT_FACE: 1000267001,
  VK_DYNAMIC_STATE_FRONT_FACE_EXT: 1000267001,
  VK_DYNAMIC_STATE_PRIMITIVE_TOPOLOGY: 1000267002,
  VK_DYNAMIC_STATE_PRIMITIVE_TOPOLOGY_EXT: 1000267002,
  VK_DYNAMIC_STATE_VIEWPORT_WITH_COUNT: 1000267003,
  VK_DYNAMIC_STATE_VIEWPORT_WITH_COUNT_EXT: 1000267003,
  VK_DYNAMIC_STATE_SCISSOR_WITH_COUNT: 1000267004,
  VK_DYNAMIC_STATE_SCISSOR_WITH_COUNT_EXT: 1000267004,
  VK_DYNAMIC_STATE_VERTEX_INPUT_BINDING_STRIDE: 1000267005,
  VK_DYNAMIC_STATE_VERTEX_INPUT_BINDING_STRIDE_EXT: 1000267005,
  VK_DYNAMIC_STATE_DEPTH_TEST_ENABLE: 1000267006,
  VK_DYNAMIC_STATE_DEPTH_TEST_ENABLE_EXT: 1000267006,
  VK_DYNAMIC_STATE_DEPTH_WRITE_ENABLE: 1000267007,
  VK_DYNAMIC_STATE_DEPTH_WRITE_ENABLE_EXT: 1000267007,
  VK_DYNAMIC_STATE_DEPTH_COMPARE_OP: 1000267008,
  VK_DYNAMIC_STATE_DEPTH_COMPARE_OP_EXT: 1000267008,
  VK_DYNAMIC_STATE_DEPTH_BOUNDS_TEST_ENABLE: 1000267009,
  VK_DYNAMIC_STATE_DEPTH_BOUNDS_TEST_ENABLE_EXT: 1000267009,
  VK_DYNAMIC_STATE_STENCIL_TEST_ENABLE: 1000267010,
  VK_DYNAMIC_STATE_STENCIL_TEST_ENABLE_EXT: 1000267010,
  VK_DYNAMIC_STATE_STENCIL_OP: 1000267011,
  VK_DYNAMIC_STATE_STENCIL_OP_EXT: 1000267011,
  VK_DYNAMIC_STATE_RASTERIZER_DISCARD_ENABLE: 1000377001,
  VK_DYNAMIC_STATE_RASTERIZER_DISCARD_ENABLE_EXT: 1000377001,
  VK_DYNAMIC_STATE_DEPTH_BIAS_ENABLE: 1000377002,
  VK_DYNAMIC_STATE_DEPTH_BIAS_ENABLE_EXT: 1000377002,
  VK_DYNAMIC_STATE_PRIMITIVE_RESTART_ENABLE: 1000377004,
  VK_DYNAMIC_STATE_PRIMITIVE_RESTART_ENABLE_EXT: 1000377004,
  VK_STENCIL_FACE_FRONT_BIT: 0x1,
  VK_STENCIL_FACE_BACK_BIT: 0x2,
  VK_STENCIL_FACE_FRONT_AND_BACK: 0x3,
  VK_IMAGE_LAYOUT_UNDEFINED: 0,
  VK_IMAGE_LAYOUT_GENERAL: 1,
  VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL: 2,
  VK_IMAGE_LAYOUT_DEPTH_STENCIL_ATTACHMENT_OPTIMAL: 3,
  VK_IMAGE_LAYOUT_DEPTH_STENCIL_READ_ONLY_OPTIMAL: 4,
  VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL: 5,
  VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL: 6,
  VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL: 7,
  VK_IMAGE_LAYOUT_PREINITIALIZED: 8,
  VK_IMAGE_LAYOUT_PRESENT_SRC_KHR: 1000001002,
});

const STRICT_RELEVANT_PREFIXES = Object.freeze([
  "vkCreateShaderModule",
  "vkCreateGraphicsPipeline",
  "vkCreateFramebuffer",
  "vkCreateImage",
  "vkCreateImageView",
  "vkCreateRenderPass",
  "vkUpdateDescriptorSets",
  "vkCmdBeginRender",
  "vkCmdEndRender",
  "vkCmdBindPipeline",
  "vkCmdBindDescriptorSets",
  "vkCmdBindVertexBuffers",
  "vkCmdBindIndexBuffer",
  "vkCmdPushConstants",
  "vkCmdSet",
  "vkCmdDraw",
  "vkCmdPipelineBarrier",
  "vkQueueSubmit",
  "vkQueuePresentKHR",
]);

const SUPPORTED_FUNCTIONS =
  new Set(EVENT_RECONSTRUCTED_VULKAN_FUNCTIONS);

function digest(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function fnv1a64(bytes) {
  let hash = 0xcbf29ce484222325n;
  for (const byte of bytes) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, "0");
}

function fileFact(filename, logicalPath = path.basename(filename)) {
  const bytes = fs.readFileSync(filename);
  return {
    logicalPath,
    byteLength: bytes.length,
    sha256: digest(bytes),
  };
}

function readJson(filename, label) {
  let value;
  try {
    value = JSON.parse(fs.readFileSync(filename, "utf8").replace(/^\uFEFF/, ""));
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error.message}`);
  }
  assert(value && typeof value === "object" && !Array.isArray(value),
    `${label} root must be an object`);
  return value;
}

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map(
      (key) => `${JSON.stringify(key)}:${stable(value[key])}`,
    ).join(",")}}`;
  }
  return JSON.stringify(value);
}

function serialize(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function run(executable, args, options = {}) {
  const result = spawnSync(executable, args, {
    cwd: options.cwd || ROOT,
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024,
  });
  assert.equal(
    result.status,
    0,
    `${path.basename(executable)} failed: ${result.stderr || result.error?.message}`,
  );
  return (result.stdout || "").trim();
}

function enumValue(value, label) {
  if (Number.isInteger(value)) return value;
  assert(typeof value === "string" && value.length > 0, `${label} is absent`);
  if (/^0x[0-9a-f]+$/i.test(value)) return Number.parseInt(value, 16);
  if (/^-?\d+$/.test(value)) return Number(value);
  const parts = value.split("|");
  let result = 0;
  for (const part of parts) {
    const mapped = ENUMS[part];
    assert(Number.isInteger(mapped), `${label} has unsupported enum ${part}`);
    result |= mapped;
  }
  return result;
}

function boolInt(value, label) {
  assert(typeof value === "boolean" || value === 0 || value === 1,
    `${label} must be boolean`);
  return value ? 1 : 0;
}

function handle(value, label) {
  assert(
    typeof value === "string"
      || (Number.isSafeInteger(value) && value >= 0),
    `${label} must be a stable GFXReconstruct handle id`,
  );
  return String(value);
}

function readJsonl(filename) {
  const source = fs.readFileSync(filename, "utf8");
  const records = [];
  for (const [index, line] of source.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    let value;
    try {
      value = JSON.parse(line);
    } catch (error) {
      throw new Error(`${filename}:${index + 1}: ${error.message}`);
    }
    records.push({ ...value, _line: index + 1 });
  }
  assert(records.length > 0, "GFXReconstruct JSONL is empty");
  assert(records[0].header, "GFXReconstruct JSONL header is absent");
  return { source, records };
}

function shaderFileFor(shaderDirectory, module) {
  const exact = path.join(shaderDirectory, `sh${module}`);
  assert(
    fs.statSync(exact, { throwIfNoEntry: false })?.isFile(),
    `gfxrecon-extract shader is absent for module ${module}`,
  );
  return exact;
}

function pushViewportEvents(events, commandBuffer, viewports) {
  for (const [index, viewport] of (viewports || []).entries()) {
    events.push({
      event: "cmd-viewport",
      commandBuffer,
      index,
      x: viewport.x,
      y: viewport.y,
      width: viewport.width,
      height: viewport.height,
      minDepth: viewport.minDepth,
      maxDepth: viewport.maxDepth,
    });
  }
}

function pushScissorEvents(events, commandBuffer, scissors) {
  for (const [index, scissor] of (scissors || []).entries()) {
    events.push({
      event: "cmd-scissor",
      commandBuffer,
      index,
      x: scissor.offset.x,
      y: scissor.offset.y,
      width: scissor.extent.width,
      height: scissor.extent.height,
    });
  }
}

function normalizeStencilFace(value, label) {
  if (!value) return null;
  return {
    failOp: enumValue(value.failOp, `${label}.failOp`),
    passOp: enumValue(value.passOp, `${label}.passOp`),
    depthFailOp: enumValue(value.depthFailOp, `${label}.depthFailOp`),
    compareOp: enumValue(value.compareOp, `${label}.compareOp`),
    compareMask: value.compareMask,
    writeMask: value.writeMask,
    reference: value.reference,
  };
}

function normalizePipeline(events, info, pipeline, shaderByModule) {
  const raster = info.pRasterizationState;
  const depth = info.pDepthStencilState;
  const blend = info.pColorBlendState;
  const input = info.pInputAssemblyState;
  const multisample = info.pMultisampleState;
  const dynamicStates = info.pDynamicState?.pDynamicStates || [];
  assert(raster && input, `graphics pipeline ${pipeline} has no raster/input state`);
  if (info.pDynamicState?.dynamicStateCount != null) {
    assert.equal(
      info.pDynamicState.dynamicStateCount,
      dynamicStates.length,
      `graphics pipeline ${pipeline} dynamic-state denominator differs`,
    );
  }
  events.push({
    event: "graphics-pipeline",
    pipeline,
    flags: enumValue(info.flags ?? "0x00000000", "pipeline.flags"),
    layout: handle(info.layout, "pipeline.layout"),
    renderPass: handle(info.renderPass ?? 0, "pipeline.renderPass"),
    subpass: info.subpass ?? 0,
    topology: enumValue(input.topology, "pipeline.topology"),
    primitiveRestart: boolInt(
      input.primitiveRestartEnable ?? false,
      "pipeline.primitiveRestartEnable",
    ),
    polygonMode: enumValue(raster.polygonMode, "pipeline.polygonMode"),
    cullMode: enumValue(raster.cullMode, "pipeline.cullMode"),
    frontFace: enumValue(raster.frontFace, "pipeline.frontFace"),
    depthClamp: boolInt(
      raster.depthClampEnable ?? false,
      "pipeline.depthClampEnable",
    ),
    rasterizerDiscard: boolInt(
      raster.rasterizerDiscardEnable ?? false,
      "pipeline.rasterizerDiscardEnable",
    ),
    depthBias: boolInt(
      raster.depthBiasEnable ?? false,
      "pipeline.depthBiasEnable",
    ),
    depthBiasConstantFactor: raster.depthBiasConstantFactor ?? 0,
    depthBiasClamp: raster.depthBiasClamp ?? 0,
    depthBiasSlopeFactor: raster.depthBiasSlopeFactor ?? 0,
    lineWidth: raster.lineWidth ?? 1,
    rasterizationSamples: enumValue(
      multisample?.rasterizationSamples ?? "VK_SAMPLE_COUNT_1_BIT",
      "pipeline.rasterizationSamples",
    ),
    sampleShading: boolInt(
      multisample?.sampleShadingEnable ?? false,
      "pipeline.sampleShadingEnable",
    ),
    minSampleShading: multisample?.minSampleShading ?? 0,
    alphaToCoverage: boolInt(
      multisample?.alphaToCoverageEnable ?? false,
      "pipeline.alphaToCoverageEnable",
    ),
    alphaToOne: boolInt(
      multisample?.alphaToOneEnable ?? false,
      "pipeline.alphaToOneEnable",
    ),
    depthTest: boolInt(depth?.depthTestEnable ?? false, "depthTestEnable"),
    depthWrite: boolInt(depth?.depthWriteEnable ?? false, "depthWriteEnable"),
    depthCompareOp: enumValue(
      depth?.depthCompareOp ?? "VK_COMPARE_OP_ALWAYS",
      "depthCompareOp",
    ),
    depthBoundsTest: boolInt(
      depth?.depthBoundsTestEnable ?? false,
      "pipeline.depthBoundsTestEnable",
    ),
    stencilTest: boolInt(
      depth?.stencilTestEnable ?? false,
      "pipeline.stencilTestEnable",
    ),
    frontStencil: normalizeStencilFace(depth?.front, "pipeline.front"),
    backStencil: normalizeStencilFace(depth?.back, "pipeline.back"),
    minDepthBounds: depth?.minDepthBounds ?? 0,
    maxDepthBounds: depth?.maxDepthBounds ?? 1,
    blendAttachmentCount: blend?.attachmentCount ?? 0,
    logicOp: boolInt(
      blend?.logicOpEnable ?? false,
      "pipeline.logicOpEnable",
    ),
    logicOpValue: blend?.logicOp == null
      ? null
      : enumValue(blend.logicOp, "pipeline.logicOp"),
    blendConstants: blend?.blendConstants || [0, 0, 0, 0],
    dynamicStateCount: dynamicStates.length,
    dynamicStates: dynamicStates.map((state) => (
      enumValue(state, "pipeline.dynamicState")
    )),
  });
  for (const [stageIndex, stage] of (info.pStages || []).entries()) {
    const module = handle(stage.module, "pipeline stage module");
    const shader = shaderByModule.get(module);
    assert(shader, `pipeline ${pipeline} references unknown shader ${module}`);
    events.push({
      event: "pipeline-stage",
      pipeline,
      stageIndex,
      stage: enumValue(stage.stage, "pipeline stage"),
      module,
      entry: stage.pName,
      specializationCount:
        stage.pSpecializationInfo?.mapEntryCount ?? 0,
      fnv1a64: shader.fnv1a64,
    });
  }
  for (const [attachment, state] of (blend?.pAttachments || []).entries()) {
    events.push({
      event: "blend-attachment",
      pipeline,
      attachment,
      enable: boolInt(state.blendEnable, "blendEnable"),
      srcColor: enumValue(state.srcColorBlendFactor, "srcColorBlendFactor"),
      dstColor: enumValue(state.dstColorBlendFactor, "dstColorBlendFactor"),
      colorOp: enumValue(state.colorBlendOp, "colorBlendOp"),
      srcAlpha: enumValue(state.srcAlphaBlendFactor, "srcAlphaBlendFactor"),
      dstAlpha: enumValue(state.dstAlphaBlendFactor, "dstAlphaBlendFactor"),
      alphaOp: enumValue(state.alphaBlendOp, "alphaBlendOp"),
      writeMask: enumValue(state.colorWriteMask, "colorWriteMask"),
    });
  }
}

function descriptorEvents(events, writes) {
  for (const write of writes || []) {
    const set = handle(write.dstSet, "descriptor dstSet");
    const binding = write.dstBinding;
    const first = write.dstArrayElement || 0;
    if (Array.isArray(write.pImageInfo)) {
      for (const [ordinal, image] of write.pImageInfo.entries()) {
        events.push({
          event: "descriptor-image",
          set,
          binding,
          item: first + ordinal,
          sampler: handle(image.sampler ?? 0, "descriptor sampler"),
          view: handle(image.imageView ?? 0, "descriptor imageView"),
          layout: enumValue(image.imageLayout, "descriptor imageLayout"),
        });
      }
    }
    if (Array.isArray(write.pBufferInfo)) {
      for (const [ordinal, buffer] of write.pBufferInfo.entries()) {
        events.push({
          event: "descriptor-buffer",
          set,
          binding,
          item: first + ordinal,
          buffer: handle(buffer.buffer, "descriptor buffer"),
          offset: buffer.offset,
          range: buffer.range,
        });
      }
    }
  }
}

function submitEvents(events, name, args) {
  const queue = handle(args.queue, "submit queue");
  const infos = args.pSubmits || [];
  events.push({
    event: "queue-submit",
    queue,
    submitCount: args.submitCount,
    fence: handle(args.fence ?? 0, "submit fence"),
  });
  for (const [submitIndex, submit] of infos.entries()) {
    const modern = name !== "vkQueueSubmit";
    const commandBuffers = modern
      ? (submit.pCommandBufferInfos || []).map((item) => item.commandBuffer)
      : (submit.pCommandBuffers || []);
    events.push({
      event: "submit-info",
      queue,
      submitIndex,
      waitCount: modern
        ? submit.waitSemaphoreInfoCount
        : submit.waitSemaphoreCount,
      commandBufferCount: modern
        ? submit.commandBufferInfoCount
        : submit.commandBufferCount,
      signalCount: modern
        ? submit.signalSemaphoreInfoCount
        : submit.signalSemaphoreCount,
    });
    commandBuffers.forEach((commandBuffer, ordinal) => {
      events.push({
        event: "submit-command-buffer",
        queue,
        submitIndex,
        ordinal,
        commandBuffer: handle(commandBuffer, "submitted commandBuffer"),
      });
    });
  }
}

function imageBarrierEvents(events, commandBuffer, sourceCall, barriers) {
  for (const [index, barrier] of (barriers || []).entries()) {
    events.push({
      event: "cmd-image-barrier",
      commandBuffer,
      sourceCall,
      index,
      image: handle(barrier.image, "image barrier image"),
      oldLayout: enumValue(barrier.oldLayout, "image barrier oldLayout"),
      newLayout: enumValue(barrier.newLayout, "image barrier newLayout"),
      srcQueueFamilyIndex: barrier.srcQueueFamilyIndex,
      dstQueueFamilyIndex: barrier.dstQueueFamilyIndex,
      subresourceRange: barrier.subresourceRange,
    });
  }
}

export function convertGfxreconJsonl({
  jsonlPath,
  shaderDirectory,
  tracePath = null,
  toolchain = null,
}) {
  const { source, records } = readJsonl(jsonlPath);
  const functions = records
    .filter((record) => record.function)
    .map((record) => ({
      ...record.function,
      _index: record.index,
      _line: record._line,
    }));
  const unsupportedRelevant = [...new Set(
    functions
      .map(({ name }) => name)
      .filter((name) => (
        STRICT_RELEVANT_PREFIXES.some((prefix) => name.startsWith(prefix))
        && !SUPPORTED_FUNCTIONS.has(name)
      )),
  )].sort();
  assert.deepEqual(
    unsupportedRelevant,
    [],
    `unsupported relevant Vulkan calls: ${unsupportedRelevant.join(", ")}`,
  );
  const functionBoundaries = classifyVulkanFunctionBoundaries(
    functions.map(({ name }) => name),
  );

  const events = [];
  const shaderByModule = new Map();
  const traceSha256 = tracePath
    ? fileFact(tracePath, "trace.gfxr").sha256
    : digest(Buffer.from(source));
  const captureId = traceSha256.slice(0, 16);
  events.push({ event: "capture-start", captureId });
  let presentIndex = 0;
  let dynamicScope = 0;

  for (const call of functions) {
    const args = call.args || {};
    switch (call.name) {
      case "vkCreateShaderModule": {
        const module = handle(args.pShaderModule, "shader module");
        const filename = shaderFileFor(shaderDirectory, module);
        const bytes = fs.readFileSync(filename);
        assert(
          bytes.length >= 20
            && bytes.length % 4 === 0
            && bytes.readUInt32LE(0) === 0x07230203,
          `shader module ${module} is not SPIR-V`,
        );
        assert.equal(bytes.length, args.pCreateInfo.codeSize);
        const shader = {
          module,
          fnv1a64: fnv1a64(bytes),
          codeSize: bytes.length,
          sha256: digest(bytes),
          source: filename,
        };
        shaderByModule.set(module, shader);
        events.push({
          event: "shader-module",
          module,
          fnv1a64: shader.fnv1a64,
          codeSize: shader.codeSize,
        });
        break;
      }
      case "vkCreateGraphicsPipelines":
        assert.equal(args.createInfoCount, args.pCreateInfos.length);
        assert.equal(args.createInfoCount, args.pPipelines.length);
        args.pCreateInfos.forEach((info, index) => {
          normalizePipeline(
            events,
            info,
            handle(args.pPipelines[index], "graphics pipeline"),
            shaderByModule,
          );
        });
        break;
      case "vkCreateFramebuffer": {
        const info = args.pCreateInfo;
        const framebuffer = handle(args.pFramebuffer, "framebuffer");
        events.push({
          event: "framebuffer",
          framebuffer,
          renderPass: handle(info.renderPass, "framebuffer renderPass"),
          attachmentCount: info.attachmentCount,
          width: info.width,
          height: info.height,
          layers: info.layers,
        });
        (info.pAttachments || []).forEach((view, index) => {
          events.push({
            event: "framebuffer-attachment",
            framebuffer,
            index,
            view: handle(view, "framebuffer attachment"),
          });
        });
        break;
      }
      case "vkCreateImage": {
        const info = args.pCreateInfo;
        events.push({
          event: "image",
          image: handle(args.pImage, "image"),
          imageType: info.imageType,
          format: info.format,
          extent: info.extent,
          mipLevels: info.mipLevels,
          arrayLayers: info.arrayLayers,
          samples: info.samples,
          tiling: info.tiling,
          usage: info.usage,
          initialLayout: enumValue(info.initialLayout, "image initialLayout"),
        });
        break;
      }
      case "vkCreateImageView": {
        const info = args.pCreateInfo;
        events.push({
          event: "image-view",
          view: handle(args.pView, "image view"),
          image: handle(info.image, "view image"),
          viewType: info.viewType,
          format: info.format,
          components: info.components,
          subresourceRange: info.subresourceRange,
        });
        break;
      }
      case "vkCreateRenderPass":
      case "vkCreateRenderPass2":
      case "vkCreateRenderPass2KHR": {
        const info = args.pCreateInfo;
        events.push({
          event: "render-pass",
          renderPass: handle(args.pRenderPass, "render pass"),
          sourceCall: call.name,
          attachments: info.pAttachments || [],
          subpasses: info.pSubpasses || [],
          dependencies: info.pDependencies || [],
        });
        break;
      }
      case "vkUpdateDescriptorSets":
        descriptorEvents(events, args.pDescriptorWrites);
        break;
      case "vkCmdBeginRenderPass":
      case "vkCmdBeginRenderPass2":
      case "vkCmdBeginRenderPass2KHR": {
        const commandBuffer = handle(args.commandBuffer, "commandBuffer");
        const info = args.pRenderPassBegin;
        events.push({
          event: call.name.includes("2")
            ? "cmd-begin-render-pass2"
            : "cmd-begin-render-pass",
          commandBuffer,
          renderPass: handle(info.renderPass, "renderPass"),
          framebuffer: handle(info.framebuffer, "framebuffer"),
          x: info.renderArea.offset.x,
          y: info.renderArea.offset.y,
          width: info.renderArea.extent.width,
          height: info.renderArea.extent.height,
        });
        break;
      }
      case "vkCmdBeginRendering":
      case "vkCmdBeginRenderingKHR": {
        const commandBuffer = handle(args.commandBuffer, "commandBuffer");
        const info = args.pRenderingInfo;
        const framebuffer = `dynamic:${commandBuffer}:${dynamicScope++}`;
        const views = [
          ...(info.pColorAttachments || []).map((item) => item.imageView),
          ...(info.pDepthAttachment ? [info.pDepthAttachment.imageView] : []),
          ...(info.pStencilAttachment ? [info.pStencilAttachment.imageView] : []),
        ];
        events.push({
          event: "framebuffer",
          framebuffer,
          renderPass: "dynamic-rendering",
          attachmentCount: views.length,
          width: info.renderArea.extent.width,
          height: info.renderArea.extent.height,
          layers: info.layerCount,
        });
        views.forEach((view, index) => events.push({
          event: "framebuffer-attachment",
          framebuffer,
          index,
          view: handle(view, "dynamic attachment"),
        }));
        events.push({
          event: "cmd-begin-render-pass2",
          commandBuffer,
          renderPass: "dynamic-rendering",
          framebuffer,
          x: info.renderArea.offset.x,
          y: info.renderArea.offset.y,
          width: info.renderArea.extent.width,
          height: info.renderArea.extent.height,
        });
        break;
      }
      case "vkCmdEndRenderPass":
      case "vkCmdEndRenderPass2":
      case "vkCmdEndRenderPass2KHR":
      case "vkCmdEndRendering":
      case "vkCmdEndRenderingKHR":
        events.push({
          event: call.name.includes("2") || call.name.includes("Rendering")
            ? "cmd-end-render-pass2"
            : "cmd-end-render-pass",
          commandBuffer: handle(args.commandBuffer, "commandBuffer"),
        });
        break;
      case "vkCmdBindPipeline":
        events.push({
          event: "cmd-bind-pipeline",
          commandBuffer: handle(args.commandBuffer, "commandBuffer"),
          bindPoint: enumValue(args.pipelineBindPoint, "pipelineBindPoint"),
          pipeline: handle(args.pipeline, "bound pipeline"),
        });
        break;
      case "vkCmdBindDescriptorSets": {
        const commandBuffer = handle(args.commandBuffer, "commandBuffer");
        const bindPoint = enumValue(
          args.pipelineBindPoint,
          "descriptor pipelineBindPoint",
        );
        events.push({
          event: "cmd-bind-descriptor-sets",
          commandBuffer,
          bindPoint,
        });
        (args.pDescriptorSets || []).forEach((set, ordinal) => events.push({
          event: "cmd-bound-set",
          commandBuffer,
          setIndex: args.firstSet + ordinal,
          set: handle(set, "bound descriptor set"),
        }));
        if ((args.pDynamicOffsets || []).length > 0) {
          events.push({
            event: "cmd-dynamic-offsets",
            commandBuffer,
            valuesLE: args.pDynamicOffsets,
          });
        }
        break;
      }
      case "vkCmdBindVertexBuffers":
      case "vkCmdBindVertexBuffers2":
      case "vkCmdBindVertexBuffers2EXT": {
        const commandBuffer = handle(args.commandBuffer, "commandBuffer");
        (args.pBuffers || []).forEach((buffer, ordinal) => events.push({
          event: "cmd-bind-vertex-buffer",
          commandBuffer,
          binding: args.firstBinding + ordinal,
          buffer: handle(buffer, "vertex buffer"),
          offset: args.pOffsets?.[ordinal] ?? 0,
          size: args.pSizes?.[ordinal] ?? null,
          stride: args.pStrides?.[ordinal] ?? null,
        }));
        break;
      }
      case "vkCmdBindIndexBuffer":
        events.push({
          event: "cmd-bind-index-buffer",
          commandBuffer: handle(args.commandBuffer, "commandBuffer"),
          buffer: handle(args.buffer, "index buffer"),
          offset: args.offset,
          indexType: enumValue(args.indexType, "indexType"),
        });
        break;
      case "vkCmdPushConstants":
        events.push({
          event: "cmd-push-constants",
          commandBuffer: handle(args.commandBuffer, "commandBuffer"),
          layout: handle(args.layout, "push constant layout"),
          stageFlags: enumValue(args.stageFlags, "push constant stageFlags"),
          offset: args.offset,
          size: args.size,
          values: args.pValues,
        });
        break;
      case "vkCmdSetViewport":
      case "vkCmdSetViewportWithCount":
      case "vkCmdSetViewportWithCountEXT":
        pushViewportEvents(
          events,
          handle(args.commandBuffer, "commandBuffer"),
          args.pViewports,
        );
        break;
      case "vkCmdSetScissor":
      case "vkCmdSetScissorWithCount":
      case "vkCmdSetScissorWithCountEXT":
        pushScissorEvents(
          events,
          handle(args.commandBuffer, "commandBuffer"),
          args.pScissors,
        );
        break;
      case "vkCmdSetCullMode":
      case "vkCmdSetCullModeEXT":
        events.push({
          event: "cmd-dynamic-pipeline-state",
          commandBuffer: handle(args.commandBuffer, "commandBuffer"),
          state: "cullMode",
          value: enumValue(args.cullMode, "dynamic cullMode"),
        });
        break;
      case "vkCmdSetFrontFace":
      case "vkCmdSetFrontFaceEXT":
        events.push({
          event: "cmd-dynamic-pipeline-state",
          commandBuffer: handle(args.commandBuffer, "commandBuffer"),
          state: "frontFace",
          value: enumValue(args.frontFace, "dynamic frontFace"),
        });
        break;
      case "vkCmdSetPrimitiveTopology":
      case "vkCmdSetPrimitiveTopologyEXT":
        events.push({
          event: "cmd-dynamic-pipeline-state",
          commandBuffer: handle(args.commandBuffer, "commandBuffer"),
          state: "topology",
          value: enumValue(
            args.primitiveTopology,
            "dynamic primitiveTopology",
          ),
        });
        break;
      case "vkCmdSetDepthTestEnable":
      case "vkCmdSetDepthTestEnableEXT":
        events.push({
          event: "cmd-dynamic-pipeline-state",
          commandBuffer: handle(args.commandBuffer, "commandBuffer"),
          state: "depthTest",
          value: boolInt(args.depthTestEnable, "dynamic depthTestEnable"),
        });
        break;
      case "vkCmdSetDepthWriteEnable":
      case "vkCmdSetDepthWriteEnableEXT":
        events.push({
          event: "cmd-dynamic-pipeline-state",
          commandBuffer: handle(args.commandBuffer, "commandBuffer"),
          state: "depthWrite",
          value: boolInt(
            args.depthWriteEnable,
            "dynamic depthWriteEnable",
          ),
        });
        break;
      case "vkCmdSetDepthCompareOp":
      case "vkCmdSetDepthCompareOpEXT":
        events.push({
          event: "cmd-dynamic-pipeline-state",
          commandBuffer: handle(args.commandBuffer, "commandBuffer"),
          state: "depthCompareOp",
          value: enumValue(args.depthCompareOp, "dynamic depthCompareOp"),
        });
        break;
      case "vkCmdSetStencilTestEnable":
      case "vkCmdSetStencilTestEnableEXT":
        events.push({
          event: "cmd-dynamic-pipeline-state",
          commandBuffer: handle(args.commandBuffer, "commandBuffer"),
          state: "stencilTest",
          value: boolInt(
            args.stencilTestEnable,
            "dynamic stencilTestEnable",
          ),
        });
        break;
      case "vkCmdSetStencilOp":
      case "vkCmdSetStencilOpEXT":
        events.push({
          event: "cmd-dynamic-stencil-state",
          commandBuffer: handle(args.commandBuffer, "commandBuffer"),
          faceMask: enumValue(args.faceMask, "dynamic stencil faceMask"),
          values: {
            failOp: enumValue(args.failOp, "dynamic stencil failOp"),
            passOp: enumValue(args.passOp, "dynamic stencil passOp"),
            depthFailOp: enumValue(
              args.depthFailOp,
              "dynamic stencil depthFailOp",
            ),
            compareOp: enumValue(
              args.compareOp,
              "dynamic stencil compareOp",
            ),
          },
        });
        break;
      case "vkCmdSetStencilCompareMask":
      case "vkCmdSetStencilWriteMask":
      case "vkCmdSetStencilReference": {
        const field = {
          vkCmdSetStencilCompareMask: "compareMask",
          vkCmdSetStencilWriteMask: "writeMask",
          vkCmdSetStencilReference: "reference",
        }[call.name];
        const value = {
          compareMask: args.compareMask,
          writeMask: args.writeMask,
          reference: args.reference,
        }[field];
        events.push({
          event: "cmd-dynamic-stencil-state",
          commandBuffer: handle(args.commandBuffer, "commandBuffer"),
          faceMask: enumValue(args.faceMask, "dynamic stencil faceMask"),
          values: { [field]: value },
        });
        break;
      }
      case "vkCmdSetLineWidth":
        events.push({
          event: "cmd-dynamic-pipeline-state",
          commandBuffer: handle(args.commandBuffer, "commandBuffer"),
          state: "lineWidth",
          value: args.lineWidth,
        });
        break;
      case "vkCmdSetDepthBias":
        events.push({
          event: "cmd-dynamic-pipeline-values",
          commandBuffer: handle(args.commandBuffer, "commandBuffer"),
          values: {
            depthBiasConstantFactor: args.depthBiasConstantFactor,
            depthBiasClamp: args.depthBiasClamp,
            depthBiasSlopeFactor: args.depthBiasSlopeFactor,
          },
        });
        break;
      case "vkCmdSetBlendConstants":
        events.push({
          event: "cmd-dynamic-pipeline-state",
          commandBuffer: handle(args.commandBuffer, "commandBuffer"),
          state: "blendConstants",
          value: args.blendConstants,
        });
        break;
      case "vkCmdSetDepthBounds":
        events.push({
          event: "cmd-dynamic-pipeline-values",
          commandBuffer: handle(args.commandBuffer, "commandBuffer"),
          values: {
            minDepthBounds: args.minDepthBounds,
            maxDepthBounds: args.maxDepthBounds,
          },
        });
        break;
      case "vkCmdSetRasterizerDiscardEnable":
      case "vkCmdSetRasterizerDiscardEnableEXT":
        events.push({
          event: "cmd-dynamic-pipeline-state",
          commandBuffer: handle(args.commandBuffer, "commandBuffer"),
          state: "rasterizerDiscard",
          value: boolInt(
            args.rasterizerDiscardEnable,
            "dynamic rasterizerDiscardEnable",
          ),
        });
        break;
      case "vkCmdSetDepthBiasEnable":
      case "vkCmdSetDepthBiasEnableEXT":
        events.push({
          event: "cmd-dynamic-pipeline-state",
          commandBuffer: handle(args.commandBuffer, "commandBuffer"),
          state: "depthBias",
          value: boolInt(
            args.depthBiasEnable,
            "dynamic depthBiasEnable",
          ),
        });
        break;
      case "vkCmdSetPrimitiveRestartEnable":
      case "vkCmdSetPrimitiveRestartEnableEXT":
        events.push({
          event: "cmd-dynamic-pipeline-state",
          commandBuffer: handle(args.commandBuffer, "commandBuffer"),
          state: "primitiveRestart",
          value: boolInt(
            args.primitiveRestartEnable,
            "dynamic primitiveRestartEnable",
          ),
        });
        break;
      case "vkCmdDraw":
      case "vkCmdDrawIndexed":
        events.push({
          event: call.name === "vkCmdDraw"
            ? "cmd-draw"
            : "cmd-draw-indexed",
          commandBuffer: handle(args.commandBuffer, "commandBuffer"),
          ...(call.name === "vkCmdDraw"
            ? {
                vertexCount: args.vertexCount,
                firstVertex: args.firstVertex,
              }
            : {
                indexCount: args.indexCount,
                firstIndex: args.firstIndex,
                vertexOffset: args.vertexOffset,
              }),
          instanceCount: args.instanceCount,
          firstInstance: args.firstInstance,
        });
        break;
      case "vkCmdPipelineBarrier":
      case "vkCmdPipelineBarrier2":
      case "vkCmdPipelineBarrier2KHR": {
        const commandBuffer = handle(args.commandBuffer, "commandBuffer");
        const imageBarriers =
          args.pImageMemoryBarriers
          || args.pDependencyInfo?.pImageMemoryBarriers
          || [];
        events.push({
          event: "cmd-pipeline-barrier",
          commandBuffer,
          sourceCall: call.name,
          imageBarrierCount: imageBarriers.length,
          bufferBarrierCount: (
            args.pBufferMemoryBarriers
            || args.pDependencyInfo?.pBufferMemoryBarriers
            || []
          ).length,
          bufferBarriers:
            args.pBufferMemoryBarriers
            || args.pDependencyInfo?.pBufferMemoryBarriers
            || [],
        });
        imageBarrierEvents(
          events,
          commandBuffer,
          call.name,
          imageBarriers,
        );
        break;
      }
      case "vkQueueSubmit":
      case "vkQueueSubmit2":
      case "vkQueueSubmit2KHR":
        submitEvents(events, call.name, args);
        break;
      case "vkQueuePresentKHR":
        events.push({
          event: "present",
          captureId,
          presentIndex: presentIndex++,
          swapchainCount: args.pPresentInfo.swapchainCount,
          result: call.return === "VK_SUCCESS" ? 0 : call.return,
        });
        break;
      default:
        break;
    }
  }
  assert(shaderByModule.size > 0, "capture has no shader modules");
  assert(events.some(({ event }) => event === "graphics-pipeline"),
    "capture has no graphics pipelines");
  assert(events.some(({ event }) => event === "cmd-draw"
    || event === "cmd-draw-indexed"), "capture has no draw calls");
  assert(events.some(({ event }) => event === "present"),
    "capture has no queue present");

  const shaderArtifacts = [...shaderByModule.values()]
    .sort((left, right) => left.module.localeCompare(right.module))
    .map(({ source: _source, ...shader }) => shader);
  const functionNames = [...new Set(functions.map(({ name }) => name))].sort();
  const manifest = {
    schema: SCHEMA,
    schemaVersion: 1,
    status: "exact-gfxreconstruct-jsonl-to-audit-events",
    scope: {
      sourceApi: "Vulkan",
      sourceTracePreserved: Boolean(tracePath),
      framebufferPixelsRead: false,
      bufferMemoryReconstructed: false,
      stateReconstruction: functionBoundaries.unreconstructedFunctionCallCount
        ? "partial-runtime-required"
        : "event-reconstructed-observed-subset",
      vulkanFunctionBoundaryContract: functionBoundaries.contract,
      unreconstructedFunctionFamilies:
        functionBoundaries.families.map(({ id }) => id),
      officialShaderRestorationPercent: null,
    },
    toolchain,
    inputs: {
      trace: tracePath ? fileFact(tracePath, "trace.gfxr") : null,
      gfxreconstructJsonl: fileFact(jsonlPath, "gfxreconstruct.jsonl"),
      header: {
        ...records[0].header,
        ...("source-path" in records[0].header
          ? {
            "source-path": path.basename(
              String(records[0].header["source-path"]),
            ),
          }
          : {}),
      },
    },
    summary: {
      sourceRecordCount: records.length,
      sourceFunctionCount: functions.length,
      uniqueFunctionCount: functionNames.length,
      emittedEventCount: events.length,
      shaderModuleCount: shaderArtifacts.length,
      presentCount: presentIndex,
      unsupportedRelevantFunctionCount: unsupportedRelevant.length,
      eventReconstructedFunctionCount:
        functionBoundaries.eventReconstructedFunctionCallCount,
      unreconstructedFunctionCount:
        functionBoundaries.unreconstructedFunctionCallCount,
      unreconstructedUniqueFunctionCount:
        functionBoundaries.unreconstructedUniqueFunctionCount,
      unreconstructedFamilyCount:
        functionBoundaries.unreconstructedFamilyCount,
    },
    sourceFunctions: functionNames,
    unsupportedRelevantFunctions: unsupportedRelevant,
    unreconstructedVulkanFunctions: functionBoundaries.families,
    shaderModules: shaderArtifacts,
  };
  manifest.proofSha256 = digest(Buffer.from(stable(manifest)));
  return { events, manifest, shaderByModule };
}

function parseArgs(argv) {
  const args = {
    trace: null,
    output: null,
    gfxreconBin:
      process.env.GFXRECON_BIN
      || (process.env.VULKAN_SDK
        ? path.join(process.env.VULKAN_SDK, "Bin")
        : null),
    toolchainManifest: DEFAULT_TOOLCHAIN_MANIFEST,
    check: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--trace") args.trace = argv[++index];
    else if (token === "--output") args.output = argv[++index];
    else if (token === "--gfxrecon-bin") args.gfxreconBin = argv[++index];
    else if (token === "--toolchain-manifest") {
      args.toolchainManifest = argv[++index];
    }
    else if (token === "--check") args.check = true;
    else throw new Error(`unknown argument: ${token}`);
  }
  assert(args.trace, "--trace is required");
  assert(args.output, "--output is required");
  return args;
}

function toolFact(executable) {
  const version = run(executable, ["--version"]);
  return {
    ...fileFact(executable, path.basename(executable)),
    version,
  };
}

export function validateToolFact(actual, expected, label) {
  assert.equal(
    actual.logicalPath,
    expected.executable,
    `${label} executable name differs from the pinned toolchain`,
  );
  assert.equal(
    actual.byteLength,
    expected.byteLength,
    `${label} byte length differs from the pinned toolchain`,
  );
  assert.equal(
    actual.sha256,
    expected.sha256,
    `${label} SHA-256 differs from the pinned toolchain`,
  );
  assert(Array.isArray(expected.versionIncludes)
    && expected.versionIncludes.length > 0,
  `${label} pinned version signatures are absent`);
  for (const signature of expected.versionIncludes) {
    assert(
      actual.version.includes(signature),
      `${label} version output does not contain ${signature}`,
    );
  }
  return actual;
}

function loadToolchainManifest(filename) {
  const absolute = path.resolve(filename);
  const value = readJson(absolute, "GFXReconstruct toolchain manifest");
  assert.equal(value.schema, TOOLCHAIN_SCHEMA);
  assert.equal(
    value.platform,
    process.platform,
    "GFXReconstruct toolchain platform differs from the host",
  );
  assert.equal(
    value.architecture,
    process.arch,
    "GFXReconstruct toolchain architecture differs from the host",
  );
  assert(value.tools?.converter && value.tools?.extractor,
    "GFXReconstruct toolchain must pin converter and extractor");
  return {
    absolute,
    value,
    identity: fileFact(
      absolute,
      path.relative(ROOT, absolute).replaceAll("\\", "/"),
    ),
  };
}

export function convertGfxreconCapture({
  trace,
  output,
  gfxreconBin =
    process.env.GFXRECON_BIN
    || (process.env.VULKAN_SDK
      ? path.join(process.env.VULKAN_SDK, "Bin")
      : null),
  toolchainManifest = DEFAULT_TOOLCHAIN_MANIFEST,
  check = false,
}) {
  const tracePath = path.resolve(trace);
  const outputPath = path.resolve(output);
  assert(fs.statSync(tracePath, { throwIfNoEntry: false })?.isFile(),
    `trace is absent: ${tracePath}`);
  assert(gfxreconBin,
    "GFXReconstruct bin is absent; set GFXRECON_BIN or VULKAN_SDK");
  const pinnedToolchain = loadToolchainManifest(toolchainManifest);
  const converter = path.join(
    path.resolve(gfxreconBin),
    pinnedToolchain.value.tools.converter.executable,
  );
  const extractor = path.join(
    path.resolve(gfxreconBin),
    pinnedToolchain.value.tools.extractor.executable,
  );
  assert(fs.existsSync(converter), `gfxrecon-convert is absent: ${converter}`);
  assert(fs.existsSync(extractor), `gfxrecon-extract is absent: ${extractor}`);

  const staging = createStagingDirectorySync(outputPath);
  try {
    const jsonlPath = path.join(staging, "gfxreconstruct.jsonl");
    const shaderDirectory = path.join(staging, "extracted-shaders");
    fs.mkdirSync(shaderDirectory);
    run(converter, [
      tracePath,
      "--output",
      jsonlPath,
      "--format",
      "jsonl",
      "--include-binaries",
      "--expand-flags",
      "--log-level",
      "error",
    ]);
    run(extractor, ["--dir", shaderDirectory, tracePath]);
    const toolchain = {
      manifest: pinnedToolchain.identity,
      toolchainId: pinnedToolchain.value.toolchainId,
      converter: validateToolFact(
        toolFact(converter),
        pinnedToolchain.value.tools.converter,
        "gfxrecon-convert",
      ),
      extractor: validateToolFact(
        toolFact(extractor),
        pinnedToolchain.value.tools.extractor,
        "gfxrecon-extract",
      ),
    };
    const converted = convertGfxreconJsonl({
      jsonlPath,
      shaderDirectory,
      tracePath,
      toolchain,
    });
    fs.copyFileSync(tracePath, path.join(staging, "trace.gfxr"));
    const eventsSource = `${converted.events.map(
      (event) => JSON.stringify(event),
    ).join("\n")}\n`;
    atomicWriteFileSync(path.join(staging, "events.jsonl"), eventsSource);
    for (const shader of converted.shaderByModule.values()) {
      fs.copyFileSync(
        shader.source,
        path.join(
          staging,
          `shader-${shader.fnv1a64}-${shader.codeSize}.spv`,
        ),
      );
    }
    const manifest = {
      ...converted.manifest,
      artifacts: {
        events: {
          logicalPath: "events.jsonl",
          byteLength: Buffer.byteLength(eventsSource),
          sha256: digest(Buffer.from(eventsSource)),
        },
      },
    };
    manifest.proofSha256 = digest(Buffer.from(stable(
      Object.fromEntries(
        Object.entries(manifest).filter(([key]) => key !== "proofSha256"),
      ),
    )));
    atomicWriteFileSync(
      path.join(staging, "conversion-manifest.json"),
      serialize(manifest),
    );
    if (check) {
      assert(fs.existsSync(outputPath), `output is absent: ${outputPath}`);
      const expected = listFiles(staging);
      const actual = listFiles(outputPath);
      assert.deepEqual(actual, expected, "converted capture file list is stale");
      for (const relative of expected) {
        assert.deepEqual(
          fileFact(path.join(outputPath, relative)),
          fileFact(path.join(staging, relative)),
          `converted capture is stale: ${relative}`,
        );
      }
      fs.rmSync(staging, { recursive: true, force: true });
    } else {
      publishDirectorySync(staging, outputPath);
    }
    return manifest;
  } catch (error) {
    fs.rmSync(staging, { recursive: true, force: true });
    throw error;
  }
}

function listFiles(root) {
  const result = [];
  function visit(directory, prefix) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name))) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute, relative);
      else if (entry.isFile()) result.push(relative);
      else throw new Error(`unsupported artifact type: ${relative}`);
    }
  }
  visit(root, "");
  return result;
}

if (process.argv[1]
    && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const report = convertGfxreconCapture(parseArgs(process.argv.slice(2)));
    console.log(
      `converted GFXReconstruct trace: `
      + `${report.summary.emittedEventCount} events, `
      + `${report.summary.shaderModuleCount} shaders`,
    );
  } catch (error) {
    console.error(`BAD GFXReconstruct capture conversion: ${error.message}`);
    process.exitCode = 1;
  }
}
