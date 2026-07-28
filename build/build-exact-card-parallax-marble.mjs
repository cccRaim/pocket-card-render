#!/usr/bin/env node
// Generate both Card_Parallax_Marble variants from selector-bound official SPIR-V.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  adaptThreeWorldVectorsToUnityDataAxes,
  generateExactSelectorPort,
  runCommand,
} from "./exact-selector-port-core.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHADER_ROOT = process.env.PCR_SHADERS
  || "D:/DevProjectes/ptcgp-tools-master/masterdata_decoder/.output/decrypted/Common/Shader";
const SPIRV_CROSS = process.env.SPIRV_CROSS || "spirv-cross";
const GLSLANG = process.env.GLSLANG_VALIDATOR || "glslangValidator";
const OUT = path.join(ROOT, "public", "shaders");
const CHECK = process.argv.includes("--check") || process.env.PCR_EXACT_CHECK === "1";
const GENERATED_BY = "build/build-exact-card-parallax-marble.mjs";
const SHADER = "Lettuce/Common/CardNew/Face/Card_Parallax_Marble";
const PROOF_GRAPH_SHA256 =
  "307ed3660e5d3b1bfd8cf9e6b3d64e44937af215da3b6ed84ead198800eeadc4";
const PORT_INDEX_SHA256 =
  "15095f34b9e75515bbcc3924f6f8b2abb826ba96b48e819ec911486bcfa6f5a9";
const MARBLE_PRODUCER =
  "pocket-card-render/card-marble-layer-arm64-state-port@1";
const ROTATION_PRODUCER =
  "pocket-card-render/card-behaviour-hologram-rotation-arm64-port@1";
const CURVE_TEXTURE_PRODUCER =
  MARBLE_PRODUCER;

const PASS_POLICY = {
  rtSeparateBlend: false,
  fixed: {
    zClip: { val: 1, name: null },
    conservative: { val: 0, name: null },
    offsetFactor: { val: 0, name: null },
    offsetUnits: { val: 0, name: null },
    alphaToMask: { val: 0, name: null },
    fogMode: -1,
    lighting: false,
  },
};

const FRAGMENT_BASIS_CONVERSIONS = {
  worldVectors: [
    {
      source: "cameraPosition",
      alias: "pcrUnityCameraPosition",
      expectedOccurrences: 1,
    },
    {
      source: "vs_TEXCOORD2",
      alias: "pcrUnityWorldPosition",
      expectedOccurrences: 1,
    },
    {
      source: "vs_TEXCOORD3",
      alias: "pcrUnityWorldNormal",
      expectedOccurrences: 3,
    },
  ],
  viewForwards: [],
};

function field(name, type, offset, precision = "", arraySize = null) {
  return { name, type, offset, precision, arraySize };
}

const COMMON_HEAD = [
  field("_WorldSpaceCameraPos", "vec3", 0, "highp"),
  field("_Tilt", "float", 12, "highp"),
  field("_Front", "vec2", 16, "highp"),
  field("_Rotation", "vec3", 32),
  field("_Shininess", "float", 44),
  field("_BaseColorIntensity", "float", 48),
  field("_SpecularIntensity", "float", 52),
  field("_Attributes", "vec4", 64, "highp", 4),
  field("_PointCount", "int", 128),
  field("_DistPower", "float", 132, "highp"),
  field("_DistLimit", "float", 136),
];

