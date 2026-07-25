// Generate the WebGL2 UI Default To RT producer from pinned official Vulkan SPIR-V.
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "public", "shaders");
const PYTHON = process.env.PYTHON || "python";
const SPIRV_CROSS = process.env.SPIRV_CROSS || "spirv-cross";
const CHECK = process.argv.includes("--check") || process.env.PCR_EXACT_CHECK === "1";
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pcr-ui-default-to-rt-"));

const PINNED = {
  prefab: {
    bundle: [4811, "c5f994db1c7fbce505d67d6affd8c638b8701243921438d3b5d3401b4577e613"],
    serializedFile: "CAB-15f2305a747f78e1d2cde8ee8bcf2acf",
    images: [
      ["-5386704478690261615", 136, "8bb65619f11cdb8b216e069a26fc6b79be3dc87a7d6e887fd6ba196d00ffda62", "Outline"],
      ["-2805931688482683503", 136, "14783a67d674df9cb1188dad0bc35ca052a6cd21fc77103bf26a405e04665433", "icn_gra_img"],
    ],
  },
  material: {
    bundle: [2409, "f478326a8e58d1c1539ca181c93fab4302c7e37109fb30a012d4a7b7fe3fca54"],
    object: ["-5098138999901745883", 328, "11cd5b30fc3e464b84bedda43e297576dfd5c36732fc8aa85ba33597c95f3db6"],
    serializedFile: "CAB-b03ac178e097f0b5b749149090b41913",
  },
  shader: {
    name: "Lettuce/Common/CardNew/UI/Default(to RT)",
    bundle: [20847, "bfa614efb73e8a31da55f1fa71781b50108979dc19dd40d105f3e19a9da24198"],
    object: ["5313265162950190389", 10152, "186554d5da124466d167a320be7ee170a087bcbc9b74c0be8ee3c8315995b4b6"],
    serializedFile: "CAB-475bda97c86c2e19de716358682956e4",
  },
  program: {
    compressed: [3607, "2258f3c0a1dae1e10ca126ff269ca89c56363c68103d6c45a1f6a1fd98cdf27a"],
    decompressed: [22028, "e97366c85713a41d9ff96791e3515682fc68fe943ba8ff35761122945185c5a1"],
    entries: [
      [388,"50c6c2d071e0c99c3f9644d1be6a8948c706783ac0ef5586fe11414369a9bb63"],[388,"9a8554f9a1c01b7b6954c9b1e271b922a8996df367034f204d73241db07acb04"],
      [428,"7525a060a6356463731013be9202489fd9f6b3a971a88a98a945180769d04064"],[428,"52d03474e143a60c3a5ae59ef4f3e8a38dfe87aac69970d6f6b5c4b742556095"],
      [1472,"49e9d4abf17db9f717c64716c155f6cf0e0be3deb093fd7b936e68eca813aed8"],[1648,"4f28e537960c4027eb0b824b0e0f8783650def8f90899e67170d6bb7232ad8bf"],
      [1948,"32a6881ce1208ae0a9eba58739cbd669e5d030b16e70a059d83936f5b895c45c"],[2116,"a584216898c124123e338e6714625b581c2c2616368b437cbb21d111154d7363"],
      [192,"170d2878071c93e273d7e962bc9cef8abfa5c2d73b5620e83ff8cfb999a9c8b3"],[304,"532c40c6acf5f2f2416b4f51170c5b52b4e6bc5ff13608fa8013fb36b41d0a35"],
      [1328,"7492326995c831941a04da98099399b7decc4d45f07d68e4fb76c9fce3041ac8"],[1344,"02a00e53ee1009b1b1feb73c5519e1028ff500a0e0dbcd3f265699bce0e99973"],
      [1352,"7ab6b187aac7f7717b73bb74a3ca0dae7321bcb1811b976afd0c533bd666e972"],[1368,"fd329d024cbfc5c1f70322472eddbf140d3125482ecd89274d532e8705f87cfe"],
      [1756,"8c681700ad436aaa2444cd96c1214fa93c94f71a098499cb4d884fb998bda654"],[1772,"006a0f7223aabfbcb6fe2af1cb175091c689eca4494f0d25176e4501e4104d5c"],
      [1780,"2d932f2c9dd23cd6a9a422282cd7b78b1f1dbac457e53e727e909e310630bb1d"],[1796,"8e7f6291627496a705447426fe19e59c9e42bcb37337207fbd6b00254ddd1aa0"],
    ],
  },
  modules: {
    vertex: [2916, "f7f9575dc16cbe21765696d9eae09674e5092db11161f7230450462f9df348c1", "bcea6eff397181895a867ac88ab99cd8ce285a6a16f791abccbcce12175c8162"],
    fragment: [1320, "d57a4eb4230bbe11be4ec5fcd9f764889b7fa8506fedc185f46b3d324e97bf32", "8bd2d822fd779b34de023cd31c5264dc0b1dab86ee68c09509e4300d29bb08b7"],
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
  out = replaceUbo(out, "_22_24", "_24", ["uniform highp vec4 _TextureSampleAdd;"]);
  out = replaceOnce(out, "uniform mediump sampler2D _13;", "uniform mediump sampler2D _MainTex;", "main sampler");
  out = replaceOnce(out, "in highp vec2 vs_TEXCOORD0;", "in highp vec2 vUv;", "UV varying");
  out = replaceOnce(out, "in vec4 _35;", "in mediump vec4 vColor;", "color varying");
  out = replaceOnce(out, "layout(location = 0) out highp vec4 _32;", "layout(location = 0) out highp vec4 outColor;", "primary output");
  out = replaceOnce(out, "layout(location = 1) out highp vec4 _38;", "layout(location = 1) out highp vec4 outAux;", "secondary output");
  out = out.replace(/_24\._m0/g, "_TextureSampleAdd").replace(/\b_13\b/g, "_MainTex")
    .replace(/\bvs_TEXCOORD0\b/g, "vUv").replace(/\b_35\b/g, "vColor").replace(/\b_32\b/g, "outColor").replace(/\b_38\b/g, "outAux");
  if (!out.includes("_9 = texture(_MainTex, vUv);") || !out.includes("_20 = _9 + _TextureSampleAdd;") || !out.includes("outColor = _20 * vColor;") || !out.includes("outAux = vec4(0.0);")) throw new Error("official producer fragment dataflow was not preserved");
  if (/layout\(std140\)|_24\._m|vs_TEXCOORD0|\b_13\b/.test(out)) throw new Error("fragment adaptation incomplete");
  return `${out.trim()}\n`;
}

function readEvidence() {
  const args = ["build/extract_official-ui-default-to-rt.py"];
  if (process.env.PCR_DECRYPTED_ROOT) args.push("--decrypted-root", process.env.PCR_DECRYPTED_ROOT);
  return JSON.parse(run(PYTHON, args, { env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" }, shell: process.platform === "win32", maxBuffer: 4 * 1024 * 1024 }).replace(/^\uFEFF/, ""));
}

function assertEvidence(e) {
  same([e.uiImageUsage.bundle.byteSize, e.uiImageUsage.bundle.sha256], PINNED.prefab.bundle, "prefab bundle");
  same(e.uiImageUsage.serializedFile, PINNED.prefab.serializedFile, "prefab serialized file");
  same(e.uiImageUsage.images.map((image) => [image.object.pathId, image.object.byteSize, image.object.sha256, image.gameObjectName]), PINNED.prefab.images, "official UI Image objects");
  same([e.material.bundle.byteSize, e.material.bundle.sha256], PINNED.material.bundle, "material bundle");
  same([e.material.materialObject.pathId, e.material.materialObject.byteSize, e.material.materialObject.sha256], PINNED.material.object, "material object");
  same([e.material.name, e.material.serializedFile], ["UI-Default-ToRT", PINNED.material.serializedFile], "material identity");
  same(e.material.shaderPPtr, { fileId: 1, pathId: PINNED.shader.object[0] }, "material Shader PPtr");
  for (const image of e.uiImageUsage.images) {
    same(image.materialPPtr, { fileId: 2, pathId: PINNED.material.object[0] }, `${image.gameObjectName} Material PPtr`);
    same(image.materialExternal.name, PINNED.material.serializedFile, `${image.gameObjectName} Material external`);
  }
  same(e.material.savedProperties.textures._MainTex, { fileId: 0, pathId: "0", scale: [1, 1], offset: [0, 0] }, "material MainTex");
  const p = e.shaderProgram;
  same([p.source.bundle.byteSize, p.source.bundle.sha256], PINNED.shader.bundle, "shader bundle");
  same([p.source.shaderObject.pathId, p.source.shaderObject.byteSize, p.source.shaderObject.sha256], PINNED.shader.object, "shader object");
  same([p.shader.name, p.source.serializedFile], [PINNED.shader.name, PINNED.shader.serializedFile], "shader identity");
  same(p.shader.passes.map((pass) => [pass.subshaderIndex, pass.passIndex, pass.name, pass.compiledVariants.length]), [[0, 0, "Default", 4], [1, 0, "Alpha", 8]], "official pass catalog");
  same(Object.fromEntries(Object.entries(p.selectedProgramTarget).filter(([key]) => !["status", "reason"].includes(key))), { subshaderIndex: 0, passIndex: 0, stageMetadata: "progVertex", groupIndex: 3, variantIndex: 0, keywordIndices: [], keywords: [], parameterBlobIndex: 0, programBlobIndex: 4, gpuProgramType: 25, shaderRequirements: 1 }, "official port target");
  same(p.selectedProgramTarget.status, "static-candidate-not-runtime-selection", "port target evidence status");
  same([p.programBlock.compressed.byteSize, p.programBlock.compressed.sha256], PINNED.program.compressed, "compressed program");
  same([p.programBlock.decompressed.byteSize, p.programBlock.decompressed.sha256], PINNED.program.decompressed, "decompressed program");
  same(p.programBlock.entries.map(({ length, sha256: hash }) => [length, hash]), PINNED.program.entries, "program entries");
  same(p.bindings.commonTextures, [{ name: "_MainTex", binding: 0, encodedIndex: 134217728, samplerIndex: -1, dimension: 2, multisampled: false, source: "common" }], "texture binding");
  same(e.derived.fragmentDataFlow, { tint: "vertexColor * _Color", uv: "uv0 * _MainTex_ST.xy + _MainTex_ST.zw", primary: "(texture(_MainTex, uv) + _TextureSampleAdd) * tint", mrt1: "vec4(0.0)" }, "fragment dataflow");
  same(e.derived.defaultPassBlend, { source: "SrcAlpha", destination: "OneMinusSrcAlpha", sourceValue: 5, destinationValue: 10, serializedSeparateBlend: false }, "Default pass blend contract");
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
  const state = evidence.shaderProgram.shader.passes[0].renderState;
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
      material_default_rule: "material_serialized_default is pinned evidence from UI-Default-ToRT.mat, but Canvas may override it per draw.",
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
    outputs[`ui_default_to_rt.${stage === "vertex" ? "vert" : "frag"}.glsl`] = stage === "vertex"
      ? adaptVertex(run(SPIRV_CROSS, [file, "--version", "300", "--es"]))
      : adaptFragment(run(SPIRV_CROSS, [file, "--version", "300", "--es"]));
    modules[stage] = { byte_size: size, spirv_sha256: spvHash, reflection_sha256: reflectHash };
  }
  const vertexUbo = reflections.vertex.ubos.find((x) => x.name === "_18_20");
  const fragmentUbo = reflections.fragment.ubos.find((x) => x.name === "_22_24");
  same([vertexUbo.set, vertexUbo.binding, vertexUbo.block_size], [1, 1, 160], "vertex UBO reflection");
  same([fragmentUbo.set, fragmentUbo.binding, fragmentUbo.block_size], [1, 0, 16], "fragment UBO reflection");
  same(reflections.fragment.outputs.map(({ name, type, location }) => ({ name, type, location })), [{ name: "_32", type: "vec4", location: 0 }, { name: "_38", type: "vec4", location: 1 }], "MRT reflection");

  outputs["ui_default_to_rt_program.json"] = `${JSON.stringify({
    shader: PINNED.shader.name,
    role: "producer-to-render-texture",
    generated_by: "build/build-exact-ui-default-to-rt.mjs",
    official_source: {
      prefab_bundle_sha256: PINNED.prefab.bundle[1], ui_image_object_sha256: PINNED.prefab.images.map((image) => image[2]),
      material_bundle_sha256: PINNED.material.bundle[1], material_object_sha256: PINNED.material.object[2],
      shader_bundle_sha256: PINNED.shader.bundle[1], shader_object_sha256: PINNED.shader.object[2], compressed_program_sha256: PINNED.program.compressed[1],
      decompressed_program_sha256: PINNED.program.decompressed[1], parameter_entry_sha256: PINNED.program.entries[0][1], program_entry_sha256: PINNED.program.entries[4][1],
    },
    official_image_material_pptr: { file_id: 2, path_id: PINNED.material.object[0], external_cab: PINNED.material.serializedFile },
    official_material_shader_pptr: { file_id: 1, path_id: PINNED.shader.object[0], external_cab: PINNED.shader.serializedFile },
    pass_catalog: evidence.shaderProgram.shader.passes,
    port_target: evidence.shaderProgram.selectedProgramTarget,
    modules,
    bindings: {
      main_texture: { name: "_MainTex", spirv_set: 0, spirv_binding: 0, serialized_binding: 0, dimension: 2, material_texture_pptr: { file_id: 0, path_id: "0" }, scale: [1, 1], offset: [0, 0] },
      texture_sample_add: { name: "_TextureSampleAdd", stage: "fragment", serialized_buffer: "PGlobals4044006825", offset: 0, type: "vec4", spirv_set: 1, spirv_binding: 0 },
      vertex_globals: { serialized_buffer: "VGlobals4044006825", size: 160, spirv_set: 1, spirv_binding: 1, color_offset: 128, main_tex_st_offset: 144 },
      matrices: [{ official: "unity_ObjectToWorld", webgl2: "modelMatrix", offset: 0 }, { official: "unity_MatrixVP", webgl2: "projectionMatrix * viewMatrix", offset: 64 }],
      attributes: [{ name: "position", location: 0 }, { name: "color", location: 1 }, { name: "uv", location: 2 }],
    },
    render_state: dynamicStateContract(evidence),
    blend: evidence.derived.defaultPassBlend,
    fragment_dataflow: evidence.derived.fragmentDataFlow,
    mrt: { primary: { name: "outColor", location: 0 }, secondary: { name: "outAux", location: 1, value: "vec4(0.0)" } },
    webgl2_adaptation: ["remove the SPIRV-Cross #version directive for host-side WebGL2 version injection", "flatten official std140 blocks into named WebGL2 uniforms", "map official matrices and UI vertex attributes without changing shader math", "combine the official image and sampler as _MainTex", "remove the Vulkan clip-space Y flip", "preserve the official UV transform without adding a texture-coordinate flip", "rename stage interface symbols without changing dataflow or MRT"],
    runtime_boundaries: evidence.runtimeBoundaries,
    unproved: evidence.runtimeBoundaries,
  }, null, 2)}\n`;

  fs.mkdirSync(OUT, { recursive: true });
  for (const [name, content] of Object.entries(outputs)) {
    const file = path.join(OUT, name);
    if (CHECK) {
      if (!fs.existsSync(file) || fs.readFileSync(file, "utf8") !== content) throw new Error(`${name} does not match pinned generation`);
    } else fs.writeFileSync(file, content);
  }
  console.log(`${CHECK ? "verified" : "generated"} official UI Default To RT WebGL2 producer from Vulkan SPIR-V`);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
