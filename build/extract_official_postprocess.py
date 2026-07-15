#!/usr/bin/env python3
"""Extract the official card MRT and Bloom pipeline directly from the Android APKM.

Method RVAs are package-matched locators only. All reported instructions, method
body hashes, serialized shader bytes, and SPIR-V modules come from the APKM.
"""

from __future__ import annotations

import argparse
from collections import Counter
from fractions import Fraction
import hashlib
import io
import json
import os
from pathlib import Path
import re
import struct
import sys
import zipfile

try:
    import UnityPy
except ImportError as exc:  # pragma: no cover - research environment dependency
    raise SystemExit("UnityPy is required: python -m pip install UnityPy") from exc

try:
    from capstone import Cs, CS_ARCH_ARM64, CS_MODE_ARM
except ImportError as exc:  # pragma: no cover - research environment dependency
    raise SystemExit("capstone is required: python -m pip install capstone") from exc

try:
    import lz4.block
except ImportError as exc:  # pragma: no cover - research environment dependency
    raise SystemExit("lz4 is required: python -m pip install lz4") from exc


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_APKM = ROOT.parent / "ptcg-apk-parser" / "apks" / "jp.pokemon.pokemontcgp_1.6.0.apkm"
GGM_PATH = "assets/bin/Data/globalgamemanagers"
GGM_RESOURCE_PREFIX = "assets/bin/Data/globalgamemanagers.assets.split"
IL2CPP_PATH = "lib/arm64-v8a/libil2cpp.so"
BLOOM_SHADER_NAME = b"Hidden/CustomPostEffect/Bloom"

# Package-matched serialized-object locators. They locate official bytes only;
# every field below is decoded from the object's raw serialized payload.
POST_PROCESS_DATA_PATH_ID = 14713
POST_PROCESS_PROFILE_PATH_IDS = tuple(range(14715, 14720))
BLOOM_PASS_PATH_ID = 14721
BLOOM_VOLUME_PATH_IDS = tuple(range(14722, 14727))

sys.path.insert(0, str(ROOT / "build" / "shaderdec"))
import smolv  # noqa: E402


# End RVAs are the next package-matched method locators. They delimit the exact
# official byte range and include IL2CPP's post-ret exception thunks.
METHODS = {
    "rendererDataCtor": {
        "name": "Lettuce.Graphics.Rendering.RendererData..ctor",
        "rva": 0x430B254,
        "endRva": 0x430B648,
    },
    "customRendererSetup": {
        "name": "Lettuce.Graphics.Rendering.CustomRenderer.Setup",
        "rva": 0x430C2A8,
        "endRva": 0x430C39C,
    },
    "drawOpaqueOnCameraSetup": {
        "name": "Lettuce.Graphics.Rendering.DrawOpaquePass.OnCameraSetup",
        "rva": 0x430D3C4,
        "endRva": 0x430D3E8,
    },
    "drawPostProcessExecute": {
        "name": "Lettuce.Graphics.Rendering.DrawPostProcessPass.Execute",
        "rva": 0x430D694,
        "endRva": 0x430D764,
    },
    "drawTransparentOnCameraSetup": {
        "name": "Lettuce.Graphics.Rendering.DrawTransparentPass.OnCameraSetup",
        "rva": 0x430D914,
        "endRva": 0x430D938,
    },
    "rendererDataGetTemporary": {
        "name": "Lettuce.Graphics.Rendering.RendererData.GetTemporary",
        "rva": 0x430E344,
        "endRva": 0x430E570,
    },
    "bloomPassExecute": {
        "name": "Lettuce.Graphics.PostProcessing.Bloom.BloomPass.Execute",
        "rva": 0x43076EC,
        "endRva": 0x43084FC,
    },
    "bloomGetBufferSize": {
        "name": "Lettuce.Graphics.PostProcessing.Bloom.BloomPass.GetBufferSize",
        "rva": 0x4308B80,
        "endRva": 0x4308C2C,
    },
    "bloomGetSheetSize": {
        "name": "Lettuce.Graphics.PostProcessing.Bloom.BloomPass.GetSheetSize",
        "rva": 0x4308C2C,
        "endRva": 0x4308C84,
    },
    "finalBlitExecute": {
        "name": "Lettuce.Graphics.Rendering.FinalBlitPass.Execute",
        "rva": 0x430DCC0,
        "endRva": 0x430E284,
    },
}


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


class Elf64:
    def __init__(self, data: bytes):
        if data[:4] != b"\x7fELF" or data[4] != 2 or data[5] != 1:
            raise RuntimeError("libil2cpp is not a little-endian ELF64 image")
        self.data = data
        phoff = struct.unpack_from("<Q", data, 32)[0]
        phentsize, phnum = struct.unpack_from("<HH", data, 54)
        self.loads = []
        for index in range(phnum):
            off = phoff + index * phentsize
            p_type, p_flags, p_offset, p_vaddr, _, p_filesz, p_memsz, _ = struct.unpack_from(
                "<IIQQQQQQ", data, off
            )
            if p_type == 1:
                self.loads.append(
                    {
                        "flags": p_flags,
                        "offset": p_offset,
                        "vaddr": p_vaddr,
                        "fileSize": p_filesz,
                        "memorySize": p_memsz,
                    }
                )

    def rva_to_offset(self, rva: int) -> int:
        for segment in self.loads:
            start = segment["vaddr"]
            if start <= rva < start + segment["fileSize"]:
                return segment["offset"] + rva - start
        raise RuntimeError(f"RVA 0x{rva:x} is outside ELF file-backed PT_LOAD segments")

    def range(self, start_rva: int, end_rva: int) -> bytes:
        start = self.rva_to_offset(start_rva)
        end = self.rva_to_offset(end_rva)
        if end - start != end_rva - start_rva:
            raise RuntimeError("method range crosses non-contiguous ELF segments")
        return self.data[start:end]


def disassemble(elf: Elf64, start_rva: int, end_rva: int):
    decoder = Cs(CS_ARCH_ARM64, CS_MODE_ARM)
    return list(decoder.disasm(elf.range(start_rva, end_rva), start_rva))


