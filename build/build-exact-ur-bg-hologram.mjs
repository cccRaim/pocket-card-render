// Generate Card_Parallax_Hologram_UR_New from the official Unity shader bundle.
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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pcr-ur-bg-hologram-"));

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
  out = replaceUbo(out, "_21_23", "_23", [
    "uniform highp vec3 cameraPosition;", "uniform highp mat4 modelMatrix;",
    "uniform highp mat4 viewMatrix;", "uniform highp mat4 projectionMatrix;",
    "uniform mediump float _FakeCameraHeight;", "uniform mediump float _Height;",
    "uniform mediump float _HeightPower;", "uniform mediump float _Scale;",
    "uniform int _UseUv2;", "uniform mediump float _FakeSpecularMaskScale;",
    "uniform mediump float _FakeSpecularIntensity;", "uniform mediump float _FakeSpecularPower;",
    "uniform mediump float _FakeSpecularCornerPower;", "uniform mediump float _FakeSpecularNotCornerOffset;",
  ]);
  out = out
    .replace("layout(location = 0) in vec4 _11;", "in vec3 position;")
    .replace("layout(location = 1) in vec3 _78;", "in vec3 normal;")
    .replace("layout(location = 4) in mediump vec4 _133;", "in vec4 tangent;")
    .replace("layout(location = 2) in vec2 _320;", "in vec2 uv;")
    .replace("layout(location = 3) in vec2 _356;", "in vec2 uv2;")
    .replace(/void main\(\)\s*\{/, `void main()\n{\n    vec4 _11 = vec4(position, 1.0);\n    vec3 _78 = normal;\n    vec4 _133 = tangent;\n    vec2 _320 = uv;\n    vec2 _356 = uv2;\n    mat4 _ObjectToWorld = modelMatrix;\n    mat4 _WorldToObject = inverse(modelMatrix);\n    mat4 _ViewProjection = projectionMatrix * viewMatrix;`);
  out = replaceMembers(out, "_23", [
    "cameraPosition", "_ObjectToWorld", "_WorldToObject", "_ViewProjection", "_FakeCameraHeight",
    "_Height", "_HeightPower", "_Scale", "_UseUv2", "_FakeSpecularMaskScale",
    "_FakeSpecularIntensity", "_FakeSpecularPower", "_FakeSpecularCornerPower", "_FakeSpecularNotCornerOffset",
  ]);
  out = out.replace(/^\s*gl_Position\.y\s*=\s*-gl_Position\.y;\s*$/m, "");
  if (/_23\._m|gl_Position\.y\s*=\s*-gl_Position\.y/.test(out)) throw new Error("vertex adaptation incomplete");
  return `${out.trimEnd()}\n`;
}