const MAGNETIC_FIELDS = [
  ...COMMON_HEAD,
  field("_StrengthOffset", "float", 140),
  field("_StrengthMultiply", "float", 144, "highp"),
  field("_MagneticMovePower", "float", 148, "highp"),
  field("_MagneticRange", "float", 152, "highp"),
  field("_SpherizeStrength", "float", 156, "highp"),
  field("_SpherizeOffsetX", "float", 160, "highp"),
  field("_SpherizeOffsetY", "float", 164, "highp"),
  field("_RadialShearStrength", "float", 168, "highp"),
  field("_RadialShearTiltStrength", "float", 172, "highp"),
  field("_RadialShearCenterDefault", "vec2", 176, "highp"),
  field("_RadialShearCenterTiltMove", "vec2", 184, "highp"),
  field("_ShearStrength", "float", 192, "highp"),
  field("_ShearDefaultDegree", "float", 196, "highp"),
  field("_ShearTiltDegree", "float", 200, "highp"),
  field("_EmissiveIntensity", "float", 204, "highp"),
  field("_EmissiveIntensityTiltPower", "float", 208, "highp"),
  field("_EmissiveByForceLoopCount", "float", 212, "highp"),
  field("_EmissiveByForcePower", "float", 216, "highp"),
  field("_TiltRotation", "float", 220),
  field("_WorldFront", "vec3", 224),
  field("_WorldFrontPower", "float", 236),
  field("_NoisyMaskScale", "float", 240, "highp"),
];

const OUTSIDE_RELAX_FIELDS = [
  ...COMMON_HEAD,
  field("_OutsideStartRadius", "float", 140),
  field("_OutsideEndRadius", "float", 144),
  field("_OutsideRelax", "float", 148),
  field("_OutsideRelaxPower", "float", 152),
  field("_RelaxLU", "int", 156),
  field("_RelaxLD", "int", 160),
  field("_RelaxRU", "int", 164),
  field("_RelaxRD", "int", 168),
  field("_StrengthOffset", "float", 172),
  field("_StrengthMultiply", "float", 176, "highp"),
  field("_SpherizeStrength", "float", 180, "highp"),
  field("_SpherizeOffsetX", "float", 184, "highp"),
  field("_SpherizeOffsetY", "float", 188, "highp"),
  field("_RadialShearStrength", "float", 192, "highp"),
  field("_RadialShearTiltStrength", "float", 196, "highp"),
  field("_RadialShearCenterDefault", "vec2", 200, "highp"),
  field("_RadialShearCenterTiltMove", "vec2", 208, "highp"),
  field("_ShearStrength", "float", 216, "highp"),
  field("_ShearDefaultDegree", "float", 220, "highp"),
  field("_ShearTiltDegree", "float", 224, "highp"),
  field("_EmissiveIntensity", "float", 228, "highp"),
  field("_EmissiveIntensityTiltPower", "float", 232, "highp"),
  field("_EmissiveByForceLoopCount", "float", 236, "highp"),
  field("_EmissiveByForcePower", "float", 240, "highp"),
  field("_TiltRotation", "float", 244),
  field("_WorldFront", "vec3", 256),
  field("_WorldFrontPower", "float", 268),
  field("_NoisyMaskScale", "float", 272, "highp"),
];

const COMMON_MATERIAL_FLOATS = [
  "_BaseColorIntensity",
  "_DistLimit",
  "_DistPower",
  "_EmissiveByForceLoopCount",
  "_EmissiveByForcePower",
  "_EmissiveIntensity",
  "_EmissiveIntensityTiltPower",
  "_NoisyMaskScale",
  "_RadialShearStrength",
  "_RadialShearTiltStrength",
  "_ShearDefaultDegree",
  "_ShearStrength",
  "_ShearTiltDegree",
  "_Shininess",
  "_SpecularIntensity",
  "_SpherizeOffsetX",
  "_SpherizeOffsetY",
  "_SpherizeStrength",
  "_StrengthMultiply",
  "_StrengthOffset",
  "_WorldFrontPower",
];

