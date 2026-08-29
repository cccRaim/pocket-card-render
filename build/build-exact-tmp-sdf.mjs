// Generate the WebGL2 card TMP SDF program from the official Vulkan SPIR-V.
import assert from "node:assert/strict";
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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pcr-tmp-sdf-"));

const PINNED = {
  shader: "Lettuce/Common/Card/TextMeshPro/Distance Field (to RT)",
  bundleSha256: "5bd303380d2e26d265c1c81d8eb91a55f12d8c65415a6f1be2c163197c1fc9d2",
  shaderObjectSha256: "052c08e5bf09008a8289c65671ffa9a40be228d3f0e93709a8a5af07c591663d",
  compressedSha256: "f773c4aa156a8ea6cea1c840806ee8f270b61723ab8c36da79bbee6514c8b7e3",
  decompressedSha256: "9fe5f5c2c89921817fd6c379ba086fb55851a74418baa69706e3e356816f32b7",
  modules: {
    vertex: [12324, "328d360fe02386b01be96298b84f108f7fd0fcd2870da4aaec1c1a56c020a373"],
    fragment: [7124, "738b2fbd5864492ff81f6aafc16c02b8a564a08ff7858ac48e78d62127076d41"],
  },
};

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });
}
function hash(value) { return crypto.createHash("sha256").update(value).digest("hex"); }
function replaceOnce(source, before, after, label) {
  const at = source.indexOf(before);
  if (at < 0 || source.indexOf(before, at + before.length) >= 0) {
    throw new Error(`${label}: source pattern missing or non-unique`);
  }
  return source.slice(0, at) + after + source.slice(at + before.length);
}
function replaceUbo(source, block, owner, declarations) {
  const pattern = new RegExp(`layout\\(std140\\) uniform ${block}[\\s\\S]*?}\\s*${owner};\\s*`);
  const result = source.replace(pattern, `${declarations.join("\n")}\n\n`);
  if (result === source) throw new Error(`${block} replacement failed`);
  return result;
}
function stripVersion(source) {
  return replaceOnce(source.replace(/\r\n/g, "\n"), "#version 300 es\n", "", "GLSL version");
}

