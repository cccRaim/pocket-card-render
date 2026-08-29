// Static server for the pocket-card-render renderer (self-contained).
//   /        -> public/        (index.html, app.js, scene.*.json, shaders, fonts)
//   /game/   -> public/game/   (the card's textures .png + meshes .glb, gathered by build/gather.mjs)
// Everything the renderer needs lives under public/ — no proxy onto an external game export.
// The /scene and /compose endpoints below are OPTIONAL (only for devs who have the full prep
// pipeline + their own game data); the default demo uses the prebuilt static scene.*.json.
import { createServer } from "node:http";
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { join, extname, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import {
  TMP_RUNTIME_CANONICAL_SCENES,
  TMP_RUNTIME_OFFICIAL_SAMPLE,
  tmpRuntimeOfficialSampleIdentity,
  tmpRuntimeOfficialSampleIdentityMatches,
  tmpRuntimeSourceFiles,
  tmpRuntimeSourceIdentityMatches,
} from "./build/tmp-runtime-sources.mjs";
import {
  CANONICAL_FULL_RUNTIME_SCENES,
  FULL_RUNTIME_DEFINITION,
  FULL_RUNTIME_OFFICIAL_SAMPLE,
  FULL_RUNTIME_SCHEMA_VERSION,
  fullRuntimeOfficialSampleIdentity,
  fullRuntimeOfficialSampleIdentityMatches,
  fullRuntimeSourceIdentityMatches,
  fullRuntimeSourceFiles,
} from "./build/full-runtime-sources.mjs";
import {
  createRuntimePortAssetResolver,
  RUNTIME_PORT_CONTRACT_ROUTE,
} from "./build/runtime-port-assets.mjs";
import {
  FULL_RUNTIME_PROVENANCE_PROTOCOL,
  manifestSetRoot,
  sha256Text,
  signRuntimeArtifact,
  sourceSetRoot,
} from "./build/runtime-evidence-provenance.mjs";
import {
  atomicWriteFile,
  readOrCreateFile,
  replaceFile,
  withFileLock,
} from "./build/atomic-publish.mjs";
import { sceneExampleAvailability } from "./build/scene-example-availability.mjs";

const HERE = join(fileURLToPath(new URL(".", import.meta.url)));
const PUB = join(HERE, "public");
const GAME = join(PUB, "game");
const THREE = join(HERE, "node_modules", "three");
const PORT = Number(process.argv[2]) || 8011;
const TMP_RUNTIME_EVIDENCE = join(HERE, "tmp-runtime-evidence.local.json");
const FULL_RUNTIME_EVIDENCE = join(HERE, "$cache", "full-runtime-evidence.local.json");
const FULL_RUNTIME_EVIDENCE_STAGING = join(HERE, "$cache", "full-runtime-evidence.staging.local.json");
const FULL_RUNTIME_PROVENANCE_KEY = join(HERE, "$cache", "runtime-evidence-provenance.key");
const FULL_RUNTIME_SCENE_MAP = new Map(CANONICAL_FULL_RUNTIME_SCENES.map((scene) => [scene.file, scene]));
const SHA256 = /^[0-9a-f]{64}$/;
let fullRuntimeEvidenceWrite = Promise.resolve();
let tmpRuntimeEvidenceWrite = Promise.resolve();
let runtimeProvenanceKeyLoad;
const fullRuntimeSessions = new Map();
const FULL_RUNTIME_SESSION_TTL_MS = 30 * 60 * 1000;
const TMP_RUNTIME_SCENE_SET = new Set(
  TMP_RUNTIME_CANONICAL_SCENES.map(({ file }) => file),
);
const runtimePortAssets = createRuntimePortAssetResolver({
  root: HERE,
  definition: FULL_RUNTIME_DEFINITION,
});

function safeDecodeRequestPath(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

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
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function fullRuntimeIdentity() {
  const sourceFiles = fullRuntimeSourceFiles(HERE);
  const sourceHashes = Object.fromEntries(await Promise.all(
    sourceFiles.map(async (file) => [file, await sha256File(join(HERE, file))]),
  ));
  return {
    sourceFiles,
    sourceHashes,
    sourceSetSha256: sourceSetRoot(sourceHashes),
    manifestSetSha256: manifestSetRoot(sourceHashes),
  };
}

function runtimeProvenanceKey() {
  runtimeProvenanceKeyLoad ??= readOrCreateFile(
    FULL_RUNTIME_PROVENANCE_KEY,
    () => randomBytes(32),
    {
      mode: 0o600,
      validate(value) {
        if (value.length !== 32) throw new Error("runtime provenance key has an invalid length");
      },
    },
  );
  return runtimeProvenanceKeyLoad;
}

function canonicalRuntimeUrl(rawUrl, req) {
  const url = new URL(rawUrl);
  const expectedOrigin = `http://${req.headers.host}`;
  if (url.origin !== expectedOrigin || url.pathname !== "/") throw new Error("runtime capture URL origin/path mismatch");
  const allowed = new Set(["scene", "lc", "auditrt", "quality"]);
  for (const key of url.searchParams.keys()) {
    if (!allowed.has(key)) throw new Error(`runtime capture URL contains forbidden parameter: ${key}`);
  }
  if (url.searchParams.get("auditrt") !== "1" || url.searchParams.get("lc") !== "zh_TW") {
    throw new Error("runtime capture URL must request auditrt=1 and lc=zh_TW");
  }
  const scene = url.searchParams.get("scene");
  if (!FULL_RUNTIME_SCENE_MAP.has(scene)) throw new Error("runtime capture URL scene is not canonical");
  if (url.searchParams.has("quality") && url.searchParams.get("quality") !== "middle") {
    throw new Error("runtime capture URL quality must be middle when specified");
  }
  return url.href;
}

function sessionCredentialsMatch(session, batchId, nonce) {
  if (!session || typeof nonce !== "string") return false;
  const actual = Buffer.from(sha256Text(nonce), "hex");
  const expected = Buffer.from(session.nonceSha256, "hex");
  return batchId === session.batchId && actual.length === expected.length && timingSafeEqual(actual, expected);
}

function pruneFullRuntimeSessions() {
  const now = Date.now();
  for (const [batchId, session] of fullRuntimeSessions) {
    if (session.expiresAtMs <= now) fullRuntimeSessions.delete(batchId);
  }
}

async function createOrExtendFullRuntimeSession(req, res) {
  if (req.method !== "POST") {
    res.writeHead(405, { allow: "POST" }).end("method not allowed");
    return;
  }
  pruneFullRuntimeSessions();
  const body = await readRequestJson(req, 64 * 1024);
  let expectedUrl;
  try {
    expectedUrl = canonicalRuntimeUrl(body?.url, req);
  } catch (error) {
    res.writeHead(400).end(String(error.message || error));
    return;
  }
  const url = new URL(expectedUrl);
  const scene = url.searchParams.get("scene");
  const locale = url.searchParams.get("lc");
  const identity = await fullRuntimeIdentity();
  let session = body?.batchId ? fullRuntimeSessions.get(body.batchId) : null;
  let nonce = body?.sessionNonce;
  if (session) {
    if (!sessionCredentialsMatch(session, body.batchId, nonce)) {
      res.writeHead(401).end("invalid runtime capture session credentials");
      return;
    }
    if (session.sourceSetSha256 !== identity.sourceSetSha256
      || session.manifestSetSha256 !== identity.manifestSetSha256) {
      fullRuntimeSessions.delete(session.batchId);
      res.writeHead(409).end("runtime sources changed during capture batch");
      return;
    }
  } else {
    nonce = randomBytes(32).toString("base64url");
    const issuedAtMs = Date.now();
    session = {
      protocol: FULL_RUNTIME_PROVENANCE_PROTOCOL,
      batchId: randomUUID(),
      nonceSha256: sha256Text(nonce),
      issuedAtMs,
      expiresAtMs: issuedAtMs + FULL_RUNTIME_SESSION_TTL_MS,
      sourceSetSha256: identity.sourceSetSha256,
      manifestSetSha256: identity.manifestSetSha256,
      expectedUrls: new Map(),
      usedCaptureKeys: new Set(),
    };
    fullRuntimeSessions.set(session.batchId, session);
  }
  session.expectedUrls.set(`${scene}|${locale}`, expectedUrl);
  const response = {
    protocol: session.protocol,
    batchId: session.batchId,
    sessionNonce: nonce,
    issuedAt: new Date(session.issuedAtMs).toISOString(),
    expiresAt: new Date(session.expiresAtMs).toISOString(),
    sourceSetSha256: session.sourceSetSha256,
    manifestSetSha256: session.manifestSetSha256,
    expectedUrl,
  };
  res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" }).end(JSON.stringify(response));
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
        availability: await sceneExampleAvailability(data, PUB),
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

async function sha256File(file) {
  return createHash("sha256").update(await readFile(file)).digest("hex");
}

async function readRequestJson(req, limit = 64 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error("request body too large");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function writeTmpRuntimeEvidence(body) {
  const scene = String(body.scene || "");
  const locale = String(body.locale || "");
  const evidence = body.evidence;
  if (!TMP_RUNTIME_SCENE_SET.has(scene)
    || locale !== "zh_TW"
    || evidence?.mode !== "official-tmp-sdf-webgl"
    || !Number.isInteger(evidence.drawCount)
    || !Number.isInteger(evidence.glyphCount)
    || evidence.fallbackCount !== 0
    || !evidence.readback) {
    throw new TypeError("invalid TMP runtime evidence");
  }
  const sourceHashes = Object.fromEntries(await Promise.all(
    tmpRuntimeSourceFiles(HERE).map(async (file) => [file, await sha256File(join(HERE, file))]),
  ));
  const previous = await readJsonIfExists(TMP_RUNTIME_EVIDENCE);
  const artifact = previous?.schemaVersion === 1
    && previous.officialSample === TMP_RUNTIME_OFFICIAL_SAMPLE
    && tmpRuntimeOfficialSampleIdentityMatches(previous)
    && tmpRuntimeSourceIdentityMatches(previous.sourceHashes, sourceHashes)
    ? { ...previous, sourceHashes }
    : {
        schemaVersion: 1,
        officialSample: TMP_RUNTIME_OFFICIAL_SAMPLE,
        officialSampleIdentity: tmpRuntimeOfficialSampleIdentity(),
        sourceHashes,
        captures: {},
      };
  artifact.generatedAt = new Date().toISOString();
  artifact.captures[`${scene}|${locale}`] = {
    scene,
    locale,
    url: String(body.url || ""),
    capturedAt: artifact.generatedAt,
    evidence,
  };
  await atomicWriteFile(TMP_RUNTIME_EVIDENCE, `${JSON.stringify(artifact, null, 2)}\n`);
}

async function recordTmpRuntimeEvidence(req, res) {
  if (req.method !== "POST") {
    res.writeHead(405, { allow: "POST" }).end("method not allowed");
    return;
  }
  const body = await readRequestJson(req);
  const pending = tmpRuntimeEvidenceWrite.then(() => withFileLock(
    TMP_RUNTIME_EVIDENCE,
    () => writeTmpRuntimeEvidence(body),
  ));
  tmpRuntimeEvidenceWrite = pending.catch(() => {});
  try {
    await pending;
  } catch (error) {
    if (error instanceof TypeError) {
      res.writeHead(400).end(error.message);
      return;
    }
    throw error;
  }
  res.writeHead(204, { "cache-control": "no-store" }).end();
}

function validPixelSummary(value, attachment) {
  if (!value || value.attachment !== attachment
    || !Number.isInteger(value.width) || value.width <= 0
    || !Number.isInteger(value.height) || value.height <= 0
    || value.pixelCount !== value.width * value.height
    || !Number.isInteger(value.nonzeroPixels) || value.nonzeroPixels < 0 || value.nonzeroPixels > value.pixelCount
    || !Number.isInteger(value.rgbNonzeroPixels) || value.rgbNonzeroPixels < 0
      || value.rgbNonzeroPixels > value.pixelCount
    || !Number.isSafeInteger(value.rgbEnergy) || value.rgbEnergy < 0
      || value.rgbEnergy > value.pixelCount * 255 * 3
    || !Number.isInteger(value.rgbMax) || value.rgbMax < 0 || value.rgbMax > 255
    || !Number.isInteger(value.alphaNonzero) || value.alphaNonzero < 0 || value.alphaNonzero > value.pixelCount
    || !SHA256.test(value.rgbaSha256 || "")) return false;
  if ((value.rgbNonzeroPixels === 0) !== (value.rgbEnergy === 0)
    || (value.rgbNonzeroPixels === 0) !== (value.rgbMax === 0)) return false;
  if (value.nonzeroPixels === 0) return value.bounds === null;
  return Array.isArray(value.bounds) && value.bounds.length === 4 && value.bounds.every(Number.isInteger)
    && value.bounds[0] >= 0 && value.bounds[1] >= 0
    && value.bounds[2] >= value.bounds[0] && value.bounds[3] >= value.bounds[1]
    && value.bounds[2] < value.width && value.bounds[3] < value.height;
}

function validVisiblePixelSummary(value, attachment) {
  return validPixelSummary(value, attachment)
    && value.rgbNonzeroPixels > 0
    && value.rgbEnergy > 0
    && value.rgbMax > 0;
}

function finiteArray(value, length) {
  return Array.isArray(value) && value.length === length && value.every(Number.isFinite);
}

function validTransformProbeState(value) {
  return value && Number.isFinite(value.officialTime)
    && finiteArray(value.renderObjectQuaternion, 4)
    && finiteArray(value.displayQuaternion, 4)
    && Array.isArray(value.viewportPoints) && value.viewportPoints.length === 4
    && value.viewportPoints.every((point) => finiteArray(point, 2))
    && finiteArray(value.homography, 9)
    && finiteArray(value.inverseHomography, 9)
    && Array.isArray(value.source?.attachments) && value.source.attachments.length === 2
    && validVisiblePixelSummary(value.source.attachments[0], 0)
    && validPixelSummary(value.source.attachments[1], 1)
    && validVisiblePixelSummary(value.display?.attachment, 0)
    && Number.isInteger(value.localDrawCount) && value.localDrawCount > 0;
}

function validFullRuntimeCapture(body) {
  const canonical = FULL_RUNTIME_SCENE_MAP.get(body?.scene);
  const diagnostics = body?.diagnostics;
  const officialSampleIdentity = fullRuntimeOfficialSampleIdentity();
  const display = diagnostics?.display;
  const surface = diagnostics?.surface;
  const sourceAttachments = body?.source?.attachments;
  const localDraws = body?.localDraws;
  const transformProbe = body?.transformProbe;
  return body?.schemaVersion === FULL_RUNTIME_SCHEMA_VERSION
    && body?.provenance?.protocol === FULL_RUNTIME_PROVENANCE_PROTOCOL
    && typeof body.provenance.batchId === "string"
    && typeof body.provenance.sessionNonce === "string"
    && SHA256.test(body.provenance.sourceSetSha256 || "")
    && SHA256.test(body.provenance.manifestSetSha256 || "")
    && canonical
    && body.locale === "zh_TW"
    && diagnostics?.scene?.file === canonical.file
    && diagnostics.scene.id === canonical.cardId
    && diagnostics.shaderContract?.sampleId === officialSampleIdentity.sampleId
    && diagnostics.shaderContract?.sampleManifestSha256
      === officialSampleIdentity.sampleManifestSha256
    && diagnostics.locale === "zh_TW"
    && typeof diagnostics.quality?.requested === "string"
    && typeof diagnostics.quality?.selected === "string"
    && Number.isFinite(diagnostics.quality?.factor)
    && Array.isArray(surface?.cssViewport) && surface.cssViewport.length === 2 && surface.cssViewport.every(Number.isFinite)
    && Number.isFinite(surface?.devicePixelRatio) && surface.devicePixelRatio > 0
    && Number.isFinite(surface?.rendererPixelRatio) && surface.rendererPixelRatio > 0
    && Array.isArray(surface?.drawingBufferSize) && surface.drawingBufferSize.length === 2 && surface.drawingBufferSize.every(Number.isInteger)
    && Array.isArray(surface?.canvasBackingSize) && surface.canvasBackingSize.length === 2 && surface.canvasBackingSize.every(Number.isInteger)
    && Array.isArray(surface?.canvasCssSize) && surface.canvasCssSize.length === 2 && surface.canvasCssSize.every(Number.isFinite)
    && Array.isArray(surface?.dynamicUITextureSize) && surface.dynamicUITextureSize.length === 2 && surface.dynamicUITextureSize.every(Number.isInteger)
    && diagnostics.mrt?.attachments === 2
    && diagnostics.mrt?.cardPasses === 1
    && display?.finiteMatrices === true
    && Array.isArray(display.homography) && display.homography.length === 9 && display.homography.every(Number.isFinite)
    && Array.isArray(display.inverseHomography) && display.inverseHomography.length === 9 && display.inverseHomography.every(Number.isFinite)
    && diagnostics.tmp?.mode === "official-tmp-sdf-webgl"
    && Number.isInteger(diagnostics.tmp?.fallbackCount) && diagnostics.tmp.fallbackCount >= 0
    && Number.isInteger(diagnostics.tmp?.drawCount) && diagnostics.tmp.drawCount >= 0
    && Number.isInteger(diagnostics.tmp?.glyphCount) && diagnostics.tmp.glyphCount >= 0
    && Array.isArray(sourceAttachments) && sourceAttachments.length === 2
    && validVisiblePixelSummary(sourceAttachments[0], 0)
    && validPixelSummary(sourceAttachments[1], 1)
    && validVisiblePixelSummary(body?.display?.attachment, 0)
    && Array.isArray(localDraws) && localDraws.length > 0
    && localDraws.every((draw, ordinal) => draw?.ordinal === ordinal
      && typeof draw?.identity?.materialName === "string" && draw.identity.materialName
      && Number.isInteger(draw?.geometry?.count) && draw.geometry.count > 0
      && draw?.pipeline?.program?.vertex?.sourceFnv1a32
      && draw?.pipeline?.program?.fragment?.sourceFnv1a32
      && Array.isArray(draw?.pipeline?.viewport) && draw.pipeline.viewport.length === 4
      && Array.isArray(draw?.pipeline?.scissor) && draw.pipeline.scissor.length === 4)
    && transformProbe?.clock === "OfficialClock.advance(0)"
    && transformProbe?.adapter === "official-touch-rotation/absolute-pointer"
    && finiteArray(transformProbe?.normalizedTiltPoint, 2)
    && validTransformProbeState(transformProbe?.neutral)
    && validTransformProbeState(transformProbe?.tilted);
}

async function writeFullRuntimeCapture(body, session, identity) {
  const { sourceFiles, sourceHashes } = identity;
  const canonicalScene = FULL_RUNTIME_SCENE_MAP.get(body.scene);
  if (body.diagnostics.scene.sha256 !== sourceHashes[`public/${body.scene}`]) {
    throw new Error("runtime scene hash does not match the current canonical scene");
  }
  if (canonicalScene?.sha256
    && body.diagnostics.scene.sha256 !== canonicalScene.sha256) {
    throw new Error(
      "runtime scene hash does not match candidate canonical scene evidence",
    );
  }
  const previous = await readJsonIfExists(FULL_RUNTIME_EVIDENCE_STAGING);
  const officialSampleIdentity = fullRuntimeOfficialSampleIdentity();
  const sourceIdentityMatches = previous?.schemaVersion === FULL_RUNTIME_SCHEMA_VERSION
    && previous.kind === "full-card-no-screenshot-runtime"
    && previous.officialSample === FULL_RUNTIME_OFFICIAL_SAMPLE
    && fullRuntimeOfficialSampleIdentityMatches(previous)
    && previous.provenance?.batchId === session.batchId
    && previous.captures && typeof previous.captures === "object"
    && fullRuntimeSourceIdentityMatches(previous, sourceFiles, sourceHashes);
  const artifact = sourceIdentityMatches ? { ...previous, sourceFiles, sourceHashes } : {
    schemaVersion: FULL_RUNTIME_SCHEMA_VERSION,
    kind: "full-card-no-screenshot-runtime",
    officialSample: FULL_RUNTIME_OFFICIAL_SAMPLE,
    officialSampleIdentity,
    sourceFiles,
    sourceHashes,
    provenance: {
      protocol: session.protocol,
      batchId: session.batchId,
      nonceSha256: session.nonceSha256,
      issuedAt: new Date(session.issuedAtMs).toISOString(),
      expiresAt: new Date(session.expiresAtMs).toISOString(),
      sourceSetSha256: session.sourceSetSha256,
      manifestSetSha256: session.manifestSetSha256,
    },
    captureBatchStartedAt: new Date().toISOString(),
    captures: {},
  };
  const capturedAt = new Date().toISOString();
  artifact.generatedAt = capturedAt;
  const { provenance: submittedProvenance, ...capture } = body;
  artifact.captures[`${body.scene}|${body.locale}`] = {
    ...capture,
    provenance: {
      protocol: submittedProvenance.protocol,
      batchId: submittedProvenance.batchId,
      sourceSetSha256: submittedProvenance.sourceSetSha256,
      manifestSetSha256: submittedProvenance.manifestSetSha256,
    },
    capturedAt,
  };
  artifact.provenance.captureKeys = Object.keys(artifact.captures).sort();
  const complete = CANONICAL_FULL_RUNTIME_SCENES.every(({ file }) => artifact.captures[`${file}|zh_TW`]);
  if (complete) artifact.provenance.completedAt = capturedAt;
  const key = await runtimeProvenanceKey();
  artifact.attestation = {
    algorithm: "HMAC-SHA256",
    keyId: createHash("sha256").update(key).digest("hex").slice(0, 16),
  };
  artifact.attestation.hmacSha256 = signRuntimeArtifact(artifact, key);
  await atomicWriteFile(
    FULL_RUNTIME_EVIDENCE_STAGING,
    `${JSON.stringify(artifact, null, 2)}\n`,
  );
  if (complete) {
    await replaceFile(FULL_RUNTIME_EVIDENCE_STAGING, FULL_RUNTIME_EVIDENCE);
  }
}

async function recordFullRuntimeEvidence(req, res) {
  if (req.method !== "POST") {
    res.writeHead(405, { allow: "POST" }).end("method not allowed");
    return;
  }
  const body = await readRequestJson(req, 16 * 1024 * 1024);
  if (!validFullRuntimeCapture(body)) {
    res.writeHead(400).end("invalid full runtime evidence");
    return;
  }
  pruneFullRuntimeSessions();
  const session = fullRuntimeSessions.get(body.provenance.batchId);
  const captureKey = `${body.scene}|${body.locale}`;
  if (!sessionCredentialsMatch(session, body.provenance.batchId, body.provenance.sessionNonce)) {
    res.writeHead(401).end("invalid or expired runtime capture session");
    return;
  }
  if (session.usedCaptureKeys.has(captureKey)) {
    res.writeHead(409).end("runtime capture key was already submitted in this batch");
    return;
  }
  const expectedUrl = session.expectedUrls.get(captureKey);
  const origin = new URL(expectedUrl).origin;
  if (body.url !== expectedUrl
    || req.headers.referer !== expectedUrl
    || (req.headers.origin && req.headers.origin !== origin)) {
    res.writeHead(403).end("runtime capture request provenance mismatch");
    return;
  }
  const identity = await fullRuntimeIdentity();
  if (session.sourceSetSha256 !== identity.sourceSetSha256
    || session.manifestSetSha256 !== identity.manifestSetSha256
    || body.provenance.sourceSetSha256 !== session.sourceSetSha256
    || body.provenance.manifestSetSha256 !== session.manifestSetSha256) {
    fullRuntimeSessions.delete(session.batchId);
    res.writeHead(409).end("runtime sources changed during capture batch");
    return;
  }
  const pending = fullRuntimeEvidenceWrite.then(() => withFileLock(
    FULL_RUNTIME_EVIDENCE,
    () => writeFullRuntimeCapture(body, session, identity),
  ));
  fullRuntimeEvidenceWrite = pending.catch(() => {});
  await pending;
  session.usedCaptureKeys.add(captureKey);
  res.writeHead(204, { "cache-control": "no-store" }).end();
}

createServer(async (req, res) => {
  try {
    let p = safeDecodeRequestPath(req.url.split("?")[0]);
    if (p === "/") p = "/index.html";
    if (p === "/scenes") return await serveScenes(req, res);
    if (p === "/compose") return await serveCompose(req, res);
    if (p === "/scene") return await serveScene(req, res);
    if (p === "/audit/tmp-runtime") return await recordTmpRuntimeEvidence(req, res);
    if (p === "/audit/full-runtime/session") return await createOrExtendFullRuntimeSession(req, res);
    if (p === "/audit/full-runtime") return await recordFullRuntimeEvidence(req, res);
    if (p === RUNTIME_PORT_CONTRACT_ROUTE || p.startsWith("/runtime/candidate-port/")) {
      const asset = runtimePortAssets.read(p);
      if (!asset) {
        res.writeHead(404).end("runtime port asset not found");
        return;
      }
      res.writeHead(200, {
        "content-type": MIME[asset.extension] || "application/octet-stream",
        "cache-control": "no-store",
      });
      res.end(asset.bytes);
      return;
    }
    if (p.startsWith("/game/")) return await serveFrom(GAME, p.slice("/game/".length), res);
    if (p.startsWith("/vendor/three/")) return await serveFrom(THREE, p.slice("/vendor/three/".length), res);
    return await serveFrom(PUB, p, res);
  } catch (e) { res.writeHead(500).end(String(e)); }
}).listen(PORT, () => console.log(`pocket-card-render  http://127.0.0.1:${PORT}/   (?scene=scene.<cardId>.json)`));
