import fs from "node:fs";
import path from "node:path";

function addAll(target, values) {
  for (const value of values || []) {
    if (typeof value === "string" && value) target.add(value);
  }
}

export function loadExactPortUsageContracts(root) {
  const byShader = new Map();
  const shaderDir = path.join(root, "public", "shaders");
  for (const file of fs.readdirSync(shaderDir).filter((name) => name.endsWith(".json"))) {
    let manifest;
    try {
      manifest = JSON.parse(fs.readFileSync(path.join(shaderDir, file), "utf8"));
    } catch {
      continue;
    }
    const runtime = manifest.runtime_contract;
    const shader = runtime?.shader_key;
    if (!shader || runtime.require_complete_active_bindings !== true) continue;
    let usage = byShader.get(shader);
    if (!usage) {
      usage = { textures: new Set(), floats: new Set(), colors: new Set(), manifests: [] };
      byShader.set(shader, usage);
    }
    usage.manifests.push(file);
    addAll(usage.textures, Array.isArray(manifest.sampler_slots)
      ? manifest.sampler_slots
      : [manifest.sampler_slots]);
    addAll(usage.floats, runtime.material_uniforms?.floats);
    addAll(usage.floats, runtime.material_uniforms?.ints);
    addAll(usage.colors, Object.keys(runtime.material_uniforms?.vectors || {}));
  }
  return byShader;
}
