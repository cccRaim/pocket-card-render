import fs from "node:fs";
import path from "node:path";
import {
  officialSampleLabel,
  officialSampleManifestRelative,
  officialSampleSelectionRelative,
} from "./official-sample.mjs";

const CANONICAL_CORPUS = JSON.parse(fs.readFileSync(new URL("./canonical-corpus.json", import.meta.url), "utf8"));
if (CANONICAL_CORPUS.schemaVersion !== 1) throw new Error("unsupported canonical corpus schema");

export const FULL_RUNTIME_SCHEMA_VERSION = 5;
export const FULL_RUNTIME_OFFICIAL_SAMPLE = officialSampleLabel;

// Schema-4 captures originally hashed these whole files even though they do
// not produce rendered pixels.  Keep the names only for strict legacy-artifact
// migration; new identities must not include them.
export const FULL_RUNTIME_LEGACY_NON_RENDER_SOURCES = Object.freeze([
  "build/audit-full-runtime-evidence.mjs",
  "build/full-runtime-sources.mjs",
  "package-lock.json",
  "package.json",
  "server.mjs",
  "public/shaders/bloom_programs.json",
  "public/shaders/card_hologram_tuning_uniforms.json",
  "public/shaders/card_illust_uniforms.json",
  "public/shaders/card_parallax_hologram_tuning_uniforms.json",
  "public/shaders/card_parallax_metal_uniforms.json",
  "public/shaders/card_parallax_uniforms.json",
  "public/shaders/effect_uniforms.json",
  "public/shaders/final_blit_program.json",
  "public/shaders/frame_2layer_ur_uniforms.json",
  "public/shaders/frame_holo_tuning_uniforms.json",
  "public/shaders/frame_holo_ur_uniforms.json",
  "public/shaders/glitter_uniforms.json",
  "public/shaders/opaque_hologram_tuning_uniforms.json",
  "public/shaders/opaque_shadowbox_hologram_tuning_uniforms.json",
  "public/shaders/opaque_ur_oklab_uniforms.json",
  "public/shaders/parallax_ur_uniforms.json",
  "public/shaders/side_back_program.json",
  "public/shaders/simple_opaque_hologram_tuning_uniforms.json",
  "public/shaders/simple_uniforms.json",
  "public/shaders/transparent_hologram_tuning_uniforms.json",
  "public/shaders/transparent_ur_new_uniforms.json",
  "public/shaders/ui_default_from_rt_program.json",
  "public/shaders/ui_default_to_rt_program.json",
  "public/shaders/ur_bg_hologram_uniforms.json",
  "public/shaders/ur_lens_flare_uniforms.json",
]);

export const CANONICAL_FULL_RUNTIME_SCENES = Object.freeze(
  CANONICAL_CORPUS.scenes.map(({ file, cardId }) => Object.freeze({ file, cardId })),
);

export const CANONICAL_CARD_TEXT_STEMS = Object.freeze(
  CANONICAL_CORPUS.scenes.map(({ textStem }) => textStem),
);

export const CANONICAL_CARD_LOCALES = Object.freeze([...CANONICAL_CORPUS.locales]);

export const CANONICAL_LOCALIZED_TEXT_FILES = Object.freeze(
  CANONICAL_CARD_TEXT_STEMS.flatMap((stem) =>
    CANONICAL_CARD_LOCALES.map((locale) => `${stem}.${locale}.json`)),
);

const FIXED = [
  "build/carddata.mjs",
  "build/compose.mjs",
  "node_modules/three/build/three.module.js",
  "node_modules/three/examples/jsm/loaders/GLTFLoader.js",
  "node_modules/three/examples/jsm/utils/BufferGeometryUtils.js",
  "public/app.js",
  "public/index.html",
  "public/locales/card_face.zh_TW.json",
  "public/locales/card_ui.zh_TW.json",
  "public/locales/manifest.json",
  "public/texture-samplers.json",
  "public/game/tmp-fonts/manifest.json",
];

export function fullRuntimeSourceIdentityMatches(artifact, sourceFiles, sourceHashes) {
  const actualFiles = Array.isArray(artifact?.sourceFiles) ? artifact.sourceFiles : [];
  const actualHashes = artifact?.sourceHashes && typeof artifact.sourceHashes === "object"
    ? artifact.sourceHashes
    : {};
  const required = new Set(sourceFiles);
  const legacy = new Set(FULL_RUNTIME_LEGACY_NON_RENDER_SOURCES);
  return sourceFiles.every((file) => actualFiles.includes(file) && actualHashes[file] === sourceHashes[file])
    && actualFiles.every((file) => required.has(file) || legacy.has(file))
    && Object.keys(actualHashes).every((file) => required.has(file) || legacy.has(file));
}

