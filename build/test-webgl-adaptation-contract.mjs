import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  buildWebglAdaptationV2,
  compileBasisConversionContract,
  compileTextureCoordinateContract,
  compileWebglAdaptationContract,
  LEGACY_CLAIM_SET_SHA256,
  legacyClaimSetSha256,
  WEBGL_ADAPTATION_BACKEND,
  WEBGL_ADAPTATION_SCHEMA_V1,
  WEBGL_ADAPTATION_SCHEMA_V2,
  validateBasisConversionSourceText,
  validateTextureCoordinateSourceText,
} from "./webgl-adaptation-contract.mjs";
import { unityTexEnvToThreeGltfSt } from "../public/render/texture-transform.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HASH = "1".repeat(64);

function structuredFixture() {
  return {
    schema: WEBGL_ADAPTATION_SCHEMA_V2,
    backend: WEBGL_ADAPTATION_BACKEND,
    vertex: {
      officialSpirvSha256: HASH,
      spirvCrossGlslSha256: HASH,
      outputSha256: HASH,
      operations: [
        {
          kind: "clip-space-y-conversion",
          from: "unity-vulkan",
          to: "webgl",
          operation: "remove-y-inversion",
        },
        {
          kind: "vertex-input-binding",
          contract: "official-bind-channels-to-three-r165",
          mappingSha256: HASH,
        },
        {
          kind: "glsl-version-ownership",
          owner: "three-raw-shader-material",
        },
      ],
    },
    fragment: {
      officialSpirvSha256: HASH,
      spirvCrossGlslSha256: HASH,
      outputSha256: HASH,
      operations: [{
        kind: "uniform-buffer-flattening",
        source: "serialized-common",
        preservation: "names-types-precision",
        bindingContractSha256: HASH,
      }, {
        kind: "glsl-version-ownership",
        owner: "three-raw-shader-material",
      }],
    },
    interfaceSha256: HASH,
  };
}

test("structured operations normalize to a stable graph", () => {
  const fixture = structuredFixture();
  const first = compileWebglAdaptationContract(fixture, {
    sourceHashes: { vertex: HASH, fragment: HASH },
  });
  fixture.vertex.operations.reverse();
  const second = compileWebglAdaptationContract(fixture);
  assert.equal(first.operationGraphSha256, second.operationGraphSha256);
  assert.equal(first.sourceSchema, WEBGL_ADAPTATION_SCHEMA_V2);
});

test("v2 builder binds generated vertex, runtime and program evidence", () => {
  const fixture = structuredFixture();
  delete fixture.vertex.operations[1].mappingSha256;
  delete fixture.fragment.operations[0].bindingContractSha256;
  const adaptation = buildWebglAdaptationV2({
    vertex: fixture.vertex,
    fragment: fixture.fragment,
    interfaceSha256: fixture.interfaceSha256,
    officialVertexInputs: { inputs: [{ sourceName: "Vertex", threeAttribute: "position" }] },
    runtimeContract: { engine_uniforms: { modelMatrix: "mat4" } },
    officialProgramBindings: {
      common_constant_buffers: [{ name: "VGlobals", size: 128 }],
      variant_constant_buffers: [],
    },
  });
  assert.equal(adaptation.schema, WEBGL_ADAPTATION_SCHEMA_V2);
  assert.match(adaptation.vertex.operations[1].mappingSha256, /^[0-9a-f]{64}$/);
  assert.match(adaptation.fragment.operations[0].bindingContractSha256, /^[0-9a-f]{64}$/);
  assert.match(adaptation.operationGraphSha256, /^[0-9a-f]{64}$/);

  fixture.vertex.operations[1].mappingSha256 = HASH;
  assert.throws(() => buildWebglAdaptationV2({
    vertex: fixture.vertex,
    fragment: fixture.fragment,
    interfaceSha256: fixture.interfaceSha256,
    officialVertexInputs: { inputs: [] },
    runtimeContract: { engine_uniforms: {} },
    officialProgramBindings: {},
  }), /does not match generated contract evidence/);

  const wrongSource = structuredFixture();
  delete wrongSource.vertex.operations[1].mappingSha256;
  delete wrongSource.fragment.operations[0].bindingContractSha256;
  assert.throws(() => buildWebglAdaptationV2({
    vertex: wrongSource.vertex,
    fragment: wrongSource.fragment,
    interfaceSha256: wrongSource.interfaceSha256,
    officialVertexInputs: { inputs: [] },
    runtimeContract: { engine_uniforms: {} },
    officialProgramBindings: {
      common_constant_buffers: [],
      variant_constant_buffers: [{ name: "PGlobals", size: 16 }],
    },
  }), /declares unavailable serialized-common buffer source/);
});

