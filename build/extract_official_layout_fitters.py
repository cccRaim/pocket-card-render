#!/usr/bin/env python3
"""Extract LayoutGroup and fitter serialization from official card UI bundles."""

from __future__ import annotations

import argparse
from collections import Counter
import hashlib
import json
import os
from pathlib import Path
import sys
import warnings

import UnityPy

from official_sample import load_official_sample


sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
DEFAULT_UNITY_VERSION = "2022.3.62f2"
DEFAULT_DECRYPTED_ROOT = Path(
    os.environ.get(
        "PCR_DECRYPTED_ROOT",
        "D:/DevProjectes/ptcgp-tools-master/masterdata_decoder/.output/decrypted",
    )
)
DEFAULT_LAYOUT_CONTRACT_PATH = (
    ROOT / "public" / "render" / "card-ui-layout-contract.json"
)
MONO_SCRIPTS_PATH = "UnityMonoScripts"
MONO_SCRIPTS_CAB = "CAB-1e36700dd93ee778e75c5e8df73b6de5"
PREFABS = {
    "pokemon": "Common/CardNew/System/Prefabs/PokemonCardUI.prefab_bundles",
    "trainer": "Common/CardNew/System/Prefabs/TrainersCardUI.prefab_bundles",
}
SCRIPT_PATH_IDS = {
    "LayoutElement": -8545018526213454877,
    "HorizontalLayoutGroup": -3229211799126679632,
    "VerticalLayoutGroup": -4621643977240678714,
    "ContentSizeFitter": 93356951997354507,
    "AspectRatioFitter": -4737839932678702425,
}
SCRIPT_FIELDS = ("m_Name", "m_ExecutionOrder", "m_ClassName", "m_Namespace", "m_AssemblyName")
GROUP_FIELDS = (
    "m_Enabled",
    "m_Name",
    "m_Padding",
    "m_ChildAlignment",
    "m_Spacing",
    "m_ChildForceExpandWidth",
    "m_ChildForceExpandHeight",
    "m_ChildControlWidth",
    "m_ChildControlHeight",
    "m_ChildScaleWidth",
    "m_ChildScaleHeight",
    "m_ReverseArrangement",
)
COMPONENT_FIELDS = {
    "LayoutElement": (
        "m_Enabled",
        "m_Name",
        "m_IgnoreLayout",
        "m_MinWidth",
        "m_MinHeight",
        "m_PreferredWidth",
        "m_PreferredHeight",
        "m_FlexibleWidth",
        "m_FlexibleHeight",
        "m_LayoutPriority",
    ),
    "HorizontalLayoutGroup": GROUP_FIELDS,
    "VerticalLayoutGroup": GROUP_FIELDS,
    "ContentSizeFitter": (
        "m_Enabled",
        "m_Name",
        "m_HorizontalFit",
        "m_VerticalFit",
    ),
    "AspectRatioFitter": (
        "m_Enabled",
        "m_Name",
        "m_AspectMode",
        "m_AspectRatio",
    ),
}
RECT_FIELDS = (
    "m_LocalScale",
    "m_AnchorMin",
    "m_AnchorMax",
    "m_AnchoredPosition",
    "m_SizeDelta",
    "m_Pivot",
)

UnityPy.config.FALLBACK_UNITY_VERSION = os.environ.get(
    "PCR_UNITY_VERSION",
    DEFAULT_UNITY_VERSION,
)
warnings.filterwarnings("ignore", category=Warning, module=r"UnityPy\..*")


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def pointer(value: object) -> tuple[int, int]:
    if not isinstance(value, dict):
        return (0, 0)
    return (int(value.get("m_FileID", 0)), int(value.get("m_PathID", 0)))


def serializable(value: object) -> object:
    if isinstance(value, dict):
        return {str(key): serializable(item) for key, item in value.items()}
    if isinstance(value, list):
        return [serializable(item) for item in value]
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    raise TypeError(f"unsupported serialized value {type(value)}")


def flatten_layout_nodes(layout_contract: dict, kind: str) -> dict[int, dict]:
    prefab = next(item for item in layout_contract["prefabs"] if item["kind"] == kind)
    result: dict[int, dict] = {}

    def visit(node: dict, parent_path: str) -> None:
        name = node["gameObject"]["name"]
        segment = f"{name}[{node['siblingIndex']}]"
        hierarchy_path = f"{parent_path}/{segment}" if parent_path else segment
        game_object_id = int(node["gameObject"]["pathId"])
        require(game_object_id not in result, f"duplicate GameObject {game_object_id}")
        result[game_object_id] = {
            "hierarchyPath": hierarchy_path,
            "gameObject": node["gameObject"],
            "rectTransform": node["rectTransform"],
        }
        for child in node["children"]:
            visit(child, hierarchy_path)

    for root in prefab["roots"]:
        visit(root, "")
    return result


