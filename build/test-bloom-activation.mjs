import assert from "node:assert/strict";
import test from "node:test";

import {
  exactShaderHasActiveBloomOutput,
  sceneUsesBloomProducer,
  sceneUsesExactBloomProducer,
} from "../public/render/pipeline/bloom-activation.js";
import { officialPortIdentityKey } from "../public/render/official-port-identity.js";

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
  return {
    entry: {
      manifest,
      manifests: [manifest],
      sourcesByPort: {
        [officialPortIdentityKey(selector)]: { vert: "void main(){}", frag: "void main(){}" },
      },
    },
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
  }), false);
  assert.equal(exactShaderHasActiveBloomOutput({
    manifest: { mrt: { primary: "_20", emissive: "_21", webgl_bloom_route: "uBloomOnly" } },
  }), false);
  assert.equal(sceneUsesExactBloomProducer(
    { moving: circular.material },
    { Card_Circular_Moving_Kira: circular.entry },
  ), true);
  assert.equal(sceneUsesExactBloomProducer(
    { flat: zeroSecondary.material },
    { Card_Hologram_Tuning: zeroSecondary.entry },
  ), false);
  assert.equal(sceneUsesBloomProducer(
    { flat: zeroSecondary.material },
    { Card_Hologram_Tuning: zeroSecondary.entry },
  ), false, "an exact zero-MRT port must suppress the legacy emissive-property guess");

  const mismatched = structuredClone(zeroSecondary.material);
  mismatched.official.shader = "unmatched-identity";
  assert.equal(sceneUsesBloomProducer(
    { flat: mismatched },
    { Card_Hologram_Tuning: zeroSecondary.entry },
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
    { Card_Invalid_Defaults: invalidDefaults.entry },
  ));
  assert.equal(sceneUsesBloomProducer(
    { invalid: invalidDefaults.material },
    { Card_Invalid_Defaults: invalidDefaults.entry },
  ), false, "pass-default disagreement must fail closed without crashing scene pre-scan");
});
