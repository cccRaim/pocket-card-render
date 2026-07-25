#!/usr/bin/env python3
"""Extract KiraPuyo CPU/curve evidence and execute Unity's ARM64 curve math."""

import argparse
import hashlib
import io
import json
import math
import os
import struct
import warnings
import zipfile
from pathlib import Path

import UnityPy
import UnityPy.config
from elftools.elf.elffile import ELFFile
from unicorn import Uc, UC_ARCH_ARM64, UC_HOOK_CODE, UC_MODE_ARM
from unicorn.arm64_const import (
    UC_ARM64_REG_D0,
    UC_ARM64_REG_LR,
    UC_ARM64_REG_PC,
    UC_ARM64_REG_S0,
    UC_ARM64_REG_S1,
    UC_ARM64_REG_SP,
    UC_ARM64_REG_X0,
    UC_ARM64_REG_X1,
)

from extract_official_pass_partition import Elf64

warnings.simplefilter("ignore")
UnityPy.config.FALLBACK_UNITY_VERSION = "2022.3.62f2"

DEFAULT_APKM = "D:/DevProjectes/ptcg-apk-parser/apks/jp.pokemon.pokemontcgp_1.6.0.apkm"
DEFAULT_SETTINGS = (
    "D:/DevProjectes/ptcgp-tools-master/masterdata_decoder/.output/decrypted/"
    "Common/CardNew/Common/Settings"
)

IL2CPP_METHODS = {
    "Awake": (0x442EFE0, 0x442EFF8),
    "LateUpdate": (0x442EFF8, 0x442F010),
    "UpdateAnimation": (0x442F010, 0x442F0AC),
    "UpdateMPB": (0x442F0AC, 0x442F268),
    "Constructor": (0x442F268, 0x442F294),
    "StaticConstructor": (0x442F294, 0x442F3D0),
}

UNITY_FUNCTIONS = {
    "AnimationCurveEvaluate": (0xA3E220, 0xA3E510),
    "FindKeyframePair": (0xA3E510, 0xA3E698),
    "CacheKeyframePair": (0xA3E698, 0xA3E7C0),
    "EvaluateSegment": (0xA3CFAC, 0xA3D0D0),
    "EvaluateWeightedSegment": (0xA3D0D0, 0xA3D1C4),
    "SolveBezierTime": (0xA3DB58, 0xA3DE3C),
}

PLT_IMPORTS = {
    0x1187360: (0x11D07B0, "logf"),
    0x1187380: (0x11D07C0, "atan2f"),
    0x1187DD0: (0x11D0CE8, "cosf"),
    0x1188100: (0x11D0E80, "exp"),
}


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def f32(value):
    return struct.unpack("<f", struct.pack("<f", value))[0]


def f32_bits(value):
    return struct.unpack("<I", struct.pack("<f", f32(value)))[0]


def read_apkm(path):
    apkm = path.read_bytes()
    with zipfile.ZipFile(io.BytesIO(apkm)) as outer:
        split = outer.read("split_config.arm64_v8a.apk")
    with zipfile.ZipFile(io.BytesIO(split)) as inner:
        return apkm, split, inner.read("lib/arm64-v8a/libil2cpp.so"), inner.read("lib/arm64-v8a/libunity.so")


def relocation_names(libunity):
    elf = ELFFile(io.BytesIO(libunity))
    names = {}
    for section in elf.iter_sections():
        if not section.name.startswith(".rela"):
            continue
        symbols = elf.get_section(section["sh_link"])
        for relocation in section.iter_relocations():
            offset = relocation["r_offset"]
            if offset in {got for got, _ in PLT_IMPORTS.values()}:
                names[offset] = symbols.get_symbol(relocation["r_info_sym"]).name
    return names


def pptr_identity(owner, pointer):
    pointer = pointer or {}
    file_id = int(pointer.get("m_FileID", 0))
    path_id = int(pointer.get("m_PathID", 0))
    if file_id == 0:
        source = owner.assets_file.name
    else:
        external = owner.assets_file.externals[file_id - 1]
        source = Path(external.path).name
    return f"{source}:{path_id}"


