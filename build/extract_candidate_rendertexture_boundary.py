#!/usr/bin/env python3
"""Extract Unity 6 candidate RenderTexture request evidence.

This extractor deliberately keeps three evidence domains separate:

* serialized inputs from candidate package/snapshot bytes;
* candidate IL2CPP code which produces a RenderTexture request;
* native Unity/guest GPU effects, which are reported as unresolved elsewhere.

Il2CppDumper output is used only as a method-address locator. Every semantic
claim is checked again against the manifest-matched ARM64 libil2cpp bytes.
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
from pathlib import Path
import re
import struct
import sys
import warnings
import zipfile

from capstone import CS_ARCH_ARM64, CS_MODE_ARM, Cs
from elftools.elf.elffile import ELFFile
import UnityPy
from UnityPy.helpers.TypeTreeHelper import TypeTreeConfig, read_value


EXPECTED_SAMPLE_ID = "ptcgp-1.7.0-unity-6000.0.69f1-candidate"
EXPECTED_UNITY_VERSION = "6000.0.69f1"
GGM_ENTRY = "assets/bin/Data/globalgamemanagers"
METADATA_ENTRY = "assets/bin/Data/Managed/Metadata/global-metadata.dat"
IL2CPP_ENTRY = "lib/arm64-v8a/libil2cpp.so"
LIBUNITY_ENTRY = "lib/arm64-v8a/libunity.so"
DETAIL_BUNDLE = Path("Common/UI/Prefabs/Common/CommonUICardDetailCard.prefab_bundles")
DETAIL_PATH_ID = -2600777029953942905
TEST_MUTATION = os.environ.get(
    "PCR_TEST_CANDIDATE_RENDERTEXTURE_MUTATION",
)

PLAYER_SETTINGS_GENERATE_TYPETREE_SYMBOL = (
    "_ZN14PlayerSettings8TransferI24GenerateTypeTreeTransferEEvRT_"
)
PLAYER_SETTINGS_SAFE_BINARY_READ_SYMBOL = (
    "_ZN14PlayerSettings8TransferI14SafeBinaryReadEEvRT_"
)
PLAYER_SETTINGS_DENY_FIELD = "androidVulkanDenyFilterList"
PLAYER_SETTINGS_ALLOW_FIELD = "androidVulkanAllowFilterList"
RENDER_TEXTURE_FORMAT_SYMBOL = (
    "_Z17GetGraphicsFormat19RenderTextureFormat17TextureColorSpace"
)
RENDER_TEXTURE_READ_WRITE_SYMBOL = (
    "_Z17GetGraphicsFormat19RenderTextureFormat22RenderTextureReadWrite"
)
RENDER_TEXTURE_FORMAT_TABLE_SYMBOL = (
    "_ZZ17GetGraphicsFormat19RenderTextureFormat17TextureColorSpaceE5table"
)
RENDER_TEXTURE_NATIVE_HELPER_SYMBOL = (
    "_Z44GetGraphicsFormat_Native_RenderTextureFormat"
    "19RenderTextureFormatb"
)
RENDER_TEXTURE_NATIVE_WRAPPER_SYMBOL = (
    "_Z73GraphicsFormatUtility_CUSTOM_GetGraphicsFormat_Native_"
    "RenderTextureFormat19RenderTextureFormath"
)
RENDER_TEXTURE_DESC_CTOR_SYMBOL = "_ZN17RenderTextureDescC1Ev"
RENDER_TEXTURE_CTOR_SYMBOL = (
    "_ZN13RenderTextureC1E10MemLabelId18ObjectCreationMode"
)

METHOD_NAMES = {
    "uiCardViewCreateRenderer":
        "Lettuce.Infrastructure.Card.Core.UICardView$$CreateRenderer",
    "cardRendererCtor":
        "Lettuce.Infrastructure.Card.Core.CardRenderer$$.ctor",
    "cardRendererCreateRenderTexture":
        "Lettuce.Infrastructure.Card.Core.CardRenderer$$CreateRenderTexture",
    "cardRendererUpdateRenderTexture":
        "Lettuce.Infrastructure.Card.Core.CardRenderer$$UpdateRenderTexture",
    "cardRendererCctor":
        "Lettuce.Infrastructure.Card.Core.CardRenderer$$.cctor",
    "asset3DCreateRenderTexture":
        "Lettuce.Infrastructure.Asset3D.Core.Asset3DRenderer$$CreateRenderTexture",
    "cardDimensionPixelSize":
        "Lettuce.Infrastructure.Asset3D.Core.CardDimension$$PixelSize",
    "cardDimensionCctor":
        "Lettuce.Infrastructure.Asset3D.Core.CardDimension$$.cctor",
    "uiCardViewSizeToCardSize":
        "Lettuce.Infrastructure.Card.Core.Data.UICardViewSizeTypeExtensions$$ToCardSize",
    "qualitySet":
        "Lettuce.Infrastructure.QualitySettings.QualitySettings$$SetQuality",
}


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def identity(data: bytes) -> dict:
    return {"byteLength": len(data), "sha256": sha256(data)}


def canonical_digest(value: object) -> str:
    serialized = json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return sha256(serialized)


def elf_load_segments(elf: ELFFile) -> list:
    return [
        segment
        for segment in elf.iter_segments()
        if segment["p_type"] == "PT_LOAD"
    ]


def elf_file_offset(elf: ELFFile, virtual_address: int, size: int = 1) -> int:
    for segment in elf_load_segments(elf):
        relative = virtual_address - int(segment["p_vaddr"])
        if (
            relative >= 0
            and relative + size <= int(segment["p_filesz"])
        ):
            return int(segment["p_offset"]) + relative
    raise RuntimeError(
        f"ELF virtual range {virtual_address:#x}+{size:#x} is not file-backed"
    )


def elf_virtual_address(elf: ELFFile, file_offset: int) -> int:
    for segment in elf_load_segments(elf):
        relative = file_offset - int(segment["p_offset"])
        if relative >= 0 and relative < int(segment["p_filesz"]):
            return int(segment["p_vaddr"]) + relative
    raise RuntimeError(f"ELF file offset {file_offset:#x} is not load-backed")


def elf_build_id_note(elf: ELFFile) -> dict:
    section = elf.get_section_by_name(".note.gnu.build-id")
    if section is None:
        raise RuntimeError("Unity ELF has no .note.gnu.build-id")
    raw = section.data()
    return {
        "section": ".note.gnu.build-id",
        "rawHex": raw.hex(),
        **identity(raw),
    }


def unique_elf_string_address(
    data: bytes,
    elf: ELFFile,
    value: str,
) -> dict:
    encoded = value.encode("ascii") + b"\0"
    offsets = []
    cursor = 0
    while True:
        offset = data.find(encoded, cursor)
        if offset < 0:
            break
        offsets.append(offset)
        cursor = offset + 1
    if len(offsets) != 1:
        raise RuntimeError(
            f"Unity ELF string {value!r} occurs {len(offsets)} times"
        )
    offset = offsets[0]
    return {
        "value": value,
        "fileOffset": offset,
        "rva": elf_virtual_address(elf, offset),
        **identity(encoded),
    }


def decode_adrp_x1_add_x1_target(
    first_word: int,
    second_word: int,
    address: int,
) -> int | None:
    if (
        first_word & 0x9F000000 != 0x90000000
        or first_word & 0x1F != 1
        or second_word & 0xFF000000 != 0x91000000
        or second_word & 0x1F != 1
        or (second_word >> 5) & 0x1F != 1
    ):
        return None
    immediate = (
        ((first_word >> 5) & 0x7FFFF) << 2
        | ((first_word >> 29) & 0x3)
    )
    if immediate & (1 << 20):
        immediate -= 1 << 21
    page = (address & ~0xFFF) + (immediate << 12)
    addend = (second_word >> 10) & 0xFFF
    if (second_word >> 22) & 1:
        addend <<= 12
    return page + addend


def decode_adrp_add_target(
    first_word: int,
    second_word: int,
    address: int,
) -> tuple[int, int] | None:
    if first_word & 0x9F000000 != 0x90000000:
        return None
    register = first_word & 0x1F
    if (
        second_word & 0x7F000000 != 0x11000000
        or (second_word >> 5) & 0x1F != register
    ):
        return None
    immediate = (
        ((first_word >> 5) & 0x7FFFF) << 2
        | ((first_word >> 29) & 0x3)
    )
    if immediate & (1 << 20):
        immediate -= 1 << 21
    page = (address & ~0xFFF) + (immediate << 12)
    addend = (second_word >> 10) & 0xFFF
    if (second_word >> 22) & 1:
        addend <<= 12
    return page + addend, second_word & 0x1F


def adrp_add_xrefs(
    data: bytes,
    elf: ELFFile,
    target: int,
) -> list[dict]:
    text = elf.get_section_by_name(".text")
    if text is None or int(text["sh_size"]) % 4:
        raise RuntimeError("Unity ELF .text shape changed")
    raw = text.data()
    base = int(text["sh_addr"])
    result = []
    for offset in range(0, len(raw) - 4, 4):
        first, second = struct.unpack_from("<II", raw, offset)
        decoded = decode_adrp_add_target(
            first,
            second,
            base + offset,
        )
        if decoded is None or decoded[0] != target:
            continue
        result.append(
            {
                "rva": base + offset,
                "register": decoded[1],
                "bytes": raw[offset : offset + 8],
            }
        )
    return result


def direct_branch_target(instruction) -> int | None:
    if instruction.mnemonic not in {"b", "bl"}:
        return None
    match = re.fullmatch(r"#0x([0-9a-f]+)", instruction.op_str)
    return int(match.group(1), 16) if match else None


def direct_branch_xrefs(
    data: bytes,
    elf: ELFFile,
    target: int,
) -> list[dict]:
    text = elf.get_section_by_name(".text")
    if text is None or int(text["sh_size"]) % 4:
        raise RuntimeError("Unity ELF .text shape changed")
    raw = text.data()
    base = int(text["sh_addr"])
    result = []
    for offset in range(0, len(raw), 4):
        word = struct.unpack_from("<I", raw, offset)[0]
        opcode = word >> 26
        if opcode not in (0b000101, 0b100101):
            continue
        immediate = word & 0x3FFFFFF
        if immediate & (1 << 25):
            immediate -= 1 << 26
        address = base + offset
        if address + (immediate << 2) != target:
            continue
        result.append(
            {
                "rva": address,
                "kind": "bl" if opcode == 0b100101 else "b",
                "bytes": raw[offset : offset + 4],
            }
        )
    return result


def unique_bytes_occurrence(
    data: bytes,
    elf: ELFFile,
    needle: bytes,
    label: str,
) -> dict:
    offsets = []
    cursor = 0
    while True:
        offset = data.find(needle, cursor)
        if offset < 0:
            break
        offsets.append(offset)
        cursor = offset + 1
    if len(offsets) != 1:
        raise RuntimeError(
            f"{label} occurs {len(offsets)} times in candidate libunity"
        )
    offset = offsets[0]
    return {
        "fileOffset": offset,
        "rva": elf_virtual_address(elf, offset),
        "bytesHex": needle.hex(),
        **identity(needle),
    }


def decode_function(
    data: bytes,
    elf: ELFFile,
    start: int,
    size: int,
) -> tuple[bytes, list]:
    offset = elf_file_offset(elf, start, size)
    body = data[offset : offset + size]
    instructions = list(
        Cs(CS_ARCH_ARM64, CS_MODE_ARM).disasm(body, start)
    )
    if (
        len(instructions) * 4 != size
        or instructions[0].address != start
    ):
        raise RuntimeError(
            f"Unity function {start:#x}+{size:#x} did not decode strictly"
        )
    return body, instructions


def normalized_function_shape(
    instructions: list,
    start: int,
    size: int,
) -> list[str]:
    end = start + size
    result = []
    for instruction in instructions:
        operands = instruction.op_str
        if instruction.mnemonic == "adrp":
            operands = re.sub(r"#0x[0-9a-f]+$", "#page", operands)
        elif (
            instruction.mnemonic == "add"
            and re.fullmatch(
                r"x([0-9]+), x\1, #0x[0-9a-f]+",
                operands,
            )
        ):
            operands = re.sub(r"#0x[0-9a-f]+$", "#pageoff", operands)
        elif (
            instruction.mnemonic.startswith("b")
            or instruction.mnemonic in {"cbz", "cbnz", "tbz", "tbnz"}
        ):
            match = re.search(r"#0x([0-9a-f]+)$", operands)
            if match:
                target = int(match.group(1), 16)
                replacement = (
                    f"#self+0x{target - start:x}"
                    if start <= target < end
                    else "#external"
                )
                operands = operands[: match.start()] + replacement
        result.append(
            f"+0x{instruction.address - start:x}:"
            f"{instruction.mnemonic} {operands}".rstrip()
        )
    return result


def require_same_function_shape(
    label: str,
    release_instructions: list,
    release_start: int,
    game_instructions: list,
    game_start: int,
    size: int,
) -> list[str]:
    release_shape = normalized_function_shape(
        release_instructions,
        release_start,
        size,
    )
    game_shape = normalized_function_shape(
        game_instructions,
        game_start,
        size,
    )
    if release_shape != game_shape:
        for index, (left, right) in enumerate(
            zip(release_shape, game_shape, strict=False)
        ):
            if left != right:
                raise RuntimeError(
                    f"{label} normalized instruction {index} differs: "
                    f"{left!r} != {right!r}"
                )
        raise RuntimeError(f"{label} normalized instruction count differs")
    return game_shape


def instruction_record(instruction, start: int) -> dict:
    return {
        "rva": f"0x{instruction.address:x}",
        "relativeOffset": f"0x{instruction.address - start:x}",
        "text": instruction_text(instruction),
        "bytesHex": instruction.bytes.hex(),
        "sha256": sha256(instruction.bytes),
    }


def adrp_load_target(
    adrp_instruction,
    load_instruction,
) -> int:
    adrp_match = re.fullmatch(
        r"(x[0-9]+), #0x([0-9a-f]+)",
        adrp_instruction.op_str,
    )
    load_match = re.fullmatch(
        r"[qdsw][0-9]+, \[(x[0-9]+)(?:, #0x([0-9a-f]+))?\]",
        load_instruction.op_str,
    )
    if (
        adrp_instruction.mnemonic != "adrp"
        or load_instruction.mnemonic != "ldr"
        or adrp_match is None
        or load_match is None
        or adrp_match.group(1) != load_match.group(1)
    ):
        raise RuntimeError(
            "Unity descriptor constant does not use expected ADRP/LDR pair"
        )
    return int(adrp_match.group(2), 16) + int(
        load_match.group(2) or "0",
        16,
    )


def string_xrefs_many(
    data: bytes,
    elf: ELFFile,
    string_addresses: set[int],
) -> dict[int, list[int]]:
    text = elf.get_section_by_name(".text")
    if text is None or int(text["sh_size"]) % 4:
        raise RuntimeError("Unity ELF .text shape changed")
    raw = text.data()
    base = int(text["sh_addr"])
    result = {address: [] for address in string_addresses}
    for offset in range(0, len(raw) - 4, 4):
        first, second = struct.unpack_from("<II", raw, offset)
        target = decode_adrp_x1_add_x1_target(
            first,
            second,
            base + offset,
        )
        if target in result:
            result[target].append(base + offset)
    return result


def string_xrefs(
    data: bytes,
    elf: ELFFile,
    string_address: int,
) -> list[int]:
    return string_xrefs_many(
        data,
        elf,
        {string_address},
    )[string_address]


def function_symbol(
    player_data: bytes,
    player_elf: ELFFile,
    symbols_elf: ELFFile,
    name: str,
) -> tuple[dict, bytes]:
    symbol_table = symbols_elf.get_section_by_name(".symtab")
    if symbol_table is None:
        raise RuntimeError("Unity release symbols have no .symtab")
    matches = [
        symbol for symbol in symbol_table.iter_symbols()
        if symbol.name == name
    ]
    if len(matches) != 1:
        raise RuntimeError(
            f"Unity release symbol {name!r} occurs {len(matches)} times"
        )
    symbol = matches[0]
    address = int(symbol["st_value"])
    size = int(symbol["st_size"])
    if size <= 0:
        raise RuntimeError(f"Unity release symbol {name!r} has no body")
    offset = elf_file_offset(player_elf, address, size)
    body = player_data[offset : offset + size]
    return {
        "symbol": name,
        "rva": f"0x{address:x}",
        **identity(body),
    }, body


def instructions_to_first_ret(
    data: bytes,
    elf: ELFFile,
    start: int,
    maximum_size: int = 0x200,
) -> tuple[list, bytes]:
    offset = elf_file_offset(elf, start, maximum_size)
    raw = data[offset : offset + maximum_size]
    instructions = list(
        Cs(CS_ARCH_ARM64, CS_MODE_ARM).disasm(raw, start)
    )
    ret_index = next(
        (
            index
            for index, instruction in enumerate(instructions)
            if instruction.mnemonic == "ret"
        ),
        None,
    )
    if ret_index is None:
        raise RuntimeError(
            f"Unity transfer tail at {start:#x} has no bounded ret"
        )
    selected = instructions[: ret_index + 1]
    byte_size = selected[-1].address + selected[-1].size - start
    return selected, raw[:byte_size]


def classify_player_settings_tail(
    data: bytes,
    elf: ELFFile,
    allow_xref: int,
    deny_xrefs: list[int],
) -> dict:
    instructions, tail = instructions_to_first_ret(data, elf, allow_xref)
    texts = [instruction_text(item) for item in instructions]
    expected_member_offset = (
        "#0x4cc"
        if TEST_MUTATION == "player-settings-transfer-tail"
        else "#0x4c8"
    )
    generate = (
        f"add x3, x20, {expected_member_offset}" in texts
        and "add x1, x20, #0x4c8" not in texts
    )
    safe_read = f"add x1, x20, {expected_member_offset}" in texts
    if not generate and not safe_read:
        raise RuntimeError(
            "candidate PlayerSettings allow-list transfer tail does not "
            f"reference member {expected_member_offset}"
        )
    role = "GenerateTypeTreeTransfer" if generate else "SafeBinaryRead"
    deny_candidates = [
        address
        for address in deny_xrefs
        if address < allow_xref and allow_xref - address <= 0x300
    ]
    if len(deny_candidates) != 1:
        raise RuntimeError(
            f"candidate PlayerSettings {role} has "
            f"{len(deny_candidates)} nearby deny-list fields"
        )
    deny_xref = deny_candidates[0]
    pair_offset = elf_file_offset(
        elf,
        deny_xref,
        allow_xref + len(tail) - deny_xref,
    )
    pair_window = data[
        pair_offset : pair_offset + allow_xref + len(tail) - deny_xref
    ]
    return {
        "role": role,
        "denyFieldXrefRva": f"0x{deny_xref:x}",
        "allowFieldXrefRva": f"0x{allow_xref:x}",
        "normalReturnRva": f"0x{instructions[-1].address:x}",
        "instructionCountFromAllowField": len(instructions),
        "allowFieldToReturn": {
            "rawHex": tail.hex(),
            **identity(tail),
        },
        "denyFieldThroughReturn": identity(pair_window),
        "lastTransferredMemberOffset": "0x4c8",
        "nextOperation": "ret",
    }


def extract_player_settings_transfer_contract(
    game_libunity: bytes,
    release_player: bytes,
    release_symbols: bytes,
) -> dict:
    game_stream = io.BytesIO(game_libunity)
    release_stream = io.BytesIO(release_player)
    symbols_stream = io.BytesIO(release_symbols)
    game_elf = ELFFile(game_stream)
    release_elf = ELFFile(release_stream)
    symbols_elf = ELFFile(symbols_stream)
    release_build_id = elf_build_id_note(release_elf)
    symbols_build_id = elf_build_id_note(symbols_elf)
    if release_build_id["rawHex"] != symbols_build_id["rawHex"]:
        raise RuntimeError(
            "Unity release player/symbol build IDs do not match"
        )

    field_names = [
        "m_ActiveColorSpace",
        "preserveFramebufferAlpha",
        "disableDepthAndStencilBuffers",
        "vulkanEnableSetSRGBWrite",
        "vulkanEnablePreTransform",
        PLAYER_SETTINGS_DENY_FIELD,
        PLAYER_SETTINGS_ALLOW_FIELD,
    ]
    game_strings = {
        name: unique_elf_string_address(game_libunity, game_elf, name)
        for name in field_names
    }
    game_xrefs_by_address = string_xrefs_many(
        game_libunity,
        game_elf,
        {record["rva"] for record in game_strings.values()},
    )
    game_xrefs = {
        name: game_xrefs_by_address[record["rva"]]
        for name, record in game_strings.items()
    }
    for name, xrefs in game_xrefs.items():
        if len(xrefs) != 2:
            raise RuntimeError(
                f"candidate PlayerSettings field {name!r} has "
                f"{len(xrefs)} game libunity transfer xrefs"
            )

    deny_xrefs = game_xrefs[PLAYER_SETTINGS_DENY_FIELD]
    game_tails = sorted(
        (
            classify_player_settings_tail(
                game_libunity,
                game_elf,
                allow_xref,
                deny_xrefs,
            )
            for allow_xref in game_xrefs[PLAYER_SETTINGS_ALLOW_FIELD]
        ),
        key=lambda item: item["role"],
    )
    if [item["role"] for item in game_tails] != [
        "GenerateTypeTreeTransfer",
        "SafeBinaryRead",
    ]:
        raise RuntimeError(
            "candidate PlayerSettings transfer tail roles changed"
        )

    release_allow_string = unique_elf_string_address(
        release_player,
        release_elf,
        PLAYER_SETTINGS_ALLOW_FIELD,
    )
    release_deny_string = unique_elf_string_address(
        release_player,
        release_elf,
        PLAYER_SETTINGS_DENY_FIELD,
    )
    release_xrefs = string_xrefs_many(
        release_player,
        release_elf,
        {
            release_allow_string["rva"],
            release_deny_string["rva"],
        },
    )
    release_functions = {}
    for key, symbol_name in (
        (
            "GenerateTypeTreeTransfer",
            PLAYER_SETTINGS_GENERATE_TYPETREE_SYMBOL,
        ),
        (
            "SafeBinaryRead",
            PLAYER_SETTINGS_SAFE_BINARY_READ_SYMBOL,
        ),
    ):
        record, body = function_symbol(
            release_player,
            release_elf,
            symbols_elf,
            symbol_name,
        )
        function_start = int(record["rva"], 16)
        function_end = function_start + record["byteLength"]
        allow_xrefs = [
            address
            for address in release_xrefs[release_allow_string["rva"]]
            if function_start <= address < function_end
        ]
        deny_xrefs = [
            address
            for address in release_xrefs[release_deny_string["rva"]]
            if function_start <= address < function_end
        ]
        if len(allow_xrefs) != 1 or len(deny_xrefs) != 1:
            raise RuntimeError(
                f"Unity release {key} PlayerSettings tail field count changed"
            )
        tail = classify_player_settings_tail(
            release_player,
            release_elf,
            allow_xrefs[0],
            deny_xrefs,
        )
        if tail["role"] != key:
            raise RuntimeError(
                f"Unity release symbol {key} has tail role {tail['role']}"
            )
        release_functions[key] = {
            **record,
            "tail": tail,
        }

    official_field_xrefs = {}
    role_ranges = {
        item["role"]: (
            int(item["denyFieldXrefRva"], 16),
            int(item["normalReturnRva"], 16),
        )
        for item in game_tails
    }
    for name in field_names[:-2]:
        xrefs = sorted(game_xrefs[name])
        if not (
            xrefs[0] < role_ranges["GenerateTypeTreeTransfer"][0]
            and xrefs[1] < role_ranges["SafeBinaryRead"][0]
        ):
            raise RuntimeError(
                f"candidate PlayerSettings field {name!r} is not before "
                "the proved terminal allow-list field"
            )
        official_field_xrefs[name] = [f"0x{value:x}" for value in xrefs]

    return {
        "status": "exact-official-transfer-schema-with-unread-object-suffix",
        "gameLibunity": {
            "buildIdNote": elf_build_id_note(game_elf),
            "fieldStrings": {
                name: {
                    **record,
                    "transferXrefRvas": [
                        f"0x{value:x}" for value in game_xrefs[name]
                    ],
                }
                for name, record in game_strings.items()
            },
            "terminalTransferTails": game_tails,
        },
        "unityRelease": {
            "buildIdNote": release_build_id,
            "symbolsBuildIdNote": symbols_build_id,
            "functions": release_functions,
        },
        "parsedFieldTransferXrefs": official_field_xrefs,
        "terminalField": PLAYER_SETTINGS_ALLOW_FIELD,
        "terminalBehavior": (
            "both game and matching Unity release GenerateTypeTreeTransfer/"
            "SafeBinaryRead return after androidVulkanAllowFilterList"
        ),
        "unreadSuffixSemantics": (
            "outside PlayerSettings::Transfer; retained as exact raw object "
            "suffix and excluded from parsed field bytes"
        ),
    }


def read_manifest(selection_path: Path) -> tuple[dict, str]:
    selection = json.loads(selection_path.read_text(encoding="utf-8"))
    if isinstance(selection.get("manifest"), str):
        manifest_path = (selection_path.parent / selection["manifest"]).resolve()
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    else:
        manifest_path = selection_path.resolve()
        manifest = selection
    if manifest.get("sampleId") != EXPECTED_SAMPLE_ID:
        raise RuntimeError(f"unexpected candidate sample: {manifest.get('sampleId')}")
    if manifest.get("status") != "candidate":
        raise RuntimeError("RenderTexture candidate extraction requires status=candidate")
    if manifest.get("unity", {}).get("serializedVersion") != EXPECTED_UNITY_VERSION:
        raise RuntimeError(
            "RenderTexture extractor is pinned to Unity "
            f"{EXPECTED_UNITY_VERSION}"
        )
    return manifest, canonical_digest(manifest)


def verify_identity(label: str, data: bytes, expected: dict) -> None:
    actual = identity(data)
    if expected.get("status") == "unresolved":
        raise RuntimeError(f"{label} is unresolved in candidate manifest")
    if (
        actual["byteLength"] != expected.get("byteLength")
        or actual["sha256"] != expected.get("sha256")
    ):
        raise RuntimeError(
            f"{label} identity mismatch: expected "
            f"{expected.get('byteLength')}/{expected.get('sha256')}, got "
            f"{actual['byteLength']}/{actual['sha256']}"
        )


def instruction_text(instruction) -> str:
    return instruction.mnemonic + (
        f" {instruction.op_str}" if instruction.op_str else ""
    )


class Elf64:
    def __init__(self, data: bytes):
        if data[:4] != b"\x7fELF" or data[4] != 2 or data[5] != 1:
            raise RuntimeError("candidate libil2cpp is not little-endian ELF64")
        self.data = data
        phoff = struct.unpack_from("<Q", data, 0x20)[0]
        phentsize, phnum = struct.unpack_from("<HH", data, 0x36)
        self.loads: list[tuple[int, int, int, int]] = []
        for index in range(phnum):
            offset = phoff + index * phentsize
            values = struct.unpack_from("<IIQQQQQQ", data, offset)
            if values[0] == 1:
                self.loads.append((values[2], values[3], values[5], values[6]))
        if not self.loads:
            raise RuntimeError("candidate libil2cpp has no PT_LOAD segments")
        section_offset = struct.unpack_from("<Q", data, 0x28)[0]
        section_entry_size, section_count = struct.unpack_from(
            "<HH", data, 0x3A
        )
        self.relative_relocations: dict[int, dict] = {}
        for index in range(section_count):
            offset = section_offset + index * section_entry_size
            values = struct.unpack_from("<IIQQQQIIQQ", data, offset)
            section_type = values[1]
            if section_type != 4:
                continue
            file_offset, byte_size, entry_size = (
                values[4],
                values[5],
                values[9],
            )
            if entry_size != 24 or byte_size % entry_size:
                raise RuntimeError("candidate ELF64 RELA section shape changed")
            for relative in range(0, byte_size, entry_size):
                entry_offset = file_offset + relative
                entry = data[entry_offset : entry_offset + entry_size]
                relocation_offset, relocation_info, addend = (
                    struct.unpack("<QQq", entry)
                )
                relocation_type = relocation_info & 0xFFFFFFFF
                symbol = relocation_info >> 32
                if relocation_type != 1027 or symbol != 0:
                    continue
                if relocation_offset in self.relative_relocations:
                    raise RuntimeError(
                        "candidate ELF has duplicate relative relocation at "
                        f"{relocation_offset:#x}"
                    )
                self.relative_relocations[relocation_offset] = {
                    "slotRva": f"0x{relocation_offset:x}",
                    "type": relocation_type,
                    "symbol": symbol,
                    "addendRva": f"0x{addend:x}",
                    "bytesHex": entry.hex(),
                    **identity(entry),
                }

    def file_offset(self, virtual_address: int, size: int = 1) -> int:
        for offset, base, file_size, _memory_size in self.loads:
            relative = virtual_address - base
            if relative >= 0 and relative + size <= file_size:
                return offset + relative
        raise RuntimeError(
            f"candidate virtual range {virtual_address:#x}+{size:#x} "
            "is not file-backed"
        )

    def read(self, virtual_address: int, size: int) -> bytes:
        offset = self.file_offset(virtual_address, size)
        return self.data[offset : offset + size]

    def relative_relocation(self, slot_address: int) -> dict:
        relocation = self.relative_relocations.get(slot_address)
        if relocation is None:
            raise RuntimeError(
                f"candidate ELF has no R_AARCH64_RELATIVE at {slot_address:#x}"
            )
        return relocation


class ScriptIndex:
    def __init__(self, path: Path):
        raw = path.read_bytes()
        parsed = json.loads(raw)
        rows = parsed.get("ScriptMethod")
        if not isinstance(rows, list):
            raise RuntimeError("Il2CppDumper script.json has no ScriptMethod array")
        self.identity = identity(raw)
        self.rows = [row for row in rows if int(row.get("Address", 0)) > 0]
        self.addresses = sorted({int(row["Address"]) for row in self.rows})
        self.by_address: dict[int, list[dict]] = {}
        for row in self.rows:
            self.by_address.setdefault(int(row["Address"]), []).append(row)
        metadata_rows = []
        for key in ("ScriptMetadata", "ScriptMetadataMethod"):
            rows = parsed.get(key)
            if not isinstance(rows, list):
                raise RuntimeError(f"Il2CppDumper script.json has no {key} array")
            metadata_rows.extend(
                row for row in rows
                if isinstance(row, dict) and int(row.get("Address", 0)) > 0
            )
        self.metadata_by_address: dict[int, list[dict]] = {}
        for row in metadata_rows:
            self.metadata_by_address.setdefault(
                int(row["Address"]), []
            ).append(row)

    def unique(self, name: str) -> dict:
        rows = [row for row in self.rows if row.get("Name") == name]
        if len(rows) != 1:
            raise RuntimeError(f"Il2CppDumper locator {name!r} occurs {len(rows)} times")
        return rows[0]

    def unique_at(self, address: int, name: str | None = None) -> dict:
        rows = self.by_address.get(address, [])
        if name is not None:
            rows = [row for row in rows if row.get("Name") == name]
        if len(rows) != 1:
            raise RuntimeError(
                f"Il2CppDumper locator {address:#x}/{name!r} occurs "
                f"{len(rows)} times"
            )
        return rows[0]

    def next_address(self, address: int) -> int:
        return next(item for item in self.addresses if item > address)

    def names_at(self, address: int) -> list[str]:
        return sorted(row["Name"] for row in self.by_address.get(address, []))

    def count(self, name: str) -> int:
        return sum(1 for row in self.rows if row.get("Name") == name)

    def metadata_names_at(self, address: int) -> list[str]:
        return sorted(
            row["Name"]
            for row in self.metadata_by_address.get(address, [])
        )


def method_evidence(elf: Elf64, index: ScriptIndex, name: str) -> tuple[dict, dict]:
    locator = index.unique(name)
    return method_evidence_from_locator(elf, index, locator)


def method_evidence_at(
    elf: Elf64,
    index: ScriptIndex,
    address: int,
    name: str | None = None,
) -> tuple[dict, dict]:
    locator = index.unique_at(address, name)
    return method_evidence_from_locator(elf, index, locator)


def method_evidence_from_locator(
    elf: Elf64,
    index: ScriptIndex,
    locator: dict,
) -> tuple[dict, dict]:
    name = locator["Name"]
    start = int(locator["Address"])
    end = index.next_address(start)
    body = elf.read(start, end - start)
    decoder = Cs(CS_ARCH_ARM64, CS_MODE_ARM)
    instructions = {
        item.address: item for item in decoder.disasm(body, start)
    }
    if not instructions:
        raise RuntimeError(f"{name} decoded no ARM64 instructions")
    calls = []
    for item in instructions.values():
        if item.mnemonic not in {"b", "bl"}:
            continue
        match = re.fullmatch(r"#0x([0-9a-f]+)", item.op_str)
        if not match:
            continue
        target = int(match.group(1), 16)
        target_names = index.names_at(target)
        if target_names:
            calls.append(
                {
                    "address": f"0x{item.address:x}",
                    "kind": item.mnemonic,
                    "target": f"0x{target:x}",
                    "targetNames": target_names,
                }
            )
    return (
        {
            "name": name,
            "signature": locator.get("Signature"),
            "rvaStart": f"0x{start:x}",
            "rvaEndExclusive": f"0x{end:x}",
            **identity(body),
            "directResolvedCalls": calls,
        },
        instructions,
    )


def require_instruction(
    methods: dict[str, dict],
    instructions: dict[str, dict],
    method_key: str,
    relative: int,
    expected: str,
) -> dict:
    start = int(methods[method_key]["rvaStart"], 16)
    address = start + relative
    item = instructions[method_key].get(address)
    actual = instruction_text(item) if item is not None else None
    if actual != expected:
        raise RuntimeError(
            f"{methods[method_key]['name']}+0x{relative:x}: "
            f"expected {expected!r}, got {actual!r}"
        )
    return {
        "address": f"0x{address:x}",
        "relativeOffset": f"0x{relative:x}",
        "text": actual,
        "bytesHex": item.bytes.hex(),
        "sha256": sha256(item.bytes),
    }


def direct_target(instruction) -> int:
    match = re.fullmatch(r"#0x([0-9a-f]+)", instruction.op_str)
    if instruction.mnemonic not in {"b", "bl"} or not match:
        raise RuntimeError(f"instruction has no direct branch target: {instruction_text(instruction)}")
    return int(match.group(1), 16)


def require_call(
    methods: dict[str, dict],
    instructions: dict[str, dict],
    index: ScriptIndex,
    method_key: str,
    relative: int,
    target_name: str,
    kind: str = "bl",
) -> dict:
    start = int(methods[method_key]["rvaStart"], 16)
    address = start + relative
    item = instructions[method_key].get(address)
    if item is None or item.mnemonic != kind:
        raise RuntimeError(
            f"{methods[method_key]['name']}+0x{relative:x} is not {kind}"
        )
    target = direct_target(item)
    names = index.names_at(target)
    if target_name not in names:
        raise RuntimeError(
            f"{methods[method_key]['name']}+0x{relative:x}: "
            f"expected call to {target_name!r}, got {names!r}"
        )
    return {
        "address": f"0x{address:x}",
        "relativeOffset": f"0x{relative:x}",
        "text": instruction_text(item),
        "target": f"0x{target:x}",
        "targetName": target_name,
        "bytesHex": item.bytes.hex(),
        "sha256": sha256(item.bytes),
    }


def require_metadata_relocation(
    methods: dict[str, dict],
    instructions: dict[str, dict],
    elf: Elf64,
    index: ScriptIndex,
    method_key: str,
    adrp_relative: int,
    load_relative: int,
    expected_adrp: str,
    expected_load: str,
    metadata_name: str,
) -> dict:
    adrp = require_instruction(
        methods,
        instructions,
        method_key,
        adrp_relative,
        expected_adrp,
    )
    load = require_instruction(
        methods,
        instructions,
        method_key,
        load_relative,
        expected_load,
    )
    start = int(methods[method_key]["rvaStart"], 16)
    adrp_instruction = instructions[method_key][start + adrp_relative]
    load_instruction = instructions[method_key][start + load_relative]
    slot = referenced_address(adrp_instruction, load_instruction)
    relocation = elf.relative_relocation(slot)
    addend = int(relocation["addendRva"], 16)
    names = index.metadata_names_at(addend)
    if metadata_name not in names:
        raise RuntimeError(
            f"{methods[method_key]['name']} metadata slot {slot:#x}: "
            f"expected {metadata_name!r}, got {names!r}"
        )
    return {
        "method": methods[method_key]["name"],
        "metadataName": metadata_name,
        "metadataNamesAtAddend": names,
        "adrp": adrp,
        "load": load,
        "relocation": relocation,
    }


def immediate(text: str) -> int:
    match = re.search(r"#(-?0x[0-9a-f]+|-?[0-9]+)", text)
    if not match:
        raise RuntimeError(f"instruction has no immediate: {text}")
    return int(match.group(1), 0)


def referenced_address(adrp_instruction, offset_instruction) -> int:
    return immediate(adrp_instruction.op_str) + immediate(offset_instruction.op_str)


def f32(value: float) -> float:
    return struct.unpack("<f", struct.pack("<f", value))[0]


def round_to_even_f32(pixel_height: int, vertical: float, quality: float) -> dict:
    height = f32(float(pixel_height))
    quotient = f32(height / vertical)
    scaled = f32(quotient * f32(quality))
    side = int(round(float(scaled)))
    return {
        "pixelHeightF32": height,
        "verticalPercentageF32": vertical,
        "qualityF32": f32(quality),
        "quotientF32": quotient,
        "scaledF32": scaled,
        "rounding": "roundToEven",
        "width": side,
        "height": side,
    }


def extract_bloom_temporary_rt_contract(
    evidence: dict,
    instructions: dict,
    script: ScriptIndex,
    metadata_enums: dict,
) -> dict:
    methods = {"bloom": evidence}
    decoded = {"bloom": instructions}
    constructor_name = "UnityEngine.RenderTextureDescriptor$$.ctor"
    allocate_name = "UnityEngine.Rendering.CommandBuffer$$GetTemporaryRT"
    release_name = "UnityEngine.Rendering.CommandBuffer$$ReleaseTemporaryRT"
    checks = [
        require_instruction(
            methods,
            decoded,
            "bloom",
            0x2A4,
            "lsl w1, w25, #1",
        ),
        require_instruction(
            methods,
            decoded,
            "bloom",
            0x2A8,
            "lsl w2, w20, #1",
        ),
        require_instruction(
            methods,
            decoded,
            "bloom",
            0x2B0,
            "mov w3, wzr",
        ),
        require_call(
            methods,
            decoded,
            script,
            "bloom",
            0x2BC,
            constructor_name,
        ),
    ]
    allocation_offsets = [0x314, 0x464, 0x5C8, 0x608, 0xB04]
    filter_offsets = [0x2F0, 0x444, 0x5A0, 0x5E0, 0xAC8]
    if TEST_MUTATION == "bloom-filter":
        filter_offsets[0] += 4
    for filter_offset, allocation_offset in zip(
        filter_offsets,
        allocation_offsets,
        strict=True,
    ):
        checks.append(
            require_instruction(
                methods,
                decoded,
                "bloom",
                filter_offset,
                "mov w3, #1",
            )
        )
        checks.append(
            require_call(
                methods,
                decoded,
                script,
                "bloom",
                allocation_offset,
                allocate_name,
            )
        )
    release_offsets = [0x89C, 0xDCC, 0xDE4, 0xDFC, 0xE14]
    for release_offset in release_offsets:
        checks.append(
            require_call(
                methods,
                decoded,
                script,
                "bloom",
                release_offset,
                release_name,
            )
        )
    direct_names = [
        name
        for row in evidence["directResolvedCalls"]
        for name in row["targetNames"]
    ]
    if direct_names.count(allocate_name) != len(allocation_offsets):
        raise RuntimeError("candidate Bloom GetTemporaryRT denominator changed")
    if direct_names.count(release_name) != len(release_offsets):
        raise RuntimeError("candidate Bloom ReleaseTemporaryRT denominator changed")
    filter_mode = metadata_enums["filterMode"]
    if filter_mode["byValue"].get("1") != "Bilinear":
        raise RuntimeError("candidate FilterMode 1 is not Bilinear")
    render_texture_format = metadata_enums["renderTextureFormat"]
    if render_texture_format["byValue"].get("0") != "ARGB32":
        raise RuntimeError("candidate RenderTextureFormat 0 is not ARGB32")
    return {
        "status": "partial-exact-candidate-command-buffer-topology",
        "method": {
            "name": evidence["name"],
            "rvaStart": evidence["rvaStart"],
            "rvaEndExclusive": evidence["rvaEndExclusive"],
            "byteLength": evidence["byteLength"],
            "sha256": evidence["sha256"],
        },
        "baseDescriptor": {
            "constructor":
                "RenderTextureDescriptor(width * 2, height * 2, ARGB32)",
            "widthOperation": "bufferWidth << 1",
            "heightOperation": "bufferHeight << 1",
            "renderTextureFormatValue": 0,
            "renderTextureFormat": "ARGB32",
            "liveBufferSize": "runtime-required",
        },
        "allocations": {
            "staticCallSiteCount": len(allocation_offsets),
            "callSiteOffsets": [
                f"0x{offset:x}" for offset in allocation_offsets
            ],
            "filterModeValue": 1,
            "filterMode": "Bilinear",
            "descriptorCopyAndDimensionOverrides":
                "exact candidate instruction topology",
            "liveDescriptorValues": "runtime-required",
        },
        "releases": {
            "staticCallSiteCount": len(release_offsets),
            "callSiteOffsets": [
                f"0x{offset:x}" for offset in release_offsets
            ],
            "pairing":
                "four static property IDs plus the downsampling-array loop",
            "livePropertyIds": "runtime-required",
        },
        "selectedInstructionChecks": checks,
        "remaining":
            "live BloomVolume size/count, complete descriptor field values, "
            "Unity allocation and guest attachment/submission",
    }


def object_record(obj, raw: bytes) -> dict:
    return {
        "pathId": str(obj.path_id),
        "type": obj.type.name,
        "byteStart": int(obj.byte_start),
        **identity(raw),
    }


def field_record(raw: bytes, offset: int, size: int, value) -> dict:
    field = raw[offset : offset + size]
    if len(field) != size:
        raise RuntimeError(f"serialized field at 0x{offset:x} is truncated")
    return {
        "objectOffset": offset,
        "value": value,
        "rawHex": field.hex(),
        **identity(field),
    }


def trace_root_typetree(obj) -> tuple[dict, dict[str, dict], int]:
    node = obj._get_typetree_node()
    obj.reset()
    reader = obj.reader
    start = int(reader.Position)
    config = TypeTreeConfig(True, obj.assets_file, False)
    values = {}
    fields = {}
    for child in node.m_Children:
        field_start = int(reader.Position) - start
        value = read_value(child, reader, config)
        field_end = int(reader.Position) - start
        values[child.m_Name] = value
        fields[child.m_Name] = {
            "type": child.m_Type,
            "objectOffset": field_start,
            "serializedSpanByteLength": field_end - field_start,
        }
    return values, fields, int(reader.Position) - start


def extract_global_settings(
    globalgamemanagers: bytes,
    player_transfer_contract: dict,
) -> dict:
    environment = UnityPy.load(globalgamemanagers)
    objects = {obj.type.name: obj for obj in environment.objects}
    required = {"PlayerSettings", "BuildSettings", "GraphicsSettings", "QualitySettings"}
    missing = required - set(objects)
    if missing:
        raise RuntimeError(
            "candidate globalgamemanagers is missing " + ", ".join(sorted(missing))
        )

    build_obj = objects["BuildSettings"]
    build_raw = bytes(build_obj.get_raw_data())
    build_tree = build_obj.read_typetree()
    graphics_apis = [int(value) for value in build_tree["m_GraphicsAPIs"]]
    needle = struct.pack("<I", len(graphics_apis)) + b"".join(
        struct.pack("<I", value) for value in graphics_apis
    )
    offsets = [
        offset for offset in range(len(build_raw))
        if build_raw.startswith(needle, offset)
    ]
    if len(offsets) != 1:
        raise RuntimeError(
            f"candidate m_GraphicsAPIs sequence occurs {len(offsets)} times"
        )
    graphics_offset = offsets[0]

    player_obj = objects["PlayerSettings"]
    player_raw = bytes(player_obj.get_raw_data())
    strict_error = None
    try:
        player_obj.read_typetree()
        strict_read_bytes = len(player_raw)
    except ValueError as error:
        strict_error = str(error)
        match = re.search(
            r"Expected to read (\d+) bytes, but only read (\d+) bytes",
            strict_error,
        )
        if not match:
            raise
        expected, strict_read_bytes = map(int, match.groups())
        if expected != len(player_raw):
            raise RuntimeError("PlayerSettings strict parser byte count changed")
    player_tree, player_fields, traced_read_bytes = trace_root_typetree(
        player_obj
    )
    if traced_read_bytes != strict_read_bytes:
        raise RuntimeError(
            "PlayerSettings traced parser byte count differs from strict "
            "UnityPy diagnostic"
        )
    suffix = player_raw[strict_read_bytes:]
    expected_suffix = (
        b"\x01\x00\x00\x00"
        if TEST_MUTATION == "player-settings-unread-suffix"
        else b"\0\0\0\0"
    )
    if suffix != expected_suffix:
        raise RuntimeError(
            "candidate PlayerSettings official-transfer unread suffix "
            f"expected {expected_suffix.hex()}, got {suffix.hex()}"
        )
    exact_player_fields = {}
    for name, size in (
        ("m_ActiveColorSpace", 4),
        ("preserveFramebufferAlpha", 1),
        ("disableDepthAndStencilBuffers", 1),
        ("vulkanEnableSetSRGBWrite", 1),
        ("vulkanEnablePreTransform", 1),
    ):
        traced = player_fields[name]
        value = player_tree[name]
        decoded = int.from_bytes(
            player_raw[
                traced["objectOffset"] : traced["objectOffset"] + size
            ],
            "little",
        )
        normalized = int(value)
        if decoded != normalized:
            raise RuntimeError(
                f"candidate PlayerSettings {name} typetree/raw mismatch: "
                f"{normalized} != {decoded}"
            )
        exact_player_fields[name] = {
            **traced,
            "value": normalized,
            "valueBytes": field_record(
                player_raw,
                traced["objectOffset"],
                size,
                normalized,
            ),
            "officialTransferXrefRvas":
                player_transfer_contract["parsedFieldTransferXrefs"][name],
            "status": "exact-candidate-serialized-field",
        }

    graphics_obj = objects["GraphicsSettings"]
    graphics_raw = bytes(graphics_obj.get_raw_data())
    graphics_tree = graphics_obj.read_typetree()

    quality_obj = objects["QualitySettings"]
    quality_raw = bytes(quality_obj.get_raw_data())
    quality_tree = quality_obj.read_typetree()
    quality_profiles = quality_tree["m_QualitySettings"]
    current_quality = int(quality_tree["m_CurrentQuality"])

    return {
        "unityVersion": str(build_tree.get("m_Version")),
        "buildSettings": {
            "object": object_record(build_obj, build_raw),
            "graphicsApis": {
                "values": graphics_apis,
                "array": field_record(
                    build_raw,
                    graphics_offset,
                    len(needle),
                    graphics_apis,
                ),
            },
        },
        "playerSettings": {
            "object": object_record(player_obj, player_raw),
            "parser": {
                "status":
                    "official-transfer-exact-with-unread-object-suffix",
                "unityPyStrictStatus": (
                    "strict-exact" if strict_error is None
                    else "byte-size-mismatch"
                ),
                "officialTransferFieldBytes": strict_read_bytes,
                "objectByteLength": len(player_raw),
                "unreadSuffix": {
                    "objectOffset": strict_read_bytes,
                    "rawHex": suffix.hex(),
                    **identity(suffix),
                    "semantics":
                        player_transfer_contract["unreadSuffixSemantics"],
                },
                "strictError": strict_error,
            },
            "fields": exact_player_fields,
            "officialTransferContract": player_transfer_contract,
            "claimStatus":
                "exact-relevant-fields-and-official-transfer-boundary",
        },
        "graphicsSettings": {
            "object": object_record(graphics_obj, graphics_raw),
            "customRenderPipeline": graphics_tree["m_CustomRenderPipeline"],
            "lightsUseLinearIntensity": bool(
                graphics_tree["m_LightsUseLinearIntensity"]
            ),
        },
        "qualitySettings": {
            "object": object_record(quality_obj, quality_raw),
            "currentQualityIndex": current_quality,
            "currentQualityName": quality_profiles[current_quality]["name"],
            "profiles": [
                {
                    "index": index,
                    "name": profile["name"],
                    "antiAliasing": int(profile["antiAliasing"]),
                    "resolutionScalingFixedDPIFactor": float(
                        profile["resolutionScalingFixedDPIFactor"]
                    ),
                }
                for index, profile in enumerate(quality_profiles)
            ],
            "boundary":
                "Unity QualitySettings is not the game CardQuality producer",
        },
    }


def extract_detail_view(bundle_path: Path) -> dict:
    UnityPy.config.FALLBACK_UNITY_VERSION = EXPECTED_UNITY_VERSION
    warnings.filterwarnings("ignore", category=Warning, module=r"UnityPy\..*")
    bundle = bundle_path.read_bytes()
    environment = UnityPy.load(bundle)
    matches = [obj for obj in environment.objects if int(obj.path_id) == DETAIL_PATH_ID]
    if len(matches) != 1:
        raise RuntimeError(
            f"candidate detail UICardView PathID resolved {len(matches)} objects"
        )
    obj = matches[0]
    tree = obj.read_typetree(check_read=False)
    raw = bytes(obj.get_raw_data())
    expected_fields = {
        "_cardSize": (0x60, 4, int(tree["_cardSize"])),
        "_useGyro": (0x64, 1, int(tree["_useGyro"])),
        "_useMipMap": (0x6D, 1, int(tree["_useMipMap"])),
    }
    fields = {
        name: field_record(raw, offset, size, value)
        for name, (offset, size, value) in expected_fields.items()
    }
    for name, record in fields.items():
        decoded = int.from_bytes(bytes.fromhex(record["rawHex"]), "little")
        if decoded != record["value"]:
            raise RuntimeError(
                f"candidate {name} typetree/raw mismatch: "
                f"{record['value']} != {decoded}"
            )
    return {
        "logicalPath": DETAIL_BUNDLE.as_posix(),
        "bundle": identity(bundle),
        "serializedFile": str(obj.assets_file.name),
        "unityVersionFallback": EXPECTED_UNITY_VERSION,
        "object": object_record(obj, raw),
        "fields": fields,
    }


def extract_metadata_enums(dump_cs_path: Path) -> dict:
    raw = dump_cs_path.read_bytes()
    text = raw.decode("utf-8")
    selections = {
        "graphicsFormat": (
            "UnityEngine.Experimental.Rendering",
            "GraphicsFormat",
        ),
        "renderTextureFormat": (
            "UnityEngine",
            "RenderTextureFormat",
        ),
        "renderTextureReadWrite": (
            "UnityEngine",
            "RenderTextureReadWrite",
        ),
        "textureColorSpace": (
            "UnityEngine",
            "TextureColorSpace",
        ),
        "colorSpace": (
            "UnityEngine",
            "ColorSpace",
        ),
        "renderTextureCreationFlags": (
            "UnityEngine",
            "RenderTextureCreationFlags",
        ),
        "renderTextureMemoryless": (
            "UnityEngine",
            "RenderTextureMemoryless",
        ),
        "vrTextureUsage": (
            "UnityEngine",
            "VRTextureUsage",
        ),
        "textureDimension": (
            "UnityEngine.Rendering",
            "TextureDimension",
        ),
        "shadowSamplingMode": (
            "UnityEngine.Rendering",
            "ShadowSamplingMode",
        ),
        "filterMode": (
            "UnityEngine",
            "FilterMode",
        ),
        "depthBits": (
            "UnityEngine.Rendering",
            "DepthBits",
        ),
        "accessFlags": (
            "UnityEngine.Rendering.RenderGraphModule",
            "AccessFlags",
        ),
        "cardSizeType": (
            "Lettuce.Infrastructure.Asset3D.Core.Data",
            "CardSizeType",
        ),
        "uiCardViewSizeType": (
            "Lettuce.Infrastructure.Card.Core.Data",
            "UICardViewSizeType",
        ),
    }
    result = {}
    for key, (namespace, enum_name) in selections.items():
        pattern = re.compile(
            rf"// Namespace: {re.escape(namespace)}\s+"
            rf"(?:\[[^\n]+\]\s+)*"
            rf"(?:public|internal) enum {re.escape(enum_name)}\b.*?^}}",
            re.MULTILINE | re.DOTALL,
        )
        matches = pattern.findall(text)
        if len(matches) != 1:
            raise RuntimeError(
                f"candidate metadata enum {namespace}.{enum_name} "
                f"occurs {len(matches)} times"
            )
        block = matches[0]
        values = {
            name: int(value)
            for name, value in re.findall(
                rf"public const {re.escape(enum_name)} "
                r"([A-Za-z0-9_]+) = (-?\d+);",
                block,
            )
        }
        if not values:
            raise RuntimeError(
                f"candidate metadata enum {namespace}.{enum_name} has no values"
            )
        result[key] = {
            "namespace": namespace,
            "name": enum_name,
            "values": values,
            "byValue": {str(value): name for name, value in values.items()},
            "definitionSha256": sha256(block.encode("utf-8")),
        }
    if result["renderTextureFormat"]["values"].get("ARGB32") != 0:
        raise RuntimeError("candidate RenderTextureFormat.ARGB32 is not zero")
    if result["renderTextureReadWrite"]["values"].get("Default") != 0:
        raise RuntimeError(
            "candidate RenderTextureReadWrite.Default is not zero"
        )
    if result["textureColorSpace"]["values"] != {
        "Linear": 0,
        "sRGB": 1,
    }:
        raise RuntimeError("candidate TextureColorSpace values changed")
    if result["colorSpace"]["values"].get("Gamma") != 0:
        raise RuntimeError("candidate ColorSpace.Gamma is not zero")
    if result["colorSpace"]["values"].get("Linear") != 1:
        raise RuntimeError("candidate ColorSpace.Linear is not one")
    if result["graphicsFormat"]["values"].get("R8G8B8A8_UNorm") != 8:
        raise RuntimeError(
            "candidate GraphicsFormat.R8G8B8A8_UNorm is not eight"
        )
    if result["graphicsFormat"]["values"].get("R8G8B8A8_SRGB") != 4:
        raise RuntimeError(
            "candidate GraphicsFormat.R8G8B8A8_SRGB is not four"
        )
    if result["renderTextureCreationFlags"]["values"].get(
        "AutoGenerateMips"
    ) != 2:
        raise RuntimeError(
            "candidate RenderTextureCreationFlags.AutoGenerateMips changed"
        )
    if result["renderTextureCreationFlags"]["values"].get(
        "AllowVerticalFlip"
    ) != 128:
        raise RuntimeError(
            "candidate RenderTextureCreationFlags.AllowVerticalFlip changed"
        )
    if result["renderTextureMemoryless"]["values"].get("None") != 0:
        raise RuntimeError("candidate RenderTextureMemoryless.None changed")
    if result["textureDimension"]["values"].get("Tex2D") != 2:
        raise RuntimeError("candidate TextureDimension.Tex2D changed")
    if result["shadowSamplingMode"]["values"].get("None") != 2:
        raise RuntimeError("candidate ShadowSamplingMode.None changed")
    if result["vrTextureUsage"]["values"].get("None") != 0:
        raise RuntimeError("candidate VRTextureUsage.None changed")
    if result["depthBits"]["values"].get("None") != 0:
        raise RuntimeError("candidate DepthBits.None is not zero")
    if result["accessFlags"]["values"].get("Write") != 2:
        raise RuntimeError("candidate AccessFlags.Write is not two")
    if result["cardSizeType"]["values"].get("Medium") != 2:
        raise RuntimeError("candidate CardSizeType.Medium is not two")
    if result["cardSizeType"]["values"].get("Large") != 3:
        raise RuntimeError("candidate CardSizeType.Large is not three")
    if (
        result["uiCardViewSizeType"]["values"].get(
            "MediumToLargeProgressiveManual"
        )
        != 6
    ):
        raise RuntimeError("candidate detail UICardView size enum six changed")

    layout_specs = {
        "textureDesc": {
            "namespace": "UnityEngine.Rendering.RenderGraphModule",
            "declaration": "public struct TextureDesc",
            "fields": {
                "width": 0x04,
                "height": 0x08,
                "format": 0x20,
                "enableRandomWrite": 0x30,
                "name": 0x50,
                "clearBuffer": 0x66,
            },
        },
        "customBloomData": {
            "namespace": "Lettuce.Graphics.PostProcessing.Bloom",
            "declaration": "public class CustomBloomData",
            "fields": {
                "EmissiveColorDesc": 0x10,
                "EmissiveBaseTexture": 0x90,
                "Size": 0xD8,
            },
        },
        "customDrawPassData": {
            "namespace": "",
            "declaration": "internal class CustomDrawObjectsPass.PassData",
            "fields": {
                "albedoHdl": 0x10,
                "EmissiveHandle": 0x68,
            },
        },
        "emissiveSourceData": {
            "namespace": "Lettuce.Graphics.Rendering",
            "declaration": "public class EmissiveSourceData",
            "fields": {
                "EmissiveSourceTexture": 0x10,
            },
        },
    }
    layouts = {}
    for key, spec in layout_specs.items():
        pattern = re.compile(
            rf"// Namespace:[ \t]*{re.escape(spec['namespace'])}[ \t]*\r?\n"
            rf"{re.escape(spec['declaration'])}\b.*?^}}",
            re.MULTILINE | re.DOTALL,
        )
        matches = pattern.findall(text)
        if len(matches) != 1:
            raise RuntimeError(
                f"candidate metadata layout {spec['declaration']} "
                f"occurs {len(matches)} times"
            )
        block = matches[0]
        fields = {}
        for field_name, expected_offset in spec["fields"].items():
            field_pattern = re.compile(
                rf"^[ \t]*(?:public|internal|private).*?\b"
                rf"{re.escape(field_name)}\s*;\s*// 0x([0-9A-Fa-f]+)\s*$",
                re.MULTILINE,
            )
            field_matches = field_pattern.findall(block)
            if len(field_matches) != 1:
                raise RuntimeError(
                    f"candidate metadata field {spec['declaration']}."
                    f"{field_name} occurs {len(field_matches)} times"
                )
            actual_offset = int(field_matches[0], 16)
            if actual_offset != expected_offset:
                raise RuntimeError(
                    f"candidate metadata field {spec['declaration']}."
                    f"{field_name} moved from 0x{expected_offset:x} "
                    f"to 0x{actual_offset:x}"
                )
            fields[field_name] = actual_offset
        layouts[key] = {
            "namespace": spec["namespace"],
            "declaration": spec["declaration"],
            "fields": fields,
            "definitionSha256": sha256(block.encode("utf-8")),
        }

    interface_pattern = re.compile(
        r"// Namespace:[ \t]*"
        r"UnityEngine\.Rendering\.RenderGraphModule[ \t]*\r?\n"
        r"(?:\[[^\n]+\]\r?\n)*"
        r"public interface IRasterRenderGraphBuilder\b.*?^}",
        re.MULTILINE | re.DOTALL,
    )
    interface_matches = interface_pattern.findall(text)
    if len(interface_matches) != 1:
        raise RuntimeError(
            "candidate IRasterRenderGraphBuilder definition occurs "
            f"{len(interface_matches)} times"
        )
    interface_block = interface_matches[0]
    required_interface_fragments = [
        "public virtual void SetRenderAttachment(TextureHandle tex, "
        "int index, AccessFlags flags = 2) { }",
        "public abstract void SetRenderAttachment(TextureHandle tex, "
        "int index, AccessFlags flags, int mipLevel, int depthSlice);",
    ]
    for fragment in required_interface_fragments:
        if fragment not in interface_block:
            raise RuntimeError(
                "candidate IRasterRenderGraphBuilder contract changed: "
                f"{fragment}"
            )
    layouts["rasterRenderGraphBuilder"] = {
        "namespace": "UnityEngine.Rendering.RenderGraphModule",
        "declaration": "public interface IRasterRenderGraphBuilder",
        "setRenderAttachmentDefaultAccessFlags": 2,
        "setRenderAttachmentSlot": 0,
        "definitionSha256": sha256(interface_block.encode("utf-8")),
    }
    return {
        "locator": identity(raw),
        "enums": result,
        "layouts": layouts,
    }


def extract_rendergraph_scene_mrt_contract(
    elf: Elf64,
    script: ScriptIndex,
    metadata: dict,
    main_evidence: dict,
    main_instructions: dict,
) -> dict:
    names = {
        "prepareBloom":
            "Lettuce.Graphics.PostProcessing.Bloom.PrepareBloomPass"
            "$$RecordRenderGraph",
        "getBufferSize":
            "Lettuce.Graphics.PostProcessing.Bloom.SheetBloomRendererFeature"
            "$$GetBufferSize",
        "customMain":
            "Lettuce.Graphics.Rendering.CustomRendererRenderGraph"
            "$$OnCustomMainRendering",
        "customDraw":
            "Lettuce.Graphics.Rendering.CustomDrawObjectsPass$$Render",
    }
    methods = {"customMain": main_evidence}
    decoded = {"customMain": main_instructions}
    for key in ("prepareBloom", "getBufferSize", "customDraw"):
        methods[key], decoded[key] = method_evidence(elf, script, names[key])

    emissive_source_metadata = (
        "Method$UnityEngine.Rendering.ContextContainer.Get"
        "<CustomBloomData>()"
        if TEST_MUTATION == "rendergraph-mrt-metadata"
        else
        "Method$UnityEngine.Rendering.ContextContainer.Get"
        "<EmissiveSourceData>()"
    )
    metadata_relocation_checks = [
        require_metadata_relocation(
            methods,
            decoded,
            elf,
            script,
            "prepareBloom",
            0x150,
            0x15C,
            "adrp x8, #0x72dc000",
            "ldr x8, [x8, #0x400]",
            "Method$UnityEngine.Rendering.ContextContainer.Get"
            "<UniversalResourceData>()",
        ),
        require_metadata_relocation(
            methods,
            decoded,
            elf,
            script,
            "prepareBloom",
            0x154,
            0x160,
            "adrp x22, #0x72dc000",
            "ldr x22, [x22, #0x590]",
            emissive_source_metadata,
        ),
        require_metadata_relocation(
            methods,
            decoded,
            elf,
            script,
            "prepareBloom",
            0x24C,
            0x258,
            "adrp x28, #0x72dc000",
            "ldr x28, [x28, #0x588]",
            "Method$UnityEngine.Rendering.ContextContainer.GetOrCreate"
            "<CustomBloomData>()",
        ),
        require_metadata_relocation(
            methods,
            decoded,
            elf,
            script,
            "customDraw",
            0x174,
            0x190,
            "adrp x9, #0x72dc000",
            "ldr x9, [x9, #0x760]",
            "Method$UnityEngine.Rendering.RenderGraphModule.RenderGraph."
            "AddRasterRenderPass<CustomDrawObjectsPass.PassData>()",
        ),
        require_metadata_relocation(
            methods,
            decoded,
            elf,
            script,
            "customDraw",
            0x300,
            0x308,
            "adrp x10, #0x72dc000",
            "ldr x10, [x10, #0x418]",
            "UnityEngine.Rendering.RenderGraphModule."
            "IRasterRenderGraphBuilder_TypeInfo",
        ),
        require_metadata_relocation(
            methods,
            decoded,
            elf,
            script,
            "customDraw",
            0x418,
            0x420,
            "adrp x10, #0x72dc000",
            "ldr x10, [x10, #0x418]",
            "UnityEngine.Rendering.RenderGraphModule."
            "IRasterRenderGraphBuilder_TypeInfo",
        ),
    ]

    descriptor_checks = [
        require_instruction(
            methods, decoded, "prepareBloom", 0x184,
            "ldp x1, x2, [x0, #0x10]",
        ),
        require_call(
            methods, decoded, script, "prepareBloom", 0x1A0,
            "UnityEngine.Rendering.RenderGraphModule.RenderGraph$$GetTextureDesc",
        ),
        require_call(
            methods, decoded, script, "prepareBloom", 0x1E0,
            "UnityEngine.Rendering.Universal.UniversalResourceData"
            "$$get_activeColorTexture",
        ),
        require_call(
            methods, decoded, script, "prepareBloom", 0x200,
            "UnityEngine.Rendering.RenderGraphModule.RenderGraph$$GetTextureDesc",
        ),
        require_call(
            methods, decoded, script, "prepareBloom", 0x25C,
            "Lettuce.Graphics.PostProcessing.Bloom.BloomVolume$$get_BufferSize",
        ),
        require_instruction(
            methods, decoded, "prepareBloom", 0x280,
            "mov w27, #8",
        ),
        require_instruction(
            methods, decoded, "prepareBloom", 0x294,
            "str w27, [sp, #0x30]",
        ),
        require_instruction(
            methods, decoded, "prepareBloom", 0x298,
            "strb wzr, [sp, #0x40]",
        ),
        require_call(
            methods, decoded, script, "prepareBloom", 0x2BC,
            names["getBufferSize"],
        ),
        require_instruction(
            methods, decoded, "prepareBloom", 0x2D8,
            "str w27, [sp, #0x140]",
        ),
        require_instruction(
            methods, decoded, "prepareBloom", 0x2DC,
            "strb wzr, [sp, #0x150]",
        ),
        require_instruction(
            methods, decoded, "prepareBloom", 0x2F8,
            "lsr x9, x25, #0x1f",
        ),
        require_instruction(
            methods, decoded, "prepareBloom", 0x2FC,
            "lsl w8, w25, #1",
        ),
        require_instruction(
            methods, decoded, "prepareBloom", 0x300,
            "and w9, w9, #0xfffffffe",
        ),
        require_instruction(
            methods, decoded, "prepareBloom", 0x30C,
            "str w8, [sp, #0x124]",
        ),
        require_instruction(
            methods, decoded, "prepareBloom", 0x310,
            "str w9, [sp, #0x128]",
        ),
        require_instruction(
            methods, decoded, "prepareBloom", 0x320,
            "mov w1, wzr",
        ),
        require_call(
            methods, decoded, script, "prepareBloom", 0x328,
            "UnityEngine.Rendering.RenderGraphModule.TextureDesc"
            "$$set_depthBufferBits",
        ),
        require_instruction(
            methods, decoded, "prepareBloom", 0x338,
            "strb wzr, [sp, #0x186]",
        ),
        require_call(
            methods, decoded, script, "prepareBloom", 0x33C,
            "UnityEngine.Rendering.RenderGraphModule.RenderGraph$$CreateTexture",
        ),
        require_instruction(
            methods, decoded, "prepareBloom", 0x374,
            "str x25, [x0, #0xd8]",
        ),
        require_instruction(
            methods, decoded, "prepareBloom", 0x384,
            "stp q0, q1, [x0, #0x10]",
        ),
        require_instruction(
            methods, decoded, "prepareBloom", 0x38C,
            "str w27, [x0, #0x30]",
        ),
        require_instruction(
            methods, decoded, "prepareBloom", 0x394,
            "strb wzr, [x21, #0x40]",
        ),
        require_instruction(
            methods, decoded, "prepareBloom", 0x3CC,
            "stp x23, x24, [x21, #0x90]",
        ),
        require_instruction(
            methods, decoded, "getBufferSize", 0x000,
            "ldp w8, w9, [x0, #4]",
        ),
        require_instruction(
            methods, decoded, "getBufferSize", 0x0A0,
            "lsl x8, x8, #0x20",
        ),
        require_instruction(
            methods, decoded, "getBufferSize", 0x0A8,
            "orr x0, x8, x9",
        ),
    ]

    renderer_wiring_checks = [
        require_call(
            methods, decoded, script, "customMain", 0x5C8,
            "UnityEngine.Rendering.Universal.UniversalResourceData"
            "$$get_activeColorTexture",
        ),
        require_instruction(
            methods, decoded, "customMain", 0x5D4,
            "ldp x25, x22, [x8, #0x10]",
        ),
        require_instruction(
            methods, decoded, "customMain", 0x61C,
            "mov x3, x29",
        ),
        require_instruction(
            methods, decoded, "customMain", 0x620,
            "mov x4, x23",
        ),
        require_instruction(
            methods, decoded, "customMain", 0x624,
            "mov x5, x25",
        ),
        require_instruction(
            methods, decoded, "customMain", 0x628,
            "mov x6, x22",
        ),
        require_call(
            methods, decoded, script, "customMain", 0x638,
            names["customDraw"],
        ),
        require_call(
            methods, decoded, script, "customMain", 0x8C8,
            "UnityEngine.Rendering.Universal.UniversalResourceData"
            "$$get_activeColorTexture",
        ),
        require_instruction(
            methods, decoded, "customMain", 0x8E4,
            "ldp x29, x24, [x8, #0x10]",
        ),
        require_instruction(
            methods, decoded, "customMain", 0x924,
            "mov x3, x27",
        ),
        require_instruction(
            methods, decoded, "customMain", 0x928,
            "mov x4, x28",
        ),
        require_instruction(
            methods, decoded, "customMain", 0x92C,
            "mov x5, x29",
        ),
        require_instruction(
            methods, decoded, "customMain", 0x930,
            "mov x6, x24",
        ),
        require_call(
            methods, decoded, script, "customMain", 0x93C,
            names["customDraw"],
        ),
    ]

    emissive_slot = 2 if TEST_MUTATION == "rendergraph-mrt-slot" else 1
    attachment_checks = [
        require_instruction(
            methods, decoded, "customDraw", 0x020,
            "mov x24, x6",
        ),
        require_instruction(
            methods, decoded, "customDraw", 0x024,
            "mov x25, x5",
        ),
        require_instruction(
            methods, decoded, "customDraw", 0x028,
            "mov x26, x4",
        ),
        require_instruction(
            methods, decoded, "customDraw", 0x02C,
            "mov x27, x3",
        ),
        require_instruction(
            methods, decoded, "customDraw", 0x2F8,
            "stp x27, x26, [x8, #0x10]",
        ),
        require_instruction(
            methods, decoded, "customDraw", 0x350,
            "add x0, x8, #0x138",
        ),
        require_instruction(
            methods, decoded, "customDraw", 0x354,
            "ldp x8, x5, [x0]",
        ),
        require_instruction(
            methods, decoded, "customDraw", 0x358,
            "mov x0, x28",
        ),
        require_instruction(
            methods, decoded, "customDraw", 0x35C,
            "mov x1, x27",
        ),
        require_instruction(
            methods, decoded, "customDraw", 0x360,
            "mov x2, x26",
        ),
        require_instruction(
            methods, decoded, "customDraw", 0x364,
            "mov w3, wzr",
        ),
        require_instruction(
            methods, decoded, "customDraw", 0x368,
            "mov w4, #2",
        ),
        require_instruction(
            methods, decoded, "customDraw", 0x36C,
            "blr x8",
        ),
        require_instruction(
            methods, decoded, "customDraw", 0x410,
            "stp x25, x24, [x8, #0x68]",
        ),
        require_instruction(
            methods, decoded, "customDraw", 0x468,
            "add x0, x8, #0x138",
        ),
        require_instruction(
            methods, decoded, "customDraw", 0x46C,
            "ldp x8, x5, [x0]",
        ),
        require_instruction(
            methods, decoded, "customDraw", 0x470,
            "mov x0, x26",
        ),
        require_instruction(
            methods, decoded, "customDraw", 0x474,
            "mov x1, x25",
        ),
        require_instruction(
            methods, decoded, "customDraw", 0x478,
            "mov x2, x24",
        ),
        require_instruction(
            methods, decoded, "customDraw", 0x47C,
            f"mov w3, #{emissive_slot}",
        ),
        require_instruction(
            methods, decoded, "customDraw", 0x480,
            "mov w4, #2",
        ),
        require_instruction(
            methods, decoded, "customDraw", 0x484,
            "blr x8",
        ),
    ]

    enums = metadata["enums"]
    layouts = metadata["layouts"]
    if enums["graphicsFormat"]["byValue"].get("8") != "R8G8B8A8_UNorm":
        raise RuntimeError("candidate scene MRT format enum changed")
    if enums["depthBits"]["byValue"].get("0") != "None":
        raise RuntimeError("candidate scene MRT depth enum changed")
    if enums["accessFlags"]["byValue"].get("2") != "Write":
        raise RuntimeError("candidate scene MRT access enum changed")
    return {
        "status": "partial-exact-candidate-rendergraph-scene-mrt-topology",
        "methodCount": len(methods),
        "methods": methods,
        "metadataLayouts": {
            key: layouts[key]
            for key in (
                "textureDesc",
                "customBloomData",
                "customDrawPassData",
                "emissiveSourceData",
                "rasterRenderGraphBuilder",
            )
        },
        "descriptor": {
            "source":
                "EmissiveSourceData.EmissiveSourceTexture TextureDesc clone",
            "sourceHandleFieldOffset": 0x10,
            "graphicsFormatValue": 8,
            "graphicsFormat": "R8G8B8A8_UNorm",
            "widthOperation":
                "SheetBloomRendererFeature.GetBufferSize(...).x << 1",
            "heightOperation":
                "SheetBloomRendererFeature.GetBufferSize(...).y << 1",
            "depthBitsValue": 0,
            "depthBits": "None",
            "enableRandomWrite": False,
            "clearBuffer": False,
            "inheritedOrLiveFields": "runtime-required",
            "liveBloomVolumeBufferSize": "runtime-required",
        },
        "createdTexture": {
            "producer":
                "RenderGraph.CreateTexture(TextureDesc)",
            "contextDescriptorField":
                "CustomBloomData.EmissiveColorDesc@0x10",
            "contextTextureField":
                "CustomBloomData.EmissiveBaseTexture@0x90",
            "contextSizeField":
                "CustomBloomData.Size@0xd8",
            "candidateUnityNativeAllocation": "runtime-required",
        },
        "attachments": {
            "opaqueAndTransparentCalls": 2,
            "color": {
                "source":
                    "UniversalResourceData.activeColorTexture",
                "passDataField": "albedoHdl@0x10",
                "attachmentIndex": 0,
                "accessFlagsValue": 2,
                "accessFlags": "Write",
            },
            "emissive": {
                "source":
                    "EmissiveSourceData.EmissiveSourceTexture",
                "passDataField": "EmissiveHandle@0x68",
                "attachmentIndex": 1,
                "accessFlagsValue": 2,
                "accessFlags": "Write",
            },
            "builderMethod":
                "IRasterRenderGraphBuilder.SetRenderAttachment",
            "guestAttachmentSubmission": "runtime-required",
        },
        "selectedInstructionChecks": {
            "metadataRelocations": metadata_relocation_checks,
            "descriptor": descriptor_checks,
            "rendererWiring": renderer_wiring_checks,
            "attachments": attachment_checks,
        },
        "remaining":
            "live source TextureDesc fields and BloomVolume state, Unity native "
            "allocation/aliasing, guest VkImage/view attachments, image layouts "
            "and command submission",
    }


def extract_managed_rendertexture_constructor_chain(
    elf: Elf64,
    script: ScriptIndex,
    methods: dict,
    instructions: dict,
) -> dict:
    asset_start = int(
        methods["asset3DCreateRenderTexture"]["rvaStart"],
        16,
    )
    constructor_call = instructions["asset3DCreateRenderTexture"].get(
        asset_start + 0x68
    )
    if constructor_call is None or constructor_call.mnemonic != "bl":
        raise RuntimeError(
            "candidate Asset3DRenderer RenderTexture constructor call moved"
        )
    constructor_start = direct_target(constructor_call)
    constructor, constructor_instructions = method_evidence_at(
        elf,
        script,
        constructor_start,
        "UnityEngine.RenderTexture$$.ctor",
    )
    constructor_methods = {"constructor": constructor}
    constructor_decoded = {"constructor": constructor_instructions}
    constructor_checks = [
        require_instruction(
            constructor_methods,
            constructor_decoded,
            "constructor",
            0x68,
            "mov w1, w22",
        ),
        require_instruction(
            constructor_methods,
            constructor_decoded,
            "constructor",
            0x6C,
            "mov w2, w21",
        ),
        require_instruction(
            constructor_methods,
            constructor_decoded,
            "constructor",
            0x70,
            "mov w3, w20",
        ),
        require_instruction(
            constructor_methods,
            constructor_decoded,
            "constructor",
            0x74,
            "mov w4, w19",
        ),
        require_instruction(
            constructor_methods,
            constructor_decoded,
            "constructor",
            0x84,
            "ldr w5, [x8]",
        ),
    ]
    constructor_tail = constructor_instructions.get(constructor_start + 0x8C)
    if constructor_tail is None or constructor_tail.mnemonic != "b":
        raise RuntimeError(
            "candidate RenderTexture four-argument constructor tail moved"
        )
    mip_constructor_start = direct_target(constructor_tail)
    mip_constructor, mip_instructions = method_evidence_at(
        elf,
        script,
        mip_constructor_start,
        "UnityEngine.RenderTexture$$.ctor",
    )
    mip_methods = {"mipConstructor": mip_constructor}
    mip_decoded = {"mipConstructor": mip_instructions}
    mip_checks = [
        require_instruction(
            mip_methods,
            mip_decoded,
            "mipConstructor",
            0x80,
            "mov w6, w19",
        ),
        require_instruction(
            mip_methods,
            mip_decoded,
            "mipConstructor",
            0x88,
            "mov w5, wzr",
        ),
    ]
    initialize_tail = mip_instructions.get(mip_constructor_start + 0x9C)
    if initialize_tail is None or initialize_tail.mnemonic != "b":
        raise RuntimeError(
            "candidate RenderTexture mip constructor tail moved"
        )
    initialize_start = direct_target(initialize_tail)
    initialize, initialize_instructions = method_evidence_at(
        elf,
        script,
        initialize_start,
        "UnityEngine.RenderTexture$$Initialize",
    )
    initialize_methods = {"initialize": initialize}
    initialize_decoded = {"initialize": initialize_instructions}
    initialize_checks = [
        require_call(
            initialize_methods,
            initialize_decoded,
            script,
            "initialize",
            0x58,
            "UnityEngine.RenderTexture$$GetCompatibleFormat",
        ),
        require_call(
            initialize_methods,
            initialize_decoded,
            script,
            "initialize",
            0x6C,
            "UnityEngine.RenderTexture$$GetDepthStencilFormatLegacy",
        ),
        require_call(
            initialize_methods,
            initialize_decoded,
            script,
            "initialize",
            0xF8,
            "UnityEngine.RenderTexture$$SetColorFormat",
        ),
        require_call(
            initialize_methods,
            initialize_decoded,
            script,
            "initialize",
            0x104,
            "UnityEngine.RenderTexture$$SetMipMapCount",
        ),
        require_call(
            initialize_methods,
            initialize_decoded,
            script,
            "initialize",
            0x12C,
            "UnityEngine.RenderTexture$$SetSRGBReadWrite",
        ),
    ]
    compatible_call = initialize_instructions.get(initialize_start + 0x58)
    compatible_start = direct_target(compatible_call)
    compatible, compatible_instructions = method_evidence_at(
        elf,
        script,
        compatible_start,
        "UnityEngine.RenderTexture$$GetCompatibleFormat",
    )
    compatible_methods = {"compatible": compatible}
    compatible_decoded = {"compatible": compatible_instructions}
    compatible_checks = [
        require_call(
            compatible_methods,
            compatible_decoded,
            script,
            "compatible",
            0x84,
            "UnityEngine.Experimental.Rendering.GraphicsFormatUtility"
            "$$GetGraphicsFormat",
        ),
        require_instruction(
            compatible_methods,
            compatible_decoded,
            "compatible",
            0x88,
            "mov w1, #0x10",
        ),
        require_call(
            compatible_methods,
            compatible_decoded,
            script,
            "compatible",
            0x94,
            "UnityEngine.SystemInfo$$GetCompatibleFormat",
        ),
    ]
    graphics_call = compatible_instructions.get(compatible_start + 0x84)
    graphics_read_write_start = direct_target(graphics_call)
    graphics_read_write, graphics_read_write_instructions = (
        method_evidence_at(
            elf,
            script,
            graphics_read_write_start,
            "UnityEngine.Experimental.Rendering.GraphicsFormatUtility"
            "$$GetGraphicsFormat",
        )
    )
    graphics_methods = {"readWrite": graphics_read_write}
    graphics_decoded = {"readWrite": graphics_read_write_instructions}
    graphics_checks = [
        require_call(
            graphics_methods,
            graphics_decoded,
            script,
            "readWrite",
            0x40,
            "UnityEngine.QualitySettings$$get_activeColorSpace",
        ),
        require_instruction(
            graphics_methods,
            graphics_decoded,
            "readWrite",
            0x5C,
            "cmp w21, #1",
        ),
        require_instruction(
            graphics_methods,
            graphics_decoded,
            "readWrite",
            0x68,
            "cmp w20, #2",
        ),
        require_instruction(
            graphics_methods,
            graphics_decoded,
            "readWrite",
            0x70,
            "cmp w20, #0",
        ),
        require_instruction(
            graphics_methods,
            graphics_decoded,
            "readWrite",
            0x78,
            "csel w1, w8, w9, eq",
        ),
        require_call(
            graphics_methods,
            graphics_decoded,
            script,
            "readWrite",
            0x84,
            "UnityEngine.Experimental.Rendering.GraphicsFormatUtility"
            "$$GetGraphicsFormat",
            kind="b",
        ),
    ]
    graphics_bool_call = graphics_read_write_instructions.get(
        graphics_read_write_start + 0x84
    )
    graphics_bool_start = direct_target(graphics_bool_call)
    graphics_bool, graphics_bool_instructions = method_evidence_at(
        elf,
        script,
        graphics_bool_start,
        "UnityEngine.Experimental.Rendering.GraphicsFormatUtility"
        "$$GetGraphicsFormat",
    )
    graphics_bool_methods = {"bool": graphics_bool}
    graphics_bool_decoded = {"bool": graphics_bool_instructions}
    graphics_bool_checks = [
        require_instruction(
            graphics_bool_methods,
            graphics_bool_decoded,
            "bool",
            0x6C,
            "and w1, w20, #1",
        ),
        require_instruction(
            graphics_bool_methods,
            graphics_bool_decoded,
            "bool",
            0x70,
            "mov w0, w19",
        ),
        require_instruction(
            graphics_bool_methods,
            graphics_bool_decoded,
            "bool",
            0x80,
            "br x2",
        ),
    ]
    native_bridge, native_bridge_instructions = method_evidence(
        elf,
        script,
        "UnityEngine.Experimental.Rendering.GraphicsFormatUtility"
        "$$GetGraphicsFormat_Native_RenderTextureFormat",
    )
    native_bridge_methods = {"native": native_bridge}
    native_bridge_decoded = {"native": native_bridge_instructions}
    native_bridge_checks = [
        require_instruction(
            native_bridge_methods,
            native_bridge_decoded,
            "native",
            0x30,
            "and w1, w19, #1",
        ),
        require_instruction(
            native_bridge_methods,
            native_bridge_decoded,
            "native",
            0x34,
            "mov w0, w20",
        ),
        require_instruction(
            native_bridge_methods,
            native_bridge_decoded,
            "native",
            0x40,
            "br x2",
        ),
    ]
    return {
        "status": "exact-candidate-managed-constructor-chain",
        "entry": {
            "constructor": constructor,
            "callSite": instruction_record(
                constructor_call,
                asset_start,
            ),
            "selectedInstructionChecks": constructor_checks,
        },
        "mipConstructor": {
            "method": mip_constructor,
            "tailCall": instruction_record(
                constructor_tail,
                constructor_start,
            ),
            "selectedInstructionChecks": mip_checks,
            "readWrite": {
                "value": 0,
                "name": "Default",
                "status": "exact-candidate-il2cpp-immediate",
            },
            "mipCount":
                "runtime-static-loaded-by-four-argument-overload",
        },
        "initialize": {
            "method": initialize,
            "tailCall": instruction_record(
                initialize_tail,
                mip_constructor_start,
            ),
            "selectedInstructionChecks": initialize_checks,
        },
        "compatibleFormat": {
            "method": compatible,
            "selectedInstructionChecks": compatible_checks,
            "renderUsage": {
                "value": 16,
                "name": "Render",
                "status": "exact-candidate-il2cpp-immediate",
            },
            "systemInfoResult": "runtime-required-device-capability",
        },
        "graphicsFormatReadWrite": {
            "method": graphics_read_write,
            "selectedInstructionChecks": graphics_checks,
            "defaultRule":
                "isSRGB = activeColorSpace == Linear when readWrite == Default",
            "status": "exact-candidate-il2cpp-control-flow",
        },
        "graphicsFormatBool": {
            "method": graphics_bool,
            "selectedInstructionChecks": graphics_bool_checks,
            "status": "exact-candidate-il2cpp-native-bridge-call",
        },
        "nativeBridge": {
            "method": native_bridge,
            "selectedInstructionChecks": native_bridge_checks,
            "status": "exact-candidate-il2cpp-icall-bridge",
        },
    }


def locate_candidate_function_by_branch_shape(
    label: str,
    game_data: bytes,
    game_elf: ELFFile,
    game_target: int,
    release_instructions: list,
    release_start: int,
    release_target: int,
    size: int,
) -> tuple[int, bytes, list, list[dict]]:
    release_offsets = [
        instruction.address - release_start
        for instruction in release_instructions
        if direct_branch_target(instruction) == release_target
    ]
    if not release_offsets:
        raise RuntimeError(
            f"Unity release {label} has no branch to its expected target"
        )
    game_xrefs = direct_branch_xrefs(
        game_data,
        game_elf,
        game_target,
    )
    starts = {
        int(xref["rva"]) - offset
        for xref in game_xrefs
        for offset in release_offsets
    }
    matches = {}
    for start in starts:
        try:
            body, instructions = decode_function(
                game_data,
                game_elf,
                start,
                size,
            )
            shape = require_same_function_shape(
                label,
                release_instructions,
                release_start,
                instructions,
                start,
                size,
            )
        except (RuntimeError, ValueError):
            continue
        matches[start] = (body, instructions, shape)
    if len(matches) != 1:
        raise RuntimeError(
            f"candidate {label} shape occurs {len(matches)} times"
        )
    start, (body, instructions, _shape) = next(iter(matches.items()))
    selected_xrefs = [
        {
            "rva": f"0x{int(xref['rva']):x}",
            "kind": xref["kind"],
            "bytesHex": xref["bytes"].hex(),
            **identity(xref["bytes"]),
        }
        for xref in game_xrefs
        if int(xref["rva"]) - start in release_offsets
    ]
    return start, body, instructions, selected_xrefs


def native_function_record(
    start: int,
    body: bytes,
    instructions: list,
) -> dict:
    return {
        "rva": f"0x{start:x}",
        **identity(body),
        "normalizedShapeSha256": canonical_digest(
            normalized_function_shape(
                instructions,
                start,
                len(body),
            )
        ),
    }


def extract_rendertexture_native_contract(
    game_data: bytes,
    release_data: bytes,
    release_symbols_data: bytes,
    metadata: dict,
    active_color_space: int,
    managed_constructor: dict,
) -> dict:
    game_stream = io.BytesIO(game_data)
    release_stream = io.BytesIO(release_data)
    symbols_stream = io.BytesIO(release_symbols_data)
    game_elf = ELFFile(game_stream)
    release_elf = ELFFile(release_stream)
    symbols_elf = ELFFile(symbols_stream)

    release_table, table_bytes = function_symbol(
        release_data,
        release_elf,
        symbols_elf,
        RENDER_TEXTURE_FORMAT_TABLE_SYMBOL,
    )
    if len(table_bytes) != 29 * 2 * 4:
        raise RuntimeError(
            "Unity release RenderTexture graphics-format table size changed"
        )
    table_values = list(struct.unpack("<58I", table_bytes))
    game_table = unique_bytes_occurrence(
        game_data,
        game_elf,
        table_bytes,
        "Unity release RenderTexture graphics-format table",
    )

    release_format, release_format_body = function_symbol(
        release_data,
        release_elf,
        symbols_elf,
        RENDER_TEXTURE_FORMAT_SYMBOL,
    )
    release_format_start = int(release_format["rva"], 16)
    _, release_format_instructions = decode_function(
        release_data,
        release_elf,
        release_format_start,
        len(release_format_body),
    )
    release_table_xrefs = [
        xref for xref in adrp_add_xrefs(
            release_data,
            release_elf,
            int(release_table["rva"], 16),
        )
        if release_format_start
        <= int(xref["rva"])
        < release_format_start + len(release_format_body)
    ]
    if len(release_table_xrefs) != 1:
        raise RuntimeError(
            "Unity release RenderTexture format function table xref changed"
        )
    game_table_xrefs = adrp_add_xrefs(
        game_data,
        game_elf,
        int(game_table["rva"]),
    )
    if len(game_table_xrefs) != 1:
        raise RuntimeError(
            "candidate RenderTexture format table xref is not unique"
        )
    table_relative = (
        int(release_table_xrefs[0]["rva"]) - release_format_start
    )
    game_format_start = (
        int(game_table_xrefs[0]["rva"]) - table_relative
    )
    game_format_body, game_format_instructions = decode_function(
        game_data,
        game_elf,
        game_format_start,
        len(release_format_body),
    )
    require_same_function_shape(
        "RenderTextureFormat/TextureColorSpace mapping",
        release_format_instructions,
        release_format_start,
        game_format_instructions,
        game_format_start,
        len(release_format_body),
    )

    release_read_write, release_read_write_body = function_symbol(
        release_data,
        release_elf,
        symbols_elf,
        RENDER_TEXTURE_READ_WRITE_SYMBOL,
    )
    release_read_write_start = int(release_read_write["rva"], 16)
    _, release_read_write_instructions = decode_function(
        release_data,
        release_elf,
        release_read_write_start,
        len(release_read_write_body),
    )
    (
        game_read_write_start,
        game_read_write_body,
        game_read_write_instructions,
        game_read_write_xrefs,
    ) = locate_candidate_function_by_branch_shape(
        "RenderTextureFormat/RenderTextureReadWrite mapping",
        game_data,
        game_elf,
        game_format_start,
        release_read_write_instructions,
        release_read_write_start,
        release_format_start,
        len(release_read_write_body),
    )

    release_helper, release_helper_body = function_symbol(
        release_data,
        release_elf,
        symbols_elf,
        RENDER_TEXTURE_NATIVE_HELPER_SYMBOL,
    )
    release_helper_start = int(release_helper["rva"], 16)
    _, release_helper_instructions = decode_function(
        release_data,
        release_elf,
        release_helper_start,
        len(release_helper_body),
    )
    (
        game_helper_start,
        game_helper_body,
        game_helper_instructions,
        game_helper_xrefs,
    ) = locate_candidate_function_by_branch_shape(
        "GetGraphicsFormat_Native_RenderTextureFormat helper",
        game_data,
        game_elf,
        game_format_start,
        release_helper_instructions,
        release_helper_start,
        release_format_start,
        len(release_helper_body),
    )

    release_wrapper, release_wrapper_body = function_symbol(
        release_data,
        release_elf,
        symbols_elf,
        RENDER_TEXTURE_NATIVE_WRAPPER_SYMBOL,
    )
    release_wrapper_start = int(release_wrapper["rva"], 16)
    _, release_wrapper_instructions = decode_function(
        release_data,
        release_elf,
        release_wrapper_start,
        len(release_wrapper_body),
    )
    (
        game_wrapper_start,
        game_wrapper_body,
        game_wrapper_instructions,
        game_wrapper_xrefs,
    ) = locate_candidate_function_by_branch_shape(
        "GraphicsFormatUtility RenderTextureFormat icall wrapper",
        game_data,
        game_elf,
        game_helper_start,
        release_wrapper_instructions,
        release_wrapper_start,
        release_helper_start,
        len(release_wrapper_body),
    )

    render_texture_format = 0
    linear_graphics_format = table_values[render_texture_format * 2]
    srgb_graphics_format = table_values[render_texture_format * 2 + 1]
    expected_linear = (
        9 if TEST_MUTATION == "native-format-table" else 8
    )
    if linear_graphics_format != expected_linear:
        raise RuntimeError(
            "requested ARGB32 Linear GraphicsFormat expected "
            f"{expected_linear}, got {linear_graphics_format}"
        )
    if srgb_graphics_format != 4:
        raise RuntimeError(
            "requested ARGB32 sRGB GraphicsFormat expected 4, got "
            f"{srgb_graphics_format}"
        )
    if active_color_space not in (0, 1):
        raise RuntimeError(
            "candidate PlayerSettings active color space is not Gamma/Linear"
        )
    read_write_value = int(
        managed_constructor["mipConstructor"]["readWrite"]["value"]
    )
    if read_write_value != 0:
        raise RuntimeError(
            "candidate managed RenderTexture readWrite is not Default"
        )
    is_srgb = active_color_space == 1
    requested_graphics_format = (
        srgb_graphics_format if is_srgb else linear_graphics_format
    )

    release_object, release_object_body = function_symbol(
        release_data,
        release_elf,
        symbols_elf,
        RENDER_TEXTURE_CTOR_SYMBOL,
    )
    release_object_start = int(release_object["rva"], 16)
    _, release_object_instructions = decode_function(
        release_data,
        release_elf,
        release_object_start,
        len(release_object_body),
    )
    object_fingerprint_offset = 0x94
    object_fingerprint = release_object_body[
        object_fingerprint_offset : object_fingerprint_offset + 0x10
    ]
    object_fingerprint_match = unique_bytes_occurrence(
        game_data,
        game_elf,
        object_fingerprint,
        "Unity release RenderTexture constructor fingerprint",
    )
    game_object_start = (
        int(object_fingerprint_match["rva"]) - object_fingerprint_offset
    )
    game_object_body, game_object_instructions = decode_function(
        game_data,
        game_elf,
        game_object_start,
        len(release_object_body),
    )
    require_same_function_shape(
        "RenderTexture native object constructor",
        release_object_instructions,
        release_object_start,
        game_object_instructions,
        game_object_start,
        len(release_object_body),
    )

    release_desc, release_desc_body = function_symbol(
        release_data,
        release_elf,
        symbols_elf,
        RENDER_TEXTURE_DESC_CTOR_SYMBOL,
    )
    release_desc_start = int(release_desc["rva"], 16)
    _, release_desc_instructions = decode_function(
        release_data,
        release_elf,
        release_desc_start,
        len(release_desc_body),
    )
    release_desc_call = next(
        instruction for instruction in release_object_instructions
        if instruction.address == release_object_start + 0x30
    )
    if direct_branch_target(release_desc_call) != release_desc_start:
        raise RuntimeError(
            "Unity release RenderTexture object constructor no longer calls "
            "RenderTextureDesc at +0x30"
        )
    game_desc_call = next(
        instruction for instruction in game_object_instructions
        if instruction.address == game_object_start + 0x30
    )
    game_desc_start = direct_branch_target(game_desc_call)
    if game_desc_start is None:
        raise RuntimeError(
            "candidate RenderTexture object constructor descriptor call moved"
        )
    game_desc_body, game_desc_instructions = decode_function(
        game_data,
        game_elf,
        game_desc_start,
        len(release_desc_body),
    )
    release_desc_shape = normalized_function_shape(
        release_desc_instructions,
        release_desc_start,
        len(release_desc_body),
    )
    game_desc_shape = normalized_function_shape(
        game_desc_instructions,
        game_desc_start,
        len(game_desc_body),
    )
    for index in (4, 5, 15):
        release_desc_shape[index] = re.sub(
            r"#0x[0-9a-f]+(?=\])",
            "#constant",
            release_desc_shape[index],
        )
        game_desc_shape[index] = re.sub(
            r"#0x[0-9a-f]+(?=\])",
            "#constant",
            game_desc_shape[index],
        )
    if release_desc_shape != game_desc_shape:
        raise RuntimeError(
            "candidate RenderTextureDesc constructor instruction shape changed"
        )

    def descriptor_constant(
        data: bytes,
        elf: ELFFile,
        instructions: list,
        start: int,
        adrp_relative: int,
        load_relative: int,
        size: int,
    ) -> tuple[int, bytes]:
        by_address = {
            instruction.address: instruction
            for instruction in instructions
        }
        address = adrp_load_target(
            by_address[start + adrp_relative],
            by_address[start + load_relative],
        )
        offset = elf_file_offset(elf, address, size)
        return address, data[offset : offset + size]

    release_primary_address, release_primary = descriptor_constant(
        release_data,
        release_elf,
        release_desc_instructions,
        release_desc_start,
        0x04,
        0x10,
        16,
    )
    game_primary_address, game_primary = descriptor_constant(
        game_data,
        game_elf,
        game_desc_instructions,
        game_desc_start,
        0x04,
        0x10,
        16,
    )
    release_format_address, release_default_format = descriptor_constant(
        release_data,
        release_elf,
        release_desc_instructions,
        release_desc_start,
        0x08,
        0x14,
        8,
    )
    game_format_address, game_default_format = descriptor_constant(
        game_data,
        game_elf,
        game_desc_instructions,
        game_desc_start,
        0x08,
        0x14,
        8,
    )
    release_flags_address, release_flags = descriptor_constant(
        release_data,
        release_elf,
        release_desc_instructions,
        release_desc_start,
        0x34,
        0x3C,
        16,
    )
    game_flags_address, game_flags = descriptor_constant(
        game_data,
        game_elf,
        game_desc_instructions,
        game_desc_start,
        0x34,
        0x3C,
        16,
    )
    for label, release_value, game_value in (
        ("primary defaults", release_primary, game_primary),
        ("format defaults", release_default_format, game_default_format),
        ("dimension/flags defaults", release_flags, game_flags),
    ):
        if release_value != game_value:
            raise RuntimeError(
                f"candidate RenderTextureDesc {label} differ from release"
            )

    width, height, msaa_samples, volume_depth = struct.unpack(
        "<4I",
        game_primary,
    )
    mip_count, default_graphics_format = struct.unpack(
        "<iI",
        game_default_format,
    )
    dimension, shadow_sampling_mode, vr_usage, creation_flags = (
        struct.unpack("<4I", game_flags)
    )
    expected_msaa_samples = (
        2 if TEST_MUTATION == "native-defaults" else 1
    )
    if msaa_samples != expected_msaa_samples:
        raise RuntimeError(
            "RenderTextureDesc default msaaSamples expected "
            f"{expected_msaa_samples}, got {msaa_samples}"
        )
    expected_defaults = {
        "width": (width, 256),
        "height": (height, 256),
        "volumeDepth": (volume_depth, 1),
        "mipCount": (mip_count, -1),
        "graphicsFormat": (default_graphics_format, 8),
        "dimension": (dimension, 2),
        "shadowSamplingMode": (shadow_sampling_mode, 2),
        "vrUsage": (vr_usage, 0),
        "creationFlags": (creation_flags, 130),
    }
    for field, (actual, expected) in expected_defaults.items():
        if actual != expected:
            raise RuntimeError(
                f"RenderTextureDesc default {field} expected "
                f"{expected}, got {actual}"
            )
    desc_by_address = {
        instruction.address: instruction
        for instruction in game_desc_instructions
    }
    memoryless_store = desc_by_address.get(game_desc_start + 0x40)
    if instruction_text(memoryless_store) != "str wzr, [x19, #0x30]":
        raise RuntimeError(
            "candidate RenderTextureDesc memoryless default store changed"
        )
    flag_values = metadata["enums"]["renderTextureCreationFlags"]["values"]
    flag_names = sorted(
        name
        for name, value in flag_values.items()
        if value != 0 and creation_flags & value
    )

    def constant_record(address: int, raw: bytes) -> dict:
        return {
            "rva": f"0x{address:x}",
            "rawHex": raw.hex(),
            **identity(raw),
        }

    mappings = []
    render_format_names = metadata["enums"]["renderTextureFormat"]["byValue"]
    graphics_format_names = metadata["enums"]["graphicsFormat"]["byValue"]
    for value in range(29):
        linear = table_values[value * 2]
        srgb = table_values[value * 2 + 1]
        mappings.append(
            {
                "renderTextureFormatValue": value,
                "renderTextureFormat": render_format_names.get(
                    str(value),
                    "unmapped",
                ),
                "linearGraphicsFormatValue": linear,
                "linearGraphicsFormat": graphics_format_names.get(
                    str(linear),
                    "None" if linear == 0 else "unmapped",
                ),
                "sRGBGraphicsFormatValue": srgb,
                "sRGBGraphicsFormat": graphics_format_names.get(
                    str(srgb),
                    "None" if srgb == 0 else "unmapped",
                ),
            }
        )

    return {
        "status":
            "exact-candidate-native-request-mapping-and-default-descriptor",
        "releasePlayer": {
            "formatTable": release_table,
            "formatFunction": {
                **release_format,
                "normalizedShapeSha256": canonical_digest(
                    normalized_function_shape(
                        release_format_instructions,
                        release_format_start,
                        len(release_format_body),
                    )
                ),
            },
            "readWriteFunction": release_read_write,
            "nativeHelper": release_helper,
            "icallWrapper": release_wrapper,
            "descriptorConstructor": release_desc,
            "renderTextureConstructor": release_object,
        },
        "candidateLibunity": {
            "formatTable": {
                "rva": f"0x{int(game_table['rva']):x}",
                "fileOffset": game_table["fileOffset"],
                "bytesHex": table_bytes.hex(),
                "byteLength": game_table["byteLength"],
                "sha256": game_table["sha256"],
            },
            "formatFunction": native_function_record(
                game_format_start,
                game_format_body,
                game_format_instructions,
            ),
            "readWriteFunction": {
                **native_function_record(
                    game_read_write_start,
                    game_read_write_body,
                    game_read_write_instructions,
                ),
                "targetXrefs": game_read_write_xrefs,
            },
            "nativeHelper": {
                **native_function_record(
                    game_helper_start,
                    game_helper_body,
                    game_helper_instructions,
                ),
                "targetXrefs": game_helper_xrefs,
            },
            "icallWrapper": {
                **native_function_record(
                    game_wrapper_start,
                    game_wrapper_body,
                    game_wrapper_instructions,
                ),
                "targetXrefs": game_wrapper_xrefs,
            },
            "descriptorConstructor": native_function_record(
                game_desc_start,
                game_desc_body,
                game_desc_instructions,
            ),
            "renderTextureConstructor": native_function_record(
                game_object_start,
                game_object_body,
                game_object_instructions,
            ),
        },
        "formatMapping": {
            "tableEntryCount": len(mappings),
            "mappings": mappings,
            "managedReadWrite": {
                "value": read_write_value,
                "name":
                    metadata["enums"]["renderTextureReadWrite"]["byValue"][
                        str(read_write_value)
                    ],
            },
            "activeColorSpace": {
                "value": active_color_space,
                "name": metadata["enums"]["colorSpace"]["byValue"][
                    str(active_color_space)
                ],
            },
            "resolvedTextureColorSpace": {
                "value": 1 if is_srgb else 0,
                "name": "sRGB" if is_srgb else "Linear",
            },
            "requestedRenderTextureFormat": {
                "value": render_texture_format,
                "name": "ARGB32",
            },
            "requestedGraphicsFormat": {
                "value": requested_graphics_format,
                "name": metadata["enums"]["graphicsFormat"]["byValue"][
                    str(requested_graphics_format)
                ],
                "status": "exact-candidate-managed-and-native-control-flow",
            },
            "compatibleGraphicsFormat": {
                "usageValue": 16,
                "usage": "Render",
                "status": "runtime-required-device-capability",
            },
        },
        "descriptorDefaults": {
            "status":
                "exact-candidate-libunity-default-constructor-before-managed-setters",
            "primaryConstant": constant_record(
                game_primary_address,
                game_primary,
            ),
            "formatConstant": constant_record(
                game_format_address,
                game_default_format,
            ),
            "dimensionFlagsConstant": constant_record(
                game_flags_address,
                game_flags,
            ),
            "releaseConstantRvas": {
                "primary": f"0x{release_primary_address:x}",
                "format": f"0x{release_format_address:x}",
                "dimensionFlags": f"0x{release_flags_address:x}",
            },
            "width": width,
            "height": height,
            "antiAliasing": msaa_samples,
            "volumeDepth": volume_depth,
            "mipCount": mip_count,
            "graphicsFormat": default_graphics_format,
            "dimension": {
                "value": dimension,
                "name": metadata["enums"]["textureDimension"]["byValue"][
                    str(dimension)
                ],
            },
            "shadowSamplingMode": {
                "value": shadow_sampling_mode,
                "name":
                    metadata["enums"]["shadowSamplingMode"]["byValue"][
                        str(shadow_sampling_mode)
                    ],
            },
            "vrUsage": {
                "value": vr_usage,
                "name": metadata["enums"]["vrTextureUsage"]["byValue"][
                    str(vr_usage)
                ],
            },
            "creationFlags": {
                "value": creation_flags,
                "names": flag_names,
            },
            "memoryless": {
                "value": 0,
                "name": "None",
                "store": instruction_record(
                    memoryless_store,
                    game_desc_start,
                ),
            },
        },
        "effectiveCardSourceBoundary": {
            "requestedGraphicsFormat": requested_graphics_format,
            "antiAliasing": 1,
            "volumeDepth": 1,
            "useMipMap":
                "exact-candidate-managed-request-from-serialized-field",
            "autoGenerateMips":
                "exact-candidate-managed-request-from-serialized-field",
            "memoryless": 0,
            "enableRandomWrite": False,
            "bindMS": False,
            "dynamicScale": False,
            "compatibleGraphicsFormat":
                "runtime-required-device-capability",
            "depthStencilFormat":
                "runtime-required-native-legacy-depth-conversion",
            "physicalYOrientation":
                "runtime-required-native-and-guest-allocation",
        },
    }


def extract_native(
    elf: Elf64,
    script: ScriptIndex,
    metadata: dict,
) -> dict:
    metadata_enums = metadata["enums"]
    methods: dict[str, dict] = {}
    instructions: dict[str, dict] = {}
    for key, name in METHOD_NAMES.items():
        methods[key], instructions[key] = method_evidence(elf, script, name)

    checks = {
        "serializedToNative": [
            require_instruction(
                methods, instructions, "uiCardViewCreateRenderer", 0x64,
                "ldr w0, [x19, #0x158]",
            ),
            require_call(
                methods, instructions, script, "uiCardViewCreateRenderer", 0x6C,
                METHOD_NAMES["uiCardViewSizeToCardSize"],
            ),
            require_instruction(
                methods, instructions, "uiCardViewCreateRenderer", 0x78,
                "ldrb w23, [x19, #0x15c]",
            ),
            require_instruction(
                methods, instructions, "uiCardViewCreateRenderer", 0x7C,
                "ldrb w24, [x19, #0x165]",
            ),
            require_call(
                methods, instructions, script, "uiCardViewCreateRenderer", 0x98,
                METHOD_NAMES["cardRendererCtor"],
            ),
            require_call(
                methods, instructions, script, "cardRendererCtor", 0xDC,
                METHOD_NAMES["cardRendererCreateRenderTexture"],
                kind="b",
            ),
        ],
        "requestConstructor": [
            require_instruction(
                methods, instructions, "asset3DCreateRenderTexture", 0x50,
                "mov w1, w23",
            ),
            require_instruction(
                methods, instructions, "asset3DCreateRenderTexture", 0x54,
                "mov w2, w22",
            ),
            require_instruction(
                methods, instructions, "asset3DCreateRenderTexture", 0x58,
                "mov w3, #0x18",
            ),
            require_instruction(
                methods, instructions, "asset3DCreateRenderTexture", 0x5C,
                "mov w4, wzr",
            ),
            require_call(
                methods, instructions, script, "asset3DCreateRenderTexture", 0x68,
                "UnityEngine.RenderTexture$$.ctor",
            ),
            require_call(
                methods, instructions, script, "asset3DCreateRenderTexture", 0xA0,
                "UnityEngine.RenderTexture$$set_useMipMap",
            ),
            require_call(
                methods, instructions, script, "asset3DCreateRenderTexture", 0xB0,
                "UnityEngine.RenderTexture$$set_autoGenerateMips",
            ),
            require_call(
                methods, instructions, script, "asset3DCreateRenderTexture", 0xBC,
                "UnityEngine.RenderTexture$$Create",
            ),
        ],
        "cardRequest": [
            require_call(
                methods, instructions, script, "cardRendererCreateRenderTexture",
                0x104, METHOD_NAMES["cardDimensionPixelSize"],
            ),
            require_call(
                methods, instructions, script, "cardRendererCreateRenderTexture",
                0x2C0, METHOD_NAMES["asset3DCreateRenderTexture"],
            ),
            require_call(
                methods, instructions, script, "cardRendererUpdateRenderTexture",
                0x5C, METHOD_NAMES["cardDimensionPixelSize"],
            ),
        ],
    }

    card_dimension = instructions["cardDimensionCctor"]
    large_low = immediate(card_dimension[int(methods["cardDimensionCctor"]["rvaStart"], 16) + 0x70].op_str)
    large_high = immediate(card_dimension[int(methods["cardDimensionCctor"]["rvaStart"], 16) + 0x74].op_str)
    medium_low = immediate(card_dimension[int(methods["cardDimensionCctor"]["rvaStart"], 16) + 0x80].op_str)
    medium_high = immediate(card_dimension[int(methods["cardDimensionCctor"]["rvaStart"], 16) + 0x88].op_str)
    card_size_names = metadata_enums["cardSizeType"]["byValue"]
    large = {
        "name": card_size_names["3"],
        "width": large_low,
        "height": large_high,
    }
    medium = {
        "name": card_size_names["2"],
        "width": medium_low,
        "height": medium_high,
    }

    meter_address = referenced_address(
        card_dimension[int(methods["cardDimensionCctor"]["rvaStart"], 16) + 0x98],
        card_dimension[int(methods["cardDimensionCctor"]["rvaStart"], 16) + 0xB0],
    )
    meter_raw = elf.read(meter_address, 8)
    meter = struct.unpack("<ff", meter_raw)

    card_cctor = instructions["cardRendererCctor"]
    denominator_address = referenced_address(
        card_cctor[int(methods["cardRendererCctor"]["rvaStart"], 16) + 0x64],
        card_cctor[int(methods["cardRendererCctor"]["rvaStart"], 16) + 0x6C],
    )
    denominator_raw = elf.read(denominator_address, 4)
    denominator = struct.unpack("<f", denominator_raw)[0]
    half_y = f32(f32(meter[1]) * f32(0.5))
    vertical = f32(half_y / f32(denominator))

    to_size = instructions["uiCardViewSizeToCardSize"]
    to_size_start = int(methods["uiCardViewSizeToCardSize"]["rvaStart"], 16)
    table_address = referenced_address(
        to_size[to_size_start + 0x0C],
        to_size[to_size_start + 0x10],
    )
    table_raw = elf.read(table_address, 20)
    table = list(struct.unpack("<5I", table_raw))

    quality = instructions["qualitySet"]
    quality_start = int(methods["qualitySet"]["rvaStart"], 16)
    middle_address = referenced_address(
        quality[quality_start + 0x168],
        quality[quality_start + 0x170],
    )
    low_address = referenced_address(
        quality[quality_start + 0x120],
        quality[quality_start + 0x128],
    )
    middle_raw = elf.read(middle_address, 4)
    low_raw = elf.read(low_address, 4)
    factors = {
        "High": 1.0,
        "Middle": struct.unpack("<f", middle_raw)[0],
        "Low": struct.unpack("<f", low_raw)[0],
    }

    set_aa_name = "UnityEngine.RenderTexture$$set_antiAliasing"
    asset_call_names = {
        name
        for row in methods["asset3DCreateRenderTexture"]["directResolvedCalls"]
        for name in row["targetNames"]
    }
    legacy_render_target_methods = [
        "Lettuce.Graphics.Rendering.RendererData$$GetTemporary",
        "Lettuce.Graphics.Rendering.CustomRenderer$$Setup",
        "Lettuce.Graphics.Rendering.DrawOpaquePass$$OnCameraSetup",
        "Lettuce.Graphics.Rendering.DrawTransparentPass$$OnCameraSetup",
        "Lettuce.Graphics.Rendering.DrawPostProcessPass$$Execute",
    ]
    render_graph_methods = [
        "Lettuce.Graphics.Rendering.CustomRendererRenderGraph$$OnRecordRenderGraph",
        "Lettuce.Graphics.Rendering.CustomRendererRenderGraph$$OnCustomMainRendering",
        "Lettuce.Graphics.Rendering.CustomRendererRenderGraph$$OnCustomPostProcessing",
        "Lettuce.Graphics.PostProcessing.Bloom.BloomPass$$Execute",
    ]
    render_graph_evidence = {}
    render_graph_instructions = {}
    for name in render_graph_methods:
        evidence, decoded = method_evidence(elf, script, name)
        render_graph_evidence[name] = evidence
        render_graph_instructions[name] = decoded
    bloom_name = (
        "Lettuce.Graphics.PostProcessing.Bloom.BloomPass$$Execute"
    )
    bloom_temporary_rt = extract_bloom_temporary_rt_contract(
        render_graph_evidence[bloom_name],
        render_graph_instructions[bloom_name],
        script,
        metadata_enums,
    )
    main_name = (
        "Lettuce.Graphics.Rendering.CustomRendererRenderGraph"
        "$$OnCustomMainRendering"
    )
    render_graph_scene_mrt = extract_rendergraph_scene_mrt_contract(
        elf,
        script,
        metadata,
        render_graph_evidence[main_name],
        render_graph_instructions[main_name],
    )
    managed_render_texture = extract_managed_rendertexture_constructor_chain(
        elf,
        script,
        methods,
        instructions,
    )
    return {
        "locator": {
            "kind": "Il2CppDumper-script-method-address-only",
            **script.identity,
        },
        "methods": methods,
        "selectedInstructionChecks": checks,
        "cardDimensions": {
            "byCardSizeType": {
                "2": medium,
                "3": large,
            },
            "meterSize": {
                "rva": f"0x{meter_address:x}",
                "x": meter[0],
                "y": meter[1],
                "rawHex": meter_raw.hex(),
                **identity(meter_raw),
            },
            "aspectRatioF32": f32(float(large["width"]) / float(large["height"])),
        },
        "uiCardViewSizeMap": {
            "inputBase": 2,
            "values": table,
            "rva": f"0x{table_address:x}",
            "rawHex": table_raw.hex(),
            **identity(table_raw),
        },
        "verticalPercentageInRT": {
            "operation": "float32(MeterSize.y * 0.5) / denominator",
            "denominator": {
                "rva": f"0x{denominator_address:x}",
                "value": denominator,
                "rawHex": denominator_raw.hex(),
                **identity(denominator_raw),
            },
            "meterYTimesHalfF32": half_y,
            "valueF32": vertical,
        },
        "cardQuality": {
            "factors": factors,
            "middleConstant": {
                "rva": f"0x{middle_address:x}",
                "rawHex": middle_raw.hex(),
                **identity(middle_raw),
            },
            "lowConstant": {
                "rva": f"0x{low_address:x}",
                "rawHex": low_raw.hex(),
                **identity(low_raw),
            },
            "selectedRuntimeQuality": "runtime-required",
        },
        "renderTextureRequest": {
            "constructor":
                "RenderTexture(int width,int height,int depth,RenderTextureFormat)",
            "depthBits": 24,
            "renderTextureFormatValue": 0,
            "renderTextureFormat":
                metadata_enums["renderTextureFormat"]["byValue"]["0"],
            "widthEqualsHeight": True,
            "useMipMapSource": "UICardView._useMipMap",
            "autoGenerateMipsEqualsUseMipMap": True,
            "createCalled": True,
            "antiAliasingSetterCalled": set_aa_name in asset_call_names,
            "effectiveAntiAliasing":
                "candidate-libunity-default-contract-required",
        },
        "managedRenderTextureConstructor": managed_render_texture,
        "renderGraphBoundary": {
            "legacyMethodCounts": {
                name: script.count(name) for name in legacy_render_target_methods
            },
            "candidateMethods": render_graph_evidence,
            "status":
                "architecture-relocated-scene-mrt-partial-exact",
        },
        "renderGraphSceneMrt": render_graph_scene_mrt,
        "bloomTemporaryRt": bloom_temporary_rt,
    }


def extract(args) -> dict:
    manifest, manifest_digest = read_manifest(args.candidate_manifest)
    split_names = manifest["game"]["packageSource"]["splits"]
    base_path = args.split_root / split_names["baseApk"]
    arm64_path = args.split_root / split_names["arm64Split"]
    if not base_path.is_file() or not arm64_path.is_file():
        raise RuntimeError("candidate base/arm64 split APK is missing")
    base_bytes = base_path.read_bytes()
    arm64_bytes = arm64_path.read_bytes()
    verify_identity("base APK", base_bytes, manifest["artifacts"]["baseApk"])
    verify_identity("arm64 split", arm64_bytes, manifest["artifacts"]["arm64Split"])

    with zipfile.ZipFile(base_path) as archive:
        globalgamemanagers = archive.read(GGM_ENTRY)
        encrypted_metadata = archive.read(METADATA_ENTRY)
    with zipfile.ZipFile(arm64_path) as archive:
        libil2cpp = archive.read(IL2CPP_ENTRY)
        libunity = archive.read(LIBUNITY_ENTRY)
    release_player = args.unity_release_player.read_bytes()
    release_symbols = args.unity_release_symbols.read_bytes()
    for label, data, artifact in (
        ("globalgamemanagers", globalgamemanagers, "globalGameManagers"),
        ("encrypted metadata", encrypted_metadata, "globalMetadataEncrypted"),
        ("libil2cpp", libil2cpp, "libil2cpp"),
        ("libunity", libunity, "libunity"),
        ("Unity release player", release_player, "unityReleasePlayer"),
        ("Unity release symbols", release_symbols, "unityReleaseSymbols"),
    ):
        verify_identity(label, data, manifest["artifacts"][artifact])

    plaintext_metadata = args.plaintext_metadata.read_bytes()
    verify_identity(
        "plaintext metadata",
        plaintext_metadata,
        manifest["artifacts"]["globalMetadataPlaintext"],
    )
    locator_libil2cpp = args.locator_libil2cpp.read_bytes()
    if locator_libil2cpp != libil2cpp:
        raise RuntimeError(
            "Il2CppDumper locator libil2cpp does not match candidate split bytes"
        )

    snapshot = json.loads(args.snapshot.read_text(encoding="utf-8"))
    if (
        snapshot.get("complete") is not True
        or snapshot.get("game", {}).get("appVersion") != manifest["game"]["versionName"]
        or snapshot.get("game", {}).get("unityVersion") != EXPECTED_UNITY_VERSION
    ):
        raise RuntimeError("candidate .output-full snapshot identity is incomplete or stale")
    snapshot_bytes = args.snapshot.read_bytes()
    detail = extract_detail_view(args.decrypted_root / DETAIL_BUNDLE)
    player_transfer_contract = extract_player_settings_transfer_contract(
        libunity,
        release_player,
        release_symbols,
    )
    global_settings = extract_global_settings(
        globalgamemanagers,
        player_transfer_contract,
    )
    if global_settings["unityVersion"] != EXPECTED_UNITY_VERSION:
        raise RuntimeError("BuildSettings Unity version does not match candidate")

    script = ScriptIndex(args.script_json)
    metadata_enum_evidence = extract_metadata_enums(args.dump_cs)
    native = extract_native(
        Elf64(libil2cpp),
        script,
        metadata_enum_evidence,
    )
    active_color_space = int(
        global_settings["playerSettings"]["fields"][
            "m_ActiveColorSpace"
        ]["value"]
    )
    native_render_texture = extract_rendertexture_native_contract(
        libunity,
        release_player,
        release_symbols,
        metadata_enum_evidence,
        active_color_space,
        native["managedRenderTextureConstructor"],
    )
    native["renderTextureRequest"]["effectiveAntiAliasing"] = (
        native_render_texture["effectiveCardSourceBoundary"][
            "antiAliasing"
        ]
    )
    serialized_size = int(detail["fields"]["_cardSize"]["value"])
    table_index = serialized_size - native["uiCardViewSizeMap"]["inputBase"]
    table = native["uiCardViewSizeMap"]["values"]
    if table_index < 0 or table_index >= len(table):
        card_size_type = 3
        mapping_source = "native-default"
    else:
        card_size_type = int(table[table_index])
        mapping_source = "native-table"
    dimensions = native["cardDimensions"]["byCardSizeType"].get(str(card_size_type))
    if dimensions is None:
        raise RuntimeError(f"candidate CardSizeType {card_size_type} has no proved dimensions")

    variants = []
    for quality_name, factor in native["cardQuality"]["factors"].items():
        computed = round_to_even_f32(
            int(dimensions["height"]),
            float(native["verticalPercentageInRT"]["valueF32"]),
            float(factor),
        )
        variants.append(
            {
                "quality": quality_name,
                "request": {
                    **computed,
                    "depthBits": native["renderTextureRequest"]["depthBits"],
                    "renderTextureFormatValue":
                        native["renderTextureRequest"]["renderTextureFormatValue"],
                    "renderTextureFormat":
                        native["renderTextureRequest"]["renderTextureFormat"],
                    "requestedGraphicsFormat":
                        native_render_texture["formatMapping"][
                            "requestedGraphicsFormat"
                        ],
                    "antiAliasing":
                        native_render_texture["effectiveCardSourceBoundary"][
                            "antiAliasing"
                        ],
                    "volumeDepth":
                        native_render_texture["effectiveCardSourceBoundary"][
                            "volumeDepth"
                        ],
                    "memoryless":
                        native_render_texture["effectiveCardSourceBoundary"][
                            "memoryless"
                        ],
                    "useMipMap": bool(detail["fields"]["_useMipMap"]["value"]),
                    "autoGenerateMips":
                        bool(detail["fields"]["_useMipMap"]["value"]),
                },
                "status": "exact-candidate-request",
            }
        )

    return {
        "schema": "pocket-card-render/candidate-rendertexture-extraction@4",
        "schemaVersion": 4,
        "candidate": {
            "sampleId": manifest["sampleId"],
            "sampleManifestSha256": manifest_digest,
            "gameVersion": manifest["game"]["versionName"],
            "unityVersion": EXPECTED_UNITY_VERSION,
        },
        "sources": {
            "baseApk": identity(base_bytes),
            "arm64Split": identity(arm64_bytes),
            "globalgamemanagers": {
                "entry": GGM_ENTRY,
                **identity(globalgamemanagers),
            },
            "libil2cpp": {"entry": IL2CPP_ENTRY, **identity(libil2cpp)},
            "libunity": {"entry": LIBUNITY_ENTRY, **identity(libunity)},
            "unityReleasePlayer": identity(release_player),
            "unityReleaseSymbols": identity(release_symbols),
            "encryptedMetadata": {
                "entry": METADATA_ENTRY,
                **identity(encrypted_metadata),
            },
            "plaintextMetadata": identity(plaintext_metadata),
            "il2cppMetadataDumpLocator": metadata_enum_evidence["locator"],
            "outputFullSnapshot": {
                **identity(snapshot_bytes),
                "assetIndexSha256": snapshot["indexes"]["asset"]["sha256"],
                "catalogSha256": snapshot["indexes"]["catalogSha256"],
                "complete": True,
            },
        },
        "serialized": {
            "globalSettings": global_settings,
            "detailCardView": detail,
            "descriptorInputStatus":
                "exact-bytes-provisional-until-canonical-corpus-root-resolves",
        },
        "nativeProducer": native,
        "unityNativeRenderTexture": native_render_texture,
        "metadataEnums": metadata_enum_evidence["enums"],
        "metadataLayouts": metadata_enum_evidence["layouts"],
        "derivedCardSource": {
            "serializedUICardViewSizeType": serialized_size,
            "mappingSource": mapping_source,
            "mappingIndex": table_index,
            "cardSizeType": card_size_type,
            "cardSizeName": dimensions["name"],
            "pixelSize": {
                "width": dimensions["width"],
                "height": dimensions["height"],
            },
            "requestVariants": variants,
            "selectedRuntimeVariant": "runtime-required",
        },
    }


def parse_args(argv: list[str]):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--candidate-manifest", required=True, type=Path)
    parser.add_argument("--split-root", required=True, type=Path)
    parser.add_argument("--decrypted-root", required=True, type=Path)
    parser.add_argument("--snapshot", required=True, type=Path)
    parser.add_argument("--plaintext-metadata", required=True, type=Path)
    parser.add_argument("--locator-libil2cpp", required=True, type=Path)
    parser.add_argument("--script-json", required=True, type=Path)
    parser.add_argument("--dump-cs", required=True, type=Path)
    parser.add_argument("--unity-release-player", required=True, type=Path)
    parser.add_argument("--unity-release-symbols", required=True, type=Path)
    args = parser.parse_args(argv)
    for name in (
        "candidate_manifest",
        "snapshot",
        "plaintext_metadata",
        "locator_libil2cpp",
        "script_json",
        "dump_cs",
        "unity_release_player",
        "unity_release_symbols",
    ):
        path = getattr(args, name)
        if not path.is_file():
            parser.error(f"{name.replace('_', '-')} not found: {path}")
    if not args.split_root.is_dir():
        parser.error(f"split root not found: {args.split_root}")
    if not args.decrypted_root.is_dir():
        parser.error(f"decrypted root not found: {args.decrypted_root}")
    return args


def main(argv: list[str]) -> int:
    result = extract(parse_args(argv))
    json.dump(result, sys.stdout, ensure_ascii=True, indent=2)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main(sys.argv[1:]))
    except Exception as error:
        raise SystemExit(
            f"candidate RenderTexture extraction failed: {error}"
        ) from error
