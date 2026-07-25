// Audit the official UI Default To RT producer source, Vulkan candidate, WebGL2 adaptation, and execution.
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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pcr-audit-ui-default-to-rt-"));

const EXPECTED = {
  prefab: {
    bundle: [4811, "c5f994db1c7fbce505d67d6affd8c638b8701243921438d3b5d3401b4577e613"],
    serializedFile: "CAB-15f2305a747f78e1d2cde8ee8bcf2acf",
    images: [
      ["-5386704478690261615", 136, "8bb65619f11cdb8b216e069a26fc6b79be3dc87a7d6e887fd6ba196d00ffda62", "Outline"],
      ["-2805931688482683503", 136, "14783a67d674df9cb1188dad0bc35ca052a6cd21fc77103bf26a405e04665433", "icn_gra_img"],
    ],
  },
  material: {
    bundle: [2409, "f478326a8e58d1c1539ca181c93fab4302c7e37109fb30a012d4a7b7fe3fca54"],
    object: ["-5098138999901745883", 328, "11cd5b30fc3e464b84bedda43e297576dfd5c36732fc8aa85ba33597c95f3db6"],
    serializedFile: "CAB-b03ac178e097f0b5b749149090b41913",
  },
  shader: {
    bundle: [20847, "bfa614efb73e8a31da55f1fa71781b50108979dc19dd40d105f3e19a9da24198"],
    object: ["5313265162950190389", 10152, "186554d5da124466d167a320be7ee170a087bcbc9b74c0be8ee3c8315995b4b6"],
    serializedFile: "CAB-475bda97c86c2e19de716358682956e4",
  },
  program: {
    compressed: [3607, "2258f3c0a1dae1e10ca126ff269ca89c56363c68103d6c45a1f6a1fd98cdf27a"],
    decompressed: [22028, "e97366c85713a41d9ff96791e3515682fc68fe943ba8ff35761122945185c5a1"],
    parameterEntry: [388, "50c6c2d071e0c99c3f9644d1be6a8948c706783ac0ef5586fe11414369a9bb63"],
    programEntry: [1472, "49e9d4abf17db9f717c64716c155f6cf0e0be3deb093fd7b936e68eca813aed8"],
  },
  modules: {
    vertex: [2916, "f7f9575dc16cbe21765696d9eae09674e5092db11161f7230450462f9df348c1", "bcea6eff397181895a867ac88ab99cd8ce285a6a16f791abccbcce12175c8162"],
    fragment: [1320, "d57a4eb4230bbe11be4ec5fcd9f764889b7fa8506fedc185f46b3d324e97bf32", "8bd2d822fd779b34de023cd31c5264dc0b1dab86ee68c09509e4300d29bb08b7"],
  },
  generated: {
    "ui_default_to_rt.vert.glsl": "b9c2d4a22c0b39699de05142e2b82b7669a6188cc6b8648046af790816e92719",
    "ui_default_to_rt.frag.glsl": "c9a5e267a6ce3d983d0745c63faa79506097192875e1ef73cd9c19b2a18b63a6",
    "ui_default_to_rt_program.json": "a9d23109e08342b7666c4b74f31b636c178710ab3af33f6c672352081f04b489",
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
  const args = ["build/extract_official-ui-default-to-rt.py"];
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
  verifyRaw(evidence.uiImageUsage.bundle, EXPECTED.prefab.bundle);
  assert.equal(evidence.uiImageUsage.serializedFile, EXPECTED.prefab.serializedFile);
  assert.deepEqual(evidence.uiImageUsage.images.map((image) => [
    image.object.pathId, image.object.byteSize, image.object.sha256, image.gameObjectName,
  ]), EXPECTED.prefab.images);
  for (const image of evidence.uiImageUsage.images) {
    verifyRaw(image.object, EXPECTED.prefab.images.find((row) => row[0] === image.object.pathId).slice(1, 3));
    assert.deepEqual(image.materialPPtr, { fileId: 2, pathId: EXPECTED.material.object[0] });
    assert.equal(image.materialExternal.name, EXPECTED.material.serializedFile);
    assert.ok(image.imageSerializationSignature.includes("m_Sprite"));
    assert.ok(image.imageSerializationSignature.includes("m_Material"));
  }

  verifyRaw(evidence.material.bundle, EXPECTED.material.bundle);
  assert.equal(evidence.material.materialObject.pathId, EXPECTED.material.object[0]);
  verifyRaw(evidence.material.materialObject, EXPECTED.material.object.slice(1));
  assert.equal(evidence.material.name, "UI-Default-ToRT");
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
  assert.equal(program.shader.name, "Lettuce/Common/CardNew/UI/Default(to RT)");
  assert.deepEqual(program.shader.passes.map((pass) => [
    pass.subshaderIndex, pass.passIndex, pass.name, pass.compiledVariants.length,
  ]), [[0, 0, "Default", 4], [1, 0, "Alpha", 8]]);
  assert.deepEqual(Object.fromEntries(Object.entries(program.selectedProgramTarget).filter(([key]) => !["status", "reason"].includes(key))), {
    subshaderIndex: 0, passIndex: 0, stageMetadata: "progVertex", groupIndex: 3,
    variantIndex: 0, keywordIndices: [], keywords: [], parameterBlobIndex: 0,
    programBlobIndex: 4, gpuProgramType: 25, shaderRequirements: 1,
  });
  assert.equal(program.selectedProgramTarget.status, "static-candidate-not-runtime-selection");
  verifyRaw(program.programBlock.compressed, EXPECTED.program.compressed);
  verifyRaw(program.programBlock.decompressed, EXPECTED.program.decompressed);
  assert.deepEqual(
    [program.programBlock.entries[0].length, program.programBlock.entries[0].sha256],
    EXPECTED.program.parameterEntry,
  );
  assert.deepEqual(
    [program.programBlock.entries[4].length, program.programBlock.entries[4].sha256],
    EXPECTED.program.programEntry,
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
    primary: "(texture(_MainTex, uv) + _TextureSampleAdd) * tint",
    mrt1: "vec4(0.0)",
  });
  assert.deepEqual(evidence.derived.defaultPassBlend, {
    source: "SrcAlpha", destination: "OneMinusSrcAlpha", sourceValue: 5,
    destinationValue: 10, serializedSeparateBlend: false,
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

  execFileSync(process.execPath, ["build/build-exact-ui-default-to-rt.mjs", "--check"], {
    cwd: ROOT, stdio: "pipe", env: process.env,
  });
  const shaderDir = path.join(ROOT, "public", "shaders");
  for (const [name, hash] of Object.entries(EXPECTED.generated)) {
    assert.equal(sha256(fs.readFileSync(path.join(shaderDir, name))), hash, `${name} drifted`);
  }

  const vertex = fs.readFileSync(path.join(shaderDir, "ui_default_to_rt.vert.glsl"), "utf8");
  const fragment = fs.readFileSync(path.join(shaderDir, "ui_default_to_rt.frag.glsl"), "utf8");
  assert.match(vertex, /vec4 _82 = color;/);
  assert.match(vertex, /_9 = _82 \* _Color;/);
  assert.match(vertex, /vUv = \(_93 \* _MainTex_ST\.xy\) \+ _MainTex_ST\.zw;/);
  assert.doesNotMatch(vertex, /gl_Position\.y\s*=\s*-gl_Position\.y/);
  assert.doesNotMatch(vertex, /vUv\.y\s*=|1\.0\s*-\s*vUv\.y/);
  assert.match(fragment, /_20 = _9 \+ _TextureSampleAdd;/);
  assert.match(fragment, /outColor = _20 \* vColor;/);
  assert.doesNotMatch(fragment, /1\.0\s*-|vColor\.wwww/);
  assert.match(fragment, /outAux = vec4\(0\.0\);/);

  const manifest = JSON.parse(fs.readFileSync(path.join(shaderDir, "ui_default_to_rt_program.json"), "utf8"));
  assert.equal(manifest.role, "producer-to-render-texture");
  assert.deepEqual(manifest.port_target.keywords, []);
  assert.equal(manifest.port_target.status, "static-candidate-not-runtime-selection");
  assert.deepEqual(manifest.pass_catalog.map((pass) => [pass.subshaderIndex, pass.name]), [[0, "Default"], [1, "Alpha"]]);
  assert.deepEqual(manifest.blend, evidence.derived.defaultPassBlend);
  const serializedState = manifest.render_state.official_shaderlab_serialized;
  assert.equal(serializedState.blend.srcColor.value, 5);
  assert.equal(serializedState.blend.dstColor.value, 10);
  assert.equal(serializedState.blend.srcAlpha.value, 0);
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
  assert.deepEqual(manifest.runtime_boundaries, evidence.runtimeBoundaries);
  assert.deepEqual(manifest.runtime_boundaries.map(({ id, status }) => [id, status]), [
    ["runtime-subshader-pass-selection", "unproved"],
    ["dynamic-ui-keyword-state", "unproved"],
    ["dynamic-canvas-fixed-function-state", "unproved"],
    ["producer-render-target-contract", "unproved"],
    ["texture-sample-add-per-draw-value", "unproved"],
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
    const sampleAdd = [0.1, 0.05, 0.2, 0.9];
    const sourceFloat = sample.map((value, index) => (value + sampleAdd[index]) * tint[index]);

    gl.disable(gl.BLEND);
    gl.clearBufferfv(gl.COLOR, 0, new Float32Array([0, 0, 0, 0]));
    gl.clearBufferfv(gl.COLOR, 1, new Float32Array([0.25, 0.5, 0.75, 1]));
    draw();
    const semantic = read(0);
    const auxiliary = read(1);

    gl.clearBufferfv(gl.COLOR, 0, new Float32Array([0.2, 0.3, 0.4, 0.5]));
    const destination = read(0);
    gl.enable(gl.BLEND);
    gl.blendEquation(gl.FUNC_ADD);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    draw();
    const blended = read(0);
    const destinationFloat = destination.map((value) => value / 255);
    const blendedFloat = sourceFloat.map((value, index) => value * sourceFloat[3] + destinationFloat[index] * (1 - sourceFloat[3]));
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
        SRC_ALPHA: gl.SRC_ALPHA,
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
    srcRgb: runtime.blendState.SRC_ALPHA,
    dstRgb: runtime.blendState.ONE_MINUS_SRC_ALPHA,
    srcAlpha: runtime.blendState.SRC_ALPHA,
    dstAlpha: runtime.blendState.ONE_MINUS_SRC_ALPHA,
    equationRgb: runtime.blendState.FUNC_ADD,
    equationAlpha: runtime.blendState.FUNC_ADD,
    SRC_ALPHA: runtime.blendState.SRC_ALPHA,
    ONE_MINUS_SRC_ALPHA: runtime.blendState.ONE_MINUS_SRC_ALPHA,
    FUNC_ADD: runtime.blendState.FUNC_ADD,
  });
  assert.equal(runtime.error, 0, `WebGL error 0x${runtime.error.toString(16)}`);

  console.log("Official UI Default To RT audit OK");
  console.log("Source: pinned UI Image prefab, Material/Shader bundles and objects, both PPtr edges, program entry, SPIR-V, and reflection hashes");
  console.log("Program: Default pass empty-keyword Vulkan static candidate; Alpha pass and all variants retained; runtime pass/keyword/Canvas state boundaries explicit");
  console.log("GPU draw/readPixels: vertexColor*_Color, _MainTex_ST, _TextureSampleAdd, MRT1 zero, and SrcAlpha/OneMinusSrcAlpha verified");
  console.log("Adaptation: Vulkan clip Y removed once, texture UV unchanged; WebGL2 compile/link and deterministic execution verified");
} finally {
  await browser?.close();
  fs.rmSync(tmp, { recursive: true, force: true });
}