test("v2 builder binds object-basis operations to a stage-specific conversion contract", () => {
  const fixture = structuredFixture();
  delete fixture.vertex.operations[1].mappingSha256;
  delete fixture.fragment.operations[0].bindingContractSha256;
  fixture.fragment.operations.push({
    kind: "object-basis-conversion",
    contract: "unity-to-three-basis",
  });
  const basis = {
    worldVectors: [
      { source: "worldNormal", alias: "pcrUnityWorldNormal", expectedOccurrences: 2 },
    ],
    viewForwards: [{ matrixName: "viewMatrix", targetName: "_9" }],
  };
  const adaptation = buildWebglAdaptationV2({
    vertex: fixture.vertex,
    fragment: fixture.fragment,
    interfaceSha256: fixture.interfaceSha256,
    officialVertexInputs: { inputs: [] },
    runtimeContract: {
      engine_uniforms: {},
      backend_basis_conversions: { fragment: basis },
    },
    officialProgramBindings: {
      common_constant_buffers: [{ name: "PGlobals", size: 16 }],
      variant_constant_buffers: [],
    },
  });
  const operation = adaptation.fragment.operations.find((row) => row.kind === "object-basis-conversion");
  assert.match(operation.basisContractSha256, /^[0-9a-f]{64}$/);
  assert.notEqual(operation.basisContractSha256, HASH);

  fixture.fragment.operations.at(-1).basisContractSha256 = HASH;
  assert.throws(() => buildWebglAdaptationV2({
    vertex: fixture.vertex,
    fragment: fixture.fragment,
    interfaceSha256: fixture.interfaceSha256,
    officialVertexInputs: { inputs: [] },
    runtimeContract: {
      engine_uniforms: {},
      backend_basis_conversions: { fragment: basis },
    },
    officialProgramBindings: {
      common_constant_buffers: [{ name: "PGlobals", size: 16 }],
      variant_constant_buffers: [],
    },
  }), /does not match generated contract evidence/);
});

test("basis source validation rejects comments, raw columns, out-of-main calls, and schema drift", () => {
  const basis = {
    objectMatrices: [{
      matrixName: "modelMatrix",
      columns: [{ column: 2, expectedOccurrences: 1 }],
    }],
  };
  const helper = `highp vec3 pcrUnityObjectToWorldAxisZ(highp mat4 threeModelMatrix)
{
  return vec3(threeModelMatrix[2].x, threeModelMatrix[2].y, -threeModelMatrix[2].z);
}`;
  const valid = `${helper}
void main()
{
  vec3 axis = pcrUnityObjectToWorldAxisZ(modelMatrix);
}`;
  assert.deepEqual(validateBasisConversionSourceText(valid, basis), basis);
  assert.throws(
    () => validateBasisConversionSourceText(`/* ${helper} */\nvoid main(){ vec3 axis = pcrUnityObjectToWorldAxisZ(modelMatrix); }`, basis),
    /must have one exact definition/,
  );
  assert.throws(
    () => validateBasisConversionSourceText(valid.replace(
      "vec3 axis =",
      "vec3 raw = modelMatrix[2].xyz;\n  vec3 axis =",
    ), basis),
    /remains after basis adaptation/,
  );
  assert.throws(
    () => validateBasisConversionSourceText(`${helper}
vec3 illegal = pcrUnityObjectToWorldAxisZ(modelMatrix);
void main()
{
  vec3 axis = pcrUnityObjectToWorldAxisZ(modelMatrix);
}`, basis),
    /outside main/,
  );
  assert.throws(
    () => validateBasisConversionSourceText(`#if ENABLE_BASIS\n${valid}\n#endif`, basis),
    /conditional preprocessor branches/,
  );
  assert.throws(
    () => compileBasisConversionContract({ ...basis, note: "trust me" }),
    /unknown field note/,
  );
  assert.throws(
    () => compileBasisConversionContract({
      objectMatrices: [basis.objectMatrices[0], basis.objectMatrices[0]],
    }),
    /unique GLSL identifier/,
  );
});

