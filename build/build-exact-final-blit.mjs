// Generate the WebGL2 FinalBlit program from the APKM-backed official SPIR-V.
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "public", "shaders");
const PYTHON = process.env.PYTHON || "python";
const SPIRV_CROSS = process.env.SPIRV_CROSS || "spirv-cross";
const CHECK = process.argv.includes("--check") || process.env.PCR_EXACT_CHECK === "1";
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pcr-final-blit-"));

const PINNED = {
  source: {
    apkmSha256: "9b7f9067e00a54f342bd4f17e669ceeb86b80bb7d34ff2d0d0fe82050a62f201",
    baseApkSha256: "815dc606f3b3e3404199fac80abb46b9249948828178a5cbf6aedb3d9e6809de",
    globalgamemanagersSha256: "5a1ca51ec16b267710479b85e33bfe150c4aab255e9716fd33d51ce7a33ea017",
  },
  resourceManager: {
    pathId: 13,
    rawSha256: "878c096d7143ee90722194d5df2e12b22705c854e5cd608152062c8b97f5ec20",
  },
  material: {
    file: "8bdac87d3d839054ab63a0e27b5cc251",
    fileSha256: "a0a61863fbf3b3e11e7a335418ed97ab8466745d34d7d23cd7b12172e67febca",
    assetSha256: "d6166008a65009b47b380903da01ee7939daf1d3d3f210f11f25d2b8b09fa0ad",
  },
  shader: {
    name: "Rendering/CustomRenderer/Blit",
    file: "de5cbc5999435ca42a6ca06a2e0d1257",
    fileSha256: "38f0953ac0ec342ba844fa95f65c44cf41d264940f5d57b2cead96121f55ea62",
    assetSha256: "00448b294fe2745dc4ed51d04aa73a39baf7c885096767414553d36dd4b228b8",
  },
  program: {
    compressedSha256: "891d50a834912ef0337cf0362c5400bccf106f75294a8d7dd44de8e12c226d6f",
    decompressedSha256: "76d69f275d961c7db9c747cbc4f1e389df960b214cf0006e627619f6e0fa3527",
    parameterSha256: "d2fc3f4d9880e4454b5c8226151de2b34031a5051de90ea3e462a284957c8da7",
    programSha256: "81d397323ea0e0067c12c12730d45b381cacf499563829ad04a455e0e70561d0",
  },
  modules: {
    vertex: {
      byteSize: 2128,
      spirvSha256: "a95fea7dba0fd2f084b7e1e9e9be33e13464b26ed50710a18049b7b096333c63",
      reflectionSha256: "b6fb093caf989c2bb8151410a25b1f2901af313378f1af554a3e55c151c89939",
    },
    fragment: {
      byteSize: 1056,
      spirvSha256: "d146c34d1f09e1cf8c814e410a6be8bbcdb8903c0c0c09eb71e69b44377f2397",
      reflectionSha256: "c5595def42fe04c6c8bdeb67ce037ef79e72779d0ce89747d678cbdb62cdf2dd",
    },
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

function equal(actual, expected, label) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  }
  return value;
}

function reflectionHash(reflection) {
  return sha256(JSON.stringify(stable(reflection)));
}

function replaceOnce(source, before, after, label) {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`${label}: source pattern was not found`);
  if (source.indexOf(before, first + before.length) >= 0) throw new Error(`${label}: source pattern was not unique`);
  return source.slice(0, first) + after + source.slice(first + before.length);
}

function stripVersion(source) {
  return replaceOnce(source.replace(/\r\n/g, "\n"), "#version 300 es\n", "", "GLSL version removal");
}

