// Check scene-bound ShaderLab Color/Vector properties against official shader props
// and renderer strategy usage. This covers inputs such as _Rotation,
// _EmissiveColor, _FakeSpecularColor, and _DarknessColor that float/texture
// audits cannot see.
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { SHADER } from "../public/render/rarities.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const shaderRoot = process.env.PCR_SHADERS
  || "D:/DevProjectes/ptcgp-tools-master/masterdata_decoder/.output/decrypted/Common/Shader";
const reportExtraColors = process.env.PCR_AUDIT_EXTRA_COLORS === "1";
const strictExtraColors = process.env.PCR_AUDIT_STRICT_EXTRA_COLORS === "1";
const sceneNames = fs.readdirSync(path.join(ROOT, "public"))
  .filter((n) => /^scene\..*\.json$/.test(n))
  .sort();

const USED_BY_KIND = {
  textured: [],
  illustTextured: [],
  simpleTransparent: [],
  depthParallax: [],
  effect: [],
  frameOutline: [],
  holo: ["_Rotation"],
  frameHolo: ["_Rotation"],
  frameHoloUR: ["_FakeSpecularColor", "_DarknessColor", "_EmissiveColor", "_Rotation"],
  frame2LayerUR: [
    "_FakeSpecularColor", "_FakeSpecularColor2", "_DarknessColor1",
    "_DarknessColor2", "_EmissiveColor", "_Rotation",
  ],
  exHolo: ["_Rotation"],
  exHoloUR: ["_FakeSpecularColor", "_DarknessColor", "_Rotation"],
  rarity: ["_Rotation"],
  sbHolo: [
    "_OutlineColor", "_ReflectionColor", "_FakeSpecularColor",
    "_FakeSpecularColor_Outline", "_DarknessColor", "_EmissiveColor",
    "_Rotation",
  ],
  plate: ["_FakeSpecularColor", "_DarknessColor"],
  parallaxUR: ["_DarknessColor"],
  urBgHolo: ["_FakeSpecularColor", "_DarknessColor", "_Rotation"],
  flare: ["_BaseColor", "_EmissiveColor"],
  metal: ["_Rotation"],
  glitter: ["_LightColor"],
};

const USED_BY_SHADER = {
  "Frame-2Layer-UR": [
    "_FakeSpecularColor", "_FakeSpecularColor2", "_DarknessColor1",
    "_DarknessColor2", "_EmissiveColor", "_Rotation",
  ],
  "Frame-Holo-UR-New": ["_FakeSpecularColor", "_DarknessColor", "_EmissiveColor", "_Rotation"],
  "Opaque-UR-Oklab": [
    "_OutlineColor", "_ReflectionColor", "_FakeSpecularColor",
    "_FakeSpecularColor_Outline", "_DarknessColor", "_EmissiveColor",
    "_Rotation",
  ],
};

const OFFICIAL_DEAD_COLORS = new Set([
  "Opaque-UR-Oklab:_Front",
]);

function usedColorsFor(shader, kind) {
  return new Set(USED_BY_SHADER[shader] || USED_BY_KIND[kind] || []);
}

function declaredStrategyColors() {
  const colors = new Set();
  for (const list of Object.values(USED_BY_KIND)) for (const name of list) colors.add(name);
  for (const list of Object.values(USED_BY_SHADER)) for (const name of list) colors.add(name);
  return colors;
}

function sourceColorRefs() {
  const dir = path.join(ROOT, "public/render/materials");
  const rows = [];
  const field = "(_[A-Za-z0-9_]+)";
  const patterns = [
    new RegExp(`(^|[^A-Za-z0-9_$])c\\?\\.${field}`, "g"),
    new RegExp(`(^|[^A-Za-z0-9_$])c\\.${field}`, "g"),
    new RegExp(`(^|[^A-Za-z0-9_$])r\\.colors\\?\\.${field}`, "g"),
    new RegExp(`(^|[^A-Za-z0-9_$])r\\.colors\\.${field}`, "g"),
  ];
  for (const file of fs.readdirSync(dir).filter((n) => n.endsWith(".js"))) {
    const src = fs.readFileSync(path.join(dir, file), "utf8");
    for (const re of patterns) {
      for (const m of src.matchAll(re)) rows.push({ file, name: m[2] });
    }
  }
  return rows;
}

