#!/usr/bin/env python3
"""Read official GlitterFlowMaps evidence from APKM and AssetBundle bytes."""

import argparse
import hashlib
import io
import json
import struct
import warnings
import zipfile

import UnityPy
import UnityPy.config

warnings.simplefilter("ignore")


METHODS = {
    "Initialize": (0x442F3D0, 0x442F474),
    "Update": (0x442F474, 0x442F4A4),
    "UpdateFlowSpeed": (0x442F4A4, 0x442F724),
    "UpdateFlowMapUVOffset": (0x442F724, 0x442FA6C),
    "UpdateLightTiming": (0x442FA6C, 0x442FB24),
    "UpdateFlowRotate": (0x442FB24, 0x442FC60),
    "SetParams": (0x442FC60, 0x442FCC4),
}


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def extract_lib(apkm_bytes):
    with zipfile.ZipFile(io.BytesIO(apkm_bytes)) as apkm:
        split_bytes = apkm.read("split_config.arm64_v8a.apk")
    with zipfile.ZipFile(io.BytesIO(split_bytes)) as split:
        lib = split.read("lib/arm64-v8a/libil2cpp.so")
    return split_bytes, lib


def read_prefab(bundle_path):
    UnityPy.config.FALLBACK_UNITY_VERSION = "2022.3.62f2"
    env = UnityPy.load(bundle_path)
    required = {
        "_accelIntensity",
        "_maxFlowSpeed",
        "_minFlowSpeed",
        "_initFlowSpeed",
        "_resistance",
        "_minTiltPower",
        "_lightSpeed",
        "_flowAMinRotateSpeed",
        "_flowAMaxRotateSpeed",
        "_flowBMinRotateSpeed",
        "_flowBMaxRotateSpeed",
    }
    for obj in env.objects:
        if obj.type.name != "MonoBehaviour":
            continue
        tree = obj.read_typetree()
        if required.issubset(tree):
            return {name: tree[name] for name in sorted(required)}
    raise RuntimeError("GlitterFlowMaps MonoBehaviour not found in official bundle")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--apkm", required=True)
    parser.add_argument("--bundle", required=True)
    args = parser.parse_args()

    with open(args.apkm, "rb") as file:
        apkm_bytes = file.read()
    with open(args.bundle, "rb") as file:
        bundle_bytes = file.read()
    split_bytes, lib = extract_lib(apkm_bytes)

    method_rows = {}
    for name, (start, end) in METHODS.items():
        body = lib[start - 0x4000 : end - 0x4000]
        method_rows[name] = {
            "rva": start,
            "size": len(body),
            "sha256": sha256(body),
        }

    zero_speed_windows = {
        "compareAndBranch": lib[0x442F698 - 0x4000 : 0x442F6A8 - 0x4000].hex(),
        "divideAndScale": lib[0x442F6E4 - 0x4000 : 0x442F704 - 0x4000].hex(),
    }

    rodata = {}
    for name, rva in {
        "twoPi": 0x1AF8E5C,
        "normalizeEpsilon": 0x1AF8F10,
        "flowDirectionX": 0x1AF8FD0,
        "flowDirectionY": 0x1AF8EE4,
    }.items():
        rodata[name] = struct.unpack_from("<f", lib, rva)[0]

    print(json.dumps({
        "apkmSha256": sha256(apkm_bytes),
        "splitSha256": sha256(split_bytes),
        "libil2cppSha256": sha256(lib),
        "bundleSha256": sha256(bundle_bytes),
        "methods": method_rows,
        "zeroSpeedWindows": zero_speed_windows,
        "rodata": rodata,
        "prefab": read_prefab(args.bundle),
    }, separators=(",", ":"), sort_keys=True))


if __name__ == "__main__":
    main()
