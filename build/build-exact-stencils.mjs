#!/usr/bin/env node
// Generate the flat card UI/stencil family from exact official selectors. These programs share the
// same position/UV vertex stage; each selector retains its own fragment, pass and binding identity.
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
    key: "OuterStencil",
    prefix: "outer_stencil",
    shader: "Lettuce/Common/CardNew/Stencil/OuterStencil",
    selectorId: "8baacfbd517a97322703ddfdab20a15dae73453c4baa153385b2695a4ce625a6",
    candidateWitnessId: "4a0cf7cebd7dc612eef656e06aa617035040e318cbb38eaf271077055895a2e1",
    parameterReflectionSha256: "1b47e46c8929ba65eaa9ec522730d75552fc03fca78982d8827c9644e0dcc552",
    parameterByteSize: 64,
    crossSha256: {
      vertex: "0b8509c4346e78086b844e94bd21b80258bfcc91289477d2fa56e82407400824",
      fragment: "875eabe94d2299583df8385d4fc5dfcc45a68cca963bdd0f18d13545d75ab822",
    },
    uv: false,
    sampler: null,
    floats: [],
    fragmentUbo: null,
    outputs: [{ name: "_9", type: "vec4", location: 0 }],
  },
  {
    key: "InnerStencil",
    prefix: "inner_stencil",
    shader: "Lettuce/Common/CardNew/Stencil/InnerStencil",
    selectorId: "dab7a400138dbfa74ef7b3bb8d280be4bb7fe03c2fd4aec8fdd3159eb2f030ee",
    candidateWitnessId: "4c4a34e681b1c401c4d962bb779227c27ce5cf711733e92cd5cd80a4d155be59",
    parameterReflectionSha256: "83aa161be89525b6cea3e0a6ac20d2a31f02ddc8801eb700a9094a29bf3a58b8",
    parameterByteSize: 100,
    crossSha256: {
      vertex: "b58c6793bd83439bc7dacfceef7c95e76d417e0359885f1a4dabb93338ebc38c",
      fragment: "e53121760f6b6bfd105dd1c71f6a3ccc24696d86f541d0403127ad43045cd247",
    },
    uv: true,
    sampler: { slot: "_BaseTex", spirvName: "_12", binding: 0 },
    floats: ["_AlphaThreshold"],
    fragmentUbo: { block: "_27_29", instance: "_29" },
    outputs: [{ name: "_46", type: "vec4", location: 0 }],
  },
  {
    key: "IllustStencil",
    prefix: "illust_stencil",
    shader: "Lettuce/Common/CardNew/Stencil/IllustStencil",
    selectorId: "f953cc26992425f821a93cc76e31fe72136496d658a2968d988d776c922794b7",
    candidateWitnessId: "4f8e66161c8b9c6d0543632c802b39543a42248956b13f13cc1552f5d1ad5b0a",
    parameterReflectionSha256: "83aa161be89525b6cea3e0a6ac20d2a31f02ddc8801eb700a9094a29bf3a58b8",
    parameterByteSize: 100,
    crossSha256: {
      vertex: "b58c6793bd83439bc7dacfceef7c95e76d417e0359885f1a4dabb93338ebc38c",
      fragment: "e53121760f6b6bfd105dd1c71f6a3ccc24696d86f541d0403127ad43045cd247",
    },
    uv: true,
    sampler: { slot: "_BaseTex", spirvName: "_12", binding: 0 },
    floats: ["_AlphaThreshold"],
    fragmentUbo: { block: "_27_29", instance: "_29" },
    outputs: [{ name: "_46", type: "vec4", location: 0 }],
  },
  {
    key: "Text",
    prefix: "dynamic_ui_text",
    shader: "Lettuce/Common/CardNew/Text",
    selectorId: "32560a48adec5d08001f64750c1751d6e1fe95b84346c4907463cbaa2f1e2b1a",
    candidateWitnessId: "ec3e0937fa970e386e2448efcfa054aa00784019d0cf300568f4173a4b4254cf",
    parameterReflectionSha256: "3041ae1261e6054c367be1e8129f661e1343bddce6bb83f9f429d4262b64ee7e",
    parameterByteSize: 100,
    crossSha256: {
      vertex: "b58c6793bd83439bc7dacfceef7c95e76d417e0359885f1a4dabb93338ebc38c",
      fragment: "0811f250635474de7347241f06e9525a4677cab8b3790e73fa3332adddbdb48d",
    },
    uv: true,
    sampler: { slot: "_DynamicUITex", spirvName: "_13", binding: 0 },
    floats: ["_AlphaThreshold", "_EmitMasking"],
    fragmentUbo: { block: "_33_35", instance: "_35" },
    outputs: [
      { name: "_58", type: "vec4", location: 0 },
      { name: "_74", type: "vec4", location: 1 },
    ],
  },
];

