// Static server for the pocket-card-render renderer (self-contained).
//   /        -> public/        (index.html, app.js, scene.*.json, shaders, fonts)
//   /game/   -> public/game/   (the card's textures .png + meshes .glb, gathered by build/gather.mjs)
// Everything the renderer needs lives under public/ — no proxy onto an external game export.
// The /scene and /compose endpoints below are OPTIONAL (only for devs who have the full prep
// pipeline + their own game data); the default demo uses the prebuilt static scene.*.json.
import { createServer } from "node:http";
import { readFile, readdir, stat } from "node:fs/promises";
import { join, extname, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = join(fileURLToPath(new URL(".", import.meta.url)));
const PUB = join(HERE, "public");
const GAME = join(PUB, "game");
const THREE = join(HERE, "node_modules", "three");
const PORT = Number(process.argv[2]) || 8011;

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".png": "image/png", ".glb": "model/gltf-binary", ".gltf": "model/gltf+json",
  ".bin": "application/octet-stream", ".wasm": "application/wasm",
};

async function serveFrom(root, rel, res) {
  const file = normalize(join(root, rel));
  if (!file.startsWith(root)) { res.writeHead(403).end("forbidden"); return; }
  const s = await stat(file).catch(() => null);
  if (!s || !s.isFile()) { res.writeHead(404).end("not found: " + rel); return; }
  const body = await readFile(file);
  res.writeHead(200, { "content-type": MIME[extname(file).toLowerCase()] || "application/octet-stream", "cache-control": "no-cache" });
  res.end(body);
}

// /compose?id=<CardID>&lc=<locale> — DYNAMICALLY resolve a card's UI (text from masterdata+locale, layout from
// the cached prefab scan) and return the positioned elements. No per-card offline pre-gen; works for any card.
async function serveCompose(req, res) {
  const u = new URL(req.url, "http://x");
  const id = u.searchParams.get("id"), lc = u.searchParams.get("lc") || "zh_TW", ill = u.searchParams.get("ill") || "";
  try {
    const { composeFace } = await import(`./build/compose.mjs?t=${Date.now()}`);   // cache-bust so edits go live
    const body = JSON.stringify(composeFace(id, lc, ill));
    res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-cache" });
    res.end(body);
  } catch (e) { res.writeHead(500, { "content-type": "application/json" }).end(JSON.stringify({ error: String(e) })); }
}

async function readJsonIfExists(file) {
  return JSON.parse(await readFile(file, "utf8").catch(() => "null"));
}

function sceneCardMdId(cardId) {
  return (/^c?((?:TR|PK)_\d+_\d+_\d+)/.exec(cardId || "") || [])[1] || "";
}

function firstCardName(face) {
  const elements = face?.elements || [];
  return elements.find((e) => e.kind === "text" && e.font === "name")?.text || "";
}

function withExSuffix(name, sceneName, face) {
  if (!name) return "";
  const needsEx = /ex$/i.test(sceneName || "") || (face?.elements || []).some((e) => e.exAfter);
  if (!needsEx || /\bex$/i.test(name)) return name;
  return name.endsWith("-") ? `${name}ex` : `${name} ex`;
}

async function localizedSceneNames(data, locales) {
  const names = {};
  const mdId = sceneCardMdId(data.card?.id);
  for (const lc of locales) {
    const fromText = mdId ? await readJsonIfExists(join(PUB, "text", `${mdId}.${lc}.json`)) : null;
    if (fromText) {
      const name = firstCardName(fromText);
      if (name) { names[lc] = withExSuffix(name, data.card?.name, fromText); continue; }
    }
    const fromFace = await readJsonIfExists(join(PUB, "locales", `card_face.${lc}.json`));
    if (fromFace?.card === mdId) {
      const name = firstCardName(fromFace);
      if (name) names[lc] = withExSuffix(name, data.card?.name, fromFace);
    }
  }
  return names;
}

async function serveScenes(_req, res) {
  try {
    const files = (await readdir(PUB))
      .filter((name) => /^scene(?:\.[^.]+)?\.json$/i.test(name))
      .sort((a, b) => a.localeCompare(b));
    const manifest = await readJsonIfExists(join(PUB, "locales", "manifest.json"));
    const locales = (manifest?.locales || []).map((l) => l.lc);
    const scenes = [];
    for (const file of files) {
      const data = JSON.parse(await readFile(join(PUB, file), "utf8"));
      scenes.push({
        file,
        id: data.card?.id || "",
        name: data.card?.name || file.replace(/\.json$/i, ""),
        names: await localizedSceneNames(data, locales),
        rarityToken: data.card?.rarityToken || "",
      });
    }
    res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-cache" });
    res.end(JSON.stringify({ scenes }));
  } catch (e) {
    res.writeHead(500, { "content-type": "application/json; charset=utf-8" }).end(JSON.stringify({ error: String(e) }));
  }
}

// /scene?card=<illustrationId> — DYNAMICALLY build a card's 3D scene (materials/textures/glb from the cached
// runtime manifest + AssetRipper export). Replaces the static scene.<cardId>.json files; any card by id.
async function serveScene(req, res) {
  const card = new URL(req.url, "http://x").searchParams.get("card");
  try {
    const { buildScene, sceneFileName } = await import(`./build/build.mjs?t=${Date.now()}`);
    const body = JSON.stringify(buildScene(card));
    const headers = { "content-type": "application/json; charset=utf-8", "cache-control": "no-cache" };
    if (card) headers["x-scene-filename"] = sceneFileName(card);
    res.writeHead(200, headers);
    res.end(body);
  } catch (e) { res.writeHead(500, { "content-type": "application/json" }).end(JSON.stringify({ error: String(e) })); }
}

createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(req.url.split("?")[0]);
    if (p === "/") p = "/index.html";
    if (p === "/scenes") return void serveScenes(req, res);
    if (p === "/compose") return void serveCompose(req, res);
    if (p === "/scene") return void serveScene(req, res);
    if (p.startsWith("/game/")) return void serveFrom(GAME, p.slice("/game/".length), res);
    if (p.startsWith("/vendor/three/")) return void serveFrom(THREE, p.slice("/vendor/three/".length), res);
    return void serveFrom(PUB, p, res);
  } catch (e) { res.writeHead(500).end(String(e)); }
}).listen(PORT, () => console.log(`pocket-card-render  http://127.0.0.1:${PORT}/   (?scene=scene.<cardId>.json)`));
