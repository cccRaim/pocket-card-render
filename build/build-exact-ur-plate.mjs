// Generate Card_UR_Plate from the official Unity shader bundle.
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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pcr-ur-plate-"));

function run(command, args, options = {}) {
  return execFileSync(command, args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...options });
}

function equal(actual, expected, message) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function member(name, type, offset, array = undefined) {
  return { name, type, offset, ...(array ? { array } : {}) };
}

function assertReflection(file, expected) {
  const data = JSON.parse(run(SPIRV_CROSS, [file, "--reflect"]));
  const ubo = (data.ubos || []).find((item) => item.name === expected.ubo.name);
  if (!ubo || ubo.block_size !== expected.ubo.size) throw new Error(`${expected.ubo.name} UBO changed`);
  equal((data.types[ubo.type].members || []).map(({ name, type, offset, array }) => ({ name, type, offset, ...(array ? { array } : {}) })), expected.ubo.members, `${expected.ubo.name} members changed`);
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
    "uniform highp vec3 cameraPosition;", "uniform highp mat4 modelMatrix;", "uniform highp mat4 viewMatrix;",
    "uniform highp mat4 projectionMatrix;", "uniform mediump float _FakeCameraHeight;",
    "uniform mediump float _Height;", "uniform mediump float _HeightPower;", "uniform mediump float _Scale;",
    "uniform int _UseUv2;", "uniform mediump float _FakeSpecularMaskScale;",
    "uniform mediump float _FakeSpecularIntensity;", "uniform mediump float _FakeSpecularPower;",
    "uniform mediump float _FakeSpecularCornerPower;", "uniform mediump float _FakeSpecularNotCornerOffset;",
  ]);
  out = out
    .replace("layout(location = 0) in vec4 _11;", "in vec3 position;")
    .replace("layout(location = 1) in vec3 _79;", "in vec3 normal;")
    .replace("layout(location = 4) in mediump vec4 _131;", "in vec4 tangent;")
    .replace("layout(location = 2) in vec2 _295;", "in vec2 uv;")
    .replace("layout(location = 3) in vec2 _329;", "in vec2 uv2;")
    .replace(/void main\(\)\s*\{/, `void main()\n{\n    vec4 _11 = vec4(position, 1.0);\n    vec3 _79 = normal;\n    vec4 _131 = tangent;\n    vec2 _295 = uv;\n    vec2 _329 = uv2;\n    mat4 _ObjectToWorld = modelMatrix;\n    mat4 _WorldToObject = inverse(modelMatrix);\n    mat4 _ViewProjection = projectionMatrix * viewMatrix;`);
  out = replaceMembers(out, "_23", [
    "cameraPosition", "_ObjectToWorld", "_WorldToObject", "_ViewProjection", "_FakeCameraHeight", "_Height",
    "_HeightPower", "_Scale", "_UseUv2", "_FakeSpecularMaskScale", "_FakeSpecularIntensity",
    "_FakeSpecularPower", "_FakeSpecularCornerPower", "_FakeSpecularNotCornerOffset",
  ]);
  out = out.replace(/^\s*gl_Position\.y\s*=\s*-gl_Position\.y;\s*$/m, "");
  if (/_23\._m|gl_Position\.y\s*=\s*-gl_Position\.y/.test(out)) throw new Error("vertex adaptation incomplete");
  return `${out.trimEnd()}\n`;
}

