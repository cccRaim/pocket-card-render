// Check that scene-bound float slots which are official ShaderLab properties are consumed by
// the renderer strategy or by render-state handling. This catches recipe/strategy drift before
// a material parameter is silently ignored.
//
// Set PCR_AUDIT_EXTRA_FLOATS=1 to also list scene floats that are not ShaderLab properties of
// that material's official shader. Those are recipe/build-time annotations or stale fields, not
// evidence that the browser strategy should consume them. Add PCR_AUDIT_STRICT_EXTRA_FLOATS=1
// to fail when the strategy usage table declares one of those non-official floats.
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { SHADER } from "../public/render/rarities.js";
import { loadExactPortUsageContracts } from "./exact-port-usage-contracts.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const shaderRoot = process.env.PCR_SHADERS
  || "D:/DevProjectes/ptcgp-tools-master/masterdata_decoder/.output/decrypted/Common/Shader";
const reportExtraFloats = process.env.PCR_AUDIT_EXTRA_FLOATS === "1";
const strictExtraFloats = process.env.PCR_AUDIT_STRICT_EXTRA_FLOATS === "1";
const sceneNames = fs.readdirSync(path.join(ROOT, "public"))
  .filter((n) => /^scene\..*\.json$/.test(n))
  .sort();
const exactPortUsage = loadExactPortUsageContracts(ROOT);

const STATE_FLOATS = new Set([
  "_Blend", "_BlendMode", "_Cull", "_CullMode", "_Cutoff", "_DstBlend", "_DstFactor", "_DstFactorA",
  "_SrcBlend", "_SrcFactor", "_SrcFactorA", "_StencilComp", "_StencilPass",
  "_Stencil", "_StencilRef", "_ZTest", "_ZWrite", "_ZWriteParam",
]);

const COMMON_HOLO_FLOATS = [
  "_BaseColorIntensity", "_Shininess", "_SpecularIntensity",
  "_DiffractionPower", "_DiffractionIntensity", "_RampRepeat", "_RampSpeed",
  "_RampOffset", "_RampInterval",
];

const FAKE_SPEC_FLOATS = [
  "_FakeSpecularEnabled", "_FakeSpecularMaskScale", "_FakeSpecularIntensity",
  "_FakeSpecularPower", "_FakeSpecularCornerPower", "_FakeSpecularNotCornerOffset",
];

const FAKE_SPEC_VALUE_FLOATS = [
  "_FakeSpecularMaskScale", "_FakeSpecularIntensity",
  "_FakeSpecularPower", "_FakeSpecularCornerPower", "_FakeSpecularNotCornerOffset",
];

