// Generate the WebGL2 UI Default From RT program from pinned official Vulkan SPIR-V.
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { atomicWriteFileSync } from "./atomic-publish.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "public", "shaders");
const PYTHON = process.env.PYTHON || "python";
const SPIRV_CROSS = process.env.SPIRV_CROSS || "spirv-cross";
const CHECK = process.argv.includes("--check") || process.env.PCR_EXACT_CHECK === "1";
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pcr-ui-default-rt-"));

const PINNED = {
  source: {
    apkm: [285917033, "9b7f9067e00a54f342bd4f17e669ceeb86b80bb7d34ff2d0d0fe82050a62f201"],
    baseApk: [43516766, "815dc606f3b3e3404199fac80abb46b9249948828178a5cbf6aedb3d9e6809de"],
    arm64Split: [56968881, "7faf449bae431dcfeda4f882ecb04290af66cc4ccfeefc620e24cac70d22fcec"],
    libil2cpp: [128218264, "3e78eedc62770fff4cb129b4b8d898950e131b710b3c099237fe20d2d34ca48e"],
    decryptedMetadata: [31429296, "bf58e06a98f9e9e05a1635f512ea432d33971bfc8280ba26df1c93e94b4f3cb9"],
  },
  material: {
    bundle: [2782, "f160b0f6ebc9773f748a9e749cf40ae48fea0be76756c78342e32a2a26610299"],
    object: ["8096372138031489333", 1020, "675cdeb44a8660bca55ba70846c391bcb182244d22956f6669d9f8eadd23d099"],
    serializedFile: "CAB-2e44d839e9c2055e1f960cfe120c1e40",
  },
  shader: {
    name: "Lettuce/Common/CardNew/UI/Default(from RT)",
    bundle: [27685, "6bea6c98e97bfd7d322dd8f912a9a30fa21fd0fc273e69dd69414c09627ae02e"],
    object: ["2332897728963208010", 14544, "61b9ae7be77d58e2a363ffe0ad3243356601c0a8400016de0dd5dc4bef2a109a"],
    serializedFile: "CAB-273b7969e0989fa9dbdee5c7a4238f8a",
  },
  program: {
    compressed: [10669, "d2dbc7d7dceacacdbfca36d8198d4b1d1c186f704365a1b85993ed085278cdce"],
    decompressed: [52828, "3287d2d433b57d143c797e0c6162a5fa35e7beff67a9f4166f8a9bb0290b5ed9"],
    entries: [
      [388,"7ceaeb33aa7859f719eb61d87975b0a99794712f32c20cb36cdb13f664f4f3d2"],[432,"9fde49937d922e0f5e5620efec4aa6a920997f049aeab73a9f755440281f0cae"],
      [388,"2b947f42e9e8ac3b8c2a43312a04d6ca41c0845406fb35724d94cafcea8ac19d"],[432,"8357f8af7abdb4639af5597e30b53d5e4f3d4637a697ab4fa065e107e200537a"],
      [428,"40578ab899c68e5a2b4bdce2146d66063650900e2d3958e0886991c0e31563ea"],[472,"6eec6957d921735e3b375b79bc594445fffeb42dd79ec058f6d3212a2bfe2940"],
      [428,"68fd335b5f36ca5eea30eef946f79d062f396bbb84dd8b5487823242f61c146d"],[472,"855ae4856732711b674e1b3731e8d202b3c64e441536ac66e47b4e297a6b3449"],
      [1648,"fa69bd7b706e1b43f15ecda7144694b5832e6edcc0c254a60cea4b7cd69cbf26"],[10020,"af1be6f29a80eb6672bdfc54ac78a00d3b0e69ba16b74d703a7d45d66e149c3d"],
      [1820,"632edad478091b33e7d8fc018fe1c3474b78d98c9145316d16230f58bb66ad36"],[10176,"d485840238ac0072f3aecb8f0d928fc07a87ba8499dbda65156de2cbaefd143d"],
      [2096,"f8e34101a12e2a14373e8aa9684967e166a1f316eba9503b018fb5bc4c0e4710"],[10508,"024bc739cf1a37e5875b2fd74c6ef3a3222619dee4d2edadfd52d04b27262d0e"],
      [2260,"d8bbd5589ad58d5b3f9373f1adcbffe91944fe6e051ccc2df39d378b7fb34e84"],[10664,"c9decf9ff1ae514f29bcf3322aec92e30a11d88030a89414913f25690d4227f8"],
    ],
  },
  modules: {
    vertex: [2916, "f7f9575dc16cbe21765696d9eae09674e5092db11161f7230450462f9df348c1", "bcea6eff397181895a867ac88ab99cd8ce285a6a16f791abccbcce12175c8162"],
    fragment: [2028, "af859a616200510bddda23401e28eb37b34c9871ac9eff3d5b5f5a29da49ff71", "90f3a9dd86e2c73f1d7b6b7574e445b97950f43374c65b3ec198de13234b16f7"],
  },
};

