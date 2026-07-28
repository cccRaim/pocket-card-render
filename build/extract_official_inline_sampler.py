#!/usr/bin/env python3
"""Decode FinalBlit's inline sampler from official Unity ARM64 bytes."""

from __future__ import annotations

import hashlib
import json
import os
import struct
from pathlib import Path

from capstone import CS_ARCH_ARM64, CS_MODE_LITTLE_ENDIAN, Cs
from elftools.elf.elffile import ELFFile

from official_sample import load_official_sample


ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT.parent / ".cache"
GAME = Path(os.environ.get(
    "PCR_GAME_LIBUNITY",
    CACHE / "ptcgp-1.6.0" / "libunity.so",
))
RELEASE = Path(os.environ.get(
    "PCR_UNITY_RELEASE_LIBUNITY",
    CACHE / "unity-2022.3.62f2" / "symbols" / "libunity.release.arm64.so",
))
SYMBOLS = Path(os.environ.get(
    "PCR_UNITY_RELEASE_SYMBOLS",
    CACHE / "unity-2022.3.62f2" / "symbols" / "libunity.release.arm64.sym.so",
))

FUNCTIONS = {
    "sanitize": {
        "symbol": "_ZN17InlineSamplerType8SanitizeEv",
        "release": (0xF40E00, 152, "69920867252daf0795c1e4a04da6440ed46e93284d66e3ef3d3e5c4343e7704f"),
        "game": (0xA7C2F0, 152, "231cbb729b8627979dd9c683081bf28e56dedd3d41cf41c2c434348d9dbaf467"),
    },
    "createInlineSampler": {
        "symbol": "_ZN2vk12ImageManager19CreateInlineSamplerE17InlineSamplerType",
        "release": (0xFE31C8, 184, "1eff3768fa2028ba7057b2d91248a5204c7fa411ad4dde9dfc996a7a35a937e7"),
        "game": (0xB1C448, 184, "390619ada27054cee058b41c1f66f1ab3d8bec89ec0dc6a932a106fa088b73b5"),
    },
    "makeSamplerConfiguration": {
        "symbol": "_ZN2vk24MakeSamplerConfigurationERK24GfxTextureSamplingParams",
        "release": (0xF96640, 84, "e68b7a77bb43b4ba8b47794e3045ea49b51c88089bae4be2bd037e5459d80b11"),
        "game": (0xAC9E84, 84, "2b8fde12592e0e5158f8ea6a2605eb317550b0da383807a77354cb56e8dc1f93"),
    },
    "makeSamplerCreateInfo": {
        "symbol": "_ZN2vk21MakeSamplerCreateInfoERKNS_20SamplerConfigurationE",
        "release": (0xF96694, 200, "7b40a12bfb57b33e897ec213f08d254fe833276a19d8b1df1e586268487dc2e4"),
        "game": (0xAC9ED8, 200, "93a7c90545925bd4d8c79601b2abba837468a0f15d915745f8baeaab98bf4365"),
    },
}

CONSTANTS = {
    "release": {
        "inlineDefaults": (0x157E30, (0, 2)),
        "inlineWrapShifts": (0x1594C8, (2, 4)),
        "configurationShifts": (0x153D40, (8, 12, 14, 16)),
        "configurationMasks": (0x156870, (0x300, 0x3000, 0xC000, 0x30000)),
        "vulkanAddressModes": (0x1802410, (0, 2, 1, 4)),
    },
    "game": {
        "inlineDefaults": (0x162D20, (0, 2)),
        "inlineWrapShifts": (0x163E98, (2, 4)),
        "configurationShifts": (0x15F9D0, (8, 12, 14, 16)),
        "configurationMasks": (0x161BB0, (0x300, 0x3000, 0xC000, 0x30000)),
        "vulkanAddressModes": (0x11DE138, (0, 2, 1, 4)),
    },
}


def require(condition: bool, message: str) -> None:
    if not condition:
        raise RuntimeError(message)


