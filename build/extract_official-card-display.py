#!/usr/bin/env python3
"""Extract official-only evidence for the 1.6.0 card display path.

The APKM supplies IL2CPP metadata/code and the serialized ModelRenderStudio
camera. Decrypted official card/shader bundles supply the four prefab PPtr
chains and RT0 ShaderLab blend state. Repository scenes, recipes, browser
runtime files, screenshots, and generated reports are deliberately not read.
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
ROOT = Path(__file__).resolve().parents[1]
DEFAULT_APKM = (
    ROOT.parent / "ptcg-apk-parser" / "apks" /
    "jp.pokemon.pokemontcgp_1.6.0.apkm"
)
DEFAULT_DECRYPTED_ROOT = Path(
    "D:/DevProjectes/ptcgp-tools-master/masterdata_decoder/.output/decrypted"
)
UNITY_VERSION = "2022.3.62f2"

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
    "pcr_card_display_basis", ROOT / "build" / "extract_official_pass_partition.py"
)
MRT = load_module(
    "pcr_card_display_mrt", ROOT / "build" / "extract_official_mrt_outputs.py"
)
SHADER_STATE = load_module(
    "pcr_card_display_shader_state", ROOT / "build" / "extract-shader-defaults.py"
)

BASIS.UnityPy.config.FALLBACK_UNITY_VERSION = UNITY_VERSION
warnings.filterwarnings("ignore", category=Warning, module=r"UnityPy\..*")


# These package-matched RVAs are locators. Complete bodies and selected
# instructions are re-read and hashed on every extraction.
METHODS = {
    "uiCardViewCreateRenderer": (
        "UICardView.CreateRenderer", 0x443D880, 0x443D96C
    ),
    "cardRendererCtor": (
        "CardRenderer..ctor", 0x443D96C, 0x443DA4C
    ),
    "cardRendererCreateRenderTexture": (
        "CardRenderer.CreateRenderTexture", 0x4444410, 0x4444794
    ),
    "asset3DCreateRenderTexture": (
        "Asset3DRenderer.CreateRenderTexture", 0x4396050, 0x439612C
    ),
    "asset3DGetRenderTexture": (
        "Asset3DRenderer.get_RenderTexture", 0x4395654, 0x439565C
    ),
    "uiAssetInitializeMoveNext": (
        "UIAsset3DView.<Initialize>d__71.MoveNext", 0x43942EC, 0x4394F74
    ),
    "rawImageSetTexture": (
        "RawImage.set_texture", 0x6726F1C, 0x6726FD8
    ),
    "graphicSetMaterialDirty": (
        "Graphic.SetMaterialDirty", 0x65BEEA0, 0x65BEF34
    ),
    "graphicRebuild": (
        "Graphic.Rebuild", 0x65C01E4, 0x65C02C8
    ),
    "graphicUpdateMaterial": (
        "Graphic.UpdateMaterial", 0x65C02D0, 0x65C0388
    ),
    "canvasSetMaterialCount": (
        "CanvasRenderer.set_materialCount", 0x6718304, 0x6718348
    ),
    "canvasSetMaterial": (
        "CanvasRenderer.SetMaterial(Material,int)", 0x67188F4, 0x6718948
    ),
    "canvasSetTexture": (
        "CanvasRenderer.SetTexture", 0x6718A24, 0x6718A68
    ),
}


SIGNATURES = {
    "uiCardViewCreateRenderer": {
        0x443D940: "bl #0x443d96c",
        0x443D94C: "str x25, [x19, #0x168]",
    },
    "cardRendererCtor": {
        0x443DA18: "bl #0x43956fc",
        0x443DA48: "b #0x4444410",
    },
    "cardRendererCreateRenderTexture": {
        0x44446D0: "bl #0x4396050",
        0x44446D4: "mov x1, x0",
        0x44446DC: "str x1, [x0, #0x40]!",
    },
    "asset3DCreateRenderTexture": {
        0x43960A0: "mov w1, w23",
        0x43960A4: "mov w2, w22",
        0x43960A8: "mov w3, #0x18",
        0x43960AC: "mov w4, wzr",
        0x43960B8: "bl #0x650de04",
    },
    "asset3DGetRenderTexture": {
        0x4395654: "ldr x0, [x0, #0x40]",
        0x4395658: "ret",
    },
    "uiAssetInitializeMoveNext": {
        0x43943BC: "ldr x20, [x19, #0x18]",
        0x439459C: "ldr x1, [x8, #0x620]",
        0x43945A0: "ldr x9, [x8, #0x618]",
        0x43945A8: "blr x9",
        0x43945B0: "add x23, x20, #0x128",
        0x43945B4: "str x1, [x20, #0x128]",
        0x43947A4: "ldr x23, [x23]",
        0x43947EC: "mov w2, #2",
        0x43947FC: "add w9, w9, #2",
        0x4394808: "ldp x8, x1, [x0]",
        0x4394810: "blr x8",
        0x4394814: "mov x1, x0",
        0x4394824: "bl #0x6726f1c",
    },
    "rawImageSetTexture": {
        0x6726F64: "ldr x22, [x21, #0xd8]!",
        0x6726F9C: "str x20, [x19, #0xd8]",
        0x6726FAC: "ldr x9, [x8, #0x2f8]",
        0x6726FB0: "ldr x1, [x8, #0x300]",
        0x6726FC8: "ldr x1, [x8, #0x310]",
        0x6726FCC: "ldr x2, [x8, #0x308]",
        0x6726FD4: "br x2",
    },
    "graphicSetMaterialDirty": {
        0x65BEEF4: "strb w8, [x19, #0x69]",
        0x65BEF04: "bl #0x65b93a4",
    },
    "graphicRebuild": {
        0x65C0268: "cmp w20, #3",
        0x65C0294: "ldrb w8, [x19, #0x69]",
        0x65C02A4: "ldr x9, [x8, #0x3b8]",
        0x65C02A8: "ldr x1, [x8, #0x3c0]",
        0x65C02AC: "blr x9",
        0x65C02B0: "strb wzr, [x19, #0x69]",
    },
    "graphicUpdateMaterial": {
        0x65C0300: "bl #0x6718304",
        0x65C0338: "bl #0x67188f4",
        0x65C0374: "b #0x6718a24",
    },
    "canvasSetMaterialCount": {
        0x6718320: "adrp x0, #0x1ad7000",
        0x6718324: "add x0, x0, #0x671",
        0x6718328: "bl #0x2f8d2c8",
        0x6718344: "br x2",
    },
    "canvasSetMaterial": {
        0x6718918: "adrp x0, #0x1ab5000",
        0x671891C: "add x0, x0, #0x333",
        0x6718920: "bl #0x2f8d2c8",
        0x6718944: "br x3",
    },
    "canvasSetTexture": {
        0x6718A40: "adrp x0, #0x1acb000",
        0x6718A44: "add x0, x0, #0xc90",
        0x6718A48: "bl #0x2f8d2c8",
        0x6718A64: "br x2",
    },
}


ICALLS = {
    "setMaterialCount": {
        "wrapper": "canvasSetMaterialCount",
        "rva": 0x1AD7671,
        "value": "UnityEngine.CanvasRenderer::set_materialCount(System.Int32)",
    },
    "setMaterial": {
        "wrapper": "canvasSetMaterial",
        "rva": 0x1AB5333,
        "value": (
            "UnityEngine.CanvasRenderer::SetMaterial("
            "UnityEngine.Material,System.Int32)"
        ),
    },
    "setTexture": {
        "wrapper": "canvasSetTexture",
        "rva": 0x1ACBC90,
        "value": "UnityEngine.CanvasRenderer::SetTexture(UnityEngine.Texture)",
    },
}


TYPE_SELECTIONS = {
    "uiCardView": {
        "namespace": "Lettuce.Infrastructure.Card.Core",
        "name": "UICardView",
        "fields": {"cardRenderer": "_cardRenderer"},
        "methods": {"createRenderer": ("CreateRenderer", 0, None)},
    },
    "cardRenderer": {
        "namespace": "Lettuce.Infrastructure.Card.Core",
        "name": "CardRenderer",
        "fields": {},
        "methods": {
            "ctor": (".ctor", 4, None),
            "createRenderTexture": ("CreateRenderTexture", 2, None),
        },
    },
    "asset3DRenderer": {
        "namespace": "Lettuce.Infrastructure.Asset3D.Core",
        "name": "Asset3DRenderer",
        "fields": {"renderTexture": "_renderTexture"},
        "methods": {
            "getRenderTexture": ("get_RenderTexture", 0, None),
            "createRenderTexture": ("CreateRenderTexture", 4, None),
        },
    },
    "asset3DRendererInterface": {
        "namespace": "Lettuce.Infrastructure.Asset3D.Core",
        "name": "IAsset3DRenderer",
        "fields": {},
        "methods": {"getRenderTexture": ("get_RenderTexture", 0, None)},
    },
    "uiAsset3DView": {
        "namespace": "Lettuce.Infrastructure.Asset3D.Core",
        "name": "UIAsset3DView",
        "fields": {"assetRenderer": "<AssetRenderer>k__BackingField"},
        "methods": {
            "createRenderer": ("CreateRenderer", 0, None),
            "initialize": ("Initialize", 1, None),
        },
    },
    "uiAssetInitializeState": {
        "namespace": "",
        "name": "<Initialize>d__71",
        "fields": {"view": "<>4__this", "child": "<child>5__2"},
        "methods": {"moveNext": ("MoveNext", 0, None)},
    },
    "rawImage": {
        "namespace": "UnityEngine.UI",
        "name": "RawImage",
        "fields": {"texture": "m_Texture"},
        "methods": {"setTexture": ("set_texture", 1, None)},
    },
    "graphic": {
        "namespace": "UnityEngine.UI",
        "name": "Graphic",
        "fields": {
            "canvasRenderer": "m_CanvasRenderer",
            "materialDirty": "m_MaterialDirty",
        },
        "methods": {
            "setMaterialDirty": ("SetMaterialDirty", 0, None),
            "rebuild": ("Rebuild", 1, None),
            "updateMaterial": ("UpdateMaterial", 0, None),
        },
    },
    "canvasRenderer": {
        "namespace": "UnityEngine",
        "name": "CanvasRenderer",
        "fields": {},
        "methods": {
            "setMaterialCount": ("set_materialCount", 1, None),
            "setMaterial": ("SetMaterial", 2, "0x06000022"),
            "setTexture": ("SetTexture", 1, None),
        },
    },
}


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def raw_record(data: bytes) -> dict:
    return {"byteSize": len(data), "rawHex": data.hex(), "sha256": sha256(data)}


def hash_record(data: bytes) -> dict:
    return {"byteSize": len(data), "sha256": sha256(data)}


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
    for address, expected in SIGNATURES.get(key, {}).items():
        item = by_address.get(address)
        actual = instruction_text(item) if item else None
        if actual != expected:
            raise RuntimeError(
                f"{name} 0x{address:x}: expected {expected!r}, got {actual!r}"
            )
        selected.append(instruction_record(item))
    branch_targets = sorted({
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
        "directBranchTargets": [f"0x{target:x}" for target in branch_targets],
    }


def cstring_record(elf, rva: int) -> dict:
    offset = elf.rva_to_offset(rva)
    end = elf.data.find(b"\0", offset)
    if end < 0:
        raise RuntimeError(f"unterminated ELF string at RVA 0x{rva:x}")
    raw = elf.data[offset:end]
    return {"rva": f"0x{rva:x}", "value": raw.decode("utf-8"), **raw_record(raw)}


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
                f"expected IL2CPP metadata v31, got magic=0x{magic:08x} "
                f"version={self.version}"
            )
        self.string_offset, self.string_size = struct.unpack_from("<II", data, 24)
        self.tables = {
            "methods": metadata_table(
                data, METADATA_METHODS_PAIR, METHOD_DEFINITION_SIZE
            ),
            "fields": metadata_table(
                data, METADATA_FIELDS_PAIR, FIELD_DEFINITION_SIZE
            ),
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

    def type(self, selection: dict) -> dict:
        namespace = selection["namespace"]
        name = selection["name"]
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
        fields = [self.field(field_start + item) for item in range(counts[2])]
        methods = [self.method(method_start + item) for item in range(counts[0])]

        selected_fields = {}
        for key, requested_name in selection["fields"].items():
            found = [row for row in fields if row["name"] == requested_name]
            if len(found) != 1:
                raise RuntimeError(
                    f"metadata {namespace}.{name} field {requested_name!r} "
                    f"occurs {len(found)} times"
                )
            selected_fields[key] = found[0]

        selected_methods = {}
        for key, (requested_name, parameter_count, token) in selection["methods"].items():
            found = [
                row for row in methods
                if row["name"] == requested_name
                and row["parameterCount"] == parameter_count
                and (token is None or row["token"] == token)
            ]
            if len(found) != 1:
                raise RuntimeError(
                    f"metadata {namespace}.{name} method "
                    f"{requested_name}/{parameter_count}/{token or '*'} occurs "
                    f"{len(found)} times"
                )
            selected_methods[key] = found[0]

        bitfield, token = struct.unpack_from("<II", raw, 80)
        return {
            "namespace": namespace,
            "name": name,
            "typeDefinitionIndex": index,
            "declaringTypeIndex": values[4],
            "token": f"0x{token:08x}",
            "bitfield": f"0x{bitfield:08x}",
            "fieldCount": counts[2],
            "methodCount": counts[0],
            "recordFileOffset": offset,
            "record": raw_record(raw),
            "selectedFields": selected_fields,
            "selectedMethods": selected_methods,
        }


def extract_camera(apk: zipfile.ZipFile, globalgamemanagers: bytes) -> dict:
    located = BASIS.extract_asset3d_card_camera(apk, globalgamemanagers)
    resource = apk.read(located["resourcePath"])
    environment = BASIS.UnityPy.load(resource)
    objects = {int(obj.path_id): obj for obj in environment.objects}
    camera = objects.get(int(located["camera"]["pathId"]))
    if camera is None or camera.type.name != "Camera":
        raise RuntimeError("pinned ModelRenderStudio Camera object is missing")
    tree = camera.read_typetree()
    raw = bytes(camera.get_raw_data())
    color = tree.get("m_BackGroundColor") or {}
    rgba = [float(color.get(channel, 0.0)) for channel in "rgba"]
    clear_flags = int(tree.get("m_ClearFlags", -1))

    clear_flags_offset = 16
    color_offset = 20
    alpha_offset = color_offset + 12
    flags_raw = raw[clear_flags_offset:clear_flags_offset + 4]
    color_raw = raw[color_offset:color_offset + 16]
    alpha_raw = raw[alpha_offset:alpha_offset + 4]
    if flags_raw != struct.pack("<I", clear_flags):
        raise RuntimeError("ModelRenderStudio Camera clear-flags raw slot changed")
    if color_raw != struct.pack("<ffff", *rgba):
        raise RuntimeError("ModelRenderStudio Camera clear-color raw slot changed")
    if rgba != [0.0, 0.0, 0.0, 1.0] or alpha_raw != struct.pack("<f", 1.0):
        raise RuntimeError(f"ModelRenderStudio Camera clear color changed: {rgba}")

    return {
        "status": "proved-from-serialized-official-camera",
        "resourcePath": located["resourcePath"],
        "resource": hash_record(resource),
        "camera": {
            **located["camera"],
            "object": raw_record(raw),
            "clearFlags": {
                "name": "m_ClearFlags",
                "value": clear_flags,
                "objectOffset": clear_flags_offset,
                **raw_record(flags_raw),
            },
            "clearColor": {
                "name": "m_BackGroundColor",
                "rgba": rgba,
                "objectOffset": color_offset,
                **raw_record(color_raw),
                "alpha": {
                    "value": rgba[3],
                    "objectOffset": alpha_offset,
                    **raw_record(alpha_raw),
                },
            },
        },
        "layer": located["layerSemantics"],
    }


def integral(value, label: str) -> int:
    numeric = float(value)
    if not numeric.is_integer():
        raise RuntimeError(f"{label} is not an integer enum value: {value}")
    return int(numeric)


def resolve_parameter(parameter: dict, properties: dict[str, float], label: str) -> dict:
    name = parameter.get("name")
    shader_default = parameter.get("val")
    if name:
        if name not in properties:
            raise RuntimeError(f"{label}: Material does not serialize parameter {name}")
        value = properties[name]
        source = "material-property"
    else:
        value = shader_default
        source = "shader-state-literal"
    return {
        "value": integral(value, label),
        "source": source,
        "property": name,
        "shaderDefault": integral(shader_default, f"{label} shader default"),
    }


def classify_rt0(pass_state: dict, properties: dict[str, float], label: str) -> dict:
    if pass_state.get("rtSeparateBlend"):
        raise RuntimeError(f"{label}: expected shared ShaderLab RT blend state")
    blend = pass_state["rtBlends"][0]
    mapping = {
        "srcColor": "src",
        "dstColor": "dst",
        "srcAlpha": "srcAlpha",
        "dstAlpha": "dstAlpha",
        "colorOp": "op",
        "alphaOp": "opAlpha",
        "colorMask": "colMask",
    }
    bindings = {
        output: resolve_parameter(blend[source], properties, f"{label} {output}")
        for output, source in mapping.items()
    }
    resolved = {key: row["value"] for key, row in bindings.items()}
    color_mask = resolved["colorMask"]
    if color_mask & ~0xF:
        raise RuntimeError(f"{label}: unsupported ColorMask {color_mask}")
    writes_rgb = bool(color_mask & 0x7)
    writes_alpha = bool(color_mask & 0x8)

    if not writes_alpha:
        classification = "preserve"
        equation = "RT0 alpha write masked"
    else:
        signature = (
            resolved["alphaOp"], resolved["srcAlpha"], resolved["dstAlpha"]
        )
        if signature == (0, 0, 0):
            classification = "clear-to-zero"
            equation = "dstA' = 0"
        elif signature == (0, 0, 10):
            classification = "multiply-by-1-srcA"
            equation = "dstA' = dstA * (1 - srcA)"
        elif signature == (0, 0, 1):
            classification = "preserve"
            equation = "dstA' = dstA"
        else:
            raise RuntimeError(
                f"{label}: color-writing RT0 alpha state is outside the allowed "
                f"classes: op/src/dst={signature}, mask={color_mask}"
            )

    return {
        "classification": classification,
        "equation": equation,
        "writesRgb": writes_rgb,
        "writesAlpha": writes_alpha,
        "rtSeparateBlend": False,
        "bindings": bindings,
        "resolved": resolved,
    }


def canonical_digest(value) -> str:
    raw = json.dumps(
        value, ensure_ascii=True, sort_keys=True, separators=(",", ":")
    ).encode("utf-8")
    return sha256(raw)


def extract_prefab_alpha(decrypted_root: Path) -> dict:
    cards = tuple(MRT.OFFICIAL_CARDS)
    prefabs = [MRT.prefab_bundle(decrypted_root, card) for card in cards]
    missing = [path for path in prefabs if not path.is_file()]
    if missing:
        raise RuntimeError(f"official prefab bundle missing: {missing[0]}")

    index = MRT.OfficialBundleIndex(decrypted_root)
    index.build(prefabs)
    output_cards = []
    references = []
    unique_materials = set()
    unique_shaders = set()

    for card, prefab in zip(cards, prefabs):
        _, objects = index.load(prefab)
        renderers = sorted(
            (obj for obj in objects.values() if obj.type.name == "MeshRenderer"),
            key=lambda obj: int(obj.path_id),
        )
        card_start = len(references)
        for renderer in renderers:
            renderer_tree = renderer.read_typetree()
            renderer_raw = bytes(renderer.get_raw_data())
            for slot, pointer in enumerate(renderer_tree.get("m_Materials") or []):
                material_obj, material_bundle, material_pptr = index.resolve(
                    renderer, prefab, pointer
                )
                if material_obj.type.name != "Material":
                    raise RuntimeError(
                        f"Renderer {renderer.path_id} slot {slot} resolved to "
                        f"{material_obj.type.name}"
                    )
                material = material_obj.read_typetree()
                material_raw = bytes(material_obj.get_raw_data())
                shader_obj, shader_bundle, shader_pptr = index.resolve(
                    material_obj, material_bundle, material.get("m_Shader") or {}
                )
                if shader_obj.type.name != "Shader":
                    raise RuntimeError(
                        f"Material {material.get('m_Name')} shader PPtr resolved to "
                        f"{shader_obj.type.name}"
                    )
                shader = shader_obj.read_typetree()
                shader_raw = bytes(shader_obj.get_raw_data())
                parsed = shader.get("m_ParsedForm") or {}
                shader_name = str(parsed.get("m_Name", ""))
                if not shader_name:
                    raise RuntimeError(
                        f"Material {material.get('m_Name')} resolved an unnamed Shader"
                    )
                passes = [
                    (subshader_index, pass_index, SHADER_STATE.pass_state(shader_pass))
                    for subshader_index, subshader in enumerate(
                        parsed.get("m_SubShaders") or []
                    )
                    for pass_index, shader_pass in enumerate(
                        subshader.get("m_Passes") or []
                    )
                ]
                if len(passes) != 1:
                    raise RuntimeError(
                        f"{shader_name}: expected exactly one official pass, got "
                        f"{len(passes)}"
                    )
                subshader_index, pass_index, pass_state = passes[0]
                properties = MRT.material_properties(material)
                key = f"{card}:{renderer.path_id}:{slot}"
                alpha = classify_rt0(pass_state, properties, key)
                material_identity = (
                    material_pptr["targetBundle"], material_pptr["targetCab"],
                    material_pptr["pathId"],
                )
                shader_identity = (
                    shader_pptr["targetBundle"], shader_pptr["targetCab"],
                    shader_pptr["pathId"],
                )
                unique_materials.add(material_identity)
                unique_shaders.add(shader_identity)
                references.append({
                    "key": key,
                    "card": card,
                    "renderer": {
                        "type": renderer.type.name,
                        "cab": str(renderer.assets_file.name),
                        "pathId": str(renderer.path_id),
                        "enabled": bool(renderer_tree.get("m_Enabled", True)),
                        "rawByteSize": len(renderer_raw),
                        "rawSha256": sha256(renderer_raw),
                    },
                    "materialSlot": slot,
                    "materialPPtr": material_pptr,
                    "material": {
                        "name": material.get("m_Name"),
                        "cab": str(material_obj.assets_file.name),
                        "pathId": str(material_obj.path_id),
                        "rawByteSize": len(material_raw),
                        "rawSha256": sha256(material_raw),
                        "enabledKeywords": MRT.enabled_keywords(material),
                    },
                    "shaderPPtr": shader_pptr,
                    "shader": {
                        "name": shader_name,
                        "shortName": shader_name.split("/")[-1],
                        "cab": str(shader_obj.assets_file.name),
                        "pathId": str(shader_obj.path_id),
                        "bundle": index.relative(shader_bundle),
                        "bundleSha256": index.bundle_hash(shader_bundle),
                        "rawByteSize": len(shader_raw),
                        "rawSha256": sha256(shader_raw),
                    },
                    "pass": {
                        "subShaderIndex": subshader_index,
                        "passIndex": pass_index,
                        "name": pass_state.get("name", ""),
                    },
                    "rt0Alpha": alpha,
                })

        card_refs = references[card_start:]
        class_counts = {
            category: sum(
                row["rt0Alpha"]["classification"] == category
                for row in card_refs
            )
            for category in (
                "clear-to-zero", "multiply-by-1-srcA", "preserve"
            )
        }
        output_cards.append({
            "card": card,
            "prefab": index.relative(prefab),
            "prefabByteSize": prefab.stat().st_size,
            "prefabSha256": index.bundle_hash(prefab),
            "meshRenderers": len(renderers),
            "materialReferences": len(card_refs),
            "rt0AlphaCounts": class_counts,
        })

    categories = ("clear-to-zero", "multiply-by-1-srcA", "preserve")
    counts = {
        category: sum(
            row["rt0Alpha"]["classification"] == category
            for row in references
        )
        for category in categories
    }
    if len(references) != 98:
        raise RuntimeError(f"expected 98 official Material references, got {len(references)}")
    if sum(counts.values()) != len(references):
        raise RuntimeError("RT0 alpha classes do not cover every official reference")

    return {
        "status": "proved-for-four-pinned-official-prefabs",
        "cards": output_cards,
        "references": references,
        "referenceDigestSha256": canonical_digest(references),
        "summary": {
            "cards": len(output_cards),
            "meshRenderers": sum(card["meshRenderers"] for card in output_cards),
            "materialReferences": len(references),
            "uniqueMaterials": len(unique_materials),
            "uniqueShaders": len(unique_shaders),
            "alphaWritingReferences": sum(
                row["rt0Alpha"]["writesAlpha"] for row in references
            ),
            "alphaMaskedReferences": sum(
                not row["rt0Alpha"]["writesAlpha"] for row in references
            ),
            "rt0AlphaCounts": counts,
        },
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
        globalgamemanagers = apk.read(BASIS.GGM_PATH)
        camera = extract_camera(apk, globalgamemanagers)

    elf = BASIS.Elf64(libil2cpp)
    metadata, metadata_source = BASIS.decrypt_global_metadata(encrypted_metadata, elf)
    definitions = MetadataDefinitions(metadata)
    types = {
        key: definitions.type(selection)
        for key, selection in TYPE_SELECTIONS.items()
    }
    methods = {key: method_record(elf, key) for key in METHODS}
    icalls = {}
    for key, expected in ICALLS.items():
        record = cstring_record(elf, expected["rva"])
        if record["value"] != expected["value"]:
            raise RuntimeError(
                f"{key} icall changed: expected {expected['value']!r}, "
                f"got {record['value']!r}"
            )
        icalls[key] = {"wrapperMethod": expected["wrapper"], **record}

    prefab_alpha = extract_prefab_alpha(decrypted_root)
    return {
        "schemaVersion": 1,
        "status": "proved-with-explicit-boundaries",
        "evidencePolicy": {
            "officialOnly": True,
            "readInputs": [
                "1.6.0 APKM base.apk and arm64 split",
                "1.6.0 decrypted official card/shader bundles",
            ],
            "excludedInputs": [
                "scene.json", "recipes", "browser runtime", "screenshots",
            ],
        },
        "source": {
            "apkmPath": str(apkm_path.resolve()),
            "apkm": hash_record(apkm),
            "baseApk": hash_record(base_apk),
            "arm64Split": hash_record(arm64_apk),
            "libil2cppPath": BASIS.IL2CPP_PATH,
            "libil2cpp": hash_record(libil2cpp),
            "globalgamemanagersPath": BASIS.GGM_PATH,
            "globalgamemanagers": hash_record(globalgamemanagers),
            "metadata": metadata_source,
            "decryptedRoot": str(decrypted_root.resolve()),
        },
        "metadata": {
            "version": definitions.version,
            "tables": definitions.tables,
            "types": types,
        },
        "native": {
            "methods": methods,
            "icalls": icalls,
            "fieldOffsets": {
                "UICardView._cardRenderer": "0x168",
                "Asset3DRenderer._renderTexture": "0x40",
                "UIAsset3DView.<AssetRenderer>k__BackingField": "0x128",
                "RawImage.m_Texture": "0xd8",
                "Graphic.m_MaterialDirty": "0x69",
            },
        },
        "serialized": {"modelRenderStudio": camera},
        "prefabRt0Alpha": prefab_alpha,
        "derived": {
            "displayChain": [
                "UICardView.CreateRenderer calls CardRenderer..ctor",
                "CardRenderer..ctor tail-calls CardRenderer.CreateRenderTexture",
                "CardRenderer.CreateRenderTexture stores the created RenderTexture at Asset3DRenderer+0x40",
                "Asset3DRenderer.get_RenderTexture returns Asset3DRenderer+0x40",
                "UIAsset3DView.<Initialize>d__71.MoveNext stores CreateRenderer slot 78 at UIAsset3DView+0x128",
                "the same UIAsset3DView+0x128 receiver is used for IAsset3DRenderer.get_RenderTexture slot 2",
                "the returned Texture is passed directly to RawImage.set_texture",
                "RawImage.set_texture stores RawImage.m_Texture+0xd8 and dispatches SetMaterialDirty slot 29",
                "Graphic.Rebuild at CanvasUpdate.PreRender consumes m_MaterialDirty and dispatches UpdateMaterial slot 40",
                "Graphic.UpdateMaterial calls CanvasRenderer.SetTexture",
                "CanvasRenderer.SetTexture resolves and invokes its pinned native icall",
            ],
            "dirtyBoundary": (
                "RawImage.set_texture to Graphic.UpdateMaterial crosses the official "
                "Graphic dirty/CanvasUpdateRegistry rebuild boundary"
            ),
            "rt0AlphaAllowedClasses": [
                "clear-to-zero", "multiply-by-1-srcA", "preserve"
            ],
            "cameraClearColorAlpha": camera["camera"]["clearColor"]["alpha"]["value"],
        },
        "unproved": [
            {
                "id": "same-rt-to-homography-material-setter",
                "status": "unproved",
                "claim": (
                    "object identity of this same RenderTexture through a setter "
                    "on the Homography Material"
                ),
            },
            {
                "id": "card-ui-default-from-rt",
                "status": "unproved",
                "claim": "the runtime role or wiring of Card_UI_Default_FromRT",
            },
            {
                "id": "render-texture-physical-y",
                "status": "unproved",
                "claim": "native RenderTexture physical Y origin/orientation",
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
