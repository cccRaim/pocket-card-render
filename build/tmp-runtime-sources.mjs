import fs from "node:fs";
import path from "node:path";
import {
  FULL_RUNTIME_DEFINITION,
  fullRuntimeOfficialSampleIdentity,
  fullRuntimeOfficialSampleIdentityMatches,
  loadFullRuntimeDefinition,
  validateFullRuntimeCanonicalCorpus,
} from "./full-runtime-sources.mjs";

export const validateTmpRuntimeCanonicalCorpus = validateFullRuntimeCanonicalCorpus;

export function loadTmpRuntimeDefinition({
  root,
  manifestPath = process.env.PCR_OFFICIAL_SAMPLE_MANIFEST,
} = {}) {
  return loadFullRuntimeDefinition({
    ...(root ? { root } : {}),
    manifestPath,
  });
}

export const TMP_RUNTIME_DEFINITION = FULL_RUNTIME_DEFINITION;
export const TMP_RUNTIME_OFFICIAL_SAMPLE = TMP_RUNTIME_DEFINITION.sampleLabel;
export const TMP_RUNTIME_CANONICAL_SCENES = TMP_RUNTIME_DEFINITION.scenes;

export function tmpRuntimeOfficialSampleIdentity(definition = TMP_RUNTIME_DEFINITION) {
  return fullRuntimeOfficialSampleIdentity(definition);
}

export function tmpRuntimeOfficialSampleIdentityMatches(
  artifact,
  definition = TMP_RUNTIME_DEFINITION,
) {
  return fullRuntimeOfficialSampleIdentityMatches(artifact, definition);
}

export function tmpRuntimeExpectedCaptureKeys(definition = TMP_RUNTIME_DEFINITION) {
  return definition.scenes.map(({ file }) => `${file}|zh_TW`).sort();
}

export function tmpRuntimeCaptureInventoryMatches(
  artifact,
  definition = TMP_RUNTIME_DEFINITION,
) {
  const expected = tmpRuntimeExpectedCaptureKeys(definition);
  const actual = Object.keys(artifact?.captures || {}).sort();
  return actual.length === expected.length
    && actual.every((value, index) => value === expected[index]);
}

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
  "public/render/card-text-design-contract.json",
  "public/render/card-ui-layout-contract.json",
  "public/render/dynamic-ui-texture.js",
  "public/render/official-texture.js",
  "public/render/official-ui-rt.js",
  "public/render/quality-profile.js",
  "public/render/tmp-font-data.js",
  "public/render/tmp-rich-text.js",
  "public/render/tmp-sprite-contract.json",
  "public/render/tmp-sprite-data.js",
  "public/render/tmp-sprite-program.js",
  "public/render/tmp-sprite-program.json",
  "public/render/tmp-settings-contract.json",
  "public/render/tmp-sdf-renderer.js",
  "public/game/tmp-fonts/manifest.json",
  "public/game/tmp-sprites/TextExSprite.png",
  "public/shaders/tmp_sdf.vert.glsl",
  "public/shaders/tmp_sdf.frag.glsl",
  "public/shaders/tmp_sdf_program.json",
  "public/shaders/tmp_sprite_to_rt.vert.glsl",
  "public/shaders/tmp_sprite_to_rt.frag.glsl",
  "public/shaders/ui_default_to_rt.vert.glsl",
  "public/shaders/ui_default_to_rt.frag.glsl",
  "public/shaders/ui_default_to_rt_program.json",
  "public/shaders/ui_default_from_rt.vert.glsl",
  "public/shaders/ui_default_from_rt.frag.glsl",
  "public/shaders/ui_default_from_rt_program.json",
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

export function tmpRuntimeSourceFiles(root, definition = TMP_RUNTIME_DEFINITION) {
  return [...new Set([
    ...(definition.explicitSelection || definition.sample.status === "candidate"
      ? [
        definition.selectionRelative,
        definition.manifestRelative,
        definition.canonicalCorpusRelative,
      ]
      : []),
    ...(definition.sample.status === "candidate"
      ? [definition.canonicalScenesRelative]
      : []),
    ...FIXED,
    ...definition.scenes.map(({ file }) => `public/${file}`),
    ...matchingFiles(root, "public/text", /\.json$/),
    ...matchingFiles(root, "public/locales", /^card_ui\..+\.json$/),
  ])].sort();
}
