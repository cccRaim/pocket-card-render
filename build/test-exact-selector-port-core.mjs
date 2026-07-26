import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  adaptThreeViewForwardToUnityDataAxes,
  adaptThreeWorldVectorsToUnityDataAxes,
  adaptUnityObjectToWorldDataAxes,
  canonicalJson,
  canonicalJsonSha256,
  compileCommonBindings,
  compileOfficialVertexInputContract,
  compileOfficialPassContract,
  compileProgramBindings,
  generateExactSelectorPort,
  joinProgramConstantBufferStages,
  joinProgramSamplerBindings,
  joinSamplerBindings,
  parseSpirvPrecisionFacts,
  runCommand,
  sha256,
  withExtractedSelectorProgram,
  writeOrCheckOutputs,
} from "./exact-selector-port-core.mjs";
import {
  auditOfficialShaderPrecision,
  GLITTER_ALIAS_CONTRACT,
  validateFormalPortPrecisionManifest,
} from "./audit-official-shader-precision.mjs";
import { selectExactShaderPort } from "../public/render/context.js";

test("runtime selector gate is fail-closed for manifestless and derived identities", () => {
  const port = {
    vert: "vertex",
    frag: "fragment",
    manifest: {
      shader: "Exact-Port",
      official_selector: {
        shaderIdentity: "CAB:test:1", shaderName: "Lettuce/Test/Exact-Port", keywords: ["B", "A"],
      },
    },
  };
  const ports = { "Exact-Port": port, Legacy: { vert: "legacy", frag: "legacy" } };
  const recipe = { official: { shader: "CAB:test:1", validKeywords: ["A", "B"] }, keywords: ["derived"] };
  assert.deepEqual(selectExactShaderPort(ports, recipe, "Exact-Port"), port);
  assert.equal(selectExactShaderPort(ports, recipe, "Legacy"), null);
  assert.equal(selectExactShaderPort(ports, { keywords: ["A", "B"] }, "Exact-Port"), null);
  assert.equal(selectExactShaderPort(ports, { official: { shader: "CAB:test:1", validKeywords: ["A"] } }, "Exact-Port"), null);
  assert.equal(selectExactShaderPort(ports, { official: { shader: "CAB:test:2", validKeywords: ["A", "B"] } }, "Exact-Port"), null);
  assert.equal(selectExactShaderPort({ Other: port }, recipe, "Other"), null);
});

function tempDirectory(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "pcr-exact-core-test-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function spirvModule(instructions) {
  const words = [
    0x07230203,
    0x00010500,
    0,
    64,
    0,
    ...instructions.flatMap(([opcode, ...operands]) => [
      ((operands.length + 1) << 16) | opcode,
      ...operands,
    ]),
  ];
  const bytes = Buffer.alloc(words.length * 4);
  words.forEach((word, index) => bytes.writeUInt32LE(word >>> 0, index * 4));
  return bytes;
}

function precisionSpirvFixture() {
  return spirvModule([
    [17, 1],
    [17, 9],
    [22, 1, 32],
    [22, 2, 16],
    [73, 3],
    [71, 4, 0],
    [72, 5, 2, 0],
    [71, 3, 0],
    [74, 3, 6, 7],
    [71, 8, 40, 1],
    [71, 9, 39, 2],
    [71, 10, 42],
    [116, 2, 13, 14],
    [16, 11, 4459, 32],
    [331, 11, 4462, 12],
  ]);
}

test("SPIR-V precision parser closes direct/group facts and rejects structural mutations", () => {
  const facts = parseSpirvPrecisionFacts(precisionSpirvFixture());
  assert.equal(facts.schema, "pocket-card-render/spirv-stage-precision@1");
  assert.equal(facts.capabilities.Float16Buffer, 0);
  assert.equal(facts.capabilities.Float16, 1);
  assert.equal(facts.capabilities.Float16ImageAMD, 0);
  assert.equal(facts.capabilities.FloatControls2, 0);
  assert.deepEqual(facts.float_types, [
    { width: 16, declaration_count: 1 },
    { width: 32, declaration_count: 1 },
  ]);
  assert.deepEqual(facts.decorations.RelaxedPrecision, {
    decoration_value: 0,
    instruction_counts: { decorate: 2, member_decorate: 1, decorate_id: 0 },
    source_instruction_count: 3,
    direct_application_count: 2,
    group_application_count: 2,
    effective_application_count: 4,
    operand_sets: [{ operands: [], declaration_count: 3 }],
  });
  assert.equal(facts.decorations.FPFastMathMode.effective_application_count, 1);
  assert.equal(facts.decorations.FPRoundingMode.effective_application_count, 1);
  assert.equal(facts.decorations.NoContraction.effective_application_count, 1);
  assert.equal(facts.quantize_to_f16_count, 1);
  assert.deepEqual(
    facts.float_control_execution_modes.map(({ opcode, mode, operands }) => ({
      opcode,
      mode,
      operands,
    })),
    [
      { opcode: "OpExecutionMode", mode: "DenormPreserve", operands: [32] },
      { opcode: "OpExecutionModeId", mode: "RoundingModeRTE", operands: [12] },
    ],
  );
  assert.match(facts.instruction_structure_sha256, /^[0-9a-f]{64}$/);
  assert.match(facts.facts_sha256, /^[0-9a-f]{64}$/);

  const changed = parseSpirvPrecisionFacts(spirvModule([
    [17, 1],
    [22, 1, 32],
    [71, 4, 42],
  ]));
  assert.notEqual(changed.instruction_structure_sha256, facts.instruction_structure_sha256);

  const truncated = precisionSpirvFixture().subarray(0, -4);
  assert.throws(
    () => parseSpirvPrecisionFacts(truncated),
    /malformed instruction/,
  );
  const missingFloatControlWidth = spirvModule([
    [22, 1, 32],
    [16, 11, 4459],
  ]);
  assert.throws(
    () => parseSpirvPrecisionFacts(missingFloatControlWidth),
    /invalid operand count/,
  );
});

