// Generate the six WebGL2 Bloom passes from the official decoded SPIR-V modules.
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  officialSample,
  officialSampleSha256,
} from "./official-sample.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "public", "shaders");
const PYTHON = process.env.PYTHON || "python";
const SPIRV_CROSS = process.env.SPIRV_CROSS || "spirv-cross";
const CHECK = process.argv.includes("--check") || process.env.PCR_EXACT_CHECK === "1";
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pcr-bloom-"));

const PINNED = {
  source: {
    apkmSha256: "9b7f9067e00a54f342bd4f17e669ceeb86b80bb7d34ff2d0d0fe82050a62f201",
    baseApkSha256: "815dc606f3b3e3404199fac80abb46b9249948828178a5cbf6aedb3d9e6809de",
    globalgamemanagersSha256: "5a1ca51ec16b267710479b85e33bfe150c4aab255e9716fd33d51ce7a33ea017",
    globalgamemanagersResourceSha256: "035e89da4ddfe2becba4a5848356d1c99dd4d123ee5a03646b547378de56d696",
  },
  asset: {
    name: "Hidden/CustomPostEffect/Bloom",
    pathId: 10,
    byteSize: 19900,
    rawSha256: "8684703cededfb2cbd1bddb656c650be5689ba80cfe1d0ae30deecf35826ccef",
  },
  program: {
    compressedSha256: "1f923d6c1b6cb41e2ec631b66c433ff59ff27a9835e1cfc844c3f3a070a214ba",
    decompressedSha256: "cbb7eee99c33df71d8eb2bb0a763357978e4f5c5aedab9a9b5662d42b7c3b500",
    programSetSha256: "212cac8fa20e4336ca6c9fd06622000f210fb08171a77e7fe161739f0b69422b",
  },
  passes: [
    {
      parameter: "abc9260ca44693aa494b92e17dc211246ea95940de3171a4f069997a805e263c",
      program: "0461f6b48af1c0f79ac42d48d49f41bb466764cf038b0bb0ff53fcd610ba6ace",
      fragment: [1476, "801650bce9770e4916791417a67838a0d6492bdf3865b78aac7034db00993bd5", "33c19de6fee85ee0b94db8ff001f12dd99e6d6c59d9222431181cea4972d2505"],
      vertex: [2388, "005ae2db725c0855cd7639112f4fcbe8a927962c1d3cbabad4253140cf0442ee", "2c26b0dcc428d84098c8136af91c446365a324120ae8e75466b76efa4d0f28f9"],
    },
    {
      parameter: "a6437bf1be4beb49e61df7edb497f46a680eac4e3721b858a6e3f43561d9d36c",
      program: "d3af06e5a4ac1b1ede51ba4425042ee3d2d9f04cb9ede27a78c733c957cca061",
      fragment: [2860, "e07a14939c2270f4decfa8fd759749f8e8b61969e67cbcc7751a6f2a9875d3ed", "2055759b1718c48e84ee86b08bd3718ebafe96a5608061d47929e9292d3f34e1"],
      vertex: [3604, "345ad63197d4f528fd23b42ca3f5630600ab0e9738b3eb646c198a1eec71f6ff", "22f12402346bba65049faf22b8f9610c511ff6d09284c2c89c9ba91d45818f49"],
    },
    {
      parameter: "b226335b552b116b73f2a1f3825e5b993f206c7c9a68933647cfd8936ebc36ab",
      program: "b2a841a47e114952d615bdd320d1e7051df969099e37875098b28262e6ec7800",
      fragment: [4176, "0b715f2bb9ce16be7898d38ba63c80764fddedc0d938e3e56632f74cd89dbbfe", "1040b8ae982ea390e6c1ac2ef767d8e39b36f51e17b57e1291ebdd72b21df230"],
      vertex: [3504, "b4cd4802893d1bfd1042386e3f79bafaf658b502707d005fb2df76cb8a747e02", "8d89faf0eca65a3a0a48597c8c5fcaeb3c6d72c243576a1464ad292057c9542e"],
    },
    {
      parameter: "8f688399ea775476cd53ac5139a0f1b92659437299499a8e3f511dedd9087204",
      program: "f7cea732009cf2b172dfa6bdfe97ae115ce0d2f5e5ecbbcf5345312e8e247eb2",
      fragment: [3432, "64e5101598193c179f84aa18625d472595c3c7f188037d870e541cda7e1524ad", "839452c5f1a8891d5df4f47a425396779cb4d0111f2fea0b25dc7bbe1ddee30a"],
      vertex: [3504, "47d77db73cb2da6e5ddbd9aa29b273f30e4662002f18b0e072751f6306082b21", "687dc32769a6d7c7f19881b1f954683fd4060de5f3f21e2372bc6dfccd8e5af3"],
    },
    {
      parameter: "f48c52f47256668fe904e5086210156d55dfb4e3561fb99686bef582ce84b078",
      program: "e58a9b189797b38661b0a1ec56e0b957cc14c5e984cc3720e8af28f8b4aa93cc",
      fragment: [1408, "3cd41d46192418a497e907d947d328b948bb6f99855cadbefb8f5a52fcbf2586", "717601609788e2ccb6ebdfa637e797e8e136a4c4753f73f331415916f9362758"],
      vertex: [3604, "240d6492f4889dfd160e84881a59dcd0c3c0e4e84c6b494cc9c06aea00926f56", "8377b16c462212ee62d3679bce6dd96033ce811e7545b9cabd9e24959e944c57"],
    },
    {
      parameter: "3587f63135b4dd7aab5bdf0e2488a68d3f8ea3ad15891808d6b7274165e97bbf",
      program: "c25d8ba99d108fe51249427a2ee17dfe7e5d326994233b2761cee5e68c654d38",
      fragment: [1052, "aaa4a2b3e10d9ee617e167bab26754c6b045ca448db5023c6d30afb6fc99606c", "8eb95b30ac0f8d31ae556f83b77fe7b635aa9e3fef101c157df923d168faa878"],
      vertex: [3504, "47d77db73cb2da6e5ddbd9aa29b273f30e4662002f18b0e072751f6306082b21", "687dc32769a6d7c7f19881b1f954683fd4060de5f3f21e2372bc6dfccd8e5af3"],
    },
  ],
};