def instruction_map(instructions):
    return {item.address: f"{item.mnemonic} {item.op_str}".strip() for item in instructions}


def require_instructions(instructions, expected: dict[int, str], method: str):
    actual = instruction_map(instructions)
    mismatches = []
    for address, signature in expected.items():
        if actual.get(address) != signature:
            mismatches.append(f"0x{address:x}: expected {signature!r}, got {actual.get(address)!r}")
    if mismatches:
        raise RuntimeError(f"{method} ARM64 signature changed: {'; '.join(mismatches)}")


def method_evidence(elf: Elf64, key: str, spec: dict) -> dict:
    body = elf.range(spec["rva"], spec["endRva"])
    instructions = disassemble(elf, spec["rva"], spec["endRva"])
    calls = [
        {"address": f"0x{item.address:x}", "target": item.op_str.removeprefix("#")}
        for item in instructions
        if item.mnemonic == "bl"
    ]
    return {
        "key": key,
        "method": spec["name"],
        "architecture": "arm64-v8a",
        "rva": f"0x{spec['rva']:x}",
        "endRvaExclusive": f"0x{spec['endRva']:x}",
        "fileOffset": f"0x{elf.rva_to_offset(spec['rva']):x}",
        "bodySize": len(body),
        "bodySha256": sha256(body),
        "bodyHex": body.hex(),
        "retAddresses": [f"0x{item.address:x}" for item in instructions if item.mnemonic == "ret"],
        "calls": calls,
    }


def instruction_evidence(instructions, address: int) -> dict:
    for item in instructions:
        if item.address == address:
            raw = bytes(item.bytes)
            return {
                "address": f"0x{address:x}",
                "fileBytesHex": raw.hex(),
                "mnemonic": item.mnemonic,
                "operands": item.op_str,
                "text": f"{item.mnemonic} {item.op_str}".strip(),
            }
    raise RuntimeError(f"instruction 0x{address:x} was not decoded")


def immediate_from_instruction(instruction: dict, *, floating: bool = False):
    matches = re.findall(r"#(-?(?:0x[0-9a-fA-F]+|[0-9]+(?:\.[0-9]+)?))", instruction["operands"])
    if not matches:
        raise RuntimeError(f"instruction has no immediate: {instruction['text']}")
    value = matches[-1]
    return float(value) if floating else int(value, 0)


def emulate_get_buffer_size(width: int, height: int, buffer_size: int, target_aspect: float) -> tuple[int, int]:
    height_over_width = height / width
    width_over_height = width / height
    first_width = buffer_size / min(height_over_width, target_aspect)
    second_width = buffer_size / (1.0 - max(width_over_height - target_aspect, 0.0))
    result_width = int(first_width if width > height else second_width)
    height_divisor = (
        1.0 - max(height_over_width - target_aspect, 0.0)
        if width > height
        else min(width_over_height, target_aspect)
    )
    return result_width, int(buffer_size / height_divisor)


