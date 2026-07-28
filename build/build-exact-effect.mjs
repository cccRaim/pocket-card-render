// Generate all serialized Effect selector variants used by the official card corpus.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
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
const GLSLANG = process.env.GLSLANG_VALIDATOR || "glslangValidator";
const OUT = path.join(ROOT, "public", "shaders");
const CHECK = process.argv.includes("--check") || process.env.PCR_EXACT_CHECK === "1";
const PROOF_GRAPH_SHA256 = "307ed3660e5d3b1bfd8cf9e6b3d64e44937af215da3b6ed84ead198800eeadc4";
const PORT_INDEX_SHA256 = "15095f34b9e75515bbcc3924f6f8b2abb826ba96b48e819ec911486bcfa6f5a9";
const PASS_POLICY = {
  rtSeparateBlend: false,
  fixed: {
    zClip: { val: 1, name: null }, conservative: { val: 0, name: null },
    offsetFactor: { val: 0, name: null }, offsetUnits: { val: 0, name: null },
    alphaToMask: { val: 0, name: null }, fogMode: -1, lighting: false,
  },
};

const BASIC_VERTEX = {
  file: "effect_basic.vert.glsl",
  spirv: "2e0a2c4d95cc0e961ca92519bbb81d06f30eb4dd89f493fb2a15d3e231329ea1",
  cross: "0d090a2a2f6f9effae6b2cf5d2fa7fee41157f7f6fd472ece6643e647eda82eb",
};
const VIEW_VERTEX = {
  file: "effect_view.vert.glsl",
  spirv: "5874c0946075ebe8f63a0479d96f2e22abf3d9e5e215c23e85d5f8d8756cf71d",
  cross: "41466da13b534e4cc8c59dfe370953d9b03537a0b00bb5a93c3401653901ca24",
};