const PORTS = [
  {
    id: "magnetic",
    stem: "card_parallax_marble_magnetic",
    shaderKey: "Card_Parallax_Marble",
    selectorId: "1fdbe0eb8d0712cfb7195e524947b1b4936f99b22ea26be1074f182fc3e52bf6",
    candidateWitnessId:
      "0d5e2b0f004bf5148a64fdc3fa1c7aa3513f72d9b9f5c040a23237d2f510dadd",
    keywords: ["_USEMAGNETIC_ON"],
    semanticExecutableId:
      "52635640d99e013b12defb044aa10392b9d5144bc94c3793396bd6ef4163dd89",
    identityFields: {
      vertexSpirvSha256:
        "20ef0e7bef6f78dbd37e1d5e029f1256533c9cd09e3a05d2e4df4e27dc578bde",
      fragmentSpirvSha256:
        "f274a0037c0e036550a95e01e62479cfc15b58f9fa6bbc74d9cde3a33c236df1",
      parameterEntrySha256:
        "0a30f53cae9f4d87c2c3260a22ee4ecc3d37bbdde01ae15597c7abde7a2f5fe6",
      passStateSha256:
        "237f26f7af536c6f6ed5273506534ade0183930a4d52941430a0f0deea3d8c03",
      commonBindingsSha256:
        "f2e6500ac4a3e0925523a73a8c19fda396419257d0886d327cd8ea90b2b1957f",
    },
    parameterReflectionSha256:
      "3844a669fb332bbb20a65fd09f0e973d5f4b442ebfcf88b589f93cda551da6ba",
    parameterEntryByteSize: 1820,
    pGlobalsSize: 244,
    fields: MAGNETIC_FIELDS,
    crossSha256: {
      vertex: "0702e59df2a21494d4190ed402468081b8dc474b741e93106129e07479949790",
      fragment: "bc56dda4672f0ddd4b4caef07e0c61eff0cfa292b7ccc6aabc468477d70ac9f9",
    },
    curveSampler: "_561",
    samplerBindings: [
      { slot: "_BaseRampTex", spirvName: "_412", binding: 0 },
      { slot: "_NoisyMask", spirvName: "_550", binding: 1 },
      { slot: "_DefaultNoiseRemapCurveTexture", spirvName: "_561", binding: 2 },
      { slot: "_CubeMap", spirvName: "_759", binding: 3 },
    ],
    materialUniforms: {
      floats: [...COMMON_MATERIAL_FLOATS, "_MagneticMovePower", "_MagneticRange"],
      ints: [],
      vectors: {
        _RadialShearCenterDefault: "vec2",
        _RadialShearCenterTiltMove: "vec2",
      },
    },
    mrt: { primary: "_801", emissive: "_519" },
  },
  {
    id: "outside-relax",
    stem: "card_parallax_marble_outside_relax",
    shaderKey: "Card_Parallax_Marble",
    selectorId: "46d3045fc119dd373c8a35dad147987c6e5c91816a44807ede65ad025011dcc2",
    candidateWitnessId:
      "c03eec4906180772175e8f76d70f161c84996d579d54ac2434137c74aaa3b7cb",
    keywords: ["_USEOUTSIDERELAX_ON"],
    semanticExecutableId:
      "07ef596ff11da43553fedf145df55beb3187156d97576fea34ae5532a9bb5acd",
    identityFields: {
      vertexSpirvSha256:
        "20ef0e7bef6f78dbd37e1d5e029f1256533c9cd09e3a05d2e4df4e27dc578bde",
      fragmentSpirvSha256:
        "e40372ac6db0a62cbe2f6ace1f12b7595f3ec84e7467cb4729efd4cc70a0e078",
      parameterEntrySha256:
        "35097e1ed136fb14f60c04bde97b2bdec1f9bb009987b3d535c89fe240e63c89",
      passStateSha256:
        "237f26f7af536c6f6ed5273506534ade0183930a4d52941430a0f0deea3d8c03",
      commonBindingsSha256:
        "f2e6500ac4a3e0925523a73a8c19fda396419257d0886d327cd8ea90b2b1957f",
    },
    parameterReflectionSha256:
      "deea24ed96455c97b42fea582999e37be167b70095522d263dddf782c5fdbd7c",
    parameterEntryByteSize: 2060,
    pGlobalsSize: 276,
    fields: OUTSIDE_RELAX_FIELDS,
    crossSha256: {
      vertex: "0702e59df2a21494d4190ed402468081b8dc474b741e93106129e07479949790",
      fragment: "1695d7a79b796bf77a51d9686bf8a65bfface9ccf962276a1d7b7e4ae219dd67",
    },
    curveSampler: "_689",
    samplerBindings: [
      { slot: "_BaseRampTex", spirvName: "_536", binding: 0 },
      { slot: "_NoisyMask", spirvName: "_678", binding: 1 },
      { slot: "_DefaultNoiseRemapCurveTexture", spirvName: "_689", binding: 2 },
      { slot: "_CubeMap", spirvName: "_890", binding: 3 },
    ],
    materialUniforms: {
      floats: [
        ...COMMON_MATERIAL_FLOATS,
        "_OutsideEndRadius",
        "_OutsideRelax",
        "_OutsideRelaxPower",
        "_OutsideStartRadius",
      ],
      ints: ["_RelaxLD", "_RelaxLU", "_RelaxRD", "_RelaxRU"],
      vectors: {
        _RadialShearCenterDefault: "vec2",
        _RadialShearCenterTiltMove: "vec2",
      },
    },
    mrt: { primary: "_933", emissive: "_648" },
  },
];

