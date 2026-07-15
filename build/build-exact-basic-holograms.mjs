// Generate the two basic card hologram programs directly from official Unity shader bundles.
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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pcr-basic-holograms-"));

function run(command, args, options = {}) {
  return execFileSync(command, args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...options });
}

function members(types, offsets) {
  return types.map((type, index) => ({ name: `_m${index}`, type, offset: offsets[index] }));
}

function assertEqual(actual, expected, message) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertReflection(reflection, expected) {
  const ubo = (reflection.ubos || []).find((item) => item.name === expected.ubo.name);
  if (!ubo || ubo.block_size !== expected.ubo.size) throw new Error(`${expected.ubo.name} UBO layout changed`);
  assertEqual(
    (reflection.types?.[ubo.type]?.members || []).map(({ name, type, offset }) => ({ name, type, offset })),
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

function adaptVertex(source, cfg) {
  let out = source.replace(/^#version 300 es\s*/m, "precision highp float;\nprecision highp int;\n\n");
  out = replaceUbo(out, cfg.block, cfg.owner, [
    "uniform highp vec3 cameraPosition;",
    "uniform highp mat4 modelMatrix;",
    "uniform highp mat4 viewMatrix;",
    "uniform highp mat4 projectionMatrix;",
    ...cfg.uniforms,
  ]);
  for (const [from, to] of Object.entries(cfg.attributes)) out = out.replace(from, to);
  out = out.replace(/void main\(\)\s*\{/, `void main()\n{\n${cfg.locals.join("\n")}`);
  out = replaceMembers(out, cfg.owner, cfg.mapping);
  out = out.replace(/^\s*gl_Position\.y\s*=\s*-gl_Position\.y;\s*$/m, "");
  if (new RegExp(`${cfg.owner.replace("_", "\\_")}\\._m|gl_Position\\.y\\s*=\\s*-gl_Position\\.y`).test(out)) {
    throw new Error(`${cfg.block} vertex adaptation incomplete`);
  }
  return `${out.trimEnd()}\n`;
}

function adaptFragment(source, cfg) {
  let out = source.replace(/^#version 300 es\s*/m, "");
  out = replaceUbo(out, cfg.block, cfg.owner, ["uniform highp mat4 viewMatrix;", ...cfg.uniforms]);
  out = replaceMembers(out, cfg.owner, cfg.mapping);
  if (new RegExp(`${cfg.owner.replace("_", "\\_")}\\._m`).test(out)) throw new Error(`${cfg.block} fragment adaptation incomplete`);
  for (const pattern of cfg.required) if (!pattern.test(out)) throw new Error(`${cfg.block} fragment invariant missing: ${pattern}`);
  return `${out.trimEnd()}\n`;
}

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

const programs = [
  {
    shader: "Card_Parallax_Hologram_Tuning",
    stem: "card_parallax_hologram_tuning",
    vertex: {
      block: "_21_23", owner: "_23",
      uniforms: [
        "uniform mediump float _FakeCameraHeight;", "uniform mediump float _Height;",
        "uniform mediump float _HeightPower;", "uniform mediump float _Scale;",
        "uniform int _UseUv;", "uniform int _UseMaskUv;",
      ],
      attributes: {
        "layout(location = 0) in vec4 _11;": "in vec3 position;",
        "layout(location = 1) in vec3 _86;": "in vec3 normal;",
        "layout(location = 4) in mediump vec4 _106;": "in vec4 tangent;",
        "layout(location = 2) in vec2 _306;": "in vec2 uv;",
        "layout(location = 3) in vec2 _310;": "in vec2 uv2;",
      },
      locals: [
        "    vec4 _11 = vec4(position, 1.0);", "    vec3 _86 = normal;", "    vec4 _106 = tangent;",
        "    vec2 _306 = uv;", "    vec2 _310 = uv2;", "    mat4 _ObjectToWorld = modelMatrix;",
        "    mat4 _WorldToObject = inverse(modelMatrix);", "    mat4 _ViewProjection = projectionMatrix * viewMatrix;",
      ],
      mapping: ["cameraPosition", "_ObjectToWorld", "_WorldToObject", "_ViewProjection", "_FakeCameraHeight", "_Height", "_HeightPower", "_Scale", "_UseUv", "_UseMaskUv"],
      reflection: {
        ubo: { name: "_21_23", size: 232, members: members(
          ["vec3", "vec4", "vec4", "vec4", "float", "float", "float", "float", "int", "int"],
          [0, 16, 80, 144, 208, 212, 216, 220, 224, 228],
        ) },
        inputs: [
          { name: "_11", type: "vec4", location: 0 }, { name: "_86", type: "vec3", location: 1 },
          { name: "_306", type: "vec2", location: 2 }, { name: "_310", type: "vec2", location: 3 },
          { name: "_106", type: "vec4", location: 4 },
        ],
        outputs: [
          { name: "vs_TEXCOORD0", type: "vec2", location: 0 }, { name: "vs_TEXCOORD1", type: "vec2", location: 1 },
          { name: "vs_TEXCOORD3", type: "vec3", location: 2 },
        ], textures: [],
      },
    },
    fragment: {
      block: "_14_16", owner: "_16",
      uniforms: [
        "uniform float _DiffractionIntensity;", "uniform float _DiffractionPower;", "uniform float _RampRepeat;",
        "uniform float _RampSpeed;", "uniform float _RampOffset;", "uniform float _RampInterval;", "uniform vec3 _Rotation;",
      ],
      mapping: ["viewMatrix", "_DiffractionIntensity", "_DiffractionPower", "_RampRepeat", "_RampSpeed", "_RampOffset", "_RampInterval", "_Rotation"],
      required: [/_409\.w\s*=\s*1\.0;/, /_415\s*=\s*vec4\(0\.0\);/],
      reflection: {
        ubo: { name: "_14_16", size: 108, members: members(["vec4", "float", "float", "float", "float", "float", "float", "vec3"], [0, 64, 68, 72, 76, 80, 84, 96]) },
        inputs: [
          { name: "vs_TEXCOORD0", type: "vec2", location: 0 }, { name: "vs_TEXCOORD1", type: "vec2", location: 1 },
          { name: "vs_TEXCOORD3", type: "vec3", location: 2 },
        ],
        outputs: [{ name: "_409", type: "vec4", location: 0 }, { name: "_415", type: "vec4", location: 1 }],
        textures: [
          { name: "_256", type: "sampler2D", binding: 0 }, { name: "_323", type: "sampler2D", binding: 1 },
          { name: "_382", type: "sampler2D", binding: 2 }, { name: "_397", type: "sampler2D", binding: 3 },
        ],
      },
    },
    manifest: {
      samplers: ["_256", "_323", "_382", "_397"],
      sampler_slots: ["_PhaseTex", "_RampMaskTex", "_RampTex", "_HologramMaskTex"],
      floats: ["_FakeCameraHeight", "_Height", "_HeightPower", "_Scale", "_UseUv", "_UseMaskUv", "_DiffractionIntensity", "_DiffractionPower", "_RampRepeat", "_RampSpeed", "_RampOffset", "_RampInterval"],
      colors: ["_Rotation"], mrt: { primary: "_409", secondary: "_415", secondary_value: "zero" },
    },
  },
  {
    shader: "Card_Hologram_Tuning",
    stem: "card_hologram_tuning",
    vertex: {
      block: "_20_22", owner: "_22",
      uniforms: ["uniform int _UseUv;", "uniform int _UseMaskUv;"],
      attributes: {
        "layout(location = 0) in vec4 _11;": "in vec3 position;",
        "layout(location = 2) in vec2 _99;": "in vec2 uv;",
        "layout(location = 3) in vec2 _103;": "in vec2 uv2;",
        "layout(location = 1) in vec3 _116;": "in vec3 normal;",
      },
      locals: [
        "    vec4 _11 = vec4(position, 1.0);", "    vec2 _99 = uv;", "    vec2 _103 = uv2;", "    vec3 _116 = normal;",
        "    mat4 _ObjectToWorld = modelMatrix;", "    mat4 _WorldToObject = inverse(modelMatrix);",
        "    mat4 _ViewProjection = projectionMatrix * viewMatrix;",
      ],
      mapping: ["_ObjectToWorld", "_WorldToObject", "_ViewProjection", "_UseUv", "_UseMaskUv"],
      reflection: {
        ubo: { name: "_20_22", size: 200, members: members(["vec4", "vec4", "vec4", "int", "int"], [0, 64, 128, 192, 196]) },
        inputs: [
          { name: "_11", type: "vec4", location: 0 }, { name: "_116", type: "vec3", location: 1 },
          { name: "_99", type: "vec2", location: 2 }, { name: "_103", type: "vec2", location: 3 },
        ],
        outputs: [
          { name: "vs_TEXCOORD0", type: "vec2", location: 0 }, { name: "vs_TEXCOORD1", type: "vec2", location: 1 },
          { name: "vs_TEXCOORD2", type: "vec3", location: 2 },
        ], textures: [],
      },
    },
    fragment: {
      block: "_32_34", owner: "_34",
      uniforms: [
        "uniform float _DiffractionIntensity;", "uniform float _DiffractionPower;", "uniform float _RampRepeat;",
        "uniform float _RampSpeed;", "uniform float _RampOffset;", "uniform float _RampInterval;",
        "uniform float _RampUVOffset;", "uniform float _RampUVTiltOffset;", "uniform float _RampScale;",
        "uniform float _PhaseScale;", "uniform float _RampRotate;", "uniform float _PhaseRotate;",
        "uniform float _AlphaBlend;", "uniform float _MaskPower;", "uniform float _CutOut;", "uniform vec3 _Rotation;",
        "uniform int _UseAlphaAsAlphaBlendMask;", "uniform int _UseReflectionAlpha;",
      ],
      mapping: [
        "viewMatrix", "_DiffractionIntensity", "_DiffractionPower", "_RampRepeat", "_RampSpeed", "_RampOffset",
        "_RampInterval", "_RampUVOffset", "_RampUVTiltOffset", "_RampScale", "_PhaseScale", "_RampRotate",
        "_PhaseRotate", "_AlphaBlend", "_MaskPower", "_CutOut", "_Rotation", "_UseAlphaAsAlphaBlendMask", "_UseReflectionAlpha",
      ],
      required: [/discard;/, /_680\s*=\s*vec4\(0\.0\);/],
      reflection: {
        ubo: { name: "_32_34", size: 148, members: members(
          ["vec4", ...Array(15).fill("float"), "vec3", "int", "int"],
          [0, 64, 68, 72, 76, 80, 84, 88, 92, 96, 100, 104, 108, 112, 116, 120, 128, 140, 144],
        ) },
        inputs: [
          { name: "vs_TEXCOORD0", type: "vec2", location: 0 }, { name: "vs_TEXCOORD1", type: "vec2", location: 1 },
          { name: "vs_TEXCOORD2", type: "vec3", location: 2 },
        ],
        outputs: [{ name: "_678", type: "vec4", location: 0 }, { name: "_680", type: "vec4", location: 1 }],
        textures: [
          { name: "_13", type: "sampler2D", binding: 0 }, { name: "_488", type: "sampler2D", binding: 1 },
          { name: "_386", type: "sampler2D", binding: 2 }, { name: "_458", type: "sampler2D", binding: 3 },
          { name: "_595", type: "sampler2D", binding: 4 },
        ],
      },
    },
    manifest: {
      samplers: ["_13", "_488", "_386", "_458", "_595"],
      sampler_slots: ["_HologramMaskTex", "_PhaseTex", "_RampMaskTex", "_RampTex", "_HologramFrontMaskTex"],
      floats: [
        "_UseUv", "_UseMaskUv", "_DiffractionIntensity", "_DiffractionPower", "_RampRepeat", "_RampSpeed",
        "_RampOffset", "_RampInterval", "_RampUVOffset", "_RampUVTiltOffset", "_RampScale", "_PhaseScale",
        "_RampRotate", "_PhaseRotate", "_AlphaBlend", "_MaskPower", "_CutOut", "_UseAlphaAsAlphaBlendMask", "_UseReflectionAlpha",
      ],
      colors: ["_Rotation"], mrt: { primary: "_678", secondary: "_680", secondary_value: "zero" },
    },
  },
];

try {
  const outputs = {};
  for (const program of programs) {
    const dump = run(PYTHON, [
      "build/shaderdec/dump_shader.py", program.shader, program.stem, "--shaders", SHADER_ROOT, "--out", tmp,
    ], { shell: process.platform === "win32" });
    if (!/modules 2 \| vertex 1 \| fragment 1/.test(dump)) throw new Error(`${program.shader}: unexpected module set`);
    const vertSpv = path.join(tmp, `${program.stem}_vert.spv`);
    const fragSpv = path.join(tmp, `${program.stem}_frag.spv`);
    assertReflection(JSON.parse(run(SPIRV_CROSS, [vertSpv, "--reflect"])), program.vertex.reflection);
    assertReflection(JSON.parse(run(SPIRV_CROSS, [fragSpv, "--reflect"])), program.fragment.reflection);
    outputs[`${program.stem}.vert.glsl`] = adaptVertex(run(SPIRV_CROSS, [vertSpv, "--version", "300", "--es"]), program.vertex);
    outputs[`${program.stem}.frag.glsl`] = adaptFragment(run(SPIRV_CROSS, [fragSpv, "--version", "300", "--es"]), program.fragment);
    outputs[`${program.stem}_uniforms.json`] = `${JSON.stringify({
      shader: program.shader,
      generated_by: "build/build-exact-basic-holograms.mjs",
      official_spirv_sha256: { vertex: sha256(vertSpv), fragment: sha256(fragSpv) },
      samplers: program.manifest.samplers,
      sampler_slots: program.manifest.sampler_slots,
      floats: Object.fromEntries(program.manifest.floats.map((name) => [name, name])),
      colors: Object.fromEntries(program.manifest.colors.map((name) => [name, name])),
      mrt: program.manifest.mrt,
    }, null, 2)}\n`;
  }
  fs.mkdirSync(OUT, { recursive: true });
  for (const [name, content] of Object.entries(outputs)) {
    const file = path.join(OUT, name);
    if (CHECK) {
      if (!fs.existsSync(file) || fs.readFileSync(file, "utf8") !== content) throw new Error(`${name} does not match official regeneration`);
    } else fs.writeFileSync(file, content);
  }
  console.log(`${CHECK ? "verified" : "generated"} ${programs.map((p) => p.shader).join(" + ")} from official SPIR-V`);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