const ADAPT = [
  {
    attributes: [
      ["layout(location = 1) in vec2 _86;", "in vec2 uv;"],
    ],
    vertexAssignments: [["vs_TEXCOORD0 = _86;", "vs_TEXCOORD0 = uv;"]],
    fragmentUbo: null,
    samplers: [["_13", "_MainTex"]],
    interface: { attributes: { position: "vec3", uv: "vec2" }, varyings: { vUv: "vec2" } },
  },
  {
    attributes: [
      ["layout(location = 1) in vec4 _91;", "in vec4 color;"],
      ["layout(location = 2) in vec2 _97;", "in vec2 uv;"],
    ],
    vertexAssignments: [["_90 = _91;", "_90 = color;"], ["vs_TEXCOORD0 = _97;", "vs_TEXCOORD0 = uv;"]],
    vertexRenames: [["_90", "vColor"]],
    fragmentRenames: [["_89", "vColor"]],
    fragmentUbo: {
      block: "_15_17", owner: "_17",
      uniforms: ["uniform highp vec4 _MainTex_TexelSize;"],
      members: [["_m0", "_MainTex_TexelSize"]],
    },
    samplers: [["_31", "_MainTex"]],
    interface: { attributes: { position: "vec3", color: "vec4", uv: "vec2" }, varyings: { vColor: "vec4", vUv: "vec2" } },
  },
  {
    attributes: [
      ["layout(location = 1) in vec3 _94;", "in vec3 uvSelector;"],
    ],
    vertexAssignments: [["vs_TEXCOORD0 = _94;", "vs_TEXCOORD0 = uvSelector;"]],
    fragmentUbo: null,
    samplers: ["_38", "_55", "_69", "_83", "_97", "_111", "_127"].map((name, index) => [name, `_DownSampling${index + 1}Tex`]),
    interface: { attributes: { position: "vec3", uvSelector: "vec3" }, varyings: { vUv: "vec3" } },
  },
  {
    attributes: [
      ["layout(location = 1) in vec2 _94;", "in vec2 uv;"],
    ],
    vertexAssignments: [["vs_TEXCOORD0 = _94;", "vs_TEXCOORD0 = uv;"]],
    fragmentUbo: {
      block: "_11_13", owner: "_13",
      uniforms: [
        "uniform highp vec2 _GlobalMipBias;",
        "uniform highp vec4 _MainTex_TexelSize;",
        "uniform vec2 _Vector;",
      ],
      members: [["_m0", "_GlobalMipBias"], ["_m1", "_MainTex_TexelSize"], ["_m2", "_Vector"]],
    },
    samplers: [["_85", "_MainTex"]],
    interface: { attributes: { position: "vec3", uv: "vec2" }, varyings: { vUv: "vec2" } },
  },
  {
    attributes: [
      ["layout(location = 1) in vec4 _91;", "in vec4 color;"],
      ["layout(location = 2) in vec3 _97;", "in vec3 uvw;"],
    ],
    vertexAssignments: [["_90 = _91;", "_90 = color;"], ["vs_TEXCOORD0 = _97;", "vs_TEXCOORD0 = uvw;"]],
    vertexRenames: [["_90", "vColor"]],
    fragmentRenames: [["_35", "vColor"]],
    fragmentUbo: {
      block: "_21_23", owner: "_23",
      uniforms: ["uniform highp vec2 _GlobalMipBias;"],
      members: [["_m0", "_GlobalMipBias"]],
    },
    samplers: [["_13", "_MainTex"]],
    interface: { attributes: { position: "vec3", color: "vec4", uvw: "vec3" }, varyings: { vColor: "vec4", vUv: "vec3" } },
  },
  {
    attributes: [
      ["layout(location = 1) in vec2 _94;", "in vec2 uv;"],
    ],
    vertexAssignments: [["vs_TEXCOORD0 = _94;", "vs_TEXCOORD0 = uv;"]],
    fragmentUbo: {
      block: "_19_21", owner: "_21",
      uniforms: ["uniform highp vec2 _GlobalMipBias;"],
      members: [["_m0", "_GlobalMipBias"]],
    },
    samplers: [["_13", "_MainTex"]],
    interface: { attributes: { position: "vec3", uv: "vec2" }, varyings: { vUv: "vec2" } },
  },
];

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });
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

