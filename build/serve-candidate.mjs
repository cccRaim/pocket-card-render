#!/usr/bin/env node
import { loadOfficialSample } from "./official-sample.mjs";

const candidate = loadOfficialSample(
  process.env.PCR_OFFICIAL_CANDIDATE_MANIFEST
    || "build/official-samples/candidate.json",
);

if (candidate.sample.status !== "candidate") {
  throw new Error(
    `candidate server requires a candidate manifest, got ${candidate.sample.status}`,
  );
}

process.env.PCR_OFFICIAL_SAMPLE_MANIFEST = candidate.manifestPath;
await import("../server.mjs");
