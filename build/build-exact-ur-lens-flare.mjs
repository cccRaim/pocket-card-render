// Generate Card_UR_LensFlare from its exact official material selector.
import assert from "node:assert/strict";
import fs from "node:fs";
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
const SELECTOR_ID = "ad61a11641dec609c1db5167c36442a541cda00a632bfd13f96986e41064ef62";
const CANDIDATE_WITNESS_ID = "91e3b24bc22236ed08620090ac7e4743a03d4eb0af3791a00078356329013b0d";
const PROOF_GRAPH_SHA256 = "307ed3660e5d3b1bfd8cf9e6b3d64e44937af215da3b6ed84ead198800eeadc4";
const PORT_INDEX_SHA256 = "15095f34b9e75515bbcc3924f6f8b2abb826ba96b48e819ec911486bcfa6f5a9";
const OFFICIAL_CROSS_SHA256 = {
  vertex: "9dd0268db1c23b40a4949f73e7faeef8f715d6a718ba7e232ac8bebbbefcebce",
  fragment: "7ccb065e78e6d06f527db2a40090fa8cf6760eea1af6526e2c1f126c4cf3bff7",
};
const OBSERVED_SCENES = [
  "scene.cPK_20_008900_02_HOUOUex_UR.json",
  "scene.cTR_20_000670_00_IIBUINOBAKKU_UR.json",
];
const PASS_POLICY = {
  rtSeparateBlend: false,
  fixed: {
    zClip: { val: 1, name: null }, conservative: { val: 0, name: null },
    offsetFactor: { val: 0, name: null }, offsetUnits: { val: 0, name: null },
    alphaToMask: { val: 0, name: null }, fogMode: -1, lighting: false,
  },
};

function equal(actual, expected, message) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function member(name, type, offset, array = undefined) {
  return { name, type, offset, ...(array ? { array } : {}) };
}

