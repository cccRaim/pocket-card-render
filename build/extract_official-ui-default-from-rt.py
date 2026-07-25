#!/usr/bin/env python3
"""Extract the official UI Default From RT display chain from 1.6.0 data.

The APKM is authoritative for IL2CPP metadata, ARM64 method bodies, metadata
string literals, and type-usage relocations. Decrypted Unity bundles are
authoritative for the Material -> Shader PPtr and the Vulkan program bytes.
No repository scene, recipe, runtime source, screenshot, or generated shader
asset is read.
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

import lz4.block
import UnityPy


sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
DEFAULT_APKM = (
    ROOT.parent / "ptcg-apk-parser" / "apks" /
    "jp.pokemon.pokemontcgp_1.6.0.apkm"
)
DEFAULT_DECRYPTED_ROOT = Path(
    "D:/DevProjectes/ptcgp-tools-master/masterdata_decoder/.output/decrypted"
)
UNITY_VERSION = "2022.3.62f2"

MATERIAL_RELATIVE_PATH = Path(
    "Common/CardNew/System/Materials/UI_Default_From_RT.mat_bundles"
)
SHADER_RELATIVE_PATH = Path(
    "Common/Shader/Common/CardNew/UI/Card_UI_Default_FromRT.shader_bundles"
)
SHADER_NAME = "Lettuce/Common/CardNew/UI/Default(from RT)"
VULKAN_PLATFORM = 18
SPIRV_PROGRAM_TYPE = 25

METADATA_METHODS_PAIR = 5
METADATA_FIELDS_PAIR = 11
METADATA_TYPES_PAIR = 19
METHOD_DEFINITION_SIZE = 36
FIELD_DEFINITION_SIZE = 12
TYPE_DEFINITION_SIZE = 88


def load_module(name: str, source: Path):
    spec = importlib.util.spec_from_file_location(name, source)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load extraction helper: {source}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


BASIS = load_module(
    "pcr_ui_default_rt_basis", ROOT / "build" / "extract_official_pass_partition.py"
)
SHADER_HELPER = load_module(
    "pcr_ui_default_rt_shader", ROOT / "build" / "extract_official_side_back.py"
)

BASIS.UnityPy.config.FALLBACK_UNITY_VERSION = UNITY_VERSION
UnityPy.config.FALLBACK_UNITY_VERSION = UNITY_VERSION
warnings.filterwarnings("ignore", category=Warning, module=r"UnityPy\..*")


TYPE_SELECTIONS = {
    "uiCardView": {
        "index": 29442,
        "namespace": "Lettuce.Infrastructure.Card.Core",
        "name": "UICardView",
        "fields": {},
        "methods": {
            "provideMaterial": ("ProvideMaterial", 0, "0x06000271"),
        },
    },
    "cardPaths": {
        "index": 29520,
        "namespace": "Lettuce.Infrastructure.Card.Core",
        "name": "CardPaths",
        "fields": {"impl": "<Impl>k__BackingField"},
        "methods": {
            "getUIDefaultFromRT": ("get_UIDefaultFromRT", 0, "0x06000399"),
        },
    },
    "cardSystem": {
        "index": 29522,
        "namespace": "Lettuce.Infrastructure.Card.Core",
        "name": "CardSystem",
        "fields": {},
        "methods": {
            "setPaths": ("SetPaths", 1, None),
        },
    },
    "cardPathsImpl": {
        "index": 39900,
        "namespace": "Lettuce.Infrastructure.Card",
        "name": "CardPathsImpl",
        "fields": {},
        "methods": {
            "uidDefaultFromRT": ("UIDefaultFromRT", 0, "0x06000013"),
            "ctor": (".ctor", 0, "0x06000037"),
        },
    },
    "cardSystemCommonFile": {
        "index": 39906,
        "namespace": "Lettuce.Infrastructure.Card",
        "name": "CardSystemCommonFile",
        "fields": {
            "path": "<Path>k__BackingField",
            "uiDefaultFromRT": "Materials_UI_Default_From_RT_mat",
        },
        "methods": {
            "getPath": ("get_Path", 0, "0x06000047"),
            "ctor": (".ctor", 1, "0x06000048"),
            "cctor": (".cctor", 0, "0x06000049"),
        },
    },
    "runtimeCardSystem": {
        "index": 39912,
        "namespace": "Lettuce.Infrastructure.Card",
        "name": "RuntimeCardSystem",
        "fields": {},
        "methods": {"ctor": (".ctor", 0, None)},
    },
    "activateState": {
        "index": 39909,
        "namespace": "",
        "name": "<ActivateAsync>d__6",
        "fields": {},
        "methods": {"moveNext": ("MoveNext", 0, None)},
    },
    "resolver": {
        "index": 34714,
        "namespace": "Sharin.PathResolver.Generated",
        "name": "Card_CardSystemCommonFile",
        "fields": {},
        "methods": {
            "resolve": ("Resolve", 1, None),
            "segment0": ("ResolveSegment0", 0, None),
            "segment1": ("ResolveSegment1", 0, None),
            "segment2": ("ResolveSegment2", 1, None),
            "cctor": (".cctor", 0, None),
        },
    },
    "paths": {
        "index": 34814,
        "namespace": "Lettuce.Infrastructure.Impl.ResourcePath",
        "name": "Paths",
        "fields": {},
        "methods": {
            "cardSystemCommonFile": ("Card_CardSystemCommonFile", 1, None),
        },
    },
    "ltResourcePath": {
        "index": 41335,
        "namespace": "Lettuce.Infrastructure.Resource",
        "name": "LtResourcePath",
        "fields": {},
        "methods": {"assetBundle": ("AssetBundle", 1, None)},
    },
}


METHODS = {
    "activateMoveNext": {
        "name": "RuntimeCardSystem.<ActivateAsync>d__6.MoveNext",
        "start": 0x4457204,
        "end": 0x4457C40,
        "definition": ("activateState", "moveNext"),
        "signatures": {
            0x4457340: "adrp x8, #0x6c4b000",
            0x4457344: "ldr x8, [x8, #0xc10]",
            0x4457350: "bl #0x2f8d674",
            0x445735C: "bl #0x57281a0",
            0x4457370: "bl #0x444d1c8",
        },
    },
    "cardSystemSetPaths": {
        "name": "CardSystem.SetPaths",
        "start": 0x444D1C8,
        "end": 0x444D220,
        "definition": ("cardSystem", "setPaths"),
        "signatures": {
            0x444D1F4: "adrp x8, #0x6c4a000",
            0x444D1FC: "ldr x8, [x8, #0xf88]",
            0x444D208: "str x19, [x9]",
        },
    },
    "uiCardViewProvideMaterial": {
        "name": "UICardView.ProvideMaterial",
        "start": 0x443D1D4,
        "end": 0x443D2D0,
        "definition": ("uiCardView", "provideMaterial"),
        "signatures": {
            0x443D234: "ldr x19, [x8, #0x10]",
            0x443D238: "bl #0x443b670",
            0x443D2B4: "mov x1, x20",
            0x443D2C8: "br x4",
        },
    },
    "cardPathsGetUIDefaultFromRT": {
        "name": "CardPaths.get_UIDefaultFromRT",
        "start": 0x443B670,
        "end": 0x443B738,
        "definition": ("cardPaths", "getUIDefaultFromRT"),
        "signatures": {
            0x443B6C4: "ldr x19, [x8]",
            0x443B708: "mov w2, #6",
            0x443B718: "add w9, w9, #6",
            0x443B730: "br x2",
        },
    },
    "cardPathsImplUIDefaultFromRT": {
        "name": "CardPathsImpl.UIDefaultFromRT",
        "start": 0x44521F0,
        "end": 0x4452260,
        "definition": ("cardPathsImpl", "uidDefaultFromRT"),
        "signatures": {
            0x4452204: "ldr x19, [x19, #0x7d8]",
            0x4452238: "ldr x8, [x8]",
            0x4452240: "ldr x0, [x8, #0x10]",
            0x4452248: "bl #0x46c92a0",
        },
    },
    "cardPathsImplCtor": {
        "name": "CardPathsImpl..ctor",
        "start": 0x4453268,
        "end": 0x4453270,
        "definition": ("cardPathsImpl", "ctor"),
        "signatures": {0x445326C: "b #0x57281a0"},
    },
    "cardSystemCommonFileGetPath": {
        "name": "CardSystemCommonFile.get_Path",
        "start": 0x4454E00,
        "end": 0x4454E08,
        "definition": ("cardSystemCommonFile", "getPath"),
        "signatures": {
            0x4454E00: "ldr x0, [x0, #0x10]",
            0x4454E04: "ret",
        },
    },
    "cardSystemCommonFileCtor": {
        "name": "CardSystemCommonFile..ctor",
        "start": 0x4454E08,
        "end": 0x4454E38,
        "definition": ("cardSystemCommonFile", "ctor"),
        "signatures": {
            0x4454E20: "str x19, [x20, #0x10]!",
            0x4454E34: "b #0x2f8d270",
        },
    },
    "cardSystemCommonFileCctor": {
        "name": "CardSystemCommonFile..cctor",
        "start": 0x4454E38,
        "end": 0x4455618,
        "definition": ("cardSystemCommonFile", "cctor"),
        "signatures": {
            0x4454E80: "ldr x20, [x20, #0x908]",
            0x4454FEC: "ldr x20, [x20]",
            0x4455000: "str x20, [x0, #0x10]!",
            0x4455014: "str x19, [x8]",
        },
    },
    "pathsCardSystemCommonFile": {
        "name": "Paths.Card_CardSystemCommonFile",
        "start": 0x46C92A0,
        "end": 0x46C92FC,
        "definition": ("paths", "cardSystemCommonFile"),
        "signatures": {
            0x46C92E8: "bl #0x46a914c",
            0x46C92F8: "b #0x46a3c44",
        },
    },
    "resolverResolve": {
        "name": "Card_CardSystemCommonFile.Resolve",
        "start": 0x46A914C,
        "end": 0x46A9288,
        "definition": ("resolver", "resolve"),
        "signatures": {
            0x46A9208: "bl #0x55a7400",
            0x46A9264: "bl #0x55a7400",
        },
    },
    "resolverSegment0": {
        "name": "Card_CardSystemCommonFile.ResolveSegment0",
        "start": 0x46A9288,
        "end": 0x46A92D8,
        "definition": ("resolver", "segment0"),
        "signatures": {0x46A92D0: "br x2"},
    },
    "resolverSegment1": {
        "name": "Card_CardSystemCommonFile.ResolveSegment1",
        "start": 0x46A92D8,
        "end": 0x46A9318,
        "definition": ("resolver", "segment1"),
        "signatures": {
            0x46A92E4: "adrp x20, #0x6c62000",
            0x46A92EC: "ldr x20, [x20, #0xb78]",
            0x46A9308: "ldr x0, [x20]",
        },
    },
    "resolverSegment2": {
        "name": "Card_CardSystemCommonFile.ResolveSegment2",
        "start": 0x46A9318,
        "end": 0x46A9334,
        "definition": ("resolver", "segment2"),
        "signatures": {0x46A932C: "br x2"},
    },
    "resolverCctor": {
        "name": "Card_CardSystemCommonFile..cctor",
        "start": 0x46A9334,
        "end": 0x46A93EC,
        "definition": ("resolver", "cctor"),
        "signatures": {0x46A93E4: "b #0x2f8d270"},
    },
    "ltResourcePathAssetBundle": {
        "name": "LtResourcePath.AssetBundle",
        "start": 0x46A3C44,
        "end": 0x46A3C70,
        "definition": ("ltResourcePath", "assetBundle"),
        "signatures": {
            0x46A3C5C: "bl #0x2f8d270",
            0x46A3C6C: "ret",
        },
    },
}


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def hash_record(data: bytes) -> dict:
    return {"byteSize": len(data), "sha256": sha256(data)}


def raw_record(data: bytes) -> dict:
    return {**hash_record(data), "rawHex": data.hex()}


def metadata_table(data: bytes, pair_index: int, record_size: int) -> dict:
    offset, size = struct.unpack_from("<II", data, 8 + pair_index * 8)
    if size % record_size:
        raise RuntimeError(f"metadata table {pair_index} is not record aligned")
    raw = data[offset:offset + size]
    if len(raw) != size:
        raise RuntimeError(f"metadata table {pair_index} is truncated")
    return {
        "offset": offset,
        "byteSize": size,
        "recordSize": record_size,
        "count": size // record_size,
        "sha256": sha256(raw),
    }


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
            "methods": metadata_table(data, METADATA_METHODS_PAIR, METHOD_DEFINITION_SIZE),
            "fields": metadata_table(data, METADATA_FIELDS_PAIR, FIELD_DEFINITION_SIZE),
            "types": metadata_table(data, METADATA_TYPES_PAIR, TYPE_DEFINITION_SIZE),
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
        if index < 0 or index >= spec["count"]:
            raise RuntimeError(f"metadata {table} index {index} is out of range")
        offset = spec["offset"] + index * spec["recordSize"]
        return offset, self.data[offset:offset + spec["recordSize"]]

    def field(self, index: int) -> dict:
        offset, raw = self.record("fields", index)
        name_index, type_index, token = struct.unpack("<III", raw)
        return {
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
            "name": self.string(name_index),
            "token": f"0x{token:08x}",
            "slot": slot,
            "parameterCount": parameter_count,
            "recordFileOffset": offset,
            "record": raw_record(raw),
        }

    def selected_type(self, selection: dict) -> dict:
        index = int(selection["index"])
        offset, raw = self.record("types", index)
        values = struct.unpack_from("<16I", raw)
        counts = struct.unpack_from("<8H", raw, 64)
        name = self.string(values[0])
        namespace = self.string(values[1])
        if name != selection["name"] or namespace != selection["namespace"]:
            raise RuntimeError(
                f"metadata type {index} expected {selection['namespace']}.{selection['name']}, "
                f"got {namespace}.{name}"
            )
        fields = [self.field(values[8] + item) for item in range(counts[2])]
        methods = [self.method(values[9] + item) for item in range(counts[0])]

        selected_fields = {}
        for key, requested_name in selection["fields"].items():
            found = [item for item in fields if item["name"] == requested_name]
            if len(found) != 1:
                raise RuntimeError(
                    f"metadata field {namespace}.{name}.{requested_name} occurs {len(found)} times"
                )
            selected_fields[key] = found[0]

        selected_methods = {}
        for key, (requested_name, parameter_count, token) in selection["methods"].items():
            found = [
                item for item in methods
                if item["name"] == requested_name
                and item["parameterCount"] == parameter_count
                and (token is None or item["token"] == token)
            ]
            if len(found) != 1:
                raise RuntimeError(
                    f"metadata method {namespace}.{name}.{requested_name}/{parameter_count} "
                    f"occurs {len(found)} times"
                )
            selected_methods[key] = found[0]

        bitfield, token = struct.unpack_from("<II", raw, 80)
        return {
            "namespace": namespace,
            "name": name,
            "typeDefinitionIndex": index,
            "byvalTypeIndex": values[2],
            "byrefTypeIndex": values[3],
            "token": f"0x{token:08x}",
            "bitfield": f"0x{bitfield:08x}",
            "fieldCount": counts[2],
            "methodCount": counts[0],
            "recordFileOffset": offset,
            "record": raw_record(raw),
            "selectedFields": selected_fields,
            "selectedMethods": selected_methods,
        }


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


def method_evidence(elf, key: str, types: dict) -> dict:
    spec = METHODS[key]
    start, end = spec["start"], spec["end"]
    body = elf.range(start, end)
    instructions = BASIS.disassemble(elf, start, end)
    by_address = {item.address: item for item in instructions}
    selected = []
    for address, expected in spec["signatures"].items():
        item = by_address.get(address)
        actual = instruction_text(item) if item else None
        if actual != expected:
            raise RuntimeError(
                f"{spec['name']} 0x{address:x}: expected {expected!r}, got {actual!r}"
            )
        selected.append(instruction_record(item))
    type_key, method_key = spec["definition"]
    return {
        "name": spec["name"],
        "rvaStart": f"0x{start:x}",
        "rvaEndExclusive": f"0x{end:x}",
        **raw_record(body),
        "methodDefinition": types[type_key]["selectedMethods"][method_key],
        "selectedInstructions": selected,
    }


def type_usage_evidence(elf, relocations: dict, slot: int, type_record: dict) -> dict:
    try:
        relocation = dict(relocations[slot])
    except KeyError as exc:
        raise RuntimeError(f"type usage slot 0x{slot:x} has no ELF relocation") from exc
    if relocation["type"] != 1027 or relocation["symbol"] != 0:
        raise RuntimeError(f"type usage slot 0x{slot:x} has unexpected relocation")
    encoded_raw = elf.range(relocation["addend"], relocation["addend"] + 8)
    encoded = struct.unpack("<Q", encoded_raw)[0]
    if encoded > 0xFFFFFFFF or encoded & 0xE0000000 != 0x20000000:
        raise RuntimeError(f"type usage slot 0x{slot:x} has invalid encoded value 0x{encoded:x}")
    payload = encoded & 0x1FFFFFFF
    if payload == 0 or payload % 2 != 1:
        raise RuntimeError(f"type usage slot 0x{slot:x} payload is not a TypeInfo index")
    type_index = (payload - 1) // 2
    if type_index != type_record["byvalTypeIndex"]:
        raise RuntimeError(
            f"type usage slot 0x{slot:x} resolves type index {type_index}, "
            f"expected {type_record['byvalTypeIndex']}"
        )
    return {
        "slotRva": f"0x{slot:x}",
        "relocation": relocation,
        "encodedUsage": {"value": f"0x{encoded:08x}", **raw_record(encoded_raw)},
        "resolvedByvalTypeIndex": type_index,
        "resolvedType": {
            "namespace": type_record["namespace"],
            "name": type_record["name"],
            "typeDefinitionIndex": type_record["typeDefinitionIndex"],
        },
    }


def saved_properties(tree: dict) -> dict:
    saved = tree.get("m_SavedProperties", {})
    textures = {}
    for name, item in saved.get("m_TexEnvs", []):
        pointer = item.get("m_Texture", {})
        textures[str(name)] = {
            "fileId": int(pointer.get("m_FileID", 0)),
            "pathId": str(pointer.get("m_PathID", 0)),
            "scale": [float(item["m_Scale"]["x"]), float(item["m_Scale"]["y"])],
            "offset": [float(item["m_Offset"]["x"]), float(item["m_Offset"]["y"])],
        }
    return {
        "textures": textures,
        "ints": {str(name): int(value) for name, value in saved.get("m_Ints", [])},
        "floats": {str(name): float(value) for name, value in saved.get("m_Floats", [])},
        "colors": {
            str(name): [float(value[channel]) for channel in ("r", "g", "b", "a")]
            for name, value in saved.get("m_Colors", [])
        },
    }


def material_evidence(decrypted_root: Path) -> dict:
    bundle_path = decrypted_root / MATERIAL_RELATIVE_PATH
    bundle_bytes = bundle_path.read_bytes()
    environment = UnityPy.load(bundle_bytes)
    materials = [item for item in environment.objects if item.type.name == "Material"]
    if len(materials) != 1:
        raise RuntimeError(f"expected one Material in {MATERIAL_RELATIVE_PATH}")
    material = materials[0]
    raw = bytes(material.get_raw_data())
    tree = material.read_typetree()
    pointer = tree.get("m_Shader", {})
    file_id = int(pointer.get("m_FileID", 0))
    serialized = material.assets_file
    if file_id < 1 or file_id > len(serialized.externals):
        raise RuntimeError("UI_Default_From_RT Material has an invalid Shader FileID")
    external = serialized.externals[file_id - 1]
    properties = saved_properties(tree)
    return {
        "relativePath": MATERIAL_RELATIVE_PATH.as_posix(),
        "bundle": raw_record(bundle_bytes),
        "serializedFile": str(serialized.name),
        "materialObject": {"pathId": str(material.path_id), **raw_record(raw)},
        "name": str(tree.get("m_Name")),
        "shaderPPtr": {
            "fileId": file_id,
            "pathId": str(pointer.get("m_PathID", 0)),
        },
        "shaderExternal": {
            "path": str(external.path),
            "name": str(external.name),
            "guid": bytes(external.guid).hex(),
        },
        "validKeywords": list(tree.get("m_ValidKeywords", [])),
        "invalidKeywords": list(tree.get("m_InvalidKeywords", [])),
        "enableInstancingVariants": bool(tree.get("m_EnableInstancingVariants", False)),
        "customRenderQueue": int(tree.get("m_CustomRenderQueue", -1)),
        "disabledShaderPasses": list(tree.get("disabledShaderPasses", [])),
        "savedProperties": properties,
    }


def shader_evidence(decrypted_root: Path, material: dict) -> dict:
    bundle_path = decrypted_root / SHADER_RELATIVE_PATH
    bundle_bytes = bundle_path.read_bytes()
    environment = UnityPy.load(bundle_bytes)
    shaders = [item for item in environment.objects if item.type.name == "Shader"]
    if len(shaders) != 1:
        raise RuntimeError(f"expected one Shader in {SHADER_RELATIVE_PATH}")
    shader_object = shaders[0]
    raw = bytes(shader_object.get_raw_data())
    shader = shader_object.read_typetree()
    parsed = shader.get("m_ParsedForm", {})
    if parsed.get("m_Name") != SHADER_NAME:
        raise RuntimeError(f"unexpected shader name {parsed.get('m_Name')!r}")
    if shader.get("platforms") != [VULKAN_PLATFORM]:
        raise RuntimeError(f"unexpected shader platforms {shader.get('platforms')}")
    if str(shader_object.assets_file.name) != material["shaderExternal"]["name"]:
        raise RuntimeError("Material external CAB does not match Shader serialized file")
    if str(shader_object.path_id) != material["shaderPPtr"]["pathId"]:
        raise RuntimeError("Material Shader PathID does not match Shader object")

    subshaders = parsed.get("m_SubShaders", [])
    if len(subshaders) != 1 or len(subshaders[0].get("m_Passes", [])) != 1:
        raise RuntimeError("UI Default From RT must contain one subshader and one pass")
    shader_pass = subshaders[0]["m_Passes"][0]
    keyword_names = list(parsed.get("m_KeywordNames", []))
    compiled = []
    for stage_name in ("progVertex", "progFragment"):
        stage = shader_pass.get(stage_name, {})
        player_groups = stage.get("m_PlayerSubPrograms", [])
        parameter_groups = stage.get("m_ParameterBlobIndices", [])
        for group_index, players in enumerate(player_groups):
            parameters = parameter_groups[group_index] if group_index < len(parameter_groups) else []
            for variant_index, player in enumerate(players or []):
                if variant_index >= len(parameters):
                    raise RuntimeError("compiled variant has no parameter entry")
                indices = [int(value) for value in player.get("m_KeywordIndices", [])]
                compiled.append({
                    "stageMetadata": stage_name,
                    "groupIndex": group_index,
                    "variantIndex": variant_index,
                    "keywordIndices": indices,
                    "keywords": [keyword_names[index] for index in indices],
                    "parameterBlobIndex": int(parameters[variant_index]),
                    "programBlobIndex": int(player.get("m_BlobIndex")),
                    "gpuProgramType": int(player.get("m_GpuProgramType")),
                    "shaderRequirements": int(player.get("m_ShaderRequirements")),
                })
    selected_rows = [
        item for item in compiled
        if item["stageMetadata"] == "progVertex"
        and item["groupIndex"] == 3
        and item["variantIndex"] == 0
    ]
    if len(selected_rows) != 1:
        raise RuntimeError("Vulkan group 3 variant 0 is not unique")
    selected = selected_rows[0]
    expected_selection = {
        "keywordIndices": [],
        "keywords": [],
        "parameterBlobIndex": 0,
        "programBlobIndex": 8,
        "gpuProgramType": SPIRV_PROGRAM_TYPE,
        "shaderRequirements": 1,
    }
    for key, expected in expected_selection.items():
        if selected[key] != expected:
            raise RuntimeError(
                f"selected Vulkan variant {key} expected {expected!r}, got {selected[key]!r}"
            )

    compressed_blob = bytes(shader.get("compressedBlob", []))
    offsets = shader["offsets"][0]
    compressed_lengths = shader["compressedLengths"][0]
    decompressed_lengths = shader["decompressedLengths"][0]
    if len(compressed_lengths) != 1 or len(decompressed_lengths) != 1:
        raise RuntimeError("expected one Vulkan compressed program block")
    offset = int(offsets[0] if isinstance(offsets, list) else offsets)
    compressed = compressed_blob[offset:offset + int(compressed_lengths[0])]
    decompressed = lz4.block.decompress(
        compressed, uncompressed_size=int(decompressed_lengths[0])
    )
    entries = SHADER_HELPER.parse_table(decompressed)
    parameter_entry = entries[selected["parameterBlobIndex"]]
    texture_names = {
        item["name"] for item in SHADER_HELPER.properties(parsed) if item["type"] == 4
    }
    parameters = SHADER_HELPER.parse_parameter_entry(
        bytes.fromhex(parameter_entry["rawHex"]), texture_names
    )
    common_textures = SHADER_HELPER.common_textures(shader_pass)
    program_entry = entries[selected["programBlobIndex"]]
    modules = SHADER_HELPER.decode_modules(bytes.fromhex(program_entry["rawHex"]))
    if sorted(item["stage"] for item in modules) != ["fragment", "vertex"]:
        raise RuntimeError("selected program must contain one vertex and one fragment module")

    return {
        "source": {
            "relativePath": SHADER_RELATIVE_PATH.as_posix(),
            "bundle": raw_record(bundle_bytes),
            "serializedFile": str(shader_object.assets_file.name),
            "shaderObject": {"pathId": str(shader_object.path_id), **raw_record(raw)},
        },
        "shader": {
            "name": parsed["m_Name"],
            "properties": SHADER_HELPER.properties(parsed),
            "keywordNames": keyword_names,
            "keywordFlags": [int(value) for value in parsed.get("m_KeywordFlags", [])],
            "tags": dict(subshaders[0].get("m_Tags", {}).get("tags", [])),
            "subshaderCount": len(subshaders),
            "passCount": len(subshaders[0].get("m_Passes", [])),
            "pass": {
                "name": shader_pass.get("m_Name", ""),
                "type": int(shader_pass.get("m_Type", -1)),
                "programMask": int(shader_pass.get("m_ProgramMask", 0)),
                "tags": dict(shader_pass.get("m_Tags", {}).get("tags", [])),
                "renderState": SHADER_HELPER.render_state(shader_pass),
            },
        },
        "compiledVariants": compiled,
        "selectedVariant": selected,
        "programBlock": {
            "platform": VULKAN_PLATFORM,
            "compressed": raw_record(compressed),
            "decompressed": raw_record(decompressed),
            "entries": entries,
        },
        "bindings": {
            "commonTextures": common_textures,
            "parameterEntry": parameters,
        },
        "modules": modules,
    }


def extract(apkm_path: Path, decrypted_root: Path) -> dict:
    apkm = apkm_path.read_bytes()
    with zipfile.ZipFile(io.BytesIO(apkm)) as outer:
        base_apk = outer.read("base.apk")
        arm64_apk = outer.read("split_config.arm64_v8a.apk")
    with zipfile.ZipFile(io.BytesIO(arm64_apk)) as split:
        libil2cpp = split.read(BASIS.IL2CPP_PATH)
    with zipfile.ZipFile(io.BytesIO(base_apk)) as apk:
        encrypted_metadata = apk.read(BASIS.METADATA_PATH)

    elf = BASIS.Elf64(libil2cpp)
    metadata, metadata_source = BASIS.decrypt_global_metadata(encrypted_metadata, elf)
    definitions = MetadataDefinitions(metadata)
    types = {
        key: definitions.selected_type(selection)
        for key, selection in TYPE_SELECTIONS.items()
    }
    methods = {key: method_evidence(elf, key, types) for key in METHODS}
    relocations = elf.relocations()
    literals = BASIS.MetadataLiterals(metadata)
    path_literals = {
        "cardSystemCommonFile": BASIS.literal_slot_evidence(
            relocations, literals, 0x6C4B908
        ),
        "resolverPrefix": BASIS.literal_slot_evidence(
            relocations, literals, 0x6C62B78
        ),
    }
    if path_literals["cardSystemCommonFile"]["value"] != "Materials/UI_Default_From_RT.mat":
        raise RuntimeError("CardSystemCommonFile UI Default path literal changed")
    if path_literals["resolverPrefix"]["value"] != "/Common/CardNew/System/":
        raise RuntimeError("Card_CardSystemCommonFile resolver prefix changed")
    asset_bundle_path = (
        path_literals["resolverPrefix"]["value"]
        + path_literals["cardSystemCommonFile"]["value"]
    )
    mapped_bundle = asset_bundle_path.lstrip("/") + "_bundles"
    if mapped_bundle != MATERIAL_RELATIVE_PATH.as_posix():
        raise RuntimeError(
            f"resolved asset path maps to {mapped_bundle}, expected {MATERIAL_RELATIVE_PATH}"
        )

    type_usages = {
        "cardPaths": type_usage_evidence(elf, relocations, 0x6C4AF88, types["cardPaths"]),
        "cardPathsImpl": type_usage_evidence(
            elf, relocations, 0x6C4BC10, types["cardPathsImpl"]
        ),
        "cardSystemCommonFile": type_usage_evidence(
            elf, relocations, 0x6C4B7D8, types["cardSystemCommonFile"]
        ),
    }

    material = material_evidence(decrypted_root)
    shader = shader_evidence(decrypted_root, material)
    if material["name"] != "UI_Default_From_RT":
        raise RuntimeError(f"unexpected Material name {material['name']!r}")
    if material["validKeywords"] or material["invalidKeywords"]:
        raise RuntimeError("serialized UI_Default_From_RT Material keywords changed")
    if material["savedProperties"]["textures"].get("_MainTex") != {
        "fileId": 0, "pathId": "0", "scale": [1.0, 1.0], "offset": [0.0, 0.0]
    }:
        raise RuntimeError("serialized UI_Default_From_RT _MainTex slot changed")

    return {
        "schemaVersion": 1,
        "status": "proved-with-explicit-boundaries",
        "evidencePolicy": {
            "officialOnly": True,
            "readInputs": [
                "1.6.0 APKM base.apk and arm64 split",
                "1.6.0 decrypted official Material and Shader bundles",
            ],
            "excludedInputs": [
                "Il2CppDumper output", "scene.json", "recipes", "browser runtime",
                "screenshots", "generated WebGL2 assets",
            ],
        },
        "source": {
            "apkmPath": str(apkm_path.resolve()),
            "apkm": hash_record(apkm),
            "baseApk": hash_record(base_apk),
            "arm64Split": hash_record(arm64_apk),
            "libil2cppPath": BASIS.IL2CPP_PATH,
            "libil2cpp": hash_record(libil2cpp),
            "encryptedMetadataPath": BASIS.METADATA_PATH,
            "encryptedMetadata": hash_record(encrypted_metadata),
            "decryptedMetadata": hash_record(metadata),
            "metadataDecryption": metadata_source,
            "decryptedRoot": str(decrypted_root.resolve()),
        },
        "metadata": {
            "version": definitions.version,
            "tables": definitions.tables,
            "types": types,
            "typeUsages": type_usages,
        },
        "native": {"methods": methods},
        "resourcePath": {
            "literals": path_literals,
            "assetBundlePath": asset_bundle_path,
            "decryptedBundleRelativePath": mapped_bundle,
        },
        "material": material,
        "shaderProgram": shader,
        "derived": {
            "assetChain": [
                "RuntimeCardSystem ActivateAsync allocates CardPathsImpl and CardSystem.SetPaths stores it as CardPaths.Impl",
                "UICardView.ProvideMaterial calls CardPaths.get_UIDefaultFromRT",
                "CardPaths.get_UIDefaultFromRT dispatches ICardPaths slot 6 to CardPathsImpl.UIDefaultFromRT",
                "CardPathsImpl reads CardSystemCommonFile.Materials_UI_Default_From_RT_mat.Path at +0x10",
                "CardSystemCommonFile..cctor constructs that field from Materials/UI_Default_From_RT.mat",
                "Card_CardSystemCommonFile resolver prefixes /Common/CardNew/System/ and returns an AssetBundle path",
                "the decrypted Material object Shader PPtr/external CAB resolves the exact Shader object",
                "Vulkan progVertex group 3 variant 0 selects empty keywords, parameterBlob 0, and programBlob 8",
            ],
            "fragmentDataFlow": {
                "tint": "vertexColor * _Color",
                "uv": "uv0 * _MainTex_ST.xy + _MainTex_ST.zw",
                "rgb": "(sample.rgb + _TextureSampleAdd.rgb) * tint.rgb * tint.a",
                "alpha": "(1.0 - sample.a) * tint.a",
                "mrt1": "vec4(0.0)",
            },
            "renderBlend": {
                "source": "One",
                "destination": "OneMinusSrcAlpha",
                "sourceValue": 1,
                "destinationValue": 10,
            },
        },
        "unproved": [
            {
                "id": "texture-sample-add-per-draw-value",
                "status": "unproved",
                "claim": "the actual _TextureSampleAdd value supplied for each dynamic UI draw",
            },
            {
                "id": "main-texture-srgb-physical-format",
                "status": "unproved",
                "claim": "the physical sRGB/linear format of the runtime _MainTex RenderTexture",
            },
            {
                "id": "dynamic-ui-keyword-state",
                "status": "unproved",
                "claim": "the runtime dynamic UI keyword set for each draw despite the serialized Material having no keywords",
            },
        ],
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--apkm", type=Path,
        default=Path(os.environ.get("PCR_APKM", DEFAULT_APKM)),
    )
    parser.add_argument(
        "--decrypted-root", type=Path,
        default=Path(os.environ.get("PCR_DECRYPTED_ROOT", DEFAULT_DECRYPTED_ROOT)),
    )
    parser.add_argument("--pretty", action="store_true")
    args = parser.parse_args()
    if not args.apkm.is_file():
        parser.error(f"APKM not found: {args.apkm}")
    if not args.decrypted_root.is_dir():
        parser.error(f"decrypted root not found: {args.decrypted_root}")
    result = extract(args.apkm.resolve(), args.decrypted_root.resolve())
    json.dump(result, sys.stdout, ensure_ascii=True, indent=2 if args.pretty else None)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
