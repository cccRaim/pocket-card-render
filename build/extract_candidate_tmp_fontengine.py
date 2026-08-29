#!/usr/bin/env python3
"""Extract the Unity 6 candidate TextCore SDFAA native producer chain."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import re
import struct
import sys
import zipfile

from capstone import CS_ARCH_ARM64, CS_MODE_ARM, Cs

from extract_candidate_unity_native import (
    Elf64,
    find_aligned,
    function_symbols,
    identity,
    normalize_body,
    sha256,
    unique_normalized_location,
    verify_identity,
)
from official_sample import load_official_sample


sys.dont_write_bytecode = True
LIBUNITY_ENTRY = "lib/arm64-v8a/libunity.so"
EXPECTED_SAMPLE_ID = "ptcgp-1.7.0-unity-6000.0.69f1-candidate"
TEST_MUTATION = os.environ.get(
    "PCR_TEST_CANDIDATE_TMP_FONTENGINE_MUTATION",
    "",
)

FUNCTIONS = (
    (
        "setPixelSizeAndUpsampling",
        "_ZN8TextCore30SetPixelSizeAndUpSamplingValue"
        "ENS_10RenderModeERi",
    ),
    (
        "loadGlyphSlot",
        "_ZN8TextCore17Load_FT_GlyphSlotENS_10RenderModeEj"
        "R10FT_Bitmap_RKP16FT_GlyphSlotRec_RiS7_RbRhi",
    ),
    (
        "copyGlyphSlotToTexture",
        "_ZN8TextCore31Copy_FT_GlyphSlot_DataToTexture"
        "ENS_10RenderModeEPNS_9GlyphRectEPhiP10FT_Bitmap_iiiih",
    ),
    (
        "generateSdf",
        "_ZN8TextCore12Generate_SDFEPhiS0_iiiiii",
    ),
    (
        "generate3x3AaEdt",
        "_ZN8TextCore17Generate_3X3AAEDTEPhiiiS0_iiii",
    ),
    (
        "renderGlyphToTextureJob",
        "_ZN8TextCore23RenderGlyphToTextureJob"
        "EPNS_18RenderGlyphJobDataE",
    ),
    (
        "computeEdgeGradient",
        "_ZN8TextCore19ComputeEdgeGradientEPNS_5PixelEPhiii",
    ),
    (
        "approximateEdgeDelta",
        "_ZN8TextCore20ApproximateEdgeDeltaEfff",
    ),
    (
        "calculate3x3AaEdt",
        "_ZN8TextCore17Calculate3x3AAEDTEPhiiiiPNS_5PixelE",
    ),
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--candidate-manifest", required=True)
    parser.add_argument("--split-root", required=True, type=Path)
    parser.add_argument("--release-player", required=True, type=Path)
    parser.add_argument("--release-symbols", required=True, type=Path)
    args = parser.parse_args()
    for name in ("split_root", "release_player", "release_symbols"):
        value = getattr(args, name)
        if not value.exists():
            parser.error(f"{name.replace('_', '-')} not found: {value}")
    return args


def direct_target(instruction) -> int | None:
    if instruction.mnemonic not in {"b", "bl"}:
        return None
    match = re.fullmatch(r"#0x([0-9a-f]+)", instruction.op_str)
    return int(match.group(1), 16) if match else None


def decode(body: bytes, start: int) -> list:
    instructions = list(
        Cs(CS_ARCH_ARM64, CS_MODE_ARM).disasm(body, start)
    )
    if len(instructions) * 4 != len(body):
        raise ValueError(
            f"TextCore function {start:#x}+{len(body):#x} "
            "did not decode strictly"
        )
    return instructions


def instruction_record(instruction, start: int) -> dict:
    return {
        "rva": f"0x{instruction.address:x}",
        "relativeOffset": f"0x{instruction.address - start:x}",
        "text": f"{instruction.mnemonic} {instruction.op_str}".rstrip(),
        "bytesHex": instruction.bytes.hex(),
        **identity(instruction.bytes),
    }


def require_instruction(
    instructions: dict[int, object],
    start: int,
    relative: int,
    expected: str,
) -> dict:
    instruction = instructions.get(start + relative)
    actual = (
        f"{instruction.mnemonic} {instruction.op_str}".rstrip()
        if instruction is not None
        else None
    )
    if actual != expected:
        raise ValueError(
            f"TextCore function {start:#x}+{relative:#x}: "
            f"expected {expected!r}, got {actual!r}"
        )
    return instruction_record(instruction, start)


def direct_xrefs(
    game: Elf64,
    target: int,
) -> list[tuple[int, bytes]]:
    result = []
    for base, body in game.executable_segments():
        for offset in range(0, len(body), 4):
            word = struct.unpack_from("<I", body, offset)[0]
            if word & 0xFC000000 != 0x94000000:
                continue
            immediate = word & 0x03FFFFFF
            if immediate & 0x02000000:
                immediate -= 0x04000000
            address = base + offset
            if address + immediate * 4 == target:
                result.append((address, body[offset : offset + 4]))
    return result


def map_render_job(
    game: Elf64,
    release: Elf64,
    symbols: dict[str, tuple[int, int]],
    copy_mapping: dict,
) -> dict:
    symbol = dict(FUNCTIONS)["renderGlyphToTextureJob"]
    release_rva, size = symbols[symbol]
    release_body = release.range(release_rva, size)
    release_instructions = decode(release_body, release_rva)
    copy_release_rva = int(copy_mapping["releaseRva"], 16)
    copy_game_rva = int(copy_mapping["gameRva"], 16)
    release_offsets = [
        instruction.address - release_rva
        for instruction in release_instructions
        if direct_target(instruction) == copy_release_rva
    ]
    if release_offsets != [0xA4]:
        raise ValueError(
            "Unity release RenderGlyphToTextureJob copy call moved"
        )
    candidate_starts = {
        address - release_offsets[0]
        for address, _raw in direct_xrefs(game, copy_game_rva)
    }
    release_shape = normalize_body(release_body)
    matches = []
    for start in candidate_starts:
        try:
            game_body = game.range(start, size)
        except ValueError:
            continue
        game_shape = bytearray(normalize_body(game_body))
        detour_offset = 0x10C
        detour_instruction = decode(
            game_body[detour_offset : detour_offset + 4],
            start + detour_offset,
        )[0]
        detour_target = direct_target(detour_instruction)
        if (
            detour_instruction.mnemonic != "b"
            or detour_target is None
        ):
            continue
        detour = decode(game.range(detour_target, 8), detour_target)
        if (
            len(detour) != 2
            or detour[0].mnemonic != "ldr"
            or detour[0].op_str.split(",", 1)[0] != "q0"
            or detour[1].mnemonic != "b"
            or direct_target(detour[1]) != start + detour_offset + 4
        ):
            continue
        normalized_detour_load = normalize_body(detour[0].bytes)
        if (
            normalized_detour_load
            != release_shape[detour_offset : detour_offset + 4]
        ):
            continue
        game_shape[detour_offset : detour_offset + 4] = (
            normalized_detour_load
        )
        if bytes(game_shape) != release_shape:
            continue
        matches.append(
            {
                "start": start,
                "body": game_body,
                "detour": detour,
                "detourTarget": detour_target,
            }
        )
    if len(matches) != 1:
        raise ValueError(
            "candidate RenderGlyphToTextureJob semantic shape occurs "
            f"{len(matches)} times"
        )
    match = matches[0]
    start = match["start"]
    game_body = match["body"]
    instructions = decode(game_body, start)
    copy_call = next(
        instruction for instruction in instructions
        if instruction.address == start + 0xA4
    )
    return {
        "id": "renderGlyphToTextureJob",
        "symbol": symbol,
        "status": "exact-normalized-shape-with-literal-load-thunk",
        "releaseRva": f"0x{release_rva:x}",
        "gameRva": f"0x{start:x}",
        "byteSize": size,
        "releaseBodySha256": sha256(release_body),
        "gameBodySha256": sha256(game_body),
        "normalizedSemanticShapeSha256": sha256(release_shape),
        "copyCall": instruction_record(copy_call, start),
        "literalLoadThunk": {
            "branch": instruction_record(
                next(
                    instruction for instruction in instructions
                    if instruction.address == start + 0x10C
                ),
                start,
            ),
            "targetRva": f"0x{match['detourTarget']:x}",
            "load": instruction_record(
                match["detour"][0],
                match["detourTarget"],
            ),
            "rejoin": instruction_record(
                match["detour"][1],
                match["detourTarget"],
            ),
            "status": "exact-out-of-line-literal-load-and-rejoin",
        },
    }


def selected_native_facts(
    game: Elf64,
    mappings: dict[str, dict],
) -> dict:
    decoded = {}
    by_address = {}
    for item_id, record in mappings.items():
        start = int(record["gameRva"], 16)
        instructions = decode(
            game.range(start, int(record["byteSize"])),
            start,
        )
        decoded[item_id] = instructions
        by_address[item_id] = {
            instruction.address: instruction
            for instruction in instructions
        }

    load_start = int(mappings["loadGlyphSlot"]["gameRva"], 16)
    expected_render_mode = (
        "#0x1044"
        if TEST_MUTATION == "render-mode"
        else "#0x1045"
    )
    load_checks = [
        require_instruction(
            by_address["loadGlyphSlot"],
            load_start,
            0xBC,
            f"mov w9, {expected_render_mode}",
        ),
        require_instruction(
            by_address["loadGlyphSlot"],
            load_start,
            0xC0,
            "cmp w8, w9",
        ),
        require_instruction(
            by_address["loadGlyphSlot"],
            load_start,
            0xCC,
            "mov w2, #6",
        ),
    ]

    copy_start = int(
        mappings["copyGlyphSlotToTexture"]["gameRva"],
        16,
    )
    copy_checks = []
    for relative, target_id in (
        (0x124, "generate3x3AaEdt"),
        (0x1B4, "generateSdf"),
    ):
        instruction = by_address["copyGlyphSlotToTexture"].get(
            copy_start + relative
        )
        target = direct_target(instruction)
        expected = int(mappings[target_id]["gameRva"], 16)
        if instruction is None or instruction.mnemonic != "b" or target != expected:
            raise ValueError(
                "candidate glyph-slot copy branch "
                f"{relative:#x} does not target {target_id}"
            )
        copy_checks.append(instruction_record(instruction, copy_start))

    render_start = int(
        mappings["renderGlyphToTextureJob"]["gameRva"],
        16,
    )
    render_instruction = by_address["renderGlyphToTextureJob"].get(
        render_start + 0xA4
    )
    if (
        render_instruction is None
        or render_instruction.mnemonic != "bl"
        or direct_target(render_instruction) != copy_start
    ):
        raise ValueError(
            "candidate RenderGlyphToTextureJob copy call changed"
        )

    calculate_start = int(
        mappings["calculate3x3AaEdt"]["gameRva"],
        16,
    )
    delta_target = int(
        mappings["approximateEdgeDelta"]["gameRva"],
        16,
    )
    gradient_target = int(
        mappings["computeEdgeGradient"]["gameRva"],
        16,
    )
    calculate_calls = [
        instruction
        for instruction in decoded["calculate3x3AaEdt"]
        if instruction.mnemonic == "bl"
    ]
    delta_calls = [
        instruction_record(instruction, calculate_start)
        for instruction in calculate_calls
        if direct_target(instruction) == delta_target
    ]
    gradient_calls = [
        instruction_record(instruction, calculate_start)
        for instruction in calculate_calls
        if direct_target(instruction) == gradient_target
    ]
    expected_delta_count = (
        8 if TEST_MUTATION == "edge-delta-count" else 9
    )
    if len(delta_calls) != expected_delta_count:
        raise ValueError(
            "candidate Calculate3x3AAEDT edge-delta call count "
            f"expected {expected_delta_count}, got {len(delta_calls)}"
        )
    if len(gradient_calls) != 1:
        raise ValueError(
            "candidate Calculate3x3AAEDT edge-gradient call count changed"
        )

    generate_start = int(
        mappings["generate3x3AaEdt"]["gameRva"],
        16,
    )
    rounding_checks = [
        require_instruction(
            by_address["generate3x3AaEdt"],
            generate_start,
            relative,
            text,
        )
        for relative, text in (
            (0x170, "fsqrt s3, s3"),
            (0x17C, "fmul s3, s0, s3"),
            (0x180, "fminnm s3, s3, s4"),
            (0x184, "fmaxnm s3, s3, s1"),
            (0x188, "fsub s3, s4, s3"),
            (0x194, "fsqrt s3, s3"),
            (0x1AC, "fadd s3, s3, s4"),
            (0x1B0, "fadd s3, s3, s2"),
            (0x1C0, "fcvtzs w0, s3"),
        )
    ]
    return {
        "dynamicAtlasRenderMode": {
            "decimal": 4165,
            "hex": "0x1045",
            "selectedInstructionChecks": load_checks,
        },
        "glyphLoadFlags": 6,
        "glyphSlotCopy": {
            "dynamicAtlasTarget": "generate3x3AaEdt",
            "freeTypeSdfTarget": "generateSdf",
            "selectedInstructionChecks": copy_checks,
        },
        "renderJobCallsGlyphSlotCopy": {
            "value": True,
            "instruction": instruction_record(
                render_instruction,
                render_start,
            ),
        },
        "distanceTransform": {
            "generator": "generate3x3AaEdt",
            "calculator": "calculate3x3AaEdt",
            "edgeGradient": "computeEdgeGradient",
            "edgeDelta": "approximateEdgeDelta",
            "edgeDeltaCallCount": len(delta_calls),
            "edgeGradientCallCount": len(gradient_calls),
            "edgeDeltaCalls": delta_calls,
            "edgeGradientCalls": gradient_calls,
            "pixelStrideBytes": 32,
            "outputCenter": 127,
            "outputScaleFormula": "255 / (2 * padding + 2)",
            "rounding": "add 0.5 then fcvtzs",
            "selectedInstructionChecks": rounding_checks,
        },
    }


def extract(args: argparse.Namespace) -> dict:
    loaded = load_official_sample(args.candidate_manifest)
    sample = loaded["sample"]
    if (
        sample["status"] != "candidate"
        or sample["sampleId"] != EXPECTED_SAMPLE_ID
    ):
        raise ValueError("expected the PTCGP 1.7.0 Unity 6 candidate")
    split_name = sample["game"]["packageSource"]["splits"]["arm64Split"]
    split_path = args.split_root / split_name
    split_bytes = split_path.read_bytes()
    verify_identity(
        "candidate arm64 split",
        split_bytes,
        sample["artifacts"]["arm64Split"],
    )
    with zipfile.ZipFile(split_path) as archive:
        game_bytes = archive.read(LIBUNITY_ENTRY)
    release_bytes = args.release_player.read_bytes()
    symbol_bytes = args.release_symbols.read_bytes()
    verify_identity(
        "candidate game libunity",
        game_bytes,
        sample["artifacts"]["libunity"],
    )
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

    game = Elf64(game_bytes, "candidate game libunity")
    release = Elf64(release_bytes, "Unity release player")
    symbols = function_symbols(symbol_bytes)
    normalized_game = [
        (rva, normalize_body(body))
        for rva, body in game.executable_segments()
    ]
    mappings = {}
    for item_id, symbol in FUNCTIONS:
        if item_id == "renderGlyphToTextureJob":
            continue
        mapped = unique_normalized_location(
            game,
            release,
            symbols,
            normalized_game,
            symbol,
        )
        mappings[item_id] = {
            "id": item_id,
            "symbol": symbol,
            "status": "exact-normalized-instruction-shape",
            "releaseRva": f"0x{mapped['releaseRva']:x}",
            "gameRva": f"0x{mapped['gameRva']:x}",
            "byteSize": mapped["byteSize"],
            "releaseBodySha256": mapped["releaseBodySha256"],
            "gameBodySha256": mapped["gameBodySha256"],
            "normalizedShapeSha256":
                mapped["normalizedShapeSha256"],
            "wholeFunctionExact":
                mapped["releaseBodySha256"]
                == mapped["gameBodySha256"],
        }
    mappings["renderGlyphToTextureJob"] = map_render_job(
        game,
        release,
        symbols,
        mappings["copyGlyphSlotToTexture"],
    )
    facts = selected_native_facts(game, mappings)
    ordered = [mappings[item_id] for item_id, _symbol in FUNCTIONS]
    return {
        "schema":
            "pocket-card-render/candidate-tmp-fontengine-extraction@1",
        "schemaVersion": 1,
        "candidate": {
            "sampleId": sample["sampleId"],
            "sampleManifestSha256": loaded["sampleManifestSha256"],
            "gameVersion": sample["game"]["versionName"],
            "unityVersion": sample["unity"]["serializedVersion"],
            "playerBuildVersion": sample["unity"]["playerBuildVersion"],
        },
        "sources": {
            "arm64Split": identity(split_bytes),
            "gameLibunity": identity(game_bytes),
            "releasePlayer": identity(release_bytes),
            "releaseSymbols": identity(symbol_bytes),
        },
        "mapping": {
            "status": "exact-candidate-native-producer-chain",
            "normalization":
                "mask relocation-owned BL/ADR/ADRP/literal/load-store/"
                "ADD-SUB immediates; preserve unconditional B and prove "
                "the RenderGlyphToTextureJob literal-load thunk/rejoin",
            "functions": ordered,
        },
        "facts": facts,
        "runtimeBoundary": {
            "status": "runtime-required",
            "requiredEvidence": [
                "official guest dynamic glyph request order",
                "official guest dynamic atlas allocation and mutation",
                "official guest generated glyph metrics and mesh bindings",
                "official guest TMP descriptor and uniform bindings",
            ],
            "reason":
                "exact Unity 6 native SDFAA producer bodies do not prove "
                "which glyphs the guest requests, atlas placement, generated "
                "mesh data or submitted GPU resources",
        },
        "summary": {
            "nativeFunctionCount": len(ordered),
            "exactNativeFunctionCount": sum(
                record["status"].startswith("exact-")
                for record in ordered
            ),
            "wholeFunctionExactCount": sum(
                record.get("wholeFunctionExact") is True
                for record in ordered
            ),
            "literalLoadThunkFunctionCount": sum(
                "literal-load-thunk" in record["status"]
                for record in ordered
            ),
        },
    }


def main() -> int:
    print(json.dumps(extract(parse_args()), ensure_ascii=True, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
