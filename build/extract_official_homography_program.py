#!/usr/bin/env python3
"""Extract the official Prerender Homography program and runtime evidence.

The serialized Shader/Material bundles provide the render state, resource
bindings, and Vulkan SPIR-V. The package-matched APKM supplies the libil2cpp
methods which create and upload the 9-float homography arrays. No rendered
image is used as evidence.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import struct
import sys
import warnings
import zipfile

import lz4.block
import UnityPy


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SHADER_ROOT = Path(
    "D:/DevProjectes/ptcgp-tools-master/masterdata_decoder/.output/decrypted/Common/Shader"
)
DEFAULT_APKM = (
    ROOT.parent / "ptcg-apk-parser" / "apks" / "jp.pokemon.pokemontcgp_1.6.0.apkm"
)
BUNDLE_RELATIVE_PATH = Path(
    "Common/CardNew/Prerender/HomographyCard_FromRT.shader_bundles"
)
MATERIAL_RELATIVE_PATH = Path(
    "Common/CardNew/System/Materials/PrerenderHomographyCard.mat_bundles"
)
SHADER_NAME = "Lettuce/Common/CardNew/Prerender/Homography(from RT)"
VULKAN_PLATFORM = 18
SPIRV_PROGRAM_TYPE = 25
STAGES = ("progVertex", "progFragment", "progGeometry", "progHull", "progDomain")

METHODS = {
    "calcHomography": (
        "HomographyShapeCorrector.CalcHomographyMatrix",
        0x43987EC,
        0x439899C,
    ),
    "calcInverse": (
        "HomographyShapeCorrector.CalcInverseMatrix",
        0x4398AAC,
        0x4398C90,
    ),
    "getRotatedKeyPoints": (
        "HomographyShapeCorrector.GetRotatedKeyPoints",
        0x439899C,
        0x4398AAC,
    ),
    "cameraWorldToViewportDefault": (
        "Camera.WorldToViewportPoint default wrapper",
        0x64DDCE0,
        0x64DDCE8,
    ),
    "cameraWorldToViewportInjected": (
        "Camera.WorldToViewportPoint_Injected wrapper",
        0x64DDA74,
        0x64DDB40,
    ),
    "setParameters": (
        "KeepParallaxCardBehaviour.SetHomographyParameters",
        0x441C474,
        0x441C4F8,
    ),
    "constructor": (
        "KeepParallaxCardBehaviour..ctor",
        0x441C4F8,
        0x441C5B4,
    ),
    "floatArraySetter": (
        "SetFloatArray call target",
        0x442CAC4,
        0x442CBD0,
    ),
}

SIGNATURES = {
    "calcHomography": {
        0x4398830: "bl #0x439899c",
        0x439885C: "mov w1, #9",
        0x4398980: "str w8, [x0, #0x40]",
    },
    "calcInverse": {
        0x4398B30: "mov w1, #9",
        0x4398B4C: "bl #0x2f8d4a0",
        0x4398C7C: "str s0, [x0, #0x40]",
    },
    "getRotatedKeyPoints": {
        0x43989CC: "bl #0x64ddce0",
        0x4398A04: "bl #0x64ddce0",
        0x4398A40: "bl #0x64ddce0",
        0x4398A7C: "bl #0x64ddce0",
    },
    "cameraWorldToViewportDefault": {
        0x64DDCE0: "mov w1, #2",
        0x64DDCE4: "b #0x64dda74",
    },
    "cameraWorldToViewportInjected": {
        0x64DDAA4: "adrp x0, #0x1aef000",
        0x64DDAA8: "add x0, x0, #0xb9e",
        0x64DDAAC: "bl #0x2f8d2c8",
        0x64DDAC8: "blr x8",
    },
    "setParameters": {
        0x441C498: "bl #0x43987ec",
        0x441C4A4: "bl #0x4398aac",
        0x441C4BC: "ldr w1, [x19, #0x70]",
        0x441C4C8: "bl #0x442cac4",
        0x441C4DC: "ldr w1, [x19, #0x74]",
        0x441C4F0: "b #0x442cac4",
    },
    "constructor": {
        0x441C514: "ldr x21, [x21, #0x7d0]",
        0x441C51C: "ldr x20, [x20, #0x7d8]",
        0x441C57C: "bl #0x64ebcbc",
        0x441C584: "str w0, [x19, #0x70]",
        0x441C590: "bl #0x64ebcbc",
        0x441C5A4: "str w8, [x19, #0x74]",
    },
    "floatArraySetter": {
        0x442CAD8: "mov x20, x2",
        0x442CADC: "mov w21, w1",
        0x442CB9C: "mov w1, w21",
        0x442CBA0: "mov x2, x20",
        0x442CBA8: "bl #0x64ebfa4",
    },
}

PROPERTY_LITERAL_SLOTS = {
    "dynamicUITexture": 0x6C45C80,
    "homography": 0x6C4A7D0,
    "inverseHomography": 0x6C4A7D8,
}

METADATA_NAMES = (
    "HomographyShapeCorrector",
    "CalcHomographyMatrix",
    "CalcInverseMatrix",
    "KeepParallaxCardBehaviour",
    "SetHomographyParameters",
    "_homographyMatrixId",
    "_invHomographyMatrixId",
)

WORLD_TO_VIEWPORT_ICALL_RVA = 0x1AEFB9E
WORLD_TO_VIEWPORT_ICALL = b"UnityEngine.Camera::WorldToViewportPoint_Injected"
METADATA_FIELDS_PAIR = 11
METADATA_TYPES_PAIR = 19
FIELD_DEFINITION_SIZE = 12
TYPE_DEFINITION_SIZE = 88


def load_basis():
    source = ROOT / "build" / "extract_official_pass_partition.py"
    spec = importlib.util.spec_from_file_location("pcr_official_extract_basis", source)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load extraction basis: {source}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


BASIS = load_basis()

sys.path.insert(0, str(ROOT / "build" / "shaderdec"))
import smolv  # noqa: E402
from unity_parameter_entry import parse_parameter_entry as parse_unity_parameter_entry  # noqa: E402

UnityPy.config.FALLBACK_UNITY_VERSION = "2022.3.62f2"
warnings.filterwarnings("ignore", category=Warning, module=r"UnityPy\..*")


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def raw_record(data: bytes) -> dict:
    return {"byteSize": len(data), "sha256": sha256(data), "rawHex": data.hex()}


def serialized_value(record: object) -> dict:
    if not isinstance(record, dict) or "val" not in record:
        raise RuntimeError("serialized render-state value is missing")
    name = record.get("name")
    return {
        "value": int(record["val"]),
        "property": None if name == "<noninit>" else name,
    }


def blend_target(state: dict, index: int) -> dict:
    blend = state.get(f"rtBlend{index}", {})
    return {
        "srcColor": serialized_value(blend.get("srcBlend")),
        "dstColor": serialized_value(blend.get("destBlend")),
        "srcAlpha": serialized_value(blend.get("srcBlendAlpha")),
        "dstAlpha": serialized_value(blend.get("destBlendAlpha")),
        "colorOp": serialized_value(blend.get("blendOp")),
        "alphaOp": serialized_value(blend.get("blendOpAlpha")),
        "colorMask": serialized_value(blend.get("colMask")),
    }


def render_state(shader_pass: dict) -> dict:
    state = shader_pass.get("m_State", {})
    stencil = state.get("stencilOp", {})
    return {
        "blend": {
            "separate": bool(state.get("rtSeparateBlend", False)),
            "targets": [blend_target(state, index) for index in range(8)],
        },
        "depth": {
            "test": serialized_value(state.get("zTest")),
            "write": serialized_value(state.get("zWrite")),
            "clip": serialized_value(state.get("zClip")),
        },
        "cull": serialized_value(state.get("culling")),
        "stencil": {
            "reference": serialized_value(state.get("stencilRef")),
            "readMask": serialized_value(state.get("stencilReadMask")),
            "writeMask": serialized_value(state.get("stencilWriteMask")),
            "compare": serialized_value(stencil.get("comp")),
            "pass": serialized_value(stencil.get("pass")),
            "fail": serialized_value(stencil.get("fail")),
            "depthFail": serialized_value(stencil.get("zFail")),
        },
        "alphaToMask": serialized_value(state.get("alphaToMask")),
    }


def parse_table(data: bytes) -> list[dict]:
    if len(data) < 4:
        raise RuntimeError("decompressed ShaderProgram table is truncated")
    count = struct.unpack_from("<I", data, 0)[0]
    table_end = 4 + count * 12
    if table_end > len(data):
        raise RuntimeError("ShaderProgram table exceeds decompressed bytes")
    entries = []
    expected_offset = table_end
    for index in range(count):
        offset, length, unknown = struct.unpack_from("<III", data, 4 + index * 12)
        if offset != expected_offset or offset + length > len(data):
            raise RuntimeError(f"ShaderProgram entry {index} is not contiguous")
        raw = data[offset : offset + length]
        entries.append(
            {
                "index": index,
                "offset": offset,
                "length": length,
                "unknownWord": unknown,
                "sha256": sha256(raw),
                "rawHex": raw.hex(),
            }
        )
        expected_offset = offset + length
    if expected_offset != len(data):
        raise RuntimeError("ShaderProgram table has trailing bytes")
    return entries


def u32(data: bytes, offset: int) -> tuple[int, int]:
    return struct.unpack_from("<I", data, offset)[0], offset + 4


def aligned_string(data: bytes, offset: int) -> tuple[str, int]:
    length, offset = u32(data, offset)
    end = offset + length
    if end > len(data):
        raise RuntimeError("parameter string exceeds entry bytes")
    return data[offset:end].decode("utf-8"), (end + 3) & ~3


def parse_parameter_entry(data: bytes, texture_names: set[str]) -> dict:
    try:
        return parse_unity_parameter_entry(data, texture_names)
    except ValueError as exc:
        raise RuntimeError(str(exc)) from exc


def name_indices(shader_pass: dict) -> dict[int, str]:
    return {int(index): str(name) for name, index in shader_pass.get("m_NameIndices", [])}


def common_bindings(shader_pass: dict) -> dict:
    names = name_indices(shader_pass)
    textures = {}
    buffers = {}
    bindings = {}
    for stage_name in STAGES:
        common = shader_pass.get(stage_name, {}).get("m_CommonParameters", {})
        for item in common.get("m_TextureParams", []):
            name = names[int(item["m_NameIndex"])]
            encoded = int(item["m_Index"])
            textures[name] = {
                "name": name,
                "stageMetadata": stage_name,
                "binding": encoded & 0xFFFFFF,
                "encodedIndex": encoded,
                "samplerIndex": int(item.get("m_SamplerIndex", -1)),
                "dimension": int(item.get("m_Dim", -1)),
                "multisampled": bool(item.get("m_MultiSampled", False)),
            }
        for item in common.get("m_ConstantBuffers", []):
            name = names[int(item["m_NameIndex"])]
            vector_fields = []
            for field in item.get("m_VectorParams", []):
                vector_fields.append(
                    {
                        "name": names[int(field["m_NameIndex"])],
                        "offset": int(field["m_Index"]),
                        "arraySize": int(field.get("m_ArraySize", 0)),
                        "scalarType": int(field.get("m_Type", -1)),
                        "dimension": int(field.get("m_Dim", -1)),
                    }
                )
            matrix_fields = []
            for field in item.get("m_MatrixParams", []):
                matrix_fields.append(
                    {
                        "name": names[int(field["m_NameIndex"])],
                        "offset": int(field["m_Index"]),
                        "arraySize": int(field.get("m_ArraySize", 0)),
                        "scalarType": int(field.get("m_Type", -1)),
                        "rowCount": int(field.get("m_RowCount", -1)),
                    }
                )
            buffers[name] = {
                "name": name,
                "stageMetadata": stage_name,
                "size": int(item.get("m_Size", 0)),
                "partial": bool(item.get("m_IsPartialCB", False)),
                "vectorFields": vector_fields,
                "matrixFields": matrix_fields,
            }
        for item in common.get("m_ConstantBufferBindings", []):
            name = names[int(item["m_NameIndex"])]
            bindings[name] = {
                "name": name,
                "stageMetadata": stage_name,
                "encodedIndex": int(item.get("m_Index", 0)),
                "arraySize": int(item.get("m_ArraySize", 0)),
            }
    return {
        "textures": sorted(textures.values(), key=lambda item: item["binding"]),
        "constantBuffers": sorted(buffers.values(), key=lambda item: item["name"]),
        "constantBufferBindings": sorted(bindings.values(), key=lambda item: item["name"]),
    }


def trim_spirv(data: bytes) -> bytes:
    if len(data) < 24 or len(data) % 4:
        raise RuntimeError("decoded module is not aligned SPIR-V")
    words = struct.unpack(f"<{len(data) // 4}I", data)
    if words[0] != smolv.SPIRV_MAGIC:
        raise RuntimeError("decoded module has invalid SPIR-V magic")
    cursor = 5
    end = None
    while cursor < len(words):
        length = words[cursor] >> 16
        opcode = words[cursor] & 0xFFFF
        if length < 1 or cursor + length > len(words):
            break
        if opcode == 56:
            end = cursor + length
        cursor += length
    if end is None:
        raise RuntimeError("SPIR-V module has no OpFunctionEnd")
    return struct.pack(f"<{end}I", *words[:end])


def execution_model(module: bytes) -> int:
    words = struct.unpack(f"<{len(module) // 4}I", module)
    cursor = 5
    found = []
    while cursor < len(words):
        length = words[cursor] >> 16
        opcode = words[cursor] & 0xFFFF
        if length < 1 or cursor + length > len(words):
            raise RuntimeError("invalid SPIR-V instruction stream")
        if opcode == 15:
            found.append(int(words[cursor + 1]))
        cursor += length
    if len(found) != 1:
        raise RuntimeError(f"expected one SPIR-V entry point, found {len(found)}")
    return found[0]


def decode_modules(entry: bytes) -> list[dict]:
    modules = []
    for index, (offset, decoded) in enumerate(smolv.find_and_decode(entry)):
        if decoded is None:
            raise RuntimeError("SMOL-V module could not be decoded")
        module = trim_spirv(decoded)
        model = execution_model(module)
        stage = {0: "vertex", 4: "fragment"}.get(model)
        if stage is None:
            raise RuntimeError(f"unexpected Homography execution model {model}")
        modules.append(
            {
                "indexInProgramEntry": index,
                "smolvOffset": offset,
                "stage": stage,
                "executionModel": model,
                "byteSize": len(module),
                "sha256": sha256(module),
                "spvHex": module.hex(),
            }
        )
    if sorted(item["stage"] for item in modules) != ["fragment", "vertex"]:
        raise RuntimeError("Homography program must contain one vertex and one fragment module")
    return modules


def properties(parsed: dict) -> list[dict]:
    result = []
    for prop in parsed.get("m_PropInfo", {}).get("m_Props", []):
        result.append(
            {
                "name": prop.get("m_Name"),
                "description": prop.get("m_Description"),
                "attributes": list(prop.get("m_Attributes", [])),
                "type": int(prop.get("m_Type", -1)),
                "flags": int(prop.get("m_Flags", 0)),
                "defaultValue": [prop.get(f"m_DefValue[{index}]") for index in range(4)],
                "defaultTexture": {
                    "name": prop.get("m_DefTexture", {}).get("m_DefaultName", ""),
                    "dimension": int(prop.get("m_DefTexture", {}).get("m_TexDim", -1)),
                },
            }
        )
    return result


def material_evidence(decrypted_root: Path) -> dict:
    bundle_path = decrypted_root / MATERIAL_RELATIVE_PATH
    bundle_bytes = bundle_path.read_bytes()
    environment = UnityPy.load(bundle_bytes)
    materials = [obj for obj in environment.objects if obj.type.name == "Material"]
    if len(materials) != 1:
        raise RuntimeError(f"expected one Material, found {len(materials)}")
    material = materials[0]
    material_raw = bytes(material.get_raw_data())
    tree = material.read_typetree()
    shader_pptr = tree.get("m_Shader", {})
    file_id = int(shader_pptr.get("m_FileID", 0))
    serialized = material.assets_file
    if file_id < 1 or file_id > len(serialized.externals):
        raise RuntimeError("PrerenderHomographyCard has an invalid Shader FileID")
    shader_external = serialized.externals[file_id - 1]
    saved = tree.get("m_SavedProperties", {})
    textures = {str(name): value for name, value in saved.get("m_TexEnvs", [])}
    texture = textures.get("_DynamicUITex")
    if not texture:
        raise RuntimeError("PrerenderHomographyCard has no _DynamicUITex slot")
    pointer = texture.get("m_Texture", {})
    return {
        "relativePath": MATERIAL_RELATIVE_PATH.as_posix(),
        "bundle": raw_record(bundle_bytes),
        "materialObject": {
            "pathId": str(material.path_id),
            **raw_record(material_raw),
        },
        "serializedFile": str(serialized.name),
        "name": str(tree.get("m_Name")),
        "shaderPPtr": {
            "fileId": file_id,
            "pathId": str(shader_pptr.get("m_PathID", 0)),
        },
        "shaderExternal": {
            "path": str(shader_external.path),
            "name": str(shader_external.name),
            "guid": bytes(shader_external.guid).hex(),
        },
        "validKeywords": list(tree.get("m_ValidKeywords", [])),
        "invalidKeywords": list(tree.get("m_InvalidKeywords", [])),
        "enableInstancingVariants": bool(tree.get("m_EnableInstancingVariants", False)),
        "customRenderQueue": int(tree.get("m_CustomRenderQueue", -1)),
        "disabledShaderPasses": list(tree.get("disabledShaderPasses", [])),
        "dynamicUITexture": {
            "fileId": int(pointer.get("m_FileID", 0)),
            "pathId": str(pointer.get("m_PathID", 0)),
            "scale": [float(texture["m_Scale"]["x"]), float(texture["m_Scale"]["y"])],
            "offset": [float(texture["m_Offset"]["x"]), float(texture["m_Offset"]["y"])],
        },
    }


def instruction_text(item) -> str:
    return f"{item.mnemonic} {item.op_str}".strip()


def method_evidence(elf, key: str) -> dict:
    name, start, end = METHODS[key]
    decoder = BASIS.Cs(BASIS.CS_ARCH_ARM64, BASIS.CS_MODE_ARM)
    instructions = list(decoder.disasm(elf.range(start, end), start))
    by_address = {item.address: item for item in instructions}
    selected = []
    for address, expected in SIGNATURES[key].items():
        item = by_address.get(address)
        if item is None:
            raise RuntimeError(f"{name} is missing instruction 0x{address:x}")
        actual = instruction_text(item)
        if actual != expected:
            raise RuntimeError(
                f"{name} 0x{address:x}: expected {expected!r}, got {actual!r}"
            )
        raw = bytes(item.bytes)
        selected.append(
            {
                "address": f"0x{address:x}",
                "text": actual,
                "bytesHex": raw.hex(),
                "sha256": sha256(raw),
            }
        )
    body = elf.range(start, end)
    return {
        "name": name,
        "rvaStart": f"0x{start:x}",
        "rvaEndExclusive": f"0x{end:x}",
        "byteSize": len(body),
        "sha256": sha256(body),
        "rawHex": body.hex(),
        "selectedInstructions": selected,
    }


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
        "version": version,
        "stringHeapFileOffset": string_offset,
        "stringHeapByteSize": string_size,
        "stringHeapSha256": sha256(heap),
        "names": records,
    }


def metadata_model_render_studio_evidence(metadata: bytes) -> dict:
    string_offset, string_size = struct.unpack_from("<II", metadata, 24)
    string_limit = string_offset + string_size

    def string(index: int) -> str:
        start = string_offset + index
        end = metadata.find(b"\0", start, string_limit)
        if start < string_offset or start >= string_limit or end < 0:
            raise RuntimeError(f"invalid metadata string index {index}")
        return metadata[start:end].decode("utf-8")

    fields_offset, fields_size = struct.unpack_from(
        "<II", metadata, 8 + METADATA_FIELDS_PAIR * 8
    )
    types_offset, types_size = struct.unpack_from(
        "<II", metadata, 8 + METADATA_TYPES_PAIR * 8
    )
    if fields_size % FIELD_DEFINITION_SIZE or types_size % TYPE_DEFINITION_SIZE:
        raise RuntimeError("metadata field/type table alignment changed")

    matches = []
    for index in range(types_size // TYPE_DEFINITION_SIZE):
        offset = types_offset + index * TYPE_DEFINITION_SIZE
        raw = metadata[offset:offset + TYPE_DEFINITION_SIZE]
        values = struct.unpack_from("<16I", raw)
        if (string(values[0]), string(values[1])) == (
            "ModelRenderStudio", "Lettuce.Infrastructure.Asset3D.Core.Rendering"
        ):
            matches.append((index, offset, raw, values, struct.unpack_from("<8H", raw, 64)))
    if len(matches) != 1:
        raise RuntimeError(f"ModelRenderStudio metadata type occurs {len(matches)} times")

    index, offset, raw, values, counts = matches[0]
    field_rows = []
    for relative_index in range(counts[2]):
        field_index = values[8] + relative_index
        field_offset = fields_offset + field_index * FIELD_DEFINITION_SIZE
        field_raw = metadata[field_offset:field_offset + FIELD_DEFINITION_SIZE]
        name_index, type_index, token = struct.unpack("<III", field_raw)
        field_rows.append({
            "name": string(name_index),
            "fieldDefinitionIndex": field_index,
            "typeIndex": type_index,
            "token": f"0x{token:08x}",
            "recordFileOffset": field_offset,
            "record": raw_record(field_raw),
        })
    expected = [
        "_camera", "_root", "_keyPointsRoot", "_keyPointLeftDown",
        "_keyPointRightDown", "_keyPointLeftUp", "_keyPointRightUp",
        "_rotatedKeyPoints", "_renderObject", "_shouldUpdateRotateKeyPoints",
    ]
    if [row["name"] for row in field_rows] != expected:
        raise RuntimeError("ModelRenderStudio metadata field order changed")
    return {
        "namespace": "Lettuce.Infrastructure.Asset3D.Core.Rendering",
        "name": "ModelRenderStudio",
        "typeDefinitionIndex": index,
        "recordFileOffset": offset,
        "record": raw_record(raw),
        "fieldOrder": field_rows,
    }


def projected_point_order_evidence(elf, model_render_studio: dict) -> list[dict]:
    method = method_evidence(elf, "getRotatedKeyPoints")
    decoder = BASIS.Cs(BASIS.CS_ARCH_ARM64, BASIS.CS_MODE_ARM)
    instructions = {
        item.address: instruction_text(item)
        for item in decoder.disasm(
            bytes.fromhex(method["rawHex"]), int(method["rvaStart"], 16)
        )
    }
    specs = [
        ("_keyPointLeftDown", 0x38, 0x20, 0x43989A8, 0x43989DC),
        ("_keyPointRightDown", 0x40, 0x28, 0x43989E0, 0x4398A18),
        ("_keyPointLeftUp", 0x48, 0x30, 0x4398A1C, 0x4398A54),
        ("_keyPointRightUp", 0x50, 0x38, 0x4398A58, 0x4398A90),
    ]
    field_names = [row["name"] for row in model_render_studio["fieldOrder"]]
    rows = []
    for index, (field, instance_offset, array_offset, load_rva, store_rva) in enumerate(specs):
        if field_names.index(field) != index + 3:
            raise RuntimeError(f"ModelRenderStudio field order changed for {field}")
        load = instructions.get(load_rva)
        store = instructions.get(store_rva)
        base = "x0" if index == 0 else "x19"
        expected_load = f"ldr x0, [{base}, #0x{instance_offset:x}]"
        expected_store = f"stp s0, s1, [x21, #0x{array_offset:x}]"
        if load != expected_load or store != expected_store:
            raise RuntimeError(
                f"GetRotatedKeyPoints mapping changed for {field}: {load!r}, {store!r}"
            )
        rows.append({
            "index": index,
            "field": field,
            "instanceOffset": instance_offset,
            "arrayDataOffset": array_offset,
            "loadInstruction": {"rva": f"0x{load_rva:x}", "text": load},
            "storeInstruction": {"rva": f"0x{store_rva:x}", "text": store},
        })
    return rows


def native_string_evidence(elf, rva: int, expected: bytes) -> dict:
    raw = elf.range(rva, rva + len(expected))
    if raw != expected:
        raise RuntimeError(
            f"native string 0x{rva:x} expected {expected!r}, got {raw!r}"
        )
    return {
        "rva": f"0x{rva:x}",
        "value": raw.decode("utf-8"),
        **raw_record(raw),
    }


def apkm_evidence(apkm_path: Path) -> dict:
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
    literals = BASIS.MetadataLiterals(metadata)
    relocations = elf.relocations()
    property_literals = {
        key: BASIS.literal_slot_evidence(relocations, literals, slot)
        for key, slot in PROPERTY_LITERAL_SLOTS.items()
    }
    expected_literals = {
        "dynamicUITexture": "_DynamicUITex",
        "homography": "_HomographyMatrix",
        "inverseHomography": "_InvHomographyMatrix",
    }
    for key, expected in expected_literals.items():
        if property_literals[key]["value"] != expected:
            raise RuntimeError(
                f"property literal {key} expected {expected!r}, got {property_literals[key]['value']!r}"
            )

    world_to_viewport_icall = native_string_evidence(
        elf, WORLD_TO_VIEWPORT_ICALL_RVA, WORLD_TO_VIEWPORT_ICALL
    )
    model_render_studio = metadata_model_render_studio_evidence(metadata)

    return {
        "source": {
            "apkm": str(apkm_path.resolve()),
            "apkmSha256": sha256(apkm),
            "baseApkSha256": sha256(base_apk),
            "arm64SplitSha256": sha256(arm64_apk),
            "libil2cppPath": BASIS.IL2CPP_PATH,
            "libil2cppByteSize": len(libil2cpp),
            "libil2cppSha256": sha256(libil2cpp),
            "metadata": metadata_source,
        },
        "metadataNames": metadata_name_evidence(metadata),
        "modelRenderStudio": model_render_studio,
        "propertyLiterals": property_literals,
        "methods": {key: method_evidence(elf, key) for key in METHODS},
        "coordinateContract": {
            "coordinateSpace": "UnityEngine.Camera.WorldToViewportPoint",
            "projectedPointCount": 4,
            "getRotatedKeyPointsRva": "0x439899c",
            "cameraDefaultWrapperRva": "0x64ddce0",
            "cameraInjectedWrapperRva": "0x64dda74",
            "defaultStereoEyeArgument": 2,
            "nativeIcall": world_to_viewport_icall,
            "projectedPointOrder": projected_point_order_evidence(
                elf, model_render_studio
            ),
        },
        "uploadContract": {
            "homographyLength": 9,
            "inverseHomographyLength": 9,
            "homographyPropertyIdFieldOffset": 0x70,
            "inverseHomographyPropertyIdFieldOffset": 0x74,
            "homographyProducerRva": "0x43987ec",
            "inverseProducerRva": "0x4398aac",
            "floatArraySetterRva": "0x442cac4",
        },
    }


def extract(shader_root: Path, apkm_path: Path) -> dict:
    bundle_path = shader_root / BUNDLE_RELATIVE_PATH
    bundle_bytes = bundle_path.read_bytes()
    environment = UnityPy.load(bundle_bytes)
    shader_objects = [obj for obj in environment.objects if obj.type.name == "Shader"]
    if len(shader_objects) != 1:
        raise RuntimeError(f"expected one Shader object, found {len(shader_objects)}")
    shader_object = shader_objects[0]
    shader_raw = bytes(shader_object.get_raw_data())
    shader = shader_object.read_typetree()
    parsed = shader.get("m_ParsedForm", {})
    if parsed.get("m_Name") != SHADER_NAME:
        raise RuntimeError(f"unexpected shader name {parsed.get('m_Name')!r}")
    if shader.get("platforms") != [VULKAN_PLATFORM]:
        raise RuntimeError(f"unexpected shader platforms {shader.get('platforms')}")

    subshaders = parsed.get("m_SubShaders", [])
    if len(subshaders) != 1 or len(subshaders[0].get("m_Passes", [])) != 1:
        raise RuntimeError("Homography shader must contain one subshader and one pass")
    shader_pass = subshaders[0]["m_Passes"][0]
    keyword_names = list(parsed.get("m_KeywordNames", []))
    candidates = []
    compiled_variants = []
    for stage_name in STAGES:
        stage = shader_pass.get(stage_name, {})
        player_groups = stage.get("m_PlayerSubPrograms", [])
        parameter_groups = stage.get("m_ParameterBlobIndices", [])
        for group_index, players in enumerate(player_groups):
            parameters = parameter_groups[group_index] if group_index < len(parameter_groups) else []
            for variant_index, player in enumerate(players or []):
                if variant_index >= len(parameters):
                    raise RuntimeError("compiled variant has no parameter entry")
                indices = [int(index) for index in player.get("m_KeywordIndices", [])]
                row = {
                    "stageMetadata": stage_name,
                    "groupIndex": group_index,
                    "variantIndex": variant_index,
                    "keywordIndices": indices,
                    "keywords": [keyword_names[index] for index in indices],
                    "parameterBlobIndex": int(parameters[variant_index]),
                    "programBlobIndex": int(player.get("m_BlobIndex")),
                    "gpuProgramType": int(player.get("m_GpuProgramType")),
                    "shaderRequirements": int(player.get("m_ShaderRequirements")),
                }
                compiled_variants.append(row)
                if not indices:
                    candidates.append(row)
    if len(candidates) != 1:
        raise RuntimeError(f"empty keyword set resolved {len(candidates)} variants")
    selected = candidates[0]
    if selected["gpuProgramType"] != SPIRV_PROGRAM_TYPE:
        raise RuntimeError("selected program is not Vulkan SPIR-V")

    compressed_blob = bytes(shader.get("compressedBlob", []))
    offsets = shader["offsets"][0]
    compressed_lengths = shader["compressedLengths"][0]
    decompressed_lengths = shader["decompressedLengths"][0]
    if len(compressed_lengths) != 1 or len(decompressed_lengths) != 1:
        raise RuntimeError("expected one Vulkan compressed program block")
    offset = int(offsets[0] if isinstance(offsets, list) else offsets)
    compressed = compressed_blob[offset : offset + int(compressed_lengths[0])]
    decompressed = lz4.block.decompress(
        compressed, uncompressed_size=int(decompressed_lengths[0])
    )
    entries = parse_table(decompressed)

    parameter_entry = entries[selected["parameterBlobIndex"]]
    texture_names = {row["name"] for row in properties(parsed) if row["type"] == 4}
    parameters = parse_parameter_entry(
        bytes.fromhex(parameter_entry["rawHex"]), texture_names
    )
    common = common_bindings(shader_pass)
    program_entry = entries[selected["programBlobIndex"]]
    modules = decode_modules(bytes.fromhex(program_entry["rawHex"]))
    tags = dict(subshaders[0].get("m_Tags", {}).get("tags", []))
    decrypted_root = shader_root.parents[1]

    return {
        "schemaVersion": 1,
        "source": {
            "shaderRoot": str(shader_root),
            "bundleRelativePath": BUNDLE_RELATIVE_PATH.as_posix(),
            "bundle": raw_record(bundle_bytes),
            "shaderObject": {
                "pathId": str(shader_object.path_id),
                **raw_record(shader_raw),
            },
            "shaderSerializedFile": str(shader_object.assets_file.name),
        },
        "shader": {
            "name": parsed["m_Name"],
            "properties": properties(parsed),
            "keywordNames": keyword_names,
            "keywordFlags": [int(flag) for flag in parsed.get("m_KeywordFlags", [])],
            "tags": tags,
            "subshaderCount": len(subshaders),
            "passCount": len(subshaders[0].get("m_Passes", [])),
            "pass": {
                "name": shader_pass.get("m_Name", ""),
                "type": int(shader_pass.get("m_Type", -1)),
                "programMask": int(shader_pass.get("m_ProgramMask", 0)),
                "tags": dict(shader_pass.get("m_Tags", {}).get("tags", [])),
                "renderState": render_state(shader_pass),
            },
        },
        "programBlock": {
            "platform": VULKAN_PLATFORM,
            "compressed": raw_record(compressed),
            "decompressed": raw_record(decompressed),
            "entries": entries,
        },
        "compiledVariants": compiled_variants,
        "selectedVariant": selected,
        "bindings": {
            "common": common,
            "parameterEntry": parameters,
        },
        "modules": modules,
        "officialMaterial": material_evidence(decrypted_root),
        "apkm": apkm_evidence(apkm_path),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--shaders",
        type=Path,
        default=Path(DEFAULT_SHADER_ROOT),
        help="decrypted Common/Shader directory",
    )
    parser.add_argument(
        "--apkm",
        type=Path,
        default=Path(DEFAULT_APKM),
        help="package-matched APKM",
    )
    args = parser.parse_args()
    if not args.shaders.is_dir():
        parser.error(f"shader root not found: {args.shaders}")
    if not args.apkm.is_file():
        parser.error(f"APKM not found: {args.apkm}")
    result = extract(args.shaders.resolve(), args.apkm.resolve())
    json.dump(result, sys.stdout, ensure_ascii=True, indent=2)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