const USED_BY_KIND = {
  outerStencil: [],
  innerStencil: ["_AlphaThreshold"],
  illustStencil: ["_AlphaThreshold"],
  dynamicText: ["_AlphaThreshold", "_EmitMasking"],
  textured: [],
  illustTextured: ["_UseUv"],
  simpleTransparent: [],
  depthParallax: ["_Height", "_HeightPower", "_Scale", "_FakeCameraHeight", "_UseUv", "_UVAspectRatio"],
  effect: [
    "_Layer", "_UseGradationMap", "_UseViewMask", "_MainPower", "_MaskPower",
    "_AnglePower", "_Edge", "_Progress", "_AlphaBlend", "_DepthOffset",
  ],
  frameOutline: [],
  scalingKira: ["_RampRotation"],
  holo: [
    "_Height", "_HeightPower", "_Scale", "_FakeCameraHeight", "_UseUv", "_UseMaskUv",
    "_DiffractionPower", "_DiffractionIntensity", "_RampRepeat", "_RampSpeed",
    "_RampOffset", "_RampInterval",
  ],
  frameHolo: [
    "_AlphaBlend", ...COMMON_HOLO_FLOATS,
    "_RampScale", "_RampRotate", "_RampMaskScale", "_RampMaskRotation",
    "_UseSimpleRampMaskAndRotation", "_RampUVOffset", "_RampUVTiltOffset",
    "_PhaseScale", "_PhaseRotate", "_UseUv", "_UseMaskUv", "_CutOut", "_MaskPower",
    "_FrontMaskPower", "_UseAlphaAsAlphaBlendMask", "_UseReflectionAlpha",
  ],
  frameHoloUR: [
    ...COMMON_HOLO_FLOATS, "_RemoveMetalic", "_RemoveMetallic",
    "_UseSimpleRampMaskAndRotation", "_RampMaskRotation", "_RampMaskScale",
    "_DarknessEnabled", "_DarknessOffset", "_EmissivePattern", ...FAKE_SPEC_FLOATS,
  ],
  frame2LayerUR: [
    ...COMMON_HOLO_FLOATS, "_RemoveMetallic", "_RemoveMetalic",
    "_UseSimpleRampMaskAndRotation", "_RampMaskRotation", "_RampMaskScale",
    "_DiffractionPower2", "_DiffractionIntensity2", "_RampRepeat2", "_RampSpeed2",
    "_RampOffset2", "_RampInterval2", "_UseSimpleRampMaskAndRotation2",
    "_RampMaskRotation2", "_RampMaskScale2", ...FAKE_SPEC_FLOATS,
    "_FakeSpecularMaskScale2", "_FakeSpecularIntensity2", "_FakeSpecularPower2",
    "_FakeSpecularCornerPower2", "_FakeSpecularNotCornerOffset2",
    "_DarknessOffset1", "_DarknessOffset2", "_Tilt", "_EmissivePattern",
  ],
  exHolo: [
    "_AlphaBlend", "_BaseColorIntensity", "_Shininess", "_SpecularIntensity",
    "_DiffractionPower", "_DiffractionIntensity", "_RampRepeat", "_RampSpeed",
    "_RampOffset", "_RampInterval", "_EmitMasking",
  ],
  exHoloUR: [
    "_BaseColorIntensity", "_Shininess", "_SpecularIntensity",
    "_DiffractionPower", "_DiffractionIntensity", "_RampRepeat", "_RampSpeed",
    "_RampOffset", "_RampInterval", "_DarknessOffset", ...FAKE_SPEC_VALUE_FLOATS,
  ],
  rarity: [
    "_BaseColorIntensity", "_Shininess", "_SpecularIntensity",
    "_DiffractionPower", "_DiffractionIntensity", "_RampRepeat", "_RampSpeed",
    "_RampOffset", "_RampInterval",
  ],
  sbHolo: [
    ...COMMON_HOLO_FLOATS, "_OrientationU", "_OrientationV",
    "_ChangeSpeed",
    "_DiffractionPower2", "_DiffractionIntensity2",
    "_RampRepeat2", "_RampSpeed2", "_RampOffset2", "_RampInterval2",
    "_FakeSpecularEnabled", "_FakeSpecularIntensity", "_FakeSpecularMaskScale",
    "_FakeSpecularPower", "_FakeSpecularIntensity_Outline",
    "_FakeSpecularMaskScale_Outline", "_FakeSpecularPower_Outline",
    "_FakeSpecularCornerPower", "_FakeSpecularNotCornerOffset",
    "_DarknessOffset", "_RemoveBase", "_BaseColorIntensity",
    "_DiffuseIntensity", "_TiltIntensity2", "_TiltPower2", "_TiltOffset2",
    "_ReflectionEnabled", "_ReflectionIntensity", "_ReflectionPower",
    "_ReflectionCenterAdjust", "_RefTiltEnabled", "_RefTiltPower",
    "_RefTiltOffset", "_RefTiltIntensity", "_UsePositionAsUV",
    "_TiltEnabled", "_TiltIntensity", "_TiltOffset", "_TiltPower", "_Tilt",
    "_UseHoloAlphaBlend", "_HoloAlphaBlend",
  ],
  plate: [
    "_Height", "_HeightPower", "_Scale", "_FakeCameraHeight", "_UseUv2",
    ...COMMON_HOLO_FLOATS, "_RemoveMetalic", "_RemoveMetallic",
    "_DarknessOffset", ...FAKE_SPEC_FLOATS,
  ],
  parallaxUR: ["_Height", "_HeightPower", "_Scale", "_FakeCameraHeight", "_DarknessOffset"],
  urBgHolo: [
    "_Height", "_HeightPower", "_Scale", "_FakeCameraHeight", "_UseUv2",
    "_DiffractionPower", "_DiffractionIntensity", "_RampRepeat", "_RampSpeed",
    "_RampOffset", "_RampInterval", "_DarknessOffset",
    "_FakeSpecularMaskScale", "_FakeSpecularIntensity", "_FakeSpecularPower",
    "_FakeSpecularCornerPower", "_FakeSpecularNotCornerOffset",
  ],
  flare: [
    "_RemoveTextureArtifact", "_BaseColorRGBIntensity",
    "_ScaleX", "_ScaleY", "_TexScale", "_TexPixelsX", "_TexPixelsY", "_IsBack",
    "_CornerPower", "_NotCornerOffset", "_TiltThreshold", "_TiltPower",
    "_ShouldDoFlicker", "_FlickerAnimSpeed", "_TiltFlickerAnimSpeed",
    "_FlickerTimeDelay", "_FlickResultIntensityLowestPoint", "_EmissivePattern",
  ],
  metal: [
    "_Height", "_HeightPower", "_Scale", "_FakeCameraHeight", "_UseUv",
    "_BaseColorIntensity", "_MetalMaskIntensity", "_SpecularIntensity", "_Shininess",
  ],
  glitter: [
    "_Height", "_HeightPower", "_Scale", "_FakeCameraHeight", "_FlowScale",
    "_HeightB", "_HeightPowerB", "_ScaleB", "_FakeCameraHeightB", "_FlowScaleB",
    "_FadeDuration", "_FlowAPower", "_FlowBPower", "_LightTime", "_EmitThreshold",
  ],
  sideBack: [],
  circularMovingKira: [
    "_FlickerNoiseScale", "_CircularRadius", "_CenterMoveByTilt",
    "_AdjustAlphaBlendAlpha", "_EmissiveIntensity", "_PrimCount", "_PrimDelete",
  ],
  circularTrailKira: [
    "_AdjustRadiusScale", "_CenterMoveByTilt", "_BaseColorIntensity",
    "_AdjustAlphaBlendColor", "_AdjustAlphaBlendAlpha", "_BaseScaleAdjust",
    "_UVOffset", "_BrightnessPower", "_BrightnessAffectIntensity",
    "_FlickerScale", "_FlickerSpeed",
  ],
  matCapLighting: [
    "_FakeCameraHeight", "_Height", "_HeightPower", "_Scale", "_LightSensitive",
    "_LightCurvePower", "_EmissiveIntensity", "_UseUv2", "_Debug", "_EmissiveEnabled",
  ],
  prism: [
    "_ExpandScale", "_ExpandTiming", "_ExpandAlphaPower", "_CenterMoveIntensity",
    "_RotateSpeed", "_ShiftTiming", "_ColorIntensity", "_AdjustAlphaIntensity",
    "_ShiftU", "_ShiftV", "_ShiftUOffsetIntensity", "_ShiftVOffsetIntensity",
    "_EmissiveIntensity", "_UseRotate", "_ColoringMethod", "_ShiftUOffsetByTilt",
    "_ShiftVOffsetByTilt", "_OkLabBlend",
  ],
};

