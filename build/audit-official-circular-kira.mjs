#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCENE = path.join(ROOT, "public", "scene.cPK_20_000010_01_FUSHIGIDANE_S.json");
const COMPONENT_IDENTITY = "CAB-42b1637987e79a0644d26419b2f62d05:-6620796137463397572";
const COMPONENT_PATH = "cPK_20_000010_01_FUSHIGIDANE_S_L/L_EFF_Circular_Kira_S";
const METHOD_ROOT = "c39b1e2a19b9cf8cdf35f55c5c9f7aa229d4edd44a1f0485f24229ac4842541c";
const UPDATE_TRAIL_WITNESS_ROOT = "8519ea39026e8f682220e77ecbdc4c1155c0b075d8916ef5a44fc0d7fe49a243";
const SEMANTIC_WITNESSES_ROOT = "e7935597fdd0cedffc7f1dbdb49b085cb1fdac6e5e44cf7ed9fda478161337df";

const SCALAR_MAP = {
  _defaultCircularAnglePattern: "defaultCircularAnglePattern",
  _defaultCircularAngleManual: "defaultCircularAngleManual",
  _tiltPower: "tiltPower",
  _tiltThreshold: "tiltThreshold",
  _tiltStateChangeDelay: "tiltStateChangeDelay",
  _rotateAccel: "rotateAccel",
  _brakeDuration: "brakeDuration",
  _primTypeASymmetryCount: "primTypeASymmetryCount",
  _primTypeBSymmetryCount: "primTypeBSymmetryCount",
  _primTypeCSymmetryCount: "primTypeCSymmetryCount",
  _meshDivideCount: "meshDivideCount",
  _moveAngleScale: "moveAngleScale",
  _centerIntensity: "centerIntensity",
  _fadeOut: "fadeOut",
  _fadeOutEnd: "fadeOutEnd",
  _expandLength: "expandLength",
  _expandPower: "expandPower",
  _useLengthLimit: "useLengthLimit",
  _limitLengthRatio: "limitLengthRatio",
  _LimitAdjustCurvePower: "limitAdjustCurvePower",
  _LimitAdjustSpeed: "limitAdjustSpeed",
  _useDistanceFadeOut: "useDistanceFadeOut",
  _distanceFadeOutSpeed: "distanceFadeOutSpeed",
  _distanceFadeOutCurvePower: "distanceFadeOutCurvePower",
  "<IsAnimationStopped>k__BackingField": "isAnimationStopped",
};
const PRIMITIVE_MAP = {
  PrimType: "primType",
  BaseScale: "baseScale",
  BaseIntensity: "baseIntensity",
  MinIntensity: "minIntensity",
  MaxIntensity: "maxIntensity",
  FlickerSpeed: "flickerSpeed",
  FlickerScaling: "flickerScaling",
  StartAngle: "startAngle",
  UseMorphing: "useMorphing",
  UseMorphingNoise: "useMorphingNoise",
  MorphingSpeed: "morphingSpeed",
  MorphingClearly: "morphingClearly",
  MaxRotateSpeed: "maxRotateSpeed",
  ReverseRotation: "reverseRotation",
};

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function extractEvidence() {
  const runner = process.env.PYTHON || "python";
  const result = spawnSync(runner, ["build/extract_official_circular_kira.py"], {
    cwd: ROOT,
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 32 * 1024 * 1024,
    shell: process.platform === "win32" && runner === "python",
  });
  if (result.status !== 0) throw new Error(`${result.error || ""}\n${result.stdout || ""}\n${result.stderr || ""}`.trim());
  return JSON.parse(result.stdout.replace(/^\uFEFF/, ""));
}

const floatBuffer = new ArrayBuffer(4);
const floatView = new DataView(floatBuffer);
function floatBits(value) {
  floatView.setFloat32(0, Math.fround(value), true);
  return floatView.getUint32(0, true);
}

function assertNumericExact(actual, expected, label) {
  assert.equal(typeof actual, "number", `${label} is not numeric`);
  if (Number.isInteger(expected)) assert.equal(actual, expected, `${label} integer drifted`);
  else assert.equal(floatBits(actual), floatBits(expected), `${label} float32 bits drifted`);
}

