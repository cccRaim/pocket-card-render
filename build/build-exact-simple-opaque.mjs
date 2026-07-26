#!/usr/bin/env node
// Generate the empty-keyword Simple-Opaque WebGL port from its official selector.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  buildOfficialSpirvPrecisionEvidence,
  compileCommonBindings,
  compileOfficialVertexInputContract,
  compileProgramBindings,
  joinProgramSamplerBindings,
} from "./exact-selector-port-core.mjs";
import { buildWebglAdaptationV2 } from "./webgl-adaptation-contract.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHADER_ROOT = process.env.PCR_SHADERS
  || "D:/DevProjectes/ptcgp-tools-master/masterdata_decoder/.output/decrypted/Common/Shader";
const PYTHON = process.env.PYTHON || "python";
const SPIRV_CROSS = process.env.SPIRV_CROSS || "spirv-cross";
const OUT = path.join(ROOT, "public", "shaders");
const CHECK = process.argv.includes("--check") || process.env.PCR_EXACT_CHECK === "1";
const SELECTOR_ID = "ba9f1662214113f55fc89c0657dcb826bc418dff969484de83ed08d9e0b65a13";
const CANDIDATE_WITNESS_ID = "b887eb58c1aa886395cac04fb190ad18086c935c3f92145363e9990b9cfc5fef";
const PROOF_GRAPH_SHA256 = "9862f63e11f359ed3b92b0191d21a2b6520de5a37159fd14612bdaf1908396b0";
const PORT_INDEX_SHA256 = "30bc4d0eab1c1ad82147e880c642cbd8fba6d55cbd2227c2aa78f082f14e7e3f";
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pcr-simple-opaque-"));

function run(command, args) {
  return execFileSync(command, args, {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    shell: process.platform === "win32",
  });
}

