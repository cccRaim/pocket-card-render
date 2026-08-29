import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadOfficialSample,
  officialSampleDigest,
} from "./official-sample.mjs";
import { runtimePortContractRelative } from "./runtime-port-assets.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHA256 = /^[0-9a-f]{64}$/;

function posix(relative) {
  return relative.split(path.sep).join("/");
}

function sha256File(absolute) {
  return crypto.createHash("sha256").update(fs.readFileSync(absolute)).digest("hex");
}

function requireRuntimeDefinition(condition, message) {
  if (!condition) throw new Error(`full runtime official sample: ${message}`);
}

function resolvePackageFile(root, logicalPath, label) {
  requireRuntimeDefinition(
    typeof logicalPath === "string"
      && logicalPath.length > 0
      && !path.isAbsolute(logicalPath),
    `${label} path must be package-relative`,
  );
  const absolute = path.resolve(root, logicalPath);
  const relative = path.relative(root, absolute);
  requireRuntimeDefinition(
    relative !== ""
      && relative !== ".."
      && !relative.startsWith(`..${path.sep}`)
      && !path.isAbsolute(relative),
    `${label} path escapes the package root`,
  );
  requireRuntimeDefinition(fs.statSync(absolute).isFile(), `${label} is not a file`);
  return { absolute, relative: posix(relative) };
}

export function validateFullRuntimeCanonicalCorpus(sample, {
  root = ROOT,
} = {}) {
  requireRuntimeDefinition(
    sample?.canonicalCorpus?.status !== "unresolved",
    "canonical corpus is unresolved",
  );
  requireRuntimeDefinition(
    SHA256.test(sample?.canonicalCorpus?.sha256 || ""),
    "canonical corpus SHA-256 is invalid",
  );
  const resolved = resolvePackageFile(root, sample.canonicalCorpus.path, "canonical corpus");
  const bytes = fs.readFileSync(resolved.absolute);
  const actualSha256 = crypto.createHash("sha256").update(bytes).digest("hex");
  requireRuntimeDefinition(
    actualSha256 === sample.canonicalCorpus.sha256,
    "canonical corpus hash does not match the selected manifest",
  );
  if (sample.canonicalCorpus.byteLength !== undefined) {
    requireRuntimeDefinition(
      sample.canonicalCorpus.byteLength === bytes.length,
      "canonical corpus byteLength does not match the selected manifest",
    );
  }

  const corpus = JSON.parse(bytes.toString("utf8"));
  requireRuntimeDefinition(
    corpus?.schemaVersion === 1 || corpus?.schemaVersion === 2,
    `unsupported canonical corpus schema ${corpus?.schemaVersion}`,
  );
  if (sample.status === "candidate") {
    requireRuntimeDefinition(
      corpus.schemaVersion >= 2 && corpus.sampleId === sample.sampleId,
      "candidate canonical corpus is not bound to the selected sampleId",
    );
  } else if (corpus.sampleId !== undefined) {
    requireRuntimeDefinition(
      corpus.sampleId === sample.sampleId,
      "canonical corpus sampleId does not match the selected manifest",
    );
  }
  requireRuntimeDefinition(
    Array.isArray(corpus.scenes) && corpus.scenes.length > 0,
    "canonical corpus scenes are absent",
  );
  requireRuntimeDefinition(
    Array.isArray(corpus.locales) && corpus.locales.includes("zh_TW"),
    "canonical corpus does not include zh_TW",
  );

  const files = new Set();
  const cardIds = new Set();
  for (const [index, scene] of corpus.scenes.entries()) {
    const prefix = `canonical corpus scene ${index}`;
    requireRuntimeDefinition(
      typeof scene?.file === "string"
        && path.basename(scene.file) === scene.file
        && scene.file.startsWith("scene.")
        && scene.file.endsWith(".json"),
      `${prefix} has an invalid file`,
    );
    requireRuntimeDefinition(
      typeof scene.cardId === "string" && scene.cardId.length > 0,
      `${prefix} has an invalid cardId`,
    );
    requireRuntimeDefinition(
      typeof scene.textStem === "string" && scene.textStem.length > 0,
      `${prefix} has an invalid textStem`,
    );
    requireRuntimeDefinition(!files.has(scene.file), `${prefix} duplicates a scene file`);
    requireRuntimeDefinition(!cardIds.has(scene.cardId), `${prefix} duplicates a cardId`);
    files.add(scene.file);
    cardIds.add(scene.cardId);
  }
  return Object.freeze({
    path: resolved.relative,
    sha256: actualSha256,
    byteLength: bytes.length,
    corpus: Object.freeze(corpus),
  });
}

