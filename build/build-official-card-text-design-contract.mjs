import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  officialSample,
  officialSampleSha256,
} from "./official-sample.mjs";
import { assertNoUnicodeReplacement } from "./unicode-contract.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT = path.join(
  ROOT,
  "public",
  "render",
  "card-text-design-contract.json",
);
const check = process.argv.includes("--check")
  || process.env.PCR_CARD_TEXT_DESIGN_CHECK === "1";

function pythonCommand() {
  if (process.env.PYTHON) {
    return {
      executable: process.env.PYTHON,
      shell: process.platform === "win32"
        && /\.(?:bat|cmd)$/iu.test(process.env.PYTHON),
    };
  }
  if (process.platform !== "win32") {
    return { executable: "python", shell: false };
  }
  try {
    const executable = execFileSync(
      "cmd.exe",
      ["/d", "/s", "/c", "pyenv which python"],
      { cwd: ROOT, encoding: "utf8" },
    ).trim();
    if (executable && /\.exe$/iu.test(executable)) {
      return { executable, shell: false };
    }
  } catch {
    // A non-pyenv installation can still be selected through the Python shim.
  }
  return { executable: "python", shell: true };
}

const python = pythonCommand();
const extractedText = execFileSync(
  python.executable,
  ["-B", "build/extract_official_card_text_design_contract.py"],
  {
    cwd: ROOT,
    encoding: "utf8",
    shell: python.shell,
    env: {
      ...process.env,
      PYTHONDONTWRITEBYTECODE: "1",
      PYTHONIOENCODING: "utf-8",
      PYTHONUTF8: "1",
    },
    maxBuffer: 64 * 1024 * 1024,
  },
);
assertNoUnicodeReplacement(extractedText, "card text design extractor output");
const extracted = JSON.parse(extractedText);

assert.equal(
  extracted.schema,
  "pocket-card-render/card-text-design-contract@1",
);
assert.equal(extracted.schemaVersion, 1);
assert.equal(extracted.sampleId, officialSample.sampleId);
assert.equal(extracted.sampleManifestSha256, officialSampleSha256);
assert.equal(
  extracted.unityVersion,
  officialSample.unity.serializedVersion,
);
assert.deepEqual(extracted.summary, {
  masterdataIllustrationCount: officialSample.snapshots.masterdata.illustrations,
  cardSettingsCount: officialSample.snapshots.faceBundles.count,
  missingIllustrationCount:
    officialSample.snapshots.faceBundles.missingIllustrations,
  designSettingsCount: 98,
  referencedDesignSettingsCount: 89,
  fontConditionCount: 12,
  fontGroupCount: 12,
  selectedFontGroupCount: 10,
  internalRarityCount: 11,
  masterdataRarityCount: 11,
  unresolvedCardDesignCount: 0,
  unresolvedFontConditionCount: 0,
  unresolvedDynamicUICount: 0,
});
assert.equal(
  Object.keys(extracted.cards).length,
  extracted.summary.cardSettingsCount,
);
assert.equal(
  Object.keys(extracted.designs).length,
  extracted.summary.designSettingsCount,
);
assert.equal(
  Object.keys(extracted.fontConditions).length,
  extracted.summary.fontConditionCount,
);
assert.equal(
  Object.keys(extracted.fontGroups).length,
  extracted.summary.fontGroupCount,
);
for (const fontGroup of Object.values(extracted.fontGroups)) {
  assert(
    [1, 2, 3, 4].includes(fontGroup.imgTagFontType),
    `${fontGroup.name} has an invalid ImgTagFontType`,
  );
}
assert.deepEqual(
  Object.keys(extracted.counts.cardsByMasterdataRarity).map(Number),
  [100, 200, 300, 400, 500, 600, 700, 800, 830, 860, 900],
);
assert.deepEqual(
  Object.fromEntries(
    Object.entries(extracted.nativeProducers).map(([key, producer]) => [
      key,
      [producer.startRva, producer.endRva, producer.byteSize, producer.sha256],
    ]),
  ),
  {
    fontGroupSelection: [
      "0x4448838",
      "0x4448928",
      240,
      "799d93755ea6ad879250b437ad62d6776634e1644ca099548389949cc68ad648",
    ],
    dynamicUIControllerApply: [
      "0x441eea0",
      "0x441ef58",
      184,
      "b13ff59db86f766dba9da9f0af9aae091fd923d2c50d57bff383090c7b5e5936",
    ],
    dynamicUILabelDispatch: [
      "0x441ef60",
      "0x441f290",
      816,
      "e8fcd8943bff6bb69e882c201507460482790db6b13e21b50a1f767b6eb62a54",
    ],
  },
);

for (const [illustrationId, card] of Object.entries(extracted.cards)) {
  assert.equal(card.design, extracted.designs[card.design].name);
  assert.equal(
    card.fontCondition,
    extracted.designs[card.design].fontCondition,
  );
  assert(extracted.fontGroups[card.fontGroup], `${illustrationId} font missing`);
  assert.match(card.cardSettingsObjectSha256, /^[0-9a-f]{64}$/u);
  assert(!/^[A-Za-z]:[\\/]/u.test(card.cardSettingsBundle.source));
}
for (const design of Object.values(extracted.designs)) {
  assert(extracted.fontConditions[design.fontCondition]);
  for (const dynamicUI of design.dynamicUIs) {
    assert(dynamicUI.label);
    assert(dynamicUI.controller.path.startsWith("/"));
    assert(dynamicUI.controller.name);
    if (dynamicUI.target) {
      assert(dynamicUI.target.path.startsWith("/"));
      assert.equal(
        dynamicUI.target.path.slice(0, dynamicUI.target.path.lastIndexOf("/")),
        dynamicUI.controller.path,
      );
      assert(dynamicUI.target.name);
    }
  }
}

const serialized = `${JSON.stringify(extracted, null, 1)}\n`;
assertNoUnicodeReplacement(serialized, "card text design contract");
if (check) {
  assert.equal(
    fs.readFileSync(OUTPUT, "utf8"),
    serialized,
    "card text design contract is stale",
  );
  console.log("Official card text design contract audit OK");
} else {
  fs.writeFileSync(OUTPUT, serialized);
  console.log(`wrote ${path.relative(ROOT, OUTPUT)}`);
}
console.log([
  `${extracted.summary.cardSettingsCount} CardSettings`,
  `${extracted.summary.referencedDesignSettingsCount}/`
    + `${extracted.summary.designSettingsCount} referenced CardDesignSettings`,
  `${extracted.summary.fontConditionCount} FontGroupConditions`,
  `${extracted.summary.selectedFontGroupCount} selected FontGroups`,
  `${extracted.summary.masterdataRarityCount} masterdata rarity classes`,
  "0 unresolved joins",
].join(", "));
