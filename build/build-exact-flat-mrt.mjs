// Generate the selector-owned Frame and Simple-Transparent WebGL2 ports from official Unity bytes.
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  canonicalJsonSha256,
  compileCommonBindings,
  compileOfficialPassContract,
  compileOfficialVertexInputContract,
  compileProgramBindings,
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
const PROOF_GRAPH_SHA256 = "307ed3660e5d3b1bfd8cf9e6b3d64e44937af215da3b6ed84ead198800eeadc4";
const PORT_INDEX_SHA256 = "15095f34b9e75515bbcc3924f6f8b2abb826ba96b48e819ec911486bcfa6f5a9";
const SHARED_VERTEX_CROSS_SHA256 = "b58c6793bd83439bc7dacfceef7c95e76d417e0359885f1a4dabb93338ebc38c";
const PASS_POLICY = {
  rtSeparateBlend: false,
  fixed: {
    zClip: { val: 1, name: null }, conservative: { val: 0, name: null },
    offsetFactor: { val: 0, name: null }, offsetUnits: { val: 0, name: null },
    alphaToMask: { val: 0, name: null }, fogMode: -1, lighting: false,
  },
};

const PORTS = [
  {
    shader: "Frame",
    selectorId: "f50f3d9fd9854ef19bc1de211901dd2f3306ee29a45045cdd6d10888c5f302e2",
    candidateWitnessId: "4089f1cd646da48bbe8b218644eb189f7c51c342f6af6d56e5b8aed0a3426760",
    prefix: "frame_exact",
    fragmentFile: "frame.frag.glsl",
    manifestFile: "frame_uniforms.json",
    parameterReflectionSha256: "0b07be5b746e19ee21101a0e790d94d86e60f62193b0f4a9347cc5a16f166a4e",
    parameterBytes: 100,
    fragmentCrossSha256: "080a07ec2cbfead9e6e5338389830d9acec00dde1d4917c05edce2fc8e4e0427",
    samplerSlot: "_BaseTex",
    materialFloats: ["_EmitMasking"],
    fragmentOutputs: ["_21", "_45"],
    emissiveValue: "alpha-only",
  },
  {
    shader: "Simple-Transparent",
    selectorId: "4d69b686fb131f9a98fd78a7a9954d02acece8221a1d6c859050903f5492ba5e",
    candidateWitnessId: "9333a06b73b596186e51bcc980106c4db68ec63c5d3e80428413a8a99c959bf1",
    prefix: "simple_transparent_exact",
    fragmentFile: "simple_transparent.frag.glsl",
    manifestFile: "simple_transparent_uniforms.json",
    parameterReflectionSha256: "b71418865edc70489cc81b4e8ea4bc1ab113b48a25d26b80215961890e1326d8",
    parameterBytes: 64,
    fragmentCrossSha256: "4cbf02d28d1addd46503135c2f84c02cfefd09bb2f3836edc9e34113727e9a91",
    samplerSlot: "_MainTex",
    materialFloats: [],
    fragmentOutputs: ["_29", "_40"],
    secondaryValue: [0, 0, 0, 0],
  },
  {
    shader: "Text_Alpha",
    selectorId: "4c74f7da95caf28e8e41316669ad358f3123d30184d9f5180265cc402258ed3f",
    candidateWitnessId: "449ba4e013e05df325624327980d8de353ddc5cb82ac8ea3e87a248951f6c5bc",
    prefix: "text_alpha_exact",
    fragmentFile: "dynamic_ui_text_alpha.frag.glsl",
    manifestFile: "dynamic_ui_text_alpha_uniforms.json",
    parameterReflectionSha256: "8a1d222bff295133a56014ddc234af348097f906512f55faab6e2082969780ae",
    parameterBytes: 100,
    fragmentCrossSha256: "0ef995f0ab6bd569d523e7dc8702768d28ffd3a01fdda18b9d80cc04b8944e04",
    samplerSlot: "_DynamicUITex",
    materialFloats: ["_AlphaThreshold", "_Alpha"],
    fragmentOutputs: ["_69", "_65"],
    emissiveValue: "alpha-only",
  },
];

function equal(actual, expected, message) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function interfaceRows(rows = []) {
  return rows.map(({ name, type, location }) => ({ name, type, location })).sort((a, b) => a.location - b.location);
}

