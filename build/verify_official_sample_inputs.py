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


def is_unresolved(identity: object) -> bool:
    return isinstance(identity, dict) and identity.get("status") == "unresolved"


def unresolved_roots(sample: dict) -> list[str]:
    roots = [
        f"artifacts.{name}"
        for name, identity in sample["artifacts"].items()
        if is_unresolved(identity)
    ]
    for name in ("playerBuildVersion", "releaseSupportVersion"):
        if is_unresolved(sample["unity"].get(name, {})):
            roots.append(f"unity.{name}")
    if is_unresolved(sample.get("proofSets", {}).get("materialPrograms", {})):
        roots.append("proofSets.materialPrograms")
    if is_unresolved(sample.get("canonicalCorpus", {})):
        roots.append("canonicalCorpus")
    return roots


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


def verify_split_directory(split_dir: Path, sample: dict) -> None:
    artifacts = sample["artifacts"]
    split_bytes: dict[str, Path] = {}
    for key in ("baseApk", "arm64Split", "bundledTreeSplit"):
        expected = artifacts[key]
        if is_unresolved(expected):
            print(f"UNRESOLVED {key}: {expected['reason']}")
            continue
        split_path = split_dir / expected["entry"]
        verify_identity(expected["entry"], sha256_file(split_path), expected)
        split_bytes[expected["entry"]] = split_path

    nested = (
        "libunity",
        "libil2cpp",
        "globalMetadataEncrypted",
        "bootConfig",
        "globalGameManagers",
    )
    opened: dict[str, zipfile.ZipFile] = {}
    try:
        for key in nested:
            expected = artifacts[key]
            if is_unresolved(expected):
                print(f"UNRESOLVED {key}: {expected['reason']}")
                continue
            split_name, entry_name = expected["entry"].split("!", 1)
            if split_name not in split_bytes:
                raise ValueError(f"nested root references unknown split: {split_name}")
            if split_name not in opened:
                opened[split_name] = zipfile.ZipFile(split_bytes[split_name])
            data = read_entry(opened[split_name], entry_name)
            verify_identity(key, sha256_bytes(data), expected)
    finally:
        for archive in opened.values():
            archive.close()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest")
    package = parser.add_mutually_exclusive_group(required=True)
    package.add_argument("--apkm", type=Path)
    package.add_argument("--splits", type=Path)
    parser.add_argument("--metadata-plaintext", type=Path)
    parser.add_argument("--unity-release-player", type=Path)
    parser.add_argument("--unity-release-symbols", type=Path)
    args = parser.parse_args()

    loaded = load_official_sample(args.manifest)
    sample = loaded["sample"]
    if args.apkm is not None:
        verify_apkm(args.apkm.resolve(), sample)
    else:
        verify_split_directory(args.splits.resolve(), sample)
    optional = [
        ("globalMetadataPlaintext", args.metadata_plaintext, "--metadata-plaintext"),
        ("unityReleasePlayer", args.unity_release_player, "--unity-release-player"),
        ("unityReleaseSymbols", args.unity_release_symbols, "--unity-release-symbols"),
    ]
    for key, path, option in optional:
        expected = sample["artifacts"][key]
        if is_unresolved(expected):
            print(f"UNRESOLVED {key}: {expected['reason']}")
        elif path is not None:
            verify_identity(key, sha256_file(path.resolve()), sample["artifacts"][key])
        else:
            raise ValueError(f"resolved root requires {option}")
    unresolved = unresolved_roots(sample)
    print(f"Resolved official sample inputs OK: {sample['sampleId']}")
    print(f"Manifest SHA-256: {loaded['sampleManifestSha256']}")
    if unresolved:
        print(
            f"Candidate remains unresolved ({len(unresolved)} roots): "
            + ", ".join(unresolved)
        )


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, zipfile.BadZipFile) as error:
        print(f"BAD {error}", file=sys.stderr)
        raise SystemExit(1)
