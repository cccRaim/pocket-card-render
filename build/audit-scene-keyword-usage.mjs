// Check that scene shader keywords are intentionally handled by the renderer strategy.
// Keywords select Unity shader variants; silently ignoring a new keyword can shift the
// official bytecode path even when all floats/textures look valid.
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { SHADER } from "../public/render/rarities.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const shaderRoot = process.env.PCR_SHADERS
  || "D:/DevProjectes/ptcgp-tools-master/masterdata_decoder/.output/decrypted/Common/Shader";
const sceneNames = fs.readdirSync(path.join(ROOT, "public"))
  .filter((n) => /^scene\..*\.json$/.test(n))
  .sort();
const portContract = JSON.parse(fs.readFileSync(
  path.join(ROOT, "public", "shaders", "official_program_port_contract.json"),
  "utf8",
));
const exactSelectorManifests = portContract.ports.map((port) => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, port.manifest), "utf8"));
  const selector = manifest.official_selector;
  if (!selector || selector.selectorId !== port.selectorId
      || selector.candidateWitnessId !== port.candidateWitnessId
      || selector.subshader !== port.subshader || selector.pass !== port.pass) {
    throw new Error(`${port.manifest}: selector identity disagrees with the formal port contract`);
  }
  return manifest;
});

const KEYWORDS = {
  Effect: {
    _LAYER_EFF1: { float: "_Layer", value: 0, reason: "selects effect channel R" },
    _LAYER_EFF2: { float: "_Layer", value: 1, reason: "selects effect channel G" },
    _LAYER_EFF3: { float: "_Layer", value: 2, reason: "selects effect channel B" },
    _UseGradationMap: { float: "_UseGradationMap", value: 1, reason: "enables gradation ramp" },
    _UseViewMask: { float: "_UseViewMask", value: 1, reason: "enables view mask path" },
  },
  Card_Parallax: {
    _UVASPECTRATIO_SQUARE: { float: "_UVAspectRatio", value: 0, reason: "selects square UV aspect path" },
  },
  "Opaque-UR-Oklab": {
    _FAKESPECULARENABLED_ON: { float: "_FakeSpecularEnabled", value: 1, reason: "enables fake specular path" },
    _HOLOGRAM2ENABLED_ON: { float: "_Hologram2Enabled", value: 1, reason: "enables second hologram path" },
    _REFLECTIONENABLED_ON: { float: "_ReflectionEnabled", value: 1, reason: "enables reflection path" },
    // The material carries both the keyword and _DarknessEnabled, but the traced Opaque-UR-Oklab
    // bytecode does not read the float. Keeping this explicit prevents reintroducing the dead switch.
    _DARKNESSENABLED_ON: { officialDead: "_DarknessEnabled", reason: "keyword present; runtime float is official-dead" },
  },
};

function sceneId(sceneName) {
  return sceneName.replace(/^scene\.|\.json$/g, "");
}

function nearly(a, b) {
  return typeof a === "number" && Math.abs(a - b) <= 1e-6;
}

function exactSelectorKeywordRoute(mat, shader) {
  const official = mat.official;
  if (typeof official?.shader !== "string" || !Array.isArray(official.validKeywords)) return null;
  const actualKeywords = [...official.validKeywords].sort();
  const matches = exactSelectorManifests.filter((manifest) => {
    const selector = manifest.official_selector;
    const shaderKey = manifest.runtime_contract?.shader_key
      || selector?.shaderName?.split("/").at(-1);
    return shaderKey === shader
      && selector?.shaderIdentity === official.shader
      && JSON.stringify([...(selector.keywords || [])].sort()) === JSON.stringify(actualKeywords);
  });
  return matches.length === 1 ? matches[0] : null;
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
  rows.push({ ok: false, scene: "(official)", shader, mat: "", kw: "", reason: "shader not found in official bundles" });
}

for (const sceneName of sceneNames) {
  const scene = JSON.parse(fs.readFileSync(path.join(ROOT, "public", sceneName), "utf8"));
  for (const [matName, mat] of Object.entries(scene.materials || {})) {
    const shader = mat.shader;
    if (!shader || shader.startsWith("InnerStencil") || shader.startsWith("IllustStencil") || shader === "OuterStencil") continue;
    const cfg = SHADER[shader];
    if (!cfg || cfg.defer) continue;
    const officialKeywords = new Set(official.found[shader]?.keywords || []);
    for (const kw of mat.keywords || []) {
      if (!officialKeywords.has(kw)) {
        rows.push({ ok: false, scene: sceneId(sceneName), shader, mat: matName, kw, reason: "not an official shader keyword" });
        continue;
      }
      const rule = KEYWORDS[shader]?.[kw];
      if (!rule) {
        const exactManifest = exactSelectorKeywordRoute(mat, shader);
        if (exactManifest) {
          rows.push({
            ok: true,
            scene: sceneId(sceneName),
            shader,
            mat: matName,
            kw,
            value: exactManifest.official_selector.selectorId,
            reason: "selected by exact official selector manifest",
          });
          continue;
        }
        rows.push({ ok: false, scene: sceneId(sceneName), shader, mat: matName, kw, reason: "official keyword missing strategy rule" });
        continue;
      }
      if (rule.officialDead) {
        rows.push({
          ok: mat.floats?.[rule.officialDead] != null,
          scene: sceneId(sceneName),
          shader,
          mat: matName,
          kw,
          value: mat.floats?.[rule.officialDead] ?? "(missing)",
          reason: rule.reason,
        });
        continue;
      }
      const actual = mat.floats?.[rule.float];
      rows.push({
        ok: nearly(actual, rule.value),
        scene: sceneId(sceneName),
        shader,
        mat: matName,
        kw,
        float: rule.float,
        value: actual ?? "(missing)",
        expected: rule.value,
        reason: rule.reason,
      });
    }
  }
}

const grouped = new Map();
for (const row of rows) {
  const key = [row.ok, row.shader, row.kw, row.float || "", row.expected ?? "", row.value, row.reason].join("|");
  if (!grouped.has(key)) grouped.set(key, { ...row, count: 0, scenes: new Set(), examples: [] });
  const item = grouped.get(key);
  item.count += 1;
  item.scenes.add(row.scene);
  if (item.examples.length < 4) item.examples.push(row.mat);
}

for (const row of [...grouped.values()].sort((a, b) =>
  String(a.shader).localeCompare(String(b.shader))
  || String(a.kw).localeCompare(String(b.kw))
  || String(a.value).localeCompare(String(b.value)))) {
  const mark = row.ok ? "OK " : "BAD";
  const expect = row.float ? ` ${row.float}=${row.value}/${row.expected}` : ` value=${row.value ?? ""}`;
  console.log(`${mark} ${row.shader.padEnd(35)} kw=${row.kw.padEnd(28)}${expect.padEnd(28)} ${row.reason} count=${row.count} scenes=${[...row.scenes].join(",")}`);
  if (row.examples.length) console.log(`     e.g. ${row.examples.join(", ")}`);
}

const bad = rows.filter((row) => !row.ok);
if (bad.length) {
  console.error(`\n${bad.length} scene keyword usage issue(s) found.`);
  process.exitCode = 1;
}
