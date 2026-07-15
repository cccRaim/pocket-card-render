import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { OFFICIAL_GLITTER_FLOW_DEFAULTS } from "../public/render/glitter-flow.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const APKM = process.env.PCR_APKM
  || "D:/DevProjectes/ptcg-apk-parser/apks/jp.pokemon.pokemontcgp_1.6.0.apkm";
const BUNDLE = process.env.PCR_GLITTER_BUNDLE
  || "D:/DevProjectes/ptcgp-tools-master/masterdata_decoder/.output/decrypted/Common/CardNew/Common/Model/Prefabs/Parts/UR/L_Card_Glitter_FLowMaps.prefab_bundles";
const SHADERS = process.env.PCR_SHADERS
  || "D:/DevProjectes/ptcgp-tools-master/masterdata_decoder/.output/decrypted/Common/Shader";

const EXPECTED = {
  apkmSha256: "9b7f9067e00a54f342bd4f17e669ceeb86b80bb7d34ff2d0d0fe82050a62f201",
  splitSha256: "7faf449bae431dcfeda4f882ecb04290af66cc4ccfeefc620e24cac70d22fcec",
  libil2cppSha256: "3e78eedc62770fff4cb129b4b8d898950e131b710b3c099237fe20d2d34ca48e",
  bundleSha256: "8c7966e26446db4c635363d3eeeda7182456e2adc9b8fc62d6d4ef0b7c438929",
  vertexSpirvSha256: "1af6dfd11c7da5008e4fb1819e056d86ceca72cc1fc08ef40442dc63ead61597",
  fragmentSpirvSha256: "f5aee5f528410fcade473ebe4adb39d36033c05a01020e959b530ea24d60785b",
  zeroSpeedWindows: {
    // FCMP speed,min; B.PL skips the clamp only when speed >= min.
    compareAndBranch: "0028211e00c0211e0020281e05030054",
    // Recompute magnitude; FDIV min/speed; FMUL x/y by the quotient; STP.
    divideAndScale: "80092c1e61092b1e0028211e00c0211e0019201e2109201e4009201e61820a2d",
  },
  methods: {
    Initialize: [164, "5df579708231fb12beca5e3d5e961d37561757a8d5d6ea17899879c65f0c8370"],
    Update: [48, "61c7a26ac29c1f29c3f889e4b630e39b8737f02c21aca3e8a01d350365b86e50"],
    UpdateFlowSpeed: [640, "23f90ec0498b0eb4d8e915b668b54d4b2148500753f36825d3555e558a948794"],
    UpdateFlowMapUVOffset: [840, "d9eddf3b574aaa778f440d36d0ed89ef0ddb68045d6780b8126d80dc43028a86"],
    UpdateLightTiming: [184, "ec68b58f1432486eed49037ee5b7fde13dc6bded68fd8db0b13cd30cd7abdcae"],
    UpdateFlowRotate: [316, "d1968b03abe7324ba27521030b49056fd8642d60408a851346a78e681b72b7b0"],
    SetParams: [100, "956d55ddd18c2cee90cfcd461a62c4dfc07a8d79b1344e8c76e8dd9c8984fae5"],
  },
};