function interfaceRows(items = []) {
  return items.map(({ name, type, location }) => ({ name, type, location }))
    .sort((left, right) => left.location - right.location);
}

function resourceRows(items = []) {
  return items.map(({ name, type, set, binding, block_size }) => ({
    name,
    ...(type ? { type } : {}),
    ...(block_size !== undefined ? { block_size } : {}),
    set,
    binding,
  })).sort((left, right) => left.binding - right.binding);
}

function fieldDeclaration(item, memberName = item.name, uniform = false) {
  const precision = item.precision ? `${item.precision} ` : "";
  const suffix = item.arraySize ? `[${item.arraySize}]` : "";
  return `${uniform ? "uniform " : ""}${precision}${item.type} ${memberName}${suffix};`;
}

function pGlobalsFields(metadata) {
  const block = metadata.parameterReflection.constantBuffers
    .find(({ name }) => name.startsWith("PGlobals"));
  assert.ok(block, "PGlobals parameter block is absent");
  return block;
}

function assertReflection(reflection, metadata, port) {
  assert.equal(metadata.selector.shaderName, SHADER, `${port.id}: shader`);
  assert.deepEqual(metadata.selector.keywords, port.keywords, `${port.id}: keywords`);
  assert.equal(
    metadata.selector.selectionMode,
    "unique-exact-keywords",
    `${port.id}: selection mode`,
  );
  assert.equal(
    metadata.selector.semanticExecutableId,
    port.semanticExecutableId,
    `${port.id}: semantic executable`,
  );
  assert.deepEqual(metadata.identityFields, port.identityFields, `${port.id}: executable identity`);
  assert.equal(
    metadata.parameterReflectionSha256,
    port.parameterReflectionSha256,
    `${port.id}: parameter reflection`,
  );
  assert.equal(
    metadata.artifacts.parameterEntry.byteSize,
    port.parameterEntryByteSize,
    `${port.id}: parameter entry size`,
  );
  assert.equal(metadata.parameterReflection.version, 202012090, `${port.id}: parameter format`);
  assert.equal(metadata.parameterReflection.constantBlockCount, 3, `${port.id}: block count`);
  assert.equal(metadata.parameterReflection.resourceCount, 2, `${port.id}: resource count`);

  const pGlobals = pGlobalsFields(metadata);
  assert.equal(pGlobals.size, port.pGlobalsSize, `${port.id}: PGlobals size`);
  assert.deepEqual(
    [...pGlobals.fields]
      .sort((left, right) => left.offset - right.offset)
      .map(({ name, offset }) => ({ name, offset })),
    port.fields.map(({ name, offset }) => ({ name, offset })),
    `${port.id}: PGlobals field layout`,
  );

  assert.deepEqual(resourceRows(reflection.vertex.ubos), [
    { name: "_19_21", type: "_19", block_size: 192, set: 1, binding: 1 },
  ]);
  assert.deepEqual(interfaceRows(reflection.vertex.inputs), [
    { name: "_11", type: "vec4", location: 0 },
    { name: "_134", type: "vec4", location: 1 },
    { name: "_87", type: "vec2", location: 2 },
  ]);
  assert.deepEqual(interfaceRows(reflection.vertex.outputs), [
    { name: "vs_TEXCOORD0", type: "vec2", location: 0 },
    { name: "vs_TEXCOORD1", type: "vec3", location: 1 },
    { name: "vs_TEXCOORD2", type: "vec3", location: 2 },
    { name: "vs_TEXCOORD3", type: "vec3", location: 3 },
  ]);

  const fragmentUbo = reflection.fragment.ubos?.find(({ name }) => name === "_34_36");
  assert.deepEqual(
    fragmentUbo && {
      name: fragmentUbo.name,
      block_size: fragmentUbo.block_size,
      set: fragmentUbo.set,
      binding: fragmentUbo.binding,
    },
    { name: "_34_36", block_size: port.pGlobalsSize, set: 1, binding: 0 },
    `${port.id}: fragment UBO`,
  );
  const reflectedMembers = reflection.fragment.types?.[fragmentUbo.type]?.members || [];
  assert.deepEqual(
    reflectedMembers.map(({ name, type, offset, array }) => ({
      name,
      type,
      offset,
      arraySize: array?.[0] ?? null,
    })),
    port.fields.map((item, index) => ({
      name: `_m${index}`,
      type: item.type,
      offset: item.offset,
      arraySize: item.arraySize,
    })),
    `${port.id}: reflected PGlobals members`,
  );
  assert.deepEqual(interfaceRows(reflection.fragment.inputs), [
    { name: "vs_TEXCOORD0", type: "vec2", location: 0 },
    { name: "vs_TEXCOORD1", type: "vec3", location: 1 },
    { name: "vs_TEXCOORD2", type: "vec3", location: 2 },
    { name: "vs_TEXCOORD3", type: "vec3", location: 3 },
  ]);
  assert.deepEqual(
    interfaceRows(reflection.fragment.outputs).map(({ type, location }) => ({ type, location })),
    [
      { type: "vec4", location: 0 },
      { type: "vec4", location: 1 },
    ],
    `${port.id}: fragment outputs`,
  );
  assert.deepEqual(
    resourceRows(reflection.fragment.textures),
    port.samplerBindings.map(({ spirvName: name, binding }, index) => ({
      name,
      type: index === 3 ? "samplerCube" : "sampler2D",
      set: 0,
      binding,
    })),
    `${port.id}: fragment samplers`,
  );

  assert.equal(
    Object.hasOwn(metadata.shaderPropertyDefaults.textureDescriptors, "_DefaultNoiseRemapCurveTexture"),
    false,
    `${port.id}: runtime curve texture must not acquire a ShaderLab default`,
  );
  assert.equal(
    Object.hasOwn(metadata.shaderPropertyDefaults.textures, "_DefaultNoiseRemapCurveTexture"),
    false,
    `${port.id}: runtime curve texture must not acquire an implicit texture`,
  );
}

