#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  convertGfxreconJsonl,
  validateToolFact,
} from "./convert-gfxrecon-vulkan-capture.mjs";
import {
  replayCapture,
} from "./import-official-vulkan-runtime-capture.mjs";

function fakeSpirv(seed) {
  const words = new Uint32Array([0x07230203, 0x00010000, seed, 4, 0]);
  return Buffer.from(words.buffer, words.byteOffset, words.byteLength);
}

function writeFixture(root, mutate = null) {
  const shaderDirectory = path.join(root, "shaders");
  fs.mkdirSync(shaderDirectory);
  fs.writeFileSync(path.join(shaderDirectory, "sh11"), fakeSpirv(11));
  fs.writeFileSync(path.join(shaderDirectory, "sh12"), fakeSpirv(12));
  const records = [
    {
      header: {
        "source-path": "fixture.gfxr",
        "gfxrecon-version": "1.0.5",
        "vulkan-version": "1.4.350",
      },
    },
    {
      index: -8,
      function: {
        name: "vkAllocateMemory",
        return: "VK_SUCCESS",
        args: {},
      },
    },
    {
      index: -7,
      function: {
        name: "vkCreateBuffer",
        return: "VK_SUCCESS",
        args: {},
      },
    },
    {
      index: -6,
      function: {
        name: "vkBindBufferMemory",
        return: "VK_SUCCESS",
        args: {},
      },
    },
    {
      index: -5,
      function: {
        name: "vkMapMemory",
        return: "VK_SUCCESS",
        args: {},
      },
    },
    {
      index: -4,
      function: {
        name: "vkFlushMappedMemoryRanges",
        return: "VK_SUCCESS",
        args: {},
      },
    },
    {
      index: -3,
      function: {
        name: "vkBindImageMemory",
        return: "VK_SUCCESS",
        args: {},
      },
    },
    {
      index: -2,
      function: {
        name: "vkCreateDescriptorSetLayout",
        return: "VK_SUCCESS",
        args: {},
      },
    },
    {
      index: -1,
      function: {
        name: "vkCreatePipelineLayout",
        return: "VK_SUCCESS",
        args: {},
      },
    },
    {
      index: 1,
      function: {
        name: "vkCreateShaderModule",
        return: "VK_SUCCESS",
        args: {
          pCreateInfo: { codeSize: 20 },
          pShaderModule: 11,
        },
      },
    },
    {
      index: 2,
      function: {
        name: "vkCreateShaderModule",
        return: "VK_SUCCESS",
        args: {
          pCreateInfo: { codeSize: 20 },
          pShaderModule: 12,
        },
      },
    },
    {
      index: 3,
      function: {
        name: "vkCreateGraphicsPipelines",
        return: "VK_SUCCESS",
        args: {
          createInfoCount: 1,
          pPipelines: [14],
          pCreateInfos: [{
            flags: "0x00000000",
            stageCount: 2,
            pStages: [
              {
                stage: "VK_SHADER_STAGE_VERTEX_BIT",
                module: 11,
                pName: "main",
                pSpecializationInfo: null,
              },
              {
                stage: "VK_SHADER_STAGE_FRAGMENT_BIT",
                module: 12,
                pName: "main",
                pSpecializationInfo: null,
              },
            ],
            pInputAssemblyState: {
              topology: "VK_PRIMITIVE_TOPOLOGY_TRIANGLE_LIST",
              primitiveRestartEnable: false,
            },
            pRasterizationState: {
              polygonMode: "VK_POLYGON_MODE_FILL",
              cullMode: "VK_CULL_MODE_BACK_BIT",
              frontFace: "VK_FRONT_FACE_CLOCKWISE",
            },
            pMultisampleState: {
              rasterizationSamples: "VK_SAMPLE_COUNT_1_BIT",
              sampleShadingEnable: false,
              minSampleShading: 0,
              alphaToCoverageEnable: true,
              alphaToOneEnable: false,
            },
            pDepthStencilState: {
              depthTestEnable: true,
              depthWriteEnable: true,
              depthCompareOp: "VK_COMPARE_OP_LESS_OR_EQUAL",
              depthBoundsTestEnable: false,
              stencilTestEnable: true,
              front: {
                failOp: "VK_STENCIL_OP_KEEP",
                passOp: "VK_STENCIL_OP_REPLACE",
                depthFailOp: "VK_STENCIL_OP_KEEP",
                compareOp: "VK_COMPARE_OP_EQUAL",
                compareMask: 3,
                writeMask: 4,
                reference: 7,
              },
              back: {
                failOp: "VK_STENCIL_OP_KEEP",
                passOp: "VK_STENCIL_OP_REPLACE",
                depthFailOp: "VK_STENCIL_OP_KEEP",
                compareOp: "VK_COMPARE_OP_EQUAL",
                compareMask: 3,
                writeMask: 4,
                reference: 7,
              },
            },
            pColorBlendState: {
              attachmentCount: 1,
              pAttachments: [{
                blendEnable: true,
                srcColorBlendFactor: "VK_BLEND_FACTOR_SRC_ALPHA",
                dstColorBlendFactor: "VK_BLEND_FACTOR_ONE_MINUS_SRC_ALPHA",
                colorBlendOp: "VK_BLEND_OP_ADD",
                srcAlphaBlendFactor: "VK_BLEND_FACTOR_ONE",
                dstAlphaBlendFactor: "VK_BLEND_FACTOR_ZERO",
                alphaBlendOp: "VK_BLEND_OP_ADD",
                colorWriteMask:
                  "VK_COLOR_COMPONENT_R_BIT|VK_COLOR_COMPONENT_G_BIT"
                  + "|VK_COLOR_COMPONENT_B_BIT|VK_COLOR_COMPONENT_A_BIT",
              }],
            },
            pDynamicState: {
              dynamicStateCount: 3,
              pDynamicStates: [
                "VK_DYNAMIC_STATE_VIEWPORT",
                "VK_DYNAMIC_STATE_SCISSOR",
                "VK_DYNAMIC_STATE_DEPTH_WRITE_ENABLE",
              ],
            },
            layout: 13,
            renderPass: 10,
            subpass: 0,
          }],
        },
      },
    },
    {
      index: 4,
      function: {
        name: "vkCreateImage",
        return: "VK_SUCCESS",
        args: {
          pCreateInfo: {
            imageType: "VK_IMAGE_TYPE_2D",
            format: "VK_FORMAT_R8G8B8A8_UNORM",
            extent: { width: 256, height: 455, depth: 1 },
            mipLevels: 1,
            arrayLayers: 1,
            samples: "VK_SAMPLE_COUNT_1_BIT",
            tiling: "VK_IMAGE_TILING_OPTIMAL",
            usage: "VK_IMAGE_USAGE_COLOR_ATTACHMENT_BIT",
            initialLayout: "VK_IMAGE_LAYOUT_UNDEFINED",
          },
          pImage: 7,
        },
      },
    },
    {
      index: 5,
      function: {
        name: "vkCreateImageView",
        return: "VK_SUCCESS",
        args: {
          pCreateInfo: {
            image: 7,
            viewType: "VK_IMAGE_VIEW_TYPE_2D",
            format: "VK_FORMAT_R8G8B8A8_UNORM",
            components: {},
            subresourceRange: {
              aspectMask: "VK_IMAGE_ASPECT_COLOR_BIT",
              baseMipLevel: 0,
              levelCount: 1,
              baseArrayLayer: 0,
              layerCount: 1,
            },
          },
          pView: 8,
        },
      },
    },
    {
      index: 6,
      function: {
        name: "vkCreateFramebuffer",
        return: "VK_SUCCESS",
        args: {
          pCreateInfo: {
            renderPass: 10,
            attachmentCount: 1,
            pAttachments: [8],
            width: 256,
            height: 455,
            layers: 1,
          },
          pFramebuffer: 15,
        },
      },
    },
    {
      index: 7,
      function: {
        name: "vkUpdateDescriptorSets",
        args: {
          pDescriptorWrites: [{
            dstSet: 30,
            dstBinding: 0,
            dstArrayElement: 0,
            pImageInfo: [{
              sampler: 31,
              imageView: 32,
              imageLayout: "VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL",
            }],
          }, {
            dstSet: 30,
            dstBinding: 1,
            dstArrayElement: 0,
            pBufferInfo: [{ buffer: 33, offset: 16, range: 64 }],
          }],
        },
      },
    },
    {
      index: 8,
      function: {
        name: "vkCmdPipelineBarrier",
        args: {
          commandBuffer: 23,
          pImageMemoryBarriers: [{
            image: 7,
            oldLayout: "VK_IMAGE_LAYOUT_UNDEFINED",
            newLayout: "VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL",
            srcQueueFamilyIndex: 0,
            dstQueueFamilyIndex: 0,
            subresourceRange: {
              aspectMask: "VK_IMAGE_ASPECT_COLOR_BIT",
              baseMipLevel: 0,
              levelCount: 1,
              baseArrayLayer: 0,
              layerCount: 1,
            },
          }],
          pBufferMemoryBarriers: [],
        },
      },
    },
    {
      index: 9,
      function: {
        name: "vkCmdBeginRenderPass",
        args: {
          commandBuffer: 23,
          pRenderPassBegin: {
            renderPass: 10,
            framebuffer: 15,
            renderArea: {
              offset: { x: 0, y: 0 },
              extent: { width: 256, height: 455 },
            },
          },
        },
      },
    },
    {
      index: 10,
      function: {
        name: "vkCmdBindPipeline",
        args: {
          commandBuffer: 23,
          pipelineBindPoint: "VK_PIPELINE_BIND_POINT_GRAPHICS",
          pipeline: 14,
        },
      },
    },
    {
      index: 11,
      function: {
        name: "vkCmdBindDescriptorSets",
        args: {
          commandBuffer: 23,
          pipelineBindPoint: "VK_PIPELINE_BIND_POINT_GRAPHICS",
          firstSet: 0,
          pDescriptorSets: [30],
          pDynamicOffsets: [256],
        },
      },
    },
    {
      index: 12,
      function: {
        name: "vkCmdBindVertexBuffers",
        args: {
          commandBuffer: 23,
          firstBinding: 0,
          pBuffers: [40],
          pOffsets: [0],
        },
      },
    },
    {
      index: 13,
      function: {
        name: "vkCmdBindIndexBuffer",
        args: {
          commandBuffer: 23,
          buffer: 41,
          offset: 0,
          indexType: "VK_INDEX_TYPE_UINT16",
        },
      },
    },
    {
      index: 14,
      function: {
        name: "vkCmdSetViewport",
        args: {
          commandBuffer: 23,
          pViewports: [{
            x: 0,
            y: 455,
            width: 256,
            height: -455,
            minDepth: 0,
            maxDepth: 1,
          }],
        },
      },
    },
    {
      index: 15,
      function: {
        name: "vkCmdSetScissor",
        args: {
          commandBuffer: 23,
          pScissors: [{
            offset: { x: 0, y: 0 },
            extent: { width: 256, height: 455 },
          }],
        },
      },
    },
    {
      index: 16,
      function: {
        name: "vkCmdSetDepthWriteEnable",
        args: {
          commandBuffer: 23,
          depthWriteEnable: false,
        },
      },
    },
    {
      index: 17,
      function: {
        name: "vkCmdDrawIndexed",
        args: {
          commandBuffer: 23,
          indexCount: 6,
          instanceCount: 1,
          firstIndex: 0,
          vertexOffset: 0,
          firstInstance: 0,
        },
      },
    },
    {
      index: 18,
      function: {
        name: "vkCmdEndRenderPass",
        args: { commandBuffer: 23 },
      },
    },
    {
      index: 19,
      function: {
        name: "vkQueueSubmit",
        return: "VK_SUCCESS",
        args: {
          queue: 9,
          submitCount: 1,
          pSubmits: [{
            waitSemaphoreCount: 0,
            pWaitSemaphores: null,
            commandBufferCount: 1,
            pCommandBuffers: [23],
            signalSemaphoreCount: 0,
            pSignalSemaphores: null,
          }],
          fence: 0,
        },
      },
    },
    {
      index: 20,
      function: {
        name: "vkQueuePresentKHR",
        return: "VK_SUCCESS",
        args: {
          queue: 9,
          pPresentInfo: { swapchainCount: 1 },
        },
      },
    },
  ];
  mutate?.(records);
  const jsonlPath = path.join(root, "capture.jsonl");
  fs.writeFileSync(
    jsonlPath,
    `${records.map((record) => JSON.stringify(record)).join("\n")}\n`,
  );
  return { jsonlPath, shaderDirectory };
}

