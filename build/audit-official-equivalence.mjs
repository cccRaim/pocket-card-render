// End-to-end audit of evidence derived from official game data and shader bytecode.
//
// This intentionally performs no screenshot or image comparison. It reports
// implementation/source equivalence coverage and never turns that coverage
// into a final visual-fidelity percentage.
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildEvidenceReport, pct, summarizeEvidenceRows } from "./report-renderer-evidence.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const jsonMode = process.argv.includes("--json");
const evidence = buildEvidenceReport();
const summary = summarizeEvidenceRows(evidence.rows);

const audit = spawnSync(process.execPath, ["build/audit-all.mjs"], {
  cwd: ROOT,
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024,
});

const staticStatus = audit.status === 0 ? "pass" : "fail";
const result = {
  definitionVersion: evidence.definitionVersion,
  scope: {
    kind: "official-source-data-bytecode-and-runtime-wiring",
    referenceScenes: evidence.scope.referenceScenes,
    visibleLayers: summary.total,
  },
  officialEvidenceAudit: {
    status: staticStatus,
    dispatched: { layers: summary.dispatched, total: summary.total },
    transpiledOfficialProgram: { layers: summary.transpiledProgram, total: summary.total },
    partialBytecodeGuards: { layers: summary.partialByteGuarded, total: summary.total },
    anyOfficialSourceEvidence: { layers: summary.anyOfficialEvidence, total: summary.total },
  },
  rendererPipelineParity: evidence.rendererPipelineParity,
  visualParity: {
    status: "not-evaluated",
    reason: "Automatic auditing intentionally excludes screenshots and image-derived thresholds.",
  },
  gameFidelity: {
    score: null,
    status: "not-claimable",
    reason: "Official-source evidence coverage is not final visual fidelity.",
  },
};

if (staticStatus === "fail") {
  result.officialEvidenceAudit.output = `${audit.stdout || ""}\n${audit.stderr || ""}`.trim();
}

if (jsonMode) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log("Official renderer equivalence audit (no screenshots, no aggregate fidelity score)");
  console.log(`reference scenes:     ${result.scope.referenceScenes.length}`);
  console.log(`visible layers:       ${summary.total}`);
  console.log(`audit matrix:         ${staticStatus}`);
  console.log(`strategy dispatched:  ${summary.dispatched}/${summary.total} (${pct(summary.dispatched, summary.total)})`);
  console.log(`official programs:    ${summary.transpiledProgram}/${summary.total} (${pct(summary.transpiledProgram, summary.total)})`);
  console.log(`partial byte guards:  ${summary.partialByteGuarded}/${summary.total} (${pct(summary.partialByteGuarded, summary.total)})`);
  console.log(`official evidence:    ${summary.anyOfficialEvidence}/${summary.total} (${pct(summary.anyOfficialEvidence, summary.total)})`);
  console.log(`pipeline parity:      ${result.rendererPipelineParity.status}`);
  console.log(`visual parity:        ${result.visualParity.status}`);
  console.log("game fidelity score:  NOT CLAIMABLE");
  if (staticStatus === "fail") {
    console.log("");
    console.log(result.officialEvidenceAudit.output);
  }
}

if (audit.status !== 0) process.exitCode = 1;
