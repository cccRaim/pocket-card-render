import { createKiraPuyoState, updateKiraPuyo } from "../public/render/kira-puyo.js";

export const KIRA_PUYO_RENDERER_PROPERTY_BLOCK_CONTRACT = Object.freeze({
  schema: "pocket-card-render/renderer-property-block@1",
  producer: "KiraPuyoObject.UpdateMPB",
  values: Object.freeze({
    _RampRepeat: Object.freeze({ type: "float", semantic: "component.rampRepeat" }),
    _ScrollScale: Object.freeze({ type: "float", semantic: "component.scrollScale" }),
    _ScrollOffset: Object.freeze({ type: "float", semantic: "component.scrollOffset" }),
    _KiraScale: Object.freeze({ type: "float", semantic: "animationCurve.kiraScale" }),
    _Anim: Object.freeze({ type: "float", semantic: "transformedLocalFront.anim" }),
  }),
});

const CONTRACT_FIELDS = new Set(["schema", "producer", "values"]);
const VALUE_FIELDS = new Set(["type", "semantic"]);
const EXPECTED_SEMANTICS = new Map(Object.entries(
  KIRA_PUYO_RENDERER_PROPERTY_BLOCK_CONTRACT.values,
).map(([name, spec]) => [name, spec.semantic]));

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function rejectUnknownFields(value, allowed, label) {
  for (const field of Object.keys(value)) {
    if (!allowed.has(field)) throw new Error(`${label} has unknown field ${field}`);
  }
}

export function compileRendererPropertyBlockContract(raw) {
  if (!isRecord(raw)) throw new Error("renderer property-block contract must be an object");
  rejectUnknownFields(raw, CONTRACT_FIELDS, "renderer property-block contract");
  if (raw.schema !== KIRA_PUYO_RENDERER_PROPERTY_BLOCK_CONTRACT.schema) {
    throw new Error(`unsupported renderer property-block schema ${String(raw.schema)}`);
  }
  if (raw.producer !== KIRA_PUYO_RENDERER_PROPERTY_BLOCK_CONTRACT.producer) {
    throw new Error(`unsupported renderer property-block producer ${String(raw.producer)}`);
  }
  if (!isRecord(raw.values)) throw new Error("renderer property-block values must be an object");
  const names = Object.keys(raw.values).sort();
  const expectedNames = [...EXPECTED_SEMANTICS.keys()].sort();
  if (JSON.stringify(names) !== JSON.stringify(expectedNames)) {
    throw new Error("renderer property-block value set is incomplete");
  }
  const values = {};
  for (const name of names) {
    const spec = raw.values[name];
    if (!isRecord(spec)) throw new Error(`renderer property-block value ${name} must be an object`);
    rejectUnknownFields(spec, VALUE_FIELDS, `renderer property-block value ${name}`);
    if (spec.type !== "float") throw new Error(`renderer property-block value ${name} must be float`);
    if (spec.semantic !== EXPECTED_SEMANTICS.get(name)) {
      throw new Error(`renderer property-block value ${name} semantic changed`);
    }
    values[name] = { type: spec.type, semantic: spec.semantic };
  }
  return {
    schema: raw.schema,
    producer: raw.producer,
    values,
  };
}

function sameFloat(actual, expected) {
  return Number.isFinite(actual)
    && Object.is(Math.fround(actual), Math.fround(expected));
}

export function evaluateKiraPuyoRendererPropertyBlock({
  recipe,
  runtimeSettings,
  unityLocalFront,
}) {
  const component = recipe?.rendererProperties?.kiraPuyo;
  const settings = component && runtimeSettings?.kiraPuyo?.[component.settingsIdentity];
  if (!component || !settings) throw new Error("KiraPuyo renderer component/settings are absent");
  if (!Array.isArray(unityLocalFront) || unityLocalFront.length !== 3
      || !unityLocalFront.every(Number.isFinite)) {
    throw new Error("KiraPuyo unityLocalFront must contain three finite values");
  }
  const values = updateKiraPuyo(
    createKiraPuyoState(component, settings),
    unityLocalFront,
  );
  return {
    _RampRepeat: values.rampRepeat,
    _ScrollScale: values.scrollScale,
    _ScrollOffset: values.scrollOffset,
    _KiraScale: values.kiraScale,
    _Anim: values.anim,
  };
}

export function verifyKiraPuyoRendererPropertyBlock({
  contract,
  recipe,
  runtimeSettings,
  producerAudit,
  materialUniforms,
  programUniforms,
  prefix = "renderer-property-block",
}) {
  const normalized = compileRendererPropertyBlockContract(contract);
  const errors = [];
  if (!isRecord(producerAudit)
      || producerAudit.schema !== normalized.schema
      || producerAudit.producer !== normalized.producer) {
    return [`${prefix}: renderer property-block producer audit is absent or mismatched`];
  }
  let expected;
  try {
    expected = evaluateKiraPuyoRendererPropertyBlock({
      recipe,
      runtimeSettings,
      unityLocalFront: producerAudit.unityLocalFront,
    });
  } catch (error) {
    return [`${prefix}: ${error instanceof Error ? error.message : String(error)}`];
  }
  if (!isRecord(producerAudit.values)) {
    errors.push(`${prefix}: renderer property-block producer values are absent`);
  }
  const active = programUniforms instanceof Map
    ? programUniforms
    : new Map(Object.entries(programUniforms || {}));
  for (const [name, spec] of Object.entries(normalized.values)) {
    const expectedValue = expected[name];
    if (!sameFloat(producerAudit.values?.[name], expectedValue)) {
      errors.push(`${prefix}: ${name} producer value mismatch`);
    }
    if (!sameFloat(materialUniforms?.[name], expectedValue)) {
      errors.push(`${prefix}: ${name} material uniform mismatch`);
    }
    const program = active.get(name);
    if (program?.type !== "FLOAT" || !sameFloat(program?.value, expectedValue)) {
      errors.push(`${prefix}: ${name} active WebGL ${spec.type} binding mismatch`);
    }
  }
  return errors;
}
