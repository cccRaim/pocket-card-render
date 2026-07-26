import assert from "node:assert/strict";
import {
  bindOfficialPassDefaults,
  selectCompatibleStageSource,
  selectExactShaderPort,
  selectExactShaderPorts,
} from "../public/render/context.js";
import { officialPortIdentityKey, orderOfficialPasses } from "../public/render/official-port-identity.js";
import { selectContractPort } from "./official-port-verifier-lib.mjs";

const shaderIdentity = "CAB-test:1";
const manifest = (selectorId, keywords, options = {}) => ({
  shader: "Lettuce/Common/CardNew/Face/Card_Parallax",
  runtime_contract: { shader_key: "Card_Parallax" },
  official_selector: {
    selectorId,
    candidateWitnessId: options.candidateWitnessId || `${selectorId}-candidate`,
    shaderIdentity,
    shaderName: "Lettuce/Common/CardNew/Face/Card_Parallax",
    keywords,
    selectionMode: options.selectionMode || "unique-exact-keywords",
    subshader: options.subshader ?? 0,
    pass: options.pass ?? 0,
  },
});
const square = manifest("square", ["_UVASPECTRATIO_SQUARE"]);
const bestMatch = manifest("best-match", [], { selectionMode: "native-best-match" });
const exactShaders = {
  Card_Parallax: {
    vert: "vertex",
    frag: "fragment",
    manifest: square,
    manifests: [square, bestMatch],
    sourcesByPort: {
      [officialPortIdentityKey(square.official_selector)]: { vert: "vertex", frag: "fragment" },
      [officialPortIdentityKey(bestMatch.official_selector)]: { vert: "vertex", frag: "fragment" },
    },
  },
};

const select = (validKeywords, shader = shaderIdentity) => selectExactShaderPort(exactShaders, {
  official: { shader, validKeywords },
}, "Card_Parallax");

assert.equal(select(["_UVASPECTRATIO_SQUARE"])?.manifest, square);
assert.equal(select([])?.manifest, bestMatch);
assert.equal(select(["_UVASPECTRATIO_CARDWINDOW"]), null);
assert.equal(select([], "CAB-wrong:2"), null);
assert.equal(selectExactShaderPort(exactShaders, { official: { shader: shaderIdentity } }, "Card_Parallax"), null);
assert.equal(selectExactShaderPort(exactShaders, { official: { shader: shaderIdentity, validKeywords: [] } }, "Wrong"), null);

const selectorOwnedSources = {
  Card_Parallax: {
    ...exactShaders.Card_Parallax,
    sourcesByPort: {
      [officialPortIdentityKey(square.official_selector)]: { vert: "square-vertex", frag: "square-fragment" },
      [officialPortIdentityKey(bestMatch.official_selector)]: { vert: "best-vertex", frag: "best-fragment" },
    },
  },
};
const selectedOwnedSource = selectExactShaderPort(selectorOwnedSources, {
  official: { shader: shaderIdentity, validKeywords: ["_UVASPECTRATIO_SQUARE"] },
}, "Card_Parallax");
assert.deepEqual({ vert: selectedOwnedSource.vert, frag: selectedOwnedSource.frag },
  { vert: "square-vertex", frag: "square-fragment" });
assert.equal(selectExactShaderPort({
  Card_Parallax: { ...exactShaders.Card_Parallax, vert: null, frag: null, sourcesByPort: {} },
}, {
  official: { shader: shaderIdentity, validKeywords: ["_UVASPECTRATIO_SQUARE"] },
}, "Card_Parallax"), null);

const stageSourceOnly = { vert: "vertex", frag: "fragment", manifest: null, manifests: [], stageSourceOnly: true };
const mixedSources = { ...exactShaders, Effect: stageSourceOnly };
assert.equal(selectExactShaderPort(mixedSources, {
  official: { shader: shaderIdentity, validKeywords: [] },
}, "Effect"), null);
assert.equal(selectCompatibleStageSource(mixedSources, "Effect"), stageSourceOnly);
assert.equal(selectCompatibleStageSource(mixedSources, "Card_Parallax"), null);

const metalIdentity = "CAB-metal:2";
const metalManifest = {
  shader: "Lettuce/Common/CardNew/Face/Card_Parallax_Metal",
  runtime_contract: { shader_key: "Card_Parallax_Metal" },
  official_selector: {
    selectorId: "metal",
    shaderIdentity: metalIdentity,
    shaderName: "Lettuce/Common/CardNew/Face/Card_Parallax_Metal",
    keywords: [],
  },
};
const withMetal = {
  ...exactShaders,
  Card_Parallax_Metal: { vert: "metal-vertex", frag: "metal-fragment", manifest: metalManifest },
};
assert.equal(selectExactShaderPort(withMetal, {
  official: { shader: metalIdentity, validKeywords: [] },
}, "Card_Parallax_Metal")?.manifest, metalManifest);
assert.equal(selectExactShaderPort(withMetal, {
  official: { shader: "CAB-wrong:3", validKeywords: [] },
}, "Card_Parallax_Metal"), null);
assert.equal(selectExactShaderPort(withMetal, {
  official: { shader: metalIdentity, validKeywords: ["_TILTMETALICENABLED_ON"] },
}, "Card_Parallax_Metal"), null);

