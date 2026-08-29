// Generate the selector-bound WebGL2 port for the official TMP Sprite(to RT) program.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  officialSample,
  officialSampleSha256,
} from "./official-sample.mjs";
import { atomicWriteFileSync } from "./atomic-publish.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PYTHON = process.env.PYTHON || "python";
const SPIRV_CROSS = process.env.SPIRV_CROSS || "spirv-cross";
const SPIRV_VAL = process.env.SPIRV_VAL || "spirv-val";
const CHECK = process.argv.includes("--check") || process.env.PCR_EXACT_CHECK === "1";

const SELECTOR_ID = "efa03dcbfe79cd09734a60516654ad6dcd6a92d717eb54b9b01baccf92f56c17";
const CANDIDATE_WITNESS_ID =
  "d3e59c58da95b14e62179d5f3b0fc1f546289eb4f1f469f80be2ebc3c52de8d4";
const EXPECTED = {
  sampleId: "ptcgp-1.6.0-unity-2022.3.62f2-proof-r2",
  sampleManifestSha256: "6308a8551afa4702c359c26f8506a62fb74774c98b6af09747a4e560af8901e6",
  materialIdentity: "CAB-31d82d0d65bdfa6728d746c34920e08d:-1050951510632854060",
  shaderIdentity: "CAB-5defc05c0250f5fe935b9cd9b28fdca5:2168984029091550199",
  shaderName: "Lettuce/Common/Card/TextMeshPro/Sprite(to RT)",
  executableId: "983d233751c4653fbb7fcc71082de5994a5ce85952b54622f97ffff5c82d4d6e",
  semanticExecutableId:
    "d349fa456062441c91a51916b1c8ac03efaffd15112cf55052a209e7e5cca9f3",
  passStateSha256: "749196a0b5b748f75aed6e40f084fe22429407480f09a8688bfc51e2fd87f0cf",
  commonBindingsSha256:
    "3ebda9f44bdf3c693cfbf91fc1e1c9e5334d70590e7a32f19300fddf198b3df4",
  parameterReflectionSha256:
    "5c87c1fdd1145ccaf302f496aa214838bdf07b82169192c1770aa01f01780200",
  programBindChannelsSha256:
    "6bd2091b9d4440220fac808104895bb7c6d9b2a5609def65f59adb73b1f358c0",
  modules: {
    vertex: {
      byteSize: 2736,
      sha256: "5f2f316db1877ae0c0a1a1801384fcc7244a353961145e454878205eb7a4b058",
      crossSourceSha256:
        "6e7d90c825011ec9a85718ff22dac339ea44c71e1cc886c82ad26c26dd5d2210",
      reflectionSha256:
        "49b1a663f902daf4be842c693ff885f6891fdfb180a67cc26c6c0d6e456ced09",
    },
    fragment: {
      byteSize: 1740,
      sha256: "43e4c386774200c649e187ccec51e9fa4ec7671af3cfb84aa7b368e83de72f14",
      crossSourceSha256:
        "ee8942c929f5eb547bf0101f31494d79c6742a78f3373ef112756dd5643ed48e",
      reflectionSha256:
        "df4cbd928d5b1b6a43b9034c8d484fc90cfdeec50ad7982df0519a91c55f3734",
    },
  },
};

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, stable(value[key])]),
    );
  }
  return value;
}

function canonicalSha256(value) {
  return sha256(JSON.stringify(stable(value)));
}

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });
}

function replaceOnce(source, before, after, label) {
  const at = source.indexOf(before);
  if (at < 0 || source.indexOf(before, at + before.length) >= 0) {
    throw new Error(`${label}: source pattern is missing or non-unique`);
  }
  return source.slice(0, at) + after + source.slice(at + before.length);
}

function stripVersion(source) {
  return replaceOnce(
    source.replace(/\r\n/g, "\n"),
    "#version 300 es\n",
    "",
    "GLSL version",
  );
}

function replaceUbo(source, block, declarations) {
  const pattern = new RegExp(`layout\\(std140\\) uniform ${block}[\\s\\S]*?}\\s*_[0-9]+;\\s*`);
  const output = source.replace(pattern, `${declarations.join("\n")}\n\n`);
  if (output === source) throw new Error(`${block} replacement failed`);
  return output;
}

