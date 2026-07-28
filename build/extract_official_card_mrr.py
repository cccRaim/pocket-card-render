#!/usr/bin/env python3
"""Extract byte-pinned CardMRRObject, curve, and SearchTag evidence."""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
import re
import warnings
import zipfile
from pathlib import Path

import UnityPy
import UnityPy.config

from extract_official_pass_partition import Elf64
from official_sample import load_official_sample


warnings.simplefilter("ignore")

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_APKS = ROOT.parent / "ptcg-apk-parser" / "apks"
DECRYPTED = (
    ROOT.parent
    / "ptcgp-tools-master"
    / "masterdata_decoder"
    / ".output"
    / "decrypted"
)
CARD_IDS = (
    "cPK_10_012330_00_MEGAABSOLex_RR",
    "cPK_10_013460_00_MEGAMIMILOPex_RR",
)
DEFAULT_PREFABS = tuple(
    DECRYPTED
    / "Common"
    / "CardNew"
    / "Face"
    / card_id
    / "L"
    / "Prefabs"
    / f"{card_id}_L.prefab_bundles"
    for card_id in CARD_IDS
)
DEFAULT_SETTINGS = (
    DECRYPTED
    / "Common"
    / "CardNew"
    / "Common"
    / "Settings"
    / "MRR_FlashAnimation.asset_bundles"
)
SHADER_CASES = (
    (
        "Effect_Emit",
        DECRYPTED
        / "Common"
        / "Shader"
        / "Common"
        / "CardNew"
        / "Effect"
        / "Card_Effect_Emit.shader_bundles",
        "Card-Effect-Emit",
    ),
    (
        "Flash",
        DECRYPTED
        / "Common"
        / "Shader"
        / "Common"
        / "CardNew"
        / "ShadowBox"
        / "Card_ShadowBox_Flash.shader_bundles",
        "MRR-ChangeColor-Lighting",
    ),
    (
        "Card_Parallax_MRR",
        DECRYPTED
        / "Common"
        / "Shader"
        / "Common"
        / "CardNew"
        / "Parallax"
        / "Card_Parallax_MRR.shader_bundles",
        "MRR-ChangeColor-Lighting",
    ),
    (
        "Card_Parallax_Flash",
        DECRYPTED
        / "Common"
        / "Shader"
        / "Common"
        / "CardNew"
        / "Parallax"
        / "Card_Parallax_Flash.shader_bundles",
        "MRR-Parallax-Flash",
    ),
    (
        "Frame-Holo-2Layer",
        DECRYPTED
        / "Common"
        / "Shader"
        / "Common"
        / "CardNew"
        / "Frame"
        / "Card_Frame_Holo_2Layer.shader_bundles",
        "Frame-Holo-2Layer",
    ),
)

METHOD_RANGES = {
    "Awake": (0x4425310, 0x4425328),
    "Initialize": (0x4425328, 0x4425414),
    "LateUpdate": (0x4425414, 0x442543C),
    "Validate": (0x442543C, 0x4425838),
    "EvaluateAnim": (0x4425838, 0x4425A9C),
    "UpdateTilt": (0x4425A9C, 0x4425CEC),
    "UpdateAnimation": (0x4425CEC, 0x4425F3C),
    "ApplyParams": (0x4425F3C, 0x4426384),
    ".ctor": (0x4426384, 0x4426454),
    ".cctor": (0x4426454, 0x442674C),
}

COMPONENT_FIELDS = {
    "m_GameObject",
    "m_Enabled",
    "m_Script",
    "m_Name",
    "_animStartDegree",
    "_animTimeScale",
    "_settings",
    "_animDuration",
    "_flashRadialStartOffset",
    "_useSpeedAdjust",
    "_recordingTime",
    "_minTiltSpeed",
    "_maxTiltSpeed",
    "_minAnimSpeed",
    "_maxAnimSpeed",
}
SETTINGS_CURVES = (
    "ChangeColorCurve",
    "LightColorIntensityCurve",
    "LightEmitIntensityCurve",
    "LightPower",
    "Layer2UVXTranslateByTiltingLeft",
    "Layer2UVXTranslateByTiltingRight",
    "Layer2ColorPower",
    "Layer2EmissiveIntensity",
    "EffSwitchColor",
    "EffAdditiveIntensity",
    "EffColor3Blend",
    "EffEmissiveIntensity",
    "FlashIntensity",
    "FlashRadialScaling",
    "FlashRadialAnim",
)
SETTINGS_FIELDS = {
    "m_GameObject",
    "m_Enabled",
    "m_Script",
    "m_Name",
    *SETTINGS_CURVES,
}
CURVE_FIELDS = (
    "time",
    "value",
    "inSlope",
    "outSlope",
    "weightedMode",
    "inWeight",
    "outWeight",
)


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def verify_artifact(data: bytes, artifact: dict, label: str) -> None:
    if len(data) != artifact["byteLength"] or sha256(data) != artifact["sha256"]:
        raise RuntimeError(f"{label} does not match selected official sample")


