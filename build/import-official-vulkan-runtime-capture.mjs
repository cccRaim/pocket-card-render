// Normalize a read-only Vulkan audit-layer capture against official Unity bundles.
// Raw captures and SPIR-V stay outside the repository; this importer emits hashes,
// pipeline state, and globally constrained Material-draw matches only.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PYTHON = process.env.PYTHON || "python";
const DEFAULT_DECRYPTED_ROOT = path.resolve(process.env.PCR_DECRYPTED_ROOT
  || "D:/DevProjectes/ptcgp-tools-master/masterdata_decoder/.output/decrypted");

export const CAPTURE_SCHEMA = "pocket-card-render/official-vulkan-audit-capture@1";
export const IMPORT_SCHEMA = "pocket-card-render/official-vulkan-runtime-import@1";
export const STATUS = Object.freeze({
  EXACT: "exact",
  MISMATCH: "mismatch",
  UNRESOLVED: "unresolved",
  NOT_OBSERVED: "not-observed",
});

const EXCEPTION_SHADERS = new Set([
  "Text",
  "InnerStencil",
  "OuterStencil",
  "Card_UR_Glitter_FlowMaps",
  "Card_UR_LensFlare",
]);

function sha256(data) {
  return crypto.createHash("sha256").update(data).digest("hex");
}

