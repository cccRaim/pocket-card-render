// Enforce the public meaning of renderer evidence and game-fidelity claims.
// A numeric game-fidelity score is invalid unless both official pipeline
// parity and controlled final-output validation have been established.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildEvidenceReport } from "./report-renderer-evidence.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const report = buildEvidenceReport();
const issues = [];

for (const key of [
  "implementationEvidence",
  "rendererPipelineParity",
  "controlledVisualParity",
  "gameFidelity",
]) {
  if (!report[key]) issues.push(`evidence report is missing ${key}`);
}

const score = report.gameFidelity?.score;
if (score !== null) {
  if (!Number.isFinite(score)) issues.push("gameFidelity.score must be null or a finite number");
  if (report.rendererPipelineParity?.status !== "proven") {
    issues.push("numeric game fidelity requires proven renderer-pipeline parity");
  }
  if (report.controlledVisualParity?.status !== "controlled-final") {
    issues.push("numeric game fidelity requires controlled-final visual parity");
  }
  if (!(report.controlledVisualParity?.officialCaptureCorpus > 0)) {
    issues.push("numeric game fidelity requires a non-empty official capture corpus");
  }
}

const packageJson = fs.readFileSync(path.join(ROOT, "package.json"), "utf8");
if (/report:fidelity|audit:fidelity-threshold/.test(packageJson)) {
  issues.push("package scripts must not label implementation coverage as fidelity");
}

for (const [file, link] of [
  ["README.md", "FIDELITY.md"],
  ["README.zh-CN.md", "FIDELITY.zh-CN.md"],
]) {
  const source = fs.readFileSync(path.join(ROOT, file), "utf8");
  if (!source.includes(link)) issues.push(`${file} must link to ${link}`);
}

if (issues.length) {
  console.error(`Render claim contract failed: ${issues.length} issue(s) found`);
  for (const issue of issues) console.error(`BAD ${issue}`);
  process.exit(1);
}

console.log(`Render claim contract OK: game fidelity score is ${score === null ? "withheld" : score}`);
