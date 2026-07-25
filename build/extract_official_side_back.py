#!/usr/bin/env python3
"""Extract official Side&Back shader evidence from the decrypted Unity bundle."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import struct
import sys
import warnings

import lz4.block
import UnityPy


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SHADER_ROOT = Path(
    "D:/DevProjectes/ptcgp-tools-master/masterdata_decoder/.output/decrypted/Common/Shader"
)
BUNDLE_RELATIVE_PATH = Path("Common/CardNew/Card_Side_And_Back.shader_bundles")
MATERIAL_RELATIVE_PATHS = (
    Path("Common/CardNew/Common/Model/Materials/UI/L_Card_R_M.mat_bundles"),
    Path("Common/CardNew/Common/Model/Materials/UI/L_Card_S_M.mat_bundles"),
)
SHADER_NAME = "Lettuce/Common/CardNew/Face/Side&Back"
VULKAN_PLATFORM = 18
SPIRV_PROGRAM_TYPE = 25
STAGES = ("progVertex", "progFragment", "progGeometry", "progHull", "progDomain")

sys.path.insert(0, str(ROOT / "build" / "shaderdec"))
import smolv  # noqa: E402
from unity_parameter_entry import parse_parameter_entry as parse_unity_parameter_entry  # noqa: E402

UnityPy.config.FALLBACK_UNITY_VERSION = "2022.3.62f2"
warnings.filterwarnings("ignore", category=Warning, module=r"UnityPy\..*")


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def raw_record(data: bytes) -> dict:
    return {"byteSize": len(data), "sha256": sha256(data), "rawHex": data.hex()}


def value(record: object) -> dict:
    if not isinstance(record, dict) or "val" not in record:
        raise RuntimeError("serialized render state value is missing")
    name = record.get("name")
    return {
        "value": int(record["val"]),
        "property": None if name == "<noninit>" else name,
    }


def render_state(shader_pass: dict) -> dict:
    state = shader_pass.get("m_State", {})
    blend = state.get("rtBlend0", {})
    stencil = state.get("stencilOp", {})
    return {
        "blend": {
            "srcColor": value(blend.get("srcBlend")),
            "dstColor": value(blend.get("destBlend")),
            "srcAlpha": value(blend.get("srcBlendAlpha")),
            "dstAlpha": value(blend.get("destBlendAlpha")),
            "colorOp": value(blend.get("blendOp")),
            "alphaOp": value(blend.get("blendOpAlpha")),
            "colorMask": value(blend.get("colMask")),
            "separate": bool(state.get("rtSeparateBlend", False)),
        },
        "depth": {
            "test": value(state.get("zTest")),
            "write": value(state.get("zWrite")),
            "clip": value(state.get("zClip")),
        },
        "cull": value(state.get("culling")),
        "stencil": {
            "reference": value(state.get("stencilRef")),
            "readMask": value(state.get("stencilReadMask")),
            "writeMask": value(state.get("stencilWriteMask")),
            "compare": value(stencil.get("comp")),
            "pass": value(stencil.get("pass")),
            "fail": value(stencil.get("fail")),
            "depthFail": value(stencil.get("zFail")),
        },
        "alphaToMask": value(state.get("alphaToMask")),
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


def common_textures(shader_pass: dict) -> list[dict]:
    names = {int(index): str(name) for name, index in shader_pass.get("m_NameIndices", [])}
    result = {}
    for stage_name in STAGES:
        common = shader_pass.get(stage_name, {}).get("m_CommonParameters", {})
        for item in common.get("m_TextureParams", []):
            name = names.get(int(item.get("m_NameIndex", -1)))
            if name:
                encoded = int(item.get("m_Index", 0))
                result[name] = {
                    "name": name,
                    "binding": encoded & 0xFFFFFF,
                    "encodedIndex": encoded,
                    "samplerIndex": int(item.get("m_SamplerIndex", -1)),
                    "dimension": int(item.get("m_Dim", -1)),
                    "multisampled": bool(item.get("m_MultiSampled", False)),
                    "source": "common",
                }
    return sorted(result.values(), key=lambda item: item["binding"])


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
            raise RuntimeError(f"unexpected Side&Back execution model {model}")
        modules.append({
            "indexInProgramEntry": index,
            "smolvOffset": offset,
            "stage": stage,
            "executionModel": model,
            "byteSize": len(module),
            "sha256": sha256(module),
            "spvHex": module.hex(),
        })
    if sorted(item["stage"] for item in modules) != ["fragment", "vertex"]:
        raise RuntimeError("Side&Back program must contain one vertex and one fragment module")
    return modules


def properties(parsed: dict) -> list[dict]:
    rows = []
    for prop in parsed.get("m_PropInfo", {}).get("m_Props", []):
        rows.append({
            "name": prop.get("m_Name"),
            "type": int(prop.get("m_Type", -1)),
            "defaultValue": [prop.get(f"m_DefValue[{index}]") for index in range(4)],
            "defaultTexture": prop.get("m_DefTexture", {}).get("m_DefaultName", ""),
        })
    return rows


def material_evidence(decrypted_root: Path, relative_path: Path) -> dict:
    bundle_path = decrypted_root / relative_path
    bundle_bytes = bundle_path.read_bytes()
    environment = UnityPy.load(bundle_bytes)
    materials = [obj for obj in environment.objects if obj.type.name == "Material"]
    if len(materials) != 1:
        raise RuntimeError(f"expected one Material in {relative_path}, found {len(materials)}")
    material = materials[0]
    material_raw = bytes(material.get_raw_data())
    tree = material.read_typetree()
    shader_pptr = tree.get("m_Shader", {})
    file_id = int(shader_pptr.get("m_FileID", 0))
    serialized = material.assets_file
    if file_id < 1 or file_id > len(serialized.externals):
        raise RuntimeError(f"material {tree.get('m_Name')} has invalid Shader FileID {file_id}")
    shader_external = serialized.externals[file_id - 1]
    saved = tree.get("m_SavedProperties", {})
    floats = {str(name): float(number) for name, number in saved.get("m_Floats", [])}
    colors = {
        str(name): [float(value[key]) for key in ("r", "g", "b", "a")]
        for name, value in saved.get("m_Colors", [])
    }
    textures = {}
    for name, value in saved.get("m_TexEnvs", []):
        pointer = value.get("m_Texture", {})
        textures[str(name)] = {
            "fileId": int(pointer.get("m_FileID", 0)),
            "pathId": str(pointer.get("m_PathID", 0)),
            "scale": [float(value["m_Scale"]["x"]), float(value["m_Scale"]["y"])],
            "offset": [float(value["m_Offset"]["x"]), float(value["m_Offset"]["y"])],
        }
    return {
        "relativePath": relative_path.as_posix(),
        "bundle": raw_record(bundle_bytes),
        "materialObject": {
            "pathId": str(material.path_id),
            **raw_record(material_raw),
        },
        "serializedFile": str(serialized.name),
        "name": str(tree.get("m_Name")),
        "shaderPPtr": {"fileId": file_id, "pathId": str(shader_pptr.get("m_PathID", 0))},
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
        "selectedProperties": {
            "_CullMode": floats.get("_CullMode"),
            "_Blend": colors.get("_Blend"),
            "_BaseTex": textures.get("_BaseTex"),
        },
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--shaders", type=Path, default=Path(DEFAULT_SHADER_ROOT))
    args = parser.parse_args()

    shader_root = args.shaders.resolve()
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
        raise RuntimeError("Side&Back must contain exactly one subshader and one pass")
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
    runtime_candidates = [row for row in compiled_variants if row["keywords"] == ["INSTANCING_ON"]]
    if len(runtime_candidates) != 1:
        raise RuntimeError(f"INSTANCING_ON resolved {len(runtime_candidates)} variants")
    runtime_selected = runtime_candidates[0]
    if runtime_selected["gpuProgramType"] != SPIRV_PROGRAM_TYPE:
        raise RuntimeError("runtime INSTANCING_ON program is not Vulkan SPIR-V")

    compressed_blob = bytes(shader.get("compressedBlob", []))
    offsets = shader["offsets"][0]
    compressed_lengths = shader["compressedLengths"][0]
    decompressed_lengths = shader["decompressedLengths"][0]
    if len(compressed_lengths) != 1 or len(decompressed_lengths) != 1:
        raise RuntimeError("expected one Vulkan compressed program block")
    offset = int(offsets[0] if isinstance(offsets, list) else offsets)
    compressed = compressed_blob[offset : offset + int(compressed_lengths[0])]
    decompressed = lz4.block.decompress(compressed, uncompressed_size=int(decompressed_lengths[0]))
    entries = parse_table(decompressed)

    texture_names = {row["name"] for row in properties(parsed) if row["type"] == 4}

    def bindings_for(variant: dict, allow_opaque: bool = False) -> dict:
        parameter_entry = entries[variant["parameterBlobIndex"]]
        parameter_bytes = bytes.fromhex(parameter_entry["rawHex"])
        try:
            parameters = parse_parameter_entry(parameter_bytes, texture_names)
        except RuntimeError:
            if not allow_opaque:
                raise
            return {
                "parameterBlobIndex": variant["parameterBlobIndex"],
                "parameterEntrySha256": parameter_entry["sha256"],
                "parameterEntryByteSize": parameter_entry["length"],
                "semanticBindingsAvailable": False,
                "bindingAuthority": "runtime SPIR-V reflection",
            }
        textures = {item["name"]: {**item} for item in common_textures(shader_pass)}
        for raw_item in parameters["textures"]:
            item = {**raw_item, "source": "variant"}
            if item["name"] in textures:
                raise RuntimeError(f"duplicate texture binding {item['name']}")
            textures[item["name"]] = item
        return {
            "parameterBlobIndex": variant["parameterBlobIndex"],
            "parameterEntrySha256": parameter_entry["sha256"],
            "textures": sorted(textures.values(), key=lambda item: item["binding"]),
            "constantBuffers": parameters["constantBuffers"],
            "constantBufferBindings": parameters["constantBufferBindings"],
            "parameterBlobVersion": parameters["version"],
            "parameterBlobConstantBlockCount": parameters["constantBlockCount"],
            "parameterBlobResourceCount": parameters["resourceCount"],
            "semanticBindingsAvailable": True,
            "bindingAuthority": "Unity parameter entry",
        }

    baseline_bindings = bindings_for(selected)
    runtime_bindings = bindings_for(runtime_selected, allow_opaque=True)

    program_entry = entries[selected["programBlobIndex"]]
    modules = decode_modules(bytes.fromhex(program_entry["rawHex"]))
    runtime_program_entry = entries[runtime_selected["programBlobIndex"]]
    runtime_modules = decode_modules(bytes.fromhex(runtime_program_entry["rawHex"]))
    tags = dict(subshaders[0].get("m_Tags", {}).get("tags", []))
    decrypted_root = shader_root.parents[1]
    materials = [material_evidence(decrypted_root, item) for item in MATERIAL_RELATIVE_PATHS]

    result = {
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
        "runtimeVariant": runtime_selected,
        "bindings": runtime_bindings,
        "baselineBindings": baseline_bindings,
        "runtimeBindings": runtime_bindings,
        "modules": modules,
        "runtimeModules": runtime_modules,
        "officialMaterials": materials,
    }
    json.dump(result, sys.stdout, indent=2, sort_keys=False)


if __name__ == "__main__":
    main()
