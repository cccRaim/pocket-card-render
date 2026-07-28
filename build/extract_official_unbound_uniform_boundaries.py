#!/usr/bin/env python3
"""Extract exact-case Material keys for unresolved shader-uniform boundaries."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path

import UnityPy


ROOT = Path(__file__).resolve().parents[1]
UnityPy.config.FALLBACK_UNITY_VERSION = "2022.3.62f2"
DEFAULT_DECRYPTED_ROOT = (
    ROOT.parent
    / "ptcgp-tools-master"
    / "masterdata_decoder"
    / ".output"
    / "decrypted"
)

TARGETS = (
    {
        "id": "legacy-frame",
        "bundle": (
            "Common/CardNew/Common/Model/Materials/Frame/"
            "Pokemon_Frame_MRR.mat_bundles"
        ),
        "materials": ("Pokemon_Frame_MRR",),
    },
    {
        "id": "shadowbox-flow",
        "bundle": (
            "Common/CardNew/Face/cPK_20_010840_00_MEGAKAILIOSex_SR/L/"
            "Prefabs/cPK_20_010840_00_MEGAKAILIOSex_SR_L.prefab_bundles"
        ),
        "materials": (
            "cPK_20_010840_00_MEGAKAILIOSex_SR_L_SBAM1",
            "cPK_20_010840_00_MEGAKAILIOSex_SR_L_SBAM2",
            "cPK_20_010840_00_MEGAKAILIOSex_SR_L_SBAM3",
            "cPK_20_010840_00_MEGAKAILIOSex_SR_L_SBAM4",
        ),
    },
)


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def pairs(value: object) -> list[list[object]]:
    rows = []
    for pair in value or []:
        if isinstance(pair, (list, tuple)) and len(pair) == 2:
            rows.append([str(pair[0]), pair[1]])
        elif isinstance(pair, dict) and "first" in pair and "second" in pair:
            rows.append([str(pair["first"]), pair["second"]])
        else:
            raise ValueError("unexpected Material saved-property pair")
    return rows


def extract(decrypted_root: Path) -> dict:
    groups = []
    for target in TARGETS:
        bundle = (decrypted_root / target["bundle"]).resolve()
        if not bundle.is_file():
            raise FileNotFoundError(bundle)
        environment = UnityPy.load(str(bundle))
        wanted = set(target["materials"])
        rows = []
        for obj in environment.objects:
            if obj.type.name != "Material":
                continue
            tree = obj.read_typetree()
            name = str(tree.get("m_Name") or "")
            if name not in wanted:
                continue
            saved = tree.get("m_SavedProperties") or {}
            rows.append({
                "name": name,
                "pathId": int(obj.path_id),
                "rawSha256": sha256_bytes(bytes(obj.get_raw_data())),
                "floatProperties": pairs(saved.get("m_Floats")),
            })
        rows.sort(key=lambda row: row["name"])
        expected = sorted(wanted)
        actual = [row["name"] for row in rows]
        if actual != expected:
            raise ValueError(
                f"{target['id']} Material set changed: {actual} != {expected}"
            )
        groups.append({
            "id": target["id"],
            "bundle": target["bundle"],
            "bundleSha256": sha256_bytes(bundle.read_bytes()),
            "materials": rows,
        })
    return {
        "schema": "pocket-card-render/official-unbound-uniform-boundaries@1",
        "source": {
            "definition": "raw official Unity Material objects",
            "excludedInputs": [
                "scene JSON",
                "render recipe",
                "PNG",
                "GLB",
                "screenshot",
            ],
        },
        "groups": groups,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--decrypted-root",
        type=Path,
        default=Path(os.environ.get("PCR_DECRYPTED_ROOT", DEFAULT_DECRYPTED_ROOT)),
    )
    args = parser.parse_args()
    print(json.dumps(extract(args.decrypted_root), ensure_ascii=True))


if __name__ == "__main__":
    main()