function assertInterface(reflection, port) {
  const vertexUbo = reflection.vertex.ubos?.[0];
  equal({ name: vertexUbo?.name, size: vertexUbo?.block_size }, { name: "_18_20", size: 128 }, `${port.shader} vertex UBO`);
  equal(interfaceRows(reflection.vertex.inputs), [
    { name: "_11", type: "vec4", location: 0 }, { name: "_87", type: "vec2", location: 1 },
  ], `${port.shader} vertex inputs`);
  equal(interfaceRows(reflection.vertex.outputs), [{ name: "vs_TEXCOORD0", type: "vec2", location: 0 }], `${port.shader} vertex outputs`);
  equal(interfaceRows(reflection.fragment.inputs), [{ name: "vs_TEXCOORD0", type: "vec2", location: 0 }], `${port.shader} fragment inputs`);
  equal(interfaceRows(reflection.fragment.outputs), port.fragmentOutputs.map((name, location) => ({ name, type: "vec4", location })), `${port.shader} fragment outputs`);
  equal((reflection.fragment.textures || []).map(({ name, type, set, binding }) => ({ name, type, set, binding })), [
    { name: "_13", type: "sampler2D", set: 0, binding: 0 },
  ], `${port.shader} fragment sampler`);
  if (port.shader === "Frame") {
    const fragmentUbo = reflection.fragment.ubos?.[0];
    equal({ name: fragmentUbo?.name, size: fragmentUbo?.block_size }, { name: "_28_30", size: 4 }, "Frame fragment UBO");
  } else if (port.shader === "Text_Alpha") {
    const fragmentUbo = reflection.fragment.ubos?.[0];
    equal(
      { name: fragmentUbo?.name, size: fragmentUbo?.block_size },
      { name: "_33_35", size: 8 },
      "Text_Alpha fragment UBO",
    );
  } else {
    equal(reflection.fragment.ubos || [], [], "Simple-Transparent fragment UBOs");
  }
}

function adaptVertex(source) {
  let out = source.replace(/^#version 300 es\s*/m, "precision highp float;\nprecision highp int;\n\n");
  out = out.replace(/layout\(std140\) uniform _18_20[\s\S]*?}\s*_20;\s*/, [
    "uniform mat4 modelMatrix;", "uniform mat4 viewMatrix;", "uniform mat4 projectionMatrix;", "",
  ].join("\n"));
  out = out
    .replace("layout(location = 0) in vec4 _11;", "in vec3 position;")
    .replace("layout(location = 1) in vec2 _87;", "in vec2 uv;")
    .replace(/void main\(\)\s*\{/, `void main()
{
    vec4 _11 = vec4(position, 1.0);
    vec2 _87 = uv;
    mat4 _ObjectToWorld = modelMatrix;
    mat4 _ViewProjection = projectionMatrix * viewMatrix;`)
    .replaceAll("_20._m0", "_ObjectToWorld")
    .replaceAll("_20._m1", "_ViewProjection")
    .replace(/^\s*gl_Position\.y\s*=\s*-gl_Position\.y;\s*$/m, "");
  if (/_20\._m|gl_Position\.y\s*=\s*-gl_Position\.y/.test(out)) throw new Error("flat MRT vertex adaptation incomplete");
  return `${out.trimEnd()}\n`;
}

function adaptFragment(source, port) {
  let out = source.replace(/^#version 300 es\s*/m, "");
  if (port.shader === "Frame") {
    out = out.replace(/layout\(std140\) uniform _28_30[\s\S]*?}\s*_30;\s*/, "uniform mediump float _EmitMasking;\n\n");
    out = out.replaceAll("_30._m0", "_EmitMasking");
    if (/_30\._m/.test(out)) throw new Error("Frame fragment adaptation incomplete");
  } else if (port.shader === "Text_Alpha") {
    out = out.replace(/layout\(std140\) uniform _33_35[\s\S]*?}\s*_35;\s*/, [
      "uniform mediump float _AlphaThreshold;",
      "uniform highp float _Alpha;",
      "",
    ].join("\n"));
    out = out
      .replaceAll("_35._m0", "_AlphaThreshold")
      .replaceAll("_35._m1", "_Alpha");
    if (/_35\._m/.test(out)) throw new Error("Text_Alpha fragment adaptation incomplete");
  }
  return `${out.trimEnd()}\n`;
}