function parameter(val, name = "<noninit>") {
  return { val, name };
}

function blend() {
  return {
    srcBlend: parameter(1), destBlend: parameter(0),
    srcBlendAlpha: parameter(1), destBlendAlpha: parameter(0),
    blendOp: parameter(0), blendOpAlpha: parameter(0), colMask: parameter(15),
  };
}

function stencil() {
  return { pass: parameter(0), fail: parameter(0), zFail: parameter(0), comp: parameter(8) };
}

function passFixture() {
  return {
    state: {
      rtBlend0: blend(), rtSeparateBlend: false,
      zClip: parameter(1), zTest: parameter(4, "_ZTest"), zWrite: parameter(0, "_ZWrite"),
      culling: parameter(2), conservative: parameter(0), offsetFactor: parameter(0),
      offsetUnits: parameter(0), alphaToMask: parameter(0),
      stencilOp: stencil(), stencilOpFront: stencil(), stencilOpBack: stencil(),
      stencilReadMask: parameter(255), stencilWriteMask: parameter(255), stencilRef: parameter(0, "_StencilRef"),
      fogMode: -1, lighting: false,
    },
  };
}

const PASS_POLICY = {
  rtSeparateBlend: false,
  fixed: {
    zClip: { val: 1, name: null }, conservative: { val: 0, name: null },
    offsetFactor: { val: 0, name: null }, offsetUnits: { val: 0, name: null },
    alphaToMask: { val: 0, name: null }, fogMode: -1, lighting: false,
  },
};

function commonBindingsFixture() {
  return {
    nameIndices: [["_MainTex", 0], ["_CubeMap", 1], ["VGlobals", 2], ["unity_MatrixVP", 3]],
    commonParameters: {
      progVertex: {
        m_TextureParams: [
          { m_NameIndex: 1, m_Index: 0x08000001, m_SamplerIndex: -1, m_MultiSampled: false, m_Dim: 4 },
          { m_NameIndex: 0, m_Index: 0x08000000, m_SamplerIndex: -1, m_MultiSampled: false, m_Dim: 2 },
        ],
        m_ConstantBuffers: [{
          m_NameIndex: 2,
          m_MatrixParams: [{ m_NameIndex: 3, m_Index: 0, m_ArraySize: 0, m_Type: 0, m_RowCount: 4 }],
          m_VectorParams: [], m_StructParams: [], m_Size: 64, m_IsPartialCB: true,
        }],
        m_ConstantBufferBindings: [{ m_NameIndex: 2, m_Index: 0x04010000, m_ArraySize: 1 }],
        m_BufferParams: [], m_UAVParams: [], m_Samplers: [],
      },
      progFragment: {
        m_TextureParams: [], m_ConstantBuffers: [], m_ConstantBufferBindings: [],
        m_BufferParams: [], m_UAVParams: [], m_Samplers: [],
      },
    },
  };
}

function mixedParameterFixture() {
  return {
    version: 202012090,
    constantBlockCount: 3,
    constantBuffers: [
      { name: "", size: 0, fields: [] },
      { name: "VGlobals", size: 64, fields: [] },
      { name: "PGlobalsVariant", size: 16, fields: [{
        name: "_Intensity", offset: 0, descriptor: [0, 1, 1, 0, 0, 0],
      }] },
    ],
    resourceCount: 2,
    resourceDecoding: "material-property-disambiguated",
    textures: [{
      name: "_DetailTex", binding: 2, encodedIndex: 0x08000002,
      descriptor: [0, 0x08000002, 0xffffffff, 4],
    }],
    constantBufferBindings: [{
      name: "PGlobalsVariant", descriptor: [1, 0x08010001, 0],
    }],
    serializedCommonBuffers: [{ name: "VGlobals", size: 64 }],
    serializedCommonTextures: [
      { name: "_MainTex", binding: 0, encodedIndex: 0x08000000, dim: 2 },
      { name: "_CubeMap", binding: 1, encodedIndex: 0x08000001, dim: 4 },
    ],
    bindingClosure: {
      constantBuffersMatch: true,
      constantBufferDeclarationMode: "mixed-common-and-variant",
      commonConstantBufferCount: 1,
      variantConstantBufferCount: 1,
      variantTextureCount: 1,
      commonTextureCount: 2,
      constantBufferBindingCount: 1,
    },
  };
}

function mixedDefaultsFixture() {
  return {
    textures: { _DetailTex: "white" },
    textureDescriptors: {
      _MainTex: { defaultName: "", dimension: 2 },
      _CubeMap: { defaultName: "", dimension: 4 },
      _DetailTex: { defaultName: "white", dimension: 2 },
    },
    floats: {}, colors: {}, vectors: {},
  };
}