const urIdentity = "CAB-ur:3";
const urManifest = {
  shader: "Lettuce/Common/CardNew/Face/Card_Parallax_UR",
  runtime_contract: { shader_key: "Card_Parallax_UR" },
  official_selector: {
    selectorId: "parallax-ur",
    shaderIdentity: urIdentity,
    shaderName: "Lettuce/Common/CardNew/Face/Card_Parallax_UR",
    keywords: [],
  },
};
const withUr = {
  ...withMetal,
  Card_Parallax_UR: { vert: "ur-vertex", frag: "ur-fragment", manifest: urManifest },
};
assert.equal(selectExactShaderPort(withUr, {
  official: { shader: urIdentity, validKeywords: [] },
}, "Card_Parallax_UR")?.manifest, urManifest);
assert.equal(selectExactShaderPort(withUr, {
  official: { shader: urIdentity, validKeywords: ["_DARKNESSENABLED_ON"] },
}, "Card_Parallax_UR"), null);

const multipassRows = [0, 1].map((pass) => ({
  selectorId: "ordered-selector",
  candidateWitnessId: `candidate-${pass}`,
  subshader: 0,
  pass,
}));
assert.throws(() => selectContractPort(multipassRows, { selectorId: "ordered-selector" }),
  /resolves to 2 contract rows/);
assert.equal(selectContractPort(multipassRows, {
  selectorId: "ordered-selector",
  candidateWitnessId: "candidate-1",
  subshader: 0,
  pass: 1,
}), multipassRows[1]);

const orderedManifests = [1, 0].map((pass) => ({
  shader: "Lettuce/Common/CardNew/Face/Card_Circular_Moving_Kira",
  runtime_contract: { shader_key: "Card_Circular_Moving_Kira" },
  official_selector: {
    selectorId: "ordered-selector",
    candidateWitnessId: `ordered-candidate-${pass}`,
    shaderIdentity: "CAB-ordered:4",
    shaderName: "Lettuce/Common/CardNew/Face/Card_Circular_Moving_Kira",
    keywords: [],
    selectionMode: "ordered-multipass-structure",
    subshader: 0,
    pass,
  },
}));
const orderedShaders = {
  Card_Circular_Moving_Kira: {
    manifests: orderedManifests,
    sourcesByPort: Object.fromEntries(orderedManifests.map((entry) => [
      officialPortIdentityKey(entry.official_selector),
      { vert: `vertex-${entry.official_selector.pass}`, frag: `fragment-${entry.official_selector.pass}` },
    ])),
  },
};
const orderedPorts = selectExactShaderPorts(orderedShaders, {
  official: { shader: "CAB-ordered:4", validKeywords: [] },
}, "Card_Circular_Moving_Kira");
assert.deepEqual(orderedPorts.map((port) => port.manifest.official_selector.pass), [0, 1]);
assert.deepEqual(orderedPorts.map((port) => port.frag), ["fragment-0", "fragment-1"]);
assert.equal(selectExactShaderPort(orderedShaders, {
  official: { shader: "CAB-ordered:4", validKeywords: [] },
}, "Card_Circular_Moving_Kira"), null);
assert.deepEqual(selectExactShaderPorts({
  Card_Circular_Moving_Kira: {
    manifests: orderedManifests.slice(0, 1),
    sourcesByPort: orderedShaders.Card_Circular_Moving_Kira.sourcesByPort,
  },
}, {
  official: { shader: "CAB-ordered:4", validKeywords: [] },
}, "Card_Circular_Moving_Kira"), []);
assert.deepEqual(orderOfficialPasses(orderedManifests, (entry) => entry.official_selector)
  .map((entry) => entry.official_selector.pass), [0, 1]);
assert.throws(() => orderOfficialPasses([
  orderedManifests[0],
  structuredClone(orderedManifests[0]),
], (entry) => entry.official_selector), /duplicate composite identity/);
assert.equal(selectExactShaderPort(withUr, {
  official: { shader: "CAB-wrong:4", validKeywords: [] },
}, "Card_Parallax_UR"), null);

const passDefaultsManifest = {
  shader: "Lettuce/Common/CardNew/Face/Test",
  official_shader_property_defaults: {
    floats: { _ZTest: 4, _ZWrite: 1, _StencilRef: 2 },
  },
  official_pass_runtime: {
    source_sha256: "a".repeat(64),
    depth: {
      test: { val: 8, name: "_ZTest" },
      write: { val: 0, name: "_ZWrite" },
    },
  },
};
const boundDefaults = bindOfficialPassDefaults(passDefaultsManifest);
assert.notEqual(boundDefaults, passDefaultsManifest);
assert.deepEqual(boundDefaults.official_pass_runtime.shader_property_defaults,
  passDefaultsManifest.official_shader_property_defaults.floats);
assert.equal(passDefaultsManifest.official_pass_runtime.shader_property_defaults, undefined,
  "binding defaults must not mutate the cached source manifest");
assert.deepEqual(bindOfficialPassDefaults({
  ...passDefaultsManifest,
  official_pass_runtime: {
    ...passDefaultsManifest.official_pass_runtime,
    shader_property_defaults: { _StencilRef: 2, _ZWrite: 1, _ZTest: 4 },
  },
}).official_pass_runtime.shader_property_defaults, { _ZTest: 4, _ZWrite: 1, _StencilRef: 2 });
assert.throws(() => bindOfficialPassDefaults({
  ...passDefaultsManifest,
  official_pass_runtime: {
    ...passDefaultsManifest.official_pass_runtime,
    shader_property_defaults: { _ZTest: 8, _ZWrite: 1, _StencilRef: 2 },
  },
}), /pass defaults disagree/);
assert.throws(() => bindOfficialPassDefaults({
  shader: passDefaultsManifest.shader,
  official_pass_runtime: passDefaultsManifest.official_pass_runtime,
}), /official Shader float defaults are missing/);

console.log("Exact shader multi-selector/pass routing/default binding OK");
