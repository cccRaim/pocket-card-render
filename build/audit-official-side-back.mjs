// Audit Side&Back source bytes, exact variant, SPIR-V, WebGL2 port, and compile/link.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHADER_ROOT = process.env.PCR_SHADERS
  || "D:/DevProjectes/ptcgp-tools-master/masterdata_decoder/.output/decrypted/Common/Shader";
const PYTHON = process.env.PYTHON || "python";
const STATIC_ONLY = process.argv.includes("--static-only");

const EXPECTED = {
  source: {
    relativePath: "Common/CardNew/Card_Side_And_Back.shader_bundles",
    bundle: [19238, "d166568a7f39256e3153042d1a05acc7aa08b20ef9f868bcac763e6917f0a42f"],
    shaderObject: ["5701574008984223828", 5336, "dd79ac5f87982ad08477440bf153e66772ecdbb73050ea8346c626ff151e04a0"],
    shaderSerializedFile: "CAB-e4993e14922158e59579dd588a7a33d2",
    materials: [
      {
        relativePath: "Common/CardNew/Common/Model/Materials/UI/L_Card_R_M.mat_bundles",
        name: "L_Card_R_M", serializedFile: "CAB-e3e6fc13be4e9cb5d35e550c0ef95a87",
        bundle: [2730, "cd05dfd098a35be800afebc4dbde9204ea223442b6810f4b14846d1d4eee910b"],
        object: ["-973451362924139007", 848, "b47f3967e18c19505587ef3e8327be430a6496394cd5bffe615d93b635c58dfe"],
        invalidKeywords: ["_EnableFog", "_MODE_NONE"], baseTexPathId: "3680672549930378084",
      },
      {
        relativePath: "Common/CardNew/Common/Model/Materials/UI/L_Card_S_M.mat_bundles",
        name: "L_Card_S_M", serializedFile: "CAB-e863b5bddb61bbca4e23f0bf9bc249cc",
        bundle: [2871, "e4bb216a52e4631a80ff6d56bea8c7a849c258106134ed2af0bdfc84a4db5101"],
        object: ["-6503822316906939454", 1084, "6d5c052bf5959067a1e4c634734888ec228ebebd9505a43e10d929f18202b770"],
        invalidKeywords: ["_MODE_NONE", "_SPECULARENABLED_ON"], baseTexPathId: "7427414079537827346",
      },
    ],
  },
  block: {
    compressed: [2459, "218c446e8a078e8bdaeec7ec260b1c5ae9bd27ec5c8538c26751d44213c8ca3e"],
    decompressed: [4388, "0c05a7e99e3da09643cc9d2b60a6ac64aeb1fed49ac81c3037ed1df22dc91a74"],
    entries: [
      [0, 52, 300, "92a981277de22c454d77d5bc2ae777882d487264c7d3acd9794e7e832027fd7f"],
      [1, 352, 700, "7df4095c5213139db3b5aadac000344273adc6ed3198d9cbdb9b808ecafb4748"],
      [2, 1052, 1512, "a6b0a0f9449739a98f57159ec6c3eaa94e7def2c70824bb8f3b57543d1a106ad"],
      [3, 2564, 1824, "5c7685b880525a404e2306204cc2304d201f13637b52d9d3edb49a589310f1f8"],
    ],
  },
  modules: {
    vertex: [2416, "215f8207c068520aa82c877d6d2a32cc7f0e46c946ee5a25729ffe2911697bae"],
    fragment: [2020, "12c4121a4fd3cc5694b21f983c40d9bd17e9ea6be3b14f797986d24502cd2370"],
  },
  generated: {
    "side_back.vert.glsl": "7c41c8505cb352dc90eaab8ea7cdea8d24261115982710d8bc96bc8f9e00993c",
    "side_back.frag.glsl": "83a26a4b597b4576ed149f9072a58154b341336fa3b8d9d2257743456e795693",
    "side_back_program.json": "110f0ed2827f010c6936f2a390efb153dd2270d6235d3790b4dcd6b4d2f7e2c3",
  },
};

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function verifyRaw(record, expectedSize, expectedHash, hexKey = "rawHex") {
  const bytes = Buffer.from(record[hexKey], "hex");
  assert.equal(bytes.length, expectedSize);
  assert.equal(record.byteSize ?? record.length, expectedSize);
  assert.equal(sha256(bytes), expectedHash);
  assert.equal(record.sha256, expectedHash);
  return bytes;
}

