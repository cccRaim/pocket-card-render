#!/usr/bin/env python3
"""Extract the official FinalBlit resource chain and Vulkan program from the APKM.

The chain is resolved from ResourceManager PathID 13, through the external Blit
Material and its external Shader PPtr. All hashes cover bytes read from the same
pinned package; no decrypted side-channel assets are used.
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
from pathlib import Path
import struct
import sys
import warnings
import zipfile

try:
    import UnityPy
except ImportError as exc:  # pragma: no cover
    raise SystemExit("UnityPy is required: python -m pip install UnityPy") from exc

try:
    import lz4.block
except ImportError as exc:  # pragma: no cover
    raise SystemExit("lz4 is required: python -m pip install lz4") from exc


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_APKM = ROOT.parent / "ptcg-apk-parser" / "apks" / "jp.pokemon.pokemontcgp_1.6.0.apkm"
GGM_PATH = "assets/bin/Data/globalgamemanagers"
RESOURCE_MANAGER_PATH_ID = 13
MATERIAL_KEY = "lettuce.graphics.rendering/materials/blit"
SHADER_KEY = "lettuce.graphics.rendering/shaders/blit"
MATERIAL_NAME = "Blit"
SHADER_NAME = "Rendering/CustomRenderer/Blit"
VULKAN_PLATFORM = 18
SPIRV_PROGRAM_TYPE = 25
STAGES = ("progVertex", "progFragment", "progGeometry", "progHull", "progDomain")

sys.path.insert(0, str(ROOT / "build" / "shaderdec"))
import smolv  # noqa: E402

UnityPy.config.FALLBACK_UNITY_VERSION = "2022.3.62f2"
warnings.filterwarnings("ignore", category=Warning, module=r"UnityPy\..*")


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def serialized_file(data: bytes):
    environment = UnityPy.load(data)
    files = [item for item in environment.files.values() if hasattr(item, "objects")]
    if len(files) != 1:
        raise RuntimeError(f"expected one serialized file, found {len(files)}")
    return files[0]


def object_evidence(obj) -> dict:
    raw = bytes(obj.get_raw_data())
    return {
        "pathId": int(obj.path_id),
        "type": obj.type.name,
        "classId": int(obj.class_id),
        "byteOffset": int(obj.byte_start),
        "byteSize": len(raw),
        "rawSha256": sha256(raw),
        "rawHex": raw.hex(),
    }


def file_evidence(apk_path: str, data: bytes) -> dict:
    return {
        "apkPath": apk_path,
        "byteSize": len(data),
        "sha256": sha256(data),
        "rawHex": data.hex(),
    }


def exact_container_pointer(tree: dict, key: str) -> dict:
    matches = [value for name, value in tree.get("m_Container", []) if name == key]
    if len(matches) != 1:
        raise RuntimeError(f"ResourceManager key {key!r} resolved {len(matches)} times")
    return {"fileId": int(matches[0]["m_FileID"]), "pathId": int(matches[0]["m_PathID"])}


def external_evidence(serialized, file_id: int) -> dict:
    if file_id <= 0 or file_id > len(serialized.externals):
        raise RuntimeError(f"external FileID {file_id} is out of range")
    external = serialized.externals[file_id - 1]
    return {
        "fileId": file_id,
        "path": str(external.path),
        "name": str(external.name),
        "guid": bytes(external.guid).hex(),
    }


def parse_table(data: bytes) -> list[dict]:
    if len(data) < 4:
        raise RuntimeError("decompressed ShaderProgram table is truncated")
    count = struct.unpack_from("<I", data, 0)[0]
    table_end = 4 + count * 12
    if table_end > len(data):
        raise RuntimeError("ShaderProgram entry table exceeds decompressed bytes")
    entries = []
    expected_offset = table_end
    for index in range(count):
        offset, length, unknown = struct.unpack_from("<III", data, 4 + index * 12)
        if offset != expected_offset or offset + length > len(data):
            raise RuntimeError(f"ShaderProgram entry {index} is not contiguous")
        raw = data[offset : offset + length]
        entries.append({
            "index": index,
            "offset": offset,
            "length": length,
            "unknownWord": unknown,
            "sha256": sha256(raw),
            "rawHex": raw.hex(),
        })
        expected_offset = offset + length
    if expected_offset != len(data):
        raise RuntimeError("ShaderProgram table has trailing bytes")
    return entries


def spirv_entry_point(module: bytes) -> tuple[int, str]:
    if len(module) < 24 or len(module) % 4 or struct.unpack_from("<I", module, 0)[0] != smolv.SPIRV_MAGIC:
        raise RuntimeError("decoded module is not SPIR-V")
    words = struct.unpack(f"<{len(module) // 4}I", module)
    cursor = 5
    found = []
    while cursor < len(words):
        length = words[cursor] >> 16
        opcode = words[cursor] & 0xFFFF
        if length < 1 or cursor + length > len(words):
            raise RuntimeError("invalid SPIR-V instruction stream")
        if opcode == 15:
            encoded = struct.pack(f"<{length - 3}I", *words[cursor + 3 : cursor + length])
            found.append((int(words[cursor + 1]), encoded.split(b"\0", 1)[0].decode("utf-8")))
        cursor += length
    if cursor != len(words) or len(found) != 1:
        raise RuntimeError(f"expected one SPIR-V entry point, found {len(found)}")
    return found[0]


def decode_modules(entry: bytes) -> list[dict]:
    decoded = []
    for index, (offset, candidate) in enumerate(smolv.find_and_decode(entry)):
        if candidate is None or offset + 24 > len(entry):
            raise RuntimeError("SMOL-V module could not be decoded")
        declared_size = struct.unpack_from("<I", entry, offset + 20)[0]
        if declared_size < 24 or declared_size % 4 or declared_size > len(candidate):
            raise RuntimeError("SMOL-V declared SPIR-V size is invalid")
        module = candidate[:declared_size]
        execution_model, entry_point = spirv_entry_point(module)
        stage = {0: "vertex", 4: "fragment"}.get(execution_model)
        if stage is None:
            raise RuntimeError(f"unexpected FinalBlit execution model {execution_model}")
        decoded.append({
            "indexInProgramEntry": index,
            "smolvOffset": offset,
            "stage": stage,
            "executionModel": execution_model,
            "entryPoint": entry_point,
            "byteSize": len(module),
            "sha256": sha256(module),
            "spvHex": module.hex(),
        })
    if sorted(item["stage"] for item in decoded) != ["fragment", "vertex"]:
        raise RuntimeError("FinalBlit program must contain one vertex and one fragment module")
    return decoded


def name_map(shader_pass: dict) -> dict[int, str]:
    result = {}
    for name, index in shader_pass.get("m_NameIndices", []):
        index = int(index)
        if index in result and result[index] != name:
            raise RuntimeError(f"duplicate Shader name index {index}")
        result[index] = str(name)
    return result


def binding_evidence(shader_pass: dict, metadata_stage: str) -> dict:
    names = name_map(shader_pass)

    def named(index: object) -> str:
        index = int(index)
        if index not in names:
            raise RuntimeError(f"Shader name index {index} is missing")
        return names[index]

    common = shader_pass[metadata_stage].get("m_CommonParameters", {})
    samplers = []
    for item in common.get("m_TextureParams", []):
        encoded = int(item.get("m_Index", 0))
        samplers.append({
            "name": named(item["m_NameIndex"]),
            "binding": encoded & 0xFFFFFF,
            "encodedIndex": encoded,
            "samplerIndex": int(item.get("m_SamplerIndex", -1)),
            "dimension": int(item.get("m_Dim", -1)),
            "multisampled": bool(item.get("m_MultiSampled", False)),
        })
    buffers = []
    uniforms = []
    for buffer in common.get("m_ConstantBuffers", []):
        vectors = []
        for item in buffer.get("m_VectorParams", []):
            row = {
                "name": named(item["m_NameIndex"]),
                "kind": "vector",
                "offset": int(item.get("m_Index", -1)),
                "dimension": int(item.get("m_Dim", -1)),
                "arraySize": int(item.get("m_ArraySize", 0)),
            }
            vectors.append(row)
            uniforms.append({"buffer": named(buffer["m_NameIndex"]), **row})
        buffers.append({
            "name": named(buffer["m_NameIndex"]),
            "size": int(buffer.get("m_Size", -1)),
            "partial": bool(buffer.get("m_IsPartialCB", False)),
            "vectors": vectors,
            "matrices": [],
        })
    return {
        "samplers": samplers,
        "uniforms": uniforms,
        "constantBuffers": buffers,
        "serializedSamplerStates": common.get("m_Samplers", []),
    }


def render_state_evidence(shader_pass: dict) -> dict:
    state = shader_pass.get("m_State", {})
    blend = state.get("rtBlend0", {})

    def value(record: object) -> int:
        if not isinstance(record, dict) or "val" not in record:
            raise RuntimeError("FinalBlit render state is missing a numeric value")
        return int(record["val"])

    return {
        "srcBlend": value(blend.get("srcBlend")),
        "destBlend": value(blend.get("destBlend")),
        "srcBlendAlpha": value(blend.get("srcBlendAlpha")),
        "destBlendAlpha": value(blend.get("destBlendAlpha")),
        "blendOp": value(blend.get("blendOp")),
        "blendOpAlpha": value(blend.get("blendOpAlpha")),
        "colorMask": value(blend.get("colMask")),
        "separateBlend": bool(state.get("rtSeparateBlend", False)),
        "zTest": value(state.get("zTest")),
        "zWrite": value(state.get("zWrite")),
        "cull": value(state.get("culling")),
    }


def select_program(shader_pass: dict) -> dict:
    matches = []
    for stage_name in STAGES:
        stage = shader_pass.get(stage_name, {})
        groups = stage.get("m_PlayerSubPrograms", [])
        parameter_groups = stage.get("m_ParameterBlobIndices", [])
        for group_index, records in enumerate(groups):
            for variant_index, record in enumerate(records or []):
                if int(record.get("m_GpuProgramType", -1)) != SPIRV_PROGRAM_TYPE:
                    continue
                if group_index >= len(parameter_groups) or variant_index >= len(parameter_groups[group_index]):
                    raise RuntimeError("FinalBlit program has no parameter blob index")
                matches.append({
                    "metadataStage": stage_name,
                    "playerGroup": group_index,
                    "variantIndex": variant_index,
                    "programBlobIndex": int(record["m_BlobIndex"]),
                    "parameterBlobIndex": int(parameter_groups[group_index][variant_index]),
                    "gpuProgramType": int(record["m_GpuProgramType"]),
                    "keywordIndices": [int(value) for value in record.get("m_KeywordIndices", [])],
                    "shaderRequirements": int(record.get("m_ShaderRequirements", 0)),
                })
    if len(matches) != 1:
        raise RuntimeError(f"expected one Vulkan FinalBlit program, found {len(matches)}")
    return matches[0]


def extract(apkm_path: Path) -> dict:
    apkm = apkm_path.read_bytes()
    with zipfile.ZipFile(io.BytesIO(apkm)) as outer:
        base_apk = outer.read("base.apk")
    with zipfile.ZipFile(io.BytesIO(base_apk)) as apk:
        ggm = apk.read(GGM_PATH)
        ggm_file = serialized_file(ggm)
        if RESOURCE_MANAGER_PATH_ID not in ggm_file.objects:
            raise RuntimeError(f"ResourceManager PathID {RESOURCE_MANAGER_PATH_ID} is missing")
        resource_manager = ggm_file.objects[RESOURCE_MANAGER_PATH_ID]
        if resource_manager.type.name != "ResourceManager":
            raise RuntimeError(f"PathID {RESOURCE_MANAGER_PATH_ID} is {resource_manager.type.name}")
        resource_tree = resource_manager.read_typetree()
        material_pptr = exact_container_pointer(resource_tree, MATERIAL_KEY)
        shader_pptr = exact_container_pointer(resource_tree, SHADER_KEY)
        material_external = external_evidence(ggm_file, material_pptr["fileId"])
        shader_external = external_evidence(ggm_file, shader_pptr["fileId"])

        material_apk_path = f"assets/bin/Data/{material_external['path']}"
        material_bytes = apk.read(material_apk_path)
        material_file = serialized_file(material_bytes)
        material_obj = material_file.objects.get(material_pptr["pathId"])
        if material_obj is None or material_obj.type.name != "Material":
            raise RuntimeError("ResourceManager Blit Material PPtr does not resolve to a Material")
        material = material_obj.read_typetree()
        if material.get("m_Name") != MATERIAL_NAME:
            raise RuntimeError(f"unexpected FinalBlit Material name: {material.get('m_Name')!r}")
        material_shader_pptr = {
            "fileId": int(material["m_Shader"]["m_FileID"]),
            "pathId": int(material["m_Shader"]["m_PathID"]),
        }
        material_shader_external = external_evidence(material_file, material_shader_pptr["fileId"])
        if material_shader_external["path"] != shader_external["path"] or material_shader_pptr["pathId"] != shader_pptr["pathId"]:
            raise RuntimeError("Material shader PPtr disagrees with ResourceManager shader entry")

        shader_apk_path = f"assets/bin/Data/{material_shader_external['path']}"
        shader_bytes = apk.read(shader_apk_path)
        shader_file = serialized_file(shader_bytes)
        shader_obj = shader_file.objects.get(material_shader_pptr["pathId"])
        if shader_obj is None or shader_obj.type.name != "Shader":
            raise RuntimeError("Blit Material shader PPtr does not resolve to a Shader")
        shader = shader_obj.read_typetree()

    parsed = shader.get("m_ParsedForm", {})
    if parsed.get("m_Name") != SHADER_NAME:
        raise RuntimeError(f"unexpected FinalBlit Shader name: {parsed.get('m_Name')!r}")
    platforms = [int(value) for value in shader.get("platforms", [])]
    if platforms != [VULKAN_PLATFORM]:
        raise RuntimeError(f"unexpected FinalBlit platforms: {platforms}")
    offsets = shader.get("offsets", [[]])[0]
    compressed_lengths = shader.get("compressedLengths", [[]])[0]
    decompressed_lengths = shader.get("decompressedLengths", [[]])[0]
    if not (len(offsets) == len(compressed_lengths) == len(decompressed_lengths) == 1):
        raise RuntimeError("expected one Vulkan FinalBlit ShaderProgram segment")
    blob = bytes(shader.get("compressedBlob", []))
    offset = int(offsets[0])
    compressed = blob[offset : offset + int(compressed_lengths[0])]
    decompressed = lz4.block.decompress(compressed, uncompressed_size=int(decompressed_lengths[0]))
    if len(decompressed) != int(decompressed_lengths[0]):
        raise RuntimeError("FinalBlit ShaderProgram decompressed size changed")
    entries = parse_table(decompressed)

    subshaders = parsed.get("m_SubShaders", [])
    if len(subshaders) != 1 or len(subshaders[0].get("m_Passes", [])) != 1:
        raise RuntimeError("FinalBlit must contain exactly one subshader and one pass")
    shader_pass = subshaders[0]["m_Passes"][0]
    selection = select_program(shader_pass)
    if selection["keywordIndices"]:
        raise RuntimeError("FinalBlit unexpectedly has shader keywords")
    if {selection["parameterBlobIndex"], selection["programBlobIndex"]} != set(range(len(entries))):
        raise RuntimeError("FinalBlit pass mapping does not account for every table entry")
    parameter_entry = entries[selection["parameterBlobIndex"]]
    program_entry = entries[selection["programBlobIndex"]]
    modules = decode_modules(bytes.fromhex(program_entry["rawHex"]))

    return {
        "source": {
            "apkm": str(apkm_path.resolve()),
            "apkmSha256": sha256(apkm),
            "baseApkSha256": sha256(base_apk),
            "globalgamemanagersPath": GGM_PATH,
            "globalgamemanagersSha256": sha256(ggm),
        },
        "resourceChain": {
            "resourceManager": {
                **object_evidence(resource_manager),
                "material": {"key": MATERIAL_KEY, "pptr": material_pptr, "external": material_external},
                "shader": {"key": SHADER_KEY, "pptr": shader_pptr, "external": shader_external},
            },
            "materialFile": {**material_external, **file_evidence(material_apk_path, material_bytes)},
            "materialAsset": {
                "name": material["m_Name"],
                **object_evidence(material_obj),
                "shaderPPtr": material_shader_pptr,
                "shaderExternal": material_shader_external,
            },
            "shaderFile": {**material_shader_external, **file_evidence(shader_apk_path, shader_bytes)},
            "shaderAsset": {"name": parsed["m_Name"], **object_evidence(shader_obj)},
        },
        "shaderProgram": {
            "platforms": platforms,
            "gpuProgramType": SPIRV_PROGRAM_TYPE,
            "compressedLength": len(compressed),
            "compressedSha256": sha256(compressed),
            "compressedHex": compressed.hex(),
            "decompressedLength": len(decompressed),
            "decompressedSha256": sha256(decompressed),
            "decompressedHex": decompressed.hex(),
            "blobEntryCount": len(entries),
            "subshaderCount": len(subshaders),
            "passCount": 1,
            "pass": {
                **selection,
                "programMask": int(shader_pass.get("m_ProgramMask", 0)),
                "platforms": [int(value) for value in shader_pass.get("m_Platforms", [])],
                "parameterEntry": parameter_entry,
                "programEntry": program_entry,
                "modules": modules,
                "bindings": binding_evidence(shader_pass, selection["metadataStage"]),
                "renderState": render_state_evidence(shader_pass),
            },
        },
        "claims": {
            "chain": "ResourceManager PathID 13 resolves the external Blit Material; its external Shader PPtr resolves Rendering/CustomRenderer/Blit.",
            "program": "The sole Vulkan player program maps through serialized blob indices and contains one decoded vertex and fragment SPIR-V module.",
            "state": "Bindings and render state are decoded from the same serialized Shader pass.",
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apkm", type=Path, default=Path(os.environ.get("PCR_APKM", DEFAULT_APKM)))
    parser.add_argument("--pretty", action="store_true")
    args = parser.parse_args()
    if not args.apkm.is_file():
        parser.error(f"APKM not found: {args.apkm}")
    try:
        evidence = extract(args.apkm)
    except (KeyError, OSError, RuntimeError, zipfile.BadZipFile) as exc:
        raise SystemExit(f"official FinalBlit extraction failed: {exc}") from exc
    json.dump(evidence, sys.stdout, ensure_ascii=True, indent=2 if args.pretty else None, sort_keys=True)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
