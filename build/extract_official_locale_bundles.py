#!/usr/bin/env python3
"""Extract official KVRF locale TextAssets and record byte-level provenance."""

import argparse
import hashlib
import json
import struct
import zlib
from pathlib import Path
import os

import UnityPy


LOCALES = ("de_DE", "en_US", "es_ES", "fr_FR", "it_IT", "ja_JP", "ko_KR", "pt_BR", "zh_TW")
DEFAULT_UNITY_VERSION = "2022.3.62f2"
UnityPy.config.FALLBACK_UNITY_VERSION = os.environ.get(
    "PCR_UNITY_VERSION",
    DEFAULT_UNITY_VERSION,
)


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def parse_kvrf(data):
    if data[:4] != b"KVRF":
        return {}
    hash_table_size = struct.unpack_from("<i", data, 0x14)[0]
    hash_table_addr = struct.unpack_from("<I", data, 0x20)[0]
    result = {}

    def parse_entry(offset, seen):
        while offset and offset < len(data) and offset not in seen:
            seen.add(offset)
            next_addr = struct.unpack_from("<I", data, offset)[0]
            compression = data[offset + 10]
            data_size = struct.unpack_from("<i", data, offset + 12)[0]
            entry = data[offset + 16:offset + 16 + data_size]
            if compression == 1:
                entry = zlib.decompress(entry[4:], -zlib.MAX_WBITS)
            elif compression != 0:
                offset = next_addr
                continue
            key_size = struct.unpack_from("<H", entry, 0)[0]
            key = entry[2:2 + key_size].decode("utf-16-le", "strict")
            value = entry[2 + key_size:].decode("utf-16-le", "strict").strip()
            if key and (key not in result or not result[key]):
                result[key] = value
            offset = next_addr

    for index in range(hash_table_size):
        offset = struct.unpack_from("<I", data, hash_table_addr + index * 4)[0]
        if offset:
            parse_entry(offset, set())
    return result


def raw_text_asset_bytes(obj, text_asset):
    raw = obj.get_raw_data()
    name_size = struct.unpack_from("<I", raw, 0)[0]
    offset = (4 + name_size + 3) & ~3
    script_size = struct.unpack_from("<I", raw, offset)[0]
    value = raw[offset + 4:offset + 4 + script_size]
    if value[:4] != b"KVRF":
        raise ValueError(f"{getattr(text_asset, 'm_Name', '<unnamed>')} is not a KVRF TextAsset")
    return value


def extract_bundle(bundle_path):
    environment = UnityPy.load(str(bundle_path))
    result = {}
    sources = []
    for obj in environment.objects:
        if obj.type.name != "TextAsset":
            continue
        text_asset = obj.read()
        name = getattr(text_asset, "m_Name", getattr(text_asset, "name", ""))
        if name.endswith("_Attribute"):
            continue
        raw = raw_text_asset_bytes(obj, text_asset)
        values = parse_kvrf(raw)
        if not values:
            continue
        result[name] = values
        sources.append({
            "name": name,
            "pathId": str(obj.path_id),
            "rawSha256": sha256(raw),
            "entryCount": len(values),
            "emptyValueCount": sum(1 for value in values.values() if not value),
        })
    return result, sorted(sources, key=lambda item: item["name"])


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input-root", required=True, help="Directory containing <locale>_bundles")
    parser.add_argument("--output-root", required=True, help="Directory for locale_<locale>.json")
    parser.add_argument("--asset-index", help="Official .aladin index used to fetch the bundles")
    parser.add_argument("--asset-catalog", help="JSON catalog produced from the same official index")
    parser.add_argument(
        "--unity-version",
        default=os.environ.get("PCR_UNITY_VERSION", DEFAULT_UNITY_VERSION),
    )
    args = parser.parse_args()
    UnityPy.config.FALLBACK_UNITY_VERSION = args.unity_version

    input_root = Path(args.input_root).resolve()
    output_root = Path(args.output_root).resolve()
    output_root.mkdir(parents=True, exist_ok=True)
    provenance = {
        "schemaVersion": 1,
        "unityVersion": args.unity_version,
        "inputRoot": str(input_root),
        "assetIndex": None,
        "locales": {},
    }
    if args.asset_index:
        asset_index = Path(args.asset_index).resolve()
        index_bytes = asset_index.read_bytes()
        provenance["assetIndex"] = {
            "path": str(asset_index),
            "aladdinHash": asset_index.stem,
            "sha256": sha256(index_bytes),
            "byteLength": len(index_bytes),
        }
    catalog = {}
    if args.asset_catalog:
        catalog_path = Path(args.asset_catalog).resolve()
        catalog_bytes = catalog_path.read_bytes()
        catalog_entries = json.loads(catalog_bytes)
        catalog = {entry["path"]: entry for entry in catalog_entries}
        provenance["assetCatalog"] = {
            "path": str(catalog_path),
            "sha256": sha256(catalog_bytes),
            "entryCount": len(catalog_entries),
        }

    for locale in LOCALES:
        bundle_path = input_root / f"{locale}_bundles"
        bundle_bytes = bundle_path.read_bytes()
        extracted, sources = extract_bundle(bundle_path)
        if "Master" not in extracted or "UI" not in extracted:
            raise ValueError(f"{bundle_path} did not contain Master and UI KVRF TextAssets")
        output_path = output_root / f"locale_{locale}.json"
        output_bytes = (json.dumps(extracted, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8")
        output_path.write_bytes(output_bytes)
        provenance["locales"][locale] = {
            "asset": catalog.get(f"Common/Locale/{locale}_bundles"),
            "bundlePath": str(bundle_path),
            "bundleSha256": sha256(bundle_bytes),
            "bundleByteLength": len(bundle_bytes),
            "outputPath": str(output_path),
            "outputSha256": sha256(output_bytes),
            "sections": sources,
        }
        counts = ", ".join(f"{name}={len(values)}" for name, values in sorted(extracted.items()))
        print(f"{locale}: {counts}")

    provenance_path = output_root / "locale-provenance.json"
    provenance_path.write_text(json.dumps(provenance, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {provenance_path}")


if __name__ == "__main__":
    main()
