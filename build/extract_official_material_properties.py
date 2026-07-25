#!/usr/bin/env python3
"""Extract canonical Material saved properties from official Unity bundles.

Scene files supply only Material CAB:pathID locators. Property names, values,
texture PPtrs, scale, and offset are decoded again from serialized objects.
"""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path

from extract_official_material_sort_inputs import (
    CANONICAL_CARDS,
    DEFAULT_DECRYPTED_ROOT,
    UNITY_VERSION,
    OfficialBundleIndex,
    canonical_digest,
    parse_identity,
    pptr_record,
    scene_targets,
    sha256_bytes,
    source_bundle_records,
)


SCHEMA = "pocket-card-render/official-material-properties@1"


def pair_map(value: object, label: str) -> dict[str, object]:
    if not isinstance(value, (list, tuple)):
        raise RuntimeError(f"{label} is not a serialized pair array")
    result: dict[str, object] = {}
    for index, pair in enumerate(value):
        if not isinstance(pair, (list, tuple)) or len(pair) != 2:
            raise RuntimeError(f"{label}[{index}] is not a key/value pair")
        key = str(pair[0])
        if key in result:
            raise RuntimeError(f"{label} contains duplicate property {key!r}")
        result[key] = pair[1]
    return result


def vec2(value: object, label: str) -> list[float]:
    if not isinstance(value, dict) or "x" not in value or "y" not in value:
        raise RuntimeError(f"{label} is not a serialized Vector2")
    return [float(value["x"]), float(value["y"])]


def color(value: object, label: str) -> list[float]:
    if not isinstance(value, dict) or any(axis not in value for axis in ("r", "g", "b", "a")):
        raise RuntimeError(f"{label} is not a serialized Color")
    return [float(value[axis]) for axis in ("r", "g", "b", "a")]


def nullable_pptr_record(owner: object, pointer: object, label: str) -> dict | None:
    if not isinstance(pointer, dict):
        raise RuntimeError(f"{label} is not a serialized PPtr")
    if int(pointer.get("m_PathID", 0)) == 0:
        if int(pointer.get("m_FileID", 0)) != 0:
            raise RuntimeError(f"{label} has a null PathID with a nonzero FileID")
        return None
    return pptr_record(owner, pointer, label)


def material_record(index: OfficialBundleIndex, identity: str) -> dict:
    obj, bundle = index.object(identity, "Material")
    tree = obj.read_typetree()
    label = f"Material {identity}"
    saved = tree.get("m_SavedProperties")
    if not isinstance(saved, dict):
        raise RuntimeError(f"{label} has no serialized m_SavedProperties")

    integers = {
        key: int(value)
        for key, value in pair_map(saved.get("m_Ints"), f"{label}.m_Ints").items()
    }
    floats = {
        key: float(value)
        for key, value in pair_map(saved.get("m_Floats"), f"{label}.m_Floats").items()
    }
    colors = {
        key: color(value, f"{label}.m_Colors[{key!r}]")
        for key, value in pair_map(saved.get("m_Colors"), f"{label}.m_Colors").items()
    }
    texture_environments = {}
    for key, value in pair_map(saved.get("m_TexEnvs"), f"{label}.m_TexEnvs").items():
        if not isinstance(value, dict):
            raise RuntimeError(f"{label}.m_TexEnvs[{key!r}] is not an object")
        texture_environments[key] = {
            "texture": nullable_pptr_record(
                obj,
                value.get("m_Texture"),
                f"{label}.m_TexEnvs[{key!r}].m_Texture",
            ),
            "scale": vec2(value.get("m_Scale"), f"{label}.m_TexEnvs[{key!r}].m_Scale"),
            "offset": vec2(value.get("m_Offset"), f"{label}.m_TexEnvs[{key!r}].m_Offset"),
        }

    raw = bytes(obj.get_raw_data())
    return {
        "identity": identity,
        "name": str(tree.get("m_Name") or ""),
        "sourceBundle": index.relative(bundle),
        "sourceBundleSha256": index.bundle_sha256(bundle),
        "rawByteSize": len(raw),
        "rawSha256": sha256_bytes(raw),
        "savedProperties": {
            "integers": integers,
            "floats": floats,
            "colors": colors,
            "textureEnvironments": texture_environments,
        },
    }


def extract(decrypted_root: Path) -> dict:
    decrypted_root = decrypted_root.resolve()
    if not decrypted_root.is_dir():
        raise RuntimeError(f"decrypted root does not exist: {decrypted_root}")
    scenes, target_rows = scene_targets()
    material_identities = sorted({row["materialIdentity"] for row in target_rows})
    material_cabs = {parse_identity(value, "Material")[0] for value in material_identities}

    common_root = decrypted_root / "Common" / "CardNew" / "Common"
    common_bundles = sorted(common_root.rglob("*_bundles"), key=lambda path: path.as_posix())
    face_bundles = [
        decrypted_root
        / "Common"
        / "CardNew"
        / "Face"
        / card_id
        / "L"
        / "Prefabs"
        / f"{card_id}_L.prefab_bundles"
        for card_id in CANONICAL_CARDS
    ]
    index = OfficialBundleIndex(decrypted_root)
    index.locate(material_cabs, common_bundles + face_bundles, "Material")
    materials = [material_record(index, identity) for identity in material_identities]
    rows = [
        {
            "sceneFile": target["sceneFile"],
            "cardId": target["cardId"],
            "materialName": target["materialName"],
            "materialIdentity": target["materialIdentity"],
        }
        for target in target_rows
    ]
    source_bundles = source_bundle_records(index, material_cabs, set())
    evidence = {
        "sourceBundles": source_bundles,
        "rows": rows,
        "materials": materials,
    }
    return {
        "schema": SCHEMA,
        "schemaVersion": 1,
        "unityVersion": UNITY_VERSION,
        "canonicalScenes": scenes,
        "summary": {
            "sceneRows": len(rows),
            "uniqueMaterials": len(materials),
            "sourceBundles": len(source_bundles),
        },
        **evidence,
        "digests": {
            "sourceBundlesSha256": canonical_digest(source_bundles),
            "rowsSha256": canonical_digest(rows),
            "materialsSha256": canonical_digest(materials),
            "evidenceSha256": canonical_digest(evidence),
        },
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--decrypted-root",
        type=Path,
        default=Path(os.environ.get("PCR_DECRYPTED_ROOT", DEFAULT_DECRYPTED_ROOT)),
        help="masterdata_decoder .output/decrypted root",
    )
    parser.add_argument("--pretty", action="store_true")
    args = parser.parse_args()
    output = extract(args.decrypted_root)
    print(json.dumps(
        output,
        ensure_ascii=True,
        indent=2 if args.pretty else None,
        separators=None if args.pretty else (",", ":"),
    ))


if __name__ == "__main__":
    main()
