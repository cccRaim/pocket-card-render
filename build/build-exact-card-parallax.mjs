#!/usr/bin/env node
// Generate the square Card_Parallax executable and every official selector route that resolves to it.
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  canonicalJsonSha256,
  compileCommonBindings,
  compileOfficialPassContract,
  compileOfficialVertexInputContract,
  compileProgramBindings,
  generateExactSelectorPort,
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
const OFFICIAL_CROSS_SHA256 = {
  vertex: "551ab90c5d9366750ea80f4dbbf0660e09792ebf7f18973d5af4fb5293c04819",
  fragment: "4cbf02d28d1addd46503135c2f84c02cfefd09bb2f3836edc9e34113727e9a91",
};
const PASS_POLICY = {
  rtSeparateBlend: false,
  fixed: {
    zClip: { val: 1, name: null }, conservative: { val: 0, name: null },
    offsetFactor: { val: 0, name: null }, offsetUnits: { val: 0, name: null },
    alphaToMask: { val: 0, name: null }, fogMode: -1, lighting: false,
  },
};
const ROUTES = [
  {
    label: "square-keyword",
    manifest: "card_parallax_uniforms.json",
    selectorId: "4416645d0bbeb3d037161525bdcf9aa7ed9e6b39e284c6ed446f09184b38532f",
    candidateWitnessId: "1b99ea91f2aa85c39a767541b7ef357ea17cbd033621c8838871287c203b32ca",
    keywords: ["_UVASPECTRATIO_SQUARE"],
    selectionMode: "unique-exact-keywords",
  },
  {
    label: "native-best-match",
    manifest: "card_parallax_native_best_match_uniforms.json",
    selectorId: "d1f5735783c69fe7649331c186b7a648ec31301d22a3d22ab114c52dc95b2564",
    candidateWitnessId: "74c7535cdb853b56d91c7d18b5277230914ce3ea0753a1a706c8da396f76b0a3",
    keywords: [],
    selectionMode: "native-best-match",
  },
];
const ASPECT_ROUTES = [
  {
    label: "cardfull",
    stem: "card_parallax_cardfull",
    selectorId: "6b15110734185fce59434bc48692e2daa7801971bf0065926698b465b50c1977",
    candidateWitnessId: "19669c42522870127be07386867e0bafdad85de90bb4bed22c2e7ebb825bd9c8",
    keywords: ["_UVASPECTRATIO_CARDFULL"],
    semanticExecutableId: "0199e33d4455672e88c1d0e28386e2d72997d4bcacd4a9f16e7a4690f0c6894c",
    identityFields: {
      vertexSpirvSha256: "ebe94ecc8ab07e37a6cd4aab5ed6619f4ce6f3b0345f0b1cfabdb80afd957e45",
      fragmentSpirvSha256: "8abeb695827f66cb4bac40b2923d726b4c230e3c6137526a4bde1cbfd57a7ab9",
      parameterEntrySha256: "8f93f75ca4ec5a5319fca1777937561fdeffa6883a8a02fac806ef3098f8361a",
      passStateSha256: "7273e155eb5417e8a81cf4606b2ab2e7dfac68f2d2ab7f67307e016bcde7d9f6",
      commonBindingsSha256: "3ebda9f44bdf3c693cfbf91fc1e1c9e5334d70590e7a32f19300fddf198b3df4",
    },
    parameterReflectionSha256: "f03028b0857fc743e624f09c72c354900281f78c80c22ad081dde6b96af2e27c",
    crossSha256: {
      vertex: "0cea8557c1a9d0c6fabd1165af994650fb37b24e369be4fe1cfb18f3854c4635",
      fragment: "4cbf02d28d1addd46503135c2f84c02cfefd09bb2f3836edc9e34113727e9a91",
    },
  },
  {
    label: "cardwindow",
    stem: "card_parallax_cardwindow",
    selectorId: "4eddbe42b3aad7a33c0087927e44803a97149e772bbec502e662d535be411cf9",
    candidateWitnessId: "1ba398f45b0a88917674e37de90dd40d651898abbfc0e1300491339d921b7fb5",
    keywords: ["_UVASPECTRATIO_CARDWINDOW"],
    semanticExecutableId: "55b01cac0ca4e1398f0ff5026cbb8d9f1607a15ca76c928460f186db7d43462e",
    identityFields: {
      vertexSpirvSha256: "00901fd3b737d0f90dc8ff5cd311fcdebf6eae786c8c44ed8e9185b64355682b",
      fragmentSpirvSha256: "8abeb695827f66cb4bac40b2923d726b4c230e3c6137526a4bde1cbfd57a7ab9",
      parameterEntrySha256: "12b952c6a54cfef852e27f5ca96f12783265418bd55715ac2804debedfd4e66b",
      passStateSha256: "7273e155eb5417e8a81cf4606b2ab2e7dfac68f2d2ab7f67307e016bcde7d9f6",
      commonBindingsSha256: "3ebda9f44bdf3c693cfbf91fc1e1c9e5334d70590e7a32f19300fddf198b3df4",
    },
    parameterReflectionSha256: "b58c5afc5a22c62499c5277061fb80d38d78253259ad2a68506c56cb1987738b",
    crossSha256: {
      vertex: "b364e95cd20316fcc7dcfef9edc0ca8510429e9337292bbde225e5f445635475",
      fragment: "4cbf02d28d1addd46503135c2f84c02cfefd09bb2f3836edc9e34113727e9a91",
    },
  },
];