const PORTS = [
  {
    id: "eff1", keywords: ["_LAYER_EFF1"],
    selectorId: "1964481cf978f6d764a8ae5537452c1e9f073c780dfcc712c7273b8e89d5d039",
    candidateWitnessId: "8a5107415863ffbca95a302e650c49b3ada5d4edf51d8ad9b808427ce69b757a",
    semanticExecutableId: "a4c27f4ae4ebc0d2c3341495648c6a2efd9a644b80ed5f0a946e54dc20ef3036",
    parameterBytes: 468, parameterReflection: "1065a4573661dad55519e6ba2b76fb484f80cb56254e27c5f7131bea0cd0af57",
    vertex: BASIC_VERTEX, fragmentFile: "effect_basic.frag.glsl",
    fragmentSpirv: "224be484abff9b08503dd3aff779c034ba25b1cb53c2fc1be76b2ecd74cc3c9b",
    fragmentCross: "dabc6575a3ffb25832516dac324f913964d457c8a30d464f8a0593664f18e0ca",
    fragmentUbo: ["_21_23", "_23"], fields: ["_MainPower", "_AlphaBlend"],
    outputs: ["_51", "_53"], samplers: [["_MainTex", "_13", 0]],
  },
  {
    id: "eff2", keywords: ["_LAYER_EFF2"],
    selectorId: "223dc2f97532cc74be6effcc35c7cc8cbb88e974b25206a26e9a730a4f7ebddb",
    candidateWitnessId: "a2594e3b9d6c41b9cfb402631f31f9aaa178dfc081f5725a5fb020498ce071bf",
    semanticExecutableId: "a4c27f4ae4ebc0d2c3341495648c6a2efd9a644b80ed5f0a946e54dc20ef3036",
    parameterBytes: 468, parameterReflection: "1065a4573661dad55519e6ba2b76fb484f80cb56254e27c5f7131bea0cd0af57",
    vertex: BASIC_VERTEX, fragmentFile: "effect_basic.frag.glsl",
    fragmentSpirv: "224be484abff9b08503dd3aff779c034ba25b1cb53c2fc1be76b2ecd74cc3c9b",
    fragmentCross: "dabc6575a3ffb25832516dac324f913964d457c8a30d464f8a0593664f18e0ca",
    fragmentUbo: ["_21_23", "_23"], fields: ["_MainPower", "_AlphaBlend"],
    outputs: ["_51", "_53"], samplers: [["_MainTex", "_13", 0]],
  },
  {
    id: "eff3", keywords: ["_LAYER_EFF3"],
    selectorId: "418f6be89856a2598af04e8a57b44b7d6221f91b6423ba8fef2b3537f4fc863c",
    candidateWitnessId: "77477f414227d115726d9acdd09d08574f6adf6bc9ba1361335dd7f9b8f3aeed",
    semanticExecutableId: "a4c27f4ae4ebc0d2c3341495648c6a2efd9a644b80ed5f0a946e54dc20ef3036",
    parameterBytes: 468, parameterReflection: "1065a4573661dad55519e6ba2b76fb484f80cb56254e27c5f7131bea0cd0af57",
    vertex: BASIC_VERTEX, fragmentFile: "effect_basic.frag.glsl",
    fragmentSpirv: "224be484abff9b08503dd3aff779c034ba25b1cb53c2fc1be76b2ecd74cc3c9b",
    fragmentCross: "dabc6575a3ffb25832516dac324f913964d457c8a30d464f8a0593664f18e0ca",
    fragmentUbo: ["_21_23", "_23"], fields: ["_MainPower", "_AlphaBlend"],
    outputs: ["_51", "_53"], samplers: [["_MainTex", "_13", 0]],
  },
  {
    id: "eff3_grad", keywords: ["_LAYER_EFF3", "_UseGradationMap"],
    selectorId: "43d3e5f021a5caec0cdbeddecd49965ee155874fb2e5bf1e9c463480e808df90",
    candidateWitnessId: "cfbcafd35448639e7f0b78680716fff73dec36f1997fd6f41adf39065c66cf9f",
    semanticExecutableId: "24063d9e4084ffb5497611d752d053943dc6e0de04e3f9dfb04c09e01e148428",
    parameterBytes: 488, parameterReflection: "96a1c1fa34c06dedb4cdb0928a8420d4dc856f77cca38ab1ddfdebcb95ca648f",
    vertex: BASIC_VERTEX, fragmentFile: "effect_grad_eff3.frag.glsl",
    fragmentSpirv: "78aed0c79aa57a70256b6eb760f0505d6e71d88734c35ef8f682ecc7fb9ff3a1",
    fragmentCross: "57d535021c7b2bbba7fe65cee2f477129708b865c89c73c7e35ddc2a971ad103",
    fragmentUbo: ["_39_41", "_41"], fields: ["_MainPower", "_AlphaBlend"],
    outputs: ["_65", "_67"], samplers: [["_MainTex", "_18", 0], ["_GradationMap", "_29", 1]],
  },
  {
    id: "eff1_grad_view", keywords: ["_LAYER_EFF1", "_UseGradationMap", "_UseViewMask"],
    selectorId: "b7f1037bc99fabb5b5542028d377a1c70692bc63f026e754e33a914727049abb",
    candidateWitnessId: "84928d4e6e5c618fd444730f6445a6ca035178e75eab8589777d2dc45fffad75",
    semanticExecutableId: "adefbf0097375436f4e455ff9b6ed88b98f7230f4b444c69903ab322ea0111aa",
    parameterBytes: 756, parameterReflection: "54c1fc7cbdf98294b772e30722375faaf7e06594aa71fccbaee047dd5c0a6c45",
    vertex: VIEW_VERTEX, fragmentFile: "effect_grad_view_eff1.frag.glsl",
    fragmentSpirv: "4d1eecf12563cfbc597c320b4ad807cebbb03a833012aa143f637a23f3a43904",
    fragmentCross: "a2300b027666007ce9ac42a1c0a2185670bfdb91a60f3fb6c510e0603c093c8d",
    fragmentUbo: ["_29_31", "_31"],
    fields: ["_MainPower", "_MaskPower", "_AnglePower", "_Edge", "_Progress", "_AlphaBlend"],
    outputs: ["_191", "_193"], samplers: [["_MainTex", "_13", 0], ["_GradationMap", "_115", 1]],
  },
  {
    id: "eff2_grad_view", keywords: ["_LAYER_EFF2", "_UseGradationMap", "_UseViewMask"],
    selectorId: "be2fa01af3260bcb40dd21c0a1d3f58df18f764c5de649bbc4213c828565580d",
    candidateWitnessId: "04789c9857b8e44e7266785bcfe2d0b7ea4f16ad45d7e75c7a48b7adc38cecf9",
    semanticExecutableId: "3a39feb968e5669c28ae0b7c6559173412523d7e4ad032064d3f1f5a7440c18f",
    parameterBytes: 756, parameterReflection: "664d65a2f3dec6bc85996f9c5399484f08ee860908d04bed6beb93c3bab1e318",
    vertex: VIEW_VERTEX, fragmentFile: "effect_grad_view_eff2.frag.glsl",
    fragmentSpirv: "63c69e8f47626afd4668fc9463922901953259447c0f6b28a9a092d44e40ce27",
    fragmentCross: "f0240684f6d65124a6cb38e6e30c0678f93476754f325460542b3864fa50a75c",
    fragmentUbo: ["_29_31", "_31"],
    fields: ["_MainPower", "_MaskPower", "_AnglePower", "_Edge", "_Progress", "_AlphaBlend"],
    outputs: ["_192", "_194"], samplers: [["_MainTex", "_13", 0], ["_GradationMap", "_116", 1]],
  },
];

