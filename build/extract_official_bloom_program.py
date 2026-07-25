#!/usr/bin/env python3
"""Extract byte-backed evidence for the official Bloom shader programs.

The extractor is read-only: it reads the pinned Android APKM and writes JSON to
stdout. Pass-to-program mapping comes from the serialized Shader parsed form;
program hashes come from the exact ShaderProgram entries and decoded SPIR-V.
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
GGM_RESOURCE_PREFIX = "assets/bin/Data/globalgamemanagers.assets.split"
BLOOM_SHADER_NAME = "Hidden/CustomPostEffect/Bloom"
VULKAN_PLATFORM = 18
SPIRV_PROGRAM_TYPE = 25
STAGES = ("progVertex", "progFragment", "progGeometry", "progHull", "progDomain")

sys.path.insert(0, str(ROOT / "build" / "shaderdec"))
import smolv  # noqa: E402

UnityPy.config.FALLBACK_UNITY_VERSION = "2022.3.62f2"
warnings.filterwarnings("ignore", category=Warning, module=r"UnityPy\..*")


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def nested_row(values: list, index: int) -> list:
    value = values[index]
    return value if isinstance(value, list) else [value]


def resource_location(parts: list[tuple[str, bytes]], offset: int, size: int) -> dict:
    base = 0
    for name, data in parts:
        end = base + len(data)
        if base <= offset and offset + size <= end:
            return {"splitPath": name, "splitOffset": offset - base}
        base = end
    raise RuntimeError(f"resource range 0x{offset:x}+0x{size:x} crosses split files")


def read_package(apkm_path: Path) -> tuple[bytes, bytes, bytes, list[tuple[str, bytes]]]:
    apkm = apkm_path.read_bytes()
    with zipfile.ZipFile(io.BytesIO(apkm)) as outer:
        base_apk = outer.read("base.apk")
    with zipfile.ZipFile(io.BytesIO(base_apk)) as apk:
        globalgamemanagers = apk.read(GGM_PATH)
        parts = []
        index = 0
        while True:
            name = f"{GGM_RESOURCE_PREFIX}{index}"
            try:
                parts.append((name, apk.read(name)))
            except KeyError:
                break
            index += 1
    if not parts:
        raise RuntimeError("globalgamemanagers.assets.split* was not found")
    return apkm, base_apk, globalgamemanagers, parts


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
            raise RuntimeError(f"ShaderProgram entry {index} is not contiguous or is out of bounds")
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
            name_bytes = struct.pack(f"<{length - 3}I", *words[cursor + 3 : cursor + length])
            found.append((int(words[cursor + 1]), name_bytes.split(b"\0", 1)[0].decode("utf-8")))
        cursor += length
    if cursor != len(words) or len(found) != 1:
        raise RuntimeError(f"expected one SPIR-V entry point, found {len(found)}")
    return found[0]


def decode_modules(entry: bytes) -> list[dict]:
    decoded = []
    for module_index, (offset, candidate) in enumerate(smolv.find_and_decode(entry)):
        if candidate is None or offset + 24 > len(entry):
            raise RuntimeError("SMOL-V module could not be decoded")
        declared_size = struct.unpack_from("<I", entry, offset + 20)[0]
        if declared_size < 24 or declared_size % 4 or declared_size > len(candidate):
            raise RuntimeError("SMOL-V declared SPIR-V size is invalid")
        module = candidate[:declared_size]
        execution_model, entry_point = spirv_entry_point(module)
        stage = {0: "vertex", 4: "fragment"}.get(execution_model)
        if stage is None:
            raise RuntimeError(f"unexpected Bloom SPIR-V execution model {execution_model}")
        decoded.append(
            {
                "indexInProgramEntry": module_index,
                "smolvOffset": offset,
                "stage": stage,
                "executionModel": execution_model,
                "entryPoint": entry_point,
                "byteSize": len(module),
                "sha256": sha256(module),
                "spvHex": module.hex(),
            }
        )
    if sorted(item["stage"] for item in decoded) != ["fragment", "vertex"]:
        raise RuntimeError("each Bloom program entry must contain one fragment and one vertex module")
    return decoded


def name_map(shader_pass: dict) -> dict[int, str]:
    result = {}
    for name, index in shader_pass.get("m_NameIndices", []):
        index = int(index)
        if index in result and result[index] != name:
            raise RuntimeError(f"duplicate Shader name index {index}")
        result[index] = str(name)
    return result


def named(names: dict[int, str], index: object) -> str:
    key = int(index)
    if key not in names:
        raise RuntimeError(f"Shader name index {key} is missing")
    return names[key]


def binding_evidence(shader_pass: dict, metadata_stage: str) -> dict:
    names = name_map(shader_pass)
    common = shader_pass[metadata_stage].get("m_CommonParameters", {})
    samplers = []
    for item in common.get("m_TextureParams", []):
        encoded = int(item.get("m_Index", 0))
        samplers.append(
            {
                "name": named(names, item["m_NameIndex"]),
                "binding": encoded & 0xFFFFFF,
                "encodedIndex": encoded,
                "samplerIndex": int(item.get("m_SamplerIndex", -1)),
                "dimension": int(item.get("m_Dim", -1)),
                "multisampled": bool(item.get("m_MultiSampled", False)),
            }
        )

    buffers = []
    uniforms = []
    for buffer in common.get("m_ConstantBuffers", []):
        buffer_name = named(names, buffer["m_NameIndex"])
        vectors = []
        for item in buffer.get("m_VectorParams", []):
            row = {
                "name": named(names, item["m_NameIndex"]),
                "kind": "vector",
                "offset": int(item.get("m_Index", -1)),
                "dimension": int(item.get("m_Dim", -1)),
                "arraySize": int(item.get("m_ArraySize", 0)),
            }
            vectors.append(row)
            uniforms.append({"buffer": buffer_name, **row})
        matrices = []
        for item in buffer.get("m_MatrixParams", []):
            row = {
                "name": named(names, item["m_NameIndex"]),
                "kind": "matrix",
                "offset": int(item.get("m_Index", -1)),
                "rowCount": int(item.get("m_RowCount", -1)),
                "arraySize": int(item.get("m_ArraySize", 0)),
            }
            matrices.append(row)
            uniforms.append({"buffer": buffer_name, **row})
        buffers.append(
            {
                "name": buffer_name,
                "size": int(buffer.get("m_Size", -1)),
                "partial": bool(buffer.get("m_IsPartialCB", False)),
                "vectors": vectors,
                "matrices": matrices,
            }
        )
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
            raise RuntimeError("Bloom pass render state is missing a numeric value")
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
                    raise RuntimeError("Bloom program record has no parameter blob index")
                matches.append(
                    {
                        "metadataStage": stage_name,
                        "playerGroup": group_index,
                        "variantIndex": variant_index,
                        "programBlobIndex": int(record["m_BlobIndex"]),
                        "parameterBlobIndex": int(parameter_groups[group_index][variant_index]),
                        "gpuProgramType": int(record["m_GpuProgramType"]),
                        "keywordIndices": [int(value) for value in record.get("m_KeywordIndices", [])],
                        "shaderRequirements": int(record.get("m_ShaderRequirements", 0)),
                    }
                )
    if len(matches) != 1:
        raise RuntimeError(f"expected one Vulkan program record for pass, found {len(matches)}")
    return matches[0]


def extract(apkm_path: Path) -> dict:
    apkm, base_apk, globalgamemanagers, parts = read_package(apkm_path)
    resource = b"".join(data for _, data in parts)
    environment = UnityPy.load(resource)
    files = [item for item in environment.files.values() if hasattr(item, "objects")]
    if len(files) != 1:
        raise RuntimeError(f"expected one serialized resource file, found {len(files)}")
    serialized = files[0]
    target = BLOOM_SHADER_NAME.encode("utf-8")
    candidates = [
        obj
        for obj in serialized.objects.values()
        if obj.type.name == "Shader" and target in bytes(obj.get_raw_data())
    ]
    if len(candidates) != 1:
        raise RuntimeError(f"expected one Bloom Shader asset, found {len(candidates)}")
    obj = candidates[0]
    raw = bytes(obj.get_raw_data())
    shader = obj.read_typetree()
    parsed = shader.get("m_ParsedForm", {})
    if parsed.get("m_Name") != BLOOM_SHADER_NAME:
        raise RuntimeError("Bloom Shader parsed name does not match the byte locator")

    platforms = [int(value) for value in shader.get("platforms", [])]
    if platforms != [VULKAN_PLATFORM]:
        raise RuntimeError(f"unexpected Bloom Shader platforms: {platforms}")
    compressed_blob = bytes(shader.get("compressedBlob", []))
    offsets = nested_row(shader.get("offsets", []), 0)
    compressed_lengths = nested_row(shader.get("compressedLengths", []), 0)
    decompressed_lengths = nested_row(shader.get("decompressedLengths", []), 0)
    if not (len(offsets) == len(compressed_lengths) == len(decompressed_lengths) == 1):
        raise RuntimeError("expected one Vulkan Bloom ShaderProgram segment")
    segment_offset = int(offsets[0])
    compressed_length = int(compressed_lengths[0])
    decompressed_length = int(decompressed_lengths[0])
    compressed = compressed_blob[segment_offset : segment_offset + compressed_length]
    decompressed = lz4.block.decompress(compressed, uncompressed_size=decompressed_length)
    if len(decompressed) != decompressed_length:
        raise RuntimeError("Bloom ShaderProgram decompressed size changed")
    entries = parse_table(decompressed)

    subshaders = parsed.get("m_SubShaders", [])
    if len(subshaders) != 1:
        raise RuntimeError(f"expected one Bloom subshader, found {len(subshaders)}")
    serialized_passes = subshaders[0].get("m_Passes", [])
    passes = []
    used_entries = set()
    module_hashes = []
    program_bytes = []
    for pass_index, shader_pass in enumerate(serialized_passes):
        selection = select_program(shader_pass)
        if selection["keywordIndices"]:
            raise RuntimeError(f"Bloom pass {pass_index} unexpectedly has shader keywords")
        program_entry = entries[selection["programBlobIndex"]]
        parameter_entry = entries[selection["parameterBlobIndex"]]
        modules = decode_modules(bytes.fromhex(program_entry["rawHex"]))
        module_hashes.extend(module["sha256"] for module in modules)
        program_bytes.append(bytes.fromhex(program_entry["rawHex"]))
        used_entries.update((program_entry["index"], parameter_entry["index"]))
        passes.append(
            {
                "pass": pass_index,
                **selection,
                "programMask": int(shader_pass.get("m_ProgramMask", 0)),
                "platforms": [int(value) for value in shader_pass.get("m_Platforms", [])],
                "parameterEntry": parameter_entry,
                "programEntry": program_entry,
                "modules": modules,
                "bindings": binding_evidence(shader_pass, selection["metadataStage"]),
                "renderState": render_state_evidence(shader_pass),
            }
        )
    if used_entries != set(range(len(entries))):
        raise RuntimeError("Bloom pass mapping does not account for every ShaderProgram table entry")

    asset_offset = int(obj.byte_start)
    header = serialized.header
    return {
        "source": {
            "apkm": str(apkm_path.resolve()),
            "apkmSha256": sha256(apkm),
            "baseApkSha256": sha256(base_apk),
            "globalgamemanagersPath": GGM_PATH,
            "globalgamemanagersSha256": sha256(globalgamemanagers),
            "globalgamemanagersResourceSha256": sha256(resource),
            "globalgamemanagersResourceSize": len(resource),
            "resourceParts": [
                {"path": name, "size": len(data), "sha256": sha256(data)} for name, data in parts
            ],
        },
        "serializedFile": {
            "unityVersion": serialized.unity_version,
            "formatVersion": int(header.version),
            "dataOffset": int(header.data_offset),
            "objectCount": len(serialized.objects),
        },
        "shaderAsset": {
            "name": parsed["m_Name"],
            "pathId": int(obj.path_id),
            "type": obj.type.name,
            "classId": int(obj.class_id),
            "resourceOffset": asset_offset,
            "dataRelativeOffset": asset_offset - int(header.data_offset),
            **resource_location(parts, asset_offset, len(raw)),
            "byteSize": len(raw),
            "rawSha256": sha256(raw),
            "rawHex": raw.hex(),
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
            "passCount": len(passes),
            "programEntryCount": len(passes),
            "moduleCount": sum(len(item["modules"]) for item in passes),
            "programSetSha256": sha256(b"".join(program_bytes)),
            "moduleHashes": module_hashes,
            "passes": passes,
        },
        "claims": {
            "asset": "The exact serialized Shader object is located by its unique parsed name and reported with raw bytes.",
            "mapping": "Each pass maps through its Vulkan m_BlobIndex and m_ParameterBlobIndices record to exact table entries.",
            "programs": "Each program entry contains exactly one fragment and one vertex SMOL-V module; hashes cover decoded declared-size SPIR-V bytes.",
            "bindings": "Names, offsets, dimensions, and encoded bindings come from that pass's serialized common-parameter metadata.",
            "renderState": "Blend, depth, cull, and color-mask values come from each serialized Shader pass state.",
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--apkm",
        type=Path,
        default=Path(os.environ.get("PCR_APKM", DEFAULT_APKM)),
        help="Official Android APKM path (default: PCR_APKM or upstream local package)",
    )
    parser.add_argument("--pretty", action="store_true")
    args = parser.parse_args()
    if not args.apkm.is_file():
        parser.error(f"APKM not found: {args.apkm}")
    try:
        evidence = extract(args.apkm)
    except (OSError, RuntimeError, zipfile.BadZipFile) as exc:
        raise SystemExit(f"official Bloom program extraction failed: {exc}") from exc
    json.dump(evidence, sys.stdout, ensure_ascii=True, indent=2 if args.pretty else None, sort_keys=True)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