function rows(items = []) {
  return items.map(({ name, type, location }) => ({ name, type, location }))
    .sort((left, right) => left.location - right.location);
}

function assertReflection(spec, reflection) {
  const vertexUbo = reflection.vertex.ubos?.find((item) => item.name === "_18_20");
  assert.deepEqual(
    { name: vertexUbo?.name, size: vertexUbo?.block_size },
    { name: "_18_20", size: 128 },
    `${spec.key} vertex UBO`,
  );
  assert.deepEqual(rows(reflection.vertex.inputs), spec.uv
    ? [{ name: "_11", type: "vec4", location: 0 }, { name: "_87", type: "vec2", location: 1 }]
    : [{ name: "_11", type: "vec4", location: 0 }], `${spec.key} vertex inputs`);
  assert.deepEqual(rows(reflection.vertex.outputs), spec.uv
    ? [{ name: "vs_TEXCOORD0", type: "vec2", location: 0 }]
    : [], `${spec.key} vertex outputs`);
  assert.deepEqual(rows(reflection.fragment.inputs), spec.uv
    ? [{ name: "vs_TEXCOORD0", type: "vec2", location: 0 }]
    : [], `${spec.key} fragment inputs`);
  assert.deepEqual(rows(reflection.fragment.outputs), spec.outputs, `${spec.key} fragment outputs`);
  assert.deepEqual((reflection.fragment.textures || [])
    .map(({ name, type, set, binding }) => ({ name, type, set, binding })), spec.sampler
    ? [{ name: spec.sampler.spirvName, type: "sampler2D", set: 0, binding: spec.sampler.binding }]
    : [], `${spec.key} fragment samplers`);
}