function expectedConfig(component) {
  const out = {
    componentIdentity: component.identity,
    componentGoIdentity: component.gameObject.identity,
    componentGoPath: COMPONENT_PATH,
    scriptIdentity: component.script.identity,
    rendererBindings: Object.fromEntries(Object.entries(component.renderers).map(([role, value]) => [role, value.identity])),
    meshFilterBindings: Object.fromEntries(Object.entries(component.meshFilters).map(([role, value]) => [role, value.identity])),
    primitives: component.primitives.map((primitive) => Object.fromEntries(
      Object.entries(PRIMITIVE_MAP).map(([source, target]) => [target, primitive[source]]),
    )),
  };
  for (const [source, target] of Object.entries(SCALAR_MAP)) out[target] = component.serializedScalars[source];
  return out;
}

function assertConfig(actual, expected) {
  assert.deepEqual(Object.keys(actual).sort(), Object.keys(expected).sort(), "Circular scene config key set drifted");
  for (const [key, value] of Object.entries(expected)) {
    if (typeof value === "number") assertNumericExact(actual[key], value, `config.${key}`);
    else if (Array.isArray(value)) {
      assert.equal(actual[key].length, value.length, `config.${key} length drifted`);
      value.forEach((row, index) => {
        assert.deepEqual(Object.keys(actual[key][index]).sort(), Object.keys(row).sort(), `config.${key}[${index}] key set drifted`);
        for (const [field, expectedValue] of Object.entries(row)) {
          assertNumericExact(actual[key][index][field], expectedValue, `config.${key}[${index}].${field}`);
        }
      });
    } else assert.deepEqual(actual[key], value, `config.${key} drifted`);
  }
}

export function validateCircularKiraEvidence(evidence, scene) {
  assert.equal(evidence.schema, "pocket-card-render/official-circular-kira-evidence@2");
  assert.equal(evidence.component.identity, COMPONENT_IDENTITY);
  assert.equal(evidence.component.rawSize, 432);
  assert.equal(evidence.component.rawSha256, "6fa68dc7f30909371db836bba3fcfe91457ba93636905536704675f1433517c1");
  assert.equal(Object.keys(evidence.methods).length, 18);
  assert.equal(Object.values(evidence.methods).reduce((sum, method) => sum + method.size, 0), 7968);
  assert.equal(crypto.createHash("sha256").update(stableJson(evidence.methods)).digest("hex"), METHOD_ROOT);
  const updateTrailWitness = evidence.semanticWitnesses?.UpdateTrailParams;
  assert.ok(updateTrailWitness, "UpdateTrailParams semantic witness is missing");
  assert.equal(updateTrailWitness.methodSha256, evidence.methods.UpdateTrailParams.sha256);
  assert.equal(Object.keys(updateTrailWitness.windows).length, 5);
  assert.equal(
    crypto.createHash("sha256").update(stableJson(updateTrailWitness)).digest("hex"),
    UPDATE_TRAIL_WITNESS_ROOT,
    "UpdateTrailParams instruction witness drifted",
  );
  assert.equal(
    evidence.semanticWitnesses.UpdateParticleParamsBrake.methodSha256,
    evidence.methods.UpdateParticleParams.sha256,
  );
  assert.equal(
    evidence.semanticWitnesses.ResetBrakeParams.methodSha256,
    evidence.methods.ResetBrakeParams.sha256,
  );
  assert.equal(
    crypto.createHash("sha256").update(stableJson(evidence.semanticWitnesses)).digest("hex"),
    SEMANTIC_WITNESSES_ROOT,
    "CircularKira semantic witnesses drifted",
  );

  const settings = scene.runtimeSettings?.circularKira || {};
  assert.deepEqual(Object.keys(settings), [COMPONENT_IDENTITY], "scene Circular component set drifted");
  assertConfig(settings[COMPONENT_IDENTITY], expectedConfig(evidence.component));

  const roleNames = Object.keys(evidence.component.roles).sort();
  assert.deepEqual(roleNames, ["movingA", "movingB", "trailA", "trailB"].sort());
  const circularDraws = scene.officialDraws.filter((draw) => draw.rendererProperties?.circularKira);
  assert.equal(circularDraws.length, 4, "scene must contain exactly four Circular draws");
  const drawsByRole = new Map();
  for (const draw of circularDraws) {
    const binding = draw.rendererProperties.circularKira;
    assert.equal(binding.componentIdentity, COMPONENT_IDENTITY);
    assert.ok(roleNames.includes(binding.role), `unknown Circular role ${binding.role}`);
    assert.ok(!drawsByRole.has(binding.role), `duplicate Circular role ${binding.role}`);
    drawsByRole.set(binding.role, draw);
  }
  assert.deepEqual([...drawsByRole.keys()].sort(), roleNames);

  for (const [role, official] of Object.entries(evidence.component.roles)) {
    const draw = drawsByRole.get(role);
    const expectedShader = role.startsWith("moving") ? "Card_Circular_Moving_Kira" : "Card_Circular_Trail_Kira";
    assert.equal(draw.drawId, `${official.renderer.identity}#${official.materialSlot}`);
    assert.equal(draw.rendererIdentity, official.renderer.identity);
    assert.equal(draw.materialSlot, official.materialSlot);
    assert.equal(draw.materialIdentity, official.material.identity);
    assert.equal(draw.meshIdentity, official.mesh.identity);
    assert.equal(draw.go, official.gameObjectName);
    assert.equal(draw.goPath, official.gameObjectPath);
    const material = scene.materials[draw.materialName];
    assert.ok(material, `${draw.materialName} recipe is missing`);
    assert.equal(material.shader, expectedShader);
    assert.equal(material.official.material, official.material.identity);
    assert.equal(material.official.shader, draw.shaderIdentity);
  }
  const unboundCircular = scene.officialDraws.filter((draw) => {
    const shader = scene.materials[draw.materialName]?.shader;
    return shader?.startsWith("Card_Circular_") && !draw.rendererProperties?.circularKira;
  });
  assert.deepEqual(unboundCircular, [], "Circular shader draw is missing its component role");
}

