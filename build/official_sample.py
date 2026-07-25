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


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(f"official sample manifest: {message}")


def _sha256(value: object) -> str:
    encoded = json.dumps(
        value, ensure_ascii=True, separators=(",", ":"), sort_keys=True
    ).encode("ascii")
    return hashlib.sha256(encoded).hexdigest()


def validate_official_sample(sample: dict) -> dict:
    _require(sample.get("schemaVersion") == 2, "unsupported schemaVersion")
    _require(
        re.fullmatch(r"[a-z0-9.-]+", sample.get("sampleId", "")) is not None,
        "invalid sampleId",
    )
    _require(sample.get("status") in {"baseline", "candidate"}, "invalid status")
    game = sample.get("game", {})
    unity = sample.get("unity", {})
    _require(game.get("packageName") == "jp.pokemon.pokemontcgp", "unexpected package")
    _require(game.get("architecture") == "arm64-v8a", "unsupported architecture")
    _require(
        unity.get("playerBuildVersion", "").startswith(
            f"{unity.get('serializedVersion', '')}_"
        ),
        "Unity player build does not match serialized version",
    )
    for name, artifact in sample.get("artifacts", {}).items():
        _require(
            re.fullmatch(r"[0-9a-f]{64}", artifact.get("sha256", "")) is not None,
            f"{name} has invalid SHA-256",
        )
        _require(artifact.get("byteLength", 0) > 0, f"{name} has invalid byteLength")
    _require(len(sample.get("artifacts", {})) == 12, "artifact root set is incomplete")
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
