#!/usr/bin/env python3
"""Extract official 1.6.0 Homography runtime-wiring evidence.

The APKM supplies encrypted IL2CPP metadata and arm64 code. Decrypted official
Unity bundles supply the detail-card view, the PrerenderCard prefab, both
runtime-selected materials, and the Homography shader. Il2CppDumper output,
repository scenes/recipes, browser runtime files, generated reports, and
screenshots are not read.

Package-matched RVAs are locators only. Every reported method body, selected
instruction, metadata record, literal relocation, icall string, serialized
object, and PPtr is re-read from official bytes on each extraction.
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
import warnings
import zipfile


sys.dont_write_bytecode = True

try:
    import UnityPy
except ImportError as exc:  # pragma: no cover - research environment dependency
    raise SystemExit("UnityPy is required: python -m pip install UnityPy") from exc


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_APKM = (
    ROOT.parent / "ptcg-apk-parser" / "apks" /
    "jp.pokemon.pokemontcgp_1.6.0.apkm"
)
DEFAULT_DECRYPTED_ROOT = Path(
    "D:/DevProjectes/ptcgp-tools-master/masterdata_decoder/.output/decrypted"
)
UNITY_VERSION = "2022.3.62f2"
UNITY_DEFAULT_RESOURCES_PATH = "assets/bin/Data/unity default resources"
BUILTIN_QUAD_PATH_ID = 10210

PREFAB_RELATIVE_PATH = Path(
    "Common/CardNew/System/Prefabs/PrerenderCard.prefab_bundles"
)
DETAIL_VIEW_PREFAB_RELATIVE_PATH = Path(
    "Common/CardNew/System/Prefabs/L_Card_Base_Pokemon_RS.prefab_bundles"
)
PLAIN_MATERIAL_RELATIVE_PATH = Path(
    "Common/CardNew/System/Materials/PrerenderCard.mat_bundles"
)
HOMOGRAPHY_MATERIAL_RELATIVE_PATH = Path(
    "Common/CardNew/System/Materials/PrerenderHomographyCard.mat_bundles"
)
HOMOGRAPHY_SHADER_RELATIVE_PATH = Path(
    "Common/Shader/Common/CardNew/Prerender/HomographyCard_FromRT.shader_bundles"
)
HOMOGRAPHY_SHADER_NAME = (
    "Lettuce/Common/CardNew/Prerender/Homography(from RT)"
)

METADATA_METHODS_PAIR = 5
METADATA_FIELD_DEFAULTS_PAIR = 7
METADATA_DEFAULT_DATA_PAIR = 8
METADATA_FIELDS_PAIR = 11
METADATA_TYPES_PAIR = 19
METHOD_DEFINITION_SIZE = 36
FIELD_DEFAULT_SIZE = 12
FIELD_DEFINITION_SIZE = 12
TYPE_DEFINITION_SIZE = 88


def load_basis():
    source = ROOT / "build" / "extract_official_pass_partition.py"
    spec = importlib.util.spec_from_file_location(
        "pcr_homography_wiring_basis", source
    )
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load extraction helper: {source}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


BASIS = load_basis()
UnityPy.config.FALLBACK_UNITY_VERSION = UNITY_VERSION
warnings.filterwarnings("ignore", category=Warning, module=r"UnityPy\..*")


METHODS = {
    "modelCardViewInitializeMoveNext": (
        "ModelCardView.<Initialize>d__33.MoveNext", 0x44315FC, 0x4432678
    ),
    "cardPathsGetPrerenderCardMaterial": (
        "CardPaths.get_PrerenderCardMaterial", 0x444BB48, 0x444BC10
    ),
    "cardPathsGetPrerenderHomographyCardMaterial": (
        "CardPaths.get_PrerenderHomographyCardMaterial", 0x444BC10, 0x444BCD8
    ),
    "cardPathsImplPrerenderCardMaterial": (
        "CardPathsImpl.PrerenderCardMaterial", 0x4452260, 0x44522D0
    ),
    "cardPathsImplPrerenderHomographyCardMaterial": (
        "CardPathsImpl.PrerenderHomographyCardMaterial", 0x44522D0, 0x4452340
    ),
    "dynamicUIApply": (
        "DynamicUI.Apply", 0x442C834, 0x442C968
    ),
    "dynamicUITrySetTexture": (
        "DynamicUI.TrySetTexture", 0x442C968, 0x442CA8C
    ),
    "dynamicShaderPropertyGetPropertyId": (
        "DynamicShaderPropertyTypeExtensions.GetPropertyId",
        0x44511CC,
        0x445131C,
    ),
    "dynamicShaderPropertyCctor": (
        "DynamicShaderPropertyTypeExtensions..cctor", 0x445131C, 0x445148C
    ),
    "shaderPropertyToID": (
        "UnityEngine.Shader.PropertyToID", 0x64EBCBC, 0x64EBCF8
    ),
    "rendererSetMaterial": (
        "UnityEngine.Renderer.set_material", 0x64EC9EC, 0x64ECA30
    ),
    "materialCopyConstructor": (
        "UnityEngine.Material..ctor(Material)", 0x64F1F28, 0x64F1FB8
    ),
}


SIGNATURES = {
    "modelCardViewInitializeMoveNext": {
        0x44316F8: "ldr x20, [x19, #0x18]",
        0x4431B3C: "mov x21, x20",
        0x4431B40: "ldr x22, [x21, #0xa8]!",
        0x4431BA8: "ldrb w8, [x20, #0x28]",
        0x4431BAC: "cbz w8, #0x4431bbc",
        0x4431BB4: "bl #0x444bc10",
        0x4431BC0: "bl #0x444bb48",
        0x4431C7C: "mov x1, x22",
        0x4431C84: "blr x8",
        0x4431C8C: "str x1, [x21]",
        0x4431EA8: "ldr x21, [x20, #0xa8]",
        0x4431F04: "blr x8",
        0x4431F1C: "mov x1, x22",
        0x4431F24: "mov x21, x0",
        0x4431F28: "bl #0x64f1f28",
        0x4431F2C: "mov x22, x20",
        0x4431F30: "str x21, [x22, #0x58]!",
        0x4431F48: "mov x21, x20",
        0x4431F50: "ldr x0, [x21, #0x38]!",
        0x4431FBC: "bl #0x443d96c",
        0x4431FC0: "str x24, [x21]",
        0x443216C: "ldr x1, [x22]",
        0x4432178: "bl #0x64ec9ec",
        0x443219C: "mov x22, x20",
        0x44321A0: "str x1, [x22, #0x30]!",
        0x44321AC: "ldr x8, [x21]",
        0x44321B4: "ldr x0, [x22]",
        0x44321BC: "ldr x1, [x8, #0x40]",
        0x44321C0: "bl #0x442c834",
    },
    "cardPathsGetPrerenderCardMaterial": {
        0x444BB9C: "ldr x19, [x8]",
        0x444BBE0: "mov w2, #7",
        0x444BBFC: "ldp x2, x1, [x0]",
        0x444BC08: "br x2",
    },
    "cardPathsGetPrerenderHomographyCardMaterial": {
        0x444BC64: "ldr x19, [x8]",
        0x444BCA8: "mov w2, #8",
        0x444BCC4: "ldp x2, x1, [x0]",
        0x444BCD0: "br x2",
    },
    "cardPathsImplPrerenderCardMaterial": {
        0x44522A4: "ldr x8, [x0, #0xb8]",
        0x44522A8: "ldr x8, [x8, #0x10]",
        0x44522B0: "ldr x0, [x8, #0x10]",
        0x44522C0: "mov x0, x1",
    },
    "cardPathsImplPrerenderHomographyCardMaterial": {
        0x4452314: "ldr x8, [x0, #0xb8]",
        0x4452318: "ldr x8, [x8, #0x18]",
        0x4452320: "ldr x0, [x8, #0x10]",
        0x4452330: "mov x0, x1",
    },
    "dynamicUIApply": {
        0x442C888: "ldr x0, [x21]",
        0x442C88C: "ldr x21, [x19, #0x20]",
        0x442C8C4: "ldr x8, [x21, #0x30]!",
        0x442C8F8: "ldr x0, [x19, #0x20]",
        0x442C900: "ldr x1, [x19, #0x30]",
        0x442C908: "bl #0x64ec5a8",
        0x442C914: "ldr w22, [x19, #0x28]",
        0x442C930: "bl #0x44511cc",
        0x442C934: "mov w1, w0",
        0x442C938: "mov x0, x19",
        0x442C93C: "mov x2, x20",
        0x442C940: "bl #0x442c968",
        0x442C94C: "ldr x1, [x21]",
        0x442C960: "b #0x64ec510",
    },
    "dynamicUITrySetTexture": {
        0x442C978: "mov x21, x2",
        0x442C97C: "mov w19, w1",
        0x442C9A0: "ldr x0, [x20, #0x20]",
        0x442C9B4: "bl #0x64eca30",
        0x442C9F8: "mov w1, w19",
        0x442CA00: "bl #0x64f2ba8",
        0x442CA08: "cbnz x21, #0x442ca30",
        0x442CA20: "mov w1, w19",
        0x442CA28: "bl #0x64f23d4",
        0x442CA64: "ldr x0, [x20, #0x30]",
        0x442CA6C: "mov w1, w19",
        0x442CA70: "mov x2, x21",
        0x442CA84: "b #0x64ebee8",
    },
    "dynamicShaderPropertyGetPropertyId": {
        0x44511F8: "cmp w19, #5",
        0x4451208: "add x9, x9, #0x2e8",
        0x445120C: "adr x10, #0x445121c",
        0x4451210: "ldrb w11, [x9, x8]",
        0x4451218: "br x10",
        0x445121C: "adrp x19, #0x6c4a000",
        0x4451220: "ldr x19, [x19, #0xc90]",
        0x4451238: "ldr x8, [x0, #0xb8]",
        0x445123C: "b #0x445130c",
        0x445130C: "ldr w0, [x8]",
    },
    "dynamicShaderPropertyCctor": {
        0x4451350: "ldr x26, [x26, #0xc80]",
        0x44513D0: "ldr x0, [x26]",
        0x44513D8: "bl #0x64ebcbc",
        0x44513E4: "ldr x9, [x8, #0xb8]",
        0x44513EC: "str w0, [x9]",
        0x44513F4: "bl #0x64ebcbc",
        0x4451408: "str w0, [x9, #4]",
        0x4451410: "bl #0x64ebcbc",
        0x4451424: "str w0, [x9, #8]",
        0x445142C: "bl #0x64ebcbc",
        0x4451440: "str w0, [x9, #0xc]",
        0x4451448: "bl #0x64ebcbc",
        0x445145C: "str w0, [x9, #0x10]",
        0x4451464: "bl #0x64ebcbc",
        0x4451480: "str w0, [x8, #0x14]",
    },
    "shaderPropertyToID": {
        0x64EBCD4: "adrp x0, #0x1ae2000",
        0x64EBCD8: "add x0, x0, #0x40f",
        0x64EBCDC: "bl #0x2f8d2c8",
        0x64EBCF4: "br x1",
    },
    "rendererSetMaterial": {
        0x64ECA08: "adrp x0, #0x1aac000",
        0x64ECA0C: "add x0, x0, #0xd34",
        0x64ECA10: "bl #0x2f8d2c8",
        0x64ECA20: "mov x1, x19",
        0x64ECA2C: "br x2",
    },
    "materialCopyConstructor": {
        0x64F1F3C: "mov x19, x1",
        0x64F1F74: "mov x0, x20",
        0x64F1F7C: "bl #0x651e918",
        0x64F1F8C: "adrp x0, #0x1ac1000",
        0x64F1F90: "add x0, x0, #0xfb9",
        0x64F1F94: "bl #0x2f8d2c8",
        0x64F1FA4: "mov x1, x19",
        0x64F1FB4: "br x2",
    },
}


PROPERTY_LITERAL_SLOTS = {
    "dynamicUI": 0x6C45C80,
    "additionalDynamicUI": 0x6C4B700,
    "decoration": 0x6C4B1F0,
    "rental": 0x6C4B708,
    "additionalFrame": 0x6C4B710,
    "additionalFrameTrainersHeader": 0x6C4B718,
}

EXPECTED_PROPERTY_LITERALS = {
    "dynamicUI": "_DynamicUITex",
    "additionalDynamicUI": "_AdditionalDynamicUITex",
    "decoration": "_DecorationTex",
    "rental": "_RentalTex",
    "additionalFrame": "_AdditionalFrameTex",
    "additionalFrameTrainersHeader": "_AdditionalFrameTrainersHeaderTex",
}

NATIVE_STRINGS = {
    "shaderPropertyToID": (
        0x1AE240F, "UnityEngine.Shader::PropertyToID(System.String)"
    ),
    "rendererSetMaterial": (
        0x1AACD34, "UnityEngine.Renderer::SetMaterial(UnityEngine.Material)"
    ),
    "materialCreateWithMaterial": (
        0x1AC1FB9,
        "UnityEngine.Material::CreateWithMaterial(UnityEngine.Material,UnityEngine.Material)",
    ),
}

PROPERTY_JUMP_TABLE_RVA = 0x1C492E8
PROPERTY_JUMP_TABLE_LENGTH = 6
PROPERTY_JUMP_BASE = 0x445121C


TYPE_SELECTIONS = {
    "initializeState": {
        "namespace": "",
        "name": "<Initialize>d__33",
        "fields": {
            "view": "<>4__this",
            "prefab": "<prefab>5__2",
        },
        "methods": {"moveNext": ("MoveNext", 0)},
    },
    "modelCardView": {
        "namespace": "Lettuce.Infrastructure.Card.Core",
        "name": "ModelCardView",
        "fields": {
            "clampParallax": "_clampParallax",
            "renderedUI": "<RenderedUI>k__BackingField",
            "cardRenderer": "<CardRenderer>k__BackingField",
            "material": "_material",
            "materialHandle": "_materialHandle",
        },
        "methods": {"initialize": ("Initialize", 1)},
    },
    "cardRenderer": {
        "namespace": "Lettuce.Infrastructure.Card.Core",
        "name": "CardRenderer",
        "fields": {},
        "methods": {
            "constructor": (".ctor", 4),
            "createRenderTexture": ("CreateRenderTexture", 2),
        },
    },
    "asset3DRenderer": {
        "namespace": "Lettuce.Infrastructure.Asset3D.Core",
        "name": "Asset3DRenderer",
        "fields": {"renderTexture": "_renderTexture"},
        "methods": {"getRenderTexture": ("get_RenderTexture", 0)},
    },
    "dynamicUI": {
        "namespace": "Lettuce.Infrastructure.Card.Core",
        "name": "DynamicUI",
        "fields": {
            "renderer": "_renderer",
            "dynamicPropertyType": "_dynamicPropertyType",
            "dynamicUIType": "_dynamicUIType",
            "propertyBlock": "_propertyBlock",
            "material": "_material",
        },
        "methods": {
            "apply": ("Apply", 1),
            "trySetTexture": ("TrySetTexture", 2),
        },
    },
    "dynamicShaderPropertyType": {
        "namespace": "Lettuce.Infrastructure.Card.Core.Data",
        "name": "DynamicShaderPropertyType",
        "fields": {"dynamicUI": "DynamicUI"},
        "methods": {},
    },
    "dynamicShaderPropertyExtensions": {
        "namespace": "Lettuce.Infrastructure.Card.Core.Data",
        "name": "DynamicShaderPropertyTypeExtensions",
        "fields": {"dynamicUIPropertyId": "s_dynamicUiPropertyId"},
        "methods": {
            "getPropertyId": ("GetPropertyId", 1),
            "cctor": (".cctor", 0),
        },
    },
    "cardPaths": {
        "namespace": "Lettuce.Infrastructure.Card.Core",
        "name": "CardPaths",
        "fields": {},
        "methods": {
            "plain": ("get_PrerenderCardMaterial", 0),
            "homography": ("get_PrerenderHomographyCardMaterial", 0),
        },
    },
    "cardPathsImpl": {
        "namespace": "Lettuce.Infrastructure.Card",
        "name": "CardPathsImpl",
        "fields": {},
        "methods": {
            "plain": ("PrerenderCardMaterial", 0),
            "homography": ("PrerenderHomographyCardMaterial", 0),
        },
    },
}


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def source_record(data: bytes) -> dict:
    return {"byteSize": len(data), "sha256": sha256(data)}


def raw_record(data: bytes) -> dict:
    return {**source_record(data), "rawHex": data.hex()}


def instruction_text(item) -> str:
    return f"{item.mnemonic} {item.op_str}".strip()


def instruction_record(item) -> dict:
    raw = bytes(item.bytes)
    return {
        "address": f"0x{item.address:x}",
        "text": instruction_text(item),
        "bytesHex": raw.hex(),
        "sha256": sha256(raw),
    }


def method_record(elf, key: str) -> dict:
    name, start, end = METHODS[key]
    raw = elf.range(start, end)
    instructions = BASIS.disassemble(elf, start, end)
    by_address = {item.address: item for item in instructions}
    selected = []
    for address, expected in SIGNATURES[key].items():
        item = by_address.get(address)
        actual = instruction_text(item) if item else None
        if actual != expected:
            raise RuntimeError(
                f"{name} 0x{address:x}: expected {expected!r}, got {actual!r}"
            )
        selected.append(instruction_record(item))
    direct_targets = sorted({
        int(item.op_str[1:], 16)
        for item in instructions
        if item.mnemonic in {"b", "bl"}
        and re.fullmatch(r"#0x[0-9a-f]+", item.op_str)
    })
    return {
        "name": name,
        "rvaStart": f"0x{start:x}",
        "rvaEndExclusive": f"0x{end:x}",
        **raw_record(raw),
        "selectedInstructions": selected,
        "directBranchTargets": [f"0x{target:x}" for target in direct_targets],
    }


def cstring_record(elf, rva: int) -> dict:
    offset = elf.rva_to_offset(rva)
    end = elf.data.find(b"\0", offset)
    if end < 0:
        raise RuntimeError(f"unterminated ELF string at RVA 0x{rva:x}")
    raw = elf.data[offset:end]
    return {
        "rva": f"0x{rva:x}",
        "value": raw.decode("utf-8"),
        **raw_record(raw),
    }


def metadata_table(data: bytes, pair_index: int, record_size: int | None) -> dict:
    offset, size = struct.unpack_from("<II", data, 8 + pair_index * 8)
    if record_size and size % record_size:
        raise RuntimeError(f"metadata table {pair_index} is not record aligned")
    raw = data[offset:offset + size]
    if len(raw) != size:
        raise RuntimeError(f"metadata table {pair_index} is truncated")
    return {
        "offset": offset,
        "byteSize": size,
        "recordSize": record_size,
        "count": size // record_size if record_size else None,
        "sha256": sha256(raw),
    }


def read_compressed_uint32(data: bytes, offset: int) -> tuple[int, int]:
    first = data[offset]
    if first < 0x80:
        return first, 1
    if first < 0xC0:
        return ((first & 0x3F) << 8) | data[offset + 1], 2
    if first < 0xE0:
        return (
            ((first & 0x1F) << 24)
            | (data[offset + 1] << 16)
            | (data[offset + 2] << 8)
            | data[offset + 3],
            4,
        )
    if first == 0xF0:
        return struct.unpack_from(">I", data, offset + 1)[0], 5
    raise RuntimeError(f"unsupported compressed metadata integer prefix 0x{first:02x}")


def read_compressed_int32(data: bytes, offset: int) -> tuple[int, int]:
    encoded, size = read_compressed_uint32(data, offset)
    value = -(encoded >> 1) if encoded & 1 else encoded >> 1
    return value, size


class MetadataDefinitions:
    def __init__(self, data: bytes):
        self.data = data
        magic, self.version = struct.unpack_from("<II", data)
        if magic != 0xFAB11BAF or self.version != 31:
            raise RuntimeError(
                f"expected IL2CPP metadata v31, got 0x{magic:08x}/v{self.version}"
            )
        self.string_offset, self.string_size = struct.unpack_from("<II", data, 24)
        self.tables = {
            "methods": metadata_table(
                data, METADATA_METHODS_PAIR, METHOD_DEFINITION_SIZE
            ),
            "fieldDefaults": metadata_table(
                data, METADATA_FIELD_DEFAULTS_PAIR, FIELD_DEFAULT_SIZE
            ),
            "defaultData": metadata_table(
                data, METADATA_DEFAULT_DATA_PAIR, None
            ),
            "fields": metadata_table(
                data, METADATA_FIELDS_PAIR, FIELD_DEFINITION_SIZE
            ),
            "types": metadata_table(
                data, METADATA_TYPES_PAIR, TYPE_DEFINITION_SIZE
            ),
        }

    def string(self, index: int) -> str:
        start = self.string_offset + index
        limit = self.string_offset + self.string_size
        if start < self.string_offset or start >= limit:
            raise RuntimeError(f"metadata string index {index} is out of range")
        end = self.data.find(b"\0", start, limit)
        if end < 0:
            raise RuntimeError(f"metadata string index {index} is unterminated")
        return self.data[start:end].decode("utf-8")

    def record(self, table: str, index: int) -> tuple[int, bytes]:
        spec = self.tables[table]
        if spec["recordSize"] is None:
            raise RuntimeError(f"metadata {table} is not a record table")
        if index < 0 or index >= spec["count"]:
            raise RuntimeError(f"metadata {table} index {index} is out of range")
        offset = spec["offset"] + index * spec["recordSize"]
        return offset, self.data[offset:offset + spec["recordSize"]]

    def field(self, index: int) -> dict:
        offset, raw = self.record("fields", index)
        name_index, type_index, token = struct.unpack("<III", raw)
        return {
            "fieldDefinitionIndex": index,
            "name": self.string(name_index),
            "typeIndex": type_index,
            "token": f"0x{token:08x}",
            "recordFileOffset": offset,
            "record": raw_record(raw),
        }

    def method(self, index: int) -> dict:
        offset, raw = self.record("methods", index)
        name_index = struct.unpack_from("<I", raw)[0]
        token = struct.unpack_from("<I", raw, 24)[0]
        slot, parameter_count = struct.unpack_from("<HH", raw, 32)
        return {
            "methodDefinitionIndex": index,
            "name": self.string(name_index),
            "token": f"0x{token:08x}",
            "slot": slot,
            "parameterCount": parameter_count,
            "recordFileOffset": offset,
            "record": raw_record(raw),
        }

    def type(self, selection: dict) -> dict:
        namespace = selection["namespace"]
        name = selection["name"]
        matches = []
        for index in range(self.tables["types"]["count"]):
            offset, raw = self.record("types", index)
            values = struct.unpack_from("<16I", raw)
            if self.string(values[0]) == name and self.string(values[1]) == namespace:
                matches.append((index, offset, raw, values))
        if len(matches) != 1:
            raise RuntimeError(
                f"metadata type {namespace}.{name} occurs {len(matches)} times"
            )

        index, offset, raw, values = matches[0]
        counts = struct.unpack_from("<8H", raw, 64)
        fields = [self.field(values[8] + item) for item in range(counts[2])]
        methods = [self.method(values[9] + item) for item in range(counts[0])]

        selected_fields = {}
        for key, requested in selection["fields"].items():
            found = [row for row in fields if row["name"] == requested]
            if len(found) != 1:
                raise RuntimeError(
                    f"metadata {namespace}.{name} field {requested!r} occurs "
                    f"{len(found)} times"
                )
            selected_fields[key] = found[0]

        selected_methods = {}
        for key, (requested, parameter_count) in selection["methods"].items():
            found = [
                row for row in methods
                if row["name"] == requested
                and row["parameterCount"] == parameter_count
            ]
            if len(found) != 1:
                raise RuntimeError(
                    f"metadata {namespace}.{name} method "
                    f"{requested}/{parameter_count} occurs {len(found)} times"
                )
            selected_methods[key] = found[0]

        bitfield, token = struct.unpack_from("<II", raw, 80)
        return {
            "namespace": namespace,
            "name": name,
            "typeDefinitionIndex": index,
            "byvalTypeIndex": values[2],
            "declaringTypeIndex": values[3],
            "parentTypeIndex": values[4],
            "elementTypeIndex": values[5],
            "token": f"0x{token:08x}",
            "bitfield": f"0x{bitfield:08x}",
            "fieldCount": counts[2],
            "methodCount": counts[0],
            "recordFileOffset": offset,
            "record": raw_record(raw),
            "selectedFields": selected_fields,
            "selectedMethods": selected_methods,
        }

    def field_default(self, field_index: int) -> dict:
        matches = []
        for index in range(self.tables["fieldDefaults"]["count"]):
            offset, raw = self.record("fieldDefaults", index)
            candidate, type_index, data_index = struct.unpack("<iii", raw)
            if candidate == field_index:
                matches.append((index, offset, raw, type_index, data_index))
        if len(matches) != 1:
            raise RuntimeError(
                f"metadata field default {field_index} occurs {len(matches)} times"
            )
        index, offset, raw, type_index, data_index = matches[0]
        data_offset = self.tables["defaultData"]["offset"] + data_index
        value, size = read_compressed_int32(self.data, data_offset)
        encoded = self.data[data_offset:data_offset + size]
        return {
            "fieldDefaultIndex": index,
            "fieldDefinitionIndex": field_index,
            "typeIndex": type_index,
            "dataIndex": data_index,
            "recordFileOffset": offset,
            "record": raw_record(raw),
            "value": value,
            "encodedValueFileOffset": data_offset,
            "encodedValue": raw_record(encoded),
        }


def external_record(external) -> dict:
    return {
        "path": str(external.path),
        "name": str(external.name),
        "guid": bytes(external.guid).hex(),
        "type": int(external.type),
    }


def pptr(tree: dict) -> dict:
    return {
        "fileId": int(tree.get("m_FileID", 0)),
        "pathId": str(tree.get("m_PathID", 0)),
    }


def pptr_bytes(pointer: dict) -> bytes:
    return struct.pack("<iq", pointer["fileId"], int(pointer["pathId"]))


def unique_offset(raw: bytes, needle: bytes, label: str) -> int:
    first = raw.find(needle)
    if first < 0 or raw.find(needle, first + 1) >= 0:
        raise RuntimeError(f"{label} serialized bytes are not uniquely located")
    return first


def object_record(obj) -> dict:
    raw = bytes(obj.get_raw_data())
    return {
        "type": obj.type.name,
        "pathId": str(obj.path_id),
        **raw_record(raw),
    }


def asset_bundle_record(environment) -> dict:
    objects = [obj for obj in environment.objects if obj.type.name == "AssetBundle"]
    if len(objects) != 1:
        raise RuntimeError(f"expected one AssetBundle object, found {len(objects)}")
    obj = objects[0]
    tree = obj.read_typetree()
    containers = []
    for name, value in tree.get("m_Container", []):
        containers.append({
            "name": str(name),
            "preloadIndex": int(value.get("preloadIndex", -1)),
            "preloadSize": int(value.get("preloadSize", -1)),
            "asset": pptr(value.get("asset", {})),
        })
    return {
        "object": object_record(obj),
        "name": str(tree.get("m_Name", "")),
        "assetBundleName": str(tree.get("m_AssetBundleName", "")),
        "containers": containers,
        "dependencies": list(tree.get("m_Dependencies", [])),
    }


def load_environment(path: Path):
    data = path.read_bytes()
    return data, UnityPy.load(data)


def one_object(environment, type_name: str):
    objects = [obj for obj in environment.objects if obj.type.name == type_name]
    if len(objects) != 1:
        raise RuntimeError(f"expected one {type_name}, found {len(objects)}")
    return objects[0]


def texture_slot(material_tree: dict, name: str) -> dict:
    entries = {
        str(key): value
        for key, value in material_tree.get("m_SavedProperties", {}).get(
            "m_TexEnvs", []
        )
    }
    value = entries.get(name)
    if value is None:
        raise RuntimeError(f"material has no {name} texture slot")
    return {
        "texture": pptr(value.get("m_Texture", {})),
        "scale": [float(value["m_Scale"]["x"]), float(value["m_Scale"]["y"])],
        "offset": [float(value["m_Offset"]["x"]), float(value["m_Offset"]["y"])],
    }


def material_bundle_evidence(path: Path, expected_name: str) -> tuple[dict, object]:
    bundle, environment = load_environment(path)
    material = one_object(environment, "Material")
    tree = material.read_typetree()
    if tree.get("m_Name") != expected_name:
        raise RuntimeError(
            f"expected material {expected_name!r}, got {tree.get('m_Name')!r}"
        )
    shader_pointer = pptr(tree.get("m_Shader", {}))
    if shader_pointer["fileId"] < 1:
        raise RuntimeError(f"{expected_name} has no external Shader PPtr")
    serialized = material.assets_file
    if shader_pointer["fileId"] > len(serialized.externals):
        raise RuntimeError(f"{expected_name} Shader FileID is out of range")
    return ({
        "relativePath": path.name,
        "bundle": source_record(bundle),
        "assetBundle": asset_bundle_record(environment),
        "serializedFile": str(serialized.name),
        "materialObject": object_record(material),
        "name": expected_name,
        "shaderPPtr": shader_pointer,
        "shaderExternal": external_record(
            serialized.externals[shader_pointer["fileId"] - 1]
        ),
        "dynamicUITexture": texture_slot(tree, "_DynamicUITex"),
    }, material)


def extract_serialized(decrypted_root: Path) -> dict:
    prefab_path = decrypted_root / PREFAB_RELATIVE_PATH
    detail_view_path = decrypted_root / DETAIL_VIEW_PREFAB_RELATIVE_PATH
    plain_path = decrypted_root / PLAIN_MATERIAL_RELATIVE_PATH
    homography_path = decrypted_root / HOMOGRAPHY_MATERIAL_RELATIVE_PATH
    shader_path = decrypted_root / HOMOGRAPHY_SHADER_RELATIVE_PATH

    prefab_bundle, prefab_environment = load_environment(prefab_path)
    prefab_asset_bundle = asset_bundle_record(prefab_environment)
    game_object = one_object(prefab_environment, "GameObject")
    game_object_tree = game_object.read_typetree()
    if game_object_tree.get("m_Name") != "PrerenderCard":
        raise RuntimeError("PrerenderCard prefab GameObject name changed")

    dynamic_ui = one_object(prefab_environment, "MonoBehaviour")
    dynamic_tree = dynamic_ui.read_typetree()
    required_fields = {
        "_renderer", "_dynamicPropertyType", "_dynamicUIType"
    }
    if not required_fields.issubset(dynamic_tree):
        raise RuntimeError("PrerenderCard DynamicUI serialized fields changed")
    dynamic_raw = bytes(dynamic_ui.get_raw_data())
    renderer_pointer = pptr(dynamic_tree["_renderer"])
    renderer_offset = unique_offset(
        dynamic_raw, pptr_bytes(renderer_pointer), "DynamicUI._renderer"
    )
    dynamic_property_offset = renderer_offset + 12
    dynamic_ui_type_offset = dynamic_property_offset + 4
    dynamic_property_value = int(dynamic_tree["_dynamicPropertyType"])
    dynamic_ui_type_value = int(dynamic_tree["_dynamicUIType"])
    dynamic_property_raw = dynamic_raw[
        dynamic_property_offset:dynamic_property_offset + 4
    ]
    dynamic_ui_type_raw = dynamic_raw[
        dynamic_ui_type_offset:dynamic_ui_type_offset + 4
    ]
    if dynamic_property_raw != struct.pack("<i", dynamic_property_value):
        raise RuntimeError("DynamicUI._dynamicPropertyType raw slot changed")
    if dynamic_ui_type_raw != struct.pack("<i", dynamic_ui_type_value):
        raise RuntimeError("DynamicUI._dynamicUIType raw slot changed")

    renderer = one_object(prefab_environment, "MeshRenderer")
    if str(renderer.path_id) != renderer_pointer["pathId"]:
        raise RuntimeError("DynamicUI._renderer does not target the MeshRenderer")
    renderer_tree = renderer.read_typetree()
    materials = renderer_tree.get("m_Materials", [])
    if len(materials) != 1:
        raise RuntimeError("PrerenderCard MeshRenderer must have one material")
    initial_material_pointer = pptr(materials[0])
    renderer_raw = bytes(renderer.get_raw_data())
    material_pointer_offset = unique_offset(
        renderer_raw,
        pptr_bytes(initial_material_pointer),
        "MeshRenderer.m_Materials[0]",
    )
    prefab_serialized = renderer.assets_file
    if initial_material_pointer["fileId"] < 1 or (
        initial_material_pointer["fileId"] > len(prefab_serialized.externals)
    ):
        raise RuntimeError("PrerenderCard initial material FileID is out of range")
    initial_material_external = external_record(
        prefab_serialized.externals[initial_material_pointer["fileId"] - 1]
    )
    mesh_filter = one_object(prefab_environment, "MeshFilter")
    mesh_filter_tree = mesh_filter.read_typetree()
    mesh_pointer = pptr(mesh_filter_tree.get("m_Mesh", {}))
    if mesh_pointer != {"fileId": 3, "pathId": str(BUILTIN_QUAD_PATH_ID)}:
        raise RuntimeError(f"PrerenderCard MeshFilter no longer uses built-in Quad: {mesh_pointer}")
    if mesh_pointer["fileId"] > len(prefab_serialized.externals):
        raise RuntimeError("PrerenderCard built-in Quad FileID is out of range")
    mesh_external = external_record(
        prefab_serialized.externals[mesh_pointer["fileId"] - 1]
    )
    if mesh_external["name"] != "unity default resources":
        raise RuntimeError("PrerenderCard Quad no longer resolves to unity default resources")

    plain, plain_object = material_bundle_evidence(plain_path, "PrerenderCard")
    if initial_material_pointer["pathId"] != str(plain_object.path_id):
        raise RuntimeError("prefab initial material PathID is not PrerenderCard")
    if initial_material_external["name"] != plain["serializedFile"]:
        raise RuntimeError("prefab initial material external is not PrerenderCard")

    homography, homography_object = material_bundle_evidence(
        homography_path, "PrerenderHomographyCard"
    )
    shader_bundle, shader_environment = load_environment(shader_path)
    shader = one_object(shader_environment, "Shader")
    shader_tree = shader.read_typetree()
    shader_name = str(shader_tree.get("m_ParsedForm", {}).get("m_Name", ""))
    if shader_name != HOMOGRAPHY_SHADER_NAME:
        raise RuntimeError(f"Homography Shader name changed: {shader_name!r}")
    if homography["shaderPPtr"]["pathId"] != str(shader.path_id):
        raise RuntimeError("Homography Material Shader PathID does not resolve")
    if homography["shaderExternal"]["name"] != str(shader.assets_file.name):
        raise RuntimeError("Homography Material Shader external does not resolve")

    detail_view_bundle, detail_view_environment = load_environment(detail_view_path)
    detail_view_behaviours = []
    for candidate in detail_view_environment.objects:
        if candidate.type.name != "MonoBehaviour":
            continue
        try:
            candidate_tree = candidate.read_typetree()
        except Exception:
            continue
        if "_clampParallax" in candidate_tree:
            detail_view_behaviours.append((candidate, candidate_tree))
    if len(detail_view_behaviours) != 1:
        raise RuntimeError(
            "expected one detail-view ModelCardView with _clampParallax, "
            f"found {len(detail_view_behaviours)}"
        )
    detail_view, detail_view_tree = detail_view_behaviours[0]
    detail_values = {
        "cardSize": int(detail_view_tree["_cardSize"]),
        "clampParallax": int(detail_view_tree["_clampParallax"]),
        "alwaysDetailEffect": int(detail_view_tree["_alwaysDetailEffect"]),
    }
    detail_raw = bytes(detail_view.get_raw_data())
    detail_values_raw = struct.pack(
        "<iii",
        detail_values["cardSize"],
        detail_values["clampParallax"],
        detail_values["alwaysDetailEffect"],
    )
    detail_values_offset = unique_offset(
        detail_raw,
        detail_values_raw,
        "ModelCardView serialized _cardSize/_clampParallax/_alwaysDetailEffect",
    )

    return {
        "detailViewPrefab": {
            "relativePath": DETAIL_VIEW_PREFAB_RELATIVE_PATH.as_posix(),
            "bundle": source_record(detail_view_bundle),
            "assetBundle": asset_bundle_record(detail_view_environment),
            "serializedFile": str(detail_view.assets_file.name),
            "modelCardView": {
                "object": object_record(detail_view),
                "scriptPPtr": pptr(detail_view_tree.get("m_Script", {})),
                "cardSize": {
                    "name": "_cardSize",
                    "value": detail_values["cardSize"],
                    "objectOffset": detail_values_offset,
                    **raw_record(detail_values_raw[0:4]),
                },
                "clampParallax": {
                    "name": "_clampParallax",
                    "value": detail_values["clampParallax"],
                    "objectOffset": detail_values_offset + 4,
                    **raw_record(detail_values_raw[4:8]),
                },
                "alwaysDetailEffect": {
                    "name": "_alwaysDetailEffect",
                    "value": detail_values["alwaysDetailEffect"],
                    "objectOffset": detail_values_offset + 8,
                    **raw_record(detail_values_raw[8:12]),
                },
            },
        },
        "prefab": {
            "relativePath": PREFAB_RELATIVE_PATH.as_posix(),
            "bundle": source_record(prefab_bundle),
            "assetBundle": prefab_asset_bundle,
            "serializedFile": str(renderer.assets_file.name),
            "gameObject": {
                "name": "PrerenderCard",
                "object": object_record(game_object),
            },
            "dynamicUI": {
                "object": object_record(dynamic_ui),
                "scriptPPtr": pptr(dynamic_tree.get("m_Script", {})),
                "rendererPPtr": {
                    **renderer_pointer,
                    "objectOffset": renderer_offset,
                    **raw_record(pptr_bytes(renderer_pointer)),
                },
                "dynamicPropertyType": {
                    "name": "_dynamicPropertyType",
                    "value": dynamic_property_value,
                    "objectOffset": dynamic_property_offset,
                    **raw_record(dynamic_property_raw),
                },
                "dynamicUIType": {
                    "name": "_dynamicUIType",
                    "value": dynamic_ui_type_value,
                    "objectOffset": dynamic_ui_type_offset,
                    **raw_record(dynamic_ui_type_raw),
                },
            },
            "renderer": {
                "object": object_record(renderer),
                "initialMaterialPPtr": {
                    **initial_material_pointer,
                    "objectOffset": material_pointer_offset,
                    **raw_record(pptr_bytes(initial_material_pointer)),
                },
                "initialMaterialExternal": initial_material_external,
            },
            "meshFilter": {
                "object": object_record(mesh_filter),
                "meshPPtr": mesh_pointer,
                "meshExternal": mesh_external,
            },
        },
        "plainMaterial": {
            **plain,
            "relativePath": PLAIN_MATERIAL_RELATIVE_PATH.as_posix(),
        },
        "homographyMaterial": {
            **homography,
            "relativePath": HOMOGRAPHY_MATERIAL_RELATIVE_PATH.as_posix(),
        },
        "homographyShader": {
            "relativePath": HOMOGRAPHY_SHADER_RELATIVE_PATH.as_posix(),
            "bundle": source_record(shader_bundle),
            "assetBundle": asset_bundle_record(shader_environment),
            "serializedFile": str(shader.assets_file.name),
            "shaderObject": object_record(shader),
            "name": shader_name,
        },
        "resolvedPPtrs": {
            "prefabInitialMaterial": (
                "PrerenderCard.prefab MeshRenderer.m_Materials[0] -> "
                "PrerenderCard Material"
            ),
            "homographyMaterialShader": (
                "PrerenderHomographyCard Material.m_Shader -> "
                "Lettuce/Common/CardNew/Prerender/Homography(from RT) Shader"
            ),
        },
    }


def extract_apkm(apkm_path: Path) -> dict:
    apkm = apkm_path.read_bytes()
    with zipfile.ZipFile(io.BytesIO(apkm)) as outer:
        base_apk = outer.read("base.apk")
        arm64_apk = outer.read("split_config.arm64_v8a.apk")
    with zipfile.ZipFile(io.BytesIO(arm64_apk)) as split:
        libil2cpp = split.read(BASIS.IL2CPP_PATH)
    with zipfile.ZipFile(io.BytesIO(base_apk)) as base:
        encrypted_metadata = base.read(BASIS.METADATA_PATH)
        unity_default_resources = base.read(UNITY_DEFAULT_RESOURCES_PATH)

    builtin_environment = UnityPy.load(unity_default_resources)
    quad_matches = [
        item for item in builtin_environment.objects
        if item.type.name == "Mesh" and int(item.path_id) == BUILTIN_QUAD_PATH_ID
    ]
    if len(quad_matches) != 1:
        raise RuntimeError(f"expected one built-in Quad Mesh, found {len(quad_matches)}")
    quad_object = quad_matches[0]
    quad = quad_object.read()
    if quad.m_Name != "Quad":
        raise RuntimeError(f"built-in PathID {BUILTIN_QUAD_PATH_ID} is {quad.m_Name!r}")
    vertex_count = int(quad.m_VertexData.m_VertexCount)
    vertex_data = bytes(quad.m_VertexData.m_DataSize)
    if vertex_count != 4 or len(vertex_data) % vertex_count:
        raise RuntimeError("built-in Quad vertex buffer shape changed")
    stride = len(vertex_data) // vertex_count
    channels = [
        {
            "index": index,
            "stream": int(channel.stream),
            "offset": int(channel.offset),
            "format": int(channel.format),
            "dimension": int(channel.dimension),
        }
        for index, channel in enumerate(quad.m_VertexData.m_Channels)
    ]
    position_channel = channels[0]
    uv0_channel = channels[4]
    if position_channel != {"index": 0, "stream": 0, "offset": 0, "format": 0, "dimension": 3}:
        raise RuntimeError(f"built-in Quad position channel changed: {position_channel}")
    if uv0_channel != {"index": 4, "stream": 0, "offset": 40, "format": 0, "dimension": 2}:
        raise RuntimeError(f"built-in Quad UV0 channel changed: {uv0_channel}")
    vertices = []
    for index in range(vertex_count):
        base_offset = index * stride
        vertices.append({
            "position": list(struct.unpack_from(
                "<3f", vertex_data, base_offset + position_channel["offset"]
            )),
            "uv0": list(struct.unpack_from(
                "<2f", vertex_data, base_offset + uv0_channel["offset"]
            )),
        })
    index_data = bytes(quad.m_IndexBuffer)
    if int(quad.m_IndexFormat) != 0 or len(index_data) != 12:
        raise RuntimeError("built-in Quad index buffer format changed")
    indices = list(struct.unpack("<6H", index_data))

    elf = BASIS.Elf64(libil2cpp)
    metadata, metadata_source = BASIS.decrypt_global_metadata(
        encrypted_metadata, elf
    )
    definitions = MetadataDefinitions(metadata)
    types = {
        key: definitions.type(selection)
        for key, selection in TYPE_SELECTIONS.items()
    }
    if (
        types["cardRenderer"]["parentTypeIndex"]
        != types["asset3DRenderer"]["byvalTypeIndex"]
    ):
        raise RuntimeError("CardRenderer no longer inherits Asset3DRenderer")

    dynamic_ui_field = types["dynamicShaderPropertyType"][
        "selectedFields"
    ]["dynamicUI"]
    dynamic_ui_default = definitions.field_default(
        dynamic_ui_field["fieldDefinitionIndex"]
    )
    if dynamic_ui_default["value"] != 0:
        raise RuntimeError(
            "DynamicShaderPropertyType.DynamicUI enum value is no longer zero"
        )

    relocations = elf.relocations()
    literals = BASIS.MetadataLiterals(metadata)
    property_literals = {
        key: BASIS.literal_slot_evidence(relocations, literals, slot)
        for key, slot in PROPERTY_LITERAL_SLOTS.items()
    }
    for key, expected in EXPECTED_PROPERTY_LITERALS.items():
        actual = property_literals[key]["value"]
        if actual != expected:
            raise RuntimeError(
                f"property literal {key} expected {expected!r}, got {actual!r}"
            )

    native_strings = {}
    for key, (rva, expected) in NATIVE_STRINGS.items():
        record = cstring_record(elf, rva)
        if record["value"] != expected:
            raise RuntimeError(
                f"native string {key} expected {expected!r}, "
                f"got {record['value']!r}"
            )
        native_strings[key] = record

    jump_table = elf.range(
        PROPERTY_JUMP_TABLE_RVA,
        PROPERTY_JUMP_TABLE_RVA + PROPERTY_JUMP_TABLE_LENGTH,
    )
    jump_targets = [PROPERTY_JUMP_BASE + value * 4 for value in jump_table]
    if jump_targets[0] != PROPERTY_JUMP_BASE:
        raise RuntimeError("DynamicUI enum zero no longer selects property case zero")

    return {
        "source": {
            "apkmPath": str(apkm_path.resolve()),
            "apkm": source_record(apkm),
            "baseApk": source_record(base_apk),
            "arm64Split": source_record(arm64_apk),
            "libil2cppPath": BASIS.IL2CPP_PATH,
            "libil2cpp": source_record(libil2cpp),
            "metadata": metadata_source,
        },
        "builtinResources": {
            "path": UNITY_DEFAULT_RESOURCES_PATH,
            "source": source_record(unity_default_resources),
            "quad": {
                "object": object_record(quad_object),
                "name": quad.m_Name,
                "pathId": str(quad_object.path_id),
                "vertexCount": vertex_count,
                "vertexStride": stride,
                "positionChannel": position_channel,
                "uv0Channel": uv0_channel,
                "vertexData": raw_record(vertex_data),
                "vertices": vertices,
                "indexFormat": int(quad.m_IndexFormat),
                "indexData": raw_record(index_data),
                "indices": indices,
            },
        },
        "metadata": {
            "version": definitions.version,
            "tables": definitions.tables,
            "types": types,
            "dynamicShaderPropertyTypeDynamicUI": {
                "field": dynamic_ui_field,
                "default": dynamic_ui_default,
            },
        },
        "native": {
            "methods": {key: method_record(elf, key) for key in METHODS},
            "propertyLiterals": property_literals,
            "propertyJumpTable": {
                "rva": f"0x{PROPERTY_JUMP_TABLE_RVA:x}",
                **raw_record(jump_table),
                "enumValues": list(range(PROPERTY_JUMP_TABLE_LENGTH)),
                "caseRvas": [f"0x{target:x}" for target in jump_targets],
            },
            "nativeStrings": native_strings,
            "fieldOffsets": {
                "ModelCardView._clampParallax": "0x28",
                "ModelCardView.<RenderedUI>k__BackingField": "0x30",
                "ModelCardView.<CardRenderer>k__BackingField": "0x38",
                "ModelCardView._material": "0x58",
                "ModelCardView._materialHandle": "0xa8",
                "Asset3DRenderer._renderTexture": "0x40",
                "DynamicUI._renderer": "0x20",
                "DynamicUI._dynamicPropertyType": "0x28",
                "DynamicUI._propertyBlock": "0x30",
            },
        },
    }


def extract(apkm_path: Path, decrypted_root: Path) -> dict:
    apkm = extract_apkm(apkm_path)
    serialized = extract_serialized(decrypted_root)
    return {
        "schemaVersion": 1,
        "status": "proved-with-native-y-explicitly-unproved",
        "evidencePolicy": {
            "officialOnly": True,
            "readInputs": [
                "official 1.6.0 APKM base.apk and arm64 split bytes",
                "official decrypted Unity bundles and serialized objects",
            ],
            "excludedInputs": [
                "Il2CppDumper output",
                "scene.json and recipes",
                "browser runtime and generated reports",
                "screenshots",
            ],
            "rvaPolicy": (
                "package-matched RVAs are locators; method bytes, metadata, "
                "literals, icalls, serialized objects, and PPtrs are read from "
                "official inputs at extraction time"
            ),
        },
        "source": {
            **apkm["source"],
            "decryptedRoot": str(decrypted_root.resolve()),
        },
        "metadata": apkm["metadata"],
        "native": apkm["native"],
        "builtinResources": apkm["builtinResources"],
        "serialized": serialized,
        "derived": {
            "runtimeWiring": [
                "ModelCardView.<Initialize>d__33.MoveNext reads _clampParallax at ModelCardView+0x28",
                "true selects CardPaths.get_PrerenderHomographyCardMaterial; false selects CardPaths.get_PrerenderCardMaterial",
                "the selected path is passed to the material asset loader and its handle is stored at ModelCardView+0xa8",
                "the loaded Material is cloned with Material..ctor(Material) and stored at ModelCardView+0x58",
                "the cloned Material is passed to Renderer.set_material at RVA 0x4432178",
                "ModelCardView+0x38 contains CardRenderer, whose Asset3DRenderer parent owns _renderTexture at +0x40",
                "the same _renderTexture pointer is passed to DynamicUI.Apply at RVA 0x44321c0",
                "DynamicUI.Apply maps serialized DynamicShaderPropertyType through GetPropertyId and forwards the Texture to TrySetTexture",
                "TrySetTexture writes the non-null Texture to DynamicUI._propertyBlock with MaterialPropertyBlock.SetTexture",
                "DynamicShaderPropertyType.DynamicUI is serialized metadata enum value 0, jump-table case 0, and the case-0 static property ID is initialized from Shader.PropertyToID(\"_DynamicUITex\")",
                "PrerenderCard.prefab serializes _dynamicPropertyType=0 and _dynamicUIType=0 and starts with the PrerenderCard material",
                "PrerenderHomographyCard Material.m_Shader resolves by FileID/PathID to the official Homography(from RT) Shader",
            ],
        },
        "notEstablished": [
            {
                "id": "native-render-texture-physical-y",
                "status": "unproved",
                "claim": "native RenderTexture physical Y origin/orientation",
            },
        ],
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
        default=Path(
            os.environ.get("PCR_DECRYPTED_ROOT", DEFAULT_DECRYPTED_ROOT)
        ),
    )
    parser.add_argument("--pretty", action="store_true")
    args = parser.parse_args()
    if not args.apkm.is_file():
        parser.error(f"APKM not found: {args.apkm}")
    required = [
        DETAIL_VIEW_PREFAB_RELATIVE_PATH,
        PREFAB_RELATIVE_PATH,
        PLAIN_MATERIAL_RELATIVE_PATH,
        HOMOGRAPHY_MATERIAL_RELATIVE_PATH,
        HOMOGRAPHY_SHADER_RELATIVE_PATH,
    ]
    missing = [path for path in required if not (args.decrypted_root / path).is_file()]
    if missing:
        parser.error(
            "decrypted official bundle(s) missing: "
            + ", ".join(path.as_posix() for path in missing)
        )
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