function sceneId(sceneName) {
  return sceneName.replace(/^scene\.|\.json$/g, "");
}

let official;
try {
  const stdout = execSync("python build/extract-shader-defaults.py", {
    input: JSON.stringify({ root: shaderRoot, shaders: Object.keys(SHADER).sort() }),
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
    stdio: ["pipe", "pipe", "inherit"],
  });
  official = JSON.parse(stdout);
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

const rows = [];
for (const shader of official.missing || []) {
  rows.push({ ok: false, shader, name: "", kind: "", reason: "shader not found in official bundles" });
}

const declaredColors = declaredStrategyColors();
for (const ref of sourceColorRefs()) {
  rows.push({
    ok: declaredColors.has(ref.name),
    scene: "(source)",
    shader: "(source)",
    kind: ref.file,
    mat: ref.file,
    name: ref.name,
    reason: declaredColors.has(ref.name) ? "source color/vector declared" : "source color/vector missing declaration",
  });
}

for (const sceneName of sceneNames) {
  const scene = JSON.parse(fs.readFileSync(path.join(ROOT, "public", sceneName), "utf8"));
  for (const [matName, mat] of Object.entries(scene.materials || {})) {
    const shader = mat.shader;
    if (!shader || shader.startsWith("InnerStencil") || shader === "OuterStencil") continue;
    const cfg = SHADER[shader];
    if (!cfg || cfg.defer) continue;
    const officialColors = new Set([
      ...(official.found[shader]?.colorProps || []),
      ...(official.found[shader]?.vectorProps || []),
    ]);
    const usedColors = usedColorsFor(shader, cfg.kind);
    if (!USED_BY_SHADER[shader] && !USED_BY_KIND[cfg.kind]) {
      rows.push({ ok: false, scene: sceneId(sceneName), shader, kind: cfg.kind, mat: matName, name: "", reason: "missing usage declaration" });
      continue;
    }
    for (const name of Object.keys(mat.colors || {})) {
      if (!officialColors.has(name)) {
        if (reportExtraColors) {
          const used = usedColors.has(name);
          rows.push({
            ok: !(strictExtraColors && used),
            extra: true,
            used,
            scene: sceneId(sceneName),
            shader,
            kind: cfg.kind,
            mat: matName,
            name,
            reason: used ? "strategy declares non-official color/vector" : "not an official shader property",
          });
        }
        continue;
      }
      const used = usedColors.has(name);
      const dead = OFFICIAL_DEAD_COLORS.has(`${shader}:${name}`);
      rows.push({
        ok: dead ? !used : used,
        dead,
        scene: sceneId(sceneName),
        shader,
        kind: cfg.kind,
        mat: matName,
        name,
        reason: dead
          ? (used ? "strategy declares official-dead color/vector" : "official bytecode does not read color/vector")
          : (used ? "strategy uses color/vector" : "strategy ignores official color/vector"),
      });
    }
  }
}

const grouped = new Map();
for (const row of rows) {
  const key = [row.ok, row.reason, row.shader, row.kind || "", row.name].join("|");
  if (!grouped.has(key)) grouped.set(key, { ...row, count: 0, scenes: new Set(), examples: [] });
  const item = grouped.get(key);
  item.count += 1;
  if (row.scene) item.scenes.add(row.scene);
  if (item.examples.length < 4 && row.mat) item.examples.push(row.mat);
}

for (const row of [...grouped.values()].sort((a, b) => a.shader.localeCompare(b.shader) || a.name.localeCompare(b.name) || a.reason.localeCompare(b.reason))) {
  const mark = row.extra ? ((strictExtraColors && row.used) ? "BAD" : "EXTRA") : (row.dead ? "DEAD" : (row.ok ? "OK " : "BAD"));
  console.log(`${mark} ${row.shader.padEnd(35)} kind=${String(row.kind || "").padEnd(18)} color=${row.name.padEnd(28)} ${row.reason.padEnd(40)} count=${String(row.count).padStart(2)} scenes=${[...row.scenes].join(",")}`);
  if (row.examples.length) console.log(`     e.g. ${row.examples.join(", ")}`);
}

const bad = rows.filter((row) => !row.ok);
if (bad.length) {
  console.error(`\n${bad.length} scene color/vector usage issue(s) found.`);
  process.exitCode = 1;
}
