#!/usr/bin/env python3
"""Extract renderer sort inputs from the four official L prefab bundles."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import warnings
import re

import UnityPy


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DECRYPTED_ROOT = Path(
    "D:/DevProjectes/ptcgp-tools-master/masterdata_decoder/.output/decrypted"
)
CARD_IDS = (
    "cPK_10_000040_00_FUSHIGIBANAex_RR",
    "cTR_20_000230_00_LEAF_SR",
    "cTR_20_000670_00_IIBUINOBAKKU_UR",
    "cPK_20_008900_02_HOUOUex_UR",
)

UnityPy.config.FALLBACK_UNITY_VERSION = "2022.3.62f2"
warnings.filterwarnings("ignore", category=Warning, module=r"UnityPy\..*")


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def pptr_path_id(value) -> int:
    pointer = value.get("component", value) if isinstance(value, dict) else {}
    return int(pointer.get("m_PathID", 0))


def object_identity(obj) -> dict:
    source = obj.assets_file.name
    path_id = int(obj.path_id)
    return {
        "pathId": str(path_id),
        "source": source,
        "identity": f"{source}:{path_id}",
    }


def pptr_identity(owner, pointer: dict) -> dict:
    file_id = int((pointer or {}).get("m_FileID", 0))
    path_id = int((pointer or {}).get("m_PathID", 0))
    if file_id == 0:
        source = owner.assets_file.name
    else:
        external = owner.assets_file.externals[file_id - 1]
        match = re.search(r"(CAB-[0-9a-f]+)", external.path, re.IGNORECASE)
        source = match.group(1) if match else external.path.replace("\\", "/")
    return {
        "fileId": file_id,
        "pathId": str(path_id),
        "source": source,
        "identity": f"{source}:{path_id}",
    }


def renderer_record(obj, objects) -> dict:
    tree = obj.read_typetree()
    raw = obj.get_raw_data()
    game_object_path_id = int((tree.get("m_GameObject") or {}).get("m_PathID", 0))
    game_object = objects[game_object_path_id]
    game_object_tree = game_object.read_typetree()
    mesh_filters = []
    for component in game_object_tree.get("m_Component", []) or []:
        candidate = objects.get(pptr_path_id(component))
        if candidate is not None and candidate.type.name == "MeshFilter":
            mesh_filters.append(candidate)
    if len(mesh_filters) != 1:
        raise RuntimeError(
            f"MeshRenderer {obj.path_id} GameObject {game_object_path_id} has {len(mesh_filters)} MeshFilters"
        )
    mesh_filter = mesh_filters[0]
    mesh_pointer = mesh_filter.read_typetree().get("m_Mesh") or {}
    mesh = pptr_identity(mesh_filter, mesh_pointer)
    materials = [
        pptr_identity(obj, pointer)
        for pointer in tree.get("m_Materials", []) or []
    ]
    return {
        "pathId": str(obj.path_id),
        "identity": object_identity(obj),
        "byteSize": len(raw),
        "sha256": sha256(raw),
        "rendererType": obj.type.name,
        "gameObjectPathId": str(game_object_path_id),
        "gameObjectName": game_object_tree.get("m_Name", ""),
        "meshFilterPathId": str(mesh_filter.path_id),
        "mesh": mesh,
        "materials": materials,
        "rendererPriority": tree.get("m_RendererPriority"),
        "renderingLayerMask": tree.get("m_RenderingLayerMask"),
        "sortingLayerId": tree.get("m_SortingLayerID"),
        "sortingLayerValue": tree.get("m_SortingLayer"),
        "sortingOrder": tree.get("m_SortingOrder"),
        "sortingFudgePresent": "m_SortingFudge" in tree,
        "sortingFudge": tree.get("m_SortingFudge"),
        "lightmapIndex": tree.get("m_LightmapIndex"),
        "lightmapIndexDynamic": tree.get("m_LightmapIndexDynamic"),
        "staticBatchInfo": tree.get("m_StaticBatchInfo"),
        "staticBatchRootPathId": str((tree.get("m_StaticBatchRoot") or {}).get("m_PathID", 0)),
        "staticShadowCaster": tree.get("m_StaticShadowCaster"),
        "materialReferenceCount": len(materials),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--decrypted-root", type=Path, default=DEFAULT_DECRYPTED_ROOT)
    args = parser.parse_args()

    cards = {}
    for card_id in CARD_IDS:
        relative = Path("Common/CardNew/Face") / card_id / "L/Prefabs" / f"{card_id}_L.prefab_bundles"
        bundle_path = args.decrypted_root / relative
        bundle = bundle_path.read_bytes()
        env = UnityPy.load(str(bundle_path))
        objects = {int(obj.path_id): obj for obj in env.objects}
        renderers = sorted(
            (renderer_record(obj, objects) for obj in env.objects if obj.type.name.endswith("Renderer")),
            key=lambda row: int(row["pathId"]),
        )
        aggregate = "\n".join(
            f'{row["pathId"]}:{row["byteSize"]}:{row["sha256"]}' for row in renderers
        ).encode("ascii")
        cards[card_id] = {
            "bundle": {
                "relativePath": relative.as_posix(),
                "byteSize": len(bundle),
                "sha256": sha256(bundle),
            },
            "rendererCount": len(renderers),
            "distinctMeshIdentityCount": len({row["mesh"]["identity"] for row in renderers}),
            "lodGroupCount": sum(1 for obj in env.objects if obj.type.name == "LODGroup"),
            "materialReferenceCount": sum(row["materialReferenceCount"] for row in renderers),
            "rendererAggregateSha256": sha256(aggregate),
            "renderers": renderers,
        }

    print(json.dumps({
        "schemaVersion": 5,
        "unityVersion": UnityPy.config.FALLBACK_UNITY_VERSION,
        "cards": cards,
        "distinctMeshIdentityCount": len({
            row["mesh"]["identity"]
            for card in cards.values()
            for row in card["renderers"]
        }),
    }, ensure_ascii=True, separators=(",", ":")))


if __name__ == "__main__":
    main()