def decode_bloom_sizing(decoded: dict[str, list], methods: dict, buffer_size_field: dict) -> dict:
    get_buffer = decoded["bloomGetBufferSize"]
    get_sheet = decoded["bloomGetSheetSize"]
    execute = decoded["bloomPassExecute"]
    require_instructions(
        get_buffer,
        {
            0x4308B80: "ldp w8, w9, [x1]",
            0x4308B84: "fmov s4, #-0.56250000",
            0x4308B98: "scvtf s1, w9",
            0x4308B9C: "scvtf s2, w8",
            0x4308BA0: "fdiv s3, s1, s2",
            0x4308BA4: "fdiv s1, s2, s1",
            0x4308BA8: "fmov s2, #0.56250000",
            0x4308BAC: "fminnm s5, s3, s2",
            0x4308BB4: "fmax s3, s3, s6",
            0x4308BB8: "fdiv s5, s0, s5",
            0x4308BBC: "fsub s3, s16, s3",
            0x4308BD0: "fmax s7, s7, s6",
            0x4308BD4: "fsub s7, s16, s7",
            0x4308BD8: "fcvtzs w11, s5",
            0x4308BE4: "fdiv s7, s0, s7",
            0x4308BEC: "fcvtzs w11, s7",
            0x4308BF8: "cmp w8, w9",
            0x4308BFC: "fcsel s1, s3, s1, gt",
            0x4308C04: "csel w9, w10, w11, gt",
            0x4308C0C: "fdiv s0, s0, s1",
            0x4308C14: "fcvtzs w8, s0",
            0x4308C24: "orr x0, x8, x9",
            0x4308C28: "ret",
        },
        METHODS["bloomGetBufferSize"]["name"],
    )
    require_instructions(
        get_sheet,
        {
            0x4308C5C: "and x9, x19, #0xffffffff00000000",
            0x4308C64: "add w8, w19, w8, asr #1",
            0x4308C6C: "add w8, w8, #0x24",
            0x4308C70: "orr x8, x9, x8",
            0x4308C74: "mov x9, #0x1200000000",
            0x4308C78: "add x0, x8, x9",
            0x4308C80: "ret",
        },
        METHODS["bloomGetSheetSize"]["name"],
    )
    require_instructions(
        execute,
        {
            0x430794C: "bl #0x4308b80",
            0x430798C: "add w9, w22, w9, asr #1",
            0x4307994: "mov x11, #0x1200000000",
            0x4307998: "add w27, w9, #0x24",
            0x430799C: "add x9, x10, x11",
            0x43079A4: "orr x2, x9, x27",
            0x43079BC: "lsl w1, w22, #1",
            0x43079C0: "lsl w2, w20, #1",
        },
        METHODS["bloomPassExecute"]["name"],
    )

    target_instruction = instruction_evidence(get_buffer, 0x4308BA8)
    target_aspect = immediate_from_instruction(target_instruction, floating=True)
    target_fraction = Fraction(target_aspect).limit_denominator(4096)
    example_width = target_fraction.numerator
    example_height = target_fraction.denominator
    buffer_size = int(buffer_size_field["value"])
    base_width, base_height = emulate_get_buffer_size(
        example_width, example_height, buffer_size, target_aspect
    )

    pass0_x_instruction = instruction_evidence(execute, 0x43079BC)
    pass0_y_instruction = instruction_evidence(execute, 0x43079C0)
    pass0_x_scale = 1 << immediate_from_instruction(pass0_x_instruction)
    pass0_y_scale = 1 << immediate_from_instruction(pass0_y_instruction)

    sheet_half_instruction = instruction_evidence(execute, 0x430798C)
    sheet_width_padding_instruction = instruction_evidence(execute, 0x4307998)
    sheet_height_padding_instruction = instruction_evidence(execute, 0x4307994)
    sheet_half_shift = immediate_from_instruction(sheet_half_instruction)
    sheet_width_padding = immediate_from_instruction(sheet_width_padding_instruction)
    packed_height_padding = immediate_from_instruction(sheet_height_padding_instruction)
    sheet_height_padding = packed_height_padding >> 32
    sheet_width = base_width + (base_width >> sheet_half_shift) + sheet_width_padding
    sheet_height = base_height + sheet_height_padding

    return {
        "derivation": "ARM64 instructions plus BloomVolume.bufferSize serialized bytes",
        "getBufferSize": {
            "methodKey": "bloomGetBufferSize",
            "rva": methods["bloomGetBufferSize"]["rva"],
            "targetAspect": {
                "value": target_aspect,
                "fraction": f"{target_fraction.numerator}/{target_fraction.denominator}",
                "instruction": target_instruction,
            },
            "formula": {
                "rounding": "FCVTZS (truncate toward zero)",
                "ratios": ["height / width", "width / height"],
                "selection": "portrait selects bufferSize / (1 - max(width/height - targetAspect, 0)) for width and bufferSize / min(width/height, targetAspect) for height",
            },
            "instructionEvidence": [
                instruction_evidence(get_buffer, address)
                for address in (0x4308B80, 0x4308BA0, 0x4308BA4, 0x4308BA8, 0x4308BAC, 0x4308BB8, 0x4308BD8, 0x4308BE4, 0x4308BF8, 0x4308BFC, 0x4308C04, 0x4308C0C, 0x4308C14, 0x4308C24)
            ],
        },
        "portraitExample": {
            "aspect": f"{example_width}:{example_height}",
            "inputSize": {"width": example_width, "height": example_height},
            "bufferSize": {
                "value": buffer_size,
                "sourcePathId": buffer_size_field["sourcePathId"],
                "objectOffset": buffer_size_field["objectOffset"],
                "resourceOffset": buffer_size_field["resourceOffset"],
                "rawHex": buffer_size_field["rawHex"],
            },
            "baseSize": {"width": base_width, "height": base_height},
            "pass0": {
                "scale": {"width": pass0_x_scale, "height": pass0_y_scale},
                "size": {
                    "width": base_width * pass0_x_scale,
                    "height": base_height * pass0_y_scale,
                },
                "instructionEvidence": [pass0_x_instruction, pass0_y_instruction],
            },
            "sheet": {
                "formula": {
                    "width": f"baseWidth + (baseWidth >> {sheet_half_shift}) + {sheet_width_padding}",
                    "height": f"baseHeight + {sheet_height_padding}",
                },
                "size": {"width": sheet_width, "height": sheet_height},
                "instructionEvidence": [
                    sheet_half_instruction,
                    sheet_width_padding_instruction,
                    sheet_height_padding_instruction,
                    instruction_evidence(execute, 0x430799C),
                    instruction_evidence(execute, 0x43079A4),
                ],
            },
        },
        "getSheetSizeHelper": {
            "methodKey": "bloomGetSheetSize",
            "rva": methods["bloomGetSheetSize"]["rva"],
            "instructionEvidence": [
                instruction_evidence(get_sheet, address)
                for address in (0x4308C5C, 0x4308C64, 0x4308C6C, 0x4308C70, 0x4308C74, 0x4308C78)
            ],
        },
    }