function equal(actual, expected, label) {
  if (actual !== expected) throw new Error(`${label}: expected ${expected}, got ${actual}`);
}

function replaceOnce(source, before, after, label) {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`${label}: source pattern was not found`);
  if (source.indexOf(before, first + before.length) >= 0) throw new Error(`${label}: source pattern was not unique`);
  return source.slice(0, first) + after + source.slice(first + before.length);
}

function replaceToken(source, before, after) {
  const pattern = new RegExp(`\\b${before}\\b`, "g");
  if (!pattern.test(source)) throw new Error(`token ${before} was not found`);
  return source.replace(pattern, after);
}

function stripVersion(source) {
  const normalized = source.replace(/\r\n/g, "\n");
  return replaceOnce(normalized, "#version 300 es\n", "", "GLSL version removal");
}

function removeVertexUbos(source, expectedCount) {
  let count = 0;
  const result = source.replace(/layout\(std140\) uniform \w+\n\{[\s\S]*?\n\}\s+\w+;\n\n/g, () => {
    count += 1;
    return "";
  });
  equal(count, expectedCount, "vertex UBO count");
  return result;
}

function adaptVertex(source, cfg, pass) {
  let out = stripVersion(source);
  out = removeVertexUbos(out, pass === 0 ? 1 : 2);
  out = replaceOnce(out, "layout(location = 0) in vec4 _11;", "in vec3 position;", `pass ${pass} position attribute`);
  for (const [before, after] of cfg.attributes) {
    out = replaceOnce(out, before, after, `pass ${pass} attribute ${before}`);
  }
  out = out.replace(/^vec4 _9;\n/m, "").replace(/^vec4 _(48|52);\n/m, "");
  const transform = /    _9 = _11\.yyyy[\s\S]*?    gl_Position = [^\n]+;\n/;
  if (!transform.test(out)) throw new Error(`pass ${pass} official vertex transform was not found`);
  out = out.replace(transform, "    gl_Position = vec4(position, 1.0);\n");
  for (const [before, after] of cfg.vertexAssignments) {
    out = replaceOnce(out, before, after, `pass ${pass} vertex assignment`);
  }
  out = replaceOnce(out, "    gl_Position.y = -gl_Position.y;\n", "", `pass ${pass} Vulkan Y flip`);
  out = replaceToken(out, "vs_TEXCOORD0", "vUv");
  for (const [before, after] of cfg.vertexRenames || []) out = replaceToken(out, before, after);
  if (/\b_11\b|layout\(std140\)|gl_Position\.y\s*=/.test(out)) {
    throw new Error(`pass ${pass} vertex adaptation is incomplete`);
  }
  return `precision highp float;\nprecision highp int;\n\n${out.trim()}\n`;
}

