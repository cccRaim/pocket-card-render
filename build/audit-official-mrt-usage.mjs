// Classify official fragment MRT output #1 and compare it with the renderer's bloom-only simulation.
//
// Unity card shaders commonly declare two color outputs. Many write `vec4(0)` to location 1, but a
// subset writes a real emissive/mask contribution. This audit keeps that distinction data-driven by
// extracting the official SPIR-V from Common/Shader, reflecting the location-1 output, and checking
// whether the local material strategy exposes `uBloomOnly` to simulate that second target.
//
// RGB writes to official MRT1 are treated as a required bloom/emissive simulation by default.
// Set PCR_AUDIT_STRICT_MRT=0 only for exploratory reporting while tracing a new shader family.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { SHADER } from "../public/render/rarities.js";
import { exactShaderHasActiveBloomOutput } from "../public/render/pipeline/bloom-activation.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const shaderRoot = process.env.PCR_SHADERS
  || "D:/DevProjectes/ptcgp-tools-master/masterdata_decoder/.output/decrypted/Common/Shader";
const strict = process.env.PCR_AUDIT_STRICT_MRT !== "0";

function sceneShaders() {
  const shaders = new Set();
  const dir = path.join(ROOT, "public");
  for (const sceneName of fs.readdirSync(dir).filter((n) => /^scene\..*\.json$/.test(n))) {
    const scene = JSON.parse(fs.readFileSync(path.join(dir, sceneName), "utf8"));
    for (const mat of Object.values(scene.materials || {})) {
      if (mat.shader && SHADER[mat.shader] && !SHADER[mat.shader].defer) shaders.add(mat.shader);
    }
  }
  return [...shaders].sort();
}

function materialSourceByKind() {
  const out = new Map();
  const dir = path.join(ROOT, "public/render/materials");
  for (const file of fs.readdirSync(dir).filter((n) => n.endsWith(".js"))) {
    const src = fs.readFileSync(path.join(dir, file), "utf8");
    const functionSources = new Map();
    for (const m of src.matchAll(/\nfunction\s+([A-Za-z0-9_]+)\s*\(/g)) {
      const start = m.index + 1;
      const nextFunction = src.indexOf("\nfunction ", start + 1);
      const nextDefine = src.indexOf("\ndefineMaterial(", start + 1);
      const stops = [nextFunction, nextDefine].filter((x) => x >= 0);
      const end = stops.length ? Math.min(...stops) : src.length;
      functionSources.set(m[1], src.slice(start, end));
    }
    const matches = [...src.matchAll(/defineMaterial\("([^"]+)"/g)];
    for (let i = 0; i < matches.length; i++) {
      const kind = matches[i][1];
      const start = matches[i].index;
      const end = i + 1 < matches.length ? matches[i + 1].index : src.length;
      const defineSource = src.slice(start, end);
      const buildRef = defineSource.match(/\bbuild\s*:\s*([A-Za-z0-9_]+)/)?.[1];
      out.set(kind, buildRef && functionSources.has(buildRef)
        ? functionSources.get(buildRef)
        : defineSource);
    }
  }
  return out;
}

const zeroRe = /^vec4\((?:0(?:\.0)?)(?:\s*,\s*0(?:\.0)?){0,3}\)$/;
function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function localBloomSource(src, shader) {
  if (/\buserData\.bloomSource\s*=\s*true\b/.test(src)) return true;
  const shaderEq = new RegExp(`\\buserData\\.bloomSource\\s*=\\s*r\\.shader\\s*===\\s*["']${escapeRe(shader)}["']`);
  return shaderEq.test(src);
}

function exactMrtPortShaders() {
  const contract = JSON.parse(fs.readFileSync(
    path.join(ROOT, "public", "shaders", "official_program_port_contract.json"),
    "utf8",
  ));
  const manifestsByShader = new Map();
  for (const port of contract.ports || []) {
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, port.manifest), "utf8"));
    const shader = manifest.runtime_contract?.shader_key;
    if (typeof shader !== "string" || !shader) continue;
    if (!manifestsByShader.has(shader)) manifestsByShader.set(shader, []);
    manifestsByShader.get(shader).push(manifest);
  }
  return {
    all: new Set(manifestsByShader.keys()),
    bloom: new Set([...manifestsByShader.entries()]
      .filter(([, manifests]) => exactShaderHasActiveBloomOutput({ manifests }))
      .map(([shader]) => shader)),
  };
}

function identifierChannelsWereZeroed(glsl, name, channels, beforeIndex) {
  const before = glsl.slice(0, beforeIndex);
  const whole = [...before.matchAll(new RegExp(`${name}\\s*=\\s*`, "g"))].at(-1)?.index ?? -1;
  return channels.every((ch) => {
    const matches = [...before.matchAll(new RegExp(`${name}\\.${ch}\\s*=\\s*0(?:\\.0)?\\s*;`, "g"))];
    const last = matches.at(-1)?.index ?? -1;
    return last > whole;
  });
}

function expressionHasExplicitZeroRgb(expression) {
  const compact = expression.replace(/\s+/g, "");
  const zero = "0(?:\\.0)?";
  const scalarZeroRgb = new RegExp(`vec4\\(${zero},${zero},${zero},`);
  const vec3ZeroChannel = `vec3\\(${zero}\\)\\.[xyz]`;
  const expandedZeroRgb = new RegExp(
    `vec4\\(${vec3ZeroChannel},${vec3ZeroChannel},${vec3ZeroChannel},`,
  );
  return scalarZeroRgb.test(compact) || expandedZeroRgb.test(compact);
}

