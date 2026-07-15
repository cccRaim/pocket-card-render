// Generate the WebGL2 port of Frame-Holo-UR-New directly from the official Unity shader bundle.
// The shader body stays SPIRV-Cross output; only engine bindings and the MRT1 bloom route are adapted.
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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pcr-frame-holo-ur-"));

const vertexUniforms = [
  "uniform highp mat4 modelMatrix;",
  "uniform highp mat4 viewMatrix;",
  "uniform highp mat4 projectionMatrix;",
  "uniform mediump float _RampMaskRotation;",
  "uniform mediump float _RampMaskScale;",
  "uniform int _UseSimpleRampMaskAndRotation;",
  "uniform mediump float _FakeSpecularMaskScale;",
  "uniform mediump float _FakeSpecularIntensity;",
  "uniform mediump float _FakeSpecularPower;",
  "uniform mediump float _FakeSpecularCornerPower;",
  "uniform mediump float _FakeSpecularNotCornerOffset;",
].join("\n");

const fragmentUniforms = [
  "uniform highp vec3 cameraPosition;",
  "uniform highp mat4 modelMatrix;",
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
  "uniform int _UseSimpleRampMaskAndRotation;",
  "uniform float _RemoveMetalic;",
  "uniform int _FakeSpecularEnabled;",
  "uniform vec3 _FakeSpecularColor;",
  "uniform int _DarknessEnabled;",
  "uniform vec3 _DarknessColor;",
  "uniform float _DarknessOffset;",
  "uniform int _EmissivePattern;",
  "uniform vec4 _EmissiveColor;",
  "uniform vec3 _Rotation;",
  "uniform int uBloomOnly;",
].join("\n");

const vertexMembers = [
  "_ObjectToWorld",
  "_WorldToObject",
  "_ViewProjection",
  "_RampMaskRotation",
  "_RampMaskScale",
  "_UseSimpleRampMaskAndRotation",
  "_FakeSpecularMaskScale",
  "_FakeSpecularIntensity",
  "_FakeSpecularPower",
  "_FakeSpecularCornerPower",
  "_FakeSpecularNotCornerOffset",
];

const fragmentMembers = [
  "cameraPosition",
  "modelMatrix",
  "viewMatrix",
  "_Shininess",
  "_BaseColorIntensity",
  "_SpecularIntensity",
  "_DiffractionIntensity",
  "_DiffractionPower",
  "_RampRepeat",
  "_RampSpeed",
  "_RampOffset",
  "_RampInterval",
  "_UseSimpleRampMaskAndRotation",
  "_RemoveMetalic",
  "_FakeSpecularEnabled",
  "_FakeSpecularColor",
  "_DarknessEnabled",
  "_DarknessColor",
  "_DarknessOffset",
  "_EmissivePattern",
  "_EmissiveColor",
  "_Rotation",
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
    const index = Number(rawIndex);
    if (members[index] == null) throw new Error(`unmapped ${match}`);
    return members[index];
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
  if (!ubo) throw new Error(`reflection UBO ${expected.ubo.name} missing`);
  if (ubo.block_size !== expected.ubo.blockSize) {
    throw new Error(`reflection UBO ${expected.ubo.name} size ${ubo.block_size} != ${expected.ubo.blockSize}`);
  }
  const members = reflection.types?.[ubo.type]?.members || [];
  assertJsonEqual(members.map(({ name, type, offset }) => ({ name, type, offset })), expected.ubo.members, `${expected.ubo.name} members changed`);
  assertJsonEqual(
    (reflection.inputs || []).map(({ name, type, location }) => ({ name, type, location })).sort((a, b) => a.location - b.location),
    expected.inputs,
    "shader inputs changed",
  );
  assertJsonEqual(
    (reflection.outputs || []).map(({ name, type, location }) => ({ name, type, location })).sort((a, b) => a.location - b.location),
    expected.outputs,
    "shader outputs changed",
  );
  if (expected.textures) {
    assertJsonEqual(
      (reflection.textures || []).map(({ name, type, binding }) => ({ name, type, binding })).sort((a, b) => a.binding - b.binding),
      expected.textures,
      "shader texture bindings changed",
    );
  }
}

