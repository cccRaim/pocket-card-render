// Generate Transparent_Hologram_Tuning from its exact official material selector.
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  canonicalJsonSha256,
  compileCommonBindings,
  compileOfficialPassContract,
  joinSamplerBindings,
  runCommand,
  sha256,
  sha256File,
  withExtractedSelectorProgram,
  writeOrCheckOutputs,
} from "./exact-selector-port-core.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHADER_ROOT = process.env.PCR_SHADERS
  || "D:/DevProjectes/ptcgp-tools-master/masterdata_decoder/.output/decrypted/Common/Shader";
const SPIRV_CROSS = process.env.SPIRV_CROSS || "spirv-cross";
const OUT = path.join(ROOT, "public", "shaders");
const CHECK = process.argv.includes("--check") || process.env.PCR_EXACT_CHECK === "1";
const SELECTOR_ID = "0fe1d8427061f16237a00867b4f4398f62a01d6ac39168111b70332cb1142bf2";
const CANDIDATE_WITNESS_ID = "ac5e02751605b754011910a4bd968dfed8df0cd6100a635a257e47695554d2fd";
const PROOF_GRAPH_SHA256 = "9862f63e11f359ed3b92b0191d21a2b6520de5a37159fd14612bdaf1908396b0";
const PORT_INDEX_SHA256 = "30bc4d0eab1c1ad82147e880c642cbd8fba6d55cbd2227c2aa78f082f14e7e3f";
const OFFICIAL_CROSS_SHA256 = {
  vertex: "941de2db0d2a134f3cd8b8ecd96d460e1a30cee60740b588d0cbe15910b75160",
  fragment: "8701b4b6b870ff3593c9d5643939faf5f332e0b78a239340c79ebf43328f001e",
};
const vertexMembers = ["_ObjectToWorld", "_WorldToObject", "_ViewProjection"];
const fragmentMembers = [
  "cameraPosition", "viewMatrix", "_Shininess", "_BaseColorIntensity", "_SpecularIntensity",
  "_DiffractionIntensity", "_DiffractionPower", "_RampRepeat", "_RampSpeed", "_RampOffset",
  "_RampInterval", "_AlphaBlend", "_EmitMasking", "_Rotation",
];

const PASS_POLICY = {
  rtSeparateBlend: false,
  fixed: {
    zClip: { val: 1, name: null }, conservative: { val: 0, name: null },
    offsetFactor: { val: 0, name: null }, offsetUnits: { val: 0, name: null },
    alphaToMask: { val: 0, name: null }, fogMode: -1, lighting: false,
  },
};

function replaceMembers(source, owner, members) {
  return source.replace(new RegExp(`${owner}\\._m(\\d+)`, "g"), (match, rawIndex) => {
    const value = members[Number(rawIndex)];
    if (value == null) throw new Error(`unmapped ${match}`);
    return value;
  });
}

function assertMatch(source, pattern, message) {
  if (!pattern.test(source)) throw new Error(message);
}

function assertJsonEqual(actual, expected, message) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertReflection(reflection, expected) {
  const ubo = (reflection.ubos || []).find((item) => item.name === expected.ubo.name);
  if (!ubo || ubo.block_size !== expected.ubo.blockSize) throw new Error(`${expected.ubo.name} UBO layout changed`);
  const members = reflection.types?.[ubo.type]?.members || [];
  assertJsonEqual(members.map(({ name, type, offset }) => ({ name, type, offset })), expected.ubo.members, `${expected.ubo.name} members changed`);
  for (const key of ["inputs", "outputs"]) {
    assertJsonEqual(
      (reflection[key] || []).map(({ name, type, location }) => ({ name, type, location })).sort((a, b) => a.location - b.location),
      expected[key],
      `shader ${key} changed`,
    );
  }
  assertJsonEqual(
    (reflection.textures || []).map(({ name, type, binding }) => ({ name, type, binding })).sort((a, b) => a.binding - b.binding),
    expected.textures,
    "shader texture bindings changed",
  );
}

