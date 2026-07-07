// Verify Color/Vector fallback constants used by material strategies against
// official ShaderLab defaults. Values are compared component-wise; Vector3
// fallbacks intentionally compare the xyz prefix of Unity Vector defaults.
import { execSync } from "node:child_process";
import { SHADER } from "../public/render/rarities.js";

const shaderRoot = process.env.PCR_SHADERS
  || "D:/DevProjectes/ptcgp-tools-master/masterdata_decoder/.output/decrypted/Common/Shader";

const FALLBACKS = {
  "Card_Parallax_Hologram_Tuning": {
    _Rotation: [0, 0, 0],
  },
  "Frame-Holo-Tuning": {
    _Rotation: [0, 0, 0],
  },
  "Card_Hologram_Tuning": {
    _Rotation: [0, 0, 0],
  },
  "Transparent_Hologram_Tuning": {
    _Rotation: [0, 0, 0],
  },
  "Simple-Opaque-Hologram_Tuning": {
    _Rotation: [0, 0, 0],
  },
  "Opaque-Hologram_Tuning": {
    _Rotation: [0, 0, 0],
  },
  "Opaque_Hologram_Tuning": {
    _Rotation: [0, 0, 0],
  },
  "Card_Parallax_Hologram_UR_New": {
    _FakeSpecularColor: [0, 0, 0],
    _DarknessColor: [0, 0, 0],
    _Rotation: [0, 0, 0],
  },
  "Transparent-UR-New": {
    _FakeSpecularColor: [0, 0, 0],
    _DarknessColor: [0, 0, 0],
    _Rotation: [0, 0, 0],
  },
  "Frame-Holo-UR-New": {
    _FakeSpecularColor: [0, 0, 0],
    _DarknessColor: [0, 0, 0],
    _EmissiveColor: [1, 1, 1, 1],
    _Rotation: [0, 0, 0],
  },
  "Frame-2Layer-UR": {
    _FakeSpecularColor: [0, 0, 0],
    _FakeSpecularColor2: [0, 0, 0],
    _DarknessColor1: [0, 0, 0],
    _DarknessColor2: [0, 0, 0],
    _EmissiveColor: [1, 1, 1, 1],
    _Rotation: [0, 0, 0],
  },
  "Opaque-UR-Oklab": {
    _OutlineColor: [0, 0, 0],
    _ReflectionColor: [0, 0, 0],
    _FakeSpecularColor: [0, 0, 0],
    _FakeSpecularColor_Outline: [0, 0, 0],
    _DarknessColor: [0, 0, 0],
    _EmissiveColor: [1, 1, 1, 1],
    _Rotation: [0, 0, 0],
  },
  "Card_UR_Plate": {
    _FakeSpecularColor: [0, 0, 0],
    _DarknessColor: [0, 0, 0],
  },
  "Card_Parallax_UR": {
    _DarknessColor: [0, 0, 0],
  },
  "Card_Parallax_Metal": {
    _Rotation: [0, 0, 0],
  },
  "Card_UR_LensFlare": {
    _BaseColor: [1, 1, 1, 1],
    _EmissiveColor: [1, 1, 1, 1],
  },
  "Card_UR_Glitter_FlowMaps": {
    _LightColor: [1, 1, 1],
  },
};

const shaderNames = [...new Set([...Object.keys(SHADER), ...Object.keys(FALLBACKS)])].sort();

let official;
try {
  const stdout = execSync("python build/extract-shader-defaults.py", {
    input: JSON.stringify({ root: shaderRoot, shaders: shaderNames }),
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
    stdio: ["pipe", "pipe", "inherit"],
  });
  official = JSON.parse(stdout);
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

const EPS = 1e-6;
const rows = [];
for (const [shader, fallbacks] of Object.entries(FALLBACKS)) {
  const officialValues = {
    ...(official.found[shader]?.colors || {}),
    ...(official.found[shader]?.vectors || {}),
  };
  for (const [name, local] of Object.entries(fallbacks)) {
    const officialValue = officialValues[name];
    const ok = Array.isArray(officialValue)
      && local.every((value, i) => Math.abs(value - officialValue[i]) <= EPS);
    rows.push({
      ok,
      shader,
      name,
      local,
      official: officialValue ?? "(missing)",
    });
  }
}

for (const row of rows.sort((a, b) => a.shader.localeCompare(b.shader) || a.name.localeCompare(b.name))) {
  const mark = row.ok ? "OK " : "BAD";
  console.log(`${mark} ${row.shader.padEnd(35)} ${row.name.padEnd(28)} local=${JSON.stringify(row.local).padEnd(15)} official=${JSON.stringify(row.official)}`);
}

const bad = rows.filter((row) => !row.ok);
if (bad.length) {
  console.error(`\n${bad.length} shader color/vector default issue(s) found.`);
  process.exitCode = 1;
}
