import assert from "node:assert/strict";
import crypto from "node:crypto";

export const GFXRECON_STATE_BOUNDARY_SCHEMA =
  "pocket-card-render/gfxreconstruct-state-boundary-contract@1";

export const EVENT_RECONSTRUCTED_VULKAN_FUNCTIONS = Object.freeze([
  "vkCreateShaderModule",
  "vkCreateGraphicsPipelines",
  "vkCreateFramebuffer",
  "vkCreateImage",
  "vkCreateImageView",
  "vkCreateRenderPass",
  "vkCreateRenderPass2",
  "vkCreateRenderPass2KHR",
  "vkUpdateDescriptorSets",
  "vkCmdBeginRenderPass",
  "vkCmdBeginRenderPass2",
  "vkCmdBeginRenderPass2KHR",
  "vkCmdEndRenderPass",
  "vkCmdEndRenderPass2",
  "vkCmdEndRenderPass2KHR",
  "vkCmdBeginRendering",
  "vkCmdBeginRenderingKHR",
  "vkCmdEndRendering",
  "vkCmdEndRenderingKHR",
  "vkCmdBindPipeline",
  "vkCmdBindDescriptorSets",
  "vkCmdBindVertexBuffers",
  "vkCmdBindVertexBuffers2",
  "vkCmdBindVertexBuffers2EXT",
  "vkCmdBindIndexBuffer",
  "vkCmdPushConstants",
  "vkCmdSetViewport",
  "vkCmdSetViewportWithCount",
  "vkCmdSetViewportWithCountEXT",
  "vkCmdSetScissor",
  "vkCmdSetScissorWithCount",
  "vkCmdSetScissorWithCountEXT",
  "vkCmdSetCullMode",
  "vkCmdSetCullModeEXT",
  "vkCmdSetFrontFace",
  "vkCmdSetFrontFaceEXT",
  "vkCmdSetPrimitiveTopology",
  "vkCmdSetPrimitiveTopologyEXT",
  "vkCmdSetDepthTestEnable",
  "vkCmdSetDepthTestEnableEXT",
  "vkCmdSetDepthWriteEnable",
  "vkCmdSetDepthWriteEnableEXT",
  "vkCmdSetDepthCompareOp",
  "vkCmdSetDepthCompareOpEXT",
  "vkCmdSetStencilTestEnable",
  "vkCmdSetStencilTestEnableEXT",
  "vkCmdSetStencilOp",
  "vkCmdSetStencilOpEXT",
  "vkCmdSetStencilCompareMask",
  "vkCmdSetStencilWriteMask",
  "vkCmdSetStencilReference",
  "vkCmdSetLineWidth",
  "vkCmdSetDepthBias",
  "vkCmdSetBlendConstants",
  "vkCmdSetDepthBounds",
  "vkCmdSetRasterizerDiscardEnable",
  "vkCmdSetRasterizerDiscardEnableEXT",
  "vkCmdSetDepthBiasEnable",
  "vkCmdSetDepthBiasEnableEXT",
  "vkCmdSetPrimitiveRestartEnable",
  "vkCmdSetPrimitiveRestartEnableEXT",
  "vkCmdDraw",
  "vkCmdDrawIndexed",
  "vkCmdPipelineBarrier",
  "vkCmdPipelineBarrier2",
  "vkCmdPipelineBarrier2KHR",
  "vkQueueSubmit",
  "vkQueueSubmit2",
  "vkQueueSubmit2KHR",
  "vkQueuePresentKHR",
]);

