#!/usr/bin/env node
// Generate the four IM selector-owned WebGL2 ports from official Unity shader bytes.
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  adaptThreeViewForwardToUnityDataAxes,
  adaptThreeWorldVectorsToUnityDataAxes,
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

const frameVertex = {
  block: "_19_21",
  owner: "_21",
  size: 192,
  uniforms: [
    ["highp", "mat4", "modelMatrix"],
    ["highp", "mat4", "viewMatrix"],
    ["highp", "mat4", "projectionMatrix"],
  ],
  members: ["modelMatrix", "_WorldToObject", "_ViewProjection"],
  inputs: [
    [0, "vec4", "_11", "vec3", "position", "vec4 _11 = vec4(position, 1.0);"],
    [1, "vec3", "_103", "vec3", "normal", "vec3 _103 = normal;"],
    [2, "vec2", "_100", "vec2", "uv", "vec2 _100 = uv;"],
  ],
  locals: [
    "mat4 _WorldToObject = inverse(modelMatrix);",
    "mat4 _ViewProjection = projectionMatrix * viewMatrix;",
  ],
};

const PORTS = [
  {
    shaderKey: "Frame-Holo-ImmersiveUI",
    stem: "frame_holo_immersive_ui",
    selectorId: "3dddf11a1dea4aad910b128a44787a6a4e5a0300c5341144d9af74b9b21421a6",
    candidateWitnessId: "fcac942d24f300bc89351b7f08f03a7399f708d97eb9a636962f396cf984a8fa",
    semanticExecutableId: "558df56c1c3c60dbbc41d8c1f86a4d3af69cfce6a511f48978f90844429827e4",
    parameterReflectionSha256: "deefdd0ab2f6e64767510108198413f2fdae5713fede9f91c96ce4b4083690d3",
    crossSha256: {
      vertex: "88fc3caeeb669e813b29695973eabb9c8c2d26ef3e5366f84cf3e5f4c47bb319",
      fragment: "f66499759b0ff26d66132ac510da25599d397153a876bbb80ebab203d757615d",
    },
    vertex: frameVertex,
    fragment: {
      block: "_61_63",
      owner: "_63",
      size: 140,
      uniforms: [
        ["highp", "vec3", "cameraPosition"],
        ["highp", "mat4", "viewMatrix"],
        ["mediump", "float", "_Shininess"],
        ["mediump", "float", "_BaseColorIntensity"],
        ["mediump", "float", "_SpecularIntensity"],
        ["mediump", "float", "_DiffractionIntensity"],
        ["mediump", "float", "_DiffractionPower"],
        ["mediump", "float", "_RampRepeat"],
        ["mediump", "float", "_RampSpeed"],
        ["mediump", "float", "_RampOffset"],
        ["mediump", "float", "_RampInterval"],
        ["mediump", "float", "_RemoveMetalic"],
        ["mediump", "vec3", "_Rotation"],
      ],
      members: [
        "cameraPosition", "viewMatrix", "_Shininess", "_BaseColorIntensity",
        "_SpecularIntensity", "_DiffractionIntensity", "_DiffractionPower",
        "_RampRepeat", "_RampSpeed", "_RampOffset", "_RampInterval",
        "_RemoveMetalic", "_Rotation",
      ],
      worldVectors: [
        ["cameraPosition", "pcrUnityCameraPosition", 1],
        ["vs_TEXCOORD2", "pcrUnityWorldPosition", 1],
        ["vs_TEXCOORD3", "pcrUnityWorldNormal", 3],
      ],
      viewForwardTarget: "_58",
    },
    samplerSlots: [
      "_BaseTex", "_HologramMaskTex", "_CubeMap", "_PhaseTex",
      "_PhaseMaskTex", "_RampMaskTex", "_RampTex",
    ],
    materialUniforms: {
      floats: [
        "_Shininess", "_BaseColorIntensity", "_SpecularIntensity",
        "_DiffractionIntensity", "_DiffractionPower", "_RampRepeat",
        "_RampSpeed", "_RampOffset", "_RampInterval", "_RemoveMetalic",
      ],
      ints: [],
      vectors: { _Rotation: "vec3" },
    },
    attributes: { position: "vec3", normal: "vec3", uv: "vec2" },
    outputs: ["_642", "_654"],
  },
  {
    shaderKey: "Frame-Holo-Immersive",
    stem: "frame_holo_immersive",
    selectorId: "57a743aa6b935ec3433ceeb68223e1f64e06b20c1633c1289e6ccc3311a3f41c",
    candidateWitnessId: "adf55085ec015af53ae7aeca5d6f6aa4affcc4858780541ccb92adac8e8db76f",
    semanticExecutableId: "6bef0647623b9a2fbf7e84f41894a1f472f51293ad1774189a15636986851ecb",
    parameterReflectionSha256: "cf9e2b6fa79a29cd9f13268fa29096a460f3cecd7ff8bcf7473752c9afc51699",
    crossSha256: {
      vertex: "88fc3caeeb669e813b29695973eabb9c8c2d26ef3e5366f84cf3e5f4c47bb319",
      fragment: "e5f79c65af10cffba7332ce5beb8081c9b8bcac254ddd40c0eb5aa583ca46f4b",
    },
    vertex: frameVertex,
    fragment: {
      block: "_48_50",
      owner: "_50",
      size: 236,
      uniforms: [
        ["highp", "vec3", "cameraPosition"],
        ["highp", "mat4", "viewMatrix"],
        ["", "int", "_UseDiffuseColor"],
        ["mediump", "vec4", "_OffDiffuseColor"],
        ...[
          "_Shininess", "_BaseColorIntensity", "_SpecularIntensity",
          "_DiffractionIntensity", "_DiffractionPower", "_RampRepeat",
          "_RampSpeed", "_RampOffset", "_RampInterval", "_RampUVOffset",
          "_RampUVTiltOffset", "_PhaseScale", "_RampScale", "_PhaseRotate",
          "_RampRotate", "_RemoveMetallic",
        ].map((name) => ["mediump", "float", name]),
        ["", "int", "_TiltDiffractionEnabled"],
        ...[
          "_MinDiffractionIntensity", "_MaxDiffractionIntensity", "_TiltPower",
          "_TiltOffset", "_TiltIntensity",
        ].map((name) => ["mediump", "float", name]),
        ["", "int", "_TiltSaturationEnabled"],
        ...[
          "_MinSaturation", "_MaxSaturation", "_SatTiltPower",
          "_SatTiltOffset", "_SatTiltIntensity",
        ].map((name) => ["mediump", "float", name]),
        ["mediump", "vec3", "_Rotation"],
      ],
      members: [
        "cameraPosition", "viewMatrix", "_UseDiffuseColor", "_OffDiffuseColor",
        "_Shininess", "_BaseColorIntensity", "_SpecularIntensity",
        "_DiffractionIntensity", "_DiffractionPower", "_RampRepeat",
        "_RampSpeed", "_RampOffset", "_RampInterval", "_RampUVOffset",
        "_RampUVTiltOffset", "_PhaseScale", "_RampScale", "_PhaseRotate",
        "_RampRotate", "_RemoveMetallic", "_TiltDiffractionEnabled",
        "_MinDiffractionIntensity", "_MaxDiffractionIntensity", "_TiltPower",
        "_TiltOffset", "_TiltIntensity", "_TiltSaturationEnabled",
        "_MinSaturation", "_MaxSaturation", "_SatTiltPower",
        "_SatTiltOffset", "_SatTiltIntensity", "_Rotation",
      ],
      worldVectors: [
        ["cameraPosition", "pcrUnityCameraPosition", 1],
        ["vs_TEXCOORD2", "pcrUnityWorldPosition", 1],
        ["vs_TEXCOORD3", "pcrUnityWorldNormal", 3],
      ],
      viewForwardTarget: "_73",
    },
    samplerSlots: [
      "_BaseTex", "_HologramMaskTex", "_CubeMap", "_PhaseTex",
      "_RampMaskTex", "_RampTex", "_ImmersiveEffectMaskTex",
    ],
    materialUniforms: {
      floats: [
        "_Shininess", "_BaseColorIntensity", "_SpecularIntensity",
        "_DiffractionIntensity", "_DiffractionPower", "_RampRepeat",
        "_RampSpeed", "_RampOffset", "_RampInterval", "_RampUVOffset",
        "_RampUVTiltOffset", "_PhaseScale", "_RampScale", "_PhaseRotate",
        "_RampRotate", "_RemoveMetallic", "_MinDiffractionIntensity",
        "_MaxDiffractionIntensity", "_TiltPower", "_TiltOffset",
        "_TiltIntensity", "_MinSaturation", "_MaxSaturation",
        "_SatTiltPower", "_SatTiltOffset", "_SatTiltIntensity",
      ],
      ints: ["_UseDiffuseColor", "_TiltDiffractionEnabled", "_TiltSaturationEnabled"],
      vectors: { _OffDiffuseColor: "vec4", _Rotation: "vec3" },
    },
    attributes: { position: "vec3", normal: "vec3", uv: "vec2" },
    outputs: ["_1241", "_1243"],
  },
  {
    shaderKey: "Card_Parallax_Immersive",
    stem: "card_parallax_immersive",
    selectorId: "bf76a81655b9ff3dd32548cf62d529426eb40486470b291799c191ccccb60659",
    candidateWitnessId: "a70149ec90014953c1f3b11cba096a4a914c1a1b1a7de8b3e59dc42148168086",
    semanticExecutableId: "c0cd4e92dc1f9903ac5cc5e6857e41fb5dcee9c01c6eb34a5ae31620071ec410",
    parameterReflectionSha256: "7c49a167fccebc8d794afe02b02246d2e4e6cc36d9ae5d7533ad21bd76587e0c",
    crossSha256: {
      vertex: "21ae9a615c123dfb6f3406406bb6858c1a6c7a7a3243586f809635e53c98db54",
      fragment: "249216d1ec076c9322e364196589bef42533dbc4c9f03ec7df776263bdb40b56",
    },
    vertex: {
      block: "_20_22",
      owner: "_22",
      size: 224,
      uniforms: [
        ["highp", "vec3", "cameraPosition"],
        ["highp", "mat4", "modelMatrix"],
        ["highp", "mat4", "viewMatrix"],
        ["highp", "mat4", "projectionMatrix"],
        ["highp", "float", "_FakeCameraHeight"],
        ["highp", "float", "_Height"],
        ["highp", "float", "_HeightPower"],
        ["highp", "float", "_Scale"],
      ],
      members: [
        "cameraPosition", "modelMatrix", "_WorldToObject", "_ViewProjection",
        "_FakeCameraHeight", "_Height", "_HeightPower", "_Scale",
      ],
      inputs: [
        [0, "vec4", "_11", "vec3", "position", "vec4 _11 = vec4(position, 1.0);"],
        [1, "vec3", "_86", "vec3", "normal", "vec3 _86 = normal;"],
        [3, "vec4", "_106", "vec4", "tangent", "vec4 _106 = tangent;"],
        [2, "vec2", "_296", "vec2", "uv", "vec2 _296 = uv;"],
      ],
      locals: [
        "mat4 _WorldToObject = inverse(modelMatrix);",
        "mat4 _ViewProjection = projectionMatrix * viewMatrix;",
      ],
    },
    fragment: {
      block: "_27_29",
      owner: "_29",
      size: 4,
      uniforms: [["highp", "float", "_IllustAlpha"]],
      members: ["_IllustAlpha"],
    },
    samplerSlots: ["_MainTex"],
    materialUniforms: {
      floats: ["_FakeCameraHeight", "_Height", "_HeightPower", "_Scale", "_IllustAlpha"],
      ints: [],
      vectors: {},
    },
    attributes: { position: "vec3", normal: "vec3", tangent: "vec4", uv: "vec2" },
    outputs: ["_21", "_43"],
  },
  {
    shaderKey: "Card_Parallax_MetalByTilt",
    stem: "card_parallax_metal_by_tilt",
    selectorId: "bd90afa8536d13c9107d8badccf43919ab387c61b52833e06a5654b1859816c2",
    candidateWitnessId: "892e273fe2d6f61ddc6f47dfbfbd97d518c49032a53aeb60a0ecf916404067a2",
    semanticExecutableId: "31398419ebc3ca1ae684b74e897e4da94cfc39269e13960ad84c8b6cc58d180b",
    parameterReflectionSha256: "3efeee17e0c954967fdcf039a03359a154d184b7588ae3fe65b803b2a0836214",
    crossSha256: {
      vertex: "07bebada6988e8669f67f8b33dc9ad214f1d6aa6e0d26ceb2adfbf42a17ab4d9",
      fragment: "b77be06f4937ac3a239386d8a524bd0b3359b9664ffc15c669359230207eea92",
    },
    vertex: {
      block: "_21_23",
      owner: "_23",
      size: 228,
      uniforms: [
        ["highp", "vec3", "cameraPosition"],
        ["highp", "mat4", "modelMatrix"],
        ["highp", "mat4", "viewMatrix"],
        ["highp", "mat4", "projectionMatrix"],
        ["highp", "float", "_FakeCameraHeight"],
        ["highp", "float", "_Height"],
        ["highp", "float", "_HeightPower"],
        ["highp", "float", "_Scale"],
        ["", "int", "_UseUv2"],
      ],
      members: [
        "cameraPosition", "modelMatrix", "_WorldToObject", "_ViewProjection",
        "_FakeCameraHeight", "_Height", "_HeightPower", "_Scale", "_UseUv2",
      ],
      inputs: [
        [0, "vec4", "_11", "vec3", "position", "vec4 _11 = vec4(position, 1.0);"],
        [1, "vec3", "_97", "vec3", "normal", "vec3 _97 = normal;"],
        [4, "vec4", "_117", "vec4", "tangent", "vec4 _117 = tangent;"],
        [2, "vec2", "_313", "vec2", "uv", "vec2 _313 = uv;"],
        [3, "vec2", "_316", "vec2", "uv1", "vec2 _316 = uv1;"],
      ],
      locals: [
        "mat4 _WorldToObject = inverse(modelMatrix);",
        "mat4 _ViewProjection = projectionMatrix * viewMatrix;",
      ],
    },
    fragment: {
      block: "_19_21",
      owner: "_21",
      size: 124,
      uniforms: [
        ["highp", "vec3", "cameraPosition"],
        ["highp", "mat4", "viewMatrix"],
        ["highp", "float", "_BaseColorIntensity"],
        ["highp", "float", "_Shininess"],
        ["highp", "float", "_SpecularIntensity"],
        ["highp", "float", "_MetalMaskIntensity"],
        ["", "int", "_TiltMetalicEnabled"],
        ["highp", "float", "_MetTiltPower"],
        ["highp", "float", "_MetTiltOffset"],
        ["highp", "float", "_MetTiltIntensity"],
        ["highp", "vec3", "_Rotation"],
      ],
      members: [
        "cameraPosition", "viewMatrix", "_BaseColorIntensity", "_Shininess",
        "_SpecularIntensity", "_MetalMaskIntensity", "_TiltMetalicEnabled",
        "_MetTiltPower", "_MetTiltOffset", "_MetTiltIntensity", "_Rotation",
      ],
      worldVectors: [
        ["cameraPosition", "pcrUnityCameraPosition", 1],
        ["vs_TEXCOORD2", "pcrUnityWorldPosition", 1],
        ["vs_TEXCOORD3", "pcrUnityWorldNormal", 3],
      ],
      viewForwardTarget: "_45",
    },
    samplerSlots: ["_CubeMap", "_MetalMaskTex"],
    materialUniforms: {
      floats: [
        "_FakeCameraHeight", "_Height", "_HeightPower", "_Scale",
        "_BaseColorIntensity", "_Shininess", "_SpecularIntensity",
        "_MetalMaskIntensity", "_MetTiltPower", "_MetTiltOffset", "_MetTiltIntensity",
      ],
      ints: ["_UseUv2", "_TiltMetalicEnabled"],
      vectors: { _Rotation: "vec3" },
    },
    attributes: {
      position: "vec3", normal: "vec3", tangent: "vec4", uv: "vec2", uv1: "vec2",
    },
    outputs: ["_412", "_418"],
  },
];