function extract() {
  const result = spawnSync(PYTHON, [
    "build/extract_official_side_back.py", "--shaders", SHADER_ROOT,
  ], {
    cwd: ROOT,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
    shell: process.platform === "win32",
  });
  if (result.status !== 0) throw new Error((result.stderr || result.stdout || "extractor failed").trim());
  return JSON.parse(result.stdout);
}

let browser;
try {
  const evidence = extract();
  assert.equal(evidence.source.bundleRelativePath, EXPECTED.source.relativePath);
  verifyRaw(evidence.source.bundle, ...EXPECTED.source.bundle);
  assert.equal(evidence.source.shaderObject.pathId, EXPECTED.source.shaderObject[0]);
  verifyRaw(evidence.source.shaderObject, ...EXPECTED.source.shaderObject.slice(1));
  assert.equal(evidence.source.shaderSerializedFile, EXPECTED.source.shaderSerializedFile);

  assert.equal(evidence.officialMaterials.length, EXPECTED.source.materials.length);
  for (const [material, expected] of evidence.officialMaterials.map((item, index) => (
    [item, EXPECTED.source.materials[index]]
  ))) {
    assert.equal(material.relativePath, expected.relativePath);
    assert.equal(material.name, expected.name);
    assert.equal(material.serializedFile, expected.serializedFile);
    verifyRaw(material.bundle, ...expected.bundle);
    assert.equal(material.materialObject.pathId, expected.object[0]);
    verifyRaw(material.materialObject, ...expected.object.slice(1));
    assert.deepEqual(material.shaderPPtr, { fileId: 1, pathId: EXPECTED.source.shaderObject[0] });
    assert.deepEqual(material.shaderExternal, {
      path: `archive:/${EXPECTED.source.shaderSerializedFile}/${EXPECTED.source.shaderSerializedFile}`,
      name: EXPECTED.source.shaderSerializedFile,
      guid: "00000000000000000000000000000000",
    });
    assert.deepEqual(material.validKeywords, []);
    assert.deepEqual(material.invalidKeywords, expected.invalidKeywords);
    assert.equal(material.enableInstancingVariants, true);
    assert.equal(material.customRenderQueue, -1);
    assert.deepEqual(material.disabledShaderPasses, []);
    assert.deepEqual(material.selectedProperties, {
      _CullMode: 2,
      _Blend: [0, 0, 0, 0],
      _BaseTex: { fileId: 2, pathId: expected.baseTexPathId, scale: [1, 1], offset: [0, 0] },
    });
  }

  assert.equal(evidence.shader.name, "Lettuce/Common/CardNew/Face/Side&Back");
  assert.deepEqual(evidence.shader.properties, [
    { name: "_BaseTex", type: 4, defaultValue: [0, 0, 0, 0], defaultTexture: "white" },
    { name: "_Blend", type: 0, defaultValue: [0, 0, 0, 0], defaultTexture: "" },
    { name: "_CullMode", type: 2, defaultValue: [2, 0, 0, 0], defaultTexture: "" },
  ]);
  assert.deepEqual(evidence.shader.keywordNames, [
    "STEREO_INSTANCING_ON", "UNITY_SINGLE_PASS_STEREO", "STEREO_MULTIVIEW_ON",
    "STEREO_CUBEMAP_RENDER_ON", "INSTANCING_ON",
  ]);
  assert.deepEqual(evidence.shader.keywordFlags, [0, 0, 0, 0, 0]);
  assert.deepEqual(evidence.shader.tags, { RenderType: "Opaque" });
  assert.deepEqual(
    [evidence.shader.subshaderCount, evidence.shader.passCount, evidence.shader.pass.name,
      evidence.shader.pass.type, evidence.shader.pass.programMask, evidence.shader.pass.tags],
    [1, 1, "", 0, 6, {}],
  );
  assert.deepEqual(evidence.shader.pass.renderState, {
    blend: {
      srcColor: { value: 1, property: null }, dstColor: { value: 0, property: null },
      srcAlpha: { value: 0, property: null }, dstAlpha: { value: 0, property: null },
      colorOp: { value: 0, property: null }, alphaOp: { value: 0, property: null },
      colorMask: { value: 15, property: null }, separate: false,
    },
    depth: {
      test: { value: 4, property: null }, write: { value: 1, property: null },
      clip: { value: 1, property: null },
    },
    cull: { value: 0, property: "_CullMode" },
    stencil: {
      reference: { value: 0, property: null }, readMask: { value: 255, property: null },
      writeMask: { value: 255, property: null }, compare: { value: 8, property: null },
      pass: { value: 0, property: null }, fail: { value: 0, property: null },
      depthFail: { value: 0, property: null },
    },
    alphaToMask: { value: 0, property: null },
  });

  assert.equal(evidence.programBlock.platform, 18);
  verifyRaw(evidence.programBlock.compressed, ...EXPECTED.block.compressed);
  verifyRaw(evidence.programBlock.decompressed, ...EXPECTED.block.decompressed);
  assert.deepEqual(evidence.programBlock.entries.map(({ index, offset, length, sha256: hash }) => (
    [index, offset, length, hash]
  )), EXPECTED.block.entries);
  for (const [entry, [, , length, hash]] of evidence.programBlock.entries.map((row, index) => (
    [row, EXPECTED.block.entries[index]]
  ))) {
    const bytes = Buffer.from(entry.rawHex, "hex");
    assert.equal(bytes.length, length);
    assert.equal(sha256(bytes), hash);
    assert.equal(entry.unknownWord, 0);
  }

  assert.deepEqual(evidence.compiledVariants, [
    {
      stageMetadata: "progVertex", groupIndex: 3, variantIndex: 0,
      keywordIndices: [], keywords: [], parameterBlobIndex: 0, programBlobIndex: 2,
      gpuProgramType: 25, shaderRequirements: 1101803,
    },
    {
      stageMetadata: "progVertex", groupIndex: 3, variantIndex: 1,
      keywordIndices: [4], keywords: ["INSTANCING_ON"], parameterBlobIndex: 1, programBlobIndex: 3,
      gpuProgramType: 25, shaderRequirements: 1101803,
    },
  ]);
  assert.deepEqual(evidence.selectedVariant, evidence.compiledVariants[0]);
  assert.deepEqual(evidence.runtimeVariant, evidence.compiledVariants[1]);
  assert.deepEqual(evidence.runtimeModules.map(({ stage, byteSize, sha256 }) => ({ stage, byteSize, sha256 })), [
    {
      stage: "fragment", byteSize: 2140,
      sha256: "2ca7d6a80832052d1cbd391bbbb8c59d38137a065b21f820762e27ae405b3547",
    },
    {
      stage: "vertex", byteSize: 3316,
      sha256: "5f3de58358234bd969164e05a077b9a557fc4420746acf8a882c43aa24617516",
    },
  ]);
  assert.deepEqual(evidence.baselineBindings, {
    parameterBlobIndex: 0,
    parameterEntrySha256: "92a981277de22c454d77d5bc2ae777882d487264c7d3acd9794e7e832027fd7f",
    textures: [{
      name: "_BaseTex", binding: 0, encodedIndex: 134217728, samplerIndex: -1,
      dimension: 2, multisampled: false, source: "common",
    }],
    constantBuffers: [
      { name: "", size: 0, fields: [] },
      {
        name: "PGlobals2310095155", size: 16,
        fields: [{ name: "_Blend", offset: 0, descriptor: [0, 1, 4, 0, 0, 0] }],
      },
      {
        name: "VGlobals2310095155", size: 128,
        fields: [
          { name: "unity_MatrixVP", offset: 64, descriptor: [0, 4, 4, 1, 0, 64] },
          { name: "unity_ObjectToWorld", offset: 0, descriptor: [0, 4, 4, 1, 0, 0] },
        ],
      },
    ],
    constantBufferBindings: [
      { name: "PGlobals2310095155", descriptor: [1, 134283264, 0] },
      { name: "VGlobals2310095155", descriptor: [1, 67174401, 0] },
    ],
    parameterBlobVersion: 202012090,
    parameterBlobConstantBlockCount: 3,
    parameterBlobResourceCount: 2,
    semanticBindingsAvailable: true,
    bindingAuthority: "Unity parameter entry",
  });
  assert.deepEqual(evidence.runtimeBindings, {
    parameterBlobIndex: 1,
    parameterEntrySha256: "7df4095c5213139db3b5aadac000344273adc6ed3198d9cbdb9b808ecafb4748",
    parameterEntryByteSize: 700,
    semanticBindingsAvailable: false,
    bindingAuthority: "runtime SPIR-V reflection",
  });
  assert.deepEqual(evidence.bindings, evidence.runtimeBindings);

  for (const stage of ["vertex", "fragment"]) {
    const module = evidence.modules.find((item) => item.stage === stage);
    const [size, hash] = EXPECTED.modules[stage];
    const bytes = Buffer.from(module.spvHex, "hex");
    assert.equal(module.executionModel, stage === "vertex" ? 0 : 4);
    assert.equal(module.indexInProgramEntry, stage === "vertex" ? 1 : 0);
    assert.equal(module.smolvOffset, stage === "vertex" ? 801 : 208);
    assert.equal(bytes.length, size);
    assert.equal(module.byteSize, size);
    assert.equal(sha256(bytes), hash);
    assert.equal(module.sha256, hash);
  }

  execFileSync(process.execPath, ["build/build-exact-side-back.mjs", "--check"], {
    cwd: ROOT, stdio: "pipe", env: { ...process.env, PCR_SHADERS: SHADER_ROOT },
  });
  const shaderDir = path.join(ROOT, "public", "shaders");
  for (const [name, hash] of Object.entries(EXPECTED.generated)) {
    assert.equal(sha256(fs.readFileSync(path.join(shaderDir, name))), hash, `${name} drifted`);
  }
  const vertex = fs.readFileSync(path.join(shaderDir, "side_back.vert.glsl"), "utf8");
  const fragment = fs.readFileSync(path.join(shaderDir, "side_back.frag.glsl"), "utf8");
  assert.match(vertex, /mat4 _ViewProjection = projectionMatrix \* viewMatrix;/);
  assert.match(vertex, /vs_TEXCOORD0 = _117;/);
  assert.doesNotMatch(vertex, /gl_Position\.y\s*=\s*-gl_Position\.y/);
  assert.match(fragment, /_9\.x = \(-_Blend\.w\) \+ 1\.0;/);
  assert.match(fragment, /_30 = _Blend\.www \* _Blend\.xyz;/);
  assert.match(fragment, /_40 = texture\(_BaseTex, vs_TEXCOORD0\);/);
  assert.match(fragment, /_59\.w = _40\.w;/);
  assert.match(fragment, /_67 = vec4\(0\.0\);/);

  const metadata = JSON.parse(fs.readFileSync(path.join(shaderDir, "side_back_program.json"), "utf8"));
  assert.equal(metadata.official_source.shader_object_path_id, EXPECTED.source.shaderObject[0]);
  assert.deepEqual(metadata.official_variant.keywords, ["INSTANCING_ON"]);
  assert.equal(metadata.bindings.authority, "runtime INSTANCING_ON SPIR-V reflection");
  assert.equal(metadata.bindings.parameter_blob_index, 1);
  assert.equal(metadata.bindings.parameter_entry_sha256, evidence.runtimeBindings.parameterEntrySha256);
  assert.deepEqual(metadata.bindings.vertex.ubos.map(({ name, set, binding, size }) => ({ name, set, binding, size })), [
    { name: "_78_80", set: 1, binding: 1, size: 64 },
    { name: "_12_14", set: 1, binding: 2, size: 8 },
    { name: "_38_40", set: 1, binding: 3, size: 256 },
  ]);
  assert.deepEqual(metadata.bindings.fragment.ubos.map(({ name, set, binding, size }) => ({ name, set, binding, size })), [
    { name: "_15_17", set: 1, binding: 0, size: 32 },
  ]);
  assert.deepEqual(metadata.bindings.fragment.textures, [{ name: "_44", type: "sampler2D", binding: 0 }]);
  assert.deepEqual(metadata.baseline_bindings, evidence.baselineBindings);
  assert.deepEqual(metadata.runtime_parameter_entry, evidence.runtimeBindings);
  assert.deepEqual(metadata.official_materials.map((item) => ({
    name: item.name,
    shader: item.shader_pptr.pathId,
    external: item.shader_external,
    keywords: item.valid_keywords,
    cull: item.selected_properties._CullMode,
    blend: item.selected_properties._Blend,
  })), EXPECTED.source.materials.map((item) => ({
    name: item.name,
    shader: EXPECTED.source.shaderObject[0],
    external: EXPECTED.source.shaderSerializedFile,
    keywords: [], cull: 2, blend: [0, 0, 0, 0],
  })));
  assert.deepEqual(metadata.tags, { RenderType: "Opaque" });
  assert.deepEqual(metadata.mrt, {
    primary: "_59", secondary: "_67", secondary_location: 1, secondary_value: "zero",
  });

  if (!STATIC_ONLY) {
    browser = await chromium.launch({
      args: ["--enable-unsafe-swiftshader", "--use-gl=angle", "--use-angle=swiftshader", "--ignore-gpu-blocklist"],
    });
    const page = await browser.newPage();
    const compiled = await page.evaluate(({ vert, frag }) => {
    const gl = document.createElement("canvas").getContext("webgl2");
    if (!gl) throw new Error("WebGL2 unavailable");
    const compile = (type, source) => {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, `#version 300 es\n${source}`);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
      return shader;
    };
    const program = gl.createProgram();
    gl.attachShader(program, compile(gl.VERTEX_SHADER, vert));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, frag));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
    return {
      attributes: ["position", "uv"].map((name) => [name, gl.getAttribLocation(program, name)]),
      uniforms: ["modelMatrix", "viewMatrix", "projectionMatrix", "_Blend", "_BaseTex"]
        .map((name) => [name, gl.getUniformLocation(program, name) !== null]),
      outputs: [gl.getFragDataLocation(program, "_59"), gl.getFragDataLocation(program, "_67")],
    };
    }, { vert: vertex, frag: fragment });
    assert.deepEqual(compiled, {
      attributes: [["position", 0], ["uv", 1]],
      uniforms: [
        ["modelMatrix", true], ["viewMatrix", true], ["projectionMatrix", true],
        ["_Blend", true], ["_BaseTex", true],
      ],
      outputs: [0, 1],
    });
  }

  console.log("Official Side&Back audit OK");
  console.log("Source: pinned decrypted Common/Shader bundle, Shader object, program entries, and SPIR-V modules");
  console.log("Program: captured INSTANCING_ON Vulkan variant; opaque depth-writing state; _BaseTex/_Blend exact math; MRT1 zero");
  console.log(STATIC_ONLY
    ? "Runtime: compile/link skipped by --static-only; use the existing in-app browser regression for WebGL2 validation"
    : "Runtime: generated WebGL2 vertex+fragment compile/link with attributes, uniforms, and MRT outputs active");
} finally {
  await browser?.close();
}