function fnv1a64(data) {
  let hash = 0xcbf29ce484222325n;
  for (const byte of data) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, "0");
}

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function stableJson(value) {
  return `${stable(value)}\n`;
}

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function isFile(file) {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

export function readCaptureEvents(captureDir) {
  const file = path.join(captureDir, "events.jsonl");
  requireCondition(isFile(file), `capture event log is missing: ${file}`);
  const source = fs.readFileSync(file, "utf8");
  const events = [];
  for (const [index, line] of source.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    let event;
    try {
      event = JSON.parse(line);
    } catch (error) {
      throw new Error(`invalid capture JSON at events.jsonl:${index + 1}: ${error.message}`);
    }
    requireCondition(event && typeof event.event === "string", `capture event ${index + 1} has no event name`);
    events.push({ ...event, _line: index + 1 });
  }
  requireCondition(events.length > 0, "capture event log is empty");
  return { file, sourceSha256: sha256(Buffer.from(source)), events };
}

export function indexShaderModules(captureDir, events) {
  const byHandle = new Map();
  const byIdentity = new Map();
  for (const event of events) {
    if (event.event !== "shader-module") continue;
    requireCondition(typeof event.module === "string", `shader-module at line ${event._line} has no handle`);
    requireCondition(/^[0-9a-f]{16}$/i.test(event.fnv1a64 || ""), `shader-module ${event.module} has invalid FNV-1a`);
    requireCondition(Number.isInteger(event.codeSize) && event.codeSize > 0, `shader-module ${event.module} has invalid codeSize`);
    const identity = `${event.fnv1a64.toLowerCase()}-${event.codeSize}`;
    let shader = byIdentity.get(identity);
    if (!shader) {
      const file = path.join(captureDir, `shader-${identity}.spv`);
      requireCondition(isFile(file), `captured shader file is missing: ${file}`);
      const bytes = fs.readFileSync(file);
      requireCondition(bytes.length === event.codeSize, `captured shader ${identity} size mismatch`);
      requireCondition(bytes.length % 4 === 0 && bytes.readUInt32LE(0) === 0x07230203,
        `captured shader ${identity} is not a SPIR-V module`);
      requireCondition(fnv1a64(bytes) === event.fnv1a64.toLowerCase(), `captured shader ${identity} FNV-1a mismatch`);
      shader = Object.freeze({
        fnv1a64: event.fnv1a64.toLowerCase(),
        codeSize: bytes.length,
        sha256: sha256(bytes),
      });
      byIdentity.set(identity, shader);
    }
    const previous = byHandle.get(event.module);
    requireCondition(!previous || stable(previous) === stable(shader), `shader handle ${event.module} was redefined`);
    byHandle.set(event.module, shader);
  }
  requireCondition(byHandle.size > 0, "capture contains no shader modules");
  return { byHandle, unique: [...byIdentity.values()].sort((a, b) => a.sha256.localeCompare(b.sha256)) };
}

function mapPush(map, key, value) {
  const values = map.get(key) || [];
  values.push(value);
  map.set(key, values);
}

export function replayCapture(events, shaderModules) {
  const pipelines = new Map();
  const framebuffers = new Map();
  const descriptorSets = new Map();
  const commandStates = new Map();
  const scopes = [];
  const submissions = [];
  const queueSubmits = [];
  const captureStarts = [];
  const presents = [];
  let activeQueueSubmit = null;

  function commandState(handle) {
    let state = commandStates.get(handle);
    if (!state) {
      state = { pipeline: null, sets: new Map(), dynamicOffsetsLE: null, viewport: null, scissor: null, scope: null };
      commandStates.set(handle, state);
    }
    return state;
  }

  for (const event of events) {
    switch (event.event) {
      case "capture-start":
        captureStarts.push({ captureId: event.captureId, line: event._line });
        break;
      case "present":
        presents.push({
          captureId: event.captureId,
          presentIndex: event.presentIndex,
          swapchainCount: event.swapchainCount,
          result: event.result,
          line: event._line,
        });
        break;
      case "queue-submit":
        activeQueueSubmit = {
          ordinal: queueSubmits.length,
          queue: event.queue,
          submitCount: event.submitCount,
          fence: event.fence,
          line: event._line,
          infos: [],
          commandBuffers: [],
        };
        queueSubmits.push(activeQueueSubmit);
        break;
      case "submit-info":
        requireCondition(activeQueueSubmit?.queue === event.queue, `submit-info at line ${event._line} has no active queue-submit`);
        activeQueueSubmit.infos[event.submitIndex] = {
          submitIndex: event.submitIndex,
          waitCount: event.waitCount,
          commandBufferCount: event.commandBufferCount,
          signalCount: event.signalCount,
          line: event._line,
        };
        break;
      case "graphics-pipeline": {
        const pipeline = {
          handle: event.pipeline,
          flags: event.flags,
          layout: event.layout,
          renderPass: event.renderPass,
          subpass: event.subpass,
          topology: event.topology,
          polygonMode: event.polygonMode,
          cullMode: event.cullMode,
          frontFace: event.frontFace,
          depthTest: event.depthTest,
          depthWrite: event.depthWrite,
          depthCompareOp: event.depthCompareOp,
          blendAttachmentCount: event.blendAttachmentCount,
          dynamicStateCount: event.dynamicStateCount,
          stages: [],
          blendAttachments: [],
        };
        pipelines.set(event.pipeline, pipeline);
        break;
      }
      case "pipeline-stage": {
        const pipeline = pipelines.get(event.pipeline);
        requireCondition(pipeline, `pipeline-stage at line ${event._line} references unknown pipeline ${event.pipeline}`);
        const shader = shaderModules.byHandle.get(event.module);
        requireCondition(shader, `pipeline-stage at line ${event._line} references unknown shader module ${event.module}`);
        requireCondition(
          event.fnv1a64?.toLowerCase() === shader.fnv1a64,
          `pipeline-stage at line ${event._line} shader module ${event.module} FNV-1a mismatch`,
        );
        requireCondition(
          Number.isInteger(event.specializationCount) && event.specializationCount >= 0,
          `pipeline-stage at line ${event._line} has invalid specializationCount`,
        );
        pipeline.stages.push({
          stageIndex: event.stageIndex,
          stage: event.stage,
          entry: event.entry,
          specializationCount: event.specializationCount,
          ...shader,
        });
        break;
      }
      case "blend-attachment": {
        const pipeline = pipelines.get(event.pipeline);
        requireCondition(pipeline, `blend-attachment at line ${event._line} references unknown pipeline ${event.pipeline}`);
        pipeline.blendAttachments[event.attachment] = {
          enable: event.enable,
          srcColor: event.srcColor,
          dstColor: event.dstColor,
          colorOp: event.colorOp,
          srcAlpha: event.srcAlpha,
          dstAlpha: event.dstAlpha,
          alphaOp: event.alphaOp,
          writeMask: event.writeMask,
        };
        break;
      }
      case "framebuffer":
        framebuffers.set(event.framebuffer, {
          renderPass: event.renderPass,
          attachmentCount: event.attachmentCount,
          width: event.width,
          height: event.height,
          layers: event.layers,
          attachments: [],
        });
        break;
      case "framebuffer-attachment": {
        const framebuffer = framebuffers.get(event.framebuffer);
        if (framebuffer) framebuffer.attachments[event.index] = event.view;
        break;
      }
      case "descriptor-image":
      case "descriptor-buffer": {
        const set = descriptorSets.get(event.set) || new Map();
        const binding = set.get(event.binding) || new Map();
        binding.set(event.item, event.event === "descriptor-image"
          ? { kind: "image", sampler: event.sampler, view: event.view, layout: event.layout }
          : { kind: "buffer", buffer: event.buffer, offset: event.offset, range: event.range });
        set.set(event.binding, binding);
        descriptorSets.set(event.set, set);
        break;
      }
      case "cmd-begin-render-pass2":
      case "cmd-begin-render-pass": {
        const state = commandState(event.commandBuffer);
        requireCondition(!state.scope, `nested render pass in command buffer ${event.commandBuffer}`);
        const scope = {
          ordinal: scopes.length,
          commandBuffer: event.commandBuffer,
          renderPass: event.renderPass,
          framebuffer: event.framebuffer,
          area: { x: event.x, y: event.y, width: event.width, height: event.height },
          beginLine: event._line,
          endLine: null,
          draws: [],
        };
        state.scope = scope;
        scopes.push(scope);
        break;
      }
      case "cmd-end-render-pass2":
      case "cmd-end-render-pass": {
        const state = commandState(event.commandBuffer);
        requireCondition(state.scope, `render-pass end without begin in command buffer ${event.commandBuffer}`);
        state.scope.endLine = event._line;
        state.scope = null;
        break;
      }
      case "cmd-bind-pipeline":
        if (event.bindPoint === 0) commandState(event.commandBuffer).pipeline = event.pipeline;
        break;
      case "cmd-bind-descriptor-sets":
        if (event.bindPoint === 0) commandState(event.commandBuffer).dynamicOffsetsLE = null;
        break;
      case "cmd-bound-set":
        commandState(event.commandBuffer).sets.set(event.setIndex, event.set);
        break;
      case "cmd-dynamic-offsets":
        commandState(event.commandBuffer).dynamicOffsetsLE = event.valuesLE;
        break;
      case "cmd-viewport":
        commandState(event.commandBuffer).viewport = {
          index: event.index, x: event.x, y: event.y, width: event.width, height: event.height,
          minDepth: event.minDepth, maxDepth: event.maxDepth,
        };
        break;
      case "cmd-scissor":
        commandState(event.commandBuffer).scissor = {
          index: event.index, x: event.x, y: event.y, width: event.width, height: event.height,
        };
        break;
      case "cmd-draw-indexed":
      case "cmd-draw": {
        const state = commandState(event.commandBuffer);
        if (!state.scope) break;
        const pipeline = pipelines.get(state.pipeline);
        const boundSets = [...state.sets].sort((a, b) => a[0] - b[0]).map(([setIndex, handle]) => {
          const bindings = descriptorSets.get(handle) || new Map();
          return {
            setIndex,
            bindings: [...bindings].sort((a, b) => a[0] - b[0]).map(([binding, items]) => ({
              binding,
              items: [...items].sort((a, b) => a[0] - b[0]).map(([item, value]) => ({ item, ...value })),
            })),
          };
        });
        state.scope.draws.push({
          ordinal: state.scope.draws.length,
          event: event.event,
          line: event._line,
          pipeline: state.pipeline,
          fragment: pipeline?.stages.find((stage) => stage.stage === 16) || null,
          vertex: pipeline?.stages.find((stage) => stage.stage === 1) || null,
          indexCount: event.indexCount ?? null,
          instanceCount: event.instanceCount,
          firstIndex: event.firstIndex ?? null,
          vertexOffset: event.vertexOffset ?? null,
          vertexCount: event.vertexCount ?? null,
          firstVertex: event.firstVertex ?? null,
          firstInstance: event.firstInstance,
          pipelineState: pipeline ? {
            topology: pipeline.topology,
            polygonMode: pipeline.polygonMode,
            cullMode: pipeline.cullMode,
            frontFace: pipeline.frontFace,
            depthTest: pipeline.depthTest,
            depthWrite: pipeline.depthWrite,
            depthCompareOp: pipeline.depthCompareOp,
            blendAttachments: pipeline.blendAttachments,
          } : null,
          viewport: state.viewport,
          scissor: state.scissor,
          dynamicOffsetsLE: state.dynamicOffsetsLE,
          descriptorSets: boundSets,
        });
        break;
      }
      case "submit-command-buffer":
        requireCondition(activeQueueSubmit?.queue === event.queue, `submit-command-buffer at line ${event._line} has no active queue-submit`);
        const submission = {
          queueSubmitOrdinal: activeQueueSubmit.ordinal,
          queue: event.queue,
          submitIndex: event.submitIndex,
          ordinal: event.ordinal,
          commandBuffer: event.commandBuffer,
          line: event._line,
        };
        submissions.push(submission);
        activeQueueSubmit.commandBuffers.push(submission);
        break;
      default:
        break;
    }
  }

  for (const [handle, state] of commandStates) requireCondition(!state.scope, `unterminated render pass in command buffer ${handle}`);
  const submissionsByCommandBuffer = new Map();
  for (const submission of submissions) mapPush(submissionsByCommandBuffer, submission.commandBuffer, submission);
  for (const scope of scopes) {
    scope.framebufferState = framebuffers.get(scope.framebuffer) || null;
    scope.submissions = submissionsByCommandBuffer.get(scope.commandBuffer) || [];
  }
  return { pipelines, framebuffers, scopes, submissions, queueSubmits, captureStarts, presents };
}

export function parseGlbPrimitiveDraws(file) {
  const data = fs.readFileSync(file);
  requireCondition(data.length >= 20 && data.readUInt32LE(0) === 0x46546c67, `not a GLB file: ${file}`);
  requireCondition(data.readUInt32LE(4) === 2, `unsupported GLB version in ${file}`);
  requireCondition(data.readUInt32LE(8) === data.length, `GLB length mismatch in ${file}`);
  let offset = 12;
  let gltf;
  while (offset + 8 <= data.length) {
    const length = data.readUInt32LE(offset);
    const type = data.readUInt32LE(offset + 4);
    offset += 8;
    requireCondition(offset + length <= data.length, `GLB chunk extends past EOF in ${file}`);
    if (type === 0x4e4f534a) gltf = JSON.parse(data.subarray(offset, offset + length).toString("utf8").replace(/\0+$/, ""));
    offset += length;
  }
  requireCondition(gltf, `GLB JSON chunk is missing: ${file}`);
  const materials = (gltf.materials || []).map((material) => material?.name || "");
  const draws = [];
  for (const [meshIndex, mesh] of (gltf.meshes || []).entries()) {
    for (const [primitiveIndex, primitive] of (mesh.primitives || []).entries()) {
      requireCondition(Number.isInteger(primitive.material) && materials[primitive.material],
        `GLB mesh ${meshIndex} primitive ${primitiveIndex} has no named material`);
      requireCondition(Number.isInteger(primitive.indices) && gltf.accessors?.[primitive.indices],
        `GLB mesh ${meshIndex} primitive ${primitiveIndex} has no index accessor`);
      draws.push({
        meshIndex,
        primitiveIndex,
        materialName: materials[primitive.material],
        indexCount: gltf.accessors[primitive.indices].count,
      });
    }
  }
  return draws;
}

export function runOfficialExtractor(decryptedRoot = DEFAULT_DECRYPTED_ROOT) {
  const script = path.join(ROOT, "build", "extract_official_mrt_outputs.py");
  const stdout = execFileSync(PYTHON, [script, "--decrypted-root", decryptedRoot], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    shell: process.platform === "win32",
  });
  return JSON.parse(stdout.replace(/^\uFEFF/, ""));
}

