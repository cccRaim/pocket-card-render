// Generate Transparent_Hologram_Tuning directly from the official Unity shader bundle.
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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pcr-transparent-hologram-tuning-"));

const vertexMembers = ["_ObjectToWorld", "_WorldToObject", "_ViewProjection"];
const fragmentMembers = [
  "cameraPosition", "viewMatrix", "_Shininess", "_BaseColorIntensity", "_SpecularIntensity",
  "_DiffractionIntensity", "_DiffractionPower", "_RampRepeat", "_RampSpeed", "_RampOffset",
  "_RampInterval", "_AlphaBlend", "_EmitMasking", "_Rotation",
];

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });
}

function replaceMembers(source, owner, members) {
  return source.replace(new RegExp(`${owner}\\._m(\\d+)`, "g"), (match, rawIndex) => {
    const value = members[Number(rawIndex)];
    if (value == null) throw new Error(`unmapped ${match}`);
    return value;
  });
}

function assertMatch(source, pattern, message) {
  if (!pattern.test(source)) throw new Error(message);
}

function assertJsonEqual(actual, expected, message) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertReflection(reflection, expected) {
  const ubo = (reflection.ubos || []).find((item) => item.name === expected.ubo.name);
  if (!ubo || ubo.block_size !== expected.ubo.blockSize) throw new Error(`${expected.ubo.name} UBO layout changed`);
  const members = reflection.types?.[ubo.type]?.members || [];
  assertJsonEqual(members.map(({ name, type, offset }) => ({ name, type, offset })), expected.ubo.members, `${expected.ubo.name} members changed`);
  for (const key of ["inputs", "outputs"]) {
    assertJsonEqual(
      (reflection[key] || []).map(({ name, type, location }) => ({ name, type, location })).sort((a, b) => a.location - b.location),
      expected[key],
      `shader ${key} changed`,
    );
  }
  assertJsonEqual(
    (reflection.textures || []).map(({ name, type, binding }) => ({ name, type, binding })).sort((a, b) => a.binding - b.binding),
    expected.textures,
    "shader texture bindings changed",
  );
}

