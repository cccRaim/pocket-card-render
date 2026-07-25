#!/usr/bin/env python3
"""Extract the official Unity TextCore SDFAA native call chain.

This is a read-only evidence extractor. It maps public Unity 2022.3.62f2
symbols to the exact libunity.so shipped by Pokemon TCG Pocket 1.6.0 and
reports the native functions that generate TMP's dynamic glyph atlas.
"""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import struct

from capstone import Cs, CS_ARCH_ARM64, CS_MODE_LITTLE_ENDIAN


ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT.parent / ".cache"
GAME_LIBUNITY = Path(
    os.environ.get("PCR_GAME_LIBUNITY", CACHE / "ptcgp-1.6.0/libunity.so")
)
RELEASE_LIBUNITY = Path(
    os.environ.get(
        "PCR_UNITY_RELEASE_LIBUNITY",
        CACHE / "unity-2022.3.62f2/symbols/libunity.release.arm64.so",
    )
)
RELEASE_SYMBOLS = Path(
    os.environ.get(
        "PCR_UNITY_RELEASE_SYMBOLS",
        CACHE / "unity-2022.3.62f2/symbols/libunity.release.arm64.sym.so",
    )
)


# The game RVA and anchor describe an independently byte-matched location in
# the shipped game image. Relocated functions differ only where the linker
# rewrote PC-relative instructions; wholeExact marks the functions whose full
# native bodies are byte-identical.
FUNCTIONS = (
    ("setPixelSizeAndUpsampling", "_ZN8TextCore30SetPixelSizeAndUpSamplingValueENS_10RenderModeERi", 0xC3DD08, 204, 0x8D1DEC, 0, 28),
    ("loadGlyphSlot", "_ZN8TextCore17Load_FT_GlyphSlotENS_10RenderModeEjR10FT_Bitmap_RKP16FT_GlyphSlotRec_RiS7_RbRhi", 0xC3DED8, 620, 0x8D1FBC, 108, 104),
    ("copyGlyphSlotToTexture", "_ZN8TextCore31Copy_FT_GlyphSlot_DataToTextureENS_10RenderModeEPNS_9GlyphRectEPhiP10FT_Bitmap_iiiih", 0xC3E144, 460, 0x8D2228, 0, 460),
    ("generateSdf", "_ZN8TextCore12Generate_SDFEPhiS0_iiiiii", 0xC3E310, 576, 0x8D23F4, 84, 492),
    ("generate3x3AaEdt", "_ZN8TextCore17Generate_3X3AAEDTEPhiiiS0_iiii", 0xC3E550, 548, 0x8D2634, 264, 240),
    ("renderGlyphToTextureJob", "_ZN8TextCore23RenderGlyphToTextureJobEPNS_18RenderGlyphJobDataE", 0xC3EEB4, 204, 0x8D2858, 16, 112),
    ("computeEdgeGradient", "_ZN8TextCore19ComputeEdgeGradientEPNS_5PixelEPhiii", 0xC4542C, 408, 0x8D4260, 316, 92),
    ("approximateEdgeDelta", "_ZN8TextCore20ApproximateEdgeDeltaEfff", 0xC455C4, 196, 0x8D43F8, 0, 196),
    ("calculate3x3AaEdt", "_ZN8TextCore17Calculate3x3AAEDTEPhiiiiPNS_5PixelE", 0xC45688, 2012, 0x8D44BC, 0, 2012),
)


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def c_string(data: bytes, offset: int) -> str:
    end = data.find(b"\0", offset)
    if end < 0:
        raise RuntimeError("unterminated ELF string")
    return data[offset:end].decode("utf-8", "replace")


