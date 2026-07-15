// Audit exact official fragment MRT outputs selected by four prefab Material variants.
// The extractor follows Renderer/Material/Shader PPtrs and recovers GpuProgramType=25
// blobs; this file pins the official input and checks the resulting evidence matrix.
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PYTHON = process.env.PYTHON || "python";
const DECRYPTED_ROOT = path.resolve(process.env.PCR_DECRYPTED_ROOT
  || "D:/DevProjectes/ptcgp-tools-master/masterdata_decoder/.output/decrypted");
const SHADER_ROOT = path.join(DECRYPTED_ROOT, "Common", "Shader");

const EXPECTED_SUMMARY = {
  meshRenderers: 78,
  materialReferences: 98,
  rendererShaders: 27,
  actualVariants: 32,
  location1Shaders: 25,
  location0OnlyShaders: 2,
  fixedZeroShaders: 17,
  formulaShaders: 8,
  configuredNonzeroShaders: 4,
};

const EXPECTED_PREFABS = {
  cPK_10_000040_00_FUSHIGIBANAex_RR: {
    sha256: "5cd3dfd1fa5514f106cb575bbcf17344f4cc87dda51cf5fc6f1bfd20b004b560",
    meshRenderers: 23,
    materialReferences: 30,
  },
  cPK_20_008900_02_HOUOUex_UR: {
    sha256: "e960197906b1d192c5426c4bc280cba670b94d04a74a900807a021ada5981ee2",
    meshRenderers: 18,
    materialReferences: 22,
  },
  cTR_20_000230_00_LEAF_SR: {
    sha256: "97e131723201ba98d18224d3efc5ea4c95e6f307c08cfc875b2d7d3b032e8dca",
    meshRenderers: 18,
    materialReferences: 23,
  },
  cTR_20_000670_00_IIBUINOBAKKU_UR: {
    sha256: "737840d2d8dd532793d758b92c15efa75caad968603fcd99b936107ffe922ce5",
    meshRenderers: 19,
    materialReferences: 23,
  },
};

// Formula semantics are pinned to exact SPIR-V. The four disabled formulas are
// independently proven zero by the extractor's UBO-offset -> Material-property map.
const EXPECTED_FORMULAS = {
  Card_UR_LensFlare: {
    sha256: "00ca932a4760a0bbf5ed7608ec819f69a7a758bb45f0fcc7cb4b689ccd14c69f",
    gate: null,
    configuredNonzero: true,
  },
  "Frame-2Layer-UR": {
    sha256: "746ef1363103a59c4cad5caacf3264573f29e6370762b2350a738961739fc058",
    gate: null,
    configuredNonzero: true,
  },
  "Frame-Holo-Tuning": {
    sha256: "5d99d92ac0cd93b7ba2578b6b22bd2654e4118c96498e1c28595852174b815b3",
    gate: "_MaskEmissive",
    configuredNonzero: false,
  },
  "Frame-Holo-UR-New": {
    sha256: "90f2e82f3cb63f5aeda5c35757f7c42d01a23fb7414eec87cc8c129c197e0558",
    gate: null,
    configuredNonzero: true,
  },
  Frame: {
    sha256: "cc2d064864d33297461c7ee6c938d8121897a235b4954da36601e272707139ac",
    gate: "_EmitMasking",
    configuredNonzero: false,
  },
  "Opaque-UR-Oklab": {
    sha256: "171fea2f7d06c8644755e5364cb2d714f87beb72b314cacf198d2874ddb59108",
    gate: null,
    configuredNonzero: true,
  },
  Transparent_Hologram_Tuning: {
    sha256: "5edc43738cbee9ee6abd5bd79809a8c8384cc81fd1ffe5d72d8d8c9300c2798e",
    gate: "_EmitMasking",
    configuredNonzero: false,
  },
  Text: {
    sha256: "f76dd3c466cc5e5641cb70558dd5812d44af9b108edfdf4daeabe4ebab4534a2",
    gate: "_EmitMasking",
    configuredNonzero: false,
  },
};

