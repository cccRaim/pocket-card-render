// Audit the renderer's shader table against the official Unity render-state dump.
// This is intentionally read-only: it helps keep shader/blend fixes data-driven.
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

function officialPass(shader, mat) {
  const variants = official.found[shader]?.variants || [];
  const scored = variants
    .map((v) => ({ v, pass: v.passStates?.[0], score: scoreVariant(v.passStates?.[0], mat) }))
    .filter((x) => x.pass)
    .sort((a, b) => b.score - a.score);
  const best = scored[0];
  return best ? { key: best.v.fullName || shader, pass: best.pass } : null;
}

function resolveParam(p, mat) {
  if (!p) return null;
  return p.name ? Number(mat.floats?.[p.name] ?? p.val) : Number(p.val);
}

function scoreVariant(pass, mat) {
  if (!pass) return 0;
  const params = [
    pass.blend?.src, pass.blend?.dst, pass.blend?.srcAlpha, pass.blend?.dstAlpha,
    pass.zTest, pass.zWrite, pass.stencilRef, pass.stencilReadMask, pass.stencilWriteMask,
    pass.stencilOp?.pass, pass.stencilOp?.comp,
  ];
  return params.filter((p) => p?.name && mat.floats?.[p.name] != null).length;
}

function officialBlend(shader, mat) {
  const found = officialPass(shader, mat);
  const pass = found?.pass;
  const src = pass?.blend?.src;
  const dst = pass?.blend?.dst;
  const srcA = pass?.blend?.srcAlpha;
  const dstA = pass?.blend?.dstAlpha;
  const op = pass?.blend?.op;
  const opA = pass?.blend?.opAlpha;
  const mask = pass?.blend?.colMask;
  if (!src || !dst || !srcA || !dstA || !op || !opA || !mask) return null;
  return {
    pair: `${resolveParam(src, mat)}/${resolveParam(dst, mat)}`,
    alpha: `${resolveParam(srcA, mat)}/${resolveParam(dstA, mat)}`,
    op: `${resolveParam(op, mat)}/${resolveParam(opA, mat)}`,
    mask: `${resolveParam(mask, mat)}`,
    key: found.key,
    dynamic: !!(src.name || dst.name || srcA.name || dstA.name),
  };
}

function officialDepth(shader, mat) {
  const found = officialPass(shader, mat);
  if (!found) return null;
  return { pair: `${resolveParam(found.pass.zTest, mat)}/${resolveParam(found.pass.zWrite, mat)}`, key: found.key };
}

function officialCull(shader, mat) {
  const found = officialPass(shader, mat);
  if (!found) return null;
  return { value: `${resolveParam(found.pass.culling, mat)}`, key: found.key };
}

function officialStencil(shader, mat) {
  const found = officialPass(shader, mat);
  const p = found?.pass;
  if (!p?.stencilOp) return null;
  return {
    value: [
      resolveParam(p.stencilRef, mat),
      resolveParam(p.stencilReadMask, mat),
      resolveParam(p.stencilWriteMask, mat),
      resolveParam(p.stencilOp.comp, mat),
      resolveParam(p.stencilOp.pass, mat),
      resolveParam(p.stencilOp.fail, mat),
      resolveParam(p.stencilOp.zFail, mat),
    ].join("/"),
    key: found.key,
  };
}

function officialExtraPassState(shader, mat) {
  const found = officialPass(shader, mat);
  const p = found?.pass;
  if (!p) return null;
  return {
    value: [
      resolveParam(p.zClip, mat),
      resolveParam(p.offsetFactor, mat),
      resolveParam(p.offsetUnits, mat),
      resolveParam(p.alphaToMask, mat),
      resolveParam(p.conservative, mat),
    ].join("/"),
    key: found.key,
  };
}

function mainTexName(mat) {
  return mat.textures?._MainTex?.name || mat.textures?._BaseTex?.name || mat.textures?._BaseMap?.name;
}