test("Unity TexEnv converts exactly to the Three GLTF UV basis", () => {
  assert.deepEqual(unityTexEnvToThreeGltfSt({
    scale: { x: 2, y: 0.5 },
    offset: { x: 0.1, y: 0.2 },
  }), [2, 0.5, 0.1, 0.3]);
  assert.deepEqual(unityTexEnvToThreeGltfSt(null, {
    defaultName: "black",
    dimension: 2,
  }), [1, 1, 0, 0]);
  assert.throws(
    () => unityTexEnvToThreeGltfSt({ scale: { x: 1, y: 1 }, offset: { x: 0 } }),
    /finite x\/y/,
  );
  assert.throws(
    () => unityTexEnvToThreeGltfSt(null, { defaultName: "black", dimension: 4 }),
    /neither a Material TexEnv nor a 2D Shader default/,
  );
});

test("texture-coordinate source validation rejects missing ST and tangent-view V conversion", () => {
  const contract = {
    transforms: [{
      uniform: "_MainTex_ST",
      slot: "_MainTex",
      input: "uv",
      output: "vs_TEXCOORD0",
      conversion: "unity-texenv-to-three-gltf-v",
    }],
    tangentViewY: {
      output: "vs_TEXCOORD1",
      bitangent: "bitangent",
      viewVector: "cameraObject",
      conversion: "negate-unity-to-three-gltf-v",
    },
  };
  const valid = `uniform highp vec4 _MainTex_ST;
void main()
{
  vs_TEXCOORD0 = (uv * _MainTex_ST.xy) + _MainTex_ST.zw;
  vs_TEXCOORD1 = vec3(
    dot(tangent.xyz, cameraObject),
    -dot(bitangent, cameraObject),
    dot(normal, cameraObject)
  );
}`;
  assert.deepEqual(validateTextureCoordinateSourceText(valid, contract), contract);
  assert.throws(
    () => validateTextureCoordinateSourceText(valid.replace(
      "vs_TEXCOORD0 = (uv * _MainTex_ST.xy) + _MainTex_ST.zw;",
      "vs_TEXCOORD0 = uv;",
    ), contract),
    /texture-coordinate transform is missing/,
  );
  assert.throws(
    () => validateTextureCoordinateSourceText(
      valid.replace("-dot(bitangent, cameraObject)", "dot(bitangent, cameraObject)"),
      contract,
    ),
    /V-axis conversion is missing/,
  );
  assert.throws(
    () => compileTextureCoordinateContract({ ...contract, confidence: "high" }),
    /unknown field confidence/,
  );
});

test("texture-coordinate operations are hash-bound to the runtime coordinate contract", () => {
  const fixture = structuredFixture();
  delete fixture.vertex.operations[1].mappingSha256;
  delete fixture.fragment.operations[0].bindingContractSha256;
  fixture.vertex.operations.push({
    kind: "texture-coordinate-basis-conversion",
    contract: "unity-texenv-to-three-gltf-uv",
  });
  const textureCoordinates = {
    transforms: [{
      uniform: "_MainTex_ST",
      slot: "_MainTex",
      input: "uv",
      output: "vs_TEXCOORD0",
      conversion: "unity-texenv-to-three-gltf-v",
    }],
  };
  const options = {
    vertex: fixture.vertex,
    fragment: fixture.fragment,
    interfaceSha256: fixture.interfaceSha256,
    officialVertexInputs: { inputs: [] },
    runtimeContract: {
      engine_uniforms: {},
      texture_coordinates: { vertex: textureCoordinates },
    },
    officialProgramBindings: {
      common_constant_buffers: [{ name: "VGlobals", size: 128 }],
      variant_constant_buffers: [],
    },
  };
  const adaptation = buildWebglAdaptationV2(options);
  const operation = adaptation.vertex.operations.find(
    (row) => row.kind === "texture-coordinate-basis-conversion",
  );
  assert.match(operation.textureCoordinateContractSha256, /^[0-9a-f]{64}$/);

  fixture.vertex.operations.at(-1).textureCoordinateContractSha256 = HASH;
  assert.throws(
    () => buildWebglAdaptationV2(options),
    /textureCoordinateContractSha256 does not match generated contract evidence/,
  );
});

