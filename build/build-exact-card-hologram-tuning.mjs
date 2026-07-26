#!/usr/bin/env node
// Generate Card_Hologram_Tuning from its exact official material selector.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  adaptThreeViewForwardToUnityDataAxes,
  adaptThreeWorldVectorsToUnityDataAxes,
  buildOfficialSpirvPrecisionEvidence,
  compileCommonBindings,
  compileOfficialPassContract,
  compileOfficialVertexInputContract,
  compileProgramBindings,
  joinProgramSamplerBindings,
  writeOrCheckOutputs,
} from "./exact-selector-port-core.mjs";
import { buildWebglAdaptationV2 } from "./webgl-adaptation-contract.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHADER_ROOT = process.env.PCR_SHADERS
  || "D:/DevProjectes/ptcgp-tools-master/masterdata_decoder/.output/decrypted/Common/Shader";
const PYTHON = process.env.PYTHON || "python";
const SPIRV_CROSS = process.env.SPIRV_CROSS || "spirv-cross";
const OUT = path.join(ROOT, "public", "shaders");
const CHECK = process.argv.includes("--check") || process.env.PCR_EXACT_CHECK === "1";
const SELECTOR_ID = "782e751eb65ac33e9e7e197acbbe0808e47da620c49de39f13ef173100723380";
const CANDIDATE_WITNESS_ID = "df81cc574e4b0bb1bb3c8e8a91279f297885cbafe79b84f9a1fee512d7cd2519";
const PROOF_GRAPH_SHA256 = "9862f63e11f359ed3b92b0191d21a2b6520de5a37159fd14612bdaf1908396b0";
const PORT_INDEX_SHA256 = "30bc4d0eab1c1ad82147e880c642cbd8fba6d55cbd2227c2aa78f082f14e7e3f";
const OFFICIAL_CROSS_SHA256 = {
  vertex: "94dc4cd2a68dfa9d1a705bbea05a76341c6cb01e47db10168708c8b12f8d2443",
  fragment: "7cd083ccdd2d6a308775354059f5184b35e67eb98031fba74491159af73677d4",
};
const PASS_POLICY = {
  rtSeparateBlend: false,
  fixed: {
    zClip: { val: 1, name: null },
    conservative: { val: 0, name: null },
    offsetFactor: { val: 0, name: null },
    offsetUnits: { val: 0, name: null },
    alphaToMask: { val: 0, name: null },
    fogMode: -1,
    lighting: false,
  },
};
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pcr-card-hologram-tuning-"));

const vertexMembers = ["_ObjectToWorld", "_WorldToObject", "_ViewProjection", "_UseUv", "_UseMaskUv"];
const fragmentMembers = [
  "viewMatrix", "_DiffractionIntensity", "_DiffractionPower", "_RampRepeat", "_RampSpeed",
  "_RampOffset", "_RampInterval", "_RampUVOffset", "_RampUVTiltOffset", "_RampScale",
  "_PhaseScale", "_RampRotate", "_PhaseRotate", "_AlphaBlend", "_MaskPower", "_CutOut",
  "_Rotation", "_UseAlphaAsAlphaBlendMask", "_UseReflectionAlpha",
];
const floatNames = [
  "_UseUv", "_UseMaskUv", "_DiffractionIntensity", "_DiffractionPower", "_RampRepeat",
  "_RampSpeed", "_RampOffset", "_RampInterval", "_RampUVOffset", "_RampUVTiltOffset",
  "_RampScale", "_PhaseScale", "_RampRotate", "_PhaseRotate", "_AlphaBlend", "_MaskPower",
  "_CutOut", "_UseAlphaAsAlphaBlendMask", "_UseReflectionAlpha",
];
const materialFloats = [
  "_DiffractionIntensity", "_DiffractionPower", "_RampRepeat", "_RampSpeed", "_RampOffset",
  "_RampInterval", "_RampUVOffset", "_RampUVTiltOffset", "_RampScale", "_PhaseScale",
  "_RampRotate", "_PhaseRotate", "_AlphaBlend", "_MaskPower", "_CutOut",
];
const materialInts = ["_UseUv", "_UseMaskUv", "_UseAlphaAsAlphaBlendMask", "_UseReflectionAlpha"];
const FRAGMENT_BASIS_CONVERSIONS = {
  worldVectors: [
    { source: "vs_TEXCOORD2", alias: "pcrUnityWorldNormal", expectedOccurrences: 3 },
  ],
  viewForwards: [{ matrixName: "viewMatrix", targetName: "_59" }],
};

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

function replaceMembers(source, owner, mapping) {
  return source.replace(new RegExp(`${owner}\\._m(\\d+)`, "g"), (match, rawIndex) => {
    const value = mapping[Number(rawIndex)];
    if (value == null) throw new Error(`unmapped ${match}`);
    return value;
  });
}

