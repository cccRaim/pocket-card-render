#!/usr/bin/env python3
"""Extract and triage changed official shader routes across sample versions."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess

from extract_official_selector_program import (
    SelectorProgramExtractionSession,
    encode_metadata,
)
from official_sample import load_official_sample


ROOT = Path(__file__).resolve().parents[1]


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        while chunk := source.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def canonical_digest(value: object) -> str:
    encoded = json.dumps(
        value, ensure_ascii=True, separators=(",", ":"), sort_keys=True
    ).encode("ascii")
    return sha256_bytes(encoded)


def run(command: list[str]) -> bytes:
    result = subprocess.run(
        command, check=False, capture_output=True
    )
    if result.returncode != 0:
        raise RuntimeError(
            f"{command[0]} failed: "
            + (result.stderr or result.stdout).decode("utf-8", errors="replace")
        )
    return result.stdout


def safe_prefix(index: int, shader_name: str, keywords: list[str]) -> str:
    shader = re.sub(r"[^A-Za-z0-9]+", "-", shader_name).strip("-").lower()
    keyword = re.sub(
        r"[^A-Za-z0-9]+", "-", "-".join(keywords)
    ).strip("-").lower()
    suffix = f"-{keyword}" if keyword else ""
    return f"{index:02d}-{shader}{suffix}"[:180]


def normalized_buffer_name(name: str) -> str:
    return re.sub(r"(PGlobals|VGlobals)\d+$", r"\1", name)


def reflection_buffers(reflection: dict) -> dict:
    result = {}
    for buffer in reflection.get("constantBuffers", []):
        result[normalized_buffer_name(buffer["name"])] = {
            "size": buffer["size"],
            "fields": {
                field["name"]: {
                    "offset": field["offset"],
                    "descriptor": field["descriptor"],
                }
                for field in buffer.get("fields", [])
            },
        }
    return result


def property_defaults(defaults: dict) -> dict:
    result = {}
    for kind in (
        "floats",
        "vectors",
        "colors",
        "textures",
        "textureDescriptors",
    ):
        for name, value in defaults.get(kind, {}).items():
            result[f"{kind}.{name}"] = value
    return result


def structured_delta(baseline: dict, candidate: dict) -> dict:
    before_buffers = reflection_buffers(baseline["parameterReflection"])
    after_buffers = reflection_buffers(candidate["parameterReflection"])
    buffer_changes = []
    for name in sorted(set(before_buffers) | set(after_buffers)):
        before = before_buffers.get(name)
        after = after_buffers.get(name)
        if before is None or after is None:
            buffer_changes.append({
                "name": name,
                "status": "added" if before is None else "removed",
            })
            continue
        before_fields = before["fields"]
        after_fields = after["fields"]
        added = sorted(set(after_fields) - set(before_fields))
        removed = sorted(set(before_fields) - set(after_fields))
        moved = [
            {
                "name": field,
                "before": before_fields[field]["offset"],
                "after": after_fields[field]["offset"],
            }
            for field in sorted(set(before_fields) & set(after_fields))
            if before_fields[field]["offset"] != after_fields[field]["offset"]
        ]
        if before["size"] != after["size"] or added or removed or moved:
            buffer_changes.append({
                "name": name,
                "size": {"before": before["size"], "after": after["size"]},
                "addedFields": added,
                "removedFields": removed,
                "movedFields": moved,
            })

    before_properties = property_defaults(baseline["shaderPropertyDefaults"])
    after_properties = property_defaults(candidate["shaderPropertyDefaults"])
    return {
        "constantBuffers": buffer_changes,
        "addedShaderProperties": [
            {"name": name, "value": after_properties[name]}
            for name in sorted(set(after_properties) - set(before_properties))
        ],
        "removedShaderProperties": [
            {"name": name, "value": before_properties[name]}
            for name in sorted(set(before_properties) - set(after_properties))
        ],
        "changedShaderProperties": [
            {
                "name": name,
                "before": before_properties[name],
                "after": after_properties[name],
            }
            for name in sorted(set(before_properties) & set(after_properties))
            if before_properties[name] != after_properties[name]
        ],
    }


def structured_contract_matches(
    baseline_metadata: dict, candidate_metadata: dict
) -> dict[str, bool]:
    baseline_channels = baseline_metadata["programBindChannels"]
    candidate_channels = candidate_metadata["programBindChannels"]
    parameter_same = (
        baseline_metadata.get("_parameterReflectionSha256")
        == candidate_metadata["parameterReflectionSha256"]
        if "_parameterReflectionSha256" in baseline_metadata
        else baseline_metadata["parameterReflection"]
        == candidate_metadata["parameterReflection"]
    )
    common_same = (
        baseline_metadata.get("_commonBindingsSha256")
        == candidate_metadata["identityFields"]["commonBindingsSha256"]
        if "_commonBindingsSha256" in baseline_metadata
        else baseline_metadata["commonBindings"]
        == candidate_metadata["commonBindings"]
    )
    return {
        "parameterReflectionSame": parameter_same,
        "commonBindingsSame": common_same,
        "programBindChannelsSame": (
            baseline_channels == candidate_channels
        ),
        "programBindChannelListSame": (
            baseline_channels["serializedSourceMap"]
            == candidate_channels["serializedSourceMap"]
            and baseline_channels["bindChannels"]
            == candidate_channels["bindChannels"]
        ),
        "shaderPropertyDefaultsSame": (
            baseline_metadata["shaderPropertyDefaults"]
            == candidate_metadata["shaderPropertyDefaults"]
        ),
    }


def extract_route(
    session: SelectorProgramExtractionSession,
    route: dict,
    out: Path,
    prefix: str,
) -> dict:
    metadata = session.extract(
        selector_id=route["selectorId"],
        candidate_witness_id=route["candidateWitnessId"],
        out=out,
        prefix=prefix,
        subshader=route["subshader"],
        pass_index=route["pass"],
    )
    (out / f"{prefix}_metadata.json").write_text(
        encode_metadata(metadata), encoding="ascii", newline="\n"
    )
    return metadata


def baseline_manifest_metadata(
    contract: dict,
    route: dict,
) -> tuple[dict, str]:
    matches = [
        port
        for port in contract["ports"]
        if (
            port["selectorId"] == route["selectorId"]
            and port["candidateWitnessId"] == route["candidateWitnessId"]
            and port["subshader"] == route["subshader"]
            and port["pass"] == route["pass"]
        )
    ]
    if len(matches) != 1:
        raise RuntimeError(
            "baseline formal port lookup resolved to "
            f"{len(matches)} rows"
        )
    port = matches[0]
    manifest_path = (ROOT / port["manifest"]).resolve()
    if ROOT not in manifest_path.parents:
        raise RuntimeError("baseline formal port manifest escapes repository")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if (
        manifest.get("official_selector", {}).get("selectorId")
        != route["selectorId"]
        or manifest.get("official_selector", {}).get("candidateWitnessId")
        != route["candidateWitnessId"]
        or manifest.get("official_executable_identity")
        != port["officialIdentityFields"]
    ):
        raise RuntimeError("baseline formal port manifest identity changed")
    parameter = dict(manifest["official_parameter_entry"])
    for key in ("source_sha256", "byte_size", "reflection_sha256"):
        parameter.pop(key)
    common = dict(manifest["official_common_bindings"])
    common.pop("source_sha256")
    vertex_inputs = manifest["official_vertex_inputs"]
    bind_channels = [
        {
            "index": index,
            "source": row["source"],
            "sourceName": row["sourceName"],
            "target": row["target"],
            "targetName": row["targetName"],
        }
        for index, row in enumerate(vertex_inputs["inputs"])
    ]
    return {
        "parameterReflection": parameter,
        "_parameterReflectionSha256": manifest[
            "official_parameter_entry"
        ]["reflection_sha256"],
        "commonBindings": common,
        "_commonBindingsSha256": manifest[
            "official_common_bindings"
        ]["source_sha256"],
        "programBindChannels": {
            "serializedSourceMap": vertex_inputs["serializedSourceMap"],
            "bindChannels": bind_channels,
            "sha256": vertex_inputs["sourceSha256"],
            "evidenceScope": "formal-port-manifest-projection",
        },
        "shaderPropertyDefaults": manifest[
            "official_shader_property_defaults"
        ],
    }, port["manifest"]


def stage_analysis(
    baseline_spv: Path,
    candidate_spv: Path,
    work: Path,
    prefix: str,
    stage: str,
    spirv_opt: str,
    spirv_cross: str,
) -> dict:
    baseline_opt = work / f"{prefix}_{stage}_baseline.opt.spv"
    candidate_opt = work / f"{prefix}_{stage}_candidate.opt.spv"
    for source, target in (
        (baseline_spv, baseline_opt),
        (candidate_spv, candidate_opt),
    ):
        run([
            spirv_opt,
            "--strip-debug",
            "--strip-reflect",
            "--compact-ids",
            str(source),
            "-o",
            str(target),
        ])
    baseline_glsl = run([
        spirv_cross, str(baseline_spv), "--version", "300", "--es"
    ])
    candidate_glsl = run([
        spirv_cross, str(candidate_spv), "--version", "300", "--es"
    ])
    baseline_reflection = json.loads(
        run([spirv_cross, str(baseline_spv), "--reflect"])
    )
    candidate_reflection = json.loads(
        run([spirv_cross, str(candidate_spv), "--reflect"])
    )
    baseline_main = baseline_glsl.partition(b"void main()")[2]
    candidate_main = candidate_glsl.partition(b"void main()")[2]
    if not baseline_main or not candidate_main:
        raise RuntimeError("SPIRV-Cross output has no main function")
    (work / f"{prefix}_{stage}_baseline.glsl").write_bytes(baseline_glsl)
    (work / f"{prefix}_{stage}_candidate.glsl").write_bytes(candidate_glsl)
    (work / f"{prefix}_{stage}_baseline.reflect.json").write_text(
        json.dumps(baseline_reflection, ensure_ascii=True, indent=2) + "\n",
        encoding="utf-8",
        newline="\n",
    )
    (work / f"{prefix}_{stage}_candidate.reflect.json").write_text(
        json.dumps(candidate_reflection, ensure_ascii=True, indent=2) + "\n",
        encoding="utf-8",
        newline="\n",
    )
    return {
        "rawSame": sha256_file(baseline_spv) == sha256_file(candidate_spv),
        "optimizedSame": sha256_file(baseline_opt) == sha256_file(candidate_opt),
        "spirvCrossGlslSame": baseline_glsl == candidate_glsl,
        "mainBodySame": baseline_main == candidate_main,
        "reflectionSame": baseline_reflection == candidate_reflection,
        "baseline": {
            "rawSha256": sha256_file(baseline_spv),
            "optimizedSha256": sha256_file(baseline_opt),
            "spirvCrossGlslSha256": sha256_bytes(baseline_glsl),
            "reflectionSha256": canonical_digest(baseline_reflection),
        },
        "candidate": {
            "rawSha256": sha256_file(candidate_spv),
            "optimizedSha256": sha256_file(candidate_opt),
            "spirvCrossGlslSha256": sha256_bytes(candidate_glsl),
            "reflectionSha256": canonical_digest(candidate_reflection),
        },
    }


def main() -> None:
    output_root = Path(
        os.environ.get(
            "PCR_CANDIDATE_OUTPUT_ROOT",
            ROOT.parent
            / "ptcgp-tools-master"
            / "masterdata_decoder"
            / ".output-full",
        )
    ).resolve()
    baseline_manifest = ROOT / "build" / "official-samples" / "current.json"
    candidate_manifest = Path(
        os.environ.get(
            "PCR_OFFICIAL_CANDIDATE_MANIFEST",
            ROOT / "build" / "official-samples" / "candidate.json",
        )
    ).resolve()
    baseline_default = load_official_sample(baseline_manifest)["sample"]
    candidate_default = load_official_sample(candidate_manifest)["sample"]
    candidate_stem = candidate_default["sampleId"].removesuffix("-candidate")
    samples_root = Path(
        os.environ.get(
            "PCR_OFFICIAL_SAMPLES_ROOT",
            output_root / "samples",
        )
    ).resolve()

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--migration-report",
        type=Path,
        default=ROOT / "build" / "official-samples"
        / f"{candidate_stem}-shader-migration.json",
    )
    parser.add_argument(
        "--baseline-inventory",
        type=Path,
        default=samples_root / baseline_default["sampleId"]
        / "material-program-inventory-full.json",
    )
    parser.add_argument(
        "--candidate-inventory",
        type=Path,
        default=output_root / "material-program-inventory-full.json",
    )
    parser.add_argument(
        "--baseline-manifest",
        type=Path,
        default=baseline_manifest,
    )
    parser.add_argument(
        "--candidate-manifest",
        type=Path,
        default=candidate_manifest,
    )
    parser.add_argument(
        "--baseline-decrypted-root",
        type=Path,
        default=samples_root / baseline_default["sampleId"] / "decrypted-full",
    )
    parser.add_argument(
        "--candidate-decrypted-root",
        type=Path,
        default=output_root / "decrypted",
    )
    parser.add_argument(
        "--baseline-port-contract",
        type=Path,
        default=ROOT / "public" / "shaders"
        / "official_program_port_contract.json",
    )
    parser.add_argument(
        "--out",
        type=Path,
        default=output_root / "program-migration-analysis-fresh",
    )
    parser.add_argument(
        "--report-out",
        type=Path,
        default=ROOT / "build" / "official-samples"
        / f"{candidate_stem}-shader-analysis.json",
    )
    parser.add_argument("--spirv-opt", default="spirv-opt")
    parser.add_argument("--spirv-cross", default="spirv-cross")
    args = parser.parse_args()

    migration = json.loads(
        args.migration_report.read_text(encoding="utf-8")
    )
    if migration.get("schema") != (
        "pocket-card-render/official-program-migration-diff@1"
    ):
        raise ValueError("unsupported migration report")
    baseline_loaded = load_official_sample(args.baseline_manifest)
    candidate_loaded = load_official_sample(args.candidate_manifest)
    baseline_sample = baseline_loaded["sample"]
    candidate_sample = candidate_loaded["sample"]
    if migration["baseline"]["sampleId"] != baseline_sample["sampleId"]:
        raise ValueError("migration report baseline sample changed")
    if migration["candidate"]["sampleId"] != candidate_sample["sampleId"]:
        raise ValueError("migration report candidate sample changed")
    if sha256_file(args.baseline_inventory) != migration["baseline"]["inventorySha256"]:
        raise ValueError("baseline inventory hash changed")
    if sha256_file(args.candidate_inventory) != migration["candidate"]["inventorySha256"]:
        raise ValueError("candidate inventory hash changed")

    baseline_programs = baseline_sample["proofSets"]["materialPrograms"]
    candidate_programs = candidate_sample["proofSets"]["materialPrograms"]
    baseline_session = SelectorProgramExtractionSession(
        inventory_path=args.baseline_inventory,
        decrypted_root=args.baseline_decrypted_root,
        unity_version=baseline_sample["unity"]["serializedVersion"],
        expected_proof_graph_sha256=baseline_programs["proofGraphSha256"],
        expected_port_index_sha256=baseline_programs["portIndexSha256"],
    )
    candidate_session = SelectorProgramExtractionSession(
        inventory_path=args.candidate_inventory,
        decrypted_root=args.candidate_decrypted_root,
        unity_version=candidate_sample["unity"]["serializedVersion"],
        expected_proof_graph_sha256=candidate_programs["proofGraphSha256"],
        expected_port_index_sha256=candidate_programs["portIndexSha256"],
    )
    baseline_contract = json.loads(
        args.baseline_port_contract.read_text(encoding="utf-8")
    )
    if (
        baseline_contract.get("schema")
        != "pocket-card-render/official-program-port-contract@2"
        or baseline_contract.get("provenance", {}).get("sampleId")
        != baseline_sample["sampleId"]
        or baseline_contract.get("provenance", {}).get(
            "sampleManifestSha256"
        )
        != baseline_loaded["sampleManifestSha256"]
        or baseline_contract.get("inventory", {}).get(
            "proofGraphSha256"
        )
        != baseline_programs["proofGraphSha256"]
        or baseline_contract.get("inventory", {}).get(
            "portIndexSha256"
        )
        != baseline_programs["portIndexSha256"]
    ):
        raise ValueError("baseline formal port contract provenance changed")

    out = args.out.resolve()
    baseline_out = out / "baseline"
    candidate_out = out / "candidate"
    work = out / "normalized"
    for directory in (baseline_out, candidate_out, work):
        directory.mkdir(parents=True, exist_ok=True)

    rows = []
    for index, changed in enumerate(migration["routes"]["changed"], start=1):
        prefix = safe_prefix(index, changed["shaderName"], changed["keywords"])
        common = {
            "shaderName": changed["shaderName"],
            "keywords": changed["keywords"],
            "subshader": changed["subshader"],
            "pass": changed["pass"],
        }
        baseline_route = {
            **common,
            "selectorId": changed["baselineSelectorId"],
            "candidateWitnessId": changed["baselineCandidateWitnessId"],
        }
        candidate_route = {
            **common,
            "selectorId": changed["candidateSelectorId"],
            "candidateWitnessId": changed["candidateCandidateWitnessId"],
        }
        baseline_metadata = extract_route(
            baseline_session, baseline_route, baseline_out, prefix
        )
        candidate_metadata = extract_route(
            candidate_session, candidate_route, candidate_out, prefix
        )
        stages = {}
        for stage, suffix in (("vertex", "vert"), ("fragment", "frag")):
            stages[stage] = stage_analysis(
                baseline_out / f"{prefix}_{suffix}.spv",
                candidate_out / f"{prefix}_{suffix}.spv",
                work,
                prefix,
                suffix,
                args.spirv_opt,
                args.spirv_cross,
            )
        structured = structured_contract_matches(
            baseline_metadata, candidate_metadata
        )
        stage_sources_same = all(
            stage["spirvCrossGlslSame"] for stage in stages.values()
        )
        structured_same = all(structured.values())
        if all(stage["optimizedSame"] for stage in stages.values()) and structured_same:
            classification = "binary-equivalent-after-spirv-normalization"
        elif stage_sources_same and structured_same:
            classification = "spirv-cross-source-identical"
        elif (
            all(stage["mainBodySame"] for stage in stages.values())
            and structured["programBindChannelListSame"]
            and structured["shaderPropertyDefaultsSame"]
        ):
            classification = "engine-uniform-layout-only"
        else:
            classification = "shader-logic-changed"
        rows.append({
            **common,
            "changedFields": changed["changedFields"],
            "classification": classification,
            "stages": stages,
            "structuredContracts": structured,
            "structuredDelta": structured_delta(
                baseline_metadata, candidate_metadata
            ),
        })

    reuse_rows = []
    reuse_required = (
        "parameterReflectionSame",
        "commonBindingsSame",
        "programBindChannelListSame",
        "shaderPropertyDefaultsSame",
    )
    for index, route in enumerate(
        migration["routes"]["staticPortReuseCandidates"], start=1
    ):
        prefix = safe_prefix(
            len(rows) + index, route["shaderName"], route["keywords"]
        )
        common = {
            "shaderName": route["shaderName"],
            "keywords": route["keywords"],
            "subshader": route["subshader"],
            "pass": route["pass"],
        }
        baseline_evidence_source = "raw-selector-extraction"
        baseline_manifest = None
        try:
            baseline_metadata = extract_route(
                baseline_session,
                {
                    **common,
                    "selectorId": route["baselineSelectorId"],
                    "candidateWitnessId": route[
                        "baselineCandidateWitnessId"
                    ],
                },
                baseline_out,
                prefix,
            )
        except RuntimeError as error:
            if str(error) != "official source bundle SHA changed":
                raise RuntimeError(
                    "static reuse baseline extraction failed for "
                    f"{common['shaderName']} {common['keywords']} "
                    f"subshader={common['subshader']} "
                    f"pass={common['pass']}: {error}"
                ) from error
            baseline_evidence_source = "formal-port-manifest"
            baseline_metadata, baseline_manifest = (
                baseline_manifest_metadata(
                    baseline_contract,
                    {
                        **common,
                        "selectorId": route["baselineSelectorId"],
                        "candidateWitnessId": route[
                            "baselineCandidateWitnessId"
                        ],
                    },
                )
            )
        candidate_metadata = extract_route(
            candidate_session,
            {
                **common,
                "selectorId": route["candidateSelectorId"],
                "candidateWitnessId": route[
                    "candidateCandidateWitnessId"
                ],
            },
            candidate_out,
            prefix,
        )
        structured = structured_contract_matches(
            baseline_metadata, candidate_metadata
        )
        eligible = all(structured[name] for name in reuse_required)
        reuse_rows.append(
            {
                **common,
                "baselineSelectorId": route["baselineSelectorId"],
                "candidateSelectorId": route["candidateSelectorId"],
                "baselineCandidateWitnessId": route[
                    "baselineCandidateWitnessId"
                ],
                "candidateCandidateWitnessId": route[
                    "candidateCandidateWitnessId"
                ],
                "baselineEvidenceSource": baseline_evidence_source,
                **(
                    {"baselineManifest": baseline_manifest}
                    if baseline_manifest is not None
                    else {}
                ),
                "reuseEligible": eligible,
                "structuredContracts": structured,
                **(
                    {}
                    if eligible
                    else {
                        "structuredDelta": structured_delta(
                            baseline_metadata, candidate_metadata
                        )
                    }
                ),
            }
        )

    summary = {
        "changedRoutes": len(rows),
        "binaryEquivalentAfterSpirvNormalization": sum(
            row["classification"]
            == "binary-equivalent-after-spirv-normalization"
            for row in rows
        ),
        "spirvCrossSourceIdentical": sum(
            row["classification"] == "spirv-cross-source-identical"
            for row in rows
        ),
        "engineUniformLayoutOnly": sum(
            row["classification"] == "engine-uniform-layout-only"
            for row in rows
        ),
        "shaderLogicChanged": sum(
            row["classification"] == "shader-logic-changed"
            for row in rows
        ),
        "staticReuseCandidates": len(reuse_rows),
        "staticReuseValidated": sum(
            row["reuseEligible"] for row in reuse_rows
        ),
        "staticReuseRejected": sum(
            not row["reuseEligible"] for row in reuse_rows
        ),
        "staticReuseBaselineEvidence": {
            source: sum(
                row["baselineEvidenceSource"] == source
                for row in reuse_rows
            )
            for source in (
                "raw-selector-extraction",
                "formal-port-manifest",
            )
        },
        "staticReuseFieldMatches": {
            name: sum(
                row["structuredContracts"][name] for row in reuse_rows
            )
            for name in (
                "parameterReflectionSame",
                "commonBindingsSame",
                "programBindChannelsSame",
                "programBindChannelListSame",
                "shaderPropertyDefaultsSame",
            )
        },
    }
    report = {
        "schema": "pocket-card-render/official-program-migration-analysis@1",
        "schemaVersion": 1,
        "baselineSampleId": baseline_sample["sampleId"],
        "candidateSampleId": candidate_sample["sampleId"],
        "migrationReportSha256": sha256_file(args.migration_report),
        "baselineInventorySha256": sha256_file(args.baseline_inventory),
        "candidateInventorySha256": sha256_file(args.candidate_inventory),
        "definition": {
            "classificationIsStaticTriageOnly": True,
            "excludedClaims": [
                "Vulkan instruction equivalence",
                "Vulkan to WebGL backend equivalence",
                "native variant selection",
                "guest dispatch and runtime bindings",
            ],
            "staticReuseRequiredContracts": list(reuse_required),
        },
        "summary": summary,
        "routes": rows,
        "staticReuseValidation": reuse_rows,
        "sessionStatistics": {
            "baseline": baseline_session.statistics,
            "candidate": candidate_session.statistics,
        },
    }
    (out / "analysis.json").write_text(
        json.dumps(report, ensure_ascii=True, indent=2) + "\n",
        encoding="utf-8",
        newline="\n",
    )
    if args.report_out is not None:
        args.report_out.parent.mkdir(parents=True, exist_ok=True)
        args.report_out.write_text(
            json.dumps(report, ensure_ascii=True, indent=2) + "\n",
            encoding="utf-8",
            newline="\n",
        )
    print(json.dumps(summary, ensure_ascii=True))


if __name__ == "__main__":
    main()
