#!/usr/bin/env python3
"""Extract byte-level evidence for the official 1.6.0 card render target.

The report is intentionally rebuilt from the APKM's arm64 code and Unity
serialized objects.  Method RVAs and object PathIDs are locators, not claimed
results: values in the report are decoded from the located bytes on every run.
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
import subprocess
import sys
import tempfile
import warnings
import zipfile

from capstone import Cs, CS_ARCH_ARM64, CS_MODE_ARM
import UnityPy


sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
DEFAULT_APKM = (
    ROOT.parent / "ptcg-apk-parser" / "apks" / "jp.pokemon.pokemontcgp_1.6.0.apkm"
)
DEFAULT_DECRYPTED_ROOT = Path(
    "D:/DevProjectes/ptcgp-tools-master/masterdata_decoder/.output/decrypted"
)
DETAIL_BUNDLE = Path("Common/UI/Prefabs/Common/CommonUICardDetailCard.prefab_bundles")
DETAIL_PATH_ID = -2600777029953942905
GGM_PATH = "assets/bin/Data/globalgamemanagers"
SOC_PATH = "assets/bin/Data/cca6051d5abe6684888ffeaf7d00ddf9"
IL2CPP_PATH = "lib/arm64-v8a/libil2cpp.so"

UnityPy.config.FALLBACK_UNITY_VERSION = "2022.3.62f2"
warnings.filterwarnings("ignore", category=Warning, module=r"UnityPy\..*")


def load_module(name: str, source: Path):
    spec = importlib.util.spec_from_file_location(name, source)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load extraction helper: {source}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


BASIS = load_module(
    "pcr_card_renderer_basis", ROOT / "build" / "extract_official_pass_partition.py"
)
HOMOGRAPHY = load_module(
    "pcr_card_renderer_homography",
    ROOT / "build" / "extract_official_homography_program.py",
)


METHODS = {
    "pixelSize": ("CardDimension.PixelSize", 0x438D7FC, 0x438D8D0),
    "cardDimensionCctor": ("CardDimension..cctor", 0x438D8D0, 0x438DA6C),
    "uiCardViewCreateRenderer": ("UICardView.CreateRenderer", 0x443D880, 0x443D96C),
    "cardRendererCtor": ("CardRenderer..ctor", 0x443D96C, 0x443DA4C),
    "cardRendererCreateRenderTexture": (
        "CardRenderer.CreateRenderTexture",
        0x4444410,
        0x4444794,
    ),
    "cardRendererCctor": ("CardRenderer..cctor", 0x4444CD4, 0x4444D60),
    "asset3DCreateRenderTexture": (
        "Asset3DRenderer.CreateRenderTexture",
        0x4396050,
        0x439612C,
    ),
    "toCardSize": ("UICardViewSizeTypeExtensions.ToCardSize", 0x4451828, 0x445184C),
    "qualitySetup": ("QualitySettings.Setup", 0x469766C, 0x46978D4),
    "qualitySet": ("QualitySettings.SetQuality", 0x46978D4, 0x4697A84),
    "frameRateSet": ("QualitySettings.SetFrameRate", 0x4697A84, 0x4697B2C),
    "renderOneShot": ("ModelRenderStudio.RenderOneShot", 0x4398F24, 0x4399008),
}


SIGNATURES = {
    "pixelSize": {
        0x438D854: "ldr x20, [x8, #0x28]",
        0x438D8BC: "mov w1, w19",
        0x438D8C8: "br x3",
    },
    "cardDimensionCctor": {
        0x438D940: "mov x9, #0x2de",
        0x438D944: "movk x9, #0x400, lsl #32",
        0x438D948: "mov x11, #0x113",
        0x438D94C: "movk x11, #0x180, lsl #32",
        0x438D954: "str x9, [x8]",
        0x438D958: "mov x9, #0x16f",
        0x438D960: "movk x9, #0x200, lsl #32",
        0x438D96C: "str x9, [x10, #8]",
        0x438D970: "adrp x9, #0x1af7000",
        0x438D978: "ldr d0, [x9, #0x3a0]",
        0x438D97C: "str x11, [x10, #0x10]",
        0x438D984: "str d0, [x9, #0x18]",
        0x438D9BC: "mov w9, #1",
        0x438D9D8: "ldr x8, [x8, #0x10]",
        0x438D9EC: "mov w9, #2",
        0x438DA08: "ldr x8, [x8, #8]",
        0x438DA18: "mov w9, #3",
        0x438DA34: "ldr x8, [x8]",
    },
    "uiCardViewCreateRenderer": {
        0x443D900: "ldr w22, [x19, #0x158]",
        0x443D90C: "mov w0, w22",
        0x443D914: "bl #0x4451828",
        0x443D918: "mov w22, w0",
        0x443D92C: "mov w1, w22",
        0x443D940: "bl #0x443d96c",
    },
    "cardRendererCtor": {
        0x443D9E8: "ldr s0, [x8]",
        0x443D9F0: "str s0, [x21, #0x94]",
        0x443DA10: "ldr s0, [x8, #0x20]",
        0x443DA14: "str s0, [x21, #0x98]",
        0x443DA48: "b #0x4444410",
    },
    "toCardSize": {
        0x4451828: "sub w8, w0, #1",
        0x445182C: "cmp w8, #5",
        0x4451834: "adrp x9, #0x1c49000",
        0x4451838: "add x9, x9, #0x2f0",
        0x445183C: "ldr w0, [x9, w8, sxtw #2]",
        0x4451844: "mov w0, #3",
    },
    "cardRendererCctor": {
        0x4444D30: "fmov s1, #0.50000000",
        0x4444D34: "ldr s0, [x8, #0x1c]",
        0x4444D38: "adrp x8, #0x1af8000",
        0x4444D3C: "fmul s0, s0, s1",
        0x4444D40: "ldr s1, [x8, #0xf8c]",
        0x4444D4C: "fdiv s0, s0, s1",
        0x4444D54: "str s0, [x8]",
    },
    "cardRendererCreateRenderTexture": {
        0x444450C: "mov w0, w22",
        0x4444514: "bl #0x438d7fc",
        0x444458C: "lsr x22, x22, #0x20",
        0x44445E8: "scvtf s1, w22",
        0x44445F4: "fdiv s9, s1, s8",
        0x4444618: "fmul s9, s9, s8",
        0x4444630: "fcvt d8, s9",
        0x4444644: "bl #0x67beca0",
        0x4444668: "fmov d1, #0.50000000",
        0x444467C: "fcvtzs x8, d0",
        0x4444684: "tst x8, #1",
        0x4444688: "fcsel d0, d0, d1, eq",
        0x44446C8: "csel w1, w9, w8, eq",
        0x44446CC: "mov w2, w1",
        0x44446D0: "bl #0x4396050",
    },
    "asset3DCreateRenderTexture": {
        0x43960A0: "mov w1, w23",
        0x43960A4: "mov w2, w22",
        0x43960A8: "mov w3, #0x18",
        0x43960AC: "mov w4, wzr",
        0x43960B8: "bl #0x650de04",
        0x43960F0: "bl #0x650c2dc",
        0x4396100: "bl #0x650c63c",
        0x439610C: "bl #0x650cacc",
    },
    "qualitySetup": {
        0x469771C: "bl #0x65289dc",
        0x46977AC: "ldr x21, [x21, #0x18]",
        0x46977E8: "bl #0x32159ec",
        0x46977F0: "ands w20, w0, #1",
        0x46977F4: "mov w23, #1",
        0x46977F8: "cinc w21, w23, ne",
        0x4697824: "strb w20, [x8]",
        0x4697830: "mov w1, w21",
        0x4697834: "mov w2, w20",
        0x469783C: "bl #0x47446ac",
        0x4697854: "bl #0x473e144",
        0x4697870: "bl #0x473e144",
        0x469787C: "bl #0x46978d4",
        0x4697884: "bl #0x4697a84",
        0x4697898: "bl #0x473e128",
        0x46978AC: "bl #0x473e128",
        0x46978C4: "b #0x473e500",
    },
    "qualitySet": {
        0x4697934: "cmp w19, #2",
        0x469794C: "cmp w19, #1",
        0x4697954: "cbnz w19, #0x4697a50",
        0x4697984: "fmov s9, #1.00000000",
        0x46979A4: "bl #0x444900c",
        0x46979F4: "adrp x8, #0x1af8000",
        0x46979FC: "ldr s9, [x8, #0xec0]",
        0x4697A3C: "adrp x8, #0x1af8000",
        0x4697A44: "ldr s9, [x8, #0xe54]",
    },
    "frameRateSet": {
        0x4697AB0: "cmp w19, #1",
        0x4697AB8: "cbnz w19, #0x4697af8",
        0x4697AC0: "mov w19, #0x3c",
        0x4697ACC: "mov w19, #0x1e",
        0x4697AF4: "b #0x64d8588",
    },
    "renderOneShot": {
        0x4398F74: "bl #0x64dcfec",
        0x4398FCC: "bl #0x64df244",
        0x4398FE0: "bl #0x64dcfec",
    },
}


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def raw_record(data: bytes) -> dict:
    return {"byteSize": len(data), "sha256": sha256(data), "rawHex": data.hex()}


def instruction_map(elf, start: int, end: int) -> dict[int, object]:
    decoder = Cs(CS_ARCH_ARM64, CS_MODE_ARM)
    return {item.address: item for item in decoder.disasm(elf.range(start, end), start)}


def method_record(elf, key: str) -> dict:
    name, start, end = METHODS[key]
    body = elf.range(start, end)
    instructions = instruction_map(elf, start, end)
    selected = []
    for address, expected in SIGNATURES.get(key, {}).items():
        item = instructions.get(address)
        if item is None:
            raise RuntimeError(f"{name}: no instruction at 0x{address:x}")
        text = f"{item.mnemonic} {item.op_str}".strip()
        if text != expected:
            raise RuntimeError(
                f"{name} 0x{address:x}: expected {expected!r}, decoded {text!r}"
            )
        selected.append(
            {
                "address": f"0x{address:x}",
                "text": text,
                "bytesHex": item.bytes.hex(),
                "sha256": sha256(item.bytes),
            }
        )
    targets = sorted(
        {
            int(item.op_str[1:], 16)
            for item in instructions.values()
            if item.mnemonic in {"b", "bl"} and re.fullmatch(r"#0x[0-9a-f]+", item.op_str)
        }
    )
    return {
        "name": name,
        "rvaStart": f"0x{start:x}",
        "rvaEndExclusive": f"0x{end:x}",
        **raw_record(body),
        "selectedInstructions": selected,
        "directBranchTargets": [f"0x{target:x}" for target in targets],
    }


def parse_immediate(text: str) -> int:
    match = re.search(r"#(-?0x[0-9a-f]+|-?[0-9]+)", text)
    if not match:
        raise RuntimeError(f"instruction has no immediate: {text}")
    return int(match.group(1), 0)


def packed_vector(instructions: dict[int, object], mov: int, movk: int) -> tuple[int, int]:
    low = parse_immediate(instructions[mov].op_str)
    high = parse_immediate(instructions[movk].op_str)
    packed = low | (high << 32)
    return packed & 0xFFFFFFFF, packed >> 32


def referenced_address(instructions: dict[int, object], page_at: int, offset_at: int) -> int:
    page = parse_immediate(instructions[page_at].op_str)
    offset = parse_immediate(instructions[offset_at].op_str)
    return page + offset


def field_record(raw: bytes, offset: int, size: int, value) -> dict:
    field = raw[offset : offset + size]
    if len(field) != size:
        raise RuntimeError(f"serialized field at 0x{offset:x} is truncated")
    return {"objectOffset": offset, "value": value, **raw_record(field)}


def extract_build_settings(globalgamemanagers: bytes) -> dict:
    env = UnityPy.load(globalgamemanagers)
    objects = [obj for obj in env.objects if obj.type.name == "BuildSettings"]
    if len(objects) != 1:
        raise RuntimeError(f"expected one BuildSettings object, found {len(objects)}")
    obj = objects[0]
    tree = obj.read_typetree()
    raw = bytes(obj.get_raw_data())
    apis = [int(value) for value in tree.get("m_GraphicsAPIs", [])]
    needle = struct.pack("<I", len(apis)) + b"".join(struct.pack("<I", x) for x in apis)
    offsets = [index for index in range(len(raw)) if raw.startswith(needle, index)]
    if len(offsets) != 1:
        raise RuntimeError(f"m_GraphicsAPIs raw sequence occurs {len(offsets)} times")
    offset = offsets[0]
    return {
        "object": {
            "pathId": str(obj.path_id),
            "type": obj.type.name,
            "byteStart": obj.byte_start,
            **raw_record(raw),
        },
        "unityVersion": tree.get("m_Version"),
        "graphicsApis": {
            "values": apis,
            "arrayCount": field_record(raw, offset, 4, len(apis)),
            "elements": [
                field_record(raw, offset + 4 + index * 4, 4, value)
                for index, value in enumerate(apis)
            ],
        },
    }


def read_aligned_string(raw: bytes, cursor: int) -> tuple[str, int, dict]:
    start = cursor
    length = struct.unpack_from("<I", raw, cursor)[0]
    cursor += 4
    data = raw[cursor : cursor + length]
    cursor += length
    cursor = (cursor + 3) & ~3
    value = data.decode("utf-8")
    return value, cursor, field_record(raw, start, cursor - start, value)


def extract_soc_asset(raw_asset: bytes) -> dict:
    env = UnityPy.load(raw_asset)
    objects = [obj for obj in env.objects if obj.type.name == "MonoBehaviour"]
    if len(objects) != 1:
        raise RuntimeError(f"expected one SoC MonoBehaviour, found {len(objects)}")
    obj = objects[0]
    raw = bytes(obj.get_raw_data())
    cursor = 0x38
    count = struct.unpack_from("<I", raw, cursor)[0]
    count_field = field_record(raw, cursor, 4, count)
    cursor += 4
    entries = []
    for index in range(count):
        entry_start = cursor
        entry_id, cursor, id_field = read_aligned_string(raw, cursor)
        soc, cursor, soc_field = read_aligned_string(raw, cursor)
        entries.append(
            {
                "index": index,
                "id": id_field,
                "soc": soc_field,
                "entry": field_record(raw, entry_start, cursor - entry_start, {"id": entry_id, "soc": soc}),
            }
        )
    if cursor != len(raw):
        raise RuntimeError(f"SoC object parser ended at {cursor}, object has {len(raw)} bytes")
    return {
        "resource": raw_record(raw_asset),
        "object": {
            "pathId": str(obj.path_id),
            "type": obj.type.name,
            "byteStart": obj.byte_start,
            **raw_record(raw),
        },
        "arrayCount": count_field,
        "entries": entries,
    }


def extract_detail_view(path: Path) -> dict:
    bundle = path.read_bytes()
    env = UnityPy.load(bundle)
    matches = [obj for obj in env.objects if obj.path_id == DETAIL_PATH_ID]
    if len(matches) != 1:
        raise RuntimeError(f"detail UICardView PathID resolved {len(matches)} objects")
    obj = matches[0]
    tree = obj.read_typetree()
    raw = bytes(obj.get_raw_data())
    fields = {
        "_cardSize": field_record(raw, 0x60, 4, int(tree["_cardSize"])),
        "_useGyro": field_record(raw, 0x64, 1, int(tree["_useGyro"])),
    }
    for name, record in fields.items():
        decoded = int.from_bytes(bytes.fromhex(record["rawHex"]), "little")
        if decoded != record["value"]:
            raise RuntimeError(f"{name} typetree/raw mismatch: {record['value']} != {decoded}")
    script = tree["m_Script"]
    return {
        "bundlePath": str(path.resolve()),
        "bundleRelativePath": DETAIL_BUNDLE.as_posix(),
        "bundle": raw_record(bundle),
        "serializedFile": str(obj.assets_file.name),
        "object": {
            "pathId": str(obj.path_id),
            "classId": int(obj.serialized_type.class_id),
            "typeId": int(obj.type_id),
            "scriptTypeIndex": int(obj.serialized_type.script_type_index),
            "scriptTypeHashHex": bytes(obj.serialized_type.old_type_hash).hex(),
            "byteStart": obj.byte_start,
            "scriptPPtr": {
                "fileId": int(script["m_FileID"]),
                "pathId": str(script["m_PathID"]),
            },
            **raw_record(raw),
        },
        "fields": fields,
    }


def f32(value: float) -> float:
    return struct.unpack("<f", struct.pack("<f", value))[0]


def calculate_side(pixel_height: int, vertical: float, quality: float) -> dict:
    height_f32 = f32(float(pixel_height))
    quotient = f32(height_f32 / vertical)
    scaled = f32(quotient * quality)
    side = int(round(float(scaled)))
    return {
        "pixelHeightF32": height_f32,
        "afterFdivF32": quotient,
        "afterFmulF32": scaled,
        "rounding": "roundToEven",
        "side": side,
        "width": side,
        "height": side,
    }


def derive_native(elf, methods: dict) -> dict:
    dim = instruction_map(elf, METHODS["cardDimensionCctor"][1], METHODS["cardDimensionCctor"][2])
    large = packed_vector(dim, 0x438D940, 0x438D944)
    small = packed_vector(dim, 0x438D948, 0x438D94C)
    medium = packed_vector(dim, 0x438D958, 0x438D960)
    dimensions = {
        1: {"name": "Small", "width": small[0], "height": small[1], "staticOffset": 0x10},
        2: {"name": "Medium", "width": medium[0], "height": medium[1], "staticOffset": 0x08},
        3: {"name": "Large", "width": large[0], "height": large[1], "staticOffset": 0x00},
    }

    meter_rva = referenced_address(dim, 0x438D970, 0x438D978)
    meter_raw = elf.range(meter_rva, meter_rva + 8)
    meter = struct.unpack("<ff", meter_raw)

    renderer_cctor = instruction_map(
        elf, METHODS["cardRendererCctor"][1], METHODS["cardRendererCctor"][2]
    )
    denominator_rva = referenced_address(renderer_cctor, 0x4444D38, 0x4444D40)
    denominator_raw = elf.range(denominator_rva, denominator_rva + 4)
    denominator = struct.unpack("<f", denominator_raw)[0]
    half_y = f32(f32(meter[1]) * f32(0.5))
    vertical = f32(half_y / f32(denominator))

    to_size = instruction_map(elf, METHODS["toCardSize"][1], METHODS["toCardSize"][2])
    table_rva = referenced_address(to_size, 0x4451834, 0x4451838)
    table_raw = elf.range(table_rva, table_rva + 24)
    table = list(struct.unpack("<6I", table_raw))

    quality_set = instruction_map(elf, METHODS["qualitySet"][1], METHODS["qualitySet"][2])
    low_rva = referenced_address(quality_set, 0x46979F4, 0x46979FC)
    middle_rva = referenced_address(quality_set, 0x4697A3C, 0x4697A44)
    low_raw = elf.range(low_rva, low_rva + 4)
    middle_raw = elf.range(middle_rva, middle_rva + 4)
    quality = {
        0: {"name": "High", "factor": f32(1.0), "source": "fmov"},
        1: {
            "name": "Middle",
            "factor": struct.unpack("<f", middle_raw)[0],
            "constant": {"rva": f"0x{middle_rva:x}", **raw_record(middle_raw)},
        },
        2: {
            "name": "Low",
            "factor": struct.unpack("<f", low_raw)[0],
            "constant": {"rva": f"0x{low_rva:x}", **raw_record(low_raw)},
        },
    }

    forbidden_blits = {0x64E8AD4, 0x64E8B58, 0x64E8BEC}
    actual_targets = {
        int(value, 16) for value in methods["renderOneShot"]["directBranchTargets"]
    }
    asset_targets = {
        int(value, 16)
        for value in methods["asset3DCreateRenderTexture"]["directBranchTargets"]
    }

    return {
        "cardDimensions": {
            "pixelSizeMethodRva": methods["pixelSize"]["rvaStart"],
            "cctorRange": [
                methods["cardDimensionCctor"]["rvaStart"],
                methods["cardDimensionCctor"]["rvaEndExclusive"],
            ],
            "byCardSizeType": {str(key): value for key, value in dimensions.items()},
            "meterSize": {
                "rva": f"0x{meter_rva:x}",
                "x": meter[0],
                "y": meter[1],
                **raw_record(meter_raw),
            },
        },
        "verticalPercentageInRT": {
            "cctorRange": [
                methods["cardRendererCctor"]["rvaStart"],
                methods["cardRendererCctor"]["rvaEndExclusive"],
            ],
            "denominator": {
                "rva": f"0x{denominator_rva:x}",
                "value": denominator,
                **raw_record(denominator_raw),
            },
            "operation": "float32(MeterSize.y * 0.5) / denominator",
            "meterYTimesHalfF32": half_y,
            "valueF32": vertical,
        },
        "uiCardViewSizeMap": {
            "tableRva": f"0x{table_rva:x}",
            "indexOperation": "UICardViewSizeType - 1",
            "values": table,
            **raw_record(table_raw),
        },
        "quality": {
            "setRange": [methods["qualitySet"]["rvaStart"], methods["qualitySet"]["rvaEndExclusive"]],
            "byEnum": {str(key): value for key, value in quality.items()},
            "defaults": {
                "ordinaryAndroid": {"qualityEnum": 1, "qualityName": quality[1]["name"], "fpsEnum": 0, "fps": 60},
                "listedLowSoC": {"qualityEnum": 2, "qualityName": quality[2]["name"], "fpsEnum": 1, "fps": 30},
            },
            "persistedOverride": {
                "provedCapable": True,
                "updateDefaultTarget": "0x47446ac",
                "getIntTarget": "0x473e144",
                "setIntTarget": "0x473e128",
                "saveTarget": "0x473e500",
            },
        },
        "renderTexture": {
            "cardCreateRange": [
                methods["cardRendererCreateRenderTexture"]["rvaStart"],
                methods["cardRendererCreateRenderTexture"]["rvaEndExclusive"],
            ],
            "formula": "roundToEven(pixelHeight / VerticalPercentageInRT * UICardQuality)",
            "square": True,
            "underlying": {
                "methodRva": methods["asset3DCreateRenderTexture"]["rvaStart"],
                "widthArgument": "w1",
                "heightArgument": "w2",
                "depthBits": parse_immediate(
                    instruction_map(elf, 0x4396050, 0x439612C)[0x43960A8].op_str
                ),
                "renderTextureFormatEnum": 0,
                "renderTextureFormat": "ARGB32",
                "antiAliasingSetterRva": "0x650c73c",
                "antiAliasingSetterCalled": 0x650C73C in asset_targets,
                "antiAliasing": 1 if 0x650C73C not in asset_targets else None,
            },
        },
        "renderOneShot": {
            "method": methods["renderOneShot"],
            "cameraTargetTextureSetterRva": "0x64dcfec",
            "cameraRenderRva": "0x64df244",
            "managedGraphicsBlitRvas": [f"0x{x:x}" for x in sorted(forbidden_blits)],
            "managedGraphicsBlitTargetsPresent": [
                f"0x{x:x}" for x in sorted(forbidden_blits & actual_targets)
            ],
            "hasManagedBlitOrFlip": bool(forbidden_blits & actual_targets),
        },
    }


def extract_homography(shader_root: Path, apkm_path: Path, spirv_cross: str) -> dict:
    evidence = HOMOGRAPHY.extract(shader_root, apkm_path)
    modules = {}
    for module in evidence["modules"]:
        stage = module["stage"]
        spv = bytes.fromhex(module["spvHex"])
        with tempfile.TemporaryDirectory(prefix="pcr-card-renderer-") as directory:
            source = Path(directory) / f"{stage}.spv"
            source.write_bytes(spv)
            result = subprocess.run(
                [spirv_cross, str(source), "--version", "300", "--es"],
                check=True,
                capture_output=True,
                text=True,
            )
        glsl = result.stdout.replace("\r\n", "\n")
        selected_lines = [
            line.strip()
            for line in glsl.splitlines()
            if "texture(" in line or "gl_Position.y" in line
        ]
        modules[stage] = {
            **raw_record(spv),
            "glslSha256": sha256(glsl.encode("utf-8")),
            "selectedLines": selected_lines,
            "containsTextureST": "_ST" in glsl,
            "containsOneMinusSampleY": bool(
                re.search(r"1\.0\s*-\s*[^;\n]*\.y|\(-[^;\n]*\.y\)\s*\+\s*1\.0", glsl)
            ),
            "containsVulkanClipYFlip": bool(
                re.search(r"gl_Position\.y\s*=\s*-gl_Position\.y\s*;", glsl)
            ),
        }
    material = evidence["officialMaterial"]
    return {
        "shader": {
            "name": evidence["shader"]["name"],
            "bundleRelativePath": evidence["source"]["bundleRelativePath"],
            "bundle": evidence["source"]["bundle"],
            "serializedFile": evidence["source"]["shaderSerializedFile"],
            "object": evidence["source"]["shaderObject"],
        },
        "material": {
            "name": material["name"],
            "bundle": material["bundle"],
            "serializedFile": material["serializedFile"],
            "object": material["materialObject"],
            "dynamicUITexture": material["dynamicUITexture"],
        },
        "modules": modules,
        "consumer": {
            "fragmentSamplesDirectUvWithoutOneMinusY": (
                not modules["fragment"]["containsOneMinusSampleY"]
            ),
            "fragmentHasNoTextureST": not modules["fragment"]["containsTextureST"],
            "vertexHasVulkanClipYFlip": modules["vertex"]["containsVulkanClipYFlip"],
            "consumerAlphaFormula": "1.0 - sampled.a",
        },
    }


def extract(apkm_path: Path, decrypted_root: Path, spirv_cross: str) -> dict:
    apkm = apkm_path.read_bytes()
    with zipfile.ZipFile(io.BytesIO(apkm)) as outer:
        base_apk = outer.read("base.apk")
        arm64_apk = outer.read("split_config.arm64_v8a.apk")
    with zipfile.ZipFile(io.BytesIO(base_apk)) as base:
        globalgamemanagers = base.read(GGM_PATH)
        soc_asset = base.read(SOC_PATH)
    with zipfile.ZipFile(io.BytesIO(arm64_apk)) as split:
        libil2cpp = split.read(IL2CPP_PATH)

    elf = BASIS.Elf64(libil2cpp)
    methods = {key: method_record(elf, key) for key in METHODS}
    native = derive_native(elf, methods)
    detail = extract_detail_view(decrypted_root / DETAIL_BUNDLE)
    build_settings = extract_build_settings(globalgamemanagers)
    soc = extract_soc_asset(soc_asset)

    serialized_size = detail["fields"]["_cardSize"]["value"]
    table = native["uiCardViewSizeMap"]["values"]
    if not 1 <= serialized_size <= len(table):
        raise RuntimeError(f"serialized card size {serialized_size} is outside ToCardSize table")
    card_size_type = table[serialized_size - 1]
    dimensions = native["cardDimensions"]["byCardSizeType"][str(card_size_type)]
    middle = native["quality"]["byEnum"]["1"]
    source_rts_by_quality = {
        quality["name"]: calculate_side(
            dimensions["height"],
            native["verticalPercentageInRT"]["valueF32"],
            quality["factor"],
        )
        for quality in native["quality"]["byEnum"].values()
    }
    default_rt = calculate_side(
        dimensions["height"], native["verticalPercentageInRT"]["valueF32"], middle["factor"]
    )
    medium_counterfactual = calculate_side(
        native["cardDimensions"]["byCardSizeType"]["2"]["height"],
        native["verticalPercentageInRT"]["valueF32"],
        middle["factor"],
    )

    homography = extract_homography(decrypted_root / "Common/Shader", apkm_path, spirv_cross)
    return {
        "schemaVersion": 1,
        "source": {
            "apkmPath": str(apkm_path.resolve()),
            "apkm": {"byteSize": len(apkm), "sha256": sha256(apkm)},
            "baseApk": {"byteSize": len(base_apk), "sha256": sha256(base_apk)},
            "arm64Split": {"byteSize": len(arm64_apk), "sha256": sha256(arm64_apk)},
            "libil2cpp": {"path": IL2CPP_PATH, "byteSize": len(libil2cpp), "sha256": sha256(libil2cpp)},
            "globalgamemanagers": {"path": GGM_PATH, "byteSize": len(globalgamemanagers), "sha256": sha256(globalgamemanagers)},
        },
        "methods": methods,
        "native": native,
        "serialized": {
            "buildSettings": build_settings,
            "lowQualitySoC": soc,
            "detailCardView": detail,
        },
        "homography": homography,
        "derived": {
            "detailView": {
                "serializedUICardViewSizeType": serialized_size,
                "tableIndex": serialized_size - 1,
                "cardSizeType": card_size_type,
                "cardSizeName": dimensions["name"],
                "pixelSize": {"width": dimensions["width"], "height": dimensions["height"]},
                "callsiteFieldOffset": 0x158,
                "defaultAndroidQuality": middle["name"],
                "defaultAndroidQualityFactor": middle["factor"],
                "defaultSourceRenderTexture": default_rt,
                "sourceRenderTexturesByQuality": source_rts_by_quality,
                "mediumMiddleCounterfactual": medium_counterfactual,
                "sourceRenderTextureFixed561Proved": False,
            },
            "android": {
                "graphicsApiValues": build_settings["graphicsApis"]["values"],
                "graphicsApiNames": ["Vulkan" if value == 21 else f"Unknown({value})" for value in build_settings["graphicsApis"]["values"]],
            },
        },
        "unproved": [
            "native RenderTexture physical Y origin",
            "runtime producer and SetTexture assignment path for _DynamicUITex",
            "producer-side alpha convention and end-to-end alpha contract",
            "actual persisted quality selected on a runtime device",
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
        default=Path(os.environ.get("PCR_DECRYPTED_ROOT", DEFAULT_DECRYPTED_ROOT)),
    )
    parser.add_argument("--spirv-cross", default=os.environ.get("SPIRV_CROSS", "spirv-cross"))
    args = parser.parse_args()
    if not args.apkm.is_file():
        parser.error(f"APKM not found: {args.apkm}")
    if not args.decrypted_root.is_dir():
        parser.error(f"decrypted root not found: {args.decrypted_root}")
    result = extract(args.apkm.resolve(), args.decrypted_root.resolve(), args.spirv_cross)
    json.dump(result, sys.stdout, ensure_ascii=True, indent=2)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
