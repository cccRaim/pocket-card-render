// Verify that scene manifests reference complete local assets.
//
// Missing texture URLs, absent public/game files, or stale material->texture
// links otherwise fall through to default textures and make shader fidelity
// debugging meaningless. This audit keeps the reference scenes reproducible.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC = path.join(ROOT, "public");

function sceneId(sceneName) {
  return sceneName.replace(/^scene\.|\.json$/g, "");
}

function publicPath(url) {
  if (!url || !url.startsWith("/")) return null;
  return path.join(PUBLIC, url.slice(1));
}

function relPublic(abs) {
  return abs ? path.relative(PUBLIC, abs).replace(/\\/g, "/") : "";
}

const rows = [];
const sceneNames = fs.readdirSync(PUBLIC)
  .filter((n) => /^scene\..*\.json$/.test(n))
  .sort();

for (const sceneName of sceneNames) {
  const manifest = JSON.parse(fs.readFileSync(path.join(PUBLIC, sceneName), "utf8"));
  const scene = sceneId(sceneName);

  for (const missing of manifest._missing || []) {
    rows.push({
      ok: false,
      scene,
      mat: "(scene)",
      slot: "_missing",
      name: String(missing),
      url: "",
      reason: "scene reports missing recipe asset",
    });
  }

  const glb = publicPath(manifest.prefabGlb);
  rows.push({
    ok: !!glb && fs.existsSync(glb),
    scene,
    mat: "(scene)",
    slot: "prefabGlb",
    name: path.basename(manifest.prefabGlb || ""),
    url: manifest.prefabGlb || "",
    reason: glb && fs.existsSync(glb) ? "prefab glb exists" : "prefab glb missing",
  });

  const textureMap = manifest.textures || {};
  for (const [name, url] of Object.entries(textureMap)) {
    const abs = publicPath(url);
    rows.push({
      ok: !!url && !!abs && fs.existsSync(abs),
      scene,
      mat: "(textures)",
      slot: "(top)",
      name,
      url: url || "",
      path: relPublic(abs),
      reason: url
        ? (abs && fs.existsSync(abs) ? "texture file exists" : "texture file missing")
        : "texture url missing",
    });
  }

  const referenced = new Set();
  for (const [matName, mat] of Object.entries(manifest.materials || {})) {
    for (const [slot, tex] of Object.entries(mat.textures || {})) {
      const name = tex?.name;
      const url = tex?.url;
      referenced.add(name);
      const topUrl = textureMap[name];
      const abs = publicPath(url);
      rows.push({
        ok: !!name && !!url && topUrl === url && !!abs && fs.existsSync(abs),
        scene,
        mat: matName,
        shader: mat.shader,
        slot,
        name: name || "",
        url: url || "",
        path: relPublic(abs),
        reason: !name
          ? "material texture has no name"
          : !url
            ? "material texture has no url"
            : topUrl !== url
              ? "material texture url differs from scene texture map"
              : abs && fs.existsSync(abs)
                ? "material texture file exists"
                : "material texture file missing",
      });
    }
  }

  for (const name of Object.keys(textureMap)) {
    if (referenced.has(name)) continue;
    rows.push({
      ok: false,
      scene,
      mat: "(textures)",
      slot: "(top)",
      name,
      url: textureMap[name] || "",
      reason: "top-level texture is not referenced by any material",
    });
  }
}

const grouped = new Map();
for (const row of rows) {
  const key = [row.ok, row.scene, row.shader || "", row.slot, row.name, row.reason].join("|");
  if (!grouped.has(key)) grouped.set(key, { ...row, count: 0, examples: [] });
  const item = grouped.get(key);
  item.count += 1;
  if (item.examples.length < 4) item.examples.push(row.mat);
}

for (const row of [...grouped.values()].sort((a, b) =>
  String(a.scene).localeCompare(String(b.scene))
  || String(a.shader || "").localeCompare(String(b.shader || ""))
  || String(a.slot).localeCompare(String(b.slot))
  || String(a.name).localeCompare(String(b.name)))) {
  const mark = row.ok ? "OK " : "BAD";
  console.log(`${mark} ${row.scene.padEnd(36)} ${String(row.shader || "").padEnd(35)} slot=${row.slot.padEnd(18)} tex=${row.name.padEnd(40)} ${row.reason} count=${row.count}`);
  if (row.examples.length) console.log(`     e.g. ${row.examples.join(", ")}`);
}

const bad = rows.filter((row) => !row.ok);
if (bad.length) {
  console.error(`\n${bad.length} scene asset issue(s) found.`);
  process.exitCode = 1;
}