const EXPECTED_LOCATION0_ONLY = ["InnerStencil", "OuterStencil"];
const EXPECTED_CONFIGURED_NONZERO = [
  "Card_UR_LensFlare",
  "Frame-2Layer-UR",
  "Frame-Holo-UR-New",
  "Opaque-UR-Oklab",
];

function runPython(script, args = [], input = undefined) {
  return execFileSync(PYTHON, [script, ...args], {
    cwd: ROOT,
    encoding: "utf8",
    input,
    maxBuffer: 64 * 1024 * 1024,
    shell: process.platform === "win32",
  });
}

function sorted(values) {
  return [...values].sort((a, b) => a.localeCompare(b));
}

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

const issues = [];
function same(label, actual, expected) {
  if (stable(actual) !== stable(expected)) {
    issues.push(`${label}: expected ${stable(expected)}, got ${stable(actual)}`);
  }
}

let evidence;
try {
  evidence = JSON.parse(runPython(
    "build/extract_official_mrt_outputs.py",
    ["--decrypted-root", DECRYPTED_ROOT],
  ));
} catch (error) {
  console.error(`BAD official MRT extractor failed: ${error.message}`);
  process.exit(1);
}

same("official MRT summary", evidence.summary, EXPECTED_SUMMARY);
same("shader compiler platform", evidence.source?.shaderCompilerPlatform, 18);
same("GPU program type", evidence.source?.gpuProgramType, 25);

for (const card of evidence.cards || []) {
  const expected = EXPECTED_PREFABS[card.card];
  if (!expected) {
    issues.push(`unexpected official prefab: ${card.card}`);
    continue;
  }
  same(`${card.card} prefab SHA-256`, card.prefabSha256, expected.sha256);
  same(`${card.card} MeshRenderer count`, card.meshRenderers, expected.meshRenderers);
  same(`${card.card} material PPtr count`, card.materialReferences, expected.materialReferences);
}
same("official prefab set", sorted((evidence.cards || []).map((card) => card.card)), sorted(Object.keys(EXPECTED_PREFABS)));

const variantKeys = new Set();
for (const variant of evidence.variants || []) {
  if (variantKeys.has(variant.key)) issues.push(`duplicate actual variant: ${variant.key}`);
  variantKeys.add(variant.key);
  same(`${variant.key} complete Material keywords`, variant.materialKeywords, variant.compiledKeywords);
  same(`${variant.key} GpuProgramType`, variant.gpuProgramType, 25);
  if (!variant.shaderPPtr?.targetCab || !variant.shaderPPtr?.pathId) {
    issues.push(`${variant.key}: missing official Material -> Shader PPtr evidence`);
  }
  for (const use of variant.materialUses || []) {
    if (!use.materialPPtr?.targetCab || !use.materialPPtr?.pathId) {
      issues.push(`${variant.key}: missing Renderer -> Material PPtr evidence`);
      break;
    }
  }
}

const formulaVariants = (evidence.variants || []).filter((variant) => variant.classification === "formula");
const formulaByShader = new Map(formulaVariants.map((variant) => [variant.shortShader, variant]));
same("formula shader set", sorted(formulaByShader.keys()), sorted(Object.keys(EXPECTED_FORMULAS)));
for (const [shader, expected] of Object.entries(EXPECTED_FORMULAS)) {
  const variant = formulaByShader.get(shader);
  if (!variant) continue;
  same(`${shader} fragment SPIR-V SHA-256`, variant.fragmentSpvSha256, expected.sha256);
  same(`${shader} bytecode zero gate`, variant.zeroGateProperty, expected.gate);
  same(`${shader} configured MRT1 state`, variant.configuredNonzero, expected.configuredNonzero);
  if (expected.gate) same(`${shader} official Material gate values`, variant.zeroGateValues, [0]);
}

same(
  "location-0-only shader set",
  sorted((evidence.shaders || []).filter((shader) => shader.outputLocations?.length === 1 && shader.outputLocations[0] === 0).map((shader) => shader.shortShader)),
  sorted(EXPECTED_LOCATION0_ONLY),
);
same(
  "configured nonzero MRT1 shader set",
  sorted((evidence.shaders || []).filter((shader) => shader.configuredNonzero).map((shader) => shader.shortShader)),
  sorted(EXPECTED_CONFIGURED_NONZERO),
);

