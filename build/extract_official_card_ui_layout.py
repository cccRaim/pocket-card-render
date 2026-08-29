#!/usr/bin/env python3
"""Extract the canonical card-face UGUI static component contract."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import sys
import warnings

import UnityPy


sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DECRYPTED_ROOT = Path(
    "D:/DevProjectes/ptcgp-tools-master/masterdata_decoder/.output/decrypted"
)
UNITY_VERSION = "2022.3.62f2"
PREFABS = {
    "pokemon": "Common/CardNew/System/Prefabs/PokemonCardUI.prefab_bundles",
    "trainer": "Common/CardNew/System/Prefabs/TrainersCardUI.prefab_bundles",
}
TMP_FIELDS = (
    "m_Enabled",
    "m_Color",
    "m_RaycastTarget",
    "m_RaycastPadding",
    "m_Maskable",
    "m_isRightToLeft",
    "m_fontColor",
    "m_enableVertexGradient",
    "m_colorMode",
    "m_tintAllSprites",
    "m_TextStyleHashCode",
    "m_overrideHtmlColors",
    "m_fontSize",
    "m_fontSizeBase",
    "m_fontWeight",
    "m_enableAutoSizing",
    "m_fontSizeMin",
    "m_fontSizeMax",
    "m_fontStyle",
    "m_HorizontalAlignment",
    "m_VerticalAlignment",
    "m_textAlignment",
    "m_characterSpacing",
    "m_wordSpacing",
    "m_lineSpacing",
    "m_lineSpacingMax",
    "m_paragraphSpacing",
    "m_charWidthMaxAdj",
    "m_enableWordWrapping",
    "m_wordWrappingRatios",
    "m_overflowMode",
    "m_enableKerning",
    "m_enableExtraPadding",
    "m_isRichText",
    "m_parseCtrlCharacters",
    "m_isOrthographic",
    "m_isCullingEnabled",
    "m_horizontalMapping",
    "m_verticalMapping",
    "m_uvLineOffset",
    "m_geometrySortingOrder",
    "m_IsTextObjectScaleStatic",
    "m_VertexBufferAutoSizeReduction",
    "m_useMaxVisibleDescender",
    "m_pageToDisplay",
    "m_margin",
    "m_isVolumetricText",
    "m_maskOffset",
)
RECT_FIELDS = (
    "m_LocalRotation",
    "m_LocalPosition",
    "m_LocalScale",
    "m_AnchorMin",
    "m_AnchorMax",
    "m_AnchoredPosition",
    "m_SizeDelta",
    "m_Pivot",
)
POINTER_FIELDS = frozenset(("m_Script", "m_Material", "m_Sprite", "m_Camera"))
UI_COMPONENT_KEYS = ("image", "canvasRenderer", "mask", "rectMask2D", "canvas")

UnityPy.config.FALLBACK_UNITY_VERSION = UNITY_VERSION
warnings.filterwarnings("ignore", category=Warning, module=r"UnityPy\..*")


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def pointer(value: object) -> dict:
    if not isinstance(value, dict):
        return {"fileId": 0, "pathId": 0}
    return {
        "fileId": int(value.get("m_FileID", 0)),
        "pathId": int(value.get("m_PathID", 0)),
    }


def serialized_pointer(value: object) -> dict:
    result = pointer(value)
    return {"fileId": result["fileId"], "pathId": str(result["pathId"])}


def serializable(value: object) -> object:
    if isinstance(value, dict):
        return {str(key): serializable(item) for key, item in value.items()}
    if isinstance(value, list):
        return [serializable(item) for item in value]
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    raise TypeError(f"unsupported serialized value {type(value)}")


def serialized_component(obj: object, tree: dict) -> dict:
    result = {
        "pathId": str(obj.path_id),
        "objectSha256": sha256(obj.get_raw_data()),
    }
    for field, value in tree.items():
        if field == "m_GameObject":
            continue
        result[field] = (
            serialized_pointer(value)
            if field in POINTER_FIELDS
            else serializable(value)
        )
    return result


def ui_mono_kind(tree: dict) -> str | None:
    # UnityPy exposes external UGUI scripts through their serialized field shape.
    if "m_Sprite" in tree and "m_PixelsPerUnitMultiplier" in tree:
        return "image"
    if "m_ShowMaskGraphic" in tree:
        return "mask"
    if "m_Padding" in tree and "m_Softness" in tree:
        return "rectMask2D"
    return None


def extract_prefab(path: Path, kind: str, relative: str) -> dict:
    env = UnityPy.load(str(path))
    objects = list(env.objects)
    game_objects = {int(obj.path_id): obj for obj in objects if obj.type.name == "GameObject"}
    rects = {int(obj.path_id): obj for obj in objects if obj.type.name == "RectTransform"}
    card_text_keys = {}
    tmp_by_go = {}
    tag_sizes_by_go = {}
    ui_by_kind: dict[str, dict[int, tuple[object, dict]]] = {
        key: {} for key in UI_COMPONENT_KEYS
    }

    def add_ui_component(component_kind: str, owner: int, obj: object, tree: dict) -> None:
        if owner in ui_by_kind[component_kind]:
            raise ValueError(f"duplicate {component_kind} on GameObject {owner}")
        ui_by_kind[component_kind][owner] = (obj, tree)

    for obj in objects:
        object_type = obj.type.name
        if object_type not in ("MonoBehaviour", "CanvasRenderer", "Canvas"):
            continue
        try:
            tree = obj.read_typetree()
        except Exception:
            continue
        owner = pointer(tree.get("m_GameObject"))["pathId"]
        if not owner:
            continue
        if object_type == "CanvasRenderer":
            add_ui_component("canvasRenderer", owner, obj, tree)
        elif object_type == "Canvas":
            add_ui_component("canvas", owner, obj, tree)
        else:
            component_kind = ui_mono_kind(tree)
            if component_kind is not None:
                add_ui_component(component_kind, owner, obj, tree)
            if "_key" in tree and isinstance(tree["_key"], int):
                card_text_keys.setdefault(owner, int(tree["_key"]))
            if "m_text" in tree:
                tmp_by_go[owner] = (obj, tree)
            if "_elementTagFontSize" in tree and "_exTagFontSize" in tree:
                if owner in tag_sizes_by_go:
                    raise ValueError(f"duplicate localized tag-size component on GameObject {owner}")
                tag_sizes_by_go[owner] = (obj, tree)

    rect_by_go = {}
    for rect_id, obj in rects.items():
        tree = obj.read_typetree()
        rect_by_go[pointer(tree.get("m_GameObject"))["pathId"]] = (rect_id, obj, tree)

    roots = []
    for game_id, (rect_id, _, tree) in rect_by_go.items():
        father = pointer(tree.get("m_Father"))["pathId"]
        if father not in rects:
            roots.append(game_id)

    def node(game_id: int, sibling_index: int) -> dict:
        game_obj = game_objects[game_id]
        game = game_obj.read_typetree()
        rect_id, rect_obj, rect = rect_by_go[game_id]
        result = {
            "gameObject": {
                "pathId": str(game_id),
                "objectSha256": sha256(game_obj.get_raw_data()),
                "name": str(game.get("m_Name", "")),
                "layer": int(game.get("m_Layer", 0)),
                "active": bool(game.get("m_IsActive", 0)),
            },
            "rectTransform": {
                "pathId": str(rect_id),
                "objectSha256": sha256(rect_obj.get_raw_data()),
                **{field: serializable(rect.get(field)) for field in RECT_FIELDS},
            },
            "siblingIndex": sibling_index,
            "children": [],
        }
        if game_id in tmp_by_go:
            tmp_obj, tmp = tmp_by_go[game_id]
            result["tmp"] = {
                "pathId": str(tmp_obj.path_id),
                "objectSha256": sha256(tmp_obj.get_raw_data()),
                "fontAsset": serialized_pointer(tmp.get("m_fontAsset")),
                "sharedMaterial": serialized_pointer(tmp.get("m_sharedMaterial")),
                "fontGroupKey": card_text_keys.get(game_id),
                **{field: serializable(tmp.get(field)) for field in TMP_FIELDS},
            }
        if game_id in tag_sizes_by_go:
            tag_obj, tag_sizes = tag_sizes_by_go[game_id]
            result["tagFontSizes"] = {
                "pathId": str(tag_obj.path_id),
                "objectSha256": sha256(tag_obj.get_raw_data()),
                "element": float(tag_sizes["_elementTagFontSize"]),
                "ex": float(tag_sizes["_exTagFontSize"]),
            }
        for component_kind in UI_COMPONENT_KEYS:
            component = ui_by_kind[component_kind].get(game_id)
            if component is not None:
                result[component_kind] = serialized_component(*component)
        children = [pointer(item)["pathId"] for item in rect.get("m_Children", [])]
        for index, child_rect_id in enumerate(children):
            child_rect = rects.get(child_rect_id)
            if child_rect is None:
                continue
            child_game_id = pointer(child_rect.read_typetree().get("m_GameObject"))["pathId"]
            if child_game_id in game_objects and child_game_id in rect_by_go:
                result["children"].append(node(child_game_id, index))
        return result

    trees = [node(game_id, index) for index, game_id in enumerate(roots)]
    tmp_count = 0
    tag_size_count = 0
    rect_count = 0
    ui_counts = {key: 0 for key in UI_COMPONENT_KEYS}

    def count(entry: dict) -> None:
        nonlocal tmp_count, tag_size_count, rect_count
        rect_count += 1
        tmp_count += int("tmp" in entry)
        tag_size_count += int("tagFontSizes" in entry)
        for component_kind in UI_COMPONENT_KEYS:
            ui_counts[component_kind] += int(component_kind in entry)
        for child in entry["children"]:
            count(child)

    for tree in trees:
        count(tree)
    for component_kind in UI_COMPONENT_KEYS:
        if ui_counts[component_kind] != len(ui_by_kind[component_kind]):
            raise ValueError(f"unattached {component_kind} component in {relative}")
    return {
        "kind": kind,
        "bundle": relative,
        "bundleByteSize": path.stat().st_size,
        "bundleSha256": sha256(path.read_bytes()),
        "rectTransformCount": rect_count,
        "tmpComponentCount": tmp_count,
        "tagFontSizeComponentCount": tag_size_count,
        "imageComponentCount": ui_counts["image"],
        "canvasRendererComponentCount": ui_counts["canvasRenderer"],
        "maskComponentCount": ui_counts["mask"],
        "rectMask2DComponentCount": ui_counts["rectMask2D"],
        "canvasComponentCount": ui_counts["canvas"],
        "roots": trees,
    }


def extract(
    decrypted_root: Path,
    unity_version: str = UNITY_VERSION,
) -> dict:
    UnityPy.config.FALLBACK_UNITY_VERSION = unity_version
    prefabs = [
        extract_prefab(decrypted_root / relative, kind, relative)
        for kind, relative in PREFABS.items()
    ]
    return {
        "schemaVersion": 3,
        "unityVersion": unity_version,
        "source": "official PokemonCardUI/TrainersCardUI prefab bundles",
        "prefabs": prefabs,
        "summary": {
            "prefabCount": len(prefabs),
            "rectTransformCount": sum(item["rectTransformCount"] for item in prefabs),
            "tmpComponentCount": sum(item["tmpComponentCount"] for item in prefabs),
            "tagFontSizeComponentCount": sum(
                item["tagFontSizeComponentCount"] for item in prefabs
            ),
            "imageComponentCount": sum(item["imageComponentCount"] for item in prefabs),
            "canvasRendererComponentCount": sum(
                item["canvasRendererComponentCount"] for item in prefabs
            ),
            "maskComponentCount": sum(item["maskComponentCount"] for item in prefabs),
            "rectMask2DComponentCount": sum(
                item["rectMask2DComponentCount"] for item in prefabs
            ),
            "canvasComponentCount": sum(item["canvasComponentCount"] for item in prefabs),
        },
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--decrypted-root", type=Path, default=DEFAULT_DECRYPTED_ROOT)
    parser.add_argument("--unity-version", default=UNITY_VERSION)
    args = parser.parse_args()
    print(json.dumps(
        extract(args.decrypted_root.resolve(), args.unity_version),
        ensure_ascii=True,
        separators=(",", ":"),
    ))


if __name__ == "__main__":
    main()