function adaptVertex(source, spec) {
  let output = source.replace(/^#version 300 es\s*/m, "precision highp float;\nprecision highp int;\n\n");
  output = output.replace(/layout\(std140\) uniform _18_20[\s\S]*?}\s*_20;\s*/, [
    "uniform highp mat4 modelMatrix;",
    "uniform highp mat4 viewMatrix;",
    "uniform highp mat4 projectionMatrix;",
    "",
  ].join("\n"));
  output = output.replace("layout(location = 0) in vec4 _11;", "in vec3 position;");
  if (spec.uv) output = output.replace("layout(location = 1) in vec2 _87;", "in vec2 uv;");
  output = output
    .replace(/void main\(\)\s*\{/, `void main()
{
    vec4 _11 = vec4(position, 1.0);
    mat4 _ObjectToWorld = modelMatrix;
    mat4 _ViewProjection = projectionMatrix * viewMatrix;${spec.uv ? "\n    vec2 _87 = uv;" : ""}`)
    .replaceAll("_20._m0", "_ObjectToWorld")
    .replaceAll("_20._m1", "_ViewProjection")
    .replace(/^\s*gl_Position\.y\s*=\s*-gl_Position\.y;\s*$/m, "");
  if (/_20\._m|gl_Position\.y\s*=\s*-gl_Position\.y/.test(output)) {
    throw new Error(`${spec.key} vertex adaptation is incomplete`);
  }
  return `${output.trimEnd()}\n`;
}

function adaptFragment(source, spec) {
  let output = source.replace(/^#version 300 es\s*/m, "");
  if (spec.fragmentUbo) {
    const { block, instance } = spec.fragmentUbo;
    const uniforms = spec.floats.map((name) => `uniform highp float ${name};`).join("\n");
    output = output
      .replace(new RegExp(`layout\\(std140\\) uniform ${block}[\\s\\S]*?}\\s*${instance};\\s*`), `${uniforms}\n\n`);
    spec.floats.forEach((name, index) => {
      output = output.replaceAll(`${instance}._m${index}`, name);
    });
    if (output.includes(`${instance}._m`) || output.includes(`uniform ${block}`)) {
      throw new Error(`${spec.key} fragment adaptation is incomplete`);
    }
  }
  return `${output.trimEnd()}\n`;
}

for (const spec of PORTS) {
  await withExtractedSelectorProgram({
    selectorId: spec.selectorId,
    candidateWitnessId: spec.candidateWitnessId,
    expectedProofGraphSha256: PROOF_GRAPH_SHA256,
    expectedPortIndexSha256: PORT_INDEX_SHA256,
    decryptedRoot: path.resolve(SHADER_ROOT, "..", ".."),
    prefix: spec.prefix,
    rootDir: ROOT,
    spirvCross: SPIRV_CROSS,
  }, ({ metadata, files, reflection }) => {
    assert.deepEqual(metadata.selector.keywords, [], `${spec.key} selector keywords`);
    assert.equal(metadata.parameterReflectionSha256, spec.parameterReflectionSha256);
    assert.equal(metadata.artifacts.parameterEntry.byteSize, spec.parameterByteSize);
    assertReflection(spec, reflection);

    const officialVertex = runCommand(SPIRV_CROSS, [files.vertexSpirv, "--version", "300", "--es"], { cwd: ROOT });
    const officialFragment = runCommand(SPIRV_CROSS, [files.fragmentSpirv, "--version", "300", "--es"], { cwd: ROOT });
    assert.equal(sha256(officialVertex), spec.crossSha256.vertex, `${spec.key} official vertex SPIRV-Cross changed`);
    assert.equal(sha256(officialFragment), spec.crossSha256.fragment, `${spec.key} official fragment SPIRV-Cross changed`);
    const vertex = adaptVertex(officialVertex, spec);
    const fragment = adaptFragment(officialFragment, spec);
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
    const samplerBindings = joinProgramSamplerBindings(programBindings, reflection)
      .map(({ set, ...row }) => {
        assert.equal(set, 0, `${spec.key} sampler must use descriptor set 0`);
        return row;
      });
    assert.deepEqual(samplerBindings.map(({ slot, spirvName, binding }) => ({ slot, spirvName, binding })),
      spec.sampler ? [spec.sampler] : [], `${spec.key} sampler bindings`);

    const runtimeContract = {
      schema: "pocket-card-render/webgl-runtime-port@1",
      shader_key: spec.key,
      attributes: spec.uv ? { position: "vec3", uv: "vec2" } : { position: "vec3" },
      engine_uniforms: { modelMatrix: "mat4", viewMatrix: "mat4", projectionMatrix: "mat4" },
      material_uniforms: { floats: spec.floats, ints: [], vectors: {} },
      require_complete_active_bindings: true,
      camera_from_view: false,
      mrt_attachments: 2,
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
          `map official position${spec.uv ? "/UV0" : ""} locations to Three.js attributes`,
          "unity_ObjectToWorld := three.modelMatrix and unity_MatrixVP := three.projectionMatrix * three.viewMatrix",
          "remove Unity Vulkan clip-space Y inversion for WebGL clip space",
        ],
      },
      fragment: {
        officialSpirvSha256: sha256File(files.fragmentSpirv),
        spirvCrossGlslSha256: sha256(officialFragment),
        outputSha256: sha256(fragment),
        operations: [
          ...(spec.fragmentUbo ? [{
            kind: "uniform-buffer-flattening",
            source: "serialized-common",
            preservation: "names-types-precision",
          }] : []),
          { kind: "glsl-version-ownership", owner: "three-raw-shader-material" },
        ],
        substitutions: ["remove the embedded GLSL version directive for Three.js RawShaderMaterial injection"],
      },
      interfaceSha256: canonicalJsonSha256({ vertex: reflection.vertex, fragment: reflection.fragment }),
      officialVertexInputs: vertexInputContract,
      runtimeContract,
      officialProgramBindings: manifestProgramBindings,
    });
    const manifest = {
      shader: spec.shader,
      generated_by: "build/build-exact-stencils.mjs",
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
        vertex: `public/shaders/${spec.prefix}.vert.glsl`,
        fragment: `public/shaders/${spec.prefix}.frag.glsl`,
      },
      runtime_contract: runtimeContract,
      sampler_bindings: samplerBindings,
      samplers: samplerBindings.map((row) => row.spirvName),
      sampler_slots: samplerBindings.map((row) => row.slot),
      compiled_texture_bindings: Object.fromEntries(samplerBindings.map((row) => [row.slot, row.binding])),
      implicit_defaults: metadata.shaderPropertyDefaults.textures,
      floats: Object.fromEntries(spec.floats.map((name) => [name, name])),
      mrt: {
        primary: spec.outputs[0].name,
        ...(spec.outputs[1] ? { emissive: spec.outputs[1].name } : { color_write: false }),
      },
    };
    writeOrCheckOutputs({
      [`${spec.prefix}.vert.glsl`]: vertex,
      [`${spec.prefix}.frag.glsl`]: fragment,
      [`${spec.prefix}_uniforms.json`]: `${JSON.stringify(manifest, null, 2)}\n`,
    }, { outDir: OUT, check: CHECK });
    console.log(`${CHECK ? "verified" : "generated"} ${spec.key} from selector-bound official SPIR-V`);
  });
}