def decode_native_pipeline(elf_bytes: bytes, buffer_size_field: dict) -> dict:
    elf = Elf64(elf_bytes)
    decoded = {key: disassemble(elf, spec["rva"], spec["endRva"]) for key, spec in METHODS.items()}

    require_instructions(
        decoded["rendererDataCtor"],
        {
            0x430B3CC: "mov w1, #2",
            0x430B3E0: "str x1, [x19, #0x498]",
            0x430B3EC: "mov w1, #2",
            0x430B3FC: "str x1, [x19, #0x4a0]",
        },
        METHODS["rendererDataCtor"]["name"],
    )
    require_instructions(
        decoded["rendererDataGetTemporary"],
        {
            0x430E364: "mov w1, wzr",
            0x430E36C: "bl #0x650e700",
            0x430E3B8: "bl #0x653d590",
            0x430E3E4: "bl #0x653d590",
            0x430E3EC: "mov w1, #0x18",
            0x430E3F4: "bl #0x650e648",
            0x430E3FC: "mov w1, #1",
            0x430E404: "bl #0x650e700",
            0x430E430: "bl #0x653d590",
            0x430E45C: "bl #0x653d590",
        },
        METHODS["rendererDataGetTemporary"]["name"],
    )
    require_instructions(
        decoded["customRendererSetup"],
        {
            0x430C2D4: "bl #0x63cf4e4",
            0x430C2E4: "bl #0x63cf4e4",
            0x430C300: "bl #0x63cf4e4",
            0x430C320: "bl #0x63cf4e4",
            0x430C330: "bl #0x63cf4e4",
            0x430C368: "bl #0x63cf4e4",
            0x430C380: "bl #0x63cf4e4",
        },
        METHODS["customRendererSetup"]["name"],
    )
    for key in ("drawOpaqueOnCameraSetup", "drawTransparentOnCameraSetup"):
        expected = {
            METHODS[key]["rva"] + 0xC: "ldr x1, [x8, #0x498]",
            METHODS[key]["rva"] + 0x14: "ldr x2, [x8, #0x30]",
            METHODS[key]["rva"] + 0x1C: "b #0x63c66ac",
        }
        require_instructions(decoded[key], expected, METHODS[key]["name"])
    require_instructions(
        decoded["bloomPassExecute"],
        {
            0x4307AB4: "mov w4, wzr",
            0x4307AD8: "bl #0x653fce8",
            0x4307C2C: "mov w4, #1",
            0x4307C48: "bl #0x653fce8",
            0x4307EB0: "mov w5, #2",
            0x4307ED0: "bl #0x653f3c0",
            0x4308080: "mov w4, #3",
            0x43080A4: "bl #0x653fce8",
            0x430816C: "mov w4, #3",
            0x4308198: "bl #0x653fce8",
            0x43082EC: "mov w5, #4",
            0x4308304: "bl #0x653f3c0",
            0x43083F8: "mov w4, #5",
            0x4308424: "bl #0x653fce8",
        },
        METHODS["bloomPassExecute"]["name"],
    )

    pass_graph = [
        {"order": 0, "pass": "PrePass", "fieldOffset": "0x1b0", "enqueueCall": "0x430c2d4", "condition": "always"},
        {"order": 1, "pass": "DrawOpaque", "fieldOffset": "0x1b8", "enqueueCall": "0x430c2e4", "condition": "always"},
        {"order": 2, "pass": "DrawSkybox", "fieldOffset": "0x1c0", "enqueueCall": "0x430c300", "condition": "IsSkybox"},
        {"order": 3, "pass": "CopyDepth", "fieldOffset": "0x1c8", "enqueueCall": "0x430c320", "condition": "UseDepthTexture"},
        {"order": 4, "pass": "DrawTransparent", "fieldOffset": "0x1d0", "enqueueCall": "0x430c330", "condition": "always"},
        {"order": 5, "pass": "DrawPostProcess", "fieldOffset": "0x1d8", "enqueueCall": "0x430c368", "condition": "IsPostGroupLast"},
        {"order": 6, "pass": "FinalBlit", "fieldOffset": "0x1e0", "enqueueCall": "0x430c380", "condition": "resolveFinalTarget"},
    ]
    bloom_calls = [
        {"order": 0, "pass": 0, "operation": "Blit", "call": "0x4307ad8"},
        {"order": 1, "pass": 1, "operation": "Blit/downsample loop", "call": "0x4307c48"},
        {"order": 2, "pass": 2, "operation": "DrawMesh/Image2Sheet", "call": "0x4307ed0"},
        {"order": 3, "pass": 3, "operation": "Blit/blur", "call": "0x43080a4"},
        {"order": 4, "pass": 3, "operation": "Blit/blur", "call": "0x4308198"},
        {"order": 5, "pass": 4, "operation": "DrawMesh/Sheet2Image", "call": "0x4308304"},
        {"order": 6, "pass": 5, "operation": "Blit/final", "call": "0x4308424"},
    ]
    methods = {key: method_evidence(elf, key, spec) for key, spec in METHODS.items()}
    bloom_sizing = decode_bloom_sizing(decoded, methods, buffer_size_field)
    return {
        "elfLoadSegments": elf.loads,
        "methods": methods,
        "mrt": {
            "colorAttachmentCount": 2,
            "multiRenderTargetArrayLength": 2,
            "colorFormatValue": 0,
            "colorFormat": "ARGB32",
            "depthBufferBits": 24,
            "depthFormatValue": 1,
            "depthFormat": "Depth",
            "colorAllocCalls": ["0x430e3b8", "0x430e3e4"],
            "depthAllocCalls": ["0x430e430", "0x430e45c"],
            "opaqueAndTransparentBindMrt": True,
        },
        "customRendererPassGraph": pass_graph,
        "drawPostProcess": {
            "iteratesSerializedPassList": True,
            "virtualExecuteCall": "0x430d738",
            "methodBodySha256": methods["drawPostProcessExecute"]["bodySha256"],
        },
        "bloomExecuteSequence": bloom_calls,
        "bloomSizing": bloom_sizing,
        "finalBlit": {
            "methodKey": "finalBlitExecute",
            "bodyEvidence": methods["finalBlitExecute"],
            "semanticScope": "body bytes pinned; shader selection and tone-map semantics are not inferred",
        },
    }


def resource_location(resource_parts: list[tuple[str, bytes]], offset: int, size: int) -> dict:
    base = 0
    for path, data in resource_parts:
        end = base + len(data)
        if base <= offset and offset + size <= end:
            return {
                "splitPath": path,
                "splitOffset": offset - base,
            }
        base = end
    raise RuntimeError(f"resource byte range 0x{offset:x}+0x{size:x} crosses or exceeds split files")


def serialized_object_evidence(obj, resource_parts: list[tuple[str, bytes]], data_offset: int) -> tuple[dict, bytes]:
    raw = bytes(obj.get_raw_data())
    resource_offset = int(obj.byte_start)
    if len(raw) != int(obj.byte_size):
        raise RuntimeError(f"PathID {obj.path_id} raw byte size changed")
    return {
        "pathId": int(obj.path_id),
        "type": obj.type.name,
        "classId": int(obj.class_id),
        "typeId": int(obj.type_id),
        "dataRelativeOffset": resource_offset - data_offset,
        "resourceOffset": resource_offset,
        **resource_location(resource_parts, resource_offset, len(raw)),
        "byteSize": len(raw),
        "rawSha256": sha256(raw),
        "rawHex": raw.hex(),
    }, raw


def serialized_field(
    obj: dict,
    raw: bytes,
    resource_parts: list[tuple[str, bytes]],
    offset: int,
    size: int,
    decoded_as: str,
    value,
) -> dict:
    end = offset + size
    if offset < 0 or end > len(raw):
        raise RuntimeError(f"PathID {obj['pathId']} field range {offset}:{end} exceeds raw bytes")
    resource_offset = obj["resourceOffset"] + offset
    return {
        "sourcePathId": obj["pathId"],
        "objectOffset": offset,
        "resourceOffset": resource_offset,
        **resource_location(resource_parts, resource_offset, size),
        "byteSize": size,
        "rawHex": raw[offset:end].hex(),
        "decodedAs": decoded_as,
        "value": value,
    }