function resolvePublicAsset(reference) {
  return path.resolve(ROOT, "public", String(reference).replace(/^[/\\]+/, ""));
}

export function buildExpectedDraws({ scene, glbDraws, officialEvidence }) {
  const cardId = scene.card?.id || scene.card?.illId || scene.card;
  requireCondition(typeof cardId === "string" && cardId, "scene card id is missing");
  const runtimeVariantsByShader = new Map();
  for (const candidate of officialEvidence.runtimeFragmentCandidates || []) {
    mapPush(runtimeVariantsByShader, candidate.shader, {
      compiledKeywords: candidate.compiledKeywords || [],
      keywordIndices: candidate.keywordIndices || [],
      blobIndex: candidate.blobIndex,
      fragmentSpvSha256: candidate.fragmentSpvSha256,
      fragmentSpvBytes: candidate.fragmentSpvBytes,
      fragmentSpecializationCount: candidate.fragmentSpecializationCount,
      vertexSpvSha256: candidate.vertexSpvSha256,
      vertexSpvBytes: candidate.vertexSpvBytes,
      vertexSpecializationCount: candidate.vertexSpecializationCount,
      shaderBundleSha256: candidate.shaderBundleSha256,
    });
  }
  const officialUses = [];
  for (const variant of officialEvidence.variants || []) {
    for (const use of variant.materialUses || []) {
      if (use.card !== cardId) continue;
      const materialKeywords = variant.materialKeywords || [];
      const runtimeVariants = (runtimeVariantsByShader.get(variant.shader) || []).filter((candidate) => (
        materialKeywords.every((keyword) => candidate.compiledKeywords.includes(keyword))
      ));
      if (runtimeVariants.length === 0) runtimeVariants.push({
        compiledKeywords: variant.compiledKeywords || [],
        keywordIndices: variant.keywordIndices || [],
        blobIndex: variant.blobIndex,
        fragmentSpvSha256: variant.fragmentSpvSha256,
        fragmentSpvBytes: variant.fragmentSpvBytes,
        fragmentSpecializationCount: variant.fragmentSpecializationCount,
        vertexSpvSha256: variant.vertexSpvSha256,
        vertexSpvBytes: variant.vertexSpvBytes,
        vertexSpecializationCount: variant.vertexSpecializationCount,
        shaderBundleSha256: variant.shaderBundleSha256,
      });
      officialUses.push({
        expectedId: `${use.rendererPathId}#${use.materialSlot}`,
        materialName: use.material,
        materialSlot: use.materialSlot,
        rendererPathId: use.rendererPathId,
        shader: variant.shortShader,
        fragmentSpvSha256: variant.fragmentSpvSha256,
        fragmentSpvBytes: variant.fragmentSpvBytes,
        materialKeywords,
        runtimeVariants,
      });
    }
  }
  requireCondition(officialUses.length > 0, `official extractor has no Material uses for ${cardId}`);
  const geometry = new Map();
  for (const draw of glbDraws) mapPush(geometry, draw.materialName, draw.indexCount);
  const sceneDraw = new Map((scene.officialDraws || []).map((draw) => [`${draw.rendererIdentity?.split(":").at(-1)}#${draw.materialSlot}`, draw]));
  return officialUses.map((draw) => {
    const material = scene.materials?.[draw.materialName];
    const identity = sceneDraw.get(draw.expectedId);
    return {
      ...draw,
      drawId: identity?.drawId || null,
      go: identity?.go || null,
      queue: Number.isFinite(material?.queue) ? material.queue : null,
      indexCounts: [...new Set(geometry.get(draw.materialName) || [])].sort((a, b) => a - b),
      category: EXCEPTION_SHADERS.has(draw.shader) ? draw.shader : "exact-core",
    };
  });
}

