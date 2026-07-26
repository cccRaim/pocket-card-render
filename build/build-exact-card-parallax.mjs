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
const PROOF_GRAPH_SHA256 = "9862f63e11f359ed3b92b0191d21a2b6520de5a37159fd14612bdaf1908396b0";
const PORT_INDEX_SHA256 = "30bc4d0eab1c1ad82147e880c642cbd8fba6d55cbd2227c2aa78f082f14e7e3f";
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

function rows(items = []) {
  return items.map(({ name, type, location }) => ({ name, type, location }))
    .sort((left, right) => left.location - right.location);
}

function assertReflection(reflection) {
  const vertexUbo = reflection.vertex.ubos?.find((item) => item.name === "_21_23");
  assert.deepEqual({ name: vertexUbo?.name, size: vertexUbo?.block_size }, { name: "_21_23", size: 228 });
  assert.deepEqual(rows(reflection.vertex.inputs), [
    { name: "_11", type: "vec4", location: 0 },
    { name: "_86", type: "vec3", location: 1 },
    { name: "_302", type: "vec2", location: 2 },
    { name: "_305", type: "vec2", location: 3 },
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

function adaptFragment(source) {
  return `${source.replace(/^#version 300 es\s*/m, "").trimEnd()}\n`;
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
