#!/usr/bin/env python3
"""Extract byte-pinned CardAncientObject and AncientBGAnimation evidence."""

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
DEFAULT_PREFAB = (
    DECRYPTED
    / "Common"
    / "CardNew"
    / "Face"
    / "cPK_20_018410_00_HABATAKUKAMIex_SR"
    / "L"
    / "Prefabs"
    / "cPK_20_018410_00_HABATAKUKAMIex_SR_L.prefab_bundles"
)
DEFAULT_SETTINGS = (
    DECRYPTED
    / "Common"
    / "CardNew"
    / "Common"
    / "Settings"
    / "AncientBGAnimation.asset_bundles"
)

METHOD_RANGES = {
    "get_IsAnimationStopped": (0x4421D5C, 0x4421D64),
    "set_IsAnimationStopped": (0x4421D64, 0x4421D6C),
    "Awake": (0x4421D6C, 0x4421D8C),
    "Validate": (0x4421D8C, 0x4422004),
    "Initialize": (0x4422004, 0x4422744),
    "LateUpdate": (0x4422744, 0x4422798),
    "UpdateTilt": (0x4422798, 0x4422B50),
    "UpdateStrataFaults": (0x4422B50, 0x4422B84),
    "UpdateShake": (0x4422B84, 0x4422D60),
    "UpdateSandVolumes": (0x4422D60, 0x4423040),
    "ApplyParams": (0x4423040, 0x44231A0),
    "SetEmissionRate": (0x44231A0, 0x442330C),
    "UpdateStrataFault": (0x442330C, 0x44235D4),
    ".ctor": (0x44235D4, 0x4423700),
    ".cctor": (0x4423700, 0x44237E4),
    "StrataData..ctor": (0x44237E4, 0x44237FC),
}

COMPONENT_FIELDS = {
    "m_GameObject",
    "m_Enabled",
    "m_Script",
    "m_Name",
    "_animCurveSettings",
    "_animCurveScale",
    "_animStartDelayRangeA",
    "_animStartDelayRangeB",
    "_changeRangeStart",
    "_changeRangeEnd",
    "_zuzuGoalAnimThreshold",
    "_goalThreshold",
    "_scrolls",
    "_scrollLength",
    "_shapeChangeSpeed",
    "_dot2Multiply",
    "_accellRatio",
    "_diffOffset",
    "_shakeAIntensity",
    "_shakeAFrequency",
    "_shakeBIntensity",
    "_shakeBFrequency",
    "_shakeSpeed",
    "_noiseScale",
    "_sandParticleSystems",
    "_sand2ParticleSystems",
    "_frictionScale",
    "_maxFriction",
    "_startSandBaseEmissionRate",
    "_middleSandBaseEmissionRate",
    "_endSandBaseEmissionRate",
}
CURVE_NAMES = ("ZuzuA", "ZuzuB", "ZuzuC", "Zzzzz", "ZuzuGoal", "ShakeIntensity")
CURVE_FIELDS = (
    "time",
    "value",
    "inSlope",
    "outSlope",
    "weightedMode",
    "inWeight",
    "outWeight",
)
SETTINGS_FIELDS = {"m_GameObject", "m_Enabled", "m_Script", "m_Name", *CURVE_NAMES}


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


def read_single_behaviour(path: Path, marker: str) -> tuple[bytes, object, dict]:
    bundle = path.read_bytes()
    environment = UnityPy.load(str(path))
    matches = []
    for obj in environment.objects:
        if obj.type.name != "MonoBehaviour":
            continue
        tree = obj.read_typetree()
        if marker in tree:
            matches.append((obj, tree))
    if len(matches) != 1:
        raise RuntimeError(f"{path}: expected one {marker} behaviour, got {len(matches)}")
    return bundle, *matches[0]


def curve_payload(curve: dict) -> dict:
    keys = curve.get("m_Curve") or []
    if any(not set(CURVE_FIELDS).issubset(key or {}) for key in keys):
        raise RuntimeError("incomplete AncientBGAnimation AnimationCurve")
    return {
        "keys": [{field: key[field] for field in CURVE_FIELDS} for key in keys],
        "preInfinity": curve.get("m_PreInfinity"),
        "postInfinity": curve.get("m_PostInfinity"),
        "rotationOrder": curve.get("m_RotationOrder"),
    }