function runtimeProgramMatches(draw, variant) {
  return variant.fragmentSpvSha256 === draw.fragment?.sha256
    && variant.fragmentSpvBytes === draw.fragment?.codeSize
    && variant.fragmentSpecializationCount === draw.fragment?.specializationCount
    && variant.vertexSpvSha256 === draw.vertex?.sha256
    && variant.vertexSpvBytes === draw.vertex?.codeSize
    && variant.vertexSpecializationCount === draw.vertex?.specializationCount;
}

function localCandidates(draw, expectedDraws) {
  if (!draw.fragment || !draw.vertex) return [];
  return expectedDraws.filter((expected) => {
    const programMatch = expected.runtimeVariants.some((variant) => runtimeProgramMatches(draw, variant));
    if (!programMatch) return false;
    if (expected.indexCounts.length > 0) {
      if (draw.event !== "cmd-draw-indexed") return false;
      if (!expected.indexCounts.includes(draw.indexCount)) return false;
    }
    return true;
  });
}

function matchingRuntimeVariants(draw, expected) {
  return expected.runtimeVariants.filter((variant) => runtimeProgramMatches(draw, variant));
}

export function solveDrawAssignments(runtimeDraws, expectedDraws, solutionLimit = 4096) {
  const candidates = runtimeDraws.map((draw) => localCandidates(draw, expectedDraws));
  const solutions = [];
  const used = new Set();
  const assignment = [];
  let truncated = false;

  function visit(index) {
    if (solutions.length >= solutionLimit) {
      truncated = true;
      return;
    }
    if (index === runtimeDraws.length) {
      if (used.size === expectedDraws.length) solutions.push([...assignment]);
      return;
    }
    for (const candidate of candidates[index]) {
      if (used.has(candidate.expectedId)) continue;
      used.add(candidate.expectedId);
      assignment.push(candidate.expectedId);
      visit(index + 1);
      assignment.pop();
      used.delete(candidate.expectedId);
    }
  }
  if (runtimeDraws.length === expectedDraws.length) visit(0);
  const expectedById = new Map(expectedDraws.map((draw) => [draw.expectedId, draw]));
  const rows = runtimeDraws.map((draw, index) => {
    const ids = truncated
      ? candidates[index].map((candidate) => candidate.expectedId)
      : solutions.length > 0
      ? [...new Set(solutions.map((solution) => solution[index]))]
      : candidates[index].map((candidate) => candidate.expectedId);
    const matches = ids.map((id) => expectedById.get(id)).filter(Boolean);
    const variantMatches = matches.map((match) => matchingRuntimeVariants(draw, match));
    const status = solutions.length === 0
      ? STATUS.MISMATCH
      : !truncated && matches.length === 1 && variantMatches[0]?.length === 1 ? STATUS.EXACT : STATUS.UNRESOLVED;
    return {
      runtimeOrdinal: index,
      status,
      candidates: matches.map((match) => ({
        expectedId: match.expectedId,
        materialName: match.materialName,
        shader: match.shader,
        queue: match.queue,
        category: match.category,
        runtimeVariants: matchingRuntimeVariants(draw, match).map((variant) => ({
          compiledKeywords: variant.compiledKeywords,
          keywordIndices: variant.keywordIndices,
          blobIndex: variant.blobIndex,
          shaderBundleSha256: variant.shaderBundleSha256,
          vertexSpvSha256: variant.vertexSpvSha256,
          vertexSpvBytes: variant.vertexSpvBytes,
          vertexSpecializationCount: variant.vertexSpecializationCount,
          fragmentSpvSha256: variant.fragmentSpvSha256,
          fragmentSpvBytes: variant.fragmentSpvBytes,
          fragmentSpecializationCount: variant.fragmentSpecializationCount,
        })),
      })),
      runtime: draw,
    };
  });
  const observedIds = new Set(truncated ? candidates.flat().map((candidate) => candidate.expectedId) : solutions.flat());
  const notObserved = expectedDraws.filter((draw) => !observedIds.has(draw.expectedId));
  return { rows, solutions: solutions.length, truncated, notObserved, localCandidateCounts: candidates.map((items) => items.length) };
}

