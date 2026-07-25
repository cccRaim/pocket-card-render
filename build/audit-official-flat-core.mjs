// Guard the flat/simple card-face shaders. These are visually less glamorous
// than holo shaders, but they cover many visible reference layers and form the
// base color that foil layers blend against.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const shaderRoot = process.env.PCR_SHADERS
  || "D:/DevProjectes/ptcgp-tools-master/masterdata_decoder/.output/decrypted/Common/Shader";

function dump(shader, prefix = shader.replace(/[^A-Za-z0-9_]/g, "_")) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pcr-flat-"));
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
let cardIllust = { vert: "", frag: "" };
let frame = { vert: "", frag: "" };
let simpleOpaque = { vert: "", frag: "" };
let simpleTransparent = { vert: "", frag: "" };
try {
  cardIllust = dump("Card_Illust");
  frame = dump("Frame");
  simpleOpaque = dump("Simple-Opaque", "Simple_Opaque");
  simpleTransparent = dump("Simple-Transparent", "Simple_Transparent");
} catch (err) {
  issues.push(`official flat shader dump failed: ${err.message.split(/\r?\n/)[0]}`);
}

const baseSrc = fs.readFileSync(path.join(ROOT, "public/render/materials/base.js"), "utf8");
const illust = blockFrom(baseSrc, 'defineMaterial("illustTextured"');
const textured = blockFrom(baseSrc, 'defineMaterial("textured"');
const simple = blockFrom(baseSrc, 'defineMaterial("simpleTransparent"');
const outline = blockFrom(baseSrc, 'defineMaterial("frameOutline"');

const checks = [
  {
    ok: /vs_TEXCOORD0\s*=\s*\([^;]*\)\s*\+\s*_94/.test(cardIllust.vert) || /float\([^)]*_m2\)/.test(cardIllust.vert),
    msg: "official Card_Illust vertex must select UV0/UV1 by _UseUv",
  },
  {
    ok: /_9\s*=\s*texture\(_13,\s*vs_TEXCOORD0\)/.test(cardIllust.frag) && /_20\s*=\s*vec4\(0\.0\)/.test(cardIllust.frag),
    msg: "official Card_Illust fragment must sample _MainTex and zero MRT1",
  },
  {
    ok: /vUv\s*=\s*mix\(uv,\s*uv1,\s*step\(0\.5,\s*uUseUv\)\)/.test(illust),
    msg: "local Card_Illust strategy must select UV0/UV1 by _UseUv",
  },
  {
    ok: /gl_FragColor\s*=\s*texture2D\(map,\s*vUv\)/.test(illust),
    msg: "local Card_Illust strategy must output sampled texture color",
  },
  {
    ok: /_21\s*=\s*_9/.test(frame.frag) && /_9\.x\s*=\s*0\.0/.test(frame.frag) && /_45\s*=\s*_9/.test(frame.frag),
    msg: "official Frame fragment must sample base color and write alpha-only MRT1",
  },
  {
    ok: /new THREE\.MeshBasicMaterial\(\{\s*map:\s*tex/.test(textured),
    msg: "local Frame/textured strategy must render the bound texture directly",
  },
  {
    ok: /_9\s*=\s*texture\(_13,\s*vs_TEXCOORD0\)/.test(simpleOpaque.frag) && /_20\s*=\s*vec4\(0\.0\)/.test(simpleOpaque.frag),
    msg: "official Simple-Opaque fragment must sample texture and zero MRT1",
  },
  {
    ok: /new THREE\.MeshBasicMaterial\(\{\s*map:\s*ft/.test(outline),
    msg: "local Simple-Opaque frameOutline must render the bound texture directly",
  },
  {
    ok: /_22\s*=\s*_9\.www\s*\*\s*_9\.xyz/.test(simpleTransparent.frag) && /_40\s*=\s*vec4\(0\.0\)/.test(simpleTransparent.frag),
    msg: "official Simple-Transparent fragment must premultiply RGB and zero MRT1",
  },
  {
    ok: /gl_FragColor\s*=\s*vec4\(t\.rgb\s*\*\s*t\.a,\s*t\.a\)/.test(simple),
    msg: "local Simple-Transparent strategy must premultiply RGB by alpha",
  },
];

for (const check of checks) {
  if (!check.ok) issues.push(check.msg);
}

if (issues.length) {
  console.error(`Flat shader core audit failed: ${issues.length} issue(s) found`);
  for (const issue of issues) console.error(`BAD ${issue}`);
  process.exit(1);
}

console.log("Flat shader core audit OK");