export function validateCandidateCanonicalScenes(sample, canonical, {
  root = ROOT,
} = {}) {
  if (sample.status !== "candidate") return null;
  const stem = sample.sampleId.replace(/-candidate$/, "");
  const resolved = resolvePackageFile(
    root,
    `build/official-samples/${stem}-canonical-scenes.json`,
    "candidate canonical scene evidence",
  );
  const bytes = fs.readFileSync(resolved.absolute);
  const evidence = JSON.parse(bytes.toString("utf8"));
  const sampleManifestSha256 = officialSampleDigest(sample);
  requireRuntimeDefinition(
    evidence?.schema === "pocket-card-render/candidate-canonical-scenes@3",
    "candidate canonical scene evidence has an unsupported schema",
  );
  requireRuntimeDefinition(
    evidence.candidate?.sampleId === sample.sampleId
      && evidence.candidate?.sampleManifestSha256 === sampleManifestSha256,
    "candidate canonical scene evidence is bound to another sample",
  );
  requireRuntimeDefinition(
    evidence.inputs?.canonicalCorpus?.sha256 === canonical.sha256,
    "candidate canonical scene evidence is bound to another corpus",
  );
  requireRuntimeDefinition(
    Array.isArray(evidence.scenes)
      && evidence.scenes.length === canonical.corpus.scenes.length,
    "candidate canonical scene evidence has the wrong denominator",
  );
  const byFile = new Map(evidence.scenes.map((scene) => [scene.file, scene]));
  requireRuntimeDefinition(
    byFile.size === evidence.scenes.length,
    "candidate canonical scene evidence contains duplicate files",
  );
  const scenes = canonical.corpus.scenes.map((scene) => {
    const fact = byFile.get(scene.file);
    requireRuntimeDefinition(
      fact?.cardId === scene.cardId,
      `candidate canonical scene ${scene.file} has the wrong card identity`,
    );
    requireRuntimeDefinition(
      SHA256.test(fact.sha256 || "")
        && Number.isInteger(fact.byteLength)
        && fact.byteLength > 0,
      `candidate canonical scene ${scene.file} has no byte identity`,
    );
    return Object.freeze({
      ...scene,
      sha256: fact.sha256,
      byteLength: fact.byteLength,
    });
  });
  return Object.freeze({
    path: resolved.relative,
    sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
    byteLength: bytes.length,
    evidence: Object.freeze(evidence),
    scenes: Object.freeze(scenes),
  });
}

