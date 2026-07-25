#!/usr/bin/env python3
"""Extract package-backed card camera and transform facts without screenshots.

The RVAs below are locators for the package-matched 1.6.0 APKM. Native code,
constants, metadata, and the studio prefab are read from that APKM at runtime.
The ordinary detail-view gate is read from one precisely pinned official
decrypted AssetBundle. Every source and selected byte range is hashed. Shared
APKM/ELF/metadata helpers are reused from extract_official_pass_partition.py.
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
import re
import struct
import sys
import zipfile

sys.dont_write_bytecode = True

ROOT = Path(__file__).resolve().parents[1]
BASIS_PATH = ROOT / "build" / "extract_official_pass_partition.py"
DEFAULT_APKM = (
    ROOT.parent
    / "ptcg-apk-parser"
    / "apks"
    / "jp.pokemon.pokemontcgp_1.6.0.apkm"
)
DEFAULT_CARD_VIEW_BUNDLE = (
    ROOT.parent
    / "ptcgp-tools-master"
    / "masterdata_decoder"
    / ".output"
    / "decrypted"
    / "Common"
    / "UI"
    / "Prefabs"
    / "Common"
    / "CommonUICardDetailCard.prefab_bundles"
)

UNITY_VERSION = "2022.3.62f2"
CARD_VIEW_CONTAINER = (
    "Assets/Lettuce/_Data/Common/UI/Prefabs/Common/"
    "CommonUICardDetailCard.prefab"
)
CARD_VIEW_COMPONENT_PATH_ID = -2600777029953942905
CARD_VIEW_GAME_OBJECT_PATH_ID = 7108130666142665351
CARD_VIEW_USE_GYRO_RAW_OFFSET = 100

# IL2CPP metadata v31 table locators and record sizes. These are format
# locators, not evidence values; every selected record is read and hashed.
METADATA_METHODS_PAIR = 5
METADATA_FIELDS_PAIR = 11
METADATA_TYPES_PAIR = 19
METHOD_DEFINITION_SIZE = 36
FIELD_DEFINITION_SIZE = 12
TYPE_DEFINITION_SIZE = 88


def load_basis():
    spec = importlib.util.spec_from_file_location("pcr_official_extract_basis", BASIS_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load extraction basis: {BASIS_PATH}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


BASIS = load_basis()

METHODS = {
    "gyroGetActive": ("GyroManager.get_Active", 0x438DBBC, 0x438DBC4),
    "gyroSetActive": ("GyroManager.set_Active", 0x438DBC4, 0x438DBCC),
    "gyroOnDisable": ("GyroManager.OnDisable", 0x438DC50, 0x438DC74),
    "gyroOnEnable": ("GyroManager.OnEnable", 0x438DC74, 0x438DC98),
    "gyroUpdate": ("GyroManager.Update", 0x438DC98, 0x438DE04),
    "gyroUpdateBaseRotation": (
        "GyroManager.UpdateBaseRotation",
        0x438DE04,
        0x438DF00,
    ),
    "gyroUpdateRotationLimit": (
        "GyroManager.UpdateRotationLimit",
        0x438DF00,
        0x438E0B8,
    ),
    "gyroCtor": ("GyroManager..ctor", 0x438E0B8, 0x438E134),
    "assetCtor": ("Asset3DRenderer..ctor", 0x43956FC, 0x4395810),
    "createNode": ("Asset3DRenderer.CreateNode", 0x43958BC, 0x4395C7C),
    "setFlipped": ("Asset3DRenderer.SetFlipped", 0x4395EA8, 0x4395F28),
    "updateCamera": ("Asset3DRenderer.UpdateCameraSettings", 0x439612C, 0x4396274),
    "setupRenderObject": (
        "Asset3DRenderer.<SetupRenderObject>d__MoveNext",
        0x4396274,
        0x43967C8,
    ),
    "touchOnUpdate": ("TouchStateRotation.OnUpdate", 0x4391054, 0x4391444),
    "touchOnDrag": ("TouchStateRotation.OnDrag", 0x4391444, 0x43919B8),
    "uiCardTouch": ("UICardView.CreateTouchStateMachine", 0x443DF28, 0x443E090),
    "uiCardCreateRenderer": (
        "UICardView.CreateRenderer",
        0x443D880,
        0x443D96C,
    ),
    "cardRendererCtor": ("CardRenderer..ctor", 0x443D96C, 0x443DA4C),
    "cardLoad": ("CardRenderer.<LoadAsset>d__MoveNext", 0x4445220, 0x4445B84),
    "rotateGyro": ("RotateGyro.LateUpdate", 0x438E134, 0x438E22C),
    "calcHomography": (
        "HomographyShapeCorrector.CalcHomographyMatrix",
        0x43987EC,
        0x439899C,
    ),
    "getRotatedKeyPoints": (
        "ModelRenderStudio.GetRotatedKeyPoints",
        0x439899C,
        0x4398AAC,
    ),
    "applyClampedRotation": (
        "ModelRenderStudio.ApplyClampedRotation",
        0x4399008,
        0x4399358,
    ),
    "updateStudioRotation": (
        "KeepParallaxCardBehaviour.UpdateStudioRotation",
        0x441C3CC,
        0x441C474,
    ),
    "setHomography": (
        "KeepParallaxCardBehaviour.SetHomographyParameters",
        0x441C474,
        0x441C4F8,
    ),
}

SIGNATURES = {
    "gyroGetActive": {
        0x438DBBC: "ldrb w0, [x0, #0x20]",
        0x438DBC0: "ret",
    },
    "gyroSetActive": {
        0x438DBC4: "strb w1, [x0, #0x20]",
        0x438DBC8: "ret",
    },
    "gyroOnDisable": {
        0x438DC58: "bl #0x656c764",
        0x438DC60: "mov w1, wzr",
        0x438DC6C: "b #0x656bc48",
    },
    "gyroOnEnable": {
        0x438DC7C: "bl #0x656c764",
        0x438DC84: "mov w1, #1",
        0x438DC90: "b #0x656bc48",
    },
    "gyroUpdate": {
        0x438DCB8: "bl #0x656bc0c",
        0x438DCC4: "cbz w8, #0x438ddb8",
        0x438DCD8: "bl #0x656bc04",
        0x438DCE8: "bl #0x438de04",
        0x438DCEC: "fneg s0, s8",
        0x438DCF0: "fneg s1, s9",
        0x438DCF4: "ldr s2, [x19, #0x28]",
        0x438DD08: "ldr s2, [x8, #0xeb8]",
        0x438DD20: "ldur q4, [x19, #0x44]",
        0x438DDB4: "b #0x438df00",
        0x438DDF0: "stur q0, [x19, #0x44]",
    },
    "gyroUpdateBaseRotation": {
        0x438DE18: "fabs s0, s0",
        0x438DE1C: "ldr s2, [x0, #0x38]",
        0x438DE34: "stp wzr, wzr, [x19, #0x54]",
        0x438DE44: "bl #0x65296e8",
        0x438DE54: "str s0, [x19, #0x58]",
        0x438DE60: "ldr s1, [x19, #0x3c]",
        0x438DE74: "fadd s0, s0, s1",
        0x438DE8C: "str s16, [x19, #0x54]",
        0x438DEDC: "bl #0x651675c",
    },
    "gyroUpdateRotationLimit": {
        0x438DF30: "bl #0x6516a7c",
        0x438DF3C: "ldr s14, [x8, #0xf4]",
        0x438DF80: "mov w8, #-0x3c4c0000",
        0x438DF84: "mov w9, #0x43340000",
        0x438E004: "ldrb w8, [x19, #0x21]",
        0x438E018: "ldr s3, [x19, #0x24]",
        0x438E04C: "ldp s1, s2, [x19, #0x2c]",
        0x438E080: "ldr s3, [x8, #0xeb8]",
        0x438E094: "stp s0, s1, [x19, #0x44]",
        0x438E098: "stp s2, s3, [x19, #0x4c]",
    },
    "gyroCtor": {
        0x438E0D0: "ldr q0, [x8, #0xee0]",
        0x438E0D4: "mov w8, #0x999a",
        0x438E0D8: "ldr d1, [x9, #0xa38]",
        0x438E0DC: "movk w8, #0x3e99, lsl #16",
        0x438E0E4: "stur q0, [x0, #0x28]",
        0x438E0E8: "str d1, [x0, #0x38]",
        0x438E0EC: "str w8, [x0, #0x40]",
        0x438E124: "stur q0, [x19, #0x44]",
    },
    "assetCtor": {
        0x4395714: "mov w20, w1",
        0x4395748: "and w23, w20, #1",
        0x4395750: "ldr d0, [x8, #0xc78]",
        0x4395760: "str d0, [x19, #0x10]",
        0x43957F8: "strb w23, [x19, #8]",
    },
    "createNode": {
        0x4395A4C: "ldr x9, [x8, #0x248]",
        0x4395A74: "bl #0x652cdac",
        0x4395AA8: "bl #0x652d624",
    },
    "setFlipped": {
        0x4395EC8: "tst w1, #1",
        0x4395EDC: "csel x9, x10, x9, ne",
        0x4395EE0: "csel x8, x11, x8, ne",
        0x4395EEC: "ldr x21, [x0, #0x60]",
        0x4395F0C: "bl #0x652cdac",
    },
    "updateCamera": {
        0x43961DC: "mov w8, #0x420c0000",
        0x43961E8: "bl #0x64dafe0",
        0x4396248: "ldr s2, [x9, #0x48]",
        0x4396250: "ldp s3, s0, [x8, #0x54]",
        0x4396268: "b #0x652c97c",
    },
    "cardLoad": {
        0x44454A0: "mov w1, wzr",
        0x44454A8: "bl #0x4395ea8",
    },
    "uiCardTouch": {
        0x443E00C: "fmov s0, #30.00000000",
        0x443E01C: "bl #0x4390e04",
    },
    "touchOnDrag": {
        0x4391760: "ldp s1, s2, [x8, #0x18]",
        0x4391768: "bl #0x6516b1c",
        0x4391870: "ldp s1, s2, [x8, #0x30]",
        0x4391878: "bl #0x6516b1c",
    },
    "touchOnUpdate": {
        0x43911B4: "mov w2, wzr",
        0x4391208: "blr x8",
        0x4391218: "bl #0x652cd54",
        0x439124C: "mov x0, xzr",
        0x43912C0: "bl #0x6516a7c",
        0x4391310: "movi d2, #0000000000000000",
        0x4391338: "bl #0x65169e4",
        0x4391378: "fabs s0, s0",
        0x4391398: "bl #0x67bed20",
        0x43913AC: "fdiv s0, s13, s0",
        0x43913CC: "fmin s16, s0, s1",
        0x43913DC: "bl #0x6516834",
        0x4391410: "bl #0x652cddc",
    },
    "setupRenderObject": {
        0x43964E0: "ldrb w8, [x20, #0x70]",
        0x43964E4: "cbz w8, #0x4396540",
        0x4396538: "mov x0, x22",
        0x439653C: "bl #0x3228874",
    },
    "rotateGyro": {
        0x438E148: "bl #0x438da6c",
        0x438E150: "ldp s8, s9, [x0, #0x44]",
        0x438E1C8: "ldr s0, [x8, #0xe64]",
        0x438E1CC: "ldr s2, [x9, #0xeb8]",
        0x438E1D0: "fmul s0, s12, s0",
        0x438E1D4: "fmul s1, s1, s2",
        0x438E1F8: "bl #0x651e2c0",
        0x438E224: "b #0x652cddc",
    },
    "uiCardCreateRenderer": {
        0x443D920: "ldrb w23, [x19, #0x15c]",
        0x443D934: "mov w3, w23",
        0x443D940: "bl #0x443d96c",
    },
    "cardRendererCtor": {
        0x443D984: "mov w19, w4",
        0x443D988: "mov w23, w3",
        0x443DA04: "and w1, w23, #1",
        0x443DA18: "bl #0x43956fc",
    },
    "calcHomography": {
        0x4398830: "bl #0x439899c",
        0x439885C: "mov w1, #9",
        0x4398980: "str w8, [x0, #0x40]",
    },
    "getRotatedKeyPoints": {
        0x43989A8: "ldr x0, [x0, #0x38]",
        0x43989B8: "ldr x20, [x19, #0x20]",
        0x43989BC: "bl #0x652c7a4",
        0x43989CC: "bl #0x64ddce0",
        0x43989E0: "ldr x0, [x19, #0x40]",
        0x4398A1C: "ldr x0, [x19, #0x48]",
        0x4398A58: "ldr x0, [x19, #0x50]",
    },
    "applyClampedRotation": {
        0x43990B8: "bl #0x652cc44",
        0x43990C0: "bl #0x65166c0",
        0x43990E4: "bl #0x652cc44",
        0x43991E4: "bl #0x6516a7c",
        0x439925C: "bl #0x65169e4",
        0x43992F4: "bl #0x6516834",
        0x4399308: "ldr x0, [x19, #0x60]",
        0x4399314: "bl #0x65213ec",
        0x4399350: "b #0x652cddc",
    },
    "updateStudioRotation": {
        0x441C3D4: "ldrb w8, [x0, #0x38]",
        0x441C3E8: "ldr w8, [x19, #0x4c]",
        0x441C408: "ldr x8, [x19, #0x28]",
        0x441C414: "ldr x8, [x8, #0x38]",
        0x441C424: "ldr x20, [x8, #0x48]",
        0x441C42C: "ldr x8, [x19, #0x50]",
        0x441C44C: "ldr s0, [x19, #0x20]",
        0x441C45C: "bl #0x4399008",
        0x441C46C: "b #0x441c474",
    },
    "setHomography": {
        0x441C498: "bl #0x43987ec",
        0x441C4A4: "bl #0x4398aac",
        0x441C4C8: "bl #0x442cac4",
        0x441C4F0: "b #0x442cac4",
    },
}

BYTE_WINDOWS = {
    "useGyroRead": (0x443D920, 0x443D944),
    "useGyroPass": (0x443DA04, 0x443DA1C),
    "loadedAssetResult": (0x4396468, 0x439648C),
    "gyroGateAndAddComponent": (0x43964E0, 0x4396540),
    "deltaTimesCurrentQuaternion": (0x438DD1C, 0x438DDB4),
    "stationaryReturn": (0x438DE18, 0x438DEE8),
    "eulerLimit": (0x438DF30, 0x438E09C),
    "constructorDefaults": (0x438E0C0, 0x438E0F0),
    "onDisableEnable": (0x438DC50, 0x438DC98),
    "lateUpdateOutput": (0x438E150, 0x438E224),
    "touchRootResolve": (0x43911F4, 0x4391220),
    "touchRootWrite": (0x43913F8, 0x4391414),
    "keepParallaxRotationChain": (0x441C408, 0x441C470),
}

METADATA_NAMES = (
    "Asset3DRenderer",
    "UpdateCameraSettings",
    "SetFlipped",
    "ParentNodeAngle",
    "TouchStateRotation",
    "OnDrag",
    "OnUpdate",
    "RotateGyro",
    "LateUpdate",
    "GyroManager",
    "UpdateBaseRotation",
    "UpdateRotationLimit",
    "Gyroscope",
    "get_gyro",
    "rotationRateUnbiased",
    "get_rotationRateUnbiased",
    "get_deltaTime",
    "_useGyro",
    "ModelRenderStudio",
    "ApplyClampedRotation",
    "GetRotatedKeyPoints",
    "HomographyShapeCorrector",
    "CalcHomographyMatrix",
    "KeepParallaxCardBehaviour",
    "UpdateStudioRotation",
    "SetHomographyParameters",
    "backVector",
)

METADATA_TYPE_SELECTIONS = {
    "gyroManager": {
        "namespace": "Lettuce.Infrastructure.Asset3D.Core",
        "name": "GyroManager",
        "fields": (
            "s_Instance",
            "_active",
            "_axialMovementRestriction",
            "_radius",
            "_rotationPower",
            "_maxRotationAngle",
            "_angularVelocityThreshold",
            "_timeStep",
            "_waitingTime",
            "_rotation",
            "_timeCount",
            "_currentWaitingTime",
        ),
        "methods": (
            "get_Active",
            "set_Active",
            "OnDisable",
            "OnEnable",
            "Update",
            "UpdateBaseRotation",
            "UpdateRotationLimit",
            ".ctor",
        ),
    },
    "rotateGyro": {
        "namespace": "Lettuce.Infrastructure.Asset3D.Core",
        "name": "RotateGyro",
        "fields": (),
        "methods": ("LateUpdate",),
    },
    "asset3DRenderer": {
        "namespace": "Lettuce.Infrastructure.Asset3D.Core",
        "name": "Asset3DRenderer",
        "fields": ("_root", "_rotation", "_parent", "_useGyro", "_currentAsset"),
        "methods": ("get_Root", ".ctor", "SetupRenderObject", "CreateNode"),
    },
    "touchController": {
        "namespace": "Lettuce.Infrastructure.Asset3D.Core",
        "name": "ITouchStateMachineController",
        "fields": (),
        "methods": ("get_Root",),
    },
    "touchStateRotation": {
        "namespace": "Lettuce.Infrastructure.Asset3D.Core",
        "name": "TouchStateRotation",
        "fields": ("_maxRotationDegree", "_isFlipEnabled"),
        "methods": ("OnUpdate", "OnDrag"),
    },
    "uiCardView": {
        "namespace": "Lettuce.Infrastructure.Card.Core",
        "name": "UICardView",
        "fields": ("_useGyro",),
        "methods": ("CreateRenderer", "CreateTouchStateMachine"),
    },
    "cardRenderer": {
        "namespace": "Lettuce.Infrastructure.Card.Core",
        "name": "CardRenderer",
        "fields": (),
        "methods": (".ctor", "LoadAsset"),
    },
    "modelRenderStudio": {
        "namespace": "Lettuce.Infrastructure.Asset3D.Core.Rendering",
        "name": "ModelRenderStudio",
        "fields": ("_camera", "_root", "_keyPointsRoot", "_renderObject"),
        "methods": ("ApplyClampedRotation", "GetRotatedKeyPoints"),
    },
    "keepParallaxCardBehaviour": {
        "namespace": "Lettuce.Infrastructure.Card.Core",
        "name": "KeepParallaxCardBehaviour",
        "fields": (
            "_maxRotationDegree",
            "_faceGameObject",
            "_rotationUpdateTimeStamp",
            "_renderingCamera",
        ),
        "methods": ("UpdateStudioRotation", "SetHomographyParameters"),
    },
}


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def disassemble(elf, key: str):
    _, start, end = METHODS[key]
    decoder = BASIS.Cs(BASIS.CS_ARCH_ARM64, BASIS.CS_MODE_ARM)
    return list(decoder.disasm(elf.range(start, end), start))


def instruction_text(item) -> str:
    return f"{item.mnemonic} {item.op_str}".strip()


def instruction_evidence(item) -> dict:
    raw = bytes(item.bytes)
    return {
        "address": f"0x{item.address:x}",
        "text": instruction_text(item),
        "bytesHex": raw.hex(),
        "sha256": sha256(raw),
    }


def method_evidence(elf, key: str, instructions) -> dict:
    name, start, end = METHODS[key]
    body = elf.range(start, end)
    return {
        "name": name,
        "rvaStart": f"0x{start:x}",
        "rvaEnd": f"0x{end:x}",
        "byteSize": len(body),
        "sha256": sha256(body),
        "selectedInstructions": [
            instruction_evidence(item)
            for item in instructions
            if item.address in SIGNATURES.get(key, {})
        ],
    }


def byte_window(elf, start: int, end: int) -> dict:
    raw = elf.range(start, end)
    return {
        "rvaStart": f"0x{start:x}",
        "rvaEnd": f"0x{end:x}",
        "byteSize": len(raw),
        "bytesHex": raw.hex(),
        "sha256": sha256(raw),
    }


def decode_methods(elf) -> dict:
    decoded = {}
    for key in METHODS:
        instructions = disassemble(elf, key)
        by_address = {item.address: item for item in instructions}
        for address, expected in SIGNATURES.get(key, {}).items():
            actual = by_address.get(address)
            if actual is None:
                raise RuntimeError(f"{METHODS[key][0]} missing instruction 0x{address:x}")
            rendered = instruction_text(actual)
            if rendered != expected:
                raise RuntimeError(
                    f"{METHODS[key][0]} 0x{address:x}: expected {expected!r}, got {rendered!r}"
                )
        decoded[key] = {
            "instructions": instructions,
            "evidence": method_evidence(elf, key, instructions),
        }
    return decoded


def metadata_name_evidence(metadata: bytes) -> dict:
    magic, version = struct.unpack_from("<II", metadata)
    if magic != 0xFAB11BAF:
        raise RuntimeError("decrypted global metadata magic changed")
    string_offset, string_size = struct.unpack_from("<II", metadata, 24)
    heap = metadata[string_offset : string_offset + string_size]
    if len(heap) != string_size:
        raise RuntimeError("global metadata string heap is truncated")
    records = {}
    for name in METADATA_NAMES:
        needle = name.encode("utf-8") + b"\0"
        matches = []
        cursor = 0
        while True:
            index = heap.find(needle, cursor)
            if index < 0:
                break
            if index == 0 or heap[index - 1] == 0:
                matches.append(index)
            cursor = index + 1
        if len(matches) != 1:
            raise RuntimeError(f"metadata name {name!r} occurs {len(matches)} times")
        raw = needle[:-1]
        records[name] = {
            "fileOffset": string_offset + matches[0],
            "utf8BytesHex": raw.hex(),
            "utf8Sha256": sha256(raw),
        }
    return {
        "status": "proved",
        "version": version,
        "stringHeapFileOffset": string_offset,
        "stringHeapByteSize": string_size,
        "stringHeapSha256": sha256(heap),
        "names": records,
    }


def metadata_table(metadata: bytes, pair_index: int, record_size: int) -> dict:
    offset, size = struct.unpack_from("<II", metadata, 8 + pair_index * 8)
    if size % record_size:
        raise RuntimeError(
            f"metadata table {pair_index} size {size} is not aligned to {record_size}"
        )
    raw = metadata[offset : offset + size]
    if len(raw) != size:
        raise RuntimeError(f"metadata table {pair_index} is truncated")
    return {
        "offset": offset,
        "size": size,
        "recordSize": record_size,
        "count": size // record_size,
        "sha256": sha256(raw),
    }


def metadata_record(raw: bytes, file_offset: int) -> dict:
    return {
        "fileOffset": file_offset,
        "byteSize": len(raw),
        "bytesHex": raw.hex(),
        "sha256": sha256(raw),
    }


class MetadataDefinitions:
    def __init__(self, metadata: bytes):
        self.metadata = metadata
        magic, self.version = struct.unpack_from("<II", metadata)
        if magic != 0xFAB11BAF or self.version != 31:
            raise RuntimeError(
                f"expected IL2CPP metadata v31, got magic=0x{magic:08x} "
                f"version={self.version}"
            )
        self.string_offset, self.string_size = struct.unpack_from("<II", metadata, 24)
        self.tables = {
            "methods": metadata_table(
                metadata, METADATA_METHODS_PAIR, METHOD_DEFINITION_SIZE
            ),
            "fields": metadata_table(
                metadata, METADATA_FIELDS_PAIR, FIELD_DEFINITION_SIZE
            ),
            "types": metadata_table(metadata, METADATA_TYPES_PAIR, TYPE_DEFINITION_SIZE),
        }

    def string(self, index: int) -> str:
        start = self.string_offset + index
        limit = self.string_offset + self.string_size
        if start < self.string_offset or start >= limit:
            raise RuntimeError(f"metadata string index 0x{index:x} is out of range")
        end = self.metadata.find(b"\0", start, limit)
        if end < 0:
            raise RuntimeError(f"metadata string index 0x{index:x} is unterminated")
        return self.metadata[start:end].decode("utf-8")

    def _record(self, table: str, index: int) -> tuple[int, bytes]:
        spec = self.tables[table]
        if index < 0 or index >= spec["count"]:
            raise RuntimeError(f"metadata {table} index {index} is out of range")
        offset = spec["offset"] + index * spec["recordSize"]
        return offset, self.metadata[offset : offset + spec["recordSize"]]

    def field(self, index: int) -> dict:
        offset, raw = self._record("fields", index)
        name_index, type_index, token = struct.unpack("<III", raw)
        return {
            "name": self.string(name_index),
            "typeIndex": type_index,
            "token": f"0x{token:08x}",
            "record": metadata_record(raw, offset),
        }

    def method(self, index: int) -> dict:
        offset, raw = self._record("methods", index)
        name_index = struct.unpack_from("<I", raw)[0]
        token = struct.unpack_from("<I", raw, 24)[0]
        parameter_count = struct.unpack_from("<H", raw, 34)[0]
        return {
            "name": self.string(name_index),
            "token": f"0x{token:08x}",
            "parameterCount": parameter_count,
            "record": metadata_record(raw, offset),
        }

    def type(self, namespace: str, name: str, fields, methods) -> dict:
        matches = []
        for index in range(self.tables["types"]["count"]):
            offset, raw = self._record("types", index)
            name_index, namespace_index = struct.unpack_from("<II", raw)
            if self.string(name_index) == name and self.string(namespace_index) == namespace:
                matches.append((index, offset, raw))
        if len(matches) != 1:
            raise RuntimeError(f"metadata type {namespace}.{name} occurs {len(matches)} times")

        index, offset, raw = matches[0]
        values = struct.unpack_from("<16I", raw)
        counts = struct.unpack_from("<8H", raw, 64)
        field_start, method_start = values[8], values[9]
        all_fields = [self.field(field_start + item) for item in range(counts[2])]
        all_methods = [self.method(method_start + item) for item in range(counts[0])]

        def select(rows: list[dict], requested, kind: str) -> dict:
            selected = {}
            for requested_name in requested:
                found = [row for row in rows if row["name"] == requested_name]
                if len(found) != 1:
                    raise RuntimeError(
                        f"metadata {namespace}.{name} {kind} {requested_name!r} "
                        f"occurs {len(found)} times"
                    )
                selected[requested_name] = found[0]
            return selected

        bitfield, token = struct.unpack_from("<II", raw, 80)
        return {
            "namespace": namespace,
            "name": name,
            "typeDefinitionIndex": index,
            "token": f"0x{token:08x}",
            "bitfield": f"0x{bitfield:08x}",
            "fieldCount": counts[2],
            "methodCount": counts[0],
            "fieldNames": [row["name"] for row in all_fields],
            "methodNames": [row["name"] for row in all_methods],
            "record": metadata_record(raw, offset),
            "selectedFields": select(all_fields, fields, "field"),
            "selectedMethods": select(all_methods, methods, "method"),
        }


def metadata_definition_evidence(metadata: bytes) -> dict:
    definitions = MetadataDefinitions(metadata)
    return {
        "status": "proved",
        "version": definitions.version,
        "tables": definitions.tables,
        "types": {
            key: definitions.type(
                selection["namespace"],
                selection["name"],
                selection["fields"],
                selection["methods"],
            )
            for key, selection in METADATA_TYPE_SELECTIONS.items()
        },
    }


def extract_serialized_card_view(bundle_path: Path) -> dict:
    bundle = bundle_path.read_bytes()
    BASIS.UnityPy.config.FALLBACK_UNITY_VERSION = UNITY_VERSION
    environment = BASIS.UnityPy.load(bundle)
    if CARD_VIEW_CONTAINER not in environment.container:
        raise RuntimeError(
            f"card-view bundle does not contain {CARD_VIEW_CONTAINER!r}"
        )
    objects = {int(obj.path_id): obj for obj in environment.objects}
    component = objects.get(CARD_VIEW_COMPONENT_PATH_ID)
    if component is None or component.type.name != "MonoBehaviour":
        raise RuntimeError("pinned ordinary card-view MonoBehaviour is missing")
    tree = component.read_typetree()
    game_object_pointer = int((tree.get("m_GameObject") or {}).get("m_PathID", 0))
    if game_object_pointer != CARD_VIEW_GAME_OBJECT_PATH_ID:
        raise RuntimeError("ordinary card-view component GameObject pointer changed")
    game_object = objects.get(game_object_pointer)
    if game_object is None or game_object.type.name != "GameObject":
        raise RuntimeError("ordinary card-view component GameObject is missing")
    game_object_tree = game_object.read_typetree()
    if game_object_tree.get("m_Name") != "card_img":
        raise RuntimeError("pinned ordinary card-view GameObject is no longer card_img")
    if tree.get("_cardSize") != 6:
        raise RuntimeError("pinned ordinary card-view _cardSize is no longer 6")
    if tree.get("_useGyro") not in (0, False):
        raise RuntimeError("pinned ordinary card-view _useGyro is no longer false")

    raw = bytes(component.get_raw_data())
    field_raw = raw[
        CARD_VIEW_USE_GYRO_RAW_OFFSET : CARD_VIEW_USE_GYRO_RAW_OFFSET + 4
    ]
    if field_raw != b"\0\0\0\0":
        raise RuntimeError("pinned ordinary card-view _useGyro raw bytes changed")
    script = tree.get("m_Script") or {}
    return {
        "status": "proved",
        "scope": "one precisely pinned ordinary CommonUICardDetailCard object; not a corpus-wide prefab count",
        "bundlePath": str(bundle_path.resolve()),
        "bundleByteSize": len(bundle),
        "bundleSha256": sha256(bundle),
        "unityVersionFallback": UNITY_VERSION,
        "container": CARD_VIEW_CONTAINER,
        "componentPathId": str(CARD_VIEW_COMPONENT_PATH_ID),
        "componentRawByteSize": len(raw),
        "componentRawSha256": sha256(raw),
        "gameObjectPathId": str(game_object_pointer),
        "gameObjectName": game_object_tree["m_Name"],
        "cardSize": int(tree["_cardSize"]),
        "script": {
            "fileId": int(script.get("m_FileID", 0)),
            "pathId": str(int(script.get("m_PathID", 0))),
        },
        "field": {
            "name": "_useGyro",
            "value": False,
            "rawByteOffset": CARD_VIEW_USE_GYRO_RAW_OFFSET,
            "rawByteSize": len(field_raw),
            "bytesHex": field_raw.hex(),
            "sha256": sha256(field_raw),
        },
    }


def decode_waiting_time(instructions) -> dict:
    by_address = {item.address: item for item in instructions}
    low = instruction_text(by_address[0x438E0D4])
    high = instruction_text(by_address[0x438E0DC])
    low_match = re.fullmatch(r"mov w8, #(0x[0-9a-f]+|[0-9]+)", low)
    high_match = re.fullmatch(
        r"movk w8, #(0x[0-9a-f]+|[0-9]+), lsl #16", high
    )
    if low_match is None or high_match is None:
        raise RuntimeError("GyroManager waiting-time MOV/MOVK encoding changed")
    bits = int(low_match.group(1), 0) | (int(high_match.group(1), 0) << 16)
    raw = struct.pack("<I", bits)
    return {
        "bitsHex": f"0x{bits:08x}",
        "value": struct.unpack("<f", raw)[0],
        "valueBytesHex": raw.hex(),
        "valueSha256": sha256(raw),
        "instructions": [
            instruction_evidence(by_address[0x438E0D4]),
            instruction_evidence(by_address[0x438E0DC]),
        ],
    }


def vec(tree: dict, field: str, components: tuple[str, ...]) -> list[float]:
    value = tree.get(field) or {}
    return [float(value.get(component, 0.0)) for component in components]


def extract_serialized_studio(apk: zipfile.ZipFile, globalgamemanagers: bytes) -> dict:
    base = BASIS.extract_asset3d_card_camera(apk, globalgamemanagers)
    resource = apk.read(base["resourcePath"])
    environment = BASIS.UnityPy.load(resource)
    objects = {int(obj.path_id): obj for obj in environment.objects}
    camera_path_id = int(base["camera"]["pathId"])
    camera = objects[camera_path_id]
    camera_tree = camera.read_typetree()
    transform_path_id = int(base["camera"]["transformPathId"])
    transform_tree = objects[transform_path_id].read_typetree()

    hierarchy = []
    game_objects = {
        int(obj.path_id): obj.read_typetree()
        for obj in environment.objects
        if obj.type.name == "GameObject"
    }
    for obj in environment.objects:
        if obj.type.name != "Transform":
            continue
        tree = obj.read_typetree()
        game_object_id = int((tree.get("m_GameObject") or {}).get("m_PathID", 0))
        name = (game_objects.get(game_object_id) or {}).get("m_Name")
        if name in {
            "ModelRenderStudio", "Camera", "Root", "KeyPoints",
            "LeftDown", "RightDown", "LeftUp", "RightUp",
        }:
            hierarchy.append(
                {
                    "gameObject": name,
                    "transformPathId": str(obj.path_id),
                    "parentTransformPathId": str(
                        int((tree.get("m_Father") or {}).get("m_PathID", 0))
                    ),
                    "localPosition": vec(tree, "m_LocalPosition", ("x", "y", "z")),
                    "localRotation": vec(
                        tree, "m_LocalRotation", ("x", "y", "z", "w")
                    ),
                }
            )
    hierarchy.sort(key=lambda row: row["gameObject"])

    return {
        "status": "proved",
        "resourcePath": base["resourcePath"],
        "resourceByteSize": len(resource),
        "resourceSha256": sha256(resource),
        "hierarchy": hierarchy,
        "camera": {
            "gameObject": base["camera"]["gameObject"],
            "pathId": base["camera"]["pathId"],
            "transformPathId": base["camera"]["transformPathId"],
            "localPosition": vec(
                transform_tree, "m_LocalPosition", ("x", "y", "z")
            ),
            "localRotation": vec(
                transform_tree, "m_LocalRotation", ("x", "y", "z", "w")
            ),
            "fieldOfView": float(camera_tree["field of view"]),
            "orthographic": bool(camera_tree["orthographic"]),
            "cullingMask": int((camera_tree.get("m_CullingMask") or {})["m_Bits"]),
            "rawSha256": sha256(bytes(camera.get_raw_data())),
        },
        "layer": base["layerSemantics"],
    }


def constant(elf, rva: int, fmt: str) -> dict:
    size = struct.calcsize(fmt)
    raw = elf.range(rva, rva + size)
    values = list(struct.unpack(fmt, raw))
    return {
        "rva": f"0x{rva:x}",
        "bytesHex": raw.hex(),
        "sha256": sha256(raw),
        "values": values,
    }


def close(actual: float, expected: float, label: str, tolerance: float = 1e-6):
    if not math.isclose(actual, expected, rel_tol=0.0, abs_tol=tolerance):
        raise RuntimeError(f"{label}: expected {expected}, got {actual}")


def extract(apkm_path: Path, card_view_bundle_path: Path) -> dict:
    apkm = apkm_path.read_bytes()
    with zipfile.ZipFile(io.BytesIO(apkm)) as outer:
        base_apk = outer.read("base.apk")
        arm64_apk = outer.read("split_config.arm64_v8a.apk")
    with zipfile.ZipFile(io.BytesIO(arm64_apk)) as split:
        libil2cpp = split.read(BASIS.IL2CPP_PATH)
    with zipfile.ZipFile(io.BytesIO(base_apk)) as apk:
        encrypted_metadata = apk.read(BASIS.METADATA_PATH)
        globalgamemanagers = apk.read(BASIS.GGM_PATH)
        serialized = extract_serialized_studio(apk, globalgamemanagers)

    elf = BASIS.Elf64(libil2cpp)
    metadata, metadata_source = BASIS.decrypt_global_metadata(encrypted_metadata, elf)
    metadata_names = metadata_name_evidence(metadata)
    metadata_names["definitions"] = metadata_definition_evidence(metadata)
    decoded = decode_methods(elf)
    ordinary_card_view = extract_serialized_card_view(card_view_bundle_path)

    gyro_rotation_and_max = constant(elf, 0x1AF6EE0, "<ffff")
    gyro_threshold_and_step = constant(elf, 0x1AF7A38, "<ff")
    degrees_to_radians = constant(elf, 0x1AF8EB8, "<f")
    negative_degrees_to_radians = constant(elf, 0x1AF8E64, "<f")
    radians_to_degrees = constant(elf, 0x1AF90F4, "<f")
    waiting_time = decode_waiting_time(decoded["gyroCtor"]["instructions"])

    for actual, expected, label in zip(
        gyro_rotation_and_max["values"],
        (0.35, 30.0, 30.0, 0.0),
        ("RotationPower", "MaxRotation.x", "MaxRotation.y", "MaxRotation.z"),
    ):
        close(actual, expected, label)
    close(gyro_threshold_and_step["values"][0], 0.5, "AngularVelocityThreshold")
    close(gyro_threshold_and_step["values"][1], 0.0005, "TimeStep")
    close(waiting_time["value"], 0.3, "WaitingTime")
    close(degrees_to_radians["values"][0], math.pi / 180.0, "Deg2Rad")
    close(
        negative_degrees_to_radians["values"][0],
        -math.pi / 180.0,
        "negative Deg2Rad",
    )
    close(radians_to_degrees["values"][0], 180.0 / math.pi, "Rad2Deg")

    parent_angle = constant(elf, 0x1AF7C78, "<ff")
    distance = constant(elf, 0x1AF9048, "<f")
    close(parent_angle["values"][0], 0.0, "ParentNodeAngle.x")
    close(parent_angle["values"][1], 180.0, "ParentNodeAngle.y")
    close(distance["values"][0], 1.911506, "CameraDistance")
    close(serialized["camera"]["fieldOfView"], 35.0, "serialized Camera FOV")
    expected_position = [0.0, 0.0, -distance["values"][0]]
    for index, axis in enumerate("xyz"):
        close(
            serialized["camera"]["localPosition"][index],
            expected_position[index],
            f"serialized Camera localPosition.{axis}",
        )
    if serialized["layer"]["layerIndex"] != 21:
        raise RuntimeError("UICardViewRenderer layer is no longer layer 21")
    if serialized["camera"]["cullingMask"] != 1 << 21:
        raise RuntimeError("ModelRenderStudio camera no longer selects only layer 21")

    literals = BASIS.MetadataLiterals(metadata)
    relocations = elf.relocations()
    homography_properties = {
        "matrix": BASIS.literal_slot_evidence(relocations, literals, 0x6C4A7D0),
        "inverse": BASIS.literal_slot_evidence(relocations, literals, 0x6C4A7D8),
    }

    methods = {key: value["evidence"] for key, value in decoded.items()}
    gyro_windows = {
        key: byte_window(elf, start, end)
        for key, (start, end) in BYTE_WINDOWS.items()
    }
    return {
        "schemaVersion": 2,
        "status": "partial",
        "source": {
            "apkm": str(apkm_path.resolve()),
            "apkmSha256": sha256(apkm),
            "baseApkSha256": sha256(base_apk),
            "arm64SplitSha256": sha256(arm64_apk),
            "libil2cppPath": BASIS.IL2CPP_PATH,
            "libil2cppSha256": sha256(libil2cpp),
            "metadata": metadata_source,
            "ordinaryCardViewBundle": {
                "path": ordinary_card_view["bundlePath"],
                "byteSize": ordinary_card_view["bundleByteSize"],
                "sha256": ordinary_card_view["bundleSha256"],
            },
        },
        "globalMetadata": metadata_names,
        "official": {
            "nativeMethods": methods,
            "camera": {
                "status": "proved",
                "updateCameraSettings": methods["updateCamera"],
                "distance": distance,
                "axis": "Vector3.back / camera local -Z",
                "fieldOfViewDegrees": 35.0,
                "localPosition": expected_position,
                "serializedPrefab": serialized,
            },
            "parentFace": {
                "status": "proved",
                "normalFaceCall": methods["cardLoad"],
                "setFlipped": methods["setFlipped"],
                "constructor": methods["assetCtor"],
                "createNode": methods["createNode"],
                "parentNodeAngleConstant": parent_angle,
                "setFlippedArgument": False,
                "parentLocalEulerDegrees": [0.0, 180.0, 0.0],
                "hierarchy": [
                    "ModelRenderStudio.Root",
                    "Asset3DRenderer.root",
                    "Asset3DRenderer.rotation",
                    "Asset3DRenderer.parent",
                    "loaded card asset",
                ],
            },
            "layer": {
                "status": "proved",
                "name": serialized["layer"]["layerName"],
                "index": serialized["layer"]["layerIndex"],
                "bit": serialized["layer"]["layerBit"],
                "cameraCullingMask": serialized["camera"]["cullingMask"],
            },
            "touch": {
                "status": "proved",
                "cardTouchFactory": methods["uiCardTouch"],
                "onDrag": methods["touchOnDrag"],
                "onUpdate": methods["touchOnUpdate"],
                "maxRotationDegrees": 30.0,
                "composition": "qY * qX",
                "nativeAxes": "Quaternion.AngleAxis(yaw, Vector3.up) * Quaternion.AngleAxis(pitch, Vector3.left)",
                "applicationOrder": "current localRotation * drag delta",
                "roll": "Euler z is reset to zero before clamping",
                "clamp": "quaternion angle from identity, SlerpUnclamped(identity, q, min(30/angle, 1))",
                "target": "ITouchStateMachineController.Root / Asset3DRenderer.root",
                "targetInterfaceMethod": "ITouchStateMachineController.get_Root",
                "multiplyBlock": {
                    "rvaStart": "0x439187c",
                    "rvaEnd": "0x439191c",
                    "bytesHex": elf.range(0x439187C, 0x439191C).hex(),
                    "sha256": sha256(elf.range(0x439187C, 0x439191C)),
                },
            },
            "gyro": {
                "status": "proved",
                "methods": {
                    "getActive": methods["gyroGetActive"],
                    "setActive": methods["gyroSetActive"],
                    "onDisable": methods["gyroOnDisable"],
                    "onEnable": methods["gyroOnEnable"],
                    "update": methods["gyroUpdate"],
                    "updateBaseRotation": methods["gyroUpdateBaseRotation"],
                    "updateRotationLimit": methods["gyroUpdateRotationLimit"],
                    "constructor": methods["gyroCtor"],
                    "lateUpdate": methods["rotateGyro"],
                    "uiCardCreateRenderer": methods["uiCardCreateRenderer"],
                    "cardRendererConstructor": methods["cardRendererCtor"],
                    "asset3DRendererConstructor": methods["assetCtor"],
                    "setupRenderObject": methods["setupRenderObject"],
                },
                "fieldLayout": {
                    "active": "0x20",
                    "axialMovementRestriction": "0x21",
                    "radius": "0x24",
                    "rotationPower": "0x28",
                    "maxRotationAngle": "0x2c",
                    "angularVelocityThreshold": "0x38",
                    "timeStep": "0x3c",
                    "waitingTime": "0x40",
                    "rotation": "0x44",
                    "timeCount": "0x54",
                    "currentWaitingTime": "0x58",
                },
                "defaults": {
                    "active": False,
                    "axialMovementRestriction": False,
                    "radius": 0.0,
                    "rotationPower": gyro_rotation_and_max["values"][0],
                    "maxRotationAngleDegrees": gyro_rotation_and_max["values"][1:4],
                    "angularVelocityThreshold": gyro_threshold_and_step["values"][0],
                    "timeStep": gyro_threshold_and_step["values"][1],
                    "waitingTime": waiting_time["value"],
                    "rotation": [0.0, 0.0, 0.0, 1.0],
                    "timeCount": 0.0,
                    "currentWaitingTime": 0.0,
                    "zeroDefaultsEvidence": "managed instance storage is zero-initialized; the pinned constructor writes only the non-zero fields and Quaternion.identity",
                    "constructorConstants": {
                        "rotationPowerAndMax": gyro_rotation_and_max,
                        "thresholdAndTimeStep": gyro_threshold_and_step,
                        "waitingTime": waiting_time,
                    },
                },
                "input": {
                    "gate": [
                        "Input.gyro is non-null",
                        "Input.gyro.enabled is true",
                        "GyroManager.Active is true",
                    ],
                    "sample": "Input.gyro.rotationRateUnbiased",
                    "sampleCallRva": "0x438dcd8",
                    "sampleCallTargetRva": "0x656bc04",
                    "axesUsed": ["x", "y"],
                    "zIgnored": True,
                },
                "stateMachine": {
                    "updateOrder": [
                        "sample rotationRateUnbiased",
                        "UpdateBaseRotation(x, y)",
                        "build dq from -x/-y and rotationPower",
                        "compose dq * q",
                        "UpdateRotationLimit",
                    ],
                    "deltaQuaternion": "Quaternion.Euler(-x * rotationPower, -y * rotationPower, 0)",
                    "composition": "dq * q",
                    "integrationClock": "one sample/integration per GyroManager.Update; no deltaTime multiplier",
                    "inactiveResult": "Quaternion.identity",
                    "stationaryReturn": {
                        "stationaryCondition": "abs(x) < threshold && abs(y) < threshold",
                        "movingAction": "timeCount = 0; currentWaitingTime = 0",
                        "waitingAccumulator": "currentWaitingTime += Time.deltaTime",
                        "waitingClock": "scaled Time.deltaTime",
                        "startCondition": "currentWaitingTime > waitingTime",
                        "step": "timeCount = clamp01(timeCount + timeStep)",
                        "stepClock": "once per eligible Update; no deltaTime multiplier",
                        "rotation": "Quaternion.Lerp(current, identity, timeCount)",
                    },
                    "rotationLimit": {
                        "space": "signed Euler degrees",
                        "wrap": "x/y values above 180 subtract 360",
                        "axialRestriction": "when enabled and dominant abs axis exceeds radius, zero the weaker axis",
                        "clamp": "x to +/-max.x; y to +/-max.y",
                        "rollDegrees": 0.0,
                        "maxZStoredButUnused": True,
                    },
                },
                "lateUpdateOutput": {
                    "source": "GyroManager.Rotation",
                    "target": "RotateGyro component transform.localRotation",
                    "eulerMapping": ["-X", "+Y", "0"],
                    "xSign": "reversed",
                    "ySign": "preserved",
                    "rollDegrees": 0.0,
                    "negativeDegreesToRadians": negative_degrees_to_radians,
                    "degreesToRadians": degrees_to_radians,
                    "radiansToDegrees": radians_to_degrees,
                },
                "placement": {
                    "useGyroPath": [
                        {
                            "stage": "UICardView.CreateRenderer reads serialized _useGyro byte at instance +0x15c",
                            "rva": "0x443d920",
                        },
                        {
                            "stage": "CardRenderer constructor passes the byte to Asset3DRenderer constructor",
                            "rva": "0x443da18",
                        },
                        {
                            "stage": "SetupRenderObject gates on Asset3DRenderer._useGyro at +0x70",
                            "rva": "0x43964e0",
                        },
                        {
                            "stage": "SetupRenderObject AddComponent<RotateGyro> on the loaded asset",
                            "rva": "0x439653c",
                        },
                    ],
                    "touchTarget": "Asset3DRenderer.root",
                    "gyroTarget": "loaded card asset",
                    "hierarchy": [
                        "Asset3DRenderer.root (touch rotation)",
                        "Asset3DRenderer.rotation",
                        "Asset3DRenderer.parent",
                        "loaded card asset (RotateGyro local rotation)",
                    ],
                    "sameFrameCompositionOrder": "unproved",
                },
                "ordinaryDetailView": ordinary_card_view,
                "policy": {
                    "ordinaryCardGyroDefault": "disabled",
                    "rule": "do not enable gyro for an ordinary card view without independently pinned serialized _useGyro=true evidence",
                    "pinnedDetailViewGate": False,
                },
                "pauseAndTimeScale": {
                    "onDisable": "Input.gyro.enabled = false",
                    "onEnable": "Input.gyro.enabled = true",
                    "onApplicationPauseMethodPresent": False,
                    "integrationClock": "per Update, not scaled by deltaTime",
                    "stationaryWaitClock": "scaled Time.deltaTime",
                    "returnStepClock": "per eligible Update, not scaled by deltaTime",
                    "scope": "code-level clocks and OnEnable/OnDisable calls only; Unity lifecycle dispatch is outside this proof",
                },
                "byteWindows": gyro_windows,
                "unproved": [
                    {
                        "id": "active-enable-origin",
                        "status": "unproved",
                        "claim": "which production call path sets GyroManager.Active=true",
                    },
                    {
                        "id": "unity-android-sensor-backend",
                        "status": "unproved",
                        "claim": "Unity Android sensor backend calibration, sampling, and pause behavior below Input.gyro",
                    },
                    {
                        "id": "same-frame-touch-gyro-order",
                        "status": "unproved",
                        "claim": "same-frame scheduling order between touch state updates and RotateGyro.LateUpdate",
                    },
                ],
            },
            "homography": {
                "status": "partial",
                "calcHomographyMatrix": methods["calcHomography"],
                "getRotatedKeyPoints": methods["getRotatedKeyPoints"],
                "applyClampedRotation": methods["applyClampedRotation"],
                "updateStudioRotation": methods["updateStudioRotation"],
                "setHomographyParameters": methods["setHomography"],
                "keepParallaxTransform": {
                    "status": "proved",
                    "frameGate": "one update per Time.frameCount value",
                    "sourceTransform": "KeepParallaxCardBehaviour.transform",
                    "cameraTransform": "KeepParallaxCardBehaviour._renderingCamera.transform",
                    "maxRotationField": "KeepParallaxCardBehaviour._maxRotationDegree at +0x20",
                    "application": "ModelRenderStudio.ApplyClampedRotation writes one _renderObject.transform.localRotation",
                    "homographyKeypointSource": "ModelRenderStudio serialized _keyPoint* transforms under KeyPoints/Root",
                    "homographyKeypointDependency": "GetRotatedKeyPoints reads _keyPoint* world positions and _camera only; it does not read _renderObject.localRotation",
                    "rotationRule": "camera-relative target rotation with the studio back-facing offset; Euler z is cleared before quaternion-angle clamp",
                    "order": [
                        "ApplyClampedRotation",
                        "SetHomographyParameters",
                    ],
                    "fieldOffsets": {
                        "initialized": "0x38",
                        "faceGameObject": "0x28",
                        "rotationUpdateTimeStamp": "0x4c",
                        "renderingCamera": "0x50",
                        "cardRendererOnModelCardView": "0x38",
                        "renderStudioOnAsset3DRenderer": "0x48",
                        "renderObjectOnModelRenderStudio": "0x60",
                    },
                    "byteWindow": gyro_windows["keepParallaxRotationChain"],
                },
                "properties": homography_properties,
                "proved": "four camera-projected key points feed a 9-float homography; its inverse is uploaded with _HomographyMatrix and _InvHomographyMatrix",
                "unproved": "coefficient-by-coefficient equivalence with the browser runtime is not established",
            },
        },
        "remaining": [
            "browser homography coefficient equivalence is partial",
            "GyroManager.Active=true production origin is not identified",
            "Unity Android sensor backend internals are not decoded",
            "touch/gyro same-frame scheduling order is not established",
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
        "--card-view-bundle",
        type=Path,
        default=Path(
            os.environ.get("PCR_CARD_VIEW_BUNDLE", DEFAULT_CARD_VIEW_BUNDLE)
        ),
        help="official decrypted CommonUICardDetailCard prefab bundle",
    )
    parser.add_argument("--pretty", action="store_true")
    args = parser.parse_args()
    if not args.apkm.is_file():
        parser.error(f"APKM not found: {args.apkm}")
    if not args.card_view_bundle.is_file():
        parser.error(f"card-view bundle not found: {args.card_view_bundle}")
    json.dump(
        extract(args.apkm.resolve(), args.card_view_bundle.resolve()),
        sys.stdout,
        ensure_ascii=True,
        indent=2 if args.pretty else None,
    )
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