function adaptVertex(source) {
  let out = source.replace(/^#version 300 es\s*/m, "precision highp float;\nprecision highp int;\n\n");
  out = out.replace(/layout\(std140\) uniform _20_22[\s\S]*?}\s*_22;\s*/, `${vertexUniforms}\n\n`);
  out = out
    .replace("layout(location = 0) in vec4 _11;", "in vec3 position;")
    .replace("layout(location = 2) in vec2 _809;", "in vec2 uv;")
    .replace("layout(location = 1) in vec3 _853;", "in vec3 normal;")
    .replace(/void main\(\)\s*\{/, "void main()\n{\n    vec4 _11 = vec4(position, 1.0);\n    vec2 _809 = uv;\n    vec3 _853 = normal;\n    mat4 _ObjectToWorld = modelMatrix;\n    mat4 _WorldToObject = inverse(modelMatrix);\n    mat4 _ViewProjection = projectionMatrix * viewMatrix;");
  out = replaceMembers(out, "_22", vertexMembers);
  out = out.replace(/^\s*gl_Position\.y\s*=\s*-gl_Position\.y;\s*$/m, "");
  assertMatch(out, /_ObjectToWorld\[0\]\s*\*\s*_11\.xxxx/, "object-to-world binding missing");
  assertMatch(out, /_WorldToObject\[0\]\.xyz/, "world-to-object normal binding missing");
  assertMatch(out, /mat4 _ViewProjection = projectionMatrix \* viewMatrix;/, "view-projection binding missing");
  if (/_22\._m|gl_Position\.y\s*=\s*-gl_Position\.y/.test(out)) throw new Error("vertex adaptation incomplete");
  return `${out.trimEnd()}\n`;
}

function adaptFragment(source) {
  let out = source.replace(/^#version 300 es\s*/m, "");
  out = out.replace(/layout\(std140\) uniform _49_51[\s\S]*?}\s*_51;\s*/, `${fragmentUniforms}\n\n`);
  out = replaceMembers(out, "_51", fragmentMembers);
  const officialTail = "    _1059.w = _9.w;";
  if (!out.includes(officialTail)) throw new Error("official primary-output tail changed");
  out = out.replace(officialTail, `${officialTail}\n    if (uBloomOnly != 0)\n    {\n        _1059 = _1053;\n    }`);
  assertMatch(out, /layout\(location = 1\) out highp vec4 _1053;/, "official emissive MRT output missing");
  assertMatch(out, /layout\(location = 0\) out highp vec4 _1059;/, "official primary MRT output missing");
  assertMatch(out, /if \(uBloomOnly != 0\)[\s\S]*?_1059 = _1053;/, "WebGL bloom route missing");
  if (/_51\._m/.test(out)) throw new Error("fragment adaptation incomplete");
  return `${out.trimEnd()}\n`;
}

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

try {
  const dump = run(PYTHON, [
    "build/shaderdec/dump_shader.py",
    "Frame-Holo-UR-New",
    "frame_holo_ur",
    "--shaders",
    SHADER_ROOT,
    "--out",
    tmp,
  ], { shell: process.platform === "win32" });
  if (!/modules 2 \| vertex 1 \| fragment 1/.test(dump)) {
    throw new Error(`unexpected official module set:\n${dump}`);
  }

  const vertSpv = path.join(tmp, "frame_holo_ur_vert.spv");
  const fragSpv = path.join(tmp, "frame_holo_ur_frag.spv");
  const vertReflection = JSON.parse(run(SPIRV_CROSS, [vertSpv, "--reflect"]));
  const fragReflection = JSON.parse(run(SPIRV_CROSS, [fragSpv, "--reflect"]));
  assertReflection(vertReflection, {
    ubo: {
      name: "_20_22",
      blockSize: 224,
      members: [
        { name: "_m0", type: "vec4", offset: 0 }, { name: "_m1", type: "vec4", offset: 64 },
        { name: "_m2", type: "vec4", offset: 128 }, { name: "_m3", type: "float", offset: 192 },
        { name: "_m4", type: "float", offset: 196 }, { name: "_m5", type: "int", offset: 200 },
        { name: "_m6", type: "float", offset: 204 }, { name: "_m7", type: "float", offset: 208 },
        { name: "_m8", type: "float", offset: 212 }, { name: "_m9", type: "float", offset: 216 },
        { name: "_m10", type: "float", offset: 220 },
      ],
    },
    inputs: [
      { name: "_11", type: "vec4", location: 0 },
      { name: "_853", type: "vec3", location: 1 },
      { name: "_809", type: "vec2", location: 2 },
    ],
    outputs: [
      { name: "vs_TEXCOORD0", type: "vec2", location: 0 },
      { name: "vs_TEXCOORD5", type: "float", location: 1 },
      { name: "vs_TEXCOORD2", type: "vec3", location: 2 },
      { name: "vs_TEXCOORD3", type: "vec3", location: 3 },
      { name: "vs_TEXCOORD4", type: "vec4", location: 4 },
    ],
  });
  assertReflection(fragReflection, {
    ubo: {
      name: "_49_51",
      blockSize: 268,
      members: [
        { name: "_m0", type: "vec3", offset: 0 }, { name: "_m1", type: "vec4", offset: 16 },
        { name: "_m2", type: "vec4", offset: 80 }, { name: "_m3", type: "float", offset: 144 },
        { name: "_m4", type: "float", offset: 148 }, { name: "_m5", type: "float", offset: 152 },
        { name: "_m6", type: "float", offset: 156 }, { name: "_m7", type: "float", offset: 160 },
        { name: "_m8", type: "float", offset: 164 }, { name: "_m9", type: "float", offset: 168 },
        { name: "_m10", type: "float", offset: 172 }, { name: "_m11", type: "float", offset: 176 },
        { name: "_m12", type: "int", offset: 180 }, { name: "_m13", type: "float", offset: 184 },
        { name: "_m14", type: "int", offset: 188 }, { name: "_m15", type: "vec3", offset: 192 },
        { name: "_m16", type: "int", offset: 204 }, { name: "_m17", type: "vec3", offset: 208 },
        { name: "_m18", type: "float", offset: 220 }, { name: "_m19", type: "int", offset: 224 },
        { name: "_m20", type: "vec4", offset: 240 }, { name: "_m21", type: "vec3", offset: 256 },
      ],
    },
    inputs: [
      { name: "vs_TEXCOORD0", type: "vec2", location: 0 },
      { name: "vs_TEXCOORD5", type: "float", location: 1 },
      { name: "vs_TEXCOORD2", type: "vec3", location: 2 },
      { name: "vs_TEXCOORD3", type: "vec3", location: 3 },
      { name: "vs_TEXCOORD4", type: "vec4", location: 4 },
    ],
    outputs: [
      { name: "_1059", type: "vec4", location: 0 },
      { name: "_1053", type: "vec4", location: 1 },
    ],
    textures: [
      { name: "_13", type: "sampler2D", binding: 0 }, { name: "_302", type: "sampler2D", binding: 1 },
      { name: "_333", type: "samplerCube", binding: 2 }, { name: "_388", type: "sampler2D", binding: 3 },
      { name: "_396", type: "sampler2D", binding: 4 }, { name: "_410", type: "sampler2D", binding: 5 },
      { name: "_570", type: "sampler2D", binding: 6 }, { name: "_721", type: "sampler2D", binding: 7 },
    ],
  });
  const officialVert = run(SPIRV_CROSS, [vertSpv, "--version", "300", "--es"]);
  const officialFrag = run(SPIRV_CROSS, [fragSpv, "--version", "300", "--es"]);
  assertMatch(officialVert, /layout\(std140\) uniform _20_22/, "official vertex UBO layout changed");
  assertMatch(officialFrag, /layout\(std140\) uniform _49_51/, "official fragment UBO layout changed");
  assertMatch(officialFrag, /_1053\s*=/, "official emissive output expression missing");

  const outputs = {
    "frame_holo_ur.vert.glsl": adaptVertex(officialVert),
    "frame_holo_ur.frag.glsl": adaptFragment(officialFrag),
    "frame_holo_ur_uniforms.json": `${JSON.stringify({
    shader: "Frame-Holo-UR-New",
    generated_by: "build/build-exact-frame-holo-ur.mjs",
    official_spirv_sha256: {
      vertex: sha256(vertSpv),
      fragment: sha256(fragSpv),
    },
    samplers: ["_13", "_302", "_333", "_388", "_396", "_410", "_570", "_721"],
    sampler_slots: ["_BaseTex", "_HologramMaskTex", "_CubeMap", "_PhaseTex", "_PhaseMaskTex", "_RampMaskTex", "_RampTex", "_FakeSpecularMask"],
    floats: Object.fromEntries([
      "_RampMaskRotation", "_RampMaskScale", "_UseSimpleRampMaskAndRotation", "_FakeSpecularMaskScale",
      "_FakeSpecularIntensity", "_FakeSpecularPower", "_FakeSpecularCornerPower", "_FakeSpecularNotCornerOffset",
      "_Shininess", "_BaseColorIntensity", "_SpecularIntensity", "_DiffractionIntensity", "_DiffractionPower",
      "_RampRepeat", "_RampSpeed", "_RampOffset", "_RampInterval", "_RemoveMetalic", "_FakeSpecularEnabled",
      "_DarknessEnabled", "_DarknessOffset", "_EmissivePattern",
    ].map((name) => [name, name])),
    colors: {
      _FakeSpecularColor: "_FakeSpecularColor",
      _DarknessColor: "_DarknessColor",
      _EmissiveColor: "_EmissiveColor",
      _Rotation: "_Rotation",
    },
    implicit_defaults: { _CubeMap: "gray" },
    mrt: { primary: "_1059", emissive: "_1053", webgl_bloom_route: "uBloomOnly" },
    }, null, 2)}\n`,
  };

  fs.mkdirSync(OUT, { recursive: true });
  for (const [name, content] of Object.entries(outputs)) {
    const file = path.join(OUT, name);
    if (CHECK) {
      if (!fs.existsSync(file) || fs.readFileSync(file, "utf8") !== content) {
        throw new Error(`${name} does not match the current official SPIR-V generation`);
      }
    } else {
      fs.writeFileSync(file, content);
    }
  }

  console.log(`${CHECK ? "verified" : "generated"} Frame-Holo-UR-New from official SPIR-V (${sha256(vertSpv).slice(0, 12)} / ${sha256(fragSpv).slice(0, 12)})`);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