function loc1Usage(glsl, outName) {
  const matches = [...glsl.matchAll(new RegExp(`${outName}\\s*=\\s*([^;]+);`, "g"))];
  const assigns = matches.map((m) => m[1].trim());
  const nonzero = assigns.some((rhs) => !zeroRe.test(rhs));
  const rgbNonzero = matches.some((m) => {
    const rhs = m[1].trim();
    if (zeroRe.test(rhs)) return false;
    if (expressionHasExplicitZeroRgb(rhs)) return false;
    const ident = rhs.match(/^([A-Za-z_][A-Za-z0-9_]*)$/)?.[1];
    if (ident && identifierChannelsWereZeroed(glsl, ident, ["x", "y", "z"], m.index)) return false;
    const swizzle = rhs.match(/^([A-Za-z_][A-Za-z0-9_]*)\.([xyzw]{4})$/);
    if (swizzle && identifierChannelsWereZeroed(glsl, swizzle[1], [...swizzle[2].slice(0, 3)], m.index)) {
      return false;
    }
    return true;
  });
  return {
    assigns,
    nonzero,
    rgbNonzero,
  };
}

function officialMrtRows() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pcr-mrt-"));
  const rows = [];
  try {
    for (const shader of sceneShaders()) {
      if (shader === "Side&Back") {
        const manifestPath = path.join(ROOT, "public", "shaders", "side_back_program.json");
        const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
        const exactZero = manifest.mrt?.secondary_location === 1
          && manifest.mrt?.secondary_value === "zero";
        rows.push({
          shader,
          ok: exactZero,
          loc1: manifest.mrt?.secondary || "(missing)",
          nonzero: false,
          rgbNonzero: false,
          examples: exactZero ? ["vec4(0.0)"] : [],
          reason: exactZero
            ? "official MRT1 is zero (pinned Side&Back program)"
            : "pinned Side&Back program does not prove zero MRT1",
        });
        continue;
      }
      const prefix = shader.replace(/[^A-Za-z0-9_]/g, "_");
      try {
        execFileSync("python", [
          "build/shaderdec/dump_shader.py",
          shader,
          prefix,
          "--shaders",
          shaderRoot,
          "--out",
          tmp,
        ], { cwd: ROOT, shell: true, stdio: ["ignore", "ignore", "ignore"] });
        const frag = path.join(tmp, `${prefix}_frag.spv`);
        if (!fs.existsSync(frag)) {
          rows.push({ shader, ok: false, reason: "official fragment SPIR-V missing" });
          continue;
        }
        const refl = JSON.parse(execFileSync("spirv-cross", [frag, "--reflect"], { encoding: "utf8" }));
        const loc1 = (refl.outputs || []).find((o) => o.location === 1);
        if (!loc1) {
          rows.push({ shader, ok: true, loc1: "(none)", nonzero: false, reason: "no MRT1 output" });
          continue;
        }
        const glsl = execFileSync("spirv-cross", [frag, "--version", "300", "--es"], { encoding: "utf8" });
        const usage = loc1Usage(glsl, loc1.name);
        rows.push({
          shader,
          ok: true,
          loc1: loc1.name,
          nonzero: usage.nonzero,
          rgbNonzero: usage.rgbNonzero,
          examples: usage.assigns.slice(-2),
          reason: usage.rgbNonzero
            ? "official MRT1 writes RGB data"
            : usage.nonzero
              ? "official MRT1 writes alpha-only data"
              : "official MRT1 is zero",
        });
      } catch (err) {
        rows.push({ shader, ok: false, reason: err.message.split(/\r?\n/)[0] });
      }
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  return rows;
}

const sourceByKind = materialSourceByKind();
const exactMrtShaders = exactMrtPortShaders();
const appSource = fs.readFileSync(path.join(ROOT, "public", "app.js"), "utf8");
if (!/sceneUsesBloomProducer\(\s*scene_data\.materials,\s*exactShaders,\s*runtimeDispatchIndex,?\s*\)/.test(appSource)) {
  throw new Error("selector-resolved MRT bloom producers are not wired into the scene bloom activation predicate");
}
const rows = officialMrtRows().map((row) => {
  const cfg = SHADER[row.shader] || {};
  const src = sourceByKind.get(cfg.kind) || "";
  const localBloom = exactMrtShaders.all.has(row.shader)
    ? exactMrtShaders.bloom.has(row.shader)
    : localBloomSource(src, row.shader);
  let status = "OK";
  let reason = row.reason;
  if (!row.ok) status = "BAD";
  else if (row.rgbNonzero && !localBloom) {
    status = strict ? "BAD" : "WARN";
    reason = `${row.reason}; local pipeline has no active MRT1 bloom route`;
  }
  return { ...row, kind: cfg.kind || "", localBloom, status, reason };
});

for (const row of rows.sort((a, b) => a.shader.localeCompare(b.shader))) {
  const sample = row.examples?.length ? ` sample=${row.examples.join(" | ")}` : "";
  const official = row.rgbNonzero ? "rgb    " : row.nonzero ? "alpha  " : "zero   ";
  console.log(`${row.status.padEnd(4)} ${row.shader.padEnd(35)} kind=${row.kind.padEnd(18)} loc1=${String(row.loc1 || "").padEnd(8)} official=${official} localBloom=${row.localBloom ? "yes" : "no "} ${row.reason}${sample}`);
}

const bad = rows.filter((r) => r.status === "BAD");
if (bad.length) {
  console.error(`\n${bad.length} official MRT usage issue(s) found.`);
  process.exitCode = 1;
}
