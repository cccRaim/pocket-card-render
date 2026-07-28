#!/usr/bin/env python3
"""Extract byte-pinned CardMarbleLayer code and serialized component evidence."""

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
    "cPK_20_007480_00_MASSIVOONex_SR",
    "cPK_20_007800_00_AKUZIKINGex_SR",
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

# Ranges are ordered by RVA, not by declaration order in dump.cs. The end of
# each range is the next IL2CPP method entry in this native code block.
METHOD_RANGES = {
    "Awake": (0x44207A4, 0x44207D4),
    "Validate": (0x44207D4, 0x44209EC),
    "Initialize": (0x44209EC, 0x4420B0C),
    "UpdateCurveTextures": (0x4420B0C, 0x4420B24),
    "FixedUpdate": (0x4420B24, 0x4420B54),
    "OnValidate": (0x4420B54, 0x4420B6C),
    "UpdateTilt": (0x4420B6C, 0x4420DB4),
    "UpdateMarble": (0x4420DB4, 0x4420E9C),
    "ApplyParams": (0x4420E9C, 0x44210A4),
    "UpdatePointGoals": (0x44210A4, 0x44211D8),
    "UpdatePosition": (0x44211D8, 0x4421564),
    "RemapCurveSettings.UpdateRemapTex": (0x4421564, 0x442193C),
    "RemapCurveSettings.ApplyParams": (0x442193C, 0x442197C),
    "OnDestroy": (0x442197C, 0x4421994),
    "RemapCurveSettings.DisposeTexture": (0x4421994, 0x4421A50),
    ".ctor": (0x4421A50, 0x4421AE4),
    "RemapCurveSettings..ctor": (0x4421AE4, 0x4421B98),
    ".cctor": (0x4421B98, 0x4421D08),
    "Point..ctor": (0x4421D08, 0x4421D10),
    "RemapCurveSettings.get_RemapCurveId": (0x4421D10, 0x4421D1C),
    "RemapCurveSettings.get_TextureResolution": (0x4421D1C, 0x4421D5C),
}

COMPONENT_FIELDS = {
    "m_GameObject",
    "m_Enabled",
    "m_Script",
    "m_Name",
    "_renderer",
    "_tiltPower",
    "_useMarbleDelay",
    "_delayTime2",
    "_pointAccel",
    "_shearAccel",
    "_dorodoroDistance",
    "_resistancePower",
    "_minDorodoroCoef",
    "_maxPointSpeed",
    "_minPointSpeed",
    "_goalThreshold",
    "_pointMoveByTilt",
    "_pointForceChangeByTilt",
    "_points",
    "_defaultNoiseRemapSettings",
}
POINT_FIELDS = {
    "DefaultPosition",
    "TiltMovePosition",
    "RotationWithTilt",
    "DefaultForce",
    "TiltForce",
}
REMAP_FIELDS = {
    "CurveLabel",
    "Resolution",
    "DefaultRemapCurve",
    "TiltRemapCurve",
    "RemapRemapCurve",
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


def pptr_identity(owner, pointer: dict) -> str:
    file_id = int((pointer or {}).get("m_FileID", 0))
    path_id = int((pointer or {}).get("m_PathID", 0))
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


def read_component(path: Path) -> dict:
    bundle = path.read_bytes()
    environment = UnityPy.load(str(path))
    matches = []
    for obj in environment.objects:
        if obj.type.name != "MonoBehaviour":
            continue
        tree = obj.read_typetree()
        if "_defaultNoiseRemapSettings" in tree:
            matches.append((obj, tree))
    if len(matches) != 1:
        raise RuntimeError(f"{path}: expected one CardMarbleLayer, got {len(matches)}")
    obj, tree = matches[0]
    if set(tree) != COMPONENT_FIELDS:
        raise RuntimeError(
            f"{path}: CardMarbleLayer TypeTree drift; "
            f"missing={sorted(COMPONENT_FIELDS - set(tree))}, "
            f"extra={sorted(set(tree) - COMPONENT_FIELDS)}"
        )
    points = tree["_points"] or []
    if (
        not points
        or len(points) > 4
        or any(set(point or {}) != POINT_FIELDS for point in points)
    ):
        raise RuntimeError(f"{path}: CardMarbleLayer Point layout drift")
    remap = tree["_defaultNoiseRemapSettings"] or {}
    if set(remap) != REMAP_FIELDS:
        raise RuntimeError(f"{path}: CardMarbleLayer RemapCurveSettings layout drift")
    raw = bytes(obj.get_raw_data())
    renderer_identity = pptr_identity(obj, tree["_renderer"])
    scalar_map = {
        "tiltPower": "_tiltPower",
        "delayTime2": "_delayTime2",
        "pointAccel": "_pointAccel",
        "shearAccel": "_shearAccel",
        "dorodoroDistance": "_dorodoroDistance",
        "resistancePower": "_resistancePower",
        "minDorodoroCoef": "_minDorodoroCoef",
        "maxPointSpeed": "_maxPointSpeed",
        "minPointSpeed": "_minPointSpeed",
        "goalThreshold": "_goalThreshold",
        "pointMoveByTilt": "_pointMoveByTilt",
        "pointForceChangeByTilt": "_pointForceChangeByTilt",
    }
    config = {
        "componentIdentity": f"{obj.assets_file.name}:{int(obj.path_id)}",
        "componentGoIdentity": pptr_identity(obj, tree["m_GameObject"]),
        "scriptIdentity": pptr_identity(obj, tree["m_Script"]),
        "rendererBindings": [renderer_identity],
        "useMarbleDelay": tree["_useMarbleDelay"],
        "points": [
            {
                "defaultPosition": point["DefaultPosition"],
                "tiltMovePosition": point["TiltMovePosition"],
                "rotationWithTilt": point["RotationWithTilt"],
                "defaultForce": point["DefaultForce"],
                "tiltForce": point["TiltForce"],
            }
            for point in points
        ],
        "defaultNoiseRemapSettings": {
            "curveLabel": remap["CurveLabel"],
            "resolution": remap["Resolution"],
            "defaultRemapCurve": curve_payload(
                remap["DefaultRemapCurve"] or {},
                "DefaultRemapCurve",
            ),
            "tiltRemapCurve": curve_payload(
                remap["TiltRemapCurve"] or {},
                "TiltRemapCurve",
            ),
            "remapRemapCurve": curve_payload(
                remap["RemapRemapCurve"] or {},
                "RemapRemapCurve",
            ),
        },
        **{name: tree[field] for name, field in scalar_map.items()},
    }
    return {
        "cardId": path.name.removesuffix("_L.prefab_bundles"),
        "bundleByteLength": len(bundle),
        "bundleSha256": sha256(bundle),
        "rawByteLength": len(raw),
        "rawSha256": sha256(raw),
        "config": config,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest")
    parser.add_argument("--apkm")
    parser.add_argument("--prefab", type=Path, action="append")
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

    prefabs = tuple(args.prefab or DEFAULT_PREFABS)
    print(json.dumps({
        "schema": "pocket-card-render/official-card-marble-evidence@1",
        "source": {
            "sampleId": sample["sampleId"],
            "sampleManifestSha256": loaded["sampleManifestSha256"],
            "apkmSha256": sha256(apkm),
            "arm64SplitSha256": sha256(split),
            "libil2cppSha256": sha256(libil2cpp),
        },
        "methods": methods,
        "components": [read_component(path) for path in prefabs],
    }, ensure_ascii=True, separators=(",", ":"), sort_keys=True))


if __name__ == "__main__":
    main()
