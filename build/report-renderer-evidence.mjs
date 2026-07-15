// Report traceable implementation evidence for the reference scenes.
//
// Coverage is intentionally not collapsed into a "game fidelity" percentage.
// Static source evidence cannot prove renderer-pipeline or final visual parity.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";
import { SHADER } from "../public/render/rarities.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const sceneNames = fs.readdirSync(path.join(ROOT, "public"))
  .filter((n) => /^scene\..*\.json$/.test(n))
  .sort();

const IGNORED_SHADERS = new Set(["OuterStencil", "InnerStencil"]);
const RUNTIME_SPECIAL_MATERIALS = new Set(["L_FullFace_Text", "DefaultMaterial"]);
const TRANSPILED_OFFICIAL_PROGRAM = new Set([
  "Card_Illust",
  "Frame",
  "Simple-Opaque",
  "Simple-Transparent",
  "Effect",
  "Card_Parallax",
  "Card_Parallax_Metal",
  "Card_Parallax_UR",
  "Card_UR_Glitter_FlowMaps",
  "Opaque_Hologram_Tuning",
  "Frame-Holo-UR-New",
  "Transparent_Hologram_Tuning",
  "Card_Parallax_Hologram_Tuning",
  "Card_Hologram_Tuning",
  "Frame-Holo-Tuning",
  "Opaque-Hologram_Tuning",
  "Opaque-UR-Oklab",
  "Card_Parallax_Hologram_UR_New",
]);
const UR_CORE_GUARDED = new Set([
  "Card_UR_Plate",
  "Card_Parallax_Hologram_UR_New",
  "Frame-Holo-UR-New",
  "Frame-2Layer-UR",
  "Opaque-UR-Oklab",
  "Card_UR_LensFlare",
]);
const UR_REMAINDER_GUARDED = new Set([
  "Card_Parallax_UR",
  "Transparent-UR-New",
]);
const MRT_RGB_GUARDED = new Set([
  "Card_UR_LensFlare",
  "Frame-2Layer-UR",
  "Frame-Holo-UR-New",
  "Opaque-UR-Oklab",
]);
const EFFECT_GUARDED = new Set(["Effect"]);
const PARALLAX_GUARDED = new Set(["Card_Parallax", "Card_Parallax_Metal"]);
const FLAT_GUARDED = new Set(["Card_Illust", "Frame", "Simple-Opaque", "Simple-Transparent"]);
const HOLO_GUARDED = new Set([
  "Transparent_Hologram_Tuning",
  "Frame-Holo-Tuning",
  "Card_Hologram_Tuning",
  "Opaque_Hologram_Tuning",
  "Opaque-Hologram_Tuning",
  "Simple-Opaque-Hologram_Tuning",
  "Card_Parallax_Hologram_Tuning",
]);
const PIPELINE_PARITY_STAGES = [
  "texture-color-space",
  "alpha-convention",
  "sampler-state",
  "render-target-formats",
  "mrt-routing",
  "blend-stencil-depth",
  "shader-precision",
  "camera-transforms",
  "animation-timing",
  "bloom-tone-mapping",
  "display-transfer",
];

export function sceneId(sceneName) {
  return sceneName.replace(/^scene\.|\.json$/g, "");
}

