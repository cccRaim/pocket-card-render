import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHADERS = process.env.PCR_SHADERS
  || "D:/DevProjectes/ptcgp-tools-master/masterdata_decoder/.output/decrypted/Common/Shader";
const PYTHON = process.env.PYTHON || "python";
const SPIRV_CROSS = process.env.SPIRV_CROSS
  || (process.env.VULKAN_SDK
    ? path.join(process.env.VULKAN_SDK, "Bin", "spirv-cross.exe")
    : "C:/VulkanSDK/1.4.350.0/Bin/spirv-cross.exe");

const PROGRAMS = [
  ["Card_Parallax_Hologram_Tuning", null, 48, 79,
    "089d575ef8fef77e7a968bbf409a32b02d2d0644a1d834fde5d4b63b8e4e4abc",
    "6ec969b57b0ffe26c7560771865a148fd65e1a617b196152b25e75ffee5b8e3f"],
  ["Card_Hologram_Tuning", null, 0, 154,
    "889e3e0ad89c44498eeeb66406ab63bea881d61cce1e2c82d7afe61783b952c3",
    "849da6480e0acf23a42c98ff315ce1c97b7e927f3a674d4cd5af2526299ffc2b"],
  ["Frame-Holo-Tuning", null, 0, 191,
    "4515eaaf9618a9cd541debc5e611b41fc8e16d74992f9e7791865f6e26fd5e8e",
    "5d99d92ac0cd93b7ba2578b6b22bd2654e4118c96498e1c28595852174b815b3"],
  ["Opaque-Hologram_Tuning", null, 9, 219,
    "91c1b803b05a01edc0625b08f89ca3bb81f2e562495d92f169f725a1320fb792",
    "23cb98cea428b4130624da5a874184605a0979526495e5e64f5b24d16ec74b9e"],
  ["Frame-2Layer-UR", null, 121, 445,
    "ca5fb5f7f87fe4558bc50e1d91c6a874d979f8bef12edb4011373c67d425144b",
    "746ef1363103a59c4cad5caacf3264573f29e6370762b2350a738961739fc058"],
  ["Frame-Holo-UR-New", null, 76, 301,
    "d92424eb171ce6605f336e2a799bfbe72474492f36051790f3cd60ba7e2b92b1",
    "90f2e82f3cb63f5aeda5c35757f7c42d01a23fb7414eec87cc8c129c197e0558"],
  ["Opaque-UR-Oklab", ["--keyword", "_FAKESPECULARENABLED_ON"], 94, 361,
    "4e5ca701d29cea4e13d73687edfaec9a8f9d2423d65b7644a1e4860e05b1c4e0",
    "171fea2f7d06c8644755e5364cb2d714f87beb72b314cacf198d2874ddb59108"],
  ["Simple-Opaque-Hologram_Tuning", ["--no-keywords"], 0, 104,
    "0548eb74b092604a20c3f214627ac925a140eec3ed1f56de07ce67df7d4781a7",
    "71a0a291b3c5cba3373ea0b30519a971cac77882b370f36c7f8a99cdbca78089"],
  ["Transparent_Hologram_Tuning", null, 0, 147,
    "8d2fc783df1992875e14e1385e8a75c9cda9adfb39aa51a86590ff2e8016c1ab",
    "5edc43738cbee9ee6abd5bd79809a8c8384cc81fd1ffe5d72d8d8c9300c2798e"],
  ["Transparent-UR-New", null, 66, 220,
    "2d413a0fda9b7a80a7898f4a0e913588368098e91b3d05e8e9ab4d5ca668147c",
    "f427d102ab9395f4e5f7029dc7ee32a362aa759b6e2830de6de302ddd8639391"],
  ["Card_Parallax_Hologram_UR_New", null, 111, 177,
    "edf422324256e22b8529b95b7fa9a1613a90d319186aa8f387b2bcd2a453c08b",
    "88ff63e04e5df3ba4e26af924457918dfe04880a26cdd29eab500fab9b33e56e"],
  ["Card_UR_LensFlare", ["--no-keywords"], 61, 22,
    "2f61420487c058c59b314a1baa80bff2e88c8ce81080cd0f138dab20c44dc5dc",
    "00ca932a4760a0bbf5ed7608ec819f69a7a758bb45f0fcc7cb4b689ccd14c69f"],
  ["Card_UR_Plate", null, 113, 218,
    "3f61767d51c8525ef8e6b1f184890c3a9af1083741d8e24a7ea79aae040bbda0",
    "a28632318e353e752a8f583b2bbc3b61597d4b834a3e6892da94ba2f7b5f551a"],
  ["Card_UR_Glitter_FlowMaps", null, 89, 227,
    "1af6dfd11c7da5008e4fb1819e056d86ceca72cc1fc08ef40442dc63ead61597",
    "f5aee5f528410fcade473ebe4adb39d36033c05a01020e959b530ea24d60785b"],
];

