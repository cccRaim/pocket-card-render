// Generate the enabled Opaque-UR-Oklab variant from official Unity shader bytecode and parameter blobs.
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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pcr-opaque-ur-oklab-"));

const SELECTOR_KEYWORD = "_FAKESPECULARENABLED_ON";
const SELECTED_KEYWORDS = [
  "_HOLOGRAM2ENABLED_ON",
  "_REFLECTIONENABLED_ON",
  "_FAKESPECULARENABLED_ON",
  "_DARKNESSENABLED_ON",
];

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });
}

function assertEqual(actual, expected, message) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function member(name, type, offset, array = undefined) {
  return { name, type, offset, ...(array ? { array } : {}) };
}

function reflectedMember(item) {
  return {
    name: item.name,
    type: item.type,
    offset: item.offset,
    ...(item.array ? { array: item.array } : {}),
  };
}

function assertReflection(reflection, expected) {
  const ubo = (reflection.ubos || []).find((item) => item.name === expected.ubo.name);
  if (!ubo || ubo.block_size !== expected.ubo.size) throw new Error(`${expected.ubo.name} UBO layout changed`);
  assertEqual(
    (reflection.types?.[ubo.type]?.members || []).map(reflectedMember),
    expected.ubo.members,
    `${expected.ubo.name} members changed`,
  );
  for (const key of ["inputs", "outputs"]) {
    assertEqual(
      (reflection[key] || []).map(({ name, type, location }) => ({ name, type, location })).sort((a, b) => a.location - b.location),
      expected[key],
      `${expected.ubo.name} ${key} changed`,
    );
  }
  assertEqual(
    (reflection.textures || []).map(({ name, type, binding }) => ({ name, type, binding })).sort((a, b) => a.binding - b.binding),
    expected.textures || [],
    `${expected.ubo.name} textures changed`,
  );
  return { ubo, members: reflection.types[ubo.type].members };
}

function replaceMembers(source, owner, mapping) {
  return source.replace(new RegExp(`${owner}\\._m(\\d+)`, "g"), (match, rawIndex) => {
    const value = mapping[Number(rawIndex)];
    if (value == null) throw new Error(`unmapped ${match}`);
    return value;
  });
}

function replaceUbo(source, blockName, instanceName, uniforms) {
  const re = new RegExp(`layout\\(std140\\) uniform ${blockName}[\\s\\S]*?}\\s*${instanceName};\\s*`);
  const out = source.replace(re, `${uniforms.join("\n")}\n\n`);
  if (out === source) throw new Error(`${blockName} UBO replacement failed`);
  return out;
}

function bufferByPrefix(bindings, prefix) {
  const result = bindings.constantBuffers.find((item) => item.name.startsWith(prefix));
  if (!result) throw new Error(`${prefix} parameter blob missing`);
  return result;
}

const ENGINE_NAMES = {
  _WorldSpaceCameraPos: "cameraPosition",
  unity_MatrixV: "viewMatrix",
  unity_MatrixVP: "_ViewProjection",
  unity_ObjectToWorld: "_ObjectToWorld",
  unity_WorldToObject: "_WorldToObject",
};

function bindingMap(buffer, reflectedMembers, overrides = {}) {
  const byOffset = new Map(buffer.fields.map((item) => [item.offset, item.name]));
  if (byOffset.size !== reflectedMembers.length) throw new Error(`${buffer.name} field count changed`);
  return reflectedMembers.map((item) => {
    const official = byOffset.get(item.offset);
    if (!official) throw new Error(`${buffer.name}: no official field at offset ${item.offset}`);
    return overrides[official] || ENGINE_NAMES[official] || official;
  });
}

function assertBufferOffsets(buffer, reflectedMembers) {
  assertEqual(
    buffer.fields.map(({ name, offset }) => ({ name, offset })).sort((a, b) => a.offset - b.offset),
    reflectedMembers.map((item) => ({ name: buffer.fields.find((field) => field.offset === item.offset)?.name, offset: item.offset })),
    `${buffer.name} offsets disagree with SPIR-V`,
  );
}