def read_component(path: Path) -> dict:
    bundle, obj, tree = read_single_behaviour(path, "_animCurveSettings")
    if set(tree) != COMPONENT_FIELDS:
        raise RuntimeError(
            f"{path}: CardAncientObject TypeTree drift; "
            f"missing={sorted(COMPONENT_FIELDS - set(tree))}, "
            f"extra={sorted(set(tree) - COMPONENT_FIELDS)}"
        )
    scalar_map = {
        "animCurveScale": "_animCurveScale",
        "animStartDelayRangeA": "_animStartDelayRangeA",
        "animStartDelayRangeB": "_animStartDelayRangeB",
        "changeRangeStart": "_changeRangeStart",
        "changeRangeEnd": "_changeRangeEnd",
        "zuzuGoalAnimThreshold": "_zuzuGoalAnimThreshold",
        "goalThreshold": "_goalThreshold",
        "scrollLength": "_scrollLength",
        "shapeChangeSpeed": "_shapeChangeSpeed",
        "dot2Multiply": "_dot2Multiply",
        "accellRatio": "_accellRatio",
        "diffOffset": "_diffOffset",
        "shakeSpeed": "_shakeSpeed",
        "noiseScale": "_noiseScale",
        "frictionScale": "_frictionScale",
        "maxFriction": "_maxFriction",
        "startSandBaseEmissionRate": "_startSandBaseEmissionRate",
        "middleSandBaseEmissionRate": "_middleSandBaseEmissionRate",
        "endSandBaseEmissionRate": "_endSandBaseEmissionRate",
    }
    vector_map = {
        "shakeAIntensity": "_shakeAIntensity",
        "shakeAFrequency": "_shakeAFrequency",
        "shakeBIntensity": "_shakeBIntensity",
        "shakeBFrequency": "_shakeBFrequency",
    }
    raw = bytes(obj.get_raw_data())
    config = {
        "componentIdentity": f"{obj.assets_file.name}:{int(obj.path_id)}",
        "componentGoIdentity": pptr_identity(obj, tree["m_GameObject"]),
        "scriptIdentity": pptr_identity(obj, tree["m_Script"]),
        "curveSettingsIdentity": pptr_identity(obj, tree["_animCurveSettings"]),
        "scrolls": tree["_scrolls"],
        "sandParticleSystemBindings": [
            pptr_identity(obj, pointer) for pointer in tree["_sandParticleSystems"]
        ],
        "sand2ParticleSystemBindings": [
            pptr_identity(obj, pointer) for pointer in tree["_sand2ParticleSystems"]
        ],
        "isAnimationStopped": 0,
        **{name: tree[field] for name, field in scalar_map.items()},
        **{
            name: {"x": tree[field]["x"], "y": tree[field]["y"]}
            for name, field in vector_map.items()
        },
    }
    return {
        "bundleByteLength": len(bundle),
        "bundleSha256": sha256(bundle),
        "rawByteLength": len(raw),
        "rawSha256": sha256(raw),
        "config": config,
    }


def read_settings(path: Path) -> dict:
    bundle, obj, tree = read_single_behaviour(path, "ZuzuA")
    if set(tree) != SETTINGS_FIELDS:
        raise RuntimeError(
            f"{path}: AncientBGAnimationSettings TypeTree drift; "
            f"missing={sorted(SETTINGS_FIELDS - set(tree))}, "
            f"extra={sorted(set(tree) - SETTINGS_FIELDS)}"
        )
    raw = bytes(obj.get_raw_data())
    return {
        "bundleByteLength": len(bundle),
        "bundleSha256": sha256(bundle),
        "rawByteLength": len(raw),
        "rawSha256": sha256(raw),
        "identity": f"{obj.assets_file.name}:{int(obj.path_id)}",
        "name": tree["m_Name"],
        "scriptIdentity": pptr_identity(obj, tree["m_Script"]),
        "curves": {name: curve_payload(tree[name] or {}) for name in CURVE_NAMES},
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest")
    parser.add_argument("--apkm")
    parser.add_argument("--prefab", type=Path, default=DEFAULT_PREFAB)
    parser.add_argument("--settings", type=Path, default=DEFAULT_SETTINGS)
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
        "schema": "pocket-card-render/official-card-ancient-evidence@1",
        "source": {
            "sampleId": sample["sampleId"],
            "sampleManifestSha256": loaded["sampleManifestSha256"],
            "apkmSha256": sha256(apkm),
            "arm64SplitSha256": sha256(split),
            "libil2cppSha256": sha256(libil2cpp),
        },
        "methods": methods,
        "rodata": {
            "sandAndStrataCounts": elf.range(0x1AF8048, 0x1AF8050).hex(),
            "lightDir2": elf.range(0x1AF7A30, 0x1AF7A38).hex(),
            "normalizeEpsilon": elf.range(0x1AF8F10, 0x1AF8F14).hex(),
        },
        "component": read_component(args.prefab),
        "settings": read_settings(args.settings),
    }, ensure_ascii=True, separators=(",", ":"), sort_keys=True))


if __name__ == "__main__":
    main()