function adaptVertex(source) {
  let out = stripVersion(source);
  out = replaceOnce(out, `layout(std140) uniform _67_69
{
    vec4 _m0;
} _69;
`, "uniform highp vec4 _BlitScaleBias;\n", "vertex scale-bias UBO");
  out = replaceOnce(out, "out vec2 vs_TEXCOORD0;", "out highp vec2 vUv;", "vertex varying declaration");
  out = out.replace(/\bvs_TEXCOORD0\b/g, "vUv").replace(/_69\._m0/g, "_BlitScaleBias");
  out = replaceOnce(
    out,
    "    _9.x = uint(bitfieldInsert(0, gl_VertexID, 1, 1));",
    "    _9.x = (uint(gl_VertexID) & 1u) << 1u;",
    "WebGL2 unsigned vertex-ID bit extraction",
  );
  out = replaceOnce(out, "    gl_Position.y = -gl_Position.y;\n", "", "Vulkan clip-space Y flip");
  out = replaceOnce(
    out,
    "    _30.z = (-_30.y) + 1.0;",
    "    _30.z = _30.y;",
    "paired Vulkan render-target UV Y flip",
  );
  if (/layout\(std140\)|_69\.|vs_TEXCOORD0|gl_Position\.y\s*=|bitfieldInsert|\(-_30\.y\) \+ 1\.0/.test(out)) {
    throw new Error("FinalBlit vertex adaptation is incomplete");
  }
  return `precision highp float;\nprecision highp int;\n\n${out.trim()}\n`;
}

function adaptFragment(source) {
  let out = stripVersion(source);
  out = replaceOnce(out, `layout(std140) uniform _24_26
{
    highp float _m0;
} _26;
`, "uniform highp float _BlitMipLevel;\n", "fragment LOD UBO");
  out = replaceOnce(out, "uniform mediump sampler2D SPIRV_Cross_Combined;", "uniform mediump sampler2D _BlitTexture;", "combined blit sampler");
  out = replaceOnce(out, "layout(location = 0) out highp vec4 _9;", "layout(location = 0) out highp vec4 outColor;", "fragment output");
  out = replaceOnce(out, "in highp vec2 vs_TEXCOORD0;", "in highp vec2 vUv;", "fragment varying");
  out = out.replace(/\b_9\b/g, "outColor")
    .replace(/\bvs_TEXCOORD0\b/g, "vUv")
    .replace(/_26\._m0/g, "_BlitMipLevel")
    .replace(/\bSPIRV_Cross_Combined\b/g, "_BlitTexture");
  if (!out.includes("textureLod(_BlitTexture, vUv, _BlitMipLevel)")) {
    throw new Error("FinalBlit explicit LOD sample was not preserved");
  }
  if (/layout\(std140\)|_26\.|vs_TEXCOORD0|SPIRV_Cross_Combined/.test(out)) {
    throw new Error("FinalBlit fragment adaptation is incomplete");
  }
  return `${out.trim()}\n`;
}

function readEvidence() {
  return JSON.parse(run(PYTHON, ["build/extract_official_final_blit.py"], {
    maxBuffer: 4 * 1024 * 1024,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
    shell: process.platform === "win32",
  }));
}

function assertEvidence(evidence) {
  for (const [key, expected] of Object.entries(PINNED.source)) equal(evidence.source?.[key], expected, `source.${key}`);
  const chain = evidence.resourceChain;
  equal(chain.resourceManager.pathId, PINNED.resourceManager.pathId, "ResourceManager PathID");
  equal(chain.resourceManager.rawSha256, PINNED.resourceManager.rawSha256, "ResourceManager hash");
  equal(chain.resourceManager.material.pptr, { fileId: 54, pathId: 1 }, "ResourceManager Material PPtr");
  equal(chain.resourceManager.material.external.path, PINNED.material.file, "ResourceManager Material external");
  equal(chain.materialFile.sha256, PINNED.material.fileSha256, "Material file hash");
  equal(chain.materialAsset.rawSha256, PINNED.material.assetSha256, "Material asset hash");
  equal(chain.materialAsset.shaderPPtr, { fileId: 1, pathId: 1 }, "Material Shader PPtr");
  equal(chain.materialAsset.shaderExternal.path, PINNED.shader.file, "Material Shader external");
  equal(chain.resourceManager.shader.pptr, { fileId: 15, pathId: 1 }, "ResourceManager Shader PPtr");
  equal(chain.shaderFile.sha256, PINNED.shader.fileSha256, "Shader file hash");
  equal(chain.shaderAsset.name, PINNED.shader.name, "Shader name");
  equal(chain.shaderAsset.rawSha256, PINNED.shader.assetSha256, "Shader asset hash");
  const program = evidence.shaderProgram;
  equal(program.platforms, [18], "shader platforms");
  equal(program.gpuProgramType, 25, "GPU program type");
  equal(program.compressedSha256, PINNED.program.compressedSha256, "compressed program hash");
  equal(program.decompressedSha256, PINNED.program.decompressedSha256, "decompressed program hash");
  equal(program.pass.parameterEntry.sha256, PINNED.program.parameterSha256, "parameter entry hash");
  equal(program.pass.programEntry.sha256, PINNED.program.programSha256, "program entry hash");
}