function adaptVertex(source) {
  let output = stripVersion(source);
  output = replaceUbo(output, "_18_20", [
    "uniform highp mat4 modelMatrix;",
    "uniform highp mat4 viewMatrix;",
    "uniform highp mat4 projectionMatrix;",
    "uniform mediump vec4 _Color;",
  ]);
  output = replaceOnce(
    output,
    "layout(location = 0) in vec4 _11;",
    "layout(location = 0) in vec3 position;",
    "position input",
  );
  output = replaceOnce(
    output,
    "layout(location = 1) in vec4 _82;",
    "layout(location = 1) in vec4 color;",
    "color input",
  );
  output = replaceOnce(
    output,
    "layout(location = 2) in vec2 _93;",
    "layout(location = 2) in vec2 uv;",
    "UV input",
  );
  output = replaceOnce(
    output,
    "out mediump vec4 _87;",
    "out mediump vec4 vColor;",
    "color varying",
  );
  output = replaceOnce(
    output,
    "out mediump vec2 vs_TEXCOORD0;",
    "out mediump vec2 vUv;",
    "UV varying",
  );
  output = replaceOnce(
    output,
    "out vec4 vs_TEXCOORD1;",
    "out highp vec4 vSourcePosition;",
    "source-position varying",
  );
  output = output
    .replace(/_20\._m0/g, "_ObjectToWorld")
    .replace(/_20\._m1/g, "_ViewProjection")
    .replace(/_20\._m2/g, "_Color")
    .replace(/\b_87\b/g, "vColor")
    .replace(/\bvs_TEXCOORD0\b/g, "vUv")
    .replace(/\bvs_TEXCOORD1\b/g, "vSourcePosition");
  output = replaceOnce(
    output,
    "void main()\n{",
    `void main()
{
    vec4 _11 = vec4(position, 1.0);
    vec4 _82 = color;
    vec2 _93 = uv;
    mat4 _ObjectToWorld = modelMatrix;
    mat4 _ViewProjection = projectionMatrix * viewMatrix;`,
    "WebGL2 input adapters",
  );
  output = replaceOnce(
    output,
    "    gl_Position.y = -gl_Position.y;\n",
    "",
    "Vulkan clip-space Y flip",
  );
  if (/layout\(std140\)|_20\._m|gl_Position\.y\s*=\s*-gl_Position\.y/.test(output)) {
    throw new Error("TMP Sprite vertex adaptation is incomplete");
  }
  if (!output.includes("vColor = _9;")
      || !output.includes("vUv = _93;")
      || !output.includes("vSourcePosition = _11;")) {
    throw new Error("TMP Sprite vertex dataflow changed");
  }
  return `precision highp float;\nprecision highp int;\n\n${output.trim()}\n`;
}

function adaptFragment(source) {
  let output = stripVersion(source);
  output = replaceUbo(output, "_22_24", [
    "uniform highp vec4 _TextureSampleAdd;",
  ]);
  output = replaceOnce(
    output,
    "uniform mediump sampler2D _13;",
    "uniform mediump sampler2D _MainTex;",
    "main sampler",
  );
  output = replaceOnce(
    output,
    "in vec2 vs_TEXCOORD0;",
    "in mediump vec2 vUv;",
    "UV varying",
  );
  output = replaceOnce(
    output,
    "in vec4 _33;",
    "in mediump vec4 vColor;",
    "color varying",
  );
  output = replaceOnce(
    output,
    "layout(location = 0) out highp vec4 _45;",
    "layout(location = 0) out highp vec4 outColor;",
    "primary output",
  );
  output = replaceOnce(
    output,
    "layout(location = 1) out highp vec4 _56;",
    "layout(location = 1) out highp vec4 outAux;",
    "secondary output",
  );
  output = output
    .replace(/_24\._m0/g, "_TextureSampleAdd")
    .replace(/\b_13\b/g, "_MainTex")
    .replace(/\bvs_TEXCOORD0\b/g, "vUv")
    .replace(/\b_33\b/g, "vColor")
    .replace(/\b_45\b/g, "outColor")
    .replace(/\b_56\b/g, "outAux");
  const required = [
    "_9 = texture(_MainTex, vUv);",
    "_20 = _9 + _TextureSampleAdd;",
    "_20 *= vColor;",
    "_38 = _20.www * _20.xyz;",
    "outColor.w = _20.w;",
    "outAux = vec4(0.0);",
  ];
  for (const statement of required) {
    if (!output.includes(statement)) {
      throw new Error(`TMP Sprite fragment dataflow lost: ${statement}`);
    }
  }
  if (/layout\(std140\)|_24\._m|\b_13\b|vs_TEXCOORD0/.test(output)) {
    throw new Error("TMP Sprite fragment adaptation is incomplete");
  }
  return `${output.trim()}\n`;
}

