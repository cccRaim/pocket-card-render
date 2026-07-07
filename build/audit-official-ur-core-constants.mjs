// Compare high-impact UR shader shape constants against official bytecode.
//
// The UR ports still contain hand-written GLSL, so this audit pins the parts
// that most visibly define specular shape, corner pulses, lens-flare VAT lookup,
// luminance gates, and Oklab conversion. It does not claim full equivalence; it
// prevents those byte-traced anchors from drifting back into hand-tuned values.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const shaderRoot = process.env.PCR_SHADERS
  || "D:/DevProjectes/ptcgp-tools-master/masterdata_decoder/.output/decrypted/Common/Shader";

const SRGB_TRANSFER = [
  0.0773993805, 0.055, 0.9478673339, 2.4000000954, 0.0404499993,
  12.9200000763, 0.4166666567, 1.0549999475, 0.0031308001,
];

const OKLAB_MATRICES = [
  0.4121656119823456, 0.5362752079963684, 0.05145756527781487,
  0.2118591070, 0.6807189584, 0.1074065790,
  0.0883097947, 0.2818474174, 0.6302613616,
  0.3333333433,
  0.2104542553, 0.7936177850, 0.0040720468,
  1.9779984951, 2.4285922050, 0.4505937099,
  0.0259040371, 0.7827717662, 0.8086757660,
  0.3963377774, 0.2158037573,
  0.1055613458, 0.0638541728,
  0.0894841775, 1.2914855480,
  4.0767416954, 3.3077116013, 0.2309699357,
  1.2684379816, 2.6097574234, 0.3413193822,
  0.0041960864, 0.7034186125, 1.7076146603,
];

const CHECKS = [
  {
    shader: "Card_UR_Plate",
    stage: "vert",
    local: "public/render/materials/ur.js",
    marker: "function plateMaterial",
    constants: [0.41999998688697815, 1.6964596509933472, 0.5821118950843811, 2.3929851055145264, 2.0943946838378906],
    reason: "UR plate parallax + fake-spec corner pulse",
  },
  {
    shader: "Card_UR_Plate",
    stage: "frag",
    local: "public/render/materials/ur.js",
    marker: "function plateMaterial",
    constants: [0.298911988735199, 0.5866109728813171, 0.11447799950838089],
    reason: "UR plate darkness luminance gate",
  },
  {
    shader: "Card_Parallax_Hologram_UR_New",
    stage: "vert",
    local: "public/render/materials/ur.js",
    marker: "function urBgHoloMaterial",
    constants: [0.41999998688697815, 1.6964596509933472, 0.5821118950843811, 2.3929851055145264, 2.0943946838378906],
    reason: "UR background hologram parallax + fake-spec corner pulse",
  },
  {
    shader: "Card_Parallax_Hologram_UR_New",
    stage: "frag",
    local: "public/render/materials/ur.js",
    marker: "function urBgHoloMaterial",
    constants: [0.298911988735199, 0.5866109728813171, 0.11447799950838089],
    reason: "UR background hologram darkness luminance gate",
  },
  {
    shader: "Frame-Holo-UR-New",
    stage: "vert",
    local: "public/render/materials/holo.js",
    marker: "function frameHoloUrMaterial",
    constants: [1.6964596509933472, 0.5821118950843811, 2.3929851055145264, 2.0943946838378906],
    reason: "UR frame fake-spec corner pulse",
  },
  {
    shader: "Frame-Holo-UR-New",
    stage: "frag",
    local: "public/render/materials/holo.js",
    marker: "function frameHoloUrMaterial",
    constants: [0.298911988735199, 0.5866109728813171, 0.11447799950838089],
    reason: "UR frame darkness luminance gate",
  },
  {
    shader: "Frame-2Layer-UR",
    stage: "vert",
    local: "public/render/materials/frame2layer-ur.js",
    marker: "function frame2LayerUrMaterial",
    constants: [1.6964596509933472, 0.5821118950843811, 2.3929851055145264, 2.0943946838378906],
    reason: "UR rule panel two-layer fake-spec corner pulse",
  },
  {
    shader: "Frame-2Layer-UR",
    stage: "frag",
    local: "public/render/materials/frame2layer-ur.js",
    marker: "function frame2LayerUrMaterial",
    constants: [...SRGB_TRANSFER, ...OKLAB_MATRICES],
    reason: "UR rule panel sRGB/Oklab conversion path",
  },
  {
    shader: "Opaque-UR-Oklab",
    stage: "vert",
    local: "public/render/materials/holo.js",
    marker: "function sbHoloMaterial",
    constants: [1.269841194152832, 0.9090908765792847, 1.6964596509933472, 0.5821118950843811, 2.3929851055145264, 2.0943946838378906],
    reason: "UR shadowbox position UV + fake-spec corner pulse",
  },
  {
    shader: "Opaque-UR-Oklab",
    stage: "frag",
    local: "public/render/materials/holo.js",
    marker: "function sbHoloMaterial",
    constants: [...SRGB_TRANSFER, ...OKLAB_MATRICES],
    reason: "UR shadowbox sRGB/Oklab conversion path",
  },
  {
    shader: "Card_UR_LensFlare",
    stage: "vert",
    local: "public/render/materials/ur.js",
    marker: 'defineMaterial("flare"',
    constants: [0.1591549813747406, 0.5821118950843811, 2.3929851055145264, 0.6437000036239624],
    reason: "UR lens flare VAT angle + corner/flicker pulses",
  },
];

