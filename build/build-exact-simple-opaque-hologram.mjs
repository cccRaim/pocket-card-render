// Generate the empty-keyword Simple-Opaque-Hologram_Tuning program from the official Unity shader bundle.
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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pcr-simple-opaque-hologram-"));

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...options,
  });
}

function equal(actual, expected, message) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function member(name, type, offset, array = undefined) {
  return { name, type, offset, ...(array ? { array } : {}) };
}

function reflect(file, expected) {
  const data = JSON.parse(run(SPIRV_CROSS, [file, "--reflect"]));
  const ubo = (data.ubos || []).find((item) => item.name === expected.ubo.name);
  if (!ubo || ubo.block_size !== expected.ubo.size) throw new Error(`${expected.ubo.name} UBO changed`);
  equal((data.types[ubo.type].members || []).map(({ name, type, offset, array }) => ({
    name, type, offset, ...(array ? { array } : {}),
  })), expected.ubo.members, `${expected.ubo.name} members changed`);
  for (const key of ["inputs", "outputs", "textures"]) {
    equal((data[key] || []).map(({ name, type, location, binding }) => ({
      name, type, ...(location != null ? { location } : {}), ...(binding != null ? { binding } : {}),
    })).sort((a, b) => (a.location ?? a.binding) - (b.location ?? b.binding)), expected[key] || [], `${key} changed`);
  }
}

function replaceUbo(source, block, owner, declarations) {
  const re = new RegExp(`layout\\(std140\\) uniform ${block}[\\s\\S]*?}\\s*${owner};\\s*`);
  const result = source.replace(re, `${declarations.join("\n")}\n\n`);
  if (result === source) throw new Error(`${block} replacement failed`);
  return result;
}

function replaceMembers(source, owner, mapping) {
  return source.replace(new RegExp(`${owner}\\._m(\\d+)`, "g"), (match, raw) => {
    const value = mapping[Number(raw)];
    if (value == null) throw new Error(`unmapped ${match}`);
    return value;
  });
}

