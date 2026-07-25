// Audit the official UI Default From RT source, exact Vulkan variant, WebGL2 adaptation, and link.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PYTHON = process.env.PYTHON || "python";
const SPIRV_CROSS = process.env.SPIRV_CROSS || "spirv-cross";
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pcr-audit-ui-default-rt-"));

const EXPECTED = {
  source: {
    apkm: [285917033, "9b7f9067e00a54f342bd4f17e669ceeb86b80bb7d34ff2d0d0fe82050a62f201"],
    baseApk: [43516766, "815dc606f3b3e3404199fac80abb46b9249948828178a5cbf6aedb3d9e6809de"],
    arm64Split: [56968881, "7faf449bae431dcfeda4f882ecb04290af66cc4ccfeefc620e24cac70d22fcec"],
    libil2cpp: [128218264, "3e78eedc62770fff4cb129b4b8d898950e131b710b3c099237fe20d2d34ca48e"],
    decryptedMetadata: [31429296, "bf58e06a98f9e9e05a1635f512ea432d33971bfc8280ba26df1c93e94b4f3cb9"],
  },
  material: {
    bundle: [2782, "f160b0f6ebc9773f748a9e749cf40ae48fea0be76756c78342e32a2a26610299"],
    object: ["8096372138031489333", 1020, "675cdeb44a8660bca55ba70846c391bcb182244d22956f6669d9f8eadd23d099"],
    serializedFile: "CAB-2e44d839e9c2055e1f960cfe120c1e40",
  },
  shader: {
    bundle: [27685, "6bea6c98e97bfd7d322dd8f912a9a30fa21fd0fc273e69dd69414c09627ae02e"],
    object: ["2332897728963208010", 14544, "61b9ae7be77d58e2a363ffe0ad3243356601c0a8400016de0dd5dc4bef2a109a"],
    serializedFile: "CAB-273b7969e0989fa9dbdee5c7a4238f8a",
  },
  program: {
    compressed: [10669, "d2dbc7d7dceacacdbfca36d8198d4b1d1c186f704365a1b85993ed085278cdce"],
    decompressed: [52828, "3287d2d433b57d143c797e0c6162a5fa35e7beff67a9f4166f8a9bb0290b5ed9"],
    entry: [1648, "fa69bd7b706e1b43f15ecda7144694b5832e6edcc0c254a60cea4b7cd69cbf26"],
  },
  modules: {
    vertex: [2916, "f7f9575dc16cbe21765696d9eae09674e5092db11161f7230450462f9df348c1", "bcea6eff397181895a867ac88ab99cd8ce285a6a16f791abccbcce12175c8162"],
    fragment: [2028, "af859a616200510bddda23401e28eb37b34c9871ac9eff3d5b5f5a29da49ff71", "90f3a9dd86e2c73f1d7b6b7574e445b97950f43374c65b3ec198de13234b16f7"],
  },
  generated: {
    "ui_default_from_rt.vert.glsl": "b9c2d4a22c0b39699de05142e2b82b7669a6188cc6b8648046af790816e92719",
    "ui_default_from_rt.frag.glsl": "d362f05c53a47a75178aa5490bf22f291a69f11a32eb23efca449e7950346288",
    "ui_default_from_rt_program.json": "fd9b28865749e988524ae3600c2a6196d8804be8844e7ea747ea0384c484ea45",
  },
};

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

function verifyRaw(record, expected, hexKey = "rawHex") {
  const bytes = Buffer.from(record[hexKey], "hex");
  assert.deepEqual([bytes.length, sha256(bytes)], expected);
  assert.deepEqual([record.byteSize ?? record.length, record.sha256], expected);
  return bytes;
}

function extract() {
  const args = ["build/extract_official-ui-default-from-rt.py"];
  if (process.env.PCR_APKM) args.push("--apkm", process.env.PCR_APKM);
  if (process.env.PCR_DECRYPTED_ROOT) args.push("--decrypted-root", process.env.PCR_DECRYPTED_ROOT);
  const result = spawnSync(PYTHON, args, {
    cwd: ROOT,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
    shell: process.platform === "win32",
  });
  if (result.status !== 0) throw new Error((result.stderr || result.stdout || "extractor failed").trim());
  return JSON.parse(result.stdout.replace(/^\uFEFF/, ""));
}

