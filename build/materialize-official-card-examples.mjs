import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildOfficialCardExamples,
  serializeOfficialCardExamples,
} from "./build-official-card-examples.mjs";
import { atomicWriteFileSync } from "./atomic-publish.mjs";
import { buildScene, sceneFileName } from "./build.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC = path.join(ROOT, "public");
const EXAMPLE_MANIFEST = path.join(PUBLIC, "card-examples.json");
const DEFAULT_DECRYPTED_ROOT =
  "D:/DevProjectes/ptcgp-tools-master/masterdata_decoder/.output/decrypted";
const DECRYPTED_ROOT = path.resolve(
  process.env.PCR_DECRYPTED_ROOT || DEFAULT_DECRYPTED_ROOT,
);
const RECIPE_ROOT = path.resolve(
  process.env.PCR_RECIPES
    || path.join(ROOT, "..", "ptcg-apk-parser", "apks", "output"),
);
const GAME_SRC = path.resolve(
  process.env.PCR_GAME_SRC
    || path.join(ROOT, "..", "ptcg-apk-parser", "apks", "assets"),
);

function parseArgs(argv) {
  const values = {
    dryRun: false,
    forceRecipes: false,
    forceScenes: false,
    gather: false,
    ids: null,
    jobs: Math.max(1, Math.min(4, Math.floor(os.availableParallelism() / 2))),
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dry-run") values.dryRun = true;
    else if (arg === "--force-recipes") values.forceRecipes = true;
    else if (arg === "--force-scenes") values.forceScenes = true;
    else if (arg === "--gather") values.gather = true;
    else if (arg === "--ids") {
      values.ids = new Set(String(argv[++index] || "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean));
      assert(values.ids.size > 0, "--ids requires a comma-separated list");
    } else if (arg === "--jobs") {
      values.jobs = Number(argv[++index]);
      assert(
        Number.isInteger(values.jobs) && values.jobs > 0 && values.jobs <= 16,
        "--jobs must be an integer in [1,16]",
      );
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return values;
}

export function buildMaterializationPlan({
  manifest,
  decryptedRoot = DECRYPTED_ROOT,
  recipeRoot = RECIPE_ROOT,
  publicRoot = PUBLIC,
  gameSourceRoot = GAME_SRC,
  ids = null,
  exists = fs.existsSync,
}) {
  assert.equal(
    manifest?.schema,
    "pocket-card-render/official-card-examples@1",
    "official card-example manifest schema mismatch",
  );
  const primaryWitnesses = manifest.coverageSet?.selectedWitnesses;
  const rarityRenderingWitnesses =
    manifest.rarityRenderingCoverageSet?.additionalWitnesses;
  assert(Array.isArray(primaryWitnesses) && primaryWitnesses.length > 0);
  assert(Array.isArray(rarityRenderingWitnesses));
  const witnesses = [
    ...primaryWitnesses,
    ...rarityRenderingWitnesses,
  ];
  assert.equal(
    new Set(witnesses.map((card) => card.illustrationId)).size,
    witnesses.length,
    "primary and rarity-rendering witnesses overlap",
  );
  const selected = ids
    ? witnesses.filter((card) => ids.has(card.illustrationId))
    : witnesses;
  if (ids) {
    const selectedIds = new Set(selected.map((card) => card.illustrationId));
    const unknown = [...ids].filter((id) => !selectedIds.has(id));
    assert.deepEqual(
      unknown,
      [],
      `--ids contains non-witness cards: ${unknown}`,
    );
  }
  return selected.map((card) => {
    const illustrationId = card.illustrationId;
    const faceRoot = path.join(
      decryptedRoot,
      "Common",
      "CardNew",
      "Face",
      illustrationId,
      "L",
    );
    const recipeFile = path.join(
      recipeRoot,
      `${illustrationId}_render_full.json`,
    );
    const sceneFile = path.join(publicRoot, sceneFileName(illustrationId));
    const prefabGlb = path.join(
      gameSourceRoot,
      "Assets",
      "PrefabHierarchyObject",
      `${illustrationId}_L.glb`,
    );
    return {
      illustrationId,
      faceRoot,
      recipeFile,
      sceneFile,
      prefabGlb,
      faceAvailable: exists(faceRoot),
      recipeAvailable: exists(recipeFile),
      sceneAvailable: exists(sceneFile),
      prefabAvailable: exists(prefabGlb),
    };
  });
}

function runProcess(command, args, { env = process.env } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: ROOT,
      env: { ...env, PYTHONDONTWRITEBYTECODE: "1" },
      windowsHide: true,
      shell: process.platform === "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(
        `${command} exited ${code}\n${stderr || stdout}`,
      ));
    });
  });
}