test("canonical JSON has a stable order and known SHA-256", () => {
  const left = { b: 1, a: [true, null] };
  const right = { a: [true, null], b: 1 };
  assert.equal(canonicalJson(left), '{"a":[true,null],"b":1}');
  assert.equal(canonicalJsonSha256(left), "51705a2c9eb3e7e410a58f696a770c3ac3885a0cf43eb7fc88f5e47c11d4d30d");
  assert.equal(canonicalJsonSha256(left), canonicalJsonSha256(right));
  assert.throws(() => canonicalJson({ bad: undefined }), /non-JSON value/);
});

function bindChannelFixture(channels = [
  { index: 0, source: 0, sourceName: "Vertex", target: 13, targetName: "Attrib1" },
  { index: 1, source: 5, sourceName: "UV1", target: 16, targetName: "Attrib4" },
  { index: 2, source: 3, sourceName: "Color", target: 17, targetName: "Attrib5" },
]) {
  const source = {
    header: { version: 202012090, programType: 25 },
    mergedKeywords: [],
    programDataOffset: 32,
    programDataByteSize: 4,
    programDataSha256: "0".repeat(64),
    serializedSourceMap: channels.reduce((mask, row) => mask | (1 << row.source), 0),
    bindChannels: channels,
  };
  return { ...source, sha256: canonicalJsonSha256(source) };
}

test("official vertex inputs join bind semantics to SPIR-V locations and Three attributes", () => {
  const contract = compileOfficialVertexInputContract(bindChannelFixture(), {
    inputs: [
      { location: 0, name: "_position", type: "vec4" },
      { location: 3, name: "_uv1", type: "vec2" },
      { location: 4, name: "_color", type: "vec4" },
    ],
  });
  assert.deepEqual(contract.inputs.map(({ sourceName, location, threeAttribute }) => ({
    sourceName, location, threeAttribute,
  })), [
    { sourceName: "Vertex", location: 0, threeAttribute: "position" },
    { sourceName: "UV1", location: 3, threeAttribute: "uv1" },
    { sourceName: "Color", location: 4, threeAttribute: "color" },
  ]);
});

test("official vertex input join fails on hash, target/location, and unbound input drift", () => {
  const reflected = { inputs: [
    { location: 0, name: "_position", type: "vec4" },
    { location: 3, name: "_uv1", type: "vec2" },
    { location: 4, name: "_color", type: "vec4" },
  ] };
  const badHash = bindChannelFixture();
  badHash.bindChannels[1].sourceName = "UV2";
  assert.throws(() => compileOfficialVertexInputContract(badHash, reflected), /hash changed/);

  const badTarget = bindChannelFixture();
  badTarget.bindChannels[1].target = 15;
  badTarget.bindChannels[1].targetName = "Attrib3";
  badTarget.sha256 = canonicalJsonSha256(Object.fromEntries(
    Object.entries(badTarget).filter(([key]) => key !== "sha256"),
  ));
  assert.throws(() => compileOfficialVertexInputContract(badTarget, reflected), /no SPIR-V input/);

  assert.throws(() => compileOfficialVertexInputContract(bindChannelFixture(), {
    inputs: [...reflected.inputs, { location: 5, name: "_extra", type: "vec2" }],
  }), /absent from official bind channels/);
});

test("Unity ObjectToWorld data-axis adaptation recovers C * Mthree * A and fails closed", () => {
  const source = `precision highp float;
uniform mat4 modelMatrix;
void main()
{
  vec3 x = modelMatrix[1].xyz + modelMatrix[2].xyz;
  vec3 z = -modelMatrix[2].xyz;
}`;
  const adapted = adaptUnityObjectToWorldDataAxes(source, {
    matrixName: "modelMatrix",
    expectedCounts: { 1: 1, 2: 2 },
  });
  assert.match(adapted, /pcrUnityObjectToWorldAxisY\(modelMatrix\)/);
  assert.equal((adapted.match(/pcrUnityObjectToWorldAxisZ\(modelMatrix\)/g) || []).length, 2);
  assert.match(adapted, /vec3\(threeModelMatrix\[2\]\.x, threeModelMatrix\[2\]\.y, -threeModelMatrix\[2\]\.z\)/);
  assert.throws(() => adaptUnityObjectToWorldDataAxes(source, {
    matrixName: "modelMatrix", expectedCounts: { 2: 1 },
  }), /occurrence count changed/);
  assert.throws(() => adaptUnityObjectToWorldDataAxes(source, {
    matrixName: "modelMatrix", expectedCounts: {},
  }), /must name unique columns/);
});

test("Three world vectors are converted to Unity data axes with exact occurrence counts", () => {
  const source = `precision highp float;
uniform vec3 cameraPosition;
in vec3 worldPosition;
in vec3 worldNormal;
void main()
{
  vec3 view = cameraPosition - worldPosition;
  float facing = dot(worldNormal, view) + worldNormal.z;
}`;
  const adapted = adaptThreeWorldVectorsToUnityDataAxes(source, {
    bindings: [
      { source: "cameraPosition", alias: "unityCameraPosition", expectedOccurrences: 1 },
      { source: "worldPosition", alias: "unityWorldPosition", expectedOccurrences: 1 },
      { source: "worldNormal", alias: "unityWorldNormal", expectedOccurrences: 2 },
    ],
  });
  assert.match(adapted, /vec3\(cameraPosition\.xy, -cameraPosition\.z\)/);
  assert.match(adapted, /unityCameraPosition - unityWorldPosition/);
  assert.match(adapted, /dot\(unityWorldNormal, view\) \+ unityWorldNormal\.z/);
  assert.throws(() => adaptThreeWorldVectorsToUnityDataAxes(source, {
    bindings: [{ source: "worldNormal", alias: "unityWorldNormal", expectedOccurrences: 1 }],
  }), /occurrence count changed/);
  assert.throws(() => adaptThreeWorldVectorsToUnityDataAxes(source, {
    bindings: [{ source: "worldNormal", alias: "worldNormal", expectedOccurrences: 2 }],
  }), /aliases must be unique/);
});

