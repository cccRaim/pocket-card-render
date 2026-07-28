import assert from "node:assert/strict";
import test from "node:test";
import { buildExactRuntimeMaterial } from "../public/render/materials/exact-runtime.js";
import { updateMegaRuntime } from "../public/render/mega-runtime.js";

const VERTEX = `#version 300 es
in vec3 position;
void main() { gl_Position = vec4(position, 1.0); }
`;
const FRAGMENT = `#version 300 es
precision highp float;
layout(location = 0) out vec4 pc_fragColor;
void main() { pc_fragColor = vec4(1.0); }
`;

function fixture(dynamicUniforms) {
  const dynamicPortMats = [];
  const manifest = {
    official_pass_runtime: {},
    official_selector: { selectorId: "selector" },
    official_executable_identity: { semanticExecutableId: "executable" },
    runtime_contract: { dynamic_uniforms: dynamicUniforms },
  };
  const ctx = {
    dynamicPortMats,
    exactShaderPort: () => ({ vert: VERTEX, frag: FRAGMENT, manifest }),
    exactPortUniforms: () => ({}),
    layerCubeDefault: () => null,
    layerTexDefault: () => null,
  };
  const recipe = {
    floats: {},
    runtimeDispatch: { shaderKey: "Test_Exact_Runtime" },
  };
  return {
    material: buildExactRuntimeMaterial(recipe, ctx),
    dynamicPortMats,
  };
}

test("generic exact runtime material preserves scalar, vector and array uniform shapes", () => {
  const source = "pocket-card-render/official-guest-common-value-unresolved@1";
  const { material, dynamicPortMats } = fixture({
    _Scalar: { type: "float", source },
    _Shake: { type: "vec2", source },
    _Faults: { type: "float[6]", source },
    _Indices: { type: "int[3]", source },
  });
  assert.equal(dynamicPortMats.length, 1);
  assert.equal(material.uniforms._Scalar.value, 0);
  assert.equal(material.uniforms._Shake.value.isVector2, true);
  assert.equal(material.uniforms._Faults.value instanceof Float32Array, true);
  assert.equal(material.uniforms._Faults.value.length, 6);
  assert.equal(material.uniforms._Indices.value instanceof Int32Array, true);
  assert.equal(material.uniforms._Indices.value.length, 3);

  updateMegaRuntime([material], { x: 0, y: 0 });
  assert.deepEqual(Array.from(material.uniforms._Faults.value), [0, 0, 0, 0, 0, 0]);
  assert.deepEqual(Array.from(material.uniforms._Indices.value), [0, 0, 0]);
  assert.deepEqual(material.uniforms._Shake.value.toArray(), [0, 0]);
});

test("generic exact runtime material rejects unsupported array element types", () => {
  assert.throws(
    () => fixture({
      _Matrices: {
        type: "mat4[2]",
        source: "pocket-card-render/official-guest-common-value-unresolved@1",
      },
    }),
    /unsupported exact-port dynamic uniform type/,
  );
});

test("runtime updater fails closed for an unregistered producer", () => {
  const { material } = fixture({
    _Value: { type: "float", source: "unregistered-producer" },
  });
  assert.throws(
    () => updateMegaRuntime([material], { x: 0, y: 0 }),
    /unsupported dynamic producer unregistered-producer/,
  );
});
