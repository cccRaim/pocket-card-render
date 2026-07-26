import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalizeWebglObjectClipPosition,
  enforceWebglPositionInvariance,
  manifestUsesStandardObjectClipPosition,
  prepareWebglVertexSource,
  WEBGL_POSITION_INVARIANCE_SCHEMA,
} from "../public/render/webgl-position-invariance.js";

test("position invariance is inserted before shader declarations", () => {
  const source = "precision highp float;\nvoid main(){ gl_Position = vec4(0.0); }\n";
  const result = enforceWebglPositionInvariance(source);
  assert.equal(WEBGL_POSITION_INVARIANCE_SCHEMA, "pocket-card-render/webgl-position-invariance@2");
  assert.match(result, /^invariant gl_Position;\nprecision highp float;/);
  assert.equal(enforceWebglPositionInvariance(result), result);
});

test("position invariance preserves a GLSL version directive at the beginning", () => {
  const source = "#version 300 es\nprecision highp float;\nvoid main(){ gl_Position = vec4(0.0); }\n";
  assert.match(
    enforceWebglPositionInvariance(source),
    /^#version 300 es\ninvariant gl_Position;\nprecision highp float;/,
  );
});

test("position invariance fails closed on malformed or late declarations", () => {
  assert.throws(
    () => enforceWebglPositionInvariance("void main(){}"),
    /does not write gl_Position/,
  );
  assert.throws(
    () => enforceWebglPositionInvariance(
      "void main(){ gl_Position = vec4(0.0); }\ninvariant gl_Position;",
    ),
    /before its first use/,
  );
  assert.throws(
    () => enforceWebglPositionInvariance(
      "invariant gl_Position;\ninvariant gl_Position;\nvoid main(){ gl_Position = vec4(0.0); }",
    ),
    /more than once/,
  );
});

test("runtime preparation only adds the declared invariance contract", () => {
  const source = "void main(){ gl_Position = vec4(0.0); }";
  const prepared = prepareWebglVertexSource(source);
  assert.equal(prepared.policy, WEBGL_POSITION_INVARIANCE_SCHEMA);
  assert.equal(prepared.canonicalObjectClipPosition, false);
  assert.equal(prepared.source, `invariant gl_Position;\n${source}`);
});

test("manifest-proven standard object transforms receive one canonical final position write", () => {
  const source = [
    "uniform highp mat4 modelMatrix;",
    "uniform highp mat4 viewMatrix;",
    "uniform highp mat4 projectionMatrix;",
    "in vec3 position;",
    "void main(){",
    "  gl_Position = vec4(0.0);",
    "}",
  ].join("\n");
  const manifest = {
    runtime_contract: {
      attributes: { position: "vec3" },
      engine_uniforms: {
        modelMatrix: "mat4",
        viewMatrix: "mat4",
        projectionMatrix: "mat4",
      },
    },
    webgl_adaptation: {
      vertex: { operations: [{ kind: "engine-uniform-binding" }] },
    },
  };
  assert.equal(manifestUsesStandardObjectClipPosition(manifest), true);
  const prepared = prepareWebglVertexSource(source, {
    manifest,
    canonicalizeObjectClipPosition: true,
  });
  assert.equal(prepared.canonicalObjectClipPosition, true);
  assert.match(
    prepared.source,
    /gl_Position = projectionMatrix \* viewMatrix \* modelMatrix \* vec4\(position, 1\.0\);\n}/,
  );
});

test("view-depth-offset programs and undeclared stage sources are not canonicalized", () => {
  const formal = {
    runtime_contract: {
      attributes: { position: "vec3" },
      engine_uniforms: {
        modelMatrix: "mat4",
        viewMatrix: "mat4",
        projectionMatrix: "mat4",
      },
    },
    webgl_adaptation: {
      vertex: {
        operations: [
          { kind: "engine-uniform-binding" },
          { kind: "view-depth-offset" },
        ],
      },
    },
  };
  assert.equal(manifestUsesStandardObjectClipPosition(formal), false);
  assert.equal(manifestUsesStandardObjectClipPosition({
    runtime_contract: {
      schema: "pocket-card-render/stage-source-runtime-contract@1",
      stage_source_only: true,
    },
  }), false);
});

test("canonical position injection rejects incomplete standard inputs", () => {
  assert.throws(
    () => canonicalizeWebglObjectClipPosition(
      "uniform highp mat4 modelMatrix; void main(){gl_Position=vec4(0.0);}",
    ),
    /missing/,
  );
});