test("Three camera forward reconstructed from viewMatrix is converted to Unity data axes", () => {
  const source = `uniform mat4 viewMatrix;
void main()
{
    _9.x = -viewMatrix[0].z;
    _9.y = -viewMatrix[1].z;
    _9.z = -viewMatrix[2].z;
}`;
  const adapted = adaptThreeViewForwardToUnityDataAxes(source, {
    matrixName: "viewMatrix",
    targetName: "_9",
  });
  assert.match(adapted, /_9\.x = -viewMatrix\[0\]\.z;/);
  assert.match(adapted, /_9\.y = -viewMatrix\[1\]\.z;/);
  assert.match(adapted, /_9\.z = viewMatrix\[2\]\.z;/);
  assert.throws(() => adaptThreeViewForwardToUnityDataAxes(
    source.replace("_9.z = -viewMatrix[2].z;", "_9.z = viewMatrix[2].z;"),
    { matrixName: "viewMatrix", targetName: "_9" },
  ), /view-forward assignment changed/);
});

test("common sampler bindings join by descriptor binding and dimension", () => {
  const bindings = compileCommonBindings(commonBindingsFixture());
  assert.equal(bindings.schema, "pocket-card-render/compiled-common-bindings@1");
  assert.deepEqual(bindings.textures.map(({ name, set, binding, dim }) => ({ name, set, binding, dim })), [
    { name: "_MainTex", set: 0, binding: 0, dim: 2 },
    { name: "_CubeMap", set: 0, binding: 1, dim: 4 },
  ]);
  assert.deepEqual(bindings.constant_buffer_bindings.map(({ name, set, binding }) => ({ name, set, binding })), [
    { name: "VGlobals", set: 1, binding: 0 },
  ]);
  const joined = joinSamplerBindings(bindings, {
    textures: [
      { name: "_cube", type: "samplerCube", set: 0, binding: 1 },
      { name: "_main", type: "sampler2D", set: 0, binding: 0 },
    ],
  });
  assert.deepEqual(joined.map(({ slot, spirvName, binding }) => ({ slot, spirvName, binding })), [
    { slot: "_MainTex", spirvName: "_main", binding: 0 },
    { slot: "_CubeMap", spirvName: "_cube", binding: 1 },
  ]);
});

test("sampler join rejects a dimension mismatch", () => {
  const bindings = compileCommonBindings(commonBindingsFixture());
  assert.throws(() => joinSamplerBindings(bindings, {
    textures: [
      { name: "_main", type: "sampler2D", set: 0, binding: 0 },
      { name: "_cube", type: "sampler2D", set: 0, binding: 1 },
    ],
  }), /requires samplerCube/);
});

test("sampler join rejects a missing official binding", () => {
  const bindings = compileCommonBindings(commonBindingsFixture());
  assert.throws(() => joinSamplerBindings(bindings, {
    textures: [{ name: "_main", type: "sampler2D", set: 0, binding: 0 }],
  }), /official sampler binding 0:1 is absent/);
});

test("program sampler join covers descriptors split across shader stages", () => {
  const bindings = compileCommonBindings(commonBindingsFixture());
  const joined = joinProgramSamplerBindings(bindings, {
    vertex: { textures: [{ name: "_cube", type: "samplerCube", set: 0, binding: 1 }] },
    fragment: { textures: [{ name: "_main", type: "sampler2D", set: 0, binding: 0 }] },
  });
  assert.deepEqual(joined.map(({ slot, spirvName, binding, stages }) => ({ slot, spirvName, binding, stages })), [
    { slot: "_MainTex", spirvName: "_main", binding: 0, stages: ["fragment"] },
    { slot: "_CubeMap", spirvName: "_cube", binding: 1, stages: ["vertex"] },
  ]);
});

test("program sampler join rejects inconsistent cross-stage aliases", () => {
  const bindings = compileCommonBindings(commonBindingsFixture());
  assert.throws(() => joinProgramSamplerBindings(bindings, {
    vertex: { textures: [
      { name: "_mainVertex", type: "sampler2D", set: 0, binding: 0 },
      { name: "_cube", type: "samplerCube", set: 0, binding: 1 },
    ] },
    fragment: { textures: [{ name: "_mainFragment", type: "sampler2D", set: 0, binding: 0 }] },
  }), /differs between vertex and fragment/);
});