function runPython(args) {
  return execFileSync("python", args, {
    cwd: ROOT,
    encoding: "utf8",
    shell: process.platform === "win32",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

for (const file of [APKM, BUNDLE, SHADERS]) assert.ok(fs.existsSync(file), `official source missing: ${file}`);
const evidence = JSON.parse(runPython([
  "build/extract_official_glitter_flow.py",
  "--apkm", APKM,
  "--bundle", BUNDLE,
]));

for (const key of ["apkmSha256", "splitSha256", "libil2cppSha256", "bundleSha256"]) {
  assert.equal(evidence[key], EXPECTED[key], `${key} drifted`);
}
for (const [name, [size, hash]] of Object.entries(EXPECTED.methods)) {
  assert.equal(evidence.methods[name].size, size, `${name} body size drifted`);
  assert.equal(evidence.methods[name].sha256, hash, `${name} body bytes drifted`);
}
assert.deepEqual(evidence.zeroSpeedWindows, EXPECTED.zeroSpeedWindows, "official zero-speed instruction windows drifted");

const fieldMap = {
  _accelIntensity: "accelIntensity",
  _maxFlowSpeed: "maxFlowSpeed",
  _minFlowSpeed: "minFlowSpeed",
  _initFlowSpeed: "initFlowSpeed",
  _resistance: "resistance",
  _minTiltPower: "minTiltPower",
  _lightSpeed: "lightSpeed",
  _flowAMinRotateSpeed: "flowAMinRotateSpeed",
  _flowAMaxRotateSpeed: "flowAMaxRotateSpeed",
  _flowBMinRotateSpeed: "flowBMinRotateSpeed",
  _flowBMaxRotateSpeed: "flowBMaxRotateSpeed",
};
for (const [officialName, localName] of Object.entries(fieldMap)) {
  assert.equal(Math.fround(evidence.prefab[officialName]), OFFICIAL_GLITTER_FLOW_DEFAULTS[localName], `${officialName} differs from official prefab`);
}
assert.equal(evidence.rodata.twoPi, Math.fround(6.2831854820251465));
assert.equal(evidence.rodata.normalizeEpsilon, Math.fround(0.00001));
assert.equal(evidence.rodata.flowDirectionX, Math.fround(0.5821118950843811));
assert.equal(evidence.rodata.flowDirectionY, Math.fround(0.8131087422370911));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pcr-glitter-timing-"));
try {
  runPython([
    "build/shaderdec/dump_shader.py",
    "Card_UR_Glitter_FlowMaps",
    "urglit",
    "--shaders", SHADERS,
    "--out", tmp,
  ]);
  const vertPath = path.join(tmp, "urglit_vert.spv");
  const fragPath = path.join(tmp, "urglit_frag.spv");
  assert.ok(fs.existsSync(vertPath) && fs.existsSync(fragPath), "official glitter SPIR-V missing");
  const hashFile = (file) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  assert.equal(hashFile(vertPath), EXPECTED.vertexSpirvSha256, "official glitter vertex SPIR-V drifted");
  assert.equal(hashFile(fragPath), EXPECTED.fragmentSpirvSha256, "official glitter fragment SPIR-V drifted");
  const vertReflect = JSON.parse(execFileSync("spirv-cross", [vertPath, "--reflect"], { encoding: "utf8" }));
  const fragReflect = JSON.parse(execFileSync("spirv-cross", [fragPath, "--reflect"], { encoding: "utf8" }));
  const vertMember = Object.values(vertReflect.types).flatMap((type) => type.members || [])
    .find((member) => member.offset === 224 && member.array?.[0] === 2 && member.array_stride === 16);
  const fragMember = Object.values(fragReflect.types).flatMap((type) => type.members || [])
    .find((member) => member.offset === 0 && member.array?.[0] === 2 && member.array_stride === 16);
  assert.ok(vertMember, "vertex _FlowParams[2] at byte 224 not found");
  assert.ok(fragMember, "fragment _FlowParams[2] at byte 0 not found");

  const vertGlsl = execFileSync("spirv-cross", [vertPath, "--version", "300", "--es"], { encoding: "utf8" });
  const fragGlsl = execFileSync("spirv-cross", [fragPath, "--version", "300", "--es"], { encoding: "utf8" });
  assert.match(vertGlsl, /sin\([^\n]*_m8\[1\]\.x\)/, "flow A rotation is not sourced from _FlowParams[1].x");
  assert.match(vertGlsl, /cos\([^\n]*_m8\[1\]\.y\)/, "flow B rotation is not sourced from _FlowParams[1].y");
  assert.match(fragGlsl, /fract\([^\n]*_m0\[0\]\.xy\)/, "flow offsets are not sourced from _FlowParams[0].xy");
  assert.match(fragGlsl, /_m0\[0\]\.z/, "light phase is not sourced from _FlowParams[0].z");
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

const source = fs.readFileSync(path.join(ROOT, "public/render/glitter-flow.js"), "utf8");
const appSource = fs.readFileSync(path.join(ROOT, "public/app.js"), "utf8");
const urSource = fs.readFileSync(path.join(ROOT, "public/render/materials/ur.js"), "utf8");
assert.doesNotMatch(source, /\b_Time\b|requestAnimationFrame|performance\.now/, "glitter state must not use Unity _Time or RAF time");
assert.match(source, /deltaTime/, "scaled deltaTime input is missing");
const speedBlock = source.slice(source.indexOf("function updateFlowSpeed"), source.indexOf("function updateFlowMapUVOffset"));
assert.doesNotMatch(speedBlock, /deltaTime/, "official flow acceleration/damping is per-frame, not deltaTime-scaled");
assert.match(speedBlock, /speed\s*>\s*0\s*&&\s*speed\s*<\s*c\.minFlowSpeed/, "zero-speed NaN guard is missing");
assert.match(source, /state\.flowParams\[0\]\[1\]\s*=\s*neg\(state\.flowMapUVOffset\[1\]\)/, "FlowParams[0].y must negate offset B");
assert.match(source, /state\.flowParams\[1\]\[0\]\s*=\s*state\.flowARotate/, "FlowParams[1].x must carry rotation A");
assert.match(source, /state\.flowParams\[1\]\[1\]\s*=\s*state\.flowBRotate/, "FlowParams[1].y must carry rotation B");
assert.match(source, /updateFlowSpeed\(state, forward\);[\s\S]*updateFlowMapUVOffset\(state, dt\);[\s\S]*updateLightTiming\(state, dt\);[\s\S]*updateFlowRotate\(state, dt\);/, "official Update method order drifted");
assert.match(urSource, /createGlitterFlowState\(\)/, "glitter material does not own native FlowParams state");
assert.match(appSource, /updateGlitterFlow\(em\.userData\.glitterFlow/, "render loop does not advance native glitter state");
assert.match(appSource, /em\.uniforms\._37\.value\[0\]\.set\(\.\.\.flow\[0\]\)/, "fragment FlowParams[0] upload is missing");
assert.match(appSource, /em\.uniforms\._78\.value\[15\]\.set\(\.\.\.flow\[1\]\)/, "vertex FlowParams[1] upload is missing");
assert.doesNotMatch(appSource, /_37\.value\[0\]\.set\(s\s*\/\s*20/, "render loop still substitutes RAF time for FlowParams");
assert.match(appSource, /gameTime\s*\+=\s*deltaTime/, "lens flare lacks shared scaled-time accumulation");

console.log("official GlitterFlowMaps animation timing: OK");
console.log(`  APKM ${evidence.apkmSha256}`);
console.log(`  libil2cpp ${evidence.libil2cppSha256}`);
console.log(`  prefab ${evidence.bundleSha256}`);
console.log("  native methods 7/7 pinned; zero-speed divide window pinned; local finite-state guard present");
console.log("  prefab fields 11/11 matched; SPIR-V FlowParams bindings matched");