def decode_pptr(raw: bytes, offset: int) -> dict:
    return {
        "fileId": struct.unpack_from("<i", raw, offset)[0],
        "pathId": struct.unpack_from("<q", raw, offset + 4)[0],
    }


def pptr_field(obj: dict, raw: bytes, resource_parts: list[tuple[str, bytes]], offset: int) -> dict:
    return serialized_field(obj, raw, resource_parts, offset, 12, "PPtr(fileId:int32,pathId:int64)", decode_pptr(raw, offset))


def int32_field(obj: dict, raw: bytes, resource_parts: list[tuple[str, bytes]], offset: int) -> dict:
    return serialized_field(
        obj, raw, resource_parts, offset, 4, "int32-le", struct.unpack_from("<i", raw, offset)[0]
    )


def uint32_field(obj: dict, raw: bytes, resource_parts: list[tuple[str, bytes]], offset: int) -> dict:
    return serialized_field(
        obj, raw, resource_parts, offset, 4, "uint32-le", struct.unpack_from("<I", raw, offset)[0]
    )


def float32_field(obj: dict, raw: bytes, resource_parts: list[tuple[str, bytes]], offset: int) -> dict:
    return serialized_field(
        obj, raw, resource_parts, offset, 4, "float32-le", struct.unpack_from("<f", raw, offset)[0]
    )


def bool_aligned4_field(obj: dict, raw: bytes, resource_parts: list[tuple[str, bytes]], offset: int) -> dict:
    size = align4(offset + 1) - offset
    field = serialized_field(obj, raw, resource_parts, offset, size, "bool-u8 + align4 padding", raw[offset] != 0)
    field["valueByteHex"] = raw[offset : offset + 1].hex()
    field["paddingHex"] = raw[offset + 1 : offset + size].hex()
    return field


def decode_mono_behaviour_header(
    obj: dict, raw: bytes, resource_parts: list[tuple[str, bytes]]
) -> dict:
    if len(raw) < 32:
        raise RuntimeError(f"PathID {obj['pathId']} is shorter than a serialized MonoBehaviour header")
    name_length = struct.unpack_from("<I", raw, 28)[0]
    name_end = 32 + name_length
    fields_offset = align4(name_end)
    if fields_offset > len(raw):
        raise RuntimeError(f"PathID {obj['pathId']} MonoBehaviour name exceeds raw bytes")
    try:
        name = raw[32:name_end].decode("utf8")
    except UnicodeDecodeError as exc:
        raise RuntimeError(f"PathID {obj['pathId']} MonoBehaviour name is not UTF-8") from exc
    return {
        "gameObject": pptr_field(obj, raw, resource_parts, 0),
        "enabled": bool_aligned4_field(obj, raw, resource_parts, 12),
        "script": pptr_field(obj, raw, resource_parts, 16),
        "name": serialized_field(
            obj,
            raw,
            resource_parts,
            28,
            fields_offset - 28,
            "aligned Unity string (uint32 length + UTF-8 + padding)",
            name,
        ),
        "fieldsOffset": fields_offset,
    }


def require_consumed(obj: dict, raw: bytes, cursor: int):
    if cursor != len(raw):
        raise RuntimeError(
            f"PathID {obj['pathId']} raw layout consumed {cursor} of {len(raw)} bytes"
        )


def decode_post_process_data(
    obj: dict, raw: bytes, resource_parts: list[tuple[str, bytes]]
) -> dict:
    header = decode_mono_behaviour_header(obj, raw, resource_parts)
    cursor = header["fieldsOffset"]
    profile_count = uint32_field(obj, raw, resource_parts, cursor)
    cursor += 4
    profiles = []
    for index in range(profile_count["value"]):
        profile_type = int32_field(obj, raw, resource_parts, cursor)
        cursor += 4
        profile = pptr_field(obj, raw, resource_parts, cursor)
        cursor += 12
        profiles.append({"index": index, "type": profile_type, "profile": profile})
    pass_count = uint32_field(obj, raw, resource_parts, cursor)
    cursor += 4
    passes = []
    for index in range(pass_count["value"]):
        pass_ref = pptr_field(obj, raw, resource_parts, cursor)
        cursor += 12
        passes.append({"index": index, "pass": pass_ref})
    require_consumed(obj, raw, cursor)
    return {
        "object": obj,
        "monoBehaviour": header,
        "profileCount": profile_count,
        "profiles": profiles,
        "postProcessPassCount": pass_count,
        "postProcessPasses": passes,
    }


def decode_volume_profile(
    obj: dict, raw: bytes, resource_parts: list[tuple[str, bytes]]
) -> dict:
    header = decode_mono_behaviour_header(obj, raw, resource_parts)
    cursor = header["fieldsOffset"]
    component_count = uint32_field(obj, raw, resource_parts, cursor)
    cursor += 4
    components = []
    for index in range(component_count["value"]):
        component = pptr_field(obj, raw, resource_parts, cursor)
        cursor += 12
        components.append({"index": index, "component": component})
    require_consumed(obj, raw, cursor)
    return {
        "object": obj,
        "monoBehaviour": header,
        "componentCount": component_count,
        "components": components,
    }


def decode_bloom_pass(
    obj: dict, raw: bytes, resource_parts: list[tuple[str, bytes]]
) -> dict:
    header = decode_mono_behaviour_header(obj, raw, resource_parts)
    cursor = header["fieldsOffset"]
    shader = pptr_field(obj, raw, resource_parts, cursor)
    cursor += 12
    apply_to_scene_view = bool_aligned4_field(obj, raw, resource_parts, cursor)
    cursor += apply_to_scene_view["byteSize"]
    limit_count = int32_field(obj, raw, resource_parts, cursor)
    cursor += 4
    require_consumed(obj, raw, cursor)
    return {
        "object": obj,
        "monoBehaviour": header,
        "fields": {
            "shader": shader,
            "applyToSceneView": apply_to_scene_view,
            "limitCount": limit_count,
        },
    }