function replaceUbo(source, blockName, instanceName, uniforms) {
  const re = new RegExp(`layout\\(std140\\) uniform ${blockName}[\\s\\S]*?}\\s*${instanceName};\\s*`);
  const out = source.replace(re, `${uniforms.join("\n")}\n\n`);
  if (out === source) throw new Error(`${blockName} UBO replacement failed`);
  return out;
}

function assertJsonEqual(actual, expected, message) {
  assert.deepEqual(actual, expected, message);
}

function assertReflection(reflection, expected) {
  const ubo = (reflection.ubos || []).find((item) => item.name === expected.ubo.name);
  assert.equal(ubo?.block_size, expected.ubo.size, `${expected.ubo.name} UBO size changed`);
  assertJsonEqual(
    (reflection.types?.[ubo.type]?.members || []).map(({ name, type, offset }) => ({ name, type, offset })),
    expected.ubo.members,
    `${expected.ubo.name} members changed`,
  );
  for (const key of ["inputs", "outputs"]) {
    assertJsonEqual(
      (reflection[key] || []).map(({ name, type, location }) => ({ name, type, location }))
        .sort((a, b) => a.location - b.location),
      expected[key],
      `shader ${key} changed`,
    );
  }
  assertJsonEqual(
    (reflection.textures || []).map(({ name, type, binding }) => ({ name, type, binding }))
      .sort((a, b) => a.binding - b.binding),
    expected.textures || [],
    "shader texture bindings changed",
  );
}