export function loadFullRuntimeDefinition({
  root = ROOT,
  manifestPath = process.env.PCR_OFFICIAL_SAMPLE_MANIFEST,
} = {}) {
  const loaded = loadOfficialSample(manifestPath);
  const selection = resolvePackageFile(
    root,
    path.relative(root, loaded.selectionPath),
    "official sample selection",
  );
  const manifest = resolvePackageFile(
    root,
    path.relative(root, loaded.manifestPath),
    "official sample manifest",
  );
  const canonical = validateFullRuntimeCanonicalCorpus(loaded.sample, { root });
  const sampleManifestSha256 = officialSampleDigest(loaded.sample);
  const candidateScenes = validateCandidateCanonicalScenes(
    loaded.sample,
    canonical,
    { root },
  );
  return Object.freeze({
    sample: Object.freeze(loaded.sample),
    sampleId: loaded.sample.sampleId,
    sampleManifestSha256,
    sampleManifestFileSha256: sha256File(manifest.absolute),
    sampleLabel:
      `PTCGP ${loaded.sample.game.versionName} / Unity ${loaded.sample.unity.serializedVersion}`,
    explicitSelection: typeof manifestPath === "string" && manifestPath.length > 0,
    selectionRelative: selection.relative,
    manifestRelative: manifest.relative,
    canonicalCorpusRelative: canonical.path,
    canonicalCorpusSha256: canonical.sha256,
    canonicalCorpusByteLength: canonical.byteLength,
    canonicalScenesRelative: candidateScenes?.path || null,
    canonicalScenesSha256: candidateScenes?.sha256 || null,
    canonicalScenesByteLength: candidateScenes?.byteLength || null,
    corpus: canonical.corpus,
    scenes: Object.freeze(
      (candidateScenes?.scenes || canonical.corpus.scenes)
        .map(({ file, cardId, textStem, sha256, byteLength }) => (
        Object.freeze({
          file,
          cardId,
          textStem,
          ...(sha256 ? { sha256, byteLength } : {}),
        })
      )),
    ),
    locales: Object.freeze([...canonical.corpus.locales]),
  });
}

export const FULL_RUNTIME_DEFINITION = loadFullRuntimeDefinition();

export const FULL_RUNTIME_SCHEMA_VERSION = 6;
export const FULL_RUNTIME_OFFICIAL_SAMPLE = FULL_RUNTIME_DEFINITION.sampleLabel;
export const FULL_RUNTIME_OFFICIAL_SAMPLE_ID = FULL_RUNTIME_DEFINITION.sampleId;
export const FULL_RUNTIME_SAMPLE_MANIFEST_SHA256 =
  FULL_RUNTIME_DEFINITION.sampleManifestSha256;
export const FULL_RUNTIME_CANONICAL_CORPUS_PATH =
  FULL_RUNTIME_DEFINITION.canonicalCorpusRelative;
export const FULL_RUNTIME_CANONICAL_CORPUS_SHA256 =
  FULL_RUNTIME_DEFINITION.canonicalCorpusSha256;

export function fullRuntimeOfficialSampleIdentity(definition = FULL_RUNTIME_DEFINITION) {
  const identity = {
    sampleId: definition.sampleId,
    sampleManifestSha256: definition.sampleManifestSha256,
    canonicalCorpus: Object.freeze({
      path: definition.canonicalCorpusRelative,
      sha256: definition.canonicalCorpusSha256,
    }),
  };
  if (definition.sample.status === "candidate") {
    identity.canonicalScenes = Object.freeze({
      path: definition.canonicalScenesRelative,
      sha256: definition.canonicalScenesSha256,
    });
  }
  return Object.freeze(identity);
}

export function fullRuntimeOfficialSampleIdentityMatches(
  artifact,
  definition = FULL_RUNTIME_DEFINITION,
) {
  const identity = artifact?.officialSampleIdentity;
  if (!identity) {
    return definition.sample.status === "baseline" && !definition.explicitSelection;
  }
  const common = identity.sampleId === definition.sampleId
    && identity.sampleManifestSha256 === definition.sampleManifestSha256
    && identity.canonicalCorpus?.path === definition.canonicalCorpusRelative
    && identity.canonicalCorpus?.sha256 === definition.canonicalCorpusSha256;
  if (!common) return false;
  return definition.sample.status !== "candidate"
    || (
      identity.canonicalScenes?.path === definition.canonicalScenesRelative
      && identity.canonicalScenes?.sha256 === definition.canonicalScenesSha256
    );
}

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
  FULL_RUNTIME_DEFINITION.scenes.map(
    ({ file, cardId, sha256, byteLength }) => Object.freeze({
      file,
      cardId,
      ...(sha256 ? { sha256, byteLength } : {}),
    }),
  ),
);