function replaceUbo(source, block, owner, declarations) {
  const pattern = new RegExp(`layout\\(std140\\) uniform ${block}[\\s\\S]*?}\\s*${owner};\\s*`);
  const output = source.replace(pattern, `${declarations.join("\n")}\n\n`);
  if (output === source) throw new Error(`${block}: UBO replacement failed`);
  return output;
}

function replaceAllRequired(source, before, after, label) {
  const count = source.split(before).length - 1;
  if (count < 1) throw new Error(`${label}: ${before} is absent`);
  return source.replaceAll(before, after);
}

function adaptVertex(source) {
  const officialBlock = [
    "layout(std140) uniform _19_21",
    "{",
    "    vec4 _m0[4];",
    "    vec4 _m1[4];",
    "    vec4 _m2[4];",
    "} _21;",
  ].join("\r\n");
  assert.ok(
    source.includes(officialBlock) || source.includes(officialBlock.replaceAll("\r\n", "\n")),
    "Marble vertex UBO declaration changed",
  );

  let output = source.replace(
    /^#version 300 es\s*/m,
    "precision highp float;\nprecision highp int;\n\n",
  );
  output = replaceUbo(output, "_19_21", "_21", [
    "uniform highp mat4 modelMatrix;",
    "uniform highp mat4 viewMatrix;",
    "uniform highp mat4 projectionMatrix;",
  ]);
  output = output
    .replace("layout(location = 0) in vec4 _11;", "in vec3 position;")
    .replace("layout(location = 1) in vec4 _134;", "in vec3 normal;")
    .replace("layout(location = 2) in vec2 _87;", "in vec2 uv;")
    .replace(/void main\(\)\s*\{/, `void main()
{
    vec4 _11 = vec4(position, 1.0);
    vec4 _134 = vec4(normal, 0.0);
    vec2 _87 = uv;
    mat4 pcrObjectToWorld = modelMatrix;
    mat4 pcrWorldToObject = inverse(modelMatrix);
    mat4 pcrViewProjection = projectionMatrix * viewMatrix;`);
  output = replaceAllRequired(output, "_21._m0", "pcrObjectToWorld", "object-to-world");
  output = replaceAllRequired(output, "_21._m1", "pcrWorldToObject", "world-to-object");
  output = replaceAllRequired(output, "_21._m2", "pcrViewProjection", "view-projection");
  output = output.replace(/^\s*gl_Position\.y\s*=\s*-gl_Position\.y;\s*$/m, "");
  if (
    /_21\._m|layout\(std140\)|layout\(location\s*=\s*\d+\)\s+in|gl_Position\.y\s*=/.test(output)
  ) {
    throw new Error("Card_Parallax_Marble vertex adaptation is incomplete");
  }
  return `${output.trimEnd()}\n`;
}

function adaptFragment(source, port) {
  const blockMatch = source.match(/layout\(std140\) uniform _34_36[\s\S]*?}\s*_36;\s*/);
  assert.ok(blockMatch, `${port.id}: official fragment UBO is absent`);
  const officialDeclarations = blockMatch[0]
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^.+\s+_m\d+(?:\[\d+\])?;$/.test(line));
  assert.deepEqual(
    officialDeclarations,
    port.fields.map((item, index) => fieldDeclaration(item, `_m${index}`)),
    `${port.id}: official PGlobals declarations`,
  );

  let output = source.replace(/^#version 300 es\s*/m, "");
  output = replaceUbo(
    output,
    "_34_36",
    "_36",
    port.fields.map((item) => {
      if (item.name === "_WorldSpaceCameraPos") return "uniform highp vec3 cameraPosition;";
      return fieldDeclaration(item, item.name, true);
    }),
  );
  output = output.replace(/_36\._m(\d+)/g, (match, rawIndex) => {
    const item = port.fields[Number(rawIndex)];
    if (!item) throw new Error(`${port.id}: unmapped fragment member ${match}`);
    return item.name === "_WorldSpaceCameraPos" ? "cameraPosition" : item.name;
  });
  output = adaptThreeWorldVectorsToUnityDataAxes(output, {
    bindings: FRAGMENT_BASIS_CONVERSIONS.worldVectors,
  });
  if (/_36\._m|layout\(std140\)/.test(output)) {
    throw new Error(`${port.id}: fragment adaptation is incomplete`);
  }
  return `${output.trimEnd()}\n`;
}

