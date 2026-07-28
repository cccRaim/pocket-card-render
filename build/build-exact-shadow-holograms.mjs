#!/usr/bin/env node
// Generate the three selector-owned SR Shadow hologram programs from official Unity shader bytes.
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  adaptThreeViewForwardToUnityDataAxes,
  adaptThreeWorldVectorsToUnityDataAxes,
  generateExactSelectorPort,
} from "./exact-selector-port-core.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHADER_ROOT = process.env.PCR_SHADERS
  || "D:/DevProjectes/ptcgp-tools-master/masterdata_decoder/.output/decrypted/Common/Shader";
const OUT = path.join(ROOT, "public", "shaders");
const CHECK = process.argv.includes("--check") || process.env.PCR_EXACT_CHECK === "1";
const PROOF_GRAPH_SHA256 = "307ed3660e5d3b1bfd8cf9e6b3d64e44937af215da3b6ed84ead198800eeadc4";
const PORT_INDEX_SHA256 = "15095f34b9e75515bbcc3924f6f8b2abb826ba96b48e819ec911486bcfa6f5a9";
const GENERATED_BY = "build/build-exact-shadow-holograms.mjs";
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

const PARALLAX_VERTEX = {
  block: "_20_22",
  owner: "_22",
  size: 224,
  inputs: [
    [0, "vec4", "_11", "vec3", "position", "vec4 _11 = vec4(position, 1.0);"],
    [1, "vec3", "_97", "vec3", "normal", "vec3 _97 = normal;"],
    [2, "vec2", "_342", "vec2", "uv", "vec2 _342 = uv;"],
    [3, "vec4", "_117", "vec4", "tangent", "vec4 _117 = tangent;"],
  ],
};

const COMMON_SHADOW_FLOATS = [
  "_OutlineHeight",
  "_OutlineShadowIntensity",
  "_HoloCoverPower",
  "_OutlineHoloCoverPower",
  "_DiffuseIntensity",
  "_Shininess",
  "_SpecularIntensity",
  "_DiffractionPower",
  "_OrientationU",
  "_OrientationV",
  "_ChangeSpeed",
  "_RampOffset",
  "_DiffractionIntensity2",
  "_DiffractionPower2",
  "_RampRepeat2",
  "_RampSpeed2",
  "_RampOffset2",
  "_RampInterval2",
  "_TiltPower",
  "_TiltOffset",
  "_TiltIntensity",
];
const COMMON_SHADOW_INTS = ["_UsePositionAsUV", "_TiltEnabled"];
const COMMON_SHADOW_VECTORS = {
  _OutlineShadowUVOffset: "vec2",
  _Rotation: "vec3",
};