function rows(items = []) {
  return items.map(({ name, type, location }) => ({ name, type, location }))
    .sort((left, right) => left.location - right.location);
}

function declaration([precision, type, name]) {
  return `uniform ${precision ? `${precision} ` : ""}${type} ${name};`;
}

function replaceUbo(source, stage, shaderKey) {
  const expression = new RegExp(
    `layout\\(std140\\) uniform ${stage.block}[\\s\\S]*?}\\s*${stage.owner};\\s*`,
  );
  let output = source.replace(expression, `${stage.uniforms.map(declaration).join("\n")}\n\n`);
  if (output === source) throw new Error(`${shaderKey}: ${stage.block} UBO replacement failed`);
  output = output.replace(new RegExp(`${stage.owner}\\._m(\\d+)\\b`, "g"), (_match, rawIndex) => {
    const index = Number(rawIndex);
    const name = stage.members[index];
    if (!name) throw new Error(`${shaderKey}: ${stage.owner} member ${rawIndex} is out of range`);
    return name;
  });
  if (new RegExp(`${stage.owner}\\._m`).test(output)) {
    throw new Error(`${shaderKey}: ${stage.owner} member adaptation incomplete`);
  }
  return output;
}

function adaptVertex(source, port) {
  let output = source.replace(
    /^#version 300 es\s*/m,
    "precision highp float;\nprecision highp int;\n\n",
  );
  output = replaceUbo(output, port.vertex, port.shaderKey);
  const locals = [...port.vertex.inputs.map((input) => input[5]), ...port.vertex.locals];
  for (const [location, officialType, officialName, threeType, threeName] of port.vertex.inputs) {
    const input = new RegExp(
      `layout\\(location = ${location}\\) in(?: (?:lowp|mediump|highp))? ${officialType} ${officialName};`,
    );
    const replaced = output.replace(input, `in ${threeType} ${threeName};`);
    if (replaced === output) throw new Error(`${port.shaderKey}: vertex input ${officialName} changed`);
    output = replaced;
  }
  output = output.replace(/void main\(\)\s*\{/, `void main()\n{\n    ${locals.join("\n    ")}`);
  output = output.replace(/^\s*gl_Position\.y\s*=\s*-gl_Position\.y;\s*$/m, "");
  if (/layout\(location = \d+\) in|gl_Position\.y\s*=\s*-gl_Position\.y/.test(output)) {
    throw new Error(`${port.shaderKey}: vertex adaptation incomplete`);
  }
  return `${output.trimEnd()}\n`;
}

function adaptFragment(source, port) {
  let output = source.replace(/^#version 300 es\s*/m, "");
  output = replaceUbo(output, port.fragment, port.shaderKey);
  if (port.fragment.worldVectors) {
    output = adaptThreeWorldVectorsToUnityDataAxes(output, {
      bindings: port.fragment.worldVectors.map(([sourceName, alias, expectedOccurrences]) => ({
        source: sourceName,
        alias,
        expectedOccurrences,
      })),
    });
  }
  if (port.fragment.viewForwardTarget) {
    output = adaptThreeViewForwardToUnityDataAxes(output, {
      matrixName: "viewMatrix",
      targetName: port.fragment.viewForwardTarget,
    });
  }
  return `${output.trimEnd()}\n`;
}

const outputs = {};
let sharedFrameVertex = null;
for (const port of PORTS) {
  await withExtractedSelectorProgram({
    selectorId: port.selectorId,
    candidateWitnessId: port.candidateWitnessId,
    expectedProofGraphSha256: PROOF_GRAPH_SHA256,
    expectedPortIndexSha256: PORT_INDEX_SHA256,
    decryptedRoot: path.resolve(SHADER_ROOT, "..", ".."),
    prefix: port.stem,
    rootDir: ROOT,
    spirvCross: SPIRV_CROSS,
  }, ({ metadata, files, reflection }) => {
    assert.deepEqual(metadata.selector.keywords, []);
    assert.equal(metadata.selector.semanticExecutableId, port.semanticExecutableId);
    assert.equal(metadata.parameterReflectionSha256, port.parameterReflectionSha256);
    assert.equal(metadata.artifacts.parameterEntry.byteSize, 100);
    const vertexUbo = reflection.vertex.ubos?.[0];
    const fragmentUbo = reflection.fragment.ubos?.[0];
    assert.deepEqual(
      { name: vertexUbo?.name, size: vertexUbo?.block_size },
      { name: port.vertex.block, size: port.vertex.size },
    );
    assert.deepEqual(
      { name: fragmentUbo?.name, size: fragmentUbo?.block_size },
      { name: port.fragment.block, size: port.fragment.size },
    );
    assert.deepEqual(
      rows(reflection.vertex.inputs),
      port.vertex.inputs.map(([location, type, name]) => ({ name, type, location }))
        .sort((left, right) => left.location - right.location),
    );
    assert.deepEqual(
      rows(reflection.fragment.outputs),
      port.outputs.map((name, location) => ({ name, type: "vec4", location })),
    );

    const officialVertex = runCommand(
      SPIRV_CROSS,
      [files.vertexSpirv, "--version", "300", "--es"],
      { cwd: ROOT },
    );
    const officialFragment = runCommand(
      SPIRV_CROSS,
      [files.fragmentSpirv, "--version", "300", "--es"],
      { cwd: ROOT },
    );
    assert.equal(sha256(officialVertex), port.crossSha256.vertex);
    assert.equal(sha256(officialFragment), port.crossSha256.fragment);
    const vertex = adaptVertex(officialVertex, port);
    const fragment = adaptFragment(officialFragment, port);
    if (port.vertex === frameVertex) {
      if (sharedFrameVertex !== null) assert.equal(vertex, sharedFrameVertex);
      sharedFrameVertex = vertex;
    }

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
        assert.equal(set, 0, `${port.shaderKey}: WebGL sampler must use descriptor set 0`);
        return row;
      });
    assert.deepEqual(
      samplerBindings.map(({ slot }) => slot),
      port.samplerSlots,
      `${port.shaderKey}: sampler slot order changed`,
    );

    const runtimeContract = {
      schema: "pocket-card-render/webgl-runtime-port@1",
      shader_key: port.shaderKey,
      attributes: port.attributes,
      engine_uniforms: {
        modelMatrix: "mat4",
        viewMatrix: "mat4",
        projectionMatrix: "mat4",
        ...(port.vertex.uniforms.some((row) => row[2] === "cameraPosition")
          || port.fragment.uniforms.some((row) => row[2] === "cameraPosition")
          ? { cameraPosition: "vec3" }
          : {}),
      },
      material_uniforms: port.materialUniforms,
      require_complete_active_bindings: true,
      camera_from_view: true,
      mrt_attachments: 2,
      stencil_normalization: "none",
      stencil_face_mode: "generic",
      ...(port.samplerSlots.includes("_CubeMap")
        ? { backend_texture_defaults: { _CubeMap: "neutral-gray-cube" } }
        : {}),
      ...(port.fragment.worldVectors
        ? {
            backend_basis_conversions: {
              fragment: {
                worldVectors: port.fragment.worldVectors.map(
                  ([source, alias, expectedOccurrences]) => ({
                    source,
                    alias,
                    expectedOccurrences,
                  }),
                ),
                viewForwards: port.fragment.viewForwardTarget
                  ? [{
                      matrixName: "viewMatrix",
                      targetName: port.fragment.viewForwardTarget,
                    }]
                  : [],
              },
            },
          }
        : {}),
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
          {
            kind: "clip-space-y-conversion",
            from: "unity-vulkan",
            to: "webgl",
            operation: "remove-y-inversion",
          },
          { kind: "glsl-version-ownership", owner: "three-raw-shader-material" },
        ],
        substitutions: [
          "map official vertex channels to Three.js r165 attributes",
          "map Unity object/world/view-projection matrices and camera to Three.js engine uniforms",
          "remove Unity Vulkan clip-space Y inversion for WebGL clip space",
        ],
      },
      fragment: {
        officialSpirvSha256: sha256File(files.fragmentSpirv),
        spirvCrossGlslSha256: sha256(officialFragment),
        outputSha256: sha256(fragment),
        operations: [
          { kind: "engine-uniform-binding", contract: "unity-builtins-to-three-r165" },
          {
            kind: "uniform-buffer-flattening",
            source: "serialized-common",
            preservation: "names-types-precision",
          },
          ...(port.fragment.worldVectors
            ? [{ kind: "object-basis-conversion", contract: "unity-to-three-basis" }]
            : []),
          { kind: "glsl-version-ownership", owner: "three-raw-shader-material" },
        ],
        substitutions: [
          "map official material and engine constant-buffer members to typed Three.js uniforms",
          "preserve official sampler binding order and MRT outputs",
        ],
      },
      interfaceSha256: canonicalJsonSha256({
        vertex: reflection.vertex,
        fragment: reflection.fragment,
      }),
      officialVertexInputs: vertexInputContract,
      runtimeContract,
      officialProgramBindings: manifestProgramBindings,
    });
    const passRuntime = compileOfficialPassContract(metadata.passContract, {
      sourceSha256: metadata.identityFields.passStateSha256,
      policy: PASS_POLICY,
    });
    const vertexFile = port.vertex === frameVertex
      ? "frame_holo_immersive.vert.glsl"
      : `${port.stem}.vert.glsl`;
    const fragmentFile = `${port.stem}.frag.glsl`;
    const manifestFile = `${port.stem}_uniforms.json`;
    outputs[vertexFile] = vertex;
    outputs[fragmentFile] = fragment;
    outputs[manifestFile] = `${JSON.stringify({
      shader: metadata.selector.shaderName,
      generated_by: "build/build-exact-immersive.mjs",
      selected_keywords: [],
      official_selector: metadata.selector,
      official_spirv_sha256: {
        vertex: sha256File(files.vertexSpirv),
        fragment: sha256File(files.fragmentSpirv),
      },
      official_spirv_precision: metadata.officialSpirvPrecision,
      official_executable_identity: metadata.identityFields,
      official_parameter_entry: {
        source_sha256: metadata.identityFields.parameterEntrySha256,
        byte_size: metadata.artifacts.parameterEntry.byteSize,
        reflection_sha256: metadata.parameterReflectionSha256,
        ...metadata.parameterReflection,
      },
      official_pass_runtime: passRuntime,
      official_common_bindings: {
        source_sha256: metadata.identityFields.commonBindingsSha256,
        ...commonBindings,
      },
      official_program_bindings: manifestProgramBindings,
      official_vertex_inputs: vertexInputContract,
      official_shader_property_defaults: metadata.shaderPropertyDefaults,
      webgl_adaptation: adaptation,
      webgl_sources: {
        vertex: `public/shaders/${vertexFile}`,
        fragment: `public/shaders/${fragmentFile}`,
      },
      runtime_contract: runtimeContract,
      sampler_bindings: samplerBindings,
      samplers: samplerBindings.map((row) => row.spirvName),
      sampler_slots: samplerBindings.map((row) => row.slot),
      compiled_texture_bindings: Object.fromEntries(
        samplerBindings.map((row) => [row.slot, row.binding]),
      ),
      implicit_defaults: metadata.shaderPropertyDefaults.textures,
      mrt: { primary: port.outputs[0], emissive: port.outputs[1] },
    }, null, 2)}\n`;
  });
}

writeOrCheckOutputs(outputs, { outDir: OUT, check: CHECK });
console.log(`${CHECK ? "verified" : "generated"} four selector-owned IM WebGL2 ports`);