let browser;
try {
  const evidence = extract();
  for (const [key, expected] of Object.entries(EXPECTED.source)) {
    assert.deepEqual([evidence.source[key].byteSize, evidence.source[key].sha256], expected);
  }

  verifyRaw(evidence.material.bundle, EXPECTED.material.bundle);
  assert.equal(evidence.material.materialObject.pathId, EXPECTED.material.object[0]);
  verifyRaw(evidence.material.materialObject, EXPECTED.material.object.slice(1));
  assert.equal(evidence.material.name, "UI_Default_From_RT");
  assert.equal(evidence.material.serializedFile, EXPECTED.material.serializedFile);
  assert.deepEqual(evidence.material.shaderPPtr, { fileId: 1, pathId: EXPECTED.shader.object[0] });
  assert.deepEqual(evidence.material.savedProperties.textures._MainTex, {
    fileId: 0, pathId: "0", scale: [1, 1], offset: [0, 0],
  });

  const program = evidence.shaderProgram;
  verifyRaw(program.source.bundle, EXPECTED.shader.bundle);
  assert.equal(program.source.shaderObject.pathId, EXPECTED.shader.object[0]);
  verifyRaw(program.source.shaderObject, EXPECTED.shader.object.slice(1));
  assert.equal(program.source.serializedFile, EXPECTED.shader.serializedFile);
  assert.equal(program.shader.name, "Lettuce/Common/CardNew/UI/Default(from RT)");
  assert.deepEqual(program.selectedVariant, {
    stageMetadata: "progVertex", groupIndex: 3, variantIndex: 0,
    keywordIndices: [], keywords: [], parameterBlobIndex: 0, programBlobIndex: 8,
    gpuProgramType: 25, shaderRequirements: 1,
  });
  verifyRaw(program.programBlock.compressed, EXPECTED.program.compressed);
  verifyRaw(program.programBlock.decompressed, EXPECTED.program.decompressed);
  assert.deepEqual(
    [program.programBlock.entries[8].length, program.programBlock.entries[8].sha256],
    EXPECTED.program.entry,
  );
  assert.deepEqual(program.bindings.commonTextures, [{
    name: "_MainTex", binding: 0, encodedIndex: 134217728, samplerIndex: -1,
    dimension: 2, multisampled: false, source: "common",
  }]);

  for (const stage of ["vertex", "fragment"]) {
    const module = program.modules.find((item) => item.stage === stage);
    assert.ok(module, `${stage} module missing`);
    const [size, spvHash, reflectionHash] = EXPECTED.modules[stage];
    const bytes = Buffer.from(module.spvHex, "hex");
    assert.deepEqual([bytes.length, module.byteSize, sha256(bytes), module.sha256], [size, size, spvHash, spvHash]);
    const spv = path.join(tmp, `${stage}.spv`);
    fs.writeFileSync(spv, bytes);
    const reflection = JSON.parse(execFileSync(SPIRV_CROSS, [spv, "--reflect"], { encoding: "utf8" }));
    assert.equal(sha256(JSON.stringify(stable(reflection))), reflectionHash);
  }

  assert.deepEqual(evidence.derived.fragmentDataFlow, {
    tint: "vertexColor * _Color",
    uv: "uv0 * _MainTex_ST.xy + _MainTex_ST.zw",
    rgb: "(sample.rgb + _TextureSampleAdd.rgb) * tint.rgb * tint.a",
    alpha: "(1.0 - sample.a) * tint.a",
    mrt1: "vec4(0.0)",
  });
  assert.deepEqual(evidence.derived.renderBlend, {
    source: "One", destination: "OneMinusSrcAlpha", sourceValue: 1, destinationValue: 10,
  });
  assert.deepEqual(Object.fromEntries([
    "_ColorMask", "_Stencil", "_StencilComp", "_StencilOp", "_StencilReadMask", "_StencilWriteMask",
  ].map((name) => [name, evidence.material.savedProperties.floats[name]])), {
    _ColorMask: 15,
    _Stencil: 0,
    _StencilComp: 8,
    _StencilOp: 0,
    _StencilReadMask: 255,
    _StencilWriteMask: 255,
  });

  execFileSync(process.execPath, ["build/build-exact-ui-default-from-rt.mjs", "--check"], {
    cwd: ROOT, stdio: "pipe", env: process.env,
  });
  const shaderDir = path.join(ROOT, "public", "shaders");
  for (const [name, hash] of Object.entries(EXPECTED.generated)) {
    assert.equal(sha256(fs.readFileSync(path.join(shaderDir, name))), hash, `${name} drifted`);
  }

  const vertex = fs.readFileSync(path.join(shaderDir, "ui_default_from_rt.vert.glsl"), "utf8");
  const fragment = fs.readFileSync(path.join(shaderDir, "ui_default_from_rt.frag.glsl"), "utf8");
  assert.match(vertex, /vec4 _82 = color;/);
  assert.match(vertex, /_9 = _82 \* _Color;/);
  assert.match(vertex, /vUv = \(_93 \* _MainTex_ST\.xy\) \+ _MainTex_ST\.zw;/);
  assert.doesNotMatch(vertex, /gl_Position\.y\s*=\s*-gl_Position\.y/);
  assert.doesNotMatch(vertex, /vUv\.y\s*=|1\.0\s*-\s*vUv\.y/);
  assert.match(fragment, /_33 = _9\.xyz \+ _TextureSampleAdd\.xyz;/);
  assert.match(fragment, /_20\.w = \(-_9\.w\) \+ 1\.0;/);
  assert.match(fragment, /_9 = _20 \* vColor\.wwww;/);
  assert.match(fragment, /outAux = vec4\(0\.0\);/);

  const manifest = JSON.parse(fs.readFileSync(path.join(shaderDir, "ui_default_from_rt_program.json"), "utf8"));
  assert.deepEqual(manifest.official_variant.keywords, []);
  assert.deepEqual(manifest.blend, evidence.derived.renderBlend);
  const serializedState = manifest.render_state.official_shaderlab_serialized;
  assert.equal(serializedState.blend.srcColor.value, 1);
  assert.equal(serializedState.blend.dstColor.value, 10);
  assert.equal(serializedState.blend.srcAlpha.value, 1);
  assert.equal(serializedState.blend.dstAlpha.value, 10);
  assert.match(manifest.render_state.interpretation.dynamic_property_rule, /placeholder, not the resolved runtime/);
  assert.deepEqual(manifest.render_state.dynamic_properties.color_mask, {
    shaderlab_path: "blend.colorMask",
    property: "_ColorMask",
    shaderlab_serialized_placeholder: 0,
    material_serialized_default: 15,
    runtime_resolved_value: null,
    status: "runtime-unproved",
    warning: "Resolve the named property for the actual Canvas draw; never use shaderlab_serialized_placeholder as fixed-function state.",
  });
  assert.equal(manifest.render_state.dynamic_properties.depth_test.property, "unity_GUIZTestMode");
  assert.equal(manifest.render_state.dynamic_properties.depth_test.material_serialized_default, null);
  assert.equal(manifest.render_state.dynamic_properties.stencil_reference.material_serialized_default, 0);
  assert.equal(manifest.render_state.dynamic_properties.stencil_compare.material_serialized_default, 8);
  assert.equal(manifest.render_state.dynamic_properties.stencil_read_mask.material_serialized_default, 255);
  assert.equal(manifest.render_state.dynamic_properties.stencil_write_mask.material_serialized_default, 255);
  assert.deepEqual(manifest.runtime_boundaries.map(({ id, status }) => [id, status]), [
    ["dynamic-color-mask-runtime-value", "unproved"],
    ["dynamic-ztest-runtime-value", "unproved"],
    ["dynamic-stencil-runtime-values", "unproved"],
  ]);
  for (const boundary of manifest.runtime_boundaries) {
    assert.ok(manifest.unproved.some(({ id }) => id === boundary.id), `${boundary.id} missing from unproved`);
  }
  assert.deepEqual(manifest.mrt.secondary, { name: "outAux", location: 1, value: "vec4(0.0)" });
  assert.ok(manifest.webgl2_adaptation.includes("remove the Vulkan clip-space Y flip"));
  assert.ok(manifest.webgl2_adaptation.includes("preserve the official UV transform without adding a texture-coordinate flip"));

  browser = await chromium.launch({
    args: ["--enable-unsafe-swiftshader", "--use-gl=angle", "--use-angle=swiftshader", "--ignore-gpu-blocklist"],
  });
  const page = await browser.newPage();
  const runtime = await page.evaluate(({ vert, frag }) => {
    const canvas = document.createElement("canvas");
    canvas.width = 4;
    canvas.height = 4;
    const gl = canvas.getContext("webgl2", { alpha: true, antialias: false, depth: false, stencil: false });
    if (!gl) throw new Error("WebGL2 unavailable");
    gl.disable(gl.DITHER);
    const compile = (type, source) => {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, `#version 300 es\n${source}`);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
      return shader;
    };
    const shaderProgram = gl.createProgram();
    gl.attachShader(shaderProgram, compile(gl.VERTEX_SHADER, vert));
    gl.attachShader(shaderProgram, compile(gl.FRAGMENT_SHADER, frag));
    gl.linkProgram(shaderProgram);
    if (!gl.getProgramParameter(shaderProgram, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(shaderProgram));
    gl.useProgram(shaderProgram);

    const bindAttribute = (location, size, values) => {
      const buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(values), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0);
    };
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    bindAttribute(0, 3, [-1, -1, 0, 1, -1, 0, -1, 1, 0, 1, 1, 0]);
    bindAttribute(1, 4, [
      0.8, 0.6, 0.5, 0.75, 0.8, 0.6, 0.5, 0.75,
      0.8, 0.6, 0.5, 0.75, 0.8, 0.6, 0.5, 0.75,
    ]);
    bindAttribute(2, 2, [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5]);

    const identity = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    for (const name of ["modelMatrix", "viewMatrix", "projectionMatrix"]) {
      gl.uniformMatrix4fv(gl.getUniformLocation(shaderProgram, name), false, identity);
    }
    gl.uniform4f(gl.getUniformLocation(shaderProgram, "_Color"), 0.5, 0.75, 0.8, 0.8);
    gl.uniform4f(gl.getUniformLocation(shaderProgram, "_MainTex_ST"), 0.5, 0.5, 0.5, 0.0);
    gl.uniform4f(gl.getUniformLocation(shaderProgram, "_TextureSampleAdd"), 0.1, 0.05, 0.2, 0.9);

    const source = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, source);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 2, 2, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([
      10, 20, 30, 64, 40, 50, 60, 128,
      70, 80, 90, 192, 100, 110, 120, 224,
    ]));
    gl.uniform1i(gl.getUniformLocation(shaderProgram, "_MainTex"), 0);

    const framebuffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    const attachments = [0, 1].map((index) => {
      const texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 4, 4, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + index, gl.TEXTURE_2D, texture, 0);
      return texture;
    });
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, source);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error("MRT framebuffer incomplete");
    gl.viewport(0, 0, 4, 4);

    const read = (index) => {
      const pixel = new Uint8Array(4);
      gl.readBuffer(gl.COLOR_ATTACHMENT0 + index);
      gl.readPixels(2, 2, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
      return Array.from(pixel);
    };
    const draw = () => gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    const toByte = (value) => Math.round(Math.min(1, Math.max(0, value)) * 255);
    const sample = [40 / 255, 50 / 255, 60 / 255, 128 / 255];
    const tint = [0.8 * 0.5, 0.6 * 0.75, 0.5 * 0.8, 0.75 * 0.8];
    const sourceFloat = [
      (sample[0] + 0.1) * tint[0] * tint[3],
      (sample[1] + 0.05) * tint[1] * tint[3],
      (sample[2] + 0.2) * tint[2] * tint[3],
      (1 - sample[3]) * tint[3],
    ];

    gl.disable(gl.BLEND);
    gl.clearBufferfv(gl.COLOR, 0, new Float32Array([0, 0, 0, 0]));
    gl.clearBufferfv(gl.COLOR, 1, new Float32Array([0.25, 0.5, 0.75, 1]));
    draw();
    const semantic = read(0);
    const auxiliary = read(1);

    gl.clearBufferfv(gl.COLOR, 0, new Float32Array([0.2, 0.3, 0.4, 0.5]));
    const destination = read(0);
    gl.enable(gl.BLEND);
    gl.blendEquationSeparate(gl.FUNC_ADD, gl.FUNC_ADD);
    gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    draw();
    const blended = read(0);
    const destinationFloat = destination.map((value) => value / 255);
    const blendedFloat = sourceFloat.map((value, index) => value + destinationFloat[index] * (1 - sourceFloat[3]));
    const error = gl.getError();
    return {
      linked: {
        attributes: ["position", "color", "uv"].map((name) => [name, gl.getAttribLocation(shaderProgram, name)]),
        uniforms: ["modelMatrix", "viewMatrix", "projectionMatrix", "_Color", "_MainTex_ST", "_TextureSampleAdd", "_MainTex"]
          .map((name) => [name, gl.getUniformLocation(shaderProgram, name) !== null]),
        outputs: [gl.getFragDataLocation(shaderProgram, "outColor"), gl.getFragDataLocation(shaderProgram, "outAux")],
      },
      semantic,
      semanticExpected: sourceFloat.map(toByte),
      auxiliary,
      destination,
      blended,
      blendedExpected: blendedFloat.map(toByte),
      blendState: {
        srcRgb: gl.getParameter(gl.BLEND_SRC_RGB),
        dstRgb: gl.getParameter(gl.BLEND_DST_RGB),
        srcAlpha: gl.getParameter(gl.BLEND_SRC_ALPHA),
        dstAlpha: gl.getParameter(gl.BLEND_DST_ALPHA),
        equationRgb: gl.getParameter(gl.BLEND_EQUATION_RGB),
        equationAlpha: gl.getParameter(gl.BLEND_EQUATION_ALPHA),
        ONE: gl.ONE,
        ONE_MINUS_SRC_ALPHA: gl.ONE_MINUS_SRC_ALPHA,
        FUNC_ADD: gl.FUNC_ADD,
      },
      error,
    };
  }, { vert: vertex, frag: fragment });
  assert.deepEqual(runtime.linked, {
    attributes: [["position", 0], ["color", 1], ["uv", 2]],
    uniforms: [
      ["modelMatrix", true], ["viewMatrix", true], ["projectionMatrix", true],
      ["_Color", true], ["_MainTex_ST", true], ["_TextureSampleAdd", true], ["_MainTex", true],
    ],
    outputs: [0, 1],
  });
  const assertBytesNear = (actual, expected, label, tolerance = 2) => {
    assert.equal(actual.length, expected.length, `${label} channel count`);
    actual.forEach((value, index) => {
      assert.ok(Math.abs(value - expected[index]) <= tolerance, `${label}[${index}]: expected ${expected[index]} +/- ${tolerance}, got ${value}`);
    });
  };
  assertBytesNear(runtime.semantic, runtime.semanticExpected, "shader output");
  assert.deepEqual(runtime.auxiliary, [0, 0, 0, 0]);
  assertBytesNear(runtime.blended, runtime.blendedExpected, "blended output", 3);
  assert.deepEqual(runtime.blendState, {
    srcRgb: runtime.blendState.ONE,
    dstRgb: runtime.blendState.ONE_MINUS_SRC_ALPHA,
    srcAlpha: runtime.blendState.ONE,
    dstAlpha: runtime.blendState.ONE_MINUS_SRC_ALPHA,
    equationRgb: runtime.blendState.FUNC_ADD,
    equationAlpha: runtime.blendState.FUNC_ADD,
    ONE: runtime.blendState.ONE,
    ONE_MINUS_SRC_ALPHA: runtime.blendState.ONE_MINUS_SRC_ALPHA,
    FUNC_ADD: runtime.blendState.FUNC_ADD,
  });
  assert.equal(runtime.error, 0, `WebGL error 0x${runtime.error.toString(16)}`);

  console.log("Official UI Default From RT audit OK");
  console.log("Source: pinned APKM, Material/Shader bundles and objects, program entry, SPIR-V, and reflection hashes");
  console.log("Program: empty-keyword Vulkan variant; dynamic ShaderLab placeholders separated from Material defaults and unresolved Canvas state");
  console.log("GPU draw/readPixels: vertexColor*_Color, _MainTex_ST, _TextureSampleAdd, alpha inversion, MRT1 zero, and One/OneMinusSrcAlpha verified");
  console.log("Adaptation: Vulkan clip Y removed once, texture UV unchanged; WebGL2 compile/link and deterministic execution verified");
} finally {
  await browser?.close();
  fs.rmSync(tmp, { recursive: true, force: true });
}