def decode_volume_parameter(
    obj: dict,
    raw: bytes,
    resource_parts: list[tuple[str, bytes]],
    cursor: int,
    value_kind: str,
) -> tuple[dict, int]:
    override_state = bool_aligned4_field(obj, raw, resource_parts, cursor)
    cursor += override_state["byteSize"]
    if value_kind == "int32":
        value = int32_field(obj, raw, resource_parts, cursor)
    elif value_kind == "float32":
        value = float32_field(obj, raw, resource_parts, cursor)
    else:  # pragma: no cover - internal caller contract
        raise RuntimeError(f"unsupported VolumeParameter value kind: {value_kind}")
    cursor += value["byteSize"]
    return {"overrideState": override_state, "value": value}, cursor


def decode_bloom_volume(
    obj: dict, raw: bytes, resource_parts: list[tuple[str, bytes]]
) -> dict:
    header = decode_mono_behaviour_header(obj, raw, resource_parts)
    cursor = header["fieldsOffset"]
    active = bool_aligned4_field(obj, raw, resource_parts, cursor)
    cursor += active["byteSize"]
    buffer_size, cursor = decode_volume_parameter(obj, raw, resource_parts, cursor, "int32")
    down_sampling_count, cursor = decode_volume_parameter(obj, raw, resource_parts, cursor, "int32")
    scatter, cursor = decode_volume_parameter(obj, raw, resource_parts, cursor, "float32")
    intensity, cursor = decode_volume_parameter(obj, raw, resource_parts, cursor, "float32")
    require_consumed(obj, raw, cursor)
    return {
        "object": obj,
        "monoBehaviour": header,
        "fields": {
            "active": active,
            "bufferSize": buffer_size,
            "downSamplingCount": down_sampling_count,
            "scatter": scatter,
            "intensity": intensity,
        },
    }


def decode_serialized_postprocess(
    resource: bytes, resource_parts: list[tuple[str, bytes]]
) -> dict:
    environment = UnityPy.load(resource)
    serialized_files = [item for item in environment.files.values() if hasattr(item, "objects")]
    if len(serialized_files) != 1:
        raise RuntimeError(f"expected one serialized globalgamemanagers.assets file, found {len(serialized_files)}")
    serialized_file = serialized_files[0]
    target_path_ids = (
        POST_PROCESS_DATA_PATH_ID,
        *POST_PROCESS_PROFILE_PATH_IDS,
        BLOOM_PASS_PATH_ID,
        *BLOOM_VOLUME_PATH_IDS,
    )
    missing = [path_id for path_id in target_path_ids if path_id not in serialized_file.objects]
    if missing:
        raise RuntimeError(f"serialized post-process PathIDs missing: {missing}")

    raw_objects = {}
    typetree_attempts = []
    for path_id in target_path_ids:
        reader = serialized_file.objects[path_id]
        evidence, raw = serialized_object_evidence(
            reader, resource_parts, serialized_file.header.data_offset
        )
        raw_objects[path_id] = (evidence, raw)
        try:
            reader.read_typetree()
        except Exception as exc:  # stripped custom MonoBehaviour fields fall back to raw bytes
            typetree_attempts.append(
                {"pathId": path_id, "readable": False, "error": f"{type(exc).__name__}: {exc}"}
            )
        else:
            typetree_attempts.append({"pathId": path_id, "readable": True, "error": None})

    post_process_data = decode_post_process_data(
        *raw_objects[POST_PROCESS_DATA_PATH_ID], resource_parts
    )
    profiles = [
        decode_volume_profile(*raw_objects[path_id], resource_parts)
        for path_id in POST_PROCESS_PROFILE_PATH_IDS
    ]
    bloom_pass = decode_bloom_pass(*raw_objects[BLOOM_PASS_PATH_ID], resource_parts)
    bloom_volumes = [
        decode_bloom_volume(*raw_objects[path_id], resource_parts)
        for path_id in BLOOM_VOLUME_PATH_IDS
    ]
    volume_hashes = [volume["object"]["rawSha256"] for volume in bloom_volumes]
    volume_hex = [volume["object"]["rawHex"] for volume in bloom_volumes]

    header = serialized_file.header
    return {
        "serializedFile": {
            "unityVersion": serialized_file.unity_version,
            "formatVersion": int(header.version),
            "endian": header.endian,
            "metadataSize": int(header.metadata_size),
            "fileSize": int(header.file_size),
            "dataOffset": int(header.data_offset),
            "objectCount": len(serialized_file.objects),
            "embeddedTypeTreeEnabled": bool(serialized_file._enable_type_tree),
            "resourceSha256": sha256(resource),
            "resourceSize": len(resource),
        },
        "decode": {
            "mode": "raw serialized MonoBehaviour bytes with package-matched field layouts",
            "typeTreeReadableForAllTargets": all(item["readable"] for item in typetree_attempts),
            "typeTreeAttempts": typetree_attempts,
            "fieldEvidenceContract": "Each decoded field carries source PathID, object/resource/split offset, raw bytes, decoding type, and value.",
        },
        "postProcessData": post_process_data,
        "profiles": profiles,
        "bloomPass": bloom_pass,
        "bloomVolumes": bloom_volumes,
        "derived": {
            "postProcessPassPathIds": [
                item["pass"]["value"]["pathId"] for item in post_process_data["postProcessPasses"]
            ],
            "profileComponentPathIds": [
                item["components"][0]["component"]["value"]["pathId"]
                if len(item["components"]) == 1
                else None
                for item in profiles
            ],
            "bloomVolumeRawIdentical": len(set(volume_hex)) == 1,
            "bloomVolumeRawSha256": volume_hashes[0] if len(set(volume_hashes)) == 1 else None,
        },
    }