def sha256(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


class Elf:
    def __init__(self, path: Path):
        self.path = path
        self.data = path.read_bytes()
        self.stream = path.open("rb")
        self.elf = ELFFile(self.stream)

    def close(self) -> None:
        self.stream.close()

    def read(self, address: int, size: int) -> bytes:
        for segment in self.elf.iter_segments():
            start = int(segment["p_vaddr"])
            offset = address - start
            if offset >= 0 and offset + size <= int(segment["p_filesz"]):
                return segment.data()[offset : offset + size]
        raise RuntimeError(f"{self.path}: RVA {address:#x}+{size:#x} is not file-backed")

    def symbol(self, name: str) -> tuple[int, int]:
        table = self.elf.get_section_by_name(".symtab")
        require(table is not None, f"{self.path}: .symtab is missing")
        matches = [
            (int(item["st_value"]), int(item["st_size"]))
            for item in table.iter_symbols()
            if item.name == name
        ]
        require(len(matches) == 1, f"{self.path}: expected one symbol {name}")
        return matches[0]


def instructions(image: Elf, address: int, size: int) -> list[str]:
    decoder = Cs(CS_ARCH_ARM64, CS_MODE_LITTLE_ENDIAN)
    return [
        item.mnemonic + (f" {item.op_str}" if item.op_str else "")
        for item in decoder.disasm(image.read(address, size), address)
    ]


def require_instruction(rows: list[str], expected: str, label: str) -> None:
    require(expected in rows, f"{label}: missing instruction {expected}")


def verify_native_functions(game: Elf, release: Elf, symbols: Elf) -> dict:
    result = {}
    for name, entry in FUNCTIONS.items():
        release_address, release_size, release_hash = entry["release"]
        game_address, game_size, game_hash = entry["game"]
        require(
            symbols.symbol(entry["symbol"]) == (release_address, release_size),
            f"{name}: official release symbol moved",
        )
        release_body = release.read(release_address, release_size)
        game_body = game.read(game_address, game_size)
        require(sha256(release_body) == release_hash, f"{name}: release bytes changed")
        require(sha256(game_body) == game_hash, f"{name}: game bytes changed")
        result[name] = {
            "officialSymbol": entry["symbol"],
            "release": {
                "rva": hex(release_address),
                "byteSize": release_size,
                "sha256": release_hash,
            },
            "game": {
                "rva": hex(game_address),
                "byteSize": game_size,
                "sha256": game_hash,
            },
        }

    create_rows = instructions(game, FUNCTIONS["createInlineSampler"]["game"][0], 184)
    for expected in (
        "and w10, w8, #3",
        "ubfx w9, w8, #6, #2",
        "tbz w8, #8, #0xb1c4b8",
        "ubfx w0, w8, #9, #3",
        "bl #0xac9e84",
    ):
        require_instruction(create_rows, expected, "game CreateInlineSampler")

    config_rows = instructions(game, FUNCTIONS["makeSamplerConfiguration"]["game"][0], 84)
    for expected in (
        "ldur q0, [x0, #4]",
        "ushl v0.4s, v0.4s, v1.4s",
        "and v0.16b, v0.16b, v1.16b",
        "ldrb w8, [x0, #0x14]",
        "bfi x0, x10, #0x20, #0x20",
    ):
        require_instruction(config_rows, expected, "game MakeSamplerConfiguration")

    create_info_rows = instructions(game, FUNCTIONS["makeSamplerCreateInfo"]["game"][0], 200)
    for expected in (
        "ands w9, w20, #0x300",
        "cset w12, ne",
        "cmp w9, #0x200",
        "cset w9, eq",
        "ubfx x10, x20, #0xc, #2",
        "ubfx x11, x20, #0xe, #2",
        "ubfx x9, x20, #0x10, #2",
    ):
        require_instruction(create_info_rows, expected, "game MakeSamplerCreateInfo")
    return result


def verify_constants(game: Elf, release: Elf) -> dict:
    result = {}
    for group, image in (("release", release), ("game", game)):
        result[group] = {}
        for name, (address, expected) in CONSTANTS[group].items():
            values = struct.unpack(f"<{len(expected)}I", image.read(address, len(expected) * 4))
            require(values == expected, f"{group} {name} changed: {values}")
            result[group][name] = {
                "rva": hex(address),
                "values": list(values),
            }
    for name in CONSTANTS["release"]:
        require(
            result["release"][name]["values"] == result["game"][name]["values"],
            f"{name}: release/game producer constants differ",
        )
    return result


def decode(value: int, address_modes: tuple[int, ...]) -> dict:
    require(0 <= value <= 0xFFFF, "inline sampler must fit 16 bits")
    filter_mode = value & 0x3
    wraps = tuple((value >> shift) & 0x3 for shift in (2, 4, 6))
    anisotropy = 1 << ((value >> 9) & 0x7)
    require(filter_mode in (0, 1, 2), f"unsupported filter mode {filter_mode}")
    require(all(item < len(address_modes) for item in wraps), "wrap field is out of range")

    filter_bits = (filter_mode << 8) & 0x300
    vulkan_filter = 1 if filter_bits != 0 else 0
    vulkan_mipmap = 1 if filter_bits == 0x200 else 0
    vulkan_wraps = tuple(address_modes[item] for item in wraps)
    require(vulkan_filter == 1, "FinalBlit sampler is not VK_FILTER_LINEAR")
    require(vulkan_mipmap == 0, "FinalBlit sampler is not VK_SAMPLER_MIPMAP_MODE_NEAREST")
    require(vulkan_wraps == (2, 2, 2), "FinalBlit sampler is not clamp-to-edge")
    require(anisotropy == 1, "FinalBlit inline sampler anisotropy changed")

    return {
        "packedValue": value,
        "packedHex": f"0x{value:04x}",
        "fields": {
            "filter": filter_mode,
            "wrapU": wraps[0],
            "wrapV": wraps[1],
            "wrapW": wraps[2],
            "anisotropy": anisotropy,
        },
        "vulkan": {
            "magFilter": {"value": vulkan_filter, "name": "VK_FILTER_LINEAR"},
            "minFilter": {"value": vulkan_filter, "name": "VK_FILTER_LINEAR"},
            "mipmapMode": {
                "value": vulkan_mipmap,
                "name": "VK_SAMPLER_MIPMAP_MODE_NEAREST",
            },
            "addressModeU": {"value": vulkan_wraps[0], "name": "VK_SAMPLER_ADDRESS_MODE_CLAMP_TO_EDGE"},
            "addressModeV": {"value": vulkan_wraps[1], "name": "VK_SAMPLER_ADDRESS_MODE_CLAMP_TO_EDGE"},
            "addressModeW": {"value": vulkan_wraps[2], "name": "VK_SAMPLER_ADDRESS_MODE_CLAMP_TO_EDGE"},
            "maxAnisotropy": anisotropy,
        },
        "webgl2": {
            "minFilter": "LINEAR",
            "magFilter": "LINEAR",
            "wrapS": "CLAMP_TO_EDGE",
            "wrapT": "CLAMP_TO_EDGE",
        },
    }


def main() -> None:
    loaded = load_official_sample()
    sample = loaded["sample"]
    expected = sample["artifacts"]
    require(sha256(GAME.read_bytes()) == expected["libunity"]["sha256"], "game libunity hash mismatch")
    require(sha256(RELEASE.read_bytes()) == expected["unityReleasePlayer"]["sha256"], "release player hash mismatch")
    require(sha256(SYMBOLS.read_bytes()) == expected["unityReleaseSymbols"]["sha256"], "release symbols hash mismatch")

    game = Elf(GAME)
    release = Elf(RELEASE)
    symbols = Elf(SYMBOLS)
    try:
        native = verify_native_functions(game, release, symbols)
        constants = verify_constants(game, release)
        decoded = decode(85, tuple(CONSTANTS["game"]["vulkanAddressModes"][1]))
    finally:
        game.close()
        release.close()
        symbols.close()

    print(json.dumps({
        "schema": "pocket-card-render/official-inline-sampler@1",
        "sampleId": sample["sampleId"],
        "sampleManifestSha256": loaded["sampleManifestSha256"],
        "source": {
            "gameLibunitySha256": expected["libunity"]["sha256"],
            "unityReleasePlayerSha256": expected["unityReleasePlayer"]["sha256"],
            "unityReleaseSymbolsSha256": expected["unityReleaseSymbols"]["sha256"],
        },
        "nativeFunctions": native,
        "constants": constants,
        "decoded": decoded,
        "claim": "game-byte-mapped Unity Vulkan inline sampler decode",
    }, ensure_ascii=True, sort_keys=True))


if __name__ == "__main__":
    main()