export const CANONICAL_CARD_TEXT_STEMS = Object.freeze(
  FULL_RUNTIME_DEFINITION.scenes.map(({ textStem }) => textStem),
);

export const CANONICAL_CARD_LOCALES = FULL_RUNTIME_DEFINITION.locales;

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

const FIXED_GAME_ASSETS = [
  "public/game/Assets/Lettuce/_Data/Common/CardNew/Common/UI/Textures/CardUIPokemonFormat5x5/card_icn_ex.png",
  "public/game/Assets/Lettuce/_Data/Common/CardNew/Common/UI/Textures/CardUIPokemonFormat5x5/card_icn_ex_outline.png",
];

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
    if (value.startsWith("/game/")) {
      let decoded;
      try {
        decoded = decodeURIComponent(value.slice("/game/".length));
      } catch (error) {
        throw new Error(`full runtime game URL is not valid percent-encoding: ${value}`);
      }
      if (
        decoded.includes("\\")
        || path.posix.isAbsolute(decoded)
        || path.posix.normalize(decoded) !== decoded
        || decoded.split("/").some((segment) => (
          segment.length === 0 || segment === "." || segment === ".."
        ))
      ) {
        throw new Error(`full runtime game URL escapes its asset root: ${value}`);
      }
      files.add(`public/game/${decoded}`);
    }
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

export function fullRuntimeSourceFiles(root, definition = FULL_RUNTIME_DEFINITION) {
  const canonicalScenes = definition.scenes;
  const canonicalText = canonicalScenes.map(({ textStem }) => `public/text/${textStem}.zh_TW.json`);
  const runtimeRenderSources = walkFiles(root, "public/render", (file) => /\.(?:js|json)$/.test(file));
  const runtimeJavaScript = ["public/app.js", ...runtimeRenderSources.filter((file) => file.endsWith(".js"))];
  const runtimeShaderManifests = contractRuntimeReferences(root, runtimeJavaScript.flatMap((file) => (
    runtimeShaderManifestReferences(fs.readFileSync(path.join(root, file), "utf8"))
  )));
  if (definition.sample.status === "candidate") {
    runtimeShaderManifests.delete("public/shaders/official_program_port_contract.json");
  }
  const files = new Set([
    definition.selectionRelative,
    definition.manifestRelative,
    ...(definition.explicitSelection || definition.sample.status === "candidate"
      ? [definition.canonicalCorpusRelative]
      : []),
    ...(definition.sample.status === "candidate"
      ? [definition.canonicalScenesRelative]
      : []),
    ...FIXED,
    ...canonicalText,
    ...FIXED_GAME_ASSETS,
    ...canonicalScenes.map(({ file }) => `public/${file}`),
    ...runtimeRenderSources,
    ...runtimeShaderManifests,
    ...(definition.sample.status === "candidate"
      ? [
          runtimePortContractRelative(definition),
          "build/runtime-port-assets.mjs",
          "server.mjs",
        ]
      : []),
    ...walkFiles(root, "public/shaders", (file) => file.endsWith(".glsl")),
  ]);

  const dataFiles = [
    ...canonicalScenes.map(({ file }) => `public/${file}`),
    ...canonicalText,
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
  if (definition.sample.status === "candidate") {
    for (const scene of canonicalScenes) {
      const relative = `public/${scene.file}`;
      const absolute = path.join(root, relative);
      const bytes = fs.readFileSync(absolute);
      if (bytes.length !== scene.byteLength || sha256File(absolute) !== scene.sha256) {
        throw new Error(
          `full runtime candidate scene differs from canonical evidence: ${scene.file}`,
        );
      }
    }
  }
  return inventory;
}