function adaptFragment(source) {
  let out = source.replace(/^#version 300 es\s*/m, "");
  out = replaceUbo(out, "_15_17", "_17", [
    "uniform highp mat4 modelMatrix;", "uniform highp mat4 viewMatrix;",
    "uniform mediump float _DiffractionIntensity;", "uniform mediump float _DiffractionPower;",
    "uniform mediump float _RampRepeat;", "uniform mediump float _RampSpeed;",
    "uniform mediump float _RampOffset;", "uniform mediump float _RampInterval;",
    "uniform mediump vec3 _FakeSpecularColor;", "uniform mediump vec3 _DarknessColor;",
    "uniform mediump float _DarknessOffset;", "uniform mediump vec3 _Rotation;",
  ]);
  out = replaceMembers(out, "_17", [
    "modelMatrix", "viewMatrix", "_DiffractionIntensity", "_DiffractionPower", "_RampRepeat",
    "_RampSpeed", "_RampOffset", "_RampInterval", "_FakeSpecularColor", "_DarknessColor",
    "_DarknessOffset", "_Rotation",
  ]);
  if (/_17\._m/.test(out)) throw new Error("fragment adaptation incomplete");
  return `${out.trimEnd()}\n`;
}

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

const vertExpected = {
  ubo: { name: "_21_23", size: 248, members: [
    member("_m0", "vec3", 0), member("_m1", "vec4", 16, [4]), member("_m2", "vec4", 80, [4]),
    member("_m3", "vec4", 144, [4]), ...Array.from({ length: 4 }, (_, i) => member(`_m${i + 4}`, "float", 208 + i * 4)),
    member("_m8", "int", 224), ...Array.from({ length: 5 }, (_, i) => member(`_m${i + 9}`, "float", 228 + i * 4)),
  ] },
  inputs: [
    { name: "_11", type: "vec4", location: 0 }, { name: "_78", type: "vec3", location: 1 },
    { name: "_320", type: "vec2", location: 2 }, { name: "_356", type: "vec2", location: 3 },
    { name: "_133", type: "vec4", location: 4 },
  ],
  outputs: [
    { name: "vs_TEXCOORD0", type: "vec2", location: 0 }, { name: "vs_TEXCOORD1", type: "vec2", location: 1 },
    { name: "vs_TEXCOORD3", type: "vec3", location: 2 }, { name: "vs_TEXCOORD4", type: "vec4", location: 3 },
  ], textures: [],
};

const fragExpected = {
  ubo: { name: "_15_17", size: 204, members: [
    member("_m0", "vec4", 0, [4]), member("_m1", "vec4", 64, [4]),
    ...Array.from({ length: 6 }, (_, i) => member(`_m${i + 2}`, "float", 128 + i * 4)),
    member("_m8", "vec3", 160), member("_m9", "vec3", 176), member("_m10", "float", 188), member("_m11", "vec3", 192),
  ] },
  inputs: [
    { name: "vs_TEXCOORD0", type: "vec2", location: 0 }, { name: "vs_TEXCOORD1", type: "vec2", location: 1 },
    { name: "vs_TEXCOORD3", type: "vec3", location: 2 }, { name: "vs_TEXCOORD4", type: "vec4", location: 3 },
  ],
  outputs: [{ name: "_695", type: "vec4", location: 0 }, { name: "_701", type: "vec4", location: 1 }],
  textures: ["_257", "_321", "_335", "_396", "_411", "_614"].map((name, binding) => ({ name, type: "sampler2D", binding })),
};

try {
  const dump = run(PYTHON, [
    "build/shaderdec/dump_shader.py", "Card_Parallax_Hologram_UR_New", "ur_bg_hologram",
    "--shaders", SHADER_ROOT, "--out", tmp,
  ], { shell: process.platform === "win32" });
  if (!/modules 2 \| vertex 1 \| fragment 1/.test(dump)) throw new Error(`unexpected official module set:\n${dump}`);
  const vertSpv = path.join(tmp, "ur_bg_hologram_vert.spv");
  const fragSpv = path.join(tmp, "ur_bg_hologram_frag.spv");
  reflect(vertSpv, vertExpected);
  reflect(fragSpv, fragExpected);

  const metadata = JSON.parse(run(PYTHON, ["build/extract-shader-defaults.py"], {
    shell: process.platform === "win32",
    input: JSON.stringify({ root: SHADER_ROOT, shaders: ["Card_Parallax_Hologram_UR_New"] }),
    stdio: ["pipe", "pipe", "pipe"],
  })).found.Card_Parallax_Hologram_UR_New;
  const binding = metadata.programBindings?.[0];
  const samplerSlots = ["_PhaseTex", "_PhaseMaskTex", "_RampMaskTex", "_RampTex", "_HologramMaskTex", "_FakeSpecularMask"];
  equal(binding?.textures?.map(({ name, binding }) => ({ name, binding })), samplerSlots.map((name, binding) => ({ name, binding })), "compiled sampler bindings changed");
  const buffers = Object.fromEntries((binding?.constantBuffers || []).map((item) => [item.name[0], item]));
  equal(buffers.V?.size, 248, "compiled vertex UBO size changed");
  equal(buffers.P?.size, 204, "compiled fragment UBO size changed");

  const outputs = {
    "ur_bg_hologram.vert.glsl": adaptVertex(run(SPIRV_CROSS, [vertSpv, "--version", "300", "--es"])),
    "ur_bg_hologram.frag.glsl": adaptFragment(run(SPIRV_CROSS, [fragSpv, "--version", "300", "--es"])),
    "ur_bg_hologram_uniforms.json": `${JSON.stringify({
      shader: "Card_Parallax_Hologram_UR_New",
      generated_by: "build/build-exact-ur-bg-hologram.mjs",
      official_spirv_sha256: { vertex: sha256(vertSpv), fragment: sha256(fragSpv) },
      samplers: fragExpected.textures.map((item) => item.name), sampler_slots: samplerSlots,
      compiled_texture_bindings: Object.fromEntries(samplerSlots.map((name, binding) => [name, binding])),
      implicit_defaults: metadata.textures,
      mrt: { primary: "_695", secondary: "_701", secondary_value: "zero" },
    }, null, 2)}\n`,
  };
  fs.mkdirSync(OUT, { recursive: true });
  for (const [name, content] of Object.entries(outputs)) {
    const file = path.join(OUT, name);
    if (CHECK) {
      if (!fs.existsSync(file) || fs.readFileSync(file, "utf8") !== content) throw new Error(`${name} does not match official regeneration`);
    } else fs.writeFileSync(file, content);
  }
  console.log(`${CHECK ? "verified" : "generated"} Card_Parallax_Hologram_UR_New from official SPIR-V and compiled bindings`);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
