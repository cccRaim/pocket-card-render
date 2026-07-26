// Generate the selector-owned Transparent-UR-New WebGL2 port from official Unity shader bytes.
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  adaptUnityObjectToWorldDataAxes,
  canonicalJsonSha256,
  compileCommonBindings,
  compileOfficialPassContract,
  compileOfficialVertexInputContract,
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
const SELECTOR_ID = "deaf77dab8730160b12bd2896a3aa41513666b24b517adb6a8f5ded95331d249";
const CANDIDATE_WITNESS_ID = "c58307e6086263c9ebb245e2a3f4e0661893df93f7db34837ed8509aa4d02a7d";
const PROOF_GRAPH_SHA256 = "9862f63e11f359ed3b92b0191d21a2b6520de5a37159fd14612bdaf1908396b0";
const PORT_INDEX_SHA256 = "30bc4d0eab1c1ad82147e880c642cbd8fba6d55cbd2227c2aa78f082f14e7e3f";
const PARAMETER_REFLECTION_SHA256 = "2fb5bb167e95fbb9e6ac210ed3b49af7a5f976e1aab28a638ff558b826f92f28";
const OFFICIAL_CROSS_SHA256 = {
  vertex: "279adae80be34c80a8f8a1cb58327d82e2ab00e78fe65c2eebafcd685a64a683",
  fragment: "7ccc7004c3489e0a72fb933187268464930d3a1f15e8b9279c8326d8775b8d7d",
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
  return {
    name: item.name,
    type: item.type,
    offset: item.offset,
    ...(item.array ? { array: item.array } : {}),
  };
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
  out = replaceUbo(out, "_19_21", "_21", [
    "uniform highp mat4 modelMatrix;", "uniform highp mat4 viewMatrix;", "uniform highp mat4 projectionMatrix;",
    "uniform mediump float _FakeSpecularMaskScale;", "uniform mediump float _FakeSpecularIntensity;",
    "uniform mediump float _FakeSpecularPower;", "uniform mediump float _FakeSpecularCornerPower;",
    "uniform mediump float _FakeSpecularNotCornerOffset;",
  ]);
  out = out
    .replace("layout(location = 0) in vec4 _11;", "in vec3 position;")
    .replace("layout(location = 1) in vec2 _916;", "in vec2 uv;")
    .replace("layout(location = 2) in vec3 _90;", "in vec3 normal;")
    .replace(/void main\(\)\s*\{/, `void main()
{
    vec4 _11 = vec4(position, 1.0);
    vec2 _916 = uv;
    vec3 _90 = normal;
    mat4 _ObjectToWorld = modelMatrix;
    mat4 _WorldToObject = inverse(modelMatrix);
    mat4 _ViewProjection = projectionMatrix * viewMatrix;`);
  out = replaceMembers(out, "_21", mapping);
  out = out.replace(/^\s*gl_Position\.y\s*=\s*-gl_Position\.y;\s*$/m, "");
  if (/_21\._m|gl_Position\.y\s*=\s*-gl_Position\.y/.test(out)) throw new Error("vertex adaptation incomplete");
  return `${out.trimEnd()}\n`;
}

function adaptFragment(source, mapping) {
  let out = source.replace(/^#version 300 es\s*/m, "");
  out = replaceUbo(out, "_62_64", "_64", [
    "uniform highp vec3 cameraPosition;", "uniform highp mat4 modelMatrix;", "uniform highp mat4 viewMatrix;",
    "uniform mediump float _Shininess;", "uniform mediump float _BaseColorIntensity;",
    "uniform mediump float _SpecularIntensity;", "uniform mediump float _DiffractionIntensity;",
    "uniform mediump float _DiffractionPower;", "uniform mediump float _RampRepeat;",
    "uniform mediump float _RampSpeed;", "uniform mediump float _RampOffset;",
    "uniform mediump float _RampInterval;", "uniform mediump vec3 _FakeSpecularColor;",
    "uniform mediump vec3 _DarknessColor;", "uniform mediump float _DarknessOffset;",
    "uniform mediump vec3 _Rotation;",
  ]);
  out = replaceMembers(out, "_64", mapping);
  out = adaptUnityObjectToWorldDataAxes(out, {
    matrixName: "modelMatrix", expectedCounts: { 2: 3 },
  });
  if (/_64\._m/.test(out)) throw new Error("fragment adaptation incomplete");
  return `${out.trimEnd()}\n`;
}

const vertexExpected = {
  ubo: { name: "_19_21", size: 212, members: [
    member("_m0", "vec4", 0, [4]), member("_m1", "vec4", 64, [4]), member("_m2", "vec4", 128, [4]),
    ...Array.from({ length: 5 }, (_, index) => member(`_m${index + 3}`, "float", 192 + index * 4)),
  ] },
  inputs: [
    { name: "_11", type: "vec4", location: 0 }, { name: "_916", type: "vec2", location: 1 },
    { name: "_90", type: "vec3", location: 2 },
  ],
  outputs: [
    { name: "vs_TEXCOORD0", type: "vec2", location: 0 }, { name: "vs_TEXCOORD1", type: "vec3", location: 1 },
    { name: "vs_TEXCOORD2", type: "vec3", location: 2 }, { name: "vs_TEXCOORD3", type: "vec4", location: 3 },
  ],
  textures: [],
};

const fragmentExpected = {
  ubo: { name: "_62_64", size: 236, members: [
    member("_m0", "vec3", 0), member("_m1", "vec4", 16, [4]), member("_m2", "vec4", 80, [4]),
    ...Array.from({ length: 9 }, (_, index) => member(`_m${index + 3}`, "float", 144 + index * 4)),
    member("_m12", "vec3", 192), member("_m13", "vec3", 208), member("_m14", "float", 220),
    member("_m15", "vec3", 224),
  ] },
  inputs: [
    { name: "vs_TEXCOORD0", type: "vec2", location: 0 }, { name: "vs_TEXCOORD1", type: "vec3", location: 1 },
    { name: "vs_TEXCOORD2", type: "vec3", location: 2 }, { name: "vs_TEXCOORD3", type: "vec4", location: 3 },
  ],
  outputs: [{ name: "_873", type: "vec4", location: 0 }, { name: "_875", type: "vec4", location: 1 }],
  textures: [
    { name: "_581", type: "sampler2D", binding: 0 }, { name: "_609", type: "sampler2D", binding: 1 },
    { name: "_528", type: "samplerCube", binding: 2 }, { name: "_13", type: "sampler2D", binding: 3 },
    { name: "_361", type: "sampler2D", binding: 4 }, { name: "_379", type: "sampler2D", binding: 5 },
    { name: "_428", type: "sampler2D", binding: 6 }, { name: "_800", type: "sampler2D", binding: 7 },
  ],
};

await withExtractedSelectorProgram({
  selectorId: SELECTOR_ID,
  candidateWitnessId: CANDIDATE_WITNESS_ID,
  expectedProofGraphSha256: PROOF_GRAPH_SHA256,
  expectedPortIndexSha256: PORT_INDEX_SHA256,
  decryptedRoot: path.resolve(SHADER_ROOT, "..", ".."),
  prefix: "transparent_ur_new",
  rootDir: ROOT,
  spirvCross: SPIRV_CROSS,
}, ({ metadata, files, reflection }) => {
  assertEqual(metadata.selector.keywords, [], "selector keyword set changed");
  if (metadata.parameterReflectionSha256 !== PARAMETER_REFLECTION_SHA256) {
    throw new Error("official parameter reflection changed");
  }
  if (metadata.artifacts.parameterEntry.byteSize !== 100) throw new Error("official parameter entry byte size changed");

  const vertInfo = assertReflection(reflection.vertex, vertexExpected);
  const fragInfo = assertReflection(reflection.fragment, fragmentExpected);
  const commonBindings = compileCommonBindings(metadata.commonBindings);
  const programBindings = joinProgramConstantBufferStages(
    compileProgramBindings(commonBindings, metadata.parameterReflection, metadata.shaderPropertyDefaults),
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
    { slot: "_DynamicUITex", spirvName: "_581", binding: 0 },
    { slot: "_HologramMaskTex", spirvName: "_609", binding: 1 },
    { slot: "_CubeMap", spirvName: "_528", binding: 2 },
    { slot: "_PhaseTex", spirvName: "_13", binding: 3 },
    { slot: "_PhaseMaskTex", spirvName: "_361", binding: 4 },
    { slot: "_RampMaskTex", spirvName: "_379", binding: 5 },
    { slot: "_RampTex", spirvName: "_428", binding: 6 },
    { slot: "_FakeSpecularMask", spirvName: "_800", binding: 7 },
  ], "compiled sampler binding map changed");

  const officialVert = runCommand(SPIRV_CROSS, [files.vertexSpirv, "--version", "300", "--es"], { cwd: ROOT });
  const officialFrag = runCommand(SPIRV_CROSS, [files.fragmentSpirv, "--version", "300", "--es"], { cwd: ROOT });
  if (sha256(officialVert) !== OFFICIAL_CROSS_SHA256.vertex || sha256(officialFrag) !== OFFICIAL_CROSS_SHA256.fragment) {
    throw new Error("complete official SPIRV-Cross output changed");
  }
  const vertex = adaptVertex(officialVert, vertexMapping);
  const fragment = adaptFragment(officialFrag, fragmentMapping);
  const materialFloats = [
    "_FakeSpecularMaskScale", "_FakeSpecularIntensity", "_FakeSpecularPower", "_FakeSpecularCornerPower",
    "_FakeSpecularNotCornerOffset", "_Shininess", "_BaseColorIntensity", "_SpecularIntensity",
    "_DiffractionIntensity", "_DiffractionPower", "_RampRepeat", "_RampSpeed", "_RampOffset",
    "_RampInterval", "_DarknessOffset",
  ];
  const runtimeContract = {
    schema: "pocket-card-render/webgl-runtime-port@1",
    shader_key: "Transparent-UR-New",
    attributes: { position: "vec3", uv: "vec2", normal: "vec3" },
    engine_uniforms: {
      modelMatrix: "mat4", viewMatrix: "mat4", projectionMatrix: "mat4", cameraPosition: "vec3",
    },
    material_uniforms: {
      floats: materialFloats,
      ints: [],
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
      substitutions: [
        "replace serialized-common VGlobals UBO members with same-name Three.js uniforms",
        "position vec4 := vec4(three.position, 1.0), uv := three.uv and normal := three.normal",
        "unity_ObjectToWorld := three.modelMatrix and unity_WorldToObject := inverse(three.modelMatrix)",
        "unity_MatrixVP := three.projectionMatrix * three.viewMatrix",
        "remove Unity Vulkan clip-space Y inversion for WebGL clip space",
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
      substitutions: [
        "replace serialized-common PGlobals UBO members with same-name Three.js uniforms",
        "recover Unity ObjectToWorld Z-axis data through M_unity = C * M_three * A before tilt-angle arithmetic",
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
    "transparent_ur_new.vert.glsl": vertex,
    "transparent_ur_new.frag.glsl": fragment,
    "transparent_ur_new_uniforms.json": `${JSON.stringify({
      shader: "Transparent-UR-New",
      generated_by: "build/build-exact-transparent-ur-new.mjs",
      selected_keywords: [],
      official_selector: metadata.selector,
      official_spirv_sha256: {
        vertex: sha256File(files.vertexSpirv), fragment: sha256File(files.fragmentSpirv),
      },
      official_spirv_precision: metadata.officialSpirvPrecision,
      official_executable_identity: metadata.identityFields,
      official_parameter_entry: {
        source_sha256: metadata.identityFields.parameterEntrySha256,
        byte_size: metadata.artifacts.parameterEntry.byteSize,
        reflection_sha256: metadata.parameterReflectionSha256,
        ...metadata.parameterReflection,
      },
      official_pass_runtime: passRuntime,
      official_common_bindings: {
        source_sha256: metadata.identityFields.commonBindingsSha256,
        ...commonBindings,
      },
      official_program_bindings: manifestProgramBindings,
      official_vertex_inputs: vertexInputContract,
      official_shader_property_defaults: metadata.shaderPropertyDefaults,
      webgl_adaptation: adaptation,
      webgl_sources: {
        vertex: "public/shaders/transparent_ur_new.vert.glsl",
        fragment: "public/shaders/transparent_ur_new.frag.glsl",
      },
      runtime_contract: runtimeContract,
      sampler_bindings: samplerBindings,
      samplers: samplerBindings.map((row) => row.spirvName),
      sampler_slots: samplerBindings.map((row) => row.slot),
      compiled_texture_bindings: Object.fromEntries(samplerBindings.map((row) => [row.slot, row.binding])),
      vertex_fields: Object.fromEntries(bufferFields(vglobals).map(({ name, offset }) => [name, offset])),
      fragment_fields: Object.fromEntries(bufferFields(pglobals).map(({ name, offset }) => [name, offset])),
      implicit_defaults: { ...metadata.shaderPropertyDefaults.textures, _CubeMap: "gray" },
      mrt: { primary: "_873", secondary: "_875", secondary_value: "zero" },
    }, null, 2)}\n`,
  };
  writeOrCheckOutputs(outputs, { outDir: OUT, check: CHECK });
  console.log(`${CHECK ? "verified" : "generated"} selector-owned Transparent-UR-New WebGL2 port`);
});