const PORTS = [
  {
    shaderKey: "Card_Parallax_Hologram_Shadow",
    stem: "card_parallax_hologram_shadow_layers",
    selectorId: "7c4ddaec18170d0786d031ff44fb6d09f781e5962e7f8786a1b912e918782cc4",
    candidateWitnessId: "a44d38d48d7d2370ad9c2162392738d2049cd8c90d609cdb3632cd6015ea1815",
    semanticExecutableId: "243815134704a651a8c609e59abcb1d34ff8fa110fcf742a98a8d8c3d48bc78d",
    keywords: ["_USESHADOWLAYERG_ON", "_USESHADOWLAYERR_ON"],
    parameterEntryBytes: 2412,
    parameterReflectionSha256: "fb2bd2164b4ade5612d3211bb655d4d2ac4b1ebff6244be5dc24dc7656ced02f",
    crossSha256: {
      vertex: "3f62f5ac4dfb217ffdacbcb180e97a8edfec787a279904a67fd2fa9094f5f24f",
      fragment: "8a9b753bb2bcdb4afc43beeb9fbb8e4d734110a19c31f025f1d3194f5465cfe5",
    },
    vertex: PARALLAX_VERTEX,
    fragment: {
      block: "_36_38",
      owner: "_38",
      size: 268,
      outputs: ["_1221", "_1229"],
      worldVectors: [
        ["cameraPosition", "pcrUnityCameraPosition", 1],
        ["vs_TEXCOORD2", "pcrUnityWorldPosition", 1],
        ["vs_TEXCOORD3", "pcrUnityWorldNormal", 4],
      ],
      viewForwardTarget: "_143",
    },
    samplerSlots: [
      "_MainTex", "_MaskTex", "_ShadowLayer", "_OutlineShadowTex", "_CubeMap",
      "_PhaseTex", "_RampTex", "_PhaseTex2", "_RampMaskTex2", "_RampTex2",
    ],
    materialUniforms: {
      floats: [
        "_FakeCameraHeight", "_Height", "_HeightPower", "_Scale",
        "_MainTexScale", "_LayerTexScale", "_BaseColorIntensity",
        "_MetallicShininess", "_MetallicSpecularIntensity",
        ...COMMON_SHADOW_FLOATS,
      ],
      ints: ["_UseMetallicAtNonOutline", ...COMMON_SHADOW_INTS],
      vectors: {
        ...COMMON_SHADOW_VECTORS,
        _ShadowLayerHeight: "vec3",
        _ShadowIntensity: "vec3",
      },
    },
    attributes: { position: "vec3", normal: "vec3", uv: "vec2", tangent: "vec4" },
  },
  {
    shaderKey: "Card_Parallax_Hologram_Shadow",
    stem: "card_parallax_hologram_shadow_effect",
    selectorId: "ad9a07def8770d203c8834ef924234f99da1b625e2f267bae78ca0a1681e3402",
    candidateWitnessId: "7918bda097d1db4d0dce9704bd237bd646955a2440f289a0a8eaddb4162a7344",
    semanticExecutableId: "99f72fae6a3d25e04cfed30bb4522ba2d28ced7cd795a12f2b550410b6ae6028",
    keywords: [],
    parameterEntryBytes: 2244,
    parameterReflectionSha256: "b4d374dabe3caebfd9c5931a2b0a75c13db7f70531f354cbb0a5a9b02c51fe92",
    crossSha256: {
      vertex: "3f62f5ac4dfb217ffdacbcb180e97a8edfec787a279904a67fd2fa9094f5f24f",
      fragment: "87e8059a4a072e9121e61571315ec500252582e011bf0f67139821d0c7b8baff",
    },
    vertex: PARALLAX_VERTEX,
    fragment: {
      block: "_29_31",
      owner: "_31",
      size: 236,
      outputs: ["_1134", "_1142"],
      worldVectors: [
        ["cameraPosition", "pcrUnityCameraPosition", 1],
        ["vs_TEXCOORD2", "pcrUnityWorldPosition", 1],
        ["vs_TEXCOORD3", "pcrUnityWorldNormal", 4],
      ],
      viewForwardTarget: "_419",
    },
    samplerSlots: [
      "_MainTex", "_MaskTex", "_OutlineShadowTex", "_CubeMap", "_PhaseTex",
      "_RampTex", "_PhaseTex2", "_RampMaskTex2", "_RampTex2",
    ],
    materialUniforms: {
      floats: [
        "_FakeCameraHeight", "_Height", "_HeightPower", "_Scale",
        "_MainTexScale", "_BaseColorIntensity", "_MetallicShininess",
        "_MetallicSpecularIntensity", ...COMMON_SHADOW_FLOATS,
      ],
      ints: ["_UseMetallicAtNonOutline", ...COMMON_SHADOW_INTS],
      vectors: COMMON_SHADOW_VECTORS,
    },
    attributes: { position: "vec3", normal: "vec3", uv: "vec2", tangent: "vec4" },
  },
  {
    shaderKey: "Opaque-Hologram_Shadow",
    stem: "opaque_hologram_shadow",
    selectorId: "c35aa0fb11f9991703f338404890df4f14e83eca4e1bb7bae9728f3a0575b15e",
    candidateWitnessId: "737b6b37bcb07e8a0fa304f1a694baca1fea8ee5f74ea5af9731dc742c24ccc3",
    semanticExecutableId: "bb341af58817ec02c8037818d18a9721539526d7f8f692ea527a85dda6bbbe89",
    keywords: ["_USESHADOWLAYERR_ON"],
    parameterEntryBytes: 1956,
    parameterReflectionSha256: "03e9bcf9f956e2b86087df3f4d242880d21c50ce301b97bae2d8e8a40c4d8284",
    crossSha256: {
      vertex: "06d5f2bfd0b53078250371df1513296b7252e2667ccaae19483dd082cebac715",
      fragment: "a77cbfd8f1fb0c88af3b032ca86b98f6c2bbacb124fa33f57dc192fbd31c60e4",
    },
    vertex: {
      block: "_19_21",
      owner: "_21",
      size: 192,
      inputs: [
        [0, "vec4", "_11", "vec3", "position", "vec4 _11 = vec4(position, 1.0);"],
        [1, "vec2", "_99", "vec2", "uv", "vec2 _99 = uv;"],
        [2, "vec3", "_115", "vec3", "normal", "vec3 _115 = normal;"],
      ],
    },
    fragment: {
      block: "_163_165",
      owner: "_165",
      size: 236,
      outputs: ["_103", "_1157"],
      worldVectors: [
        ["cameraPosition", "pcrUnityCameraPosition", 1],
        ["vs_TEXCOORD3", "pcrUnityWorldPosition", 1],
        ["vs_TEXCOORD4", "pcrUnityWorldNormal", 4],
      ],
      viewForwardTarget: "_500",
    },
    samplerSlots: [
      "_MainTex", "_MaskTex", "_ShadowLayer", "_OutlineShadowTex", "_CubeMap",
      "_PhaseTex", "_RampTex", "_PhaseTex2", "_RampMaskTex2", "_RampTex2",
    ],
    materialUniforms: {
      floats: ["_LayerTexScale", ...COMMON_SHADOW_FLOATS],
      ints: COMMON_SHADOW_INTS,
      vectors: {
        ...COMMON_SHADOW_VECTORS,
        _ShadowLayerHeight: "vec3",
        _ShadowIntensity: "vec3",
      },
    },
    attributes: { position: "vec3", uv: "vec2", normal: "vec3" },
  },
];

