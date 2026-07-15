#!/usr/bin/env python3
"""Extract official opaque/transparent pass and per-draw queue evidence.

The method RVAs are locators for the package-matched 1.6.0 APKM. Reported
instructions, hashes, serialized camera fields, Renderer Material PPtrs, and
Material/Shader queue fields are read from the official inputs at runtime.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import re
import struct
import sys
import zipfile

sys.dont_write_bytecode = True

try:
    import UnityPy
except ImportError as exc:  # pragma: no cover - research environment dependency
    raise SystemExit("UnityPy is required: python -m pip install UnityPy") from exc

try:
    from capstone import Cs, CS_ARCH_ARM64, CS_MODE_ARM
except ImportError as exc:  # pragma: no cover - research environment dependency
    raise SystemExit("capstone is required: python -m pip install capstone") from exc

try:
    from Crypto.Cipher import AES
except ImportError as exc:  # pragma: no cover - research environment dependency
    raise SystemExit("pycryptodome is required: python -m pip install pycryptodome") from exc


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_APKM = ROOT.parent / "ptcg-apk-parser" / "apks" / "jp.pokemon.pokemontcgp_1.6.0.apkm"
DEFAULT_DECRYPTED_ROOT = (
    ROOT.parent
    / "ptcgp-tools-master"
    / "masterdata_decoder"
    / ".output"
    / "decrypted"
)
IL2CPP_PATH = "lib/arm64-v8a/libil2cpp.so"
METADATA_PATH = "assets/bin/Data/Managed/Metadata/global-metadata.dat"
GGM_PATH = "assets/bin/Data/globalgamemanagers"
LEVEL_PREFIX = "assets/bin/Data/level"
DATA_RESOURCE_RE = re.compile(r"assets/bin/Data/[0-9a-f]{32}$")
STRING_LITERAL_USAGE_BASE = 0x7542A00
METADATA_KEY_TABLE_RVA = 0x7A52554
METADATA_KEY_TABLE = bytes.fromhex("b195674699a63503e79e67149da46f04")
METADATA_KEY8 = (0x610D92FB7605ACD4).to_bytes(8, "little")
SHADER_TAG_CTOR = "#0x654a64c"
SHADER_TAG_LIST_ADD = "#0x30a5ae8"

METHODS = {
    "customRendererSetup": ("Lettuce.Graphics.Rendering.CustomRenderer.Setup", 0x430C2A8, 0x430C39C),
    "drawOpaqueCtor": ("Lettuce.Graphics.Rendering.DrawOpaquePass..ctor", 0x430B714, 0x430BA24),
    "drawOpaqueExecute": ("Lettuce.Graphics.Rendering.DrawOpaquePass.Execute", 0x430D3E8, 0x430D694),
    "drawOpaqueOnCameraSetup": ("Lettuce.Graphics.Rendering.DrawOpaquePass.OnCameraSetup", 0x430D3C4, 0x430D3E8),
    "drawTransparentCtor": ("Lettuce.Graphics.Rendering.DrawTransparentPass..ctor", 0x430BBD0, 0x430BEE0),
    "drawTransparentExecute": ("Lettuce.Graphics.Rendering.DrawTransparentPass.Execute", 0x430D938, 0x430DCC0),
    "drawTransparentOnCameraSetup": ("Lettuce.Graphics.Rendering.DrawTransparentPass.OnCameraSetup", 0x430D914, 0x430D938),
    "renderQueueOpaque": ("UnityEngine.Rendering.RenderQueueRange.get_opaque", 0x6545FB8, 0x6545FC0),
    "renderQueueTransparent": ("UnityEngine.Rendering.RenderQueueRange.get_transparent", 0x6545FC0, 0x6545FCC),
    "filteringSettingsCtor": ("UnityEngine.Rendering.FilteringSettings..ctor", 0x6543C08, 0x6543D88),
    "asset3DCreateRenderStudio": (
        "Lettuce.Infrastructure.Asset3D.Core.Asset3DRenderer.CreateRenderStudio",
        0x4395810,
        0x43958BC,
    ),
    "cardRendererLayerName": (
        "Lettuce.Infrastructure.Card.Core.CardRenderer.get_LayerName",
        0x4444924,
        0x4444964,
    ),
}

PASS_SIGNATURES = {
    "DrawOpaque": {
        "ctor": {
            0x430B85C: "mov w8, #0xfa",
            0x430B868: "stur w8, [x0, #-0xd0]",
        },
        "execute": {
            0x430D4F0: "ldr x1, [x21, #0xe8]",
            0x430D500: "mov w3, #0x3b",
            0x430D508: "bl #0x63c3f70",
            0x430D538: "bl #0x6545fb8",
            0x430D560: "cbz x0, #0x430d61c",
            0x430D568: "bl #0x64db88c",
            0x430D570: "mov w3, w0",
            0x430D57C: "mov w4, #-1",
            0x430D580: "mov w5, wzr",
            0x430D584: "mov x6, xzr",
            0x430D588: "bl #0x6543c08",
            0x430D5A0: "bl #0x6548f1c",
        },
        "renderPassEvent": 250,
        "sortingCriteria": 59,
        "sortingName": "CommonOpaque",
        "rangeMethod": "renderQueueOpaque",
    },
    "DrawTransparent": {
        "ctor": {
            0x430BD18: "mov w8, #0x1c2",
            0x430BD24: "stur w8, [x0, #-0xd0]",
        },
        "execute": {
            0x430DAF4: "ldr x1, [x21, #0xe8]",
            0x430DB04: "mov w3, #0x17",
            0x430DB0C: "bl #0x63c3f70",
            0x430DB3C: "bl #0x6545fc0",
            0x430DB64: "cbz x0, #0x430dc24",
            0x430DB6C: "bl #0x64db88c",
            0x430DB74: "mov w3, w0",
            0x430DB80: "mov w4, #-1",
            0x430DB84: "mov w5, wzr",
            0x430DB88: "mov x6, xzr",
            0x430DB8C: "bl #0x6543c08",
            0x430DBA4: "bl #0x6548f1c",
        },
        "renderPassEvent": 450,
        "sortingCriteria": 23,
        "sortingName": "CommonTransparent",
        "rangeMethod": "renderQueueTransparent",
    },
}

QUEUE_BASES = {
    "Background": 1000,
    "Geometry": 2000,
    "AlphaTest": 2450,
    "Transparent": 3000,
    "Overlay": 4000,
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
            offset = phoff + index * phentsize
            p_type, _, p_offset, p_vaddr, _, p_filesz, _, _ = struct.unpack_from(
                "<IIQQQQQQ", data, offset
            )
            if p_type == 1:
                self.loads.append((p_offset, p_vaddr, p_filesz))

        shoff = struct.unpack_from("<Q", data, 40)[0]
        shentsize, shnum, shstrndx = struct.unpack_from("<HHH", data, 58)
        shstr_header = shoff + shstrndx * shentsize
        shstr_offset = struct.unpack_from("<Q", data, shstr_header + 24)[0]
        self.sections = {}
        for index in range(shnum):
            header = shoff + index * shentsize
            name_offset = struct.unpack_from("<I", data, header)[0]
            end = data.index(b"\0", shstr_offset + name_offset)
            name = data[shstr_offset + name_offset : end].decode("ascii")
            address, offset, size = struct.unpack_from("<QQQ", data, header + 16)
            self.sections[name] = (address, offset, size)

    def rva_to_offset(self, rva: int) -> int:
        for offset, vaddr, size in self.loads:
            if vaddr <= rva < vaddr + size:
                return offset + rva - vaddr
        raise RuntimeError(f"RVA 0x{rva:x} is outside ELF file-backed PT_LOAD segments")

    def range(self, start: int, end: int) -> bytes:
        offset = self.rva_to_offset(start)
        data = self.data[offset : offset + end - start]
        if len(data) != end - start:
            raise RuntimeError(f"short ELF range at RVA 0x{start:x}")
        return data

    def relocations(self) -> dict[int, dict]:
        try:
            _, offset, size = self.sections[".rela.dyn"]
        except KeyError as exc:
            raise RuntimeError("libil2cpp has no .rela.dyn section") from exc
        rows = {}
        for cursor in range(offset, offset + size, 24):
            raw = self.data[cursor : cursor + 24]
            target, info, addend = struct.unpack("<QQq", raw)
            rows[target] = {
                "targetRva": f"0x{target:x}",
                "type": info & 0xFFFFFFFF,
                "symbol": info >> 32,
                "addendRva": f"0x{addend:x}",
                "sectionFileOffset": cursor,
                "bytesHex": raw.hex(),
                "sha256": sha256(raw),
                "addend": addend,
            }
        return rows


def decrypt_global_metadata(encrypted: bytes, elf: Elf64) -> tuple[bytes, dict]:
    table = elf.range(METADATA_KEY_TABLE_RVA, METADATA_KEY_TABLE_RVA + 16)
    if table != METADATA_KEY_TABLE:
        raise RuntimeError("metadata AES key table changed in libil2cpp")
    if len(encrypted) < 4:
        raise RuntimeError("encrypted global-metadata.dat is truncated")
    declared_size = struct.unpack_from("<I", encrypted)[0]
    ciphertext = encrypted[4:]
    if declared_size != len(ciphertext):
        raise RuntimeError(
            f"encrypted metadata size mismatch: header={declared_size}, bytes={len(ciphertext)}"
        )
    key = bytes(table[index] ^ METADATA_KEY8[index & 7] for index in range(16))
    cipher = AES.new(key, AES.MODE_ECB)
    plaintext = bytearray()
    for offset in range(0, len(ciphertext), 16):
        block = ciphertext[offset : offset + 16]
        counter = (offset // 16 + 1).to_bytes(16, "big")
        stream = cipher.encrypt(counter)
        plaintext.extend(left ^ right for left, right in zip(block, stream))
    plaintext = bytes(plaintext)
    magic, version = struct.unpack_from("<II", plaintext)
    if magic != 0xFAB11BAF:
        raise RuntimeError(f"decrypted metadata has bad magic 0x{magic:08x}")
    return plaintext, {
        "path": METADATA_PATH,
        "encryptedByteSize": len(encrypted),
        "encryptedSha256": sha256(encrypted),
        "plaintextByteSize": len(plaintext),
        "plaintextSha256": sha256(plaintext),
        "magic": f"0x{magic:08x}",
        "version": version,
        "keyTableRva": f"0x{METADATA_KEY_TABLE_RVA:x}",
        "keyTableBytesHex": table.hex(),
        "keyTableSha256": sha256(table),
    }


class MetadataLiterals:
    def __init__(self, data: bytes):
        self.data = data
        magic, self.version = struct.unpack_from("<II", data)
        if magic != 0xFAB11BAF:
            raise RuntimeError("global metadata magic changed")
        (
            self.table_offset,
            self.table_size,
            self.data_offset,
            self.data_size,
        ) = struct.unpack_from("<IIII", data, 8)
        if self.table_size % 8:
            raise RuntimeError("metadata string literal table is not record-aligned")
        self.count = self.table_size // 8
        if self.table_offset + self.table_size > len(data):
            raise RuntimeError("metadata string literal table exceeds plaintext")
        if self.data_offset + self.data_size > len(data):
            raise RuntimeError("metadata string literal data exceeds plaintext")

    def resolve_usage(self, usage_address: int) -> dict:
        delta = usage_address - STRING_LITERAL_USAGE_BASE
        if delta < 0 or delta % 8:
            raise RuntimeError(f"0x{usage_address:x} is not an aligned string literal usage")
        index = delta // 8
        if index >= self.count:
            raise RuntimeError(f"string literal usage index {index} exceeds metadata table")
        record_offset = self.table_offset + index * 8
        record = self.data[record_offset : record_offset + 8]
        length, relative_offset = struct.unpack("<II", record)
        literal_offset = self.data_offset + relative_offset
        literal = self.data[literal_offset : literal_offset + length]
        if len(literal) != length:
            raise RuntimeError(f"short metadata string literal at index {index}")
        try:
            value = literal.decode("utf-8")
        except UnicodeDecodeError as exc:
            raise RuntimeError(f"metadata string literal {index} is not UTF-8") from exc
        return {
            "usageAddress": f"0x{usage_address:x}",
            "usageTableBase": f"0x{STRING_LITERAL_USAGE_BASE:x}",
            "index": index,
            "recordFileOffset": record_offset,
            "recordBytesHex": record.hex(),
            "recordSha256": sha256(record),
            "utf8FileOffset": literal_offset,
            "utf8BytesHex": literal.hex(),
            "utf8Sha256": sha256(literal),
            "value": value,
        }


def disassemble(elf: Elf64, start: int, end: int):
    return list(Cs(CS_ARCH_ARM64, CS_MODE_ARM).disasm(elf.range(start, end), start))


def instruction_map(instructions) -> dict[int, str]:
    return {item.address: f"{item.mnemonic} {item.op_str}".strip() for item in instructions}


def require_instructions(instructions, expected: dict[int, str], label: str) -> None:
    actual = instruction_map(instructions)
    mismatches = [
        f"0x{address:x}: expected {text!r}, got {actual.get(address)!r}"
        for address, text in expected.items()
        if actual.get(address) != text
    ]
    if mismatches:
        raise RuntimeError(f"{label} ARM64 signature changed: {'; '.join(mismatches)}")


def instruction_evidence(instructions, addresses: list[int]) -> list[dict]:
    by_address = {item.address: item for item in instructions}
    return [
        {
            "address": f"0x{address:x}",
            "bytesHex": bytes(by_address[address].bytes).hex(),
            "text": f"{by_address[address].mnemonic} {by_address[address].op_str}".strip(),
        }
        for address in addresses
    ]


def method_evidence(elf: Elf64, key: str) -> dict:
    name, start, end = METHODS[key]
    body = elf.range(start, end)
    return {
        "key": key,
        "name": name,
        "rva": f"0x{start:x}",
        "endRvaExclusive": f"0x{end:x}",
        "bodySize": len(body),
        "bodySha256": sha256(body),
    }


def literal_slot_evidence(
    relocations: dict[int, dict], literals: MetadataLiterals, slot: int
) -> dict:
    try:
        relocation = dict(relocations[slot])
    except KeyError as exc:
        raise RuntimeError(f"metadata usage slot 0x{slot:x} has no ELF relocation") from exc
    if relocation["type"] != 1027 or relocation["symbol"] != 0:
        raise RuntimeError(
            f"metadata usage slot 0x{slot:x} has unexpected relocation "
            f"type={relocation['type']} symbol={relocation['symbol']}"
        )
    literal = literals.resolve_usage(relocation.pop("addend"))
    return {
        "slotRva": f"0x{slot:x}",
        "relocation": relocation,
        "metadataLiteral": literal,
        "value": literal["value"],
    }


def decode_shader_tag_ids(
    elf: Elf64,
    instructions,
    relocations: dict[int, dict],
    literals: MetadataLiterals,
    pass_name: str,
) -> list[dict]:
    pages: dict[str, int] = {}
    slots: dict[str, tuple[int, object]] = {}
    constructor_rows = []
    list_adds = [
        item
        for item in instructions
        if item.mnemonic == "bl" and item.op_str == SHADER_TAG_LIST_ADD
    ]
    for index, item in enumerate(instructions):
        if item.mnemonic == "adrp":
            match = re.fullmatch(r"(x\d+), #(0x[0-9a-f]+)", item.op_str)
            if match:
                pages[match.group(1)] = int(match.group(2), 0)
            continue
        if item.mnemonic == "ldr":
            match = re.fullmatch(
                r"(x\d+), \[(x\d+)(?:, #(0x[0-9a-f]+|\d+))?\]", item.op_str
            )
            if match and match.group(2) in pages:
                destination, base = match.group(1), match.group(2)
                slot = pages[base] + int(match.group(3) or "0", 0)
                slots[destination] = (slot, item)
        if item.mnemonic != "bl" or item.op_str != SHADER_TAG_CTOR:
            continue
        dereference = next(
            (
                prior
                for prior in reversed(instructions[max(0, index - 8) : index])
                if re.fullmatch(r"x1, \[x\d+\]", prior.op_str)
            ),
            None,
        )
        if dereference is None:
            raise RuntimeError(f"{pass_name} ShaderTagId constructor has no string dereference")
        register = re.fullmatch(r"x1, \[(x\d+)\]", dereference.op_str).group(1)
        if register not in slots:
            raise RuntimeError(f"{pass_name} ShaderTagId string register {register} has no usage slot")
        slot, slot_load = slots[register]
        constructor_rows.append((slot, slot_load, dereference, item))
    if len(constructor_rows) != 7 or len(list_adds) != 7:
        raise RuntimeError(
            f"{pass_name} ShaderTagId shape changed: "
            f"constructors={len(constructor_rows)}, adds={len(list_adds)}"
        )
    rows = []
    for order, ((slot, slot_load, dereference, constructor), list_add) in enumerate(
        zip(constructor_rows, list_adds)
    ):
        literal = literal_slot_evidence(relocations, literals, slot)
        rows.append(
            {
                "order": order,
                "value": literal["value"],
                "metadataUsage": literal,
                "instructions": {
                    "usageSlotLoad": instruction_evidence([slot_load], [slot_load.address])[0],
                    "stringDereference": instruction_evidence(
                        [dereference], [dereference.address]
                    )[0],
                    "shaderTagIdConstructor": instruction_evidence(
                        [constructor], [constructor.address]
                    )[0],
                    "listAdd": instruction_evidence([list_add], [list_add.address])[0],
                },
            }
        )
    return rows


def decode_asset3d_native_evidence(
    elf: Elf64, decoded: dict, relocations: dict[int, dict], literals: MetadataLiterals
) -> dict:
    require_instructions(
        decoded["asset3DCreateRenderStudio"],
        {
            0x439582C: "ldr x20, [x20, #0xf98]",
            0x4395880: "ldr x0, [x20]",
            0x4395888: "bl #0x32828b8",
        },
        METHODS["asset3DCreateRenderStudio"][0],
    )
    require_instructions(
        decoded["cardRendererLayerName"],
        {
            0x4444938: "ldr x20, [x20, #0x388]",
            0x4444954: "ldr x0, [x20]",
            0x4444960: "ret",
        },
        METHODS["cardRendererLayerName"][0],
    )
    resource_path = literal_slot_evidence(relocations, literals, 0x6C46F98)
    layer_name = literal_slot_evidence(relocations, literals, 0x6C4B388)
    if resource_path["value"] != "Lettuce.Infrastructure.Asset3D.Core/ModelRenderStudio":
        raise RuntimeError("Asset3DRenderer ModelRenderStudio resource path changed")
    if layer_name["value"] != "UICardViewRenderer":
        raise RuntimeError("CardRenderer layer name changed")
    return {
        "resourceLoader": {
            "method": method_evidence(elf, "asset3DCreateRenderStudio"),
            "resourcePath": resource_path,
            "instructions": instruction_evidence(
                decoded["asset3DCreateRenderStudio"], [0x439582C, 0x4395880, 0x4395888]
            ),
        },
        "cardLayer": {
            "method": method_evidence(elf, "cardRendererLayerName"),
            "layerName": layer_name,
            "instructions": instruction_evidence(
                decoded["cardRendererLayerName"], [0x4444938, 0x4444954, 0x4444960]
            ),
        },
    }


def decode_x0_constant(instructions) -> int:
    value = 0
    initialized = False
    for item in instructions:
        if item.mnemonic == "ret":
            break
        if item.mnemonic == "mov" and item.op_str.startswith("x0, #"):
            value = int(item.op_str.split("#", 1)[1], 0)
            initialized = True
        elif item.mnemonic == "movk" and item.op_str.startswith("x0, #"):
            match = re.fullmatch(r"x0, #(0x[0-9a-f]+|\d+), lsl #(\d+)", item.op_str)
            if not match or not initialized:
                raise RuntimeError(f"cannot decode queue getter instruction: {item.op_str}")
            immediate, shift = int(match.group(1), 0), int(match.group(2))
            value = (value & ~(0xFFFF << shift)) | (immediate << shift)
        else:
            raise RuntimeError(f"unexpected queue getter instruction: {item.mnemonic} {item.op_str}")
    if not initialized:
        raise RuntimeError("queue getter did not initialize x0")
    return value


def decode_native_partition(libil2cpp: bytes, metadata: bytes) -> dict:
    elf = Elf64(libil2cpp)
    relocations = elf.relocations()
    literals = MetadataLiterals(metadata)
    decoded = {
        key: disassemble(elf, start, end)
        for key, (_, start, end) in METHODS.items()
    }
    require_instructions(
        decoded["customRendererSetup"],
        {
            0x430C2D8: "ldr x1, [x19, #0x1b8]",
            0x430C2E4: "bl #0x63cf4e4",
            0x430C324: "ldr x1, [x19, #0x1d0]",
            0x430C330: "bl #0x63cf4e4",
        },
        METHODS["customRendererSetup"][0],
    )
    setup_signature = {
        0xC: "ldr x1, [x8, #0x498]",
        0x10: "mov x3, xzr",
        0x14: "ldr x2, [x8, #0x30]",
    }
    setup_rows = []
    for key in ("drawOpaqueOnCameraSetup", "drawTransparentOnCameraSetup"):
        _, start, _ = METHODS[key]
        expected = {start + offset: text for offset, text in setup_signature.items()}
        expected[start + 0x1C] = "b #0x63c66ac"
        require_instructions(decoded[key], expected, METHODS[key][0])
        calls = [item for item in decoded[key] if item.mnemonic in {"b", "bl"}]
        if len(calls) != 2 or calls[0].op_str != "#0x63c66ac":
            raise RuntimeError(f"{METHODS[key][0]} contains an unexpected call/branch sequence")
        setup_rows.append(
            {
                "pass": "DrawOpaque" if key.startswith("drawOpaque") else "DrawTransparent",
                "method": method_evidence(elf, key),
                "colorTarget": "RendererData.MultiRenderTarget",
                "colorTargetFieldOffset": "0x498",
                "attachments": ["ColorRT", "EmissiveRT"],
                "depthTarget": "RendererData.DepthRT",
                "depthTargetFieldOffset": "0x30",
                "configureTargetBranch": "0x63c66ac",
                "clearCalls": [],
                "instructions": instruction_evidence(decoded[key], sorted(expected)),
            }
        )

    ranges = {}
    for key in ("renderQueueOpaque", "renderQueueTransparent"):
        packed = decode_x0_constant(decoded[key])
        ranges[key] = {
            "lowerBound": packed & 0xFFFFFFFF,
            "upperBound": packed >> 32,
            "packedHex": f"0x{packed:016x}",
            "method": method_evidence(elf, key),
            "instructions": instruction_evidence(
                decoded[key], [item.address for item in decoded[key]]
            ),
        }
    if (ranges["renderQueueOpaque"]["lowerBound"], ranges["renderQueueOpaque"]["upperBound"]) != (0, 2500):
        raise RuntimeError("opaque RenderQueueRange is not 0..2500")
    if (ranges["renderQueueTransparent"]["lowerBound"], ranges["renderQueueTransparent"]["upperBound"]) != (2501, 5000):
        raise RuntimeError("transparent RenderQueueRange is not 2501..5000")

    passes = []
    for pass_name, spec in PASS_SIGNATURES.items():
        prefix = "drawOpaque" if pass_name == "DrawOpaque" else "drawTransparent"
        ctor = decoded[f"{prefix}Ctor"]
        execute = decoded[f"{prefix}Execute"]
        require_instructions(ctor, spec["ctor"], METHODS[f"{prefix}Ctor"][0])
        require_instructions(execute, spec["execute"], METHODS[f"{prefix}Execute"][0])
        tag_rows = decode_shader_tag_ids(
            elf, ctor, relocations, literals, pass_name
        )
        tag_adds = [
            item for item in ctor
            if item.mnemonic == "bl" and item.op_str == SHADER_TAG_LIST_ADD
        ]
        range_row = ranges[spec["rangeMethod"]]
        passes.append(
            {
                "pass": pass_name,
                "renderPassEvent": spec["renderPassEvent"],
                "enqueueOrder": 1 if pass_name == "DrawOpaque" else 4,
                "renderQueueRange": {
                    "lowerBound": range_row["lowerBound"],
                    "upperBound": range_row["upperBound"],
                    "getter": range_row["method"]["name"],
                    "getterEvidence": range_row,
                },
                "sortingCriteria": {
                    "value": spec["sortingCriteria"],
                    "name": spec["sortingName"],
                    "keys": (
                        ["SortingLayer", "RenderQueue", "QuantizedFrontToBack", "OptimizeStateChanges", "CanvasOrder"]
                        if pass_name == "DrawOpaque"
                        else ["SortingLayer", "RenderQueue", "BackToFront", "OptimizeStateChanges"]
                    ),
                },
                "filteringSettings": {
                    "renderQueueRange": "proved",
                    "layerMaskSource": "RenderingData.cameraData.camera.cullingMask",
                    "layerMaskValue": None,
                    "renderingLayerMask": 0xFFFFFFFF,
                    "excludeMotionVectorObjects": False,
                    "shaderTagIdCount": len(tag_rows),
                    "shaderTagIdValues": [row["value"] for row in tag_rows],
                    "shaderTagIdEvidence": tag_rows,
                },
                "constructor": method_evidence(elf, f"{prefix}Ctor"),
                "execute": method_evidence(elf, f"{prefix}Execute"),
                "instructionEvidence": {
                    "constructor": instruction_evidence(ctor, sorted(spec["ctor"])),
                    "execute": instruction_evidence(execute, sorted(spec["execute"])),
                    "shaderTagListAdds": instruction_evidence(ctor, [item.address for item in tag_adds]),
                },
            }
        )

    return {
        "status": "partial",
        "passOrder": ["DrawOpaque", "DrawTransparent"],
        "setup": method_evidence(elf, "customRendererSetup"),
        "mrtBinding": {
            "status": "proved",
            "onCameraSetup": setup_rows,
            "sameColorAndDepthTargets": True,
            "clearBetweenOpaqueAndTransparent": False,
        },
        "filteringSettingsConstructor": method_evidence(elf, "filteringSettingsCtor"),
        "asset3D": decode_asset3d_native_evidence(
            elf, decoded, relocations, literals
        ),
        "passes": passes,
        "remaining": [
            "Resolve the runtime Asset3D card Camera cullingMask value; Execute proves that this camera property supplies FilteringSettings.layerMask.",
        ],
    }


def load_mrt_helpers():
    source = ROOT / "build" / "extract_official_mrt_outputs.py"
    spec = importlib.util.spec_from_file_location("pcr_official_mrt_helpers", source)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot import official bundle helpers: {source}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def queue_tag(shader: dict) -> str | None:
    subshaders = (shader.get("m_ParsedForm") or {}).get("m_SubShaders") or []
    if not subshaders:
        return None
    tags = (subshaders[0].get("m_Tags") or {}).get("tags") or []
    for pair in tags:
        if isinstance(pair, (list, tuple)) and len(pair) == 2 and str(pair[0]).lower() == "queue":
            return str(pair[1])
    return None


def resolve_shader_queue(tag: str | None) -> tuple[int | None, str]:
    if tag is None:
        return QUEUE_BASES["Geometry"], "serialized shader has no Queue tag; ShaderLab default Geometry"
    match = re.fullmatch(r"([A-Za-z]+)([+-]\d+)?", tag)
    if not match or match.group(1) not in QUEUE_BASES:
        return None, f"unresolved serialized Shader Queue tag {tag!r}"
    offset = int(match.group(2) or 0)
    return QUEUE_BASES[match.group(1)] + offset, f"serialized Shader Queue tag {tag}"


def extract_prefab_draws(decrypted_root: Path) -> dict:
    mrt = load_mrt_helpers()
    cards = tuple(mrt.OFFICIAL_CARDS)
    prefabs = [mrt.prefab_bundle(decrypted_root, card) for card in cards]
    missing = [path for path in prefabs if not path.is_file()]
    if missing:
        raise RuntimeError(f"official prefab bundle missing: {missing[0]}")

    index = mrt.OfficialBundleIndex(decrypted_root)
    index.build(prefabs)
    output_cards = []
    draws = []
    for card, prefab in zip(cards, prefabs):
        _, objects = index.load(prefab)
        renderers = sorted(
            (obj for obj in objects.values() if obj.type.name == "MeshRenderer"),
            key=lambda obj: int(obj.path_id),
        )
        card_draws = []
        for renderer in renderers:
            renderer_tree = renderer.read_typetree()
            game_object_pointer = renderer_tree.get("m_GameObject") or {}
            game_object_name = None
            game_object_active = None
            if int(game_object_pointer.get("m_PathID", 0)):
                game_object, _, _ = index.resolve(renderer, prefab, game_object_pointer)
                game_object_tree = game_object.read_typetree()
                game_object_name = game_object_tree.get("m_Name")
                game_object_active = bool(game_object_tree.get("m_IsActive", True))

            for material_slot, pointer in enumerate(renderer_tree.get("m_Materials") or []):
                material_obj, material_bundle, material_pptr = index.resolve(renderer, prefab, pointer)
                if material_obj.type.name != "Material":
                    raise RuntimeError(f"Renderer {renderer.path_id} slot {material_slot} is not a Material")
                material = material_obj.read_typetree()
                shader_obj, shader_bundle, shader_pptr = index.resolve(
                    material_obj, material_bundle, material.get("m_Shader") or {}
                )
                if shader_obj.type.name != "Shader":
                    raise RuntimeError(f"Material {material.get('m_Name')} shader PPtr is not a Shader")
                shader = shader_obj.read_typetree()
                shader_name = str((shader.get("m_ParsedForm") or {}).get("m_Name", ""))
                custom_queue = int(material.get("m_CustomRenderQueue", -1))
                tag = queue_tag(shader)
                shader_queue, shader_derivation = resolve_shader_queue(tag)
                if custom_queue >= 0:
                    effective_queue = custom_queue
                    derivation = "serialized Material.m_CustomRenderQueue"
                else:
                    effective_queue = shader_queue
                    derivation = shader_derivation
                if effective_queue is None:
                    official_pass = None
                elif 0 <= effective_queue <= 2500:
                    official_pass = "DrawOpaque"
                elif 2501 <= effective_queue <= 5000:
                    official_pass = "DrawTransparent"
                else:
                    official_pass = None
                draw = {
                    "key": f"{card}:{renderer.path_id}:{material_slot}",
                    "card": card,
                    "rendererPathId": str(renderer.path_id),
                    "rendererEnabled": bool(renderer_tree.get("m_Enabled", True)),
                    "gameObject": game_object_name,
                    "gameObjectActive": game_object_active,
                    "sortingOrder": int(renderer_tree.get("m_SortingOrder", 0)),
                    "sortingLayerId": int(renderer_tree.get("m_SortingLayerID", 0)),
                    "sortingLayer": int(renderer_tree.get("m_SortingLayer", 0)),
                    "renderingLayerMask": int(renderer_tree.get("m_RenderingLayerMask", 0)),
                    "rendererPriority": int(renderer_tree.get("m_RendererPriority", 0)),
                    "materialSlot": material_slot,
                    "material": material.get("m_Name"),
                    "materialPathId": str(material_obj.path_id),
                    "materialRawSha256": sha256(bytes(material_obj.get_raw_data())),
                    "materialPPtr": material_pptr,
                    "shader": shader_name,
                    "shortShader": shader_name.split("/")[-1],
                    "shaderPathId": str(shader_obj.path_id),
                    "shaderRawSha256": sha256(bytes(shader_obj.get_raw_data())),
                    "shaderPPtr": shader_pptr,
                    "shaderBundle": index.relative(shader_bundle),
                    "customRenderQueue": custom_queue,
                    "shaderQueueTag": tag,
                    "effectiveQueue": effective_queue,
                    "queueDerivation": derivation,
                    "officialPass": official_pass,
                }
                card_draws.append(draw)
                draws.append(draw)
        output_cards.append(
            {
                "card": card,
                "prefab": index.relative(prefab),
                "prefabSha256": index.bundle_hash(prefab),
                "meshRenderers": len(renderers),
                "draws": len(card_draws),
            }
        )
    return {
        "decryptedRoot": str(decrypted_root.resolve()),
        "cards": output_cards,
        "draws": draws,
        "summary": {
            "cards": len(output_cards),
            "meshRenderers": sum(card["meshRenderers"] for card in output_cards),
            "draws": len(draws),
            "enabledDraws": sum(draw["rendererEnabled"] and draw["gameObjectActive"] for draw in draws),
            "DrawOpaque": sum(draw["officialPass"] == "DrawOpaque" for draw in draws),
            "DrawTransparent": sum(draw["officialPass"] == "DrawTransparent" for draw in draws),
            "unassigned": sum(draw["officialPass"] is None for draw in draws),
        },
    }


def object_pointer_ids(tree: dict) -> list[int]:
    return [
        int((row.get("component") or {}).get("m_PathID", 0))
        for row in tree.get("m_Component") or []
    ]


def extract_asset3d_card_camera(apk: zipfile.ZipFile, globalgamemanagers: bytes) -> dict:
    candidates = []
    for info in apk.infolist():
        if not DATA_RESOURCE_RE.fullmatch(info.filename):
            continue
        data = apk.read(info)
        if b"ModelRenderStudio" not in data:
            continue
        try:
            environment = UnityPy.load(data)
        except Exception:
            continue
        objects = {int(obj.path_id): obj for obj in environment.objects}
        game_objects = {
            path_id: obj.read_typetree()
            for path_id, obj in objects.items()
            if obj.type.name == "GameObject"
        }
        studios = [
            (path_id, tree)
            for path_id, tree in game_objects.items()
            if tree.get("m_Name") == "ModelRenderStudio"
        ]
        if len(studios) != 1:
            continue
        studio_path_id, studio_tree = studios[0]
        studio_components = object_pointer_ids(studio_tree)
        studio_transforms = [
            path_id
            for path_id in studio_components
            if path_id in objects and objects[path_id].type.name == "Transform"
        ]
        if len(studio_transforms) != 1:
            continue
        studio_transform = studio_transforms[0]
        linked_cameras = []
        for camera in (obj for obj in environment.objects if obj.type.name == "Camera"):
            camera_tree = camera.read_typetree()
            game_object_path_id = int(
                (camera_tree.get("m_GameObject") or {}).get("m_PathID", 0)
            )
            game_object_tree = game_objects.get(game_object_path_id)
            if game_object_tree is None:
                continue
            transform_ids = [
                path_id
                for path_id in object_pointer_ids(game_object_tree)
                if path_id in objects and objects[path_id].type.name == "Transform"
            ]
            if len(transform_ids) != 1:
                continue
            transform_tree = objects[transform_ids[0]].read_typetree()
            father = int((transform_tree.get("m_Father") or {}).get("m_PathID", 0))
            if father != studio_transform:
                continue
            linked_cameras.append(
                (camera, camera_tree, game_object_path_id, game_object_tree, transform_ids[0])
            )
        if len(linked_cameras) == 1:
            candidates.append(
                (
                    info.filename,
                    data,
                    objects,
                    studio_path_id,
                    studio_tree,
                    studio_transform,
                    linked_cameras[0],
                )
            )
    if len(candidates) != 1:
        raise RuntimeError(
            f"expected one serialized ModelRenderStudio resource, found {len(candidates)}"
        )
    (
        resource_path,
        resource_data,
        objects,
        studio_path_id,
        studio_tree,
        studio_transform,
        linked_camera,
    ) = candidates[0]
    camera, camera_tree, camera_go_path_id, camera_go_tree, camera_transform = linked_camera
    mask = int((camera_tree.get("m_CullingMask") or {}).get("m_Bits", 0))
    mask_bytes = struct.pack("<I", mask)
    camera_raw = bytes(camera.get_raw_data())
    offsets = [
        offset
        for offset in range(len(camera_raw) - len(mask_bytes) + 1)
        if camera_raw.startswith(mask_bytes, offset)
    ]
    if len(offsets) != 1:
        raise RuntimeError(
            f"serialized ModelRenderStudio camera mask bytes occur {len(offsets)} times"
        )

    ggm_env = UnityPy.load(globalgamemanagers)
    tag_managers = [obj for obj in ggm_env.objects if obj.type.name == "TagManager"]
    if len(tag_managers) != 1:
        raise RuntimeError(f"expected one TagManager, found {len(tag_managers)}")
    tag_manager = tag_managers[0]
    tag_tree = tag_manager.read_typetree()
    layers = list(tag_tree.get("layers") or [])
    layer_name = "UICardViewRenderer"
    matching_layers = [index for index, value in enumerate(layers) if value == layer_name]
    if len(matching_layers) != 1:
        raise RuntimeError(f"expected one {layer_name} layer, found {matching_layers}")
    layer_index = matching_layers[0]
    if mask != 1 << layer_index:
        raise RuntimeError(
            f"ModelRenderStudio camera mask 0x{mask:08x} does not select {layer_name} "
            f"layer {layer_index}"
        )

    return {
        "status": "proved",
        "resourcePath": resource_path,
        "resourceByteSize": len(resource_data),
        "resourceSha256": sha256(resource_data),
        "studio": {
            "gameObjectPathId": str(studio_path_id),
            "gameObject": studio_tree.get("m_Name"),
            "gameObjectRawSha256": sha256(
                bytes(objects[studio_path_id].get_raw_data())
            ),
            "componentPathIds": [str(value) for value in object_pointer_ids(studio_tree)],
            "transformPathId": str(studio_transform),
            "transformRawSha256": sha256(
                bytes(objects[studio_transform].get_raw_data())
            ),
        },
        "camera": {
            "pathId": str(camera.path_id),
            "gameObjectPathId": str(camera_go_path_id),
            "gameObject": camera_go_tree.get("m_Name"),
            "gameObjectRawSha256": sha256(
                bytes(objects[camera_go_path_id].get_raw_data())
            ),
            "componentPathIds": [
                str(value) for value in object_pointer_ids(camera_go_tree)
            ],
            "transformPathId": str(camera_transform),
            "parentTransformPathId": str(studio_transform),
            "rawByteSize": len(camera_raw),
            "rawSha256": sha256(camera_raw),
            "cullingMask": mask,
            "cullingMaskHex": f"0x{mask:08x}",
            "cullingMaskFieldOffset": offsets[0],
            "cullingMaskBytesHex": mask_bytes.hex(),
            "cullingMaskBytesSha256": sha256(mask_bytes),
        },
        "layerSemantics": {
            "tagManagerPathId": str(tag_manager.path_id),
            "tagManagerRawSha256": sha256(bytes(tag_manager.get_raw_data())),
            "layerName": layer_name,
            "layerIndex": layer_index,
            "layerBit": 1 << layer_index,
            "cameraSelectsOnlyLayer": mask == 1 << layer_index,
        },
    }


def extract_serialized_scenes(base_apk: bytes) -> dict:
    with zipfile.ZipFile(io.BytesIO(base_apk)) as apk:
        globalgamemanagers = apk.read(GGM_PATH)
        ggm_env = UnityPy.load(globalgamemanagers)
        build_settings = next(
            (obj.read_typetree() for obj in ggm_env.objects if obj.type.name == "BuildSettings"),
            None,
        )
        if build_settings is None:
            raise RuntimeError("BuildSettings not found in globalgamemanagers")
        names = list(build_settings.get("scenes") or [])
        levels = []
        for index, scene_name in enumerate(names):
            path = f"{LEVEL_PREFIX}{index}"
            data = apk.read(path)
            environment = UnityPy.load(data)
            objects = {
                (str(obj.assets_file.name), int(obj.path_id)): obj
                for obj in environment.objects
            }
            cameras = []
            for obj in environment.objects:
                if obj.type.name != "Camera":
                    continue
                tree = obj.read_typetree()
                pointer = tree.get("m_GameObject") or {}
                game_object = objects.get((str(obj.assets_file.name), int(pointer.get("m_PathID", 0))))
                game_object_name = None
                if game_object is not None:
                    game_object_name = game_object.read_typetree().get("m_Name")
                mask = tree.get("m_CullingMask") or {}
                cameras.append(
                    {
                        "pathId": str(obj.path_id),
                        "gameObject": game_object_name,
                        "cullingMask": int(mask.get("m_Bits", 0)),
                    }
                )
            levels.append(
                {
                    "index": index,
                    "scene": scene_name,
                    "path": path,
                    "byteSize": len(data),
                    "sha256": sha256(data),
                    "cameras": cameras,
                }
            )
        asset3d_camera = extract_asset3d_card_camera(apk, globalgamemanagers)
    identified = [asset3d_camera["camera"]]
    return {
        "globalgamemanagersSha256": sha256(globalgamemanagers),
        "levels": levels,
        "asset3DCardCamera": asset3d_camera,
        "identifiedCardCameras": identified,
        "cardCameraCullingMaskStatus": "proved",
    }


def extract(apkm_path: Path, decrypted_root: Path) -> dict:
    apkm = apkm_path.read_bytes()
    with zipfile.ZipFile(io.BytesIO(apkm)) as outer:
        base_apk = outer.read("base.apk")
        arm64_apk = outer.read("split_config.arm64_v8a.apk")
    with zipfile.ZipFile(io.BytesIO(arm64_apk)) as apk:
        libil2cpp = apk.read(IL2CPP_PATH)
    with zipfile.ZipFile(io.BytesIO(base_apk)) as apk:
        encrypted_metadata = apk.read(METADATA_PATH)
    metadata, metadata_source = decrypt_global_metadata(
        encrypted_metadata, Elf64(libil2cpp)
    )
    native = decode_native_partition(libil2cpp, metadata)
    serialized_scenes = extract_serialized_scenes(base_apk)
    asset3d_camera = serialized_scenes["asset3DCardCamera"]
    native_resource = native["asset3D"]["resourceLoader"]["resourcePath"]["value"]
    native_layer = native["asset3D"]["cardLayer"]["layerName"]["value"]
    if native_resource.rsplit("/", 1)[-1] != asset3d_camera["studio"]["gameObject"]:
        raise RuntimeError("native Asset3D resource path does not match serialized studio root")
    if native_layer != asset3d_camera["layerSemantics"]["layerName"]:
        raise RuntimeError("native CardRenderer layer does not match serialized TagManager layer")
    camera_mask = asset3d_camera["camera"]["cullingMask"]
    for render_pass in native["passes"]:
        render_pass["filteringSettings"]["layerMaskValue"] = camera_mask
    native["status"] = "proved"
    native["remaining"] = [
        item
        for item in native["remaining"]
        if "Asset3D card Camera cullingMask" not in item
    ]
    return {
        "source": {
            "apkm": str(apkm_path.resolve()),
            "apkmSha256": sha256(apkm),
            "baseApkSha256": sha256(base_apk),
            "arm64SplitSha256": sha256(arm64_apk),
            "libil2cppPath": IL2CPP_PATH,
            "libil2cppSha256": sha256(libil2cpp),
            "metadata": metadata_source,
        },
        "native": native,
        "serializedScenes": serialized_scenes,
        "serializedPrefabs": extract_prefab_draws(decrypted_root),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--apkm",
        type=Path,
        default=Path(os.environ.get("PCR_APKM", DEFAULT_APKM)),
    )
    parser.add_argument(
        "--decrypted-root",
        type=Path,
        default=Path(os.environ.get("PCR_DECRYPTED_ROOT", DEFAULT_DECRYPTED_ROOT)),
    )
    parser.add_argument("--pretty", action="store_true")
    args = parser.parse_args()
    if not args.apkm.is_file():
        parser.error(f"APKM not found: {args.apkm}")
    if not args.decrypted_root.is_dir():
        parser.error(f"decrypted root not found: {args.decrypted_root}")
    json.dump(
        extract(args.apkm.resolve(), args.decrypted_root.resolve()),
        sys.stdout,
        ensure_ascii=True,
        indent=2 if args.pretty else None,
    )
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
