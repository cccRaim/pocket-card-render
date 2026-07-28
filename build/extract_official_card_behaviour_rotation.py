#!/usr/bin/env python3
"""Extract byte-pinned CardBehaviour hologram-rotation evidence."""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
import zipfile
from pathlib import Path

from extract_official_pass_partition import Elf64
from official_sample import load_official_sample


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_APKS = ROOT.parent / "ptcg-apk-parser" / "apks"

METHOD_RANGES = {
    "CardBehaviour.UpdateHologramRotation": (0x44133D4, 0x441355C),
    "CardBehaviour..cctor": (0x4413B88, 0x4413BF0),
    "CardDataGroup..ctor": (0x4445B84, 0x4445C28),
}

ZERO_INPUT_WINDOWS = {
    "CardRenderer.LoadAsset": (0x444574C, 0x444580C, 0x4445808),
    "UICardViewLoaderProgressive.LoadDetailCard": (
        0x4446A48,
        0x4446A9C,
        0x4446A98,
    ),
    "UICardViewLoaderProgressive.LoadCard": (
        0x4447C10,
        0x4447C5C,
        0x4447C58,
    ),
    "UICardViewLoaderSimple.LoadCard": (
        0x44484C0,
        0x444851C,
        0x4448518,
    ),
}

RELOCATIONS = {
    "UnityEngine.Vector3_TypeInfo": 0x6BD9418,
    "CardBehaviour_TypeInfo": 0x6C4A670,
    "CardDataGroup_TypeInfo": 0x6BE3F30,
    "_Rotation": 0x6C4A6B0,
}


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def verify_artifact(data: bytes, artifact: dict, label: str) -> None:
    if len(data) != artifact["byteLength"] or sha256(data) != artifact["sha256"]:
        raise RuntimeError(f"{label} does not match selected official sample")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest")
    parser.add_argument("--apkm")
    args = parser.parse_args()

    loaded = load_official_sample(args.manifest)
    sample = loaded["sample"]
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

    input_windows = {}
    for name, (start, end, call_rva) in ZERO_INPUT_WINDOWS.items():
        body = elf.range(start, end)
        call = elf.range(call_rva, call_rva + 4)
        instruction = int.from_bytes(call, "little")
        immediate = instruction & 0x03FFFFFF
        if immediate & (1 << 25):
            immediate -= 1 << 26
        target = call_rva + (immediate << 2)
        if instruction & 0xFC000000 != 0x94000000 or target != 0x4445B84:
            raise RuntimeError(f"{name}: CardDataGroup constructor call drift")
        input_windows[name] = {
            "rva": start,
            "byteLength": len(body),
            "sha256": sha256(body),
            "constructorCallRva": call_rva,
            "constructorTargetRva": target,
        }

    relocations = elf.relocations()
    selected_relocations = {}
    for name, address in RELOCATIONS.items():
        row = relocations.get(address)
        if not row:
            raise RuntimeError(f"{name}: relocation is missing")
        selected_relocations[name] = {
            "targetRva": row["targetRva"],
            "type": row["type"],
            "addendRva": row["addendRva"],
            "sha256": row["sha256"],
        }

    print(json.dumps({
        "schema":
            "pocket-card-render/official-card-behaviour-rotation-evidence@1",
        "source": {
            "sampleId": sample["sampleId"],
            "sampleManifestSha256": loaded["sampleManifestSha256"],
            "apkmSha256": sha256(apkm),
            "arm64SplitSha256": sha256(split),
            "libil2cppSha256": sha256(libil2cpp),
        },
        "methods": methods,
        "zeroInputWindows": input_windows,
        "relocations": selected_relocations,
    }, ensure_ascii=True, separators=(",", ":"), sort_keys=True))


if __name__ == "__main__":
    main()
