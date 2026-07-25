// Generate both ordered passes of Card_Circular_Moving_Kira and Card_Circular_Trail_Kira.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  canonicalJsonSha256,
  compileCommonBindings,
  compileOfficialPassContract,
  compileProgramBindings,
  joinProgramSamplerBindings,
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
const GLSLANG = process.env.GLSLANG_VALIDATOR || "glslangValidator";
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

const MOVING_DYNAMIC = {
  _Tilt: { type: "float", source: "CircularKiraObject.UpdateTilt" },
  _CircularDefaultAngle: { type: "float", source: "CircularKiraObject.Initialize/UpdateCircularParams" },
  _MoveAngle: { type: "float", source: "CircularKiraObject.UpdateCircularParams" },
  _PrimAngles: { type: "float[20]", source: "CircularKiraObject.UpdateParticleParams" },
  _PrimBaseScales: { type: "float[20]", source: "CircularKiraObject.Initialize" },
  _PrimBaseIntensities: { type: "float[20]", source: "CircularKiraObject.Initialize" },
  _PrimMinIntensities: { type: "float[20]", source: "CircularKiraObject.Initialize" },
  _PrimMaxIntensities: { type: "float[20]", source: "CircularKiraObject.Initialize" },
  _PrimFlickerScaling: { type: "float[20]", source: "CircularKiraObject.Initialize" },
  _PrimFlickerAnimOffsets: { type: "float[20]", source: "CircularKiraObject.UpdateParticleParams" },
  _PrimMorphing: { type: "float[20]", source: "CircularKiraObject.UpdateParticleParams" },
  _PrimTypes: { type: "int[20]", source: "CircularKiraObject.Initialize" },
};
const TRAIL_DYNAMIC = {
  _CircularDefaultAngle: { type: "float", source: "CircularKiraObject.Initialize/UpdateCircularParams" },
  _NoiseTime: { type: "float", source: "CircularKiraObject.UpdateTrailParams" },
};