function extractEvidence() {
  const args = [
    "build/extract_official_tmp_sprite_program.py",
    "--expected-selector-id", SELECTOR_ID,
    "--expected-candidate-witness-id", CANDIDATE_WITNESS_ID,
  ];
  if (process.env.PCR_DECRYPTED_ROOT) {
    args.push("--decrypted-root", process.env.PCR_DECRYPTED_ROOT);
  }
  if (process.env.PCR_OFFICIAL_SAMPLE_MANIFEST) {
    args.push("--official-sample-manifest", process.env.PCR_OFFICIAL_SAMPLE_MANIFEST);
  }
  return JSON.parse(run(PYTHON, args, {
    shell: process.platform === "win32",
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
    maxBuffer: 8 * 1024 * 1024,
  }).replace(/^\uFEFF/, ""));
}

function assertEvidence(evidence) {
  assert.equal(evidence.schema, "pocket-card-render/official-tmp-sprite-program-extract@1");
  assert.equal(evidence.status, "exact-static-source-with-runtime-boundaries");
  assert.deepEqual(evidence.provenance, {
    sampleId: EXPECTED.sampleId,
    sampleManifestSha256: EXPECTED.sampleManifestSha256,
    gameVersion: "1.6.0",
    unityVersion: "2022.3.62f2",
  });
  assert.equal(officialSample.sampleId, EXPECTED.sampleId);
  assert.equal(officialSampleSha256, EXPECTED.sampleManifestSha256);
  assert.equal(evidence.assetChain.material.identity, EXPECTED.materialIdentity);
  assert.equal(evidence.assetChain.material.shaderIdentity, EXPECTED.shaderIdentity);
  assert.equal(evidence.assetChain.shader.identity, EXPECTED.shaderIdentity);
  assert.equal(evidence.assetChain.shader.name, EXPECTED.shaderName);
  assert.deepEqual(evidence.assetChain.material.keywords, []);
  assert.deepEqual(evidence.assetChain.material.invalidKeywords, []);
  assert.deepEqual(evidence.assetChain.material.serializedProperties.mainTexture, {
    fileId: 0,
    pathId: "3209478181533236899",
    scale: [1, 1],
    offset: [0, 0],
  });
  assert.deepEqual(evidence.assetChain.material.serializedProperties.color, [1, 1, 1, 1]);
  assert.deepEqual(evidence.assetChain.spriteAsset.materialPPtr, {
    fileId: 0,
    pathId: "-1050951510632854060",
  });
  assert.deepEqual(evidence.assetChain.material.shaderPPtr, {
    fileId: 6,
    pathId: "2168984029091550199",
  });
  assert.equal(evidence.selector.selectorId, SELECTOR_ID);
  assert.equal(evidence.selector.candidateWitnessId, CANDIDATE_WITNESS_ID);
  assert.deepEqual(evidence.selector.candidate, {
    subshader: 0,
    pass: 0,
    programBlobIndex: 4,
    parameterBlobIndex: 0,
    gpuProgramType: 25,
    keywordIndices: [],
    keywords: [],
    shaderRequirements: 33,
    stages: [{
      stageMetadata: "progVertex",
      playerGroup: 3,
      variantIndex: 0,
    }],
  });
  assert.equal(evidence.executable.executableId, EXPECTED.executableId);
  assert.equal(evidence.executable.semanticExecutableId, EXPECTED.semanticExecutableId);
  assert.equal(evidence.pass.passStateSha256, EXPECTED.passStateSha256);
  assert.equal(evidence.pass.commonBindingsSha256, EXPECTED.commonBindingsSha256);
  assert.equal(
    evidence.bindings.parameterReflectionSha256,
    EXPECTED.parameterReflectionSha256,
  );
  assert.equal(
    evidence.bindings.programBindChannels.sha256,
    EXPECTED.programBindChannelsSha256,
  );
  assert.deepEqual(
    evidence.executable.modules.map(({ stage, byteSize, sha256: hash }) => ({
      stage, byteSize, sha256: hash,
    })),
    [
      { stage: "fragment", ...EXPECTED.modules.fragment },
      { stage: "vertex", ...EXPECTED.modules.vertex },
    ].map(({ stage, byteSize, sha256: hash }) => ({ stage, byteSize, sha256: hash })),
  );
  assert.deepEqual(evidence.runtimeBoundaries.map(({ id, status }) => [id, status]), [
    ["guest-runtime-dispatch", "runtime-required"],
    ["dynamic-canvas-keywords", "runtime-required"],
    ["dynamic-canvas-fixed-function-state", "runtime-required"],
    ["texture-sample-add-value", "runtime-required"],
    ["render-target-attachments", "runtime-required"],
    ["tmp-submesh-canvas-order", "runtime-required"],
  ]);
}