function equal(actual, expected, label) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function basicVertex() {
  return `precision highp float;
precision highp int;

in vec3 position;
in vec2 uv;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform float _DepthOffset;
uniform highp vec4 _MainTex_ST;
out mediump vec2 vs_TEXCOORD0;

void main()
{
    vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
    viewPosition.z -= _DepthOffset;
    gl_Position = projectionMatrix * viewPosition;
    vs_TEXCOORD0 = (uv * _MainTex_ST.xy) + _MainTex_ST.zw;
}
`;
}

function viewVertex() {
  return `precision highp float;
precision highp int;

in vec3 position;
in vec3 normal;
in vec4 tangent;
in vec2 uv;
uniform mat4 modelMatrix;
uniform mat4 viewMatrix;
uniform mat4 projectionMatrix;
uniform vec3 cameraPosition;
uniform float _DepthOffset;
uniform highp vec4 _MainTex_ST;
out mediump vec2 vs_TEXCOORD0;
out mediump vec3 vs_TEXCOORD1;

void main()
{
    vec4 viewPosition = viewMatrix * modelMatrix * vec4(position, 1.0);
    viewPosition.z -= _DepthOffset;
    gl_Position = projectionMatrix * viewPosition;
    vs_TEXCOORD0 = (uv * _MainTex_ST.xy) + _MainTex_ST.zw;
    vec3 normalizedNormal = normalize(normal);
    vec3 normalizedTangent = normalize(tangent.xyz);
    vec3 bitangent = cross(normalizedNormal, normalizedTangent) * tangent.w;
    vec3 cameraObject = normalize((inverse(modelMatrix) * vec4(cameraPosition, 1.0)).xyz);
    vs_TEXCOORD1 = vec3(
        dot(tangent.xyz, cameraObject),
        -dot(bitangent, cameraObject),
        dot(normal, cameraObject)
    );
}
`;
}

function interfaceRows(rows = []) {
  return rows.map(({ name, type, location }) => ({ name, type, location })).sort((a, b) => a.location - b.location);
}

function assertInterface(reflection, port) {
  const view = port.vertex === VIEW_VERTEX;
  equal(interfaceRows(reflection.vertex.inputs), view ? [
    { name: "_11", type: "vec4", location: 0 },
    { name: "_151", type: "vec3", location: 1 },
    { name: "_169", type: "vec4", location: 2 },
    { name: "_133", type: "vec2", location: 3 },
  ] : [
    { name: "_11", type: "vec4", location: 0 },
    { name: "_131", type: "vec2", location: 1 },
  ], `${port.id} vertex inputs`);
  equal(interfaceRows(reflection.vertex.outputs), view ? [
    { name: "vs_TEXCOORD0", type: "vec2", location: 0 },
    { name: "vs_TEXCOORD1", type: "vec3", location: 1 },
  ] : [{ name: "vs_TEXCOORD0", type: "vec2", location: 0 }], `${port.id} vertex outputs`);
  equal(interfaceRows(reflection.fragment.outputs), port.outputs.map((name, location) => ({ name, type: "vec4", location })), `${port.id} fragment outputs`);
}

