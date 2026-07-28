import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  buildOfficialDrawIdentityIndex,
  resolveOfficialDrawIdentity,
} from "../public/render/official-draw-identity.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scene = JSON.parse(fs.readFileSync(
  path.join(
    ROOT,
    "public",
    "scene.cPK_20_007480_00_MASSIVOONex_SR.json",
  ),
  "utf8",
));
const index = buildOfficialDrawIdentityIndex(scene.officialDraws);
const marble = scene.officialDraws.find(
  (draw) => draw.materialName === "Layer_Marble_D",
);

test("official draw identity resolves an exact node/material pair", () => {
  const result = resolveOfficialDrawIdentity(
    index,
    marble.goPath,
    marble.materialName,
  );
  assert.equal(result.draw, marble);
  assert.equal(result.resolution, "exact-node-material");
  assert.deepEqual(result.candidateIds, []);
});

test("one serialized Material draw survives AssetRipper node-path drift", () => {
  const result = resolveOfficialDrawIdentity(
    index,
    `AssetRipperFlattened/${marble.go}`,
    marble.materialName,
  );
  assert.equal(result.draw, marble);
  assert.equal(result.resolution, "unique-material-candidate");
  assert.deepEqual(result.candidateIds, []);
});

test("same-name multiple draws remain unresolved without an exact path", () => {
  const materialName = "L_Raremark_Star_a";
  const candidates = scene.officialDraws.filter(
    (draw) => draw.materialName === materialName,
  );
  assert.ok(candidates.length > 1);
  const result = resolveOfficialDrawIdentity(
    index,
    "AssetRipperFlattened/L_UI_RareMark_Star_a",
    materialName,
  );
  assert.equal(result.draw, null);
  assert.equal(result.resolution, "unresolved");
  assert.deepEqual(
    [...result.candidateIds].sort(),
    candidates.map((draw) => draw.drawId).sort(),
  );
});

test("duplicate exact draw identities and malformed inputs fail closed", () => {
  const duplicateIndex = buildOfficialDrawIdentityIndex([
    marble,
    { ...marble, drawId: `${marble.drawId}:duplicate` },
  ]);
  assert.throws(
    () => resolveOfficialDrawIdentity(
      duplicateIndex,
      marble.goPath,
      marble.materialName,
    ),
    /multiple official draw identities/,
  );
  assert.throws(() => buildOfficialDrawIdentityIndex({}));
  assert.throws(() => buildOfficialDrawIdentityIndex([{ ...marble, goPath: "" }]));
  assert.throws(() => resolveOfficialDrawIdentity(index, "", marble.materialName));
});