function run(command, args, options = {}) {
  return execFileSync(command, args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...options });
}
function same(actual, expected, label) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
function sha256(value) { return crypto.createHash("sha256").update(value).digest("hex"); }
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  return value;
}
function replaceOnce(source, before, after, label) {
  const at = source.indexOf(before);
  if (at < 0 || source.indexOf(before, at + before.length) >= 0) throw new Error(`${label}: source pattern missing or non-unique`);
  return source.slice(0, at) + after + source.slice(at + before.length);
}
function stripVersion(source) { return replaceOnce(source.replace(/\r\n/g, "\n"), "#version 300 es\n", "", "GLSL version"); }
function replaceUbo(source, block, owner, declarations) {
  const pattern = new RegExp(`layout\\(std140\\) uniform ${block}[\\s\\S]*?}\\s*${owner};\\s*`);
  const output = source.replace(pattern, `${declarations.join("\n")}\n\n`);
  if (output === source) throw new Error(`${block} replacement failed`);
  return output;
}

function adaptVertex(source) {
  let out = stripVersion(source);
  out = replaceUbo(out, "_18_20", "_20", [
    "uniform highp mat4 modelMatrix;", "uniform highp mat4 viewMatrix;", "uniform highp mat4 projectionMatrix;",
    "uniform highp vec4 _Color;", "uniform highp vec4 _MainTex_ST;",
  ]);
  out = replaceOnce(out, "layout(location = 0) in vec4 _11;", "layout(location = 0) in vec3 position;", "position input");
  out = replaceOnce(out, "layout(location = 1) in vec4 _82;", "layout(location = 1) in vec4 color;", "color input");
  out = replaceOnce(out, "layout(location = 2) in vec2 _93;", "layout(location = 2) in vec2 uv;", "UV input");
  out = replaceOnce(out, "out mediump vec4 _87;", "out mediump vec4 vColor;", "color varying");
  out = replaceOnce(out, "out vec2 vs_TEXCOORD0;", "out highp vec2 vUv;", "UV varying");
  out = replaceOnce(out, "out vec4 vs_TEXCOORD1;", "out highp vec4 vSourcePosition;", "position varying");
  out = out.replace(/_20\._m0/g, "_ObjectToWorld").replace(/_20\._m1/g, "_ViewProjection")
    .replace(/_20\._m2/g, "_Color").replace(/_20\._m3/g, "_MainTex_ST")
    .replace(/\b_87\b/g, "vColor").replace(/\bvs_TEXCOORD0\b/g, "vUv").replace(/\bvs_TEXCOORD1\b/g, "vSourcePosition");
  out = replaceOnce(out, "void main()\n{", `void main()\n{\n    vec4 _11 = vec4(position, 1.0);\n    vec4 _82 = color;\n    vec2 _93 = uv;\n    mat4 _ObjectToWorld = modelMatrix;\n    mat4 _ViewProjection = projectionMatrix * viewMatrix;`, "WebGL2 inputs");
  out = replaceOnce(out, "    gl_Position.y = -gl_Position.y;\n", "", "Vulkan clip Y flip");
  if (/layout\(std140\)|_20\._m|gl_Position\.y\s*=\s*-gl_Position\.y/.test(out)) throw new Error("vertex adaptation incomplete");
  return `precision highp float;\nprecision highp int;\n\n${out.trim()}\n`;
}

