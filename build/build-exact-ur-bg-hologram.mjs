// Generate the selector-owned Card_Parallax_Hologram_UR_New WebGL2 port from official Unity shader bytes.
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  adaptUnityObjectToWorldDataAxes,
  canonicalJsonSha256,
  compileCommonBindings,
  compileOfficialVertexInputContract,
  compileOfficialPassContract,
  compileProgramBindings,
  joinProgramConstantBufferStages,
  joinProgramSamplerBindings,
  runCommand,
  sha256,
  sha256File,
  withExtractedSelectorProgram,
  writeOrCheckOutputs,
} from "./exact-selector-port-core.mjs";
import { buildWebglAdaptationV2 } from "./webgl-adaptation-contract.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHADER_ROOT = process.env.PCR_SHADERS
  || "D:/DevProjectes/ptcgp-tools-master/masterdata_decoder/.output/decrypted/Common/Shader";
const SPIRV_CROSS = process.env.SPIRV_CROSS || "spirv-cross";
const OUT = path.join(ROOT, "public", "shaders");
const CHECK = process.argv.includes("--check") || process.env.PCR_EXACT_CHECK === "1";
const SELECTOR_ID = "66a7cb5f20f3617a45802722879bae65f2a18e2824167bb4e0a124a8d240bd9e";
const CANDIDATE_WITNESS_ID = "619c77a741662746ac7867f6fffd193c6ff17d3b48d5a01d97bd3f030f2690b3";
const PROOF_GRAPH_SHA256 = "9862f63e11f359ed3b92b0191d21a2b6520de5a37159fd14612bdaf1908396b0";
const PORT_INDEX_SHA256 = "30bc4d0eab1c1ad82147e880c642cbd8fba6d55cbd2227c2aa78f082f14e7e3f";
const PARAMETER_REFLECTION_SHA256 = "fc98f7c23566f047fc7116b72b14cc843134e6d20f69f25041c244b455b98d7f";
const OFFICIAL_CROSS_SHA256 = {
  vertex: "1a0f0b111dfa1f840fc72bc341066c498c8f0b3d355c1b8faaa31c74811d581e",
  fragment: "b39109d3e6688a03b313b784f6f1a02023d4f9aaa24170ab5c593fce52386ef8",
};
const PASS_POLICY = {
  rtSeparateBlend: false,
  fixed: {
    zClip: { val: 1, name: null }, conservative: { val: 0, name: null },
    offsetFactor: { val: 0, name: null }, offsetUnits: { val: 0, name: null },
    alphaToMask: { val: 0, name: null }, fogMode: -1, lighting: false,
  },
};
const FRAGMENT_BASIS_CONVERSIONS = Object.freeze({
  objectMatrices: [{
    matrixName: "modelMatrix",
    columns: [{ column: 2, expectedOccurrences: 3 }],
  }],
  worldVectors: [],
  viewForwards: [],
});

function assertEqual(actual, expected, message) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function member(name, type, offset, array = undefined) {
  return { name, type, offset, ...(array ? { array } : {}) };
}

function reflectedMember(item) {
  return { name: item.name, type: item.type, offset: item.offset, ...(item.array ? { array: item.array } : {}) };
}