function dynamicStateContract(evidence) {
  const state = evidence.pass.renderState;
  const defaults = evidence.assetChain.material.serializedProperties.canvasStateDefaults;
  const dynamic = (shaderPath, entry, materialDefault) => ({
    shaderPath,
    property: entry.property,
    serializedPlaceholder: entry.value,
    materialSerializedDefault: materialDefault ?? null,
    guestResolvedValue: null,
    status: "runtime-required",
  });
  return {
    passStateSha256: evidence.pass.passStateSha256,
    commonBindingsSha256: evidence.pass.commonBindingsSha256,
    serializedState: state,
    fixedSerializedState: {
      blend: {
        source: "One",
        destination: "OneMinusSrcAlpha",
        sourceValue: 1,
        destinationValue: 10,
        separate: false,
      },
      depthWrite: false,
      depthClip: true,
      cull: "Off",
      alphaToCoverage: false,
    },
    dynamicProperties: {
      depthTest: dynamic("depth.test", state.depth.test, undefined),
      colorMask: dynamic("blend.colorMask", state.blend.colorMask, defaults._ColorMask),
      stencilReference: dynamic(
        "stencil.reference", state.stencil.reference, defaults._Stencil,
      ),
      stencilCompare: dynamic(
        "stencil.compare", state.stencil.compare, defaults._StencilComp,
      ),
      stencilPass: dynamic(
        "stencil.pass", state.stencil.pass, defaults._StencilOp,
      ),
      stencilReadMask: dynamic(
        "stencil.readMask", state.stencil.readMask, defaults._StencilReadMask,
      ),
      stencilWriteMask: dynamic(
        "stencil.writeMask", state.stencil.writeMask, defaults._StencilWriteMask,
      ),
    },
    guestResolvedStateStatus: "runtime-required",
  };
}