function isStraight(cfg, shader, mat, scene) {
  const kind = cfg?.kind;
  if (kind === "illustTextured" || kind === "parallaxUR" || kind === "frameHoloUR" || kind === "exHolo" || kind === "exHoloUR") return true;
  if (kind === "frameHolo") return shader === "Frame-Holo-Tuning";
  if (kind === "simpleTransparent") return false;
  if (kind === "textured" || kind === "plate") return scene.alphaMode?.[mainTexName(mat)] === "straight";
  return false;
}

function rendererBlend(shader, mat, scene) {
  const cfg = SHADER[shader];
  if (!cfg || cfg.defer) return null;
  if (cfg.materialBlend && mat.floats?._SrcFactor != null && mat.floats?._DstFactor != null) {
    return `${mat.floats._SrcFactor}/${mat.floats._DstFactor}`;
  }
  if (cfg.blend === "opaque") return "1/0";
  if (cfg.blend === "multiply") return "2/0";
  if (cfg.blend === "add_a") return "5/1";
  if (cfg.blend === "over" || cfg.blend === "premult") {
    return `${isStraight(cfg, shader, mat, scene) ? 5 : 1}/10`;
  }
  return null;
}

function rendererBlendAlpha(shader, mat) {
  const cfg = SHADER[shader];
  if (!cfg || cfg.defer) return null;
  if (cfg.materialBlend && mat.floats?._SrcFactor != null && mat.floats?._DstFactor != null) {
    return `${mat.floats._SrcFactorA ?? mat.floats._SrcFactor}/${mat.floats._DstFactorA ?? mat.floats._DstFactor}`;
  }
  if (cfg.blend === "opaque") return "0/0";
  if (cfg.blend === "multiply" || cfg.blend === "add_a") return "0/1";
  if (cfg.blend === "over" || cfg.blend === "premult") return "0/10";
  return null;
}

function rendererMaterialDepth(shader, mat, cfg) {
  const zTest = mat.floats?._ZTest ?? mat.floats?._ZTestParam;
  const zWrite = mat.floats?._ZWrite ?? mat.floats?._ZWriteParam;
  if (zTest != null || zWrite != null) return `${zTest ?? 0}/${zWrite ?? 0}`;
  const isSB = shader === "Simple-Opaque-Hologram_Tuning" || shader === "Simple-Transparent"
    || shader === "Opaque-Hologram_Tuning" || shader === "Opaque-UR-Oklab";
  if (isSB) return `4/${cfg.blend === "opaque" ? 1 : 0}`;
  return "0/0";
}

function rendererCull(mat, cfg) {
  return `${cfg.materialCull ? (mat.floats?._CullMode ?? cfg.cull ?? 2) : (cfg.cull ?? 2)}`;
}

const SB_STENCIL_SHADERS = new Set([
  "Simple-Opaque-Hologram_Tuning",
  "Simple-Transparent",
  "Opaque-Hologram_Tuning",
  "Opaque-UR-Oklab",
]);
const STENCIL_REF_SHADERS = new Set([
  "Card_Hologram_Tuning",
  "Card_Illust",
  "Card_Parallax",
  "Card_Parallax_Hologram_Tuning",
  "Card_Parallax_Hologram_UR_New",
  "Card_Parallax_Metal",
  "Card_Parallax_UR",
  "Card_UR_Plate",
]);

function rendererStencil(shader, mat) {
  const read = SB_STENCIL_SHADERS.has(shader) || shader === "Effect"
    ? mat.floats?._Stencil
    : STENCIL_REF_SHADERS.has(shader)
      ? mat.floats?._StencilRef
      : null;
  if (read == null) return "0/255/255/8/0/0/0";
  if (SB_STENCIL_SHADERS.has(shader)) return `7/${read}/4/3/2/0/0`;
  return `${read}/${read}/255/3/0/0/0`;
}

function rendererExtraPassState() {
  return "1/0/0/0/0";
}

const rows = [];
for (const shader of official.missing || []) {
  rows.push({
    scene: "(official)",
    mat: "",
    shader,
    kind: "",
    official: "(missing)",
    renderer: "(missing)",
    officialZ: "(missing)",
    rendererZ: "(missing)",
    dynamic: false,
    ok: false,
  });
}