test("program bindings close common and variant-local descriptors into one sampler denominator", () => {
  const program = compileProgramBindings(
    compileCommonBindings(commonBindingsFixture()),
    mixedParameterFixture(),
    mixedDefaultsFixture(),
  );
  assert.equal(program.schema, "pocket-card-render/compiled-program-bindings@1");
  assert.deepEqual(program.textures.map(({ name, set, binding, dim, source }) => ({ name, set, binding, dim, source })), [
    { name: "_MainTex", set: 0, binding: 0, dim: 2, source: "serialized-common" },
    { name: "_CubeMap", set: 0, binding: 1, dim: 4, source: "serialized-common" },
    { name: "_DetailTex", set: 0, binding: 2, dim: 2, source: "variant-local" },
  ]);
  assert.deepEqual(program.variant_constant_buffers.map(({ name, size, binding, fields }) => ({
    name, size, set: binding.set, binding: binding.binding,
    fields: fields.map(({ name: fieldName, offset }) => ({ name: fieldName, offset })),
  })), [{
    name: "PGlobalsVariant", size: 16, set: 1, binding: 1,
    fields: [{ name: "_Intensity", offset: 0 }],
  }]);
  const joined = joinProgramSamplerBindings(program, {
    vertex: { textures: [{ name: "_cube", type: "samplerCube", set: 0, binding: 1 }] },
    fragment: { textures: [
      { name: "_main", type: "sampler2D", set: 0, binding: 0 },
      { name: "_detail", type: "sampler2D", set: 0, binding: 2 },
    ] },
  });
  assert.deepEqual(joined.map(({ slot, spirvName, stages }) => ({ slot, spirvName, stages })), [
    { slot: "_MainTex", spirvName: "_main", stages: ["fragment"] },
    { slot: "_CubeMap", spirvName: "_cube", stages: ["vertex"] },
    { slot: "_DetailTex", spirvName: "_detail", stages: ["fragment"] },
  ]);
});

test("program UBO stages are joined from official buffer sizes and SPIRV-Cross reflection", () => {
  const program = {
    schema: "pocket-card-render/compiled-program-bindings@1",
    textures: [],
    common_constant_buffers: [
      { name: "PGlobals", size: 32 },
      { name: "VGlobals", size: 296 },
    ],
    common_constant_buffer_bindings: [],
    variant_constant_buffers: [],
  };
  const joined = joinProgramConstantBufferStages(program, {
    vertex: { ubos: [{ name: "_17_19", block_size: 296 }] },
    fragment: { ubos: [{ name: "_23_25", block_size: 32 }] },
  });
  assert.deepEqual(joined.common_constant_buffers.map(({ name, stages }) => ({ name, stages })), [
    { name: "PGlobals", stages: ["progFragment"] },
    { name: "VGlobals", stages: ["progVertex"] },
  ]);

  assert.throws(() => joinProgramConstantBufferStages({
    ...program,
    common_constant_buffers: [
      { name: "PGlobals", size: 32 },
      { name: "OtherGlobals", size: 32 },
    ],
  }, {
    vertex: { ubos: [] },
    fragment: { ubos: [{ name: "_23_25", block_size: 32 }] },
  }), /not unique across official program buffers/);

  assert.throws(() => joinProgramConstantBufferStages(program, {
    vertex: { ubos: [{ name: "_17_19", block_size: 296 }, { name: "_extra", block_size: 64 }] },
    fragment: { ubos: [{ name: "_23_25", block_size: 32 }] },
  }), /reflected UBO closure is incomplete/);
});

test("program bindings reject a common/variant descriptor collision", () => {
  const parameter = mixedParameterFixture();
  parameter.textures[0].binding = 1;
  parameter.textures[0].encodedIndex = 0x08000001;
  parameter.textures[0].descriptor[1] = 0x08000001;
  assert.throws(() => compileProgramBindings(
    compileCommonBindings(commonBindingsFixture()), parameter, mixedDefaultsFixture(),
  ), /duplicate program texture binding 0:1/);
});

test("program bindings reject parameter UBO offset drift and missing bindings", () => {
  const drifted = mixedParameterFixture();
  drifted.constantBuffers[2].fields[0].descriptor[5] = 4;
  assert.throws(() => compileProgramBindings(
    compileCommonBindings(commonBindingsFixture()), drifted, mixedDefaultsFixture(),
  ), /descriptor offset disagrees/);

  const missing = mixedParameterFixture();
  missing.constantBufferBindings = [];
  missing.bindingClosure.constantBufferBindingCount = 0;
  assert.throws(() => compileProgramBindings(
    compileCommonBindings(commonBindingsFixture()), missing, mixedDefaultsFixture(),
  ), /has no descriptor binding/);
});

test("program sampler join rejects a variant-local texture dimension mismatch", () => {
  const program = compileProgramBindings(
    compileCommonBindings(commonBindingsFixture()), mixedParameterFixture(), mixedDefaultsFixture(),
  );
  assert.throws(() => joinProgramSamplerBindings(program, {
    vertex: { textures: [{ name: "_cube", type: "samplerCube", set: 0, binding: 1 }] },
    fragment: { textures: [
      { name: "_main", type: "sampler2D", set: 0, binding: 0 },
      { name: "_detail", type: "samplerCube", set: 0, binding: 2 },
    ] },
  }), /_DetailTex dimension 2 requires sampler2D/);
});