function adaptVertex(source, mapping) {
  let out = source.replace(/^#version 300 es\s*/m, "precision highp float;\nprecision highp int;\n\n");
  out = replaceUbo(out, "_19_21", "_21", [
    "uniform highp mat4 modelMatrix;",
    "uniform highp mat4 viewMatrix;",
    "uniform highp mat4 projectionMatrix;",
    "uniform mediump float _FakeSpecularMaskScale;",
    "uniform mediump float _FakeSpecularIntensity;",
    "uniform mediump float _FakeSpecularPower;",
    "uniform mediump float _FakeSpecularCornerPower;",
    "uniform mediump float _FakeSpecularNotCornerOffset;",
    "uniform mediump float _FakeSpecularMaskScale_Outline;",
    "uniform mediump float _FakeSpecularIntensity_Outline;",
    "uniform mediump float _FakeSpecularPower_Outline;",
  ]);
  out = out
    .replace("layout(location = 0) in vec4 _11;", "in vec3 position;")
    .replace("layout(location = 2) in vec3 _99;", "in vec3 normal;")
    .replace("layout(location = 1) in vec2 _1098;", "in vec2 uv;")
    .replace(/void main\(\)\s*\{/, `void main()\n{\n    vec4 _11 = vec4(position, 1.0);\n    vec3 _99 = normal;\n    vec2 _1098 = uv;\n    mat4 _ObjectToWorld = modelMatrix;\n    mat4 _WorldToObject = inverse(modelMatrix);\n    mat4 _ViewProjection = projectionMatrix * viewMatrix;`);
  out = replaceMembers(out, "_21", mapping);
  out = out.replace(/^\s*gl_Position\.y\s*=\s*-gl_Position\.y;\s*$/m, "");
  if (/_21\._m|gl_Position\.y\s*=\s*-gl_Position\.y/.test(out)) throw new Error("vertex adaptation incomplete");
  return `${out.trimEnd()}\n`;
}

function adaptFragment(source, mapping) {
  let out = source.replace(/^#version 300 es\s*/m, "");
  out = replaceUbo(out, "_31_33", "_33", [
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
    "uniform int _UsePositionAsUV;",
    "uniform float _DiffractionIntensity2;",
    "uniform float _DiffractionPower2;",
    "uniform float _RampRepeat2;",
    "uniform float _RampSpeed2;",
    "uniform float _RampOffset2;",
    "uniform float _RampInterval2;",
    "uniform float _RemoveBase;",
    "uniform float _TiltPower2;",
    "uniform float _TiltOffset2;",
    "uniform float _TiltIntensity2;",
    "uniform vec3 _ReflectionColor;",
    "uniform float _ReflectionIntensity;",
    "uniform float _ReflectionPower;",
    "uniform float _ReflectionCenterAdjust;",
    "uniform int _RefTiltEnabled;",
    "uniform float _RefTiltPower;",
    "uniform float _RefTiltOffset;",
    "uniform float _RefTiltIntensity;",
    "uniform vec3 _FakeSpecularColor;",
    "uniform vec3 _FakeSpecularColor_Outline;",
    "uniform vec3 _DarknessColor;",
    "uniform float _DarknessOffset;",
    "uniform vec3 _OutlineColor;",
    "uniform vec4 _EmissiveColor;",
    "uniform vec3 _Rotation;",
    "uniform highp float _Tilt;",
    "uniform int uBloomOnly;",
  ]);
  out = replaceMembers(out, "_33", mapping);
  const officialTail = "    _1985.w = _9.w;";
  if (!out.includes(officialTail)) throw new Error("official primary-output tail changed");
  out = out.replace(officialTail, `${officialTail}\n    if (uBloomOnly != 0)\n    {\n        _1985 = _2004;\n    }`);
  if (/_33\._m/.test(out)) throw new Error("fragment adaptation incomplete");
  if (!/layout\(location = 1\) out highp vec4 _2004/.test(out)) throw new Error("official emissive output missing");
  return `${out.trimEnd()}\n`;
}

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

const vertexExpected = {
  ubo: { name: "_19_21", size: 224, members: [
    member("_m0", "vec4", 0, [4]), member("_m1", "vec4", 64, [4]), member("_m2", "vec4", 128, [4]),
    ...Array.from({ length: 8 }, (_, index) => member(`_m${index + 3}`, "float", 192 + index * 4)),
  ] },
  inputs: [
    { name: "_11", type: "vec4", location: 0 }, { name: "_1098", type: "vec2", location: 1 },
    { name: "_99", type: "vec3", location: 2 },
  ],
  outputs: [
    { name: "vs_TEXCOORD0", type: "vec2", location: 0 }, { name: "vs_TEXCOORD5", type: "vec2", location: 1 },
    { name: "vs_TEXCOORD1", type: "vec3", location: 2 }, { name: "vs_TEXCOORD2", type: "vec3", location: 3 },
    { name: "vs_TEXCOORD6", type: "vec4", location: 4 }, { name: "vs_TEXCOORD7", type: "vec4", location: 5 },
  ],
  textures: [],
};

const fragmentExpected = {
  ubo: { name: "_31_33", size: 368, members: [
    member("_m0", "vec3", 0), member("_m1", "vec4", 16, [4]), member("_m2", "vec4", 80, [4]),
    ...Array.from({ length: 10 }, (_, index) => member(`_m${index + 3}`, index === 9 ? "int" : "float", 144 + index * 4)),
    ...Array.from({ length: 10 }, (_, index) => member(`_m${index + 13}`, "float", 184 + index * 4)),
    member("_m23", "vec3", 224), member("_m24", "float", 236), member("_m25", "float", 240),
    member("_m26", "float", 244), member("_m27", "int", 248), member("_m28", "float", 252),
    member("_m29", "float", 256), member("_m30", "float", 260), member("_m31", "vec3", 272),
    member("_m32", "vec3", 288), member("_m33", "vec3", 304), member("_m34", "float", 316),
    member("_m35", "vec3", 320), member("_m36", "vec4", 336), member("_m37", "vec3", 352),
    member("_m38", "float", 364),
  ] },
  inputs: [
    { name: "vs_TEXCOORD0", type: "vec2", location: 0 }, { name: "vs_TEXCOORD5", type: "vec2", location: 1 },
    { name: "vs_TEXCOORD1", type: "vec3", location: 2 }, { name: "vs_TEXCOORD2", type: "vec3", location: 3 },
    { name: "vs_TEXCOORD6", type: "vec4", location: 4 }, { name: "vs_TEXCOORD7", type: "vec4", location: 5 },
  ],
  outputs: [{ name: "_1985", type: "vec4", location: 0 }, { name: "_2004", type: "vec4", location: 1 }],
  textures: [
    { name: "_13", type: "sampler2D", binding: 0 }, { name: "_291", type: "sampler2D", binding: 1 },
    { name: "_354", type: "samplerCube", binding: 2 }, { name: "_419", type: "sampler2D", binding: 3 },
    { name: "_428", type: "sampler2D", binding: 4 }, { name: "_435", type: "sampler2D", binding: 5 },
    { name: "_607", type: "sampler2D", binding: 6 }, { name: "_705", type: "sampler2D", binding: 7 },
    { name: "_719", type: "sampler2D", binding: 8 }, { name: "_862", type: "sampler2D", binding: 9 },
    { name: "_926", type: "sampler2D", binding: 10 }, { name: "_1609", type: "sampler2D", binding: 11 },
    { name: "_1775", type: "sampler2D", binding: 12 },
  ],
};

try {
  const dump = run(PYTHON, [
    "build/shaderdec/dump_shader.py", "Opaque-UR-Oklab", "opaque_ur_oklab", "--keyword", SELECTOR_KEYWORD,
    "--shaders", SHADER_ROOT, "--out", tmp,
  ], { shell: process.platform === "win32" });
  if (!/variant: _FAKESPECULARENABLED_ON \(index 1, 2 module slots\)/.test(dump)
      || !/modules 4 \| vertex 1 \| fragment 1/.test(dump)) {
    throw new Error(`unexpected official variant:\n${dump}`);
  }
  const bindings = JSON.parse(run(PYTHON, [
    "build/shaderdec/extract_variant_bindings.py", "Opaque-UR-Oklab", "--keyword", SELECTOR_KEYWORD,
    "--shaders", SHADER_ROOT,
  ], { shell: process.platform === "win32" }));
  assertEqual(bindings.selectedKeywords, SELECTED_KEYWORDS, "compiled keyword set changed");

  const vertSpv = path.join(tmp, "opaque_ur_oklab_vert.spv");
  const fragSpv = path.join(tmp, "opaque_ur_oklab_frag.spv");
  const vertReflection = JSON.parse(run(SPIRV_CROSS, [vertSpv, "--reflect"]));
  const fragReflection = JSON.parse(run(SPIRV_CROSS, [fragSpv, "--reflect"]));
  const vertInfo = assertReflection(vertReflection, vertexExpected);
  const fragInfo = assertReflection(fragReflection, fragmentExpected);
  const vglobals = bufferByPrefix(bindings, "VGlobals");
  const pglobals = bufferByPrefix(bindings, "PGlobals");
  if (vglobals.size !== vertInfo.ubo.block_size || pglobals.size !== fragInfo.ubo.block_size) {
    throw new Error("parameter blob and SPIR-V UBO sizes disagree");
  }
  assertBufferOffsets(vglobals, vertInfo.members);
  assertBufferOffsets(pglobals, fragInfo.members);
  const vertexMapping = bindingMap(vglobals, vertInfo.members);
  const fragmentMapping = bindingMap(pglobals, fragInfo.members, { unity_ObjectToWorld: "modelMatrix" });
  assertEqual(
    bindings.textures.map(({ name, binding }) => ({ name, binding })),
    fragmentExpected.textures.map((item, index) => ({ name: [
      "_MainTex", "_HologramMaskTex", "_CubeMap", "_PhaseTex", "_PhaseMaskTex", "_RampMaskTex", "_RampTex",
      "_PhaseTex2", "_RampMaskTex2", "_RampTex2", "_FakeSpecularMask", "_NormalMap2", "_ReflectionMask",
    ][index], binding: item.binding })),
    "official texture binding map changed",
  );

  const officialVert = run(SPIRV_CROSS, [vertSpv, "--version", "300", "--es"]);
  const officialFrag = run(SPIRV_CROSS, [fragSpv, "--version", "300", "--es"]);
  const outputs = {
    "opaque_ur_oklab.vert.glsl": adaptVertex(officialVert, vertexMapping),
    "opaque_ur_oklab.frag.glsl": adaptFragment(officialFrag, fragmentMapping),
    "opaque_ur_oklab_uniforms.json": `${JSON.stringify({
      shader: "Opaque-UR-Oklab",
      generated_by: "build/build-exact-opaque-ur-oklab.mjs",
      selector_keyword: SELECTOR_KEYWORD,
      selected_keywords: SELECTED_KEYWORDS,
      official_spirv_sha256: { vertex: sha256(vertSpv), fragment: sha256(fragSpv) },
      samplers: fragmentExpected.textures.map((item) => item.name),
      sampler_slots: bindings.textures.map((item) => item.name),
      compiled_texture_bindings: Object.fromEntries(bindings.textures.map(({ name, binding }) => [name, binding])),
      vertex_fields: Object.fromEntries(vglobals.fields.map(({ name, offset }) => [name, offset])),
      fragment_fields: Object.fromEntries(pglobals.fields.map(({ name, offset }) => [name, offset])),
      implicit_defaults: {
        _HologramMaskTex: "black", _CubeMap: "gray", _PhaseTex: "white", _PhaseMaskTex: "white",
        _RampMaskTex: "black", _RampTex: "black", _PhaseTex2: "white", _RampMaskTex2: "black",
        _RampTex2: "black", _FakeSpecularMask: "white", _NormalMap2: "bump", _ReflectionMask: "white",
      },
      mrt: { primary: "_1985", emissive: "_2004", webgl_bloom_route: "uBloomOnly" },
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
  console.log(`${CHECK ? "verified" : "generated"} enabled Opaque-UR-Oklab from official SPIR-V and parameter blob`);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