function assertReflection(data, expected) {
  const ubo = (data.ubos || []).find((item) => item.name === expected.ubo.name);
  if (!ubo || ubo.block_size !== expected.ubo.size) throw new Error(`${expected.ubo.name} UBO changed`);
  equal((data.types[ubo.type].members || []).map(({ name, type, offset, array }) => ({
    name, type, offset, ...(array ? { array } : {}),
  })), expected.ubo.members, `${expected.ubo.name} members changed`);
  for (const key of ["inputs", "outputs", "textures"]) {
    equal((data[key] || []).map(({ name, type, location, binding }) => ({
      name, type, ...(location != null ? { location } : {}), ...(binding != null ? { binding } : {}),
    })).sort((a, b) => (a.location ?? a.binding) - (b.location ?? b.binding)), expected[key] || [], `${key} changed`);
  }
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

const vertexMapping = [
  "_Time", "modelMatrix", "projectionMatrix", "viewMatrix", "_TexScale", "_TexPixelsX",
  "_TexPixelsY", "_ScaleX", "_ScaleY", "_IsBack", "_BaseColor", "_BaseColorRGBIntensity",
  "_TiltThreshold", "_TiltPower", "_CornerPower", "_NotCornerOffset", "_FlickerAnimSpeed",
  "_TiltFlickerAnimSpeed", "_FlickerTimeDelay", "_FlickResultIntensityLowestPoint",
  "_ShouldDoFlicker",
];
const fragmentMapping = ["_RemoveTextureArtifact", "_EmissivePattern", "_EmissiveColor"];
const VERTEX_BASIS_CONVERSIONS = Object.freeze({
  objectMatrices: [{
    matrixName: "modelMatrix",
    columns: [{ column: 2, expectedOccurrences: 3 }],
  }],
  worldVectors: [],
  viewForwards: [],
});

function adaptVertex(source) {
  let out = source.replace(/^#version 300 es\s*/m, "precision highp float;\nprecision highp int;\n\n");
  out = replaceUbo(out, "_17_19", "_19", [
    "uniform highp float uTime;", "uniform highp mat4 modelMatrix;",
    "uniform highp mat4 projectionMatrix;", "uniform highp mat4 viewMatrix;",
    "uniform mediump float _TexScale;", "uniform int _TexPixelsX;", "uniform int _TexPixelsY;",
    "uniform highp float _ScaleX;", "uniform highp float _ScaleY;", "uniform int _IsBack;",
    "uniform mediump vec4 _BaseColor;", "uniform mediump float _BaseColorRGBIntensity;",
    "uniform mediump float _TiltThreshold;", "uniform mediump float _TiltPower;",
    "uniform highp float _CornerPower;", "uniform mediump float _NotCornerOffset;",
    "uniform highp float _FlickerAnimSpeed;", "uniform highp float _TiltFlickerAnimSpeed;",
    "uniform highp float _FlickerTimeDelay;", "uniform highp float _FlickResultIntensityLowestPoint;",
    "uniform highp float _ShouldDoFlicker;",
  ]);
  out = out
    .replace("layout(location = 0) in vec4 _915;", "layout(location = 0) in vec3 position;")
    .replace("layout(location = 1) in vec2 _81;", "layout(location = 1) in vec2 uv;")
    .replace(/void main\(\)\s*\{/, `void main()\n{\n    vec4 _915 = vec4(position, 1.0);\n    vec2 _81 = uv;\n    vec4 _Time = vec4(uTime * 0.05, uTime, uTime * 2.0, uTime * 3.0);`);
  out = replaceMembers(out, "_19", vertexMapping);
  out = adaptUnityObjectToWorldDataAxes(out, {
    matrixName: "modelMatrix", expectedCounts: { 2: 3 },
  });
  out = out.replace(/^\s*gl_Position\.y\s*=\s*-gl_Position\.y;\s*$/gm, "");
  if (/_19\._m|gl_Position\.y\s*=\s*-gl_Position\.y/.test(out)) throw new Error("vertex adaptation incomplete");
  return `${out.trimEnd()}\n`;
}

function adaptFragment(source) {
  let out = source.replace(/^#version 300 es\s*/m, "");
  out = replaceUbo(out, "_23_25", "_25", [
    "uniform highp float _RemoveTextureArtifact;", "uniform int _EmissivePattern;",
    "uniform highp vec4 _EmissiveColor;",
  ]);
  out = replaceMembers(out, "_25", fragmentMapping);
  if (/_25\._m/.test(out)) throw new Error("fragment adaptation incomplete");
  return `${out.trimEnd()}\n`;
}

function observedSceneMaterials() {
  return OBSERVED_SCENES.flatMap((scene) => {
    const data = JSON.parse(fs.readFileSync(path.join(ROOT, "public", scene), "utf8"));
    return Object.entries(data.materials || {})
      .filter(([, material]) => material.shader === "Card_UR_LensFlare")
      .map(([material, recipe]) => ({ scene, material, keywords: recipe.official?.validKeywords || recipe.keywords || [] }));
  });
}

const vertexExpected = {
  ubo: { name: "_17_19", size: 296, members: [
    member("_m0", "vec4", 0), member("_m1", "vec4", 16, [4]), member("_m2", "vec4", 80, [4]),
    member("_m3", "vec4", 144, [4]), member("_m4", "float", 208), member("_m5", "int", 212),
    member("_m6", "int", 216), member("_m7", "float", 220), member("_m8", "float", 224),
    member("_m9", "int", 228), member("_m10", "vec4", 240),
    ...Array.from({ length: 10 }, (_, i) => member(`_m${i + 11}`, "float", 256 + i * 4)),
  ] },
  inputs: [{ name: "_915", type: "vec4", location: 0 }, { name: "_81", type: "vec2", location: 1 }],
  outputs: [
    { name: "vs_TEXCOORD0", type: "vec2", location: 0 },
    { name: "vs_TEXCOORD1", type: "vec4", location: 1 },
  ],
  textures: [{ name: "_288", type: "sampler2D", binding: 2 }],
};

const fragmentExpected = {
  ubo: { name: "_23_25", size: 32, members: [
    member("_m0", "float", 0), member("_m1", "int", 4), member("_m2", "vec4", 16),
  ] },
  inputs: [
    { name: "vs_TEXCOORD0", type: "vec2", location: 0 },
    { name: "vs_TEXCOORD1", type: "vec4", location: 1 },
  ],
  outputs: [{ name: "_56", type: "vec4", location: 0 }, { name: "_72", type: "vec4", location: 1 }],
  textures: [{ name: "_13", type: "sampler2D", binding: 0 }],
};

await withExtractedSelectorProgram({
  selectorId: SELECTOR_ID,
  candidateWitnessId: CANDIDATE_WITNESS_ID,
  expectedProofGraphSha256: PROOF_GRAPH_SHA256,
  expectedPortIndexSha256: PORT_INDEX_SHA256,
  decryptedRoot: path.resolve(SHADER_ROOT, "..", ".."),
  prefix: "ur_lens_flare",
  rootDir: ROOT,
  spirvCross: SPIRV_CROSS,
}, ({ metadata, files, reflection }) => {
  assertReflection(reflection.vertex, vertexExpected);
  assertReflection(reflection.fragment, fragmentExpected);
  equal(metadata.parameterReflection, {
    version: 202012090,
    constantBlockCount: 3,
    constantBuffers: [
      { name: "", size: 0, fields: [] },
      { name: "PGlobals1657561348", size: 32, fields: [] },
      { name: "VGlobals1657561348", size: 296, fields: [] },
    ],
    resourceCount: 0,
    resourceDecoding: "empty-exact",
    textures: [],
    constantBufferBindings: [],
    serializedCommonBuffers: [
      { name: "PGlobals1657561348", size: 32 }, { name: "VGlobals1657561348", size: 296 },
    ],
    serializedCommonTextures: [
      { name: "_BaseMap", binding: 0, encodedIndex: 134217728, dim: 2 },
      { name: "_FlareVAT", binding: 2, encodedIndex: 67108866, dim: 2 },
    ],
    bindingClosure: {
      constantBuffersMatch: true,
      constantBufferDeclarationMode: "serialized-common",
      commonConstantBufferCount: 2,
      variantConstantBufferCount: 0,
      variantTextureCount: 0,
      commonTextureCount: 2,
      constantBufferBindingCount: 0,
    },
  }, "official parameter reflection changed");

  const observedMaterials = observedSceneMaterials();
  equal(observedMaterials.map(({ scene, material, keywords }) => ({ scene, material, keywords })), [
    { scene: OBSERVED_SCENES[0], material: "L_UR_Pokemon_LensFlare_Back", keywords: [] },
    { scene: OBSERVED_SCENES[0], material: "L_UR_Pokemon_LensFlare_Front", keywords: [] },
    { scene: OBSERVED_SCENES[1], material: "L_UR_Trainer_LensFlare_Back", keywords: [] },
    { scene: OBSERVED_SCENES[1], material: "L_UR_Trainer_LensFlare_Front", keywords: [] },
  ], "observed UR LensFlare selector users changed");

  const officialVertex = runCommand(SPIRV_CROSS, [files.vertexSpirv, "--version", "300", "--es"], { cwd: ROOT });
  const officialFragment = runCommand(SPIRV_CROSS, [files.fragmentSpirv, "--version", "300", "--es"], { cwd: ROOT });
  assert.equal(sha256(officialVertex), OFFICIAL_CROSS_SHA256.vertex, "official vertex SPIRV-Cross shape changed");
  assert.equal(sha256(officialFragment), OFFICIAL_CROSS_SHA256.fragment, "official fragment SPIRV-Cross shape changed");
  const bindings = compileCommonBindings(metadata.commonBindings);
  const programBindings = joinProgramConstantBufferStages(
    compileProgramBindings(
      bindings,
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
  const samplerBindings = joinProgramSamplerBindings(programBindings, reflection).map(({ set, ...row }) => {
    assert.equal(set, 0, "WebGL sampler port requires descriptor set 0");
    return row;
  });
  equal(samplerBindings.map(({ slot, spirvName, binding, stages }) => ({ slot, spirvName, binding, stages })), [
    { slot: "_BaseMap", spirvName: "_13", binding: 0, stages: ["fragment"] },
    { slot: "_FlareVAT", spirvName: "_288", binding: 2, stages: ["vertex"] },
  ], "compiled cross-stage sampler bindings changed");

  const vertex = adaptVertex(officialVertex);
  const fragment = adaptFragment(officialFragment);
  const runtimeContract = {
    schema: "pocket-card-render/webgl-runtime-port@1",
    shader_key: "Card_UR_LensFlare",
    attributes: { position: "vec3", uv: "vec2" },
    engine_uniforms: { modelMatrix: "mat4", projectionMatrix: "mat4", viewMatrix: "mat4" },
    material_uniforms: {
      floats: [
        "_TexScale", "_ScaleX", "_ScaleY", "_BaseColorRGBIntensity", "_TiltThreshold",
        "_TiltPower", "_CornerPower", "_NotCornerOffset", "_FlickerAnimSpeed",
        "_TiltFlickerAnimSpeed", "_FlickerTimeDelay", "_FlickResultIntensityLowestPoint",
        "_ShouldDoFlicker", "_RemoveTextureArtifact",
      ],
      ints: ["_TexPixelsX", "_TexPixelsY", "_IsBack", "_EmissivePattern"],
      vectors: { _BaseColor: "vec4", _EmissiveColor: "vec4" },
    },
    dynamic_uniforms: { uTime: { type: "float", source: "official-clock" } },
    require_complete_active_bindings: true,
    camera_from_view: false,
    mrt_attachments: 2,
    stencil_normalization: "disable-when-always-keep",
    stencil_face_mode: "generic",
    backend_basis_conversions: { vertex: VERTEX_BASIS_CONVERSIONS },
  };
  const adaptation = buildWebglAdaptationV2({
    vertex: {
      officialSpirvSha256: sha256File(files.vertexSpirv),
      spirvCrossGlslSha256: sha256(officialVertex),
      outputSha256: sha256(vertex),
      operations: [
        { kind: "vertex-input-binding", contract: "official-bind-channels-to-three-r165" },
        { kind: "engine-uniform-binding", contract: "unity-builtins-to-three-r165" },
        {
          kind: "uniform-buffer-flattening",
          source: "serialized-common",
          preservation: "names-types-precision",
        },
        { kind: "official-clock-binding", contract: "official-clock-to-unity-time" },
        { kind: "object-basis-conversion", contract: "unity-to-three-basis" },
        {
          kind: "clip-space-y-conversion",
          from: "unity-vulkan",
          to: "webgl",
          operation: "remove-y-inversion",
        },
        { kind: "glsl-version-ownership", owner: "three-raw-shader-material" },
      ],
      substitutions: [
        "position vec4 := vec4(three.position, 1.0) and uv := three.uv",
        "unity_ObjectToWorld := three.modelMatrix",
        "recover Unity ObjectToWorld Z-axis data through M_unity = C * M_three * A before tilt visibility arithmetic",
        "glstate_matrix_projection := three.projectionMatrix and unity_MatrixV := three.viewMatrix",
        "Unity _Time := vec4(officialClock * 0.05, officialClock, officialClock * 2, officialClock * 3)",
        "remove Unity Vulkan clip-space Y inversion for WebGL clip space",
      ],
    },
    fragment: {
      officialSpirvSha256: sha256File(files.fragmentSpirv),
      spirvCrossGlslSha256: sha256(officialFragment),
      outputSha256: sha256(fragment),
      operations: [
        {
          kind: "uniform-buffer-flattening",
          source: "serialized-common",
          preservation: "names-types-precision",
        },
        { kind: "glsl-version-ownership", owner: "three-raw-shader-material" },
      ],
      substitutions: [
        "replace serialized PGlobals UBO members with same-name Three.js uniforms",
      ],
    },
    interfaceSha256: canonicalJsonSha256({ vertex: reflection.vertex, fragment: reflection.fragment }),
    officialVertexInputs: vertexInputContract,
    runtimeContract,
    officialProgramBindings: manifestProgramBindings,
  });
  const outputs = {
    "ur_lens_flare.vert.glsl": vertex,
    "ur_lens_flare.frag.glsl": fragment,
    "ur_lens_flare_uniforms.json": `${JSON.stringify({
      shader: "Card_UR_LensFlare",
      generated_by: "build/build-exact-ur-lens-flare.mjs",
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
      official_pass_runtime: compileOfficialPassContract(metadata.passContract, {
        sourceSha256: metadata.identityFields.passStateSha256,
        policy: PASS_POLICY,
      }),
      official_common_bindings: { source_sha256: metadata.identityFields.commonBindingsSha256, ...bindings },
      official_program_bindings: manifestProgramBindings,
      official_vertex_inputs: vertexInputContract,
      official_shader_property_defaults: metadata.shaderPropertyDefaults,
      official_selector_users: {
        material_count: observedMaterials.length,
        scenes: [...new Set(observedMaterials.map(({ scene }) => scene))],
      },
      webgl_adaptation: adaptation,
      webgl_sources: {
        vertex: "public/shaders/ur_lens_flare.vert.glsl",
        fragment: "public/shaders/ur_lens_flare.frag.glsl",
      },
      runtime_contract: runtimeContract,
      sampler_bindings: samplerBindings,
      samplers: samplerBindings.map((row) => row.spirvName),
      sampler_slots: samplerBindings.map((row) => row.slot),
      compiled_texture_bindings: Object.fromEntries(samplerBindings.map((row) => [row.slot, row.binding])),
      implicit_defaults: metadata.shaderPropertyDefaults.textures,
      mrt: { primary: "_56", emissive: "_72", emissive_location: 1, secondary_rgb: "active" },
    }, null, 2)}\n`,
  };
  writeOrCheckOutputs(outputs, { outDir: OUT, check: CHECK });
  console.log(`${CHECK ? "verified" : "generated"} Card_UR_LensFlare from selector-bound official SPIR-V (${sha256File(files.vertexSpirv).slice(0, 12)} / ${sha256File(files.fragmentSpirv).slice(0, 12)})`);
});
