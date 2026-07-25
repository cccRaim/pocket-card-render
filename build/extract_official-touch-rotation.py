#!/usr/bin/env python3
"""Extract the official touch-rotation chain from package/decrypted bytes.

The APKM supplies encrypted IL2CPP metadata and arm64 libil2cpp.so. One pinned
decrypted CommonUICardDetailCard bundle supplies the serialized interaction
flags. Repository scenes, recipes, screenshots, and browser code are not read.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import io
import json
import math
import os
from pathlib import Path
import struct
import sys
import warnings
import zipfile

sys.dont_write_bytecode = True

ROOT = Path(__file__).resolve().parents[1]
BASIS_PATH = ROOT / "build" / "extract_official_pass_partition.py"
DEFAULT_APKM = (
    ROOT.parent / "ptcg-apk-parser" / "apks" /
    "jp.pokemon.pokemontcgp_1.6.0.apkm"
)
DEFAULT_DETAIL_BUNDLE = (
    ROOT.parent / "ptcgp-tools-master" / "masterdata_decoder" / ".output" /
    "decrypted" / "Common" / "UI" / "Prefabs" / "Common" /
    "CommonUICardDetailCard.prefab_bundles"
)

UNITY_VERSION = "2022.3.62f2"
DETAIL_CONTAINER = (
    "Assets/Lettuce/_Data/Common/UI/Prefabs/Common/"
    "CommonUICardDetailCard.prefab"
)
DETAIL_COMPONENT_PATH_ID = -2600777029953942905
DETAIL_GAME_OBJECT_PATH_ID = 7108130666142665351

METADATA_METHODS_PAIR = 5
METADATA_FIELDS_PAIR = 11
METADATA_TYPES_PAIR = 19
METHOD_DEFINITION_SIZE = 36
FIELD_DEFINITION_SIZE = 12
TYPE_DEFINITION_SIZE = 88


def load_basis():
    spec = importlib.util.spec_from_file_location("pcr_touch_basis", BASIS_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load extraction basis: {BASIS_PATH}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


BASIS = load_basis()

# Package-matched locators. The audit pins every complete body and selected
# byte window, while metadata records pin the declaring type and method names.
METHODS = {
    "touchOnUpdate": ("TouchStateRotation.OnUpdate", 0x4391054, 0x4391444),
    "touchOnDrag": ("TouchStateRotation.OnDrag", 0x4391444, 0x43919B8),
    "initializeTouchStateMachine": (
        "UIAsset3DView.InitializeTouchStateMachine", 0x4393E84, 0x4393EC0
    ),
    "uiAssetOnDrag": ("UIAsset3DView.OnDrag", 0x4393478, 0x43935D8),
    "createTouchStateMachine": (
        "UICardView.CreateTouchStateMachine", 0x443DF28, 0x443E090
    ),
    "vector3Cctor": ("Vector3..cctor", 0x6516510, 0x651660C),
    "quaternionCctor": ("Quaternion..cctor", 0x6517710, 0x6517760),
}

WINDOWS = {
    "touchOperationGate": (0x4393E84, 0x4393EC0),
    "rotationFactory30Degrees": (0x443E000, 0x443E030),
    "eventPositionToLocalPoint": (0x4391588, 0x4391628),
    "xLocalNormalizeAcosDelta": (0x43916D8, 0x4391724),
    "qYAngleAxisAndIdentityProduct": (0x4391740, 0x4391800),
    "yLocalNormalizeAcosDelta": (0x4391800, 0x4391844),
    "qXAngleAxisAndQYQXProduct": (0x4391860, 0x4391920),
    "storeDragDelta": (0x4391920, 0x4391958),
    "currentTimesDelta": (0x4391218, 0x43912C0),
    "zeroRollAndRebuild": (0x43912C0, 0x439133C),
    "angleClamp": (0x439133C, 0x43913E0),
    "setRotationAndClearDelta": (0x43913E0, 0x439141C),
    "vector3UpLeftInitialization": (0x6516578, 0x65165B4),
    "quaternionIdentityInitialization": (0x6517740, 0x6517758),
}

SIGNATURES = {
    "initializeTouchStateMachine": {
        0x4393E88: "ldrb w8, [x0, #0xd8]",
        0x4393E8C: "cbz w8, #0x4393eb8",
        0x4393EA0: "blr x9",
    },
    "uiAssetOnDrag": {
        0x43935A0: "ldr x0, [x20, #0xe0]",
        0x43935A8: "bl #0x4390ad4",
        0x43935B8: "ldp x9, x2, [x8, #0x1d8]",
        0x43935BC: "blr x9",
    },
    "createTouchStateMachine": {
        0x443E004: "ldrb w21, [x19, #0x15e]",
        0x443E00C: "fmov s0, #30.00000000",
        0x443E01C: "bl #0x4390e04",
        0x443E02C: "bl #0x4390a2c",
    },
    "touchOnDrag": {
        0x4391588: "ldr s9, [x20, #0x104]",
        0x439158C: "ldr s8, [x20, #0x108]",
        0x4391620: "bl #0x671a4d8",
        0x43916D4: "bl #0x652ada4",
        0x43916E4: "fmul s13, s2, s12",
        0x43916E8: "fdiv s0, s8, s13",
        0x43916F8: "bl #0x67bed20",
        0x43916FC: "ldr s1, [sp, #0x68]",
        0x4391704: "fdiv s1, s1, s13",
        0x4391718: "bl #0x67bed20",
        0x4391720: "fsub s8, s0, s8",
        0x4391750: "ldr s13, [x9, #0xf4]",
        0x4391758: "fmul s0, s8, s13",
        0x4391760: "ldp s1, s2, [x8, #0x18]",
        0x4391764: "ldr s3, [x8, #0x20]",
        0x4391768: "bl #0x6516b1c",
        0x4391800: "bl #0x652ada4",
        0x4391804: "fmul s8, s3, s12",
        0x4391808: "fdiv s0, s9, s8",
        0x4391818: "bl #0x67bed20",
        0x439181C: "ldr s1, [sp, #0x6c]",
        0x4391820: "fdiv s1, s1, s8",
        0x4391838: "bl #0x67bed20",
        0x4391840: "fsub s8, s0, s8",
        0x4391864: "fmul s0, s8, s13",
        0x4391870: "ldp s1, s2, [x8, #0x30]",
        0x4391874: "ldr s3, [x8, #0x38]",
        0x4391878: "bl #0x6516b1c",
        0x4391918: "stp d1, d0, [sp, #0x50]",
        0x4391938: "stur q0, [x19, #0x2c]",
        0x4391940: "str w8, [x19, #0x3c]",
    },
    "touchOnUpdate": {
        0x4391218: "bl #0x652cd54",
        0x4391240: "bl #0x333c670",
        0x43912B0: "fsub s0, s4, s2",
        0x43912B4: "fsub s1, s6, s7",
        0x43912B8: "fsub s2, s16, s17",
        0x43912BC: "fsub s3, s5, s3",
        0x43912C0: "bl #0x6516a7c",
        0x4391310: "movi d2, #0000000000000000",
        0x4391338: "bl #0x65169e4",
        0x4391378: "fabs s0, s0",
        0x439138C: "ldr s13, [x19, #0x18]",
        0x4391398: "bl #0x67bed20",
        0x439139C: "fadd s0, s0, s0",
        0x43913A0: "fmul s0, s0, s12",
        0x43913AC: "fdiv s0, s13, s0",
        0x43913CC: "fmin s16, s0, s1",
        0x43913DC: "bl #0x6516834",
        0x4391410: "bl #0x652cddc",
        0x4391414: "stp xzr, xzr, [x20]",
        0x4391418: "str wzr, [x20, #0x10]",
    },
    "vector3Cctor": {
        0x6516580: "str d1, [x8, #0x18]",
        0x6516588: "str wzr, [x8, #0x20]",
        0x65165A8: "str d1, [x8, #0x30]",
        0x65165B0: "str wzr, [x8, #0x38]",
    },
    "quaternionCctor": {
        0x6517750: "ldr q0, [x9, #0xec0]",
        0x6517754: "str q0, [x8]",
    },
}

TYPE_SELECTIONS = {
    "touchStateRotation": (
        "Lettuce.Infrastructure.Asset3D.Core", "TouchStateRotation",
        ("_maxRotationDegree", "_prevPoint", "_rot"),
        ((".ctor", 2), ("OnUpdate", 0), ("OnDrag", 1)),
    ),
    "uiAsset3DView": (
        "Lettuce.Infrastructure.Asset3D.Core", "UIAsset3DView",
        ("_useTouchOperation",),
        (("OnDrag", 1), ("InitializeTouchStateMachine", 0)),
    ),
    "uiCardView": (
        "Lettuce.Infrastructure.Card.Core", "UICardView",
        ("_useGyro", "_flip"),
        (("CreateTouchStateMachine", 0),),
    ),
    "pointerEventData": (
        "UnityEngine.EventSystems", "PointerEventData",
        ("<pointerId>k__BackingField", "<position>k__BackingField"), (),
    ),
    "rect": (
        "UnityEngine", "Rect",
        ("m_XMin", "m_YMin", "m_Width", "m_Height"), (),
    ),
    "vector3": (
        "UnityEngine", "Vector3", ("upVector", "leftVector"),
        ((".cctor", 0),),
    ),
    "quaternion": (
        "UnityEngine", "Quaternion", ("identityQuaternion",),
        (("SlerpUnclamped", 3), ("Internal_FromEulerRad", 1),
         ("Internal_ToEulerRad", 1), ("AngleAxis", 2), (".cctor", 0)),
    ),
    "rectTransform": (
        "UnityEngine", "RectTransform", (), (("get_rect", 0),),
    ),
    "rectTransformUtility": (
        "UnityEngine", "RectTransformUtility", (),
        (("ScreenPointToLocalPointInRectangle", 4),),
    ),
    "transform": (
        "UnityEngine", "Transform", (),
        (("get_localRotation", 0), ("set_localRotation", 1)),
    ),
}


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def raw_record(data: bytes) -> dict:
    return {"byteSize": len(data), "rawHex": data.hex(), "sha256": sha256(data)}


def rva_record(elf, rva: int, fmt: str) -> dict:
    size = struct.calcsize(fmt)
    raw = elf.range(rva, rva + size)
    values = list(struct.unpack(fmt, raw))
    return {"rva": f"0x{rva:x}", "values": values, **raw_record(raw)}


def metadata_table(data: bytes, pair_index: int, record_size: int) -> dict:
    offset, size = struct.unpack_from("<II", data, 8 + pair_index * 8)
    if size % record_size:
        raise RuntimeError(f"metadata table {pair_index} is not record aligned")
    raw = data[offset:offset + size]
    if len(raw) != size:
        raise RuntimeError(f"metadata table {pair_index} is truncated")
    return {
        "offset": offset, "byteSize": size, "recordSize": record_size,
        "count": size // record_size, "sha256": sha256(raw),
    }


class MetadataDefinitions:
    def __init__(self, data: bytes):
        self.data = data
        magic, self.version = struct.unpack_from("<II", data)
        if magic != 0xFAB11BAF or self.version != 31:
            raise RuntimeError(f"expected IL2CPP metadata v31, got {self.version}")
        self.string_offset, self.string_size = struct.unpack_from("<II", data, 24)
        self.tables = {
            "methods": metadata_table(data, METADATA_METHODS_PAIR, METHOD_DEFINITION_SIZE),
            "fields": metadata_table(data, METADATA_FIELDS_PAIR, FIELD_DEFINITION_SIZE),
            "types": metadata_table(data, METADATA_TYPES_PAIR, TYPE_DEFINITION_SIZE),
        }

    def string(self, index: int) -> str:
        start = self.string_offset + index
        limit = self.string_offset + self.string_size
        end = self.data.find(b"\0", start, limit)
        if start < self.string_offset or end < 0:
            raise RuntimeError(f"invalid metadata string index {index}")
        return self.data[start:end].decode("utf-8")

    def record(self, table: str, index: int) -> tuple[int, bytes]:
        spec = self.tables[table]
        if index < 0 or index >= spec["count"]:
            raise RuntimeError(f"metadata {table} index {index} out of range")
        offset = spec["offset"] + index * spec["recordSize"]
        return offset, self.data[offset:offset + spec["recordSize"]]

    def field(self, index: int) -> dict:
        offset, raw = self.record("fields", index)
        name_index, type_index, token = struct.unpack("<III", raw)
        return {
            "name": self.string(name_index), "typeIndex": type_index,
            "token": f"0x{token:08x}", "recordFileOffset": offset,
            "record": raw_record(raw),
        }

    def method(self, index: int) -> dict:
        offset, raw = self.record("methods", index)
        name_index = struct.unpack_from("<I", raw)[0]
        token = struct.unpack_from("<I", raw, 24)[0]
        slot, parameter_count = struct.unpack_from("<HH", raw, 32)
        return {
            "name": self.string(name_index), "token": f"0x{token:08x}",
            "slot": slot, "parameterCount": parameter_count,
            "recordFileOffset": offset, "record": raw_record(raw),
        }

    def type(self, namespace: str, name: str, fields, methods) -> dict:
        matches = []
        for index in range(self.tables["types"]["count"]):
            offset, raw = self.record("types", index)
            name_index, namespace_index = struct.unpack_from("<II", raw)
            if self.string(name_index) == name and self.string(namespace_index) == namespace:
                matches.append((index, offset, raw))
        if len(matches) != 1:
            raise RuntimeError(f"metadata type {namespace}.{name} occurs {len(matches)} times")
        index, offset, raw = matches[0]
        values = struct.unpack_from("<16I", raw)
        counts = struct.unpack_from("<8H", raw, 64)
        field_start, method_start = values[8], values[9]
        all_fields = [self.field(field_start + i) for i in range(counts[2])]
        all_methods = [self.method(method_start + i) for i in range(counts[0])]

        selected_fields = {}
        for requested in fields:
            found = [row for row in all_fields if row["name"] == requested]
            if len(found) != 1:
                raise RuntimeError(f"{namespace}.{name} field {requested} occurs {len(found)} times")
            selected_fields[requested] = found[0]

        selected_methods = {}
        for requested, parameter_count in methods:
            found = [
                row for row in all_methods
                if row["name"] == requested and row["parameterCount"] == parameter_count
            ]
            if len(found) != 1:
                raise RuntimeError(
                    f"{namespace}.{name} method {requested}/{parameter_count} occurs {len(found)} times"
                )
            selected_methods[requested] = found[0]

        return {
            "namespace": namespace, "name": name, "typeDefinitionIndex": index,
            "fieldCount": counts[2], "methodCount": counts[0],
            "recordFileOffset": offset, "record": raw_record(raw),
            "selectedFields": selected_fields, "selectedMethods": selected_methods,
        }


def instruction_text(item) -> str:
    return f"{item.mnemonic} {item.op_str}".strip()


def instruction_record(item) -> dict:
    raw = bytes(item.bytes)
    return {
        "address": f"0x{item.address:x}", "text": instruction_text(item),
        "bytesHex": raw.hex(), "sha256": sha256(raw),
    }


def method_record(elf, key: str) -> dict:
    name, start, end = METHODS[key]
    raw = elf.range(start, end)
    decoder = BASIS.Cs(BASIS.CS_ARCH_ARM64, BASIS.CS_MODE_ARM)
    instructions = list(decoder.disasm(raw, start))
    by_address = {item.address: item for item in instructions}
    selected = []
    for address, expected in SIGNATURES.get(key, {}).items():
        item = by_address.get(address)
        actual = instruction_text(item) if item else None
        if actual != expected:
            raise RuntimeError(
                f"{name} 0x{address:x}: expected {expected!r}, got {actual!r}"
            )
        selected.append(instruction_record(item))
    return {
        "name": name, "rvaStart": f"0x{start:x}", "rvaEnd": f"0x{end:x}",
        **raw_record(raw), "selectedInstructions": selected,
    }


def window_record(elf, start: int, end: int) -> dict:
    raw = elf.range(start, end)
    return {
        "rvaStart": f"0x{start:x}", "rvaEnd": f"0x{end:x}",
        **raw_record(raw),
    }


def resolve_plt_symbol(elf, target_rva: int) -> dict:
    plt_rva, _, _ = elf.sections[".plt"]
    if target_rva < plt_rva + 0x20 or (target_rva - plt_rva - 0x20) % 0x10:
        raise RuntimeError(f"0x{target_rva:x} is not a standard AArch64 PLT entry")
    index = (target_rva - plt_rva - 0x20) // 0x10
    _, rela_offset, rela_size = elf.sections[".rela.plt"]
    if (index + 1) * 24 > rela_size:
        raise RuntimeError("PLT relocation index is out of range")
    relocation_offset = rela_offset + index * 24
    relocation_raw = elf.data[relocation_offset:relocation_offset + 24]
    got_rva, info, addend = struct.unpack("<QQq", relocation_raw)
    symbol_index = info >> 32
    _, dynsym_offset, dynsym_size = elf.sections[".dynsym"]
    symbol_offset = dynsym_offset + symbol_index * 24
    if symbol_offset + 24 > dynsym_offset + dynsym_size:
        raise RuntimeError("PLT dynamic symbol index is out of range")
    symbol_raw = elf.data[symbol_offset:symbol_offset + 24]
    name_index = struct.unpack_from("<I", symbol_raw)[0]
    _, dynstr_offset, dynstr_size = elf.sections[".dynstr"]
    name_start = dynstr_offset + name_index
    name_end = elf.data.find(b"\0", name_start, dynstr_offset + dynstr_size)
    name_raw = elf.data[name_start:name_end]
    entry_raw = elf.range(target_rva, target_rva + 16)
    return {
        "entryRva": f"0x{target_rva:x}", "entryIndex": index,
        "entry": raw_record(entry_raw), "gotRva": f"0x{got_rva:x}",
        "relocationFileOffset": relocation_offset,
        "relocation": {"symbolIndex": symbol_index, "addend": addend, **raw_record(relocation_raw)},
        "dynamicSymbolFileOffset": symbol_offset, "dynamicSymbol": raw_record(symbol_raw),
        "name": name_raw.decode("ascii"), "nameBytes": raw_record(name_raw),
    }


def extract_detail_bundle(path: Path) -> dict:
    bundle = path.read_bytes()
    BASIS.UnityPy.config.FALLBACK_UNITY_VERSION = UNITY_VERSION
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        environment = BASIS.UnityPy.load(bundle)
        if DETAIL_CONTAINER not in environment.container:
            raise RuntimeError(f"detail bundle does not contain {DETAIL_CONTAINER}")
        objects = {int(obj.path_id): obj for obj in environment.objects}
        component = objects.get(DETAIL_COMPONENT_PATH_ID)
        if component is None or component.type.name != "MonoBehaviour":
            raise RuntimeError("pinned detail MonoBehaviour is missing")
        tree = component.read_typetree()
        raw = bytes(component.get_raw_data())
        game_object = objects.get(DETAIL_GAME_OBJECT_PATH_ID)
        if game_object is None or game_object.type.name != "GameObject":
            raise RuntimeError("pinned detail GameObject is missing")
        game_object_tree = game_object.read_typetree()

    if int((tree.get("m_GameObject") or {}).get("m_PathID", 0)) != DETAIL_GAME_OBJECT_PATH_ID:
        raise RuntimeError("detail component GameObject pointer changed")
    if game_object_tree.get("m_Name") != "card_img":
        raise RuntimeError("detail component GameObject is no longer card_img")
    expected = {"_useTouchOperation": 1, "_cardSize": 6, "_useGyro": 0}
    for name, value in expected.items():
        if int(tree.get(name, -1)) != value:
            raise RuntimeError(f"detail {name}: expected {value}, got {tree.get(name)}")

    def field(name: str, offset: int) -> dict:
        slot = raw[offset:offset + 4]
        if len(slot) != 4 or int.from_bytes(slot, "little") != expected[name]:
            raise RuntimeError(f"detail {name} aligned raw slot changed")
        return {
            "name": name, "value": bool(expected[name]) if name != "_cardSize" else expected[name],
            "objectOffset": offset, "logicalByteSize": 1 if name != "_cardSize" else 4,
            "alignedSlot": raw_record(slot),
        }

    return {
        "status": "proved-for-one-pinned-object",
        "scope": "one CommonUICardDetailCard component, not a prefab corpus",
        "bundlePath": str(path.resolve()), "bundle": raw_record(bundle),
        "container": DETAIL_CONTAINER, "serializedFile": str(component.assets_file.name),
        "component": {
            "pathId": str(component.path_id), "type": component.type.name,
            "byteStart": component.byte_start, **raw_record(raw),
        },
        "gameObject": {
            "pathId": str(DETAIL_GAME_OBJECT_PATH_ID), "name": game_object_tree["m_Name"],
        },
        "fields": {
            "_useTouchOperation": field("_useTouchOperation", 0x58),
            "_cardSize": field("_cardSize", 0x60),
            "_useGyro": field("_useGyro", 0x64),
        },
    }


def extract(apkm_path: Path, detail_bundle_path: Path) -> dict:
    apkm = apkm_path.read_bytes()
    with zipfile.ZipFile(io.BytesIO(apkm)) as outer:
        base_apk = outer.read("base.apk")
        arm64_apk = outer.read("split_config.arm64_v8a.apk")
    with zipfile.ZipFile(io.BytesIO(base_apk)) as apk:
        encrypted_metadata = apk.read(BASIS.METADATA_PATH)
    with zipfile.ZipFile(io.BytesIO(arm64_apk)) as split:
        libil2cpp = split.read(BASIS.IL2CPP_PATH)

    elf = BASIS.Elf64(libil2cpp)
    metadata, metadata_source = BASIS.decrypt_global_metadata(encrypted_metadata, elf)
    definitions = MetadataDefinitions(metadata)
    types = {
        key: definitions.type(namespace, name, fields, methods)
        for key, (namespace, name, fields, methods) in TYPE_SELECTIONS.items()
    }
    methods = {key: method_record(elf, key) for key in METHODS}
    windows = {
        key: window_record(elf, start, end)
        for key, (start, end) in WINDOWS.items()
    }
    detail = extract_detail_bundle(detail_bundle_path)

    rad_to_deg = rva_record(elf, 0x1AF90F4, "<f")
    vector_up_xy = rva_record(elf, 0x1AF84D0, "<ff")
    vector_left_xy = rva_record(elf, 0x1AF89C8, "<ff")
    quaternion_identity = rva_record(elf, 0x1AF6EC0, "<ffff")
    if not math.isclose(rad_to_deg["values"][0], 180.0 / math.pi, abs_tol=1e-6):
        raise RuntimeError("Rad2Deg constant changed")
    if vector_up_xy["values"] != [0.0, 1.0]:
        raise RuntimeError("Vector3.up xy constant changed")
    if vector_left_xy["values"] != [-1.0, 0.0]:
        raise RuntimeError("Vector3.left xy constant changed")
    if quaternion_identity["values"] != [0.0, 0.0, 0.0, 1.0]:
        raise RuntimeError("Quaternion.identity constant changed")

    acosf = resolve_plt_symbol(elf, 0x67BED20)
    if acosf["name"] != "acosf":
        raise RuntimeError(f"expected acosf PLT symbol, got {acosf['name']}")

    return {
        "schemaVersion": 1,
        "status": "proved-with-explicit-boundaries",
        "source": {
            "apkm": str(apkm_path.resolve()), "apkmSha256": sha256(apkm),
            "baseApkSha256": sha256(base_apk), "arm64SplitSha256": sha256(arm64_apk),
            "libil2cppPath": BASIS.IL2CPP_PATH, "libil2cppSha256": sha256(libil2cpp),
            "metadata": metadata_source,
            "detailBundlePath": str(detail_bundle_path.resolve()),
            "detailBundleSha256": detail["bundle"]["sha256"],
        },
        "metadata": {"version": definitions.version, "tables": definitions.tables, "types": types},
        "serializedDetail": detail,
        "native": {
            "methods": methods, "windows": windows, "acosfImport": acosf,
            "constants": {
                "radToDeg": rad_to_deg, "vectorUpXY": vector_up_xy,
                "vectorLeftXY": vector_left_xy, "quaternionIdentity": quaternion_identity,
            },
        },
        "derived": {
            "interactionChain": [
                "serialized _useTouchOperation=true",
                "UIAsset3DView.InitializeTouchStateMachine reads instance +0xd8 and invokes virtual factory",
                "UICardView.CreateTouchStateMachine constructs TouchStateRotation(30, _flip)",
                "UIAsset3DView.OnDrag dispatches to the current TouchState.OnDrag",
            ],
            "localNormalization": {
                "conversion": "RectTransformUtility.ScreenPointToLocalPointInRectangle",
                "x": "clamp(localX / (rect.width * 0.5), -1, 1)",
                "y": "clamp(localY / (rect.height * 0.5), -1, 1)",
            },
            "angleDelta": {
                "directImportedFunction": "acosf",
                "directRadians": "acos(currentNormalized) - acos(previousNormalized)",
                "equivalentAsinRadians": "asin(previousNormalized) - asin(currentNormalized)",
                "equivalenceBasis": "acos(x) = pi/2 - asin(x)",
                "warning": "asin form is a mathematical derivation; the official direct symbol is acosf",
            },
            "dragDeltaQuaternion": {
                "qY": "Quaternion.AngleAxis(xDeltaRadians * Rad2Deg, Vector3.up)",
                "qX": "Quaternion.AngleAxis(yDeltaRadians * Rad2Deg, Vector3.left)",
                "identity": [0.0, 0.0, 0.0, 1.0],
                "composition": "qY * qX",
                "hamiltonOperandOrder": "left=qY, right=qX",
            },
            "application": {
                "composition": "currentLocalRotation * dragDelta",
                "hamiltonOperandOrder": "left=currentLocalRotation, right=dragDelta",
                "roll": "convert to Euler degrees, set z=0, rebuild quaternion",
            },
            "clamp": {
                "factoryMaxDegrees": 30.0,
                "angle": "2 * acos(abs(dot(identity, candidate))) * Rad2Deg",
                "factor": "min(maxRotationDegree / angle, 1)",
                "operation": "Quaternion.SlerpUnclamped(identity, candidate, factor)",
            },
            "ordinaryDetail": {"useTouchOperation": True, "useGyro": False},
        },
        "unproved": [
            {
                "id": "other-prefabs-or-runtime-mutation", "status": "unproved",
                "claim": "other prefabs and runtime mutation of _useTouchOperation/_useGyro",
            },
            {
                "id": "pointer-samples-and-event-cadence", "status": "unproved",
                "claim": "actual device pointer samples, Canvas/camera state, and event cadence",
            },
            {
                "id": "browser-runtime-equivalence", "status": "unproved",
                "claim": "browser implementation and floating-point execution equivalence",
            },
            {
                "id": "visual-output-parity", "status": "unproved",
                "claim": "visual or final-pixel parity; screenshots are not evidence in this audit",
            },
        ],
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apkm", type=Path, default=Path(os.environ.get("PCR_APKM", DEFAULT_APKM)))
    parser.add_argument(
        "--detail-bundle", type=Path,
        default=Path(os.environ.get("PCR_CARD_VIEW_BUNDLE", DEFAULT_DETAIL_BUNDLE)),
    )
    parser.add_argument("--pretty", action="store_true")
    args = parser.parse_args()
    if not args.apkm.is_file():
        parser.error(f"APKM not found: {args.apkm}")
    if not args.detail_bundle.is_file():
        parser.error(f"detail bundle not found: {args.detail_bundle}")
    json.dump(
        extract(args.apkm.resolve(), args.detail_bundle.resolve()), sys.stdout,
        ensure_ascii=True, indent=2 if args.pretty else None,
    )
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