const OP = {
  ExecutionMode: 16,
  Capability: 17,
  TypeFloat: 22,
  Decorate: 71,
  MemberDecorate: 72,
  QuantizeToF16: 116,
  ExecutionModeId: 331,
};
const DECORATION = {
  RelaxedPrecision: 0,
  FPRoundingMode: 39,
  FPFastMathMode: 40,
  NoContraction: 42,
};
const FLOAT_CONTROL_MODES = new Set([4459, 4460, 4461, 4462, 4463]);

function sha256(file) {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function inspectSpirv(file) {
  const bytes = fs.readFileSync(file);
  assert.equal(bytes.length % 4, 0, `${file}: SPIR-V byte length is not word aligned`);
  const words = new Uint32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
  assert.equal(words[0], 0x07230203, `${file}: bad SPIR-V magic`);
  const result = {
    relaxedPrecision: 0,
    float16Capabilities: 0,
    float16Types: 0,
    float32Types: 0,
    quantizeToF16: 0,
    noContraction: 0,
    fpFastMathMode: 0,
    fpRoundingMode: 0,
    floatControlExecutionModes: 0,
  };
  for (let offset = 5; offset < words.length;) {
    const instruction = words[offset];
    const wordCount = instruction >>> 16;
    const opcode = instruction & 0xffff;
    assert.ok(wordCount > 0 && offset + wordCount <= words.length,
      `${file}: malformed instruction at word ${offset}`);
    if (opcode === OP.Capability) {
      if (words[offset + 1] === 9) result.float16Capabilities += 1;
    } else if (opcode === OP.TypeFloat) {
      if (words[offset + 2] === 16) result.float16Types += 1;
      if (words[offset + 2] === 32) result.float32Types += 1;
    } else if (opcode === OP.Decorate || opcode === OP.MemberDecorate) {
      const decorationIndex = opcode === OP.Decorate ? offset + 2 : offset + 3;
      const decoration = words[decorationIndex];
      if (decoration === DECORATION.RelaxedPrecision) result.relaxedPrecision += 1;
      if (decoration === DECORATION.FPRoundingMode) result.fpRoundingMode += 1;
      if (decoration === DECORATION.FPFastMathMode) result.fpFastMathMode += 1;
      if (decoration === DECORATION.NoContraction) result.noContraction += 1;
    } else if (opcode === OP.QuantizeToF16) {
      result.quantizeToF16 += 1;
    } else if (opcode === OP.ExecutionMode || opcode === OP.ExecutionModeId) {
      if (FLOAT_CONTROL_MODES.has(words[offset + 2])) result.floatControlExecutionModes += 1;
    }
    offset += wordCount;
  }
  return result;
}

function run(command, args) {
  return execFileSync(command, args, {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1", PYTHONWARNINGS: "ignore" },
    shell: process.platform === "win32" && command === PYTHON,
    windowsHide: true,
    maxBuffer: 32 * 1024 * 1024,
  });
}

function assertNoFp16Evidence(stats, label) {
  assert.ok(stats.float32Types > 0, `${label}: no Float32 type found`);
  assert.equal(stats.float16Capabilities, 0, `${label}: unexpected Float16 capability`);
  assert.equal(stats.float16Types, 0, `${label}: unexpected Float16 type`);
  assert.equal(stats.quantizeToF16, 0, `${label}: unexpected OpQuantizeToF16`);
  assert.equal(stats.noContraction, 0, `${label}: unexpected NoContraction`);
  assert.equal(stats.fpFastMathMode, 0, `${label}: unexpected FPFastMathMode`);
  assert.equal(stats.fpRoundingMode, 0, `${label}: unexpected FPRoundingMode`);
  assert.equal(stats.floatControlExecutionModes, 0, `${label}: unexpected float-control execution mode`);
}

function cross(file) {
  return run(SPIRV_CROSS, [file, "--version", "300", "--es"]);
}

assert.ok(fs.existsSync(SHADERS), `official shader bundle root missing: ${SHADERS}`);
if (path.isAbsolute(SPIRV_CROSS)) assert.ok(fs.existsSync(SPIRV_CROSS), `spirv-cross missing: ${SPIRV_CROSS}`);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pcr-official-precision-"));
let vertexRelaxed = 0;
let fragmentRelaxed = 0;
let glitterVert;
let glitterFrag;
try {
  for (let index = 0; index < PROGRAMS.length; index += 1) {
    const [name, selector, expectedVert, expectedFrag, vertHash, fragHash] = PROGRAMS[index];
    const prefix = `p${String(index).padStart(2, "0")}`;
    run(PYTHON, [
      "-W", "ignore",
      "build/shaderdec/dump_shader.py",
      name,
      prefix,
      "--shaders", SHADERS,
      "--out", tmp,
      ...(selector || []),
    ]);
    const vertPath = path.join(tmp, `${prefix}_vert.spv`);
    const fragPath = path.join(tmp, `${prefix}_frag.spv`);
    assert.ok(fs.existsSync(vertPath) && fs.existsSync(fragPath), `${name}: stage module missing`);
    assert.equal(sha256(vertPath), vertHash, `${name}: vertex module drifted`);
    assert.equal(sha256(fragPath), fragHash, `${name}: fragment module drifted`);
    const vert = inspectSpirv(vertPath);
    const frag = inspectSpirv(fragPath);
    assert.equal(vert.relaxedPrecision, expectedVert, `${name}: vertex RelaxedPrecision count drifted`);
    assert.equal(frag.relaxedPrecision, expectedFrag, `${name}: fragment RelaxedPrecision count drifted`);
    assertNoFp16Evidence(vert, `${name} vertex`);
    assertNoFp16Evidence(frag, `${name} fragment`);
    vertexRelaxed += vert.relaxedPrecision;
    fragmentRelaxed += frag.relaxedPrecision;
    if (name === "Card_UR_Glitter_FlowMaps") {
      glitterVert = { path: vertPath, source: cross(vertPath) };
      glitterFrag = { path: fragPath, source: cross(fragPath) };
    }
    console.log(`${name}: RelaxedPrecision v${vert.relaxedPrecision}/f${frag.relaxedPrecision}; Float16/Quantize/NoContraction 0/0/0`);
  }

  assert.equal(vertexRelaxed, 788, "aggregate vertex RelaxedPrecision count drifted");
  assert.equal(fragmentRelaxed, 2865, "aggregate fragment RelaxedPrecision count drifted");
  assert.equal(vertexRelaxed + fragmentRelaxed, 3653, "aggregate RelaxedPrecision count drifted");

  assert.ok(glitterVert && glitterFrag, "Glitter modules were not captured");
  for (const member of [4, 5, 6, 7, 9, 10, 11, 12, 13, 14]) {
    assert.match(glitterVert.source, new RegExp(`mediump\\s+\\w+\\s+_m${member}\\b`),
      `Glitter vertex _m${member} lost official mediump qualifier`);
  }
  assert.match(glitterVert.source, /\bvec4 _m8\[2\];/, "Glitter vertex _m8[2] missing");
  assert.doesNotMatch(glitterVert.source, /mediump\s+vec4 _m8\[2\]/,
    "Glitter vertex rotation member _m8[2] must remain highp/default vertex precision");
  assert.match(glitterVert.source, /layout\(location = 3\) in mediump vec4 _34;/,
    "Glitter vertex tangent qualifier drifted");
  assert.match(glitterFrag.source, /^precision mediump float;/m, "Glitter fragment default is not mediump");
  for (const member of [0, 1, 2, 3, 5, 6]) {
    assert.match(glitterFrag.source, new RegExp(`highp\\s+\\w+(?:\\s+_m${member}\\b|\\s+_m${member}\\[)`),
      `Glitter fragment _m${member} lost official highp qualifier`);
  }
  assert.match(glitterFrag.source, /\bvec4 _m4;/, "Glitter fragment _m4 missing");
  assert.doesNotMatch(glitterFrag.source, /highp\s+vec4 _m4;/,
    "Glitter fragment light color _m4 must inherit mediump default");

  const localVert = fs.readFileSync(path.join(ROOT, "public/shaders/glitter.vert.glsl"), "utf8");
  const localFrag = fs.readFileSync(path.join(ROOT, "public/shaders/glitter.frag.glsl"), "utf8");
  assert.match(localVert, /^precision highp float;/m);
  assert.match(localVert, /in mediump vec4 tangent;/);
  assert.match(localVert, /uniform highp vec4 _FlowParams\[2\];/);
  for (const name of [
    "_FakeCameraHeight", "_Height", "_HeightPower", "_Scale", "_FlowScale",
    "_FakeCameraHeightB", "_HeightB", "_HeightPowerB", "_ScaleB", "_FlowScaleB",
  ]) {
    assert.match(localVert, new RegExp(`uniform mediump float ${name};`),
      `local Glitter vertex ${name} lost official mediump qualifier`);
  }
  assert.match(localFrag, /^precision mediump float;/m);
  assert.match(localFrag, /uniform highp vec4 _FlowParams\[2\];/);
  for (const name of ["_FadeDuration", "_FlowAPower", "_FlowBPower", "_LightTime", "_EmitThreshold"]) {
    assert.match(localFrag, new RegExp(`uniform highp float ${name};`),
      `local Glitter fragment ${name} lost official highp qualifier`);
  }
  assert.match(localFrag, /uniform vec4 _LightColor;/,
    "local Glitter fragment _LightColor must inherit the mediump default");
  assert.match(localFrag, /layout\(location = 1\) out highp vec4 _1092;/);
  assert.match(localFrag, /_1092 = vec4\(0\.0\);/);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log("official shader precision audit: OK");
console.log(`  programs ${PROGRAMS.length}; RelaxedPrecision vertex ${vertexRelaxed}, fragment ${fragmentRelaxed}, total ${vertexRelaxed + fragmentRelaxed}`);
console.log("  all pinned modules: Float16 capability/type=0, QuantizeToF16=0, NoContraction=0, FPFastMathMode=0, float-control modes=0");
console.log("  Glitter qualifiers: raw SPIRV-Cross evidence matched; local mixed-precision aliases matched");
