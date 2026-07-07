// Pin the classic holo shader family to official bytecode anchors.
//
// These shaders share the same phase/ramp diffraction core but differ in
// material role: card window holo, border holo, EX/rule UI holo, rarity mark,
// and shadowbox body. This audit does not claim full GLSL equivalence; it keeps
// the data-driven strategies tied to the official bytecode shapes that define
// the visible holo behavior.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const shaderRoot = process.env.PCR_SHADERS
  || "D:/DevProjectes/ptcgp-tools-master/masterdata_decoder/.output/decrypted/Common/Shader";

const SHADERS = [
  { name: "Transparent_Hologram_Tuning", prefix: "holo_trans" },
  { name: "Frame-Holo-Tuning", prefix: "holo_frame" },
  { name: "Card_Hologram_Tuning", prefix: "holo_card" },
  { name: "Opaque_Hologram_Tuning", prefix: "holo_opaque_ui" },
  { name: "Opaque-Hologram_Tuning", prefix: "holo_opaque_shadow" },
  { name: "Simple-Opaque-Hologram_Tuning", prefix: "holo_simple_opaque" },
  { name: "Card_Parallax_Hologram_Tuning", prefix: "holo_parallax" },
];

function dumpAll() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pcr-holo-"));
  const out = new Map();
  try {
    for (const shader of SHADERS) {
      execFileSync("python", [
        "build/shaderdec/dump_shader.py",
        shader.name,
        shader.prefix,
        "--shaders",
        shaderRoot,
        "--out",
        tmp,
      ], { cwd: ROOT, shell: true, stdio: ["ignore", "ignore", "ignore"] });
      const vert = execFileSync("spirv-cross", [path.join(tmp, `${shader.prefix}_vert.spv`), "--version", "300", "--es"], { encoding: "utf8" });
      const frag = execFileSync("spirv-cross", [path.join(tmp, `${shader.prefix}_frag.spv`), "--version", "300", "--es"], { encoding: "utf8" });
      out.set(shader.name, { vert, frag });
    }
    return out;
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

function hasRampCore(frag) {
  return /vec3\(-0\.01745329238474369/.test(frag)
    && /\*\s*0\.25/.test(frag)
    && /\+\s*vec2\(0\.25\)/.test(frag)
    && /\.y\s*=\s*0\.5\s*;[\s\S]{0,500}texture\(/.test(frag)
    && /clamp\([^;]+,\s*0\.0,\s*1\.0\)/.test(frag);
}

function localHasRampCore(source) {
  return /-0\.01745329238474369/.test(source)
    || /-\s*uRot\s*\*\s*0\.01745329238474369/.test(source)
    || /-\s*uRotation\s*\*\s*0\.01745329238474369/.test(source);
}

function localHasFullRampCore(source) {
  return localHasRampCore(source)
    && /\*\s*0\.25\s*\+\s*0\.25/.test(source)
    && /texture2D\([^,]+,\s*vec2\([^,]+,\s*0\.5\)\)/.test(source)
    && /clamp\([^;]+,\s*0\.0,\s*1\.0\)/.test(source);
}

const issues = [];
let official = new Map();
try {
  official = dumpAll();
} catch (err) {
  issues.push(`official holo shader dump failed: ${err.message.split(/\r?\n/)[0]}`);
}

const holoSrc = fs.readFileSync(path.join(ROOT, "public/render/materials/holo.js"), "utf8");
const local = {
  holo: blockFrom(holoSrc, "function holoMaterial"),
  frameHolo: blockFrom(holoSrc, "function frameHoloMaterial"),
  exHolo: blockFrom(holoSrc, "function exHoloMaterial"),
  rarity: blockFrom(holoSrc, "function rarityMaterial"),
  sbHolo: blockFrom(holoSrc, "function sbHoloMaterial"),
};

const officialChecks = [
  {
    ok: SHADERS.every((shader) => hasRampCore(official.get(shader.name)?.frag || "")),
    msg: "official holo family must keep rotation, phase remap, ramp y=0.5, and clamped interval core",
  },
  {
    ok: /0\.419999986886978/.test(official.get("Card_Parallax_Hologram_Tuning")?.vert || ""),
    msg: "official Card_Parallax_Hologram_Tuning vertex must use the 0.42 tangent-view denominator bias",
  },
  {
    ok: /1\.269841194152832/.test(official.get("Opaque-Hologram_Tuning")?.vert || "")
      && /0\.909090876579284/.test(official.get("Opaque-Hologram_Tuning")?.vert || ""),
    msg: "official Opaque-Hologram_Tuning vertex must build position UV with 1.269841194/0.909090877 scale",
  },
  {
    ok: /_623\s*=\s*_562/.test(official.get("Transparent_Hologram_Tuning")?.frag || "")
      && /_562\.w\s*=\s*_274\.w\s*\*\s*_16\._m12/.test(official.get("Transparent_Hologram_Tuning")?.frag || "")
      && /_562\.x\s*=\s*0\.0[\s\S]*_562\.y\s*=\s*0\.0[\s\S]*_562\.z\s*=\s*0\.0/.test(official.get("Transparent_Hologram_Tuning")?.frag || ""),
    msg: "official Transparent_Hologram_Tuning MRT1 must be alpha-only from UI alpha times _AlphaBlend",
  },
  {
    ok: /_817\s*=\s*_9/.test(official.get("Frame-Holo-Tuning")?.frag || "")
      && /_9\.w\s*=\s*_9\.x\s*\*\s*_33\._m19/.test(official.get("Frame-Holo-Tuning")?.frag || "")
      && /_9\.x\s*=\s*0\.0[\s\S]*_9\.y\s*=\s*0\.0[\s\S]*_9\.z\s*=\s*0\.0/.test(official.get("Frame-Holo-Tuning")?.frag || ""),
    msg: "official Frame-Holo-Tuning MRT1 must be alpha-only from coverage times masking intensity",
  },
  {
    ok: /_680\s*=\s*vec4\(0\.0\)/.test(official.get("Card_Hologram_Tuning")?.frag || "")
      && /_611\s*=\s*vec4\(0\.0\)/.test(official.get("Opaque_Hologram_Tuning")?.frag || "")
      && /_848\s*=\s*vec4\(0\.0\)/.test(official.get("Opaque-Hologram_Tuning")?.frag || "")
      && /_528\s*=\s*vec4\(0\.0\)/.test(official.get("Simple-Opaque-Hologram_Tuning")?.frag || "")
      && /_415\s*=\s*vec4\(0\.0\)/.test(official.get("Card_Parallax_Hologram_Tuning")?.frag || ""),
    msg: "official non-mask holo variants must write zero to MRT1",
  },
];

const localChecks = [
  {
    ok: localHasFullRampCore(local.holo) && /tv\.z\s*\+\s*0\.41999998688697815/.test(local.holo),
    msg: "local holo strategy must keep official parallax holo ramp core and 0.42 view bias",
  },
  {
    ok: localHasFullRampCore(local.frameHolo)
      && /texture2D\(ramp2,\s*vec2\(U2,\s*0\.5\)\)/.test(local.frameHolo)
      && /mix\(uAlpha,\s*1\.0,\s*uHasBase\)/.test(local.frameHolo)
      && /uRemoveMetallic/.test(local.frameHolo)
      && /base\.rgb\s*\+\s*A\s*\*\s*\(frameLit\s*-\s*base\.rgb\)/.test(local.frameHolo),
    msg: "local frameHolo strategy must keep official ramp core, second layer ramp, base/alpha role switch, and masked base-to-holo combine",
  },
  {
    ok: localHasFullRampCore(local.exHolo)
      && /dynHolo/.test(local.exHolo)
      && /foilMask/.test(local.exHolo)
      && /uAlphaBlend/.test(local.exHolo),
    msg: "local exHolo strategy must keep official dynamic UI holo mask and alpha blend role",
  },
  {
    ok: localHasFullRampCore(local.rarity)
      && /T0\.a\s*<\s*0\.5/.test(local.rarity),
    msg: "local rarity strategy must keep holo ramp core and data-shaped alpha cutout",
  },
  {
    ok: localHasFullRampCore(local.sbHolo)
      && /1\.2698411942/.test(local.sbHolo)
      && /0\.9090908766/.test(local.sbHolo)
      && /primaryDiffInt\s*=/.test(local.sbHolo),
    msg: "local sbHolo strategy must keep holo ramp core, official position UV scale, and shader-specific diffraction intensity rule",
  },
];

for (const check of [...officialChecks, ...localChecks]) {
  if (!check.ok) issues.push(check.msg);
}

if (issues.length) {
  console.error(`Holo core audit failed: ${issues.length} issue(s) found`);
  for (const issue of issues) console.error(`BAD ${issue}`);
  process.exit(1);
}

console.log("Holo core audit OK");
