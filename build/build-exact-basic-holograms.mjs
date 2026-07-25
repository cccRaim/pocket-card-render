// Generate Card_Parallax_Hologram_Tuning from one selector-bound official executable.
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

const PROGRAM = {
  shader: "Card_Parallax_Hologram_Tuning",
  stem: "card_parallax_hologram_tuning",
  selector: {
    selectorId: "2c378a737b197b514a16e029e5ee7ea8d327e86912b305495b49e3b52523f7d8",
    candidateWitnessId: "b54f79946809a035762c9175061af64d2b48572b4a7143332d3d673339f75a9b",
    proofGraphSha256: "9862f63e11f359ed3b92b0191d21a2b6520de5a37159fd14612bdaf1908396b0",
    portIndexSha256: "30bc4d0eab1c1ad82147e880c642cbd8fba6d55cbd2227c2aa78f082f14e7e3f",
    spirvCrossSha256: {
      vertex: "14125d71fc0599c80e23279c8dd3a38ef9419e7f0e60f2beed8b8ac256d6032f",
      fragment: "ad5cc1328e9f058f735c45f5b8efe8e23bb674122852205f82a80019fd6c5ffa",
    },
  },
  samplerSlots: ["_PhaseTex", "_RampMaskTex", "_RampTex", "_HologramMaskTex"],
  floats: [
    "_FakeCameraHeight", "_Height", "_HeightPower", "_Scale", "_UseUv", "_UseMaskUv",
    "_DiffractionIntensity", "_DiffractionPower", "_RampRepeat", "_RampSpeed", "_RampOffset", "_RampInterval",
  ],
  ints: ["_UseUv", "_UseMaskUv"],
  vectors: ["_Rotation"],
};

function members(types, offsets) {
  return types.map((type, index) => ({ name: `_m${index}`, type, offset: offsets[index] }));
}

function assertEqual(actual, expected, message) {
  assert.equal(JSON.stringify(actual), JSON.stringify(expected), message);
}