export function matchCardScopes(scopes, expectedDraws) {
  return scopes.filter((scope) => {
    if (scope.submissions.length === 0) return false;
    if (scope.draws.length !== expectedDraws.length) return false;
    if (scope.draws.some((draw) => !draw.fragment)) return false;
    return solveDrawAssignments(scope.draws, expectedDraws, 1).solutions > 0;
  });
}

function summarizeMatches(rows, expectedDraws) {
  const count = (status) => rows.filter((row) => row.status === status).length;
  const exactCoreExpected = expectedDraws.filter((draw) => draw.category === "exact-core").length;
  const exactCore = rows.filter((row) => row.status === STATUS.EXACT
    && row.candidates[0]?.category === "exact-core").length;
  const exactProgram = rows.filter((row) => row.candidates.some((candidate) => candidate.runtimeVariants.length > 0)).length;
  const exactProgramCore = rows.filter((row) => row.candidates.some((candidate) => (
    candidate.category === "exact-core" && candidate.runtimeVariants.length > 0
  ))).length;
  return {
    expected: expectedDraws.length,
    observed: rows.length,
    exactProgram,
    exactProgramExpected: expectedDraws.length,
    exactProgramCore,
    exactProgramCoreExpected: exactCoreExpected,
    exact: count(STATUS.EXACT),
    unresolved: count(STATUS.UNRESOLVED),
    mismatch: count(STATUS.MISMATCH),
    exactCore,
    exactCoreExpected,
  };
}