test("official clock operations are hash-bound to the runtime dynamic-uniform contract", () => {
  const fixture = structuredFixture();
  delete fixture.vertex.operations[1].mappingSha256;
  delete fixture.fragment.operations[0].bindingContractSha256;
  fixture.vertex.operations.push({
    kind: "official-clock-binding",
    contract: "official-clock-to-unity-time",
  });
  const options = {
    vertex: fixture.vertex,
    fragment: fixture.fragment,
    interfaceSha256: fixture.interfaceSha256,
    officialVertexInputs: { inputs: [] },
    runtimeContract: {
      engine_uniforms: {},
      dynamic_uniforms: { uTime: { type: "float", source: "official-clock" } },
    },
    officialProgramBindings: {
      common_constant_buffers: [{ name: "VGlobals", size: 128 }],
      variant_constant_buffers: [],
    },
  };
  const adaptation = buildWebglAdaptationV2(options);
  const clock = adaptation.vertex.operations.find((row) => row.kind === "official-clock-binding");
  assert.match(clock.clockContractSha256, /^[0-9a-f]{64}$/);

  fixture.vertex.operations.at(-1).clockContractSha256 = HASH;
  assert.throws(
    () => buildWebglAdaptationV2(options),
    /clockContractSha256 does not match generated contract evidence/,
  );
});

test("dynamic producer operations are hash-bound to the runtime uniform contract", () => {
  const fixture = structuredFixture();
  delete fixture.vertex.operations[1].mappingSha256;
  delete fixture.fragment.operations[0].bindingContractSha256;
  fixture.vertex.operations.push({
    kind: "dynamic-uniform-producer-binding",
    contract: "runtime-producer-to-three-uniforms",
  });
  const options = {
    vertex: fixture.vertex,
    fragment: fixture.fragment,
    interfaceSha256: fixture.interfaceSha256,
    officialVertexInputs: { inputs: [] },
    runtimeContract: {
      engine_uniforms: {},
      dynamic_uniforms: {
        _FlowParams: {
          type: "vec4[2]",
          source: "GlitterFlowMaps.Update/Material.SetVectorArray",
        },
      },
    },
    officialProgramBindings: {
      common_constant_buffers: [{ name: "VGlobals", size: 128 }],
      variant_constant_buffers: [],
    },
  };
  const adaptation = buildWebglAdaptationV2(options);
  const producer = adaptation.vertex.operations.find(
    (row) => row.kind === "dynamic-uniform-producer-binding",
  );
  assert.match(producer.producerContractSha256, /^[0-9a-f]{64}$/);

  fixture.vertex.operations.at(-1).producerContractSha256 = HASH;
  assert.throws(
    () => buildWebglAdaptationV2(options),
    /producerContractSha256 does not match generated contract evidence/,
  );
});

test("renderer property-block operations are hash-bound to the runtime producer contract", () => {
  const fixture = structuredFixture();
  delete fixture.vertex.operations[1].mappingSha256;
  delete fixture.fragment.operations[0].bindingContractSha256;
  fixture.vertex.operations.push({
    kind: "renderer-property-block-binding",
    contract: "unity-material-property-block-to-three-uniforms",
  });
  const rendererUniforms = {
    schema: "pocket-card-render/renderer-property-block@1",
    producer: "KiraPuyoObject.UpdateMPB",
    values: { _Anim: { type: "float", semantic: "transformedLocalFront.anim" } },
  };
  const options = {
    vertex: fixture.vertex,
    fragment: fixture.fragment,
    interfaceSha256: fixture.interfaceSha256,
    officialVertexInputs: { inputs: [] },
    runtimeContract: {
      engine_uniforms: {},
      renderer_uniforms: rendererUniforms,
    },
    officialProgramBindings: {
      common_constant_buffers: [{ name: "VGlobals", size: 128 }],
      variant_constant_buffers: [],
    },
  };
  const adaptation = buildWebglAdaptationV2(options);
  const producer = adaptation.vertex.operations.find(
    (row) => row.kind === "renderer-property-block-binding",
  );
  assert.match(producer.producerContractSha256, /^[0-9a-f]{64}$/);

  fixture.vertex.operations.at(-1).producerContractSha256 = HASH;
  assert.throws(
    () => buildWebglAdaptationV2(options),
    /producerContractSha256 does not match generated contract evidence/,
  );

  const missing = structuredFixture();
  delete missing.vertex.operations[1].mappingSha256;
  delete missing.fragment.operations[0].bindingContractSha256;
  missing.vertex.operations.push({
    kind: "renderer-property-block-binding",
    contract: "unity-material-property-block-to-three-uniforms",
  });
  assert.throws(() => buildWebglAdaptationV2({
    vertex: missing.vertex,
    fragment: missing.fragment,
    interfaceSha256: missing.interfaceSha256,
    officialVertexInputs: { inputs: [] },
    runtimeContract: { engine_uniforms: {} },
    officialProgramBindings: {
      common_constant_buffers: [{ name: "VGlobals", size: 128 }],
      variant_constant_buffers: [],
    },
  }), /requires runtimeContract.renderer_uniforms/);
});

