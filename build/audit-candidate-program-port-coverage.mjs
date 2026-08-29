#!/usr/bin/env node

import { spawnSync } from "node:child_process";

if (process.env.PCR_PROGRAM_PORT_GENERATORS_EXTERNALLY_VERIFIED !== "1") {
  const generatorEnvironment = { ...process.env };
  delete generatorEnvironment.PCR_OFFICIAL_SAMPLE_MANIFEST;
  const result = spawnSync("npm", [
    "run",
    "audit:candidate-program-migration",
    "--silent",
  ], {
    cwd: process.cwd(),
    encoding: "utf8",
    shell: process.platform === "win32",
    windowsHide: true,
    stdio: "inherit",
    env: generatorEnvironment,
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
  process.env.PCR_PROGRAM_PORT_GENERATORS_EXTERNALLY_VERIFIED = "1";
}

process.env.PCR_OFFICIAL_SAMPLE_MANIFEST ||=
  "build/official-samples/ptcgp-1.7.0-unity-6000.0.69f1-candidate.json";
if (!process.argv.includes("--report-current")) process.argv.push("--report-current");

await import("./audit-official-program-port-coverage.mjs");
