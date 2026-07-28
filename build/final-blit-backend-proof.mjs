import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PYTHON = process.env.PYTHON || "python";
const GLSLANG = process.env.GLSLANG_VALIDATOR || "glslangValidator";
const SPIRV_DIS = process.env.SPIRV_DIS || "spirv-dis";
const SPIRV_VAL = process.env.SPIRV_VAL || "spirv-val";

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    ...options,
  });
}

export function readOfficialFinalBlitEvidence() {
  return JSON.parse(run(PYTHON, ["-B", "build/extract_official_final_blit.py"], {
    maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
    shell: process.platform === "win32",
  }).replace(/^\uFEFF/, ""));
}

export function readOfficialInlineSamplerEvidence() {
  return JSON.parse(run(PYTHON, ["-B", "build/extract_official_inline_sampler.py"], {
    maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
    shell: process.platform === "win32",
  }).replace(/^\uFEFF/, ""));
}

function samplePrecision(disassembly, label) {
  const matches = [...disassembly.matchAll(
    /^\s*(%\w+)\s*=\s*OpImageSampleExplicitLod\b.*$/gm,
  )];
  assert.equal(matches.length, 1, `${label} must contain one explicit-LOD image sample`);
  const resultId = matches[0][1];
  const relaxed = new RegExp(
    `^\\s*OpDecorate\\s+${resultId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s+RelaxedPrecision\\s*$`,
    "m",
  ).test(disassembly);
  return { resultId, relaxed };
}

function inspectSpirvFile(file, label) {
  run(SPIRV_VAL, [file]);
  const disassembly = run(SPIRV_DIS, [file, "--no-color"]);
  return {
    ...samplePrecision(disassembly, label),
    disassembly,
  };
}

function compileWebglStage(source, stage, directory) {
  const extension = stage === "fragment" ? "frag" : "vert";
  const sourceFile = path.join(directory, `final_blit.local.${extension}`);
  const spirvFile = path.join(directory, `final_blit.local.${extension}.spv`);
  fs.writeFileSync(sourceFile, `#version 310 es\n${source}`, "utf8");
  run(GLSLANG, [
    "-G",
    "--auto-map-bindings",
    "--auto-map-locations",
    "-S",
    extension,
    "-o",
    spirvFile,
    sourceFile,
  ]);
  return spirvFile;
}

function writeOfficialFragment(evidence, directory) {
  const module = evidence.shaderProgram?.pass?.modules
    ?.find((entry) => entry.stage === "fragment");
  assert(module?.spvHex, "official FinalBlit fragment SPIR-V is missing");
  const file = path.join(directory, "final_blit.official.frag.spv");
  fs.writeFileSync(file, Buffer.from(module.spvHex, "hex"));
  return file;
}

function bitfieldInsertZeroAtBitOne(value) {
  return (value & 1) << 1;
}

function proveVertexIdBitExtraction(vertexSource) {
  assert.match(
    vertexSource,
    /_9\.x\s*=\s*\(uint\(gl_VertexID\)\s*&\s*1u\)\s*<<\s*1u\s*;/,
    "FinalBlit vertex bit-0 extraction changed",
  );
  assert.match(
    vertexSource,
    /_9\.w\s*=\s*uint\(gl_VertexID\)\s*&\s*2u\s*;/,
    "FinalBlit vertex bit-1 extraction changed",
  );
  for (let residue = 0; residue < 4; residue += 1) {
    const officialX = bitfieldInsertZeroAtBitOne(residue);
    const localX = (residue & 1) << 1;
    assert.equal(localX, officialX, `vertex-id residue ${residue} bit extraction`);
    assert.equal(residue & 2, [0, 0, 2, 2][residue]);
  }
  const vertices = [0, 1, 2].map((vertexId) => ({
    x: ((vertexId & 1) << 1) * 2 - 1,
    y: (vertexId & 2) * 2 - 1,
  }));
  const signedDoubleArea = (
    (vertices[1].x - vertices[0].x) * (vertices[2].y - vertices[0].y)
    - (vertices[1].y - vertices[0].y) * (vertices[2].x - vertices[0].x)
  );
  assert(signedDoubleArea > 0, "FinalBlit fullscreen triangle winding changed");
  return {
    proof: "all 32-bit inputs partition by bits 0..1; higher bits are masked",
    residueClasses: 4,
    vertices,
    signedDoubleArea,
  };
}

