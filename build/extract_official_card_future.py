#!/usr/bin/env python3
"""Extract byte-pinned CardFutureObject evidence and run its ARM64 frame step."""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
import re
import struct
import warnings
import zipfile
from pathlib import Path

import UnityPy
import UnityPy.config
from unicorn import Uc, UC_ARCH_ARM64, UC_MODE_ARM
from unicorn.arm64_const import (
    UC_ARM64_REG_LR,
    UC_ARM64_REG_SP,
    UC_ARM64_REG_X0,
)

from extract_official_pass_partition import Elf64
from official_sample import load_official_sample


warnings.simplefilter("ignore")

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_APKS = ROOT.parent / "ptcg-apk-parser" / "apks"
DEFAULT_PREFAB = (
    ROOT.parent
    / "ptcgp-tools-master"
    / "masterdata_decoder"
    / ".output"
    / "decrypted"
    / "Common"
    / "CardNew"
    / "Face"
    / "cPK_20_018280_00_TETSUNOTSUTSUMIex_SR"
    / "L"
    / "Prefabs"
    / "cPK_20_018280_00_TETSUNOTSUTSUMIex_SR_L.prefab_bundles"
)

METHOD_RANGES = {
    "get_IsAnimationStopped": (0x44237FC, 0x4423804),
    "set_IsAnimationStopped": (0x4423804, 0x442380C),
    "Awake": (0x442380C, 0x4423840),
    "Validate": (0x4423840, 0x4423AAC),
    "UpdateTilt": (0x4423AAC, 0x4423DA4),
    "UpdateGoalAnimFrame": (0x4423DA4, 0x4423F40),
    "InitializeAnimFrame": (0x4423F40, 0x4423F50),
    "ApplyParams": (0x4423F50, 0x44240B0),
    "LateUpdate": (0x44240B0, 0x44240E0),
    "UpdateAnimFrame": (0x44240E0, 0x44241A0),
    ".ctor": (0x4424634, 0x44246E0),
    ".cctor": (0x44246E0, 0x44247BC),
}

EXPECTED_FIELDS = {
    "m_GameObject",
    "m_Enabled",
    "m_Script",
    "m_Name",
    "_animationTexFrameCount",
    "_animationFrameCount",
    "_animSwitchSpeed",
    "_animFrameOffset",
    "_skipAnimThreshold",
    "_accellRatio",
    "<IsAnimationStopped>k__BackingField",
}


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def f32(value: float) -> float:
    return struct.unpack("<f", struct.pack("<f", value))[0]


def f32_bits(value: float) -> str:
    return struct.pack("<f", f32(value)).hex()


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


def read_component(path: Path, unity_version: str) -> dict:
    UnityPy.config.FALLBACK_UNITY_VERSION = unity_version
    bundle = path.read_bytes()
    environment = UnityPy.load(str(path))
    matches = []
    for obj in environment.objects:
        if obj.type.name != "MonoBehaviour":
            continue
        tree = obj.read_typetree()
        if "_animationTexFrameCount" in tree:
            matches.append((obj, tree))
    if len(matches) != 1:
        raise RuntimeError(f"{path}: expected one CardFutureObject, got {len(matches)}")
    obj, tree = matches[0]
    if set(tree) != EXPECTED_FIELDS:
        raise RuntimeError(
            f"{path}: CardFutureObject TypeTree drift; "
            f"missing={sorted(EXPECTED_FIELDS - set(tree))}, "
            f"extra={sorted(set(tree) - EXPECTED_FIELDS)}"
        )
    raw = bytes(obj.get_raw_data())
    config = {
        "componentIdentity": f"{obj.assets_file.name}:{int(obj.path_id)}",
        "componentGoIdentity": pptr_identity(obj, tree["m_GameObject"]),
        "scriptIdentity": pptr_identity(obj, tree["m_Script"]),
        "animationTexFrameCount": int(tree["_animationTexFrameCount"]),
        "animationFrameCount": int(tree["_animationFrameCount"]),
        "animSwitchSpeed": tree["_animSwitchSpeed"],
        "animFrameOffset": int(tree["_animFrameOffset"]),
        "skipAnimThreshold": int(tree["_skipAnimThreshold"]),
        "accellRatio": tree["_accellRatio"],
        "isAnimationStopped": int(tree["<IsAnimationStopped>k__BackingField"]),
    }
    return {
        "bundleByteLength": len(bundle),
        "bundleSha256": sha256(bundle),
        "rawByteLength": len(raw),
        "rawSha256": sha256(raw),
        "config": config,
    }