function adaptFragment(source) {
  let out = source.replace(/^#version 300 es\s*/m, "");
  out = replaceUbo(out, "_15_17", "_17", [
    "uniform highp vec3 cameraPosition;", "uniform highp mat4 modelMatrix;", "uniform highp mat4 viewMatrix;",
    "uniform mediump float _Shininess;", "uniform mediump float _BaseColorIntensity;",
    "uniform mediump float _SpecularIntensity;", "uniform mediump float _DiffractionIntensity;",
    "uniform mediump float _DiffractionPower;", "uniform mediump float _RampRepeat;",
    "uniform mediump float _RampSpeed;", "uniform mediump float _RampOffset;",
    "uniform mediump float _RampInterval;", "uniform mediump float _RemoveMetalic;",
    "uniform mediump vec3 _FakeSpecularColor;", "uniform mediump vec3 _DarknessColor;",
    "uniform mediump float _DarknessOffset;",
  ]);
  out = replaceMembers(out, "_17", [
    "cameraPosition", "modelMatrix", "viewMatrix", "_Shininess", "_BaseColorIntensity", "_SpecularIntensity",
    "_DiffractionIntensity", "_DiffractionPower", "_RampRepeat", "_RampSpeed", "_RampOffset",
    "_RampInterval", "_RemoveMetalic", "_FakeSpecularColor", "_DarknessColor", "_DarknessOffset",
  ]);
  if (/_17\._m/.test(out)) throw new Error("fragment adaptation incomplete");
  return `${out.trimEnd()}\n`;
}

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

const vertexExpected = {
  ubo: { name: "_21_23", size: 248, members: [
    member("_m0", "vec3", 0), member("_m1", "vec4", 16, [4]), member("_m2", "vec4", 80, [4]),
    member("_m3", "vec4", 144, [4]), ...Array.from({ length: 4 }, (_, i) => member(`_m${i + 4}`, "float", 208 + i * 4)),
    member("_m8", "int", 224), ...Array.from({ length: 5 }, (_, i) => member(`_m${i + 9}`, "float", 228 + i * 4)),
  ] },
  inputs: [
    { name: "_11", type: "vec4", location: 0 }, { name: "_79", type: "vec3", location: 1 },
    { name: "_295", type: "vec2", location: 2 }, { name: "_329", type: "vec2", location: 3 },
    { name: "_131", type: "vec4", location: 4 },
  ],
  outputs: [
    { name: "vs_TEXCOORD0", type: "vec2", location: 0 }, { name: "vs_TEXCOORD1", type: "vec2", location: 1 },
    { name: "vs_TEXCOORD3", type: "vec3", location: 2 }, { name: "vs_TEXCOORD4", type: "vec3", location: 3 },
    { name: "vs_TEXCOORD5", type: "vec4", location: 4 },
  ], textures: [],
};

const fragmentExpected = {
  ubo: { name: "_15_17", size: 224, members: [
    member("_m0", "vec3", 0), member("_m1", "vec4", 16, [4]), member("_m2", "vec4", 80, [4]),
    ...Array.from({ length: 10 }, (_, i) => member(`_m${i + 3}`, "float", 144 + i * 4)),
    member("_m13", "vec3", 192), member("_m14", "vec3", 208), member("_m15", "float", 220),
  ] },
  inputs: [
    { name: "vs_TEXCOORD0", type: "vec2", location: 0 }, { name: "vs_TEXCOORD1", type: "vec2", location: 1 },
    { name: "vs_TEXCOORD3", type: "vec3", location: 2 }, { name: "vs_TEXCOORD4", type: "vec3", location: 3 },
    { name: "vs_TEXCOORD5", type: "vec4", location: 4 },
  ],
  outputs: [{ name: "_603", type: "vec4", location: 0 }, { name: "_658", type: "vec4", location: 1 }],
  textures: [
    { name: "_594", type: "sampler2D", binding: 0 }, { name: "_555", type: "samplerCube", binding: 1 },
    { name: "_413", type: "sampler2D", binding: 2 }, { name: "_483", type: "sampler2D", binding: 3 },
    { name: "_341", type: "sampler2D", binding: 4 }, { name: "_393", type: "sampler2D", binding: 5 },
    { name: "_615", type: "sampler2D", binding: 6 }, { name: "_219", type: "sampler2D", binding: 7 },
  ],
};

try {
  const dump = run(PYTHON, ["build/shaderdec/dump_shader.py", "Card_UR_Plate", "ur_plate", "--shaders", SHADER_ROOT, "--out", tmp], { shell: process.platform === "win32" });
  if (!/modules 2 \| vertex 1 \| fragment 1/.test(dump)) throw new Error(`unexpected official module set:\n${dump}`);
  const vertSpv = path.join(tmp, "ur_plate_vert.spv");
  const fragSpv = path.join(tmp, "ur_plate_frag.spv");
  assertReflection(vertSpv, vertexExpected);
  assertReflection(fragSpv, fragmentExpected);
  const metadata = JSON.parse(run(PYTHON, ["build/extract-shader-defaults.py"], {
    shell: process.platform === "win32", input: JSON.stringify({ root: SHADER_ROOT, shaders: ["Card_UR_Plate"] }),
    stdio: ["pipe", "pipe", "pipe"],
  })).found.Card_UR_Plate;
  const binding = metadata.programBindings?.[0];
  const samplerSlots = ["_MainTex", "_CubeMap", "_PhaseTex", "_PhaseMaskTex", "_RampMaskTex", "_RampTex", "_HologramMaskTex", "_FakeSpecularMask"];
  equal(binding?.textures?.map(({ name, binding }) => ({ name, binding })), samplerSlots.map((name, binding) => ({ name, binding })), "compiled sampler bindings changed");
  const outputs = {
    "ur_plate.vert.glsl": adaptVertex(run(SPIRV_CROSS, [vertSpv, "--version", "300", "--es"])),
    "ur_plate.frag.glsl": adaptFragment(run(SPIRV_CROSS, [fragSpv, "--version", "300", "--es"])),
    "ur_plate_uniforms.json": `${JSON.stringify({
      shader: "Card_UR_Plate", generated_by: "build/build-exact-ur-plate.mjs",
      official_spirv_sha256: { vertex: sha256(vertSpv), fragment: sha256(fragSpv) },
      samplers: fragmentExpected.textures.map((item) => item.name), sampler_slots: samplerSlots,
      compiled_texture_bindings: Object.fromEntries(samplerSlots.map((name, binding) => [name, binding])),
      implicit_defaults: { ...metadata.textures, _CubeMap: "gray" },
      mrt: { primary: "_603", secondary: "_658", secondary_value: "zero" },
    }, null, 2)}\n`,
  };
  fs.mkdirSync(OUT, { recursive: true });
  for (const [name, content] of Object.entries(outputs)) {
    const file = path.join(OUT, name);
    if (CHECK) {
      if (!fs.existsSync(file) || fs.readFileSync(file, "utf8") !== content) throw new Error(`${name} does not match official regeneration`);
    } else fs.writeFileSync(file, content);
  }
  console.log(`${CHECK ? "verified" : "generated"} Card_UR_Plate from official SPIR-V and compiled bindings`);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