def pointer_path_id(pointer: dict | None) -> int:
    return int((pointer or {}).get("m_PathID", 0))


def pptr_identity(owner, pointer: dict) -> str:
    file_id = int((pointer or {}).get("m_FileID", 0))
    path_id = pointer_path_id(pointer)
    if file_id == 0:
        source = owner.assets_file.name
    else:
        external = owner.assets_file.externals[file_id - 1]
        match = re.search(r"(CAB-[0-9a-f]+)", external.path, re.IGNORECASE)
        source = match.group(1) if match else external.path.replace("\\", "/")
    return f"{source}:{path_id}"


def curve_payload(curve: dict, label: str) -> dict:
    keys = curve.get("m_Curve") or []
    if len(keys) < 2 or any(
        not set(CURVE_FIELDS).issubset(key or {}) for key in keys
    ):
        raise RuntimeError(f"{label}: incomplete AnimationCurve")
    return {
        "keys": [{field: key[field] for field in CURVE_FIELDS} for key in keys],
        "preInfinity": curve.get("m_PreInfinity"),
        "postInfinity": curve.get("m_PostInfinity"),
        "rotationOrder": curve.get("m_RotationOrder"),
    }


def descendant_renderer_identities(environment, root_go_id: int) -> list[str]:
    transform_go = {}
    parent_transform_by_go = {}
    renderers = []
    for obj in environment.objects:
        if obj.type.name == "Transform":
            tree = obj.read_typetree()
            go_id = pointer_path_id(tree.get("m_GameObject"))
            transform_go[int(obj.path_id)] = go_id
            parent_transform_by_go[go_id] = pointer_path_id(tree.get("m_Father"))
        elif obj.type.name in {"MeshRenderer", "SkinnedMeshRenderer"}:
            tree = obj.read_typetree()
            renderers.append((obj, pointer_path_id(tree.get("m_GameObject"))))
    result = []
    for renderer, go_id in renderers:
        current = go_id
        seen = set()
        while current and current not in seen:
            if current == root_go_id:
                result.append(
                    f"{renderer.assets_file.name}:{int(renderer.path_id)}"
                )
                break
            seen.add(current)
            current = transform_go.get(
                parent_transform_by_go.get(current, 0),
                0,
            )
    return sorted(result)


def read_component(path: Path) -> dict:
    bundle = path.read_bytes()
    environment = UnityPy.load(str(path))
    matches = []
    for obj in environment.objects:
        if obj.type.name != "MonoBehaviour":
            continue
        tree = obj.read_typetree()
        if "_recordingTime" in tree and "_flashRadialStartOffset" in tree:
            matches.append((obj, tree))
    if len(matches) != 1:
        raise RuntimeError(f"{path}: expected one CardMRRObject, got {len(matches)}")
    obj, tree = matches[0]
    if set(tree) != COMPONENT_FIELDS:
        raise RuntimeError(
            f"{path}: CardMRRObject TypeTree drift; "
            f"missing={sorted(COMPONENT_FIELDS - set(tree))}, "
            f"extra={sorted(set(tree) - COMPONENT_FIELDS)}"
        )
    raw = bytes(obj.get_raw_data())
    scalar_map = {
        "animStartDegree": "_animStartDegree",
        "animTimeScale": "_animTimeScale",
        "animDuration": "_animDuration",
        "flashRadialStartOffset": "_flashRadialStartOffset",
        "recordingTime": "_recordingTime",
        "minTiltSpeed": "_minTiltSpeed",
        "maxTiltSpeed": "_maxTiltSpeed",
        "minAnimSpeed": "_minAnimSpeed",
        "maxAnimSpeed": "_maxAnimSpeed",
    }
    return {
        "cardId": path.name.removesuffix("_L.prefab_bundles"),
        "bundleByteLength": len(bundle),
        "bundleSha256": sha256(bundle),
        "rawByteLength": len(raw),
        "rawSha256": sha256(raw),
        "config": {
            "componentIdentity": f"{obj.assets_file.name}:{int(obj.path_id)}",
            "componentGoIdentity": pptr_identity(obj, tree["m_GameObject"]),
            "scriptIdentity": pptr_identity(obj, tree["m_Script"]),
            "animationSettingsIdentity": pptr_identity(obj, tree["_settings"]),
            "useSpeedAdjust": tree["_useSpeedAdjust"],
            **{name: tree[field] for name, field in scalar_map.items()},
        },
        "descendantRendererIdentities": descendant_renderer_identities(
            environment,
            pointer_path_id(tree["m_GameObject"]),
        ),
    }