function rows(items = []) {
  return items.map(({ name, type, location }) => ({ name, type, location }))
    .sort((left, right) => left.location - right.location);
}

function assertReflection(reflection, uvName = "_302", uv1Name = "_305") {
  const vertexUbo = reflection.vertex.ubos?.find((item) => item.name === "_21_23");
  assert.deepEqual({ name: vertexUbo?.name, size: vertexUbo?.block_size }, { name: "_21_23", size: 228 });
  assert.deepEqual(rows(reflection.vertex.inputs), [
    { name: "_11", type: "vec4", location: 0 },
    { name: "_86", type: "vec3", location: 1 },
    { name: uvName, type: "vec2", location: 2 },
    { name: uv1Name, type: "vec2", location: 3 },
    { name: "_106", type: "vec4", location: 4 },
  ]);
  assert.deepEqual(rows(reflection.vertex.outputs), [{ name: "vs_TEXCOORD0", type: "vec2", location: 0 }]);
  assert.deepEqual(rows(reflection.fragment.inputs), [{ name: "vs_TEXCOORD0", type: "vec2", location: 0 }]);
  assert.deepEqual(rows(reflection.fragment.outputs), [
    { name: "_29", type: "vec4", location: 0 },
    { name: "_40", type: "vec4", location: 1 },
  ]);
  assert.deepEqual((reflection.fragment.textures || [])
    .map(({ name, type, set, binding }) => ({ name, type, set, binding })), [
    { name: "_13", type: "sampler2D", set: 0, binding: 0 },
  ]);
}

