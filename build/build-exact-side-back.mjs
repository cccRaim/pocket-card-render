// Generate the WebGL2 Side&Back program from the official runtime-selected
// INSTANCING_ON Vulkan SPIR-V. The browser draw is single-instance, so the
// official per-instance arrays are folded to element zero during adaptation.
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHADER_ROOT = process.env.PCR_SHADERS
  || "D:/DevProjectes/ptcgp-tools-master/masterdata_decoder/.output/decrypted/Common/Shader";
const PYTHON = process.env.PYTHON || "python";
const SPIRV_CROSS = process.env.SPIRV_CROSS || "spirv-cross";
const OUT = path.join(ROOT, "public", "shaders");
const CHECK = process.argv.includes("--check") || process.env.PCR_EXACT_CHECK === "1";
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pcr-side-back-"));

const PINNED = {
  bundle: "d166568a7f39256e3153042d1a05acc7aa08b20ef9f868bcac763e6917f0a42f",
  shaderObject: "dd79ac5f87982ad08477440bf153e66772ecdbb73050ea8346c626ff151e04a0",
  compressed: "218c446e8a078e8bdaeec7ec260b1c5ae9bd27ec5c8538c26751d44213c8ca3e",
  decompressed: "0c05a7e99e3da09643cc9d2b60a6ac64aeb1fed49ac81c3037ed1df22dc91a74",
  parameterEntry: "7df4095c5213139db3b5aadac000344273adc6ed3198d9cbdb9b808ecafb4748",
  programEntry: "5c7685b880525a404e2306204cc2304d201f13637b52d9d3edb49a589310f1f8",
  vertexSpirv: "5f3de58358234bd969164e05a077b9a557fc4420746acf8a882c43aa24617516",
  fragmentSpirv: "2ca7d6a80832052d1cbd391bbbb8c59d38137a065b21f820762e27ae405b3547",
  materials: [
    {
      name: "L_Card_R_M", bundle: "cd05dfd098a35be800afebc4dbde9204ea223442b6810f4b14846d1d4eee910b",
      object: "b47f3967e18c19505587ef3e8327be430a6496394cd5bffe615d93b635c58dfe",
    },
    {
      name: "L_Card_S_M", bundle: "e4bb216a52e4631a80ff6d56bea8c7a849c258106134ed2af0bdfc84a4db5101",
      object: "6d5c052bf5959067a1e4c634734888ec228ebebd9505a43e10d929f18202b770",
    },
  ],
};

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...options,
  });
}

function same(actual, expected, message) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function moduleFor(evidence, stage) {
  const module = evidence.runtimeModules.find((item) => item.stage === stage);
  if (!module) throw new Error(`official ${stage} module missing`);
  const bytes = Buffer.from(module.spvHex, "hex");
  if (bytes.length !== module.byteSize || sha256(bytes) !== module.sha256) {
    throw new Error(`official ${stage} module bytes do not match evidence`);
  }
  return { module, bytes };
}

function reflection(file) {
  return JSON.parse(run(SPIRV_CROSS, [file, "--reflect"]));
}

function members(data, uboName) {
  const ubo = (data.ubos || []).find((item) => item.name === uboName);
  if (!ubo) throw new Error(`${uboName} reflection missing`);
  return {
    size: ubo.block_size,
    members: (data.types[ubo.type].members || []).map(({ name, type, offset, array }) => ({
      name, type, offset, ...(array ? { array } : {}),
    })),
  };
}

function interfaceRows(data, key) {
  return (data[key] || []).map(({ name, type, location, binding }) => ({
    name, type,
    ...(location != null ? { location } : {}),
    ...(binding != null ? { binding } : {}),
  })).sort((a, b) => (a.location ?? a.binding) - (b.location ?? b.binding));
}

function reflectedUbos(data) {
  return (data.ubos || []).map((ubo) => ({
    name: ubo.name,
    set: ubo.set,
    binding: ubo.binding,
    ...members(data, ubo.name),
  })).sort((a, b) => a.set - b.set || a.binding - b.binding || a.name.localeCompare(b.name));
}

function replaceUbo(source, block, owner, declarations) {
  const pattern = new RegExp(`layout\\(std140\\) uniform ${block}[\\s\\S]*?}\\s*${owner};\\s*`);
  const output = source.replace(pattern, `${declarations.join("\n")}\n\n`);
  if (output === source) throw new Error(`${block} replacement failed`);
  return output;
}

