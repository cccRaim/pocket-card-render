// Guard the shared parallax families against drifting away from official
// bytecode. `Card_Parallax` and `Card_Parallax_Metal` share the same tangent
// view-depth offset, but only the plain parallax shader applies the 1.6087
// vertical aspect correction. That difference is easy to "clean up" by mistake.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const shaderRoot = process.env.PCR_SHADERS
  || "D:/DevProjectes/ptcgp-tools-master/masterdata_decoder/.output/decrypted/Common/Shader";

function dump(shader) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pcr-parallax-"));
  try {
    const prefix = shader.replace(/[^A-Za-z0-9_]/g, "_");
    execFileSync("python", [
      "build/shaderdec/dump_shader.py",
      shader,
      prefix,
      "--shaders",
      shaderRoot,
      "--out",
      tmp,
    ], { cwd: ROOT, shell: true, stdio: ["ignore", "ignore", "ignore"] });
    const vert = execFileSync("spirv-cross", [path.join(tmp, `${prefix}_vert.spv`), "--version", "300", "--es"], { encoding: "utf8" });
    const frag = execFileSync("spirv-cross", [path.join(tmp, `${prefix}_frag.spv`), "--version", "300", "--es"], { encoding: "utf8" });
    return { vert, frag };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
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
let parallax = { vert: "", frag: "" };
let metal = { vert: "", frag: "" };
try {
  parallax = dump("Card_Parallax");
  metal = dump("Card_Parallax_Metal");
} catch (err) {
  issues.push(`official parallax shader dump failed: ${err.message.split(/\r?\n/)[0]}`);
}

const baseSrc = fs.readFileSync(path.join(ROOT, "public/render/materials/base.js"), "utf8");
const urSrc = fs.readFileSync(path.join(ROOT, "public/render/materials/ur.js"), "utf8");
const localDepth = blockFrom(baseSrc, 'defineMaterial("depthParallax"');
const localMetal = blockFrom(urSrc, 'defineMaterial("metal"');

const checks = [
  {
    ok: /0\.419999986886978/.test(parallax.vert) && /0\.419999986886978/.test(metal.vert),
    msg: "official parallax shaders must use the 0.42 tangent-view denominator bias",
  },
  {
    ok: /1\.608700037002563/.test(parallax.vert),
    msg: "official Card_Parallax must apply the 1.608700037 vertical aspect correction",
  },
  {
    ok: !/1\.608700037002563/.test(metal.vert),
    msg: "official Card_Parallax_Metal must not apply the plain-parallax vertical aspect correction",
  },
  {
    ok: /_305\s*=\s*vec4\(0\.0\)/.test(metal.frag),
    msg: "official Card_Parallax_Metal MRT1 must be zero",
  },
  {
    ok: /_194\s*=\s*vec4\(0\.0\)/.test(parallax.frag) || /layout\(location = 1\)/.test(parallax.frag),
    msg: "official Card_Parallax fragment MRT shape must be reflected",
  },
  {
    ok: /tv\.z\s*\+\s*0\.41999998688697815/.test(localDepth),
    msg: "local depthParallax must keep the official 0.42 tangent-view denominator bias",
  },
  {
    ok: /off\.y\s*\*=\s*uAspectY/.test(localDepth) && /1\.6087000370025635/.test(localDepth),
    msg: "local depthParallax must keep the official vertical aspect correction path",
  },
  {
    ok: /tv\.z\s*\+\s*0\.41999998688697815/.test(localMetal),
    msg: "local metal must keep the official 0.42 tangent-view denominator bias",
  },
  {
    ok: !/off\.y\s*\*=/.test(localMetal) && !/uAspectY/.test(localMetal),
    msg: "local metal must not inherit depthParallax vertical aspect correction",
  },
  {
    ok: /pow\(clamp\(-R\.z,\s*0\.0,\s*1\.0\),\s*uSpecPow\)/.test(localMetal),
    msg: "local metal must use official -reflect.z grazing power",
  },
];

for (const check of checks) {
  if (!check.ok) issues.push(check.msg);
}

if (issues.length) {
  console.error(`Parallax core audit failed: ${issues.length} issue(s) found`);
  for (const issue of issues) console.error(`BAD ${issue}`);
  process.exit(1);
}

console.log("Parallax core audit OK");