function validateStage(source, stage, label) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "pcr-card-parallax-marble-stage-"));
  const file = path.join(temp, `${label}.${stage}`);
  try {
    fs.writeFileSync(file, `#version 300 es\n${source}`);
    runCommand(GLSLANG, ["-S", stage, file], { cwd: ROOT });
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

function validateLinkedProgram(vertex, fragment, label) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "pcr-card-parallax-marble-link-"));
  const vertexFile = path.join(temp, `${label}.vert`);
  const fragmentFile = path.join(temp, `${label}.frag`);
  try {
    fs.writeFileSync(vertexFile, `#version 300 es\n${vertex}`);
    fs.writeFileSync(fragmentFile, `#version 300 es\n${fragment}`);
    runCommand(GLSLANG, ["-l", vertexFile, fragmentFile], { cwd: ROOT });
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

for (const port of PORTS) {
  const dynamicUniforms = {
    _Attributes: { type: "vec4[4]", source: MARBLE_PRODUCER },
    _Front: { type: "vec2", source: MARBLE_PRODUCER },
    _PointCount: { type: "int", source: MARBLE_PRODUCER },
    _Rotation: { type: "vec3", source: ROTATION_PRODUCER },
    _Tilt: { type: "float", source: MARBLE_PRODUCER },
    _TiltRotation: { type: "float", source: MARBLE_PRODUCER },
    _WorldFront: { type: "vec3", source: MARBLE_PRODUCER },
    [port.curveSampler]: { type: "sampler2D", source: CURVE_TEXTURE_PRODUCER },
  };
  let linkedVertex = null;
  const result = await generateExactSelectorPort({
    shader: SHADER,
    generatedBy: GENERATED_BY,
    extraction: {
      selectorId: port.selectorId,
      candidateWitnessId: port.candidateWitnessId,
      expectedProofGraphSha256: PROOF_GRAPH_SHA256,
      expectedPortIndexSha256: PORT_INDEX_SHA256,
      decryptedRoot: path.resolve(SHADER_ROOT, "..", ".."),
      prefix: port.stem,
      rootDir: ROOT,
      spirvCross: SPIRV_CROSS,
    },
    expectedSpirvCrossSha256: port.crossSha256,
    validateReflection(reflection, metadata) {
      assertReflection(reflection, metadata, port);
    },
    adaptVertex(source) {
      linkedVertex = adaptVertex(source);
      return linkedVertex;
    },
    adaptFragment(source) {
      const fragment = adaptFragment(source, port);
      assert.ok(linkedVertex, `${port.id}: adapted vertex source is unavailable`);
      validateLinkedProgram(linkedVertex, fragment, port.stem);
      return fragment;
    },
    validateWebGlStage(source, stage) {
      validateStage(source, stage, port.stem);
    },
    joinConstantBufferStages: true,
    passPolicy: PASS_POLICY,
    runtimeContract: {
      schema: "pocket-card-render/webgl-runtime-port@1",
      shader_key: port.shaderKey,
      attributes: {
        position: "vec3",
        normal: "vec3",
        uv: "vec2",
      },
      engine_uniforms: {
        modelMatrix: "mat4",
        viewMatrix: "mat4",
        projectionMatrix: "mat4",
        cameraPosition: "vec3",
      },
      material_uniforms: port.materialUniforms,
      dynamic_uniforms: dynamicUniforms,
      require_complete_active_bindings: true,
      camera_from_view: true,
      mrt_attachments: 2,
      stencil_normalization: "none",
      stencil_face_mode: "generic",
      backend_basis_conversions: {
        fragment: FRAGMENT_BASIS_CONVERSIONS,
      },
    },
    substitutions: {
      vertex: [
        "map official Vertex/Normal/UV0 channels to Three.js r165 position/normal/uv",
        "map unity_ObjectToWorld, unity_WorldToObject and unity_MatrixVP to Three.js engine matrices",
        "remove Unity Vulkan clip-space Y inversion for WebGL clip space",
      ],
      fragment: [
        "flatten the official variant-local PGlobals block to same-name typed WebGL uniforms",
        "preserve _Attributes as vec4[4] and _PointCount as int",
        "bind component-driven point, tilt, front, rotation and world-front values to explicit unresolved producers",
        "bind the active curve sampler to an explicit unresolved dynamic texture producer",
        "convert Three.js world-space inputs back to Unity data axes before official SSA arithmetic",
        "do not substitute normalized pointer tilt for the official point-position simulation",
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
        { kind: "engine-uniform-binding", contract: "unity-builtins-to-three-r165" },
        {
          kind: "uniform-buffer-flattening",
          source: "variant-local",
          preservation: "names-types-precision",
        },
        { kind: "object-basis-conversion", contract: "unity-to-three-basis" },
        {
          kind: "dynamic-uniform-producer-binding",
          contract: "runtime-producer-to-three-uniforms",
        },
        { kind: "glsl-version-ownership", owner: "three-raw-shader-material" },
      ],
    },
    webglSources: {
      vertex: `public/shaders/${port.stem}.vert.glsl`,
      fragment: `public/shaders/${port.stem}.frag.glsl`,
    },
    manifestExtras: {
      mrt: port.mrt,
      runtime_boundaries: [
        {
          status: "partial-exact",
          scope: "component-uniform-producer",
          producer: MARBLE_PRODUCER,
          il2cpp_evidence: {
            type: "Lettuce.Infrastructure.Card.Core.CardMarbleLayer",
            methods: [
              "Validate", "Initialize", "FixedUpdate", "UpdateTilt",
              "UpdatePointGoals", "UpdatePosition", "UpdateMarble", "ApplyParams",
            ],
          },
          payload: [
            { name: "_Attributes", type: "vec4[4]" },
            { name: "_PointCount", type: "int" },
            { name: "_Tilt", type: "float" },
            { name: "_Front", type: "vec2" },
            { name: "_TiltRotation", type: "float" },
            { name: "_WorldFront", type: "vec3" },
          ],
          forbidden_substitution:
            "A normalized pointer tilt is not the official point-position simulation and must not be used as an exact producer.",
          exact_scope:
            "Serialized component parameters, ARM64 method bytes, point-state equations and MaterialPropertyBlock payload shape.",
          runtime_required:
            "Unity FixedUpdate scheduling and the submitted guest MaterialPropertyBlock values for a captured frame.",
        },
        {
          status: "partial-exact",
          scope: "component-uniform-producer",
          producer: ROTATION_PRODUCER,
          il2cpp_evidence: {
            type: "Lettuce.Infrastructure.Card.Core.CardBehaviour",
            method: "UpdateHologramRotation",
          },
          payload: [{ name: "_Rotation", type: "vec3" }],
          note:
            "CardBehaviour writes CardDataGroup.HologramRotation to every child Renderer. The canonical CardRenderer and UI loader paths construct CardDataGroup with UnityEngine.Vector3.zero; guest MaterialPropertyBlock submission remains runtime-required.",
        },
        {
          status: "runtime-required",
          scope: "dynamic-curve-texture-producer",
          producer: CURVE_TEXTURE_PRODUCER,
          il2cpp_evidence: {
            type: "Lettuce.Infrastructure.Card.Core.CardMarbleLayer/RemapCurveSettings",
            method: "ApplyParams",
          },
          payload: [{
            property: "_DefaultNoiseRemapCurveTexture",
            webgl_uniform: port.curveSampler,
            type: "sampler2D",
          }],
          exact_scope:
            "Serialized AnimationCurve keys, 2^Resolution sampling grid, curve mixing equation, clamp wrap and linear texture intent.",
          runtime_required:
            "Unity R16 quantization and the submitted guest texture object; WebGL uses an explicit R32F backend adaptation.",
        },
      ],
    },
    output: {
      outDir: OUT,
      vertex: `${port.stem}.vert.glsl`,
      fragment: `${port.stem}.frag.glsl`,
      manifest: `${port.stem}_uniforms.json`,
      check: CHECK,
    },
  });

  assert.deepEqual(
    result.samplerBindings.map(({ slot, spirvName, binding }) => ({
      slot,
      spirvName,
      binding,
    })),
    port.samplerBindings,
    `${port.id}: active sampler bindings`,
  );
  assert.deepEqual(
    result.manifest.runtime_contract.dynamic_uniforms,
    Object.fromEntries(Object.entries(dynamicUniforms).sort(([left], [right]) => left.localeCompare(right))),
    `${port.id}: typed runtime-required uniforms`,
  );
}

console.log(
  `${CHECK ? "verified" : "generated"} ${PORTS.length} Card_Parallax_Marble selector ports`,
);
