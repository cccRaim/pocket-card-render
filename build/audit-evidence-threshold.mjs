// Hard gate for project-level official-source implementation evidence.
// This gate must never be presented as a visual or game-fidelity score.
import { collectEvidenceRows, pct, summarizeEvidenceRows } from "./report-renderer-evidence.mjs";

const MIN_OFFICIAL_EVIDENCE = Number(process.env.PCR_MIN_OFFICIAL_EVIDENCE || 0.9);
const rows = collectEvidenceRows();
const summary = summarizeEvidenceRows(rows);
const issues = [];

if (summary.total <= 0) {
  issues.push("no visible reference layers found");
}
if (summary.dispatched !== summary.total) {
  issues.push(`strategy dispatch coverage ${summary.dispatched}/${summary.total} (${pct(summary.dispatched, summary.total)})`);
}
if (summary.anyOfficialEvidence / summary.total < MIN_OFFICIAL_EVIDENCE) {
  issues.push(`official-source evidence coverage ${summary.anyOfficialEvidence}/${summary.total} (${pct(summary.anyOfficialEvidence, summary.total)}) below ${(MIN_OFFICIAL_EVIDENCE * 100).toFixed(1)}%`);
}

if (issues.length) {
  console.error(`Evidence coverage threshold audit failed: ${issues.length} issue(s) found`);
  for (const issue of issues) console.error(`BAD ${issue}`);
  process.exit(1);
}

console.log(`Official-source evidence threshold OK: dispatch ${summary.dispatched}/${summary.total}, evidenced ${summary.anyOfficialEvidence}/${summary.total} (${pct(summary.anyOfficialEvidence, summary.total)}); this is not a fidelity score`);
