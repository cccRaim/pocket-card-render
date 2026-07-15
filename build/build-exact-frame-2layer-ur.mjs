// Generate Frame-2Layer-UR from the official Unity shader bundle.
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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pcr-frame-2layer-ur-"));

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

const vertexMapping = [
  "_ObjectToWorld", "_WorldToObject", "_ViewProjection", "_RampMaskRotation", "_RampMaskScale",
  "_UseSimpleRampMaskAndRotation", "_RampMaskRotation2", "_RampMaskScale2",
  "_UseSimpleRampMaskAndRotation2", "_FakeSpecularMaskScale", "_FakeSpecularIntensity",
  "_FakeSpecularPower", "_FakeSpecularCornerPower", "_FakeSpecularNotCornerOffset",
  "_FakeSpecularMaskScale2", "_FakeSpecularIntensity2", "_FakeSpecularPower2",
  "_FakeSpecularCornerPower2", "_FakeSpecularNotCornerOffset2",
];

const fragmentMapping = [
  "cameraPosition", "viewMatrix", "_Shininess", "_BaseColorIntensity", "_SpecularIntensity",
  "_DiffractionIntensity", "_DiffractionPower", "_RampRepeat", "_RampSpeed", "_RampOffset",
  "_RampInterval", "_UseSimpleRampMaskAndRotation", "_RemoveMetallic", "_DiffractionIntensity2",
  "_DiffractionPower2", "_RampRepeat2", "_RampSpeed2", "_RampOffset2", "_RampInterval2",
  "_UseSimpleRampMaskAndRotation2", "_FakeSpecularColor", "_FakeSpecularColor2", "_DarknessColor1",
  "_DarknessOffset1", "_DarknessColor2", "_DarknessOffset2", "_EmissivePattern", "_EmissiveColor",
  "_Rotation", "_Tilt",
];

