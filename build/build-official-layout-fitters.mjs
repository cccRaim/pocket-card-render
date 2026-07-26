import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT = path.join(ROOT, "public", "render", "official-layout-fitters.json");
const check = process.argv.includes("--check");
const extracted = JSON.parse(execFileSync(
  process.env.PYTHON || "python",
  ["-B", "build/extract_official_layout_fitters.py"],
  {
    cwd: ROOT,
    encoding: "utf8",
    shell: process.platform === "win32",
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
    maxBuffer: 32 * 1024 * 1024,
  },
));

assert.equal(extracted.schemaVersion, 1);
assert.equal(extracted.contractId, "pocket-card-render/official-layout-fitters@1");
assert.deepEqual(extracted.sample, {
  sampleId: "ptcgp-1.6.0-unity-2022.3.62f2",
  sampleManifestSha256: "2515cae195ee58f06c32f5d0c7d063c6b7a1f03b5743696e2181786d074d4b4d",
  gameVersion: "1.6.0",
  unityVersion: "2022.3.62f2",
  architecture: "arm64-v8a",
  libil2cppSha256: "3e78eedc62770fff4cb129b4b8d898950e131b710b3c099237fe20d2d34ca48e",
});
assert.deepEqual(extracted.sources, {
  cardUiLayoutContract: {
    logicalPath: "public/render/card-ui-layout-contract.json",
    byteLength: 1638675,
    sha256: "26783bf6ef2d82f6057c677f42dc65288f29e6a6b6423eb41a4587ec1e9c0a6b",
  },
  monoScripts: {
    logicalPath: "UnityMonoScripts",
    cab: "CAB-1e36700dd93ee778e75c5e8df73b6de5",
    byteLength: 68427,
    sha256: "d513fb4b5098fa79f430ed3b0811f12e62210e669f9e4fdb70a4665558554a01",
  },
});
assert.deepEqual(extracted.observed, {
  componentCount: 84,
  componentTypeCounts: {
    AspectRatioFitter: 51,
    ContentSizeFitter: 5,
    HorizontalLayoutGroup: 20,
    VerticalLayoutGroup: 8,
  },
  contentSizeFitPairs: { "2,0": 5 },
  aspectModes: { 1: 4, 2: 47 },
  aspectEnabledValues: { 0: 51 },
  layoutGroupReverseArrangementValues: { 0: 28 },
});
assert.deepEqual(
  extracted.prefabs.map((prefab) => [
    prefab.kind,
    prefab.logicalPath,
    prefab.byteLength,
    prefab.sha256,
    prefab.components.length,
  ]),
  [
    [
      "pokemon",
      "Common/CardNew/System/Prefabs/PokemonCardUI.prefab_bundles",
      85874,
      "405a783ca9f7fb58f6c6f55aaa37d6d018b7e83f22c1f5b14bfe09ecc0fb2c05",
      59,
    ],
    [
      "trainer",
      "Common/CardNew/System/Prefabs/TrainersCardUI.prefab_bundles",
      54692,
      "33b3af9be400cf2b6aed6696e2b9eb8d4a78f8cbe41ca3d80a12d2cb6d9fb484",
      25,
    ],
  ],
);
assert.equal(extracted.nativeProducerBoundaries.length, 5);
assert.ok(extracted.nativeProducerBoundaries.every(
  (boundary) => boundary.status === "native-runtime-required",
));

const serialized = `${JSON.stringify(extracted, null, 1)}\n`;
assert.doesNotMatch(serialized, /[A-Z]:[\\/](?:Users|DevProjectes)[\\/]/i);
if (check) {
  assert.equal(
    fs.readFileSync(OUTPUT, "utf8"),
    serialized,
    "official layout fitter contract is stale",
  );
  console.log("Official layout fitter serialized contract audit OK");
} else {
  fs.writeFileSync(OUTPUT, serialized);
  console.log(`wrote ${path.relative(ROOT, OUTPUT)}`);
}
console.log(
  `  ${extracted.observed.componentCount} components: `
  + `${extracted.observed.componentTypeCounts.HorizontalLayoutGroup} horizontal, `
  + `${extracted.observed.componentTypeCounts.VerticalLayoutGroup} vertical, `
  + `${extracted.observed.componentTypeCounts.ContentSizeFitter} content-size, `
  + `${extracted.observed.componentTypeCounts.AspectRatioFitter} aspect-ratio`,
);
