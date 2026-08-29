import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { atomicWriteFileSync } from "./atomic-publish.mjs";
import { composeFace } from "./compose.mjs";

const root = join(import.meta.dirname, "..");
const publicDir = join(root, "public");
const textDir = join(publicDir, "text");
const sceneFiles = readdirSync(publicDir).filter((name) => /^scene\..+\.json$/.test(name));
const illByCard = new Map();
const check = process.argv.includes("--check") || process.env.PCR_TEXT_CHECK === "1";
const localeManifest = JSON.parse(readFileSync(join(publicDir, "locales", "manifest.json"), "utf8"));
const locales = localeManifest.locales.map((entry) => entry.lc);
for (const name of sceneFiles) {
  const scene = JSON.parse(readFileSync(join(publicDir, name), "utf8"));
  const illId = scene.card?.id || "";
  const match = /^c?((?:TR|PK)_\d+_\d+_\d+)/.exec(illId);
  if (match) illByCard.set(match[1], illId);
}

const targets = [...illByCard].flatMap(([cardId]) => locales.map((locale) => ({
  cardId,
  locale,
  name: `${cardId}.${locale}.json`,
})));

let count = 0;
for (const { cardId, locale, name } of targets.sort((a, b) => a.name.localeCompare(b.name))) {
  const composed = composeFace(cardId, locale, illByCard.get(cardId) || "");
  const file = join(textDir, name);
  const encoded = `${JSON.stringify(composed)}\n`;
  if (check) {
    if (!readdirSync(textDir).includes(name) || readFileSync(file, "utf8") !== encoded) {
      throw new Error(`${name} is missing or stale`);
    }
  } else {
    atomicWriteFileSync(file, encoded);
  }
  count += 1;
}

console.log(`${check ? "verified" : "prebuilt"} ${count} localized card text files`);
