// Generate classic frame and ShadowBox hologram programs from official Unity shader bundles.
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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pcr-classic-holograms-"));

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });
}

function member(name, type, offset, array = undefined) {
  return { name, type, offset, ...(array ? { array } : {}) };
}

function assertEqual(actual, expected, message) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
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
    "uniform highp mat4 modelMatrix;",
    "uniform highp mat4 viewMatrix;",
    "uniform highp mat4 projectionMatrix;",
  ]);
  for (const [from, to] of Object.entries(cfg.attributes)) out = out.replace(from, to);
  out = out.replace(/void main\(\)\s*\{/, `void main()\n{\n${cfg.locals.join("\n")}`);
  out = replaceMembers(out, cfg.owner, cfg.mapping);
  out = out.replace(/^\s*gl_Position\.y\s*=\s*-gl_Position\.y;\s*$/m, "");
  if (new RegExp(`${cfg.owner}\\._m|gl_Position\\.y\\s*=\\s*-gl_Position\\.y`).test(out)) {
    throw new Error(`${cfg.block} vertex adaptation incomplete`);
  }
  return `${out.trimEnd()}\n`;
}

function adaptFragment(source, cfg) {
  let out = source.replace(/^#version 300 es\s*/m, "");
  out = replaceUbo(out, cfg.block, cfg.owner, cfg.uniforms);
  out = replaceMembers(out, cfg.owner, cfg.mapping);
  if (new RegExp(`${cfg.owner}\\._m`).test(out)) throw new Error(`${cfg.block} fragment adaptation incomplete`);
  for (const pattern of cfg.required) if (!pattern.test(out)) throw new Error(`${cfg.block} fragment invariant missing: ${pattern}`);
  return `${out.trimEnd()}\n`;
}

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

const ENGINE_BINDING_NAMES = {
  _WorldSpaceCameraPos: "cameraPosition",
  unity_MatrixV: "viewMatrix",
  unity_ObjectToWorld: "_ObjectToWorld",
  unity_WorldToObject: "_WorldToObject",
  unity_MatrixVP: "_ViewProjection",
  _CutOff: "_CutOut",
};

function compiledFields(buffer) {
  return [...(buffer.matrices || []), ...(buffer.vectors || [])]
    .sort((a, b) => a.offset - b.offset)
    .map(({ name, offset }) => ({ name, offset }));
}

function assertOfficialBindings(metadata, program) {
  const pass = metadata?.programBindings?.find((item) => item.programMask === 6);
  if (!pass) throw new Error(`${program.shader}: compiled binding metadata missing`);
  assertEqual(
    pass.textures.map(({ name, binding, dim }) => ({ name, binding, dim })),
    program.samplerSlots.map((name, binding) => ({ name, binding, dim: name === "_CubeMap" ? 4 : 2 })),
    `${program.shader} compiled texture bindings changed`,
  );
  const pglobals = pass.constantBuffers.find((item) => item.name.startsWith("PGlobals"));
  const vglobals = pass.constantBuffers.find((item) => item.name.startsWith("VGlobals"));
  if (!pglobals || !vglobals) throw new Error(`${program.shader}: official constant buffers missing`);
  const pFields = compiledFields(pglobals);
  const vFields = compiledFields(vglobals);
  assertEqual(
    pFields.map(({ name, offset }) => ({ name: ENGINE_BINDING_NAMES[name] || name, offset })),
    program.fragment.mapping.map((name, index) => ({ name, offset: program.fragment.reflection.ubo.members[index].offset })),
    `${program.shader} fragment property mapping changed`,
  );
  assertEqual(
    vFields.map(({ name, offset }) => ({ name: ENGINE_BINDING_NAMES[name] || name, offset })),
    program.vertex.mapping.map((name, index) => ({ name, offset: program.vertex.reflection.ubo.members[index].offset })),
    `${program.shader} vertex property mapping changed`,
  );
  if (pglobals.size !== program.fragment.reflection.ubo.size || vglobals.size !== program.vertex.reflection.ubo.size) {
    throw new Error(`${program.shader}: metadata/reflection UBO sizes disagree`);
  }
  return pass;
}

const matrixMembers = [
  member("_m0", "vec4", 0, [4]),
  member("_m1", "vec4", 64, [4]),
  member("_m2", "vec4", 128, [4]),
];

const programs = [
  {
    shader: "Frame-Holo-Tuning",
    stem: "frame_holo_tuning",
    samplerSlots: ["_HologramMaskTex", "_BaseTex", "_CubeMap", "_PhaseTex", "_RampMaskTex", "_RampTex", "_HologramFrontMaskTex"],
    vertex: {
      block: "_19_21", owner: "_21",
      attributes: {
        "layout(location = 0) in vec4 _11;": "in vec3 position;",
        "layout(location = 2) in vec2 _100;": "in vec2 uv;",
        "layout(location = 1) in vec3 _103;": "in vec3 normal;",
      },
      locals: [
        "    vec4 _11 = vec4(position, 1.0);", "    vec2 _100 = uv;", "    vec3 _103 = normal;",
        "    mat4 _ObjectToWorld = modelMatrix;", "    mat4 _WorldToObject = inverse(modelMatrix);",
        "    mat4 _ViewProjection = projectionMatrix * viewMatrix;",
      ],
      mapping: ["_ObjectToWorld", "_WorldToObject", "_ViewProjection"],
      reflection: {
        ubo: { name: "_19_21", size: 192, members: matrixMembers },
        inputs: [
          { name: "_11", type: "vec4", location: 0 }, { name: "_103", type: "vec3", location: 1 },
          { name: "_100", type: "vec2", location: 2 },
        ],
        outputs: [
          { name: "vs_TEXCOORD0", type: "vec2", location: 0 }, { name: "vs_TEXCOORD2", type: "vec3", location: 1 },
          { name: "vs_TEXCOORD3", type: "vec3", location: 2 },
        ], textures: [],
      },
    },
    fragment: {
      block: "_31_33", owner: "_33",
      uniforms: [
        "uniform highp vec3 cameraPosition;", "uniform highp mat4 viewMatrix;",
        "uniform float _Shininess;", "uniform float _BaseColorIntensity;", "uniform float _SpecularIntensity;",
        "uniform float _DiffractionIntensity;", "uniform float _DiffractionPower;", "uniform float _RampRepeat;",
        "uniform float _RampSpeed;", "uniform float _RampOffset;", "uniform float _RampInterval;",
        "uniform float _RampUVOffset;", "uniform float _RampUVTiltOffset;", "uniform float _PhaseScale;",
        "uniform float _RampScale;", "uniform float _PhaseRotate;", "uniform float _RampRotate;",
        "uniform float _FrontMaskPower;", "uniform float _AlphaBlend;", "uniform float _MaskEmissive;",
        "uniform float _CutOut;", "uniform vec3 _Rotation;",
      ],
      mapping: [
        "cameraPosition", "viewMatrix", "_Shininess", "_BaseColorIntensity", "_SpecularIntensity",
        "_DiffractionIntensity", "_DiffractionPower", "_RampRepeat", "_RampSpeed", "_RampOffset",
        "_RampInterval", "_RampUVOffset", "_RampUVTiltOffset", "_PhaseScale", "_RampScale",
        "_PhaseRotate", "_RampRotate", "_FrontMaskPower", "_AlphaBlend", "_MaskEmissive", "_CutOut", "_Rotation",
      ],
      required: [/discard;/, /_806\s*=\s*vec4\(_91\.x,\s*_91\.y,\s*_91\.z,\s*_806\.w\)/, /_817\s*=\s*_9/],
      reflection: {
        ubo: { name: "_31_33", size: 172, members: [
          member("_m0", "vec3", 0), member("_m1", "vec4", 16, [4]),
          ...Array.from({ length: 19 }, (_, index) => member(`_m${index + 2}`, "float", 80 + index * 4)),
          member("_m21", "vec3", 160),
        ] },
        inputs: [
          { name: "vs_TEXCOORD0", type: "vec2", location: 0 }, { name: "vs_TEXCOORD2", type: "vec3", location: 1 },
          { name: "vs_TEXCOORD3", type: "vec3", location: 2 },
        ],
        outputs: [{ name: "_806", type: "vec4", location: 0 }, { name: "_817", type: "vec4", location: 1 }],
        textures: [
          { name: "_13", type: "sampler2D", binding: 0 }, { name: "_748", type: "sampler2D", binding: 1 },
          { name: "_693", type: "samplerCube", binding: 2 }, { name: "_523", type: "sampler2D", binding: 3 },
          { name: "_125", type: "sampler2D", binding: 4 }, { name: "_467", type: "sampler2D", binding: 5 },
          { name: "_767", type: "sampler2D", binding: 6 },
        ],
      },
    },
    manifest: {
      samplers: ["_13", "_748", "_693", "_523", "_125", "_467", "_767"],
      floats: [
        "_Shininess", "_BaseColorIntensity", "_SpecularIntensity", "_DiffractionIntensity", "_DiffractionPower",
        "_RampRepeat", "_RampSpeed", "_RampOffset", "_RampInterval", "_RampUVOffset", "_RampUVTiltOffset",
        "_PhaseScale", "_RampScale", "_PhaseRotate", "_RampRotate", "_FrontMaskPower", "_AlphaBlend", "_MaskEmissive", "_CutOut",
      ],
      colors: ["_Rotation"],
      aliases: { _CutOff: "_CutOut" },
      mrt: { primary: "_806", secondary: "_817", secondary_value: "alpha-only", secondary_switch: "_MaskEmissive" },
    },
  },
  {
    shader: "Opaque-Hologram_Tuning",
    stem: "opaque_shadowbox_hologram_tuning",
    samplerSlots: ["_MainTex", "_MaskTex", "_NormalMap", "_CubeMap", "_PhaseTex", "_RampTex", "_PhaseTex2", "_RampMaskTex2", "_RampTex2"],
    vertex: {
      block: "_19_21", owner: "_21",
      attributes: {
        "layout(location = 0) in vec4 _11;": "in vec3 position;",
        "layout(location = 1) in vec2 _100;": "in vec2 uv;",
        "layout(location = 2) in vec3 _113;": "in vec3 normal;",
        "layout(location = 3) in mediump vec4 _153;": "in vec4 tangent;",
      },
      locals: [
        "    vec4 _11 = vec4(position, 1.0);", "    vec2 _100 = uv;", "    vec3 _113 = normal;", "    vec4 _153 = tangent;",
        "    mat4 _ObjectToWorld = modelMatrix;", "    mat4 _WorldToObject = inverse(modelMatrix);",
        "    mat4 _ViewProjection = projectionMatrix * viewMatrix;",
      ],
      mapping: ["_ObjectToWorld", "_WorldToObject", "_ViewProjection"],
      reflection: {
        ubo: { name: "_19_21", size: 192, members: matrixMembers },
        inputs: [
          { name: "_11", type: "vec4", location: 0 }, { name: "_100", type: "vec2", location: 1 },
          { name: "_113", type: "vec3", location: 2 }, { name: "_153", type: "vec4", location: 3 },
        ],
        outputs: [
          { name: "vs_TEXCOORD0", type: "vec2", location: 0 }, { name: "vs_TEXCOORD1", type: "vec2", location: 1 },
          { name: "vs_TEXCOORD2", type: "vec3", location: 2 }, { name: "vs_TEXCOORD3", type: "vec3", location: 3 },
          { name: "vs_TEXCOORD4", type: "vec3", location: 4 }, { name: "vs_TEXCOORD5", type: "vec3", location: 5 },
        ], textures: [],
      },
    },
    fragment: {
      block: "_50_52", owner: "_52",
      uniforms: [
        "uniform highp vec3 cameraPosition;", "uniform highp mat4 viewMatrix;",
        "uniform float _DiffuseIntensity;", "uniform float _Shininess;", "uniform float _SpecularIntensity;",
        "uniform float _DiffractionPower;", "uniform float _OrientationU;", "uniform float _OrientationV;",
        "uniform float _ChangeSpeed;", "uniform float _RampOffset;", "uniform int _UsePositionAsUV;",
        "uniform int _UseOutlineNormalFilter;", "uniform highp float _OutlineNormalFilterThreshold;",
        "uniform float _DiffractionIntensity2;", "uniform float _DiffractionPower2;", "uniform float _RampRepeat2;",
        "uniform float _RampSpeed2;", "uniform float _RampOffset2;", "uniform float _RampInterval2;",
        "uniform vec3 _OutlineColor;", "uniform int _TiltEnabled;", "uniform float _TiltPower;",
        "uniform float _TiltOffset;", "uniform float _TiltIntensity;", "uniform vec3 _Rotation;",
      ],
      mapping: [
        "cameraPosition", "viewMatrix", "_DiffuseIntensity", "_Shininess", "_SpecularIntensity",
        "_DiffractionPower", "_OrientationU", "_OrientationV", "_ChangeSpeed", "_RampOffset",
        "_UsePositionAsUV", "_UseOutlineNormalFilter", "_OutlineNormalFilterThreshold", "_DiffractionIntensity2",
        "_DiffractionPower2", "_RampRepeat2", "_RampSpeed2", "_RampOffset2", "_RampInterval2", "_OutlineColor",
        "_TiltEnabled", "_TiltPower", "_TiltOffset", "_TiltIntensity", "_Rotation",
      ],
      required: [/_643\s*=\s*vec4\(_335\.x,\s*_335\.y,\s*_335\.z,\s*_643\.w\)/, /_848\s*=\s*vec4\(0\.0\)/, /^((?!discard).)*$/s],
      reflection: {
        ubo: { name: "_50_52", size: 204, members: [
          member("_m0", "vec3", 0), member("_m1", "vec4", 16, [4]),
          ...Array.from({ length: 8 }, (_, index) => member(`_m${index + 2}`, "float", 80 + index * 4)),
          member("_m10", "int", 112), member("_m11", "int", 116),
          ...Array.from({ length: 7 }, (_, index) => member(`_m${index + 12}`, "float", 120 + index * 4)),
          member("_m19", "vec3", 160), member("_m20", "int", 172),
          member("_m21", "float", 176), member("_m22", "float", 180), member("_m23", "float", 184),
          member("_m24", "vec3", 192),
        ] },
        inputs: [
          { name: "vs_TEXCOORD0", type: "vec2", location: 0 }, { name: "vs_TEXCOORD1", type: "vec2", location: 1 },
          { name: "vs_TEXCOORD2", type: "vec3", location: 2 }, { name: "vs_TEXCOORD3", type: "vec3", location: 3 },
          { name: "vs_TEXCOORD4", type: "vec3", location: 4 }, { name: "vs_TEXCOORD5", type: "vec3", location: 5 },
        ],
        outputs: [{ name: "_643", type: "vec4", location: 0 }, { name: "_848", type: "vec4", location: 1 }],
        textures: [
          { name: "_624", type: "sampler2D", binding: 0 }, { name: "_62", type: "sampler2D", binding: 1 },
          { name: "_13", type: "sampler2D", binding: 2 }, { name: "_352", type: "samplerCube", binding: 3 },
          { name: "_532", type: "sampler2D", binding: 4 }, { name: "_609", type: "sampler2D", binding: 5 },
          { name: "_742", type: "sampler2D", binding: 6 }, { name: "_685", type: "sampler2D", binding: 7 },
          { name: "_731", type: "sampler2D", binding: 8 },
        ],
      },
    },
    manifest: {
      samplers: ["_624", "_62", "_13", "_352", "_532", "_609", "_742", "_685", "_731"],
      floats: [
        "_DiffuseIntensity", "_Shininess", "_SpecularIntensity", "_DiffractionPower", "_OrientationU", "_OrientationV",
        "_ChangeSpeed", "_RampOffset", "_UsePositionAsUV", "_UseOutlineNormalFilter", "_OutlineNormalFilterThreshold",
        "_DiffractionIntensity2", "_DiffractionPower2", "_RampRepeat2", "_RampSpeed2", "_RampOffset2", "_RampInterval2",
        "_TiltEnabled", "_TiltPower", "_TiltOffset", "_TiltIntensity",
      ],
      colors: ["_OutlineColor", "_Rotation"], aliases: {},
      mrt: { primary: "_643", secondary: "_848", secondary_value: "zero" },
    },
  },
];

try {
  const metadata = JSON.parse(run(PYTHON, ["build/extract-shader-defaults.py"], {
    shell: process.platform === "win32",
    input: JSON.stringify({ root: SHADER_ROOT, shaders: programs.map((program) => program.shader) }),
    stdio: ["pipe", "pipe", "pipe"],
  })).found;
  const outputs = {};
  for (const program of programs) {
    const dump = run(PYTHON, [
      "build/shaderdec/dump_shader.py", program.shader, program.stem, "--shaders", SHADER_ROOT, "--out", tmp,
    ], { shell: process.platform === "win32" });
    if (!/modules 2 \| vertex 1 \| fragment 1/.test(dump)) throw new Error(`${program.shader}: unexpected module set`);
    const bindingPass = assertOfficialBindings(metadata[program.shader], program);
    const vertSpv = path.join(tmp, `${program.stem}_vert.spv`);
    const fragSpv = path.join(tmp, `${program.stem}_frag.spv`);
    assertReflection(JSON.parse(run(SPIRV_CROSS, [vertSpv, "--reflect"])), program.vertex.reflection);
    assertReflection(JSON.parse(run(SPIRV_CROSS, [fragSpv, "--reflect"])), program.fragment.reflection);
    outputs[`${program.stem}.vert.glsl`] = adaptVertex(run(SPIRV_CROSS, [vertSpv, "--version", "300", "--es"]), program.vertex);
    outputs[`${program.stem}.frag.glsl`] = adaptFragment(run(SPIRV_CROSS, [fragSpv, "--version", "300", "--es"]), program.fragment);
    outputs[`${program.stem}_uniforms.json`] = `${JSON.stringify({
      shader: program.shader,
      generated_by: "build/build-exact-classic-holograms.mjs",
      official_spirv_sha256: { vertex: sha256(vertSpv), fragment: sha256(fragSpv) },
      samplers: program.manifest.samplers,
      sampler_slots: program.samplerSlots,
      compiled_texture_bindings: Object.fromEntries(bindingPass.textures.map(({ name, binding }) => [name, binding])),
      compiled_property_aliases: program.manifest.aliases,
      floats: Object.fromEntries(program.manifest.floats.map((name) => [name, name])),
      colors: Object.fromEntries(program.manifest.colors.map((name) => [name, name])),
      implicit_defaults: { _CubeMap: "gray" },
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
  console.log(`${CHECK ? "verified" : "generated"} ${programs.map((program) => program.shader).join(" + ")} from official SPIR-V and compiled bindings`);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