function stageFile(shader, stage) {
  return `${shader.replace(/[^A-Za-z0-9_]/g, "_")}_${stage}.spv`;
}

function blockFrom(source, marker) {
  const start = source.indexOf(marker);
  if (start < 0) return null;
  const open = source.indexOf("{", start);
  if (open < 0) return null;
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  return null;
}

function numbers(source) {
  const out = [];
  for (const m of source.matchAll(/[-+]?(?:\d+\.\d*|\.\d+|\d+)(?:e[-+]?\d+)?/gi)) {
    out.push(Number(m[0]));
  }
  return out;
}

function hasNumber(source, expected) {
  const eps = Math.max(1e-6, Math.abs(expected) * 5e-5);
  return numbers(source).some((value) => Number.isFinite(value) && Math.abs(Math.abs(value) - Math.abs(expected)) <= eps);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pcr-ur-const-"));
const officialGlsl = new Map();
const rows = [];

try {
  const shaders = [...new Set(CHECKS.map((check) => check.shader))];
  for (const shader of shaders) {
    const prefix = shader.replace(/[^A-Za-z0-9_]/g, "_");
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
      for (const stage of ["vert", "frag"]) {
        const spv = path.join(tmp, stageFile(shader, stage));
        if (!fs.existsSync(spv)) continue;
        officialGlsl.set(`${shader}:${stage}`, execFileSync("spirv-cross", [spv, "--version", "300", "--es"], { encoding: "utf8" }));
      }
    } catch (err) {
      rows.push({ ok: false, shader, stage: "", constant: "", location: "official", reason: err.message.split(/\r?\n/)[0] });
    }
  }

  const localCache = new Map();
  for (const check of CHECKS) {
    const official = officialGlsl.get(`${check.shader}:${check.stage}`);
    if (!official) {
      rows.push({ ok: false, ...check, constant: "", location: "official", reason: "official SPIR-V stage missing" });
      continue;
    }
    if (!localCache.has(check.local)) {
      localCache.set(check.local, fs.readFileSync(path.join(ROOT, check.local), "utf8"));
    }
    const localBlock = blockFrom(localCache.get(check.local), check.marker);
    if (!localBlock) {
      rows.push({ ok: false, ...check, constant: "", location: "local", reason: "local strategy block missing" });
      continue;
    }
    for (const constant of check.constants) {
      rows.push({
        ok: hasNumber(official, constant),
        ...check,
        constant,
        location: "official",
        reason: hasNumber(official, constant) ? check.reason : "official bytecode constant missing",
      });
      rows.push({
        ok: hasNumber(localBlock, constant),
        ...check,
        constant,
        location: "local",
        reason: hasNumber(localBlock, constant) ? check.reason : "local strategy constant missing",
      });
    }
  }

  const opaqueUrFrag = officialGlsl.get("Opaque-UR-Oklab:frag") || "";
  const holoLocal = localCache.get("public/render/materials/holo.js")
    || fs.readFileSync(path.join(ROOT, "public/render/materials/holo.js"), "utf8");
  const sbLocal = blockFrom(holoLocal, "function sbHoloMaterial") || "";
  rows.push({
    ok: /_33\._m1\[1\]\.xyz/.test(opaqueUrFrag) && /_33\._m1\[2\]\.xyz/.test(opaqueUrFrag),
    shader: "Opaque-UR-Oklab",
    stage: "frag",
    local: "public/render/materials/holo.js",
    marker: "function sbHoloMaterial",
    constant: "",
    location: "official",
    reason: "official reflection axis is built from the normal/object basis, not the camera view basis",
  });
  rows.push({
    ok: /modelMatrix\[1\]\.xyz\s*\*\s*reflCenter\.x\s*\+\s*modelMatrix\[2\]\.xyz\s*\*\s*reflCenter\.y/.test(sbLocal)
      && !/viewMatrix\[1\]\.xyz\s*\*\s*reflCenter\.x\s*\+\s*viewMatrix\[2\]\.xyz\s*\*\s*reflCenter\.y/.test(sbLocal),
    shader: "Opaque-UR-Oklab",
    stage: "frag",
    local: "public/render/materials/holo.js",
    marker: "function sbHoloMaterial",
    constant: "",
    location: "local",
    reason: "local reflection axis must follow the official normal/object basis",
  });
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

for (const row of rows.sort((a, b) =>
  String(a.shader).localeCompare(String(b.shader))
  || String(a.stage).localeCompare(String(b.stage))
  || String(a.constant).localeCompare(String(b.constant))
  || String(a.location).localeCompare(String(b.location)))) {
  const mark = row.ok ? "OK " : "BAD";
  const c = row.constant === "" ? "" : Number(row.constant).toPrecision(9);
  console.log(`${mark} ${row.shader.padEnd(35)} ${String(row.stage).padEnd(4)} ${String(row.location).padEnd(8)} const=${String(c).padEnd(13)} ${row.reason}`);
}

const bad = rows.filter((row) => !row.ok);
if (bad.length) {
  console.error(`\n${bad.length} official UR core constant issue(s) found.`);
  process.exitCode = 1;
}