function adaptVertex(source) {
  let out = stripVersion(source);
  out = replaceUbo(out, "_23_25", "_25", [
    "uniform highp vec3 _WorldSpaceCameraPos;",
    "uniform highp vec4 _ScreenParams;",
    "uniform highp mat4 modelMatrix;",
    "uniform highp mat4 viewMatrix;",
    "uniform highp mat4 projectionMatrix;",
    "uniform highp mat4 uWorldToObject;",
    "uniform highp mat4 uEnvMatrix;",
    "uniform highp float _FaceDilate;",
    "uniform highp float _OutlineSoftness;",
    "uniform highp float _OutlineWidth;",
    "uniform highp float _WeightNormal;",
    "uniform highp float _WeightBold;",
    "uniform highp float _ScaleRatioA;",
    "uniform highp float _VertexOffsetX;",
    "uniform highp float _VertexOffsetY;",
    "uniform highp vec4 _ClipRect;",
    "uniform highp float _MaskSoftnessX;",
    "uniform highp float _MaskSoftnessY;",
    "uniform highp float _GradientScale;",
    "uniform highp float _ScaleX;",
    "uniform highp float _ScaleY;",
    "uniform highp float _PerspectiveFilter;",
    "uniform highp float _Sharpness;",
    "uniform highp vec4 _FaceTex_ST;",
    "uniform highp vec4 _OutlineTex_ST;",
  ]);
  const replacements = [
    ["_25._m0", "_WorldSpaceCameraPos"], ["_25._m1", "_ScreenParams"],
    ["_25._m2", "modelMatrix"], ["_25._m3", "uWorldToObject"],
    ["_25._m4", "projectionMatrix"], ["_25._m5", "uViewProjection"],
    ["_25._m6", "_FaceDilate"], ["_25._m7", "_OutlineSoftness"],
    ["_25._m8", "_OutlineWidth"], ["_25._m9", "uEnvMatrix"],
    ["_25._m10", "_WeightNormal"], ["_25._m11", "_WeightBold"],
    ["_25._m12", "_ScaleRatioA"], ["_25._m13", "_VertexOffsetX"],
    ["_25._m14", "_VertexOffsetY"], ["_25._m15", "_ClipRect"],
    ["_25._m16", "_MaskSoftnessX"], ["_25._m17", "_MaskSoftnessY"],
    ["_25._m18", "_GradientScale"], ["_25._m19", "_ScaleX"],
    ["_25._m20", "_ScaleY"], ["_25._m21", "_PerspectiveFilter"],
    ["_25._m22", "_Sharpness"], ["_25._m23", "_FaceTex_ST"],
    ["_25._m24", "_OutlineTex_ST"],
  ];
  for (const [before, after] of replacements.sort((a, b) => b[0].length - a[0].length)) {
    out = out.replaceAll(before, after);
  }
  out = replaceOnce(out, "layout(location = 0) in vec4 _12;", "layout(location = 0) in vec3 position;", "position input");
  out = replaceOnce(out, "layout(location = 1) in vec3 _236;", "layout(location = 1) in vec3 normal;", "normal input");
  out = replaceOnce(out, "layout(location = 2) in mediump vec4 _126;", "layout(location = 2) in mediump vec4 color;", "color input");
  out = replaceOnce(out, "layout(location = 3) in vec2 _131;", "layout(location = 3) in vec2 uv;", "atlas UV input");
  out = replaceOnce(out, "layout(location = 4) in vec2 _193;", "layout(location = 4) in vec2 uv2;", "TMP UV2 input");
  out = replaceOnce(out, "out mediump vec4 _125;", "out mediump vec4 vColor;", "color varying");
  out = out.replaceAll("_125", "vColor");
  out = replaceOnce(out, "void main()\n{", `void main()
{
    vec4 _12 = vec4(position, 1.0);
    vec3 _236 = normal;
    vec4 _126 = color;
    vec2 _131 = uv;
    vec2 _193 = uv2;
    mat4 uViewProjection = projectionMatrix * viewMatrix;`, "WebGL inputs");
  out = replaceOnce(out, "    gl_Position.y = -gl_Position.y;\n", "", "Vulkan clip Y flip");
  if (/layout\(std140\)|_25\._m|_ScreenParams\d|modelMatrix\d|gl_Position\.y\s*=\s*-gl_Position\.y/.test(out)) {
    throw new Error("vertex adaptation incomplete");
  }
  return `precision highp float;\nprecision highp int;\n\n${out.trim()}\n`;
}

function adaptFragment(source) {
  let out = stripVersion(source);
  out = replaceUbo(out, "_64_66", "_66", [
    "uniform highp vec4 _Time;",
    "uniform highp float _FaceUVSpeedX;",
    "uniform highp float _FaceUVSpeedY;",
    "uniform highp vec4 _FaceColor;",
    "uniform highp float _OutlineSoftness;",
    "uniform highp float _OutlineUVSpeedX;",
    "uniform highp float _OutlineUVSpeedY;",
    "uniform highp vec4 _OutlineColor;",
    "uniform highp float _OutlineWidth;",
    "uniform highp float _ScaleRatioA;",
  ]);
  const replacements = [
    ["_66._m0", "_Time"], ["_66._m1", "_FaceUVSpeedX"], ["_66._m2", "_FaceUVSpeedY"],
    ["_66._m3", "_FaceColor"], ["_66._m4", "_OutlineSoftness"],
    ["_66._m5", "_OutlineUVSpeedX"], ["_66._m6", "_OutlineUVSpeedY"],
    ["_66._m7", "_OutlineColor"], ["_66._m8", "_OutlineWidth"], ["_66._m9", "_ScaleRatioA"],
  ];
  for (const [before, after] of replacements) out = out.replaceAll(before, after);
  out = replaceOnce(out, "uniform mediump sampler2D _13;", "uniform mediump sampler2D _MainTex;", "atlas sampler");
  out = replaceOnce(out, "uniform mediump sampler2D _129;", "uniform mediump sampler2D _OutlineTex;", "outline sampler");
  out = replaceOnce(out, "uniform mediump sampler2D _165;", "uniform mediump sampler2D _FaceTex;", "face sampler");
  out = replaceOnce(out, "in vec4 _141;", "in mediump vec4 vColor;", "color varying");
  out = replaceOnce(out, "layout(location = 0) out vec4 _259;", "layout(location = 0) out vec4 outColor;", "color output");
  out = out.replace(/\b_13\b/g, "_MainTex").replace(/\b_129\b/g, "_OutlineTex").replace(/\b_165\b/g, "_FaceTex")
    .replace(/\b_141\b/g, "vColor").replace(/\b_259\b/g, "outColor");
  if (/layout\(std140\)|_66\._m|\b_13\b|\b_129\b|\b_165\b/.test(out)) throw new Error("fragment adaptation incomplete");
  return `${out.trim()}\n`;
}

