#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  loadOfficialSample,
  officialSampleDigest,
} from "./official-sample.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT_ROOT = path.resolve(
  process.env.PCR_CANDIDATE_OUTPUT_ROOT
    || path.join(
      ROOT,
      "..",
      "ptcgp-tools-master",
      "masterdata_decoder",
      ".output-full",
    ),
);
const SPLIT_ROOT = path.resolve(
  process.env.PCR_CANDIDATE_SPLITS
    || path.join(
      ROOT,
      "..",
      "ptcg-apk-parser",
      "apks",
      "apkeep-downloads",
      "jp.pokemon.pokemontcgp",
      "jp.pokemon.pokemontcgp",
    ),
);
const CANDIDATE_POINTER = path.resolve(
  process.env.PCR_OFFICIAL_CANDIDATE_MANIFEST
    || path.join(ROOT, "build", "official-samples", "candidate.json"),
);
const DOMAIN_ORDER = [
  "package-native",
  "unity-runtime",
  "serialized-assets",
  "shader-programs",
  "runtime-evidence",
  "documentation",
];

function sha256File(filename) {
  return crypto
    .createHash("sha256")
    .update(fs.readFileSync(filename))
    .digest("hex");
}

function readJson(filename) {
  return JSON.parse(fs.readFileSync(filename, "utf8").replace(/^\uFEFF/, ""));
}

function existsFile(filename) {
  return fs.statSync(filename, { throwIfNoEntry: false })?.isFile() === true;
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: "utf8",
    shell: process.platform === "win32",
    windowsHide: true,
    env: process.env,
  });
  return {
    ok: result.status === 0,
    command: [command, ...args].join(" "),
    exitCode: result.status,
    output: `${result.stdout || ""}${result.stderr || ""}`.trim(),
  };
}

function check(id, ok, detail, evidence = undefined) {
  return {
    id,
    status: ok ? "pass" : "fail",
    detail,
    ...(evidence === undefined ? {} : { evidence }),
  };
}

function domain(id, checks, remaining, blockedBy = []) {
  const failed = checks.some((item) => item.status !== "pass");
  const status = blockedBy.length > 0
    ? "blocked"
    : failed || remaining.length > 0
      ? "partial"
      : "pass";
  return { id, status, checks, remaining, blockedBy };
}

function unresolvedRoots(sample) {
  const roots = [];
  for (const [name, value] of Object.entries(sample.artifacts)) {
    if (value?.status === "unresolved") roots.push(`artifacts.${name}`);
  }
  for (const name of ["playerBuildVersion", "releaseSupportVersion"]) {
    if (sample.unity[name]?.status === "unresolved") roots.push(`unity.${name}`);
  }
  if (sample.proofSets?.materialPrograms?.status === "unresolved") {
    roots.push("proofSets.materialPrograms");
  }
  if (sample.canonicalCorpus?.status === "unresolved") {
    roots.push("canonicalCorpus");
  }
  return roots;
}

function staticReuseManifestCount(root) {
  if (!fs.statSync(root, { throwIfNoEntry: false })?.isDirectory()) return 0;
  return fs.readdirSync(root)
    .filter((name) => name.endsWith("_uniforms.json"))
    .length;
}