def align4(value: int) -> int:
    return (value + 3) & ~3


def read_u32(data: bytes, offset: int) -> int:
    return struct.unpack_from("<I", data, offset)[0]


def exec_model(spv: bytes) -> int:
    words = struct.unpack(f"<{len(spv) // 4}I", spv)
    index = 5
    while index < len(words):
        length = words[index] >> 16
        opcode = words[index] & 0xFFFF
        if length < 1 or index + length > len(words):
            raise RuntimeError("invalid SPIR-V instruction stream")
        if opcode == 15:
            return words[index + 1]
        index += length
    raise RuntimeError("SPIR-V module has no OpEntryPoint")


def spirv_summary(spv: bytes) -> dict:
    words = struct.unpack(f"<{len(spv) // 4}I", spv)
    index = 5
    opcodes = Counter()
    types = {}
    float_constants = []
    unsigned_constants = []
    ext_instructions = []
    while index < len(words):
        length = words[index] >> 16
        opcode = words[index] & 0xFFFF
        if length < 1 or index + length > len(words):
            raise RuntimeError("invalid SPIR-V instruction stream")
        opcodes[opcode] += 1
        if opcode == 21 and length == 4:
            types[words[index + 1]] = ("int", words[index + 2], words[index + 3])
        elif opcode == 22 and length == 3:
            types[words[index + 1]] = ("float", words[index + 2])
        elif opcode == 43 and length >= 4:
            kind = types.get(words[index + 1])
            if kind == ("float", 32):
                raw = words[index + 3]
                float_constants.append({"bits": f"0x{raw:08x}", "value": struct.unpack("<f", struct.pack("<I", raw))[0]})
            elif kind == ("int", 32, 0):
                unsigned_constants.append(words[index + 3])
        elif opcode == 12 and length >= 5:
            ext_instructions.append(words[index + 4])
        index += length
    if index != len(words):
        raise RuntimeError("SPIR-V module did not end on an instruction boundary")
    return {
        "executionModel": exec_model(spv),
        "opCounts": {str(key): opcodes[key] for key in sorted(opcodes)},
        "floatConstants": float_constants,
        "unsignedConstants": unsigned_constants,
        "extendedInstructionNumbers": ext_instructions,
    }


def decode_bloom_shader(resource: bytes) -> dict:
    occurrences = []
    cursor = 0
    while True:
        found = resource.find(BLOOM_SHADER_NAME, cursor)
        if found < 0:
            break
        occurrences.append(found)
        cursor = found + 1
    if len(occurrences) != 1:
        raise RuntimeError(f"expected one Bloom shader in globalgamemanagers.assets, found {len(occurrences)}")

    name_offset = occurrences[0]
    fields = align4(name_offset + len(BLOOM_SHADER_NAME))
    expected = {
        fields + 20: 1,
        fields + 24: 18,
        fields + 28: 1,
        fields + 32: 1,
        fields + 36: 0,
        fields + 40: 1,
        fields + 44: 1,
        fields + 52: 1,
        fields + 56: 1,
    }
    for offset, value in expected.items():
        actual = read_u32(resource, offset)
        if actual != value:
            raise RuntimeError(f"Bloom serialized layout changed at 0x{offset:x}: expected {value}, got {actual}")
    compressed_length = read_u32(resource, fields + 48)
    decompressed_length = read_u32(resource, fields + 60)
    blob_length = read_u32(resource, fields + 64)
    if blob_length != compressed_length:
        raise RuntimeError("Bloom compressedBlob length does not match compressedLengths")
    blob_offset = fields + 68
    compressed = resource[blob_offset : blob_offset + blob_length]
    decompressed = lz4.block.decompress(compressed, uncompressed_size=decompressed_length)
    if len(decompressed) != decompressed_length:
        raise RuntimeError("Bloom shader decompressed length changed")

    magic = struct.pack("<I", smolv.SMOL_MAGIC)
    offsets = []
    cursor = 0
    while True:
        found = decompressed.find(magic, cursor)
        if found < 0:
            break
        offsets.append(found)
        cursor = found + 4
    modules = []
    for index, offset in enumerate(offsets):
        end = offsets[index + 1] if index + 1 < len(offsets) else len(decompressed)
        decoded = smolv.decode(decompressed[offset:end])
        declared_size = read_u32(decompressed, offset + 20)
        if declared_size < 20 or declared_size % 4 or declared_size > len(decoded):
            raise RuntimeError(f"invalid decoded SPIR-V size for Bloom module {index}")
        spv = decoded[:declared_size]
        if read_u32(spv, 0) != smolv.SPIRV_MAGIC:
            raise RuntimeError(f"Bloom module {index} is not SPIR-V")
        summary = spirv_summary(spv)
        modules.append(
            {
                "index": index,
                "pass": index // 2,
                "stage": {0: "vertex", 4: "fragment"}.get(summary["executionModel"], f"model-{summary['executionModel']}"),
                "smolvOffset": offset,
                "decodedSize": declared_size,
                "sha256": sha256(spv),
                **summary,
            }
        )
    if len(modules) != 12:
        raise RuntimeError(f"expected 12 Bloom modules, found {len(modules)}")
    expected_stages = ["fragment", "vertex"] * 6
    if [module["stage"] for module in modules] != expected_stages:
        raise RuntimeError("Bloom module stage ordering changed")

    fragment = {module["pass"]: module for module in modules if module["stage"] == "fragment"}
    pass0_bits = [item["bits"] for item in fragment[0]["floatConstants"]]
    pass1_ext = fragment[1]["extendedInstructionNumbers"]
    pass3_taps = [
        value
        for value in fragment[3]["unsignedConstants"]
        if value in {1059481190, 1044885012, 1075545375, 1044482359, 1082906378, 1035342132, 1086995825, 1021182162}
    ]
    pass5_arithmetic = {
        opcode: count
        for opcode, count in fragment[5]["opCounts"].items()
        if 124 <= int(opcode) <= 200
    }
    pass0_threshold_ops = {
        opcode: count
        for opcode, count in fragment[0]["opCounts"].items()
        if 169 <= int(opcode) <= 191
    }
    return {
        "name": BLOOM_SHADER_NAME.decode("ascii"),
        "nameOffset": name_offset,
        "platforms": [18],
        "compressedBlobOffset": blob_offset,
        "compressedLength": compressed_length,
        "decompressedLength": decompressed_length,
        "compressedSha256": sha256(compressed),
        "decompressedSha256": sha256(decompressed),
        "moduleCount": len(modules),
        "passCountFromModulePairs": len(modules) // 2,
        "modules": modules,
        "math": {
            "pass0": {
                "operation": "rgb *= rgb * (rgb * a + b) + c",
                "constantBits": pass0_bits,
                "imageSampleCount": fragment[0]["opCounts"].get("87", 0),
                "fAddCount": fragment[0]["opCounts"].get("129", 0),
                "fMulCount": fragment[0]["opCounts"].get("133", 0),
                "thresholdOrKneeDetected": bool(
                    pass0_threshold_ops or fragment[0]["extendedInstructionNumbers"]
                ),
            },
            "pass1": {
                "operation": "four diagonal samples, component-wise max",
                "imageSampleCount": fragment[1]["opCounts"].get("87", 0),
                "fMaxExtInstruction": 40,
                "fMaxCount": pass1_ext.count(40),
            },
            "pass3": {
                "operation": "symmetric 8-tap directional blur",
                "tapU32Bits": [f"0x{value:08x}" for value in pass3_taps],
                "tapFloats": [struct.unpack("<f", struct.pack("<I", value))[0] for value in pass3_taps],
                "staticImageSampleInstructions": fragment[3]["opCounts"].get("87", 0),
                "loopMergeCount": fragment[3]["opCounts"].get("246", 0),
            },
            "pass5": {
                "operation": "single texture sample and store",
                "imageSampleCount": fragment[5]["opCounts"].get("87", 0),
                "arithmeticOpcodes124To200": pass5_arithmetic,
                "toneMapDetected": bool(pass5_arithmetic),
            },
        },
    }


