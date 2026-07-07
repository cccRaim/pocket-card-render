// Catch optional shader inputs that are disabled by multiplying with zero.
//
// Some WebGL backends still evaluate the unused sampler/math path, and NaN/Inf
// can contaminate the final color even when the gate is 0. Optional env/spec/
// reflection work must be behind an actual branch.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const issues = [];

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function blockFrom(source, marker) {
  const start = source.indexOf(marker);
  if (start < 0) return "";
  const open = source.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  return "";
}

function badPattern(source, rel, re, msg) {
  const matches = [...source.matchAll(re)];
  for (const match of matches) {
    const line = source.slice(0, match.index).split(/\r?\n/).length;
    issues.push(`${rel}:${line} ${msg}`);
  }
}

const sources = {
  "public/render/materials/holo.js": read("public/render/materials/holo.js"),
  "public/render/materials/ur.js": read("public/render/materials/ur.js"),
};

for (const [rel, source] of Object.entries(sources)) {
  badPattern(
    source,
    rel,
    /textureCube\s*\(\s*envCube[\s\S]{0,220}\*\s*uHasEnv\b/g,
    "env cube sampling must be gated by if (uHasEnv > 0.5), not multiplied by uHasEnv",
  );
  badPattern(
    source,
    rel,
    /pow\s*\(\s*max\s*\(\s*texture2D\s*\(\s*specMask[\s\S]{0,260}\*\s*uHasSpec\b/g,
    "fake specular sampling must be gated by if (uHasSpec > 0.5), not multiplied by uHasSpec",
  );
  badPattern(
    source,
    rel,
    /pow\s*\(\s*max\s*\(\s*texture2D\s*\(\s*specMask[\s\S]{0,260}\*\s*step\s*\(\s*0\.5\s*,\s*uFakeSpecEnabled\s*\)/g,
    "fake specular sampling must be gated by if (uFakeSpecEnabled > 0.5), not multiplied by step()",
  );
}

const holo = sources["public/render/materials/holo.js"];
const ur = sources["public/render/materials/ur.js"];
const requiredBranches = [
  ["holo.frameHoloMaterial", blockFrom(holo, "function frameHoloMaterial"), /if\s*\(\s*uHasEnv\s*>\s*0\.5\s*\)/, "must branch around optional env cube"],
  ["holo.frameHoloMaterial", blockFrom(holo, "function frameHoloMaterial"), /if\s*\(\s*uHasSpec\s*>\s*0\.5\s*\)/, "must branch around optional fake spec"],
  ["holo.frameHoloUrMaterial", blockFrom(holo, "function frameHoloUrMaterial"), /if\s*\(\s*uHasEnv\s*>\s*0\.5\s*\)/, "must branch around optional env cube"],
  ["holo.frameHoloUrMaterial", blockFrom(holo, "function frameHoloUrMaterial"), /if\s*\(\s*uFakeSpecEnabled\s*>\s*0\.5\s*\)/, "must branch around optional fake spec"],
  ["holo.exHoloMaterial", blockFrom(holo, "function exHoloMaterial"), /if\s*\(\s*uHasEnv\s*>\s*0\.5\s*\)/, "must branch around optional env cube"],
  ["holo.exHoloUrMaterial", blockFrom(holo, "function exHoloUrMaterial"), /if\s*\(\s*uHasEnv\s*>\s*0\.5\s*\)/, "must branch around optional env cube"],
  ["holo.exHoloUrMaterial", blockFrom(holo, "function exHoloUrMaterial"), /if\s*\(\s*uHasSpec\s*>\s*0\.5\s*\)/, "must branch around optional fake spec"],
  ["holo.sbHoloMaterial", blockFrom(holo, "function sbHoloMaterial"), /if\s*\(\s*uHasEnv\s*>\s*0\.5\s*\)/, "must branch around optional env cube"],
  ["holo.sbHoloMaterial", blockFrom(holo, "function sbHoloMaterial"), /if\s*\(\s*uHasSpec\s*>\s*0\.5\s*\)/, "must branch around optional fake spec"],
  ["holo.sbHoloMaterial", blockFrom(holo, "function sbHoloMaterial"), /if\s*\(\s*uHasRefl\s*>\s*0\.5\s*\)/, "must branch around optional reflection"],
  ["ur.plateMaterial", blockFrom(ur, "function plateMaterial"), /if\s*\(\s*uHasEnv\s*>\s*0\.5\s*\)/, "must branch around optional env cube"],
  ["ur.plateMaterial", blockFrom(ur, "function plateMaterial"), /if\s*\(\s*uHasSpec\s*>\s*0\.5\s*\)/, "must branch around optional fake spec"],
];

for (const [name, block, re, msg] of requiredBranches) {
  if (!block) {
    issues.push(`${name} block not found`);
  } else if (!re.test(block)) {
    issues.push(`${name} ${msg}`);
  }
}

if (issues.length) {
  console.error(`Shader gating audit failed: ${issues.length} issue(s) found`);
  for (const issue of issues) console.error(`BAD ${issue}`);
  process.exit(1);
}

console.log("Shader gating audit OK");
