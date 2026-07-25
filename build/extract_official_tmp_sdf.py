#!/usr/bin/env python3
"""Extract the official card TMP SDF Vulkan program and serialized bindings."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import struct
import sys
import warnings

import lz4.block
import UnityPy

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DECRYPTED = Path(
    os.environ.get(
        "PCR_DECRYPTED_ROOT",
        "D:/DevProjectes/ptcgp-tools-master/masterdata_decoder/.output/decrypted",
    )
)
SHADER_NAME = "Lettuce/Common/Card/TextMeshPro/Distance Field (to RT)"
SHADER_SUFFIX = "TextMeshPro/Distance Field (to RT)"
VULKAN_PLATFORM = 18
SPIRV_PROGRAM_TYPE = 25

sys.path.insert(0, str(ROOT / "build" / "shaderdec"))
import smolv  # noqa: E402
from extract_variant_bindings import common_textures, parse_parameter_blob  # noqa: E402

UnityPy.config.FALLBACK_UNITY_VERSION = "2022.3.62f2"
warnings.filterwarnings("ignore")


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def nested(values: list, index: int) -> list:
    row = values[index]
    return row if isinstance(row, list) else [row]


def parse_table(data: bytes) -> list[dict]:
    count = struct.unpack_from("<I", data, 0)[0]
    table_end = 4 + count * 12
    if table_end > len(data):
        raise RuntimeError("ShaderProgram table is truncated")
    entries = []
    for index in range(count):
        offset, length, unknown = struct.unpack_from("<III", data, 4 + index * 12)
        if offset + length > len(data):
            raise RuntimeError(f"ShaderProgram entry {index} is out of bounds")
        raw = data[offset : offset + length]
        entries.append(
            {
                "index": index,
                "offset": offset,
                "length": length,
                "unknownWord": unknown,
                "sha256": sha256(raw),
                "raw": raw,
            }
        )
    return entries


def entry_point(module: bytes) -> tuple[int, str]:
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
    if len(found) != 1:
        raise RuntimeError(f"expected one SPIR-V entry point, found {len(found)}")
    return found[0]


def decode_modules(program: bytes) -> list[dict]:
    modules = []
    for module_index, (offset, candidate) in enumerate(smolv.find_and_decode(program)):
        if candidate is None or offset + 24 > len(program):
            raise RuntimeError("SMOL-V module could not be decoded")
        declared_size = struct.unpack_from("<I", program, offset + 20)[0]
        if declared_size < 24 or declared_size % 4 or declared_size > len(candidate):
            raise RuntimeError("invalid declared SPIR-V size")
        module = candidate[:declared_size]
        model, name = entry_point(module)
        stage = {0: "vertex", 4: "fragment"}.get(model)
        if stage is None:
            raise RuntimeError(f"unsupported execution model {model}")
        modules.append(
            {
                "indexInProgramEntry": module_index,
                "smolvOffset": offset,
                "stage": stage,
                "entryPoint": name,
                "byteSize": len(module),
                "sha256": sha256(module),
                "spvHex": module.hex(),
            }
        )
    if sorted(item["stage"] for item in modules) != ["fragment", "vertex"]:
        raise RuntimeError("TMP SDF program must contain one vertex and one fragment module")
    return modules


def find_shader(shader_root: Path) -> tuple[Path, object, dict]:
    matches = []
    for path in shader_root.rglob("*"):
        if not path.is_file():
            continue
        try:
            env = UnityPy.load(str(path))
        except Exception:
            continue
        for obj in env.objects:
            if obj.type.name != "Shader":
                continue
            try:
                data = obj.read_typetree()
            except Exception:
                continue
            name = data.get("m_ParsedForm", {}).get("m_Name", "")
            if name == SHADER_NAME or name.endswith(SHADER_SUFFIX):
                matches.append((path, obj, data))
    if len(matches) != 1:
        raise RuntimeError(f"expected one TMP SDF Shader, found {len(matches)}")
    return matches[0]


def select_empty_variant(parsed: dict) -> tuple[dict, dict]:
    matches = []
    for subshader_index, subshader in enumerate(parsed.get("m_SubShaders", [])):
        for pass_index, shader_pass in enumerate(subshader.get("m_Passes", [])):
            for stage_name in ("progVertex", "progFragment"):
                stage = shader_pass.get(stage_name, {})
                groups = stage.get("m_PlayerSubPrograms", [])
                parameters = stage.get("m_ParameterBlobIndices", [])
                for group_index, records in enumerate(groups):
                    for variant_index, record in enumerate(records or []):
                        if int(record.get("m_GpuProgramType", -1)) != SPIRV_PROGRAM_TYPE:
                            continue
                        if record.get("m_KeywordIndices", []):
                            continue
                        if group_index >= len(parameters) or variant_index >= len(parameters[group_index]):
                            raise RuntimeError("TMP SDF variant has no parameter blob index")
                        matches.append(
                            (
                                shader_pass,
                                {
                                    "subshaderIndex": subshader_index,
                                    "passIndex": pass_index,
                                    "metadataStage": stage_name,
                                    "playerGroup": group_index,
                                    "variantIndex": variant_index,
                                    "programBlobIndex": int(record["m_BlobIndex"]),
                                    "parameterBlobIndex": int(parameters[group_index][variant_index]),
                                    "gpuProgramType": int(record["m_GpuProgramType"]),
                                    "shaderRequirements": int(record.get("m_ShaderRequirements", 0)),
                                    "keywordIndices": [],
                                },
                            )
                        )
    if len(matches) != 1:
        raise RuntimeError(f"expected one empty-keyword Vulkan variant, found {len(matches)}")
    return matches[0]


def render_state(shader_pass: dict) -> dict:
    state = shader_pass.get("m_State", {})
    return {
        "serialized": state,
        "tags": shader_pass.get("m_Tags", {}),
        "programMask": int(shader_pass.get("m_ProgramMask", 0)),
        "platforms": [int(value) for value in shader_pass.get("m_Platforms", [])],
    }


def extract(decrypted_root: Path) -> dict:
    shader_root = decrypted_root / "Common" / "Shader"
    bundle_path, obj, shader = find_shader(shader_root)
    parsed = shader.get("m_ParsedForm", {})
    shader_pass, selected = select_empty_variant(parsed)

    platforms = [int(value) for value in shader.get("platforms", [])]
    if platforms != [VULKAN_PLATFORM]:
        raise RuntimeError(f"unexpected TMP SDF shader platforms: {platforms}")
    compressed_blob = bytes(shader.get("compressedBlob", []))
    offsets = nested(shader.get("offsets", []), 0)
    compressed_lengths = nested(shader.get("compressedLengths", []), 0)
    decompressed_lengths = nested(shader.get("decompressedLengths", []), 0)
    if not (len(offsets) == len(compressed_lengths) == len(decompressed_lengths) == 1):
        raise RuntimeError("expected one Vulkan ShaderProgram segment")
    offset = int(offsets[0])
    compressed = compressed_blob[offset : offset + int(compressed_lengths[0])]
    decompressed = lz4.block.decompress(compressed, uncompressed_size=int(decompressed_lengths[0]))
    entries = parse_table(decompressed)

    program_entry = entries[selected["programBlobIndex"]]
    parameter_entry = entries[selected["parameterBlobIndex"]]
    modules = decode_modules(program_entry["raw"])
    texture_names = {
        prop.get("m_Name")
        for prop in parsed.get("m_PropInfo", {}).get("m_Props", [])
        if prop.get("m_Type") == 4
    }
    bindings = parse_parameter_blob(parameter_entry["raw"], texture_names)
    merged_textures = {item["name"]: {**item, "source": "common"} for item in common_textures(shader_pass)}
    for item in bindings["textures"]:
        merged_textures[item["name"]] = {**item, "source": "variant"}

    bundle_bytes = bundle_path.read_bytes()
    raw_object = bytes(obj.get_raw_data())
    return {
        "schemaVersion": 1,
        "source": {
            "decryptedRoot": str(decrypted_root.resolve()),
            "bundle": str(bundle_path.resolve()),
            "bundleByteSize": len(bundle_bytes),
            "bundleSha256": sha256(bundle_bytes),
            "serializedFile": obj.assets_file.name,
            "shaderPathId": str(obj.path_id),
            "shaderObjectByteSize": len(raw_object),
            "shaderObjectSha256": sha256(raw_object),
        },
        "shader": {
            "name": parsed.get("m_Name"),
            "platforms": platforms,
            "keywordNames": parsed.get("m_KeywordNames", []),
            "selectedVariant": selected,
            "renderState": render_state(shader_pass),
        },
        "program": {
            "compressedByteSize": len(compressed),
            "compressedSha256": sha256(compressed),
            "decompressedByteSize": len(decompressed),
            "decompressedSha256": sha256(decompressed),
            "entryCount": len(entries),
            "parameterEntry": {
                key: value for key, value in parameter_entry.items() if key != "raw"
            },
            "programEntry": {
                key: value for key, value in program_entry.items() if key != "raw"
            },
            "modules": modules,
        },
        "bindings": {
            "textures": sorted(merged_textures.values(), key=lambda item: item["binding"]),
            "constantBuffers": bindings["constantBuffers"],
            "constantBufferBindings": bindings["constantBufferBindings"],
        },
        "evidence": {
            "status": "exact-static-program-and-bindings",
            "runtimeBoundary": "glyph atlas contents, generated glyph mesh data, and per-draw resolved uniforms still require runtime evidence",
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--decrypted-root", type=Path, default=DEFAULT_DECRYPTED)
    parser.add_argument("--pretty", action="store_true")
    args = parser.parse_args()
    result = extract(args.decrypted_root)
    json.dump(result, sys.stdout, ensure_ascii=True, indent=2 if args.pretty else None, sort_keys=True)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