test("converts GFXReconstruct JSONL into the strict audit event schema", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pcr-gfxrecon-convert-"));
  try {
    const fixture = writeFixture(root);
    const converted = convertGfxreconJsonl(fixture);
    assert.equal(converted.manifest.summary.shaderModuleCount, 2);
    assert.equal(converted.manifest.summary.presentCount, 1);
    assert.equal(converted.manifest.summary.unreconstructedFunctionCount, 8);
    assert.equal(
      converted.manifest.scope.stateReconstruction,
      "partial-runtime-required",
    );
    assert.deepEqual(
      converted.manifest.unreconstructedVulkanFunctions
        .filter(({ callCount }) => callCount > 0)
        .map(({ id, callCount }) => ({ id, callCount })),
      [
        { id: "memoryAllocationAndMapping", callCount: 3 },
        { id: "bufferResourcesAndPayload", callCount: 2 },
        { id: "imageResourcesAndPayload", callCount: 1 },
        { id: "descriptorSamplerAndLayout", callCount: 1 },
        { id: "pipelineLayoutCacheAndLifetime", callCount: 1 },
      ],
    );
    assert.equal(
      converted.events.filter(({ event }) => event === "graphics-pipeline")
        .length,
      1,
    );
    assert.equal(
      converted.events.find(({ event }) => event === "blend-attachment")
        .writeMask,
      15,
    );
    assert.deepEqual(
      converted.events.find(({ event }) => event === "cmd-bound-set"),
      {
        event: "cmd-bound-set",
        commandBuffer: "23",
        setIndex: 0,
        set: "30",
      },
    );
    assert.equal(
      converted.events.find(
        ({ event }) => event === "cmd-bind-vertex-buffer",
      ).buffer,
      "40",
    );
    assert.equal(
      converted.events.find(({ event }) => event === "cmd-bind-index-buffer")
        .indexType,
      0,
    );
    const pipeline = converted.events.find(
      ({ event }) => event === "graphics-pipeline",
    );
    assert.deepEqual(pipeline.dynamicStates, [0, 1, 1000267007]);
    assert.equal(pipeline.alphaToCoverage, 1);
    assert.equal(pipeline.stencilTest, 1);
    assert.deepEqual(pipeline.frontStencil, {
      failOp: 0,
      passOp: 2,
      depthFailOp: 0,
      compareOp: 2,
      compareMask: 3,
      writeMask: 4,
      reference: 7,
    });
    assert.deepEqual(
      converted.events.find(({ event }) => event === "cmd-image-barrier"),
      {
        event: "cmd-image-barrier",
        commandBuffer: "23",
        sourceCall: "vkCmdPipelineBarrier",
        index: 0,
        image: "7",
        oldLayout: 0,
        newLayout: 2,
        srcQueueFamilyIndex: 0,
        dstQueueFamilyIndex: 0,
        subresourceRange: {
          aspectMask: "VK_IMAGE_ASPECT_COLOR_BIT",
          baseMipLevel: 0,
          levelCount: 1,
          baseArrayLayer: 0,
          layerCount: 1,
        },
      },
    );
    const replay = replayCapture(converted.events, {
      byHandle: new Map(
        [...converted.shaderByModule].map(([module, shader]) => [
          module,
          {
            fnv1a64: shader.fnv1a64,
            codeSize: shader.codeSize,
            sha256: shader.sha256,
          },
        ]),
      ),
    });
    const draw = replay.scopes[0].draws[0];
    assert.equal(draw.attachmentDescriptors[0].viewHandle, "8");
    assert.equal(draw.attachmentDescriptors[0].view.image, "7");
    assert.equal(draw.attachmentDescriptors[0].recordedLayout, 2);
    assert.equal(draw.vertexBindings[0].buffer, "40");
    assert.equal(draw.indexBinding.buffer, "41");
    assert.deepEqual(
      draw.pipelineState.dynamicStates,
      [0, 1, 1000267007],
    );
    assert.deepEqual(
      draw.pipelineState.observedDynamicStates,
      [0, 1, 1000267003, 1000267004, 1000267007],
    );
    assert.deepEqual(draw.pipelineState.missingDynamicStates, []);
    assert.equal(draw.pipelineState.depthWrite, 0);
    assert.equal(draw.pipelineState.alphaToCoverage, 1);
    assert.equal(draw.pipelineState.frontStencil.reference, 7);
    assert.equal(draw.descriptorSets[0].bindings[0].items[0].view, "32");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("fails closed on a related Vulkan command that is not implemented", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pcr-gfxrecon-convert-"));
  try {
    const fixture = writeFixture(root, (records) => records.push({
      index: 17,
      function: {
        name: "vkCmdDrawIndirectCount",
        args: { commandBuffer: 23 },
      },
    }));
    assert.throws(
      () => convertGfxreconJsonl(fixture),
      /unsupported relevant Vulkan calls: vkCmdDrawIndirectCount/,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("fails closed when an extracted shader is absent", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pcr-gfxrecon-convert-"));
  try {
    const fixture = writeFixture(root);
    fs.rmSync(path.join(fixture.shaderDirectory, "sh12"));
    assert.throws(
      () => convertGfxreconJsonl(fixture),
      /shader is absent for module 12/,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("fails closed when the converter identity differs from the pin", () => {
  const actual = {
    logicalPath: "gfxrecon-convert.exe",
    byteLength: 10,
    sha256: "a".repeat(64),
    version: "GFXReconstruct Version 1.0.5 (ed60d45)",
  };
  const expected = {
    executable: "gfxrecon-convert.exe",
    byteLength: 10,
    sha256: "b".repeat(64),
    versionIncludes: ["GFXReconstruct Version 1.0.5 (ed60d45)"],
  };
  assert.throws(
    () => validateToolFact(actual, expected, "gfxrecon-convert"),
    /SHA-256 differs from the pinned toolchain/,
  );
});