test("pass contract is policy-bound and preserves material parameters", () => {
  const sourceSha256 = "a".repeat(64);
  const compiled = compileOfficialPassContract(passFixture(), { sourceSha256, policy: PASS_POLICY });
  assert.equal(compiled.source_sha256, sourceSha256);
  assert.equal(compiled.shared_mrt_blend, true);
  assert.deepEqual(compiled.depth, {
    test: { val: 4, name: "_ZTest" }, write: { val: 0, name: "_ZWrite" },
  });
  assert.deepEqual(compiled.stencil.ref, { val: 0, name: "_StencilRef" });

  const changed = passFixture();
  changed.state.alphaToMask.val = 1;
  assert.throws(
    () => compileOfficialPassContract(changed, { sourceSha256, policy: PASS_POLICY }),
    /fixed pass state changed/,
  );
  const incomplete = passFixture();
  delete incomplete.state.stencilOpBack.comp;
  assert.throws(
    () => compileOfficialPassContract(incomplete, { sourceSha256, policy: PASS_POLICY }),
    /stencilOpBack fields changed/,
  );
});

test("write-or-check detects drift without repairing it", (t) => {
  const outDir = tempDirectory(t);
  const outputs = { "nested/a.txt": "official\n", "b.bin": Buffer.from([1, 2, 3]) };
  writeOrCheckOutputs(outputs, { outDir, check: false });
  writeOrCheckOutputs(outputs, { outDir, check: true });
  const drifted = path.join(outDir, "nested", "a.txt");
  fs.writeFileSync(drifted, "drift\n");
  assert.throws(() => writeOrCheckOutputs(outputs, { outDir, check: true }), /a\.txt drifted/);
  assert.equal(fs.readFileSync(drifted, "utf8"), "drift\n");
  assert.throws(() => writeOrCheckOutputs({ "../escape": "x" }, { outDir }), /escapes its root/);
});

test("command runner resolves Windows batch shims", { skip: process.platform !== "win32" }, (t) => {
  const directory = tempDirectory(t);
  const shim = path.join(directory, "echo-args.cmd");
  fs.writeFileSync(shim, "@echo off\r\necho %1\r\n");
  assert.equal(runCommand(shim, ["selector-bound"], { cwd: directory }).trim(), "selector-bound");
});

test("selector extraction validates hashes, reflects both stages, and always removes its temp directory", async (t) => {
  const root = tempDirectory(t);
  const decryptedRoot = path.join(root, "decrypted");
  const extractor = path.join(root, "extractor.py");
  fs.mkdirSync(decryptedRoot);
  fs.writeFileSync(extractor, "# commandRunner stub\n");
  const selectorId = "1".repeat(64);
  const candidateWitnessId = "2".repeat(64);
  const proofGraphSha256 = "3".repeat(64);
  const portIndexSha256 = "4".repeat(64);
  let capturedTempDir;
  let validatedStageCount = 0;

  function commandRunner(command, args) {
    if (command === "spirv-val-stub") {
      assert.equal(args.length, 1);
      validatedStageCount += 1;
      return "";
    }
    if (command === "spirv-cross-stub") {
      return JSON.stringify({ inputs: [], outputs: [], textures: [], ubos: [] });
    }
    assert.equal(command, "python-stub");
    const option = (name) => args[args.indexOf(name) + 1];
    const out = option("--out");
    const prefix = option("--prefix");
    const metadataFile = option("--metadata");
    const bytes = {
      vertex: precisionSpirvFixture(),
      fragment: precisionSpirvFixture(),
      parameterEntry: Buffer.from("parameter"),
    };
    const paths = {
      vertex: `${prefix}_vert.spv`, fragment: `${prefix}_frag.spv`, parameterEntry: `${prefix}_parameter.bin`,
    };
    for (const key of Object.keys(bytes)) fs.writeFileSync(path.join(out, paths[key]), bytes[key]);
    const commonBindings = { nameIndices: [], commonParameters: {} };
    const parameterReflection = { version: 1, bindingClosure: { constantBuffersMatch: true } };
    const metadata = {
      schema: "pocket-card-render/official-selector-program-extract@1",
      inventory: { proofGraphSha256, portIndexSha256 },
      selector: { selectorId, candidateWitnessId },
      identityFields: {
        vertexSpirvSha256: sha256(bytes.vertex), fragmentSpirvSha256: sha256(bytes.fragment),
        parameterEntrySha256: sha256(bytes.parameterEntry), passStateSha256: "5".repeat(64),
        commonBindingsSha256: canonicalJsonSha256(commonBindings),
      },
      artifacts: Object.fromEntries(Object.keys(bytes).map((key) => [key, {
        path: paths[key], byteSize: bytes[key].length, sha256: sha256(bytes[key]),
      }])),
      commonBindings,
      parameterReflection,
      parameterReflectionSha256: canonicalJsonSha256(parameterReflection),
      passContract: { state: {} },
    };
    fs.writeFileSync(metadataFile, `${JSON.stringify(metadata, null, 2)}\n`);
    return "";
  }

  const extractionOptions = {
    selectorId,
    candidateWitnessId,
    expectedProofGraphSha256: proofGraphSha256,
    expectedPortIndexSha256: portIndexSha256,
    prefix: "fixture",
    decryptedRoot,
    rootDir: root,
    extractor,
    python: "python-stub",
    spirvVal: "spirv-val-stub",
    spirvCross: "spirv-cross-stub",
    commandRunner,
    tempParent: root,
  };
  const result = await withExtractedSelectorProgram(extractionOptions, ({ tempDir, reflection, files }) => {
    capturedTempDir = tempDir;
    assert.ok(fs.existsSync(tempDir));
    assert.deepEqual(fs.readFileSync(files.vertexSpirv), precisionSpirvFixture());
    assert.deepEqual(reflection.vertex.textures, []);
    assert.deepEqual(reflection.fragment.textures, []);
    return "validated";
  });
  assert.equal(result, "validated");
  assert.equal(validatedStageCount, 2);
  assert.equal(fs.existsSync(capturedTempDir), false);

  let failedTempDir;
  await assert.rejects(
    withExtractedSelectorProgram(extractionOptions, ({ tempDir }) => {
      failedTempDir = tempDir;
      throw new Error("callback failure");
    }),
    /callback failure/,
  );
  assert.equal(validatedStageCount, 4);
  assert.equal(fs.existsSync(failedTempDir), false);

  const independentlyComputed = crypto.createHash("sha256")
    .update(precisionSpirvFixture())
    .digest("hex");
  assert.equal(independentlyComputed, sha256(precisionSpirvFixture()));
});

