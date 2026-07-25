// Generate classic frame and ShadowBox hologram programs from official Unity shader bundles.
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  canonicalJsonSha256,
  compileCommonBindings,
  compileOfficialPassContract,
  joinSamplerBindings,
  runCommand,
  sha256,
  sha256File,
  withExtractedSelectorProgram,
  writeOrCheckOutputs,
} from "./exact-selector-port-core.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHADER_ROOT = process.env.PCR_SHADERS
  || "D:/DevProjectes/ptcgp-tools-master/masterdata_decoder/.output/decrypted/Common/Shader";
const SPIRV_CROSS = process.env.SPIRV_CROSS || "spirv-cross";
const OUT = path.join(ROOT, "public", "shaders");
const CHECK = process.argv.includes("--check") || process.env.PCR_EXACT_CHECK === "1";

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

const matrixMembers = [
  member("_m0", "vec4", 0, [4]),
  member("_m1", "vec4", 64, [4]),
  member("_m2", "vec4", 128, [4]),
];

const programs = [
  {
    shader: "Frame-Holo-Tuning",
    stem: "frame_holo_tuning",
    selector: {
      selectorId: "bafdb2df6a2b5f7ba30d7940ca995a21e61b7c84d85f24645a835d1ce4d36292",
      candidateWitnessId: "0ef6f9b87baee73555ff44ac36da4c06e7d1bc97763009fd107af70c438cb883",
      proofGraphSha256: "9862f63e11f359ed3b92b0191d21a2b6520de5a37159fd14612bdaf1908396b0",
      portIndexSha256: "30bc4d0eab1c1ad82147e880c642cbd8fba6d55cbd2227c2aa78f082f14e7e3f",
      spirvCrossSha256: {
        vertex: "88fc3caeeb669e813b29695973eabb9c8c2d26ef3e5366f84cf3e5f4c47bb319",
        fragment: "2198f4519354a1789cdda51e3f78a208ae58114de6a9564cdb93610f3f4ddc08",
      },
    },
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
      ints: [],
      aliases: { _CutOff: "_CutOut" },
      mrt: { primary: "_806", secondary: "_817", secondary_value: "alpha-only", secondary_switch: "_MaskEmissive" },
    },
    runtime: {
      attributes: { position: "vec3", normal: "vec3", uv: "vec2" },
      vertexSubstitutions: [
        "position location 0 := vec4(three.position, 1.0)",
        "normal location 1 := three.normal",
        "UV0 location 2 := three.uv",
      ],
    },
  },
  {
    shader: "Opaque-Hologram_Tuning",
    stem: "opaque_shadowbox_hologram_tuning",
    selector: {
      selectorId: "679871d58b95523eaa3f25c7d6740ba099755a16a8e0fbfb5b7271cb592b7d64",
      candidateWitnessId: "0543da854f45effa6f1ab2679ccdf6dfc0a04ff851e8d5b57c996ef7b2a5dd42",
      proofGraphSha256: "9862f63e11f359ed3b92b0191d21a2b6520de5a37159fd14612bdaf1908396b0",
      portIndexSha256: "30bc4d0eab1c1ad82147e880c642cbd8fba6d55cbd2227c2aa78f082f14e7e3f",
      spirvCrossSha256: {
        vertex: "5e34f963caadde451581bb53fa2e861a018bfcd28dedbb37a7cec6a08a8b0934",
        fragment: "84a61b348956689ecd1cfd481ff215bf055ef8a310a9e69ff302017ac9aa6f65",
      },
    },
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
      ints: ["_UsePositionAsUV", "_UseOutlineNormalFilter", "_TiltEnabled"],
      mrt: { primary: "_643", secondary: "_848", secondary_value: "zero" },
    },
    runtime: {
      attributes: { position: "vec3", uv: "vec2", normal: "vec3", tangent: "vec4" },
      vertexSubstitutions: [
        "position location 0 := vec4(three.position, 1.0)",
        "UV0 location 1 := three.uv",
        "normal location 2 := three.normal",
        "tangent location 3 := three.tangent",
      ],
    },
  },
];

