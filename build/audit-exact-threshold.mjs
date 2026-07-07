// Hard gate for the exact shader layer goal. Exact layers are stricter than
// bytecode-anchored hand ports: the runtime must have an exact official shader
// asset path registered for the visible layer's shader family. This is still
// not a visual fidelity score; renderer color/blend/RT pipeline parity is
// validated separately by screenshots and targeted audits.
import { collectFidelityRows, pct, summarizeRows } from "./report-fidelity.mjs";

const MIN_EXACT = Number(process.env.PCR_MIN_EXACT_SHADER_LAYERS || 0.4);
const rows = collectFidelityRows();
const summary = summarizeRows(rows);
const ratio = summary.total ? summary.exact / summary.total : 0;

if (summary.total <= 0 || ratio < MIN_EXACT) {
  console.error(`Exact shader threshold audit failed: exact ${summary.exact}/${summary.total} (${pct(summary.exact, summary.total)}) below ${(MIN_EXACT * 100).toFixed(1)}%`);
  process.exit(1);
}

console.log(`Exact shader threshold audit OK: exact ${summary.exact}/${summary.total} (${pct(summary.exact, summary.total)})`);