export function importOfficialVulkanCapture({
  captureDir,
  scenePath,
  glbPath,
  officialEvidence,
  decryptedRoot = DEFAULT_DECRYPTED_ROOT,
}) {
  const absoluteCaptureDir = path.resolve(captureDir);
  const absoluteScenePath = path.resolve(scenePath);
  const scene = JSON.parse(fs.readFileSync(absoluteScenePath, "utf8").replace(/^\uFEFF/, ""));
  const absoluteGlbPath = path.resolve(glbPath || resolvePublicAsset(scene.prefabGlb));
  const capture = readCaptureEvents(absoluteCaptureDir);
  const shaderModules = indexShaderModules(absoluteCaptureDir, capture.events);
  const replay = replayCapture(capture.events, shaderModules);
  const evidence = officialEvidence || runOfficialExtractor(decryptedRoot);
  const glbDraws = parseGlbPrimitiveDraws(absoluteGlbPath);
  const expectedDraws = buildExpectedDraws({ scene, glbDraws, officialEvidence: evidence });
  const matchedScopes = matchCardScopes(replay.scopes, expectedDraws);
  const scopeReports = matchedScopes.map((scope) => {
    const solved = solveDrawAssignments(scope.draws, expectedDraws);
    return {
      ordinal: scope.ordinal,
      commandBuffer: scope.commandBuffer,
      renderPass: scope.renderPass,
      framebuffer: scope.framebuffer,
      area: scope.area,
      framebufferState: scope.framebufferState,
      submissions: scope.submissions,
      assignmentSolutions: solved.solutions,
      assignmentSearchTruncated: solved.truncated,
      summary: summarizeMatches(solved.rows, expectedDraws),
      draws: solved.rows,
      notObserved: solved.notObserved,
    };
  });
  const best = [...scopeReports].sort((a, b) =>
    b.summary.exact - a.summary.exact || a.summary.unresolved - b.summary.unresolved || a.ordinal - b.ordinal)[0] || null;
  const status = !best ? STATUS.NOT_OBSERVED
    : best.summary.mismatch > 0 || best.notObserved.length > 0 ? STATUS.MISMATCH
      : best.summary.unresolved > 0 ? STATUS.UNRESOLVED : STATUS.EXACT;
  return {
    schema: IMPORT_SCHEMA,
    status,
    source: {
      expectedCaptureSchema: CAPTURE_SCHEMA,
      declaredCaptureSchema: null,
      provenanceStatus: "incomplete-no-capture-manifest",
      captureEventsSha256: capture.sourceSha256,
      eventCount: capture.events.length,
      uniqueShaderModules: shaderModules.unique.length,
      scene: path.relative(ROOT, absoluteScenePath).replaceAll("\\", "/"),
      sceneSha256: sha256(fs.readFileSync(absoluteScenePath)),
      glb: path.relative(ROOT, absoluteGlbPath).replaceAll("\\", "/"),
      glbSha256: sha256(fs.readFileSync(absoluteGlbPath)),
      card: scene.card?.id || scene.card?.illId || scene.card,
    },
    expectedDraws: expectedDraws.map((draw) => ({
      expectedId: draw.expectedId,
      drawId: draw.drawId,
      go: draw.go,
      materialName: draw.materialName,
      shader: draw.shader,
      queue: draw.queue,
      indexCounts: draw.indexCounts,
      category: draw.category,
      fragmentSpvSha256: draw.fragmentSpvSha256,
      fragmentSpvBytes: draw.fragmentSpvBytes,
      runtimeVariantCount: draw.runtimeVariants.length,
    })),
    capture: {
      renderPassScopes: replay.scopes.length,
      matchedCardScopes: matchedScopes.length,
      submissions: replay.submissions.length,
      queueSubmits: replay.queueSubmits.length,
      captureStarts: replay.captureStarts,
      presents: replay.presents,
      successfulPresents: replay.presents.filter((event) => event.result === 0).length,
      provenance: {
        status: "incomplete",
        missing: ["capture schema declaration", "game package/version", "device/GPU/driver identity"],
      },
    },
    bestScopeOrdinal: best?.ordinal ?? null,
    bestSummary: best?.summary || {
      expected: expectedDraws.length,
      observed: 0,
      exact: 0,
      exactProgram: 0,
      exactProgramExpected: expectedDraws.length,
      exactProgramCore: 0,
      exactProgramCoreExpected: expectedDraws.filter((draw) => draw.category === "exact-core").length,
      unresolved: 0,
      mismatch: 0,
      exactCore: 0,
      exactCoreExpected: expectedDraws.filter((draw) => draw.category === "exact-core").length,
    },
    scopes: scopeReports,
  };
}