const ENGINE_ALIASES = Object.freeze({
  _WorldSpaceCameraPos: "cameraPosition",
  unity_ObjectToWorld: "modelMatrix",
  unity_WorldToObject: "_WorldToObject",
  unity_MatrixVP: "_ViewProjection",
  unity_MatrixV: "viewMatrix",
});
const LOCAL_ALIASES = new Set(["_WorldToObject", "_ViewProjection"]);

function rows(items = []) {
  return items.map(({ name, type, location }) => ({ name, type, location }))
    .sort((left, right) => left.location - right.location);
}

function stageUbo(reflection, stage, port) {
  const ubo = (reflection.ubos || []).find((row) => row.name === stage.block);
  assert.deepEqual(
    { name: ubo?.name, size: ubo?.block_size },
    { name: stage.block, size: stage.size },
    `${port.shaderKey}: ${stage.block} UBO changed`,
  );
  return {
    ubo,
    members: reflection.types[ubo.type].members,
  };
}

function parameterBuffer(metadata, prefix, size, port) {
  const buffer = metadata.parameterReflection.constantBuffers
    .find((row) => row.name.startsWith(prefix));
  assert.equal(buffer?.size, size, `${port.shaderKey}: ${prefix} parameter buffer changed`);
  return buffer;
}

function memberDeclarations(source, stage, members, buffer, port) {
  const blockPattern = new RegExp(
    `layout\\(std140\\) uniform ${stage.block}\\s*\\{([\\s\\S]*?)\\}\\s*${stage.owner};`,
  );
  const body = blockPattern.exec(source)?.[1];
  assert.ok(body, `${port.shaderKey}: ${stage.block} declaration changed`);
  const sourceDeclarations = new Map();
  for (const match of body.matchAll(
    /^\s*(?:(lowp|mediump|highp)\s+)?(float|int|vec2|vec3|vec4)\s+(_m\d+)(?:\[(\d+)\])?;\s*$/gm,
  )) {
    sourceDeclarations.set(match[3], {
      precision: match[1] || "",
      type: match[2],
      array: match[4] ? Number(match[4]) : null,
    });
  }
  assert.equal(sourceDeclarations.size, members.length, `${port.shaderKey}: ${stage.block} members changed`);

  const fieldsByOffset = new Map(buffer.fields.map((field) => [field.offset, field]));
  const mapping = [];
  const declarations = new Map();
  for (const member of members) {
    const sourceDeclaration = sourceDeclarations.get(member.name);
    const field = fieldsByOffset.get(member.offset);
    assert.ok(field, `${port.shaderKey}: no official field at ${stage.block}+${member.offset}`);
    const alias = ENGINE_ALIASES[field.name] || field.name;
    mapping[Number(member.name.slice(2))] = alias;
    if (LOCAL_ALIASES.has(alias)) continue;
    const isMatrix = sourceDeclaration.array === 4 && sourceDeclaration.type === "vec4";
    const declaration = isMatrix
      ? `uniform highp mat4 ${alias};`
      : `uniform ${sourceDeclaration.precision ? `${sourceDeclaration.precision} ` : ""}${sourceDeclaration.type} ${alias};`;
    if (declarations.has(alias)) {
      assert.equal(declarations.get(alias), declaration, `${port.shaderKey}: duplicate ${alias} type changed`);
    } else {
      declarations.set(alias, declaration);
    }
  }
  return { blockPattern, mapping, declarations };
}