function adaptVertex(source) {
  let out = source.replace(/^#version 300 es\s*/m, "precision highp float;\nprecision highp int;\n\n");
  out = replaceUbo(out, "_20_22", "_22", [
    "uniform highp mat4 modelMatrix;", "uniform highp mat4 viewMatrix;", "uniform highp mat4 projectionMatrix;",
    "uniform mediump float _RampMaskRotation;", "uniform mediump float _RampMaskScale;",
    "uniform int _UseSimpleRampMaskAndRotation;", "uniform mediump float _RampMaskRotation2;",
    "uniform mediump float _RampMaskScale2;", "uniform int _UseSimpleRampMaskAndRotation2;",
    "uniform mediump float _FakeSpecularMaskScale;", "uniform mediump float _FakeSpecularIntensity;",
    "uniform mediump float _FakeSpecularPower;", "uniform mediump float _FakeSpecularCornerPower;",
    "uniform mediump float _FakeSpecularNotCornerOffset;", "uniform mediump float _FakeSpecularMaskScale2;",
    "uniform mediump float _FakeSpecularIntensity2;", "uniform mediump float _FakeSpecularPower2;",
    "uniform mediump float _FakeSpecularCornerPower2;", "uniform mediump float _FakeSpecularNotCornerOffset2;",
  ]);
  out = out
    .replace("layout(location = 0) in vec4 _11;", "in vec3 position;")
    .replace("layout(location = 1) in vec3 _1124;", "in vec3 normal;")
    .replace("layout(location = 2) in vec2 _858;", "in vec2 uv;")
    .replace(/void main\(\)\s*\{/, `void main()
{
    vec4 _11 = vec4(position, 1.0);
    vec3 _1124 = normal;
    vec2 _858 = uv;
    mat4 _ObjectToWorld = modelMatrix;
    mat4 _WorldToObject = inverse(modelMatrix);
    mat4 _ViewProjection = projectionMatrix * viewMatrix;`);
  out = replaceMembers(out, "_22", vertexMapping);
  out = out.replace(/^\s*gl_Position\.y\s*=\s*-gl_Position\.y;\s*$/m, "");
  if (/_22\._m|gl_Position\.y\s*=\s*-gl_Position\.y/.test(out)) throw new Error("vertex adaptation incomplete");
  return `${out.trimEnd()}\n`;
}

function adaptFragment(source) {
  let out = source.replace(/^#version 300 es\s*/m, "");
  out = replaceUbo(out, "_67_69", "_69", [
    "uniform highp vec3 cameraPosition;", "uniform highp mat4 viewMatrix;",
    "uniform mediump float _Shininess;", "uniform mediump float _BaseColorIntensity;",
    "uniform mediump float _SpecularIntensity;", "uniform mediump float _DiffractionIntensity;",
    "uniform mediump float _DiffractionPower;", "uniform mediump float _RampRepeat;",
    "uniform mediump float _RampSpeed;", "uniform mediump float _RampOffset;",
    "uniform mediump float _RampInterval;", "uniform int _UseSimpleRampMaskAndRotation;",
    "uniform mediump float _RemoveMetallic;", "uniform mediump float _DiffractionIntensity2;",
    "uniform mediump float _DiffractionPower2;", "uniform mediump float _RampRepeat2;",
    "uniform mediump float _RampSpeed2;", "uniform mediump float _RampOffset2;",
    "uniform mediump float _RampInterval2;", "uniform int _UseSimpleRampMaskAndRotation2;",
    "uniform mediump vec3 _FakeSpecularColor;", "uniform mediump vec3 _FakeSpecularColor2;",
    "uniform mediump vec3 _DarknessColor1;", "uniform mediump float _DarknessOffset1;",
    "uniform mediump vec3 _DarknessColor2;", "uniform mediump float _DarknessOffset2;",
    "uniform int _EmissivePattern;", "uniform mediump vec4 _EmissiveColor;",
    "uniform mediump vec3 _Rotation;", "uniform mediump float _Tilt;", "uniform int uBloomOnly;",
  ]);
  out = replaceMembers(out, "_69", fragmentMapping);
  const officialTail = "    _34 = _9;";
  if (!out.includes(officialTail)) throw new Error("official primary-output tail changed");
  out = out.replace(officialTail, `${officialTail}\n    if (uBloomOnly != 0)\n    {\n        _34 = _42;\n    }`);
  if (/_69\._m/.test(out)) throw new Error("fragment adaptation incomplete");
  return `${out.trimEnd()}\n`;
}

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function compiledFields(buffer) {
  return [...(buffer?.matrices || []), ...(buffer?.vectors || [])]
    .sort((a, b) => a.offset - b.offset)
    .map(({ name, offset }) => ({ name, offset }));
}

const vertexExpected = {
  ubo: { name: "_20_22", size: 256, members: [
    member("_m0", "vec4", 0, [4]), member("_m1", "vec4", 64, [4]), member("_m2", "vec4", 128, [4]),
    member("_m3", "float", 192), member("_m4", "float", 196), member("_m5", "int", 200),
    member("_m6", "float", 204), member("_m7", "float", 208), member("_m8", "int", 212),
    ...Array.from({ length: 10 }, (_, i) => member(`_m${i + 9}`, "float", 216 + i * 4)),
  ] },
  inputs: [
    { name: "_11", type: "vec4", location: 0 }, { name: "_1124", type: "vec3", location: 1 },
    { name: "_858", type: "vec2", location: 2 },
  ],
  outputs: [
    { name: "vs_TEXCOORD0", type: "vec2", location: 0 }, { name: "vs_TEXCOORD6", type: "float", location: 1 },
    { name: "vs_TEXCOORD7", type: "float", location: 2 }, { name: "vs_TEXCOORD2", type: "vec3", location: 3 },
    { name: "vs_TEXCOORD3", type: "vec3", location: 4 }, { name: "vs_TEXCOORD4", type: "vec4", location: 5 },
    { name: "vs_TEXCOORD5", type: "vec4", location: 6 },
  ], textures: [],
};

const fragmentExpected = {
  ubo: { name: "_67_69", size: 272, members: [
    member("_m0", "vec3", 0), member("_m1", "vec4", 16, [4]),
    ...Array.from({ length: 9 }, (_, i) => member(`_m${i + 2}`, "float", 80 + i * 4)),
    member("_m11", "int", 116), ...Array.from({ length: 7 }, (_, i) => member(`_m${i + 12}`, "float", 120 + i * 4)),
    member("_m19", "int", 148), member("_m20", "vec3", 160), member("_m21", "vec3", 176),
    member("_m22", "vec3", 192), member("_m23", "float", 204), member("_m24", "vec3", 208),
    member("_m25", "float", 220), member("_m26", "int", 224), member("_m27", "vec4", 240),
    member("_m28", "vec3", 256), member("_m29", "float", 268),
  ] },
  inputs: [
    { name: "vs_TEXCOORD0", type: "vec2", location: 0 }, { name: "vs_TEXCOORD6", type: "float", location: 1 },
    { name: "vs_TEXCOORD7", type: "float", location: 2 }, { name: "vs_TEXCOORD2", type: "vec3", location: 3 },
    { name: "vs_TEXCOORD3", type: "vec3", location: 4 }, { name: "vs_TEXCOORD4", type: "vec4", location: 5 },
    { name: "vs_TEXCOORD5", type: "vec4", location: 6 },
  ],
  outputs: [{ name: "_34", type: "vec4", location: 0 }, { name: "_42", type: "vec4", location: 1 }],
  textures: [
    { name: "_13", type: "sampler2D", binding: 0 }, { name: "_260", type: "sampler2D", binding: 1 },
    { name: "_367", type: "samplerCube", binding: 2 }, { name: "_420", type: "sampler2D", binding: 3 },
    { name: "_428", type: "sampler2D", binding: 4 }, { name: "_444", type: "sampler2D", binding: 5 },
    { name: "_601", type: "sampler2D", binding: 6 }, { name: "_760", type: "sampler2D", binding: 7 },
    { name: "_916", type: "sampler2D", binding: 8 }, { name: "_1277", type: "sampler2D", binding: 9 },
  ],
};

try {
  const dump = run(PYTHON, [
    "build/shaderdec/dump_shader.py", "Frame-2Layer-UR", "frame_2layer_ur", "--shaders", SHADER_ROOT, "--out", tmp,
  ], { shell: process.platform === "win32" });
  if (!/modules 2 \| vertex 1 \| fragment 1/.test(dump)) throw new Error(`unexpected official module set:\n${dump}`);
  const vertSpv = path.join(tmp, "frame_2layer_ur_vert.spv");
  const fragSpv = path.join(tmp, "frame_2layer_ur_frag.spv");
  reflect(vertSpv, vertexExpected);
  reflect(fragSpv, fragmentExpected);

  const metadata = JSON.parse(run(PYTHON, ["build/extract-shader-defaults.py"], {
    shell: process.platform === "win32",
    input: JSON.stringify({ root: SHADER_ROOT, shaders: ["Frame-2Layer-UR"] }),
    stdio: ["pipe", "pipe", "pipe"],
  })).found["Frame-2Layer-UR"];
  const binding = metadata.programBindings?.[0];
  const samplerSlots = [
    "_BaseTex", "_LayerMaskTex", "_CubeMap", "_PhaseTex", "_PhaseMaskTex", "_RampMaskTex",
    "_RampTex", "_RampMaskTex2", "_RampTex2", "_FakeSpecularMask",
  ];
  equal(binding?.textures?.map(({ name, binding, dim }) => ({ name, binding, dim })),
    samplerSlots.map((name, binding) => ({ name, binding, dim: name === "_CubeMap" ? 4 : 2 })),
    "compiled sampler bindings changed");
  const pglobals = binding.constantBuffers.find((item) => item.name.startsWith("PGlobals"));
  const vglobals = binding.constantBuffers.find((item) => item.name.startsWith("VGlobals"));
  equal({ p: pglobals?.size, v: vglobals?.size }, { p: 272, v: 256 }, "compiled UBO sizes changed");
  const engineNames = { unity_ObjectToWorld: "_ObjectToWorld", unity_WorldToObject: "_WorldToObject", unity_MatrixVP: "_ViewProjection", unity_MatrixV: "viewMatrix", _WorldSpaceCameraPos: "cameraPosition" };
  equal(compiledFields(vglobals).map(({ name, offset }) => ({ name: engineNames[name] || name, offset })),
    vertexMapping.map((name, index) => ({ name, offset: vertexExpected.ubo.members[index].offset })), "compiled vertex fields changed");
  equal(compiledFields(pglobals).map(({ name, offset }) => ({ name: engineNames[name] || name, offset })),
    fragmentMapping.map((name, index) => ({ name, offset: fragmentExpected.ubo.members[index].offset })), "compiled fragment fields changed");

  const outputs = {
    "frame_2layer_ur.vert.glsl": adaptVertex(run(SPIRV_CROSS, [vertSpv, "--version", "300", "--es"])),
    "frame_2layer_ur.frag.glsl": adaptFragment(run(SPIRV_CROSS, [fragSpv, "--version", "300", "--es"])),
    "frame_2layer_ur_uniforms.json": `${JSON.stringify({
      shader: "Frame-2Layer-UR", generated_by: "build/build-exact-frame-2layer-ur.mjs",
      official_spirv_sha256: { vertex: sha256(vertSpv), fragment: sha256(fragSpv) },
      samplers: fragmentExpected.textures.map((item) => item.name), sampler_slots: samplerSlots,
      compiled_texture_bindings: Object.fromEntries(samplerSlots.map((name, binding) => [name, binding])),
      implicit_defaults: { ...metadata.textures, _CubeMap: "gray" },
      mrt: { primary: "_34", emissive: "_42", webgl_bloom_route: "uBloomOnly" },
    }, null, 2)}\n`,
  };
  fs.mkdirSync(OUT, { recursive: true });
  for (const [name, content] of Object.entries(outputs)) {
    const file = path.join(OUT, name);
    if (CHECK) {
      if (!fs.existsSync(file) || fs.readFileSync(file, "utf8") !== content) throw new Error(`${name} does not match official regeneration`);
    } else fs.writeFileSync(file, content);
  }
  console.log(`${CHECK ? "verified" : "generated"} Frame-2Layer-UR from official SPIR-V and compiled bindings`);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