function adaptVertex(source) {
  let out = source.replace(/^#version 300 es\s*/m, "precision highp float;\nprecision highp int;\n\n");
  out = out.replace(/layout\(std140\) uniform _19_21[\s\S]*?}\s*_21;\s*/, [
    "uniform highp mat4 modelMatrix;",
    "uniform highp mat4 viewMatrix;",
    "uniform highp mat4 projectionMatrix;",
    "",
  ].join("\n"));
  out = out
    .replace("layout(location = 0) in vec4 _11;", "in vec3 position;")
    .replace("layout(location = 1) in vec2 _100;", "in vec2 uv;")
    .replace("layout(location = 2) in vec3 _103;", "in vec3 normal;")
    .replace(/void main\(\)\s*\{/, [
      "void main()",
      "{",
      "    vec4 _11 = vec4(position, 1.0);",
      "    vec2 _100 = uv;",
      "    vec3 _103 = normal;",
      "    mat4 _ObjectToWorld = modelMatrix;",
      "    mat4 _WorldToObject = inverse(modelMatrix);",
      "    mat4 _ViewProjection = projectionMatrix * viewMatrix;",
    ].join("\n"));
  out = replaceMembers(out, "_21", vertexMembers);
  out = out.replace(/^\s*gl_Position\.y\s*=\s*-gl_Position\.y;\s*$/m, "");
  assertMatch(out, /_WorldToObject\[0\]\.xyz/, "world-to-object normal binding missing");
  assertMatch(out, /mat4 _ViewProjection = projectionMatrix \* viewMatrix;/, "view-projection binding missing");
  if (/_21\._m|gl_Position\.y\s*=\s*-gl_Position\.y/.test(out)) throw new Error("vertex adaptation incomplete");
  return `${out.trimEnd()}\n`;
}

function adaptFragment(source) {
  let out = source.replace(/^#version 300 es\s*/m, "");
  out = out.replace(/layout\(std140\) uniform _14_16[\s\S]*?}\s*_16;\s*/, [
    "uniform highp vec3 cameraPosition;",
    "uniform highp mat4 viewMatrix;",
    "uniform float _Shininess;",
    "uniform float _BaseColorIntensity;",
    "uniform float _SpecularIntensity;",
    "uniform float _DiffractionIntensity;",
    "uniform float _DiffractionPower;",
    "uniform float _RampRepeat;",
    "uniform float _RampSpeed;",
    "uniform float _RampOffset;",
    "uniform float _RampInterval;",
    "uniform float _AlphaBlend;",
    "uniform float _EmitMasking;",
    "uniform vec3 _Rotation;",
    "",
  ].join("\n"));
  out = replaceMembers(out, "_16", fragmentMembers);
  assertMatch(out, /_623\s*=\s*_562;/, "official MRT1 output missing");
  assertMatch(out, /_562\.w\s*=\s*_274\.w\s*\*\s*_EmitMasking;/, "official emit-mask expression missing");
  if (/_16\._m/.test(out)) throw new Error("fragment adaptation incomplete");
  return `${out.trimEnd()}\n`;
}

await withExtractedSelectorProgram({
  selectorId: SELECTOR_ID,
  candidateWitnessId: CANDIDATE_WITNESS_ID,
  expectedProofGraphSha256: PROOF_GRAPH_SHA256,
  expectedPortIndexSha256: PORT_INDEX_SHA256,
  decryptedRoot: path.resolve(SHADER_ROOT, "..", ".."),
  prefix: "transparent_hologram_tuning",
  rootDir: ROOT,
  spirvCross: SPIRV_CROSS,
}, ({ metadata, files, reflection }) => {
  const vertSpv = files.vertexSpirv;
  const fragSpv = files.fragmentSpirv;
  const vertReflection = reflection.vertex;
  const fragReflection = reflection.fragment;
  assertReflection(vertReflection, {
    ubo: { name: "_19_21", blockSize: 192, members: [
      { name: "_m0", type: "vec4", offset: 0 }, { name: "_m1", type: "vec4", offset: 64 },
      { name: "_m2", type: "vec4", offset: 128 },
    ] },
    inputs: [
      { name: "_11", type: "vec4", location: 0 }, { name: "_100", type: "vec2", location: 1 },
      { name: "_103", type: "vec3", location: 2 },
    ],
    outputs: [
      { name: "vs_TEXCOORD0", type: "vec2", location: 0 }, { name: "vs_TEXCOORD1", type: "vec3", location: 1 },
      { name: "vs_TEXCOORD2", type: "vec3", location: 2 },
    ],
    textures: [],
  });
  assertReflection(fragReflection, {
    ubo: { name: "_14_16", blockSize: 140, members: [
      { name: "_m0", type: "vec3", offset: 0 }, { name: "_m1", type: "vec4", offset: 16 },
      { name: "_m2", type: "float", offset: 80 }, { name: "_m3", type: "float", offset: 84 },
      { name: "_m4", type: "float", offset: 88 }, { name: "_m5", type: "float", offset: 92 },
      { name: "_m6", type: "float", offset: 96 }, { name: "_m7", type: "float", offset: 100 },
      { name: "_m8", type: "float", offset: 104 }, { name: "_m9", type: "float", offset: 108 },
      { name: "_m10", type: "float", offset: 112 }, { name: "_m11", type: "float", offset: 116 },
      { name: "_m12", type: "float", offset: 120 }, { name: "_m13", type: "vec3", offset: 128 },
    ] },
    inputs: [
      { name: "vs_TEXCOORD0", type: "vec2", location: 0 }, { name: "vs_TEXCOORD1", type: "vec3", location: 1 },
      { name: "vs_TEXCOORD2", type: "vec3", location: 2 },
    ],
    outputs: [{ name: "_611", type: "vec4", location: 0 }, { name: "_623", type: "vec4", location: 1 }],
    textures: [
      { name: "_563", type: "sampler2D", binding: 0 }, { name: "_596", type: "sampler2D", binding: 1 },
      { name: "_510", type: "samplerCube", binding: 2 }, { name: "_355", type: "sampler2D", binding: 3 },
      { name: "_278", type: "sampler2D", binding: 4 }, { name: "_332", type: "sampler2D", binding: 5 },
    ],
  });

  const officialVert = runCommand(SPIRV_CROSS, [vertSpv, "--version", "300", "--es"], { cwd: ROOT });
  const officialFrag = runCommand(SPIRV_CROSS, [fragSpv, "--version", "300", "--es"], { cwd: ROOT });
  assert.equal(sha256(officialVert), OFFICIAL_CROSS_SHA256.vertex, "official vertex SPIRV-Cross shape changed");
  assert.equal(sha256(officialFrag), OFFICIAL_CROSS_SHA256.fragment, "official fragment SPIRV-Cross shape changed");
  assert.equal(metadata.artifacts.parameterEntry.byteSize, 100);
  assert.equal(metadata.parameterReflection.bindingClosure.constantBuffersMatch, true);
  const vertex = adaptVertex(officialVert);
  const fragment = adaptFragment(officialFrag);
  const bindings = compileCommonBindings(metadata.commonBindings);
  const samplerBindings = joinSamplerBindings(bindings, fragReflection).map(({ set, ...row }) => {
    assert.equal(set, 0, "WebGL sampler port requires descriptor set 0");
    return row;
  });
  assert.deepEqual(samplerBindings.map(({ slot, spirvName }) => ({ slot, spirvName })), [
    { slot: "_DynamicUITex", spirvName: "_563" },
    { slot: "_HologramMaskTex", spirvName: "_596" },
    { slot: "_CubeMap", spirvName: "_510" },
    { slot: "_PhaseTex", spirvName: "_355" },
    { slot: "_RampMaskTex", spirvName: "_278" },
    { slot: "_RampTex", spirvName: "_332" },
  ]);
  const adaptation = {
    schema: "pocket-card-render/webgl-stage-adaptation@1",
    backend: "Unity Vulkan SPIR-V to Three.js WebGL2",
    vertex: {
      officialSpirvSha256: sha256File(vertSpv), spirvCrossGlslSha256: sha256(officialVert),
      outputSha256: sha256(vertex),
      substitutions: [
        "position vec4 := vec4(three.position, 1.0)", "uv location 1 := three.uv",
        "normal location 2 := three.normal", "unity_ObjectToWorld := three.modelMatrix",
        "unity_WorldToObject := inverse(three.modelMatrix)",
        "unity_MatrixVP := three.projectionMatrix * three.viewMatrix",
        "remove Unity Vulkan clip-space Y inversion for WebGL clip space",
      ],
    },
    fragment: {
      officialSpirvSha256: sha256File(fragSpv), spirvCrossGlslSha256: sha256(officialFrag),
      outputSha256: sha256(fragment),
      substitutions: ["replace serialized PGlobals UBO members with same-name Three.js uniforms"],
    },
    interfaceSha256: canonicalJsonSha256({ vertex: vertReflection, fragment: fragReflection }),
  };
  const outputs = {
    "transparent_hologram_tuning.vert.glsl": vertex,
    "transparent_hologram_tuning.frag.glsl": fragment,
    "transparent_hologram_tuning_uniforms.json": `${JSON.stringify({
      shader: "Lettuce/Common/CardNew/ShadowBox/UI/Transparent_Hologram_Tuning",
      generated_by: "build/build-exact-transparent-hologram-tuning.mjs",
      official_selector: metadata.selector,
      official_spirv_sha256: { vertex: sha256File(vertSpv), fragment: sha256File(fragSpv) },
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
      official_common_bindings: { source_sha256: metadata.identityFields.commonBindingsSha256, ...bindings },
      official_shader_property_defaults: metadata.shaderPropertyDefaults,
      webgl_adaptation: adaptation,
      webgl_sources: {
        vertex: "public/shaders/transparent_hologram_tuning.vert.glsl",
        fragment: "public/shaders/transparent_hologram_tuning.frag.glsl",
      },
      runtime_contract: {
        schema: "pocket-card-render/webgl-runtime-port@1",
        shader_key: "Transparent_Hologram_Tuning",
        attributes: { position: "vec3", uv: "vec2", normal: "vec3" },
        engine_uniforms: {
          modelMatrix: "mat4", viewMatrix: "mat4", projectionMatrix: "mat4", cameraPosition: "vec3",
        },
        material_uniforms: {
          floats: [
            "_Shininess", "_BaseColorIntensity", "_SpecularIntensity", "_DiffractionIntensity",
            "_DiffractionPower", "_RampRepeat", "_RampSpeed", "_RampOffset", "_RampInterval",
            "_AlphaBlend", "_EmitMasking",
          ],
          ints: [],
          vectors: { _Rotation: "vec3" },
        },
        camera_from_view: true,
        mrt_attachments: 2,
        stencil_normalization: "disable-when-always-keep",
        stencil_face_mode: "generic",
      },
      sampler_bindings: samplerBindings,
      samplers: samplerBindings.map((row) => row.spirvName),
      sampler_slots: samplerBindings.map((row) => row.slot),
      compiled_texture_bindings: Object.fromEntries(samplerBindings.map((row) => [row.slot, row.binding])),
      floats: Object.fromEntries([
        "_Shininess", "_BaseColorIntensity", "_SpecularIntensity", "_DiffractionIntensity", "_DiffractionPower",
        "_RampRepeat", "_RampSpeed", "_RampOffset", "_RampInterval", "_AlphaBlend", "_EmitMasking",
      ].map((name) => [name, name])),
      colors: { _Rotation: "_Rotation" },
      mrt: { primary: "_611", mask: "_623", mask_channel: "alpha", mask_switch: "_EmitMasking" },
    }, null, 2)}\n`,
  };
  writeOrCheckOutputs(outputs, { outDir: OUT, check: CHECK });
  console.log(`${CHECK ? "verified" : "generated"} Transparent_Hologram_Tuning from selector-bound official SPIR-V (${sha256File(vertSpv).slice(0, 12)} / ${sha256File(fragSpv).slice(0, 12)})`);
});
