// Guard the shared parallax families against drifting away from official
// bytecode. Card_Parallax's aspect correction is a compiled keyword variant:
// SQUARE has no correction, while CARDWINDOW applies 1.6087.
import fs from "node:fs";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const shaderRoot = process.env.PCR_SHADERS
  || "D:/DevProjectes/ptcgp-tools-master/masterdata_decoder/.output/decrypted/Common/Shader";

function dump(shader, keyword = null) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pcr-parallax-"));
  try {
    const prefix = shader.replace(/[^A-Za-z0-9_]/g, "_");
    const dumpArgs = [
      "build/shaderdec/dump_shader.py",
      shader,
      prefix,
      "--shaders",
      shaderRoot,
      "--out",
      tmp,
    ];
    if (keyword) dumpArgs.push("--keyword", keyword);
    execFileSync("python", dumpArgs, { cwd: ROOT, shell: true, stdio: ["ignore", "ignore", "ignore"] });
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
let parallaxWindow = { vert: "", frag: "" };
let metal = { vert: "", frag: "" };
try {
  parallax = dump("Card_Parallax", "_UVASPECTRATIO_SQUARE");
  parallaxWindow = dump("Card_Parallax", "_UVASPECTRATIO_CARDWINDOW");
  metal = dump("Card_Parallax_Metal");
} catch (err) {
  issues.push(`official parallax shader dump failed: ${err.message.split(/\r?\n/)[0]}`);
}

const baseSrc = fs.readFileSync(path.join(ROOT, "public/render/materials/base.js"), "utf8");
const urSrc = fs.readFileSync(path.join(ROOT, "public/render/materials/ur.js"), "utf8");
const exactDepthSrc = fs.readFileSync(path.join(ROOT, "public/shaders/card_parallax.vert.glsl"), "utf8");
const exactMetalVertSrc = fs.readFileSync(path.join(ROOT, "public/shaders/card_parallax_metal.vert.glsl"), "utf8");
const exactMetalFragSrc = fs.readFileSync(path.join(ROOT, "public/shaders/card_parallax_metal.frag.glsl"), "utf8");
const depthManifests = [
  "card_parallax_uniforms.json",
  "card_parallax_native_best_match_uniforms.json",
].map((file) => JSON.parse(fs.readFileSync(path.join(ROOT, "public/shaders", file), "utf8")));
const metalManifest = JSON.parse(fs.readFileSync(path.join(ROOT, "public/shaders/card_parallax_metal_uniforms.json"), "utf8"));
const localDepth = blockFrom(baseSrc, 'defineMaterial("depthParallax"');
const localMetal = blockFrom(urSrc, 'defineMaterial("metal"');
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");

const checks = [
  {
    ok: /0\.419999986886978/.test(parallax.vert) && /0\.419999986886978/.test(metal.vert),
    msg: "official parallax shaders must use the 0.42 tangent-view denominator bias",
  },
  {
    ok: !/1\.608700037002563/.test(parallax.vert),
    msg: "official Card_Parallax SQUARE variant must not apply vertical aspect correction",
  },
  {
    ok: /1\.608700037002563/.test(parallaxWindow.vert),
    msg: "official Card_Parallax CARDWINDOW variant must apply the 1.608700037 correction",
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
    ok: /exactParallaxMaterial\(r,\s*ctx\)/.test(localDepth)
      && /const exact = ctx\.exactShaderPort\(r\)/.test(baseSrc)
      && /official_selector\.selectionMode/.test(baseSrc),
    msg: "local depthParallax exact path must be selector-gated",
  },
  {
    ok: depthManifests.every((manifest) => (
      manifest.generated_by === "build/build-exact-card-parallax.mjs"
      && manifest.webgl_adaptation?.vertex?.outputSha256 === sha256(exactDepthSrc)
      && manifest.webgl_adaptation?.vertex?.spirvCrossGlslSha256 === sha256(parallax.vert)
    )),
    msg: "local exact Card_Parallax vertex must be generator/hash-bound to the official selector",
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
    ok: metalManifest.generated_by === "build/build-exact-card-parallax-metal.mjs"
      && metalManifest.official_selector?.selectorId === "544f051f64a5292f13cef7ef205e59652f7884369fe33ea752e2bd6999ea56d0"
      && metalManifest.webgl_adaptation?.vertex?.outputSha256 === sha256(exactMetalVertSrc)
      && metalManifest.webgl_adaptation?.vertex?.spirvCrossGlslSha256 === sha256(metal.vert),
    msg: "local exact Card_Parallax_Metal vertex must be generator/hash-bound to the official selector",
  },
  {
    ok: metalManifest.webgl_adaptation?.fragment?.outputSha256 === sha256(exactMetalFragSrc)
      && metalManifest.webgl_adaptation?.fragment?.spirvCrossGlslSha256 === sha256(metal.frag),
    msg: "local exact Card_Parallax_Metal fragment must be generator/hash-bound to the official selector",
  },
  {
    ok: /_305\s*=\s*vec4\(0\.0\)/.test(exactMetalFragSrc),
    msg: "local exact Card_Parallax_Metal fragment must preserve the official zero MRT1 output",
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
