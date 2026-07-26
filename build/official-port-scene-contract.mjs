import fs from "node:fs";
import path from "node:path";
import { bindOfficialPassDefaults } from "../public/render/context.js";

function sortedStrings(value) {
  return [...(Array.isArray(value) ? value : [])].map(String).sort();
}

function sameStrings(left, right) {
  return JSON.stringify(sortedStrings(left)) === JSON.stringify(sortedStrings(right));
}

export function loadOfficialPortSceneIndex(root) {
  const contractPath = path.join(root, "public", "shaders", "official_program_port_contract.json");
  const contract = JSON.parse(fs.readFileSync(contractPath, "utf8"));
  const entries = contract.ports.map((port) => {
    const manifestPath = path.join(root, port.manifest);
    const manifest = bindOfficialPassDefaults(JSON.parse(fs.readFileSync(manifestPath, "utf8")));
    const selector = manifest.official_selector;
    if (!selector
        || selector.selectorId !== port.selectorId
        || selector.candidateWitnessId !== port.candidateWitnessId
        || selector.subshader !== port.subshader
        || selector.pass !== port.pass) {
      throw new Error(`${port.manifest}: contract/manifest selector identity drifted`);
    }
    return Object.freeze({ port, manifest, manifestPath });
  });
  return Object.freeze(entries);
}

export function matchingOfficialPortManifests(index, recipe) {
  const shaderIdentity = recipe?.official?.shader;
  if (!shaderIdentity) return [];
  const matches = index.filter(({ manifest }) => (
    manifest.runtime_contract?.shader_key === recipe.shader
    && manifest.official_selector?.shaderIdentity === shaderIdentity
    && sameStrings(manifest.official_selector?.keywords, recipe.official?.validKeywords)
  ));
  if (!matches.length) return [];

  const groups = new Map();
  for (const entry of matches) {
    const selector = entry.manifest.official_selector;
    const key = [
      selector.selectorId,
      selector.subshader,
      selector.selectionMode,
    ].join("|");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(entry);
  }
  if (groups.size !== 1) {
    throw new Error(`${recipe.shader}: recipe resolves to ${groups.size} selector groups`);
  }

  const selected = [...groups.values()][0]
    .sort((a, b) => a.manifest.official_selector.pass - b.manifest.official_selector.pass);
  const mode = selected[0].manifest.official_selector.selectionMode;
  if (mode === "ordered-multipass-structure") {
    selected.forEach((entry, index_) => {
      if (entry.manifest.official_selector.pass !== index_) {
        throw new Error(`${recipe.shader}: ordered pass sequence is not contiguous at ${index_}`);
      }
    });
  } else if (selected.length !== 1) {
    throw new Error(`${recipe.shader}: non-multipass selector resolved ${selected.length} manifests`);
  }
  return selected;
}