function replaceStageUbo(source, stage, metadata, reflection, prefix, port, extraUniforms = []) {
  const { ubo, members } = stageUbo(reflection, stage, port);
  const buffer = parameterBuffer(metadata, prefix, ubo.block_size, port);
  const parsed = memberDeclarations(source, stage, members, buffer, port);
  for (const declaration of extraUniforms) {
    const name = /([A-Za-z_][A-Za-z0-9_]*)\s*;$/.exec(declaration)?.[1];
    assert.ok(name, `${port.shaderKey}: invalid supplemental uniform`);
    if (!parsed.declarations.has(name)) parsed.declarations.set(name, declaration);
  }
  let output = source.replace(
    parsed.blockPattern,
    [...parsed.declarations.values()].join("\n"),
  );
  output = output.replace(new RegExp(`${stage.owner}\\._m(\\d+)\\b`, "g"), (match, index) => {
    const name = parsed.mapping[Number(index)];
    if (!name) throw new Error(`${port.shaderKey}: unmapped ${match}`);
    return name;
  });
  assert.doesNotMatch(output, new RegExp(`${stage.owner}\\._m`), `${port.shaderKey}: UBO adaptation incomplete`);
  return output;
}

function replaceVertexInput(source, input, port) {
  const [location, officialType, officialName, threeType, threeName] = input;
  const pattern = new RegExp(
    `layout\\(location = ${location}\\) in(?: (?:lowp|mediump|highp))? ${officialType} ${officialName};`,
  );
  const output = source.replace(pattern, `in ${threeType} ${threeName};`);
  assert.notEqual(output, source, `${port.shaderKey}: vertex input ${officialName} changed`);
  return output;
}