function adaptVertex(source) {
  let out = source.replace(/^#version 300 es\s*/m, "precision highp float;\nprecision highp int;\n\n");
  out = out.replace(/layout\(std140\) uniform _19_21[\s\S]*?}\s*_21;\s*/, [
    "uniform highp mat4 modelMatrix;",
    "uniform highp mat4 viewMatrix;",
    "uniform highp mat4 projectionMatrix;",
    "",
  ].join("\n"));
  out = out
    .replace("layout(location = 0) in vec4 _11;", "in vec3 position;")
    .replace("layout(location = 1) in vec2 _100;", "in vec2 uv;")
    .replace("layout(location = 2) in vec3 _103;", "in vec3 normal;")
    .replace(/void main\(\)\s*\{/, [
      "void main()",
      "{",
      "    vec4 _11 = vec4(position, 1.0);",
      "    vec2 _100 = uv;",
      "    vec3 _103 = normal;",
      "    mat4 _ObjectToWorld = modelMatrix;",
      "    mat4 _WorldToObject = inverse(modelMatrix);",
      "    mat4 _ViewProjection = projectionMatrix * viewMatrix;",
    ].join("\n"));
  out = replaceMembers(out, "_21", vertexMembers);
  out = out.replace(/^\s*gl_Position\.y\s*=\s*-gl_Position\.y;\s*$/m, "");
  assertMatch(out, /_WorldToObject\[0\]\.xyz/, "world-to-object normal binding missing");
  assertMatch(out, /mat4 _ViewProjection = projectionMatrix \* viewMatrix;/, "view-projection binding missing");
  if (/_21\._m|gl_Position\.y\s*=\s*-gl_Position\.y/.test(out)) throw new Error("vertex adaptation incomplete");
  return `${out.trimEnd()}\n`;
}

function adaptFragment(source) {
  let out = source.replace(/^#version 300 es\s*/m, "");
  out = out.replace(/layout\(std140\) uniform _14_16[\s\S]*?}\s*_16;\s*/, [
    "uniform highp vec3 cameraPosition;",
    "uniform highp mat4 viewMatrix;",
    "uniform float _Shininess;",
    "uniform float _BaseColorIntensity;",
    "uniform float _SpecularIntensity;",
    "uniform float _DiffractionIntensity;",
    "uniform float _DiffractionPower;",
    "uniform float _RampRepeat;",
    "uniform float _RampSpeed;",
    "uniform float _RampOffset;",
    "uniform float _RampInterval;",
    "uniform float _AlphaBlend;",
    "uniform float _EmitMasking;",
    "uniform vec3 _Rotation;",
    "",
  ].join("\n"));
  out = replaceMembers(out, "_16", fragmentMembers);
  assertMatch(out, /_623\s*=\s*_562;/, "official MRT1 output missing");
  assertMatch(out, /_562\.w\s*=\s*_274\.w\s*\*\s*_EmitMasking;/, "official emit-mask expression missing");
  if (/_16\._m/.test(out)) throw new Error("fragment adaptation incomplete");
  return `${out.trimEnd()}\n`;
}

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

try {
  const dump = run(PYTHON, [
    "build/shaderdec/dump_shader.py", "Transparent_Hologram_Tuning", "transparent_hologram_tuning",
    "--shaders", SHADER_ROOT, "--out", tmp,
  ], { shell: process.platform === "win32" });
  if (!/modules 2 \| vertex 1 \| fragment 1/.test(dump)) throw new Error(`unexpected official module set:\n${dump}`);

  const vertSpv = path.join(tmp, "transparent_hologram_tuning_vert.spv");
  const fragSpv = path.join(tmp, "transparent_hologram_tuning_frag.spv");
  const vertReflection = JSON.parse(run(SPIRV_CROSS, [vertSpv, "--reflect"]));
  const fragReflection = JSON.parse(run(SPIRV_CROSS, [fragSpv, "--reflect"]));
  assertReflection(vertReflection, {
    ubo: { name: "_19_21", blockSize: 192, members: [
      { name: "_m0", type: "vec4", offset: 0 }, { name: "_m1", type: "vec4", offset: 64 },
      { name: "_m2", type: "vec4", offset: 128 },
    ] },
    inputs: [
      { name: "_11", type: "vec4", location: 0 }, { name: "_100", type: "vec2", location: 1 },
      { name: "_103", type: "vec3", location: 2 },
    ],
    outputs: [
      { name: "vs_TEXCOORD0", type: "vec2", location: 0 }, { name: "vs_TEXCOORD1", type: "vec3", location: 1 },
      { name: "vs_TEXCOORD2", type: "vec3", location: 2 },
    ],
    textures: [],
  });
  assertReflection(fragReflection, {
    ubo: { name: "_14_16", blockSize: 140, members: [
      { name: "_m0", type: "vec3", offset: 0 }, { name: "_m1", type: "vec4", offset: 16 },
      { name: "_m2", type: "float", offset: 80 }, { name: "_m3", type: "float", offset: 84 },
      { name: "_m4", type: "float", offset: 88 }, { name: "_m5", type: "float", offset: 92 },
      { name: "_m6", type: "float", offset: 96 }, { name: "_m7", type: "float", offset: 100 },
      { name: "_m8", type: "float", offset: 104 }, { name: "_m9", type: "float", offset: 108 },
      { name: "_m10", type: "float", offset: 112 }, { name: "_m11", type: "float", offset: 116 },
      { name: "_m12", type: "float", offset: 120 }, { name: "_m13", type: "vec3", offset: 128 },
    ] },
    inputs: [
      { name: "vs_TEXCOORD0", type: "vec2", location: 0 }, { name: "vs_TEXCOORD1", type: "vec3", location: 1 },
      { name: "vs_TEXCOORD2", type: "vec3", location: 2 },
    ],
    outputs: [{ name: "_611", type: "vec4", location: 0 }, { name: "_623", type: "vec4", location: 1 }],
    textures: [
      { name: "_563", type: "sampler2D", binding: 0 }, { name: "_596", type: "sampler2D", binding: 1 },
      { name: "_510", type: "samplerCube", binding: 2 }, { name: "_355", type: "sampler2D", binding: 3 },
      { name: "_278", type: "sampler2D", binding: 4 }, { name: "_332", type: "sampler2D", binding: 5 },
    ],
  });

  const officialVert = run(SPIRV_CROSS, [vertSpv, "--version", "300", "--es"]);
  const officialFrag = run(SPIRV_CROSS, [fragSpv, "--version", "300", "--es"]);
  const outputs = {
    "transparent_hologram_tuning.vert.glsl": adaptVertex(officialVert),
    "transparent_hologram_tuning.frag.glsl": adaptFragment(officialFrag),
    "transparent_hologram_tuning_uniforms.json": `${JSON.stringify({
      shader: "Transparent_Hologram_Tuning",
      generated_by: "build/build-exact-transparent-hologram-tuning.mjs",
      official_spirv_sha256: { vertex: sha256(vertSpv), fragment: sha256(fragSpv) },
      samplers: ["_563", "_596", "_510", "_355", "_278", "_332"],
      sampler_slots: ["_DynamicUITex", "_HologramMaskTex", "_CubeMap", "_PhaseTex", "_RampMaskTex", "_RampTex"],
      floats: Object.fromEntries([
        "_Shininess", "_BaseColorIntensity", "_SpecularIntensity", "_DiffractionIntensity", "_DiffractionPower",
        "_RampRepeat", "_RampSpeed", "_RampOffset", "_RampInterval", "_AlphaBlend", "_EmitMasking",
      ].map((name) => [name, name])),
      colors: { _Rotation: "_Rotation" },
      implicit_defaults: { _CubeMap: "gray" },
      mrt: { primary: "_611", mask: "_623", mask_channel: "alpha", mask_switch: "_EmitMasking" },
    }, null, 2)}\n`,
  };
  fs.mkdirSync(OUT, { recursive: true });
  for (const [name, content] of Object.entries(outputs)) {
    const file = path.join(OUT, name);
    if (CHECK) {
      if (!fs.existsSync(file) || fs.readFileSync(file, "utf8") !== content) throw new Error(`${name} does not match official regeneration`);
    } else {
      fs.writeFileSync(file, content);
    }
  }
  console.log(`${CHECK ? "verified" : "generated"} Transparent_Hologram_Tuning from official SPIR-V (${sha256(vertSpv).slice(0, 12)} / ${sha256(fragSpv).slice(0, 12)})`);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