function assertReflection(reflection, expected) {
  const ubo = (reflection.ubos || []).find((item) => item.name === expected.ubo.name);
  if (!ubo || ubo.block_size !== expected.ubo.size) throw new Error(`${expected.ubo.name} UBO changed`);
  assertEqual(
    (reflection.types?.[ubo.type]?.members || []).map(reflectedMember),
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
  return { ubo, members: reflection.types[ubo.type].members };
}

function replaceUbo(source, block, owner, declarations) {
  const re = new RegExp(`layout\\(std140\\) uniform ${block}[\\s\\S]*?}\\s*${owner};\\s*`);
  const result = source.replace(re, `${declarations.join("\n")}\n\n`);
  if (result === source) throw new Error(`${block} replacement failed`);
  return result;
}

function replaceMembers(source, owner, mapping) {
  return source.replace(new RegExp(`${owner}\\._m(\\d+)`, "g"), (match, raw) => {
    const value = mapping[Number(raw)];
    if (value == null) throw new Error(`unmapped ${match}`);
    return value;
  });
}

function bufferFields(buffer) {
  return [...(buffer.matrices || []), ...(buffer.vectors || [])].sort((a, b) => a.offset - b.offset);
}

function bufferByPrefix(bindings, prefix) {
  const result = bindings.constant_buffers.find((item) => item.name.startsWith(prefix));
  if (!result) throw new Error(`${prefix} common binding is missing`);
  return result;
}

const ENGINE_NAMES = {
  unity_ObjectToWorld: "_ObjectToWorld",
  unity_WorldToObject: "_WorldToObject",
  unity_MatrixVP: "_ViewProjection",
  unity_MatrixV: "viewMatrix",
  _WorldSpaceCameraPos: "cameraPosition",
};

function bindingMap(buffer, reflectedMembers, overrides = {}) {
  const fields = bufferFields(buffer);
  const byOffset = new Map(fields.map((item) => [item.offset, item.name]));
  if (byOffset.size !== reflectedMembers.length) throw new Error(`${buffer.name} field count changed`);
  return reflectedMembers.map((item) => {
    const official = byOffset.get(item.offset);
    if (!official) throw new Error(`${buffer.name}: no official field at offset ${item.offset}`);
    return overrides[official] || ENGINE_NAMES[official] || official;
  });
}

function assertBufferOffsets(buffer, reflectedMembers) {
  const offsets = bufferFields(buffer).map(({ name, offset }) => ({ name, offset }));
  assertEqual(
    offsets,
    reflectedMembers.map((item) => ({ name: offsets.find((field) => field.offset === item.offset)?.name, offset: item.offset })),
    `${buffer.name} offsets disagree with SPIR-V`,
  );
}

function adaptVertex(source, mapping) {
  let out = source.replace(/^#version 300 es\s*/m, "precision highp float;\nprecision highp int;\n\n");
  out = replaceUbo(out, "_21_23", "_23", [
    "uniform highp vec3 cameraPosition;", "uniform highp mat4 modelMatrix;",
    "uniform highp mat4 viewMatrix;", "uniform highp mat4 projectionMatrix;",
    "uniform mediump float _FakeCameraHeight;", "uniform mediump float _Height;",
    "uniform mediump float _HeightPower;", "uniform mediump float _Scale;",
    "uniform int _UseUv2;", "uniform mediump float _FakeSpecularMaskScale;",
    "uniform mediump float _FakeSpecularIntensity;", "uniform mediump float _FakeSpecularPower;",
    "uniform mediump float _FakeSpecularCornerPower;", "uniform mediump float _FakeSpecularNotCornerOffset;",
  ]);
  out = out
    .replace("layout(location = 0) in vec4 _11;", "in vec3 position;")
    .replace("layout(location = 1) in vec3 _78;", "in vec3 normal;")
    .replace("layout(location = 4) in mediump vec4 _133;", "in vec4 tangent;")
    .replace("layout(location = 2) in vec2 _320;", "in vec2 uv;")
    .replace("layout(location = 3) in vec2 _356;", "in vec2 uv1;")
    .replace(/void main\(\)\s*\{/, `void main()
{
    vec4 _11 = vec4(position, 1.0);
    vec3 _78 = normal;
    vec4 _133 = tangent;
    vec2 _320 = uv;
    vec2 _356 = uv1;
    mat4 _ObjectToWorld = modelMatrix;
    mat4 _WorldToObject = inverse(modelMatrix);
    mat4 _ViewProjection = projectionMatrix * viewMatrix;`);
  out = replaceMembers(out, "_23", mapping);
  out = out.replace(/^\s*gl_Position\.y\s*=\s*-gl_Position\.y;\s*$/m, "");
  if (/_23\._m|gl_Position\.y\s*=\s*-gl_Position\.y/.test(out)) throw new Error("vertex adaptation incomplete");
  return `${out.trimEnd()}\n`;
}

function adaptFragment(source, mapping) {
  let out = source.replace(/^#version 300 es\s*/m, "");
  out = replaceUbo(out, "_15_17", "_17", [
    "uniform highp mat4 modelMatrix;", "uniform highp mat4 viewMatrix;",
    "uniform mediump float _DiffractionIntensity;", "uniform mediump float _DiffractionPower;",
    "uniform mediump float _RampRepeat;", "uniform mediump float _RampSpeed;",
    "uniform mediump float _RampOffset;", "uniform mediump float _RampInterval;",
    "uniform mediump vec3 _FakeSpecularColor;", "uniform mediump vec3 _DarknessColor;",
    "uniform mediump float _DarknessOffset;", "uniform mediump vec3 _Rotation;",
  ]);
  out = replaceMembers(out, "_17", mapping);
  out = adaptUnityObjectToWorldDataAxes(out, {
    matrixName: "modelMatrix", expectedCounts: { 2: 3 },
  });
  if (/_17\._m/.test(out)) throw new Error("fragment adaptation incomplete");
  return `${out.trimEnd()}\n`;
}

const vertexExpected = {
  ubo: { name: "_21_23", size: 248, members: [
    member("_m0", "vec3", 0), member("_m1", "vec4", 16, [4]), member("_m2", "vec4", 80, [4]),
    member("_m3", "vec4", 144, [4]), ...Array.from({ length: 4 }, (_, i) => member(`_m${i + 4}`, "float", 208 + i * 4)),
    member("_m8", "int", 224), ...Array.from({ length: 5 }, (_, i) => member(`_m${i + 9}`, "float", 228 + i * 4)),
  ] },
  inputs: [
    { name: "_11", type: "vec4", location: 0 }, { name: "_78", type: "vec3", location: 1 },
    { name: "_320", type: "vec2", location: 2 }, { name: "_356", type: "vec2", location: 3 },
    { name: "_133", type: "vec4", location: 4 },
  ],
  outputs: [
    { name: "vs_TEXCOORD0", type: "vec2", location: 0 }, { name: "vs_TEXCOORD1", type: "vec2", location: 1 },
    { name: "vs_TEXCOORD3", type: "vec3", location: 2 }, { name: "vs_TEXCOORD4", type: "vec4", location: 3 },
  ],
  textures: [],
};

const fragmentExpected = {
  ubo: { name: "_15_17", size: 204, members: [
    member("_m0", "vec4", 0, [4]), member("_m1", "vec4", 64, [4]),
    ...Array.from({ length: 6 }, (_, i) => member(`_m${i + 2}`, "float", 128 + i * 4)),
    member("_m8", "vec3", 160), member("_m9", "vec3", 176), member("_m10", "float", 188), member("_m11", "vec3", 192),
  ] },
  inputs: [
    { name: "vs_TEXCOORD0", type: "vec2", location: 0 }, { name: "vs_TEXCOORD1", type: "vec2", location: 1 },
    { name: "vs_TEXCOORD3", type: "vec3", location: 2 }, { name: "vs_TEXCOORD4", type: "vec4", location: 3 },
  ],
  outputs: [{ name: "_695", type: "vec4", location: 0 }, { name: "_701", type: "vec4", location: 1 }],
  textures: ["_257", "_321", "_335", "_396", "_411", "_614"].map((name, binding) => ({ name, type: "sampler2D", binding })),
};

await withExtractedSelectorProgram({
  selectorId: SELECTOR_ID,
  candidateWitnessId: CANDIDATE_WITNESS_ID,
  expectedProofGraphSha256: PROOF_GRAPH_SHA256,
  expectedPortIndexSha256: PORT_INDEX_SHA256,
  decryptedRoot: path.resolve(SHADER_ROOT, "..", ".."),
  prefix: "ur_bg_hologram",
  rootDir: ROOT,
  spirvCross: SPIRV_CROSS,
}, ({ metadata, files, reflection }) => {
  assertEqual(metadata.selector.keywords, [], "selector keyword set changed");
  if (metadata.parameterReflectionSha256 !== PARAMETER_REFLECTION_SHA256) throw new Error("official parameter reflection changed");
  if (metadata.artifacts.parameterEntry.byteSize !== 100) throw new Error("official parameter entry byte size changed");

  const vertInfo = assertReflection(reflection.vertex, vertexExpected);
  const fragInfo = assertReflection(reflection.fragment, fragmentExpected);
  const commonBindings = compileCommonBindings(metadata.commonBindings);
  const programBindings = joinProgramConstantBufferStages(
    compileProgramBindings(
      commonBindings,
      metadata.parameterReflection,
      metadata.shaderPropertyDefaults,
    ),
    reflection,
  );
  const manifestProgramBindings = {
    common_source_sha256: metadata.identityFields.commonBindingsSha256,
    parameter_reflection_sha256: metadata.parameterReflectionSha256,
    ...programBindings,
  };
  const vertexInputContract = compileOfficialVertexInputContract(
    metadata.programBindChannels,
    reflection.vertex,
  );
  const vglobals = bufferByPrefix(commonBindings, "VGlobals");
  const pglobals = bufferByPrefix(commonBindings, "PGlobals");
  if (vglobals.size !== vertInfo.ubo.block_size || pglobals.size !== fragInfo.ubo.block_size) {
    throw new Error("common bindings and SPIR-V UBO sizes disagree");
  }
  assertBufferOffsets(vglobals, vertInfo.members);
  assertBufferOffsets(pglobals, fragInfo.members);
  const vertexMapping = bindingMap(vglobals, vertInfo.members);
  const fragmentMapping = bindingMap(pglobals, fragInfo.members, { unity_ObjectToWorld: "modelMatrix" });

  const samplerBindings = joinProgramSamplerBindings(programBindings, reflection).map(({ set, ...row }) => {
    if (set !== 0) throw new Error("WebGL sampler port requires descriptor set 0");
    return row;
  });
  assertEqual(samplerBindings.map(({ slot, spirvName, binding }) => ({ slot, spirvName, binding })), [
    { slot: "_PhaseTex", spirvName: "_257", binding: 0 },
    { slot: "_PhaseMaskTex", spirvName: "_321", binding: 1 },
    { slot: "_RampMaskTex", spirvName: "_335", binding: 2 },
    { slot: "_RampTex", spirvName: "_396", binding: 3 },
    { slot: "_HologramMaskTex", spirvName: "_411", binding: 4 },
    { slot: "_FakeSpecularMask", spirvName: "_614", binding: 5 },
  ], "compiled sampler binding map changed");

  const officialVert = runCommand(SPIRV_CROSS, [files.vertexSpirv, "--version", "300", "--es"], { cwd: ROOT });
  const officialFrag = runCommand(SPIRV_CROSS, [files.fragmentSpirv, "--version", "300", "--es"], { cwd: ROOT });
  if (sha256(officialVert) !== OFFICIAL_CROSS_SHA256.vertex || sha256(officialFrag) !== OFFICIAL_CROSS_SHA256.fragment) {
    throw new Error("complete official SPIRV-Cross output changed");
  }
  const vertex = adaptVertex(officialVert, vertexMapping);
  const fragment = adaptFragment(officialFrag, fragmentMapping);
  const materialFloats = [
    "_FakeCameraHeight", "_Height", "_HeightPower", "_Scale",
    "_FakeSpecularMaskScale", "_FakeSpecularIntensity", "_FakeSpecularPower",
    "_FakeSpecularCornerPower", "_FakeSpecularNotCornerOffset", "_DiffractionIntensity",
    "_DiffractionPower", "_RampRepeat", "_RampSpeed", "_RampOffset", "_RampInterval", "_DarknessOffset",
  ];
  const runtimeContract = {
    schema: "pocket-card-render/webgl-runtime-port@1",
    shader_key: "Card_Parallax_Hologram_UR_New",
    attributes: { position: "vec3", normal: "vec3", tangent: "vec4", uv: "vec2", uv1: "vec2" },
    engine_uniforms: {
      modelMatrix: "mat4", viewMatrix: "mat4", projectionMatrix: "mat4", cameraPosition: "vec3",
    },
    material_uniforms: {
      floats: materialFloats,
      ints: ["_UseUv2"],
      vectors: { _FakeSpecularColor: "vec3", _DarknessColor: "vec3", _Rotation: "vec3" },
    },
    backend_uniforms: {},
    require_complete_active_bindings: true,
    camera_from_view: true,
    mrt_attachments: 2,
    stencil_normalization: "disable-when-always-keep",
    stencil_face_mode: "generic",
    backend_basis_conversions: { fragment: FRAGMENT_BASIS_CONVERSIONS },
  };
  const adaptation = buildWebglAdaptationV2({
    vertex: {
      officialSpirvSha256: sha256File(files.vertexSpirv),
      spirvCrossGlslSha256: sha256(officialVert),
      outputSha256: sha256(vertex),
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
    },
    fragment: {
      officialSpirvSha256: sha256File(files.fragmentSpirv),
      spirvCrossGlslSha256: sha256(officialFrag),
      outputSha256: sha256(fragment),
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
    },
    interfaceSha256: canonicalJsonSha256({ vertex: reflection.vertex, fragment: reflection.fragment }),
    officialVertexInputs: vertexInputContract,
    runtimeContract,
    officialProgramBindings: manifestProgramBindings,
  });
  const passRuntime = {
    ...compileOfficialPassContract(metadata.passContract, {
      sourceSha256: metadata.identityFields.passStateSha256,
      policy: PASS_POLICY,
    }),
    shader_property_defaults: metadata.shaderPropertyDefaults.floats,
  };
  const outputs = {
    "ur_bg_hologram.vert.glsl": vertex,
    "ur_bg_hologram.frag.glsl": fragment,
    "ur_bg_hologram_uniforms.json": `${JSON.stringify({
      shader: "Card_Parallax_Hologram_UR_New",
      generated_by: "build/build-exact-ur-bg-hologram.mjs",
      selected_keywords: [],
      official_selector: metadata.selector,
      official_spirv_sha256: { vertex: sha256File(files.vertexSpirv), fragment: sha256File(files.fragmentSpirv) },
      official_spirv_precision: metadata.officialSpirvPrecision,
      official_executable_identity: metadata.identityFields,
      official_parameter_entry: {
        source_sha256: metadata.identityFields.parameterEntrySha256,
        byte_size: metadata.artifacts.parameterEntry.byteSize,
        reflection_sha256: metadata.parameterReflectionSha256,
        ...metadata.parameterReflection,
      },
      official_pass_runtime: passRuntime,
      official_common_bindings: { source_sha256: metadata.identityFields.commonBindingsSha256, ...commonBindings },
      official_program_bindings: manifestProgramBindings,
      official_vertex_inputs: vertexInputContract,
      official_shader_property_defaults: metadata.shaderPropertyDefaults,
      webgl_adaptation: adaptation,
      webgl_sources: {
        vertex: "public/shaders/ur_bg_hologram.vert.glsl",
        fragment: "public/shaders/ur_bg_hologram.frag.glsl",
      },
      runtime_contract: runtimeContract,
      sampler_bindings: samplerBindings,
      samplers: samplerBindings.map((row) => row.spirvName),
      sampler_slots: samplerBindings.map((row) => row.slot),
      compiled_texture_bindings: Object.fromEntries(samplerBindings.map((row) => [row.slot, row.binding])),
      vertex_fields: Object.fromEntries(bufferFields(vglobals).map(({ name, offset }) => [name, offset])),
      fragment_fields: Object.fromEntries(bufferFields(pglobals).map(({ name, offset }) => [name, offset])),
      implicit_defaults: metadata.shaderPropertyDefaults.textures,
      mrt: { primary: "_695", secondary: "_701", secondary_value: "zero" },
    }, null, 2)}\n`,
  };
  writeOrCheckOutputs(outputs, { outDir: OUT, check: CHECK });
  console.log(`${CHECK ? "verified" : "generated"} selector-owned Card_Parallax_Hologram_UR_New WebGL2 port`);
});
