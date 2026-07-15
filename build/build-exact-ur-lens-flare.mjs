// Generate Card_UR_LensFlare from the official Unity no-keyword shader variant.
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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pcr-ur-lens-flare-"));

const OFFICIAL_BUNDLE = path.join(
  SHADER_ROOT, "Common", "CardNew", "UR", "Card_UR_LensFlare.shader_bundles",
);
const OFFICIAL_BUNDLE_SHA256 = "3acf67f49d5aed3ca0b81794c606bef5d81fdd6bb6105c665779938176bcce7a";
const OFFICIAL_SPIRV_SHA256 = {
  vertex: "2f61420487c058c59b314a1baa80bff2e88c8ce81080cd0f138dab20c44dc5dc",
  fragment: "00ca932a4760a0bbf5ed7608ec819f69a7a758bb45f0fcc7cb4b689ccd14c69f",
};
const OBSERVED_SCENES = [
  "scene.cPK_20_008900_02_HOUOUex_UR.json",
  "scene.cTR_20_000670_00_IIBUINOBAKKU_UR.json",
];

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

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function guardHash(file, expected, label) {
  const actual = sha256(file);
  if (actual !== expected) throw new Error(`${label} SHA-256 changed: expected ${expected}, got ${actual}`);
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
  "_Time", "modelMatrix", "projectionMatrix", "viewMatrix", "_TexScale", "_TexPixelsX",
  "_TexPixelsY", "_ScaleX", "_ScaleY", "_IsBack", "_BaseColor", "_BaseColorRGBIntensity",
  "_TiltThreshold", "_TiltPower", "_CornerPower", "_NotCornerOffset", "_FlickerAnimSpeed",
  "_TiltFlickerAnimSpeed", "_FlickerTimeDelay", "_FlickResultIntensityLowestPoint",
  "_ShouldDoFlicker",
];
const fragmentMapping = ["_RemoveTextureArtifact", "_EmissivePattern", "_EmissiveColor"];

