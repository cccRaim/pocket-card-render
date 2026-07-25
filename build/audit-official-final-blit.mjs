// Audit the APKM-backed FinalBlit chain, SPIR-V, WebGL2 adaptation, and compile/link.
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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pcr-audit-final-blit-"));

const EXPECTED = {
  source: {
    apkmSha256: "9b7f9067e00a54f342bd4f17e669ceeb86b80bb7d34ff2d0d0fe82050a62f201",
    baseApkSha256: "815dc606f3b3e3404199fac80abb46b9249948828178a5cbf6aedb3d9e6809de",
    globalgamemanagersSha256: "5a1ca51ec16b267710479b85e33bfe150c4aab255e9716fd33d51ce7a33ea017",
  },
  resourceManager: [13, 182600, "878c096d7143ee90722194d5df2e12b22705c854e5cd608152062c8b97f5ec20"],
  material: {
    file: "8bdac87d3d839054ab63a0e27b5cc251",
    fileHash: "a0a61863fbf3b3e11e7a335418ed97ab8466745d34d7d23cd7b12172e67febca",
    assetHash: "d6166008a65009b47b380903da01ee7939daf1d3d3f210f11f25d2b8b09fa0ad",
  },
  shader: {
    file: "de5cbc5999435ca42a6ca06a2e0d1257",
    fileHash: "38f0953ac0ec342ba844fa95f65c44cf41d264940f5d57b2cead96121f55ea62",
    assetHash: "00448b294fe2745dc4ed51d04aa73a39baf7c885096767414553d36dd4b228b8",
  },
  program: {
    compressed: [1001, "891d50a834912ef0337cf0362c5400bccf106f75294a8d7dd44de8e12c226d6f"],
    decompressed: [1344, "76d69f275d961c7db9c747cbc4f1e389df960b214cf0006e627619f6e0fa3527"],
    parameter: [100, "d2fc3f4d9880e4454b5c8226151de2b34031a5051de90ea3e462a284957c8da7"],
    program: [1216, "81d397323ea0e0067c12c12730d45b381cacf499563829ad04a455e0e70561d0"],
  },
  modules: {
    vertex: [2128, "a95fea7dba0fd2f084b7e1e9e9be33e13464b26ed50710a18049b7b096333c63", "b6fb093caf989c2bb8151410a25b1f2901af313378f1af554a3e55c151c89939"],
    fragment: [1056, "d146c34d1f09e1cf8c814e410a6be8bbcdb8903c0c0c09eb71e69b44377f2397", "c5595def42fe04c6c8bdeb67ce037ef79e72779d0ce89747d678cbdb62cdf2dd"],
  },
  generated: {
    "final_blit.vert.glsl": "c3524b1ef34211c4f6329a3df60cbcfcfcad3cdefe795c53a545e0d44961b16e",
    "final_blit.frag.glsl": "945247d0ef3094c3be011a087419bb3d6d7c7b27436cfb50567ca69e9c4e10d4",
    "final_blit_program.json": "55a9d77da17d2ab5b0d16995fcfa7db07c29ff018afe417ff251e5a14ff6d356",
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

function verifyRaw(record, hashKey, sizeKey = "byteSize", hexKey = "rawHex") {
  const bytes = Buffer.from(record[hexKey], "hex");
  assert.equal(bytes.length, record[sizeKey]);
  assert.equal(sha256(bytes), record[hashKey]);
  return bytes;
}

function extract() {
  const result = spawnSync(PYTHON, ["build/extract_official_final_blit.py"], {
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
  for (const [key, expected] of Object.entries(EXPECTED.source)) assert.equal(evidence.source[key], expected);

  const chain = evidence.resourceChain;
  assert.deepEqual(
    [chain.resourceManager.pathId, chain.resourceManager.byteSize, chain.resourceManager.rawSha256],
    EXPECTED.resourceManager,
  );
  verifyRaw(chain.resourceManager, "rawSha256");
  assert.equal(chain.resourceManager.material.key, "lettuce.graphics.rendering/materials/blit");
  assert.deepEqual(chain.resourceManager.material.pptr, { fileId: 54, pathId: 1 });
  assert.equal(chain.resourceManager.material.external.path, EXPECTED.material.file);
  assert.equal(chain.materialFile.sha256, EXPECTED.material.fileHash);
  verifyRaw(chain.materialFile, "sha256");
  assert.equal(chain.materialAsset.name, "Blit");
  assert.equal(chain.materialAsset.rawSha256, EXPECTED.material.assetHash);
  verifyRaw(chain.materialAsset, "rawSha256");
  assert.deepEqual(chain.materialAsset.shaderPPtr, { fileId: 1, pathId: 1 });
  assert.equal(chain.materialAsset.shaderExternal.path, EXPECTED.shader.file);
  assert.equal(chain.resourceManager.shader.key, "lettuce.graphics.rendering/shaders/blit");
  assert.deepEqual(chain.resourceManager.shader.pptr, { fileId: 15, pathId: 1 });
  assert.equal(chain.shaderFile.sha256, EXPECTED.shader.fileHash);
  verifyRaw(chain.shaderFile, "sha256");
  assert.equal(chain.shaderAsset.name, "Rendering/CustomRenderer/Blit");
  assert.equal(chain.shaderAsset.rawSha256, EXPECTED.shader.assetHash);
  verifyRaw(chain.shaderAsset, "rawSha256");

  const program = evidence.shaderProgram;
  assert.deepEqual([program.compressedLength, program.compressedSha256], EXPECTED.program.compressed);
  assert.deepEqual([program.decompressedLength, program.decompressedSha256], EXPECTED.program.decompressed);
  verifyRaw(program, "compressedSha256", "compressedLength", "compressedHex");
  verifyRaw(program, "decompressedSha256", "decompressedLength", "decompressedHex");
  assert.deepEqual([program.pass.parameterEntry.length, program.pass.parameterEntry.sha256], EXPECTED.program.parameter);
  assert.deepEqual([program.pass.programEntry.length, program.pass.programEntry.sha256], EXPECTED.program.program);
  verifyRaw(program.pass.parameterEntry, "sha256", "length");
  verifyRaw(program.pass.programEntry, "sha256", "length");
  assert.deepEqual(program.pass.renderState, {
    blendOp: 0, blendOpAlpha: 0, colorMask: 15, cull: 0,
    destBlend: 0, destBlendAlpha: 0, separateBlend: false,
    srcBlend: 1, srcBlendAlpha: 1, zTest: 4, zWrite: 0,
  });
  assert.deepEqual(program.pass.bindings.uniforms.map(({ name, buffer, offset, dimension }) => ({ name, buffer, offset, dimension })), [
    { name: "_BlitMipLevel", buffer: "PGlobals2641384586", offset: 0, dimension: 1 },
    { name: "_BlitScaleBias", buffer: "VGlobals2641384586", offset: 0, dimension: 4 },
  ]);
  assert.deepEqual(program.pass.bindings.samplers, [{
    name: "_BlitTexture", binding: 0, encodedIndex: 134217728,
    samplerIndex: -1, dimension: 2, multisampled: false,
  }]);

  for (const stage of ["vertex", "fragment"]) {
    const module = program.pass.modules.find((item) => item.stage === stage);
    const [size, spvHash, reflectionHash] = EXPECTED.modules[stage];
    const bytes = Buffer.from(module.spvHex, "hex");
    assert.equal(bytes.length, size);
    assert.equal(sha256(bytes), spvHash);
    const file = path.join(tmp, `${stage}.spv`);
    fs.writeFileSync(file, bytes);
    const reflection = JSON.parse(execFileSync(SPIRV_CROSS, [file, "--reflect"], { encoding: "utf8" }));
    assert.equal(sha256(JSON.stringify(stable(reflection))), reflectionHash);
  }

  const shaderDir = path.join(ROOT, "public", "shaders");
  for (const [name, expected] of Object.entries(EXPECTED.generated)) {
    assert.equal(sha256(fs.readFileSync(path.join(shaderDir, name))), expected, `${name} drifted`);
  }
  const vert = fs.readFileSync(path.join(shaderDir, "final_blit.vert.glsl"), "utf8");
  const frag = fs.readFileSync(path.join(shaderDir, "final_blit.frag.glsl"), "utf8");
  assert.match(vert, /_9\.x = \(uint\(gl_VertexID\) & 1u\) << 1u;/);
  assert.doesNotMatch(vert, /bitfieldInsert/);
  assert.doesNotMatch(vert, /\(-_30\.y\) \+ 1\.0/);
  assert.match(vert, /_30\.z = _30\.y;/);
  assert.match(vert, /vUv = \(_30\.xz \* _BlitScaleBias\.xy\) \+ _BlitScaleBias\.zw;/);
  assert.match(frag, /textureLod\(_BlitTexture, vUv, _BlitMipLevel\)/);

  const metadata = JSON.parse(fs.readFileSync(path.join(shaderDir, "final_blit_program.json"), "utf8"));
  assert.equal(metadata.bindings.scale_bias.name, "_BlitScaleBias");
  assert.deepEqual(metadata.bindings.lod, {
    name: "_BlitMipLevel", stage: "fragment", offset: 0, type: "float", explicit_texture_lod: true,
  });

  browser = await chromium.launch({
    args: ["--enable-unsafe-swiftshader", "--use-gl=angle", "--use-angle=swiftshader", "--ignore-gpu-blocklist"],
  });
  const page = await browser.newPage();
  const runtime = await page.evaluate(({ vertex, fragment }) => {
    const canvas = document.createElement("canvas");
    canvas.width = 2;
    canvas.height = 2;
    const gl = canvas.getContext("webgl2");
    if (!gl) throw new Error("WebGL2 unavailable");
    const compile = (type, source) => {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, `#version 300 es\n${source}`);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
      return shader;
    };
    const programObject = gl.createProgram();
    gl.attachShader(programObject, compile(gl.VERTEX_SHADER, vertex));
    gl.attachShader(programObject, compile(gl.FRAGMENT_SHADER, fragment));
    gl.linkProgram(programObject);
    if (!gl.getProgramParameter(programObject, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(programObject));
    const uniforms = ["_BlitScaleBias", "_BlitMipLevel", "_BlitTexture"].map((name) => ({
      name, active: gl.getUniformLocation(programObject, name) !== null,
    }));
    const texture = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fixture = new Uint8Array([
      255, 0, 0, 255,   0, 255, 0, 255,
      0, 0, 255, 255,   255, 255, 0, 255,
    ]);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 2, 2, 0, gl.RGBA, gl.UNSIGNED_BYTE, fixture);
    gl.useProgram(programObject);
    gl.uniform4f(gl.getUniformLocation(programObject, "_BlitScaleBias"), 1, 1, 0, 0);
    gl.uniform1f(gl.getUniformLocation(programObject, "_BlitMipLevel"), 0);
    gl.uniform1i(gl.getUniformLocation(programObject, "_BlitTexture"), 0);
    gl.bindVertexArray(gl.createVertexArray());
    gl.viewport(0, 0, 2, 2);
    gl.disable(gl.DITHER);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    const pixels = new Uint8Array(16);
    gl.readPixels(0, 0, 2, 2, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    return { uniforms, fixture: Array.from(fixture), pixels: Array.from(pixels), error: gl.getError() };
  }, { vertex: vert, fragment: frag });
  assert.deepEqual(runtime.uniforms, [
    { name: "_BlitScaleBias", active: true },
    { name: "_BlitMipLevel", active: true },
    { name: "_BlitTexture", active: true },
  ]);
  assert.deepEqual(runtime.pixels, runtime.fixture, "WebGL2 FinalBlit must preserve both texture axes");
  assert.equal(runtime.error, 0);

  console.log("Official FinalBlit audit OK");
  console.log("Chain: ResourceManager PathID 13 -> external Material Blit -> external Shader Rendering/CustomRenderer/Blit");
  console.log("Program: pinned Vulkan SPIR-V/reflection/bindings/render state; generated WebGL2 hashes matched");
  console.log("Runtime: SwiftShader compile/link and asymmetric 2x2 draw/readPixels orientation passed");
} finally {
  await browser?.close();
  fs.rmSync(tmp, { recursive: true, force: true });
}
