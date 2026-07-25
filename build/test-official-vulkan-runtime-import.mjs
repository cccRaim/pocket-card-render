import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  STATUS,
  importOfficialVulkanCapture,
  indexShaderModules,
  readCaptureEvents,
  solveDrawAssignments,
} from "./import-official-vulkan-runtime-capture.mjs";

function sha256(bytes) {
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

function fakeSpirv(seed) {
  const words = new Uint32Array([0x07230203, 0x00010000, seed, 4, 0]);
  return Buffer.from(words.buffer, words.byteOffset, words.byteLength);
}

function writeGlb(file, materialNames) {
  const gltf = {
    asset: { version: "2.0" },
    accessors: materialNames.map(() => ({ count: 3 })),
    materials: materialNames.map((name) => ({ name })),
    meshes: [{ primitives: materialNames.map((_, index) => ({ material: index, indices: index })) }],
  };
  const source = Buffer.from(JSON.stringify(gltf));
  const paddedLength = Math.ceil(source.length / 4) * 4;
  const json = Buffer.alloc(paddedLength, 0x20);
  source.copy(json);
  const output = Buffer.alloc(12 + 8 + json.length);
  output.writeUInt32LE(0x46546c67, 0);
  output.writeUInt32LE(2, 4);
  output.writeUInt32LE(output.length, 8);
  output.writeUInt32LE(json.length, 12);
  output.writeUInt32LE(0x4e4f534a, 16);
  json.copy(output, 20);
  fs.writeFileSync(file, output);
}

function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pcr-vulkan-import-"));
  const captureDir = path.join(root, "capture");
  fs.mkdirSync(captureDir);
  const shaders = [fakeSpirv(1), fakeSpirv(2), fakeSpirv(3)];
  const shaderInfo = shaders.map((bytes, index) => ({
    bytes,
    module: `module${index + 1}`,
    fnv1a64: fnv1a64(bytes),
    sha256: sha256(bytes),
  }));
  for (const shader of shaderInfo) {
    fs.writeFileSync(path.join(captureDir, `shader-${shader.fnv1a64}-${shader.bytes.length}.spv`), shader.bytes);
  }

  const events = [];
  for (const shader of shaderInfo) {
    events.push({ event: "shader-module", module: shader.module, fnv1a64: shader.fnv1a64, codeSize: shader.bytes.length });
  }
  const pipelineModules = [shaderInfo[0], shaderInfo[1], shaderInfo[0]];
  pipelineModules.forEach((shader, index) => {
    const pipeline = `pipeline${index + 1}`;
    events.push({
      event: "graphics-pipeline", pipeline, flags: 0, layout: "layout", renderPass: "rp", subpass: 0,
      topology: 3, polygonMode: 0, cullMode: 0, frontFace: 0, depthTest: 1, depthWrite: 1,
      depthCompareOp: 3, blendAttachmentCount: 2, dynamicStateCount: 2,
    });
    events.push({
      event: "pipeline-stage",
      pipeline,
      stageIndex: 0,
      stage: 1,
      module: shaderInfo[2].module,
      entry: "main",
      specializationCount: 0,
      fnv1a64: shaderInfo[2].fnv1a64,
    });
    events.push({
      event: "pipeline-stage",
      pipeline,
      stageIndex: 1,
      stage: 16,
      module: shader.module,
      entry: "main",
      specializationCount: 0,
      fnv1a64: shader.fnv1a64,
    });
  });
  events.push({
    event: "framebuffer", framebuffer: "fb", renderPass: "rp", attachmentCount: 2,
    width: 256, height: 455, layers: 1,
  });
  events.push({ event: "capture-start", captureId: 7 });
  events.push({
    event: "cmd-begin-render-pass2", commandBuffer: "cb", renderPass: "rp", framebuffer: "fb",
    x: 0, y: 0, width: 256, height: 455,
  });
  for (let index = 0; index < 3; index += 1) {
    events.push({ event: "cmd-bind-pipeline", commandBuffer: "cb", bindPoint: 0, pipeline: `pipeline${index + 1}` });
    events.push({
      event: "cmd-draw-indexed", commandBuffer: "cb", indexCount: 3, instanceCount: 1,
      firstIndex: index * 3, vertexOffset: 0, firstInstance: 0,
    });
  }
  events.push({ event: "cmd-end-render-pass2", commandBuffer: "cb" });
  events.push({ event: "queue-submit", queue: "queue", submitCount: 1, fence: "fence" });
  events.push({ event: "submit-info", queue: "queue", submitIndex: 0, waitCount: 0, commandBufferCount: 1, signalCount: 1 });
  events.push({ event: "submit-command-buffer", queue: "queue", submitIndex: 0, ordinal: 0, commandBuffer: "cb" });
  events.push({ event: "present", captureId: 7, presentIndex: 1, swapchainCount: 1, result: 0 });
  fs.writeFileSync(path.join(captureDir, "events.jsonl"), `${events.map((event) => JSON.stringify(event)).join("\n")}\n`);

  const glbPath = path.join(root, "card.glb");
  writeGlb(glbPath, ["A", "B", "C"]);
  const scenePath = path.join(root, "scene.json");
  const scene = {
    card: { id: "test-card" },
    prefabGlb: glbPath,
    materials: {
      A: { queue: 100 },
      B: { queue: 200 },
      C: { queue: 300 },
    },
    officialDraws: [
      { rendererIdentity: "CAB:1", materialSlot: 0, drawId: "CAB:1#0", go: "A" },
      { rendererIdentity: "CAB:2", materialSlot: 0, drawId: "CAB:2#0", go: "B" },
      { rendererIdentity: "CAB:3", materialSlot: 0, drawId: "CAB:3#0", go: "C" },
    ],
  };
  fs.writeFileSync(scenePath, JSON.stringify(scene));
  const officialEvidence = {
    variants: [
      {
        shortShader: "Shared",
        fragmentSpvSha256: shaderInfo[0].sha256,
        fragmentSpvBytes: shaderInfo[0].bytes.length,
        fragmentSpecializationCount: 0,
        vertexSpvSha256: shaderInfo[2].sha256,
        vertexSpvBytes: shaderInfo[2].bytes.length,
        vertexSpecializationCount: 0,
        materialKeywords: [],
        materialUses: [
          { card: "test-card", rendererPathId: "1", materialSlot: 0, material: "A" },
          { card: "test-card", rendererPathId: "3", materialSlot: 0, material: "C" },
        ],
      },
      {
        shortShader: "Middle",
        fragmentSpvSha256: shaderInfo[1].sha256,
        fragmentSpvBytes: shaderInfo[1].bytes.length,
        fragmentSpecializationCount: 0,
        vertexSpvSha256: shaderInfo[2].sha256,
        vertexSpvBytes: shaderInfo[2].bytes.length,
        vertexSpecializationCount: 0,
        materialKeywords: [],
        materialUses: [{ card: "test-card", rendererPathId: "2", materialSlot: 0, material: "B" }],
      },
    ],
  };
  return { root, captureDir, glbPath, scenePath, officialEvidence, shaderInfo };
}

