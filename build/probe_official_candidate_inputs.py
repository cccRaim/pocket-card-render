#!/usr/bin/env python3
"""Probe immutable facts for a prospective official sample.

This is a discovery tool, not a manifest generator. It never fills missing
candidate roots from the current baseline and never records local paths.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re
import struct
import zipfile


PACKAGE_NAME = "jp.pokemon.pokemontcgp"
CORE_ENTRIES = {
    "libunity": "lib/arm64-v8a/libunity.so",
    "libil2cpp": "lib/arm64-v8a/libil2cpp.so",
    "globalMetadataEncrypted": (
        "assets/bin/Data/Managed/Metadata/global-metadata.dat"
    ),
    "bootConfig": "assets/bin/Data/boot.config",
    "globalGameManagers": "assets/bin/Data/globalgamemanagers",
}


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: Path) -> tuple[int, str]:
    digest = hashlib.sha256()
    length = 0
    with path.open("rb") as source:
        while chunk := source.read(1024 * 1024):
            digest.update(chunk)
            length += len(chunk)
    return length, digest.hexdigest()


def identity_bytes(data: bytes) -> dict:
    return {"byteLength": len(data), "sha256": sha256_bytes(data)}


def identity_file(path: Path) -> dict:
    byte_length, digest = sha256_file(path)
    return {"byteLength": byte_length, "sha256": digest}


def _length8(data: bytes, offset: int) -> tuple[int, int]:
    first = data[offset]
    if first & 0x80:
        return ((first & 0x7F) << 8) | data[offset + 1], offset + 2
    return first, offset + 1


def _length16(data: bytes, offset: int) -> tuple[int, int]:
    first = struct.unpack_from("<H", data, offset)[0]
    if first & 0x8000:
        second = struct.unpack_from("<H", data, offset + 2)[0]
        return ((first & 0x7FFF) << 16) | second, offset + 4
    return first, offset + 2


def axml_strings(data: bytes) -> tuple[list[str], int]:
    offset = 8
    while offset + 8 <= len(data):
        chunk_type, header_size, chunk_size = struct.unpack_from("<HHI", data, offset)
        if chunk_size < header_size or offset + chunk_size > len(data):
            raise ValueError("invalid Android binary XML chunk")
        if chunk_type != 0x0001:
            offset += chunk_size
            continue
        string_count, _style_count, flags, strings_start, _styles_start = (
            struct.unpack_from("<IIIII", data, offset + 8)
        )
        offsets_start = offset + header_size
        pool_start = offset + strings_start
        utf8 = bool(flags & 0x100)
        strings: list[str] = []
        for index in range(string_count):
            relative = struct.unpack_from("<I", data, offsets_start + index * 4)[0]
            cursor = pool_start + relative
            if utf8:
                _utf16_length, cursor = _length8(data, cursor)
                byte_length, cursor = _length8(data, cursor)
                strings.append(data[cursor : cursor + byte_length].decode("utf-8"))
            else:
                char_length, cursor = _length16(data, cursor)
                strings.append(
                    data[cursor : cursor + char_length * 2].decode("utf-16-le")
                )
        return strings, offset + chunk_size
    raise ValueError("AndroidManifest.xml has no string pool")


def parse_manifest_identity(data: bytes) -> dict:
    strings, offset = axml_strings(data)
    found: dict[str, object] = {}
    while offset + 8 <= len(data):
        chunk_type, header_size, chunk_size = struct.unpack_from("<HHI", data, offset)
        if chunk_size < header_size or offset + chunk_size > len(data):
            raise ValueError("invalid Android binary XML node")
        if chunk_type == 0x0102:
            attr_ext = offset + 16
            attr_start, attr_size, attr_count = struct.unpack_from(
                "<HHH", data, attr_ext + 8
            )
            attributes = attr_ext + attr_start
            for index in range(attr_count):
                item = attributes + index * attr_size
                _namespace, name_index, raw_index = struct.unpack_from(
                    "<III", data, item
                )
                _value_size, _res0, data_type, value_data = struct.unpack_from(
                    "<HBBI", data, item + 12
                )
                if name_index >= len(strings):
                    continue
                name = strings[name_index]
                if name == "versionName":
                    value_index = (
                        raw_index
                        if raw_index != 0xFFFFFFFF
                        else value_data if data_type == 0x03 else 0xFFFFFFFF
                    )
                    if value_index >= len(strings):
                        raise ValueError("versionName is not a string value")
                    found[name] = strings[value_index]
                elif name == "versionCode":
                    if data_type not in (0x10, 0x11):
                        raise ValueError("versionCode is not an integer value")
                    found[name] = value_data
        offset += chunk_size
    if set(found) != {"versionName", "versionCode"}:
        raise ValueError("AndroidManifest version identity is incomplete")
    return found


def unity_version(global_game_managers: bytes) -> str:
    # SerializedFile version strings are null-terminated near the header.
    for token in global_game_managers[:512].split(b"\0"):
        try:
            value = token.decode("ascii")
        except UnicodeDecodeError:
            continue
        if (
            len(value) <= 32
            and value.count(".") == 2
            and "f" in value
            and value[0].isdigit()
        ):
            return value
    raise ValueError("globalgamemanagers has no Unity version string")


def player_build_version(libunity: bytes, serialized_version: str) -> str:
    pattern = re.compile(
        rb"(?<![0-9A-Za-z.])"
        + re.escape(serialized_version.encode("ascii"))
        + rb"_[0-9a-f]{8,40}(?![0-9a-f])"
    )
    matches = sorted({match.group().decode("ascii") for match in pattern.finditer(libunity)})
    if len(matches) != 1:
        raise ValueError(
            "libunity player build identity is not unique: "
            + json.dumps(matches, ensure_ascii=True)
        )
    return matches[0]


def classify_splits(split_dir: Path) -> dict[str, Path]:
    rows: dict[str, Path] = {}
    for apk in sorted(split_dir.glob("*.apk")):
        with zipfile.ZipFile(apk) as archive:
            names = set(archive.namelist())
        if "AndroidManifest.xml" in names and CORE_ENTRIES["bootConfig"] in names:
            key = "baseApk"
        elif CORE_ENTRIES["libunity"] in names and CORE_ENTRIES["libil2cpp"] in names:
            key = "arm64Split"
        elif any(name.startswith("assets/assetpack/blob/") for name in names):
            key = "bundledTreeSplit"
        else:
            continue
        if key in rows:
            raise ValueError(f"multiple split candidates for {key}")
        rows[key] = apk
    missing = {"baseApk", "arm64Split", "bundledTreeSplit"} - set(rows)
    if missing:
        raise ValueError("required split APKs are missing: " + ", ".join(sorted(missing)))
    return rows


def package_facts(split_dir: Path) -> tuple[dict, dict]:
    splits = classify_splits(split_dir)
    artifacts: dict[str, dict] = {}
    nested_data: dict[str, bytes] = {}
    for key, apk in splits.items():
        artifacts[key] = {
            "logicalName": apk.name,
            **identity_file(apk),
        }
        with zipfile.ZipFile(apk) as archive:
            names = set(archive.namelist())
            for nested_key, entry in CORE_ENTRIES.items():
                if entry not in names:
                    continue
                data = archive.read(entry)
                nested_data[nested_key] = data
                artifacts[nested_key] = {
                    "split": key,
                    "entry": entry,
                    **identity_bytes(data),
                }
    if set(nested_data) != set(CORE_ENTRIES):
        missing = set(CORE_ENTRIES) - set(nested_data)
        raise ValueError("nested official roots are missing: " + ", ".join(sorted(missing)))
    with zipfile.ZipFile(splits["baseApk"]) as base:
        manifest = parse_manifest_identity(base.read("AndroidManifest.xml"))
    serialized_version = unity_version(nested_data["globalGameManagers"])
    return {
        "packageName": PACKAGE_NAME,
        "versionName": manifest["versionName"],
        "versionCode": manifest["versionCode"],
        "architecture": "arm64-v8a",
        "unitySerializedVersion": serialized_version,
        "playerBuildVersion": player_build_version(
            nested_data["libunity"],
            serialized_version,
        ),
    }, artifacts


def masterdata_facts(masterdata_root: Path) -> dict:
    result: dict[str, object] = {}
    cards = []
    for kind, name in (("pokemon", "PokemonCard.json"), ("trainer", "TrainerCard.json")):
        path = masterdata_root / name
        rows = json.loads(path.read_text(encoding="utf-8"))
        result[f"{kind}Cards"] = len(rows)
        result[f"{kind}Sha256"] = identity_file(path)["sha256"]
        cards.extend(rows)
    result["illustrations"] = len(cards)
    result["uniqueCardIds"] = len({row["CardID"] for row in cards})
    result["uniqueIllustrationIds"] = len(
        {row["IllustrationID"] for row in cards}
    )
    return result


def face_facts(face_root: Path, masterdata_root: Path | None) -> dict:
    prefabs = sorted(face_root.rglob("*_L.prefab_bundles"))
    inventory = []
    illustration_ids = set()
    total = 0
    for prefab in prefabs:
        illustration_id = prefab.name.removesuffix("_L.prefab_bundles")
        if (
            prefab.parent.name != "Prefabs"
            or prefab.parent.parent.name != "L"
            or prefab.parent.parent.parent.name != illustration_id
        ):
            raise ValueError(
                f"canonical L prefab hierarchy does not match filename: {prefab}"
            )
        if illustration_id in illustration_ids:
            raise ValueError(
                f"duplicate canonical L prefab for illustration: {illustration_id}"
            )
        illustration_ids.add(illustration_id)
        identity = identity_file(prefab)
        total += identity["byteLength"]
        inventory.append(
            [illustration_id, identity["byteLength"], identity["sha256"]]
        )
    result: dict[str, object] = {
        "count": len(inventory),
        "byteLength": total,
        "inventorySha256": sha256_bytes(
            json.dumps(
                inventory, ensure_ascii=True, separators=(",", ":")
            ).encode("ascii")
        ),
    }
    if masterdata_root is not None:
        cards = []
        for name in ("PokemonCard.json", "TrainerCard.json"):
            cards.extend(
                json.loads((masterdata_root / name).read_text(encoding="utf-8"))
            )
        missing = [
            [
                row["CardID"],
                row["IllustrationID"],
                row.get("SeriesID"),
                row.get("Rarity"),
            ]
            for row in cards
            if row["IllustrationID"] not in illustration_ids
        ]
        result["missingIllustrations"] = len(missing)
        result["missingIllustrationsSha256"] = sha256_bytes(
            json.dumps(
                missing, ensure_ascii=True, separators=(",", ":")
            ).encode("ascii")
        )
        result["orphanFaceDirectories"] = len(
            illustration_ids - {row["IllustrationID"] for row in cards}
        )
    return result


def probe(args: argparse.Namespace) -> dict:
    game, artifacts = package_facts(args.splits.resolve())
    if args.metadata_plaintext:
        artifacts["globalMetadataPlaintext"] = identity_file(
            args.metadata_plaintext.resolve()
        )
    snapshots = {}
    masterdata_root = args.masterdata.resolve() if args.masterdata else None
    if masterdata_root is not None:
        snapshots["masterdata"] = masterdata_facts(masterdata_root)
    if args.face_root:
        snapshots["faceBundles"] = face_facts(
            args.face_root.resolve(), masterdata_root
        )
    required_unresolved = [
        name
        for name in (
            "apkm",
            "globalMetadataPlaintext",
            "unityReleasePlayer",
            "unityReleaseSymbols",
        )
        if name not in artifacts
    ]
    required_unresolved.extend(
        ["proofSets.materialPrograms", "canonicalCorpus"]
    )
    return {
        "schemaVersion": 1,
        "kind": "official-sample-candidate-probe",
        "game": game,
        "artifacts": artifacts,
        "snapshots": snapshots,
        "unresolvedManifestRoots": required_unresolved,
        "readyForCandidateManifest": not required_unresolved,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--splits", type=Path, required=True)
    parser.add_argument("--metadata-plaintext", type=Path)
    parser.add_argument("--masterdata", type=Path)
    parser.add_argument("--face-root", type=Path)
    parser.add_argument("--out", type=Path)
    args = parser.parse_args()
    result = probe(args)
    rendered = json.dumps(result, ensure_ascii=True, indent=2) + "\n"
    if args.out:
        args.out.write_text(rendered, encoding="utf-8", newline="\n")
    else:
        print(rendered, end="")


if __name__ == "__main__":
    main()