function adaptVertex(source, context, port) {
  let output = source.replace(
    /^#version 300 es\s*/m,
    "precision highp float;\nprecision highp int;\n\n",
  );
  output = replaceStageUbo(
    output,
    port.vertex,
    context.metadata,
    context.reflection.vertex,
    "VGlobals",
    port,
    ["uniform highp mat4 viewMatrix;", "uniform highp mat4 projectionMatrix;"],
  );
  for (const input of port.vertex.inputs) output = replaceVertexInput(output, input, port);
  const locals = [
    ...port.vertex.inputs.map((input) => input[5]),
    "mat4 _WorldToObject = inverse(modelMatrix);",
    "mat4 _ViewProjection = projectionMatrix * viewMatrix;",
  ];
  output = output.replace(/void main\(\)\s*\{/, `void main()\n{\n    ${locals.join("\n    ")}`);
  output = output.replace(/^\s*gl_Position\.y\s*=\s*-gl_Position\.y;\s*$/m, "");
  assert.doesNotMatch(
    output,
    /layout\(location = \d+\) in|gl_Position\.y\s*=\s*-gl_Position\.y/,
    `${port.shaderKey}: vertex adaptation incomplete`,
  );
  return `${output.trimEnd()}\n`;
}

function adaptFragment(source, context, port) {
  let output = source.replace(/^#version 300 es\s*/m, "");
  output = replaceStageUbo(
    output,
    port.fragment,
    context.metadata,
    context.reflection.fragment,
    "PGlobals",
    port,
  );
  output = adaptThreeWorldVectorsToUnityDataAxes(output, {
    bindings: port.fragment.worldVectors.map(([sourceName, alias, expectedOccurrences]) => ({
      source: sourceName,
      alias,
      expectedOccurrences,
    })),
  });
  output = adaptThreeViewForwardToUnityDataAxes(output, {
    matrixName: "viewMatrix",
    targetName: port.fragment.viewForwardTarget,
  });
  assert.match(
    output,
    new RegExp(`${port.fragment.outputs[1]}\\s*=\\s*vec4\\(0\\.0\\)`),
    `${port.shaderKey}: MRT1 zero output changed`,
  );
  return `${output.trimEnd()}\n`;
}

function runtimeContract(port) {
  return {
    schema: "pocket-card-render/webgl-runtime-port@1",
    shader_key: port.shaderKey,
    attributes: port.attributes,
    engine_uniforms: {
      modelMatrix: "mat4",
      viewMatrix: "mat4",
      projectionMatrix: "mat4",
      cameraPosition: "vec3",
    },
    material_uniforms: port.materialUniforms,
    backend_uniforms: {
      _ShadowUVTranslate: { type: "vec2", value: [0, 0] },
    },
    backend_texture_defaults: { _CubeMap: "neutral-gray-cube" },
    require_complete_active_bindings: true,
    camera_from_view: true,
    mrt_attachments: 2,
    stencil_normalization: "none",
    stencil_face_mode: "generic",
    backend_basis_conversions: {
      fragment: {
        worldVectors: port.fragment.worldVectors.map(
          ([source, alias, expectedOccurrences]) => ({ source, alias, expectedOccurrences }),
        ),
        viewForwards: [{
          matrixName: "viewMatrix",
          targetName: port.fragment.viewForwardTarget,
        }],
      },
    },
  };
}

function validateReflection(reflection, metadata, port) {
  assert.deepEqual(metadata.selector.keywords, port.keywords);
  assert.equal(metadata.selector.semanticExecutableId, port.semanticExecutableId);
  assert.equal(metadata.parameterReflectionSha256, port.parameterReflectionSha256);
  assert.equal(metadata.artifacts.parameterEntry.byteSize, port.parameterEntryBytes);
  assert.equal(metadata.parameterReflection.bindingClosure.constantBuffersMatch, true);
  stageUbo(reflection.vertex, port.vertex, port);
  stageUbo(reflection.fragment, port.fragment, port);
  assert.deepEqual(
    rows(reflection.vertex.inputs),
    port.vertex.inputs.map(([location, type, name]) => ({ name, type, location }))
      .sort((left, right) => left.location - right.location),
  );
  assert.deepEqual(
    rows(reflection.fragment.outputs),
    port.fragment.outputs.map((name, location) => ({ name, type: "vec4", location })),
  );
  assert.deepEqual(
    [...(reflection.fragment.textures || [])]
      .sort((left, right) => left.binding - right.binding)
      .map(({ binding }) => binding),
    port.samplerSlots.map((_, binding) => binding),
  );
}

for (const port of PORTS) {
  const vertexFile = `${port.stem}.vert.glsl`;
  const fragmentFile = `${port.stem}.frag.glsl`;
  const manifestFile = `${port.stem}_uniforms.json`;
  const contract = runtimeContract(port);
  const result = await generateExactSelectorPort({
    shader: port.shaderKey,
    generatedBy: GENERATED_BY,
    extraction: {
      selectorId: port.selectorId,
      candidateWitnessId: port.candidateWitnessId,
      expectedProofGraphSha256: PROOF_GRAPH_SHA256,
      expectedPortIndexSha256: PORT_INDEX_SHA256,
      decryptedRoot: path.resolve(SHADER_ROOT, "..", ".."),
      prefix: port.stem,
      rootDir: ROOT,
    },
    output: {
      outDir: OUT,
      vertex: vertexFile,
      fragment: fragmentFile,
      manifest: manifestFile,
      check: CHECK,
    },
    expectedSpirvCrossSha256: port.crossSha256,
    validateReflection: (reflection, metadata) => validateReflection(reflection, metadata, port),
    adaptVertex: (source, context) => adaptVertex(source, context, port),
    adaptFragment: (source, context) => adaptFragment(source, context, port),
    joinConstantBufferStages: true,
    passPolicy: PASS_POLICY,
    runtimeContract: contract,
    substitutions: {
      vertex: [
        "map official vertex channels to Three.js r165 attributes",
        "map Unity object/world/view-projection matrices and camera to Three.js engine uniforms",
        "remove Unity Vulkan clip-space Y inversion for WebGL clip space",
      ],
      fragment: [
        "map official material and engine constant-buffer members to typed Three.js uniforms",
        "convert Three camera, world position, world normal and view-forward vectors to Unity data axes",
        "preserve official sampler binding order and zero-valued MRT1 output",
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
        { kind: "glsl-version-ownership", owner: "three-raw-shader-material" },
      ],
    },
    webglSources: {
      vertex: `public/shaders/${vertexFile}`,
      fragment: `public/shaders/${fragmentFile}`,
    },
    manifestExtras: {
      mrt: {
        primary: port.fragment.outputs[0],
        emissive: port.fragment.outputs[1],
        secondary_value: "zero",
      },
      backend_uniform_evidence: {
        _ShadowUVTranslate: {
          classification: "backend-bound-zero",
          reason: "active official UBO field absent from both serialized Material values and Shader property defaults",
        },
      },
    },
  });
  assert.deepEqual(
    result.samplerBindings.map(({ slot }) => slot),
    port.samplerSlots,
    `${port.shaderKey}: active sampler slots changed`,
  );
  console.log(`${CHECK ? "verified" : "generated"} ${port.stem}`);
}
