import assert from "node:assert/strict";
import * as THREE from "three";
import { applyOfficialPassState, applyStencilState } from "../public/render/context.js";
import {
  STENCIL_REGION_CONTRACT_SCHEMA,
} from "../public/render/stencil-region.js";

const parameter = (val) => ({ val, name: null });

function contract({ comp = 8, fail = 0, zFail = 0, pass = 0, ref = 0, writeMask = 255 } = {}) {
  const op = { comp: parameter(comp), fail: parameter(fail), zFail: parameter(zFail), pass: parameter(pass) };
  return {
    source_sha256: "a".repeat(64),
    shared_mrt_blend: true,
    blend: {
      src_rgb: parameter(1), dst_rgb: parameter(0),
      src_alpha: parameter(1), dst_alpha: parameter(0),
      op_rgb: parameter(0), op_alpha: parameter(0), color_mask: parameter(0),
    },
    depth: { test: parameter(8), write: parameter(0) },
    culling: parameter(2),
    stencil: {
      ref: parameter(ref), read_mask: parameter(255), write_mask: parameter(writeMask),
      generic: op, front: op, back: op,
    },
    fixed: {
      zClip: parameter(1), conservative: parameter(0),
      offsetFactor: parameter(0), offsetUnits: parameter(0), alphaToMask: parameter(0),
    },
    shader_property_defaults: {},
  };
}

function apply(options) {
  const material = new THREE.MeshBasicMaterial();
  assert.equal(applyOfficialPassState(material, { floats: {} }, contract(options)), true);
  return material;
}

const outer = apply({ comp: 8, pass: 2, ref: 1, writeMask: 1 });
assert.equal(outer.stencilWrite, true, "Always+Replace must keep stencil enabled");
assert.equal(outer.stencilFunc, THREE.AlwaysStencilFunc);
assert.equal(outer.stencilZPass, THREE.ReplaceStencilOp);
assert.equal(outer.stencilFail, THREE.KeepStencilOp);
assert.equal(outer.stencilZFail, THREE.KeepStencilOp);
assert.equal(outer.stencilRef, 1);
assert.equal(outer.stencilWriteMask, 1);

const inner = apply({ comp: 8, pass: 2, ref: 2, writeMask: 2 });
assert.equal(inner.stencilWrite, true);
assert.equal(inner.stencilRef, 2);
assert.equal(inner.stencilWriteMask, 2);

const inert = apply({ comp: 8, fail: 0, zFail: 0, pass: 0 });
assert.equal(inert.stencilWrite, false, "Always+Keep/Keep/Keep may be normalized away");

const testingOnly = apply({ comp: 3, fail: 0, zFail: 0, pass: 0, writeMask: 0 });
assert.equal(testingOnly.stencilWrite, true, "a non-Always compare remains an active stencil test");
assert.equal(testingOnly.stencilFunc, THREE.EqualStencilFunc);

const disabled = new THREE.MeshBasicMaterial();
assert.equal(applyOfficialPassState(disabled, { floats: {} }, contract({ pass: 2 }), { stencil: false }), true);
assert.equal(disabled.stencilWrite, false);

const defaultsContract = contract();
defaultsContract.depth.test = { val: 8, name: "_ZTest" };
defaultsContract.depth.write = { val: 0, name: "_ZWrite" };
defaultsContract.shader_property_defaults = { _ZTest: 4, _ZWrite: 1 };
const fromDefaults = new THREE.MeshBasicMaterial();
assert.equal(applyOfficialPassState(fromDefaults, { floats: {} }, defaultsContract), true);
assert.equal(fromDefaults.depthFunc, THREE.LessEqualDepth,
  "missing Material override must resolve through the official Shader default before pass val");
assert.equal(fromDefaults.depthWrite, true);

const fromMaterial = new THREE.MeshBasicMaterial();
assert.equal(applyOfficialPassState(fromMaterial, {
  floats: { _ZTest: 3, _ZWrite: 0 },
}, defaultsContract), true);
assert.equal(fromMaterial.depthFunc, THREE.EqualDepth,
  "serialized Material override must take precedence over the Shader default");
assert.equal(fromMaterial.depthWrite, false);

const regionContract = contract({ comp: 3 });
regionContract.stencil.ref = { val: 0, name: "_StencilRef" };
regionContract.stencil.read_mask = { val: 0, name: "_StencilRef" };
const windowLayer = new THREE.MeshBasicMaterial();
assert.equal(applyOfficialPassState(windowLayer, {
  clip: "window",
  floats: { _StencilRef: 0 },
}, regionContract), true);
assert.equal(windowLayer.stencilFunc, THREE.EqualStencilFunc);
assert.equal(windowLayer.stencilRef, 2);
assert.equal(windowLayer.stencilFuncMask, 2);
assert.equal(windowLayer.userData.stencilRegionBinding.schema, STENCIL_REGION_CONTRACT_SCHEMA);
assert.equal(windowLayer.userData.stencilRegionBinding.evidenceLevel,
  "inferred-runtime-material-override");

const cardLayer = new THREE.MeshBasicMaterial();
assert.equal(applyOfficialPassState(cardLayer, {
  clip: "card",
  floats: { _StencilRef: 0 },
}, regionContract), true);
assert.equal(cardLayer.stencilRef, 1);
assert.equal(cardLayer.stencilFuncMask, 1);

const fallbackWindow = new THREE.MeshBasicMaterial();
assert.equal(applyStencilState(fallbackWindow, {
  runtimeDispatch: { capabilities: { stencil: "read-stencil-ref" } },
  clip: "window",
  floats: { _StencilRef: 0 },
}), true);
assert.equal(fallbackWindow.stencilRef, 2);
assert.equal(fallbackWindow.stencilFuncMask, 2);

const unrelatedProperty = contract({ comp: 3 });
unrelatedProperty.stencil.ref = { val: 0, name: "_Stencil" };
unrelatedProperty.stencil.read_mask = { val: 0, name: "_Stencil" };
const shadowbox = new THREE.MeshBasicMaterial();
assert.equal(applyOfficialPassState(shadowbox, {
  clip: "window",
  floats: { _StencilRef: 0, _Stencil: 7 },
}, unrelatedProperty), true);
assert.equal(shadowbox.stencilRef, 7,
  "region binding must not replace the shadowbox stencil producer");
assert.equal(shadowbox.userData.stencilRegionBinding, undefined);

console.log("Official pass-state defaults/stencil region binding OK: 11/11");