test("structured contract fails closed on unsupported or contradictory declarations", () => {
  const unknown = structuredFixture();
  unknown.fragment.operations[0].kind = "looks-correct";
  assert.throws(() => compileWebglAdaptationContract(unknown), /unknown kind/);

  const wrongStage = structuredFixture();
  wrongStage.fragment.operations = [wrongStage.vertex.operations[0]];
  assert.throws(() => compileWebglAdaptationContract(wrongStage), /not valid in the fragment stage/);

  const extraField = structuredFixture();
  extraField.vertex.operations[0].comment = "trust me";
  assert.throws(() => compileWebglAdaptationContract(extraField), /unsupported field comment/);

  const duplicate = structuredFixture();
  duplicate.vertex.operations.push(structuredClone(duplicate.vertex.operations[0]));
  assert.throws(() => compileWebglAdaptationContract(duplicate), /duplicate operations/);

  const missingClip = structuredFixture();
  missingClip.vertex.operations = [missingClip.vertex.operations[1]];
  assert.throws(() => compileWebglAdaptationContract(missingClip), /exactly one clip-space Y conversion/);

  const wrongSource = structuredFixture();
  assert.throws(
    () => compileWebglAdaptationContract(wrongSource, {
      sourceHashes: { vertex: "2".repeat(64), fragment: HASH },
    }),
    /does not match the emitted GLSL source/,
  );

  const staleGraph = structuredFixture();
  staleGraph.operationGraphSha256 = "3".repeat(64);
  assert.throws(() => compileWebglAdaptationContract(staleGraph), /operationGraphSha256/);
});

test("formal ports are fully native v2 and the dormant legacy parser remains pinned", () => {
  const portContract = JSON.parse(fs.readFileSync(
    path.join(ROOT, "public", "shaders", "official_program_port_contract.json"),
    "utf8",
  ));
  const manifests = portContract.ports.map((port) => JSON.parse(fs.readFileSync(
    path.join(ROOT, port.manifest),
    "utf8",
  )));
  assert.ok(manifests.every(
    (manifest) => manifest.webgl_adaptation.schema === WEBGL_ADAPTATION_SCHEMA_V2,
  ));
  assert.equal(legacyClaimSetSha256(manifests), LEGACY_CLAIM_SET_SHA256);

  const legacy = {
    schema: WEBGL_ADAPTATION_SCHEMA_V1,
    backend: WEBGL_ADAPTATION_BACKEND,
    vertex: {
      officialSpirvSha256: HASH,
      spirvCrossGlslSha256: HASH,
      outputSha256: HASH,
      substitutions: ["remove Unity Vulkan clip-space Y inversion for WebGL clip space"],
    },
    fragment: {
      officialSpirvSha256: HASH,
      spirvCrossGlslSha256: HASH,
      outputSha256: HASH,
      substitutions: ["replace the serialized PGlobals UBO fields with same-name Three.js material uniforms"],
    },
    interfaceSha256: HASH,
  };
  assert.equal(compileWebglAdaptationContract(legacy).sourceSchema, WEBGL_ADAPTATION_SCHEMA_V1);
  legacy.vertex.substitutions[0] = "map official imaginary locations to Three.js attributes";
  assert.throws(() => compileWebglAdaptationContract(legacy), /outside the pinned compatibility corpus/);
});
