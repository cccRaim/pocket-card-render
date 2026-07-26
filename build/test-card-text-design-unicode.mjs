import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { assertNoUnicodeReplacement } from "./unicode-contract.mjs";
import {
  resolveOfficialImgTagFontType,
} from "../public/render/official-img-tag-font-type.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MASTER_ROOT = process.env.PCR_MASTERDATA
  || "D:/DevProjectes/ptcgp-cloudbase/cloud/src/functions/app/ptcgp-masterdata/MasterData";
const contract = JSON.parse(fs.readFileSync(
  path.join(ROOT, "public", "render", "card-text-design-contract.json"),
  "utf8",
));
const masterdata = [
  ...JSON.parse(fs.readFileSync(path.join(MASTER_ROOT, "PokemonCard.json"), "utf8")),
  ...JSON.parse(fs.readFileSync(path.join(MASTER_ROOT, "TrainerCard.json"), "utf8")),
];

assertNoUnicodeReplacement(contract, "card text design contract");
assert.throws(
  () => assertNoUnicodeReplacement({ illustrationId: "BROKEN_\uFFFD" }, "mutation"),
  /contains U\+FFFD/u,
);

const expected = new Set(masterdata.map((card) => card.IllustrationID));
const actual = new Set([
  ...Object.keys(contract.cards),
  ...contract.missingIllustrations,
]);
assert.equal(expected.size, 3305);
assert.equal(actual.size, expected.size, "card contract ID set has duplicates or omissions");
assert.deepEqual(
  [...actual].sort(),
  [...expected].sort(),
  "card contract IllustrationID set does not equal authoritative masterdata",
);
assert.equal(Object.keys(contract.cards).length, 3191);
assert.equal(contract.missingIllustrations.length, 114);

assert.deepEqual(
  [1, 2, 3, 4].map((value) => resolveOfficialImgTagFontType(value)),
  ["Black", "White", "BlackWithWhiteOutline", "ExBlack"],
);
for (const invalid of [undefined, null, 0, 5, "Black"]) {
  assert.throws(
    () => resolveOfficialImgTagFontType(invalid, "mutation"),
    /official FontGroupSettings mutation has invalid ImgTagFontType/u,
  );
}

for (const illustrationId of [
  "cPK_10_001660_00_NIDORAN♀_C",
  "cPK_10_001690_00_NIDORAN♂_C",
  "cPK_90_018860_00_ZYGARDE10％FORME_C",
]) {
  assert(expected.has(illustrationId), `test witness ${illustrationId} left masterdata`);
  assert(actual.has(illustrationId), `Unicode witness ${illustrationId} is absent`);
}

console.log("card text design Unicode/set-equivalence mutation gate: OK");
