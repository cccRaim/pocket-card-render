// gather.mjs — collect every /game/ asset (glb + textures + UI icons) that the prebuilt public/**.json
// files reference, copying them from an AssetRipper export root into ./public/game so the renderer is
// SELF-CONTAINED (no live proxy onto the game export).
//
//   node build/gather.mjs <assetripper-export-root>
//
// Default source root = $PCR_GAME_SRC or ../ptcg-apk-parser/apks/assets. Scans ALL JSON under public/
// (scene.*.json + text/*.json + locales/*.json) for "/game/<rel>" strings → copies each to
// public/game/<rel>. A few UI glyphs are hardcoded in app.js (the ex badge) → always included.
import { readFileSync, mkdirSync, readdirSync, existsSync, copyFileSync, statSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const PUB = join(ROOT, "public");
const GAME_OUT = join(PUB, "game");
const MIP_OUT = join(GAME_OUT, ".official-texture-mips");
const SCENE_PATHS = readdirSync(PUB, { withFileTypes: true })
  .filter((entry) => entry.isFile() && /^scene(?:\..+)?\.json$/.test(entry.name))
  .map((entry) => join(PUB, entry.name))
  .sort();

const SRC = process.argv[2] || process.env.PCR_GAME_SRC || join(ROOT, "..", "ptcg-apk-parser", "apks", "assets");
const FONT_SRC = process.env.PCR_GAME_FONT_SRC
  || join(ROOT, "..", "ptcg-apk-parser", "card_render", "public", "assets", "fonts");

// UI glyphs referenced directly in app.js (not via any JSON)
const EXTRA = [
  "Assets/Lettuce/_Data/Common/CardNew/Common/UI/Textures/CardUIPokemonFormat5x5/card_icn_ex.png",
  "Assets/Lettuce/_Data/Common/CardNew/Common/UI/Textures/CardUIPokemonFormat5x5/card_icn_ex_outline.png",
];
const rels = new Set(EXTRA);

const COMMON_UI_DIRS = [
  "Assets/Lettuce/_Data/Common/CardNew/Common/UI/Textures/CardUIPokemonFormat5x5",
  "Assets/Lettuce/_Data/Common/CardNew/Common/UI/Textures/CardUIPokemonFormat8x8",
  "Assets/Lettuce/_Data/Common/CardNew/Common/UI/Textures/CardUITrainersFormat5x5",
];

function addPngDir(relDir) {
  const abs = join(SRC, relDir);
  if (!existsSync(abs)) return;
  for (const e of readdirSync(abs, { withFileTypes: true })) {
    if (e.isFile() && e.name.toLowerCase().endsWith(".png")) rels.add(`${relDir}/${e.name}`);
  }
}

COMMON_UI_DIRS.forEach(addPngDir);

// walk every .json under public/ (except public/game) and regex out /game/<rel> references
const GAME_RE = /\/game\/([^"'\\]+?\.(?:png|glb|gltf|jpg|jpeg|tif|tiff|otf|ttf|woff2))/gi;
function scanJson(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) { if (p !== GAME_OUT) scanJson(p); continue; }
    if (!e.name.endsWith(".json")) continue;
    const txt = readFileSync(p, "utf8");
    let m, c = 0;
    while ((m = GAME_RE.exec(txt))) { rels.add(decodeURIComponent(m[1])); c++; }
    if (c) console.log(`  ${p.slice(PUB.length + 1)}: ${c} /game refs`);
  }
}
scanJson(PUB);

if (!existsSync(SRC)) { console.error(`source root not found: ${SRC}\n  pass it as argv[2] or set PCR_GAME_SRC`); process.exit(1); }
let copied = 0, missing = 0;
for (const rel of rels) {
  const from = rel.startsWith("Assets/Fonts/")
    ? join(FONT_SRC, basename(rel))
    : join(SRC, rel);
  const to = join(GAME_OUT, rel);
  if (!existsSync(from)) { console.warn(`  MISSING: ${rel}`); missing++; continue; }
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(from, to);
  copied++;
}
console.log(`gathered ${copied} files into public/game (${missing} missing) from ${SRC}`);

// Browser mip generation is implementation-defined and differs from the stored Unity mip chain.
// Decode every official multi-mip Texture2D directly from its bundle payload into a content-addressed
// RGBA8 chain. Single-mip static textures keep their direct Image upload path and never touch Canvas.
const DECRYPTED_ROOT = process.env.PCR_DECRYPTED_ROOT
  || join(ROOT, "..", "ptcgp-tools-master", "masterdata_decoder", ".output", "decrypted");
if (!existsSync(DECRYPTED_ROOT)) {
  console.error(`official decrypted root not found: ${DECRYPTED_ROOT}\n  set PCR_DECRYPTED_ROOT to generate mip fallbacks`);
  process.exit(1);
}
mkdirSync(MIP_OUT, { recursive: true });
const python = process.env.PYTHON || "python";
const extraction = spawnSync(python, [
  join(HERE, "extract_official_texture_sampler.py"),
  "--decrypted-root", DECRYPTED_ROOT,
  ...SCENE_PATHS.flatMap((scenePath) => ["--scene", scenePath]),
  "--emit-rgba-fallback-root", MIP_OUT,
  "--no-json",
], {
  cwd: ROOT,
  env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
  encoding: "utf8",
  shell: process.platform === "win32",
});
if (extraction.status !== 0) {
  console.error((extraction.stderr || extraction.stdout || extraction.error?.message || "official mip extraction failed").trim());
  process.exit(1);
}
if (extraction.stderr.trim()) console.log(extraction.stderr.trim());
const mipFiles = readdirSync(MIP_OUT).filter((name) => name.endsWith(".rgba8mips"));
const mipBytes = mipFiles.reduce((total, name) => total + statSync(join(MIP_OUT, name)).size, 0);
console.log(`official mip fallbacks: ${mipFiles.length} files, ${mipBytes} bytes`);

// AssetRipper/SharpGLTF normalizes some vertex attributes and may merge
// consecutive same-material submeshes. Restore each canonical GLB accessor
// from the official Unity Mesh payload after copying it into public/game.
const meshRestore = spawnSync(python, [
  "-B",
  join(HERE, "restore_official_mesh_payload.py"),
  "--decrypted-root", DECRYPTED_ROOT,
], {
  cwd: ROOT,
  env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
  encoding: "utf8",
  shell: process.platform === "win32",
});
if (meshRestore.status !== 0) {
  console.error((meshRestore.stderr || meshRestore.stdout || meshRestore.error?.message || "official mesh restoration failed").trim());
  process.exit(1);
}
console.log(meshRestore.stdout.trim());