def read_setting(path):
    bundle = path.read_bytes()
    environment = UnityPy.load(str(path))
    matches = []
    for obj in environment.objects:
        if obj.type.name != "MonoBehaviour":
            continue
        tree = obj.read_typetree()
        if {"Curve", "Min", "Max"}.issubset(tree):
            matches.append((obj, tree))
    if len(matches) != 1:
        raise RuntimeError(f"{path}: expected one KiraPuyoAnimationSettings object, got {len(matches)}")
    obj, tree = matches[0]
    curve = tree["Curve"]
    fields = ("time", "value", "inSlope", "outSlope", "weightedMode", "inWeight", "outWeight")
    keys = curve.get("m_Curve") or []
    if len(keys) < 2 or any(not set(fields).issubset(key) for key in keys):
        raise RuntimeError(f"{path}: incomplete official AnimationCurve")
    return {
        "bundlePath": path.as_posix(),
        "bundleSha256": sha256(bundle),
        "identity": f"{obj.assets_file.name}:{int(obj.path_id)}",
        "value": {
            "name": tree.get("m_Name", ""),
            "scriptIdentity": pptr_identity(obj, tree.get("m_Script")),
            "curve": {
                "keys": [{field: key[field] for field in fields} for key in keys],
                "preInfinity": curve.get("m_PreInfinity"),
                "postInfinity": curve.get("m_PostInfinity"),
                "rotationOrder": curve.get("m_RotationOrder"),
            },
            "min": tree["Min"],
            "max": tree["Max"],
        },
    }