let defaults;
try {
  defaults = JSON.parse(runPython(
    "build/extract-shader-defaults.py",
    [],
    JSON.stringify({
      root: SHADER_ROOT,
      shaders: (evidence.shaders || []).map((shader) => shader.shortShader),
    }),
  ));
} catch (error) {
  console.error(`BAD official rtBlend1 extraction failed: ${error.message}`);
  process.exit(1);
}

same("render shader state extraction missing set", defaults.missing || [], []);
let rtBlend1Passes = 0;
let rtBlend1Shaders = 0;
for (const shader of evidence.shaders || []) {
  const metadata = defaults.found?.[shader.shortShader];
  if (!metadata) {
    issues.push(`${shader.shortShader}: shader state metadata missing`);
    continue;
  }
  const selectedProgram = (evidence.variants || []).find((variant) => variant.shader === shader.shader);
  const selectedSource = selectedProgram
    ? path.resolve(DECRYPTED_ROOT, ...selectedProgram.shaderBundle.split("/"))
    : null;
  const candidates = metadata.variants?.length ? metadata.variants : [metadata];
  const variants = candidates.filter((variant) => (
    variant.fullName === shader.shader
    && selectedSource
    && path.resolve(variant.sourcePath) === selectedSource
  ));
  same(`${shader.shortShader} PPtr-selected shader-state asset count`, variants.length, 1);
  let shaderPasses = 0;
  for (const assetVariant of variants) {
    for (const [passIndex, pass] of (assetVariant.passStates || []).entries()) {
      shaderPasses += 1;
      rtBlend1Passes += 1;
      const blend = pass.rtBlends?.[1];
      const actual = blend && {
        src: blend.src?.val,
        dst: blend.dst?.val,
        srcAlpha: blend.srcAlpha?.val,
        dstAlpha: blend.dstAlpha?.val,
        op: blend.op?.val,
        opAlpha: blend.opAlpha?.val,
        colMask: blend.colMask?.val,
      };
      same(`${shader.shortShader} pass ${passIndex} rtBlend1 One/Zero replace`, actual, {
        src: 1,
        dst: 0,
        srcAlpha: 1,
        dstAlpha: 0,
        op: 0,
        opAlpha: 0,
        colMask: 15,
      });
    }
  }
  if (!shaderPasses) issues.push(`${shader.shortShader}: no official pass state found`);
  else rtBlend1Shaders += 1;
}
same("rtBlend1 shader coverage", rtBlend1Shaders, 27);
same("rtBlend1 pass coverage", rtBlend1Passes, 27);

if (issues.length) {
  for (const issue of issues) console.error(`BAD ${issue}`);
  console.error(`\n${issues.length} official MRT output issue(s) found.`);
  process.exit(1);
}

const zeroGated = formulaVariants
  .filter((variant) => variant.zeroGateProperty)
  .map((variant) => `${variant.shortShader}:${variant.zeroGateProperty}=0`);
console.log("Official MRT output audit OK");
console.log(`Prefab chain:          4 cards, ${evidence.summary.meshRenderers} MeshRenderers, ${evidence.summary.materialReferences} material PPtrs`);
console.log(`Actual programs:       ${evidence.summary.rendererShaders} shaders, ${evidence.summary.actualVariants} complete-keyword Vulkan variants`);
console.log(`Fragment outputs:      ${evidence.summary.location1Shaders} location1, ${evidence.summary.location0OnlyShaders} location0-only stencil`);
console.log(`MRT1 formulas:         ${evidence.summary.fixedZeroShaders} fixed vec4(0), ${evidence.summary.formulaShaders} nonzero-capable`);
console.log(`Configured nonzero:    ${EXPECTED_CONFIGURED_NONZERO.join(", ")}`);
console.log(`Material-zero gates:   ${zeroGated.join(", ")}`);
console.log(`rtBlend1:              ${rtBlend1Shaders} shaders / ${rtBlend1Passes} passes, One/Zero replace`);