export function auditCandidateMigrationReadiness({
  candidateManifest = CANDIDATE_POINTER,
  deep = false,
} = {}) {
  const loaded = loadOfficialSample(candidateManifest);
  const sample = loaded.sample;
  if (sample.status !== "candidate") {
    throw new Error("candidate readiness requires a status:candidate sample");
  }
  const sampleManifestSha256 = officialSampleDigest(sample);
  const candidateStem = sample.sampleId.replace(/-candidate$/, "");
  const probePath = path.join(OUTPUT_ROOT, "candidate-probe.json");
  const snapshotPath = path.join(OUTPUT_ROOT, "snapshot.json");
  const inventoryPath = path.join(
    OUTPUT_ROOT,
    "material-program-inventory-full.json",
  );
  const migrationPath = path.join(
    ROOT,
    "build",
    "official-samples",
    `${candidateStem}-shader-migration.json`,
  );
  const analysisPath = path.join(
    ROOT,
    "build",
    "official-samples",
    `${candidateStem}-shader-analysis.json`,
  );
  const subcorpusPath = path.join(
    ROOT,
    "build",
    "official-samples",
    `${candidateStem}-changed-route-corpus.json`,
  );
  const staticReuseRoot = path.join(
    OUTPUT_ROOT,
    "webgl-ports",
    "static-reuse",
  );
  const staticReuseScript = path.join(
    ROOT,
    "build",
    "build-candidate-static-port-reuse.mjs",
  );
  const candidateContractPath = path.join(
    ROOT,
    "build",
    "official-samples",
    `${candidateStem}-program-port-contract.json`,
  );
  const staticReuseCount = staticReuseManifestCount(staticReuseRoot);
  const staticReuseIndexPath = path.join(staticReuseRoot, "index.json");
  const metadataPath = path.resolve(
    process.env.PCR_CANDIDATE_METADATA
      || path.join(
        ROOT,
        "..",
        "ptcg-apk-parser",
        "apks",
        "output",
        "global-metadata.dat",
      ),
  );
  const packageCheck = run("python", [
    "-B",
    "build/verify_official_sample_inputs.py",
    "--manifest",
    loaded.selectionPath,
    "--splits",
    SPLIT_ROOT,
    "--metadata-plaintext",
    metadataPath,
  ]);
  const nativeVariant = run(process.execPath, [
    "build/audit-candidate-shader-variant-selection.mjs",
  ]);
  const migrationDiff = run(process.execPath, [
    "build/compare_official_program_inventories.mjs",
    "--check",
  ]);
  const changedPorts = run("npm", [
    "run",
    "audit:candidate-changed-ports",
    "--silent",
  ]);
  const staticReuseIndex = existsFile(staticReuseIndexPath)
    ? readJson(staticReuseIndexPath)
    : null;
  const staticReuseFastBound = Boolean(
    staticReuseCount === 68
    && staticReuseIndex?.schema
      === "pocket-card-render/candidate-static-port-reuse-index@1"
    && staticReuseIndex.candidate?.sampleId === sample.sampleId
    && staticReuseIndex.candidate?.sampleManifestSha256
      === sampleManifestSha256
    && staticReuseIndex.evidence?.candidateInventory?.sha256
      === sample.proofSets.materialPrograms.inventorySha256
    && staticReuseIndex.denominator?.formalStaticReusePorts === 68
    && staticReuseIndex.denominator?.engineOwnedRuntimeBoundaries === 1
    && staticReuseIndex.denominator?.totalFormalCandidatePorts === 78
    && staticReuseIndex.formalPorts?.length === 68
    && staticReuseIndex.formalPorts.every((port) => {
      const filename = path.join(staticReuseRoot, port.manifest);
      return existsFile(filename) && sha256File(filename) === port.manifestSha256;
    }),
  );
  const staticReuseAudit = deep
    && existsFile(staticReuseScript)
    && staticReuseFastBound
    ? run(process.execPath, [
        "build/build-candidate-static-port-reuse.mjs",
        "--check",
      ])
    : {
        ok: staticReuseFastBound,
        command: deep ? null : "index-and-manifest-hash-verification",
        exitCode: staticReuseFastBound ? 0 : null,
      };
  const candidateContractAudit = existsFile(candidateContractPath)
    ? run(process.execPath, [
        "build/build-candidate-program-port-contract.mjs",
        "--check",
      ])
    : { ok: false, command: null, exitCode: null };

  const snapshot = existsFile(snapshotPath) ? readJson(snapshotPath) : null;
  const inventory = existsFile(inventoryPath) ? readJson(inventoryPath) : null;
  const analysis = existsFile(analysisPath) ? readJson(analysisPath) : null;
  const subcorpus = existsFile(subcorpusPath) ? readJson(subcorpusPath) : null;
  const snapshotBound = Boolean(
    snapshot?.complete
    && snapshot.game?.appVersion === sample.game.versionName
    && snapshot.game?.unityVersion === sample.unity.serializedVersion
    && existsFile(probePath)
    && snapshot.evidence?.candidateProbeSha256 === sha256File(probePath)
    && existsFile(inventoryPath)
    && snapshot.evidence?.materialProgramInventorySha256
      === sha256File(inventoryPath),
  );
  const inventoryBound = Boolean(
    inventory?.schema === sample.proofSets.materialPrograms.inventorySchema
    && sha256File(inventoryPath)
      === sample.proofSets.materialPrograms.inventorySha256
    && inventory.digests?.proofGraphSha256
      === sample.proofSets.materialPrograms.proofGraphSha256
    && inventory.digests?.portIndexSha256
      === sample.proofSets.materialPrograms.portIndexSha256,
  );
  const analysisBound = Boolean(
    analysis?.candidateSampleId === sample.sampleId
    && analysis?.candidateInventorySha256
      === sample.proofSets.materialPrograms.inventorySha256
    && analysis?.summary?.changedRoutes === 9
    && analysis?.summary?.staticReuseValidated === 69
    && analysis?.summary?.staticReuseRejected === 1,
  );
  const changedSubcorpusBound = Boolean(
    subcorpus?.candidate?.sampleId === sample.sampleId
    && subcorpus?.candidate?.sampleManifestSha256 === sampleManifestSha256
    && subcorpus?.summary?.selectorObligationCount === 10
    && subcorpus?.summary?.uncoveredSelectorCount === 0
    && subcorpus?.summary?.selectedMissingGameReferenceCount === 0,
  );
  const unresolved = unresolvedRoots(sample);
  const releaseBlockers = unresolved.filter((root) => (
    root === "unity.releaseSupportVersion"
    || root === "artifacts.unityReleasePlayer"
    || root === "artifacts.unityReleaseSymbols"
  ));
  const corpusBlocked = unresolved.includes("canonicalCorpus");

  const domains = [
    domain("package-native", [
      check(
        "split-and-nested-byte-identities",
        packageCheck.ok,
        "base/arm64/bundledtree splits and nested native/Unity entries",
        { command: packageCheck.command, exitCode: packageCheck.exitCode },
      ),
      check(
        "candidate-player-build-identity",
        typeof sample.unity.playerBuildVersion === "string"
          && sample.unity.playerBuildVersion.startsWith(
            `${sample.unity.serializedVersion}_`,
          ),
        "playerBuildVersion extracted from the game libunity.so",
        sample.unity.playerBuildVersion,
      ),
      check(
        "native-shader-variant-selection",
        nativeVariant.ok,
        "candidate ARM64 libunity variant best-match producer",
        { command: nativeVariant.command, exitCode: nativeVariant.exitCode },
      ),
    ], [
      "relocate and byte-verify the remaining native renderer/lifecycle/sort producers",
      "prove encrypted-to-plaintext metadata derivation for the candidate libil2cpp",
    ]),
    domain("unity-runtime", [
      check(
        "game-player-build",
        typeof sample.unity.playerBuildVersion === "string",
        "game player build identity",
      ),
    ], [
      "acquire and hash the matching Unity Android release player",
      "acquire and hash the matching Unity Android release symbols",
      "revalidate Unity 6 engine defaults, TMP/UGUI/RT, lifecycle, and input contracts",
    ], releaseBlockers),
    domain("serialized-assets", [
      check(
        "full-output-snapshot",
        snapshotBound,
        "full asset/masterdata snapshot binds candidate probe and program inventory",
        snapshot?.evidence,
      ),
      check(
        "face-inventory",
        sample.snapshots.faceBundles.missingIllustrations === 0
          && sample.snapshots.faceBundles.count
            === sample.snapshots.masterdata.illustrations,
        "candidate masterdata and canonical Face bundles close the same denominator",
        {
          illustrations: sample.snapshots.masterdata.illustrations,
          faceBundles: sample.snapshots.faceBundles.count,
        },
      ),
    ], [
      "regenerate and bind the complete candidate canonical scene/text/TMP/UGUI/RT corpus",
      "rerun candidate mesh payload and vertex-binding audits",
    ], corpusBlocked ? ["canonicalCorpus"] : []),
    domain("shader-programs", [
      check(
        "material-program-inventory",
        inventoryBound,
        "candidate full Material/program proof graph",
        sample.proofSets.materialPrograms.inventorySha256,
      ),
      check(
        "program-migration-diff",
        migrationDiff.ok && existsFile(migrationPath),
        "baseline-to-candidate route diff is reproducible",
        { command: migrationDiff.command, exitCode: migrationDiff.exitCode },
      ),
      check(
        "program-migration-analysis",
        analysisBound,
        "9 changed, 69 reusable, and 1 default-only rejected route",
        analysis?.summary,
      ),
      check(
        "changed-route-ports-and-subcorpus",
        changedPorts.ok && changedSubcorpusBound,
        "10 changed/default-sensitive selector ports and data-derived witnesses",
        { command: changedPorts.command, exitCode: changedPorts.exitCode },
      ),
      check(
        "static-reuse-candidate-manifests",
        staticReuseCount === 68 && staticReuseAudit.ok,
        "candidate-bound formal manifests for all statically reusable routes",
        {
          expectedFormal: 68,
          engineOwnedRuntimeBoundary: 1,
          actualFormal: staticReuseCount,
          verification: deep ? "deep-reextraction" : "index-and-manifest-hashes",
          command: staticReuseAudit.command,
          exitCode: staticReuseAudit.exitCode,
        },
      ),
      check(
        "candidate-program-port-contract",
        candidateContractAudit.ok,
        "complete 78-port candidate selector contract plus one runtime boundary",
        {
          command: candidateContractAudit.command,
          exitCode: candidateContractAudit.exitCode,
        },
      ),
    ], [
      ...(staticReuseCount === 68 && staticReuseAudit.ok
        ? []
        : ["materialize 68 candidate-bound static-reuse formal port manifests"]),
      ...(candidateContractAudit.ok
        ? []
        : ["build and verify a complete 78-port candidate selector contract plus one engine-owned runtime boundary"]),
      "collect candidate guest dispatch/binding/backend runtime evidence",
    ]),
    domain("runtime-evidence", [], [
      "collect a source-current candidate canonical runtime batch",
      "recapture display, descriptor, uniform, attachment, and vertex bindings",
    ], corpusBlocked ? ["canonicalCorpus"] : []),
    domain("documentation", [
      check(
        "upgrade-guides",
        ["UPGRADING.md", "UPGRADING.zh-CN.md"].every((relative) => (
          fs.readFileSync(path.join(ROOT, relative), "utf8")
            .includes("audit:candidate-changed-ports")
        )),
        "upgrade guides document candidate pointers, strict gate, and changed-port scope",
      ),
    ], []),
  ];
  const ordered = DOMAIN_ORDER.map(
    (id) => domains.find((item) => item.id === id),
  );
  return {
    schema: "pocket-card-render/official-candidate-migration-readiness@1",
    schemaVersion: 1,
    candidate: {
      selection: path.relative(ROOT, loaded.selectionPath).replaceAll("\\", "/"),
      manifest: loaded.manifestRelative,
      sampleId: sample.sampleId,
      sampleManifestSha256,
      gameVersion: sample.game.versionName,
      unityVersion: sample.unity.serializedVersion,
    },
    scope: {
      officialShaderRestorationPercent: null,
      gameFidelity: false,
      runtimeFidelity: false,
      definition: "version-migration obligation readiness, not visual fidelity",
    },
    summary: {
      pass: ordered.filter(({ status }) => status === "pass").length,
      partial: ordered.filter(({ status }) => status === "partial").length,
      blocked: ordered.filter(({ status }) => status === "blocked").length,
      total: ordered.length,
      complete: ordered.every(({ status }) => status === "pass"),
    },
    unresolvedRoots: unresolved,
    domains: ordered,
  };
}

const IS_CLI = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (IS_CLI) {
  const report = auditCandidateMigrationReadiness({
    deep: process.argv.includes("--deep"),
  });
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(
      `Candidate migration readiness: ${report.candidate.sampleId}`,
    );
    for (const item of report.domains) {
      const passedChecks = item.checks.filter(
        ({ status }) => status === "pass",
      ).length;
      console.log(
        `  ${item.id.padEnd(18)} ${item.status.padEnd(7)}`
        + ` checks ${passedChecks}/${item.checks.length}`
        + ` remaining ${item.remaining.length}`,
      );
    }
    console.log(
      `  domains: ${report.summary.pass} pass,`
      + ` ${report.summary.partial} partial,`
      + ` ${report.summary.blocked} blocked`,
    );
    console.log("  official shader restoration: unavailable");
  }
  if (process.argv.includes("--require-complete") && !report.summary.complete) {
    process.exitCode = 1;
  }
}