const PORTS = [
  {
    id: "moving_p0",
    shaderKey: "Card_Circular_Moving_Kira",
    shaderName: "Lettuce/Common/CardNew/Face/Card_Circular_Moving_Kira",
    selectorId: "19f10144fca7186211d868c3fa5ebe1bd185fc5ebb06f6b42c2dc0658b159d82",
    candidateWitnessId: "d144f36a25157e6512c2db8de22f1f54acf42de328268aecf2d4a61bcf09c1ce",
    pass: 0,
    passName: "AlphaBlendPass",
    semanticExecutableId: "38637201438c597d434e794694efccbb306298cab6084758adb8c877b3f9f5bd",
    parameterReflectionSha256: "b6193fdcab1cb05610543479f05bda3fc2e23900d74c58c7621df743d97fe480",
    cross: {
      vertex: "89bb13b5ee18a7704550ac337a7334f8b1e339b3f4e71d4ff6e395c33e8cc9e3",
      fragment: "369864fd87c3f6e5940fb5ffb37d0c7ec89ae63050ac0bdec305ebae9767a1de",
    },
    staticFloats: ["_FlickerNoiseScale", "_CircularRadius", "_CenterMoveByTilt", "_AdjustAlphaBlendAlpha", "_EmissiveIntensity"],
    staticInts: ["_PrimCount", "_PrimDelete"],
    dynamic: MOVING_DYNAMIC,
    outputs: { primary: "_163", emissive: "_175" },
  },
  {
    id: "moving_p1",
    shaderKey: "Card_Circular_Moving_Kira",
    shaderName: "Lettuce/Common/CardNew/Face/Card_Circular_Moving_Kira",
    selectorId: "19f10144fca7186211d868c3fa5ebe1bd185fc5ebb06f6b42c2dc0658b159d82",
    candidateWitnessId: "2285af075af0f74f11362da701f1e028c2ac15dd6c1ed33ac75cd68b62267e2a",
    pass: 1,
    passName: "AddPass",
    semanticExecutableId: "c654fecb8c95d36835df12183aa255328c409bc261dee657bd97ea296255c9a7",
    parameterReflectionSha256: "1fd2694aebc0938652adbfa66cc8d6c24194ee6166bc2bfa9b6a6c868155088e",
    cross: {
      vertex: "89bb13b5ee18a7704550ac337a7334f8b1e339b3f4e71d4ff6e395c33e8cc9e3",
      fragment: "2027aad4a9b22737a4d7cd37fc47bfd65505c445570b8ae83b096260cf317571",
    },
    staticFloats: ["_FlickerNoiseScale", "_CircularRadius", "_CenterMoveByTilt", "_AdjustAddAlpha", "_AdjustAddMinAlpha", "_EmissiveIntensity", "_AdjustEmissiveAlpha"],
    staticInts: ["_PrimCount", "_PrimDelete"],
    dynamic: MOVING_DYNAMIC,
    outputs: { primary: "_164", emissive: "_183" },
  },
  {
    id: "trail_p0",
    shaderKey: "Card_Circular_Trail_Kira",
    shaderName: "Lettuce/Common/CardNew/Face/Card_Circular_Trail_Kira",
    selectorId: "f7177bf3d5bac65d15ca8f8d2ecf0396a3acdb831bff2ce74563b2fd984fa8c9",
    candidateWitnessId: "296aa903e9c796cf24cde3eb7b918b58792983ef052502b278d7e295517d5b8c",
    pass: 0,
    passName: "AlphaBlendPass",
    semanticExecutableId: "680c070c23ccb11838f213b7a4f1f250b928b703325824c89b1c24907bb47668",
    parameterReflectionSha256: "7cdc1bb9ed0cbe178df58fba73057f59d8de850026e63995326a7c1d0e783fae",
    cross: {
      vertex: "e26538835474aa06df3ab2ea87904d5e070d92d176a0833378b826ff37b23d33",
      fragment: "6354bd2e4510357c9ba87b0b117f7b4fab2231f42fc887391ae651e7f53f6d53",
    },
    staticFloats: ["_AdjustRadiusScale", "_CenterMoveByTilt", "_BaseColorIntensity", "_AdjustAlphaBlendColor", "_AdjustAlphaBlendAlpha", "_BaseScaleAdjust", "_UVOffset", "_BrightnessPower", "_BrightnessAffectIntensity", "_FlickerScale", "_FlickerSpeed"],
    staticInts: [],
    dynamic: TRAIL_DYNAMIC,
    outputs: { primary: "_201", emissive: "_220" },
  },
  {
    id: "trail_p1",
    shaderKey: "Card_Circular_Trail_Kira",
    shaderName: "Lettuce/Common/CardNew/Face/Card_Circular_Trail_Kira",
    selectorId: "f7177bf3d5bac65d15ca8f8d2ecf0396a3acdb831bff2ce74563b2fd984fa8c9",
    candidateWitnessId: "6466d49d6b942d0756b3de11ccfdc4b3f60d0507b6de71f3f03d3d21f15531b5",
    pass: 1,
    passName: "AddPass",
    semanticExecutableId: "0f26cc7537fbeeb138f3ac59f2e778b510603f3d0cf718a482cfb031ec87148b",
    parameterReflectionSha256: "85f93a2d311e80133db9cc5092e8b824a012e4e208eaee730d1254225f643b16",
    cross: {
      vertex: "e26538835474aa06df3ab2ea87904d5e070d92d176a0833378b826ff37b23d33",
      fragment: "3b52dd6431a2f5d1546eb2f82ecdbaf257193fce3a9b08e340132a443418945b",
    },
    staticFloats: ["_AdjustRadiusScale", "_CenterMoveByTilt", "_BaseColorIntensity", "_AdjustAddAlpha", "_AdjustAddMinAlpha", "_BaseScaleAdjust", "_UVOffset", "_BrightnessPower", "_BrightnessAffectIntensity", "_EmissiveIntensity", "_FlickerScale", "_FlickerSpeed"],
    staticInts: [],
    dynamic: TRAIL_DYNAMIC,
    outputs: { primary: "_227", emissive: "_229" },
  },
];

function equal(actual, expected, message) {
  assert.deepEqual(actual, expected, message);
}

function interfaceRows(rows = []) {
  return rows.map(({ name, type, location }) => ({ name, type, location }))
    .sort((left, right) => left.location - right.location);
}

function replaceMembers(source, owner, mapping) {
  let output = source;
  const rows = Object.entries(mapping).sort(([left], [right]) => Number(right) - Number(left));
  for (const [index, name] of rows) {
    const token = `${owner}._m${index}`;
    if (!output.includes(token)) throw new Error(`official member ${token} is absent`);
    output = output.replaceAll(token, name);
  }
  if (output.includes(`${owner}._m`)) throw new Error(`${owner} adaptation is incomplete`);
  return output;
}