async function mapPool(rows, jobs, worker) {
  let cursor = 0;
  const results = new Array(rows.length);
  const run = async () => {
    while (cursor < rows.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(rows[index], index);
    }
  };
  await Promise.all(Array.from(
    { length: Math.min(jobs, rows.length) },
    run,
  ));
  return results;
}

async function materializeRecipes(rows, args) {
  const pending = rows.filter(
    (row) => args.forceRecipes || !row.recipeAvailable,
  );
  if (pending.length === 0) return;
  const commonRoot = path.join(DECRYPTED_ROOT, "Common", "CardNew", "Common");
  const shaderRoot = path.join(DECRYPTED_ROOT, "Common", "Shader");
  assert(fs.existsSync(commonRoot), `official shared card root missing: ${commonRoot}`);
  assert(fs.existsSync(shaderRoot), `official shader root missing: ${shaderRoot}`);
  await mapPool(pending, args.jobs, async (row, index) => {
    await runProcess(process.env.PYTHON || "python", [
      "-B",
      "build/dump_recipe.py",
      row.faceRoot,
      "--shared",
      commonRoot,
      "--shared",
      shaderRoot,
      "--out",
      row.recipeFile,
    ]);
    row.recipeAvailable = true;
    row.recipeGenerated = true;
    console.log(
      `[recipe ${index + 1}/${pending.length}] ${row.illustrationId}`,
    );
  });
}

function materializeScenes(rows, args) {
  const pending = rows.filter(
    (row) =>
      args.forceScenes
      || !row.sceneAvailable
      || row.recipeGenerated,
  );
  for (let index = 0; index < pending.length; index += 1) {
    const row = pending[index];
    const scene = buildScene(row.illustrationId, path.basename(row.recipeFile));
    assert.deepEqual(
      scene._missing,
      [],
      `${row.illustrationId} has unresolved exact texture bindings`,
    );
    atomicWriteFileSync(row.sceneFile, `${JSON.stringify(scene, null, 1)}\n`);
    row.sceneAvailable = true;
    console.log(
      `[scene ${index + 1}/${pending.length}] ${row.illustrationId}`,
    );
  }
}

function reportPlan(rows) {
  const count = (field) => rows.filter((row) => row[field]).length;
  console.log("Official minimum example materialization plan");
  console.log(`  witnesses:        ${rows.length}`);
  console.log(`  Face roots:       ${count("faceAvailable")}/${rows.length}`);
  console.log(`  prefab GLBs:      ${count("prefabAvailable")}/${rows.length}`);
  console.log(`  exact recipes:    ${count("recipeAvailable")}/${rows.length}`);
  console.log(`  local scenes:     ${count("sceneAvailable")}/${rows.length}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const manifest = JSON.parse(fs.readFileSync(EXAMPLE_MANIFEST, "utf8"));
  const rows = buildMaterializationPlan({ manifest, ids: args.ids });
  reportPlan(rows);
  assert(
    rows.every((row) => row.faceAvailable),
    "one or more minimum witnesses are absent from the official Face snapshot",
  );
  assert(
    rows.every((row) => row.prefabAvailable),
    "one or more minimum witnesses are absent from the AssetRipper GLB export",
  );
  if (args.dryRun) return;

  await materializeRecipes(rows, args);
  materializeScenes(rows, args);

  const refreshed = buildOfficialCardExamples();
  atomicWriteFileSync(EXAMPLE_MANIFEST, serializeOfficialCardExamples(refreshed));
  if (args.gather) {
    const gathered = await runProcess(process.execPath, [
      "build/gather.mjs",
      GAME_SRC,
    ], {
      env: {
        ...process.env,
        PCR_DECRYPTED_ROOT: DECRYPTED_ROOT,
      },
    });
    if (gathered.stdout.trim()) console.log(gathered.stdout.trim());
    if (gathered.stderr.trim()) console.warn(gathered.stderr.trim());
  }
  console.log(
    args.gather
      ? "All requested minimum examples are materialized and gathered."
      : "Scenes are materialized. Run again with --gather to copy their local game assets.",
  );
}

if (
  process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await main();
}