function adaptVertex(source) {
  let out = source.replace(/^#version 300 es\s*/m, "precision highp float;\nprecision highp int;\n\n");
  out = replaceUbo(out, "_19_21", "_21", [
    "uniform highp mat4 modelMatrix;",
    "uniform highp mat4 viewMatrix;",
    "uniform highp mat4 projectionMatrix;",
  ]);
  out = out
    .replace("layout(location = 0) in vec4 _11;", "in vec3 position;")
    .replace("layout(location = 1) in vec3 _95;", "in vec3 normal;")
    .replace("layout(location = 2) in vec2 _88;", "in vec2 uv;")
    .replace("layout(location = 3) in vec2 _91;", "in vec2 uv2;")
    .replace(/void main\(\)\s*\{/, `void main()
{
    vec4 _11 = vec4(position, 1.0);
    vec3 _95 = normal;
    vec2 _88 = uv;
    vec2 _91 = uv2;
    mat4 _ObjectToWorld = modelMatrix;
    mat4 _WorldToObject = inverse(modelMatrix);
    mat4 _ViewProjection = projectionMatrix * viewMatrix;`);
  out = replaceMembers(out, "_21", ["_ObjectToWorld", "_WorldToObject", "_ViewProjection"]);
  out = out.replace(/^\s*gl_Position\.y\s*=\s*-gl_Position\.y;\s*$/m, "");
  if (/_21\._m|gl_Position\.y\s*=\s*-gl_Position\.y/.test(out)) throw new Error("vertex adaptation incomplete");
  return `${out.trimEnd()}\n`;
}

function adaptFragment(source) {
  let out = source.replace(/^#version 300 es\s*/m, "");
  out = replaceUbo(out, "_35_37", "_37", [
    "uniform highp mat4 viewMatrix;",
    "uniform mediump float _DiffractionIntensity;",
    "uniform mediump float _DiffractionPower;",
    "uniform mediump float _RampRepeat;",
    "uniform mediump float _RampSpeed;",
    "uniform mediump float _RampOffset;",
    "uniform mediump float _RampInterval;",
    "uniform int _TiltEnabled;",
    "uniform mediump float _TiltPower;",
    "uniform mediump float _TiltOffset;",
    "uniform mediump float _TiltIntensity;",
    "uniform mediump vec3 _Rotation;",
  ]);
  out = replaceMembers(out, "_37", [
    "viewMatrix", "_DiffractionIntensity", "_DiffractionPower", "_RampRepeat", "_RampSpeed",
    "_RampOffset", "_RampInterval", "_TiltEnabled", "_TiltPower", "_TiltOffset",
    "_TiltIntensity", "_Rotation",
  ]);
  if (/_37\._m/.test(out)) throw new Error("fragment adaptation incomplete");
  return `${out.trimEnd()}\n`;
}

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function fields(buffer) {
  return [...(buffer?.fields || [])]
    .sort((a, b) => a.offset - b.offset)
    .map(({ name, offset }) => ({ name, offset }));
}

const vertexExpected = {
  ubo: { name: "_19_21", size: 192, members: [
    member("_m0", "vec4", 0, [4]), member("_m1", "vec4", 64, [4]), member("_m2", "vec4", 128, [4]),
  ] },
  inputs: [
    { name: "_11", type: "vec4", location: 0 }, { name: "_95", type: "vec3", location: 1 },
    { name: "_88", type: "vec2", location: 2 }, { name: "_91", type: "vec2", location: 3 },
  ],
  outputs: [
    { name: "vs_TEXCOORD0", type: "vec2", location: 0 },
    { name: "vs_TEXCOORD1", type: "vec2", location: 1 },
    { name: "vs_TEXCOORD2", type: "vec3", location: 2 },
  ], textures: [],
};

const fragmentExpected = {
  ubo: { name: "_35_37", size: 124, members: [
    member("_m0", "vec4", 0, [4]),
    ...Array.from({ length: 6 }, (_, i) => member(`_m${i + 1}`, "float", 64 + i * 4)),
    member("_m7", "int", 88),
    ...Array.from({ length: 3 }, (_, i) => member(`_m${i + 8}`, "float", 92 + i * 4)),
    member("_m11", "vec3", 112),
  ] },
  inputs: [
    { name: "vs_TEXCOORD0", type: "vec2", location: 0 },
    { name: "vs_TEXCOORD1", type: "vec2", location: 1 },
    { name: "vs_TEXCOORD2", type: "vec3", location: 2 },
  ],
  outputs: [{ name: "_503", type: "vec4", location: 0 }, { name: "_511", type: "vec4", location: 1 }],
  textures: ["_491", "_484", "_343", "_409", "_465"].map((name, binding) => ({ name, type: "sampler2D", binding })),
};

try {
  const dump = run(PYTHON, [
    "build/shaderdec/dump_shader.py", "Simple-Opaque-Hologram_Tuning", "simple_opaque_hologram_tuning",
    "--no-keywords", "--shaders", SHADER_ROOT, "--out", tmp,
  ], { shell: process.platform === "win32" });
  if (!/variant: <none> \(index 0, 2 module slots\)/.test(dump)
      || !/modules 4 \| vertex 1 \| fragment 1/.test(dump)) {
    throw new Error(`unexpected official empty-keyword module set:\n${dump}`);
  }
  const vertSpv = path.join(tmp, "simple_opaque_hologram_tuning_vert.spv");
  const fragSpv = path.join(tmp, "simple_opaque_hologram_tuning_frag.spv");
  reflect(vertSpv, vertexExpected);
  reflect(fragSpv, fragmentExpected);

  const bindings = JSON.parse(run(PYTHON, [
    "build/shaderdec/extract_variant_bindings.py", "Simple-Opaque-Hologram_Tuning", "--no-keywords",
    "--shaders", SHADER_ROOT,
  ], { shell: process.platform === "win32" }));
  equal(bindings.selectedKeywords, [], "selected keywords changed");
  equal({ variantIndex: bindings.variantIndex, parameterBlobIndex: bindings.parameterBlobIndex, programBlobIndex: bindings.programBlobIndex },
    { variantIndex: 0, parameterBlobIndex: 0, programBlobIndex: 2 }, "official variant indices changed");
  const samplerSlots = ["_MainTex", "_HologramMaskTex", "_PhaseTex", "_RampMaskTex", "_RampTex"];
  equal(bindings.textures.map(({ name, binding }) => ({ name, binding })),
    samplerSlots.map((name, binding) => ({ name, binding })), "compiled sampler bindings changed");
  const pglobals = bindings.constantBuffers.find((item) => item.name.startsWith("PGlobals"));
  const vglobals = bindings.constantBuffers.find((item) => item.name.startsWith("VGlobals"));
  equal({ p: pglobals?.size, v: vglobals?.size }, { p: 124, v: 192 }, "compiled UBO sizes changed");
  equal(fields(vglobals), [
    { name: "unity_ObjectToWorld", offset: 0 }, { name: "unity_WorldToObject", offset: 64 },
    { name: "unity_MatrixVP", offset: 128 },
  ], "compiled vertex fields changed");
  equal(fields(pglobals), [
    { name: "unity_MatrixV", offset: 0 }, { name: "_DiffractionIntensity", offset: 64 },
    { name: "_DiffractionPower", offset: 68 }, { name: "_RampRepeat", offset: 72 },
    { name: "_RampSpeed", offset: 76 }, { name: "_RampOffset", offset: 80 },
    { name: "_RampInterval", offset: 84 }, { name: "_TiltEnabled", offset: 88 },
    { name: "_TiltPower", offset: 92 }, { name: "_TiltOffset", offset: 96 },
    { name: "_TiltIntensity", offset: 100 }, { name: "_Rotation", offset: 112 },
  ], "compiled fragment fields changed");

  const metadata = JSON.parse(run(PYTHON, ["build/extract-shader-defaults.py"], {
    shell: process.platform === "win32",
    input: JSON.stringify({ root: SHADER_ROOT, shaders: ["Simple-Opaque-Hologram_Tuning"] }),
    stdio: ["pipe", "pipe", "pipe"],
  })).found["Simple-Opaque-Hologram_Tuning"];
  const outputs = {
    "simple_opaque_hologram_tuning.vert.glsl": adaptVertex(run(SPIRV_CROSS, [vertSpv, "--version", "300", "--es"])),
    "simple_opaque_hologram_tuning.frag.glsl": adaptFragment(run(SPIRV_CROSS, [fragSpv, "--version", "300", "--es"])),
    "simple_opaque_hologram_tuning_uniforms.json": `${JSON.stringify({
      shader: "Simple-Opaque-Hologram_Tuning",
      generated_by: "build/build-exact-simple-opaque-hologram.mjs",
      selector: { keywords: [], variant_index: 0, parameter_blob_index: 0, program_blob_index: 2 },
      official_spirv_sha256: { vertex: sha256(vertSpv), fragment: sha256(fragSpv) },
      samplers: fragmentExpected.textures.map((item) => item.name), sampler_slots: samplerSlots,
      compiled_texture_bindings: Object.fromEntries(samplerSlots.map((name, binding) => [name, binding])),
      implicit_defaults: metadata.textures,
      mrt: { primary: "_503", secondary: "_511", secondary_value: "zero" },
    }, null, 2)}\n`,
  };
  fs.mkdirSync(OUT, { recursive: true });
  for (const [name, content] of Object.entries(outputs)) {
    const file = path.join(OUT, name);
    if (CHECK) {
      if (!fs.existsSync(file) || fs.readFileSync(file, "utf8") !== content) {
        throw new Error(`${name} does not match official regeneration`);
      }
    } else fs.writeFileSync(file, content);
  }
  console.log(`${CHECK ? "verified" : "generated"} Simple-Opaque-Hologram_Tuning empty-keyword program from official SPIR-V and parameter bindings`);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