function adaptFragment(source) {
  let out = stripVersion(source);
  out = replaceUbo(out, "_24_26", "_26", ["uniform highp vec4 _TextureSampleAdd;"]);
  out = replaceOnce(out, "uniform mediump sampler2D _13;", "uniform mediump sampler2D _MainTex;", "main sampler");
  out = replaceOnce(out, "in highp vec2 vs_TEXCOORD0;", "in highp vec2 vUv;", "UV varying");
  out = replaceOnce(out, "in vec4 _48;", "in mediump vec4 vColor;", "color varying");
  out = replaceOnce(out, "layout(location = 0) out highp vec4 _59;", "layout(location = 0) out highp vec4 outColor;", "primary output");
  out = replaceOnce(out, "layout(location = 1) out highp vec4 _61;", "layout(location = 1) out highp vec4 outAux;", "secondary output");
  out = out.replace(/_26\._m0/g, "_TextureSampleAdd").replace(/\b_13\b/g, "_MainTex")
    .replace(/\bvs_TEXCOORD0\b/g, "vUv").replace(/\b_48\b/g, "vColor").replace(/\b_59\b/g, "outColor").replace(/\b_61\b/g, "outAux");
  if (!out.includes("_9 = texture(_MainTex, vUv);") || !out.includes("_20.w = (-_9.w) + 1.0;") || !out.includes("_61 = vec4(0.0);") && !out.includes("outAux = vec4(0.0);")) throw new Error("official fragment dataflow was not preserved");
  if (/layout\(std140\)|_26\._m|vs_TEXCOORD0|\b_13\b/.test(out)) throw new Error("fragment adaptation incomplete");
  return `${out.trim()}\n`;
}

