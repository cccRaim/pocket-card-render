#!/usr/bin/env python3
"""Shared loader for the versioned official-sample manifest."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SELECTION = ROOT / "build" / "official-samples" / "current.json"
REQUIRED_ARTIFACTS = {
    "apkm",
    "baseApk",
    "arm64Split",
    "bundledTreeSplit",
    "libunity",
    "libil2cpp",
    "globalMetadataEncrypted",
    "globalMetadataPlaintext",
    "bootConfig",
    "globalGameManagers",
    "unityReleasePlayer",
    "unityReleaseSymbols",
}


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(f"official sample manifest: {message}")


def _sha256(value: object) -> str:
    encoded = json.dumps(
        value, ensure_ascii=True, separators=(",", ":"), sort_keys=True
    ).encode("ascii")
    return hashlib.sha256(encoded).hexdigest()


def _is_unresolved(value: object) -> bool:
    return isinstance(value, dict) and value.get("status") == "unresolved"


def _validate_identity(name: str, artifact: dict) -> None:
    _require(
        artifact.get("status") in {None, "resolved"},
        f"{name} has invalid status",
    )
    _require(
        re.fullmatch(r"[0-9a-f]{64}", artifact.get("sha256", "")) is not None,
        f"{name} has invalid SHA-256",
    )
    _require(artifact.get("byteLength", 0) > 0, f"{name} has invalid byteLength")


def _validate_candidate_root(name: str, value: dict) -> None:
    if _is_unresolved(value):
        _require(
            isinstance(value.get("reason"), str) and len(value["reason"].strip()) >= 12,
            f"{name} unresolved root must explain why",
        )
        return
    _validate_identity(name, value)


def validate_official_sample(sample: dict) -> dict:
    schema_version = sample.get("schemaVersion")
    _require(schema_version in {2, 3}, "unsupported schemaVersion")
    _require(
        re.fullmatch(r"[a-z0-9.-]+", sample.get("sampleId", "")) is not None,
        "invalid sampleId",
    )
    _require(sample.get("status") in {"baseline", "candidate"}, "invalid status")
    if schema_version == 3:
        _require(sample.get("status") == "candidate", "schemaVersion 3 is candidate-only")
    game = sample.get("game", {})
    unity = sample.get("unity", {})
    _require(game.get("packageName") == "jp.pokemon.pokemontcgp", "unexpected package")
    _require(game.get("architecture") == "arm64-v8a", "unsupported architecture")
    if schema_version == 2:
        _require(
            unity.get("playerBuildVersion", "").startswith(
                f"{unity.get('serializedVersion', '')}_"
            ),
            "Unity player build does not match serialized version",
        )
    else:
        _require(
            game.get("packageSource", {}).get("kind") == "split-directory",
            "candidate packageSource must identify split-directory",
        )
        for name in ("playerBuildVersion", "releaseSupportVersion"):
            value = unity.get(name)
            if _is_unresolved(value):
                _validate_candidate_root(f"unity.{name}", value)
            else:
                _require(
                    isinstance(value, str)
                    and unity.get("serializedVersion", "") in value,
                    f"{name} does not match serialized version",
                )
    artifacts = sample.get("artifacts", {})
    _require(set(artifacts) == REQUIRED_ARTIFACTS, "artifact root set is incomplete")
    for name, artifact in artifacts.items():
        if schema_version == 3:
            _validate_candidate_root(name, artifact)
        else:
            _validate_identity(name, artifact)
    material_programs = sample.get("proofSets", {}).get("materialPrograms", {})
    if schema_version == 3 and _is_unresolved(material_programs):
        _validate_candidate_root("proofSets.materialPrograms", material_programs)
    else:
        _require(
            re.fullmatch(
                r"[0-9a-f]{64}", material_programs.get("proofGraphSha256", "")
            )
            is not None,
            "invalid shader proofGraphSha256",
        )
        _require(
            re.fullmatch(
                r"[0-9a-f]{64}", material_programs.get("portIndexSha256", "")
            )
            is not None,
            "invalid shader portIndexSha256",
        )
    corpus = sample.get("canonicalCorpus", {})
    if schema_version == 3 and _is_unresolved(corpus):
        _validate_candidate_root("canonicalCorpus", corpus)
    else:
        _require(
            re.fullmatch(r"[0-9a-f]{64}", corpus.get("sha256", "")) is not None,
            "invalid canonicalCorpus SHA-256",
        )
    return sample


def load_official_sample(manifest_path: str | Path | None = None) -> dict:
    selection_path = Path(
        manifest_path or os.environ.get("PCR_OFFICIAL_SAMPLE_MANIFEST", DEFAULT_SELECTION)
    ).resolve()
    selection = json.loads(selection_path.read_text(encoding="utf-8"))
    if isinstance(selection.get("manifest"), str):
        _require(selection.get("schemaVersion") == 1, "unsupported current pointer schema")
        resolved = (selection_path.parent / selection["manifest"]).resolve()
        _require(resolved.parent == selection_path.parent, "pointer must select a sibling")
        manifest_path_resolved = resolved
    else:
        manifest_path_resolved = selection_path
    sample = validate_official_sample(
        json.loads(manifest_path_resolved.read_text(encoding="utf-8"))
    )
    return {
        "selectionPath": str(selection_path),
        "manifestPath": str(manifest_path_resolved),
        "sampleManifestSha256": _sha256(sample),
        "sample": sample,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()
    loaded = load_official_sample(args.manifest)
    if args.json:
        print(json.dumps(loaded, ensure_ascii=True, indent=2))
    else:
        sample = loaded["sample"]
        print(
            f"PTCGP {sample['game']['versionName']} / "
            f"Unity {sample['unity']['serializedVersion']} "
            f"{loaded['sampleManifestSha256']}"
        )


if __name__ == "__main__":
    main()