function writeOrCheck(relativePath, bytes) {
  const target = path.resolve(ROOT, relativePath);
  if (!target.startsWith(`${ROOT}${path.sep}`)) {
    throw new Error(`output escapes repository: ${relativePath}`);
  }
  if (CHECK) {
    if (!fs.statSync(target, { throwIfNoEntry: false })?.isFile()) {
      throw new Error(`${relativePath} is absent in check mode`);
    }
    if (!fs.readFileSync(target).equals(bytes)) {
      throw new Error(`${relativePath} drifted from official regeneration`);
    }
  } else {
    atomicWriteFileSync(target, bytes);
  }
}

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pcr-tmp-sprite-program-"));
try {
  const evidence = extractEvidence();
  assertEvidence(evidence);
  const reflection = {};
  const crossSources = {};
  const adapted = {};
  const moduleRecords = {};
  for (const stage of ["vertex", "fragment"]) {
    const module = evidence.executable.modules.find((entry) => entry.stage === stage);
    assert.ok(module, `${stage} module is absent`);
    const bytes = Buffer.from(module.spvHex, "hex");
    assert.deepEqual(
      [bytes.length, sha256(bytes)],
      [EXPECTED.modules[stage].byteSize, EXPECTED.modules[stage].sha256],
      `${stage} SPIR-V`,
    );
    const spv = path.join(tempDir, `${stage}.spv`);
    fs.writeFileSync(spv, bytes);
    run(SPIRV_VAL, [spv]);
    crossSources[stage] = run(SPIRV_CROSS, [spv, "--version", "300", "--es"]);
    assert.equal(
      sha256(crossSources[stage]),
      EXPECTED.modules[stage].crossSourceSha256,
      `${stage} SPIRV-Cross source changed`,
    );
    reflection[stage] = JSON.parse(run(SPIRV_CROSS, [spv, "--reflect"]));
    assert.equal(
      canonicalSha256(reflection[stage]),
      EXPECTED.modules[stage].reflectionSha256,
      `${stage} SPIRV-Cross reflection changed`,
    );
    adapted[stage] = stage === "vertex"
      ? adaptVertex(crossSources[stage])
      : adaptFragment(crossSources[stage]);
    moduleRecords[stage] = {
      byteSize: bytes.length,
      spirvSha256: sha256(bytes),
      spirvCrossSourceSha256: sha256(crossSources[stage]),
      reflectionSha256: canonicalSha256(reflection[stage]),
    };
  }

  assert.deepEqual(
    reflection.vertex.inputs.map(({ name, type, location }) => ({ name, type, location })),
    [
      { name: "_11", type: "vec4", location: 0 },
      { name: "_82", type: "vec4", location: 1 },
      { name: "_93", type: "vec2", location: 2 },
    ],
  );
  assert.deepEqual(
    reflection.vertex.ubos.map(({ name, block_size, set, binding }) => ({
      name, blockSize: block_size, set, binding,
    })),
    [{ name: "_18_20", blockSize: 144, set: 1, binding: 1 }],
  );
  assert.deepEqual(
    reflection.fragment.textures.map(({ name, type, set, binding }) => ({
      name, type, set, binding,
    })),
    [{ name: "_13", type: "sampler2D", set: 0, binding: 0 }],
  );
  assert.deepEqual(
    reflection.fragment.ubos.map(({ name, block_size, set, binding }) => ({
      name, blockSize: block_size, set, binding,
    })),
    [{ name: "_22_24", blockSize: 16, set: 1, binding: 0 }],
  );
  assert.deepEqual(
    reflection.fragment.outputs.map(({ name, type, location }) => ({
      name, type, location,
    })),
    [
      { name: "_45", type: "vec4", location: 0 },
      { name: "_56", type: "vec4", location: 1 },
    ],
  );

  const vertexPath = "public/shaders/tmp_sprite_to_rt.vert.glsl";
  const fragmentPath = "public/shaders/tmp_sprite_to_rt.frag.glsl";
  const vertexBytes = Buffer.from(adapted.vertex);
  const fragmentBytes = Buffer.from(adapted.fragment);
  const contract = {
    schema: "pocket-card-render/tmp-sprite-program@1",
    schemaVersion: 1,
    generatedBy: "build/build-official-tmp-sprite-program.mjs",
    status: "exact-static-official-source-with-runtime-boundaries",
    provenance: evidence.provenance,
    evidencePolicy: evidence.evidencePolicy,
    role: "TMP_SubMeshUI inline sprite producer to DynamicUI render target",
    classification: {
      textLayoutOwner: "TextMeshProUGUI",
      meshOwner: "TMP_SubMeshUI",
      materialOwner: "TMP_SpriteAsset.material",
      shaderFamily: "TextMeshPro/Sprite(to RT)",
      isTmpSdfGlyph: false,
      isUnityUiImage: false,
    },
    officialAssetChain: evidence.assetChain,
    officialSelector: {
      selectorId: evidence.selector.selectorId,
      candidateWitnessId: evidence.selector.candidateWitnessId,
      compositeIdentitySha256: evidence.selector.compositeIdentitySha256,
      shaderIdentity: evidence.selector.shaderIdentity,
      shaderName: evidence.selector.shaderName,
      keywords: evidence.selector.keywords,
      candidateSelection: evidence.selector.candidateSelection,
      selectionMode: evidence.selector.selectionMode,
      subshader: evidence.selector.subshader,
      pass: evidence.selector.pass,
      candidate: evidence.selector.candidate,
      executableId: evidence.executable.executableId,
      semanticExecutableId: evidence.executable.semanticExecutableId,
    },
    officialProgram: {
      compilerPlatform: 18,
      gpuProgramType: 25,
      segment: evidence.executable.segment,
      programEntry: evidence.executable.programEntry,
      parameterEntry: evidence.executable.parameterEntry,
      programContainerLayoutSha256: evidence.executable.programContainerLayoutSha256,
      identityFields: evidence.executable.identityFields,
      semanticIdentityFields: evidence.executable.semanticIdentityFields,
      modules: moduleRecords,
      stageProgramStatus: "source-hash-bound",
      backendSemanticEquivalenceStatus: "unproved",
    },
    officialPass: dynamicStateContract(evidence),
    officialBindings: {
      programBindChannelsSha256: evidence.bindings.programBindChannels.sha256,
      bindChannels: evidence.bindings.programBindChannels.bindChannels,
      parameterReflectionSha256: evidence.bindings.parameterReflectionSha256,
      parameterReflection: evidence.bindings.parameterReflection,
      common: evidence.bindings.common,
      attributes: [
        {
          officialChannel: "Vertex",
          officialTarget: "Attrib1",
          spirvLocation: 0,
          spirvType: "vec4",
          webglName: "position",
          webglType: "vec3",
        },
        {
          officialChannel: "Color",
          officialTarget: "Attrib2",
          spirvLocation: 1,
          spirvType: "vec4",
          webglName: "color",
          webglType: "vec4",
        },
        {
          officialChannel: "UV0",
          officialTarget: "Attrib3",
          spirvLocation: 2,
          spirvType: "vec2",
          webglName: "uv",
          webglType: "vec2",
        },
      ],
      samplers: [{
        slot: "_MainTex",
        spirvName: "_13",
        set: 0,
        binding: 0,
        dimension: 2,
        source: "serialized-common",
      }],
      uniforms: {
        fragment: {
          _TextureSampleAdd: {
            buffer: "PGlobals610448065",
            offset: 0,
            type: "vec4",
            precision: "highp",
          },
        },
        vertex: {
          unity_ObjectToWorld: {
            buffer: "VGlobals610448065",
            offset: 0,
            type: "mat4",
            webglName: "modelMatrix",
          },
          unity_MatrixVP: {
            buffer: "VGlobals610448065",
            offset: 64,
            type: "mat4",
            webglExpression: "projectionMatrix * viewMatrix",
          },
          _Color: {
            buffer: "VGlobals610448065",
            offset: 128,
            type: "vec4",
            precision: "mediump",
          },
        },
      },
    },
    fragmentSemantics: {
      sampled: "sample = texture(_MainTex, uv) + _TextureSampleAdd",
      tinted: "p = sample * vertexColor * _Color",
      primaryRgb: "p.rgb * p.a",
      primaryAlpha: "p.a",
      secondary: "vec4(0.0)",
      alphaModel: "premultiplied",
    },
    webglSources: {
      vertex: {
        path: vertexPath,
        sha256: sha256(vertexBytes),
      },
      fragment: {
        path: fragmentPath,
        sha256: sha256(fragmentBytes),
      },
    },
    webglAdaptation: {
      status: "source-hash-bound",
      operations: [
        "flatten official std140 buffers into named WebGL uniforms",
        "map Vertex/Color/UV0 to position/color/uv using the official bind-channel table",
        "construct vec4(position, 1.0) for the official vec4 position input",
        "map unity_ObjectToWorld and unity_MatrixVP without changing matrix dataflow",
        "remove the Vulkan clip-space Y inversion once",
        "rename stage interfaces, sampler, and MRT outputs without changing fragment math",
      ],
      prohibitedTransforms: [
        "no _MainTex_ST transform",
        "no texture-coordinate Y flip",
        "no SDF atlas or UV2 glyph packing",
        "no straight-alpha rewrite",
      ],
    },
    runtimeBoundaries: evidence.runtimeBoundaries,
    exactStaticClaims: [
      "SpriteAsset -> Material -> Shader PPtr chain",
      "serialized empty-keyword selector and unique Vulkan candidate witness",
      "program and parameter entries, SPIR-V modules, pass bytes, and common bindings",
      "Vertex/Color/UV0 bind channels and static premultiplied MRT fragment dataflow",
      "serialized fixed blend, depth-write, cull, and alpha-to-coverage state",
    ],
  };
  const contractBytes = Buffer.from(`${JSON.stringify(contract, null, 2)}\n`);

  writeOrCheck(vertexPath, vertexBytes);
  writeOrCheck(fragmentPath, fragmentBytes);
  writeOrCheck("public/render/tmp-sprite-program.json", contractBytes);

  console.log(
    `${CHECK ? "verified" : "generated"} official TMP Sprite(to RT) selector-bound static port`,
  );
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