const outputs = {};
for (const program of programs) {
  await withExtractedSelectorProgram({
        selectorId: program.selector.selectorId,
        candidateWitnessId: program.selector.candidateWitnessId,
        expectedProofGraphSha256: program.selector.proofGraphSha256,
        expectedPortIndexSha256: program.selector.portIndexSha256,
        decryptedRoot: path.resolve(SHADER_ROOT, "..", ".."),
        prefix: program.stem,
        rootDir: ROOT,
        spirvCross: SPIRV_CROSS,
  }, ({ metadata: selectorMetadata, files, reflection }) => {
        assertReflection(reflection.vertex, program.vertex.reflection);
        assertReflection(reflection.fragment, program.fragment.reflection);
        assert.equal(selectorMetadata.artifacts.parameterEntry.byteSize, 100);
        assert.equal(selectorMetadata.parameterReflection.bindingClosure.constantBuffersMatch, true);

        const officialVertex = runCommand(SPIRV_CROSS, [files.vertexSpirv, "--version", "300", "--es"], { cwd: ROOT });
        const officialFragment = runCommand(SPIRV_CROSS, [files.fragmentSpirv, "--version", "300", "--es"], { cwd: ROOT });
        assert.equal(sha256(officialVertex), program.selector.spirvCrossSha256.vertex, `${program.shader}: vertex SPIRV-Cross shape changed`);
        assert.equal(sha256(officialFragment), program.selector.spirvCrossSha256.fragment, `${program.shader}: fragment SPIRV-Cross shape changed`);

        const vertex = adaptVertex(officialVertex, program.vertex);
        const fragment = adaptFragment(officialFragment, program.fragment);
        const bindings = compileCommonBindings(selectorMetadata.commonBindings);
        const samplerBindings = joinSamplerBindings(bindings, reflection.fragment).map(({ set, ...row }) => {
          assert.equal(set, 0, `${program.shader}: WebGL sampler port requires descriptor set 0`);
          return row;
        });
        assert.deepEqual(
          samplerBindings.map(({ slot, spirvName }) => ({ slot, spirvName })),
          program.samplerSlots.map((slot, index) => ({ slot, spirvName: program.manifest.samplers[index] })),
        );
        const adaptation = {
          schema: "pocket-card-render/webgl-stage-adaptation@1",
          backend: "Unity Vulkan SPIR-V to Three.js WebGL2",
          vertex: {
            officialSpirvSha256: sha256File(files.vertexSpirv),
            spirvCrossGlslSha256: sha256(officialVertex),
            outputSha256: sha256(vertex),
            substitutions: [
              ...program.runtime.vertexSubstitutions,
              "unity_ObjectToWorld := three.modelMatrix",
              "unity_WorldToObject := inverse(three.modelMatrix)",
              "unity_MatrixVP := three.projectionMatrix * three.viewMatrix",
              "remove Unity Vulkan clip-space Y inversion for WebGL clip space",
            ],
          },
          fragment: {
            officialSpirvSha256: sha256File(files.fragmentSpirv),
            spirvCrossGlslSha256: sha256(officialFragment),
            outputSha256: sha256(fragment),
            substitutions: ["replace serialized PGlobals UBO members with same-name Three.js uniforms"],
          },
          interfaceSha256: canonicalJsonSha256(reflection),
        };
        outputs[`${program.stem}.vert.glsl`] = vertex;
        outputs[`${program.stem}.frag.glsl`] = fragment;
        outputs[`${program.stem}_uniforms.json`] = `${JSON.stringify({
          shader: selectorMetadata.selector.shaderName,
          generated_by: "build/build-exact-classic-holograms.mjs",
          official_selector: selectorMetadata.selector,
          official_spirv_sha256: {
            vertex: sha256File(files.vertexSpirv), fragment: sha256File(files.fragmentSpirv),
          },
          official_executable_identity: selectorMetadata.identityFields,
          official_parameter_entry: {
            source_sha256: selectorMetadata.identityFields.parameterEntrySha256,
            byte_size: selectorMetadata.artifacts.parameterEntry.byteSize,
            reflection_sha256: selectorMetadata.parameterReflectionSha256,
            ...selectorMetadata.parameterReflection,
          },
          official_pass_runtime: compileOfficialPassContract(selectorMetadata.passContract, {
            sourceSha256: selectorMetadata.identityFields.passStateSha256,
            policy: {
              rtSeparateBlend: false,
              fixed: {
                zClip: { val: 1, name: null }, conservative: { val: 0, name: null },
                offsetFactor: { val: 0, name: null }, offsetUnits: { val: 0, name: null },
                alphaToMask: { val: 0, name: null }, fogMode: -1, lighting: false,
              },
            },
          }),
          official_common_bindings: {
            source_sha256: selectorMetadata.identityFields.commonBindingsSha256,
            ...bindings,
          },
          official_shader_property_defaults: selectorMetadata.shaderPropertyDefaults,
          webgl_adaptation: adaptation,
          webgl_sources: {
            vertex: `public/shaders/${program.stem}.vert.glsl`,
            fragment: `public/shaders/${program.stem}.frag.glsl`,
          },
          runtime_contract: {
            schema: "pocket-card-render/webgl-runtime-port@1",
            shader_key: program.shader,
            attributes: program.runtime.attributes,
            engine_uniforms: {
              modelMatrix: "mat4", viewMatrix: "mat4", projectionMatrix: "mat4", cameraPosition: "vec3",
            },
            material_uniforms: {
              floats: program.manifest.floats.filter((name) => !program.manifest.ints.includes(name)),
              ints: program.manifest.ints,
              vectors: Object.fromEntries(program.manifest.colors.map((name) => [name, "vec3"])),
            },
            camera_from_view: true,
            mrt_attachments: 2,
            stencil_normalization: "disable-when-always-keep",
            stencil_face_mode: "generic",
          },
          sampler_bindings: samplerBindings,
          samplers: samplerBindings.map((row) => row.spirvName),
          sampler_slots: samplerBindings.map((row) => row.slot),
          compiled_texture_bindings: Object.fromEntries(samplerBindings.map((row) => [row.slot, row.binding])),
          compiled_property_aliases: program.manifest.aliases,
          floats: Object.fromEntries(program.manifest.floats.map((name) => [name, name])),
          colors: Object.fromEntries(program.manifest.colors.map((name) => [name, name])),
          implicit_defaults: { _CubeMap: "gray" },
          mrt: program.manifest.mrt,
        }, null, 2)}\n`;
  });
}
writeOrCheckOutputs(outputs, { outDir: OUT, check: CHECK });
console.log(`${CHECK ? "verified" : "generated"} ${programs.map((program) => program.shader).join(" + ")} from selector-bound official SPIR-V`);