export function usedGlbMaterials(scene) {
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

export function pct(n, d) {
  return d ? `${(n / d * 100).toFixed(1)}%` : "n/a";
}

export function collectEvidenceRows() {
  const rows = [];
  for (const sceneName of sceneNames) {
    const scene = JSON.parse(fs.readFileSync(path.join(ROOT, "public", sceneName), "utf8"));
    const used = usedGlbMaterials(scene);
    for (const [matName, mat] of Object.entries(scene.materials || {})) {
      if (used && !used.has(matName)) continue;
      const shader = mat.shader || "";
      if (!shader || IGNORED_SHADERS.has(shader) || shader.startsWith("InnerStencil")) continue;
      const cfg = SHADER[shader];
      if (cfg?.defer) continue;
      if (RUNTIME_SPECIAL_MATERIALS.has(matName)) continue;
      rows.push({
        scene: sceneId(sceneName),
        mat: matName,
        shader,
        kind: cfg?.kind || "",
        dispatched: !!(cfg && cfg.kind),
        transpiledProgram: TRANSPILED_OFFICIAL_PROGRAM.has(shader),
        urGuarded: UR_CORE_GUARDED.has(shader),
        urRemainderGuarded: UR_REMAINDER_GUARDED.has(shader),
        effectGuarded: EFFECT_GUARDED.has(shader),
        parallaxGuarded: PARALLAX_GUARDED.has(shader),
        flatGuarded: FLAT_GUARDED.has(shader),
        holoGuarded: HOLO_GUARDED.has(shader),
        mrtGuarded: MRT_RGB_GUARDED.has(shader),
      });
    }
  }
  return rows;
}

export function summarizeEvidenceRows(rows) {
  const total = rows.length;
  const partialByteGuarded = rows.filter((r) => !r.transpiledProgram && (
    r.urGuarded || r.urRemainderGuarded || r.effectGuarded ||
    r.parallaxGuarded || r.flatGuarded || r.holoGuarded
  )).length;
  return {
    total,
    dispatched: rows.filter((r) => r.dispatched).length,
    transpiledProgram: rows.filter((r) => r.transpiledProgram).length,
    partialByteGuarded,
    urGuarded: rows.filter((r) => r.urGuarded).length,
    urRemainderGuarded: rows.filter((r) => r.urRemainderGuarded).length,
    effectGuarded: rows.filter((r) => r.effectGuarded).length,
    parallaxGuarded: rows.filter((r) => r.parallaxGuarded).length,
    flatGuarded: rows.filter((r) => r.flatGuarded).length,
    holoGuarded: rows.filter((r) => r.holoGuarded).length,
    mrtGuarded: rows.filter((r) => r.mrtGuarded).length,
    anyOfficialEvidence: rows.filter((r) => r.transpiledProgram || r.urGuarded || r.urRemainderGuarded || r.effectGuarded || r.parallaxGuarded || r.flatGuarded || r.holoGuarded).length,
  };
}

function shaderFamilies(rows, predicate) {
  return [...new Set(rows.filter(predicate).map((row) => row.shader))].sort();
}

export function buildAdvancementCosts(rows = collectEvidenceRows()) {
  const summary = summarizeEvidenceRows(rows);
  const undispatched = rows.filter((row) => !row.dispatched);
  const notTranspiled = rows.filter((row) => !row.transpiledProgram);
  const withoutOfficialEvidence = rows.filter((row) => !(
    row.transpiledProgram || row.urGuarded || row.urRemainderGuarded ||
    row.effectGuarded || row.parallaxGuarded || row.flatGuarded || row.holoGuarded
  ));
  return {
    model: {
      unit: "work-class-plus-remaining-scope",
      note: "Cost classes describe the required work type; remaining layer/family/stage counts describe scale. They are not time estimates.",
    },
    dispatched: {
      class: undispatched.length ? "renderer-integration" : "maintenance",
      remainingLayers: undispatched.length,
      remainingShaderFamilies: shaderFamilies(undispatched, () => true),
    },
    transpiledOfficialProgram: {
      class: notTranspiled.length ? "shader-reverse-engineering" : "maintenance",
      remainingLayers: notTranspiled.length,
      remainingShaderFamilies: shaderFamilies(notTranspiled, () => true),
      target: "E2 transpiled-official-program",
    },
    partialBytecodeGuards: {
      class: summary.partialByteGuarded ? "shader-reverse-engineering" : "maintenance",
      layersToPromote: summary.partialByteGuarded,
      shaderFamiliesToPromote: shaderFamilies(rows, (row) => !row.transpiledProgram && (
        row.urGuarded || row.urRemainderGuarded || row.effectGuarded ||
        row.parallaxGuarded || row.flatGuarded || row.holoGuarded
      )),
      target: "promote E1 partial guards to E2 programs",
    },
    anyOfficialSourceEvidence: {
      class: withoutOfficialEvidence.length ? "source-tracing-and-bytecode-audit" : "maintenance",
      remainingLayers: withoutOfficialEvidence.length,
      remainingShaderFamilies: shaderFamilies(withoutOfficialEvidence, () => true),
    },
    rendererPipelineParity: {
      class: "runtime-pipeline-research",
      remainingSharedStages: PIPELINE_PARITY_STAGES,
      affectedVisibleLayers: summary.total,
    },
    visualParity: {
      class: "excluded-by-policy",
      remainingAutomatedWork: 0,
      reason: "Screenshot and image-derived auditing is intentionally outside the automatic audit.",
    },
  };
}

export function buildEvidenceReport(rows = collectEvidenceRows()) {
  const {
    total,
    dispatched,
    transpiledProgram,
    partialByteGuarded,
    urGuarded,
    urRemainderGuarded,
    effectGuarded,
    parallaxGuarded,
    flatGuarded,
    holoGuarded,
    mrtGuarded,
    anyOfficialEvidence,
  } = summarizeEvidenceRows(rows);

  const advancementCost = buildAdvancementCosts(rows);
  return {
    definitionVersion: 2,
    scope: {
      referenceScenes: sceneNames,
      visibleLayers: total,
    },
    implementationEvidence: {
      dispatched: { layers: dispatched, total, advancementCost: advancementCost.dispatched },
      transpiledOfficialProgram: { layers: transpiledProgram, total, advancementCost: advancementCost.transpiledOfficialProgram },
      partialBytecodeGuards: { layers: partialByteGuarded, total, advancementCost: advancementCost.partialBytecodeGuards },
      anyOfficialSourceEvidence: { layers: anyOfficialEvidence, total, advancementCost: advancementCost.anyOfficialSourceEvidence },
    },
    rendererPipelineParity: {
      status: "not-proven",
      reason: "Repository audits protect current assumptions but do not prove equivalence to the official runtime color, MRT, blend, precision, and postprocess pipeline.",
      advancementCost: advancementCost.rendererPipelineParity,
    },
    controlledVisualParity: {
      status: "unmeasured",
      officialCaptureCorpus: 0,
      reason: "No controlled official per-pose capture corpus is available to this repository.",
      advancementCost: advancementCost.visualParity,
    },
    gameFidelity: {
      score: null,
      status: "not-claimable",
      reason: "A fidelity score is forbidden until renderer-pipeline parity and controlled official-output comparisons are both evidenced.",
    },
    rows,
    costModel: advancementCost.model,
  };
}

export function printReport(rows = collectEvidenceRows()) {
  const report = buildEvidenceReport(rows);
  const {
    total,
    dispatched,
    transpiledProgram,
    partialByteGuarded,
    urGuarded,
    urRemainderGuarded,
    effectGuarded,
    parallaxGuarded,
    flatGuarded,
    holoGuarded,
    mrtGuarded,
    anyOfficialEvidence,
  } = summarizeEvidenceRows(rows);

  console.log("Renderer implementation evidence (not a game-fidelity score)");
  console.log(`visible layers:       ${total}`);
  console.log(`strategy dispatched:  ${dispatched}/${total} (${pct(dispatched, total)})`);
  console.log(`official programs:    ${transpiledProgram}/${total} (${pct(transpiledProgram, total)})  transpiled official shader programs`);
  console.log(`partial byte guards:  ${partialByteGuarded}/${total} (${pct(partialByteGuarded, total)})  hand ports with selected bytecode invariants`);
  console.log(`UR byte-guarded:      ${urGuarded}/${total} (${pct(urGuarded, total)})`);
  console.log(`UR remainder guarded: ${urRemainderGuarded}/${total} (${pct(urRemainderGuarded, total)})`);
  console.log(`Effect byte-guarded:  ${effectGuarded}/${total} (${pct(effectGuarded, total)})`);
  console.log(`Parallax guarded:     ${parallaxGuarded}/${total} (${pct(parallaxGuarded, total)})`);
  console.log(`Flat/simple guarded:  ${flatGuarded}/${total} (${pct(flatGuarded, total)})`);
  console.log(`Holo byte-guarded:    ${holoGuarded}/${total} (${pct(holoGuarded, total)})`);
  console.log(`RGB MRT guarded:      ${mrtGuarded}/${total} (${pct(mrtGuarded, total)})`);
  console.log(`any official evidence:${String(anyOfficialEvidence).padStart(3)}/${total} (${pct(anyOfficialEvidence, total)})`);
  console.log(`pipeline parity:      ${report.rendererPipelineParity.status}`);
  console.log(`controlled visual:    ${report.controlledVisualParity.status}`);
  console.log("game fidelity score:  NOT CLAIMABLE");
  console.log("reason: static layer evidence does not prove official runtime or final pixels");
  console.log("");
  console.log("advancement cost (work type + remaining scope)");
  console.log(`dispatch:             ${report.implementationEvidence.dispatched.advancementCost.class} · ${report.implementationEvidence.dispatched.advancementCost.remainingLayers} layers`);
  console.log(`official programs:    ${report.implementationEvidence.transpiledOfficialProgram.advancementCost.class} · ${report.implementationEvidence.transpiledOfficialProgram.advancementCost.remainingLayers} layers / ${report.implementationEvidence.transpiledOfficialProgram.advancementCost.remainingShaderFamilies.length} shader families`);
  console.log(`partial → E2:         ${report.implementationEvidence.partialBytecodeGuards.advancementCost.class} · ${report.implementationEvidence.partialBytecodeGuards.advancementCost.layersToPromote} layers / ${report.implementationEvidence.partialBytecodeGuards.advancementCost.shaderFamiliesToPromote.length} shader families`);
  console.log(`source evidence:      ${report.implementationEvidence.anyOfficialSourceEvidence.advancementCost.class} · ${report.implementationEvidence.anyOfficialSourceEvidence.advancementCost.remainingLayers} layers`);
  console.log(`pipeline parity:      ${report.rendererPipelineParity.advancementCost.class} · ${report.rendererPipelineParity.advancementCost.remainingSharedStages.length} shared stages / ${report.rendererPipelineParity.advancementCost.affectedVisibleLayers} affected layers`);
  console.log(`visual parity:        ${report.controlledVisualParity.advancementCost.class}`);
  console.log("");

  const grouped = new Map();
  for (const row of rows) {
    const key = `${row.shader}|${row.kind}|${row.dispatched}|${row.transpiledProgram}|${row.urGuarded}|${row.urRemainderGuarded}|${row.effectGuarded}|${row.parallaxGuarded}|${row.flatGuarded}|${row.holoGuarded}|${row.mrtGuarded}`;
    if (!grouped.has(key)) grouped.set(key, { ...row, count: 0, scenes: new Set(), examples: [] });
    const g = grouped.get(key);
    g.count += 1;
    g.scenes.add(row.scene);
    if (g.examples.length < 3) g.examples.push(row.mat);
  }

  for (const g of [...grouped.values()].sort((a, b) => b.count - a.count || a.shader.localeCompare(b.shader))) {
    const flags = [
      g.dispatched ? "strategy" : "missing",
      g.transpiledProgram ? "official-program" : null,
      g.urGuarded ? "ur-byte-guard" : null,
      g.urRemainderGuarded ? "ur-remainder-byte-guard" : null,
      g.effectGuarded ? "effect-byte-guard" : null,
      g.parallaxGuarded ? "parallax-byte-guard" : null,
      g.flatGuarded ? "flat-byte-guard" : null,
      g.holoGuarded ? "holo-byte-guard" : null,
      g.mrtGuarded ? "mrt-rgb-guard" : null,
    ].filter(Boolean).join(",");
    console.log(`${String(g.count).padStart(2)}  ${g.shader.padEnd(35)} kind=${g.kind.padEnd(16)} ${flags}`);
    console.log(`    scenes=${[...g.scenes].join(",")} e.g. ${g.examples.join(", ")}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(buildEvidenceReport(), null, 2));
  } else {
    printReport();
  }
}
