import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  loadOfficialSample,
  officialSample,
  officialSampleSha256,
  officialSampleLabel,
  officialSampleManifestRelative,
  officialSampleSelectionRelative,
} from "./official-sample.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TEXT_EXTENSIONS = new Set([".js", ".mjs", ".py", ".json", ".md"]);
const SKIP_DIRECTORIES = new Set([
  ".git",
  ".idea",
  "$cache",
  "__pycache__",
  "node_modules",
  "public/game",
]);
const CURRENT_MANIFEST_DIR = "build/official-samples";
const obligations = JSON.parse(
  fs.readFileSync(path.join(ROOT, "build/official-migration-obligations.json"), "utf8"),
);
if (obligations.schemaVersion !== 1 || !Array.isArray(obligations.domains)) {
  throw new Error("unsupported official migration obligations schema");
}

function repositoryTextFiles() {
  const result = spawnSync("git", [
    "ls-files",
    "--cached",
    "--others",
    "--exclude-standard",
    "-z",
  ], {
    cwd: ROOT,
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.status !== 0) {
    throw new Error(`git ls-files failed: ${result.stderr || result.stdout}`);
  }
  return result.stdout
    .split("\0")
    .filter(Boolean)
    .filter((relative) => TEXT_EXTENSIONS.has(path.extname(relative)))
    .filter((relative) => ![...SKIP_DIRECTORIES].some((directory) => (
      relative === directory || relative.startsWith(`${directory}/`)
    )));
}

function matchesFor(source, pattern) {
  return [...source.matchAll(pattern)].map((match) => ({
    value: match[1],
    line: source.slice(0, match.index).split(/\r?\n/).length,
  }));
}

function baseUnityVersion(value) {
  return value.match(/^\d{4}\.\d+\.\d+f\d+/)?.[0] || value;
}

function versionFootprint(sample) {
  const unity = [];
  const game = [];
  for (const relative of repositoryTextFiles()) {
    if (relative.startsWith(`${CURRENT_MANIFEST_DIR}/`)) continue;
    const source = fs.readFileSync(path.join(ROOT, relative), "utf8");
    for (const match of matchesFor(
      source,
      /\b(20\d{2}\.\d+\.\d+f\d+(?:c\d+)?(?:_[0-9a-f]+)?)\b/g,
    )) {
      unity.push({ file: relative, ...match });
    }
    const patterns = [
      /\bPTCGP\s+(\d+\.\d+\.\d+)\b/g,
      /jp\.pokemon\.pokemontcgp_(\d+\.\d+\.\d+)\.apkm/g,
      /["']versionName["']\s*:\s*["'](\d+\.\d+\.\d+)["']/g,
    ];
    for (const pattern of patterns) {
      for (const match of matchesFor(source, pattern)) game.push({ file: relative, ...match });
    }
  }
  const unityConflicts = unity.filter(
    ({ value }) => baseUnityVersion(value) !== sample.unity.serializedVersion,
  );
  const gameConflicts = game.filter(({ value }) => value !== sample.game.versionName);
  return { unity, game, unityConflicts, gameConflicts };
}

function flatten(value, prefix = "", output = new Map()) {
  if (Array.isArray(value) || !value || typeof value !== "object") {
    output.set(prefix, JSON.stringify(value));
    return output;
  }
  for (const [key, child] of Object.entries(value)) {
    if (key === "status" || key === "sampleId") continue;
    flatten(child, prefix ? `${prefix}.${key}` : key, output);
  }
  return output;
}

function changedPaths(before, after) {
  const left = flatten(before);
  const right = flatten(after);
  return [...new Set([...left.keys(), ...right.keys()])]
    .filter((key) => left.get(key) !== right.get(key))
    .sort();
}

function sha256File(relative) {
  return crypto.createHash("sha256").update(fs.readFileSync(path.join(ROOT, relative))).digest("hex");
}

function triggered(trigger, changes) {
  return changes.some((change) => change === trigger
    || change.startsWith(`${trigger}.`)
    || trigger.startsWith(`${change}.`));
}

const candidateArgIndex = process.argv.indexOf("--candidate");
const candidatePath = candidateArgIndex >= 0 ? process.argv[candidateArgIndex + 1] : null;
if (candidateArgIndex >= 0 && !candidatePath) throw new Error("--candidate requires a manifest path");

const footprint = versionFootprint(officialSample);
const report = {
  schemaVersion: 1,
  active: {
    selection: officialSampleSelectionRelative,
    manifest: officialSampleManifestRelative,
    sampleId: officialSample.sampleId,
    sampleManifestSha256: officialSampleSha256,
    label: officialSampleLabel,
  },
  footprint: {
    unityReferences: footprint.unity.length,
    unityFiles: new Set(footprint.unity.map(({ file }) => file)).size,
    gameReferences: footprint.game.length,
    gameFiles: new Set(footprint.game.map(({ file }) => file)).size,
    conflicts: [...footprint.unityConflicts, ...footprint.gameConflicts],
  },
  migration: null,
};

const corpusMatches = sha256File(officialSample.canonicalCorpus.path)
  === officialSample.canonicalCorpus.sha256;
const portContract = JSON.parse(
  fs.readFileSync(path.join(ROOT, "public/shaders/official_program_port_contract.json"), "utf8"),
);
const materialPrograms = officialSample.proofSets.materialPrograms;
const portContractMatches = portContract.provenance?.sampleId === officialSample.sampleId
  && portContract.provenance?.sampleManifestSha256 === officialSampleSha256
  && portContract.inventory?.proofGraphSha256 === materialPrograms.proofGraphSha256
  && portContract.inventory?.portIndexSha256 === materialPrograms.portIndexSha256;
report.bindings = {
  canonicalCorpus: {
    status: corpusMatches ? "clean" : "stale",
    path: officialSample.canonicalCorpus.path,
    expectedSha256: officialSample.canonicalCorpus.sha256,
  },
  migrationObligations: {
    status: obligations.domains.every(({ producers, auditors }) => (
      [...producers, ...auditors].every((relative) => fs.existsSync(path.join(ROOT, relative)))
    )) ? "clean" : "missing",
    domains: obligations.domains.length,
  },
  programPortContract: {
    status: portContractMatches ? "clean" : "stale",
    path: "public/shaders/official_program_port_contract.json",
  },
};

if (candidatePath) {
  const candidate = loadOfficialSample(candidatePath);
  const changes = changedPaths(officialSample, candidate.sample);
  report.migration = {
    candidateManifest: candidate.manifestRelative,
    candidateSampleId: candidate.sample.sampleId,
    changedPaths: changes,
    invalidatedDomains: obligations.domains
      .filter(({ triggers }) => triggers.some((trigger) => triggered(trigger, changes)))
      .map(({ id, action, producers, auditors }) => ({
        id,
        status: "stale",
        action,
        producers,
        auditors,
      })),
  };
}

if (process.argv.includes("--json")) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`Official sample: ${report.active.label}`);
  console.log(`  selection:      ${report.active.selection}`);
  console.log(`  manifest:       ${report.active.manifest}`);
  console.log(`  manifest hash:  ${report.active.sampleManifestSha256}`);
  console.log(`  Unity pins:     ${report.footprint.unityReferences} refs in ${report.footprint.unityFiles} files`);
  console.log(`  game pins:      ${report.footprint.gameReferences} refs in ${report.footprint.gameFiles} files`);
  console.log(`  corpus binding: ${report.bindings.canonicalCorpus.status}`);
  console.log(`  port binding:   ${report.bindings.programPortContract.status}`);
  console.log(`  obligations:    ${report.bindings.migrationObligations.status} (${obligations.domains.length} domains)`);
  if (report.migration) {
    console.log(`Candidate: ${report.migration.candidateSampleId}`);
    for (const change of report.migration.changedPaths) console.log(`  changed: ${change}`);
    for (const domain of report.migration.invalidatedDomains) {
      console.log(`  rebuild ${domain.id}: ${domain.action}`);
    }
  }
}

for (const conflict of report.footprint.conflicts) {
  console.error(`BAD ${conflict.file}:${conflict.line} references conflicting version ${conflict.value}`);
}
if (report.footprint.conflicts.length
  || Object.values(report.bindings).some(({ status }) => status !== "clean")) {
  process.exitCode = 1;
}
