import fs from "node:fs";
import path from "node:path";

export const TMP_RUNTIME_LEGACY_NON_RENDER_SOURCES = Object.freeze([
  "build/audit-tmp-runtime-evidence.mjs",
  "build/prebuild_text.mjs",
  "build/tmp-runtime-sources.mjs",
  "server.mjs",
]);

const FIXED = [
  "build/carddata.mjs",
  "build/compose.mjs",
  "public/app.js",
  "public/render/card-font-contract.json",
  "public/render/card-ui-layout-contract.json",
  "public/render/dynamic-ui-texture.js",
  "public/render/official-texture.js",
  "public/render/quality-profile.js",
  "public/render/tmp-font-data.js",
  "public/render/tmp-rich-text.js",
  "public/render/tmp-sprite-contract.json",
  "public/render/tmp-sprite-data.js",
  "public/render/tmp-settings-contract.json",
  "public/render/tmp-sdf-renderer.js",
  "public/game/tmp-fonts/manifest.json",
  "public/game/tmp-sprites/TextExSprite.png",
  "public/shaders/tmp_sdf.vert.glsl",
  "public/shaders/tmp_sdf.frag.glsl",
  "public/shaders/tmp_sdf_program.json",
];

export function tmpRuntimeSourceIdentityMatches(sourceHashes, currentHashes) {
  if (!sourceHashes || typeof sourceHashes !== "object") return false;
  const required = new Set(Object.keys(currentHashes));
  const legacy = new Set(TMP_RUNTIME_LEGACY_NON_RENDER_SOURCES);
  return Object.entries(currentHashes).every(([file, digest]) => sourceHashes[file] === digest)
    && Object.keys(sourceHashes).every((file) => required.has(file) || legacy.has(file));
}

function matchingFiles(root, directory, pattern) {
  return fs.readdirSync(path.join(root, directory))
    .filter((name) => pattern.test(name))
    .map((name) => `${directory}/${name}`);
}

export function tmpRuntimeSourceFiles(root) {
  return [
    ...FIXED,
    ...matchingFiles(root, "public/text", /\.json$/),
    ...matchingFiles(root, "public/locales", /^card_ui\..+\.json$/),
  ].sort();
}