function adaptMovingVertex(source) {
  let output = source.replace(/^#version 300 es\s*/m, "precision highp float;\nprecision highp int;\n\n");
  output = output.replace(/layout\(std140\) uniform _23_25[\s\S]*?}\s*_25;\s*/, [
    "uniform highp mat4 modelMatrix;", "uniform highp mat4 viewMatrix;", "uniform highp mat4 projectionMatrix;",
    "uniform float _Tilt;", "uniform float _FlickerNoiseScale;",
    "uniform float _PrimAngles[20];", "uniform float _PrimBaseScales[20];", "uniform float _PrimBaseIntensities[20];",
    "uniform float _PrimMinIntensities[20];", "uniform float _PrimMaxIntensities[20];",
    "uniform float _PrimFlickerScaling[20];", "uniform float _PrimFlickerAnimOffsets[20];",
    "uniform float _CircularRadius;", "uniform float _CircularDefaultAngle;", "uniform float _MoveAngle;",
    "uniform float _CenterMoveByTilt;", "uniform int _PrimCount;", "uniform int _PrimDelete;", "",
  ].join("\n"));
  output = output
    .replace("layout(location = 2) in vec2 _34;", "in vec2 uv1;")
    .replace("layout(location = 0) in vec4 _66;", "in vec3 position;")
    .replace("layout(location = 1) in vec2 _423;", "in vec2 uv;")
    .replace(/void main\(\)\s*\{/, `void main()
{
    vec2 _34 = uv1;
    vec4 _66 = vec4(position, 1.0);
    vec2 _423 = uv;
    mat4 _ObjectToWorld = modelMatrix;
    mat4 _ViewProjection = projectionMatrix * viewMatrix;`);
  output = replaceMembers(output, "_25", {
    0: "_ObjectToWorld", 1: "_ViewProjection", 2: "_Tilt", 3: "_FlickerNoiseScale",
    4: "_PrimAngles", 5: "_PrimBaseScales", 6: "_PrimBaseIntensities", 7: "_PrimMinIntensities",
    8: "_PrimMaxIntensities", 9: "_PrimFlickerScaling", 10: "_PrimFlickerAnimOffsets",
    11: "_CircularRadius", 12: "_CircularDefaultAngle", 13: "_MoveAngle", 14: "_CenterMoveByTilt",
    15: "_PrimCount", 16: "_PrimDelete",
  });
  output = output.replace(/^\s*gl_Position\.y\s*=\s*-gl_Position\.y;\s*$/m, "");
  if (/layout\(std140\)|gl_Position\.y\s*=\s*-gl_Position\.y/.test(output)) {
    throw new Error("moving vertex adaptation is incomplete");
  }
  return `${output.trimEnd()}\n`;
}

function adaptMovingFragment(source, pass) {
  let output = source.replace(/^#version 300 es\s*/m, "");
  const declarations = pass === 0
    ? ["uniform float _AdjustAlphaBlendAlpha;", "uniform float _PrimMorphing[20];", "uniform int _PrimTypes[20];", "uniform float _EmissiveIntensity;"]
    : ["uniform float _AdjustAddAlpha;", "uniform float _AdjustAddMinAlpha;", "uniform float _PrimMorphing[20];", "uniform int _PrimTypes[20];", "uniform float _EmissiveIntensity;", "uniform float _AdjustEmissiveAlpha;"];
  output = output.replace(/layout\(std140\) uniform _43_45[\s\S]*?}\s*_45;\s*/, `${declarations.join("\n")}\n\n`);
  output = replaceMembers(output, "_45", pass === 0
    ? { 0: "_AdjustAlphaBlendAlpha", 1: "_PrimMorphing", 2: "_PrimTypes", 3: "_EmissiveIntensity" }
    : { 0: "_AdjustAddAlpha", 1: "_AdjustAddMinAlpha", 2: "_PrimMorphing", 3: "_PrimTypes", 4: "_EmissiveIntensity", 5: "_AdjustEmissiveAlpha" });
  if (/layout\(std140\)/.test(output)) throw new Error("moving fragment adaptation is incomplete");
  return `${output.trimEnd()}\n`;
}

function adaptTrailVertex(source) {
  let output = source.replace(/^#version 300 es\s*/m, "precision highp float;\nprecision highp int;\n\n");
  output = output.replace(/layout\(std140\) uniform _14_16[\s\S]*?}\s*_16;\s*/, [
    "uniform highp mat4 modelMatrix;", "uniform highp mat4 viewMatrix;", "uniform highp mat4 projectionMatrix;",
    "uniform float _CenterMoveByTilt;", "uniform float _CircularDefaultAngle;", "uniform float _AdjustRadiusScale;", "",
  ].join("\n"));
  output = output
    .replace("layout(location = 0) in vec4 _51;", "in vec3 position;")
    .replace("layout(location = 1) in vec2 _180;", "in vec2 uv;")
    .replace(/void main\(\)\s*\{/, `void main()
{
    vec4 _51 = vec4(position, 1.0);
    vec2 _180 = uv;
    mat4 _ObjectToWorld = modelMatrix;
    mat4 _ViewProjection = projectionMatrix * viewMatrix;`);
  output = replaceMembers(output, "_16", {
    0: "_ObjectToWorld", 1: "_ViewProjection", 2: "_CenterMoveByTilt",
    3: "_CircularDefaultAngle", 4: "_AdjustRadiusScale",
  });
  output = output.replace(/^\s*gl_Position\.y\s*=\s*-gl_Position\.y;\s*$/m, "");
  if (/layout\(std140\)|gl_Position\.y\s*=\s*-gl_Position\.y/.test(output)) {
    throw new Error("trail vertex adaptation is incomplete");
  }
  return `${output.trimEnd()}\n`;
}

function adaptTrailFragment(source, pass) {
  let output = source.replace(/^#version 300 es\s*/m, "");
  const names = pass === 0
    ? ["_BaseColorIntensity", "_AdjustAlphaBlendColor", "_AdjustAlphaBlendAlpha", "_BaseScaleAdjust", "_UVOffset", "_BrightnessPower", "_BrightnessAffectIntensity", "_FlickerScale", "_FlickerSpeed", "_NoiseTime"]
    : ["_BaseColorIntensity", "_AdjustAddAlpha", "_AdjustAddMinAlpha", "_BaseScaleAdjust", "_UVOffset", "_BrightnessPower", "_BrightnessAffectIntensity", "_EmissiveIntensity", "_FlickerScale", "_FlickerSpeed", "_NoiseTime"];
  output = output.replace(/layout\(std140\) uniform _10_12[\s\S]*?}\s*_12;\s*/, `${names.map((name) => `uniform float ${name};`).join("\n")}\n\n`);
  output = replaceMembers(output, "_12", Object.fromEntries(names.map((name, index) => [index, name])));
  if (/layout\(std140\)/.test(output)) throw new Error("trail fragment adaptation is incomplete");
  return `${output.trimEnd()}\n`;
}

function validateWebGlStage(source, stage, id) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "pcr-circular-kira-glsl-"));
  const file = path.join(temp, `${id}.${stage}`);
  try {
    fs.writeFileSync(file, `#version 300 es\n${source}`);
    runCommand(GLSLANG, ["-S", stage, file], { cwd: ROOT });
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

function assertReflection(spec, reflection) {
  const moving = spec.shaderKey === "Card_Circular_Moving_Kira";
  const vertexUbo = reflection.vertex.ubos?.[0];
  const fragmentUbo = reflection.fragment.ubos?.[0];
  equal({ name: vertexUbo?.name, size: vertexUbo?.block_size }, moving
    ? { name: "_23_25", size: 2408 }
    : { name: "_14_16", size: 140 }, `${spec.id} vertex UBO`);
  equal({ name: fragmentUbo?.name, size: fragmentUbo?.block_size }, moving
    ? { name: "_43_45", size: spec.pass === 0 ? 660 : 664 }
    : { name: "_10_12", size: spec.pass === 0 ? 40 : 44 }, `${spec.id} fragment UBO`);
  equal(interfaceRows(reflection.vertex.inputs), moving ? [
    { name: "_66", type: "vec4", location: 0 },
    { name: "_423", type: "vec2", location: 1 },
    { name: "_34", type: "vec2", location: 2 },
  ] : [
    { name: "_51", type: "vec4", location: 0 },
    { name: "_180", type: "vec2", location: 1 },
  ], `${spec.id} vertex inputs`);
  equal(interfaceRows(reflection.fragment.outputs), [
    { name: spec.outputs.primary, type: "vec4", location: 0 },
    { name: spec.outputs.emissive, type: "vec4", location: 1 },
  ], `${spec.id} fragment outputs`);
  equal((reflection.fragment.textures || []).map(({ name, type, set, binding }) => ({ name, type, set, binding })), moving
    ? (spec.pass === 0 ? [
      { name: "_13", type: "sampler2D", set: 0, binding: 3 }, { name: "_23", type: "sampler2D", set: 0, binding: 2 },
      { name: "_56", type: "sampler2D", set: 0, binding: 5 }, { name: "_62", type: "sampler2D", set: 0, binding: 4 },
      { name: "_104", type: "sampler2D", set: 0, binding: 1 }, { name: "_109", type: "sampler2D", set: 0, binding: 0 },
    ] : [
      { name: "_13", type: "sampler2D", set: 0, binding: 3 }, { name: "_23", type: "sampler2D", set: 0, binding: 2 },
      { name: "_56", type: "sampler2D", set: 0, binding: 5 }, { name: "_62", type: "sampler2D", set: 0, binding: 4 },
      { name: "_105", type: "sampler2D", set: 0, binding: 1 }, { name: "_110", type: "sampler2D", set: 0, binding: 0 },
    ]) : [{ name: "_149", type: "sampler2D", set: 0, binding: 0 }], `${spec.id} fragment samplers`);
}

async function buildPort(spec) {
  await withExtractedSelectorProgram({
    selectorId: spec.selectorId,
    candidateWitnessId: spec.candidateWitnessId,
    expectedProofGraphSha256: PROOF_GRAPH_SHA256,
    expectedPortIndexSha256: PORT_INDEX_SHA256,
    decryptedRoot: path.resolve(SHADER_ROOT, "..", ".."),
    prefix: `circular_${spec.id}`,
    rootDir: ROOT,
    spirvCross: SPIRV_CROSS,
  }, ({ metadata, files, reflection }) => {
    equal(metadata.selector.keywords, [], `${spec.id} selector keywords`);
    assert.equal(metadata.selector.selectionMode, "ordered-multipass-structure");
    assert.equal(metadata.selector.subshader, 0);
    assert.equal(metadata.selector.pass, spec.pass);
    assert.equal(metadata.selector.semanticExecutableId, spec.semanticExecutableId);
    assert.equal(metadata.parameterReflectionSha256, spec.parameterReflectionSha256);
    assert.equal(metadata.artifacts.parameterEntry.byteSize, 100);
    assert.equal(metadata.passContract.passName, spec.passName);
    assertReflection(spec, reflection);

    const officialVertex = runCommand(SPIRV_CROSS, [files.vertexSpirv, "--version", "300", "--es"], { cwd: ROOT });
    const officialFragment = runCommand(SPIRV_CROSS, [files.fragmentSpirv, "--version", "300", "--es"], { cwd: ROOT });
    assert.equal(sha256(officialVertex), spec.cross.vertex, `${spec.id} official vertex SPIRV-Cross changed`);
    assert.equal(sha256(officialFragment), spec.cross.fragment, `${spec.id} official fragment SPIRV-Cross changed`);
    const moving = spec.shaderKey === "Card_Circular_Moving_Kira";
    const vertex = moving ? adaptMovingVertex(officialVertex) : adaptTrailVertex(officialVertex);
    const fragment = moving ? adaptMovingFragment(officialFragment, spec.pass) : adaptTrailFragment(officialFragment, spec.pass);
    validateWebGlStage(vertex, "vert", spec.id);
    validateWebGlStage(fragment, "frag", spec.id);

    const commonBindings = compileCommonBindings(metadata.commonBindings);
    const programBindings = compileProgramBindings(commonBindings, metadata.parameterReflection, metadata.shaderPropertyDefaults);
    const samplerBindings = joinProgramSamplerBindings(programBindings, reflection).map(({ set, ...row }) => {
      assert.equal(set, 0, `${spec.id} WebGL sampler port requires descriptor set 0`);
      return row;
    });
    const expectedSlots = moving
      ? ["_PrimATex", "_PrimAMorphTex", "_PrimBTex", "_PrimBMorphTex", "_PrimCTex", "_PrimCMorphTex"]
      : ["_BaseTex"];
    equal(samplerBindings.map((row) => row.slot), expectedSlots, `${spec.id} sampler binding-number join`);

    const baseName = `circular_${spec.id}`;
    const adaptation = {
      schema: "pocket-card-render/webgl-stage-adaptation@1",
      backend: "Unity Vulkan SPIR-V to Three.js WebGL2",
      vertex: {
        officialSpirvSha256: sha256File(files.vertexSpirv), spirvCrossGlslSha256: sha256(officialVertex),
        outputSha256: sha256(vertex),
        substitutions: [
          moving
            ? "map official mesh locations to Three.js position/uv/uv1 attributes"
            : "map official mesh locations to Three.js position/uv attributes",
          "unity_ObjectToWorld := three.modelMatrix and unity_MatrixVP := three.projectionMatrix * three.viewMatrix",
          "expand official common-buffer fields and fixed-size arrays into same-name WebGL uniforms",
          "remove Unity Vulkan clip-space Y inversion for WebGL clip space",
        ],
      },
      fragment: {
        officialSpirvSha256: sha256File(files.fragmentSpirv), spirvCrossGlslSha256: sha256(officialFragment),
        outputSha256: sha256(fragment),
        substitutions: ["expand official common-buffer fields and fixed-size arrays into same-name WebGL uniforms"],
      },
      interfaceSha256: canonicalJsonSha256({ vertex: reflection.vertex, fragment: reflection.fragment }),
    };
    const manifest = {
      shader: spec.shaderName,
      generated_by: "build/build-exact-circular-kira.mjs",
      selected_keywords: [],
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
        policy: PASS_POLICY,
      }),
      official_common_bindings: { source_sha256: metadata.identityFields.commonBindingsSha256, ...commonBindings },
      official_program_bindings: {
        common_source_sha256: metadata.identityFields.commonBindingsSha256,
        parameter_reflection_sha256: metadata.parameterReflectionSha256,
        ...programBindings,
      },
      official_shader_property_defaults: metadata.shaderPropertyDefaults,
      webgl_adaptation: adaptation,
      webgl_sources: {
        vertex: `public/shaders/${baseName}.vert.glsl`,
        fragment: `public/shaders/${baseName}.frag.glsl`,
      },
      runtime_contract: {
        schema: "pocket-card-render/webgl-runtime-port@1",
        shader_key: spec.shaderKey,
        attributes: moving ? { position: "vec3", uv: "vec2", uv1: "vec2" } : { position: "vec3", uv: "vec2" },
        engine_uniforms: { modelMatrix: "mat4", viewMatrix: "mat4", projectionMatrix: "mat4" },
        material_uniforms: { floats: spec.staticFloats, ints: spec.staticInts, vectors: {} },
        dynamic_uniforms: spec.dynamic,
        require_complete_active_bindings: true,
        camera_from_view: true,
        mrt_attachments: 2,
        stencil_normalization: "none",
        stencil_face_mode: "generic",
        ordered_pass: { subshader: 0, pass: spec.pass, name: spec.passName },
      },
      runtime_boundaries: moving ? [
        { status: "runtime-required", producer: "CircularKiraObject.UpdateTilt/UpdateParticleParams/ApplyParams", payload: "MaterialPropertyBlock scalar and 20-element arrays" },
      ] : [
        { status: "runtime-required", producer: "CircularKiraObject.UpdateTrailParams/ApplyParams", payload: "_NoiseTime and circular angle MaterialPropertyBlock values" },
        { status: "runtime-required", producer: "CircularKiraObject.ApplyVerticesParams", payload: "runtime trail Mesh UVs" },
      ],
      sampler_bindings: samplerBindings,
      samplers: samplerBindings.map((row) => row.spirvName),
      sampler_slots: samplerBindings.map((row) => row.slot),
      compiled_texture_bindings: Object.fromEntries(samplerBindings.map((row) => [row.slot, row.binding])),
      implicit_defaults: metadata.shaderPropertyDefaults.textures,
      floats: Object.fromEntries([...spec.staticFloats, ...spec.staticInts, ...Object.keys(spec.dynamic)].map((name) => [name, name])),
      mrt: spec.outputs,
    };
    writeOrCheckOutputs({
      [`${baseName}.vert.glsl`]: vertex,
      [`${baseName}.frag.glsl`]: fragment,
      [`${baseName}_uniforms.json`]: `${JSON.stringify(manifest, null, 2)}\n`,
    }, { outDir: OUT, check: CHECK });
    console.log(`${CHECK ? "verified" : "generated"} ${spec.shaderKey} ${spec.passName} from selector-bound official SPIR-V`);
  });
}

for (const spec of PORTS) await buildPort(spec);