function parseCli(argv) {
  const args = [...argv];
  const prettyIndex = args.indexOf("--pretty");
  const pretty = prettyIndex >= 0;
  if (pretty) args.splice(prettyIndex, 1);
  const [captureDir, scenePath, outputPath] = args;
  if (!captureDir || !scenePath) {
    throw new Error("Usage: node build/import-official-vulkan-runtime-capture.mjs <capture-dir> <scene.json> [output.json] [--pretty]");
  }
  return { captureDir, scenePath, outputPath, pretty };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = parseCli(process.argv.slice(2));
    const output = importOfficialVulkanCapture(args);
    const json = args.pretty ? `${JSON.stringify(output, null, 2)}\n` : stableJson(output);
    if (args.outputPath) fs.writeFileSync(path.resolve(args.outputPath), json);
    else process.stdout.write(json);
    console.error(`official Vulkan runtime import: ${output.status}; ${output.bestSummary.exactProgram}/${output.bestSummary.exactProgramExpected} exact programs; ${output.bestSummary.exact}/${output.bestSummary.expected} unique identities`);
    if (output.status === STATUS.MISMATCH || output.status === STATUS.NOT_OBSERVED) process.exitCode = 1;
  } catch (error) {
    console.error(`BAD official Vulkan runtime import: ${error.message}`);
    process.exitCode = 1;
  }
}
