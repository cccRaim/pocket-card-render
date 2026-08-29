#!/usr/bin/env python3
"""Relocate Unity 6 native producers from matching official release symbols."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import struct
import sys
import zipfile

from capstone import CS_ARCH_ARM64, CS_MODE_ARM, Cs

from official_sample import load_official_sample


sys.dont_write_bytecode = True
LIBUNITY_ENTRY = "lib/arm64-v8a/libunity.so"

TARGETS = (
    ("lifecycle", "UnityPlayerLoop", "_Z15UnityPlayerLoopv"),
    ("lifecycle", "UnityPause", "_Z10UnityPausei"),
    ("lifecycle", "nativePause", "_Z11nativePauseP7_JNIEnvP8_jobject"),
    ("lifecycle", "nativeResume", "_Z12nativeResumeP7_JNIEnvP8_jobject"),
    ("lifecycle", "SetPlayerPause", "_Z14SetPlayerPause11PlayerPauseb"),
    ("lifecycle", "GetPlayerPause", "_Z14GetPlayerPausev"),
    (
        "lifecycle",
        "SetPlayerPauseDirect",
        "_Z20SetPlayerPauseDirect11PlayerPause",
    ),
    (
        "lifecycle",
        "InputSubsystemHandleAppPaused",
        "_ZL29InputSubsystemHandleAppPausedb",
    ),
    (
        "sort",
        "entryComparator",
        "_ZNK18RenderObjectSorterclERK24ScriptableLoopObjectDataS2_",
    ),
    (
        "sort",
        "findPasses",
        "_Z10FindPassesPK12MaterialInfobP11ShaderTagIDiS2_Pi",
    ),
    ("sort", "nodeHasMotion", "_Z13NodeHasMotionRK10RenderNodei"),
    (
        "sort",
        "sortInputBuilder",
        "_Z31PrepareScriptableLoopObjectDataRK15RenderNodeQueue"
        "RK20DrawRenderersCommandPK20OverrideMaterialInfo"
        "PK18OverrideShaderInfoPK12MaterialInfoimm"
        "RN4core6vectorI24ScriptableLoopObjectData"
        "NSE_9allocatorISG_Lm0EEEEE",
    ),
    (
        "sort",
        "distanceKey",
        "_ZL22ComputeSortingDistance22RendererDistanceMetric"
        "RK10Matrix4x4f8Vector3fS3_S3_f",
    ),
    (
        "sort",
        "sortWithFence",
        "_ZL37SortScriptableLoopObjectDataWithFenceR8JobFence"
        "RK15RenderNodeQueue23RendererSortingCriteria"
        "RN4core6vectorI24ScriptableLoopObjectData"
        "NS5_9allocatorIS7_Lm0EEEEE",
    ),
    (
        "sort",
        "prepareCommand",
        "_Z27PrepareDrawRenderersCommandRK20DrawRenderersCommand"
        "R18JobBatchDispatcher",
    ),
    (
        "sort",
        "rendererListPrepare",
        "_ZL33PrepareScriptableDrawRenderersJob"
        "P26ScriptableRenderContextArg",
    ),
    (
        "sort",
        "stdIntrosort",
        "_ZNSt6__ndk111__introsortINS_17_ClassicAlgPolicy"
        "ER18RenderObjectSorterP24ScriptableLoopObjectDataLb0EEE"
        "vT1_S6_T0_NS_15iterator_traitsIS6_E15difference_typeEb",
    ),
    (
        "sort-input",
        "getSortingGroupId",
        "_ZN12BaseRenderer17GetSortingGroupIDEj",
    ),
    (
        "sort-input",
        "getSortingGroupOrder",
        "_ZN12BaseRenderer20GetSortingGroupOrderEj",
    ),
    (
        "sort-input",
        "getGlobalLayeringData",
        "_ZNK12BaseRenderer21GetGlobalLayeringDataEj",
    ),
    (
        "sort-input",
        "rendererConstructor",
        "_ZN8RendererC2E12RendererType10MemLabelId18ObjectCreationMode",
    ),
    (
        "sort-input",
        "rendererUpdateManagerAddRenderer",
        "_ZN21RendererUpdateManager11AddRendererER8Renderer",
    ),
    (
        "sort-input",
        "isSRPBatcherCompatible",
        "_Z22IsSRPBatcherCompatibleRK10RenderNodeRK6Shaderii",
    ),
    (
        "sort-input",
        "flattenBasicData",
        "_ZN12BaseRenderer16FlattenBasicDataERKS_h12LODFadeValue"
        "R10RenderNode",
    ),
    (
        "sort-input",
        "baseRendererConstructor",
        "_ZN12BaseRendererC2E12RendererType",
    ),
    (
        "sort-input",
        "flattenLightProbeData",
        "_ZN12BaseRenderer21FlattenLightProbeDataE4PPtrI9Transform"
        "ERisRK17LightProbeContextR10RenderNode",
    ),
    (
        "sort-input",
        "intermediateAddAsRenderNode",
        "_ZN20IntermediateRenderer15AddAsRenderNodeER15RenderNodeQueue"
        "RK20DeprecatedSourceData",
    ),
    (
        "sort-input",
        "sharedRendererDataConstructor",
        "_ZN18SharedRendererDataC2E12RendererType",
    ),
    (
        "sort-input",
        "getLightProbesCoefficientType",
        "_Z29GetLightProbesCoefficientTypeRK17LightProbeContext"
        "15LightProbeUsageRK15LightmapIndiceshb",
    ),
    (
        "sort-input",
        "meshRendererAddAsRenderNode",
        "_ZN12MeshRenderer15AddAsRenderNodeER15RenderNodeQueue"
        "RK20DeprecatedSourceData",
    ),
    (
        "sort-input",
        "meshRendererProduce",
        "_ZN13ProduceHelperI12MeshRendererLb0EE7ProduceE10MemLabelId"
        "18ObjectCreationMode",
    ),
    (
        "sort-input",
        "prepareMeshRenderNodes",
        "_ZL22PrepareMeshRenderNodesILb0EEv"
        "R35RenderNodeQueuePrepareThreadContext",
    ),
    (
        "sort-input",
        "batchUsesShader",
        "_ZN34BatchRendererGroupInjectionContext15BatchUsesShader"
        "ERK7BatchIDRK6Shader",
    ),
)

ARCHITECTURE_CHANGES = (
    {
        "id": "localKeywordHash",
        "baselineSymbol": "_ZNK8keywords17LocalKeywordState7GetHashEv",
        "candidateStatus": "removed-or-inlined",
        "replacementBoundary":
            "candidate sortInputBuilder bytes and runtime sort key",
    },
    {
        "id": "qsortInternal",
        "baselineSymbolPrefix": "_ZN14qsort_internal",
        "candidateStatus": "implementation-replaced",
        "replacementSymbol":
            next(symbol for group, item, symbol in TARGETS
                 if item == "stdIntrosort"),
    },
)

PARTIAL_STATIC_SPECS = {
    "prepareCommand": {
        "method": "caller-edge-consensus",
        "callers": (
            (
                "_ZN23ScriptableRenderContext25PrepareRendererListsAsyncE"
                "PK12RendererListi",
                0x160,
            ),
            (
                "_ZN23ScriptableRenderContext27ExecuteScriptableRenderLoopEv",
                0x544,
            ),
        ),
        "expectedResidualOffsets": (0x120, 0x620),
    },
    "rendererListPrepare": {
        "method": "address-taken-callback-from-consensus-mapped-parent",
        "parent": "prepareCommand",
        "callbackOffset": 0x648,
        "expectedResidualOffsets": (0x84,),
    },
    "flattenLightProbeData": {
        "method": "caller-edge-consensus",
        "callers": (
            (
                "_ZL24PrepareSpriteRenderNodesILb0EEv"
                "R35RenderNodeQueuePrepareThreadContext",
                0x174,
            ),
            (
                "_ZN8Renderer15AddAsRenderNodeER15RenderNodeQueue"
                "RK20DeprecatedSourceData",
                0xEC,
            ),
            (
                "_ZN12BaseRenderer16FlattenProbeDataE4PPtrI9Transform"
                "ERisRK17LightProbeContextR10RenderNode",
                0x1C,
            ),
            (
                "_ZL22PrepareMeshRenderNodesILb0EEv"
                "R35RenderNodeQueuePrepareThreadContext",
                0x2D0,
            ),
        ),
        "expectedResidualOffsets": (0xBC,),
    },
}

PARTIAL_STATIC_IDS = tuple(PARTIAL_STATIC_SPECS)
SEMANTIC_STATIC_IDS = (
    "distanceKey",
    "getSortingGroupId",
    "getSortingGroupOrder",
    "getGlobalLayeringData",
    "getLightProbesCoefficientType",
)
SEMANTIC_STATIC_FACTS = {
    "distanceKey":
        "sorting-distance metric branches, float operations and field offsets",
    "getSortingGroupId":
        "BaseRenderer sorting-group id field load",
    "getSortingGroupOrder":
        "BaseRenderer sorting-group order field load",
    "getGlobalLayeringData":
        "BaseRenderer global layering-data field address",
    "getLightProbesCoefficientType":
        "light-probe coefficient-type decision tree and input values",
}
REQUIRED_EXACT_TARGET_OFFSETS = {
    "rendererListPrepare": {0x40, 0x58, 0x84},
    "flattenLightProbeData": {0x24, 0x80, 0xBC, 0xE4, 0x10C},
}
TEST_MUTATION = os.environ.get(
    "PCR_CANDIDATE_UNITY_NATIVE_TEST_MUTATION",
    "",
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--candidate-manifest", required=True)
    parser.add_argument("--split-root", required=True, type=Path)
    parser.add_argument("--release-player", required=True, type=Path)
    parser.add_argument("--release-symbols", required=True, type=Path)
    parser.add_argument("--installer", required=True, type=Path)
    args = parser.parse_args()
    for name in ("split_root", "release_player", "release_symbols", "installer"):
        value = getattr(args, name)
        if not value.exists():
            parser.error(f"{name.replace('_', '-')} not found: {value}")
    return args


def sha256(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def canonical_digest(value: object) -> str:
    return sha256(json.dumps(
        value,
        ensure_ascii=True,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("ascii"))


def identity(value: bytes) -> dict:
    return {"byteLength": len(value), "sha256": sha256(value)}


def verify_identity(label: str, value: bytes, expected: dict) -> None:
    actual = identity(value)
    wanted = {
        "byteLength": int(expected["byteLength"]),
        "sha256": expected["sha256"],
    }
    if actual != wanted:
        raise ValueError(f"{label} identity mismatch: {actual} != {wanted}")


class Elf64:
    def __init__(self, data: bytes, label: str):
        if data[:6] != b"\x7fELF\x02\x01":
            raise ValueError(f"{label}: expected little-endian ELF64")
        self.data = data
        self.label = label
        phoff = struct.unpack_from("<Q", data, 0x20)[0]
        phentsize = struct.unpack_from("<H", data, 0x36)[0]
        phnum = struct.unpack_from("<H", data, 0x38)[0]
        self.loads = []
        self.dynamic = None
        for index in range(phnum):
            values = struct.unpack_from(
                "<IIQQQQQQ",
                data,
                phoff + index * phentsize,
            )
            if values[0] == 1:
                self.loads.append({
                    "flags": values[1],
                    "fileOffset": values[2],
                    "virtualAddress": values[3],
                    "fileSize": values[5],
                })
            elif values[0] == 2:
                self.dynamic = {
                    "fileOffset": values[2],
                    "virtualAddress": values[3],
                    "fileSize": values[5],
                }

    def range(self, rva: int, size: int) -> bytes:
        for segment in self.loads:
            start = segment["virtualAddress"]
            if start <= rva and rva + size <= start + segment["fileSize"]:
                offset = segment["fileOffset"] + rva - start
                return self.data[offset:offset + size]
        raise ValueError(f"{self.label}: RVA {rva:#x}+{size:#x} is not file-backed")

    def executable_segments(self) -> list[tuple[int, bytes]]:
        return [
            (
                segment["virtualAddress"],
                self.data[
                    segment["fileOffset"]:
                    segment["fileOffset"] + segment["fileSize"]
                ],
            )
            for segment in self.loads
            if segment["flags"] & 1
        ]

    def relative_relocations(self) -> dict[int, int]:
        if self.dynamic is None:
            raise ValueError(f"{self.label}: PT_DYNAMIC is missing")
        values = {}
        start = self.dynamic["fileOffset"]
        end = start + self.dynamic["fileSize"]
        for offset in range(start, end, 16):
            tag, value = struct.unpack_from("<QQ", self.data, offset)
            if tag == 0:
                break
            values[tag] = value
        rela_rva = values.get(7)
        rela_size = values.get(8)
        rela_entry_size = values.get(9)
        if not rela_rva or not rela_size or rela_entry_size != 24:
            raise ValueError(f"{self.label}: unsupported DT_RELA layout")
        result = {}
        rela = self.range(rela_rva, rela_size)
        for offset in range(0, len(rela), rela_entry_size):
            target, info, addend = struct.unpack_from("<QQq", rela, offset)
            relocation_type = info & 0xFFFFFFFF
            symbol_index = info >> 32
            if relocation_type == 1027 and symbol_index == 0:
                result[target] = addend
        return result


def symbol_records(data: bytes) -> dict[str, dict]:
    section_offset = struct.unpack_from("<Q", data, 0x28)[0]
    entry_size = struct.unpack_from("<H", data, 0x3A)[0]
    count = struct.unpack_from("<H", data, 0x3C)[0]
    name_index = struct.unpack_from("<H", data, 0x3E)[0]
    sections = []
    for index in range(count):
        offset = section_offset + index * entry_size
        sections.append({
            "nameOffset": struct.unpack_from("<I", data, offset)[0],
            "fileOffset": struct.unpack_from("<Q", data, offset + 24)[0],
            "size": struct.unpack_from("<Q", data, offset + 32)[0],
            "link": struct.unpack_from("<I", data, offset + 40)[0],
            "entrySize": struct.unpack_from("<Q", data, offset + 56)[0],
        })
    names_section = sections[name_index]
    names = data[
        names_section["fileOffset"]:
        names_section["fileOffset"] + names_section["size"]
    ]
    for section in sections:
        end = names.find(b"\0", section["nameOffset"])
        section["name"] = names[section["nameOffset"]:end].decode("utf-8")
    symbols = next(section for section in sections
                   if section["name"] == ".symtab")
    strings_section = sections[symbols["link"]]
    strings = data[
        strings_section["fileOffset"]:
        strings_section["fileOffset"] + strings_section["size"]
    ]
    result = {}
    for offset in range(
        symbols["fileOffset"],
        symbols["fileOffset"] + symbols["size"],
        symbols["entrySize"],
    ):
        name_offset = struct.unpack_from("<I", data, offset)[0]
        end = strings.find(b"\0", name_offset)
        name = strings[name_offset:end].decode("utf-8", "replace")
        value, size = struct.unpack_from("<QQ", data, offset + 8)
        symbol_type = data[offset + 4] & 0x0F
        if name and value:
            result[name] = {
                "rva": value,
                "byteSize": size,
                "type": symbol_type,
            }
    return result


def function_symbols(data: bytes) -> dict[str, tuple[int, int]]:
    return {
        name: (record["rva"], record["byteSize"])
        for name, record in symbol_records(data).items()
        if record["type"] == 2 and record["byteSize"]
    }


def normalize_body(body: bytes) -> bytes:
    if len(body) % 4:
        raise ValueError("AArch64 function body is not word-aligned")
    result = bytearray(body)
    for offset in range(0, len(result), 4):
        word = struct.unpack_from("<I", result, offset)[0]
        if word & 0xFC000000 == 0x94000000:  # BL target
            word &= 0xFC000000
        elif word & 0x9F000000 == 0x90000000:  # ADRP page
            word &= 0x9F00001F
        elif word & 0x9F000000 == 0x10000000:  # ADR address
            word &= 0x9F00001F
        elif word & 0x3B000000 == 0x18000000:  # literal load address
            word &= 0xFF00001F
        elif word & 0x3B000000 == 0x39000000:  # load/store field offset
            word &= 0xFFC003FF
        elif word & 0x1F000000 == 0x11000000:  # ADD/SUB immediate
            word &= 0xFFC003FF
        struct.pack_into("<I", result, offset, word)
    return bytes(result)


def normalize_semantic_body(body: bytes) -> bytes:
    """Mask addresses only; preserve calls, branches and every field offset."""
    if len(body) % 4:
        raise ValueError("AArch64 function body is not word-aligned")
    result = bytearray(body)
    for offset in range(0, len(result), 4):
        word = struct.unpack_from("<I", result, offset)[0]
        if word & 0x9F000000 == 0x90000000:  # ADRP page
            word &= 0x9F00001F
        elif word & 0x9F000000 == 0x10000000:  # ADR address
            word &= 0x9F00001F
        elif word & 0x3B000000 == 0x18000000:  # literal load address
            word &= 0xFF00001F
        struct.pack_into("<I", result, offset, word)
    return bytes(result)


def find_aligned(haystack: bytes, needle: bytes) -> list[int]:
    found = []
    cursor = 0
    while True:
        cursor = haystack.find(needle, cursor)
        if cursor < 0:
            return found
        if cursor % 4 == 0:
            found.append(cursor)
        cursor += 4


def branch_target(instruction: bytes, address: int) -> int:
    word = struct.unpack("<I", instruction)[0]
    immediate = word & 0x03FFFFFF
    if immediate & 0x02000000:
        immediate -= 0x04000000
    return address + immediate * 4


def direct_branch_kind(word: int) -> str | None:
    if word & 0xFC000000 == 0x94000000:
        return "BL"
    if word & 0x7C000000 == 0x14000000:
        return "B"
    return None


def adr_target(instruction: bytes, address: int) -> int:
    word = struct.unpack("<I", instruction)[0]
    if word & 0x9F000000 != 0x10000000:
        raise ValueError(f"instruction at {address:#x} is not ADR")
    immediate = ((word >> 5) & 0x7FFFF) << 2
    immediate |= (word >> 29) & 0x3
    if immediate & (1 << 20):
        immediate -= 1 << 21
    return address + immediate


def symbol_names_at(
    symbols: dict[str, tuple[int, int]],
    address: int,
) -> list[tuple[str, int]]:
    return sorted(
        (
            (name, size)
            for name, (rva, size) in symbols.items()
            if rva == address
        ),
        key=lambda item: (item[0].startswith("$"), item[0]),
    )


def unique_normalized_location(
    game: Elf64,
    release: Elf64,
    symbols: dict[str, tuple[int, int]],
    normalized_game: list[tuple[int, bytes]],
    symbol: str,
) -> dict:
    if symbol not in symbols:
        raise ValueError(f"caller symbol is missing: {symbol}")
    release_rva, size = symbols[symbol]
    release_body = release.range(release_rva, size)
    shape = normalize_body(release_body)
    hits = []
    for base, segment in normalized_game:
        hits.extend(base + offset for offset in find_aligned(segment, shape))
    if len(hits) != 1:
        raise ValueError(
            f"{symbol}: expected one normalized candidate, found {len(hits)}"
        )
    game_rva = hits[0]
    game_body = game.range(game_rva, size)
    return {
        "symbol": symbol,
        "releaseRva": release_rva,
        "gameRva": game_rva,
        "byteSize": size,
        "releaseBodySha256": sha256(release_body),
        "gameBodySha256": sha256(game_body),
        "normalizedShapeSha256": sha256(shape),
    }


def prove_caller_edge_consensus(
    item_id: str,
    target_release_rva: int,
    callers: tuple[tuple[str, int], ...],
    game: Elf64,
    release: Elf64,
    symbols: dict[str, tuple[int, int]],
    normalized_game: list[tuple[int, bytes]],
) -> tuple[int, dict]:
    edges = []
    targets = []
    for index, (caller_symbol, declared_offset) in enumerate(callers):
        offset = declared_offset
        if (
            TEST_MUTATION == "caller-edge"
            and item_id == "prepareCommand"
            and index == 0
        ):
            offset += 4
        caller = unique_normalized_location(
            game,
            release,
            symbols,
            normalized_game,
            caller_symbol,
        )
        release_word = release.range(caller["releaseRva"] + offset, 4)
        game_word = game.range(caller["gameRva"] + offset, 4)
        release_kind = direct_branch_kind(struct.unpack("<I", release_word)[0])
        game_kind = direct_branch_kind(struct.unpack("<I", game_word)[0])
        if release_kind != "BL" or game_kind != "BL":
            raise ValueError(
                f"{item_id}: caller edge at {caller_symbol}+{offset:#x} "
                "is not a paired BL"
            )
        release_target = branch_target(
            release_word,
            caller["releaseRva"] + offset,
        )
        if release_target != target_release_rva:
            raise ValueError(
                f"{item_id}: release caller edge targets "
                f"{release_target:#x}, expected {target_release_rva:#x}"
            )
        game_target = branch_target(
            game_word,
            caller["gameRva"] + offset,
        )
        targets.append(game_target)
        edges.append({
            "callerSymbol": caller_symbol,
            "instructionOffset": offset,
            "instructionKind": "BL",
            "releaseCallerRva": f"0x{caller['releaseRva']:x}",
            "gameCallerRva": f"0x{caller['gameRva']:x}",
            "releaseTarget": f"0x{release_target:x}",
            "gameTarget": f"0x{game_target:x}",
            "releaseCallerBodySha256": caller["releaseBodySha256"],
            "gameCallerBodySha256": caller["gameBodySha256"],
            "callerNormalizedShapeSha256":
                caller["normalizedShapeSha256"],
        })
    unique = sorted(set(targets))
    if len(unique) != 1:
        raise ValueError(
            f"{item_id}: caller-edge targets disagree: "
            + ", ".join(f"{value:#x}" for value in unique)
        )
    return unique[0], {
        "method": "caller-edge-consensus",
        "status": "exact-static-location",
        "independentCallerCount": len(edges),
        "callerEdges": edges,
        "consensusGameRva": f"0x{unique[0]:x}",
        "proofSha256": canonical_digest(edges),
    }


def prove_callback_location(
    parent: dict,
    target_release_rva: int,
    offset: int,
    game: Elf64,
    release: Elf64,
) -> tuple[int, dict]:
    parent_release = int(parent["release"]["rva"], 16)
    parent_game = int(parent["game"]["rva"], 16)
    release_word = release.range(parent_release + offset, 4)
    game_word = game.range(parent_game + offset, 4)
    release_target = adr_target(release_word, parent_release + offset)
    game_target = adr_target(game_word, parent_game + offset)
    if release_target != target_release_rva:
        raise ValueError(
            "rendererListPrepare: release callback target changed"
        )
    evidence = {
        "method": "address-taken-callback-from-consensus-mapped-parent",
        "status": "exact-static-location",
        "parentId": parent["id"],
        "parentLocationProofSha256":
            parent["locationProof"]["proofSha256"],
        "instructionOffset": offset,
        "instructionKind": "ADR",
        "releaseTarget": f"0x{release_target:x}",
        "gameTarget": f"0x{game_target:x}",
    }
    evidence["proofSha256"] = canonical_digest(evidence)
    return game_target, evidence


def normalized_instruction_differences(
    release_body: bytes,
    game_body: bytes,
) -> list[int]:
    release_shape = normalize_body(release_body)
    game_shape = normalize_body(game_body)
    return [
        offset
        for offset in range(0, len(release_body), 4)
        if release_shape[offset:offset + 4] != game_shape[offset:offset + 4]
    ]


def raw_instruction_difference_count(
    release_body: bytes,
    game_body: bytes,
) -> int:
    return sum(
        release_body[offset:offset + 4] != game_body[offset:offset + 4]
        for offset in range(0, len(release_body), 4)
    )


def build_control_flow_proof(
    item_id: str,
    release_rva: int,
    game_rva: int,
    size: int,
    game: Elf64,
    release: Elf64,
    symbols: dict[str, tuple[int, int]],
) -> dict:
    release_body = release.range(release_rva, size)
    game_body = game.range(game_rva, size)
    expected = set(PARTIAL_STATIC_SPECS[item_id]["expectedResidualOffsets"])
    differences = normalized_instruction_differences(release_body, game_body)
    if set(differences) != expected:
        raise ValueError(
            f"{item_id}: normalized residual offsets "
            f"{[hex(value) for value in differences]} differ from "
            f"{[hex(value) for value in sorted(expected)]}"
        )
    edges = []
    unresolved_targets = []
    for offset in range(0, size, 4):
        release_word = struct.unpack_from("<I", release_body, offset)[0]
        game_word = struct.unpack_from("<I", game_body, offset)[0]
        release_kind = direct_branch_kind(release_word)
        game_kind = direct_branch_kind(game_word)
        if not release_kind and not game_kind:
            continue
        if item_id == "prepareCommand" and offset == 0x120:
            if release_kind is not None or game_kind != "B":
                raise ValueError(
                    "prepareCommand: linker-thunk transition changed"
                )
            edges.append({
                "instructionOffset": offset,
                "releaseKind": "direct-load",
                "gameKind": "B",
                "relation": "linker-thunk-rejoin",
                "status": "partial-exact-static",
            })
            continue
        if release_kind != game_kind:
            raise ValueError(
                f"{item_id}+{offset:#x}: direct branch kind changed "
                f"from {release_kind} to {game_kind}"
            )
        release_target = branch_target(
            release_body[offset:offset + 4],
            release_rva + offset,
        )
        game_target = branch_target(
            game_body[offset:offset + 4],
            game_rva + offset,
        )
        if (
            TEST_MUTATION == "branch-target"
            and item_id == "rendererListPrepare"
            and offset == 0x84
        ):
            game_target += 4
        release_internal = release_rva <= release_target < release_rva + size
        game_internal = game_rva <= game_target < game_rva + size
        edge = {
            "instructionOffset": offset,
            "instructionKind": release_kind,
            "releaseTarget": f"0x{release_target:x}",
            "gameTarget": f"0x{game_target:x}",
        }
        if release_internal or game_internal:
            if not release_internal or not game_internal:
                raise ValueError(
                    f"{item_id}+{offset:#x}: branch crossed function boundary"
                )
            release_offset = release_target - release_rva
            game_offset = game_target - game_rva
            if release_offset != game_offset:
                raise ValueError(
                    f"{item_id}+{offset:#x}: intra-function target changed"
                )
            edge.update({
                "relation": "intra-function-offset-exact",
                "targetOffset": release_offset,
                "status": "exact-static-control-flow",
            })
            edges.append(edge)
            continue
        names = symbol_names_at(symbols, release_target)
        if names:
            helper_size = names[0][1]
            release_helper = release.range(release_target, helper_size)
            game_helper = game.range(game_target, helper_size)
            helper_exact = (
                normalize_body(release_helper)
                == normalize_body(game_helper)
            )
            if (
                offset
                in REQUIRED_EXACT_TARGET_OFFSETS.get(item_id, set())
                and not helper_exact
            ):
                raise ValueError(
                    f"{item_id}+{offset:#x}: required helper target "
                    "shape changed"
                )
            edge.update({
                "releaseSymbols": [name for name, _ in names],
                "targetByteSize": helper_size,
                "releaseTargetBodySha256": sha256(release_helper),
                "gameTargetBodySha256": sha256(game_helper),
                "releaseTargetNormalizedShapeSha256":
                    sha256(normalize_body(release_helper)),
                "gameTargetNormalizedShapeSha256":
                    sha256(normalize_body(game_helper)),
                "relation":
                    "normalized-target-shape-exact"
                    if helper_exact
                    else "corresponding-edge-target-body-changed",
                "status":
                    "exact-static-control-flow"
                    if helper_exact
                    else "partial-exact-static",
            })
            if not helper_exact:
                unresolved_targets.append({
                    "instructionOffset": offset,
                    "releaseSymbols": [name for name, _ in names],
                    "reason":
                        "candidate helper target body differs after "
                        "relocation normalization",
                })
            edges.append(edge)
            continue
        window_size = 16
        release_window = release.range(release_target, window_size)
        game_window = game.range(game_target, window_size)
        window_exact = (
            normalize_body(release_window)
            == normalize_body(game_window)
        )
        edge.update({
            "targetWindowByteSize": window_size,
            "releaseTargetWindowSha256": sha256(release_window),
            "gameTargetWindowSha256": sha256(game_window),
            "relation":
                "anonymous-target-window-shape-exact"
                if window_exact
                else "anonymous-target-address-only",
            "status":
                "exact-static-control-flow"
                if window_exact
                else "partial-exact-static",
        })
        if not window_exact:
            unresolved_targets.append({
                "instructionOffset": offset,
                "reason":
                    "anonymous external target window differs after "
                    "relocation normalization",
            })
        edges.append(edge)
    proof = {
        "status": "partial-exact-static",
        "globalBranchImmediateMasking": False,
        "allDirectBranchesClassified": True,
        "instructionCount": size // 4,
        "rawInstructionDifferenceCount":
            raw_instruction_difference_count(release_body, game_body),
        "normalizedResidualOffsets": differences,
        "directBranchCount": len(edges),
        "edges": edges,
        "remainingStaticTargetSemantics": unresolved_targets,
    }
    proof["proofSha256"] = canonical_digest(proof)
    return proof


def branch_edges(elf: Elf64, start: int, size: int) -> list[dict]:
    body = elf.range(start, size)
    result = []
    for offset in range(0, size, 4):
        word = struct.unpack_from("<I", body, offset)[0]
        if word & 0xFC000000 != 0x94000000:
            continue
        result.append({
            "offset": offset,
            "target": branch_target(body[offset:offset + 4], start + offset),
        })
    return result


def disassemble(elf: Elf64, start: int, size: int) -> list[dict]:
    decoder = Cs(CS_ARCH_ARM64, CS_MODE_ARM)
    result = [
        {
            "address": instruction.address,
            "offset": instruction.address - start,
            "mnemonic": instruction.mnemonic,
            "operands": instruction.op_str,
        }
        for instruction in decoder.disasm(elf.range(start, size), start)
    ]
    if len(result) * 4 != size:
        raise ValueError(f"disassembly did not consume {size} bytes at {start:#x}")
    return result


def instruction_by_offset(instructions: list[dict], offset: int) -> dict:
    matches = [
        instruction
        for instruction in instructions
        if instruction["offset"] == offset
    ]
    if len(matches) != 1:
        raise ValueError(f"instruction offset {offset:#x} is not unique")
    return matches[0]


def parse_adrp_page(instruction: dict, register: str) -> int:
    if instruction["mnemonic"] != "adrp":
        raise ValueError(
            f"expected ADRP at +{instruction['offset']:#x}"
        )
    match = re.fullmatch(
        rf"{re.escape(register)}, #0x([0-9a-f]+)",
        instruction["operands"],
    )
    if not match:
        raise ValueError(
            f"unexpected ADRP operands: {instruction['operands']}"
        )
    return int(match.group(1), 16)


def parse_load_offset(
    instruction: dict,
    destination: str,
    base: str,
) -> int:
    if instruction["mnemonic"] != "ldr":
        raise ValueError(
            f"expected LDR at +{instruction['offset']:#x}"
        )
    match = re.fullmatch(
        rf"{re.escape(destination)}, "
        rf"\[{re.escape(base)}(?:, #0x([0-9a-f]+))?\]",
        instruction["operands"],
    )
    if not match:
        raise ValueError(
            f"unexpected LDR operands: {instruction['operands']}"
        )
    return int(match.group(1) or "0", 16)


def parse_add_offset(
    instruction: dict,
    destination: str,
    base: str,
) -> int:
    if instruction["mnemonic"] != "add":
        raise ValueError(
            f"expected ADD at +{instruction['offset']:#x}"
        )
    match = re.fullmatch(
        rf"{re.escape(destination)}, {re.escape(base)}, #0x([0-9a-f]+)",
        instruction["operands"],
    )
    if not match:
        raise ValueError(
            f"unexpected ADD operands: {instruction['operands']}"
        )
    return int(match.group(1), 16)


def require_relative_relocation(
    relocations: dict[int, int],
    slot: int,
    label: str,
) -> int:
    if slot not in relocations:
        raise ValueError(
            f"{label}: R_AARCH64_RELATIVE missing at {slot:#x}"
        )
    return relocations[slot]


def require_object_symbol(
    symbols: dict[str, dict],
    name: str,
    address: int,
) -> dict:
    record = symbols.get(name)
    if (
        record is None
        or record["type"] != 1
        or record["rva"] != address
    ):
        raise ValueError(
            f"release object symbol {name} does not bind {address:#x}"
        )
    return record


def build_prepare_linkage_proof(
    release_rva: int,
    game_rva: int,
    game: Elf64,
    release: Elf64,
    all_symbols: dict[str, dict],
) -> list[dict]:
    release_instructions = disassemble(release, release_rva, 0x68C)
    game_instructions = disassemble(game, game_rva, 0x68C)
    release_relocations = release.relative_relocations()
    game_relocations = game.relative_relocations()

    release_page = parse_adrp_page(
        instruction_by_offset(release_instructions, 0x118),
        "x24",
    )
    release_slot = release_page + parse_load_offset(
        instruction_by_offset(release_instructions, 0x120),
        "x24",
        "x24",
    )
    game_page = parse_adrp_page(
        instruction_by_offset(game_instructions, 0x118),
        "x24",
    )
    thunk_branch = instruction_by_offset(game_instructions, 0x120)
    if thunk_branch["mnemonic"] != "b":
        raise ValueError("prepareCommand: expected linker thunk branch")
    thunk_target = int(thunk_branch["operands"].removeprefix("#"), 16)
    thunk_instructions = disassemble(game, thunk_target, 8)
    game_slot = game_page + parse_load_offset(
        thunk_instructions[0],
        "x24",
        "x24",
    )
    if thunk_instructions[1]["mnemonic"] != "b":
        raise ValueError("prepareCommand: thunk does not end in B")
    actual_rejoin = int(
        thunk_instructions[1]["operands"].removeprefix("#"),
        16,
    )
    expected_rejoin = game_rva + 0x124
    if TEST_MUTATION == "thunk-rejoin":
        expected_rejoin += 4
    if actual_rejoin != expected_rejoin:
        raise ValueError(
            "prepareCommand: linker thunk rejoin offset changed"
        )
    release_addend = require_relative_relocation(
        release_relocations,
        release_slot,
        "prepareCommand release object map",
    )
    game_addend = require_relative_relocation(
        game_relocations,
        game_slot,
        "prepareCommand candidate object map",
    )
    release_object = require_object_symbol(
        all_symbols,
        "_ZN6Object14ms_IDToPointerE",
        release_addend,
    )
    object_map = {
        "id": "object-id-map",
        "sourceOffset": 0x120,
        "status": "partial-exact-static",
        "release": {
            "gotSlot": f"0x{release_slot:x}",
            "relocationType": "R_AARCH64_RELATIVE",
            "addend": f"0x{release_addend:x}",
            "symbol": "_ZN6Object14ms_IDToPointerE",
            "symbolByteSize": release_object["byteSize"],
        },
        "game": {
            "thunkRva": f"0x{thunk_target:x}",
            "thunkByteSize": 8,
            "thunkBodySha256": sha256(game.range(thunk_target, 8)),
            "rejoinOffset": actual_rejoin - game_rva,
            "gotSlot": f"0x{game_slot:x}",
            "relocationType": "R_AARCH64_RELATIVE",
            "addend": f"0x{game_addend:x}",
            "candidateSemanticSymbol": None,
            "candidateSemanticStatus": "unresolved",
        },
        "proved":
            "paired ADRP/load linkage, relative relocation and exact "
            "thunk rejoin",
        "remainingSemantics":
            "stripped candidate global identity and live object-map contents",
    }

    release_manager_page = parse_adrp_page(
        instruction_by_offset(release_instructions, 0x61C),
        "x8",
    )
    release_manager = release_manager_page + parse_add_offset(
        instruction_by_offset(release_instructions, 0x620),
        "x8",
        "x8",
    )
    game_manager_page = parse_adrp_page(
        instruction_by_offset(game_instructions, 0x61C),
        "x8",
    )
    game_manager_slot = game_manager_page + parse_load_offset(
        instruction_by_offset(game_instructions, 0x620),
        "x8",
        "x8",
    )
    manager_addend = require_relative_relocation(
        game_relocations,
        game_manager_slot,
        "prepareCommand candidate renderer manager",
    )
    manager_object = require_object_symbol(
        all_symbols,
        "gRendererUpdateManager",
        release_manager,
    )
    release_window = normalize_body(
        release.range(release_rva + 0x624, 16)
    )
    game_window = normalize_body(game.range(game_rva + 0x624, 16))
    if release_window != game_window:
        raise ValueError(
            "prepareCommand: renderer manager post-load dataflow changed"
        )
    renderer_manager = {
        "id": "renderer-update-manager",
        "sourceOffset": 0x620,
        "status": "partial-exact-static",
        "release": {
            "directObjectRva": f"0x{release_manager:x}",
            "symbol": "gRendererUpdateManager",
            "symbolByteSize": manager_object["byteSize"],
        },
        "game": {
            "gotSlot": f"0x{game_manager_slot:x}",
            "relocationType": "R_AARCH64_RELATIVE",
            "addend": f"0x{manager_addend:x}",
            "candidateSemanticSymbol": None,
            "candidateSemanticStatus": "unresolved",
        },
        "postLoadWindowOffset": 0x624,
        "postLoadWindowByteSize": 16,
        "postLoadNormalizedShapeSha256": sha256(release_window),
        "proved":
            "release direct object address and candidate relative-relocation "
            "load feed the same normalized post-load dataflow",
        "remainingSemantics":
            "stripped candidate global identity and live manager instance",
    }
    if TEST_MUTATION == "promote-stripped-global":
        object_map["game"]["candidateSemanticStatus"] = "exact"
        object_map["game"]["candidateSemanticSymbol"] = (
            "_ZN6Object14ms_IDToPointerE"
        )
    for proof in (object_map, renderer_manager):
        proof["proofSha256"] = canonical_digest(proof)
    return [object_map, renderer_manager]


def validate_partial_static_invariants(
    records: list[dict],
    summary: dict,
    runtime_boundaries: list[dict],
) -> None:
    by_id = {record["id"]: record for record in records}
    for item_id in PARTIAL_STATIC_IDS:
        record = by_id[item_id]
        if record["status"] != "partial-exact-static":
            raise ValueError(f"{item_id}: conservative status was promoted")
        if record["locationProof"]["status"] != "exact-static-location":
            raise ValueError(f"{item_id}: location proof is not closed")
        control = record["controlFlowProof"]
        if (
            control["status"] != "partial-exact-static"
            or control["globalBranchImmediateMasking"] is not False
            or control["allDirectBranchesClassified"] is not True
        ):
            raise ValueError(f"{item_id}: branch-aware proof is incomplete")
        if not record["remainingRuntimeSemantics"]:
            raise ValueError(
                f"{item_id}: remaining runtime semantics are missing"
            )
    prepare = by_id["prepareCommand"]
    linkage = prepare.get("linkageProof", [])
    if [item["id"] for item in linkage] != [
        "object-id-map",
        "renderer-update-manager",
    ]:
        raise ValueError("prepareCommand: linkage proof set changed")
    for item in linkage:
        game_evidence = item["game"]
        if (
            game_evidence["candidateSemanticStatus"] != "unresolved"
            or game_evidence["candidateSemanticSymbol"] is not None
        ):
            raise ValueError(
                "prepareCommand: stripped candidate global was promoted"
            )
    if summary["sortSemanticExactCount"] != len(SEMANTIC_STATIC_IDS):
        raise ValueError("sort semantic exact denominator changed")
    for item_id in SEMANTIC_STATIC_IDS:
        proof = by_id[item_id].get("semanticStaticProof")
        if (
            proof is None
            or proof["status"] != "exact-static-semantic-shape"
            or proof["releaseShapeSha256"] != proof["gameShapeSha256"]
            or proof["preservesLoadStoreOffsets"] is not True
            or proof["preservesAddSubImmediates"] is not True
            or proof["preservesDirectCalls"] is not True
            or proof["proofSha256"] != canonical_digest({
                key: value
                for key, value in proof.items()
                if key != "proofSha256"
            })
        ):
            raise ValueError(
                f"{item_id}: exact static semantic proof changed"
            )
    if summary["partialExactStaticFunctionCount"] != len(
        PARTIAL_STATIC_IDS
    ):
        raise ValueError("partial-exact-static denominator changed")
    if (
        summary["exactStaticControlFlowEdgeCount"]
        + summary["partialStaticControlFlowEdgeCount"]
        != summary["partialStaticDirectBranchCount"]
    ):
        raise ValueError("partial static control-flow denominator changed")
    if summary["unresolvedStrippedGlobalCount"] != len(linkage):
        raise ValueError("stripped-global unresolved denominator changed")
    boundary_ids = {
        boundary["id"]
        for boundary in runtime_boundaries
        if boundary["status"] == "runtime-required"
    }
    required_boundaries = {
        "sort-structure-and-field-semantics",
        "sort-runtime-identities",
        "sort-job-scheduling-and-output",
        "prepare-command-stripped-globals",
        "light-probe-runtime-context",
    }
    missing = sorted(required_boundaries - boundary_ids)
    if missing:
        raise ValueError(
            "candidate native runtime boundaries missing: "
            + ", ".join(missing)
        )


def call_windows(
    instructions: list[dict],
    target: int,
    width: int = 5,
) -> list[dict]:
    result = []
    for index, instruction in enumerate(instructions):
        if instruction["mnemonic"] != "bl":
            continue
        match = re.fullmatch(r"#0x([0-9a-f]+)", instruction["operands"])
        if not match or int(match.group(1), 16) != target:
            continue
        window = instructions[max(0, index - width):index + 1]
        result.append({
            "offset": instruction["offset"],
            "instructions": [
                f"{item['mnemonic']} {item['operands']}".strip()
                for item in window
            ],
        })
    return result


def has_suffix(window: dict, expected: list[str]) -> bool:
    return window["instructions"][-len(expected):] == expected


def derive_deferred_resume_flag(
    resume_instructions: list[dict],
    loop_instructions: list[dict],
) -> dict:
    resume_candidates = []
    for index, instruction in enumerate(resume_instructions):
        if instruction["mnemonic"] != "strb":
            continue
        match = re.fullmatch(
            r"w(\d+), \[x(\d+), #0x([0-9a-f]+)\]",
            instruction["operands"],
        )
        if not match:
            continue
        register = match.group(1)
        base = match.group(2)
        prior = resume_instructions[max(0, index - 4):index]
        page = next((
            int(item["operands"].split("#0x", 1)[1], 16)
            for item in reversed(prior)
            if item["mnemonic"] == "adrp"
            and item["operands"].startswith(f"x{base}, #0x")
        ), None)
        writes_one = any(
            item["mnemonic"] == "mov"
            and item["operands"] == f"w{register}, #1"
            for item in prior
        )
        if page is not None and writes_one:
            resume_candidates.append({
                "address": page + int(match.group(3), 16),
                "storeOffset": instruction["offset"],
            })
    if len(resume_candidates) != 1:
        raise ValueError("candidate nativeResume deferred flag is not unique")
    selected = resume_candidates[0]
    loop_loads = []
    for index, instruction in enumerate(loop_instructions):
        if instruction["mnemonic"] != "ldrb":
            continue
        match = re.fullmatch(
            r"w\d+, \[x(\d+), #0x([0-9a-f]+)\]",
            instruction["operands"],
        )
        if not match:
            continue
        base = match.group(1)
        prior = loop_instructions[max(0, index - 3):index]
        page = next((
            int(item["operands"].split("#0x", 1)[1], 16)
            for item in reversed(prior)
            if item["mnemonic"] == "adrp"
            and item["operands"].startswith(f"x{base}, #0x")
        ), None)
        if page is not None and page + int(match.group(2), 16) == selected["address"]:
            loop_loads.append(instruction["offset"])
    if len(loop_loads) != 1:
        raise ValueError("UnityPlayerLoop deferred flag consumer is not unique")
    return {
        "address": f"0x{selected['address']:x}",
        "nativeResumeStoreOffset": selected["storeOffset"],
        "unityPlayerLoopLoadOffset": loop_loads[0],
        "value": 1,
    }


def extract(args: argparse.Namespace) -> dict:
    loaded = load_official_sample(args.candidate_manifest)
    sample = loaded["sample"]
    if sample["status"] != "candidate":
        raise ValueError("candidate sample required")
    split_name = sample["game"]["packageSource"]["splits"]["arm64Split"]
    split_path = args.split_root / split_name
    split_bytes = split_path.read_bytes()
    verify_identity("arm64 split", split_bytes, sample["artifacts"]["arm64Split"])
    with zipfile.ZipFile(split_path) as archive:
        game_bytes = archive.read(LIBUNITY_ENTRY)
    release_bytes = args.release_player.read_bytes()
    symbol_bytes = args.release_symbols.read_bytes()
    installer_bytes = args.installer.read_bytes()
    verify_identity("game libunity", game_bytes, sample["artifacts"]["libunity"])
    verify_identity(
        "Unity release player",
        release_bytes,
        sample["artifacts"]["unityReleasePlayer"],
    )
    verify_identity(
        "Unity release symbols",
        symbol_bytes,
        sample["artifacts"]["unityReleaseSymbols"],
    )
    source = sample["artifacts"]["unityReleasePlayer"]["source"]
    verify_identity("Unity installer", installer_bytes, {
        "byteLength": source["installerByteLength"],
        "sha256": source["installerSha256"],
    })
    version = sample["unity"]["releaseSupportVersion"].encode("ascii")
    if version not in release_bytes:
        raise ValueError("release player build identity string is missing")

    game = Elf64(game_bytes, "candidate game libunity")
    release = Elf64(release_bytes, "Unity release player")
    all_symbols = symbol_records(symbol_bytes)
    symbols = {
        name: (record["rva"], record["byteSize"])
        for name, record in all_symbols.items()
        if record["type"] == 2 and record["byteSize"]
    }
    normalized_game = [
        (rva, normalize_body(body))
        for rva, body in game.executable_segments()
    ]
    records = []
    by_id = {}
    for group, item_id, symbol in TARGETS:
        if symbol not in symbols:
            record = {
                "group": group,
                "id": item_id,
                "symbol": symbol,
                "status": "release-symbol-missing",
            }
            records.append(record)
            by_id[item_id] = record
            continue
        release_rva, size = symbols[symbol]
        release_body = release.range(release_rva, size)
        normalized = normalize_body(release_body)
        hits = []
        for base, segment in normalized_game:
            hits.extend(base + offset for offset in find_aligned(segment, normalized))
        record = {
            "group": group,
            "id": item_id,
            "symbol": symbol,
            "release": {
                "rva": f"0x{release_rva:x}",
                "byteSize": size,
                "bodySha256": sha256(release_body),
                "normalizedShapeSha256": sha256(normalized),
            },
            "status":
                "exact-normalized-instruction-shape"
                if len(hits) == 1
                else "bytes-changed"
                if len(hits) == 0
                else "ambiguous-normalized-instruction-shape",
            "candidateHitCount": len(hits),
            "candidateHits": [f"0x{value:x}" for value in hits],
        }
        if len(hits) == 1:
            game_body = game.range(hits[0], size)
            record["game"] = {
                "rva": f"0x{hits[0]:x}",
                "byteSize": size,
                "bodySha256": sha256(game_body),
                "wholeBodyExact": game_body == release_body,
            }
        records.append(record)
        by_id[item_id] = record

    # Tiny accessors are shape-ambiguous. Bind them through calls from already
    # uniquely mapped official functions, then recheck their full shape.
    for target_id in ("GetPlayerPause", "SetPlayerPauseDirect"):
        target = by_id[target_id]
        release_rva = int(target["release"]["rva"], 16)
        target_size = target["release"]["byteSize"]
        target_shape = normalize_body(release.range(release_rva, target_size))
        candidates = []
        edges = []
        for caller in records:
            if "game" not in caller:
                continue
            caller_release = int(caller["release"]["rva"], 16)
            caller_game = int(caller["game"]["rva"], 16)
            for edge in branch_edges(
                release,
                caller_release,
                caller["release"]["byteSize"],
            ):
                if edge["target"] != release_rva:
                    continue
                game_word = game.range(caller_game + edge["offset"], 4)
                game_target = branch_target(
                    game_word,
                    caller_game + edge["offset"],
                )
                if normalize_body(game.range(game_target, target_size)) != target_shape:
                    raise ValueError(
                        f"{target_id}: caller edge target shape differs"
                    )
                candidates.append(game_target)
                edges.append({
                    "caller": caller["id"],
                    "callerOffset": edge["offset"],
                    "gameTarget": f"0x{game_target:x}",
                })
        unique = sorted(set(candidates))
        if len(unique) != 1:
            raise ValueError(f"{target_id}: caller-edge mapping is not unique")
        game_rva = unique[0]
        game_body = game.range(game_rva, target_size)
        target.update({
            "status": "exact-normalized-shape-via-caller-edges",
            "candidateHitCount": 1,
            "candidateHits": [f"0x{game_rva:x}"],
            "game": {
                "rva": f"0x{game_rva:x}",
                "byteSize": target_size,
                "bodySha256": sha256(game_body),
                "wholeBodyExact": game_body
                    == release.range(release_rva, target_size),
            },
            "callerEdges": edges,
        })

    remaining_runtime_semantics = {
        "prepareCommand": [
            "candidate stripped-global semantic identities and live contents",
            "DrawRenderersCommand field semantics and runtime values",
            "JobBatchDispatcher fence and callback execution",
        ],
        "rendererListPrepare": [
            "ScriptableRenderContextArg field semantics and runtime values",
            "RenderNode sorting criteria and produced object-data values",
            "scheduled job execution order and fence completion",
        ],
        "flattenLightProbeData": [
            "RenderNode field semantic names and versioned layout",
            "Transform PPtr resolution and LightProbeContext live contents",
            "probe anchor, coefficient and sampling-coordinate outputs",
        ],
    }
    for target_id in ("prepareCommand", "flattenLightProbeData"):
        record = by_id[target_id]
        release_rva = int(record["release"]["rva"], 16)
        game_rva, location_proof = prove_caller_edge_consensus(
            target_id,
            release_rva,
            PARTIAL_STATIC_SPECS[target_id]["callers"],
            game,
            release,
            symbols,
            normalized_game,
        )
        size = record["release"]["byteSize"]
        game_body = game.range(game_rva, size)
        record.update({
            "status": "partial-exact-static",
            "candidateHitCount": 1,
            "candidateHits": [f"0x{game_rva:x}"],
            "game": {
                "rva": f"0x{game_rva:x}",
                "byteSize": size,
                "bodySha256": sha256(game_body),
                "normalizedShapeSha256":
                    sha256(normalize_body(game_body)),
                "wholeBodyExact":
                    game_body == release.range(release_rva, size),
            },
            "locationProof": location_proof,
            "controlFlowProof": build_control_flow_proof(
                target_id,
                release_rva,
                game_rva,
                size,
                game,
                release,
                symbols,
            ),
            "remainingRuntimeSemantics":
                remaining_runtime_semantics[target_id],
        })
        if target_id == "prepareCommand":
            record["linkageProof"] = build_prepare_linkage_proof(
                release_rva,
                game_rva,
                game,
                release,
                all_symbols,
            )

    renderer_record = by_id["rendererListPrepare"]
    renderer_release_rva = int(
        renderer_record["release"]["rva"],
        16,
    )
    renderer_game_rva, renderer_location = prove_callback_location(
        by_id["prepareCommand"],
        renderer_release_rva,
        PARTIAL_STATIC_SPECS["rendererListPrepare"]["callbackOffset"],
        game,
        release,
    )
    renderer_size = renderer_record["release"]["byteSize"]
    renderer_game_body = game.range(renderer_game_rva, renderer_size)
    renderer_record.update({
        "status": "partial-exact-static",
        "candidateHitCount": 1,
        "candidateHits": [f"0x{renderer_game_rva:x}"],
        "game": {
            "rva": f"0x{renderer_game_rva:x}",
            "byteSize": renderer_size,
            "bodySha256": sha256(renderer_game_body),
            "normalizedShapeSha256":
                sha256(normalize_body(renderer_game_body)),
            "wholeBodyExact":
                renderer_game_body
                == release.range(renderer_release_rva, renderer_size),
        },
        "locationProof": renderer_location,
        "controlFlowProof": build_control_flow_proof(
            "rendererListPrepare",
            renderer_release_rva,
            renderer_game_rva,
            renderer_size,
            game,
            release,
            symbols,
        ),
        "remainingRuntimeSemantics":
            remaining_runtime_semantics["rendererListPrepare"],
    })

    for item_id in SEMANTIC_STATIC_IDS:
        record = by_id[item_id]
        release_body = release.range(
            int(record["release"]["rva"], 16),
            record["release"]["byteSize"],
        )
        game_body = game.range(
            int(record["game"]["rva"], 16),
            record["game"]["byteSize"],
        )
        release_shape = normalize_semantic_body(release_body)
        game_shape = normalize_semantic_body(game_body)
        if release_shape != game_shape:
            raise ValueError(
                f"{item_id}: relocation-only semantic shape differs"
            )
        proof = {
            "status": "exact-static-semantic-shape",
            "normalization":
                "mask ADRP/ADR/literal addresses only; preserve BL/B, "
                "load-store offsets and ADD/SUB immediates",
            "releaseShapeSha256": sha256(release_shape),
            "gameShapeSha256": sha256(game_shape),
            "byteSize": len(release_shape),
            "preservesLoadStoreOffsets": True,
            "preservesAddSubImmediates": True,
            "preservesDirectCalls": True,
            "proved": SEMANTIC_STATIC_FACTS[item_id],
            "remaining":
                "live guest inputs and the produced per-frame sort output",
        }
        proof["proofSha256"] = canonical_digest(proof)
        record["semanticStaticProof"] = proof
    if TEST_MUTATION == "sort-semantic-shape-drift":
        by_id[SEMANTIC_STATIC_IDS[0]][
            "semanticStaticProof"
        ]["gameShapeSha256"] = "0" * 64

    lifecycle_ids = [
        item_id for group, item_id, _ in TARGETS if group == "lifecycle"
    ]
    lifecycle = {item_id: by_id[item_id] for item_id in lifecycle_ids}
    if not all("game" in record for record in lifecycle.values()):
        raise ValueError("candidate lifecycle function mapping is incomplete")
    instructions = {
        item_id: disassemble(
            game,
            int(record["game"]["rva"], 16),
            record["game"]["byteSize"],
        )
        for item_id, record in lifecycle.items()
    }
    rvas = {
        item_id: int(record["game"]["rva"], 16)
        for item_id, record in lifecycle.items()
    }
    pause_calls = call_windows(
        instructions["nativePause"],
        rvas["UnityPause"],
    )
    loop_pause_calls = call_windows(
        instructions["UnityPlayerLoop"],
        rvas["UnityPause"],
    )
    set_pause_calls = call_windows(
        instructions["UnityPause"],
        rvas["SetPlayerPause"],
    )
    direct_calls = call_windows(
        instructions["SetPlayerPause"],
        rvas["SetPlayerPauseDirect"],
    )
    if len(pause_calls) != 1 or not has_suffix(
        pause_calls[0],
        ["mov w0, #1", f"bl #0x{rvas['UnityPause']:x}"],
    ):
        raise ValueError("nativePause -> UnityPause(1) contract changed")
    if len(loop_pause_calls) != 1 or not has_suffix(
        loop_pause_calls[0],
        ["mov w0, #2", f"bl #0x{rvas['UnityPause']:x}"],
    ):
        raise ValueError("UnityPlayerLoop -> UnityPause(2) contract changed")
    expected_set_pause = (
        ["mov w0, #2", "mov w1, #1", f"bl #0x{rvas['SetPlayerPause']:x}"],
        ["mov w0, wzr", "mov w1, #1", f"bl #0x{rvas['SetPlayerPause']:x}"],
    )
    if len(set_pause_calls) != 2 or not all(
        has_suffix(window, suffix)
        for window, suffix in zip(set_pause_calls, expected_set_pause)
    ):
        raise ValueError("UnityPause SetPlayerPause state transitions changed")
    if len(direct_calls) != 1 or not has_suffix(
        direct_calls[0],
        ["mov w0, w19", f"bl #0x{rvas['SetPlayerPauseDirect']:x}"],
    ):
        raise ValueError("SetPlayerPause direct commit changed")
    deferred_flag = derive_deferred_resume_flag(
        instructions["nativeResume"],
        instructions["UnityPlayerLoop"],
    )

    mapped = [record for record in records if "game" in record]
    partial_static_records = [
        by_id[item_id]
        for item_id in PARTIAL_STATIC_IDS
    ]
    direct_branch_count = sum(
        record["controlFlowProof"]["directBranchCount"]
        for record in partial_static_records
    )
    exact_control_flow_edge_count = sum(
        edge["status"] == "exact-static-control-flow"
        for record in partial_static_records
        for edge in record["controlFlowProof"]["edges"]
    )
    summary = {
        "targetFunctionCount": len(records),
        "mappedFunctionCount": len(mapped),
        "unmappedFunctionCount": len(records) - len(mapped),
        "lifecycleFunctionCount": len(lifecycle_ids),
        "exactLifecycleFunctionCount": len(lifecycle),
        "partialExactStaticFunctionCount": len(PARTIAL_STATIC_IDS),
        "exactStaticLocationFunctionCount": len(PARTIAL_STATIC_IDS),
        "partialStaticDirectBranchCount": direct_branch_count,
        "exactStaticControlFlowEdgeCount":
            exact_control_flow_edge_count,
        "partialStaticControlFlowEdgeCount":
            direct_branch_count - exact_control_flow_edge_count,
        "unresolvedStrippedGlobalCount": 2,
        "sortSemanticExactCount": len(SEMANTIC_STATIC_IDS),
    }
    if TEST_MUTATION == "sort-semantic-count-drift":
        summary["sortSemanticExactCount"] += 1
    runtime_boundaries = [
        {
            "id": "sort-structure-and-field-semantics",
            "status": "runtime-required",
            "reason":
                "five address-relocation-only native functions prove "
                "sorting-distance and getter field semantics, but "
                "sortInputBuilder, comparator inputs, RenderNode, "
                "DrawRenderersCommand and ScriptableLoopObjectData live "
                "values remain unproved",
        },
        {
            "id": "sort-runtime-identities",
            "status": "runtime-required",
            "reason":
                "Material InstanceID, SmallMeshID and visible-node queue "
                "indices remain guest runtime values",
        },
        {
            "id": "sort-job-scheduling-and-output",
            "status": "runtime-required",
            "reason":
                "static callback and helper edges do not prove guest job "
                "fence completion, callback execution order or produced "
                "sort output",
        },
        {
            "id": "prepare-command-stripped-globals",
            "status": "runtime-required",
            "reason":
                "candidate R_AARCH64_RELATIVE addends are hash-bound, but "
                "the stripped object-map and renderer-manager identities "
                "and live contents remain unresolved",
        },
        {
            "id": "light-probe-runtime-context",
            "status": "runtime-required",
            "reason":
                "static helper topology does not prove Transform PPtr "
                "resolution, LightProbeContext contents, anchor state or "
                "sampling-coordinate outputs",
        },
        {
            "id": "input-subsystem-callback-state",
            "status": "runtime-required",
            "reason":
                "native lifecycle mapping does not prove the guest input "
                "event stream or app foreground state",
        },
    ]
    validate_partial_static_invariants(
        records,
        summary,
        runtime_boundaries,
    )
    proof_mapping = [
        {
            "id": record["id"],
            "symbol": record["symbol"],
            "status": record["status"],
            "release": record.get("release"),
            "game": record.get("game"),
            "locationProof": record.get("locationProof"),
            "controlFlowProof": record.get("controlFlowProof"),
            "linkageProof": record.get("linkageProof"),
            "remainingRuntimeSemantics":
                record.get("remainingRuntimeSemantics"),
        }
        for record in records
    ]
    output = {
        "schema": "pocket-card-render/candidate-unity-native-extraction@1",
        "schemaVersion": 1,
        "candidate": {
            "sampleId": sample["sampleId"],
            "sampleManifestSha256": loaded["sampleManifestSha256"],
            "gameVersion": sample["game"]["versionName"],
            "unityVersion": sample["unity"]["serializedVersion"],
            "playerBuildVersion": sample["unity"]["playerBuildVersion"],
            "releaseSupportVersion": sample["unity"]["releaseSupportVersion"],
        },
        "sources": {
            "arm64Split": identity(split_bytes),
            "gameLibunity": identity(game_bytes),
            "releaseInstaller": identity(installer_bytes),
            "releasePlayer": identity(release_bytes),
            "releaseSymbols": identity(symbol_bytes),
        },
        "mapping": {
            "normalization":
                "mask BL/ADR/ADRP/literal-address/load-store-offset/"
                "ADD-SUB-immediate fields for initial relocation only; "
                "preserve unconditional B and require target-specific "
                "branch/thunk/linkage proof for partial-exact-static records",
            "partialStaticProofModel": {
                "status": "partial-exact-static",
                "location":
                    "caller-edge consensus or address-taken callback from "
                    "a consensus-mapped parent",
                "controlFlow":
                    "classify every direct B/BL; bind internal offsets and "
                    "external target bodies without globally masking B",
                "linkage":
                    "bind GOT slots, R_AARCH64_RELATIVE addends, thunk body "
                    "and rejoin while leaving stripped globals unresolved",
            },
            "records": records,
            "architectureChanges": ARCHITECTURE_CHANGES,
        },
        "lifecycle": {
            "status": "exact-candidate-native-contract",
            "mappedFunctions": len(lifecycle),
            "requiredFunctions": len(lifecycle_ids),
            "pause": {
                "contract": "nativePause -> UnityPause(1)",
                "call": pause_calls[0],
            },
            "resume": {
                "contract":
                    "nativeResume stores deferred flag 1; UnityPlayerLoop "
                    "consumes it through UnityPause(2)",
                "deferredFlag": deferred_flag,
                "loopCall": loop_pause_calls[0],
            },
            "playerPause": {
                "contract":
                    "UnityPause transitions through SetPlayerPause(2,true) "
                    "and SetPlayerPause(0,true), committed by "
                    "SetPlayerPauseDirect",
                "stateCalls": set_pause_calls,
                "directCommit": direct_calls[0],
            },
            "baselineUnity2022ResumeChainReused": False,
        },
        "summary": summary,
        "runtimeBoundaries": runtime_boundaries,
        "claims": {
            "officialShaderRestorationPercent": None,
            "gameFidelity": False,
            "runtimeFidelity": False,
        },
        "proofSha256": canonical_digest({
            "sampleManifestSha256": loaded["sampleManifestSha256"],
            "sources": {
                "game": sha256(game_bytes),
                "release": sha256(release_bytes),
                "symbols": sha256(symbol_bytes),
            },
            "mapping": proof_mapping,
            "lifecycle": {
                "pause": pause_calls[0],
                "resume": deferred_flag,
                "loopCall": loop_pause_calls[0],
                "stateCalls": set_pause_calls,
                "directCommit": direct_calls[0],
            },
            "runtimeBoundaries": runtime_boundaries,
        }),
    }
    return output


def main() -> int:
    json.dump(extract(parse_args()), sys.stdout, ensure_ascii=True, indent=2)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
