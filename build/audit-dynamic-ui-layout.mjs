// Audit DynamicUI layout fields that must come from the official UI prefab,
// not from visual tuning in the canvas renderer.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const localesDir = path.join(ROOT, "public", "locales");

const issues = [];

for (const file of fs.readdirSync(localesDir).filter((f) => /^card_face\..+\.json$/.test(f)).sort()) {
  const full = path.join(localesDir, file);
  const json = JSON.parse(fs.readFileSync(full, "utf8"));
  for (const [i, el] of (json.elements || []).entries()) {
    if (!el.exAfter) continue;
    for (const key of ["exH", "exAnchorX", "exMaxW"]) {
      if (typeof el[key] !== "number" || !Number.isFinite(el[key]) || el[key] <= 0) {
        issues.push(`${file}: elements[${i}] exAfter is missing numeric ${key}`);
      }
    }
  }
}

const compose = fs.readFileSync(path.join(ROOT, "build", "compose.mjs"), "utf8");
if (!/const\s+nameElm\s*=\s*node\("name_elm"\)/.test(compose)) {
  issues.push("build/compose.mjs: Pokemon ex layout must derive exAnchorX from name_elm");
}
if (!/exAnchorX\s*=\s*nameElm\?\.box\?\.l\s*\?\?\s*name\.box\.l/.test(compose)) {
  issues.push("build/compose.mjs: dynamic Pokemon compose must emit exAnchorX with name box fallback");
}
if (!/exMaxW\s*=\s*300\s*\/\s*CW/.test(compose)) {
  issues.push("build/compose.mjs: dynamic Pokemon compose must emit the official 300px _textMaxWidthForEx");
}

const app = fs.readFileSync(path.join(ROOT, "public", "app.js"), "utf8");
if (!/\(e\.exAnchorX\s*\?\?\s*b\.l\)\s*\*\s*W\s*\+\s*Math\.min\(nw,\s*maxW\)/.test(app)) {
  issues.push("public/app.js: ex glyph placement must use exAnchorX before measured-name clamp");
}
if (/fs\s*\*\s*0\.06/.test(app)) {
  issues.push("public/app.js: ex glyph placement still contains the old visual gap tune");
}

if (issues.length) {
  console.error(`DynamicUI layout audit failed: ${issues.length} issue(s) found`);
  for (const issue of issues) console.error(`BAD ${issue}`);
  process.exit(1);
}

console.log("DynamicUI layout audit OK");
