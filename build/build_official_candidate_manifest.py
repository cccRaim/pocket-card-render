#!/usr/bin/env python3
"""Build a schema-v3 candidate manifest from versioned probe evidence."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

from official_sample import validate_official_sample


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        while chunk := source.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def unresolved(reason: str) -> dict:
    return {"status": "unresolved", "reason": reason}


def resolved(identity: dict, *, entry: str | None = None) -> dict:
    result = {
        "status": "resolved",
        "byteLength": identity["byteLength"],
        "sha256": identity["sha256"],
    }
    if entry is not None:
        result["entry"] = entry
    return result


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def build_manifest(probe_path: Path, inventory_path: Path) -> dict:
    probe = load_json(probe_path)
    inventory = load_json(inventory_path)
    if probe.get("kind") != "official-sample-candidate-probe":
        raise ValueError("input is not an official candidate probe")
    if inventory.get("schema") != (
        "pocket-card-render/official-material-program-inventory@4"
    ):
        raise ValueError("unsupported material program inventory")

    game = probe["game"]
    if inventory.get("unityVersion") != game["unitySerializedVersion"]:
        raise ValueError("probe and material inventory Unity versions differ")

    source_artifacts = probe["artifacts"]
    split_names = {
        key: source_artifacts[key]["logicalName"]
        for key in ("baseApk", "arm64Split", "bundledTreeSplit")
    }
    artifacts = {
        "apkm": unresolved(
            "official input was delivered as raw split APKs; no original APKM "
            "container is available"
        ),
    }
    for key in ("baseApk", "arm64Split", "bundledTreeSplit"):
        artifacts[key] = resolved(
            source_artifacts[key], entry=split_names[key]
        )
    for key in (
        "libunity",
        "libil2cpp",
        "globalMetadataEncrypted",
        "bootConfig",
        "globalGameManagers",
    ):
        source = source_artifacts[key]
        artifacts[key] = resolved(
            source, entry=f"{split_names[source['split']]}!{source['entry']}"
        )
    artifacts["globalMetadataPlaintext"] = resolved(
        source_artifacts["globalMetadataPlaintext"]
    )
    artifacts["unityReleasePlayer"] = unresolved(
        f"matching Unity release player for {game['unitySerializedVersion']} "
        "has not been acquired "
        "and hash-verified"
    )
    artifacts["unityReleaseSymbols"] = unresolved(
        f"matching Unity release symbols for {game['unitySerializedVersion']} "
        "have not been acquired "
        "and hash-verified"
    )

    summary = inventory["summary"]
    digests = inventory["digests"]
    material_programs = {
        "status": "resolved",
        "inventorySchema": inventory["schema"],
        "inventorySha256": sha256_file(inventory_path),
        "materialCount": summary["uniqueMaterials"],
        "resolvedMaterialCount": summary["resolvedMaterials"],
        "shaderCount": summary["uniqueShaders"],
        "selectorCount": summary["selectorArchetypes"],
        "passExecutableCount": summary["exactExecutableCandidates"],
        "semanticExecutableCount": summary["semanticExecutableArchetypes"],
        "sourceBundlesSha256": digests["sourceBundlesSha256"],
        "proofGraphSha256": digests["proofGraphSha256"],
        "portIndexSha256": digests["portIndexSha256"],
        "nativeVariantSelection": inventory["source"]["nativeVariantSelection"],
    }
    masterdata = probe["snapshots"]["masterdata"]
    face = probe["snapshots"]["faceBundles"]
    manifest = {
        "schemaVersion": 3,
        "sampleId": (
            f"ptcgp-{game['versionName']}-unity-"
            f"{game['unitySerializedVersion']}-candidate"
        ),
        "status": "candidate",
        "game": {
            "packageName": game["packageName"],
            "versionName": game["versionName"],
            "versionCode": game["versionCode"],
            "architecture": game["architecture"],
            "packageSource": {
                "kind": "split-directory",
                "splits": split_names,
            },
        },
        "unity": {
            "serializedVersion": game["unitySerializedVersion"],
            "playerBuildVersion": game["playerBuildVersion"],
            "releaseSupportVersion": unresolved(
                "release support identity requires the matching Unity release "
                "player and symbol package"
            ),
        },
        "artifacts": artifacts,
        "snapshots": {
            "masterdata": {
                "illustrations": masterdata["illustrations"],
                "pokemonSha256": masterdata["pokemonSha256"],
                "trainerSha256": masterdata["trainerSha256"],
            },
            "faceBundles": {
                "count": face["count"],
                "byteLength": face["byteLength"],
                "inventorySha256": face["inventorySha256"],
                "missingIllustrations": face["missingIllustrations"],
                "missingIllustrationsSha256": (
                    face["missingIllustrationsSha256"]
                ),
            },
        },
        "proofSets": {"materialPrograms": material_programs},
        "canonicalCorpus": unresolved(
            "Unity 6 canonical card corpus has not been regenerated and "
            "runtime-captured"
        ),
    }
    return validate_official_sample(manifest)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--probe", type=Path, required=True)
    parser.add_argument("--material-inventory", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    manifest = build_manifest(
        args.probe.resolve(), args.material_inventory.resolve()
    )
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(
        json.dumps(manifest, ensure_ascii=True, indent=2) + "\n",
        encoding="utf-8",
        newline="\n",
    )
    print(f"Wrote candidate manifest: {args.out}")


if __name__ == "__main__":
    main()