def read_settings(path: Path) -> dict:
    bundle = path.read_bytes()
    environment = UnityPy.load(str(path))
    matches = []
    for obj in environment.objects:
        if obj.type.name != "MonoBehaviour":
            continue
        tree = obj.read_typetree()
        if "ChangeColorCurve" in tree:
            matches.append((obj, tree))
    if len(matches) != 1:
        raise RuntimeError(f"{path}: expected one MRRAnimationSettings")
    obj, tree = matches[0]
    if set(tree) != SETTINGS_FIELDS:
        raise RuntimeError(
            f"{path}: MRRAnimationSettings TypeTree drift; "
            f"missing={sorted(SETTINGS_FIELDS - set(tree))}, "
            f"extra={sorted(set(tree) - SETTINGS_FIELDS)}"
        )
    raw = bytes(obj.get_raw_data())
    return {
        "bundleByteLength": len(bundle),
        "bundleSha256": sha256(bundle),
        "rawByteLength": len(raw),
        "rawSha256": sha256(raw),
        "settings": {
            "identity": f"{obj.assets_file.name}:{int(obj.path_id)}",
            "name": tree["m_Name"],
            "scriptIdentity": pptr_identity(obj, tree["m_Script"]),
            "curves": {
                name: curve_payload(tree[name] or {}, name)
                for name in SETTINGS_CURVES
            },
        },
    }


def read_shader(label: str, path: Path, expected_search_tag: str) -> dict:
    bundle = path.read_bytes()
    environment = UnityPy.load(str(path))
    shaders = [obj for obj in environment.objects if obj.type.name == "Shader"]
    if len(shaders) != 1:
        raise RuntimeError(f"{path}: expected one Shader")
    obj = shaders[0]
    tree = obj.read_typetree()
    parsed = tree.get("m_ParsedForm") or {}
    subshaders = parsed.get("m_SubShaders") or []
    if len(subshaders) != 1:
        raise RuntimeError(f"{path}: expected one SubShader")
    tags = dict((subshaders[0].get("m_Tags") or {}).get("tags") or [])
    if tags.get("SearchTag") != expected_search_tag:
        raise RuntimeError(f"{path}: SearchTag drift")
    raw = bytes(obj.get_raw_data())
    return {
        "label": label,
        "shaderName": parsed.get("m_Name"),
        "shaderIdentity": f"{obj.assets_file.name}:{int(obj.path_id)}",
        "searchTag": expected_search_tag,
        "subShaderTags": tags,
        "bundleByteLength": len(bundle),
        "bundleSha256": sha256(bundle),
        "rawByteLength": len(raw),
        "rawSha256": sha256(raw),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest")
    parser.add_argument("--apkm")
    parser.add_argument("--prefab", type=Path, action="append")
    parser.add_argument("--settings", type=Path)
    args = parser.parse_args()

    loaded = load_official_sample(args.manifest)
    sample = loaded["sample"]
    UnityPy.config.FALLBACK_UNITY_VERSION = sample["unity"]["serializedVersion"]
    apkm_path = Path(
        args.apkm
        or os.environ.get(
            "PCR_APKM",
            DEFAULT_APKS / sample["game"]["apkmBasename"],
        )
    )
    apkm = apkm_path.read_bytes()
    verify_artifact(apkm, sample["artifacts"]["apkm"], "APKM")
    with zipfile.ZipFile(io.BytesIO(apkm)) as outer:
        split = outer.read(sample["artifacts"]["arm64Split"]["entry"])
    verify_artifact(split, sample["artifacts"]["arm64Split"], "ARM64 split")
    with zipfile.ZipFile(io.BytesIO(split)) as inner:
        libil2cpp = inner.read("lib/arm64-v8a/libil2cpp.so")
    verify_artifact(libil2cpp, sample["artifacts"]["libil2cpp"], "libil2cpp")

    elf = Elf64(libil2cpp)
    methods = {}
    for name, (start, end) in METHOD_RANGES.items():
        body = elf.range(start, end)
        methods[name] = {
            "rva": start,
            "byteLength": len(body),
            "sha256": sha256(body),
        }

    print(json.dumps({
        "schema": "pocket-card-render/official-card-mrr-evidence@1",
        "source": {
            "sampleId": sample["sampleId"],
            "sampleManifestSha256": loaded["sampleManifestSha256"],
            "apkmSha256": sha256(apkm),
            "arm64SplitSha256": sha256(split),
            "libil2cppSha256": sha256(libil2cpp),
        },
        "methods": methods,
        "components": [
            read_component(path)
            for path in tuple(args.prefab or DEFAULT_PREFABS)
        ],
        "animationSettings": read_settings(args.settings or DEFAULT_SETTINGS),
        "shaderSearchTags": [
            read_shader(label, path, search_tag)
            for label, path, search_tag in SHADER_CASES
        ],
    }, ensure_ascii=True, separators=(",", ":"), sort_keys=True))


if __name__ == "__main__":
    main()
