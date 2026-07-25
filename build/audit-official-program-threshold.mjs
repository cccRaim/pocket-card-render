// Hard regression gate for selector-keyed, source-hash-bound official program
// ports. Complete executable closure is reported but intentionally has no fake
// minimum while the migration starts at zero.
import { spawnSync } from "node:child_process";

const minimum = Number(process.env.PCR_MIN_STAGE_BOUND_OFFICIAL_PROGRAMS || 0.1);
const result = spawnSync(process.execPath, ["build/audit-official-program-port-coverage.mjs", "--json"], {
  encoding: "utf8",
  windowsHide: true,
  maxBuffer: 16 * 1024 * 1024,
  env: { ...process.env, PCR_PROGRAM_PORT_GENERATORS_EXTERNALLY_VERIFIED: "1" },
});
if (result.status !== 0) {
  console.error(`Official program threshold failed: ${result.stderr || result.stdout || result.error || "coverage audit failed"}`);
  process.exit(1);
}
const report = JSON.parse(result.stdout);
const { stageBoundSemanticExecutables: covered, officialSemanticExecutables: total,
  completeExecutableClosures: complete } = report.summary;
const ratio = total ? covered / total : 0;
if (total <= 0 || ratio < minimum) {
  console.error(`Selector-keyed stage-program threshold failed: ${covered}/${total} (${(ratio * 100).toFixed(1)}%) below ${(minimum * 100).toFixed(1)}%`);
  process.exit(1);
}
console.log(`Selector-keyed stage-program threshold OK: ${covered}/${total} (${(ratio * 100).toFixed(1)}%)`);
console.log(`Complete executable closures: ${complete}/${total}; no runtime or visual parity is implied`);
