// Audit that every visible material layer in the reference scenes has a registered strategy
// and passes that strategy's resource gate. This catches silent skips before visual QA.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SHADER_TEXTURE_DEFAULTS } from "../public/render/shader-defaults.js";
import "../public/render/materials/index.js";
import { getMaterial, listKinds } from "../public/render/registry.js";
import {
  compileRuntimeMaterialDispatchIndex,
  resolveRuntimeMaterialDispatch,
} from "../public/render/runtime-dispatch-contract.js";
import { CANONICAL_FULL_RUNTIME_SCENES } from "./full-runtime-sources.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const allScenes = process.argv.includes("--all-scenes")
  || process.env.PCR_AUDIT_ALL_SCENES === "1";
const sceneNames = allScenes
  ? fs.readdirSync(path.join(ROOT, "public"))
    .filter((name) => /^scene\..+\.json$/.test(name))
    .sort()
  : CANONICAL_FULL_RUNTIME_SCENES.map(({ file }) => file).sort();

const sentinel = {};
const runtimeSpecialMaterials = new Set([
  // AssetRipper/glTF placeholder material; app.js intentionally skips unknown DefaultMaterial meshes.
  "DefaultMaterial",
]);
const registeredKinds = new Set(listKinds());
const runtimeDispatchIndex = compileRuntimeMaterialDispatchIndex(JSON.parse(
  fs.readFileSync(
    path.join(ROOT, "public", "shaders", "official_program_port_contract.json"),
    "utf8",
  ),
));

function sceneId(sceneName) {
  return sceneName.replace(/^scene\.|\.json$/g, "");
}

function hasBoundTexture(mat, slot) {
  return !!mat.textures?.[slot]?.name;
}

function makeAuditContext(scene) {
  const ctx = {
    envCubeTex: sentinel,
    dynUITex: sentinel,
    dynHoloTex: sentinel,
    foilTex: sentinel,
    runtimeSettings: scene.runtimeSettings || {},
    circularKiraComponents: new Map(),
    animMats: [],
    exactGlitMats: [],
    exHoloMats: [],
    kiraPuyoMats: [],
    layerTex: (mat, slot) => hasBoundTexture(mat, slot) ? sentinel : null,
    layerTexNoColorSpace: (mat, slot) => hasBoundTexture(mat, slot) ? sentinel : null,
    layerTexRepeat: (mat, slot) => hasBoundTexture(mat, slot) ? sentinel : null,
    layerTexDefault: (mat, slot) => (
      hasBoundTexture(mat, slot) || SHADER_TEXTURE_DEFAULTS[mat.shader]?.[slot]
    ) ? sentinel : null,
    layerTexDefaultRepeat: (mat, slot) => (
      hasBoundTexture(mat, slot) || SHADER_TEXTURE_DEFAULTS[mat.shader]?.[slot]
    ) ? sentinel : null,
    layerCubeDefault: (mat, slot) => (
      hasBoundTexture(mat, slot) || SHADER_TEXTURE_DEFAULTS[mat.shader]?.[slot]
    ) ? sentinel : null,
    texStraight: (name) => !!(name && scene.alphaMode?.[name] === "straight"),
  };
  ctx.exactShaderPorts = (mat) => (
    mat.runtimeDispatch?.support === "implemented"
      ? mat.runtimeDispatch.officialPorts.map(() => sentinel)
      : []
  );
  ctx.exactShaderPort = (mat) => {
    const ports = ctx.exactShaderPorts(mat);
    return ports.length === 1 ? ports[0] : null;
  };
  return ctx;
}

