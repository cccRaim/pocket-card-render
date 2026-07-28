// Guard renderer strategies against reusing fields that official shader bytecode does not read.
// This is intentionally targeted: field names are often shared across shader families, so we check
// the specific strategy block or guard pattern instead of grepping the whole renderer.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

function blockFrom(source, marker) {
  const start = source.indexOf(marker);
  if (start < 0) return null;
  const open = source.indexOf("{", start);
  if (open < 0) return null;
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  return null;
}

const holo = read("public/render/materials/holo.js");
const ur = read("public/render/materials/ur.js");
const rows = [];

function check(ok, shader, field, reason) {
  rows.push({ ok, shader, field, reason });
}

const sbHolo = blockFrom(holo, "function sbHoloMaterial");
check(!!sbHolo, "sbHolo", "", "strategy block exists");
if (sbHolo) {
  check(
    /const primaryDiffInt = mode === "trainer" \? 1 : \(f\._DiffractionIntensity \?\? 0\.5\);/.test(sbHolo),
    "Opaque-Hologram_Tuning",
    "_DiffractionIntensity",
    "official-dead field is guarded to constant 1 for this shader",
  );
  check(
    /uDiffInt:\s*\{\s*value:\s*primaryDiffInt\s*\}/.test(sbHolo),
    "Opaque-Hologram_Tuning",
    "_DiffractionIntensity",
    "primary diffraction uniform uses the guarded value",
  );
  check(
    !/f\._DarknessEnabled/.test(sbHolo),
    "Opaque-UR-Oklab",
    "_DarknessEnabled",
    "official-dead darkness enable is not read by sbHolo strategy",
  );
}

const urBgHolo = blockFrom(ur, "function urBgHoloMaterial");
check(!!urBgHolo, "Card_Parallax_Hologram_UR_New", "", "strategy block exists");
if (urBgHolo) {
  for (const field of ["_DarknessEnabled", "_FakeSpecularEnabled"]) {
    check(
      !urBgHolo.includes(field),
      "Card_Parallax_Hologram_UR_New",
      field,
      "official-dead enable field is not read by urBgHolo strategy",
    );
  }
}

const metal = blockFrom(ur, 'defineMaterial("metal"');
check(!!metal, "Card_Parallax_Metal", "", "strategy block exists");
if (metal) {
  check(!metal.includes("_UseUv2"), "Card_Parallax_Metal", "_UseUv2", "official-dead uv selector is not read by metal strategy");
}

const flare = blockFrom(ur, 'defineMaterial("flare"');
check(!!flare, "Card_UR_LensFlare", "", "strategy block exists");
if (flare) {
  check(!flare.includes("_Offset"), "Card_UR_LensFlare", "_Offset", "official-dead offset field is not read by flare strategy");
}

for (const row of rows) {
  const mark = row.ok ? "OK " : "BAD";
  console.log(`${mark} ${row.shader.padEnd(35)} ${row.field.padEnd(28)} ${row.reason}`);
}

const bad = rows.filter((row) => !row.ok);
if (bad.length) {
  console.error(`\n${bad.length} official-dead strategy field issue(s) found.`);
  process.exitCode = 1;
}