class UpdateAnimFrameOracle:
    CODE_BASE = 0x4424000
    CODE_SIZE = 0x2000
    RODATA_BASE = 0x1AF8000
    RODATA_SIZE = 0x10000
    OBJECT = 0x5100000
    STACK = 0x5200000
    STOP = 0x5300000

    def __init__(self, libil2cpp: bytes):
        elf = Elf64(libil2cpp)
        self.uc = Uc(UC_ARCH_ARM64, UC_MODE_ARM)
        self.uc.mem_map(self.CODE_BASE, self.CODE_SIZE)
        self.uc.mem_write(
            self.CODE_BASE,
            elf.range(self.CODE_BASE, self.CODE_BASE + self.CODE_SIZE),
        )
        self.uc.mem_map(self.RODATA_BASE, self.RODATA_SIZE)
        self.uc.mem_write(
            self.RODATA_BASE,
            elf.range(self.RODATA_BASE, self.RODATA_BASE + self.RODATA_SIZE),
        )
        self.uc.mem_map(self.OBJECT, 0x1000)
        self.uc.mem_map(self.STACK, 0x10000)
        self.uc.mem_map(self.STOP, 0x1000)
        self.uc.mem_write(self.STOP, b"\x00\x00\x20\xd4")

    def run(self, current: float, goal: int, delta_time: float, config: dict) -> float:
        body = bytearray(0x100)
        struct.pack_into("<i", body, 0x30, int(config["skipAnimThreshold"]))
        struct.pack_into("<f", body, 0x34, f32(config["accellRatio"]))
        struct.pack_into("<f", body, 0x54, f32(delta_time))
        struct.pack_into("<i", body, 0x58, int(goal))
        struct.pack_into("<f", body, 0x60, f32(current))
        self.uc.mem_write(self.OBJECT, bytes(body))
        self.uc.reg_write(UC_ARM64_REG_X0, self.OBJECT)
        self.uc.reg_write(UC_ARM64_REG_SP, self.STACK + 0x8000)
        self.uc.reg_write(UC_ARM64_REG_LR, self.STOP)
        self.uc.emu_start(METHOD_RANGES["UpdateAnimFrame"][0], self.STOP)
        return struct.unpack("<f", self.uc.mem_read(self.OBJECT + 0x60, 4))[0]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest")
    parser.add_argument("--apkm")
    parser.add_argument("--prefab", type=Path, default=DEFAULT_PREFAB)
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

    component = read_component(args.prefab, sample["unity"]["serializedVersion"])
    oracle = UpdateAnimFrameOracle(libil2cpp)
    samples = []
    for goal in (0, 2, 4, 8):
        for current in (-2, 0, 0.5, 4, 10, 12):
            for delta_time in (0, 1 / 120, 1 / 60, 1 / 30, 0.25, 1):
                result = oracle.run(current, goal, delta_time, component["config"])
                samples.append({
                    "currentBits": f32_bits(current),
                    "goal": goal,
                    "deltaTimeBits": f32_bits(delta_time),
                    "resultBits": f32_bits(result),
                })

    rodata = {
        "frameEpsilonBits": elf.range(0x1AF8D80, 0x1AF8D84).hex(),
        "lightDir2Bits": elf.range(0x1AF7A30, 0x1AF7A38).hex(),
    }
    print(json.dumps({
        "schema": "pocket-card-render/official-card-future-evidence@1",
        "source": {
            "sampleId": sample["sampleId"],
            "sampleManifestSha256": loaded["sampleManifestSha256"],
            "apkmSha256": sha256(apkm),
            "arm64SplitSha256": sha256(split),
            "libil2cppSha256": sha256(libil2cpp),
        },
        "methods": methods,
        "rodata": rodata,
        "component": component,
        "updateAnimFrameSamples": samples,
    }, ensure_ascii=True, separators=(",", ":"), sort_keys=True))


if __name__ == "__main__":
    main()