function replaceFragmentUbo(source, cfg, pass) {
  if (!cfg) {
    if (/layout\(std140\) uniform/.test(source)) throw new Error(`pass ${pass} has an unexpected fragment UBO`);
    return source;
  }
  const pattern = new RegExp(`layout\\(std140\\) uniform ${cfg.block}\\n\\{[\\s\\S]*?\\n\\} ${cfg.owner};\\n`);
  if (!pattern.test(source)) throw new Error(`pass ${pass} fragment UBO ${cfg.block} was not found`);
  let out = source.replace(pattern, cfg.uniforms.join("\n"));
  for (const [member, uniform] of cfg.members) {
    out = replaceToken(out, `${cfg.owner}.${member}`, uniform);
  }
  if (out.includes(`${cfg.owner}.`) || out.includes(cfg.block)) throw new Error(`pass ${pass} fragment UBO adaptation is incomplete`);
  return out;
}

function adaptFragment(source, cfg, pass) {
  let out = replaceFragmentUbo(stripVersion(source), cfg.fragmentUbo, pass);
  for (const [before, after] of cfg.samplers) out = replaceToken(out, before, after);
  out = replaceToken(out, "vs_TEXCOORD0", "vUv");
  for (const [before, after] of cfg.fragmentRenames || []) out = replaceToken(out, before, after);
  const output = (out.match(/layout\(location = 0\) out vec4 (\w+);/) || [])[1];
  if (!output) throw new Error(`pass ${pass} fragment output was not found`);
  out = replaceToken(out, output, "outColor");
  if (pass === 5) {
    out = replaceOnce(
      out,
      "layout(location = 0) out vec4 outColor;",
      "layout(location = 0) out vec4 outColor;\nlayout(location = 1) out vec4 outEmissive;",
      "pass 5 WebGL MRT secondary output declaration",
    );
    out = replaceOnce(
      out,
      "    outColor = _9;",
      "    outColor = _9;\n    outEmissive = vec4(0.0);",
      "pass 5 WebGL MRT secondary no-op",
    );
  }
  if (/layout\(std140\) uniform/.test(out)) throw new Error(`pass ${pass} fragment adaptation left a UBO`);
  return `${out.trim()}\n`;
}

function readEvidence() {
  const text = run(PYTHON, ["build/extract_official_bloom_program.py"], {
    maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
    shell: process.platform === "win32",
  });
  return JSON.parse(text);
}

function assertEvidence(bloom) {
  equal(officialSample.artifacts.apkm.sha256, PINNED.source.apkmSha256, "current official sample APKM hash");
  for (const [key, expected] of Object.entries(PINNED.source)) equal(bloom.source?.[key], expected, `source.${key}`);
  for (const [key, expected] of Object.entries(PINNED.asset)) equal(bloom.shaderAsset?.[key], expected, `asset.${key}`);
  for (const [key, expected] of Object.entries(PINNED.program)) equal(bloom.shaderProgram?.[key], expected, `program.${key}`);
  equal(bloom.shaderProgram?.passes?.length, PINNED.passes.length, "Bloom pass count");
  for (let pass = 0; pass < PINNED.passes.length; pass += 1) {
    const actual = bloom.shaderProgram.passes[pass];
    const pinned = PINNED.passes[pass];
    equal(actual.pass, pass, `pass ${pass} index`);
    equal(actual.parameterEntry.sha256, pinned.parameter, `pass ${pass} parameter entry hash`);
    equal(actual.programEntry.sha256, pinned.program, `pass ${pass} program entry hash`);
    for (const stage of ["fragment", "vertex"]) {
      const module = actual.modules.find((item) => item.stage === stage);
      if (!module) throw new Error(`pass ${pass} ${stage} module is missing`);
      equal(module.byteSize, pinned[stage][0], `pass ${pass} ${stage} byte size`);
      equal(module.sha256, pinned[stage][1], `pass ${pass} ${stage} module hash`);
    }
  }
}