def extract(apkm_path: Path) -> dict:
    apkm = apkm_path.read_bytes()
    with zipfile.ZipFile(io.BytesIO(apkm)) as outer:
        base_apk = outer.read("base.apk")
        arm64_split = outer.read("split_config.arm64_v8a.apk")
    with zipfile.ZipFile(io.BytesIO(base_apk)) as apk:
        globalgamemanagers = apk.read(GGM_PATH)
        resource_parts = []
        index = 0
        while True:
            name = f"{GGM_RESOURCE_PREFIX}{index}"
            try:
                data = apk.read(name)
            except KeyError:
                break
            resource_parts.append((name, data))
            index += 1
    if not resource_parts:
        raise RuntimeError("globalgamemanagers.assets.split* was not found in base.apk")
    with zipfile.ZipFile(io.BytesIO(arm64_split)) as apk:
        libil2cpp = apk.read(IL2CPP_PATH)
    resource = b"".join(data for _, data in resource_parts)
    serialized_postprocess = decode_serialized_postprocess(resource, resource_parts)
    buffer_size_field = serialized_postprocess["bloomVolumes"][0]["fields"]["bufferSize"]["value"]

    return {
        "source": {
            "apkm": str(apkm_path.resolve()),
            "apkmSha256": sha256(apkm),
            "baseApkSha256": sha256(base_apk),
            "arm64SplitSha256": sha256(arm64_split),
            "globalgamemanagersPath": GGM_PATH,
            "globalgamemanagersSha256": sha256(globalgamemanagers),
            "globalgamemanagersResourceSha256": sha256(resource),
            "globalgamemanagersResourceSize": len(resource),
            "globalgamemanagersResourceParts": [
                {"path": name, "size": len(data), "sha256": sha256(data)} for name, data in resource_parts
            ],
            "libil2cppPath": IL2CPP_PATH,
            "libil2cppSha256": sha256(libil2cpp),
        },
        "serializedPostProcess": serialized_postprocess,
        "native": decode_native_pipeline(libil2cpp, buffer_size_field),
        "bloomShader": decode_bloom_shader(resource),
        "claims": {
            "mrt": "Two ARGB32 color attachments plus 24-bit Depth and CopyDepth; no format inference beyond Unity enum values.",
            "passGraph": "Pass order is decoded from CustomRenderer.Setup; optional branch predicates remain explicit.",
            "bloom": "Pass 0/1/3 math and pass 5 no-tone-map are limited to this exact official Bloom module set.",
            "serializedBloom": "PostProcessData, profile/component membership, BloomPass, and BloomVolume values are decoded from raw serialized objects because embedded custom MonoBehaviour type trees are stripped.",
            "bloomSizing": "The 9:16 base/pass-0/sheet dimensions are derived from GetBufferSize/BloomPass.Execute ARM64 immediates and the serialized BloomVolume bufferSize.",
            "finalBlit": "Only the exact FinalBlit IL2CPP body range is pinned; its final shader and tone-map semantics remain unproven.",
            "mrtOutputs": "Per-material MRT1 formulas and keyword variants are audited separately by audit:official-mrt-outputs.",
        },
        "unproven": [
            "Bloom sheet vertex weights/intensity-scatter encoding and the complete per-level downsample/blur render-target size sequence.",
            "FinalBlit shader selection, blend semantics, and any final tone mapping beyond the pinned IL2CPP body bytes.",
            "Physical Vulkan image formats selected by a particular Android device for Unity ARGB32/Depth enums.",
        ],
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--apkm",
        type=Path,
        default=Path(os.environ.get("PCR_APKM", DEFAULT_APKM)),
        help="Official Android APKM path (default: PCR_APKM or upstream local package)",
    )
    args = parser.parse_args()
    if not args.apkm.is_file():
        parser.error(f"APKM not found: {args.apkm}")
    json.dump(extract(args.apkm), sys.stdout, ensure_ascii=True, indent=2)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