const USED_BY_SHADER = {
  "Frame-Holo-Tuning": [
    "_AlphaBlend", "_BaseColorIntensity", "_Shininess", "_SpecularIntensity",
    "_DiffractionPower", "_DiffractionIntensity", "_RampRepeat", "_RampSpeed",
    "_RampOffset", "_RampInterval", "_RampScale", "_RampRotate",
    "_RampMaskScale", "_RampMaskRotation", "_UseSimpleRampMaskAndRotation",
    "_RampUVOffset", "_RampUVTiltOffset", "_PhaseScale", "_PhaseRotate",
    "_UseUv", "_UseMaskUv", "_CutOut", "_FrontMaskPower", "_MaskEmissive",
  ],
  "Card_Hologram_Tuning": [
    "_AlphaBlend", "_DiffractionPower", "_DiffractionIntensity",
    "_RampRepeat", "_RampSpeed", "_RampOffset", "_RampInterval",
    "_RampScale", "_RampRotate", "_RampUVOffset", "_RampUVTiltOffset",
    "_PhaseScale", "_PhaseRotate", "_UseUv", "_UseMaskUv", "_CutOut",
    "_MaskPower", "_UseAlphaAsAlphaBlendMask", "_UseReflectionAlpha",
  ],
  "Simple-Opaque-Hologram_Tuning": [
    "_DiffractionPower", "_DiffractionIntensity", "_RampRepeat", "_RampSpeed",
    "_RampOffset", "_RampInterval", "_UseHoloAlphaBlend", "_HoloAlphaBlend",
    "_TiltEnabled", "_TiltIntensity", "_TiltOffset", "_TiltPower",
  ],
  "Opaque-Hologram_Tuning": [
    "_ChangeSpeed", "_DiffractionPower",
    "_DiffractionPower2", "_DiffractionIntensity2", "_RampRepeat2",
    "_RampSpeed2", "_RampOffset", "_RampOffset2", "_RampInterval2",
    "_DiffuseIntensity", "_Shininess", "_SpecularIntensity",
    "_OrientationU", "_OrientationV", "_TiltEnabled", "_TiltIntensity",
    "_TiltOffset", "_TiltPower", "_UsePositionAsUV",
    "_UseOutlineNormalFilter", "_OutlineNormalFilterThreshold",
  ],
  "Opaque-UR-Oklab": [
    "_BaseColorIntensity", "_Shininess", "_SpecularIntensity",
    "_DiffractionPower", "_DiffractionIntensity", "_RampRepeat", "_RampSpeed",
    "_RampOffset", "_RampInterval", "_UsePositionAsUV", "_Hologram2Enabled",
    "_DiffractionPower2", "_DiffractionIntensity2", "_RampRepeat2",
    "_RampSpeed2", "_RampOffset2", "_RampInterval2", "_RemoveBase",
    "_TiltPower2", "_TiltOffset2", "_TiltIntensity2", "_ReflectionEnabled",
    "_ReflectionIntensity", "_ReflectionPower", "_ReflectionCenterAdjust",
    "_RefTiltEnabled", "_RefTiltPower", "_RefTiltOffset", "_RefTiltIntensity",
    "_FakeSpecularEnabled", "_FakeSpecularMaskScale", "_FakeSpecularIntensity",
    "_FakeSpecularPower", "_FakeSpecularCornerPower",
    "_FakeSpecularNotCornerOffset", "_FakeSpecularMaskScale_Outline",
    "_FakeSpecularIntensity_Outline", "_FakeSpecularPower_Outline",
    "_DarknessOffset", "_Tilt",
  ],
};