function adaptVertex(source) {
  let output = source
    .replace(/^#version 300 es\s*/m, "precision highp float;\nprecision highp int;\n\n")
    .replace(/#ifdef GL_ARB_shader_draw_parameters[\s\S]*?#endif\s*/g, "")
    .replace(/struct _35\s*\{[\s\S]*?\};\s*/, "")
    .replace(/#ifndef SPIRV_CROSS_CONSTANT_ID_0[\s\S]*?const int _36 = SPIRV_CROSS_CONSTANT_ID_0;\s*/, "");
  output = replaceUbo(output, "_12_14", "_14", []);
  output = replaceUbo(output, "_38_40", "_40", [
    "uniform highp mat4 modelMatrix;",
  ]);
  output = replaceUbo(output, "_78_80", "_80", [
    "uniform highp mat4 viewMatrix;",
    "uniform highp mat4 projectionMatrix;",
  ]);
  output = output
    .replace("layout(location = 0) in vec4 _28;", "layout(location = 0) in vec3 position;")
    .replace("layout(location = 1) in vec2 _117;", "layout(location = 1) in vec2 uv;")
    .replace(/^flat out uint _120;\s*$/m, "")
    .replace(/^int _8;\s*$/m, "")
    .replace(/void main\(\)\s*\{/, `void main()
{
    vec4 _28 = vec4(position, 1.0);
    vec2 _117 = uv;
    mat4 _ObjectToWorld = modelMatrix;
    mat4 _ViewProjection = projectionMatrix * viewMatrix;`)
    .replace(/^\s*_8 = \(gl_InstanceID \+ SPIRV_Cross_BaseInstance\) \+ _14\._m0;\s*$/m, "")
    .replace(/^\s*_8 = _8 << 3;\s*$/m, "")
    .replace(/_40\._m0\[_8 \/ 8\]\._m0/g, "_ObjectToWorld")
    .replace(/_80\._m0/g, "_ViewProjection")
    .replace(/^\s*_120 = uint\(\(gl_InstanceID \+ SPIRV_Cross_BaseInstance\)\);\s*$/m, "")
    .replace(/^\s*gl_Position\.y\s*=\s*-gl_Position\.y;\s*$/m, "");
  if (/_14\.|_40\.|_80\.|_8\b|_120\b|SPIRV_Cross|gl_InstanceID|gl_Position\.y\s*=\s*-gl_Position\.y/.test(output)) {
    throw new Error("Side&Back vertex adaptation incomplete");
  }
  return `${output.trimEnd()}\n`;
}

function adaptFragment(source) {
  let output = source
    .replace(/^#version 300 es\s*/m, "")
    .replace(/struct _11\s*\{[\s\S]*?\};\s*/, "")
    .replace(/#ifndef SPIRV_CROSS_CONSTANT_ID_0[\s\S]*?const int _13 = SPIRV_CROSS_CONSTANT_ID_0;\s*/, "");
  output = replaceUbo(output, "_15_17", "_17", ["uniform mediump vec4 _Blend;"]);
  output = output
    .replace(/_17\._m0\[0\]\._m0/g, "_Blend")
    .replace("uniform mediump sampler2D _44;", "uniform mediump sampler2D _BaseTex;")
    .replace(/\b_44\b/g, "_BaseTex");
  if (/_17\.|\b_44\b|SPIRV_CROSS_CONSTANT_ID/.test(output)) throw new Error("Side&Back fragment adaptation incomplete");
  return `${output.trimEnd()}\n`;
}

try {
  const evidence = JSON.parse(run(PYTHON, [
    "build/extract_official_side_back.py", "--shaders", SHADER_ROOT,
  ], {
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
    shell: process.platform === "win32",
  }));
  same(evidence.shader.name, "Lettuce/Common/CardNew/Face/Side&Back", "official shader name changed");
  same(evidence.source.bundle.sha256, PINNED.bundle, "official bundle hash changed");
  same(evidence.source.shaderObject.sha256, PINNED.shaderObject, "official Shader object hash changed");
  same(evidence.source.shaderSerializedFile, "CAB-e4993e14922158e59579dd588a7a33d2",
    "official Shader serialized file changed");
  same(evidence.programBlock.compressed.sha256, PINNED.compressed, "compressed block hash changed");
  same(evidence.programBlock.decompressed.sha256, PINNED.decompressed, "decompressed block hash changed");
  same(evidence.programBlock.entries[1].sha256, PINNED.parameterEntry, "runtime parameter entry hash changed");
  same(evidence.programBlock.entries[3].sha256, PINNED.programEntry, "runtime program entry hash changed");
  same(evidence.runtimeVariant, {
    stageMetadata: "progVertex", groupIndex: 3, variantIndex: 1,
    keywordIndices: [4], keywords: ["INSTANCING_ON"], parameterBlobIndex: 1, programBlobIndex: 3,
    gpuProgramType: 25, shaderRequirements: 1101803,
  }, "official runtime INSTANCING_ON variant changed");
  same(evidence.officialMaterials.map((item) => ({
    name: item.name,
    bundle: item.bundle.sha256,
    object: item.materialObject.sha256,
    shaderPathId: item.shaderPPtr.pathId,
    shaderExternal: item.shaderExternal.name,
    validKeywords: item.validKeywords,
    cull: item.selectedProperties._CullMode,
    blend: item.selectedProperties._Blend,
    queue: item.customRenderQueue,
  })), PINNED.materials.map((item) => ({
    ...item,
    shaderPathId: "5701574008984223828",
    shaderExternal: "CAB-e4993e14922158e59579dd588a7a33d2",
    validKeywords: [], cull: 2, blend: [0, 0, 0, 0], queue: -1,
  })), "official Side&Back materials changed");

  const vertex = moduleFor(evidence, "vertex");
  const fragment = moduleFor(evidence, "fragment");
  same(vertex.module.sha256, PINNED.vertexSpirv, "official vertex SPIR-V hash changed");
  same(fragment.module.sha256, PINNED.fragmentSpirv, "official fragment SPIR-V hash changed");
  const vertSpv = path.join(tmp, "side_back.vert.spv");
  const fragSpv = path.join(tmp, "side_back.frag.spv");
  fs.writeFileSync(vertSpv, vertex.bytes);
  fs.writeFileSync(fragSpv, fragment.bytes);

  const vertReflection = reflection(vertSpv);
  const fragReflection = reflection(fragSpv);
  const runtimeBindings = {
    authority: "runtime INSTANCING_ON SPIR-V reflection",
    parameter_blob_index: evidence.runtimeBindings.parameterBlobIndex,
    parameter_entry_sha256: evidence.runtimeBindings.parameterEntrySha256,
    vertex: {
      ubos: reflectedUbos(vertReflection),
      inputs: interfaceRows(vertReflection, "inputs"),
      outputs: interfaceRows(vertReflection, "outputs"),
    },
    fragment: {
      ubos: reflectedUbos(fragReflection),
      textures: interfaceRows(fragReflection, "textures"),
      inputs: interfaceRows(fragReflection, "inputs"),
      outputs: interfaceRows(fragReflection, "outputs"),
    },
  };
  same(members(vertReflection, "_12_14"), {
    size: 8, members: [
      { name: "_m0", type: "int", offset: 0 },
      { name: "_m1", type: "int", offset: 4 },
    ],
  }, "official instancing index UBO changed");
  same(members(vertReflection, "_38_40"), {
    size: 256, members: [{ name: "_m0", type: "_35", offset: 0, array: [36] }],
  }, "official per-instance transform UBO changed");
  same(members(vertReflection, "_78_80"), {
    size: 64, members: [{ name: "_m0", type: "vec4", offset: 0, array: [4] }],
  }, "official view-projection UBO changed");
  same(members(fragReflection, "_15_17"), {
    size: 32, members: [{ name: "_m0", type: "_11", offset: 0, array: [13] }],
  }, "official per-instance fragment UBO changed");
  same(interfaceRows(vertReflection, "inputs"), [
    { name: "_28", type: "vec4", location: 0 },
    { name: "_117", type: "vec2", location: 1 },
  ], "official vertex inputs changed");
  same(interfaceRows(vertReflection, "outputs"), [
    { name: "vs_TEXCOORD0", type: "vec2", location: 0 },
    { name: "_120", type: "uint", location: 1 },
  ], "official vertex outputs changed");
  same(interfaceRows(fragReflection, "inputs"), [
    { name: "vs_TEXCOORD0", type: "vec2", location: 0 },
  ], "official fragment inputs changed");
  same(interfaceRows(fragReflection, "outputs"), [
    { name: "_59", type: "vec4", location: 0 },
    { name: "_67", type: "vec4", location: 1 },
  ], "official fragment outputs changed");
  same(interfaceRows(fragReflection, "textures"), [
    { name: "_44", type: "sampler2D", binding: 0 },
  ], "official fragment texture binding changed");

  const outputs = {
    "side_back.vert.glsl": adaptVertex(run(SPIRV_CROSS, [vertSpv, "--version", "300", "--es"])),
    "side_back.frag.glsl": adaptFragment(run(SPIRV_CROSS, [fragSpv, "--version", "300", "--es"])),
    "side_back_program.json": `${JSON.stringify({
      shader: evidence.shader.name,
      generated_by: "build/build-exact-side-back.mjs",
      runtime_contract: {
        schema: "pocket-card-render/stage-source-runtime-contract@1",
        shader_key: "Side&Back",
        stage_source_only: true,
        object_clip_position: "standard-object-to-clip",
      },
      webgl_sources: {
        vertex: "public/shaders/side_back.vert.glsl",
        fragment: "public/shaders/side_back.frag.glsl",
      },
      official_source: {
        bundle_relative_path: evidence.source.bundleRelativePath,
        bundle_sha256: PINNED.bundle,
        shader_object_path_id: evidence.source.shaderObject.pathId,
        shader_object_sha256: PINNED.shaderObject,
        compressed_program_sha256: PINNED.compressed,
        decompressed_program_sha256: PINNED.decompressed,
        parameter_entry_sha256: PINNED.parameterEntry,
        program_entry_sha256: PINNED.programEntry,
      },
      official_variant: {
        keywords: ["INSTANCING_ON"], variant_index: 1, parameter_blob_index: 1, program_blob_index: 3,
        gpu_program_type: 25, shader_requirements: 1101803,
      },
      official_spirv_sha256: {
        vertex: PINNED.vertexSpirv, fragment: PINNED.fragmentSpirv,
      },
      official_materials: evidence.officialMaterials.map((item) => ({
        name: item.name,
        relative_path: item.relativePath,
        bundle_sha256: item.bundle.sha256,
        material_object_path_id: item.materialObject.pathId,
        material_object_sha256: item.materialObject.sha256,
        shader_pptr: item.shaderPPtr,
        shader_external: item.shaderExternal.name,
        valid_keywords: item.validKeywords,
        enable_instancing_variants: item.enableInstancingVariants,
        custom_render_queue: item.customRenderQueue,
        selected_properties: item.selectedProperties,
      })),
      properties: evidence.shader.properties,
      bindings: runtimeBindings,
      baseline_bindings: evidence.baselineBindings,
      runtime_parameter_entry: evidence.runtimeBindings,
      render_state: evidence.shader.pass.renderState,
      tags: evidence.shader.tags,
      vertex_attributes: [
        { semantic: "position", source: "_11", type: "vec4", location: 0 },
        { semantic: "uv", source: "_87", type: "vec2", location: 1 },
      ],
      mrt: { primary: "_59", secondary: "_67", secondary_location: 1, secondary_value: "zero" },
      webgl2_adaptation: [
        "fold official per-instance arrays to element zero because the captured card draws use instanceCount=1",
        "flatten official ObjectToWorld and MatrixVP UBO members into Three.js matrices",
        "combine the official image and sampler as _BaseTex",
        "remove the Vulkan clip-space Y flip",
        "rename vertex attributes and uniforms without changing shader math",
      ],
    }, null, 2)}\n`,
  };

  fs.mkdirSync(OUT, { recursive: true });
  for (const [name, content] of Object.entries(outputs)) {
    const file = path.join(OUT, name);
    if (CHECK) {
      if (!fs.existsSync(file) || fs.readFileSync(file, "utf8") !== content) {
        throw new Error(`${name} does not match pinned official Side&Back generation`);
      }
    } else {
      fs.writeFileSync(file, content);
    }
  }
  console.log(`${CHECK ? "verified" : "generated"} official Side&Back WebGL2 program from Vulkan SPIR-V`);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