test("high-level selector generator closes the standard manifest envelope and fails closed", async (t) => {
  const root = tempDirectory(t);
  const vertexSpirv = path.join(root, "fixture.vert.spv");
  const fragmentSpirv = path.join(root, "fixture.frag.spv");
  const parameterEntry = path.join(root, "fixture.parameter.bin");
  fs.writeFileSync(vertexSpirv, precisionSpirvFixture());
  fs.writeFileSync(fragmentSpirv, precisionSpirvFixture());
  fs.writeFileSync(parameterEntry, "parameter");
  const officialVertex = "official vertex\n";
  const officialFragment = "official fragment\n";
  const commonBindings = commonBindingsFixture();
  const parameterReflection = mixedParameterFixture();
  const reflection = {
    vertex: { inputs: [], outputs: [], ubos: [], textures: [{ name: "_main", type: "sampler2D", set: 0, binding: 0 }] },
    fragment: { inputs: [], outputs: [], ubos: [], textures: [
      { name: "_cube", type: "samplerCube", set: 0, binding: 1 },
      { name: "_detail", type: "sampler2D", set: 0, binding: 2 },
    ] },
  };
  const metadata = {
    selector: {
      selectorId: "1".repeat(64),
      candidateWitnessId: "2".repeat(64),
      semanticExecutableId: "4".repeat(64),
      keywords: [],
      subshader: 0,
      pass: 0,
    },
    identityFields: {
      vertexSpirvSha256: sha256FileForTest(vertexSpirv),
      fragmentSpirvSha256: sha256FileForTest(fragmentSpirv),
      parameterEntrySha256: sha256FileForTest(parameterEntry),
      passStateSha256: "3".repeat(64),
      commonBindingsSha256: canonicalJsonSha256(commonBindings),
    },
    artifacts: { parameterEntry: { byteSize: fs.statSync(parameterEntry).size } },
    parameterReflection,
    parameterReflectionSha256: canonicalJsonSha256(parameterReflection),
    commonBindings,
    programBindChannels: bindChannelFixture([]),
    shaderPropertyDefaults: mixedDefaultsFixture(),
    passContract: passFixture(),
  };
  const files = { vertexSpirv, fragmentSpirv, parameterEntry };
  const extractProgram = async (_options, callback) => callback({ metadata, files, reflection });
  const commandRunner = (_command, args) => (
    args[0] === vertexSpirv ? officialVertex : officialFragment
  );
  const base = {
    extraction: { rootDir: root },
    extractProgram,
    commandRunner,
    shader: "Lettuce/Test/Exact",
    generatedBy: "build/test-exact-selector-port-core.mjs",
    expectedSpirvCrossSha256: { vertex: sha256(officialVertex), fragment: sha256(officialFragment) },
    passPolicy: PASS_POLICY,
    adaptVertex: (source) => `${source}adapted vertex\n`,
    adaptFragment: (source) => `${source}adapted fragment\n`,
    validateReflection: (value) => assert.equal(value, reflection),
    substitutions: {
      vertex: ["remove Unity Vulkan clip-space Y inversion for WebGL clip space"],
      fragment: ["remove #version directive supplied by Three.js RawShaderMaterial"],
    },
    adaptationOperations: {
      vertex: [{
        kind: "clip-space-y-conversion",
        from: "unity-vulkan",
        to: "webgl",
        operation: "remove-y-inversion",
      }, {
        kind: "glsl-version-ownership",
        owner: "three-raw-shader-material",
      }],
      fragment: [{
        kind: "glsl-version-ownership",
        owner: "three-raw-shader-material",
      }],
    },
    webglSources: { vertex: "public/shaders/test.vert", fragment: "public/shaders/test.frag" },
    runtimeContract: { schema: "test", shader_key: "Exact", engine_uniforms: {} },
    output: { outDir: root, vertex: "test.vert", fragment: "test.frag", manifest: "test.json" },
  };
  const generated = await generateExactSelectorPort(base);
  assert.equal(generated.manifest.sampler_bindings.length, 3);
  assert.equal(generated.manifest.official_selector.selectorId, metadata.selector.selectorId);
  assert.equal(
    generated.manifest.official_spirv_precision.schema,
    "pocket-card-render/official-spirv-precision@1",
  );
  assert.equal(
    generated.manifest.official_spirv_precision.vulkan_to_webgl_equivalence,
    "not-claimed",
  );
  assert.equal(
    generated.manifest.official_spirv_precision.stages.vertex
      .decorations.RelaxedPrecision.effective_application_count,
    4,
  );
  const formalPort = {
    selectorId: metadata.selector.selectorId,
    candidateWitnessId: metadata.selector.candidateWitnessId,
    subshader: metadata.selector.subshader,
    pass: metadata.selector.pass,
    semanticExecutableId: metadata.selector.semanticExecutableId,
    generator: base.generatedBy,
    officialIdentityFields: metadata.identityFields,
  };
  assert.doesNotThrow(() => validateFormalPortPrecisionManifest(
    generated.manifest,
    formalPort,
    "generated test manifest",
  ));
  const missingPrecision = structuredClone(generated.manifest);
  delete missingPrecision.official_spirv_precision;
  assert.throws(
    () => validateFormalPortPrecisionManifest(missingPrecision, formalPort, "missing precision manifest"),
    /official_spirv_precision is absent/,
  );
  const missingStageField = structuredClone(generated.manifest);
  delete missingStageField.official_spirv_precision.stages.fragment.facts_sha256;
  assert.throws(
    () => validateFormalPortPrecisionManifest(missingStageField, formalPort, "missing stage field manifest"),
    /fields changed/,
  );
  const shaderDir = path.join(root, "public", "shaders");
  fs.mkdirSync(shaderDir, { recursive: true });
  const glitterVertex = `precision highp float;
uniform highp vec4 _FlowParams[2];
uniform mediump float _FakeCameraHeight;
uniform mediump float _Height;
uniform mediump float _HeightPower;
uniform mediump float _Scale;
uniform mediump float _FlowScale;
uniform mediump float _FakeCameraHeightB;
uniform mediump float _HeightB;
uniform mediump float _HeightPowerB;
uniform mediump float _ScaleB;
uniform mediump float _FlowScaleB;
in mediump vec4 tangent;
`;
  const glitterFragment = `precision mediump float;
uniform highp vec4 _FlowParams[2];
uniform highp float _FadeDuration;
uniform highp float _FlowAPower;
uniform highp float _FlowBPower;
uniform vec4 _LightColor;
uniform highp float _LightTime;
uniform highp float _EmitThreshold;
layout(location = 1) out highp vec4 _1092;
void main() {
  _1092 = vec4(0.0);
}
`;
  fs.writeFileSync(path.join(shaderDir, "glitter.vert.glsl"), glitterVertex);
  fs.writeFileSync(path.join(shaderDir, "glitter.frag.glsl"), glitterFragment);
  const auditManifest = {
    ...generated.manifest,
    shader: "Lettuce/Common/CardNew/Face/Card_UR_Glitter_FlowMaps",
    webgl_sources: {
      vertex: "public/shaders/glitter.vert.glsl",
      fragment: "public/shaders/glitter.frag.glsl",
    },
  };
  fs.writeFileSync(
    path.join(shaderDir, "glitter.json"),
    `${JSON.stringify(auditManifest, null, 2)}\n`,
  );
  fs.writeFileSync(
    path.join(shaderDir, "official_program_port_contract.json"),
    `${JSON.stringify({
      schema: "pocket-card-render/official-program-port-contract@2",
      ports: [{
        ...formalPort,
        manifest: "public/shaders/glitter.json",
      }],
    }, null, 2)}\n`,
  );
  const testGlitterAliasContract = structuredClone(GLITTER_ALIAS_CONTRACT);
  testGlitterAliasContract.selectorId = formalPort.selectorId;
  testGlitterAliasContract.candidateWitnessId = formalPort.candidateWitnessId;
  testGlitterAliasContract.stages.vertex.officialSpirvSha256 =
    metadata.identityFields.vertexSpirvSha256;
  testGlitterAliasContract.stages.fragment.officialSpirvSha256 =
    metadata.identityFields.fragmentSpirvSha256;
  const audit = auditOfficialShaderPrecision({
    rootDir: root,
    glitterAliasContract: testGlitterAliasContract,
  });
  assert.deepEqual(audit.denominator, {
    formal_ports: 1,
    manifests: 1,
    stage_references: 2,
    unique_stage_hashes: 1,
  });
  assert.deepEqual(audit.webgl_precision_equivalence, {
    exact_unique_stage_hashes: 0,
    denominator_unique_stage_hashes: 1,
    status: "not-claimed",
  });
  assert.equal(generated.manifest.webgl_adaptation.schema, "pocket-card-render/webgl-stage-adaptation@2");
  assert.match(generated.manifest.webgl_adaptation.operationGraphSha256, /^[0-9a-f]{64}$/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, "test.json"))).shader, "Lettuce/Test/Exact");
  await generateExactSelectorPort({ ...base, output: { ...base.output, check: true } });
  await assert.rejects(
    generateExactSelectorPort({
      ...base,
      expectedSpirvCrossSha256: { ...base.expectedSpirvCrossSha256, vertex: "f".repeat(64) },
    }),
    /vertex SPIRV-Cross output changed/,
  );
  const badReflection = structuredClone(reflection);
  badReflection.fragment.textures[0].set = 2;
  await assert.rejects(
    generateExactSelectorPort({
      ...base,
      extractProgram: async (_options, callback) => callback({ metadata, files, reflection: badReflection }),
      validateReflection: () => {},
    }),
    /binding 2:1 is absent from official common bindings/,
  );
});

function sha256FileForTest(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}