const USED_BY_SHADER_EXTRA = {
};

function usedFloatsFor(shader, kind) {
  if (exactPortUsage.has(shader)) return new Set(exactPortUsage.get(shader).floats);
  const exact = USED_BY_SHADER[shader];
  const used = new Set(exact || USED_BY_KIND[kind] || []);
  if (!exact) for (const name of USED_BY_SHADER_EXTRA[shader] || []) used.add(name);
  return used;
}

function declaredStrategyFloats() {
  const floats = new Set(STATE_FLOATS);
  for (const list of Object.values(USED_BY_KIND)) for (const name of list) floats.add(name);
  for (const list of Object.values(USED_BY_SHADER)) for (const name of list) floats.add(name);
  for (const list of Object.values(USED_BY_SHADER_EXTRA)) for (const name of list) floats.add(name);
  for (const usage of exactPortUsage.values()) for (const name of usage.floats) floats.add(name);
  return floats;
}

function sourceFloatRefs() {
  const dir = path.join(ROOT, "public/render/materials");
  const rows = [];
  const field = "(_[A-Za-z0-9_]+)";
  const patterns = [
    new RegExp(`(^|[^A-Za-z0-9_$])f\\?\\.${field}`, "g"),
    new RegExp(`(^|[^A-Za-z0-9_$])f\\.${field}`, "g"),
    new RegExp(`(^|[^A-Za-z0-9_$])r\\.floats\\?\\.${field}`, "g"),
    new RegExp(`(^|[^A-Za-z0-9_$])r\\.floats\\.${field}`, "g"),
  ];
  for (const file of fs.readdirSync(dir).filter((n) => n.endsWith(".js"))) {
    const src = fs.readFileSync(path.join(dir, file), "utf8");
    for (const re of patterns) {
      for (const m of src.matchAll(re)) rows.push({ file, name: m[2] });
    }
  }
  return rows;
}

const KNOWN_UNIMPLEMENTED = new Set([
]);

const OFFICIAL_DEAD_FLOATS = new Set([
  "Card_UR_LensFlare:_Offset",
  "Card_Parallax_Metal:_UseUv2",
  "Card_Parallax_Hologram_UR_New:_DarknessEnabled",
  "Card_Parallax_Hologram_UR_New:_FakeSpecularEnabled",
  "Opaque-Hologram_Tuning:_DiffractionIntensity",
  "Opaque-UR-Oklab:_DarknessEnabled",
]);

// These properties are read by official bytecode, but only as alpha for the
// second render target: `layout(location = 1) out vec4(0,0,0, mask)`. The
// browser renderer composes the visible card color in a single render target
// and does not consume the game's bloom/emission-mask MRT.
const OFFICIAL_MRT_MASK_FLOATS = new Set([
  "Frame:_EmitMasking",
  "Frame-Holo-Tuning:_MaskEmissive",
  "Transparent_Hologram_Tuning:_EmitMasking",
]);