def extract_scripts(decrypted_root: Path) -> tuple[dict[int, dict], dict]:
    path = decrypted_root / MONO_SCRIPTS_PATH
    data = path.read_bytes()
    env = UnityPy.load(str(path))
    wanted = set(SCRIPT_PATH_IDS.values())
    scripts: dict[int, dict] = {}
    for obj in env.objects:
        path_id = int(obj.path_id)
        if obj.type.name != "MonoScript" or path_id not in wanted:
            continue
        tree = obj.read_typetree()
        scripts[path_id] = {
            "pathId": str(path_id),
            "objectSha256": sha256(obj.get_raw_data()),
            **{field: serializable(tree.get(field)) for field in SCRIPT_FIELDS},
        }
    require(set(scripts) == wanted, "official MonoScript set is incomplete")
    for component_type, path_id in SCRIPT_PATH_IDS.items():
        script = scripts[path_id]
        require(script["m_ClassName"] == component_type, f"MonoScript mismatch for {component_type}")
        require(script["m_Namespace"] == "UnityEngine.UI", f"namespace mismatch for {component_type}")
        require(script["m_AssemblyName"] == "UnityEngine.UI", f"assembly mismatch for {component_type}")
    return scripts, {
        "logicalPath": MONO_SCRIPTS_PATH,
        "cab": MONO_SCRIPTS_CAB,
        "byteLength": len(data),
        "sha256": sha256(data),
    }


def extract_prefab(
    path: Path,
    kind: str,
    logical_path: str,
    layout_nodes: dict[int, dict],
) -> dict:
    data = path.read_bytes()
    env = UnityPy.load(str(path))
    objects = list(env.objects)
    game_objects = {
        int(obj.path_id): obj for obj in objects if obj.type.name == "GameObject"
    }
    rect_by_game_object: dict[int, tuple[object, dict]] = {}
    for obj in objects:
        if obj.type.name != "RectTransform":
            continue
        tree = obj.read_typetree()
        _, owner = pointer(tree.get("m_GameObject"))
        require(owner not in rect_by_game_object, f"duplicate RectTransform owner {owner}")
        rect_by_game_object[owner] = (obj, tree)

    records = []
    for obj in objects:
        if obj.type.name != "MonoBehaviour":
            continue
        try:
            tree = obj.read_typetree()
        except Exception:
            continue
        script_file_id, script_path_id = pointer(tree.get("m_Script"))
        component_type = next(
            (
                name
                for name, expected_path_id in SCRIPT_PATH_IDS.items()
                if expected_path_id == script_path_id
            ),
            None,
        )
        if component_type is None:
            continue
        require(script_file_id == 1, f"{component_type} script is not external file 1")
        externals = obj.assets_file.externals
        require(len(externals) >= 1, f"{logical_path} has no external script CAB")
        require(
            externals[0].name == MONO_SCRIPTS_CAB,
            f"{logical_path} external file 1 is not official UnityMonoScripts",
        )
        _, owner = pointer(tree.get("m_GameObject"))
        require(owner in game_objects, f"{component_type} owner GameObject missing")
        require(owner in rect_by_game_object, f"{component_type} owner RectTransform missing")
        require(owner in layout_nodes, f"{component_type} owner absent from layout contract")
        rect_obj, rect_tree = rect_by_game_object[owner]
        layout_node = layout_nodes[owner]
        require(
            str(rect_obj.path_id) == layout_node["rectTransform"]["pathId"],
            f"{component_type} RectTransform join changed",
        )
        require(
            sha256(rect_obj.get_raw_data())
            == layout_node["rectTransform"]["objectSha256"],
            f"{component_type} RectTransform bytes differ from layout contract",
        )
        fields = COMPONENT_FIELDS[component_type]
        require(all(field in tree for field in fields), f"{component_type} fields incomplete")
        records.append(
            {
                "componentType": component_type,
                "componentPathId": str(obj.path_id),
                "componentObjectSha256": sha256(obj.get_raw_data()),
                "script": {
                    "fileId": script_file_id,
                    "pathId": str(script_path_id),
                },
                "gameObject": {
                    "pathId": str(owner),
                    "objectSha256": sha256(game_objects[owner].get_raw_data()),
                    "name": str(game_objects[owner].read_typetree().get("m_Name", "")),
                    "activeSelf": bool(
                        game_objects[owner].read_typetree().get("m_IsActive", 0)
                    ),
                    "hierarchyPath": layout_node["hierarchyPath"],
                },
                "rectTransform": {
                    "pathId": str(rect_obj.path_id),
                    "objectSha256": sha256(rect_obj.get_raw_data()),
                    "serialized": {
                        field: serializable(rect_tree.get(field)) for field in RECT_FIELDS
                    },
                },
                "serialized": {
                    field: serializable(tree.get(field)) for field in fields
                },
            }
        )
    records.sort(
        key=lambda item: (
            item["gameObject"]["hierarchyPath"],
            item["componentType"],
            int(item["componentPathId"]),
        )
    )
    return {
        "kind": kind,
        "logicalPath": logical_path,
        "byteLength": len(data),
        "sha256": sha256(data),
        "components": records,
    }