for (const sceneName of sceneNames) {
  const scene = JSON.parse(fs.readFileSync(path.join(ROOT, "public", sceneName), "utf8"));
  for (const [matName, mat] of Object.entries(scene.materials || {})) {
    const shader = mat.shader;
    if (!shader || shader.endsWith("Stencil")) continue;
    const cfg = SHADER[shader];
    if (!cfg || cfg.defer) continue;
    const official = officialBlend(shader, mat);
    const officialZ = officialDepth(shader, mat);
    const officialC = officialCull(shader, mat);
    const officialS = officialStencil(shader, mat);
    const officialX = officialExtraPassState(shader, mat);
    const renderer = rendererBlend(shader, mat, scene);
    const rendererA = rendererBlendAlpha(shader, mat);
    const rendererZ = rendererMaterialDepth(shader, mat, cfg);
    const rendererC = rendererCull(mat, cfg);
    const rendererS = rendererStencil(shader, mat);
    const rendererX = rendererExtraPassState();
    if (!official || !renderer || !rendererA || !officialZ || !rendererZ || !officialC || !rendererC || !officialS || !rendererS || !officialX || !rendererX) continue;
    rows.push({
      scene: sceneName.replace(/^scene\.|\.json$/g, ""),
      mat: matName,
      shader,
      kind: SHADER[shader]?.kind || "",
      official: official.pair,
      renderer,
      officialA: official.alpha,
      rendererA,
      officialOp: official.op,
      officialMask: official.mask,
      officialZ: officialZ.pair,
      rendererZ,
      officialC: officialC.value,
      rendererC,
      officialS: officialS.value,
      rendererS,
      officialX: officialX.value,
      rendererX,
      dynamic: official.dynamic,
      ok: official.pair === renderer
        && official.alpha === rendererA
        && official.op === "0/0"
        && official.mask === "15"
        && officialZ.pair === rendererZ
        && officialC.value === rendererC
        && officialS.value === rendererS
        && officialX.value === rendererX,
    });
  }
}

const byShader = new Map();
for (const row of rows) {
  const key = `${row.shader}|${row.kind}|${row.official}|${row.renderer}|${row.officialA}|${row.rendererA}|${row.officialOp}|${row.officialMask}|${row.officialZ}|${row.rendererZ}|${row.officialC}|${row.rendererC}|${row.officialS}|${row.rendererS}|${row.officialX}|${row.rendererX}`;
  if (!byShader.has(key)) byShader.set(key, { ...row, count: 0, scenes: new Set(), examples: [] });
  const agg = byShader.get(key);
  agg.count += 1;
  agg.scenes.add(row.scene);
  if (agg.examples.length < 3) agg.examples.push(row.mat);
}

for (const row of [...byShader.values()].sort((a, b) => a.shader.localeCompare(b.shader))) {
  const mark = row.ok ? "OK " : "BAD";
  const dyn = row.dynamic ? " dyn" : "    ";
  console.log(`${mark}${dyn} ${row.shader.padEnd(35)} kind=${row.kind.padEnd(18)} blend=${row.official.padEnd(4)}/${row.renderer.padEnd(4)} alpha=${row.officialA.padEnd(4)}/${row.rendererA.padEnd(4)} op=${row.officialOp} mask=${row.officialMask} depth=${row.officialZ.padEnd(3)}/${row.rendererZ.padEnd(3)} cull=${row.officialC.padEnd(1)}/${row.rendererC.padEnd(1)} stencil=${row.officialS}/${row.rendererS} extra=${row.officialX}/${row.rendererX} count=${String(row.count).padStart(2)} scenes=${[...row.scenes].join(",")}`);
  console.log(`       e.g. ${row.examples.join(", ")}`);
}

const bad = rows.filter((r) => !r.ok);
if (bad.length) {
  console.error(`\n${bad.length} render-state mismatch(es) found.`);
  process.exitCode = 1;
}
