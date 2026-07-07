// Pin the high-volume `Effect` shader strategy to the official bytecode shape.
//
// Effect is the largest unguarded visible-layer family in the reference scenes.
// The official fragment path is compact: sample a packed channel, shape it with
// a smoothstep-like edge, recolor through the gradation ramp at y=0.5, optionally
// blend in a view-offset alpha mask, and write zero to MRT1.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const shaderRoot = process.env.PCR_SHADERS
  || "D:/DevProjectes/ptcgp-tools-master/masterdata_decoder/.output/decrypted/Common/Shader";

function dumpEffect() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pcr-effect-"));
  execFileSync("python", [
    "build/shaderdec/dump_shader.py",
    "Effect",
    "Effect",
    "--shaders",
    shaderRoot,
    "--out",
    tmp,
  ], { cwd: ROOT, shell: true, stdio: ["ignore", "ignore", "ignore"] });
  const frag = path.join(tmp, "Effect_frag.spv");
  const vert = path.join(tmp, "Effect_vert.spv");
  const fragGlsl = execFileSync("spirv-cross", [frag, "--version", "300", "--es"], { encoding: "utf8" });
  const vertGlsl = execFileSync("spirv-cross", [vert, "--version", "300", "--es"], { encoding: "utf8" });
  fs.rmSync(tmp, { recursive: true, force: true });
  return { fragGlsl, vertGlsl };
}

function blockFrom(source, marker) {
  const start = source.indexOf(marker);
  if (start < 0) return "";
  const open = source.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  return "";
}

const issues = [];
let official;
try {
  official = dumpEffect();
} catch (err) {
  issues.push(`official Effect shader dump failed: ${err.message.split(/\r?\n/)[0]}`);
  official = { fragGlsl: "", vertGlsl: "" };
}

const local = blockFrom(fs.readFileSync(path.join(ROOT, "public/render/materials/base.js"), "utf8"), 'defineMaterial("effect"');

const checks = [
  {
    ok: /_194\s*=\s*vec4\(0\.0\)/.test(official.fragGlsl),
    msg: "official Effect MRT1 must be zero",
  },
  {
    ok: /(?:\.\w+|x)\s*=\s*0\.5\s*;[\s\S]*texture\([^,]+,\s*[^)]*(?:\.wx|\.xy)/.test(official.fragGlsl),
    msg: "official Effect samples gradation ramp at y=0.5",
  },
  {
    ok: /\*\s*\(-2\.0\)\)\s*\+\s*3\.0/.test(official.fragGlsl) || /\+\s*3\.0/.test(official.fragGlsl),
    msg: "official Effect edge path must contain smoothstep 3-2t polynomial",
  },
  {
    ok: /vs_TEXCOORD1\s*=\s*_9\.xyz/.test(official.vertGlsl),
    msg: "official Effect vertex must output tangent-space view vector",
  },
  {
    ok: /t\s*\*\s*t\s*\*\s*\(3\.0\s*-\s*2\.0\s*\*\s*t\)/.test(local),
    msg: "local Effect must keep the official smoothstep edge polynomial",
  },
  {
    ok: /texture2D\(gradMap,\s*vec2\(gradU,\s*0\.5\)\)/.test(local),
    msg: "local Effect must sample the gradation ramp at y=0.5",
  },
  {
    ok: /vUv\s*\+\s*vView\.xy\s*\*\s*uAnglePower/.test(local),
    msg: "local Effect must use view-offset alpha mask",
  },
  {
    ok: /alphaCore\s*\*\s*uAlphaBlend/.test(local),
    msg: "local Effect must apply _AlphaBlend to output alpha",
  },
];

for (const check of checks) {
  if (!check.ok) issues.push(check.msg);
}

if (issues.length) {
  console.error(`Effect core audit failed: ${issues.length} issue(s) found`);
  for (const issue of issues) console.error(`BAD ${issue}`);
  process.exit(1);
}

console.log("Effect core audit OK");