function inactiveOfficialBranch(shader, name, floats = {}) {
  if (shader === "Opaque-Hologram_Tuning") {
    if (name === "_UseOutlineNormalFilter") return (floats._UseOutlineNormalFilter ?? 0) === 0;
    if (name === "_OutlineNormalFilterThreshold") return (floats._UseOutlineNormalFilter ?? 0) === 0;
  }
  return false;
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

const declaredFloats = declaredStrategyFloats();
for (const ref of sourceFloatRefs()) {
  rows.push({
    ok: declaredFloats.has(ref.name),
    scene: "(source)",
    shader: "(source)",
    kind: ref.file,
    mat: ref.file,
    name: ref.name,
    reason: declaredFloats.has(ref.name) ? "source float declared" : "source float missing declaration",
  });
}

for (const sceneName of sceneNames) {
  const scene = JSON.parse(fs.readFileSync(path.join(ROOT, "public", sceneName), "utf8"));
  for (const [matName, mat] of Object.entries(scene.materials || {})) {
    const shader = mat.shader;
    if (!shader) continue;
    const cfg = SHADER[shader];
    if (!cfg || cfg.defer) continue;
    const officialFloats = new Set(official.found[shader]?.floatProps || []);
    const usedFloats = usedFloatsFor(shader, cfg.kind);
    if (!exactPortUsage.has(shader) && !USED_BY_SHADER[shader] && !USED_BY_KIND[cfg.kind]) {
      rows.push({ ok: false, scene: sceneId(sceneName), shader, kind: cfg.kind, mat: matName, name: "", reason: "missing usage declaration" });
      continue;
    }
    for (const name of Object.keys(mat.floats || {})) {
      if (!officialFloats.has(name)) {
        if (reportExtraFloats) {
          const used = usedFloats.has(name);
          rows.push({
            ok: !(strictExtraFloats && used),
            extra: true,
            state: STATE_FLOATS.has(name),
            used,
            scene: sceneId(sceneName),
            shader,
            kind: cfg.kind,
            mat: matName,
            name,
            reason: used
              ? "strategy declares non-official float"
              : (STATE_FLOATS.has(name)
              ? "renderer state annotation outside ShaderLab props"
              : "not an official shader property"),
          });
        }
        continue;
      }
      if (STATE_FLOATS.has(name)) {
        rows.push({ ok: true, scene: sceneId(sceneName), shader, kind: cfg.kind, mat: matName, name, reason: "renderer state prop" });
        continue;
      }
      const used = usedFloats.has(name);
      const inactiveExactBinding = exactPortUsage.has(shader)
        && !exactPortUsage.get(shader).floats.has(name);
      const dead = OFFICIAL_DEAD_FLOATS.has(`${shader}:${name}`);
      const mrt = OFFICIAL_MRT_MASK_FLOATS.has(`${shader}:${name}`);
      const mrtDisabled = mrt && (mat.floats?.[name] ?? 0) === 0;
      const inactive = inactiveOfficialBranch(shader, name, mat.floats);
      const known = KNOWN_UNIMPLEMENTED.has(`${shader}:${name}`);
      let reason;
      if (dead) reason = used ? "strategy declares official-dead float" : "official bytecode does not read float";
      else if (used) reason = "strategy uses float";
      else if (inactiveExactBinding) reason = "selector executable has no active uniform binding";
      else if (mrt) reason = mrtDisabled ? "official MRT mask disabled by scene" : "official MRT mask output not simulated";
      else if (inactive) reason = "official branch disabled by scene";
      else if (known) reason = "known unimplemented";
      else reason = "strategy ignores official float";
      rows.push({
        ok: dead ? !used : (used || inactiveExactBinding || inactive || known || mrtDisabled),
        known,
        dead,
        mrt,
        mrtDisabled,
        inactive,
        inactiveExactBinding,
        scene: sceneId(sceneName),
        shader,
        kind: cfg.kind,
        mat: matName,
        name,
        reason,
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
  const mark = row.extra ? ((strictExtraFloats && row.used) ? "BAD" : "EXTRA") : (row.dead ? "DEAD" : (row.mrt ? "MRT " : (row.inactive ? "OFF " : (row.known ? "TODO" : (row.ok ? "OK " : "BAD")))));
  console.log(`${mark} ${row.shader.padEnd(35)} kind=${String(row.kind || "").padEnd(18)} float=${row.name.padEnd(30)} ${row.reason.padEnd(30)} count=${String(row.count).padStart(2)} scenes=${[...row.scenes].join(",")}`);
  if (row.examples.length) console.log(`     e.g. ${row.examples.join(", ")}`);
}

const bad = rows.filter((row) => !row.ok);
if (bad.length) {
  console.error(`\n${bad.length} scene float usage issue(s) found.`);
  process.exitCode = 1;
}