function readEvidence() {
  const args = ["build/extract_official-ui-default-from-rt.py"];
  if (process.env.PCR_APKM) args.push("--apkm", process.env.PCR_APKM);
  if (process.env.PCR_DECRYPTED_ROOT) args.push("--decrypted-root", process.env.PCR_DECRYPTED_ROOT);
  return JSON.parse(run(PYTHON, args, { env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" }, shell: process.platform === "win32", maxBuffer: 4 * 1024 * 1024 }).replace(/^\uFEFF/, ""));
}

function assertEvidence(e) {
  for (const [key, expected] of Object.entries(PINNED.source)) same([e.source[key].byteSize, e.source[key].sha256], expected, `source.${key}`);
  same([e.material.bundle.byteSize, e.material.bundle.sha256], PINNED.material.bundle, "material bundle");
  same([e.material.materialObject.pathId, e.material.materialObject.byteSize, e.material.materialObject.sha256], PINNED.material.object, "material object");
  same([e.material.name, e.material.serializedFile], ["UI_Default_From_RT", PINNED.material.serializedFile], "material identity");
  same(e.material.shaderPPtr, { fileId: 1, pathId: PINNED.shader.object[0] }, "material Shader PPtr");
  same(e.material.savedProperties.textures._MainTex, { fileId: 0, pathId: "0", scale: [1, 1], offset: [0, 0] }, "material MainTex");
  const p = e.shaderProgram;
  same([p.source.bundle.byteSize, p.source.bundle.sha256], PINNED.shader.bundle, "shader bundle");
  same([p.source.shaderObject.pathId, p.source.shaderObject.byteSize, p.source.shaderObject.sha256], PINNED.shader.object, "shader object");
  same([p.shader.name, p.source.serializedFile], [PINNED.shader.name, PINNED.shader.serializedFile], "shader identity");
  same(p.selectedVariant, { stageMetadata: "progVertex", groupIndex: 3, variantIndex: 0, keywordIndices: [], keywords: [], parameterBlobIndex: 0, programBlobIndex: 8, gpuProgramType: 25, shaderRequirements: 1 }, "official variant");
  same([p.programBlock.compressed.byteSize, p.programBlock.compressed.sha256], PINNED.program.compressed, "compressed program");
  same([p.programBlock.decompressed.byteSize, p.programBlock.decompressed.sha256], PINNED.program.decompressed, "decompressed program");
  same(p.programBlock.entries.map(({ length, sha256: hash }) => [length, hash]), PINNED.program.entries, "program entries");
  same(p.bindings.commonTextures, [{ name: "_MainTex", binding: 0, encodedIndex: 134217728, samplerIndex: -1, dimension: 2, multisampled: false, source: "common" }], "texture binding");
  same(e.derived.fragmentDataFlow, { tint: "vertexColor * _Color", uv: "uv0 * _MainTex_ST.xy + _MainTex_ST.zw", rgb: "(sample.rgb + _TextureSampleAdd.rgb) * tint.rgb * tint.a", alpha: "(1.0 - sample.a) * tint.a", mrt1: "vec4(0.0)" }, "fragment dataflow");
  same(e.derived.renderBlend, { source: "One", destination: "OneMinusSrcAlpha", sourceValue: 1, destinationValue: 10 }, "blend contract");
  const defaults = e.material.savedProperties.floats;
  same({
    _ColorMask: defaults._ColorMask,
    _Stencil: defaults._Stencil,
    _StencilComp: defaults._StencilComp,
    _StencilOp: defaults._StencilOp,
    _StencilReadMask: defaults._StencilReadMask,
    _StencilWriteMask: defaults._StencilWriteMask,
  }, {
    _ColorMask: 15,
    _Stencil: 0,
    _StencilComp: 8,
    _StencilOp: 0,
    _StencilReadMask: 255,
    _StencilWriteMask: 255,
  }, "serialized Material dynamic-state defaults");
}

function dynamicStateContract(evidence) {
  const state = evidence.shaderProgram.shader.pass.renderState;
  const defaults = evidence.material.savedProperties.floats;
  const dynamic = (path, entry, materialDefault) => ({
    shaderlab_path: path,
    property: entry.property,
    shaderlab_serialized_placeholder: entry.value,
    material_serialized_default: materialDefault ?? null,
    runtime_resolved_value: null,
    status: "runtime-unproved",
    warning: "Resolve the named property for the actual Canvas draw; never use shaderlab_serialized_placeholder as fixed-function state.",
  });
  return {
    official_shaderlab_serialized: state,
    interpretation: {
      dynamic_property_rule: "When property is non-null, value is a serialized ShaderLab placeholder, not the resolved runtime fixed-function value.",
      material_default_rule: "material_serialized_default is pinned evidence from UI_Default_From_RT.mat, but Canvas may override it per draw.",
      runtime_rule: "runtime_resolved_value remains null until the Canvas draw-state setter chain is proved.",
    },
    dynamic_properties: {
      color_mask: dynamic("blend.colorMask", state.blend.colorMask, defaults._ColorMask),
      depth_test: dynamic("depth.test", state.depth.test, undefined),
      stencil_reference: dynamic("stencil.reference", state.stencil.reference, defaults._Stencil),
      stencil_read_mask: dynamic("stencil.readMask", state.stencil.readMask, defaults._StencilReadMask),
      stencil_write_mask: dynamic("stencil.writeMask", state.stencil.writeMask, defaults._StencilWriteMask),
      stencil_compare: dynamic("stencil.compare", state.stencil.compare, defaults._StencilComp),
      stencil_pass: dynamic("stencil.pass", state.stencil.pass, defaults._StencilOp),
    },
  };
}

const DYNAMIC_STATE_BOUNDARIES = [
  {
    id: "dynamic-color-mask-runtime-value",
    status: "unproved",
    claim: "the resolved _ColorMask value for each Canvas draw; ShaderLab value 0 is only a property placeholder and the serialized Material default is 15",
  },
  {
    id: "dynamic-ztest-runtime-value",
    status: "unproved",
    claim: "the resolved unity_GUIZTestMode value for each Canvas draw; no Material serialized default establishes it",
  },
  {
    id: "dynamic-stencil-runtime-values",
    status: "unproved",
    claim: "the resolved _Stencil, _StencilComp, _StencilOp, _StencilReadMask, and _StencilWriteMask values for each Canvas draw; Material defaults may be overridden",
  },
];

try {
  const evidence = readEvidence();
  assertEvidence(evidence);
  const outputs = {};
  const modules = {};
  const reflections = {};
  for (const stage of ["vertex", "fragment"]) {
    const module = evidence.shaderProgram.modules.find((item) => item.stage === stage);
    if (!module) throw new Error(`${stage} module missing`);
    const bytes = Buffer.from(module.spvHex, "hex");
    const [size, spvHash, reflectHash] = PINNED.modules[stage];
    same([bytes.length, sha256(bytes)], [size, spvHash], `${stage} SPIR-V`);
    const file = path.join(tmp, `${stage}.spv`);
    fs.writeFileSync(file, bytes);
    const reflection = JSON.parse(run(SPIRV_CROSS, [file, "--reflect"]));
    same(sha256(JSON.stringify(stable(reflection))), reflectHash, `${stage} reflection`);
    reflections[stage] = reflection;
    outputs[`ui_default_from_rt.${stage === "vertex" ? "vert" : "frag"}.glsl`] = stage === "vertex"
      ? adaptVertex(run(SPIRV_CROSS, [file, "--version", "300", "--es"]))
      : adaptFragment(run(SPIRV_CROSS, [file, "--version", "300", "--es"]));
    modules[stage] = { byte_size: size, spirv_sha256: spvHash, reflection_sha256: reflectHash };
  }
  const vertexUbo = reflections.vertex.ubos.find((x) => x.name === "_18_20");
  const fragmentUbo = reflections.fragment.ubos.find((x) => x.name === "_24_26");
  same([vertexUbo.set, vertexUbo.binding, vertexUbo.block_size], [1, 1, 160], "vertex UBO reflection");
  same([fragmentUbo.set, fragmentUbo.binding, fragmentUbo.block_size], [1, 0, 16], "fragment UBO reflection");
  same(reflections.fragment.outputs.map(({ name, type, location }) => ({ name, type, location })), [{ name: "_59", type: "vec4", location: 0 }, { name: "_61", type: "vec4", location: 1 }], "MRT reflection");

  outputs["ui_default_from_rt_program.json"] = `${JSON.stringify({
    shader: PINNED.shader.name,
    role: "display-from-render-texture",
    generated_by: "build/build-exact-ui-default-from-rt.mjs",
    official_source: {
      apkm_sha256: PINNED.source.apkm[1], material_bundle_sha256: PINNED.material.bundle[1], material_object_sha256: PINNED.material.object[2],
      shader_bundle_sha256: PINNED.shader.bundle[1], shader_object_sha256: PINNED.shader.object[2], compressed_program_sha256: PINNED.program.compressed[1],
      decompressed_program_sha256: PINNED.program.decompressed[1], parameter_entry_sha256: PINNED.program.entries[0][1], program_entry_sha256: PINNED.program.entries[8][1],
    },
    official_variant: { keywords: [], variant_index: 0, parameter_blob_index: 0, program_blob_index: 8, gpu_program_type: 25, shader_requirements: 1 },
    modules,
    bindings: {
      main_texture: { name: "_MainTex", spirv_set: 0, spirv_binding: 0, serialized_binding: 0, dimension: 2, material_texture_pptr: { file_id: 0, path_id: "0" }, scale: [1, 1], offset: [0, 0] },
      texture_sample_add: { name: "_TextureSampleAdd", stage: "fragment", serialized_buffer: "PGlobals3505314924", offset: 0, type: "vec4", spirv_set: 1, spirv_binding: 0 },
      vertex_globals: { serialized_buffer: "VGlobals3505314924", size: 160, spirv_set: 1, spirv_binding: 1, color_offset: 128, main_tex_st_offset: 144 },
      matrices: [{ official: "unity_ObjectToWorld", webgl2: "modelMatrix", offset: 0 }, { official: "unity_MatrixVP", webgl2: "projectionMatrix * viewMatrix", offset: 64 }],
      attributes: [{ name: "position", location: 0 }, { name: "color", location: 1 }, { name: "uv", location: 2 }],
    },
    render_state: dynamicStateContract(evidence),
    blend: evidence.derived.renderBlend,
    fragment_dataflow: evidence.derived.fragmentDataFlow,
    mrt: { primary: { name: "outColor", location: 0 }, secondary: { name: "outAux", location: 1, value: "vec4(0.0)" } },
    webgl2_adaptation: ["remove the SPIRV-Cross #version directive for host-side WebGL2 version injection", "flatten official std140 blocks into named WebGL2 uniforms", "map official matrices and UI vertex attributes without changing shader math", "combine the official image and sampler as _MainTex", "remove the Vulkan clip-space Y flip", "preserve the official UV transform without adding a texture-coordinate flip", "rename stage interface symbols without changing dataflow or MRT"],
    runtime_boundaries: DYNAMIC_STATE_BOUNDARIES,
    unproved: [...evidence.unproved, ...DYNAMIC_STATE_BOUNDARIES],
  }, null, 2)}\n`;

  fs.mkdirSync(OUT, { recursive: true });
  for (const [name, content] of Object.entries(outputs)) {
    const file = path.join(OUT, name);
    if (CHECK) {
      if (!fs.existsSync(file) || fs.readFileSync(file, "utf8") !== content) throw new Error(`${name} does not match pinned generation`);
    } else atomicWriteFileSync(file, content);
  }
  console.log(`${CHECK ? "verified" : "generated"} official UI Default From RT WebGL2 program from Vulkan SPIR-V`);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