try {
  const evidence = readEvidence();
  assertEvidence(evidence);
  const outputs = {};
  const manifestModules = {};

  for (const stage of ["vertex", "fragment"]) {
    const pinned = PINNED.modules[stage];
    const module = evidence.shaderProgram.pass.modules.find((item) => item.stage === stage);
    if (!module) throw new Error(`${stage} SPIR-V module is missing`);
    const bytes = Buffer.from(module.spvHex, "hex");
    equal(bytes.length, pinned.byteSize, `${stage} SPIR-V byte size`);
    equal(sha256(bytes), pinned.spirvSha256, `${stage} SPIR-V hash`);
    const spv = path.join(tmp, `final_blit.${stage}.spv`);
    fs.writeFileSync(spv, bytes);
    const reflection = JSON.parse(run(SPIRV_CROSS, [spv, "--reflect"]));
    const reflectedSha256 = reflectionHash(reflection);
    equal(reflectedSha256, pinned.reflectionSha256, `${stage} reflection hash`);
    const official = run(SPIRV_CROSS, [spv, "--version", "300", "--es"]);
    outputs[`final_blit.${stage === "vertex" ? "vert" : "frag"}.glsl`] = stage === "vertex"
      ? adaptVertex(official)
      : adaptFragment(official);
    manifestModules[stage] = {
      byte_size: pinned.byteSize,
      spirv_sha256: pinned.spirvSha256,
      reflection_sha256: reflectedSha256,
    };
  }

  outputs["final_blit_program.json"] = `${JSON.stringify({
    shader: PINNED.shader.name,
    generated_by: "build/build-exact-final-blit.mjs",
    official: {
      apkm_sha256: PINNED.source.apkmSha256,
      resource_manager_path_id: PINNED.resourceManager.pathId,
      resource_manager_sha256: PINNED.resourceManager.rawSha256,
      material_file: PINNED.material.file,
      material_file_sha256: PINNED.material.fileSha256,
      material_asset_sha256: PINNED.material.assetSha256,
      shader_file: PINNED.shader.file,
      shader_file_sha256: PINNED.shader.fileSha256,
      shader_asset_sha256: PINNED.shader.assetSha256,
      compressed_program_sha256: PINNED.program.compressedSha256,
      decompressed_program_sha256: PINNED.program.decompressedSha256,
      parameter_entry_sha256: PINNED.program.parameterSha256,
      program_entry_sha256: PINNED.program.programSha256,
    },
    modules: manifestModules,
    bindings: {
      texture: { name: "_BlitTexture", binding: 0, dimension: 2 },
      scale_bias: { name: "_BlitScaleBias", stage: "vertex", offset: 0, type: "vec4" },
      lod: { name: "_BlitMipLevel", stage: "fragment", offset: 0, type: "float", explicit_texture_lod: true },
    },
    render_state: evidence.shaderProgram.pass.renderState,
    webgl2_adaptation: [
      "flatten serialized partial UBOs into named uniforms",
      "combine the SPIR-V image and sampler as _BlitTexture",
      "express the official vertex-ID bit extraction with WebGL2-safe uint operators",
      "remove the paired Vulkan clip-space and render-target UV Y flips",
      "rename stage interface symbols without changing shader math",
    ],
  }, null, 2)}\n`;

  fs.mkdirSync(OUT, { recursive: true });
  for (const [name, content] of Object.entries(outputs)) {
    const file = path.join(OUT, name);
    if (CHECK) {
      if (!fs.existsSync(file) || fs.readFileSync(file, "utf8") !== content) {
        throw new Error(`${name} does not match pinned official FinalBlit generation`);
      }
    } else {
      fs.writeFileSync(file, content);
    }
  }
  console.log(`${CHECK ? "verified" : "generated"} official FinalBlit WebGL2 program from APKM SPIR-V`);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