class ArmCurveOracle:
    CODE_START = 0xA3C000
    CODE_END = 0xA3F000
    IMPORT_START = 0x1187000
    IMPORT_END = 0x1189000
    STACK = 0x2000000
    DATA = 0x2100000
    STOP = 0x2200000

    def __init__(self, libunity):
        elf = Elf64(libunity)
        self.uc = Uc(UC_ARCH_ARM64, UC_MODE_ARM)
        for start, end in ((self.CODE_START, self.CODE_END), (self.IMPORT_START, self.IMPORT_END)):
            self.uc.mem_map(start, end - start)
            self.uc.mem_write(start, elf.range(start, end))
        self.uc.mem_map(self.STACK, 0x10000)
        self.uc.mem_map(self.DATA, 0x10000)
        self.uc.mem_map(self.STOP, 0x1000)
        self.uc.mem_write(self.STOP, b"\x00\x00\x20\xd4")
        self.import_calls = {name: 0 for _, name in PLT_IMPORTS.values()}
        self.uc.hook_add(UC_HOOK_CODE, self._hook)

    def _get_float(self, register):
        return struct.unpack("<f", struct.pack("<I", self.uc.reg_read(register) & 0xFFFFFFFF))[0]

    def _set_float(self, register, value):
        self.uc.reg_write(register, f32_bits(value))

    def _get_double(self, register):
        return struct.unpack("<d", struct.pack("<Q", self.uc.reg_read(register) & 0xFFFFFFFFFFFFFFFF))[0]

    def _set_double(self, register, value):
        self.uc.reg_write(register, struct.unpack("<Q", struct.pack("<d", value))[0])

    def _hook(self, uc, address, _size, _user_data):
        if address == self.STOP:
            uc.emu_stop()
            return
        entry = PLT_IMPORTS.get(address)
        if entry is None:
            return
        _, name = entry
        self.import_calls[name] += 1
        if name == "logf":
            value = self._get_float(UC_ARM64_REG_S0)
            self._set_float(UC_ARM64_REG_S0, -math.inf if value == 0 else math.log(value))
        elif name == "atan2f":
            self._set_float(UC_ARM64_REG_S0, math.atan2(
                self._get_float(UC_ARM64_REG_S0), self._get_float(UC_ARM64_REG_S1)
            ))
        elif name == "cosf":
            self._set_float(UC_ARM64_REG_S0, math.cos(self._get_float(UC_ARM64_REG_S0)))
        elif name == "exp":
            self._set_double(UC_ARM64_REG_D0, math.exp(self._get_double(UC_ARM64_REG_D0)))
        uc.reg_write(UC_ARM64_REG_PC, uc.reg_read(UC_ARM64_REG_LR))

    @staticmethod
    def _pack_key(key):
        return struct.pack(
            "<ffffIff",
            f32(key["time"]), f32(key["value"]), f32(key["inSlope"]), f32(key["outSlope"]),
            int(key["weightedMode"]), f32(key["inWeight"]), f32(key["outWeight"]),
        )

    def weighted_segment(self, left, right, time):
        self.uc.mem_write(self.DATA, self._pack_key(left) + self._pack_key(right))
        self.uc.reg_write(UC_ARM64_REG_X0, self.DATA)
        self.uc.reg_write(UC_ARM64_REG_X1, self.DATA + 0x1C)
        self._set_float(UC_ARM64_REG_S0, time)
        self.uc.reg_write(UC_ARM64_REG_SP, self.STACK + 0x8000)
        self.uc.reg_write(UC_ARM64_REG_LR, self.STOP)
        self.uc.emu_start(0xA3D0D0, self.STOP + 4, count=100000)
        return self._get_float(UC_ARM64_REG_S0)

    def evaluate(self, curve, time):
        keys = curve["keys"]
        value = f32(time)
        if value >= f32(keys[-1]["time"]):
            return f32(keys[-1]["value"])
        right = 1
        while right < len(keys) and value >= f32(keys[right]["time"]):
            right += 1
        return self.weighted_segment(keys[right - 1], keys[right], value)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--apkm", default=os.environ.get("PCR_APKM", DEFAULT_APKM))
    parser.add_argument("--settings", default=os.environ.get("PCR_KIRA_SETTINGS", DEFAULT_SETTINGS))
    args = parser.parse_args()

    apkm_path = Path(args.apkm)
    settings_root = Path(args.settings)
    apkm, split, libil2cpp, libunity = read_apkm(apkm_path)
    unity_elf = Elf64(libunity)
    relocations = relocation_names(libunity)
    for _entry, (got, expected) in PLT_IMPORTS.items():
        if relocations.get(got) != expected:
            raise RuntimeError(f"libunity PLT import 0x{got:x} is {relocations.get(got)!r}, expected {expected!r}")

    settings = [read_setting(settings_root / f"{name}.asset_bundles") for name in (
        "KiraPuyoAnimation", "KiraPuyoAnimation_L", "KiraPuyoAnimation_SS"
    )]
    oracle = ArmCurveOracle(libunity)
    samples = {}
    for setting in settings:
        curve = setting["value"]["curve"]
        times = {f32(index / 257) for index in range(257)}
        times.update(f32(key["time"]) for key in curve["keys"] if f32(key["time"]) < 1)
        samples[setting["identity"]] = [
            {"timeBits": f"{f32_bits(time):08x}", "valueBits": f"{f32_bits(oracle.evaluate(curve, time)):08x}"}
            for time in sorted(times)
        ]

    methods = {}
    for name, (start, end) in IL2CPP_METHODS.items():
        body = libil2cpp[start - 0x4000:end - 0x4000]
        methods[name] = {"rvaStart": f"0x{start:x}", "rvaEnd": f"0x{end:x}", "size": len(body), "sha256": sha256(body)}
    unity_functions = {}
    for name, (start, end) in UNITY_FUNCTIONS.items():
        body = unity_elf.range(start, end)
        unity_functions[name] = {"vaStart": f"0x{start:x}", "vaEnd": f"0x{end:x}", "size": len(body), "sha256": sha256(body)}

    print(json.dumps({
        "schema": "pocket-card-render/official-kira-puyo-evidence@1",
        "source": {
            "apkmPath": apkm_path.as_posix(),
            "apkmSha256": sha256(apkm),
            "splitSha256": sha256(split),
            "libil2cppSha256": sha256(libil2cpp),
            "libunitySha256": sha256(libunity),
        },
        "methods": methods,
        "unityFunctions": unity_functions,
        "pltImports": {f"0x{entry:x}": {"got": f"0x{got:x}", "symbol": name} for entry, (got, name) in PLT_IMPORTS.items()},
        "settings": settings,
        "samples": samples,
        "oracle": {
            "engine": "Unicorn ARM64 over official libunity instructions",
            "entry": "0xa3d0d0",
            "hostMathBoundary": "logf/atan2f/cosf/exp are emulated with host libm and compared by ULP",
            "importCalls": oracle.import_calls,
        },
    }, separators=(",", ":"), sort_keys=True))


if __name__ == "__main__":
    main()
