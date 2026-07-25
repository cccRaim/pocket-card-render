#!/usr/bin/env python3
"""Extract the official Unity RenderTexture format/Y contract from the APKM.

This extractor is intentionally GPU-independent. It reads the nested APKs,
PlayerSettings, and pinned ARM64 Unity code/data through ELF PT_LOAD mappings.
It emits evidence only; the generated public contract is assembled by the
JavaScript build step.
"""

from __future__ import annotations

import hashlib
import io
import json
import os
import re
import struct
import sys
import zipfile
from dataclasses import dataclass
from pathlib import Path

import UnityPy
from capstone import CS_ARCH_ARM64, CS_MODE_LITTLE_ENDIAN, Cs


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_APKM = ROOT.parent / "ptcg-apk-parser" / "apks" / "jp.pokemon.pokemontcgp_1.6.0.apkm"
APKM = Path(os.environ.get("PCR_APKM", DEFAULT_APKM))


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def pick(tree: dict, *names: str):
    for name in names:
        if name in tree:
            return tree[name]
    raise KeyError(names)


@dataclass(frozen=True)
class LoadSegment:
    offset: int
    virtual_address: int
    file_size: int
    memory_size: int
    flags: int


class ElfImage:
    PT_LOAD = 1

    def __init__(self, data: bytes):
        self.data = data
        if data[:4] != b"\x7fELF":
            raise RuntimeError("libunity.so is not ELF")
        if data[4] != 2 or data[5] != 1:
            raise RuntimeError("expected ELF64 little-endian libunity.so")
        self.elf_type, self.machine = struct.unpack_from("<HH", data, 0x10)
        phoff = struct.unpack_from("<Q", data, 0x20)[0]
        phentsize, phnum = struct.unpack_from("<HH", data, 0x36)
        self.load_segments: list[LoadSegment] = []
        for index in range(phnum):
            item = phoff + index * phentsize
            p_type, p_flags, p_offset, p_vaddr, _p_paddr, p_filesz, p_memsz, _p_align = struct.unpack_from(
                "<IIQQQQQQ", data, item
            )
            if p_type == self.PT_LOAD:
                self.load_segments.append(
                    LoadSegment(p_offset, p_vaddr, p_filesz, p_memsz, p_flags)
                )
        if not self.load_segments:
            raise RuntimeError("libunity.so has no PT_LOAD segments")

    def offset_for_virtual_address(self, virtual_address: int, size: int = 1) -> int:
        for segment in self.load_segments:
            relative = virtual_address - segment.virtual_address
            if relative >= 0 and relative + size <= segment.file_size:
                return segment.offset + relative
        raise RuntimeError(
            f"virtual range {virtual_address:#x}+{size:#x} is not file-backed by PT_LOAD"
        )

    def read(self, virtual_address: int, size: int) -> bytes:
        offset = self.offset_for_virtual_address(virtual_address, size)
        return self.data[offset : offset + size]

    def u32(self, virtual_address: int) -> int:
        return struct.unpack("<I", self.read(virtual_address, 4))[0]


def nested_apks(apkm: bytes):
    outer = zipfile.ZipFile(io.BytesIO(apkm))
    base_apk = outer.read("base.apk")
    arm64_name = next(
        name for name in outer.namelist() if "arm64_v8a" in name and name.endswith(".apk")
    )
    arm64_apk = outer.read(arm64_name)
    return base_apk, arm64_apk


def selected_instructions(elf: ElfImage, ranges: dict[str, tuple[int, int]], addresses: set[int]):
    md = Cs(CS_ARCH_ARM64, CS_MODE_LITTLE_ENDIAN)
    selected: dict[str, str] = {}
    windows = {}
    for name, (start, end) in ranges.items():
        body = elf.read(start, end - start)
        windows[name] = {
            "rvaStart": hex(start),
            "rvaEndExclusive": hex(end),
            "byteSize": len(body),
            "sha256": sha256(body),
        }
        for instruction in md.disasm(body, start):
            if instruction.address in addresses:
                selected[hex(instruction.address)] = instruction.mnemonic + (
                    " " + instruction.op_str if instruction.op_str else ""
                )
    return windows, selected


