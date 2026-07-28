#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  THREE_PERSPECTIVE_ZBUFFER_PRODUCER_SCHEMA,
} from "../public/render/projection-depth.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MANIFESTS = [
  "shadowbox_effect_flow_default_uniforms.json",
  "shadowbox_effect_flow_use_col4_uniforms.json",
  "shadowbox_effect_flow_use_old_noise_uniforms.json",
];

export function auditThreePerspectiveZBuffer() {
  for (const filename of MANIFESTS) {
    const manifest = JSON.parse(fs.readFileSync(
      path.join(ROOT, "public", "shaders", filename),
      "utf8",
    ));
    assert.deepEqual(
      manifest.runtime_contract.dynamic_uniforms._ZBufferParams,
      {
        type: "vec4",
        source: THREE_PERSPECTIVE_ZBUFFER_PRODUCER_SCHEMA,
      },
    );
    const boundary = manifest.runtime_boundaries.find(
      (row) => row.producer === THREE_PERSPECTIVE_ZBUFFER_PRODUCER_SCHEMA,
    );
    assert.equal(boundary?.status, "known-implementation");
    assert.equal(boundary?.scope, "backend-camera-uniform-adaptation");

    const vertex = fs.readFileSync(
      path.join(ROOT, manifest.webgl_sources.vertex),
      "utf8",
    );
    assert.match(vertex, /_ZBufferParams\.z\s*\*\s*_84/);
    assert.match(vertex, /\+\s*_ZBufferParams\.w/);
    assert.match(vertex, /_91\s*\+=\s*_ZOffset/);
    assert.doesNotMatch(vertex, /_ZBufferParams\.[xy]/);
  }
  return {
    status: "pass",
    selectorAdapters: `${MANIFESTS.length}/${MANIFESTS.length}`,
    runtimeRequired: [
      "official guest camera/projection values",
      "target GPU submitted uniform capture",
    ],
  };
}

const report = auditThreePerspectiveZBuffer();
if (process.argv.includes("--json")) console.log(JSON.stringify(report, null, 2));
else {
  console.log(
    `Three perspective ZBuffer adapter audit: PASS (${report.selectorAdapters})`,
  );
  console.log("  runtime boundary: official guest camera/projection + GPU upload");
}