function assertReflection(reflection, expected) {
  const ubo = (reflection.ubos || []).find((item) => item.name === expected.ubo.name);
  assert.equal(ubo?.block_size, expected.ubo.size, `${expected.ubo.name} UBO layout changed`);
  assertEqual(
    (reflection.types?.[ubo.type]?.members || []).map(({ name, type, offset }) => ({ name, type, offset })),
    expected.ubo.members,
    `${expected.ubo.name} members changed`,
  );
  for (const key of ["inputs", "outputs"]) {
    assertEqual(
      (reflection[key] || []).map(({ name, type, location }) => ({ name, type, location })).sort((a, b) => a.location - b.location),
      expected[key],
      `${expected.ubo.name} ${key} changed`,
    );
  }
  assertEqual(
    (reflection.textures || []).map(({ name, type, binding }) => ({ name, type, binding })).sort((a, b) => a.binding - b.binding),
    expected.textures || [],
    `${expected.ubo.name} textures changed`,
  );
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

function adaptVertex(source) {
  let out = source.replace(/^#version 300 es\s*/m, "precision highp float;\nprecision highp int;\n\n");
  out = replaceUbo(out, "_21_23", "_23", [
    "uniform highp vec3 cameraPosition;",
    "uniform highp mat4 modelMatrix;",
    "uniform highp mat4 viewMatrix;",
    "uniform highp mat4 projectionMatrix;",
    "uniform mediump float _FakeCameraHeight;", "uniform mediump float _Height;",
    "uniform mediump float _HeightPower;", "uniform mediump float _Scale;",
    "uniform int _UseUv;", "uniform int _UseMaskUv;",
  ]);
  const attributes = {
    "layout(location = 0) in vec4 _11;": "in vec3 position;",
    "layout(location = 1) in vec3 _86;": "in vec3 normal;",
    "layout(location = 4) in mediump vec4 _106;": "in vec4 tangent;",
    "layout(location = 2) in vec2 _306;": "in vec2 uv;",
    "layout(location = 3) in vec2 _310;": "in vec2 uv1;",
  };
  for (const [from, to] of Object.entries(attributes)) out = out.replace(from, to);
  out = out.replace(/void main\(\)\s*\{/, `void main()\n{\n    vec4 _11 = vec4(position, 1.0);\n    vec3 _86 = normal;\n    vec4 _106 = tangent;\n    vec2 _306 = uv;\n    vec2 _310 = uv1;\n    mat4 _ObjectToWorld = modelMatrix;\n    mat4 _WorldToObject = inverse(modelMatrix);\n    mat4 _ViewProjection = projectionMatrix * viewMatrix;`);
  out = replaceMembers(out, "_23", [
    "cameraPosition", "_ObjectToWorld", "_WorldToObject", "_ViewProjection", "_FakeCameraHeight",
    "_Height", "_HeightPower", "_Scale", "_UseUv", "_UseMaskUv",
  ]);
  out = out.replace(/^\s*gl_Position\.y\s*=\s*-gl_Position\.y;\s*$/m, "");
  assert.doesNotMatch(out, /_23\._m|gl_Position\.y\s*=\s*-gl_Position\.y/, "vertex adaptation incomplete");
  return `${out.trimEnd()}\n`;
}

function adaptFragment(source) {
  let out = source.replace(/^#version 300 es\s*/m, "");
  out = replaceUbo(out, "_14_16", "_16", [
    "uniform highp mat4 viewMatrix;",
    "uniform float _DiffractionIntensity;", "uniform float _DiffractionPower;", "uniform float _RampRepeat;",
    "uniform float _RampSpeed;", "uniform float _RampOffset;", "uniform float _RampInterval;",
    "uniform vec3 _Rotation;",
  ]);
  out = replaceMembers(out, "_16", [
    "viewMatrix", "_DiffractionIntensity", "_DiffractionPower", "_RampRepeat", "_RampSpeed",
    "_RampOffset", "_RampInterval", "_Rotation",
  ]);
  assert.doesNotMatch(out, /_16\._m/, "fragment adaptation incomplete");
  assert.match(out, /_409\.w\s*=\s*1\.0;/);
  assert.match(out, /_415\s*=\s*vec4\(0\.0\);/);
  return `${out.trimEnd()}\n`;
}

const vertexReflection = {
  ubo: {
    name: "_21_23", size: 232,
    members: members(
      ["vec3", "vec4", "vec4", "vec4", "float", "float", "float", "float", "int", "int"],
      [0, 16, 80, 144, 208, 212, 216, 220, 224, 228],
    ),
  },
  inputs: [
    { name: "_11", type: "vec4", location: 0 }, { name: "_86", type: "vec3", location: 1 },
    { name: "_306", type: "vec2", location: 2 }, { name: "_310", type: "vec2", location: 3 },
    { name: "_106", type: "vec4", location: 4 },
  ],
  outputs: [
    { name: "vs_TEXCOORD0", type: "vec2", location: 0 }, { name: "vs_TEXCOORD1", type: "vec2", location: 1 },
    { name: "vs_TEXCOORD3", type: "vec3", location: 2 },
  ],
  textures: [],
};

const fragmentReflection = {
  ubo: {
    name: "_14_16", size: 108,
    members: members(["vec4", "float", "float", "float", "float", "float", "float", "vec3"], [0, 64, 68, 72, 76, 80, 84, 96]),
  },
  inputs: [
    { name: "vs_TEXCOORD0", type: "vec2", location: 0 }, { name: "vs_TEXCOORD1", type: "vec2", location: 1 },
    { name: "vs_TEXCOORD3", type: "vec3", location: 2 },
  ],
  outputs: [{ name: "_409", type: "vec4", location: 0 }, { name: "_415", type: "vec4", location: 1 }],
  textures: [
    { name: "_256", type: "sampler2D", binding: 0 }, { name: "_323", type: "sampler2D", binding: 1 },
    { name: "_382", type: "sampler2D", binding: 2 }, { name: "_397", type: "sampler2D", binding: 3 },
  ],
};

const outputs = {};
await withExtractedSelectorProgram({
  selectorId: PROGRAM.selector.selectorId,
  candidateWitnessId: PROGRAM.selector.candidateWitnessId,
  expectedProofGraphSha256: PROGRAM.selector.proofGraphSha256,
  expectedPortIndexSha256: PROGRAM.selector.portIndexSha256,
  decryptedRoot: path.resolve(SHADER_ROOT, "..", ".."),
  prefix: PROGRAM.stem,
  rootDir: ROOT,
  spirvCross: SPIRV_CROSS,
}, ({ metadata, files, reflection }) => {
  assertReflection(reflection.vertex, vertexReflection);
  assertReflection(reflection.fragment, fragmentReflection);
  assert.equal(metadata.artifacts.parameterEntry.byteSize, 100);
  assert.equal(metadata.parameterReflection.bindingClosure.constantBuffersMatch, true);

  const officialVertex = runCommand(SPIRV_CROSS, [files.vertexSpirv, "--version", "300", "--es"], { cwd: ROOT });
  const officialFragment = runCommand(SPIRV_CROSS, [files.fragmentSpirv, "--version", "300", "--es"], { cwd: ROOT });
  assert.equal(sha256(officialVertex), PROGRAM.selector.spirvCrossSha256.vertex, "vertex SPIRV-Cross shape changed");
  assert.equal(sha256(officialFragment), PROGRAM.selector.spirvCrossSha256.fragment, "fragment SPIRV-Cross shape changed");

  const vertex = adaptVertex(officialVertex);
  const fragment = adaptFragment(officialFragment);
  const bindings = compileCommonBindings(metadata.commonBindings);
  const samplerBindings = joinSamplerBindings(bindings, reflection.fragment).map(({ set, ...row }) => {
    assert.equal(set, 0, "WebGL sampler port requires descriptor set 0");
    return row;
  });
  assert.deepEqual(samplerBindings.map(({ slot }) => slot), PROGRAM.samplerSlots);

  const adaptation = {
    schema: "pocket-card-render/webgl-stage-adaptation@1",
    backend: "Unity Vulkan SPIR-V to Three.js WebGL2",
    vertex: {
      officialSpirvSha256: sha256File(files.vertexSpirv), spirvCrossGlslSha256: sha256(officialVertex), outputSha256: sha256(vertex),
      substitutions: [
        "position location 0 := vec4(three.position, 1.0)", "normal location 1 := three.normal",
        "UV0 location 2 := three.uv", "UV1 location 3 := three.uv1", "tangent location 4 := three.tangent",
        "unity_ObjectToWorld := three.modelMatrix", "unity_WorldToObject := inverse(three.modelMatrix)",
        "unity_MatrixVP := three.projectionMatrix * three.viewMatrix",
        "remove Unity Vulkan clip-space Y inversion for WebGL clip space",
      ],
    },
    fragment: {
      officialSpirvSha256: sha256File(files.fragmentSpirv), spirvCrossGlslSha256: sha256(officialFragment), outputSha256: sha256(fragment),
      substitutions: ["replace serialized PGlobals UBO members with same-name Three.js uniforms"],
    },
    interfaceSha256: canonicalJsonSha256(reflection),
  };

  outputs[`${PROGRAM.stem}.vert.glsl`] = vertex;
  outputs[`${PROGRAM.stem}.frag.glsl`] = fragment;
  outputs[`${PROGRAM.stem}_uniforms.json`] = `${JSON.stringify({
    shader: metadata.selector.shaderName,
    generated_by: "build/build-exact-basic-holograms.mjs",
    official_selector: metadata.selector,
    official_spirv_sha256: { vertex: sha256File(files.vertexSpirv), fragment: sha256File(files.fragmentSpirv) },
    official_executable_identity: metadata.identityFields,
    official_parameter_entry: {
      source_sha256: metadata.identityFields.parameterEntrySha256,
      byte_size: metadata.artifacts.parameterEntry.byteSize,
      reflection_sha256: metadata.parameterReflectionSha256,
      ...metadata.parameterReflection,
    },
    official_pass_runtime: compileOfficialPassContract(metadata.passContract, {
      sourceSha256: metadata.identityFields.passStateSha256,
      policy: {
        rtSeparateBlend: false,
        fixed: {
          zClip: { val: 1, name: null }, conservative: { val: 0, name: null },
          offsetFactor: { val: 0, name: null }, offsetUnits: { val: 0, name: null },
          alphaToMask: { val: 0, name: null }, fogMode: -1, lighting: false,
        },
      },
    }),
    official_common_bindings: { source_sha256: metadata.identityFields.commonBindingsSha256, ...bindings },
    official_shader_property_defaults: metadata.shaderPropertyDefaults,
    webgl_adaptation: adaptation,
    webgl_sources: {
      vertex: `public/shaders/${PROGRAM.stem}.vert.glsl`, fragment: `public/shaders/${PROGRAM.stem}.frag.glsl`,
    },
    runtime_contract: {
      schema: "pocket-card-render/webgl-runtime-port@1",
      shader_key: PROGRAM.shader,
      attributes: { position: "vec3", normal: "vec3", uv: "vec2", uv1: "vec2", tangent: "vec4" },
      engine_uniforms: { modelMatrix: "mat4", viewMatrix: "mat4", projectionMatrix: "mat4", cameraPosition: "vec3" },
      material_uniforms: {
        floats: PROGRAM.floats.filter((name) => !PROGRAM.ints.includes(name)),
        ints: PROGRAM.ints,
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
    floats: Object.fromEntries(PROGRAM.floats.map((name) => [name, name])),
    colors: Object.fromEntries(PROGRAM.vectors.map((name) => [name, name])),
    mrt: { primary: "_409", secondary: "_415", secondary_value: "zero" },
  }, null, 2)}\n`;
});

writeOrCheckOutputs(outputs, { outDir: OUT, check: CHECK });
console.log(`${CHECK ? "verified" : "generated"} ${PROGRAM.shader} from selector-bound official SPIR-V`);