function adaptFragment(source, port) {
  const [block, instance] = port.fragmentUbo;
  const blockPattern = new RegExp(`layout\\(std140\\) uniform ${block}[\\s\\S]*?}\\s*${instance};\\s*`);
  let output = source.replace(/^#version 300 es\s*/m, "");
  output = output.replace(blockPattern, `${port.fields.map((name) => `uniform mediump float ${name};`).join("\n")}\n\n`);
  for (const [index, name] of port.fields.entries()) output = output.replaceAll(`${instance}._m${index}`, name);
  if (output.includes(`${instance}._m`) || output.includes(`uniform ${block}`)) {
    throw new Error(`${port.id} fragment UBO adaptation incomplete`);
  }
  return `${output.trimEnd()}\n`;
}

function validateWebGlStage(source, stage, label) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pcr-effect-glsl-"));
  const file = path.join(tmp, `${label}.${stage}`);
  try {
    fs.writeFileSync(file, `#version 300 es\n${source}`);
    runCommand(GLSLANG, ["-S", stage, file], { cwd: ROOT });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

const outputs = {};
for (const port of PORTS) {
  await withExtractedSelectorProgram({
    selectorId: port.selectorId,
    candidateWitnessId: port.candidateWitnessId,
    expectedProofGraphSha256: PROOF_GRAPH_SHA256,
    expectedPortIndexSha256: PORT_INDEX_SHA256,
    decryptedRoot: path.resolve(SHADER_ROOT, "..", ".."),
    prefix: `effect_${port.id}`,
    rootDir: ROOT,
    spirvCross: SPIRV_CROSS,
  }, ({ metadata, files, reflection }) => {
    equal(metadata.selector.keywords, port.keywords, `${port.id} selector keywords`);
    equal(metadata.selector.semanticExecutableId, port.semanticExecutableId, `${port.id} semantic executable`);
    equal(metadata.artifacts.parameterEntry.byteSize, port.parameterBytes, `${port.id} parameter byte size`);
    equal(metadata.parameterReflectionSha256, port.parameterReflection, `${port.id} parameter reflection`);
    equal(metadata.identityFields.vertexSpirvSha256, port.vertex.spirv, `${port.id} vertex SPIR-V`);
    equal(metadata.identityFields.fragmentSpirvSha256, port.fragmentSpirv, `${port.id} fragment SPIR-V`);
    assertInterface(reflection, port);

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
    const samplerBindings = joinProgramSamplerBindings(programBindings, reflection).map(({ set, ...row }) => {
      if (set !== 0) throw new Error(`${port.id}: WebGL sampler requires descriptor set 0`);
      return row;
    });
    equal(samplerBindings.map(({ slot, spirvName, binding }) => [slot, spirvName, binding]), port.samplers, `${port.id} sampler bindings`);

    const officialVertex = runCommand(SPIRV_CROSS, [files.vertexSpirv, "--version", "300", "--es"], { cwd: ROOT });
    const officialFragment = runCommand(SPIRV_CROSS, [files.fragmentSpirv, "--version", "300", "--es"], { cwd: ROOT });
    equal(sha256(officialVertex), port.vertex.cross, `${port.id} complete vertex SPIRV-Cross output`);
    equal(sha256(officialFragment), port.fragmentCross, `${port.id} complete fragment SPIRV-Cross output`);
    const vertex = port.vertex === VIEW_VERTEX ? viewVertex() : basicVertex();
    const fragment = adaptFragment(officialFragment, port);
    validateWebGlStage(vertex, "vert", `${port.id}-vertex`);
    validateWebGlStage(fragment, "frag", `${port.id}-fragment`);
    const vertexPath = `public/shaders/${port.vertex.file}`;
    const fragmentPath = `public/shaders/${port.fragmentFile}`;
    const textureCoordinateContract = {
      transforms: [{
        uniform: "_MainTex_ST",
        slot: "_MainTex",
        input: "uv",
        output: "vs_TEXCOORD0",
        conversion: "unity-texenv-to-three-gltf-v",
      }],
      ...(port.vertex === VIEW_VERTEX
        ? {
          tangentViewY: {
            output: "vs_TEXCOORD1",
            bitangent: "bitangent",
            viewVector: "cameraObject",
            conversion: "negate-unity-to-three-gltf-v",
          },
        }
        : {}),
    };
    const runtimeContract = {
      schema: "pocket-card-render/webgl-runtime-port@1",
      shader_key: "Effect",
      attributes: port.vertex === VIEW_VERTEX
        ? { position: "vec3", normal: "vec3", tangent: "vec4", uv: "vec2" }
        : { position: "vec3", uv: "vec2" },
      engine_uniforms: port.vertex === VIEW_VERTEX
        ? { modelMatrix: "mat4", viewMatrix: "mat4", projectionMatrix: "mat4", cameraPosition: "vec3" }
        : { modelViewMatrix: "mat4", projectionMatrix: "mat4" },
      material_uniforms: { floats: [...port.fields, "_DepthOffset"], ints: [], vectors: {} },
      texture_coordinates: { vertex: textureCoordinateContract },
      require_complete_active_bindings: true,
      camera_from_view: port.vertex === VIEW_VERTEX,
      mrt_attachments: 2,
      stencil_normalization: "none",
      stencil_face_mode: "generic",
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
            source: "variant-local",
            preservation: "names-types-precision",
          },
          {
            kind: "texture-coordinate-basis-conversion",
            contract: "unity-texenv-to-three-gltf-uv",
          },
          { kind: "view-depth-offset", contract: "linear-eye-depth-equivalent" },
          { kind: "matrix-expression-fold", contract: "mvp-object-to-projection-model-view" },
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
        spirvCrossGlslSha256: sha256(officialFragment),
        outputSha256: sha256(fragment),
        operations: [
          {
            kind: "uniform-buffer-flattening",
            source: "variant-local",
            preservation: "names-types-precision",
          },
          { kind: "glsl-version-ownership", owner: "three-raw-shader-material" },
        ],
      },
      interfaceSha256: canonicalJsonSha256({ vertex: reflection.vertex, fragment: reflection.fragment }),
      officialVertexInputs: vertexInputContract,
      runtimeContract,
      officialProgramBindings: manifestProgramBindings,
    });
    const passRuntime = compileOfficialPassContract(metadata.passContract, {
      sourceSha256: metadata.identityFields.passStateSha256,
      policy: PASS_POLICY,
    });
    outputs[port.vertex.file] = vertex;
    outputs[port.fragmentFile] = fragment;
    outputs[`effect_${port.id}_uniforms.json`] = `${JSON.stringify({
      shader: "Lettuce/Common/CardNew/Effect",
      generated_by: "build/build-exact-effect.mjs",
      selected_keywords: port.keywords,
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
      webgl_sources: { vertex: vertexPath, fragment: fragmentPath },
      runtime_contract: runtimeContract,
      sampler_bindings: samplerBindings,
      samplers: samplerBindings.map((row) => row.spirvName),
      sampler_slots: samplerBindings.map((row) => row.slot),
      compiled_texture_bindings: Object.fromEntries(samplerBindings.map((row) => [row.slot, row.binding])),
      implicit_defaults: metadata.shaderPropertyDefaults.textures,
      mrt: { primary: port.outputs[0], secondary: port.outputs[1], secondary_value: "zero" },
    }, null, 2)}\n`;
  });
}

writeOrCheckOutputs(outputs, { outDir: OUT, check: CHECK });
console.log(`${CHECK ? "verified" : "generated"} six selector-owned Effect WebGL2 ports`);
