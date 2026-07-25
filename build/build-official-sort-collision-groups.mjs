import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const AUDIT = path.join(ROOT, "build", "audit-official-sort-prefix-collisions.mjs");
const OUTPUT = path.join(ROOT, "public", "render", "official-sort-collision-groups.json");
const CHECK = process.argv.includes("--check") || process.env.PCR_EXACT_CHECK === "1";

const result = spawnSync(process.execPath, [AUDIT, "--json"], {
  cwd: ROOT,
  encoding: "utf8",
  maxBuffer: 16 * 1024 * 1024,
});
if (result.status !== 0) {
  throw new Error(`collision audit failed:\n${result.stderr || result.stdout}`);
}
const source = JSON.parse(result.stdout);
assert.equal(source.summary.groups, 17, "canonical collision group count");
assert.equal(source.summary.collidingDraws, 36, "canonical colliding draw count");

const groups = source.decisions.map((decision) => ({
  groupId: `${decision.cardId}:${decision.pass}:q${decision.queue}`,
  cardId: decision.cardId,
  pass: decision.pass,
  queue: decision.queue,
  runtimeBoundaryClass: decision.runtimeBoundaryClass,
  knownOptimizeTies: decision.knownOptimizeTies,
  members: decision.members.map((member) => ({
    drawId: member.drawId,
    materialName: member.materialName,
    materialSlot: member.materialSlot,
    rendererIdentity: member.rendererIdentity,
    materialIdentity: member.materialIdentity,
    shaderIdentity: member.shaderIdentity,
    meshIdentity: member.meshIdentity,
    serializedLocalKeywordHash: member.serializedLocalKeywordHash,
  })),
}));
assert.equal(new Set(groups.map((group) => group.groupId)).size, groups.length, "collision group IDs must be unique");
assert.equal(groups.reduce((sum, group) => sum + group.members.length, 0), 36, "collision member count");

const output = {
  schema: "pocket-card-render/official-sort-collision-groups@1",
  source: {
    sortableDraws: source.summary.sortableDraws,
    collidingDraws: source.summary.collidingDraws,
    groupDigest: source.summary.groupDigest,
    decisionDigest: source.summary.decisionDigest,
    boundaryClassCounts: source.summary.boundaryClassCounts,
  },
  groups,
};
const serialized = `${JSON.stringify(output, null, 2)}\n`;

if (CHECK) {
  assert.ok(fs.existsSync(OUTPUT), `missing generated collision manifest ${OUTPUT}`);
  assert.equal(fs.readFileSync(OUTPUT, "utf8"), serialized, "generated collision manifest drifted");
  console.log(`official sort collision manifest: ${groups.length} groups / 36 draws verified`);
} else {
  fs.writeFileSync(OUTPUT, serialized, "utf8");
  console.log(`wrote ${OUTPUT}: ${groups.length} groups / 36 draws`);
}
