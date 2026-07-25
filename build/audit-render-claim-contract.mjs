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

for (const key of [
  "dispatched",
  "transpiledOfficialProgram",
  "partialBytecodeGuards",
  "anyOfficialSourceEvidence",
]) {
  if (!report.implementationEvidence?.[key]?.advancementCost?.class) {
    issues.push(`implementationEvidence.${key} must declare advancement cost`);
  }
}
if (!report.rendererPipelineParity?.advancementCost?.remainingSharedStages?.length) {
  issues.push("renderer pipeline parity must list remaining shared-stage cost");
}
if (report.controlledVisualParity?.advancementCost?.class !== "excluded-by-policy") {
  issues.push("visual parity must remain excluded from automatic audit cost");
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
if (!/"audit:restoration"/.test(packageJson)) {
  issues.push("package scripts must expose the versioned restoration lower-bound audit");
}
const restorationAudit = fs.readFileSync(path.join(ROOT, "build", "audit-renderer-restoration.mjs"), "utf8");
if (!/dimensions\.length !== 10/.test(restorationAudit)
    || !/screenshotPolicy: "No screenshot/.test(restorationAudit)
    || !/status: "runtime-required"/.test(restorationAudit)) {
  issues.push("restoration lower-bound audit must retain its fixed denominator and no-screenshot/runtime-required policy");
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