test("does not use scene queue to invent identity for same-program draws", () => {
  const fixture = createFixture();
  try {
    const output = importOfficialVulkanCapture(fixture);
    assert.equal(output.status, STATUS.UNRESOLVED);
    assert.equal(output.capture.matchedCardScopes, 1);
    assert.deepEqual(output.bestSummary, {
      expected: 3,
      observed: 3,
      exactProgram: 3,
      exactProgramExpected: 3,
      exactProgramCore: 3,
      exactProgramCoreExpected: 3,
      exact: 1,
      unresolved: 2,
      mismatch: 0,
      exactCore: 1,
      exactCoreExpected: 3,
    });
    assert.deepEqual(output.scopes[0].draws.map((draw) => draw.candidates.map((candidate) => candidate.materialName).sort()), [
      ["A", "C"],
      ["B"],
      ["A", "C"],
    ]);
    assert.equal(output.scopes[0].assignmentSolutions, 2);
    assert.equal(output.scopes[0].framebufferState.attachmentCount, 2);
    assert.equal(output.scopes[0].submissions.length, 1);
    assert.equal(output.scopes[0].submissions[0].queueSubmitOrdinal, 0);
    assert.equal(output.capture.successfulPresents, 1);
    assert.equal(output.capture.provenance.status, "incomplete");
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("does not match a recorded render pass whose command buffer was never submitted", () => {
  const fixture = createFixture();
  try {
    const eventPath = path.join(fixture.captureDir, "events.jsonl");
    const events = fs.readFileSync(eventPath, "utf8").trim().split("\n").map((line) => JSON.parse(line));
    fs.writeFileSync(eventPath, `${events.filter((event) => event.event !== "submit-command-buffer").map((event) => JSON.stringify(event)).join("\n")}\n`);
    const output = importOfficialVulkanCapture(fixture);
    assert.equal(output.status, STATUS.NOT_OBSERVED);
    assert.equal(output.capture.matchedCardScopes, 0);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("preserves a genuinely indistinguishable pair as unresolved", () => {
  const fragment = { sha256: "a".repeat(64), codeSize: 20 };
  const vertex = { sha256: "c".repeat(64), codeSize: 24, specializationCount: 0 };
  fragment.specializationCount = 0;
  const runtime = [0, 1].map((ordinal) => ({ ordinal, fragment, vertex, event: "cmd-draw-indexed", indexCount: 6 }));
  const expected = ["Back", "Front"].map((materialName, index) => ({
    expectedId: String(index), materialName, shader: "Card_UR_LensFlare", queue: 2650,
    category: "Card_UR_LensFlare", fragmentSpvSha256: fragment.sha256,
    fragmentSpvBytes: fragment.codeSize, indexCounts: [], runtimeVariants: [{
      compiledKeywords: [], keywordIndices: [], blobIndex: 0,
      fragmentSpvSha256: fragment.sha256, fragmentSpvBytes: fragment.codeSize,
      fragmentSpecializationCount: 0,
      vertexSpvSha256: vertex.sha256, vertexSpvBytes: vertex.codeSize, vertexSpecializationCount: 0,
    }],
  }));
  const solved = solveDrawAssignments(runtime, expected);
  assert.equal(solved.solutions, 2);
  assert.deepEqual(solved.rows.map((row) => row.status), [STATUS.UNRESOLVED, STATUS.UNRESOLVED]);
});

test("never reports exact identities after assignment search truncation", () => {
  const fragment = { sha256: "b".repeat(64), codeSize: 20 };
  const vertex = { sha256: "d".repeat(64), codeSize: 24, specializationCount: 0 };
  fragment.specializationCount = 0;
  const runtime = [0, 1, 2].map((ordinal) => ({ ordinal, fragment, vertex, event: "cmd-draw-indexed", indexCount: 6 }));
  const expected = ["A", "B", "C"].map((materialName, index) => ({
    expectedId: String(index), materialName, shader: "Shared", queue: index * 100,
    category: "exact-core", fragmentSpvSha256: fragment.sha256,
    fragmentSpvBytes: fragment.codeSize, indexCounts: [], runtimeVariants: [{
      compiledKeywords: [], keywordIndices: [], blobIndex: 0,
      fragmentSpvSha256: fragment.sha256, fragmentSpvBytes: fragment.codeSize,
      fragmentSpecializationCount: 0,
      vertexSpvSha256: vertex.sha256, vertexSpvBytes: vertex.codeSize, vertexSpecializationCount: 0,
    }],
  }));
  const solved = solveDrawAssignments(runtime, expected, 1);
  assert.equal(solved.truncated, true);
  assert.equal(solved.solutions, 1);
  assert.deepEqual(solved.rows.map((row) => row.status), [STATUS.UNRESOLVED, STATUS.UNRESOLVED, STATUS.UNRESOLVED]);
  assert.deepEqual(solved.rows.map((row) => row.candidates.length), [3, 3, 3]);
});

test("rejects shader payloads whose bytes do not match the captured FNV identity", () => {
  const fixture = createFixture();
  try {
    const capture = readCaptureEvents(fixture.captureDir);
    const first = fixture.shaderInfo[0];
    const file = path.join(fixture.captureDir, `shader-${first.fnv1a64}-${first.bytes.length}.spv`);
    const corrupt = Buffer.from(first.bytes);
    corrupt[12] ^= 1;
    fs.writeFileSync(file, corrupt);
    assert.throws(() => indexShaderModules(fixture.captureDir, capture.events), /FNV-1a mismatch/);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});
