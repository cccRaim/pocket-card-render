// Verify diagnostic scene alphaMode against the actual stored PNG alpha/RGB data.
// A `premult` classification is only a stored-pixel candidate, not proof of the
// shader output convention and never permission to rewrite official blend state.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { classifyAlpha } from "./alpha.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC = path.join(ROOT, "public");

function sceneId(sceneName) {
  return sceneName.replace(/^scene\.|\.json$/g, "");
}

function pngPath(url) {
  if (!url || !url.startsWith("/game/")) return null;
  return path.join(PUBLIC, decodeURI(url.replace(/^\//, "")));
}

const rows = [];
const sceneNames = fs.readdirSync(PUBLIC)
  .filter((n) => /^scene\..*\.json$/.test(n))
  .sort();

for (const sceneName of sceneNames) {
  const scene = JSON.parse(fs.readFileSync(path.join(PUBLIC, sceneName), "utf8"));
  const alphaMode = scene.alphaMode || {};
  const referenced = new Set();
  for (const [name, url] of Object.entries(scene.textures || {})) {
    referenced.add(name);
    const abs = pngPath(url);
    const actual = abs && fs.existsSync(abs) ? classifyAlpha(abs) : "(missing)";
    const declared = alphaMode[name];
    rows.push({
      ok: declared === actual,
      scene: sceneId(sceneName),
      texture: name,
      declared: declared ?? "(missing)",
      actual,
      reason: declared === actual ? "alphaMode matches PNG" : "alphaMode mismatch",
    });
  }
  for (const name of Object.keys(alphaMode)) {
    if (referenced.has(name)) continue;
    rows.push({
      ok: false,
      scene: sceneId(sceneName),
      texture: name,
      declared: alphaMode[name],
      actual: "(unreferenced)",
      reason: "alphaMode entry has no scene texture",
    });
  }
}

const grouped = new Map();
for (const row of rows) {
  const key = [row.ok, row.scene, row.texture, row.declared, row.actual, row.reason].join("|");
  if (!grouped.has(key)) grouped.set(key, { ...row, count: 0 });
  grouped.get(key).count += 1;
}

for (const row of [...grouped.values()].sort((a, b) =>
  String(a.scene).localeCompare(String(b.scene))
  || String(a.texture).localeCompare(String(b.texture)))) {
  const mark = row.ok ? "OK " : "BAD";
  console.log(`${mark} ${row.scene.padEnd(36)} tex=${row.texture.padEnd(40)} declared=${String(row.declared).padEnd(10)} actual=${String(row.actual).padEnd(14)} ${row.reason}`);
}

const bad = rows.filter((row) => !row.ok);
if (bad.length) {
  console.error(`\n${bad.length} scene alphaMode issue(s) found.`);
  process.exitCode = 1;
}