const outputs = {};
let sharedVertex = null;
for (const port of PORTS) {
  await withExtractedSelectorProgram({
    selectorId: port.selectorId,
    candidateWitnessId: port.candidateWitnessId,
    expectedProofGraphSha256: PROOF_GRAPH_SHA256,
    expectedPortIndexSha256: PORT_INDEX_SHA256,
    decryptedRoot: path.resolve(SHADER_ROOT, "..", ".."),
    prefix: port.prefix,
    rootDir: ROOT,
    spirvCross: SPIRV_CROSS,
  }, ({ metadata, files, reflection }) => {
    equal(metadata.selector.keywords, [], `${port.shader} selector keywords`);
    if (metadata.parameterReflectionSha256 !== port.parameterReflectionSha256) throw new Error(`${port.shader} parameter reflection changed`);
    if (metadata.artifacts.parameterEntry.byteSize !== port.parameterBytes) throw new Error(`${port.shader} parameter byte size changed`);
    assertInterface(reflection, port);

    const commonBindings = compileCommonBindings(metadata.commonBindings);
    const programBindings = compileProgramBindings(commonBindings, metadata.parameterReflection, metadata.shaderPropertyDefaults);
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
      if (set !== 0) throw new Error(`${port.shader}: WebGL sampler requires descriptor set 0`);
      return row;
    });
    equal(samplerBindings.map(({ slot, spirvName, binding }) => ({ slot, spirvName, binding })), [
      { slot: port.samplerSlot, spirvName: "_13", binding: 0 },
    ], `${port.shader} sampler binding`);

    const officialVertex = runCommand(SPIRV_CROSS, [files.vertexSpirv, "--version", "300", "--es"], { cwd: ROOT });
    const officialFragment = runCommand(SPIRV_CROSS, [files.fragmentSpirv, "--version", "300", "--es"], { cwd: ROOT });
    if (sha256(officialVertex) !== SHARED_VERTEX_CROSS_SHA256 || sha256(officialFragment) !== port.fragmentCrossSha256) {
      throw new Error(`${port.shader} complete SPIRV-Cross output changed`);
    }
    const vertex = adaptVertex(officialVertex);
    const fragment = adaptFragment(officialFragment, port);
    if (sharedVertex !== null && sharedVertex !== vertex) throw new Error("flat MRT selectors no longer share the same adapted vertex program");
    sharedVertex = vertex;

    const runtimeContract = {
      schema: "pocket-card-render/webgl-runtime-port@1",
      shader_key: port.shader,
      attributes: { position: "vec3", uv: "vec2" },
      engine_uniforms: { modelMatrix: "mat4", viewMatrix: "mat4", projectionMatrix: "mat4" },
      material_uniforms: { floats: port.materialFloats, ints: [], vectors: {} },
      require_complete_active_bindings: true,
      camera_from_view: false,
      mrt_attachments: 2,
      stencil_normalization: "disable-when-always-keep",
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
            kind: "clip-space-y-conversion",
            from: "unity-vulkan",
            to: "webgl",
            operation: "remove-y-inversion",
          },
          { kind: "glsl-version-ownership", owner: "three-raw-shader-material" },
        ],
        substitutions: [
          "replace serialized VGlobals UBO members with Three.js model/view/projection uniforms",
          "map official position and UV locations to Three.js attributes",
          "unity_ObjectToWorld := three.modelMatrix and unity_MatrixVP := three.projectionMatrix * three.viewMatrix",
          "remove Unity Vulkan clip-space Y inversion for WebGL clip space",
        ],
      },
      fragment: {
        officialSpirvSha256: sha256File(files.fragmentSpirv),
        spirvCrossGlslSha256: sha256(officialFragment),
        outputSha256: sha256(fragment),
        operations: [
          ...(["Frame", "Text_Alpha"].includes(port.shader) ? [{
            kind: "uniform-buffer-flattening",
            source: "serialized-common",
            preservation: "names-types-precision",
          }] : []),
          { kind: "glsl-version-ownership", owner: "three-raw-shader-material" },
        ],
        substitutions: port.shader === "Frame"
          ? ["replace serialized PGlobals _EmitMasking with the same-name Three.js material uniform"]
          : port.shader === "Text_Alpha"
            ? ["replace serialized PGlobals _AlphaThreshold/_Alpha with same-name Three.js material uniforms"]
            : ["remove #version directive supplied by Three.js RawShaderMaterial"],
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
    outputs[port.fragmentFile] = fragment;
    outputs[port.manifestFile] = `${JSON.stringify({
      shader: port.shader,
      generated_by: "build/build-exact-flat-mrt.mjs",
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
        vertex: "public/shaders/textured.vert.glsl",
        fragment: `public/shaders/${port.fragmentFile}`,
      },
      runtime_contract: runtimeContract,
      sampler_bindings: samplerBindings,
      samplers: samplerBindings.map((row) => row.spirvName),
      sampler_slots: samplerBindings.map((row) => row.slot),
      compiled_texture_bindings: Object.fromEntries(samplerBindings.map((row) => [row.slot, row.binding])),
      implicit_defaults: metadata.shaderPropertyDefaults.textures,
      mrt: {
        primary: port.fragmentOutputs[0],
        emissive: port.fragmentOutputs[1],
        ...(port.emissiveValue ? { emissive_value: port.emissiveValue } : {}),
        ...(port.secondaryValue ? { secondary_value: port.secondaryValue } : {}),
      },
    }, null, 2)}\n`;
  });
}
outputs["textured.vert.glsl"] = sharedVertex;
writeOrCheckOutputs(outputs, { outDir: OUT, check: CHECK });
console.log(`${CHECK ? "verified" : "generated"} selector-owned flat MRT WebGL2 ports`);