def observed_contract(prefabs: list[dict]) -> dict:
    records = [record for prefab in prefabs for record in prefab["components"]]
    type_counts = Counter(record["componentType"] for record in records)
    content_modes = Counter()
    aspect_modes = Counter()
    aspect_enabled = Counter()
    reverse_values = Counter()
    layout_ignore_values = Counter()
    layout_priority_values = Counter()
    for record in records:
        serialized = record["serialized"]
        if record["componentType"] == "LayoutElement":
            layout_ignore_values[str(serialized["m_IgnoreLayout"])] += 1
            layout_priority_values[str(serialized["m_LayoutPriority"])] += 1
        elif record["componentType"] == "ContentSizeFitter":
            content_modes[f"{serialized['m_HorizontalFit']},{serialized['m_VerticalFit']}"] += 1
        elif record["componentType"] == "AspectRatioFitter":
            aspect_modes[str(serialized["m_AspectMode"])] += 1
            aspect_enabled[str(serialized["m_Enabled"])] += 1
        else:
            reverse_values[str(serialized["m_ReverseArrangement"])] += 1
    return {
        "componentCount": len(records),
        "componentTypeCounts": dict(sorted(type_counts.items())),
        "contentSizeFitPairs": dict(sorted(content_modes.items())),
        "aspectModes": dict(sorted(aspect_modes.items())),
        "aspectEnabledValues": dict(sorted(aspect_enabled.items())),
        "layoutGroupReverseArrangementValues": dict(sorted(reverse_values.items())),
        "layoutElementIgnoreValues": dict(sorted(layout_ignore_values.items())),
        "layoutElementPriorityValues": dict(sorted(layout_priority_values.items())),
    }