export function auditOfficialCircularKira() {
  const evidence = extractEvidence();
  const scene = JSON.parse(fs.readFileSync(SCENE, "utf8"));
  validateCircularKiraEvidence(evidence, scene);

  const mutations = [
    (copy) => { copy.runtimeSettings.circularKira[COMPONENT_IDENTITY].tiltPower += 1e-6; },
    (copy) => { copy.runtimeSettings.circularKira[COMPONENT_IDENTITY].primitives[0].reverseRotation = 2; },
    (copy) => { copy.officialDraws.find((draw) => draw.rendererProperties?.circularKira?.role === "movingA").meshIdentity = "bad:1"; },
    (copy) => { copy.officialDraws.find((draw) => draw.rendererProperties?.circularKira?.role === "trailA").rendererProperties.circularKira.role = "trailB"; },
  ];
  for (const mutate of mutations) {
    const copy = structuredClone(scene);
    mutate(copy);
    assert.throws(() => validateCircularKiraEvidence(evidence, copy));
  }
  const evidenceMutation = structuredClone(evidence);
  evidenceMutation.semanticWitnesses.UpdateTrailParams.windows.lengthCurveCap.sha256 = "0".repeat(64);
  assert.throws(() => validateCircularKiraEvidence(evidenceMutation, scene));
  return {
    status: "pass",
    exact: {
      officialSourceIdentity: true,
      componentRawBytes: `${evidence.component.rawSize}/${evidence.component.rawSize}`,
      il2cppMethodBodies: `${Object.keys(evidence.methods).length}/${Object.keys(evidence.methods).length}`,
      managedControlFlow: `${Object.values(evidence.semanticWitnesses).reduce((sum, witness) => sum + Object.keys(witness.windows).length, 0)}/8 instruction windows`,
      serializedConfigAndBindings: "1/1 component, 4/4 renderer roles",
    },
    runtimeRequired: [
      "Unity PerlinNoise1D guest values and Random.Range seed",
      "ARM64 native powf/libm ULP equivalence",
      "official guest MaterialPropertyBlock values over representative tilt/brake timelines",
      "official guest trail UV buffer over representative timelines",
    ],
  };
}

const report = auditOfficialCircularKira();
if (process.argv.includes("--json")) console.log(JSON.stringify(report, null, 2));
else {
  console.log("Official CircularKira config/binding audit: PASS");
  console.log(`  component bytes: ${report.exact.componentRawBytes}`);
  console.log(`  IL2CPP bodies:   ${report.exact.il2cppMethodBodies}`);
  console.log(`  managed control: ${report.exact.managedControlFlow}`);
  console.log("  native libm/noise/random and guest MPB/trail timelines remain runtime-required");
}
