import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const BUSINESS_ROOT = "D:/DevProjectes/ptcgp-cloudbase/cloud/src/functions/app/ptcgp-masterdata";
const MASTER_ROOT = path.join(BUSINESS_ROOT, "MasterData");
const FACE_ROOT = process.env.PCR_OFFICIAL_FACE_ROOT
  || "D:/DevProjectes/ptcgp-tools-master/masterdata_decoder/.output/decrypted/Common/CardNew/Face";

const EXPECTED = Object.freeze({
  cards: 3305,
  pokemonCards: 3042,
  trainerCards: 263,
  faceDirectories: 3191,
  faceBundleBytes: 1181259080,
  pokemonMasterSha256: "90a141190b0b9dedae410766d0ddb131d2c004d73c9a95d10044d108cfea5e15",
  trainerMasterSha256: "07e02439bf5339edf01809b7d6eca1fcd0a4c90ac2540f37b904f3b1fc0a357a",
  faceBundleInventorySha256: "6df6965bb845027cc95f30577060fbbaf77ca3db59a160dd960fd5c65c987ad4",
  missingIllustrations: 114,
  missingIllustrationsSha256: "850fff6d204d38fe8799f592c417ec24cb03be4a92c02a27b6dc9cd2a59e7ba5",
});

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function readCards(file) {
  const bytes = fs.readFileSync(file);
  return { bytes, rows: JSON.parse(bytes.toString("utf8")) };
}

assert.ok(fs.existsSync(FACE_ROOT), `official Face root is absent: ${FACE_ROOT}`);
const pokemon = readCards(path.join(MASTER_ROOT, "PokemonCard.json"));
const trainer = readCards(path.join(MASTER_ROOT, "TrainerCard.json"));
assert.equal(sha256(pokemon.bytes), EXPECTED.pokemonMasterSha256);
assert.equal(sha256(trainer.bytes), EXPECTED.trainerMasterSha256);
assert.equal(pokemon.rows.length, EXPECTED.pokemonCards);
assert.equal(trainer.rows.length, EXPECTED.trainerCards);

const cards = [...pokemon.rows, ...trainer.rows];
assert.equal(cards.length, EXPECTED.cards);
assert.equal(new Set(cards.map((row) => row.CardID)).size, EXPECTED.cards);
assert.equal(new Set(cards.map((row) => row.IllustrationID)).size, EXPECTED.cards);
const cardByIllustration = new Map(cards.map((row) => [row.IllustrationID, row]));

const directories = fs.readdirSync(FACE_ROOT, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();
assert.equal(directories.length, EXPECTED.faceDirectories);
assert.equal(new Set(directories).size, directories.length);

let faceBundleBytes = 0;
const inventory = [];
const missingLPrefabs = [];
for (const illustrationId of directories) {
  const relative = path.join(illustrationId, "L", "Prefabs", `${illustrationId}_L.prefab_bundles`);
  const absolute = path.join(FACE_ROOT, relative);
  if (!fs.existsSync(absolute)) {
    missingLPrefabs.push(illustrationId);
    continue;
  }
  const bytes = fs.readFileSync(absolute);
  faceBundleBytes += bytes.length;
  inventory.push([illustrationId, bytes.length, sha256(bytes)]);
}
assert.deepEqual(missingLPrefabs, [], "official Face directory lost its canonical L prefab bundle");
assert.equal(inventory.length, EXPECTED.faceDirectories);
assert.equal(faceBundleBytes, EXPECTED.faceBundleBytes);
assert.equal(sha256(JSON.stringify(inventory)), EXPECTED.faceBundleInventorySha256);

const faceSet = new Set(directories);
const missing = cards
  .filter((row) => !faceSet.has(row.IllustrationID))
  .map((row) => [row.CardID, row.IllustrationID, row.SeriesID, row.Rarity]);
const orphans = directories.filter((illustrationId) => !cardByIllustration.has(illustrationId));
assert.equal(missing.length, EXPECTED.missingIllustrations);
assert.equal(sha256(JSON.stringify(missing)), EXPECTED.missingIllustrationsSha256);
assert.ok(missing.every(([, , series]) => series === "B"));
assert.deepEqual(orphans, []);

const coverage = inventory.length / cards.length;
console.log("Official illustration/Face bundle inventory audit OK");
console.log(`  business masterdata:      ${cards.length} unique CardID/IllustrationID pairs`);
console.log(`  official Face L bundles:  ${inventory.length}/${cards.length} (${(coverage * 100).toFixed(4)}%)`);
console.log(`  hash-pinned Face bytes:   ${faceBundleBytes}`);
console.log(`  source-version gap:       ${missing.length} Series B illustrations; 0 orphan bundles`);
console.log("  status: inventory-exact; all-card material-program closure remains incomplete");
