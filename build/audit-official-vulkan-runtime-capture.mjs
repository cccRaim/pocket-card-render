// Optional target-device Vulkan capture audit. With no capture path this checks
// that the portable importer is present and reports the device boundary honestly.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  STATUS,
  importOfficialVulkanCapture,
  stableJson,
} from "./import-official-vulkan-runtime-capture.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_SCENE = path.join(ROOT, "public", "scene.cTR_20_000670_00_IIBUINOBAKKU_UR.json");

function parseArgs(argv) {
  const positional = [];
  let output = null;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--output") {
      output = argv[++index];
      if (!output) throw new Error("--output requires a path");
    } else {
      positional.push(argv[index]);
    }
  }
  return {
    captureDir: positional[0] || process.env.PCR_OFFICIAL_VULKAN_CAPTURE || null,
    scenePath: positional[1] || process.env.PCR_OFFICIAL_VULKAN_SCENE || DEFAULT_SCENE,
    output,
  };
}

function fail(message) {
  throw new Error(message);
}

function signature(scope) {
  return scope.draws.map((draw) => ({
    status: draw.status,
    materials: draw.candidates.map((candidate) => candidate.materialName).sort(),
    shader: draw.runtime.fragment?.sha256,
    indexCount: draw.runtime.indexCount,
  }));
}

try {
  const args = parseArgs(process.argv.slice(2));
  if (!args.captureDir) {
    console.log("official Vulkan runtime capture: not-observed (set PCR_OFFICIAL_VULKAN_CAPTURE or pass <capture-dir> to audit target-device evidence)");
    process.exit(0);
  }
  const report = importOfficialVulkanCapture({ captureDir: args.captureDir, scenePath: args.scenePath });
  const best = report.scopes.find((scope) => scope.ordinal === report.bestScopeOrdinal);
  if (!best) fail("official card RenderPass was not observed");
  if (report.bestSummary.mismatch !== 0) fail(`${report.bestSummary.mismatch} runtime draws mismatch official evidence`);
  if (report.bestSummary.exactProgram !== report.bestSummary.exactProgramExpected) {
    fail(`exact program coverage is ${report.bestSummary.exactProgram}/${report.bestSummary.exactProgramExpected}`);
  }
  if (report.scopes.some((scope) => scope.assignmentSearchTruncated)) {
    fail("one or more assignment searches were truncated");
  }
  if (report.scopes.some((scope) => scope.submissions.length === 0)) {
    fail("one or more matching render-pass scopes were never submitted");
  }
  if (report.capture.captureStarts.length !== 1 || report.capture.successfulPresents < 1) {
    fail("capture does not contain one capture-start and at least one successful present");
  }
  if (report.source.declaredCaptureSchema !== null || report.capture.provenance.status !== "incomplete") {
    fail("legacy capture provenance boundary was not reported honestly");
  }
  if (best.framebufferState?.attachmentCount !== 3) {
    fail(`official card framebuffer has ${best.framebufferState?.attachmentCount ?? "unknown"} attachments instead of two color plus depth`);
  }
  if (best.draws.some((draw) => draw.runtime.pipelineState?.blendAttachments?.length !== 2)) {
    fail("one or more official card pipelines do not expose two color blend attachments");
  }
  const unresolved = best.draws.filter((draw) => draw.status === STATUS.UNRESOLVED);
  const unresolvedShaders = unresolved.map((draw) => [...new Set(draw.candidates.map((candidate) => candidate.shader))]);
  if (unresolved.length !== 4 || unresolved.some((draw) => (
    draw.candidates.length !== 2
    || new Set(draw.candidates.map((candidate) => candidate.shader)).size !== 1
    || !["Card_UR_LensFlare", "Frame-Holo-UR-New"].includes(draw.candidates[0].shader)
  )) || unresolvedShaders.filter(([shader]) => shader === "Card_UR_LensFlare").length !== 2
    || unresolvedShaders.filter(([shader]) => shader === "Frame-Holo-UR-New").length !== 2
  ) {
    fail(`unexpected unresolved runtime draw set: ${JSON.stringify(unresolved.map((draw) => draw.candidates))}`);
  }
  const baseline = stableJson(signature(best));
  for (const scope of report.scopes) {
    if (stableJson(signature(scope)) !== baseline) fail(`matched card scope ${scope.ordinal} disagrees with scope ${best.ordinal}`);
  }
  const sideBack = best.draws.filter((draw) => draw.candidates[0]?.shader === "Side&Back");
  if (sideBack.length !== 2 || sideBack.some((draw) => (
    stableJson(draw.candidates[0].runtimeVariants[0]?.compiledKeywords) !== stableJson(["INSTANCING_ON"])
    || draw.runtime.vertex?.specializationCount !== 1
    || draw.runtime.fragment?.specializationCount !== 1
  ))) {
    fail("captured Side&Back draws did not select the official INSTANCING_ON Vulkan variant with one specialization constant");
  }
  if (args.output) fs.writeFileSync(path.resolve(args.output), `${JSON.stringify(report, null, 2)}\n`);
  console.log(`official Vulkan runtime capture OK: ${report.capture.matchedCardScopes} submitted matching render-pass scopes; ${report.bestSummary.exactProgram}/${report.bestSummary.exactProgramExpected} exact vertex+fragment programs; ${report.bestSummary.exact}/${report.bestSummary.expected} unique draw identities; 2 Frame-Holo and 2 LensFlare identities unresolved; provenance incomplete (legacy capture has no manifest)`);
} catch (error) {
  console.error(`BAD official Vulkan runtime capture: ${error.message}`);
  process.exitCode = 1;
}
