import assert from "node:assert/strict";
import test from "node:test";

import {
  exactShaderHasActiveBloomOutput,
  sceneUsesBloomProducer,
  sceneUsesExactBloomProducer,
} from "../public/render/pipeline/bloom-activation.js";
import { officialPortIdentityKey } from "../public/render/official-port-identity.js";
import {
  compileRuntimeMaterialDispatchIndex,
} from "../public/render/runtime-dispatch-contract.js";

function exactFixture(shader, mrt) {
  const selector = {
    selectorId: `${shader}-selector`,
    candidateWitnessId: `${shader}-candidate`,
    shaderIdentity: `${shader}-identity`,
    shaderName: `Lettuce/Common/${shader}`,
    keywords: [],
    selectionMode: "unique-exact-keywords",
    subshader: 0,
    pass: 0,
  };
  const manifest = {
    shader,
    official_selector: selector,
    runtime_contract: { shader_key: shader },
    mrt,
  };
  const identityKey = officialPortIdentityKey(selector);
  const dispatchContract = {
    schema: "pocket-card-render/official-program-port-contract@2",
    ports: [{
      selectorId: selector.selectorId,
      candidateWitnessId: selector.candidateWitnessId,
      semanticExecutableId: `${shader}-semantic`,
      subshader: selector.subshader,
      pass: selector.pass,
    }],
    runtimeDispatch: {
      schema: "pocket-card-render/runtime-material-dispatch@1",
      routes: [{
        selectorId: selector.selectorId,
        candidateWitnessId: selector.candidateWitnessId,
        semanticExecutableId: `${shader}-semantic`,
        shaderIdentity: selector.shaderIdentity,
        keywords: selector.keywords,
        selectionMode: selector.selectionMode,
        subshader: selector.subshader,
        pass: selector.pass,
        runtimeEngineVariantBoundary: false,
        dispatch: {
          support: "implemented",
          shaderKey: shader,
          strategy: "fixture",
          blend: "over",
          defer: false,
          materialBlend: false,
          materialCull: false,
          capabilities: {},
        },
      }],
    },
  };
  const source = { vert: "void main(){}", frag: "void main(){}", manifest };
  const entry = {
    manifest,
    manifests: [manifest],
    sourcesByPort: { [identityKey]: source },
  };
  Object.defineProperty(entry, "fixturePortSource", { value: source, enumerable: false });
  const exactShaders = { [shader]: entry };
  Object.defineProperty(exactShaders, "sourcesByPortIdentity", {
    value: { [identityKey]: source },
    enumerable: false,
  });
  return {
    entry,
    exactShaders,
    dispatchIndex: compileRuntimeMaterialDispatchIndex(dispatchContract),
    material: {
      shader,
      official: { shader: selector.shaderIdentity, validKeywords: [] },
      floats: { _EmissivePattern: 1 },
      colors: { _EmissiveColor: { r: 1, g: 1, b: 1, a: 1 } },
    },
  };
}

test("active MRT1 producers enable bloom without shader-name or material-color guesses", () => {
  const circular = exactFixture(
    "Card_Circular_Moving_Kira",
    { primary: "_163", emissive: "_175", secondary_rgb: "active" },
  );
  const zeroSecondary = exactFixture(
    "Card_Hologram_Tuning",
    { primary: "_409", secondary: "_415", secondary_value: "zero" },
  );
  assert.equal(exactShaderHasActiveBloomOutput(circular.entry), true);
  assert.equal(exactShaderHasActiveBloomOutput(zeroSecondary.entry), false);
  assert.equal(exactShaderHasActiveBloomOutput({
    manifest: { mrt: { primary: "_20", emissive: "_21" } },
  }), true, "an official emissive MRT attachment is an active Bloom producer unless marked inactive");
  assert.equal(exactShaderHasActiveBloomOutput({
    manifest: { mrt: { primary: "_20", emissive: "_21", emissive_value: "alpha-only" } },
  }), false);
  assert.equal(exactShaderHasActiveBloomOutput({
    manifest: { mrt: { primary: "_20", emissive: "_21", secondary_value: [0, 0, 0, 1] } },
  }), false);
  assert.equal(exactShaderHasActiveBloomOutput({
    manifest: { mrt: { primary: "_20", emissive: "_21", secondary_value: "emissive-rgb" } },
  }), true);
  assert.equal(sceneUsesExactBloomProducer(
    { moving: circular.material },
    circular.exactShaders,
    circular.dispatchIndex,
  ), true);
  assert.equal(sceneUsesExactBloomProducer(
    { flat: zeroSecondary.material },
    zeroSecondary.exactShaders,
    zeroSecondary.dispatchIndex,
  ), false);
  assert.equal(sceneUsesBloomProducer(
    { flat: zeroSecondary.material },
    zeroSecondary.exactShaders,
    zeroSecondary.dispatchIndex,
  ), false, "an exact zero-MRT port must suppress the legacy emissive-property guess");

  const mismatched = structuredClone(zeroSecondary.material);
  mismatched.official.shader = "unmatched-identity";
  assert.equal(sceneUsesBloomProducer(
    { flat: mismatched },
    zeroSecondary.exactShaders,
    zeroSecondary.dispatchIndex,
  ), false, "selector mismatch must not guess a bloom producer from material properties");

  const invalidDefaults = exactFixture(
    "Card_Invalid_Defaults",
    { primary: "_20", emissive: "_21", secondary_rgb: "active" },
  );
  invalidDefaults.entry.manifest.official_pass_runtime = {
    shader_property_defaults: { _ZTest: 4 },
  };
  invalidDefaults.entry.manifest.official_shader_property_defaults = {
    floats: { _ZTest: 8 },
  };
  assert.doesNotThrow(() => sceneUsesBloomProducer(
    { invalid: invalidDefaults.material },
    invalidDefaults.exactShaders,
    invalidDefaults.dispatchIndex,
  ));
  assert.equal(sceneUsesBloomProducer(
    { invalid: invalidDefaults.material },
    invalidDefaults.exactShaders,
    invalidDefaults.dispatchIndex,
  ), false, "pass-default disagreement must fail closed without crashing scene pre-scan");
});
