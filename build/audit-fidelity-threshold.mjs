// Hard gate for project-level official-shader evidence coverage.
// This is not a visual fidelity score: every visible reference layer must
// dispatch, and at least 90% of visible layers must have an exact official
// shader path or an official bytecode-anchored strategy audit.
import { collectFidelityRows, pct, summarizeRows } from "./report-fidelity.mjs";

const MIN_BYTE_GUARD = Number(process.env.PCR_MIN_BYTE_GUARD || 0.9);
const rows = collectFidelityRows();
const summary = summarizeRows(rows);
const issues = [];

if (summary.total <= 0) {
  issues.push("no visible reference layers found");
}
if (summary.dispatched !== summary.total) {
  issues.push(`strategy dispatch coverage ${summary.dispatched}/${summary.total} (${pct(summary.dispatched, summary.total)})`);
}
if (summary.anyByteGuarded / summary.total < MIN_BYTE_GUARD) {
  issues.push(`official byte/exact guard coverage ${summary.anyByteGuarded}/${summary.total} (${pct(summary.anyByteGuarded, summary.total)}) below ${(MIN_BYTE_GUARD * 100).toFixed(1)}%`);
}

if (issues.length) {
  console.error(`Evidence coverage threshold audit failed: ${issues.length} issue(s) found`);
  for (const issue of issues) console.error(`BAD ${issue}`);
  process.exit(1);
}

console.log(`Evidence coverage threshold audit OK: dispatch ${summary.dispatched}/${summary.total}, official byte/exact guard ${summary.anyByteGuarded}/${summary.total} (${pct(summary.anyByteGuarded, summary.total)})`);