class Elf64:
    def __init__(self, path: Path):
        self.path = path.resolve()
        self.data = path.read_bytes()
        if self.data[:6] != b"\x7fELF\x02\x01":
            raise RuntimeError(f"{path}: expected ELF64 little-endian")
        self.programs = self._program_headers()
        self.sections = self._section_headers()

    def _program_headers(self) -> list[dict]:
        offset = struct.unpack_from("<Q", self.data, 0x20)[0]
        entry_size = struct.unpack_from("<H", self.data, 0x36)[0]
        count = struct.unpack_from("<H", self.data, 0x38)[0]
        result = []
        for index in range(count):
            values = struct.unpack_from(
                "<IIQQQQQQ", self.data, offset + index * entry_size
            )
            result.append(
                dict(
                    type=values[0],
                    flags=values[1],
                    offset=values[2],
                    vaddr=values[3],
                    fileSize=values[5],
                    memorySize=values[6],
                )
            )
        return result

    def _section_headers(self) -> list[dict]:
        offset = struct.unpack_from("<Q", self.data, 0x28)[0]
        entry_size = struct.unpack_from("<H", self.data, 0x3A)[0]
        count = struct.unpack_from("<H", self.data, 0x3C)[0]
        string_index = struct.unpack_from("<H", self.data, 0x3E)[0]
        raw = []
        for index in range(count):
            raw.append(
                struct.unpack_from(
                    "<IIQQQQIIQQ", self.data, offset + index * entry_size
                )
            )
        strings_section = raw[string_index]
        strings = self.data[
            strings_section[4] : strings_section[4] + strings_section[5]
        ]
        result = []
        for values in raw:
            result.append(
                dict(
                    name=c_string(strings, values[0]),
                    type=values[1],
                    flags=values[2],
                    address=values[3],
                    offset=values[4],
                    size=values[5],
                    link=values[6],
                    entrySize=values[9],
                )
            )
        return result

    def virtual_to_offset(self, address: int) -> int:
        for program in self.programs:
            if program["type"] != 1:
                continue
            start = program["vaddr"]
            if start <= address < start + program["fileSize"]:
                return program["offset"] + address - start
        raise RuntimeError(f"{self.path}: RVA 0x{address:x} is not file-backed")

    def read_virtual(self, address: int, size: int) -> bytes:
        offset = self.virtual_to_offset(address)
        result = self.data[offset : offset + size]
        if len(result) != size:
            raise RuntimeError(f"{self.path}: truncated read at RVA 0x{address:x}")
        return result

    def function_symbols(self) -> dict[str, tuple[int, int]]:
        result = {}
        for section in self.sections:
            if section["name"] not in (".symtab", ".dynsym"):
                continue
            strings_section = self.sections[section["link"]]
            strings = self.data[
                strings_section["offset"] : strings_section["offset"]
                + strings_section["size"]
            ]
            entry_size = section["entrySize"] or 24
            count = section["size"] // entry_size
            for index in range(count):
                entry = section["offset"] + index * entry_size
                name_offset, info, _, _, value, size = struct.unpack_from(
                    "<IBBHQQ", self.data, entry
                )
                if info & 0xF != 2 or not name_offset:
                    continue
                result[c_string(strings, name_offset)] = (value, size)
        return result


def instruction_map(data: bytes, address: int) -> dict[int, tuple[str, str]]:
    decoder = Cs(CS_ARCH_ARM64, CS_MODE_LITTLE_ENDIAN)
    return {
        instruction.address: (instruction.mnemonic, instruction.op_str)
        for instruction in decoder.disasm(data, address)
    }


def require_instruction(
    instructions: dict[int, tuple[str, str]],
    address: int,
    mnemonic: str,
    operands: str,
) -> None:
    actual = instructions.get(address)
    expected = (mnemonic, operands)
    if actual != expected:
        raise RuntimeError(
            f"instruction mismatch at 0x{address:x}: expected {expected}, got {actual}"
        )