def extract(
    decrypted_root: Path,
    layout_contract_path: Path = DEFAULT_LAYOUT_CONTRACT_PATH,
    manifest_path: Path | None = None,
    unity_version: str = DEFAULT_UNITY_VERSION,
) -> dict:
    UnityPy.config.FALLBACK_UNITY_VERSION = unity_version
    layout_bytes = layout_contract_path.read_bytes()
    layout_contract = json.loads(layout_bytes)
    require(layout_contract["schemaVersion"] == 3, "unsupported card UI layout contract")
    require(layout_contract["unityVersion"] == unity_version, "layout contract Unity version drift")
    sample_loaded = load_official_sample(manifest_path)
    sample = sample_loaded["sample"]
    require(
        sample["unity"]["serializedVersion"] == unity_version,
        "official sample Unity version drift",
    )
    scripts, mono_source = extract_scripts(decrypted_root)
    prefabs = []
    for kind, logical_path in PREFABS.items():
        layout_nodes = flatten_layout_nodes(layout_contract, kind)
        extracted = extract_prefab(
            decrypted_root / logical_path,
            kind,
            logical_path,
            layout_nodes,
        )
        expected = next(
            item for item in layout_contract["prefabs"] if item["kind"] == kind
        )
        require(extracted["byteLength"] == expected["bundleByteSize"], f"{kind} size drift")
        require(extracted["sha256"] == expected["bundleSha256"], f"{kind} hash drift")
        prefabs.append(extracted)

    return {
        "schemaVersion": 1,
        "contractId": "pocket-card-render/official-layout-fitters@1",
        "sample": {
            "sampleId": sample["sampleId"],
            "sampleManifestSha256": sample_loaded["sampleManifestSha256"],
            "gameVersion": sample["game"]["versionName"],
            "unityVersion": unity_version,
            "architecture": sample["game"]["architecture"],
            "libil2cppSha256": sample["artifacts"]["libil2cpp"]["sha256"],
        },
        "sources": {
            "cardUiLayoutContract": {
                "logicalPath": "card-ui-layout-contract.json",
                "byteLength": len(layout_bytes),
                "sha256": sha256(layout_bytes),
            },
            "monoScripts": mono_source,
        },
        "enumContracts": {
            "ContentSizeFitter.FitMode": {
                "Unconstrained": 0,
                "MinSize": 1,
                "PreferredSize": 2,
            },
            "AspectRatioFitter.AspectMode": {
                "None": 0,
                "WidthControlsHeight": 1,
                "HeightControlsWidth": 2,
                "FitInParent": 3,
                "EnvelopeParent": 4,
            },
            "TextAnchor": {
                "UpperLeft": 0,
                "UpperCenter": 1,
                "UpperRight": 2,
                "MiddleLeft": 3,
                "MiddleCenter": 4,
                "MiddleRight": 5,
                "LowerLeft": 6,
                "LowerCenter": 7,
                "LowerRight": 8,
            },
        },
        "scripts": {
            component_type: scripts[path_id]
            for component_type, path_id in SCRIPT_PATH_IDS.items()
        },
        "prefabs": prefabs,
        "observed": observed_contract(prefabs),
        "nativeProducerBoundaries": [
            {
                "id": "layout-element-measurement",
                "status": "native-runtime-required",
                "methods": [
                    "UnityEngine.UI.LayoutUtility.GetLayoutProperty",
                    "TMPro.TextMeshProUGUI.CalculateLayoutInputHorizontal",
                    "TMPro.TextMeshProUGUI.CalculateLayoutInputVertical",
                ],
                "requiredEvidence": "official implicit TMP/Image ILayoutElement outputs and per-frame preferred metrics; serialized LayoutElement components are extracted above",
            },
            {
                "id": "layout-child-discovery",
                "status": "native-runtime-required",
                "methods": ["UnityEngine.UI.LayoutGroup.CalculateLayoutInputHorizontal"],
                "requiredEvidence": "official activeInHierarchy, ILayoutIgnorer decisions, and sibling order",
            },
            {
                "id": "layout-rebuild-scheduler",
                "status": "native-runtime-required",
                "methods": [
                    "UnityEngine.UI.LayoutRebuilder.Rebuild",
                    "UnityEngine.UI.LayoutRebuilder.PerformLayoutCalculation",
                    "UnityEngine.UI.LayoutRebuilder.PerformLayoutControl",
                ],
                "requiredEvidence": "official dirty roots, horizontal/vertical traversal order, and repeated-pass convergence",
            },
            {
                "id": "recttransform-native-write",
                "status": "native-runtime-required",
                "methods": [
                    "UnityEngine.RectTransform.SetSizeWithCurrentAnchors",
                    "UnityEngine.DrivenRectTransformTracker.Add",
                ],
                "requiredEvidence": "official native RectTransform writeback and driven-property lifecycle",
            },
            {
                "id": "aspect-parent-validity",
                "status": "native-runtime-required",
                "methods": [
                    "UnityEngine.UI.AspectRatioFitter.UpdateRect",
                    "UnityEngine.UI.AspectRatioFitter.IsComponentValidOnObject",
                ],
                "requiredEvidence": "official cached parent existence and root non-world Canvas validity at execution time",
            },
        ],
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--decrypted-root", type=Path, default=DEFAULT_DECRYPTED_ROOT)
    parser.add_argument(
        "--layout-contract",
        type=Path,
        default=Path(
            os.environ.get(
                "PCR_CARD_UI_LAYOUT_CONTRACT",
                DEFAULT_LAYOUT_CONTRACT_PATH,
            )
        ),
    )
    parser.add_argument("--manifest", type=Path)
    parser.add_argument(
        "--unity-version",
        default=os.environ.get("PCR_UNITY_VERSION", DEFAULT_UNITY_VERSION),
    )
    args = parser.parse_args()
    print(
        json.dumps(
            extract(
                args.decrypted_root.resolve(),
                args.layout_contract.resolve(),
                args.manifest,
                args.unity_version,
            ),
            ensure_ascii=True,
            separators=(",", ":"),
        )
    )


if __name__ == "__main__":
    main()