function adaptVertex(source) {
  let out = source.replace(/^#version 300 es\s*/m, "precision highp float;\nprecision highp int;\n\n");
  out = replaceUbo(out, "_20_22", "_22", [
    "uniform highp mat4 modelMatrix;",
    "uniform highp mat4 viewMatrix;",
    "uniform highp mat4 projectionMatrix;",
    "uniform int _UseUv;",
    "uniform int _UseMaskUv;",
  ]);
  out = out
    .replace("layout(location = 0) in vec4 _11;", "in vec3 position;")
    .replace("layout(location = 2) in vec2 _99;", "in vec2 uv;")
    .replace("layout(location = 3) in vec2 _103;", "in vec2 uv1;")
    .replace("layout(location = 1) in vec3 _116;", "in vec3 normal;")
    .replace(/void main\(\)\s*\{/, [
      "void main()", "{",
      "    vec4 _11 = vec4(position, 1.0);",
      "    vec2 _99 = uv;",
      "    vec2 _103 = uv1;",
      "    vec3 _116 = normal;",
      "    mat4 _ObjectToWorld = modelMatrix;",
      "    mat4 _WorldToObject = inverse(modelMatrix);",
      "    mat4 _ViewProjection = projectionMatrix * viewMatrix;",
    ].join("\n"));
  out = replaceMembers(out, "_22", vertexMembers);
  out = out.replace(/^\s*gl_Position\.y\s*=\s*-gl_Position\.y;\s*$/m, "");
  if (/_22\._m|gl_Position\.y\s*=\s*-gl_Position\.y/.test(out)) {
    throw new Error("vertex adaptation incomplete");
  }
  return `${out.trimEnd()}\n`;
}

function adaptFragment(source) {
  let out = source.replace(/^#version 300 es\s*/m, "");
  out = replaceUbo(out, "_32_34", "_34", [
    "uniform highp mat4 viewMatrix;",
    "uniform float _DiffractionIntensity;",
    "uniform float _DiffractionPower;",
    "uniform float _RampRepeat;",
    "uniform float _RampSpeed;",
    "uniform float _RampOffset;",
    "uniform float _RampInterval;",
    "uniform float _RampUVOffset;",
    "uniform float _RampUVTiltOffset;",
    "uniform float _RampScale;",
    "uniform float _PhaseScale;",
    "uniform float _RampRotate;",
    "uniform float _PhaseRotate;",
    "uniform float _AlphaBlend;",
    "uniform float _MaskPower;",
    "uniform float _CutOut;",
    "uniform vec3 _Rotation;",
    "uniform int _UseAlphaAsAlphaBlendMask;",
    "uniform int _UseReflectionAlpha;",
  ]);
  out = replaceMembers(out, "_34", fragmentMembers);
  out = adaptThreeWorldVectorsToUnityDataAxes(out, {
    bindings: FRAGMENT_BASIS_CONVERSIONS.worldVectors,
  });
  out = adaptThreeViewForwardToUnityDataAxes(out, FRAGMENT_BASIS_CONVERSIONS.viewForwards[0]);
  assert.match(out, /discard;/);
  assert.match(out, /_680\s*=\s*vec4\(0\.0\);/);
  if (/_34\._m/.test(out)) throw new Error("fragment adaptation incomplete");
  return `${out.trimEnd()}\n`;
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
    "--prefix", "card_hologram_tuning",
    "--metadata", metadataFile,
  ]);
  const metadata = JSON.parse(fs.readFileSync(metadataFile, "utf8"));
  const vertexSpv = path.join(tmp, "card_hologram_tuning_vert.spv");
  const fragmentSpv = path.join(tmp, "card_hologram_tuning_frag.spv");
  const officialSpirvPrecision = buildOfficialSpirvPrecisionEvidence({
    vertex: fs.readFileSync(vertexSpv),
    fragment: fs.readFileSync(fragmentSpv),
  });
  const vertexReflection = JSON.parse(run(SPIRV_CROSS, [vertexSpv, "--reflect"]));
  const fragmentReflection = JSON.parse(run(SPIRV_CROSS, [fragmentSpv, "--reflect"]));
  assertReflection(vertexReflection, {
    ubo: {
      name: "_20_22",
      size: 200,
      members: [
        { name: "_m0", type: "vec4", offset: 0 },
        { name: "_m1", type: "vec4", offset: 64 },
        { name: "_m2", type: "vec4", offset: 128 },
        { name: "_m3", type: "int", offset: 192 },
        { name: "_m4", type: "int", offset: 196 },
      ],
    },
    inputs: [
      { name: "_11", type: "vec4", location: 0 },
      { name: "_116", type: "vec3", location: 1 },
      { name: "_99", type: "vec2", location: 2 },
      { name: "_103", type: "vec2", location: 3 },
    ],
    outputs: [
      { name: "vs_TEXCOORD0", type: "vec2", location: 0 },
      { name: "vs_TEXCOORD1", type: "vec2", location: 1 },
      { name: "vs_TEXCOORD2", type: "vec3", location: 2 },
    ],
    textures: [],
  });
  assertReflection(fragmentReflection, {
    ubo: {
      name: "_32_34",
      size: 148,
      members: [
        { name: "_m0", type: "vec4", offset: 0 },
        ...Array.from({ length: 15 }, (_, index) => ({
          name: `_m${index + 1}`,
          type: "float",
          offset: 64 + index * 4,
        })),
        { name: "_m16", type: "vec3", offset: 128 },
        { name: "_m17", type: "int", offset: 140 },
        { name: "_m18", type: "int", offset: 144 },
      ],
    },
    inputs: [
      { name: "vs_TEXCOORD0", type: "vec2", location: 0 },
      { name: "vs_TEXCOORD1", type: "vec2", location: 1 },
      { name: "vs_TEXCOORD2", type: "vec3", location: 2 },
    ],
    outputs: [
      { name: "_678", type: "vec4", location: 0 },
      { name: "_680", type: "vec4", location: 1 },
    ],
    textures: [
      { name: "_13", type: "sampler2D", binding: 0 },
      { name: "_488", type: "sampler2D", binding: 1 },
      { name: "_386", type: "sampler2D", binding: 2 },
      { name: "_458", type: "sampler2D", binding: 3 },
      { name: "_595", type: "sampler2D", binding: 4 },
    ],
  });
  assert.equal(metadata.artifacts.parameterEntry.byteSize, 100);
  assert.equal(metadata.parameterReflection.bindingClosure.constantBuffersMatch, true);

  const officialVertex = run(SPIRV_CROSS, [vertexSpv, "--version", "300", "--es"]);
  const officialFragment = run(SPIRV_CROSS, [fragmentSpv, "--version", "300", "--es"]);
  assert.equal(digest(officialVertex), OFFICIAL_CROSS_SHA256.vertex, "official vertex SPIRV-Cross shape changed");
  assert.equal(digest(officialFragment), OFFICIAL_CROSS_SHA256.fragment, "official fragment SPIRV-Cross shape changed");
  const vertex = adaptVertex(officialVertex);
  const fragment = adaptFragment(officialFragment);
  const reflection = { vertex: vertexReflection, fragment: fragmentReflection };
  const commonBindings = compileCommonBindings(metadata.commonBindings);
  const programBindings = compileProgramBindings(
    commonBindings,
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
  const samplerBindings = joinProgramSamplerBindings(programBindings, reflection).map(({ set, ...row }) => {
    assert.equal(set, 0, "Card_Hologram_Tuning sampler must use descriptor set 0");
    return row;
  });
  assert.deepEqual(samplerBindings.map(({ slot, spirvName }) => ({ slot, spirvName })), [
    { slot: "_HologramMaskTex", spirvName: "_13" },
    { slot: "_PhaseTex", spirvName: "_488" },
    { slot: "_RampMaskTex", spirvName: "_386" },
    { slot: "_RampTex", spirvName: "_458" },
    { slot: "_HologramFrontMaskTex", spirvName: "_595" },
  ]);
  const runtimeContract = {
    schema: "pocket-card-render/webgl-runtime-port@1",
    shader_key: "Card_Hologram_Tuning",
    attributes: { position: "vec3", normal: "vec3", uv: "vec2", uv1: "vec2" },
    engine_uniforms: { modelMatrix: "mat4", viewMatrix: "mat4", projectionMatrix: "mat4" },
    material_uniforms: {
      floats: materialFloats,
      ints: materialInts,
      vectors: { _Rotation: "vec3" },
    },
    require_complete_active_bindings: true,
    camera_from_view: false,
    mrt_attachments: 2,
    stencil_normalization: "none",
    stencil_face_mode: "generic",
    backend_basis_conversions: { fragment: FRAGMENT_BASIS_CONVERSIONS },
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
          kind: "uniform-buffer-flattening",
          source: "serialized-common",
          preservation: "names-types-precision",
        },
        {
          kind: "clip-space-y-conversion",
          from: "unity-vulkan",
          to: "webgl",
          operation: "remove-y-inversion",
        },
        { kind: "glsl-version-ownership", owner: "three-raw-shader-material" },
      ],
      substitutions: [
        "position vec4 := vec4(three.position, 1.0)",
        "normal location 1 := three.normal",
        "UV0 location 2 := three.uv",
        "UV1 location 3 := three.uv1",
        "unity_ObjectToWorld := three.modelMatrix",
        "unity_WorldToObject := inverse(three.modelMatrix)",
        "unity_MatrixVP := three.projectionMatrix * three.viewMatrix",
        "remove Unity Vulkan clip-space Y inversion for WebGL clip space",
      ],
    },
    fragment: {
      officialSpirvSha256: fileDigest(fragmentSpv),
      spirvCrossGlslSha256: digest(officialFragment),
      outputSha256: digest(fragment),
      operations: [
        { kind: "engine-uniform-binding", contract: "unity-builtins-to-three-r165" },
        {
          kind: "uniform-buffer-flattening",
          source: "serialized-common",
          preservation: "names-types-precision",
        },
        { kind: "object-basis-conversion", contract: "unity-to-three-basis" },
        { kind: "glsl-version-ownership", owner: "three-raw-shader-material" },
      ],
      substitutions: [
        "replace serialized PGlobals UBO members with same-name Three.js uniforms",
        "convert Three world normal and reconstructed view-forward vectors to Unity data axes",
      ],
    },
    interfaceSha256: canonicalJsonDigest({ vertex: vertexReflection, fragment: fragmentReflection }),
    officialVertexInputs: vertexInputContract,
    runtimeContract,
    officialProgramBindings: manifestProgramBindings,
  });
  const outputs = {
    "card_hologram_tuning.vert.glsl": vertex,
    "card_hologram_tuning.frag.glsl": fragment,
    "card_hologram_tuning_uniforms.json": `${JSON.stringify({
      shader: "Lettuce/Common/CardNew/Face/Card_Hologram_Tuning",
      generated_by: "build/build-exact-card-hologram-tuning.mjs",
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
      official_pass_runtime: compileOfficialPassContract(metadata.passContract, {
        sourceSha256: metadata.identityFields.passStateSha256,
        policy: PASS_POLICY,
      }),
      official_common_bindings: { source_sha256: metadata.identityFields.commonBindingsSha256, ...commonBindings },
      official_program_bindings: manifestProgramBindings,
      official_vertex_inputs: vertexInputContract,
      official_shader_property_defaults: metadata.shaderPropertyDefaults,
      webgl_adaptation: adaptation,
      webgl_sources: {
        vertex: "public/shaders/card_hologram_tuning.vert.glsl",
        fragment: "public/shaders/card_hologram_tuning.frag.glsl",
      },
      runtime_contract: runtimeContract,
      sampler_bindings: samplerBindings,
      samplers: samplerBindings.map((row) => row.spirvName),
      sampler_slots: samplerBindings.map((row) => row.slot),
      compiled_texture_bindings: Object.fromEntries(samplerBindings.map((row) => [row.slot, row.binding])),
      floats: Object.fromEntries(floatNames.map((name) => [name, name])),
      colors: { _Rotation: "_Rotation" },
      mrt: { primary: "_678", secondary: "_680", secondary_value: "zero" },
    }, null, 2)}\n`,
  };
  writeOrCheckOutputs(outputs, { outDir: OUT, check: CHECK });
  console.log(`${CHECK ? "verified" : "generated"} Card_Hologram_Tuning from selector-bound official SPIR-V`);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
