import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  compileWebglRuntimePortContract,
  parseWebglRuntimeUniformType,
  WEBGL_RUNTIME_PORT_SCHEMA,
} from "./webgl-runtime-port-contract.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function fixture() {
  return {
    schema: WEBGL_RUNTIME_PORT_SCHEMA,
    shader_key: "Fixture",
    attributes: { position: "vec3", uv: "vec2" },
    engine_uniforms: { modelViewMatrix: "mat4", projectionMatrix: "mat4" },
    material_uniforms: { floats: ["_Amount"], ints: [], vectors: {} },
    require_complete_active_bindings: true,
    camera_from_view: false,
    mrt_attachments: 2,
    stencil_normalization: "disable-when-always-keep",
    stencil_face_mode: "generic",
    backend_texture_defaults: { _MainTex: "shaderlab-white" },
  };
}

const samplerBindings = [{
  slot: "_MainTex",
  spirvName: "_13",
  binding: 0,
  dimension: 2,
  glslType: "sampler2D",
}];

test("runtime contract normalizes a declarative port without shader-specific identity", () => {
  const compiled = compileWebglRuntimePortContract(fixture(), { samplerBindings });
  assert.equal(compiled.shader_key, "Fixture");
  assert.equal(compiled.backend_texture_defaults._MainTex, "shaderlab-white");
  assert.equal(compiled.stencil_normalization, "disable-when-always-keep");
});

test("runtime contract rejects silent schema and binding drift", () => {
  assert.throws(
    () => compileWebglRuntimePortContract({ ...fixture(), confidence: "high" }, { samplerBindings }),
    /unknown field confidence/,
  );
  assert.throws(
    () => compileWebglRuntimePortContract({
      ...fixture(),
      material_uniforms: { floats: ["_Amount"], ints: ["_Amount"], vectors: {} },
    }, { samplerBindings }),
    /overlap/,
  );
  assert.throws(
    () => compileWebglRuntimePortContract({
      ...fixture(),
      backend_texture_defaults: { _Other: "shaderlab-white" },
    }, { samplerBindings }),
    /not an active sampler slot/,
  );
});

test("all formal selector ports compile through the version-independent runtime schema", () => {
  const contract = JSON.parse(fs.readFileSync(
    path.join(ROOT, "public", "shaders", "official_program_port_contract.json"),
    "utf8",
  ));
  assert.equal(contract.ports.length, 41);
  for (const port of contract.ports) {
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, port.manifest), "utf8"));
    const compiled = compileWebglRuntimePortContract(manifest.runtime_contract, {
      samplerBindings: manifest.sampler_bindings,
    });
    assert.equal(compiled.schema, WEBGL_RUNTIME_PORT_SCHEMA, port.manifest);
  }
});

test("dynamic uniform array types preserve their WebGL base type and active size", () => {
  assert.deepEqual(parseWebglRuntimeUniformType("float[20]"), {
    type: "float[20]",
    baseType: "float",
    size: 20,
  });
  assert.deepEqual(parseWebglRuntimeUniformType("vec4[2]"), {
    type: "vec4[2]",
    baseType: "vec4",
    size: 2,
  });
  assert.throws(() => parseWebglRuntimeUniformType("sampler2D[2]"), /unsupported type/);
});
