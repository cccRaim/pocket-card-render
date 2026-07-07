// Guard the remaining visible UR shaders not covered by the broader UR constant audit.
//
// `Card_Parallax_UR` is the diagonal gold base layer, while `Transparent-UR-New`
// is the UR rule/UI foil. Together they are the last unguarded visible shader
// families in the current reference scenes.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const shaderRoot = process.env.PCR_SHADERS
  || "D:/DevProjectes/ptcgp-tools-master/masterdata_decoder/.output/decrypted/Common/Shader";

function dump(shader, prefix) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pcr-ur-rem-"));
  try {
    execFileSync("python", [
      "build/shaderdec/dump_shader.py",
      shader,
      prefix,
      "--shaders",
      shaderRoot,
      "--out",
      tmp,
    ], { cwd: ROOT, shell: true, stdio: ["ignore", "ignore", "ignore"] });
    return {
      vert: execFileSync("spirv-cross", [path.join(tmp, `${prefix}_vert.spv`), "--version", "300", "--es"], { encoding: "utf8" }),
      frag: execFileSync("spirv-cross", [path.join(tmp, `${prefix}_frag.spv`), "--version", "300", "--es"], { encoding: "utf8" }),
    };
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

function hasHoloRampCore(frag) {
  return /vec3\(-0\.01745329238474369/.test(frag)
    && /\*\s*0\.25/.test(frag)
    && /\+\s*vec2\(0\.25\)/.test(frag)
    && /\.y\s*=\s*0\.5\s*;[\s\S]{0,500}texture\(/.test(frag)
    && /clamp\([^;]+,\s*0\.0,\s*1\.0\)/.test(frag);
}

const issues = [];
let parallax = { vert: "", frag: "" };
let transparent = { vert: "", frag: "" };
try {
  parallax = dump("Card_Parallax_UR", "ur_parallax");
  transparent = dump("Transparent-UR-New", "ur_transparent");
} catch (err) {
  issues.push(`official UR remainder shader dump failed: ${err.message.split(/\r?\n/)[0]}`);
}

const urSrc = fs.readFileSync(path.join(ROOT, "public/render/materials/ur.js"), "utf8");
const holoSrc = fs.readFileSync(path.join(ROOT, "public/render/materials/holo.js"), "utf8");
const localParallax = blockFrom(urSrc, "function parallaxUrMaterial");
const localTransparent = blockFrom(holoSrc, "function exHoloUrMaterial");

const checks = [
  {
    ok: /0\.419999986886978/.test(parallax.vert),
    msg: "official Card_Parallax_UR vertex must use the 0.42 tangent-view denominator bias",
  },
  {
    ok: /_276\s*=\s*vec4\(0\.0\)/.test(parallax.frag),
    msg: "official Card_Parallax_UR MRT1 must be zero",
  },
  {
    ok: /sin\(_9\.x\)[\s\S]{0,80}_44\.x\s*\*=\s*_44\.x/.test(parallax.frag)
      && /-_\d+\._m2/.test(parallax.frag),
    msg: "official Card_Parallax_UR must keep view-angle darkness wave and _DarknessOffset gate",
  },
  {
    ok: /tv\.z\s*\+\s*0\.41999998688697815/.test(localParallax),
    msg: "local parallaxUR must keep official 0.42 tangent-view denominator bias",
  },
  {
    ok: /sin\(darkAngle\s*\*\s*3\.0\)/.test(localParallax)
      && /-\s*uDarkOffset/.test(localParallax)
      && /t\.rgb\s*\*\s*uDarkColor/.test(localParallax),
    msg: "local parallaxUR must keep official view-angle darkness wave and material color gate",
  },
  {
    ok: hasHoloRampCore(transparent.frag),
    msg: "official Transparent-UR-New must keep holo rotation, phase remap, ramp y=0.5, and clamped interval core",
  },
  {
    ok: /1\.696459650993347/.test(transparent.vert)
      && /0\.582111895084381/.test(transparent.vert)
      && /2\.392985105514526/.test(transparent.vert)
      && /2\.094394683837890/.test(transparent.vert),
    msg: "official Transparent-UR-New vertex must keep fake-spec corner pulse constants",
  },
  {
    ok: /0\.298911988735198/.test(transparent.frag)
      && /0\.586610972881317/.test(transparent.frag)
      && /0\.114477999508380/.test(transparent.frag),
    msg: "official Transparent-UR-New fragment must keep darkness luminance weights",
  },
  {
    ok: /_875\s*=\s*vec4\(0\.0\)/.test(transparent.frag),
    msg: "official Transparent-UR-New MRT1 must be zero",
  },
  {
    ok: /1\.69645965/.test(localTransparent)
      && /0\.5821119/.test(localTransparent)
      && /2\.3929851/.test(localTransparent)
      && /2\.0943947/.test(localTransparent),
    msg: "local exHoloUR must keep official fake-spec corner pulse constants",
  },
  {
    ok: /-0\.01745329238474369/.test(localTransparent)
      && /\*\s*0\.25\s*\+\s*0\.25/.test(localTransparent)
      && /texture2D\(ramp,\s*vec2\(U,\s*0\.5\)\)/.test(localTransparent)
      && /clamp\([^;]+,\s*0\.0,\s*1\.0\)/.test(localTransparent),
    msg: "local exHoloUR must keep official holo ramp core",
  },
  {
    ok: /dot\(c,\s*vec3\(0\.298912,\s*0\.586611,\s*0\.114478\)\)/.test(localTransparent)
      && /uDarkOffset/.test(localTransparent)
      && /specMask/.test(localTransparent),
    msg: "local exHoloUR must keep official luminance-gated fake spec/darkness path",
  },
];

for (const check of checks) {
  if (!check.ok) issues.push(check.msg);
}

if (issues.length) {
  console.error(`UR remainder core audit failed: ${issues.length} issue(s) found`);
  for (const issue of issues) console.error(`BAD ${issue}`);
  process.exit(1);
}

console.log("UR remainder core audit OK");
