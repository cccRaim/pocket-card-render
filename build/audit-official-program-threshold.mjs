// Hard gate for transpiled official shader-program coverage. This proves that
// a translated program asset is wired, not that WebGL output matches the game.
import { collectEvidenceRows, pct, summarizeEvidenceRows } from "./report-renderer-evidence.mjs";

const MIN_TRANSPILED = Number(process.env.PCR_MIN_TRANSPILED_OFFICIAL_PROGRAMS || 0.4);
const rows = collectEvidenceRows();
const summary = summarizeEvidenceRows(rows);
const ratio = summary.total ? summary.transpiledProgram / summary.total : 0;

if (summary.total <= 0 || ratio < MIN_TRANSPILED) {
  console.error(`Transpiled official-program threshold failed: ${summary.transpiledProgram}/${summary.total} (${pct(summary.transpiledProgram, summary.total)}) below ${(MIN_TRANSPILED * 100).toFixed(1)}%`);
  process.exit(1);
}

console.log(`Transpiled official-program threshold OK: ${summary.transpiledProgram}/${summary.total} (${pct(summary.transpiledProgram, summary.total)}); this is not runtime or visual parity`);