function adaptVertex(source) {
  let output = source.replace(/^#version 300 es\s*/m, "precision highp float;\nprecision highp int;\n\n");
  output = output.replace(/layout\(std140\) uniform _21_23[\s\S]*?}\s*_23;\s*/, [
    "uniform highp mat4 modelMatrix;",
    "uniform highp mat4 viewMatrix;",
    "uniform highp mat4 projectionMatrix;",
    "uniform highp vec3 cameraPosition;",
    "uniform highp float _FakeCameraHeight;",
    "uniform highp float _Height;",
    "uniform highp float _HeightPower;",
    "uniform highp float _Scale;",
    "uniform int _UseUv;",
    "",
  ].join("\n"));
  output = output
    .replace("layout(location = 0) in vec4 _11;", "in vec3 position;")
    .replace("layout(location = 1) in vec3 _86;", "in vec3 normal;")
    .replace("layout(location = 4) in mediump vec4 _106;", "in vec4 tangent;")
    .replace("layout(location = 2) in vec2 _302;", "in vec2 uv;")
    .replace("layout(location = 3) in vec2 _305;", "in vec2 uv1;")
    .replace(/void main\(\)\s*\{/, `void main()
{
    vec4 _11 = vec4(position, 1.0);
    vec3 _86 = normal;
    vec4 _106 = tangent;
    vec2 _302 = uv;
    vec2 _305 = uv1;
    mat4 _WorldToObject = inverse(modelMatrix);
    mat4 _ViewProjection = projectionMatrix * viewMatrix;`)
    .replaceAll("_23._m0", "cameraPosition")
    .replaceAll("_23._m1", "modelMatrix")
    .replaceAll("_23._m2", "_WorldToObject")
    .replaceAll("_23._m3", "_ViewProjection")
    .replaceAll("_23._m4", "_FakeCameraHeight")
    .replaceAll("_23._m5", "_Height")
    .replaceAll("_23._m6", "_HeightPower")
    .replaceAll("_23._m7", "_Scale")
    .replaceAll("_23._m8", "_UseUv")
    .replace(/^\s*gl_Position\.y\s*=\s*-gl_Position\.y;\s*$/m, "");
  if (/_23\._m|uniform _21_23|gl_Position\.y\s*=\s*-gl_Position\.y/.test(output)) {
    throw new Error("Card_Parallax vertex adaptation is incomplete");
  }
  return `${output.trimEnd()}\n`;
}

function adaptAspectVertex(source) {
  let output = source.replace(/^#version 300 es\s*/m, "precision highp float;\nprecision highp int;\n\n");
  output = output.replace(/layout\(std140\) uniform _21_23[\s\S]*?}\s*_23;\s*/, [
    "uniform highp mat4 modelMatrix;",
    "uniform highp mat4 viewMatrix;",
    "uniform highp mat4 projectionMatrix;",
    "uniform highp vec3 cameraPosition;",
    "uniform mediump float _FakeCameraHeight;",
    "uniform mediump float _Height;",
    "uniform mediump float _HeightPower;",
    "uniform mediump float _Scale;",
    "uniform int _UseUv;",
    "",
  ].join("\n"));
  output = output
    .replace("layout(location = 0) in vec4 _11;", "in vec3 position;")
    .replace("layout(location = 1) in vec3 _86;", "in vec3 normal;")
    .replace("layout(location = 4) in mediump vec4 _106;", "in mediump vec4 tangent;")
    .replace("layout(location = 2) in vec2 _307;", "in vec2 uv;")
    .replace("layout(location = 3) in vec2 _310;", "in vec2 uv1;")
    .replace(/void main\(\)\s*\{/, `void main()
{
    vec4 _11 = vec4(position, 1.0);
    vec3 _86 = normal;
    mediump vec4 _106 = tangent;
    vec2 _307 = uv;
    vec2 _310 = uv1;
    mat4 _WorldToObject = inverse(modelMatrix);
    mat4 _ViewProjection = projectionMatrix * viewMatrix;`)
    .replaceAll("_23._m0", "cameraPosition")
    .replaceAll("_23._m1", "modelMatrix")
    .replaceAll("_23._m2", "_WorldToObject")
    .replaceAll("_23._m3", "_ViewProjection")
    .replaceAll("_23._m4", "_FakeCameraHeight")
    .replaceAll("_23._m5", "_Height")
    .replaceAll("_23._m6", "_HeightPower")
    .replaceAll("_23._m7", "_Scale")
    .replaceAll("_23._m8", "_UseUv")
    .replace(/^\s*gl_Position\.y\s*=\s*-gl_Position\.y;\s*$/m, "");
  if (
    /_23\._m|uniform _21_23|layout\(location\s*=\s*\d+\)\s+in|gl_Position\.y\s*=\s*-gl_Position\.y/
      .test(output)
  ) {
    throw new Error("Card_Parallax aspect vertex adaptation is incomplete");
  }
  return `${output.trimEnd()}\n`;
}

function adaptFragment(source) {
  return `${source.replace(/^#version 300 es\s*/m, "").trimEnd()}\n`;
}

function adaptEmitMaskFragment(source) {
  let output = adaptFragment(source);
  output = output.replace(
    /layout\(std140\) uniform _43_45\s*\{[\s\S]*?}\s*_45;\s*/,
    "uniform highp float _EmitMasking;\n\n",
  );
  output = output.replaceAll("_45._m0", "_EmitMasking");
  if (/uniform _43_45|_45\._m0/.test(output)
      || !/uniform highp float _EmitMasking;/.test(output)) {
    throw new Error("Card_Parallax_EmitMask fragment adaptation is incomplete");
  }
  return `${output.trimEnd()}\n`;
}

function buildManifest(
  metadata,
  commonBindings,
  manifestProgramBindings,
  vertexInputContract,
  samplerBindings,
  adaptation,
  runtimeContract,
) {
  return {
    shader: "Lettuce/Common/CardNew/Face/Card_Parallax",
    generated_by: "build/build-exact-card-parallax.mjs",
    selected_keywords: metadata.selector.keywords,
    official_selector: metadata.selector,
    official_spirv_sha256: {
      vertex: metadata.identityFields.vertexSpirvSha256,
      fragment: metadata.identityFields.fragmentSpirvSha256,
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
    official_common_bindings: { source_sha256: metadata.identityFields.commonBindingsSha256, ...commonBindings },
    official_program_bindings: manifestProgramBindings,
    official_vertex_inputs: vertexInputContract,
    official_shader_property_defaults: metadata.shaderPropertyDefaults,
    webgl_adaptation: adaptation,
    webgl_sources: {
      vertex: "public/shaders/card_parallax.vert.glsl",
      fragment: "public/shaders/card_parallax.frag.glsl",
    },
    runtime_contract: runtimeContract,
    sampler_bindings: samplerBindings,
    samplers: samplerBindings.map((row) => row.spirvName),
    sampler_slots: samplerBindings.map((row) => row.slot),
    compiled_texture_bindings: Object.fromEntries(samplerBindings.map((row) => [row.slot, row.binding])),
    implicit_defaults: metadata.shaderPropertyDefaults.textures,
    floats: {
      _FakeCameraHeight: "_FakeCameraHeight",
      _Height: "_Height",
      _HeightPower: "_HeightPower",
      _Scale: "_Scale",
      _UseUv: "_UseUv",
    },
    mrt: { primary: "_29", emissive: "_40" },
  };
}

const outputs = {};
let canonical = null;
for (const route of ROUTES) {
  await withExtractedSelectorProgram({
    selectorId: route.selectorId,
    candidateWitnessId: route.candidateWitnessId,
    expectedProofGraphSha256: PROOF_GRAPH_SHA256,
    expectedPortIndexSha256: PORT_INDEX_SHA256,
    decryptedRoot: path.resolve(SHADER_ROOT, "..", ".."),
    prefix: `card-parallax-${route.label}`,
    rootDir: ROOT,
    spirvCross: SPIRV_CROSS,
  }, ({ metadata, files, reflection }) => {
    assert.deepEqual(metadata.selector.keywords, route.keywords, `${route.label} keywords`);
    assert.equal(metadata.selector.selectionMode, route.selectionMode, `${route.label} selection mode`);
    assert.equal(metadata.selector.semanticExecutableId, "32dfa05ae21b0e3ccad22ae21a58fd5d46af1cc684fffc5758f624550d05513e");
    assert.equal(metadata.parameterReflectionSha256, "4a100fa723aa7138a85187aa73ad4b786a72614cbe6a63dbd2f64804a2dddd39");
    assert.equal(metadata.artifacts.parameterEntry.byteSize, 484);
    assertReflection(reflection);

    const officialVertex = runCommand(SPIRV_CROSS, [files.vertexSpirv, "--version", "300", "--es"], { cwd: ROOT });
    const officialFragment = runCommand(SPIRV_CROSS, [files.fragmentSpirv, "--version", "300", "--es"], { cwd: ROOT });
    assert.equal(sha256(officialVertex), OFFICIAL_CROSS_SHA256.vertex);
    assert.equal(sha256(officialFragment), OFFICIAL_CROSS_SHA256.fragment);
    const vertex = adaptVertex(officialVertex);
    const fragment = adaptFragment(officialFragment);
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
      reflection.vertex,
    );
    const samplerBindings = joinProgramSamplerBindings(programBindings, reflection).map(({ set, ...row }) => {
      assert.equal(set, 0, "Card_Parallax sampler must use descriptor set 0");
      return row;
    });
    assert.deepEqual(samplerBindings.map(({ slot, spirvName, binding }) => ({ slot, spirvName, binding })), [
      { slot: "_MainTex", spirvName: "_13", binding: 0 },
    ]);
    const runtimeContract = {
      schema: "pocket-card-render/webgl-runtime-port@1",
      shader_key: "Card_Parallax",
      attributes: { position: "vec3", normal: "vec3", tangent: "vec4", uv: "vec2", uv1: "vec2" },
      engine_uniforms: {
        modelMatrix: "mat4", viewMatrix: "mat4", projectionMatrix: "mat4", cameraPosition: "vec3",
      },
      material_uniforms: {
        floats: ["_FakeCameraHeight", "_Height", "_HeightPower", "_Scale"],
        ints: ["_UseUv"],
        vectors: {},
      },
      require_complete_active_bindings: true,
      camera_from_view: true,
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
            kind: "clip-space-y-conversion",
            from: "unity-vulkan",
            to: "webgl",
            operation: "remove-y-inversion",
          },
          { kind: "glsl-version-ownership", owner: "three-raw-shader-material" },
        ],
        substitutions: [
          "map official position/normal/UV0/UV1/tangent locations to Three.js attributes",
          "map Unity object/world/view-projection matrices and camera position to Three.js engine uniforms",
          "remove Unity Vulkan clip-space Y inversion for WebGL clip space",
        ],
      },
      fragment: {
        officialSpirvSha256: sha256File(files.fragmentSpirv),
        spirvCrossGlslSha256: sha256(officialFragment),
        outputSha256: sha256(fragment),
        operations: [
          { kind: "glsl-version-ownership", owner: "three-raw-shader-material" },
        ],
        substitutions: ["remove the embedded GLSL version directive for Three.js RawShaderMaterial injection"],
      },
      interfaceSha256: canonicalJsonSha256({ vertex: reflection.vertex, fragment: reflection.fragment }),
      officialVertexInputs: vertexInputContract,
      runtimeContract,
      officialProgramBindings: manifestProgramBindings,
    });
    const stageIdentity = { vertex, fragment, adaptation };
    if (canonical === null) canonical = stageIdentity;
    else assert.deepEqual(stageIdentity, canonical, "Card_Parallax selector routes must share one WebGL executable");
    outputs[route.manifest] = `${JSON.stringify(buildManifest(
      metadata,
      commonBindings,
      manifestProgramBindings,
      vertexInputContract,
      samplerBindings,
      adaptation,
      runtimeContract,
    ), null, 2)}\n`;
  });
}