const FAMILY_DEFINITIONS = Object.freeze([
  Object.freeze({
    id: "memoryAllocationAndMapping",
    description:
      "Device-memory allocation, mapping, host writes, and cache visibility.",
    patterns: Object.freeze([
      "^vk(Allocate|Free)Memory$",
      "^vk(Map|Unmap)Memory",
      "^vk(Flush|Invalidate)MappedMemoryRanges$",
      "^vkGetDeviceMemoryCommitment$",
    ]),
  }),
  Object.freeze({
    id: "bufferResourcesAndPayload",
    description:
      "Buffer creation/binding, memory requirements, and GPU buffer payload writes.",
    patterns: Object.freeze([
      "^vk(Create|Destroy)Buffer",
      "^vkBindBufferMemory",
      "^vkGetBufferMemoryRequirements",
      "^vkCmd(CopyBuffer|UpdateBuffer|FillBuffer)",
    ]),
  }),
  Object.freeze({
    id: "imageResourcesAndPayload",
    description:
      "Image memory binding/requirements, image payload transfer, clear, and resolve.",
    patterns: Object.freeze([
      "^vkDestroyImage(View)?$",
      "^vkBindImageMemory",
      "^vkGetImageMemoryRequirements",
      "^vkCmd(Copy.*Image|BlitImage|ResolveImage|Clear.*Image)",
    ]),
  }),
  Object.freeze({
    id: "descriptorSamplerAndLayout",
    description:
      "Descriptor/sampler allocation, layout, pool, lifetime, and copy semantics.",
    patterns: Object.freeze([
      "^vk(Create|Destroy)Descriptor",
      "^vk(Allocate|Free)DescriptorSets$",
      "^vkResetDescriptorPool$",
      "^vk(Create|Destroy)Sampler",
      "^vkCreateSamplerYcbcrConversion",
      "^vkDestroySamplerYcbcrConversion",
    ]),
  }),
  Object.freeze({
    id: "pipelineLayoutCacheAndLifetime",
    description:
      "Pipeline layout/cache creation, cache payload, and pipeline lifetime.",
    patterns: Object.freeze([
      "^vk(Create|Destroy)Pipeline(Layout|Cache)?$",
      "^vkDestroyShaderModule$",
      "^vkGetPipelineCacheData$",
      "^vkMergePipelineCaches$",
    ]),
  }),
  Object.freeze({
    id: "commandRecordingAndExecution",
    description:
      "Command pool/buffer lifecycle and unmodeled command-buffer operations.",
    patterns: Object.freeze([
      "^vk(Create|Destroy|Reset)CommandPool$",
      "^vk(Allocate|Free)CommandBuffers$",
      "^vk(Begin|End|Reset)CommandBuffer$",
      "^vkCmd",
    ]),
  }),
  Object.freeze({
    id: "synchronization",
    description:
      "Fence, semaphore, event, wait, and queue synchronization semantics.",
    patterns: Object.freeze([
      "^vk(Create|Destroy|Get|Reset|Wait).*Fence",
      "^vk(Create|Destroy|Get|Signal|Wait).*Semaphore",
      "^vk(Create|Destroy|Get|Set|Reset).*Event",
      "^vkQueueWaitIdle$",
      "^vkDeviceWaitIdle$",
    ]),
  }),
  Object.freeze({
    id: "presentationAndDisplay",
    description:
      "Surface, swapchain, acquired image, display, and present capability state.",
    patterns: Object.freeze([
      "Surface",
      "Swapchain",
      "Display",
      "^vkAcquireNextImage",
      "^vkGetPhysicalDevicePresent",
    ]),
  }),
  Object.freeze({
    id: "queryAndConditionalState",
    description:
      "Query pools, timestamps, conditional rendering, and result visibility.",
    patterns: Object.freeze([
      "Query",
      "Timestamp",
      "ConditionalRendering",
    ]),
  }),
  Object.freeze({
    id: "devicePlatformAndOther",
    description:
      "All remaining Vulkan calls not represented by the audit-event schema.",
    patterns: Object.freeze(["^vk"]),
  }),
]);

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

function digest(value) {
  return crypto.createHash("sha256")
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex");
}

const CONTRACT_SOURCE = Object.freeze({
  schema: GFXRECON_STATE_BOUNDARY_SCHEMA,
  schemaVersion: 1,
  eventReconstructedFunctions: EVENT_RECONSTRUCTED_VULKAN_FUNCTIONS,
  unreconstructedFamilies: FAMILY_DEFINITIONS,
});

export const GFXRECON_STATE_BOUNDARY_CONTRACT = Object.freeze({
  schema: GFXRECON_STATE_BOUNDARY_SCHEMA,
  schemaVersion: 1,
  sha256: digest(CONTRACT_SOURCE),
});

const RECONSTRUCTED = new Set(EVENT_RECONSTRUCTED_VULKAN_FUNCTIONS);
const COMPILED_FAMILIES = FAMILY_DEFINITIONS.map((family) => ({
  ...family,
  regexes: family.patterns.map((pattern) => new RegExp(pattern)),
}));

export function classifyVulkanFunctionBoundaries(functionNames) {
  assert(Array.isArray(functionNames), "Vulkan function names must be an array");
  const familyCounts = new Map(
    FAMILY_DEFINITIONS.map(({ id }) => [id, new Map()]),
  );
  let reconstructedCallCount = 0;

  for (const name of functionNames) {
    assert(
      typeof name === "string" && name.startsWith("vk"),
      `invalid Vulkan function name: ${name}`,
    );
    if (RECONSTRUCTED.has(name)) {
      reconstructedCallCount += 1;
      continue;
    }
    const family = COMPILED_FAMILIES.find(({ regexes }) => (
      regexes.some((regex) => regex.test(name))
    ));
    assert(family, `unclassified Vulkan function: ${name}`);
    const counts = familyCounts.get(family.id);
    counts.set(name, (counts.get(name) || 0) + 1);
  }

  const families = FAMILY_DEFINITIONS.map(({ id, description }) => {
    const functions = [...familyCounts.get(id)]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, callCount]) => ({ name, callCount }));
    return {
      id,
      status: functions.length > 0 ? "runtime-required" : "not-observed",
      description,
      callCount: functions.reduce(
        (total, item) => total + item.callCount,
        0,
      ),
      uniqueFunctionCount: functions.length,
      functions,
    };
  });
  const unreconstructedFunctionCallCount = families.reduce(
    (total, family) => total + family.callCount,
    0,
  );
  const unreconstructedUniqueFunctionCount = families.reduce(
    (total, family) => total + family.uniqueFunctionCount,
    0,
  );

  assert.equal(
    reconstructedCallCount + unreconstructedFunctionCallCount,
    functionNames.length,
    "Vulkan function boundary denominator is incomplete",
  );
  return {
    contract: GFXRECON_STATE_BOUNDARY_CONTRACT,
    sourceFunctionCallCount: functionNames.length,
    eventReconstructedFunctionCallCount: reconstructedCallCount,
    unreconstructedFunctionCallCount,
    unreconstructedUniqueFunctionCount,
    unreconstructedFamilyCount:
      families.filter(({ callCount }) => callCount > 0).length,
    families,
  };
}