def extract() -> dict:
    game = Elf64(GAME_LIBUNITY)
    release = Elf64(RELEASE_LIBUNITY)
    symbols = Elf64(RELEASE_SYMBOLS)
    symbol_table = symbols.function_symbols()
    mappings = []
    game_functions = {}

    for function_id, symbol, release_rva, size, game_rva, anchor_offset, anchor_size in FUNCTIONS:
        if symbol_table.get(symbol) != (release_rva, size):
            raise RuntimeError(f"public symbol mismatch: {symbol}")
        release_bytes = release.read_virtual(release_rva, size)
        game_bytes = game.read_virtual(game_rva, size)
        anchor = release_bytes[anchor_offset : anchor_offset + anchor_size]
        if game_bytes[anchor_offset : anchor_offset + anchor_size] != anchor:
            raise RuntimeError(f"{function_id}: game/release anchor mismatch")
        if game.data.count(anchor) != 1 or release.data.count(anchor) != 1:
            raise RuntimeError(f"{function_id}: anchor is not unique in both native images")
        exact_words = sum(
            release_bytes[index : index + 4] == game_bytes[index : index + 4]
            for index in range(0, size, 4)
        )
        mappings.append(
            {
                "id": function_id,
                "symbol": symbol,
                "releaseRva": f"0x{release_rva:x}",
                "gameRva": f"0x{game_rva:x}",
                "byteSize": size,
                "anchorOffset": anchor_offset,
                "anchorByteSize": anchor_size,
                "exactInstructionBytes": exact_words * 4,
                "wholeFunctionExact": release_bytes == game_bytes,
                "releaseSha256": sha256(release_bytes),
                "gameSha256": sha256(game_bytes),
            }
        )
        game_functions[function_id] = instruction_map(game_bytes, game_rva)

    load = game_functions["loadGlyphSlot"]
    require_instruction(load, 0x8D20B0, "mov", "w8, #0x1045")
    require_instruction(load, 0x8D20B4, "cmp", "w0, w8")
    require_instruction(load, 0x8D20B8, "b.ne", "#0x8d220c")
    require_instruction(load, 0x8D20C4, "mov", "w2, #6")

    copy = game_functions["copyGlyphSlotToTexture"]
    require_instruction(copy, 0x8D234C, "b", "#0x8d2634")
    require_instruction(copy, 0x8D23DC, "b", "#0x8d23f4")

    render_job = game_functions["renderGlyphToTextureJob"]
    require_instruction(render_job, 0x8D28D8, "bl", "#0x8d2228")

    calculate = game_functions["calculate3x3AaEdt"]
    delta_calls = (
        0x8D4664,
        0x8D46D8,
        0x8D4760,
        0x8D47F4,
        0x8D4864,
        0x8D4A04,
        0x8D4AB0,
        0x8D4B24,
        0x8D4BDC,
    )
    for address in delta_calls:
        require_instruction(calculate, address, "bl", "#0x8d43f8")
    require_instruction(calculate, 0x8D4858, "bl", "#0x8d4260")

    generate = game_functions["generate3x3AaEdt"]
    require_instruction(generate, 0x8D27B4, "fsqrt", "s3, s3")
    require_instruction(generate, 0x8D27BC, "fmul", "s3, s1, s3")
    require_instruction(generate, 0x8D27C4, "fminnm", "s3, s3, s4")
    require_instruction(generate, 0x8D27C8, "fmaxnm", "s3, s3, s0")
    require_instruction(generate, 0x8D27CC, "fsub", "s3, s4, s3")
    require_instruction(generate, 0x8D27D8, "fsqrt", "s3, s3")
    require_instruction(generate, 0x8D27F0, "fadd", "s3, s3, s4")
    require_instruction(generate, 0x8D27F4, "fadd", "s3, s3, s2")
    require_instruction(generate, 0x8D27F8, "fcvtzs", "w2, s3")

    return {
        "schemaVersion": 1,
        "source": {
            "unityVersion": "2022.3.62f2",
            "gameVersion": "1.6.0",
            "gameLibunity": str(game.path),
            "gameLibunityByteSize": len(game.data),
            "gameLibunitySha256": sha256(game.data),
            "releaseLibunity": str(release.path),
            "releaseLibunityByteSize": len(release.data),
            "releaseLibunitySha256": sha256(release.data),
            "releaseSymbols": str(symbols.path),
            "releaseSymbolsByteSize": len(symbols.data),
            "releaseSymbolsSha256": sha256(symbols.data),
        },
        "functions": mappings,
        "facts": {
            "dynamicAtlasRenderMode": {"decimal": 4165, "hex": "0x1045"},
            "glyphLoadFlags": 6,
            "glyphSlotCopyForDynamicAtlas": "generate3x3AaEdt",
            "freeTypeSdfPathForDynamicAtlas": False,
            "renderJobCallsGlyphSlotCopy": True,
            "distanceTransform": {
                "generator": "generate3x3AaEdt",
                "calculator": "calculate3x3AaEdt",
                "edgeGradient": "computeEdgeGradient",
                "edgeDelta": "approximateEdgeDelta",
                "pixelStrideBytes": 32,
                "outputCenter": 127,
                "outputScaleFormula": "255 / (2 * padding + 2)",
                "rounding": "add 0.5 then fcvtzs",
            },
        },
    }


if __name__ == "__main__":
    print(json.dumps(extract(), ensure_ascii=True, indent=2))