try {
  const args = ["build/extract_official_tmp_sdf.py"];
  if (process.env.PCR_DECRYPTED_ROOT) args.push("--decrypted-root", process.env.PCR_DECRYPTED_ROOT);
  const evidence = JSON.parse(run(PYTHON, args, {
    shell: process.platform === "win32",
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
    maxBuffer: 4 * 1024 * 1024,
  }).replace(/^\uFEFF/, ""));
  assert.equal(evidence.shader.name, PINNED.shader);
  assert.equal(evidence.source.bundleSha256, PINNED.bundleSha256);
  assert.equal(evidence.source.shaderObjectSha256, PINNED.shaderObjectSha256);
  assert.equal(evidence.program.compressedSha256, PINNED.compressedSha256);
  assert.equal(evidence.program.decompressedSha256, PINNED.decompressedSha256);

  const output = {};
  const modules = {};
  for (const stage of ["vertex", "fragment"]) {
    const module = evidence.program.modules.find((item) => item.stage === stage);
    const [size, expectedHash] = PINNED.modules[stage];
    assert.equal(module.byteSize, size);
    assert.equal(module.sha256, expectedHash);
    const bytes = Buffer.from(module.spvHex, "hex");
    assert.equal(hash(bytes), expectedHash);
    const spv = path.join(tmp, `${stage}.spv`);
    fs.writeFileSync(spv, bytes);
    const glsl = run(SPIRV_CROSS, [spv, "--version", "300", "--es"]);
    output[`tmp_sdf.${stage === "vertex" ? "vert" : "frag"}.glsl`] = stage === "vertex" ? adaptVertex(glsl) : adaptFragment(glsl);
    modules[stage] = { byte_size: size, spirv_sha256: expectedHash };
  }
  output["tmp_sdf_program.json"] = `${JSON.stringify({
    shader: PINNED.shader,
    generated_by: "build/build-exact-tmp-sdf.mjs",
    official_source: {
      bundle_sha256: PINNED.bundleSha256,
      shader_object_sha256: PINNED.shaderObjectSha256,
      compressed_program_sha256: PINNED.compressedSha256,
      decompressed_program_sha256: PINNED.decompressedSha256,
    },
    official_variant: evidence.shader.selectedVariant,
    modules,
    bindings: evidence.bindings,
    webgl2_attributes: [
      { name: "position", location: 0 }, { name: "normal", location: 1 }, { name: "color", location: 2 },
      { name: "uv", location: 3 }, { name: "uv2", location: 4 },
    ],
    webgl2_adaptation: [
      "flatten exact official std140 blocks into named uniforms using serialized offsets",
      "map official TMP glyph attributes to WebGL2 locations without changing shader math",
      "map Unity object/world/view/projection matrices to Three.js uniforms",
      "remove Vulkan clip-space Y inversion",
      "rename stage interfaces and samplers without changing dataflow",
    ],
    evidence_status: "exact-static-program-and-bindings",
    runtime_boundaries: [
      "runtime-generated dynamic SDF atlas contents and sampler",
      "TMP glyph mesh positions, UV0, packed UV2 weight/scale, normals, colors, and indices",
      "per-draw resolved matrices, screen parameters, material uniforms, and Canvas state",
    ],
  }, null, 2)}\n`;

  fs.mkdirSync(OUT, { recursive: true });
  for (const [name, content] of Object.entries(output)) {
    const file = path.join(OUT, name);
    if (CHECK) {
      if (!fs.existsSync(file) || fs.readFileSync(file, "utf8") !== content) throw new Error(`${name} does not match pinned generation`);
    } else atomicWriteFileSync(file, content);
  }
  console.log(`${CHECK ? "verified" : "generated"} official TMP SDF WebGL2 program from Vulkan SPIR-V`);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