function digest(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function fileDigest(file) {
  return digest(fs.readFileSync(file));
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function canonicalJsonDigest(value) {
  return digest(canonicalJson(value));
}

function officialParam(value) {
  if (!value || !Number.isFinite(Number(value.val))) throw new Error("official pass parameter is absent");
  return { val: Number(value.val), name: value.name === "<noninit>" ? null : value.name };
}

function runtimePassContract(passContract, sourceSha256) {
  const state = passContract?.state;
  if (!state || state.rtSeparateBlend !== false) throw new Error("Simple-Opaque MRT blend contract changed");
  const fixed = {
    zClip: officialParam(state.zClip),
    conservative: officialParam(state.conservative),
    offsetFactor: officialParam(state.offsetFactor),
    offsetUnits: officialParam(state.offsetUnits),
    alphaToMask: officialParam(state.alphaToMask),
    fogMode: state.fogMode,
    lighting: state.lighting,
  };
  assert.deepEqual(fixed, {
    zClip: { val: 1, name: null },
    conservative: { val: 0, name: null },
    offsetFactor: { val: 0, name: null },
    offsetUnits: { val: 0, name: null },
    alphaToMask: { val: 0, name: null },
    fogMode: -1,
    lighting: false,
  });
  const blend = state.rtBlend0;
  return {
    source_sha256: sourceSha256,
    shared_mrt_blend: true,
    blend: {
      src_rgb: officialParam(blend.srcBlend),
      dst_rgb: officialParam(blend.destBlend),
      src_alpha: officialParam(blend.srcBlendAlpha),
      dst_alpha: officialParam(blend.destBlendAlpha),
      op_rgb: officialParam(blend.blendOp),
      op_alpha: officialParam(blend.blendOpAlpha),
      color_mask: officialParam(blend.colMask),
    },
    depth: { test: officialParam(state.zTest), write: officialParam(state.zWrite) },
    culling: officialParam(state.culling),
    stencil: {
      ref: officialParam(state.stencilRef),
      read_mask: officialParam(state.stencilReadMask),
      write_mask: officialParam(state.stencilWriteMask),
      generic: Object.fromEntries(Object.entries(state.stencilOp)
        .map(([key, value]) => [key, officialParam(value)])),
      front: Object.fromEntries(Object.entries(state.stencilOpFront)
        .map(([key, value]) => [key, officialParam(value)])),
      back: Object.fromEntries(Object.entries(state.stencilOpBack)
        .map(([key, value]) => [key, officialParam(value)])),
    },
    fixed,
  };
}

function reflect(file) {
  return JSON.parse(run(SPIRV_CROSS, [file, "--reflect"]));
}

function assertOfficialInterface(vertex, fragment) {
  const vertexUbo = vertex.ubos?.[0];
  assert.deepEqual({
    name: vertexUbo?.name,
    size: vertexUbo?.block_size,
    set: vertexUbo?.set,
    binding: vertexUbo?.binding,
  }, { name: "_18_20", size: 128, set: 1, binding: 0 });
  assert.deepEqual((vertex.inputs || []).map(({ name, type, location }) => ({ name, type, location })), [
    { name: "_11", type: "vec4", location: 0 },
    { name: "_87", type: "vec2", location: 1 },
  ]);
  assert.deepEqual((vertex.outputs || []).map(({ name, type, location }) => ({ name, type, location })), [
    { name: "vs_TEXCOORD0", type: "vec2", location: 0 },
  ]);
  assert.deepEqual((fragment.inputs || []).map(({ name, type, location }) => ({ name, type, location })), [
    { name: "vs_TEXCOORD0", type: "vec2", location: 0 },
  ]);
  assert.deepEqual((fragment.outputs || []).map(({ name, type, location }) => ({ name, type, location })), [
    { name: "_9", type: "vec4", location: 0 },
    { name: "_20", type: "vec4", location: 1 },
  ]);
  assert.deepEqual((fragment.textures || []).map(({ name, type, set, binding }) => ({ name, type, set, binding })), [
    { name: "_13", type: "sampler2D", set: 0, binding: 0 },
  ]);
}

function adaptVertex(officialSource) {
  officialSource = `${officialSource.replaceAll("\r\n", "\n").trimEnd()}\n`;
  const expected = `#version 300 es

layout(std140) uniform _18_20
{
    vec4 _m0[4];
    vec4 _m1[4];
} _20;

layout(location = 0) in vec4 _11;
out vec2 vs_TEXCOORD0;
layout(location = 1) in vec2 _87;
vec4 _9;
vec4 _48;

void main()
{
    _9 = _11.yyyy * _20._m0[1];
    _9 = (_20._m0[0] * _11.xxxx) + _9;
    _9 = (_20._m0[2] * _11.zzzz) + _9;
    _9 += _20._m0[3];
    _48 = _9.yyyy * _20._m1[1];
    _48 = (_20._m1[0] * _9.xxxx) + _48;
    _48 = (_20._m1[2] * _9.zzzz) + _48;
    _9 = (_20._m1[3] * _9.wwww) + _48;
    gl_Position = _9;
    vs_TEXCOORD0 = _87;
    gl_Position.y = -gl_Position.y;
}
`;
  assert.equal(officialSource, expected, "official Simple-Opaque vertex decompilation changed");
  return `precision highp float;
precision highp int;

in vec3 position;
in vec2 uv;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
out vec2 vs_TEXCOORD0;

void main()
{
    vs_TEXCOORD0 = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
}

function adaptFragment(officialSource) {
  officialSource = `${officialSource.replaceAll("\r\n", "\n").trimEnd()}\n`;
  const expectedPrefix = "#version 300 es\n";
  assert.ok(officialSource.startsWith(expectedPrefix));
  const output = officialSource.slice(expectedPrefix.length);
  assert.match(output, /_9 = texture\(_13, vs_TEXCOORD0\);/);
  assert.match(output, /_20 = vec4\(0\.0\);/);
  return output;
}

try {
  const metadataFile = path.join(tmp, "selector.json");
  run(PYTHON, [
    "build/extract_official_selector_program.py",
    "--selector-id", SELECTOR_ID,
    "--candidate-witness-id", CANDIDATE_WITNESS_ID,
    "--expected-proof-graph-sha256", PROOF_GRAPH_SHA256,
    "--expected-port-index-sha256", PORT_INDEX_SHA256,
    "--decrypted-root", path.resolve(SHADER_ROOT, "..", ".."),
    "--out", tmp,
    "--prefix", "simple_opaque",
    "--metadata", metadataFile,
  ]);
  const metadata = JSON.parse(fs.readFileSync(metadataFile, "utf8"));
  const vertexSpv = path.join(tmp, "simple_opaque_vert.spv");
  const fragmentSpv = path.join(tmp, "simple_opaque_frag.spv");
  const officialSpirvPrecision = buildOfficialSpirvPrecisionEvidence({
    vertex: fs.readFileSync(vertexSpv),
    fragment: fs.readFileSync(fragmentSpv),
  });
  const vertexReflection = reflect(vertexSpv);
  const fragmentReflection = reflect(fragmentSpv);
  assertOfficialInterface(vertexReflection, fragmentReflection);
  assert.equal(metadata.artifacts.parameterEntry.byteSize, 64);
  assert.equal(metadata.parameterReflection.version, 202012090);
  assert.equal(metadata.parameterReflection.constantBlockCount, 2);
  assert.equal(metadata.parameterReflection.resourceCount, 0);
  assert.equal(metadata.parameterReflection.bindingClosure.constantBuffersMatch, true);
  const bindings = compileCommonBindings(metadata.commonBindings);
  const programBindings = compileProgramBindings(
    bindings,
    metadata.parameterReflection,
    metadata.shaderPropertyDefaults,
  );
  const manifestProgramBindings = {
    common_source_sha256: metadata.identityFields.commonBindingsSha256,
    parameter_reflection_sha256: metadata.parameterReflectionSha256,
    ...programBindings,
  };
  const vertexInputContract = compileOfficialVertexInputContract(
    metadata.programBindChannels,
    vertexReflection,
  );
  const samplerBindings = joinProgramSamplerBindings(programBindings, {
    vertex: vertexReflection,
    fragment: fragmentReflection,
  }).map(({ set, ...row }) => {
    assert.equal(set, 0, "WebGL sampler port requires descriptor set 0");
    return row;
  });
  assert.deepEqual(samplerBindings.map(({ slot, spirvName, binding }) => ({ slot, spirvName, binding })), [{
    slot: "_MainTex", spirvName: "_13", binding: 0,
  }]);

  const officialVertex = run(SPIRV_CROSS, [vertexSpv, "--version", "300", "--es"]);
  const officialFragment = run(SPIRV_CROSS, [fragmentSpv, "--version", "300", "--es"]);
  const vertex = adaptVertex(officialVertex);
  const fragment = adaptFragment(officialFragment);
  const runtimeContract = {
    schema: "pocket-card-render/webgl-runtime-port@1",
    shader_key: "Simple-Opaque",
    attributes: { position: "vec3", uv: "vec2" },
    engine_uniforms: { modelViewMatrix: "mat4", projectionMatrix: "mat4" },
    material_uniforms: { floats: [], ints: [], vectors: {} },
    require_complete_active_bindings: true,
    camera_from_view: false,
    mrt_attachments: 2,
    stencil_normalization: "disable-when-always-keep",
    stencil_face_mode: "generic",
  };
  const adaptation = buildWebglAdaptationV2({
    vertex: {
      officialSpirvSha256: fileDigest(vertexSpv),
      spirvCrossGlslSha256: digest(officialVertex),
      outputSha256: digest(vertex),
      operations: [
        { kind: "vertex-input-binding", contract: "official-bind-channels-to-three-r165" },
        { kind: "engine-uniform-binding", contract: "unity-builtins-to-three-r165" },
        {
          kind: "clip-space-y-conversion",
          from: "unity-vulkan",
          to: "webgl",
          operation: "remove-y-inversion",
        },
        {
          kind: "matrix-expression-fold",
          contract: "mvp-object-to-projection-model-view",
        },
        { kind: "glsl-version-ownership", owner: "three-raw-shader-material" },
      ],
      substitutions: [
        "position vec4 := vec4(three.position, 1.0)",
        "uv location 1 := three.uv",
        "unity_ObjectToWorld := three.modelMatrix",
        "unity_MatrixVP := three.projectionMatrix * three.viewMatrix",
        "remove Unity Vulkan clip-space Y inversion for WebGL clip space",
        "algebraically compose MatrixVP * ObjectToWorld as projectionMatrix * modelViewMatrix",
      ],
    },
    fragment: {
      officialSpirvSha256: fileDigest(fragmentSpv),
      spirvCrossGlslSha256: digest(officialFragment),
      outputSha256: digest(fragment),
      operations: [{
        kind: "glsl-version-ownership",
        owner: "three-raw-shader-material",
      }],
      substitutions: ["remove #version directive supplied by Three.js RawShaderMaterial"],
    },
    interfaceSha256: canonicalJsonDigest({ vertex: vertexReflection, fragment: fragmentReflection }),
    officialVertexInputs: vertexInputContract,
    runtimeContract,
    officialProgramBindings: manifestProgramBindings,
  });
  const outputs = {
    "simple_opaque.vert.glsl": vertex,
    "simple_opaque.frag.glsl": fragment,
    "simple_opaque_uniforms.json": `${JSON.stringify({
      shader: "Lettuce/Common/CardNew/ShadowBox/UI/Simple-Opaque",
      generated_by: "build/build-exact-simple-opaque.mjs",
      official_selector: metadata.selector,
      official_spirv_sha256: { vertex: fileDigest(vertexSpv), fragment: fileDigest(fragmentSpv) },
      official_spirv_precision: officialSpirvPrecision,
      official_executable_identity: metadata.identityFields,
      official_parameter_entry: {
        source_sha256: metadata.identityFields.parameterEntrySha256,
        byte_size: metadata.artifacts.parameterEntry.byteSize,
        reflection_sha256: metadata.parameterReflectionSha256,
        ...metadata.parameterReflection,
      },
      official_pass_runtime: runtimePassContract(metadata.passContract, metadata.identityFields.passStateSha256),
      official_common_bindings: {
        source_sha256: metadata.identityFields.commonBindingsSha256,
        ...bindings,
      },
      official_program_bindings: manifestProgramBindings,
      official_vertex_inputs: vertexInputContract,
      official_shader_property_defaults: metadata.shaderPropertyDefaults,
      webgl_adaptation: adaptation,
      webgl_sources: {
        vertex: "public/shaders/simple_opaque.vert.glsl",
        fragment: "public/shaders/simple_opaque.frag.glsl",
      },
      runtime_contract: runtimeContract,
      sampler_bindings: samplerBindings,
      samplers: samplerBindings.map((row) => row.spirvName),
      sampler_slots: samplerBindings.map((row) => row.slot),
      compiled_texture_bindings: Object.fromEntries(
        samplerBindings.map((row) => [row.slot, row.binding]),
      ),
      implicit_defaults: metadata.shaderPropertyDefaults.textures,
      mrt: { primary: "_9", secondary: "_20", secondary_value: "zero" },
    }, null, 2)}\n`,
  };
  fs.mkdirSync(OUT, { recursive: true });
  for (const [name, content] of Object.entries(outputs)) {
    const file = path.join(OUT, name);
    if (CHECK) {
      if (!fs.existsSync(file) || fs.readFileSync(file, "utf8") !== content) {
        throw new Error(`${name} does not match official regeneration`);
      }
    } else fs.writeFileSync(file, content);
  }
  console.log(`${CHECK ? "verified" : "generated"} Simple-Opaque from selector-bound official SPIR-V`);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