def main() -> None:
    apkm = APKM.read_bytes()
    base_apk, arm64_apk = nested_apks(apkm)
    base = zipfile.ZipFile(io.BytesIO(base_apk))
    arm64 = zipfile.ZipFile(io.BytesIO(arm64_apk))

    globalgamemanagers = base.read("assets/bin/Data/globalgamemanagers")
    libunity = arm64.read("lib/arm64-v8a/libunity.so")
    libil2cpp = arm64.read("lib/arm64-v8a/libil2cpp.so")
    elf = ElfImage(libunity)

    unity_environment = UnityPy.load(globalgamemanagers)
    player = next(
        item.read_typetree()
        for item in unity_environment.objects
        if item.type.name == "PlayerSettings"
    )
    build = next(
        item.read_typetree()
        for item in unity_environment.objects
        if item.type.name == "BuildSettings"
    )

    ranges = {
        "legacyRenderTextureFormatToGraphicsFormat": (0xA7C004, 0xA7C094),
        "compatibleFormatSearch": (0xA7C0D0, 0xA7C274),
        "depthBitsLegacy": (0xA7C274, 0xA7C2F0),
        "activeColorSpaceLegacyMapping": (0x5183D0, 0x518400),
        "systemInfoCompatibleFormat": (0x5C12AC, 0x5C12D4),
        "deviceCompatibleFormat": (0x5BF024, 0x5BF080),
        "deviceFormatCapabilityLookup": (0x5BEFC8, 0x5BF018),
        "defaultFormatLookup": (0x5BF478, 0x5BF49C),
        "vulkanFormatDescriptorLookup": (0xAF2D98, 0xAF2DA8),
        "vulkanCapabilityTableAndDepthDefault": (0xB02618, 0xB0289C),
        "graphicsUvStartsAtTop": (0x5C0FB0, 0x5C0FCC),
        "vulkanUvOriginInitialization": (0xB021E0, 0xB02220),
        "vulkanViewportProcLoad": (0xAE8B68, 0xAE8BEC),
        "vulkanPipelineCacheHeader": (0xAEE08C, 0xAEE120),
    }
    instruction_addresses = {
        0x5183E0,
        0x5183E4,
        0x5183EC,
        0x5183FC,
        0x5BEFD0,
        0x5BEFD4,
        0x5BF038,
        0x5BF03C,
        0x5BF044,
        0x5BF048,
        0x5BF064,
        0x5BF074,
        0x5BF07C,
        0x5BF478,
        0x5BF490,
        0x5BF494,
        0x5C0FB4,
        0x5C0FB8,
        0x5C0FBC,
        0x5C0FC0,
        0x5C12BC,
        0x5C12D0,
        0xA7C048,
        0xA7C04C,
        0xA7C050,
        0xA7C054,
        0xA7C1F8,
        0xA7C22C,
        0xA7C2A4,
        0xA7C2DC,
        0xA7C2E0,
        0xA7C2E4,
        0xA7C2EC,
        0xAE8B74,
        0xAE8B78,
        0xAE8B7C,
        0xAE8B88,
        0xAEE098,
        0xAEE0A0,
        0xAEE0A4,
        0xAEE0AC,
        0xAEE0C8,
        0xAEE0CC,
        0xAEE0D0,
        0xAEE0E0,
        0xAF2D98,
        0xAF2D9C,
        0xAF2DA0,
        0xB021E0,
        0xB02618,
        0xB02628,
        0xB0262C,
        0xB026AC,
        0xB026B0,
        0xB026BC,
        0xB026D0,
        0xB02884,
        0xB02888,
        0xB0288C,
        0xB02890,
        0xB02898,
    }
    windows, instructions = selected_instructions(elf, ranges, instruction_addresses)

    legacy_table_rva = 0x176430
    vulkan_table_rva = 0x11DE2C8

    def vulkan_descriptor(graphics_format: int):
        values = struct.unpack(
            "<IIII", elf.read(vulkan_table_rva + graphics_format * 16, 16)
        )
        return {
            "graphicsFormat": graphics_format,
            "vkFormat": values[0],
            "descriptorWords": list(values),
        }

    unity_version_match = re.search(rb"2022\.3\.62f2_[0-9a-f]+", libunity)
    if not unity_version_match:
        raise RuntimeError("Unity build version is missing from libunity.so")

    all_archive_names = list(base.namelist()) + list(arm64.namelist())
    cache_shipped = any(name.endswith("vulkan_pso_cache.bin") for name in all_archive_names)
    cache_path = b"/vulkan_pso_cache.bin"
    cache_path_offset = libunity.find(cache_path)
    if cache_path_offset < 0:
        raise RuntimeError("libunity.so has no Vulkan PSO cache path")

    result = {
        "source": {
            "apkmPath": str(APKM),
            "apkmSha256": sha256(apkm),
            "baseApkSha256": sha256(base_apk),
            "arm64SplitSha256": sha256(arm64_apk),
            "globalgamemanagersSha256": sha256(globalgamemanagers),
            "libunitySha256": sha256(libunity),
            "libil2cppSha256": sha256(libil2cpp),
            "unityVersion": unity_version_match.group().decode("ascii"),
        },
        "playerSettings": {
            "graphicsAPIs": list(pick(build, "m_GraphicsAPIs")),
            "activeColorSpace": int(pick(player, "m_ActiveColorSpace")),
            "disableDepthAndStencilBuffers": bool(
                pick(player, "disableDepthAndStencilBuffers", "m_DisableDepthAndStencilBuffers")
            ),
            "vulkanEnableSetSRGBWrite": bool(pick(player, "vulkanEnableSetSRGBWrite")),
            "vulkanEnablePreTransform": bool(pick(player, "vulkanEnablePreTransform")),
        },
        "elf": {
            "class": 64,
            "endianness": "little",
            "type": elf.elf_type,
            "machine": elf.machine,
            "virtualAddressMapping": "PT_LOAD file-backed range",
            "loadSegments": [
                {
                    "offset": hex(segment.offset),
                    "virtualAddress": hex(segment.virtual_address),
                    "fileSize": hex(segment.file_size),
                    "memorySize": hex(segment.memory_size),
                    "flags": segment.flags,
                }
                for segment in elf.load_segments
            ],
        },
        "native": {
            "windows": windows,
            "selectedInstructions": instructions,
        },
        "color": {
            "legacyRenderTextureFormat": {"value": 0, "name": "ARGB32"},
            "legacyTableRva": hex(legacy_table_rva),
            "linearOrGammaGraphicsFormat": elf.u32(legacy_table_rva),
            "srgbGraphicsFormat": elf.u32(legacy_table_rva + 4),
            "activeColorSpace": int(pick(player, "m_ActiveColorSpace")),
            "requestedGraphicsFormat": elf.u32(legacy_table_rva),
            "vulkan": {
                "tableRva": hex(vulkan_table_rva),
                "gf4": vulkan_descriptor(4),
                "gf8": vulkan_descriptor(8),
            },
        },
        "depth": {
            "requestedBits": 24,
            "defaultFormat": {"value": 2, "name": "DepthStencil"},
            "preferredGraphicsFormat": {
                "value": 92,
                "name": "D24_UNorm_S8_UInt",
            },
            "formatUsage": {"value": 4, "name": "Render"},
            "preserveCompatibleFormat": True,
            "vulkan": {
                "gf92": vulkan_descriptor(92),
                "gf94": vulkan_descriptor(94),
            },
        },
        "y": {
            "unityGraphicsUvStartsAtTop": True,
            "vulkanDeviceFlagOffset": "0xe0",
            "vulkanDeviceFlagInitializedValue": 0,
            "vkCmdSetViewport": {
                "procNameRva": hex(libunity.find(b"vkCmdSetViewport\0")),
                "globalSlotRva": "0x1290760",
            },
        },
        "pipelineCache": {
            "shippedInApks": cache_shipped,
            "runtimePath": cache_path.decode("ascii"),
            "runtimePathFileOffset": hex(cache_path_offset),
            "headerCompatibilityFields": ["version", "vendorId", "deviceId", "pipelineCacheUUID"],
        },
    }
    print(json.dumps(result, separators=(",", ":")))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        raise SystemExit(f"official RenderTexture extraction failed: {error}") from error