function usedGlbMaterials(scene) {
  if (!scene.prefabGlb) return null;
  const file = path.join(ROOT, "public", scene.prefabGlb.replace(/^\//, ""));
  if (!fs.existsSync(file)) return null;
  const buf = fs.readFileSync(file);
  let off = 12;
  let gltf = null;
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32LE(off);
    const type = buf.readUInt32LE(off + 4);
    off += 8;
    if (type === 0x4e4f534a) gltf = JSON.parse(buf.subarray(off, off + len).toString("utf8"));
    off += len;
  }
  if (!gltf) return null;
  const names = (gltf.materials || []).map((m) => m.name);
  const used = new Set();
  for (const mesh of gltf.meshes || []) {
    for (const prim of mesh.primitives || []) {
      const name = names[prim.material];
      if (name) used.add(name);
    }
  }
  return used;
}

const rows = [];
for (const sceneName of sceneNames) {
  const scene = JSON.parse(fs.readFileSync(path.join(ROOT, "public", sceneName), "utf8"));
  const ctx = makeAuditContext(scene);
  const used = usedGlbMaterials(scene);
  if (used) {
    for (const matName of used) {
      if (scene.materials?.[matName] || runtimeSpecialMaterials.has(matName)) continue;
      rows.push({
        ok: false,
        scene: sceneId(sceneName),
        mat: matName,
        shader: "(glb)",
        kind: "",
        reason: "glb material missing scene recipe",
      });
    }
  }
  for (const [matName, mat] of Object.entries(scene.materials || {})) {
    const shader = mat.shader;
    if (!shader) continue;
    const dispatch = resolveRuntimeMaterialDispatch(runtimeDispatchIndex, mat);
    if (!dispatch) {
      rows.push({
        ok: false,
        scene: sceneId(sceneName),
        mat: matName,
        shader,
        reason: "missing runtime dispatch",
      });
      continue;
    }
    if (dispatch.defer) {
      rows.push({
        ok: true,
        scene: sceneId(sceneName),
        mat: matName,
        shader,
        kind: "(defer)",
        reason: "deferred",
      });
      continue;
    }
    if (!registeredKinds.has(dispatch.strategy)) {
      rows.push({
        ok: false,
        scene: sceneId(sceneName),
        mat: matName,
        shader,
        kind: dispatch.strategy,
        reason: "missing strategy",
      });
      continue;
    }
    const strategy = getMaterial(dispatch.strategy);
    const officialDraws = (scene.officialDraws || [])
      .filter((draw) => draw.materialName === matName);
    if (officialDraws.length === 0) {
      rows.push({
        ok: false,
        scene: sceneId(sceneName),
        mat: matName,
        shader,
        kind: dispatch.strategy,
        reason: "missing official draw identity",
      });
      continue;
    }
    for (const draw of officialDraws) {
      const drawRecipe = {
        ...mat,
        runtimeDispatch: dispatch,
        ...(draw.rendererProperties
          ? { rendererProperties: draw.rendererProperties }
          : {}),
      };
      let passes = false;
      try {
        passes = !!strategy.requires(drawRecipe, ctx);
      } catch (err) {
        rows.push({
          ok: false,
          scene: sceneId(sceneName),
          mat: matName,
          shader,
          kind: dispatch.strategy,
          reason: `requires threw: ${err.message}`,
        });
        continue;
      }
      rows.push({
        ok: passes,
        scene: sceneId(sceneName),
        mat: matName,
        shader,
        kind: dispatch.strategy,
        reason: passes ? "renders" : "requires=false",
      });
    }
  }
}

const byKey = new Map();
for (const row of rows) {
  const key = [row.ok, row.reason, row.shader, row.kind || ""].join("|");
  if (!byKey.has(key)) byKey.set(key, { ...row, count: 0, scenes: new Set(), examples: [] });
  const agg = byKey.get(key);
  agg.count += 1;
  agg.scenes.add(row.scene);
  if (agg.examples.length < 4) agg.examples.push(row.mat);
}

console.log(`registered kinds: ${[...registeredKinds].sort().join(", ")}`);
for (const row of [...byKey.values()].sort((a, b) => a.shader.localeCompare(b.shader) || a.reason.localeCompare(b.reason))) {
  const mark = row.ok ? "OK " : "BAD";
  console.log(`${mark} ${row.shader.padEnd(35)} kind=${String(row.kind || "").padEnd(18)} ${row.reason.padEnd(16)} count=${String(row.count).padStart(2)} scenes=${[...row.scenes].join(",")}`);
  console.log(`     e.g. ${row.examples.join(", ")}`);
}

const bad = rows.filter((r) => !r.ok);
if (bad.length) {
  console.error(`\n${bad.length} visible layer coverage issue(s) found.`);
  process.exitCode = 1;
}