outputs["card_parallax.vert.glsl"] = canonical.vertex;
outputs["card_parallax.frag.glsl"] = canonical.fragment;
writeOrCheckOutputs(outputs, { outDir: OUT, check: CHECK });
console.log(`${CHECK ? "verified" : "generated"} Card_Parallax executable with ${ROUTES.length} official selector routes`);

const aspectRuntimeContract = {
  schema: "pocket-card-render/webgl-runtime-port@1",
  shader_key: "Card_Parallax",
  attributes: { position: "vec3", normal: "vec3", tangent: "vec4", uv: "vec2", uv1: "vec2" },
  engine_uniforms: {
    modelMatrix: "mat4", viewMatrix: "mat4", projectionMatrix: "mat4", cameraPosition: "vec3",
  },
  material_uniforms: {
    floats: ["_FakeCameraHeight", "_Height", "_HeightPower", "_Scale"],
    ints: ["_UseUv"],
    vectors: {},
  },
  require_complete_active_bindings: true,
  camera_from_view: true,
  mrt_attachments: 2,
  stencil_normalization: "none",
  stencil_face_mode: "generic",
};

for (const route of ASPECT_ROUTES) {
  const result = await generateExactSelectorPort({
    shader: "Lettuce/Common/CardNew/Face/Card_Parallax",
    generatedBy: "build/build-exact-card-parallax.mjs",
    extraction: {
      selectorId: route.selectorId,
      candidateWitnessId: route.candidateWitnessId,
      expectedProofGraphSha256: PROOF_GRAPH_SHA256,
      expectedPortIndexSha256: PORT_INDEX_SHA256,
      decryptedRoot: path.resolve(SHADER_ROOT, "..", ".."),
      prefix: route.stem,
      rootDir: ROOT,
      spirvCross: SPIRV_CROSS,
    },
    output: {
      outDir: OUT,
      vertex: `${route.stem}.vert.glsl`,
      fragment: `${route.stem}.frag.glsl`,
      manifest: `${route.stem}_uniforms.json`,
      check: CHECK,
    },
    expectedSpirvCrossSha256: route.crossSha256,
    validateReflection(reflection, metadata) {
      assert.deepEqual(metadata.selector.keywords, route.keywords, `${route.label}: keywords`);
      assert.equal(metadata.selector.selectionMode, "unique-exact-keywords", `${route.label}: selection mode`);
      assert.equal(
        metadata.selector.semanticExecutableId,
        route.semanticExecutableId,
        `${route.label}: semantic executable`,
      );
      assert.deepEqual(metadata.identityFields, route.identityFields, `${route.label}: executable identity`);
      assert.equal(metadata.artifacts.parameterEntry.byteSize, 484, `${route.label}: parameter byte size`);
      assert.equal(
        metadata.parameterReflectionSha256,
        route.parameterReflectionSha256,
        `${route.label}: parameter reflection`,
      );
      assertReflection(reflection, "_307", "_310");
    },
    adaptVertex: adaptAspectVertex,
    adaptFragment,
    joinConstantBufferStages: true,
    passPolicy: PASS_POLICY,
    runtimeContract: aspectRuntimeContract,
    substitutions: {
      vertex: [
        "map official position/normal/UV0/UV1/tangent locations to Three.js attributes",
        "map Unity object/world/view-projection matrices and camera position to Three.js engine uniforms",
        "flatten the official variant-local VGlobals block while preserving member types and precision",
        "remove Unity Vulkan clip-space Y inversion for WebGL clip space",
      ],
      fragment: [
        "remove the embedded GLSL version directive for Three.js RawShaderMaterial injection",
      ],
    },
    adaptationOperations: {
      vertex: [
        { kind: "vertex-input-binding", contract: "official-bind-channels-to-three-r165" },
        { kind: "engine-uniform-binding", contract: "unity-builtins-to-three-r165" },
        {
          kind: "uniform-buffer-flattening",
          source: "variant-local",
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
      fragment: [
        { kind: "glsl-version-ownership", owner: "three-raw-shader-material" },
      ],
    },
    webglSources: {
      vertex: `public/shaders/${route.stem}.vert.glsl`,
      fragment: `public/shaders/${route.stem}.frag.glsl`,
    },
    manifestExtras: {
      floats: {
        _FakeCameraHeight: "_FakeCameraHeight",
        _Height: "_Height",
        _HeightPower: "_HeightPower",
        _Scale: "_Scale",
        _UseUv: "_UseUv",
      },
      mrt: { primary: "_29", emissive: "_40" },
    },
  });
  assert.deepEqual(
    result.samplerBindings.map(({ slot, spirvName, binding }) => ({ slot, spirvName, binding })),
    [{ slot: "_MainTex", spirvName: "_13", binding: 0 }],
    `${route.label}: active sampler bindings`,
  );
}
console.log(`${CHECK ? "verified" : "generated"} ${ASPECT_ROUTES.length} Card_Parallax aspect selectors`);

const emitMaskRuntimeContract = {
  schema: "pocket-card-render/webgl-runtime-port@1",
  shader_key: "Card_Parallax_EmitMask",
  attributes: { position: "vec3", normal: "vec3", tangent: "vec4", uv: "vec2", uv1: "vec2" },
  engine_uniforms: {
    modelMatrix: "mat4", viewMatrix: "mat4", projectionMatrix: "mat4", cameraPosition: "vec3",
  },
  material_uniforms: {
    floats: ["_FakeCameraHeight", "_Height", "_HeightPower", "_Scale", "_EmitMasking"],
    ints: ["_UseUv"],
    vectors: {},
  },
  require_complete_active_bindings: true,
  camera_from_view: true,
  mrt_attachments: 2,
  stencil_normalization: "none",
  stencil_face_mode: "generic",
};

const emitMaskResult = await generateExactSelectorPort({
  shader: "Card_Parallax_EmitMask",
  generatedBy: "build/build-exact-card-parallax.mjs",
  extraction: {
    selectorId: "5086e6fa4eca3e1e047f50850e5baf5109dffc922add1f24fe5e8cc7b92b5e49",
    candidateWitnessId: "b02b9ed09442f20e455c6cca4c49efbf7d1f1bf5cb38269276833849654d5ec2",
    expectedProofGraphSha256: PROOF_GRAPH_SHA256,
    expectedPortIndexSha256: PORT_INDEX_SHA256,
    decryptedRoot: path.resolve(SHADER_ROOT, "..", ".."),
    prefix: "card-parallax-emit-mask",
    rootDir: ROOT,
  },
  output: {
    outDir: OUT,
    vertex: "card_parallax_emit_mask.vert.glsl",
    fragment: "card_parallax_emit_mask.frag.glsl",
    manifest: "card_parallax_emit_mask_uniforms.json",
    check: CHECK,
  },
  expectedSpirvCrossSha256: {
    vertex: OFFICIAL_CROSS_SHA256.vertex,
    fragment: "39ddbb7abbd6a22c6fe4c7a2215c0e5134068eca3504ab9f31fdf7c65b16aecb",
  },
  validateReflection(reflection, metadata) {
    assert.deepEqual(metadata.selector.keywords, []);
    assert.equal(
      metadata.selector.semanticExecutableId,
      "c866b41a88b312dddbd15681a4b46dd1b818b9e9d832a847f7cf38f5fb00ec1a",
    );
    assert.equal(
      metadata.parameterReflectionSha256,
      "a306de8a2ec107d8a167353b6d6b07d17c0894dd243fd57f582f6ccca8afe808",
    );
    assert.equal(metadata.artifacts.parameterEntry.byteSize, 100);
    assertReflection(reflection);
  },
  adaptVertex,
  adaptFragment: adaptEmitMaskFragment,
  joinConstantBufferStages: true,
  passPolicy: PASS_POLICY,
  runtimeContract: emitMaskRuntimeContract,
  substitutions: {
    vertex: [
      "map official position/normal/UV0/UV1/tangent locations to Three.js attributes",
      "map Unity object/world/view-projection matrices and camera position to Three.js engine uniforms",
      "remove Unity Vulkan clip-space Y inversion for WebGL clip space",
    ],
    fragment: [
      "flatten the official _EmitMasking PGlobals member to a typed material uniform",
      "preserve the official alpha-only MRT1 emission mask",
    ],
  },
  adaptationOperations: {
    vertex: [
      { kind: "vertex-input-binding", contract: "official-bind-channels-to-three-r165" },
      { kind: "engine-uniform-binding", contract: "unity-builtins-to-three-r165" },
      { kind: "uniform-buffer-flattening", source: "serialized-common", preservation: "names-types-precision" },
      { kind: "clip-space-y-conversion", from: "unity-vulkan", to: "webgl", operation: "remove-y-inversion" },
      { kind: "glsl-version-ownership", owner: "three-raw-shader-material" },
    ],
    fragment: [
      { kind: "uniform-buffer-flattening", source: "serialized-common", preservation: "names-types-precision" },
      { kind: "glsl-version-ownership", owner: "three-raw-shader-material" },
    ],
  },
  webglSources: {
    vertex: "public/shaders/card_parallax_emit_mask.vert.glsl",
    fragment: "public/shaders/card_parallax_emit_mask.frag.glsl",
  },
  manifestExtras: {
    mrt: {
      primary: "_29",
      emissive: "_40",
      emissive_value: "alpha-only",
      emissive_switch: "_EmitMasking",
    },
  },
});
assert.deepEqual(
  emitMaskResult.samplerBindings.map(({ slot }) => slot),
  ["_MainTex"],
  "Card_Parallax_EmitMask active sampler slots changed",
);
console.log(`${CHECK ? "verified" : "generated"} Card_Parallax_EmitMask`);
