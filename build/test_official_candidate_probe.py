#!/usr/bin/env python3
"""Focused tests for the official candidate split probe."""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import subprocess
import struct
import sys
import tempfile
import zipfile


ROOT = Path(__file__).resolve().parents[1]
CANDIDATE_SAMPLE_ID = "ptcgp-1.7.0-unity-6000.0.69f1-candidate"
SPEC = importlib.util.spec_from_file_location(
    "candidate_probe", ROOT / "build" / "probe_official_candidate_inputs.py"
)
assert SPEC and SPEC.loader
PROBE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PROBE)


def _string_pool(strings: list[str]) -> bytes:
    encoded = []
    offsets = []
    cursor = 0
    for value in strings:
        raw = value.encode("utf-16-le")
        item = struct.pack("<H", len(value)) + raw + b"\0\0"
        encoded.append(item)
        offsets.append(cursor)
        cursor += len(item)
    header_size = 28
    strings_start = header_size + len(strings) * 4
    payload = b"".join(encoded)
    size = strings_start + len(payload)
    return (
        struct.pack("<HHI", 0x0001, header_size, size)
        + struct.pack("<IIIII", len(strings), 0, 0, strings_start, 0)
        + b"".join(struct.pack("<I", offset) for offset in offsets)
        + payload
    )


def _manifest(version_name: str, version_code: int) -> bytes:
    strings = ["manifest", "versionCode", "versionName", version_name]
    pool = _string_pool(strings)
    header_size = 36
    attr_size = 20
    attributes = b"".join(
        [
            struct.pack("<IIIHBBI", 0xFFFFFFFF, 1, 0xFFFFFFFF, 8, 0, 0x10, version_code),
            struct.pack("<IIIHBBI", 0xFFFFFFFF, 2, 3, 8, 0, 0x03, 3),
        ]
    )
    chunk_size = header_size + len(attributes)
    element = (
        struct.pack("<HHI", 0x0102, 16, chunk_size)
        + struct.pack("<II", 0, 0xFFFFFFFF)
        + struct.pack("<II", 0xFFFFFFFF, 0)
        + struct.pack("<HHHHHH", 20, attr_size, 2, 0, 0, 0)
        + attributes
    )
    return struct.pack("<HHI", 0x0003, 8, 8 + len(pool) + len(element)) + pool + element


def _apk(path: Path, entries: dict[str, bytes]) -> None:
    with zipfile.ZipFile(path, "w") as archive:
        for name, data in entries.items():
            archive.writestr(name, data)


def main() -> None:
    assert CANDIDATE_SAMPLE_ID.endswith("-candidate")
    version = ".".join(("1", "7", "0"))
    parsed = PROBE.parse_manifest_identity(_manifest(version, 342951))
    assert parsed == {"versionName": version, "versionCode": 342951}
    try:
        PROBE.parse_manifest_identity(_manifest(version, 342951).replace(
            "versionCode".encode("utf-16-le"),
            "versionCope".encode("utf-16-le"),
        ))
    except (UnicodeDecodeError, ValueError):
        pass
    else:
        raise AssertionError("mutated versionCode attribute must fail closed")

    with tempfile.TemporaryDirectory() as temporary:
        root = Path(temporary)
        _apk(
            root / "base.apk",
            {
                "AndroidManifest.xml": _manifest("1.7.0", 342951),
                PROBE.CORE_ENTRIES["bootConfig"]: b"boot",
                PROBE.CORE_ENTRIES["globalGameManagers"]: b"\0" * 16
                + b"6000.0.69f1\0",
                PROBE.CORE_ENTRIES["globalMetadataEncrypted"]: b"encrypted",
            },
        )
        _apk(
            root / "arm.apk",
            {
                PROBE.CORE_ENTRIES["libunity"]: (
                    b"unity\0"
                    b"6000.0.69f1_5f8607f5118b\0"
                ),
                PROBE.CORE_ENTRIES["libil2cpp"]: b"il2cpp",
            },
        )
        _apk(root / "tree.apk", {"assets/assetpack/blob/00/example.aladin": b"x"})
        game, artifacts = PROBE.package_facts(root)
        assert game["versionName"] == "1.7.0"
        assert game["versionCode"] == 342951
        assert game["unitySerializedVersion"] == "6000.0.69f1"
        assert game["playerBuildVersion"] == "6000.0.69f1_5f8607f5118b"
        assert artifacts["libunity"]["split"] == "arm64Split"
        assert artifacts["globalGameManagers"]["split"] == "baseApk"
        try:
            PROBE.player_build_version(
                b"unity without a build identity",
                "6000.0.69f1",
            )
        except ValueError as error:
            assert "not unique" in str(error)
        else:
            raise AssertionError("missing player build identity must fail closed")

        (root / "duplicate.apk").write_bytes((root / "arm.apk").read_bytes())
        try:
            PROBE.classify_splits(root)
        except ValueError as error:
            assert "multiple split candidates" in str(error)
        else:
            raise AssertionError("duplicate core split must fail closed")

        masterdata = root / "masterdata"
        masterdata.mkdir()
        (masterdata / "PokemonCard.json").write_text(
            json.dumps(
                [
                    {
                        "CardID": "card-1",
                        "IllustrationID": "cPK_10_000010_00_TEST_C",
                        "SeriesID": "series",
                        "Rarity": "C",
                    }
                ]
            ),
            encoding="utf-8",
        )
        (masterdata / "TrainerCard.json").write_text("[]", encoding="utf-8")
        face_root = root / "Face"
        nested_prefab = (
            face_root
            / "PK"
            / "10"
            / "000000"
            / "cPK_10_000010_00_TEST_C"
            / "L"
            / "Prefabs"
            / "cPK_10_000010_00_TEST_C_L.prefab_bundles"
        )
        nested_prefab.parent.mkdir(parents=True)
        nested_prefab.write_bytes(b"unity-bundle")
        face = PROBE.face_facts(face_root, masterdata)
        assert face["count"] == 1
        assert face["missingIllustrations"] == 0
        assert face["orphanFaceDirectories"] == 0

    extractor = ROOT / "build" / "extract_official_material_program_inventory.py"
    rejected = subprocess.run(
        [
            sys.executable,
            "-B",
            str(extractor),
            "--unity-version",
            "6000.0.69f1",
        ],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    assert rejected.returncode == 2
    assert "baseline native variant selection is valid only" in rejected.stderr
    print("Official candidate probe tests OK")


if __name__ == "__main__":
    main()