function adaptVertex(source) {
  let out = source.replace(/^#version 300 es\s*/m, "precision highp float;\nprecision highp int;\n\n");
  out = replaceUbo(out, "_17_19", "_19", [
    "uniform highp float uTime;",
    "uniform highp mat4 modelMatrix;", "uniform highp mat4 projectionMatrix;",
    "uniform highp mat4 viewMatrix;", "uniform mediump float _TexScale;",
    "uniform int _TexPixelsX;", "uniform int _TexPixelsY;", "uniform highp float _ScaleX;",
    "uniform highp float _ScaleY;", "uniform int _IsBack;", "uniform mediump vec4 _BaseColor;",
    "uniform mediump float _BaseColorRGBIntensity;", "uniform mediump float _TiltThreshold;",
    "uniform mediump float _TiltPower;", "uniform highp float _CornerPower;",
    "uniform mediump float _NotCornerOffset;", "uniform highp float _FlickerAnimSpeed;",
    "uniform highp float _TiltFlickerAnimSpeed;", "uniform highp float _FlickerTimeDelay;",
    "uniform highp float _FlickResultIntensityLowestPoint;", "uniform highp float _ShouldDoFlicker;",
  ]);
  out = out
    .replace("layout(location = 0) in vec4 _915;", "layout(location = 0) in vec3 position;")
    .replace("layout(location = 1) in vec2 _81;", "layout(location = 1) in vec2 uv;")
    .replace(/void main\(\)\s*\{/, `void main()
{
    vec4 _915 = vec4(position, 1.0);
    vec2 _81 = uv;
    vec4 _Time = vec4(uTime * 0.05, uTime, uTime * 2.0, uTime * 3.0);`);
  out = replaceMembers(out, "_19", vertexMapping);
  out = out.replace(/^\s*gl_Position\.y\s*=\s*-gl_Position\.y;\s*$/gm, "");
  if (/_19\._m|gl_Position\.y\s*=\s*-gl_Position\.y/.test(out)) throw new Error("vertex adaptation incomplete");
  return `${out.trimEnd()}\n`;
}

function adaptFragment(source) {
  let out = source.replace(/^#version 300 es\s*/m, "");
  out = replaceUbo(out, "_23_25", "_25", [
    "uniform highp float _RemoveTextureArtifact;", "uniform int _EmissivePattern;",
    "uniform highp vec4 _EmissiveColor;", "uniform int uBloomOnly;",
  ]);
  out = replaceMembers(out, "_25", fragmentMapping);
  if (!out.includes("    _72 = vec4(")) throw new Error("official emissive-output tail changed");
  const close = out.lastIndexOf("\n}");
  if (close < 0) throw new Error("fragment main terminator missing");
  out = `${out.slice(0, close)}\n    if (uBloomOnly != 0)\n    {\n        _56 = _72;\n    }${out.slice(close)}`;
  if (/_25\._m/.test(out)) throw new Error("fragment adaptation incomplete");
  return `${out.trimEnd()}\n`;
}

function compiledFields(buffer) {
  return [...(buffer?.matrices || []), ...(buffer?.vectors || [])]
    .sort((a, b) => a.offset - b.offset)
    .map(({ name, offset }) => ({ name, offset }));
}

function observedSceneMaterials() {
  const publicDir = path.join(ROOT, "public");
  return OBSERVED_SCENES.flatMap((scene) => {
    const data = JSON.parse(fs.readFileSync(path.join(publicDir, scene), "utf8"));
    return Object.entries(data.materials || {})
      .filter(([, material]) => material.shader === "Card_UR_LensFlare")
      .map(([material, recipe]) => ({ scene, material, keywords: recipe.keywords || [] }));
  });
}

const vertexExpected = {
  ubo: { name: "_17_19", size: 296, members: [
    member("_m0", "vec4", 0), member("_m1", "vec4", 16, [4]),
    member("_m2", "vec4", 80, [4]), member("_m3", "vec4", 144, [4]),
    member("_m4", "float", 208), member("_m5", "int", 212), member("_m6", "int", 216),
    member("_m7", "float", 220), member("_m8", "float", 224), member("_m9", "int", 228),
    member("_m10", "vec4", 240), ...Array.from({ length: 10 }, (_, i) => member(`_m${i + 11}`, "float", 256 + i * 4)),
  ] },
  inputs: [
    { name: "_915", type: "vec4", location: 0 }, { name: "_81", type: "vec2", location: 1 },
  ],
  outputs: [
    { name: "vs_TEXCOORD0", type: "vec2", location: 0 },
    { name: "vs_TEXCOORD1", type: "vec4", location: 1 },
  ],
  textures: [{ name: "_288", type: "sampler2D", binding: 2 }],
};

const fragmentExpected = {
  ubo: { name: "_23_25", size: 32, members: [
    member("_m0", "float", 0), member("_m1", "int", 4), member("_m2", "vec4", 16),
  ] },
  inputs: [
    { name: "vs_TEXCOORD0", type: "vec2", location: 0 },
    { name: "vs_TEXCOORD1", type: "vec4", location: 1 },
  ],
  outputs: [
    { name: "_56", type: "vec4", location: 0 }, { name: "_72", type: "vec4", location: 1 },
  ],
  textures: [{ name: "_13", type: "sampler2D", binding: 0 }],
};

try {
  const observedMaterials = observedSceneMaterials();
  equal(observedMaterials.map(({ scene, material, keywords }) => ({ scene, material, keywords })), [
    {
      scene: "scene.cPK_20_008900_02_HOUOUex_UR.json",
      material: "L_UR_Pokemon_LensFlare_Back",
      keywords: [],
    },
    {
      scene: "scene.cPK_20_008900_02_HOUOUex_UR.json",
      material: "L_UR_Pokemon_LensFlare_Front",
      keywords: [],
    },
    {
      scene: "scene.cTR_20_000670_00_IIBUINOBAKKU_UR.json",
      material: "L_UR_Trainer_LensFlare_Back",
      keywords: [],
    },
    {
      scene: "scene.cTR_20_000670_00_IIBUINOBAKKU_UR.json",
      material: "L_UR_Trainer_LensFlare_Front",
      keywords: [],
    },
  ], "observed UR LensFlare scene keyword selection changed");
  guardHash(OFFICIAL_BUNDLE, OFFICIAL_BUNDLE_SHA256, "official Card_UR_LensFlare bundle");
  const dump = run(PYTHON, [
    "build/shaderdec/dump_shader.py", "Card_UR_LensFlare", "ur_lens_flare", "--no-keywords",
    "--shaders", SHADER_ROOT, "--out", tmp,
  ], { shell: process.platform === "win32" });
  if (!/variant: <none> \(index 0, 2 module slots\)/.test(dump)
      || !/modules 2 \| vertex 1 \| fragment 1/.test(dump)) {
    throw new Error(`unexpected official no-keyword module set:\n${dump}`);
  }

  const vertSpv = path.join(tmp, "ur_lens_flare_vert.spv");
  const fragSpv = path.join(tmp, "ur_lens_flare_frag.spv");
  guardHash(vertSpv, OFFICIAL_SPIRV_SHA256.vertex, "official no-keyword vertex SPIR-V");
  guardHash(fragSpv, OFFICIAL_SPIRV_SHA256.fragment, "official no-keyword fragment SPIR-V");
  reflect(vertSpv, vertexExpected);
  reflect(fragSpv, fragmentExpected);

  const variant = JSON.parse(run(PYTHON, [
    "build/shaderdec/extract_variant_bindings.py", "Card_UR_LensFlare", "--no-keywords",
    "--shaders", SHADER_ROOT,
  ], { shell: process.platform === "win32" }));
  equal({
    selectedKeywords: variant.selectedKeywords, variantIndex: variant.variantIndex,
    parameterBlobIndex: variant.parameterBlobIndex, programBlobIndex: variant.programBlobIndex,
  }, { selectedKeywords: [], variantIndex: 0, parameterBlobIndex: 0, programBlobIndex: 1 },
  "official no-keyword variant selection changed");
  equal(variant.textures.map(({ name, binding, encodedIndex, dim }) => ({ name, binding, encodedIndex, dim })), [
    { name: "_BaseMap", binding: 0, encodedIndex: 134217728, dim: 2 },
    { name: "_FlareVAT", binding: 2, encodedIndex: 67108866, dim: 2 },
  ], "official no-keyword texture bindings changed");
  equal(variant.constantBuffers.map(({ name, size }) => ({ name, size })), [
    { name: "PGlobals1657561348", size: 32 }, { name: "VGlobals1657561348", size: 296 },
  ], "official no-keyword constant buffers changed");

  const metadata = JSON.parse(run(PYTHON, ["build/extract-shader-defaults.py"], {
    shell: process.platform === "win32",
    input: JSON.stringify({ root: SHADER_ROOT, shaders: ["Card_UR_LensFlare"] }),
    stdio: ["pipe", "pipe", "pipe"],
  })).found.Card_UR_LensFlare;
  const binding = metadata.programBindings?.[0];
  equal(binding?.textures?.map(({ name, binding, dim }) => ({ name, binding, dim })), [
    { name: "_BaseMap", binding: 0, dim: 2 }, { name: "_FlareVAT", binding: 2, dim: 2 },
  ], "compiled sampler bindings changed");
  const pglobals = binding.constantBuffers.find((item) => item.name.startsWith("PGlobals"));
  const vglobals = binding.constantBuffers.find((item) => item.name.startsWith("VGlobals"));
  equal(compiledFields(vglobals), [
    { name: "_Time", offset: 0 }, { name: "unity_ObjectToWorld", offset: 16 },
    { name: "glstate_matrix_projection", offset: 80 }, { name: "unity_MatrixV", offset: 144 },
    { name: "_TexScale", offset: 208 }, { name: "_TexPixelsX", offset: 212 },
    { name: "_TexPixelsY", offset: 216 }, { name: "_ScaleX", offset: 220 },
    { name: "_ScaleY", offset: 224 }, { name: "_IsBack", offset: 228 },
    { name: "_BaseColor", offset: 240 }, { name: "_BaseColorRGBIntensity", offset: 256 },
    { name: "_TiltThreshold", offset: 260 }, { name: "_TiltPower", offset: 264 },
    { name: "_CornerPower", offset: 268 }, { name: "_NotCornerOffset", offset: 272 },
    { name: "_FlickerAnimSpeed", offset: 276 }, { name: "_TiltFlickerAnimSpeed", offset: 280 },
    { name: "_FlickerTimeDelay", offset: 284 },
    { name: "_FlickResultIntensityLowestPoint", offset: 288 },
    { name: "_ShouldDoFlicker", offset: 292 },
  ], "compiled vertex fields changed");
  equal(compiledFields(pglobals), [
    { name: "_RemoveTextureArtifact", offset: 0 }, { name: "_EmissivePattern", offset: 4 },
    { name: "_EmissiveColor", offset: 16 },
  ], "compiled fragment fields changed");

  const outputs = {
    "ur_lens_flare.vert.glsl": adaptVertex(run(SPIRV_CROSS, [vertSpv, "--version", "300", "--es"])),
    "ur_lens_flare.frag.glsl": adaptFragment(run(SPIRV_CROSS, [fragSpv, "--version", "300", "--es"])),
    "ur_lens_flare_uniforms.json": `${JSON.stringify({
      shader: "Card_UR_LensFlare",
      generated_by: "build/build-exact-ur-lens-flare.mjs",
      official_variant: {
        keywords: [], variant_index: 0, parameter_blob_index: 0, program_blob_index: 1,
        observed_materials: observedMaterials.length,
        observed_scenes: [...new Set(observedMaterials.map(({ scene }) => scene))],
      },
      official_bundle_sha256: OFFICIAL_BUNDLE_SHA256,
      official_spirv_sha256: OFFICIAL_SPIRV_SHA256,
      vertex_attributes: [
        { semantic: "position", source: "_915", type: "vec4", location: 0 },
        { semantic: "uv", source: "_81", type: "vec2", location: 1 },
      ],
      samplers: ["_13", "_288"],
      sampler_slots: ["_BaseMap", "_FlareVAT"],
      compiled_texture_bindings: { _BaseMap: 0, _FlareVAT: 2 },
      constant_buffers: {
        fragment: { name: "PGlobals1657561348", size: 32, fields: compiledFields(pglobals) },
        vertex: { name: "VGlobals1657561348", size: 296, fields: compiledFields(vglobals) },
      },
      implicit_defaults: metadata.textures,
      mrt: { primary: "_56", emissive: "_72", emissive_location: 1, webgl_bloom_route: "uBloomOnly" },
    }, null, 2)}\n`,
  };
  fs.mkdirSync(OUT, { recursive: true });
  for (const [name, content] of Object.entries(outputs)) {
    const file = path.join(OUT, name);
    if (CHECK) {
      if (!fs.existsSync(file) || fs.readFileSync(file, "utf8") !== content) {
        throw new Error(`${name} does not match official regeneration`);
      }
    } else {
      fs.writeFileSync(file, content);
    }
  }
  console.log(`${CHECK ? "verified" : "generated"} Card_UR_LensFlare no-keyword exact program from official SPIR-V`);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