try {
  const bloom = readEvidence();
  assertEvidence(bloom);
  const outputs = {};
  const manifestPasses = [];

  for (let pass = 0; pass < PINNED.passes.length; pass += 1) {
    const actual = bloom.shaderProgram.passes[pass];
    const pinned = PINNED.passes[pass];
    const cfg = ADAPT[pass];
    const stages = {};

    for (const stage of ["vertex", "fragment"]) {
      const module = actual.modules.find((item) => item.stage === stage);
      const bytes = Buffer.from(module.spvHex, "hex");
      equal(bytes.length, pinned[stage][0], `pass ${pass} ${stage} decoded byte size`);
      equal(sha256(bytes), pinned[stage][1], `pass ${pass} ${stage} decoded module hash`);
      const spv = path.join(tmp, `bloom_pass${pass}.${stage}.spv`);
      fs.writeFileSync(spv, bytes);
      const reflection = JSON.parse(run(SPIRV_CROSS, [spv, "--reflect"]));
      const reflectedSha256 = reflectionHash(reflection);
      equal(reflectedSha256, pinned[stage][2], `pass ${pass} ${stage} reflection hash`);
      const officialGlsl = run(SPIRV_CROSS, [spv, "--version", "300", "--es"]);
      const name = `bloom_pass${pass}.${stage === "vertex" ? "vert" : "frag"}.glsl`;
      outputs[name] = stage === "vertex"
        ? adaptVertex(officialGlsl, cfg, pass)
        : adaptFragment(officialGlsl, cfg, pass);
      stages[stage] = {
        byte_size: pinned[stage][0],
        spirv_sha256: pinned[stage][1],
        reflection_sha256: reflectedSha256,
      };
    }

    manifestPasses.push({
      pass,
      parameter_entry_sha256: pinned.parameter,
      program_entry_sha256: pinned.program,
      render_state: actual.renderState,
      modules: stages,
      attributes: cfg.interface.attributes,
      varyings: cfg.interface.varyings,
      samplers: Object.fromEntries(cfg.samplers.map(([, official]) => [official, official])),
      uniforms: cfg.fragmentUbo ? cfg.fragmentUbo.members.map(([, uniform]) => uniform) : [],
      webgl_mrt_secondary_noop: pass === 5,
    });
  }

  outputs["bloom_programs.json"] = `${JSON.stringify({
    shader: PINNED.asset.name,
    generated_by: "build/build-exact-bloom.mjs",
    official: {
      sample_id: officialSample.sampleId,
      sample_manifest_sha256: officialSampleSha256,
      apkm_sha256: PINNED.source.apkmSha256,
      asset_sha256: PINNED.asset.rawSha256,
      compressed_program_sha256: PINNED.program.compressedSha256,
      decompressed_program_sha256: PINNED.program.decompressedSha256,
      program_set_sha256: PINNED.program.programSetSha256,
    },
    passes: manifestPasses,
  }, null, 2)}\n`;

  fs.mkdirSync(OUT, { recursive: true });
  for (const [name, content] of Object.entries(outputs)) {
    const file = path.join(OUT, name);
    if (CHECK) {
      if (!fs.existsSync(file) || fs.readFileSync(file, "utf8") !== content) {
        throw new Error(`${name} does not match the current pinned official Bloom generation`);
      }
    } else {
      fs.writeFileSync(file, content);
    }
  }

  console.log(`${CHECK ? "verified" : "generated"} ${PINNED.passes.length} official Bloom passes (${PINNED.asset.rawSha256.slice(0, 12)})`);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
