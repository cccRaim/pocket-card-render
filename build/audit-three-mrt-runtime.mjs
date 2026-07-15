import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const checks = [
  {
    file: "node_modules/three/src/core/RenderTarget.js",
    sha256: "ee5863244822d5824a11460bf65dc8c2cafab5552097eb8a20d1af88f5bf4222",
  },
  {
    file: "node_modules/three/build/three.module.js",
    sha256: "5916c8dfb5f4e3eede312de305345868d4a0a8105383b080c6985565d6e79b46",
  },
];
const issues = [];
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");

const pkg = JSON.parse(read("package.json"));
if (pkg.devDependencies?.three !== "0.165.0") {
  issues.push(`package.json must pin three=0.165.0, got ${pkg.devDependencies?.three}`);
}

for (const check of checks) {
  const absolute = path.join(ROOT, check.file);
  if (!fs.existsSync(absolute)) {
    issues.push(`${check.file} is missing; run npm install`);
    continue;
  }
  const actual = crypto.createHash("sha256").update(fs.readFileSync(absolute)).digest("hex");
  if (actual !== check.sha256) issues.push(`${check.file} SHA-256 ${actual}`);
}

const renderTarget = read(checks[0].file);
for (const snippet of [
  "this.textures = []",
  "const count = options.count",
  "for ( let i = 0; i < count; i ++ )",
]) {
  if (!renderTarget.includes(snippet)) issues.push(`three RenderTarget count contract missing: ${snippet}`);
}
const index = read("public/index.html");
if (!index.includes('"three": "/vendor/three/build/three.module.js"')) {
  issues.push("index.html does not use the locally pinned three module");
}
const server = read("server.mjs");
if (!server.includes('p.startsWith("/vendor/three/")')) {
  issues.push("server.mjs does not expose the pinned three package");
}

if (issues.length) {
  for (const issue of issues) console.error(`BAD ${issue}`);
  process.exit(1);
}
console.log("three r165 MRT runtime audit OK");
console.log("Pinned: three@0.165.0 official npm ESM bundle and RenderTarget source SHA-256");
console.log("Target: count=2 texture allocation contract; local runtime import");
