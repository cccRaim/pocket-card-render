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
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const PUB = join(ROOT, "public");
const GAME_OUT = join(PUB, "game");

const SRC = process.argv[2] || process.env.PCR_GAME_SRC || join(ROOT, "..", "ptcg-apk-parser", "apks", "assets");

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
const GAME_RE = /\/game\/([^"'\\]+?\.(?:png|glb|gltf|jpg|jpeg|tif|tiff))/gi;
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
  const from = join(SRC, rel), to = join(GAME_OUT, rel);
  if (!existsSync(from)) { console.warn(`  MISSING: ${rel}`); missing++; continue; }
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(from, to);
  copied++;
}
console.log(`gathered ${copied} files into public/game (${missing} missing) from ${SRC}`);