function proveDispatchBoundYBasis(vertexSource, scaleBias) {
  assert.deepEqual(scaleBias.length, 4, "FinalBlit scaleBias must be vec4");
  assert(scaleBias.every(Number.isFinite), "FinalBlit scaleBias must be finite");
  assert.doesNotMatch(vertexSource, /gl_Position\.y\s*=\s*-gl_Position\.y/);
  assert.match(vertexSource, /_30\.z\s*=\s*_30\.y\s*;/);
  const [, scaleY, , biasY] = scaleBias;
  assert.equal(
    scaleY + 2 * biasY,
    1,
    "paired Vulkan/WebGL Y removal requires scaleY + 2*biasY == 1",
  );
  for (const y of [0, 1]) {
    const local = y * scaleY + biasY;
    const official = (1 - y) * scaleY + biasY;
    assert.equal(local, 1 - official, `FinalBlit Y-basis relation at y=${y}`);
  }
  return {
    predicate: "scaleY + 2*biasY == 1",
    scaleBias: [...scaleBias],
  };
}

function verifySourceShape(vertexSource, fragmentSource) {
  assert.match(fragmentSource, /uniform\s+highp\s+sampler2D\s+_BlitTexture\s*;/);
  assert.doesNotMatch(fragmentSource, /uniform\s+mediump\s+sampler2D\s+_BlitTexture\s*;/);
  assert.match(
    fragmentSource,
    /textureLod\(_BlitTexture,\s*vUv,\s*_BlitMipLevel\)/,
  );
  assert.equal(
    (fragmentSource.match(/\btexture(?:Lod)?\s*\(/g) || []).length,
    1,
    "FinalBlit fragment must contain exactly one texture operation",
  );
  assert.match(vertexSource, /uniform\s+highp\s+vec4\s+_BlitScaleBias\s*;/);
  assert.match(fragmentSource, /uniform\s+highp\s+float\s+_BlitMipLevel\s*;/);
}

function verifyOfficialBindings(evidence) {
  const bindings = evidence.shaderProgram?.pass?.bindings;
  assert(bindings, "official FinalBlit bindings are missing");
  assert.deepEqual(
    bindings.samplers,
    [{
      name: "_BlitTexture",
      binding: 0,
      encodedIndex: 0x08000000,
      samplerIndex: -1,
      dimension: 2,
      multisampled: false,
    }],
    "official FinalBlit texture binding changed",
  );
  assert.equal(bindings.constantBuffers?.length, 2, "official FinalBlit constant-buffer count changed");
  const normalizedBuffers = bindings.constantBuffers.map((buffer) => ({
    nameClass: /^PGlobals\d+$/.test(buffer.name)
      ? "PGlobals"
      : /^VGlobals\d+$/.test(buffer.name) ? "VGlobals" : buffer.name,
    size: buffer.size,
    partial: buffer.partial,
    vectors: buffer.vectors,
    matrices: buffer.matrices,
  }));
  assert.deepEqual(
    normalizedBuffers,
    [
      {
        nameClass: "PGlobals",
        size: 4,
        partial: true,
        vectors: [{
          name: "_BlitMipLevel",
          kind: "vector",
          offset: 0,
          dimension: 1,
          arraySize: 0,
        }],
        matrices: [],
      },
      {
        nameClass: "VGlobals",
        size: 16,
        partial: true,
        vectors: [{
          name: "_BlitScaleBias",
          kind: "vector",
          offset: 0,
          dimension: 4,
          arraySize: 0,
        }],
        matrices: [],
      },
    ],
    "official FinalBlit constant-buffer layout changed",
  );
  assert.deepEqual(
    bindings.serializedSamplerStates,
    [{ bindPoint: 0x08000001, sampler: 85 }],
    "official FinalBlit serialized sampler state changed",
  );
  return {
    texture: {
      name: "_BlitTexture",
      binding: 0,
      dimension: "2D",
      multisampled: false,
    },
    constantBuffers: {
      PGlobals: { size: 4, member: "_BlitMipLevel", offset: 0, dimension: 1 },
      VGlobals: { size: 16, member: "_BlitScaleBias", offset: 0, dimension: 4 },
    },
    packedSampler: { bindPoint: 0x08000001, value: 85 },
  };
}

function verifyInlineSampler(inlineEvidence, manifest) {
  assert.equal(
    inlineEvidence?.schema,
    "pocket-card-render/official-inline-sampler@1",
    "official inline sampler evidence schema changed",
  );
  assert.equal(inlineEvidence?.decoded?.packedValue, 85, "official inline sampler value changed");
  assert.deepEqual(
    inlineEvidence?.decoded?.webgl2,
    {
      magFilter: "LINEAR",
      minFilter: "LINEAR",
      wrapS: "CLAMP_TO_EDGE",
      wrapT: "CLAMP_TO_EDGE",
    },
    "official inline sampler WebGL2 decode changed",
  );
  assert.equal(manifest?.sampler_state?.packed_value, 85, "FinalBlit manifest sampler value changed");
  assert.deepEqual(
    manifest?.sampler_state?.webgl2,
    inlineEvidence.decoded.webgl2,
    "FinalBlit manifest sampler mapping differs from the native decode",
  );
  const producerHashes = Object.fromEntries(
    Object.entries(inlineEvidence.nativeFunctions)
      .map(([name, entry]) => [name, entry.game.sha256]),
  );
  assert.deepEqual(
    manifest?.sampler_state?.producer_hashes,
    producerHashes,
    "FinalBlit manifest sampler producer hashes changed",
  );
  return {
    packedValue: 85,
    webgl2: inlineEvidence.decoded.webgl2,
    nativeProducerHashes: producerHashes,
  };
}

export function auditFinalBlitBackendProof(options = {}) {
  const evidence = options.officialEvidence ?? readOfficialFinalBlitEvidence();
  const inlineEvidence = options.inlineSamplerEvidence ?? readOfficialInlineSamplerEvidence();
  const manifest = options.manifest ?? JSON.parse(
    fs.readFileSync(path.join(ROOT, "public/shaders/final_blit_program.json"), "utf8"),
  );
  const vertexSource = options.vertexSource
    ?? fs.readFileSync(path.join(ROOT, "public/shaders/final_blit.vert.glsl"), "utf8");
  const fragmentSource = options.fragmentSource
    ?? fs.readFileSync(path.join(ROOT, "public/shaders/final_blit.frag.glsl"), "utf8");
  const scaleBias = options.scaleBias ?? [1, 1, 0, 0];
  verifySourceShape(vertexSource, fragmentSource);
  const bindings = verifyOfficialBindings(evidence);
  const inlineSampler = verifyInlineSampler(inlineEvidence, manifest);
  const vertexId = proveVertexIdBitExtraction(vertexSource);
  const yBasis = proveDispatchBoundYBasis(vertexSource, scaleBias);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "pcr-final-blit-proof-"));
  try {
    const officialFile = writeOfficialFragment(evidence, directory);
    const localFile = compileWebglStage(fragmentSource, "fragment", directory);
    const official = inspectSpirvFile(officialFile, "official FinalBlit fragment");
    const local = inspectSpirvFile(localFile, "local FinalBlit fragment round-trip");
    assert.equal(
      official.relaxed,
      false,
      "official FinalBlit explicit-LOD sample unexpectedly became RelaxedPrecision",
    );
    assert.equal(
      local.relaxed,
      false,
      "local FinalBlit explicit-LOD sample is RelaxedPrecision",
    );
    return {
      schema: "pocket-card-render/final-blit-backend-proof@1",
      status: "exact",
      exactObligations: 6,
      totalObligations: 6,
      obligations: {
        vertexIdBitExtraction: { status: "exact", ...vertexId },
        dispatchBoundYBasis: { status: "exact", ...yBasis },
        uboFlatteningShape: {
          status: "exact",
          official: bindings.constantBuffers,
          local: { scaleBias: "highp vec4", mipLevel: "highp float" },
        },
        explicitLodShape: { status: "exact", sampleCount: 1 },
        explicitLodPrecision: {
          status: "exact",
          officialRelaxedPrecision: official.relaxed,
          localRoundTripRelaxedPrecision: local.relaxed,
        },
        samplerState: {
          status: "exact",
          textureBinding: bindings.texture,
          serializedSamplerState: bindings.packedSampler,
          decoded: inlineSampler,
        },
      },
      claim: "restricted source/native-producer/round-trip proof; not target-device driver equivalence",
    };
  } finally {
    for (const entry of fs.readdirSync(directory)) {
      fs.rmSync(path.join(directory, entry), { force: true });
    }
    fs.rmdirSync(directory);
  }
}
