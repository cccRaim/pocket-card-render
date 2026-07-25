#!/usr/bin/env python3
"""Verify official sample root inputs without extracting them to disk."""

from __future__ import annotations

import argparse
import hashlib
import io
from pathlib import Path
import sys
import zipfile

from official_sample import load_official_sample


def sha256_file(path: Path) -> tuple[int, str]:
    digest = hashlib.sha256()
    length = 0
    with path.open("rb") as source:
        while chunk := source.read(1024 * 1024):
            digest.update(chunk)
            length += len(chunk)
    return length, digest.hexdigest()


def sha256_bytes(data: bytes) -> tuple[int, str]:
    return len(data), hashlib.sha256(data).hexdigest()


def verify_identity(label: str, actual: tuple[int, str], expected: dict) -> None:
    expected_identity = (expected["byteLength"], expected["sha256"])
    if actual != expected_identity:
        raise ValueError(
            f"{label} identity mismatch: {actual[0]} bytes {actual[1]} "
            f"!= {expected_identity[0]} bytes {expected_identity[1]}"
        )
    print(f"OK {label}: {actual[0]} bytes {actual[1]}")


def read_entry(archive: zipfile.ZipFile, name: str) -> bytes:
    try:
        return archive.read(name)
    except KeyError as error:
        raise ValueError(f"archive entry is missing: {name}") from error


def verify_apkm(apkm_path: Path, sample: dict) -> None:
    artifacts = sample["artifacts"]
    verify_identity("APKM", sha256_file(apkm_path), artifacts["apkm"])
    with zipfile.ZipFile(apkm_path) as outer:
        split_bytes: dict[str, bytes] = {}
        for key in ("baseApk", "arm64Split", "bundledTreeSplit"):
            entry = artifacts[key]["entry"]
            data = read_entry(outer, entry)
            verify_identity(entry, sha256_bytes(data), artifacts[key])
            split_bytes[entry] = data

    nested = {
        "libunity": artifacts["libunity"],
        "libil2cpp": artifacts["libil2cpp"],
        "globalMetadataEncrypted": artifacts["globalMetadataEncrypted"],
        "bootConfig": artifacts["bootConfig"],
        "globalGameManagers": artifacts["globalGameManagers"],
    }
    opened: dict[str, zipfile.ZipFile] = {}
    try:
        for label, expected in nested.items():
            split_name, entry_name = expected["entry"].split("!", 1)
            if split_name not in opened:
                opened[split_name] = zipfile.ZipFile(io.BytesIO(split_bytes[split_name]))
            data = read_entry(opened[split_name], entry_name)
            verify_identity(label, sha256_bytes(data), expected)
    finally:
        for archive in opened.values():
            archive.close()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest")
    parser.add_argument("--apkm", type=Path, required=True)
    parser.add_argument("--metadata-plaintext", type=Path)
    parser.add_argument("--unity-release-player", type=Path)
    parser.add_argument("--unity-release-symbols", type=Path)
    args = parser.parse_args()

    loaded = load_official_sample(args.manifest)
    sample = loaded["sample"]
    verify_apkm(args.apkm.resolve(), sample)
    optional = [
        ("globalMetadataPlaintext", args.metadata_plaintext),
        ("unityReleasePlayer", args.unity_release_player),
        ("unityReleaseSymbols", args.unity_release_symbols),
    ]
    for key, path in optional:
        if path is not None:
            verify_identity(key, sha256_file(path.resolve()), sample["artifacts"][key])
    print(
        f"Official sample inputs OK: {sample['sampleId']} "
        f"{loaded['sampleManifestSha256']}"
    )


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, zipfile.BadZipFile) as error:
        print(f"BAD {error}", file=sys.stderr)
        raise SystemExit(1)