const CANONICAL_TEXT = CANONICAL_CARD_TEXT_STEMS.map((stem) => `public/text/${stem}.zh_TW.json`);

const FIXED_GAME_ASSETS = [
  "public/game/Assets/Lettuce/_Data/Common/CardNew/Common/UI/Textures/CardUIPokemonFormat5x5/card_icn_ex.png",
  "public/game/Assets/Lettuce/_Data/Common/CardNew/Common/UI/Textures/CardUIPokemonFormat5x5/card_icn_ex_outline.png",
];

function posix(relative) {
  return relative.split(path.sep).join("/");
}

function walkFiles(root, directory, accept) {
  const absolute = path.join(root, directory);
  const files = [];
  for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
    const relative = posix(path.join(directory, entry.name));
    if (entry.isDirectory()) files.push(...walkFiles(root, relative, accept));
    else if (entry.isFile() && accept(relative)) files.push(relative);
  }
  return files;
}

function collectGameUrls(value, files) {
  if (typeof value === "string") {
    if (value.startsWith("/game/")) files.add(`public/game/${value.slice("/game/".length)}`);
    return;
  }
  if (Array.isArray(value)) {
    for (const child of value) collectGameUrls(child, files);
    return;
  }
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) collectGameUrls(child, files);
  }
}

function readJson(root, relative) {
  return JSON.parse(fs.readFileSync(path.join(root, relative), "utf8"));
}

export function runtimeShaderManifestReferences(source) {
  const manifests = new Set();
  const pattern = /["'](?:\.\.\/)*shaders\/([^"']+\.json)["']/g;
  for (const match of source.matchAll(pattern)) manifests.add(`public/shaders/${match[1]}`);
  return [...manifests].sort();
}

function contractRuntimeReferences(root, manifestFiles) {
  const files = new Set(manifestFiles);
  const contractRelative = "public/shaders/official_program_port_contract.json";
  if (!files.has(contractRelative)) return files;
  const contract = readJson(root, contractRelative);
  if (contract?.schema !== "pocket-card-render/official-program-port-contract@2"
      || !Array.isArray(contract.ports) || !Array.isArray(contract.runtimeBound)) {
    throw new Error("runtime official program port contract is malformed");
  }
  const rows = [...contract.ports, ...contract.runtimeBound];
  for (const row of rows) {
    const manifestRelative = posix(row.manifest || "");
    if (!manifestRelative.startsWith("public/shaders/") || !manifestRelative.endsWith(".json")) {
      throw new Error("runtime official program port manifest path is invalid");
    }
    files.add(manifestRelative);
    const manifest = readJson(root, manifestRelative);
    for (const source of Object.values(manifest.webgl_sources || {})) {
      const sourceRelative = posix(source || "");
      if (!sourceRelative.startsWith("public/shaders/") || !sourceRelative.endsWith(".glsl")) {
        throw new Error(`${manifestRelative}: runtime WebGL source path is invalid`);
      }
      files.add(sourceRelative);
    }
  }
  return files;
}

export function fullRuntimeSourceFiles(root) {
  const runtimeRenderSources = walkFiles(root, "public/render", (file) => /\.(?:js|json)$/.test(file));
  const runtimeJavaScript = ["public/app.js", ...runtimeRenderSources.filter((file) => file.endsWith(".js"))];
  const runtimeShaderManifests = contractRuntimeReferences(root, runtimeJavaScript.flatMap((file) => (
    runtimeShaderManifestReferences(fs.readFileSync(path.join(root, file), "utf8"))
  )));
  const files = new Set([
    officialSampleSelectionRelative,
    officialSampleManifestRelative,
    ...FIXED,
    ...CANONICAL_TEXT,
    ...FIXED_GAME_ASSETS,
    ...CANONICAL_FULL_RUNTIME_SCENES.map(({ file }) => `public/${file}`),
    ...runtimeRenderSources,
    ...runtimeShaderManifests,
    ...walkFiles(root, "public/shaders", (file) => file.endsWith(".glsl")),
  ]);

  const dataFiles = [
    ...CANONICAL_FULL_RUNTIME_SCENES.map(({ file }) => `public/${file}`),
    ...CANONICAL_TEXT,
    "public/locales/card_face.zh_TW.json",
    "public/locales/card_ui.zh_TW.json",
    "public/locales/manifest.json",
    "public/game/tmp-fonts/manifest.json",
  ];
  for (const relative of dataFiles) collectGameUrls(readJson(root, relative), files);

  const inventory = [...files].sort();
  for (const relative of inventory) {
    const absolute = path.join(root, relative);
    if (!fs.statSync(absolute).isFile()) throw new Error(`full runtime evidence source is not a file: ${relative}`);
  }
  return inventory;
}
